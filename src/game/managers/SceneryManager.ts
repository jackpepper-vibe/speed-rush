import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import type { BiomeId } from '@/core/GameEvents';
import { ROAD } from '@/game/config/Balance';
import { barrierLimit, curveAt, hillAt } from '@/game/world/RoadGeometry';
import { disposePropMaterials, propsForBiome, type PropKind } from '@/game/render/PropFactory';
import type { RoadManager } from './RoadManager';
import type { SceneRig } from '@/game/render/SceneRig';

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

  constructor(
    private readonly ctx: GameContext,
    private readonly road: RoadManager,
    private readonly rig: SceneRig,
  ) {}

  init(): void {
    this.ctx.scene.add(this.root);
    this.ctx.bus.on('biome:change', ({ to }) => this.setBiome(to));
    this.ctx.bus.on('world:tunnel-enter', () => this.setBiome('tunnel'));
    this.ctx.bus.on('world:tunnel-exit', () => this.setBiome(this.biome));
    this.setBiome('coast');
  }

  /* ------------------------------------------------------------------ biome */

  /**
   * Swap the prop set.
   *
   * Geometry is rebuilt on a biome change rather than every kind being kept
   * resident: a coast has no towers and a city has no cacti, and holding six
   * biomes' worth of instanced meshes alive to avoid a rebuild every ninety
   * seconds is the wrong trade on a phone.
   */
  private setBiome(biome: BiomeId): void {
    if (biome === 'tunnel' && this.live.size === 0) return;
    this.biome = biome === 'tunnel' ? this.biome : biome;

    this.clearKinds();
    const density = this.rig.quality.sceneryDensity;

    for (const kind of propsForBiome(biome)) {
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
      this.live.set(kind.id, { kind, mesh, used: 0 });
    }

    this.bands.length = 0;
    this.repopulate();
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
   * Scatter every instance across the visible stretch of road.
   *
   * Done wholesale rather than per band: the instance count is a few hundred at
   * most, the scatter is seeded, and rewriting the whole buffer once when the
   * car crosses a band boundary is simpler — and measurably cheaper — than
   * tracking which instance belongs to which band.
   */
  private repopulate(): void {
    const distance = this.road.travelled;
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
        const px = curveAt(world) - curveAt(distance) + x;
        const py = hillAt(world) - hillAt(distance) - kind.sink * scale;
        const pz = -ahead;

        // Measured rather than trusted: if the arithmetic above ever lets a
        // prop onto the road, the probe should be able to see it.
        if (Math.abs(x) - kind.radius * scale < ROAD.halfWidth) this.onRoadCount += 1;

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
  snapshot(): { biome: BiomeId; kinds: { id: string; instances: number }[]; onRoad: number } {
    return {
      biome: this.biome,
      kinds: [...this.live.values()].map((e) => ({ id: e.kind.id, instances: e.used })),
      onRoad: this.onRoadCount,
    };
  }

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
    this.root.visible = visible;
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
