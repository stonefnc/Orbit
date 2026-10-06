import { nominatimHitFromRaw, type NominatimHit } from "./alpr/nominatimSearch";

/**
 * The page's side of the server geocoder (`/api/layers/geocode`, server/lib/geocoder.ts): street addresses from the US
 * Census, places from Photon, and (only after an explicit Enter / Find) Nominatim. Results arrive ranked: addresses first
 * for a house-number query, then the nearest to `bias`. They are shaped like Nominatim hits so the existing fly-to and
 * place panel keep working.
 */
export type GeoHit = NominatimHit & {
  /** A numbered street address. */
  isAddress?: boolean;
  /** OSM id like "W123" when known; lets `enrichHit` fetch the detailed place record after a click. */
  osm?: string;
  source?: "census" | "photon" | "nominatim";
};

type ServerResult = {
  label: string;
  lat: number;
  lon: number;
  kind?: string;
  source: "census" | "photon" | "nominatim";
  address?: boolean;
  osm?: string;
  bbox?: [number, number, number, number];
};

/** A small box around a point so "fly to" lands at street level for an address and at area level for a place. */
function boxFor(r: ServerResult): { south: number; north: number; west: number; east: number } {
  if (r.bbox && r.bbox[0] < r.bbox[1] && r.bbox[2] <= r.bbox[3]) return { south: r.bbox[0], north: r.bbox[1], west: r.bbox[2], east: r.bbox[3] };
  const d = r.address ? 0.0012 : 0.012;
  return { south: r.lat - d, north: r.lat + d, west: r.lon - d, east: r.lon + d };
}

export type GeoSearchOutcome = { hits: GeoHit[]; unavailable: string[] };

/**
 * Searches addresses and places. `bias` (the view centre or "my location") ranks nearby results first; `submit` is for
 * an explicit Enter / Find (it also allows the Nominatim fallback). Throws when the server cannot be reached.
 */
export async function searchGeocode(query: string, opts: { bias?: { lat: number; lon: number } | null; submit?: boolean } = {}): Promise<GeoSearchOutcome> {
  const q = query.trim();
  if (q.length < 3) return { hits: [], unavailable: [] };
  const params = new URLSearchParams({ q });
  if (opts.bias) {
    params.set("lat", opts.bias.lat.toFixed(3));
    params.set("lon", opts.bias.lon.toFixed(3));
  }
  if (opts.submit) params.set("submit", "1");
  const res = await fetch(`/api/layers/geocode?${params}`);
  if (!res.ok) throw new Error("The place search isn't reachable right now.");
  const j = (await res.json()) as { results?: ServerResult[]; unavailable?: string[] };
  const hits: GeoHit[] = (j.results ?? []).map((r) => ({
    displayName: r.label,
    lat: r.lat,
    lon: r.lon,
    ...boxFor(r),
    osmType: r.kind,
    isAddress: r.address,
    osm: r.osm,
    source: r.source
  }));
  return { hits, unavailable: j.unavailable ?? [] };
}

/** After a click: the full OpenStreetMap record (address parts, Wikipedia, architect ...) when the result has an OSM id. */
export async function enrichHit(hit: GeoHit): Promise<NominatimHit | null> {
  if (!hit.osm) return null;
  try {
    const res = await fetch(`/api/layers/place-detail?osm=${encodeURIComponent(hit.osm)}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: Record<string, unknown> | null };
    const full = j.result ? nominatimHitFromRaw(j.result) : null;
    // Keep the coordinates and the box the user already saw; take the details.
    return full ? { ...full, lat: hit.lat, lon: hit.lon, south: hit.south, north: hit.north, west: hit.west, east: hit.east } : null;
  } catch {
    return null;
  }
}
