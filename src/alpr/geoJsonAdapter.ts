import type { AlprDataAdapter, AlprDataset, AlprSite } from "./alprTypes";
import { parseConfidence } from "./alprTypes";

function num(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() && !Number.isNaN(Number(x))) return Number(x);
  return null;
}

function str(x: unknown): string | undefined {
  if (typeof x === "string") {
    const t = x.trim();
    return t.length ? t : undefined;
  }
  return undefined;
}

function siteFromProperties(
  props: Record<string, unknown>,
  lon: number,
  lat: number,
  fallbackId: string
): AlprSite {
  const id =
    str(props.site_id) ??
    str(props.siteId) ??
    str(props.id) ??
    str(props.camera_id) ??
    str(props.osm_id) ??
    (typeof props.osmId === "number" && Number.isFinite(props.osmId)
      ? String(props.osmId)
      : undefined) ??
    fallbackId;
  const source = str(props.source) ?? str(props.data_source) ?? "unspecified";
  return {
    id,
    latitude: lat,
    longitude: lon,
    name: str(props.name) ?? str(props.label) ?? str(props.road) ?? str(props.ref),
    source,
    vendor: str(props.vendor) ?? str(props.operator),
    region: str(props.region) ?? str(props.state) ?? str(props.area),
    confidence: parseConfidence(props.confidence ?? props.conf),
    bearingDeg: num(
      props.bearing_deg ?? props.bearingDeg ?? props.heading_deg ?? props.direction
    ),
    fovDeg: num(props.fov_deg ?? props.fovDeg ?? props.beam_width_deg),
    rangeMeters: num(props.range_m ?? props.rangeMeters ?? props.range_meters),
    notes: str(props.notes) ?? str(props.description),
    extra: props
  };
}

export class GeoJsonUrlAdapter implements AlprDataAdapter {
  readonly kind = "geojson";

  constructor(private readonly url: string) {}

  async load(): Promise<AlprDataset> {
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`ALPR GeoJSON fetch HTTP ${res.status}`);
    const data = (await res.json()) as unknown;
    return parseFeatureCollection(data, this.url);
  }
}

export function parseFeatureCollection(data: unknown, provenanceHint: string): AlprDataset {
  if (!data || typeof data !== "object") {
    return { sites: [], attribution: "Invalid GeoJSON", licenseNote: provenanceHint };
  }
  const root = data as Record<string, unknown>;
  const attr =
    str(root.attribution) ??
    str(root.dataset_attribution) ??
    "Community / open ALPR location data (verify license before redistribution).";
  const licenseNote = str(root.license) ?? str(root.license_note);

  if (root.type !== "FeatureCollection" || !Array.isArray(root.features)) {
    return { sites: [], attribution: attr, licenseNote };
  }

  const sites: AlprSite[] = [];
  let i = 0;
  for (const feat of root.features as unknown[]) {
    if (!feat || typeof feat !== "object") continue;
    const f = feat as Record<string, unknown>;
    const geom = f.geometry as Record<string, unknown> | undefined;
    const props = (f.properties as Record<string, unknown>) ?? {};
    if (!geom || typeof geom !== "object") continue;

    if (geom.type === "Point" && Array.isArray(geom.coordinates)) {
      const c = geom.coordinates as number[];
      const lon = c[0];
      const lat = c[1];
      if (typeof lon !== "number" || typeof lat !== "number") continue;
      sites.push(siteFromProperties(props, lon, lat, `alpr-${i}`));
      i++;
      continue;
    }

    if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
      const ring = (geom.coordinates[0] as number[][]) ?? [];
      if (ring.length < 3) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const pt of ring) {
        if (typeof pt[0] === "number" && typeof pt[1] === "number") {
          sx += pt[0];
          sy += pt[1];
          n++;
        }
      }
      if (n === 0) continue;
      sites.push(siteFromProperties(props, sx / n, sy / n, `alpr-poly-${i}`));
      i++;
    }
  }

  return { sites, attribution: attr, licenseNote };
}
