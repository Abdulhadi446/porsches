/**
 * Model normalisation shared by the hero and the variant viewer.
 *
 * Sketchfab GLBs arrive in whatever unit system the author used: metres,
 * centimetres, or a node-scale stack that bakes the conversion. Rendering
 * scales is fine, but framing is not — drei's `<Bounds>` fits the true world
 * size and then `OrbitControls` clamps the camera away from it (a 4 cm car
 * becomes a speck), and the hero's turntable expects a fixed real-world size.
 *
 * So every loaded scene is re-scaled to a canonical road length, centred on
 * the origin, and dropped onto y = 0. Pure geometry maths; no side effects
 * outside the returned clone.
 */

import { Box3, Group, Vector3 } from "three";

/** real-world length every local GLB is normalised to (Porsche 911 ≈ 4.19–4.5 m) */
export const MODEL_LENGTH_M = 4.19;

/**
 * Clone `scene`, scale it so its longest ground-plane dimension equals
 * `length`, centre it on x/z and put its lowest point on y = 0.
 */
export function fitModelToLength(scene: Group, length = MODEL_LENGTH_M): Group {
  const clone = scene.clone(true);
  const box = new Box3().setFromObject(clone);
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);
  const groundSpan = Math.max(size.x, size.z) || 1;
  const scale = length / groundSpan;
  clone.scale.setScalar(scale);
  clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  clone.updateMatrixWorld(true);
  return clone;
}
