/**
 * One place for turning text into coordinates, used by the top-bar search, "Set my location" and the directions boxes.
 *
 *  - US street addresses (a house number first): the US Census Bureau geocoder (free, no key, accurate for US addresses).
 *    When the query has no city or state, the state of the user's view/location is added so the nearest matches win.
 *  - Everything else, and as a supplement: Photon (komoot, OpenStreetMap data, built for type-ahead, takes a location bias).
 *  - Nominatim (OSM): only on an explicit submit (Enter / Find) and only when the others found little. Its policy forbids
 *    search-as-you-type, so a type-ahead call never reaches it.
 *
 * Every source is spaced (a per-host minimum gap), failed quietly, cached, and identified honestly with Orbit's own
 * User-Agent. Results are ranked: addresses first when the query has a house number, then nearest to the bias point.
 */

export type GeoSource = "census" | "photon" | "nominatim";
export type GeoResult = {
  label: string;
  lat: number;
  lon: number;
  kind?: string;
  source: GeoSource;
  /** A numbered street address (as opposed to a place, street or area). */
  address?: boolean;
  /** OSM id like "W123" / "N45" when known (lets the page ask Nominatim for details after a click). */
  osm?: string;
  /** [south, north, west, east] in degrees, when the source gave an extent. */
  bbox?: [number, number, number, number];
};
export type Bias = { lat: number; lon: number };
export type GeocodeOptions = { bias?: Bias | null; submit?: boolean };
export type GeocodeReply = { results: GeoResult[]; unavailable: GeoSource[] };

const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)" };
const DAY = 24 * 3_600_000;
export const MAX_RESULTS = 8;

// ---------- pure helpers (unit-tested) ----------

export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").slice(0, 140);
}

/** A house number followed by a word: "1600 Pennsylvania Ave", "12B Baker St". */
export function hasHouseNumber(q: string): boolean {
  return /^\d{1,6}[A-Za-z]?\s+[A-Za-z0-9]/.test(q.trim());
}

const US_STATES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP";
const STATE_RE = new RegExp(`(?:^|[\\s,])(?:${US_STATES.split(" ").join("|")})\\.?(?:\\s+\\d{5}(?:-\\d{4})?)?\\s*$`, "i");

/** Street suffix words, so we can tell "100 Main St" (no city) from "100 Main St Atlanta" (has one). */
const SUFFIX =
  "st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|pkwy|parkway|hwy|highway|way|pl|place|cir|circle|trl|trail|ter|terrace|sq|square|loop|pike|run|row";
const AFTER_SUFFIX = new RegExp(`\\b(?:${SUFFIX})\\b\\.?(?:\\s+(?:n|s|e|w|ne|nw|se|sw))?\\.?\\s*(.*)$`, "i");

/** True when the query ends in a US state or a ZIP code. */
export function hasStateOrZip(q: string): boolean {
  return /\b\d{5}(?:-\d{4})?\s*$/.test(q) || STATE_RE.test(q);
}

/** True when the query already names a city, state or ZIP after the street. */
export function hasPlaceAfterStreet(q: string): boolean {
  if (hasStateOrZip(q)) return true;
  if (q.includes(",")) return true;
  const m = AFTER_SUFFIX.exec(q);
  return !!m && m[1]!.trim().length >= 2;
}

export function distanceKm(a: Bias, b: Bias): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const KEEP_UPPER = new Set(["NE", "NW", "SE", "SW", "US", "PO", "II", "III", "IV"]);
/** The Census returns upper case ("1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500"): make it readable. */
export function prettyAddress(s: string): string {
  return s
    .split(",")
    .map((part, i, all) => {
      const t = part.trim();
      // The last two parts are the state (2 letters) and ZIP: keep them as they are.
      if (i >= all.length - 2 && (/^[A-Z]{2}$/.test(t) || /^\d{5}(-\d{4})?$/.test(t))) return t;
      return t
        .split(" ")
        .map((w) => {
          // Unit and building numbers such as "11A" stay as typed ("1ST" and "3RD" are still ordinals: "1st", "3rd").
          if (KEEP_UPPER.has(w) || /^[NSEW]$/.test(w) || /^\d+[A-Za-z]$/.test(w)) return w.toUpperCase();
          const lower = w.toLowerCase();
          // McDonald, O'Neil: capital after the prefix.
          const prefix = /^(mc|o')(?=[a-z])/.exec(lower)?.[1];
          if (prefix) return prefix.charAt(0).toUpperCase() + prefix.slice(1) + lower.charAt(prefix.length).toUpperCase() + lower.slice(prefix.length + 1);
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" ");
    })
    .join(", ");
}

/** Drops duplicates: the same place by label or within about 10 m. The first one seen wins (so order the sources). */
export function dedupe(results: GeoResult[]): GeoResult[] {
  const seen = new Set<string>();
  const out: GeoResult[] = [];
  for (const r of results) {
    const spot = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
    const name = r.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(spot) || seen.has(name)) continue;
    seen.add(spot);
    seen.add(name);
    out.push(r);
  }
  return out;
}

/**
 * Orders results. With a house number in the query, real addresses come first and then the nearest to `bias`; otherwise
 * the source's own relevance order is kept, except that anything within 100 km of `bias` moves ahead (so "walmart" or
 * "main street" mean the one near you, while "paris" still finds Paris, France first when nothing is near).
 */
export function rankResults(results: GeoResult[], bias: Bias | null | undefined, query: string): GeoResult[] {
  const houseNumber = hasHouseNumber(query);
  const num = /^(\d{1,6}[A-Za-z]?)\s/.exec(query.trim())?.[1];
  // The typed house number at the start of the street part of the label: "1 Peachtree St ..." or "White House, 1600 Penn...".
  const exact = num ? new RegExp(`(?:^|, )${num}(?=[ ,])`, "i") : null;
  const tier = (r: GeoResult): number => (exact?.test(r.label) && r.address ? 0 : r.address ? 1 : 2);
  const indexed = results.map((r, i) => ({ r, i, d: bias ? distanceKm(bias, r) : null }));
  indexed.sort((a, b) => {
    if (houseNumber) {
      const ta = tier(a.r);
      const tb = tier(b.r);
      if (ta !== tb) return ta - tb;
      if (a.d != null && b.d != null && a.d !== b.d) return a.d - b.d;
      return a.i - b.i;
    }
    const ta = a.d != null && a.d < 100 ? 0 : 1;
    const tb = b.d != null && b.d < 100 ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return a.i - b.i; // within a group the source's relevance order stands ("atlanta" is the city before its city hall)
  });
  return indexed.map((x) => x.r);
}

// ---------- the sources ----------

type Fetch = typeof fetch;
type Deps = { fetchFn: Fetch; now: () => number; sleep: (ms: number) => Promise<void> };

/** A per-host minimum gap between requests. A queue longer than `maxQueue` is refused instead of piling up. */
function makeSpacer(minGapMs: number, deps: Deps, maxQueue = 4): () => Promise<void> {
  let next = 0;
  let waiting = 0;
  return async () => {
    if (waiting >= maxQueue) throw new Error("busy");
    const now = deps.now();
    const at = Math.max(now, next);
    next = at + minGapMs;
    if (at > now) {
      waiting++;
      try {
        await deps.sleep(at - now);
      } finally {
        waiting--;
      }
    }
  };
}

type CensusReply = {
  result?: { addressMatches?: Array<{ matchedAddress?: string; coordinates?: { x?: number; y?: number } }> };
};
type PhotonReply = {
  features?: Array<{
    geometry?: { coordinates?: [number, number] };
    properties?: {
      name?: string;
      street?: string;
      housenumber?: string;
      city?: string;
      district?: string;
      county?: string;
      state?: string;
      country?: string;
      osm_value?: string;
      osm_type?: string;
      osm_id?: number;
      type?: string;
      extent?: [number, number, number, number];
    };
  }>;
};
type NominatimRow = {
  lat?: string;
  lon?: string;
  display_name?: string;
  type?: string;
  class?: string;
  osm_type?: string;
  osm_id?: number | string;
  boundingbox?: string[];
  address?: Record<string, string>;
};

export function createGeocoder(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    fetchFn: overrides.fetchFn ?? fetch,
    now: overrides.now ?? (() => Date.now()),
    sleep: overrides.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  };
  const spaceCensus = makeSpacer(700, deps);
  const spacePhoton = makeSpacer(500, deps);
  const spaceNominatim = makeSpacer(1_100, deps, 2);

  const cache = new Map<string, { at: number; value: unknown }>();
  const inflight = new Map<string, Promise<unknown>>();
  /** Cached, and identical simultaneous requests share one call. */
  async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && deps.now() - hit.at < ttl) return hit.value as T;
    const running = inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = load()
      .then((value) => {
        cache.set(key, { at: deps.now(), value });
        if (cache.size > 3000) cache.delete(cache.keys().next().value!);
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
    const res = await deps.fetchFn(url, { headers: { ...UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** The US state abbreviation at a point (so "100 Main St" means the one in your state), or null outside the US. */
  async function stateAt(b: Bias): Promise<string | null> {
    return cached(`state|${b.lat.toFixed(1)},${b.lon.toFixed(1)}`, 90 * DAY, async () => {
      await spaceCensus();
      const j = await getJson<{ result?: { geographies?: { States?: Array<{ STUSAB?: string }> } } }>(
        `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${b.lon}&y=${b.lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`,
        8_000
      );
      return j.result?.geographies?.States?.[0]?.STUSAB ?? null;
    });
  }

  async function census(address: string, timeoutMs = 9_000): Promise<GeoResult[]> {
    return cached(`census|${address.toLowerCase()}`, 30 * DAY, async () => {
      await spaceCensus();
      const j = await getJson<CensusReply>(
        `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`,
        timeoutMs
      );
      const out: GeoResult[] = [];
      for (const m of j.result?.addressMatches ?? []) {
        const lon = m.coordinates?.x;
        const lat = m.coordinates?.y;
        if (typeof lon !== "number" || typeof lat !== "number" || !m.matchedAddress) continue;
        out.push({ label: prettyAddress(m.matchedAddress), lat, lon, kind: "address", source: "census", address: true });
      }
      return out;
    });
  }

  async function photon(q: string, bias: Bias | null): Promise<GeoResult[]> {
    const b = bias ? `&lat=${bias.lat.toFixed(2)}&lon=${bias.lon.toFixed(2)}` : "";
    return cached(`photon|${q.toLowerCase()}|${bias ? `${bias.lat.toFixed(1)},${bias.lon.toFixed(1)}` : ""}`, 7 * DAY, async () => {
      await spacePhoton();
      const j = await getJson<PhotonReply>(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${MAX_RESULTS}&lang=en${b}`, 9_000);
      const out: GeoResult[] = [];
      for (const f of j.features ?? []) {
        const c = f.geometry?.coordinates;
        const p = f.properties ?? {};
        if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
        const street = [p.housenumber, p.street].filter(Boolean).join(" ");
        const place = p.city ?? p.district ?? p.county;
        const parts = [p.name && p.name !== p.street ? p.name : "", street, place, p.state, p.country].filter(Boolean) as string[];
        const label = parts.join(", ").slice(0, 140);
        if (!label) continue;
        const e = p.extent;
        out.push({
          label,
          lat: c[1],
          lon: c[0],
          kind: p.osm_value,
          source: "photon",
          address: !!p.housenumber,
          osm: p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : undefined,
          bbox: e && e.length === 4 ? [e[3], e[1], e[0], e[2]] : undefined
        });
      }
      return out;
    });
  }

  async function nominatim(q: string, bias: Bias | null): Promise<GeoResult[]> {
    const vb = bias ? `&viewbox=${bias.lon - 1},${bias.lat + 1},${bias.lon + 1},${bias.lat - 1}&bounded=0` : "";
    return cached(`nominatim|${q.toLowerCase()}|${bias ? `${bias.lat.toFixed(1)},${bias.lon.toFixed(1)}` : ""}`, 7 * DAY, async () => {
      await spaceNominatim();
      const rows = await getJson<NominatimRow[]>(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=${MAX_RESULTS}&dedupe=1&addressdetails=1${vb}`,
        12_000
      );
      const out: GeoResult[] = [];
      for (const r of Array.isArray(rows) ? rows : []) {
        const lat = Number(r.lat);
        const lon = Number(r.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !r.display_name) continue;
        const bb = r.boundingbox?.map(Number);
        out.push({
          label: r.display_name.slice(0, 140),
          lat,
          lon,
          kind: r.type,
          source: "nominatim",
          address: !!r.address?.house_number,
          osm: r.osm_type && r.osm_id ? `${r.osm_type[0]!.toUpperCase()}${r.osm_id}` : undefined,
          bbox: bb && bb.length === 4 && bb.every(Number.isFinite) ? [bb[0]!, bb[1]!, bb[2]!, bb[3]!] : undefined
        });
      }
      return out;
    });
  }

  /** Details of one OSM object for the place panel (one Nominatim lookup per click, cached). */
  async function lookupOsm(osm: string): Promise<Record<string, unknown> | null> {
    if (!/^[NWR]\d{1,12}$/.test(osm)) return null;
    return cached(`lookup|${osm}`, 7 * DAY, async () => {
      await spaceNominatim();
      const rows = await getJson<Array<Record<string, unknown>>>(
        `https://nominatim.openstreetmap.org/lookup?osm_ids=${osm}&format=json&addressdetails=1&extratags=1`,
        12_000
      );
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    });
  }

  async function geocode(query: string, opts: GeocodeOptions = {}): Promise<GeocodeReply> {
    const q = normalizeQuery(query);
    const unavailable: GeoSource[] = [];
    if (q.length < 3) return { results: [], unavailable };
    const bias = opts.bias && Number.isFinite(opts.bias.lat) && Number.isFinite(opts.bias.lon) ? opts.bias : null;
    const house = hasHouseNumber(q);
    // While typing, a slow Census must not hold the Photon results back for long.
    const censusMs = opts.submit ? 9_000 : 5_000;
    const note = (s: GeoSource, e?: unknown) => {
      if (!unavailable.includes(s)) unavailable.push(s);
      console.warn(`[geocoder] ${s} failed:`, e instanceof Error ? e.message : e);
    };

    const tasks: Array<Promise<GeoResult[]>> = [];
    if (house && q.length >= 6) {
      tasks.push(
        (async () => {
          // No state or ZIP typed: assume the state of the view / my location first ("100 Main St" or "100 Main St
          // Springfield" mean the one near me); if that finds nothing, ask as typed (a city in another state).
          if (bias && !hasStateOrZip(q)) {
            const state = await stateAt(bias).catch(() => null);
            if (state) {
              const near = await census(`${q}, ${state}`, censusMs);
              if (near.length || !hasPlaceAfterStreet(q)) return near;
            }
          }
          return census(q, censusMs);
        })().catch((e) => (note("census", e), []))
      );
    }
    tasks.push(photon(q, bias).catch((e) => (note("photon", e), [])));
    // Source order is the dedupe priority: Census, then Photon.
    let merged = dedupe((await Promise.all(tasks)).flat());
    // Nominatim only for an explicit search, and only when the type-ahead sources found little.
    if (opts.submit && merged.length < 3) {
      merged = dedupe([...merged, ...(await nominatim(q, bias).catch((e) => (note("nominatim", e), [])))]);
    }
    return { results: rankResults(merged, bias, q).slice(0, MAX_RESULTS), unavailable };
  }

  return { geocode, lookupOsm };
}

/** The shared instance the routes use. */
export const geocoder = createGeocoder();
