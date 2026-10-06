import { describe, expect, it } from "vitest";
import { eventNewsQuery, fireName, quakePlace } from "../../server/lib/eventNews";

describe("event news queries", () => {
  it("takes the named place from a USGS quake description", () => {
    expect(quakePlace("12 km SW of Ridgecrest, CA")).toBe("Ridgecrest");
    expect(quakePlace("Fiji region")).toBe("Fiji region");
    expect(quakePlace("27 km NNE of Hualien City, Taiwan")).toBe("Hualien City");
  });

  it("takes the incident name from a fire title", () => {
    expect(fireName("Bear Fire, Placer, California")).toBe("Bear Fire");
    expect(fireName("Park Fire (CA-BTU-12345)")).toBe("Park Fire");
  });

  it("builds a quake query and a fire query", () => {
    expect(eventNewsQuery("quake", "12 km SW of Ridgecrest, CA")).toBe('earthquake "Ridgecrest" sourcelang:eng');
    expect(eventNewsQuery("fire", "Bear Fire, Placer, California")).toBe(
      '"Bear Fire" (wildfire OR fire OR evacuations) sourcelang:eng'
    );
  });

  it("strips anything that could change the query syntax", () => {
    const q = eventNewsQuery("quake", 'x of Bad" OR (sourcelang:fra) place');
    expect(q).not.toBeNull();
    expect(q!.slice(q!.indexOf('"') + 1, q!.lastIndexOf('"'))).toMatch(/^[A-Za-z0-9 ]+$/);
  });

  it("skips names too vague to search for", () => {
    expect(eventNewsQuery("fire", "Fire")).toBeNull();
    expect(eventNewsQuery("fire", "Unnamed")).toBeNull();
    expect(eventNewsQuery("quake", "")).toBeNull();
  });
});
