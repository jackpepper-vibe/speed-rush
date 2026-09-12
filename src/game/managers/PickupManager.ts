import * as THREE from 'three';
import type { GameContext, Manager } from '@/core/Manager';
import type { PickupId, PowerupId } from '@/core/GameEvents';
import { PICKUPS, ROAD } from '@/game/config/Balance';
import { makeGlowTexture } from '@/game/render/RoadTextures';
import type { RoadManager } from './RoadManager';
import type { PlayerManager } from './PlayerManager';
import type { PowerupManager } from './PowerupManager';

/**
 * Coins, gems and power-up crates.
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
  mesh: THREE.Mesh;
  kind: PickupId;
  active: boolean;
  /** Absolute distance along the road. */
  distance: number;
  /** Road-space lateral position. Mutated by the magnet. */
  x: number;
  magnetised: boolean;
  spin: number;
}

const POWERUP_IDS: readonly PowerupId[] = ['shield', 'nitro', 'magnet', 'ghost', 'slowmo'];

const POWERUP_COLOR: Record<PowerupId, number> = {
  shield: 0x39c8ff,
  nitro: 0xff6a1a,
  magnet: 0xff44dd,
  ghost: 0xb98cff,
  slowmo: 0x6cf0a8,
};

export class PickupManager implements Manager {
  readonly name = 'pickups';

  private readonly pool: Pickup[] = [];
  private readonly root = new THREE.Group();
  private readonly scratch = new THREE.Vector3();
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private glowTex!: THREE.Texture;

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

    const coinGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.1, 18);
    coinGeo.rotateX(Math.PI / 2);
    const gemGeo = new THREE.OctahedronGeometry(0.6);
    const crateGeo = new THREE.BoxGeometry(1.15, 1.15, 1.15);
    this.geometries.push(coinGeo, gemGeo, crateGeo);

    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xffc21e, emissive: 0xc07800, emissiveIntensity: 0.7, metalness: 0.9, roughness: 0.22,
    });
    const gemMat = new THREE.MeshStandardMaterial({
      color: 0x40f0ff, emissive: 0x1090b0, emissiveIntensity: 1.1, metalness: 0.4, roughness: 0.1,
    });
    this.materials.push(coinMat, gemMat);

    // One pooled entry per pickup that can be live at once.
    for (let i = 0; i < 64; i++) {
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.pool.push({ mesh, kind: 'coin', active: false, distance: 0, x: 0, magnetised: false, spin: 0 });
    }

    // Distinct bodies for the kinds that are not coins, built once and swapped in.
    this.coinGeo = coinGeo;
    this.coinMat = coinMat;
    this.gemGeo = gemGeo;
    this.gemMat = gemMat;
    this.crateGeo = crateGeo;
    for (const id of POWERUP_IDS) {
      const mat = new THREE.MeshStandardMaterial({
        color: POWERUP_COLOR[id],
        emissive: POWERUP_COLOR[id],
        emissiveIntensity: 1.4,
        roughness: 0.3,
        metalness: 0.2,
      });
      this.crateMat.set(id, mat);
      this.materials.push(mat);
    }
  }

  private coinGeo!: THREE.BufferGeometry;
  private coinMat!: THREE.Material;
  private gemGeo!: THREE.BufferGeometry;
  private gemMat!: THREE.Material;
  private crateGeo!: THREE.BufferGeometry;
  private readonly crateMat = new Map<PowerupId, THREE.Material>();

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

  /** Claim a pooled entry and dress it as `kind`. */
  private take(kind: PickupId, distance: number, x: number): Pickup | null {
    const p = this.pool.find((e) => !e.active);
    if (!p) return null;

    p.active = true;
    p.kind = kind;
    p.distance = distance;
    p.x = x;
    p.magnetised = false;
    p.spin = 0;
    p.mesh.visible = true;

    if (kind === 'coin') {
      p.mesh.geometry = this.coinGeo;
      p.mesh.material = this.coinMat;
    } else if (kind === 'gem') {
      p.mesh.geometry = this.gemGeo;
      p.mesh.material = this.gemMat;
    } else {
      p.mesh.geometry = this.crateGeo;
      p.mesh.material = this.crateMat.get(kind)!;
    }
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
    const hover = p.kind === 'coin' || p.kind === 'gem' ? 1.15 : 1.0;
    p.spin += dt * (p.kind === 'coin' ? 3.4 : 1.6);
    p.mesh.position.set(this.scratch.x + p.x, this.scratch.y + hover, this.scratch.z);
    p.mesh.rotation.y = p.spin;
    if (p.kind !== 'coin') p.mesh.rotation.x = p.spin * 0.6;
  }

  private testCollect(p: Pickup): void {
    const ahead = p.distance - this.road.travelled;

    // Past the car and gone.
    if (ahead < -12) {
      p.active = false;
      p.mesh.visible = false;
      return;
    }

    const dx = Math.abs(p.x - this.player.x);
    if (dx > PICKUPS.collectRadius || Math.abs(ahead) > PICKUPS.collectRadius + 1.6) return;

    p.active = false;
    p.mesh.visible = false;

    const value =
      p.kind === 'coin' ? PICKUPS.coinValue : p.kind === 'gem' ? PICKUPS.gemValue : 0;
    this.ctx.bus.emit('pickup:collect', { kind: p.kind, value, position: p.mesh.position.clone() });

    if (p.kind !== 'coin' && p.kind !== 'gem') {
      this.powerups.activate(p.kind);
    }
  }

  reset(): void {
    for (const p of this.pool) {
      p.active = false;
      p.mesh.visible = false;
    }
    this.nextCoinDistance = 0;
    this.nextPowerupDistance = PICKUPS.powerupSpacing * 0.5;
  }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.glowTex.dispose();
    this.pool.length = 0;
  }
}
