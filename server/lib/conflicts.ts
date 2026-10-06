import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { gdeltHeadlines, type NewsItem } from "./gdelt";
import { CACHE_ROOT } from "./paths";

/**
 * Armed-conflict events from the Uppsala Conflict Data Program (UCDP, https://ucdp.uu.se — CC BY 4.0): the annual
 * georeferenced event dataset (GED, through the end of 2024) plus UCDP's monthly "candidate" releases that carry it up to
 * roughly last month. Each event has a date, place, the warring sides, fatality estimates and the news articles it was
 * coded from. Events since 2014 are kept, so conflicts can be replayed through time and followed as they develop.
 *
 * Headlines for "what is happening right now" come separately from the GDELT news index (see getConflictNews).
 *
 * Data: UCDP Georeferenced Event Dataset (GED) and GED Candidate — Davies, Pettersson & Öberg (Journal of Peace
 * Research) and Sundberg & Melander (2013). Free for non-commercial use with attribution.
 */
export type ConflictEvent = {
  id: string;
  /** ISO date (start) */
  d: string;
  lat: number;
  lon: number;
  best: number;
  low: number;
  high: number;
  civilians: number;
  /** 1 = state-based, 2 = non-state, 3 = one-sided violence against civilians */
  v: number;
  conflict: string;
  a: string;
  b: string;
  where: string;
  country: string;
  /** UCDP location precision (1 = exact site ... 7 = country); 5 and up are rough. */
  p: number;
  /** Days the event spans; long spans are monthly or period estimates, not single incidents. */
  span: number;
  src: Array<{ s: string; d: string; h: string }>;
};

type Compact = {
  day: number;
  lat: number;
  lon: number;
  best: number;
  low: number;
  high: number;
  civ: number;
  v: number;
  conflict: number;
  a: number;
  b: number;
  where: string;
  country: number;
  id: string;
  src: string;
  p: number;
  span: number;
};

type Store = {
  builtAt: number;
  dataThrough: number; // day number
  strings: string[];
  rows: Compact[];
};

const CACHE_FILE = join(CACHE_ROOT, "conflicts", "events-v2.json");
const TTL_MS = 3 * 24 * 3_600_000;
const FIRST_YEAR = 2014;
const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)" };
const GED_ZIP = "https://ucdp.uu.se/downloads/ged/ged251-csv.zip";
const GED_THROUGH_YEAR = 2024;

const dayOf = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : NaN;
};
const isoOf = (day: number): string => new Date(day * 86_400_000).toISOString().slice(0, 10);

// ---------- zip + csv ----------

/** Extracts the first .csv file from a zip held in memory (stored or deflated entries). */
function csvFromZip(zip: Buffer): Buffer {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 70_000); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (/\.csv$/i.test(name)) {
      const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const body = zip.subarray(dataStart, dataStart + csize);
      return method === 0 ? body : inflateRawSync(body);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("no CSV inside the zip");
}

/** Streams the rows of a CSV buffer (quoted fields, doubled quotes, embedded newlines) to a callback. */
function eachCsvRow(buf: Buffer, onRow: (fields: string[]) => void): void {
  const QUOTE = 0x22;
  const COMMA = 0x2c;
  const LF = 0x0a;
  const CR = 0x0d;
  let fields: string[] = [];
  let start = 0;
  let hasEscape = false;
  let inQuotes = false;
  let i = 0;
  const n = buf.length;
  const field = (end: number): string => {
    let s = buf.toString("utf8", start, end);
    if (s.length && s.charCodeAt(0) === QUOTE) s = s.slice(1, s.endsWith('"') ? -1 : undefined);
    if (hasEscape) s = s.replace(/""/g, '"');
    hasEscape = false;
    return s;
  };
  while (i < n) {
    const c = buf[i]!;
    if (inQuotes) {
      if (c === QUOTE) {
        if (buf[i + 1] === QUOTE) {
          hasEscape = true;
          i += 2;
          continue;
        }
        inQuotes = false;
      }
      i++;
      continue;
    }
    if (c === QUOTE) {
      inQuotes = true;
      i++;
    } else if (c === COMMA) {
      fields.push(field(i));
      start = ++i;
    } else if (c === LF || c === CR) {
      fields.push(field(i));
      if (fields.length > 1 || fields[0] !== "") onRow(fields);
      fields = [];
      if (c === CR && buf[i + 1] === LF) i++;
      start = ++i;
    } else i++;
  }
  if (start < n) {
    fields.push(field(n));
    onRow(fields);
  }
}

// ---------- build ----------

async function download(url: string, timeoutMs: number): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function ingest(buf: Buffer, minYear: number, strings: string[], index: Map<string, number>, seen: Set<string>, rows: Compact[]): void {
  let col: Record<string, number> | null = null;
  const intern = (s: string): number => {
    const t = s.trim();
    let k = index.get(t);
    if (k === undefined) {
      k = strings.length;
      strings.push(t);
      index.set(t, k);
    }
    return k;
  };
  eachCsvRow(buf, (f) => {
    if (!col) {
      col = Object.fromEntries(f.map((h, i) => [h.trim(), i]));
      return;
    }
    const get = (name: string): string => f[col![name] ?? -1] ?? "";
    const start = get("date_start");
    const day = dayOf(start);
    const year = Number(start.slice(0, 4));
    if (!Number.isFinite(day) || year < minYear) return;
    const id = get("id");
    if (seen.has(id)) return;
    const lat = Number(get("latitude"));
    const lon = Number(get("longitude"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    seen.add(id);
    // "Source,2026-01-08,Headline";"Source 2,2026-01-12,Headline 2"
    const src: string[] = [];
    for (const m of get("source_article").matchAll(/"([^"]*)"/g)) src.push(m[1]!);
    rows.push({
      day,
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      best: Number(get("best")) || 0,
      low: Number(get("low")) || 0,
      high: Number(get("high")) || 0,
      civ: Number(get("deaths_civilians")) || 0,
      v: Number(get("type_of_violence")) || 1,
      conflict: intern(get("conflict_name")),
      a: intern(get("side_a")),
      b: intern(get("side_b")),
      where: get("where_description").slice(0, 120),
      country: intern(get("country")),
      id,
      src: src.slice(0, 3).join("␟").slice(0, 600),
      p: Number(get("where_prec")) || 1,
      span: Math.max(0, Math.round(((dayOf(get("date_end")) || day) - day) || 0))
    });
  });
}

async function build(): Promise<Store> {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const seen = new Set<string>();
  const rows: Compact[] = [];

  const zip = await download(GED_ZIP, 180_000);
  if (!zip) throw new Error("UCDP event archive unavailable");
  ingest(csvFromZip(zip), FIRST_YEAR, strings, index, seen, rows);

  // Monthly candidate releases carry the data from the end of the annual set up to about last month.
  const now = new Date();
  const jobs: Array<Promise<Buffer | null>> = [];
  for (let y = GED_THROUGH_YEAR + 1; y <= now.getUTCFullYear(); y++) {
    const last = y === now.getUTCFullYear() ? now.getUTCMonth() + 1 : 12;
    for (let m = 1; m <= last; m++) {
      jobs.push(download(`https://ucdp.uu.se/downloads/candidateged/GEDEvent_v${String(y).slice(2)}_0_${m}.csv`, 60_000));
    }
  }
  for (const buf of await Promise.all(jobs)) if (buf) ingest(buf, GED_THROUGH_YEAR + 1, strings, index, seen, rows);

  rows.sort((a, b) => a.day - b.day);
  return { builtAt: Date.now(), dataThrough: rows.length ? rows[rows.length - 1]!.day : 0, strings, rows };
}

let store: Store | null = null;
let building: Promise<Store> | null = null;
let buildError: string | null = null;

async function loadStore(): Promise<Store> {
  try {
    const c = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Store;
    if (Date.now() - c.builtAt < TTL_MS && c.rows.length) return c;
  } catch {
    /* build below */
  }
  const s = await build();
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(s), "utf8");
  return s;
}

/** The data set if it is ready; otherwise starts building it in the background and returns null. */
export function conflictStore(): Store | null {
  if (store && Date.now() - store.builtAt < TTL_MS) return store;
  if (!building) {
    building = loadStore()
      .then((s) => {
        store = s;
        buildError = null;
        return s;
      })
      .catch((e) => {
        buildError = e instanceof Error ? e.message : String(e);
        console.warn("[conflicts] build failed:", buildError);
        throw e;
      })
      .finally(() => {
        building = null;
      });
    building.catch(() => {});
  }
  return store; // stale data keeps being served while a refresh builds
}

export const conflictBuildError = (): string | null => buildError;

// ---------- conflicts and queries ----------

type Featured = { id: string; label: string; blurb: string; test: (conflict: string) => boolean };

const FEATURED: Featured[] = [
  {
    id: "ukraine",
    label: "Russia – Ukraine",
    blurb: "The war in Ukraine",
    test: (c) => /ukraine/i.test(c)
  },
  {
    id: "israel-palestine",
    label: "Israel – Gaza, West Bank & Lebanon",
    blurb: "Israel, Gaza, the West Bank and the Lebanese border",
    test: (c) => /israel|palestine|hamas|hezbollah/i.test(c)
  }
];

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type ConflictSummary = {
  id: string;
  label: string;
  blurb?: string;
  featured: boolean;
  events30d: number;
  deaths30d: number;
  lastDate: string | null;
};

function matcherFor(s: Store, id: string): ((r: Compact) => boolean) | null {
  const f = FEATURED.find((x) => x.id === id);
  if (f) return (r) => f.test(s.strings[r.conflict] ?? "");
  const names = new Set(s.strings.filter((n) => slug(n) === id));
  if (!names.size) return null;
  return (r) => names.has(s.strings[r.conflict] ?? "");
}

export function listConflicts(s: Store): { featured: ConflictSummary[]; others: ConflictSummary[]; dataThrough: string } {
  const through = s.dataThrough;
  const since30 = through - 30;
  const since365 = through - 365;
  const agg = new Map<string, { label: string; n30: number; d30: number; n365: number; last: number }>();
  for (const r of s.rows) {
    if (r.day < since365) continue;
    const name = s.strings[r.conflict] ?? "";
    if (!name || /^XXX/i.test(name)) continue;
    const a = agg.get(name) ?? { label: name, n30: 0, d30: 0, n365: 0, last: 0 };
    a.n365++;
    if (r.day >= since30) {
      a.n30++;
      a.d30 += r.best;
    }
    if (r.day > a.last) a.last = r.day;
    agg.set(name, a);
  }
  const featured: ConflictSummary[] = FEATURED.map((f) => {
    let n30 = 0;
    let d30 = 0;
    let last = 0;
    for (const [name, a] of agg) {
      if (!f.test(name)) continue;
      n30 += a.n30;
      d30 += a.d30;
      last = Math.max(last, a.last);
    }
    return { id: f.id, label: f.label, blurb: f.blurb, featured: true, events30d: n30, deaths30d: d30, lastDate: last ? isoOf(last) : null };
  });
  const others = [...agg.values()]
    .filter((a) => !FEATURED.some((f) => f.test(a.label)))
    .sort((a, b) => b.n365 - a.n365)
    .slice(0, 18)
    .map((a) => ({ id: slug(a.label), label: a.label, featured: false, events30d: a.n30, deaths30d: a.d30, lastDate: a.last ? isoOf(a.last) : null }));
  return { featured, others, dataThrough: isoOf(through) };
}

function expand(s: Store, r: Compact): ConflictEvent {
  return {
    id: r.id,
    d: isoOf(r.day),
    lat: r.lat,
    lon: r.lon,
    best: r.best,
    low: r.low,
    high: r.high,
    civilians: r.civ,
    v: r.v,
    conflict: s.strings[r.conflict] ?? "",
    a: s.strings[r.a] ?? "",
    b: s.strings[r.b] ?? "",
    where: r.where,
    country: s.strings[r.country] ?? "",
    p: r.p,
    span: r.span,
    src: r.src
      ? r.src.split("␟").map((x) => {
          const i1 = x.indexOf(",");
          const i2 = x.indexOf(",", i1 + 1);
          return i1 > 0 && i2 > i1 ? { s: x.slice(0, i1), d: x.slice(i1 + 1, i2), h: x.slice(i2 + 1) } : { s: "", d: "", h: x };
        })
      : []
  };
}

export function queryConflictEvents(
  s: Store,
  id: string,
  fromIso: string,
  toIso: string,
  limit: number
): { events: ConflictEvent[]; total: number; roughHidden: number; roughDeaths: number } | null {
  const match = matcherFor(s, id);
  if (!match) return null;
  const from = dayOf(fromIso);
  const to = dayOf(toIso);
  const hits: Compact[] = [];
  let roughHidden = 0;
  let roughDeaths = 0;
  for (const r of s.rows) {
    if (r.day < from) continue;
    if (r.day > to) break; // rows are sorted by date
    if (!match(r)) continue;
    // Country-level locations and month-long totals are estimates, not incidents: left off the map, but counted.
    if (r.p >= 5 || r.span > 10) {
      roughHidden++;
      roughDeaths += r.best;
      continue;
    }
    hits.push(r);
  }
  const total = hits.length;
  // Keep the deadliest if there are too many to draw.
  const kept = total > limit ? hits.sort((a, b) => b.best - a.best).slice(0, limit) : hits;
  return { events: kept.map((r) => expand(s, r)), total, roughHidden, roughDeaths };
}

/** Newest distinct headlines from the articles the latest events were coded from. */
export function latestConflictUpdates(
  s: Store,
  id: string,
  days: number
): Array<{ source: string; date: string; headline: string; where: string; deaths: number }> | null {
  const match = matcherFor(s, id);
  if (!match) return null;
  const from = s.dataThrough - days;
  const seen = new Set<string>();
  const out: Array<{ source: string; date: string; headline: string; where: string; deaths: number }> = [];
  for (let i = s.rows.length - 1; i >= 0 && out.length < 40; i--) {
    const r = s.rows[i]!;
    if (r.day < from) break;
    if (!match(r)) continue;
    for (const x of r.src.split("␟")) {
      const i1 = x.indexOf(",");
      const i2 = x.indexOf(",", i1 + 1);
      if (i1 <= 0 || i2 <= i1) continue;
      const headline = x.slice(i2 + 1).trim();
      if (!headline || seen.has(headline)) continue;
      seen.add(headline);
      out.push({ source: x.slice(0, i1), date: x.slice(i1 + 1, i2), headline, where: r.where, deaths: r.best });
      break;
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 25);
}

// ---------- live headlines (GDELT) ----------

const NEWS_QUERY: Record<string, string> = {
  ukraine: '(ukraine OR kyiv OR kharkiv OR donetsk OR zaporizhzhia) (war OR strike OR attack OR drone OR missile OR frontline) sourcelang:eng',
  "israel-palestine": '(gaza OR israel OR "west bank" OR hezbollah OR lebanon) (strike OR attack OR ceasefire OR hostages OR war) sourcelang:eng'
};

export type { NewsItem } from "./gdelt";

/** Last-two-days headlines for a featured conflict from the GDELT news index (shared queue and cache: see gdelt.ts). */
export async function getConflictNews(id: string): Promise<{ items: NewsItem[]; stale: boolean }> {
  const query = NEWS_QUERY[id];
  if (!query) return { items: [], stale: false };
  return gdeltHeadlines(`conflict:${id}`, query);
}
