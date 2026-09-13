import type { BiomeId, DayPhase, WeatherId } from '@/core/GameEvents';

/**
 * How the world looks, as data.
 *
 * The rig knows how to apply a palette; it does not know what dusk is. Keeping
 * the look in a table means a new biome or a new time of day is an entry here
 * rather than a branch inside the renderer, and it lets the two axes — where
 * you are and when it is — be blended independently instead of needing an
 * entry for every combination.
 */

export interface Palette {
  sunColor: number;
  sunIntensity: number;
  skyTop: number;
  skyBottom: number;
  horizon: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  fogDensity: number;
  sunElevation: number;
  exposure: number;
  stars: number;
  /** Cloud cover, 0 clear to 1 overcast, before weather adds to it. */
  clouds: number;
  /** Headlight intensity the player's car should run at. */
  headlights: number;
}

/*
 * A note on the sun-to-fill ratio.
 *
 * The first pass ran a bright hemisphere light against a modest sun, which is
 * the safe setting: nothing is ever unreadably dark. It is also why the cars
 * looked matte. A hemisphere light has no direction worth speaking of, so
 * everything it touches is lit from everywhere at once — no terminator, no
 * shadow side, no highlight, and a metallic panel that might as well be paper.
 * The fill is down about a third here and the sun up by a similar amount, which
 * costs some detail in the shadows and buys a car with a lit side and a dark
 * one.
 */
export const DAY_PALETTE: Record<DayPhase, Palette> = {
  dawn: {
    sunColor: 0xffc48a, sunIntensity: 2.2,
    skyTop: 0x2c4f8c, skyBottom: 0xf0a878, horizon: 0xffd0a0,
    hemiSky: 0x9ab4e0, hemiGround: 0x4a3f34, hemiIntensity: 0.68,
    fogColor: 0xe0b48c, fogDensity: 0.0030, sunElevation: 0.12, exposure: 1.0,
    stars: 0.18, clouds: 0.34, headlights: 1.4,
  },
  day: {
    sunColor: 0xfff2dc, sunIntensity: 3.6,
    skyTop: 0x1e5fbe, skyBottom: 0xa8ccec, horizon: 0xfff2d0,
    hemiSky: 0xbcd8ff, hemiGround: 0x45402f, hemiIntensity: 0.82,
    fogColor: 0x9fc4e8, fogDensity: 0.0017, sunElevation: 0.85, exposure: 1.05,
    stars: 0, clouds: 0.28, headlights: 0,
  },
  dusk: {
    sunColor: 0xff8a4c, sunIntensity: 2.0,
    skyTop: 0x1e2a5c, skyBottom: 0xe06a48, horizon: 0xff9a5a,
    hemiSky: 0x7a86c0, hemiGround: 0x3a2f28, hemiIntensity: 0.56,
    fogColor: 0xc06a50, fogDensity: 0.0032, sunElevation: 0.1, exposure: 1.0,
    stars: 0.32, clouds: 0.38, headlights: 1.8,
  },
  night: {
    sunColor: 0x8aa0d8, sunIntensity: 0.35,
    skyTop: 0x05060f, skyBottom: 0x121a34, horizon: 0x1c2748,
    hemiSky: 0x28324f, hemiGround: 0x0c0e14, hemiIntensity: 0.42,
    fogColor: 0x0c1020, fogDensity: 0.0038, sunElevation: -0.2, exposure: 1.18,
    stars: 1, clouds: 0.24, headlights: 3.6,
  },
};

/** Per-biome tints and adjustments, applied on top of the time of day. */
export interface BiomeTint {
  /** Multiplier on fog density — a forest sits closer than a desert. */
  fogScale: number;
  /** Blended into the fog and horizon, by `tintStrength`. */
  tint: number;
  tintStrength: number;
  /** Ground plane colour either side of the road. */
  ground: number;
  groundRoughness: number;
}

export const BIOME_TINT: Record<BiomeId, BiomeTint> = {
  coast: { fogScale: 0.85, tint: 0x8fd0e8, tintStrength: 0.28, ground: 0xd8c898, groundRoughness: 0.95 },
  city: { fogScale: 1.25, tint: 0x9aa0b0, tintStrength: 0.3, ground: 0x4a4d55, groundRoughness: 0.85 },
  desert: { fogScale: 0.7, tint: 0xe8c078, tintStrength: 0.34, ground: 0xc9a062, groundRoughness: 0.98 },
  forest: { fogScale: 1.35, tint: 0x6a8f5e, tintStrength: 0.26, ground: 0x3c5434, groundRoughness: 0.94 },
  tunnel: { fogScale: 2.4, tint: 0x2a2d34, tintStrength: 0.6, ground: 0x2a2d34, groundRoughness: 0.8 },
};

/** Weather modifies the palette and the road surface together. */
export interface WeatherEffect {
  fogScale: number;
  exposureScale: number;
  sunScale: number;
  /** Grip multiplier applied to the player's handling. */
  grip: number;
  /** Wet-lens amount handed to the grade pass. */
  wet: number;
  /** Rain particle density, 0..1. */
  rain: number;
  /** Added to the hour's own cloud cover. */
  cloudCover: number;
}

export const WEATHER: Record<WeatherId, WeatherEffect> = {
  clear: { fogScale: 1, exposureScale: 1, sunScale: 1, grip: 1, wet: 0, rain: 0, cloudCover: 0 },
  rain: { fogScale: 1.7, exposureScale: 0.86, sunScale: 0.5, grip: 0.72, wet: 0.55, rain: 0.6, cloudCover: 0.45 },
  storm: { fogScale: 2.3, exposureScale: 0.74, sunScale: 0.28, grip: 0.58, wet: 0.85, rain: 1, cloudCover: 0.58 },
  fog: { fogScale: 4.2, exposureScale: 0.92, sunScale: 0.45, grip: 0.88, wet: 0.12, rain: 0, cloudCover: 0.3 },
};

/** Linear blend between two palettes, for the crossfade between phases. */
export function blendPalette(a: Palette, b: Palette, t: number): Palette {
  const lerp = (x: number, y: number): number => x + (y - x) * t;
  const lerpHex = (x: number, y: number): number => {
    const r = lerp((x >> 16) & 255, (y >> 16) & 255);
    const g = lerp((x >> 8) & 255, (y >> 8) & 255);
    const bl = lerp(x & 255, y & 255);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  };
  return {
    sunColor: lerpHex(a.sunColor, b.sunColor),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity),
    skyTop: lerpHex(a.skyTop, b.skyTop),
    skyBottom: lerpHex(a.skyBottom, b.skyBottom),
    horizon: lerpHex(a.horizon, b.horizon),
    hemiSky: lerpHex(a.hemiSky, b.hemiSky),
    hemiGround: lerpHex(a.hemiGround, b.hemiGround),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity),
    fogColor: lerpHex(a.fogColor, b.fogColor),
    fogDensity: lerp(a.fogDensity, b.fogDensity),
    sunElevation: lerp(a.sunElevation, b.sunElevation),
    exposure: lerp(a.exposure, b.exposure),
    stars: lerp(a.stars, b.stars),
    clouds: lerp(a.clouds, b.clouds),
    headlights: lerp(a.headlights, b.headlights),
  };
}

export function mixHex(base: number, tint: number, t: number): number {
  const r = ((base >> 16) & 255) + (((tint >> 16) & 255) - ((base >> 16) & 255)) * t;
  const g = ((base >> 8) & 255) + (((tint >> 8) & 255) - ((base >> 8) & 255)) * t;
  const b = (base & 255) + ((tint & 255) - (base & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** The four phases, in the order a day runs through them. */
export const PHASE_ORDER: readonly DayPhase[] = ['dawn', 'day', 'dusk', 'night'];
