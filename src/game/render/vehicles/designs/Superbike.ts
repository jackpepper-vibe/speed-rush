import * as THREE from 'three';
import { curve } from '../Curve';
import type { BodySpec, QuadContext, WheelSpec } from '../BodyShell';
import type { DesignContext, VehicleDesign } from '../Design';
import { bar, beam, bikeWheel, cylZ, ellipsoid, mirrors, pair, place, roundedBox, sphere, strut } from '../Parts';
import { SURF, surface, type Surface } from '../Surfaces';
import { makeScreenGlass } from '../VehicleMaterial';
import { capInsert, stationZ } from './common';

/**
 * A litre superbike, and its rider, tucked in.
 *
 * The bodywork — nose, fairing, tank, seat and tail — is one lofted shell, the
 * same as a car's, only a third as wide. The wheel arches the loft cuts over
 * each axle are what a bike needs too: with the wheels on the centreline they
 * lift the fairing's lower edge over the front tyre and sweep it back down into
 * the belly pan behind it. Everything else is parts: two wheels that read the
 * same from either side, gold forks, clip-ons, a side-can exhaust, a swingarm,
 * a plate on a hanger — and the rider, who from a chase camera is most of what
 * a bike is: a helmet over the screen, a back, elbows out, knees at the tank.
 *
 * The whole machine leans through a corner; see `Vehicle.setLean`.
 */

const L = 1.9;
const zAt = (t: number): number => stationZ(L, t);

const FRONT: WheelSpec = { radius: 0.3, width: 0.12, rim: 0.6, style: 'star5', finish: SURF.rimGold, caliper: null };
const REAR: WheelSpec = { radius: 0.31, width: 0.19, rim: 0.58, style: 'star5', finish: SURF.rimGold, caliper: null };

/** Where the rider's seat is on the loft. */
const SEAT = { t0: 0.52, t1: 0.68 } as const;

// White leathers: over a black bike, a rider in black read from behind as one
// dark shape.
const leathers = surface('leathers', { color: 0xe6e6e2, roughness: 0.45, clearcoat: 0.35 });
const seatVinyl = surface('bike-seat', { color: 0x121316, roughness: 0.72 });

function paintOut(q: QuadContext): Surface | null {
  if (q.piece === 'top' && q.t > SEAT.t0 && q.t < SEAT.t1) return seatVinyl;
  // Vents in the flanks of the fairing, and a gloss-black belly pan.
  if (q.piece === 'side' && q.t > 0.24 && q.t < 0.33 && q.y > 0.52 && q.y < 0.68) return SURF.vents;
  if (q.part === 'body' && q.y < 0.34 && q.t > 0.26 && q.t < 0.54) return SURF.trimGloss;
  // The underside of the tail, round the lamp.
  if (q.part === 'tail' && q.y < 0.79) return SURF.trimGloss;
  return null;
}

export const SUPERBIKE: VehicleDesign = {
  id: 'superbike',
  metallic: false,
  stripes: { inner: 0.028, outer: 0.042 },

  body(paint): BodySpec {
    return {
      length: L,
      frontAxle: 0.1,
      rearAxle: 0.84,
      track: 0,
      rearTrack: 0,
      frontWheel: FRONT,
      rearWheel: REAR,
      archClearance: 0.035,
      flare: 0,
      rails: {
        rocker: curve([0, 0.64], [0.1, 0.63], [0.2, 0.45], [0.3, 0.26], [0.46, 0.24], [0.5, 0.3], [0.54, 0.52], [0.58, 0.66], [0.7, 0.7], [0.9, 0.72], [1, 0.76]),
        belt: curve([0, 0.75], [0.07, 0.85], [0.15, 0.93], [0.3, 0.93], [0.4, 0.96], [0.48, 0.9], [0.53, 0.8], [0.62, 0.79], [0.72, 0.82], [0.85, 0.9], [1, 0.83]),
        top: curve([0, 0.79], [0.07, 0.89], [0.15, 0.98], [0.22, 1.02], [0.3, 1.0], [0.4, 1.03], [0.48, 0.96], [0.53, 0.84], [0.62, 0.82], [0.72, 0.86], [0.85, 0.95], [0.94, 0.93], [1, 0.87]),
        halfWidth: curve([0, 0.14], [0.05, 0.2], [0.14, 0.31], [0.26, 0.34], [0.36, 0.3], [0.45, 0.22], [0.52, 0.18], [0.6, 0.16], [0.72, 0.15], [0.85, 0.12], [0.95, 0.08], [1, 0.06]),
        shoulderInset: curve([0, 0.03], [1, 0.02]),
      },
      shoulderRadius: 0.06,
      sideBulge: 0.012,
      tuck: 0.04,
      nose: { bulge: 0.05, fillet: 0.03 },
      tail: { bulge: 0.01, fillet: 0.02 },
      paint,
      paintOut,
    };
  },

  details(ctx: DesignContext): void {
    const { b, shell, hero, far } = ctx;
    const seg = hero ? 16 : 8;
    const frontHub = new THREE.Vector3(0, FRONT.radius, shell.frontAxleZ);
    const rearHub = new THREE.Vector3(0, REAR.radius, shell.rearAxleZ);
    bikeWheel(b, FRONT, frontHub, true, 'twin', hero, far);
    bikeWheel(b, REAR, rearHub, false, 'left', hero, far);

    // Lamps: twin slits in the nose, a slim bar in the tail.
    const hx = 0.062;
    const hy = 0.715;
    capInsert(ctx, 'nose', { x: hx, y: hy, halfW: 0.048, halfH: 0.03, nx: 4, ny: 3 }, SURF.headModern, { mirror: true });
    ctx.headlamps.push(new THREE.Vector3(hx, hy, shell.noseZ(hx, hy)), new THREE.Vector3(-hx, hy, shell.noseZ(hx, hy)));
    capInsert(ctx, 'tail', { x: 0, y: 0.815, halfW: 0.04, halfH: 0.022, nx: 4, ny: 4 }, SURF.tailSlim);

    // Forks, raked back from the front axle into the fairing.
    const rake = 0.42;
    const axis = new THREE.Vector3(0, Math.cos(rake), Math.sin(rake));
    const along = (d: number, x: number): THREE.Vector3 => frontHub.clone().addScaledVector(axis, d).setX(x);
    for (const x of [0.1, -0.1]) {
      strut(b, along(0.02, x), along(0.3, x), 0.033, 0.031, SURF.trimGloss, seg);
      strut(b, along(0.3, x), along(0.62, x), 0.027, 0.027, SURF.rimGold, seg);
    }
    if (!far) {
      // Front mudguard hugging the tyre, from ahead of the axle over the top.
      const guard: THREE.Vector3[][] = [];
      const gr = FRONT.radius + 0.025;
      for (let i = 0; i <= (hero ? 12 : 5); i++) {
        const a = -0.35 + (i / (hero ? 12 : 5)) * 1.9;
        const y = frontHub.y + Math.cos(a) * gr;
        const z = frontHub.z - Math.sin(a) * gr;
        guard.push([-0.07, -0.055, 0, 0.055, 0.07].map((x) => new THREE.Vector3(x, y - (Math.abs(x) > 0.06 ? 0.03 : 0), z)));
      }
      b.addGrid(guard, { surfaceAt: () => ctx.paint });
      b.addGrid(guard.map((row) => [...row].reverse()), { surfaceAt: () => SURF.trimGloss });
    }

    // Screen, smoked, rising from the fairing top in front of the rider.
    const screen = windscreen();
    if (!far) bar(b, screen.userData.edge as THREE.Vector3[], 0.008, SURF.trimGloss, hero);
    ctx.extras.push(screen);
    mirrors(b, 0.27, 0.97, zAt(0.2), ctx.paint, hero);
    // Clip-ons out to the grips.
    const grip = (side: number): THREE.Vector3 => new THREE.Vector3(side * 0.29, 1.0, zAt(0.27));
    for (const side of [1, -1]) {
      bar(b, [new THREE.Vector3(side * 0.1, 0.97, zAt(0.25)), new THREE.Vector3(side * 0.2, 0.99, zAt(0.26)), grip(side)], 0.014, SURF.trimGloss, hero);
    }

    // Engine and gearbox below the seat, behind the fairing; footpegs.
    b.addGeometry(roundedBox(0.3, 0.3, 0.32, 0.05, hero ? 2 : 1), place(0, 0.42, zAt(0.56)), SURF.trimSatin);
    pair(b, roundedBox(0.07, 0.025, 0.025, 0.008, 1), place(0.17, 0.43, zAt(0.63)), SURF.brushed);

    // Swingarm, pivot to rear axle either side of the tyre, and the chain.
    const pivotZ = zAt(0.53);
    for (const side of [1, -1]) {
      beam(b, new THREE.Vector3(side * 0.12, 0.42, pivotZ), new THREE.Vector3(side * 0.13, rearHub.y, rearHub.z), 0.04, 0.09, SURF.brushed);
    }
    if (hero) {
      bar(b, [new THREE.Vector3(-0.1, 0.4, pivotZ + 0.04), new THREE.Vector3(-0.1, 0.36, rearHub.z)], 0.008, SURF.trimMatte, hero);
    }

    // Side-can exhaust on the right: headers under the engine, then the can.
    if (!far) {
      bar(b, [
        new THREE.Vector3(0.06, 0.4, zAt(0.33)),
        new THREE.Vector3(0.08, 0.2, zAt(0.42)),
        new THREE.Vector3(0.14, 0.22, zAt(0.56)),
        new THREE.Vector3(0.19, 0.4, zAt(0.68)),
      ], 0.028, SURF.brushed, hero);
    }
    const canTilt = -0.24;
    const canLen = 0.42;
    const canCentre = new THREE.Vector3(0.2, 0.5, zAt(0.8));
    const canDir = new THREE.Vector3(0, -Math.sin(canTilt), Math.cos(canTilt));
    b.addGeometry(cylZ(0.058, 0.05, canLen, seg), place(canCentre.x, canCentre.y, canCentre.z, canTilt), SURF.carbon);
    const tip = canCentre.clone().addScaledVector(canDir, canLen / 2);
    b.addGeometry(cylZ(0.042, 0.04, 0.05, seg, true), place(tip.x, tip.y, tip.z, canTilt), SURF.chrome);
    ctx.exhausts.push(tip.clone().addScaledVector(canDir, 0.025));

    // Plate hanger under the tail, with the plate and a pair of indicators.
    const tailZ = shell.tailZ(0, 0.8);
    strut(b, new THREE.Vector3(0, 0.74, tailZ - 0.14), new THREE.Vector3(0, 0.56, tailZ + 0.02), 0.012, 0.012, SURF.trimGloss, 6);
    b.addGeometry(roundedBox(0.19, 0.15, 0.012, 0.004, 1), place(0, 0.5, tailZ + 0.03, -0.25), SURF.trimGloss);
    b.addGeometry(roundedBox(0.17, 0.13, 0.004, 0.002, 1), place(0, 0.5, tailZ + 0.037, -0.25), SURF.bikePlate);
    pair(b, sphere(0.02, 10, 8), place(0.1, 0.6, tailZ - 0.01, 0, 0, 0, 1, 0.8, 1.5), SURF.amberMarker);
    pair(b, roundedBox(0.1, 0.012, 0.012, 0.004, 1), place(0.05, 0.6, tailZ - 0.02), SURF.trimGloss);

    rider(ctx);
  },
};

/**
 * The screen as its own transparent mesh, like the roadster's: a smoked sheet
 * that wraps back at its corners, rising from the top of the fairing to just
 * under the rider's chin, with the path of its black edge.
 */
function windscreen(): THREE.Mesh {
  const rows: Array<{ t: number; y: number; half: number }> = [
    { t: 0.145, y: 0.965, half: 0.2 },
    { t: 0.2, y: 1.09, half: 0.17 },
    { t: 0.245, y: 1.16, half: 0.12 },
  ];
  const cols = 10;
  const positions: number[] = [];
  const indices: number[] = [];
  const edge: THREE.Vector3[] = [];
  rows.forEach(({ t, y, half }, r) => {
    for (let c = 0; c <= cols; c++) {
      const u = (c / cols) * 2 - 1;
      const p = new THREE.Vector3(u * half, y - 0.03 * u * u, zAt(t) + 0.07 * u * u);
      positions.push(p.x, p.y, p.z);
      if (r === rows.length - 1) edge.push(p.clone());
    }
  });
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      indices.push(a, a + 1, a + cols + 2, a, a + cols + 2, a + cols + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const glass = makeScreenGlass();
  glass.color.setHex(0x2e3842);
  glass.opacity = 0.55;
  const mesh = new THREE.Mesh(geo, glass);
  mesh.renderOrder = 3;
  mesh.userData.edge = edge;
  return mesh;
}

/**
 * The rider, tucked behind the screen: seat to shoulders along one low line,
 * helmet over the top of the screen, elbows out to the clip-ons, knees in at
 * the tank and boots on the pegs. The helmet and the hump on the back of the
 * leathers wear the bike's paint.
 */
function rider(ctx: DesignContext): void {
  const { b, hero } = ctx;
  const seg = hero ? 18 : 8;
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

  // Hips on the seat, and the back running forward and up to the shoulders.
  ellipsoid(b, 0, 0.9, zAt(0.6), 0.17, 0.1, 0.13, 0, leathers, hero);
  ellipsoid(b, 0, 1.02, zAt(0.54), 0.19, 0.12, 0.24, 0.5, leathers, hero);
  ellipsoid(b, 0, 1.12, zAt(0.555), 0.1, 0.06, 0.14, 0.5, ctx.paint, hero);
  // Helmet over the screen, and its visor.
  ellipsoid(b, 0, 1.2, zAt(0.4), 0.13, 0.135, 0.15, 0.25, ctx.paint, hero);
  const visor = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg / 2)), Math.PI * 1.18, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.26);
  b.addGeometry(visor, place(0, 1.2, zAt(0.4), 0.25, 0, 0, 0.134, 0.139, 0.154), SURF.glassTint);
  visor.dispose();

  for (const side of [1, -1]) {
    // Arms: shoulder, elbow out, hand on the grip.
    const shoulder = v(side * 0.17, 1.1, zAt(0.47));
    const elbow = v(side * 0.27, 1.0, zAt(0.385));
    const hand = v(side * 0.29, 1.0, zAt(0.27));
    bar(b, [shoulder, elbow], 0.05, leathers, hero);
    bar(b, [elbow, hand], 0.042, leathers, hero);
    b.addGeometry(sphere(0.05, seg, Math.round(seg * 0.7)), place(elbow.x, elbow.y, elbow.z), leathers);
    b.addGeometry(sphere(0.045, seg, Math.round(seg * 0.7)), place(hand.x, hand.y, hand.z), SURF.trimMatte);
    // Legs: hip, knee at the tank, boot on the peg.
    const hip = v(side * 0.11, 0.9, zAt(0.6));
    const knee = v(side * 0.27, 0.8, zAt(0.44));
    const ankle = v(side * 0.2, 0.48, zAt(0.61));
    bar(b, [hip, knee], 0.075, leathers, hero);
    bar(b, [knee, ankle], 0.055, leathers, hero);
    b.addGeometry(sphere(0.075, seg, Math.round(seg * 0.7)), place(knee.x, knee.y, knee.z), leathers);
    b.addGeometry(roundedBox(0.08, 0.1, 0.22, 0.03, 1), place(ankle.x, ankle.y - 0.04, ankle.z - 0.02, 0.2), SURF.trimMatte);
  }
}
