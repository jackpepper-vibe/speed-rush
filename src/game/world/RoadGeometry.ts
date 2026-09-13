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

export function groundReliefAt(lateral: number, distance: number): number {
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
