import type { Game } from '@/game/Game';
import type { GameEventName, GameEvents } from '@/core/GameEvents';
import { ROAD, SCORE, SPEED } from '@/game/config/Balance';
import { AUDIBLE_CUES } from '@/game/managers/AudioManager';
import { HUD_ELEMENTS, SCREEN_ELEMENTS } from '@/ui/UIManager';
import { auditVehicles } from '@/game/render/CarFactory';
import { CARS } from '@/game/config/Cars';
import { measureGlow } from '@/dev/GlowProbe';
import { renderCarPreviews } from '@/ui/CarPreview';

/**
 * The surface the probe drives the game through.
 *
 * Two things live here and nothing else. First, a recorder: it subscribes to
 * every name in the event map and keeps a count and the last payload for each,
 * so "did the near-miss cue fire, and with what gap" is a property of the
 * running game rather than something inferred from a screenshot. Second, a set
 * of deterministic drivers — `step`, `drive`, `teleport` — that advance the
 * simulation by an exact number of ticks with no clock involved.
 *
 * It is attached in every build, not just development ones. A handle that is
 * compiled out is a handle that has never been tested against the code that
 * actually ships, and the cost here is a few hundred bytes and one subscription
 * per event name.
 */

/** Every cue the recorder watches. Kept explicit so a new event without a probe
 *  check shows up as a missing key rather than silently going unrecorded. */
export const RECORDED_EVENTS: GameEventName[] = [
  'run:start', 'run:countdown', 'run:end', 'run:tick',
  'player:lane-change', 'player:steer', 'player:drift', 'player:crash',
  'player:near-miss', 'player:airborne', 'player:land',
  'traffic:spawn', 'traffic:lane-change', 'traffic:brake', 'traffic:despawn', 'traffic:horn',
  'pickup:collect', 'pickup:magnetised',
  'powerup:activate', 'powerup:expire', 'powerup:blocked-crash',
  'score:add', 'score:combo', 'score:combo-break', 'score:milestone',
  'biome:change', 'weather:change', 'daynight:change',
  'world:tunnel-enter', 'world:tunnel-exit',
  'garage:purchase', 'garage:equip', 'garage:upgrade', 'save:write',
];

export interface CueRecord {
  count: number;
  last: unknown;
  /** Tick index at which the cue most recently fired. */
  atTick: number;
}

export interface DevHandle {
  readonly version: string;
  /** Cue counts and last payloads, keyed by event name. */
  readonly cues: Record<string, CueRecord>;
  /** Reset every counter without touching game state. */
  clearCues(): void;
  /** Cues that have fired at least once. */
  firedCues(): string[];
  /** Cues in the recorded set that have never fired. */
  silentCues(): string[];

  /** Advance exactly n simulation ticks. */
  step(n: number): void;
  /** Advance `seconds` of simulation holding a fixed input. */
  drive(seconds: number, steer?: number, brake?: boolean): void;
  /** Begin a run with an optional fixed seed. */
  startRun(seed?: number): void;
  endRun(): void;

  /** Place the car laterally and set its speed, for targeted tests. */
  place(opts: { x?: number; vx?: number; speed?: number }): void;

  /**
   * Turn collisions off so handling, speed and stability can be measured over
   * a long run without a crash cutting the measurement short. Never off in play.
   */
  setCollisions(enabled: boolean): void;

  /** Live traffic in road space. */
  traffic(): { kind: string; lane: number; x: number; ahead: number; speed: number }[];

  /** Live pickups in road space. */
  pickups(): { kind: string; x: number; ahead: number; magnetised: boolean }[];

  /** Start a power-up directly, for tests about its effect rather than its pickup. */
  givePowerup(id: string): void;

  /** Stop new pickups being laid, without removing the ones already out. */
  setPickupSpawning(enabled: boolean): void;

  /** Stop new traffic spawning, and clear an empty road for tests that need one. */
  setTrafficSpawning(enabled: boolean): void;
  clearTraffic(): void;

  /** Seconds remaining on each running effect. */
  powerups(): Record<string, number>;

  /** Cancel every running effect, for a measurement that needs a clean car. */
  clearPowerups(): void;

  /** Begin the pre-run countdown rather than dropping straight into driving. */
  startCountdown(from?: number): void;

  /** Per-cue record of voices created and the gain they opened at. */
  audio(): Record<string, { plays: number; oscillators: number; buffers: number; peakGain: number }>;
  /** Cues that are supposed to make a sound and never have. */
  silentAudioCues(): string[];
  /** The cues audio coverage is measured against. */
  audibleCues(): string[];
  setMuted(muted: boolean): void;
  resumeAudio(): void;

  /** Pin biome, weather and time of day so captures are comparable. */
  pinWorld(conditions: { biome?: string; weather?: string; phase?: string } | null): void;

  /** Rendered garage previews, as car id to PNG data URL. */
  previews(): Record<string, string>;

  /** Triangle counts and material audit for every vehicle the factory builds. */
  models(): unknown[];
  /**
   * The current frame as a PNG data URL, read straight off the canvas.
   *
   * Playwright's own screenshot waits for the compositor to go idle, which a
   * scene running a post chain under software GL never does — it simply times
   * out. Rendering and reading back in the same task sidesteps the wait
   * entirely and is reproducible besides.
   */
  snapshot(): string;

  /** Rendered intensity profile across the player's underglow. */
  glowProfile(): { row: number[]; peak: number; maxStep: number; edgeLevel: number } | null;

  /* -- effects ------------------------------------------------------------
   * Live particle counts and the flame level, plus the seams the gate needs:
   * fire one effect on demand at full strength, and hide one so its
   * contribution to the frame can be measured as a difference rather than
   * asserted from the fact that an object exists. */
  effects(): { sparks: number; smoke: number; flame: number };
  burstEffect(kind: string): void;
  setEffectVisible(kind: string, visible: boolean): void;
  /** Hold the drift emitters open without having to provoke a real slide. */
  forceDrift(intensity: number): void;

  /** Live scenery instances per kind, and how many sit on the tarmac. */
  scenery(): { biome: string; kinds: { id: string; instances: number }[]; onRoad: number };
  /** Hide the scenery so its cost can be measured as a difference. */
  setSceneryVisible(visible: boolean): void;

  /** Element ids the HUD coverage gate is measured against. */
  uiElements(): { hud: string[]; screens: string[] };
  /** Drive the interface: menu, garage, pause. */
  toMenu(): void;
  toGarage(): void;
  pause(): void;
  unpause(): void;

  /** Garage: the roster, and the three transactions. */
  garage(): unknown[];
  buyCar(carId: string): boolean;
  equipCar(carId: string): boolean;
  upgradeCar(carId: string, stat: string): boolean;
  /** Grant coins, so a purchase can be tested without grinding for them. */
  grantCoins(n: number): number;
  /** Wipe the save slot, for a test that needs a fresh wallet and garage. */
  resetSave(): void;

  /** A flat readout of everything worth asserting on. */
  state(): Record<string, unknown>;
  /** Constants the probe should test against rather than duplicate. */
  config(): Record<string, unknown>;

  readonly game: Game;
}

export function installDevHandle(game: Game, version: string): DevHandle {
  const cues: Record<string, CueRecord> = {};
  for (const name of RECORDED_EVENTS) {
    cues[name] = { count: 0, last: null, atTick: -1 };
    game.bus.on(name, ((payload: GameEvents[typeof name]) => {
      const rec = cues[name];
      rec.count += 1;
      rec.last = payload;
      rec.atTick = game.tickCount;
    }) as never);
  }

  const handle: DevHandle = {
    version,
    cues,

    clearCues() {
      for (const name of RECORDED_EVENTS) {
        cues[name].count = 0;
        cues[name].last = null;
        cues[name].atTick = -1;
      }
    },

    firedCues() {
      return RECORDED_EVENTS.filter((n) => cues[n].count > 0);
    },

    silentCues() {
      return RECORDED_EVENTS.filter((n) => cues[n].count === 0);
    },

    step(n) {
      game.step(n);
    },

    drive(seconds, steer = 0, brake = false) {
      game.drive(seconds, steer, brake);
    },

    startRun(seed) {
      game.startRun(seed);
    },

    endRun() {
      game.endRun('quit');
    },

    place({ x, vx, speed }) {
      if (x !== undefined) game.player.x = x;
      if (vx !== undefined) game.player.vx = vx;
      if (speed !== undefined) game.player.speed = speed;
    },

    setCollisions(enabled) {
      game.traffic.collisionsEnabled = enabled;
    },

    traffic() {
      return game.traffic.snapshot();
    },

    pickups() {
      return game.pickups.snapshot();
    },

    givePowerup(id) {
      game.powerups.activate(id as never);
    },

    setPickupSpawning(enabled) {
      game.pickups.spawningEnabled = enabled;
    },

    clearPowerups() {
      game.powerups.reset();
    },

    startCountdown(from) {
      game.startCountdown(from);
    },

    audio() {
      return game.audio.audioStats();
    },

    silentAudioCues() {
      return game.audio.silentCues();
    },

    audibleCues() {
      return [...AUDIBLE_CUES];
    },

    setMuted(muted) {
      game.audio.setMuted(muted);
    },

    resumeAudio() {
      game.audio.resume();
    },

    snapshot() {
      // Rendered and read in one task: the drawing buffer is only guaranteed
      // valid until the browser next composites, which happens between tasks.
      game.rig.render();
      return game.rig.renderer.domElement.toDataURL('image/png');
    },

    pinWorld(conditions) {
      game.world.pin(conditions as never);
    },

    previews() {
      return Object.fromEntries(renderCarPreviews());
    },

    models() {
      return auditVehicles(CARS.map((c) => c.body));
    },

    glowProfile() {
      const glow = game.player.mesh.userData.glow;
      if (!glow) return null;
      return measureGlow(game.rig.renderer, glow);
    },

    effects() {
      return game.effects.snapshot();
    },

    burstEffect(kind) {
      game.effects.burst(kind as never);
    },

    setEffectVisible(kind, visible) {
      game.effects.setVisible(kind as never, visible);
    },

    forceDrift(intensity) {
      game.effects.forceDrift(intensity);
    },

    scenery() {
      return game.scenery.snapshot();
    },

    setSceneryVisible(visible) {
      game.scenery.setVisible(visible);
    },

    uiElements() {
      return { hud: [...HUD_ELEMENTS], screens: [...SCREEN_ELEMENTS] };
    },

    toMenu() {
      game.toMenu();
    },

    toGarage() {
      game.toGarage();
    },

    pause() {
      game.pause();
    },

    unpause() {
      game.unpause();
    },

    garage() {
      return game.garage.list();
    },

    buyCar(carId) {
      return game.garage.purchase(carId);
    },

    equipCar(carId) {
      return game.garage.equip(carId);
    },

    upgradeCar(carId, stat) {
      return game.garage.upgrade(carId, stat as never);
    },

    grantCoins(n) {
      return game.save.addCoins(n);
    },

    resetSave() {
      game.save.clear();
    },

    setTrafficSpawning(enabled) {
      game.traffic.spawningEnabled = enabled;
    },

    clearTraffic() {
      game.traffic.clearAll();
    },

    powerups() {
      const out: Record<string, number> = {};
      for (const id of ['shield', 'nitro', 'magnet', 'ghost', 'slowmo'] as const) {
        out[id] = game.powerups.timeLeft(id);
      }
      return out;
    },

    state() {
      const p = game.player;
      return {
        runState: game.runState,
        tick: game.tickCount,
        score: game.currentScore,
        distance: game.distance,
        speed: p.speed,
        speedKmh: game.speedKmh,
        speedFraction: p.speedFraction,
        speedCeiling: p.speedCeiling,
        x: p.x,
        vx: p.vx,
        y: p.y,
        airborne: p.airborne,
        lane: p.lane,
        slipping: p.slipping,
        // The car being driven right now, and the one the garage has selected.
        // They differ between equipping and the next run starting.
        carId: p.currentCarId,
        activeCar: game.save.snapshot.activeCar,
        coins: game.save.coins,
        best: game.save.snapshot.best,
        multiplier: game.scoring.multiplier,
        comboChain: game.scoring.comboChain,
        runCoins: game.scoring.runCoins,
        sceneChildren: game.rig.scene.children.length,
        cameraY: game.rig.camera.position.y,
        cameraZ: game.rig.camera.position.z,
        // Snapshotted after the last complete frame rather than read live:
        // the composer's passes each reset the live counters, so a direct read
        // reports only the final fullscreen quad.
        drawCalls: game.rig.frameStats.calls,
        triangles: game.rig.frameStats.triangles,
        geometries: game.rig.renderer.info.memory.geometries,
        textures: game.rig.renderer.info.memory.textures,
        biome: game.world.currentBiome,
        weather: game.world.currentWeather,
        dayPhase: game.world.currentPhase,
        inTunnel: game.world.isInTunnel,
        surfaceGrip: game.world.surfaceGrip,
        fogDensity: (game.rig.scene.fog as { density?: number })?.density ?? 0,
        sunIntensity: game.rig.sun.intensity,
        headlights: game.player.headlightIntensity,
        environmentBuilds: game.rig.environmentBuilds,
        hasEnvironment: game.rig.hasEnvironment,
        sceneryInstances: game.scenery.instanceCount,
        sceneryKinds: game.scenery.kindCount,
        muted: game.audio.isMuted,
        audioContext: game.audio.contextState,
        quality: game.rig.quality.tier,
        contextLost: game.rig.contextLost,
        roadSeamGap: game.road.maxSeamGap(),
      };
    },

    config() {
      return {
        laneCount: ROAD.laneCount,
        laneWidth: ROAD.laneWidth,
        halfWidth: ROAD.halfWidth,
        laneX: Array.from({ length: ROAD.laneCount }, (_, i) => ROAD.laneX(i)),
        comboWindow: SCORE.comboWindow,
        comboMax: SCORE.comboMax,
        milestoneKm: SCORE.milestoneKm,
        speedStart: SPEED.start,
        speedMax: SPEED.baseMax,
        speedAbsoluteMax: SPEED.absoluteMax,
        recordedEvents: RECORDED_EVENTS,
      };
    },

    game,
  };

  (window as unknown as { carRacer: DevHandle }).carRacer = handle;
  return handle;
}
