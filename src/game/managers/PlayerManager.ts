import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import { HANDLING, ROAD, SPEED } from '@/game/config/Balance';
import { barrierLimit, isOnShoulder, laneAt } from '@/game/world/RoadGeometry';
import { buildPlayerCar, type CarMesh } from '@/game/render/CarFactory';
import { carById, effectiveStats, type CarStats, type UpgradableStat } from '@/game/config/Cars';

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

  readonly mesh: CarMesh;
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
    this.stats = effectiveStats(def, upgrades);
    this.mesh = buildPlayerCar(def);
    this.ctx.scene.add(this.mesh);
  }

  /** Swap the car without rebuilding the manager. */
  setCar(carId: string, upgrades: Partial<Record<UpgradableStat, number>>): void {
    this.carId = carId;
    const def = carById(carId);
    this.stats = effectiveStats(def, upgrades);
    const replacement = buildPlayerCar(def);
    replacement.position.copy(this.mesh.position);
    this.ctx.scene.remove(this.mesh);
    disposeGroup(this.mesh);
    (this as { mesh: CarMesh }).mesh = replacement;
    this.ctx.scene.add(replacement);
  }

  get currentCarId(): string {
    return this.carId;
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
    this.integrateVertical(dt);
    this.pose(dt);
  }

  private integrateSpeed(dt: number, distance: number): void {
    const km = distance / 1000;
    const ceiling = Math.min(
      (SPEED.baseMax + km * SPEED.maxGainPerKm) * this.stats.topSpeed * this.boostFactor,
      SPEED.absoluteMax,
    );
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
    if (isOnShoulder(this.x)) this.speed -= HANDLING.shoulderDrag * dt;

    this.speed = THREE.MathUtils.clamp(this.speed, SPEED.min, ceiling);
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

    // Tyres bleed lateral velocity. Wet roads bleed less, so the car slides.
    const damping = HANDLING.gripDamping * this.stats.grip * this.gripSurface;
    this.vx -= this.vx * Math.min(1, damping * dt);

    this.x += this.vx * dt;

    // Barriers: hard stop with a bounce, not a wall the car sinks into.
    const limit = barrierLimit() - 1.0;
    if (Math.abs(this.x) > limit) {
      this.x = Math.sign(this.x) * limit;
      this.vx *= -0.28;
      this.speed = Math.max(SPEED.min, this.speed * 0.86);
      this.ctx.bus.emit('player:crash', {
        with: 'barrier',
        speed: this.speed,
        position: this.mesh.position.clone(),
      });
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
    // Roll opposes the turn, yaw follows it — the two together sell a corner.
    this.mesh.rotation.z = -lateralT * HANDLING.maxRoll;
    this.mesh.rotation.y = lateralT * HANDLING.maxYaw * -0.5;
    this.mesh.rotation.x = this.airborne ? THREE.MathUtils.clamp(-this.vy * 0.015, -0.2, 0.2) : 0;

    this.wheelSpin += this.speed * dt * 2.4;
    for (const wheel of this.mesh.userData.wheels) wheel.rotation.x = this.wheelSpin;

    this.mesh.userData.brakeLights.emissiveIntensity = this.input.brake ? 3.4 : 0.32;

    const glow = this.mesh.userData.glow;
    if (glow) {
      const mat = glow.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.clamp((this.speedFraction - 0.42) * 0.7, 0, 0.5);
    }
  }

  /** Headlight intensity, raised at night and in storms by the world systems. */
  setHeadlights(intensity: number): void {
    for (const spot of this.mesh.userData.headlights) spot.intensity = intensity;
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
    this.mesh.position.set(0, 0, 0);
    this.mesh.rotation.set(0, 0, 0);
  }

  dispose(): void {
    this.ctx.scene.remove(this.mesh);
    disposeGroup(this.mesh);
  }
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const mat = o.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}
