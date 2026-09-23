import * as THREE from 'three';
import { coverageMipmaps } from './CoverageMips';

/**
 * Tiling surface textures, painted in code: asphalt, paving, and the railing
 * balustrade.
 *
 * Each is drawn seamlessly — anything that crosses an edge is drawn again on
 * the opposite edge — so it can repeat across a road four hundred metres long
 * without a visible grid.
 */

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

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for surface textures');
  return [c, g];
}

/** Draw a shape at (x, y) and at every wrapped copy that touches the tile. */
function wrapped(size: number, x: number, y: number, r: number, draw: (x: number, y: number) => void): void {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const px = x + dx;
      const py = y + dy;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      draw(px, py);
    }
  }
}

function finish(c: HTMLCanvasElement, repeat: boolean, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Asphalt, as a detail layer centred on mid-grey.
 *
 * Multiplied over the road's own colour in the shader, so it carries grain,
 * aggregate and the odd darker patch and no colour of its own. Stones are
 * drawn at several sizes because real aggregate is graded; a single size of
 * speckle is what makes procedural tarmac look like sandpaper.
 */
export function asphaltDetail(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(4242);
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, S, S);

  // Soft blotches: binder richer in some places than others.
  for (let i = 0; i < 90; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 20 + r() * 70;
    const v = r() < 0.5 ? 110 : 146;
    wrapped(S, x, y, rad, (px, py) => {
      const grad = g.createRadialGradient(px, py, 0, px, py, rad);
      grad.addColorStop(0, `rgba(${v},${v},${v},0.16)`);
      grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grad;
      g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }

  // Graded aggregate: many small stones, fewer large ones, lit and dark.
  for (const [count, min, max] of [[9000, 0.6, 1.3], [2600, 1.2, 2.2], [500, 2, 3.4]] as const) {
    for (let i = 0; i < count; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = min + r() * (max - min);
      const light = r();
      const v = light < 0.45 ? 70 + r() * 40 : 150 + r() * 70;
      g.fillStyle = `rgba(${v},${v},${v},${0.55 + r() * 0.4})`;
      wrapped(S, x, y, rad, (px, py) => {
        g.beginPath();
        g.ellipse(px, py, rad, rad * (0.6 + r() * 0.4), r() * Math.PI, 0, Math.PI * 2);
        g.fill();
      });
    }
  }
  const t = finish(c, true, false);
  t.name = 'AsphaltDetail';
  return t;
}

/**
 * Paving slabs in a stretcher bond, for the pavements.
 *
 * Tile is 2 m by 2 m in the world: four courses of 0.5 m slabs, offset by
 * half a slab each course, with a dark joint and a slight variation in each
 * slab's tone.
 */
export function pavingTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(77);
  const course = S / 4;
  const slab = S / 2;
  g.fillStyle = '#6e6a64';
  g.fillRect(0, 0, S, S);
  for (let row = 0; row < 4; row++) {
    const offset = row % 2 === 0 ? 0 : slab / 2;
    for (let col = -1; col < 3; col++) {
      const x = col * slab + offset;
      const y = row * course;
      const tone = 196 + r() * 26;
      const warm = r() * 10;
      g.fillStyle = `rgb(${tone + warm},${tone + warm * 0.6},${tone - warm * 0.4})`;
      g.fillRect(x + 3, y + 3, slab - 6, course - 6);
      // Weathering speckle inside each slab.
      for (let k = 0; k < 140; k++) {
        const sx = x + 3 + r() * (slab - 6);
        const sy = y + 3 + r() * (course - 6);
        const v = r() < 0.5 ? 150 : 232;
        g.fillStyle = `rgba(${v},${v},${v},0.35)`;
        g.fillRect(sx, sy, 1.5, 1.5);
      }
    }
  }
  const t = finish(c, true, true);
  t.name = 'Paving';
  return t;
}

/**
 * One bay of the promenade balustrade, as an alpha cut-out: a top rail, a
 * bottom rail and closely spaced balusters, with a ring motif every fourth
 * gap — the ironwork along every Riviera seafront.
 *
 * Mapped once per 2 m along the railing; black, so all the modelling is in
 * the silhouette and the shadow it throws on the pavement.
 */
export function railingTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#16181b';
  g.strokeStyle = '#16181b';
  // Rails.
  g.fillRect(0, 6, W, 16);
  g.fillRect(0, H - 34, W, 12);
  g.fillRect(0, 34, W, 5);
  // Balusters.
  const pitch = W / 16;
  for (let i = 0; i < 16; i++) {
    const x = i * pitch + pitch / 2;
    g.fillRect(x - 3, 20, 6, H - 40);
  }
  // Rings between every other pair.
  g.lineWidth = 4;
  for (let i = 0; i < 16; i += 2) {
    const x = i * pitch + pitch;
    g.beginPath();
    g.arc(x, 60, pitch * 0.42, 0, Math.PI * 2);
    g.stroke();
  }
  // Posts at each end of the bay.
  g.fillRect(0, 0, 10, H);
  g.fillRect(W - 10, 0, 10, H);

  const t = finish(c, true, true);
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.mipmaps = coverageMipmaps(c, [{ x: 0, y: 0, w: W, h: H }], 0.5);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.name = 'Railing';
  return t;
}
