import * as THREE from 'three';
import type { GameContext } from '@/core/Manager';
import type { SceneRig } from '@/game/render/SceneRig';
import { parkedCarMaterial, trafficGeometry } from '@/game/render/vehicles/VehicleFactory';
import { CellField, cellHash, type CellPlacement } from '@/game/world/CellField';
import { groundReliefAt } from '@/game/world/RoadGeometry';
import type { RoadManager } from './RoadManager';
import type { WorldLookup } from './SceneryManager';

/**
 * Cars parked along the kerb.
 *
 * The single most prominent thing in the reference that this world did not
 * have. Its whole landward side is a service road lined with parked vehicles,
 * nose-in behind the railing, running the full length of the frame — and
 * because they are near, they are *large*, which no amount of skyline or
 * harbour can substitute for. Iteration 38 noticed the row while justifying
 * verge traffic and put slow vehicles on the road's shoulder; that is a
 * different thing. These are off the road entirely and never move.
 *
 * Deliberately the nearest `CellField` yet. The skyline (34) sits at 225 to
 * 400, the district (43) at 58 to 196; this occupies 24 to 46, the last empty
 * band, between the roadside props and the town. Each field is one draw call,
 * so the whole landward side is now four ranks for four draws.
 *
 * Nothing here is traffic. It shares no pool, no collision box and no update
 * path with `TrafficManager` — a parked car is scenery that happens to be
 * car-shaped, and modelling it as stationary traffic would put it in the
 * collision broadphase and the near-miss counter for no reason.
 */

/** Lateral band, landward: past the roadside props, short of the town. */
const NEAR_LATERAL = 24;
const FAR_LATERAL = 46;

/**
 * Paint of a parked row: mostly the whites, silvers, greys and blacks real
 * cars are, with the reds and blues the reference's car park has against the
 * stucco behind it.
 */
const PARKED = [
  0xeeeeea, 0xd9dde2, 0x9aa2ac, 0x2a2e36, 0x15171b, 0xb4202a, 0x1f4a8c, 0xe8e6de, 0x5a6068, 0x7a1c24,
] as const;

export class KerbsideManager extends CellField {
  readonly name = 'kerbside';

  constructor(ctx: GameContext, road: RoadManager, rig: SceneRig,
    private readonly world: WorldLookup) {
    super(ctx, road, rig, {
      /*
       * The tightest cell of any field, because these are the smallest objects
       * in one and a parked row is continuous. At 9 units against bodies four
       * to six long, a full run leaves a believable gap between bumpers and a
       * cell that declines leaves a space where a car has driven off.
       */
      cell: 9,
      behind: 70,
      ahead: 300,
      minimumPool: 14,
    });
  }

  /**
   * A parked car, as little as will read as one.
   *
   * Three boxes: body, cabin, and a dark band for the glass. At this range that
   * is all that survives — the traffic models have a lofted shell and it would
   * be wasted here, where what identifies a car is its proportion and the dark
   * line of its windows, not its surface.
   *
   * Authored nose-along-Z in a unit cell so the instance matrix carries length,
   * width and height independently.
   */
  /**
   * Real cars, not boxes: the traffic saloon, instanced, so the whole car
   * park is one draw call and still has glass, lamps, plates and wheels.
   */
  protected buildGeometry(): THREE.BufferGeometry {
    // The factory owns this geometry; the field must not dispose it.
    return trafficGeometry('sedan').clone();
  }

  protected buildMaterial(): THREE.Material {
    return parkedCarMaterial();
  }

  protected override get castsShadow(): boolean {
    return this.rig.quality.shadows;
  }

  protected place(cell: number, world: number, out: CellPlacement): boolean {
    const biome = this.world.biomeAtDistance(world);
    if (biome !== 'coast' && biome !== 'city') return false;

    const r1 = cellHash(cell, 4.7);
    const r2 = cellHash(cell, 9.1);
    const r3 = cellHash(cell, 17.3);
    const r4 = cellHash(cell, 25.1);
    const r5 = cellHash(cell, 33.7);

    /* Runs and gaps rather than an even line. A kerb that is parked solid for
     * miles is a wall; one with the occasional space reads as a place people
     * come and go from. */
    if (r1 > 0.82) return false;

    /* Two ranks, not a scatter: a near row against the kerb and a second row
     * behind it, which is what a service road with parking on both sides looks
     * like. Squaring would spread them; the point here is that they line up. */
    const secondRow = r2 > 0.62;
    out.lateral = -(secondRow ? FAR_LATERAL - 4 + r3 * 6 : NEAR_LATERAL + r3 * 5);
    out.along = world + (r4 - 0.5) * 2.2;

    out.height = groundReliefAt(out.lateral, out.along);
    /* Nose-in to the kerb, so the row is seen end-on from the road — which is
     * both what a parked row looks like and the cheapest silhouette to read.
     * A few degrees of scatter, because nobody parks straight. */
    out.yaw = Math.PI / 2 + (r5 - 0.5) * 0.16;
    // Built at real size; a few percent either way so the row is not a clone.
    const size = 0.95 + r3 * 0.1;
    out.scale.set(size, size, size);
    // The paint, as a real car park is: mostly white, silver, grey and black.
    out.colour.setHex(PARKED[Math.floor(r4 * PARKED.length) % PARKED.length]);
    return true;
  }
}
