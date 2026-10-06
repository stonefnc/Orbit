import { describe, expect, it } from "vitest";
import {
  clearManualLocation,
  geolocationBlockedReason,
  getManualLocation,
  MANUAL_LOCATION_KEY,
  parseLatLon,
  parseManualLocation,
  setManualLocation
} from "../../src/manualLocation";

function memoryStore(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k)
  };
}

describe("geolocationBlockedReason", () => {
  it("blocks an insecure page (plain http on a LAN address) before anything else", () => {
    expect(geolocationBlockedReason({ secure: false, hasApi: true })).toBe("insecure");
    expect(geolocationBlockedReason({ secure: false, hasApi: false })).toBe("insecure");
  });
  it("allows a secure page that has the API and reports a missing API", () => {
    expect(geolocationBlockedReason({ secure: true, hasApi: true })).toBeNull();
    expect(geolocationBlockedReason({ secure: true, hasApi: false })).toBe("unsupported");
  });
});

describe("manual location storage", () => {
  it("saves a rounded point, reads it back and clears it", () => {
    const s = memoryStore();
    expect(getManualLocation(s)).toBeNull();
    const saved = setManualLocation(33.4501234567, -84.1234567891, "  Home  ", s, 123);
    expect(saved).toEqual({ lat: 33.45012, lon: -84.12346, label: "Home", at: 123 });
    expect(getManualLocation(s)).toEqual(saved);
    clearManualLocation(s);
    expect(getManualLocation(s)).toBeNull();
  });
  it("refuses points that are not on Earth and ignores corrupt stored values", () => {
    const s = memoryStore();
    expect(setManualLocation(91, 0, "", s)).toBeNull();
    expect(setManualLocation(0, 181, "", s)).toBeNull();
    expect(setManualLocation(Number.NaN, 0, "", s)).toBeNull();
    expect(s.data.size).toBe(0);
    s.data.set(MANUAL_LOCATION_KEY, "{not json");
    expect(getManualLocation(s)).toBeNull();
    expect(parseManualLocation(JSON.stringify({ lat: "x", lon: 1 }))).toBeNull();
  });
  it("works without any storage", () => {
    expect(setManualLocation(10, 20, "x", null)).toMatchObject({ lat: 10, lon: 20 });
    expect(getManualLocation(null)).toBeNull();
  });
});

describe("parseLatLon", () => {
  it("accepts 'lat, lon' and 'lat lon' and rejects the rest", () => {
    expect(parseLatLon("33.45, -84.12")).toEqual({ lat: 33.45, lon: -84.12 });
    expect(parseLatLon(" 10 20 ")).toEqual({ lat: 10, lon: 20 });
    expect(parseLatLon("95, 10")).toBeNull();
    expect(parseLatLon("Atlanta")).toBeNull();
  });
});
