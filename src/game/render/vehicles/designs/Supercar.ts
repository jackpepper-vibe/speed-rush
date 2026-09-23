import * as THREE from 'three';
import { curve } from '../Curve';
import type { BodySpec, QuadContext } from '../BodyShell';
import type { DesignContext, VehicleDesign } from '../Design';
import { exhaust, mirrors, place, plate, rectLamp, roundedBox } from '../Parts';
import { SURF, type Surface } from '../Surfaces';
import { capInsert, diffuserFins, fourWheels, stationZ } from './common';

/**
 * A modern mid-engined supercar: cab-forward, the windscreen almost over the
 * front wheels, huge intakes gouged into the flanks ahead of the rear wheels,
 * a glass engine cover behind the cabin, and a tail that is mostly holes —
 * arrow-shaped LED lamps at the corners, a black mesh between them, a carbon
 * diffuser under that and four pipes stacked in the middle.
 */

const L = 4.52;
const zAt = (t: number): number => stationZ(L, t);

function paintOut(q: QuadContext): Surface | null {
  if (q.part === 'tail' && q.y < 0.4) return SURF.carbon;
  // Side intakes and a carbon sill.
  if (q.piece === 'side' && q.t > 0.54 && q.t < 0.69 && q.y > 0.3 && q.y < 0.62) return SURF.cavity;
  if (q.piece === 'rocker') return SURF.carbon;
  return null;
}

export const SUPERCAR: VehicleDesign = {
  id: 'supercar',
  metallic: true,

  body(paint): BodySpec {
    return {
      length: L,
      frontAxle: 0.2,
      rearAxle: 0.78,
      track: 1.66,
      rearTrack: 1.62,
      frontWheel: { radius: 0.335, width: 0.25, rim: 0.74, style: 'mesh10', finish: SURF.rimDark, caliper: 0xf0c020 },
      rearWheel: { radius: 0.345, width: 0.31, rim: 0.74, style: 'mesh10', finish: SURF.rimDark, caliper: 0xf0c020 },
      archClearance: 0.035,
      flare: 0.035,
      rails: {
        rocker: curve([0, 0.2], [0.06, 0.15], [0.14, 0.12], [0.3, 0.12], [0.72, 0.12], [0.88, 0.16], [0.96, 0.22], [1, 0.3]),
        belt: curve([0, 0.44], [0.05, 0.52], [0.18, 0.66], [0.3, 0.7], [0.45, 0.72], [0.62, 0.8], [0.78, 0.88], [0.9, 0.87], [1, 0.84]),
        top: curve([0, 0.42], [0.06, 0.52], [0.18, 0.6], [0.29, 0.64], [0.74, 0.94], [0.9, 0.93], [0.97, 0.94], [1, 0.9]),
        halfWidth: curve([0, 0.8], [0.05, 0.9], [0.18, 0.96], [0.36, 0.93], [0.52, 0.93], [0.7, 0.99], [0.82, 0.99], [0.94, 0.96], [1, 0.9]),
        shoulderInset: curve([0, 0.08], [0.3, 0.06], [0.7, 0.08], [1, 0.06]),
      },
      shoulderRadius: 0.035,
      sideBulge: 0.004,
      tuck: 0.07,
      nose: { bulge: 0.015, fillet: 0.035 },
      tail: { bulge: 0.012, fillet: 0.03 },
      greenhouse: {
        start: 0.29,
        end: 0.75,
        roofStart: 0.44,
        roofEnd: 0.54,
        roof: curve([0.29, 0.63], [0.36, 0.9], [0.44, 1.13], [0.5, 1.16], [0.54, 1.15], [0.64, 1.04], [0.75, 0.93]),
        roofHalfWidth: curve([0.29, 0.74], [0.44, 0.52], [0.54, 0.52], [0.75, 0.66]),
        baseInset: 0.88,
        cornerRadius: 0.05,
        crown: 0.02,
        bPillar: null,
        sideGlassEnd: 0.6,
        pillar: SURF.trimGloss,
        roofSurface: paint,
        rearSurface: SURF.trimGloss,
      },
      paint,
      paintOut,
    };
  },

  details(ctx: DesignContext): void {
    const { b, shell, hero } = ctx;
    fourWheels(ctx);

    // Black mesh between the lamps, over the carbon.
    capInsert(ctx, 'tail', { x: 0, y: 0.57, halfW: 0.46, halfH: 0.155, nx: 8, ny: 8 }, SURF.grille);
    // Arrow LEDs at the corners.
    const ly = 0.8;
    rectLamp(b, 0.66, ly, shell.tailZ(0.66, ly), 0.36, 0.14, SURF.tailY, SURF.trimGloss, 1, { corner: 0.02, curve: 0.02 });
    plate(b, 0.58, shell.tailZ(0, 0.58), ctx.plate, 1, 0.48, 0.1);
    // Four pipes stacked in the middle of the diffuser.
    for (const x of [0.09, 0.24]) {
      ctx.exhausts.push(...exhaust(b, x, 0.44, shell.tailZ(x, 0.44) - 0.03, 0.042, 0.1, SURF.brushed, hero));
    }
    diffuserFins(ctx, [0.36, 0.56, 0.76], 0.11, 0.24);
    // A carbon lip spoiler along the top of the tail.
    const lipT = 0.985;
    b.addGeometry(roundedBox(1.6, 0.03, 0.14, 0.012, 1), place(0, shell.topAt(0, lipT) + 0.03, zAt(lipT), -0.2), SURF.carbon);

    // Two big intakes either side of a sharp central blade.
    capInsert(ctx, 'nose', { x: 0.47, y: 0.29, halfW: 0.2, halfH: 0.06, nx: 6, ny: 5 }, SURF.grille, { mirror: true });

    const hy = 0.52;
    const hx = 0.7;
    rectLamp(b, hx, hy, shell.noseZ(hx, hy) + 0.05, 0.3, 0.06, SURF.headModern, SURF.trimGloss, -1, { corner: 0.02, tilt: 0.4 });
    ctx.headlamps.push(new THREE.Vector3(hx, hy, shell.noseZ(hx, hy)), new THREE.Vector3(-hx, hy, shell.noseZ(hx, hy)));

    const mt = 0.33;
    const s = shell.shoulderAt(mt);
    mirrors(b, s.x - 0.02, s.y + 0.08, zAt(mt), ctx.paint, hero);
  },
};
