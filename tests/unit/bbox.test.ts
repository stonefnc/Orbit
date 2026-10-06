import { describe, expect, it } from "vitest";
import { boundingBoxesFromCenterNm, boxContainsBox } from "../../server/lib/bbox";

describe("boundingBoxesFromCenterNm (the area asked of AISStream)", () => {
  it("makes one box around a small view", () => {
    const boxes = boundingBoxesFromCenterNm(50, 0, 60);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.lamax - boxes[0]!.lamin).toBeCloseTo(2, 5);
  });
  it("covers every longitude for a planet-sized request", () => {
    const boxes = boundingBoxesFromCenterNm(0, 0, 10800);
    expect(boxes).toEqual([{ lamin: -85, lamax: 85, lomin: -180, lomax: 180 }]);
  });
  it("splits a box that crosses the antimeridian into two", () => {
    const boxes = boundingBoxesFromCenterNm(0, 179, 300);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.lomax).toBe(180);
    expect(boxes[1]!.lomin).toBe(-180);
  });
  it("keeps latitude inside +-85 near the poles", () => {
    const [box] = boundingBoxesFromCenterNm(84, 10, 1000);
    expect(box!.lamax).toBeLessThanOrEqual(85);
  });
});

describe("boxContainsBox", () => {
  const big = { lamin: -10, lamax: 10, lomin: -10, lomax: 10 };
  it("accepts a box fully inside", () => expect(boxContainsBox(big, { lamin: -1, lamax: 1, lomin: -1, lomax: 1 })).toBe(true));
  it("rejects a box that sticks out", () => expect(boxContainsBox(big, { lamin: -1, lamax: 11, lomin: -1, lomax: 1 })).toBe(false));
});
