/**
 * Mip chains for alpha-tested textures that keep their coverage.
 *
 * Standard mipmapping averages alpha, and averaging a fine cut-out pattern —
 * leaflets, railing balusters — pulls every texel towards the middle grey.
 * Once that grey falls below the alpha test, the pattern simply disappears
 * with distance: a palm that is a full crown at twenty metres is a bare stick
 * at a hundred. The fix (Castaño's, from The Witness) is to rescale each mip
 * level's alpha so that the fraction of texels passing the test matches the
 * full-size texture, region by region.
 *
 * Colour is averaged weighted by alpha, so the transparent black around each
 * leaflet does not bleed in as a dark fringe at small sizes.
 */

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function coverage(data: Uint8ClampedArray, stride: number, r: PixelRect, cutoff: number, scale: number): number {
  let pass = 0;
  const limit = cutoff * 255;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (data[(y * stride + x) * 4 + 3] * scale > limit) pass++;
    }
  }
  return pass / Math.max(1, r.w * r.h);
}

function downsample(src: ImageData): ImageData {
  const w = Math.max(1, src.width >> 1);
  const h = Math.max(1, src.height >> 1);
  const out = new ImageData(w, h);
  const s = src.data;
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(src.width - 1, x * 2 + dx);
          const sy = Math.min(src.height - 1, y * 2 + dy);
          const i = (sy * src.width + sx) * 4;
          const al = s[i + 3];
          r += s[i] * al;
          g += s[i + 1] * al;
          b += s[i + 2] * al;
          a += al;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        d[o] = r / a;
        d[o + 1] = g / a;
        d[o + 2] = b / a;
      }
      d[o + 3] = a / 4;
    }
  }
  return out;
}

/**
 * Build a full mip chain for `source`, level 0 first, with alpha coverage
 * preserved inside each of `regions` (given in level-0 pixels).
 */
export function coverageMipmaps(source: HTMLCanvasElement, regions: readonly PixelRect[], cutoff: number): HTMLCanvasElement[] {
  const ctx = source.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for mip generation');
  let level = ctx.getImageData(0, 0, source.width, source.height);
  const targets = regions.map((r) => coverage(level.data, level.width, r, cutoff, 1));

  const out: HTMLCanvasElement[] = [source];
  let factor = 1;
  while (level.width > 1 || level.height > 1) {
    level = downsample(level);
    factor *= 2;
    regions.forEach((r0, k) => {
      const r = {
        x: Math.floor(r0.x / factor),
        y: Math.floor(r0.y / factor),
        w: Math.max(1, Math.floor(r0.w / factor)),
        h: Math.max(1, Math.floor(r0.h / factor)),
      };
      // Binary search the alpha scale that restores the level-0 coverage.
      let lo = 0;
      let hi = 8;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (coverage(level.data, level.width, r, cutoff, mid) < targets[k]) lo = mid;
        else hi = mid;
      }
      const scale = (lo + hi) / 2;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i = (y * level.width + x) * 4 + 3;
          level.data[i] = Math.min(255, level.data[i] * scale);
        }
      }
    });
    const c = document.createElement('canvas');
    c.width = level.width;
    c.height = level.height;
    c.getContext('2d')?.putImageData(level, 0, 0);
    out.push(c);
  }
  return out;
}
