import type { EarthCamCamera, EarthCamDataset } from "../earthcamTypes";
import { getEarthcamLocationsApiUrl, getEarthcamNetworkApiUrl } from "../createEarthcamAdapter";
import type { EarthCamProvider } from "./earthcamProvider";

export type EarthcamNetworkPlace = {
  name?: string;
  url?: string;
  posn?: [string, string];
  id?: string;
  thumbnail?: string;
  location?: string;
  city?: string;
  state?: string | null;
  country?: string;
  place_type?: string;
};

const CATALOG_ATTRIBUTION =
  "Camera locations © EarthCam (public map feeds: network + locations). Streams require EarthCam licensing — outbound links only.";

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizePageUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    let href = u.href;
    if (href.endsWith("/")) href = href.slice(0, -1);
    return href.toLowerCase();
  } catch {
    return raw.trim().toLowerCase().replace(/\/$/, "");
  }
}

function dedupeKey(cam: EarthCamCamera): string {
  const url = normalizePageUrl(cam.earthcamPageUrl);
  if (url) return `url:${url}`;
  return `pos:${cam.name.toLowerCase()}|${cam.latitude.toFixed(5)}|${cam.longitude.toFixed(5)}`;
}

function slugFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    return path.replace(/[^a-z0-9]+/gi, "-").slice(0, 48) || "cam";
  } catch {
    return "cam";
  }
}

/** Extract `places` from either network or locations map-search JSON shape. */
export function extractEarthcamPlaces(json: unknown): EarthcamNetworkPlace[] {
  if (!json) return [];
  if (Array.isArray(json)) {
    const first = json[0] as { places?: EarthcamNetworkPlace[] } | undefined;
    return Array.isArray(first?.places) ? first.places : [];
  }
  if (typeof json !== "object") return [];
  const root = json as { data?: Array<{ places?: EarthcamNetworkPlace[] }> };
  const places = root.data?.[0]?.places;
  return Array.isArray(places) ? places : [];
}

export function placesToEarthcamCameras(
  places: EarthcamNetworkPlace[],
  cameraSource: string,
  idPrefix: string
): EarthCamCamera[] {
  const cameras: EarthCamCamera[] = [];
  for (const p of places) {
    const lat = num(p.posn?.[0]);
    const lon = num(p.posn?.[1]);
    const pageUrl = p.url?.trim();
    const name = p.name?.trim();
    if (lat == null || lon == null || !pageUrl || !name) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const id = p.id?.trim()
      ? `${idPrefix}-${p.id.trim()}`
      : `${idPrefix}-${slugFromUrl(pageUrl)}`;

    cameras.push({
      id,
      name,
      latitude: lat,
      longitude: lon,
      city: p.city?.trim() || undefined,
      region: p.state?.trim() || undefined,
      country: p.country?.trim() || undefined,
      category: p.place_type?.trim() || "webcam",
      thumbnail: p.thumbnail?.trim() || undefined,
      earthcamPageUrl: pageUrl,
      embedAllowed: false,
      status: "live",
      cameraSource,
      notes: p.location?.trim() || undefined
    });
  }
  return cameras;
}

export function mergeEarthcamCatalogCameras(cameras: EarthCamCamera[]): EarthCamCamera[] {
  const byKey = new Map<string, EarthCamCamera>();
  for (const cam of cameras) {
    const key = dedupeKey(cam);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, cam);
      continue;
    }
    if (existing.cameraSource === "earthcam-locations" && cam.cameraSource === "earthcam-network") {
      byKey.set(key, cam);
    }
  }
  return [...byKey.values()];
}

/**
 * Parse EarthCam's public network location feed (map search API).
 * ~280 global sites with direct page URLs and coordinates.
 */
export function parseEarthcamNetworkPayload(json: unknown): EarthCamDataset {
  const places = extractEarthcamPlaces(json);
  return {
    cameras: placesToEarthcamCameras(places, "earthcam-network", "ecn"),
    providerId: "earthcam-network",
    attribution: CATALOG_ATTRIBUTION,
    licenseNote: "https://www.earthcam.com/"
  };
}

/** Secondary EarthCam map feed — overlaps little with network; adds myearthcam.com hosts. */
export function parseEarthcamLocationsPayload(json: unknown): EarthCamDataset {
  const places = extractEarthcamPlaces(json);
  return {
    cameras: placesToEarthcamCameras(places, "earthcam-locations", "ecl"),
    providerId: "earthcam-locations",
    attribution: CATALOG_ATTRIBUTION,
    licenseNote: "https://www.earthcam.com/"
  };
}

/**
 * LicensedEarthCamProvider / backend relay can replace this client-side fetch later.
 */
export class EarthcamNetworkProvider implements EarthCamProvider {
  readonly kind = "earthcam-network";

  constructor(
    private readonly networkApiUrl = getEarthcamNetworkApiUrl(),
    private readonly locationsApiUrl = getEarthcamLocationsApiUrl()
  ) {}

  async load(): Promise<EarthCamDataset> {
    const networkUrl = this.networkApiUrl.trim();
    const locationsUrl = this.locationsApiUrl.trim();

    const [networkRes, locationsRes] = await Promise.allSettled([
      fetch(networkUrl).then(async (res) => {
        if (!res.ok) throw new Error(`EarthCam network API HTTP ${res.status} (${networkUrl})`);
        return res.json() as Promise<unknown>;
      }),
      fetch(locationsUrl).then(async (res) => {
        if (!res.ok) throw new Error(`EarthCam locations API HTTP ${res.status} (${locationsUrl})`);
        return res.json() as Promise<unknown>;
      })
    ]);

    const networkCameras =
      networkRes.status === "fulfilled"
        ? parseEarthcamNetworkPayload(networkRes.value).cameras
        : [];
    const locationsCameras =
      locationsRes.status === "fulfilled"
        ? parseEarthcamLocationsPayload(locationsRes.value).cameras
        : [];

    const cameras = mergeEarthcamCatalogCameras([...networkCameras, ...locationsCameras]);

    if (cameras.length === 0) {
      const err =
        networkRes.status === "rejected"
          ? networkRes.reason
          : locationsRes.status === "rejected"
            ? locationsRes.reason
            : new Error("EarthCam APIs returned no cameras");
      throw err instanceof Error ? err : new Error(String(err));
    }

    return {
      cameras,
      providerId: "earthcam-catalog",
      attribution: CATALOG_ATTRIBUTION,
      licenseNote: "https://www.earthcam.com/"
    };
  }
}
