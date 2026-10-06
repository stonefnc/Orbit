/** One hit from [Nominatim](https://nominatim.org/release-docs/develop/api/Search/) `search` JSON. */
export type NominatimHit = {
  displayName: string;
  lat: number;
  lon: number;
  south: number;
  north: number;
  west: number;
  east: number;
  /** OSM feature class, e.g. `tourism`, `amenity`. */
  osmClass?: string;
  /** OSM feature type, e.g. `attraction`, `monument`. */
  osmType?: string;
  /** Nominatim rank hint (higher = more specific). */
  importance?: number;
  /** OSM `wikipedia=*` tag (`lang:Title`) — used only for an external link, never fetched in-app. */
  wikipedia?: string;
  wikidata?: string;
  osmId?: number;
  /** `node` | `way` | `relation` from Nominatim. */
  osmKind?: string;
  /** When `addressdetails=1` was requested. */
  address?: Record<string, string>;
  /** When `extratags=1` was requested. */
  extratags?: Record<string, string>;
};

let lastRequestMs = 0;
/** Public Nominatim allows ~1 req/s; default stays conservative. */
const MIN_INTERVAL_MS = (() => {
  const raw = (import.meta.env.VITE_NOMINATIM_MIN_INTERVAL_MS as string | undefined)?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(400, Math.min(2000, Number(raw)));
  return 1000;
})();

/** US state/territory abbreviations for `state=` + optional `country=United States`. */
const US_STATE_ABBR = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI UM"
    .split(/\s+/)
);

function baseUrl(): string {
  const custom = (import.meta.env.VITE_NOMINATIM_API_BASE as string | undefined)?.trim();
  if (custom) return custom.replace(/\/$/, "");
  return import.meta.env.DEV ? "/nominatim-proxy" : "https://nominatim.openstreetmap.org";
}

async function throttleBeforeRequest(): Promise<void> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastRequestMs);
  if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
  lastRequestMs = Date.now();
}

function optTrimString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function parseStringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && val.trim()) out[k] = val.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function optOsmId(raw: Record<string, unknown>): number | undefined {
  const v = raw.osm_id;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return undefined;
}

function optImportance(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return v;
}

function parseHit(raw: Record<string, unknown>): NominatimHit | null {
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  const name = typeof raw.display_name === "string" ? raw.display_name.trim() : "";
  const bb = raw.boundingbox;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null;

  const meta: Pick<
    NominatimHit,
    | "osmClass"
    | "osmType"
    | "importance"
    | "wikipedia"
    | "wikidata"
    | "osmId"
    | "osmKind"
    | "address"
    | "extratags"
  > = {
    osmClass: optTrimString(raw.class),
    osmType: optTrimString(raw.type),
    importance: optImportance(raw.importance),
    wikipedia: optTrimString(raw.wikipedia),
    wikidata: optTrimString(raw.wikidata),
    osmId: optOsmId(raw),
    osmKind: optTrimString(raw.osm_type),
    address: parseStringRecord(raw.address),
    extratags: parseStringRecord(raw.extratags)
  };

  if (!Array.isArray(bb) || bb.length < 4) {
    const pad = 0.02;
    return {
      displayName: name,
      lat,
      lon,
      south: lat - pad,
      north: lat + pad,
      west: lon - pad,
      east: lon + pad,
      ...meta
    };
  }
  const south = Number(bb[0]);
  const north = Number(bb[1]);
  const west = Number(bb[2]);
  const east = Number(bb[3]);
  if (![south, north, west, east].every((n) => Number.isFinite(n))) return null;
  return { displayName: name, lat, lon, south, north, west, east, ...meta };
}

function absoluteOrRelativePath(pathAndQuery: string): string {
  if (pathAndQuery.startsWith("http://") || pathAndQuery.startsWith("https://")) return pathAndQuery;
  return pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
}

function buildUrlFromParams(params: URLSearchParams): string {
  const root = baseUrl();
  const base = root.replace(/\/$/, "");
  const pathAndQuery = `${base}/search?${params}`;
  return absoluteOrRelativePath(pathAndQuery);
}

/** Extra Nominatim fields for the place panel (still one HTTP round trip). */
function appendDetailParams(params: URLSearchParams): void {
  params.set("addressdetails", "1");
  params.set("extratags", "1");
}

/** Free-form `q=` search (cities, POIs, partial addresses). */
function buildFreeformSearchUrl(query: string): string {
  const params = new URLSearchParams({
    format: "json",
    q: query.trim(),
    limit: "8"
  });
  appendDetailParams(params);
  return buildUrlFromParams(params);
}

type StructuredParts = { street: string; city?: string; state?: string; country?: string };

/**
 * If the user typed something like "123 Main St, Springfield IL" or "10 Downing St, London, UK",
 * Nominatim often ranks structured `street`/`city`/`state`/`country` above a single `q` string.
 */
function tryParseStructuredAddress(query: string): StructuredParts | null {
  const q = query.trim();
  const comma = q.indexOf(",");
  if (comma === -1) return null;
  const street = q.slice(0, comma).trim();
  let rest = q.slice(comma + 1).trim();
  if (!street || !rest) return null;
  // Require a leading house number so we do not treat "Paris, France" as street=Paris.
  if (!/^\d+[A-Za-z]?(?:\s|$)/.test(street)) return null;

  let country: string | undefined;
  const restParts = rest.split(",").map((s) => s.trim()).filter(Boolean);
  if (restParts.length >= 2) {
    country = restParts[restParts.length - 1];
    rest = restParts.slice(0, -1).join(", ");
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  let city: string | undefined;
  let state: string | undefined;

  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1]!.toUpperCase();
    if (last.length === 2 && US_STATE_ABBR.has(last)) {
      state = last;
      city = tokens.slice(0, -1).join(" ");
      if (!country) country = "United States";
    }
  }
  if (!city) city = rest || undefined;

  return { street, city, state, country };
}

function buildStructuredSearchUrl(parts: StructuredParts): string {
  const params = new URLSearchParams({
    format: "json",
    limit: "8",
    street: parts.street
  });
  appendDetailParams(params);
  if (parts.city) params.set("city", parts.city);
  if (parts.state) params.set("state", parts.state);
  if (parts.country) params.set("country", parts.country);
  return buildUrlFromParams(params);
}

async function fetchNominatimHits(href: string): Promise<NominatimHit[]> {
  const res = await fetch(href, {
    headers: { Accept: "application/json" }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Nominatim HTTP ${res.status}: ${t.slice(0, 120)}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];

  const out: NominatimHit[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const h = parseHit(row as Record<string, unknown>);
    if (h) out.push(h);
  }
  return out;
}

const ADDRESS_ORDER = [
  "house_number",
  "road",
  "suburb",
  "neighbourhood",
  "city_district",
  "city",
  "town",
  "village",
  "county",
  "state",
  "postcode",
  "country"
];

const EXTRA_LABELS: Record<string, string> = {
  heritage: "Heritage",
  height: "Height",
  start_date: "Dates",
  end_date: "End date",
  artist_name: "Artist",
  material: "Material",
  inscription: "Inscription",
  memorial: "Memorial",
  historic: "Historic",
  building: "Building",
  description: "Description",
  official_name: "Official name",
  alt_name: "Also known as",
  url: "URL",
  website: "Website"
};

/** Keys shown in the dedicated Architect row (not as generic tag rows). */
const ARCHITECT_DISPLAY_KEYS = ["architect", "architect:name", "designer", "creator", "builder"] as const;
const ARCHITECT_SKIP_KEYS = new Set<string>([
  ...ARCHITECT_DISPLAY_KEYS,
  "architect:wikidata",
  "architect:wikipedia"
]);

export function architectLineFromExtratags(hit: NominatimHit): string | null {
  const et = hit.extratags;
  if (!et) return null;
  const parts: string[] = [];
  for (const k of ARCHITECT_DISPLAY_KEYS) {
    const v = et[k]?.trim();
    if (!v) continue;
    const low = v.toLowerCase();
    if (parts.some((p) => p.toLowerCase() === low)) continue;
    parts.push(v);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function placeCategoryLine(hit: NominatimHit): string {
  const t = [hit.osmClass, hit.osmType].filter(Boolean).join(" · ");
  return t || "—";
}

export function placeAddressLine(hit: NominatimHit): string {
  if (!hit.address) return "—";
  const line = ADDRESS_ORDER.map((k) => hit.address![k]).filter(Boolean).join(", ");
  return line || "—";
}

/** Up to `max` OSM `extratags` lines for sidebar rows (skips keys handled elsewhere). */
export function placeExtraTagRows(hit: NominatimHit, max = 8): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (!hit.extratags) return out;
  const et = hit.extratags;
  const skip = new Set(["wikidata", "wikipedia", "image", "wikimedia_commons"]);
  for (const [key, label] of Object.entries(EXTRA_LABELS)) {
    const v = et[key]?.trim();
    if (!v) continue;
    const text = key === "description" && v.length > 200 ? `${v.slice(0, 197)}…` : v;
    out.push({ label, value: text });
    skip.add(key);
    if (out.length >= max) return out;
  }
  for (const key of Object.keys(et)) {
    if (out.length >= max) break;
    if (skip.has(key) || EXTRA_LABELS[key] || ARCHITECT_SKIP_KEYS.has(key) || key.startsWith("architect:")) {
      continue;
    }
    const v = et[key]?.trim();
    if (!v || v.length > 160) continue;
    const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    out.push({ label, value: v });
  }
  return out;
}

/** Build `https://{lang}.wikipedia.org/wiki/...` from OSM `wikipedia=*` (`lang:Page_title`). No network I/O. */
export function nominatimWikipediaBrowseUrl(wikipediaTag: string | undefined): string | null {
  const t = optTrimString(wikipediaTag);
  if (!t) return null;
  const idx = t.indexOf(":");
  if (idx <= 0 || idx >= t.length - 1) return null;
  const lang = t.slice(0, idx).trim().toLowerCase();
  const title = t.slice(idx + 1).trim();
  if (!/^[a-z]{2,10}$/.test(lang) || !title) return null;
  const path = title.replace(/ /g, "_");
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(path)}`;
}

export function wikidataBrowseUrl(wikidataId: string | undefined): string | null {
  const q = optTrimString(wikidataId)?.toUpperCase();
  if (!q || !/^Q\d+$/.test(q)) return null;
  return `https://www.wikidata.org/wiki/${q}`;
}

/**
 * Forward geocode via OSM Nominatim. Throttled client-side (public instance policy).
 * In dev, requests go through `/nominatim-proxy` so a proper User-Agent is attached server-side.
 *
 * For queries that look like a numbered street followed by a comma (e.g. `200 Oak Ave, Austin TX`),
 * tries [structured search](https://nominatim.org/release-docs/develop/api/Search/) first, then falls
 * back to free-form `q=`. House-level precision still depends on OSM address coverage in that area.
 */
export async function searchNominatimPlaces(query: string): Promise<NominatimHit[]> {
  const q = query.trim();
  if (!q) return [];

  const structured = tryParseStructuredAddress(q);

  if (structured) {
    await throttleBeforeRequest();
    const structuredHits = await fetchNominatimHits(buildStructuredSearchUrl(structured));
    if (structuredHits.length > 0) return structuredHits;

    await throttleBeforeRequest();
    return fetchNominatimHits(buildFreeformSearchUrl(q));
  }

  await throttleBeforeRequest();
  return fetchNominatimHits(buildFreeformSearchUrl(q));
}

/** A raw Nominatim row (e.g. from the server's place-detail route) as a hit, or null when it has no usable point. */
export function nominatimHitFromRaw(raw: Record<string, unknown>): NominatimHit | null {
  return parseHit(raw);
}
