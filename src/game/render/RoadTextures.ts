import * as THREE from 'three';
import { Random } from '@/core/Random';

/**
 * Canvas-authored road textures.
 *
 * Drawn at runtime rather than shipped as PNGs so the whole game stays a single
 * deployable with no asset pipeline, and so lane count changes in `Balance.ts`
 * regenerate correct markings instead of silently disagreeing with a baked
 * image.
 *
 * They are still *assets*, though, and that is what the seeding below is about.
 * A shipped PNG is the same bytes on every run; these were drawing their grain
 * from `Math.random`, so every page load produced a slightly different road.
 * Nobody could see it — but the comparison harness could, and it put a spread
 * of 0.035 on a histogram score that changes of 0.02 were being read from.
 * Once the sun came down to a grazing angle the roughness map stopped being a
 * subtlety and became most of what the carriageway does with the light, and
 * the noise floor went with it.
 *
 * Each maker gets its own fixed stream. Not the world seed: two runs of the
 * same road at different seeds should differ in their traffic and their
 * scenery, and not in the aggregate of their asphalt. Deliberately not drawn
 * from `ctx.rng` either — pulling from the shared stream at texture-build time
 * would shift every draw made after it, so a change to the grain would silently
 * relay out the traffic.
 */

/**
 * One stream per texture, so adding a `next()` to one maker cannot shift the
 * grain of another. The values are arbitrary and only have to stay put.
 */
const TEXTURE_SEED = {
  road: 0x5ea51de,
  wear: 0x1a3f00d,
  ground: 0x2c0a5720,
  building: 0x77c17e5,
} as const;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable — cannot author road textures');
  return [c, ctx];
}

/**
 * The ground either side of the road: dirt, grit and dry patches.
 *
 * Greyscale, and multiplied by whatever colour the biome sets, so one texture
 * serves sand, scrub and city dirt without three variants. What it is really
 * for is scale: a four-hundred-unit plane of flat colour has nothing on it for
 * the eye to measure speed against, so the verge sat still while the road
 * rushed past — the props standing on it were the only thing that moved.
 */
export function makeGroundTexture(): THREE.Texture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rng = new Random(TEXTURE_SEED.ground);

  ctx.fillStyle = '#b0b0b0';
  ctx.fillRect(0, 0, S, S);

  // Broad tonal drift, so the plane is not uniform at any scale.
  for (let i = 0; i < 26; i++) {
    const r = rng.range(18, 80);
    const g = ctx.createRadialGradient(
      rng.next() * S, rng.next() * S, 0,
      rng.next() * S, rng.next() * S, r,
    );
    const shade = rng.chance(0.5) ? 150 : 210;
    g.addColorStop(0, `rgba(${shade},${shade},${shade},0.22)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

  // Grit.
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * 40;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(38, 5);
  tex.anisotropy = 8;
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
 * A billowing puff for smoke and dust.
 *
 * A cluster of lumps around a dense core, the way a puff of tyre smoke is
 * built, with the red channel carrying each lump's own light: brighter where
 * it bulges towards the viewer, darker in the folds between. A single soft
 * gradient reads as fog at any size; a clustered edge and some internal
 * shading is what makes a sprite read as a puff.
 */
export function makeSmokeTexture(): THREE.Texture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  let seed = 17;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const blob = (cx: number, cy: number, r: number, a: number, light: number): void => {
    const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.25, r * 0.05, cx, cy, r);
    const v = Math.round(255 * light);
    g.addColorStop(0, `rgba(${v},255,255,${a})`);
    g.addColorStop(0.6, `rgba(${Math.round(v * 0.85)},255,255,${a * 0.8})`);
    g.addColorStop(1, `rgba(${Math.round(v * 0.7)},255,255,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  // Everything stays well inside the sprite: a lump cut by the quad edge
  // draws a hard line across the smoke.
  blob(128, 132, 78, 0.5, 0.8);
  for (let k = 0; k < 14; k++) {
    const a = rnd() * Math.PI * 2;
    const d = 22 + rnd() * 30;
    blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d * 0.85, 20 + rnd() * 22, 0.42, 0.75 + rnd() * 0.25);
  }
  const tex = new THREE.CanvasTexture(c);
  // Data in red (light) and alpha (density); the colour comes from the emitter.
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
