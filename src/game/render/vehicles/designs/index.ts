import type { TrafficKind } from '@/core/GameEvents';
import type { CarDef } from '@/game/config/Cars';
import type { VehicleDesign } from '../Design';
import { BUS, TRUCK } from './Commercial';
import { GRAN_TURISMO } from './GranTurismo';
import { HYPERCAR } from './Hypercar';
import { MUSCLE } from './Muscle';
import { ROADSTER } from './Roadster';
import { COUPE, SEDAN, SUV, VAN } from './Saloon';
import { SUPERCAR } from './Supercar';
import { WEDGE } from './Wedge';

/** Which design each garage body builds. */
export const PLAYER_DESIGNS: Record<CarDef['body'], VehicleDesign> = {
  roadster: ROADSTER,
  coupe: GRAN_TURISMO,
  muscle: MUSCLE,
  wedge: WEDGE,
  super: SUPERCAR,
  hyper: HYPERCAR,
};

/** Which design each kind of traffic builds. */
export const TRAFFIC_DESIGNS: Record<TrafficKind, VehicleDesign> = {
  sedan: SEDAN,
  coupe: COUPE,
  suv: SUV,
  van: VAN,
  truck: TRUCK,
  bus: BUS,
};

/**
 * Paint each kind of traffic is sold in. Mostly the silvers, greys, whites and
 * dark blues real traffic is, with the occasional red or green — a road where
 * every car is a primary colour reads as a toy box.
 */
export const TRAFFIC_PAINTS: Record<TrafficKind, readonly number[]> = {
  sedan: [0xd9dde2, 0x9aa2ac, 0x2a2e36, 0x1f3f6e, 0x7a1c24, 0xe8e6de, 0x4a5058, 0x2f5a44],
  coupe: [0xc8ccd2, 0x1a1c22, 0xa8202a, 0x2c5a9a, 0xe0b020, 0xf0f0ee],
  suv: [0x2a2e36, 0xd8dade, 0x5a6068, 0x3a4a3a, 0x6a1a1e, 0x1c2c48],
  van: [0xf2f2ee, 0xe8e8e2, 0xb8bec6, 0x2a3a5a, 0xc83a1a],
  truck: [0xeef0f2, 0x2a4a8a, 0xb82a22, 0x3a6a3a, 0xe8c22a],
  bus: [0xd8581f, 0xf2c21a, 0x2a6ab8, 0xeeeeea],
};

/** Plate slots in the atlas for each kind; the player's cars use 0-5. */
export const TRAFFIC_PLATES: Record<TrafficKind, number> = {
  sedan: 6,
  coupe: 7,
  suv: 8,
  van: 9,
  truck: 10,
  bus: 11,
};
