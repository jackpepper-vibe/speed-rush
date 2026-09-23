/**
 * A monotone cubic through a set of control points.
 *
 * Every longitudinal line on a car body — beltline, roofline, plan width,
 * sill — is authored as a handful of (t, value) pairs and read back through
 * one of these. Monotone (Fritsch–Carlson) rather than Catmull-Rom because a
 * body line must never overshoot its own control points: a roof that bulges
 * above the highest point it was given, or a sill that dips below the road
 * between two stations, is a modelling error the author never typed.
 */
export class Curve {
  private readonly ts: Float64Array;
  private readonly vs: Float64Array;
  private readonly ms: Float64Array;

  constructor(points: ReadonlyArray<readonly [number, number]>) {
    if (points.length === 0) throw new Error('Curve needs at least one point');
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    const n = sorted.length;
    this.ts = new Float64Array(n);
    this.vs = new Float64Array(n);
    this.ms = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.ts[i] = sorted[i][0];
      this.vs[i] = sorted[i][1];
    }
    if (n === 1) return;

    const delta = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const dt = this.ts[i + 1] - this.ts[i];
      delta[i] = dt > 0 ? (this.vs[i + 1] - this.vs[i]) / dt : 0;
    }
    this.ms[0] = delta[0];
    this.ms[n - 1] = delta[n - 2];
    for (let i = 1; i < n - 1; i++) {
      this.ms[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
    }
    // Fritsch–Carlson: clamp tangents so no segment overshoots.
    for (let i = 0; i < n - 1; i++) {
      if (delta[i] === 0) {
        this.ms[i] = 0;
        this.ms[i + 1] = 0;
        continue;
      }
      const a = this.ms[i] / delta[i];
      const b = this.ms[i + 1] / delta[i];
      const h = Math.hypot(a, b);
      if (h > 3) {
        const k = 3 / h;
        this.ms[i] = k * a * delta[i];
        this.ms[i + 1] = k * b * delta[i];
      }
    }
  }

  at(t: number): number {
    const n = this.ts.length;
    if (n === 1 || t <= this.ts[0]) return this.vs[0];
    if (t >= this.ts[n - 1]) return this.vs[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.ts[mid] <= t) lo = mid;
      else hi = mid;
    }
    const h = this.ts[hi] - this.ts[lo];
    const s = (t - this.ts[lo]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * this.vs[lo] +
      (s3 - 2 * s2 + s) * h * this.ms[lo] +
      (-2 * s3 + 3 * s2) * this.vs[hi] +
      (s3 - s2) * h * this.ms[hi];
  }
}

/** Shorthand for authoring: `curve([0, 0.5], [0.3, 0.7], [1, 0.6])`. */
export function curve(...points: Array<readonly [number, number]>): Curve {
  return new Curve(points);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
