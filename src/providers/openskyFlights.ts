/**
 * OpenSky [flights/aircraft](https://openskynetwork.github.io/opensky-api/rest.html) — estimated departure/arrival airports.
 * Requires authentication for many accounts; anonymous often returns "You cannot access historical flights".
 * Window must be ≤ 2 days; rows may omit one airport mid-flight — we accept partial rows and 3-letter (IATA-like) codes.
 */

const OPEN_SKY_FLIGHT_AIRPORTS_TTL_MS = 15 * 60 * 1000;
const flightAirportsMemo = new Map<
  string,
  { at: number; data: OpenSkyAirportCodes | null }
>();

/** ICAO (4) or IATA (3) from OpenSky; resolve 3-letter via `icaoFromIata` in the app. */
export type OpenSkyAirportCodes = {
  dep: string | null;
  arr: string | null;
};

/** OpenSky flights/aircraft is proxied through the plane API server (OAuth + no browser secrets). */
function openSkyFlightsApiBase(): string {
  const fromEnv = import.meta.env.VITE_PLANE_API_BASE as string | undefined;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  return "";
}

export type OpenSkyFlightRecord = {
  icao24?: string;
  firstSeen?: number;
  lastSeen?: number;
  estDepartureAirport?: string | null;
  estArrivalAirport?: string | null;
};

function normalizeHex(icao24: string): string {
  return icao24.trim().toLowerCase();
}

function normOpenSkyAirportField(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]{4}$/.test(t)) return t;
  if (/^[A-Z]{3}$/.test(t)) return t;
  return null;
}

/**
 * Prefer flights whose [firstSeen, lastSeen] contains "now"; then prefer rows with both airports;
 * otherwise the latest-seen row with any airport (often only departure filed mid-leg).
 */
function pickOpenSkyAirportCodes(rows: OpenSkyFlightRecord[], nowSec: number): OpenSkyAirportCodes | null {
  const enriched = rows
    .map((r) => {
      const dep = normOpenSkyAirportField(r.estDepartureAirport);
      const arr = normOpenSkyAirportField(r.estArrivalAirport);
      const fs = r.firstSeen ?? 0;
      const ls = r.lastSeen ?? 0;
      return { dep, arr, fs, ls };
    })
    .filter((x) => x.dep || x.arr);

  if (!enriched.length) return null;

  const active = enriched.filter((x) => x.fs <= nowSec && nowSec <= x.ls);
  const pool = active.length > 0 ? active : enriched;

  const full = pool.filter((x) => x.dep && x.arr);
  if (full.length > 0) {
    const best = full.reduce((a, x) => (x.ls > a.ls ? x : a));
    return { dep: best.dep!, arr: best.arr! };
  }

  const best = pool.reduce((a, x) => (x.ls > a.ls ? x : a));
  return { dep: best.dep ?? null, arr: best.arr ?? null };
}

/**
 * Returns best-effort filed airports for this transponder in [begin, end] (Unix seconds).
 */
export async function fetchOpenSkyEstimatedAirports(
  icao24: string,
  beginSec: number,
  endSec: number
): Promise<OpenSkyAirportCodes | null> {
  const hex = normalizeHex(icao24);
  const memo = flightAirportsMemo.get(hex);
  if (memo && Date.now() - memo.at < OPEN_SKY_FLIGHT_AIRPORTS_TTL_MS) {
    return memo.data;
  }

  const q = new URLSearchParams({
    icao24: hex,
    begin: String(Math.floor(beginSec)),
    end: String(Math.floor(endSec))
  });
  const root = openSkyFlightsApiBase();
  const url = `${root}/api/opensky/flights/aircraft?${q.toString()}`;
  const res = await fetch(url);
  if (res.status === 404) {
    flightAirportsMemo.set(hex, { at: Date.now(), data: null });
    return null;
  }
  if (!res.ok) {
    const t = await res.text();
    if (t.includes("cannot access historical flights")) {
      flightAirportsMemo.set(hex, { at: Date.now(), data: null });
      return null;
    }
    throw new Error(`OpenSky flights ${res.status}: ${t.slice(0, 120)}`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    flightAirportsMemo.set(hex, { at: Date.now(), data: null });
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) {
    flightAirportsMemo.set(hex, { at: Date.now(), data: null });
    return null;
  }

  const nowSec = Date.now() / 1000;
  const rows = data as OpenSkyFlightRecord[];
  const out = pickOpenSkyAirportCodes(rows, nowSec);
  flightAirportsMemo.set(hex, { at: Date.now(), data: out });
  return out;
}

/** Default lookback: just under 2 days (API max window). */
export function openSkyFlightWindowNow(): { beginSec: number; endSec: number } {
  const endSec = Math.floor(Date.now() / 1000);
  const beginSec = endSec - 172700;
  return { beginSec, endSec };
}
