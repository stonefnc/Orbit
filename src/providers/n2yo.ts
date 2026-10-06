import type { Satellite } from "./celestrak";

type N2YoTleResponse = {
  info?: {
    satname?: string;
    satid?: number;
  };
  tle?: string;
};

export type N2YoSatelliteDetails = {
  satName: string | null;
  satId: number | null;
};

const cache = new Map<number, N2YoSatelliteDetails | null>();
const tleCache = new Map<number, Satellite | null>();
const tleFailureReason = new Map<number, "network_failed_fetch" | "http_non_ok" | "invalid_tle" | "unknown">();
const N2YO_SEED_NORAD_IDS = [
  25544, 48274, 49044, 20580, 20959, 24876, 25994, 27386, 27663, 28474, 29601, 32260, 33591,
  37849, 40069, 40482, 41328, 43226, 44713, 36086, 53239, 66052, 66515, 66906, 67683, 67684
];

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function parseTleLines(tle: string): { tle1: string; tle2: string } | null {
  const lines = tle
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const tle1 = lines.find((line) => line.startsWith("1 "));
  const tle2 = lines.find((line) => line.startsWith("2 "));
  if (!tle1 || !tle2) return null;
  return { tle1, tle2 };
}

export async function fetchN2YoSatelliteDetails(
  noradId: number,
  apiKey: string
): Promise<N2YoSatelliteDetails | null> {
  if (cache.has(noradId)) {
    return cache.get(noradId) ?? null;
  }

  try {
    const url = `https://api.n2yo.com/rest/v1/satellite/tle/${noradId}?apiKey=${apiKey}`;
    const response = await fetchWithTimeout(url, 12000);
    if (!response.ok) {
      cache.set(noradId, null);
      return null;
    }

    const payload = (await response.json()) as N2YoTleResponse;
    const details: N2YoSatelliteDetails = {
      satName: payload.info?.satname ?? null,
      satId: payload.info?.satid ?? null
    };
    cache.set(noradId, details);
    return details;
  } catch {
    cache.set(noradId, null);
    return null;
  }
}

async function fetchN2YoSatelliteTle(noradId: number, apiKey: string): Promise<Satellite | null> {
  if (tleCache.has(noradId)) {
    return tleCache.get(noradId) ?? null;
  }

  try {
    const url = `https://api.n2yo.com/rest/v1/satellite/tle/${noradId}?apiKey=${apiKey}`;
    const response = await fetchWithTimeout(url, 12000);
    if (!response.ok) {
      tleFailureReason.set(noradId, "http_non_ok");
      tleCache.set(noradId, null);
      return null;
    }
    const payload = (await response.json()) as N2YoTleResponse;
    const satId = payload.info?.satid ?? noradId;
    const satName = payload.info?.satname ?? `NORAD ${satId}`;
    const tle = payload.tle;
    if (!tle) {
      tleCache.set(noradId, null);
      return null;
    }
    const parsed = parseTleLines(tle);
    if (!parsed) {
      tleFailureReason.set(noradId, "invalid_tle");
      tleCache.set(noradId, null);
      return null;
    }

    const normalized: Satellite = {
      name: satName,
      noradId: satId,
      tle1: parsed.tle1,
      tle2: parsed.tle2,
      operator: null,
      operatorCountry: null,
      purpose: null
    };
    tleFailureReason.delete(noradId);
    tleCache.set(noradId, normalized);
    return normalized;
  } catch (error) {
    const reason =
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: string }).name === "TypeError" &&
      String(error).includes("Failed to fetch")
        ? "network_failed_fetch"
        : "unknown";
    tleFailureReason.set(noradId, reason);
    tleCache.set(noradId, null);
    return null;
  }
}

export async function fetchN2YoSatellites(apiKey: string): Promise<Satellite[]> {
  const satellites: Satellite[] = [];
  let failedFetchCount = 0;
  for (const noradId of N2YO_SEED_NORAD_IDS) {
    const satellite = await fetchN2YoSatelliteTle(noradId, apiKey);
    if (satellite) {
      satellites.push(satellite);
    } else if (tleFailureReason.get(noradId) === "network_failed_fetch") {
      failedFetchCount += 1;
    }
  }
  if (satellites.length === 0 && failedFetchCount === N2YO_SEED_NORAD_IDS.length) {
    throw new Error("N2YO browser requests blocked (CORS/network): all fetches failed before HTTP response.");
  }
  return satellites;
}
