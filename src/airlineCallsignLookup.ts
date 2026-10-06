/**
 * Matches ADS‑B "flight" field against OpenFlights-derived airline ICAO/IATA prefixes.
 * This does NOT resolve airports; it only attaches a guessed operating carrier name.
 */

type PrefixesPayload = {
  icaoPrefixes: Record<string, string>;
  iataPrefixes: Record<string, string>;
};

let cache: PrefixesPayload | null = null;
let loadPromise: Promise<void> | null = null;

export async function ensureAirlinePrefixesLoaded(): Promise<void> {
  if (cache) return;
  if (loadPromise) {
    await loadPromise;
    return;
  }

  loadPromise = (async () => {
    const url = `${import.meta.env.BASE_URL}airline-flight-prefixes.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Airline prefixes HTTP ${res.status}`);
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (parseErr) {
      throw new Error(`Airline prefixes: invalid JSON: ${String(parseErr)}`);
    }
    cache = parsed as PrefixesPayload;
  })();

  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

/** ICAO airline prefixes (callsign starts) of airlines whose name contains the query, e.g. "delta" -> ["DAL"]. */
export async function airlinePrefixesForName(query: string): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  try {
    await ensureAirlinePrefixesLoaded();
  } catch {
    return [];
  }
  if (!cache) return [];
  const out: string[] = [];
  for (const [code, name] of Object.entries(cache.icaoPrefixes)) {
    if (code.length === 3 && name.toLowerCase().includes(q)) out.push(code);
    if (out.length >= 12) break;
  }
  return out;
}

export type AirlineGuess = {
  kind: "icao" | "iata";
  code: string;
  airlineName: string;
  /** digits + optional trailing letter flight number suffix */
  flightNumberPart: string;
};

function alphanumericCompact(flight: string | undefined): string {
  return (flight ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * ICAO‑style airline designator + number (DAL123); some regions file IATA+LH numbers (UA123).
 */
export async function airlineFromFlightId(flight: string | undefined): Promise<AirlineGuess | null> {
  try {
    await ensureAirlinePrefixesLoaded();
  } catch {
    return null;
  }
  if (!cache) return null;

  const s = alphanumericCompact(flight);
  if (!s) return null;

  const match3 = /^([A-Z]{3})(\d{1,4}[A-Z]?)$/.exec(s);
  if (match3) {
    const code = match3[1];
    const name = cache.icaoPrefixes[code];
    if (name) {
      return {
        kind: "icao",
        code,
        airlineName: name,
        flightNumberPart: match3[2]
      };
    }
  }

  const match2 = /^([A-Z]{2})(\d{3,4}[A-Z]?)$/.exec(s);
  if (match2) {
    const code = match2[1];
    const name = cache.iataPrefixes[code];
    if (name) {
      return {
        kind: "iata",
        code,
        airlineName: name,
        flightNumberPart: match2[2]
      };
    }
  }

  return null;
}
