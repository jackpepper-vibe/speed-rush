import * as THREE from 'three';

/**
 * Rain, as streaks.
 *
 * What rain looks like from a moving car is streaks: each drop is smeared
 * along its motion relative to the camera over the time the eye integrates,
 * so at speed they rake back from the vanishing point, and standing still they
 * fall straight. Point sprites cannot do that. They are squares, sized by
 * distance, so the drop that passed a hand's width from the lens filled the
 * corner of the frame with a grey square, and every other drop was a speck.
 *
 * Each drop is one instanced quad stretched from where it is to where it was
 * `EXPOSURE` seconds ago, turned to face the camera, at least a pixel wide with
 * its brightness scaled down when it had to be widened, and faded out near the
 * lens. The drops never move on the CPU: each has a fixed place in a box that
 * rides with the car, and the shader offsets it by how far rain has fallen and
 * how far the road has travelled, wrapped to the box. One draw call and one
 * uniform update a frame, however heavy the storm.
 */

const COUNT = 5000;
/**
 * The box the rain fills, from the road up, centred on the car across it and
 * reaching ahead of it along the road. Only the near part of the view can
 * resolve a streak at all — past forty metres one is under a pixel and the
 * haze takes it — so the drops are spent there rather than spread through
 * a volume mostly beyond the fog or behind the camera.
 */
const BOX = new THREE.Vector3(34, 16, 56);
/** How far ahead of the car the middle of the box sits. */
const AHEAD = 20;
/** Seconds of motion one streak shows. */
const EXPOSURE = 0.03;
/** Streak width in metres, before the one-pixel minimum. */
const WIDTH = 0.02;

const VERT = /* glsl */ `
attribute vec3 aBase;
uniform vec3 uBox;
uniform vec3 uCentre;
uniform vec3 uVelocity;
uniform float uFall;
uniform float uTravel;
uniform float uExposure;
uniform float uWidth;
uniform vec2 uHalfRes;
varying float vAlong;
varying float vAcross;
varying float vFade;
#include <fog_pars_vertex>
void main() {
  vec3 p = mod(aBase * uBox + vec3(0.0, -uFall, uTravel), uBox) - uBox * vec3(0.5, 0.0, 0.5) + uCentre;
  vec4 head = modelViewMatrix * vec4(p, 1.0);
  vec4 tail = modelViewMatrix * vec4(p - uVelocity * uExposure, 1.0);
  vec4 mvPosition = mix(tail, head, position.y);
  float depth = max(0.05, -mvPosition.z);
  // Out of the way entirely once it is at or behind the lens.
  if (-head.z < 0.2 || -tail.z < 0.2) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 ch = projectionMatrix * head;
  vec4 ct = projectionMatrix * tail;
  vec2 d = (ch.xy / ch.w - ct.xy / ct.w) * uHalfRes;
  // To the right of the streak, as +x is to the right of +y: the other side
  // mirrors the quad and turns it away from the camera.
  vec2 across = length(d) > 1e-4 ? normalize(vec2(d.y, -d.x)) : vec2(1.0, 0.0);
  // Width in pixels: the drop's own, but never under one pixel. A widened
  // streak is dimmed by as much, so a distant one is faint rather than fat.
  float px = uWidth * projectionMatrix[1][1] * uHalfRes.y / depth;
  float shown = max(px, 1.0);
  vFade = min(1.0, px / shown) * smoothstep(0.8, 4.0, depth);
  vAlong = position.y;
  vAcross = position.x * 2.0;
  vec4 clip = mix(ct, ch, position.y);
  clip.xy += across * position.x * shown / uHalfRes * clip.w;
  gl_Position = clip;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;
varying float vAlong;
varying float vAcross;
varying float vFade;
#include <fog_pars_fragment>
void main() {
  // Brightest at the head, thinning to nothing along the smear; soft sides.
  float along = smoothstep(0.0, 0.7, vAlong) * (1.0 - smoothstep(0.92, 1.0, vAlong));
  float across = 1.0 - vAcross * vAcross;
  float a = uOpacity * vFade * along * across;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColour, a);
  #include <fog_fragment>
}
`;

export class RainStreaks {
  readonly mesh: THREE.Mesh;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2();

  constructor() {
    // A quad from x -0.5..0.5 across the streak and y 0..1 along it.
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setIndex(quad.index);
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    const base = new Float32Array(COUNT * 3);
    // A private stream: rain is cosmetic and must not draw from the simulation's.
    let seed = 0x5eed;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < base.length; i++) base[i] = rnd();
    this.geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
    this.geometry.instanceCount = COUNT;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uBox: { value: BOX.clone() },
          uCentre: { value: new THREE.Vector3() },
          uVelocity: { value: new THREE.Vector3() },
          uFall: { value: 0 },
          uTravel: { value: 0 },
          uExposure: { value: EXPOSURE },
          uWidth: { value: WIDTH },
          uHalfRes: { value: new THREE.Vector2(640, 360) },
          uColour: { value: new THREE.Color(0xaac4e0) },
          uOpacity: { value: 0 },
        },
      ]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.material.name = 'RainStreaks';

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
  }

  /**
   * Advance the storm.
   *
   * `amount` is 0..1; `speed` is the car's, in metres per second, which the
   * rain streams past at; `x` is where the car is across the road, so the
   * box stays over it.
   */
  update(dt: number, amount: number, speed: number, x: number, renderer: THREE.WebGLRenderer): void {
    if (amount <= 0.001) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const u = this.material.uniforms;
    // Heavier rain falls in bigger, faster drops.
    const fall = 9 + amount * 4;
    u.uFall.value = (u.uFall.value + fall * dt) % BOX.y;
    u.uTravel.value = (u.uTravel.value + speed * dt) % BOX.z;
    (u.uVelocity.value as THREE.Vector3).set(0, -fall, speed);
    (u.uCentre.value as THREE.Vector3).set(x, 0, -AHEAD);
    u.uOpacity.value = 0.8 * amount;
    renderer.getDrawingBufferSize(this.size);
    (u.uHalfRes.value as THREE.Vector2).set(this.size.x / 2, this.size.y / 2);
  }

  /** The drops take the light of the sky they fall through. */
  setColour(colour: THREE.Color): void {
    (this.material.uniforms.uColour.value as THREE.Color).copy(colour);
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
