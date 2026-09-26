import type { UpgradableStat } from '@/game/config/Cars';
import { cleanName } from '@shared/leaderboard';

export interface SaveData {
  version: number;
  coins: number;
  best: number;
  bestDistance: number;
  playerName: string;
  activeCar: string;
  owned: string[];
  upgrades: Record<string, Partial<Record<UpgradableStat, number>>>;
  runs: number;
  muted: boolean;
  /** Which records season the best score and distance in this save belong to. */
  season: number;
}

const KEY = 'speedrush.v2';
const CURRENT_VERSION = 2;

/**
 * The personal-records season. Raising it clears every player's best score
 * and furthest distance once, the next time their save is loaded, and nothing
 * else: coins, cars, upgrades and the name are theirs to keep.
 *
 * 2: records set when the game was easier, which a player on the current game
 * could not fairly beat.
 *
 * The shared leaderboard has its own season, on the server's side, in
 * `shared/leaderboard.ts`.
 */
const RECORDS_SEASON = 2;

function blank(): SaveData {
  return {
    version: CURRENT_VERSION,
    coins: 0,
    best: 0,
    bestDistance: 0,
    playerName: '',
    activeCar: 'dart',
    owned: ['dart'],
    upgrades: {},
    runs: 0,
    muted: false,
    season: RECORDS_SEASON,
  };
}

/**
 * Persistence, with the reads and writes funnelled through one object.
 *
 * Every field is validated on load rather than trusted. localStorage is shared
 * with whatever else is on the origin and survives across versions of the game,
 * so a save written by a build that had three cars must not be able to leave
 * `activeCar` pointing at something the current build cannot construct.
 */
export class SaveManager {
  private data: SaveData;

  constructor(private readonly storage: Storage | null = safeStorage()) {
    this.data = this.load();
    // Written back at once, so a season reset is done once and not on every load.
    this.flush();
  }

  private load(): SaveData {
    const fallback = blank();
    if (!this.storage) return fallback;
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      // Records from an earlier season do not carry over; the rest of the save does.
      const current = parsed.season === RECORDS_SEASON;
      return {
        version: CURRENT_VERSION,
        coins: num(parsed.coins, 0),
        best: current ? num(parsed.best, 0) : 0,
        bestDistance: current ? num(parsed.bestDistance, 0) : 0,
        playerName: typeof parsed.playerName === 'string' ? cleanName(parsed.playerName) : '',
        activeCar: typeof parsed.activeCar === 'string' ? parsed.activeCar : 'dart',
        owned: Array.isArray(parsed.owned) ? parsed.owned.filter((c) => typeof c === 'string') : ['dart'],
        upgrades: typeof parsed.upgrades === 'object' && parsed.upgrades ? parsed.upgrades : {},
        runs: num(parsed.runs, 0),
        muted: parsed.muted === true,
        season: RECORDS_SEASON,
      };
    } catch {
      return fallback;
    }
  }

  private flush(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Quota or private mode. The run continues; only persistence is lost.
    }
  }

  get snapshot(): Readonly<SaveData> {
    return this.data;
  }

  get coins(): number {
    return this.data.coins;
  }

  addCoins(n: number): number {
    this.data.coins = Math.max(0, this.data.coins + Math.round(n));
    this.flush();
    return this.data.coins;
  }

  spend(n: number): boolean {
    if (this.data.coins < n) return false;
    this.data.coins -= n;
    this.flush();
    return true;
  }

  owns(carId: string): boolean {
    return this.data.owned.includes(carId);
  }

  addCar(carId: string): void {
    if (!this.data.owned.includes(carId)) this.data.owned.push(carId);
    this.flush();
  }

  setActiveCar(carId: string): void {
    this.data.activeCar = carId;
    this.flush();
  }

  upgradeLevel(carId: string, stat: UpgradableStat): number {
    return this.data.upgrades[carId]?.[stat] ?? 0;
  }

  setUpgradeLevel(carId: string, stat: UpgradableStat, level: number): void {
    const car = (this.data.upgrades[carId] ??= {});
    car[stat] = level;
    this.flush();
  }

  /**
   * Upgrade levels for a car, as a copy.
   *
   * Returning the stored object directly handed callers a live reference into
   * the save: two reads taken either side of a purchase were the same object,
   * so code comparing before and after saw no change — or rather, saw the
   * final value in both places.
   */
  upgradesFor(carId: string): Partial<Record<UpgradableStat, number>> {
    return { ...this.data.upgrades[carId] };
  }

  get muted(): boolean {
    return this.data.muted;
  }

  setMuted(muted: boolean): void {
    this.data.muted = muted;
    this.flush();
  }

  setName(name: string): void {
    const clean = cleanName(name);
    if (clean === this.data.playerName) return;
    this.data.playerName = clean;
    this.flush();
  }

  /** Record a finished run. Returns true when it beat the stored best. */
  recordRun(score: number, distance: number): boolean {
    this.data.runs += 1;
    const isBest = score > this.data.best;
    if (isBest) this.data.best = score;
    if (distance > this.data.bestDistance) this.data.bestDistance = distance;
    this.flush();
    return isBest;
  }

  /** Test seam — wipes the slot this build owns and nothing else. */
  clear(): void {
    this.data = blank();
    this.flush();
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    s.getItem(KEY);
    return s;
  } catch {
    return null;
  }
}
