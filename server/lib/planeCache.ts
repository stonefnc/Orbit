import type { AggregatedAircraftResponse } from "../../shared/planeContract";

type CacheEntry = { at: number; payload: AggregatedAircraftResponse };

/** Within this window identical viewport requests are served without touching any provider. */
const FRESH_MS = 4_000;
/** If every provider fails, the last good payload is served for this long (marked stale by the caller). */
const STALE_MS = 90_000;
const MAX_ENTRIES = 48;

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<AggregatedAircraftResponse>>();

/** Snap the query center to ~0.1° (≈11 km) so panning and multiple tabs share cache entries. */
export function snapCenter(v: number): number {
  return Math.round(v * 10) / 10;
}

export function planeCacheKey(lat: number, lon: number, distNm: number): string {
  return `${lat.toFixed(1)}:${lon.toFixed(1)}:${Math.round(distNm / 10) * 10}`;
}

export function getFresh(key: string): AggregatedAircraftResponse | null {
  const e = store.get(key);
  return e && Date.now() - e.at <= FRESH_MS ? e.payload : null;
}

export function getStale(key: string): AggregatedAircraftResponse | null {
  const e = store.get(key);
  return e && Date.now() - e.at <= STALE_MS ? e.payload : null;
}

export function setCached(key: string, payload: AggregatedAircraftResponse): void {
  store.delete(key);
  store.set(key, { at: Date.now(), payload });
  const cutoff = Date.now() - STALE_MS;
  for (const [k, v] of store) {
    if (v.at < cutoff || store.size > MAX_ENTRIES) store.delete(k);
    else break;
  }
}

/** Concurrent requests for the same key share one upstream round trip. */
export function coalesce(
  key: string,
  factory: () => Promise<AggregatedAircraftResponse>
): Promise<AggregatedAircraftResponse> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = factory().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}
