import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import { ROAD } from '@/game/config/Balance';
import {
  biomeAt, curveAt, groundReliefAt, hillAt, isCoastAt, shoreLowestAt, SHORE_SPAN,
} from '@/game/world/RoadGeometry';
import { onNight } from '@/game/render/NightLights';
import { RoadStrip, type SectionPoint } from '@/game/world/RoadStrip';
import { makeGroundTexture } from '@/game/render/RoadTextures';
import { RoadSurfaceMaterial } from '@/game/render/road/RoadSurfaceMaterial';
import { SeaMaterial } from '@/game/render/road/SeaMaterial';

/**
 * The driving surface: carriageway, gutters, kerbs and pavements, the ground
 * either side and the sea.
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
interface Segment {
  readonly group: THREE.Group;
  readonly strips: RoadStrip[];
  /** The tarmac specifically, named rather than found by position in `strips`. */
  road: RoadStrip;
  /** This segment's own water, shown only where its own road is coastal. */
  readonly sea: THREE.Mesh;
  startDistance: number;
  /** Whether this stretch has lamp standards, and the verge it is laid with. */
  lamps: boolean;
  verge: number;
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
  /* Columns through the beach ramp, which is the one place on this mesh where
   * a few units of lateral error is a visible mistake. The seaward profile
   * falls nine units between 34 and 64, and the waterline is wherever that
   * fall crosses `SEA_HEIGHT` — so a column spacing of thirty across the ramp
   * would put the shoreline anywhere in a thirty-unit band and make it a
   * straight edge between two of them. These are mirrored onto the landward
   * side, where they cost a few vertices across ground that is flat until 96
   * and interpolate to exactly what they interpolated to before. */
  const inner = [0, 16, 24, 30, 36, 42, 48, 66, 96];
  const outer = [130, 170, 215, 265, 320, GROUND_HALF_WIDTH];
  const half = [...inner, ...outer];
  return [...half.slice(1).reverse().map((x) => -x), ...half];
})();

/**
 * The sea, on the seaward side of a coastal road.
 *
 * Columns start inboard of the waterline — under the sand, where the beach is
 * still above `SEA_HEIGHT` and hides them — and run far enough out that the
 * water meets the sky rather than ending in a visible edge. At a chase
 * camera's height the horizon is a long way off, and a sea that stops short
 * reads as a swimming pool. Starting the plane under the beach rather than at
 * the waterline is what lets the shoreline be a curve the ground decides
 * rather than a lateral this array has to agree with. Spacing widens with
 * distance because nothing out there needs resolution; what it needs is to
 * still be there.
 *
 * Flat, with no relief function, because that is what water is. The ground
 * beside it keeps its relief, so the join reads as a shoreline rather than as
 * two planes meeting.
 */
const SEA_COLUMNS: readonly number[] = [
  20, 30, 42, 58, 80, 112, 160, 240, 360, 560, 880, 1350, 1900,
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
 * rather than solved: the beach reaches -9 over 22 units from `SHORE_INNER`,
 * and -2.4 of that fall lands around 32 out, plus the swell's amplitude.
 */
export const SHORELINE_LATERAL = 38;

/**
 * Furthest out anything may stand and still be on sand the water never covers.
 *
 * Solved here, against **this mesh**, because that is the only place the
 * question has an answer. The beach profile is a smoothstep; the ground that
 * draws it is a triangle strip sampling that smoothstep at `GROUND_COLUMNS`
 * and interpolating linearly between them, and a chord across a convex curve
 * lies below it. So the drawn sand near the top of the ramp sits lower than
 * `groundReliefAt` reports, the water covers ground the function calls dry,
 * and anything culled against the function keeps its feet wet.
 *
 * That cost three captures to find. Each one tightened a margin on a sampled
 * test, the number moved, and the boulders stayed exactly where they were —
 * because the test and the picture were reading two different surfaces. This
 * reads the surface the picture reads: the same columns, the same linear
 * interpolation, against the swell at its trough.
 */
export const BEACH_DRY_LIMIT = (() => {
  const columns = GROUND_COLUMNS.filter((c) => c >= 0);
  for (let i = 0; i < columns.length - 1; i++) {
    const a = columns[i];
    const b = columns[i + 1];
    if (b <= SHORE_SPAN[0]) continue;
    const ha = shoreLowestAt(a);
    const hb = shoreLowestAt(b);
    if (hb > SEA_HEIGHT) continue;
    // This span straddles the waterline: find the crossing along the chord.
    const t = (SEA_HEIGHT - ha) / (hb - ha);
    return a + (b - a) * Math.max(0, t);
  }
  return SHORE_SPAN[1];
})();

/**
 * Per-vertex colour across the sea, shallow inshore to deep offshore.
 *
 * The single flat teal the water used to be is the colour of *deep* water, and
 * the reference's sea is not deep — the thing that makes it read as a tropical
 * coast is the band of bright turquoise in the shallows, where the bottom is
 * close enough to throw light back up. One colour cannot say that, and it was
 * the largest area of the frame saying the wrong thing.
 *
 * Keyed on the column's lateral offset and nothing else, so the attribute is
 * built once and survives every recycle: a strip rewrites its positions when it
 * moves to a new stretch of road, and its columns never change.
 */
function seaDepthColours(columns: readonly number[], rows: number): THREE.BufferAttribute {
  // Shallows over pale sand, and open water well out.
  const shallow = new THREE.Color(0x3fd0c4);
  const mid = new THREE.Color(0x1f9fb8);
  const deep = new THREE.Color(0x14607f);
  const c = new THREE.Color();

  const data = new Float32Array(columns.length * (rows + 1) * 3);
  let i = 0;
  for (let r = 0; r <= rows; r++) {
    for (const lateral of columns) {
      /* Two stops rather than one ramp. Shallow water shelves quickly and then
       * the floor drops away, so a single linear fade across nineteen hundred
       * units puts the turquoise nowhere near the beach where it belongs. */
      const near = THREE.MathUtils.clamp((lateral - 20) / 70, 0, 1);
      const far = THREE.MathUtils.clamp((lateral - 90) / 320, 0, 1);
      c.copy(shallow).lerp(mid, near).lerp(deep, far);
      data[i++] = c.r;
      data[i++] = c.g;
      data[i++] = c.b;
    }
  }
  return new THREE.BufferAttribute(data, 3);
}

/** Height of the kerb face, and of the pavement it steps up to. */
const KERB_HEIGHT = 0.15;
const KERB_WIDTH = 0.3;
const PAVEMENT_HEIGHT = 0.16;
/** Width of the pavement behind the kerb, before it drops to the ground. */
const PAVEMENT_WIDTH = 4.6;

/**
 * The road's cross-section, one side of the road to the other.
 *
 * Carriageway and gutter at deck height, a kerb face up to the pavement, the
 * pavement, and a drop down to the ground beyond. Points are doubled at each
 * crease — the foot and nose of the kerb, the pavement's outer edge — so the
 * normals there are sharp; a kerb with averaged normals is a ramp.
 */
function roadSection(): SectionPoint[] {
  const kerb = ROAD.halfWidth + ROAD.shoulderWidth;
  const outer = kerb + KERB_WIDTH + PAVEMENT_WIDTH;
  const right: Array<[number, number]> = [
    [ROAD.halfWidth, 0],
    [kerb, 0],
    [kerb, 0],
    [kerb, KERB_HEIGHT - 0.02],
    [kerb + 0.025, KERB_HEIGHT + 0.005],
    [kerb + 0.06, PAVEMENT_HEIGHT],
    [outer, PAVEMENT_HEIGHT],
    [outer, PAVEMENT_HEIGHT],
    [outer + 0.12, -0.12],
  ];
  const left = [...right].reverse().map(([l, h]): [number, number] => [-l, h]);
  return [...left, [0, 0] as [number, number], ...right].map(([lateral, height]) => ({ lateral, height }));
}

export class RoadManager implements Manager {
  readonly name = 'road';

  private readonly segments: Segment[] = [];
  private readonly root = new THREE.Group();
  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  /** The one material every road surface is drawn with. */
  private surfaceMat!: RoadSurfaceMaterial;
  private unsubscribeNight: (() => void) | null = null;

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
  private seaMat!: SeaMaterial;
  private readonly seaMeshes: THREE.Mesh[] = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    this.ctx.scene.add(this.root);

    const L = ROAD.segmentLength;
    const hw = ROAD.halfWidth;
    const sw = ROAD.shoulderWidth;

    this.surfaceMat = new RoadSurfaceMaterial({
      halfWidth: hw,
      laneWidth: ROAD.laneWidth,
      laneCount: ROAD.laneCount,
      kerb: hw + sw,
      kerbWidth: KERB_WIDTH,
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
    /* Vertex-coloured, so the water has a depth gradient rather than one flat
     * tone. See `seaDepthColours`. */
    this.seaMat = new SeaMaterial();

    this.groundMat = new THREE.MeshStandardMaterial({
      map: groundTex, color: 0x4a5240, roughness: 0.96,
    });
    this.materials.push(this.surfaceMat, this.groundMat, this.seaMat);
    this.unsubscribeNight = onNight((level) => this.surfaceMat.setNight(level));
    const section = roadSection();

    for (let i = 0; i < ROAD.segmentCount; i++) {
      const group = new THREE.Group();
      const strips: RoadStrip[] = [];

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
      // Carries road coordinates, so its waves are anchored to the water and
      // stream past the car rather than riding along with it.
      const sea = new RoadStrip(SEA_COLUMNS.map((lateral) => ({ lateral, height: SEA_HEIGHT })), L, ROWS, undefined, true);
      sea.geometry.setAttribute('color', seaDepthColours(SEA_COLUMNS, ROWS));
      const seaMesh = new THREE.Mesh(sea.geometry, this.seaMat);
      seaMesh.receiveShadow = false;
      group.add(seaMesh);
      strips.push(sea);
      this.seaMeshes.push(seaMesh);

      /* Carriageway, gutters, kerbs and pavements: one strip, one material,
       * one draw call. The shader draws each part from its road coordinates,
       * so the section needs vertices only where the surface bends. */
      const road = new RoadStrip(section, L, ROWS, undefined, true);
      const roadMesh = new THREE.Mesh(road.geometry, this.surfaceMat);
      roadMesh.receiveShadow = true;
      group.add(roadMesh);
      strips.push(road);
      const segment: Segment = {
        group, strips, road, sea: seaMesh, startDistance: Number.NaN, lamps: false, verge: 0,
      };

      this.root.add(group);
      this.segments.push(segment);
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

  /** How rough the sea is: a gentle chop by day, heavier in bad weather. */
  setSeaChop(chop: number): void {
    this.seaMat.setChop(chop);
  }

  /** How wet the road surface is, 0 dry to 1 standing water. */
  setWetness(wet: number): void {
    this.surfaceMat.setWetness(wet);
  }

  setGroundColour(hex: number, roughness: number): void {
    this.groundMat.color.setHex(hex);
    this.groundMat.roughness = roughness;
  }

  update(dt: number, speed: number): void {
    this.distance += speed * dt;
    this.seaMat.advance(dt);
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
        // Towns have lamps and paving; the desert a sand verge, the country grass.
        const biome = biomeAt(start + ROAD.segmentLength * 0.5);
        seg.lamps = biome === 'coast' || biome === 'city';
        seg.verge = biome === 'desert' ? 1 : biome === 'forest' ? 2 : 0;
        seg.road.setTag(RoadSurfaceMaterial.segmentTag(seg.lamps, seg.verge));
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
    this.unsubscribeNight?.();
    this.ctx.scene.remove(this.root);
    for (const t of this.textures) t.dispose();
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const seg of this.segments) {
      for (const s of seg.strips) s.dispose();
    }
    this.segments.length = 0;
  }
}
