import { describe, expect, it } from "vitest";
import { aisOriginAllowed, isPrivateIpv4 } from "../../server/lib/wsOrigin";

const PC = "192.168.1.20:5173";

describe("isPrivateIpv4", () => {
  it("accepts the three private ranges", () => {
    for (const ip of ["10.0.0.5", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.0.1", "192.168.1.20"]) {
      expect(isPrivateIpv4(ip), ip).toBe(true);
    }
  });
  it("refuses public, loopback, link-local and edge-of-range addresses", () => {
    for (const ip of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "192.167.1.1", "192.169.1.1", "11.0.0.1", "127.0.0.1", "169.254.1.1", "100.64.0.1"]) {
      expect(isPrivateIpv4(ip), ip).toBe(false);
    }
  });
  it("refuses names, out-of-range octets and junk", () => {
    for (const s of ["localhost", "my-pc.local", "192.168.1", "192.168.1.256", "300.1.1.1", "192.168.1.1.1", "", "192.168.1.1:5173"]) {
      expect(isPrivateIpv4(s), s).toBe(false);
    }
  });
});

describe("aisOriginAllowed (who may open the AIS websocket)", () => {
  it("allows non-browser clients that send no Origin, and pages on this computer", () => {
    expect(aisOriginAllowed(undefined, undefined)).toBe(true);
    expect(aisOriginAllowed("http://localhost:5173", "localhost:5173")).toBe(true);
    expect(aisOriginAllowed("http://127.0.0.1:5173", undefined)).toBe(true);
    expect(aisOriginAllowed("http://[::1]:5173", undefined)).toBe(true);
  });

  it("allows a phone on the Wi-Fi address when the page's own origin matches the host it was loaded from", () => {
    expect(aisOriginAllowed(`http://${PC}`, PC)).toBe(true);
    expect(aisOriginAllowed("http://10.0.0.7:5173", "10.0.0.7:5173")).toBe(true);
    expect(aisOriginAllowed("http://172.20.1.2:5173", "172.20.1.2:5173")).toBe(true);
    expect(aisOriginAllowed(`http://${PC}`, `  ${PC} `)).toBe(true);
  });

  it("refuses a LAN origin when the host is missing or different (another device's page, a forged header)", () => {
    expect(aisOriginAllowed(`http://${PC}`, undefined)).toBe(false);
    expect(aisOriginAllowed(`http://${PC}`, "")).toBe(false);
    expect(aisOriginAllowed("http://192.168.1.50:3000", PC)).toBe(false);
    expect(aisOriginAllowed(`http://${PC}`, "192.168.1.20:8080")).toBe(false);
    expect(aisOriginAllowed(`http://${PC}`, `${PC}, evil.example`)).toBe(false);
  });

  it("refuses other websites even when the host header is made to match", () => {
    expect(aisOriginAllowed("http://evil.example", "evil.example")).toBe(false);
    expect(aisOriginAllowed("https://evil.example:5173", "evil.example:5173")).toBe(false);
    // DNS rebinding: a name that now points at this computer is still a name.
    expect(aisOriginAllowed("http://rebind.example:5173", "rebind.example:5173")).toBe(false);
    expect(aisOriginAllowed("http://my-pc.local:5173", "my-pc.local:5173")).toBe(false);
  });

  it("refuses public addresses, look-alikes and odd schemes", () => {
    expect(aisOriginAllowed("http://8.8.8.8:5173", "8.8.8.8:5173")).toBe(false);
    expect(aisOriginAllowed("http://192.168.1.20.evil.example:5173", "192.168.1.20.evil.example:5173")).toBe(false);
    expect(aisOriginAllowed("http://127x0y0z1:5173", "127x0y0z1:5173")).toBe(false);
    expect(aisOriginAllowed("file://192.168.1.20", "192.168.1.20")).toBe(false);
    expect(aisOriginAllowed("null", "null")).toBe(false);
    expect(aisOriginAllowed("not a url", "not a url")).toBe(false);
  });

  it("compares the port too, and ignores letter case", () => {
    expect(aisOriginAllowed("http://192.168.1.20:5174", PC)).toBe(false);
    expect(aisOriginAllowed("http://192.168.1.20", PC)).toBe(false);
    expect(aisOriginAllowed("HTTP://192.168.1.20:5173", PC)).toBe(true);
  });
});
