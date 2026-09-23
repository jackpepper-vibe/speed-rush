import type { GameContext, Manager } from '@/core/Manager';
import type { PowerupId, TrafficKind } from '@/core/GameEvents';
import { POWERUPS } from '@/game/config/Balance';
import type { PlayerManager } from './PlayerManager';

/**
 * Active power-up effects and their timers.
 *
 * Effects are held as remaining-seconds rather than as booleans plus an expiry
 * frame, so a pickup collected while the same effect is running extends it
 * instead of restarting it — collecting a second shield at four seconds left
 * should not feel like a downgrade.
 *
 * The manager owns what each effect *does* as well as how long it lasts. Other
 * systems ask it questions — is the player shielded, what is the speed
 * multiplier, is time slowed — rather than reading timers and re-deriving the
 * rules, so there is one place where "nitro" means something.
 */
export class PowerupManager implements Manager {
  readonly name = 'powerups';

  private readonly remaining = new Map<PowerupId, number>();
  /**
   * What each effect had left the last time it was started or extended: the
   * whole of the bar the HUD counts down. Against the base duration an
   * extended or nitro-boosted effect read as more than full.
   */
  private readonly full = new Map<PowerupId, number>();

  /**
   * Invulnerability left over from an absorbed impact.
   *
   * Without it a shield saves you for exactly one tick: it is consumed by the
   * contact, and the car it absorbed is still inside the collision box on the
   * very next frame, so the second test kills you. The grace window is what
   * lets the player actually get clear of the vehicle they just bounced off,
   * and it is why a shield reads as surviving a crash rather than as delaying
   * one by eight milliseconds.
   */
  private grace = 0;
  private static readonly GRACE_SECONDS = 1.4;

  constructor(
    private readonly ctx: GameContext,
    private readonly player: PlayerManager,
  ) {}

  /** Seconds left on an effect, 0 when inactive. */
  timeLeft(id: PowerupId): number {
    return this.remaining.get(id) ?? 0;
  }

  isActive(id: PowerupId): boolean {
    return this.timeLeft(id) > 0;
  }

  /** Fraction of the effect still to run, 1 when just started or extended. */
  fraction(id: PowerupId): number {
    const full = this.full.get(id) ?? 0;
    return full > 0 ? Math.min(1, this.timeLeft(id) / full) : 0;
  }

  /** Whether the effect was already running when it was last collected. */
  wasExtended(id: PowerupId): boolean {
    return this.extended.has(id);
  }

  private readonly extended = new Set<PowerupId>();

  get active(): PowerupId[] {
    return [...this.remaining.entries()].filter(([, t]) => t > 0).map(([id]) => id);
  }

  /** Start or extend an effect. */
  activate(id: PowerupId): void {
    const boost = id === 'nitro' ? this.player.boostDuration : 1;
    const duration = POWERUPS[id] * boost;
    if (this.isActive(id)) this.extended.add(id);
    else this.extended.delete(id);
    const next = this.timeLeft(id) + duration;
    this.remaining.set(id, next);
    this.full.set(id, next);
    this.ctx.bus.emit('powerup:activate', { id, duration });
  }

  /**
   * Ask whether a collision should be survived.
   *
   * A shield is consumed by the hit it absorbs; a ghost is not, because the
   * player is passing through traffic for its whole duration and consuming it
   * on first contact would make it a shield with extra steps.
   */
  absorbCrash(kind: TrafficKind): boolean {
    // Still inside the window opened by the last absorbed hit.
    if (this.grace > 0) return true;

    if (this.isActive('ghost')) {
      this.ctx.bus.emit('powerup:blocked-crash', { id: 'ghost', with: kind });
      return true;
    }
    if (this.isActive('shield')) {
      this.remaining.set('shield', 0);
      this.grace = PowerupManager.GRACE_SECONDS;
      this.ctx.bus.emit('powerup:blocked-crash', { id: 'shield', with: kind });
      this.ctx.bus.emit('powerup:expire', { id: 'shield' });
      return true;
    }
    return false;
  }

  /** True while the player cannot be killed, for the HUD's flashing body. */
  get invulnerable(): boolean {
    return this.grace > 0 || this.isActive('ghost') || this.isActive('shield');
  }

  /** Multiplier applied to the player's speed ceiling. */
  get speedMultiplier(): number {
    return this.isActive('nitro') ? POWERUPS.nitroBoost : 1;
  }

  /** Scale applied to everything in the world except the player's controls. */
  get timeScale(): number {
    return this.isActive('slowmo') ? POWERUPS.slowmoScale : 1;
  }

  update(dt: number): void {
    if (this.grace > 0) this.grace = Math.max(0, this.grace - dt);
    if (this.remaining.size === 0) return;
    for (const [id, left] of this.remaining) {
      if (left <= 0) continue;
      const next = left - dt;
      this.remaining.set(id, Math.max(0, next));
      if (next <= 0) this.ctx.bus.emit('powerup:expire', { id });
    }
    this.player.setBoost(this.speedMultiplier);
  }

  reset(): void {
    this.remaining.clear();
    this.full.clear();
    this.extended.clear();
    this.grace = 0;
    this.player.setBoost(1);
  }
}
