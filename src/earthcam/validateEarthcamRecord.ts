import type { EarthCamCamera, EarthCamDataset, EarthCamStatus } from "./earthcamTypes";

const VALID_STATUS = new Set<EarthCamStatus>(["live", "available", "offline", "unknown"]);

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function isValidLatLon(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * Defensive normalization of one raw JSON record.
 * Returns null when coordinates or required fields are invalid.
 */
export function normalizeEarthcamRecord(raw: unknown): EarthCamCamera | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const id = str(o.id);
  const name = str(o.name);
  const lat = num(o.latitude);
  const lon = num(o.longitude);
  const earthcamPageUrl = str(o.earthcamPageUrl) ?? str(o.pageUrl) ?? str(o.url);

  if (!id || !name || lat == null || lon == null || !earthcamPageUrl) return null;
  if (!isValidLatLon(lat, lon)) return null;

  let status = (str(o.status)?.toLowerCase() ?? "unknown") as EarthCamStatus;
  if (!VALID_STATUS.has(status)) status = "unknown";

  const thumbnail = str(o.thumbnail);
  const streamUrl = str(o.streamUrl);

  return {
    id,
    name,
    latitude: lat,
    longitude: lon,
    city: str(o.city),
    region: str(o.region),
    country: str(o.country),
    category: str(o.category),
    thumbnail: thumbnail && !thumbnail.startsWith("broken:") ? thumbnail : undefined,
    earthcamPageUrl,
    streamUrl,
    embedAllowed: o.embedAllowed === true,
    status,
    cameraSource: str(o.cameraSource) ?? "earthcam",
    notes: str(o.notes)
  };
}

export type ParseEarthcamJsonResult = {
  dataset: EarthCamDataset;
  skipped: number;
  warnings: string[];
};

/**
 * Parse seed JSON or future API payload into a normalized dataset.
 * Plug-in point: LicensedEarthCamProvider / AggregatedCameraProvider return same shape.
 */
export function parseEarthcamJsonPayload(
  data: unknown,
  opts?: { providerId?: string; attribution?: string }
): ParseEarthcamJsonResult {
  const warnings: string[] = [];
  let skipped = 0;
  const cameras: EarthCamCamera[] = [];

  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = Array.isArray(data)
    ? data
    : Array.isArray(root?.cameras)
      ? (root!.cameras as unknown[])
      : [];

  const attribution =
    str(root?.attribution) ??
    opts?.attribution ??
    "Camera locations © respective operators. Streams and thumbnails require operator permission.";
  const licenseNote = str(root?.licenseNote);
  const providerId = str(root?.providerId) ?? opts?.providerId ?? "static";

  for (const raw of list) {
    const cam = normalizeEarthcamRecord(raw);
    if (!cam) {
      skipped++;
      continue;
    }
    if (cam.thumbnail) {
      try {
        new URL(cam.thumbnail, window.location.origin);
      } catch {
        warnings.push(`Invalid thumbnail URL for ${cam.id}`);
        cam.thumbnail = undefined;
      }
    }
    if (cam.streamUrl) {
      try {
        new URL(cam.streamUrl);
      } catch {
        warnings.push(`Invalid streamUrl for ${cam.id}`);
        cam.streamUrl = undefined;
      }
    }
    cameras.push(cam);
  }

  return {
    dataset: { cameras, attribution, licenseNote, providerId },
    skipped,
    warnings
  };
}
