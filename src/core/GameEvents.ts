import type { Vector3 } from 'three';

/** Run lifecycle. */
export type RunState = 'menu' | 'countdown' | 'driving' | 'crashed' | 'gameover';

export type BiomeId = 'coast' | 'city' | 'desert' | 'forest' | 'tunnel';
export type WeatherId = 'clear' | 'rain' | 'storm' | 'fog';
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';
export type PowerupId = 'shield' | 'nitro' | 'magnet' | 'ghost' | 'slowmo';
export type PickupId = 'coin' | 'gem' | PowerupId;
export type TrafficKind = 'sedan' | 'coupe' | 'suv' | 'van' | 'truck' | 'bus';

/**
 * Every cue the game can raise, with the payload a listener needs to act on it.
 *
 * This map is the contract the probe tests against. A feature that emits
 * nothing here is a feature that cannot be verified, so each new system is
 * expected to land with its cue in this list — that is what "a probe check per
 * cue" is checking.
 */
export type GameEvents = {
  /* -- run lifecycle ------------------------------------------------------ */
  'run:start': { seed: number; carId: string };
  'run:countdown': { remaining: number };
  'run:end': { score: number; distance: number; coins: number; cause: 'crash' | 'quit' };
  'run:tick': { distance: number; speed: number };

  /* -- player ------------------------------------------------------------- */
  'player:lane-change': { from: number; to: number; direction: -1 | 1 };
  'player:steer': { lateral: number; grip: number; slipping: boolean };
  'player:drift': { intensity: number; lateral: number };
  'player:crash': { with: TrafficKind | 'barrier'; speed: number; position: Vector3 };
  'player:near-miss': { kind: TrafficKind; gap: number; position: Vector3 };
  'player:airborne': { height: number };
  'player:land': { impact: number };

  /* -- traffic ------------------------------------------------------------ */
  'traffic:spawn': { kind: TrafficKind; lane: number; speed: number; z: number };
  'traffic:lane-change': { kind: TrafficKind; from: number; to: number };
  'traffic:brake': { kind: TrafficKind; lane: number };
  'traffic:despawn': { kind: TrafficKind; passed: boolean };
  /** `closing` is the approach speed as a fraction of top speed — negative
   *  when the vehicle is falling behind. Drives the doppler shift on the horn. */
  'traffic:horn': { kind: TrafficKind; position: Vector3; closing: number };

  /* -- pickups & powerups ------------------------------------------------- */
  'pickup:collect': { kind: PickupId; value: number; position: Vector3 };
  'pickup:magnetised': { kind: PickupId; distance: number };
  'powerup:activate': { id: PowerupId; duration: number };
  'powerup:expire': { id: PowerupId };
  'powerup:blocked-crash': { id: 'shield' | 'ghost'; with: TrafficKind };

  /* -- scoring ------------------------------------------------------------ */
  'score:add': { amount: number; reason: string; total: number };
  'score:combo': { multiplier: number; chain: number };
  'score:combo-break': { chain: number };
  'score:milestone': { distance: number; tier: number };

  /* -- world -------------------------------------------------------------- */
  'biome:change': { from: BiomeId; to: BiomeId; distance: number };
  'weather:change': { from: WeatherId; to: WeatherId; intensity: number };
  'daynight:change': { phase: DayPhase; sunElevation: number };
  'world:tunnel-enter': { length: number };
  'world:tunnel-exit': Record<string, never>;

  /* -- meta --------------------------------------------------------------- */
  'garage:purchase': { carId: string; price: number; balance: number };
  'garage:equip': { carId: string };
  'garage:upgrade': { carId: string; stat: string; level: number; price: number };
  'save:write': { coins: number; best: number };
};

export type GameEventName = keyof GameEvents;
