import * as THREE from 'three';
import { onNight } from '../NightLights';
import { linear, PropMesh } from './PropMesh';

/**
 * A boulevard lamp standard.
 *
 * Authored with local +X pointing at the carriageway, which is the convention
 * every laid scenery kind follows: the arm leaves the top of the pole, curves
 * up and out, and holds a flat lantern over the traffic lane.
 *
 * The lens is the one emissive surface, selected by UV rather than by a second
 * material: the emissive map is black except for one texel the lens samples,
 * so the whole standard stays a single instanced draw call and the lens can be
 * lit at dusk by one intensity on the shared material.
 */

const DARK: readonly [number, number, number, number] = [0.1, 0.25, 0.4, 0.75];
const LIT: readonly [number, number, number, number] = [0.6, 0.25, 0.9, 0.75];

export function streetLampGeometry(): THREE.BufferGeometry {
  const m = new PropMesh();
  const pole = linear(0x9aa0a6);
  const head = linear(0x3c4046);
  const lens = linear(0xfff2d6);

  const plinth = new THREE.CylinderGeometry(0.15, 0.2, 0.55, 12);
  m.addGeometry(plinth, new THREE.Matrix4().makeTranslation(0, 0.275, 0), DARK, linear(0x6c7076));
  plinth.dispose();

  const shaft = new THREE.CylinderGeometry(0.055, 0.1, 8.7, 12);
  m.addGeometry(shaft, new THREE.Matrix4().makeTranslation(0, 0.5 + 4.35, 0), DARK, pole);
  shaft.dispose();

  const collar = new THREE.CylinderGeometry(0.08, 0.08, 0.18, 12);
  m.addGeometry(collar, new THREE.Matrix4().makeTranslation(0, 3.2, 0), DARK, head);
  collar.dispose();

  // Arm: up, round a bend and out over the road, rising slightly.
  const pts: THREE.Vector3[] = [];
  const bend = 0.85;
  const topY = 9.15;
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector3(bend - Math.cos(a) * bend, topY + Math.sin(a) * bend, 0));
  }
  pts.push(new THREE.Vector3(1.8, topY + bend + 0.08, 0));
  pts.push(new THREE.Vector3(2.55, topY + bend + 0.14, 0));
  const arm = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.048, 8, false);
  m.addGeometry(arm, new THREE.Matrix4(), DARK, pole);
  arm.dispose();

  // Lantern: a flat, tapered housing with the lens set into its underside.
  const housing = new THREE.SphereGeometry(1, 16, 10);
  const hm = new THREE.Matrix4().compose(
    new THREE.Vector3(2.75, topY + bend + 0.13, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.06)),
    new THREE.Vector3(0.48, 0.1, 0.22),
  );
  m.addGeometry(housing, hm, DARK, head);
  housing.dispose();

  const lensGeo = new THREE.CircleGeometry(1, 16);
  lensGeo.rotateX(Math.PI / 2);
  const lm = new THREE.Matrix4().compose(
    new THREE.Vector3(2.75, topY + bend + 0.06, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.06)),
    new THREE.Vector3(0.36, 1, 0.15),
  );
  m.addGeometry(lensGeo, lm, LIT, lens);
  lensGeo.dispose();

  const g = m.toGeometry();
  g.name = 'street-lamp';
  return g;
}

let lampMat: THREE.MeshStandardMaterial | null = null;
let unsubscribe: (() => void) | null = null;

export function streetLampMaterial(): THREE.MeshStandardMaterial {
  if (lampMat) return lampMat;
  // Left half black, right half white: the lens UVs sit in the right half.
  const data = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
  const emissiveMap = new THREE.DataTexture(data, 2, 1);
  emissiveMap.magFilter = THREE.NearestFilter;
  emissiveMap.minFilter = THREE.NearestFilter;
  emissiveMap.needsUpdate = true;
  lampMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.65,
    envMapIntensity: 1.0,
    emissive: 0xfff0d0,
    emissiveMap,
    emissiveIntensity: 0.25,
  });
  lampMat.name = 'StreetLamp';
  unsubscribe = onNight(setStreetLampGlow);
  return lampMat;
}

/** Light the lenses: 0 by day, up to 1 at night. */
export function setStreetLampGlow(level: number): void {
  if (lampMat) lampMat.emissiveIntensity = 0.2 + level * 3.5;
}

export function disposeStreetLamps(): void {
  unsubscribe?.();
  unsubscribe = null;
  lampMat?.emissiveMap?.dispose();
  lampMat?.dispose();
  lampMat = null;
}
