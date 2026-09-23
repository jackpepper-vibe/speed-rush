import * as THREE from 'three';
import type { DesignContext } from '../Design';
import { addWheel, pair, place, roundedBox } from '../Parts';
import { SURF, type Surface } from '../Surfaces';
import { VehicleBuilder } from '../VehicleBuilder';

/** Four wheels on the body's own axles and tracks. */
export function fourWheels(ctx: DesignContext): void {
  const { b, shell, hero, far } = ctx;
  const spec = shell.spec;
  for (const side of [1, -1] as const) {
    addWheel(b, spec.frontWheel, new THREE.Vector3(side * spec.track / 2, spec.frontWheel.radius, shell.frontAxleZ), side, true, hero, far);
    addWheel(b, spec.rearWheel, new THREE.Vector3(side * spec.rearTrack / 2, spec.rearWheel.radius, shell.rearAxleZ), side, false, hero, far);
  }
}

/**
 * Diffuser strakes in the lower tail, pairs at each |x| in `xs`.
 *
 * Measured from the body's own sill at the tail, so they stand inside the
 * carbon band and stick out behind it — the way a diffuser's fins are seen.
 * Hung from a fixed height they dropped below the sill and read from behind
 * as a row of teeth.
 */
export function diffuserFins(ctx: DesignContext, xs: readonly number[], height: number, depth: number): void {
  const { b, shell } = ctx;
  const sill = shell.shoulderAt(0.99).rock;
  const y = sill + height / 2;
  const behind = 0.06;
  for (const x of xs) {
    const z = shell.tailZ(x, y) + behind - depth / 2;
    pair(b, roundedBox(0.014, height, depth, 0.004, 1), place(x, y, z), SURF.carbon);
  }
}

/** z of a station, for a car of length `L`. */
export function stationZ(L: number, t: number): number {
  return -L / 2 + t * L;
}

/** Outline of a grille or intake on a nose or tail panel. */
export interface InsetShape {
  /** Centre, in body coordinates. */
  readonly x: number;
  readonly y: number;
  readonly halfW: number;
  readonly halfH: number;
  /**
   * Superellipse exponents across and up: 2 is an ellipse, and the higher
   * they go the squarer the outline, always with rounded corners.
   */
  readonly nx: number;
  readonly ny: number;
}

export interface InsetOptions {
  /** The surround turned back into the body round the edge. */
  readonly rim?: Surface;
  /** Also build the mirror image at -x. */
  readonly mirror?: boolean;
}

/** How far an inset stands proud of its panel, and how far its lip sinks in. */
const INSET_LIFT = 0.004;
const INSET_SINK = 0.012;

/**
 * A grille or intake set into a nose or tail panel.
 *
 * A patch that follows the panel's surface, standing a few millimetres proud
 * of it, with a lip turned back into the body so no gap shows at a grazing
 * angle; the lip reads as the surround a real grille has. Painting a feature
 * onto the panel's own quads cannot give it a clean outline: its edge lands
 * wherever the grid does, and a grid fine enough for a crisp curve is a grid
 * the rest of the panel does not need.
 */
export function capInsert(
  ctx: DesignContext, end: 'nose' | 'tail', shape: InsetShape, surface: Surface, opts: InsetOptions = {},
): void {
  const { b, shell, hero, far } = ctx;
  const dir = end === 'tail' ? 1 : -1;
  const rim = opts.rim ?? SURF.trimGloss;
  const around = hero ? 48 : far ? 16 : 28;
  const rings = hero ? 4 : far ? 1 : 2;
  const surfaceZ = (x: number, y: number): number => (end === 'tail' ? shell.tailZ(x, y) : shell.noseZ(x, y));
  const eps = 0.004;
  // The panel's outward normal at (x, y), from its slope.
  const normalAt = (x: number, y: number): THREE.Vector3 => {
    const zx = (surfaceZ(x + eps, y) - surfaceZ(x - eps, y)) / (2 * eps);
    const zy = (surfaceZ(x, y + eps) - surfaceZ(x, y - eps)) / (2 * eps);
    return new THREE.Vector3(-zx * dir, -zy * dir, dir).normalize();
  };

  const positions = new Map<number, THREE.Vector3>();
  const vertex = (p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, s: Surface): number => {
    const [uu, vv] = VehicleBuilder.atlasUv(s, u, v);
    const id = b.vertex(p.x, p.y, p.z, n.x, n.y, n.z, uu, vv, s);
    positions.set(id, p);
    return id;
  };
  // Wound to face `facing`, whichever way round the corners were listed.
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const triangle = (a: number, c: number, d: number, facing: THREE.Vector3): void => {
    const pa = positions.get(a) as THREE.Vector3;
    e1.subVectors(positions.get(c) as THREE.Vector3, pa);
    e2.subVectors(positions.get(d) as THREE.Vector3, pa);
    if (e1.cross(e2).dot(facing) >= 0) b.triangle(a, c, d);
    else b.triangle(a, d, c);
  };

  for (const side of opts.mirror ? [1, -1] : [1]) {
    const cx = shape.x * side;
    const outline: Array<[number, number]> = [];
    for (let i = 0; i < around; i++) {
      const a = (i / around) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      outline.push([
        cx + shape.halfW * Math.sign(c) * Math.abs(c) ** (2 / shape.nx),
        shape.y + shape.halfH * Math.sign(s) * Math.abs(s) ** (2 / shape.ny),
      ]);
    }
    const onPanel = (x: number, y: number, lift: number): THREE.Vector3 => new THREE.Vector3(x, y, surfaceZ(x, y) + dir * lift);
    const uvOf = (x: number, y: number): [number, number] => [
      (x - (cx - shape.halfW)) / (2 * shape.halfW),
      (y - (shape.y - shape.halfH)) / (2 * shape.halfH),
    ];

    // Face: rings from the outline in to the centre.
    const face: number[][] = [];
    for (let k = 0; k < rings; k++) {
      const f = 1 - k / rings;
      face.push(outline.map(([x, y]) => {
        const px = cx + (x - cx) * f;
        const py = shape.y + (y - shape.y) * f;
        return vertex(onPanel(px, py, INSET_LIFT), normalAt(px, py), ...uvOf(px, py), surface);
      }));
    }
    const centre = vertex(onPanel(cx, shape.y, INSET_LIFT), normalAt(cx, shape.y), 0.5, 0.5, surface);
    const outward = new THREE.Vector3(0, 0, dir);
    for (let k = 0; k < rings; k++) {
      for (let i = 0; i < around; i++) {
        const j = (i + 1) % around;
        if (k === rings - 1) {
          triangle(face[k][i], face[k][j], centre, outward);
        } else {
          triangle(face[k][i], face[k][j], face[k + 1][j], outward);
          triangle(face[k][i], face[k + 1][j], face[k + 1][i], outward);
        }
      }
    }

    // Lip: from the face's edge back into the body, facing out of the outline.
    const top: number[] = [];
    const bottom: number[] = [];
    const normals: THREE.Vector3[] = [];
    for (let i = 0; i < around; i++) {
      const [x0, y0] = outline[(i - 1 + around) % around];
      const [x1, y1] = outline[(i + 1) % around];
      // The outline runs anticlockwise seen from behind, so out is to its right.
      const n = new THREE.Vector3(y1 - y0, -(x1 - x0), 0).normalize();
      normals.push(n);
      const [x, y] = outline[i];
      top.push(vertex(onPanel(x, y, INSET_LIFT), n, 0.5, 0.5, rim));
      bottom.push(vertex(onPanel(x, y, -INSET_SINK), n, 0.5, 0.5, rim));
    }
    for (let i = 0; i < around; i++) {
      const j = (i + 1) % around;
      const facing = normals[i].clone().add(normals[j]);
      triangle(top[i], top[j], bottom[j], facing);
      triangle(top[i], bottom[j], bottom[i], facing);
    }
  }
}
