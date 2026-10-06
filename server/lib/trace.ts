/**
 * Flight trace history for one aircraft: the day's recorded positions (since 00:00 UTC, so up to 24 hours) from the
 * adsb.lol community feeder network's public tar1090 history files. Keyless; cached for a minute per aircraft and
 * thinned to at most ~1,500 points so the browser can draw it quickly.
 */
export type TracePoint = [secondsSinceStart: number, lat: number, lon: number, altFt: number | null, gsKt: number | null];
export type Trace = { startUnix: number; points: TracePoint[]; total: number };

const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)" };
const MAX_POINTS = 1500;
const cache = new Map<string, { at: number; trace: Trace | null }>();

type Raw = { timestamp?: number; trace?: Array<[number, number, number, number | string | null, number | null, ...unknown[]]> };

export async function getTrace(hex: string): Promise<Trace | null> {
  if (!/^[0-9a-f]{6}$/.test(hex)) throw new Error("bad aircraft id");
  const hit = cache.get(hex);
  if (hit && Date.now() - hit.at < 60_000) return hit.trace;

  const url = `https://globe.adsb.lol/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) });
  if (res.status === 404) {
    cache.set(hex, { at: Date.now(), trace: null });
    return null;
  }
  if (!res.ok) throw new Error(`Trace history HTTP ${res.status}`);
  const raw = JSON.parse(await res.text()) as Raw;
  const rows = raw.trace ?? [];
  if (!rows.length || typeof raw.timestamp !== "number") {
    cache.set(hex, { at: Date.now(), trace: null });
    return null;
  }
  const stride = Math.max(1, Math.ceil(rows.length / MAX_POINTS));
  const points: TracePoint[] = [];
  rows.forEach((r, i) => {
    if (i % stride !== 0 && i !== rows.length - 1) return;
    const [t, lat, lon, alt, gs] = r;
    if (typeof lat !== "number" || typeof lon !== "number") return;
    points.push([
      Math.round(t),
      Math.round(lat * 1e5) / 1e5,
      Math.round(lon * 1e5) / 1e5,
      typeof alt === "number" ? alt : alt === "ground" ? 0 : null,
      typeof gs === "number" ? Math.round(gs) : null
    ]);
  });
  const trace: Trace = { startUnix: raw.timestamp, points, total: rows.length };
  cache.set(hex, { at: Date.now(), trace });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return trace;
}
