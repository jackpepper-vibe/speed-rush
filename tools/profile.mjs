/* The image profiler, shared by compare.mjs and probe.mjs.
 *
 * Both tools score the hero capture against an art-direction reference, and
 * both used to carry their own copy of this code. The copies had drifted: one
 * averaged two roadside blocks, the other made a single pass skipping the
 * middle third, so the two tools disagreed about what "roadside density" meant
 * while the probe's thresholds were tuned against only one of them. One
 * profiler, imported by both, is the only way that stays honest.
 *
 * `profilePair` is evaluated inside the page. All image analysis has to happen
 * there — Node has no image decoder without a dependency, and the browser has
 * a better one than anything worth vendoring. It is therefore written to be
 * serialisable: no imports, no closure over module scope.
 *
 * THREE THINGS THIS FIXES, all of which made the old comparative scores
 * measure the screenshots rather than the art:
 *
 * 1. Anisotropic squash. Both images used to be forced onto a fixed 480x270
 *    canvas whatever their native aspect. A 620x400 reference squashed to
 *    1.78:1 has its vertical gradients compressed and amplified, so its edge
 *    density rose for no reason connected to the art. Each image now keeps its
 *    own aspect at a common width, so pixels stay square in both.
 *
 * 2. Mismatched low-pass. A 1600-wide capture resampled to 480 loses far more
 *    high-frequency detail than a 620-wide reference resampled to 480. The
 *    capture was being penalised for being rendered larger. Callers now render
 *    the analysis frame at ANALYSIS_WIDTH so neither image is downsampled on
 *    the way in; when a caller cannot, `resampleRatio` in the result records
 *    what it had to do, so a score is never read as clean when it isn't.
 *
 * 3. JPEG blocking. A compressed reference carries 8x8 ringing that is edge
 *    energy the art does not contain. A matched 3x3 box pre-filter runs over
 *    both images: it cannot remove artifacts from one without also softening
 *    the other, which is the point — the filter has to be symmetric or it
 *    becomes a thumb on the scale.
 *
 * Regions are normalised fractions of each image's own frame, not pixels.
 * Framing differs between two games and is not something the art can fix.
 */

/**
 * Width every image is analysed at, and the width callers should render their
 * analysis frame at. Chosen to sit at or below the native width of a typical
 * reference screenshot so the reference is never upsampled.
 */
export const ANALYSIS_WIDTH = 620;

/** Normalised sample regions, applied to each image's own frame. */
export const REGIONS = {
  /** The roadside: the outer thirds, upper 60%, where scenery lives. */
  verge: { x0: 0, x1: 1, y0: 0, y1: 0.6, skipMiddleThird: true },
  /** The hero: the middle of the lower half, where the car sits. */
  hero: { x0: 0.3, x1: 0.7, y0: 0.45, y1: 1, skipMiddleThird: false },
};

/**
 * Profile two images and score one against the other.
 *
 * Runs inside the page. Pass it straight to `page.evaluate`.
 *
 * @param {{shot: string, reference: string|null, width: number, regions: object}} args
 * @returns {Promise<{mine: object, reference: object|null, distance: object|null}>}
 */
export async function profilePair({ shot, reference, width, regions }) {
  const load = (src) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('decode failed'));
    img.src = src;
  });

  /**
   * Luminance at a common width, each image keeping its own aspect so pixels
   * stay square. Records the resample ratio it had to apply: 1 means the image
   * arrived at analysis width and was not filtered on the way in.
   */
  const luminanceOf = (img) => {
    const w = width;
    const h = Math.max(2, Math.round(width / (img.width / img.height)));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const raw = new Float32Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      raw[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    }
    return { raw, w, h, resampleRatio: img.width / w, native: [img.width, img.height] };
  };

  /**
   * Matched 3x3 box pre-filter. Damps JPEG block ringing in a compressed
   * reference; softens the capture by exactly as much, which is what keeps it
   * a measurement rather than an adjustment. Edges are clamped, so the border
   * is not a ring of half-weighted pixels pretending to be detail.
   */
  const smooth = ({ raw, w, h }) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            sum += raw[yy * w + xx];
          }
        }
        out[y * w + x] = sum / 9;
      }
    }
    return out;
  };

  /** Sobel magnitude over a normalised region of the frame. */
  const edgeDensity = (lum, w, h, region) => {
    const xStart = Math.max(1, Math.floor(region.x0 * w));
    const xEnd = Math.min(w - 1, Math.ceil(region.x1 * w));
    const yStart = Math.max(1, Math.floor(region.y0 * h));
    const yEnd = Math.min(h - 1, Math.ceil(region.y1 * h));
    const inner0 = w / 3;
    const inner1 = (w * 2) / 3;
    let total = 0;
    let n = 0;
    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x < xEnd; x++) {
        if (region.skipMiddleThird && x > inner0 && x < inner1) continue;
        const i = y * w + x;
        const gx =
          -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] +
          lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
        const gy =
          -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] +
          lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
        total += Math.hypot(gx, gy);
        n += 1;
      }
    }
    return n ? total / n : 0;
  };

  const profile = async (src) => {
    const meta = luminanceOf(await load(src));
    const lum = smooth(meta);
    const { w, h } = meta;

    let sum = 0;
    for (const v of lum) sum += v;
    const mean = sum / lum.length;
    let variance = 0;
    for (const v of lum) variance += (v - mean) ** 2;
    const sorted = Float32Array.from(lum).sort();
    const bins = new Array(32).fill(0);
    for (const v of lum) bins[Math.min(31, Math.max(0, Math.floor(v / 8)))] += 1;

    return {
      native: meta.native,
      analysed: [w, h],
      resampleRatio: meta.resampleRatio,
      mean,
      std: Math.sqrt(variance / lum.length),
      p05: sorted[Math.floor(sorted.length * 0.05)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      bright: lum.reduce((n, v) => n + (v > 220 ? 1 : 0), 0) / lum.length,
      dark: lum.reduce((n, v) => n + (v < 24 ? 1 : 0), 0) / lum.length,
      edgesAll: edgeDensity(lum, w, h, { x0: 0, x1: 1, y0: 0, y1: 1, skipMiddleThird: false }),
      edgesVerge: edgeDensity(lum, w, h, regions.verge),
      edgesHero: edgeDensity(lum, w, h, regions.hero),
      histogram: bins.map((b) => b / lum.length),
    };
  };

  const mine = await profile(shot);
  if (!reference) return { mine, reference: null, distance: null };

  const theirs = await profile(reference);
  return {
    mine,
    reference: theirs,
    distance: {
      /** L1 over normalised histograms: 0 identical, 2 disjoint. */
      histogram: mine.histogram.reduce((n, v, i) => n + Math.abs(v - theirs.histogram[i]), 0),
      vergeRatio: mine.edgesVerge / (theirs.edgesVerge || 1),
      heroRatio: mine.edgesHero / (theirs.edgesHero || 1),
      contrastRatio: mine.std / (theirs.std || 1),
      brightRatio: mine.bright / (theirs.bright || 1e-6),
      /** Both 1 means neither image was filtered on the way in. */
      resample: { mine: mine.resampleRatio, reference: theirs.resampleRatio },
    },
  };
}
