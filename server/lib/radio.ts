/**
 * Geolocated radio stations from the community Radio Browser directory (https://www.radio-browser.info), keyless.
 * The most-listened few thousand stations that publish coordinates are cached for 12 hours.
 */
export type RadioStation = [
  id: string,
  name: string,
  lat: number,
  lon: number,
  country: string,
  tags: string,
  codec: string,
  bitrate: number,
  homepage: string,
  streamUrl: string
];

const MIRRORS = [
  "https://de1.api.radio-browser.info",
  "https://de2.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://at1.api.radio-browser.info"
];
const TTL_MS = 12 * 3_600_000;
const LIMIT = 6000;
const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)" };

let cache: { at: number; stations: RadioStation[] } | null = null;
let inflight: Promise<RadioStation[]> | null = null;

type Raw = {
  stationuuid: string;
  name: string;
  url_resolved?: string;
  url?: string;
  homepage?: string;
  tags?: string;
  country?: string;
  codec?: string;
  bitrate?: number;
  geo_lat?: number | null;
  geo_long?: number | null;
  lastcheckok?: number;
};

function httpUrl(u: string | undefined): string {
  if (!u) return "";
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : "";
  } catch {
    return "";
  }
}

async function load(): Promise<RadioStation[]> {
  let lastErr: unknown;
  for (const base of MIRRORS) {
    try {
      const res = await fetch(
        `${base}/json/stations/search?has_geo_info=true&hidebroken=true&order=clickcount&reverse=true&limit=${LIMIT}`,
        { headers: UA, signal: AbortSignal.timeout(30_000) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as Raw[];
      const out: RadioStation[] = [];
      for (const r of rows) {
        const stream = httpUrl(r.url_resolved || r.url);
        if (!stream || typeof r.geo_lat !== "number" || typeof r.geo_long !== "number") continue;
        if (Math.abs(r.geo_lat) > 90 || Math.abs(r.geo_long) > 180) continue;
        out.push([
          r.stationuuid,
          (r.name ?? "").trim().slice(0, 80),
          Math.round(r.geo_lat * 1e4) / 1e4,
          Math.round(r.geo_long * 1e4) / 1e4,
          r.country ?? "",
          (r.tags ?? "").split(",").slice(0, 4).join(", "),
          r.codec ?? "",
          r.bitrate ?? 0,
          httpUrl(r.homepage),
          stream
        ]);
      }
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Radio Browser unavailable");
}

export function getRadioStations(): Promise<RadioStation[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.stations);
  inflight ??= load()
    .then((stations) => {
      cache = { at: Date.now(), stations };
      return stations;
    })
    .catch((e) => {
      if (cache) return cache.stations;
      throw e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
