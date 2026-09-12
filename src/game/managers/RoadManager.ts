import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import { ROAD } from '@/game/config/Balance';
import { curveAt, hillAt } from '@/game/world/RoadGeometry';
import { RoadStrip } from '@/game/world/RoadStrip';
import { makeRoadTexture, makeShoulderTexture } from '@/game/render/RoadTextures';

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
interface Segment {
  readonly group: THREE.Group;
  readonly strips: RoadStrip[];
  /** The tarmac specifically, named rather than found by position in `strips`. */
  road: RoadStrip;
  startDistance: number;
}

/** Vertex rows per segment. Six is enough that the bend reads as smooth. */
const ROWS = 6;

/** How far the ground reaches either side of the centreline. */
const GROUND_HALF_WIDTH = 420;

export class RoadManager implements Manager {
  readonly name = 'road';

  private readonly segments: Segment[] = [];
  private readonly root = new THREE.Group();
  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];

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

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    this.ctx.scene.add(this.root);

    const L = ROAD.segmentLength;
    const hw = ROAD.halfWidth;
    const sw = ROAD.shoulderWidth;

    const roadTex = makeRoadTexture(ROAD.laneCount, 1);
    const shoulderTex = makeShoulderTexture();
    this.textures.push(roadTex, shoulderTex);

    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.86 });
    const shoulderMat = new THREE.MeshStandardMaterial({ map: shoulderTex, roughness: 0.9 });
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0xb8bcc4,
      roughness: 0.42,
      metalness: 0.7,
      side: THREE.DoubleSide,
    });
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 0.96 });
    this.materials.push(roadMat, shoulderMat, barrierMat, this.groundMat);

    for (let i = 0; i < ROAD.segmentCount; i++) {
      const group = new THREE.Group();
      const strips: RoadStrip[] = [];

      // Ground first, dropped below the deck so the tarmac wins the depth test.
      const ground = new RoadStrip([-GROUND_HALF_WIDTH, GROUND_HALF_WIDTH], L, ROWS, -0.06);
      const groundMesh = new THREE.Mesh(ground.geometry, this.groundMat);
      groundMesh.receiveShadow = true;
      group.add(groundMesh);
      strips.push(ground);

      // Tarmac: columns at the lane boundaries so the texture stretches evenly.
      const laneCols: number[] = [];
      for (let c = 0; c <= ROAD.laneCount; c++) laneCols.push(-hw + c * ROAD.laneWidth);
      const road = new RoadStrip(laneCols, L, ROWS);
      const roadMesh = new THREE.Mesh(road.geometry, roadMat);
      roadMesh.receiveShadow = true;
      group.add(roadMesh);
      strips.push(road);

      for (const side of [-1, 1] as const) {
        const shoulder = new RoadStrip(
          side < 0 ? [-hw - sw, -hw] : [hw, hw + sw],
          L,
          ROWS,
          0.01,
        );
        const shoulderMesh = new THREE.Mesh(shoulder.geometry, shoulderMat);
        shoulderMesh.receiveShadow = true;
        group.add(shoulderMesh);
        strips.push(shoulder);

        // Barrier: a vertical wall raised off the deck, bent along the same rows.
        const barrier = new RoadStrip([side * (hw + sw)], L, ROWS, 0.45, 0.62);
        const barrierMesh = new THREE.Mesh(barrier.geometry, barrierMat);
        barrierMesh.castShadow = true;
        barrierMesh.receiveShadow = true;
        group.add(barrierMesh);
        strips.push(barrier);
      }

      this.root.add(group);
      this.segments.push({ group, strips, road, startDistance: Number.NaN });
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

  /** Tint the ground to the biome it runs through. */
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
    for (const seg of this.segments) for (const s of seg.strips) s.dispose();
    this.segments.length = 0;
  }
}
