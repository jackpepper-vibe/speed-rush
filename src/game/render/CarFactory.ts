import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { TrafficKind } from '@/core/GameEvents';
import type { CarDef } from '@/game/config/Cars';
import { makeGlowTexture } from './RoadTextures';

/**
 * Procedural car meshes.
 *
 * Everything is built from bevelled boxes and lathed tyres rather than plain
 * cuboids and cylinders. Nothing on a real car is a true box, and the eye reads
 * the highlight running along a rounded edge long before it reads the shape —
 * which is why the first build looked like luggage however carefully the
 * proportions were set.
 *
 * Geometry and materials are shared through a cache, because the road holds
 * dozens of cars at once and a fresh box per vehicle is how the original ended
 * up allocating a new material for every spawn.
 *
 * Detail is tiered. The player's car is on screen at all times and close to the
 * camera, so it gets the full treatment: spoked rims, mirrors, exhausts, a
 * grille. Traffic is numerous and mostly seen from behind at distance, so it
 * gets a cheaper build — thirty-odd cars at the player's triangle count is a
 * frame budget spent on wheel spokes nobody will ever see.
 */

export type Detail = 'high' | 'low';

export interface CarMesh extends THREE.Group {
  userData: {
    wheels: THREE.Object3D[];
    brakeLights: THREE.MeshStandardMaterial;
    headlights: THREE.SpotLight[];
    glow?: THREE.Mesh;
  };
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = build();
    geoCache.set(key, g);
  }
  return g;
}

/** A box with bevelled edges. The workhorse: every panel on every car. */
function bevel(w: number, h: number, d: number, radius = 0.06, segments = 2): THREE.BufferGeometry {
  const r = Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return cached(`bev${w}:${h}:${d}:${r}:${segments}`,
    () => new RoundedBoxGeometry(w, h, d, segments, r));
}

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return cached(`box${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
}

function cyl(r: number, h: number, seg = 12): THREE.BufferGeometry {
  return cached(`cyl${r}:${h}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

/**
 * A tyre, as a revolved cross-section.
 *
 * A cylinder gives a hard square shoulder that catches the light like a tin
 * can. Lathing a profile with a rounded shoulder is barely more geometry and is
 * most of the difference between "wheel" and "roller".
 */
function tyreGeo(radius: number, halfWidth: number, seg: number): THREE.BufferGeometry {
  return cached(`tyre${radius}:${halfWidth}:${seg}`, () => {
    const rim = radius * 0.62;
    const profile = [
      new THREE.Vector2(rim, -halfWidth),
      new THREE.Vector2(radius * 0.93, -halfWidth),
      new THREE.Vector2(radius, -halfWidth * 0.55),
      new THREE.Vector2(radius, halfWidth * 0.55),
      new THREE.Vector2(radius * 0.93, halfWidth),
      new THREE.Vector2(rim, halfWidth),
    ];
    const g = new THREE.LatheGeometry(profile, seg);
    g.rotateZ(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * A body panel whose roof is drawn in.
 *
 * Applied to a bevelled box rather than a plain one, so the taper keeps the
 * rounded edges instead of flattening them back out.
 */
function tapered(
  w: number, h: number, d: number,
  topScaleX: number, topScaleZ: number,
  radius = 0.06, segments = 2,
): THREE.BufferGeometry {
  const key = `tap${w}:${h}:${d}:${topScaleX}:${topScaleZ}:${radius}:${segments}`;
  return cached(key, () => {
    const g = bevel(w, h, d, radius, segments).clone();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const half = h / 2;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      // Blend the taper in across the upper half, so the waistline is a curve
      // rather than a crease at the midpoint.
      const t = Math.max(0, y / half);
      const ease = t * t * (3 - 2 * t);
      pos.setX(i, pos.getX(i) * (1 + (topScaleX - 1) * ease));
      pos.setZ(i, pos.getZ(i) * (1 + (topScaleZ - 1) * ease));
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  });
}

/* ------------------------------------------------------------- materials */

const RUBBER = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.94, metalness: 0 });
const CHROME = new THREE.MeshStandardMaterial({ color: 0xc8cfd8, roughness: 0.18, metalness: 1 });
const RIM = new THREE.MeshStandardMaterial({ color: 0xaab2be, roughness: 0.3, metalness: 0.95 });
const PLASTIC = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.72, metalness: 0.05 });
const GRILLE = new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.55, metalness: 0.45 });

/**
 * Car glass.
 *
 * Alpha blending with a clearcoat, deliberately not `transmission`. Physical
 * transmission makes three.js render the scene into a separate target every
 * frame; with glass on every car in traffic that is an extra full pass for an
 * effect nobody can see through a rear window at 200 km/h, and it was enough to
 * lose the WebGL context outright on a software rasteriser.
 */
const GLASS = new THREE.MeshPhysicalMaterial({
  color: 0x121e2a,
  roughness: 0.06,
  metalness: 0.2,
  transparent: true,
  opacity: 0.7,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  envMapIntensity: 1.6,
});

const LAMP = new THREE.MeshStandardMaterial({
  color: 0xfff6e0, emissive: 0xfff0cc, emissiveIntensity: 2.2, roughness: 0.25,
});

const paintCache = new Map<number, THREE.MeshPhysicalMaterial>();

/**
 * Car paint.
 *
 * Metallic flake under a clearcoat, with the scene environment doing the
 * reflecting — which is what makes a panel change as the sky does, rather than
 * staying the same flat colour from dawn to midnight.
 */
function paint(color: number): THREE.MeshPhysicalMaterial {
  let m = paintCache.get(color);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.34,
      metalness: 0.75,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.15,
    });
    paintCache.set(color, m);
  }
  return m;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (!glowTex) glowTex = makeGlowTexture();
  return glowTex;
}

/* -------------------------------------------------------------- profiles */

interface Profile {
  len: number; wid: number; hgt: number;
  /** Cabin scale and its position along the body. */
  cabX: number; cabZ: number; cabOffset: number;
  /** How far the nose drops relative to the body. */
  nose: number;
  wheelR: number;
  /** Ride height as a fraction of wheel radius. */
  ride: number;
  spoiler: 'none' | 'lip' | 'wing';
}

const PROFILE: Record<string, Profile> = {
  hatch: { len: 4.2, wid: 1.84, hgt: 0.7, cabX: 0.9, cabZ: 0.8, cabOffset: 0.1, nose: 0.62, wheelR: 0.34, ride: 0.9, spoiler: 'lip' },
  coupe: { len: 4.6, wid: 1.9, hgt: 0.6, cabX: 0.86, cabZ: 0.62, cabOffset: 0.06, nose: 0.5, wheelR: 0.35, ride: 0.84, spoiler: 'lip' },
  muscle: { len: 4.95, wid: 2.02, hgt: 0.66, cabX: 0.88, cabZ: 0.56, cabOffset: 0.1, nose: 0.7, wheelR: 0.38, ride: 0.86, spoiler: 'wing' },
  wedge: { len: 4.7, wid: 1.96, hgt: 0.52, cabX: 0.82, cabZ: 0.58, cabOffset: 0.02, nose: 0.36, wheelR: 0.35, ride: 0.78, spoiler: 'wing' },
  super: { len: 4.75, wid: 2.06, hgt: 0.5, cabX: 0.78, cabZ: 0.5, cabOffset: -0.04, nose: 0.32, wheelR: 0.36, ride: 0.74, spoiler: 'wing' },
  hyper: { len: 4.85, wid: 2.12, hgt: 0.46, cabX: 0.74, cabZ: 0.46, cabOffset: -0.08, nose: 0.28, wheelR: 0.37, ride: 0.7, spoiler: 'wing' },
  sedan: { len: 4.55, wid: 1.86, hgt: 0.64, cabX: 0.9, cabZ: 0.74, cabOffset: 0.04, nose: 0.62, wheelR: 0.34, ride: 0.9, spoiler: 'none' },
  suv: { len: 4.8, wid: 2, hgt: 0.98, cabX: 0.93, cabZ: 0.84, cabOffset: 0.02, nose: 0.8, wheelR: 0.42, ride: 1.02, spoiler: 'none' },
  van: { len: 5.3, wid: 2.04, hgt: 1.26, cabX: 0.96, cabZ: 0.94, cabOffset: 0.1, nose: 0.88, wheelR: 0.4, ride: 1, spoiler: 'none' },
};

/* ----------------------------------------------------------------- parts */

function addWheel(
  group: CarMesh, x: number, z: number, radius: number, detail: Detail,
): void {
  const hub = new THREE.Group();
  hub.position.set(x, radius, z);

  const seg = detail === 'high' ? 20 : 11;
  const tyre = new THREE.Mesh(tyreGeo(radius, radius * 0.34, seg), RUBBER);
  tyre.castShadow = true;
  hub.add(tyre);

  const face = new THREE.Mesh(cyl(radius * 0.62, radius * 0.5, detail === 'high' ? 18 : 10), RIM);
  hub.add(face);

  if (detail === 'high') {
    // Five spokes and a hub cap. Only ever seen on the player's car.
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(box(radius * 0.16, radius * 1.12, radius * 0.42), RIM);
      spoke.rotation.x = (i / 5) * Math.PI * 2;
      hub.add(spoke);
    }
    const cap = new THREE.Mesh(cyl(radius * 0.2, radius * 0.56, 10), CHROME);
    hub.add(cap);
  }

  group.add(hub);
  group.userData.wheels.push(hub);
}

/* ----------------------------------------------------------------- build */

export function buildCar(opts: {
  profile: string;
  color: number;
  trim: number;
  glow?: number;
  isPlayer?: boolean;
  headlights?: boolean;
  detail?: Detail;
}): CarMesh {
  const p = PROFILE[opts.profile] ?? PROFILE.sedan;
  const detail = opts.detail ?? (opts.isPlayer ? 'high' : 'low');
  const seg = detail === 'high' ? 3 : 1;

  const group = new THREE.Group() as CarMesh;
  group.userData = { wheels: [], brakeLights: null as never, headlights: [] };

  const body = paint(opts.color);
  const trimMat = new THREE.MeshStandardMaterial({ color: opts.trim, roughness: 0.5, metalness: 0.5 });

  const sill = p.wheelR * p.ride;
  const bodyY = sill + p.hgt / 2;

  /* Main body: waisted, so the flanks curve in toward the roof. */
  const lower = new THREE.Mesh(tapered(p.wid, p.hgt, p.len, 0.94, 0.985, 0.1, seg), body);
  lower.position.y = bodyY;
  lower.castShadow = true;
  lower.receiveShadow = true;
  group.add(lower);

  /* Nose: a second, lower volume that drops toward the bumper. */
  const noseH = p.hgt * p.nose;
  const nose = new THREE.Mesh(tapered(p.wid * 0.96, noseH, p.len * 0.3, 0.88, 0.72, 0.08, seg), body);
  nose.position.set(0, sill + noseH / 2 + p.hgt * 0.1, -p.len * 0.38);
  nose.castShadow = true;
  group.add(nose);

  /* Cabin and its glasshouse. */
  const cabinH = p.hgt * (p.cabZ > 0.8 ? 1.05 : 0.8);
  const cabinZ = p.len * p.cabZ;
  const cabin = new THREE.Mesh(
    tapered(p.wid * p.cabX, cabinH, cabinZ, 0.86, 0.74, 0.12, seg), body,
  );
  cabin.position.set(0, sill + p.hgt + cabinH / 2 - 0.06, p.len * p.cabOffset);
  cabin.castShadow = true;
  group.add(cabin);

  const glass = new THREE.Mesh(
    tapered(p.wid * p.cabX * 0.96, cabinH * 0.78, cabinZ * 0.94, 0.86, 0.76, 0.1, seg), GLASS,
  );
  glass.position.copy(cabin.position);
  glass.position.y += 0.035;
  group.add(glass);

  /* Sills, bumpers, grille. */
  const sillBar = new THREE.Mesh(bevel(p.wid * 1.005, 0.16, p.len * 0.82, 0.05, 1), trimMat);
  sillBar.position.y = sill * 0.62;
  group.add(sillBar);

  for (const [z, w] of [[-p.len / 2 + 0.06, 0.99], [p.len / 2 - 0.06, 0.99]] as const) {
    const bumper = new THREE.Mesh(bevel(p.wid * w, 0.24, 0.3, 0.09, 1), PLASTIC);
    bumper.position.set(0, sill + 0.16, z);
    group.add(bumper);
  }

  const grille = new THREE.Mesh(box(p.wid * 0.52, noseH * 0.42, 0.08), GRILLE);
  grille.position.set(0, sill + noseH * 0.6, -p.len / 2 - 0.01);
  group.add(grille);

  /* Lights. Housings sit proud of the panel so they catch an edge highlight. */
  for (const sx of [-1, 1]) {
    const housing = new THREE.Mesh(bevel(p.wid * 0.26, 0.15, 0.13, 0.05, 1), PLASTIC);
    housing.position.set(sx * p.wid * 0.32, sill + noseH * 0.78, -p.len / 2 + 0.02);
    group.add(housing);

    const lamp = new THREE.Mesh(box(p.wid * 0.2, 0.1, 0.06), LAMP);
    lamp.position.set(sx * p.wid * 0.32, sill + noseH * 0.78, -p.len / 2 - 0.04);
    group.add(lamp);

    if (opts.headlights) {
      const spot = new THREE.SpotLight(0xfff2d4, 0, 78, 0.42, 0.55, 1.4);
      spot.position.set(sx * p.wid * 0.31, sill + noseH * 0.78, -p.len / 2);
      spot.target.position.set(sx * 0.5, 0, -46);
      group.add(spot);
      group.add(spot.target);
      group.userData.headlights.push(spot);
    }
  }

  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x3a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.32, roughness: 0.35,
  });
  group.userData.brakeLights = brakeMat;
  for (const sx of [-1, 1]) {
    const cluster = new THREE.Mesh(bevel(p.wid * 0.27, 0.14, 0.1, 0.04, 1), brakeMat);
    cluster.position.set(sx * p.wid * 0.31, sill + p.hgt * 0.72, p.len / 2 + 0.02);
    group.add(cluster);
  }

  /* Mirrors: small, but the silhouette is wrong without them. */
  for (const sx of [-1, 1]) {
    const stalk = new THREE.Mesh(box(0.12, 0.05, 0.05), PLASTIC);
    stalk.position.set(sx * (p.wid * p.cabX * 0.5 + 0.06), sill + p.hgt + cabinH * 0.52, p.len * p.cabOffset - cabinZ * 0.3);
    group.add(stalk);
    const shell = new THREE.Mesh(bevel(0.14, 0.09, 0.11, 0.035, 1), trimMat);
    shell.position.set(sx * (p.wid * p.cabX * 0.5 + 0.15), sill + p.hgt + cabinH * 0.52, p.len * p.cabOffset - cabinZ * 0.3);
    group.add(shell);
  }

  /* Exhausts. */
  for (const sx of [-1, 1]) {
    const pipe = new THREE.Mesh(cyl(0.07, 0.16, 8), CHROME);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(sx * p.wid * 0.28, sill * 0.5, p.len / 2 + 0.04);
    group.add(pipe);
  }

  /* Wheels, set into the arches. */
  const axle = p.len * 0.315;
  const wheelX = p.wid / 2 - p.wheelR * 0.34;
  for (const [x, z] of [[-wheelX, -axle], [wheelX, -axle], [-wheelX, axle], [wheelX, axle]] as const) {
    addWheel(group, x, z, p.wheelR, detail);
  }

  /* Spoiler. */
  if (p.spoiler === 'wing') {
    const blade = new THREE.Mesh(bevel(p.wid * 0.9, 0.08, 0.32, 0.03, 1), trimMat);
    blade.position.set(0, sill + p.hgt + cabinH * 0.72, p.len / 2 - 0.2);
    blade.castShadow = true;
    group.add(blade);
    for (const sx of [-1, 1]) {
      const stay = new THREE.Mesh(box(0.07, 0.2, 0.1), trimMat);
      stay.position.set(sx * p.wid * 0.33, sill + p.hgt + cabinH * 0.6, p.len / 2 - 0.2);
      group.add(stay);
    }
  } else if (p.spoiler === 'lip') {
    const lip = new THREE.Mesh(bevel(p.wid * 0.86, 0.06, 0.16, 0.025, 1), trimMat);
    lip.position.set(0, sill + p.hgt + 0.04, p.len / 2 - 0.1);
    group.add(lip);
  }

  /*
   * Underglow.
   *
   * A textured sprite with a radial alpha falloff, not a bare plane. The first
   * build additive-blended an untextured `PlaneGeometry`, which draws exactly
   * what it says: a hard-edged rectangle of flat colour sitting under the car.
   */
  if (opts.isPlayer && opts.glow !== undefined) {
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: opts.glow,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(
      cached('glowplane', () => new THREE.PlaneGeometry(1, 1)),
      glowMat,
    );
    mesh.scale.set(p.wid * 2.6, p.len * 2.1, 1);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.035;
    mesh.renderOrder = 2;
    group.add(mesh);
    group.userData.glow = mesh;
  }

  return group;
}

export function buildPlayerCar(def: CarDef): CarMesh {
  return buildCar({
    profile: def.body,
    color: def.color,
    trim: def.trim,
    glow: def.glow,
    isPlayer: true,
    headlights: true,
    detail: 'high',
  });
}

/** Long vehicles: a cab plus a body, rather than a stretched car. */
function buildRig(color: number, trim: number, isBus: boolean, detail: Detail): CarMesh {
  const group = new THREE.Group() as CarMesh;
  group.userData = { wheels: [], brakeLights: null as never, headlights: [] };

  const body = paint(color);
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.62, metalness: 0.35 });
  const len = isBus ? 11.4 : 10.6;
  const wid = 2.66;
  const seg = detail === 'high' ? 2 : 1;

  if (isBus) {
    const shell = new THREE.Mesh(tapered(wid, 2.95, len, 0.96, 0.99, 0.16, seg), body);
    shell.position.y = 1.95;
    shell.castShadow = true;
    group.add(shell);

    const band = new THREE.Mesh(bevel(wid * 1.004, 0.95, len * 0.86, 0.1, 1), GLASS);
    band.position.y = 2.55;
    group.add(band);

    const screen = new THREE.Mesh(bevel(wid * 0.88, 1.2, 0.12, 0.08, 1), GLASS);
    screen.position.set(0, 2.6, -len / 2 - 0.01);
    group.add(screen);
  } else {
    const cab = new THREE.Mesh(tapered(wid * 0.98, 2.4, 3, 0.88, 0.82, 0.16, seg), body);
    cab.position.set(0, 1.8, -len / 2 + 1.5);
    cab.castShadow = true;
    group.add(cab);

    const screen = new THREE.Mesh(bevel(wid * 0.84, 1, 0.12, 0.06, 1), GLASS);
    screen.position.set(0, 2.42, -len / 2 + 0.04);
    group.add(screen);

    const trailer = new THREE.Mesh(bevel(wid, 3, len - 3.4, 0.12, seg), trimMat);
    trailer.position.set(0, 2.35, 1.5);
    trailer.castShadow = true;
    group.add(trailer);

    // Stacks and a grille, so the front of a truck is not a blank slab.
    for (const sx of [-1, 1]) {
      const stack = new THREE.Mesh(cyl(0.11, 1.5, 8), CHROME);
      stack.rotation.z = Math.PI / 2;
      stack.position.set(sx * wid * 0.42, 2.5, -len / 2 + 2.4);
      group.add(stack);
    }
    const grille = new THREE.Mesh(box(wid * 0.7, 0.9, 0.1), GRILLE);
    grille.position.set(0, 1.35, -len / 2 - 0.01);
    group.add(grille);
  }

  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x3a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.32, roughness: 0.35,
  });
  group.userData.brakeLights = brakeMat;
  for (const sx of [-1, 1]) {
    const tail = new THREE.Mesh(bevel(0.36, 0.18, 0.1, 0.04, 1), brakeMat);
    tail.position.set(sx * wid * 0.36, 0.95, len / 2 + 0.02);
    group.add(tail);
  }
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(box(0.32, 0.16, 0.08), LAMP);
    lamp.position.set(sx * wid * 0.34, 1, -len / 2 - 0.03);
    group.add(lamp);
  }

  // Three axles: a steer pair and a tandem at the back.
  const r = 0.52;
  for (const z of [-len / 2 + 1.4, len / 2 - 2.2, len / 2 - 1]) {
    for (const sx of [-1, 1]) {
      addWheel(group, sx * (wid / 2 - 0.14), z, r, detail);
    }
  }

  return group;
}

const TRAFFIC_PALETTE = [
  0xd8dde4, 0x2b2f38, 0x8a929c, 0x1f4e8c, 0x8c2230, 0x2f6b48,
  0xc9a227, 0x6d4b8f, 0xb85c2a, 0x3a7d8c,
];

/**
 * Build a traffic vehicle.
 *
 * Takes a caller-supplied 0..1 roll rather than a random source. Drawing here
 * would make the number of values consumed from the simulation's stream depend
 * on whether a pooled vehicle happened to need rebuilding, which silently made
 * the same seed produce a different world.
 */
export function buildTrafficCar(kind: TrafficKind, colorRoll: number, detail: Detail = 'low'): CarMesh {
  const color = TRAFFIC_PALETTE[Math.min(
    TRAFFIC_PALETTE.length - 1,
    Math.floor(colorRoll * TRAFFIC_PALETTE.length),
  )];
  const trim = 0x1c1c22;
  if (kind === 'truck') return buildRig(color, 0xd5d8dd, false, detail);
  if (kind === 'bus') return buildRig(0xc8531f, trim, true, detail);
  const profile = kind === 'coupe' ? 'coupe' : kind === 'suv' ? 'suv' : kind === 'van' ? 'van' : 'sedan';
  return buildCar({ profile, color, trim, headlights: false, detail });
}

/** Triangle count of a built vehicle, for the model budget gate. */
export function triangleCount(mesh: THREE.Object3D): number {
  let total = 0;
  mesh.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry as THREE.BufferGeometry;
    total += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return Math.round(total);
}

/** Every profile the factory can build, for the gate to enumerate. */
export const CAR_PROFILES = Object.keys(PROFILE);

export interface ModelAudit {
  id: string;
  kind: 'player' | 'traffic';
  triangles: number;
  meshes: number;
  /**
   * Additive-blended materials carrying no texture.
   *
   * This is the shape of the underglow bug: additive blending on an untextured
   * quad draws exactly what it is, a hard-edged rectangle of flat colour. It is
   * worth counting rather than eyeballing, because at a glance in motion it
   * reads as a lighting effect right up until someone looks at a still.
   */
  bareAdditiveQuads: number;
  /** Distinct material types used, so a car is not all one plastic. */
  materialTypes: string[];
}

/**
 * Build one of everything and measure it.
 *
 * Built rather than introspected from the live scene so the audit covers cars
 * that have not spawned yet — a body only the garage ever shows is still a body
 * that can be blocky.
 */
export function auditVehicles(playerBodies: readonly string[]): ModelAudit[] {
  const out: ModelAudit[] = [];

  const measure = (id: string, kind: 'player' | 'traffic', group: THREE.Object3D): void => {
    let meshes = 0;
    let bare = 0;
    const types = new Set<string>();

    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      meshes += 1;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        types.add(m.type);
        const hasMap = 'map' in m && (m as { map: unknown }).map !== null;
        if (m.blending === THREE.AdditiveBlending && !hasMap) bare += 1;
      }
    });

    out.push({
      id, kind,
      triangles: triangleCount(group),
      meshes,
      bareAdditiveQuads: bare,
      materialTypes: [...types].sort(),
    });
  };

  for (const body of playerBodies) {
    measure(body, 'player', buildCar({
      profile: body, color: 0xcc3333, trim: 0x222222, glow: 0xff5522,
      isPlayer: true, headlights: true, detail: 'high',
    }));
  }

  for (const kind of ['sedan', 'coupe', 'suv', 'van', 'truck', 'bus'] as const) {
    measure(kind, 'traffic', buildTrafficCar(kind, 0.5, 'low'));
  }

  return out;
}

/** Release every cached geometry and material. Called only on teardown. */
export function disposeCarCaches(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const m of paintCache.values()) m.dispose();
  paintCache.clear();
  glowTex?.dispose();
  glowTex = null;
}
