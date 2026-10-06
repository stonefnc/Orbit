import type { Bounds, CctvCamera, CctvSource } from "../types";
import { headingFromDirection, titleCase, validLatLon } from "../geo";
import { getJson, mapLimit } from "./http";

/**
 * Many state/provincial 511 websites run the same platform and expose the same camera list the site's own
 * map uses (`/List/GetData/Cameras`, frames at `/map/Cctv/{id}`). These are public pages' data endpoints, not
 * documented APIs, so they can change without notice and each site's terms of use apply.
 */
type Site = {
  id: string;
  label: string;
  host: string;
  agency: string;
  country: string;
  /** Used when a row carries no state of its own. */
  region: string;
  coverage: Bounds[];
};

export const ITERIS_511_SITES: Site[] = [
  { id: "gdot", label: "Georgia (GDOT 511GA)", host: "511ga.org", agency: "Georgia DOT (511GA)", country: "United States", region: "Georgia", coverage: [[-85.7, 30.3, -80.7, 35.1]] },
  { id: "fl511", label: "Florida (FL511)", host: "fl511.com", agency: "Florida DOT (FL511)", country: "United States", region: "Florida", coverage: [[-87.7, 24.4, -79.9, 31.1]] },
  { id: "pa511", label: "Pennsylvania (511PA)", host: "511pa.com", agency: "PennDOT (511PA)", country: "United States", region: "Pennsylvania", coverage: [[-80.6, 39.6, -74.6, 42.4]] },
  { id: "nc511", label: "North Carolina (DriveNC)", host: "www.drivenc.gov", agency: "NCDOT (DriveNC)", country: "United States", region: "North Carolina", coverage: [[-84.4, 33.8, -75.4, 36.7]] },
  { id: "ut511", label: "Utah (UDOT Traffic)", host: "udottraffic.utah.gov", agency: "UDOT (UDOT Traffic)", country: "United States", region: "Utah", coverage: [[-114.1, 36.9, -109, 42.1]] },
  { id: "az511", label: "Arizona (AZ511)", host: "az511.com", agency: "Arizona DOT (AZ511)", country: "United States", region: "Arizona", coverage: [[-114.9, 31.3, -109, 37.1]] },
  { id: "nv511", label: "Nevada (NVRoads)", host: "www.nvroads.com", agency: "Nevada DOT (NVRoads)", country: "United States", region: "Nevada", coverage: [[-120.1, 35, -114, 42.1]] },
  { id: "id511", label: "Idaho (Idaho 511)", host: "511.idaho.gov", agency: "Idaho Transportation Department", country: "United States", region: "Idaho", coverage: [[-117.3, 41.9, -111, 49.1]] },
  { id: "wi511", label: "Wisconsin (511WI)", host: "511wi.gov", agency: "Wisconsin DOT (511WI)", country: "United States", region: "Wisconsin", coverage: [[-92.9, 42.4, -86.7, 47.1]] },
  { id: "la511", label: "Louisiana (511LA)", host: "511la.org", agency: "Louisiana DOTD (511LA)", country: "United States", region: "Louisiana", coverage: [[-94.1, 28.9, -88.8, 33.1]] },
  { id: "ne511", label: "New England (NH/VT/ME 511)", host: "newengland511.org", agency: "New England 511 (NHDOT / VTrans / MaineDOT)", country: "United States", region: "New England", coverage: [[-73.8, 42.6, -66.8, 47.6]] },
  { id: "ct511", label: "Connecticut (CTroads)", host: "ctroads.org", agency: "Connecticut DOT (CTroads)", country: "United States", region: "Connecticut", coverage: [[-73.8, 40.9, -71.7, 42.1]] },
  { id: "ak511", label: "Alaska (Alaska 511)", host: "511.alaska.gov", agency: "Alaska DOT&PF (511)", country: "United States", region: "Alaska", coverage: [[-179.5, 51, -129.9, 71.5]] },
  { id: "on511", label: "Ontario (511 Ontario)", host: "511on.ca", agency: "Ontario Ministry of Transportation (511)", country: "Canada", region: "Ontario", coverage: [[-95.2, 41.6, -74.3, 56.9]] }
];

const PAGE_SIZE = 100;

type Row = {
  id?: number;
  visible?: boolean;
  location?: string;
  roadway?: string;
  direction?: string;
  state?: string | null;
  latLng?: { geography?: { wellKnownText?: string } };
  images?: Array<{
    id?: number;
    imageUrl?: string;
    disabled?: boolean;
    blocked?: boolean;
    videoUrl?: string;
    videoDisabled?: boolean;
    isVideoAuthRequired?: boolean;
  }>;
};
type Page = { recordsTotal?: number; data?: Row[] };

function pageUrl(host: string, start: number): string {
  const query = JSON.stringify({ columns: [], order: [{ column: 0, dir: "asc" }], start, length: PAGE_SIZE });
  return `https://${host}/List/GetData/Cameras?query=${encodeURIComponent(query)}&lang=en-US`;
}

function toCamera(site: Site, r: Row): CctvCamera | null {
  if (r.id == null || r.visible === false) return null;
  const img = r.images?.find((i) => i.imageUrl && !i.disabled && !i.blocked);
  const m = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(r.latLng?.geography?.wellKnownText ?? "");
  if (!img?.imageUrl || !m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!validLatLon(lat, lon)) return null;
  let frame: URL;
  try {
    frame = new URL(img.imageUrl, `https://${site.host}`);
  } catch {
    return null;
  }
  const roadway = r.roadway?.trim();
  const name = (r.location ?? "").trim() || roadway || `Camera ${r.id}`;
  // Georgia names end with the county in capitals, e.g. "SR 140 at Princeton Blvd (BARTOW)".
  const county = site.id === "gdot" ? /\(([A-Z][A-Z .'-]+)\)\s*$/.exec(name)?.[1] : undefined;
  const heading = headingFromDirection(r.direction);
  const state = r.state?.trim();
  return {
    id: `${site.id}:${r.id}`,
    name,
    lat,
    lon,
    source: site.id,
    agency: site.agency,
    country: site.country,
    region: state || site.region,
    city: county ? `${titleCase(county)} County` : undefined,
    roadway: roadway && roadway !== "Unknown" ? roadway : undefined,
    description: r.direction && !/^(unknown|n\/a)?$/i.test(r.direction.trim()) ? `${r.direction.trim()} traffic` : undefined,
    headingDeg: heading,
    headingKind: heading == null ? "unknown" : "traffic-direction",
    frameUrl: frame.href,
    refreshSec: 60,
    pageUrl: `https://${site.host}/`
  };
}

function makeSource(site: Site): CctvSource {
  return {
    id: site.id,
    label: site.label,
    agency: site.agency,
    country: site.country,
    license: `Public traffic-camera images published by ${site.agency} on ${site.host}; that site's terms of use apply. Uses the site's own map data endpoint (not a documented API).`,
    attribution: `${site.agency} — ${site.host}`,
    ttlMs: 6 * 60 * 60_000,
    coverage: site.coverage,
    allow: [{ host: site.host, pathPrefix: "/map/Cctv/" }],
    async load() {
      const first = await getJson<Page>(site.id, pageUrl(site.host, 0));
      const total = first.recordsTotal ?? first.data?.length ?? 0;
      const starts: number[] = [];
      for (let s = PAGE_SIZE; s < total; s += PAGE_SIZE) starts.push(s);
      const rest = await mapLimit(starts, 3, (s) => getJson<Page>(site.id, pageUrl(site.host, s)));
      const seen = new Set<string>();
      const out: CctvCamera[] = [];
      for (const row of [first, ...rest].flatMap((p) => p.data ?? [])) {
        const c = toCamera(site, row);
        if (c && !seen.has(c.id)) {
          seen.add(c.id);
          out.push(c);
        }
      }
      return out;
    }
  };
}

export const iteris511Sources: CctvSource[] = ITERIS_511_SITES.map(makeSource);
