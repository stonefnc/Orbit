/**
 * [Aviationstack](https://aviationstack.com/) flight-status lookup — **quota‑expensive**.
 * Default client behavior uses **few requests** (`VITE_AVIATIONSTACK_SPARING=true`) and callers should
 * prefer **OpenSky by ICAO24** first (`loadAndDrawSelectedPlaneRoute` in main.ts). Used for any
 * flight-number-style callsign (scheduled / cargo), not only the “airline” traffic bucket.
 *
 * Dev: `AVIATIONSTACK_ACCESS_KEY` in `.env.local` + `/aviationstack-proxy`.
 * Production: `VITE_AVIATIONSTACK_API_BASE` → relay that attaches `access_key`.
 */

import { sanitizeCallsign } from "./adsbfi";

/** Minimal aircraft identity for Aviationstack matching. */
export type AviationstackAircraftRef = {
  hex: string;
  flight?: string | null;
  r?: string | null;
};

/** Long cache — same hex+flight rarely needs re-querying inside a session/week. */
const MEMO_HIT_MS =
  typeof import.meta.env.VITE_AVIATIONSTACK_CACHE_MS === "string" &&
  /^\d+$/.test(import.meta.env.VITE_AVIATIONSTACK_CACHE_MS.trim())
    ? Number(import.meta.env.VITE_AVIATIONSTACK_CACHE_MS)
    : 7 * 24 * 3600 * 1000;

const memo = new Map<string, { at: number; value: AviationstackMatchedRoute | null }>();

export type AviationstackMatchedRoute = {
  depIcao: string | null;
  arrIcao: string | null;
  depApiName?: string;
  depApiIata?: string;
  arrApiName?: string;
  arrApiIata?: string;
};

type AsFlightRow = {
  flight_status?: string;
  departure?: { airport?: string; iata?: string; icao?: string };
  arrival?: { airport?: string; iata?: string; icao?: string };
  aircraft?: { registration?: string; icao24?: string };
};

/** When true (default): at most ~2 Aviationstack GETs per fresh lookup instead of scanning many variants. */
const SPARING_AV_STACK =
  import.meta.env.VITE_AVIATIONSTACK_SPARING !== "0" &&
  import.meta.env.VITE_AVIATIONSTACK_SPARING !== "false";

function apiBase(): string | null {
  if (import.meta.env.DEV) {
    return "/aviationstack-proxy";
  }
  const raw = (import.meta.env.VITE_AVIATIONSTACK_API_BASE as string | undefined)?.trim();
  return raw?.replace(/\/$/, "") ?? null;
}

function compactFlightId(flight?: string | null): string {
  const s = sanitizeCallsign(flight)?.toUpperCase() ?? "";
  return s.replace(/[^A-Z0-9]/g, "");
}

function normIcaoField(v?: string): string | null {
  const t = (v ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{4}$/.test(t) ? t : null;
}

function padHex24(hex: string): string {
  const x = hex.trim().toUpperCase().replace(/^0x/i, "");
  return x.length <= 6 ? x.padStart(6, "0") : x;
}

function normTail(v?: string | null): string {
  return (v ?? "").toUpperCase().replace(/[\s-]/g, "");
}

function pickBest(rows: AsFlightRow[], ac: AviationstackAircraftRef): AsFlightRow | null {
  const expectReg = normTail(ac.r);
  const expectHex = padHex24(ac.hex);

  const scored = rows.map((r) => {
    let s = 0;
    const st = r.flight_status ?? "";
    if (st === "active") s += 80;
    else if (st === "scheduled") s += 60;
    else if (st === "landed") s += 40;

    const reg = normTail(r.aircraft?.registration);
    if (expectReg && reg && reg === expectReg) s += 200;
    const h = padHex24((r.aircraft?.icao24 ?? "").trim());
    if (h && h === expectHex) s += 200;
    return { r, s };
  });

  scored.sort((a, b) => b.s - a.s);
  return scored[0]?.r ?? null;
}

function utcIsoDate(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type FetchResult =
  | { ok: true; rows: AsFlightRow[] }
  | { ok: false; hint: string };

async function fetchFlights(params: Record<string, string>): Promise<FetchResult> {
  const base = apiBase();
  if (!base) return { ok: false, hint: "no_api_base" };

  const paramsWithLimit = { limit: "5", ...params };
  const search = new URLSearchParams(paramsWithLimit);
  const url = `${base}/v1/flights?${search}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { ok: false, hint: "network_error" };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, hint: "invalid_json" };
  }

  if (!raw || typeof raw !== "object") return { ok: false, hint: "empty_response" };

  const errObj = (raw as { error?: { type?: string; info?: string; message?: string } }).error;
  if (errObj != null && typeof errObj === "object") {
    const msg =
      typeof errObj.info === "string"
        ? errObj.info
        : typeof errObj.message === "string"
          ? errObj.message
          : JSON.stringify(errObj);
    if (import.meta.env.DEV && msg) console.warn("[Aviationstack]", msg);
    return { ok: false, hint: msg };
  }

  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data)) return { ok: false, hint: "no_data_array" };
  return { ok: true, rows: data as AsFlightRow[] };
}

async function rowsFromAttempts(attemptParams: Record<string, string>[]): Promise<AsFlightRow[]> {
  const seenKeys = new Set<string>();
  for (const raw of attemptParams) {
    const key = JSON.stringify(raw, Object.keys(raw).sort());
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const r = await fetchFlights(raw);
    if (!r.ok) continue;
    if (r.rows.length > 0) return r.rows;
  }
  return [];
}

function lookupFromRows(
  ac: AviationstackAircraftRef,
  rows: AsFlightRow[]
): AviationstackMatchedRoute | null {
  if (!rows.length) return null;

  const best = pickBest(rows, ac);
  if (!best) return null;
  const dep = best.departure;
  const arr = best.arrival;
  if (!dep && !arr) return null;

  return {
    depIcao: normIcaoField(dep?.icao),
    arrIcao: normIcaoField(arr?.icao),
    depApiName: dep?.airport ?? undefined,
    depApiIata: dep?.iata ?? undefined,
    arrApiName: arr?.airport ?? undefined,
    arrApiIata: arr?.iata ?? undefined
  };
}

function attemptsForIcaoTriple(compact: string): Record<string, string>[] {
  const m3full = /^([A-Z]{3})(\d{1,4}[A-Z]?)$/.exec(compact);
  const numDigits = /^([A-Z]{3})(\d+)([A-Z]?)$/.exec(compact);
  const airline = (numDigits ?? m3full)?.[1];
  const numCore = numDigits?.[2] ?? m3full?.[2];

  const out: Record<string, string>[] = [];
  if (m3full) {
    if (SPARING_AV_STACK) {
      out.push({ flight_icao: compact, flight_date: utcIsoDate(0) });
      out.push({ flight_icao: compact, flight_date: utcIsoDate(-1) });
    } else {
      out.push({ flight_icao: compact, flight_date: utcIsoDate(0) });
      out.push({ flight_icao: compact, flight_date: utcIsoDate(-1) });
      out.push({ flight_icao: compact, flight_date: utcIsoDate(0), flight_status: "active" });
      out.push({ flight_icao: compact, flight_date: utcIsoDate(-1), flight_status: "active" });
      out.push({ flight_icao: compact });
    }
  }
  if (
    airline &&
    numCore?.length &&
    /^[A-Z]{3}$/.test(airline) &&
    !SPARING_AV_STACK &&
    airline === m3full?.[1]
  ) {
    out.push({ airline_icao: airline, flight_number: numCore!, flight_date: utcIsoDate(0) });
    out.push({ airline_icao: airline, flight_number: numCore!, flight_date: utcIsoDate(-1) });
    out.push({ airline_icao: airline, flight_number: numCore! });
    const sfx = /^(\d{1,4})([A-Z])$/.exec(numCore ?? "");
    if (sfx) {
      out.push({ airline_icao: airline, flight_number: sfx[1], flight_date: utcIsoDate(0) });
      out.push({ airline_icao: airline, flight_number: sfx[1], flight_date: utcIsoDate(-1) });
    }
  }
  return out;
}

function attemptsForIataPair(compact: string): Record<string, string>[] {
  const m2 = /^([A-Z]{2})(\d{1,4}[A-Z]?)$/.exec(compact);
  if (!m2) return [];
  const iataAirline = m2[1];
  const flightNumRaw = m2[2];

  if (SPARING_AV_STACK) {
    return [
      { flight_iata: compact, flight_date: utcIsoDate(0) },
      { airline_iata: iataAirline, flight_number: flightNumRaw, flight_date: utcIsoDate(0) }
    ] as Record<string, string>[];
  }

  const suffixAttempts = (() => {
    const sfx = /^(\d{1,4})([A-Z])$/.exec(flightNumRaw);
    if (!sfx) return [] as Record<string, string>[];
    return [
      { airline_iata: iataAirline, flight_number: sfx[1], flight_date: utcIsoDate(0) },
      { airline_iata: iataAirline, flight_number: sfx[1], flight_date: utcIsoDate(-1) },
      { airline_iata: iataAirline, flight_number: sfx[1] }
    ] as Record<string, string>[];
  })();

  const base: Record<string, string>[] = [
    { flight_iata: compact, flight_date: utcIsoDate(0) },
    { flight_iata: compact, flight_date: utcIsoDate(-1) },
    { flight_iata: compact, flight_date: utcIsoDate(0), flight_status: "active" },
    { flight_iata: compact, flight_status: "active" },
    { flight_iata: compact },
    { airline_iata: iataAirline, flight_number: flightNumRaw, flight_date: utcIsoDate(0) },
    { airline_iata: iataAirline, flight_number: flightNumRaw, flight_date: utcIsoDate(-1) },
    { airline_iata: iataAirline, flight_number: flightNumRaw }
  ];

  return base.concat(suffixAttempts);
}

/**
 * Flight-status airports for filed flight IDs (ICAO/IATA + number). Respect memo + sparing mode for API quota.
 */
export async function aviationstackRouteForAirlineAircraft(
  ac: AviationstackAircraftRef
): Promise<AviationstackMatchedRoute | null> {
  if (!apiBase()) return null;

  const compact = compactFlightId(ac.flight);
  if (!compact) return null;

  const memoKey = `${ac.hex}|${compact}`;
  const now = Date.now();
  const hit = memo.get(memoKey);
  if (hit && now - hit.at < MEMO_HIT_MS) return hit.value;

  const m3 = /^([A-Z]{3})\d/.test(compact);
  const m2 = /^[A-Z]{2}\d/.test(compact);

  let attempts: Record<string, string>[] = [];
  if (m3 && compact.length >= 4) attempts = [...attemptsForIcaoTriple(compact)];
  else if (m2) attempts = [...attemptsForIataPair(compact)];

  let rows: AsFlightRow[] = [];
  if (attempts.length) {
    rows = await rowsFromAttempts(attempts);
  }

  const result = lookupFromRows(ac, rows);

  memo.set(memoKey, { at: now, value: result });
  return result;
}
