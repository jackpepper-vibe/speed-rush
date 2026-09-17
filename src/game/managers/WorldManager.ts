import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import type { BiomeId, DayPhase, WeatherId } from '@/core/GameEvents';
import { WORLD } from '@/game/config/Balance';
import {
  BIOME_TINT, DAY_PALETTE, PHASE_ORDER, WEATHER, blendPalette, blendTint, mixHex,
  type BiomeTint, type Palette,
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

/**
 * How far either side of a biome boundary the air is already changing.
 *
 * Matched roughly to how far ahead the props become visible, so the colour of
 * the light and the things standing in it arrive together.
 */
const BIOME_BLEND = 320;

/**
 * Which biome the road is in at a given stretch, as a pure function.
 *
 * This used to be a draw from the seeded stream taken at the moment the car
 * crossed a boundary, which made the route unknowable in advance: nothing
 * could ask what was coming up, because finding out meant advancing the stream
 * and changing the answer. So the scenery could only ever dress the whole
 * visible world as wherever the car was standing — and the first thing you saw
 * of a desert was the instant every palm on the horizon turned into a cactus.
 *
 * A hash of the seed and the index gives the same journey for the same seed
 * while being answerable for any stretch of road, which is what lets the world
 * ahead of you already be the world you are driving into.
 */
export function biomeAtIndex(seed: number, index: number): BiomeId {
  const pick = (i: number): BiomeId => {
    // xorshift-ish mix of the two, so adjacent indices do not correlate.
    let h = (seed ^ (i * 0x9e3779b9)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return BIOMES[h % BIOMES.length];
  };

  const here = pick(index);
  // Never twice running: the change is the point. Resolved by looking at the
  // previous index rather than by remembering what was returned last, so the
  // function stays pure.
  if (index > 0 && here === pick(index - 1)) {
    return BIOMES[(BIOMES.indexOf(here) + 1) % BIOMES.length];
  }
  return here;
}
const WEATHERS: readonly WeatherId[] = ['clear', 'rain', 'storm', 'fog'];

export class WorldManager implements Manager {
  readonly name = 'world';

  private biome: BiomeId = 'coast';
  private weather: WeatherId = 'clear';
  private phase: DayPhase = 'day';

  private biomeIndex = -1;
  /**
   * Seed the route is derived from.
   *
   * Captured from the run-start cue rather than drawn from the shared stream,
   * so asking what biome is four hundred units ahead consumes nothing and
   * cannot change the answer to the same question asked again.
   */
  private routeSeed = 0;
  private weatherIndex = -1;

  /** Tunnel state, in absolute distance. */
  private tunnelStart = Number.POSITIVE_INFINITY;
  private tunnelEnd = Number.POSITIVE_INFINITY;
  private inTunnel = false;

  private weatherIntensity = 0;

  /**
   * Pinned conditions, for captures that have to be comparable.
   *
   * Biome, weather and time of day are all functions of distance, which is
   * exactly what makes a run reproducible — and exactly what makes two captures
   * taken for art direction incomparable, since reaching the pose at all moves
   * you through the schedule. Pinning them is the difference between judging a
   * change and judging the weather. Never set in play.
   */
  private pinned: { biome?: BiomeId; weather?: WeatherId; phase?: DayPhase } | null = null;
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
    // The route is a function of the seed, so it has to be told the seed.
    this.ctx.bus.on('run:start', ({ seed }) => {
      this.routeSeed = seed >>> 0;
      this.biomeIndex = -1;
    });
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

  /** Force conditions and hold them. Pass null to hand control back. */
  pin(conditions: { biome?: BiomeId; weather?: WeatherId; phase?: DayPhase } | null): void {
    this.pinned = conditions;
    if (!conditions) return;

    if (conditions.biome && conditions.biome !== this.biome) {
      const from = this.biome;
      this.biome = conditions.biome;
      this.ctx.bus.emit('biome:change', { from, to: this.biome, distance: 0 });
    }
    if (conditions.weather) {
      this.weather = conditions.weather;
      this.weatherIntensity = conditions.weather === 'clear' ? 0 : 0.8;
    }
    if (conditions.phase) this.phase = conditions.phase;
    this.inTunnel = false;
    this.tunnelStart = Number.POSITIVE_INFINITY;
    this.tunnelEnd = Number.POSITIVE_INFINITY;
  }

  update(_dt: number, _speed: number, distance: number): void {
    if (!this.pinned) {
      this.updateBiome(distance);
      this.updateWeather(distance);
      this.updateDayPhase(distance);
      this.updateTunnel(distance);
    }
    this.applyLook(distance);
  }

  /**
   * The biome at any stretch of road, pinned conditions included.
   *
   * Public because the scenery needs to dress the road ahead of the car as the
   * road ahead rather than as where the car is standing.
   */
  biomeAtDistance(distance: number): BiomeId {
    if (this.pinned?.biome) return this.pinned.biome;
    return biomeAtIndex(this.routeSeed, Math.floor(distance / WORLD.biomeLength));
  }

  private updateBiome(distance: number): void {
    const index = Math.floor(distance / WORLD.biomeLength);
    if (index === this.biomeIndex) return;

    const previous = this.biome;
    this.biomeIndex = index;
    this.biome = biomeAtIndex(this.routeSeed, index);

    if (this.biome !== previous) {
      this.ctx.bus.emit('biome:change', { from: previous, to: this.biome, distance });
      this.scheduleTunnel(distance);
    }
  }

  /** Biome tint at this distance, eased across the approach to a boundary. */
  private blendedTint(distance: number): BiomeTint {
    const here = BIOME_TINT[this.biomeAtDistance(distance)];
    if (this.pinned?.biome) return here;

    const into = distance - Math.floor(distance / WORLD.biomeLength) * WORLD.biomeLength;
    const remaining = WORLD.biomeLength - into;

    // Half the blend happens either side of the line, so the crossing itself
    // is the midpoint of a change already well under way.
    let neighbour = distance;
    let raw: number;
    if (into < BIOME_BLEND) {
      neighbour = distance - BIOME_BLEND - 1;
      raw = 0.5 - (into / BIOME_BLEND) * 0.5;
    } else if (remaining < BIOME_BLEND) {
      neighbour = distance + BIOME_BLEND + 1;
      raw = 0.5 - (remaining / BIOME_BLEND) * 0.5;
    } else {
      return here;
    }

    const other = BIOME_TINT[this.biomeAtDistance(neighbour)];
    const t = raw * raw * (3 - 2 * raw);
    return blendTint(here, other, t);
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
    // A pinned phase sits at its own palette entry rather than wherever the
    // distance happened to land, so the light is the phase itself and not a
    // crossfade halfway into the next one.
    //
    // Not +0.5. Position `i` on this scale is pure phase `i` and `i+1` is pure
    // phase `i+1`, so the middle of a slot is a 50/50 blend of two phases, not
    // the settled look of one. Pinning 'day' with the half added lit the scene
    // halfway to dusk — sun 2.8 instead of 3.6, fog an orange 0xc06a50 instead
    // of a pale blue 0x9fc4e8 — while `state()` still reported 'day', so every
    // reference capture was scored against a phase it was not in.
    const cycle = (distance % WORLD.dayCycleLength) / WORLD.dayCycleLength;
    const scaled = this.pinned?.phase
      ? PHASE_ORDER.indexOf(this.pinned.phase)
      : cycle * PHASE_ORDER.length;
    const slot = Math.min(Math.floor(scaled), PHASE_ORDER.length - 1);
    const frac = scaled - slot;

    const from = DAY_PALETTE[PHASE_ORDER[slot]];
    const to = DAY_PALETTE[PHASE_ORDER[(slot + 1) % PHASE_ORDER.length]];
    // Ease so the middle of a phase holds and the handover is quick.
    const t = frac * frac * (3 - 2 * frac);
    const palette: Palette = blendPalette(from, to, t);

    /*
     * The biome's tint, crossfaded across the boundary.
     *
     * Fog colour, horizon tint and the colour of the ground all belong to the
     * biome, and switching them on the frame the car crosses a line changes
     * the entire screen at once — which is the half of the biome pop that the
     * scenery fix cannot touch, because it is not made of props. The scenery
     * ahead already belongs to where you are going; the air should too.
     *
     * A boundary is a place, not an event, so the blend is a function of how
     * far into the biome the car is rather than a timer started by a cue.
     */
    const tint = this.inTunnel ? BIOME_TINT.tunnel : this.blendedTint(distance);
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
      // Weather thickens the cover on top of the hour's own. A storm is
      // overcast by definition, and a clear sky at noon still has some cloud
      // in it — an empty one reads as a rendering budget rather than a day.
      clouds: Math.min(1, palette.clouds + (weather.cloudCover ?? 0) * intensity),
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
