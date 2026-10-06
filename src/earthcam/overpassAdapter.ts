import type { EarthCamCamera, EarthCamDataset } from "./earthcamTypes";

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

const OSM_ATTRIBUTION =
  "© OpenStreetMap contributors — EarthCam webcams mapped in OSM (ODbL). Retrieved via Overpass API.";
const OSM_LICENSE = "https://www.openstreetmap.org/copyright";

function elementLatLon(el: OverpassElement): { lat: number; lon: number } | null {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lon: el.lon };
  }
  const c = el.center;
  if (c && typeof c.lat === "number" && typeof c.lon === "number") {
    return { lat: c.lat, lon: c.lon };
  }
  return null;
}

function tag(tags: Record<string, string>, key: string): string | undefined {
  const v = tags[key]?.trim();
  return v || undefined;
}

function normalizeHttpUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t.includes("://") ? t : `https://${t}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Prefer a direct earthcam.com page URL from OSM tags. */
export function pickEarthcamPageUrl(tags: Record<string, string>): string | null {
  const keys = ["contact:webcam", "website", "url", "contact:website"] as const;
  for (const k of keys) {
    const v = tag(tags, k);
    if (!v) continue;
    const url = normalizeHttpUrl(v);
    if (url && /earthcam\.com/i.test(url)) return url;
  }
  return null;
}

function isEarthcamOsmElement(el: OverpassElement): boolean {
  const tags = el.tags ?? {};
  if (pickEarthcamPageUrl(tags)) return true;
  return /earthcam/i.test(tag(tags, "operator") ?? "");
}

function inferCategory(tags: Record<string, string>): string | undefined {
  return (
    tag(tags, "surveillance:zone") ??
    tag(tags, "tourism") ??
    tag(tags, "camera:type") ??
    tag(tags, "man_made") ??
    "webcam"
  );
}

function inferLocation(tags: Record<string, string>): {
  city?: string;
  region?: string;
  country?: string;
} {
  return {
    city: tag(tags, "addr:city") ?? tag(tags, "is_in:city") ?? tag(tags, "addr:place"),
    region: tag(tags, "addr:state") ?? tag(tags, "is_in:state"),
    country: tag(tags, "addr:country") ?? tag(tags, "is_in:country")
  };
}

function tagsToNotes(tags: Record<string, string>): string | undefined {
  const parts: string[] = [];
  for (const k of ["description", "fixme", "surveillance:zone", "camera:direction", "ref"]) {
    const v = tag(tags, k);
    if (v) parts.push(`${k}=${v}`);
  }
  const osmType = tags["@type"];
  if (osmType) parts.push(`osm=${osmType}`);
  return parts.length ? parts.join(" · ") : undefined;
}

function cameraIdForElement(el: OverpassElement): string {
  return `osm-${el.type}-${el.id}`;
}

function elementToCamera(el: OverpassElement): EarthCamCamera | null {
  if (el.type !== "node" && el.type !== "way" && el.type !== "relation") return null;
  if (!isEarthcamOsmElement(el)) return null;

  const tags = el.tags ?? {};
  const ll = elementLatLon(el);
  if (!ll) return null;

  const pageUrl = pickEarthcamPageUrl(tags);
  if (!pageUrl) return null;

  const loc = inferLocation(tags);
  const name =
    tag(tags, "name") ??
    tag(tags, "description") ??
    tag(tags, "ref") ??
    `EarthCam · OSM ${el.type}/${el.id}`;

  const thumb = tag(tags, "image") ?? tag(tags, "thumbnail");
  const streamUrl = tag(tags, "contact:webcam");
  const streamNorm = streamUrl ? normalizeHttpUrl(streamUrl) : null;

  return {
    id: cameraIdForElement(el),
    name,
    latitude: ll.lat,
    longitude: ll.lon,
    city: loc.city,
    region: loc.region,
    country: loc.country,
    category: inferCategory(tags),
    thumbnail: thumb && normalizeHttpUrl(thumb) ? normalizeHttpUrl(thumb)! : undefined,
    earthcamPageUrl: pageUrl,
    streamUrl: streamNorm ?? undefined,
    embedAllowed: false,
    status: "available",
    cameraSource: "earthcam-osm",
    notes: tagsToNotes(tags) ?? `osm=${el.type}/${el.id}`
  };
}

/**
 * Parse Overpass JSON into normalized EarthCam cameras from OSM webcam tags.
 */
export function overpassJsonToEarthcamDataset(data: unknown): EarthCamDataset {
  const empty: EarthCamDataset = {
    cameras: [],
    attribution: OSM_ATTRIBUTION,
    licenseNote: OSM_LICENSE,
    providerId: "osm-overpass"
  };

  if (!data || typeof data !== "object") return empty;
  const elements = (data as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return empty;

  const byId = new Map<string, EarthCamCamera>();
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const cam = elementToCamera(raw as OverpassElement);
    if (!cam) continue;
    byId.set(cam.id, cam);
  }

  return {
    cameras: [...byId.values()],
    attribution: OSM_ATTRIBUTION,
    licenseNote: OSM_LICENSE,
    providerId: "osm-overpass"
  };
}
