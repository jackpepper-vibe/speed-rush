import * as THREE from 'three';
import { buildPlayerCar, type Vehicle } from '@/game/render/vehicles/VehicleFactory';
import { CARS, type CarDef } from '@/game/config/Cars';

/**
 * Rendered previews of the cars, for the garage.
 *
 * The shop used to show a coloured square, which told you nothing about the
 * thing you were about to spend six thousand coins on — the six bodies differ
 * in silhouette far more than in paint, and the swatch hid exactly the
 * difference a buyer cares about.
 *
 * Each preview is a real render of the same mesh the game will put on the road,
 * built by the same factory. That matters: a preview drawn any other way is a
 * second source of truth that will eventually disagree with the car you get.
 *
 * Rendered once into data URLs and cached. The renderer is built lazily, used
 * for the whole set, and then disposed — a second WebGL context is cheap to
 * hold for a few milliseconds and wasteful to keep alive for a session,
 * particularly on hardware where contexts are scarce enough that the game has
 * already lost one.
 */

const WIDTH = 320;
const HEIGHT = 200;

const cache = new Map<string, string>();

/** Three-quarter rear view: the tail, the flank and the roofline at once. */
const VIEW_DIRECTION = new THREE.Vector3(4.6, 1.63, 5.4).normalize();
/**
 * How far out the camera stands, in half-diagonals of the vehicle's own box:
 * the distance the cars were first framed from, over a car's. Measured before
 * the showroom turn, which widens the box without changing the car. Framing by size rather than from one
 * fixed spot is what keeps a bike, half a car's length, from being a speck in
 * the corner of its card.
 */
const DISTANCE_PER_RADIUS = 2.8;

function frameCamera(aspect: number): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(30, aspect, 0.1, 100);
}

function frameVehicle(camera: THREE.PerspectiveCamera, vehicle: Vehicle): void {
  vehicle.updateWorldMatrix(true, true);
  const box = vehicle.body.geometry.boundingBox ?? new THREE.Box3().setFromObject(vehicle.body);
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const centre = box.getCenter(new THREE.Vector3()).applyMatrix4(vehicle.body.matrixWorld);
  camera.position.copy(centre).addScaledVector(VIEW_DIRECTION, radius * DISTANCE_PER_RADIUS);
  camera.lookAt(centre);
}

function buildStage(): THREE.Scene {
  const scene = new THREE.Scene();

  // Key, fill and rim. The rim is what separates a dark car from a transparent
  // background; without it the Phantom and the Bruiser are both silhouettes.
  const key = new THREE.DirectionalLight(0xfff2e0, 3.1);
  key.position.set(5, 7, 4.5);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9fc0ff, 1.15);
  fill.position.set(-5, 2.5, 2);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd9b0, 2.4);
  rim.position.set(-3.5, 3, -6);
  scene.add(rim);

  scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x30343c, 1.0));

  return scene;
}

/**
 * A small gradient environment, so the clearcoat has something to reflect.
 *
 * Without it metallic paint renders nearly black: a metal with nothing around
 * it reflects nothing. The game's own sky map is not available here — this
 * scene is rendered on its own context — so a two-stop vertical gradient
 * stands in for it, which is all a car-sized reflection resolves anyway.
 */
function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for the preview environment');

  const gradient = ctx.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, '#cfe4ff');
  gradient.addColorStop(0.48, '#7d8ea6');
  gradient.addColorStop(0.52, '#2a2e36');
  gradient.addColorStop(1, '#15171c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 16, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(texture);
  pmrem.dispose();
  texture.dispose();
  return target.texture;
}

/**
 * Render every car once and cache the results.
 *
 * Returns a map of car id to PNG data URL. Safe to call repeatedly: after the
 * first call it returns the cache without touching the GPU.
 */
export function renderCarPreviews(defs: readonly CarDef[] = CARS): Map<string, string> {
  if (cache.size >= defs.length) return cache;

  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = buildStage();
    scene.environment = buildEnvironment(renderer);
    const camera = frameCamera(WIDTH / HEIGHT);

    for (const def of defs) {
      if (cache.has(def.id)) continue;

      const car = buildPlayerCar(def, defs.indexOf(def));
      // The underglow is a driving effect; on a showroom turntable it is a
      // bright smear across the floor that the card has no room for.
      if (car.glow) car.glow.visible = false;
      // Headlight spots belong to the road, not to a 320px thumbnail.
      car.setHeadlamps(0);

      car.rotation.y = -0.34;
      scene.add(car);
      frameVehicle(camera, car);

      renderer.render(scene, camera);
      cache.set(def.id, canvas.toDataURL('image/png'));

      // Releases what this copy owns — its materials — and takes it out of
      // the scene. The geometry is the design's, shared with the car on the
      // road, and stays.
      car.dispose();
    }

    scene.environment?.dispose();
  } catch {
    // No WebGL for a second context, or it failed to initialise. The garage
    // falls back to swatches; a shop without pictures still sells cars.
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss?.();
  }

  return cache;
}

export function previewFor(carId: string): string | null {
  return cache.get(carId) ?? null;
}

/** Ids that have a cached preview. Read by the preview coverage gate. */
export function previewIds(): string[] {
  return [...cache.keys()];
}
