import * as THREE from 'three';
import type { BiomeId } from '@/core/GameEvents';
import { PALM_VARIANTS, palmGeometry, palmMaterial } from './props/Palm';
import { streetLampGeometry, streetLampMaterial } from './props/StreetLamp';
import { RAILING_BAY, railingGeometry, railingMaterial } from './props/Railing';
import { GUARDRAIL_BAY, guardrailGeometry, guardrailMaterial, pineGeometry, plantMaterial, saguaroGeometry } from './props/Roadside';
import { BuildingMaterial } from './buildings/BuildingMaterial';

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
  /**
   * Street furniture on a regular cadence, exempt from the scenery density
   * dial.
   *
   * Thinning scrub is what a density setting is for — half as many bushes is
   * the same road with less detail on it. Thinning lamp standards is not: a
   * boulevard with every second lamp missing is a different road, and the
   * regular rhythm down the verge is the thing being drawn rather than an
   * accumulation of detail. These kinds are cheap enough to keep whole at
   * every tier, and are counted in units of tens.
   *
   * The value is the along-road pitch in world units, and setting it also opts
   * the kind out of the random scatter: cadence kinds are laid sequentially
   * down each verge on a world-anchored grid, half the instances to a side. A
   * scattered rhythm is not a rhythm — it was placing railing sections in
   * clumps with gaps between them, where a railing's whole job is to be one
   * unbroken line to the vanishing point.
   *
   * Keep the pitch a divisor of `BAND_LENGTH`, or the grid shifts under the
   * player every time the band is rebuilt.
   */
  readonly cadence?: number;
  /**
   * Offset of a laid kind along its own grid, in world units, so two kinds on
   * the same pitch can alternate — a palm between every pair of lamps rather
   * than growing out of the base of one.
   */
  readonly phase?: number;
  /**
   * Colours an instance can be tinted, picked per instance from its own
   * stable slot. For kinds whose material reads the instance colour — the
   * facade shader takes both its wall colour and its style seed from it.
   */
  readonly tints?: readonly number[];
  /**
   * Square to the road rather than turned at random: buildings. A block at a
   * random angle to the street reads as rubble.
   */
  readonly aligned?: boolean;
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
let facadeMat: BuildingMaterial | null = null;
let plantsMat: THREE.MeshStandardMaterial | null = null;
let guardMat: THREE.MeshStandardMaterial | null = null;

function facades(): BuildingMaterial {
  facadeMat ??= new BuildingMaterial([0, 4]);
  return facadeMat;
}

function plants(): THREE.MeshStandardMaterial {
  plantsMat ??= plantMaterial();
  return plantsMat;
}

function guardrails(): THREE.MeshStandardMaterial {
  guardMat ??= guardrailMaterial();
  return guardMat;
}

/** A block of the given size in metres, standing on its base. */
function sizedBlock(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return g;
}

/** City walls: stone, cream, white, glass-grey and the coast's warm pastels. */
const CITY_TINTS = [0xe8e8e4, 0xc8ccd0, 0xb8c4d0, 0xd8cbb4, 0xefd9a8, 0xe2b98a, 0xf2ead8, 0x9aa6b4] as const;
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
  const LEAFLETS = 13;
  const positions: number[] = [];
  const uvs: number[] = [];

  /** A point on the drooping mid-rib. */
  const rib = (t: number): [number, number, number] => [0, -droop * t * t, t * length];

  const push = (v: [number, number, number][]): void => {
    for (const q of v) positions.push(q[0], q[1], q[2]);
    for (let k = 0; k < v.length; k++) uvs.push(0, 0);
  };

  // The rib itself, as a narrow strip, so the frond has a spine holding the
  // leaflets rather than a gap down the middle where they meet.
  for (let i = 0; i < LEAFLETS; i++) {
    const t0 = i / LEAFLETS;
    const t1 = (i + 1) / LEAFLETS;
    const a = rib(t0);
    const b = rib(t1);
    const h = width * 0.06;
    push([[-h, a[1], a[2]], [h, a[1], a[2]], [h, b[1], b[2]]]);
    push([[-h, a[1], a[2]], [h, b[1], b[2]], [-h, b[1], b[2]]]);
  }

  /* Leaflets, one pair per station, each a blade off the rib.
   *
   * This is the whole change. A frond built as one continuous tapering strip
   * has a smooth outline, and a smooth green outline at any distance is a
   * leaf — the shape says "banana", not "palm". What identifies a palm is that
   * its edge is *serrated*: a row of separate blades with sky between them.
   * Thirteen pairs of triangles cost about what the strip did and read as a
   * palm from the far end of the road.
   */
  for (let i = 0; i < LEAFLETS; i++) {
    const t0 = 0.06 + (i / LEAFLETS) * 0.94;
    const t1 = Math.min(1, t0 + 1.35 / LEAFLETS);
    // Short at the base, longest at two-thirds, tapering to the tip.
    const taper = Math.sin(Math.min(1, t0 * 1.08) * Math.PI * 0.86) ** 0.62;
    const w = width * taper;
    const a = rib(t0);
    const b = rib(t1);
    for (const side of [-1, 1]) {
      // Swept back along the frond and hanging below it, which is what stops
      // the crown reading as a flat wheel of spokes.
      const tip: [number, number, number] = [
        side * w,
        a[1] - droop * 0.26 * taper - w * 0.18,
        a[2] + w * 0.62,
      ];
      push(side < 0 ? [a, b, tip] : [a, tip, b]);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
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

function rockGeo(): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(1.2, 0);
  const merged = merge([{ geo: g, matrix: at(0, 0.75, 0, 1.25, 0.78, 1.05), colour: 0x8a7a66 }]);
  g.dispose();
  return merged;
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
        { id: 'pine-a', geometry: pineGeometry(5), material: plants(), count: 80, radius: 2.6, scale: [0.8, 1.25], offset: [4, 46], sink: 0.2 },
        { id: 'pine-b', geometry: pineGeometry(17), material: plants(), count: 70, radius: 2.6, scale: [0.8, 1.2], offset: [5, 52], sink: 0.2 },
        { id: 'broadleaf', geometry: broadleafGeo(), material: FOLIAGE, count: 80, radius: 2.1, scale: [0.75, 1.3], offset: [4, 42], sink: 0.2 },
        { id: 'bush', geometry: bushGeo(), material: FOLIAGE, count: 110, radius: 0.9, scale: [0.7, 1.6], offset: [2, 26], sink: 0.12 },
        { id: 'scrub', geometry: scrubGeo(), material: FOLIAGE, count: 200, radius: 0.5, scale: [0.7, 1.7], offset: [1.2, 20], sink: 0.05 },
        { id: 'rock', geometry: rockGeo(), material: ROCK, count: 34, radius: 1.5, scale: [0.6, 1.4], offset: [2.5, 22], sink: 0.35 },
        { id: 'guardrail', geometry: guardrailGeometry(), material: guardrails(), count: 264, radius: 0.12, scale: [1, 1], offset: [0.2, 0.2], sink: -0.16, cadence: GUARDRAIL_BAY },
      ];
    case 'city':
      return [
        // Towers and mid-rise blocks on the facade shader, squared to the street.
        { id: 'city-tower', geometry: sizedBlock(16, 46, 16), material: facades(), count: 30, radius: 8, scale: [0.75, 1.5], offset: [8, 60], sink: 0.6, tints: CITY_TINTS, aligned: true },
        { id: 'city-block', geometry: sizedBlock(24, 18, 18), material: facades(), count: 34, radius: 12, scale: [0.8, 1.3], offset: [6, 46], sink: 0.6, tints: CITY_TINTS, aligned: true },
        // The boulevard furniture the coast has: lamps, a row of palms, railings.
        { id: 'lamp', geometry: streetLampGeometry(), material: streetLampMaterial(), count: 48, radius: 0.3, scale: [1, 1], offset: [0.5, 0.5], sink: 0, cadence: 20 },
        { id: 'palm-row', geometry: palmGeometry(PALM_VARIANTS[0]), material: palmMaterial(), count: 44, radius: 0.35, scale: [0.94, 1.06], offset: [2.2, 2.2], sink: 0.05, cadence: 20, phase: 10 },
        { id: 'railing', geometry: railingGeometry(), material: railingMaterial(), count: 264, radius: 0.04, scale: [1, 1], offset: [0.1, 0.1], sink: -0.16, cadence: RAILING_BAY },
      ];
    case 'desert':
      return [
        { id: 'saguaro-a', geometry: saguaroGeometry(3), material: plants(), count: 40, radius: 0.9, scale: [0.85, 1.25], offset: [4, 44], sink: 0.1 },
        { id: 'saguaro-b', geometry: saguaroGeometry(11), material: plants(), count: 34, radius: 0.9, scale: [0.8, 1.2], offset: [6, 50], sink: 0.1 },
        { id: 'scrub', geometry: scrubGeo(), material: FOLIAGE, count: 170, radius: 0.5, scale: [0.6, 1.3], offset: [1.2, 30], sink: 0.05 },
        { id: 'rock', geometry: rockGeo(), material: ROCK, count: 60, radius: 1.5, scale: [0.5, 2.1], offset: [3, 52], sink: 0.35 },
        { id: 'dune', geometry: duneGeo(), material: ROCK, count: 26, radius: 8, scale: [0.9, 2.2], offset: [16, 64], sink: 0.5 },
        { id: 'guardrail', geometry: guardrailGeometry(), material: guardrails(), count: 264, radius: 0.12, scale: [1, 1], offset: [0.2, 0.2], sink: -0.16, cadence: GUARDRAIL_BAY },
      ];
    case 'coast':
      return [
        /* Palms planted down both pavements on the lamp rhythm, halfway
         * between standards — a boulevard, which is what the reference is —
         * and more of them scattered through the verge behind. */
        { id: 'palm-row', geometry: palmGeometry(PALM_VARIANTS[0]), material: palmMaterial(), count: 44, radius: 0.35, scale: [0.94, 1.06], offset: [2.2, 2.2], sink: 0.05, cadence: 20, phase: 10 },
        { id: 'palm-tall', geometry: palmGeometry(PALM_VARIANTS[1]), material: palmMaterial(), count: 34, radius: 0.4, scale: [0.85, 1.15], offset: [6, 36], sink: 0.1 },
        { id: 'palm-short', geometry: palmGeometry(PALM_VARIANTS[2]), material: palmMaterial(), count: 34, radius: 0.4, scale: [0.85, 1.15], offset: [5, 42], sink: 0.1 },
        // Lamp standards at the kerb, arms out over the carriageway, one every
        // twenty units down each side.
        { id: 'lamp', geometry: streetLampGeometry(), material: streetLampMaterial(), count: 48, radius: 0.3, scale: [1, 1], offset: [0.5, 0.5], sink: 0, cadence: 20 },
        // The balustrade along the kerb, standing on the pavement, at a fixed
        // scale: a railing that varies in size along its run is not one line.
        { id: 'railing', geometry: railingGeometry(), material: railingMaterial(), count: 264, radius: 0.04, scale: [1, 1], offset: [0.1, 0.1], sink: -0.16, cadence: RAILING_BAY },
        // Planting on the verge behind the pavement.
        { id: 'scrub', geometry: scrubGeo(), material: FOLIAGE, count: 200, radius: 0.5, scale: [0.7, 1.6], offset: [5.4, 26], sink: 0.05 },
        { id: 'bush', geometry: bushGeo(), material: FOLIAGE, count: 90, radius: 0.9, scale: [0.6, 1.3], offset: [5.6, 30], sink: 0.12 },
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
  facadeMat?.dispose();
  facadeMat = null;
  plantsMat?.dispose();
  plantsMat = null;
  guardMat?.dispose();
  guardMat = null;
}
