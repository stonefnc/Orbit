/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cesium ion token for imagery, terrain and the 3D Photo map (a browser token by design; the Keys menu can set it instead). */
  readonly VITE_CESIUM_ION_TOKEN?: string;
  /** Cesium ion asset id for the Photorealistic 3D Tiles; enables the PHR toggle when set. */
  readonly VITE_PHOTOREALISTIC_3D_ASSET_ID?: string;
  /**
   * Optional production base URL for Aviationstack-compatible `/v1/flights` (HTTPS relay that adds `access_key`).
   */
  readonly VITE_AVIATIONSTACK_API_BASE?: string;
  /** `off` | `fallback` (default) | `preferred` — controls when Aviationstack runs vs OpenSky-only gaps. */
  readonly VITE_AVIATIONSTACK_MODE?: string;
  /** Set `0` or `false` to disable spare multi-attempt lookups (more API calls). */
  readonly VITE_AVIATIONSTACK_SPARING?: string;
  /** In-memory memo TTL for Aviationstack route lookups (milliseconds, numeric string; default 7 days). */
  readonly VITE_AVIATIONSTACK_CACHE_MS?: string;
  /** Same-origin relay for CelesTrak TLE in production (`https://your-worker/...`). Dev uses `/celestrak-proxy` automatically. */
  readonly VITE_CELESTRAK_API_BASE?: string;
  /**
   * Production: HTTPS origin that serves `GET /api/aircraft` (plane aggregation server).
   * Leave unset for same-origin `/api` (reverse-proxy the Node plane API behind your static host).
   */
  readonly VITE_PLANE_API_BASE?: string;
  /** Minimum ms between plane map polls (default 5000; anything below 2000 is raised to 2000). */
  readonly VITE_PLANE_POLL_MS?: string;
  /** GeoJSON / JSON URL. If unset with no `VITE_ALPR_ADAPTER`, Overpass is used instead of this. */
  readonly VITE_ALPR_DATA_URL?: string;
  /** `overpass` | `osm` | `geojson` | `json` / `sites`. Unset + no data URL → Overpass (live OSM). */
  readonly VITE_ALPR_ADAPTER?: string;
  /** Overpass interpreter URL (dev default: same-origin `/overpass-proxy/api/interpreter`). */
  readonly VITE_ALPR_OVERPASS_INTERPRETER?: string;
  /** Single-line Overpass QL (optional; else `VITE_ALPR_OVERPASS_QUERY_URL` or built-in bbox). */
  readonly VITE_ALPR_OVERPASS_QUERY?: string;
  /** URL to a `.ql` file with the Overpass query (e.g. `/data/alpr-overpass-example.ql`). */
  readonly VITE_ALPR_OVERPASS_QUERY_URL?: string;
  /** Set `0` to use a static Overpass query file instead of viewport-driven OSM loads. */
  readonly VITE_ALPR_VIEWPORT?: string;
  /** Same-origin Nominatim relay in production if browser blocks OSM (see README). */
  readonly VITE_NOMINATIM_API_BASE?: string;
  /** Optional ms between Nominatim requests (default 1000; min 400, max 2000). */
  readonly VITE_NOMINATIM_MIN_INTERVAL_MS?: string;
  /** Camera layer source: unset or `cctv` (default: real agency cameras via /api/cctv), `network` (EarthCam pins), `osm` (pins plus OSM tags) or `static` / `json` (bundled seed JSON). */
  readonly VITE_EARTHCAM_ADAPTER?: string;
  readonly VITE_EARTHCAM_NETWORK_API_URL?: string;
  readonly VITE_EARTHCAM_LOCATIONS_API_URL?: string;
  readonly VITE_EARTHCAM_DATA_URL?: string;
  readonly VITE_EARTHCAM_VIEWPORT_MAX_DEG?: string;
  readonly VITE_EARTHCAM_OVERPASS_INTERPRETER?: string;
}
