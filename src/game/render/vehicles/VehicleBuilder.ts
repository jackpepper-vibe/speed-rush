import * as THREE from 'three';
import type { Surface } from './Surfaces';
import { ATLAS } from './VehicleAtlas';

/**
 * Accumulates every part of one vehicle into a single geometry.
 *
 * Parts arrive as three.js geometries (lathed tyres, extruded rims, rounded
 * boxes) or as lofted grids (body, greenhouse), each tagged with a `Surface`.
 * Out comes one indexed `BufferGeometry` whose vertices carry the surface as
 * attributes the vehicle shader reads — see `VehicleMaterial`.
 *
 * Grids are emitted per quad, so a quad can be glass while its neighbour is a
 * pillar and the boundary between them is a crisp edge rather than a blend.
 * Vertices are shared wherever adjacent quads agree on a surface, so a body
 * that is mostly one surface costs about what its grid does.
 */

export interface GridOptions {
  /** The columns wrap around: the last column joins the first. */
  closed?: boolean;
  /** Surface of the quad spanning rows r..r+1 and columns c..c+1. */
  surfaceAt: (r: number, c: number) => Surface;
  /**
   * UV of a vertex, for surfaces that project a pattern onto the grid.
   * Defaults to the centre of the surface's atlas region.
   */
  uvAt?: (p: THREE.Vector3, s: Surface) => readonly [number, number];
  /**
   * Rows whose coincident vertices share one normal, averaged over them. For
   * rows that collapse onto a line or a point, such as a panel's crown, where
   * one-sided differences at the grid's edge would tilt the columns meeting
   * there apart and leave a crease along it.
   */
  weldRows?: readonly number[];
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class VehicleBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly srf: number[] = [];
  private readonly emt: number[] = [];
  private readonly whl: number[] = [];
  private readonly idx: number[] = [];
  private hub: [number, number, number, number] = [0, 0, 0, 0];
  private readonly linearCache = new Map<number, THREE.Color>();
  private readonly used = new Map<string, Surface>();

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Every surface the vehicle is made of so far, once each. */
  get surfaces(): readonly Surface[] {
    return [...this.used.values()];
  }

  /**
   * Everything added inside `build` turns about `hub`. Front wheels also
   * steer, which is what `front` records.
   */
  wheel(hub: THREE.Vector3, front: boolean, build: () => void): void {
    this.hub = [hub.x, hub.y, hub.z, front ? 2 : 1];
    try {
      build();
    } finally {
      this.hub = [0, 0, 0, 0];
    }
  }

  private linear(hex: number): THREE.Color {
    let c = this.linearCache.get(hex);
    if (!c) {
      c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
      this.linearCache.set(hex, c);
    }
    return c;
  }

  /** Map a part's own 0..1 UV into its surface's atlas region. */
  static atlasUv(s: Surface, u: number, v: number): [number, number] {
    const [u0, v0, u1, v1] = s.tex;
    return [u0 + (u1 - u0) * u, v0 + (v1 - v0) * v];
  }

  private centreUv(s: Surface): [number, number] {
    return VehicleBuilder.atlasUv(s, 0.5, 0.5);
  }

  vertex(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    s: Surface,
  ): number {
    const c = this.linear(s.color);
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    this.srf.push(s.roughness, s.metalness, s.clearcoat, s.paint);
    if (!this.used.has(s.name)) this.used.set(s.name, s);
    this.emt.push(s.lamp, s.glow);
    this.whl.push(this.hub[0], this.hub[1], this.hub[2], this.hub[3]);
    return this.pos.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /**
   * Append a three.js geometry through a transform.
   *
   * `surfaces` is either one surface for the whole geometry or one per
   * geometry group, indexed by the group's material index — which is how an
   * extruded rim gets a face and a side from a single call. A transform that
   * mirrors flips the winding back, so mirrored parts stay front-facing.
   */
  addGeometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, surfaces: Surface | readonly Surface[]): void {
    const position = geo.getAttribute('position') as THREE.BufferAttribute;
    let normal = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!normal) {
      geo.computeVertexNormals();
      normal = geo.getAttribute('normal') as THREE.BufferAttribute;
    }
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const index = geo.getIndex();
    const flip = matrix.determinant() < 0;
    _nm.getNormalMatrix(matrix);

    const surfaceFor = (i: number): Surface => {
      if (!Array.isArray(surfaces)) return surfaces as Surface;
      const list = surfaces as readonly Surface[];
      if (geo.groups.length === 0) return list[0];
      for (const g of geo.groups) {
        if (i >= g.start && i < g.start + g.count) return list[Math.min(g.materialIndex ?? 0, list.length - 1)];
      }
      return list[0];
    };

    const count = index ? index.count : position.count;
    // Vertices are re-emitted per surface, so a vertex used by two groups
    // with different surfaces is split rather than shared.
    const remap = new Map<number, number>();
    const emit = (vi: number, s: Surface, key: number): number => {
      const found = remap.get(key);
      if (found !== undefined) return found;
      _v.fromBufferAttribute(position, vi).applyMatrix4(matrix);
      _n.fromBufferAttribute(normal as THREE.BufferAttribute, vi).applyMatrix3(_nm).normalize();
      // Only patterned surfaces read the part's own UVs; plain ones sample the
      // white texel whatever the source geometry carries (extrusions use
      // world-space UVs that would wander across the atlas).
      const [u, v] = uv && s.tex !== ATLAS.white ? VehicleBuilder.atlasUv(s, uv.getX(vi), uv.getY(vi)) : this.centreUv(s);
      const out = this.vertex(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, u, v, s);
      remap.set(key, out);
      return out;
    };

    const ids = new Map<Surface, number>();
    for (let i = 0; i < count; i += 3) {
      const s = surfaceFor(i);
      let sid = ids.get(s);
      if (sid === undefined) {
        sid = ids.size;
        ids.set(s, sid);
      }
      const i0 = index ? index.getX(i) : i;
      const i1 = index ? index.getX(i + 1) : i + 1;
      const i2 = index ? index.getX(i + 2) : i + 2;
      const a = emit(i0, s, i0 * 16 + sid);
      const b = emit(i1, s, i1 * 16 + sid);
      const c = emit(i2, s, i2 * 16 + sid);
      if (flip) this.triangle(a, c, b);
      else this.triangle(a, b, c);
    }
  }

  /**
   * A planar quad with its UVs spanning the surface's whole atlas region.
   * Corners in order: bottom-left, bottom-right, top-right, top-left, as seen
   * from the side the quad faces.
   */
  quad(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, s: Surface): void {
    _a.subVectors(p1, p0);
    _b.subVectors(p3, p0);
    _n.crossVectors(_a, _b).normalize();
    const corners: Array<[THREE.Vector3, number, number]> = [[p0, 0, 0], [p1, 1, 0], [p2, 1, 1], [p3, 0, 1]];
    const ids = corners.map(([p, u, v]) => {
      const [uu, vv] = VehicleBuilder.atlasUv(s, u, v);
      return this.vertex(p.x, p.y, p.z, _n.x, _n.y, _n.z, uu, vv, s);
    });
    this.triangle(ids[0], ids[1], ids[2]);
    this.triangle(ids[0], ids[2], ids[3]);
  }

  /**
   * Skin a grid of points — rows along the car, columns around a section.
   *
   * Normals come from the grid itself by central differences, so they are
   * smooth across every surface boundary: glass meets pillar with a crisp
   * colour edge but no crease in the highlight running over both.
   */
  addGrid(grid: THREE.Vector3[][], opts: GridOptions): void {
    const rows = grid.length;
    const cols = grid[0].length;
    const closed = opts.closed ?? false;
    const normals = gridNormals(grid, closed);
    for (const r of opts.weldRows ?? []) weldRow(grid[r], normals[r]);

    const cache = new Map<number, number>();
    const sids = new Map<Surface, number>();
    const vert = (r: number, c: number, s: Surface): number => {
      let sid = sids.get(s);
      if (sid === undefined) {
        sid = sids.size;
        sids.set(s, sid);
      }
      const key = (r * cols + c) * 64 + sid;
      const found = cache.get(key);
      if (found !== undefined) return found;
      const p = grid[r][c];
      const n = normals[r][c];
      const [u, v] = opts.uvAt ? opts.uvAt(p, s) : this.centreUv(s);
      const id = this.vertex(p.x, p.y, p.z, n.x, n.y, n.z, u, v, s);
      cache.set(key, id);
      return id;
    };

    const quadCols = closed ? cols : cols - 1;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < quadCols; c++) {
        const c1 = (c + 1) % cols;
        const s = opts.surfaceAt(r, c);
        const pa = grid[r][c];
        const pb = grid[r][c1];
        const pc = grid[r + 1][c];
        const pd = grid[r + 1][c1];
        const a = vert(r, c, s);
        const b = vert(r, c1, s);
        const cc = vert(r + 1, c, s);
        const d = vert(r + 1, c1, s);
        if (!degenerate(pa, pb, pd)) this.triangle(a, b, d);
        if (!degenerate(pa, pd, pc)) this.triangle(a, d, cc);
      }
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('surf', new THREE.Float32BufferAttribute(this.srf, 4));
    g.setAttribute('emit', new THREE.Float32BufferAttribute(this.emt, 2));
    g.setAttribute('wheel', new THREE.Float32BufferAttribute(this.whl, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Give vertices of a row that sit at the same point one averaged normal. */
function weldRow(points: readonly THREE.Vector3[], normals: THREE.Vector3[]): void {
  const groups = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  });
  const sum = new THREE.Vector3();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    sum.set(0, 0, 0);
    for (const i of list) sum.add(normals[i]);
    if (sum.lengthSq() < 1e-12) continue;
    sum.normalize();
    for (const i of list) normals[i].copy(sum);
  }
}

function degenerate(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): boolean {
  _a.subVectors(b, a);
  _b.subVectors(c, a);
  return _n.crossVectors(_a, _b).lengthSq() < 1e-14;
}

/**
 * Per-vertex normals of a grid, by central differences.
 *
 * Rows that collapse to a point — the centre of a nose or tail cap — have no
 * tangent across them, so they borrow the average normal of the row beside
 * them instead.
 */
export function gridNormals(grid: THREE.Vector3[][], closed: boolean): THREE.Vector3[][] {
  const rows = grid.length;
  const cols = grid[0].length;
  const out: THREE.Vector3[][] = [];
  const tc = new THREE.Vector3();
  const tr = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const row: THREE.Vector3[] = [];
    for (let c = 0; c < cols; c++) {
      const cPrev = closed ? (c - 1 + cols) % cols : Math.max(0, c - 1);
      const cNext = closed ? (c + 1) % cols : Math.min(cols - 1, c + 1);
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(rows - 1, r + 1);
      tc.subVectors(grid[r][cNext], grid[r][cPrev]);
      tr.subVectors(grid[rNext][c], grid[rPrev][c]);
      const n = new THREE.Vector3().crossVectors(tc, tr);
      row.push(n.lengthSq() > 1e-16 ? n.normalize() : n.set(0, 0, 0));
    }
    out.push(row);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (out[r][c].lengthSq() > 0) continue;
      const neighbour = r === 0 ? 1 : r === rows - 1 ? rows - 2 : r + (r < rows / 2 ? 1 : -1);
      const avg = new THREE.Vector3();
      for (const n of out[neighbour]) avg.add(n);
      out[r][c].copy(avg.lengthSq() > 0 ? avg.normalize() : new THREE.Vector3(0, 1, 0));
    }
  }
  return out;
}
