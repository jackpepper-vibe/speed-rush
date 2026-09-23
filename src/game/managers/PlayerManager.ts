import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import { COLLISION, HANDLING, ROAD, SPEED } from '@/game/config/Balance';
import { barrierLimit, hillSlopeAt, isOnShoulder, laneAt } from '@/game/world/RoadGeometry';
import { buildPlayerCar, type Vehicle } from '@/game/render/vehicles/VehicleFactory';
import { CARS, carById, chassisOf, effectiveStats, type CarStats, type Chassis, type UpgradableStat } from '@/game/config/Cars';

export interface PlayerInput {
  /** -1 full left, +1 full right. */
  steer: number;
  throttle: boolean;
  brake: boolean;
}

/**
 * The player's car: lateral physics, speed, and the body that shows it.
 *
 * The original snapped between three fixed lane centres over a fixed number of
 * frames, so every corner was the same corner and the car had no weight. This
 * integrates a lateral velocity against grip instead: steering applies force,
 * tyres remove it, and the two settle at a cornering rate that depends on how
 * fast you are going and what car you bought. Lanes still exist — traffic needs
 * them — but the player is free to sit between two of them.
 */
export class PlayerManager implements Manager {
  readonly name = 'player';

  readonly mesh: Vehicle;
  private stats: CarStats;

  /** Road-space lateral position; 0 is the centreline. */
  x = 0;
  /** Lateral velocity, units/sec. */
  vx = 0;
  /** Forward speed, units/sec. */
  speed: number = SPEED.start;
  /** Vertical position and velocity, for crests and jumps. */
  y = 0;
  vy = 0;
  airborne = false;

  /** Smoothed steering input, so a keypress ramps rather than snaps. */
  private steerAmount = 0;
  private wheelSpin = 0;
  private lastLane = Math.floor(ROAD.laneCount / 2);
  private wasSlipping = false;
  private gripSurface = 1;
  private carId: string;
  private chassis: Chassis;

  /** Ceiling on speed, raised by distance and by nitro. */
  speedCeiling: number = SPEED.baseMax;
  private boostFactor = 1;

  input: PlayerInput = { steer: 0, throttle: true, brake: false };

  constructor(
    private readonly ctx: GameContext,
    carId: string,
    upgrades: Partial<Record<UpgradableStat, number>>,
  ) {
    this.carId = carId;
    const def = carById(carId);
    this.chassis = chassisOf(def);
    this.stats = effectiveStats(def, upgrades);
    this.mesh = buildPlayerCar(def, carIndex(carId));
    this.ctx.scene.add(this.mesh);
  }

  /**
   * Put a car under the player, with what has been bought for it.
   *
   * The stats are always re-derived; the body is rebuilt only when the car
   * itself changes, since a new upgrade on the same car is a change of
   * numbers rather than of model. Returns whether the body was replaced, so
   * whatever hangs off it can be moved to the new one.
   */
  setCar(carId: string, upgrades: Partial<Record<UpgradableStat, number>>): boolean {
    const def = carById(carId);
    this.stats = effectiveStats(def, upgrades);
    if (carId === this.carId) return false;
    this.carId = carId;
    this.chassis = chassisOf(def);
    const replacement = buildPlayerCar(def, carIndex(carId));
    replacement.position.copy(this.mesh.position);
    this.mesh.dispose();
    (this as { mesh: Vehicle }).mesh = replacement;
    this.ctx.scene.add(replacement);
    return true;
  }

  get currentCarId(): string {
    return this.carId;
  }

  /** Car or bike: what the player is driving stands on. */
  get chassisKind(): Chassis {
    return this.chassis;
  }

  /** How big the vehicle is to hit, and how close it may run to the rail. */
  get footprint(): (typeof COLLISION.player)[Chassis] {
    return COLLISION.player[this.chassis];
  }

  /** The stats the car is being driven with, upgrades included. */
  get carStats(): Readonly<CarStats> {
    return this.stats;
  }

  /** The car's boost stat, multiplying nitro duration. */
  get boostDuration(): number {
    return this.stats.boost;
  }

  /** 0 at a standstill, 1 at the current ceiling — drives camera, grade, audio. */
  get speedFraction(): number {
    return THREE.MathUtils.clamp(this.speed / (SPEED.baseMax * this.stats.topSpeed), 0, 1.4);
  }

  get lane(): number {
    return laneAt(this.x);
  }

  get slipping(): boolean {
    return Math.abs(this.vx) > HANDLING.slipThreshold * this.gripSurface;
  }

  /** Surface grip multiplier, set by the weather system. */
  setSurfaceGrip(grip: number): void {
    this.gripSurface = grip;
  }

  setBoost(factor: number): void {
    this.boostFactor = factor;
  }

  update(dt: number, _speed: number, distance: number): void {
    this.integrateSpeed(dt, distance);
    this.integrateLateral(dt);
    this.testCrest(distance);
    this.integrateVertical(dt);
    this.pose(dt);
  }

  /**
   * Leave the road at the top of a hill.
   *
   * A crest is where the gradient turns over from climbing to falling. Taking
   * one fast enough throws the car, and the road dropping away underneath does
   * more for the sense of speed than any amount of motion blur.
   *
   * The launch is a rule, not a simulation, and that is a deliberate choice.
   * Following the road over these crests demands about 4 units of downward
   * acceleration against a gravity of 26, so a physical model would keep the
   * car pinned to the tarmac forever — the hills would have to be seven times
   * taller before it ever left the ground, and a road like that is unreadable
   * at speed. Above a speed threshold, cresting launches you; below it, the
   * car follows the surface and gentle rises stay gentle.
   */
  private testCrest(distance: number): void {
    const slope = hillSlopeAt(distance);
    const previous = this.lastSlope;
    this.lastSlope = slope;

    if (this.airborne) return;
    // The gradient turning over from climbing to falling.
    if (previous <= 0 || slope > 0) return;

    const fraction = this.speed / (SPEED.baseMax * this.stats.topSpeed);
    if (fraction < 0.55) return;

    this.launch(2.6 + fraction * 5.2);
  }

  private lastSlope = 0;
  /** True while the car is in continuous contact with a barrier. */
  private againstBarrier = false;

  /** Seconds of continuous contact with the shoulder. */
  private shoulderTime = 0;

  /**
   * How far the gutter has mired the car: 0 on clean tarmac, 1 stopped dead.
   *
   * Public so the gate can assert on it — the difference between "the strip is
   * slow" and "the strip stops you" is two seconds apart and invisible to any
   * single-frame measurement.
   *
   * Nothing renders it yet, and that is worth writing down as a debt rather
   * than leaving to be rediscovered: this is a punishment with a timer, and a
   * timer the player cannot see is one they will feel as the car dying for no
   * reason. The camber already pulls them toward the rail while it runs, which
   * is a hint, but it is not the same as being told.
   */
  get bog(): number {
    return THREE.MathUtils.clamp(this.shoulderTime / HANDLING.shoulderBogSeconds, 0, 1);
  }

  /**
   * Lowest speed the car may be clamped to this tick.
   *
   * Never above the ceiling, which is what lets a mired car reach zero while a
   * car on the road still cannot fall below `SPEED.min`.
   */
  private get speedFloor(): number {
    return Math.min(SPEED.min, this.speedCeiling);
  }

  private integrateSpeed(dt: number, distance: number): void {
    const km = distance / 1000;
    let ceiling = Math.min(
      (SPEED.baseMax + km * SPEED.maxGainPerKm) * this.stats.topSpeed * this.boostFactor,
      SPEED.absoluteMax,
    );
    /* Off the tarmac, the ceiling comes down rather than the speed merely
     * bleeding — and it keeps coming down for as long as the car stays there.
     *
     * The fixed cap alone left the gutter drivable: half the ceiling is still a
     * speed, so the strip was a sixth lane with no traffic in it. Winding the
     * cap to zero over `shoulderBogSeconds` means there is no equilibrium to
     * settle at. The car mires and stops. See HANDLING.shoulderBogSeconds.
     */
    const onShoulder = isOnShoulder(this.x);
    this.shoulderTime = onShoulder
      ? this.shoulderTime + dt
      : Math.max(0, this.shoulderTime - dt * HANDLING.shoulderRecoverRate);
    if (onShoulder) ceiling *= HANDLING.shoulderSpeedCap * (1 - this.bog);
    this.speedCeiling = ceiling;

    if (this.input.brake) {
      this.speed -= SPEED.brake * dt;
    } else if (this.input.throttle) {
      const gap = ceiling - this.speed;
      this.speed += Math.sign(gap) * Math.min(Math.abs(gap), SPEED.accel * this.stats.accel * dt * 4);
    } else {
      this.speed -= SPEED.coast * dt;
    }

    // Running a wheel onto the rumble strip scrubs speed off.
    if (onShoulder) this.speed -= HANDLING.shoulderDrag * dt;

    /* The floor follows the ceiling down.
     *
     * `SPEED.min` is what stops the car dribbling to a halt on the road, and on
     * the road the ceiling is far above it so it does exactly that. In a fully
     * mired gutter the ceiling is zero and a fixed floor of 18 would hold the
     * car moving at a walk forever — which is the coast this change exists to
     * remove, merely slower. Clamping between a floor that can never exceed the
     * ceiling is also the only ordering `clamp` is defined for.
     */
    this.speed = THREE.MathUtils.clamp(this.speed, this.speedFloor, ceiling);
  }

  private integrateLateral(dt: number): void {
    // Input ramp: attack and release differ so the car feels like it has mass
    // going in and springs back when you let go.
    const target = THREE.MathUtils.clamp(this.input.steer, -1, 1);
    const rate = Math.abs(target) > Math.abs(this.steerAmount) ? HANDLING.steerAttack : HANDLING.steerRelease;
    this.steerAmount += (target - this.steerAmount) * Math.min(1, rate * dt);

    // Authority falls away with speed — the car gets nervous at the top end.
    const speedT = THREE.MathUtils.clamp(this.speedFraction, 0, 1);
    const authority = THREE.MathUtils.lerp(1, HANDLING.highSpeedFactor, speedT) * this.stats.grip * this.gripSurface;

    this.vx += this.steerAmount * HANDLING.steerRate * authority * dt * 6;

    /* The gutter pulls outward.
     *
     * Applied with the steering rather than after the damping, so the tyres
     * fight it the same way they fight a steering input and the two settle
     * against each other instead of one being applied on top of the result.
     *
     * Ramped by how far off the tarmac the car is: a wheel over the line is a
     * nudge, the full width of the shoulder is the full pull. A step change at
     * the white line would make the edge of the road feel like a kerb, and the
     * edge of the road is somewhere the player is meant to be able to run.
     */
    const over = Math.abs(this.x) - ROAD.halfWidth;
    if (over > 0) {
      const lean = Math.min(1, over / ROAD.shoulderWidth);
      this.vx += Math.sign(this.x) * HANDLING.shoulderCamber * (0.3 + 0.7 * lean) * dt;
    }

    // Tyres bleed lateral velocity. Wet roads bleed less, so the car slides.
    const damping = HANDLING.gripDamping * this.stats.grip * this.gripSurface;
    this.vx -= this.vx * Math.min(1, damping * dt);

    this.x += this.vx * dt;

    /*
     * Barriers: a hard stop with a bounce, not a wall the car sinks into.
     *
     * The impact penalty fires on contact only. Applied every tick it was
     * compounding at 120Hz, so a car held against the rail was crushed to the
     * minimum speed in well under a second — the HUD read a steady 56 km/h with
     * the gearbox in neutral while the player still had the throttle pinned.
     * Sustained contact is a scrub, not a series of collisions.
     */
    const limit = barrierLimit() - this.footprint.rail;
    if (Math.abs(this.x) > limit) {
      this.x = Math.sign(this.x) * limit;
      this.vx *= -0.28;

      if (!this.againstBarrier) {
        this.againstBarrier = true;
        this.speed = Math.max(this.speedFloor, this.speed * 0.86);
        this.ctx.bus.emit('player:crash', {
          with: 'barrier',
          speed: this.speed,
          position: this.mesh.position.clone(),
        });
      } else {
        /* Held against the rail, which on a coastal boulevard means held in
         * the gutter. The floor follows the ceiling here for the same reason
         * it does above: a fixed `SPEED.min` would quietly restore a mired car
         * to a walking pace on every tick of contact, and the rail is exactly
         * where the camber puts a driver who tried to travel the shoulder. */
        this.speed = Math.max(this.speedFloor, this.speed - HANDLING.shoulderDrag * 2.5 * dt);
      }
    } else {
      this.againstBarrier = false;
    }

    const slipping = this.slipping;
    if (slipping !== this.wasSlipping) {
      this.wasSlipping = slipping;
      if (slipping) {
        this.ctx.bus.emit('player:drift', { intensity: Math.abs(this.vx) / HANDLING.steerRate, lateral: this.vx });
      }
    }
    this.ctx.bus.emit('player:steer', { lateral: this.vx, grip: this.gripSurface, slipping });

    const lane = this.lane;
    if (lane !== this.lastLane) {
      this.ctx.bus.emit('player:lane-change', {
        from: this.lastLane,
        to: lane,
        direction: lane > this.lastLane ? 1 : -1,
      });
      this.lastLane = lane;
    }
  }

  /**
   * Vertical motion.
   *
   * Cresting a hill fast enough lifts the car clear of the road — a small thing
   * that does more for the sense of speed than any amount of motion blur.
   */
  private integrateVertical(dt: number): void {
    if (this.airborne) {
      this.vy -= 26 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        const impact = -this.vy;
        this.y = 0;
        this.vy = 0;
        this.airborne = false;
        this.ctx.bus.emit('player:land', { impact });
      } else {
        this.ctx.bus.emit('player:airborne', { height: this.y });
      }
    }
  }

  /** Launch the car off a crest. Called by the world when the gradient drops away. */
  launch(strength: number): void {
    if (this.airborne) return;
    this.airborne = true;
    this.vy = strength;
  }

  /** Apply the visual pose: roll, yaw, wheel spin, ride height, lights. */
  private pose(dt: number): void {
    this.mesh.position.set(this.x, this.y, 0);

    const lateralT = THREE.MathUtils.clamp(this.vx / HANDLING.steerRate, -1, 1);
    const bike = this.chassis === 'bike';
    // A car rolls a little on its springs and a bike leans hard; yaw follows
    // the turn in both. Only the body leans: the shadow stays on the road.
    this.mesh.setLean(-lateralT * (bike ? HANDLING.bikeLean : HANDLING.maxRoll));
    this.mesh.rotation.y = lateralT * HANDLING.maxYaw * -0.5;
    this.mesh.rotation.x = this.airborne ? THREE.MathUtils.clamp(-this.vy * 0.015, -0.2, 0.2) : 0;

    // Spin rate is ground speed over tyre radius; the sign rolls the top of
    // the tyre forwards, towards -z.
    this.wheelSpin -= (this.speed * dt) / 0.31;
    this.mesh.setWheelSpin(this.wheelSpin);
    this.mesh.setSteer(-lateralT * 0.28 * (bike ? HANDLING.bikeSteer : 1));
    this.mesh.setBrake(this.input.brake ? 1 : 0);

    /* Underglow and lamps follow the light.
     *
     * An underglow in full sun is a coloured smear on the tarmac under the
     * car, and it muddied every shadow the car sat in. It belongs to the dark,
     * the same as the headlamps, so it takes their level; and the running
     * lamps brighten with it, the way real tail lamps read stronger at night. */
    const darkness = THREE.MathUtils.clamp(this.headlights / 2, 0, 1);
    const glow = this.mesh.glow;
    if (glow) {
      const mat = glow.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.clamp((this.speedFraction - 0.42) * 0.7, 0, 0.5) * darkness;
    }
    this.mesh.setTailLamps(1 + darkness * 1.5);
  }

  /** Headlight intensity, raised at night and in storms by the world systems. */
  setHeadlights(intensity: number): void {
    this.headlights = intensity;
    this.mesh.setHeadlamps(intensity);
  }

  private headlights = 0;

  get headlightIntensity(): number {
    return this.headlights;
  }

  reset(): void {
    this.x = 0;
    this.vx = 0;
    this.y = 0;
    this.vy = 0;
    this.airborne = false;
    this.speed = SPEED.start;
    this.steerAmount = 0;
    this.boostFactor = 1;
    this.gripSurface = 1;
    this.lastLane = Math.floor(ROAD.laneCount / 2);
    this.wasSlipping = false;
    this.lastSlope = 0;
    this.againstBarrier = false;
    // A new run starts on clean tarmac; carrying the last one's bog into it
    // would cap the first seconds of it for no reason the player can see.
    this.shoulderTime = 0;
    this.speedCeiling = SPEED.baseMax;
    this.mesh.position.set(0, 0, 0);
    this.mesh.rotation.set(0, 0, 0);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

/** Garage slot of a car, which also picks its registration plate. */
function carIndex(carId: string): number {
  return Math.max(0, CARS.findIndex((c) => c.id === carId));
}
