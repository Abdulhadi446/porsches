/**
 * Procedural 911 — the hero's always-available car.
 *
 * ASSET-3D is shipping Sketchfab embeds (they cannot be drawn inside our canvas)
 * and no licensed local `.glb` exists yet, so the hero needs a *first-class*
 * silhouette rather than a cube. This module builds one from the real side
 * profile of a 901/911: the outline is a small array of points in metres, taken
 * from the shape every 911 shares — long fastback rear glass, round wheel
 * arches, the low beltline, the upright nose, and the flat engine lid.
 *
 * Dimensions are real (a 1964 911 Coupé): 4.19 m long, 1.85 m wide, 1.30 m
 * tall, 2.45 m wheelbase, 0.34 m wheels. Keeping them true means the camera
 * framing, the floor reflection and the DOF focus distance all read correctly,
 * and dropping a real GLB in later needs no re-tuning.
 *
 * x runs rear → front (0 = rear bumper, 4.19 = nose), y is height above the
 * ground, z is lateral (the extrusion axis). The car is built with its contact
 * patch on y = 0 so it can be dropped straight onto the floor.
 */

import {
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  CylinderGeometry,
  Path,
  Shape,
  Vector3,
} from "three";

export const CAR = {
  length: 4.19,
  width: 1.85,
  height: 1.3,
  wheelbase: 2.45,
  wheelRadius: 0.34,
  tyreWidth: 0.245,
  /** rear axle from the rear bumper — 0.91 m rear overhang */
  rearAxle: 0.91,
  /** front axle from the rear bumper */
  frontAxle: 3.36,
  /** half of the body extrusion, minus the bevel */
  halfWidth: 0.87,
  /** glasshouse half-width */
  glassHalfWidth: 0.7,
} as const;

/**
 * Body outline, counter-clockwise: along the underside to the nose, up the
 * bumper, back along the bonnet, over the roof, down the rear glass and along
 * the engine lid. Mirrors an F-body 911 in profile.
 */
export const CAR_PROFILE: ReadonlyArray<readonly [number, number]> = [
  // underside: sills ride low so the arches have room to be cut above them
  [0.045, 0.15],
  [0.3, 0.12],
  [2.6, 0.118],
  [3.1, 0.116],
  [3.7, 0.108],
  [3.86, 0.104],
  // nose
  [4.115, 0.134],
  [4.19, 0.503],
  [4.15, 0.78],
  [4.043, 0.93],
  // bonnet
  [3.775, 0.946],
  [3.3, 0.975],
  [2.9, 0.99],
  // windscreen + roof
  [2.34, 1.296],
  [2.16, 1.29],
  // rear glass + engine lid
  [1.72, 0.945],
  [1.05, 0.952],
  [0.35, 0.962],
  [0.126, 0.858],
  // tail
  [0.042, 0.63],
  [0.0, 0.377],
];

/** Daylight opening (side glass), clockwise so it reads as a hole. */
export const CAR_DLO: ReadonlyArray<readonly [number, number]> = [
  [1.905, 1.045],
  [2.695, 1.062],
  [2.76, 0.905],
  [1.9, 0.93],
];

/**
 * Wheel arch cut-outs.
 *
 * Real 911 arches are arcs centred on the *axle*, not semicircles sitting on
 * the sill: a 0.68 m tyre needs an opening ~0.10 m taller than itself, so the arc
 * radius is 0.44 m about a hub 0.34 m off the ground, trimmed where it crosses
 * the sill line. That is what gives the body its wide, low arches.
 */
export const CAR_ARCHES = [
  { center: CAR.rearAxle, radius: 0.44, sill: 0.16 },
  { center: CAR.frontAxle, radius: 0.44, sill: 0.16 },
] as const;

function shapeFrom(points: ReadonlyArray<readonly [number, number]>): Shape {
  const shape = new Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return shape;
}

function holeFrom(points: ReadonlyArray<readonly [number, number]>): Path {
  const path = new Path();
  points.forEach(([x, y], index) => {
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
  return path;
}

function archHole(center: number, radius: number, sill: number): Path {
  const hub = CAR.wheelRadius;
  // where the arc crosses the sill line, measured from the hub
  const phi = Math.asin(Math.min(1, Math.max(-1, (hub - sill) / radius)));
  const path = new Path();
  // clockwise sweep: rear sill → over the top → front sill
  path.absarc(center, hub, radius, Math.PI + phi, -phi, true);
  return path;
}

/** Painted body: outline with the glasshouse and both arches cut out. */
export function createBodyGeometry(bevelSegments: number): ExtrudeGeometry {
  const shape = shapeFrom(CAR_PROFILE);
  shape.holes.push(holeFrom(CAR_DLO));
  for (const arch of CAR_ARCHES) {
    shape.holes.push(archHole(arch.center, arch.radius, arch.sill));
  }
  const geometry = new ExtrudeGeometry(shape, {
    depth: CAR.halfWidth * 2 - 0.08,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelOffset: 0,
    bevelSegments,
    curveSegments: 8,
  });
  geometry.translate(-CAR.length / 2, 0, -CAR.halfWidth + 0.04);
  geometry.computeVertexNormals();
  return geometry;
}

/** Side glass, inset so it reads through the body cut-out. */
export function createSideGlassGeometry(): ExtrudeGeometry {
  const geometry = new ExtrudeGeometry(shapeFrom(CAR_DLO), {
    depth: CAR.glassHalfWidth * 2 - 0.02,
    bevelEnabled: false,
    curveSegments: 4,
  });
  geometry.translate(-CAR.length / 2, 0, -(CAR.glassHalfWidth - 0.01));
  geometry.computeVertexNormals();
  return geometry;
}

function quadGeometry(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  const geometry = new BufferGeometry();
  const positions = new Float32Array([
    ...a.toArray(),
    ...b.toArray(),
    ...c.toArray(),
    ...a.toArray(),
    ...c.toArray(),
    ...d.toArray(),
  ]);
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute(
    "uv",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Windscreen + rear glass as two flat panels, pushed just outside the swept
 * body surface along their own normal so they never z-fight.
 */
export function createPanelGeometries(): {
  windscreen: BufferGeometry;
  backlight: BufferGeometry;
} {
  const hw = CAR.glassHalfWidth;
  const windscreen = quadGeometry(
    new Vector3(2.9 + 0.006, 0.99 + 0.011, -hw),
    new Vector3(2.9 + 0.006, 0.99 + 0.011, hw),
    new Vector3(2.36 + 0.006, 1.28 + 0.011, hw * 0.93),
    new Vector3(2.36 + 0.006, 1.28 + 0.011, -hw * 0.93),
  );
  const backlight = quadGeometry(
    new Vector3(1.74 - 0.008, 0.955 + 0.01, -hw),
    new Vector3(1.74 - 0.008, 0.955 + 0.01, hw),
    new Vector3(2.14 - 0.008, 1.27 + 0.01, hw * 0.93),
    new Vector3(2.14 - 0.008, 1.27 + 0.01, -hw * 0.93),
  );
  windscreen.translate(-CAR.length / 2, 0, 0);
  backlight.translate(-CAR.length / 2, 0, 0);
  return { windscreen, backlight };
}

/** One tyre + one rim, both axis-aligned to z, ready to be placed four times. */
export function createWheelGeometries(segments: number): {
  tyre: CylinderGeometry;
  rim: CylinderGeometry;
} {
  const tyre = new CylinderGeometry(
    CAR.wheelRadius,
    CAR.wheelRadius,
    CAR.tyreWidth,
    segments,
    1,
    false,
  );
  tyre.rotateX(Math.PI / 2);
  const rim = new CylinderGeometry(0.216, 0.216, CAR.tyreWidth - 0.05, segments, 1, false);
  rim.rotateX(Math.PI / 2);
  return { tyre, rim };
}

/** Axle positions: [x, y, z] per wheel, front-left first. */
export function wheelPlacements(): Array<[number, number, number]> {
  const y = CAR.wheelRadius;
  const z = CAR.width / 2 - CAR.tyreWidth / 2;
  const out: Array<[number, number, number]> = [];
  for (const x of [CAR.rearAxle, CAR.frontAxle]) {
    for (const side of [-1, 1]) {
      out.push([x - CAR.length / 2, y, side * z]);
    }
  }
  return out;
}
