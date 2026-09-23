import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * The frame after the scene is drawn: bloom, tone map, grade, output.
 *
 * Replaces an `EffectComposer` chain that cost more than the scene did. The
 * composer clones its multisampled target for both ping-pong buffers, so every
 * full-screen pass after the scene — the bloom composite, the grade, the
 * output — wrote into a 4x half-float MSAA buffer and paid for a resolve; and
 * `UnrealBloomPass` blurs at five levels with wide kernels. Measured on the
 * integrated GPU this game has to run on: 50 ms of post on an *empty* scene.
 *
 * Here the scene is the only multisampled render. Bloom is a dual-filter
 * pyramid (a bright pass at half resolution, then down and up a short mip
 * chain, each tap bilinear), and everything else — bloom composite, tone
 * mapping, the colour grade, vignette, speed blur, the wet lens and the sRGB
 * encode — is a single full-screen pass straight to the canvas.
 */

export interface PostOptions {
  msaa: number;
  bloom: boolean;
  /** Mip levels in the bloom pyramid, the first at half resolution. */
  levels: number;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const PREFILTER = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  // Four bilinear taps average a 4x4 block of the source.
  vec3 c = texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  // Clamp fireflies: a single blown specular pixel should not bloom like the sun.
  c = min(c, vec3(24.0));
  float bright = max(c.r, max(c.g, c.b));
  float soft = clamp(bright - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contribution = max(soft, bright - uThreshold) / max(bright, 1e-4);
  gl_FragColor = vec4(c * contribution, 1.0);
}
`;

const DOWN = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSource, vUv).rgb * 4.0;
  c += texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.125, 1.0);
}
`;

const UP = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSource, vUv + uTexel * vec2(-2.0, 0.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(2.0, 0.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(0.0, -2.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(0.0, 2.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 2.0;
  c += texture2D(tSource, vUv + uTexel * vec2(1.0, 1.0)).rgb * 2.0;
  c += texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
  c += texture2D(tSource, vUv + uTexel * vec2(1.0, -1.0)).rgb * 2.0;
  gl_FragColor = vec4(c / 12.0 * uWeight, 1.0);
}
`;

const FINAL = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uVignette;
uniform float uAberration;
uniform float uSaturation;
uniform float uSpeedLines;
uniform float uWet;
uniform float uTime;
uniform float uContrast;
uniform float uCurve;
uniform float uLift;
uniform float uRadialBlur;
varying vec2 vUv;

${THREE.ShaderChunk.tonemapping_pars_fragment}
${THREE.ShaderChunk.colorspace_pars_fragment}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  vec2 centred = uv - 0.5;
  float r2 = dot(centred, centred);

  // Rain on the lens refracts what is behind each drop; decided first so the
  // rest of the frame is read through it.
  float drop = 0.0;
  if (uWet > 0.001) {
    float column = floor(uv.x * 150.0);
    float speed = 0.55 + hash(vec2(column, 3.0)) * 1.1;
    float phase = hash(vec2(column, 11.0));
    float carries = step(0.86, hash(vec2(column, 19.0)));
    float fall = fract(uv.y * 0.8 + uTime * speed * 0.5 + phase);
    float head = smoothstep(0.0, 0.012, fall) * (1.0 - smoothstep(0.012, 0.085, fall));
    drop = head * carries * uWet;
    uv.y -= 0.012 * drop;
  }

  vec3 hdr;
  if (uAberration > 0.00001) {
    vec2 offset = centred * uAberration * (0.4 + r2 * 2.2);
    hdr = vec3(texture2D(tScene, uv + offset).r, texture2D(tScene, uv).g, texture2D(tScene, uv - offset).b);
  } else {
    hdr = texture2D(tScene, uv).rgb;
  }

  // Radial speed blur: the world streams past the edges, the car stays sharp.
  if (uRadialBlur > 0.001) {
    vec2 drag = centred * uRadialBlur * (0.06 + r2 * 0.9);
    vec3 acc = hdr;
    acc += texture2D(tScene, uv - drag * 0.33).rgb;
    acc += texture2D(tScene, uv - drag * 0.66).rgb;
    acc += texture2D(tScene, uv - drag).rgb;
    hdr = acc * 0.25;
  }

  hdr += texture2D(tBloom, vUv).rgb * uBloom;

  vec3 c = ACESFilmicToneMapping(hdr);
  c = sRGBTransferOETF(vec4(c, 1.0)).rgb;

  // Grade, in display space.
  c = mix(c, c * c * (3.0 - 2.0 * c), uCurve);
  c = clamp((c - 0.44) * uContrast + 0.44, 0.0, 1.0);
  c = uLift + c * (1.0 - uLift);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, uSaturation);

  if (uSpeedLines > 0.001) {
    float ang = atan(centred.y, centred.x);
    float streak = hash(vec2(floor(ang * 64.0), 1.0));
    float band = smoothstep(0.34, 0.62, r2) * step(0.88, streak);
    c += band * uSpeedLines * 0.16;
  }
  if (uWet > 0.001) {
    c += drop * 0.05;
    c = mix(c, c * vec3(0.9, 0.94, 1.04), uWet * 0.5);
  }

  c *= 1.0 - uVignette * smoothstep(0.08, 0.72, r2);
  gl_FragColor = vec4(c, 1.0);
}
`;

function target(w: number, h: number, samples: number, depth: boolean): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    samples,
    depthBuffer: depth,
    stencilBuffer: false,
  });
  t.texture.minFilter = THREE.LinearFilter;
  t.texture.magFilter = THREE.LinearFilter;
  t.texture.generateMipmaps = false;
  return t;
}

export class PostPipeline {
  readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly mips: THREE.WebGLRenderTarget[] = [];
  private readonly quad = new FullScreenQuad();
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  readonly final: THREE.RawShaderMaterial;
  private readonly black: THREE.DataTexture;

  bloomEnabled: boolean;
  bloomStrength = 0.3;
  bloomThreshold = 1.0;
  /** 0 keeps the glow tight, 1 lets the widest levels through at full weight. */
  bloomRadius = 0.5;

  constructor(opts: PostOptions) {
    this.bloomEnabled = opts.bloom;
    this.sceneTarget = target(1, 1, opts.msaa, true);
    this.sceneTarget.texture.name = 'PostPipeline.scene';
    for (let i = 0; i < opts.levels; i++) this.mips.push(target(1, 1, 0, false));

    this.prefilter = new THREE.ShaderMaterial({
      uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 } },
      vertexShader: VERT, fragmentShader: PREFILTER, depthTest: false, depthWrite: false,
    });
    this.down = new THREE.ShaderMaterial({
      uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERT, fragmentShader: DOWN, depthTest: false, depthWrite: false,
    });
    this.up = new THREE.ShaderMaterial({
      uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
      vertexShader: VERT, fragmentShader: UP, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, transparent: true,
    });

    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;

    this.final = new THREE.RawShaderMaterial({
      uniforms: {
        tScene: { value: this.sceneTarget.texture },
        tBloom: { value: this.black },
        uBloom: { value: 0 },
        toneMappingExposure: { value: 1 },
        uVignette: { value: 0.15 },
        uAberration: { value: 0 },
        uSaturation: { value: 1.08 },
        uSpeedLines: { value: 0 },
        uWet: { value: 0 },
        uTime: { value: 0 },
        uContrast: { value: 1.02 },
        uCurve: { value: 0.14 },
        uLift: { value: 0.012 },
        uRadialBlur: { value: 0 },
      },
      vertexShader: `precision highp float;\nattribute vec3 position;\nattribute vec2 uv;\n${VERT}`,
      fragmentShader: FINAL,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Uniforms of the final pass: the grade, the exposure and the bloom level. */
  get uniforms(): Record<string, THREE.IUniform> {
    return this.final.uniforms;
  }

  /** Size in device pixels. */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.sceneTarget.setSize(w, h);
    let mw = w;
    let mh = h;
    for (const mip of this.mips) {
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
      mip.setSize(mw, mh);
    }
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);

    const bloom = this.bloomEnabled && this.bloomStrength > 0.001 && this.mips.length > 0;
    if (bloom) {
      const autoClear = renderer.autoClear;
      // Bright pass into the half-resolution level.
      this.prefilter.uniforms.tSource.value = this.sceneTarget.texture;
      this.prefilter.uniforms.uTexel.value.set(1 / this.sceneTarget.width, 1 / this.sceneTarget.height);
      this.prefilter.uniforms.uThreshold.value = this.bloomThreshold;
      this.prefilter.uniforms.uKnee.value = Math.max(0.05, this.bloomThreshold * 0.5);
      this.pass(renderer, this.prefilter, this.mips[0]);
      // Down the pyramid.
      for (let i = 1; i < this.mips.length; i++) {
        const src = this.mips[i - 1];
        this.down.uniforms.tSource.value = src.texture;
        this.down.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
        this.pass(renderer, this.down, this.mips[i]);
      }
      // And back up, each level added onto the one above it.
      renderer.autoClear = false;
      const weight = 0.55 + this.bloomRadius * 0.45;
      for (let i = this.mips.length - 1; i > 0; i--) {
        const src = this.mips[i];
        this.up.uniforms.tSource.value = src.texture;
        this.up.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
        this.up.uniforms.uWeight.value = weight;
        this.pass(renderer, this.up, this.mips[i - 1]);
      }
      renderer.autoClear = autoClear;
      this.final.uniforms.tBloom.value = this.mips[0].texture;
      this.final.uniforms.uBloom.value = this.bloomStrength;
    } else {
      this.final.uniforms.tBloom.value = this.black;
      this.final.uniforms.uBloom.value = 0;
    }

    this.final.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    this.pass(renderer, this.final, null);
  }

  private pass(renderer: THREE.WebGLRenderer, material: THREE.Material, out: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(out);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.sceneTarget.dispose();
    for (const m of this.mips) m.dispose();
    this.prefilter.dispose();
    this.down.dispose();
    this.up.dispose();
    this.final.dispose();
    this.black.dispose();
    this.quad.dispose();
  }
}
