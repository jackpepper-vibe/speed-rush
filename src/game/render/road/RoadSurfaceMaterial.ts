import * as THREE from 'three';
import { asphaltDetail, pavingTexture } from '../textures/SurfaceTextures';

/**
 * The whole road cross-section in one material: carriageway, gutter, kerb and
 * pavement.
 *
 * The strip under it carries road-space coordinates — lateral offset,
 * distance along the road, height above the deck — so the shader decides what
 * each point *is* from where it is, rather than from a texture stretched over
 * the strip:
 *
 *  - **Asphalt** from a graded-aggregate detail texture at 2 m, modulated by a
 *    patchy macro layer at 40 m so no two stretches match, with the two tyre
 *    tracks in every lane a little darker and a little more polished.
 *  - **Markings** computed analytically, not sampled: edge lines and lane
 *    dashes are exact at any distance and antialiased with their own
 *    derivatives, where a painted texture turns to mush at the horizon and
 *    shimmers at the camera.
 *  - **Kerb** stones in concrete, and a **pavement** of paving slabs.
 *
 * One material means one draw call per road segment for all of it, where the
 * old build drew tarmac, shoulders, rumble strips and barriers separately.
 */

export interface RoadLayout {
  /** Half-width of the carriageway: the outer edge of the outside lanes. */
  halfWidth: number;
  laneWidth: number;
  laneCount: number;
  /** Where the kerb face stands. */
  kerb: number;
  /** Width of the kerb stone on top. */
  kerbWidth: number;
}

const VERTEX_HEAD = /* glsl */ `
attribute vec4 road;
varying vec4 vRoad;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D tAsphalt;
uniform sampler2D tPaving;
uniform vec3 uAsphalt;
uniform vec3 uLine;
uniform vec3 uConcrete;
uniform vec3 uPavingTint;
uniform float uHalfWidth;
uniform float uLaneWidth;
uniform float uLaneCount;
uniform float uKerb;
uniform float uKerbWidth;
uniform float uWet;
uniform float uNight;
varying vec4 vRoad;
float roadRoughness = 0.9;
vec3 roadGlow = vec3(0.0);
`;

/* Replaces the diffuse colour, and records a roughness for the roughness
 * chunk further down to pick up. */
const FRAGMENT_SURFACE = /* glsl */ `
{
  float x = vRoad.x;
  float ax = abs(x);
  float d = vRoad.y;
  // The stretch's own look, from its tag: lamps in the low bit, verge above.
  float segLamps = mod(vRoad.w + 0.01, 2.0) > 0.5 ? 1.0 : 0.0;
  float verge = floor(vRoad.w / 2.0 + 0.01);
  vec3 albedo;
  if (ax < uKerb - 0.001) {
    vec2 p = vec2(x, d);
    float detail = texture2D(tAsphalt, p / 2.2).r;
    float fine = texture2D(tAsphalt, p / 0.61 + 0.31).r;
    float macro = texture2D(tAsphalt, p / 41.0 + 0.53).r;
    vec3 base = uAsphalt * (0.62 + detail * 0.55 + (fine - 0.5) * 0.18) * (0.78 + macro * 0.44);

    // Two polished tyre tracks down every lane.
    float lanePos = (x + uHalfWidth) / uLaneWidth;
    float inLane = fract(lanePos) * uLaneWidth;
    float track = exp(-pow((inLane - 1.05) / 0.38, 2.0)) + exp(-pow((inLane - uLaneWidth + 1.05) / 0.38, 2.0));
    track *= 1.0 - step(uHalfWidth, ax);
    base *= 1.0 - track * 0.09;
    float rough = 0.92 - track * 0.14;

    // The gutter collects grit against the kerb.
    float gutter = smoothstep(uHalfWidth + 0.2, uKerb, ax);
    base *= mix(1.0, 0.86, gutter);

    // Markings: two solid edge lines and dashed lane lines, 3 m in every 10.
    float fx = max(fwidth(x), 1e-4);
    float fd = max(fwidth(d), 1e-4);
    float edgeDist = abs(ax - (uHalfWidth - 0.24));
    float edge = 1.0 - smoothstep(0.1 - fx, 0.1 + fx, edgeDist);
    float boundary = floor(lanePos + 0.5);
    float inner = step(0.5, boundary) * step(boundary, uLaneCount - 0.5);
    float laneDist = abs(x - (-uHalfWidth + boundary * uLaneWidth));
    float lane = (1.0 - smoothstep(0.08 - fx, 0.08 + fx, laneDist)) * inner;
    float phase = mod(d, 10.0);
    float dash = smoothstep(0.0, fd * 1.5, phase) * (1.0 - smoothstep(3.0 - fd * 1.5, 3.0, phase));
    // Far away the dash pattern is finer than a pixel: fade it to its mean.
    dash = mix(dash, 0.3, smoothstep(0.6, 2.0, fd));
    float line = max(edge, lane * dash) * (0.82 + detail * 0.3);
    albedo = mix(base, uLine, clamp(line, 0.0, 1.0));
    roadRoughness = mix(rough, 0.55, line);
  } else if (ax < uKerb + uKerbWidth) {
    // Kerb stone: the face and the rounded top.
    float detail = texture2D(tAsphalt, vec2(x * 1.3 + vRoad.z * 4.0, d) / 1.3).r;
    float joint = step(0.96, fract(d / 1.0));
    albedo = uConcrete * (0.78 + detail * 0.38) * (1.0 - joint * 0.35);
    roadRoughness = 0.82;
  } else if (verge < 0.5) {
    // Towns: a paved pavement.
    albedo = texture2D(tPaving, vec2(x, d) / 2.0).rgb * uPavingTint;
    roadRoughness = 0.8;
  } else if (verge < 1.5) {
    // Desert: a compacted sand and gravel verge.
    float g = texture2D(tAsphalt, vec2(x, d) / 1.7).r;
    float h = texture2D(tAsphalt, vec2(x, d) / 11.0 + 0.4).r;
    albedo = vec3(0.56, 0.43, 0.27) * (0.7 + g * 0.45) * (0.85 + h * 0.3);
    roadRoughness = 0.97;
  } else {
    // Country: a mown grass verge.
    float g = texture2D(tAsphalt, vec2(x, d) / 1.2).r;
    float h = texture2D(tAsphalt, vec2(x, d) / 9.0 + 0.7).r;
    albedo = vec3(0.075, 0.14, 0.045) * (0.65 + g * 0.6) * (0.8 + h * 0.4);
    roadRoughness = 0.92;
  }
  // Rain darkens every surface and polishes it.
  albedo *= mix(1.0, 0.62, uWet);
  roadRoughness = mix(roadRoughness, roadRoughness * 0.32, uWet);
  diffuseColor.rgb = albedo;

  /* Pools of lamplight at night, under every lantern.
   *
   * The lamp standards stand on a 20 m grid down both kerbs with their
   * lanterns over the outside lanes, so where their light falls is a function
   * of road coordinates alone — no light sources, just the albedo lit warm in
   * an ellipse under each one. Only on stretches that have lamps. */
  if (uNight > 0.01 && segLamps > 0.5) {
    float dz = mod(d + 10.0, 20.0) - 10.0;
    float dx = abs(x) - 10.95;
    float pool = exp(-(dx * dx) / 22.0 - (dz * dz) / 34.0);
    roadGlow = albedo * vec3(1.0, 0.74, 0.44) * pool * uNight * 2.6;
  }
}
`;

export class RoadSurfaceMaterial extends THREE.MeshStandardMaterial {
  readonly road = {
    tAsphalt: { value: asphaltDetail() as THREE.Texture },
    tPaving: { value: pavingTexture() as THREE.Texture },
    uAsphalt: { value: new THREE.Color(0x85827d) },
    uLine: { value: new THREE.Color(0xeeeee8) },
    uConcrete: { value: new THREE.Color(0xc4c2bc) },
    uPavingTint: { value: new THREE.Color(0xc9c6c0) },
    uHalfWidth: { value: 10.5 },
    uLaneWidth: { value: 4.2 },
    uLaneCount: { value: 5 },
    uKerb: { value: 12.9 },
    uKerbWidth: { value: 0.3 },
    uWet: { value: 0 },
    uNight: { value: 0 },
  };

  constructor(layout: RoadLayout) {
    super({ roughness: 1, metalness: 0.02, envMapIntensity: 0.4 });
    this.name = 'RoadSurface';
    this.road.uHalfWidth.value = layout.halfWidth;
    this.road.uLaneWidth.value = layout.laneWidth;
    this.road.uLaneCount.value = layout.laneCount;
    this.road.uKerb.value = layout.kerb;
    this.road.uKerbWidth.value = layout.kerbWidth;
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.road);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = road;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <map_fragment>', FRAGMENT_SURFACE)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = roadRoughness;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += roadGlow;');
  }

  /**
   * The tag a road strip carries for a stretch: whether it has lamp
   * standards, and its verge — 0 paved pavement, 1 desert sand, 2 grass.
   */
  static segmentTag(lamps: boolean, verge: number): number {
    return (lamps ? 1 : 0) + verge * 2;
  }

  setNight(level: number): void {
    this.road.uNight.value = level;
  }

  override customProgramCacheKey(): string {
    return 'speed-rush/road-surface/1';
  }

  /** How wet the road is, 0 dry to 1 standing water. */
  setWetness(wet: number): void {
    this.road.uWet.value = wet;
  }

  override dispose(): void {
    this.road.tAsphalt.value.dispose();
    this.road.tPaving.value.dispose();
    super.dispose();
  }
}
