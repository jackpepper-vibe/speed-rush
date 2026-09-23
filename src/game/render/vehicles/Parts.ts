import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { RimStyle, WheelSpec } from './BodyShell';
import { SURF, surface, type Surface } from './Surfaces';
import type { VehicleBuilder } from './VehicleBuilder';

/**
 * The bolt-on parts every design draws from: wheels, lamps, plates, exhausts,
 * wings, mirrors, seats and the people in them.
 *
 * Each is built in its own space and dropped into the vehicle through a
 * transform, so a design places parts in metres against its own body — "a
 * round lamp 0.62 m out, 0.64 m up, on the tail panel" — rather than composing
 * geometry by hand. Geometries are cached by their parameters: twenty sedans
 * in traffic lathe their tyres once.
 */

const cache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = build();
    cache.set(key, g);
  }
  return g;
}

export function disposePartCache(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/** Compose a transform from a position, an Euler rotation and a scale. */
export function place(
  x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = 1, sz = 1,
): THREE.Matrix4 {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _s.set(sx, sy, sz));
}

/** The same transform reflected across the car's centreline. */
export function mirrored(m: THREE.Matrix4): THREE.Matrix4 {
  return new THREE.Matrix4().makeScale(-1, 1, 1).multiply(m);
}

/** Add a part and its reflection. */
export function pair(b: VehicleBuilder, geo: THREE.BufferGeometry, m: THREE.Matrix4, s: Surface | readonly Surface[]): void {
  b.addGeometry(geo, m, s);
  b.addGeometry(geo, mirrored(m), s);
}

/* ------------------------------------------------------------ primitives */

export function roundedBox(w: number, h: number, d: number, r: number, seg = 2): THREE.BufferGeometry {
  const radius = Math.max(0.001, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  return cached(`rbox:${w}:${h}:${d}:${radius}:${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, radius));
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return cached(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
}

/** A cylinder along Z. */
export function cylZ(r0: number, r1: number, len: number, seg: number, open = false): THREE.BufferGeometry {
  return cached(`cylz:${r0}:${r1}:${len}:${seg}:${open}`, () => {
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/** A cylinder along X. */
export function cylX(r: number, len: number, seg: number): THREE.BufferGeometry {
  return cached(`cylx:${r}:${len}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

export function sphere(r: number, ws = 16, hs = 12): THREE.BufferGeometry {
  return cached(`sph:${r}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
}

/** A disc facing +Z with planar 0..1 UVs, domed outwards by `dome`. */
export function lensDisc(r: number, seg: number, dome: number): THREE.BufferGeometry {
  return cached(`lens:${r}:${seg}:${dome}`, () => {
    const g = new THREE.CircleGeometry(r, seg, 0, Math.PI * 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getY(i)) / r;
      pos.setZ(i, dome * (1 - d * d));
    }
    g.computeVertexNormals();
    return g;
  });
}

/** A flat panel facing +Z, gently curved about Y so light rolls across it. */
export function panel(w: number, h: number, curve = 0, segX = 1): THREE.BufferGeometry {
  return cached(`panel:${w}:${h}:${curve}:${segX}`, () => {
    const g = new THREE.PlaneGeometry(w, h, segX, 1);
    if (curve !== 0) {
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / (w / 2);
        pos.setZ(i, -curve * u * u);
      }
      g.computeVertexNormals();
    }
    return g;
  });
}

/* ---------------------------------------------------------------- wheels */

interface RimPattern {
  n: number;
  inner: number;
  outer: number;
  /** Fraction of each pitch that is spoke rather than hole. */
  spoke: number;
}

const RIM_PATTERNS: Record<RimStyle, RimPattern | null> = {
  classic5: { n: 5, inner: 0.5, outer: 0.84, spoke: 0.46 },
  star5: { n: 5, inner: 0.3, outer: 0.88, spoke: 0.24 },
  mesh10: { n: 10, inner: 0.3, outer: 0.88, spoke: 0.3 },
  split12: { n: 12, inner: 0.28, outer: 0.88, spoke: 0.34 },
  aero: { n: 8, inner: 0.7, outer: 0.88, spoke: 0.38 },
  steel: null,
  truck: null,
};

function rimFace(rr: number, style: RimStyle, seg: number): THREE.BufferGeometry {
  return cached(`rimface:${rr}:${style}:${seg}`, () => {
    const pattern = RIM_PATTERNS[style];
    if (!pattern) {
      // A pressed hubcap: a shallow dish with a raised centre.
      const profile = [
        new THREE.Vector2(0.0001, 0.034),
        new THREE.Vector2(rr * 0.22, 0.034),
        new THREE.Vector2(rr * 0.3, 0.02),
        new THREE.Vector2(rr * 0.62, 0.016),
        new THREE.Vector2(rr * 0.7, 0.026),
        new THREE.Vector2(rr * 0.92, 0.01),
        new THREE.Vector2(rr * 0.98, -0.01),
      ].reverse();
      const g = new THREE.LatheGeometry(profile, seg);
      // Lathe axis Y -> X, so the dish faces +X.
      g.rotateZ(-Math.PI / 2);
      return g;
    }
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rr * 0.975, 0, Math.PI * 2, false);
    const pitch = (Math.PI * 2) / pattern.n;
    for (let i = 0; i < pattern.n; i++) {
      const a0 = i * pitch + (pitch * pattern.spoke) / 2 + Math.PI / 2;
      const a1 = (i + 1) * pitch - (pitch * pattern.spoke) / 2 + Math.PI / 2;
      const hole = new THREE.Path();
      hole.absarc(0, 0, rr * pattern.outer, a0, a1, false);
      hole.absarc(0, 0, rr * pattern.inner, a1, a0, true);
      hole.closePath();
      shape.holes.push(hole);
    }
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.018,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.006,
      bevelSegments: 1,
      curveSegments: Math.max(6, Math.round(seg / pattern.n) * 2),
    });
    // Extrusion along +Z becomes +X: the face looks out of the wheel.
    g.rotateY(Math.PI / 2);
    return g;
  });
}

function tyre(radius: number, halfWidth: number, rr: number, seg: number): THREE.BufferGeometry {
  return cached(`tyre:${radius}:${halfWidth}:${rr}:${seg}`, () => {
    const w = halfWidth;
    const R = radius;
    const profile = [
      [rr + 0.004, -w * 0.86],
      [R * 0.84, -w * 0.99],
      [R * 0.94, -w * 0.97],
      [R * 0.985, -w * 0.84],
      [R, -w * 0.6],
      [R, w * 0.6],
      [R * 0.985, w * 0.84],
      [R * 0.94, w * 0.97],
      [R * 0.84, w * 0.99],
      [rr + 0.004, w * 0.86],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(profile, seg);
    g.rotateZ(-Math.PI / 2);
    return g;
  });
}

function ring(inner: number, outer: number, seg: number): THREE.BufferGeometry {
  return cached(`ring:${inner}:${outer}:${seg}`, () => {
    const g = new THREE.RingGeometry(inner, outer, seg, 1);
    g.rotateY(Math.PI / 2);
    return g;
  });
}

function disc(r: number, seg: number): THREE.BufferGeometry {
  return cached(`discx:${r}:${seg}`, () => {
    const g = new THREE.CircleGeometry(r, seg);
    g.rotateY(Math.PI / 2);
    return g;
  });
}

function torusX(r: number, tube: number, seg: number): THREE.BufferGeometry {
  return cached(`torusx:${r}:${tube}:${seg}`, () => {
    const g = new THREE.TorusGeometry(r, tube, 6, seg);
    g.rotateY(Math.PI / 2);
    return g;
  });
}

const caliperSurfaces = new Map<number, Surface>();

/**
 * A wheel at `hub`, outer face towards `side`.
 *
 * Tyre, rim face, rim lip, a dark barrel behind the spokes, a brake disc seen
 * through them and a caliper that stays put while everything else spins.
 */
export function addWheel(
  b: VehicleBuilder, w: WheelSpec, hub: THREE.Vector3, side: 1 | -1, front: boolean, hero: boolean, far = false,
): void {
  const seg = hero ? 44 : far ? 10 : 14;
  const rr = w.radius * w.rim;
  if (far) {
    // A parked car at thirty metres: a tyre and a disc in the rim's finish.
    const m = new THREE.Matrix4().makeTranslation(hub.x + side * w.width * 0.2, hub.y, hub.z);
    if (side < 0) m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    b.addGeometry(tyre(w.radius, w.width / 2, rr, seg), new THREE.Matrix4().makeTranslation(hub.x, hub.y, hub.z), SURF.rubber);
    b.addGeometry(disc(rr, seg), m, w.finish);
    return;
  }
  const hw = w.width / 2;
  const at = (x: number): THREE.Matrix4 => {
    const m = new THREE.Matrix4().makeTranslation(hub.x + side * x, hub.y, hub.z);
    if (side < 0) m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    return m;
  };
  const pattern = RIM_PATTERNS[w.style];

  b.wheel(hub, front, () => {
    b.addGeometry(tyre(w.radius, hw, rr, seg), at(0), SURF.rubber);
    if (hero) {
      // Barrel shadow and brake disc, seen through the spokes.
      b.addGeometry(disc(rr * 0.99, seg), at(-hw * 0.35), SURF.cavity);
      b.addGeometry(ring(rr * 0.24, rr * 0.8, seg), at(hw * 0.02), SURF.brakeDisc);
      b.addGeometry(rimFace(rr, w.style, seg), at(hw * 0.28), [w.finish, w.finish]);
      b.addGeometry(torusX(rr * 0.985, Math.max(0.006, rr * 0.035), seg), at(hw * 0.5), w.finish);
      if (pattern) b.addGeometry(cylX(rr * 0.15, 0.03, 12), at(hw * 0.46), SURF.chrome);
    } else if (pattern) {
      /* An alloy at traffic range: a dark dish with a few spoke bars across
       * it. Extruded spokes cost two thousand triangles a wheel and nobody at
       * forty metres can count them; this is about a hundred. */
      b.addGeometry(rimFace(rr, 'steel', seg), at(hw * 0.18), SURF.rimDark);
      const spokes = Math.min(pattern.n, 6);
      const bar = roundedBox(0.02, rr * 0.86, rr * 0.2, 0.005, 1);
      for (let i = 0; i < spokes; i++) {
        const m = at(hw * 0.44)
          .multiply(new THREE.Matrix4().makeRotationX((i / spokes) * Math.PI * 2))
          .multiply(new THREE.Matrix4().makeTranslation(0, rr * 0.48, 0));
        b.addGeometry(bar, m, w.finish);
      }
      b.addGeometry(cylX(rr * 0.2, 0.03, 10), at(hw * 0.46), w.finish);
    } else {
      b.addGeometry(rimFace(rr, w.style, seg), at(hw * 0.28), [w.finish, w.finish]);
    }
  });

  if (w.caliper !== null && hero) {
    let s = caliperSurfaces.get(w.caliper);
    if (!s) {
      s = surface(`caliper-${w.caliper}`, { color: w.caliper, roughness: 0.35, clearcoat: 1 });
      caliperSurfaces.set(w.caliper, s);
    }
    const m = place(hub.x + side * hw * 0.12, hub.y + rr * 0.42, hub.z + rr * 0.42, -0.8, 0, 0);
    b.addGeometry(roundedBox(0.05, rr * 0.5, rr * 0.28, 0.015), m, s);
  }
}

/* ----------------------------------------------------------------- lamps */

/** Facing: +1 looks out of the tail (+Z), -1 out of the nose (-Z). */
export type Facing = 1 | -1;

function facingMatrix(x: number, y: number, z: number, facing: Facing, tiltX = 0): THREE.Matrix4 {
  return place(x, y, z, tiltX, facing < 0 ? Math.PI : 0, 0);
}

/**
 * A round lamp: domed lens, a housing standing it off the panel and an
 * optional chrome bezel. Placed at the panel surface; it stands proud of it.
 */
export function roundLamp(
  b: VehicleBuilder, x: number, y: number, z: number, r: number,
  lens: Surface, bezel: Surface | null, facing: Facing, hero: boolean, mirror = true,
): void {
  const seg = hero ? 28 : 12;
  const standoff = 0.018;
  const parts: Array<[THREE.BufferGeometry, THREE.Matrix4, Surface]> = [
    [cylZ(r * 1.06, r * 1.06, standoff * 2, seg, true), facingMatrix(x, y, z, facing), bezel ?? SURF.trimSatin],
    [lensDisc(r, seg, r * 0.12), facingMatrix(x, y, z + facing * standoff, facing), lens],
  ];
  if (bezel) {
    const torus = cached(`torusz:${r * 1.04}:${r * 0.07}:${seg}`, () => new THREE.TorusGeometry(r * 1.04, r * 0.07, 6, seg));
    parts.push([torus, facingMatrix(x, y, z + facing * standoff, facing), bezel]);
  }
  for (const [g, m, s] of parts) {
    if (mirror) pair(b, g, m, s);
    else b.addGeometry(g, m, s);
  }
}

/** A rectangular lamp: a lens panel in a housing with rounded corners. */
export function rectLamp(
  b: VehicleBuilder, x: number, y: number, z: number, w: number, h: number,
  lens: Surface, housing: Surface, facing: Facing, opts: { corner?: number; curve?: number; mirror?: boolean; tilt?: number } = {},
): void {
  const corner = opts.corner ?? Math.min(w, h) * 0.2;
  const depth = 0.05;
  const rim = 0.012;
  const tilt = opts.tilt ?? 0;
  const curve = opts.curve ?? 0;
  const housingGeo = roundedBox(w + rim * 2, h + rim * 2, depth, corner + rim, 1);
  /* The housing stands behind the lens by the lens's own curvature. A curved
   * lens bows back at its ends; with the housing's flat face level with the
   * lens centre, the ends sank behind it and a full-width light bar showed
   * only as a stripe in the middle. */
  const mh = facingMatrix(x, y, z + facing * (0.004 - curve - depth / 2), facing, tilt);
  const ml = facingMatrix(x, y, z + facing * 0.011, facing, tilt);
  const lensGeo = panel(w, h, curve, curve ? 6 : 1);
  if (opts.mirror ?? true) {
    pair(b, housingGeo, mh, housing);
    pair(b, lensGeo, ml, lens);
  } else {
    b.addGeometry(housingGeo, mh, housing);
    b.addGeometry(lensGeo, ml, lens);
  }
}

/** A number plate in its recess. */
export function plate(b: VehicleBuilder, y: number, z: number, index: number, facing: Facing, w = 0.52, h = 0.12): void {
  b.addGeometry(roundedBox(w + 0.03, h + 0.03, 0.03, 0.008), facingMatrix(0, y, z - facing * 0.004, facing), SURF.trimSatin);
  b.addGeometry(panel(w, h), facingMatrix(0, y, z + facing * 0.013, facing), SURF.plate(index));
}

/** An exhaust tip, pointing out of the tail. */
export function exhaust(
  b: VehicleBuilder, x: number, y: number, z: number, r: number, len: number, finish: Surface, hero: boolean, mirror = true,
): THREE.Vector3[] {
  const seg = hero ? 20 : 10;
  const outer = cylZ(r, r * 0.96, len, seg, true);
  const lip = cached(`torusz:${r * 0.95}:${r * 0.09}:${seg}`, () => new THREE.TorusGeometry(r * 0.95, r * 0.09, 6, seg));
  const inner = cached(`discz:${r * 0.9}:${seg}`, () => new THREE.CircleGeometry(r * 0.9, seg));
  const parts: Array<[THREE.BufferGeometry, THREE.Matrix4, Surface]> = [
    [outer, place(x, y, z), finish],
    [lip, place(x, y, z + len / 2), finish],
    [inner, place(x, y, z + len / 2 - 0.03), SURF.cavity],
  ];
  for (const [g, m, s] of parts) {
    if (mirror) pair(b, g, m, s);
    else b.addGeometry(g, m, s);
  }
  const tips = [new THREE.Vector3(x, y, z + len / 2)];
  if (mirror) tips.push(new THREE.Vector3(-x, y, z + len / 2));
  return tips;
}

/* ------------------------------------------------------------------ aero */

function airfoil(chord: number, thick: number, camber: number, span: number, seg: number): THREE.BufferGeometry {
  return cached(`foil:${chord}:${thick}:${camber}:${span}:${seg}`, () => {
    const upper: THREE.Vector2[] = [];
    const lower: THREE.Vector2[] = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const u = (1 - Math.cos((i / n) * Math.PI)) / 2;
      const yt = 5 * thick * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
      const yc = -camber * Math.sin(u * Math.PI);
      upper.push(new THREE.Vector2(u * chord, (yc + yt) * chord));
      lower.push(new THREE.Vector2(u * chord, (yc - yt) * chord));
    }
    const shape = new THREE.Shape([...upper, ...lower.reverse().slice(1)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: seg, steps: 1 });
    g.translate(0, 0, -span / 2);
    // Chord runs back along +Z, span along X.
    g.rotateY(-Math.PI / 2);
    return g;
  });
}

/** A rear wing: blade, end plates and a pair of uprights down to the deck. */
export function wing(
  b: VehicleBuilder,
  opts: { span: number; chord: number; y: number; z: number; deckY: number; plate: number; upright: number; surface: Surface; plates: Surface; swan?: boolean; aoa?: number },
): void {
  const blade = airfoil(opts.chord, 0.1, 0.05, opts.span, 8);
  b.addGeometry(blade, place(0, opts.y, opts.z - opts.chord / 2, -(opts.aoa ?? 0.12)), opts.surface);
  const plateGeo = roundedBox(0.012, opts.plate, opts.chord * 1.2, 0.005, 1);
  pair(b, plateGeo, place(opts.span / 2 + 0.006, opts.y - opts.plate * 0.3, opts.z, 0), opts.plates);
  const height = opts.y - opts.deckY;
  if (height > 0.02) {
    if (opts.swan) {
      // Swan neck: uprights rising behind the blade and hooking over it.
      const neck = roundedBox(0.018, height + 0.06, opts.chord * 0.45, 0.006, 1);
      pair(b, neck, place(opts.upright, opts.deckY + height / 2 + 0.03, opts.z + opts.chord * 0.3, -0.35), opts.plates);
    } else {
      const post = roundedBox(0.02, height, opts.chord * 0.4, 0.006, 1);
      pair(b, post, place(opts.upright, opts.deckY + height / 2, opts.z, 0), opts.plates);
    }
  }
}

/* ---------------------------------------------------------------- mirrors */

export function mirrors(b: VehicleBuilder, x: number, y: number, z: number, housing: Surface, hero: boolean): void {
  const ws = hero ? 14 : 8;
  const pod = cached(`mirrorpod:${ws}`, () => {
    const g = new THREE.SphereGeometry(1, ws, Math.max(6, ws - 4));
    g.scale(0.095, 0.058, 0.07);
    return g;
  });
  pair(b, pod, place(x + 0.06, y + 0.05, z), housing);
  pair(b, roundedBox(0.09, 0.022, 0.04, 0.008, 1), place(x + 0.012, y + 0.02, z + 0.01, 0, 0, 0.35), SURF.trimSatin);
  // The glass faces backwards — the one piece of a mirror the chase camera sees.
  const glass = cached(`mirrorglass:${ws}`, () => {
    const g = new THREE.CircleGeometry(1, ws);
    g.scale(0.082, 0.047, 1);
    return g;
  });
  pair(b, glass, place(x + 0.06, y + 0.05, z + 0.069), SURF.chrome);
}

/* ------------------------------------------------------------ occupants */

export function seat(b: VehicleBuilder, x: number, floorY: number, z: number, hero: boolean): void {
  const seg = hero ? 3 : 1;
  b.addGeometry(roundedBox(0.44, 0.13, 0.46, 0.05, seg), place(x, floorY + 0.07, z - 0.14), SURF.leather);
  b.addGeometry(roundedBox(0.46, 0.56, 0.13, 0.055, seg), place(x, floorY + 0.36, z + 0.1, -0.28), SURF.leather);
  b.addGeometry(roundedBox(0.26, 0.2, 0.1, 0.045, seg), place(x, floorY + 0.72, z + 0.2, -0.22), SURF.leather);
}

/**
 * A driver, seen almost entirely from behind: shoulders, a neck, a head of
 * hair and two arms reaching for the wheel. The first thing that makes an
 * open car look driven rather than parked.
 */
export function driver(b: VehicleBuilder, x: number, floorY: number, z: number, wheelZ: number, hero: boolean): void {
  const seg = hero ? 3 : 1;
  const shoulderY = floorY + 0.56;
  b.addGeometry(roundedBox(0.44, 0.5, 0.24, 0.1, seg), place(x, floorY + 0.36, z + 0.02, -0.22), SURF.shirt);
  b.addGeometry(cylZ(0.05, 0.052, 0.12, 10), place(x, shoulderY + 0.07, z - 0.02, -Math.PI / 2 + 0.2), SURF.skin);
  const head = cached('driver-head', () => {
    const g = new THREE.SphereGeometry(0.1, 18, 14);
    g.scale(0.92, 1.08, 1.02);
    return g;
  });
  b.addGeometry(head, place(x, shoulderY + 0.2, z - 0.04), SURF.skin);
  // Hair over the crown and down the back of the head.
  const hair = cached('driver-hair', () => {
    const g = new THREE.SphereGeometry(0.106, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    g.scale(0.94, 1.08, 1.05);
    g.rotateX(0.5);
    return g;
  });
  b.addGeometry(hair, place(x, shoulderY + 0.215, z - 0.035), SURF.hair);
  // Arms, forward and down to the rim.
  const arm = cylZ(0.045, 0.04, 0.46, 10);
  for (const side of [-1, 1]) {
    const sx = x + side * 0.19;
    const reach = z - (z - wheelZ) * 0.5;
    b.addGeometry(arm, place(sx - side * 0.03, shoulderY - 0.08, reach + 0.04, 0.42, side * 0.12, 0), SURF.shirt);
  }
  // Steering wheel rim.
  const rim = cached('steering', () => new THREE.TorusGeometry(0.18, 0.018, 6, 22));
  b.addGeometry(rim, place(x, shoulderY - 0.12, wheelZ, -0.45), SURF.trimSatin);
}

/**
 * A round bar along a path: chrome bumpers, window frames, grab rails.
 * Not cached — every path is its own shape — so it is kept to hero details.
 */
export function bar(b: VehicleBuilder, points: THREE.Vector3[], radius: number, s: Surface, hero: boolean): void {
  const path = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const geo = new THREE.TubeGeometry(path, hero ? points.length * 8 : points.length * 3, radius, hero ? 10 : 5, false);
  b.addGeometry(geo, new THREE.Matrix4(), s);
  geo.dispose();
}

/** A roll hoop over the cockpit: a flattened tube following an arch. */
export function rollHoop(b: VehicleBuilder, halfWidth: number, baseY: number, height: number, z: number, s: Surface, hero: boolean): void {
  const geo = cached(`hoop:${halfWidth}:${baseY}:${height}:${hero}`, () => {
    const pts: THREE.Vector3[] = [];
    const n = hero ? 16 : 8;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI;
      const x = -Math.cos(a) * halfWidth;
      const y = baseY + Math.pow(Math.sin(a), 0.45) * height;
      pts.push(new THREE.Vector3(x, y, 0));
    }
    const path = new THREE.CatmullRomCurve3(pts);
    const profile = new THREE.Shape();
    profile.moveTo(-0.022, -0.06);
    profile.lineTo(0.022, -0.06);
    profile.lineTo(0.022, 0.06);
    profile.lineTo(-0.022, 0.06);
    profile.closePath();
    return new THREE.ExtrudeGeometry(profile, { steps: hero ? 40 : 16, extrudePath: path, bevelEnabled: false });
  });
  b.addGeometry(geo, place(0, 0, z), s);
}
