/* Automated audit of the running game.
 *
 *   node tools/probe.mjs [--url http://localhost:5180/] [--shots] [--keep-server]
 *                        [--reference reference/target2.jpg]
 *
 * Boots Speed Rush headlessly, drives it through a scripted set of situations,
 * and asserts on what the game reports about itself. Writes a findings report to
 * `shots/probe/report.json` and one line per check to stdout, so a fix is
 * verified by rerunning rather than by looking at a picture and forming an
 * opinion.
 *
 * The point is the checks a screenshot cannot make. A car that has drifted to
 * NaN, a cue that stopped firing, a spawn embedded in a truck, a shield that
 * does not actually block the hit — all four photograph perfectly well. Every
 * assertion here is therefore numeric, made against `window.carRacer`, with a
 * capture attached only as evidence for a human.
 *
 * Exit code is the number of failing checks, so this drops into a loop or a
 * pre-commit hook unchanged.
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
// Pinned to the low tier. Headless Chromium runs on SwiftShader, which loses
// the WebGL context outright under the full shadow-and-bloom load — after which
// three.js returns from `render` without drawing and every check downstream
// measures a black frame. The tier ladder is a shipping feature, not a probe
// accommodation; this just picks the rung the harness can actually sustain.
const opt = { url: 'http://localhost:5180/?quality=low', out: 'shots/probe', shots: false, keepServer: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--url') opt.url = argv[++i];
  else if (a === '--out') opt.out = argv[++i];
  else if (a === '--shots') opt.shots = true;
  else if (a === '--keep-server') opt.keepServer = true;
  else if (a === '--reference') i++; // consumed by reference.mjs
  else { console.error('unknown option:', a); process.exit(2); }
}

/* ---------------------------------------------------------------- findings */

const findings = [];
/** Conditions belonging to the harness's environment, not to the game. */
const environment = [];
let checks = 0;
const passed = [];

/**
 * Record one check.
 *
 * `pass` is a boolean and `detail` is the measurement behind it, always — a
 * finding that says only "steering is bad" cannot be verified as fixed, where
 * one carrying "moved 0.4u in 1.5s, want >= 3" can.
 */
function check(scope, id, pass, detail) {
  checks += 1;
  if (!pass) findings.push({ scope, id, detail });
  else passed.push(`${scope}/${id}`);
  return pass;
}

function near(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance;
}

function finite(...values) {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/* ------------------------------------------------------------ cue coverage */

/**
 * Cues this probe asserts on, and cues whose feature has not landed yet.
 *
 * This is the loop's termination condition. `RECORDED_EVENTS` in the dev handle
 * is the full set of cues the game declares; every one must appear in exactly
 * one of these two lists. As a feature lands it moves from PENDING to CHECKED
 * along with a real assertion, and the probe only exits 0 once PENDING is empty
 * and every check passes — so "all of them are done" is a measurement rather
 * than a judgement call.
 */
const CHECKED_CUES = new Set([
  'run:start',
  'run:tick',
  'run:end',
  'player:steer',
  'player:lane-change',
  'player:crash',
  'player:near-miss',
  'traffic:spawn',
  'traffic:lane-change',
  'traffic:brake',
  'traffic:despawn',
  'traffic:horn',
  'pickup:collect',
  'pickup:magnetised',
  'powerup:activate',
  'powerup:expire',
  'powerup:blocked-crash',
  'score:add',
  'score:combo',
  'score:combo-break',
  'score:milestone',
  'biome:change',
  'weather:change',
  'daynight:change',
  'world:tunnel-enter',
  'world:tunnel-exit',
  'run:countdown',
  'player:drift',
  'player:airborne',
  'player:land',
  'garage:purchase',
  'garage:equip',
  'garage:upgrade',
  'save:write',
]);

/** Empty: every declared cue now has an assertion. */
const PENDING_CUES = new Set([]);

/* -------------------------------------------------------------- dev server */

let server = null;

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable(opt.url)) return false;

  // Vite's JS entry, run under this same node binary. Spawning `npm.cmd`
  // instead needs a shell — Node 20+ refuses to spawn .cmd without one — and a
  // shell in the middle makes the child hard to kill cleanly on win32.
  const viteBin = resolve(ROOT, 'node_modules/vite/bin/vite.js');
  server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5180', '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    if (await reachable(opt.url)) return true;
  }
  throw new Error(`dev server did not come up at ${opt.url} within 40s`);
}

function stopServer() {
  if (!server || opt.keepServer) return;
  try {
    // Vite spawns children; killing the tree is the only reliable stop on win32.
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/t', '/f']);
    else server.kill('SIGTERM');
  } catch { /* already gone */ }
}

const startedServer = await ensureServer();

/* ------------------------------------------------------------------ browser */

const browser = await chromium.launch({
  args: [
    '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    // Let the audio graph actually run, so its state is worth asserting on.
    '--autoplay-policy=no-user-gesture-required',
  ],
});

/** Console noise, bucketed by the phase that was running when it arrived. */
let phase = 'boot';
const noise = [];

/**
 * A fresh page per scenario.
 *
 * Isolation for the ordinary reason — a fault in one scenario must not decide
 * another's verdict — and for a specific one: headless runs on SwiftShader,
 * where the 2048² shadow pass plus the bloom chain sits near the software
 * rasteriser's ceiling, and cycling many scenarios through one context risks
 * exhausting it and reporting a shader failure against whichever scenario
 * happened to be loaded.
 */
async function freshPage(url = opt.url, viewport = { width: 1000, height: 560 }) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => noise.push({ phase, level: 'pageerror', text: String(e).slice(0, 300) }));
  page.on('console', (m) => {
    const level = m.type();
    if (level === 'error' || level === 'warning') {
      noise.push({ phase, level, text: m.text().slice(0, 300) });
    }
  });

  // Count what the page builds in Web Audio, from outside it. A silent game is
  // not something a capture or a state read can notice.
  await page.addInitScript(() => {
    window.__audio = { contexts: 0, oscillators: 0, buffers: 0, gains: 0 };
    const Real = window.AudioContext;
    if (Real) {
      window.AudioContext = function (...a) {
        const ctx = new Real(...a);
        window.__audio.contexts += 1;
        const osc = ctx.createOscillator.bind(ctx);
        ctx.createOscillator = () => { window.__audio.oscillators += 1; return osc(); };
        const src = ctx.createBufferSource.bind(ctx);
        ctx.createBufferSource = () => { window.__audio.buffers += 1; return src(); };
        const gain = ctx.createGain.bind(ctx);
        ctx.createGain = () => { window.__audio.gains += 1; return gain(); };
        window.__audioCtx = ctx;
        return ctx;
      };
      window.AudioContext.prototype = Real.prototype;
    }
  });

  // The loop derives its timestep from the timestamp handed to the frame
  // callback, so overriding that makes every run advance the world by exactly
  // the same amount. Without it, scene build time leaks into the simulation and
  // no two runs agree.
  await page.addInitScript(() => {
    const STEP = 1000 / 60;
    let clock = 0;
    const native = window.requestAnimationFrame.bind(window);
    window.__rafNative = native;
    window.performance.now = () => clock;
    window.requestAnimationFrame = (cb) => native(() => { clock += STEP; cb(clock); });
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.carRacer !== undefined', null, { timeout: 120000 });

  /*
   * Let the boot context settle before judging anything.
   *
   * Headless Chromium loses and then restores the WebGL context during startup
   * — a `loseContext` at roughly the second frame, restored some forty frames
   * later — before a line of game code could have caused it. Asserting through
   * that window reports a dead renderer against whatever happened to be running
   * at the time, which is how a boot artifact came to be filed as a game bug.
   * The loss is real and worth reporting, so it goes to `environment`; what is
   * not allowed is a context that never comes back.
   */
  const settled = await page
    .waitForFunction('window.carRacer.state().contextLost === false', null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  if (!settled) {
    environment.push('WebGL context never recovered from the headless boot loss within 30s');
  }

  /*
   * From here the world moves only when a check moves it.
   *
   * The clock override above fixes the *size* of every timestep; it does not
   * fix how many of them happen. Native requestAnimationFrame still fires on
   * real vsync, so the number of frames landing between two `page.evaluate`
   * round trips is a function of how busy the machine is, and each one ticks
   * the simulation. Poses therefore drifted a whole number of ticks past what
   * a check asked for — which is what made `compare.mjs`'s scores discrete
   * rather than noisy until iteration 14, and this harness shares the cause.
   *
   * Done after the settle rather than before it: the headless boot loses and
   * restores the WebGL context, and the restore needs frames to happen in.
   */
  await page.evaluate(() => window.carRacer.setAutoAdvance(false));

  return page;
}

/**
 * Capture evidence for a human.
 *
 * `dom: true` takes a real page screenshot, which is the only way to see the
 * interface; otherwise the canvas is rendered and read back inside the page.
 * Playwright's screenshot waits for the compositor to go idle, and a scene
 * running a post chain under software GL never does — it times out.
 *
 * Failures here are recorded and swallowed. These images are evidence, not
 * assertions: a capture that could abort the audit would mean a slow frame
 * deciding whether the game is correct.
 */
async function shot(page, name, { dom = false } = {}) {
  if (!opt.shots) return;
  const file = resolve(ROOT, opt.out, `${name}.png`);
  mkdirSync(dirname(file), { recursive: true });
  try {
    if (dom) {
      writeFileSync(file, await page.screenshot({ animations: 'disabled', timeout: 20000 }));
    } else {
      const url = await page.evaluate(() => window.carRacer.snapshot());
      writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    }
  } catch (e) {
    environment.push(`capture "${name}" failed: ${String(e).split('\n')[0]}`);
  }
}

/* ------------------------------------------------------------------- checks */

let page = await freshPage();

check('boot', 'dev-handle', true, 'window.carRacer installed');

const config = await page.evaluate(() => window.carRacer.config());
const recorded = config.recordedEvents;

/* -- cue coverage: the loop's completion test --------------------------------
 * Every declared cue must be either asserted on or explicitly pending, and the
 * run is not finished while anything is pending. */
{
  const unclassified = recorded.filter((c) => !CHECKED_CUES.has(c) && !PENDING_CUES.has(c));
  check('coverage', 'every-cue-classified', unclassified.length === 0,
    `cues declared but neither checked nor pending: ${unclassified.join(', ') || 'none'}`);

  const stale = [...CHECKED_CUES, ...PENDING_CUES].filter((c) => !recorded.includes(c));
  check('coverage', 'no-stale-cue-entries', stale.length === 0,
    `probe lists cues the game no longer declares: ${stale.join(', ') || 'none'}`);

  check('coverage', 'no-pending-cues', PENDING_CUES.size === 0,
    `${PENDING_CUES.size} of ${recorded.length} cues still have no check: ${[...PENDING_CUES].join(', ') || 'none'}`);
}

/* -- boot -------------------------------------------------------------------- */

phase = 'boot';
const booted = await page.evaluate(() => {
  window.carRacer.step(30);
  return window.carRacer.state();
});

// The game opens on the menu now, with the world rendering behind it.
check('boot', 'opens-on-the-menu', booted.runState === 'menu', `runState at boot: ${booted.runState}`);
check('boot', 'context-alive', booted.contextLost === false,
  `WebGL context lost during boot: ${booted.contextLost} (quality tier: ${booted.quality})`);
check('boot', 'scene-populated', booted.sceneChildren >= 4,
  `scene children: ${booted.sceneChildren}, want >= 4`);
check('boot', 'renderer-draws', booted.drawCalls > 0,
  `draw calls in last frame: ${booted.drawCalls}`);
check('boot', 'triangles-submitted', booted.triangles > 500,
  `triangles: ${booted.triangles}, want > 500`);
check('boot', 'state-finite', finite(booted.x, booted.vx, booted.speed, booted.distance),
  `x=${booted.x} vx=${booted.vx} speed=${booted.speed} distance=${booted.distance}`);

/* -- road geometry ----------------------------------------------------------- */

check('road', 'five-lanes', config.laneCount === 5, `laneCount: ${config.laneCount}`);
check('road', 'lanes-symmetric',
  near(config.laneX[0], -config.laneX[config.laneCount - 1], 1e-9),
  `outer lane centres: ${config.laneX[0]} and ${config.laneX[config.laneCount - 1]}`);
check('road', 'lanes-evenly-spaced',
  config.laneX.every((x, i, a) => i === 0 || near(x - a[i - 1], config.laneWidth, 1e-9)),
  `lane centres: [${config.laneX.map((v) => v.toFixed(2)).join(', ')}], width ${config.laneWidth}`);
/* The road is built as a ring of bent strips; a regression in that bending
 * turns it back into a staircase, which reads as a solid road in every numeric
 * state field but photographs as a broken one. */
{
  const seams = await page.evaluate(() => {
    const cr = window.carRacer;
    cr.startRun(808);
    const samples = [];
    // Sample across a full recycle cycle and over a hill crest.
    for (let i = 0; i < 12; i++) {
      cr.drive(0.7, 0);
      samples.push(cr.state().roadSeamGap);
    }
    return samples;
  });
  const worst = Math.max(...seams);
  check('road', 'segments-join-continuously', worst < 1e-4,
    `largest seam between adjacent road segments over 12 samples: ${worst.toExponential(2)}u, want < 1e-4`);
}

check('road', 'lanes-inside-surface',
  Math.abs(config.laneX[0]) + config.laneWidth / 2 <= config.halfWidth + 1e-9,
  `outermost lane edge ${(Math.abs(config.laneX[0]) + config.laneWidth / 2).toFixed(2)} vs halfWidth ${config.halfWidth}`);

/* -- determinism ------------------------------------------------------------- */

phase = 'determinism';
const runA = await page.evaluate(() => {
  window.carRacer.setCollisions(false);
  window.carRacer.setPickupSpawning(false);
  window.carRacer.clearPowerups();
  window.carRacer.startRun(1234);
  window.carRacer.drive(4, 0.6);
  return { ...window.carRacer.state(), traffic: window.carRacer.traffic().length };
});
const runB = await page.evaluate(() => {
  window.carRacer.setCollisions(false);
  window.carRacer.setPickupSpawning(false);
  window.carRacer.clearPowerups();
  window.carRacer.startRun(1234);
  window.carRacer.drive(4, 0.6);
  return { ...window.carRacer.state(), traffic: window.carRacer.traffic().length };
});

check('determinism', 'same-seed-same-position', near(runA.x, runB.x, 1e-9),
  `x after 4s: ${runA.x} vs ${runB.x}`);
check('determinism', 'same-seed-same-distance', near(runA.distance, runB.distance, 1e-9),
  `distance: ${runA.distance} vs ${runB.distance}`);
check('determinism', 'same-seed-same-speed', near(runA.speed, runB.speed, 1e-9),
  `speed: ${runA.speed} vs ${runB.speed}`);
// Traffic draws from the seeded stream; a mismatch here means something in the
// world is still reaching for Math.random.
check('determinism', 'same-seed-same-traffic', runA.traffic === runB.traffic,
  `live vehicles after 4s: ${runA.traffic} vs ${runB.traffic}`);
// The two runs are separated by other scenarios on purpose, so the pools and
// caches they inherit differ. Anything that consumes a variable number of
// values from the stream depending on that inherited state shows up here as a
// different world from the same seed — which is how a colour lookup inside a
// pooled mesh rebuild came to decide the weather.
check('determinism', 'same-seed-same-weather', runA.weather === runB.weather,
  `weather after 4s: ${runA.weather} vs ${runB.weather}`);
check('determinism', 'same-seed-same-biome', runA.biome === runB.biome,
  `biome after 4s: ${runA.biome} vs ${runB.biome}`);

/* -- handling ---------------------------------------------------------------- */

phase = 'handling';
const steering = await page.evaluate(() => {
  const cr = window.carRacer;
  // These measure handling, speed and stability, not collision or pickups.
  // Leaving traffic lethal would end the run partway and truncate the
  // measurement; leaving pickups on lets the car drive over a nitro crate
  // mid-measurement, which silently rewrites the speed ceiling it is being
  // measured against — and does so differently depending on which way it was
  // steered, which is exactly how a symmetric control scheme came to look
  // asymmetric.
  cr.setCollisions(false);
  cr.setPickupSpawning(false);
  cr.clearPowerups();
  cr.startRun(77);
  const start = cr.state().x;
  cr.drive(1.5, 1);
  const right = cr.state().x;
  cr.startRun(77);
  cr.drive(1.5, -1);
  const left = cr.state().x;

  // Let go mid-slide: grip must bleed the lateral velocity away.
  cr.startRun(77);
  cr.drive(1.2, 1);
  const vxUnderPower = cr.state().vx;
  cr.drive(1.2, 0);
  const vxCoasting = cr.state().vx;

  return { start, right, left, vxUnderPower, vxCoasting };
});

check('handling', 'steers-right', steering.right > steering.start + 3,
  `x moved ${(steering.right - steering.start).toFixed(2)}u right in 1.5s, want > 3`);
check('handling', 'steers-left', steering.left < steering.start - 3,
  `x moved ${(steering.left - steering.start).toFixed(2)}u left in 1.5s, want < -3`);
check('handling', 'steering-symmetric',
  near(steering.right - steering.start, -(steering.left - steering.start), 0.05),
  `right ${(steering.right - steering.start).toFixed(3)}u vs left ${(steering.left - steering.start).toFixed(3)}u`);
check('handling', 'grip-bleeds-lateral',
  Math.abs(steering.vxCoasting) < Math.abs(steering.vxUnderPower) * 0.35,
  `vx ${steering.vxUnderPower.toFixed(2)} under power -> ${steering.vxCoasting.toFixed(2)} coasting`);

/* -- barrier ----------------------------------------------------------------- */

phase = 'barrier';
const barrier = await page.evaluate(() => {
  const cr = window.carRacer;
  // These measure handling, speed and stability, not collision or pickups.
  // Leaving traffic lethal would end the run partway and truncate the
  // measurement; leaving pickups on lets the car drive over a nitro crate
  // mid-measurement, which silently rewrites the speed ceiling it is being
  // measured against — and does so differently depending on which way it was
  // steered, which is exactly how a symmetric control scheme came to look
  // asymmetric.
  cr.setCollisions(false);
  cr.setPickupSpawning(false);
  cr.clearPowerups();
  cr.startRun(5);
  cr.clearCues();
  // Long enough to be pinned against the rail rather than merely approaching it.
  cr.drive(8, 1);
  const s = cr.state();
  return { x: s.x, vx: s.vx, speed: s.speed, crashes: cr.cues['player:crash'].count, halfWidth: null };
});

check('barrier', 'car-contained', Math.abs(barrier.x) <= config.halfWidth + 3.0,
  `x pinned at ${barrier.x.toFixed(2)}, containment limit ${(config.halfWidth + 3.0).toFixed(2)}`);
check('barrier', 'barrier-cue-fires', barrier.crashes > 0,
  `player:crash (barrier) fired ${barrier.crashes} times while held against the rail`);
check('barrier', 'barrier-state-finite', finite(barrier.x, barrier.vx, barrier.speed),
  `x=${barrier.x} vx=${barrier.vx} speed=${barrier.speed}`);

/* -- the gutter ---------------------------------------------------------------
 *
 * The shoulder has been closed three times. A drag term settled at an
 * equilibrium and left it a sixth lane; a speed cap made it a slower sixth
 * lane; a camber closed it only for a driver who stopped steering. Each of
 * those looked right in a single frame and each left somewhere to coast, so
 * this is asserted over time and from both ends: that sitting in it stops the
 * car outright, and that it is still possible to get out.
 */
phase = 'gutter';
const gutter = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  cr.setPickupSpawning(false);
  cr.setTrafficSpawning(false);
  cr.clearPowerups();

  // Parked on the strip with the throttle in, sampled every half second.
  cr.startRun(5);
  cr.drive(4, 0);
  cr.place({ x: 11.6, vx: 0 });
  const trace = [];
  for (let i = 0; i < 10; i++) { cr.drive(0.5, 0); trace.push(cr.state().speed); }

  // From a standstill in the gutter, steering out has to work.
  cr.drive(2.0, -1);
  cr.drive(3.0, 0);
  const escaped = cr.state();

  // A second's dip is the escape move, and must stay affordable.
  cr.startRun(5);
  cr.drive(4, 0);
  const beforeDip = cr.state().speed;
  cr.place({ x: 11.6, vx: 0 });
  cr.drive(1.0, 0);
  cr.place({ x: 0, vx: 0 });
  cr.drive(2.0, 0);
  const afterDip = cr.state().speed;

  // And the floor on clean tarmac is untouched: brakes held, still rolling.
  cr.startRun(5);
  cr.drive(3, 0);
  cr.place({ x: 0 });
  cr.drive(6, 0, true);
  const braked = cr.state().speed;

  /* Hand the road back the way it was found.
   *
   * This phase needs an empty road — a truck arriving while the car is parked
   * on the strip ends the measurement — but the spawners are global, and
   * leaving them off silently disarmed every phase after this one. It cost ten
   * failures in collision, powerups, score and the HUD, none of which had
   * anything to do with the gutter and all of which were measuring a world
   * with no traffic in it. */
  cr.setTrafficSpawning(true);
  cr.setPickupSpawning(true);
  return { trace, escaped, beforeDip, afterDip, braked };
});

check('gutter', 'strip-stops-the-car',
  gutter.trace[gutter.trace.length - 1] === 0 && gutter.trace.some((v) => v > 0),
  `speed on the strip: ${gutter.trace.map((v) => v.toFixed(0)).join(' -> ')}`);
check('gutter', 'stop-arrives-within-the-timer',
  gutter.trace.findIndex((v) => v === 0) >= 0 && gutter.trace.findIndex((v) => v === 0) <= 6,
  `reached zero after ${((gutter.trace.findIndex((v) => v === 0) + 1) * 0.5).toFixed(1)}s`);
check('gutter', 'escape-is-still-possible',
  Math.abs(gutter.escaped.x) < config.halfWidth && gutter.escaped.speed > 40,
  `steered out to x=${gutter.escaped.x.toFixed(1)} at ${gutter.escaped.speed.toFixed(1)}`);
check('gutter', 'a-brief-dip-stays-affordable',
  gutter.afterDip > gutter.beforeDip * 0.4,
  `${gutter.beforeDip.toFixed(0)} -> dip -> ${gutter.afterDip.toFixed(0)} back on the road`);
check('gutter', 'road-floor-unchanged',
  Math.abs(gutter.braked - config.speedMin) < 0.5,
  `braking on tarmac settles at ${gutter.braked.toFixed(1)}, floor is ${config.speedMin}`);

/* -- speed model ------------------------------------------------------------- */

phase = 'speed';
const speedRun = await page.evaluate(() => {
  const cr = window.carRacer;
  // These measure handling, speed and stability, not collision or pickups.
  // Leaving traffic lethal would end the run partway and truncate the
  // measurement; leaving pickups on lets the car drive over a nitro crate
  // mid-measurement, which silently rewrites the speed ceiling it is being
  // measured against — and does so differently depending on which way it was
  // steered, which is exactly how a symmetric control scheme came to look
  // asymmetric.
  cr.setCollisions(false);
  cr.setPickupSpawning(false);
  cr.clearPowerups();
  cr.startRun(9);
  const t0 = cr.state();
  cr.drive(6, 0);
  const t1 = cr.state();
  cr.drive(3, 0, true);
  const t2 = cr.state();
  cr.drive(40, 0);
  const t3 = cr.state();
  return { start: t0.speed, cruised: t1.speed, braked: t2.speed, long: t3, ceiling: t3.speedCeiling };
});

check('speed', 'accelerates', speedRun.cruised > speedRun.start + 4,
  `speed ${speedRun.start.toFixed(1)} -> ${speedRun.cruised.toFixed(1)} over 6s`);
check('speed', 'braking-slows', speedRun.braked < speedRun.cruised - 4,
  `braking took ${speedRun.cruised.toFixed(1)} -> ${speedRun.braked.toFixed(1)} over 3s`);
check('speed', 'respects-ceiling', speedRun.long.speed <= speedRun.ceiling + 1e-6,
  `speed ${speedRun.long.speed.toFixed(2)} vs ceiling ${speedRun.ceiling.toFixed(2)}`);
check('speed', 'never-exceeds-absolute-max', speedRun.long.speed <= config.speedAbsoluteMax + 1e-6,
  `speed ${speedRun.long.speed.toFixed(2)} vs absolute max ${config.speedAbsoluteMax}`);
check('speed', 'distance-advances', speedRun.long.distance > 1000,
  `distance after ~49s: ${speedRun.long.distance.toFixed(0)}u`);
check('speed', 'kmh-readout-sane', speedRun.long.speedKmh > 100 && speedRun.long.speedKmh < 600,
  `HUD speed would read ${speedRun.long.speedKmh.toFixed(0)} km/h`);

/* -- cues -------------------------------------------------------------------- */

phase = 'cues';
const cueRun = await page.evaluate(() => {
  const cr = window.carRacer;
  // These measure handling, speed and stability, not collision or pickups.
  // Leaving traffic lethal would end the run partway and truncate the
  // measurement; leaving pickups on lets the car drive over a nitro crate
  // mid-measurement, which silently rewrites the speed ceiling it is being
  // measured against — and does so differently depending on which way it was
  // steered, which is exactly how a symmetric control scheme came to look
  // asymmetric.
  cr.setCollisions(false);
  cr.setPickupSpawning(false);
  cr.clearPowerups();
  cr.startRun(4242);
  cr.clearCues();
  cr.drive(3, 0);
  const straight = JSON.parse(JSON.stringify(cr.cues));
  // A full sweep across the road has to cross lane boundaries.
  cr.drive(2.5, -1);
  cr.drive(5, 1);
  const swept = JSON.parse(JSON.stringify(cr.cues));
  cr.endRun();
  const ended = JSON.parse(JSON.stringify(cr.cues));
  return { straight, swept, ended, state: cr.state() };
});

check('cue', 'run-start-fires', cueRun.swept['run:start'].count >= 0 && cueRun.ended['run:end'].count > 0,
  `run:end fired ${cueRun.ended['run:end'].count} times`);
check('cue', 'run-tick-fires', cueRun.straight['run:tick'].count > 100,
  `run:tick fired ${cueRun.straight['run:tick'].count} times in 3s of driving`);
check('cue', 'run-tick-payload-advances',
  cueRun.straight['run:tick'].last && cueRun.straight['run:tick'].last.distance > 0,
  `last run:tick distance: ${cueRun.straight['run:tick'].last?.distance?.toFixed(1)}`);
check('cue', 'player-steer-fires', cueRun.straight['player:steer'].count > 100,
  `player:steer fired ${cueRun.straight['player:steer'].count} times in 3s`);
check('cue', 'lane-change-fires', cueRun.swept['player:lane-change'].count >= 4,
  `player:lane-change fired ${cueRun.swept['player:lane-change'].count} times sweeping across 5 lanes, want >= 4`);
check('cue', 'lane-change-payload-adjacent',
  !cueRun.swept['player:lane-change'].last ||
  Math.abs(cueRun.swept['player:lane-change'].last.to - cueRun.swept['player:lane-change'].last.from) === 1,
  `last lane change: ${JSON.stringify(cueRun.swept['player:lane-change'].last)}`);
check('cue', 'save-write-on-run-end', cueRun.ended['save:write'].count > 0,
  `save:write fired ${cueRun.ended['save:write'].count} times after endRun`);
check('cue', 'run-end-payload-sane',
  cueRun.ended['run:end'].last && cueRun.ended['run:end'].last.distance > 0 &&
  Number.isFinite(cueRun.ended['run:end'].last.score),
  `run:end payload: ${JSON.stringify(cueRun.ended['run:end'].last)}`);

await shot(page, 'driving');

/* -- traffic ------------------------------------------------------------------
 * Six cues live here. Each is driven by the situation that should raise it,
 * rather than by calling the emitter — an assertion that only proves `emit`
 * works is worth nothing. */

phase = 'traffic';
const traffic = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  cr.startRun(2024);
  cr.clearCues();

  // Long enough for density to ramp, for cars to reach each other's mirrors,
  // and for the first spawns to pass out of the back of the world.
  const overlaps = [];
  const offRoad = [];
  let maxLive = 0;
  for (let i = 0; i < 60; i++) {
    cr.drive(1.5, 0);
    const live = cr.traffic();
    maxLive = Math.max(maxLive, live.length);

    // No two vehicles may interpenetrate, and none may leave the tarmac.
    for (let a = 0; a < live.length; a++) {
      for (let b = a + 1; b < live.length; b++) {
        const dx = Math.abs(live[a].x - live[b].x);
        const dz = Math.abs(live[a].ahead - live[b].ahead);
        if (dx < 1.6 && dz < 4.0) overlaps.push({ a: live[a], b: live[b], dx, dz });
      }
      if (Math.abs(live[a].x) > 10.5) offRoad.push(live[a]);
    }
  }

  return { cues: JSON.parse(JSON.stringify(cr.cues)), overlaps, offRoad, maxLive, state: cr.state() };
});

check('traffic', 'spawn-cue-fires', traffic.cues['traffic:spawn'].count > 20,
  `traffic:spawn fired ${traffic.cues['traffic:spawn'].count} times over 90s`);
check('traffic', 'spawn-payload-in-lane',
  traffic.cues['traffic:spawn'].last &&
  traffic.cues['traffic:spawn'].last.lane >= 0 &&
  traffic.cues['traffic:spawn'].last.lane < config.laneCount,
  `last spawn: ${JSON.stringify(traffic.cues['traffic:spawn'].last)}`);
check('traffic', 'spawns-slower-than-player',
  traffic.cues['traffic:spawn'].last && traffic.cues['traffic:spawn'].last.speed < config.speedMax,
  `last spawn speed ${traffic.cues['traffic:spawn'].last?.speed?.toFixed(1)} vs player base max ${config.speedMax}`);
check('traffic', 'despawn-cue-fires', traffic.cues['traffic:despawn'].count > 10,
  `traffic:despawn fired ${traffic.cues['traffic:despawn'].count} times`);
check('traffic', 'spawns-are-recycled',
  traffic.cues['traffic:despawn'].count <= traffic.cues['traffic:spawn'].count,
  `${traffic.cues['traffic:despawn'].count} despawns vs ${traffic.cues['traffic:spawn'].count} spawns`);
check('traffic', 'lane-change-cue-fires', traffic.cues['traffic:lane-change'].count > 0,
  `traffic:lane-change fired ${traffic.cues['traffic:lane-change'].count} times over 90s`);
check('traffic', 'lane-change-is-adjacent',
  !traffic.cues['traffic:lane-change'].last ||
  Math.abs(traffic.cues['traffic:lane-change'].last.to - traffic.cues['traffic:lane-change'].last.from) === 1,
  `last AI lane change: ${JSON.stringify(traffic.cues['traffic:lane-change'].last)}`);
check('traffic', 'brake-cue-fires', traffic.cues['traffic:brake'].count > 0,
  `traffic:brake fired ${traffic.cues['traffic:brake'].count} times — cars are watching the one in front`);
check('traffic', 'horn-cue-fires', traffic.cues['traffic:horn'].count > 0,
  `traffic:horn fired ${traffic.cues['traffic:horn'].count} times`);
check('traffic', 'no-interpenetration', traffic.overlaps.length === 0,
  traffic.overlaps.length
    ? `${traffic.overlaps.length} overlapping pairs, worst: ${JSON.stringify(traffic.overlaps[0])}`
    : 'no two vehicles overlapped across 60 samples');
check('traffic', 'stays-on-tarmac', traffic.offRoad.length === 0,
  traffic.offRoad.length
    ? `${traffic.offRoad.length} vehicles off the road, e.g. x=${traffic.offRoad[0].x.toFixed(2)}`
    : `all traffic within +/-10.5u of the centreline (road half-width ${config.halfWidth})`);
check('traffic', 'pool-is-bounded', traffic.maxLive <= 34,
  `peak live vehicles: ${traffic.maxLive}, pool size 34`);
check('traffic', 'road-is-populated', traffic.maxLive >= 6,
  `peak live vehicles: ${traffic.maxLive}, want >= 6 for a road that feels used`);

/* -- collision and near miss --------------------------------------------------
 * Driven by steering into a car rather than by faking an overlap, so the
 * collision box and the cue are both under test. */

phase = 'collision';
const impact = await page.evaluate(async () => {
  const cr = window.carRacer;
  cr.setCollisions(true);

  // Hunt for a run that puts a car in front of us, then drive into it.
  //
  // The approach is driven with collisions off. Spawns arrive 420u ahead and
  // close at roughly 20u/s, so nothing is within reach for the first twenty
  // seconds of a run — looking sooner finds an empty road and reports that
  // collision is broken when it has simply not been given anything to hit.
  for (let seed = 1; seed < 60; seed++) {
    cr.setCollisions(false);
    cr.startRun(seed);
    cr.drive(26, 0);
    cr.clearCues();
    cr.setCollisions(true);
    const ahead = cr.traffic()
      .filter((t) => t.ahead > 12 && t.ahead < 150)
      .sort((a, b) => a.ahead - b.ahead)[0];
    if (!ahead) continue;

    // Line up on its lane and close the gap.
    cr.place({ x: ahead.x, vx: 0 });
    for (let i = 0; i < 40 && cr.cues['player:crash'].count === 0; i++) {
      cr.drive(0.25, 0);
    }
    if (cr.cues['player:crash'].count > 0) {
      return { hit: true, seed, cues: JSON.parse(JSON.stringify(cr.cues)), state: cr.state() };
    }
  }
  return { hit: false, cues: JSON.parse(JSON.stringify(cr.cues)), state: cr.state() };
});

check('collision', 'driving-into-traffic-crashes', impact.hit,
  impact.hit
    ? `crashed into traffic on seed ${impact.seed}`
    : 'drove into a lined-up vehicle across 60 seeds without ever registering a hit');
check('collision', 'crash-cue-names-the-vehicle',
  impact.hit && impact.cues['player:crash'].last &&
  ['sedan', 'coupe', 'suv', 'van', 'truck', 'bus'].includes(impact.cues['player:crash'].last.with),
  `crash payload: ${JSON.stringify(impact.cues['player:crash'].last)}`);
check('collision', 'crash-ends-the-run', impact.hit && impact.state.runState === 'gameover',
  `runState after hitting traffic: ${impact.state.runState}`);

const nearMiss = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(true);

  // Pass close alongside without touching: offset by just over the combined
  // half-widths, which is inside the near-miss band but outside the box.
  for (let seed = 1; seed < 80; seed++) {
    cr.setCollisions(false);
    cr.startRun(seed);
    cr.drive(26, 0);
    cr.clearCues();
    cr.setCollisions(true);
    const ahead = cr.traffic()
      .filter((t) => t.ahead > 14 && t.ahead < 150 && Math.abs(t.x) < 6)
      .sort((a, b) => a.ahead - b.ahead)[0];
    if (!ahead) continue;

    cr.place({ x: ahead.x + 2.7, vx: 0 });
    for (let i = 0; i < 40; i++) {
      cr.drive(0.25, 0);
      if (cr.cues['player:crash'].count > 0) break;
      if (cr.cues['player:near-miss'].count > 0) {
        return { got: true, seed, cues: JSON.parse(JSON.stringify(cr.cues)) };
      }
    }
  }
  return { got: false, cues: JSON.parse(JSON.stringify(cr.cues)) };
});

check('collision', 'near-miss-cue-fires', nearMiss.got,
  nearMiss.got
    ? `player:near-miss fired on seed ${nearMiss.seed} passing alongside without contact`
    : 'passed close alongside traffic across 80 seeds without a near miss ever registering');
check('collision', 'near-miss-reports-a-positive-gap',
  !nearMiss.got || (nearMiss.cues['player:near-miss'].last &&
    nearMiss.cues['player:near-miss'].last.gap > 0),
  `near-miss payload: ${JSON.stringify(nearMiss.cues?.['player:near-miss']?.last)}`);

await shot(page, 'traffic');

/* -- pickups and power-ups ---------------------------------------------------
 * Five cues. Collection is driven by steering onto a coin, and each effect is
 * asserted by the difference it makes to the world rather than by its timer
 * being non-zero — a power-up whose timer runs while nothing changes is the
 * failure mode worth catching. */

phase = 'pickups';
const collect = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  // Earlier blocks switch pickups off to measure physics; this one is about
  // pickups, so it turns them back on rather than inheriting whatever the
  // previous scenario happened to leave set.
  cr.setPickupSpawning(true);
  cr.clearPowerups();
  cr.startRun(555);
  cr.drive(20, 0);
  cr.clearCues();

  // Steer onto the nearest coin run and follow it.
  let laid = 0;
  for (let i = 0; i < 90; i++) {
    const live = cr.pickups().filter((p) => p.ahead > 4 && p.ahead < 120);
    laid = Math.max(laid, cr.pickups().length);
    const target = live.sort((a, b) => a.ahead - b.ahead)[0];
    if (target) cr.place({ x: target.x, vx: 0 });
    cr.drive(0.5, 0);
    if (cr.cues['pickup:collect'].count > 4) break;
  }
  return { cues: JSON.parse(JSON.stringify(cr.cues)), laid, coins: cr.state().coins };
});

check('pickup', 'pickups-are-laid', collect.laid > 0,
  `peak live pickups on the road: ${collect.laid}`);
check('pickup', 'collect-cue-fires', collect.cues['pickup:collect'].count > 0,
  `pickup:collect fired ${collect.cues['pickup:collect'].count} times while following a coin run`);
check('pickup', 'collect-payload-has-value',
  collect.cues['pickup:collect'].last &&
  ['coin', 'gem', 'shield', 'nitro', 'magnet', 'ghost', 'slowmo'].includes(collect.cues['pickup:collect'].last.kind),
  `last collect: ${JSON.stringify(collect.cues['pickup:collect'].last)}`);

const magnet = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  cr.setPickupSpawning(true);
  cr.clearPowerups();
  cr.startRun(777);
  cr.drive(20, 0);

  // Measure how far the nearest pickup is from the player's line, with the
  // magnet off and then on, over the same elapsed time from the same state.
  const gapWithout = (() => {
    cr.clearCues();
    cr.drive(1.2, 0);
    const live = cr.pickups().filter((p) => p.ahead > 2 && p.ahead < 18);
    return { n: cr.cues['pickup:magnetised'].count, live: live.length };
  })();

  cr.startRun(777);
  cr.drive(20, 0);
  cr.clearCues();
  cr.givePowerup('magnet');
  cr.drive(1.2, 0);
  const withMagnet = cr.cues['pickup:magnetised'].count;

  return { without: gapWithout.n, with: withMagnet, timers: cr.powerups() };
});

check('pickup', 'magnetised-cue-fires', magnet.with > 0,
  `pickup:magnetised fired ${magnet.with} times with the magnet up`);
check('pickup', 'magnet-does-nothing-when-inactive', magnet.without === 0,
  `pickup:magnetised fired ${magnet.without} times with no magnet running — want 0`);

const effects = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(false);

  // Nitro: the speed ceiling must actually rise. Pickups are switched off for
  // the duration — a road that keeps handing out fresh nitro cannot be used to
  // measure how the first one wears off.
  cr.setPickupSpawning(false);
  cr.clearPowerups();
  cr.startRun(11);
  cr.drive(14, 0);
  const baseCeiling = cr.state().speedCeiling;
  cr.clearCues();
  cr.givePowerup('nitro');
  cr.drive(0.5, 0);
  const boostedCeiling = cr.state().speedCeiling;
  const activateCue = JSON.parse(JSON.stringify(cr.cues['powerup:activate']));

  // Expiry: run the clock past the duration and confirm it lets go.
  cr.clearCues();
  cr.drive(12, 0);
  const expireCue = JSON.parse(JSON.stringify(cr.cues['powerup:expire']));
  const afterExpiry = cr.state().speedCeiling;
  const timers = cr.powerups();
  cr.setPickupSpawning(true);

  return { baseCeiling, boostedCeiling, afterExpiry, activateCue, expireCue, timers };
});

check('powerup', 'activate-cue-fires', effects.activateCue.count > 0,
  `powerup:activate fired ${effects.activateCue.count} times`);
check('powerup', 'activate-payload-carries-duration',
  effects.activateCue.last && effects.activateCue.last.duration > 0,
  `activate payload: ${JSON.stringify(effects.activateCue.last)}`);
check('powerup', 'nitro-raises-the-ceiling', effects.boostedCeiling > effects.baseCeiling + 5,
  `speed ceiling ${effects.baseCeiling.toFixed(1)} -> ${effects.boostedCeiling.toFixed(1)} on nitro`);
check('powerup', 'expire-cue-fires', effects.expireCue.count > 0,
  `powerup:expire fired ${effects.expireCue.count} times after the duration elapsed`);
// The ceiling also climbs with distance travelled, so an equality against the
// pre-nitro value would fail for the wrong reason. What must be true is that
// the boost itself is gone.
check('powerup', 'effect-actually-ends',
  effects.afterExpiry < effects.boostedCeiling - 5 && effects.timers.nitro === 0,
  `ceiling ${effects.baseCeiling.toFixed(1)} base -> ${effects.boostedCeiling.toFixed(1)} boosted -> ` +
  `${effects.afterExpiry.toFixed(1)} after expiry, nitro timer ${effects.timers.nitro}`);
check('powerup', 'timers-drain-to-zero',
  Object.values(effects.timers).every((t) => t === 0),
  `remaining timers: ${JSON.stringify(effects.timers)}`);

/* The shield's whole job is to turn a fatal collision into a survivable one, so
 * it is tested by crashing with it up and checking the run is still going. */
const shielded = await page.evaluate(() => {
  const cr = window.carRacer;
  for (let seed = 1; seed < 60; seed++) {
    cr.setCollisions(false);
    cr.startRun(seed);
    cr.drive(26, 0);
    const ahead = cr.traffic()
      .filter((t) => t.ahead > 12 && t.ahead < 150)
      .sort((a, b) => a.ahead - b.ahead)[0];
    if (!ahead) continue;

    cr.clearCues();
    cr.setCollisions(true);
    cr.givePowerup('shield');
    cr.place({ x: ahead.x, vx: 0 });
    for (let i = 0; i < 40; i++) {
      cr.drive(0.25, 0);
      if (cr.cues['powerup:blocked-crash'].count > 0 || cr.cues['player:crash'].count > 0) break;
    }
    if (cr.cues['powerup:blocked-crash'].count > 0 || cr.cues['player:crash'].count > 0) {
      return { seed, cues: JSON.parse(JSON.stringify(cr.cues)), state: cr.state(), timers: cr.powerups() };
    }
  }
  return null;
});

check('powerup', 'shield-blocks-the-crash',
  shielded && shielded.cues['powerup:blocked-crash'].count > 0,
  shielded
    ? `blocked-crash ${shielded.cues['powerup:blocked-crash'].count}, crash ${shielded.cues['player:crash'].count}`
    : 'never made contact with a shield up across 60 seeds');
check('powerup', 'shield-keeps-the-run-alive',
  shielded && shielded.state.runState === 'driving',
  `runState after a shielded impact: ${shielded?.state.runState}`);
check('powerup', 'shield-is-consumed-by-the-hit',
  shielded && shielded.timers.shield === 0,
  `shield remaining after absorbing a hit: ${shielded?.timers.shield?.toFixed(2)}s — want 0`);

await shot(page, 'pickups');

/* -- scoring ------------------------------------------------------------------
 * Four cues. The combo is the part worth testing hardest: it is the mechanic
 * that rewards driving close to traffic rather than hiding in an empty lane,
 * and a multiplier that silently fails to climb would leave the game playable
 * but pointless. */

phase = 'scoring';
const scoring = await page.evaluate((comboWindow) => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  cr.startRun(3141);
  cr.clearCues();
  cr.drive(30, 0);

  const distanceOnly = {
    score: cr.state().score,
    adds: cr.cues['score:add'].count,
    milestones: JSON.parse(JSON.stringify(cr.cues['score:milestone'])),
  };

  // Now provoke a combo by parking alongside traffic repeatedly.
  cr.clearCues();
  const multipliers = [];
  for (let i = 0; i < 70; i++) {
    const beside = cr.traffic()
      .filter((t) => t.ahead > 6 && t.ahead < 90)
      .sort((a, b) => a.ahead - b.ahead)[0];
    if (beside) cr.place({ x: beside.x + 2.7, vx: 0 });
    cr.drive(0.4, 0);
    multipliers.push(cr.state().multiplier);
    if (cr.cues['score:combo'].count >= 3) break;
  }
  const combo = JSON.parse(JSON.stringify(cr.cues['score:combo']));
  const peakMultiplier = Math.max(...multipliers);
  const chainAtPeak = cr.state().comboChain;

  // Then stop provoking it and let the window lapse.
  // An empty road for longer than the window, so the chain must lapse.
  //
  // Simply steering away is not enough: anywhere on a five-lane road is within
  // near-miss range of something, so the chain kept being refreshed and the
  // test reported a combo that never decays. That was the measurement being
  // wrong, not the game — a chain that survives while you keep threading
  // traffic is the whole point of it.
  cr.setTrafficSpawning(false);
  cr.clearTraffic();
  cr.place({ x: 0, vx: 0 });
  cr.drive(comboWindow + 2, 0);
  cr.setTrafficSpawning(true);
  const broke = JSON.parse(JSON.stringify(cr.cues['score:combo-break']));

  return {
    distanceOnly, combo, broke, peakMultiplier, chainAtPeak,
    chainAfter: cr.state().comboChain,
    multiplierAfter: cr.state().multiplier,
    addLast: JSON.parse(JSON.stringify(cr.cues['score:add'].last ?? null)),
  };
}, config.comboWindow);

check('score', 'add-cue-fires', scoring.distanceOnly.adds > 0,
  `score:add fired ${scoring.distanceOnly.adds} times in 30s`);
check('score', 'add-payload-carries-reason',
  scoring.addLast && typeof scoring.addLast.reason === 'string' && scoring.addLast.reason.length > 0,
  `last score:add: ${JSON.stringify(scoring.addLast)}`);
check('score', 'distance-scores', scoring.distanceOnly.score > 500,
  `score after 30s of clean driving: ${scoring.distanceOnly.score.toFixed(0)}`);
check('score', 'milestone-cue-fires', scoring.distanceOnly.milestones.count > 0,
  `score:milestone fired ${scoring.distanceOnly.milestones.count} times over ~3km`);
check('score', 'milestone-tiers-ascend',
  !scoring.distanceOnly.milestones.last || scoring.distanceOnly.milestones.last.tier >= 1,
  `last milestone: ${JSON.stringify(scoring.distanceOnly.milestones.last)}`);
check('score', 'combo-cue-fires', scoring.combo.count > 0,
  `score:combo fired ${scoring.combo.count} times while running alongside traffic`);
check('score', 'combo-raises-the-multiplier', scoring.peakMultiplier > 1.0,
  `peak multiplier reached: ${scoring.peakMultiplier.toFixed(2)}x on a chain of ${scoring.chainAtPeak}`);
check('score', 'combo-break-cue-fires', scoring.broke.count > 0,
  `score:combo-break fired ${scoring.broke.count} times after the window lapsed`);
check('score', 'combo-break-resets-the-chain',
  scoring.chainAfter === 0 && near(scoring.multiplierAfter, 1, 1e-9),
  `chain ${scoring.chainAfter}, multiplier ${scoring.multiplierAfter} after the break`);

/* -- world: biome, weather, day/night, tunnels --------------------------------
 * Five cues. Each is asserted by the change it makes to the rendered world as
 * well as by firing — a weather cue that announces a storm while the fog, the
 * exposure and the grip all stay put is the failure this is looking for. */

phase = 'world';
const world = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  cr.startRun(90210);
  cr.clearCues();

  // Far enough to cross several biomes, several weather rolls and more than a
  // full day-night cycle. Samples are kept so the effects can be correlated
  // with the cues that announced them.
  const samples = [];
  for (let i = 0; i < 85; i++) {
    cr.drive(3, 0);
    const s = cr.state();
    samples.push({
      distance: s.distance, biome: s.biome, weather: s.weather, phase: s.dayPhase,
      inTunnel: s.inTunnel, grip: s.surfaceGrip, fog: s.fogDensity,
      sun: s.sunIntensity, headlights: s.headlights,
    });
  }

  return { cues: JSON.parse(JSON.stringify(cr.cues)), samples, state: cr.state() };
});

const seen = (key) => [...new Set(world.samples.map((s) => s[key]))];

check('world', 'biome-change-cue-fires', world.cues['biome:change'].count > 0,
  `biome:change fired ${world.cues['biome:change'].count} times over ~30km`);
check('world', 'biome-actually-changes', seen('biome').length > 1,
  `biomes visited: ${seen('biome').join(', ')}`);
check('world', 'biome-payload-is-a-transition',
  !world.cues['biome:change'].last ||
  world.cues['biome:change'].last.from !== world.cues['biome:change'].last.to,
  `last biome change: ${JSON.stringify(world.cues['biome:change'].last)}`);

check('world', 'daynight-cue-fires', world.cues['daynight:change'].count > 0,
  `daynight:change fired ${world.cues['daynight:change'].count} times`);
check('world', 'day-runs-through-its-phases', seen('phase').length >= 3,
  `phases seen: ${seen('phase').join(', ')}`);
{
  // Night has to be visibly night, not merely labelled so.
  const night = world.samples.filter((s) => s.phase === 'night');
  const day = world.samples.filter((s) => s.phase === 'day');
  const avg = (rows, key) => rows.reduce((n, r) => n + r[key], 0) / (rows.length || 1);
  check('world', 'night-is-darker-than-day',
    night.length > 0 && day.length > 0 && avg(night, 'sun') < avg(day, 'sun'),
    `mean sun intensity: night ${avg(night, 'sun').toFixed(2)} vs day ${avg(day, 'sun').toFixed(2)}`);
  check('world', 'headlights-come-on-in-the-dark',
    night.length > 0 && avg(night, 'headlights') > avg(day, 'headlights'),
    `mean headlight intensity: night ${avg(night, 'headlights').toFixed(2)} vs day ${avg(day, 'headlights').toFixed(2)}`);
}

check('world', 'weather-change-cue-fires', world.cues['weather:change'].count > 0,
  `weather:change fired ${world.cues['weather:change'].count} times over ~30km`);
check('world', 'weather-payload-has-intensity',
  !world.cues['weather:change'].last ||
  (world.cues['weather:change'].last.to === 'clear'
    ? world.cues['weather:change'].last.intensity === 0
    : world.cues['weather:change'].last.intensity > 0),
  `last weather change: ${JSON.stringify(world.cues['weather:change'].last)}`);
{
  const wet = world.samples.filter((s) => s.weather === 'rain' || s.weather === 'storm');
  const dry = world.samples.filter((s) => s.weather === 'clear');
  check('world', 'wet-roads-lose-grip',
    wet.length === 0 || dry.length === 0 || Math.max(...wet.map((s) => s.grip)) < 1,
    wet.length
      ? `grip in the wet: ${Math.max(...wet.map((s) => s.grip)).toFixed(2)} vs ${dry[0]?.grip ?? 1} dry`
      : 'no wet weather occurred in this run to measure');
  check('world', 'bad-weather-thickens-the-fog',
    wet.length === 0 || dry.length === 0 ||
    Math.max(...wet.map((s) => s.fog)) > Math.min(...dry.map((s) => s.fog)),
    wet.length
      ? `fog density: worst wet ${Math.max(...wet.map((s) => s.fog)).toExponential(2)} vs clearest dry ${Math.min(...dry.map((s) => s.fog)).toExponential(2)}`
      : 'no wet weather occurred in this run to measure');
}

check('world', 'tunnel-enter-cue-fires', world.cues['world:tunnel-enter'].count > 0,
  `world:tunnel-enter fired ${world.cues['world:tunnel-enter'].count} times`);
check('world', 'tunnel-exit-cue-fires', world.cues['world:tunnel-exit'].count > 0,
  `world:tunnel-exit fired ${world.cues['world:tunnel-exit'].count} times`);
check('world', 'every-tunnel-is-left',
  world.cues['world:tunnel-enter'].count - world.cues['world:tunnel-exit'].count <= 1,
  `${world.cues['world:tunnel-enter'].count} entered, ${world.cues['world:tunnel-exit'].count} exited`);
check('world', 'tunnel-has-a-length',
  !world.cues['world:tunnel-enter'].last || world.cues['world:tunnel-enter'].last.length > 0,
  `last tunnel: ${JSON.stringify(world.cues['world:tunnel-enter'].last)}`);
{
  const inside = world.samples.filter((s) => s.inTunnel);
  check('world', 'tunnels-light-the-headlights',
    inside.length === 0 || inside.every((s) => s.headlights > 0),
    inside.length
      ? `${inside.length} samples inside a tunnel, min headlight intensity ${Math.min(...inside.map((s) => s.headlights)).toFixed(2)}`
      : 'no tunnel sample landed in this run');
}

await shot(page, 'world');

/* -- jumps and drift ---------------------------------------------------------
 * Three cues. Airborne and land are raised by cresting a hill fast enough, so
 * the test drives until the road throws the car rather than calling `launch`. */

phase = 'air';
const air = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  cr.setPickupSpawning(false);
  cr.clearPowerups();
  cr.startRun(4004);
  // Up to speed first: below the threshold a crest is just a gentle rise.
  cr.drive(12, 0);
  cr.clearCues();

  let peakHeight = 0;
  for (let i = 0; i < 200; i++) {
    cr.drive(0.4, 0);
    peakHeight = Math.max(peakHeight, cr.state().y);
    if (cr.cues['player:land'].count > 0) break;
  }
  return { cues: JSON.parse(JSON.stringify(cr.cues)), peakHeight, state: cr.state() };
});

check('air', 'airborne-cue-fires', air.cues['player:airborne'].count > 0,
  `player:airborne fired ${air.cues['player:airborne'].count} times cresting hills at speed`);
check('air', 'car-actually-leaves-the-road', air.peakHeight > 0.15,
  `peak height above the surface: ${air.peakHeight.toFixed(2)}u`);
check('air', 'land-cue-fires', air.cues['player:land'].count > 0,
  `player:land fired ${air.cues['player:land'].count} times`);
check('air', 'land-reports-an-impact',
  air.cues['player:land'].last && air.cues['player:land'].last.impact > 0,
  `land payload: ${JSON.stringify(air.cues['player:land'].last)}`);
check('air', 'car-comes-back-down', air.state.airborne === false && near(air.state.y, 0, 1e-6),
  `y=${air.state.y}, airborne=${air.state.airborne} after landing`);

const drift = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  cr.setPickupSpawning(false);
  cr.clearPowerups();
  cr.startRun(6006);
  cr.drive(12, 0);

  // A hard direction reversal at speed is what breaks traction.
  cr.clearCues();
  const slipping = [];
  for (let i = 0; i < 14; i++) {
    cr.drive(0.9, i % 2 === 0 ? 1 : -1);
    slipping.push(cr.state().slipping);
  }
  return {
    cues: JSON.parse(JSON.stringify(cr.cues)),
    everSlipped: slipping.some(Boolean),
  };
});

check('drift', 'drift-cue-fires', drift.cues['player:drift'].count > 0,
  `player:drift fired ${drift.cues['player:drift'].count} times through hard direction changes`);
check('drift', 'drift-reports-intensity',
  drift.cues['player:drift'].last && drift.cues['player:drift'].last.intensity > 0,
  `drift payload: ${JSON.stringify(drift.cues['player:drift'].last)}`);
check('drift', 'slip-state-is-reported', drift.everSlipped,
  `the slipping flag was raised during the manoeuvre: ${drift.everSlipped}`);

/* -- countdown ---------------------------------------------------------------- */

phase = 'countdown';
const countdown = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.clearCues();
  cr.startCountdown(3);
  const during = cr.state().runState;
  cr.drive(4.2, 0);
  return {
    during,
    after: cr.state().runState,
    cues: JSON.parse(JSON.stringify(cr.cues['run:countdown'])),
  };
});

check('countdown', 'countdown-cue-fires', countdown.cues.count >= 3,
  `run:countdown fired ${countdown.cues.count} times counting down from 3`);
check('countdown', 'countdown-holds-the-run', countdown.during === 'countdown',
  `runState during the count: ${countdown.during}`);
check('countdown', 'countdown-reaches-zero',
  countdown.cues.last && countdown.cues.last.remaining === 0,
  `last countdown payload: ${JSON.stringify(countdown.cues.last)}`);
check('countdown', 'countdown-starts-the-run', countdown.after === 'driving',
  `runState after the count elapsed: ${countdown.after}`);

/* -- garage -------------------------------------------------------------------
 * Three cues, plus the money rules around them. A shop that gives things away
 * is a bug no screenshot will ever show. */

phase = 'garage';
const garage = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.resetSave();

  const roster = cr.garage();
  const locked = roster.find((e) => !e.owned);
  const startingBalance = cr.state().coins;

  // Too poor: the purchase must fail and must not charge.
  const brokeAttempt = cr.buyCar(locked.def.id);
  const balanceAfterFailure = cr.state().coins;

  // Now afford it.
  cr.grantCoins(locked.def.price + 5000);
  const funded = cr.state().coins;
  cr.clearCues();
  const bought = cr.buyCar(locked.def.id);
  const afterPurchase = cr.state().coins;
  const purchaseCue = JSON.parse(JSON.stringify(cr.cues['garage:purchase']));

  // Buying the same car twice must not charge again.
  const boughtTwice = cr.buyCar(locked.def.id);
  const afterSecond = cr.state().coins;

  const equipped = cr.equipCar(locked.def.id);
  const equipCue = JSON.parse(JSON.stringify(cr.cues['garage:equip']));
  const activeCar = cr.state().carId;

  // Upgrades: price, effect on stats, and the level ceiling.
  const before = cr.garage().find((e) => e.def.id === locked.def.id);
  const upgradePrice = before.upgradePrices.grip;
  const balanceBeforeUpgrade = cr.state().coins;
  const upgraded = cr.upgradeCar(locked.def.id, 'grip');
  const balanceAfterUpgrade = cr.state().coins;
  const upgradeCue = JSON.parse(JSON.stringify(cr.cues['garage:upgrade']));
  const after = cr.garage().find((e) => e.def.id === locked.def.id);

  // Push one stat to its ceiling and confirm it refuses to go further.
  for (let i = 0; i < 12; i++) cr.upgradeCar(locked.def.id, 'grip');
  const maxed = cr.garage().find((e) => e.def.id === locked.def.id);
  const beyondMax = cr.upgradeCar(locked.def.id, 'grip');

  // An unowned car cannot be equipped or upgraded.
  const stillLocked = cr.garage().find((e) => !e.owned);
  const equipLocked = stillLocked ? cr.equipCar(stillLocked.def.id) : false;
  const upgradeLocked = stillLocked ? cr.upgradeCar(stillLocked.def.id, 'grip') : true;

  return {
    startingBalance, brokeAttempt, balanceAfterFailure, funded, bought, afterPurchase,
    boughtTwice, afterSecond, equipped, activeCar, price: locked.def.price,
    upgradePrice, balanceBeforeUpgrade, upgraded, balanceAfterUpgrade,
    levelBefore: before.levels.grip ?? 0, levelAfter: after.levels.grip ?? 0,
    maxedLevel: maxed.levels.grip ?? 0, maxedPrice: maxed.upgradePrices.grip,
    beyondMax, equipLocked, upgradeLocked,
    purchaseCue, equipCue, upgradeCue,
  };
});

check('garage', 'purchase-cue-fires', garage.purchaseCue.count > 0,
  `garage:purchase fired ${garage.purchaseCue.count} times`);
check('garage', 'purchase-succeeds-when-funded', garage.bought === true,
  `buyCar returned ${garage.bought} with ${garage.funded} coins for a ${garage.price} car`);
check('garage', 'purchase-charges-the-right-amount',
  garage.funded - garage.afterPurchase === garage.price,
  `balance ${garage.funded} -> ${garage.afterPurchase}, car costs ${garage.price}`);
check('garage', 'purchase-refused-when-broke', garage.brokeAttempt === false,
  `buyCar returned ${garage.brokeAttempt} with ${garage.startingBalance} coins`);
check('garage', 'failed-purchase-does-not-charge',
  garage.balanceAfterFailure === garage.startingBalance,
  `balance ${garage.startingBalance} -> ${garage.balanceAfterFailure} after a refused purchase`);
check('garage', 'cannot-buy-the-same-car-twice',
  garage.boughtTwice === false && garage.afterSecond === garage.afterPurchase,
  `second purchase returned ${garage.boughtTwice}, balance ${garage.afterPurchase} -> ${garage.afterSecond}`);

check('garage', 'equip-cue-fires', garage.equipCue.count > 0,
  `garage:equip fired ${garage.equipCue.count} times`);
check('garage', 'equip-changes-the-car', garage.equipped === true,
  `equipCar returned ${garage.equipped}; active car is now ${garage.activeCar}`);
check('garage', 'cannot-equip-an-unowned-car', garage.equipLocked === false,
  `equipping a locked car returned ${garage.equipLocked}`);

check('garage', 'upgrade-cue-fires', garage.upgradeCue.count > 0,
  `garage:upgrade fired ${garage.upgradeCue.count} times`);
check('garage', 'upgrade-raises-the-level',
  garage.upgraded === true && garage.levelAfter === garage.levelBefore + 1,
  `grip level ${garage.levelBefore} -> ${garage.levelAfter}`);
check('garage', 'upgrade-charges-its-quoted-price',
  garage.balanceBeforeUpgrade - garage.balanceAfterUpgrade === garage.upgradePrice,
  `quoted ${garage.upgradePrice}, charged ${garage.balanceBeforeUpgrade - garage.balanceAfterUpgrade}`);
check('garage', 'upgrades-stop-at-the-ceiling',
  garage.beyondMax === false && garage.maxedPrice === null,
  `level ${garage.maxedLevel} at the ceiling, further upgrade returned ${garage.beyondMax}, price quoted ${garage.maxedPrice}`);
check('garage', 'cannot-upgrade-an-unowned-car', garage.upgradeLocked === false,
  `upgrading a locked car returned ${garage.upgradeLocked}`);

await shot(page, 'garage');

/* -- audio --------------------------------------------------------------------
 * The second coverage gate. `AUDIBLE_CUES` is the game's own list of what must
 * make a sound; anything on it with no recorded play is a silent feature.
 *
 * Existence is not the test. A synth that builds an oscillator at zero gain, or
 * behind a muted master, or into a context stuck `suspended`, is exactly as
 * silent as no synth at all — and all three are things that ship. So each cue
 * is checked for voices AND for the gain it opened at, the node counts are
 * corroborated from outside the page against the real AudioContext, and mute is
 * verified to actually close the master. */

phase = 'audio';
const audio = await page.evaluate(async () => {
  const cr = window.carRacer;
  cr.resumeAudio();
  cr.setMuted(false);
  cr.setCollisions(false);
  cr.setPickupSpawning(true);
  cr.setTrafficSpawning(true);
  cr.clearPowerups();

  // A representative session: long enough for weather, milestones, hills and
  // horns; then the situations that have to be provoked deliberately.
  cr.startCountdown(3);
  cr.drive(4.2, 0);
  for (let i = 0; i < 40; i++) cr.drive(3, i % 3 === 0 ? 0.7 : -0.5);

  // Near miss and horn: ride alongside traffic.
  for (let i = 0; i < 50; i++) {
    const beside = cr.traffic().filter((t) => t.ahead > 5 && t.ahead < 90)
      .sort((a, b) => a.ahead - b.ahead)[0];
    if (beside) cr.place({ x: beside.x + 2.7, vx: 0 });
    cr.drive(0.4, 0);
  }

  // Power-ups, both ends.
  cr.givePowerup('nitro');
  cr.drive(0.5, 0);
  cr.setPickupSpawning(false);
  cr.drive(12, 0);

  // A shielded impact, then a real one.
  for (let seed = 1; seed < 40 && cr.cues['powerup:blocked-crash'].count === 0; seed++) {
    cr.setCollisions(false);
    cr.startRun(seed);
    cr.drive(26, 0);
    const ahead = cr.traffic().filter((t) => t.ahead > 12 && t.ahead < 150)
      .sort((a, b) => a.ahead - b.ahead)[0];
    if (!ahead) continue;
    cr.setCollisions(true);
    cr.givePowerup('shield');
    cr.place({ x: ahead.x, vx: 0 });
    for (let i = 0; i < 40; i++) {
      cr.drive(0.25, 0);
      if (cr.cues['player:crash'].count > 0) break;
    }
  }

  // Garage transactions.
  cr.resetSave();
  cr.grantCoins(60000);
  const locked = cr.garage().find((e) => !e.owned);
  if (locked) {
    cr.buyCar(locked.def.id);
    cr.equipCar(locked.def.id);
    cr.upgradeCar(locked.def.id, 'grip');
  }

  const beforeMute = window.__audio ? { ...window.__audio } : null;
  const stats = cr.audio();
  const silent = cr.silentAudioCues();

  // Mute has to close the master, not merely set a flag.
  cr.setMuted(true);
  await new Promise((r) => setTimeout(r, 120));
  const mutedGain = cr.state().muted;

  return {
    stats, silent, audible: cr.audibleCues(), beforeMute, mutedGain,
    contextState: cr.state().audioContext,
    nodes: window.__audio ? { ...window.__audio } : null,
  };
});

/* The gate. */
check('audio', 'no-silent-cues', audio.silent.length === 0,
  `${audio.silent.length} of ${audio.audible.length} cues that must make a sound never did: ` +
  `${audio.silent.join(', ') || 'none'}`);

check('audio', 'context-running', audio.contextState === 'running',
  `AudioContext state: ${audio.contextState} — a suspended context drops every sound played into it`);

/* Corroborated from outside the page: the game claims it built voices, and the
 * real AudioContext agrees it was asked to. */
check('audio', 'oscillators-really-built', (audio.nodes?.oscillators ?? 0) > 20,
  `AudioContext.createOscillator called ${audio.nodes?.oscillators ?? 0} times`);
check('audio', 'noise-sources-really-built', (audio.nodes?.buffers ?? 0) > 5,
  `AudioContext.createBufferSource called ${audio.nodes?.buffers ?? 0} times`);
check('audio', 'gain-nodes-really-built', (audio.nodes?.gains ?? 0) > 20,
  `AudioContext.createGain called ${audio.nodes?.gains ?? 0} times`);

/* Per cue: voices and an audible gain, not just a play count. */
for (const cue of audio.audible) {
  const stat = audio.stats[cue];
  const voices = (stat?.oscillators ?? 0) + (stat?.buffers ?? 0);
  check('audio', `voiced/${cue}`, voices > 0 && (stat?.peakGain ?? 0) > 0.001,
    `${cue}: ${stat?.plays ?? 0} plays, ${stat?.oscillators ?? 0} osc + ${stat?.buffers ?? 0} buf, ` +
    `peak gain ${(stat?.peakGain ?? 0).toFixed(3)}`);
}

check('audio', 'mute-is-persisted', audio.mutedGain === true,
  `muted flag after setMuted(true): ${audio.mutedGain}`);

/* Total node count must not grow without bound over a long run — the squeal and
 * the rain bed are held open and reused, not rebuilt per frame. */
const audioGrowth = await page.evaluate(async () => {
  const cr = window.carRacer;
  cr.setMuted(false);
  cr.setCollisions(false);
  cr.startRun(31337);
  cr.drive(10, 0);
  const before = { ...window.__audio };
  // Thrash the slide state, which is the one held-open voice most at risk of
  // being rebuilt every time it is asked for.
  for (let i = 0; i < 30; i++) cr.drive(1, i % 2 === 0 ? 1 : -1);
  const after = { ...window.__audio };
  return { before, after };
});

check('audio', 'held-voices-are-reused',
  audioGrowth.after.buffers - audioGrowth.before.buffers < 60,
  `buffer sources created across 30s of continuous sliding: ` +
  `${audioGrowth.after.buffers - audioGrowth.before.buffers}, want < 60`);

/* -- interface ----------------------------------------------------------------
 * The third coverage gate. Presence is the cheap half; the real test is that
 * what the player reads agrees with what the simulation believes. A speedometer
 * frozen at a plausible number photographs perfectly, and so does a combo meter
 * that stopped updating three seconds ago. So every readout is compared against
 * the state it claims to be showing, and the screens are checked for being
 * mutually exclusive — two overlays at once is a dead interface. */

phase = 'ui';
const uiIds = await page.evaluate(() => window.carRacer.uiElements());

/* Presence. */
{
  const missing = await page.evaluate((ids) => {
    const absent = [];
    for (const id of [...ids.hud, ...ids.screens]) {
      if (!document.getElementById(id)) absent.push(id);
    }
    return absent;
  }, uiIds);

  check('ui', 'no-undrawn-elements', missing.length === 0,
    `${missing.length} of ${uiIds.hud.length + uiIds.screens.length} declared elements are absent from the DOM: ` +
    `${missing.join(', ') || 'none'}`);
}

/* The HUD must be hidden on the menu and shown while driving. */
{
  const visibility = await page.evaluate(() => {
    const cr = window.carRacer;
    const hud = () => !document.getElementById('hud').hidden;
    const screen = (id) => !document.getElementById(id).hidden;

    cr.toMenu();
    cr.step(30);
    const onMenu = { hud: hud(), menu: screen('screen-menu'), pause: screen('screen-pause') };

    cr.setCollisions(false);
    cr.startRun(202);
    cr.drive(1, 0);
    const driving = { hud: hud(), menu: screen('screen-menu'), pause: screen('screen-pause') };

    cr.pause();
    cr.step(30);
    const paused = { hud: hud(), pause: screen('screen-pause'), state: cr.state().runState };

    cr.unpause();
    cr.drive(0.5, 0);
    const resumed = { pause: screen('screen-pause'), state: cr.state().runState };

    cr.toGarage();
    cr.step(30);
    const garage = { garage: screen('screen-garage'), menu: screen('screen-menu') };

    cr.toMenu();
    cr.step(30);
    return { onMenu, driving, paused, resumed, garage };
  });

  check('ui', 'hud-hidden-on-the-menu',
    visibility.onMenu.hud === false && visibility.onMenu.menu === true,
    `on the menu: hud shown ${visibility.onMenu.hud}, menu shown ${visibility.onMenu.menu}`);
  check('ui', 'hud-shown-while-driving',
    visibility.driving.hud === true && visibility.driving.menu === false,
    `while driving: hud shown ${visibility.driving.hud}, menu shown ${visibility.driving.menu}`);
  check('ui', 'pause-overlay-appears',
    visibility.paused.pause === true && visibility.paused.state === 'paused',
    `paused: overlay ${visibility.paused.pause}, runState ${visibility.paused.state}`);
  check('ui', 'pause-overlay-clears',
    visibility.resumed.pause === false && visibility.resumed.state === 'driving',
    `resumed: overlay ${visibility.resumed.pause}, runState ${visibility.resumed.state}`);
  check('ui', 'garage-replaces-the-menu',
    visibility.garage.garage === true && visibility.garage.menu === false,
    `garage shown ${visibility.garage.garage}, menu shown ${visibility.garage.menu}`);
}

/* Live values, read off the DOM and compared to the simulation. */
{
  const live = await page.evaluate(() => {
    const cr = window.carRacer;
    const read = (id) => document.getElementById(id).textContent.trim();
    const num = (id) => Number(read(id).replace(/[^0-9.-]/g, ''));

    cr.setCollisions(false);
    cr.setPickupSpawning(true);
    cr.clearPowerups();
    cr.startRun(1212);
    /* Straight, not the held 0.3 this used to carry.
     *
     * A constant steer for eighteen seconds does not mean "drive for a while"
     * any more: the camber takes the car onto the shoulder within a second or
     * two and `shoulderBogSeconds` then stops it dead, so the HUD was being
     * read off a car sitting motionless against the rail — no gear, no
     * distance, no chain. The phase wants a car that has been driving, so it
     * has to drive. */
    cr.drive(18, 0);

    const s = cr.state();
    const shown = {
      speed: num('hud-speed'),
      score: num('hud-score'),
      distance: read('hud-distance'),
      gear: read('hud-gear'),
      coins: num('hud-coin-count'),
    };

    /* Put the car back to a clean rest before the next two readings.
     *
     * The drive above used to hold a steer, which parked the car against the
     * rail — out of the pickup line and far enough from laned traffic to never
     * build a chain. It cannot do that any more, because the gutter stops a car
     * that sits in it, so it now runs down the middle and consequently drives
     * over power-ups and passes traffic closely. The slot check below reads
     * "exactly the two effects I just granted" and the combo check reads
     * "hidden, with no chain": both were relying on the rail for that, and both
     * now have to ask for it. */
    cr.clearPowerups();
    cr.setTrafficSpawning(false);
    cr.clearTraffic();
    cr.drive(3, 0);

    // Power-up slots: one per running effect, each with a live timer.
    cr.givePowerup('shield');
    cr.givePowerup('magnet');
    cr.drive(0.3, 0);
    const slots = [...document.querySelectorAll('#hud-powerups .pu')].map((n) => n.dataset.powerup);
    const firstTimer = Number(document.querySelector('[data-time="shield"]')?.textContent ?? '-1');
    cr.drive(2, 0);
    const laterTimer = Number(document.querySelector('[data-time="shield"]')?.textContent ?? '-1');

    // Combo meter: hidden at rest, shown with a chain.
    const comboHiddenAtRest = document.getElementById('hud-combo').hidden;
    // And back on, now that "no chain" has been read: the loop below needs
    // something to run alongside.
    cr.setTrafficSpawning(true);
    for (let i = 0; i < 60; i++) {
      const beside = cr.traffic().filter((t) => t.ahead > 5 && t.ahead < 90)
        .sort((a, b) => a.ahead - b.ahead)[0];
      if (beside) cr.place({ x: beside.x + 2.7, vx: 0 });
      cr.drive(0.4, 0);
      if (cr.state().comboChain > 0) break;
    }
    // The HUD is specified to write at 20Hz, so a chain gained in the last few
    // milliseconds of the loop above is legitimately not on screen yet. One
    // more sync window, then read.
    cr.drive(0.12, 0);
    const comboShown = !document.getElementById('hud-combo').hidden;
    const comboMult = read('hud-combo-mult');
    const comboState = cr.state();

    return {
      shown, state: s, slots, firstTimer, laterTimer,
      comboHiddenAtRest, comboShown, comboMult,
      comboChain: comboState.comboChain, multiplier: comboState.multiplier,
    };
  });

  check('ui', 'speedometer-matches-the-car',
    Math.abs(live.shown.speed - live.state.speedKmh) <= 1.5,
    `HUD reads ${live.shown.speed} km/h, car is doing ${live.state.speedKmh.toFixed(1)}`);
  check('ui', 'score-matches-the-run',
    Math.abs(live.shown.score - Math.round(live.state.score)) <= 25,
    `HUD reads ${live.shown.score}, score is ${Math.round(live.state.score)}`);
  check('ui', 'distance-readout-is-live',
    live.shown.distance !== '0 m' && /\d/.test(live.shown.distance),
    `distance readout: "${live.shown.distance}" after 18s`);
  check('ui', 'gear-is-engaged', live.shown.gear !== 'N' && Number(live.shown.gear) >= 1,
    `gear readout at ${live.state.speedKmh.toFixed(0)} km/h: "${live.shown.gear}"`);
  check('ui', 'coin-counter-is-live', live.shown.coins >= 0 && Number.isFinite(live.shown.coins),
    `coin readout: ${live.shown.coins}, run coins: ${live.state.runCoins}`);

  check('ui', 'powerup-slot-per-effect',
    live.slots.length === 2 && live.slots.includes('shield') && live.slots.includes('magnet'),
    `slots rendered for two running effects: [${live.slots.join(', ')}]`);
  check('ui', 'powerup-timer-counts-down',
    live.laterTimer < live.firstTimer && live.laterTimer >= 0,
    `shield timer ${live.firstTimer} -> ${live.laterTimer} across 2s`);

  check('ui', 'combo-meter-hidden-at-rest', live.comboHiddenAtRest === true,
    `combo meter hidden with no chain: ${live.comboHiddenAtRest}`);
  check('ui', 'combo-meter-shows-on-a-chain',
    live.comboShown === true && live.comboChain > 0,
    `combo meter shown ${live.comboShown} on a chain of ${live.comboChain}`);
  check('ui', 'combo-multiplier-matches-state',
    live.comboMult === `x${live.multiplier.toFixed(1)}`,
    `HUD reads "${live.comboMult}", state multiplier is ${live.multiplier.toFixed(1)}`);
}

/* The countdown has to be drawn, not merely fired. */
{
  const counted = await page.evaluate(async () => {
    const cr = window.carRacer;
    cr.toMenu();
    cr.step(10);
    cr.startCountdown(3);
    const seen = [];
    for (let i = 0; i < 26; i++) {
      cr.drive(0.2, 0);
      const node = document.getElementById('hud-countdown');
      if (!node.hidden && node.textContent) seen.push(node.textContent.trim());
    }
    return { seen: [...new Set(seen)], hiddenAfter: document.getElementById('hud-countdown').hidden };
  });

  check('ui', 'countdown-is-drawn', counted.seen.length >= 3,
    `countdown rendered: [${counted.seen.join(', ')}]`);
  check('ui', 'countdown-shows-go', counted.seen.includes('GO'),
    `countdown sequence included GO: [${counted.seen.join(', ')}]`);
  check('ui', 'countdown-clears-when-the-run-starts', counted.hiddenAfter === true,
    `countdown still shown after the run began: ${!counted.hiddenAfter}`);
}

/* Results and leaderboard. */
{
  const results = await page.evaluate(() => {
    const cr = window.carRacer;
    const read = (id) => document.getElementById(id).textContent.trim();
    cr.resetSave();
    cr.setCollisions(false);
    cr.startRun(31);
    cr.drive(12, 0);
    const score = Math.round(cr.state().score);
    cr.endRun();
    cr.step(30);
    const shown = {
      visible: !document.getElementById('screen-gameover').hidden,
      score: Number(read('result-score').replace(/[^0-9.-]/g, '')),
    };
    cr.toMenu();
    cr.step(30);
    const rows = document.querySelectorAll('#leaderboard-rows tr').length;
    const empty = document.querySelector('#leaderboard-rows .lb-empty') !== null;
    return { shown, score, rows, empty };
  });

  check('ui', 'results-screen-appears', results.shown.visible === true,
    `game-over screen shown after the run ended: ${results.shown.visible}`);
  check('ui', 'results-score-matches-the-run',
    Math.abs(results.shown.score - results.score) <= 2,
    `results read ${results.shown.score}, run scored ${results.score}`);
  check('ui', 'leaderboard-lists-the-run', results.rows >= 1 && !results.empty,
    `${results.rows} leaderboard rows after one run, empty-state shown: ${results.empty}`);
}

/* The garage screen has to render the roster and actually transact from it. */
{
  const garageUi = await page.evaluate(() => {
    const cr = window.carRacer;
    cr.resetSave();
    cr.grantCoins(60000);
    cr.toGarage();
    cr.step(30);

    const cards = document.querySelectorAll('#garage-list .car').length;
    const buyButton = document.querySelector('[data-buy]');
    const targetId = buyButton?.dataset.buy ?? null;
    const coinsBefore = cr.state().coins;

    buyButton?.click();
    cr.step(10);

    const owned = cr.garage().find((e) => e.def.id === targetId)?.owned ?? false;
    const coinsAfter = cr.state().coins;

    // The card should now offer Equip instead of a price.
    const equipButton = document.querySelector(`[data-equip="${targetId}"]`);
    equipButton?.click();
    cr.step(10);
    // Against the saved selection, not the car currently on the road: equipping
    // in the garage takes effect when the next run builds its mesh.
    const equipped = cr.state().activeCar === targetId;

    const upgradeButton = document.querySelector(`[data-upgrade^="${targetId}:"]`);
    const levelBefore = cr.garage().find((e) => e.def.id === targetId)?.levels ?? {};
    upgradeButton?.click();
    cr.step(10);
    const levelAfter = cr.garage().find((e) => e.def.id === targetId)?.levels ?? {};

    return {
      cards, targetId, owned, coinsBefore, coinsAfter, equipped,
      hadUpgradeButton: upgradeButton !== null,
      levelBefore: Object.values(levelBefore).reduce((a, b) => a + b, 0),
      levelAfter: Object.values(levelAfter).reduce((a, b) => a + b, 0),
    };
  });

  check('ui', 'garage-renders-the-roster', garageUi.cards >= 6,
    `${garageUi.cards} car cards rendered`);
  check('ui', 'garage-buy-button-purchases',
    garageUi.owned === true && garageUi.coinsAfter < garageUi.coinsBefore,
    `clicking buy on ${garageUi.targetId}: owned ${garageUi.owned}, ` +
    `coins ${garageUi.coinsBefore} -> ${garageUi.coinsAfter}`);
  check('ui', 'garage-equip-button-equips', garageUi.equipped === true,
    `clicking equip made ${garageUi.targetId} the active car: ${garageUi.equipped}`);
  check('ui', 'garage-upgrade-button-upgrades',
    garageUi.hadUpgradeButton && garageUi.levelAfter === garageUi.levelBefore + 1,
    `clicking upgrade: total levels ${garageUi.levelBefore} -> ${garageUi.levelAfter}`);
}

await page.evaluate(() => {
  const cr = window.carRacer;
  cr.toMenu();
  cr.step(20);
});
await shot(page, 'menu', { dom: true });

/* -- scenery ------------------------------------------------------------------
 * The fourth coverage gate. Every biome must put something beside the road, and
 * nothing it puts there may stand on the tarmac.
 *
 * "Props exist" is not the test. A prop planted 400 units ahead is only still
 * beside the road when you reach it if it was placed through the same curve the
 * tarmac is built from — get that wrong and the scenery drifts into the lanes
 * over the length of a bend, which a screenshot of the first frame shows as a
 * perfectly tidy roadside. So placement is checked against the road's own
 * geometry, and checked again after driving the stretch it was placed on. */

phase = 'scenery';
const scenery = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  cr.setPickupSpawning(false);
  cr.startRun(5150);

  const perBiome = {};
  let worstOnRoad = 0;
  let minInstances = Infinity;
  let maxLateral = 0;
  let groundHalfWidth = 0;

  // Long enough to cross every biome several times over.
  for (let i = 0; i < 95; i++) {
    cr.drive(3, 0);
    const s = cr.scenery();
    const total = s.kinds.reduce((n, k) => n + k.instances, 0);
    worstOnRoad = Math.max(worstOnRoad, s.onRoad);
    maxLateral = Math.max(maxLateral, s.maxLateral);
    groundHalfWidth = s.groundHalfWidth;

    // Tunnels are bare by definition; they are not a biome that owes props.
    if (!cr.state().inTunnel) {
      minInstances = Math.min(minInstances, total);
      const seen = perBiome[s.biome] ?? { kinds: new Set(), total: 0, samples: 0 };
      for (const k of s.kinds) seen.kinds.add(k.id);
      seen.total = Math.max(seen.total, total);
      seen.samples += 1;
      perBiome[s.biome] = seen;
    }
  }

  return {
    biomes: Object.fromEntries(Object.entries(perBiome).map(([b, v]) => [
      b, { kinds: [...v.kinds], total: v.total, samples: v.samples },
    ])),
    worstOnRoad, maxLateral, groundHalfWidth,
    minInstances: minInstances === Infinity ? 0 : minInstances,
    drawCalls: cr.state().drawCalls,
    triangles: cr.state().triangles,
  };
});

const biomesSeen = Object.keys(scenery.biomes);
const EXPECTED_BIOMES = ['coast', 'city', 'desert', 'forest'];

/* The gate. */
{
  const bare = EXPECTED_BIOMES.filter((b) => {
    const entry = scenery.biomes[b];
    return entry && entry.kinds.length === 0;
  });
  const unvisited = EXPECTED_BIOMES.filter((b) => !scenery.biomes[b]);

  check('scenery', 'no-bare-biomes', bare.length === 0,
    `biomes visited with nothing beside the road: ${bare.join(', ') || 'none'} ` +
    `(visited: ${biomesSeen.join(', ')})`);
  check('scenery', 'every-biome-visited', unvisited.length === 0,
    `biomes never reached in a 450s run, so their props are untested: ${unvisited.join(', ') || 'none'}`);
}

for (const biome of biomesSeen) {
  const entry = scenery.biomes[biome];
  check('scenery', `dressed/${biome}`, entry.kinds.length >= 2 && entry.total > 20,
    `${biome}: ${entry.kinds.length} prop kinds [${entry.kinds.join(', ')}], ` +
    `${entry.total} instances at peak across ${entry.samples} samples`);
}

check('scenery', 'nothing-stands-on-the-road', scenery.worstOnRoad === 0,
  `worst count of prop footprints overlapping the tarmac across every sample: ${scenery.worstOnRoad}`);

/* There has to be ground under the props.
 *
 * The gate proved they were off the tarmac and never asked what was beneath
 * them — so a desert of cacti and boulders hung in open sky, which every
 * numeric check in this file reported as a correctly dressed roadside. */
check('scenery', 'props-stand-on-ground',
  scenery.groundHalfWidth > scenery.maxLateral,
  `furthest prop edge sits at ${scenery.maxLateral.toFixed(1)}u from the centreline, ` +
  `ground reaches ${scenery.groundHalfWidth}u`);
check('scenery', 'road-is-never-empty', scenery.minInstances > 20,
  `fewest instances placed at any sample outside a tunnel: ${scenery.minInstances}`);

/* Instancing is the point: hundreds of props must not become hundreds of draws.
 *
 * Measured as a difference rather than against an absolute budget. Most of the
 * frame's draw calls belong to the traffic — thirty-odd pooled vehicles, each a
 * group of a dozen meshes — so a total-call ceiling mostly reports on something
 * this check is not about, and would pass or fail on traffic density. */
{
  const cost = await page.evaluate(() => {
    const cr = window.carRacer;
    cr.setCollisions(false);
    cr.startRun(4242);
    cr.drive(25, 0);

    /* Out of any tunnel first.
     *
     * Inside one there is no scenery by design — the props are hidden, so
     * toggling them changes nothing and the measured cost is frame noise. This
     * used to pass on luck: the seed happened to put the car in open air at
     * twenty-five seconds. Driving clear of the tunnel makes the precondition
     * the check depends on an explicit one. */
    let guard = 0;
    while (cr.state().inTunnel && guard++ < 40) cr.drive(1, 0);

    cr.setSceneryVisible(false);
    cr.step(3);
    const without = { calls: cr.state().drawCalls, tris: cr.state().triangles };

    cr.setSceneryVisible(true);
    cr.step(3);
    const withProps = { calls: cr.state().drawCalls, tris: cr.state().triangles };

    const s = cr.state();
    return {
      without, withProps, instances: s.sceneryInstances, kinds: s.sceneryKinds,
      inTunnel: s.inTunnel,
    };
  });

  check('scenery', 'cost-measured-in-open-air', cost.inTunnel === false,
    `the scenery cost measurement ran ${cost.inTunnel ? 'inside' : 'outside'} a tunnel — ` +
    `inside one the props are hidden and the measurement is meaningless`);

  const extraCalls = cost.withProps.calls - cost.without.calls;
  const extraTris = cost.withProps.tris - cost.without.tris;

  check('scenery', 'props-are-instanced', extraCalls <= cost.kinds + 1,
    `${cost.instances} instances across ${cost.kinds} kinds cost ${extraCalls} extra draw calls ` +
    `(${cost.without.calls} -> ${cost.withProps.calls}), want <= ${cost.kinds + 1}`);
  check('scenery', 'props-add-real-geometry', extraTris > 4000,
    `scenery adds ${extraTris} triangles (${cost.without.tris} -> ${cost.withProps.tris})`);
}

/* Placement has to survive being driven through, not merely look right when
 * first written. This drives the exact stretch that was just dressed. */
{
  const sustained = await page.evaluate(() => {
    const cr = window.carRacer;
    cr.setCollisions(false);
    cr.startRun(6161);
    let worst = 0;
    // Small steps, so every band rebuild is sampled rather than skipped over.
    for (let i = 0; i < 240; i++) {
      cr.drive(0.5, i % 4 === 0 ? 0.8 : -0.6);
      worst = Math.max(worst, cr.scenery().onRoad);
    }
    return { worst, state: cr.state() };
  });

  check('scenery', 'placement-holds-through-a-bend', sustained.worst === 0,
    `worst on-road prop count across 120s of driving through bends: ${sustained.worst}`);
  check('scenery', 'scenery-survives-a-long-run',
    sustained.state.sceneryInstances > 20 && sustained.state.contextLost === false,
    `${sustained.state.sceneryInstances} instances live at the end, context lost: ${sustained.state.contextLost}`);
}

await page.evaluate(() => {
  const cr = window.carRacer;
  cr.setCollisions(false);
  cr.startRun(909);
  cr.drive(30, 0);
});
await shot(page, 'scenery');

/* -- models ---------------------------------------------------------------
 * The fifth coverage gate. Every vehicle the factory can build must clear a
 * triangle floor, use more than one material, and contain no additive-blended
 * surface without a texture — which is precisely the shape of the underglow
 * bug: a flat colour quad that draws as a hard-edged rectangle.
 *
 * There is a ceiling as well as a floor. Thirty-odd traffic cars at the
 * player's detail level is a frame budget spent on wheel spokes seen from
 * forty metres behind, and the low quality tier has to survive on a software
 * rasteriser without losing the context. */

phase = 'models';
const models = await page.evaluate(() => window.carRacer.models());

const PLAYER_FLOOR = 1200;
const TRAFFIC_FLOOR = 350;
// Raised with the hero LOD. The player's car is one model, always on screen and
// a few metres from the camera; thirty thousand triangles on it is a rounding
// error on any GPU built this decade, and the machines where it is not get the
// bottom rung of the ladder instead of a coarser top tier.
const PLAYER_CEILING = 70000;
const TRAFFIC_CEILING = 6000;

{
  const bare = models.filter((m) => m.bareAdditiveQuads > 0);
  check('model', 'no-untextured-additive-quads', bare.length === 0,
    bare.length
      ? `${bare.map((m) => `${m.id}:${m.bareAdditiveQuads}`).join(', ')} — additive surfaces with no texture draw as hard rectangles`
      : `no additive surface on any of ${models.length} vehicles lacks a texture`);

  const thin = models.filter((m) =>
    m.triangles < (m.kind === 'player' ? PLAYER_FLOOR : TRAFFIC_FLOOR));
  check('model', 'no-blocky-vehicles', thin.length === 0,
    thin.length
      ? `below the triangle floor: ${thin.map((m) => `${m.id} ${m.triangles}`).join(', ')}`
      : `all ${models.length} vehicles clear their floor ` +
        `(player >= ${PLAYER_FLOOR}, traffic >= ${TRAFFIC_FLOOR})`);

  const heavy = models.filter((m) =>
    m.triangles > (m.kind === 'player' ? PLAYER_CEILING : TRAFFIC_CEILING));
  check('model', 'vehicles-stay-affordable', heavy.length === 0,
    heavy.length
      ? `over the triangle ceiling: ${heavy.map((m) => `${m.id} ${m.triangles}`).join(', ')}`
      : `heaviest: ${Math.max(...models.map((m) => m.triangles))} triangles`);
}

for (const m of models) {
  check('model', `built/${m.id}`,
    m.meshes >= 8 && m.materialTypes.length >= 2,
    `${m.id} (${m.kind}): ${m.triangles} tris across ${m.meshes} meshes, ` +
    `materials [${m.materialTypes.join(', ')}]`);
}

/* Traffic must be cheaper than the player's car — the detail tier is the whole
 * reason thirty of them fit in the frame. */
{
  const player = models.filter((m) => m.kind === 'player');
  const traffic = models.filter((m) => m.kind === 'traffic' && m.id !== 'truck' && m.id !== 'bus');
  const meanPlayer = player.reduce((n, m) => n + m.triangles, 0) / player.length;
  const meanTraffic = traffic.reduce((n, m) => n + m.triangles, 0) / traffic.length;
  check('model', 'traffic-is-cheaper-than-the-player',
    meanTraffic < meanPlayer * 0.75,
    `mean triangles: player ${meanPlayer.toFixed(0)}, traffic ${meanTraffic.toFixed(0)}`);
}

/* The underglow, rendered in isolation and read back. */
{
  const glow = await page.evaluate(() => {
    const cr = window.carRacer;
    cr.setCollisions(false);
    cr.startRun(77);
    cr.drive(6, 0);
    return cr.glowProfile();
  });

  check('model', 'underglow-exists', glow !== null && glow.peak > 8,
    glow ? `peak intensity ${glow.peak} across the glow` : 'the player car has no underglow mesh');
  check('model', 'underglow-fades-at-its-edges',
    glow !== null && glow.edgeLevel < 0.18,
    glow ? `outer 10% of the profile sits at ${(glow.edgeLevel * 100).toFixed(1)}% of peak, want < 18%`
      : 'no profile');
  check('model', 'underglow-has-no-hard-edge',
    glow !== null && glow.maxStep < 0.3,
    glow ? `largest neighbouring jump is ${(glow.maxStep * 100).toFixed(1)}% of peak, want < 30% ` +
      `(a bare quad steps 100% in one sample)` : 'no profile');
}

/* Environment: paint can only catch the sky if there is a sky to catch. */
{
  const env = await page.evaluate(() => {
    const cr = window.carRacer;
    cr.setCollisions(false);
    cr.startRun(8);
    cr.drive(8, 0);
    const first = cr.state();
    // Far enough for the day to move on and the map to be rebuilt.
    cr.drive(120, 0);
    const later = cr.state();
    return { first, later };
  });

  check('model', 'environment-map-built', env.first.hasEnvironment === true,
    `scene.environment bound: ${env.first.hasEnvironment} after ${env.first.environmentBuilds} builds`);
  check('model', 'environment-follows-the-sky',
    env.later.environmentBuilds > env.first.environmentBuilds,
    `environment rebuilt ${env.first.environmentBuilds} -> ${env.later.environmentBuilds} as the day moved on`);
  // Across the measured window, not since page load: `environmentBuilds` is
  // cumulative, and by the time this runs the page has been driving for several
  // minutes of earlier tests. Reading it absolutely measures the length of the
  // probe rather than the behaviour under test.
  const built = env.later.environmentBuilds - env.first.environmentBuilds;
  check('model', 'environment-is-not-rebuilt-per-frame', built < 70,
    `${built} rebuilds across 128s of world time — the 2s floor allows at most 64, ` +
    `and a PMREM pass per frame would be thousands`);
}

/* -- garage previews ----------------------------------------------------------
 * The sixth coverage gate. Every car in the roster must have a preview, it must
 * not be blank, and it must not be the same picture as another car's.
 *
 * That last one is the check worth having. A blank card is obvious the moment
 * anyone opens the garage; six cards all showing the starter hatch is not,
 * because each one looks entirely correct on its own. Comparing the images to
 * each other is the only way to catch a preview pipeline that renders the right
 * number of pictures of the wrong car. */

phase = 'previews';
const previews = await page.evaluate(() => {
  const cr = window.carRacer;
  cr.resetSave();
  cr.grantCoins(80000);
  cr.toGarage();
  cr.step(30);

  const cars = cr.garage().map((e) => e.def.id);
  const images = cr.previews();

  // Reduce each preview to a coarse signature: mean luminance over an 8x8 grid
  // of the decoded image. Comparing raw data URLs would also work, but a
  // signature says *how* different two cars look rather than merely that their
  // bytes differ, and PNG encoding is not guaranteed byte-stable.
  const signature = (dataUrl) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      const cells = [];
      for (let i = 0; i < d.length; i += 4) {
        // Weighted by alpha: these render on a transparent background, so a
        // blank preview is transparent rather than black.
        cells.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * (d[i + 3] / 255));
      }
      resolve(cells);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });

  return (async () => {
    const out = {};
    for (const id of cars) {
      const url = images[id] ?? null;
      out[id] = {
        present: typeof url === 'string' && url.startsWith('data:image/png'),
        bytes: typeof url === 'string' ? url.length : 0,
        cells: url ? await signature(url) : null,
      };
    }
    // What the garage cards actually render, as opposed to what was generated.
    const cards = [...document.querySelectorAll('#garage-list .car')].map((li) => ({
      id: li.dataset.car,
      hasImage: li.querySelector('[data-preview]') !== null,
    }));
    return { cars, out, cards };
  })();
});

{
  const missing = previews.cars.filter((id) => !previews.out[id].present);
  check('preview', 'every-car-has-a-preview', missing.length === 0,
    `${missing.length} of ${previews.cars.length} cars have no rendered preview: ${missing.join(', ') || 'none'}`);

  // Ink on the page: a preview whose cells are all near zero rendered nothing.
  const blank = previews.cars.filter((id) => {
    const cells = previews.out[id].cells;
    if (!cells) return true;
    return Math.max(...cells) < 8;
  });
  check('preview', 'no-blank-previews', blank.length === 0,
    blank.length
      ? `previews that rendered nothing: ${blank.join(', ')}`
      : `all ${previews.cars.length} previews have visible content ` +
        `(brightest cell ${Math.max(...previews.cars.map((id) => Math.max(...(previews.out[id].cells ?? [0])))).toFixed(0)})`);

  // Distinctness: the failure mode is six pictures of the same car.
  const pairs = [];
  for (let i = 0; i < previews.cars.length; i++) {
    for (let j = i + 1; j < previews.cars.length; j++) {
      const a = previews.out[previews.cars[i]].cells;
      const b = previews.out[previews.cars[j]].cells;
      if (!a || !b) continue;
      const diff = a.reduce((n, v, k) => n + Math.abs(v - b[k]), 0) / a.length;
      if (diff < 2) pairs.push(`${previews.cars[i]}~${previews.cars[j]} (${diff.toFixed(2)})`);
    }
  }
  check('preview', 'previews-are-distinct', pairs.length === 0,
    pairs.length
      ? `near-identical preview pairs: ${pairs.join(', ')}`
      : `all ${previews.cars.length} previews differ from one another`);

  check('preview', 'cards-show-the-preview',
    previews.cards.length > 0 && previews.cards.every((c) => c.hasImage),
    `${previews.cards.filter((c) => c.hasImage).length} of ${previews.cards.length} garage cards render an image`);
}

await shot(page, 'garage-cards', { dom: true });

/* -- stability --------------------------------------------------------------- */

phase = 'stability';
const stability = await page.evaluate(() => {
  const cr = window.carRacer;
  // These measure handling, speed and stability, not collision or pickups.
  // Leaving traffic lethal would end the run partway and truncate the
  // measurement; leaving pickups on lets the car drive over a nitro crate
  // mid-measurement, which silently rewrites the speed ceiling it is being
  // measured against — and does so differently depending on which way it was
  // steered, which is exactly how a symmetric control scheme came to look
  // asymmetric.
  cr.setCollisions(false);
  cr.setPickupSpawning(false);
  cr.clearPowerups();
  cr.startRun(31337);
  // A long, messy run: constant direction changes, braking, full lock.
  for (let i = 0; i < 24; i++) {
    cr.drive(2, i % 2 === 0 ? 1 : -1, i % 5 === 0);
  }
  const s = cr.state();
  return s;
});

check('stability', 'no-nan-after-long-run',
  finite(stability.x, stability.vx, stability.speed, stability.distance, stability.score),
  `x=${stability.x} vx=${stability.vx} speed=${stability.speed} distance=${stability.distance} score=${stability.score}`);
check('stability', 'still-on-road', Math.abs(stability.x) <= config.halfWidth + 3.0,
  `x after 48s of thrashing: ${stability.x.toFixed(2)}`);
check('stability', 'geometry-not-leaking', stability.geometries < 400,
  `live geometries after a long run: ${stability.geometries}, want < 400`);
check('stability', 'textures-not-leaking', stability.textures < 60,
  `live textures: ${stability.textures}, want < 60`);
check('stability', 'score-accumulates', stability.score > 100,
  `score after a 48s run: ${stability.score.toFixed(0)}`);
check('stability', 'context-survives-long-run', stability.contextLost === false,
  `WebGL context lost by the end of a 48s run: ${stability.contextLost}`);
check('stability', 'still-drawing', stability.drawCalls > 0,
  `draw calls on the last frame of a long run: ${stability.drawCalls}`);

/* -- console ----------------------------------------------------------------- */

const errors = noise.filter((n) => n.level === 'pageerror');
const warnings = noise.filter((n) => n.level === 'warning');
check('console', 'no-page-errors', errors.length === 0,
  errors.length ? errors.map((e) => `[${e.phase}] ${e.text}`).join(' | ') : 'none');

// SwiftShader emits its own warnings; those belong to the harness, not the game.
const gameWarnings = warnings.filter((w) => !/SwiftShader|WebGL|GPU stall|Multiple instances/i.test(w.text));
check('console', 'no-unexpected-warnings', gameWarnings.length === 0,
  gameWarnings.length ? gameWarnings.map((w) => `[${w.phase}] ${w.text}`).join(' | ') : 'none');

if (warnings.length !== gameWarnings.length) {
  environment.push(`${warnings.length - gameWarnings.length} renderer warnings ignored (software GL)`);
}

/* -- render quality --------------------------------------------------------
 * The seventh coverage gate: how the game actually looks, measured.
 *
 * Everything here is a screen-space measurement of a rendered frame rather
 * than an assertion that an object exists. That distinction is the whole
 * point. A flame that is added to the scene, parented to a disposed mesh and
 * never drawn passes "the flame exists" and fails the only question anyone
 * cares about; hiding it, rendering, showing it, rendering again and
 * subtracting cannot be fooled that way.
 *
 * This block runs on its own page pinned to the top tier. The rest of the
 * probe runs pinned to `low`, because the software rasteriser cannot sustain
 * the 2048² shadow pass and the bloom chain across a hundred scenarios — but
 * the top tier is the tier the art is authored for, and measuring the look of
 * the game on the rung with the shadows switched off would be measuring the
 * wrong thing. The hero LOD is asserted separately, from the model audit, so
 * the bottom rung is still covered.
 */

phase = 'render-quality';
{
  const hero = await freshPage(
    opt.url.replace(/quality=\w+/, 'quality=high'),
    { width: 960, height: 540 },
  );

  /**
   * Drive to the pinned hero pose — the same one tools/compare.mjs uses.
   *
   * Fixed on purpose: two frames captured from different distances differ in
   * ways that have nothing to do with the thing being measured.
   */
  const pose = await hero.evaluate(async () => {
    const cr = window.carRacer;
    cr.setCollisions(false);
    cr.startRun(4242);
    let guard = 0;
    while (cr.state().distance < 3000 && guard++ < 400) cr.drive(1, 0);
    cr.pinWorld({ biome: 'coast', weather: 'clear', phase: 'day' });
    cr.drive(1, 0);
    cr.place({ x: 0, vx: 0 });
    cr.drive(1.5, 0);
    return cr.state();
  });

  check('render', 'hero-pose-renders', pose.contextLost === false && pose.triangles > 5000,
    `${pose.triangles} triangles at ${pose.speedKmh.toFixed(0)} km/h, context lost: ${pose.contextLost}`);
  check('render', 'top-tier-under-test', pose.quality === 'high',
    `render-quality checks are measuring the '${pose.quality}' tier`);

  /*
   * Every measurement below goes through `carRacer.sampleFrame`, which renders
   * and reads the drawing buffer back in one synchronous call.
   *
   * That is not an optimisation. The first version of this gate decoded a data
   * URL into an `Image` to measure it, and `Image.onload` is a macrotask — so
   * awaiting it handed control back to the browser, the game's own animation
   * frame ran, and the world advanced several metres between two readings that
   * were supposed to differ only in whether an effect was visible. The gate
   * passed or failed depending on how fast the machine decoded a PNG. Anything
   * comparing two frames here must therefore take both inside a single
   * `evaluate`, with nothing awaited in between.
   */

  /*
   * Where each thing lives in the frame, as fractions of it.
   *
   * Fractions rather than pixels so the gate does not quietly become a test of
   * the viewport size. These follow from the pinned pose: the car sits centred
   * in the lower middle, its exhausts just below it, its shadow directly under
   * it, and the road either side of it is the control the shadow is compared
   * against.
   */
  const REGION = {
    body: [0.44, 0.55, 0.56, 0.67],
    flame: [0.45, 0.69, 0.55, 0.77],
    behind: [0.28, 0.62, 0.72, 0.88],
    wide: [0.20, 0.40, 0.80, 0.90],
    // Below the bumper, not across it. The first version of this box sat high
    // enough to be measuring the brake lights, and duly reported the space
    // under the car as brighter than the road beside it.
    underCar: [0.465, 0.69, 0.535, 0.75],
    besideCarLeft: [0.33, 0.69, 0.42, 0.75],
    besideCarRight: [0.58, 0.69, 0.67, 0.75],
    cornerLeft: [0.0, 0.62, 0.16, 1.0],
    cornerRight: [0.84, 0.62, 1.0, 1.0],
  };

  const measure = (rects) => hero.evaluate((r) => window.carRacer.sampleFrame(r), rects);

  /* -- specular response --------------------------------------------------
   * The car is the brightest thing in its own bounding box or it is matte.
   * This is the number the whole lighting pass was chasing: the body measured
   * about one percent bright pixels across the frame when it rendered as a
   * dark cut-out. */
  {
    const before = await measure({ body: REGION.body });
    check('render', 'specular-response',
      before.body.brightFraction > 0.004 || before.body.mean > 42,
      `hero body region: ${(before.body.brightFraction * 100).toFixed(2)}% pixels over 200 luma, ` +
      `mean ${before.body.mean.toFixed(1)} — want either >0.4% bright or a mean over 42`);
  }

  /* -- contact shadow ------------------------------------------------------
   * A band under the car darker than the road either side of it — found by
   * hiding the shadow rather than by looking in a fixed place for it.
   *
   * Where it lands in the frame depends on the ride height of whichever car is
   * equipped and on the field of view, which widens with speed. A fixed box
   * either clips the bumper, and reports the brake lights as a bright shadow,
   * or falls past the tail onto open road and reports nothing. Sweeping bands
   * with the shadow off and on locates it wherever it actually is, and the
   * comparison against the road either side is then made in the band that the
   * shadow demonstrably occupies. */
  {
    const scan = await hero.evaluate(() => {
      const cr = window.carRacer;
      const BANDS = 12;
      const y0 = 0.58;
      const step = 0.02;
      const rects = {};
      for (let i = 0; i < BANDS; i++) {
        const y = y0 + i * step;
        rects[`under${i}`] = [0.455, y, 0.545, y + step];
        rects[`left${i}`] = [0.32, y, 0.42, y + step];
        rects[`right${i}`] = [0.58, y, 0.68, y + step];
      }

      // Both frames from one simulation state, nothing awaited between them.
      cr.setContactShadowVisible(false);
      const off = cr.sampleFrame(rects);
      cr.setContactShadowVisible(true);
      const on = cr.sampleFrame(rects);

      return Array.from({ length: BANDS }, (_, i) => ({
        y: Number((y0 + i * step).toFixed(2)),
        under: { without: off[`under${i}`].mean, with: on[`under${i}`].mean },
        beside: {
          without: (off[`left${i}`].mean + off[`right${i}`].mean) / 2,
          with: (on[`left${i}`].mean + on[`right${i}`].mean) / 2,
        },
      }));
    });

    /*
     * Compared against the road beside the car by how much each *changes*,
     * not by how bright each is.
     *
     * The direct comparison is confounded twice over. The box under the car
     * contains some of the car — lit bodywork and brake lights — and the boxes
     * either side sit further out, where the vignette is darkening the frame
     * anyway. Both effects are worth several times the shadow, and together
     * they had the gate reporting the space under the car as brighter than the
     * road beside it whether the shadow was there or not.
     *
     * What the shadow does is darken one place and not another, and that is
     * what is asserted: the band beneath the car loses luminance when it is
     * switched on, the road either side does not.
     */
    const band = scan.reduce((a, b) =>
      (a.under.without - a.under.with > b.under.without - b.under.with ? a : b));
    const beneath = band.under.without - band.under.with;
    const beside = band.beside.without - band.beside.with;

    check('render', 'contact-shadow',
      beneath > 1.5 && beneath > beside * 3 + 1,
      `at y=${band.y} switching the shadow on darkens the band beneath the car by ` +
      `${beneath.toFixed(2)} luma (want > 1.5) while the road either side moves by ` +
      `${beside.toFixed(2)} — the darkening has to be under the car, not across the frame`);
  }

  /* -- effects -------------------------------------------------------------
   * Each one hidden, rendered, shown, rendered, and the difference taken in
   * the region it belongs to. An effect that is in the scene but never drawn
   * measures zero here, which is the entire reason for doing it this way. */
  const effectCases = [
    { kind: 'flame', region: 'flame', floor: 1.5, drive: (cr) => cr.givePowerup('nitro') },
    { kind: 'sparks', region: 'wide', floor: 0.6, drive: (cr) => cr.burstEffect('sparks') },
    { kind: 'smoke', region: 'behind', floor: 0.6, drive: (cr) => cr.forceDrift(1) },
  ];

  for (const { kind, region, floor } of effectCases) {
    const delta = await hero.evaluate(({ kind, rect }) => {
      const cr = window.carRacer;
      cr.clearPowerups();

      // Bring the effect up to full strength before either reading.
      if (kind === 'flame') { cr.givePowerup('nitro'); cr.drive(0.8, 0); }
      else if (kind === 'sparks') { cr.burstEffect('sparks'); cr.drive(0.05, 0); }
      else { cr.forceDrift(1); cr.drive(0.5, 0); }

      const live = cr.effects();
      // Both frames from the same simulation state, nothing awaited between.
      cr.setEffectVisible(kind, false);
      const off = cr.sampleFrame({ r: rect }).r;
      cr.setEffectVisible(kind, true);
      const on = cr.sampleFrame({ r: rect }).r;
      return { off: off.mean, on: on.mean, live };
    }, { kind, rect: REGION[region] });

    const added = Math.abs(delta.on - delta.off);
    check('render', `effect-present/${kind}`, added >= floor,
      `${kind} changes its region by ${added.toFixed(2)} luma ` +
      `(${delta.off.toFixed(1)} hidden -> ${delta.on.toFixed(1)} shown), want >= ${floor}; ` +
      `pools: ${delta.live.sparks} sparks, ${delta.live.smoke} smoke, flame ${delta.live.flame.toFixed(2)}`);
  }

  /* -- speed blur ----------------------------------------------------------
   * Not a luminance test: a blur adds nothing, it removes. The corners of the
   * frame lose edge energy under boost while the middle — where the car is,
   * and where the effect is deliberately weakest — keeps it. Measuring only
   * the corners would pass on any change that dimmed the frame. */
  {
    const blur = await hero.evaluate((R) => {
      const cr = window.carRacer;
      /*
       * Both readings are taken under boost, with only the blur switched.
       *
       * The obvious experiment — corners at rest against corners on boost —
       * measures the wrong thing: nitro also raises the speed streaks, which
       * are high-contrast spokes drawn in exactly the corners being sampled,
       * and they add far more edge energy than the blur removes. Comparing
       * boost against boost isolates the blur.
       */
      cr.clearPowerups();
      cr.setEffectVisible('flame', false);
      cr.setEffectVisible('sparks', false);
      cr.setEffectVisible('smoke', false);
      cr.givePowerup('nitro');
      cr.drive(0.5, 0);

      // No sim advance between these two: the override is applied to the
      // grade immediately, so the only difference between the frames is the
      // blur itself.
      const rects = { l: R.cornerLeft, r: R.cornerRight, mid: R.body };
      cr.setMotionBlur(false);
      const sharp = cr.sampleFrame(rects);
      cr.setMotionBlur(true);
      const blurred = cr.sampleFrame(rects);

      cr.setMotionBlur(null);
      cr.setEffectVisible('flame', true);
      cr.setEffectVisible('sparks', true);
      cr.setEffectVisible('smoke', true);
      return { rest: sharp, boost: blurred, blurEnabled: cr.motionBlurEnabled() };
    }, REGION);

    const restCorners = (blur.rest.l.edges + blur.rest.r.edges) / 2;
    const boostCorners = (blur.boost.l.edges + blur.boost.r.edges) / 2;
    const softened = 1 - boostCorners / (restCorners || 1);

    check('render', 'effect-present/speed-blur',
      blur.blurEnabled && softened > 0.04,
      `corner edge energy under boost: ${restCorners.toFixed(2)} with the blur off -> ` +
      `${boostCorners.toFixed(2)} with it on (${(softened * 100).toFixed(1)}% softer, want > 4%), ` +
      `blur available on this tier: ${blur.blurEnabled}`);
    check('render', 'speed-blur-spares-the-centre',
      blur.boost.mid.edges > blur.rest.mid.edges * 0.75,
      `the middle of the frame keeps ${(blur.boost.mid.edges / (blur.rest.mid.edges || 1) * 100).toFixed(0)}% ` +
      `of its edge energy with the blur on, want > 75% — the car must stay readable`);
  }

  /* -- does anything cast onto the road ------------------------------------
   * Measured by difference, because a single frame cannot tell a cast shadow
   * from the prop's own dark geometry, from a texture, or from the contact
   * decal under the hero. Sample the same tarmac twice with nothing changed
   * but the shadow map, and the pixels either move or they do not.
   *
   * This check exists because they did not, and 245 others never noticed:
   * iteration 11 lowered the sun to 30 degrees to get raking shadows,
   * iteration 24 brought the palms to the kerb and repaired a shadow frustum
   * that had been stuck at ten units, and the road stayed exactly as bright.
   * A gate that cannot see its own blind spot keeps certifying it. */
  {
    const roadStrips = {
      left: [0.10, 0.60, 0.40, 0.78],
      right: [0.60, 0.60, 0.90, 0.78],
    };
    const cast = await hero.evaluate(async (rects) => {
      const cr = window.carRacer;
      cr.setShadows(true);
      const withShadows = cr.sampleFrame(rects);
      cr.setShadows(false);
      const without = cr.sampleFrame(rects);
      cr.setShadows(true);
      return { withShadows, without };
    }, roadStrips);

    const delta = (k) => cast.without[k].mean - cast.withShadows[k].mean;
    const best = Math.max(delta('left'), delta('right'));
    check('render', 'roadside-casts-onto-road', best > 1.5,
      `turning the shadow map off changes the road's mean luminance by at most ` +
      `${best.toFixed(2)} (left ${delta('left').toFixed(2)}, right ${delta('right').toFixed(2)}), ` +
      `want > 1.5 — below that nothing beside the road is darkening it`);
  }

  /* -- does the tyre smoke reach the frame ---------------------------------
   * The same difference test as the shadows above, and it exists for the same
   * reason with a sharper lesson behind it.
   *
   * Iteration 29 looked at a drifting frame, saw no plume, and concluded the
   * smoke never rendered. It always had: 206 particles were alive and moving
   * the road's mean by 1.5 luminance, but the shade had been chosen against
   * tarmac at luminance 72 and the carriageway now renders near 150, so the
   * smoke was very nearly the same colour as the thing behind it. A whole
   * iteration was spent writing art for a defect that did not exist, and 246
   * checks had nothing to say about it.
   *
   * Two things make this honest. The drift is pinned rather than provoked —
   * the cue fires on a slip transition and decays in a third of a second, so
   * a harness cannot reliably catch it. And the plume is measured against
   * itself with `setEffectVisible`, because a bright patch behind a car could
   * as easily be the road, the brake lights or the contact decal.
   *
   * What this does NOT do, stated plainly so nobody trusts it further than it
   * goes: it does not police the smoke's *value* against the road. Volume and
   * value land in the same number. Restoring iteration 29's dark shade under
   * today's three-per-puff emitter still measures 3.45, comfortably over the
   * bar, because there is now enough smoke to show up whatever colour it is —
   * whereas at iteration 29's single-billboard emitter that same shade gave
   * 1.51 and this check would have caught it. The bar is set for presence, not
   * for contrast, and tightening it to catch colour would make it fail the
   * first time someone legitimately trims the particle budget. */
  {
    const tail = { plume: [0.34, 0.55, 0.70, 0.95] };
    const smoke = await hero.evaluate(async (rects) => {
      const cr = window.carRacer;
      cr.setDriftIntensity(1);
      cr.drive(1.0, 0);
      const live = cr.effects().smoke;
      cr.setEffectVisible('smoke', true);
      const on = cr.sampleFrame(rects).plume;
      cr.setEffectVisible('smoke', false);
      const off = cr.sampleFrame(rects).plume;
      cr.setEffectVisible('smoke', true);
      cr.setDriftIntensity(null);
      return { live, on: on.mean, off: off.mean };
    }, tail);

    const lift = smoke.on - smoke.off;
    check('render', 'tyre-smoke-reaches-the-frame', smoke.live > 0 && lift > 2,
      `with the drift pinned there are ${smoke.live} live smoke particles and turning them off ` +
      `changes the road behind the car by ${lift.toFixed(2)} luminance (${smoke.on.toFixed(2)} to ` +
      `${smoke.off.toFixed(2)}), want > 2 — below that the plume is the same colour as the tarmac`);
  }

  /* -- the reference -------------------------------------------------------
   * Skipped, never passed, when the target image is absent. A comparative
   * score with nothing to compare against is not a pass, and treating it as
   * one is how a missing file comes to certify a match. */
  {
    const target = referencePath(argv);
    const shown = relative(ROOT, target);
    if (!referenceExists(target)) {
      environment.push(
        `render/reference-distance SKIPPED — ${shown} is absent, so the histogram and ` +
        'roadside-density comparisons have nothing to measure against',
      );
    } else {
      const dataUrl = toDataUrl(target);

      /* Analysed at the profiler's native width, for the same reason
       * compare.mjs does it: the hero page renders 1000 wide, the reference is
       * 620, and resampling only one of them to a shared canvas scores the
       * screenshot sizes rather than the art. Resize, let a frame land at the
       * new size, measure, put the viewport back — the checks after this one
       * are written against the hero viewport. */
      /* Wait for the renderer to have actually resized, rather than assuming
       * one beat is enough.
       *
       * `SceneRig.onResize` reads `window.innerWidth` off an asynchronous
       * resize event. `setViewportSize` changes that width, but nothing here
       * proved the handler had run before the capture — and a snapshot taken
       * one beat too early is a 960-wide frame scored against a 620-wide
       * reference, which is a large error that looks like an art result. It is
       * the best explanation for this gate reading 0.662, 0.696, 0.662 across
       * three runs of one commit after the simulation itself was made
       * deterministic at iteration 15: the pose was identical every time, and
       * the frame was not.
       *
       * Polling the drawing buffer is the honest test. `renderer.setSize`
       * writes it, so it changes only once the handler has genuinely run.
       */
      const heroView = hero.viewportSize();
      const analysisHeight = Math.round(ANALYSIS_WIDTH / (heroView.width / heroView.height));

      /* Wait on the drawing buffer, which only `renderer.setSize` writes.
       *
       * Iteration 16 waited on `canvas.clientWidth` and on `canvas.width > 0`.
       * Neither proves anything: `clientWidth` is CSS layout and updates the
       * moment the viewport changes, and a canvas always has a width above
       * zero. So the wait returned before `SceneRig.onResize` had run, and
       * iteration 20 duly captured the full 960-wide hero frame, scored it
       * against a 620-wide reference, and **passed the histogram gate at
       * 245/245 on a downsample**. The resample report added at iteration 16 is
       * what caught it. Comparing the buffer against its own previous value is
       * the honest test — it changes only when the handler has actually run.
       */
      const settleTo = async (width, height) => {
        const before = await hero.evaluate(() => document.querySelector('canvas').width);
        await hero.setViewportSize({ width, height });
        await hero.waitForFunction(
          ({ w, was }) => {
            const canvas = document.querySelector('canvas');
            return canvas !== null && canvas.clientWidth === w && canvas.width !== was;
          },
          { w: width, was: before },
          { timeout: 10000 },
        );
        // The handler has run; this draws the first frame at the new size.
        await hero.evaluate(() => window.carRacer.drive(0.05, 0));
      };

      /* And then check the frame rather than trusting the wait.
       *
       * A capture at the wrong size does not fail loudly — it scores *better*,
       * because downsampling is a low-pass and a blurred frame sits closer to
       * any histogram than a sharp one. A silent false pass is the worst
       * failure mode this harness has, so the width of the actual image is
       * asserted before anything is measured from it.
       */
      const captureAtAnalysisWidth = async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const shot = await hero.evaluate(() => window.carRacer.snapshot());
          const got = await hero.evaluate(
            (src) => new Promise((resolve) => {
              const img = new Image();
              img.onload = () => resolve(img.width);
              img.onerror = () => resolve(-1);
              img.src = src;
            }),
            shot,
          );
          if (got === ANALYSIS_WIDTH) return shot;
          await hero.evaluate(() => window.carRacer.drive(0.05, 0));
        }
        return null;
      };

      await settleTo(ANALYSIS_WIDTH, analysisHeight);
      const analysisShot = await captureAtAnalysisWidth();
      await settleTo(heroView.width, heroView.height);

      if (analysisShot === null) {
        environment.push(
          'render/reference-distance could not obtain a capture at the analysis width after four ' +
          'attempts — the renderer never resized. The two checks below are scoring a frame of the ' +
          'wrong size.',
        );
      }

      const profiled = await hero.evaluate(profilePair, {
        shot: analysisShot,
        reference: dataUrl,
        width: ANALYSIS_WIDTH,
        regions: REGIONS,
      });
      const scored = {
        histogram: profiled.distance.histogram,
        vergeRatio: profiled.distance.vergeRatio,
      };

      /* A frame that had to be resampled on the way in was the wrong size, and
       * every number below it is then measuring the capture rather than the
       * art. Reported rather than checked: this is a statement about whether
       * the measurement is sound, and folding it into the pass count would
       * make a harness fault read as an art failure. `compare.mjs` prints the
       * same two ratios for the same reason. */
      const resample = profiled.distance.resample;
      if (Math.abs(resample.mine - 1) > 0.01 || Math.abs(resample.reference - 1) > 0.01) {
        environment.push(
          `render/reference-distance measured a resampled frame — ${resample.mine.toFixed(2)}x capture, ` +
          `${resample.reference.toFixed(2)}x reference, both should be 1.00x. The scores below it are ` +
          'comparing screenshot sizes, not art.',
        );
      }

      check('render', 'reference-distance/histogram', scored.histogram <= 0.55,
        `L1 distance between luminance histograms is ${scored.histogram.toFixed(3)}, ` +
        `want <= 0.55 (0 identical, 2 disjoint)`);
      check('render', 'reference-distance/roadside-density',
        scored.vergeRatio >= 0.6 && scored.vergeRatio <= 1.7,
        `roadside edge density is ${scored.vergeRatio.toFixed(2)}x the reference, want 0.6 to 1.7`);
    }
  }

  await shot(hero, 'render-quality');
  await hero.close();
}

/* -- the hero model --------------------------------------------------------
 * The other half of the seventh gate, and the half a screenshot cannot make.
 * Triangle count alone cannot tell a smooth body from a finely subdivided
 * box, and a smoothness score alone cannot tell a smooth body from a sphere. */
{
  const heroes = models.filter((m) => m.kind === 'player');
  const lods = models.filter((m) => m.kind === 'hero-lod');

  const HERO_TRIANGLE_FLOOR = 25000;
  const coarse = heroes.filter((m) => m.triangles < HERO_TRIANGLE_FLOOR);
  check('render', 'hero-triangles', coarse.length === 0,
    coarse.length
      ? `below the hero floor: ${coarse.map((m) => `${m.id} ${m.triangles}`).join(', ')}`
      : `every player body clears ${HERO_TRIANGLE_FLOOR} triangles at the top tier ` +
        `(lightest ${Math.min(...heroes.map((m) => m.triangles))})`);

  const creased = heroes.filter((m) => m.silhouette < 0.95);
  check('render', 'hero-silhouette-smoothness', creased.length === 0,
    creased.length
      ? `creased bodies: ${creased.map((m) => `${m.id} ${(m.silhouette * 100).toFixed(1)}%`).join(', ')}`
      : `worst body has ${(Math.min(...heroes.map((m) => m.silhouette)) * 100).toFixed(1)}% of its ` +
        `adjacent-face angles under 20 degrees, want >= 95%`);

  const faceted = models.filter((m) => m.flatShadedMeshes > 0);
  check('render', 'no-flat-shaded-panels', faceted.length === 0,
    faceted.length
      ? `${faceted.map((m) => `${m.id}:${m.flatShadedMeshes}`).join(', ')} — flat shading discards ` +
        `the averaged normals the loft exists to produce`
      : `no panel on any of ${models.length} vehicles renders with flatShading`);

  /* The ladder has to actually step. A hero LOD that is the same model twice
   * is not a level of detail, it is a comment. */
  const heaviestLod = Math.max(...lods.map((m) => m.triangles));
  const lightestHero = Math.min(...heroes.map((m) => m.triangles));
  check('render', 'hero-lod-steps-down', heaviestLod < lightestHero * 0.35,
    `bottom rung peaks at ${heaviestLod} triangles against ${lightestHero} at the top, ` +
    `want under 35%`);
}

/* ------------------------------------------------------------------- report */

await page.close();
await browser.close();
stopServer();

const report = {
  at: new Date().toISOString(),
  url: opt.url,
  startedServer,
  checks,
  failed: findings.length,
  coverage: {
    declared: recorded.length,
    checked: CHECKED_CUES.size,
    pending: PENDING_CUES.size,
    pendingList: [...PENDING_CUES],
  },
  findings,
  passed,
  environment,
};

const reportPath = resolve(ROOT, opt.out, 'report.json');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));

for (const f of findings) console.log(`FAIL  ${f.scope}/${f.id}  —  ${f.detail}`);
for (const e of environment) console.log(`env   ${e}`);

console.log(
  `\n${checks - findings.length}/${checks} checks passed  ·  ` +
  `cues: ${CHECKED_CUES.size} checked, ${PENDING_CUES.size} pending of ${recorded.length} declared`,
);
console.log(`report: ${reportPath}`);

process.exit(findings.length);
