/** Lazy-loaded ICAO → [lat, lon, displayName?, iata?] from public/airports-icao.json (IATA airports). */

let cache: Record<string, unknown> | null = null;
let loadPromise: Promise<void> | null = null;
/** IATA → single ICAO guess (first airport in our DB with that IATA). */
let iataToIcaoMemo: Map<string, string> | null = null;

function normalizeIcao(code: string | null | undefined): string | null {
  if (!code || typeof code !== "string") return null;
  const t = code.trim().toUpperCase();
  return t.length === 4 ? t : null;
}

function parseRecord(row: unknown): AirportRecord | null {
  if (!Array.isArray(row) || row.length < 2) return null;
  const lat = Number(row[0]);
  const lon = Number(row[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const displayName = typeof row[2] === "string" ? row[2].trim() : "";
  const iataRaw = typeof row[3] === "string" ? row[3].trim().toUpperCase() : "";
  const iata = /^[A-Z]{3}$/.test(iataRaw) ? iataRaw : undefined;
  return { lat, lon, displayName: displayName || "", iata };
}

export type AirportRecord = {
  lat: number;
  lon: number;
  /** e.g. "Los Angeles International Airport · Los Angeles" */
  displayName: string;
  iata?: string;
};

export async function ensureAirportsLoaded(): Promise<void> {
  if (cache) return;
  if (loadPromise) {
    await loadPromise;
    return;
  }

  loadPromise = (async () => {
    const url = `${import.meta.env.BASE_URL}airports-icao.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Airports data HTTP ${res.status}`);
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (parseErr) {
      throw new Error(`Airports data: invalid JSON: ${String(parseErr)}`);
    }
    cache = parsed as Record<string, unknown>;
  })();

  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

function rebuildIataToIcaoMap(): void {
  iataToIcaoMemo = new Map();
  if (!cache) return;
  for (const [icaoKey, row] of Object.entries(cache)) {
    const icao = normalizeIcao(icaoKey);
    const r = parseRecord(row);
    if (!icao || !r?.iata) continue;
    if (!iataToIcaoMemo.has(r.iata)) iataToIcaoMemo.set(r.iata, icao);
  }
}

export async function airportRecordForIcao(code: string | null | undefined): Promise<AirportRecord | null> {
  const icao = normalizeIcao(code);
  if (!icao) return null;
  await ensureAirportsLoaded();
  return parseRecord(cache?.[icao]);
}

export async function icaoFromIata(iata: string | null | undefined): Promise<string | null> {
  if (!iata || typeof iata !== "string") return null;
  const t = iata.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(t)) return null;
  await ensureAirportsLoaded();
  if (!iataToIcaoMemo) rebuildIataToIcaoMap();
  return iataToIcaoMemo?.get(t) ?? null;
}

/** @returns WGS84 { lat, lon } or null */
export async function coordsForIcao(code: string | null | undefined): Promise<{ lat: number; lon: number } | null> {
  const r = await airportRecordForIcao(code);
  return r ? { lat: r.lat, lon: r.lon } : null;
}

/** Optional airport display line from Aviationstack (or similar) over our static DB title. */
export type AirportApiOverlay = { name: string; iata?: string };

/**
 * Sidebar copy for departure or arrival. When `preferFullNames` (airline / bizjet / military buckets),
 * uses airport name + IATA/ICAO from the database. `apiOverlay` wins for the human-readable title when set.
 */
export function formatAirportSidebar(
  icao: string,
  record: AirportRecord | null,
  endpoint: "departure" | "arrival",
  preferFullNames: boolean,
  extraNote?: string,
  apiOverlay?: AirportApiOverlay | null
): string {
  const role = endpoint === "departure" ? "estimated departure" : "estimated landing";
  const tripIata = (apiOverlay?.iata ?? record?.iata)?.trim();
  const codes = tripIata ? `${tripIata} / ${icao}` : icao;

  const nameFromApi = apiOverlay?.name?.trim();
  const nameLocal = record?.displayName?.trim();
  const displayHead = nameFromApi || nameLocal;

  if (preferFullNames && displayHead) {
    const head = `${displayHead} (${codes})`;
    return extraNote ? `${head} — ${extraNote}` : `${head} — ${role}`;
  }
  return extraNote ? `${icao} — ${extraNote}` : `${icao} — ${role}`;
}
