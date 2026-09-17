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
 * are measured by `tools/profile.mjs`, the one profiler the probe also uses.
 *
 * The comparative scores are taken from a second capture rendered at the
 * profiler's analysis width, not from the 1600-wide hero shot. See the note by
 * that capture: scoring a large render against a small reference measures the
 * screenshot sizes, and the fix is to stop downsampling one of them.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referencePath, referenceExists, toDataUrl } from './reference.mjs';
import { profilePair, ANALYSIS_WIDTH, REGIONS } from './profile.mjs';

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
 * A second capture at analysis width, taken for the comparative scores only.
 *
 * The hero capture above is 1600 wide because that is what a human should look
 * at. Scoring it meant resampling it down to the analysis canvas, which is a
 * low-pass the reference — already small — barely feels, so the capture was
 * losing fine detail the reference kept and the roadside ratio was reading the
 * screenshot sizes rather than the art. Rendering the analysis frame natively
 * at the same width removes the asymmetry instead of trying to correct for it.
 *
 * The aspect is held at the hero capture's, not the reference's: framing is not
 * something the art can answer for, and cropping the capture's sides would
 * throw away the verge, which is the thing being measured.
 */
const analysisHeight = Math.round(ANALYSIS_WIDTH / (opt.width / opt.height));
await page.setViewportSize({ width: ANALYSIS_WIDTH, height: analysisHeight });
// The renderer resizes off a window event, so the next frame is the first one
// drawn at the new size. Drive a beat rather than snapshotting into a resize.
await page.evaluate(() => window.carRacer.drive(0.05, 0));
const analysisCapture = await page.evaluate(() => window.carRacer.snapshot());
await page.setViewportSize({ width: opt.width, height: opt.height });

const scores = await page.evaluate(profilePair, {
  shot: analysisCapture,
  reference: referenceDataUrl,
  width: ANALYSIS_WIDTH,
  regions: REGIONS,
});

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
// The frame the comparative scores were actually taken from. Written out
// because a score nobody can look at is a number to be taken on trust.
writeFileSync(resolve(outDir, `${tag}-analysis.png`), Buffer.from(analysisCapture.split(',')[1], 'base64'));
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
  // Stated, not assumed: a ratio that is not 1.00 means that image was filtered
  // on the way into the analysis, and the edge scores are softer than the art.
  console.log(`  analysed at            ${m.analysed.join('x')} vs ${r.analysed.join('x')} ` +
    `· resample ${n(d.resample.mine)}x / ${n(d.resample.reference)}x`);
  console.log(`  reference native       ${r.native.join('x')}`);
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
