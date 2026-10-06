import { localApiBase, parseCatalogId, type Satellite } from "./celestrak";

type KeepTrackSatResponse = {
  NAME?: string;
  NORAD_CAT_ID?: number | string;
  TLE_LINE_1?: string;
  TLE_LINE_2?: string;
  COUNTRY?: string;
  PURPOSE?: string;
};

type KeepTrackBulkSat = {
  noradId?: number | string;
  NORAD_CAT_ID?: number | string;
  name?: string;
  NAME?: string;
  tle1?: string;
  TLE_LINE_1?: string;
  tle2?: string;
  TLE_LINE_2?: string;
  country?: string;
  COUNTRY?: string;
  purpose?: string;
  PURPOSE?: string;
};

/** Upper bound for merged KeepTrack responses (brief + full + mirror + seeds). */
export const MAX_KEEPTRACK_SATELLITES = 8000;

const STAGGER_MS = 900;
const NORAD_BATCH = 4;

/** The local server holds the KeepTrack key and makes the calls (`server/routes/keeptrack.ts`); the browser never has it. */
function keepTrackApiRoot(): string {
  return `${localApiBase()}/api/keeptrack`;
}

const UNAVAILABLE_RECHECK_MS = 60_000;
let availability: { at: number; ok: boolean } | null = null;
let availabilityCheck: Promise<boolean> | null = null;

/** True when the server has a KeepTrack key (add one in the Keys menu). A "no" is asked again after a minute. */
export function keepTrackAvailable(): Promise<boolean> {
  if (availability && (availability.ok || Date.now() - availability.at < UNAVAILABLE_RECHECK_MS)) {
    return Promise.resolve(availability.ok);
  }
  availabilityCheck ??= fetch(`${keepTrackApiRoot()}/status`, { signal: AbortSignal.timeout(5000) })
    .then((res) => (res.ok ? (res.json() as Promise<{ available?: boolean }>) : null))
    .then((body) => body?.available === true)
    .catch(() => false)
    .then((ok) => {
      availability = { at: Date.now(), ok };
      availabilityCheck = null;
      return ok;
    });
  return availabilityCheck;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** Longest Retry-After worth waiting for inside one pull; a longer one ends the pull (the cached catalog stays). */
const MAX_RETRY_AFTER_MS = 10_000;

async function fetchKeepTrackWithRetry(url: string, maxAttempts = 4): Promise<Response | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      // The server passes KeepTrack's 429/5xx through with its Retry-After and does not hold retries back itself.
      const raw = res.headers.get("retry-after")?.trim();
      const retryAfterMs = raw ? Number(raw) * 1000 : NaN;
      if (Number.isFinite(retryAfterMs) && retryAfterMs > MAX_RETRY_AFTER_MS) return res;
      if (res.status !== 429 && res.status < 500) return res; // a 404 or a refusal will not change on a retry
      if (res.status === 429 && attempt < maxAttempts) {
        await sleep(Number.isFinite(retryAfterMs) ? retryAfterMs : 1200 * 2 ** (attempt - 1));
        continue;
      }
      if (attempt < maxAttempts) {
        await sleep(400 * attempt);
        continue;
      }
      return res;
    } catch {
      if (attempt < maxAttempts) await sleep(400 * attempt);
    }
  }
  return null;
}

const FALLBACK_NORAD_IDS = [
  25544, 48274, 49044, 54216, 64786, 66174, 66664, 68319, 68689, 68837,
  20580, 20959, 24876, 25994, 27386, 27663, 28474, 29601, 32260, 33591,
  37849, 40069, 40482, 41328, 43226, 44713,
  36086, 53239, 66052, 66515, 66906, 67683, 67684, 67685, 67686, 67687
];

function mergeIntoMap(byNorad: Map<number, Satellite>, items: Satellite[]): void {
  for (const sat of items) {
    byNorad.set(sat.noradId, sat);
    if (byNorad.size >= MAX_KEEPTRACK_SATELLITES) break;
  }
}

/**
 * Sequential KeepTrack pulls (mirror → brief → full → NORAD seeds) with spacing to reduce 429s,
 * then merges by NORAD. Use for both KeepTrack mode and as a CelesTrak supplement.
 */
export async function fetchKeepTrackMergedCatalog(): Promise<Satellite[]> {
  const root = keepTrackApiRoot();
  const byNorad = new Map<number, Satellite>();

  const tryEndpoint = async (path: string): Promise<void> => {
    const res = await fetchKeepTrackWithRetry(`${root}${path}`);
    if (!res?.ok) return;
    const payload = (await res.json()) as unknown;
    mergeIntoMap(byNorad, normalizeBulkSatellites(payload));
  };

  await tryEndpoint("/v4/sats/celestrak");
  if (byNorad.size < MAX_KEEPTRACK_SATELLITES) {
    await sleep(STAGGER_MS);
    await tryEndpoint("/v4/sats/brief");
  }
  if (byNorad.size < MAX_KEEPTRACK_SATELLITES) {
    await sleep(STAGGER_MS);
    await tryEndpoint("/v4/sats");
  }

  if (byNorad.size < MAX_KEEPTRACK_SATELLITES) {
    const singles: Satellite[] = [];
    let i = 0;
    for (const noradSeed of FALLBACK_NORAD_IDS) {
      if (byNorad.size >= MAX_KEEPTRACK_SATELLITES) break;
      if (i > 0 && i % NORAD_BATCH === 0) await sleep(200);
      i++;
      try {
        const res = await fetchKeepTrackWithRetry(`${root}/v4/sat/${noradSeed}`, 2);
        if (!res?.ok) continue;
        const data = (await res.json()) as KeepTrackSatResponse;
        const noradId =
          typeof data.NORAD_CAT_ID === "number"
            ? data.NORAD_CAT_ID
            : Number.parseInt(String(data.NORAD_CAT_ID ?? ""), 10);
        if (!data.NAME || Number.isNaN(noradId) || !data.TLE_LINE_1 || !data.TLE_LINE_2) continue;
        singles.push({
          name: data.NAME,
          noradId,
          tle1: data.TLE_LINE_1,
          tle2: data.TLE_LINE_2,
          operator: null,
          operatorCountry: data.COUNTRY ?? null,
          purpose: data.PURPOSE ?? null
        } satisfies Satellite);
      } catch {
        /* next */
      }
    }
    mergeIntoMap(byNorad, singles);
  }

  return Array.from(byNorad.values());
}

export async function fetchKeepTrackCelestrakMirrorSatellites(): Promise<Satellite[]> {
  const root = keepTrackApiRoot();
  try {
    const res = await fetchKeepTrackWithRetry(`${root}/v4/sats/celestrak`);
    if (!res?.ok) return [];
    const payload = (await res.json()) as unknown;
    return normalizeBulkSatellites(payload);
  } catch {
    return [];
  }
}

function unwrapBulkPayload(parsed: unknown): unknown[] {
  if (parsed == null) return [];
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    for (const k of ["data", "sats", "satellites", "results", "payload"]) {
      const v = o[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

function noradFromTleLine1(tle1: string): number | null {
  if (!tle1.startsWith("1 ")) return null;
  return parseCatalogId(tle1.slice(2, 7));
}

/** KeepTrack `/v4/sats/*` bulk JSON shape has drifted; accept common wrappers and field casings. */
function normalizeBulkSatellites(parsed: unknown): Satellite[] {
  const rows = unwrapBulkPayload(parsed);
  if (
    rows.length > 2 &&
    typeof rows[0] === "string" &&
    typeof rows[1] === "string" &&
    typeof rows[2] === "string"
  ) {
    const fromLines = normalizeBulkFromStringLines(rows);
    if (fromLines.length > 0) return fromLines;
  }

  const satellites: Satellite[] = [];
  const seen = new Set<number>();

  for (const entry of rows) {
    const sat = coerceBulkRowToSatellite(entry, seen);
    if (!sat) continue;
    satellites.push(sat);
    if (satellites.length >= MAX_KEEPTRACK_SATELLITES) break;
  }

  return satellites;
}

function normalizeBulkFromStringLines(rows: unknown[]): Satellite[] {
  const lines = rows
    .filter((r): r is string => typeof r === "string")
    .map((s) => s.trimEnd().trim())
    .filter((s) => s.length > 0);
  const satellites: Satellite[] = [];
  const seen = new Set<number>();

  let i = 0;
  while (i + 2 < lines.length) {
    const name = lines[i];
    const tle1 = lines[i + 1];
    const tle2 = lines[i + 2];
    if (!tle1.startsWith("1 ") || !tle2.startsWith("2 ")) {
      i += 1;
      continue;
    }
    const noradId = noradFromTleLine1(tle1);
    if (noradId == null || !name || seen.has(noradId)) {
      i += 3;
      continue;
    }
    seen.add(noradId);
    satellites.push({
      name,
      noradId,
      tle1,
      tle2,
      operator: null,
      operatorCountry: null,
      purpose: null
    });
    if (satellites.length >= MAX_KEEPTRACK_SATELLITES) break;
    i += 3;
  }

  return satellites;
}

function coerceBulkRowToSatellite(entry: unknown, seen: Set<number>): Satellite | null {
  if (entry == null) return null;

  if (Array.isArray(entry)) {
    if (entry.length >= 4) {
      const rawN = entry[0];
      const noradId =
        typeof rawN === "number" ? rawN : Number.parseInt(String(rawN ?? ""), 10);
      const name = String(entry[1] ?? "").trim();
      const tle1 = String(entry[2] ?? "");
      const tle2 = String(entry[3] ?? "");
      if (!name || Number.isNaN(noradId) || !tle1.startsWith("1 ") || !tle2.startsWith("2 ") || seen.has(noradId)) {
        return null;
      }
      seen.add(noradId);
      return {
        name,
        noradId,
        tle1,
        tle2,
        operator: null,
        operatorCountry: null,
        purpose: null
      };
    }
    if (entry.length >= 3) {
      const name = String(entry[0] ?? "").trim();
      const tle1 = String(entry[1] ?? "");
      const tle2 = String(entry[2] ?? "");
      const noradId = noradFromTleLine1(tle1);
      if (!name || noradId == null || !tle1.startsWith("1 ") || !tle2.startsWith("2 ") || seen.has(noradId)) {
        return null;
      }
      seen.add(noradId);
      return {
        name,
        noradId,
        tle1,
        tle2,
        operator: null,
        operatorCountry: null,
        purpose: null
      };
    }
    return null;
  }

  if (typeof entry !== "object") return null;
  const item = entry as KeepTrackBulkSat & Record<string, unknown>;

  const name =
    pickString(item as Record<string, unknown>, [
      "NAME",
      "name",
      "Name",
      "OBJECT_NAME",
      "objectName",
      "satelliteName",
      "SatelliteName"
    ]) ?? "";
  const tle1 =
    pickString(item as Record<string, unknown>, [
      "TLE_LINE_1",
      "tle1",
      "tle_line_1",
      "tleLine1",
      "line1",
      "LINE1",
      "TLE1"
    ]) ?? "";
  const tle2 =
    pickString(item as Record<string, unknown>, [
      "TLE_LINE_2",
      "tle2",
      "tle_line_2",
      "tleLine2",
      "line2",
      "LINE2",
      "TLE2"
    ]) ?? "";

  const rawNorad =
    item.noradId ??
    item.NORAD_CAT_ID ??
    item.norad_cat_id ??
    (item as Record<string, unknown>).catalogId ??
    (item as Record<string, unknown>).NORAD_ID;
  let noradId =
    typeof rawNorad === "number" ? rawNorad : Number.parseInt(String(rawNorad ?? ""), 10);
  if (Number.isNaN(noradId)) {
    const fromTle = noradFromTleLine1(tle1);
    if (fromTle == null) return null;
    noradId = fromTle;
  }

  if (!name || !tle1 || !tle2 || seen.has(noradId)) return null;
  if (!tle1.startsWith("1 ") || !tle2.startsWith("2 ")) return null;
  seen.add(noradId);

  const country = pickString(item as Record<string, unknown>, ["country", "COUNTRY", "Country"]);
  const purpose = pickString(item as Record<string, unknown>, ["purpose", "PURPOSE", "Purpose"]);

  return {
    name,
    noradId,
    tle1,
    tle2,
    operator: null,
    operatorCountry: country,
    purpose: purpose
  };
}
