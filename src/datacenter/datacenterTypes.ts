/** Normalized data-center site for the globe overlay (OpenStreetMap + PeeringDB + Wikidata, merged on the server). */

export type DatacenterSite = {
  id: string;
  latitude: number;
  longitude: number;
  name?: string;
  operator?: string;
  owner?: string;
  website?: string;
  address?: string;
  ref?: string;
  /** Which maps know this site: "OpenStreetMap", "PeeringDB", "Wikidata". */
  sources: string[];
  /** OSM objects merged into this site, e.g. "way/123". */
  osm: string[];
  peeringdb?: number;
  wikidata?: string;
  /** OSM buildings merged into this campus. */
  buildings: number;
  region?: string;
  country?: string;
  notes?: string;
};

export type DatacenterDataset = {
  sites: DatacenterSite[];
  attribution: string;
  licenseNote?: string;
};

export type DatacenterFilterState = {
  operator: string;
};

export function slugDatacenterEntityId(siteId: string): string {
  return siteId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "dc";
}
