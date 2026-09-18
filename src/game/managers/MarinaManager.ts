import * as THREE from 'three';
import type { GameContext } from '@/core/Manager';
import type { SceneRig } from '@/game/render/SceneRig';
import { boxBetween, mergeBoxes } from '@/game/render/BoxMerge';
import { CellField, cellHash, type CellPlacement } from '@/game/world/CellField';
import { SEA_HEIGHT, SHORELINE_LATERAL, type RoadManager } from './RoadManager';
import type { WorldLookup } from './SceneryManager';

/**
 * What is on the water.
 *
 * Iteration 33 put a sea beside the road and iteration 34 put a city behind it;
 * between them the seaward half of the frame was an empty turquoise band where
 * the reference has a marina of white hulls inshore and a ship standing out in
 * the haze. Empty water is the one part of a coast that reads as unfinished
 * however well it is lit, because water is scale-less — there is nothing in it
 * to say whether the horizon is a mile away or ten.
 *
 * There is a second reason this is worth the budget, and it is the oldest open
 * item in the loop. Queue item 5 — nothing in frame reaching luminance 224 —
 * was closed at iteration 27 as unreachable *through the sky*, with the
 * conclusion stated in advance: the blown highlights the reference holds need
 * geometry that is **bright and small**, and the two it uses are sun on water
 * and sun on white superstructure. This is that geometry. Whether it actually
 * lands in the top bins is a measurement, not a promise.
 */

/** Lateral band the moored inshore craft occupy. */
const INSHORE = [SHORELINE_LATERAL + 22, SHORELINE_LATERAL + 120] as const;
/** Lateral band the deep-water ships occupy. */
const OFFSHORE = [SHORELINE_LATERAL + 190, SHORELINE_LATERAL + 640] as const;

/**
 * Share of cells that carry a ship rather than a yacht, and the share that
 * carry nothing at all.
 *
 * A boat in every cell is a traffic jam; the reference has a busy inshore strip
 * and one large vessel standing well out. Sparseness is a property of the cell,
 * not of the pool, so the gaps are in the same place every time that stretch of
 * coast is driven.
 */
const OCCUPANCY = 0.62;
const SHIP_SHARE = 0.24;

/** Hull length, beam and freeboard for each class, in world units. */
const YACHT = { length: [18, 44] as const, beam: [5, 11] as const, height: [5, 11] as const };
const SHIP = { length: [120, 230] as const, beam: [18, 30] as const, height: [26, 46] as const };

export class MarinaManager extends CellField {
  readonly name = 'marina';

  constructor(ctx: GameContext, road: RoadManager, rig: SceneRig,
    private readonly world: WorldLookup) {
    super(ctx, road, rig, {
      /*
       * A coarser grid than the skyline's. Boats are further apart than
       * buildings and a large vessel is longer than a city block, so a fine
       * cell would either overlap hulls or spend the whole pool inshore.
       */
      cell: 78,
      behind: 240,
      ahead: 900,
      minimumPool: 6,
    });
  }

  /**
   * One vessel, authored bow-to-stern along +Z in a unit cell.
   *
   * Length along Z so that a yaw of zero lies parallel to the road, which is
   * how a moored boat sits and how a ship under way off a coastal city reads.
   * The hull tapers in two steps rather than one — a plain box on water is a
   * barge, and the thing that says "boat" at this distance is a waterline that
   * narrows towards the bow while the deck above it does not.
   *
   * Everything sits above y=0, which is the waterline: there is no sea floor
   * here and a hull that dipped below would show through the water surface
   * from a camera this low.
   */
  protected buildGeometry(): THREE.BufferGeometry {
    const parts = [
      // Hull, amidships to stern: full beam.
      boxBetween(-0.5, 0.5, 0, 0.34, -0.5, 0.12),
      // Hull, forward: drawn in towards the bow.
      boxBetween(-0.34, 0.34, 0.02, 0.34, 0.12, 0.40),
      boxBetween(-0.15, 0.15, 0.06, 0.32, 0.40, 0.5),
      // Superstructure. Set aft, as it is on almost everything that floats.
      boxBetween(-0.36, 0.36, 0.34, 0.68, -0.34, 0.08),
      boxBetween(-0.26, 0.26, 0.68, 0.86, -0.24, -0.02),
      // Funnel or mast, depending entirely on how tall the instance is scaled.
      boxBetween(-0.09, 0.09, 0.86, 1.0, -0.20, -0.06),
    ];
    const merged = mergeBoxes(parts);
    for (const p of parts) p.dispose();
    return merged;
  }

  /**
   * White, and the only thing in this scene deliberately allowed near the top
   * of the histogram.
   *
   * Low roughness with a real metalness so the sun finds the superstructure as
   * a hard specular rather than a soft wash. The risk is understood — iteration
   * 19 established that bloom is only ever as bad as what you feed it — and the
   * bet is that a hull twenty units long at three hundred out is exactly the
   * *small* bright thing the sky could never be.
   */
  protected buildMaterial(): THREE.Material {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.32, metalness: 0.22, envMapIntensity: 1.1,
    });
  }

  protected place(cell: number, world: number, out: CellPlacement): boolean {
    if (this.world.biomeAtDistance(world) !== 'coast') return false;

    const r1 = cellHash(cell, 3.1);
    if (r1 > OCCUPANCY) return false;

    const r2 = cellHash(cell, 7.9);
    const r3 = cellHash(cell, 13.3);
    const r4 = cellHash(cell, 23.5);
    const r5 = cellHash(cell, 31.3);

    const ship = cellHash(cell, 41.9) < SHIP_SHARE;
    const band = ship ? OFFSHORE : INSHORE;
    const klass = ship ? SHIP : YACHT;

    /* Squared, so inshore craft crowd the near edge of their band the way
     * moorings crowd a harbour wall, and the deep-water ships spread out. */
    out.lateral = band[0] + (band[1] - band[0]) * r2 * r2;
    out.along = world + (r3 - 0.5) * 56;
    /* Floating, not standing: the sea is flat at a fixed height, so a vessel's
     * waterline is that height regardless of what the ground is doing. The road
     * rises and falls under the camera, which is why this is relative to the
     * road surface at its own distance rather than an absolute. */
    out.height = SEA_HEIGHT - hullAt(world, out.lateral);

    /* Moored roughly parallel to the shore, with enough spread that the line of
     * them is not a rank. A ship well out is under way and may lie across. */
    out.yaw = ship ? (r4 - 0.5) * 1.5 : (r4 - 0.5) * 0.55;

    const length = klass.length[0] + r5 * (klass.length[1] - klass.length[0]);
    const beam = klass.beam[0] + r4 * (klass.beam[1] - klass.beam[0]);
    const height = klass.height[0] + r3 * (klass.height[1] - klass.height[0]);
    out.scale.set(beam, height, length);

    /* Mostly white, with the occasional dark hull — a harbour of pure white is
     * a showroom. Kept high in value either way: what this field is for is the
     * bright end of the histogram. */
    const dark = r2 < 0.18 && !ship;
    out.colour.setHSL(0.55 + r5 * 0.08, dark ? 0.20 : 0.05, dark ? 0.34 : 0.86 + r3 * 0.12);
    return true;
  }
}

/**
 * How far the hull sits proud of the water at this point.
 *
 * The sea is a flat plane and the vessels are not modelled with a draught, so
 * without this every hull sits with its keel exactly on the surface and reads
 * as a paper cut-out laid on top of it. A shallow, slow swell keyed on position
 * settles them into the water by a little and varies it along the coast, which
 * is enough to break the cut-out look at this range.
 *
 * Keyed on world position rather than on time on purpose: a fleet that bobbed
 * would need the field re-filled every frame, and the field is a fill-on-anchor
 * design precisely so that it is not.
 */
function hullAt(world: number, lateral: number): number {
  return 0.5 + Math.sin(world * 0.017 + lateral * 0.031) * 0.22;
}
