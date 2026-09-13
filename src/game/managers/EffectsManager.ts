import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import { Random } from '@/core/Random';
import { makeGlowTexture, makeSmokeTexture } from '@/game/render/RoadTextures';
import { ParticleField } from '@/game/render/ParticleField';
import type { PlayerManager } from './PlayerManager';
import type { SceneRig } from '@/game/render/SceneRig';

/**
 * Everything the car throws off: flame, sparks, smoke.
 *
 * Driven entirely from cues already on the bus. Nothing here reaches into the
 * player to ask whether it is drifting — the drift cue already carries an
 * intensity, the land cue already carries an impact, the crash cue already
 * carries a speed, and an effect that reads those is an effect that cannot
 * disagree with the simulation about whether it should be running.
 *
 * A note on the frame of reference. The player's mesh sits at z = 0 and the
 * world scrolls past it, so a particle left behind the car is not one that
 * stays where it was born — it is one launched backwards at road speed. Every
 * emitter here adds that component, which is why smoke laid down at 300 km/h
 * streams away properly instead of hanging off the back bumper.
 */

export type EffectKind = 'flame' | 'sparks' | 'smoke';

/** Pool ceilings. Sized to the worst case each effect can produce at once. */
const SPARK_CAPACITY = 600;
const SMOKE_CAPACITY = 700;

/** Emission rates while a continuous effect is running, in particles/second. */
const DRIFT_SMOKE_RATE = 260;
const DRIFT_SPARK_RATE = 45;

export class EffectsManager implements Manager {
  readonly name = 'effects';

  private readonly sparks: ParticleField;
  private readonly smoke: ParticleField;

  /**
   * The afterburner, as two nested cones on each pipe.
   *
   * A single cone reads as an orange traffic cone bolted to the bumper. Real
   * flame has a pale core inside a coloured envelope, and two additively
   * blended shells — a small hot one inside a longer cool one — is the cheapest
   * thing that carries that read at this size on screen.
   */
  private readonly flames: THREE.Mesh[] = [];
  private readonly flameRoot = new THREE.Group();
  private readonly flameCore: THREE.MeshBasicMaterial;
  private readonly flameEnvelope: THREE.MeshBasicMaterial;

  /** 0..1, eased rather than switched, so the flame lights and dies. */
  private flameLevel = 0;
  private flameTarget = 0;
  private flicker = 0;

  /** Fractional particles carried between frames, so low rates still emit. */
  private smokeDebt = 0;
  private sparkDebt = 0;
  /** Drift intensity from the most recent cue, decayed when the cue stops. */
  private driftIntensity = 0;
  private sinceDriftCue = 0;

  private speed = 0;

  private readonly visible: Record<EffectKind, boolean> = {
    flame: true, sparks: true, smoke: true,
  };

  /**
   * A random stream of this manager's own, deliberately not the context's.
   *
   * The simulation's stream decides where traffic spawns and what the weather
   * does, and it is deterministic because exactly the same number of values is
   * drawn from it for a given seed. How many sparks a crash throws depends on
   * the frame rate and on how long the player held the boost, so drawing them
   * from that stream would make the same seed produce a different world
   * depending on the machine it ran on — the same trap the car factory takes a
   * caller-supplied roll to avoid.
   */
  private readonly rng = new Random(0x5eed_c0de);

  /* Owned outright, so teardown releases them rather than orphaning two
   * canvas textures on the GPU. */
  private readonly sparkMap: THREE.Texture;
  private readonly smokeMap: THREE.Texture;

  /* Scratch, so emitting never allocates. */
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly tint = new THREE.Color();

  constructor(
    private readonly ctx: GameContext,
    private readonly player: PlayerManager,
    private readonly rig: SceneRig,
  ) {
    this.sparkMap = makeGlowTexture();
    this.smokeMap = makeSmokeTexture();
    this.sparks = new ParticleField({
      capacity: SPARK_CAPACITY,
      map: this.sparkMap,
      blending: THREE.AdditiveBlending,
      drag: 1.4,
      gravity: 22,
    });
    this.smoke = new ParticleField({
      capacity: SMOKE_CAPACITY,
      map: this.smokeMap,
      // Normal blending, not additive. Smoke occludes what is behind it; the
      // additive version glowed, which at night turned a locked wheel into a
      // light source.
      blending: THREE.NormalBlending,
      drag: 2.2,
      gravity: -1.4,
    });

    this.flameCore = new THREE.MeshBasicMaterial({
      color: 0xdcf0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    });
    this.flameEnvelope = new THREE.MeshBasicMaterial({
      color: 0xff7a1e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    });
  }

  init(): void {
    this.ctx.scene.add(this.sparks.points);
    this.ctx.scene.add(this.smoke.points);
    this.attachFlames();

    const bus = this.ctx.bus;
    bus.on('powerup:activate', ({ id }) => {
      if (id === 'nitro') this.flameTarget = 1;
    });
    bus.on('powerup:expire', ({ id }) => {
      if (id === 'nitro') this.flameTarget = 0;
    });
    bus.on('player:drift', ({ intensity }) => {
      this.driftIntensity = Math.min(1, Math.abs(intensity));
      this.sinceDriftCue = 0;
    });
    bus.on('player:land', ({ impact }) => this.burstLanding(impact));
    bus.on('player:crash', ({ speed }) => this.burstCrash(speed));
    bus.on('run:start', () => this.reset());
  }

  /**
   * Hang the flame cones off the exhaust anchors the factory recorded.
   *
   * Re-run whenever the car changes, because the pipes belong to the mesh that
   * was just thrown away — a flame parented to a disposed group renders
   * nowhere and reports no error.
   */
  private attachFlames(): void {
    for (const mesh of this.flames) mesh.removeFromParent();
    this.flames.length = 0;
    this.flameRoot.removeFromParent();

    const anchors = this.player.mesh.userData.exhausts ?? [];
    this.player.mesh.add(this.flameRoot);

    for (const anchor of anchors) {
      for (const [scale, material] of [
        [1, this.flameEnvelope],
        [0.52, this.flameCore],
      ] as const) {
        const geo = new THREE.ConeGeometry(0.15 * scale, 2.1 * scale, 12, 1, true);
        // Cones are built pointing up. Rotated to point back down the road, and
        // shifted so the mouth sits at the pipe rather than around it.
        geo.rotateX(Math.PI / 2);
        geo.translate(0, 0, (2.1 * scale) / 2);
        const cone = new THREE.Mesh(geo, material);
        cone.position.copy(anchor.position);
        cone.renderOrder = 3;
        this.flameRoot.add(cone);
        this.flames.push(cone);
      }
    }
  }

  /** Called when the player's car is swapped: the anchors are on the new mesh. */
  rebind(): void {
    this.attachFlames();
  }

  update(dt: number, speed: number): void {
    this.speed = speed;

    /* The drift cue fires while a slide is running and simply stops when it
     * ends, so the smoke has to decay on its own rather than wait for an
     * event that never comes. */
    this.sinceDriftCue += dt;
    if (this.sinceDriftCue > 0.25) {
      this.driftIntensity = Math.max(0, this.driftIntensity - dt * 3.2);
    }

    this.updateFlame(dt);
    if (this.driftIntensity > 0.02) this.emitDrift(dt);

    this.sparks.update(dt);
    this.smoke.update(dt);
  }

  private updateFlame(dt: number): void {
    // Lights fast, dies slower — an afterburner cutting out instantly reads as
    // a mesh being hidden.
    const rate = this.flameTarget > this.flameLevel ? 12 : 4.5;
    this.flameLevel += (this.flameTarget - this.flameLevel) * Math.min(1, rate * dt);

    const on = this.flameLevel > 0.01 && this.visible.flame;
    this.flameRoot.visible = on;
    if (!on) return;

    this.flicker += dt * 47;
    // Two incommensurate frequencies: a single sine reads as a pulse, which is
    // a mechanism rather than combustion.
    const jitter = 0.82 + Math.sin(this.flicker) * 0.1 + Math.sin(this.flicker * 2.7) * 0.08;
    const length = this.flameLevel * jitter;

    for (const cone of this.flames) cone.scale.set(1, 1, Math.max(0.05, length));
    this.flameEnvelope.opacity = this.flameLevel * 0.95;
    this.flameCore.opacity = this.flameLevel * 1.0;

    // Sparks out of the pipe with the flame: the tail of an afterburner is
    // unburnt fuel, and the flecks are most of why it reads as violent.
    this.sparkDebt += dt * 60 * this.flameLevel;
    while (this.sparkDebt >= 1) {
      this.sparkDebt -= 1;
      if (!this.visible.sparks) break;
      const anchor = this.flames[Math.floor(this.rng.next() * this.flames.length)];
      if (!anchor) break;
      this.pos.set(
        this.player.x + anchor.position.x,
        this.player.y + anchor.position.y,
        anchor.position.z + 0.8,
      );
      this.vel.set(
        (this.rng.next() - 0.5) * 1.6,
        (this.rng.next() - 0.5) * 1.2,
        6 + this.rng.next() * 10 + this.speed * 0.04,
      );
      this.tint.setHSL(0.06 + this.rng.next() * 0.04, 1, 0.6);
      this.sparks.emit({
        position: this.pos, velocity: this.vel,
        life: 0.18 + this.rng.next() * 0.22,
        size: 0.1 + this.rng.next() * 0.09,
        sizeGrowth: 0.4,
        colour: this.tint,
        opacity: 0.9,
      });
    }
  }

  /** Smoke and scraped sparks off the rear tyres, while the car is sliding. */
  private emitDrift(dt: number): void {
    const rear = 1.5;
    const track = 0.85;

    this.smokeDebt += dt * DRIFT_SMOKE_RATE * this.driftIntensity;
    while (this.smokeDebt >= 1) {
      this.smokeDebt -= 1;
      if (!this.visible.smoke) break;
      const side = this.rng.next() < 0.5 ? -1 : 1;
      this.pos.set(
        this.player.x + side * track + (this.rng.next() - 0.5) * 0.3,
        0.22 + this.rng.next() * 0.14,
        rear + (this.rng.next() - 0.5) * 0.4,
      );
      this.vel.set(
        side * (0.6 + this.rng.next() * 1.4),
        0.5 + this.rng.next() * 0.9,
        3 + this.speed * 0.055,
      );
      /* Warm grey rather than white, and darker than it looks written down.
       *
       * These values are linear: the pass this ends up in is tone mapped and
       * converted to sRGB downstream, so a 0.6 here arrives on screen at around
       * 0.8 and a cloud of it reads as a bank of fog rolling off the back of the
       * car. Tyre smoke is burnt rubber, and it belongs closer to mid grey. */
      const shade = 0.3 + this.rng.next() * 0.16;
      this.tint.setRGB(shade, shade * 0.97, shade * 0.92);
      this.smoke.emit({
        position: this.pos, velocity: this.vel,
        life: 0.5 + this.rng.next() * 0.55,
        size: 0.16 + this.rng.next() * 0.16,
        sizeGrowth: 2.6,
        colour: this.tint,
        opacity: 0.26 + this.driftIntensity * 0.2,
      });
    }

    this.sparkDebt += dt * DRIFT_SPARK_RATE * this.driftIntensity;
    while (this.sparkDebt >= 1) {
      this.sparkDebt -= 1;
      if (!this.visible.sparks) break;
      const side = this.rng.next() < 0.5 ? -1 : 1;
      this.pos.set(this.player.x + side * track, 0.1, rear);
      this.vel.set(
        side * (1 + this.rng.next() * 3),
        1.4 + this.rng.next() * 2.6,
        4 + this.rng.next() * 6 + this.speed * 0.03,
      );
      this.tint.setHSL(0.09, 1, 0.66);
      this.sparks.emit({
        position: this.pos, velocity: this.vel,
        life: 0.22 + this.rng.next() * 0.3,
        size: 0.08 + this.rng.next() * 0.07,
        sizeGrowth: 0.5,
        colour: this.tint,
        opacity: 0.95,
      });
    }
  }

  private burstLanding(impact: number): void {
    const strength = THREE.MathUtils.clamp(impact / 12, 0.2, 1);
    if (this.visible.smoke) {
      for (let i = 0; i < Math.round(18 + strength * 34); i++) {
        const side = this.rng.next() < 0.5 ? -1 : 1;
        this.pos.set(
          this.player.x + side * (0.7 + this.rng.next() * 0.6),
          0.15,
          (this.rng.next() - 0.4) * 3,
        );
        this.vel.set(
          side * (1.5 + this.rng.next() * 3) * strength,
          0.8 + this.rng.next() * 1.6,
          2 + this.speed * 0.05,
        );
        const shade = 0.3 + this.rng.next() * 0.2;
        this.tint.setRGB(shade, shade * 0.95, shade * 0.88);
        this.smoke.emit({
          position: this.pos, velocity: this.vel,
          life: 0.45 + this.rng.next() * 0.45,
          size: 0.15 + this.rng.next() * 0.2,
          sizeGrowth: 2.6,
          colour: this.tint,
          opacity: 0.22 + strength * 0.18,
        });
      }
    }
    if (this.visible.sparks) {
      for (let i = 0; i < Math.round(strength * 40); i++) {
        this.pos.set(this.player.x + (this.rng.next() - 0.5) * 2, 0.1, 1 + this.rng.next());
        this.vel.set(
          (this.rng.next() - 0.5) * 7,
          2 + this.rng.next() * 4,
          3 + this.rng.next() * 7,
        );
        this.tint.setHSL(0.1, 0.9, 0.6);
        this.sparks.emit({
          position: this.pos, velocity: this.vel,
          life: 0.25 + this.rng.next() * 0.35,
          size: 0.09, sizeGrowth: 0.4, colour: this.tint, opacity: 0.9,
        });
      }
    }
  }

  private burstCrash(speed: number): void {
    const strength = THREE.MathUtils.clamp(speed / 90, 0.3, 1);
    this.rig.addShake(strength * 0.4);

    if (this.visible.sparks) {
      for (let i = 0; i < Math.round(80 + strength * 200); i++) {
        this.pos.set(
          this.player.x + (this.rng.next() - 0.5) * 2.2,
          0.3 + this.rng.next() * 0.9,
          -1.8 + this.rng.next() * 0.8,
        );
        this.vel.set(
          (this.rng.next() - 0.5) * 16 * strength,
          1 + this.rng.next() * 9 * strength,
          -4 - this.rng.next() * 10 * strength,
        );
        this.tint.setHSL(0.04 + this.rng.next() * 0.08, 1, 0.55 + this.rng.next() * 0.3);
        this.sparks.emit({
          position: this.pos, velocity: this.vel,
          life: 0.3 + this.rng.next() * 0.7,
          size: 0.1 + this.rng.next() * 0.12,
          sizeGrowth: 0.35, colour: this.tint, opacity: 1,
        });
      }
    }
    if (this.visible.smoke) {
      for (let i = 0; i < Math.round(30 + strength * 50); i++) {
        this.pos.set(
          this.player.x + (this.rng.next() - 0.5) * 2.4,
          0.4 + this.rng.next() * 1.2,
          -1.6 + this.rng.next(),
        );
        this.vel.set(
          (this.rng.next() - 0.5) * 4,
          1.2 + this.rng.next() * 2.4,
          -1 + this.rng.next() * 3,
        );
        const shade = 0.16 + this.rng.next() * 0.14;
        this.tint.setRGB(shade, shade * 0.93, shade * 0.88);
        this.smoke.emit({
          position: this.pos, velocity: this.vel,
          life: 0.8 + this.rng.next() * 0.9,
          size: 0.25 + this.rng.next() * 0.3,
          sizeGrowth: 3.2, colour: this.tint, opacity: 0.42,
        });
      }
    }
  }

  /* ------------------------------------------------------------- test seams */

  /**
   * Fire one effect on demand, at full strength.
   *
   * Exists for the gate. Asserting that sparks appear by waiting for a crash
   * makes the check a test of the collision system as much as of the effect,
   * and a flaky one — it fails when the traffic happens to be elsewhere.
   */
  burst(kind: EffectKind): void {
    if (kind === 'sparks') this.burstCrash(90);
    else if (kind === 'smoke') this.burstLanding(12);
    else this.flameTarget = 1;
  }

  /** Hide one effect so its contribution can be measured as a difference. */
  setVisible(kind: EffectKind, visible: boolean): void {
    this.visible[kind] = visible;
    if (kind === 'flame') this.flameRoot.visible = visible && this.flameLevel > 0.01;
    if (kind === 'sparks') this.sparks.points.visible = visible;
    if (kind === 'smoke') this.smoke.points.visible = visible;
  }

  /** Hold the drift emitters open, for a measurement that needs them running. */
  forceDrift(intensity: number): void {
    this.driftIntensity = THREE.MathUtils.clamp(intensity, 0, 1);
    this.sinceDriftCue = 0;
  }

  snapshot(): { sparks: number; smoke: number; flame: number } {
    return {
      sparks: this.sparks.liveCount,
      smoke: this.smoke.liveCount,
      flame: this.flameLevel,
    };
  }

  reset(): void {
    this.sparks.clear();
    this.smoke.clear();
    this.flameLevel = 0;
    this.flameTarget = 0;
    this.driftIntensity = 0;
    this.smokeDebt = 0;
    this.sparkDebt = 0;
  }

  dispose(): void {
    this.sparks.points.removeFromParent();
    this.smoke.points.removeFromParent();
    this.sparks.dispose();
    this.smoke.dispose();
    for (const cone of this.flames) cone.geometry.dispose();
    this.flames.length = 0;
    this.flameRoot.removeFromParent();
    this.flameCore.dispose();
    this.flameEnvelope.dispose();
    this.sparkMap.dispose();
    this.smokeMap.dispose();
  }
}
