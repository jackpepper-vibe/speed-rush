import * as THREE from 'three';
import type { EmitOptions } from './ParticleField';

/**
 * Camera-facing quads for smoke and dust, all in one draw call.
 *
 * Point sprites were the first version and could not make a cloud: every
 * sprite is an unrotated square of the same texture, the GPU clamps its size
 * (on many drivers well under the size a puff of tyre smoke reaches a metre
 * from the camera), and a plume of identical round dots reads as a particle
 * system rather than as smoke.
 *
 * Here each particle is an instanced quad expanded in view space, sized in
 * metres, turned to its own angle and slowly spinning, and lit from above —
 * brighter on the upper side, greyer underneath — so the mass has a sunlit
 * top and a shaded belly the way the smoke in the reference does.
 *
 * Same emit/update contract as `ParticleField`, so an effect can switch
 * between the two without its emitters changing.
 */

const VERT = /* glsl */ `
attribute vec3 aCentre;
attribute vec4 aColour;
attribute vec2 aSizeSpin;
varying vec2 vUv;
varying vec2 vLocal;
varying vec4 vColour;
varying float vNear;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColour = aColour;
  float c = cos(aSizeSpin.y);
  float s = sin(aSizeSpin.y);
  vec2 corner = position.xy;
  vec2 turned = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  // Unturned height within the quad, for lighting from above.
  vLocal = corner;
  vec4 mvPosition = modelViewMatrix * vec4(aCentre, 1.0);
  mvPosition.xy += turned * aSizeSpin.x;
  // Thin out as a puff reaches the lens, or the camera drives into a wall of it.
  vNear = smoothstep(1.2, 5.5, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLight;
uniform vec3 uShade;
varying vec2 vUv;
varying vec2 vLocal;
varying vec4 vColour;
varying float vNear;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColour.a * vNear;
  if (a < 0.004) discard;
  // Sunlit on top, in its own shade underneath.
  float lit = smoothstep(-0.6, 0.7, vLocal.y);
  vec3 col = vColour.rgb * mix(uShade, uLight, lit) * (0.7 + 0.3 * t.r);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}
`;

export class BillboardField {
  readonly mesh: THREE.Mesh;

  private readonly capacity: number;
  private readonly drag: number;
  private readonly gravity: number;

  private readonly centres: Float32Array;
  private readonly colours: Float32Array;
  private readonly sizeSpin: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lives: Float32Array;
  private readonly baseSizes: Float32Array;
  private readonly growths: Float32Array;
  private readonly opacities: Float32Array;
  private readonly spins: Float32Array;

  private live = 0;
  private seed = 1;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(opts: { capacity: number; map: THREE.Texture; drag?: number; gravity?: number }) {
    this.capacity = opts.capacity;
    this.drag = opts.drag ?? 0;
    this.gravity = opts.gravity ?? 0;

    const n = this.capacity;
    this.centres = new Float32Array(n * 3);
    this.colours = new Float32Array(n * 4);
    this.sizeSpin = new Float32Array(n * 2);
    this.velocities = new Float32Array(n * 3);
    this.ages = new Float32Array(n);
    this.lives = new Float32Array(n);
    this.baseSizes = new Float32Array(n);
    this.growths = new Float32Array(n);
    this.opacities = new Float32Array(n);
    this.spins = new Float32Array(n);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setIndex(quad.index);
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.geometry.setAttribute('aCentre', new THREE.InstancedBufferAttribute(this.centres, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColour', new THREE.InstancedBufferAttribute(this.colours, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSizeSpin', new THREE.InstancedBufferAttribute(this.sizeSpin, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uMap: { value: opts.map },
          uLight: { value: new THREE.Color(1.05, 1.03, 1.0) },
          uShade: { value: new THREE.Color(0.62, 0.66, 0.74) },
        },
      ]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    // Merged uniforms clone their values; the texture has to be the live one.
    this.material.uniforms.uMap.value = opts.map;

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  get liveCount(): number {
    return this.live;
  }

  /** Light and shade the smoke with the time of day: sunlit tops, sky-blue undersides. */
  setLighting(light: THREE.Color, shade: THREE.Color): void {
    (this.material.uniforms.uLight.value as THREE.Color).copy(light);
    (this.material.uniforms.uShade.value as THREE.Color).copy(shade);
  }

  private random(): number {
    // A private stream: particles are cosmetic and must not draw from the
    // simulation's, or the number of puffs would change the world.
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  emit(o: EmitOptions): boolean {
    if (this.live >= this.capacity) return false;
    const i = this.live++;
    const p3 = i * 3;
    const c4 = i * 4;
    this.centres[p3] = o.position.x;
    this.centres[p3 + 1] = o.position.y;
    this.centres[p3 + 2] = o.position.z;
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
    this.sizeSpin[i * 2] = o.size;
    this.sizeSpin[i * 2 + 1] = this.random() * Math.PI * 2;
    this.spins[i] = (this.random() - 0.5) * 1.2;
    return true;
  }

  update(dt: number): void {
    let i = 0;
    const decay = Math.max(0, 1 - this.drag * dt);
    while (i < this.live) {
      const age = this.ages[i] + dt;
      if (age >= this.lives[i]) {
        this.swapRemove(i);
        continue;
      }
      this.ages[i] = age;
      const t = age / this.lives[i];
      const p3 = i * 3;
      this.velocities[p3] *= decay;
      this.velocities[p3 + 1] = this.velocities[p3 + 1] * decay - this.gravity * dt;
      this.velocities[p3 + 2] *= decay;
      this.centres[p3] += this.velocities[p3] * dt;
      this.centres[p3 + 1] += this.velocities[p3 + 1] * dt;
      this.centres[p3 + 2] += this.velocities[p3 + 2] * dt;
      // Grows fast at first and then slows, the way a puff expands.
      const grow = 1 - (1 - t) * (1 - t);
      this.sizeSpin[i * 2] = this.baseSizes[i] * (1 + (this.growths[i] - 1) * grow);
      this.sizeSpin[i * 2 + 1] += this.spins[i] * dt;
      // Fades in over the first moment and out over the rest.
      const fadeIn = Math.min(1, t * 8);
      this.colours[i * 4 + 3] = this.opacities[i] * fadeIn * (1 - t) * (1 - t);
      i++;
    }
    this.geometry.instanceCount = this.live;
    (this.geometry.attributes.aCentre as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aColour as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aSizeSpin as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.live = 0;
    this.geometry.instanceCount = 0;
  }

  private swapRemove(i: number): void {
    const last = --this.live;
    if (i === last) return;
    const copy = (arr: Float32Array, stride: number): void => {
      for (let k = 0; k < stride; k++) arr[i * stride + k] = arr[last * stride + k];
    };
    copy(this.centres, 3);
    copy(this.velocities, 3);
    copy(this.colours, 4);
    copy(this.sizeSpin, 2);
    this.ages[i] = this.ages[last];
    this.lives[i] = this.lives[last];
    this.baseSizes[i] = this.baseSizes[last];
    this.growths[i] = this.growths[last];
    this.opacities[i] = this.opacities[last];
    this.spins[i] = this.spins[last];
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
