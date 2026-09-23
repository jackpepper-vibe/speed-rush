import * as THREE from 'three';
import { curve } from '../Curve';
import type { BodySpec, QuadContext } from '../BodyShell';
import type { DesignContext, VehicleDesign } from '../Design';
import { bar, exhaust, mirrors, panel, place, plate, rectLamp, roundLamp, roundedBox } from '../Parts';
import { SURF, type Surface } from '../Surfaces';
import { capInsert, fourWheels, stationZ } from './common';

/**
 * American muscle: a long flat bonnet with a scoop, a short fastback cabin,
 * slab sides with a kick over the rear wheels, and twin stripes nose to tail.
 *
 * The tail is the signature — a black panel carrying three vertical lamps a
 * side, a chrome bar under it and two big pipes — and it is the whole of what
 * a chase camera ever needs to recognise one.
 */

const L = 4.84;

function paintOut(q: QuadContext): Surface | null {
  if (q.part === 'tail' && q.y < 0.33) return SURF.trimSatin;
  return null;
}

export const MUSCLE: VehicleDesign = {
  id: 'muscle',
  metallic: false,
  stripes: { inner: 0.09, outer: 0.27 },

  body(paint): BodySpec {
    return {
      length: L,
      frontAxle: 0.18,
      rearAxle: 0.76,
      track: 1.64,
      rearTrack: 1.66,
      frontWheel: { radius: 0.355, width: 0.26, rim: 0.66, style: 'star5', finish: SURF.rimSilver, caliper: 0x202020 },
      rearWheel: { radius: 0.365, width: 0.31, rim: 0.66, style: 'star5', finish: SURF.rimSilver, caliper: 0x202020 },
      archClearance: 0.05,
      flare: 0.03,
      rails: {
        rocker: curve([0, 0.36], [0.05, 0.28], [0.13, 0.22], [0.3, 0.2], [0.72, 0.2], [0.88, 0.24], [0.96, 0.3], [1, 0.36]),
        belt: curve([0, 0.8], [0.04, 0.85], [0.15, 0.87], [0.4, 0.88], [0.6, 0.89], [0.7, 0.93], [0.82, 0.94], [0.95, 0.93], [1, 0.92]),
        top: curve([0, 0.78], [0.05, 0.84], [0.2, 0.87], [0.38, 0.9], [0.42, 0.92], [0.84, 0.96], [0.96, 0.99], [1, 0.97]),
        halfWidth: curve([0, 0.86], [0.04, 0.93], [0.12, 0.95], [0.4, 0.95], [0.62, 0.96], [0.76, 0.99], [0.9, 0.98], [1, 0.95]),
        shoulderInset: curve([0, 0.06], [0.5, 0.05], [1, 0.06]),
      },
      shoulderRadius: 0.035,
      sideBulge: 0.005,
      tuck: 0.05,
      nose: { bulge: 0.02, fillet: 0.035 },
      tail: { bulge: 0.015, fillet: 0.035 },
      greenhouse: {
        start: 0.43,
        end: 0.84,
        roofStart: 0.54,
        roofEnd: 0.66,
        roof: curve([0.43, 0.9], [0.48, 1.12], [0.54, 1.33], [0.6, 1.35], [0.66, 1.32], [0.75, 1.15], [0.84, 0.97]),
        roofHalfWidth: curve([0.43, 0.82], [0.54, 0.64], [0.66, 0.62], [0.84, 0.76]),
        baseInset: 0.94,
        cornerRadius: 0.06,
        crown: 0.03,
        bPillar: null,
        sideGlassEnd: 0.7,
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

    // The black tail panel, and three vertical lamps a side set into it.
    const y = 0.765;
    b.addGeometry(panel(1.78, 0.26, 0.035, 8), place(0, y, shell.tailZ(0, y) + 0.004), SURF.trimGloss);
    rectLamp(b, 0.56, y, shell.tailZ(0.56, y), 0.46, 0.16, SURF.tailTriple, SURF.chrome, 1, { corner: 0.02 });
    plate(b, 0.5, shell.tailZ(0, 0.5), ctx.plate, 1, 0.5, 0.12);
    // Chrome bar across the bottom of the tail, two big pipes under it.
    const by = 0.42;
    bar(b, [
      new THREE.Vector3(-0.9, by, shell.tailZ(0.85, by) - 0.06),
      new THREE.Vector3(-0.6, by, shell.tailZ(0.6, by) + 0.03),
      new THREE.Vector3(0.6, by, shell.tailZ(0.6, by) + 0.03),
      new THREE.Vector3(0.9, by, shell.tailZ(0.85, by) - 0.06),
    ], 0.03, SURF.chrome, hero);
    ctx.exhausts.push(...exhaust(b, 0.52, 0.27, shell.tailZ(0.52, 0.27) - 0.02, 0.05, 0.16, SURF.chrome, hero));

    // Bonnet scoop.
    const st = 0.24;
    b.addGeometry(roundedBox(0.5, 0.08, 0.6, 0.03, hero ? 2 : 1), place(0, shell.topAt(0, st) + 0.025, stationZ(L, st)), ctx.paint);
    b.addGeometry(roundedBox(0.4, 0.05, 0.02, 0.01, 1), place(0, shell.topAt(0, st) + 0.035, stationZ(L, st) - 0.3), SURF.cavity);

    // A full-width grille with the round headlamps set in it, as the
    // originals had.
    capInsert(ctx, 'nose', { x: 0, y: 0.6, halfW: 0.68, halfH: 0.115, nx: 10, ny: 8 }, SURF.grille);
    for (const x of [0.72, 0.52]) {
      roundLamp(b, x, 0.6, shell.noseZ(x, 0.6) - 0.03, 0.075, SURF.headRound, SURF.chrome, -1, hero);
    }
    ctx.headlamps.push(new THREE.Vector3(0.62, 0.6, shell.noseZ(0.62, 0.6)), new THREE.Vector3(-0.62, 0.6, shell.noseZ(0.62, 0.6)));

    const mt = 0.46;
    const s = shell.shoulderAt(mt);
    mirrors(b, s.x - 0.06, s.y + 0.04, stationZ(L, mt), SURF.chrome, hero);
  },
};
