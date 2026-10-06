import { Cartesian3, Math as CesiumMath, type Viewer } from "cesium";

const MIN_HEIGHT_M = 60;

/**
 * Fly to look straight down (pitch -90, north up) at a point, so a selected camera, ALPR or data center reads like a
 * plan. `targetHeightM` is the usual close range; if the camera is already closer than that it keeps its zoom (never
 * pulls the view out, owner 2026-10-04), but not below `MIN_HEIGHT_M`.
 */
export function flyStraightDown(viewer: Viewer, lon: number, lat: number, targetHeightM: number, duration = 1.35): void {
  const here = viewer.camera.positionCartographic.height;
  const height = Math.min(targetHeightM, Math.max(MIN_HEIGHT_M, Number.isFinite(here) ? here : targetHeightM));
  try {
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lon, lat, height),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
      duration
    });
  } catch {
    /* ignore: the camera may be locked to something */
  }
}
