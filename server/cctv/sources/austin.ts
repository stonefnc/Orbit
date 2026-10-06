import type { CctvCamera, CctvSource } from "../types";
import { validLatLon } from "../geo";
import { getJson } from "./http";

type Row = {
  camera_id?: string;
  location_name?: string;
  primary_st?: string;
  cross_st?: string;
  screenshot_address?: string;
  location?: { coordinates?: [number, number] };
};

export const austinSource: CctvSource = {
  id: "austin",
  label: "Austin, TX (City of Austin)",
  agency: "City of Austin Transportation",
  country: "United States",
  license: "City of Austin Open Data Terms of Use.",
  attribution: "City of Austin, TX — data.austintexas.gov",
  ttlMs: 6 * 60 * 60_000,
  coverage: [[-98.3, 29.9, -97.3, 30.8]],
  allow: [{ host: "cctv.austinmobility.io", pathPrefix: "/image/" }],
  async load() {
    const where = encodeURIComponent("camera_status='TURNED_ON'");
    const rows = await getJson<Row[]>(
      "austin",
      `https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=3000&$where=${where}`
    );
    const out: CctvCamera[] = [];
    for (const r of rows) {
      const [lon, lat] = r.location?.coordinates ?? [];
      const url = r.screenshot_address?.trim();
      if (!r.camera_id || !url || !validLatLon(lat, lon)) continue;
      out.push({
        id: `austin:${r.camera_id}`,
        name: (r.location_name ?? "").trim() || `Austin camera ${r.camera_id}`,
        lat: lat!,
        lon: lon!,
        source: "austin",
        agency: "City of Austin",
        country: "United States",
        region: "Texas",
        city: "Austin",
        roadway: [r.primary_st, r.cross_st].map((s) => s?.trim()).filter(Boolean).join(" / ") || undefined,
        headingDeg: null,
        headingKind: "unknown",
        frameUrl: url,
        refreshSec: 30,
        pageUrl: "https://data.austintexas.gov/"
      });
    }
    return out;
  }
};
