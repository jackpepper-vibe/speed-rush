import type { GameContext, Manager } from '@/core/Manager';
import type { GameEventName } from '@/core/GameEvents';
import { SPEED } from '@/game/config/Balance';
import { Synth, type VoiceReport } from '@/game/audio/Synth';
import type { SaveManager } from '@/game/SaveManager';
import type { PlayerManager } from './PlayerManager';

/**
 * Cues in, sound out.
 *
 * The synth knows how to make noises and the game knows what just happened;
 * this is the only place that knows which noise belongs to which happening.
 * Everything is driven off the existing event bus rather than by systems
 * calling into audio, so adding a sound never means editing gameplay code, and
 * a cue that stops firing goes silent rather than going wrong.
 *
 * Every play is recorded — voices created and the gain it opened at — because
 * "is there sound" is not a question a screenshot can answer and not one a
 * boolean can answer honestly either. A synth that builds an oscillator at zero
 * gain, or behind a muted master, is as silent as no synth at all, and both of
 * those have shipped in this project's history.
 */

/**
 * Every cue that must make a sound.
 *
 * This list is the audio coverage gate. A cue here with no recorded play after
 * a representative session is a silent feature, and the probe fails on it.
 */
export const AUDIBLE_CUES: GameEventName[] = [
  'run:start',
  'run:countdown',
  'player:drift',
  'player:crash',
  'player:near-miss',
  'player:land',
  'traffic:horn',
  'pickup:collect',
  'powerup:activate',
  'powerup:expire',
  'powerup:blocked-crash',
  'score:combo',
  'score:milestone',
  'weather:change',
  'garage:purchase',
  'garage:equip',
  'garage:upgrade',
];

export interface CueAudioStat {
  plays: number;
  oscillators: number;
  buffers: number;
  peakGain: number;
}

export class AudioManager implements Manager {
  readonly name = 'audio';

  private synth: Synth | null = null;
  private readonly stats: Record<string, CueAudioStat> = {};

  /** Rising index through a coin run, so a line of coins plays as a phrase. */
  private coinPitch = 0;
  private coinPitchDecay = 0;

  private muted: boolean;
  private running = false;

  constructor(
    private readonly ctx: GameContext,
    private readonly save: SaveManager,
    private readonly player: PlayerManager,
  ) {
    this.muted = save.muted;
    for (const cue of AUDIBLE_CUES) {
      this.stats[cue] = { plays: 0, oscillators: 0, buffers: 0, peakGain: 0 };
    }
  }

  init(): void {
    this.subscribe();
  }

  /* --------------------------------------------------------------- context */

  /**
   * Build the audio graph.
   *
   * Deferred until first asked for, because a context created before a user
   * gesture starts `suspended` on every current browser and every sound played
   * into it is silently dropped. Callers reach this through `resume`, which the
   * UI wires to the first click.
   */
  private ensure(): Synth | null {
    if (this.synth) return this.synth;
    try {
      this.synth = new Synth();
      this.synth.setMuted(this.muted);
      return this.synth;
    } catch {
      // No Web Audio at all. The game is still entirely playable.
      return null;
    }
  }

  /** Called on the first user gesture, and safe to call repeatedly. */
  resume(): void {
    const synth = this.ensure();
    if (!synth) return;
    if (synth.ctx.state === 'suspended') void synth.ctx.resume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.save.setMuted(muted);
    this.synth?.setMuted(muted);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** What each cue actually produced. Read by the probe. */
  audioStats(): Record<string, CueAudioStat> {
    return JSON.parse(JSON.stringify(this.stats));
  }

  /** Cues that are supposed to make a sound and never have. */
  silentCues(): string[] {
    return AUDIBLE_CUES.filter((c) => this.stats[c].plays === 0);
  }

  get contextState(): string {
    return this.synth?.ctx.state ?? 'none';
  }

  /* ------------------------------------------------------------- recording */

  /** Run a voice and record what it produced against the cue that asked. */
  private play(cue: GameEventName, fn: (synth: Synth) => VoiceReport): void {
    const synth = this.ensure();
    if (!synth) return;
    const report = fn(synth);
    const stat = this.stats[cue];
    if (!stat) return;
    stat.plays += 1;
    stat.oscillators += report.oscillators;
    stat.buffers += report.buffers;
    stat.peakGain = Math.max(stat.peakGain, report.gain);
  }

  /* ------------------------------------------------------------ the wiring */

  private subscribe(): void {
    const bus = this.ctx.bus;

    bus.on('run:start', () => {
      this.running = true;
      this.play('run:start', (s) => s.startEngine());
    });

    bus.on('run:end', () => {
      this.running = false;
      this.synth?.stopEngine();
      this.synth?.setSqueal(0);
      this.synth?.setRain(0);
    });

    bus.on('run:countdown', ({ remaining }) => {
      this.play('run:countdown', (s) => s.playCountdown(remaining));
    });

    // Drift is a state change, not a one-shot: the squeal is held open by
    // `update` for as long as the car is actually sliding.
    bus.on('player:drift', ({ intensity }) => {
      this.play('player:drift', (s) => s.setSqueal(Math.max(0.35, Math.min(1, intensity))));
    });

    bus.on('player:crash', ({ with: what }) => {
      // A barrier is a scrape you drive away from; traffic is the end of the run.
      this.play('player:crash', (s) => (what === 'barrier' ? s.playScrape() : s.playCrash()));
    });

    bus.on('player:near-miss', () => {
      this.play('player:near-miss', (s) => s.playNearMiss());
    });

    bus.on('player:land', ({ impact }) => {
      this.play('player:land', (s) => s.playLand(impact));
    });

    bus.on('traffic:horn', ({ kind, closing }) => {
      this.play('traffic:horn', (s) => s.playHorn(closing, kind === 'truck' || kind === 'bus'));
    });

    bus.on('pickup:collect', ({ kind }) => {
      this.play('pickup:collect', (s) => {
        if (kind === 'gem') return s.playGem();
        if (kind === 'coin') {
          const report = s.playCoin(this.coinPitch);
          this.coinPitch += 1;
          this.coinPitchDecay = 0.9;
          return report;
        }
        // A crate: the activate cue that follows carries the sound.
        return s.playUi(true);
      });
    });

    bus.on('powerup:activate', () => {
      this.play('powerup:activate', (s) => s.playPowerupActivate());
    });

    bus.on('powerup:expire', () => {
      this.play('powerup:expire', (s) => s.playPowerupExpire());
    });

    bus.on('powerup:blocked-crash', () => {
      this.play('powerup:blocked-crash', (s) => s.playShieldBlock());
    });

    bus.on('score:combo', ({ chain }) => {
      this.play('score:combo', (s) => s.playCombo(chain));
    });

    bus.on('score:milestone', () => {
      this.play('score:milestone', (s) => s.playMilestone());
    });

    bus.on('weather:change', ({ to, intensity }) => {
      const wet = to === 'rain' || to === 'storm' ? intensity : 0;
      this.play('weather:change', (s) => s.setRain(wet));
    });

    bus.on('garage:purchase', () => {
      this.play('garage:purchase', (s) => s.playPurchase());
    });

    bus.on('garage:equip', () => {
      this.play('garage:equip', (s) => s.playUi(true));
    });

    bus.on('garage:upgrade', () => {
      this.play('garage:upgrade', (s) => s.playUi(true));
    });
  }

  /* ------------------------------------------------------------------ frame */

  update(dt: number): void {
    const synth = this.synth;
    if (!synth || !this.running) return;

    // Revs: a synthetic six-speed box, so the note climbs and drops rather than
    // rising in one long unbroken slide from standstill to top speed.
    const fraction = Math.min(this.player.speed / SPEED.absoluteMax, 1);
    const gears = 6;
    const gear = Math.min(Math.floor(fraction * gears), gears - 1);
    const rpm = fraction * gears - gear;
    synth.setEngine(rpm, fraction);

    // Hold the squeal open only while genuinely sliding.
    synth.setSqueal(this.player.slipping ? Math.min(1, Math.abs(this.player.vx) / 9) : 0);

    if (this.coinPitchDecay > 0) {
      this.coinPitchDecay -= dt;
      if (this.coinPitchDecay <= 0) this.coinPitch = 0;
    }
  }

  reset(): void {
    this.coinPitch = 0;
    this.coinPitchDecay = 0;
    this.synth?.setSqueal(0);
  }

  dispose(): void {
    this.synth?.dispose();
    this.synth = null;
  }
}
