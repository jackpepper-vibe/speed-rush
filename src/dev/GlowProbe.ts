import * as THREE from 'three';

/**
 * Measure the underglow's edge profile.
 *
 * The bug this exists to catch is a hard-edged rectangle of colour under the
 * car: additive blending on an untextured quad. Checking the material has a map
 * is not enough — the map can be attached and the thing still draw as a square
 * if the blending, the UVs or the geometry are wrong. What has to be true is
 * that the rendered intensity *falls off* toward the edges, and that is only
 * answerable by rendering it and reading the pixels back.
 *
 * Rendered in isolation against black rather than sampled from the live frame.
 * In the game the glow sits on tarmac crossed by lane markings, whose hard
 * edges are far larger steps than the one being looked for — measuring it there
 * would report a hard edge whatever the glow was doing.
 */
export interface GlowProfile {
  /** Intensity across the middle row, left to right, 0..255. */
  row: number[];
  peak: number;
  /** Largest jump between neighbouring samples, as a fraction of peak. */
  maxStep: number;
  /** Mean of the outermost 10% of samples, as a fraction of peak. */
  edgeLevel: number;
}

const SIZE = 64;

export function measureGlow(renderer: THREE.WebGLRenderer, glow: THREE.Mesh): GlowProfile {
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // A copy at full opacity: in play the mesh fades in with speed, and a probe
  // that happened to run at a standstill would read a uniformly black square
  // and call it a soft falloff.
  const source = glow.material as THREE.MeshBasicMaterial;
  const material = new THREE.MeshBasicMaterial({
    map: source.map,
    color: source.color.clone(),
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const quad = new THREE.Mesh(glow.geometry, material);
  scene.add(quad);

  // Framed so the quad fills 80% of the target, leaving margin either side —
  // a profile with no background in it cannot show an edge.
  const half = 0.625;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 10);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);

  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);

  const pixels = new Uint8Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
  renderer.setRenderTarget(previousTarget);

  // The middle row, taking the brightest channel — the glow is tinted, so the
  // red of an orange underglow is the signal and the blue is nearly nothing.
  const midY = Math.floor(SIZE / 2);
  const row: number[] = [];
  for (let x = 0; x < SIZE; x++) {
    const i = (midY * SIZE + x) * 4;
    row.push(Math.max(pixels[i], pixels[i + 1], pixels[i + 2]));
  }

  const peak = Math.max(...row, 1);
  let maxStep = 0;
  for (let i = 1; i < row.length; i++) {
    maxStep = Math.max(maxStep, Math.abs(row[i] - row[i - 1]));
  }

  const margin = Math.max(1, Math.floor(row.length * 0.1));
  const edges = [...row.slice(0, margin), ...row.slice(-margin)];
  const edgeLevel = edges.reduce((a, b) => a + b, 0) / edges.length / peak;

  target.dispose();
  material.dispose();

  return { row, peak, maxStep: maxStep / peak, edgeLevel };
}
