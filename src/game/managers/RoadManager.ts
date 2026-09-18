import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import { ROAD } from '@/game/config/Balance';
import { curveAt, groundReliefAt, hillAt, isCoastAt } from '@/game/world/RoadGeometry';
import { RoadStrip, type SectionPoint } from '@/game/world/RoadStrip';
import {
  makeGroundTexture, makeRoadTexture, makeRoadWearTexture, makeShoulderTexture,
} from '@/game/render/RoadTextures';

/**
 * The driving surface: tarmac, shoulders and barriers.
 *
 * Built once as a fixed ring of strips that recycle from the back of the world
 * to the front. Nothing is allocated after `init`, so a twenty-minute run costs
 * the same per frame as the first second.
 *
 * The player sits at z ≈ 0 and the world moves past. Keeping the origin under
 * the car means world coordinates never grow large enough for float precision
 * to start juddering the lane markings, which it does within a few minutes if
 * the car is the thing that moves.
 */
interface SegmentPosts {
  readonly mesh: THREE.InstancedMesh;
  /** Lateral offset of the rail these posts hold up. */
  readonly lateral: number;
}

interface Segment {
  readonly group: THREE.Group;
  readonly strips: RoadStrip[];
  /** The tarmac specifically, named rather than found by position in `strips`. */
  road: RoadStrip;
  readonly posts: SegmentPosts[];
  /** This segment's own water, shown only where its own road is coastal. */
  readonly sea: THREE.Mesh;
  startDistance: number;
}

/** Vertex rows per segment. Six is enough that the bend reads as smooth. */
const ROWS = 6;

/** How far the ground reaches either side of the centreline. */
const GROUND_HALF_WIDTH = 420;

/**
 * Lateral columns of the ground mesh.
 *
 * Sparse where the ground is flat and dense where it is not. The first version
 * was two columns spanning eight hundred and forty units, which is a single
 * quad and therefore necessarily a plane — and a plane seen from a low camera
 * meets the sky along a perfectly straight line all the way across the frame.
 * No amount of texture fixes that; the horizon has to have a shape.
 */
const GROUND_COLUMNS: readonly number[] = (() => {
  const inner = [0, 60, 96];
  const outer = [130, 170, 215, 265, 320, GROUND_HALF_WIDTH];
  const half = [...inner, ...outer];
  return [...half.slice(1).reverse().map((x) => -x), ...half];
})();

/**
 * The sea, on the seaward side of a coastal road.
 *
 * Columns start where the ground ends and run far enough out that the water
 * meets the sky rather than ending in a visible edge — at a chase camera's
 * height the horizon is a long way off, and a sea that stops short reads as a
 * swimming pool. Spacing widens with distance because nothing out there needs
 * resolution; what it needs is to still be there.
 *
 * Flat, with no relief function, because that is what water is. The ground
 * beside it keeps its relief, so the join reads as a shoreline rather than as
 * two planes meeting.
 */
const SEA_COLUMNS: readonly number[] = [
  150, 190, 240, 310, 420, 560, 760, 1050, 1450, 1900,
];
/**
 * Sea level, against a beach that reaches -9 by the time it is 130 out.
 *
 * The waterline is wherever the two cross, which is a shoreline that bends
 * with the road because the beach is sampled per vertex along it. Set this
 * higher and the sea climbs the beach toward the barrier; lower and it
 * retreats.
 */
export const SEA_HEIGHT = -2.4;

/**
 * Where the water begins, laterally.
 *
 * The true waterline is wherever the beach profile crosses `SEA_HEIGHT`, which
 * is a curve that bends with the road. Anything floating only needs to know
 * that it is safely outboard of it, so this is that crossing rounded outwards
 * rather than solved: the beach reaches -9 over 130 units from `RELIEF_INNER`,
 * and -2.4 of that fall lands around 140 out.
 */
export const SHORELINE_LATERAL = 150;

/** Height of the barrier post, and how many stand in one segment. */
const BARRIER_TOP = 1.02;
const POSTS_PER_SEGMENT = 8;

/**
 * The cross-section of a crash barrier, bottom lip to top lip.
 *
 * A real W-beam is one pressed sheet folded into two horizontal channels, which
 * is why it reads as a barrier from half a mile away: the folds catch the sun
 * as two bright lines with a shadow between them, and those lines converge to
 * the vanishing point. The wall this replaces was a single flat quad, and under
 * a low sun it was one unbroken band of grey the length of the horizon.
 *
 * `inward` is the direction the face points, so the same profile serves both
 * sides of the road without a mirrored copy.
 */
function beamSection(lateral: number, inward: number): SectionPoint[] {
  const at = (out: number, height: number): SectionPoint =>
    ({ lateral: lateral + inward * out, height });
  return [
    at(0, 0.44),
    at(0.09, 0.52),
    at(0.10, 0.62),
    at(0.03, 0.73),
    at(0.10, 0.84),
    at(0.09, 0.94),
    at(0, BARRIER_TOP),
  ];
}

export class RoadManager implements Manager {
  readonly name = 'road';

  private readonly segments: Segment[] = [];
  private readonly root = new THREE.Group();
  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  /** Scratch for post placement, so recycling a segment allocates nothing. */
  private readonly postMatrix = new THREE.Matrix4();
  private readonly postPosition = new THREE.Vector3();

  /** Distance travelled, in world units. Authoritative for the whole world. */
  private distance = 0;

  /**
   * The ground either side of the road.
   *
   * Without it the world ends at the rumble strip and everything beyond —
   * trees, rocks, whole city blocks — hangs against the sky. The scenery gate
   * could not see this: it proved props were off the tarmac and never asked
   * whether anything was underneath them.
   *
   * One wide strip per segment, sharing the road's rows. Curve and elevation
   * are functions of distance alone, so a strip four hundred units across is
   * as correct as a narrow one and costs two triangles a row.
   */
  private groundMat!: THREE.MeshStandardMaterial;
  /**
   * The water, and every mesh of it so the biome can hide them together.
   *
   * Hidden rather than rebuilt when the road leaves the coast: a sea is a few
   * hundred triangles and toggling `visible` costs nothing, where tearing the
   * strips down and putting them back would mean a hitch at exactly the moment
   * the player is crossing a boundary and looking at the scenery.
   */
  private seaMat!: THREE.MeshStandardMaterial;
  private readonly seaMeshes: THREE.Mesh[] = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    this.ctx.scene.add(this.root);

    const L = ROAD.segmentLength;
    const hw = ROAD.halfWidth;
    const sw = ROAD.shoulderWidth;

    const roadTex = makeRoadTexture(ROAD.laneCount, 1);
    const shoulderTex = makeShoulderTexture();
    this.textures.push(roadTex, shoulderTex);

    /*
     * Asphalt, with the polish in a roughness map rather than in the albedo.
     *
     * The first version painted the wheel tracks darker in the colour map and
     * left it there, which reads as a stain: the strip a million tyres leave on
     * a road is barely a different colour, it is the same colour that reflects.
     * The darkening stays, much reduced, and the polish now lives in roughness —
     * so the tracks catch the sun as the road curves under it and go matte again
     * when it does not, which is most of what makes tarmac read as tarmac at
     * speed rather than as a grey ribbon.
     */
    const roadWearTex = makeRoadWearTexture(ROAD.laneCount, 1);
    this.textures.push(roadWearTex);
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      roughnessMap: roadWearTex,
      roughness: 1,
      metalness: 0.04,
      envMapIntensity: 0.7,
    });
    const shoulderMat = new THREE.MeshStandardMaterial({ map: shoulderTex, roughness: 0.9 });
    /*
     * Galvanised steel, only half metallic.
     *
     * At 0.92 the rail on the sun's side blazed and the rail on the other side
     * rendered as a solid black band the length of the horizon — a fully
     * metallic surface has no diffuse term, and the only thing this one had to
     * reflect was a sky dome with nothing below its horizon. Weathered
     * galvanising is chalky anyway; half metal keeps the sheen on the folds and
     * gives the shaded face something of its own to show.
     */
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0xb9bec7,
      roughness: 0.44,
      metalness: 0.5,
      envMapIntensity: 1.8,
      side: THREE.DoubleSide,
    });
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x8b9199, roughness: 0.58, metalness: 0.45, envMapIntensity: 1.2,
    });
    const groundTex = makeGroundTexture();
    this.textures.push(groundTex);
    // The map is greyscale and the biome sets the colour, which multiplies it.
    /* Water is mostly a mirror, so almost all of what makes it read is the
     * environment map — the sky it reflects rather than the colour it is. The
     * low roughness is what gives the sun a specular track across it, which is
     * also the first thing in this scene ever to reach the top of the
     * histogram: the reference's blown pixels are sun on water, and iteration
     * 27 closed that gap as unreachable through the sky precisely because the
     * geometry to carry it did not exist yet. */
    this.seaMat = new THREE.MeshStandardMaterial({
      color: 0x1d6f8a, roughness: 0.14, metalness: 0.32, envMapIntensity: 1.8,
    });

    this.groundMat = new THREE.MeshStandardMaterial({
      map: groundTex, color: 0x4a5240, roughness: 0.96,
    });
    this.materials.push(roadMat, shoulderMat, barrierMat, postMat, this.groundMat, this.seaMat);

    /* One post geometry, instanced per segment per side. */
    const postGeo = new THREE.BoxGeometry(0.12, BARRIER_TOP, 0.2);
    postGeo.translate(0, BARRIER_TOP / 2, 0);
    this.geometries.push(postGeo);

    for (let i = 0; i < ROAD.segmentCount; i++) {
      const group = new THREE.Group();
      const strips: RoadStrip[] = [];
      const segmentPosts: SegmentPosts[] = [];

      // Ground first, dropped below the deck so the tarmac wins the depth test.
      const ground = RoadStrip.flat(GROUND_COLUMNS, L, ROWS, -0.06, groundReliefAt);
      const groundMesh = new THREE.Mesh(ground.geometry, this.groundMat);
      groundMesh.receiveShadow = true;
      group.add(groundMesh);
      strips.push(ground);

      /* The sea, outboard of the ground on one side only.
       *
       * One side, because a road with water on both sides is a causeway and
       * the reference is a boulevard with a city behind it. It receives no
       * shadow — nothing stands over open water, and asking a plane that
       * reaches two thousand units to sit inside the sun's shadow frustum
       * would push that frustum wide enough to make every other shadow in the
       * scene coarse.
       */
      const sea = RoadStrip.flat(SEA_COLUMNS, L, ROWS, SEA_HEIGHT);
      const seaMesh = new THREE.Mesh(sea.geometry, this.seaMat);
      seaMesh.receiveShadow = false;
      group.add(seaMesh);
      strips.push(sea);
      this.seaMeshes.push(seaMesh);

      // Tarmac: columns at the lane boundaries so the texture stretches evenly.
      const laneCols: number[] = [];
      for (let c = 0; c <= ROAD.laneCount; c++) laneCols.push(-hw + c * ROAD.laneWidth);
      const road = RoadStrip.flat(laneCols, L, ROWS);
      const roadMesh = new THREE.Mesh(road.geometry, roadMat);
      roadMesh.receiveShadow = true;
      group.add(roadMesh);
      strips.push(road);

      for (const side of [-1, 1] as const) {
        const shoulder = RoadStrip.flat(
          side < 0 ? [-hw - sw, -hw] : [hw, hw + sw],
          L,
          ROWS,
          0.01,
        );
        const shoulderMesh = new THREE.Mesh(shoulder.geometry, shoulderMat);
        shoulderMesh.receiveShadow = true;
        group.add(shoulderMesh);
        strips.push(shoulder);

        /* Barrier: a corrugated W-beam on posts, extruded along the same rows
         * as everything else so it bends with the road. The flat wall it
         * replaces had a single face and no thickness, which under a low sun
         * was one unbroken band of grey the length of the horizon. */
        const barrier = new RoadStrip(beamSection(side * (hw + sw), -side), L, ROWS);
        const barrierMesh = new THREE.Mesh(barrier.geometry, barrierMat);
        barrierMesh.castShadow = true;
        barrierMesh.receiveShadow = true;
        group.add(barrierMesh);
        strips.push(barrier);

        const posts = new THREE.InstancedMesh(postGeo, postMat, POSTS_PER_SEGMENT);
        posts.castShadow = true;
        posts.frustumCulled = false;
        group.add(posts);
        segmentPosts.push({ mesh: posts, lateral: side * (hw + sw) });
      }

      this.root.add(group);
      this.segments.push({
        group, strips, road, posts: segmentPosts, sea: seaMesh, startDistance: Number.NaN,
      });
    }

    this.layout();
  }

  /** Distance travelled so far, in world units. */
  get travelled(): number {
    return this.distance;
  }

  /** Lateral offset the whole world is displaced by at the player's position. */
  get curveHere(): number {
    return curveAt(this.distance);
  }

  /**
   * Stand this segment's barrier posts up along its own stretch of road.
   *
   * Driven off the segment's start rather than the player's distance, and
   * rewritten only when a segment is recycled — the same rule the strips
   * follow. Posts placed relative to the player would slide along the rail as
   * the car moved, which is the one failure mode that makes a barrier read as
   * a texture rather than as a structure.
   */
  private placePosts(seg: Segment, start: number): void {
    const L = ROAD.segmentLength;
    const baseCurve = curveAt(start);
    const baseHill = hillAt(start);

    for (const { mesh, lateral } of seg.posts) {
      for (let i = 0; i < POSTS_PER_SEGMENT; i++) {
        const t = (i + 0.5) / POSTS_PER_SEGMENT;
        const u = start + t * L;
        this.postPosition.set(
          lateral + curveAt(u) - baseCurve,
          hillAt(u) - baseHill,
          -t * L,
        );
        this.postMatrix.makeTranslation(this.postPosition.x, this.postPosition.y, this.postPosition.z);
        mesh.setMatrixAt(i, this.postMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** How far the ground reaches either side. Nothing may stand beyond it. */
  get groundHalfWidth(): number {
    return GROUND_HALF_WIDTH;
  }

  /**
   * Master switch for the water, independent of where the coast is.
   *
   * Kept as a seam rather than as the mechanism. Which *segments* carry water
   * is decided per segment in `layout`, from the biome of that segment's own
   * road — this only says whether any of it is drawn at all.
   */
  setSeaVisible(visible: boolean): void {
    this.seaShown = visible;
    for (const seg of this.segments) {
      seg.sea.visible = visible && isCoastAt(seg.startDistance + ROAD.segmentLength * 0.5);
    }
  }

  private seaShown = true;

  setGroundColour(hex: number, roughness: number): void {
    this.groundMat.color.setHex(hex);
    this.groundMat.roughness = roughness;
  }

  update(dt: number, speed: number): void {
    this.distance += speed * dt;
    this.layout();
  }

  /**
   * Place every segment for the current distance.
   *
   * Each segment owns a slot in a ring; its start distance is derived from the
   * player's, so recycling is arithmetic rather than a list shuffle and no
   * stretch of road can be missed or drawn twice. Only a segment whose start
   * actually changed rebuilds its vertices.
   */
  private layout(): void {
    const L = ROAD.segmentLength;
    const base = Math.floor(this.distance / L);
    const behind = 3;
    const baseCurve = curveAt(this.distance);
    const baseHill = hillAt(this.distance);

    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const start = (base + i - behind) * L;

      if (start !== seg.startDistance) {
        seg.startDistance = start;
        for (const strip of seg.strips) strip.setStart(start);
        this.placePosts(seg, start);
        /* Water is a property of this segment's road, not of the car's.
         *
         * It used to be one flag over every segment at once, set from the biome
         * under the camera — so the entire sea, out to nineteen hundred units,
         * blinked on and off as the player crossed a boundary. That is the most
         * abrupt thing in the world and it happened to the largest object in
         * it. Sampled at the segment's midpoint, and only when the segment
         * recycles, which is the same rule the beach profile has followed since
         * it was built. */
        seg.sea.visible = this.seaShown
          && isCoastAt(start + ROAD.segmentLength * 0.5);
      }

      // Everything player-relative lives here, so the vertices above stay put.
      seg.group.position.set(
        curveAt(start) - baseCurve,
        hillAt(start) - baseHill,
        this.distance - start,
      );
    }
  }

  /**
   * Where a point at forward offset `ahead` should be drawn.
   *
   * Traffic, pickups and scenery all place themselves through this so they ride
   * the same curve and crest the same hills as the tarmac under them.
   */
  worldOffset(ahead: number, out: THREE.Vector3): THREE.Vector3 {
    const d = this.distance + ahead;
    return out.set(curveAt(d) - curveAt(this.distance), hillAt(d) - hillAt(this.distance), -ahead);
  }

  /**
   * Largest gap between the trailing edge of one segment and the leading edge
   * of the next, in world units.
   *
   * The surface is continuous by construction — both edges are sampled from the
   * same distance — so this should be zero to floating-point noise. It is
   * measured rather than assumed because the failure it guards against, a road
   * that comes apart into a staircase, is exactly what the first build shipped,
   * and nothing in the numeric state said so.
   */
  maxSeamGap(): number {
    const L = ROAD.segmentLength;
    const byStart = new Map<number, Segment>();
    for (const seg of this.segments) byStart.set(seg.startDistance, seg);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let worst = 0;

    for (const seg of this.segments) {
      const next = byStart.get(seg.startDistance + L);
      if (!next) continue;
      const road = seg.road;
      const nextRoad = next.road;

      for (let c = 0; c < road.columnCount; c++) {
        road.getVertex(road.rowCount, c, a).add(seg.group.position);
        nextRoad.getVertex(0, c, b).add(next.group.position);
        worst = Math.max(worst, a.distanceTo(b));
      }
    }
    return worst;
  }

  reset(): void {
    this.distance = 0;
    this.layout();
  }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    for (const t of this.textures) t.dispose();
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const seg of this.segments) {
      for (const s of seg.strips) s.dispose();
      for (const p of seg.posts) p.mesh.dispose();
    }
    this.segments.length = 0;
  }
}
