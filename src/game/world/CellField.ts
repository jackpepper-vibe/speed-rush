import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import type { SceneRig } from '@/game/render/SceneRig';
import { curveAt, hillAt } from '@/game/world/RoadGeometry';
import type { RoadManager } from '@/game/managers/RoadManager';

/**
 * A far-field instanced set anchored to the world rather than to the camera.
 *
 * `SceneryManager` recycles props in 120-unit bands and rewrites **every**
 * instance when the car crosses one. For scrub that is invisible. For anything
 * large and distant it is the pop the operator reported: a whole skyline, or a
 * whole harbour, re-rolling twice a second.
 *
 * The rule here is different and is the entire point of the class. Space is cut
 * into fixed cells — `cell` units wide at the top of the ladder, wider at the
 * bottom of it — and an instance's transform is a pure function of its
 * **absolute cell index**. The pool holds a window of
 * consecutive cells; when the window advances, the contents shift by one slot
 * and everything already on screen is written back bit-identical. One thing
 * leaves at the back, one arrives at the far end, and nothing in view moves.
 *
 * Subclasses supply the silhouette and the rule for dressing a cell. They do
 * not touch the pool, the anchor or the follow transform, which is where the
 * two managers built on this would otherwise have been the same three hundred
 * lines twice.
 */

/** What a subclass fills in to place one cell's instance. */
export interface CellPlacement {
  /** Lateral offset from the centreline. Negative is landward on a coast. */
  lateral: number;
  /** Absolute distance along the road, usually the cell's own with a jitter. */
  along: number;
  /** Height above the road surface at `along`, before the field's own sink. */
  height: number;
  /** Yaw about the vertical, in radians. */
  yaw: number;
  /** Non-uniform scale, in world units, applied to the unit silhouette. */
  scale: THREE.Vector3;
  /** Instance tint, multiplying the shared material's colour. */
  colour: THREE.Color;
}

export interface CellFieldSpec {
  /** Along-road size of one cell at the top of the quality ladder. */
  readonly cell: number;
  /** How far behind the camera cells are still held. */
  readonly behind: number;
  /** How far ahead cells are placed. */
  readonly ahead: number;
  /** Pool floor, so the bottom of the quality ladder still has a field. */
  readonly minimumPool: number;
}

export abstract class CellField implements Manager {
  abstract readonly name: string;

  private readonly root = new THREE.Group();
  private mesh!: THREE.InstancedMesh;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.Material;

  /**
   * Cell size actually in use, which is the spec's widened by the quality tier.
   *
   * The density dial has to thin this field, not shorten it. Scaling the
   * **pool** instead is the obvious move and it is wrong: the window is
   * `behind + ahead` units wide whatever the tier, so a smaller pool of
   * fixed-size cells simply stops early — measured at the low tier, the
   * skyline ended 214 units ahead instead of 700 and the city was missing from
   * the frame rather than sparser in it. Widening the cell keeps the reach and
   * spends the smaller budget across all of it.
   */
  private cellSize = 0;

  /** First cell index the pool currently holds. NaN before the first fill. */
  private anchor = Number.NaN;
  /** Cells that resolved to something and were therefore drawn. */
  private drawn = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly placement: CellPlacement = {
    lateral: 0, along: 0, height: 0, yaw: 0,
    scale: new THREE.Vector3(1, 1, 1), colour: new THREE.Color(),
  };

  private shown = true;

  constructor(
    protected readonly ctx: GameContext,
    protected readonly road: RoadManager,
    protected readonly rig: SceneRig,
    private readonly spec: CellFieldSpec,
  ) {}

  /* ------------------------------------------------------------- subclasses */

  /** The unit silhouette, authored so one matrix carries footprint and height. */
  protected abstract buildGeometry(): THREE.BufferGeometry;

  /** The one material every instance shares. Tint comes through `instanceColor`. */
  protected abstract buildMaterial(): THREE.Material;

  /**
   * Dress one cell, or decline it.
   *
   * Return false to leave the cell empty — which is how a field gets gaps
   * without the pool having to be sparse. `cell` is the absolute index and is
   * the only thing a subclass may key its randomness on: anything else, and
   * the field re-rolls as the car moves, which is the failure this class
   * exists to prevent.
   */
  protected abstract place(cell: number, world: number, out: CellPlacement): boolean;

  /** Whether instances cast into the sun's shadow map. Usually false out here. */
  protected get castsShadow(): boolean {
    return false;
  }

  /* -------------------------------------------------------------- lifecycle */

  init(): void {
    this.ctx.scene.add(this.root);
    this.geometry = this.buildGeometry();
    this.material = this.buildMaterial();

    /*
     * The ladder is applied to the cell size, so the field reaches just as far
     * at the bottom of it and holds fewer things across that reach. It is one
     * draw call at any count — what the dial buys down there is vertex work and
     * fill, not draws.
     */
    const density = Math.max(0.05, this.rig.quality.sceneryDensity);
    this.cellSize = this.spec.cell / density;
    const span = this.spec.behind + this.spec.ahead;
    const count = Math.max(this.spec.minimumPool, Math.ceil(span / this.cellSize));

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = this.castsShadow;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) this.park(i);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.root.add(this.mesh);

    this.fill(this.anchorFor(this.road.travelled));
  }

  update(_dt: number, _speed: number, distance: number): void {
    const wanted = this.anchorFor(distance);
    if (wanted !== this.anchor) this.fill(wanted);
    this.follow(distance);
  }

  reset(): void {
    this.root.position.set(0, 0, 0);
    this.fill(this.anchorFor(this.road.travelled));
  }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    this.mesh?.dispose();
    this.geometry?.dispose();
    this.material?.dispose();
  }

  /* -------------------------------------------------------------- placement */

  private anchorFor(distance: number): number {
    return Math.floor((distance - this.spec.behind) / this.cellSize);
  }

  private park(i: number): void {
    this.mesh.setMatrixAt(i, this.matrix.makeTranslation(0, -9999, 0));
  }

  /**
   * Write every instance for an anchor cell.
   *
   * Transforms are expressed relative to the **anchor cell's** own world
   * position rather than to the car's, so the buffer is a function of the
   * anchor alone: the same anchor always produces the same buffer, whatever the
   * car was doing when it was written. That is precisely what lets `follow` be
   * a single translation, and what makes a re-fill invisible.
   */
  private fill(anchor: number): void {
    this.anchor = anchor;
    const baseDistance = anchor * this.cellSize;
    const baseCurve = curveAt(baseDistance);
    const baseHill = hillAt(baseDistance);
    const p = this.placement;
    this.drawn = 0;

    for (let i = 0; i < this.mesh.count; i++) {
      const cell = anchor + i;
      const world = cell * this.cellSize;

      p.lateral = 0;
      p.along = world;
      p.height = 0;
      p.yaw = 0;
      p.scale.set(1, 1, 1);
      p.colour.setRGB(1, 1, 1);

      if (!this.place(cell, world, p)) {
        this.park(i);
        continue;
      }

      this.position.set(
        curveAt(p.along) - baseCurve + p.lateral,
        hillAt(p.along) - baseHill + p.height,
        -(p.along - baseDistance),
      );
      this.quaternion.setFromAxisAngle(UP, p.yaw);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.quaternion, p.scale));
      this.mesh.setColorAt(i, p.colour);
      this.drawn += 1;
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  /**
   * Slide the whole field to follow the car between fills.
   *
   * One matrix rather than several dozen, the same trade `SceneryManager`
   * makes — and here it is also what holds the field still, since the buffer
   * was written against the anchor cell and the group is placed by the same
   * rule.
   */
  private follow(distance: number): void {
    const baseDistance = this.anchor * this.cellSize;
    this.root.position.set(
      curveAt(baseDistance) - curveAt(distance),
      hillAt(baseDistance) - hillAt(distance),
      distance - baseDistance,
    );
  }

  /* ---------------------------------------------------------------- reading */

  /** Instances currently standing, and the pool they came from. */
  snapshot(): { placed: number; pool: number } {
    return { placed: this.drawn, pool: this.mesh?.count ?? 0 };
  }

  /**
   * Test seam, matching the scenery's.
   *
   * What instancing buys is only ever visible as a difference — a field of
   * forty that cost forty draw calls is a real regression no absolute budget
   * would catch — and a field is also the only honest way to measure whether
   * anything it contains reaches the frame at all. Never hidden in play.
   */
  setVisible(visible: boolean): void {
    this.shown = visible;
    this.root.visible = visible;
  }

  get visible(): boolean {
    return this.shown;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A stable pseudo-random value for a cell.
 *
 * Keyed on the absolute cell index and a salt, and on nothing else — not the
 * band, not the car's distance, not the shared stream. That is the whole
 * mechanism by which a `CellField` does not pop: the same cell is the same
 * object for the life of the run, whichever slot of the pool holds it.
 */
export function cellHash(cell: number, salt: number): number {
  const n = Math.sin(cell * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
