import * as THREE from 'three';
import type { TrafficKind } from '@/core/GameEvents';
import type { CarDef } from '@/game/config/Cars';

/**
 * Procedural car meshes.
 *
 * Shared geometry and material caches, because the road holds dozens of cars at
 * once and building a fresh box per vehicle is how the original ended up
 * allocating a new material for every spawn. Bodies differ by profile — a
 * stack of tapered slabs rather than one box — which is what separates a coupe
 * from a bus at a glance from behind.
 */

export interface CarMesh extends THREE.Group {
  userData: {
    wheels: THREE.Mesh[];
    brakeLights: THREE.MeshStandardMaterial;
    headlights: THREE.SpotLight[];
    glow?: THREE.Mesh;
  };
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `b${w}:${h}:${d}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

function cylinder(r: number, h: number): THREE.BufferGeometry {
  const key = `c${r}:${h}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(r, r, h, 16);
    g.rotateZ(Math.PI / 2);
    geoCache.set(key, g);
  }
  return g;
}

/**
 * A body box with its top face pulled in, so the greenhouse tapers.
 *
 * Cars read as cars largely because nothing on them is a true cuboid; this is
 * the cheapest way to get that without authoring meshes.
 */
function taperedBox(w: number, h: number, d: number, topScaleX: number, topScaleZ: number): THREE.BufferGeometry {
  const key = `t${w}:${h}:${d}:${topScaleX}:${topScaleZ}`;
  const cached = geoCache.get(key);
  if (cached) return cached;

  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * topScaleX);
      pos.setZ(i, pos.getZ(i) * topScaleZ);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  geoCache.set(key, g);
  return g;
}

const RUBBER = new THREE.MeshStandardMaterial({ color: 0x12121a, roughness: 0.92, metalness: 0.0 });
const RIM = new THREE.MeshStandardMaterial({ color: 0xb9c0cc, roughness: 0.32, metalness: 0.94 });
/**
 * Car glass.
 *
 * Plain alpha blending with a clearcoat, deliberately not `transmission`.
 * Physical transmission makes three.js render the scene into a separate
 * transmission target every frame, and with glass on every car in traffic that
 * is an extra full pass per frame for an effect nobody can see through a rear
 * window at 200 km/h. It was also enough to lose the WebGL context outright on
 * a software rasteriser.
 */
const GLASS = new THREE.MeshPhysicalMaterial({
  color: 0x0e1a26,
  roughness: 0.08,
  metalness: 0.1,
  transparent: true,
  opacity: 0.68,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
});
const LAMP = new THREE.MeshStandardMaterial({
  color: 0xfff6e0,
  emissive: 0xfff0cc,
  emissiveIntensity: 2.4,
  roughness: 0.3,
});

/** Body profiles: [length, width, height, cabinScaleX, cabinScaleZ, cabinY]. */
const PROFILE: Record<string, { len: number; wid: number; hgt: number; cabX: number; cabZ: number; nose: number }> = {
  hatch: { len: 4.3, wid: 1.86, hgt: 0.66, cabX: 0.88, cabZ: 0.74, nose: 0.5 },
  coupe: { len: 4.6, wid: 1.9, hgt: 0.58, cabX: 0.84, cabZ: 0.66, nose: 0.62 },
  muscle: { len: 4.95, wid: 2.02, hgt: 0.64, cabX: 0.86, cabZ: 0.6, nose: 0.7 },
  wedge: { len: 4.7, wid: 1.96, hgt: 0.52, cabX: 0.8, cabZ: 0.62, nose: 0.74 },
  super: { len: 4.75, wid: 2.06, hgt: 0.5, cabX: 0.76, cabZ: 0.56, nose: 0.78 },
  hyper: { len: 4.85, wid: 2.12, hgt: 0.46, cabX: 0.72, cabZ: 0.52, nose: 0.82 },
  sedan: { len: 4.5, wid: 1.88, hgt: 0.62, cabX: 0.88, cabZ: 0.72, nose: 0.55 },
  suv: { len: 4.8, wid: 2.0, hgt: 0.92, cabX: 0.92, cabZ: 0.82, nose: 0.42 },
  van: { len: 5.3, wid: 2.04, hgt: 1.18, cabX: 0.96, cabZ: 0.9, nose: 0.3 },
};

function addWheels(group: CarMesh, len: number, wid: number, radius: number, inset = 0.1): void {
  const axleZ = len * 0.31;
  const x = wid / 2 - inset;
  for (const [px, pz] of [[-x, -axleZ], [x, -axleZ], [-x, axleZ], [x, axleZ]] as const) {
    const tyre = new THREE.Mesh(cylinder(radius, 0.34), RUBBER);
    tyre.position.set(px, radius, pz);
    tyre.castShadow = true;
    group.add(tyre);
    group.userData.wheels.push(tyre);

    const rim = new THREE.Mesh(cylinder(radius * 0.56, 0.36), RIM);
    rim.position.copy(tyre.position);
    group.add(rim);
    group.userData.wheels.push(rim);
  }
}

/**
 * Build a car.
 *
 * `forward` is -Z for every vehicle, player and traffic alike, so a single
 * convention decides where headlights point and which end gets brake lights.
 */
export function buildCar(opts: {
  profile: string;
  color: number;
  trim: number;
  glow?: number;
  isPlayer?: boolean;
  headlights?: boolean;
}): CarMesh {
  const p = PROFILE[opts.profile] ?? PROFILE.sedan;
  const group = new THREE.Group() as CarMesh;
  group.userData = { wheels: [], brakeLights: null as never, headlights: [] };

  const paint = new THREE.MeshPhysicalMaterial({
    color: opts.color,
    roughness: 0.28,
    metalness: 0.62,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: opts.trim, roughness: 0.55, metalness: 0.4 });

  const wheelR = p.hgt > 1 ? 0.42 : 0.36;
  const sillY = wheelR * 0.82;

  // Lower body — the slab the wheels hang off.
  const lower = new THREE.Mesh(taperedBox(p.wid, p.hgt, p.len, 0.97, 0.99), paint);
  lower.position.y = sillY + p.hgt / 2;
  lower.castShadow = true;
  lower.receiveShadow = true;
  group.add(lower);

  // Nose wedge: a second slab, shorter and dropped at the front.
  const nose = new THREE.Mesh(taperedBox(p.wid * 0.95, p.hgt * 0.5, p.len * 0.3, 0.86, 0.7), paint);
  nose.position.set(0, sillY + p.hgt * 0.42, -p.len * 0.4);
  nose.scale.y = p.nose;
  nose.castShadow = true;
  group.add(nose);

  // Cabin.
  const cabinH = p.hgt * (p.cabZ > 0.8 ? 1.15 : 0.86);
  const cabin = new THREE.Mesh(
    taperedBox(p.wid * p.cabX, cabinH, p.len * p.cabZ, 0.9, 0.78),
    paint,
  );
  cabin.position.set(0, sillY + p.hgt + cabinH / 2 - 0.04, p.len * 0.04);
  cabin.castShadow = true;
  group.add(cabin);

  // Glasshouse, inset a hair so it reads as glass in a frame.
  const glass = new THREE.Mesh(
    taperedBox(p.wid * p.cabX * 0.94, cabinH * 0.72, p.len * p.cabZ * 0.92, 0.9, 0.8),
    GLASS,
  );
  glass.position.copy(cabin.position);
  glass.position.y += 0.03;
  group.add(glass);

  // Sills and bumpers.
  const sill = new THREE.Mesh(box(p.wid * 1.01, 0.14, p.len * 0.86), trimMat);
  sill.position.y = sillY * 0.72;
  group.add(sill);

  // Headlights — a pair of emissive pads, plus real spotlights for the player.
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(box(p.wid * 0.22, 0.11, 0.1), LAMP);
    lamp.position.set(sx * p.wid * 0.31, sillY + p.hgt * 0.62, -p.len / 2 - 0.02);
    group.add(lamp);

    if (opts.headlights) {
      const spot = new THREE.SpotLight(0xfff2d4, 0, 78, 0.42, 0.55, 1.4);
      spot.position.set(sx * p.wid * 0.31, sillY + p.hgt * 0.62, -p.len / 2);
      spot.target.position.set(sx * 0.5, 0, -46);
      group.add(spot);
      group.add(spot.target);
      group.userData.headlights.push(spot);
    }
  }

  // Brake lights: one shared material so the whole cluster lights together.
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x3a0a0a,
    emissive: 0xff1a1a,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  group.userData.brakeLights = brakeMat;
  for (const sx of [-1, 1]) {
    const tail = new THREE.Mesh(box(p.wid * 0.26, 0.12, 0.08), brakeMat);
    tail.position.set(sx * p.wid * 0.3, sillY + p.hgt * 0.66, p.len / 2 + 0.01);
    group.add(tail);
  }

  addWheels(group, p.len, p.wid, wheelR);

  // Player-only: underglow plane that brightens with speed.
  if (opts.isPlayer && opts.glow !== undefined) {
    const glowMat = new THREE.MeshBasicMaterial({
      color: opts.glow,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(p.wid * 1.5, p.len * 1.3), glowMat);
    glowMesh.rotation.x = -Math.PI / 2;
    glowMesh.position.y = 0.03;
    group.add(glowMesh);
    group.userData.glow = glowMesh;

    // A spoiler, because the player's car should be the loudest thing on screen.
    const wing = new THREE.Mesh(box(p.wid * 0.92, 0.07, 0.34), trimMat);
    wing.position.set(0, sillY + p.hgt + cabinH * 0.78, p.len / 2 - 0.18);
    wing.castShadow = true;
    group.add(wing);
    for (const sx of [-1, 1]) {
      const stay = new THREE.Mesh(box(0.08, 0.22, 0.1), trimMat);
      stay.position.set(sx * p.wid * 0.34, sillY + p.hgt + cabinH * 0.66, p.len / 2 - 0.18);
      group.add(stay);
    }
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
  });
}

/** Long vehicles get a separate builder — a cab plus a trailer box. */
function buildRig(color: number, trim: number, isBus: boolean): CarMesh {
  const group = new THREE.Group() as CarMesh;
  group.userData = { wheels: [], brakeLights: null as never, headlights: [] };

  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0.42, clearcoat: 0.4 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.62, metalness: 0.3 });
  const len = isBus ? 11.4 : 10.6;
  const wid = 2.66;

  if (isBus) {
    const body = new THREE.Mesh(taperedBox(wid, 2.9, len, 0.97, 0.99), paint);
    body.position.y = 1.92;
    body.castShadow = true;
    group.add(body);
    // Window band down both flanks.
    const band = new THREE.Mesh(box(wid * 1.005, 0.9, len * 0.84), GLASS);
    band.position.y = 2.5;
    group.add(band);
  } else {
    const cab = new THREE.Mesh(taperedBox(wid * 0.98, 2.3, 3.0, 0.86, 0.8), paint);
    cab.position.set(0, 1.75, -len / 2 + 1.5);
    cab.castShadow = true;
    group.add(cab);

    const screen = new THREE.Mesh(box(wid * 0.82, 0.9, 0.1), GLASS);
    screen.position.set(0, 2.32, -len / 2 + 0.06);
    group.add(screen);

    const trailer = new THREE.Mesh(box(wid, 3.0, len - 3.4), trimMat);
    trailer.position.set(0, 2.3, 1.5);
    trailer.castShadow = true;
    group.add(trailer);
  }

  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x3a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.35, roughness: 0.4,
  });
  group.userData.brakeLights = brakeMat;
  for (const sx of [-1, 1]) {
    const tail = new THREE.Mesh(box(0.34, 0.16, 0.08), brakeMat);
    tail.position.set(sx * wid * 0.36, 0.9, len / 2 + 0.02);
    group.add(tail);
  }
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(box(0.3, 0.14, 0.1), LAMP);
    lamp.position.set(sx * wid * 0.34, 0.95, -len / 2 - 0.02);
    group.add(lamp);
  }

  // Three axles: steer, plus a tandem at the back.
  const r = 0.52;
  for (const pz of [-len / 2 + 1.4, len / 2 - 2.2, len / 2 - 1.0]) {
    for (const sx of [-1, 1]) {
      const tyre = new THREE.Mesh(cylinder(r, 0.42), RUBBER);
      tyre.position.set(sx * (wid / 2 - 0.12), r, pz);
      tyre.castShadow = true;
      group.add(tyre);
      group.userData.wheels.push(tyre);
    }
  }

  return group;
}

const TRAFFIC_PALETTE = [
  0xd8dde4, 0x2b2f38, 0x8a929c, 0x1f4e8c, 0x8c2230, 0x2f6b48,
  0xc9a227, 0x6d4b8f, 0xb85c2a, 0x3a7d8c,
];

export function buildTrafficCar(kind: TrafficKind, rng: () => number): CarMesh {
  const color = TRAFFIC_PALETTE[Math.floor(rng() * TRAFFIC_PALETTE.length)];
  const trim = 0x1c1c22;
  if (kind === 'truck') return buildRig(color, 0xd5d8dd, false);
  if (kind === 'bus') return buildRig(0xc8531f, trim, true);
  const profile = kind === 'coupe' ? 'coupe' : kind === 'suv' ? 'suv' : kind === 'van' ? 'van' : 'sedan';
  return buildCar({ profile, color, trim, headlights: false });
}

/** Release every cached geometry. Called only on teardown. */
export function disposeCarCaches(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}
