import * as THREE from 'three';
import { linear, PropMesh, seeded } from './PropMesh';

/**
 * Roadside kinds for the open-road biomes: a highway guardrail, saguaro cacti
 * and pines. All vertex-coloured, one material per kind, authored at real size
 * so the scenery's scale range is variety rather than correction.
 */

const SOLID: readonly [number, number, number, number] = [0, 0, 1, 1];

/* ------------------------------------------------------------ guardrail */

export const GUARDRAIL_BAY = 4;

/**
 * A 4 m bay of W-beam on two posts. Local +X faces the carriageway, the
 * convention every laid kind follows. The two folds of the beam are what
 * catch the light and make a guardrail read at a distance, so the profile is
 * modelled rather than flat.
 */
export function guardrailGeometry(): THREE.BufferGeometry {
  const m = new PropMesh();
  const steel = linear(0xffffff);
  const profile: Array<[number, number]> = [
    [0.0, 0.46], [0.09, 0.52], [0.1, 0.61], [0.035, 0.71], [0.1, 0.81], [0.09, 0.9], [0.0, 0.96],
  ];
  const half = GUARDRAIL_BAY / 2;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < profile.length - 1; i++) {
    const [x0, y0] = profile[i];
    const [x1, y1] = profile[i + 1];
    // Face normal of this fold, towards the road.
    n.set(y1 - y0, -(x1 - x0), 0).normalize();
    if (n.x < 0) n.negate();
    const a = m.vertex(p.set(x0, y0, -half), n, 0.5, 0.5, steel);
    const b = m.vertex(p.set(x0, y0, half), n, 0.5, 0.5, steel);
    const c = m.vertex(p.set(x1, y1, half), n, 0.5, 0.5, steel);
    const d = m.vertex(p.set(x1, y1, -half), n, 0.5, 0.5, steel);
    m.triangle(a, c, b);
    m.triangle(a, d, c);
  }
  const post = new THREE.BoxGeometry(0.1, 0.95, 0.14);
  const postCol = linear(0xb8bcc2);
  for (const z of [-half * 0.5, half * 0.5]) {
    m.addGeometry(post, new THREE.Matrix4().makeTranslation(-0.1, 0.475, z), SOLID, postCol);
  }
  post.dispose();
  const g = m.toGeometry();
  g.name = 'guardrail';
  return g;
}

export function guardrailMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xb4b9c0,
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.6,
    envMapIntensity: 1.1,
    side: THREE.DoubleSide,
  });
}

/* ---------------------------------------------------------------- cacti */

/** A ribbed column along a path, with a rounded crown. */
function ribbedLimb(m: PropMesh, path: THREE.Vector3[], radius: number, colour: THREE.Color, crown: boolean): void {
  const curve = new THREE.CatmullRomCurve3(path);
  const rings = Math.max(6, Math.round(curve.getLength() * 3));
  const around = 14;
  const ribs = 12;
  const frames = curve.computeFrenetFrames(rings, false);
  const base = m.vertexCount;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const centre = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    // Taper into a domed crown over the last fifth.
    const dome = crown ? Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.8) / 0.2), 2))) : 1;
    const r = radius * Math.max(0.05, dome);
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      const rib = 1 + 0.09 * Math.cos(a * ribs);
      n.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      p.copy(centre).addScaledVector(n, r * rib);
      // Grooves between ribs are darker.
      const shade = 0.78 + 0.22 * (0.5 + 0.5 * Math.cos(a * ribs));
      c.copy(colour).multiplyScalar(shade * (0.7 + 0.3 * Math.min(1, t * 4)));
      m.vertex(p, n, 0.5, 0.5, c);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const a = base + i * (around + 1) + j;
      const b = a + 1;
      const cc = a + around + 2;
      const d = a + around + 1;
      m.triangle(a, cc, b);
      m.triangle(a, d, cc);
    }
  }
}

export function saguaroGeometry(seed: number): THREE.BufferGeometry {
  const r = seeded(seed);
  const m = new PropMesh();
  const green = linear(0x4f7a3c);
  const height = 3.6 + r() * 1.8;
  const trunk = [new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, height * 0.5, 0), new THREE.Vector3((r() - 0.5) * 0.15, height, 0)];
  ribbedLimb(m, trunk, 0.3, green, true);
  const arms = 1 + Math.floor(r() * 3);
  for (let k = 0; k < arms; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const ang = r() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang) * side, 0, Math.sin(ang) * side);
    const h0 = height * (0.3 + r() * 0.3);
    const reach = 0.45 + r() * 0.3;
    const rise = 0.9 + r() * 1.1;
    const start = new THREE.Vector3(0, h0, 0);
    const elbow = start.clone().addScaledVector(dir, reach).add(new THREE.Vector3(0, 0.15, 0));
    const up = elbow.clone().addScaledVector(dir, 0.08).add(new THREE.Vector3(0, rise * 0.5, 0));
    const tip = elbow.clone().addScaledVector(dir, 0.05).add(new THREE.Vector3(0, rise, 0));
    ribbedLimb(m, [start, elbow, up, tip], 0.2, green, true);
  }
  const g = m.toGeometry();
  g.name = `saguaro:${seed}`;
  return g;
}

/* ---------------------------------------------------------------- pines */

/**
 * A conifer: a straight trunk and eight or so tiers of foliage, each a cone
 * whose rim is jittered and drooped so the silhouette is ragged rather than
 * a stack of clean hats. Tiers darken towards the bottom and the inside,
 * where a real pine is in its own shade.
 */
export function pineGeometry(seed: number): THREE.BufferGeometry {
  const r = seeded(seed);
  const m = new PropMesh();
  const height = 9 + r() * 6;
  const trunk = new THREE.CylinderGeometry(0.1, 0.24, height * 0.9, 8);
  m.addGeometry(trunk, new THREE.Matrix4().makeTranslation(0, height * 0.45, 0), SOLID, linear(0x5a4230));
  trunk.dispose();

  const tiers = 7 + Math.floor(r() * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  const deep = linear(0x1d3a22);
  const tip = linear(0x3f6a3a);
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const baseY = height * (0.2 + f * 0.68);
    const radius = (1 - f) * 2.7 + 0.35;
    const tierH = 1.2 + (1 - f) * 1.0;
    const around = 12;
    const apex = m.vertex(p.set(0, baseY + tierH, 0), n.set(0, 1, 0), 0.5, 0.5, c.copy(tip));
    const rim: number[] = [];
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2 + k * 0.7;
      const jitter = 0.8 + r() * 0.4;
      const droop = 0.15 + r() * 0.35;
      const rx = Math.cos(a) * radius * jitter;
      const rz = Math.sin(a) * radius * jitter;
      n.set(Math.cos(a), 0.7, Math.sin(a)).normalize();
      c.copy(deep).lerp(tip, 0.25 + f * 0.4);
      rim.push(m.vertex(p.set(rx, baseY - droop, rz), n, 0.5, 0.5, c));
    }
    // Underside, so the tier has a dark belly seen from below.
    const belly = m.vertex(p.set(0, baseY + 0.1, 0), n.set(0, -1, 0), 0.5, 0.5, c.copy(deep).multiplyScalar(0.6));
    for (let j = 0; j < around; j++) {
      m.triangle(apex, rim[j + 1], rim[j]);
      m.triangle(belly, rim[j], rim[j + 1]);
    }
  }
  const g = m.toGeometry();
  g.name = `pine:${seed}`;
  return g;
}

/** Plants, cacti and conifers: rough and matte, coloured per vertex. */
export function plantMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.5 });
}
