import * as T from "three";

// Native MovieClip virtual +0x30 returns rendered Y bounds, including the
// child's emission rotation and authored frame transforms, excluding the
// particle parent's scale. The imported geometry already contains the authored
// frame transforms and preserves the export origin. Do not substitute width here.
export function rotatedSpriteHeight(geometry: T.BufferGeometry, angle: number) {
  const positions = geometry.getAttribute("position");
  let low = Infinity,
    high = -Infinity;
  const sin = Math.sin(angle),
    cos = Math.cos(angle);
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getX(i) * sin + positions.getY(i) * cos;
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  return positions.count ? high - low : 0;
}

// Native 0x7ad38: midpoint origin, projected direction and (B + D) / B stretch.
// Camera-local XY gives the same distance ratio under our orthographic view.
// The caller composes parent rotation/stretch BEFORE child emission rotation.
export function particleTailPose(
  current: T.Vector3,
  delayed: T.Vector3,
  view: T.Quaternion,
  baseHeight: number,
) {
  const delta = current
    .clone()
    .sub(delayed)
    .applyQuaternion(view.clone().invert());
  const distance = Math.hypot(delta.x, delta.y);
  return {
    position: current.clone().add(delayed).multiplyScalar(0.5),
    angle: baseHeight > 0 ? Math.atan2(delta.y, delta.x) : 0,
    stretch: baseHeight > 0 ? (baseHeight + distance) / baseHeight : 1,
  };
}
