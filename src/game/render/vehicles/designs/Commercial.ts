import * as THREE from 'three';
import { curve } from '../Curve';
import type { BodySpec, WheelSpec } from '../BodyShell';
import type { DesignContext, VehicleDesign } from '../Design';
import { addWheel, pair, panel, place, plate, rectLamp, roundedBox } from '../Parts';
import { SURF, withTex } from '../Surfaces';
import { ATLAS } from '../VehicleAtlas';

/**
 * Trucks and buses.
 *
 * Neither is lofted. A chase camera only ever sees the back of a lorry and the
 * flank of one it is passing, so both are built from panels: a box, a rear face
 * carrying doors or a screen, lamps big enough to have parts, an underrun bar,
 * mudflaps and twin wheels. The loft still runs — with a degenerate body tucked
 * inside the box — so every design goes through the same factory.
 */

const hidden = (length: number, wheel: WheelSpec): BodySpec => ({
  length,
  frontAxle: 0.15,
  rearAxle: 0.8,
  track: 1.9,
  rearTrack: 1.9,
  frontWheel: wheel,
  rearWheel: wheel,
  archClearance: 0.05,
  flare: 0,
  // A small slab inside the chassis; everything visible is added in details.
  rails: {
    rocker: curve([0, 0.8], [1, 0.8]),
    belt: curve([0, 1.0], [1, 1.0]),
    top: curve([0, 1.0], [1, 1.0]),
    halfWidth: curve([0, 0.5], [1, 0.5]),
    shoulderInset: curve([0, 0.05], [1, 0.05]),
  },
  shoulderRadius: 0.03,
  sideBulge: 0,
  tuck: 0.02,
  nose: { bulge: 0.01, fillet: 0.02 },
  tail: { bulge: 0.01, fillet: 0.02 },
  paint: SURF.underbody,
});

const TRUCK_WHEEL: WheelSpec = { radius: 0.5, width: 0.28, rim: 0.56, style: 'truck', finish: SURF.rimSilver, caliper: null };
const DUAL_WHEEL: WheelSpec = { radius: 0.5, width: 0.5, rim: 0.56, style: 'truck', finish: SURF.rimSilver, caliper: null };
const truckDoors = withTex(SURF.paintSatin, ATLAS.truckDoors, 'truck-doors');
const busRear = withTex(SURF.paintSatin, ATLAS.busRear, 'bus-rear');

export const TRUCK: VehicleDesign = {
  id: 'truck',
  metallic: false,
  body: () => hidden(8.4, TRUCK_WHEEL),
  details(ctx: DesignContext): void {
    const { b, hero } = ctx;
    const paint = ctx.paint;
    const rearZ = 4.2;
    // Cargo box.
    b.addGeometry(roundedBox(2.46, 2.6, 6.2, 0.05, 1), place(0, 2.36, rearZ - 3.1), paint);
    // Rear doors, framed.
    b.addGeometry(panel(2.34, 2.46), place(0, 2.36, rearZ + 0.012), truckDoors);
    for (const [w, h, x, y] of [[2.46, 0.08, 0, 3.64], [2.46, 0.1, 0, 1.08], [0.07, 2.6, 1.2, 2.36], [0.07, 2.6, -1.2, 2.36]] as const) {
      b.addGeometry(roundedBox(w, h, 0.06, 0.015, 1), place(x, y, rearZ + 0.02), SURF.trimSatin);
    }
    // Marker lamps along the top edge.
    for (const x of [-1.05, -0.5, 0.5, 1.05]) {
      b.addGeometry(roundedBox(0.1, 0.05, 0.04, 0.012, 1), place(x, 3.58, rearZ + 0.05), SURF.amberMarker);
    }
    // Chassis, underrun bar, mudflaps.
    b.addGeometry(roundedBox(1.9, 0.32, 7.6, 0.03, 1), place(0, 0.86, -0.1), SURF.underbody);
    b.addGeometry(roundedBox(2.3, 0.14, 0.1, 0.03, 1), place(0, 0.52, rearZ - 0.06), SURF.trimSatin);
    pair(b, roundedBox(0.08, 0.34, 0.08, 0.02, 1), place(0.7, 0.72, rearZ - 0.1), SURF.trimSatin);
    pair(b, panel(0.52, 0.5), place(0.95, 0.52, rearZ - 0.55), SURF.rubber);
    // Rear lamp clusters, low on each side of the bar.
    rectLamp(b, 0.86, 0.86, rearZ + 0.02, 0.42, 0.16, SURF.tailCluster, SURF.trimSatin, 1, { corner: 0.02 });
    // Plate on the underrun bar, where a lorry carries it.
    plate(b, 0.52, rearZ - 0.01, ctx.plate, 1);
    ctx.exhausts.push(new THREE.Vector3(-0.8, 0.5, rearZ - 0.6));
    // Cab ahead of the box.
    b.addGeometry(roundedBox(2.42, 2.35, 1.9, 0.16, hero ? 2 : 1), place(0, 1.78, -3.25), paint);
    b.addGeometry(panel(2.1, 0.9, 0.08, 4), place(0, 2.35, -4.21, 0, Math.PI, 0), SURF.glass);
    b.addGeometry(roundedBox(1.7, 0.5, 0.06, 0.04, 1), place(0, 1.3, -4.22), SURF.grille);
    // Headlamps either side of the grille, set in the bumper line.
    rectLamp(b, 0.78, 0.94, -4.21, 0.34, 0.14, SURF.headSquare, SURF.trimSatin, -1, { corner: 0.03 });
    ctx.headlamps.push(new THREE.Vector3(0.78, 0.94, -4.21), new THREE.Vector3(-0.78, 0.94, -4.21));
    b.addGeometry(roundedBox(2.4, 0.2, 0.12, 0.05, 1), place(0, 0.72, -4.2), SURF.trimSatin);
    plate(b, 0.72, -4.27, ctx.plate, -1);
    // Side guards between the axles.
    pair(b, roundedBox(0.04, 0.22, 3.4, 0.01, 1), place(1.18, 0.7, 0.1), SURF.trimSatin);
    // Wheels: single front, twin rears.
    for (const side of [1, -1] as const) {
      addWheel(b, TRUCK_WHEEL, new THREE.Vector3(side * 1.03, 0.5, -3.25), side, true, hero);
      addWheel(b, DUAL_WHEEL, new THREE.Vector3(side * 0.93, 0.5, 2.3), side, false, hero);
      addWheel(b, DUAL_WHEEL, new THREE.Vector3(side * 0.93, 0.5, 3.35), side, false, hero);
    }
  },
};

const BUS_WHEEL: WheelSpec = { radius: 0.5, width: 0.3, rim: 0.56, style: 'truck', finish: SURF.rimSilver, caliper: null };

export const BUS: VehicleDesign = {
  id: 'bus',
  metallic: false,
  body: () => hidden(11.6, BUS_WHEEL),
  details(ctx: DesignContext): void {
    const { b, hero } = ctx;
    const paint = ctx.paint;
    const rearZ = 5.8;
    b.addGeometry(roundedBox(2.52, 2.78, 11.6, 0.2, hero ? 3 : 2), place(0, 1.84, 0), paint);
    // Window band down both flanks and the screen at the front.
    pair(b, roundedBox(0.02, 1.02, 10.3, 0.008, 1), place(1.265, 2.3, -0.35), SURF.glass);
    b.addGeometry(panel(2.3, 1.5, 0.05, 4), place(0, 2.2, -5.81, 0, Math.PI, 0), SURF.glass);
    // Rear face: screen, engine grille, lamps, bumper.
    b.addGeometry(panel(2.36, 2.5), place(0, 1.9, rearZ + 0.012), busRear);
    b.addGeometry(roundedBox(2.5, 0.28, 0.14, 0.05, 1), place(0, 0.58, rearZ + 0.02), SURF.trimSatin);
    rectLamp(b, 1.06, 1.12, rearZ + 0.02, 0.2, 0.5, SURF.tailCluster, SURF.trimGloss, 1, { corner: 0.04 });
    b.addGeometry(roundedBox(0.9, 0.12, 0.04, 0.02, 1), place(0, 3.08, rearZ + 0.02), SURF.amberMarker);
    plate(b, 0.58, rearZ + 0.09, ctx.plate, 1);
    // Front: headlamps low in the corners under the screen, and a bumper.
    rectLamp(b, 0.92, 0.95, -5.81, 0.34, 0.16, SURF.headSquare, SURF.trimGloss, -1, { corner: 0.03 });
    ctx.headlamps.push(new THREE.Vector3(0.92, 0.95, -5.81), new THREE.Vector3(-0.92, 0.95, -5.81));
    b.addGeometry(roundedBox(2.5, 0.28, 0.14, 0.05, 1), place(0, 0.58, -5.82), SURF.trimSatin);
    ctx.exhausts.push(new THREE.Vector3(0.9, 0.35, rearZ));
    for (const side of [1, -1] as const) {
      addWheel(b, BUS_WHEEL, new THREE.Vector3(side * 1.06, 0.5, -3.9), side, true, hero);
      addWheel(b, BUS_WHEEL, new THREE.Vector3(side * 1.06, 0.5, 3.3), side, false, hero);
    }
  },
};
