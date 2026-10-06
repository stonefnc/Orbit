import type { AlprDataAdapter, AlprDataset, AlprSite } from "./alprTypes";
import { parseConfidence } from "./alprTypes";

function pickStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNum(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function rowToSite(row: unknown, idx: number): AlprSite | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const lat = pickNum(o, ["latitude", "lat"]);
  const lon = pickNum(o, ["longitude", "lon", "lng"]);
  if (lat == null || lon == null) return null;
  const id = pickStr(o, ["id", "site_id", "siteId", "camera_id"]) ?? `site-${idx}`;
  return {
    id,
    latitude: lat,
    longitude: lon,
    name: pickStr(o, ["name", "label", "road"]),
    source: pickStr(o, ["source", "data_source"]) ?? "unspecified",
    vendor: pickStr(o, ["vendor", "operator"]),
    region: pickStr(o, ["region", "state", "area"]),
    confidence: parseConfidence(o.confidence ?? o.conf),
    bearingDeg: pickNum(o, ["bearing_deg", "bearingDeg", "heading_deg"]),
    fovDeg: pickNum(o, ["fov_deg", "fovDeg", "beam_width_deg"]),
    rangeMeters: pickNum(o, ["range_m", "rangeMeters", "range_meters"]),
    notes: pickStr(o, ["notes", "description"]),
    extra: o
  };
}

/**
 * `{ attribution, license?, sites: [ { lat, lon, ... } ] }`
 */
export class JsonSitesUrlAdapter implements AlprDataAdapter {
  readonly kind = "json-sites";

  constructor(private readonly url: string) {}

  async load(): Promise<AlprDataset> {
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`ALPR JSON bundle fetch HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    const attribution =
      (typeof data.attribution === "string" && data.attribution.trim()) ||
      "ALPR JSON bundle (set `attribution` in file).";
    const licenseNote =
      typeof data.license === "string"
        ? data.license
        : typeof data.license_note === "string"
          ? data.license_note
          : undefined;
    const rawSites = data.sites;
    if (!Array.isArray(rawSites)) {
      return { sites: [], attribution, licenseNote };
    }
    const sites: AlprSite[] = [];
    rawSites.forEach((row, idx) => {
      const s = rowToSite(row, idx);
      if (s) sites.push(s);
    });
    return { sites, attribution, licenseNote };
  }
}
