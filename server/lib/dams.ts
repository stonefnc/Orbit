import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CACHE_ROOT } from "./paths";

/**
 * Notable dams worldwide: every dam on Wikidata that has an English Wikipedia article, with its coordinates and (when
 * known) height, river, country and year built. Fetched once from the public Wikidata Query Service and kept on disk
 * for 30 days. Data is CC0 (Wikidata); links go to Wikipedia.
 */
export type Dam = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  heightM?: number;
  river?: string;
  country?: string;
  year?: number;
  wiki?: string;
};

const CACHE_FILE = join(CACHE_ROOT, "dams", "dams.json");
const TTL_MS = 30 * 24 * 3_600_000;

const SPARQL = `SELECT ?d ?dLabel ?coord ?height ?inception ?riverLabel ?countryLabel ?a WHERE {
  ?d wdt:P31/wdt:P279* wd:Q12323; wdt:P625 ?coord.
  ?a schema:about ?d; schema:isPartOf <https://en.wikipedia.org/>.
  OPTIONAL { ?d wdt:P2048 ?height }
  OPTIONAL { ?d wdt:P571 ?inception }
  OPTIONAL { ?d wdt:P177 ?river }
  OPTIONAL { ?d wdt:P17 ?country }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 12000`;

let memory: Dam[] | null = null;
let loading: Promise<Dam[]> | null = null;

type Binding = Record<string, { value: string } | undefined>;

async function fetchDams(): Promise<Dam[]> {
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(SPARQL)}`, {
    headers: {
      "User-Agent": "Orbit/1.0 (https://github.com/runna5k/Orbit; personal project)",
      Accept: "application/sparql-results+json"
    },
    signal: AbortSignal.timeout(110_000)
  });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  const j = JSON.parse(await res.text()) as { results: { bindings: Binding[] } };
  const byId = new Map<string, Dam>();
  for (const b of j.results.bindings) {
    const qid = b.d?.value.split("/").pop();
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value ?? "");
    const name = b.dLabel?.value;
    if (!qid || !m || !name || /^Q\d+$/.test(name)) continue;
    const lon = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const cur = byId.get(qid) ?? { id: qid, name, lat, lon };
    const h = Number(b.height?.value);
    if (Number.isFinite(h) && h > 0 && h < 600) cur.heightM = Math.max(cur.heightM ?? 0, h);
    const y = Number((b.inception?.value ?? "").slice(0, 4));
    if (Number.isFinite(y) && y > 1000) cur.year = y;
    if (b.riverLabel?.value && !/^Q\d+$/.test(b.riverLabel.value)) cur.river ??= b.riverLabel.value;
    if (b.countryLabel?.value && !/^Q\d+$/.test(b.countryLabel.value)) cur.country ??= b.countryLabel.value;
    if (b.a?.value && /^https:\/\/en\.wikipedia\.org\//.test(b.a.value)) cur.wiki = b.a.value;
    byId.set(qid, cur);
  }
  return [...byId.values()];
}

export function getDams(): Promise<Dam[]> {
  if (memory) return Promise.resolve(memory);
  loading ??= (async () => {
    try {
      const c = JSON.parse(await readFile(CACHE_FILE, "utf8")) as { at: number; dams: Dam[] };
      if (Date.now() - c.at < TTL_MS && c.dams.length) {
        memory = c.dams;
        return memory;
      }
    } catch {
      /* no cache yet */
    }
    const dams = await fetchDams();
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ at: Date.now(), dams }), "utf8");
    memory = dams;
    return dams;
  })().finally(() => {
    loading = null;
  });
  return loading;
}
