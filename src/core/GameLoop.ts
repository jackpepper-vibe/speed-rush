/**
 * Fixed-timestep loop with a render interpolation hook.
 *
 * Simulation runs at a constant `STEP` regardless of display refresh, so
 * physics and spawn distances are frame-rate independent — a 144 Hz monitor
 * must not make the road arrive faster than a 60 Hz one. The accumulator is
 * clamped so a tab that was backgrounded for a minute resumes instead of
 * spiral-of-deathing through 3,600 catch-up ticks.
 *
 * `advance()` is public and separate from the rAF driver on purpose: the probe
 * calls it directly to run an exact number of simulation ticks with no clock
 * involved at all, which is what makes a measurement reproducible.
 */
export const STEP_SECONDS = 1 / 120;
const MAX_FRAME_SECONDS = 0.25;

export type TickFn = (dt: number) => void;
export type RenderFn = (alpha: number) => void;

export class GameLoop {
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private running = false;

  /** Simulation ticks executed since construction. Probe reads this. */
  private ticks = 0;

  constructor(
    private readonly tick: TickFn,
    private readonly render: RenderFn,
  ) {}

  get tickCount(): number {
    return this.ticks;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    const elapsed = Math.min((now - this.lastTime) / 1000, MAX_FRAME_SECONDS);
    this.lastTime = now;
    this.accumulator += elapsed;

    while (this.accumulator >= STEP_SECONDS) {
      this.tick(STEP_SECONDS);
      this.ticks += 1;
      this.accumulator -= STEP_SECONDS;
    }

    this.render(this.accumulator / STEP_SECONDS);
  };

  /**
   * Run exactly `count` simulation ticks, then render once.
   *
   * No timestamps are consulted, so this is deterministic by construction —
   * the same seed and the same count give the same world state every time.
   */
  advance(count: number, withRender = true): void {
    for (let i = 0; i < count; i++) {
      this.tick(STEP_SECONDS);
      this.ticks += 1;
    }
    if (withRender) this.render(0);
  }

  /** Run for a wall-clock duration's worth of simulation, deterministically. */
  advanceSeconds(seconds: number, withRender = true): void {
    this.advance(Math.round(seconds / STEP_SECONDS), withRender);
  }
}
