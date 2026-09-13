import * as THREE from 'three';

/**
 * Final colour grade: tone curve, radial speed blur, vignette, chromatic
 * aberration, saturation, speed lines and a wet-screen wash, in one pass.
 *
 * Folded together rather than chained as four passes because each extra
 * full-screen pass costs a texture read of the whole frame, and on the software
 * rasteriser the probe runs under that is the difference between a usable frame
 * time and a timeout.
 *
 * Note what this pass is looking at. It sits inside the composer, before
 * `OutputPass`, so the values arriving here are linear and unbounded — a sunlit
 * highlight is not 1.0, it is whatever the sun made it. Contrast applied
 * directly to those numbers pushes the sky to white long before it does
 * anything useful to the road, so the tone curve here works in an approximate
 * display space and converts back, leaving the highlights for the real tone
 * map downstream to roll off.
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
    /** Contrast about the mid pivot, and how much S to bend into the curve. */
    uContrast: { value: 1.16 },
    uCurve: { value: 0.35 },
    /** Where black lands after the curve. Keeps shadows shaped, not crushed. */
    uLift: { value: 0.045 },
    /** Radial motion blur, scaled by speed. Zero disables the taps entirely. */
    uRadialBlur: { value: 0.0 },
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
    uniform float uContrast;
    uniform float uCurve;
    uniform float uLift;
    uniform float uRadialBlur;
    varying vec2 vUv;

    /** Where the curve pivots, in display space. Below mid: the road is dark. */
    const float PIVOT = 0.44;

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

      /* Radial motion blur.
       *
       * Four taps dragged back toward the centre of the frame, with the length
       * of the drag growing with distance from it. That distribution is the
       * whole effect: the world streams past the edges of a windscreen and
       * stays legible ahead, so blurring uniformly reads as a lens fault while
       * blurring radially reads as speed. Skipped outright below a threshold —
       * these are four full-frame reads, and at a standstill they buy nothing.
       */
      if (uRadialBlur > 0.001) {
        vec2 drag = centred * uRadialBlur * (0.06 + r2 * 0.9);
        vec3 acc = colour;
        acc += texture2D(tDiffuse, uv - drag * 0.25).rgb;
        acc += texture2D(tDiffuse, uv - drag * 0.5).rgb;
        acc += texture2D(tDiffuse, uv - drag * 0.75).rgb;
        acc += texture2D(tDiffuse, uv - drag).rgb;
        colour = acc * 0.2;
      }

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

      /* Rain on the lens.
       *
       * The first version quantised the screen into six rows and lit whole
       * cells, which draws a white bar a sixth of the screen tall and scrolls
       * it — reported, accurately, as white lines coming down the screen. It
       * was invisible only because the grade's clock was never advanced; the moment the
       * clock started running, so did the bars.
       *
       * What a drop on a windscreen actually is: short, sparse, falling at its
       * own speed, and mostly a distortion rather than a light. Only about a
       * seventh of the columns carry one at any time, each with its own phase
       * and speed, and the streak refracts what is behind it instead of adding
       * white on top of it.
       */
      if (uWet > 0.001) {
        float column = floor(uv.x * 150.0);
        float speed = 0.55 + hash(vec2(column, 3.0)) * 1.1;
        float phase = hash(vec2(column, 11.0));
        // Only some columns are wet at once.
        float carries = step(0.86, hash(vec2(column, 19.0)));

        float fall = fract(uv.y * 0.8 + uTime * speed * 0.5 + phase);
        // A short head with a tail drawn out behind it.
        float head = smoothstep(0.0, 0.012, fall) * (1.0 - smoothstep(0.012, 0.085, fall));
        float drop = head * carries * uWet;

        // Refraction: the drop shows what is a little above it, magnified.
        vec3 behind = texture2D(tDiffuse, uv - vec2(0.0, 0.012 * drop)).rgb;
        colour = mix(colour, behind, min(1.0, drop * 1.4));
        colour += drop * 0.05;

        // And the general wash of a wet screen, which is most of the effect.
        colour = mix(colour, colour * vec3(0.88, 0.93, 1.05), uWet * 0.5);
      }

      /* Tone curve.
       *
       * Into an approximate display space, bend an S through the midtones and
       * pull contrast about the pivot, then back out. Anything already over
       * white is set aside first and added back afterwards, so a specular hit
       * or the sun keeps its headroom for the tone map at the end of the chain
       * instead of being clamped flat here.
       */
      {
        vec3 display = pow(max(colour, vec3(0.0)), vec3(1.0 / 2.2));
        vec3 over = max(display - 1.0, 0.0);
        vec3 c = min(display, 1.0);
        c = mix(c, c * c * (3.0 - 2.0 * c), uCurve);
        c = clamp((c - PIVOT) * uContrast + PIVOT, 0.0, 1.0);
        /* Lift the toe back off the floor.
         *
         * Contrast about a pivot crushes as hard as it lifts, and the first
         * version of this curve took a road that was merely dark and made it
         * literally zero — a third of the frame at exactly black, the car a
         * cut-out with brake lights in it. A film stock never reaches black
         * either; the toe rolls into a dark grey and the shadows keep their
         * shape. Applied as a compression of the bottom of the range rather
         * than an addition, so highlights are untouched.
         */
        c = uLift + c * (1.0 - uLift);
        colour = pow(c + over, vec3(2.2));
      }

      float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
      colour = mix(vec3(luma), colour, uSaturation);

      colour *= 1.0 - uVignette * smoothstep(0.08, 0.72, r2);

      gl_FragColor = vec4(colour, 1.0);
    }
  `,
};
