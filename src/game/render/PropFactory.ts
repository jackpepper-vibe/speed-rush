import * as THREE from 'three';
import type { BiomeId } from '@/core/GameEvents';
import { makeBuildingTexture } from './RoadTextures';

/**
 * The roadside furniture, as shared geometry and materials.
 *
 * Everything is instanced: one draw call per prop type regardless of how many
 * are on screen. A forest needs hundreds of trunks, and at one mesh each the
 * draw-call count alone would cost more than the entire rest of the frame.
 *
 * Each kind declares how wide it is at the base, which is what the placement
 * pass uses to keep it off the tarmac — a prop is only clear of the road if its
 * footprint is, not merely its origin.
 */

export interface PropKind {
  readonly id: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  /** Instances to allocate for this kind. */
  readonly count: number;
  /** Horizontal half-extent at the base, in world units. */
  readonly radius: number;
  /** Uniform scale range. */
  readonly scale: [number, number];
  /** How far beyond the barrier this kind starts, and how deep it spreads. */
  readonly offset: [number, number];
  /** Sunk into the ground by this much, so nothing floats on a slope. */
  readonly sink: number;
}

/**
 * Merge a set of transformed geometries into one.
 *
 * A tree is a trunk plus a canopy; instancing wants a single geometry per kind,
 * so the parts are baked together once at build time rather than being two
 * instanced meshes that have to be kept in step.
 */
function merge(parts: { geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const normalMatrix = new THREE.Matrix3();
  const v = new THREE.Vector3();

  for (const { geo, matrix } of parts) {
    const indexed = geo.index ? geo.toNonIndexed() : geo;
    const pos = indexed.attributes.position as THREE.BufferAttribute;
    const nrm = indexed.attributes.normal as THREE.BufferAttribute | undefined;
    const uv = indexed.attributes.uv as THREE.BufferAttribute | undefined;
    normalMatrix.getNormalMatrix(matrix);

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      positions.push(v.x, v.y, v.z);
      if (nrm) {
        v.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize();
        normals.push(v.x, v.y, v.z);
      } else {
        normals.push(0, 1, 0);
      }
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      else uvs.push(0, 0);
    }
    if (indexed !== geo) indexed.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return out;
}

function at(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion(),
    new THREE.Vector3(sx, sy, sz),
  );
}

const BARK = new THREE.MeshStandardMaterial({ color: 0x5a4432, roughness: 0.95 });
const PINE = new THREE.MeshStandardMaterial({ color: 0x2f5b38, roughness: 0.88 });
const BROADLEAF = new THREE.MeshStandardMaterial({ color: 0x4a7a3c, roughness: 0.9 });
const PALM_LEAF = new THREE.MeshStandardMaterial({ color: 0x3f8a56, roughness: 0.85 });
const ROCK = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 1, flatShading: true });
const CACTUS = new THREE.MeshStandardMaterial({ color: 0x4d7a4a, roughness: 0.9 });
const CONCRETE = new THREE.MeshStandardMaterial({ color: 0x6e7480, roughness: 0.86 });
const SIGN = new THREE.MeshStandardMaterial({ color: 0x2f6b48, roughness: 0.6, metalness: 0.2 });
const METAL = new THREE.MeshStandardMaterial({ color: 0x9aa2ae, roughness: 0.42, metalness: 0.75 });

/** Built lazily so the window texture is only generated if a city is visited. */
let buildingMat: THREE.MeshStandardMaterial | null = null;
function building(): THREE.MeshStandardMaterial {
  if (!buildingMat) {
    const tex = makeBuildingTexture();
    tex.repeat.set(2, 5);
    buildingMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0.1 });
  }
  return buildingMat;
}

function pineGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.22, 0.3, 2.2, 6);
  const lower = new THREE.ConeGeometry(1.9, 3.4, 7);
  const upper = new THREE.ConeGeometry(1.35, 2.8, 7);
  const geo = merge([
    { geo: trunk, matrix: at(0, 1.1, 0) },
    { geo: lower, matrix: at(0, 3.4, 0) },
    { geo: upper, matrix: at(0, 5.2, 0) },
  ]);
  trunk.dispose(); lower.dispose(); upper.dispose();
  return geo;
}

function broadleafGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.24, 0.34, 2.6, 6);
  const canopy = new THREE.IcosahedronGeometry(2.1, 0);
  const geo = merge([
    { geo: trunk, matrix: at(0, 1.3, 0) },
    { geo: canopy, matrix: at(0, 4.1, 0, 1, 0.86, 1) },
    { geo: canopy, matrix: at(0.9, 3.3, 0.4, 0.62, 0.55, 0.62) },
  ]);
  trunk.dispose(); canopy.dispose();
  return geo;
}

function palmGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.18, 0.3, 5.4, 6);
  const frond = new THREE.ConeGeometry(0.34, 2.6, 4);
  const parts = [{ geo: trunk, matrix: at(0, 2.7, 0) }];
  // Six fronds, splayed outward and drooping.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = new THREE.Matrix4()
      .makeTranslation(Math.cos(a) * 1.1, 5.5, Math.sin(a) * 1.1)
      .multiply(new THREE.Matrix4().makeRotationZ(Math.cos(a) * 1.15))
      .multiply(new THREE.Matrix4().makeRotationX(Math.sin(a) * 1.15))
      .multiply(new THREE.Matrix4().makeScale(1, 1.5, 1));
    parts.push({ geo: frond, matrix: m });
  }
  const geo = merge(parts);
  trunk.dispose(); frond.dispose();
  return geo;
}

function cactusGeo(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.42, 0.5, 3.6, 8);
  const arm = new THREE.CylinderGeometry(0.24, 0.26, 1.5, 6);
  const geo = merge([
    { geo: body, matrix: at(0, 1.8, 0) },
    { geo: arm, matrix: new THREE.Matrix4().makeTranslation(0.62, 2.5, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(-0.85)) },
    { geo: arm, matrix: at(0.86, 3.1, 0) },
    { geo: arm, matrix: new THREE.Matrix4().makeTranslation(-0.58, 2.1, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(0.9)) },
  ]);
  body.dispose(); arm.dispose();
  return geo;
}

function rockGeo(): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(1.2, 0);
  const merged = merge([{ geo: g, matrix: at(0, 0.75, 0, 1.25, 0.78, 1.05) }]);
  g.dispose();
  return merged;
}

function towerGeo(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(6.4, 26, 6.4);
  const merged = merge([{ geo: g, matrix: at(0, 13, 0) }]);
  g.dispose();
  return merged;
}

function blockGeo(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(7.6, 11, 7.6);
  const roof = new THREE.BoxGeometry(3.2, 1.6, 3.2);
  const geo = merge([
    { geo: base, matrix: at(0, 5.5, 0) },
    { geo: roof, matrix: at(0, 11.8, 0) },
  ]);
  base.dispose(); roof.dispose();
  return geo;
}

function signGeo(): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.13, 0.13, 4.4, 6);
  const board = new THREE.BoxGeometry(3.6, 1.9, 0.16);
  const geo = merge([
    { geo: post, matrix: at(-1.3, 2.2, 0) },
    { geo: post, matrix: at(1.3, 2.2, 0) },
    { geo: board, matrix: at(0, 4.2, 0) },
  ]);
  post.dispose(); board.dispose();
  return geo;
}

function pylonGeo(): THREE.BufferGeometry {
  const leg = new THREE.BoxGeometry(0.3, 14, 0.3);
  const arm = new THREE.BoxGeometry(7, 0.32, 0.32);
  const geo = merge([
    { geo: leg, matrix: at(-1, 7, 0) },
    { geo: leg, matrix: at(1, 7, 0) },
    { geo: arm, matrix: at(0, 11.4, 0) },
    { geo: arm, matrix: at(0, 13.4, 0) },
  ]);
  leg.dispose(); arm.dispose();
  return geo;
}

function duneGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const merged = merge([{ geo: g, matrix: at(0, 0, 0, 1.6, 0.42, 1.2) }]);
  g.dispose();
  return merged;
}

/**
 * What stands beside the road in each biome.
 *
 * Counts are the instance budget, not a guarantee: the placement pass fills as
 * many as fit without landing on the tarmac.
 */
export function propsForBiome(biome: BiomeId): PropKind[] {
  switch (biome) {
    case 'forest':
      return [
        { id: 'pine', geometry: pineGeo(), material: PINE, count: 150, radius: 1.9, scale: [0.8, 1.5], offset: [3, 46], sink: 0.2 },
        { id: 'broadleaf', geometry: broadleafGeo(), material: BROADLEAF, count: 80, radius: 2.1, scale: [0.75, 1.3], offset: [4, 42], sink: 0.2 },
        { id: 'rock', geometry: rockGeo(), material: ROCK, count: 34, radius: 1.5, scale: [0.6, 1.4], offset: [2.5, 22], sink: 0.35 },
      ];
    case 'city':
      return [
        { id: 'tower', geometry: towerGeo(), material: building(), count: 44, radius: 3.2, scale: [0.7, 1.8], offset: [9, 56], sink: 0 },
        { id: 'block', geometry: blockGeo(), material: CONCRETE, count: 46, radius: 3.8, scale: [0.7, 1.35], offset: [6, 40], sink: 0 },
        { id: 'pylon', geometry: pylonGeo(), material: METAL, count: 20, radius: 1.2, scale: [0.85, 1.2], offset: [4, 16], sink: 0 },
      ];
    case 'desert':
      return [
        { id: 'cactus', geometry: cactusGeo(), material: CACTUS, count: 70, radius: 0.9, scale: [0.7, 1.5], offset: [3, 40], sink: 0.15 },
        { id: 'rock', geometry: rockGeo(), material: ROCK, count: 60, radius: 1.5, scale: [0.5, 2.1], offset: [3, 52], sink: 0.35 },
        { id: 'dune', geometry: duneGeo(), material: ROCK, count: 26, radius: 8, scale: [0.9, 2.2], offset: [16, 64], sink: 0.5 },
      ];
    case 'coast':
      return [
        { id: 'palm', geometry: palmGeo(), material: PALM_LEAF, count: 84, radius: 1.2, scale: [0.75, 1.35], offset: [3, 34], sink: 0.2 },
        { id: 'rock', geometry: rockGeo(), material: ROCK, count: 48, radius: 1.5, scale: [0.5, 1.6], offset: [3, 44], sink: 0.35 },
        { id: 'sign', geometry: signGeo(), material: SIGN, count: 16, radius: 1.9, scale: [0.9, 1.1], offset: [2.5, 7], sink: 0 },
      ];
    case 'tunnel':
      // Inside a tunnel there is nothing to see beside the road, by definition.
      return [];
  }
}

/** Materials shared across biomes; disposed once at teardown. */
export function disposePropMaterials(): void {
  for (const m of [BARK, PINE, BROADLEAF, PALM_LEAF, ROCK, CACTUS, CONCRETE, SIGN, METAL]) {
    m.dispose();
  }
  buildingMat?.map?.dispose();
  buildingMat?.dispose();
  buildingMat = null;
}
