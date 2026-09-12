/**
 * The voices, and nothing that knows about the game.
 *
 * Every sound is built from oscillators and generated noise at runtime, so the
 * whole game stays a single deployable with no audio assets to fetch, decode or
 * cache-bust. The trade is that each voice has to be cheap enough to fire
 * several times a second during dense traffic, which is why the noise buffer is
 * generated once and shared rather than rebuilt per burst — the original
 * allocated a fresh `AudioBuffer` for every crash and every tyre squeal.
 *
 * Each play method reports the voices it created and the gain it opened at, so
 * the layer above can record what was actually audible rather than what it
 * believes it requested.
 */

export interface VoiceReport {
  /** Oscillator nodes started. */
  oscillators: number;
  /** Buffer sources started. */
  buffers: number;
  /** Peak gain this voice opened at, before the master. */
  gain: number;
}

const NOISE_SECONDS = 2;

export class Synth {
  readonly ctx: AudioContext;
  /** Everything routes through here, so one gain mutes the game. */
  readonly master: GainNode;
  private readonly sfxBus: GainNode;
  private readonly engineBus: GainNode;
  private readonly ambienceBus: GainNode;

  /** Shared white-noise buffer, generated once. */
  private readonly noise: AudioBuffer;

  /* Engine voices, held open for the life of a run. */
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  /* Rain bed, likewise continuous. */
  private rainSource: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;

  /* Tyre squeal, held while the car is sliding. */
  private squealSource: AudioBufferSourceNode | null = null;
  private squealGain: GainNode | null = null;
  private squealFilter: BiquadFilterNode | null = null;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new (window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);

    this.engineBus = this.ctx.createGain();
    this.engineBus.gain.value = 1;
    this.engineBus.connect(this.master);

    this.ambienceBus = this.ctx.createGain();
    this.ambienceBus.gain.value = 1;
    this.ambienceBus.connect(this.master);

    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * NOISE_SECONDS, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  setMuted(muted: boolean): void {
    this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.now, 0.02);
  }

  /* --------------------------------------------------------------- engine */

  /**
   * Start the engine.
   *
   * Two detuned oscillators through a resonant lowpass: a sawtooth for the
   * body and a square an octave down for the bottom end. One oscillator alone
   * reads as a wasp rather than an engine, and the filter sweep is what makes
   * it sound like it is under load rather than just playing higher.
   */
  startEngine(): VoiceReport {
    this.stopEngine();

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineGain.connect(this.engineBus);

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = 6;
    this.engineFilter.connect(this.engineGain);

    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 58;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc.start();

    this.engineSub = this.ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineSub.frequency.value = 29;
    this.engineSub.detune.value = -6;
    this.engineSub.connect(this.engineFilter);
    this.engineSub.start();

    this.engineGain.gain.setTargetAtTime(0.085, this.now, 0.12);
    return { oscillators: 2, buffers: 0, gain: 0.085 };
  }

  /**
   * Track engine note to revs.
   *
   * `rpm` is 0..1 within the current gear, `load` 0..1 overall speed. Pitch
   * follows the gear, the filter follows the load, so shifting up drops the
   * note without dropping the sense of speed.
   */
  setEngine(rpm: number, load: number): void {
    if (!this.engineOsc || !this.engineSub || !this.engineFilter) return;
    const t = this.now;
    const base = 58 + rpm * 132;
    this.engineOsc.frequency.setTargetAtTime(base, t, 0.05);
    this.engineSub.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(420 + load * 2600, t, 0.08);
  }

  stopEngine(): void {
    for (const osc of [this.engineOsc, this.engineSub]) {
      if (!osc) continue;
      try { osc.stop(); } catch { /* already stopped */ }
      osc.disconnect();
    }
    this.engineOsc = null;
    this.engineSub = null;
    this.engineGain?.disconnect();
    this.engineGain = null;
    this.engineFilter?.disconnect();
    this.engineFilter = null;
  }

  /* ---------------------------------------------------------------- squeal */

  /** Tyre scrub, held open while sliding and faded by `amount`. */
  setSqueal(amount: number): VoiceReport {
    if (amount <= 0.001) {
      if (this.squealGain) this.squealGain.gain.setTargetAtTime(0, this.now, 0.06);
      return { oscillators: 0, buffers: 0, gain: 0 };
    }

    let started = 0;
    if (!this.squealSource) {
      this.squealSource = this.ctx.createBufferSource();
      this.squealSource.buffer = this.noise;
      this.squealSource.loop = true;

      this.squealFilter = this.ctx.createBiquadFilter();
      this.squealFilter.type = 'bandpass';
      this.squealFilter.frequency.value = 1750;
      this.squealFilter.Q.value = 7.5;

      this.squealGain = this.ctx.createGain();
      this.squealGain.gain.value = 0;

      this.squealSource.connect(this.squealFilter);
      this.squealFilter.connect(this.squealGain);
      this.squealGain.connect(this.sfxBus);
      this.squealSource.start();
      started = 1;
    }

    const gain = Math.min(0.16, amount * 0.16);
    this.squealGain!.gain.setTargetAtTime(gain, this.now, 0.04);
    // Scrub rises in pitch as the slide worsens.
    this.squealFilter!.frequency.setTargetAtTime(1500 + amount * 900, this.now, 0.05);
    return { oscillators: 0, buffers: started, gain };
  }

  /* ------------------------------------------------------------- one-shots */

  /** Filtered noise burst — crashes, impacts, landings. */
  private burst(opts: {
    duration: number; frequency: number; q: number; gain: number;
    type?: BiquadFilterType; sweepTo?: number;
  }): VoiceReport {
    const t = this.now;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    // A random window into the shared buffer, so repeats do not phase-lock.
    const offset = Math.random() * (NOISE_SECONDS - opts.duration - 0.01);

    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.frequency.value = opts.frequency;
    filter.Q.value = opts.q;
    if (opts.sweepTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.duration);
    }

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(t, Math.max(0, offset), opts.duration);
    src.stop(t + opts.duration);

    return { oscillators: 0, buffers: 1, gain: opts.gain };
  }

  /** A pitched blip. The building block for coins, gems and power-ups. */
  private blip(opts: {
    from: number; to: number; duration: number; gain: number;
    type?: OscillatorType; delay?: number;
  }): VoiceReport {
    const t = this.now + (opts.delay ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + opts.duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(opts.gain, t + opts.duration * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);

    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + opts.duration + 0.02);

    return { oscillators: 1, buffers: 0, gain: opts.gain };
  }

  playCoin(pitch = 0): VoiceReport {
    // Pitch climbs through a coin run, so a full line sounds like a phrase
    // rather than the same note eight times.
    const base = 880 * Math.pow(2, Math.min(pitch, 7) / 12);
    return this.blip({ from: base, to: base * 2, duration: 0.12, gain: 0.13 });
  }

  playGem(): VoiceReport {
    let oscillators = 0;
    for (const [i, f] of [660, 880, 1320, 1760].entries()) {
      oscillators += this.blip({
        from: f, to: f * 1.02, duration: 0.16, gain: 0.12, delay: i * 0.055,
      }).oscillators;
    }
    return { oscillators, buffers: 0, gain: 0.12 };
  }

  playPowerupActivate(): VoiceReport {
    let oscillators = 0;
    for (const [i, f] of [392, 523, 659, 784, 1047].entries()) {
      oscillators += this.blip({
        from: f, to: f * 1.01, duration: 0.2, gain: 0.14, type: 'triangle', delay: i * 0.05,
      }).oscillators;
    }
    return { oscillators, buffers: 0, gain: 0.14 };
  }

  playPowerupExpire(): VoiceReport {
    let oscillators = 0;
    for (const [i, f] of [784, 587, 440].entries()) {
      oscillators += this.blip({
        from: f, to: f * 0.98, duration: 0.16, gain: 0.1, type: 'triangle', delay: i * 0.06,
      }).oscillators;
    }
    return { oscillators, buffers: 0, gain: 0.1 };
  }

  playShieldBlock(): VoiceReport {
    const a = this.blip({ from: 220, to: 880, duration: 0.22, gain: 0.2, type: 'square' });
    const b = this.burst({ duration: 0.3, frequency: 900, q: 2, gain: 0.22 });
    return { oscillators: a.oscillators, buffers: b.buffers, gain: 0.22 };
  }

  playCrash(): VoiceReport {
    this.stopEngine();
    const low = this.burst({ duration: 1.1, frequency: 380, q: 0.6, gain: 0.55, type: 'lowpass', sweepTo: 90 });
    const glass = this.burst({ duration: 0.45, frequency: 3200, q: 1.4, gain: 0.2 });
    return { oscillators: 0, buffers: low.buffers + glass.buffers, gain: 0.55 };
  }

  playScrape(): VoiceReport {
    return this.burst({ duration: 0.26, frequency: 2400, q: 3.2, gain: 0.16 });
  }

  playLand(impact: number): VoiceReport {
    const gain = Math.min(0.34, 0.08 + impact * 0.03);
    return this.burst({ duration: 0.28, frequency: 220, q: 0.9, gain, type: 'lowpass' });
  }

  playNearMiss(): VoiceReport {
    // A downward whoosh: the doppler of something going past, without the horn.
    return this.burst({ duration: 0.34, frequency: 2600, q: 1.1, gain: 0.17, sweepTo: 520 });
  }

  /**
   * A horn, pitched by how fast it is closing.
   *
   * `approach` is the closing speed as a fraction of top speed, positive when
   * the vehicle is coming toward the listener. The note is shifted up on the
   * way in and down on the way out — the effect only reads because the shift
   * happens across the pass rather than being a fixed pitch per vehicle.
   */
  playHorn(approach: number, big: boolean): VoiceReport {
    const t = this.now;
    const shift = 1 + approach * 0.18;
    const base = (big ? 138 : 196) * shift;
    const duration = big ? 0.62 : 0.4;

    let oscillators = 0;
    for (const ratio of [1, 1.5]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base * ratio, t);
      // Falls away as it goes past.
      osc.frequency.linearRampToValueAtTime(base * ratio * 0.86, t + duration);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.16, t + 0.04);
      gain.gain.setValueAtTime(0.16, t + duration * 0.65);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      osc.connect(gain);
      gain.connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + duration + 0.02);
      oscillators += 1;
    }
    return { oscillators, buffers: 0, gain: 0.16 };
  }

  playCombo(chain: number): VoiceReport {
    const base = 523 * Math.pow(2, Math.min(chain, 8) / 12);
    return this.blip({ from: base, to: base * 1.5, duration: 0.14, gain: 0.11, type: 'triangle' });
  }

  playMilestone(): VoiceReport {
    let oscillators = 0;
    for (const [i, f] of [523, 659, 784, 1047, 1319].entries()) {
      oscillators += this.blip({
        from: f, to: f, duration: 0.26, gain: 0.15, type: 'triangle', delay: i * 0.08,
      }).oscillators;
    }
    return { oscillators, buffers: 0, gain: 0.15 };
  }

  playCountdown(remaining: number): VoiceReport {
    const go = remaining <= 0;
    return this.blip({
      from: go ? 880 : 440, to: go ? 1320 : 440,
      duration: go ? 0.4 : 0.16, gain: 0.2, type: 'square',
    });
  }

  playUi(up: boolean): VoiceReport {
    return this.blip({ from: up ? 700 : 500, to: up ? 1000 : 380, duration: 0.08, gain: 0.09, type: 'square' });
  }

  playPurchase(): VoiceReport {
    let oscillators = 0;
    for (const [i, f] of [523, 659, 784, 1047].entries()) {
      oscillators += this.blip({ from: f, to: f, duration: 0.22, gain: 0.14, delay: i * 0.07 }).oscillators;
    }
    return { oscillators, buffers: 0, gain: 0.14 };
  }

  /* ------------------------------------------------------------------ rain */

  /** Continuous rain bed, faded by `amount`. */
  setRain(amount: number): VoiceReport {
    if (amount <= 0.001) {
      if (this.rainGain) this.rainGain.gain.setTargetAtTime(0, this.now, 0.4);
      return { oscillators: 0, buffers: 0, gain: 0 };
    }

    let started = 0;
    if (!this.rainSource) {
      this.rainSource = this.ctx.createBufferSource();
      this.rainSource.buffer = this.noise;
      this.rainSource.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1100;

      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0;

      this.rainSource.connect(filter);
      filter.connect(this.rainGain);
      this.rainGain.connect(this.ambienceBus);
      this.rainSource.start();
      started = 1;
    }

    const gain = amount * 0.13;
    this.rainGain!.gain.setTargetAtTime(gain, this.now, 0.5);
    return { oscillators: 0, buffers: started, gain };
  }

  dispose(): void {
    this.stopEngine();
    for (const src of [this.rainSource, this.squealSource]) {
      if (!src) continue;
      try { src.stop(); } catch { /* already stopped */ }
      src.disconnect();
    }
    this.rainSource = null;
    this.squealSource = null;
    void this.ctx.close();
  }
}
