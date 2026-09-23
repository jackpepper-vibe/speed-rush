import type { PowerupId } from '@/core/GameEvents';

/**
 * What each power-up is called, what it does, and its colour.
 *
 * One table for the road token, the announcement, the HUD card and the aura on
 * the car, so the thing you drove through, the banner that names it and the
 * card counting it down are unmistakably the same power-up. The colour was
 * written out twice before, once for the road and once for the HUD, and the
 * name the player saw was the internal id — "slowmo".
 *
 * Durations and strengths are gameplay and live in `Balance.POWERUPS`.
 */
export interface PowerupInfo {
  /** Shown on the banner and the HUD card. */
  readonly label: string;
  /** What it does, in the fewest words that tell a player how to use it. */
  readonly tagline: string;
  /** sRGB hex, for CSS and for three.js colours alike. */
  readonly colour: number;
}

export const POWERUP_IDS: readonly PowerupId[] = ['shield', 'nitro', 'magnet', 'ghost', 'slowmo'];

export const POWERUP_INFO: Record<PowerupId, PowerupInfo> = {
  shield: { label: 'Shield', tagline: 'Survive one crash', colour: 0x39c8ff },
  nitro: { label: 'Nitro', tagline: 'Top speed boost', colour: 0xff6a1a },
  magnet: { label: 'Magnet', tagline: 'Pulls in coins', colour: 0xff44dd },
  ghost: { label: 'Ghost', tagline: 'Drive through traffic', colour: 0xb98cff },
  slowmo: { label: 'Slow-mo', tagline: 'Traffic slows down', colour: 0x6cf0a8 },
};

/** The colour as a CSS string. */
export function powerupCss(id: PowerupId): string {
  return `#${POWERUP_INFO[id].colour.toString(16).padStart(6, '0')}`;
}
