import * as THREE from 'three';
import { curveAt, hillAt } from './RoadGeometry';

/**
 * A length of road surface, bent to follow the curve and the hills.
 *
 * The naive build — one flat plane per segment, positioned at that segment's
 * height — produces a staircase: every segment is level within itself, so
 * consecutive segments meet at a step rather than a join. At low amplitudes it
 * reads as z-fighting and at realistic ones the road visibly comes apart.
 *
 * Each strip therefore carries `rows + 1` rows of vertices whose positions are
 * sampled from the same `curveAt` / `hillAt` the rest of the world uses, so the
 * surface is continuous by construction: the last row of one segment is
 * computed from the same distance as the first row of the next, and they land
 * in exactly the same place.
 *
 * Vertices are rewritten only when a strip is recycled to a new stretch of
 * road, not every frame. The player-relative part of the transform — which does
 * change every frame — is carried on the parent group instead.
 */
/**
 * One point on the cross-section a strip extrudes along the road.
 *
 * `lateral` is the offset from the centreline, `height` the offset above the
 * deck. A road surface is a section whose points all sit at one height; a wall
 * is one whose points share a lateral; a crash barrier is neither. Expressing
 * all three as the same extrusion is what lets a corrugated rail follow the
 * same curve and crest the same hills as the tarmac beside it for nothing —
 * a separately placed rail would have to be kept in step by hand.
 */
export interface SectionPoint {
  readonly lateral: number;
  readonly height: number;
}

/**
 * Period, in world units, of the distance a road-coordinate attribute carries.
 *
 * Distance is written modulo this so it stays small enough for a shader to
 * take derivatives of after an hour of driving. It must be a multiple of the
 * segment length and of every pattern period drawn along the road — dashes,
 * texture tiles — so the wrap lands on a segment boundary and a whole number
 * of every pattern, and never shows.
 */
export const ROAD_COORD_PERIOD = 1000;

export class RoadStrip {
  readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  /**
   * Road-space coordinates per vertex — lateral, distance, height above the
   * deck — for surfaces whose shader draws by where on the road a point is
   * rather than by a texture stretched over the strip. Only allocated when
   * asked for.
   */
  private readonly coords: Float32Array | null;

  /** Absolute distance this strip currently starts at. */
  private startDistance = Number.NaN;

  constructor(
    private readonly section: readonly SectionPoint[],
    private readonly length: number,
    private readonly rows: number,
    /**
     * Extra elevation per vertex, as a function of where it is in the world.
     *
     * Given as a function of absolute lateral and absolute distance rather than
     * as baked heights, because a strip is recycled to a different stretch of
     * road every few seconds — baked heights would travel with the strip and
     * the hills would slide along with the car.
     */
    private readonly relief?: (lateral: number, distance: number) => number,
    withCoords = false,
  ) {
    this.positions = new Float32Array(section.length * (rows + 1) * 3);
    this.coords = withCoords ? new Float32Array(section.length * (rows + 1) * 4) : null;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.buildUVs(), 2));
    this.geometry.setIndex(this.buildIndices());
    if (this.coords) this.geometry.setAttribute('road', new THREE.BufferAttribute(this.coords, 4));
  }

  /** A horizontal surface spanning a set of lateral columns. */
  static flat(
    columns: readonly number[],
    length: number,
    rows: number,
    height = 0,
    relief?: (lateral: number, distance: number) => number,
  ): RoadStrip {
    return new RoadStrip(
      columns.map((lateral) => ({ lateral, height })), length, rows, relief,
    );
  }

  private buildUVs(): Float32Array {
    const cols = this.section.length;
    /* U runs across the section by arc length rather than by lateral offset,
     * so a texture on a corrugated profile is not stretched across the parts
     * of it that happen to be steep. On a flat strip this reduces exactly to
     * the normalised lateral position, which is what puts the lane markings
     * where the lanes are. */
    const arc: number[] = [0];
    for (let c = 1; c < cols; c++) {
      arc.push(arc[c - 1] + Math.hypot(
        this.section[c].lateral - this.section[c - 1].lateral,
        this.section[c].height - this.section[c - 1].height,
      ));
    }
    const total = arc[cols - 1] || 1;

    const uv = new Float32Array(cols * (this.rows + 1) * 2);
    let i = 0;
    for (let r = 0; r <= this.rows; r++) {
      for (let c = 0; c < cols; c++) {
        uv[i++] = arc[c] / total;
        // V runs along the road, tiled once per segment.
        uv[i++] = r / this.rows;
      }
    }
    return uv;
  }

  private buildIndices(): number[] {
    const cols = this.section.length;
    const idx: number[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
      }
    }
    return idx;
  }

  /**
   * Point this strip at the stretch of road beginning at `start`.
   *
   * A no-op when the strip is already there, which is the common case: only one
   * strip in the ring changes hands per segment length travelled.
   */
  setStart(start: number): void {
    if (start === this.startDistance) return;
    this.startDistance = start;

    const cols = this.section.length;
    const baseCurve = curveAt(start);
    const baseHill = hillAt(start);

    let i = 0;
    for (let r = 0; r <= this.rows; r++) {
      const t = r / this.rows;
      const u = start + t * this.length;
      // Local space: the strip's own origin sits on the centreline at
      // `start`, so these stay small however far the run has gone.
      const dx = curveAt(u) - baseCurve;
      const dy = hillAt(u) - baseHill;
      const z = -t * this.length;
      for (let c = 0; c < cols; c++) {
        const lateral = this.section[c].lateral;
        // Relief is sampled at the vertex's own lateral and the absolute
        // distance of this row, never at the strip's local coordinates.
        const lift = this.relief ? this.relief(lateral, u) : 0;
        if (this.coords) {
          const k = (r * cols + c) * 4;
          this.coords[k] = lateral;
          this.coords[k + 1] = (start % ROAD_COORD_PERIOD) + t * this.length;
          this.coords[k + 2] = this.section[c].height;
        }
        this.positions[i++] = lateral + dx;
        this.positions[i++] = this.section[c].height + dy + lift;
        this.positions[i++] = z;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    if (this.coords) this.geometry.attributes.road.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  /**
   * A value carried by every vertex of this strip in the fourth road
   * coordinate: what the stretch it currently covers is like. Set when it
   * recycles, alongside the vertices themselves.
   */
  setTag(tag: number): void {
    if (!this.coords) return;
    for (let k = 3; k < this.coords.length; k += 4) this.coords[k] = tag;
    this.geometry.attributes.road.needsUpdate = true;
  }

  /** Local-space position of one vertex, for seam measurement. */
  getVertex(row: number, col: number, out: THREE.Vector3): THREE.Vector3 {
    const i = (row * this.section.length + col) * 3;
    return out.set(this.positions[i], this.positions[i + 1], this.positions[i + 2]);
  }

  get rowCount(): number {
    return this.rows;
  }

  get columnCount(): number {
    return this.section.length;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
