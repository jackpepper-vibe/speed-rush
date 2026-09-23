import * as THREE from 'three';
import { cloudTexture } from './sky/CloudPainter';

/**
 * The sky: gradient, painted cumulus, a sun disc and stars.
 *
 * A shader dome rather than a cube map: the palette has to slide continuously
 * through dawn, day, dusk and night, and interpolating a handful of colours in
 * uniforms is both cheaper and smoother than cross-fading textures. The clouds
 * are the one textured part — a panoramic band painted once (see
 * `CloudPainter`) and coloured here from the live palette, so they turn gold at
 * dusk and grey in a storm without being repainted.
 *
 * The dome is also what the environment map is built from, so everything here
 * ends up reflected in the paint, the glass and the sea. That is the argument
 * for putting the cloud in the sky shader rather than hanging billboards in
 * front of it: a cloud the paint cannot see stops existing the moment you look
 * at the bodywork.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  /**
   * `detail` 0 drops the storm overcast's noise, the one per-pixel loop the
   * sky has; the painted clouds are a single texture read on every tier.
   */
  constructor(detail: 0 | 1 | 2 = 2) {
    this.material = new THREE.ShaderMaterial({
      defines: { CLOUD_DETAIL: detail },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x2a6fc4) },
        uBottom: { value: new THREE.Color(0xbcd8f0) },
        uHorizon: { value: new THREE.Color(0xfff2d0) },
        uSunDir: { value: new THREE.Vector3(-0.5, 0.5, 0.5).normalize() },
        uStars: { value: 0 },
        /** cos of the disc's angular radius. 0.9991 is about 2.4 degrees. */
        uSunSize: { value: 0.9991 },
        /** Cloud cover, 0 clear to 1 overcast, and how far they have drifted. */
        uClouds: { value: 0.45 },
        uCloudDrift: { value: 0 },
        tClouds: { value: cloudTexture() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uBottom;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform float uStars;
        uniform float uSunSize;
        uniform float uClouds;
        uniform float uCloudDrift;
        uniform sampler2D tClouds;
        varying vec3 vDir;

        float hash13(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.zyx + 31.32);
          return fract((p.x + p.y) * p.z);
        }

        float hash12(vec2 p) {
          vec3 q = fract(vec3(p.xyx) * 0.1031);
          q += dot(q, q.yzx + 33.33);
          return fract((q.x + q.y) * q.z);
        }

        float noise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
            mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
            f.y);
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

          // Deep blue overhead, paler towards a tight glow band at the horizon.
          vec3 col = mix(uBottom, uTop, smoothstep(0.48, 0.80, h));
          float band = 1.0 - smoothstep(0.0, 0.085, abs(dir.y));
          col = mix(col, uHorizon, band * 0.55);

          float sun = dot(dir, normalize(uSunDir));
          float sunUp = clamp(uSunDir.y * 3.0, 0.0, 1.0);

          /* Painted cumulus round the horizon.
           *
           * Mapped by azimuth and elevation onto the band. The texture holds
           * how lit each point is (red) and how much cloud there is (alpha);
           * the colours come from the palette: the lit side takes the sun's
           * warmth off the horizon colour, the shade the blue of the sky it
           * is sitting in. */
          if (dir.y > -0.02) {
            float azimuth = atan(dir.x, -dir.z) / 6.2831853 + 0.5 + uCloudDrift;
            float elevation = asin(clamp(dir.y, 0.0, 1.0));
            vec4 c = texture2D(tClouds, vec2(azimuth, elevation / 0.62));
            float cover = c.a * clamp(uClouds * 3.2, 0.0, 1.0);
            // Soften the bottom edge into the horizon haze.
            cover *= smoothstep(0.0, 0.035, dir.y);
            // How bright the sky is: clouds are lit by it, so at night they
            // fade to faint moonlit shapes instead of glowing white.
            float skyLight = clamp(dot(uBottom, vec3(0.2126, 0.7152, 0.0722)) * 3.0, 0.035, 1.0);
            vec3 lit = mix(vec3(1.0, 0.99, 0.97), uHorizon, 0.35) * (0.62 + 0.38 * sunUp) * skyLight;
            vec3 shade = mix(uTop, uBottom, 0.6) * 0.75 + vec3(0.12) * skyLight;
            vec3 cloud = mix(shade, lit, smoothstep(0.1, 0.95, c.r));
            // Distant cloud takes on the horizon colour.
            cloud = mix(cloud, uHorizon * 0.9 + uBottom * 0.2, (1.0 - smoothstep(0.02, 0.22, dir.y)) * 0.35);
            // Silver lining on cloud standing close to the sun.
            cloud += uHorizon * pow(max(sun, 0.0), 24.0) * 0.6 * (1.0 - c.a * 0.5);
            col = mix(col, cloud, cover);
          }

          /* A grey blanket for rain and storms: the one place noise is the
           * right tool, since an overcast sky has no shapes in it. */
          #if CLOUD_DETAIL > 0
          if (uClouds > 0.4 && dir.y > 0.0) {
            vec2 plane = dir.xz / max(dir.y, 0.08) * 0.6 + vec2(uCloudDrift * 8.0, 0.0);
            float n = noise2(plane) * 0.6 + noise2(plane * 2.1) * 0.3 + noise2(plane * 4.3) * 0.1;
            float overcast = smoothstep(0.4, 0.75, uClouds) * (0.75 + n * 0.25);
            vec3 grey = mix(uBottom, vec3(dot(uBottom, vec3(0.33))), 0.6) * (0.8 + n * 0.25);
            col = mix(col, grey, overcast);
          }
          #endif

          /* Ground below the horizon.
           *
           * Nothing on screen ever shows the lower half of the dome — the
           * world covers it — but everything that reflects does. Paint, glass
           * and chrome pick up a horizon line with darker ground under it,
           * which is the single strongest cue that a curved surface is a
           * polished one. A dome that stayed blue below the horizon made every
           * flank reflect sky twice. */
          vec3 ground = mix(uBottom, uHorizon, 0.35) * 0.32;
          col = mix(col, ground, smoothstep(0.0, -0.08, dir.y));

          // A sun the size of a sun, with a soft corona.
          col += uHorizon * smoothstep(uSunSize, 1.0, sun) * 2.4;
          col += uHorizon * pow(max(sun, 0.0), 80.0) * 0.22;

          if (uStars > 0.001) {
            vec3 cell = floor(dir * 260.0);
            float s = hash13(cell);
            float star = step(0.9975, s) * smoothstep(0.0, 0.35, dir.y);
            col += vec3(star) * uStars * (0.6 + hash13(cell + 7.0) * 0.7);
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 20), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  setPalette(top: number, bottom: number, horizon: number): void {
    (this.material.uniforms.uTop.value as THREE.Color).setHex(top);
    (this.material.uniforms.uBottom.value as THREE.Color).setHex(bottom);
    (this.material.uniforms.uHorizon.value as THREE.Color).setHex(horizon);
  }

  setStars(amount: number): void {
    this.material.uniforms.uStars.value = amount;
  }

  /** Cover, 0 clear to 1 overcast. Driven by the weather. */
  setClouds(amount: number): void {
    this.material.uniforms.uClouds.value = amount;
  }

  /**
   * Advance the cloud drift.
   *
   * Fed from the world clock rather than a wall clock, so two runs of the same
   * length put the clouds in the same place — a capture harness comparing one
   * build against another must not be comparing the weather.
   */
  advance(dt: number): void {
    this.material.uniforms.uCloudDrift.value += dt * 0.0012;
  }

  setSunDirection(x: number, y: number, z: number): void {
    (this.material.uniforms.uSunDir.value as THREE.Vector3).set(x, y, z).normalize();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
