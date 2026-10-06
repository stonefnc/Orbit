import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { collectTiles, createTileStore } from "./osmTiles";
import { CACHE_ROOT } from "./paths";

/**
 * Electric power infrastructure from two public sources:
 *
 *  - Power plants: the WRI Global Power Plant Database (CC BY 4.0), ~35,000 plants worldwide with fuel and capacity.
 *    Downloaded once, thinned to plants of 100 MW and up and cached on disk for a month.
 *  - Transmission lines and substations of 200 kV and up: OpenStreetMap (`power=line` / `power=substation`), loaded per
 *    one-degree tile through the shared Overpass tile cache (see osmTiles.ts) as the map is panned. ODbL.
 */

const PLANTS_URL =
  "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv";
const PLANTS_CACHE = join(CACHE_ROOT, "power", "plants.json");
const PLANTS_TTL_MS = 30 * 86_400_000;
const MIN_PLANT_MW = 100;

// [name, lat, lon, megawatts, fuel, country, owner, commissioned year (0 = unknown), url]
export type PlantRow = [string, number, number, number, string, string, string, number, string];

/** One CSV line into fields, honouring "quoted, fields" and doubled quotes. */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function downloadPlants(): Promise<PlantRow[]> {
  const res = await fetch(PLANTS_URL, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`Power plant database HTTP ${res.status}`);
  const lines = (await res.text()).split(/\r?\n/);
  const head = csvFields(lines[0] ?? "");
  const at = (n: string): number => head.indexOf(n);
  const iName = at("name");
  const iMw = at("capacity_mw");
  const iLat = at("latitude");
  const iLon = at("longitude");
  const iFuel = at("primary_fuel");
  const iCountry = at("country_long");
  const iOwner = at("owner");
  const iYear = at("commissioning_year");
  const iUrl = at("url");
  if ([iName, iMw, iLat, iLon, iFuel].some((i) => i < 0)) throw new Error("Power plant database format changed");
  const rows: PlantRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvFields(lines[i]!);
    const mw = Number(f[iMw]);
    const lat = Number(f[iLat]);
    const lon = Number(f[iLon]);
    if (!Number.isFinite(mw) || mw < MIN_PLANT_MW || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const url = f[iUrl] ?? "";
    rows.push([
      (f[iName] ?? "").slice(0, 80),
      Math.round(lat * 1e4) / 1e4,
      Math.round(lon * 1e4) / 1e4,
      Math.round(mw),
      f[iFuel] ?? "Other",
      f[iCountry] ?? "",
      (f[iOwner] ?? "").slice(0, 70),
      Math.round(Number(f[iYear])) || 0,
      /^https?:\/\//.test(url) ? url.slice(0, 160) : ""
    ]);
  }
  return rows;
}

let plantsMemory: PlantRow[] | null = null;
let plantsInflight: Promise<PlantRow[]> | null = null;

export function getPowerPlants(): Promise<PlantRow[]> {
  if (plantsMemory) return Promise.resolve(plantsMemory);
  plantsInflight ??= (async () => {
    try {
      const c = JSON.parse(await readFile(PLANTS_CACHE, "utf8")) as { at: number; rows: PlantRow[] };
      if (Date.now() - c.at < PLANTS_TTL_MS && c.rows.length) return (plantsMemory = c.rows);
    } catch {
      /* no cache yet */
    }
    try {
      const rows = await downloadPlants();
      await mkdir(dirname(PLANTS_CACHE), { recursive: true });
      await writeFile(PLANTS_CACHE, JSON.stringify({ at: Date.now(), rows }), "utf8");
      return (plantsMemory = rows);
    } catch (e) {
      // A stale copy beats nothing.
      try {
        const c = JSON.parse(await readFile(PLANTS_CACHE, "utf8")) as { rows: PlantRow[] };
        if (c.rows.length) return (plantsMemory = c.rows);
      } catch {
        /* nothing at all */
      }
      throw e;
    }
  })().finally(() => {
    plantsInflight = null;
  });
  return plantsInflight;
}

// ---------- Lines and substations (OpenStreetMap) ----------

// ["l", osmId, kV, name, operator, circuits, hvdc 0|1, [lon, lat, lon, lat ...]]
export type LineItem = ["l", number, number, string, string, number, number, number[]];
// ["s", osmId (negative for a way), lat, lon, kV, name, operator]
export type SubItem = ["s", number, number, number, number, string, string];
type PowerItem = LineItem | SubItem;

type El = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

/** Highest voltage in a tag like "220000;110000", in kV (0 when unreadable). */
export function maxKv(v: string | undefined): number {
  if (!v) return 0;
  let best = 0;
  for (const part of v.split(";")) {
    const n = Number(part.trim());
    if (Number.isFinite(n) && n > best) best = n;
  }
  return Math.round(best / 1000);
}

export function parsePower(elements: unknown[]): PowerItem[] {
  const out: PowerItem[] = [];
  for (const raw of elements) {
    const el = raw as El;
    const t = el.tags ?? {};
    const kv = maxKv(t.voltage);
    if (kv < 200) continue;
    const name = (t.name ?? t.ref ?? "").slice(0, 70);
    const op = (t.operator ?? "").slice(0, 70);
    if (t.power === "line" && el.type === "way" && el.geometry && el.geometry.length > 1) {
      // Keep the shape but drop vertices that sit on top of each other (about 300 m apart is plenty at map scale).
      const pts: number[] = [];
      let lx = 1e9;
      let ly = 1e9;
      el.geometry.forEach((g, i, a) => {
        const dx = g.lon - lx;
        const dy = g.lat - ly;
        if (i === 0 || i === a.length - 1 || dx * dx + dy * dy > 9e-6) {
          pts.push(Math.round(g.lon * 1e4) / 1e4, Math.round(g.lat * 1e4) / 1e4);
          lx = g.lon;
          ly = g.lat;
        }
      });
      const hvdc = t.frequency === "0" || /dc/i.test(t["line:type"] ?? "") ? 1 : 0;
      out.push(["l", el.id, kv, name, op, Number(t.circuits) || 0, hvdc, pts]);
    } else if (t.power === "substation") {
      let lat = el.lat;
      let lon = el.lon;
      if ((lat == null || lon == null) && el.geometry?.length) {
        lat = el.geometry.reduce((s, g) => s + g.lat, 0) / el.geometry.length;
        lon = el.geometry.reduce((s, g) => s + g.lon, 0) / el.geometry.length;
      }
      if (lat == null || lon == null) continue;
      out.push(["s", el.type === "way" ? -el.id : el.id, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, kv, name, op]);
    }
  }
  return out;
}

// >= 200 kV only: the backbone of the grid, not every street cable. Voltage tags are in volts, possibly "a;b".
const KV = `(^|;)([2-9][0-9]{5}|[0-9]{7,})($|;)`;
const store = createTileStore<PowerItem>({
  dir: "power1",
  ttlMs: 14 * 86_400_000,
  query: (s, w, n, e) =>
    `[out:json][timeout:55][bbox:${s},${w},${n},${e}];(way["power"="line"]["voltage"~"${KV}"];node["power"="substation"]["voltage"~"${KV}"];way["power"="substation"]["voltage"~"${KV}"];);out geom tags;`,
  parse: parsePower
});

export type PowerGridResult = {
  lines: LineItem[];
  substations: SubItem[];
  tilesTotal: number;
  tilesPending: number;
  tilesFailed: number;
};

export async function queryPowerGrid(
  west: number,
  south: number,
  east: number,
  north: number
): Promise<PowerGridResult | "too-wide"> {
  const got = await collectTiles(store, west, south, east, north, 16);
  if (got === "too-wide") return got;
  const lines: LineItem[] = [];
  const substations: SubItem[] = [];
  const seen = new Set<string>();
  // A line crossing a tile edge is stored in both tiles; show it once.
  for (const it of got.items) {
    const key = `${it[0]}${it[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (it[0] === "l") lines.push(it);
    else substations.push(it);
  }
  return { lines, substations, tilesTotal: got.total, tilesPending: got.pending, tilesFailed: got.failed };
}

