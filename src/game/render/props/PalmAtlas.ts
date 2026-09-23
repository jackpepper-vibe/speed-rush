import * as THREE from 'three';
import { coverageMipmaps } from '../textures/CoverageMips';

/**
 * The palm's textures on one canvas: a strip of ringed bark for the trunk and
 * two fronds of leaflets for the crown.
 *
 * A palm is identified by its fronds — a feathered edge with sky showing
 * through between the leaflets — and a frond modelled as a solid strip reads
 * as a leaf at any distance, however many triangles it has. The leaflets here
 * are painted into an alpha channel, so one quad strip per frond carries sixty
 * of them a side and the shadow on the road comes out dappled rather than as a
 * solid blot.
 */

const SIZE = 1024;

export type UvRect = readonly [number, number, number, number];

function rect(x: number, y: number, w: number, h: number): UvRect {
  return [x / SIZE, 1 - (y + h) / SIZE, (x + w) / SIZE, 1 - y / SIZE];
}

/** Bark runs bottom (v0) to top (v1) of the trunk. */
export const PALM_UV = {
  bark: rect(0, 0, 116, SIZE),
  /** A solid white column for parts coloured by vertex alone. */
  solid: rect(118, 8, 8, SIZE - 16),
  frondA: rect(128, 0, 448, SIZE),
  frondB: rect(576, 0, 448, SIZE),
} as const;

/** Small deterministic generator, so the atlas is the same every launch. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawBark(g: CanvasRenderingContext2D): void {
  const w = 116;
  const r = rng(11);
  const grad = g.createLinearGradient(0, 0, 0, SIZE);
  // Top of the trunk (canvas top) is younger and browner; the base is grey.
  grad.addColorStop(0, '#6e5a44');
  grad.addColorStop(0.08, '#8a7658');
  grad.addColorStop(0.5, '#9a8d78');
  grad.addColorStop(1, '#8c8474');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, SIZE);

  // Vertical fibre.
  for (let i = 0; i < 260; i++) {
    const x = r() * w;
    const y = r() * SIZE;
    const len = 20 + r() * 90;
    g.strokeStyle = r() < 0.5 ? 'rgba(60,48,36,0.18)' : 'rgba(200,188,168,0.14)';
    g.lineWidth = 1 + r() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y + len);
    g.stroke();
  }

  // Leaf-scar rings: a dark groove with a lit lip above it, slightly wavy.
  let y = 6;
  while (y < SIZE) {
    const gap = 9 + r() * 7;
    const wobble = r() * 3;
    g.strokeStyle = 'rgba(54,44,34,0.75)';
    g.lineWidth = 2.2;
    g.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const yy = y + Math.sin(x * 0.09 + wobble) * 1.6;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
    g.strokeStyle = 'rgba(214,202,180,0.45)';
    g.lineWidth = 1.4;
    g.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const yy = y - 2.2 + Math.sin(x * 0.09 + wobble) * 1.6;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
    y += gap;
  }

  // The crownshaft: fibrous, darker, where old frond bases wrap the top.
  const top = g.createLinearGradient(0, 0, 0, 70);
  top.addColorStop(0, 'rgba(58,44,28,0.9)');
  top.addColorStop(1, 'rgba(58,44,28,0)');
  g.fillStyle = top;
  g.fillRect(0, 0, w, 70);
}

/**
 * One frond: the rachis up the middle and leaflets off both sides, angled
 * towards the tip, longest a third of the way along.
 */
function drawFrond(g: CanvasRenderingContext2D, x0: number, w: number, seed: number, dry: number): void {
  const r = rng(seed);
  const cx = x0 + w / 2;
  const H = SIZE;
  const perSide = 96;

  const leaflet = (s: number, side: number, shade: number): void => {
    // Envelope along the frond: short at the base and the tip.
    const env = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.72)), 0.55);
    const len = (w / 2 - 4) * env * (0.9 + r() * 0.1);
    if (len < 6) return;
    const yBase = H * (1 - s);
    const rise = len * (0.5 + r() * 0.12);
    const tipX = cx + side * len;
    const tipY = yBase - rise;
    // A slight droop in each leaflet: the control point sits above the chord.
    const ctrlX = cx + side * len * 0.45;
    const ctrlY = yBase - rise * 0.8;
    const base = 10 * (0.55 + env * 0.6);

    const green = (0.55 + r() * 0.45) * shade;
    const brown = r() < dry ? 1 : 0;
    const grad = g.createLinearGradient(cx, yBase, tipX, tipY);
    grad.addColorStop(0, `rgb(${Math.round(26 + 14 * green)},${Math.round(52 + 22 * green)},20)`);
    grad.addColorStop(0.5, `rgb(${Math.round(52 + 34 * green)},${Math.round(104 + 40 * green)},${Math.round(30 + 10 * green)})`);
    grad.addColorStop(1, brown ? '#a89448' : `rgb(${Math.round(96 + 40 * green)},${Math.round(150 + 36 * green)},52)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx, yBase - base * 0.5);
    g.quadraticCurveTo(ctrlX, ctrlY - base * 0.55, tipX, tipY);
    g.quadraticCurveTo(ctrlX, ctrlY + base * 0.55, cx, yBase + base * 0.5);
    g.closePath();
    g.fill();
  };

  // A darker under-layer between the leaflets fills the gaps a real frond
  // has leaves behind, then the lit layer on top.
  for (let k = 0; k < perSide; k++) {
    const s = 0.03 + (k / perSide) * 0.955 + 0.005;
    leaflet(s, -1, 0.55);
    leaflet(s + 0.003, 1, 0.55);
  }
  for (let k = 0; k < perSide; k++) {
    const s = 0.03 + (k / perSide) * 0.955 + (r() - 0.5) * 0.004;
    leaflet(s, -1, 1);
    leaflet(s + 0.004, 1, 1);
  }

  // Rachis, tapering to the tip.
  for (let i = 0; i < 40; i++) {
    const s0 = i / 40;
    const s1 = (i + 1) / 40;
    g.strokeStyle = '#7a8a3c';
    g.lineWidth = 7 * (1 - s0) + 1.5;
    g.beginPath();
    g.moveTo(cx, H * (1 - s0));
    g.lineTo(cx, H * (1 - s1));
    g.stroke();
  }
}

let atlas: THREE.CanvasTexture | null = null;

export function palmAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for the palm atlas');
  g.clearRect(0, 0, SIZE, SIZE);
  drawBark(g);
  g.fillStyle = '#ffffff';
  g.fillRect(116, 0, 12, SIZE);
  drawFrond(g, 128, 448, 101, 0.04);
  drawFrond(g, 576, 448, 202, 0.16);

  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  // Hand-built mips that keep the fronds' coverage, so a crown a hundred
  // metres away is still a crown and not a bare stick.
  atlas.mipmaps = coverageMipmaps(canvas, [
    { x: 128, y: 0, w: 448, h: SIZE },
    { x: 576, y: 0, w: 448, h: SIZE },
  ], 0.45);
  atlas.generateMipmaps = false;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.name = 'PalmAtlas';
  return atlas;
}

export function disposePalmAtlas(): void {
  atlas?.dispose();
  atlas = null;
}
