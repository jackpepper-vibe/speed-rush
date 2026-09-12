import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GradeShader } from './GradeShader';
import { SkyDome } from './SkyDome';
import { resolveQuality, type QualitySettings } from './Quality';

/**
 * Renderer, camera, lighting and the post chain.
 *
 * Everything visual that is not an object in the world lives here: the sky, the
 * sun, the fog, the tone map and the grade. Systems that want a different look
 * — night, a storm, a tunnel — set properties on this rig rather than reaching
 * for the renderer, so there is one place where "how the game looks right now"
 * is decided.
 */
export class SceneRig {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;

  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: SkyDome;

  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly fog: THREE.FogExp2;

  readonly quality: QualitySettings;

  /**
   * Set if the GPU ever drops the context.
   *
   * Worth surfacing rather than swallowing: after a loss three.js returns from
   * `render` without drawing and without throwing, so every downstream symptom
   * — a black canvas, zero draw calls, a screenshot of nothing — looks like a
   * scene-graph bug. This is the one place that can tell the difference.
   */
  contextLost = false;
  contextLostAt = -1;

  /** Counters for the last completed frame, across every pass. */
  readonly frameStats = { calls: 0, triangles: 0 };

  /** Chase-camera state, integrated rather than snapped. */
  private readonly camTarget = new THREE.Vector3();
  private camShake = 0;
  private shakeSeed = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.quality = resolveQuality(this.renderer.getContext());

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.3, 2600);
    this.camera.position.set(0, 6.2, 13.5);

    this.fog = new THREE.FogExp2(0x9fc4e8, 0.0034);
    this.scene.fog = this.fog;

    this.sky = new SkyDome();
    this.scene.add(this.sky.mesh);

    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x4a4335, 1.15);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.sun.position.set(-58, 90, -40);
    this.sun.castShadow = this.quality.shadows;
    this.sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    // The shadow frustum tracks the car; it only ever needs to cover the
    // stretch of road actually on screen.
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 320;
    cam.left = -90;
    cam.right = 90;
    cam.top = 90;
    cam.bottom = -90;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      this.quality.bloomStrength,
      0.72,
      0.82,
    );
    this.bloom.enabled = this.quality.bloom;
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.onResize);
  }

  /* ------------------------------------------------------------- appearance */

  /** Ambient/sun/fog/sky palette, driven by the day-night and weather systems. */
  applyLighting(opts: {
    sunColor: number;
    sunIntensity: number;
    skyTop: number;
    skyBottom: number;
    horizon: number;
    hemiSky: number;
    hemiGround: number;
    hemiIntensity: number;
    fogColor: number;
    fogDensity: number;
    sunElevation: number;
    exposure: number;
  }): void {
    this.sun.color.setHex(opts.sunColor);
    this.sun.intensity = opts.sunIntensity;
    const elev = THREE.MathUtils.clamp(opts.sunElevation, -0.3, 1);
    this.sun.position.set(-58, 22 + elev * 88, -40);

    this.hemi.color.setHex(opts.hemiSky);
    this.hemi.groundColor.setHex(opts.hemiGround);
    this.hemi.intensity = opts.hemiIntensity;

    this.fog.color.setHex(opts.fogColor);
    this.fog.density = opts.fogDensity;

    this.sky.setPalette(opts.skyTop, opts.skyBottom, opts.horizon);
    this.renderer.toneMappingExposure = opts.exposure;
  }

  setBloom(strength: number, radius: number, threshold: number): void {
    if (!this.quality.bloom) return;
    this.bloom.strength = strength;
    this.bloom.radius = radius;
    this.bloom.threshold = threshold;
  }

  /** Speed-reactive grade: vignette, chromatic fringe, saturation. */
  setGrade(speedFraction: number, nitro: number, wet: number): void {
    const u = this.grade.uniforms;
    u.uVignette.value = 0.34 + speedFraction * 0.3 + nitro * 0.24;
    u.uAberration.value = speedFraction * 0.0022 + nitro * 0.006;
    u.uSaturation.value = 1.06 + nitro * 0.22 - wet * 0.16;
    u.uSpeedLines.value = nitro;
    u.uWet.value = wet;
  }

  addShake(amount: number): void {
    this.camShake = Math.min(this.camShake + amount, 1.6);
  }

  /* ----------------------------------------------------------------- camera */

  /**
   * Position the chase camera behind a moving target.
   *
   * Lag is intentional and speed-dependent: the camera falls further back and
   * lower as the car accelerates, which reads as speed far more strongly than
   * raising the FOV alone.
   */
  updateCamera(
    targetX: number,
    targetY: number,
    targetZ: number,
    speedFraction: number,
    lateralVel: number,
    dt: number,
  ): void {
    const back = 12.4 + speedFraction * 3.6;
    const height = 5.4 + speedFraction * 1.1;

    this.camTarget.set(
      targetX * 0.74 + lateralVel * 0.09,
      targetY + height,
      targetZ + back,
    );
    // Critically-damped follow, framerate independent.
    const k = 1 - Math.exp(-9.5 * dt);
    this.camera.position.lerp(this.camTarget, k);

    this.camera.fov = 62 + speedFraction * 16;
    this.camera.updateProjectionMatrix();

    if (this.camShake > 0.001) {
      this.shakeSeed += dt * 47;
      const s = this.camShake;
      this.camera.position.x += Math.sin(this.shakeSeed * 1.7) * s * 0.42;
      this.camera.position.y += Math.sin(this.shakeSeed * 2.3) * s * 0.3;
      this.camShake = Math.max(0, this.camShake - dt * 2.6);
    }

    this.camera.lookAt(targetX * 0.62, targetY + 1.5, targetZ - 17);

    // Keep the shadow frustum centred on the action.
    this.sun.position.z = targetZ - 40;
    this.sun.target.position.set(targetX, 0, targetZ - 24);
    this.sun.target.updateMatrixWorld();
    this.sky.mesh.position.set(targetX, 0, targetZ);
  }

  /**
   * Draw the frame.
   *
   * `info` is reset by hand rather than per-pass. Left on automatic, each pass
   * in the composer clears the counters the previous one filled, so anything
   * reading `info.render` afterwards sees only the final fullscreen quad — one
   * triangle — and concludes the scene is empty. Accumulating across the whole
   * chain makes the numbers mean "submitted this frame", which is what both the
   * probe and any future perf budget actually want.
   */
  render(): void {
    if (this.contextLost) return;
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.composer.render();
    this.frameStats.calls = this.renderer.info.render.calls;
    this.frameStats.triangles = this.renderer.info.render.triangles;
  }

  private readonly onContextLost = (event: Event): void => {
    // Preventing the default is what makes a restore possible at all.
    event.preventDefault();
    this.contextLost = true;
    console.warn('[SceneRig] WebGL context lost — rendering suspended');
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    console.warn('[SceneRig] WebGL context restored');
  };

  private readonly onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.composer.dispose();
    this.renderer.dispose();
    this.sky.dispose();
  }
}
