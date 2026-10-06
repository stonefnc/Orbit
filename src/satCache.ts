import type { Satellite } from "./providers/celestrak";

export type SatSource = "keeptrack" | "celestrak";

type Entry = { savedAt: number; satellites: Satellite[] };

const DB_NAME = "orbit-cache";
const STORE = "kv";
const SOURCES: SatSource[] = ["keeptrack", "celestrak"];

/** Synchronous source of truth for the rest of the app; IndexedDB only persists it across reloads. */
const mem = new Map<SatSource, Entry>();

function openDb(): Promise<IDBDatabase | null> {
  try {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * Loads persisted catalogs into memory. Also clears the old `localStorage` cache: it stored each
 * catalog several times over and exceeded the ~5 MB quota, so writes were silently failing.
 */
export async function hydrateSatCache(): Promise<void> {
  try {
    localStorage.removeItem("orbit_satellite_cache_v3");
  } catch {
    /* ignore */
  }
  const db = await openDb();
  if (!db) return;
  await Promise.all(
    SOURCES.map(
      (src) =>
        new Promise<void>((resolve) => {
          try {
            const rq = db.transaction(STORE, "readonly").objectStore(STORE).get(src);
            rq.onsuccess = () => {
              const v = rq.result as Entry | undefined;
              if (v && Array.isArray(v.satellites) && typeof v.savedAt === "number") mem.set(src, v);
              resolve();
            };
            rq.onerror = () => resolve();
          } catch {
            resolve();
          }
        })
    )
  );
  db.close();
}

export function getSatCache(source: SatSource): Satellite[] | null {
  const e = mem.get(source);
  return e && e.satellites.length > 0 ? e.satellites : null;
}

export function satCacheAgeMs(source: SatSource): number {
  const e = mem.get(source);
  return e ? Date.now() - e.savedAt : Number.POSITIVE_INFINITY;
}

export function putSatCache(source: SatSource, satellites: Satellite[]): void {
  const entry: Entry = { savedAt: Date.now(), satellites };
  mem.set(source, entry);
  void openDb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry, source);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    } catch {
      db.close();
    }
  });
}
