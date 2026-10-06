/**
 * Worldwide aircraft lookup by ICAO24 hex, callsign or registration from the community adsb.lol API (keyless), so the
 * search box can find a plane that isn't in the area currently on screen. Exact matches only; cached for 20 seconds.
 */
export type AircraftFound = {
  hex: string;
  callsign: string | null;
  registration: string | null;
  type: string | null;
  lat: number;
  lon: number;
  altFt: number | null;
};

const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)" };
const cache = new Map<string, { at: number; found: AircraftFound[] }>();

type Raw = { hex?: string; flight?: string; r?: string; t?: string; lat?: number; lon?: number; alt_baro?: number | string };

/** adsb.lol first; adsb.fi (same readsb API, different path names) when adsb.lol is busy or unreachable. */
async function call(kind: "hex" | "callsign" | "reg", value: string): Promise<Raw[]> {
  const hosts: Array<[string, string]> = [
    [`https://api.adsb.lol/v2/${kind === "reg" ? "registration" : kind}/${value}`, "adsb.lol"],
    [`https://opendata.adsb.fi/api/v2/${kind}/${value}`, "adsb.fi"]
  ];
  for (const [url] of hosts) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      return ((await res.json()) as { ac?: Raw[] }).ac ?? [];
    } catch {
      /* try the next host */
    }
  }
  return [];
}

export async function findAircraft(query: string): Promise<AircraftFound[]> {
  const q = query.trim().toUpperCase().replace(/\s+/g, "");
  if (q.length < 3 || q.length > 12 || !/^[A-Z0-9-]+$/.test(q)) return [];
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < 20_000) return hit.found;

  const rows: Raw[] = /^[0-9A-F]{6}$/.test(q)
    ? await call("hex", q.toLowerCase())
    : (await Promise.all([call("callsign", q), call("reg", q.replace(/-/g, ""))])).flat();

  const seen = new Set<string>();
  const found: AircraftFound[] = [];
  for (const r of rows) {
    if (!r.hex || typeof r.lat !== "number" || typeof r.lon !== "number" || seen.has(r.hex)) continue;
    seen.add(r.hex);
    found.push({
      hex: r.hex.toLowerCase(),
      callsign: r.flight?.trim() || null,
      registration: r.r ?? null,
      type: r.t ?? null,
      lat: r.lat,
      lon: r.lon,
      altFt: typeof r.alt_baro === "number" ? r.alt_baro : null
    });
    if (found.length >= 8) break;
  }
  cache.set(q, { at: Date.now(), found });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return found;
}
