import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_ROOT } from "./paths";

/**
 * Submarine telecom cables and landing points from TeleGeography's Submarine Cable Map public data
 * (https://www.submarinecablemap.com, CC BY-SA 4.0). Cached on disk for 14 days; per-cable details (owners, length,
 * ready-for-service year) are fetched on demand and cached in memory.
 */
const CACHE_DIR = join(CACHE_ROOT, "cables");
const TTL_MS = 14 * 24 * 3_600_000;
const BASE = "https://www.submarinecablemap.com/api/v3";
const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)" };

type Geo = { type: "FeatureCollection"; features: unknown[] };

const mem = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, url: string, ttl: number, disk: boolean): Promise<T> {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = (async () => {
    const file = join(CACHE_DIR, `${key}.json`);
    if (disk) {
      try {
        const c = JSON.parse(await readFile(file, "utf8")) as { at: number; value: T };
        if (Date.now() - c.at < ttl) {
          mem.set(key, c);
          return c.value;
        }
      } catch {
        /* not cached */
      }
    }
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(40_000) });
    if (!res.ok) throw new Error(`Submarine Cable Map HTTP ${res.status}`);
    const value = JSON.parse(await res.text()) as T;
    const entry = { at: Date.now(), value };
    mem.set(key, entry);
    if (disk) {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, JSON.stringify(entry), "utf8");
    }
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const getCableGeo = (): Promise<Geo> => cached<Geo>("cable-geo", `${BASE}/cable/cable-geo.json`, TTL_MS, true);
export const getLandingGeo = (): Promise<Geo> =>
  cached<Geo>("landing-geo", `${BASE}/landing-point/landing-point-geo.json`, TTL_MS, true);

export function getCableDetail(id: string): Promise<unknown> {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return Promise.reject(new Error("bad cable id"));
  return cached<unknown>(`cable-${id}`, `${BASE}/cable/${id}.json`, TTL_MS, false);
}
