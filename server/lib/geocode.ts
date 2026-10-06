import { fetchJson, ProviderHttpError } from "./fetchUtil";
import { cooldownRemainingMs, recordFailure, recordSuccess } from "./providerGate";

export type PlaceHit = { lat: number; lon: number; label: string };

const UA = "Orbit/1.0 (personal; +https://github.com/runna5k/Orbit; port-destination lookup)";
const DAY = 24 * 60 * 60_000;

type Entry = { at: number; ttl: number; value: PlaceHit | null };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<PlaceHit | null>>();

/** Nominatim's usage policy allows 1 request/second; slots are reserved synchronously so bursts can't happen. */
let nextSlot = 0;
async function spaced(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1_100;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

type NominatimRow = { lat?: string; lon?: string; display_name?: string; name?: string };

async function lookup(q: string): Promise<PlaceHit | null> {
  if (cooldownRemainingMs("nominatim") > 0) throw new Error("nominatim cooling down");
  await spaced();
  try {
    // featureType=settlement keeps results to towns/cities (ports are settlements) instead of random POIs.
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&featureType=settlement`;
    const { ok, status, data, retryAfterSec } = await fetchJson<NominatimRow[]>(url, {
      timeoutMs: 12_000,
      retries: 0,
      headers: { "User-Agent": UA, Accept: "application/json" }
    });
    if (!ok) throw new ProviderHttpError("nominatim", status, retryAfterSec);
    recordSuccess("nominatim");
    const row = data?.[0];
    const lat = Number(row?.lat);
    const lon = Number(row?.lon);
    if (!row || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const parts = (row.display_name ?? row.name ?? q).split(",").map((s) => s.trim());
    const label = [parts[0], parts[parts.length - 1]].filter((x, i, a) => x && a.indexOf(x) === i).join(", ");
    return { lat, lon, label };
  } catch (e) {
    recordFailure("nominatim", e);
    throw e;
  }
}

/** Resolves a place name to coordinates. null = nothing found; throws only on provider trouble. */
export async function geocodePlace(rawQuery: string): Promise<PlaceHit | null> {
  const q = rawQuery.trim().replace(/\s+/g, " ").slice(0, 60);
  if (q.length < 3) return null;
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = lookup(q)
    .then((value) => {
      cache.set(key, { at: Date.now(), ttl: value ? 7 * DAY : DAY, value });
      if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
