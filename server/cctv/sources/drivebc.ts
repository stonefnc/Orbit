import type { CctvCamera, CctvSource } from "../types";
import { headingFromDirection, validLatLon } from "../geo";
import { getJson } from "./http";

type Cam = {
  id?: number;
  name?: string;
  caption?: string;
  highway_display?: string;
  region_name?: string;
  orientation?: string;
  is_on?: boolean;
  marked_stale?: boolean;
  update_period_mean?: number;
  location?: { coordinates?: [number, number] };
};

export const driveBcSource: CctvSource = {
  id: "drivebc",
  label: "British Columbia (DriveBC)",
  agency: "DriveBC (Government of British Columbia)",
  country: "Canada",
  license: "Open Government Licence – British Columbia — attribution required.",
  attribution: "DriveBC. Contains information licensed under the Open Government Licence – British Columbia.",
  ttlMs: 6 * 60 * 60_000,
  coverage: [[-139.1, 48.2, -114.0, 60.1]],
  allow: [{ host: "www.drivebc.ca", pathPrefix: "/images/" }],
  async load() {
    const cams = await getJson<Cam[]>("drivebc", "https://www.drivebc.ca/api/webcams/", 45_000);
    const out: CctvCamera[] = [];
    for (const c of cams) {
      if (c.id == null || c.is_on === false || c.marked_stale) continue;
      const [lon, lat] = c.location?.coordinates ?? [];
      if (!validLatLon(lat, lon)) continue;
      const heading = headingFromDirection(c.orientation);
      out.push({
        id: `drivebc:${c.id}`,
        name: (c.name ?? "").trim() || `DriveBC camera ${c.id}`,
        lat: lat!,
        lon: lon!,
        source: "drivebc",
        agency: "DriveBC",
        country: "Canada",
        region: "British Columbia",
        city: c.region_name?.trim() || undefined,
        roadway: c.highway_display ? `Hwy ${c.highway_display}` : undefined,
        description: c.caption?.trim() || undefined,
        headingDeg: heading,
        headingKind: heading == null ? "unknown" : "facing",
        frameUrl: `https://www.drivebc.ca/images/${c.id}.jpg`,
        refreshSec: Math.max(60, Math.round(c.update_period_mean ?? 900)),
        pageUrl: "https://www.drivebc.ca/"
      });
    }
    return out;
  }
};
