import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fetchText } from "./fetchUtil";
import { APP_ROOT, CACHE_ROOT } from "./paths";

/**
 * Registry of well-known privately owned aircraft (celebrities, billionaires, ...), keyed by ICAO24 hex.
 *
 * Two layers, the second wins:
 *  1. An optional import from the community "plane-alert-db" list (only the categories named in NOTABLE_CATEGORIES,
 *     default "Don't you know who I am?"). It is downloaded once a week into .cache and is never committed to this repo.
 *     Disable with NOTABLE_IMPORT=off.
 *  2. Your own curated entries in data/notable-aircraft.json.
 *
 * Only public registry facts are kept (hex, tail number, owner label, type). Nothing here is a live position.
 */
export type NotableAircraft = {
  hex: string;
  owner: string;
  registration?: string;
  type?: string;
  note?: string;
  link?: string;
};

const ROOT = APP_ROOT;
const CURATED_FILE = join(ROOT, "data", "notable-aircraft.json");
const CACHE_FILE = join(CACHE_ROOT, "notable", "imported.json");
const SOURCE_URL = "https://raw.githubusercontent.com/sdr-enthusiasts/plane-alert-db/main/plane-alert-db.csv";
const WEEK = 7 * 24 * 60 * 60_000;

let merged: NotableAircraft[] | null = null;
let loading: Promise<NotableAircraft[]> | null = null;

/** Minimal CSV reader (handles quoted fields and doubled quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function safeLink(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function importFromCommunityList(): Promise<NotableAircraft[]> {
  if ((process.env.NOTABLE_IMPORT ?? "on").toLowerCase() === "off") return [];

  try {
    const cached = JSON.parse(await readFile(CACHE_FILE, "utf8")) as { at: number; items: NotableAircraft[] };
    if (Date.now() - cached.at < WEEK && Array.isArray(cached.items)) return cached.items;
  } catch {
    /* no cache yet */
  }

  const wanted = new Set(
    (process.env.NOTABLE_CATEGORIES ?? "Don't you know who I am?")
      .split("|")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  try {
    const res = await fetchText(SOURCE_URL, {
      timeoutMs: 30_000,
      retries: 1,
      headers: { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit)" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCsv(res.text);
    const head = rows[0] ?? [];
    const col = (name: string): number => head.findIndex((h) => h.trim() === name);
    const iHex = col("$ICAO");
    const iReg = col("$Registration");
    const iOwner = col("$Operator");
    const iType = col("$Type");
    const iCat = col("Category");
    const iLink = col("$#Link");
    if (iHex < 0 || iOwner < 0 || iCat < 0) throw new Error("unexpected CSV layout");

    const items: NotableAircraft[] = [];
    for (const r of rows.slice(1)) {
      if (!wanted.has((r[iCat] ?? "").trim().toLowerCase())) continue;
      const hex = (r[iHex] ?? "").trim().toLowerCase();
      const owner = (r[iOwner] ?? "").trim();
      if (!/^[0-9a-f]{6}$/.test(hex) || !owner) continue;
      const item: NotableAircraft = { hex, owner };
      const reg = iReg >= 0 ? (r[iReg] ?? "").trim() : "";
      const type = iType >= 0 ? (r[iType] ?? "").trim() : "";
      const link = safeLink(iLink >= 0 ? (r[iLink] ?? "").trim() : undefined);
      if (reg) item.registration = reg;
      if (type) item.type = type;
      if (link) item.link = link;
      items.push(item);
    }
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ at: Date.now(), items }), "utf8");
    return items;
  } catch (e) {
    console.warn("[notable] community list unavailable:", e instanceof Error ? e.message : e);
    // Fall back to a stale cache rather than nothing.
    try {
      return (JSON.parse(await readFile(CACHE_FILE, "utf8")) as { items: NotableAircraft[] }).items ?? [];
    } catch {
      return [];
    }
  }
}

async function loadCurated(): Promise<NotableAircraft[]> {
  try {
    const raw = JSON.parse(await readFile(CURATED_FILE, "utf8")) as { aircraft?: unknown } | unknown[];
    const list = Array.isArray(raw) ? raw : ((raw as { aircraft?: unknown }).aircraft as unknown[] | undefined) ?? [];
    const out: NotableAircraft[] = [];
    for (const e of list) {
      const o = e as Partial<NotableAircraft>;
      const hex = String(o.hex ?? "").trim().toLowerCase();
      const owner = String(o.owner ?? "").trim();
      if (!/^[0-9a-f]{6}$/.test(hex) || !owner) continue;
      const item: NotableAircraft = { hex, owner };
      if (o.registration) item.registration = String(o.registration);
      if (o.type) item.type = String(o.type);
      if (o.note) item.note = String(o.note);
      const link = safeLink(o.link);
      if (link) item.link = link;
      out.push(item);
    }
    return out;
  } catch {
    return [];
  }
}

export type LiveNotable = {
  hex: string;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  callsign: string | null;
};

const LIVE_TTL_MS = 60_000;
const LIVE_HOSTS = ["https://api.adsb.lol/v2/hex/", "https://opendata.adsb.fi/api/v2/hex/"];
let liveCache: { at: number; items: LiveNotable[] } | null = null;
let liveInflight: Promise<LiveNotable[]> | null = null;

/**
 * Which registry aircraft are airborne right now, anywhere in the world. Looks them up by hex in a few batched
 * requests to the community ADS-B networks, then caches the answer for a minute so any number of clients cost the same.
 */
export function getLiveNotableAircraft(): Promise<LiveNotable[]> {
  if (liveCache && Date.now() - liveCache.at < LIVE_TTL_MS) return Promise.resolve(liveCache.items);
  liveInflight ??= (async () => {
    const all = await getNotableAircraft();
    const hexes = all.map((a) => a.hex);
    const items: LiveNotable[] = [];
    let anyBatchOk = false;
    for (let i = 0; i < hexes.length; i += 40) {
      const batch = hexes.slice(i, i + 40).join(",");
      for (const host of LIVE_HOSTS) {
        try {
          const res = await fetchText(`${host}${batch}`, {
            timeoutMs: 10_000,
            retries: 0,
            headers: { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit)" }
          });
          if (!res.ok) continue;
          anyBatchOk = true;
          const j = JSON.parse(res.text) as {
            ac?: Array<{ hex?: string; lat?: number; lon?: number; alt_baro?: number | string; flight?: string }>;
          };
          for (const a of j.ac ?? []) {
            if (typeof a.lat !== "number" || typeof a.lon !== "number" || !a.hex) continue;
            items.push({
              hex: a.hex.toLowerCase(),
              lat: a.lat,
              lon: a.lon,
              altitudeFt: typeof a.alt_baro === "number" ? a.alt_baro : null,
              callsign: a.flight?.trim() || null
            });
          }
          break;
        } catch {
          /* try the next host */
        }
      }
      if (i + 40 < hexes.length) await new Promise((r) => setTimeout(r, 400));
    }
    if (!anyBatchOk && liveCache) return liveCache.items; // upstream trouble: serve the last good answer
    liveCache = { at: Date.now(), items };
    return items;
  })().finally(() => {
    liveInflight = null;
  });
  return liveInflight;
}

export function getNotableAircraft(): Promise<NotableAircraft[]> {
  if (merged) return Promise.resolve(merged);
  loading ??= (async () => {
    const [imported, curated] = await Promise.all([importFromCommunityList(), loadCurated()]);
    const byHex = new Map<string, NotableAircraft>();
    for (const a of imported) byHex.set(a.hex, a);
    for (const a of curated) byHex.set(a.hex, { ...byHex.get(a.hex), ...a });
    merged = [...byHex.values()];
    // Refresh weekly without a restart.
    setTimeout(() => {
      merged = null;
      loading = null;
    }, WEEK).unref();
    return merged;
  })();
  return loading;
}
