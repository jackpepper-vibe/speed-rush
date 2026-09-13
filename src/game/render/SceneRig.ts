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
/**
 * How far the sky has to move before the environment is worth rebuilding, and
 * the floor on how often that can happen.
 *
 * The pair matters: the threshold alone would rebuild every frame during a fast
 * dusk, and the render gap alone would rebuild forever under a static midday
 * sky. A PMREM pass is cheap next to a frame but not free.
 */
const ENV_SIGNATURE_STEP = 1.5;
const ENV_MIN_SECONDS = 2;

export class SceneRig {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;

  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /**
   * A key light from behind the camera.
   *
   * Not decoration — a structural fix for the one thing a chase camera does
   * that a free camera does not. The sun has to sit ahead of the car for the
   * horizon to be worth looking at, which means the only face of the car ever
   * pointed at the player is the one permanently turned away from the sun. With
   * the sun alone the hero rendered as a black cut-out with brake lights in it,
   * and every attempt to fix that by raising the ambient fill flattened the
   * whole world instead.
   *
   * Kept dimmer and cooler than the sun, and it casts no shadow: two shadow
   * casters means two shadow maps, and this one would only ever draw a second
   * shadow of the car directly beneath the first.
   */
  readonly fill: THREE.DirectionalLight;
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

  /*
   * Environment map, generated from the sky.
   *
   * This is what makes car paint behave like paint. Without it a panel is a
   * flat colour that never changes from dawn to midnight; with it the metallic
   * flake and clearcoat have something to reflect, so the same car reads warm
   * at dusk and cold under a storm without anything touching its material.
   *
   * Regenerated only when the palette has actually moved, and never more than
   * once every few seconds — a PMREM pass renders a small cubemap, which is
   * cheap next to a frame but not free, and the sky is a smooth gradient that
   * gains nothing from being resampled continuously.
   */
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envBuilds = 0;
  /** Palette signature the current map was built from, and the live one. */
  private envBuiltSignature = Number.NaN;
  private envSignature = 0;
  /**
   * World time, advanced by the simulation rather than by frames.
   *
   * The rate limit has to mean "not more often than this much of the journey",
   * not "not more often than this many frames". Frames and world time only
   * track each other while something is driving the loop in real time; a
   * headless run advances two minutes of daylight inside a single render, and a
   * frame-counted limit silently refuses to rebuild for any of it.
   */
  private envClock = 0;
  private envLastBuild = Number.NEGATIVE_INFINITY;

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

    // A second dome sharing the same material, so the environment is always
    // the sky the player is actually under rather than a stale copy of it.
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    const envSky = new THREE.Mesh(this.sky.mesh.geometry, this.sky.mesh.material);
    envSky.frustumCulled = false;
    this.envScene.add(envSky);

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

    this.fill = new THREE.DirectionalLight(0xdce8ff, 1.5);
    this.fill.position.set(9, 7, 22);
    this.scene.add(this.fill);
    this.scene.add(this.fill.target);

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

    // The camera key tracks the sun's strength rather than sitting at a fixed
    // level: a fill that does not dim at dusk turns every night scene into a
    // studio shot. Floored, though — at midnight the hero still has to be a car
    // rather than a hole in the road.
    this.fill.intensity = 0.55 + opts.sunIntensity * 0.42;
    this.fill.color.setHex(opts.hemiSky);

    this.fog.color.setHex(opts.fogColor);
    this.fog.density = opts.fogDensity;

    this.sky.setPalette(opts.skyTop, opts.skyBottom, opts.horizon);
    this.renderer.toneMappingExposure = opts.exposure;

    // A scalar standing in for "what the sky looks like". The environment is
    // rebuilt when this has moved, rather than on a timer — a timer measured in
    // frames says nothing about whether there is anything new to reflect.
    this.envSignature =
      opts.skyTop * 1e-3 + opts.skyBottom * 1e-4 + opts.horizon * 1e-5 +
      opts.sunIntensity * 40 + opts.sunElevation * 25;
  }

  /**
   * Rebuild the environment map if the sky has moved on.
   *
   * Driven from the frame rather than from `applyLighting`, which is called
   * every tick: the cooldown is what keeps a continuous day cycle from asking
   * for a cubemap a hundred and twenty times a second.
   */
  /**
   * Advance the world clock the environment refresh is rate-limited against,
   * and with it anything in the grade that animates.
   *
   * The rain-on-the-lens streaks were written against `uTime` and nothing ever
   * moved it, so they hung motionless on the screen for the length of a storm —
   * a pattern of dots rather than water running off a windscreen.
   */
  advanceClock(dt: number): void {
    this.envClock += dt;
    this.grade.uniforms.uTime.value += dt;
  }

  private refreshEnvironment(): void {
    if (this.contextLost) return;

    const moved = Math.abs(this.envSignature - this.envBuiltSignature);
    const first = Number.isNaN(this.envBuiltSignature);
    if (!first && (moved < ENV_SIGNATURE_STEP || this.envClock - this.envLastBuild < ENV_MIN_SECONDS)) {
      return;
    }
    this.envBuiltSignature = this.envSignature;
    this.envLastBuild = this.envClock;

    const previous = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene);
    this.scene.environment = this.envTarget.texture;
    this.envBuilds += 1;
    // Disposed after the replacement is bound, so no frame is left pointing at
    // a texture that has just been released.
    previous?.dispose();
  }

  /** How many times the environment has been regenerated. Read by the probe. */
  get environmentBuilds(): number {
    return this.envBuilds;
  }

  get hasEnvironment(): boolean {
    return this.scene.environment !== null;
  }

  setBloom(strength: number, radius: number, threshold: number): void {
    if (!this.quality.bloom) return;
    this.bloom.strength = strength;
    this.bloom.radius = radius;
    this.bloom.threshold = threshold;
  }

  /** Speed-reactive grade: vignette, chromatic fringe, saturation, blur. */
  setGrade(speedFraction: number, nitro: number, wet: number): void {
    this.lastGrade = [speedFraction, nitro, wet];
    const u = this.grade.uniforms;
    u.uVignette.value = 0.3 + speedFraction * 0.2 + nitro * 0.14;
    // An order of magnitude down. At the old strength every high-contrast edge
    // in the frame — every palm, every barrier post — carried a visible rainbow
    // fringe, which reads as a broken renderer rather than as speed.
    u.uAberration.value = speedFraction * 0.0004 + nitro * 0.0012;
    u.uSaturation.value = 1.1 + nitro * 0.12 - wet * 0.16;
    u.uSpeedLines.value = nitro * 0.35;
    u.uWet.value = wet;

    /*
     * Contrast rises with speed, and the blur with it.
     *
     * Both are the same idea: at a crawl the frame should be readable, and at
     * three hundred it should be a punch. Wet weather takes contrast back out
     * — a rain-lit road is a low-contrast one, and leaving the curve hard
     * through a storm made the grade fight the weather.
     */
    u.uContrast.value = 1.08 + speedFraction * 0.1 + nitro * 0.05 - wet * 0.1;
    u.uCurve.value = 0.3 + nitro * 0.1;
    u.uLift.value = 0.05 - nitro * 0.012;
    // Held at zero below half speed: the taps are four full-frame reads, and
    // there is nothing to smear at the pace the menu idles at.
    const blur = Math.max(0, speedFraction - 0.45) / 0.55;
    const blurAllowed = this.motionBlurOverride ?? this.quality.motionBlur;
    u.uRadialBlur.value = blurAllowed ? blur * 0.009 + nitro * 0.015 : 0;
  }


  /**
   * Force the radial blur on or off, overriding the tier.
   *
   * A test seam, and the only honest way to measure the blur: it removes edge
   * energy rather than adding luminance, so it can only be seen as the
   * difference between two frames that are otherwise identical — and the
   * obvious comparison, at rest against under boost, is confounded by the
   * speed streaks nitro also raises in exactly the corners being sampled.
   * `null` hands the decision back to the quality tier.
   */
  setMotionBlurOverride(enabled: boolean | null): void {
    this.motionBlurOverride = enabled;
    // Re-applied at once rather than left for the next tick. A caller that
    // switches this and renders without advancing the simulation — which is
    // the only way to compare two otherwise identical frames — would otherwise
    // measure the setting it had before.
    this.setGrade(...this.lastGrade);
  }

  private motionBlurOverride: boolean | null = null;
  /** The last inputs the grade was driven with, so it can be re-applied. */
  private lastGrade: [number, number, number] = [0, 0, 0];

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
    /*
     * Low and close.
     *
     * The first framing sat twelve to sixteen units back and five to six up,
     * which at speed reduced the car to a smudge seen from above — every detail
     * on it was invisible, and the frame was four-fifths road surface. A chase
     * camera for a car game wants to be near bumper height and close enough
     * that the body fills the bottom of the screen; the road reads as fast
     * because it is rushing past the camera, not because there is more of it.
     */
    const back = 8.2 + speedFraction * 1.9;
    const height = 2.45 + speedFraction * 0.55;

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

    // Aimed just over the roof and well down the road: looking at the car
    // itself puts the horizon off the top of the frame at this height.
    this.camera.lookAt(targetX * 0.62, targetY + 1.15, targetZ - 26);

    // Keep the shadow frustum centred on the action.
    this.sun.position.z = targetZ - 40;
    this.sun.target.position.set(targetX, 0, targetZ - 24);
    this.sun.target.updateMatrixWorld();

    // The camera key rides with the car, offset to the side the sun is not on
    // so the two do not stack into one flat front-light.
    this.fill.position.set(targetX + 9, targetY + 7, targetZ + 22);
    this.fill.target.position.set(targetX, targetY + 0.6, targetZ - 6);
    this.fill.target.updateMatrixWorld();
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
    this.refreshEnvironment();
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
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.sky.dispose();
  }
}
