import * as THREE from 'three';
import type { TrafficKind } from '@/core/GameEvents';
import { chassisOf, type CarDef, type Chassis } from '@/game/config/Cars';
import type { QualitySettings } from '../Quality';
import { makeGlowTexture } from '../RoadTextures';
import { BodyShell, FAR_DETAIL, HERO_DETAIL, TRAFFIC_DETAIL, type Detail } from './BodyShell';
import type { DesignContext, VehicleDesign } from './Design';
import { PLAYER_DESIGNS, TRAFFIC_DESIGNS, TRAFFIC_PAINTS, TRAFFIC_PLATES } from './designs';
import { disposePartCache } from './Parts';
import { SURF, type Surface } from './Surfaces';
import { vehicleAtlas, disposeVehicleAtlas } from './VehicleAtlas';
import { VehicleBuilder } from './VehicleBuilder';
import { VehicleMaterial } from './VehicleMaterial';

/**
 * Builds the cars.
 *
 * A design's geometry is built once per level of detail and shared by every
 * vehicle of that design; what each vehicle owns is a material instance
 * carrying its paint, lamps and wheel spin. So twenty sedans in traffic are one
 * geometry, twenty cheap uniform sets and twenty draw calls — not twenty times
 * thirty meshes.
 */

/**
 * Objects on this layer are also lit by the rig's camera-side fill light.
 * Vehicles only: see `SceneRig.fill`.
 */
export const FILL_LAYER = 1;

/**
 * Candela per unit of headlight level. three.js spot lights are physical, and
 * the world's 0..4 level taken as candela lit nothing: at twenty metres it put
 * less light on the road than the moon.
 */
const HEADLAMP_CANDELA = 22;

/** Everything built for one design at one level of detail, shared by every vehicle of it. */
export interface VehicleArt {
  readonly geometry: THREE.BufferGeometry;
  readonly exhausts: readonly THREE.Vector3[];
  readonly headlamps: readonly THREE.Vector3[];
  readonly extras: readonly THREE.Object3D[];
  readonly size: THREE.Vector3;
  readonly triangles: number;
  /** Triangles of the lofted shell, which come first in the index; the parts follow. */
  readonly shellTriangles: number;
  /** Where the driven tyres touch the road: two for a car, one for a bike. */
  readonly rearContacts: readonly THREE.Vector3[];
  readonly surfaces: readonly Surface[];
}

const built = new Map<string, VehicleArt>();

/**
 * How much car to build. The hero is the player's car and the garage's; traffic
 * is everything on the road; far is parked cars, instanced by the dozen and
 * never closer than thirty metres.
 */
export type VehicleLevel = 'hero' | 'traffic' | 'far';

const DETAIL: Record<VehicleLevel, Detail> = { hero: HERO_DETAIL, traffic: TRAFFIC_DETAIL, far: FAR_DETAIL };

/** The level each kind of vehicle is built at: one rung of the quality ladder. */
export interface DetailRung {
  readonly player: VehicleLevel;
  readonly traffic: VehicleLevel;
}

const RUNGS: Record<QualitySettings['vehicleDetail'], DetailRung> = {
  full: { player: 'hero', traffic: 'traffic' },
  reduced: { player: 'traffic', traffic: 'far' },
};

let rung: DetailRung = RUNGS.full;

/**
 * Choose how much car the quality tier can afford. Called once at startup,
 * before any vehicle is built: vehicles already built keep their geometry.
 */
export function setVehicleDetail(detail: QualitySettings['vehicleDetail']): void {
  rung = RUNGS[detail];
}

/** The levels a rung of the ladder builds at, whichever rung is in use. */
export function detailRung(detail: QualitySettings['vehicleDetail']): DetailRung {
  return RUNGS[detail];
}

/**
 * A design's geometry and fittings at one level of detail. Built on first use
 * and cached: the result is shared, so do not dispose or modify it.
 */
export function vehicleArt(design: VehicleDesign, level: VehicleLevel, plate: number): VehicleArt {
  const key = `${design.id}:${level}:${plate}`;
  const cached = built.get(key);
  if (cached) return cached;

  const hero = level === 'hero';
  const paint = design.metallic ? SURF.paintMetallic : SURF.paint;
  const shell = new BodyShell(design.body(paint), DETAIL[level]);
  const b = new VehicleBuilder();
  shell.build(b);
  const shellTriangles = b.triangleCount;
  const ctx: DesignContext = { b, shell, hero, far: level === 'far', paint, plate, exhausts: [], headlamps: [], extras: [] };
  design.details(ctx);

  const geometry = b.toGeometry();
  geometry.name = `vehicle:${key}`;
  const half = shell.spec.rearTrack / 2;
  const rearContacts = half > 0.05
    ? [new THREE.Vector3(half, 0, shell.rearAxleZ), new THREE.Vector3(-half, 0, shell.rearAxleZ)]
    : [new THREE.Vector3(0, 0, shell.rearAxleZ)];
  const size = new THREE.Vector3();
  geometry.boundingBox?.getSize(size);
  const out: VehicleArt = {
    geometry,
    exhausts: ctx.exhausts,
    headlamps: ctx.headlamps,
    extras: ctx.extras,
    size,
    triangles: b.triangleCount,
    shellTriangles,
    rearContacts,
    surfaces: b.surfaces,
  };
  built.set(key, out);
  return out;
}

/* --------------------------------------------------------------- shadows */

/**
 * The layout of a contact shadow, in -1..1 across the vehicle's footprint
 * (y runs nose to tail): a soft body and a denser pad under each tyre.
 */
interface ContactLayout {
  /** Half-extents of the flat core, then how far the edge falls off beyond it. */
  readonly core: readonly [number, number];
  readonly falloff: readonly [number, number];
  readonly body: number;
  readonly pads: ReadonlyArray<readonly [number, number]>;
  readonly padSize: readonly [number, number];
  readonly pad: number;
}

const CONTACT: Record<Chassis, ContactLayout> = {
  car: {
    core: [0.55, 0.62], falloff: [0.45, 0.38], body: 0.62,
    pads: [[-0.72, -0.6], [0.72, -0.6], [-0.72, 0.62], [0.72, 0.62]], padSize: [0.3, 0.22], pad: 0.4,
  },
  // One narrow track: a bike's shade is a sliver with a tyre at each end.
  bike: {
    core: [0.12, 0.66], falloff: [0.6, 0.3], body: 0.5,
    pads: [[0, -0.8], [0, 0.68]], padSize: [0.32, 0.16], pad: 0.5,
  },
};

const contactTex = new Map<Chassis, THREE.Texture>();

/**
 * The patch of shade a vehicle sits in.
 *
 * A shadow map is uniformly soft, so it cannot make the road darkest right
 * where the tyres touch it — and that contact is what stops a car looking
 * pasted onto the tarmac. This is the ambient half: a soft footprint under the
 * body with denser pads where the tyres are.
 */
function contactTexture(chassis: Chassis): THREE.Texture {
  const cached = contactTex.get(chassis);
  if (cached) return cached;
  const layout = CONTACT[chassis];
  const W = 128;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for the contact shadow');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x / (W - 1)) * 2 - 1;
      const ny = (y / (H - 1)) * 2 - 1;
      // Rounded-rectangle footprint.
      const qx = Math.max(Math.abs(nx) - layout.core[0], 0);
      const qy = Math.max(Math.abs(ny) - layout.core[1], 0);
      const d = Math.hypot(qx / layout.falloff[0], qy / layout.falloff[1]);
      let a = layout.body * (1 - smooth(0.0, 1.0, d));
      for (const [px, py] of layout.pads) {
        const pd = Math.hypot((nx - px) / layout.padSize[0], (ny - py) / layout.padSize[1]);
        a += layout.pad * (1 - smooth(0, 1, pd));
      }
      const i = (y * W + x) * 4;
      img.data[i] = 0;
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
      img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  contactTex.set(chassis, texture);
  return texture;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

let glowTex: THREE.Texture | null = null;
const planeGeo = new THREE.PlaneGeometry(1, 1);

/* ---------------------------------------------------------------- vehicle */

export interface VehicleOptions {
  paint: number;
  /** Stripe colour for designs that carry stripes; null for none. */
  stripes?: number | null;
  /** Underglow colour, player cars only. */
  glow?: number;
  /** Spot lights on the road ahead at night. Player only. */
  headlights?: boolean;
  /** What it stands on, for the shape of its shadow. Car when omitted. */
  chassis?: Chassis;
}

/**
 * One car on the road: a single mesh, its contact shadow, and the controls the
 * simulation drives it through.
 */
export class Vehicle extends THREE.Group {
  /**
   * Everything that leans through a corner: the body, its extras, the exhaust
   * anchors and the lamps. The contact shadow and the underglow sit outside
   * it, flat on the road, which is where a leaning bike's shadow stays.
   * Anything that should lean with the vehicle hangs off this.
   */
  readonly frame = new THREE.Group();
  readonly body: THREE.Mesh<THREE.BufferGeometry, VehicleMaterial>;
  readonly material: VehicleMaterial;
  readonly exhausts: THREE.Object3D[] = [];
  readonly headlights: THREE.SpotLight[] = [];
  readonly contactShadow: THREE.Mesh;
  readonly glow: THREE.Mesh | null = null;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly triangles: number;
  readonly designId: string;
  /** Where the driven tyres touch the road, in the vehicle's own frame. */
  readonly rearContacts: readonly THREE.Vector3[];
  private readonly owned: THREE.Material[] = [];

  constructor(design: VehicleDesign, level: VehicleLevel, plate: number, opts: VehicleOptions) {
    super();
    const art = vehicleArt(design, level, plate);
    this.designId = design.id;
    this.length = art.size.z;
    this.width = art.size.x;
    this.height = art.size.y;
    this.triangles = art.triangles;
    this.rearContacts = art.rearContacts;
    this.add(this.frame);

    this.material = new VehicleMaterial(vehicleAtlas());
    this.material.setPaint(opts.paint);
    if (design.stripes && opts.stripes !== undefined && opts.stripes !== null) {
      this.material.setStripes(opts.stripes, design.stripes.inner, design.stripes.outer);
    }
    this.owned.push(this.material);

    this.body = new THREE.Mesh(art.geometry, this.material);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.frame.add(this.body);

    for (const extra of art.extras) this.frame.add(extra.clone());

    const shadowMat = new THREE.MeshBasicMaterial({
      map: contactTexture(opts.chassis ?? 'car'),
      color: 0x000000,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      toneMapped: false,
    });
    this.owned.push(shadowMat);
    this.contactShadow = new THREE.Mesh(planeGeo, shadowMat);
    this.contactShadow.scale.set(this.width * 1.12, this.length * 1.06, 1);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.set(0, 0.015, (art.geometry.boundingBox?.getCenter(new THREE.Vector3()).z ?? 0));
    this.contactShadow.renderOrder = 1;
    this.add(this.contactShadow);

    for (const p of art.exhausts) {
      const anchor = new THREE.Object3D();
      anchor.position.copy(p);
      this.frame.add(anchor);
      this.exhausts.push(anchor);
    }

    if (opts.glow !== undefined) {
      glowTex ??= makeGlowTexture();
      const glowMat = new THREE.MeshBasicMaterial({
        map: glowTex,
        color: opts.glow,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.owned.push(glowMat);
      const glow = new THREE.Mesh(planeGeo, glowMat);
      glow.scale.set(this.width * 2.2, this.length * 1.7, 1);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.03;
      glow.renderOrder = 2;
      this.add(glow);
      this.glow = glow;
    }

    if (opts.headlights) {
      for (const p of art.headlamps) {
        const spot = new THREE.SpotLight(0xfff4e0, 0, 70, 0.42, 0.55, 1.2);
        spot.position.copy(p);
        spot.target.position.set(p.x * 0.6, 0, p.z - 22);
        this.frame.add(spot, spot.target);
        this.headlights.push(spot);
      }
    }

    this.traverse((o) => o.layers.enable(FILL_LAYER));
  }

  setWheelSpin(angle: number): void {
    this.material.vehicle.uSpin.value = angle;
  }

  setSteer(angle: number): void {
    this.material.vehicle.uSteer.value = angle;
  }

  /** Roll the vehicle about the line its tyres touch the road along. */
  setLean(angle: number): void {
    this.frame.rotation.z = angle;
  }

  /** 0 lamps at their running level, 1 full stop lamps. */
  setBrake(amount: number): void {
    this.material.vehicle.uLamps.value.y = amount * 3.2;
  }

  setTailLamps(level: number): void {
    this.material.vehicle.uLamps.value.x = level;
  }

  /** Headlamp lenses and, on the player's car, the spot lights on the road. */
  setHeadlamps(intensity: number): void {
    this.material.vehicle.uLamps.value.z = Math.min(1.4, intensity * 0.45);
    // Spot lights are in candela; the level the world hands over is a 0..4 dial.
    for (const spot of this.headlights) spot.intensity = intensity * HEADLAMP_CANDELA;
  }

  setPaint(color: number): void {
    this.material.setPaint(color);
  }

  /**
   * Release what this vehicle owns: its materials. The geometry belongs to
   * the design and is shared with every other vehicle built from it.
   */
  dispose(): void {
    for (const m of this.owned) m.dispose();
    this.owned.length = 0;
    this.removeFromParent();
  }
}

/* ---------------------------------------------------------------- public */

/**
 * The player's car. Built at the quality tier's level unless one is named —
 * the audit measures both rungs whatever tier it runs on.
 */
export function buildPlayerCar(def: CarDef, index = 0, level: VehicleLevel = rung.player): Vehicle {
  const design = PLAYER_DESIGNS[def.body];
  return new Vehicle(design, level, index, {
    paint: def.color,
    stripes: def.trim,
    glow: def.glow,
    headlights: true,
    chassis: chassisOf(def),
  });
}

/**
 * A traffic vehicle.
 *
 * Takes a caller-supplied 0..1 roll rather than drawing from a random source:
 * the number of values consumed from the simulation's stream must not depend
 * on whether a pooled vehicle happened to need a new body.
 */
export function buildTrafficCar(kind: TrafficKind, colorRoll: number, level: VehicleLevel = rung.traffic): Vehicle {
  const design = TRAFFIC_DESIGNS[kind];
  const paints = TRAFFIC_PAINTS[kind];
  const paint = paints[Math.min(paints.length - 1, Math.floor(colorRoll * paints.length))];
  return new Vehicle(design, level, TRAFFIC_PLATES[kind], { paint });
}

/**
 * The shared geometry of a traffic design, for ranks of parked cars drawn as
 * one instanced mesh. Owned by the factory's cache: do not dispose it.
 */
export function trafficGeometry(kind: TrafficKind): THREE.BufferGeometry {
  return vehicleArt(TRAFFIC_DESIGNS[kind], 'far', TRAFFIC_PLATES[kind]).geometry;
}

/**
 * The material for parked cars: paint from each instance's colour, lamps
 * off, wheels still.
 */
export function parkedCarMaterial(): VehicleMaterial {
  const m = new VehicleMaterial(vehicleAtlas());
  m.setPaint(0xffffff);
  m.vehicle.uLamps.value.set(0.12, 0, 0, 0.05);
  return m;
}

/** Repaint a pooled traffic vehicle without rebuilding it. */
export function trafficPaint(kind: TrafficKind, colorRoll: number): number {
  const paints = TRAFFIC_PAINTS[kind];
  return paints[Math.min(paints.length - 1, Math.floor(colorRoll * paints.length))];
}

/** Release every shared geometry and texture. Teardown only. */
export function disposeVehicleCaches(): void {
  for (const art of built.values()) art.geometry.dispose();
  built.clear();
  disposePartCache();
  disposeVehicleAtlas();
  for (const texture of contactTex.values()) texture.dispose();
  contactTex.clear();
  glowTex?.dispose();
  glowTex = null;
}
