/** What the camera's reported direction actually means — never present a guess as a fact. */
export type HeadingKind = "facing" | "traffic-direction" | "unknown";

export type CctvCamera = {
  /** `${sourceId}:${localId}` — stable across restarts. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  source: string;
  agency: string;
  country: string;
  region?: string;
  city?: string;
  roadway?: string;
  description?: string;
  /** Degrees clockwise from north, only when the agency publishes a direction. */
  headingDeg: number | null;
  headingKind: HeadingKind;
  /** Upstream still-image URL. Never sent to the browser; frames are fetched through `/api/cctv/frame/:id`. */
  frameUrl: string;
  /** How often the agency says the still is refreshed. */
  refreshSec: number;
  pageUrl?: string;
  /**
   * Optional real video the browser can play directly (the agency's host allows cross-origin playback):
   * an HLS live stream or a short MP4 clip. Only https URLs on an allow-listed host are ever set.
   */
  videoUrl?: string;
  videoKind?: "hls" | "mp4";
};

/** Hosts whose video URLs are passed through to the browser untouched (they send CORS headers for playback). */
export function isAllowedVideoUrl(raw: string | undefined | null, kind: "hls" | "mp4"): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (kind === "hls") return u.hostname === "wzmedia.dot.ca.gov" && u.pathname.endsWith(".m3u8");
    return (
      u.hostname === "s3-eu-west-1.amazonaws.com" &&
      u.pathname.startsWith("/jamcams.tfl.gov.uk/") &&
      u.pathname.endsWith(".mp4")
    );
  } catch {
    return false;
  }
}

export type UpstreamAllow = { host: string; pathPrefix?: string };

/** [west, south, east, north] */
export type Bounds = [number, number, number, number];

export type CctvSource = {
  id: string;
  label: string;
  agency: string;
  country: string;
  license: string;
  attribution: string;
  ttlMs: number;
  /** Coarse extents so a viewport query only loads sources that could be in view. */
  coverage: Bounds[];
  /** Frame URLs must match one of these (defence in depth against bad upstream data). */
  allow: UpstreamAllow[];
  /** Extra headers some providers ask clients to send when fetching frames (e.g. an identifying user name). */
  frameHeaders?: Record<string, string>;
  load: () => Promise<CctvCamera[]>;
};

export type CctvCameraPublic = Omit<CctvCamera, "frameUrl"> & {
  frame: string;
  attribution: string;
  license: string;
};
