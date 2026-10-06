import { Cartesian2, Cartesian3, Cartographic, Math as CesiumMath, type Viewer } from "cesium";

/**
 * Fly mode: free-flight camera for exploring 3D cities at street level.
 *
 *  W/S or ↑/↓  forward / back        A/D or ←/→  strafe
 *  Q / E       down / up             Shift       boost      Mouse wheel  speed
 *  Drag        look around           Esc or F    leave
 *
 * Speed scales with height above the ground so the same keys feel right from a rooftop or 500 m up, and the camera
 * is kept a few metres above whatever is loaded below it (buildings, terrain) so you glide over and between
 * structures instead of through the floor.
 */
export type FlyModeHandle = {
  toggle(): void;
  exit(): void;
  isActive(): boolean;
};

const MIN_CLEARANCE_M = 4;
const HIGH_ALTITUDE_M = 1_500;
const DROP_IN_ABOVE_M = 6_000; // higher than this, descend to the city first
const DROP_IN_HEIGHT_M = 450;

type Hooks = {
  onChange?: (active: boolean) => void;
  /** True while flying (a good moment to trade a little tile detail for smoothness), false when back to normal. */
  onFlying?: (flying: boolean) => void;
  /** Called every few frames with the readout for the on-screen hint. */
  onStats?: (s: { aglM: number; speedMs: number }) => void;
};

export function createFlyMode(viewer: Viewer, hooks: Hooks = {}): FlyModeHandle {
  const scene = viewer.scene;
  const camera = viewer.camera;
  const canvas = scene.canvas;
  const ctrl = scene.screenSpaceCameraController;

  let active = false;
  let starting = false;
  let heading = 0;
  let pitch = -0.3;
  let speedScale = 1;
  let raf = 0;
  let last = 0;
  let statsAt = 0;
  let dragging = false;
  const keys = new Set<string>();
  let saved: Record<string, boolean> | null = null;

  const typing = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
  };

  function groundHeight(carto: Cartographic): number | undefined {
    let ground: number | undefined;
    // Far above the city the terrain is all that matters and ray-sampling every tile each frame is wasted work.
    if (scene.sampleHeightSupported && carto.height < HIGH_ALTITUDE_M + (scene.globe.getHeight(carto) ?? 0)) {
      try {
        ground = scene.sampleHeight(carto);
      } catch {
        /* ignore */
      }
    }
    return ground ?? scene.globe.getHeight(carto) ?? undefined;
  }

  function frame(now: number): void {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    // Distance = speed x real elapsed time, so the flight feels the same at 60 fps and 10 fps. (The cap only stops a
    // huge jump after the tab was in the background.) A low cap here is what made flying feel like slow motion.
    const dt = Math.min(0.25, Math.max(0.001, (now - (last || now)) / 1000));
    last = now;

    // Apply look direction at the current position, then move along the camera's own axes.
    camera.setView({
      destination: Cartesian3.clone(camera.positionWC),
      orientation: { heading, pitch, roll: 0 }
    });

    const carto = Cartographic.fromCartesian(camera.positionWC);
    const ground0 = groundHeight(carto);
    const agl = Math.max(1, carto.height - (ground0 ?? 0));
    // Fast by default (≈ 700 km/h at 1 km up, ≈ 70 km/h on the rooftops), 6x with Shift, and the wheel stretches it further.
    const base = Math.min(400, Math.max(20, agl * 0.5));
    const speed = base * speedScale * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 6 : 1);
    const d = speed * dt;

    if (keys.has("KeyW") || keys.has("ArrowUp")) camera.moveForward(d);
    if (keys.has("KeyS") || keys.has("ArrowDown")) camera.moveBackward(d);
    if (keys.has("KeyA") || keys.has("ArrowLeft")) camera.moveLeft(d);
    if (keys.has("KeyD") || keys.has("ArrowRight")) camera.moveRight(d);
    if (keys.has("KeyE") || keys.has("Space")) camera.move(scene.globe.ellipsoid.geodeticSurfaceNormal(camera.positionWC, new Cartesian3()), d);
    if (keys.has("KeyQ") || keys.has("KeyC")) {
      camera.move(scene.globe.ellipsoid.geodeticSurfaceNormal(camera.positionWC, new Cartesian3()), -d);
    }

    // Stay above what is underneath (rooftops, streets, terrain). Only sample the (expensive) 3D tiles when close
    // enough to matter; the sample from the start of this frame is reused when we are high up.
    const after = Cartographic.fromCartesian(camera.positionWC);
    const ground = agl > HIGH_ALTITUDE_M ? ground0 : groundHeight(after);
    if (ground !== undefined && after.height < ground + MIN_CLEARANCE_M) {
      after.height = ground + MIN_CLEARANCE_M;
      camera.setView({
        destination: Cartesian3.fromRadians(after.longitude, after.latitude, after.height),
        orientation: { heading, pitch, roll: 0 }
      });
    }

    scene.requestRender();
    if (now - statsAt > 250) {
      statsAt = now;
      hooks.onStats?.({ aglM: Math.max(0, after.height - (ground ?? 0)), speedMs: speed });
    }
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (typing(e.target)) return;
    if (e.code === "Escape" || e.code === "KeyF") {
      e.preventDefault();
      exit();
      return;
    }
    keys.add(e.code);
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code);
  };
  const onBlur = (): void => {
    keys.clear();
    dragging = false;
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 2) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    heading += e.movementX * 0.0035;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0035));
  };
  const onPointerUp = (e: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    speedScale = Math.max(0.2, Math.min(20, speedScale * (e.deltaY < 0 ? 1.25 : 1 / 1.25)));
  };
  const onContextMenu = (e: Event): void => e.preventDefault();

  function begin(): void {
    starting = false;
    active = true;
    heading = camera.heading;
    pitch = Math.max(-1.4, Math.min(1.4, camera.pitch));
    saved = {
      enableRotate: ctrl.enableRotate,
      enableTranslate: ctrl.enableTranslate,
      enableZoom: ctrl.enableZoom,
      enableTilt: ctrl.enableTilt,
      enableLook: ctrl.enableLook
    };
    ctrl.enableRotate = ctrl.enableTranslate = ctrl.enableZoom = ctrl.enableTilt = ctrl.enableLook = false;

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.style.cursor = "grab";

    last = 0;
    raf = requestAnimationFrame(frame);
    hooks.onFlying?.(true);
    hooks.onChange?.(true);
  }

  function exit(): void {
    if (!active && !starting) return;
    starting = false;
    camera.cancelFlight();
    if (!active) {
      hooks.onChange?.(false);
      return;
    }
    active = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.style.cursor = "";
    keys.clear();
    dragging = false;
    if (saved) {
      ctrl.enableRotate = saved.enableRotate!;
      ctrl.enableTranslate = saved.enableTranslate!;
      ctrl.enableZoom = saved.enableZoom!;
      ctrl.enableTilt = saved.enableTilt!;
      ctrl.enableLook = saved.enableLook!;
      saved = null;
    }
    scene.requestRender();
    hooks.onFlying?.(false);
    hooks.onChange?.(false);
  }

  function enter(): void {
    if (active || starting) return;
    const height = Cartographic.fromCartesian(camera.positionWC).height;
    if (height <= DROP_IN_ABOVE_M) {
      begin();
      return;
    }
    // Too far away to fly around: descend to the spot under the middle of the screen first.
    const centre = camera.pickEllipsoid(
      new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      scene.globe.ellipsoid
    );
    if (!centre) {
      begin();
      return;
    }
    const c = Cartographic.fromCartesian(centre);
    starting = true;
    hooks.onChange?.(true);
    camera.flyTo({
      destination: Cartesian3.fromRadians(c.longitude, c.latitude, DROP_IN_HEIGHT_M),
      orientation: { heading: camera.heading, pitch: CesiumMath.toRadians(-25), roll: 0 },
      duration: 3,
      complete: () => {
        if (starting) begin();
      },
      cancel: () => {
        if (starting) {
          starting = false;
          hooks.onChange?.(false);
        }
      }
    });
  }

  return {
    toggle: () => (active || starting ? exit() : enter()),
    exit,
    isActive: () => active || starting
  };
}
