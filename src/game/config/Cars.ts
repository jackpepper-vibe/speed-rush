/**
 * The car roster.
 *
 * In the original every car was the same physics with a different paint job.
 * Here each one carries real stats that feed the handling model, plus an
 * upgrade path bought with run coins — so the garage is a progression system
 * rather than a colour picker.
 */

export interface CarStats {
  /** Multiplier on the speed ceiling. */
  topSpeed: number;
  /** Multiplier on acceleration toward that ceiling. */
  accel: number;
  /** Multiplier on steering authority and grip recovery. */
  grip: number;
  /** Multiplier on nitro duration. */
  boost: number;
}

export type UpgradableStat = keyof CarStats;

export interface CarDef {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  /** Body paint. */
  readonly color: number;
  /** Secondary trim: spoiler, mirrors, skirts. */
  readonly trim: number;
  /** Emissive underglow, shown at speed. */
  readonly glow: number;
  readonly stats: CarStats;
  /** Silhouette the mesh factory builds. */
  readonly body: 'roadster' | 'coupe' | 'muscle' | 'super' | 'wedge' | 'hyper' | 'superbike';
  readonly blurb: string;
}

/** Per-level multiplier added to a stat, and what each level costs. */
export const UPGRADE = {
  maxLevel: 5,
  stepByStat: { topSpeed: 0.055, accel: 0.075, grip: 0.06, boost: 0.09 } satisfies Record<UpgradableStat, number>,
  /** Price of level n (1-indexed), per stat. */
  price(level: number): number {
    return Math.round(180 * Math.pow(1.65, level - 1));
  },
} as const;

export const CARS: readonly CarDef[] = [
  {
    id: 'dart',
    name: 'DART',
    price: 0,
    color: 0xe8402c,
    trim: 0x1a1a20,
    glow: 0xff5a2c,
    body: 'roadster',
    stats: { topSpeed: 1.0, accel: 1.0, grip: 1.0, boost: 1.0 },
    blurb: 'Sixties roadster, roof down. Honest, forgiving, slow.',
  },
  {
    id: 'kestrel',
    name: 'KESTREL',
    price: 900,
    color: 0x2f8fd8,
    trim: 0xe8eef4,
    glow: 0x39c8ff,
    body: 'coupe',
    stats: { topSpeed: 1.07, accel: 1.04, grip: 1.12, boost: 1.0 },
    blurb: 'Grand tourer that turns in far harder than it accelerates.',
  },
  {
    id: 'bruiser',
    name: 'BRUISER',
    price: 1600,
    color: 0xf0a81c,
    trim: 0x241c10,
    glow: 0xffc23a,
    body: 'muscle',
    stats: { topSpeed: 1.14, accel: 1.18, grip: 0.88, boost: 1.05 },
    blurb: 'American muscle. All torque, no manners. Straight lines only.',
  },
  {
    id: 'vantage',
    name: 'VANTAGE',
    price: 3200,
    color: 0x1fbf7a,
    trim: 0x0e2b20,
    glow: 0x4dffb0,
    body: 'wedge',
    stats: { topSpeed: 1.2, accel: 1.12, grip: 1.16, boost: 1.12 },
    blurb: 'Eighties wedge. Balanced, no weakness, no drama.',
  },
  {
    id: 'phantom',
    name: 'PHANTOM',
    price: 6000,
    color: 0x8b52e0,
    trim: 0x150d22,
    glow: 0xc08cff,
    body: 'super',
    stats: { topSpeed: 1.29, accel: 1.22, grip: 1.1, boost: 1.28 },
    blurb: 'Mid-engined and impatient. Rewards a clean line.',
  },
  {
    id: 'apex',
    name: 'APEX-1',
    price: 12000,
    color: 0xf2f4f8,
    trim: 0xc01830,
    glow: 0xff2d55,
    body: 'hyper',
    stats: { topSpeed: 1.4, accel: 1.3, grip: 1.22, boost: 1.35 },
    blurb: 'Homologation special. Everything, all at once.',
  },
  {
    id: 'hornet',
    name: 'HORNET',
    price: 9000,
    color: 0x15161a,
    trim: 0xd9a93e,
    glow: 0xffc24a,
    body: 'superbike',
    stats: { topSpeed: 1.33, accel: 1.38, grip: 1.04, boost: 1.2 },
    blurb: 'Litre superbike. Threads gaps no car can, and forgives nothing.',
  },
] as const;

/**
 * What a vehicle stands on, which decides more than its looks: how wide it is
 * to hit, how close it can run to the rail, and whether it rolls out of a
 * corner on its springs or leans into it.
 */
export type Chassis = 'car' | 'bike';

export function chassisOf(def: CarDef): Chassis {
  return def.body === 'superbike' ? 'bike' : 'car';
}

export function carById(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

/** Stats with purchased upgrade levels folded in. */
export function effectiveStats(car: CarDef, levels: Partial<Record<UpgradableStat, number>>): CarStats {
  const out = { ...car.stats };
  for (const key of Object.keys(UPGRADE.stepByStat) as UpgradableStat[]) {
    const level = Math.min(levels[key] ?? 0, UPGRADE.maxLevel);
    out[key] += UPGRADE.stepByStat[key] * level;
  }
  return out;
}
