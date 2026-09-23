import * as THREE from 'three';

/**
 * An exhaust flame, drawn on an open cone.
 *
 * Flat colour on a cone reads as a plastic blade stuck to the bumper. What
 * makes flame read as flame is that it is white-hot at the nozzle, burns
 * through orange and thins to nothing at the tip, has no edges — it is
 * a volume, so it fades where the eye looks along its skin — and never holds
 * still. All four are here: a colour ramp along the cone, a fade towards its
 * silhouette, turbulence running down it, and values well above one so the
 * bloom gives it a glow. Additive, and drawn from both sides so the far wall
 * adds to the near one the way a volume would.
 *
 * The cone's v coordinate must run from 0 at the nozzle to 1 at the tip, as
 * three's `ConeGeometry` does from its base to its apex.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewV = -mv.xyz;
  vNormalV = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uLevel;
uniform float uTime;
uniform vec3 uHot;
uniform vec3 uBody;
uniform vec3 uTip;
uniform float uGain;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  // Along the flame: 0 at the nozzle, 1 at the tip.
  float s = vUv.y;
  float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
  float edge = smoothstep(0.0, 0.7, facing);
  // Bands running down the flame, broken up round it; calm at the nozzle.
  float wave = 0.5 + 0.5 * sin(s * 26.0 - uTime * 38.0 + sin(vUv.x * 18.85 + uTime * 7.0) * 1.6);
  float turbulence = mix(1.0, 0.5 + 0.5 * wave, smoothstep(0.1, 0.5, s));
  vec3 colour = mix(uHot, uBody, smoothstep(0.0, 0.35, s));
  colour = mix(colour, uTip, smoothstep(0.45, 1.0, s));
  float along = smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.5, 1.0, s));
  gl_FragColor = vec4(colour * uGain, uLevel * edge * along * turbulence);
}
`;

/** The colours of one shell of flame, linear, from nozzle to tip. */
export interface FlameShell {
  readonly hot: THREE.ColorRepresentation;
  readonly body: THREE.ColorRepresentation;
  readonly tip: THREE.ColorRepresentation;
  /** Brightness; above one reaches the bloom. */
  readonly gain: number;
}

/*
 * Gains are held low enough that the orange survives the tone curve. Pushed
 * further, every shell clips to the same white, and by day over pale tarmac the
 * flame read as two white blades rather than as fire. A bluer core does not
 * survive either: added to the orange envelope around it, it comes out pink.
 */

/** The small, hot inner shell: white-hot at the nozzle. */
export const FLAME_CORE: FlameShell = { hot: 0x4d8cff, body: 0xffc070, tip: 0xff7020, gain: 1.6 };
/** The longer, cooler outer shell: orange burning out to red. */
export const FLAME_ENVELOPE: FlameShell = { hot: 0xff9a40, body: 0xff4a06, tip: 0x700604, gain: 1.2 };

export class FlameMaterial extends THREE.ShaderMaterial {
  constructor(shell: FlameShell) {
    super({
      uniforms: {
        uLevel: { value: 0 },
        uTime: { value: 0 },
        uHot: { value: new THREE.Color(shell.hot) },
        uBody: { value: new THREE.Color(shell.body) },
        uTip: { value: new THREE.Color(shell.tip) },
        uGain: { value: shell.gain },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.name = 'Flame';
  }

  /** How lit the flame is, 0..1, and how far its turbulence has run. */
  update(level: number, dt: number): void {
    this.uniforms.uLevel.value = level;
    this.uniforms.uTime.value += dt;
  }
}
