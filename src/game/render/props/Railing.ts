import * as THREE from 'three';
import { railingTexture } from '../textures/SurfaceTextures';
import { linear, PropMesh } from './PropMesh';

/**
 * A bay of promenade railing, 4 m long, for laying end to end along the kerb.
 *
 * The balusters, rings and rails are an alpha cut-out on a single upright
 * sheet, so a whole seafront of ironwork is one instanced draw call; a solid
 * cap rail and post on top of it give the run some depth where the eye lands.
 * It throws a proper comb of shadow across the pavement, because the shadow
 * pass honours the same cut-out.
 */

export const RAILING_BAY = 4;
const HEIGHT = 0.98;

/** A patch of the atlas that is solid black: the post column of the texture. */
const SOLID: readonly [number, number, number, number] = [0.004, 0.3, 0.012, 0.7];

export function railingGeometry(): THREE.BufferGeometry {
  const m = new PropMesh();
  const white = linear(0xffffff);
  const half = RAILING_BAY / 2;

  // The sheet: two copies of the 2 m pattern along the bay.
  const n = new THREE.Vector3(1, 0, 0);
  const a = m.vertex(new THREE.Vector3(0, 0, -half), n, 0, 0, white);
  const b = m.vertex(new THREE.Vector3(0, 0, half), n, 2, 0, white);
  const c = m.vertex(new THREE.Vector3(0, HEIGHT, half), n, 2, 1, white);
  const d = m.vertex(new THREE.Vector3(0, HEIGHT, -half), n, 0, 1, white);
  m.triangle(a, b, c);
  m.triangle(a, c, d);

  // Cap rail and one post per bay, solid.
  const cap = new THREE.BoxGeometry(0.06, 0.05, RAILING_BAY);
  m.addGeometry(cap, new THREE.Matrix4().makeTranslation(0, HEIGHT + 0.02, 0), SOLID, white);
  cap.dispose();
  const post = new THREE.BoxGeometry(0.07, HEIGHT + 0.08, 0.07);
  m.addGeometry(post, new THREE.Matrix4().makeTranslation(0, (HEIGHT + 0.08) / 2, -half), SOLID, white);
  post.dispose();
  const finial = new THREE.SphereGeometry(0.055, 8, 6);
  m.addGeometry(finial, new THREE.Matrix4().makeTranslation(0, HEIGHT + 0.12, -half), SOLID, white);
  finial.dispose();

  const g = m.toGeometry();
  g.name = 'railing-bay';
  return g;
}

let railingMat: THREE.MeshStandardMaterial | null = null;

export function railingMaterial(): THREE.MeshStandardMaterial {
  if (railingMat) return railingMat;
  railingMat = new THREE.MeshStandardMaterial({
    map: railingTexture(),
    color: 0xffffff,
    alphaTest: 0.5,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.42,
    metalness: 0.55,
    envMapIntensity: 0.9,
  });
  railingMat.name = 'Railing';
  return railingMat;
}

export function disposeRailings(): void {
  railingMat?.map?.dispose();
  railingMat?.dispose();
  railingMat = null;
}
