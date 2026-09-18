import * as THREE from 'three';
import type { GameContext } from '@/core/Manager';
import type { SceneRig } from '@/game/render/SceneRig';
import { boxBetween, mergeBoxes } from '@/game/render/BoxMerge';
import { CellField, cellHash, type CellPlacement } from '@/game/world/CellField';
import { SEA_HEIGHT, SHORELINE_LATERAL, type RoadManager } from './RoadManager';
import type { WorldLookup } from './SceneryManager';

/**
 * The liner standing off the coast.
 *
 * Backlog item 2 asks for "a static 3D cruise ship model in the background",
 * and until now that was `MarinaManager` scaling its yacht hull up by six and
 * calling the result a ship. At the range the marina used to sit — the old
 * shoreline put it past 340 units out, where everything is fog — nobody could
 * have told the difference. With the water brought into frame they are a
 * hundred metres apart and the scaled yacht reads as a white barge, because
 * the thing that says "liner" is not size. It is proportion: a low hull under
 * a long tiered block of cabin decks, with a single funnel set aft. A yacht
 * scaled up has a small superstructure set on a big hull and says the
 * opposite.
 *
 * Its own field rather than a second class inside the marina's, because a
 * `CellField` instances one silhouette. Two silhouettes is two fields, which
 * is also the right split for every other reason: a liner is one per stretch
 * of coast where moorings are a crowd, so the two want different cell sizes,
 * different occupancy and different bands.
 */

/**
 * Lateral band the liners occupy: deep water, well outside the moorings.
 *
 * Far enough out that a 40-unit superstructure reads as a ship on the horizon
 * rather than as a wall across the frame. The first cut of this had them at
 * 170 and the capture showed a white cliff filling the seaward third with no
 * silhouette legible at all — a hull is only a hull when you can see both ends
 * of it.
 */
const NEAR_LATERAL = SHORELINE_LATERAL + 165;
const FAR_LATERAL = SHORELINE_LATERAL + 345;

/**
 * Share of cells carrying a liner.
 *
 * Low, and the cell is deliberately long. The reference has exactly one ship
 * in frame and that is what makes it read as an event on the water; a line of
 * them along the coast would read as a car park. One cell in two at 340 units
 * is roughly one liner every 700 units of coast.
 */
const OCCUPANCY = 0.5;

/** Hull length, beam and full height, waterline to masthead, in world units. */
const LENGTH = [110, 165] as const;
const BEAM = [16, 23] as const;
const HEIGHT = [22, 31] as const;

export class CruiseShipManager extends CellField {
  readonly name = 'cruise';

  constructor(ctx: GameContext, road: RoadManager, rig: SceneRig,
    private readonly world: WorldLookup) {
    super(ctx, road, rig, {
      /*
       * The coarsest grid in the game. A liner is longer than a city block and
       * rarer than one, so a cell has to be long enough that two of them
       * cannot end up overlapping bow to stern.
       */
      cell: 300,
      behind: 200,
      /*
       * Well short of the road's own reach. The sea is carried by the road
       * segments — twenty-six of them at twenty-five units — so the water ends
       * around 575 ahead and there is nothing out there but haze. The first
       * cut of this reached 700 and the capture caught exactly that: a liner
       * riding *above* the horizon, because the horizon was the far edge of
       * the water and the ship was past it. Inside the ring, every liner the
       * field draws has sea under it.
       */
      ahead: 340,
      minimumPool: 3,
    });
  }

  /**
   * One liner, authored bow-to-stern along +Z in a unit cell.
   *
   * The proportions are the whole model. Hull takes the bottom 30% of the
   * height and the superstructure the rest, where a working vessel would be
   * the other way round; the cabin decks run nearly the full length and step
   * inwards and upwards in three tiers; the funnel sits aft of amidships. Read
   * as a silhouette at two hundred units — which is the only way this is ever
   * read — that set of relationships is a cruise ship and very little else.
   *
   * Everything sits above y=0, the waterline. There is no sea floor here and a
   * hull that dipped below would show through the water surface.
   */
  protected buildGeometry(): THREE.BufferGeometry {
    const parts = [
      // Hull: full beam amidships, drawn in through two steps to the bow.
      boxBetween(-0.5, 0.5, 0, 0.30, -0.5, 0.20),
      boxBetween(-0.38, 0.38, 0.04, 0.30, 0.20, 0.38),
      boxBetween(-0.20, 0.20, 0.10, 0.30, 0.38, 0.5),
      // Cabin decks, three tiers stepping in and up. The long one is the tell.
      boxBetween(-0.46, 0.46, 0.30, 0.52, -0.46, 0.30),
      boxBetween(-0.42, 0.42, 0.52, 0.70, -0.42, 0.22),
      boxBetween(-0.36, 0.36, 0.70, 0.84, -0.34, 0.10),
      // Bridge, set forward over the bow as it is on every passenger ship.
      boxBetween(-0.30, 0.30, 0.84, 0.93, 0.00, 0.17),
      // Funnel, aft of amidships and the tallest thing aboard.
      boxBetween(-0.13, 0.13, 0.84, 1.0, -0.30, -0.13),
      // Foremast, thin enough to be a line rather than a shape.
      boxBetween(-0.03, 0.03, 0.93, 1.0, 0.09, 0.15),
    ];

    /*
     * Dark hull, white decks — baked in, because this is the difference
     * between a ship and a smudge.
     *
     * A liner rendered in one colour is a white shape against a white haze,
     * and at the range where its proportions are right the haze has taken 80%
     * of it. The reference's ship is legible at a far smaller size for exactly
     * one reason: its hull is dark and its superstructure is not, so the haze
     * washes the two towards each other and a horizontal division survives.
     * That division is the asset. The funnel takes the hull's colour for the
     * same reason it does on a real ship's livery — it is the second mark that
     * says which end is the stern.
     */
    const HULL = new THREE.Color(0x24313f);
    const DECK = new THREE.Color(0xf4f6f8);
    const colours = [
      HULL, HULL, HULL,
      DECK, DECK, DECK,
      DECK,
      HULL,
      DECK,
    ];

    const merged = mergeBoxes(parts, colours);
    for (const p of parts) p.dispose();
    return merged;
  }

  /**
   * Two-tone, taken from the geometry's baked vertex colours.
   *
   * The superstructure is still among the brightest geometry in the scene,
   * which is the bet the marina makes and makes for the same reason: the blown
   * highlights the reference holds need geometry that is bright and *small*.
   * What the hull adds is the dark half of the pair, without which the bright
   * half has nothing to be bright against. Glossier than the moorings, because
   * a liner's hull is painted and kept.
   */
  protected buildMaterial(): THREE.Material {
    return new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.30, metalness: 0.20, envMapIntensity: 1.2,
    });
  }

  protected place(cell: number, world: number, out: CellPlacement): boolean {
    if (this.world.biomeAtDistance(world) !== 'coast') return false;
    if (cellHash(cell, 5.3) > OCCUPANCY) return false;

    const r1 = cellHash(cell, 11.7);
    const r2 = cellHash(cell, 19.1);
    const r3 = cellHash(cell, 29.3);
    const r4 = cellHash(cell, 37.7);

    /* Squared, so most liners sit at the near edge of the deep-water band
     * where they are legible and the occasional one stands right out. */
    out.lateral = NEAR_LATERAL + (FAR_LATERAL - NEAR_LATERAL) * r1 * r1;
    out.along = world + (r2 - 0.5) * 220;
    /* Floating: the sea is flat at a fixed height whatever the ground under
     * the road is doing, so this is measured against the road surface at the
     * ship's own distance rather than as an absolute. */
    out.height = SEA_HEIGHT - 0.6;

    /* Under way rather than moored, so it may lie across the view — but only
     * a little, because a liner seen bow-on is a box and the silhouette this
     * geometry exists for is the broadside one. */
    out.yaw = (r3 - 0.5) * 0.9;

    out.scale.set(
      BEAM[0] + r4 * (BEAM[1] - BEAM[0]),
      HEIGHT[0] + r2 * (HEIGHT[1] - HEIGHT[0]),
      LENGTH[0] + r3 * (LENGTH[1] - LENGTH[0]),
    );

    /* A near-neutral multiplier over the baked livery, so two liners in one
     * run are not clones. Kept close to white: this tints the hull and the
     * decks together, and anything stronger would flatten the contrast between
     * them that the geometry was coloured to create. */
    out.colour.setHSL(0.08 + r1 * 0.5, 0.06, 0.90 + r4 * 0.08);
    return true;
  }
}
