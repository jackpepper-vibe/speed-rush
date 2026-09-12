import type { GameContext, Manager } from '@/core/Manager';
import { SCORE } from '@/game/config/Balance';

/**
 * Score, the near-miss combo, and distance milestones.
 *
 * The combo is the reason to drive badly on purpose. Distance alone rewards
 * survival, which pushes a player into the emptiest lane and keeps them there;
 * a multiplier that only climbs when you pass close to something rewards the
 * opposite, and the two together are what make a lane choice interesting.
 *
 * The chain decays on a timer rather than on a crash, so it is possible to lose
 * a multiplier by playing it safe. That is the point.
 */
export class ScoreManager implements Manager {
  readonly name = 'score';

  private total = 0;
  private chain = 0;
  private comboTimer = 0;
  private lastMilestone = 0;
  private coinsThisRun = 0;

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    this.ctx.bus.on('player:near-miss', ({ kind }) => this.onNearMiss(kind));
    this.ctx.bus.on('pickup:collect', ({ kind, value }) => this.onPickup(kind, value));
  }

  get score(): number {
    return this.total;
  }

  get multiplier(): number {
    return 1 + Math.min(this.chain, SCORE.comboMax) * SCORE.nearMissComboStep;
  }

  get comboChain(): number {
    return this.chain;
  }

  /** Seconds left before the chain lapses, for the HUD's draining bar. */
  get comboTimeLeft(): number {
    return Math.max(0, this.comboTimer);
  }

  get runCoins(): number {
    return this.coinsThisRun;
  }

  /** Award points and announce it. Every score change in the game goes here. */
  private award(amount: number, reason: string): void {
    this.total += amount;
    this.ctx.bus.emit('score:add', { amount, reason, total: Math.round(this.total) });
  }

  private onNearMiss(kind: string): void {
    this.chain += 1;
    this.comboTimer = SCORE.comboWindow;
    this.award(Math.round(SCORE.nearMiss * this.multiplier), `near-miss:${kind}`);
    this.ctx.bus.emit('score:combo', { multiplier: this.multiplier, chain: this.chain });
  }

  private onPickup(kind: string, value: number): void {
    if (kind === 'coin') {
      this.coinsThisRun += value;
      this.award(SCORE.coinScore, 'coin');
    } else if (kind === 'gem') {
      this.coinsThisRun += value;
      this.award(SCORE.gemScore, 'gem');
    }
    // Power-up crates are their own reward; they do not pay points.
  }

  update(dt: number, speed: number, distance: number): void {
    this.total += speed * dt * SCORE.perUnitDistance;

    if (this.chain > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        const broken = this.chain;
        this.chain = 0;
        this.comboTimer = 0;
        this.ctx.bus.emit('score:combo-break', { chain: broken });
      }
    }

    const tier = Math.floor(distance / (SCORE.milestoneKm * 1000));
    if (tier > this.lastMilestone) {
      this.lastMilestone = tier;
      this.award(SCORE.milestoneBonus * tier, `milestone:${tier}`);
      this.ctx.bus.emit('score:milestone', { distance, tier });
    }
  }

  reset(): void {
    this.total = 0;
    this.chain = 0;
    this.comboTimer = 0;
    this.lastMilestone = 0;
    this.coinsThisRun = 0;
  }
}
