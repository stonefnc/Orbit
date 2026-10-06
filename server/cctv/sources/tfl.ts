import { isAllowedVideoUrl, type CctvCamera, type CctvSource } from "../types";
import { headingFromDirection, validLatLon } from "../geo";
import { getJson } from "./http";

type Place = {
  id?: string;
  commonName?: string;
  lat?: number;
  lon?: number;
  additionalProperties?: Array<{ key?: string; value?: string }>;
};

export const tflSource: CctvSource = {
  id: "tfl",
  label: "London (TfL JamCams)",
  agency: "Transport for London",
  country: "United Kingdom",
  license: "TfL Open Data — attribution required.",
  attribution: "Powered by TfL Open Data. Contains OS data © Crown copyright and database rights.",
  ttlMs: 12 * 60 * 60_000,
  coverage: [[-0.7, 51.2, 0.5, 51.8]],
  allow: [{ host: "s3-eu-west-1.amazonaws.com", pathPrefix: "/jamcams.tfl.gov.uk/" }],
  async load() {
    const places = await getJson<Place[]>("tfl", "https://api.tfl.gov.uk/Place/Type/JamCam", 45_000);
    const out: CctvCamera[] = [];
    for (const p of places) {
      const props = new Map((p.additionalProperties ?? []).map((a) => [a.key ?? "", a.value ?? ""]));
      const url = props.get("imageUrl")?.trim();
      if (!p.id || !url || props.get("available") === "false") continue;
      if (!validLatLon(p.lat, p.lon)) continue;
      const view = props.get("view") ?? "";
      const heading = headingFromDirection(view);
      out.push({
        id: `tfl:${p.id}`,
        name: (p.commonName ?? "").trim() || p.id,
        lat: p.lat!,
        lon: p.lon!,
        source: "tfl",
        agency: "Transport for London",
        country: "United Kingdom",
        region: "England",
        city: "London",
        description: view ? `Facing ${view}` : undefined,
        headingDeg: heading,
        headingKind: heading == null ? "unknown" : "facing",
        frameUrl: url,
        refreshSec: 120,
        pageUrl: "https://tfl.gov.uk/traffic/status/",
        ...(isAllowedVideoUrl(props.get("videoUrl"), "mp4")
          ? { videoUrl: props.get("videoUrl"), videoKind: "mp4" as const }
          : {})
      });
    }
    return out;
  }
};
