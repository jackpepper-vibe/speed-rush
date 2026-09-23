import * as THREE from 'three';

/**
 * Every painted detail on every vehicle, on one texture.
 *
 * Lamp lenses, number plates, grille mesh, louvres, vents, carbon weave and
 * seat leather are all small rectangles of pattern, and each is what turns a
 * shape into a recognisable part: a red disc is a disc until it has the
 * concentric optics of a lamp lens in it, and a white rectangle is a white
 * rectangle until it carries a registration. Drawing them in code rather than
 * shipping images keeps the game asset-free, and packing them together is
 * what lets a whole car stay one draw call.
 *
 * Regions are addressed by `AtlasRect` — a UV rectangle — and a surface maps
 * its geometry's own 0..1 UVs into one of them.
 */

/** u0, v0, u1, v1 in texture space. */
export type AtlasRect = readonly [number, number, number, number];

const SIZE = 1024;
/** Inset every rectangle by this many texels so mip filtering does not bleed. */
const INSET = 2;

function region(x: number, y: number, w: number, h: number): AtlasRect {
  return [
    (x + INSET) / SIZE,
    1 - (y + h - INSET) / SIZE,
    (x + w - INSET) / SIZE,
    1 - (y + INSET) / SIZE,
  ];
}

/** Registration numbers, one per plate slot. The first six belong to the garage. */
export const PLATE_TEXTS = [
  'DA 246 RT', 'KE 520 GT', 'BR 427 V8', 'VA 512 TR', 'PH 750 SF', 'AP 001 X1',
  'MC 318 AB', 'NI 884 RV', 'CA 331 NN', 'AZ 719 EU', 'LU 206 PM', 'SR 990 CD',
] as const;

const PLATE_W = 256;
const PLATE_H = 60;

/**
 * A motorcycle's registration: nearly square, on two lines, because a bike has
 * no room across its tail for a car's strip. Its own region, not a thirteenth
 * slot in the car rows, which are full up to the grille.
 */
export const BIKE_PLATE_TEXT = ['HN19', 'RRV'] as const;
const BIKE_PLATE = { x: 800, y: 624, w: 168, h: 128 } as const;

export const ATLAS = {
  white: region(4, 4, 24, 24),
  roundRed: region(32, 0, 128, 128),
  roundAmber: region(160, 0, 128, 128),
  roundHead: region(288, 0, 128, 128),
  roundRedDeep: region(416, 0, 128, 128),
  rectCluster: region(544, 0, 256, 96),
  ledBar: region(544, 100, 256, 56),
  tripleBar: region(800, 0, 224, 96),
  louvreLamp: region(0, 160, 384, 96),
  yLamp: region(384, 160, 192, 96),
  headModern: region(576, 160, 256, 96),
  slimLamp: region(832, 160, 192, 60),
  plates: PLATE_TEXTS.map((_, i) =>
    region((i % 4) * PLATE_W, 272 + Math.floor(i / 4) * (PLATE_H + 4), PLATE_W, PLATE_H)),
  grille: region(0, 480, 256, 128),
  louvres: region(256, 480, 256, 128),
  vents: region(512, 480, 256, 128),
  carbon: region(768, 480, 128, 128),
  seat: region(896, 480, 128, 128),
  truckDoors: region(0, 624, 256, 256),
  busRear: region(256, 624, 256, 256),
  headSquare: region(512, 624, 192, 96),
  roundHeadSmall: region(704, 624, 96, 96),
  bikePlate: region(BIKE_PLATE.x, BIKE_PLATE.y, BIKE_PLATE.w, BIKE_PLATE.h),
} as const;

/* ---------------------------------------------------------------- drawing */

type Ctx = CanvasRenderingContext2D;

function roundLens(g: Ctx, cx: number, cy: number, r: number, inner: string, mid: string, edge: string, ring: string): void {
  const grad = g.createRadialGradient(cx - r * 0.15, cy - r * 0.2, r * 0.05, cx, cy, r);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.55, mid);
  grad.addColorStop(1, edge);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();

  // Fresnel optics: concentric ridges, which is most of what makes a lens a lens.
  g.strokeStyle = ring;
  for (let k = 0.18; k < 0.98; k += 0.075) {
    g.lineWidth = Math.max(1, r * 0.018);
    g.beginPath();
    g.arc(cx, cy, r * k, 0, Math.PI * 2);
    g.stroke();
  }
  // The reflector behind the lens catching the light.
  const hot = g.createRadialGradient(cx - r * 0.18, cy - r * 0.24, 0, cx - r * 0.18, cy - r * 0.24, r * 0.42);
  hot.addColorStop(0, 'rgba(255,245,235,0.75)');
  hot.addColorStop(1, 'rgba(255,245,235,0)');
  g.fillStyle = hot;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
}

function drawRoundLenses(g: Ctx): void {
  g.fillStyle = '#140404';
  g.fillRect(32, 0, 512, 128);
  roundLens(g, 96, 64, 62, '#ff6a48', '#d8180e', '#5a0202', 'rgba(255,170,150,0.28)');
  g.fillStyle = '#1a0c02';
  g.fillRect(160, 0, 128, 128);
  roundLens(g, 224, 64, 62, '#ffd070', '#f08a10', '#6a3000', 'rgba(255,230,170,0.3)');

  // Headlamp: a chrome reflector behind fluted glass.
  g.fillStyle = '#9aa0a8';
  g.fillRect(288, 0, 128, 128);
  const refl = g.createRadialGradient(352, 64, 4, 352, 64, 62);
  refl.addColorStop(0, '#ffffff');
  refl.addColorStop(0.35, '#e8edf2');
  refl.addColorStop(0.8, '#9ea6b0');
  refl.addColorStop(1, '#5a6068');
  g.fillStyle = refl;
  g.beginPath();
  g.arc(352, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 1.5;
  for (let x = 296; x <= 408; x += 9) {
    g.beginPath();
    g.moveTo(x, 4);
    g.lineTo(x, 124);
    g.stroke();
  }
  g.fillStyle = '#fffdf4';
  g.beginPath();
  g.arc(352, 64, 11, 0, Math.PI * 2);
  g.fill();

  // A deeper, darker red with a bright ring — the second lamp of a quad set.
  g.fillStyle = '#120202';
  g.fillRect(416, 0, 128, 128);
  roundLens(g, 480, 64, 62, '#ff4c30', '#b80c06', '#3a0000', 'rgba(255,140,120,0.3)');
  g.strokeStyle = 'rgba(255,210,200,0.55)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(480, 64, 40, 0, Math.PI * 2);
  g.stroke();
}

function ribs(g: Ctx, x: number, y: number, w: number, h: number, step: number, colour: string, vertical = false): void {
  g.strokeStyle = colour;
  g.lineWidth = 1.5;
  if (vertical) {
    for (let px = x + step / 2; px < x + w; px += step) {
      g.beginPath();
      g.moveTo(px, y);
      g.lineTo(px, y + h);
      g.stroke();
    }
  } else {
    for (let py = y + step / 2; py < y + h; py += step) {
      g.beginPath();
      g.moveTo(x, py);
      g.lineTo(x + w, py);
      g.stroke();
    }
  }
}

function vGrad(g: Ctx, y0: number, y1: number, stops: Array<[number, string]>): CanvasGradient {
  const grad = g.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) grad.addColorStop(o, c);
  return grad;
}

function drawRectLamps(g: Ctx): void {
  // Three-section cluster: stop/tail over indicator over reverse.
  const x = 544;
  g.fillStyle = vGrad(g, 0, 52, [[0, '#ff4a36'], [0.5, '#d4160e'], [1, '#7a0604']]);
  g.fillRect(x, 0, 256, 52);
  ribs(g, x, 0, 256, 52, 6, 'rgba(255,190,170,0.28)');
  g.fillStyle = vGrad(g, 52, 72, [[0, '#ffb24a'], [1, '#d06a08']]);
  g.fillRect(x, 52, 256, 20);
  ribs(g, x, 52, 256, 20, 5, 'rgba(255,240,200,0.3)', true);
  g.fillStyle = vGrad(g, 72, 96, [[0, '#f2f4f6'], [1, '#aab2ba']]);
  g.fillRect(x, 72, 256, 24);
  ribs(g, x, 72, 256, 24, 7, 'rgba(120,130,140,0.35)', true);
  g.fillStyle = '#1a1c20';
  g.fillRect(x, 50, 256, 3);
  g.fillRect(x, 71, 256, 2);

  // Full-width LED light bar: a hot core on a black strip.
  g.fillStyle = '#08090b';
  g.fillRect(544, 100, 256, 56);
  const bar = vGrad(g, 110, 146, [[0, 'rgba(255,40,30,0)'], [0.38, '#ff2a1c'], [0.5, '#ffd0c0'], [0.62, '#ff2a1c'], [1, 'rgba(255,40,30,0)']]);
  g.fillStyle = bar;
  g.fillRect(546, 112, 252, 32);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  for (let px = 546; px < 798; px += 12) g.fillRect(px, 112, 2, 32);

  // Three vertical bars per side, the muscle-car signature.
  g.fillStyle = '#0a0a0c';
  g.fillRect(800, 0, 224, 96);
  for (let i = 0; i < 3; i++) {
    const bx = 812 + i * 70;
    g.fillStyle = vGrad(g, 8, 88, [[0, '#ff5a40'], [0.5, '#e01a10'], [1, '#8a0806']]);
    g.beginPath();
    g.roundRect(bx, 8, 58, 80, 10);
    g.fill();
    ribs(g, bx + 4, 10, 50, 76, 6, 'rgba(255,200,180,0.3)');
    g.strokeStyle = '#c0c4ca';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(bx, 8, 58, 80, 10);
    g.stroke();
  }

  // Red lens behind horizontal fins — the eighties wedge's tail grille.
  g.fillStyle = vGrad(g, 160, 256, [[0, '#ff3a26'], [0.5, '#c8120a'], [1, '#6a0404']]);
  g.fillRect(0, 160, 384, 96);
  for (let k = 0; k < 7; k++) {
    const fy = 164 + k * 13.5;
    g.fillStyle = '#0c0d10';
    g.fillRect(0, fy, 384, 6.5);
    g.fillStyle = 'rgba(160,168,180,0.55)';
    g.fillRect(0, fy, 384, 1.2);
  }
  // The amber and reverse cells at the inner ends, seen through the fins.
  g.fillStyle = 'rgba(255,160,40,0.55)';
  g.fillRect(300, 170, 80, 80);

  // A modern arrow-shaped LED signature on a black lens.
  g.fillStyle = '#060607';
  g.fillRect(384, 160, 192, 96);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const stroke = (w: number, c: string): void => {
    g.strokeStyle = c;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(398, 176);
    g.lineTo(470, 208);
    g.lineTo(560, 208);
    g.moveTo(470, 208);
    g.lineTo(398, 242);
    g.stroke();
  };
  stroke(18, 'rgba(255,30,20,0.35)');
  stroke(9, '#ff2412');
  stroke(3, '#ffd8cc');

  // Modern headlamp: two projectors and a daytime-running strip.
  g.fillStyle = '#1a1d22';
  g.fillRect(576, 160, 256, 96);
  for (const px of [640, 720]) {
    const pg = g.createRadialGradient(px, 206, 2, px, 206, 26);
    pg.addColorStop(0, '#ffffff');
    pg.addColorStop(0.45, '#c8d4e0');
    pg.addColorStop(1, '#30363e');
    g.fillStyle = pg;
    g.beginPath();
    g.arc(px, 206, 26, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#f4fbff';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(590, 176);
  g.lineTo(800, 176);
  g.lineTo(816, 236);
  g.stroke();

  // Slim blade lamp: two thin lines on black.
  g.fillStyle = '#070708';
  g.fillRect(832, 160, 192, 60);
  g.fillStyle = '#ff2618';
  g.fillRect(836, 176, 184, 5);
  g.fillRect(836, 200, 184, 3);
  g.fillStyle = 'rgba(255,200,190,0.9)';
  g.fillRect(836, 177, 184, 2);

  // Square headlamp for traffic: reflector, lens flutes and an indicator end.
  g.fillStyle = '#a4acb6';
  g.fillRect(512, 624, 192, 96);
  const sq = g.createRadialGradient(580, 672, 4, 580, 672, 60);
  sq.addColorStop(0, '#ffffff');
  sq.addColorStop(1, '#8a929c');
  g.fillStyle = sq;
  g.fillRect(516, 628, 136, 88);
  ribs(g, 516, 628, 136, 88, 8, 'rgba(255,255,255,0.35)', true);
  g.fillStyle = '#f0a030';
  g.fillRect(656, 628, 44, 88);

  // A small round headlamp for the garage's classic cars.
  g.fillStyle = '#8c949e';
  g.fillRect(704, 624, 96, 96);
  const rh = g.createRadialGradient(752, 672, 2, 752, 672, 46);
  rh.addColorStop(0, '#ffffff');
  rh.addColorStop(0.5, '#dfe6ee');
  rh.addColorStop(1, '#6a727c');
  g.fillStyle = rh;
  g.beginPath();
  g.arc(752, 672, 46, 0, Math.PI * 2);
  g.fill();
}

function drawPlates(g: Ctx): void {
  PLATE_TEXTS.forEach((text, i) => {
    const x = (i % 4) * PLATE_W;
    const y = 272 + Math.floor(i / 4) * (PLATE_H + 4);
    g.fillStyle = '#f3f2ec';
    g.fillRect(x, y, PLATE_W, PLATE_H);
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 3;
    g.strokeRect(x + 3, y + 3, PLATE_W - 6, PLATE_H - 6);
    // The blue band with its ring of stars and a country code.
    g.fillStyle = '#1d3f9e';
    g.fillRect(x + 4, y + 4, 26, PLATE_H - 8);
    g.fillStyle = '#ffd21a';
    for (let s = 0; s < 12; s++) {
      const a = (s / 12) * Math.PI * 2;
      g.fillRect(x + 17 + Math.cos(a) * 7 - 1, y + 20 + Math.sin(a) * 7 - 1, 2, 2);
    }
    g.fillStyle = '#ffffff';
    g.font = 'bold 13px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText(i < 6 ? 'SR' : 'EU', x + 17, y + 50);
    // Condensed registration, the way plate typefaces are.
    g.save();
    g.fillStyle = '#121212';
    g.font = 'bold 46px "Arial Narrow", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.translate(x + 30 + (PLATE_W - 34) / 2, y + PLATE_H / 2 + 2);
    g.scale(0.78, 1);
    g.fillText(text, 0, 0);
    g.restore();
  });
}

function drawBikePlate(g: Ctx): void {
  const { x, y, w, h } = BIKE_PLATE;
  g.fillStyle = '#f3f2ec';
  g.fillRect(x, y, w, h);
  g.strokeStyle = '#1a1a1a';
  g.lineWidth = 3;
  g.strokeRect(x + 3, y + 3, w - 6, h - 6);
  g.fillStyle = '#1d3f9e';
  g.fillRect(x + 4, y + 4, 24, h - 8);
  g.fillStyle = '#ffd21a';
  for (let s = 0; s < 12; s++) {
    const a = (s / 12) * Math.PI * 2;
    g.fillRect(x + 16 + Math.cos(a) * 7 - 1, y + 30 + Math.sin(a) * 7 - 1, 2, 2);
  }
  g.fillStyle = '#ffffff';
  g.font = 'bold 13px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('SR', x + 16, y + h - 18);
  g.save();
  g.fillStyle = '#121212';
  g.font = 'bold 50px "Arial Narrow", Arial, sans-serif';
  g.textBaseline = 'middle';
  const cx = x + 28 + (w - 32) / 2;
  BIKE_PLATE_TEXT.forEach((line, row) => {
    g.save();
    g.translate(cx, y + h * (0.3 + row * 0.42));
    g.scale(0.78, 1);
    g.fillText(line, 0, 0);
    g.restore();
  });
  g.restore();
}

function drawPanels(g: Ctx): void {
  // Honeycomb grille mesh.
  g.fillStyle = '#07080a';
  g.fillRect(0, 480, 256, 128);
  g.strokeStyle = '#2c3036';
  g.lineWidth = 2;
  const r = 7;
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 20; col++) {
      const cx = col * r * 1.75 + (row % 2) * r * 0.875;
      const cy = 480 + row * r * 1.5;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.stroke();
    }
  }

  // Louvres pressed into a painted panel: white multiplies to the paint, the
  // slots stay dark whatever colour the car is.
  g.fillStyle = '#ffffff';
  g.fillRect(256, 480, 256, 128);
  for (let k = 0; k < 9; k++) {
    const y = 488 + k * 13.5;
    g.fillStyle = '#16171a';
    g.fillRect(262, y, 244, 6);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(262, y + 6, 244, 3);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(262, y - 1, 244, 1);
  }

  // Black slatted vent.
  g.fillStyle = '#121316';
  g.fillRect(512, 480, 256, 128);
  for (let k = 0; k < 10; k++) {
    const y = 484 + k * 12.5;
    g.fillStyle = '#030304';
    g.fillRect(512, y, 256, 6);
    g.fillStyle = '#34383e';
    g.fillRect(512, y + 6, 256, 1.5);
  }

  // Carbon twill.
  for (let yy = 0; yy < 128; yy += 8) {
    for (let xx = 0; xx < 128; xx += 8) {
      const odd = ((xx + yy) / 8) % 2 === 0;
      const grad = odd
        ? g.createLinearGradient(768 + xx, 480 + yy, 768 + xx + 8, 480 + yy)
        : g.createLinearGradient(768 + xx, 480 + yy, 768 + xx, 480 + yy + 8);
      grad.addColorStop(0, '#2a2d33');
      grad.addColorStop(0.5, '#15171b');
      grad.addColorStop(1, '#0a0b0d');
      g.fillStyle = grad;
      g.fillRect(768 + xx, 480 + yy, 8, 8);
    }
  }

  // Seat leather: pleats and stitching.
  g.fillStyle = '#3a2418';
  g.fillRect(896, 480, 128, 128);
  for (let px = 900; px < 1024; px += 16) {
    const grad = g.createLinearGradient(px, 0, px + 16, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)');
    grad.addColorStop(0.5, 'rgba(255,220,190,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = grad;
    g.fillRect(px, 480, 16, 128);
  }

  // Box-van rear: two door leaves, hinges, locking bars, marker lamps.
  g.fillStyle = '#ffffff';
  g.fillRect(0, 624, 256, 256);
  g.fillStyle = '#b8bcc2';
  g.fillRect(126, 624, 4, 256);
  g.fillStyle = '#6a6e74';
  for (const hx of [10, 118, 134, 242]) g.fillRect(hx, 640, 4, 224);
  g.fillStyle = '#8a8e94';
  for (const bx of [60, 96, 160, 196]) g.fillRect(bx, 640, 5, 230);
  g.fillStyle = '#2a2c30';
  for (const hy of [680, 760, 840]) {
    g.fillRect(8, hy, 240, 3);
  }
  g.fillStyle = '#ff8a1a';
  for (const mx of [30, 90, 166, 226]) g.fillRect(mx, 628, 12, 8);

  // Bus rear: a dark screen over an engine grille.
  g.fillStyle = '#ffffff';
  g.fillRect(256, 624, 256, 256);
  g.fillStyle = '#0e1318';
  g.beginPath();
  g.roundRect(270, 640, 228, 110, 10);
  g.fill();
  const sky = g.createLinearGradient(0, 640, 0, 750);
  sky.addColorStop(0, 'rgba(160,190,220,0.35)');
  sky.addColorStop(1, 'rgba(160,190,220,0)');
  g.fillStyle = sky;
  g.fillRect(274, 644, 220, 50);
  g.fillStyle = '#26292e';
  g.fillRect(280, 780, 208, 70);
  for (let k = 0; k < 7; k++) {
    g.fillStyle = '#0a0b0d';
    g.fillRect(286, 786 + k * 9, 196, 4);
  }
}

let atlas: THREE.CanvasTexture | null = null;

/** The shared atlas, drawn on first use. */
export function vehicleAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for the vehicle atlas');

  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 32, 32);
  drawRoundLenses(g);
  drawRectLamps(g);
  drawPlates(g);
  drawBikePlate(g);
  drawPanels(g);

  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.name = 'VehicleAtlas';
  return atlas;
}

export function disposeVehicleAtlas(): void {
  atlas?.dispose();
  atlas = null;
}
