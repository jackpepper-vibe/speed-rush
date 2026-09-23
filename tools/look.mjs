/* Look at the game: capture posed frames on the real GPU.
 *
 *   node tools/look.mjs [--url http://127.0.0.1:5180/?quality=high]
 *                       [--scenes conditions,cars,traffic] [--out shots/look]
 *                       [--size 1280x720]
 *
 * Needs a running server (`npm run dev`, or `vite preview` for a production
 * build). Writes one PNG per frame and a contact sheet per scene to `--out`,
 * and prints the draw calls and triangles each frame cost.
 *
 * The probe answers "does it work"; this answers "does it look right", and the
 * only instrument for that is a person (or an agent) looking at the frames. It
 * deliberately measures nothing about the image. A histogram distance to a
 * reference screenshot can be driven down by changes nobody would call an
 * improvement, and was.
 *
 * Headless Chromium draws WebGL on SwiftShader unless told otherwise, and
 * SwiftShader is not what a player sees: it is slow enough that the game drops
 * to its bottom tier, and its sampling differs. These flags put the page on
 * the machine's GPU through ANGLE, so the frames are the frames a player gets.
 *
 * Scenes:
 *   conditions  the chase view in every biome, phase and weather worth checking
 *   cars        every player car from behind and ahead, in the live scene
 *   traffic     one of each traffic vehicle on the road ahead
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Claude/Tools/shot/');
const { chromium } = require('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const opt = { url: 'http://127.0.0.1:5180/?quality=high', scenes: 'conditions,cars,traffic', out: 'shots/look', size: '1280x720' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, '');
  if (!(key in opt)) throw new Error(`unknown option --${key}`);
  opt[key] = argv[++i];
}
const [W, H] = opt.size.split('x').map(Number);
const outDir = resolve(ROOT, opt.out);
mkdirSync(outDir, { recursive: true });

const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];

/** Chase-view conditions: biome/weather/phase. */
const CONDITIONS = [
  'coast/clear/day', 'coast/clear/dusk', 'coast/clear/night', 'coast/rain/day',
  'city/clear/day', 'city/clear/night', 'desert/clear/day', 'forest/clear/day',
];

/** Camera offsets from the car for the line-up: [position], [look at], fov. */
const CAR_VIEWS = {
  rear: [[3.0, 1.45, 5.8], [0, 0.62, 0.2], 34],
  front: [[-3.6, 1.35, -6.0], [0, 0.6, -0.2], 34],
};

const TRAFFIC = [['sedan', 1, 16, 0.1], ['coupe', 3, 20, 0.3], ['suv', 0, 30, 0.5], ['van', 2, 34, 0.7], ['truck', 4, 42, 0.2], ['bus', 1, 58, 0.4]];

const browser = await chromium.launch({ args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(opt.url, { waitUntil: 'load' });
await page.waitForFunction('window.carRacer !== undefined', null, { timeout: 60000 });

const renderer = await page.evaluate(() => {
  const gl = window.carRacer.game.rig.renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
console.log(`renderer: ${renderer}`);
if (/swiftshader/i.test(renderer)) console.log('warning: software rendering — these frames are not what a player sees');

/** Drive a fresh run far enough in that every band of scenery is populated. */
async function settle() {
  await page.evaluate(() => {
    const cr = window.carRacer;
    cr.setAutoAdvance(false);
    cr.setCollisions(false);
    cr.startRun(4242);
    let guard = 0;
    while (cr.state().distance < 3000 && guard++ < 400) cr.drive(1, 0);
    document.getElementById('hud')?.setAttribute('hidden', '');
    document.getElementById('screens')?.setAttribute('hidden', '');
  });
}

const SCENES = {
  async conditions() {
    await settle();
    return page.evaluate((list) => {
      const cr = window.carRacer;
      return list.map((name) => {
        const [biome, weather, phase] = name.split('/');
        cr.pinWorld({ biome, weather, phase });
        // Long enough for the scenery bands to repopulate and the weather to settle.
        for (let i = 0; i < 6; i++) cr.drive(1, 0);
        cr.place({ x: 0, vx: 0, speed: 140 / 3.1 });
        cr.drive(0.6, 0);
        const st = cr.state();
        return { name: name.replace(/\//g, '-'), url: cr.snapshot(), drawCalls: st.drawCalls, triangles: st.triangles };
      });
    }, CONDITIONS);
  },

  async cars() {
    await settle();
    return page.evaluate((views) => {
      const cr = window.carRacer;
      const game = cr.game;
      cr.pinWorld({ biome: 'coast', weather: 'clear', phase: 'day' });
      cr.setTrafficSpawning(false);
      cr.setPickupSpawning(false);
      cr.clearTraffic();
      cr.drive(0.5, 0);
      cr.place({ x: 0, vx: 0, speed: 30 });
      cr.drive(0.3, 0);
      const cam = game.rig.camera;
      const out = [];
      for (const { def } of cr.garage()) {
        game.player.setCar(def.id, {});
        game.effects.rebind();
        const p = game.player.mesh.position;
        for (const [view, [pos, at, fov]] of Object.entries(views)) {
          cam.position.set(p.x + pos[0], p.y + pos[1], p.z + pos[2]);
          cam.fov = fov;
          cam.updateProjectionMatrix();
          cam.lookAt(p.x + at[0], p.y + at[1], p.z + at[2]);
          cam.updateMatrixWorld();
          const url = cr.snapshot();
          const st = cr.state();
          out.push({ name: `${def.id}-${view}`, url, drawCalls: st.drawCalls, triangles: st.triangles });
        }
      }
      return out;
    }, CAR_VIEWS);
  },

  async traffic() {
    await settle();
    return page.evaluate((layout) => {
      const cr = window.carRacer;
      cr.pinWorld({ biome: 'coast', weather: 'clear', phase: 'day' });
      cr.setTrafficSpawning(false);
      cr.setPickupSpawning(false);
      cr.clearTraffic();
      cr.drive(0.5, 0);
      cr.place({ x: 0, vx: 0, speed: 30 });
      for (const [kind, lane, ahead, roll] of layout) cr.layTraffic(kind, lane, ahead, roll);
      cr.drive(0.05, 0);
      const st = cr.state();
      return [{ name: 'traffic', url: cr.snapshot(), drawCalls: st.drawCalls, triangles: st.triangles }];
    }, TRAFFIC);
  },
};

/** Tile a scene's frames into one sheet, two across, each labelled. */
async function contactSheet(frames) {
  return page.evaluate(async ({ frames, W, H }) => {
    const cols = Math.min(2, frames.length);
    const w = Math.round(W / 2);
    const h = Math.round(H / 2);
    const c = document.createElement('canvas');
    c.width = w * cols;
    c.height = h * Math.ceil(frames.length / cols);
    const g = c.getContext('2d');
    for (let i = 0; i < frames.length; i++) {
      const img = new Image();
      img.src = frames[i].url;
      await img.decode();
      const x = (i % cols) * w;
      const y = Math.floor(i / cols) * h;
      g.drawImage(img, x, y, w, h);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(x, y, 200, 22);
      g.fillStyle = '#fff';
      g.font = '14px sans-serif';
      g.fillText(frames[i].name, x + 6, y + 16);
    }
    return c.toDataURL('image/png');
  }, { frames, W, H });
}

const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');

for (const scene of opt.scenes.split(',')) {
  const run = SCENES[scene];
  if (!run) throw new Error(`unknown scene '${scene}' — one of ${Object.keys(SCENES).join(', ')}`);
  const frames = await run();
  for (const f of frames) {
    writeFileSync(resolve(outDir, `${scene}-${f.name}.png`), png(f.url));
    console.log(`${scene}/${f.name}: ${f.drawCalls} draw calls, ${(f.triangles / 1000).toFixed(0)}k triangles`);
  }
  if (frames.length > 1) writeFileSync(resolve(outDir, `${scene}.png`), png(await contactSheet(frames)));
}

if (errors.length) {
  console.log(`page errors:\n  ${errors.slice(0, 10).join('\n  ')}`);
}
console.log(`frames in ${outDir}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
