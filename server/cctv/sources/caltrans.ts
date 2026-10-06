import { isAllowedVideoUrl, type CctvCamera, type CctvSource } from "../types";
import { headingFromDirection, validLatLon } from "../geo";
import { getJson, mapLimit } from "./http";

type Item = {
  cctv?: {
    index?: string;
    inService?: string;
    location?: {
      locationName?: string;
      nearbyPlace?: string;
      longitude?: string;
      latitude?: string;
      direction?: string;
      route?: string;
    };
    imageData?: {
      streamingVideoURL?: string;
      static?: { currentImageURL?: string; currentImageUpdateFrequency?: string };
    };
  };
};

function toCamera(district: number, it: Item): CctvCamera | null {
  const c = it.cctv;
  if (!c || c.inService !== "true") return null;
  const url = c.imageData?.static?.currentImageURL?.trim();
  const lat = Number(c.location?.latitude);
  const lon = Number(c.location?.longitude);
  if (!url || !validLatLon(lat, lon)) return null;
  const heading = headingFromDirection(c.location?.direction);
  const freqMin = Number(c.imageData?.static?.currentImageUpdateFrequency);
  return {
    id: `caltrans:d${district}-${c.index ?? url}`,
    name: (c.location?.locationName ?? "").trim() || `Caltrans camera ${c.index}`,
    lat,
    lon,
    source: "caltrans",
    agency: "Caltrans",
    country: "United States",
    region: "California",
    city: c.location?.nearbyPlace?.trim() || undefined,
    roadway: c.location?.route?.trim() || undefined,
    description: c.location?.direction ? `${c.location.direction} traffic` : undefined,
    headingDeg: heading,
    headingKind: heading == null ? "unknown" : "traffic-direction",
    frameUrl: url,
    refreshSec: Number.isFinite(freqMin) && freqMin > 0 ? Math.max(60, freqMin * 60) : 120,
    pageUrl: "https://cwwp2.dot.ca.gov/vm/iframemap.htm",
    ...(isAllowedVideoUrl(c.imageData?.streamingVideoURL, "hls")
      ? { videoUrl: c.imageData!.streamingVideoURL, videoKind: "hls" as const }
      : {})
  };
}

export const caltransSource: CctvSource = {
  id: "caltrans",
  label: "California (Caltrans)",
  agency: "Caltrans",
  country: "United States",
  license: "Public Caltrans traffic-camera data (cwwp2.dot.ca.gov).",
  attribution: "Caltrans — cwwp2.dot.ca.gov",
  ttlMs: 6 * 60 * 60_000,
  coverage: [[-124.6, 32.4, -114.0, 42.1]],
  allow: [{ host: "cwwp2.dot.ca.gov", pathPrefix: "/data/" }],
  async load() {
    const districts = Array.from({ length: 12 }, (_, i) => i + 1);
    const perDistrict = await mapLimit(districts, 4, async (d) => {
      const nn = String(d).padStart(2, "0");
      const json = await getJson<{ data?: Item[] }>("caltrans", `https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${nn}.json`);
      return (json.data ?? []).map((it) => toCamera(d, it)).filter((c): c is CctvCamera => c !== null);
    });
    return perDistrict.flat();
  }
};
