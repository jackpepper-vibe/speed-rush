/**
 * Render quality tiers.
 *
 * Not a probe accommodation — a real device ladder. The top tier asks for a
 * 2048² shadow map and a five-mip bloom chain, which an integrated GPU or a
 * software rasteriser cannot sustain: it does not merely run slowly, it loses
 * the WebGL context outright, after which three.js early-returns from `render`
 * and the canvas stays black with no error anywhere. Shipping only the top tier
 * means shipping a black screen to the low end.
 *
 * The tier is resolved from `?quality=` when present, so both a player on a
 * weak machine and the headless probe can pin it, and otherwise guessed from
 * what the platform reports.
 */
export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  readonly tier: QualityTier;
  readonly shadowMapSize: number;
  readonly shadows: boolean;
  readonly bloom: boolean;
  readonly bloomStrength: number;
  readonly maxPixelRatio: number;
  readonly anisotropy: number;
  /** Multiplier on scenery instance counts and particle budgets. */
  readonly sceneryDensity: number;
  readonly drawDistanceScale: number;
  /**
   * Whether the grade may take its four radial blur taps.
   *
   * Off at the bottom of the ladder. Those taps are four extra reads of the
   * whole frame per pixel, which is exactly the kind of bandwidth a software
   * rasteriser answers by dropping the context.
   */
  readonly motionBlur: boolean;
  /**
   * Ring and length segments for the player's lofted body.
   *
   * The hero car is the one model on screen at all times and within a few
   * metres of the camera, so it carries a detail budget the rest of the game
   * does not. It still has to come down at the bottom of the ladder — the fix
   * for a weak GPU is a cheaper hero, not a cheaper top tier.
   */
  readonly heroLoftRings: number;
  readonly heroLoftLength: number;
}

const TIERS: Record<QualityTier, QualitySettings> = {
  low: {
    tier: 'low',
    shadowMapSize: 512,
    shadows: false,
    bloom: false,
    bloomStrength: 0,
    maxPixelRatio: 1,
    anisotropy: 1,
    sceneryDensity: 0.45,
    drawDistanceScale: 0.7,
    motionBlur: false,
    heroLoftRings: 18,
    heroLoftLength: 28,
  },
  medium: {
    tier: 'medium',
    shadowMapSize: 1024,
    shadows: true,
    bloom: true,
    bloomStrength: 0.4,
    maxPixelRatio: 1.5,
    anisotropy: 4,
    sceneryDensity: 0.75,
    drawDistanceScale: 0.88,
    motionBlur: true,
    heroLoftRings: 34,
    heroLoftLength: 56,
  },
  high: {
    tier: 'high',
    shadowMapSize: 2048,
    shadows: true,
    bloom: true,
    bloomStrength: 0.52,
    maxPixelRatio: 2,
    anisotropy: 8,
    sceneryDensity: 1,
    drawDistanceScale: 1,
    motionBlur: true,
    heroLoftRings: 56,
    heroLoftLength: 104,
  },
};

/** Explicit tier from the URL, if the player or the probe pinned one. */
function requestedTier(): QualityTier | null {
  try {
    const q = new URLSearchParams(window.location.search).get('quality');
    if (q === 'low' || q === 'medium' || q === 'high') return q;
  } catch {
    /* no location — treat as unpinned */
  }
  return null;
}

/**
 * Guess a tier from the renderer string and the device.
 *
 * Deliberately pessimistic about anything reporting SwiftShader, llvmpipe or a
 * generic software renderer: those are the cases that lose the context, and
 * being wrong downward costs some bloom, where being wrong upward costs the
 * entire frame.
 */
function detectTier(gl: WebGLRenderingContext | WebGL2RenderingContext): QualityTier {
  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    /* extension blocked by the browser's privacy settings */
  }

  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(renderer)) return 'low';

  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile || cores <= 4) return 'medium';
  return 'high';
}

export function resolveQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): QualitySettings {
  return TIERS[requestedTier() ?? detectTier(gl)];
}

export function qualityByTier(tier: QualityTier): QualitySettings {
  return TIERS[tier];
}
