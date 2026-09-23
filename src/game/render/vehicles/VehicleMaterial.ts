import * as THREE from 'three';

/**
 * The one material every vehicle is drawn with.
 *
 * A car is a dozen different surfaces — clearcoated paint, glass, chrome,
 * satin trim, rubber, lamp lenses, a number plate — and the obvious way to draw
 * one is a mesh per surface. That is how the previous factory worked, and it
 * cost thirty-odd draw calls a car: with twenty cars on the road, traffic alone
 * was five hundred calls a frame, more than the rest of the world combined.
 *
 * Here the surface is data on the vertex instead. Each vertex carries its own
 * roughness, metalness, clearcoat and paint mask, plus a lamp channel, and one
 * physical shader reads them. A whole car — body, glass, lamps, wheels — is a
 * single draw call, and the wheels spin in the vertex shader rather than as
 * separate objects.
 *
 * Per-car state (paint colour, stripes, lamps, wheel spin) lives in uniforms on
 * the material instance. Every instance shares one compiled program: the cache
 * key is fixed, so a hundred traffic cars cost one shader compile.
 */

/** Lamp channels an emissive surface can belong to. */
export const LAMP_CHANNEL = {
  none: 0,
  /** Running tail lamps: always lit, a little brighter at night. */
  tail: 1,
  /** Stop lamps: the tail level plus the brake level. */
  brake: 2,
  /** Headlamps, driven by the time of day and the weather. */
  head: 3,
  /** Amber indicators and side markers: a soft constant glow. */
  amber: 4,
  /** Always at their base level — plate lights, dash, LEDs that never switch. */
  constant: 5,
} as const;

export type LampChannel = (typeof LAMP_CHANNEL)[keyof typeof LAMP_CHANNEL];

export interface VehicleUniforms {
  uPaint: THREE.IUniform<THREE.Color>;
  uStripeColor: THREE.IUniform<THREE.Color>;
  /** x inner |x|, y outer |x| of each stripe, z 1 when stripes are on. */
  uStripe: THREE.IUniform<THREE.Vector3>;
  /** tail, brake, head, amber. */
  uLamps: THREE.IUniform<THREE.Vector4>;
  uSpin: THREE.IUniform<number>;
  uSteer: THREE.IUniform<number>;
}

const VERTEX_HEAD = /* glsl */ `
attribute vec4 surf;
attribute vec2 emit;
attribute vec4 wheel;
uniform float uSpin;
uniform float uSteer;
varying vec4 vSurf;
varying vec2 vEmit;
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vInstancePaint;

mat3 vehicleRotX(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

mat3 vehicleRotY(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}
`;

/* Wheels rotate about their own hub. `wheel.w` is 0 for the body, 1 for a
 * rear wheel and 2 for a front one, which also steers. */
const VERTEX_NORMAL = /* glsl */ `
mat3 wheelRotation = mat3(1.0);
if (wheel.w > 0.5) {
  wheelRotation = vehicleRotX(uSpin);
  if (wheel.w > 1.5) wheelRotation = vehicleRotY(uSteer) * wheelRotation;
  objectNormal = wheelRotation * objectNormal;
}
`;

const VERTEX_POSITION = /* glsl */ `
if (wheel.w > 0.5) transformed = wheelRotation * (transformed - wheel.xyz) + wheel.xyz;
vSurf = surf;
vEmit = emit;
vObjPos = position;
vObjNormal = normal;
`;

/* A parked car's paint arrives as its instance colour. three.js multiplies
 * that into vColor, which would tint the glass, chrome and tyres as well, so
 * it is taken back out of vColor and routed to the paint alone. */
const VERTEX_INSTANCE_PAINT = /* glsl */ `
vInstancePaint = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  vColor = color;
  vInstancePaint = instanceColor;
#endif
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform vec3 uPaint;
uniform vec3 uStripeColor;
uniform vec3 uStripe;
uniform vec4 uLamps;
varying vec4 vSurf;
varying vec2 vEmit;
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vInstancePaint;
`;

/* Paint replaces the albedo where the paint mask says so, multiplied by the
 * atlas texel so painted parts can still carry pressed detail (louvres, vents).
 * Stripes are measured across the car's own width and kept off the flanks. */
const FRAGMENT_COLOR = /* glsl */ `
{
  vec3 paint = uPaint * vInstancePaint;
  if (uStripe.z > 0.5) {
    float ax = abs(vObjPos.x);
    float fw = max(fwidth(ax), 1e-4);
    float band = smoothstep(uStripe.x - fw, uStripe.x + fw, ax)
               * (1.0 - smoothstep(uStripe.y - fw, uStripe.y + fw, ax));
    band *= 1.0 - smoothstep(0.35, 0.6, abs(vObjNormal.x));
    paint = mix(paint, uStripeColor, band);
  }
  diffuseColor.rgb *= mix(vec3(1.0), paint, vSurf.w);
}
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
{
  float channel = vEmit.x;
  float level = 0.0;
  if (channel > 0.5) {
    if (channel < 1.5) level = vEmit.y * uLamps.x;
    else if (channel < 2.5) level = vEmit.y * uLamps.x + uLamps.y;
    else if (channel < 3.5) level = vEmit.y * uLamps.z;
    else if (channel < 4.5) level = vEmit.y * uLamps.w;
    else level = vEmit.y;
  }
  totalEmissiveRadiance += diffuseColor.rgb * level;
}
`;

export class VehicleMaterial extends THREE.MeshPhysicalMaterial {
  readonly vehicle: VehicleUniforms = {
    uPaint: { value: new THREE.Color(0xcc2222) },
    uStripeColor: { value: new THREE.Color(0x111111) },
    uStripe: { value: new THREE.Vector3(0, 0, 0) },
    uLamps: { value: new THREE.Vector4(1, 0, 0, 1) },
    uSpin: { value: 0 },
    uSteer: { value: 0 },
  };

  constructor(atlas: THREE.Texture) {
    super({
      map: atlas,
      vertexColors: true,
      // Both overridden per fragment from the vertex data; the material-level
      // values only have to switch the relevant code paths on.
      roughness: 1,
      metalness: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.35,
    });
    this.name = 'VehicleMaterial';
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.vehicle);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${VERTEX_NORMAL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_POSITION}`)
      .replace('#include <color_vertex>', `#include <color_vertex>\n${VERTEX_INSTANCE_PAINT}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vSurf.y;')
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat = vSurf.z;\n#endif',
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_EMISSIVE}`);
  }

  /** One program for every vehicle, whatever its paint or lamp state. */
  override customProgramCacheKey(): string {
    return 'speed-rush/vehicle/1';
  }

  setPaint(color: THREE.ColorRepresentation): void {
    this.vehicle.uPaint.value.set(color);
  }

  /** Two stripes either side of the centreline, between `inner` and `outer`. */
  setStripes(color: THREE.ColorRepresentation | null, inner = 0.12, outer = 0.3): void {
    if (color === null) {
      this.vehicle.uStripe.value.z = 0;
      return;
    }
    this.vehicle.uStripeColor.value.set(color);
    this.vehicle.uStripe.value.set(inner, outer, 1);
  }
}

/**
 * The see-through windscreen on an open car.
 *
 * The only transparent vehicle surface in the game, and only the roadster has
 * one: on a closed car the glass is drawn opaque, as the dark mirror that car
 * glass actually looks like from outside, and belongs to the single draw call.
 * A windscreen with a driver behind it has to be seen through.
 */
export function makeScreenGlass(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x9fb2c0,
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.22,
    envMapIntensity: 1.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
