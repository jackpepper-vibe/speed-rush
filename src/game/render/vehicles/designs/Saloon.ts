import * as THREE from 'three';
import { curve } from '../Curve';
import type { BodySpec, QuadContext, RimStyle } from '../BodyShell';
import type { DesignContext, VehicleDesign } from '../Design';
import { bar, exhaust, mirrors, plate, rectLamp } from '../Parts';
import { SURF, type Surface } from '../Surfaces';
import { capInsert, fourWheels } from './common';

/**
 * Everyday cars: the family the traffic is drawn from.
 *
 * A saloon, a coupe, an SUV and a people carrier are one construction with
 * different proportions — a lower body with a bonnet and a boot, and a
 * glasshouse standing on it — so they are one parametric design here rather
 * than four hand-built ones. What distinguishes them from behind, which is
 * the only angle traffic is seen from, is the height of the roof, how far
 * back it runs, how the tail lamps sit and how much black plastic there is.
 */

export interface SaloonParams {
  id: string;
  length: number;
  width: number;
  frontAxle: number;
  rearAxle: number;
  wheelRadius: number;
  wheelWidth: number;
  rim: RimStyle;
  /** Sill height between the arches. */
  ride: number;
  /** Top of the nose, the scuttle, the boot lid and the tail edge. */
  noseH: number;
  hoodH: number;
  deckH: number;
  tailH: number;
  roofH: number;
  /** Greenhouse stations, as t along the car. */
  screenBase: number;
  roofStart: number;
  roofEnd: number;
  glassEnd: number;
  bPillar: number | null;
  sideGlassEnd: number;
  roofHalfWidth: number;
  tailLamp: 'cluster' | 'slim' | 'vertical';
  /** Black plastic cladding along the sills and arches: SUVs, vans. */
  cladding: boolean;
  roofRails: boolean;
}

export function makeSaloon(p: SaloonParams): VehicleDesign {
  const hw = p.width / 2;
  const L = p.length;
  const zAt = (t: number): number => -L / 2 + t * L;

  const paintOut = (q: QuadContext): Surface | null => {
    if (q.part === 'tail') {
      if (q.y < p.ride + 0.16) return SURF.trimSatin;
      return null;
    }
    if (p.cladding && (q.piece === 'rocker' || (q.piece === 'side' && q.y < p.ride + 0.12))) return SURF.trimSatin;
    return null;
  };

  return {
    id: p.id,
    metallic: true,
    body(paint): BodySpec {
      return {
        length: L,
        frontAxle: p.frontAxle,
        rearAxle: p.rearAxle,
        track: p.width - p.wheelWidth - 0.06,
        rearTrack: p.width - p.wheelWidth - 0.06,
        frontWheel: { radius: p.wheelRadius, width: p.wheelWidth, rim: 0.62, style: p.rim, finish: SURF.rimSilver, caliper: null },
        rearWheel: { radius: p.wheelRadius, width: p.wheelWidth, rim: 0.62, style: p.rim, finish: SURF.rimSilver, caliper: null },
        archClearance: 0.05,
        flare: 0.012,
        rails: {
          rocker: curve([0, p.ride + 0.18], [0.07, p.ride + 0.09], [0.15, p.ride + 0.03], [0.3, p.ride], [0.72, p.ride],
            [0.86, p.ride + 0.04], [0.95, p.ride + 0.12], [1, p.ride + 0.2]),
          belt: curve([0, p.noseH - 0.03], [0.04, p.noseH + 0.04], [0.12, p.noseH + (p.hoodH - p.noseH) * 0.55],
            [p.screenBase, p.hoodH + 0.01], [(p.screenBase + p.glassEnd) / 2, (p.hoodH + p.deckH) / 2 + 0.02],
            [p.glassEnd, p.deckH], [0.95, p.deckH - 0.005], [1, p.tailH]),
          top: curve([0, p.noseH - 0.06], [0.05, p.noseH + 0.03], [0.14, p.noseH + (p.hoodH - p.noseH) * 0.6],
            [p.screenBase, p.hoodH], [p.glassEnd, p.deckH], [0.95, p.deckH + 0.005], [1, p.tailH - 0.01]),
          halfWidth: curve([0, hw * 0.8], [0.04, hw * 0.93], [0.12, hw * 0.985], [0.3, hw], [0.75, hw], [0.9, hw * 0.985],
            [0.97, hw * 0.95], [1, hw * 0.9]),
          shoulderInset: curve([0, 0.12], [0.15, 0.085], [0.85, 0.085], [1, 0.11]),
        },
        shoulderRadius: 0.06,
        sideBulge: 0.01,
        tuck: 0.05,
        nose: { bulge: 0.05, fillet: 0.06 },
        tail: { bulge: 0.03, fillet: 0.05 },
        greenhouse: {
          start: p.screenBase,
          end: p.glassEnd,
          roofStart: p.roofStart,
          roofEnd: p.roofEnd,
          roof: curve(
            [p.screenBase, p.hoodH - 0.02],
            [p.screenBase + (p.roofStart - p.screenBase) * 0.45, p.hoodH + (p.roofH - p.hoodH) * 0.62],
            [p.roofStart, p.roofH - 0.012],
            [(p.roofStart + p.roofEnd) / 2, p.roofH],
            [p.roofEnd, p.roofH - 0.02],
            [p.roofEnd + (p.glassEnd - p.roofEnd) * 0.55, p.deckH + (p.roofH - p.deckH) * 0.45],
            [p.glassEnd, p.deckH - 0.02],
          ),
          roofHalfWidth: curve([p.screenBase, hw * 0.9], [p.roofStart, p.roofHalfWidth], [p.roofEnd, p.roofHalfWidth], [p.glassEnd, hw * 0.88]),
          baseInset: 0.93,
          cornerRadius: 0.07,
          crown: 0.035,
          bPillar: p.bPillar,
          sideGlassEnd: p.sideGlassEnd,
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

      // Tail lamps, plate and a small exhaust.
      if (p.tailLamp === 'vertical') {
        // Tall lamps up the corners of the tail panel, the way a tailgate
        // leaves room for them.
        const y = p.tailH - 0.2;
        const x = hw - 0.14;
        rectLamp(b, x, y, shell.tailZ(x, y), 0.15, 0.3, SURF.tailCluster, SURF.trimGloss, 1, { corner: 0.03 });
      } else if (p.tailLamp === 'slim') {
        const y = p.deckH - 0.1;
        const x = hw - 0.3;
        rectLamp(b, x, y, shell.tailZ(x, y), 0.46, 0.08, SURF.tailSlim, SURF.trimGloss, 1, { corner: 0.02, curve: 0.02 });
      } else {
        const y = p.deckH - 0.13;
        const x = hw - 0.24;
        rectLamp(b, x, y, shell.tailZ(x, y), 0.34, 0.15, SURF.tailCluster, SURF.trimGloss, 1, { corner: 0.03, curve: 0.015 });
      }
      const plateY = p.ride + 0.3;
      plate(b, plateY, shell.tailZ(0, plateY), ctx.plate, 1, 0.5, 0.11);
      if (!ctx.far) {
        ctx.exhausts.push(...exhaust(b, -hw * 0.55, p.ride + 0.08, shell.tailZ(hw * 0.55, p.ride + 0.08) - 0.06, 0.028, 0.14, SURF.brushed, hero, false));
      }

      // Grille between the headlamps, from just above the sill.
      const grilleLow = p.ride + 0.21;
      const grilleHigh = p.noseH - 0.12;
      capInsert(ctx, 'nose', {
        x: 0, y: (grilleLow + grilleHigh) / 2, halfW: hw * 0.44, halfH: (grilleHigh - grilleLow) / 2, nx: 8, ny: 6,
      }, SURF.grille);

      // Headlamps.
      const hy = p.noseH - 0.1;
      const hx = hw - 0.22;
      rectLamp(b, hx, hy, shell.noseZ(hx, hy) + 0.01, 0.3, 0.11, SURF.headSquare, SURF.trimGloss, -1, { corner: 0.03 });
      ctx.headlamps.push(new THREE.Vector3(hx, hy, shell.noseZ(hx, hy)), new THREE.Vector3(-hx, hy, shell.noseZ(hx, hy)));

      // Mirrors at the base of the A-pillar.
      const mt = p.screenBase + 0.035;
      const s = shell.shoulderAt(mt);
      if (!ctx.far) mirrors(b, s.x - 0.06, s.y + 0.03, zAt(mt), ctx.paint, hero);

      if (p.roofRails) {
        for (const side of [1, -1]) {
          const x = side * (p.roofHalfWidth - 0.04);
          bar(b, [
            new THREE.Vector3(x, p.roofH + 0.01, zAt(p.roofStart + 0.02)),
            new THREE.Vector3(x, p.roofH + 0.05, zAt(p.roofStart + 0.06)),
            new THREE.Vector3(x, p.roofH + 0.05, zAt(p.roofEnd - 0.04)),
            new THREE.Vector3(x, p.roofH + 0.0, zAt(p.roofEnd + 0.01)),
          ], 0.018, SURF.brushed, hero);
        }
      }
    },
  };
}

export const SEDAN = makeSaloon({
  id: 'sedan', length: 4.72, width: 1.84, frontAxle: 0.2, rearAxle: 0.77,
  wheelRadius: 0.33, wheelWidth: 0.22, rim: 'star5', ride: 0.24,
  noseH: 0.74, hoodH: 0.92, deckH: 1.0, tailH: 0.97, roofH: 1.45,
  screenBase: 0.31, roofStart: 0.44, roofEnd: 0.69, glassEnd: 0.82, bPillar: 0.56, sideGlassEnd: 0.76,
  roofHalfWidth: 0.66, tailLamp: 'cluster', cladding: false, roofRails: false,
});

export const COUPE = makeSaloon({
  id: 'coupe', length: 4.55, width: 1.82, frontAxle: 0.2, rearAxle: 0.76,
  wheelRadius: 0.33, wheelWidth: 0.23, rim: 'mesh10', ride: 0.22,
  noseH: 0.7, hoodH: 0.88, deckH: 0.97, tailH: 0.95, roofH: 1.34,
  screenBase: 0.33, roofStart: 0.47, roofEnd: 0.63, glassEnd: 0.84, bPillar: null, sideGlassEnd: 0.7,
  roofHalfWidth: 0.62, tailLamp: 'slim', cladding: false, roofRails: false,
});

export const SUV = makeSaloon({
  id: 'suv', length: 4.78, width: 1.94, frontAxle: 0.19, rearAxle: 0.78,
  wheelRadius: 0.38, wheelWidth: 0.25, rim: 'split12', ride: 0.42,
  noseH: 0.98, hoodH: 1.12, deckH: 1.14, tailH: 1.1, roofH: 1.78,
  screenBase: 0.3, roofStart: 0.4, roofEnd: 0.9, glassEnd: 0.975, bPillar: 0.55, sideGlassEnd: 0.9,
  roofHalfWidth: 0.74, tailLamp: 'vertical', cladding: true, roofRails: true,
});

export const VAN = makeSaloon({
  id: 'van', length: 5.1, width: 1.98, frontAxle: 0.14, rearAxle: 0.74,
  wheelRadius: 0.36, wheelWidth: 0.23, rim: 'steel', ride: 0.36,
  noseH: 0.98, hoodH: 1.08, deckH: 1.08, tailH: 1.05, roofH: 2.0,
  screenBase: 0.16, roofStart: 0.28, roofEnd: 0.96, glassEnd: 0.99, bPillar: 0.36, sideGlassEnd: 0.97,
  roofHalfWidth: 0.86, tailLamp: 'vertical', cladding: true, roofRails: false,
});
