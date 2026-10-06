import type { CctvCamera, CctvSource } from "../types";
import { validLatLon } from "../geo";
import { getJson } from "./http";

type Row = {
  camera_url?: { url?: string; description?: string };
  camera_location?: string;
  quadrant?: string;
  point?: { coordinates?: [number, number] };
};

export const calgarySource: CctvSource = {
  id: "calgary",
  label: "Calgary (City of Calgary)",
  agency: "City of Calgary",
  country: "Canada",
  license: "Open Government Licence – City of Calgary — attribution required.",
  attribution: "Contains information licensed under the Open Government Licence – City of Calgary.",
  ttlMs: 12 * 60 * 60_000,
  coverage: [[-114.5, 50.8, -113.7, 51.3]],
  allow: [{ host: "trafficcam.calgary.ca" }],
  async load() {
    const rows = await getJson<Row[]>("calgary", "https://data.calgary.ca/resource/k7p9-kppz.json?$limit=1000");
    const out: CctvCamera[] = [];
    for (const r of rows) {
      const [lon, lat] = r.point?.coordinates ?? [];
      const raw = r.camera_url?.url?.trim();
      if (!raw || !validLatLon(lat, lon)) continue;
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        continue;
      }
      if (url.hostname !== "trafficcam.calgary.ca") continue;
      url.protocol = "https:"; // the dataset publishes http:// links; the host serves https
      const id = url.pathname.replace(/^\/+|\.jpe?g$/gi, "").replace(/[^a-z0-9_-]/gi, "");
      if (!id) continue;
      out.push({
        id: `calgary:${id}`,
        name: (r.camera_location ?? "").trim() || r.camera_url?.description || `Calgary ${id}`,
        lat: lat!,
        lon: lon!,
        source: "calgary",
        agency: "City of Calgary",
        country: "Canada",
        region: "Alberta",
        city: "Calgary",
        description: r.quadrant ? `${r.quadrant} quadrant` : undefined,
        headingDeg: null,
        headingKind: "unknown",
        frameUrl: url.href,
        refreshSec: 60,
        pageUrl: "https://www.calgary.ca/roads/traffic-cameras.html"
      });
    }
    return out;
  }
};
