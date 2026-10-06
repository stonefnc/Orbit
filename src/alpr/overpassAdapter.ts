import type { AlprDataAdapter, AlprDataset, AlprSite } from "./alprTypes";

/** Default query: ~600 km radius from SF (edit `public/data/alpr-overpass-example.ql` or env). */
export const DEFAULT_OVERPASS_ALPR_QUERY = `[out:json][timeout:90];
(
  node["surveillance:type"="ALPR"](around:600000,37.78,-122.42);
);
out body;`;

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

function resolveUrl(pathOrUrl: string): string {
  const t = pathOrUrl.trim();
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  return `${import.meta.env.BASE_URL}${t.replace(/^\//, "")}`.replace(/\/{2,}/g, "/");
}

function parseDirectionBearing(tags: Record<string, string>): number | null {
  const keys = ["direction", "camera:direction", "bearing", "surveillance:direction"];
  for (const k of keys) {
    const raw = tags[k]?.trim();
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 360) return n;
  }
  return null;
}

function tagsToNotes(tags: Record<string, string>): string | undefined {
  const parts: string[] = [];
  const want = ["surveillance", "camera:type", "fixme", "description", "ref"];
  for (const k of want) {
    const v = tags[k];
    if (v) parts.push(`${k}=${v}`);
  }
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * Loads ALPR nodes from an [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) interpreter
 * using OSM tags such as [`surveillance:type=ALPR`](https://wiki.openstreetmap.org/wiki/Tag:surveillance:type%3DALPR).
 *
 * **License:** OpenStreetMap data is © OpenStreetMap contributors, **ODbL**. Attribute OSM on any public
 * map or derivative; see [copyright](https://www.openstreetmap.org/copyright).
 */
export function overpassJsonToDataset(data: unknown): AlprDataset {
  if (!data || typeof data !== "object") {
    return {
      sites: [],
      attribution: "OpenStreetMap (Overpass) — parse error",
      licenseNote: "https://www.openstreetmap.org/copyright"
    };
  }
  const elements = (data as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) {
    return {
      sites: [],
      attribution: "OpenStreetMap (Overpass) — empty response",
      licenseNote: "https://www.openstreetmap.org/copyright"
    };
  }

  const sites: AlprSite[] = [];
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const el = raw as OverpassElement;
    if (el.type !== "node") continue;
    if (typeof el.lat !== "number" || typeof el.lon !== "number") continue;
    const tags = el.tags ?? {};
    if (tags["surveillance:type"] !== "ALPR") continue;

    const bearing = parseDirectionBearing(tags);
    sites.push({
      id: `osm-node-${el.id}`,
      latitude: el.lat,
      longitude: el.lon,
      name: tags.name,
      source: "OpenStreetMap (ODbL) · Overpass export",
      vendor: tags.operator ?? tags.manufacturer ?? tags.brand,
      region: tags["addr:state"] ?? tags["addr:province"],
      confidence: "unknown",
      bearingDeg: bearing,
      notes: tagsToNotes(tags)
    });
  }

  return {
    sites,
    attribution:
      "© OpenStreetMap contributors — data available under the Open Database License (ODbL). Retrieved via Overpass API.",
    licenseNote:
      "https://www.openstreetmap.org/copyright — follow ODbL when combining or republishing; do not imply OSM endorses your deployment."
  };
}

export type OverpassAdapterOptions = {
  /** POST target, e.g. `/overpass-proxy/api/interpreter` (dev) or `https://overpass-api.de/api/interpreter`. */
  interpreterUrl: string;
  /** Inline Overpass QL (optional if `queryUrl` set). */
  query?: string;
  /** Fetch QL from this URL (e.g. `/data/alpr-overpass-example.ql`). */
  queryUrl?: string;
};

/** POST Overpass QL and return parsed JSON (caller runs `overpassJsonToDataset`). */
export async function postOverpassQl(
  interpreterUrl: string,
  query: string,
  signal?: AbortSignal
): Promise<unknown> {
  const res = await fetch(interpreterUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: `data=${encodeURIComponent(query)}`,
    signal
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Overpass HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as unknown;
}

export class OverpassInterpreterAdapter implements AlprDataAdapter {
  readonly kind = "overpass";

  constructor(private readonly opts: OverpassAdapterOptions) {}

  async load(): Promise<AlprDataset> {
    let q = this.opts.query?.trim();
    if (!q && this.opts.queryUrl) {
      const res = await fetch(resolveUrl(this.opts.queryUrl));
      if (!res.ok) throw new Error(`Overpass query file HTTP ${res.status}`);
      q = await res.text();
    }
    if (!q) q = DEFAULT_OVERPASS_ALPR_QUERY;

    const data = await postOverpassQl(this.opts.interpreterUrl, q);
    return overpassJsonToDataset(data);
  }
}
