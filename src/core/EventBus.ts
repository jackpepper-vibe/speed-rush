/**
 * Typed publish/subscribe bus.
 *
 * Managers never reach into one another — the traffic manager does not know the
 * audio manager exists. Everything that crosses a subsystem boundary goes
 * through here as a named event with a typed payload, which is what lets the
 * probe assert on game behaviour: it subscribes to the same bus the game runs
 * on, so "a near miss was scored" is observable without patching a class.
 */
export class EventBus<TEvents extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof TEvents, Set<(payload: never) => void>>();

  /** Subscribe to `event`. Returns an unsubscribe function. */
  on<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => this.off(event, handler);
  }

  /** Subscribe for a single delivery. */
  once<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): void {
    this.handlers.get(event)?.delete(handler as (payload: never) => void);
  }

  /**
   * Deliver `payload` to every subscriber.
   *
   * Iterates a copy so a handler may unsubscribe itself — or subscribe another —
   * during delivery without invalidating the walk. A throwing handler is logged
   * and skipped rather than being allowed to abort the frame: one bad listener
   * must not stop the car from moving.
   */
  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    for (const handler of [...set]) {
      try {
        (handler as (p: TEvents[K]) => void)(payload);
      } catch (error) {
        console.error(`[EventBus] handler for "${String(event)}" threw:`, error);
      }
    }
  }

  /** Drop every subscription. Used when a run ends and managers are rebuilt. */
  clear(): void {
    this.handlers.clear();
  }

  listenerCount(event: keyof TEvents): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}
