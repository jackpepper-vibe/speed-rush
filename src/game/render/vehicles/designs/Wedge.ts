import * as THREE from 'three';
import { curve } from '../Curve';
import type { BodySpec, QuadContext } from '../BodyShell';
import { planarUv } from '../BodyShell';
import type { DesignContext, VehicleDesign } from '../Design';
import { exhaust, mirrors, plate, rectLamp } from '../Parts';
import { SURF, withTex, type Surface } from '../Surfaces';
import { ATLAS } from '../VehicleAtlas';
import { fourWheels, stationZ } from './common';

/**
 * The eighties wedge: a nose that almost touches the road, a line that rises
 * straight back to a flat, wide rear deck, strakes running along the doors
 * into the rear intakes, and a tail that is one black louvred grille with the
 * lamps glowing through it. The shape the original arcade racers were built
 * around.
 */

const L = 4.52;
const zAt = (t: number): number => stationZ(L, t);
const DECK = { t0: 0.73, t1: 0.95, halfWidth: 0.62 };
const louvres: Surface = withTex(SURF.paintSatin, ATLAS.louvres, 'wedge-louvres');
const strakes: Surface = withTex(SURF.paintSatin, ATLAS.louvres, 'wedge-strakes');

function paintOut(q: QuadContext): Surface | null {
  if (q.part === 'nose') {
    if (q.y > 0.26 && q.y < 0.36) return SURF.grille;
    if (q.y < 0.24) return SURF.trimSatin;
    return null;
  }
  if (q.part === 'tail') {
    if (q.y < 0.34) return SURF.trimSatin;
    return null;
  }
  // Strakes along the doors, leading into the rear intakes.
  if (q.piece === 'side' && q.t > 0.46 && q.t < 0.72 && q.y > 0.34 && q.y < 0.64) return strakes;
  if (q.piece === 'top' && q.t > DECK.t0 && q.t < DECK.t1 && Math.abs(q.x) < DECK.halfWidth) return louvres;
  return null;
}

/** Deck louvres run across the car; door strakes run along it. */
function uvAt(p: THREE.Vector3, s: Surface): readonly [number, number] {
  if (s === strakes) return planarUv('z', 'y', zAt(0.46), zAt(0.72), 0.34, 0.64)(p, s);
  return planarUv('x', 'z', -DECK.halfWidth, DECK.halfWidth, zAt(DECK.t1), zAt(DECK.t0))(p, s);
}

export const WEDGE: VehicleDesign = {
  id: 'wedge',
  metallic: true,

  body(paint): BodySpec {
    return {
      length: L,
      frontAxle: 0.2,
      rearAxle: 0.765,
      track: 1.56,
      rearTrack: 1.68,
      frontWheel: { radius: 0.325, width: 0.24, rim: 0.64, style: 'star5', finish: SURF.rimSilver, caliper: null },
      rearWheel: { radius: 0.34, width: 0.3, rim: 0.64, style: 'star5', finish: SURF.rimSilver, caliper: null },
      archClearance: 0.04,
      flare: 0.02,
      rails: {
        rocker: curve([0, 0.24], [0.06, 0.19], [0.14, 0.15], [0.3, 0.14], [0.72, 0.14], [0.88, 0.18], [0.96, 0.24], [1, 0.3]),
        belt: curve([0, 0.44], [0.05, 0.5], [0.2, 0.6], [0.4, 0.7], [0.6, 0.79], [0.75, 0.86], [0.9, 0.88], [1, 0.86]),
        top: curve([0, 0.42], [0.06, 0.49], [0.2, 0.58], [0.34, 0.65], [0.7, 0.9], [0.9, 0.915], [1, 0.9]),
        halfWidth: curve([0, 0.78], [0.05, 0.86], [0.15, 0.9], [0.4, 0.92], [0.62, 0.98], [0.76, 1.0], [0.92, 0.99], [1, 0.97]),
        shoulderInset: curve([0, 0.08], [0.5, 0.06], [1, 0.05]),
      },
      shoulderRadius: 0.04,
      sideBulge: 0.004,
      tuck: 0.06,
      nose: { bulge: 0.02, fillet: 0.04 },
      tail: { bulge: 0.012, fillet: 0.03 },
      greenhouse: {
        start: 0.34,
        end: 0.72,
        roofStart: 0.47,
        roofEnd: 0.58,
        roof: curve([0.34, 0.64], [0.4, 0.88], [0.47, 1.1], [0.53, 1.13], [0.58, 1.11], [0.66, 0.99], [0.72, 0.89]),
        roofHalfWidth: curve([0.34, 0.74], [0.47, 0.6], [0.58, 0.6], [0.72, 0.72]),
        baseInset: 0.9,
        cornerRadius: 0.05,
        crown: 0.02,
        bPillar: null,
        sideGlassEnd: 0.61,
        pillar: paint,
        roofSurface: paint,
        rearSurface: SURF.glass,
      },
      paint,
      paintOut,
      uvAt,
    };
  },

  details(ctx: DesignContext): void {
    const { b, shell, hero } = ctx;
    fourWheels(ctx);

    // The tail: one louvred grille across the whole width, lamps behind it.
    const ty = 0.66;
    rectLamp(b, 0, ty, shell.tailZ(0, ty), 1.62, 0.21, SURF.tailLouvre, SURF.trimSatin, 1, { corner: 0.02, curve: 0.03, mirror: false });
    plate(b, 0.46, shell.tailZ(0, 0.46), ctx.plate, 1, 0.52, 0.11);
    for (const x of [0.36, 0.48]) {
      ctx.exhausts.push(...exhaust(b, x, 0.27, shell.tailZ(x, 0.27) - 0.02, 0.034, 0.12, SURF.chrome, hero));
    }

    // Pop-up headlamps, closed: just the slim indicators and parking lamps.
    const hy = 0.4;
    rectLamp(b, 0.62, hy, shell.noseZ(0.62, hy) + 0.01, 0.26, 0.05, SURF.amberMarker, SURF.trimSatin, -1, { corner: 0.015 });
    rectLamp(b, 0.32, hy, shell.noseZ(0.32, hy) + 0.01, 0.2, 0.05, SURF.headSquare, SURF.trimSatin, -1, { corner: 0.015 });
    ctx.headlamps.push(new THREE.Vector3(0.5, hy, shell.noseZ(0.5, hy)), new THREE.Vector3(-0.5, hy, shell.noseZ(0.5, hy)));

    // Mirrors mounted high on the A-pillars, as the originals had them.
    const mt = 0.42;
    const s = shell.shoulderAt(mt);
    mirrors(b, s.x - 0.1, s.y + 0.1, zAt(mt), ctx.paint, hero);
  },
};
