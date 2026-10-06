import { describe, expect, it } from "vitest";
import { Cartesian3, Ellipsoid } from "cesium";
import { horizonDistance } from "../../src/horizon";

const fromDeg = (lon: number, lat: number, h = 0) => Cartesian3.fromDegrees(lon, lat, h, Ellipsoid.WGS84);
const dist = (a: Cartesian3, b: Cartesian3) => Cartesian3.distance(a, b);

describe("horizonDistance", () => {
  // The opening view: the camera ~24,000 km above North America.
  const camera = fromDeg(-95, 40, 24_000_000);
  const limit = horizonDistance(camera);

  it("keeps every near-side surface point within the limit", () => {
    for (const [lon, lat] of [[-95, 40], [-60, 10], [-150, 60], [-40, 45], [-120, -20]]) {
      expect(dist(camera, fromDeg(lon, lat))).toBeLessThan(limit);
    }
  });

  it("puts far-side points beyond it, so the globe hides them", () => {
    for (const [lon, lat] of [[85, -40], [60, 0], [120, 30], [20, -60], [150, -10]]) {
      expect(dist(camera, fromDeg(lon, lat))).toBeGreaterThan(limit);
    }
  });

  it("is at most 2 % above the geometric horizon distance (polar radius)", () => {
    const r = Ellipsoid.WGS84.minimumRadius;
    const exact = Math.sqrt(Cartesian3.magnitudeSquared(camera) - r * r);
    expect(limit).toBeGreaterThanOrEqual(exact);
    expect(limit / exact).toBeLessThanOrEqual(1.02 + 1e-9);
  });

  it("changes in steps, so small camera moves leave it unchanged", () => {
    expect(horizonDistance(fromDeg(-95, 40, 24_000_100))).toBe(limit);
  });

  it("stays positive at the surface", () => {
    expect(horizonDistance(fromDeg(0, 90, 0))).toBeGreaterThan(0);
  });
});
