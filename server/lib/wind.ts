/**
 * Global 10 m wind field on a coarse grid, from Open-Meteo's keyless forecast API (model data, updated hourly).
 * Returned as u (eastward) and v (northward) components in m/s so the browser can interpolate and animate particles.
 */
export type WindField = {
  /** Latitude of the first row (south) and longitude of the first column (west). */
  lat0: number;
  lon0: number;
  stepLat: number;
  stepLon: number;
  nLat: number;
  nLon: number;
  /** Row-major, south to north, west to east. */
  u: number[];
  v: number[];
  /** ISO time of the model analysis the numbers come from. */
  time: string | null;
};

const STEP_LAT = 7;
const STEP_LON = 10;
const LAT_MIN = -84;
const LAT_MAX = 84;
const TTL_MS = 30 * 60_000;
// One request: Open-Meteo throttles by locations per minute, so the whole grid goes in a single call.
const BATCH = 1000;

let cache: { at: number; field: WindField } | null = null;
let inflight: Promise<WindField> | null = null;

type Row = { current?: { time?: string; wind_speed_10m?: number; wind_direction_10m?: number } };

async function load(): Promise<WindField> {
  const lats: number[] = [];
  const lons: number[] = [];
  for (let la = LAT_MIN; la <= LAT_MAX; la += STEP_LAT) for (let lo = -180; lo < 180; lo += STEP_LON) {
    lats.push(la);
    lons.push(lo);
  }
  const nLat = Math.floor((LAT_MAX - LAT_MIN) / STEP_LAT) + 1;
  const nLon = 360 / STEP_LON;
  const u = new Array<number>(lats.length).fill(0);
  const v = new Array<number>(lats.length).fill(0);
  let time: string | null = null;

  for (let i = 0; i < lats.length; i += BATCH) {
    const la = lats.slice(i, i + BATCH).join(",");
    const lo = lons.slice(i, i + BATCH).join(",");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit)" },
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const rows = (await res.json()) as Row[] | Row;
    const list = Array.isArray(rows) ? rows : [rows];
    list.forEach((row, k) => {
      const spd = row.current?.wind_speed_10m;
      const dir = row.current?.wind_direction_10m;
      if (typeof spd !== "number" || typeof dir !== "number") return;
      // Meteorological direction is where the wind comes FROM.
      const rad = (dir * Math.PI) / 180;
      u[i + k] = -spd * Math.sin(rad);
      v[i + k] = -spd * Math.cos(rad);
      time ??= row.current?.time ?? null;
    });
  }
  return { lat0: LAT_MIN, lon0: -180, stepLat: STEP_LAT, stepLon: STEP_LON, nLat, nLon, u: u.map(round1), v: v.map(round1), time };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function getWindField(): Promise<WindField> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.field);
  inflight ??= load()
    .then((field) => {
      cache = { at: Date.now(), field };
      return field;
    })
    .catch((e) => {
      if (cache) return cache.field;
      throw e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
