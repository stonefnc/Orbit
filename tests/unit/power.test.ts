import { describe, expect, it } from "vitest";
import { csvFields, maxKv, parsePower } from "../../server/lib/power";

describe("csvFields", () => {
  it("splits plain fields", () => {
    expect(csvFields("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("keeps commas inside quotes", () => {
    expect(csvFields('x,"Smith, John",y')).toEqual(["x", "Smith, John", "y"]);
  });
  it("unescapes doubled quotes", () => {
    expect(csvFields('"say ""hi""",2')).toEqual(['say "hi"', "2"]);
  });
  it("keeps empty fields", () => {
    expect(csvFields("a,,c,")).toEqual(["a", "", "c", ""]);
  });
});

describe("maxKv", () => {
  it("reads volts as kilovolts", () => {
    expect(maxKv("220000")).toBe(220);
  });
  it("takes the highest of several values", () => {
    expect(maxKv("110000;380000;220000")).toBe(380);
  });
  it("is 0 for missing or unreadable values", () => {
    expect(maxKv(undefined)).toBe(0);
    expect(maxKv("high")).toBe(0);
  });
});

describe("parsePower", () => {
  const line = (tags: Record<string, string>, geometry = [{ lat: 10, lon: 10 }, { lat: 10.5, lon: 10.5 }, { lat: 11, lon: 11 }]) => ({
    type: "way",
    id: 7,
    tags,
    geometry
  });

  it("keeps a 380 kV line and marks its voltage", () => {
    const out = parsePower([line({ power: "line", voltage: "380000", name: "A - B" })]);
    expect(out).toHaveLength(1);
    expect(out[0]![0]).toBe("l");
    expect(out[0]![2]).toBe(380);
    expect(out[0]![3]).toBe("A - B");
  });

  it("drops lines under 200 kV", () => {
    expect(parsePower([line({ power: "line", voltage: "110000" })])).toHaveLength(0);
  });

  it("flags DC lines as HVDC", () => {
    const out = parsePower([line({ power: "line", voltage: "500000", frequency: "0" })]);
    expect((out[0] as unknown[])[6]).toBe(1);
  });

  it("stores line points as [lon, lat, ...] and keeps the first and last", () => {
    const out = parsePower([line({ power: "line", voltage: "220000" })]);
    const pts = (out[0] as unknown[])[7] as number[];
    expect(pts.slice(0, 2)).toEqual([10, 10]);
    expect(pts.slice(-2)).toEqual([11, 11]);
  });

  it("reads a substation node and numbers way substations negatively", () => {
    const node = { type: "node", id: 5, lat: 1.5, lon: 2.5, tags: { power: "substation", voltage: "345000", name: "S1" } };
    const way = { type: "way", id: 9, tags: { power: "substation", voltage: "345000" }, geometry: [{ lat: 0, lon: 0 }, { lat: 2, lon: 2 }] };
    const out = parsePower([node, way]);
    expect(out[0]).toEqual(["s", 5, 1.5, 2.5, 345, "S1", ""]);
    expect(out[1]![1]).toBe(-9);
    expect((out[1] as unknown[])[2]).toBe(1);
  });
});
