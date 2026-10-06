import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CACHE_ROOT } from "./paths";

/**
 * Battles with a known place and date, from Wikidata (CC0): every item that is a battle and has coordinates and a
 * "point in time" or "start time". Fetched once from the public Wikidata Query Service and cached for 30 days.
 * Dates are as recorded by Wikidata; for older battles that is often only the year (shown as 1 January).
 */
// [id, name, lat, lon, date "YYYY-MM-DD" (may start with "-" for BCE), endDate or "", conflict, wikipedia path]
export type Battle = [string, string, number, number, string, string, string, string];

const CACHE_FILE = join(CACHE_ROOT, "history", "battles.json");
const TTL_MS = 30 * 24 * 3_600_000;

const SPARQL = `SELECT ?b ?bLabel ?coord ?t ?end ?warLabel ?a WHERE {
  ?b wdt:P31/wdt:P279* wd:Q178561; wdt:P625 ?coord.
  OPTIONAL { ?b wdt:P585 ?pit }
  OPTIONAL { ?b wdt:P580 ?start }
  OPTIONAL { ?b wdt:P582 ?end }
  OPTIONAL { ?b wdt:P361 ?war }
  BIND(COALESCE(?pit, ?start) AS ?t)
  FILTER(BOUND(?t))
  OPTIONAL { ?a schema:about ?b; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 20000`;

let memory: Battle[] | null = null;
let loading: Promise<Battle[]> | null = null;

type Binding = Record<string, { value: string } | undefined>;

/** "+1944-06-06T00:00:00Z" -> "1944-06-06"; "-0490-09-12T00:00:00Z" -> "-490-09-12". */
function isoDate(v: string | undefined): string | null {
  const m = /^([+-]?)(\d{1,6})-(\d{2})-(\d{2})/.exec(v ?? "");
  if (!m) return null;
  const year = Number(m[2]);
  if (year > 2100) return null;
  return `${m[1] === "-" ? "-" : ""}${String(year).padStart(4, "0")}-${m[3]}-${m[4]}`;
}

async function fetchBattles(): Promise<Battle[]> {
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(SPARQL)}`, {
    headers: {
      "User-Agent": "Orbit/1.0 (https://github.com/runna5k/Orbit; personal project)",
      Accept: "application/sparql-results+json"
    },
    signal: AbortSignal.timeout(150_000)
  });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  const j = JSON.parse(await res.text()) as { results: { bindings: Binding[] } };
  const byId = new Map<string, Battle>();
  for (const b of j.results.bindings) {
    const qid = b.b?.value.split("/").pop();
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value ?? "");
    const name = b.bLabel?.value;
    const date = isoDate(b.t?.value);
    if (!qid || !m || !name || /^Q\d+$/.test(name) || !date) continue;
    const lon = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const war = b.warLabel?.value && !/^Q\d+$/.test(b.warLabel.value) ? b.warLabel.value : "";
    const wiki = b.a?.value.startsWith("https://en.wikipedia.org/wiki/") ? b.a.value.slice("https://en.wikipedia.org/wiki/".length) : "";
    const prev = byId.get(qid);
    if (prev) {
      // Keep the earliest date, and fill in a conflict or article if a later row has one.
      if (date < prev[4]) prev[4] = date;
      if (!prev[6] && war) prev[6] = war;
      if (!prev[7] && wiki) prev[7] = wiki;
      continue;
    }
    byId.set(qid, [
      qid,
      name.slice(0, 90),
      Math.round(lat * 1e4) / 1e4,
      Math.round(lon * 1e4) / 1e4,
      date,
      isoDate(b.end?.value) ?? "",
      war.slice(0, 80),
      wiki
    ]);
  }
  return [...byId.values()].sort((a, b) => (a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0));
}

export function getBattles(): Promise<Battle[]> {
  if (memory) return Promise.resolve(memory);
  loading ??= (async () => {
    try {
      const c = JSON.parse(await readFile(CACHE_FILE, "utf8")) as { at: number; battles: Battle[] };
      if (Date.now() - c.at < TTL_MS && c.battles.length) {
        memory = c.battles;
        return memory;
      }
    } catch {
      /* fetch below */
    }
    const battles = await fetchBattles();
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ at: Date.now(), battles }), "utf8");
    memory = battles;
    return battles;
  })().finally(() => {
    loading = null;
  });
  return loading;
}
