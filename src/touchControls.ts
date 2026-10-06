import {
  CameraEventType,
  Cartesian2,
  Cartesian3,
  HeadingPitchRange,
  KeyboardEventModifier,
  Math as CesiumMath,
  BoundingSphere,
  Matrix4,
  type Viewer
} from "cesium";
import { isPhoneClass, PHONE_QUERY } from "./mobilePerf";

/** Pinch-zoom speed on touch screens (Cesium's default is 5; each pinch then closes ~25 % of the distance, at 24 about 65 %). */
const PHONE_ZOOM_FACTOR = 24;

/**
 * Camera input for touchpads and touchscreens.
 *
 *  - Mouse:        drag = spin Â· wheel = zoom Â· right-drag = zoom Â· middle-drag or Ctrl-drag = tilt
 *  - Touchpad:     two-finger scroll = zoom Â· pinch = zoom Â· Shift/Alt/Ctrl + one-finger drag = tilt
 *  - Touchscreen:  one finger = spin Â· pinch = zoom Â· two-finger twist/drag = tilt and turn
 *
 * Plus a small on-screen pad (zoom, tilt, north-up) for anyone whose device makes the gestures awkward.
 */
export function setupTouchControls(viewer: Viewer): void {
  const c = viewer.scene.screenSpaceCameraController;

  // Touchpads have no middle button, so give tilt keyboard-modified drags. (Cesium's "look around" on Shift-drag is
  // rarely what a globe viewer wants, so Shift joins tilt instead.)
  c.tiltEventTypes = [
    CameraEventType.MIDDLE_DRAG,
    CameraEventType.PINCH,
    { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL },
    { eventType: CameraEventType.RIGHT_DRAG, modifier: KeyboardEventModifier.CTRL },
    { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.SHIFT },
    { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.ALT }
  ];
  c.lookEventTypes = [];
  // A little inertia so flicks on a touchscreen or trackpad glide instead of stopping dead.
  c.inertiaSpin = 0.88;
  c.inertiaTranslate = 0.88;
  c.inertiaZoom = 0.8;

  // Cesium's pinch zoom is gentle: it counts a quarter of how far the fingers moved and caps each step at 10 % of the
  // window, so crossing the globe took ~15 pinches. On a touchscreen use a faster rate and a longer glide so it takes
  // about 8 (roughly what Google Earth needs). Desktop wheel and touchpad zoom keep the stock feel.
  const stock = { zoomFactor: c.zoomFactor, maximumMovementRatio: c.maximumMovementRatio, inertiaZoom: c.inertiaZoom };
  const tuneForTouch = (): void => {
    const touch = isPhoneClass();
    c.zoomFactor = touch ? PHONE_ZOOM_FACTOR : stock.zoomFactor;
    c.maximumMovementRatio = touch ? 0.5 : stock.maximumMovementRatio;
    c.inertiaZoom = touch ? 0.88 : stock.inertiaZoom;
  };
  tuneForTouch();
  window.matchMedia(PHONE_QUERY).addEventListener("change", tuneForTouch);
  // Don't let the camera dive under the terrain when tilting from a pinch.
  c.enableCollisionDetection = true;

  // The page itself must not pan/zoom under the globe on touch devices.
  viewer.scene.canvas.style.touchAction = "none";

  const pad = document.getElementById("nav-pad");
  if (!pad) return;

  const canvas = viewer.scene.canvas;
  const camera = viewer.camera;

  /** The point on the ground at the middle of the screen (what the camera is "looking at"), or null in space. */
  function focus(): Cartesian3 | null {
    const mid = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    return camera.pickEllipsoid(mid, viewer.scene.globe.ellipsoid) ?? null;
  }

  /** Re-aims the camera around the focus point with a new heading/pitch, keeping the distance. */
  function orbit(headingDelta: number, pitchDelta: number, toNorthUp = false): void {
    const f = focus();
    if (!f) return;
    const range = Cartesian3.distance(camera.positionWC, f);
    const heading = toNorthUp ? 0 : camera.heading + headingDelta;
    const pitch = CesiumMath.clamp(toNorthUp ? -CesiumMath.PI_OVER_TWO : camera.pitch + pitchDelta, -CesiumMath.PI_OVER_TWO, -0.12);
    camera.flyToBoundingSphere(
      // A zero-radius sphere at the focus point: flyTo animates the offset smoothly.
      new BoundingSphere(f, 0),
      { offset: new HeadingPitchRange(heading, pitch, range), duration: 0.35 }
    );
    // Make sure we leave the camera in the world frame afterwards.
    camera.lookAtTransform(Matrix4.IDENTITY);
  }

  /**
   * Eases the camera along its viewing direction. `factor` is the fraction of the current height to travel: positive
   * moves in, negative moves out. Heights multiply, so a few taps take you from street level to the whole planet
   * (the old step shrank to nothing when you were close to the ground).
   */
  function zoom(factor: number): void {
    const height = viewer.scene.globe.ellipsoid.cartesianToCartographic(camera.positionWC)?.height ?? 1e7;
    const dir = Cartesian3.clone(camera.directionWC);
    // Looking at the horizon, moving along the view barely changes the height: scale the step up so every tap changes it by the same amount.
    const up = viewer.scene.globe.ellipsoid.geodeticSurfaceNormal(camera.positionWC, new Cartesian3());
    const dist = Math.max(30, (height * Math.abs(factor)) / Math.max(0.25, Math.abs(Cartesian3.dot(dir, up))));
    const dest = Cartesian3.add(
      camera.positionWC,
      Cartesian3.multiplyByScalar(dir, factor > 0 ? dist : -dist, new Cartesian3()),
      new Cartesian3()
    );
    // Never fly into the planet.
    const ground = viewer.scene.globe.ellipsoid.cartesianToCartographic(dest);
    if (factor > 0 && ground && ground.height < 5) return;
    camera.flyTo({
      destination: dest,
      orientation: { direction: dir, up: Cartesian3.clone(camera.upWC) },
      duration: 0.5,
      easingFunction: (t: number) => 1 - Math.pow(1 - t, 3)
    });
  }
  const actions: Record<string, () => void> = {
    "zoom-in": () => zoom(0.5),
    "zoom-out": () => zoom(-2),
    "tilt-up": () => orbit(0, 0.25),
    "tilt-down": () => orbit(0, -0.25),
    north: () => orbit(0, 0, true),
    home: () => document.dispatchEvent(new CustomEvent("orbit:home"))
  };

  pad.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-nav]");
    if (!btn) return;
    actions[btn.dataset.nav ?? ""]?.();
    ev.stopPropagation();
  });

  // The compass needle shows which way north is, so it doubles as a "which way am I facing" cue.
  const needle = pad.querySelector<HTMLElement>("[data-nav='north'] .nav-needle");
  if (needle) {
    viewer.scene.postRender.addEventListener(() => {
      needle.style.transform = `rotate(${(-CesiumMath.toDegrees(camera.heading)).toFixed(1)}deg)`;
    });
  }
}


