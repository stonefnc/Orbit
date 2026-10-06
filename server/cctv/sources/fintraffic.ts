import type { CctvCamera, CctvSource } from "../types";
import { validLatLon } from "../geo";
import { fetchJson, ProviderHttpError } from "../../lib/fetchUtil";
import { CCTV_UA } from "./http";

const USER = "Orbit";
const STATIONS_URL = "https://tie.digitraffic.fi/api/weathercam/v1/stations";

type Station = {
  geometry?: { coordinates?: [number, number, number?] };
  properties?: {
    id?: string;
    name?: string;
    collectionStatus?: string;
    presets?: Array<{ id?: string; inCollection?: boolean }>;
  };
};

/** "kt51_Inkoo" -> "kt51 Inkoo" */
function stationLabel(raw: string | undefined, stationId: string): string {
  const t = (raw ?? "").replace(/_/g, " ").trim();
  return t || `Station ${stationId}`;
}

export const fintrafficSource: CctvSource = {
  id: "fintraffic",
  label: "Finland (Fintraffic road weather)",
  agency: "Fintraffic",
  country: "Finland",
  license: "Fintraffic / digitraffic.fi, CC BY 4.0 — attribution required.",
  attribution: "Fintraffic / digitraffic.fi, license CC BY 4.0",
  ttlMs: 12 * 60 * 60_000,
  coverage: [[19, 59.5, 32, 70.2]],
  allow: [{ host: "weathercam.digitraffic.fi" }],
  frameHeaders: { "Digitraffic-User": USER },
  async load() {
    const { ok, status, data, retryAfterSec } = await fetchJson<{ features?: Station[] }>(STATIONS_URL, {
      timeoutMs: 45_000,
      retries: 1,
      headers: { "User-Agent": CCTV_UA, "Digitraffic-User": USER }
    });
    if (!ok) throw new ProviderHttpError("fintraffic", status, retryAfterSec);
    const out: CctvCamera[] = [];
    for (const f of data?.features ?? []) {
      const p = f.properties;
      const stationId = p?.id?.trim();
      if (!p || !stationId || p.collectionStatus?.toUpperCase() !== "GATHERING") continue;
      const lon = f.geometry?.coordinates?.[0];
      const lat = f.geometry?.coordinates?.[1];
      if (!validLatLon(lat, lon)) continue;
      for (const preset of p.presets ?? []) {
        const presetId = preset.id?.trim() ?? "";
        // Frame URLs are built from a strictly validated id, never copied from the payload.
        if (preset.inCollection !== true || !/^C\d{7}$/.test(presetId) || !presetId.startsWith(stationId)) continue;
        out.push({
          id: `fintraffic:${presetId}`,
          name: `${stationLabel(p.name, stationId)} · view ${presetId.slice(-2)}`,
          lat,
          lon: lon!,
          source: "fintraffic",
          agency: "Fintraffic",
          country: "Finland",
          region: "Finland",
          roadway: stationLabel(p.name, stationId).split(" ")[0],
          description: "Road weather camera",
          headingDeg: null,
          headingKind: "unknown",
          frameUrl: `https://weathercam.digitraffic.fi/${presetId}.jpg`,
          refreshSec: 600,
          pageUrl: "https://liikennetilanne.fintraffic.fi/"
        });
      }
    }
    return out;
  }
};
