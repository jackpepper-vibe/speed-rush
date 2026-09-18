import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import type { BiomeId } from '@/core/GameEvents';
import { ROAD } from '@/game/config/Balance';
import { barrierLimit, curveAt, groundReliefAt, hillAt } from '@/game/world/RoadGeometry';
import { disposePropMaterials, propsForBiome, type PropKind } from '@/game/render/PropFactory';
import { BEACH_DRY_LIMIT, SEA_HEIGHT, type RoadManager } from './RoadManager';
import type { SceneRig } from '@/game/render/SceneRig';
import { WORLD } from '@/game/config/Balance';

/**
 * The one thing the scenery needs from the world: what biome is where.
 *
 * Taken as a narrow interface rather than as the manager itself, so this keeps
 * knowing nothing about weather, the day cycle or tunnels beyond the two cues
 * it already listens to.
 */
export interface WorldLookup {
  biomeAtDistance(distance: number): BiomeId;
}

/**
 * What stands beside the road.
 *
 * The biomes have been changing the light and the fog convincingly for a while
 * with nothing actually out there to light, which reads as driving through a
 * coloured emptiness. Props are instanced — one draw call per kind however many
 * are on screen — and recycled in bands ahead of the car, so a long run costs
 * the same as a short one.
 *
 * Placement goes through the same `curveAt` and `hillAt` the tarmac is built
 * from, which is the only reason a tree planted 400 units ahead is still beside
 * the road by the time you reach it rather than in the middle of it.
 */
interface Band {
  /** Absolute distance this band starts at. */
  start: number;
  biome: BiomeId;
}

interface LiveKind {
  kind: PropKind;
  mesh: THREE.InstancedMesh;
  /** How many instances are currently placed. */
  used: number;
  /**
   * Which biomes this kind belongs to.
   *
   * A kind can be in more than one — scrub grows beside every road — and near
   * a boundary two biomes' kinds are resident at once. An instance is only
   * placed where the road it lands on is a biome this kind is from, which is
   * what makes the change happen at the boundary rather than at the camera.
   */
  biomes: Set<BiomeId>;
}

/** Length of one recycled band of scenery. */
const BAND_LENGTH = 120;

export class SceneryManager implements Manager {
  readonly name = 'scenery';

  private readonly root = new THREE.Group();
  private readonly live = new Map<string, LiveKind>();
  private readonly bands: Band[] = [];
  private biome: BiomeId = 'coast';

  /** Instances placed on the tarmac. Should always be zero; measured, not assumed. */
  private onRoadCount = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scaleVec = new THREE.Vector3();

  /** Biomes whose kinds are currently resident, in view order. */
  private resident: BiomeId[] = [];
  private inTunnel = false;
  /** Whether anything outside this manager wants the scenery drawn. */
  private shown = true;

  constructor(
    private readonly ctx: GameContext,
    private readonly road: RoadManager,
    private readonly rig: SceneRig,
    private readonly world: WorldLookup,
  ) {}

  init(): void {
    this.ctx.scene.add(this.root);
    /*
     * Tunnels are the one thing still driven by a cue rather than by distance.
     *
     * Inside a tunnel there is nothing beside the road by definition, and the
     * tunnel is a feature of where the car is rather than of the route — so
     * unlike the biome it genuinely is a property of the moment.
     */
    this.ctx.bus.on('world:tunnel-enter', () => { this.inTunnel = true; this.applyVisibility(); });
    this.ctx.bus.on('world:tunnel-exit', () => { this.inTunnel = false; this.applyVisibility(); });
    this.resident = [];
    this.repopulate();
  }

  /* ------------------------------------------------------------------ biome */

  /**
   * Bring the prop set into line with the biomes currently in view.
   *
   * Still rebuilt rather than kept permanently resident: a coast has no towers
   * and a city has no cacti, and holding every biome's instanced meshes alive
   * is the wrong trade on a phone. What has changed is when. It used to be
   * driven by the biome-change cue, which fires when the *car* crosses a
   * boundary — so the entire visible world, including the horizon several
   * hundred units ahead, changed species in one frame. That is the pop.
   *
   * Now it is driven by which biomes the visible stretch of road passes
   * through. Approaching a boundary both sets are resident, each instance is
   * placed according to the biome of the ground it lands on, and the change
   * arrives on the horizon and comes to meet you.
   */
  private ensureKinds(biomes: readonly BiomeId[]): void {
    const wanted = biomes.join(',');
    if (wanted === this.resident.join(',')) return;
    this.resident = [...biomes];

    this.clearKinds();
    const density = this.rig.quality.sceneryDensity;

    for (const biome of biomes) {
      for (const kind of propsForBiome(biome)) {
        const existing = this.live.get(kind.id);
        if (existing) {
          // The same kind in two biomes at once — scrub, rocks. One mesh
          // serves both; the duplicate geometry the factory just built for the
          // second biome is released rather than orphaned on the GPU.
          existing.biomes.add(biome);
          kind.geometry.dispose();
          continue;
        }

        // Cadence kinds keep their full count at every tier: see PropKind. The
        // density dial thins detail, and a lamp standard every other lamp is a
        // different road rather than a coarser one.
        const count = Math.max(1, Math.round(kind.count * (kind.cadence ? 1 : density)));
        const mesh = new THREE.InstancedMesh(kind.geometry, kind.material, count);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = this.rig.quality.shadows;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        // Nothing is placed yet; park every instance out of sight rather than
        // letting an unset identity matrix stack them all at the origin.
        for (let i = 0; i < count; i++) {
          mesh.setMatrixAt(i, this.matrix.makeTranslation(0, -9999, 0));
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.root.add(mesh);
        this.live.set(kind.id, { kind, mesh, used: 0, biomes: new Set([biome]) });
      }
    }

    this.bands.length = 0;
  }

  private clearKinds(): void {
    for (const entry of this.live.values()) {
      this.root.remove(entry.mesh);
      entry.mesh.dispose();
      entry.kind.geometry.dispose();
    }
    this.live.clear();
  }

  /* -------------------------------------------------------------- placement */

  update(_dt: number, _speed: number, distance: number): void {
    const wanted = Math.floor(distance / BAND_LENGTH);
    if (this.bands.length > 0 && this.bands[0].start === wanted * BAND_LENGTH) {
      this.reposition();
      return;
    }
    this.repopulate();
  }

  /**
   * Every biome the visible stretch of road passes through, near to far.
   *
   * Sampled across the same span the props are scattered over, so the set is
   * exactly the set that can appear on screen.
   */
  private biomesInView(distance: number): BiomeId[] {
    const span = ROAD.drawDistance * this.rig.quality.drawDistanceScale;
    const out: BiomeId[] = [];
    // Stepped rather than sampled at the two ends: a short biome could sit
    // entirely inside the view with neither end landing in it.
    const step = WORLD.biomeLength / 2;
    for (let ahead = -90; ahead <= span; ahead += step) {
      const biome = this.world.biomeAtDistance(distance + ahead);
      if (!out.includes(biome)) out.push(biome);
    }
    const last = this.world.biomeAtDistance(distance + span);
    if (!out.includes(last)) out.push(last);
    return out;
  }

  /**
   * Scatter every instance across the visible stretch of road.
   *
   * Done wholesale rather than per band: the instance count is a few hundred at
   * most, the scatter is seeded, and rewriting the whole buffer once when the
   * car crosses a band boundary is simpler — and measurably cheaper — than
   * tracking which instance belongs to which band.
   */
  private repopulate(): void {
    const distance = this.road.travelled;
    this.biome = this.world.biomeAtDistance(distance);
    this.ensureKinds(this.biomesInView(distance));

    const base = Math.floor(distance / BAND_LENGTH) * BAND_LENGTH;
    this.bands.length = 0;
    this.bands.push({ start: base, biome: this.biome });

    const span = ROAD.drawDistance * this.rig.quality.drawDistanceScale;
    const behind = 90;
    this.onRoadCount = 0;
    this.maxSeawardEdge = 0;
    this.inSeaCount = 0;

    for (const entry of this.live.values()) {
      const { kind, mesh } = entry;
      let placed = 0;

      /* Cadence kinds are laid, not scattered.
       *
       * Half the instances down each verge on a grid anchored to the world, so
       * a railing meets the next railing and a lamp answers the lamp before it.
       * The scatter below is right for anything that grew where it landed and
       * wrong for anything a council put there: run through it, a railing comes
       * out in clumps with holes between them, which is the one thing a railing
       * must never be.
       *
       * Anchored on `base` rather than on `distance` for the same reason the
       * scatter is seeded on it — the grid has to be a property of the road,
       * not of where the camera happens to be, or the whole run slides every
       * time the band is rebuilt. `PropKind.cadence` is required to divide
       * BAND_LENGTH so that crossing a band lands on the same grid.
       */
      const pitch = kind.cadence ?? 0;
      const perSide = pitch > 0 ? Math.max(1, Math.floor(mesh.count / 2)) : 0;
      const anchor = Math.floor((base - behind) / Math.max(pitch, 1)) * pitch;

      /* Scattered kinds get a world slot each, and that is this iteration.
       *
       * The scatter used to be seeded on `base`, the band origin — so every
       * instance of every kind was re-rolled when the car crossed a band, which
       * at speed is about every two seconds. It was defended as "the same
       * stretch of road is dressed the same way every time it is driven", and
       * that much was true: the *band* was reproducible. What it was not is
       * **stable while you look at it**. A tower three hundred units ahead was
       * rebuilt from a new seed every crossing, so the whole visible set changed
       * species and position at once. That is the operator's "city buildings pop
       * in", and it is not a draw-distance problem at all.
       *
       * The fix is the rule `CellField` was built on at iteration 34: cut the
       * road into slots of `slotPitch`, key the randomness on the **absolute
       * slot index**, and let the pool hold a sliding window of them. Crossing a
       * band then shifts the contents by one slot — one prop leaves at the back,
       * one arrives at the horizon, and every one in view is written back
       * identical. The scatter stays a scatter: the slot only fixes *which*
       * random numbers an instance gets, and the jitter below still spreads it
       * across most of its slot.
       */
      const slotPitch = (span + behind) / Math.max(1, mesh.count);
      const slotBase = Math.floor((base - behind) / slotPitch);

      for (let i = 0; i < mesh.count; i++) {
        /* Keyed on the slot, not the band and not the instance index. Two
         * different kinds must not agree: `kind.id.length` was already doing
         * that job and keeps doing it. */
        const slot = slotBase + i;
        const seed = (slot * 7.77 + kind.id.length * 31.1);
        const r1 = fract(Math.sin(seed) * 43758.5453);
        const r2 = fract(Math.sin(seed * 1.7 + 2.3) * 24634.6345);
        const r3 = fract(Math.sin(seed * 2.9 + 5.1) * 19349.1233);
        const r4 = fract(Math.sin(seed * 3.7 + 9.4) * 31547.9182);

        const laid = pitch > 0;
        // Street furniture stands at one height, so a cadence kind takes the
        // middle of its scale range rather than a sample from it. A run of
        // railing that breathes in and out along its length is a fence.
        const scale = laid
          ? (kind.scale[0] + kind.scale[1]) / 2
          : kind.scale[0] + r4 * (kind.scale[1] - kind.scale[0]);
        /* Measured from `base`, not from `distance`, which is the convention
         * the scatter beside it already follows — `reposition` slides the whole
         * group by `distance - base` between rebuilds, so an `ahead` that has
         * already subtracted `distance` counts it twice.
         *
         * It showed up as a bimodal score: the same code state alternated
         * between exactly 0.641 and 0.645 run to run, because the harness's
         * resize lands a frame either side of a render and `distance` at
         * repopulate time differs by one step's travel. The scatter never saw
         * it, having no `distance` term to perturb. Two discrete values are a
         * race, not noise, and the fix is to stop reading the clock.
         */
        /* A scattered kind now sits in its own slot with a jitter, where it
         * used to take a free draw across the whole span. Same distribution to
         * look at — the jitter covers 90% of a slot, so neighbours still
         * overlap and the spacing still reads as random — and a completely
         * different behaviour over time, because the slot is absolute and the
         * span was relative to the band. */
        const ahead = laid
          ? anchor + (i % perSide) * pitch - base
          : (slot + 0.5 + (r1 - 0.5) * 0.9) * slotPitch - base;
        const side = laid ? (i < perSide ? -1 : 1) : (r2 < 0.5 ? -1 : 1);
        const depth = laid
          ? kind.offset[0]
          : kind.offset[0] + r3 * (kind.offset[1] - kind.offset[0]);

        // Off the back or past the horizon: park it rather than draw it. Both
        // placements are now grid-based and so both can land outside the
        // window; the scatter could not, when its range *was* the window.
        if (ahead < -behind || ahead > span) {
          mesh.setMatrixAt(i, this.matrix.makeTranslation(0, -9999, 0));
          continue;
        }

        // Road-space x, pushed out past the barrier by its own footprint so the
        // prop's base is clear of the tarmac, not merely its origin.
        const x = side * (barrierLimit() + kind.radius * scale + depth);

        /* Relative to the band origin, not to where the car happens to be.
         *
         * `ahead` is measured from `base` — both placements say so — and
         * `reposition` carries the car's progress through the band as a group
         * translation. Reading `travelled` here mixed the two frames and left
         * every biome test and every curve sample up to a band out of step with
         * the position the instance was actually written at. It survived because
         * a repopulate happens *at* a crossing, where the two are within one
         * tick of each other; now that a slot is a fixed piece of road, being
         * approximately right is no longer good enough. */
        const world = base + ahead;

        /* The biome of the ground this instance lands on, not of the ground
         * the car is standing on. A prop from the wrong side of a boundary is
         * parked below the world rather than drawn — which is what makes the
         * transition happen out at the boundary, in view, instead of all at
         * once under the camera. */
        if (!entry.biomes.has(this.world.biomeAtDistance(world))) {
          mesh.setMatrixAt(i, this.matrix.makeTranslation(0, -9999, 0));
          continue;
        }

        /* Against the band origin, for the same reason `world` is. The group
         * translation in `reposition` is exactly `curveAt(base) - curveAt(
         * distance)`, so a buffer written against `base` plus that translation
         * is the prop's true world position at any point in the band — where a
         * buffer written against `distance` is only correct on the frame it was
         * written and drifts for the rest of the band. */
        /* On the ground, not on the road's own plane.
         *
         * This used to be `hillAt` alone, and the comment on `RELIEF_INNER`
         * explained why that was safe: relief began at 96, further out than
         * anything was planted, so the verge under every prop was flat and a
         * prop at road height stood on it. Bringing the beach in to 34 to get
         * the water into frame ends that, and it ends it for the two kinds
         * with the longest reach — scrub at 40 and rock at 59 are now on the
         * slope, where road height is mid-air.
         *
         * Sampling the same function the ground mesh is built from is the
         * only version of this that cannot drift: the far fields have all
         * placed themselves this way since the skyline was built, and the
         * scatter was the last rank still assuming a flat world.
         */
        const relief = groundReliefAt(x, world);

        /* Nothing stands in the sea.
         *
         * Rock reaches 59 and the waterline is around 32, so without this the
         * seaward tail of the scatter wades out into the water — and because
         * the water is drawn over it, it reads as debris floating offshore
         * rather than as a rock that should not have been placed. Parked on
         * the near side of the test rather than pulled inboard, because the
         * waterline bends with the road: a clamp would put a rank of rocks
         * along the tide line, which is a worse artefact than a gap.
         *
         * Tested at the prop's **outboard edge**, not its origin. Testing the
         * origin is the version that looks right and is not: it keeps anything
         * whose centre clears the water, so a rock with two units of radius on
         * a slope falling nine units over twenty-two keeps its seaward half in
         * the sea. The first capture of this change showed exactly that — a
         * clean shoreline with scrub and boulders sitting out in the water
         * beyond it. `x` is already derived from the footprint where it clears
         * the barrier; this is the same measurement at the other end.
         *
         * Tested against a solved limit rather than a sampled height, which is
         * the part that took three captures to get right. Sampling the relief
         * under the edge and comparing it to `SEA_HEIGHT` is the obvious test
         * and it leaks: the mesh that draws the beach interpolates linearly
         * between columns while the profile is a smoothstep, so the drawn sand
         * sits below the sampled figure near the top of the ramp, and the
         * swell moves the crossing again on top of that. Each round of margin
         * bought back a fraction of a unit and the boulders stayed afloat.
         * `shoreDryLimit` answers the question that was actually being asked —
         * how far out is it dry *everywhere* — once, from the profile's own
         * constants, so it cannot drift out of step with them.
         */
        const edge = x + kind.radius * scale;
        if (x > 0 && edge + kind.radius * scale > BEACH_DRY_LIMIT) {
          mesh.setMatrixAt(i, this.matrix.makeTranslation(0, -9999, 0));
          continue;
        }

        const px = curveAt(world) - curveAt(base) + x;
        const py = hillAt(world) - hillAt(base) + relief - kind.sink * scale;
        const pz = -ahead;

        // Measured rather than trusted: if the arithmetic above ever lets a
        // prop onto the road, the probe should be able to see it.
        if (Math.abs(x) - kind.radius * scale < ROAD.halfWidth) this.onRoadCount += 1;
        // Tracked so the gate can prove there is ground under the furthest of
        // them, rather than open sky.
        this.maxLateral = Math.max(this.maxLateral, Math.abs(x) + kind.radius * scale);
        // And that the furthest seaward of them is standing on beach rather
        // than wading, which is the same question asked of the other edge.
        if (x > 0) {
          this.maxSeawardEdge = Math.max(this.maxSeawardEdge, edge);
          if (groundReliefAt(edge, world) < SEA_HEIGHT) this.inSeaCount += 1;
        }

        this.position.set(px, py, pz);
        /* A laid kind faces the road; a scattered one faces wherever it grew.
         *
         * One rule covers every cadence kind because their geometry is authored
         * to it: local +X points at the carriageway, which swings a lamp's arm
         * out over the traffic and leaves a railing — authored spanning Z —
         * running along the verge. A random yaw on street furniture is the
         * other half of why the railing did not read as a line: even placed end
         * to end, sections turned through arbitrary angles meet at corners.
         */
        this.quaternion.setFromAxisAngle(UP, laid ? (side < 0 ? 0 : Math.PI) : r3 * Math.PI * 2);
        this.scaleVec.setScalar(scale);
        mesh.setMatrixAt(i, this.matrix.compose(this.position, this.quaternion, this.scaleVec));
        placed += 1;
      }

      entry.used = placed;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  /**
   * Slide the whole scenery group to follow the car between band rebuilds.
   *
   * Instances hold positions relative to the band's origin, so between rebuilds
   * the group only needs translating — which is one matrix rather than several
   * hundred.
   */
  private reposition(): void {
    const distance = this.road.travelled;
    const base = this.bands[0]?.start ?? 0;
    const delta = distance - base;
    this.root.position.set(
      curveAt(base) - curveAt(distance),
      hillAt(base) - hillAt(distance),
      delta,
    );
  }

  /* ---------------------------------------------------------------- reading */

  /** Live instance counts per prop kind, for the scenery coverage gate. */
  snapshot(): {
    biome: BiomeId;
    kinds: { id: string; instances: number }[];
    onRoad: number;
    /** Furthest any prop stands from the centreline, including its footprint. */
    maxLateral: number;
    /** Furthest seaward edge reached by any placed prop. */
    maxSeawardEdge: number;
    /**
     * Placed props whose seaward edge is under water.
     *
     * Zero by construction — the placement loop declines them — and reported
     * anyway for the same reason `onRoad` is: the arithmetic that keeps a prop
     * out of the sea is worth measuring rather than trusting, and a rock
     * standing offshore photographs as convincingly as one on the beach.
     */
    inSea: number;
    groundHalfWidth: number;
  } {
    return {
      biome: this.biome,
      kinds: [...this.live.values()].map((e) => ({ id: e.kind.id, instances: e.used })),
      onRoad: this.onRoadCount,
      maxLateral: this.maxLateral,
      maxSeawardEdge: this.maxSeawardEdge,
      inSea: this.inSeaCount,
      groundHalfWidth: this.road.groundHalfWidth,
    };
  }

  /** Furthest lateral extent reached by any placed prop. */
  private maxLateral = 0;
  private maxSeawardEdge = 0;
  private inSeaCount = 0;

  /** Total live instances across every kind. */
  get instanceCount(): number {
    return [...this.live.values()].reduce((n, e) => n + e.used, 0);
  }

  /** Number of distinct prop kinds currently resident — one draw call each. */
  get kindCount(): number {
    return this.live.size;
  }

  /**
   * Test seam: hide the scenery without tearing it down.
   *
   * What makes instancing worth having is that the cost does not scale with the
   * number of props, and that is only measurable as a difference — an absolute
   * draw-call budget mostly counts the traffic. Never hidden in play.
   */
  setVisible(visible: boolean): void {
    this.shown = visible;
    this.applyVisibility();
  }

  /**
   * A tunnel hides the scenery; it does not destroy it.
   *
   * Tearing the prop set down on entering a tunnel and rebuilding it on the
   * way out left a window where the road had nothing beside it: the rebuild
   * only happens when the car crosses a band boundary, so between coming out
   * of a tunnel and reaching the next band the world was empty. The gate
   * caught it as zero instances outside a tunnel, which is exactly what it
   * was. Tunnels are seconds long and the props are a few hundred instances —
   * hiding them costs nothing and has no state to get wrong.
   *
   * Kept separate from the probe's own visibility seam so that neither can
   * silently undo the other: the scenery is drawn when nothing is asking for
   * it to be hidden.
   */
  private applyVisibility(): void {
    this.root.visible = this.shown && !this.inTunnel;
  }

  reset(): void {
    this.root.position.set(0, 0, 0);
    this.repopulate();
  }

  dispose(): void {
    this.clearKinds();
    this.ctx.scene.remove(this.root);
    disposePropMaterials();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function fract(n: number): number {
  return n - Math.floor(n);
}
