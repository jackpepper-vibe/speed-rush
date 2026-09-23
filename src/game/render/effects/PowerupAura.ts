import * as THREE from 'three';
import type { Vehicle } from '../vehicles/VehicleFactory';

/**
 * What a running power-up looks like on the car.
 *
 * The HUD says what is running; this says so where the player is looking. A
 * shield is a bubble of light round the car, hexagons shimmering across it,
 * and it flares when it takes a hit. A ghost is a second, purple bubble with
 * wisps drifting up through it. A magnet is rings sweeping out across the road
 * to the edge of its pull, so the reach is something you can see. Each fades
 * in and out rather than switching, and flickers as it runs out.
 *
 * Nitro already has its flame, and slow-mo tints the whole frame — see the
 * HUD's veil — since it slows the world rather than changing the car.
 */

const BUBBLE_VERT = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewV = -mv.xyz;
  vNormalV = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}
`;

const BUBBLE_FRAG = /* glsl */ `
uniform vec3 uColour;
uniform float uStrength;
uniform float uFlash;
uniform float uTime;
uniform float uPattern;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;

// Distance to the nearest edge of a hexagonal cell, in cell units.
float hexEdge(vec2 p) {
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return 0.5 - max(dot(q, normalize(r)), q.x);
}

void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
  // Light gathers at the rim, where the eye looks through the most of the shell.
  // Clamped: facing can round a hair past 1, and pow of a negative is NaN.
  float rim = pow(max(1.0 - facing, 0.0), 2.4);
  vec3 d = normalize(vLocal);
  vec2 sphereUv = vec2(atan(d.x, d.z) * 1.6, d.y * 3.2);
  float pattern;
  if (uPattern < 0.5) {
    // Shield: a hexagon lattice with light running over it.
    float edge = 1.0 - smoothstep(0.0, 0.06, hexEdge(sphereUv * 3.0));
    float sweep = 0.5 + 0.5 * sin(sphereUv.y * 2.0 - uTime * 3.0 + sphereUv.x);
    pattern = edge * (0.35 + 0.65 * sweep);
  } else {
    // Ghost: soft wisps drifting upward.
    float w = sin(sphereUv.x * 3.0 + sin(sphereUv.y * 2.0 + uTime) * 1.4 - uTime * 0.6)
            * sin(sphereUv.y * 4.0 - uTime * 2.2);
    pattern = smoothstep(0.2, 1.0, w) * 0.8;
  }
  float a = uStrength * (rim * 0.85 + pattern * (0.25 + rim)) + uFlash * (0.35 + rim);
  gl_FragColor = vec4(uColour * (1.3 + uFlash * 2.0), clamp(a, 0.0, 1.0));
}
`;

class Bubble {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  strength = 0;

  constructor(geometry: THREE.BufferGeometry, colour: number, pattern: number) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColour: { value: new THREE.Color(colour) },
        uStrength: { value: 0 },
        uFlash: { value: 0 },
        uTime: { value: 0 },
        uPattern: { value: pattern },
      },
      vertexShader: BUBBLE_VERT,
      fragmentShader: BUBBLE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  /** Ease towards on or off, flickering in the last seconds. */
  update(dt: number, time: number, on: boolean, secondsLeft: number, flash: number): void {
    this.strength += ((on ? 1 : 0) - this.strength) * Math.min(1, dt * (on ? 8 : 4));
    const flicker = on && secondsLeft < ENDING_SECONDS ? 0.55 + 0.45 * Math.sign(Math.sin(time * 18)) : 1;
    const u = this.material.uniforms;
    u.uStrength.value = this.strength * flicker;
    u.uFlash.value = flash;
    u.uTime.value = time;
    this.mesh.visible = this.strength > 0.01 || flash > 0.01;
  }
}

/** Seconds left at which an aura starts to flicker, as the HUD card does. */
const ENDING_SECONDS = 2;
const MAGNET_RINGS = 3;
/** Seconds for one ring to sweep from the car to the edge of the pull. */
const SWEEP_SECONDS = 1.6;

export interface AuraState {
  shield: number;
  ghost: number;
  magnet: number;
}

export class PowerupAura {
  private readonly bubbleGeometry = new THREE.SphereGeometry(1, 48, 32);
  private readonly ringGeometry = new THREE.RingGeometry(0.93, 1, 96);
  private readonly shield: Bubble;
  private readonly ghost: Bubble;
  private readonly rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly ringRoot = new THREE.Group();
  private magnetStrength = 0;
  private flash = 0;
  private time = 0;

  constructor(shieldColour: number, ghostColour: number, magnetColour: number, private readonly magnetRadius: number) {
    this.shield = new Bubble(this.bubbleGeometry, shieldColour, 0);
    this.ghost = new Bubble(this.bubbleGeometry, ghostColour, 1);
    this.ringGeometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAGNET_RINGS; i++) {
      const ring = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({
        color: new THREE.Color(magnetColour).multiplyScalar(1.6),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
      ring.renderOrder = 2;
      this.rings.push(ring);
      this.ringRoot.add(ring);
    }
    this.ringRoot.position.y = 0.05;
    this.ringRoot.visible = false;
  }

  /**
   * Fit the bubbles round a vehicle and hang everything off it: the bubbles on
   * its frame, so they lean with a bike, and the rings on the car itself, flat
   * on the road.
   */
  attach(vehicle: Vehicle): void {
    const box = vehicle.body.geometry.boundingBox ?? new THREE.Box3().setFromObject(vehicle.body);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    for (const [bubble, grow] of [[this.shield, 1], [this.ghost, 1.07]] as const) {
      bubble.mesh.scale.set(size.x * 0.68 * grow, size.y * 0.78 * grow, size.z * 0.6 * grow);
      bubble.mesh.position.copy(centre);
      vehicle.frame.add(bubble.mesh);
    }
    vehicle.add(this.ringRoot);
  }

  /** The shield took a hit: flare. */
  hit(): void {
    this.flash = 1;
  }

  /** Seconds left on each effect, 0 when it is not running. */
  update(dt: number, state: AuraState): void {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.shield.update(dt, this.time, state.shield > 0, state.shield, this.flash);
    this.ghost.update(dt, this.time, state.ghost > 0, state.ghost, 0);

    const on = state.magnet > 0;
    this.magnetStrength += ((on ? 1 : 0) - this.magnetStrength) * Math.min(1, dt * (on ? 6 : 3));
    this.ringRoot.visible = this.magnetStrength > 0.01;
    if (!this.ringRoot.visible) return;
    const flicker = on && state.magnet < ENDING_SECONDS ? 0.5 + 0.5 * Math.sign(Math.sin(this.time * 18)) : 1;
    this.rings.forEach((ring, i) => {
      // Each ring sweeps out from the car to the edge of the pull and fades.
      const t = (this.time / SWEEP_SECONDS + i / MAGNET_RINGS) % 1;
      const r = 1.5 + t * (this.magnetRadius - 1.5);
      ring.scale.set(r, 1, r);
      ring.material.opacity = this.magnetStrength * flicker * Math.sin(t * Math.PI) * 0.55;
    });
  }

  dispose(): void {
    this.shield.mesh.removeFromParent();
    this.ghost.mesh.removeFromParent();
    this.ringRoot.removeFromParent();
    this.shield.material.dispose();
    this.ghost.material.dispose();
    for (const ring of this.rings) ring.material.dispose();
    this.bubbleGeometry.dispose();
    this.ringGeometry.dispose();
  }
}
