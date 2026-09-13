import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import type { BiomeId } from '@/core/GameEvents';
import { ROAD } from '@/game/config/Balance';
import { barrierLimit, curveAt, hillAt } from '@/game/world/RoadGeometry';
import { disposePropMaterials, propsForBiome, type PropKind } from '@/game/render/PropFactory';
import type { RoadManager } from './RoadManager';
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

        const count = Math.max(1, Math.round(kind.count * density));
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

    for (const entry of this.live.values()) {
      const { kind, mesh } = entry;
      let placed = 0;

      for (let i = 0; i < mesh.count; i++) {
        // A seeded scatter keyed on the band, so the same stretch of road is
        // dressed the same way every time it is driven.
        const seed = (base * 0.013 + i * 7.77 + kind.id.length * 31.1);
        const r1 = fract(Math.sin(seed) * 43758.5453);
        const r2 = fract(Math.sin(seed * 1.7 + 2.3) * 24634.6345);
        const r3 = fract(Math.sin(seed * 2.9 + 5.1) * 19349.1233);
        const r4 = fract(Math.sin(seed * 3.7 + 9.4) * 31547.9182);

        const ahead = -behind + r1 * (span + behind);
        const side = r2 < 0.5 ? -1 : 1;
        const depth = kind.offset[0] + r3 * (kind.offset[1] - kind.offset[0]);
        const scale = kind.scale[0] + r4 * (kind.scale[1] - kind.scale[0]);

        // Road-space x, pushed out past the barrier by its own footprint so the
        // prop's base is clear of the tarmac, not merely its origin.
        const x = side * (barrierLimit() + kind.radius * scale + depth);

        const world = this.road.travelled + ahead;

        /* The biome of the ground this instance lands on, not of the ground
         * the car is standing on. A prop from the wrong side of a boundary is
         * parked below the world rather than drawn — which is what makes the
         * transition happen out at the boundary, in view, instead of all at
         * once under the camera. */
        if (!entry.biomes.has(this.world.biomeAtDistance(world))) {
          mesh.setMatrixAt(i, this.matrix.makeTranslation(0, -9999, 0));
          continue;
        }

        const px = curveAt(world) - curveAt(distance) + x;
        const py = hillAt(world) - hillAt(distance) - kind.sink * scale;
        const pz = -ahead;

        // Measured rather than trusted: if the arithmetic above ever lets a
        // prop onto the road, the probe should be able to see it.
        if (Math.abs(x) - kind.radius * scale < ROAD.halfWidth) this.onRoadCount += 1;
        // Tracked so the gate can prove there is ground under the furthest of
        // them, rather than open sky.
        this.maxLateral = Math.max(this.maxLateral, Math.abs(x) + kind.radius * scale);

        this.position.set(px, py, pz);
        this.quaternion.setFromAxisAngle(UP, r3 * Math.PI * 2);
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
    groundHalfWidth: number;
  } {
    return {
      biome: this.biome,
      kinds: [...this.live.values()].map((e) => ({ id: e.kind.id, instances: e.used })),
      onRoad: this.onRoadCount,
      maxLateral: this.maxLateral,
      groundHalfWidth: this.road.groundHalfWidth,
    };
  }

  /** Furthest lateral extent reached by any placed prop. */
  private maxLateral = 0;

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
