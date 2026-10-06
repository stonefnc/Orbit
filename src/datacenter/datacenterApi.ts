import type { DatacenterDataset, DatacenterSite } from "./datacenterTypes";

type ApiSite = Omit<DatacenterSite, "latitude" | "longitude"> & { lat: number; lon: number };
type ApiResult = {
  sites: ApiSite[];
  tilesTotal: number;
  tilesPending: number;
  tilesFailed: number;
  truncated: boolean;
  counts: { openstreetmap: number; peeringdb: number; wikidata: number; merged: number };
};

export type DatacenterFetchResult =
  | {
      ok: true;
      dataset: DatacenterDataset;
      pending: number;
      failed: number;
      total: number;
      truncated: boolean;
      counts: ApiResult["counts"];
    }
  | { ok: false; reason: "too-wide" | "error" };

const ATTRIBUTION =
  "Merged from OpenStreetMap (© contributors, ODbL), PeeringDB and Wikidata (CC0); each facility appears once.";

/** Data centers in a lon/lat box from the Orbit server (merged and de-duplicated there). */
export async function fetchDatacenterBox(
  b: { west: number; south: number; east: number; north: number },
  signal?: AbortSignal
): Promise<DatacenterFetchResult> {
  const q = new URLSearchParams({
    w: b.west.toFixed(4),
    s: b.south.toFixed(4),
    e: b.east.toFixed(4),
    n: b.north.toFixed(4)
  });
  try {
    const res = await fetch(`/api/datacenters?${q.toString()}`, { signal });
    if (res.status === 413) return { ok: false, reason: "too-wide" };
    if (!res.ok) return { ok: false, reason: "error" };
    const j = (await res.json()) as ApiResult;
    const sites: DatacenterSite[] = j.sites.map(({ lat, lon, ...rest }) => ({ ...rest, latitude: lat, longitude: lon }));
    return {
      ok: true,
      dataset: { sites, attribution: ATTRIBUTION, licenseNote: "https://www.openstreetmap.org/copyright" },
      pending: j.tilesPending,
      failed: j.tilesFailed,
      total: j.tilesTotal,
      truncated: j.truncated,
      counts: j.counts
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { ok: false, reason: "error" };
  }
}
