import type { CctvCamera, CctvSource } from "../types";
import { headingFromDirection, validLatLon } from "../geo";
import { getJson } from "./http";

/**
 * NZ Transport Agency (Waka Kotahi) traffic cameras: the camera list the agency's own journey-planner map uses, a
 * GeoJSON file, with one still per camera at a fixed address. This is the site's own map data, not the registered
 * developer API (which needs an account), so it can change without notice.
 */
const LIST_URL = "https://www.journeys.nzta.govt.nz/assets/map-data-cache/cameras.json";
const FRAME_HOST = "www.trafficnz.info";

type Feature = {
  properties?: {
    ExternalId?: number | string;
    Name?: string;
    Description?: string;
    Offline?: number | string;
    UnderMaintenance?: number | string;
    ImageUrl?: string;
    Latitude?: string | number;
    Longitude?: string | number;
    Direction?: string;
  };
  geometry?: { coordinates?: [number, number] };
};

/** Pure parser (exported for tests). Offline cameras are skipped; frame URLs must be https on the agency's host. */
export function parseNewZealandCameras(data: { features?: Feature[] } | null | undefined): CctvCamera[] {
  const out: CctvCamera[] = [];
  for (const f of data?.features ?? []) {
    const p = f.properties;
    if (!p) continue;
    const id = String(p.ExternalId ?? "").trim();
    if (!/^\d{1,8}$/.test(id)) continue;
    if (Number(p.Offline) === 1 || Number(p.UnderMaintenance) === 1) continue;
    const lon = Number(f.geometry?.coordinates?.[0] ?? p.Longitude);
    const lat = Number(f.geometry?.coordinates?.[1] ?? p.Latitude);
    if (!validLatLon(lat, lon)) continue;
    let url: URL;
    try {
      url = new URL(p.ImageUrl ?? "");
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.hostname !== FRAME_HOST) continue;
    const heading = headingFromDirection(p.Direction);
    out.push({
      id: `nz:${id}`,
      name: (p.Name ?? "").trim() || `Camera ${id}`,
      lat,
      lon,
      source: "nz",
      agency: "NZ Transport Agency Waka Kotahi",
      country: "New Zealand",
      region: "New Zealand",
      description: p.Description?.trim() || undefined,
      headingDeg: heading,
      headingKind: heading == null ? "unknown" : "traffic-direction",
      frameUrl: url.href,
      refreshSec: 60,
      pageUrl: "https://www.journeys.nzta.govt.nz/traffic/cameras"
    });
  }
  return out;
}

export const newZealandSource: CctvSource = {
  id: "nz",
  label: "New Zealand (NZTA)",
  agency: "NZ Transport Agency Waka Kotahi",
  country: "New Zealand",
  license:
    "NZ Transport Agency Waka Kotahi traffic camera images (the agency publishes its traffic data openly, reported as CC BY 4.0; not re-read on the agency's own page, so verify before launch). Attribution required.",
  attribution: "NZ Transport Agency Waka Kotahi · journeys.nzta.govt.nz",
  ttlMs: 6 * 60 * 60_000,
  coverage: [[165.8, -47.5, 179, -33.9]],
  allow: [{ host: FRAME_HOST }],
  async load() {
    return parseNewZealandCameras(await getJson<{ features?: Feature[] }>("nz", LIST_URL, 45_000));
  }
};
