/**
 * Every tunable number in one place.
 *
 * Balance lives apart from the systems that read it so a difficulty change is a
 * diff in one file rather than a hunt through five managers, and so the probe
 * can assert against the same constants the game runs on instead of hardcoding
 * a second copy that will drift.
 */

/** Road geometry. The original had three lanes; five is the scope-up. */
export const ROAD = {
  laneCount: 5,
  laneWidth: 4.2,
  /** Half-width of drivable surface, derived. */
  get halfWidth(): number {
    return (this.laneCount * this.laneWidth) / 2;
  },
  /** Lane centre x for a lane index (0 = leftmost). */
  laneX(lane: number): number {
    return (lane - (ROAD.laneCount - 1) / 2) * ROAD.laneWidth;
  },
  shoulderWidth: 2.4,
  segmentLength: 25,
  segmentCount: 26,
  /** Distance ahead of the player that the world is populated to. */
  drawDistance: 420,
  /** Curvature amplitude, in lateral units per segment of forward travel. */
  curveAmplitude: 0.055,
  curveWavelength: 900,
  hillAmplitude: 5.5,
  hillWavelength: 620,
} as const;

/** Player speed model, in world-units per second. */
export const SPEED = {
  start: 34,
  min: 18,
  /** Baseline ceiling before car stats and nitro are applied. */
  baseMax: 86,
  /** Passive acceleration toward the current ceiling. */
  accel: 3.4,
  /** Throttle-off deceleration. */
  coast: 8,
  brake: 26,
  /** Ceiling growth per km travelled — the difficulty ramp. */
  maxGainPerKm: 3.1,
  /** Hard ceiling no amount of distance can exceed. */
  absoluteMax: 132,
  /** Fraction of speed kept after an unshielded impact. */
  crashRetain: 0.0,
  /** Speed below which the engine idles rather than pulls. */
  idle: 6,
  /** Display conversion — world units/sec to the km/h shown on the HUD. */
  kmhPerUnit: 3.1,
} as const;

/** Lateral handling: analog steering, not lane snapping. */
export const HANDLING = {
  /** Peak lateral velocity at full lock, units/sec. */
  steerRate: 15.5,
  /** How fast steering input ramps in and out. */
  steerAttack: 9.0,
  steerRelease: 12.0,
  /** Lateral velocity lost per second to tyre grip. */
  gripDamping: 7.5,
  /** Steering authority multiplier at top speed vs at idle. */
  highSpeedFactor: 0.62,
  /** Visual body roll, radians at full lateral velocity. */
  maxRoll: 0.19,
  maxYaw: 0.28,
  /**
   * Lateral speed above which tyres break traction and squeal.
   *
   * Steering authority and grip damping both scale with the surface, so the
   * lateral velocity a full lock settles at is the same wet or dry — roughly
   * 7.7 at top speed. What the surface changes is this threshold, which is
   * multiplied by grip, so a wet road starts sliding at a little under five.
   * Set above 7.7 and the car can never break traction at all, which is the
   * state the first build shipped in.
   */
  slipThreshold: 6.8,
  /** Grip multiplier by surface state. */
  gripWet: 0.72,
  gripStorm: 0.58,
  /** Lateral push applied while driving on the shoulder. */
  shoulderDrag: 4.0,
  /**
   * Speed ceiling while any part of the car is off the tarmac, as a fraction
   * of the ceiling on the road.
   *
   * A drag term alone could not close this. Drag fights acceleration and
   * settles at an equilibrium a little below the ceiling, so the rumble strip
   * was a sixth lane with no traffic in it and almost no cost — park on it and
   * the run drives itself. A ceiling cannot be fought: the shoulder is now
   * strictly slower than the road, which is what makes it an escape rather
   * than a route.
   */
  shoulderSpeedCap: 0.52,
} as const;

/** Traffic density and behaviour. */
export const TRAFFIC = {
  /** Seconds between spawn attempts at run start and at full difficulty. */
  spawnIntervalStart: 1.35,
  spawnIntervalMin: 0.42,
  /** Distance in km over which the interval tightens to its minimum. */
  rampKm: 7.5,
  /** Traffic moves in the same direction, slower than the player. */
  speedFractionMin: 0.34,
  speedFractionMax: 0.78,
  /** Minimum gap enforced between two cars in the same lane, in units. */
  minGap: 26,
  /** Probability an AI car considers a lane change each decision window. */
  laneChangeChance: 0.22,
  laneChangeInterval: 2.1,
  laneChangeDuration: 1.15,
  /** Probability a car brakes when it closes on the car ahead. */
  brakeChance: 0.5,
  /** Gap at which a truck sounds its horn at the player. */
  hornGap: 17,
  hornCooldown: 4.0,
  /** Lateral gap counted as a near miss rather than a pass. */
  nearMissGap: 2.6,
  despawnBehind: 55,
} as const;

/** Collision boxes, in world units. Deliberately smaller than the art. */
export const COLLISION = {
  playerHalfWidth: 1.02,
  playerHalfLength: 2.15,
  /** Per-kind half extents, keyed by TrafficKind. */
  kind: {
    sedan: { hw: 1.02, hl: 2.2 },
    coupe: { hw: 0.98, hl: 2.05 },
    suv: { hw: 1.14, hl: 2.45 },
    van: { hw: 1.16, hl: 2.75 },
    truck: { hw: 1.42, hl: 5.4 },
    bus: { hw: 1.38, hl: 5.9 },
  },
} as const;

/** Pickups and the economy. */
export const PICKUPS = {
  coinValue: 1,
  gemValue: 12,
  coinSpacing: 42,
  coinRunLength: 6,
  coinRunGap: 5.5,
  gemChance: 0.12,
  powerupSpacing: 240,
  /** Radius within which the magnet pulls a pickup toward the player. */
  magnetRadius: 17,
  magnetForce: 46,
  collectRadius: 1.9,
} as const;

/** Power-up durations, in seconds. */
export const POWERUPS = {
  shield: 9,
  nitro: 4.5,
  magnet: 11,
  ghost: 6,
  slowmo: 5.5,
  /** Nitro multiplies the speed ceiling and pins throttle open. */
  nitroBoost: 1.42,
  /** Slow-mo scales world time but not the player's own responsiveness. */
  slowmoScale: 0.55,
} as const;

/** Scoring. */
export const SCORE = {
  perUnitDistance: 0.34,
  nearMiss: 55,
  nearMissComboStep: 0.35,
  comboMax: 8,
  /** Seconds without a near miss before the combo chain drops. */
  comboWindow: 3.4,
  milestoneKm: 1,
  milestoneBonus: 250,
  coinScore: 8,
  gemScore: 90,
} as const;

/** World progression: biome and weather scheduling. */
export const WORLD = {
  /** Distance in units each biome holds before the next is chosen. */
  biomeLength: 1750,
  biomeBlend: 220,
  /** Distance between weather rolls. */
  weatherInterval: 2400,
  weatherChance: 0.55,
  /** Full day/night cycle length, in world units travelled. */
  dayCycleLength: 9000,
  tunnelChance: 0.2,
  tunnelLengthMin: 180,
  tunnelLengthMax: 420,
} as const;
