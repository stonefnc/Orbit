import { Math as CesiumMath, Viewer } from "cesium";

const DEFAULT_MAX_SPAN_DEG = 4;
const MIN_AROUND_M = 1_200;
const MAX_AROUND_M = 140_000;

function maxSpanDegFromEnv(): number {
  const raw = (import.meta.env.VITE_EARTHCAM_VIEWPORT_MAX_DEG as string | undefined)?.trim();
  if (raw && /^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (n >= 0.5 && n <= 15) return n;
  }
  return DEFAULT_MAX_SPAN_DEG;
}

/**
 * Overpass query for EarthCam webcams mapped in OSM.
 * Matches `contact:webcam`, `website`, or `url` containing earthcam.com, or `operator=EarthCam`.
 */
function buildAroundQuery(lat: number, lon: number, radiusM: number): string {
  const r = Math.round(Math.min(MAX_AROUND_M, Math.max(MIN_AROUND_M, radiusM)));
  return `[out:json][timeout:55];
(
  nwr["contact:webcam"~"earthcam\\.com",i](around:${r},${lat},${lon});
  nwr["website"~"earthcam\\.com",i](around:${r},${lat},${lon});
  nwr["url"~"earthcam\\.com",i](around:${r},${lat},${lon});
  nwr["operator"~"EarthCam",i]["man_made"="surveillance"](around:${r},${lat},${lon});
  nwr["operator"~"EarthCam",i]["surveillance:type"="camera"](around:${r},${lat},${lon});
);
out center tags;`;
}

function radiusFromCameraHeightMeters(heightM: number): number {
  if (!Number.isFinite(heightM) || heightM <= 0) return MIN_AROUND_M;
  const est = heightM * 0.14;
  return Math.min(MAX_AROUND_M, Math.max(MIN_AROUND_M, est));
}

export type ViewportEarthcamQueryResult =
  | { ok: true; query: string }
  | { ok: false; reason: "no-view-rect" | "zoom-closer" | "anti-meridian-wide" };

export function buildViewportEarthcamOverpassQuery(viewer: Viewer): ViewportEarthcamQueryResult {
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rect) return { ok: false, reason: "no-view-rect" };

  const south = CesiumMath.toDegrees(rect.south);
  const north = CesiumMath.toDegrees(rect.north);
  const west = CesiumMath.toDegrees(rect.west);
  const east = CesiumMath.toDegrees(rect.east);
  const latSpan = north - south;
  const maxSpan = maxSpanDegFromEnv();

  if (west > east) {
    const c = viewer.camera.positionCartographic;
    const lat = CesiumMath.toDegrees(c.latitude);
    const lon = CesiumMath.toDegrees(c.longitude);
    const r = radiusFromCameraHeightMeters(c.height);
    if (r >= MAX_AROUND_M * 0.98 && c.height > 2_000_000) {
      return { ok: false, reason: "anti-meridian-wide" };
    }
    return { ok: true, query: buildAroundQuery(lat, lon, r) };
  }

  let lonSpan = east - west;
  if (lonSpan < 0) lonSpan += 360;
  if (latSpan > maxSpan || lonSpan > maxSpan) {
    return { ok: false, reason: "zoom-closer" };
  }

  const centerLat = (south + north) / 2;
  const centerLon = (west + east) / 2;
  const latM = latSpan * 111_000;
  const lonM = lonSpan * 111_000 * Math.max(0.2, Math.cos(CesiumMath.toRadians(centerLat)));
  const r = Math.min(MAX_AROUND_M, Math.max(MIN_AROUND_M, Math.hypot(latM, lonM) * 0.42));

  return { ok: true, query: buildAroundQuery(centerLat, centerLon, r) };
}

export function viewportEarthcamSkipMessage(
  reason: "no-view-rect" | "zoom-closer" | "anti-meridian-wide"
): string {
  if (reason === "no-view-rect") return "Point camera at Earth — then EarthCam markers load when zoomed in.";
  if (reason === "anti-meridian-wide") return "Zoom in over a land area (wide / dateline view).";
  return `Zoom in (view wider than ~${maxSpanDegFromEnv()}°) to load OSM EarthCam webcams for this area.`;
}
