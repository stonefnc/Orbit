import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_ROOT } from "./paths";

/**
 * A disk-backed cache of OpenStreetMap features fetched from Overpass one 1°x1° tile at a time. Used by the ALPR and
 * data-center layers so a view many degrees wide can be served from tiles other viewers already loaded.
 *
 * Tiles are fetched in the background, one at a time with fair-use spacing, retrying the main public server twice and
 * then mirrors; a stale tile keeps being served while its refresh runs. Data © OpenStreetMap contributors (ODbL).
 */
type Tile<T> = { at: number; items: T[] };

const SPACING_MS = 1_200;
const FETCH_TIMEOUT_MS = 50_000;
const MIRROR_TIMEOUT_MS = 20_000;
const RETRY_AFTER_FAIL_MS = 45_000;
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

export type TileStoreOptions<T> = {
  /** Folder name under .cache (change it to invalidate old tiles when the stored shape changes). */
  dir: string;
  ttlMs: number;
  /** The Overpass QL for a tile; must end up returning `elements`. */
  query: (south: number, west: number, north: number, east: number) => string;
  /** Turns Overpass elements into the items to keep. */
  parse: (elements: unknown[]) => T[];
};

export type TileStore<T> = {
  /** Cached items for one tile (null if none yet), whether they are fresh, and whether the last fetch failed. */
  read(lat: number, lon: number): Promise<{ items: T[] | null; fresh: boolean; failed: boolean }>;
};

async function overpass(query: string): Promise<unknown[]> {
  let lastErr: unknown;
  // The main public server sheds load now and then: try it twice, then the mirrors with shorter patience.
  const attempts = [ENDPOINTS[0]!, ENDPOINTS[0]!, ...ENDPOINTS.slice(1)];
  for (let i = 0; i < attempts.length; i++) {
    try {
      if (i === 1) await new Promise((r) => setTimeout(r, 2_500));
      const res = await fetch(attempts[i]!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit)"
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(i < 2 ? FETCH_TIMEOUT_MS : MIRROR_TIMEOUT_MS)
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      return ((await res.json()) as { elements?: unknown[] }).elements ?? [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Overpass unavailable");
}

export function createTileStore<T>(opts: TileStoreOptions<T>): TileStore<T> {
  const cacheDir = join(CACHE_ROOT, opts.dir);
  const tiles = new Map<string, Tile<T>>();
  const failedAt = new Map<string, number>();
  const queued = new Set<string>();
  const order: string[] = [];
  const diskChecked = new Set<string>();
  let running = false;

  const key = (lat: number, lon: number): string => `${lat}_${lon}`;

  async function worker(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (order.length) {
        const k = order.shift()!;
        queued.delete(k);
        const [lat, lon] = k.split("_").map(Number) as [number, number];
        try {
          const items = opts.parse(await overpass(opts.query(lat, lon, lat + 1, lon + 1)));
          const tile: Tile<T> = { at: Date.now(), items };
          tiles.set(k, tile);
          failedAt.delete(k);
          await mkdir(cacheDir, { recursive: true });
          await writeFile(join(cacheDir, `${k}.json`), JSON.stringify(tile), "utf8");
        } catch (e) {
          failedAt.set(k, Date.now());
          console.warn(`[${opts.dir}] tile ${k} failed:`, e instanceof Error ? e.message : e);
        }
        await new Promise((r) => setTimeout(r, SPACING_MS));
      }
    } finally {
      running = false;
    }
  }

  function enqueue(k: string): void {
    if (queued.has(k)) return;
    const f = failedAt.get(k);
    if (f && Date.now() - f < RETRY_AFTER_FAIL_MS) return;
    queued.add(k);
    order.push(k);
    void worker();
  }

  return {
    async read(lat, lon) {
      const k = key(lat, lon);
      let t = tiles.get(k);
      if (!t && !diskChecked.has(k)) {
        diskChecked.add(k);
        try {
          const d = JSON.parse(await readFile(join(cacheDir, `${k}.json`), "utf8")) as Tile<T>;
          if (Array.isArray(d.items) && typeof d.at === "number") tiles.set(k, (t = d));
        } catch {
          /* not on disk */
        }
      }
      const fresh = !!t && Date.now() - t.at < opts.ttlMs;
      const recentlyFailed = !fresh && failedAt.has(k) && Date.now() - failedAt.get(k)! < RETRY_AFTER_FAIL_MS;
      if (!fresh && !recentlyFailed) enqueue(k);
      return { items: t?.items ?? null, fresh, failed: recentlyFailed };
    }
  };
}

export type TileCollection<T> = { items: T[]; total: number; pending: number; failed: number };

/** Gathers the items of every tile a box touches. Returns "too-wide" when it would need more than `maxTiles`. */
export async function collectTiles<T>(
  store: TileStore<T>,
  west: number,
  south: number,
  east: number,
  north: number,
  maxTiles: number
): Promise<TileCollection<T> | "too-wide"> {
  const lat0 = Math.floor(Math.max(-90, south));
  const lat1 = Math.floor(Math.min(89.999, north));
  const lonSpan = west <= east ? east - west : 360 - (west - east);
  const lon0 = Math.floor(west);
  const nLon = Math.floor(lonSpan) + 1;
  if ((lat1 - lat0 + 1) * nLon > maxTiles) return "too-wide";

  const items: T[] = [];
  let total = 0;
  let pending = 0;
  let failed = 0;
  for (let la = lat0; la <= lat1; la++) {
    for (let i = 0; i < nLon; i++) {
      let lo = lon0 + i;
      if (lo >= 180) lo -= 360;
      total++;
      const r = await store.read(la, lo);
      if (r.items) for (const it of r.items) items.push(it);
      if (!r.items && !r.failed) pending++;
      else if (!r.items && r.failed) failed++;
    }
  }
  return { items, total, pending, failed };
}
