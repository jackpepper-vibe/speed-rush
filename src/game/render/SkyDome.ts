import * as THREE from 'three';

/**
 * Gradient sky with cloud, a sun disc and stars.
 *
 * A shader dome rather than a cube map: the palette has to slide continuously
 * through dawn, day, dusk and night, and interpolating three colours in a
 * uniform is both cheaper and smoother than cross-fading textures. Stars fade
 * in from the same uniform that darkens the top band, so the night sky arrives
 * as one change rather than two that can disagree.
 *
 * The dome is also what the environment map is built from, so everything here
 * ends up reflected in the car's paint. That is the argument for putting the
 * cloud in the sky shader rather than hanging billboards in front of it: a
 * cloud the paint cannot see is a cloud that stops existing the moment you
 * look at the bodywork.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  /**
   * `detail` compiles the cloud out rather than branching past it.
   *
   * A uniform branch would still cost the texture of the shader — every
   * variant's registers allocated, every octave present in the binary — and on
   * the drivers that matter here that is most of the cost. A define means the
   * bottom tier's sky shader genuinely is a gradient.
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
        uSunDir: { value: new THREE.Vector3(-0.5, 0.5, -0.7).normalize() },
        uStars: { value: 0 },
        uSunSize: { value: 0.996 },
        /** Cloud cover, 0 clear to 1 overcast, and how far they have drifted. */
        uClouds: { value: 0.45 },
        uCloudDrift: { value: 0 },
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

        /** Value noise, smoothed. The cheapest thing that is not a grid. */
        float noise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
            mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
            f.y);
        }

        #if CLOUD_DETAIL > 1
        /* Three octaves. Four looks better and costs a fourth more of every
         * sky pixel on a software rasteriser, which is what the probe and the
         * bottom of the quality ladder both run on. */
        float fbm(vec2 p) {
          float v = noise2(p) * 0.5;
          v += noise2(p * 2.03) * 0.28;
          v += noise2(p * 4.11) * 0.14;
          return v / 0.92;
        }
        #endif

        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

          // Two-stage ramp: a tight glow band at the horizon, then the long
          // climb to the zenith colour.
          vec3 col = mix(uBottom, uTop, smoothstep(0.48, 0.80, h));
          /* The horizon glow, kept to the horizon.
           *
           * This band used to reach twenty-two degrees up at three-quarter
           * strength, which washed the entire lower half of the sky to the same
           * pale cream and took the blue with it. A real horizon glow is a few
           * degrees deep; the rest of the sky is sky. */
          float band = 1.0 - smoothstep(0.0, 0.085, abs(dir.y));
          col = mix(col, uHorizon, band * 0.55);

          float sun = dot(dir, normalize(uSunDir));

          /* Cloud, on a plane rather than on the dome.
           *
           * Dividing the horizontal direction by the vertical one projects the
           * dome onto a flat deck at a fixed height, which is what makes the
           * cells stretch and crowd together toward the horizon the way real
           * cloud does. Mapping the noise onto the sphere directly gives cells
           * of even size all the way down, and the sky reads as wallpaper.
           */
          #if CLOUD_DETAIL > 0
          if (uClouds > 0.01 && dir.y > 0.0) {
            vec2 plane = dir.xz / max(dir.y, 0.06);
            vec2 p = plane * 1.45 + vec2(uCloudDrift, uCloudDrift * 0.35);
            #if CLOUD_DETAIL > 1
              /* Domain warp: the noise field displaced by another sample of
               * itself. Without it the cells are round and evenly spaced, which
               * from the ground reads as a texture rather than as weather — a
               * cloud gets its shape from being sheared by the wind it is in.
               * Three fbm evaluations a pixel, which only the top tier pays. */
              vec2 warp = vec2(fbm(p * 0.55 + 4.7), fbm(p * 0.55 - 2.3)) - 0.5;
              float n = fbm(p + warp * 1.6);
            #else
              // One octave, unwarped. Softer and rounder, but it is cloud, and
              // it costs a ninth of what the full version does.
              float n = noise2(p) * 0.78 + 0.12;
            #endif

            // Coverage as a threshold on the noise, so a rising uClouds grows
            // the existing clouds outward instead of fading in a grey veil.
            float cover = smoothstep(0.60 - uClouds * 0.34, 0.80 - uClouds * 0.22, n);
            // Gone by the horizon: at a grazing angle the projection stretches
            // to infinity and every cloud smears into a band.
            cover *= smoothstep(0.02, 0.26, dir.y);

            /* Lit on the sun's side, shaded away from it, and shaded again by
             * how deep into the cloud the sample is. One dot product and one
             * depth term standing in for scattering — but the depth term is
             * what stops a cloud being a flat white sticker: a real one is
             * bright at the top and grey underneath, and that difference is
             * most of how the eye reads it as having volume. */
            float depth = smoothstep(0.52, 0.95, n);
            float lit = 0.5 + 0.5 * sun;
            vec3 base = uTop * 0.42 + uBottom * 0.30;
            vec3 top = uHorizon * 0.62 + vec3(0.26);
            vec3 cloud = mix(base, top, clamp(lit * 0.55 + depth * 0.7, 0.0, 1.0));
            col = mix(col, cloud, cover * 0.86);
          }
          #endif

          col += uHorizon * smoothstep(uSunSize, 1.0, sun) * 2.4;
          col += uHorizon * pow(max(sun, 0.0), 26.0) * 0.3;

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

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 16), this.material);
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
    this.material.uniforms.uCloudDrift.value += dt * 0.0065;
  }

  setSunDirection(x: number, y: number, z: number): void {
    (this.material.uniforms.uSunDir.value as THREE.Vector3).set(x, y, z).normalize();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
