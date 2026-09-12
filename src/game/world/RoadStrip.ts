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
export class RoadStrip {
  readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;

  /** Absolute distance this strip currently starts at. */
  private startDistance = Number.NaN;

  constructor(
    private readonly columns: readonly number[],
    private readonly length: number,
    private readonly rows: number,
    /** Constant height offset — lifts barrier walls off the deck. */
    private readonly baseY = 0,
    /** Extra height added to the far edge, for vertical walls. */
    private readonly wallHeight = 0,
  ) {
    const cols = columns.length;
    const vertexCount = cols * (rows + 1) * (wallHeight > 0 ? 2 : 1);
    this.positions = new Float32Array(vertexCount * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.buildUVs(), 2));
    this.geometry.setIndex(this.buildIndices());
  }

  private buildUVs(): Float32Array {
    const cols = this.columns.length;
    const span = this.columns[cols - 1] - this.columns[0];
    const layers = this.wallHeight > 0 ? 2 : 1;
    const uv = new Float32Array(cols * (this.rows + 1) * layers * 2);
    let i = 0;
    for (let layer = 0; layer < layers; layer++) {
      for (let r = 0; r <= this.rows; r++) {
        for (let c = 0; c < cols; c++) {
          // U runs across the road so the lane markings land where the lanes
          // are; V runs along it, tiled once per segment.
          uv[i++] = this.wallHeight > 0 ? layer : (this.columns[c] - this.columns[0]) / span;
          uv[i++] = r / this.rows;
        }
      }
    }
    return uv;
  }

  private buildIndices(): number[] {
    const cols = this.columns.length;
    const idx: number[] = [];
    const quad = (a: number, b: number, c: number, d: number): void => {
      idx.push(a, b, d, b, c, d);
    };

    if (this.wallHeight > 0) {
      // Vertical wall: connect the lower ring to the upper one.
      const ring = cols * (this.rows + 1);
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lo = r * cols + c;
          const hi = ring + lo;
          quad(lo, lo + cols, hi + cols, hi);
        }
      }
      return idx;
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        quad(a, a + 1, a + cols + 1, a + cols);
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

    const cols = this.columns.length;
    const baseCurve = curveAt(start);
    const baseHill = hillAt(start);
    const layers = this.wallHeight > 0 ? 2 : 1;

    let i = 0;
    for (let layer = 0; layer < layers; layer++) {
      const lift = this.baseY + (layer === 1 ? this.wallHeight : 0);
      for (let r = 0; r <= this.rows; r++) {
        const t = r / this.rows;
        const u = start + t * this.length;
        // Local space: the strip's own origin sits on the centreline at
        // `start`, so these stay small however far the run has gone.
        const dx = curveAt(u) - baseCurve;
        const dy = hillAt(u) - baseHill;
        const z = -t * this.length;
        for (let c = 0; c < cols; c++) {
          this.positions[i++] = this.columns[c] + dx;
          this.positions[i++] = dy + lift;
          this.positions[i++] = z;
        }
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  /** Local-space position of one vertex, for seam measurement. */
  getVertex(row: number, col: number, out: THREE.Vector3): THREE.Vector3 {
    const i = (row * this.columns.length + col) * 3;
    return out.set(this.positions[i], this.positions[i + 1], this.positions[i + 2]);
  }

  get rowCount(): number {
    return this.rows;
  }

  get columnCount(): number {
    return this.columns.length;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
