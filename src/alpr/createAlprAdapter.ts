import type { AlprDataAdapter } from "./alprTypes";
import { GeoJsonUrlAdapter } from "./geoJsonAdapter";
import { JsonSitesUrlAdapter } from "./jsonSitesAdapter";
import { OverpassInterpreterAdapter } from "./overpassAdapter";

function defaultGeoJsonUrl(): string {
  return `${import.meta.env.BASE_URL}data/alpr-sample.geojson`.replace(/\/{2,}/g, "/");
}

function createOverpassAdapterFromEnv(): AlprDataAdapter {
  const interpreter =
    (import.meta.env.VITE_ALPR_OVERPASS_INTERPRETER as string | undefined)?.trim() ||
    (import.meta.env.DEV ? "/overpass-proxy/api/interpreter" : "https://overpass-api.de/api/interpreter");
  const query = (import.meta.env.VITE_ALPR_OVERPASS_QUERY as string | undefined)?.trim();
  const queryUrl =
    (import.meta.env.VITE_ALPR_OVERPASS_QUERY_URL as string | undefined)?.trim() ||
    `${import.meta.env.BASE_URL}data/alpr-overpass-example.ql`.replace(/\/{2,}/g, "/");
  return new OverpassInterpreterAdapter({
    interpreterUrl: interpreter,
    query: query || undefined,
    queryUrl
  });
}

/** Overpass POST URL (dev default: `/overpass-proxy/api/interpreter`). */
export function getOverpassInterpreterFromEnv(): string {
  return (
    (import.meta.env.VITE_ALPR_OVERPASS_INTERPRETER as string | undefined)?.trim() ||
    (import.meta.env.DEV ? "/overpass-proxy/api/interpreter" : "https://overpass-api.de/api/interpreter")
  );
}

function inferredGeoOrSitesFromDataUrl(dataUrl: string): boolean {
  const u = dataUrl.toLowerCase();
  if (u.includes(".geojson") || /geojson/i.test(u)) return true;
  if (u.endsWith(".json") && !u.includes("geojson")) return true;
  return false;
}

/**
 * When true, ALPR loads from OSM via Overpass using the **current globe view** (zoomed-in area only).
 * Set `VITE_ALPR_VIEWPORT=0` to use a static `.ql` / env query with `OverpassInterpreterAdapter` instead.
 */
export function shouldLoadAlprViaViewport(): boolean {
  if ((import.meta.env.VITE_ALPR_VIEWPORT as string | undefined)?.trim() === "0") return false;
  const dataUrl = (import.meta.env.VITE_ALPR_DATA_URL as string | undefined)?.trim();
  const mode = (import.meta.env.VITE_ALPR_ADAPTER as string | undefined)?.trim().toLowerCase();
  if (mode === "geojson" || mode === "json" || mode === "sites") return false;
  if (dataUrl && !mode && inferredGeoOrSitesFromDataUrl(dataUrl)) return false;
  if (dataUrl && mode !== "overpass" && mode !== "osm") return false;
  return mode === "overpass" || mode === "osm" || (!mode && !dataUrl);
}

/**
 * Default when neither `VITE_ALPR_ADAPTER` nor `VITE_ALPR_DATA_URL` is set: **OpenStreetMap via Overpass**
 * using the **current map view** when ALPR is ON (viewport query; set `VITE_ALPR_VIEWPORT=0` for a static `.ql` load instead).
 *
 * Set `VITE_ALPR_ADAPTER=geojson` (and optionally `VITE_ALPR_DATA_URL`) for the offline sample fixture.
 */
export function createAlprAdapterFromEnv(): AlprDataAdapter {
  const dataUrl = (import.meta.env.VITE_ALPR_DATA_URL as string | undefined)?.trim();
  const url = dataUrl || defaultGeoJsonUrl();
  const mode = (import.meta.env.VITE_ALPR_ADAPTER as string | undefined)?.trim().toLowerCase();

  if (mode === "overpass" || mode === "osm") {
    return createOverpassAdapterFromEnv();
  }

  if (!mode && !dataUrl) {
    return createOverpassAdapterFromEnv();
  }

  if (mode === "json" || mode === "sites") return new JsonSitesUrlAdapter(url);
  if (mode === "geojson") return new GeoJsonUrlAdapter(url);
  if (url.includes(".geojson") || /geojson/i.test(url)) return new GeoJsonUrlAdapter(url);
  if (url.endsWith(".json") && !url.toLowerCase().includes("geojson")) {
    return new JsonSitesUrlAdapter(url);
  }
  return new GeoJsonUrlAdapter(url);
}
