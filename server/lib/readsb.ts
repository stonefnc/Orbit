import type { PlanePositionSource } from "../../shared/planeContract";
import { fetchText, ProviderHttpError } from "./fetchUtil";
import type { RawPlaneLayer } from "./openskyStates";

export type ReadsbSource = Extract<PlanePositionSource, "adsb_lol" | "adsb_fi" | "airplanes_live">;

type SourceCfg = {
  url: (lat: number, lon: number, distNm: number) => string;
  minIntervalMs: number;
};

/** Keyless community ADS-B aggregators that share the readsb v2 JSON schema. */
export const READSB_SOURCES: Record<ReadsbSource, SourceCfg> = {
  adsb_lol: {
    url: (lat, lon, d) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${d}`,
    minIntervalMs: 2000
  },
  adsb_fi: {
    url: (lat, lon, d) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${d}`,
    minIntervalMs: 1100
  },
  airplanes_live: {
    url: (lat, lon, d) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${d}`,
    minIntervalMs: 1100
  }
};

const USER_AGENT = "Orbit/1.0 (personal; +https://github.com/runna5k/Orbit)";

/** Reserve the next free slot synchronously so concurrent callers can never fire together. */
const nextFreeAt = new Map<string, number>();
async function throttle(source: string, minMs: number): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextFreeAt.get(source) ?? 0);
  nextFreeAt.set(source, at + minMs);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function fetchReadsbPoint(
  source: ReadsbSource,
  lat: number,
  lon: number,
  distNm: number
): Promise<RawPlaneLayer[]> {
  const cfg = READSB_SOURCES[source];
  await throttle(source, cfg.minIntervalMs);

  const d = Math.min(250, Math.max(25, Math.round(distNm)));
  const { ok, status, text, retryAfterSec } = await fetchText(cfg.url(lat, lon, d), {
    timeoutMs: 15_000,
    retries: 0,
    headers: { Accept: "application/json", "User-Agent": USER_AGENT }
  });
  if (!ok) throw new ProviderHttpError(source, status, retryAfterSec);

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${source}: response was not JSON`);
  }
  if (!json || typeof json !== "object") throw new Error(`${source}: unexpected payload`);
  const root = json as { ac?: unknown; aircraft?: unknown };
  const rows = Array.isArray(root.ac) ? root.ac : Array.isArray(root.aircraft) ? root.aircraft : null;
  if (!rows) throw new Error(`${source}: payload had no aircraft array`);

  const nowSec = Date.now() / 1000;
  const out: RawPlaneLayer[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    if (typeof o.hex !== "string") continue;
    const hex = o.hex.trim().toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{6}$/.test(hex)) continue;

    const latN = o.lat;
    const lonN = o.lon;
    if (typeof latN !== "number" || typeof lonN !== "number") continue;

    const seen = typeof o.seen_pos === "number" ? o.seen_pos : typeof o.seen === "number" ? o.seen : 0;
    const lastSeenSec = Math.max(0, nowSec - seen);

    const altRaw = o.alt_baro;
    let altitudeFt: number | null = null;
    let onGround = false;
    if (altRaw === "ground") {
      onGround = true;
      altitudeFt = 0;
    } else if (typeof altRaw === "number") {
      altitudeFt = altRaw;
    }

    out.push({
      hex,
      lat: latN,
      lon: lonN,
      lastSeenSec,
      source,
      callsign: str(o.flight),
      registration: str(o.r),
      aircraftType: str(o.t),
      description: str(o.desc),
      altitudeFt,
      speedKt: typeof o.gs === "number" ? o.gs : null,
      headingDeg: typeof o.track === "number" ? o.track : null,
      verticalRateFpm: typeof o.baro_rate === "number" ? o.baro_rate : null,
      onGround,
      category: str(o.category),
      originAirport: null,
      destinationAirport: null,
      departureTime: null,
      arrivalTime: null
    });
  }

  return out;
}
