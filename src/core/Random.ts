/**
 * Seeded pseudo-random source (mulberry32).
 *
 * The whole world — traffic, pickups, scenery, weather — draws from one of
 * these rather than from `Math.random`. Two runs given the same seed therefore
 * generate the same road, which is the difference between a probe that can say
 * "this spawn overlaps" and one that reports a different set of overlaps every
 * time it is run.
 */
export class Random {
  private state: number;

  constructor(public readonly seed: number = (Math.random() * 2 ** 32) >>> 0) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Symmetric jitter in [-amount, amount). */
  spread(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  /** A fresh generator derived from this one — for an independent stream. */
  fork(): Random {
    return new Random((this.next() * 2 ** 32) >>> 0);
  }

  reset(seed: number): void {
    this.state = seed >>> 0;
  }
}
