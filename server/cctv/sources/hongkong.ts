import type { CctvCamera, CctvSource } from "../types";
import { validLatLon } from "../geo";
import { fetchText, ProviderHttpError } from "../../lib/fetchUtil";
import { CCTV_UA } from "./http";

/**
 * Hong Kong Transport Department "Traffic Snapshot Images" (data.gov.hk): about 1,000 road cameras, a still that the
 * department refreshes about every 2 minutes at a fixed address per camera. The camera list is one small XML file.
 */
const LIST_URL = "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml";
const FRAME_HOST = "tdcctv.data.one.gov.hk";

const tag = (block: string, name: string): string => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return (m?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
};

/** Pure parser (exported for tests). Frame URLs must be https on the department's image host and use a plain key. */
export function parseHongKongCameras(xml: string): CctvCamera[] {
  const out: CctvCamera[] = [];
  for (const m of xml.matchAll(/<image>([\s\S]*?)<\/image>/g)) {
    const block = m[1]!;
    const key = tag(block, "key");
    const lat = Number(tag(block, "latitude"));
    const lon = Number(tag(block, "longitude"));
    if (!/^[A-Za-z0-9]{2,12}$/.test(key) || !validLatLon(lat, lon)) continue;
    let url: URL;
    try {
      url = new URL(tag(block, "url"));
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.hostname !== FRAME_HOST) continue;
    const description = tag(block, "description").replace(/\s*\[[A-Za-z0-9]+\]\s*$/, "");
    const district = tag(block, "district");
    out.push({
      id: `hk:${key}`,
      name: description || `Camera ${key}`,
      lat,
      lon,
      source: "hk",
      agency: "Transport Department, Hong Kong",
      country: "Hong Kong",
      region: tag(block, "region") || "Hong Kong",
      city: district || undefined,
      description: "Traffic snapshot camera",
      headingDeg: null,
      headingKind: "unknown",
      frameUrl: url.href,
      refreshSec: 120,
      pageUrl: "https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images"
    });
  }
  return out;
}

export const hongKongSource: CctvSource = {
  id: "hk",
  label: "Hong Kong (Transport Department)",
  agency: "Transport Department, Hong Kong",
  country: "Hong Kong",
  license:
    "Traffic Snapshot Images, published on data.gov.hk by the Hong Kong Transport Department (no licence text on the dataset page, checked 2026-10-06). Attribution given.",
  attribution: "Transport Department, Hong Kong SAR · data.gov.hk",
  ttlMs: 12 * 60 * 60_000,
  coverage: [[113.8, 22.1, 114.5, 22.6]],
  allow: [{ host: FRAME_HOST }],
  async load() {
    const { ok, status, text, retryAfterSec } = await fetchText(LIST_URL, {
      timeoutMs: 45_000,
      retries: 1,
      headers: { "User-Agent": CCTV_UA, Accept: "application/xml,text/xml,*/*" }
    });
    if (!ok) throw new ProviderHttpError("hk", status, retryAfterSec);
    return parseHongKongCameras(text);
  }
};
