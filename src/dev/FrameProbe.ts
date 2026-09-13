import type * as THREE from 'three';

/**
 * Measure regions of the frame that was just drawn, without leaving the task.
 *
 * The obvious implementation — take `snapshot()`, decode the data URL into an
 * `Image`, draw it to a 2D canvas and read that — is what the first version of
 * the render gate did, and it is subtly unusable. `Image.onload` is a
 * macrotask, so awaiting it hands control back to the browser, the game's own
 * animation frame runs, and the world advances several metres between two
 * readings that were supposed to differ only in whether an effect was visible.
 * The gate passed or failed depending on how quickly the machine happened to
 * decode a PNG.
 *
 * Reading the drawing buffer directly is synchronous. Render, read, compare,
 * all in one task: two frames captured this way differ only in what was
 * changed between them, which is the entire premise of measuring an effect by
 * hiding it.
 *
 * The buffer is kept between calls. At 960×540 it is two megabytes, and a scan
 * that samples fourteen bands would otherwise allocate that fourteen times.
 */

export interface RegionSample {
  /** Mean luminance, 0..255. */
  mean: number;
  /** Fraction of pixels above 200 luma — specular hits and light sources. */
  brightFraction: number;
  /** Mean Sobel magnitude: how much detail the region holds. */
  edges: number;
}

/** A region of the frame, as fractions of its width and height, top-left origin. */
export type RegionRect = readonly [number, number, number, number];

let buffer: Uint8Array | null = null;
let bufferSize = 0;

export function sampleFrame(
  renderer: THREE.WebGLRenderer,
  rects: Record<string, RegionRect>,
): Record<string, RegionSample> {
  const gl = renderer.getContext();
  const canvas = renderer.domElement;
  const W = canvas.width;
  const H = canvas.height;

  const needed = W * H * 4;
  if (!buffer || bufferSize < needed) {
    buffer = new Uint8Array(needed);
    bufferSize = needed;
  }
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buffer);

  const out: Record<string, RegionSample> = {};

  for (const [name, r] of Object.entries(rects)) {
    const x0 = clampInt(r[0] * W, 0, W - 1);
    const x1 = clampInt(r[2] * W, x0 + 1, W);
    // GL reads bottom-up while the rects are written top-down, which is the
    // one conversion in here worth getting wrong quietly.
    const yTop = clampInt(r[1] * H, 0, H - 1);
    const yBottom = clampInt(r[3] * H, yTop + 1, H);
    const glY0 = H - yBottom;
    const w = x1 - x0;
    const h = yBottom - yTop;

    const lum = new Float32Array(w * h);
    let sum = 0;
    let bright = 0;
    for (let y = 0; y < h; y++) {
      const row = (glY0 + y) * W;
      for (let x = 0; x < w; x++) {
        const i = (row + x0 + x) * 4;
        const l = 0.2126 * buffer[i] + 0.7152 * buffer[i + 1] + 0.0722 * buffer[i + 2];
        lum[y * w + x] = l;
        sum += l;
        if (l > 200) bright += 1;
      }
    }

    let edge = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1]
          + lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
        const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1]
          + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
        edge += Math.hypot(gx, gy);
        n += 1;
      }
    }

    out[name] = {
      mean: sum / (w * h),
      brightFraction: bright / (w * h),
      edges: n ? edge / n : 0,
    };
  }

  return out;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
