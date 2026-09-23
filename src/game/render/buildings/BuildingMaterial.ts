import * as THREE from 'three';
import { onNight } from '../NightLights';

/**
 * Facades, drawn per pixel.
 *
 * Every building is a plain instanced box; the storeys, bays, windows,
 * balconies, shopfronts and awnings are computed in the fragment shader from
 * the point's position on the building in metres. The instance's own scale
 * gives those metres, so a window is the size of a window on a four-storey
 * block and on a thirty-storey tower alike, and a whole city is one draw call
 * per rank.
 *
 * Each building picks a style from a seed carried in its instance colour — the
 * one per-instance value that is stable for a building, since the field
 * re-anchors its transforms as the car moves:
 *
 *  - Riviera apartments: punched windows with shutters and a balcony slab
 *    under every storey, in the pale ochres, creams and pinks of the coast.
 *  - Hotels: white, with deep balcony bands.
 *  - Modern blocks: continuous ribbon glazing between thin spandrels.
 *  - Offices: a regular grid of square windows.
 *
 * Glass is genuinely reflective — low roughness and some metalness — so the
 * windows carry the sky, which is most of what makes a facade read as glass.
 * At a distance the pattern is finer than a pixel and is faded to its average,
 * so a skyline does not shimmer.
 */

const VERTEX_HEAD = /* glsl */ `
varying vec3 vFacadePos;
varying vec3 vFacadeNormal;
varying vec3 vFacadeSeed;
`;

const VERTEX_BODY = /* glsl */ `
{
  vec3 facadeScale = vec3(1.0);
  #ifdef USE_INSTANCING
    facadeScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  #endif
  vFacadePos = position * facadeScale;
  vFacadeNormal = normal;
  #ifdef USE_INSTANCING_COLOR
    vFacadeSeed = instanceColor;
  #else
    vFacadeSeed = vec3(0.5);
  #endif
}
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform float uNight;
uniform vec2 uStyles;
varying vec3 vFacadePos;
varying vec3 vFacadeNormal;
varying vec3 vFacadeSeed;
float facadeRough = 0.85;
float facadeMetal = 0.0;
vec3 facadeGlow = vec3(0.0);

float fHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Box-filtered pulse: 1 inside [a, b], antialiased over w.
float fBand(float x, float a, float b, float w) {
  return clamp((min(x - a, b - x)) / max(w, 1e-4) + 0.5, 0.0, 1.0);
}
`;

const FRAGMENT_BODY = /* glsl */ `
{
  vec3 wall = diffuseColor.rgb;
  vec3 n = normalize(vFacadeNormal);
  vec3 p = vFacadePos;
  float seed = fract(dot(vFacadeSeed, vec3(12.9898, 78.233, 37.719)) * 43.7585);
  float s2 = fract(seed * 7.13 + 0.17);
  float s3 = fract(seed * 13.7 + 0.51);
  float s4 = fract(seed * 29.3 + 0.83);

  if (n.y > 0.5) {
    // Roof: gravel and plant, darker than the walls.
    diffuseColor.rgb = wall * 0.52 + 0.04;
    facadeRough = 0.95;
  } else if (n.y < -0.5) {
    diffuseColor.rgb = wall * 0.3;
  } else {
    float u = abs(n.x) > 0.5 ? p.z : p.x;
    float y = p.y;
    float fu = fwidth(u) * 1.5;
    float fy = fwidth(y) * 1.5;

    // Style.
    // 0 riviera, 1 hotel, 2 modern, 3 office — within this rank's range.
    float style = floor(uStyles.x + seed * (uStyles.y - uStyles.x));
    float storey = 3.05 + s2 * 0.45;
    float bay = style > 2.5 ? 2.2 + s3 * 0.6 : 2.9 + s3 * 1.1;
    float groundH = 4.3;

    vec3 glass = vec3(0.05, 0.065, 0.08);
    vec3 col = wall;
    float isGlass = 0.0;

    if (y < groundH) {
      // Shopfronts: big glazing between piers, an awning above.
      float lx = fract(u / bay) * bay;
      float pane = fBand(lx, 0.25, bay - 0.25, fu) * fBand(y, 0.35, 3.15, fy);
      float awning = fBand(y, 3.25, 3.85, fy) * step(0.35, s4);
      vec3 awningCol = mix(vec3(0.55, 0.12, 0.08), vec3(0.1, 0.28, 0.2), step(0.65, s4));
      float stripe = step(0.5, fract(u / 0.6));
      awningCol = mix(awningCol, vec3(0.85, 0.82, 0.76), stripe * step(0.8, s4));
      isGlass = pane;
      col = mix(wall * 0.9, glass * 1.4, pane);
      col = mix(col, awningCol, awning);
    } else {
      float hy = y - groundH;
      float iy = floor(hy / storey);
      float ly = fract(hy / storey) * storey;
      float ix = floor(u / bay);
      float lx = (fract(u / bay) - 0.5) * bay;
      float win;
      float shutter = 0.0;
      float slab = 0.0;
      if (style < 0.5) {
        // Riviera: tall windows with shutters either side, balcony slabs.
        float ww = bay * 0.34;
        win = fBand(lx, -ww * 0.5, ww * 0.5, fu) * fBand(ly, 0.35, storey - 0.55, fy);
        shutter = (fBand(lx, -ww * 0.5 - 0.5, -ww * 0.5 - 0.05, fu) + fBand(lx, ww * 0.5 + 0.05, ww * 0.5 + 0.5, fu))
          * fBand(ly, 0.35, storey - 0.55, fy);
        slab = fBand(ly, 0.0, 0.16, fy);
      } else if (style < 1.5) {
        // Hotel: wide openings behind deep balcony bands.
        win = fBand(lx, -bay * 0.36, bay * 0.36, fu) * fBand(ly, 0.3, storey - 0.35, fy);
        slab = fBand(ly, 0.0, 0.26, fy);
      } else if (style < 2.5) {
        // Modern: ribbon glazing with slim mullions.
        win = fBand(ly, 0.55, storey - 0.12, fy) * (1.0 - fBand(lx, -0.04, 0.04, fu) * 0.85);
      } else {
        // Office: square punched grid.
        float ww = bay * 0.56;
        win = fBand(lx, -ww * 0.5, ww * 0.5, fu) * fBand(ly, 0.8, 0.8 + ww, fy);
      }
      // Each pane a little different: blinds, reflections, a lit room.
      float h = fHash(vec2(ix, iy + seed * 97.0));
      vec3 pane = glass * (0.7 + h * 0.9) + vec3(0.02, 0.025, 0.03) * step(0.8, h);
      vec3 shutterCol = mix(vec3(0.16, 0.3, 0.2), vec3(0.3, 0.2, 0.12), step(0.5, s4));
      col = mix(wall, shutterCol, shutter * 0.85);
      // Balcony slab edge, lit, with its shadow on the wall below.
      col = mix(col, wall * 1.12 + 0.03, slab);
      col *= 1.0 - fBand(ly, storey - 0.35, storey, fy) * 0.2 * step(style, 1.5);
      col = mix(col, pane, win);
      isGlass = win;
      facadeGlow = vec3(1.0, 0.78, 0.5) * step(0.72, h) * win * uNight * 1.6;
    }

    // Fade the pattern to its average once a storey is under a few pixels.
    float fine = smoothstep(0.35, 1.2, max(fu / bay, fy / storey) * 3.0);
    vec3 average = mix(wall, glass * 1.2, style > 1.5 ? 0.5 : 0.28);
    col = mix(col, average, fine);
    isGlass *= 1.0 - fine;

    // Occlusion at the foot of the wall.
    col *= 0.78 + 0.22 * smoothstep(0.0, 3.0, y);
    diffuseColor.rgb = col;
    facadeRough = mix(0.86, 0.08, isGlass);
    facadeMetal = mix(0.0, 0.65, isGlass);
  }
}
`;

export class BuildingMaterial extends THREE.MeshStandardMaterial {
  readonly facade = {
    uNight: { value: 0 },
    uStyles: { value: new THREE.Vector2(0, 4) },
  };

  /**
   * `styles` is the range of facade styles this rank draws from: 0 riviera
   * apartments, 1 hotels, 2 modern ribbon glazing, 3 offices.
   */
  constructor(styles: readonly [number, number] = [0, 4]) {
    super({ color: 0xffffff, roughness: 1, metalness: 1, envMapIntensity: 1.0 });
    this.name = 'BuildingMaterial';
    this.facade.uStyles.value.set(styles[0], styles[1]);
    this.unsubscribe = onNight((level) => this.setNight(level));
  }

  private readonly unsubscribe: () => void;

  override dispose(): void {
    this.unsubscribe();
    super.dispose();
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.facade);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_BODY}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = facadeRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = facadeMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += facadeGlow;');
  }

  override customProgramCacheKey(): string {
    return 'speed-rush/building/1';
  }

  /** Lit windows after dark: 0 by day, 1 at night. */
  setNight(level: number): void {
    this.facade.uNight.value = level;
  }
}

/** A unit block standing on its base: x and z in [-0.5, 0.5], y in [0, 1]. */
export function blockGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * A tower with a set-back crown: the step is what gives a skyline its
 * sawtooth. The crown is proportionate to the tower, which suits a skyline
 * seen from half a kilometre.
 */
export function towerGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(1, 1, 1);
  body.translate(0, 0.5, 0);
  const crown = new THREE.BoxGeometry(0.72, 0.12, 0.72);
  crown.translate(0, 1.06, 0);
  const merged = mergeIndexed([body, crown]);
  body.dispose();
  crown.dispose();
  return merged;
}

function mergeIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t.getX(i), t.getY(i));
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
