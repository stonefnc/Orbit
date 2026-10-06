import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Router } from "express";
import { fetchText, ProviderHttpError } from "./lib/fetchUtil";
import { CCTV_UA } from "./cctv/sources/http";
import { keepTrackKey } from "./routes/keeptrack";
import { CACHE_ROOT } from "./lib/paths";

/**
 * Satellite element sets, served from one shared cache.
 *
 * Tiers, tried in order whenever a refresh is due:
 *   1. CelesTrak `active` group (~12k satellites)           — the canonical source
 *   2. KeepTrack `brief` catalog, payloads only (needs your KeepTrack key; server-side)
 *   3. SatNOGS DB (~1.7k objects), merged OVER the last known full catalog so the full scope survives
 * The last good catalog is remembered on disk for 30 days and served immediately (while a refresh runs in
 * the background) so the layer never goes empty because one provider is down or has blocked you.
 */

/** CelesTrak republishes element sets about every 2 h and blocks clients that poll faster. */
const FRESH_MS = 2 * 60 * 60_000;
const STALE_OK_MS = 30 * 24 * 60 * 60_000;
const RETRY_AFTER_FAILURE_MS = 30 * 60_000;
const RETRY_AFTER_THROTTLE_MS = 2 * 60 * 60_000;
/** Below this a catalog is a partial/fallback list, not a usable base to merge fallbacks onto. */
const FULL_CATALOG_MIN = 5_000;
const KEEPTRACK_MAX_SATS = 16_000;
const KEEPTRACK_MAX_EPOCH_AGE_DAYS = 30;
const CACHE_FILE = join(CACHE_ROOT, "tle", "active.json");

export type TleSource = "celestrak" | "keeptrack" | "satnogs" | "satnogs+cache";
type Entry = { text: string; at: number; checkedAt: number; source: TleSource; count: number };

let mem: Entry | null = null;
let diskChecked = false;
let inflight: Promise<Entry> | null = null;
const blockedUntil: Record<"celestrak" | "keeptrack", number> = { celestrak: 0, keeptrack: 0 };
const lastError: Record<"celestrak" | "keeptrack", string | null> = { celestrak: null, keeptrack: null };

type Block = { name: string; l1: string; l2: string; epochMs: number };

/** Alpha-5: past 99,999 the first digit becomes a letter (A=10 … Z=33, skipping I and O), e.g. "A0057" = 100057. */
const ALPHA5 = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function noradOf(l1: string): number | null {
  const t = l1.slice(2, 7).trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^([A-HJ-NP-Za-hj-np-z])(\d{4})$/.exec(t);
  return m ? (10 + ALPHA5.indexOf(m[1]!.toUpperCase())) * 10_000 + Number(m[2]) : null;
}

function epochMsOf(l1: string): number {
  const yy = Number(l1.slice(18, 20));
  const day = Number(l1.slice(20, 32));
  if (!Number.isFinite(yy) || !Number.isFinite(day)) return 0;
  return Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (day - 1) * 86_400_000;
}

function parseBlocks(text: string): Map<number, Block> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out = new Map<number, Block>();
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const l1 = lines[i + 1]!;
    const l2 = lines[i + 2]!;
    if (!l1.startsWith("1 ") || !l2.startsWith("2 ")) continue;
    const id = noradOf(l1);
    if (id == null) continue;
    out.set(id, { name: lines[i]!.trim(), l1, l2, epochMs: epochMsOf(l1) });
  }
  return out;
}

function blocksToText(blocks: Iterable<Block>): string {
  const parts: string[] = [];
  for (const b of blocks) parts.push(`${b.name}\n${b.l1}\n${b.l2}`);
  return parts.length ? parts.join("\n") + "\n" : "";
}

/** `overlay` entries replace `base` entries only when their element set is at least as new. */
export function mergeOverlay(baseText: string, overlayText: string): { text: string; count: number; replaced: number } {
  const base = parseBlocks(baseText);
  let replaced = 0;
  for (const [id, b] of parseBlocks(overlayText)) {
    const existing = base.get(id);
    if (!existing || b.epochMs >= existing.epochMs) {
      if (existing) replaced++;
      base.set(id, b);
    }
  }
  return { text: blocksToText(base.values()), count: base.size, replaced };
}

async function fromCelestrak(): Promise<Entry> {
  const { ok, status, text, retryAfterSec } = await fetchText(
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",
    { timeoutMs: 25_000, retries: 0, headers: { "User-Agent": CCTV_UA, Accept: "text/plain" } }
  );
  if (!ok) throw new ProviderHttpError("celestrak", status, retryAfterSec);
  if (text.includes("GP data has not updated since your last successful")) {
    blockedUntil.celestrak = Date.now() + RETRY_AFTER_THROTTLE_MS;
    throw new Error("CelesTrak says the data has not changed since the last download");
  }
  const count = parseBlocks(text).size;
  if (count < 500) throw new Error(`CelesTrak returned only ${count} element sets`);
  const now = Date.now();
  return { text, at: now, checkedAt: now, source: "celestrak", count };
}

type KeepTrackRow = { name?: string; tle1?: string; tle2?: string; type?: number | string };

/** KeepTrack's catalog includes debris and rocket bodies (~50k objects); keep payloads with fresh elements. */
async function fromKeepTrack(): Promise<Entry> {
  const key = keepTrackKey();
  if (!key) throw new Error("no KeepTrack key configured");
  const { ok, status, text, retryAfterSec } = await fetchText("https://api.keeptrack.space/v4/sats/brief", {
    timeoutMs: 120_000,
    retries: 0,
    headers: { "User-Agent": CCTV_UA, "x-api-key": key, Accept: "application/json" }
  });
  if (!ok) throw new ProviderHttpError("keeptrack", status, retryAfterSec);
  const parsed = JSON.parse(text) as unknown;
  const rows = (Array.isArray(parsed) ? parsed : ((parsed as { data?: unknown }).data ?? [])) as KeepTrackRow[];
  const cutoff = Date.now() - KEEPTRACK_MAX_EPOCH_AGE_DAYS * 86_400_000;
  // The feed repeats some NORAD ids; keep the newest element set for each so counts are honest.
  const byNorad = new Map<number, Block>();
  for (const r of rows) {
    if (!(r.type === 1 || r.type === "1")) continue;
    if (!r.name || !r.tle1?.startsWith("1 ") || !r.tle2?.startsWith("2 ")) continue;
    const id = noradOf(r.tle1);
    const epochMs = epochMsOf(r.tle1);
    if (id == null || epochMs < cutoff) continue;
    const prev = byNorad.get(id);
    if (!prev || epochMs > prev.epochMs) byNorad.set(id, { name: r.name.trim(), l1: r.tle1, l2: r.tle2, epochMs });
  }
  const keep = [...byNorad.values()];
  // Everything that isn't a Starlink first, so the cap trims the most repetitive objects.
  keep.sort((a, b) => Number(a.name.startsWith("STARLINK")) - Number(b.name.startsWith("STARLINK")));
  const picked = keep.slice(0, KEEPTRACK_MAX_SATS);
  if (picked.length < 500) throw new Error(`KeepTrack returned only ${picked.length} usable payloads`);
  const now = Date.now();
  return { text: blocksToText(picked), at: now, checkedAt: now, source: "keeptrack", count: picked.length };
}

type SatnogsRow = { tle0?: string; tle1?: string; tle2?: string };

async function fromSatnogsText(): Promise<{ text: string; count: number }> {
  const { ok, status, text, retryAfterSec } = await fetchText("https://db.satnogs.org/api/tle/?format=json", {
    timeoutMs: 45_000,
    retries: 1,
    headers: { "User-Agent": CCTV_UA, Accept: "application/json" }
  });
  if (!ok) throw new ProviderHttpError("satnogs", status, retryAfterSec);
  const rows = JSON.parse(text) as SatnogsRow[];
  const blocks: Block[] = [];
  for (const r of rows) {
    if (!r.tle1?.startsWith("1 ") || !r.tle2?.startsWith("2 ")) continue;
    blocks.push({
      name: (r.tle0 ?? "UNKNOWN").replace(/^0 /, "").trim(),
      l1: r.tle1,
      l2: r.tle2,
      epochMs: epochMsOf(r.tle1)
    });
  }
  if (blocks.length < 100) throw new Error(`SatNOGS returned only ${blocks.length} element sets`);
  return { text: blocksToText(blocks), count: blocks.length };
}

async function tryTier(
  name: "celestrak" | "keeptrack",
  run: () => Promise<Entry>
): Promise<Entry | null> {
  if (Date.now() < blockedUntil[name]) return null;
  try {
    const e = await run();
    lastError[name] = null;
    console.info(`[tle] ${name}: ${e.count} element sets`);
    return e;
  } catch (err) {
    lastError[name] = err instanceof Error ? err.message : String(err);
    blockedUntil[name] = Math.max(blockedUntil[name], Date.now() + RETRY_AFTER_FAILURE_MS);
    console.warn(`[tle] ${name} failed (${lastError[name]}); next try in 30 min`);
    return null;
  }
}

async function refresh(): Promise<Entry> {
  const celestrak = await tryTier("celestrak", fromCelestrak);
  if (celestrak) return celestrak;

  if (keepTrackKey()) {
    const kt = await tryTier("keeptrack", fromKeepTrack);
    if (kt) return kt;
  }

  const sat = await fromSatnogsText();
  const now = Date.now();
  if (mem && mem.count >= FULL_CATALOG_MIN && now - mem.at < STALE_OK_MS) {
    const merged = mergeOverlay(mem.text, sat.text);
    console.info(`[tle] fallback: SatNOGS merged over cached full catalog (${merged.count} total, ${merged.replaced} refreshed)`);
    return { text: merged.text, at: mem.at, checkedAt: now, source: "satnogs+cache", count: merged.count };
  }
  console.info(`[tle] fallback: SatNOGS only (${sat.count}) — no full catalog cached`);
  return { text: sat.text, at: now, checkedAt: now, source: "satnogs", count: sat.count };
}

async function readDisk(): Promise<Entry | null> {
  try {
    const e = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Partial<Entry>;
    if (typeof e.text !== "string" || typeof e.at !== "number" || !e.source) return null;
    return { text: e.text, at: e.at, checkedAt: e.checkedAt ?? e.at, source: e.source, count: e.count ?? 0 };
  } catch {
    return null;
  }
}

async function writeDisk(e: Entry): Promise<void> {
  try {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(e), "utf8");
  } catch (err) {
    console.warn("[tle] could not write disk cache:", err instanceof Error ? err.message : err);
  }
}

function needsRefresh(e: Entry): boolean {
  const now = Date.now();
  const dataAge = now - e.at;
  const sinceCheck = now - e.checkedAt;
  if (e.source === "celestrak") return dataAge >= FRESH_MS;
  if (e.source === "keeptrack") {
    // Prefer to move back to CelesTrak as soon as it may be tried again.
    return dataAge >= FRESH_MS || (now >= blockedUntil.celestrak && sinceCheck >= RETRY_AFTER_FAILURE_MS);
  }
  return sinceCheck >= RETRY_AFTER_FAILURE_MS;
}

function startRefresh(): Promise<Entry> {
  inflight ??= refresh()
    .then((e) => {
      mem = e;
      void writeDisk(e);
      return e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function getActiveTle(): Promise<{ entry: Entry; stale: boolean }> {
  if (!diskChecked) {
    diskChecked = true;
    mem = await readDisk();
  }
  const usable = mem && Date.now() - mem.at < STALE_OK_MS ? mem : null;

  if (usable) {
    if (needsRefresh(usable)) {
      // Serve what we have right now; update in the background so no request waits on a slow provider.
      startRefresh().catch((err) => console.warn("[tle] background refresh failed:", err instanceof Error ? err.message : err));
    }
    return { entry: usable, stale: Date.now() - usable.at >= FRESH_MS };
  }
  return { entry: await startRefresh(), stale: false };
}

export function tleRouter(): Router {
  const r = Router();
  r.get("/active", async (_req, res) => {
    try {
      const { entry, stale } = await getActiveTle();
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-TLE-Source", entry.source);
      res.setHeader("X-TLE-Count", String(entry.count));
      res.setHeader("X-TLE-Fetched-At", String(entry.at));
      res.setHeader("X-TLE-Age-Days", String(Math.round(((Date.now() - entry.at) / 86_400_000) * 10) / 10));
      res.setHeader("X-TLE-Stale", stale ? "1" : "0");
      if (lastError.celestrak) res.setHeader("X-TLE-Celestrak-Error", lastError.celestrak.slice(0, 120));
      res.send(entry.text);
    } catch (e) {
      console.warn("[tle] /active failed:", e instanceof Error ? e.message : e);
      res.status(502).json({ error: "No element sets available from any source" });
    }
  });
  return r;
}
