import { collectTiles, createTileStore } from "./osmTiles";

/**
 * ALPR (automatic licence plate reader) locations from OpenStreetMap (`surveillance:type=ALPR`), served per
 * one-degree tile through the shared OSM tile cache (see osmTiles.ts), so a view many degrees wide can be shown instead
 * of only the few blocks a per-view query could afford.
 *
 * Data © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
 */
// [osmNodeId, lat, lon, bearingDeg|null, vendor, name, state, notes]
export type AlprCompact = [number, number, number, number | null, string, string, string, string];

const MAX_TILES_PER_QUERY = 80;

const CARDINALS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5
};

function bearingFrom(tags: Record<string, string>): number | null {
  for (const k of ["direction", "camera:direction", "bearing", "surveillance:direction"]) {
    const raw = tags[k]?.trim();
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 360) return n % 360;
    const c = CARDINALS[raw.toUpperCase()];
    if (c !== undefined) return c;
  }
  return null;
}

type OverpassNode = { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string> };

function compact(elements: unknown[]): AlprCompact[] {
  const out: AlprCompact[] = [];
  for (const raw of elements) {
    const el = raw as OverpassNode;
    if (el.type !== "node" || typeof el.lat !== "number" || typeof el.lon !== "number") continue;
    const t = el.tags ?? {};
    if (t["surveillance:type"] !== "ALPR") continue;
    // `operator` is usually the agency running the camera (a police department, a store), not who built it.
    const notes = ["operator", "surveillance", "camera:type", "camera:mount", "fixme", "description", "ref"]
      .map((k) => (t[k] ? `${k}=${t[k]}` : ""))
      .filter(Boolean)
      .join(" · ")
      .slice(0, 200);
    out.push([
      el.id,
      Math.round(el.lat * 1e6) / 1e6,
      Math.round(el.lon * 1e6) / 1e6,
      bearingFrom(t),
      (t.manufacturer ?? t.brand ?? "").slice(0, 60),
      (t.name ?? "").slice(0, 60),
      (t["addr:state"] ?? t["addr:province"] ?? "").slice(0, 30),
      notes
    ]);
  }
  return out;
}

// Bumped (alpr -> alpr2) when the vendor field changed from "operator or manufacturer" to the manufacturer only.
const store = createTileStore<AlprCompact>({
  dir: "alpr2",
  ttlMs: 7 * 24 * 60 * 60_000,
  query: (s, w, n, e) => `[out:json][timeout:55][bbox:${s},${w},${n},${e}];node["surveillance:type"="ALPR"];out body;`,
  parse: compact
});

/** Plain [lat, lon] points of every mapped camera in a box (for route planning), plus how many tiles are still loading. */
export async function alprPointsInBox(
  west: number,
  south: number,
  east: number,
  north: number
): Promise<{ points: Array<[number, number]>; pending: number; total: number } | "too-wide"> {
  const got = await collectTiles(store, west, south, east, north, MAX_TILES_PER_QUERY);
  if (got === "too-wide") return got;
  const points: Array<[number, number]> = [];
  for (const [, la, lo] of got.items) {
    if (la >= south && la <= north && lo >= west && lo <= east) points.push([la, lo]);
  }
  return { points, pending: got.pending, total: got.total };
}

export type AlprQueryResult = {
  sites: AlprCompact[];
  tilesTotal: number;
  tilesPending: number;
  tilesFailed: number;
  truncated: boolean;
};

/** Sites in the box, nearest to its centre first; missing tiles are fetched in the background (call again soon). */
export async function queryAlpr(
  west: number,
  south: number,
  east: number,
  north: number,
  limit: number
): Promise<AlprQueryResult | "too-wide"> {
  const got = await collectTiles(store, west, south, east, north, MAX_TILES_PER_QUERY);
  if (got === "too-wide") return got;

  const cLat = (south + north) / 2;
  let cLon = west <= east ? (west + east) / 2 : (west + east + 360) / 2;
  if (cLon > 180) cLon -= 360;
  const inBox = got.items.filter(([, la, lo]) => {
    if (la < south || la > north) return false;
    return west <= east ? lo >= west && lo <= east : lo >= west || lo <= east;
  });
  let truncated = false;
  if (inBox.length > limit) {
    inBox.sort(
      (a, b) => (a[1] - cLat) ** 2 + (a[2] - cLon) ** 2 - ((b[1] - cLat) ** 2 + (b[2] - cLon) ** 2)
    );
    inBox.length = limit;
    truncated = true;
  }
  return { sites: inBox, tilesTotal: got.total, tilesPending: got.pending, tilesFailed: got.failed, truncated };
}
