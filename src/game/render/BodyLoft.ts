import * as THREE from 'three';

/**
 * Car bodies built by lofting cross-sections along the length.
 *
 * The previous bodies were stacks of bevelled boxes. Bevelling rounds an edge
 * but it cannot make a surface flow — a haunch that swells over the rear arch
 * and falls into the tail, or a roofline that melts into the deck, is a
 * longitudinal curve, and no arrangement of boxes has one. That is what reads
 * as "blocky" at a glance regardless of how many boxes are used.
 *
 * A body here is a handful of hand-placed stations — nose, arch, screen, roof,
 * deck, tail — each describing the section at that point. The stations are
 * interpolated with a Catmull-Rom spline into many intermediate sections, and
 * those are skinned into a single closed mesh with averaged normals. The result
 * is one continuous surface whose adjacent faces differ by a few degrees, which
 * is exactly what the silhouette gate measures.
 */

/** One cross-section of the body. */
export interface Station {
  /** Position along the car, -1 at the nose to +1 at the tail. */
  t: number;
  /** Half-width of the section. */
  halfWidth: number;
  /** Underside and upper surface heights. */
  yBottom: number;
  yTop: number;
  /**
   * How much narrower the section is at the top than at the waist. 1 is a slab;
   * 0.5 is a strongly tumblehome greenhouse.
   */
  roofRatio: number;
  /**
   * Section cornering, as the reciprocal of a superellipse exponent.
   *
   * The useful range is wider than it looks and the middle of it is the
   * boundary, not the default. At **1** the section is a plain ellipse. **Below
   * 1** the exponent rises above one and the outline is drawn in towards the
   * axes — a pinched, diamond-ish section with a ridge along the spine, which
   * is what every sports profile in this file wants and uses. **Above 1** it
   * falls below one and the outline pushes out towards its bounding box: a
   * rounded rectangle, which is what a saloon, an estate or a van is.
   *
   * The name is honest about intent and misleading about direction, and that
   * cost an iteration. Until the traffic profiles were authored, every body
   * here was a sports car sitting between 0.26 and 0.66, so the half of the
   * range that makes a box had never been used — and the resample clamp
   * stopped at 0.98, which made it unreachable as well as unused.
   */
  squareness: number;
}

export interface LoftOptions {
  /** Points around each section. More is smoother and costs a ring of quads. */
  ringSegments?: number;
  /** Interpolated sections between the outermost stations. */
  lengthSegments?: number;
  /** Overall length in world units; `t` is scaled to this. */
  length: number;
}

/**
 * Evaluate a section outline.
 *
 * A superellipse, which is the cheapest shape that goes from ellipse to
 * rounded-rectangle with one parameter — and a car section is somewhere between
 * the two at every point along the body.
 */
function sectionPoint(station: Station, angle: number, out: THREE.Vector2): THREE.Vector2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const n = 2 / station.squareness;

  const cx = Math.sign(c) * Math.pow(Math.abs(c), n);
  const cy = Math.sign(s) * Math.pow(Math.abs(s), n);

  const midY = (station.yTop + station.yBottom) / 2;
  const halfHeight = (station.yTop - station.yBottom) / 2;

  // Narrow the upper half toward the roof: the tumblehome that separates a car
  // from a van, applied as a function of height rather than as a second shape.
  const upper = Math.max(0, cy);
  const width = station.halfWidth * (1 - (1 - station.roofRatio) * upper);

  return out.set(cx * width, midY + cy * halfHeight);
}

/**
 * Interpolate the station list onto a dense set of sections.
 *
 * Catmull-Rom through the control values rather than straight lines between
 * them: a linear blend between two stations produces a visible crease at every
 * station, which is the same fault as the boxes in a subtler form.
 */
function resample(stations: Station[], count: number): Station[] {
  const sorted = [...stations].sort((a, b) => a.t - b.t);
  const curveFor = (pick: (s: Station) => number): THREE.CatmullRomCurve3 =>
    new THREE.CatmullRomCurve3(
      sorted.map((s) => new THREE.Vector3(s.t, pick(s), 0)),
      false,
      'catmullrom',
      0.5,
    );

  const width = curveFor((s) => s.halfWidth);
  const bottom = curveFor((s) => s.yBottom);
  const top = curveFor((s) => s.yTop);
  const roof = curveFor((s) => s.roofRatio);
  const square = curveFor((s) => s.squareness);

  const point = new THREE.Vector3();
  const out: Station[] = [];
  for (let i = 0; i <= count; i++) {
    const u = i / count;
    out.push({
      t: width.getPoint(u, point).x,
      halfWidth: Math.max(0.02, width.getPoint(u, point).y),
      yBottom: bottom.getPoint(u, point).y,
      yTop: top.getPoint(u, point).y,
      roofRatio: THREE.MathUtils.clamp(roof.getPoint(u, point).y, 0.2, 1),
      // Ceiling raised from 0.98 so a rounded-rectangle section is reachable at
      // all. Every profile authored before the traffic bodies sits below 0.98,
      // so nothing that existed then can be moved by this.
      squareness: THREE.MathUtils.clamp(square.getPoint(u, point).y, 0.15, 3.6),
    });
  }
  // Guard against the spline overshooting into a reversed body.
  for (let i = 1; i < out.length; i++) {
    if (out[i].t <= out[i - 1].t) out[i].t = out[i - 1].t + 1e-4;
  }
  return out;
}

/**
 * Skin a station list into a closed body.
 *
 * Normals are computed across the whole mesh at the end rather than per quad,
 * so a vertex shared by four faces averages them and the surface shades as one
 * continuous thing. This is the step that actually removes the faceting; the
 * spline only decides where the surface goes.
 */
export function loftBody(stations: Station[], options: LoftOptions): THREE.BufferGeometry {
  const ring = options.ringSegments ?? 28;
  const along = options.lengthSegments ?? 44;
  const half = options.length / 2;

  const sections = resample(stations, along);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const p = new THREE.Vector2();

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const z = section.t * half;
    for (let j = 0; j < ring; j++) {
      // Start at the outer waist so the seam falls on the flank, where a
      // texture discontinuity is least visible.
      sectionPoint(section, (j / ring) * Math.PI * 2, p);
      positions.push(p.x, p.y, z);
      uvs.push(j / ring, i / (sections.length - 1));
    }
  }

  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j;
      const b = i * ring + ((j + 1) % ring);
      const c = (i + 1) * ring + ((j + 1) % ring);
      const d = (i + 1) * ring + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  // Cap both ends by fanning to a centre vertex, so the body is closed and
  // does not show its hollow interior through the windscreen.
  for (const [index, sign] of [[0, -1], [sections.length - 1, 1]] as const) {
    const section = sections[index];
    const centre = positions.length / 3;
    positions.push(0, (section.yTop + section.yBottom) / 2, section.t * half);
    uvs.push(0.5, 0.5);
    for (let j = 0; j < ring; j++) {
      const a = index * ring + j;
      const b = index * ring + ((j + 1) % ring);
      if (sign < 0) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------- body shapes */

/**
 * Station sets per body style.
 *
 * Written as a profile you could read off a side elevation: where the nose
 * starts, how far the arches swell, where the screen rakes back, where the roof
 * runs, and how the tail is cut off.
 */
export const BODY_STATIONS: Record<string, Station[]> = {
  /*
   * Mid-engined supercar: cab-forward, so the cabin crest sits well ahead of
   * centre and the engine deck *behind* it is lower than the roof. Hips over
   * the rear axle are the widest point. A roofline that falls and then runs
   * level is the classic mid-engined read and no front-engined car can do it.
   */
  super: [
    { t: -1.00, halfWidth: 0.52, yBottom: 0.22, yTop: 0.32, roofRatio: 0.82, squareness: 0.28 },
    { t: -0.80, halfWidth: 0.84, yBottom: 0.13, yTop: 0.52, roofRatio: 0.74, squareness: 0.34 },
    { t: -0.56, halfWidth: 0.98, yBottom: 0.12, yTop: 0.68, roofRatio: 0.66, squareness: 0.42 },
    { t: -0.34, halfWidth: 1.02, yBottom: 0.11, yTop: 1.00, roofRatio: 0.52, squareness: 0.48 },
    { t: -0.14, halfWidth: 1.03, yBottom: 0.11, yTop: 1.22, roofRatio: 0.44, squareness: 0.50 },
    { t:  0.06, halfWidth: 1.05, yBottom: 0.11, yTop: 1.14, roofRatio: 0.48, squareness: 0.50 },
    { t:  0.28, halfWidth: 1.10, yBottom: 0.12, yTop: 0.94, roofRatio: 0.62, squareness: 0.52 },
    { t:  0.54, halfWidth: 1.15, yBottom: 0.13, yTop: 0.92, roofRatio: 0.70, squareness: 0.52 },
    { t:  0.80, halfWidth: 1.13, yBottom: 0.15, yTop: 0.90, roofRatio: 0.76, squareness: 0.48 },
    { t:  1.00, halfWidth: 0.98, yBottom: 0.24, yTop: 0.82, roofRatio: 0.84, squareness: 0.40 },
  ],
  /*
   * Hyper: the extreme of the wedge and the supercar at once. Lowest canopy,
   * widest hips, and a deck behind the cockpit that drops away to a cut tail.
   * Almost no tumblehome at the nose and a great deal at the cockpit, so the
   * canopy reads as a bubble dropped into a very wide, very flat car.
   */
  hyper: [
    { t: -1.00, halfWidth: 0.50, yBottom: 0.18, yTop: 0.24, roofRatio: 0.80, squareness: 0.22 },
    { t: -0.82, halfWidth: 0.86, yBottom: 0.10, yTop: 0.40, roofRatio: 0.70, squareness: 0.28 },
    { t: -0.58, halfWidth: 1.04, yBottom: 0.09, yTop: 0.56, roofRatio: 0.60, squareness: 0.34 },
    { t: -0.36, halfWidth: 1.09, yBottom: 0.09, yTop: 0.84, roofRatio: 0.44, squareness: 0.40 },
    { t: -0.14, halfWidth: 1.10, yBottom: 0.09, yTop: 1.06, roofRatio: 0.36, squareness: 0.42 },
    { t:  0.08, halfWidth: 1.12, yBottom: 0.09, yTop: 1.00, roofRatio: 0.40, squareness: 0.42 },
    { t:  0.32, halfWidth: 1.18, yBottom: 0.10, yTop: 0.82, roofRatio: 0.56, squareness: 0.44 },
    { t:  0.60, halfWidth: 1.22, yBottom: 0.11, yTop: 0.78, roofRatio: 0.66, squareness: 0.44 },
    { t:  0.86, halfWidth: 1.20, yBottom: 0.13, yTop: 0.76, roofRatio: 0.74, squareness: 0.40 },
    { t:  1.00, halfWidth: 1.02, yBottom: 0.20, yTop: 0.70, roofRatio: 0.82, squareness: 0.34 },
  ],
  /*
   * Wedge: a single straight rise from the lowest nose on the grid to a tail
   * that is still climbing when the car runs out, cut off square. No crest at
   * all — the roofline never turns over, which is what separates it from the
   * coupe it used to be a copy of.
   */
  wedge: [
    { t: -1.00, halfWidth: 0.54, yBottom: 0.22, yTop: 0.30, roofRatio: 0.84, squareness: 0.26 },
    { t: -0.76, halfWidth: 0.86, yBottom: 0.13, yTop: 0.52, roofRatio: 0.76, squareness: 0.34 },
    { t: -0.48, halfWidth: 0.98, yBottom: 0.12, yTop: 0.74, roofRatio: 0.68, squareness: 0.40 },
    { t: -0.18, halfWidth: 1.03, yBottom: 0.12, yTop: 0.94, roofRatio: 0.58, squareness: 0.44 },
    { t:  0.12, halfWidth: 1.05, yBottom: 0.12, yTop: 1.10, roofRatio: 0.50, squareness: 0.46 },
    { t:  0.44, halfWidth: 1.07, yBottom: 0.13, yTop: 1.20, roofRatio: 0.50, squareness: 0.46 },
    { t:  0.74, halfWidth: 1.08, yBottom: 0.14, yTop: 1.22, roofRatio: 0.56, squareness: 0.44 },
    { t:  0.94, halfWidth: 1.06, yBottom: 0.17, yTop: 1.20, roofRatio: 0.66, squareness: 0.40 },
    { t:  1.00, halfWidth: 0.96, yBottom: 0.24, yTop: 1.14, roofRatio: 0.74, squareness: 0.36 },
  ],
  /*
   * Fastback coupe: one unbroken line from a crest just ahead of centre all
   * the way to the tail. Nothing flat anywhere, and the lowest tail of the
   * front-engined cars — where the hatch drops off a cliff, this pours away.
   */
  coupe: [
    { t: -1.00, halfWidth: 0.56, yBottom: 0.24, yTop: 0.42, roofRatio: 0.86, squareness: 0.32 },
    { t: -0.80, halfWidth: 0.86, yBottom: 0.16, yTop: 0.58, roofRatio: 0.80, squareness: 0.40 },
    { t: -0.52, halfWidth: 0.96, yBottom: 0.15, yTop: 0.70, roofRatio: 0.76, squareness: 0.46 },
    { t: -0.24, halfWidth: 1.00, yBottom: 0.14, yTop: 1.06, roofRatio: 0.62, squareness: 0.52 },
    { t: -0.02, halfWidth: 1.01, yBottom: 0.14, yTop: 1.32, roofRatio: 0.52, squareness: 0.54 },
    { t:  0.26, halfWidth: 1.01, yBottom: 0.15, yTop: 1.22, roofRatio: 0.54, squareness: 0.52 },
    { t:  0.56, halfWidth: 1.02, yBottom: 0.16, yTop: 1.02, roofRatio: 0.60, squareness: 0.48 },
    { t:  0.82, halfWidth: 1.00, yBottom: 0.18, yTop: 0.84, roofRatio: 0.70, squareness: 0.42 },
    { t:  1.00, halfWidth: 0.88, yBottom: 0.24, yTop: 0.74, roofRatio: 0.80, squareness: 0.36 },
  ],
  /*
   * Muscle: a long, flat, low bonnet running a third of the car, then an
   * abrupt screen, a flat roof, and a notch down to a short square boot.
   * Slab-sided (the highest squareness of any player body) and widest over
   * the rear axle. The bonnet plateau at 0.80 is the signature.
   */
  muscle: [
    { t: -1.00, halfWidth: 0.68, yBottom: 0.26, yTop: 0.60, roofRatio: 0.92, squareness: 0.56 },
    { t: -0.82, halfWidth: 0.98, yBottom: 0.18, yTop: 0.78, roofRatio: 0.90, squareness: 0.68 },
    { t: -0.56, halfWidth: 1.06, yBottom: 0.17, yTop: 0.80, roofRatio: 0.88, squareness: 0.76 },
    { t: -0.34, halfWidth: 1.07, yBottom: 0.16, yTop: 0.82, roofRatio: 0.88, squareness: 0.78 },
    { t: -0.20, halfWidth: 1.07, yBottom: 0.16, yTop: 1.16, roofRatio: 0.76, squareness: 0.76 },
    { t: -0.02, halfWidth: 1.07, yBottom: 0.16, yTop: 1.44, roofRatio: 0.68, squareness: 0.74 },
    { t:  0.30, halfWidth: 1.08, yBottom: 0.16, yTop: 1.44, roofRatio: 0.68, squareness: 0.74 },
    { t:  0.48, halfWidth: 1.09, yBottom: 0.17, yTop: 1.18, roofRatio: 0.78, squareness: 0.76 },
    { t:  0.70, halfWidth: 1.10, yBottom: 0.17, yTop: 1.06, roofRatio: 0.84, squareness: 0.78 },
    { t:  1.00, halfWidth: 0.98, yBottom: 0.26, yTop: 1.02, roofRatio: 0.88, squareness: 0.70 },
  ],
  /*
   * The three below are traffic-only profiles, and until now they had no
   * entry here at all.
   *
   * `buildCar` lofts a body when the profile has stations and falls back to
   * stacked bevelled boxes when it does not — so `sedan`, `suv` and `van` took
   * the fallback on every tier, whatever detail was asked for. Iteration 28
   * tiered traffic's *fittings* and could not touch this, because the boxes
   * were not a level of detail; they were the absence of a model. That is the
   * "boxy silhouettes" in the operator's list, and it is three table entries.
   *
   * Authored flatter and squarer than the player bodies on purpose. A saloon
   * is not a supercar with the roof raised: it has a shallower screen rake, far
   * less tumblehome, and a boot deck rather than a fastback. The parameters
   * that carry that are `roofRatio` near 0.8 and up, and `squareness` well
   * above the sports profiles'.
   */
  sedan: [
    { t: -1.00, halfWidth: 0.62, yBottom: 0.26, yTop: 0.56, roofRatio: 0.88, squareness: 1.45 },
    { t: -0.80, halfWidth: 0.88, yBottom: 0.19, yTop: 0.72, roofRatio: 0.86, squareness: 1.90 },
    { t: -0.52, halfWidth: 0.95, yBottom: 0.17, yTop: 0.82, roofRatio: 0.84, squareness: 2.25 },
    { t: -0.22, halfWidth: 0.97, yBottom: 0.16, yTop: 1.12, roofRatio: 0.80, squareness: 2.45 },
    { t: 0.08, halfWidth: 0.98, yBottom: 0.16, yTop: 1.30, roofRatio: 0.84, squareness: 2.55 },
    { t: 0.40, halfWidth: 0.98, yBottom: 0.17, yTop: 1.28, roofRatio: 0.84, squareness: 2.55 },
    // The boot: the deck drops away from the roof and then runs level to the
    // tail, which is the one line that distinguishes a saloon from a hatch.
    { t: 0.70, halfWidth: 0.96, yBottom: 0.18, yTop: 0.98, roofRatio: 0.82, squareness: 2.30 },
    { t: 1.00, halfWidth: 0.88, yBottom: 0.26, yTop: 0.92, roofRatio: 0.88, squareness: 1.75 },
  ],
  suv: [
    { t: -1.00, halfWidth: 0.68, yBottom: 0.24, yTop: 0.72, roofRatio: 0.90, squareness: 1.70 },
    { t: -0.80, halfWidth: 0.92, yBottom: 0.16, yTop: 0.92, roofRatio: 0.88, squareness: 2.20 },
    { t: -0.54, halfWidth: 0.98, yBottom: 0.14, yTop: 1.06, roofRatio: 0.86, squareness: 2.60 },
    { t: -0.26, halfWidth: 1.00, yBottom: 0.13, yTop: 1.50, roofRatio: 0.86, squareness: 2.85 },
    { t: 0.06, halfWidth: 1.00, yBottom: 0.13, yTop: 1.72, roofRatio: 0.90, squareness: 2.95 },
    { t: 0.44, halfWidth: 1.00, yBottom: 0.14, yTop: 1.74, roofRatio: 0.90, squareness: 2.95 },
    { t: 0.80, halfWidth: 0.98, yBottom: 0.16, yTop: 1.70, roofRatio: 0.82, squareness: 2.75 },
    // Cut off square: an estate back, not a fastback. The tail stays nearly as
    // tall as the roof, which is most of what reads as "a big one" at range.
    { t: 1.00, halfWidth: 0.92, yBottom: 0.24, yTop: 1.56, roofRatio: 0.88, squareness: 2.20 },
  ],
  van: [
    { t: -1.00, halfWidth: 0.70, yBottom: 0.22, yTop: 0.84, roofRatio: 0.92, squareness: 1.95 },
    { t: -0.84, halfWidth: 0.94, yBottom: 0.15, yTop: 1.10, roofRatio: 0.90, squareness: 2.55 },
    { t: -0.62, halfWidth: 1.00, yBottom: 0.13, yTop: 1.46, roofRatio: 0.88, squareness: 2.95 },
    // The screen goes up almost where the nose ends: a van is a cab with a box
    // behind it, and the short bonnet is the whole silhouette.
    { t: -0.34, halfWidth: 1.01, yBottom: 0.12, yTop: 2.00, roofRatio: 0.86, squareness: 3.20 },
    { t: 0.02, halfWidth: 1.01, yBottom: 0.12, yTop: 2.12, roofRatio: 0.88, squareness: 3.35 },
    { t: 0.44, halfWidth: 1.01, yBottom: 0.13, yTop: 2.12, roofRatio: 0.88, squareness: 3.35 },
    { t: 0.82, halfWidth: 1.00, yBottom: 0.15, yTop: 2.08, roofRatio: 0.90, squareness: 3.20 },
    { t: 1.00, halfWidth: 0.94, yBottom: 0.22, yTop: 1.96, roofRatio: 0.92, squareness: 2.60 },
  ],
  /*
   * Hot hatch: short, tall and upright, with a roof that goes flat early
   * and a tailgate that falls off the back of it. The only body here whose
   * peak is a plateau rather than a crest — that plateau and the near-vertical
   * drop at t=0.9 are the whole read, and they are what no other car has.
   */
  hatch: [
    { t: -1.00, halfWidth: 0.62, yBottom: 0.26, yTop: 0.60, roofRatio: 0.90, squareness: 0.52 },
    { t: -0.78, halfWidth: 0.90, yBottom: 0.19, yTop: 0.78, roofRatio: 0.86, squareness: 0.62 },
    { t: -0.50, halfWidth: 0.95, yBottom: 0.18, yTop: 0.86, roofRatio: 0.82, squareness: 0.70 },
    { t: -0.22, halfWidth: 0.96, yBottom: 0.17, yTop: 1.34, roofRatio: 0.74, squareness: 0.72 },
    { t:  0.06, halfWidth: 0.97, yBottom: 0.17, yTop: 1.56, roofRatio: 0.72, squareness: 0.74 },
    { t:  0.40, halfWidth: 0.97, yBottom: 0.17, yTop: 1.57, roofRatio: 0.72, squareness: 0.74 },
    { t:  0.70, halfWidth: 0.96, yBottom: 0.18, yTop: 1.52, roofRatio: 0.74, squareness: 0.72 },
    { t:  0.90, halfWidth: 0.93, yBottom: 0.20, yTop: 1.24, roofRatio: 0.80, squareness: 0.66 },
    { t:  1.00, halfWidth: 0.88, yBottom: 0.26, yTop: 1.02, roofRatio: 0.86, squareness: 0.58 },
  ],
};

/** Fraction of adjacent faces meeting within `limit` degrees. The anti-box metric. */
export function silhouetteSmoothness(geometry: THREE.BufferGeometry, limit = 20): number {
  const index = geometry.getIndex();
  const pos = geometry.getAttribute('position');
  if (!index) return 0;

  // Face normal per triangle, keyed by edge, so shared edges can be compared.
  const normals: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (let f = 0; f < index.count; f += 3) {
    a.fromBufferAttribute(pos, index.getX(f));
    b.fromBufferAttribute(pos, index.getX(f + 1));
    c.fromBufferAttribute(pos, index.getX(f + 2));
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normals.push(new THREE.Vector3().crossVectors(ab, ac).normalize());
  }

  const byEdge = new Map<string, number[]>();
  for (let f = 0; f < index.count; f += 3) {
    const face = f / 3;
    const v = [index.getX(f), index.getX(f + 1), index.getX(f + 2)];
    for (let e = 0; e < 3; e++) {
      const key = [v[e], v[(e + 1) % 3]].sort((x, y) => x - y).join(':');
      const list = byEdge.get(key);
      if (list) list.push(face);
      else byEdge.set(key, [face]);
    }
  }

  let shared = 0;
  let smooth = 0;
  const cosLimit = Math.cos(THREE.MathUtils.degToRad(limit));
  for (const faces of byEdge.values()) {
    if (faces.length !== 2) continue;
    shared += 1;
    const dot = normals[faces[0]].dot(normals[faces[1]]);
    if (dot >= cosLimit) smooth += 1;
  }
  return shared ? smooth / shared : 0;
}
