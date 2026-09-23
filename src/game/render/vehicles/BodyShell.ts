import * as THREE from 'three';
import { clamp, smoothstep, type Curve } from './Curve';
import { SURF, type Surface } from './Surfaces';
import { ATLAS } from './VehicleAtlas';
import { VehicleBuilder } from './VehicleBuilder';

/**
 * A car body, lofted from rails.
 *
 * The body is described the way a designer's side and plan views describe it:
 * a handful of longitudinal lines — the shoulder (beltline), the centreline of
 * the top surface, the plan width, the sill — each authored as a few control
 * points along the car. Every cross-section is built from where those lines
 * are at that station, and the sections are skinned into one surface.
 *
 * Three things the previous loft could not do are what make this read as a
 * car rather than a blob:
 *
 *  - **Wheel wells.** Around each axle the sill rises along the arch circle,
 *    so the flank is cut away over the tyre and the wheel sits *in* the body
 *    instead of under a plank. The width swells there too, into haunches.
 *  - **A shoulder.** The section turns from flank to top over a tight radius
 *    at a defined line, which is where a car catches the sky in one bright
 *    stripe. A superellipse has no such line, which is why its bodies were
 *    soap.
 *  - **A separate greenhouse.** Glass, pillars and roof are a second loft
 *    standing on the body's top surface, with the windscreen, side glass and
 *    rear window assigned per quad so every window has a crisp edge.
 *
 * Coordinates: x right, y up, z towards the tail (the car drives towards -z).
 * `t` runs 0 at the nose to 1 at the tail.
 */

export type RimStyle = 'classic5' | 'star5' | 'mesh10' | 'split12' | 'aero' | 'steel' | 'truck';

export interface WheelSpec {
  radius: number;
  width: number;
  /** Rim radius as a fraction of the tyre radius. */
  rim: number;
  style: RimStyle;
  finish: Surface;
  /** Brake caliper colour, or null for none visible. */
  caliper: number | null;
}

export interface BodyRails {
  /** Height of the shoulder: the line where the flank turns over into the top. */
  belt: Curve;
  /** Height of the top surface on the centreline — bonnet, scuttle, deck. */
  top: Curve;
  /** Half-width at the widest point of the section. */
  halfWidth: Curve;
  /** Sill height, before the wheel arches cut into it. */
  rocker: Curve;
  /** How far inboard of the widest point the shoulder turns over. */
  shoulderInset: Curve;
}

export interface GreenhouseSpec {
  /** t where the windscreen meets the scuttle, and where the glass meets the deck. */
  start: number;
  end: number;
  /** Top of the windscreen and top of the rear window. */
  roofStart: number;
  roofEnd: number;
  /** Absolute roof height along t. Must meet the body at `start` and `end`. */
  roof: Curve;
  roofHalfWidth: Curve;
  /** Where the side glass stands, as a fraction of the shoulder's x. */
  baseInset: number;
  cornerRadius: number;
  crown: number;
  bPillar: number | null;
  /** t beyond which the greenhouse flank is solid — the C-pillar or sail. */
  sideGlassEnd: number;
  pillar: Surface;
  roofSurface: Surface;
  rearSurface: Surface;
}

export interface CockpitSpec {
  start: number;
  end: number;
  depth: number;
  /** Cockpit opening as a fraction of the top surface's half-width. */
  edge: number;
}

export interface CapSpec {
  /** How far the panel domes out beyond its outline. */
  bulge: number;
  /** Radius of the rounded edge between the flanks and the panel. */
  fillet: number;
}

export type BodyPiece = 'floor' | 'rocker' | 'side' | 'shoulder' | 'top' | 'cap';

export interface QuadContext {
  part: 'body' | 'nose' | 'tail';
  piece: BodyPiece;
  x: number;
  y: number;
  z: number;
  t: number;
}

export interface BodySpec {
  length: number;
  frontAxle: number;
  rearAxle: number;
  track: number;
  rearTrack: number;
  frontWheel: WheelSpec;
  rearWheel: WheelSpec;
  archClearance: number;
  /** Fender flare over each axle, in metres of extra half-width. */
  flare: number;
  rails: BodyRails;
  shoulderRadius: number;
  sideBulge: number;
  tuck: number;
  nose: CapSpec;
  tail: CapSpec;
  greenhouse?: GreenhouseSpec;
  cockpit?: CockpitSpec;
  paint: Surface;
  /** Overrides the surface of a body quad: intakes, grilles, blacked-out panels. */
  paintOut?: (q: QuadContext) => Surface | null;
  /** Projects a patterned surface onto the body (deck louvres and the like). */
  uvAt?: (p: THREE.Vector3, s: Surface) => readonly [number, number];
}

export interface Detail {
  /** Section points per half. */
  top: readonly number[];
  side: readonly number[];
  rocker: readonly number[];
  shoulder: readonly number[];
  /** Rows along the body before arch refinement. */
  rows: number;
  /** Extra rows across each wheel arch. */
  archRows: number;
  greenhouseRows: number;
  /** Points round the greenhouse's roof corner. */
  corner: readonly number[];
  /** Rings round a nose or tail panel's rounded edge, and across its face. */
  capFillet: number;
  capFace: number;
}

export const HERO_DETAIL: Detail = {
  top: [0.9, 0.8, 0.745, 0.7, 0.6, 0.45, 0.3, 0.15, 0],
  side: [0.12, 0.28, 0.45, 0.62, 0.8, 1],
  rocker: [0.34, 0.67, 1],
  shoulder: [0.25, 0.5, 0.75, 1],
  rows: 46,
  archRows: 14,
  greenhouseRows: 30,
  corner: [0.35, 0.7, 1],
  capFillet: 3,
  capFace: 5,
};

export const TRAFFIC_DETAIL: Detail = {
  top: [0.8, 0.55, 0.28, 0],
  side: [0.25, 0.55, 0.8, 1],
  rocker: [0.5, 1],
  shoulder: [0.5, 1],
  rows: 20,
  archRows: 6,
  greenhouseRows: 12,
  corner: [0.5, 1],
  capFillet: 2,
  capFace: 3,
};

/** Parked cars: seen side-on at thirty metres and instanced by the dozen. */
export const FAR_DETAIL: Detail = {
  top: [0.6, 0.25, 0],
  side: [0.45, 1],
  rocker: [1],
  shoulder: [1],
  rows: 12,
  archRows: 4,
  greenhouseRows: 7,
  corner: [1],
  capFillet: 1,
  capFace: 2,
};

interface Section {
  t: number;
  z: number;
  hw: number;
  xs: number;
  rs: number;
  yRock: number;
  yBelt: number;
  yTop: number;
  well: number;
}

interface Pt {
  x: number;
  y: number;
  piece: BodyPiece;
  /** How far this point was lowered into the cockpit well. */
  sunk: number;
}

const WALL = 0.045;

export class BodyShell {
  readonly spec: BodySpec;
  readonly detail: Detail;
  readonly halfLength: number;
  readonly frontAxleZ: number;
  readonly rearAxleZ: number;

  constructor(spec: BodySpec, detail: Detail) {
    this.spec = spec;
    this.detail = detail;
    this.halfLength = spec.length / 2;
    this.frontAxleZ = this.zAt(spec.frontAxle);
    this.rearAxleZ = this.zAt(spec.rearAxle);
  }

  zAt(t: number): number {
    return -this.halfLength + t * this.spec.length;
  }

  tAt(z: number): number {
    return (z + this.halfLength) / this.spec.length;
  }

  /* ------------------------------------------------------------ sections */

  private section(t: number): Section {
    const { rails, archClearance, flare } = this.spec;
    const z = this.zAt(t);
    let hw = rails.halfWidth.at(t);
    let yRock = rails.rocker.at(t);
    const yBelt = rails.belt.at(t);
    const yTop = rails.top.at(t);

    for (const [wz, w] of [[this.frontAxleZ, this.spec.frontWheel], [this.rearAxleZ, this.spec.rearWheel]] as const) {
      const dz = z - wz;
      const r = w.radius + archClearance;
      if (Math.abs(dz) < r) {
        const yArch = w.radius + Math.sqrt(r * r - dz * dz);
        yRock = Math.max(yRock, Math.min(yArch, yBelt - 0.085));
      }
      const reach = r * 1.6;
      if (Math.abs(dz) < reach) {
        const k = 1 - (dz / reach) ** 2;
        hw += flare * k * k;
      }
    }

    const inset = rails.shoulderInset.at(t);
    const xs = Math.max(0.2, hw - inset);
    const rs = Math.min(this.spec.shoulderRadius, (yBelt - yRock) * 0.35, xs * 0.3);

    let well = 0;
    const cp = this.spec.cockpit;
    if (cp) {
      const ramp = 0.025;
      well = cp.depth * smoothstep(cp.start - ramp, cp.start + ramp, t) * (1 - smoothstep(cp.end - ramp, cp.end + ramp, t));
    }
    return { t, z, hw, xs, rs, yRock, yBelt, yTop, well };
  }

  /** Height of the top surface at lateral `x`, before any cockpit well. */
  private topY(s: Section, x: number): number {
    const x0 = s.xs - s.rs;
    const f = smoothstep(0, 1, clamp(Math.abs(x) / x0, 0, 1));
    return s.yTop + (s.yBelt - s.yTop) * f;
  }

  /** Right half of a section, bottom centre to top centre. */
  private outline(s: Section): Pt[] {
    const d = this.detail;
    const pts: Pt[] = [];
    const tuck = this.spec.tuck;
    const rr = Math.min(0.06, (s.yBelt - s.yRock) * 0.28);
    const yF = s.yRock;
    const xF = Math.max(0.05, s.hw - tuck - rr);

    pts.push({ x: 0, y: yF, piece: 'floor', sunk: 0 });
    pts.push({ x: xF, y: yF, piece: 'floor', sunk: 0 });

    // Rocker: the rounded bottom edge of the flank.
    const r0x = xF;
    const r0y = yF;
    const r2x = s.hw - tuck;
    const r2y = yF + rr;
    for (const u of d.rocker) {
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const c = u * u;
      pts.push({ x: a * r0x + b * r2x + c * r2x, y: a * r0y + b * r0y + c * r2y, piece: 'rocker', sunk: 0 });
    }

    // Flank: sill up to the shoulder, bulging out to the widest point.
    const s0x = r2x;
    const s0y = r2y;
    const s3x = s.xs + s.rs * 0.3;
    const s3y = s.yBelt - s.rs;
    const h = s3y - s0y;
    const bulge = this.spec.sideBulge;
    const s1x = s.hw + bulge;
    const s1y = s0y + h * 0.3;
    const s2x = s.hw + bulge;
    const s2y = s0y + h * 0.72;
    for (const u of d.side) {
      const a = (1 - u) ** 3;
      const b = 3 * (1 - u) ** 2 * u;
      const c = 3 * (1 - u) * u * u;
      const e = u ** 3;
      pts.push({
        x: a * s0x + b * s1x + c * s2x + e * s3x,
        y: a * s0y + b * s1y + c * s2y + e * s3y,
        piece: 'side',
        sunk: 0,
      });
    }

    // Shoulder: the flank turning over into the top surface.
    const k0x = s3x;
    const k0y = s3y;
    const k1x = s.xs;
    const k1y = s.yBelt;
    const k2x = s.xs - s.rs;
    const k2y = s.yBelt;
    for (const u of d.shoulder) {
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const c = u * u;
      pts.push({ x: a * k0x + b * k1x + c * k2x, y: a * k0y + b * k1y + c * k2y, piece: 'shoulder', sunk: 0 });
    }

    // Top: bonnet or deck, sampled by fraction of its half-width, with the
    // cockpit sunk into it where there is one.
    const x0 = s.xs - s.rs;
    const edge = this.spec.cockpit?.edge ?? 0.72;
    for (const f of d.top) {
      const x = x0 * f;
      let y = this.topY(s, x);
      let sunk = 0;
      if (s.well > 0) {
        const inside = 1 - smoothstep(edge - WALL / x0, edge, f);
        sunk = s.well * inside;
        y -= sunk;
      }
      pts.push({ x, y, piece: 'top', sunk });
    }
    return pts;
  }

  /** Full closed loop from a right half: counter-clockwise seen from behind. */
  private loop(half: Pt[]): Pt[] {
    const out = [...half];
    for (let i = half.length - 2; i >= 1; i--) out.push({ ...half[i], x: -half[i].x });
    return out;
  }

  private rowTs(count: number, archRows: number): number[] {
    const ts = new Set<number>();
    for (let i = 0; i <= count; i++) {
      // Denser towards the ends, where the plan and profile turn fastest.
      const u = i / count;
      ts.add(0.5 - 0.5 * Math.cos(u * Math.PI) * 0.94 + (u - 0.5) * 0.06);
    }
    for (const [axle, w] of [[this.spec.frontAxle, this.spec.frontWheel], [this.spec.rearAxle, this.spec.rearWheel]] as const) {
      const r = (w.radius + this.spec.archClearance) / this.spec.length;
      for (let i = 0; i <= archRows; i++) {
        const u = -1 + (2 * i) / archRows;
        ts.add(axle + Math.sin((u * Math.PI) / 2) * r * 1.02);
      }
    }
    const sorted = [...ts].filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b);
    const out: number[] = [];
    for (const t of sorted) if (out.length === 0 || t - out[out.length - 1] > 0.0025) out.push(t);
    if (out[out.length - 1] !== 1) out.push(1);
    if (out[0] !== 0) out.unshift(0);
    return out;
  }

  /* --------------------------------------------------------------- build */

  build(b: VehicleBuilder): void {
    this.buildBody(b);
    if (this.spec.greenhouse) this.buildGreenhouse(b, this.spec.greenhouse);
  }

  private buildBody(b: VehicleBuilder): void {
    const ts = this.rowTs(this.detail.rows, this.detail.archRows);
    const sections = ts.map((t) => this.section(t));
    const halves = sections.map((s) => this.outline(s));
    const loops = halves.map((h) => this.loop(h));
    const cols = loops[0].length;

    const grid: THREE.Vector3[][] = [];
    const meta: Array<{ part: QuadContext['part']; t: number; pts: Pt[] }> = [];

    const cap = (s: Section, half: Pt[], pts: Pt[], spec: CapSpec, dir: -1 | 1): Array<{ ring: THREE.Vector3[]; pts: Pt[] }> => {
      const frame = capFrame(half);
      const columns = pts.map((p) => {
        const sx = spinePoint(frame, p.x);
        const dx = sx - p.x;
        const dy = frame.cy - p.y;
        const span = Math.hypot(dx, dy);
        const inv = span > 1e-9 ? 1 / span : 0;
        return { p, ux: dx * inv, uy: dy * inv, rings: capProfile(span, spec, this.detail, crownShare(frame, sx)) };
      });
      return columns[0].rings.map((_, k) => ({
        ring: columns.map(({ p, ux, uy, rings }) => {
          const [d, push] = rings[k];
          return new THREE.Vector3(p.x + ux * d, p.y + uy * d, s.z + dir * push);
        }),
        pts,
      }));
    };

    const nose = cap(sections[0], halves[0], loops[0], this.spec.nose, -1).reverse();
    for (const { ring, pts } of nose) {
      grid.push(ring);
      meta.push({ part: 'nose', t: 0, pts });
    }
    sections.forEach((s, i) => {
      grid.push(loops[i].map((p) => new THREE.Vector3(p.x, p.y, s.z)));
      meta.push({ part: 'body', t: s.t, pts: loops[i] });
    });
    const last = sections.length - 1;
    const tail = cap(sections[last], halves[last], loops[last], this.spec.tail, 1);
    for (const { ring, pts } of tail) {
      grid.push(ring);
      meta.push({ part: 'tail', t: 1, pts });
    }

    const paint = this.spec.paint;
    const surfaceAt = (r: number, c: number): Surface => {
      const c1 = (c + 1) % cols;
      const m0 = meta[r];
      const m1 = meta[r + 1];
      const p = grid[r][c];
      const q = grid[r + 1][c1];
      const x = (p.x + q.x) / 2;
      const y = (p.y + q.y) / 2;
      const z = (p.z + q.z) / 2;
      const isCap = m0.part !== 'body' || m1.part !== 'body';
      const piece: BodyPiece = isCap ? 'cap' : m0.pts[c].piece === 'floor' || m0.pts[c1].piece === 'floor'
        ? 'floor'
        : m0.pts[c].piece;
      const part: QuadContext['part'] = isCap ? (m0.part === 'body' ? m1.part : m0.part) : 'body';
      const ctx: QuadContext = { part, piece, x, y, z, t: (m0.t + m1.t) / 2 };
      const custom = this.spec.paintOut?.(ctx);
      if (custom) return custom;
      if (piece === 'floor') return SURF.underbody;
      if (!isCap) {
        const sunk = Math.min(m0.pts[c].sunk, m0.pts[c1].sunk, m1.pts[c].sunk, m1.pts[c1].sunk);
        if (sunk > 0.02) return SURF.interior;
      }
      return paint;
    };

    // The first and last rows are the panels' crowns, where the columns from
    // above and below the spine meet.
    b.addGrid(grid, { closed: true, surfaceAt, uvAt: this.spec.uvAt, weldRows: [0, grid.length - 1] });
  }

  private buildGreenhouse(b: VehicleBuilder, gh: GreenhouseSpec): void {
    const count = this.detail.greenhouseRows;
    const ts: number[] = [];
    for (let i = 0; i <= count; i++) {
      const u = i / count;
      ts.push(gh.start + (gh.end - gh.start) * (0.5 - 0.5 * Math.cos(u * Math.PI)));
    }
    for (const extra of [gh.roofStart, gh.roofEnd, gh.sideGlassEnd, ...(gh.bPillar === null ? [] : [gh.bPillar - 0.012, gh.bPillar + 0.012])]) {
      if (extra > gh.start && extra < gh.end) ts.push(extra);
    }
    ts.sort((a, c) => a - c);

    const sideU = [0, 0.07, 0.55, 1];
    const cornerU = this.detail.corner;
    const roofF = [0.72, 0.45, 0.2, 0];
    const pieceOf: Array<'seal' | 'side' | 'corner' | 'roof'> = [];
    pieceOf.push('seal', 'side', 'side');
    for (let i = 0; i < cornerU.length; i++) pieceOf.push('corner');
    for (let i = 0; i < roofF.length; i++) pieceOf.push('roof');
    const halfCount = sideU.length + cornerU.length + roofF.length;

    const grid: THREE.Vector3[][] = [];
    for (const t of ts) {
      const s = this.section(t);
      const xb = gh.baseInset * (s.xs - s.rs);
      const yb = this.topY(s, xb) - 0.015;
      const yr = gh.roof.at(t);
      const h = Math.max(0.0008, yr - yb);
      const xr = Math.min(gh.roofHalfWidth.at(t), xb * 0.98);
      const rc = Math.min(gh.cornerRadius, h * 0.42, xr * 0.45);
      const crown = gh.crown * Math.min(1, h / 0.18);
      const half: THREE.Vector3[] = [];
      const topSideX = xr + rc * 0.25;
      const topSideY = yb + h - rc;
      for (const u of sideU) half.push(new THREE.Vector3(xb + (topSideX - xb) * u, yb + (topSideY - yb) * u, s.z));
      for (const u of cornerU) {
        const a = (1 - u) * (1 - u);
        const bb = 2 * (1 - u) * u;
        const c = u * u;
        half.push(new THREE.Vector3(
          a * topSideX + bb * (xr + rc * 0.05) + c * (xr - rc),
          a * topSideY + bb * (yb + h) + c * (yb + h),
          s.z,
        ));
      }
      const xRoof = xr - rc;
      for (const f of roofF) {
        const x = xRoof * f;
        half.push(new THREE.Vector3(x, yb + h + crown * (1 - f * f), s.z));
      }
      const row = [...half];
      for (let i = half.length - 2; i >= 0; i--) row.push(new THREE.Vector3(-half[i].x, half[i].y, half[i].z));
      grid.push(row);
    }

    const cols = grid[0].length;
    const surfaceAt = (r: number, c: number): Surface => {
      const t = (ts[r] + ts[r + 1]) / 2;
      // Piece of the quad: judged from the column further from the roof centre.
      const idx = c < halfCount - 1 ? c : cols - 2 - c;
      const piece = pieceOf[Math.max(0, Math.min(pieceOf.length - 1, idx))];
      const inWindscreen = t < gh.roofStart;
      const inRear = t > gh.roofEnd;
      if (piece === 'seal') return SURF.seal;
      if (piece === 'side') {
        if (t < gh.start + 0.012) return gh.pillar;
        if (gh.bPillar !== null && Math.abs(t - gh.bPillar) < 0.012) return SURF.trimGloss;
        if (t > gh.sideGlassEnd) return gh.pillar;
        return SURF.glass;
      }
      if (piece === 'corner') {
        if (inWindscreen || inRear) return gh.pillar;
        return gh.roofSurface;
      }
      // Roof piece. The outermost roof quad in each glass area is the black
      // frit band every bonded screen has round its edge.
      const firstRoofQuad = sideU.length - 1 + cornerU.length;
      if (inWindscreen) return idx === firstRoofQuad ? SURF.seal : SURF.glass;
      if (inRear) return idx === firstRoofQuad && gh.rearSurface === SURF.glass ? SURF.seal : gh.rearSurface;
      return gh.roofSurface;
    };

    b.addGrid(grid, { closed: false, surfaceAt });
  }

  /* ------------------------------------------------------------- queries */

  /** Where the tail panel is, at lateral x and height y. */
  tailZ(x: number, y: number): number {
    return this.capZ(1, x, y);
  }

  noseZ(x: number, y: number): number {
    return this.capZ(0, x, y);
  }

  private capZ(t: 0 | 1, x: number, y: number): number {
    const s = this.section(t);
    const half = this.outline(s);
    const spec = t === 1 ? this.spec.tail : this.spec.nose;
    const dir = t === 1 ? 1 : -1;
    const frame = capFrame(half);
    // The column this point lies on runs from the spine point nearest it out
    // through it to the outline: find where it leaves, then walk the same
    // rings the panel was built from.
    const ax = Math.abs(x);
    const sx = spinePoint(frame, ax);
    const off = Math.hypot(ax - sx, y - frame.cy);
    const share = crownShare(frame, sx);
    if (off < 1e-6) return s.z + dir * crownPush(spec, share);
    const rings = (span: number): Array<[number, number]> => capProfile(span, spec, this.detail, share);
    const span = rayToOutline(half, sx, frame.cy, (ax - sx) / off, (y - frame.cy) / off);
    if (!Number.isFinite(span)) return s.z;
    const d = span - off;
    if (d <= 0) return s.z;
    let prevD = 0;
    let prevPush = 0;
    for (const [ringD, push] of rings(span)) {
      if (d <= ringD) {
        const f = (d - prevD) / Math.max(ringD - prevD, 1e-9);
        return s.z + dir * (prevPush + (push - prevPush) * f);
      }
      prevD = ringD;
      prevPush = push;
    }
    return s.z + dir * prevPush;
  }

  /** Height of the top surface at (x, t), cockpit included. */
  topAt(x: number, t: number): number {
    const s = this.section(t);
    return this.topY(s, x) - s.well * (Math.abs(x) < (s.xs - s.rs) * (this.spec.cockpit?.edge ?? 0) ? 1 : 0);
  }

  /** Shoulder height and x at t. */
  shoulderAt(t: number): { x: number; y: number; hw: number; rock: number } {
    const s = this.section(t);
    return { x: s.xs, y: s.yBelt, hw: s.hw, rock: s.yRock };
  }

  /** Highest point of the section's top surface at t. */
  topCentre(t: number): number {
    return this.section(t).yTop;
  }
}

/* ----------------------------------------------------------------- caps */

/*
 * A nose or tail panel closes the body's last section.
 *
 * Every outline point travels inwards to the nearest point of a horizontal
 * spine across the middle of the panel, and stands further out beyond the last
 * section the further in it gets. Travelling to a spine rather than to a single
 * centre is the point. A pole gathers every column into one vertex and fans
 * long thin triangles across the face: that shaded as crumpled foil, and
 * anything painted onto it — a grille, an intake — came out with stair-stepped
 * edges. Travelling to a spine keeps every ring parallel to the outline, so the
 * panel is a regular grid all the way in and its rows run level.
 *
 * Across the rings the profile is one smooth curve: a round of the fillet's
 * radius turning from the flanks towards the front, then the dome of the bulge
 * rising to its crown at the spine, tangent where the two meet and level at
 * the crown.
 */

/**
 * Where a panel's rings converge — the segment y = cy, |x| <= w — and the
 * panel's half-width at that height.
 */
interface CapFrame {
  readonly cy: number;
  readonly w: number;
  readonly reach: number;
}

function capFrame(half: readonly Pt[]): CapFrame {
  // Halfway between the floor and the top centreline...
  const cy = (half[0].y + half[half.length - 1].y) / 2;
  const h = (half[half.length - 1].y - half[0].y) / 2;
  // ...and as long as the panel is wide at that height, less its half-height,
  // so the flanks travel as far to the spine's ends as the top and floor do.
  let reach = 0;
  for (let i = 0; i < half.length - 1; i++) {
    const a = half[i];
    const b = half[i + 1];
    if ((a.y - cy) * (b.y - cy) <= 0 && a.y !== b.y) {
      reach = Math.max(reach, a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  return { cy, w: Math.max(0, reach - h), reach };
}

/**
 * How much of the bulge a column rises by, from the spine point it travels to:
 * all of it on the centreline, less towards the corners. A dome of one height
 * all along the spine makes the panel a cylinder with a knob at each end,
 * where a nose or a tail is rounded in plan as well.
 */
function crownShare(frame: CapFrame, sx: number): number {
  return frame.reach > 0 ? 1 - (sx / frame.reach) ** 2 : 1;
}

/** How far a panel's crown stands beyond its last section, at a spine point. */
function crownPush(spec: CapSpec, share: number): number {
  return spec.fillet + spec.bulge * share;
}

/**
 * One column's rings: [distance travelled inwards, push beyond the section]
 * for each, outline excluded and spine included. `span` is the column's
 * distance from its outline point to the spine, and `share` how much of the
 * bulge it rises by (see `crownShare`).
 *
 * Every column ends at the crown height of its spine point, whatever its own
 * span. Columns from above and below the spine meet there, and a crown that
 * depended on the column would stand at two heights along one line and open
 * a crack between them.
 */
function capProfile(span: number, spec: CapSpec, detail: Detail, share: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const fillet = Math.min(spec.fillet, span * 0.8);
  const crown = crownPush(spec, share);
  /* The fillet turns through `alpha` and hands over to a dome
   * z = z0 + (crown - z0) * (2u - u^2) across the rest of the span. The dome
   * starts at slope 2 * (crown - z0) / (span - d0), so the round stops where
   * its own tangent matches that:
   *   cos(a) * (span - d0(a)) = 2 * (crown - z0(a)) * sin(a).
   * The difference of the two sides falls with a, is positive at zero and is
   * not above zero at a right angle, since crown >= fillet — bisect. */
  let lo = 0;
  let hi = Math.PI / 2;
  for (let i = 0; i < 32; i++) {
    const a = (lo + hi) / 2;
    const g = Math.cos(a) * (span - fillet * (1 - Math.cos(a))) - 2 * (crown - fillet * Math.sin(a)) * Math.sin(a);
    if (g > 0) lo = a;
    else hi = a;
  }
  const alpha = (lo + hi) / 2;
  for (let k = 1; k <= detail.capFillet; k++) {
    const a = (alpha * k) / detail.capFillet;
    out.push([fillet * (1 - Math.cos(a)), fillet * Math.sin(a)]);
  }
  const d0 = fillet * (1 - Math.cos(alpha));
  const z0 = fillet * Math.sin(alpha);
  for (let j = 1; j <= detail.capFace; j++) {
    const u = j / detail.capFace;
    out.push([d0 + (span - d0) * u, z0 + (crown - z0) * (2 * u - u * u)]);
  }
  return out;
}

/** The point of a panel's spine an outline or panel point travels to. */
function spinePoint(frame: CapFrame, x: number): number {
  return clamp(x, -frame.w, frame.w);
}

/**
 * Where the ray from (sx, sy) through (x, y) leaves the half outline, as a
 * distance along the ray; Infinity if it never does.
 */
function rayToOutline(half: readonly Pt[], sx: number, sy: number, dx: number, dy: number): number {
  let best = Infinity;
  for (let i = 0; i < half.length - 1; i++) {
    const a = half[i];
    const b = half[i + 1];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - sx) * ey - (a.y - sy) * ex) / den;
    const u = ((a.x - sx) * dy - (a.y - sy) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

/** Planar UV projection for a patterned body region, clamped to its atlas rect. */
export function planarUv(
  axisU: 'x' | 'y' | 'z',
  axisV: 'x' | 'y' | 'z',
  u0: number, u1: number, v0: number, v1: number,
): (p: THREE.Vector3, s: Surface) => readonly [number, number] {
  return (p, s) => {
    if (s.tex === ATLAS.white) return VehicleBuilder.atlasUv(s, 0.5, 0.5);
    const u = clamp((p[axisU] - u0) / (u1 - u0), 0, 1);
    const v = clamp((p[axisV] - v0) / (v1 - v0), 0, 1);
    return VehicleBuilder.atlasUv(s, u, v);
  };
}
