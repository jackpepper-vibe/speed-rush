/**
 * Whether a key event belongs to a text field the player is typing into.
 *
 * The game listens for keys on the whole window, so without this, typing a
 * driver name steered the car, "M" muted the sound and Space was swallowed
 * as the brake before it could become a space.
 */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}
