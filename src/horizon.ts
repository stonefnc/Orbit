import { CallbackProperty, Cartesian3, Ellipsoid, type Camera } from "cesium";

const R_MIN = Ellipsoid.WGS84.minimumRadius;
/** Steps of 2 %: points rewrite their vertex data only when the value changes, i.e. on zoom, not on every pan frame. */
const STEP_LOG = Math.log(1.02);

/**
 * Distance from the camera to the Earth's horizon, rounded up to the next 2 % step. Every point on the near side of
 * the globe is closer than this, and every point hidden behind it is farther, so it is the right
 * `disableDepthTestDistance`: within it a dot skips the depth test (sea-level and ground dots are never clipped by
 * terrain), beyond it the globe hides what is behind it. The polar radius makes it slightly generous; a dot that slips
 * through sits within a pixel of the limb.
 */
export function horizonDistance(cameraPositionWC: Cartesian3): number {
  const d = Math.sqrt(Math.max(1, Cartesian3.magnitudeSquared(cameraPositionWC) - R_MIN * R_MIN));
  return Math.exp(Math.ceil(Math.log(d) / STEP_LOG) * STEP_LOG);
}

const byCamera = new WeakMap<Camera, CallbackProperty>();

/**
 * A shared `disableDepthTestDistance` for entity points and billboards that should hide behind the Earth instead of
 * showing through it (`Number.POSITIVE_INFINITY` draws the far side's dots on top of the globe). One property per
 * camera; the value is recomputed only when the camera has moved.
 */
export function horizonDepthTest(camera: Camera): CallbackProperty {
  let prop = byCamera.get(camera);
  if (!prop) {
    let lastR2 = -1;
    let value = Number.POSITIVE_INFINITY;
    prop = new CallbackProperty(() => {
      const r2 = Cartesian3.magnitudeSquared(camera.positionWC);
      if (r2 !== lastR2) {
        lastR2 = r2;
        value = horizonDistance(camera.positionWC);
      }
      return value;
    }, false);
    byCamera.set(camera, prop);
  }
  return prop;
}
