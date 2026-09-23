import * as THREE from 'three';
import type { PowerupId } from '@/core/GameEvents';
import { POWERUP_IDS, POWERUP_INFO } from '@/game/config/Powerups';

/**
 * Power-ups as they stand on the road.
 *
 * Each is a token of four parts. The emblem is the silhouette that says what
 * it is. A halo ring turns round it, a beacon of light rises from it so it can
 * be seen and chosen two hundred metres out, and a pool of its colour lies on
 * the tarmac underneath, tying it to a lane.
 *
 * The first version was the emblem alone, in one flat emissive colour, tumbling
 * end over end. That read at distance as a pastel blob, and the tumble spent
 * most of every second showing each shape edge-on, which is exactly the view
 * that loses the silhouette the shape was chosen for. The emblem now stands
 * upright facing the car and sways; the halo and beacon carry the motion.
 */

/**
 * How wide an emblem stands. Normalised across the five so none is harder to
 * see than another; well inside the 3.8-unit collection trigger either way.
 */
const EMBLEM_SPAN = 2.0;
/** Emblem height above the road: half the span plus daylight, near windscreen height. */
const HOVER = 1.35;
const BEACON_HEIGHT = 11;

/**
 * Scale a geometry so its largest dimension is exactly `span`, applied to the
 * geometry so a shared body can be swapped in without a per-kind scale.
 */
export function fitSpan(geo: THREE.BufferGeometry, span: number): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const b = geo.boundingBox as THREE.Box3;
  const widest = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  if (widest > 0) geo.scale(span / widest, span / widest, span / widest);
  geo.computeBoundingSphere();
  return geo;
}

function lathe(profile: ReadonlyArray<readonly [number, number]>, segments: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segments);
  g.computeVertexNormals();
  return g;
}

/**
 * The silhouette of each power-up, facing +z — towards a car approaching it.
 *
 * Shapes that mean their effect at any size: a shield, a gas bottle, a
 * horseshoe magnet, a sheet ghost, an hourglass.
 */
function emblemGeometry(id: PowerupId): THREE.BufferGeometry {
  switch (id) {
    // A buckler, turned to face the driver: domed face, thick rolled rim.
    case 'shield': {
      const g = lathe([
        [0.0, -0.17], [0.3, -0.15], [0.5, -0.09], [0.58, 0.0],
        [0.5, 0.12], [0.3, 0.21], [0.0, 0.25],
      ], 32);
      g.rotateX(Math.PI / 2);
      return g;
    }
    // A gas bottle: cylindrical body, domed shoulder, a stub of a valve.
    case 'nitro':
      return lathe([
        [0.0, -0.52], [0.3, -0.52], [0.34, -0.46], [0.34, 0.22],
        [0.3, 0.38], [0.2, 0.46], [0.09, 0.5], [0.09, 0.62], [0.0, 0.62],
      ], 28);
    // A horseshoe, arch up and poles down, as a magnet is drawn.
    case 'magnet':
      return new THREE.TorusGeometry(0.4, 0.15, 14, 28, Math.PI);
    // A bed-sheet ghost: round head and a skirt that flares and stops open.
    case 'ghost':
      return lathe([
        [0.0, 0.52], [0.22, 0.48], [0.34, 0.34], [0.38, 0.1],
        [0.4, -0.14], [0.46, -0.34], [0.42, -0.4], [0.3, -0.36], [0.0, -0.34],
      ], 28);
    // An hourglass: the one object that means "time" at any size.
    case 'slowmo':
    default:
      return lathe([
        [0.0, -0.5], [0.38, -0.5], [0.38, -0.42], [0.14, -0.3],
        [0.05, 0.0], [0.14, 0.3], [0.38, 0.42], [0.38, 0.5], [0.0, 0.5],
      ], 24);
  }
}

/** Parts of an emblem in bright metal: a magnet's poles. Null for the rest. */
function detailGeometry(id: PowerupId, emblem: THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (id !== 'magnet') return null;
  emblem.computeBoundingBox();
  const b = emblem.boundingBox as THREE.Box3;
  const w = b.max.x - b.min.x;
  // The emblem has been scaled to its span; the poles sit on its two feet.
  const tube = w * 0.19;
  const pole = new THREE.CylinderGeometry(tube, tube, tube * 1.4, 20);
  const left = pole.clone().translate(b.min.x + tube, b.min.y - tube * 0.55, 0);
  const right = pole.clone().translate(b.max.x - tube, b.min.y - tube * 0.55, 0);
  pole.dispose();
  const merged = mergeTwo(left, right);
  left.dispose();
  right.dispose();
  return merged;
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const pa = a.getAttribute(name).array as Float32Array;
    const pb = b.getAttribute(name).array as Float32Array;
    const all = new Float32Array(pa.length + pb.length);
    all.set(pa);
    all.set(pb, pa.length);
    out.setAttribute(name, new THREE.BufferAttribute(all, name === 'uv' ? 2 : 3));
  }
  const ia = Array.from((a.getIndex() as THREE.BufferAttribute).array);
  const offset = a.getAttribute('position').count;
  const ib = Array.from((b.getIndex() as THREE.BufferAttribute).array).map((i) => i + offset);
  out.setIndex([...ia, ...ib]);
  return out;
}

/* ---------------------------------------------------------------- beacon */

const BEACON_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewV;
varying float vNear;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewV = -mv.xyz;
  // Gone by the time it is beside the camera, or it washes over the frame.
  vNear = smoothstep(5.0, 16.0, -mv.z);
  vNormalV = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}
`;

// A shaft of light rising out of the token: brightest through its middle,
// where the eye looks through the most of it, thinning to nothing at the top
// and the edges. It starts above the emblem, not behind it — light passing in
// front of the emblem bleached it to a pastel.
const BEACON_FRAG = /* glsl */ `
uniform vec3 uColour;
uniform float uTime;
uniform float uStart;
varying float vNear;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
  float body = pow(facing, 2.2);
  // Clamped: at the top edge 1 - v can land a hair below zero, and pow of a
  // negative base is NaN, which the bloom smeared into black and white blots.
  float rise = pow(max(1.0 - vUv.y, 0.0), 1.6) * smoothstep(uStart, uStart + 0.12, vUv.y);
  // Bands of light running up the column, so it reads as live, not painted.
  float bands = 0.75 + 0.25 * sin(vUv.y * 38.0 - uTime * 5.0);
  gl_FragColor = vec4(uColour * 1.6, body * rise * bands * 0.55 * vNear);
}
`;

/* ------------------------------------------------------------------ token */

interface KindResources {
  readonly emblem: THREE.BufferGeometry;
  readonly emblemMaterial: THREE.MeshPhysicalMaterial;
  readonly detail: THREE.BufferGeometry | null;
  readonly halo: THREE.MeshBasicMaterial;
  readonly beacon: THREE.ShaderMaterial;
  readonly pool: THREE.MeshBasicMaterial;
}

/** One power-up on the road: emblem, halo, beacon, pool of light. */
export class PowerupToken {
  readonly group = new THREE.Group();
  private readonly emblem: THREE.Mesh;
  private readonly detail: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly beacon: THREE.Mesh;
  private readonly pool: THREE.Mesh;
  private phase = 0;

  constructor(shared: TokenShared) {
    this.emblem = new THREE.Mesh();
    this.emblem.castShadow = true;
    this.detail = new THREE.Mesh(undefined, shared.chrome);
    this.emblem.add(this.detail);
    this.halo = new THREE.Mesh(shared.haloGeometry);
    this.beacon = new THREE.Mesh(shared.beaconGeometry);
    this.beacon.renderOrder = 5;
    this.pool = new THREE.Mesh(shared.poolGeometry);
    this.pool.renderOrder = 1;
    this.group.add(this.emblem, this.halo, this.beacon, this.pool);
    this.group.visible = false;
  }

  dress(kind: KindResources, phase: number): void {
    this.emblem.geometry = kind.emblem;
    this.emblem.material = kind.emblemMaterial;
    this.detail.visible = kind.detail !== null;
    if (kind.detail) this.detail.geometry = kind.detail;
    this.halo.material = kind.halo;
    this.beacon.material = kind.beacon;
    this.pool.material = kind.pool;
    this.phase = phase;
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  /** Stand on the road at `ground`, swaying and turning with `time`. */
  place(ground: THREE.Vector3, time: number): void {
    const t = time + this.phase;
    this.group.position.copy(ground);
    this.emblem.position.set(0, HOVER + Math.sin(t * 2.2) * 0.12, 0);
    // Sways to show it is solid, but never turns edge-on.
    this.emblem.rotation.set(0, Math.sin(t * 1.5) * 0.55, 0);
    this.halo.position.set(0, HOVER, 0);
    this.halo.rotation.set(0.38 * Math.sin(t * 0.9), t * 1.8, 0.25);
  }

  /** Where the emblem is, for the collection burst. */
  get emblemWorld(): THREE.Vector3 {
    return this.emblem.getWorldPosition(new THREE.Vector3());
  }
}

/** Geometry and materials every token shares, built once. */
class TokenShared {
  readonly haloGeometry: THREE.TorusGeometry;
  readonly beaconGeometry: THREE.CylinderGeometry;
  readonly poolGeometry: THREE.PlaneGeometry;
  readonly chrome: THREE.MeshStandardMaterial;

  constructor(readonly glow: THREE.Texture) {
    this.haloGeometry = new THREE.TorusGeometry(1.35, 0.045, 8, 64);
    this.haloGeometry.rotateX(Math.PI / 2);
    this.beaconGeometry = new THREE.CylinderGeometry(0.42, 0.75, BEACON_HEIGHT, 24, 1, true);
    this.beaconGeometry.translate(0, BEACON_HEIGHT / 2, 0);
    this.poolGeometry = new THREE.PlaneGeometry(5, 5);
    this.poolGeometry.rotateX(-Math.PI / 2);
    this.poolGeometry.translate(0, 0.04, 0);
    this.chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 1, roughness: 0.12, envMapIntensity: 2 });
  }

  dispose(): void {
    this.haloGeometry.dispose();
    this.beaconGeometry.dispose();
    this.poolGeometry.dispose();
    this.chrome.dispose();
  }
}

/** A pool of tokens and the per-kind looks they are dressed in. */
export class PowerupTokens {
  readonly root = new THREE.Group();
  private readonly shared: TokenShared;
  private readonly kinds = new Map<PowerupId, KindResources>();
  private readonly free: PowerupToken[] = [];
  private readonly all: PowerupToken[] = [];
  private time = 0;
  private dressed = 0;

  constructor(glow: THREE.Texture, capacity = 8) {
    this.shared = new TokenShared(glow);
    for (const id of POWERUP_IDS) this.kinds.set(id, this.buildKind(id));
    for (let i = 0; i < capacity; i++) {
      const token = new PowerupToken(this.shared);
      this.root.add(token.group);
      this.all.push(token);
      this.free.push(token);
    }
  }

  private buildKind(id: PowerupId): KindResources {
    const colour = new THREE.Color(POWERUP_INFO[id].colour);
    const emblem = fitSpan(emblemGeometry(id), EMBLEM_SPAN);
    // Glossy candy: a deep version of its colour under a clear lacquer that
    // catches the sky, lit from within enough to glow at dusk. A pale base with
    // a strong glow went pastel through the tone curve.
    const emblemMaterial = new THREE.MeshPhysicalMaterial({
      color: colour.clone().multiplyScalar(0.6),
      emissive: colour,
      emissiveIntensity: 0.42,
      roughness: 0.22,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.6,
    });
    // Brighter than white so the bloom picks the ring out.
    const halo = new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(2.4) });
    const beacon = new THREE.ShaderMaterial({
      uniforms: {
        uColour: { value: colour.clone() },
        uTime: { value: 0 },
        // Where the shaft begins, as a share of its height: the top of the emblem.
        uStart: { value: (HOVER + EMBLEM_SPAN * 0.5) / BEACON_HEIGHT },
      },
      vertexShader: BEACON_VERT,
      fragmentShader: BEACON_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const pool = new THREE.MeshBasicMaterial({
      map: this.shared.glow,
      color: colour,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return { emblem, emblemMaterial, detail: detailGeometry(id, emblem), halo, beacon, pool };
  }

  /** A token dressed as `id`, or null when every token is out. */
  acquire(id: PowerupId): PowerupToken | null {
    const token = this.free.pop();
    if (!token) return null;
    token.dress(this.kinds.get(id) as KindResources, (this.dressed++ * 1.7) % 6.28);
    return token;
  }

  release(token: PowerupToken): void {
    token.hide();
    if (!this.free.includes(token)) this.free.push(token);
  }

  releaseAll(): void {
    for (const token of this.all) this.release(token);
  }

  /** Advance the shared animation clock. */
  update(dt: number): void {
    this.time += dt;
    for (const kind of this.kinds.values()) kind.beacon.uniforms.uTime.value = this.time;
  }

  get clock(): number {
    return this.time;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const kind of this.kinds.values()) {
      kind.emblem.dispose();
      kind.detail?.dispose();
      kind.emblemMaterial.dispose();
      kind.halo.dispose();
      kind.beacon.dispose();
      kind.pool.dispose();
    }
    this.shared.dispose();
  }
}
