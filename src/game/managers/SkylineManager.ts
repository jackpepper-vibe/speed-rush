import * as THREE from 'three';
import type { GameContext } from '@/core/Manager';
import type { SceneRig } from '@/game/render/SceneRig';
import { boxBetween, mergeBoxes } from '@/game/render/BoxMerge';
import { CellField, cellHash, type CellPlacement } from '@/game/world/CellField';
import { groundReliefAt } from '@/game/world/RoadGeometry';
import type { RoadManager } from './RoadManager';
import type { WorldLookup } from './SceneryManager';

/**
 * The city behind the boulevard.
 *
 * The reference is an urban seaside road: sea and a cruise ship out to one
 * side, a dense block of towers massing in the mid-distance on the other. The
 * sea arrived at iteration 33 and the landward side was empty sand to the
 * horizon, which is why the frame read as a highway through a beach rather
 * than as a city waterfront.
 *
 * A `CellField` rather than a `SceneryManager` prop kind, for two reasons. A
 * skyline stands hundreds of units out and has to be placed against the far
 * ground's relief rather than the flat verge every prop kind assumes; and it
 * must not re-roll on a band crossing, which is what `CellField` exists to
 * guarantee.
 */

/** Lateral band the city occupies, landward of the road. */
const NEAR_LATERAL = 225;
const FAR_LATERAL = 400;

/** Footprint and height ranges, in world units. */
const WIDTH = [16, 38] as const;
const HEIGHT = [24, 74] as const;

/**
 * Sunk a little, so relief the buildings are not modelled against cannot leave
 * one standing on air. The far ground swings about fifteen units and is sampled
 * per building, so this only has to cover the slope across a single footprint.
 */
const SINK = 4;

export class SkylineManager extends CellField {
  readonly name = 'skyline';

  constructor(ctx: GameContext, road: RoadManager, rig: SceneRig,
    private readonly world: WorldLookup) {
    super(ctx, road, rig, {
      cell: 46,
      /*
       * Reaches further behind than the props' 90 and further ahead than the
       * road's 420. A tower seventy units tall at three hundred out is still
       * well inside the frame when its own stretch of road is behind the car,
       * where a bush at the same distance left the screen long ago. And the fog
       * swallows the far end long before 700 — which is the point: a skyline
       * whose last block ends at a visible line is a model of a city, one that
       * fades into the haze is a city.
       */
      behind: 200,
      ahead: 700,
      minimumPool: 8,
    });
  }

  /**
   * One tower, as a silhouette that survives non-uniform scaling.
   *
   * A unit box scaled to width and height is a slab, and a row of slabs is a
   * wall. The setback and the mast are what make the roofline read as a city
   * from far enough away that no facade detail survives — which, behind this
   * much haze, is all of them.
   */
  protected buildGeometry(): THREE.BufferGeometry {
    /*
     * A tower with floors, not a slab with a stick on top.
     *
     * Three boxes in one flat colour is what this was, and at the size it
     * occupies on the horizon that reads as a cardboard cut-out — there is no
     * information in it at all beyond its outline. What makes a distant
     * building read as a building is *horizontal banding*: floor after floor
     * of glazing catching the light differently from the spandrels between
     * them. It is the only detail that survives being ten pixels wide.
     *
     * Built as alternating bands rather than painted on, because a `CellField`
     * instances one geometry under one material and per-instance colour — a
     * texture would need its UVs scaled per instance to avoid stretching up a
     * tower twice as tall as its neighbour. Geometry has no such problem, and
     * the recess on the glazing gives it a real shadow line instead of a
     * drawn one.
     */
    const WALL = new THREE.Color(0xffffff);
    const GLASS = new THREE.Color(0x8a94a2);
    const parts: THREE.BufferGeometry[] = [];
    const colours: THREE.Color[] = [];
    const add = (g: THREE.BufferGeometry, c: THREE.Color): void => {
      parts.push(g);
      colours.push(c);
    };

    /* Five, not seven. The edge-density gate came back at 1.78x the
     * reference against a 1.7 ceiling, and for once the number agreed with the
     * eye: seven bands of strong contrast on every tower is more horizontal
     * detail than the reference carries, and it reads as a zebra rather than
     * as floors. Fewer bands at gentler contrast says the same thing quietly. */
    const FLOORS = 5;
    for (let i = 0; i < FLOORS; i++) {
      const y0 = i / FLOORS;
      const y1 = (i + 1) / FLOORS;
      const split = y0 + (y1 - y0) * 0.5;
      /* Coplanar with the wall, differing only in colour.
       *
       * The first cut inset the glazing by 0.03 to get a real shadow line, and
       * that was wrong for a reason specific to instancing: the unit cell is
       * scaled per instance, so a 3% inset on a tower forty units wide becomes
       * a ledge more than a metre deep. Seven floors of that is a wedding
       * cake, which is what the capture showed. Flush bands cost no silhouette
       * and read as floors from the only distance this rank is ever seen at.
       */
      add(boxBetween(-0.5, 0.5, y0, split, -0.5, 0.5), WALL);
      add(boxBetween(-0.5, 0.5, split, y1, -0.5, 0.5), GLASS);
    }

    // Setback and crown. A tower that goes straight up and stops is a chimney;
    // the step is most of what gives a skyline its sawtooth.
    add(boxBetween(-0.34, 0.34, 1, 1.06, -0.34, 0.34), WALL);
    add(boxBetween(-0.34, 0.34, 1.06, 1.19, -0.34, 0.34), GLASS);
    add(boxBetween(-0.37, 0.37, 1.19, 1.24, -0.37, 0.37), WALL);
    // Mast.
    add(boxBetween(-0.04, 0.04, 1.24, 1.44, -0.04, 0.04), WALL);

    const merged = mergeBoxes(parts, colours);
    for (const p of parts) p.dispose();
    return merged;
  }

  /**
   * Pale and chalky, because that is what distance does to a building.
   *
   * The tint per instance comes through `instanceColor`, which multiplies this
   * one — so the material stays a single draw call while no two towers are
   * quite the same concrete. Rough and barely metallic: a mirror out there
   * would catch the sun and put a bright rectangle on the horizon, which is
   * exactly the kind of small bright thing bloom turns into a smear.
   */
  protected buildMaterial(): THREE.Material {
    return new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.88, metalness: 0.05, envMapIntensity: 0.7,
    });
  }

  protected place(cell: number, world: number, out: CellPlacement): boolean {
    /* The biome of the ground this building stands on, not of the ground under
     * the car — the same rule the props follow. A skyline switched on when the
     * car crosses into the coast would arrive as a city appearing out of
     * nothing beside the player; keyed per cell, it comes over the horizon and
     * the boundary passes through it. */
    const biome = this.world.biomeAtDistance(world);
    if (biome !== 'coast' && biome !== 'city') return false;

    const r1 = cellHash(cell, 1.7);
    const r2 = cellHash(cell, 5.3);
    const r3 = cellHash(cell, 11.9);
    const r4 = cellHash(cell, 19.1);
    const r5 = cellHash(cell, 27.7);

    /* Depth is squared so the band crowds towards its near edge: a real
     * skyline is a front rank with the rest stacked behind it, not an even
     * scatter across a strip. It also stops the far towers, which the fog has
     * all but erased anyway, from being most of the budget. */
    out.lateral = -(NEAR_LATERAL + (FAR_LATERAL - NEAR_LATERAL) * r1 * r1);
    /* Jittered along the road by most of a cell, so the grid that keeps this
     * from re-rolling does not also make it a colonnade. */
    out.along = world + (r2 - 0.5) * 40;

    const width = WIDTH[0] + r3 * (WIDTH[1] - WIDTH[0]);
    /* Tall at the front, low behind — the front rank is what the eye reads as
     * the city's height, and towers hiding behind towers is wasted budget. */
    const height = HEIGHT[0]
      + (HEIGHT[1] - HEIGHT[0]) * (0.35 + 0.65 * (1 - r1)) * (0.55 + 0.45 * r4);

    out.height = groundReliefAt(out.lateral, out.along) - SINK;
    out.yaw = (r5 - 0.5) * 0.5;
    out.scale.set(width, height, width * (0.7 + 0.6 * r4));
    /* Concrete, brick and glass, all of it half-lost in haze. A narrow spread
     * on purpose: wide enough that the massing has faces, narrow enough that it
     * still reads as one city rather than as a paint chart. */
    out.colour.setHSL(0.07 + r3 * 0.06, 0.06 + r4 * 0.10, 0.52 + r5 * 0.18);
    return true;
  }
}
