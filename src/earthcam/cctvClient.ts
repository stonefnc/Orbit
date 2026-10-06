import type { EarthCamCamera } from "./earthcamTypes";

type ApiCamera = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  agency: string;
  country: string;
  region?: string;
  city?: string;
  roadway?: string;
  description?: string;
  headingDeg: number | null;
  headingKind: "facing" | "traffic-direction" | "unknown";
  refreshSec: number;
  pageUrl?: string;
  videoUrl?: string;
  videoKind?: "hls" | "mp4";
  frame: string;
  attribution: string;
  license: string;
};

export type CctvSourceInfo = {
  id: string;
  label: string;
  agency?: string;
  attribution?: string;
  license?: string;
  count: number;
  error?: string | null;
  coverage?: number[][];
};

export type CctvViewportResult =
  | {
      kind: "ok";
      cameras: EarthCamCamera[];
      total: number;
      truncated: boolean;
      loadingSources: string[];
      sources: CctvSourceInfo[];
    }
  | { kind: "too-wide"; sources: CctvSourceInfo[] };

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/** Orientation text that says exactly what the agency published — never an invented pose. */
function orientationNote(c: ApiCamera): string {
  if (c.headingDeg == null || c.headingKind === "unknown") return "Camera orientation not published";
  if (c.headingKind === "facing") return `Looking ${compass(c.headingDeg)} (agency-reported)`;
  return "Exact camera facing not published";
}

function toCamera(c: ApiCamera): EarthCamCamera {
  const notes = [c.description, orientationNote(c)].filter(Boolean).join(" · ");
  return {
    id: c.id,
    name: c.name,
    latitude: c.lat,
    longitude: c.lon,
    city: c.city,
    region: c.region,
    country: c.country,
    category: c.roadway ?? "Traffic camera",
    thumbnail: c.frame,
    frameUrl: c.frame,
    videoUrl: c.videoUrl,
    videoKind: c.videoKind,
    frameRefreshSec: c.refreshSec,
    headingDeg: c.headingDeg,
    headingKind: c.headingKind,
    earthcamPageUrl: c.pageUrl ?? "",
    embedAllowed: false,
    status: "live",
    cameraSource: c.agency,
    notes,
    attribution: c.attribution,
    license: c.license
  };
}

/** Nearest cameras to a point (e.g. an airport): the server only loads the regions that point touches. */
export async function fetchCamerasNear(
  lat: number,
  lon: number,
  radiusKm: number,
  limit: number,
  signal?: AbortSignal
): Promise<EarthCamCamera[]> {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const q = new URLSearchParams({
    w: (lon - dLon).toFixed(4),
    s: (lat - dLat).toFixed(4),
    e: (lon + dLon).toFixed(4),
    n: (lat + dLat).toFixed(4),
    limit: String(limit)
  });
  const res = await fetch(`/api/cctv/cameras?${q.toString()}`, { signal });
  if (!res.ok) return [];
  const j = (await res.json()) as { cameras?: ApiCamera[] };
  return (j.cameras ?? []).map(toCamera);
}

/** Degrees; `west > east` means the view crosses the antimeridian. */
export type ViewBounds = { west: number; south: number; east: number; north: number };

export async function fetchCctvViewport(
  b: ViewBounds,
  limit: number,
  signal: AbortSignal
): Promise<CctvViewportResult> {
  const q = new URLSearchParams({
    w: b.west.toFixed(4),
    s: b.south.toFixed(4),
    e: b.east.toFixed(4),
    n: b.north.toFixed(4),
    limit: String(limit)
  });
  const res = await fetch(`/api/cctv/cameras?${q.toString()}`, { signal });
  if (res.status === 413) {
    const j = (await res.json()) as { sources?: CctvSourceInfo[] };
    return { kind: "too-wide", sources: j.sources ?? [] };
  }
  if (!res.ok) throw new Error(`Camera API HTTP ${res.status}`);
  const j = (await res.json()) as {
    cameras: ApiCamera[];
    total: number;
    truncated: boolean;
    loading: string[];
    sources: CctvSourceInfo[];
  };
  return {
    kind: "ok",
    cameras: j.cameras.map(toCamera),
    total: j.total,
    truncated: j.truncated,
    loadingSources: j.loading,
    sources: j.sources
  };
}
