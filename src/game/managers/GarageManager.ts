import type { GameContext, Manager } from '@/core/Manager';
import { CARS, UPGRADE, carById, effectiveStats, type CarDef, type UpgradableStat } from '@/game/config/Cars';
import type { SaveManager } from '@/game/SaveManager';

export interface GarageEntry {
  def: CarDef;
  owned: boolean;
  equipped: boolean;
  affordable: boolean;
  levels: Partial<Record<UpgradableStat, number>>;
  /** Price of the next level per stat, or null when maxed. */
  upgradePrices: Record<UpgradableStat, number | null>;
}

/**
 * Buying cars and upgrading them.
 *
 * All the money rules live here rather than in the UI, so the screen renders a
 * list of entries and calls three methods. Every transaction is checked against
 * the wallet before it is applied and reports back whether it happened — a
 * purchase path that assumes it succeeded is how a shop ends up giving things
 * away when two clicks land in the same frame.
 */
export class GarageManager implements Manager {
  readonly name = 'garage';

  constructor(
    private readonly ctx: GameContext,
    private readonly save: SaveManager,
  ) {}

  /** The whole roster, with ownership and prices resolved. */
  list(): GarageEntry[] {
    const coins = this.save.coins;
    const active = this.save.snapshot.activeCar;

    return CARS.map((def) => {
      const levels = this.save.upgradesFor(def.id);
      const upgradePrices = {} as Record<UpgradableStat, number | null>;
      for (const stat of Object.keys(UPGRADE.stepByStat) as UpgradableStat[]) {
        const level = levels[stat] ?? 0;
        upgradePrices[stat] = level >= UPGRADE.maxLevel ? null : UPGRADE.price(level + 1);
      }
      return {
        def,
        owned: this.save.owns(def.id),
        equipped: def.id === active,
        affordable: coins >= def.price,
        levels,
        upgradePrices,
      };
    });
  }

  /** Stats as they would be with everything currently bought for this car. */
  statsFor(carId: string) {
    return effectiveStats(carById(carId), this.save.upgradesFor(carId));
  }

  /**
   * Buy a car. Returns false when it is already owned or unaffordable, without
   * charging for either.
   */
  purchase(carId: string): boolean {
    const def = carById(carId);
    if (this.save.owns(def.id)) return false;
    if (!this.save.spend(def.price)) return false;

    this.save.addCar(def.id);
    this.ctx.bus.emit('garage:purchase', {
      carId: def.id, price: def.price, balance: this.save.coins,
    });
    this.ctx.bus.emit('save:write', { coins: this.save.coins, best: this.save.snapshot.best });
    return true;
  }

  /** Make an owned car the active one. */
  equip(carId: string): boolean {
    if (!this.save.owns(carId)) return false;
    this.save.setActiveCar(carId);
    this.ctx.bus.emit('garage:equip', { carId });
    return true;
  }

  /** Buy the next level of one stat on an owned car. */
  upgrade(carId: string, stat: UpgradableStat): boolean {
    if (!this.save.owns(carId)) return false;

    const level = this.save.upgradeLevel(carId, stat);
    if (level >= UPGRADE.maxLevel) return false;

    const price = UPGRADE.price(level + 1);
    if (!this.save.spend(price)) return false;

    this.save.setUpgradeLevel(carId, stat, level + 1);
    this.ctx.bus.emit('garage:upgrade', { carId, stat, level: level + 1, price });
    this.ctx.bus.emit('save:write', { coins: this.save.coins, best: this.save.snapshot.best });
    return true;
  }

  /** Nothing to advance per frame; the garage is not a simulation. */
  update(): void {}
}
