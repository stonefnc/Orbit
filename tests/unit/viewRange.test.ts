import { describe, expect, it } from "vitest";
import {
  ALPR_PAN_RADIUS_M,
  CCTV_FACING_DEPTH_M,
  CCTV_LIKELY_DEPTH_M,
  CCTV_LIKELY_WIDTH_DEG,
  CCTV_UNKNOWN_RADIUS_M,
  FLOCK_READ_RANGE_M,
  GENERIC_ALPR_RANGE_M,
  planAlprView,
  planCctvView
} from "../../src/viewRangePlan";

describe("planAlprView", () => {
  it("draws an estimated 40 degree cone at Flock's published 23 m for a mapped Flock bearing", () => {
    const p = planAlprView({ bearingDeg: 250, vendor: "Flock Safety", notes: "camera:type=fixed" });
    expect(p).toMatchObject({ kind: "cone", bearingDeg: 250, widthDeg: 40, depthM: FLOCK_READ_RANGE_M, basis: "estimated" });
    expect(p.detail).toMatch(/^Estimated:/);
    expect(p.detail).toContain("75 ft");
    expect(p.summary).toBe("40° × 23 m (estimated)");
  });

  it("keeps the map label short enough not to cover the icon", () => {
    expect(planAlprView({ bearingDeg: 250, vendor: "Flock Safety" }).label).toBe("Est. view · 40° × 23 m");
  });

  it("uses the generic 30 m range for other vendors", () => {
    expect(planAlprView({ bearingDeg: 10, vendor: "Motorola Solutions" })).toMatchObject({ depthM: GENERIC_ALPR_RANGE_M });
    expect(planAlprView({ bearingDeg: 10 })).toMatchObject({ kind: "cone", basis: "estimated" });
  });

  it("trusts a real field of view and range from the data, and says so", () => {
    const p = planAlprView({ bearingDeg: 90, fovDeg: 30, rangeMeters: 45 });
    expect(p).toMatchObject({ kind: "cone", widthDeg: 30, depthM: 45, basis: "data" });
    expect(p.detail).toContain("from the data source");
    expect(p.summary).toContain("from the data");
  });

  it("ignores implausible data values and falls back to the estimate", () => {
    expect(planAlprView({ bearingDeg: 90, fovDeg: 400, rangeMeters: 45 })).toMatchObject({ basis: "estimated", widthDeg: 40 });
    expect(planAlprView({ bearingDeg: 90, fovDeg: 30, rangeMeters: 5000 })).toMatchObject({ basis: "estimated" });
  });

  it("always draws something: a faint circle labelled 'Direction not recorded' without a bearing", () => {
    const p = planAlprView({ bearingDeg: null, vendor: "Flock Safety" });
    expect(p).toMatchObject({ kind: "circle", radiusM: FLOCK_READ_RANGE_M, label: "Direction not recorded" });
    expect(p.detail).toMatch(/^Estimated:/);
    expect(planAlprView({}).kind).toBe("circle");
  });

  it("shows a faint circle, not a cone, for cameras that can pan", () => {
    for (const t of ["dome", "panning", "ptz", "panorama_with_ptz"]) {
      expect(planAlprView({ bearingDeg: 90, notes: `surveillance=public · camera:type=${t}` })).toMatchObject({
        kind: "circle",
        radiusM: ALPR_PAN_RADIUS_M
      });
    }
  });
});

describe("planCctvView", () => {
  it("draws an estimated cone for a direction the agency says the camera faces", () => {
    const p = planCctvView({ headingDeg: 90, headingKind: "facing" });
    expect(p).toMatchObject({ kind: "cone", widthDeg: 60, depthM: CCTV_FACING_DEPTH_M, basis: "estimated" });
    expect(p.detail).toMatch(/^Estimated:/);
  });

  it("draws a wide 'likely view' cone, not an arrow, for traffic direction", () => {
    const p = planCctvView({ headingDeg: 90, headingKind: "traffic-direction" });
    expect(p).toMatchObject({ kind: "cone", widthDeg: CCTV_LIKELY_WIDTH_DEG, depthM: CCTV_LIKELY_DEPTH_M, basis: "likely" });
    expect(p.label).toBe("Likely view: traffic direction E (not published)");
    expect(p.detail).toContain("not the camera's real field of view");
  });

  it("draws a faint circle when the direction is unknown, or a kind has no number", () => {
    expect(planCctvView({ headingDeg: null, headingKind: "unknown" })).toMatchObject({ kind: "circle", radiusM: CCTV_UNKNOWN_RADIUS_M });
    expect(planCctvView({ headingDeg: null, headingKind: "facing" }).kind).toBe("circle");
    expect(planCctvView({ headingDeg: null, headingKind: "traffic-direction" }).kind).toBe("circle");
  });

  it("never presents an inferred direction as a real view", () => {
    expect(planCctvView({ headingDeg: 45, headingKind: "unknown" }).kind).toBe("circle");
    expect(planCctvView({ headingDeg: 45, headingKind: "traffic-direction" })).toMatchObject({ basis: "likely" });
  });

  it("every plan has a summary for the card row", () => {
    for (const k of ["facing", "traffic-direction", "unknown"] as const) {
      expect(planCctvView({ headingDeg: 10, headingKind: k }).summary.length).toBeGreaterThan(5);
    }
  });
});
