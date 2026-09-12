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

  ctx.fillStyle = '#22242a';
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
