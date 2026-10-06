import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Bounds, CctvCamera, CctvCameraPublic, CctvSource } from "./types";
import { iteris511Sources } from "./sources/iteris511";
import { caltransSource } from "./sources/caltrans";
import { tflSource } from "./sources/tfl";
import { driveBcSource } from "./sources/drivebc";
import { austinSource } from "./sources/austin";
import { fintrafficSource } from "./sources/fintraffic";
import { calgarySource } from "./sources/calgary";
import { hongKongSource } from "./sources/hongkong";
import { newZealandSource } from "./sources/newzealand";
import { CACHE_ROOT } from "../lib/paths";

export const CCTV_SOURCES: CctvSource[] = [
  ...iteris511Sources,
  caltransSource,
  tflSource,
  driveBcSource,
  austinSource,
  fintrafficSource,
  calgarySource,
  hongKongSource,
  newZealandSource
];

type State = {
  cameras: CctvCamera[];
  loadedAt: number;
  loading: Promise<void> | null;
  error: string | null;
  lastTriedAt: number;
};

const CACHE_DIR = join(CACHE_ROOT, "cctv");
const RETRY_AFTER_FAILURE_MS = 60_000;
/** Bump when the stored camera shape gains fields, so old disk caches are discarded. */
const CACHE_VERSION = 4; // 4: cameras no longer carry proxiedVideo (the Georgia video proxy is gone)

const states = new Map<string, State>();
const byId = new Map<string, CctvCamera>();
const sourceById = new Map(CCTV_SOURCES.map((s) => [s.id, s]));

function state(id: string): State {
  let s = states.get(id);
  if (!s) {
    s = { cameras: [], loadedAt: 0, loading: null, error: null, lastTriedAt: 0 };
    states.set(id, s);
  }
  return s;
}

function install(src: CctvSource, cameras: CctvCamera[], loadedAt: number): void {
  const st = state(src.id);
  for (const old of st.cameras) byId.delete(old.id);
  st.cameras = cameras;
  st.loadedAt = loadedAt;
  st.error = null;
  for (const c of cameras) byId.set(c.id, c);
}

async function readDisk(src: CctvSource): Promise<{ cameras: CctvCamera[]; loadedAt: number } | null> {
  try {
    const parsed = JSON.parse(await readFile(join(CACHE_DIR, `${src.id}.json`), "utf8")) as {
      version?: number;
      cameras?: CctvCamera[];
      loadedAt?: number;
    };
    // Older cache files predate fields such as video URLs; ignore them so the source is reloaded.
    if (parsed.version !== CACHE_VERSION) return null;
    if (!Array.isArray(parsed.cameras) || typeof parsed.loadedAt !== "number") return null;
    return { cameras: parsed.cameras, loadedAt: parsed.loadedAt };
  } catch {
    return null;
  }
}

async function writeDisk(src: CctvSource, cameras: CctvCamera[], loadedAt: number): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, `${src.id}.json`), JSON.stringify({ version: CACHE_VERSION, loadedAt, cameras }), "utf8");
  } catch (e) {
    console.warn(`[cctv] could not write disk cache for ${src.id}:`, e instanceof Error ? e.message : e);
  }
}

function ensureSource(src: CctvSource): Promise<void> {
  const st = state(src.id);
  if (st.loading) return st.loading;
  const age = Date.now() - st.loadedAt;
  if (st.cameras.length > 0 && age < src.ttlMs) return Promise.resolve();
  if (st.error && Date.now() - st.lastTriedAt < RETRY_AFTER_FAILURE_MS) return Promise.resolve();

  st.loading = (async () => {
    try {
      if (st.cameras.length === 0) {
        const disk = await readDisk(src);
        if (disk && Date.now() - disk.loadedAt < src.ttlMs) {
          install(src, disk.cameras, disk.loadedAt);
          console.info(`[cctv] ${src.id}: ${disk.cameras.length} cameras from disk cache`);
          return;
        }
      }
      const t0 = Date.now();
      const cameras = await src.load();
      if (cameras.length === 0) throw new Error("source returned 0 usable cameras");
      const loadedAt = Date.now();
      install(src, cameras, loadedAt);
      console.info(`[cctv] ${src.id}: ${cameras.length} cameras loaded in ${loadedAt - t0} ms`);
      await writeDisk(src, cameras, loadedAt);
    } catch (e) {
      st.error = e instanceof Error ? e.message : String(e);
      console.warn(`[cctv] ${src.id} load failed (keeping ${st.cameras.length} cached):`, st.error);
    } finally {
      st.lastTriedAt = Date.now();
      st.loading = null;
    }
  })();
  return st.loading;
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Splits an antimeridian-crossing request (west > east) into plain ranges. */
function splitBounds(b: Bounds): Bounds[] {
  return b[0] <= b[2]
    ? [b]
    : [
        [b[0], b[1], 180, b[3]],
        [-180, b[1], b[2], b[3]]
      ];
}

export function toPublic(c: CctvCamera): CctvCameraPublic {
  const src = sourceById.get(c.source);
  const { frameUrl: _f, ...rest } = c;
  return {
    ...rest,
    frame: `/api/cctv/frame/${encodeURIComponent(c.id)}`,
    attribution: src?.attribution ?? c.agency,
    license: src?.license ?? ""
  };
}

export function getCamera(id: string): CctvCamera | undefined {
  return byId.get(id);
}

export function getSourceForCamera(c: CctvCamera): CctvSource | undefined {
  return sourceById.get(c.source);
}

export type QueryResult = {
  cameras: CctvCameraPublic[];
  total: number;
  truncated: boolean;
  loading: string[];
};

/**
 * Cameras inside `bounds` (or everywhere when null). Only sources whose coverage touches the
 * request are loaded; the call waits for those (bounded) so the first view isn't empty.
 */
export async function queryCameras(
  bounds: Bounds | null,
  limit: number,
  text: string,
  waitMs = 30_000
): Promise<QueryResult> {
  const ranges = bounds ? splitBounds(bounds) : null;
  const relevant = CCTV_SOURCES.filter(
    (s) => !ranges || s.coverage.some((cov) => ranges.some((r) => boundsIntersect(cov, r)))
  );

  const loads = relevant.map((s) => ensureSource(s));
  await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, waitMs))]);

  const center: [number, number] | null = bounds
    ? [
        bounds[0] <= bounds[2] ? (bounds[0] + bounds[2]) / 2 : ((bounds[0] + bounds[2] + 360) / 2 + 180) % 360 - 180,
        (bounds[1] + bounds[3]) / 2
      ]
    : null;
  const q = text.trim().toLowerCase();

  const hits: Array<{ c: CctvCamera; d: number }> = [];
  for (const s of relevant) {
    for (const c of state(s.id).cameras) {
      if (ranges && !ranges.some((r) => c.lon >= r[0] && c.lon <= r[2] && c.lat >= r[1] && c.lat <= r[3])) continue;
      if (q) {
        const hay = `${c.name} ${c.roadway ?? ""} ${c.city ?? ""} ${c.region ?? ""} ${c.agency}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const d = center ? (c.lon - center[0]) ** 2 + (c.lat - center[1]) ** 2 : 0;
      hits.push({ c, d });
    }
  }
  hits.sort((a, b) => a.d - b.d);
  const picked = hits.slice(0, limit).map((h) => toPublic(h.c));
  return {
    cameras: picked,
    total: hits.length,
    truncated: hits.length > limit,
    loading: CCTV_SOURCES.filter((s) => state(s.id).loading !== null).map((s) => s.id)
  };
}

export function describeSources(): Array<{
  id: string;
  label: string;
  agency: string;
  country: string;
  count: number;
  loadedAt: number | null;
  loading: boolean;
  error: string | null;
  coverage: Bounds[];
  attribution: string;
  license: string;
}> {
  return CCTV_SOURCES.map((s) => {
    const st = state(s.id);
    return {
      id: s.id,
      label: s.label,
      agency: s.agency,
      country: s.country,
      count: st.cameras.length,
      loadedAt: st.loadedAt || null,
      loading: st.loading !== null,
      error: st.error,
      coverage: s.coverage,
      attribution: s.attribution,
      license: s.license
    };
  });
}
