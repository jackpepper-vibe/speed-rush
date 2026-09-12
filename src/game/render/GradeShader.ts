import * as THREE from 'three';

/**
 * Final colour grade: vignette, chromatic aberration, saturation, speed lines
 * and a wet-screen wash, in one pass.
 *
 * Folded together rather than chained as four passes because each extra
 * full-screen pass costs a texture read of the whole frame, and on the software
 * rasteriser the probe runs under that is the difference between a usable frame
 * time and a timeout.
 */
export const GradeShader: THREE.ShaderMaterialParameters & { uniforms: Record<string, THREE.IUniform> } = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.38 },
    uAberration: { value: 0.0 },
    uSaturation: { value: 1.06 },
    uSpeedLines: { value: 0.0 },
    uWet: { value: 0.0 },
    uTime: { value: 0.0 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uSaturation;
    uniform float uSpeedLines;
    uniform float uWet;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centred = uv - 0.5;
      float r2 = dot(centred, centred);

      // Aberration scales with distance from centre, so the middle of the
      // frame — where the car is — stays clean at any speed.
      vec2 offset = centred * uAberration * (0.4 + r2 * 2.2);
      vec3 colour;
      colour.r = texture2D(tDiffuse, uv + offset).r;
      colour.g = texture2D(tDiffuse, uv).g;
      colour.b = texture2D(tDiffuse, uv - offset).b;

      /* Radial speed streaks, only while boosting.
       *
       * Confined to the far corners and kept faint. Starting them near the
       * middle of the frame drew bright spokes across the sky and over the
       * horizon, which read as a rendering fault; the effect only works as
       * something caught at the edge of vision. */
      if (uSpeedLines > 0.001) {
        float ang = atan(centred.y, centred.x);
        float streak = hash(vec2(floor(ang * 64.0), 1.0));
        float band = smoothstep(0.34, 0.62, r2) * step(0.88, streak);
        colour += band * uSpeedLines * 0.16;
      }

      // Rain on the lens: a few drifting smears near the top of the frame.
      if (uWet > 0.001) {
        float streak = hash(vec2(floor(uv.x * 90.0), floor(uv.y * 6.0 - uTime * 1.4)));
        colour += step(0.965, streak) * uWet * 0.16;
        colour = mix(colour, colour * vec3(0.86, 0.92, 1.06), uWet * 0.5);
      }

      float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
      colour = mix(vec3(luma), colour, uSaturation);

      colour *= 1.0 - uVignette * smoothstep(0.08, 0.72, r2);

      gl_FragColor = vec4(colour, 1.0);
    }
  `,
};
