import * as THREE from 'three';

/**
 * The sea: turquoise over the shallows, deep blue beyond, and moving.
 *
 * A flat, still sheet reads as a painted floor however good its colour. What
 * makes water read as water is the surface: small waves whose normals scatter
 * the sky's reflection into a shimmer, bright towards the horizon where the
 * Fresnel term takes over and darker underfoot where you see into it.
 *
 * Two tiling wave normal maps, scrolling at different speeds and angles, are
 * blended per pixel. They are mapped in road coordinates rather than world
 * ones: the world moves past the car, so a sea mapped in world space would
 * travel with the camera and never pass it.
 */

const VERTEX_HEAD = /* glsl */ `
attribute vec4 road;
varying vec2 vSea;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D tWaves;
uniform float uTime;
uniform float uChop;
varying vec2 vSea;
`;

/* Replaces the tangent-space normal the standard chunk would compute: the sea
 * is a horizontal plane, so the wave normal can be built directly in view
 * space from the plane's own axes. */
const FRAGMENT_NORMAL = /* glsl */ `
{
  vec2 p = vSea;
  vec3 a = texture2D(tWaves, p / 23.0 + vec2(uTime * 0.021, uTime * 0.013)).xyz * 2.0 - 1.0;
  vec3 b = texture2D(tWaves, p / 9.0 + vec2(-uTime * 0.017, uTime * 0.029)).xyz * 2.0 - 1.0;
  vec2 slope = (a.xy * 0.6 + b.xy * 0.4) * uChop;
  // Wave slopes in the plane's x (across the road) and z (along it).
  vec3 worldN = normalize(vec3(-slope.x, 1.0, -slope.y));
  normal = normalize((viewMatrix * vec4(worldN, 0.0)).xyz);
}
`;

let waveTexture: THREE.CanvasTexture | null = null;

/** A tiling normal map of choppy water, from summed wave trains. */
function waves(): THREE.CanvasTexture {
  if (waveTexture) return waveTexture;
  const S = 256;
  const h = new Float32Array(S * S);
  const trains: Array<[number, number, number, number]> = [];
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // Integer frequencies keep the field periodic over the tile.
  for (let k = 0; k < 18; k++) {
    const fx = Math.round((rnd() - 0.5) * 16);
    const fy = Math.round((rnd() - 0.5) * 16);
    if (fx === 0 && fy === 0) continue;
    const amp = 1 / Math.pow(Math.hypot(fx, fy), 1.2);
    trains.push([fx, fy, amp, rnd() * Math.PI * 2]);
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const [fx, fy, amp, ph] of trains) {
        // Sharpened crests: water waves are peaked, troughs broad.
        const s = Math.sin(((fx * x + fy * y) / S) * Math.PI * 2 + ph);
        v += amp * (1 - Math.abs(s)) * (s > 0 ? 1.1 : 0.9);
      }
      h[y * S + x] = v;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for the sea');
  const img = g.createImageData(S, S);
  const at = (x: number, y: number): number => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      img.data[i] = Math.round((dx / len * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  waveTexture = new THREE.CanvasTexture(canvas);
  waveTexture.wrapS = THREE.RepeatWrapping;
  waveTexture.wrapT = THREE.RepeatWrapping;
  waveTexture.colorSpace = THREE.NoColorSpace;
  waveTexture.anisotropy = 8;
  waveTexture.name = 'SeaWaves';
  return waveTexture;
}

export class SeaMaterial extends THREE.MeshStandardMaterial {
  readonly sea = {
    tWaves: { value: waves() as THREE.Texture },
    uTime: { value: 0 },
    /** How rough the water is: calm by day, heavier in a storm. */
    uChop: { value: 0.55 },
  };

  constructor() {
    super({ vertexColors: true, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.2 });
    this.name = 'Sea';
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.sea);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSea = road.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`);
  }

  override customProgramCacheKey(): string {
    return 'speed-rush/sea/1';
  }

  advance(dt: number): void {
    this.sea.uTime.value += dt;
  }

  setChop(chop: number): void {
    this.sea.uChop.value = chop;
  }
}
