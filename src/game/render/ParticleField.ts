import * as THREE from 'three';

/**
 * A pooled point cloud: one draw call, however many particles are alive.
 *
 * Every effect in the game — sparks off a barrier, smoke off a locked wheel,
 * grit thrown up on landing — is the same shape of problem: a few hundred
 * short-lived, camera-facing, additively-lit sprites that must not allocate
 * while the game is running. Solving it once here means an effect is a call to
 * `emit` with a velocity and a lifetime, rather than another mesh pool.
 *
 * Two decisions are worth stating.
 *
 * The pool is compacted rather than swept. A dead particle is swapped with the
 * last live one and the live count drops, so the buffer's live prefix is always
 * dense and `setDrawRange` can hand the GPU exactly the particles that exist.
 * The alternative — leaving holes and drawing the whole capacity with dead
 * particles scaled to zero — still pays vertex cost for every slot ever
 * allocated, which for a capacity sized to a crash is most of them most of the
 * time.
 *
 * Size and colour are per-particle attributes rather than uniforms, which is
 * what makes one field able to serve smoke that grows and fades while sparks
 * shrink and cool. `PointsMaterial` cannot express that; it is a dozen lines of
 * shader here and saves a second draw call per effect.
 */

export interface ParticleFieldOptions {
  /** Hard ceiling on simultaneous particles. Buffers are sized to this once. */
  capacity: number;
  /** Sprite for every particle in the field. */
  map: THREE.Texture;
  blending?: THREE.Blending;
  /** Metres per second removed from velocity, proportionally, each second. */
  drag?: number;
  /** Downward acceleration, in metres per second squared. */
  gravity?: number;
}

export interface EmitOptions {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Seconds before the particle is recycled. */
  life: number;
  size: number;
  /** Multiplier applied to size across the particle's life. 1 holds it. */
  sizeGrowth?: number;
  colour: THREE.Color;
  /** Opacity at birth. Faded to zero across the life on an ease-out. */
  opacity?: number;
}

export class ParticleField {
  readonly points: THREE.Points;

  private readonly capacity: number;
  private readonly drag: number;
  private readonly gravity: number;

  /* Per-particle state, in structure-of-arrays form. The GPU wants the
   * position, size and colour buffers contiguous, and the simulation wants the
   * velocity and lifetime alongside them; interleaving into objects would mean
   * copying into the attribute buffers every frame instead of writing in
   * place. */
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly colours: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lives: Float32Array;
  private readonly baseSizes: Float32Array;
  private readonly growths: Float32Array;
  private readonly opacities: Float32Array;

  private live = 0;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(opts: ParticleFieldOptions) {
    this.capacity = opts.capacity;
    this.drag = opts.drag ?? 0;
    this.gravity = opts.gravity ?? 0;

    this.positions = new Float32Array(this.capacity * 3);
    this.colours = new Float32Array(this.capacity * 4);
    this.sizes = new Float32Array(this.capacity);
    this.velocities = new Float32Array(this.capacity * 3);
    this.ages = new Float32Array(this.capacity);
    this.lives = new Float32Array(this.capacity);
    this.baseSizes = new Float32Array(this.capacity);
    this.growths = new Float32Array(this.capacity);
    this.opacities = new Float32Array(this.capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColour', new THREE.BufferAttribute(this.colours, 4));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: opts.map } },
      transparent: true,
      depthWrite: false,
      blending: opts.blending ?? THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec4 aColour;
        varying vec4 vColour;
        void main() {
          vColour = aColour;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Perspective-correct: a puff of smoke has a size in metres, not in
          // pixels, and must shrink as the road carries it away.
          gl_PointSize = aSize * (420.0 / max(0.1, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec4 vColour;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColour.rgb, vColour.a) * t;
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    /*
     * Never culled.
     *
     * The bounding sphere three.js computes belongs to whatever was in the
     * buffer when the attribute was last uploaded, and these positions change
     * every frame in world space. A stale sphere culls the entire field the
     * moment the car drives away from where the last burst happened — which
     * presents as effects that work once and then silently stop.
     */
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  get liveCount(): number {
    return this.live;
  }

  /**
   * Add one particle, if there is room.
   *
   * Silently drops the request when the pool is full rather than growing. A
   * field that reallocates mid-crash is a frame hitch at exactly the moment the
   * player is looking; the capacity is the budget, and running into it costs a
   * spark nobody counts.
   */
  emit(o: EmitOptions): boolean {
    if (this.live >= this.capacity) return false;
    const i = this.live++;
    const p3 = i * 3;
    const c4 = i * 4;

    this.positions[p3] = o.position.x;
    this.positions[p3 + 1] = o.position.y;
    this.positions[p3 + 2] = o.position.z;
    this.velocities[p3] = o.velocity.x;
    this.velocities[p3 + 1] = o.velocity.y;
    this.velocities[p3 + 2] = o.velocity.z;

    this.colours[c4] = o.colour.r;
    this.colours[c4 + 1] = o.colour.g;
    this.colours[c4 + 2] = o.colour.b;
    this.colours[c4 + 3] = o.opacity ?? 1;

    this.ages[i] = 0;
    this.lives[i] = o.life;
    this.baseSizes[i] = o.size;
    this.growths[i] = o.sizeGrowth ?? 1;
    this.opacities[i] = o.opacity ?? 1;
    this.sizes[i] = o.size;
    return true;
  }

  /** Integrate, fade and recycle. */
  update(dt: number): void {
    let i = 0;
    while (i < this.live) {
      const age = this.ages[i] + dt;
      if (age >= this.lives[i]) {
        this.swapRemove(i);
        continue;
      }
      this.ages[i] = age;
      const t = age / this.lives[i];

      const p3 = i * 3;
      const decay = Math.max(0, 1 - this.drag * dt);
      this.velocities[p3] *= decay;
      this.velocities[p3 + 1] = this.velocities[p3 + 1] * decay - this.gravity * dt;
      this.velocities[p3 + 2] *= decay;

      this.positions[p3] += this.velocities[p3] * dt;
      this.positions[p3 + 1] += this.velocities[p3 + 1] * dt;
      this.positions[p3 + 2] += this.velocities[p3 + 2] * dt;

      this.sizes[i] = this.baseSizes[i] * (1 + (this.growths[i] - 1) * t);
      // Ease-out on the alpha: a linear fade reads as a sprite being turned
      // off, where a curve reads as something dispersing.
      this.colours[i * 4 + 3] = this.opacities[i] * (1 - t) * (1 - t);
      i++;
    }

    this.geometry.setDrawRange(0, this.live);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aColour as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Drop every live particle without touching the buffers' allocation. */
  clear(): void {
    this.live = 0;
    this.geometry.setDrawRange(0, 0);
  }

  private swapRemove(i: number): void {
    const last = --this.live;
    if (i === last) return;
    const a3 = i * 3;
    const b3 = last * 3;
    const a4 = i * 4;
    const b4 = last * 4;
    for (let k = 0; k < 3; k++) {
      this.positions[a3 + k] = this.positions[b3 + k];
      this.velocities[a3 + k] = this.velocities[b3 + k];
    }
    for (let k = 0; k < 4; k++) this.colours[a4 + k] = this.colours[b4 + k];
    this.sizes[i] = this.sizes[last];
    this.ages[i] = this.ages[last];
    this.lives[i] = this.lives[last];
    this.baseSizes[i] = this.baseSizes[last];
    this.growths[i] = this.growths[last];
    this.opacities[i] = this.opacities[last];
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
