import * as THREE from 'three';

/**
 * Canvas-authored road textures.
 *
 * Drawn at runtime rather than shipped as PNGs so the whole game stays a single
 * deployable with no asset pipeline, and so lane count changes in `Balance.ts`
 * regenerate correct markings instead of silently disagreeing with a baked
 * image.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable — cannot author road textures');
  return [c, ctx];
}

/** Asphalt with lane dashes, solid edges and a worn centre. One tile = one segment. */
export function makeRoadTexture(laneCount: number, repeatY: number): THREE.Texture {
  const W = 512;
  const H = 512;
  const [c, ctx] = canvas(W, H);

  // Mid-grey, not near-black. Real asphalt in daylight sits around 20% grey;
  // the first value here was dark enough that the road had no tone of its own
  // and every lighting change showed up only in the sky.
  ctx.fillStyle = '#3c3f47';
  ctx.fillRect(0, 0, W, H);

  // Aggregate speckle, and two darker wheel tracks per lane.
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const laneW = W / laneCount;
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for (let l = 0; l < laneCount; l++) {
    const cx = (l + 0.5) * laneW;
    ctx.fillRect(cx - laneW * 0.3, 0, laneW * 0.16, H);
    ctx.fillRect(cx + laneW * 0.14, 0, laneW * 0.16, H);
  }

  // Dashed lane dividers.
  ctx.fillStyle = '#d9dbe0';
  const dash = H / 6;
  for (let l = 1; l < laneCount; l++) {
    const x = l * laneW - 2.5;
    for (let y = 0; y < H; y += dash) ctx.fillRect(x, y, 5, dash * 0.52);
  }

  // Solid edge lines.
  ctx.fillStyle = '#e8e8ec';
  ctx.fillRect(3, 0, 6, H);
  ctx.fillRect(W - 9, 0, 6, H);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, repeatY);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Rumble strip for the shoulders — alternating red/white blocks. */
export function makeShoulderTexture(): THREE.Texture {
  const [c, ctx] = canvas(32, 128);
  ctx.fillStyle = '#3a3d44';
  ctx.fillRect(0, 0, 32, 128);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#c8c8cc' : '#b0303a';
    ctx.fillRect(0, i * 16, 32, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial sprite used for every particle and light bloom in the game. */
export function makeGlowTexture(): THREE.Texture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The soft dark patch a car casts straight down onto the road.
 *
 * A shadow map alone does not do this job. Its blur is uniform, so the darkest
 * part of a car's shadow is no darker directly under the sills than it is a
 * metre out, and the car reads as sitting *on* the road rather than in contact
 * with it. This is the ambient half of the same effect: an elliptical gradient,
 * dense under the body and gone by the edge, drawn under every car regardless
 * of tier — which is also what keeps the low tier, where shadows are off
 * entirely, from floating its cars over the tarmac.
 *
 * Authored as alpha over black. Multiply blending would be more physical, but
 * it also multiplies the road's specular back to nothing; painting black with
 * a falloff keeps the wet sheen on the tarmac around the car.
 */
export function makeContactShadowTexture(): THREE.Texture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Squashed along the car's length so the core follows the body rather
      // than pooling in a circle under the middle of it.
      const nx = (x / (S - 1)) * 2 - 1;
      const ny = (y / (S - 1)) * 2 - 1;
      const r = Math.hypot(nx * 1.28, ny);
      // Flat, dense core out to 40%, then a smoothstep to nothing.
      const t = Math.min(1, Math.max(0, (r - 0.4) / 0.6));
      const a = 1 - t * t * (3 - 2 * t);
      const i = (y * S + x) * 4;
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
      d[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Lit windows for city buildings, with a scattering of dark units. */
export function makeBuildingTexture(): THREE.Texture {
  const [c, ctx] = canvas(128, 256);
  ctx.fillStyle = '#1b1e26';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 6; y < 250; y += 14) {
    for (let x = 6; x < 122; x += 14) {
      const r = Math.random();
      ctx.fillStyle = r > 0.62 ? '#ffdd99' : r > 0.5 ? '#88aadd' : '#141720';
      ctx.fillRect(x, y, 9, 9);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
