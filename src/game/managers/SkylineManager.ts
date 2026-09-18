import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import type { SceneRig } from '@/game/render/SceneRig';
import { curveAt, groundReliefAt, hillAt } from '@/game/world/RoadGeometry';
import type { RoadManager } from './RoadManager';
import type { WorldLookup } from './SceneryManager';

/**
 * The city behind the boulevard.
 *
 * The reference is an urban seaside road: sea and a cruise ship out to one
 * side, a dense block of towers massing in the mid-distance on the other. We
 * had the sea from iteration 33 and the landward side was empty sand to the
 * horizon, which is why the frame read as a highway through a beach rather
 * than as a city waterfront.
 *
 * This is deliberately *not* a `SceneryManager` prop kind, for two reasons.
 *
 * A skyline is not roadside dressing: it stands two to four hundred units out,
 * it is tens of units tall, and it has to be placed against the far ground's
 * relief rather than against the flat verge every prop kind assumes. Scattering
 * it with the props would put tower blocks in among the palms.
 *
 * And it must not re-roll. `SceneryManager.repopulate` rewrites every instance
 * when the car crosses a band, which is invisible for scrub and fatal for a
 * skyline — a city that redraws itself every hundred and twenty units is the
 * pop the operator reported. Here every building's transform is a pure function
 * of its **absolute cell index**, so advancing the anchor shifts the contents
 * of the pool by one slot and changes nothing that was already on screen: one
 * building leaves at the back, one arrives at the far end, and the rest are
 * bit-identical.
 */

/** Along-road spacing of one city cell. */
const CELL = 46;

/**
 * How far behind the camera the skyline still reaches.
 *
 * Longer than the props' 90: a tower seventy units tall at two hundred out is
 * still well inside the frame when its own stretch of road is behind the car,
 * where a bush at the same distance left the screen long ago.
 */
const BEHIND = 200;

/**
 * How far ahead cells are placed, beyond the road's own draw distance.
 *
 * The fog swallows the far end long before this — at density 0.003 a building
 * six hundred out is most of the way to the horizon colour — and that is the
 * point. A skyline whose last block ends at a visible line is a model of a
 * city; one that fades into the haze is a city.
 */
const AHEAD = 700;

/** Lateral band the city occupies, landward of the road. */
const NEAR_LATERAL = 225;
const FAR_LATERAL = 400;

/** Footprint and height ranges, in world units. */
const WIDTH = [16, 38] as const;
const HEIGHT = [24, 74] as const;

/**
 * Sunk a little, so relief the buildings are not modelled against cannot leave
 * one standing on air. The ground out there swings about fifteen units and is
 * sampled per building, so this only has to cover the slope across a single
 * footprint.
 */
const SINK = 4;

/**
 * One tower, as a silhouette that survives non-uniform scaling.
 *
 * A unit box scaled to width and height is a slab, and a row of slabs is a
 * wall. The setback and the mast are what make the roofline read as a city
 * from far enough away that no facade detail survives — which, behind this
 * much fog, is all of them. Authored in a unit cube so a single instance
 * matrix carries both the footprint and the storey count.
 */
function towerBlockGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const body = new THREE.BoxGeometry(1, 1, 1);
  body.translate(0, 0.5, 0);
  parts.push(body);

  const setback = new THREE.BoxGeometry(0.66, 0.22, 0.66);
  setback.translate(0, 1.11, 0);
  parts.push(setback);

  const mast = new THREE.BoxGeometry(0.08, 0.16, 0.08);
  mast.translate(0, 1.30, 0);
  parts.push(mast);

  const merged = mergeBoxes(parts);
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * Concatenate box geometries into one buffer.
 *
 * Hand-rolled rather than pulled from `BufferGeometryUtils`: three boxes with
 * identical attribute sets is the whole requirement, and the addon brings a
 * general merge with morph-target and group handling this does not need.
 */
function mergeBoxes(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv'] as const;
  let vertexCount = 0;
  let indexCount = 0;
  for (const p of parts) {
    vertexCount += p.getAttribute('position').count;
    indexCount += p.getIndex()!.count;
  }

  for (const name of names) {
    const size = parts[0].getAttribute(name).itemSize;
    const data = new Float32Array(vertexCount * size);
    let at = 0;
    for (const p of parts) {
      data.set(p.getAttribute(name).array as Float32Array, at);
      at += p.getAttribute(name).count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }

  const indices = new Uint16Array(indexCount);
  let vertexBase = 0;
  let at = 0;
  for (const p of parts) {
    const src = p.getIndex()!;
    for (let i = 0; i < src.count; i++) indices[at++] = src.getX(i) + vertexBase;
    vertexBase += p.getAttribute('position').count;
  }
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  return out;
}

export class SkylineManager implements Manager {
  readonly name = 'skyline';

  private readonly root = new THREE.Group();
  private mesh!: THREE.InstancedMesh;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.MeshStandardMaterial;

  /** First cell index currently held by the pool, or NaN before the first fill. */
  private anchor = Number.NaN;
  /** Cells that resolved onto coastal road and were therefore drawn. */
  private placed = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scaleVec = new THREE.Vector3();
  private readonly colour = new THREE.Color();

  private shown = true;

  constructor(
    private readonly ctx: GameContext,
    private readonly road: RoadManager,
    private readonly rig: SceneRig,
    private readonly world: WorldLookup,
  ) {}

  init(): void {
    this.ctx.scene.add(this.root);

    this.geometry = towerBlockGeo();
    /*
     * Pale and chalky, because that is what distance does to a building.
     *
     * The tint per instance comes through `instanceColor`, which multiplies
     * this one — so the material stays a single draw call while no two towers
     * are quite the same concrete. Rough and barely metallic: a mirror out
     * there would catch the sun and put a bright rectangle on the horizon,
     * which is exactly the kind of small bright thing bloom turns into a
     * smear.
     */
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.88, metalness: 0.05, envMapIntensity: 0.7,
    });

    /*
     * Pool size follows the ladder through the scenery density dial, as every
     * other instanced set does. It is one draw call at any count — what the
     * dial is buying at the bottom of the ladder is vertex work and fill, not
     * draws.
     */
    const cells = Math.ceil((BEHIND + AHEAD) / CELL);
    const count = Math.max(8, Math.round(cells * this.rig.quality.sceneryDensity));

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /*
     * Casts nothing and receives nothing. The sun's shadow frustum is ±90
     * around the car; a building at three hundred out is outside it, so asking
     * for a shadow would either produce none or force the frustum wide enough
     * to coarsen every shadow that matters. The haze at that range would hide
     * it either way.
     */
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.mesh.setMatrixAt(i, this.matrix.makeTranslation(0, -9999, 0));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.root.add(this.mesh);

    this.fill(this.anchorFor(this.road.travelled));
  }

  /** The cell index the back of the pool should sit at for this distance. */
  private anchorFor(distance: number): number {
    return Math.floor((distance - BEHIND) / CELL);
  }

  update(_dt: number, _speed: number, distance: number): void {
    const wanted = this.anchorFor(distance);
    if (wanted !== this.anchor) this.fill(wanted);
    this.follow(distance);
  }

  /**
   * Write every instance for an anchor cell.
   *
   * Transforms are keyed on the cell's absolute index and expressed relative to
   * the anchor cell's own world position, so the buffer is a function of the
   * anchor alone — the same anchor always produces the same buffer, whatever
   * the car was doing when it was written. That is what `follow` then needs in
   * order to be a single translation.
   */
  private fill(anchor: number): void {
    this.anchor = anchor;
    const baseDistance = anchor * CELL;
    const baseCurve = curveAt(baseDistance);
    const baseHill = hillAt(baseDistance);
    this.placed = 0;

    for (let i = 0; i < this.mesh.count; i++) {
      const cell = anchor + i;
      const world = cell * CELL;

      /* The biome of the ground this building stands on, not of the ground
       * under the car — the same rule the props follow. A skyline switched on
       * when the car crosses into the coast would arrive as a city appearing
       * out of nothing directly beside the player; keyed per cell, it comes
       * over the horizon and the boundary passes through it. */
      if (!this.world.biomeAtDistance(world).match(/^(coast|city)$/)) {
        this.mesh.setMatrixAt(i, this.matrix.makeTranslation(0, -9999, 0));
        continue;
      }

      const r1 = hash(cell, 1.7);
      const r2 = hash(cell, 5.3);
      const r3 = hash(cell, 11.9);
      const r4 = hash(cell, 19.1);
      const r5 = hash(cell, 27.7);

      /* Depth is squared so the band crowds towards its near edge: a real
       * skyline is a front rank with the rest stacked behind it, not an even
       * scatter across a strip. It is also what stops the far towers, which
       * the fog has all but erased anyway, from being most of the budget. */
      const lateral = -(NEAR_LATERAL + (FAR_LATERAL - NEAR_LATERAL) * r1 * r1);
      /* Jitter along the road by most of a cell, so the grid that keeps this
       * from re-rolling does not also make it a colonnade. */
      const along = world + (r2 - 0.5) * CELL * 0.86;

      const width = WIDTH[0] + r3 * (WIDTH[1] - WIDTH[0]);
      /* Tall at the front, low behind — the front rank is what the eye reads
       * as the city's height, and towers hiding behind towers is wasted. */
      const height = HEIGHT[0] + (HEIGHT[1] - HEIGHT[0]) * (0.35 + 0.65 * (1 - r1)) * (0.55 + 0.45 * r4);

      const px = curveAt(along) - baseCurve + lateral;
      const py = hillAt(along) - baseHill + groundReliefAt(lateral, along) - SINK;
      const pz = -(along - baseDistance);

      this.position.set(px, py, pz);
      this.quaternion.setFromAxisAngle(UP, (r5 - 0.5) * 0.5);
      this.scaleVec.set(width, height, width * (0.7 + 0.6 * r4));
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.quaternion, this.scaleVec));

      /* Concrete, brick and glass, all of it half-lost in haze. A narrow
       * spread on purpose: wide enough that the massing has faces, narrow
       * enough that it still reads as one city rather than as a paint chart. */
      this.colour.setHSL(0.07 + r3 * 0.06, 0.06 + r4 * 0.10, 0.52 + r5 * 0.18);
      this.mesh.setColorAt(i, this.colour);
      this.placed += 1;
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  /**
   * Slide the whole city to follow the car between fills.
   *
   * One matrix rather than several dozen, the same trade `SceneryManager`
   * makes — and here it is also what makes the skyline hold still. The
   * buffer is written against the anchor cell, so as long as the group is
   * placed by the same rule, a fill that changes the anchor cannot move
   * anything that was already on screen.
   */
  private follow(distance: number): void {
    const baseDistance = this.anchor * CELL;
    this.root.position.set(
      curveAt(baseDistance) - curveAt(distance),
      hillAt(baseDistance) - hillAt(distance),
      distance - baseDistance,
    );
  }

  /** Buildings currently standing, and the pool they came from. */
  snapshot(): { placed: number; pool: number } {
    return { placed: this.placed, pool: this.mesh?.count ?? 0 };
  }

  /**
   * Test seam, matching the scenery's. What instancing buys is only visible as
   * a difference, and a skyline of forty towers that cost forty draw calls
   * would be a real regression no absolute budget would catch.
   */
  setVisible(visible: boolean): void {
    this.shown = visible;
    this.root.visible = visible;
  }

  get visible(): boolean {
    return this.shown;
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
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A stable pseudo-random value for a cell.
 *
 * Keyed on the absolute cell index and nothing else — not on the band, not on
 * the car's distance, not on the shared stream. That is the whole mechanism by
 * which this skyline does not pop: the same cell is the same building for the
 * life of the run, whichever slot of the pool happens to be holding it.
 */
function hash(cell: number, salt: number): number {
  const n = Math.sin(cell * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
