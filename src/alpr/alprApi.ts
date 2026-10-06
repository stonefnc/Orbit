import type { AlprDataset, AlprSite } from "./alprTypes";

type Compact = [number, number, number, number | null, string, string, string, string];

type ApiResult = {
  sites: Compact[];
  tilesTotal: number;
  tilesPending: number;
  tilesFailed: number;
  truncated: boolean;
};

export type AlprFetchResult =
  | { ok: true; dataset: AlprDataset; pending: number; failed: number; total: number; truncated: boolean }
  | { ok: false; reason: "too-wide" | "error" };

const ATTRIBUTION =
  "© OpenStreetMap contributors — data available under the Open Database License (ODbL). Served from cached one-degree tiles.";

/** ALPR sites in a lon/lat box from the Orbit server (it caches OpenStreetMap tiles, so wide views are fine). */
export async function fetchAlprBox(
  b: { west: number; south: number; east: number; north: number },
  signal?: AbortSignal
): Promise<AlprFetchResult> {
  const q = new URLSearchParams({
    w: b.west.toFixed(4),
    s: b.south.toFixed(4),
    e: b.east.toFixed(4),
    n: b.north.toFixed(4)
  });
  try {
    const res = await fetch(`/api/alpr?${q.toString()}`, { signal });
    if (res.status === 413) return { ok: false, reason: "too-wide" };
    if (!res.ok) return { ok: false, reason: "error" };
    const j = (await res.json()) as ApiResult;
    const sites: AlprSite[] = j.sites.map(([id, lat, lon, bearing, vendor, name, state, notes]) => ({
      id: `osm-node-${id}`,
      latitude: lat,
      longitude: lon,
      source: "OpenStreetMap (ODbL) · Overpass export",
      confidence: "unknown",
      bearingDeg: bearing,
      ...(name ? { name } : {}),
      ...(vendor ? { vendor } : {}),
      ...(state ? { region: state } : {}),
      ...(notes ? { notes } : {})
    }));
    return {
      ok: true,
      dataset: {
        sites,
        attribution: ATTRIBUTION,
        licenseNote: "https://www.openstreetmap.org/copyright"
      },
      pending: j.tilesPending,
      failed: j.tilesFailed,
      total: j.tilesTotal,
      truncated: j.truncated
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { ok: false, reason: "error" };
  }
}
