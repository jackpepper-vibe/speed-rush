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

interface Part {
  geo: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  /** Baked into a vertex colour attribute. Defaults to white. */
  colour?: number;
}

/**
 * Merge a set of transformed geometries into one, carrying a colour per part.
 *
 * A tree is a trunk plus a canopy; instancing wants a single geometry per kind,
 * so the parts are baked together once at build time rather than being two
 * instanced meshes that have to be kept in step.
 *
 * The colour is why a palm stopped looking like a green asterisk. One instanced
 * mesh has exactly one material, so before this every part of a prop was the
 * same flat colour — palms had green trunks, pines had green trunks, and a
 * signpost was the same green as its board. Baking the colour into a vertex
 * attribute and letting the shared material multiply by it costs three floats
 * per vertex and buys a prop that is made of more than one thing.
 */
function merge(parts: Part[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];

  const normalMatrix = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const c = new THREE.Color();

  for (const { geo, matrix, colour } of parts) {
    const indexed = geo.index ? geo.toNonIndexed() : geo;
    const pos = indexed.attributes.position as THREE.BufferAttribute;
    const nrm = indexed.attributes.normal as THREE.BufferAttribute | undefined;
    const uv = indexed.attributes.uv as THREE.BufferAttribute | undefined;
    normalMatrix.getNormalMatrix(matrix);
    // Converted out of sRGB: the renderer works in linear space, and a colour
    // handed straight in as a hex arrives noticeably brighter than the same hex
    // set on a material, which three.js converts for you.
    c.setHex(colour ?? 0xffffff, THREE.SRGBColorSpace);

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
      colours.push(c.r, c.g, c.b);
    }
    if (indexed !== geo) indexed.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return out;
}

function at(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion(),
    new THREE.Vector3(sx, sy, sz),
  );
}

/*
 * Materials are shading models here, not colours.
 *
 * Every prop bakes its own colours into vertices, so what distinguishes these
 * from each other is how they respond to light — foliage is rough and matte,
 * rock is faceted, metal is metal. Colour lives in the geometry, which is what
 * lets a single instanced draw call render a brown trunk under a green crown.
 */
const FOLIAGE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
const ROCK = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
const CONCRETE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
const METAL = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.34, metalness: 0.85, envMapIntensity: 1.6,
});
/*
 * Painted sheet: a sign board, a hoarding, anything with a coat on it.
 *
 * Separate from METAL because a fully metallic surface has no diffuse term, and
 * a green sign board rendered as metal against a sky with nothing below the
 * horizon to reflect came out as a black rectangle beside the road — the same
 * trap the car paint fell into, at a tenth the size and twice as obvious.
 */
const PAINTED = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.55, metalness: 0.12, envMapIntensity: 1.1,
});

/** Built lazily so the window texture is only generated if a city is visited. */
let buildingMat: THREE.MeshStandardMaterial | null = null;
function building(): THREE.MeshStandardMaterial {
  if (!buildingMat) {
    const tex = makeBuildingTexture();
    tex.repeat.set(2, 5);
    buildingMat = new THREE.MeshStandardMaterial({
      map: tex, vertexColors: true, roughness: 0.78, metalness: 0.1,
    });
  }
  return buildingMat;
}

function pineGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.22, 0.3, 2.2, 6);
  const lower = new THREE.ConeGeometry(1.9, 3.4, 7);
  const upper = new THREE.ConeGeometry(1.35, 2.8, 7);
  const geo = merge([
    { geo: trunk, matrix: at(0, 1.1, 0), colour: 0x5a4432 },
    { geo: lower, matrix: at(0, 3.4, 0), colour: 0x2f5b38 },
    { geo: upper, matrix: at(0, 5.2, 0), colour: 0x3a6b41 },
  ]);
  trunk.dispose(); lower.dispose(); upper.dispose();
  return geo;
}

function broadleafGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.24, 0.34, 2.6, 6);
  const canopy = new THREE.IcosahedronGeometry(2.1, 0);
  const geo = merge([
    { geo: trunk, matrix: at(0, 1.3, 0), colour: 0x5a4432 },
    { geo: canopy, matrix: at(0, 4.1, 0, 1, 0.86, 1), colour: 0x4a7a3c },
    { geo: canopy, matrix: at(0.9, 3.3, 0.4, 0.62, 0.55, 0.62), colour: 0x3f6b34 },
  ]);
  trunk.dispose(); canopy.dispose();
  return geo;
}

/**
 * One palm frond, as a drooping blade.
 *
 * Built along its own length so the caller only has to rotate it into place: a
 * strip of quads that narrows toward the tip, bends downward under its own
 * weight, and is pinched along the centre line into a shallow V. The V is what
 * makes a frond catch light as two surfaces at slightly different angles rather
 * than as one flat card, and it is the entire difference between a palm and a
 * green asterisk — the previous version used a four-sided cone per frond, which
 * from any distance is a spike.
 */
function frondGeo(length: number, width: number, droop: number): THREE.BufferGeometry {
  const SEGMENTS = 7;
  const positions: number[] = [];
  const uvs: number[] = [];

  const point = (t: number, side: number): [number, number, number] => {
    // Narrow toward the tip, and lift the leading edge into a shallow V.
    const taper = Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.82) ** 0.7;
    const w = width * taper * side;
    const y = -droop * t * t;
    const rib = -Math.abs(side) * width * taper * 0.28;
    return [w, y + rib, t * length];
  };

  for (let i = 0; i < SEGMENTS; i++) {
    const t0 = i / SEGMENTS;
    const t1 = (i + 1) / SEGMENTS;
    for (const side of [-1, 1]) {
      // Each half of the frond is its own strip, meeting at the mid-rib.
      const a = point(t0, 0);
      const b = point(t0, side);
      const cc = point(t1, side);
      const d = point(t1, 0);
      // Wound so both halves face upward.
      const tri = side < 0 ? [a, b, cc, a, cc, d] : [a, cc, b, a, d, cc];
      for (const v of tri) positions.push(v[0], v[1], v[2]);
      for (let k = 0; k < 6; k++) uvs.push(0, 0);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * A palm: a leaning, segmented trunk under a crown of drooping fronds.
 *
 * The trunk is stacked rather than a single cylinder because a palm does not
 * grow straight — the lean and the slight curve in it are most of what makes a
 * row of them read as a coast road rather than as a row of poles, and a
 * segmented stack is the cheapest way to bend one.
 */
function palmGeo(): THREE.BufferGeometry {
  const parts: Part[] = [];

  const HEIGHT = 6.2;
  const RINGS = 7;
  const lean = 0.42;
  for (let i = 0; i < RINGS; i++) {
    const t = i / RINGS;
    const t1 = (i + 1) / RINGS;
    const seg = new THREE.CylinderGeometry(
      0.3 - t1 * 0.16, 0.32 - t * 0.16, (HEIGHT / RINGS) * 1.06, 7,
    );
    // Curve out of the ground and back toward vertical, which is the shape of
    // a palm that has spent its life leaning away from the prevailing wind.
    const bend = lean * t * t;
    parts.push({
      geo: seg,
      matrix: new THREE.Matrix4()
        .makeTranslation(bend * 1.5, HEIGHT * (t + t1) * 0.5, 0)
        .multiply(new THREE.Matrix4().makeRotationZ(-lean * t * 0.8)),
      colour: 0x6b5238,
    });
  }

  const crownX = lean * 1.5;
  const crownY = HEIGHT + 0.1;

  // Nine fronds around the crown at three different pitches, so the silhouette
  // has depth instead of being a flat wheel of spokes.
  const frondLong = frondGeo(3.4, 0.46, 1.7);
  const frondShort = frondGeo(2.5, 0.38, 1.1);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const pitch = i % 3 === 0 ? 0.55 : i % 3 === 1 ? 0.18 : -0.12;
    parts.push({
      geo: i % 3 === 2 ? frondShort : frondLong,
      matrix: new THREE.Matrix4()
        .makeTranslation(crownX, crownY, 0)
        .multiply(new THREE.Matrix4().makeRotationY(a))
        .multiply(new THREE.Matrix4().makeRotationX(-pitch)),
      colour: i % 3 === 2 ? 0x2f6f42 : 0x3f8a4e,
    });
  }

  // A few coconuts tucked under the crown.
  const nut = new THREE.IcosahedronGeometry(0.17, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push({
      geo: nut,
      matrix: at(crownX + Math.cos(a) * 0.26, crownY - 0.24, Math.sin(a) * 0.26),
      colour: 0x6f5a3a,
    });
  }

  const geo = merge(parts);
  for (const part of parts) part.geo.dispose();
  nut.dispose();
  return geo;
}

/**
 * A tuft of scrub grass: a handful of crossed blades.
 *
 * Cheap and numerous rather than detailed. The verge was flat colour with props
 * standing on it, and nothing sells "ground" like something small growing out
 * of it — the eye reads the scale of the world from the smallest thing in it,
 * and until now the smallest thing beside this road was a boulder.
 */
function scrubGeo(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const blade = frondGeo(0.85, 0.075, 0.42);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.9;
    const lift = 0.75 + (i % 3) * 0.28;
    parts.push({
      geo: blade,
      matrix: new THREE.Matrix4()
        .makeTranslation(Math.cos(a) * 0.1, 0.04, Math.sin(a) * 0.1)
        .multiply(new THREE.Matrix4().makeRotationY(a))
        .multiply(new THREE.Matrix4().makeRotationX(-1.05))
        .multiply(new THREE.Matrix4().makeScale(1, lift, lift)),
      colour: i % 2 ? 0x7f8a45 : 0x69803c,
    });
  }
  const geo = merge(parts);
  blade.dispose();
  return geo;
}

/** A low bush: overlapping lumps, for the middle distance of a verge. */
function bushGeo(): THREE.BufferGeometry {
  const lump = new THREE.IcosahedronGeometry(0.62, 0);
  const parts: Part[] = [
    { geo: lump, matrix: at(0, 0.5, 0, 1.25, 0.86, 1.1), colour: 0x4d6b34 },
    { geo: lump, matrix: at(0.5, 0.36, 0.24, 0.78, 0.66, 0.78), colour: 0x5b7a3c },
    { geo: lump, matrix: at(-0.42, 0.34, -0.2, 0.7, 0.6, 0.7), colour: 0x415c2c },
  ];
  const geo = merge(parts);
  lump.dispose();
  return geo;
}

function cactusGeo(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.42, 0.5, 3.6, 8);
  const arm = new THREE.CylinderGeometry(0.24, 0.26, 1.5, 6);
  const geo = merge([
    { geo: body, matrix: at(0, 1.8, 0), colour: 0x4d7a4a },
    { geo: arm, matrix: new THREE.Matrix4().makeTranslation(0.62, 2.5, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(-0.85)), colour: 0x568455 },
    { geo: arm, matrix: at(0.86, 3.1, 0), colour: 0x568455 },
    { geo: arm, matrix: new THREE.Matrix4().makeTranslation(-0.58, 2.1, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(0.9)), colour: 0x44704a },
  ]);
  body.dispose(); arm.dispose();
  return geo;
}

function rockGeo(): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(1.2, 0);
  const merged = merge([{ geo: g, matrix: at(0, 0.75, 0, 1.25, 0.78, 1.05), colour: 0x8a7a66 }]);
  g.dispose();
  return merged;
}

function towerGeo(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(6.4, 26, 6.4);
  const merged = merge([{ geo: g, matrix: at(0, 13, 0), colour: 0xffffff }]);
  g.dispose();
  return merged;
}

function blockGeo(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(7.6, 11, 7.6);
  const roof = new THREE.BoxGeometry(3.2, 1.6, 3.2);
  const geo = merge([
    { geo: base, matrix: at(0, 5.5, 0), colour: 0x6e7480 },
    { geo: roof, matrix: at(0, 11.8, 0), colour: 0x5a606b },
  ]);
  base.dispose(); roof.dispose();
  return geo;
}

function signGeo(): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.13, 0.13, 4.4, 6);
  const board = new THREE.BoxGeometry(3.6, 1.9, 0.16);
  const geo = merge([
    { geo: post, matrix: at(-1.3, 2.2, 0), colour: 0x8f97a3 },
    { geo: post, matrix: at(1.3, 2.2, 0), colour: 0x8f97a3 },
    { geo: board, matrix: at(0, 4.2, 0), colour: 0x2f8f5c },
    { geo: board, matrix: at(0, 4.2, 0.09, 0.9, 0.78, 0.4), colour: 0xe8eef0 },
  ]);
  post.dispose(); board.dispose();
  return geo;
}

function pylonGeo(): THREE.BufferGeometry {
  const leg = new THREE.BoxGeometry(0.3, 14, 0.3);
  const arm = new THREE.BoxGeometry(7, 0.32, 0.32);
  const geo = merge([
    { geo: leg, matrix: at(-1, 7, 0), colour: 0x9aa2ae },
    { geo: leg, matrix: at(1, 7, 0), colour: 0x9aa2ae },
    { geo: arm, matrix: at(0, 11.4, 0), colour: 0x8a939f },
    { geo: arm, matrix: at(0, 13.4, 0), colour: 0x8a939f },
  ]);
  leg.dispose(); arm.dispose();
  return geo;
}

function duneGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const merged = merge([{ geo: g, matrix: at(0, 0, 0, 1.6, 0.42, 1.2), colour: 0xc9a879 }]);
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
        { id: 'pine', geometry: pineGeo(), material: FOLIAGE, count: 150, radius: 1.9, scale: [0.8, 1.5], offset: [3, 46], sink: 0.2 },
        { id: 'broadleaf', geometry: broadleafGeo(), material: FOLIAGE, count: 80, radius: 2.1, scale: [0.75, 1.3], offset: [4, 42], sink: 0.2 },
        { id: 'bush', geometry: bushGeo(), material: FOLIAGE, count: 110, radius: 0.9, scale: [0.7, 1.6], offset: [2, 26], sink: 0.12 },
        { id: 'scrub', geometry: scrubGeo(), material: FOLIAGE, count: 200, radius: 0.5, scale: [0.7, 1.7], offset: [1.2, 20], sink: 0.05 },
        { id: 'rock', geometry: rockGeo(), material: ROCK, count: 34, radius: 1.5, scale: [0.6, 1.4], offset: [2.5, 22], sink: 0.35 },
      ];
    case 'city':
      return [
        { id: 'tower', geometry: towerGeo(), material: building(), count: 44, radius: 3.2, scale: [0.7, 1.8], offset: [9, 56], sink: 0 },
        { id: 'block', geometry: blockGeo(), material: CONCRETE, count: 46, radius: 3.8, scale: [0.7, 1.35], offset: [6, 40], sink: 0 },
        { id: 'pylon', geometry: pylonGeo(), material: METAL, count: 20, radius: 1.2, scale: [0.85, 1.2], offset: [4, 16], sink: 0 },
        { id: 'scrub', geometry: scrubGeo(), material: FOLIAGE, count: 140, radius: 0.5, scale: [0.6, 1.2], offset: [1.2, 12], sink: 0.05 },
      ];
    case 'desert':
      return [
        { id: 'cactus', geometry: cactusGeo(), material: FOLIAGE, count: 70, radius: 0.9, scale: [0.7, 1.5], offset: [3, 40], sink: 0.15 },
        { id: 'scrub', geometry: scrubGeo(), material: FOLIAGE, count: 170, radius: 0.5, scale: [0.6, 1.3], offset: [1.2, 30], sink: 0.05 },
        { id: 'rock', geometry: rockGeo(), material: ROCK, count: 60, radius: 1.5, scale: [0.5, 2.1], offset: [3, 52], sink: 0.35 },
        { id: 'dune', geometry: duneGeo(), material: ROCK, count: 26, radius: 8, scale: [0.9, 2.2], offset: [16, 64], sink: 0.5 },
      ];
    case 'coast':
      return [
        { id: 'palm', geometry: palmGeo(), material: FOLIAGE, count: 84, radius: 1.2, scale: [0.75, 1.35], offset: [3, 34], sink: 0.2 },
        { id: 'scrub', geometry: scrubGeo(), material: FOLIAGE, count: 220, radius: 0.5, scale: [0.7, 1.6], offset: [1.2, 26], sink: 0.05 },
        { id: 'bush', geometry: bushGeo(), material: FOLIAGE, count: 90, radius: 0.9, scale: [0.6, 1.3], offset: [2, 30], sink: 0.12 },
        { id: 'rock', geometry: rockGeo(), material: ROCK, count: 48, radius: 1.5, scale: [0.5, 1.6], offset: [3, 44], sink: 0.35 },
        { id: 'sign', geometry: signGeo(), material: PAINTED, count: 16, radius: 1.9, scale: [0.9, 1.1], offset: [2.5, 7], sink: 0 },
      ];
    case 'tunnel':
      // Inside a tunnel there is nothing to see beside the road, by definition.
      return [];
  }
}

/** Materials shared across biomes; disposed once at teardown. */
export function disposePropMaterials(): void {
  for (const m of [FOLIAGE, ROCK, CONCRETE, METAL, PAINTED]) {
    m.dispose();
  }
  buildingMat?.map?.dispose();
  buildingMat?.dispose();
  buildingMat = null;
}
