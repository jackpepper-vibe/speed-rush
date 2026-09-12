import type { Scene, PerspectiveCamera } from 'three';
import type { EventBus } from './EventBus';
import type { GameEvents } from './GameEvents';
import type { Random } from './Random';

/**
 * What every manager is handed at construction.
 *
 * Deliberately narrow: the scene to attach to, the bus to speak on, and a
 * random stream of its own. A manager that needs to know something about
 * another manager's state subscribes to its events instead of holding a
 * reference, which keeps the update order from becoming load-bearing.
 */
export interface GameContext {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly bus: EventBus<GameEvents>;
  readonly rng: Random;
}

/**
 * A subsystem with a lifecycle.
 *
 * `reset` returns the manager to its run-start state without tearing down GPU
 * resources — restarting a run must not reallocate every geometry — while
 * `dispose` releases them for good.
 */
export interface Manager {
  readonly name: string;
  /** Build resources. Called once, after construction. */
  init?(): void;
  /** Advance by a fixed timestep. */
  update(dt: number, speed: number, distance: number): void;
  /** Return to run-start state, reusing allocated resources. */
  reset?(): void;
  /** Release GPU and audio resources permanently. */
  dispose?(): void;
}

/**
 * Ordered collection of managers driven as one.
 *
 * Update order is the registration order and is meaningful in exactly one way:
 * the player integrates before traffic and pickups so collision tests run
 * against a position that is current for this tick rather than one tick stale.
 */
export class ManagerRegistry {
  private readonly managers: Manager[] = [];

  add<T extends Manager>(manager: T): T {
    this.managers.push(manager);
    return manager;
  }

  initAll(): void {
    for (const m of this.managers) m.init?.();
  }

  update(dt: number, speed: number, distance: number): void {
    for (const m of this.managers) m.update(dt, speed, distance);
  }

  resetAll(): void {
    for (const m of this.managers) m.reset?.();
  }

  disposeAll(): void {
    for (const m of this.managers) m.dispose?.();
    this.managers.length = 0;
  }

  get names(): string[] {
    return this.managers.map((m) => m.name);
  }
}
