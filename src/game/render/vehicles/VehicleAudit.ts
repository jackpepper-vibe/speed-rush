import * as THREE from 'three';
import type { TrafficKind } from '@/core/GameEvents';
import type { CarDef } from '@/game/config/Cars';
import { PLAYER_DESIGNS, TRAFFIC_DESIGNS, TRAFFIC_PLATES } from './designs';
import {
  buildPlayerCar,
  buildTrafficCar,
  detailRung,
  vehicleArt,
  type Vehicle,
  type VehicleArt,
  type VehicleLevel,
} from './VehicleFactory';
import { LAMP_CHANNEL } from './VehicleMaterial';

/**
 * Measures every vehicle the game can build, for the probe.
 *
 * Built rather than read off the live scene, so the audit covers vehicles that
 * have not spawned yet: a car only the garage ever shows is still a car that
 * can be broken. And built at both rungs of the quality ladder whatever tier
 * the page resolved to. The probe runs pinned to the bottom rung, and reading
 * the ambient level there would report the cut-down hero as the shipping model.
 */

export interface ModelAudit {
  id: string;
  /**
   * player and traffic are the top rung, what the art is authored for;
   * hero-lod and traffic-lod are the same vehicles on the bottom rung.
   */
  kind: 'player' | 'hero-lod' | 'traffic' | 'traffic-lod';
  level: VehicleLevel;
  triangles: number;
  /** Draw calls the vehicle costs, contact shadow and underglow included. */
  drawCalls: number;
  /** What its one material renders: paint, glass, rubber, chrome, lamps... */
  surfaces: string[];
  /** Lamp channels its lenses are wired to: tail, brake, head, amber. */
  lamps: string[];
  /**
   * Additively blended meshes carrying no texture. Additive blending on an
   * untextured quad draws exactly what it is — a hard-edged rectangle of flat
   * colour — which reads as a lighting effect right up until someone looks at
   * a still.
   */
  bareAdditiveQuads: number;
  /**
   * Meshes rendering with `flatShading`: one word in a material literal
   * discards the averaged normals the loft exists to produce.
   */
  flatShadedMeshes: number;
  /**
   * Share of the lofted shell's adjacent-face angles under 20 degrees; 1 is a
   * body with no creases at all. Triangle count alone cannot tell a smooth
   * body from a finely subdivided box.
   */
  silhouette: number;
  length: number;
  width: number;
  height: number;
}

const LAMP_NAMES = new Map<number, string>(Object.entries(LAMP_CHANNEL).map(([name, channel]) => [channel, name]));

/** Build one of everything, at both rungs, and measure it. */
export function auditVehicles(defs: readonly CarDef[]): ModelAudit[] {
  const out: ModelAudit[] = [];
  const top = detailRung('full');
  const bottom = detailRung('reduced');

  defs.forEach((def, i) => {
    const design = PLAYER_DESIGNS[def.body];
    for (const [kind, level] of [['player', top.player], ['hero-lod', bottom.player]] as const) {
      out.push(measure(def.id, kind, level, buildPlayerCar(def, i, level), vehicleArt(design, level, i)));
    }
  });
  for (const id of Object.keys(TRAFFIC_DESIGNS) as TrafficKind[]) {
    const design = TRAFFIC_DESIGNS[id];
    for (const [kind, level] of [['traffic', top.traffic], ['traffic-lod', bottom.traffic]] as const) {
      out.push(measure(id, kind, level, buildTrafficCar(id, 0.5, level), vehicleArt(design, level, TRAFFIC_PLATES[id])));
    }
  }
  return out;
}

function measure(id: string, kind: ModelAudit['kind'], level: VehicleLevel, v: Vehicle, art: VehicleArt): ModelAudit {
  let calls = 0;
  let bare = 0;
  let flat = 0;
  v.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    calls += 1;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      if (m.blending === THREE.AdditiveBlending && !(m as THREE.MeshBasicMaterial).map) bare += 1;
      if ((m as THREE.MeshStandardMaterial).flatShading) flat += 1;
    }
  });
  const lamps = new Set<string>();
  for (const s of art.surfaces) {
    if (s.lamp !== LAMP_CHANNEL.none) lamps.add(LAMP_NAMES.get(s.lamp) ?? `channel-${s.lamp}`);
  }
  const audit: ModelAudit = {
    id,
    kind,
    level,
    triangles: art.triangles,
    drawCalls: calls,
    surfaces: art.surfaces.map((s) => s.name).sort(),
    lamps: [...lamps].sort(),
    bareAdditiveQuads: bare,
    flatShadedMeshes: flat,
    silhouette: silhouetteSmoothness(art.geometry, art.shellTriangles),
    length: v.length,
    width: v.width,
    height: v.height,
  };
  v.dispose();
  return audit;
}

/**
 * Fraction of the edges shared by two of the first `faces` triangles whose
 * face normals differ by less than `limit` degrees.
 *
 * Edges are matched by vertex index, so a deliberate surface boundary — glass
 * meeting a pillar, where the builder splits the vertices to keep the colour
 * edge crisp — is not counted as a crease.
 */
export function silhouetteSmoothness(geometry: THREE.BufferGeometry, faces: number, limit = 20): number {
  const index = geometry.getIndex();
  const pos = geometry.getAttribute('position');
  if (!index || faces <= 0) return 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normals: THREE.Vector3[] = [];
  for (let f = 0; f < faces; f++) {
    a.fromBufferAttribute(pos, index.getX(f * 3));
    b.fromBufferAttribute(pos, index.getX(f * 3 + 1));
    c.fromBufferAttribute(pos, index.getX(f * 3 + 2));
    normals.push(new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).normalize());
  }

  const byEdge = new Map<number, number[]>();
  const vertices = pos.count;
  for (let f = 0; f < faces; f++) {
    for (let e = 0; e < 3; e++) {
      const v0 = index.getX(f * 3 + e);
      const v1 = index.getX(f * 3 + ((e + 1) % 3));
      const key = Math.min(v0, v1) * vertices + Math.max(v0, v1);
      const list = byEdge.get(key);
      if (list) list.push(f);
      else byEdge.set(key, [f]);
    }
  }

  const cosLimit = Math.cos(THREE.MathUtils.degToRad(limit));
  let shared = 0;
  let smooth = 0;
  for (const list of byEdge.values()) {
    if (list.length !== 2) continue;
    shared += 1;
    if (normals[list[0]].dot(normals[list[1]]) >= cosLimit) smooth += 1;
  }
  return shared ? smooth / shared : 0;
}
