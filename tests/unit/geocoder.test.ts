import { describe, expect, it } from "vitest";
import {
  createGeocoder,
  dedupe,
  distanceKm,
  hasHouseNumber,
  hasPlaceAfterStreet,
  prettyAddress,
  rankResults,
  type GeoResult
} from "../../server/lib/geocoder";

const r = (label: string, lat: number, lon: number, extra: Partial<GeoResult> = {}): GeoResult => ({ label, lat, lon, source: "photon", ...extra });
const here = { lat: 33.4, lon: -84.2 };

describe("query helpers", () => {
  it("spots a house number", () => {
    expect(hasHouseNumber("1600 Pennsylvania Ave NW")).toBe(true);
    expect(hasHouseNumber("12B Baker St")).toBe(true);
    expect(hasHouseNumber("Pennsylvania Ave")).toBe(false);
    expect(hasHouseNumber("7 eleven")).toBe(true);
    expect(hasHouseNumber("2024")).toBe(false);
  });
  it("tells a bare street from one with a city, state or ZIP", () => {
    expect(hasPlaceAfterStreet("100 Main St")).toBe(false);
    expect(hasPlaceAfterStreet("100 Main St NW")).toBe(false);
    expect(hasPlaceAfterStreet("100 Main St Atlanta")).toBe(true);
    expect(hasPlaceAfterStreet("100 Main St, GA")).toBe(true);
    expect(hasPlaceAfterStreet("100 Main St GA 30000")).toBe(true);
    expect(hasPlaceAfterStreet("100 Main St 30000")).toBe(true);
    expect(hasPlaceAfterStreet("1 Peachtree, Atlanta")).toBe(true);
  });
  it("makes the Census's upper case readable", () => {
    expect(prettyAddress("1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500")).toBe("1600 Pennsylvania Ave NW, Washington, DC, 20500");
    expect(prettyAddress("100 MAIN ST, ADEL, GA, 31620")).toBe("100 Main St, Adel, GA, 31620");
    expect(prettyAddress("120 EXAMPLE DR, MCDONALD, GA, 30000")).toBe("120 Example Dr, McDonald, GA, 30000");
  });
  it("measures distance", () => {
    expect(distanceKm(here, here)).toBe(0);
    expect(Math.round(distanceKm({ lat: 33.749, lon: -84.388 }, here))).toBeGreaterThan(30); // Atlanta is ~45 km away
  });
});

describe("dedupe and ranking", () => {
  it("drops the same spot or the same label, keeping the first source", () => {
    const out = dedupe([r("A", 1, 1, { source: "census" }), r("B", 1.00001, 1.00001), r("a", 5, 5), r("C", 2, 2)]);
    expect(out.map((x) => x.label)).toEqual(["A", "C"]);
  });
  it("puts addresses first for a house-number query, then the nearest", () => {
    const far = r("100 Main St, Adel", 31.04, -83.39, { address: true });
    const near = r("100 Main St, Barnesville", 33.08, -84.17, { address: true });
    const place = r("Main Street Cafe", 33.4, -84.2);
    expect(rankResults([place, far, near], here, "100 Main St").map((x) => x.label)).toEqual([near.label, far.label, place.label]);
  });
  it("ranks the exact house number above a nearer address with another number", () => {
    const bail = r("1st Choice Bail Bonds, 207 Peachtree Street Southwest, Atlanta", 33.7490, -84.3880, { address: true });
    const one = r("1 Peachtree St, Atlanta, GA, 30303", 33.7540, -84.3900, { address: true, source: "census" });
    expect(rankResults([bail, one], { lat: 33.75, lon: -84.388 }, "1 peachtree st atlanta ga").map((x) => x.label)).toEqual([one.label, bail.label]);
  });
  it("keeps the source's order for a place query but moves anything within 100 km ahead", () => {
    const paris = r("Paris, France", 48.85, 2.35);
    const walmart = r("Walmart, Springfield", 33.39, -84.19);
    expect(rankResults([paris, walmart], here, "walmart").map((x) => x.label)).toEqual([walmart.label, paris.label]);
    expect(rankResults([paris, walmart], null, "walmart").map((x) => x.label)).toEqual([paris.label, walmart.label]);
  });
});

/** A fake network: answers by URL host, counts calls, and never really waits. */
function fakeNet(handlers: Record<string, (url: URL) => unknown>) {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.hostname + url.pathname);
    const h = handlers[url.hostname];
    if (!h) throw new Error("no network");
    const body = h(url);
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
  return { calls, fetchFn };
}
const census = (url: URL) =>
  url.pathname.includes("geographies")
    ? { result: { geographies: { States: [{ STUSAB: "GA" }] } } }
    : {
        result: {
          addressMatches: [
            { matchedAddress: "100 MAIN ST, ADEL, GA, 31620", coordinates: { x: -83.39, y: 31.04 } },
            { matchedAddress: "100 MAIN ST, BARNESVILLE, GA, 30204", coordinates: { x: -84.17, y: 33.08 } }
          ]
        }
      };
const photonPlaces = () => ({
  features: [{ geometry: { coordinates: [-84.14, 33.44] }, properties: { name: "Walmart", street: "Main St", city: "Springfield", state: "Georgia", osm_type: "N", osm_id: 7, osm_value: "supermarket" } }]
});
const noSleep = async () => {};

describe("geocode", () => {
  it("uses the Census for a house number, adds the bias state to a bare street, and ranks the nearest first", async () => {
    const net = fakeNet({ "geocoding.geo.census.gov": census, "photon.komoot.io": () => ({ features: [] }) });
    const g = createGeocoder({ fetchFn: net.fetchFn, sleep: noSleep });
    const out = await g.geocode("100 Main St", { bias: here });
    expect(out.results.map((x) => x.label)).toEqual(["100 Main St, Barnesville, GA, 30204", "100 Main St, Adel, GA, 31620"]);
    expect(out.results[0]!.source).toBe("census");
    expect(net.calls).toContain("geocoding.geo.census.gov/geocoder/geographies/coordinates");
    expect(net.calls).toContain("geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  });
  it("tries the view's state first for a street plus a city, then the query as typed", async () => {
    const asked: string[] = [];
    const net = fakeNet({
      "photon.komoot.io": () => ({ features: [] }),
      "geocoding.geo.census.gov": (url) => {
        if (url.pathname.includes("geographies")) return { result: { geographies: { States: [{ STUSAB: "GA" }] } } };
        const a = url.searchParams.get("address")!;
        asked.push(a);
        return a.endsWith(", GA") ? { result: { addressMatches: [] } } : { result: { addressMatches: [{ matchedAddress: "5 ELM ST, DALLAS, TX, 75201", coordinates: { x: -96.8, y: 32.78 } }] } };
      }
    });
    const g = createGeocoder({ fetchFn: net.fetchFn, sleep: noSleep });
    const out = await g.geocode("5 Elm St Dallas", { bias: here });
    expect(asked).toEqual(["5 Elm St Dallas, GA", "5 Elm St Dallas"]);
    expect(out.results[0]!.label).toBe("5 Elm St, Dallas, TX, 75201");
  });
  it("never calls Nominatim while typing, only on an explicit submit with few results", async () => {
    const net = fakeNet({
      "photon.komoot.io": () => ({ features: [] }),
      "nominatim.openstreetmap.org": () => [{ lat: "1", lon: "2", display_name: "Somewhere", type: "city", osm_type: "relation", osm_id: 9 }]
    });
    const g = createGeocoder({ fetchFn: net.fetchFn, sleep: noSleep });
    expect((await g.geocode("somewhere town")).results).toEqual([]);
    expect(net.calls.some((c) => c.startsWith("nominatim"))).toBe(false);
    const submitted = await g.geocode("somewhere town", { submit: true });
    expect(submitted.results.map((x) => x.label)).toEqual(["Somewhere"]);
    expect(submitted.results[0]!.osm).toBe("R9");
  });
  it("caches repeats and survives a source being down (and says which)", async () => {
    const net = fakeNet({ "photon.komoot.io": photonPlaces, "geocoding.geo.census.gov": () => new Error("down") });
    const g = createGeocoder({ fetchFn: net.fetchFn, sleep: noSleep });
    const a = await g.geocode("5 Elm St Springfield", { bias: here });
    expect(a.unavailable).toContain("census");
    expect(a.results.length).toBe(1);
    const before = net.calls.length;
    await g.geocode("5 Elm St Springfield", { bias: here });
    expect(net.calls.length).toBe(before + 2); // Photon is cached; the failed state lookup and Census are retried
  });
  it("returns nothing for a very short query and does not touch the network", async () => {
    const net = fakeNet({});
    const g = createGeocoder({ fetchFn: net.fetchFn, sleep: noSleep });
    expect((await g.geocode("ab")).results).toEqual([]);
    expect(net.calls).toEqual([]);
  });
  it("refuses an osm id that is not a plain node/way/relation id", async () => {
    const g = createGeocoder({ fetchFn: fakeNet({}).fetchFn, sleep: noSleep });
    expect(await g.lookupOsm("N1; DROP")).toBeNull();
  });
});
