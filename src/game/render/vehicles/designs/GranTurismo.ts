import * as THREE from 'three';
import { curve } from '../Curve';
import type { BodySpec, QuadContext } from '../BodyShell';
import type { DesignContext, VehicleDesign } from '../Design';
import { exhaust, mirrors, plate, rectLamp } from '../Parts';
import { SURF, type Surface } from '../Surfaces';
import { capInsert, diffuserFins, fourWheels, stationZ } from './common';

/**
 * A modern grand tourer: long bonnet, cabin set well back, a fastback that
 * runs almost to the tail, and haunches that swell over the rear wheels.
 *
 * From behind it is a full-width light bar over a clean tail, a carbon
 * diffuser and four exhaust tips — the signature of every front-engined GT
 * of the last decade.
 */

const L = 4.62;

function paintOut(q: QuadContext): Surface | null {
  if (q.part === 'tail' && q.y < 0.36) return SURF.carbon;
  if (q.piece === 'rocker') return SURF.carbon;
  // A vent behind each front wheel.
  if (q.piece === 'side' && q.t > 0.27 && q.t < 0.32 && q.y > 0.46 && q.y < 0.56) return SURF.vents;
  return null;
}

export const GRAN_TURISMO: VehicleDesign = {
  id: 'gran-turismo',
  metallic: true,

  body(paint): BodySpec {
    return {
      length: L,
      frontAxle: 0.19,
      rearAxle: 0.765,
      track: 1.62,
      rearTrack: 1.64,
      frontWheel: { radius: 0.345, width: 0.25, rim: 0.72, style: 'split12', finish: SURF.rimDark, caliper: 0xc81818 },
      rearWheel: { radius: 0.35, width: 0.29, rim: 0.72, style: 'split12', finish: SURF.rimDark, caliper: 0xc81818 },
      archClearance: 0.04,
      flare: 0.045,
      rails: {
        rocker: curve([0, 0.3], [0.06, 0.22], [0.14, 0.17], [0.3, 0.16], [0.72, 0.16], [0.88, 0.2], [0.96, 0.26], [1, 0.32]),
        belt: curve([0, 0.58], [0.05, 0.66], [0.14, 0.74], [0.24, 0.79], [0.38, 0.81], [0.55, 0.84], [0.72, 0.9], [0.84, 0.9], [0.95, 0.88], [1, 0.86]),
        top: curve([0, 0.55], [0.06, 0.64], [0.16, 0.72], [0.3, 0.8], [0.37, 0.84], [0.88, 0.9], [0.96, 0.91], [1, 0.88]),
        halfWidth: curve([0, 0.7], [0.05, 0.84], [0.12, 0.92], [0.22, 0.94], [0.4, 0.93], [0.6, 0.95], [0.76, 0.98], [0.9, 0.95], [1, 0.88]),
        shoulderInset: curve([0, 0.1], [0.2, 0.07], [0.5, 0.08], [0.8, 0.07], [1, 0.1]),
      },
      shoulderRadius: 0.07,
      sideBulge: 0.012,
      tuck: 0.07,
      nose: { bulge: 0.06, fillet: 0.07 },
      tail: { bulge: 0.025, fillet: 0.05 },
      greenhouse: {
        start: 0.37,
        end: 0.9,
        roofStart: 0.5,
        roofEnd: 0.62,
        roof: curve([0.37, 0.82], [0.42, 1.05], [0.5, 1.26], [0.56, 1.29], [0.62, 1.27], [0.72, 1.14], [0.82, 0.99], [0.9, 0.88]),
        roofHalfWidth: curve([0.37, 0.78], [0.5, 0.58], [0.62, 0.56], [0.9, 0.7]),
        baseInset: 0.92,
        cornerRadius: 0.08,
        crown: 0.04,
        bPillar: null,
        sideGlassEnd: 0.69,
        pillar: paint,
        roofSurface: paint,
        rearSurface: SURF.glass,
      },
      paint,
      paintOut,
    };
  },

  details(ctx: DesignContext): void {
    const { b, shell, hero } = ctx;
    fourWheels(ctx);

    // Full-width light bar across the tail, with deeper clusters at each end.
    const barY = 0.79;
    rectLamp(b, 0, barY, shell.tailZ(0, barY), 1.3, 0.045, SURF.tailBar, SURF.trimGloss, 1, { corner: 0.02, curve: 0.04, mirror: false });
    const cx = 0.66;
    rectLamp(b, cx, barY - 0.02, shell.tailZ(cx, barY), 0.26, 0.1, SURF.tailSlim, SURF.trimGloss, 1, { corner: 0.03, curve: 0.02 });
    plate(b, 0.52, shell.tailZ(0, 0.52), ctx.plate, 1, 0.5, 0.11);
    for (const x of [0.46, 0.6]) {
      ctx.exhausts.push(...exhaust(b, x, 0.27, shell.tailZ(x, 0.27) - 0.04, 0.038, 0.12, SURF.chrome, hero));
    }
    diffuserFins(ctx, [0.14, 0.3], 0.06, 0.2);

    // A wide, low grille with a rounded top edge, and long projector
    // headlamps in the upper corners of the nose, both following its curve.
    capInsert(ctx, 'nose', { x: 0, y: 0.405, halfW: 0.36, halfH: 0.075, nx: 2.6, ny: 5 }, SURF.grille);
    const hy = 0.482;
    const hx = 0.53;
    capInsert(ctx, 'nose', { x: hx, y: hy, halfW: 0.13, halfH: 0.036, nx: 5, ny: 4 }, SURF.headModern, { mirror: true });
    ctx.headlamps.push(new THREE.Vector3(hx, hy, shell.noseZ(hx, hy)), new THREE.Vector3(-hx, hy, shell.noseZ(hx, hy)));

    const mt = 0.4;
    const s = shell.shoulderAt(mt);
    mirrors(b, s.x - 0.07, s.y + 0.05, stationZ(L, mt), ctx.paint, hero);
  },
};
