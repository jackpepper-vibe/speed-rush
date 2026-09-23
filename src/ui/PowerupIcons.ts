import type { PowerupId } from '@/core/GameEvents';

/**
 * An icon per power-up, drawn to match the token on the road: the shield,
 * the gas bottle, the horseshoe, the ghost and the hourglass. The same shape
 * on the banner and the HUD card as the thing you just drove through is what
 * ties the three together; a colour alone asks the player to learn a palette,
 * and some players cannot.
 *
 * 24-unit viewBox, filled in `currentColor` so CSS decides the colour.
 */
const PATHS: Record<PowerupId, string> = {
  shield:
    '<path d="M12 2.5 20 5.6v6.1c0 5-3.4 8.7-8 9.8-4.6-1.1-8-4.8-8-9.8V5.6z"/>' +
    '<path d="M12 6.2 16.8 8v3.8c0 3-2 5.3-4.8 6.1z" fill="#fff" fill-opacity=".35"/>',
  nitro:
    '<rect x="10.3" y="1.8" width="3.4" height="3" rx=".8"/>' +
    '<path d="M8.6 6.2h6.8a2.6 2.6 0 0 1 2.6 2.6v11.4a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8.8a2.6 2.6 0 0 1 2.6-2.6z"/>' +
    '<path d="m12.8 9.4-3 5.1h2.2l-.8 4.5 3.2-5.6h-2.3z" fill="#fff" fill-opacity=".85"/>',
  magnet:
    '<path d="M4 3.5h5.2v9.2a2.8 2.8 0 0 0 5.6 0V3.5H20v9.2a8 8 0 0 1-16 0z"/>' +
    '<rect x="4" y="3.5" width="5.2" height="3.4" fill="#fff" fill-opacity=".85"/>' +
    '<rect x="14.8" y="3.5" width="5.2" height="3.4" fill="#fff" fill-opacity=".85"/>',
  ghost:
    '<path d="M12 2.5a7.5 7.5 0 0 1 7.5 7.5v10.8l-2.5-1.9-2.5 1.9-2.5-1.9-2.5 1.9-2.5-1.9-2.5 1.9V10A7.5 7.5 0 0 1 12 2.5z"/>' +
    '<circle cx="9.4" cy="10.2" r="1.5" fill="#fff"/><circle cx="14.6" cy="10.2" r="1.5" fill="#fff"/>',
  slowmo:
    '<path d="M5.5 2.5h13v2h-1.2c0 3.4-1.8 5.6-3.9 7.5 2.1 1.9 3.9 4.1 3.9 7.5h1.2v2h-13v-2h1.2c0-3.4 1.8-5.6 3.9-7.5-2.1-1.9-3.9-4.1-3.9-7.5H5.5z"/>' +
    '<path d="M9.3 19.5c.4-2 1.4-3.2 2.7-4.2 1.3 1 2.3 2.2 2.7 4.2z" fill="#fff" fill-opacity=".8"/>',
};

export function powerupIcon(id: PowerupId, className = 'pu-glyph'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${PATHS[id]}</svg>`;
}
