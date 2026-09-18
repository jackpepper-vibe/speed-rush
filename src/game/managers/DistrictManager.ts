import * as THREE from 'three';
import type { GameContext } from '@/core/Manager';
import type { SceneRig } from '@/game/render/SceneRig';
import { boxBetween, mergeBoxes } from '@/game/render/BoxMerge';
import { CellField, cellHash, type CellPlacement } from '@/game/world/CellField';
import { groundReliefAt } from '@/game/world/RoadGeometry';
import type { RoadManager } from './RoadManager';
import type { WorldLookup } from './SceneryManager';

/**
 * The low town between the road and the skyline.
 *
 * Iteration 34 put towers out at 225 to 400 and iteration 33 put water on the
 * other side, which left a band of empty sand from the last palm at about 45 to
 * the first tower at 225 — a third of the frame's width on the landward side
 * with nothing in it. The reference has no such gap: its waterfront runs
 * unbroken from the kerb back into the city, low buildings and parked rows and
 * a marina shed, and the towers stand *behind* all of it.
 *
 * A gap like that is not a missing prop, it is a missing **rank**. Distance in
 * a frame reads from overlap: the towers only look far away because something
 * nearer partly hides them, and with clear sand between, they read as a
 * painted backdrop instead. This is the rank that makes the skyline a
 * distance rather than a wallpaper.
 *
 * Built on `CellField` for the same two reasons the skyline is: it stands well
 * off the verge and has to sit on the far ground's relief, and it must not
 * re-roll on a band crossing.
 */

/** Lateral band, landward. Starts past the props and ends before the towers. */
const NEAR_LATERAL = 58;
const FAR_LATERAL = 196;

/** Footprint and height ranges, in world units. */
const WIDTH = [14, 34] as const;
const HEIGHT = [7, 26] as const;

/**
 * Sunk enough to cover the relief across one footprint.
 *
 * Deeper than the skyline's, not shallower, despite standing on gentler ground:
 * these are low buildings, so the same slope eats a much larger fraction of
 * their height, and a low block floating a metre up is far more obvious than a
 * tower doing the same.
 */
const SINK = 5;

export class DistrictManager extends CellField {
  readonly name = 'district';

  constructor(ctx: GameContext, road: RoadManager, rig: SceneRig,
    private readonly world: WorldLookup) {
    super(ctx, road, rig, {
      /*
       * Tighter than the skyline's 46: a low town is denser than a financial
       * district, and at this range the cells are close enough to the camera
       * that gaps between them read as gaps rather than as depth.
       */
      cell: 34,
      behind: 140,
      ahead: 520,
      minimumPool: 10,
    });
  }

  /**
   * A low block with a parapet and a stair head.
   *
   * The parapet is the whole trick at this distance. A flat-topped box meets
   * the sky along one hard line and reads as a shipping container; a lip
   * standing slightly proud of the wall gives the roofline a second edge and a
   * band of shadow under it, which is what the eye takes as "building". The
   * stair head breaks the symmetry so a row of them is not a row of clones.
   */
  protected buildGeometry(): THREE.BufferGeometry {
    const parts = [
      boxBetween(-0.5, 0.5, 0, 1, -0.5, 0.5),
      // Parapet: proud of the wall on every side, shallow.
      boxBetween(-0.53, 0.53, 1, 1.06, -0.53, 0.53),
      // Stair head, set back and off-centre.
      boxBetween(-0.22, 0.10, 1.06, 1.24, -0.18, 0.14),
    ];
    const merged = mergeBoxes(parts);
    for (const p of parts) p.dispose();
    return merged;
  }

  /**
   * Rendered, stucco and sun-bleached rather than the skyline's cool concrete.
   *
   * These are close enough that the fog barely touches them, so unlike the
   * towers they are seen more or less in their own colour and it has to be a
   * colour a seaside town is actually painted. Rough and non-metallic: a
   * specular anywhere in this rank would draw the eye off the road.
   */
  protected buildMaterial(): THREE.Material {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.94, metalness: 0.02, envMapIntensity: 0.55,
    });
  }

  /**
   * Casts, where the skyline does not.
   *
   * At 58 to 196 out the nearest of these are inside the sun's +/-90 shadow
   * frustum, so they can put something on the ground the way the palms do. The
   * towers could not and asking would only have coarsened every other shadow.
   */
  protected override get castsShadow(): boolean {
    return this.rig.quality.shadows;
  }

  protected place(cell: number, world: number, out: CellPlacement): boolean {
    const biome = this.world.biomeAtDistance(world);
    if (biome !== 'coast' && biome !== 'city') return false;

    const r1 = cellHash(cell, 2.3);
    const r2 = cellHash(cell, 6.1);
    const r3 = cellHash(cell, 14.7);
    const r4 = cellHash(cell, 21.9);
    const r5 = cellHash(cell, 29.3);

    /* Gaps, unlike the skyline, which is solid. A town has streets in it, and
     * the ones nearest the road are what the towers behind show through. */
    if (r1 > 0.74) return false;

    /* Squared towards the near edge, so the rank crowds the roadside and thins
     * out behind — the same shape as the skyline's and for the same reason. */
    out.lateral = -(NEAR_LATERAL + (FAR_LATERAL - NEAR_LATERAL) * r2 * r2);
    out.along = world + (r3 - 0.5) * 26;

    const width = WIDTH[0] + r4 * (WIDTH[1] - WIDTH[0]);
    /* Low at the front and taller behind — the opposite of the skyline's rule,
     * and deliberately so: this rank has to step *up* into the towers rather
     * than competing with them, or the city has no depth to it. */
    const height = HEIGHT[0] + (HEIGHT[1] - HEIGHT[0]) * (0.25 + 0.75 * r2) * (0.6 + 0.4 * r5);

    out.height = groundReliefAt(out.lateral, out.along) - SINK;
    /* Squared to the road rather than scattered: buildings face a street. A
     * random yaw here reads as rubble, which is the same mistake iteration 13
     * fixed for the railings. */
    out.yaw = (r5 - 0.5) * 0.18;
    out.scale.set(width, height, width * (0.8 + 0.7 * r3));
    /* Whitewash, ochre and terracotta, kept light: this rank sits in front of
     * the towers and has to read as nearer, which at equal value it would not. */
    out.colour.setHSL(0.06 + r4 * 0.05, 0.10 + r5 * 0.22, 0.62 + r3 * 0.20);
    return true;
  }
}
