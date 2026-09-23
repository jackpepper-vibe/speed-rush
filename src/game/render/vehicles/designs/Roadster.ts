import * as THREE from 'three';
import { curve } from '../Curve';
import type { BodySpec, QuadContext } from '../BodyShell';
import { planarUv } from '../BodyShell';
import type { DesignContext, VehicleDesign } from '../Design';
import { bar, driver, mirrors, place, plate, rollHoop, roundLamp, roundedBox, seat, exhaust } from '../Parts';
import { SURF, withTex, type Surface } from '../Surfaces';
import { ATLAS } from '../VehicleAtlas';
import { makeScreenGlass } from '../VehicleMaterial';
import { capInsert, fourWheels } from './common';

/**
 * The classic: a small mid-engined Italian roadster of the late sixties.
 *
 * The car the reference is built around, and the one the game starts in. Low
 * nose between rounded front wings, a cockpit open to the sky with the driver
 * in it, a targa hoop behind the seats, haunches swelling over the rear wheels
 * and a Kamm tail carrying four round lamps, a plate and two chrome quarter
 * bumpers. From the chase camera it is the tail, the hoop and the back of the
 * driver's head — which is to say it is exactly what the reference shows.
 */

const L = 4.23;
const zAt = (t: number): number => -L / 2 + t * L;

const DECK = { t0: 0.665, t1: 0.86, halfWidth: 0.36 };
const louvres: Surface = withTex(SURF.paintSatin, ATLAS.louvres, 'roadster-louvres');

function paintOut(q: QuadContext): Surface | null {
  if (q.part === 'tail' && q.y < 0.3) return SURF.trimSatin;
  if (q.piece === 'top' && q.t > DECK.t0 && q.t < DECK.t1 && Math.abs(q.x) < DECK.halfWidth) return louvres;
  return null;
}

export const ROADSTER: VehicleDesign = {
  id: 'roadster',
  metallic: false,

  body(paint): BodySpec {
    return {
      length: L,
      frontAxle: 0.2,
      rearAxle: 0.755,
      track: 1.43,
      rearTrack: 1.45,
      frontWheel: { radius: 0.31, width: 0.2, rim: 0.58, style: 'classic5', finish: SURF.rimSilver, caliper: null },
      rearWheel: { radius: 0.315, width: 0.215, rim: 0.58, style: 'classic5', finish: SURF.rimSilver, caliper: null },
      archClearance: 0.045,
      flare: 0.028,
      rails: {
        rocker: curve([0, 0.34], [0.06, 0.25], [0.13, 0.2], [0.3, 0.17], [0.7, 0.17], [0.88, 0.21], [0.96, 0.28], [1, 0.32]),
        belt: curve([0, 0.52], [0.05, 0.6], [0.13, 0.67], [0.22, 0.71], [0.33, 0.715], [0.45, 0.735], [0.6, 0.79], [0.72, 0.835], [0.83, 0.835], [0.93, 0.81], [1, 0.78]),
        top: curve([0, 0.5], [0.06, 0.57], [0.14, 0.615], [0.25, 0.655], [0.34, 0.7], [0.4, 0.735], [0.62, 0.79], [0.7, 0.83], [0.86, 0.84], [0.95, 0.825], [1, 0.8]),
        halfWidth: curve([0, 0.52], [0.04, 0.66], [0.1, 0.77], [0.2, 0.8], [0.33, 0.79], [0.46, 0.79], [0.58, 0.805], [0.72, 0.82], [0.86, 0.81], [0.96, 0.77], [1, 0.73]),
        shoulderInset: curve([0, 0.07], [0.2, 0.05], [0.45, 0.05], [0.75, 0.05], [1, 0.07]),
      },
      shoulderRadius: 0.065,
      sideBulge: 0.012,
      tuck: 0.075,
      nose: { bulge: 0.075, fillet: 0.055 },
      tail: { bulge: 0.028, fillet: 0.042 },
      cockpit: { start: 0.395, end: 0.615, depth: 0.47, edge: 0.8 },
      paint,
      paintOut,
      uvAt: planarUv('x', 'z', -DECK.halfWidth, DECK.halfWidth, zAt(DECK.t1), zAt(DECK.t0)),
    };
  },

  details(ctx: DesignContext): void {
    const { b, shell, hero } = ctx;
    fourWheels(ctx);

    // Tail: four round lamps, a plate between them, chrome quarter bumpers.
    const lampY = 0.625;
    roundLamp(b, 0.585, lampY, shell.tailZ(0.585, lampY), 0.066, SURF.tailRound, SURF.chrome, 1, hero);
    roundLamp(b, 0.42, lampY, shell.tailZ(0.42, lampY), 0.066, SURF.tailRoundDeep, SURF.chrome, 1, hero);
    plate(b, 0.47, shell.tailZ(0, 0.47), ctx.plate, 1, 0.5, 0.115);

    const bumperY = 0.385;
    for (const side of [1, -1]) {
      const pts = [
        new THREE.Vector3(side * 0.3, bumperY, shell.tailZ(0.3, bumperY) + 0.035),
        new THREE.Vector3(side * 0.55, bumperY, shell.tailZ(0.55, bumperY) + 0.03),
        new THREE.Vector3(side * 0.7, bumperY + 0.005, shell.tailZ(0.66, bumperY) - 0.03),
        new THREE.Vector3(side * 0.77, bumperY + 0.01, shell.tailZ(0.66, bumperY) - 0.2),
      ];
      bar(b, pts, 0.024, SURF.chrome, hero);
    }
    ctx.exhausts.push(...exhaust(b, 0.11, 0.265, shell.tailZ(0.11, 0.265) - 0.02, 0.032, 0.16, SURF.chrome, hero));

    // Nose: covered round headlamps, amber indicators, front quarter bumpers.
    // An oval mouth, low in the nose, above the quarter bumpers.
    capInsert(ctx, 'nose', { x: 0, y: 0.41, halfW: 0.34, halfH: 0.05, nx: 2, ny: 2 }, SURF.grille, { rim: SURF.chrome });
    const headY = 0.545;
    roundLamp(b, 0.56, headY, shell.noseZ(0.56, headY) + 0.02, 0.085, SURF.headRound, SURF.chrome, -1, hero);
    roundLamp(b, 0.52, 0.385, shell.noseZ(0.52, 0.385) + 0.01, 0.036, SURF.amberRound, SURF.chrome, -1, hero);
    ctx.headlamps.push(new THREE.Vector3(0.56, headY, shell.noseZ(0.56, headY)), new THREE.Vector3(-0.56, headY, shell.noseZ(0.56, headY)));
    for (const side of [1, -1]) {
      const y = 0.33;
      bar(b, [
        new THREE.Vector3(side * 0.28, y, shell.noseZ(0.28, y) - 0.03),
        new THREE.Vector3(side * 0.5, y, shell.noseZ(0.5, y) - 0.025),
        new THREE.Vector3(side * 0.64, y + 0.01, shell.noseZ(0.6, y) + 0.05),
        new THREE.Vector3(side * 0.7, y + 0.02, shell.noseZ(0.6, y) + 0.2),
      ], 0.02, SURF.chrome, hero);
    }

    // Mirrors on the doors, just behind the screen.
    const mt = 0.44;
    const shoulder = shell.shoulderAt(mt);
    mirrors(b, shoulder.x - 0.05, shoulder.y + 0.02, zAt(mt), SURF.chrome, hero);

    // Cockpit: dash, seats, the driver, the targa hoop.
    const floorY = 0.28;
    b.addGeometry(roundedBox(1.18, 0.14, 0.34, 0.05, hero ? 2 : 1), place(0, 0.64, zAt(0.425)), SURF.interior);
    seat(b, -0.3, floorY, zAt(0.565), hero);
    seat(b, 0.3, floorY, zAt(0.565), hero);
    driver(b, -0.3, floorY, zAt(0.56), zAt(0.465), hero);
    const hoopT = 0.618;
    rollHoop(b, 0.6, shell.shoulderAt(hoopT).y - 0.02, 0.33, zAt(hoopT), ctx.paint, hero);

    // The windscreen: a curved, raked sheet in a chrome frame, and the one
    // transparent surface on any vehicle in the game.
    const screen = windscreen(shell);
    if (hero) {
      const frame = screen.userData.frame as THREE.Vector3[];
      bar(b, frame, 0.014, SURF.chrome, hero);
    }
    ctx.extras.push(screen);
  },
};

/** The screen as its own transparent mesh, plus the path of its frame. */
function windscreen(shell: { shoulderAt(t: number): { x: number; y: number } }): THREE.Mesh {
  const t0 = 0.382;
  const t1 = 0.445;
  const baseY = shell.shoulderAt(t0).y - 0.02;
  const topY = 1.06;
  const cols = 10;
  const positions: number[] = [];
  const indices: number[] = [];
  const frameTop: THREE.Vector3[] = [];
  for (let r = 0; r <= 1; r++) {
    const t = r === 0 ? t0 : t1;
    const y = r === 0 ? baseY : topY;
    const half = r === 0 ? 0.66 : 0.58;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols * 2 - 1;
      // Wraps back at the corners, as a curved screen does.
      const z = zAt(t) + 0.09 * u * u;
      positions.push(u * half, y, z);
      if (r === 1) frameTop.push(new THREE.Vector3(u * half, y + 0.012, z));
    }
  }
  for (let c = 0; c < cols; c++) {
    const a = c;
    const bb = c + 1;
    const cc = c + cols + 1;
    const d = c + cols + 2;
    indices.push(a, bb, d, a, d, cc);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, makeScreenGlass());
  mesh.renderOrder = 3;
  const left = new THREE.Vector3(-0.66, baseY, zAt(t0) + 0.09);
  const right = new THREE.Vector3(0.66, baseY, zAt(t0) + 0.09);
  mesh.userData.frame = [left, ...frameTop, right];
  return mesh;
}
