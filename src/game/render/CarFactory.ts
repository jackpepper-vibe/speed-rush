import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { TrafficKind } from '@/core/GameEvents';
import type { CarDef } from '@/game/config/Cars';
import { makeContactShadowTexture, makeGlowTexture } from './RoadTextures';
import { BODY_STATIONS, loftBody, silhouetteSmoothness } from './BodyLoft';
import { qualityByTier } from './Quality';

/**
 * Loft resolution for the player's body, as a level of detail.
 *
 * Module state rather than a parameter threaded through five call sites,
 * because it is genuinely global: there is one player car on screen and one
 * answer to how much GPU this machine has. Set once at boot from the resolved
 * tier, and defaulted to the top of the ladder so anything built before the rig
 * exists — a garage preview, the model audit — gets the full model rather than
 * silently measuring a cheap one.
 */
let heroLod = {
  rings: qualityByTier('high').heroLoftRings,
  length: qualityByTier('high').heroLoftLength,
};

export function setHeroLod(rings: number, length: number): void {
  heroLod = { rings, length };
}

/**
 * Detail level every piece of traffic is built at.
 *
 * Module state for the same reason `heroLod` is: the factory is called from
 * managers that have no business knowing about the quality ladder, and
 * threading a tier through every call site to reach two integers deep inside a
 * wheel would be worse than this. Set once, at composition, from the rig.
 */
let trafficDetail: Detail = 'low';

export function setTrafficDetail(detail: Detail): void {
  trafficDetail = detail;
}

/**
 * Loft resolution for a piece of traffic, which is not the hero's.
 *
 * Separate from `heroLod` because the two answer different questions, the same
 * distinction `trafficDetail` already draws against the hero's detail level.
 * The hero is one body a couple of metres from the camera and its budget is
 * about how round a single silhouette needs to be; traffic is a poolful of
 * bodies mostly seen from behind at range, and its budget is about how many.
 *
 * Getting this wrong is not a small overspend. `buildCar` falls back to
 * `heroLod` when no override is given, so the moment traffic gained lofted
 * bodies it would have taken 76 rings by 132 sections **each** — more than two
 * hundred times the geometry these need, on twenty vehicles, for a shape that
 * is forty pixels tall.
 *
 * Fixed rather than tiered: the tier that lofts traffic at all is chosen by
 * `trafficDetail`, and a second dial underneath it would be two ways of saying
 * the same thing.
 */
const TRAFFIC_LOFT = { rings: 24, length: 16 };

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
    /** The ambient patch on the tarmac, so the gate can measure it directly. */
    contactShadow?: THREE.Mesh;
    /**
     * Where the exhaust leaves the car, in the car's own space.
     *
     * Recorded by the factory rather than recomputed by whatever wants to
     * attach a flame to it. The pipes move with the profile — a hyper sits
     * lower and wider than a hatch — and an effects system that guesses their
     * position is one that quietly drifts out of alignment the moment a
     * profile is retuned.
     */
    exhausts: THREE.Object3D[];
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

/*
 * Tyre rubber, with a little more sheen than is strictly accurate.
 *
 * At roughness 0.94 a tyre returns essentially nothing, and since the only
 * angle this game shows a car from is directly behind — where all you see of a
 * rear wheel is sidewall — the wheels rendered as flat black slabs with no
 * shape in them at all. Real rubber is not matte either; it has a soft, wide
 * highlight along the shoulder, and that highlight is the only thing at this
 * angle that says the wheel is round.
 */
const RUBBER = new THREE.MeshStandardMaterial({
  color: 0x1b1c23, roughness: 0.66, metalness: 0, envMapIntensity: 0.75,
});
const CHROME = new THREE.MeshStandardMaterial({
  color: 0xd6dce4, roughness: 0.08, metalness: 1, envMapIntensity: 2.6,
});
const RIM = new THREE.MeshStandardMaterial({
  color: 0xb4bcc8, roughness: 0.16, metalness: 1, envMapIntensity: 2.2,
});
const PLASTIC = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.72, metalness: 0.05 });
const GRILLE = new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.55, metalness: 0.45 });

/**
 * Cavity black: arch liners, the underbody tray, the shadow inside a vent.
 *
 * The job here is occlusion, not a surface. Real ambient occlusion needs a
 * second UV set and a baked map per body, which for a lofted mesh that changes
 * shape with every profile is a pipeline rather than a material. Geometry that
 * is simply very dark and very rough, tucked into the places light cannot
 * reach, buys the same read — a car whose arches are holes instead of painted
 * dents — for six triangles apiece.
 *
 * `envMapIntensity` is pinned near zero deliberately. Left at one, the sky
 * reflects into the wheel arch and lights up the one part of the car that has
 * to stay dark for the body above it to look heavy.
 */
const CAVITY = new THREE.MeshStandardMaterial({
  color: 0x07080b, roughness: 1, metalness: 0, envMapIntensity: 0.08,
});

/** The same black, seen from inside — arch liners are open shells. */
const CAVITY_INNER = new THREE.MeshStandardMaterial({
  color: 0x07080b, roughness: 1, metalness: 0, envMapIntensity: 0.08,
  side: THREE.BackSide,
});

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
  color: 0x0c161f,
  roughness: 0.02,
  metalness: 0.25,
  transparent: true,
  opacity: 0.78,
  clearcoat: 1,
  clearcoatRoughness: 0.02,
  envMapIntensity: 3.2,
});

/**
 * Traffic glass: darker, flatter, and not physical.
 *
 * The hero's glass earns a clearcoat because it is two metres from the camera.
 * Traffic is a poolful of cars mostly seen from behind at range, where a
 * clearcoat lobe is invisible and the only thing that matters is whether there
 * is a band of dark across the top of the body. Darker and more opaque than the
 * hero's for exactly that reason: at forty pixels tall a subtle tint is the
 * same colour as the paint, which is how a lofted traffic car ended up with a
 * good silhouette and no windows at all.
 */
const GLASS_TRAFFIC = new THREE.MeshStandardMaterial({
  color: 0x0a1118,
  roughness: 0.14,
  metalness: 0.32,
  transparent: true,
  opacity: 0.88,
  envMapIntensity: 2.2,
});

/**
 * Where the glasshouse starts, as a fraction of the section's own height.
 *
 * The glass pod used to span each station from `yBottom` to `yTop` — the whole
 * flank, sill to roof — so it sheathed the middle of the car instead of glazing
 * the top of it. Against a box cabin that was invisible because the cabin was a
 * separate volume; against one continuous lofted surface it is invisible
 * because there is no edge anywhere to read as a beltline.
 *
 * Raising the pod's floor to the waist is what turns a sheath into a window
 * band, and it costs nothing: the same stations, the same triangles, one
 * interpolation on the way in.
 */
const GLASS_BELT = 0.58;

const LAMP = new THREE.MeshStandardMaterial({
  color: 0xfff6e0, emissive: 0xfff0cc, emissiveIntensity: 2.2, roughness: 0.25,
});

/**
 * The amber half of a rear light cluster.
 *
 * Lit far more gently than `LAMP` and never switched: it is not a signal here,
 * it is the second colour that makes a cluster look like an assembly of parts
 * rather than one red tile. Traffic spends most of its life not braking, so
 * without it the back of a rig carries no lit detail at all for most of the
 * time it is on screen.
 */
const INDICATOR = new THREE.MeshStandardMaterial({
  color: 0x6a3403, emissive: 0xff8c1a, emissiveIntensity: 0.5, roughness: 0.34,
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
      /*
       * Sharp, not matte.
       *
       * At roughness 0.34 with the environment turned down to 1.15 the paint
       * had no highlight worth the name: the specular lobe was spread so wide
       * that the sky it reflected averaged out to the body colour, and the car
       * measured 1% bright pixels in a frame with a sun in it. A clearcoat is
       * a mirror with a few microns of lacquer over it — the base can stay
       * fairly rough, but the coat on top has to be tight enough to return the
       * sky as a distinct band rather than as a wash.
       */
      roughness: 0.3,
      /*
       * Half metal, not nearly all of it.
       *
       * A fully metallic surface has no diffuse term at all — every photon it
       * shows came from the environment. That is physically what car paint is,
       * and it is also why the car went black the moment the ambient fill came
       * down: the only environment here is a sky dome with nothing below the
       * horizon, so a metal panel facing the camera had a bare gradient to
       * reflect and no albedo of its own to fall back on. Splitting the
       * difference keeps the flake in the highlight and gives the body a colour
       * that survives being in shadow.
       */
      metalness: 0.5,
      clearcoat: 1,
      clearcoatRoughness: 0.025,
      envMapIntensity: 2.1,
      // The dusty sheen along a grazing edge. Small, but it is what separates
      // a shoulder line from a paint gradient when the sun is behind the car —
      // which, in a chase view, it is roughly half the time.
      sheen: 0.4,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xffffff),
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

let contactTex: THREE.Texture | null = null;
function contactTexture(): THREE.Texture {
  if (!contactTex) contactTex = makeContactShadowTexture();
  return contactTex;
}

/**
 * Lay the ambient contact shadow under a vehicle.
 *
 * Rendered before the underglow and after the road, with depth writes off:
 * this is a decal on the tarmac, and letting it write depth makes it occlude
 * the very glow that is supposed to sit on top of it.
 */
function addContactShadow(group: THREE.Group, width: number, length: number, opacity: number): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    map: contactTexture(),
    color: 0x000000,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(
    cached('shadowplane', () => new THREE.PlaneGeometry(1, 1)),
    mat,
  );
  mesh.scale.set(width, length, 1);
  mesh.rotation.x = -Math.PI / 2;
  // Below the underglow and barely above the road: any higher and the gap
  // between shadow and tyre is visible from the chase camera's low angle.
  mesh.position.y = 0.018;
  mesh.renderOrder = 1;
  group.add(mesh);
  return mesh;
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

/**
 * The dark shell over the top of a wheel.
 *
 * Half a cylinder, seen from the inside. Without it the arch is a hole cut in
 * a painted panel and the sky lights the tyre from above, so the wheel reads as
 * stuck to the side of the car; with it there is somewhere for the arch to be
 * dark, and the body above gains a shadow line to sit on.
 */
function archLiner(radius: number, halfWidth: number, seg: number): THREE.BufferGeometry {
  return cached(`arch${radius}:${halfWidth}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(
      radius, radius, halfWidth * 2, seg, 1, true, 0, Math.PI,
    );
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

function addWheel(
  group: CarMesh, x: number, z: number, radius: number, detail: Detail,
): void {
  const hub = new THREE.Group();
  hub.position.set(x, radius, z);

  const seg = detail === 'high' ? 20 : 11;
  // Wide. A narrow tyre under a car this shape reads as a caster, and the
  // extra width is what puts the shoulder where the camera can see it.
  const tyre = new THREE.Mesh(tyreGeo(radius, radius * 0.46, seg), RUBBER);
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
  /** Overrides the ambient hero LOD. Used by the audit to measure both rungs. */
  loft?: { rings: number; length: number };
}): CarMesh {
  const p = PROFILE[opts.profile] ?? PROFILE.sedan;
  const detail = opts.detail ?? (opts.isPlayer ? 'high' : 'low');
  const seg = detail === 'high' ? 3 : 1;

  const group = new THREE.Group() as CarMesh;
  group.userData = { wheels: [], brakeLights: null as never, headlights: [], exhausts: [] };

  const body = paint(opts.color);
  const trimMat = new THREE.MeshStandardMaterial({ color: opts.trim, roughness: 0.5, metalness: 0.5 });

  const sill = p.wheelR * p.ride;
  const bodyY = sill + p.hgt / 2;

  const noseH = p.hgt * p.nose;
  const cabinH = p.hgt * (p.cabZ > 0.8 ? 1.05 : 0.8);
  const cabinZ = p.len * p.cabZ;

  const stations = BODY_STATIONS[opts.profile];

  if (stations && detail === 'high') {
    /*
     * One continuous surface from nose to tail.
     *
     * The bonnet, screen, roof and deck are all the same skin here, which is
     * the point: a roofline can only flow into a rear deck if they are the
     * same surface. Assembled from separate volumes they meet at a seam, and
     * a seam is what the eye reads as "made of boxes" however well each
     * individual volume is rounded.
     */
    const lod = opts.loft ?? (opts.isPlayer ? heroLod : TRAFFIC_LOFT);
    const geometry = loftBody(stations, {
      length: p.len,
      ringSegments: lod.rings,
      lengthSegments: lod.length,
    });
    const shell = new THREE.Mesh(geometry, body);
    shell.scale.set(p.wid / 2, 1, 1);
    shell.position.y = sill * 0.32;
    shell.castShadow = true;
    shell.receiveShadow = true;
    group.add(shell);

    /* Glass over the greenhouse, pushed out a hair so it sits on the surface
     * rather than fighting it — and starting at the waist, not at the sill.
     *
     * The previous pod took each station's full height, so it wrapped the
     * flanks as well as the roof and never read as a window. Iteration 36
     * cleared it of causing the white-lump traffic body, which it did not, and
     * left this defect in place: a good silhouette with no glasshouse. Lifting
     * the floor to `GLASS_BELT` gives the band an edge to be bounded by. */
    const glassGeo = loftBody(
      stations
        .filter((s) => s.t > -0.45 && s.t < 0.6)
        .map((s) => ({ ...s, yBottom: s.yBottom + (s.yTop - s.yBottom) * GLASS_BELT })),
      {
        length: p.len,
        ringSegments: Math.max(12, Math.round(lod.rings * 0.7)),
        lengthSegments: Math.max(12, Math.round(lod.length * 0.45)),
      },
    );
    const glass = new THREE.Mesh(glassGeo, opts.isPlayer ? GLASS : GLASS_TRAFFIC);
    glass.scale.set((p.wid / 2) * 1.004, 1.004, 0.995);
    glass.position.y = sill * 0.32 + 0.02;
    group.add(glass);
  } else {
    /* Cheap build: stacked volumes, for traffic seen from behind at distance. */
    const lower = new THREE.Mesh(tapered(p.wid, p.hgt, p.len, 0.94, 0.985, 0.1, seg), body);
    lower.position.y = bodyY;
    lower.castShadow = true;
    lower.receiveShadow = true;
    group.add(lower);

    const nose = new THREE.Mesh(tapered(p.wid * 0.96, noseH, p.len * 0.3, 0.88, 0.72, 0.08, seg), body);
    nose.position.set(0, sill + noseH / 2 + p.hgt * 0.1, -p.len * 0.38);
    nose.castShadow = true;
    group.add(nose);

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
  }

  /* Sills, bumpers, grille. */
  // Between the arches, not through them.
  const sillBar = new THREE.Mesh(bevel(p.wid * 1.005, 0.16, p.len * 0.52, 0.05, 1), trimMat);
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
    group.userData.exhausts.push(pipe);
  }

  /* Wheels, set into the arches.
   *
   * Sat further inboard at first, which on a body this wide buried them: from
   * directly behind — which is the only angle this game ever shows a car from —
   * the tyre disappeared behind the flank and the car ran on nothing. A wheel
   * wants to be close to flush with the bodywork above it. */
  const axle = p.len * 0.315;
  const wheelX = p.wid / 2 - p.wheelR * 0.16;
  for (const [x, z] of [[-wheelX, -axle], [wheelX, -axle], [-wheelX, axle], [wheelX, axle]] as const) {
    addWheel(group, x, z, p.wheelR, detail);
  }

  /*
   * Occlusion: arch liners and an underbody tray.
   *
   * Everything here is cavity black and faces inward. It costs a few hundred
   * triangles and does the job an AO map would, without needing a second UV
   * set on a body whose topology changes with every profile.
   */
  {
    const linerGeo = archLiner(p.wheelR * 1.2, p.wheelR * 0.56, detail === 'high' ? 14 : 8);
    for (const [x, z] of [[-wheelX, -axle], [wheelX, -axle], [-wheelX, axle], [wheelX, axle]] as const) {
      const l = new THREE.Mesh(linerGeo, CAVITY_INNER);
      l.position.set(x, p.wheelR, z);
      group.add(l);
    }

    // A floor pan, so the gap between sill and tarmac is a shadow rather than
    // a view straight through to the road on the far side.
    // Narrower than the track, so it closes the underbody without reaching
    // out over the wheels.
    const tray = new THREE.Mesh(box((wheelX - p.wheelR * 0.5) * 2, 0.06, p.len * 0.84), CAVITY);
    tray.position.y = sill * 0.44;
    group.add(tray);

    /* Skirts down the flanks, closing the sliver of daylight under the sills.
     *
     * Between the axles only, and inboard of them. Run the full length at the
     * width of the body and they stop being skirts and become covers: a black
     * slab standing exactly where the rear tyre should be visible, which is
     * what turned the bottom of the car into one unreadable dark band. */
    const skirtLength = axle * 2 - p.wheelR * 2.4;
    for (const sx of [-1, 1]) {
      const skirt = new THREE.Mesh(box(0.05, sill * 0.7, skirtLength), CAVITY);
      skirt.position.set(sx * (wheelX - p.wheelR * 0.5), sill * 0.42, 0);
      group.add(skirt);
    }
  }

  /* The ambient patch on the tarmac. Under every car, at every tier. */
  group.userData.contactShadow = addContactShadow(group, p.wid * 2.1, p.len * 1.5, 0.82);

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

/**
 * Objects on this layer are additionally lit by the rig's camera-side fill.
 *
 * The fill exists for one reason — a chase camera means the only face of a car
 * ever pointed at the player is the face permanently turned away from the sun —
 * and it was never meant for anything else. Being a plain directional light it
 * lit everything anyway, including every square metre of tarmac, at better than
 * half the sun's intensity and casting no shadow. That is why the roadside
 * shadows measured two to five luminance: they were being filled back in as
 * fast as the sun cut them.
 *
 * Confining it to the vehicles gives the world its shadows back and leaves the
 * cars exactly as readable as they were. Costs nothing per pixel; it is a bit
 * in a mask.
 */
export const FILL_LAYER = 1;

function litByFill(car: CarMesh): CarMesh {
  car.traverse((o) => o.layers.enable(FILL_LAYER));
  return car;
}

export function buildPlayerCar(def: CarDef): CarMesh {
  return litByFill(buildCar({
    profile: def.body,
    color: def.color,
    trim: def.trim,
    glow: def.glow,
    isPlayer: true,
    headlights: true,
    detail: 'high',
  }));
}

/**
 * The back of a long vehicle.
 *
 * A truck or a bus is the one traffic model a player never sees any other part
 * of. The chase camera sits behind and below; by the time a rig is close
 * enough to read, its cab, its stacks, its grille and all three of its axles
 * are hidden behind its own trailer, and what is actually on screen is the
 * rear face and nothing else. Iteration 45 called item 5 finished on the
 * strength of a sedan and a van seen from behind at an angle, and a capture of
 * a truck settled it: a 2.7-by-3 slab of flat colour with two tail lights the
 * size of a thumbnail at the bottom of it. That is the "placeholder coloured
 * box" the backlog item exists to remove — it was merely a large one.
 *
 * Everything here is therefore spent on one plane. Door leaves with a sealed
 * split, a light cluster big enough to have parts, an underrun bar standing
 * off the floor on brackets, mudflaps and a row of marker lamps: each is a
 * horizontal or vertical line across that slab, which is what a silhouette
 * needs to stop being a rectangle. The trailer itself is untouched.
 */
function addRigRear(
  group: CarMesh,
  wid: number,
  /** Z of the rear face, and the Y span of the body standing on it. */
  rearZ: number,
  floorY: number,
  roofY: number,
  isBus: boolean,
  trimMat: THREE.Material,
  brakeMat: THREE.Material,
  detail: Detail,
): void {
  const hi = detail === 'high';
  const height = roofY - floorY;
  const midY = (floorY + roofY) / 2;

  if (isBus) {
    /* A rear screen and an engine hatch under it. Both are large and both run
     * across the full width, which is what separates the back of a bus from
     * the back of a box at forty metres. */
    const screen = new THREE.Mesh(box(wid * 0.78, height * 0.34, 0.06), GLASS);
    screen.position.set(0, roofY - height * 0.27, rearZ + 0.03);
    group.add(screen);

    const hatch = new THREE.Mesh(box(wid * 0.66, height * 0.22, 0.07), trimMat);
    hatch.position.set(0, floorY + height * 0.33, rearZ + 0.035);
    group.add(hatch);

    // Louvres. A hatch with no openings is a panel; the slats say engine.
    const slats = hi ? 4 : 2;
    for (let i = 0; i < slats; i++) {
      const slat = new THREE.Mesh(box(wid * 0.58, 0.05, 0.03), GRILLE);
      slat.position.set(0, floorY + height * (0.26 + i * 0.045), rearZ + 0.075);
      group.add(slat);
    }
  } else {
    /* Two door leaves standing proud of the face, with the seal between them
     * cut in cavity black. The split is the single most useful line on the
     * whole vehicle: it halves the widest flat area in the frame. */
    const doorW = wid / 2 - 0.06;
    const doorH = height * 0.92;
    for (const sx of [-1, 1]) {
      const leaf = new THREE.Mesh(box(doorW, doorH, 0.05), trimMat);
      leaf.position.set(sx * (doorW / 2 + 0.04), midY, rearZ + 0.03);
      group.add(leaf);
    }
    const seal = new THREE.Mesh(box(0.08, doorH, 0.08), CAVITY);
    seal.position.set(0, midY, rearZ + 0.02);
    group.add(seal);

    // Hinge columns down both outer edges, and the locking bars across.
    for (const sx of [-1, 1]) {
      const hinge = new THREE.Mesh(box(0.09, doorH * 0.98, 0.09), GRILLE);
      hinge.position.set(sx * (wid / 2 - 0.06), midY, rearZ + 0.025);
      group.add(hinge);
    }
    if (hi) {
      for (const y of [midY - doorH * 0.28, midY + doorH * 0.28]) {
        const bar = new THREE.Mesh(box(wid * 0.9, 0.06, 0.04), GRILLE);
        bar.position.set(0, y, rearZ + 0.07);
        group.add(bar);
      }
    }

    /* Marker lamps along the top edge. Small, but a row of bright points on a
     * dark edge survives fog and distance better than any amount of surface
     * detail below it. */
    const lamps = hi ? 5 : 3;
    for (let i = 0; i < lamps; i++) {
      const lamp = new THREE.Mesh(box(0.1, 0.07, 0.05), LAMP);
      lamp.position.set((i / (lamps - 1) - 0.5) * wid * 0.72, roofY - 0.06, rearZ + 0.04);
      group.add(lamp);
    }
  }

  /* Light clusters, an order of magnitude bigger than the pair they replace
   * and built as a housing with two lenses rather than one red tile. The lower
   * amber is what makes the cluster read as a cluster when the brake lamp is
   * not lit — which, on traffic that mostly is not braking, is most of the
   * time. */
  const clusterY = floorY + 0.28;
  for (const sx of [-1, 1]) {
    const housing = new THREE.Mesh(box(0.46, 0.5, 0.1), GRILLE);
    housing.position.set(sx * wid * 0.34, clusterY, rearZ + 0.04);
    group.add(housing);

    const stop = new THREE.Mesh(box(0.34, 0.19, 0.06), brakeMat);
    stop.position.set(sx * wid * 0.34, clusterY + 0.12, rearZ + 0.09);
    group.add(stop);

    const indicator = new THREE.Mesh(box(0.34, 0.15, 0.06), INDICATOR);
    indicator.position.set(sx * wid * 0.34, clusterY - 0.13, rearZ + 0.09);
    group.add(indicator);
  }

  /* The underrun bar, standing off the floor on two brackets.
   *
   * Structurally the most valuable thing on this list: it puts a horizontal
   * line and a band of daylight *below* the body, so the vehicle stops meeting
   * the road along one unbroken edge and starts standing on a chassis.
   */
  const barY = floorY - 0.22;
  const bar = new THREE.Mesh(box(wid * 0.86, 0.14, 0.12), GRILLE);
  bar.position.set(0, barY, rearZ - 0.04);
  group.add(bar);
  for (const sx of [-1, 1]) {
    const bracket = new THREE.Mesh(box(0.1, 0.3, 0.1), GRILLE);
    bracket.position.set(sx * wid * 0.3, barY + 0.2, rearZ - 0.04);
    group.add(bracket);
  }

  // Mudflaps, hung behind the rearmost axle and clear of the bar.
  for (const sx of [-1, 1]) {
    const flap = new THREE.Mesh(box(0.52, 0.42, 0.03), RUBBER);
    flap.position.set(sx * (wid / 2 - 0.34), floorY - 0.34, rearZ - 0.62);
    group.add(flap);
  }
}

/** Long vehicles: a cab plus a body, rather than a stretched car. */
function buildRig(color: number, trim: number, isBus: boolean, detail: Detail): CarMesh {
  const group = new THREE.Group() as CarMesh;
  group.userData = { wheels: [], brakeLights: null as never, headlights: [], exhausts: [] };

  const body = paint(color);
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.62, metalness: 0.35 });
  const len = isBus ? 11.4 : 10.6;
  const wid = 2.66;
  const seg = detail === 'high' ? 2 : 1;

  /* The rear face, and the vertical extent of whatever stands on it. Captured
   * from the body that owns it rather than recomputed, so `addRigRear` cannot
   * drift out of step with the shell it is dressing. */
  let rearZ: number;
  let floorY: number;
  let roofY: number;

  if (isBus) {
    const shell = new THREE.Mesh(tapered(wid, 2.95, len, 0.96, 0.99, 0.16, seg), body);
    shell.position.y = 1.95;
    shell.castShadow = true;
    group.add(shell);
    rearZ = len / 2;
    floorY = shell.position.y - 2.95 / 2;
    roofY = shell.position.y + 2.95 / 2;

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
    rearZ = trailer.position.z + (len - 3.4) / 2;
    floorY = trailer.position.y - 3 / 2;
    roofY = trailer.position.y + 3 / 2;

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
  addRigRear(group, wid, rearZ, floorY, roofY, isBus, trimMat, brakeMat, detail);
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

  // A tray under the chassis and the same contact patch every car gets. A
  // vehicle this large floating a hand's width off the road is the most
  // visible version of the bug.
  const tray = new THREE.Mesh(box(wid * 0.9, 0.08, len * 0.88), CAVITY);
  tray.position.y = 0.62;
  group.add(tray);
  addContactShadow(group, wid * 1.8, len * 1.2, 0.85);

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
export function buildTrafficCar(kind: TrafficKind, colorRoll: number, detail: Detail = trafficDetail): CarMesh {
  const color = TRAFFIC_PALETTE[Math.min(
    TRAFFIC_PALETTE.length - 1,
    Math.floor(colorRoll * TRAFFIC_PALETTE.length),
  )];
  const trim = 0x1c1c22;
  if (kind === 'truck') return litByFill(buildRig(color, 0xd5d8dd, false, detail));
  if (kind === 'bus') return litByFill(buildRig(0xc8531f, trim, true, detail));
  const profile = kind === 'coupe' ? 'coupe' : kind === 'suv' ? 'suv' : kind === 'van' ? 'van' : 'sedan';
  return litByFill(buildCar({ profile, color, trim, headlights: false, detail }));
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
  kind: 'player' | 'traffic' | 'hero-lod';
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
  /**
   * Fraction of adjacent-face angles on the largest panel under the smoothness
   * limit — 1 is a surface with no creases in it at all.
   *
   * Measured on the biggest geometry in the group, which for a player car is
   * always the lofted shell. Triangle count alone cannot tell a smooth body
   * from a finely subdivided box, and it was a finely subdivided box that this
   * whole line of work started from.
   */
  silhouette: number;
  /**
   * Meshes rendering with `flatShading`.
   *
   * One flag, set anywhere on a body panel, discards the interpolated normals
   * the loft went to the trouble of averaging and renders every triangle as a
   * facet. It is worth counting rather than trusting, because it is a single
   * word in a material literal and it looks deliberate wherever it appears.
   */
  flatShadedMeshes: number;
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

  const measure = (id: string, kind: ModelAudit['kind'], group: THREE.Object3D): void => {
    let meshes = 0;
    let bare = 0;
    let flat = 0;
    let biggest: THREE.BufferGeometry | null = null;
    let biggestTriangles = 0;
    const types = new Set<string>();

    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      meshes += 1;
      const tris = triangleCount(o);
      if (tris > biggestTriangles) {
        biggestTriangles = tris;
        biggest = o.geometry as THREE.BufferGeometry;
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        types.add(m.type);
        const hasMap = 'map' in m && (m as { map: unknown }).map !== null;
        if (m.blending === THREE.AdditiveBlending && !hasMap) bare += 1;
        if ('flatShading' in m && (m as { flatShading: boolean }).flatShading) flat += 1;
      }
    });

    out.push({
      id, kind,
      triangles: triangleCount(group),
      meshes,
      bareAdditiveQuads: bare,
      materialTypes: [...types].sort(),
      silhouette: biggest ? silhouetteSmoothness(biggest) : 0,
      flatShadedMeshes: flat,
    });
  };

  /*
   * Player bodies are always measured at the top of the ladder, whatever tier
   * the machine running the audit resolved to.
   *
   * The probe runs pinned to `low`, and reading the ambient LOD there would
   * report the cut-down hero and call it the shipping model — the triangle
   * floor for the player would then be satisfied by a car no player on real
   * hardware ever sees. The rung actually in use is measured separately, below.
   */
  const top = qualityByTier('high');
  for (const body of playerBodies) {
    measure(body, 'player', buildCar({
      profile: body, color: 0xcc3333, trim: 0x222222, glow: 0xff5522,
      isPlayer: true, headlights: true, detail: 'high',
      loft: { rings: top.heroLoftRings, length: top.heroLoftLength },
    }));
  }

  // The bottom rung of the same ladder, so "the low tier gets a cheaper hero"
  // is a measurement rather than an intention.
  const floor = qualityByTier('low');
  for (const body of playerBodies) {
    measure(`${body}@low`, 'hero-lod', buildCar({
      profile: body, color: 0xcc3333, trim: 0x222222, glow: 0xff5522,
      isPlayer: true, headlights: true, detail: 'high',
      loft: { rings: floor.heroLoftRings, length: floor.heroLoftLength },
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
