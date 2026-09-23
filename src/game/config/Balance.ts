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
   * A bike's lean at full lateral velocity, and how much of a car's front
   * wheel angle it shows. A bike turns by leaning, not by steering: at speed
   * the bars barely move while the whole machine goes over thirty degrees.
   */
  bikeLean: 0.6,
  bikeSteer: 0.25,
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
  /**
   * Speed scrubbed off per second while any part of the car is off the tarmac.
   *
   * Named for a lateral push and used as longitudinal drag since it was
   * written. The push it was named for is `shoulderCamber`, below, which did
   * not exist until the shoulder turned out to be drivable.
   */
  shoulderDrag: 4.0,
  /**
   * Outward lateral acceleration while off the tarmac: the camber of the
   * gutter, pulling the car towards the barrier.
   *
   * The shoulder was already strictly slower than the road and it was still a
   * free lane, because **slow is a price a player will pay to be safe.**
   * Traffic runs in lanes and lanes end at `halfWidth`, so a car sitting at the
   * rail is not merely slower — it is untouchable, and a run that cannot end is
   * worth more than a run that is quick. No speed penalty closes that; the
   * shoulder has to stop being somewhere you can *rest*.
   *
   * A camber does exactly that and nothing else. Steering authority settles
   * lateral velocity near 7.7 at full lock, so at 20 the gutter costs about a
   * third of the steering budget held permanently: the shoulder stays usable
   * for a second or two to slip past a blocked road, and stops being a place to
   * park, because the moment attention goes elsewhere the car is against the
   * rail. Deliberately not a bounce, a spin or damage — the escape is a
   * legitimate move and should stay one.
   */
  shoulderCamber: 20,
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
  /**
   * Seconds of continuous contact with the shoulder before the car stops dead.
   *
   * The cap above made the gutter strictly slower than the road, which was
   * supposed to make it an escape rather than a route. It did not: a constant
   * fraction of the ceiling is still a *speed*, so the rumble strip stayed a
   * sixth lane you could settle into and coast down at half pace, indefinitely
   * and untouched by traffic that runs in lanes. Slow is a price a player will
   * pay to be safe — the same lesson `shoulderCamber` was written for, and the
   * camber only closed it for a driver who stopped paying attention.
   *
   * A ceiling that falls to zero cannot be settled into at all. It converts the
   * gutter from somewhere cheap into somewhere with a timer: two seconds is
   * long enough to dive in, slip past a blocked road and pull out again, which
   * is the move that should stay legitimate, and far too short to travel in.
   */
  shoulderBogSeconds: 2.2,
  /**
   * How fast the bog clears once back on the tarmac, as a multiple of the rate
   * it builds at.
   *
   * Faster than it builds, so the escape move stays repeatable and a driver who
   * clips the strip through a bend is not carrying a penalty into the next one.
   * Not instant, so hopping in and out along the same stretch of road cannot be
   * used to reset the timer and travel the gutter in bursts.
   */
  shoulderRecoverRate: 1.8,
} as const;

/** Traffic density and behaviour. */
export const TRAFFIC = {
  /** Seconds between spawn attempts at run start and at full difficulty. */
  spawnIntervalStart: 1.35,
  spawnIntervalMin: 0.42,
  /** Distance in km over which the interval tightens to its minimum. */
  rampKm: 7.5,
  /**
   * Share of outer-lane traffic that runs wide, half on the shoulder, and how
   * far out it sits.
   *
   * The offset is chosen against the geometry rather than by feel, and the
   * binding constraint is an invariant rather than an aesthetic. The outer lane
   * centre is at 8.4, the tarmac ends at 10.5, and the rail stops the player at
   * 11.9. What has to be true is that the two **bodies** overlap — half-widths
   * are 1.02 each, so their centres must be within 2.04 — while the vehicle's
   * own centre stays on the tarmac, because `traffic/stays-on-tarmac` asserts
   * exactly that and it is a real invariant: traffic must not wander into the
   * scenery.
   *
   * At 2.0 the centre sits at 10.4, on the tarmac with a tenth to spare, and
   * the body overhangs to 11.42 — genuinely half on the shoulder to look at.
   * The gap to a player on the rail is 1.5 against a 2.04 overlap threshold.
   * The first attempt used 2.5, which put the centre at 10.9 and failed the
   * gate; the fix belonged in the change, not in the check.
   *
   * The share is not flavour and was landed by measurement, because a corridor
   * is only shut if something is actually *in* it often enough to be met. Hands
   * off on the rail, run-end time: 0.16 never inside 150s, 0.30 at 127.1s,
   * 0.45 at 69.7s. Against 14.2s for the same hands-off run in a lane, 0.45 is
   * the value that makes the gutter an escape with a bounded life rather than a
   * route. It works out at about 18% of all traffic, which is high for
   * breakdowns and right for the reference: target2 has a row of vehicles
   * parked along the kerb the whole length of the frame.
   */
  vergeShare: 0.45,
  vergeOffset: 2.0,
  /**
   * Speed of a verge-hugger, as a fraction of the baseline ceiling.
   *
   * Far below the ordinary band, and that is the whole point rather than
   * flavour. The shoulder's speed cap is what *created* the exploit: capped at
   * 0.52 the player crawls at about 31 units/sec, every ordinary vehicle runs
   * at 29 to 67, so nothing is ever overtaken — and a collision here only
   * happens when the player closes on something. The anti-exploit measure was
   * the exploit. Measured before this: hands off on the rail, forty seconds and
   * no run-end; hands off in a lane, the run ends at 14.2 seconds.
   *
   * A vehicle half on the shoulder is there because it is slow — a breakdown, a
   * heavy load — so it is slower than a shoulder-capped player by construction,
   * and a rail-rider closes on it. This is the only part of the change that
   * actually shuts the corridor.
   */
  vergeSpeedFraction: 0.16,
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
  /**
   * The player's box, by chassis, and `rail`: how close the centre of the
   * vehicle may come to the barrier. A bike is a third of a car's width, and
   * a car-sized box on it would crash into traffic the player can see they
   * cleared — threading the gap is the whole reason to ride one.
   */
  player: {
    car: { hw: 1.02, hl: 2.15, rail: 1.0 },
    bike: { hw: 0.4, hl: 1.05, rail: 0.45 },
  },
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
