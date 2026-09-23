import type { BiomeId } from '@/core/GameEvents';
import { ROAD } from '@/game/config/Balance';

/**
 * The shape of the road, as pure functions of distance travelled.
 *
 * Every system that needs to know where the road is — the surface mesh, the
 * barriers, traffic, pickups, scenery — calls these rather than keeping its own
 * idea of the curve. That is what stops a barrier from drifting off the tarmac
 * over a long run, and it lets the probe assert the curve is continuous without
 * rendering anything.
 *
 * Curvature here is visual: the driving surface stays a straight strip in
 * road-space and the whole world is displaced laterally by `curveAt`. Steering
 * therefore behaves identically on a bend and a straight, which is what an
 * arcade racer wants, while the horizon still swings convincingly.
 */

/** Lateral displacement of the road centreline, in world units. */
export function curveAt(distance: number): number {
  const t = distance / ROAD.curveWavelength;
  return (
    Math.sin(t * Math.PI * 2) * ROAD.curveAmplitude * ROAD.curveWavelength * 0.5 +
    Math.sin(t * Math.PI * 2 * 2.37 + 1.1) * ROAD.curveAmplitude * ROAD.curveWavelength * 0.18
  );
}

/** Rate of change of the curve — drives body lean and the steering hint. */
export function curveSlopeAt(distance: number): number {
  const h = 0.5;
  return (curveAt(distance + h) - curveAt(distance - h)) / (2 * h);
}

/** Elevation of the road surface, in world units. */
export function hillAt(distance: number): number {
  const t = distance / ROAD.hillWavelength;
  return (
    Math.sin(t * Math.PI * 2) * ROAD.hillAmplitude +
    Math.sin(t * Math.PI * 2 * 1.73 + 0.6) * ROAD.hillAmplitude * 0.35
  );
}

/**
 * How far the ground rises or falls away from the road, out in the verge.
 *
 * A pure function of absolute distance and lateral offset, for the same reason
 * everything else in this file is: neighbouring segments sample it at the same
 * `u` where they meet, so the terrain is continuous across a seam by
 * construction rather than by being stitched.
 *
 * Flat within `RELIEF_INNER` of the centreline, and that is not a shortcut. The
 * scenery gate proves every prop stands on ground rather than in mid-air, and
 * it does so by placing props at the road's own elevation — so ground that
 * undulated underneath them would put a palm's roots in the air and the gate
 * would be right to say so. Relief starts beyond where anything is planted and
 * ramps in, so the near verge stays honest and the far distance stops being a
 * ruler-straight line drawn across the frame.
 */
const RELIEF_INNER = 96;
const RELIEF_RAMP = 110;

/**
 * Whether the road at a given distance runs along a coast.
 *
 * Injected rather than imported: the ground profile has to know what biome it
 * is in, and `WorldManager` already knows, but this module is underneath it and
 * a cycle here would drag the whole world into the geometry. Set once at
 * composition, the way the car factory takes its level of detail.
 *
 * Distance-keyed rather than a boolean flag, which is what makes the shoreline
 * arrive at the boundary instead of under the camera: `setStart` re-samples
 * relief at each row's own absolute distance every time a strip recycles, so a
 * segment half in the desert and half on the coast gets both profiles and the
 * beach begins exactly where the biome does.
 */
let coastAt: (distance: number) => boolean = () => false;

export function setCoastLookup(fn: (distance: number) => boolean): void {
  coastAt = fn;
}

/**
 * Whether the road at this distance runs along a coast.
 *
 * The same lookup the ground profile uses, exposed so that anything which has
 * to appear only on the coast can be keyed on **its own** stretch of road
 * rather than on the car's. That distinction is the whole reason this exists:
 * a thing switched on by where the camera is arrives all at once, and a thing
 * switched on by where it stands arrives at the boundary and comes to meet you.
 */
export function isCoastAt(distance: number): boolean {
  return coastAt(distance);
}

/**
 * The biome at a distance, for things that dress their own stretch of road —
 * the verge a road segment is laid with, whether it has lamps. Injected for
 * the same reason the coast lookup is.
 */
let biomeLookup: (distance: number) => BiomeId = () => 'coast';

export function setBiomeLookup(fn: (distance: number) => BiomeId): void {
  biomeLookup = fn;
}

export function biomeAt(distance: number): BiomeId {
  return biomeLookup(distance);
}

/** How far the beach falls before it is safely under the water. */
const SHORE_DROP = 9;

/**
 * Where the beach starts falling, and how far it takes to fall.
 *
 * Its own inner radius, not the hills' `RELIEF_INNER`, and that separation is
 * the whole point. Sharing the landward figure put the first sand 96 units out
 * and the waterline at 145, and at a 62° field of view lateral 145 only enters
 * the frame past 300 units ahead — where `FogExp2` at 0.0034 has already taken
 * 65% of it. The sea was built, placed and drawn correctly for ten iterations
 * and never appeared in a single capture: a 2400-wide frame caught it as a
 * turquoise sliver at the extreme right, and the 16:9 frame the game is
 * actually played in caught none of it. Water nobody can see is not water.
 *
 * 24 puts the first sand just outside the railing, and the ramp crosses
 * `SEA_HEIGHT` around 32 — a waterline that enters the frame at roughly its
 * three-quarter width and runs to the vanishing point, which is where the
 * reference's is. The coast's palms reach 30 and so now stand on the slope
 * rather than behind it, which is what a beach palm does; `SceneryManager`
 * samples this function for their footing and drops anything that would wade
 * out past the tide line.
 */
const SHORE_INNER = 24;
const SHORE_RAMP = 22;

/** Amplitude of the swell that runs along the tide line. */
const SHORE_SWELL = 0.8;

/**
 * How far the beach has fallen at this lateral, as a fraction of `SHORE_DROP`.
 *
 * Split out of `groundReliefAt` so the shoreline can be *solved* as well as
 * sampled. Everything that has to stay clear of the water wants to know where
 * the water is, and sampling the relief at one lateral cannot answer that: the
 * profile is a smoothstep, the mesh that draws it interpolates linearly
 * between columns six units apart, and the swell moves the crossing either way
 * as you travel. Three iterations of this loop were spent adding margins to a
 * sampled test and watching boulders stay afloat.
 */
function shoreRamp(lateral: number): number {
  const out = lateral - SHORE_INNER;
  if (out <= 0) return 0;
  const t = Math.min(1, out / SHORE_RAMP);
  return t * t * (3 - 2 * t);
}

/**
 * The lowest the beach ever sits at this lateral, swell included.
 *
 * The worst case rather than the average one: the swell at its trough, which
 * is the moment the tide line reaches furthest inshore. Anything that has to
 * be dry along the *whole* coast rather than at one distance is answered from
 * this rather than from a sample of `groundReliefAt`.
 *
 * Exported as a profile rather than as a solved limit because solving it needs
 * the sea's height and the ground mesh's own lateral columns, and `RoadManager`
 * owns both. It imports this module, so asking for them back would be a cycle.
 */
export function shoreLowestAt(lateral: number): number {
  const ramp = shoreRamp(lateral);
  return -SHORE_DROP * ramp - SHORE_SWELL * (1 - ramp);
}

/** The band over which the beach falls, for anything solving across it. */
export const SHORE_SPAN = [SHORE_INNER, SHORE_INNER + SHORE_RAMP] as const;

export function groundReliefAt(lateral: number, distance: number): number {
  /* Seaward of a coastal road the ground goes down, not up.
   *
   * The hills below are what a horizon needs everywhere else, and they are
   * exactly wrong here — a sea laid over them is pierced by every ridge, which
   * is what the first attempt at this looked like. One side only: water on
   * both sides is a causeway, and the reference is a boulevard with a city
   * behind it.
   */
  if (lateral > 0 && coastAt(distance)) {
    // Eased, so the verge rolls into the beach rather than breaking at a line.
    const ramp = shoreRamp(lateral);
    if (ramp <= 0) return 0;
    // A little swell near the waterline, fading out as the ground submerges.
    const ripple = Math.sin(distance * 0.021 + lateral * 0.013) * SHORE_SWELL * (1 - ramp);
    return -SHORE_DROP * ramp + ripple;
  }

  const out = Math.abs(lateral) - RELIEF_INNER;
  if (out <= 0) return 0;

  // Eased in, so the flat verge does not meet the hills at a crease.
  const t = Math.min(1, out / RELIEF_RAMP);
  const ramp = t * t * (3 - 2 * t);
  // Amplitude grows with distance from the road: low rises near the verge,
  // real hills on the skyline.
  const amplitude = ramp * (3.5 + out * 0.075);

  return amplitude * (
    Math.sin(distance * 0.0123 + lateral * 0.0091) * 0.58 +
    Math.sin(distance * 0.0045 - lateral * 0.0034) * 0.42
  );
}

export function hillSlopeAt(distance: number): number {
  const h = 0.5;
  return (hillAt(distance + h) - hillAt(distance - h)) / (2 * h);
}

/** True when `x` (road-space) is off the tarmac and onto the shoulder. */
export function isOnShoulder(x: number): boolean {
  return Math.abs(x) > ROAD.halfWidth;
}

/** Hard limit past which the barrier stops the car. */
export function barrierLimit(): number {
  return ROAD.halfWidth + ROAD.shoulderWidth;
}

/** Nearest lane index to a road-space x. */
export function laneAt(x: number): number {
  const raw = x / ROAD.laneWidth + (ROAD.laneCount - 1) / 2;
  return Math.max(0, Math.min(ROAD.laneCount - 1, Math.round(raw)));
}
