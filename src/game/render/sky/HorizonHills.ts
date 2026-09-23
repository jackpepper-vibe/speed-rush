import * as THREE from 'three';

/**
 * Hills on the horizon.
 *
 * The reference's far distance is not an edge: behind the city and across the
 * bay there are headlands, blue with haze, and they are much of why the
 * picture has depth. Without them the world ends at a flat white line where
 * the fog swallows the ground.
 *
 * A single band a little inside the sky dome, following the camera the way the
 * dome does, with a ridge line built from a few octaves of sines so it reads
 * as terrain rather than as a pattern. Coloured from the fog and the lower sky
 * every time the palette changes, so it sits in the same air as everything
 * else: pale at its foot, a touch deeper and bluer along the ridge.
 */

const RADIUS = 1250;
const SEGMENTS = 256;

/** Ridge height in metres at an azimuth (0 straight ahead, positive right). */
function ridge(a: number): number {
  // Headlands across the bay ahead and to the right, lower hills behind the
  // town on the left, nothing much behind the camera.
  const ahead = Math.exp(-Math.pow((a - 0.55) / 0.75, 2));
  const left = Math.exp(-Math.pow((a + 0.9) / 0.6, 2)) * 0.55;
  const envelope = Math.min(1, ahead + left + 0.12);
  const shape =
    0.55 +
    0.25 * Math.sin(a * 5.1 + 0.4) +
    0.14 * Math.sin(a * 13.7 + 1.9) +
    0.07 * Math.sin(a * 31.3 + 0.7) +
    0.04 * Math.sin(a * 67.1 + 2.3);
  return Math.max(0, shape) * envelope * 115;
}

export class HorizonHills {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const positions: number[] = [];
    const heights: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2 - Math.PI;
      const x = Math.sin(a) * RADIUS;
      const z = -Math.cos(a) * RADIUS;
      const h = ridge(a);
      positions.push(x, -40, z, x, h, z);
      heights.push(0, 1);
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const b = i * 2;
      // Faces point inward, towards the camera at the centre.
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('ridge', new THREE.Float32BufferAttribute(heights, 1));
    geo.setIndex(indices);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uFoot: { value: new THREE.Color(0xc0d0de) },
        uRidge: { value: new THREE.Color(0x8ea6bf) },
      },
      vertexShader: /* glsl */ `
        attribute float ridge;
        varying float vRidge;
        void main() {
          vRidge = ridge;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFoot;
        uniform vec3 uRidge;
        varying float vRidge;
        void main() {
          gl_FragColor = vec4(mix(uFoot, uRidge, smoothstep(0.1, 1.0, vRidge)), 1.0);
        }
      `,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    // Drawn straight after the sky and before everything else.
    this.mesh.renderOrder = -999;
  }

  /** Colour the hills from the air they stand in. */
  setPalette(fog: THREE.Color, skyBottom: THREE.Color): void {
    const foot = this.material.uniforms.uFoot.value as THREE.Color;
    const ridgeCol = this.material.uniforms.uRidge.value as THREE.Color;
    foot.copy(fog).lerp(skyBottom, 0.25);
    ridgeCol.copy(fog).lerp(skyBottom, 0.7).multiplyScalar(0.86);
  }

  follow(x: number, z: number): void {
    this.mesh.position.set(x, 0, z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
