import type * as THREE from 'three';
import type { BodyShell, BodySpec } from './BodyShell';
import type { Surface } from './Surfaces';
import type { VehicleBuilder } from './VehicleBuilder';

/**
 * What a design is handed while it adds its details.
 *
 * The body is already built by the time `details` runs, so a design can ask
 * the shell where its own surfaces are — the tail panel at a given height, the
 * shoulder at a given station — and put lamps, plates and bumpers *on* them
 * rather than at numbers that are only right until the body changes.
 */
export interface DesignContext {
  readonly b: VehicleBuilder;
  readonly shell: BodyShell;
  /** Full detail for the player's car and the garage; cut down for traffic. */
  readonly hero: boolean;
  /** Parked-car detail: the barest wheels and no small parts. */
  readonly far: boolean;
  /** The paint surface the body was built with. */
  readonly paint: Surface;
  /** Atlas plate index for this vehicle's registration. */
  readonly plate: number;
  /** Where the exhaust leaves the car, for the flame effect. */
  readonly exhausts: THREE.Vector3[];
  /** Where the headlamps are, for the night-time spot lights. */
  readonly headlamps: THREE.Vector3[];
  /**
   * Objects that cannot live in the single draw call — the transparent
   * windscreen of an open car. Shared between every copy of the design.
   */
  readonly extras: THREE.Object3D[];
}

export interface VehicleDesign {
  readonly id: string;
  /** Metallic flake rather than solid colour. */
  readonly metallic: boolean;
  /** Twin stripes over the top of the car, in metres from the centreline. */
  readonly stripes?: { readonly inner: number; readonly outer: number };
  body(paint: Surface): BodySpec;
  details(ctx: DesignContext): void;
}
