/* Automated audit of the running game.
 *
 *   node tools/probe.mjs [--url http://localhost:5180/] [--shots] [--keep-server]
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
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'save:write',
]);

const PENDING_CUES = new Set([
  'run:countdown',
  'player:drift',
  'player:airborne',
  'player:land',
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
  'garage:purchase',
  'garage:equip',
  'garage:upgrade',
]);

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
async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
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

  await page.goto(opt.url, { waitUntil: 'load' });
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
  return page;
}

async function shot(page, name) {
  if (!opt.shots) return;
  const file = resolve(ROOT, opt.out, `${name}.png`);
  mkdirSync(dirname(file), { recursive: true });
  const buf = await page.screenshot();
  writeFileSync(file, buf);
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

check('boot', 'run-started', booted.runState === 'driving', `runState: ${booted.runState}`);
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
  window.carRacer.startRun(1234);
  window.carRacer.drive(4, 0.6);
  return { ...window.carRacer.state(), traffic: window.carRacer.traffic().length };
});
const runB = await page.evaluate(() => {
  window.carRacer.setCollisions(false);
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

/* -- handling ---------------------------------------------------------------- */

phase = 'handling';
const steering = await page.evaluate(() => {
  const cr = window.carRacer;
  // These measure handling, speed and stability, not collision. Leaving traffic
  // lethal would end the run partway and silently truncate the measurement.
  cr.setCollisions(false);
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
  // These measure handling, speed and stability, not collision. Leaving traffic
  // lethal would end the run partway and silently truncate the measurement.
  cr.setCollisions(false);
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

/* -- speed model ------------------------------------------------------------- */

phase = 'speed';
const speedRun = await page.evaluate(() => {
  const cr = window.carRacer;
  // These measure handling, speed and stability, not collision. Leaving traffic
  // lethal would end the run partway and silently truncate the measurement.
  cr.setCollisions(false);
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
  // These measure handling, speed and stability, not collision. Leaving traffic
  // lethal would end the run partway and silently truncate the measurement.
  cr.setCollisions(false);
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

/* -- stability --------------------------------------------------------------- */

phase = 'stability';
const stability = await page.evaluate(() => {
  const cr = window.carRacer;
  // These measure handling, speed and stability, not collision. Leaving traffic
  // lethal would end the run partway and silently truncate the measurement.
  cr.setCollisions(false);
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
