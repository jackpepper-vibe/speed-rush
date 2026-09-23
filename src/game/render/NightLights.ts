/**
 * How dark it is, for everything that lights up when it gets dark.
 *
 * Street-lamp lenses, the pools of light they throw on the road and lit office
 * windows all belong to different systems, and none of them should need to
 * know about the day cycle or hold a reference to the world. They subscribe
 * here; the world sets one level a frame.
 */

type Listener = (level: number) => void;

const listeners = new Set<Listener>();
let current = 0;

/** Subscribe; called at once with the current level. Returns an unsubscribe. */
export function onNight(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

/** 0 full daylight, 1 full night. */
export function setNightLevel(level: number): void {
  const clamped = Math.min(1, Math.max(0, level));
  if (Math.abs(clamped - current) < 1e-4) return;
  current = clamped;
  for (const l of listeners) l(current);
}

export function nightLevel(): number {
  return current;
}
