import * as THREE from 'three';
import { curve } from '../Curve';
import type { BodySpec, QuadContext } from '../BodyShell';
import type { DesignContext, VehicleDesign } from '../Design';
import { exhaust, mirrors, place, plate, rectLamp, roundedBox, wing } from '../Parts';
import { SURF, type Surface } from '../Surfaces';
import { capInsert, diffuserFins, fourWheels, stationZ } from './common';

/**
 * A road-legal prototype: separate front wings standing proud of a low,
 * waisted body, a narrow teardrop canopy, a shark fin down the spine to a
 * swan-neck wing, and a tail that is a full-width light blade over an enormous
 * diffuser with one pipe in the middle of it.
 *
 * Livery comes from the garage: a single broad stripe down the centreline in
 * the car's trim colour.
 */

const L = 4.76;
const zAt = (t: number): number => stationZ(L, t);

function paintOut(q: QuadContext): Surface | null {
  if (q.part === 'tail') {
    if (q.y < 0.46) return SURF.carbon;
    if (q.y < 0.7) return SURF.grille;
    return null;
  }
  if (q.piece === 'rocker') return SURF.carbon;
  // The waist between the wheels is carbon below the belt.
  if (q.piece === 'side' && q.t > 0.3 && q.t < 0.66 && q.y < 0.42) return SURF.carbon;
  return null;
}

export const HYPERCAR: VehicleDesign = {
  id: 'hypercar',
  metallic: false,
  stripes: { inner: -0.01, outer: 0.13 },

  body(paint): BodySpec {
    return {
      length: L,
      frontAxle: 0.2,
      rearAxle: 0.76,
      track: 1.72,
      rearTrack: 1.7,
      frontWheel: { radius: 0.345, width: 0.27, rim: 0.76, style: 'aero', finish: SURF.rimDark, caliper: 0xd81830 },
      rearWheel: { radius: 0.36, width: 0.34, rim: 0.76, style: 'aero', finish: SURF.rimDark, caliper: 0xd81830 },
      archClearance: 0.03,
      flare: 0.07,
      rails: {
        rocker: curve([0, 0.18], [0.06, 0.13], [0.14, 0.11], [0.3, 0.11], [0.72, 0.11], [0.88, 0.14], [0.96, 0.2], [1, 0.28]),
        // Front wings rise over the wheels; the body dips between them.
        belt: curve([0, 0.4], [0.07, 0.56], [0.2, 0.78], [0.28, 0.74], [0.4, 0.64], [0.55, 0.68], [0.7, 0.84], [0.8, 0.86], [0.92, 0.82], [1, 0.78]),
        top: curve([0, 0.38], [0.08, 0.44], [0.2, 0.5], [0.3, 0.55], [0.7, 0.84], [0.92, 0.82], [1, 0.8]),
        halfWidth: curve([0, 0.8], [0.06, 0.9], [0.2, 1.0], [0.3, 0.96], [0.46, 0.88], [0.62, 0.94], [0.76, 1.0], [0.9, 0.99], [1, 0.94]),
        shoulderInset: curve([0, 0.12], [0.2, 0.08], [0.45, 0.1], [0.76, 0.08], [1, 0.1]),
      },
      shoulderRadius: 0.05,
      sideBulge: 0.004,
      tuck: 0.06,
      nose: { bulge: 0.02, fillet: 0.035 },
      tail: { bulge: 0.01, fillet: 0.03 },
      greenhouse: {
        start: 0.31,
        end: 0.8,
        roofStart: 0.43,
        roofEnd: 0.55,
        roof: curve([0.31, 0.55], [0.37, 0.84], [0.43, 1.06], [0.49, 1.1], [0.55, 1.08], [0.66, 0.97], [0.8, 0.83]),
        roofHalfWidth: curve([0.31, 0.62], [0.43, 0.4], [0.55, 0.38], [0.8, 0.3]),
        baseInset: 0.78,
        cornerRadius: 0.1,
        crown: 0.03,
        bPillar: null,
        sideGlassEnd: 0.62,
        pillar: paint,
        roofSurface: paint,
        rearSurface: paint,
      },
      paint,
      paintOut,
    };
  },

  details(ctx: DesignContext): void {
    const { b, shell, hero } = ctx;
    fourWheels(ctx);

    // Light blade across the full width of the tail.
    const ly = 0.74;
    rectLamp(b, 0, ly, shell.tailZ(0, ly), 1.74, 0.035, SURF.tailBar, SURF.trimGloss, 1, { corner: 0.012, curve: 0.05, mirror: false });
    plate(b, 0.55, shell.tailZ(0, 0.55), ctx.plate, 1, 0.46, 0.1);
    // One big pipe high in the middle.
    ctx.exhausts.push(...exhaust(b, 0, 0.6, shell.tailZ(0, 0.6) - 0.02, 0.075, 0.12, SURF.brushed, hero, false));
    // Diffuser: a deep carbon tray with tall fins.
    diffuserFins(ctx, [0.16, 0.36, 0.56, 0.76], 0.17, 0.3);

    // Shark fin down the spine, into the wing.
    const finT0 = 0.56;
    const finT1 = 0.97;
    const finH = 0.14;
    const finZ = (zAt(finT0) + zAt(finT1)) / 2;
    b.addGeometry(
      roundedBox(0.018, finH, zAt(finT1) - zAt(finT0), 0.006, 1),
      place(0, shell.topAt(0, 0.8) + finH * 0.4, finZ, -0.12),
      ctx.paint,
    );
    // Swan-neck wing, hung from above.
    const wingT = 0.95;
    wing(b, {
      span: 1.84, chord: 0.36, y: 1.22, z: zAt(wingT), deckY: shell.topAt(0.4, wingT),
      plate: 0.3, upright: 0.42, surface: SURF.carbon, plates: SURF.carbon, swan: true, aoa: 0.1,
    });

    // One central intake low in the nose, under the splitter's blade.
    capInsert(ctx, 'nose', { x: 0, y: 0.27, halfW: 0.3, halfH: 0.065, nx: 6, ny: 5 }, SURF.grille);

    const hy = 0.48;
    const hx = 0.72;
    rectLamp(b, hx, hy, shell.noseZ(hx, hy) + 0.05, 0.22, 0.05, SURF.headModern, SURF.trimGloss, -1, { corner: 0.02, tilt: 0.5 });
    ctx.headlamps.push(new THREE.Vector3(hx, hy, shell.noseZ(hx, hy)), new THREE.Vector3(-hx, hy, shell.noseZ(hx, hy)));

    const mt = 0.36;
    const s = shell.shoulderAt(mt);
    mirrors(b, s.x - 0.12, s.y + 0.12, zAt(mt), SURF.carbon, hero);
  },
};
