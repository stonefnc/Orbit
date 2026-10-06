import { describe, expect, it } from "vitest";
import { angleDiffDeg, bearingDeg, haversineNm } from "../../src/routeMath";
import { flightIdLooksScheduledAirlineStyle } from "../../src/planeTrafficClass";

describe("routeMath", () => {
  it("measures New York to Los Angeles at about 2,150 nautical miles", () => {
    const nm = haversineNm(40.6413, -73.7781, 33.9416, -118.4085);
    expect(nm).toBeGreaterThan(2100);
    expect(nm).toBeLessThan(2200);
  });
  it("gives a due-east bearing along the equator", () => {
    expect(bearingDeg(0, 0, 0, 10)).toBeCloseTo(90, 1);
  });
  it("measures the short way round an angle", () => {
    expect(angleDiffDeg(350, 10)).toBe(20);
    expect(angleDiffDeg(10, 350)).toBe(20);
  });
});

describe("flight id style", () => {
  it("recognises airline-style call signs", () => {
    expect(flightIdLooksScheduledAirlineStyle("DAL123")).toBe(true);
    expect(flightIdLooksScheduledAirlineStyle("UAL2375")).toBe(true);
  });
  it("does not treat tail numbers as airline flights", () => {
    expect(flightIdLooksScheduledAirlineStyle("N123AB")).toBe(false);
    expect(flightIdLooksScheduledAirlineStyle(null)).toBe(false);
  });
});
