import * as THREE from 'three';

/**
 * Gradient sky with a sun disc and stars.
 *
 * A shader dome rather than a cube map: the palette has to slide continuously
 * through dawn, day, dusk and night, and interpolating three colours in a
 * uniform is both cheaper and smoother than cross-fading textures. Stars fade
 * in from the same uniform that darkens the top band, so the night sky arrives
 * as one change rather than two that can disagree.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
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
        varying vec3 vDir;

        float hash13(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.zyx + 31.32);
          return fract((p.x + p.y) * p.z);
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

          // Two-stage ramp: a tight glow band at the horizon, then the long
          // climb to the zenith colour.
          vec3 col = mix(uBottom, uTop, smoothstep(0.5, 0.92, h));
          float band = 1.0 - smoothstep(0.0, 0.22, abs(dir.y));
          col = mix(col, uHorizon, band * 0.75);

          float sun = dot(dir, normalize(uSunDir));
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

  setSunDirection(x: number, y: number, z: number): void {
    (this.material.uniforms.uSunDir.value as THREE.Vector3).set(x, y, z).normalize();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
