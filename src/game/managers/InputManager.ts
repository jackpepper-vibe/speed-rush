import type { Manager } from '@/core/Manager';
import { isTyping } from '@/core/dom';
import type { PlayerInput } from './PlayerManager';

/**
 * Keyboard, pointer and touch, reduced to one analog input struct.
 *
 * Held separately from the player so the probe can drive the car by writing to
 * `override` — testing the physics without synthesising key events, which under
 * a headless browser is both slower and less precise than setting the number
 * the physics actually reads.
 */
export class InputManager implements Manager {
  readonly name = 'input';

  private readonly pressed = new Set<string>();
  private pointerSteer: number | null = null;

  /** When set, replaces live input entirely. Used by the probe and by replays. */
  override: PlayerInput | null = null;

  readonly state: PlayerInput = { steer: 0, throttle: true, brake: false };

  constructor(private readonly target: HTMLElement) {}

  init(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('pointerdown', this.onPointer);
    this.target.addEventListener('pointermove', this.onPointer);
    this.target.addEventListener('pointerup', this.onPointerEnd);
    this.target.addEventListener('pointercancel', this.onPointerEnd);
    window.addEventListener('blur', this.onBlur);
  }

  update(): void {
    if (this.override) {
      Object.assign(this.state, this.override);
      return;
    }

    let steer = 0;
    if (this.pressed.has('ArrowLeft') || this.pressed.has('KeyA')) steer -= 1;
    if (this.pressed.has('ArrowRight') || this.pressed.has('KeyD')) steer += 1;
    if (steer === 0 && this.pointerSteer !== null) steer = this.pointerSteer;

    this.state.steer = steer;
    this.state.brake = this.pressed.has('ArrowDown') || this.pressed.has('KeyS') || this.pressed.has('Space');
    this.state.throttle = !this.state.brake;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTyping(e)) return;
    // Arrow keys and space scroll the page otherwise, which fights the camera.
    if (STEERING_KEYS.has(e.code)) e.preventDefault();
    this.pressed.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
  };

  /** Pointer steering is proportional to distance from centre, not binary. */
  private readonly onPointer = (e: PointerEvent): void => {
    if (e.type === 'pointermove' && e.buttons === 0) return;
    const rect = this.target.getBoundingClientRect();
    const t = (e.clientX - rect.left) / rect.width;
    this.pointerSteer = Math.max(-1, Math.min(1, (t - 0.5) * 2.6));
  };

  private readonly onPointerEnd = (): void => {
    this.pointerSteer = null;
  };

  /** Losing focus mid-corner must not leave the car locked into a turn. */
  private readonly onBlur = (): void => {
    this.pressed.clear();
    this.pointerSteer = null;
  };

  reset(): void {
    this.pressed.clear();
    this.pointerSteer = null;
    this.state.steer = 0;
    this.state.brake = false;
    this.state.throttle = true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('pointerdown', this.onPointer);
    this.target.removeEventListener('pointermove', this.onPointer);
    this.target.removeEventListener('pointerup', this.onPointerEnd);
    this.target.removeEventListener('pointercancel', this.onPointerEnd);
    window.removeEventListener('blur', this.onBlur);
  }
}

const STEERING_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyS',
]);
