/** CelesTrak GP groups merged client-side; cap avoids runaway memory if a group is huge. */
export const MAX_CELESTRAK_SATELLITES = 8000;

const GROUPS = [
  {
    group: "active",
    fallbackTxt: "active.txt",
    country: "Mixed",
    purpose: "Mixed active satellites"
  },
  {
    group: "starlink",
    fallbackTxt: "starlink.txt",
    country: "US",
    purpose: "Broadband communications"
  },
  {
    group: "oneweb",
    fallbackTxt: "oneweb.txt",
    country: "UK",
    purpose: "Broadband communications"
  },
  {
    group: "iridium-next",
    fallbackTxt: "iridium-next.txt",
    country: "US",
    purpose: "Communications"
  },
  {
    group: "stations",
    fallbackTxt: "stations.txt",
    country: "Mixed",
    purpose: "Crewed stations / support"
  },
  { group: "gnss", fallbackTxt: "gnss.txt", country: "Mixed", purpose: "Navigation (GNSS)" },
  { group: "geo", fallbackTxt: "geo.txt", country: "Mixed", purpose: "Geostationary" },
  { group: "weather", fallbackTxt: "weather.txt", country: "Mixed", purpose: "Weather / environmental" },
  { group: "science", fallbackTxt: "science.txt", country: "Mixed", purpose: "Science" },
  { group: "amateur", fallbackTxt: "amateur.txt", country: "Mixed", purpose: "Amateur radio" },
  {
    group: "earth-resources",
    fallbackTxt: "earth-resources.txt",
    country: "Mixed",
    purpose: "Earth resources / remote sensing"
  },
  {
    group: "other-comm",
    fallbackTxt: "other-comm.txt",
    country: "Mixed",
    purpose: "Communications"
  },
  { group: "visual", fallbackTxt: "visual.txt", country: "Mixed", purpose: "Visual / bright objects" },
  {
    group: "x-communication",
    fallbackTxt: "x-communication.txt",
    country: "Mixed",
    purpose: "Experimental communications"
  }
] as const;

export type Satellite = {
  name: string;
  noradId: number;
  tle1: string;
  tle2: string;
  operator: string | null;
  operatorCountry: string | null;
  purpose: string | null;
};

/**
 * CelesTrak does not allow browser `fetch` from arbitrary origins (no CORS). The app defaults to
 * same-origin `/celestrak-proxy` (Vite dev + preview, or your deploy reverse-proxy). Override with
 * `VITE_CELESTRAK_API_BASE` only when you intentionally relay through your own HTTPS origin.
 */
function celestrakBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_CELESTRAK_API_BASE as string | undefined;
  const trimmed = typeof fromEnv === "string" ? fromEnv.trim().replace(/\/$/, "") : "";
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  if (trimmed.length > 0) {
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return trimmed.startsWith("/") ? `${basePath}${trimmed}` : trimmed;
  }

  return `${basePath}/celestrak-proxy`;
}

async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/plain" },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.text();
  } catch (error) {
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchGroupTle(group: string, fallbackTxt: string): Promise<string> {
  const root = celestrakBaseUrl();
  const url = `${root}/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
  try {
    return await fetchWithTimeout(url);
  } catch {
    const txtUrl = `${root}/NORAD/elements/${fallbackTxt}`;
    return fetchWithTimeout(txtUrl);
  }
}

/** Alpha-5: past 99,999 the first digit becomes a letter (A=10 … Z=33, skipping I and O), e.g. "A0057" = 100057. */
const ALPHA5 = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function parseCatalogId(field: string): number | null {
  const t = field.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^([A-HJ-NP-Za-hj-np-z])(\d{4})$/.exec(t);
  return m ? (10 + ALPHA5.indexOf(m[1]!.toUpperCase())) * 10_000 + Number(m[2]) : null;
}

function parseTleText(rawText: string): Array<{ name: string; noradId: number; tle1: string; tle2: string }> {
  if (rawText.includes("GP data has not updated since your last successful")) {
    return [];
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const satellites: Array<{ name: string; noradId: number; tle1: string; tle2: string }> = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const tle1 = lines[i + 1];
    const tle2 = lines[i + 2];

    if (!tle1.startsWith("1 ") || !tle2.startsWith("2 ")) {
      continue;
    }

    const noradId = parseCatalogId(tle1.slice(2, 7));
    if (!name || noradId == null) {
      continue;
    }

    satellites.push({ name, noradId, tle1, tle2 });
  }
  return satellites;
}

/** `active` is one file covering Starlink, OneWeb, Iridium, GNSS, GEO, weather, science, stations… */
function classifyByName(name: string): { country: string; purpose: string } {
  const n = name.toUpperCase();
  if (n.startsWith("STARLINK")) return { country: "US", purpose: "Broadband communications" };
  if (n.startsWith("ONEWEB")) return { country: "UK", purpose: "Broadband communications" };
  if (n.startsWith("IRIDIUM")) return { country: "US", purpose: "Communications" };
  if (n.startsWith("GPS ") || n.startsWith("NAVSTAR")) return { country: "US", purpose: "Navigation (GNSS)" };
  if (n.startsWith("GALILEO")) return { country: "EU", purpose: "Navigation (GNSS)" };
  if (n.startsWith("BEIDOU")) return { country: "China", purpose: "Navigation (GNSS)" };
  if (n.startsWith("GLONASS")) return { country: "Russia", purpose: "Navigation (GNSS)" };
  if (n.startsWith("ISS ") || n.startsWith("CSS ") || n.includes("TIANHE")) {
    return { country: "Mixed", purpose: "Crewed stations / support" };
  }
  if (n.startsWith("NOAA") || n.startsWith("GOES") || n.startsWith("METOP") || n.startsWith("METEOSAT")) {
    return { country: "Mixed", purpose: "Weather / environmental" };
  }
  return { country: "Mixed", purpose: "Mixed active satellites" };
}

let catalogNote = "";

/** Non-empty when the catalog is degraded (fallback source or stale cache) so the UI can say so. */
export function getSatCatalogNote(): string {
  return catalogNote;
}

function withClassification(parsed: Array<{ name: string; noradId: number; tle1: string; tle2: string }>): Satellite[] {
  return parsed.map((sat) => {
    const c = classifyByName(sat.name);
    return { ...sat, operator: null, operatorCountry: c.country, purpose: c.purpose };
  });
}

export function localApiBase(): string {
  const fromEnv = import.meta.env.VITE_PLANE_API_BASE as string | undefined;
  return typeof fromEnv === "string" && fromEnv.trim() ? fromEnv.trim().replace(/\/$/, "") : "";
}

/** Preferred path: the local server owns the single shared CelesTrak fetch, 2 h cache and fallback chain. */
async function fetchActiveFromServer(): Promise<Satellite[]> {
  const res = await fetch(`${localApiBase()}/api/tle/active`, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`TLE API HTTP ${res.status}`);
  const source = res.headers.get("x-tle-source");
  const stale = res.headers.get("x-tle-stale") === "1";
  const ageDays = res.headers.get("x-tle-age-days") ?? "?";
  const parsed = parseTleText(await res.text());
  if (parsed.length === 0) throw new Error("TLE API returned no element sets");
  catalogNote =
    source === "keeptrack"
      ? `CelesTrak unreachable — using KeepTrack catalog (${parsed.length})`
      : source === "satnogs+cache"
        ? `providers unreachable — ${ageDays}-day-old full catalog + fresh SatNOGS updates`
        : source === "satnogs"
          ? `degraded: only ${parsed.length} SatNOGS-tracked objects (no full catalog cached yet)`
          : stale
            ? `cached catalog is ${ageDays} days old`
            : "";
  return withClassification(parsed);
}

export async function fetchActiveSatellites(): Promise<Satellite[]> {
  try {
    return await fetchActiveFromServer();
  } catch (e) {
    console.warn("[satellites] local TLE API unavailable, trying direct CelesTrak:", e);
  }
  catalogNote = "";
  try {
    const parsed = parseTleText(await fetchGroupTle("active", "active.txt"));
    if (parsed.length > 0) return withClassification(parsed);
  } catch {
    // `active` unavailable — fall back to the individual groups below.
  }
  return fetchSatellitesByGroups();
}

/** Fallback path: several smaller groups, one request each. Only used if `active` fails. */
async function fetchSatellitesByGroups(): Promise<Satellite[]> {
  const byNorad = new Map<number, Satellite>();
  let successCount = 0;

  for (const { group, fallbackTxt, country, purpose } of GROUPS.filter((g) => g.group !== "active")) {
    try {
      const text = await fetchGroupTle(group, fallbackTxt);
      const parsed = parseTleText(text);
      for (const sat of parsed) {
        byNorad.set(sat.noradId, {
          ...sat,
          operator: null,
          operatorCountry: country,
          purpose
        });
      }

      successCount += 1;
      if (byNorad.size >= MAX_CELESTRAK_SATELLITES) {
        break;
      }
    } catch {
      // Continue to next group.
    }
  }

  const satellites = Array.from(byNorad.values());
  if (successCount === 0 || satellites.length === 0) {
    throw new Error("No satellites loaded from CelesTrak feeds.");
  }

  return satellites;
}
