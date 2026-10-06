/**
 * Active tropical cyclones from NOAA's National Hurricane Center (Atlantic, eastern and central North Pacific): current
 * position and intensity plus the official forecast track, uncertainty cone and past track. Keyless public data;
 * cached for 15 minutes.
 */
export type CycloneTrack = {
  past: Array<[number, number]>;
  forecast: Array<{ lon: number; lat: number; label?: string; windKt?: number }>;
  cone: Array<Array<[number, number]>>;
};

export type Cyclone = {
  id: string;
  bin: string;
  name: string;
  classification: string;
  windKt: number | null;
  pressureMb: number | null;
  lat: number;
  lon: number;
  movementDir: number | null;
  movementSpeedKt: number | null;
  advisoryTime: string | null;
  track: CycloneTrack;
};

const CURRENT = "https://www.nhc.noaa.gov/CurrentStorms.json";
const MAPSERVER = "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer";
const TTL_MS = 15 * 60_000;
const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit)" };

let cache: { at: number; storms: Cyclone[] } | null = null;
let inflight: Promise<Cyclone[]> | null = null;
let layerIds: { at: number; byName: Map<string, number> } | null = null;

type GeoFeature = { geometry?: { type: string; coordinates: unknown }; properties?: Record<string, unknown> };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return JSON.parse(await res.text()) as T;
}

async function layerIdFor(name: string): Promise<number | undefined> {
  if (!layerIds || Date.now() - layerIds.at > 6 * 3_600_000) {
    const s = await getJson<{ layers?: Array<{ id: number; name: string }> }>(`${MAPSERVER}?f=json`);
    layerIds = { at: Date.now(), byName: new Map((s.layers ?? []).map((l) => [l.name, l.id])) };
  }
  return layerIds.byName.get(name);
}

async function features(name: string): Promise<GeoFeature[]> {
  const id = await layerIdFor(name);
  if (id === undefined) return [];
  try {
    const g = await getJson<{ features?: GeoFeature[] }>(
      `${MAPSERVER}/${id}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`
    );
    return g.features ?? [];
  } catch {
    return [];
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function lines(fs: GeoFeature[]): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  for (const f of fs) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "LineString") out.push((g.coordinates as number[][]).map(([lo, la]) => [lo!, la!]));
    else if (g.type === "MultiLineString")
      for (const l of g.coordinates as number[][][]) out.push(l.map(([lo, la]) => [lo!, la!]));
  }
  return out;
}

function rings(fs: GeoFeature[]): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  for (const f of fs) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") out.push((g.coordinates as number[][][])[0]!.map(([lo, la]) => [lo!, la!]));
    else if (g.type === "MultiPolygon")
      for (const p of g.coordinates as number[][][][]) out.push(p[0]!.map(([lo, la]) => [lo!, la!]));
  }
  return out;
}

async function load(): Promise<Cyclone[]> {
  const cur = await getJson<{
    activeStorms?: Array<Record<string, unknown>>;
  }>(CURRENT);
  const storms: Cyclone[] = [];
  for (const s of cur.activeStorms ?? []) {
    const bin = String(s.binNumber ?? "");
    const lat = num(s.latitudeNumeric);
    const lon = num(s.longitudeNumeric);
    if (!bin || lat == null || lon == null) continue;
    const [fTrack, fCone, fPts, pTrack] = await Promise.all([
      features(`${bin} Forecast Track`),
      features(`${bin} Forecast Cone`),
      features(`${bin} Forecast Points`),
      features(`${bin} Past Track`)
    ]);
    const forecast: CycloneTrack["forecast"] = [];
    for (const f of fPts) {
      const c = f.geometry?.coordinates as number[] | undefined;
      if (f.geometry?.type !== "Point" || !c) continue;
      const p = f.properties ?? {};
      forecast.push({
        lon: c[0]!,
        lat: c[1]!,
        label: typeof p.datelbl === "string" ? p.datelbl : typeof p.fcstprd === "string" ? p.fcstprd : undefined,
        windKt: num(p.maxwind) ?? undefined
      });
    }
    storms.push({
      id: String(s.id ?? bin),
      bin,
      name: String(s.name ?? "Unnamed"),
      classification: String(s.classification ?? ""),
      windKt: num(s.intensity),
      pressureMb: num(s.pressure),
      lat,
      lon,
      movementDir: num(s.movementDir),
      movementSpeedKt: num(s.movementSpeed),
      advisoryTime: typeof s.lastUpdate === "string" ? s.lastUpdate : null,
      track: {
        past: lines(pTrack).flat(),
        forecast: forecast.length ? forecast : lines(fTrack).flat().map(([lon, lat]) => ({ lon, lat })),
        cone: rings(fCone)
      }
    });
  }
  return storms;
}

export function getCyclones(): Promise<Cyclone[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.storms);
  inflight ??= load()
    .then((storms) => {
      cache = { at: Date.now(), storms };
      return storms;
    })
    .catch((e) => {
      if (cache) return cache.storms; // serve the last good answer through an upstream hiccup
      throw e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
