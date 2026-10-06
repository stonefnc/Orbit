import { Cartesian3, Matrix4, Transforms, type Viewer } from "cesium";

/**
 * Locks the camera onto a moving target. The camera keeps its current distance and angle relative to the target and
 * moves with it; the normal mouse controls (drag to orbit, wheel to zoom) keep working around the target.
 * Returns a function that releases the camera.
 */
export function startFollow(viewer: Viewer, getPosition: () => Cartesian3 | undefined): () => void {
  const camera = viewer.camera;
  const scene = viewer.scene;
  const start = getPosition();
  if (!start) return () => {};

  const frame = Transforms.eastNorthUpToFixedFrame(start);
  const local = Matrix4.multiplyByPoint(Matrix4.inverse(frame, new Matrix4()), camera.positionWC, new Cartesian3());
  // Keep a sensible minimum distance so we never start inside the target.
  const dist = Cartesian3.magnitude(local);
  if (dist < 50) Cartesian3.multiplyByScalar(Cartesian3.normalize(local, local), 400, local);
  camera.lookAtTransform(frame, local);

  let active = true;
  const offset = new Cartesian3();
  const tick = (): void => {
    if (!active) return;
    const p = getPosition();
    if (!p) return;
    // While a transform is set, camera.position is already expressed in that frame. Re-applying it as the offset of
    // the new frame (which is centred on the target's new position) carries the camera along, and keeps whatever
    // orbit/zoom the user has dragged to.
    Cartesian3.clone(camera.position, offset);
    camera.lookAtTransform(Transforms.eastNorthUpToFixedFrame(p), offset);
  };
  scene.preRender.addEventListener(tick);

  return () => {
    if (!active) return;
    active = false;
    scene.preRender.removeEventListener(tick);
    camera.lookAtTransform(Matrix4.IDENTITY);
    scene.requestRender();
  };
}
