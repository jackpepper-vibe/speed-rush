import * as THREE from 'three';
import { EventBus } from '@/core/EventBus';
import type { GameEvents, RunState } from '@/core/GameEvents';
import { GameLoop } from '@/core/GameLoop';
import { ManagerRegistry, type GameContext } from '@/core/Manager';
import { Random } from '@/core/Random';
import { SceneRig } from '@/game/render/SceneRig';
import { RoadManager } from '@/game/managers/RoadManager';
import { PlayerManager } from '@/game/managers/PlayerManager';
import { InputManager } from '@/game/managers/InputManager';
import { TrafficManager } from '@/game/managers/TrafficManager';
import { PowerupManager } from '@/game/managers/PowerupManager';
import { PickupManager } from '@/game/managers/PickupManager';
import { ScoreManager } from '@/game/managers/ScoreManager';
import { WorldManager } from '@/game/managers/WorldManager';
import { SaveManager } from '@/game/SaveManager';
import { SPEED } from '@/game/config/Balance';

/**
 * Composition root.
 *
 * Owns the rig, the bus, the loop and the manager list, and nothing else —
 * every rule about how the game plays lives in a manager. The point is that
 * this file stays readable as a description of what the game is made of, and
 * that adding a system is one registration rather than an edit spread across
 * the update path.
 */
export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly rig: SceneRig;
  readonly save = new SaveManager();
  readonly rng: Random;

  readonly road: RoadManager;
  readonly player: PlayerManager;
  readonly input: InputManager;
  readonly traffic: TrafficManager;
  readonly powerups: PowerupManager;
  readonly pickups: PickupManager;
  readonly scoring: ScoreManager;
  readonly world: WorldManager;

  private readonly managers = new ManagerRegistry();
  private readonly loop: GameLoop;

  private state: RunState = 'menu';
  private seed: number;

  constructor(canvas: HTMLCanvasElement, seed?: number) {
    this.seed = seed ?? (Math.random() * 2 ** 32) >>> 0;
    this.rng = new Random(this.seed);
    this.rig = new SceneRig(canvas);

    const ctx: GameContext = {
      scene: this.rig.scene,
      camera: this.rig.camera,
      bus: this.bus,
      rng: this.rng,
    };

    // Order matters in one respect only: the player integrates before anything
    // that tests against its position.
    this.input = this.managers.add(new InputManager(canvas));
    this.player = this.managers.add(
      new PlayerManager(ctx, this.save.snapshot.activeCar, this.save.upgradesFor(this.save.snapshot.activeCar)),
    );
    this.road = this.managers.add(new RoadManager(ctx));
    this.powerups = this.managers.add(new PowerupManager(ctx, this.player));
    this.traffic = this.managers.add(new TrafficManager(ctx, this.road, this.player));
    this.pickups = this.managers.add(new PickupManager(ctx, this.road, this.player, this.powerups));
    this.world = this.managers.add(new WorldManager(ctx, this.rig, this.player, this.powerups));
    // Last in the order: it scores what the managers before it just did.
    this.scoring = this.managers.add(new ScoreManager(ctx));

    // A shield or a ghost decides whether a collision happens at all, so the
    // question is asked before the crash cue is raised rather than after. An
    // event bus cannot un-emit, and a crash that fires and is then "cancelled"
    // would already have ended the run and shaken the camera.
    this.traffic.crashGuard = (kind) => this.powerups.absorbCrash(kind);

    this.managers.initAll();

    // Hitting traffic ends the run; scraping a barrier only costs speed, which
    // the player manager has already applied by the time this is delivered.
    this.bus.on('player:crash', ({ with: what }) => {
      if (what !== 'barrier') this.endRun('crash');
    });

    this.loop = new GameLoop(this.tick, this.render);
  }

  /* ------------------------------------------------------------- lifecycle */

  get runState(): RunState {
    return this.state;
  }

  get currentScore(): number {
    return this.scoring.score;
  }

  get distance(): number {
    return this.road.travelled;
  }

  get tickCount(): number {
    return this.loop.tickCount;
  }

  start(): void {
    this.loop.start();
  }

  /** Begin a run. Managers return to their run-start state first. */
  startRun(seed?: number): void {
    if (seed !== undefined) {
      this.seed = seed >>> 0;
      this.rng.reset(this.seed);
    }
    this.managers.resetAll();
    this.state = 'driving';

    const carId = this.save.snapshot.activeCar;
    if (carId !== this.player.currentCarId) {
      this.player.setCar(carId, this.save.upgradesFor(carId));
    }

    this.bus.emit('run:start', { seed: this.seed, carId });
  }

  endRun(cause: 'crash' | 'quit'): void {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    const distance = this.road.travelled;
    const coins = this.scoring.runCoins;
    this.save.addCoins(coins);
    this.save.recordRun(Math.round(this.scoring.score), Math.round(distance));
    this.bus.emit('run:end', {
      score: Math.round(this.scoring.score),
      distance: Math.round(distance),
      coins,
      cause,
    });
    this.bus.emit('save:write', { coins: this.save.coins, best: this.save.snapshot.best });
  }

  /* ----------------------------------------------------------------- frame */

  private readonly tick = (dt: number): void => {
    if (this.state !== 'driving') {
      // The world still renders behind menus, just frozen.
      this.input.update();
      return;
    }

    this.player.input = this.input.state;
    const distance = this.road.travelled;
    this.managers.update(dt, this.player.speed, distance);
    this.bus.emit('run:tick', { distance: this.road.travelled, speed: this.player.speed });
  };

  private readonly render = (): void => {
    const dt = 1 / 60;
    const frac = this.player.speedFraction;
    // The grade is set by the world manager, which knows about weather and
    // nitro; setting it here too would fight it every other frame.
    this.rig.updateCamera(this.player.x, this.player.y, 0, Math.min(frac, 1), this.player.vx, dt);
    this.rig.render();
  };

  /* ------------------------------------------------------------------ probe */

  /** Run exactly `n` simulation ticks with no clock involved. */
  step(n: number): void {
    this.loop.advance(n);
  }

  /** Drive the car with a fixed input for a number of seconds. */
  drive(seconds: number, steer = 0, brake = false): void {
    this.input.override = { steer, throttle: !brake, brake };
    this.loop.advanceSeconds(seconds);
    this.input.override = null;
  }

  get speedKmh(): number {
    return this.player.speed * SPEED.kmhPerUnit;
  }

  dispose(): void {
    this.loop.stop();
    this.managers.disposeAll();
    this.bus.clear();
    this.rig.dispose();
  }
}

export { THREE };
