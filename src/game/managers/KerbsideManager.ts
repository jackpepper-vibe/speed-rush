import * as THREE from 'three';
import type { GameContext } from '@/core/Manager';
import type { SceneRig } from '@/game/render/SceneRig';
import { boxBetween, mergeBoxes } from '@/game/render/BoxMerge';
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

/** Hull length and width ranges, in world units. */
const LENGTH = [4.0, 6.4] as const;
const WIDTH = [1.9, 2.4] as const;
const HEIGHT = [1.5, 2.6] as const;

/** Sunk, so relief across a short footprint cannot float one. */
const SINK = 0.5;

/**
 * Body colours of a parked row.
 *
 * Saturated and various on purpose, where the district's are muted. A car park
 * is the one place in a landscape where strong colour is *correct*, and the
 * reference's row is exactly that — reds and whites and blues against the
 * stucco behind it. It is also the reason this rank is worth the draw call at
 * all: sand and stucco are both pale warm neutrals, so the kerb was the only
 * band in frame with nothing to break them up.
 */
const BODY_HUES = [0.00, 0.03, 0.09, 0.55, 0.60, 0.33, 0.0] as const;

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
  protected buildGeometry(): THREE.BufferGeometry {
    const parts = [
      // Body, full length, sitting just above the ground.
      boxBetween(-0.5, 0.5, 0.10, 0.52, -0.5, 0.5),
      // Cabin, set back and narrower.
      boxBetween(-0.42, 0.42, 0.52, 0.86, -0.26, 0.30),
      // Glass: a band around the cabin, proud of it, which is what reads.
      boxBetween(-0.44, 0.44, 0.60, 0.80, -0.24, 0.28),
    ];
    const merged = mergeBoxes(parts);
    for (const p of parts) p.dispose();
    return merged;
  }

  /**
   * One material for the whole row, tinted per instance.
   *
   * A little metalness and a low roughness so the row catches the sun as a line
   * of highlights rather than a line of matte lumps — that glint is most of
   * what says "cars" when each of them is thirty pixels wide. Not a clearcoat:
   * these are further off than the hero and there are many more of them.
   */
  protected buildMaterial(): THREE.Material {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.34, metalness: 0.42, envMapIntensity: 1.5,
    });
  }

  /** Near enough to be well inside the sun's frustum, so they cast. */
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

    const length = LENGTH[0] + r5 * (LENGTH[1] - LENGTH[0]);
    const width = WIDTH[0] + r3 * (WIDTH[1] - WIDTH[0]);
    const height = HEIGHT[0] + r4 * (HEIGHT[1] - HEIGHT[0]);

    out.height = groundReliefAt(out.lateral, out.along) - SINK;
    /* Nose-in to the kerb, so the row is seen end-on from the road — which is
     * both what a parked row looks like and the cheapest silhouette to read.
     * A few degrees of scatter, because nobody parks straight. */
    out.yaw = Math.PI / 2 + (r5 - 0.5) * 0.16;
    out.scale.set(width, height, length);

    const hue = BODY_HUES[Math.floor(r4 * BODY_HUES.length) % BODY_HUES.length];
    // A quarter of them are white or silver, as a real car park is.
    const pale = r5 > 0.74;
    out.colour.setHSL(hue, pale ? 0.03 : 0.52 + r3 * 0.3, pale ? 0.78 : 0.34 + r2 * 0.22);
    return true;
  }
}
