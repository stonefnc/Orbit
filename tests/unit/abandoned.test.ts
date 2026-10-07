import { describe, expect, it } from "vitest";
import {
  CORE_FILTERS,
  LIFECYCLE_FILTERS,
  endDateIsPast,
  humanise,
  parseAbandoned,
  scoreCandidate
} from "../../server/lib/abandoned";

const NOW = new Date("2026-10-07T12:00:00Z");
const score = (tags: Record<string, string>) => scoreCandidate(tags, NOW);

describe("very likely (level 3): the mapper says abandoned or ruined", () => {
  it("abandoned=yes on a place says what it was and which tags decided it", () => {
    expect(score({ abandoned: "yes", building: "hospital", name: "County Hospital" })).toEqual({
      level: 3,
      kind: "building",
      name: "County Hospital",
      what: "Abandoned hospital",
      why: "abandoned=yes, building=hospital"
    });
    expect(score({ abandoned: "yes", amenity: "school" })).toMatchObject({ level: 3, kind: "civic", what: "Abandoned school" });
    expect(score({ abandoned: "yes", building: "yes" })).toMatchObject({ level: 3, what: "Abandoned building" });
  });

  it("abandoned:* prefixes put the type into plain words", () => {
    expect(score({ "abandoned:amenity": "place_of_worship" })).toMatchObject({ level: 3, what: "Abandoned place of worship", why: "abandoned:amenity=place_of_worship" });
    expect(score({ "abandoned:shop": "yes" })).toMatchObject({ level: 3, what: "Abandoned shop" });
    expect(score({ "abandoned:railway": "station", name: "Halt" })).toMatchObject({ level: 3, kind: "transport", what: "Abandoned station" });
    expect(score({ "abandoned:man_made": "works" })).toMatchObject({ level: 3, kind: "industrial", what: "Abandoned works" });
  });

  it("ruins are very likely whichever tag says so", () => {
    expect(score({ building: "ruins" })).toMatchObject({ level: 3, kind: "ruins", what: "Ruined building", why: "building=ruins" });
    expect(score({ historic: "ruins" })).toMatchObject({ level: 3, kind: "ruins", what: "Ruins" });
    expect(score({ ruins: "yes" })).toMatchObject({ level: 3, what: "Ruins" });
    expect(score({ ruins: "castle" })).toMatchObject({ level: 3, what: "Ruined castle" });
    expect(score({ ruins: "no", building: "house" })).toBeNull();
  });

  it("a small shop or amenity that is abandoned is still very likely (the mapper said so)", () => {
    expect(score({ "abandoned:shop": "convenience" })).toMatchObject({ level: 3 });
    expect(score({ abandoned: "yes", amenity: "cafe" })).toMatchObject({ level: 3, what: "Abandoned cafe" });
  });
});

describe("likely (level 2): disused or former, on something that is a place", () => {
  it("disused:* and was:* on schools, supermarkets, factories and the like", () => {
    expect(score({ "disused:amenity": "school" })).toMatchObject({ level: 2, what: "Disused school", why: "disused:amenity=school" });
    expect(score({ "disused:shop": "supermarket" })).toMatchObject({ level: 2, what: "Disused supermarket" });
    expect(score({ "disused:building": "industrial" })).toMatchObject({ level: 2, kind: "building", what: "Disused industrial" });
    expect(score({ "disused:tourism": "hotel" })).toMatchObject({ level: 2, kind: "leisure", what: "Disused hotel" });
    expect(score({ "was:amenity": "cinema" })).toMatchObject({ level: 2, what: "Former cinema" });
    expect(score({ "disused:railway": "station" })).toMatchObject({ level: 2, kind: "transport", what: "Disused station" });
  });

  it("disused=yes plus the tag that names the place", () => {
    expect(score({ disused: "yes", building: "industrial" })).toMatchObject({ level: 2, what: "Disused industrial", why: "disused=yes, building=industrial" });
    expect(score({ disused: "yes", military: "bunker" })).toMatchObject({ level: 2, kind: "industrial", what: "Disused bunker" });
  });

  it("the strongest tag wins and every contributing tag is listed", () => {
    const s = score({ "abandoned:amenity": "school", "disused:shop": "supermarket" });
    expect(s).toMatchObject({ level: 3, what: "Abandoned school" });
    expect(s?.why).toBe("abandoned:amenity=school, disused:shop=supermarket");
  });
});

describe("maybe (level 1): weaker evidence, hidden unless asked for", () => {
  it("small shop units, offices and everyday amenities fall vacant all the time", () => {
    expect(score({ "disused:shop": "convenience" })).toMatchObject({ level: 1, what: "Disused convenience" });
    expect(score({ "disused:shop": "yes" })).toMatchObject({ level: 1, what: "Disused shop" });
    expect(score({ "disused:amenity": "pub" })).toMatchObject({ level: 1 });
    expect(score({ "disused:office": "yes" })).toMatchObject({ level: 1 });
    expect(score({ disused: "yes", amenity: "cafe" })).toMatchObject({ level: 1 });
    expect(score({ "was:shop": "bakery" })).toMatchObject({ level: 1, what: "Former bakery" });
  });

  it("landuse=brownfield", () => {
    expect(score({ landuse: "brownfield" })).toMatchObject({ level: 1, kind: "industrial", what: "Brownfield land", why: "landuse=brownfield" });
  });

  it("an end_date in the past on a place", () => {
    expect(score({ end_date: "2012", amenity: "pub" })).toMatchObject({ level: 1, what: "Closed pub", why: "end_date=2012, amenity=pub" });
    expect(score({ end_date: "2019-05-01", shop: "bakery" })).toMatchObject({ level: 1, what: "Closed bakery" });
    expect(score({ end_date: "2999", amenity: "pub" })).toBeNull();
    expect(score({ end_date: "2012", highway: "residential" })).toBeNull(); // not a place
    expect(score({ end_date: "soon", amenity: "pub" })).toBeNull();
  });

  it("opening_hours=closed on a place", () => {
    expect(score({ opening_hours: "closed", shop: "bakery" })).toMatchObject({ level: 1, what: "Closed bakery", why: "opening_hours=closed, shop=bakery" });
    expect(score({ opening_hours: "off", amenity: "pub" })).toMatchObject({ level: 1 });
    expect(score({ opening_hours: "closed" })).toBeNull();
    expect(score({ opening_hours: "Mo-Fr 09:00-17:00", shop: "bakery" })).toBeNull();
  });

  it("a name that says former, closed, defunct, abandoned or derelict, on a place", () => {
    expect(score({ name: "Former Savings Bank", amenity: "bank" })).toMatchObject({ level: 1, what: "Possibly closed bank" });
    expect(score({ name: "Grand Hotel (closed)", tourism: "hotel" })).toMatchObject({ level: 1 });
    expect(score({ name: "Derelict mill", building: "industrial" })).toMatchObject({ level: 1 });
    expect(score({ name: "Former Station Road", highway: "residential" })).toBeNull();
  });

  it("two different maybe-hints together make a likely", () => {
    expect(score({ end_date: "2012", opening_hours: "closed", amenity: "pub" })).toMatchObject({ level: 2 });
    expect(score({ name: "Closed Bank", end_date: "2015", amenity: "bank" })).toMatchObject({ level: 2 });
    // the same hint twice is still one hint
    expect(score({ "disused:shop": "convenience", "was:shop": "convenience" })).toMatchObject({ level: 2 });
  });
});

describe("unlikely (level 0) and nothing", () => {
  it("a name that only starts with Old or Ex- is the weakest hint of all", () => {
    expect(score({ name: "Old Mill Pub", amenity: "pub" })).toMatchObject({ level: 0, what: "Pub" });
    expect(score({ name: "Old Town Road", highway: "residential" })).toBeNull();
  });

  it("weak hints never push a level up", () => {
    expect(score({ name: "Old Bank", amenity: "bank", end_date: "2012" })).toMatchObject({ level: 1 });
  });

  it("ordinary objects and explicit no", () => {
    expect(score({})).toBeNull();
    expect(score({ building: "house" })).toBeNull();
    expect(score({ abandoned: "no", building: "house" })).toBeNull();
    expect(score({ "abandoned:amenity": "no" })).toBeNull();
    expect(score({ abandoned: "yes" })).toBeNull(); // nothing says what it is
  });

  it("linear things, roads and fittings are not places", () => {
    for (const tags of [
      { "abandoned:railway": "rail" },
      { railway: "abandoned" },
      { "disused:railway": "narrow_gauge" },
      { "abandoned:highway": "residential" },
      { abandoned: "yes", highway: "track" },
      { "abandoned:power": "line" },
      { "abandoned:landuse": "farmland" },
      { disused: "yes", historic: "wayside_cross" },
      { "abandoned:amenity": "bench" },
      { disused: "yes", amenity: "telephone" },
      { "abandoned:leisure": "playground" },
      { abandoned: "yes", tourism: "information" },
      { "abandoned:aeroway": "runway" },
      { "abandoned:railway": "platform" }
    ]) {
      expect(score(tags)).toBeNull();
    }
  });

  it("other man-made things are still not places", () => {
    for (const tags of [{ disused: "yes", man_made: "pipeline" }, { "abandoned:man_made": "manhole" }, { disused: "yes", man_made: "survey_point" }]) {
      expect(score(tags)).toBeNull();
    }
  });
});

describe("mine shafts and adits (kept by the owner's decision, under the same rules)", () => {
  it("are their own kind, with the same levels as any other place", () => {
    expect(score({ disused: "yes", man_made: "mineshaft" })).toEqual({
      level: 2,
      kind: "mine",
      name: "",
      what: "Disused mineshaft",
      why: "disused=yes, man_made=mineshaft"
    });
    expect(score({ disused: "yes", man_made: "adit", name: "Old Level" })).toMatchObject({ level: 2, kind: "mine", what: "Disused adit", name: "Old Level" });
    expect(score({ abandoned: "yes", man_made: "mineshaft" })).toMatchObject({ level: 3, kind: "mine", what: "Abandoned mineshaft" });
    expect(score({ "abandoned:man_made": "adit" })).toMatchObject({ level: 3, kind: "mine", what: "Abandoned adit", why: "abandoned:man_made=adit" });
    expect(score({ "disused:man_made": "mineshaft" })).toMatchObject({ level: 2, kind: "mine" });
    expect(score({ "was:man_made": "adit" })).toMatchObject({ level: 2, kind: "mine", what: "Former adit" });
  });

  it("a name hint or an end date on a mine opening still only counts as maybe", () => {
    expect(score({ man_made: "adit", name: "Former Mine Entrance" })).toMatchObject({ level: 1, kind: "mine" });
    expect(score({ man_made: "mineshaft", end_date: "1950" })).toMatchObject({ level: 1, kind: "mine" });
  });

  it("an ordinary working mine opening with no lifecycle tag is not a candidate", () => {
    expect(score({ man_made: "mineshaft" })).toBeNull();
    expect(score({ man_made: "adit", name: "Visitor Mine" })).toBeNull();
  });

  it("do not change the kind of other industrial structures", () => {
    expect(score({ "abandoned:man_made": "works" })).toMatchObject({ kind: "industrial", what: "Abandoned works" });
  });

  it("parse with the mine kind and a level", () => {
    const [item] = parseAbandoned([{ type: "node", id: 7, lat: 50.5, lon: 10.5, tags: { disused: "yes", man_made: "adit" } }], NOW);
    expect(item).toEqual(["n7", 50.5, 10.5, "mine", "", "Disused adit", "disused=yes, man_made=adit", 2]);
  });
});

describe("names and tag lists", () => {
  it("falls back through the other name tags and trims long names", () => {
    expect(score({ "disused:amenity": "cinema", "disused:name": "Roxy" })?.name).toBe("Roxy");
    expect(score({ "disused:amenity": "cinema", "was:name": "Plaza" })?.name).toBe("Plaza");
    expect(score({ "disused:amenity": "cinema", old_name: "Palace" })?.name).toBe("Palace");
    expect(score({ "disused:amenity": "cinema", name: "x".repeat(200) })?.name).toHaveLength(80);
  });

  it("lists at most six tags in the why", () => {
    const s = score({
      "abandoned:amenity": "school",
      "abandoned:building": "yes",
      "disused:shop": "supermarket",
      "was:office": "yes",
      end_date: "2012",
      opening_hours: "closed",
      name: "Former School",
      amenity: "school"
    });
    expect(s?.why.split(", ").length).toBeLessThanOrEqual(6);
    expect(s?.why.startsWith("abandoned:")).toBe(true);
  });
});

describe("endDateIsPast", () => {
  it("handles years, months and days against today", () => {
    expect(endDateIsPast("2025", NOW)).toBe(true);
    expect(endDateIsPast("2026", NOW)).toBe(false); // this year is not over
    expect(endDateIsPast("2027", NOW)).toBe(false);
    expect(endDateIsPast("2026-09", NOW)).toBe(true);
    expect(endDateIsPast("2026-10", NOW)).toBe(false);
    expect(endDateIsPast("2026-10-06", NOW)).toBe(true);
    expect(endDateIsPast("2026-10-07", NOW)).toBe(false);
    expect(endDateIsPast("2026-12-31", NOW)).toBe(false);
    expect(endDateIsPast("~1990", NOW)).toBe(false);
    expect(endDateIsPast(undefined, NOW)).toBe(false);
  });
});

describe("parseAbandoned", () => {
  const els = [
    { type: "node", id: 11, lat: 40.123456789, lon: -79.987654321, tags: { building: "ruins" } },
    { type: "way", id: 22, center: { lat: 41.5, lon: -80.5 }, tags: { "disused:amenity": "school" } },
    { type: "relation", id: 33, center: { lat: 42, lon: -81 }, tags: { historic: "ruins", name: "Fort" } },
    { type: "way", id: 44, tags: { building: "ruins" } }, // no centre
    { type: "node", id: 55, lat: 1, lon: 1, tags: { building: "house" } }, // not a candidate
    { type: "area", id: 66, lat: 1, lon: 1, tags: { building: "ruins" } }, // unknown element type
    { type: "node", lat: 1, lon: 1, tags: { building: "ruins" } } // no id
  ];

  it("keeps the qualifying elements with a typed id, rounded position, plain words, why and level", () => {
    const out = parseAbandoned(els, NOW);
    expect(out.map((p) => p[0])).toEqual(["n11", "w22", "r33"]);
    expect(out[0]).toEqual(["n11", 40.12346, -79.98765, "ruins", "", "Ruined building", "building=ruins", 3]);
    expect(out[1]).toEqual(["w22", 41.5, -80.5, "civic", "", "Disused school", "disused:amenity=school", 2]);
    expect(out[2]?.[4]).toBe("Fort");
  });

  it("copes with junk", () => {
    expect(parseAbandoned([], NOW)).toEqual([]);
    expect(parseAbandoned([null, 3, "x", {}], NOW)).toEqual([]);
  });
});

describe("what Overpass is asked for", () => {
  it("covers the lifecycle prefixes across the main keys", () => {
    const all = [...CORE_FILTERS, ...LIFECYCLE_FILTERS].join(" ");
    for (const prefix of ["abandoned", "disused", "was"]) {
      for (const base of ["amenity", "shop", "building", "leisure", "tourism", "office", "craft", "man_made", "industrial", "healthcare"]) {
        expect(all).toContain(`["${prefix}:${base}"]`);
      }
      expect(all).toContain(`["${prefix}:railway"~`);
    }
  });

  it("never asks for railway or highway lines, and not for the searches that time out", () => {
    const all = [...CORE_FILTERS, ...LIFECYCLE_FILTERS].join(" ");
    expect(all).not.toContain('"railway"="abandoned"');
    expect(all).not.toContain("highway");
    expect(all).not.toContain('"name"~');
    expect(all).not.toContain("end_date");
  });
});

describe("humanise", () => {
  it("makes a tag value readable", () => {
    expect(humanise("place_of_worship")).toBe("Place of worship");
    expect(humanise("  ")).toBe("");
  });
});
