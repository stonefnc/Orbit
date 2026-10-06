/**
 * Normalized live-camera site for Orbit globe layers.
 * `cameraSource` allows future AggregatedCameraProvider (municipal, traffic, resort, etc.).
 */

export type EarthCamStatus = "live" | "available" | "offline" | "unknown";

export type EarthCamDetailState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "external-only"
  | "error";

export type EarthCamCamera = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  city?: string;
  region?: string;
  country?: string;
  category?: string;
  thumbnail?: string;
  earthcamPageUrl: string;
  /** Licensed / approved embed URL only — never assume EarthCam streams are embeddable. */
  streamUrl?: string;
  embedAllowed: boolean;
  status: EarthCamStatus;
  cameraSource: string;
  notes?: string;
  /** Same-origin still-image URL served by the CCTV proxy (set for real agency cameras). */
  frameUrl?: string;
  /** Real video the browser can play directly: an HLS live stream or a short MP4 clip. */
  videoUrl?: string;
  videoKind?: "hls" | "mp4";
  /** Where to find the same view (agency website). */
  agencyPageUrl?: string;
  /** Agency-stated image refresh interval, seconds. */
  frameRefreshSec?: number;
  /** Degrees clockwise from north, only when the agency published a direction (`headingKind` says what it means). */
  headingDeg?: number | null;
  headingKind?: "facing" | "traffic-direction" | "unknown";
  /** Per-camera attribution required by the publishing agency. */
  attribution?: string;
  license?: string;
};

export type EarthCamDataset = {
  cameras: EarthCamCamera[];
  attribution: string;
  licenseNote?: string;
  /** Provider id for UI / future LicensedEarthCamProvider swap. */
  providerId: string;
};

export type EarthCamFilterState = {
  country: string;
  city: string;
  category: string;
  status: string;
  search: string;
  viewportOnly: boolean;
};

export type EarthCamLayerState = {
  visible: boolean;
  loading: boolean;
  error: string | null;
  dataset: EarthCamDataset | null;
  filters: EarthCamFilterState;
  selectedCameraId: string | null;
  detailState: EarthCamDetailState;
};

export const DEFAULT_EARTHCAM_FILTERS: EarthCamFilterState = {
  country: "__all__",
  city: "__all__",
  category: "__all__",
  status: "__all__",
  search: "",
  viewportOnly: false
};

/** Clustering kicks in above this catalog size; smaller sets show one marker per site. */
export const EARTHCAM_CLUSTERING_MIN_COUNT = 20;

export function slugEarthcamEntityId(cameraId: string): string {
  return cameraId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "cam";
}

/** Mode B: embedded playback only when explicitly allowed and a stream URL exists. */
export function canEmbedEarthCamStream(cam: EarthCamCamera): boolean {
  return cam.embedAllowed === true && typeof cam.streamUrl === "string" && cam.streamUrl.trim().length > 0;
}
