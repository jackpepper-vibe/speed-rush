import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import type { PickupId } from '@/core/GameEvents';
import { PICKUPS, ROAD } from '@/game/config/Balance';
import { POWERUP_IDS } from '@/game/config/Powerups';
import { fitSpan, PowerupTokens, type PowerupToken } from '@/game/render/pickups/PowerupTokens';
import { makeGlowTexture } from '@/game/render/RoadTextures';
import type { RoadManager } from './RoadManager';
import type { PlayerManager } from './PlayerManager';
import type { PowerupManager } from './PowerupManager';

/**
 * Coins, gems and power-ups.
 *
 * Coins are laid in runs along a lane rather than scattered, because a line of
 * them is an instruction: it tells the player where the designer thinks the
 * good line is, and following it into a gap in traffic is the most satisfying
 * thing an endless racer can ask of you. Gems and crates are placed singly.
 *
 * Everything is pooled and hidden rather than destroyed, and the whole set is
 * driven from one flat array — a run collects thousands of these and a
 * per-pickup allocation is felt.
 */
interface Pickup {
  /** The body of a coin or a gem; hidden while this entry is a power-up. */
  mesh: THREE.Mesh;
  /** The token standing for a power-up; null for coins and gems. */
  token: PowerupToken | null;
  kind: PickupId;
  active: boolean;
  /** Absolute distance along the road. */
  distance: number;
  /** Road-space lateral position. Mutated by the magnet. */
  x: number;
  magnetised: boolean;
  spin: number;
}

/** The gem sits between a coin and a power-up, and is sized between them. */
const GEM_SPAN = 1.5;

/**
 * A struck coin: domed faces, a rounded rim, standing on edge.
 *
 * Lathed rather than extruded. A cylinder gives two flat faces meeting the edge
 * at a right angle, and a right angle under a directional light is one hard
 * line and two flat fields — which is why the first version read as a sticker.
 * The profile here rises to a dome, steps down to a raised rim and rolls over
 * the edge, so the same coin shows a highlight sweeping across it as it turns.
 */
function makeCoinGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.0, 0.058),
    new THREE.Vector2(0.14, 0.062),
    new THREE.Vector2(0.24, 0.056),
    new THREE.Vector2(0.29, 0.036),
    new THREE.Vector2(0.30, 0.052),
    new THREE.Vector2(0.335, 0.048),
    new THREE.Vector2(0.355, 0.026),
    new THREE.Vector2(0.36, 0.0),
    new THREE.Vector2(0.355, -0.026),
    new THREE.Vector2(0.335, -0.048),
    new THREE.Vector2(0.30, -0.052),
    new THREE.Vector2(0.29, -0.036),
    new THREE.Vector2(0.24, -0.056),
    new THREE.Vector2(0.14, -0.062),
    new THREE.Vector2(0.0, -0.058),
  ];
  const g = new THREE.LatheGeometry(profile, 26);
  // Lathed about Y, then stood upright so the face points down the road and a
  // spin about Y flashes it edge-on once a turn.
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** A cut gem: a broad table over a deep pavilion, rather than a plain solid. */
function makeGemGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.0, 0.30),
    new THREE.Vector2(0.20, 0.26),
    new THREE.Vector2(0.34, 0.10),
    new THREE.Vector2(0.30, -0.04),
    new THREE.Vector2(0.16, -0.34),
    new THREE.Vector2(0.0, -0.44),
  ];
  // Eight segments: few enough that every facet is a facet.
  return fitSpan(new THREE.LatheGeometry(profile, 8), GEM_SPAN);
}

export class PickupManager implements Manager {
  readonly name = 'pickups';

  private readonly pool: Pickup[] = [];
  private readonly root = new THREE.Group();
  private readonly scratch = new THREE.Vector3();
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private glowTex!: THREE.Texture;
  private tokens!: PowerupTokens;

  private nextCoinDistance = 0;
  private nextPowerupDistance = 0;

  /**
   * Test seam: stops new pickups being laid without touching the ones already
   * out. A measurement of how a power-up expires cannot be made on a road that
   * keeps handing out fresh ones. Never off in play.
   */
  spawningEnabled = true;

  constructor(
    private readonly ctx: GameContext,
    private readonly road: RoadManager,
    private readonly player: PlayerManager,
    private readonly powerups: PowerupManager,
  ) {}

  init(): void {
    this.ctx.scene.add(this.root);
    this.glowTex = makeGlowTexture();
    this.tokens = new PowerupTokens(this.glowTex);
    this.ctx.scene.add(this.tokens.root);

    const coinGeo = makeCoinGeometry();
    const gemGeo = makeGemGeometry();
    this.geometries.push(coinGeo, gemGeo);

    /*
     * Struck gold, not a glowing sticker.
     *
     * The first coin was a flat cylinder with the emissive turned up, which at
     * any distance is a disc of uniform orange — there is no shading on it to
     * read, so it never looks like an object, and spinning it changes nothing
     * because both faces are identical and equally lit. The geometry now has a
     * domed face and a milled rim to catch the light, and the emissive is down
     * to a hint so that light is what you are actually seeing.
     */
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xffc21e,
      emissive: 0xa06000,
      emissiveIntensity: 0.18,
      metalness: 1,
      roughness: 0.24,
      envMapIntensity: 2.4,
    });
    const gemMat = new THREE.MeshStandardMaterial({
      color: 0x40f0ff,
      emissive: 0x1090b0,
      emissiveIntensity: 0.8,
      metalness: 0.3,
      roughness: 0.08,
      envMapIntensity: 2.6,
      // Faceted on purpose: a gem is the one shape that should show its facets
      // rather than have them smoothed into a blob.
      flatShading: true,
    });
    this.materials.push(coinMat, gemMat);

    // One pooled entry per pickup that can be live at once.
    for (let i = 0; i < 64; i++) {
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.pool.push({ mesh, token: null, kind: 'coin', active: false, distance: 0, x: 0, magnetised: false, spin: 0 });
    }

    this.coinGeo = coinGeo;
    this.coinMat = coinMat;
    this.gemGeo = gemGeo;
    this.gemMat = gemMat;
  }

  private coinGeo!: THREE.BufferGeometry;
  private coinMat!: THREE.Material;
  private gemGeo!: THREE.BufferGeometry;
  private gemMat!: THREE.Material;

  /** Live pickups in road space, for assertions and for the HUD. */
  snapshot(): { kind: PickupId; x: number; ahead: number; magnetised: boolean }[] {
    return this.pool
      .filter((p) => p.active)
      .map((p) => ({
        kind: p.kind,
        x: p.x,
        ahead: p.distance - this.road.travelled,
        magnetised: p.magnetised,
      }));
  }

  update(dt: number, _speed: number, distance: number): void {
    if (this.spawningEnabled) {
      this.layCoins(distance);
      this.layPowerups(distance);
    }

    this.tokens.update(dt);
    const magnetOn = this.powerups.isActive('magnet');
    for (const p of this.pool) {
      if (!p.active) continue;
      this.driftToPlayer(p, dt, magnetOn);
      this.place(p, dt);
      this.testCollect(p);
    }
  }

  /* ------------------------------------------------------------------ laying */

  private layCoins(distance: number): void {
    if (distance + ROAD.drawDistance < this.nextCoinDistance) return;
    this.nextCoinDistance = Math.max(this.nextCoinDistance, distance + ROAD.drawDistance) + PICKUPS.coinSpacing;

    const lane = this.ctx.rng.int(0, ROAD.laneCount - 1);
    const x = ROAD.laneX(lane);
    const start = this.nextCoinDistance;

    // A run of coins, occasionally with a gem at its end as a payoff.
    const length = PICKUPS.coinRunLength;
    for (let i = 0; i < length; i++) {
      const last = i === length - 1;
      const gem = last && this.ctx.rng.chance(PICKUPS.gemChance);
      this.take(gem ? 'gem' : 'coin', start + i * PICKUPS.coinRunGap, x);
    }
  }

  private layPowerups(distance: number): void {
    if (distance + ROAD.drawDistance < this.nextPowerupDistance) return;
    this.nextPowerupDistance =
      Math.max(this.nextPowerupDistance, distance + ROAD.drawDistance) + PICKUPS.powerupSpacing;

    const id = this.ctx.rng.pick(POWERUP_IDS);
    const lane = this.ctx.rng.int(0, ROAD.laneCount - 1);
    this.take(id, this.nextPowerupDistance, ROAD.laneX(lane));
  }

  /**
   * Test seam: lay one pickup of a named kind at a chosen place.
   *
   * Power-ups arrive once every 240 units at a random lane in a random kind, so
   * looking at all five means a long drive and a lot of luck — and comparing
   * one silhouette against another means comparing two screenshots taken
   * minutes apart under different light. This lays them side by side in one
   * frame. Never used in play; `spawningEnabled` governs what the road hands
   * out.
   *
   * @param kind which pickup to place
   * @param x road-space lateral position
   * @param ahead distance in front of the car
   */
  layPickup(kind: PickupId, x: number, ahead: number): boolean {
    return this.take(kind, this.road.travelled + ahead, x) !== null;
  }

  /** Claim a pooled entry and dress it as `kind`. */
  private take(kind: PickupId, distance: number, x: number): Pickup | null {
    const p = this.pool.find((e) => !e.active);
    if (!p) return null;

    if (kind === 'coin' || kind === 'gem') {
      p.mesh.geometry = kind === 'coin' ? this.coinGeo : this.gemGeo;
      p.mesh.material = kind === 'coin' ? this.coinMat : this.gemMat;
      p.mesh.visible = true;
    } else {
      const token = this.tokens.acquire(kind);
      if (!token) return null;
      p.token = token;
    }

    p.active = true;
    p.kind = kind;
    p.distance = distance;
    p.x = x;
    p.magnetised = false;
    p.spin = 0;
    return p;
  }

  /* ------------------------------------------------------------------ magnet */

  /**
   * Pull a pickup toward the player while the magnet is up.
   *
   * Both axes are pulled, not just the lateral one. A magnet that only slides
   * coins sideways still needs you to drive over them, which is most of the
   * work; pulling them forward as well is what makes the effect read.
   */
  private driftToPlayer(p: Pickup, dt: number, magnetOn: boolean): void {
    if (!magnetOn) return;
    const ahead = p.distance - this.road.travelled;
    const dx = this.player.x - p.x;
    const range = Math.hypot(dx, ahead);
    if (range > PICKUPS.magnetRadius || range < 1e-4) return;

    if (!p.magnetised) {
      p.magnetised = true;
      this.ctx.bus.emit('pickup:magnetised', { kind: p.kind, distance: range });
    }

    const pull = (PICKUPS.magnetForce * dt) / range;
    p.x += dx * pull;
    p.distance -= ahead * pull;
  }

  private place(p: Pickup, dt: number): void {
    const ahead = p.distance - this.road.travelled;
    this.road.worldOffset(ahead, this.scratch);
    /* High enough that the body clears the tarmac.
     *
     * This is a consequence of `POWERUP_SPAN`, not a taste call: a two-unit
     * body centred at 1.0 has its underside exactly on the road, where it
     * z-fights the surface and loses its lower half to the contact. Half the
     * span plus a little daylight is the floor, and a power-up sitting at
     * roughly windscreen height is also the one a driver is looking at.
     */
    if (p.token) {
      this.scratch.x += p.x;
      p.token.place(this.scratch, this.tokens.clock);
      return;
    }
    const hover = p.kind === 'coin' ? 1.15 : 1.2;
    p.spin += dt * (p.kind === 'coin' ? 3.4 : 1.6);
    p.mesh.position.set(this.scratch.x + p.x, this.scratch.y + hover, this.scratch.z);
    p.mesh.rotation.y = p.spin;
    if (p.kind === 'gem') p.mesh.rotation.x = p.spin * 0.6;
    else p.mesh.rotation.z = 0.22;
  }

  private testCollect(p: Pickup): void {
    const ahead = p.distance - this.road.travelled;

    // Past the car and gone.
    if (ahead < -12) {
      this.release(p);
      return;
    }

    const dx = Math.abs(p.x - this.player.x);
    if (dx > PICKUPS.collectRadius || Math.abs(ahead) > PICKUPS.collectRadius + 1.6) return;

    const position = p.token ? p.token.emblemWorld : p.mesh.position.clone();
    this.release(p);

    const value =
      p.kind === 'coin' ? PICKUPS.coinValue : p.kind === 'gem' ? PICKUPS.gemValue : 0;
    this.ctx.bus.emit('pickup:collect', { kind: p.kind, value, position });

    if (p.kind !== 'coin' && p.kind !== 'gem') {
      this.powerups.activate(p.kind);
    }
  }

  /** Return an entry to the pool, and its token if it had one. */
  private release(p: Pickup): void {
    p.active = false;
    p.mesh.visible = false;
    if (p.token) {
      this.tokens.release(p.token);
      p.token = null;
    }
  }

  reset(): void {
    for (const p of this.pool) this.release(p);
    this.nextCoinDistance = 0;
    this.nextPowerupDistance = PICKUPS.powerupSpacing * 0.5;
  }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.tokens.dispose();
    this.glowTex.dispose();
    this.pool.length = 0;
  }
}
