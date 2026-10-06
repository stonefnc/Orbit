import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectTiles, createTileStore } from "./osmTiles";
import { CACHE_ROOT } from "./paths";

/**
 * Data centers from three public maps, merged so each facility appears once:
 *  - OpenStreetMap (telecom / building / industrial = data_center), via the shared 1° tile cache — ODbL.
 *  - PeeringDB's facility list (colocation sites with operator, address and website) — public data.
 *  - Wikidata (items that are data centers, with coordinates) — CC0.
 *
 * De-duplication: sites are ranked by how much they tell us, then each is merged into an already-kept site if it is
 * within ~250 m, or within ~3 km with the same normalised name (the same facility mapped at slightly different spots).
 * Merged sites keep every source, id and link, and OSM buildings of one campus are counted rather than repeated.
 */
export type DcSite = {
  id: string;
  lat: number;
  lon: number;
  name?: string;
  operator?: string;
  owner?: string;
  website?: string;
  address?: string;
  region?: string;
  country?: string;
  ref?: string;
  notes?: string;
  /** Which maps know this site: "OpenStreetMap", "PeeringDB", "Wikidata". */
  sources: string[];
  osm: string[];
  peeringdb?: number;
  wikidata?: string;
  /** How many OSM buildings were merged into this campus. */
  buildings: number;
};

type Candidate = DcSite & { score: number };

const CACHE_DIR = join(CACHE_ROOT, "dc");
const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)" };
const MAX_TILES_PER_QUERY = 80;

const clean = (s: string | undefined | null, max = 120): string | undefined => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

const httpUrl = (u: string | undefined | null): string | undefined => {
  if (!u) return undefined;
  try {
    const p = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : undefined;
  } catch {
    return undefined;
  }
};

// ---------- OpenStreetMap ----------

type OsmEl = { type: string; id: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };

const OSM_TAGS: Array<[string, string]> = [
  ["telecom", "data_center"],
  ["telecom", "data_centre"],
  ["building", "data_center"],
  ["building", "data_centre"],
  ["industrial", "data_center"],
  ["man_made", "data_center"]
];

function isOsmDc(t: Record<string, string>): boolean {
  return OSM_TAGS.some(([k, v]) => t[k] === v);
}

function parseOsm(elements: unknown[]): DcSite[] {
  const seen = new Set<string>();
  const out: DcSite[] = [];
  for (const raw of elements) {
    const el = raw as OsmEl;
    if (!["node", "way", "relation"].includes(el.type)) continue;
    const t = el.tags ?? {};
    if (!isOsmDc(t)) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const ref = `${el.type}/${el.id}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const addr = [t["addr:housenumber"], t["addr:street"], t["addr:city"], t["addr:postcode"]].filter(Boolean).join(" ");
    out.push({
      id: `osm-${el.type}-${el.id}`,
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      name: clean(t.name),
      operator: clean(t.operator ?? t.brand),
      owner: clean(t.owner),
      website: httpUrl(t.website ?? t["contact:website"]),
      address: clean(t["addr:full"] ?? addr),
      region: clean(t["addr:state"] ?? t["addr:province"]),
      country: clean(t["addr:country"], 4),
      ref: clean(t.ref, 40),
      notes: clean(t.description, 200),
      sources: ["OpenStreetMap"],
      osm: [ref],
      wikidata: clean(t.wikidata, 16),
      buildings: 1
    });
  }
  return out;
}

const osmStore = createTileStore<DcSite>({
  dir: "dc-osm",
  ttlMs: 7 * 24 * 3_600_000,
  query: (s, w, n, e) =>
    `[out:json][timeout:55][bbox:${s},${w},${n},${e}];(${OSM_TAGS.map(([k, v]) => `nwr["${k}"="${v}"];`).join("")});out center tags;`,
  parse: parseOsm
});

// ---------- PeeringDB ----------

type PdbFac = {
  id: number;
  name?: string;
  org_name?: string;
  latitude?: number | null;
  longitude?: number | null;
  city?: string;
  state?: string;
  country?: string;
  website?: string;
  address1?: string;
  clli?: string;
  status?: string;
};

let pdb: { at: number; sites: DcSite[] } | null = null;
let pdbLoading: Promise<DcSite[]> | null = null;

async function loadPeeringDb(): Promise<DcSite[]> {
  const file = join(CACHE_DIR, "peeringdb.json");
  try {
    const c = JSON.parse(await readFile(file, "utf8")) as { at: number; sites: DcSite[] };
    if (Date.now() - c.at < 3 * 24 * 3_600_000 && c.sites.length) {
      pdb = c;
      return c.sites;
    }
  } catch {
    /* fetch below */
  }
  const res = await fetch("https://www.peeringdb.com/api/fac?depth=0&status=ok", { headers: UA, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`PeeringDB HTTP ${res.status}`);
  const j = JSON.parse(await res.text()) as { data?: PdbFac[] };
  const sites: DcSite[] = [];
  for (const f of j.data ?? []) {
    if (typeof f.latitude !== "number" || typeof f.longitude !== "number") continue;
    if (Math.abs(f.latitude) > 90 || Math.abs(f.longitude) > 180 || (f.latitude === 0 && f.longitude === 0)) continue;
    sites.push({
      id: `pdb-${f.id}`,
      lat: Math.round(f.latitude * 1e6) / 1e6,
      lon: Math.round(f.longitude * 1e6) / 1e6,
      name: clean(f.name),
      operator: clean(f.org_name),
      website: httpUrl(f.website),
      address: clean([f.address1, f.city, f.state].filter(Boolean).join(", ")),
      region: clean(f.state),
      country: clean(f.country, 4),
      ref: clean(f.clli, 40),
      sources: ["PeeringDB"],
      osm: [],
      peeringdb: f.id,
      buildings: 0
    });
  }
  pdb = { at: Date.now(), sites };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(pdb), "utf8");
  return sites;
}

function getPeeringDb(): Promise<DcSite[]> {
  if (pdb && Date.now() - pdb.at < 3 * 24 * 3_600_000) return Promise.resolve(pdb.sites);
  pdbLoading ??= loadPeeringDb()
    .catch((e) => {
      if (pdb) return pdb.sites;
      console.warn("[dc] PeeringDB unavailable:", e instanceof Error ? e.message : e);
      return [];
    })
    .finally(() => {
      pdbLoading = null;
    });
  return pdbLoading;
}

// ---------- Wikidata ----------

const SPARQL = `SELECT ?d ?dLabel ?coord ?operatorLabel ?countryLabel ?website WHERE {
  ?d wdt:P31/wdt:P279* wd:Q671224; wdt:P625 ?coord.
  OPTIONAL { ?d wdt:P137 ?operator }
  OPTIONAL { ?d wdt:P17 ?country }
  OPTIONAL { ?d wdt:P856 ?website }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 8000`;

let wd: { at: number; sites: DcSite[] } | null = null;
let wdLoading: Promise<DcSite[]> | null = null;

async function loadWikidata(): Promise<DcSite[]> {
  const file = join(CACHE_DIR, "wikidata.json");
  try {
    const c = JSON.parse(await readFile(file, "utf8")) as { at: number; sites: DcSite[] };
    if (Date.now() - c.at < 30 * 24 * 3_600_000) {
      wd = c;
      return c.sites;
    }
  } catch {
    /* fetch below */
  }
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(SPARQL)}`, {
    headers: { ...UA, Accept: "application/sparql-results+json" },
    signal: AbortSignal.timeout(100_000)
  });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  const j = JSON.parse(await res.text()) as { results: { bindings: Array<Record<string, { value: string } | undefined>> } };
  const byId = new Map<string, DcSite>();
  for (const b of j.results.bindings) {
    const qid = b.d?.value.split("/").pop();
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value ?? "");
    const name = b.dLabel?.value;
    if (!qid || !m) continue;
    const lon = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const cur =
      byId.get(qid) ??
      ({
        id: `wd-${qid}`,
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        name: name && !/^Q\d+$/.test(name) ? clean(name) : undefined,
        sources: ["Wikidata"],
        osm: [],
        wikidata: qid,
        buildings: 0
      } as DcSite);
    const op = b.operatorLabel?.value;
    if (op && !/^Q\d+$/.test(op)) cur.operator ??= clean(op);
    const c = b.countryLabel?.value;
    if (c && !/^Q\d+$/.test(c)) cur.country ??= clean(c, 60);
    cur.website ??= httpUrl(b.website?.value);
    byId.set(qid, cur);
  }
  const sites = [...byId.values()];
  wd = { at: Date.now(), sites };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(wd), "utf8");
  return sites;
}

function getWikidata(): Promise<DcSite[]> {
  if (wd && Date.now() - wd.at < 30 * 24 * 3_600_000) return Promise.resolve(wd.sites);
  wdLoading ??= loadWikidata()
    .catch((e) => {
      if (wd) return wd.sites;
      console.warn("[dc] Wikidata unavailable:", e instanceof Error ? e.message : e);
      return [];
    })
    .finally(() => {
      wdLoading = null;
    });
  return wdLoading;
}

// ---------- Merge / de-duplicate ----------

const GENERIC = /\b(data ?cent(er|re)s?|datacenter|campus|building|facility|facilities|colocation|colo|dc|the|llc|inc|ltd|gmbh|corp(oration)?)\b/g;

function normName(n: string | undefined): string {
  return (n ?? "").toLowerCase().replace(GENERIC, " ").replace(/[^a-z0-9]+/g, "");
}

function rank(s: DcSite): number {
  return (
    (s.name ? 3 : 0) +
    (s.operator ? 2 : 0) +
    (s.website ? 1 : 0) +
    (s.peeringdb ? 3 : 0) +
    (s.wikidata ? 2 : 0) +
    (s.osm.length ? 1 : 0) +
    (s.osm.some((o) => !o.startsWith("node/")) ? 1 : 0) // a mapped building outline beats a lone point
  );
}

const meters = (a: DcSite, b: DcSite): number => {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLon = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
};

function absorb(into: Candidate, other: DcSite): void {
  for (const s of other.sources) if (!into.sources.includes(s)) into.sources.push(s);
  for (const o of other.osm) if (!into.osm.includes(o)) into.osm.push(o);
  into.buildings += other.buildings;
  into.name ??= other.name;
  into.operator ??= other.operator;
  into.owner ??= other.owner;
  into.website ??= other.website;
  into.address ??= other.address;
  into.region ??= other.region;
  into.country ??= other.country;
  into.ref ??= other.ref;
  into.notes ??= other.notes;
  into.peeringdb ??= other.peeringdb;
  into.wikidata ??= other.wikidata;
}

export function mergeSites(all: DcSite[]): DcSite[] {
  const ranked: Candidate[] = all
    .map((s) => ({ ...s, sources: [...s.sources], osm: [...s.osm], score: rank(s) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const CELL = 0.03; // ~3.3 km, covers the widest match radius (3 km) with the 3x3 neighbourhood
  const grid = new Map<string, Candidate[]>();
  const cellKey = (x: number, y: number): string => `${x}:${y}`;
  const kept: Candidate[] = [];

  for (const s of ranked) {
    const cx = Math.floor(s.lon / CELL);
    const cy = Math.floor(s.lat / CELL);
    const ns = normName(s.name);
    let host: Candidate | null = null;
    let best = Infinity;
    for (let dx = -1; dx <= 1 && !host; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const k of grid.get(cellKey(cx + dx, cy + dy)) ?? []) {
          // Same Wikidata / PeeringDB / OSM id is the same site no matter how far apart the points are.
          const sameId =
            (s.wikidata && k.wikidata === s.wikidata) ||
            (s.peeringdb && k.peeringdb === s.peeringdb) ||
            s.osm.some((o) => k.osm.includes(o));
          const d = meters(s, k);
          const nk = normName(k.name);
          const sameName = ns.length >= 4 && nk.length >= 4 && (ns === nk || (Math.min(ns.length, nk.length) >= 6 && (ns.includes(nk) || nk.includes(ns))));
          if (sameId || d <= 250 || (sameName && d <= 3000)) {
            if (d < best) {
              best = d;
              host = k;
            }
          }
        }
      }
    }
    if (host) {
      absorb(host, s);
    } else {
      kept.push(s);
      const key = cellKey(cx, cy);
      const arr = grid.get(key);
      if (arr) arr.push(s);
      else grid.set(key, [s]);
    }
  }
  return kept.map(({ score: _score, ...site }) => site);
}

// ---------- Query ----------

export type DcQueryResult = {
  sites: DcSite[];
  tilesTotal: number;
  tilesPending: number;
  tilesFailed: number;
  truncated: boolean;
  counts: { openstreetmap: number; peeringdb: number; wikidata: number; merged: number };
};

export async function queryDatacenters(
  west: number,
  south: number,
  east: number,
  north: number,
  limit: number
): Promise<DcQueryResult | "too-wide"> {
  const got = await collectTiles(osmStore, west, south, east, north, MAX_TILES_PER_QUERY);
  if (got === "too-wide") return got;
  const [pd, wk] = await Promise.all([getPeeringDb(), getWikidata()]);

  const inBox = (s: DcSite): boolean => {
    if (s.lat < south || s.lat > north) return false;
    return west <= east ? s.lon >= west && s.lon <= east : s.lon >= west || s.lon <= east;
  };
  // A small margin so a facility mapped just outside the box still merges with one just inside it.
  const osmIn = got.items.filter(inBox);
  const pdIn = pd.filter(inBox);
  const wkIn = wk.filter(inBox);
  let sites = mergeSites([...osmIn, ...pdIn, ...wkIn]);

  const cLat = (south + north) / 2;
  let cLon = west <= east ? (west + east) / 2 : (west + east + 360) / 2;
  if (cLon > 180) cLon -= 360;
  let truncated = false;
  if (sites.length > 20_000) {
    sites.sort((a, b) => (a.lat - cLat) ** 2 + (a.lon - cLon) ** 2 - ((b.lat - cLat) ** 2 + (b.lon - cLon) ** 2));
    sites = sites.slice(0, 20_000);
    truncated = true;
  }
  void limit;
  return {
    sites,
    tilesTotal: got.total,
    tilesPending: got.pending,
    tilesFailed: got.failed,
    truncated,
    counts: { openstreetmap: osmIn.length, peeringdb: pdIn.length, wikidata: wkIn.length, merged: sites.length }
  };
}
