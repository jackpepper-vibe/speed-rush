/* Score the game's look against an art-direction reference.
 *
 *   node tools/compare.mjs [--quality high] [--seed 4242] [--tag 001]
 *                          [--reference reference/target2.jpg]
 *
 * Drives the game to a fixed hero pose — chase camera, player centred, road to
 * the horizon, traffic ahead, daylight — captures it at 1600x900, and prints a
 * numeric scorecard. When the reference image is present it also writes a
 * side-by-side and scores the capture against it.
 *
 * The pose is fixed on purpose. Two captures taken from different distances
 * down the road differ in ways that have nothing to do with the change being
 * evaluated, and comparing them tells you about the weather rather than about
 * the work.
 *
 * All image analysis happens inside the page. Node has no image decoder without
 * a dependency, and the browser already has one that is better than anything
 * worth vendoring — so the reference is handed in as a data URL and both images
 * are measured on the same canvases by the same code.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referencePath, referenceExists, toDataUrl } from './reference.mjs';

const require = createRequire('C:/Claude/Tools/shot/');
const { chromium } = require('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const REFERENCE = referencePath(argv);
const opt = {
  quality: 'high',
  seed: 4242,
  tag: null,
  port: 5180,
  width: 1600,
  height: 900,
  /** Distance to drive to. Lands inside the 'day' quarter of the cycle. */
  distance: 3000,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--quality') opt.quality = argv[++i];
  else if (a === '--seed') opt.seed = Number(argv[++i]);
  else if (a === '--tag') opt.tag = argv[++i];
  else if (a === '--distance') opt.distance = Number(argv[++i]);
  else if (a === '--reference') i++; // consumed by reference.mjs
  else { console.error('unknown option:', a); process.exit(2); }
}

const url = `http://localhost:${opt.port}/?quality=${opt.quality}`;

/* -------------------------------------------------------------- dev server */

let server = null;

async function reachable() {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable()) return false;
  const bin = resolve(ROOT, 'node_modules/vite/bin/vite.js');
  server = spawn(process.execPath, [bin, '--host', '127.0.0.1', '--port', String(opt.port), '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    if (await reachable()) return true;
  }
  throw new Error(`dev server did not come up at ${url}`);
}

function stopServer() {
  if (!server) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/t', '/f']);
    else server.kill('SIGTERM');
  } catch { /* already gone */ }
}

await ensureServer();

/* ------------------------------------------------------------------ capture */

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: opt.width, height: opt.height } });

const noise = [];
page.on('pageerror', (e) => noise.push(String(e).slice(0, 200)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.carRacer !== undefined', null, { timeout: 120000 });
await page.waitForFunction('window.carRacer.state().contextLost === false', null, { timeout: 60000 })
  .catch(() => noise.push('WebGL context did not recover from the headless boot loss'));

/**
 * Drive to the hero pose.
 *
 * Distance decides the time of day and the biome, so driving to a fixed one is
 * what makes two runs comparable. The car is then centred and given a moment to
 * settle so the chase camera is not mid-swing when the shutter opens.
 */
const pose = await page.evaluate(async ({ seed, distance }) => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  cr.setPickupSpawning(true);
  cr.setTrafficSpawning(true);
  cr.clearPowerups();
  cr.startRun(seed);

  let guard = 0;
  while (cr.state().distance < distance && guard++ < 400) cr.drive(1, 0);

  // Pinned after the drive, not before: getting to the pose passes through the
  // weather schedule, and a capture taken in whatever storm the seed happened
  // to produce cannot be compared with the last one.
  cr.pinWorld({ biome: 'coast', weather: 'clear', phase: 'day' });
  cr.drive(1, 0);
  cr.place({ x: 0, vx: 0 });
  cr.drive(1.5, 0);
  // Nitro up: the reference is a car under full power, and the effects that
  // sell that are the ones being evaluated.
  cr.givePowerup('nitro');
  cr.drive(0.6, 0);

  const s = cr.state();
  return {
    distance: s.distance, speedKmh: s.speedKmh, biome: s.biome,
    phase: s.dayPhase, weather: s.weather, quality: s.quality,
    triangles: s.triangles, drawCalls: s.drawCalls, contextLost: s.contextLost,
  };
}, { seed: opt.seed, distance: opt.distance });

const capture = await page.evaluate(() => window.carRacer.snapshot());

/* ------------------------------------------------------------------ scoring */

const referenceDataUrl = referenceExists(REFERENCE) ? toDataUrl(REFERENCE) : null;

/**
 * Measure both images the same way.
 *
 * Everything is computed on a common 480-wide canvas so the two resolutions do
 * not decide the answer: an edge-density score that rises simply because one
 * image has more pixels measures the screenshot, not the art.
 */
const scores = await page.evaluate(async ({ shot, reference }) => {
  const W = 480;
  const H = 270;

  const load = (src) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('decode failed'));
    img.src = src;
  });

  const luminanceOf = (img) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const lum = new Float32Array(W * H);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      lum[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    }
    return lum;
  };

  /** Sobel magnitude, averaged over a horizontal slice of the frame. */
  const edgeDensity = (lum, x0, x1, y0, y1) => {
    let total = 0;
    let n = 0;
    // Floored: fractional bounds give fractional indices, and lum[121.5] is
    // undefined, which propagates to a NaN score that looks like a broken
    // renderer rather than a broken loop.
    const yStart = Math.max(1, Math.floor(y0));
    const yEnd = Math.min(H - 1, Math.floor(y1));
    const xStart = Math.max(1, Math.floor(x0));
    const xEnd = Math.min(W - 1, Math.floor(x1));
    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x < xEnd; x++) {
        const i = y * W + x;
        const gx =
          -lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1] +
          lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1];
        const gy =
          -lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1] +
          lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1];
        total += Math.hypot(gx, gy);
        n += 1;
      }
    }
    return n ? total / n : 0;
  };

  const histogram = (lum) => {
    const bins = new Array(32).fill(0);
    for (const v of lum) bins[Math.min(31, Math.max(0, Math.floor(v / 8)))] += 1;
    return bins.map((b) => b / lum.length);
  };

  const stats = (lum) => {
    let sum = 0;
    for (const v of lum) sum += v;
    const mean = sum / lum.length;
    let variance = 0;
    for (const v of lum) variance += (v - mean) ** 2;
    const sorted = Float32Array.from(lum).sort();
    return {
      mean,
      std: Math.sqrt(variance / lum.length),
      p05: sorted[Math.floor(sorted.length * 0.05)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      // Pixels bright enough to read as a specular hit or a light source.
      bright: lum.reduce((n, v) => n + (v > 220 ? 1 : 0), 0) / lum.length,
      dark: lum.reduce((n, v) => n + (v < 24 ? 1 : 0), 0) / lum.length,
    };
  };

  const profile = (img) => {
    const lum = luminanceOf(img);
    return {
      ...stats(lum),
      edgesAll: edgeDensity(lum, 0, W, 0, H),
      // The roadside: the outer thirds of the upper half, where scenery lives.
      edgesVerge: (edgeDensity(lum, 0, W / 3, 0, H * 0.6) +
        edgeDensity(lum, (W * 2) / 3, W, 0, H * 0.6)) / 2,
      // The hero: the middle of the lower half, where the car sits.
      edgesHero: edgeDensity(lum, W * 0.3, W * 0.7, H * 0.45, H),
      histogram: histogram(lum),
    };
  };

  const mine = profile(await load(shot));
  if (!reference) return { mine, reference: null, distance: null };

  const theirs = profile(await load(reference));
  // L1 over the normalised histograms: 0 identical, 2 disjoint.
  const histDistance = mine.histogram.reduce((n, v, i) => n + Math.abs(v - theirs.histogram[i]), 0);

  return {
    mine, reference: theirs,
    distance: {
      histogram: histDistance,
      vergeRatio: mine.edgesVerge / (theirs.edgesVerge || 1),
      heroRatio: mine.edgesHero / (theirs.edgesHero || 1),
      contrastRatio: mine.std / (theirs.std || 1),
      brightRatio: mine.bright / (theirs.bright || 1e-6),
    },
  };
}, { shot: capture, reference: referenceDataUrl });

/* Side-by-side, for a human. */
let sideBySide = null;
if (referenceDataUrl) {
  sideBySide = await page.evaluate(async ({ shot, reference }) => {
    const load = (src) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = src;
    });
    const a = await load(shot);
    const b = await load(reference);
    const h = 540;
    const aw = Math.round((a.width / a.height) * h);
    const bw = Math.round((b.width / b.height) * h);
    const c = document.createElement('canvas');
    c.width = aw + bw + 12;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(a, 0, 0, aw, h);
    ctx.drawImage(b, aw + 12, 0, bw, h);
    return c.toDataURL('image/png');
  }, { shot: capture, reference: referenceDataUrl });
}

await browser.close();
stopServer();

/* ------------------------------------------------------------------- output */

const tag = opt.tag ?? new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const outDir = resolve(ROOT, 'shots/compare');
mkdirSync(outDir, { recursive: true });

writeFileSync(resolve(outDir, `${tag}.png`), Buffer.from(capture.split(',')[1], 'base64'));
if (sideBySide) {
  writeFileSync(resolve(outDir, `${tag}-vs-reference.png`), Buffer.from(sideBySide.split(',')[1], 'base64'));
}

const n = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : String(v));
const m = scores.mine;

console.log(`\nhero pose   ${n(pose.distance, 0)}u · ${n(pose.speedKmh, 0)} km/h · ${pose.biome} · ${pose.phase} · ${pose.weather}`);
console.log(`render      ${pose.quality} tier · ${pose.triangles} tris · ${pose.drawCalls} draws · context lost: ${pose.contextLost}`);
console.log('\nscorecard');
console.log(`  luminance mean/std     ${n(m.mean)} / ${n(m.std)}`);
console.log(`  p05 / p95              ${n(m.p05)} / ${n(m.p95)}`);
console.log(`  bright pixels          ${n(m.bright * 100)}%   (specular and light sources)`);
console.log(`  dark pixels            ${n(m.dark * 100)}%   (shadow and occlusion)`);
console.log(`  edge density all       ${n(m.edgesAll)}`);
console.log(`  edge density verge     ${n(m.edgesVerge)}   (roadside detail)`);
console.log(`  edge density hero      ${n(m.edgesHero)}   (the car itself)`);

if (scores.distance) {
  const d = scores.distance;
  const r = scores.reference;
  console.log(`\nagainst reference      ${relative(ROOT, REFERENCE)}`);
  console.log(`  reference mean/std     ${n(r.mean)} / ${n(r.std)}`);
  console.log(`  histogram distance     ${n(d.histogram, 3)}   (0 identical, 2 disjoint)`);
  console.log(`  verge edge ratio       ${n(d.vergeRatio)}   (1.0 = matched)`);
  console.log(`  hero edge ratio        ${n(d.heroRatio)}`);
  console.log(`  contrast ratio         ${n(d.contrastRatio)}`);
  console.log(`  bright-pixel ratio     ${n(d.brightRatio)}`);
} else {
  console.log('\nagainst reference');
  console.log(`  no reference — nothing at ${relative(ROOT, REFERENCE)}`);
  console.log('  (comparative scores are withheld, not passed)');
}

if (noise.length) {
  console.log('\npage errors');
  for (const e of noise) console.log(`  ${e}`);
}

console.log(`\nwrote ${resolve(outDir, `${tag}.png`)}`);
if (sideBySide) console.log(`wrote ${resolve(outDir, `${tag}-vs-reference.png`)}`);

writeFileSync(resolve(outDir, `${tag}.json`), JSON.stringify({ pose, scores, noise }, null, 2));
