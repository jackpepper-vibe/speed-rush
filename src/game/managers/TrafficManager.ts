import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import type { TrafficKind } from '@/core/GameEvents';
import { COLLISION, ROAD, SPEED, TRAFFIC } from '@/game/config/Balance';
import { buildTrafficCar, trafficPaint, type Vehicle as VehicleVisual } from '@/game/render/vehicles/VehicleFactory';
import type { RoadManager } from './RoadManager';
import type { PlayerManager } from './PlayerManager';

/**
 * Other traffic: spawning, driving, lane discipline and collision.
 *
 * The original treated other cars as static obstacles that slid backwards at a
 * fixed rate — they never changed lane, never reacted, and never had a speed of
 * their own, so the road was a pattern to memorise rather than a situation to
 * read. Here each car carries its own cruising speed, watches the vehicle in
 * front, brakes when it closes, and will change lane when it finds a gap. The
 * result is that the same stretch of road plays differently depending on what
 * the traffic decides to do.
 *
 * Vehicles are pooled. A run spawns hundreds of them, and building a fresh mesh
 * per spawn is what made the original shed frames the longer you survived.
 */
interface Vehicle {
  mesh: VehicleVisual;
  kind: TrafficKind;
  active: boolean;
  /** Absolute distance along the road. */
  distance: number;
  /** Road-space lateral position. */
  x: number;
  lane: number;
  targetLane: number;
  /** 0..1 through a lane change; 1 when settled. */
  laneBlend: number;
  /**
   * Lateral offset from the lane centre, for a vehicle hugging the verge.
   *
   * Zero for almost everything. The few that carry it sit partly on the
   * shoulder, which is the only thing that puts anything in the corridor
   * between the outer lane and the barrier — measured at x 8.40 and x 11.90
   * respectively, so a car against the rail was untouchable by construction.
   * A verge-hugger does not change lane: it is not going anywhere.
   */
  verge: number;
  speed: number;
  cruiseSpeed: number;
  braking: boolean;
  decisionTimer: number;
  hornTimer: number;
  passed: boolean;
  nearMissed: boolean;
  wheelSpin: number;
}

const KINDS: readonly TrafficKind[] = ['sedan', 'coupe', 'suv', 'van', 'truck', 'bus'];
/** Long vehicles are rarer, and heavy enough to be worth avoiding. */
const KIND_WEIGHT: Record<TrafficKind, number> = {
  sedan: 30, coupe: 22, suv: 20, van: 12, truck: 11, bus: 5,
};

export class TrafficManager implements Manager {
  readonly name = 'traffic';

  private readonly pool: Vehicle[] = [];
  private readonly root = new THREE.Group();
  private spawnTimer = 0;
  private readonly scratch = new THREE.Vector3();

  /**
   * Test seam: collisions off lets a probe exercise handling, stability and
   * the speed model over long runs without a crash ending the measurement.
   * Never disabled in play.
   */
  collisionsEnabled = true;

  /**
   * Asked before a collision is allowed to become a crash. Returning true means
   * something absorbed it — a shield, a ghost — and the run continues.
   */
  crashGuard: (kind: TrafficKind) => boolean = () => false;

  /** Test seam: stop new vehicles being spawned. Never off in play. */
  spawningEnabled = true;

  constructor(
    private readonly ctx: GameContext,
    private readonly road: RoadManager,
    private readonly player: PlayerManager,
  ) {}

  init(): void {
    this.ctx.scene.add(this.root);
    // Sized for the worst case: full density across every lane, plus headroom.
    for (let i = 0; i < 34; i++) this.pool.push(this.buildVehicle());
  }

  private buildVehicle(): Vehicle {
    const kind = 'sedan';
    // Pool construction happens at init, outside any run, so it must not touch
    // the simulation's random stream at all.
    const mesh = buildTrafficCar(kind, 0);
    mesh.visible = false;
    this.root.add(mesh);
    return {
      mesh, kind, active: false, distance: 0, x: 0, lane: 0, targetLane: 0, verge: 0,
      laneBlend: 1, speed: 0, cruiseSpeed: 0, braking: false,
      decisionTimer: 0, hornTimer: 0, passed: false, nearMissed: false, wheelSpin: 0,
    };
  }

  /** Live vehicles, for the probe and for the minimap. */
  get activeCount(): number {
    return this.pool.reduce((n, v) => n + (v.active ? 1 : 0), 0);
  }

  /** Snapshot of live traffic in road space, for assertions. */
  snapshot(): { kind: TrafficKind; lane: number; x: number; ahead: number; speed: number }[] {
    return this.pool
      .filter((v) => v.active)
      .map((v) => ({
        kind: v.kind,
        lane: v.lane,
        x: v.x,
        ahead: v.distance - this.road.travelled,
        speed: v.speed,
      }));
  }

  update(dt: number, _speed: number, distance: number): void {
    if (this.spawningEnabled) this.spawn(dt, distance);

    const playerDistance = this.road.travelled;
    for (const v of this.pool) {
      if (!v.active) continue;
      this.driveVehicle(v, dt, playerDistance);
    }

    this.enforceSeparation();

    for (const v of this.pool) {
      if (!v.active) continue;
      this.placeVehicle(v, dt, playerDistance);
      this.testPlayer(v, playerDistance);
      this.recycle(v, playerDistance);
    }
  }

  /**
   * Hard floor on the gap between two cars in the same lane.
   *
   * The following model alone is not enough. A car brakes toward 92% of the
   * speed of the one ahead, which opens the gap only asymptotically, so a fast
   * car that arrives on a slow one's bumper can sit fractionally inside it for
   * a long time — traffic that visibly interpenetrates while every individual
   * rule is being obeyed.
   *
   * Resolving positionally after the fact, front to back, is both simpler and
   * more robust than tuning the deceleration until it happens not to overlap:
   * it cannot fail, and it degrades into ordinary queueing when traffic is
   * dense, which is what a queue looks like anyway.
   */
  private enforceSeparation(): void {
    const live = this.pool.filter((v) => v.active);

    for (let lane = 0; lane < ROAD.laneCount; lane++) {
      const inLane = live
        .filter((v) => v.lane === lane || v.targetLane === lane)
        .sort((a, b) => b.distance - a.distance);

      for (let i = 1; i < inLane.length; i++) {
        const front = inLane[i - 1];
        const back = inLane[i];
        const minGap = COLLISION.kind[front.kind].hl + COLLISION.kind[back.kind].hl + 1.2;
        const gap = front.distance - back.distance;
        if (gap >= minGap) continue;

        back.distance = front.distance - minGap;
        // Match speed rather than stopping dead: a car pinned behind another
        // travels at its speed, and any surplus is what caused the overlap.
        back.speed = Math.min(back.speed, front.speed);
      }
    }
  }

  /* ------------------------------------------------------------------ spawn */

  private spawn(dt: number, distance: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    // Density ramps with distance, to a floor.
    const t = Math.min(distance / 1000 / TRAFFIC.rampKm, 1);
    this.spawnTimer = THREE.MathUtils.lerp(TRAFFIC.spawnIntervalStart, TRAFFIC.spawnIntervalMin, t);

    const vehicle = this.pool.find((v) => !v.active);
    if (!vehicle) return;

    const kind = this.pickKind();
    const lane = this.ctx.rng.int(0, ROAD.laneCount - 1);
    // Drawn unconditionally, before the lane-clear test can bail out, so the
    // number of values taken from the stream per spawn attempt is fixed.
    const colorRoll = this.ctx.rng.next();
    const spawnDistance = distance + ROAD.drawDistance;

    // Refuse a spawn that would materialise on top of another car. Dropping the
    // attempt is correct: the next one comes along in well under a second, and
    // forcing a slot instead is how traffic ends up interpenetrating.
    if (!this.laneClear(lane, spawnDistance, kind)) return;

    // Long vehicles need their own speed band or they block the road solid.
    const fraction = this.ctx.rng.range(TRAFFIC.speedFractionMin, TRAFFIC.speedFractionMax);
    let cruise = SPEED.baseMax * fraction * (kind === 'truck' || kind === 'bus' ? 0.82 : 1);

    this.reskin(vehicle, kind, colorRoll);
    vehicle.active = true;
    vehicle.distance = spawnDistance;
    vehicle.lane = lane;
    vehicle.targetLane = lane;
    vehicle.laneBlend = 1;
    /* Some of the outer-lane traffic runs wide, half on the shoulder.
     *
     * The gutter was a free lane and no speed penalty could close it, because
     * slow is a price a player will pay to be safe: traffic runs in lanes,
     * lanes end at `halfWidth`, and a car parked against the rail therefore
     * could not be hit by anything. `shoulderCamber` makes the shoulder cost
     * attention; this is what makes it cost risk.
     *
     * Only the outer lanes, only sometimes, and only outward — a vehicle
     * drifting inward would be wandering into moving traffic, which is a
     * different and much worse kind of surprise.
     */
    const outer = lane === 0 ? -1 : lane === ROAD.laneCount - 1 ? 1 : 0;
    vehicle.verge = outer !== 0 && this.ctx.rng.chance(TRAFFIC.vergeShare)
      ? outer * TRAFFIC.vergeOffset
      : 0;
    // A vehicle sitting half on the shoulder is there because it is slow, and
    // it has to be slower than a shoulder-capped player or the corridor stays
    // open: collisions need the player to close on something.
    if (vehicle.verge !== 0) {
      cruise = SPEED.baseMax * TRAFFIC.vergeSpeedFraction;
    }
    vehicle.x = ROAD.laneX(lane) + vehicle.verge;
    vehicle.speed = cruise;
    vehicle.cruiseSpeed = cruise;
    vehicle.braking = false;
    vehicle.decisionTimer = this.ctx.rng.range(0, TRAFFIC.laneChangeInterval);
    vehicle.hornTimer = 0;
    vehicle.passed = false;
    vehicle.nearMissed = false;
    vehicle.mesh.visible = true;

    this.ctx.bus.emit('traffic:spawn', { kind, lane, speed: cruise, z: spawnDistance });
  }

  /**
   * Test seam: put one vehicle of a named kind on the road, where asked.
   *
   * The counterpart of `PickupManager.layPickup`, and needed for the same
   * reason. Kinds are weighted — a bus is five parts in a hundred — so a
   * harness that wants to look at one has to drive until the stream happens to
   * produce it, which in practice means thousands of simulated seconds and a
   * capture that may simply time out instead. Verifying the least common model
   * should not be the slowest thing the loop does.
   *
   * Takes nothing from the simulation's random stream: the colour is a
   * parameter, so laying a vehicle cannot shift the world a seed would
   * otherwise produce.
   *
   * @returns false when the pool is full or the slot is occupied.
   */
  layTraffic(kind: TrafficKind, lane: number, ahead: number, colorRoll = 0.5): boolean {
    const vehicle = this.pool.find((v) => !v.active);
    if (!vehicle) return false;

    const distance = this.road.travelled + ahead;
    if (!this.laneClear(lane, distance, kind)) return false;

    this.reskin(vehicle, kind, colorRoll);
    vehicle.active = true;
    vehicle.distance = distance;
    vehicle.lane = lane;
    vehicle.targetLane = lane;
    vehicle.laneBlend = 1;
    vehicle.verge = 0;
    vehicle.x = ROAD.laneX(lane);
    vehicle.speed = SPEED.baseMax * TRAFFIC.speedFractionMin;
    vehicle.cruiseSpeed = vehicle.speed;
    vehicle.braking = false;
    vehicle.decisionTimer = Number.POSITIVE_INFINITY;
    vehicle.hornTimer = 0;
    vehicle.passed = false;
    vehicle.nearMissed = false;
    vehicle.mesh.visible = true;
    return true;
  }

  private pickKind(): TrafficKind {
    const total = KINDS.reduce((n, k) => n + KIND_WEIGHT[k], 0);
    let roll = this.ctx.rng.next() * total;
    for (const k of KINDS) {
      roll -= KIND_WEIGHT[k];
      if (roll <= 0) return k;
    }
    return 'sedan';
  }

  /**
   * Swap a pooled vehicle's body when it comes back as a different kind.
   *
   * Rebuilding the mesh is unavoidable here — a bus is not a coupe with
   * different numbers — but it happens only when the kind actually changes,
   * which the pool makes rare.
   */
  private reskin(v: Vehicle, kind: TrafficKind, colorRoll: number): void {
    if (v.kind === kind && v.mesh.parent) {
      // Same body: a repaint is a uniform, so every car in the stream gets
      // its own colour rather than keeping the one its pool slot was built in.
      v.mesh.setPaint(trafficPaint(kind, colorRoll));
      return;
    }
    v.mesh.dispose();
    v.mesh = buildTrafficCar(kind, colorRoll);
    this.root.add(v.mesh);
    v.kind = kind;
  }

  /** True when no live vehicle sits within the minimum gap of `distance`. */
  private laneClear(lane: number, distance: number, kind: TrafficKind): boolean {
    const half = COLLISION.kind[kind].hl;
    for (const other of this.pool) {
      if (!other.active) continue;
      if (other.lane !== lane && other.targetLane !== lane) continue;
      const gap = Math.abs(other.distance - distance);
      if (gap < TRAFFIC.minGap + half + COLLISION.kind[other.kind].hl) return false;
    }
    return true;
  }

  /* --------------------------------------------------------------- driving */

  private driveVehicle(v: Vehicle, dt: number, playerDistance: number): void {
    // Watch the vehicle ahead in the same lane.
    const ahead = this.nearestAhead(v);
    const wasBraking = v.braking;
    v.braking = false;

    if (ahead) {
      const gap = ahead.distance - v.distance - COLLISION.kind[ahead.kind].hl - COLLISION.kind[v.kind].hl;
      const closing = v.speed - ahead.speed;
      // Brake when the gap would close inside two seconds.
      if (gap < Math.max(12, closing * 2)) {
        v.braking = true;
        v.speed = Math.max(ahead.speed * 0.92, v.speed - 22 * dt);
      }
    }

    if (v.braking && !wasBraking) {
      this.ctx.bus.emit('traffic:brake', { kind: v.kind, lane: v.lane });
    }
    if (!v.braking && v.speed < v.cruiseSpeed) {
      v.speed = Math.min(v.cruiseSpeed, v.speed + 9 * dt);
    }

    v.mesh.setBrake(v.braking ? 1 : 0);

    // Lane-change decisions, on a timer rather than every frame.
    v.decisionTimer -= dt;
    // A vehicle hugging the verge stays there; it is not looking for a gap.
    if (v.verge === 0 && v.decisionTimer <= 0 && v.laneBlend >= 1) {
      v.decisionTimer = TRAFFIC.laneChangeInterval;
      // A braking car is more motivated to find a way around.
      const urge = v.braking ? TRAFFIC.laneChangeChance * 2.4 : TRAFFIC.laneChangeChance;
      if (this.ctx.rng.chance(urge)) this.tryLaneChange(v);
    }

    if (v.laneBlend < 1) {
      v.laneBlend = Math.min(1, v.laneBlend + dt / TRAFFIC.laneChangeDuration);
      const from = ROAD.laneX(v.lane);
      const to = ROAD.laneX(v.targetLane);
      // Smoothstep: a lane change should ease out, not arrive at full rate.
      const t = v.laneBlend * v.laneBlend * (3 - 2 * v.laneBlend);
      v.x = from + (to - from) * t + v.verge;
      if (v.laneBlend >= 1) v.lane = v.targetLane;
    } else {
      v.x = ROAD.laneX(v.lane) + v.verge;
    }

    v.distance += v.speed * dt;

    // Horn: a long vehicle closing on the player from behind.
    v.hornTimer -= dt;
    const gapToPlayer = v.distance - playerDistance;
    if (
      (v.kind === 'truck' || v.kind === 'bus') &&
      v.hornTimer <= 0 &&
      gapToPlayer < 0 && gapToPlayer > -TRAFFIC.hornGap &&
      Math.abs(v.x - this.player.x) < ROAD.laneWidth
    ) {
      v.hornTimer = TRAFFIC.hornCooldown;
      this.ctx.bus.emit('traffic:horn', {
        kind: v.kind,
        position: v.mesh.position.clone(),
        closing: (v.speed - this.player.speed) / SPEED.baseMax,
      });
    }
  }

  private nearestAhead(v: Vehicle): Vehicle | null {
    let best: Vehicle | null = null;
    let bestGap = Infinity;
    for (const other of this.pool) {
      if (!other.active || other === v) continue;
      if (other.lane !== v.lane && other.targetLane !== v.lane) continue;
      const gap = other.distance - v.distance;
      if (gap > 0 && gap < bestGap) {
        bestGap = gap;
        best = other;
      }
    }
    return bestGap < 90 ? best : null;
  }

  private tryLaneChange(v: Vehicle): void {
    const options = [v.lane - 1, v.lane + 1].filter((l) => l >= 0 && l < ROAD.laneCount);
    if (options.length === 0) return;
    const target = options[Math.floor(this.ctx.rng.next() * options.length)];

    // Only move into a gap that is genuinely clear, both ahead and behind.
    for (const other of this.pool) {
      if (!other.active || other === v) continue;
      if (other.lane !== target && other.targetLane !== target) continue;
      const gap = Math.abs(other.distance - v.distance);
      if (gap < TRAFFIC.minGap + COLLISION.kind[v.kind].hl + COLLISION.kind[other.kind].hl) return;
    }

    const from = v.lane;
    v.targetLane = target;
    v.laneBlend = 0;
    this.ctx.bus.emit('traffic:lane-change', { kind: v.kind, from, to: target });
  }

  /* -------------------------------------------------------------- placement */

  private placeVehicle(v: Vehicle, dt: number, playerDistance: number): void {
    const ahead = v.distance - playerDistance;
    this.road.worldOffset(ahead, this.scratch);
    v.mesh.position.set(this.scratch.x + v.x, this.scratch.y, this.scratch.z);

    // Yaw into a lane change, so the manoeuvre is legible from behind.
    const lateral = v.laneBlend < 1 ? (ROAD.laneX(v.targetLane) - ROAD.laneX(v.lane)) : 0;
    v.mesh.rotation.y = lateral * 0.06 * (1 - Math.abs(v.laneBlend * 2 - 1));

    v.wheelSpin -= (v.speed * dt) / 0.34;
    v.mesh.setWheelSpin(v.wheelSpin);
  }

  /* -------------------------------------------------------------- collision */

  private testPlayer(v: Vehicle, playerDistance: number): void {
    const ahead = v.distance - playerDistance;
    const box = COLLISION.kind[v.kind];
    const dx = Math.abs(v.x - this.player.x);
    const dz = Math.abs(ahead);
    const me = this.player.footprint;

    const overlapX = dx < box.hw + me.hw;
    const overlapZ = dz < box.hl + me.hl;

    if (overlapX && overlapZ) {
      if (!this.collisionsEnabled) return;
      // Absorbed by a shield or a ghost: the contact happened, the crash did not.
      if (this.crashGuard(v.kind)) return;
      this.ctx.bus.emit('player:crash', {
        with: v.kind,
        speed: this.player.speed,
        position: v.mesh.position.clone(),
      });
      return;
    }

    // A near miss is a car that got alongside, close, and lived. Scored once.
    if (!v.nearMissed && overlapZ && dx < box.hw + me.hw + TRAFFIC.nearMissGap) {
      v.nearMissed = true;
      this.ctx.bus.emit('player:near-miss', {
        kind: v.kind,
        gap: dx - box.hw - me.hw,
        position: v.mesh.position.clone(),
      });
    }
  }

  private recycle(v: Vehicle, playerDistance: number): void {
    const ahead = v.distance - playerDistance;
    if (ahead > -TRAFFIC.despawnBehind) return;
    v.active = false;
    v.mesh.visible = false;
    this.ctx.bus.emit('traffic:despawn', { kind: v.kind, passed: true });
  }

  /** Remove every live vehicle without emitting despawn cues. Test seam. */
  clearAll(): void {
    for (const v of this.pool) {
      v.active = false;
      v.mesh.visible = false;
    }
  }

  reset(): void {
    this.clearAll();
    this.spawnTimer = 0;
  }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    for (const v of this.pool) v.mesh.dispose();
    this.pool.length = 0;
  }
}
