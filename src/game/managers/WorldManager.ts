import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import type { BiomeId, DayPhase, WeatherId } from '@/core/GameEvents';
import { WORLD } from '@/game/config/Balance';
import {
  BIOME_TINT, DAY_PALETTE, PHASE_ORDER, WEATHER, blendPalette, mixHex, type Palette,
} from '@/game/world/Palettes';
import type { SceneRig } from '@/game/render/SceneRig';
import type { PlayerManager } from './PlayerManager';
import type { PowerupManager } from './PowerupManager';
import type { RoadManager } from './RoadManager';

/**
 * Where you are, when it is, and what the weather is doing.
 *
 * All three run off distance travelled rather than off wall-clock time, so a
 * run is the same journey every time for a given seed and a player who survives
 * longer genuinely sees further into the day. The three axes are independent —
 * a desert at night in the rain is a valid combination and needs no special
 * case — and are composited into one palette that the rig applies.
 *
 * Weather is not only a look. It sets the grip multiplier the player's handling
 * reads, so a storm is something you feel in the steering before you notice it
 * on the windscreen.
 */
const BIOMES: readonly BiomeId[] = ['coast', 'city', 'desert', 'forest'];
const WEATHERS: readonly WeatherId[] = ['clear', 'rain', 'storm', 'fog'];

export class WorldManager implements Manager {
  readonly name = 'world';

  private biome: BiomeId = 'coast';
  private weather: WeatherId = 'clear';
  private phase: DayPhase = 'day';

  private biomeIndex = -1;
  private weatherIndex = -1;

  /** Tunnel state, in absolute distance. */
  private tunnelStart = Number.POSITIVE_INFINITY;
  private tunnelEnd = Number.POSITIVE_INFINITY;
  private inTunnel = false;

  private weatherIntensity = 0;
  private rainSystem: THREE.Points | null = null;
  private rainGeometry: THREE.BufferGeometry | null = null;
  private rainMaterial: THREE.PointsMaterial | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly rig: SceneRig,
    private readonly player: PlayerManager,
    private readonly powerups: PowerupManager,
    private readonly road: RoadManager,
  ) {}

  init(): void {
    this.buildRain();
  }

  /* -------------------------------------------------------------- accessors */

  get currentBiome(): BiomeId {
    return this.biome;
  }

  get currentWeather(): WeatherId {
    return this.weather;
  }

  get currentPhase(): DayPhase {
    return this.phase;
  }

  get isInTunnel(): boolean {
    return this.inTunnel;
  }

  /** Grip multiplier from the current surface, before the car's own stat. */
  get surfaceGrip(): number {
    return WEATHER[this.weather].grip;
  }

  /* ------------------------------------------------------------------ update */

  update(_dt: number, _speed: number, distance: number): void {
    this.updateBiome(distance);
    this.updateWeather(distance);
    this.updateDayPhase(distance);
    this.updateTunnel(distance);
    this.applyLook(distance);
  }

  private updateBiome(distance: number): void {
    const index = Math.floor(distance / WORLD.biomeLength);
    if (index === this.biomeIndex) return;

    const previous = this.biome;
    this.biomeIndex = index;
    // Derived from the seeded stream, so the route is the same journey for a
    // given seed rather than a fresh roll each run.
    const next = BIOMES[(index + this.ctx.rng.int(0, BIOMES.length - 1)) % BIOMES.length];
    // Never repeat a biome back to back — the change is the point.
    this.biome = next === previous ? BIOMES[(BIOMES.indexOf(next) + 1) % BIOMES.length] : next;

    if (this.biome !== previous) {
      this.ctx.bus.emit('biome:change', { from: previous, to: this.biome, distance });
      this.scheduleTunnel(distance);
    }
  }

  private updateWeather(distance: number): void {
    const index = Math.floor(distance / WORLD.weatherInterval);
    if (index === this.weatherIndex) return;

    this.weatherIndex = index;
    const previous = this.weather;
    // Most stretches are clear; weather should be an event, not a constant.
    const next = this.ctx.rng.chance(WORLD.weatherChance)
      ? this.ctx.rng.pick(WEATHERS)
      : 'clear';

    if (next === previous) return;
    this.weather = next;
    this.weatherIntensity = next === 'clear' ? 0 : this.ctx.rng.range(0.6, 1);
    this.ctx.bus.emit('weather:change', {
      from: previous, to: next, intensity: this.weatherIntensity,
    });
  }

  private updateDayPhase(distance: number): void {
    const t = (distance % WORLD.dayCycleLength) / WORLD.dayCycleLength;
    const slot = Math.floor(t * PHASE_ORDER.length);
    const next = PHASE_ORDER[Math.min(slot, PHASE_ORDER.length - 1)];
    if (next === this.phase) return;

    this.phase = next;
    this.ctx.bus.emit('daynight:change', {
      phase: next,
      sunElevation: DAY_PALETTE[next].sunElevation,
    });
  }

  /* ----------------------------------------------------------------- tunnel */

  private scheduleTunnel(distance: number): void {
    if (!this.ctx.rng.chance(WORLD.tunnelChance)) return;
    const start = distance + this.ctx.rng.range(300, 900);
    this.tunnelStart = start;
    this.tunnelEnd = start + this.ctx.rng.range(WORLD.tunnelLengthMin, WORLD.tunnelLengthMax);
  }

  private updateTunnel(distance: number): void {
    const inside = distance >= this.tunnelStart && distance < this.tunnelEnd;
    if (inside === this.inTunnel) return;

    this.inTunnel = inside;
    if (inside) {
      this.ctx.bus.emit('world:tunnel-enter', { length: this.tunnelEnd - this.tunnelStart });
    } else {
      this.ctx.bus.emit('world:tunnel-exit', {});
      this.tunnelStart = Number.POSITIVE_INFINITY;
      this.tunnelEnd = Number.POSITIVE_INFINITY;
    }
  }

  /* ------------------------------------------------------------------- look */

  /**
   * Composite the palette and hand it to the rig.
   *
   * The day phase is crossfaded across its whole slot rather than switched at
   * the boundary, so dusk arrives as a gradual thing. Biome tint and weather
   * are multiplied on top, which is why the three axes need no combinatorial
   * table between them.
   */
  private applyLook(distance: number): void {
    const cycle = (distance % WORLD.dayCycleLength) / WORLD.dayCycleLength;
    const scaled = cycle * PHASE_ORDER.length;
    const slot = Math.min(Math.floor(scaled), PHASE_ORDER.length - 1);
    const frac = scaled - slot;

    const from = DAY_PALETTE[PHASE_ORDER[slot]];
    const to = DAY_PALETTE[PHASE_ORDER[(slot + 1) % PHASE_ORDER.length]];
    // Ease so the middle of a phase holds and the handover is quick.
    const t = frac * frac * (3 - 2 * frac);
    const palette: Palette = blendPalette(from, to, t);

    const biomeKey: BiomeId = this.inTunnel ? 'tunnel' : this.biome;
    const tint = BIOME_TINT[biomeKey];
    const weather = WEATHER[this.weather];
    const intensity = this.weatherIntensity;

    const fogDensity = palette.fogDensity * tint.fogScale *
      (1 + (weather.fogScale - 1) * intensity);

    this.rig.applyLighting({
      sunColor: palette.sunColor,
      sunIntensity: palette.sunIntensity * (1 - (1 - weather.sunScale) * intensity),
      skyTop: mixHex(palette.skyTop, tint.tint, tint.tintStrength * 0.4),
      skyBottom: mixHex(palette.skyBottom, tint.tint, tint.tintStrength * 0.6),
      horizon: mixHex(palette.horizon, tint.tint, tint.tintStrength * 0.5),
      hemiSky: palette.hemiSky,
      hemiGround: mixHex(palette.hemiGround, tint.ground, 0.55),
      hemiIntensity: palette.hemiIntensity,
      fogColor: mixHex(palette.fogColor, tint.tint, tint.tintStrength),
      fogDensity,
      sunElevation: palette.sunElevation,
      exposure: palette.exposure * (1 - (1 - weather.exposureScale) * intensity),
    });

    this.rig.sky.setStars(palette.stars);

    // The ground belongs to the biome, and darkens with the sky along with
    // everything else — a desert floor at midnight is not sand-coloured.
    this.road.setGroundColour(
      mixHex(tint.ground, palette.fogColor, 0.28 + palette.stars * 0.4),
      tint.groundRoughness,
    );

    // Headlights come on for the dark and for bad weather, whichever is worse.
    const lights = Math.max(palette.headlights, weather.rain * intensity * 2.2, this.inTunnel ? 3 : 0);
    this.player.setHeadlights(lights);

    // Bloom lifts at night so the lights actually glow.
    this.rig.setBloom(
      this.rig.quality.bloomStrength * (1 + palette.stars * 0.8),
      0.72,
      0.82 - palette.stars * 0.25,
    );

    this.player.setSurfaceGrip(this.surfaceGrip);

    this.rig.setGrade(
      Math.min(this.player.speedFraction, 1),
      this.powerups.isActive('nitro') ? 1 : 0,
      weather.wet * intensity,
    );

    this.updateRain(weather.rain * intensity);
  }

  /* ------------------------------------------------------------------- rain */

  /**
   * Rain as a single points cloud that follows the camera.
   *
   * Recycled rather than respawned: the particles wrap within a box around the
   * car, so the system costs one buffer update a frame regardless of how long
   * the storm lasts.
   */
  private buildRain(): void {
    const count = 1400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Math.random() * 34;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainMaterial = new THREE.PointsMaterial({
      color: 0xaac4e0,
      size: 0.14,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.rainSystem = new THREE.Points(this.rainGeometry, this.rainMaterial);
    this.rainSystem.frustumCulled = false;
    this.rainSystem.visible = false;
    this.ctx.scene.add(this.rainSystem);
  }

  private updateRain(amount: number): void {
    if (!this.rainSystem || !this.rainGeometry || !this.rainMaterial) return;

    if (amount <= 0.001) {
      this.rainSystem.visible = false;
      return;
    }
    this.rainSystem.visible = true;
    this.rainMaterial.opacity = 0.42 * amount;
    this.rainSystem.position.set(this.player.x, 0, 0);

    const pos = this.rainGeometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const fall = 1.1 + amount * 1.6;
    for (let i = 1; i < arr.length; i += 3) {
      arr[i] -= fall;
      if (arr[i] < 0) arr[i] += 34;
    }
    pos.needsUpdate = true;
  }

  reset(): void {
    this.biome = 'coast';
    this.weather = 'clear';
    this.phase = 'day';
    this.biomeIndex = -1;
    this.weatherIndex = -1;
    this.weatherIntensity = 0;
    this.inTunnel = false;
    this.tunnelStart = Number.POSITIVE_INFINITY;
    this.tunnelEnd = Number.POSITIVE_INFINITY;
    if (this.rainSystem) this.rainSystem.visible = false;
  }

  dispose(): void {
    if (this.rainSystem) this.ctx.scene.remove(this.rainSystem);
    this.rainGeometry?.dispose();
    this.rainMaterial?.dispose();
  }
}
