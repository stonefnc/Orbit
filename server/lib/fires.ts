/**
 * Active wildfires. Keyless by default: NASA EONET's open wildfire events (large incidents). If FIRMS_MAP_KEY is set
 * (a free NASA FIRMS key), satellite hot-spot detections for the last 24 h are served for a box instead.
 */
export type Fire = {
  id: string;
  title: string;
  lat: number;
  lon: number;
  date: string | null;
  source?: string;
  link?: string;
  /** Fire radiative power (MW) for FIRMS detections. */
  frp?: number;
  confidence?: string;
  acres?: number;
};

const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit)" };
/**
 * EONET keeps an incident "open" until someone closes it, so many long-dead fires linger for months. Only incidents with
 * a report in the last MAX_AGE_DAYS are shown (EONET's own `days` filter plus a check on the latest report date).
 */
const MAX_AGE_DAYS = 30;
const EONET = `https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&days=${MAX_AGE_DAYS * 2}&limit=1000`;
const TTL_MS = 15 * 60_000;

let eonetCache: { at: number; fires: Fire[] } | null = null;
let eonetInflight: Promise<Fire[]> | null = null;

type EonetEvent = {
  id: string;
  title: string;
  link?: string;
  sources?: Array<{ id?: string; url?: string }>;
  geometry?: Array<{ date?: string; type?: string; coordinates?: unknown; magnitudeValue?: number; magnitudeUnit?: string }>;
};

async function loadEonet(): Promise<Fire[]> {
  const res = await fetch(EONET, { headers: UA, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`EONET HTTP ${res.status}`);
  const j = JSON.parse(await res.text()) as { events?: EonetEvent[] };
  const out: Fire[] = [];
  for (const e of j.events ?? []) {
    const g = (e.geometry ?? []).filter((x) => x.type === "Point" && Array.isArray(x.coordinates)).pop();
    if (!g) continue;
    const [lon, lat] = g.coordinates as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const reported = g.date ? Date.parse(g.date) : NaN;
    if (!Number.isFinite(reported) || Date.now() - reported > MAX_AGE_DAYS * 86_400_000) continue;
    out.push({
      id: e.id,
      title: e.title,
      lat,
      lon,
      date: g.date ?? null,
      source: e.sources?.[0]?.id,
      link: e.sources?.[0]?.url ?? e.link,
      ...(g.magnitudeUnit === "acres" && typeof g.magnitudeValue === "number" ? { acres: g.magnitudeValue } : {})
    });
  }
  return out;
}

export function getEonetFires(): Promise<Fire[]> {
  if (eonetCache && Date.now() - eonetCache.at < TTL_MS) return Promise.resolve(eonetCache.fires);
  eonetInflight ??= loadEonet()
    .then((fires) => {
      eonetCache = { at: Date.now(), fires };
      return fires;
    })
    .catch((e) => {
      if (eonetCache) return eonetCache.fires;
      throw e;
    })
    .finally(() => {
      eonetInflight = null;
    });
  return eonetInflight;
}

/**
 * Burned areas (US only): NIFC / WFIGS "current interagency fire perimeters", a public ArcGIS feature service. Wildfires of
 * 100 acres and up, geometry generalised by the service (about 200 m) and rounded, rings as flat [lon, lat, ...] lists.
 */
export type FirePerimeter = {
  id: string;
  name: string;
  acres: number;
  contained: number | null;
  state: string;
  /** ISO time of the perimeter's last mapping, when the service says. */
  mapped: string | null;
  rings: number[][];
};

const PERIMETERS =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query";
const PERIMETER_TTL_MS = 30 * 60_000;
let perimeterCache: { at: number; list: FirePerimeter[] } | null = null;
let perimeterInflight: Promise<FirePerimeter[]> | null = null;

type PerimeterFeature = {
  properties?: {
    poly_IncidentName?: string | null;
    poly_GISAcres?: number | null;
    poly_PolygonDateTime?: number | null;
    attr_PercentContained?: number | null;
    attr_POOState?: string | null;
  };
  geometry?: { type?: string; coordinates?: unknown };
};

async function loadPerimeters(): Promise<FirePerimeter[]> {
  const params = new URLSearchParams({
    where: "poly_GISAcres>=100 AND attr_IncidentTypeCategory='WF'",
    outFields: "poly_IncidentName,poly_GISAcres,poly_PolygonDateTime,attr_PercentContained,attr_POOState",
    outSR: "4326",
    maxAllowableOffset: "0.002",
    geometryPrecision: "3",
    resultRecordCount: "2000",
    f: "geojson"
  });
  const res = await fetch(`${PERIMETERS}?${params.toString()}`, { headers: UA, signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`NIFC HTTP ${res.status}`);
  const j = JSON.parse(await res.text()) as { features?: PerimeterFeature[]; error?: unknown };
  if (!j.features) throw new Error("NIFC answered without features");
  const out: FirePerimeter[] = [];
  for (const [i, f] of j.features.entries()) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !Array.isArray(g.coordinates)) continue;
    const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
    // Outer rings only: holes in a burn scar are not worth the bytes at this scale.
    const rings = polys
      .map((p) => p[0])
      .filter((r): r is number[][] => Array.isArray(r) && r.length >= 4)
      .map((r) => r.flatMap(([lon, lat]) => [lon!, lat!]));
    if (!rings.length) continue;
    const p = f.properties ?? {};
    // The "current" feed keeps old burn scars; same 30-day rule as the fire points.
    if (typeof p.poly_PolygonDateTime === "number" && Date.now() - p.poly_PolygonDateTime > MAX_AGE_DAYS * 86_400_000) continue;
    out.push({
      id: String(i),
      name: (p.poly_IncidentName ?? "").trim() || "Unnamed fire",
      acres: Math.round(p.poly_GISAcres ?? 0),
      contained: typeof p.attr_PercentContained === "number" ? Math.round(p.attr_PercentContained) : null,
      state: (p.attr_POOState ?? "").replace(/^US-/, ""),
      mapped: typeof p.poly_PolygonDateTime === "number" ? new Date(p.poly_PolygonDateTime).toISOString() : null,
      rings
    });
  }
  return out;
}

export function getFirePerimeters(): Promise<FirePerimeter[]> {
  if (perimeterCache && Date.now() - perimeterCache.at < PERIMETER_TTL_MS) return Promise.resolve(perimeterCache.list);
  perimeterInflight ??= loadPerimeters()
    .then((list) => {
      perimeterCache = { at: Date.now(), list };
      return list;
    })
    .catch((e) => {
      if (perimeterCache) return perimeterCache.list;
      throw e;
    })
    .finally(() => {
      perimeterInflight = null;
    });
  return perimeterInflight;
}

export function firmsConfigured(): boolean {
  return !!process.env.FIRMS_MAP_KEY?.trim();
}

const firmsCache = new Map<string, { at: number; fires: Fire[] }>();

/** VIIRS hot-spots for the last 24 h inside a box (requires FIRMS_MAP_KEY). */
export async function getFirmsFires(w: number, s: number, e: number, n: number): Promise<Fire[]> {
  const key = process.env.FIRMS_MAP_KEY?.trim();
  if (!key) return [];
  const ck = [w, s, e, n].map((v) => v.toFixed(1)).join(",");
  const hit = firmsCache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.fires;
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/${w.toFixed(2)},${s.toFixed(2)},${e.toFixed(2)},${n.toFixed(2)}/1`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`FIRMS HTTP ${res.status}`);
  const lines = (await res.text()).trim().split(/\r?\n/);
  const head = (lines.shift() ?? "").split(",");
  const col = (name: string): number => head.indexOf(name);
  const iLat = col("latitude");
  const iLon = col("longitude");
  const iDate = col("acq_date");
  const iTime = col("acq_time");
  const iFrp = col("frp");
  const iConf = col("confidence");
  const fires: Fire[] = [];
  for (const line of lines) {
    const c = line.split(",");
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const t = (c[iTime] ?? "").padStart(4, "0");
    fires.push({
      id: `firms-${lat.toFixed(4)}-${lon.toFixed(4)}`,
      title: "Satellite fire detection",
      lat,
      lon,
      date: c[iDate] ? `${c[iDate]}T${t.slice(0, 2)}:${t.slice(2)}:00Z` : null,
      source: "NASA FIRMS (VIIRS)",
      link: "https://firms.modaps.eosdis.nasa.gov/map/",
      frp: Number(c[iFrp]) || undefined,
      confidence: c[iConf]
    });
    if (fires.length >= 20_000) break;
  }
  firmsCache.set(ck, { at: Date.now(), fires });
  if (firmsCache.size > 60) firmsCache.delete(firmsCache.keys().next().value!);
  return fires;
}
