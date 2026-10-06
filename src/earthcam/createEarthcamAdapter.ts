/**
 * Camera data source selection.
 *   (default) cctv    — real public agency cameras (DOT / city open data) via the local `/api/cctv` proxy
 *   network | osm     — legacy EarthCam location pins (links only, no imagery)
 *   static | json     — bundled seed JSON
 */

export type EarthcamMode = "cctv" | "network" | "osm" | "static";

export function earthcamMode(): EarthcamMode {
  const mode = (import.meta.env.VITE_EARTHCAM_ADAPTER as string | undefined)?.trim().toLowerCase();
  if (!mode || mode === "cctv") return "cctv";
  if (mode === "static" || mode === "json") return "static";
  if (mode === "network") return "network";
  return "osm";
}

export function shouldLoadEarthcamViaCctv(): boolean {
  return earthcamMode() === "cctv";
}

/** Legacy: EarthCam network map API + optional OSM viewport merge. */
export function shouldLoadEarthcamViaNetwork(): boolean {
  const m = earthcamMode();
  return m === "network" || m === "osm";
}

/** Legacy: OpenStreetMap viewport Overpass supplements the network catalog. */
export function shouldLoadEarthcamViaOsm(): boolean {
  return earthcamMode() === "osm";
}

export function getEarthcamNetworkApiUrl(): string {
  const custom = (import.meta.env.VITE_EARTHCAM_NETWORK_API_URL as string | undefined)?.trim();
  if (custom) return custom;
  return "/earthcam-api-proxy/api/mapsearch/get_locations_network.php?a=fetch&r=ecn";
}

/** Secondary map feed — adds sites (e.g. myearthcam.com) not in the network catalog. */
export function getEarthcamLocationsApiUrl(): string {
  const custom = (import.meta.env.VITE_EARTHCAM_LOCATIONS_API_URL as string | undefined)?.trim();
  if (custom) return custom;
  return "/earthcam-api-proxy/api/mapsearch/get_locations.php?a=fetch";
}

export function getEarthcamOverpassInterpreterFromEnv(): string {
  const dedicated = (import.meta.env.VITE_EARTHCAM_OVERPASS_INTERPRETER as string | undefined)?.trim();
  if (dedicated) return dedicated;
  const alpr = (import.meta.env.VITE_ALPR_OVERPASS_INTERPRETER as string | undefined)?.trim();
  if (alpr) return alpr;
  return "/overpass-proxy/api/interpreter";
}
