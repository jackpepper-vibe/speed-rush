import * as THREE from 'three';
import { PALM_UV, palmAtlas, type UvRect } from './PalmAtlas';
import { linear, PropMesh, seeded } from './PropMesh';

/**
 * Coconut and date palms, built to their real size.
 *
 * What makes a palm read as one at a glance, in order: a tall, slender, very
 * slightly bowed trunk; a crown that is a burst rather than a ball, with the
 * young fronds standing up out of the top and the old ones hanging down round
 * the trunk; and a feathered edge with sky showing between the leaflets. The
 * last is the texture's job (see `PalmAtlas`); the first two are here.
 *
 * Each frond is a spine that leaves the crown at an elevation set by its age
 * and falls under its own weight, carrying a strip folded down along the
 * rachis into a shallow V — which is how leaflets hang, and what gives a crown
 * volume from every angle instead of looking like a stack of cards.
 */

export interface PalmVariant {
  readonly seed: number;
  readonly height: number;
  /** Horizontal offset of the top of the trunk, as a fraction of its height. */
  readonly lean: number;
  readonly fronds: number;
  readonly frondLength: readonly [number, number];
  /** How far the tip falls, as a fraction of frond length, young to old. */
  readonly droop: readonly [number, number];
  readonly trunkRadius: number;
}

export const PALM_VARIANTS: readonly PalmVariant[] = [
  { seed: 7, height: 11.5, lean: 0.07, fronds: 27, frondLength: [3.1, 4.5], droop: [0.18, 0.95], trunkRadius: 0.21 },
  { seed: 19, height: 13.8, lean: 0.12, fronds: 25, frondLength: [3.0, 4.3], droop: [0.22, 1.0], trunkRadius: 0.2 },
  { seed: 31, height: 9.2, lean: 0.035, fronds: 28, frondLength: [3.2, 4.6], droop: [0.15, 0.9], trunkRadius: 0.23 },
];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function trunkCentre(v: PalmVariant, t: number, wobble: number, out: THREE.Vector3): THREE.Vector3 {
  // Leans away, with a faint S so no two trunks share a line.
  return out.set(
    v.lean * v.height * Math.pow(t, 1.7),
    v.height * t,
    Math.sin(t * Math.PI * 1.3) * wobble,
  );
}

function trunkRadius(v: PalmVariant, t: number): number {
  return v.trunkRadius * (1 - 0.3 * t) + 0.16 * Math.pow(1 - t, 10);
}

export function palmGeometry(v: PalmVariant): THREE.BufferGeometry {
  const r = seeded(v.seed);
  const m = new PropMesh();
  const wobble = (r() - 0.5) * 0.5;

  /* ---------------------------------------------------------------- trunk */
  const rings = 20;
  const around = 10;
  const [bu0, bv0, bu1, bv1] = PALM_UV.bark;
  const c = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  const n2 = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const trunkBase = m.vertexCount;
  const barkRepeat = 1; // the bark strip is authored at trunk scale
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    trunkCentre(v, t, wobble, c);
    trunkCentre(v, Math.max(0, t - 0.01), wobble, a);
    trunkCentre(v, Math.min(1, t + 0.01), wobble, b);
    tangent.subVectors(b, a).normalize();
    n1.crossVectors(tangent, new THREE.Vector3(0, 0, 1)).normalize();
    n2.crossVectors(n1, tangent).normalize();
    const radius = trunkRadius(v, t);
    // Occlusion at the foot and in the shade of the crown.
    const ao = (0.55 + 0.45 * Math.min(1, t / 0.12)) * (t > 0.94 ? 0.7 : 1);
    col.setRGB(ao, ao, ao);
    for (let j = 0; j <= around; j++) {
      const phi = (j / around) * Math.PI * 2;
      dir.copy(n1).multiplyScalar(Math.cos(phi)).addScaledVector(n2, Math.sin(phi));
      p.copy(c).addScaledVector(dir, radius);
      m.vertex(p, dir, bu0 + (bu1 - bu0) * (j / around), bv0 + (bv1 - bv0) * Math.min(1, t * barkRepeat), col);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const ia = trunkBase + i * (around + 1) + j;
      const ib = ia + 1;
      const ic = ia + around + 2;
      const id = ia + around + 1;
      m.triangle(ia, ic, ib);
      m.triangle(ia, id, ic);
    }
  }

  const top = trunkCentre(v, 1, wobble, new THREE.Vector3());
  const crown = top.clone().add(new THREE.Vector3(0, 0.2, 0));

  /* --------------------------------------------------- boots and coconuts */
  const solid = PALM_UV.solid;
  const boot = new THREE.ConeGeometry(0.13, 0.8, 6, 1, true);
  boot.translate(0, 0.4, 0);
  const bootCol = linear(0x5a4630);
  for (let k = 0; k < 9; k++) {
    const phi = k * GOLDEN * 1.7 + r();
    const tilt = 0.55 + r() * 0.4;
    const mat = new THREE.Matrix4().compose(
      top.clone().add(new THREE.Vector3(0, -0.35 - r() * 0.2, 0)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(phi) * tilt, 0, -Math.sin(phi) * tilt)),
      new THREE.Vector3(1, 1, 1),
    );
    m.addGeometry(boot, mat, solid, bootCol);
  }
  boot.dispose();
  const nut = new THREE.SphereGeometry(0.11, 7, 5);
  for (let k = 0; k < 6; k++) {
    const phi = k * GOLDEN * 2 + r();
    const mat = new THREE.Matrix4().makeTranslation(
      top.x + Math.cos(phi) * 0.24,
      top.y - 0.25 - r() * 0.2,
      top.z + Math.sin(phi) * 0.24,
    );
    m.addGeometry(nut, mat, solid, linear(r() < 0.5 ? 0x6a5a26 : 0x5a6a2c));
  }
  nut.dispose();

  /* --------------------------------------------------------------- fronds */
  const segs = 10;
  const spine = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const nl = new THREE.Vector3();
  const nr = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const fold = 0.5;

  for (let i = 0; i < v.fronds; i++) {
    const age = Math.min(1, (i + r() * 0.8) / v.fronds);
    const phi = i * GOLDEN + (r() - 0.5) * 0.35;
    const theta = 1.05 - age * 1.5 + (r() - 0.5) * 0.22;
    const len = (v.frondLength[0] + (v.frondLength[1] - v.frondLength[0]) * (0.3 + 0.7 * age)) * (0.9 + r() * 0.2);
    const droop = (v.droop[0] + (v.droop[1] - v.droop[0]) * age) * (0.85 + r() * 0.3);
    const d0 = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
    side.set(-Math.sin(phi), 0, Math.cos(phi));
    const width = 0.95 * (len / 4);
    const rect: UvRect = r() < 0.72 ? PALM_UV.frondA : PALM_UV.frondB;
    const [u0, v0, u1, v1] = rect;
    // Young fronds are bright and fresh; old ones duller and yellowing.
    const tint = new THREE.Color().setRGB(1 - age * 0.22, 1 - age * 0.26, 0.95 - age * 0.4);

    const base = m.vertexCount;
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      spine.copy(crown).addScaledVector(d0, len * s).add(tmp.set(0, -droop * len * s * s, 0));
      tan.copy(d0).multiplyScalar(len).add(tmp.set(0, -2 * droop * len * s, 0)).normalize();
      up.crossVectors(side, tan).normalize();
      if (up.y < 0) up.negate();
      const w = width * Math.min(1, s / 0.1) * (1 - 0.3 * s);
      const cb = Math.cos(fold);
      const sb = Math.sin(fold);
      left.copy(spine).addScaledVector(side, -w * cb).addScaledVector(up, -w * sb);
      right.copy(spine).addScaledVector(side, w * cb).addScaledVector(up, -w * sb);
      nl.copy(up).multiplyScalar(cb).addScaledVector(side, -sb);
      nr.copy(up).multiplyScalar(cb).addScaledVector(side, sb);
      // Bend every normal half-way towards the crown's own volume, so the
      // canopy shades as one mass lit from the sun's side.
      radial.subVectors(spine, crown).add(tmp.set(0, 0.6, 0)).normalize();
      nl.lerp(radial, 0.5).normalize();
      nr.lerp(radial, 0.5).normalize();
      const nc = up.clone().lerp(radial, 0.5).normalize();
      const ao = 0.5 + 0.5 * Math.min(1, s / 0.35);
      col.copy(tint).multiplyScalar(ao);
      const vv = v0 + (v1 - v0) * s;
      m.vertex(left, nl, u0, vv, col);
      m.vertex(spine, nc, (u0 + u1) / 2, vv, col);
      m.vertex(right, nr, u1, vv, col);
    }
    for (let k = 0; k < segs; k++) {
      const l0 = base + k * 3;
      const s0 = l0 + 1;
      const r0 = l0 + 2;
      const l1 = l0 + 3;
      const s1 = l0 + 4;
      const r1 = l0 + 5;
      m.triangle(s0, r0, r1);
      m.triangle(s0, r1, s1);
      m.triangle(s0, s1, l1);
      m.triangle(s0, l1, l0);
    }
  }

  const geo = m.toGeometry();
  geo.name = `palm:${v.seed}`;
  return geo;
}

let palmMat: THREE.MeshStandardMaterial | null = null;

/**
 * Bark and fronds share one alpha-tested material, so a palm is one instanced
 * draw call. Double-sided because a frond is a sheet; alpha-to-coverage turns
 * the cut-out edge into a soft, antialiased one under MSAA instead of a
 * stair-stepped fringe.
 */
export function palmMaterial(): THREE.MeshStandardMaterial {
  if (palmMat) return palmMat;
  palmMat = new THREE.MeshStandardMaterial({
    map: palmAtlas(),
    vertexColors: true,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.78,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  palmMat.name = 'PalmMaterial';
  return palmMat;
}

export function disposePalms(): void {
  palmMat?.dispose();
  palmMat = null;
}

