import * as THREE from 'three';

/**
 * A panoramic band of cumulus, painted once.
 *
 * Cumulus is what the reference's sky is made of — separate, defined bodies
 * with flat bases, cauliflower tops, a bright sunlit side and a grey-blue
 * shadowed underside — and noise does not make it: thresholded fbm gives soft
 * blobs or, warped, long streaks, never a cloud with a *shape*. So they are
 * painted, the way a skybox is: each cloud built from a row of puffs along a
 * flat base with smaller puffs stacked on top, every puff drawn once in shade
 * and again, smaller and offset towards the light, lit.
 *
 * The texture stores lighting rather than colour: red is how lit a point is,
 * alpha is coverage. The sky shader colours it from the live palette, so the
 * same clouds are white at noon, gold at dusk and grey under a storm.
 *
 * It wraps horizontally all the way round the horizon; vertically it covers
 * the lower sky, from the horizon up to about 35 degrees.
 */

const W = 4096;
const H = 512;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Puff {
  x: number;
  y: number;
  r: number;
}

/** One cloud's puffs, base at `baseY` (canvas y grows downwards). */
function cloudPuffs(r: () => number, cx: number, baseY: number, width: number, height: number): Puff[] {
  const puffs: Puff[] = [];
  const baseCount = Math.max(4, Math.round(width / 26));
  const spacing = width / baseCount;
  // The flat base: a row of overlapping puffs sitting on one line, irregular
  // in size and spacing so the row never reads as a string of beads.
  for (let i = 0; i < baseCount; i++) {
    const t = i / (baseCount - 1);
    const x = cx - width / 2 + t * width + (r() - 0.5) * spacing * 0.6;
    const bulge = Math.sin(t * Math.PI);
    const rad = (height * 0.3) * (0.5 + 0.5 * bulge) * (0.7 + r() * 0.6);
    puffs.push({ x, y: baseY - rad * (0.45 + r() * 0.2), r: rad });
  }
  // Towers: stacked puffs rising from the middle of the base.
  const towers = 2 + Math.floor(r() * 3);
  for (let k = 0; k < towers; k++) {
    let x = cx + (r() - 0.5) * width * 0.6;
    let y = baseY - height * 0.3;
    let rad = height * (0.22 + r() * 0.12);
    const levels = 2 + Math.floor(r() * 3);
    for (let l = 0; l < levels; l++) {
      puffs.push({ x, y, r: rad });
      // A couple of shoulder puffs either side of each level.
      puffs.push({ x: x - rad * (0.7 + r() * 0.3), y: y + rad * 0.25, r: rad * (0.6 + r() * 0.2) });
      puffs.push({ x: x + rad * (0.7 + r() * 0.3), y: y + rad * 0.3, r: rad * (0.55 + r() * 0.2) });
      x += (r() - 0.5) * rad * 0.6;
      y -= rad * (0.75 + r() * 0.25);
      rad *= 0.72 + r() * 0.12;
      if (baseY - y > height) break;
    }
  }
  // Small buds on the upper contour: cumulus boils at its edges.
  const main = puffs.length;
  for (let i = 0; i < main; i++) {
    const p = puffs[i];
    const buds = 1 + Math.floor(r() * 3);
    for (let k = 0; k < buds; k++) {
      const a = -Math.PI * (0.15 + r() * 0.7);
      const br = p.r * (0.28 + r() * 0.2);
      const x = p.x + Math.cos(a) * p.r * 0.82;
      const y = p.y + Math.sin(a) * p.r * 0.82;
      if (y + br < baseY) puffs.push({ x, y, r: br });
    }
  }
  return puffs;
}

/** Value noise for roughening edges, wrapping horizontally at `period`. */
function valueNoise(seed: number, period: number): (x: number, y: number) => number {
  const r = rng(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = r();
  return (x: number, y: number) => {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const fx = x - gx;
    const fy = y - gy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (ix: number, iy: number): number =>
      table[(((iy % size) + size) % size) * size + ((((ix % period) + period) % period) % size)];
    const a = at(gx, gy);
    const b = at(gx + 1, gy);
    const c = at(gx, gy + 1);
    const d = at(gx + 1, gy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/**
 * Break up every edge with two octaves of noise: coverage near the boundary
 * is pushed in or out, so no outline is a perfect arc.
 */
function roughen(g: CanvasRenderingContext2D): void {
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  // Cell sizes that divide the band's width, so the noise wraps with it.
  const coarse = valueNoise(7, W / 32);
  const fine = valueNoise(13, W / 8);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4 + 3;
      const a = d[i] / 255;
      if (a <= 0 || a >= 0.98) continue;
      const n = coarse(x / 32, y / 32) * 0.65 + fine(x / 8, y / 8) * 0.35;
      const edge = Math.min(1, Math.max(0, a + (n - 0.5) * 0.9));
      d[i] = Math.round(edge * edge * (3 - 2 * edge) * 255);
    }
  }
  g.putImageData(img, 0, 0);
}

function drawWrapped(p: Puff, paint: (x: number) => void): void {
  paint(p.x);
  if (p.x - p.r < 0) paint(p.x + W);
  if (p.x + p.r > W) paint(p.x - W);
}

let texture: THREE.CanvasTexture | null = null;

export function cloudTexture(): THREE.CanvasTexture {
  if (texture) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for the clouds');
  g.clearRect(0, 0, W, H);
  const r = rng(90210);

  // Light comes from up and to the left in the painting.
  const lx = -0.45;
  const ly = -0.62;

  const clouds: Array<{ cx: number; base: number; w: number; h: number; haze: number }> = [];
  // Near clouds, big and high; far ones smaller and hugging the horizon.
  for (let i = 0; i < 16; i++) {
    const far = r() < 0.45;
    const w = far ? 160 + r() * 260 : 320 + r() * 520;
    const h = far ? 60 + r() * 70 : 120 + r() * 170;
    const base = far ? H - 20 - r() * 40 : H - 70 - r() * 150;
    clouds.push({ cx: r() * W, base, w, h, haze: far ? 0.55 : 0.0 });
  }
  // Paint the far ones first so near clouds overlap them.
  clouds.sort((a, b) => b.haze - a.haze);

  for (const c of clouds) {
    const puffs = cloudPuffs(r, c.cx, c.base, c.w, c.h);
    // Shade layer: the whole cloud in shadow, with a soft edge.
    for (const p of puffs) {
      drawWrapped(p, (x) => {
        const grad = g.createRadialGradient(x, p.y, p.r * 0.2, x, p.y, p.r);
        const a = 1 - c.haze * 0.5;
        grad.addColorStop(0, `rgba(40,0,0,${a})`);
        grad.addColorStop(0.72, `rgba(55,0,0,${a * 0.92})`);
        grad.addColorStop(1, 'rgba(70,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      });
    }
    // Lit layer: each puff again, smaller, pushed towards the light.
    for (const p of puffs) {
      drawWrapped(p, (x) => {
        const ox = x + lx * p.r * 0.28;
        const oy = p.y + ly * p.r * 0.28;
        const rad = p.r * 0.86;
        const grad = g.createRadialGradient(ox + lx * rad * 0.3, oy + ly * rad * 0.3, rad * 0.05, ox, oy, rad);
        const a = 1 - c.haze * 0.5;
        grad.addColorStop(0, `rgba(255,0,0,${a})`);
        grad.addColorStop(0.55, `rgba(230,0,0,${a * 0.85})`);
        grad.addColorStop(1, 'rgba(160,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(ox - rad, oy - rad, rad * 2, rad * 2);
      });
    }
    // Flat, darker base.
    g.fillStyle = 'rgba(30,0,0,0.35)';
    g.fillRect(c.cx - c.w * 0.45, c.base - 6, c.w * 0.9, 6);
  }

  roughen(g);

  texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // Data, not colour: red is light, alpha is coverage.
  texture.colorSpace = THREE.NoColorSpace;
  // Magnified in every view the game has, and a mip chain would put a seam
  // down the back of the sky where the azimuth wraps.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.name = 'Clouds';
  return texture;
}

export function disposeClouds(): void {
  texture?.dispose();
  texture = null;
}
