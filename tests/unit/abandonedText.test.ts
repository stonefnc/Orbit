import { describe, expect, it } from "vitest";
import {
  ABANDONED_COVERAGE,
  DEFAULT_MIN_LEVEL,
  LEVEL_COLOR,
  LEVEL_LABEL,
  LEVEL_PIN_SCALE,
  LIKELIHOOD_NOTE,
  MINE_HAZARD,
  MIN_LEVEL_CHOICES,
  osmUrl,
  placeKicker,
  placeRows,
  placeTitle,
  statusText,
  trespassersUrl,
  type AbandonedPlace
} from "../../src/layers/abandonedText";

const school: AbandonedPlace = ["w123", 40.12345678, -79.5, "civic", "Hill School", "Abandoned school", "abandoned=yes, amenity=school", 3];
const unnamedShop: AbandonedPlace = ["n9", 10, 20, "building", "", "Disused supermarket", "disused:shop=supermarket", 2];
const maybePub: AbandonedPlace = ["n10", 10, 20, "civic", "", "Closed pub", "end_date=2012, amenity=pub", 1];

describe("links", () => {
  it("builds the OpenStreetMap page for each element type and refuses odd ids", () => {
    expect(osmUrl("n123")).toBe("https://www.openstreetmap.org/node/123");
    expect(osmUrl("w45")).toBe("https://www.openstreetmap.org/way/45");
    expect(osmUrl("r6")).toBe("https://www.openstreetmap.org/relation/6");
    for (const bad of ["", "x1", "n", "n1/../2", "n1234567890123", "123", "javascript:alert(1)"]) expect(osmUrl(bad)).toBeNull();
  });

  it("links out to TrespassersHQ's explore map at street zoom, with the place's position", () => {
    expect(trespassersUrl(40.12345678, -79.5)).toBe("https://trespassershq.com/explore/?lat=40.12346&lng=-79.50000&z=17");
    expect(trespassersUrl(-33.9, 151.2)).toBe("https://trespassershq.com/explore/?lat=-33.90000&lng=151.20000&z=17");
  });
});

describe("card text", () => {
  it("titles a place by its name, or by its plain description when it has none", () => {
    expect(placeTitle(school)).toBe("Hill School");
    expect(placeTitle(unnamedShop)).toBe("Disused supermarket");
    expect(placeTitle(maybePub)).toBe("Closed pub");
  });

  it("shows the level first, then what it is and the exact tags behind it", () => {
    const rows = placeRows(school);
    expect(rows[0]).toEqual(["Likelihood", "Very likely"]);
    expect(rows).toContainEqual(["What", "Abandoned school"]);
    expect(rows).toContainEqual(["Why", "abandoned=yes, amenity=school"]);
    expect(rows).toContainEqual(["Location", "40.1235°, -79.5000°"]);
    expect(placeRows(maybePub)[0]).toEqual(["Likelihood", "Maybe"]);
  });

  it("gives no access or entry details anywhere on the card", () => {
    const text = JSON.stringify([school, unnamedShop, maybePub].map((p) => [placeTitle(p), placeKicker(p), placeRows(p)])).toLowerCase();
    for (const word of ["enter", "entry", "access", "gate", "fence", "hole", "climb", "security", "guard", "break in"]) {
      expect(text).not.toContain(` ${word}`);
    }
    expect(placeRows(school).find((r) => r[0] === "Note")?.[1]).toMatch(/private|unsafe|gone/);
  });

  it("shows one plain hazard line on the card of a mine shaft or adit, and on nothing else", () => {
    const shaft: AbandonedPlace = ["n7", 50.5, 10.5, "mine", "", "Disused mineshaft", "disused=yes, man_made=mineshaft", 2];
    expect(MINE_HAZARD).toBe("Mine shaft or adit: an open hole that can be deep and unstable");
    const rows = placeRows(shaft);
    expect(rows).toContainEqual(["Hazard", MINE_HAZARD]);
    expect(rows.filter((r) => r[0] === "Hazard")).toHaveLength(1);
    expect(placeRows(shaft)[0]).toEqual(["Likelihood", "Likely"]);
    expect(placeTitle(shaft)).toBe("Disused mineshaft");
    for (const p of [school, unnamedShop, maybePub]) expect(placeRows(p).some((r) => r[0] === "Hazard")).toBe(false);
  });

  it("names the level in the kicker", () => {
    expect(placeKicker(school)).toBe("Very likely abandoned");
    expect(placeKicker(unnamedShop)).toBe("Likely abandoned");
    expect(placeKicker(maybePub)).toBe("Maybe abandoned");
  });
});

describe("levels and wording", () => {
  it("has a label, a colour and a pin size for every level, stronger levels standing out more", () => {
    expect(LEVEL_LABEL).toEqual(["Unlikely", "Maybe", "Likely", "Very likely"]);
    for (const c of LEVEL_COLOR) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(LEVEL_COLOR).size).toBe(4);
    for (let i = 1; i < 4; i++) expect(LEVEL_PIN_SCALE[i]!).toBeGreaterThan(LEVEL_PIN_SCALE[i - 1]!);
  });

  it("shows likely and up by default and offers more or fewer", () => {
    expect(DEFAULT_MIN_LEVEL).toBe(2);
    expect(MIN_LEVEL_CHOICES.map((c) => c.value)).toEqual([3, 2, 1]);
    expect(MIN_LEVEL_CHOICES.find((c) => c.value === DEFAULT_MIN_LEVEL)?.label).toBe("Likely and up");
  });

  it("carries the agreed honesty wording", () => {
    expect(LIKELIHOOD_NOTE).toBe(
      "Likelihood from OpenStreetMap tags, not a site visit. Places can be demolished, reopened or guarded; not a guide to entering them."
    );
    expect(ABANDONED_COVERAGE).toBe(
      "From OpenStreetMap: places mappers tagged abandoned, disused or ruined. As complete as local mapping, not a guide to entering them."
    );
  });
});

describe("statusText", () => {
  it("says how many are shown and how many weaker ones are hidden", () => {
    expect(statusText(35, [2, 40, 20, 15], 2, false)).toBe("35 places · 40 maybe hidden · from OpenStreetMap");
    expect(statusText(15, [2, 40, 20, 15], 3, false)).toBe("15 places · 40 maybe hidden · 20 likely hidden · from OpenStreetMap");
    expect(statusText(75, [2, 40, 20, 15], 1, false)).toBe("75 places · from OpenStreetMap");
    expect(statusText(1, [0, 0, 1, 0], 2, false)).toBe("1 place · from OpenStreetMap");
    expect(statusText(2500, [0, 0, 3000, 0], 2, true)).toBe("2,500 places (most likely shown) · from OpenStreetMap");
  });

  it("copes with missing counts", () => {
    expect(statusText(3, [], 2, false)).toBe("3 places · from OpenStreetMap");
  });
});
