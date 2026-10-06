import { describe, expect, it } from "vitest";
import { fromThisComputer, upsertEnv } from "../../server/routes/settings";

const req = (opts: { forwarded?: string; remote?: string; origin?: string }) =>
  ({ headers: { ...(opts.forwarded ? { "x-forwarded-for": opts.forwarded } : {}), ...(opts.origin ? { origin: opts.origin } : {}) }, socket: { remoteAddress: opts.remote ?? "127.0.0.1" } }) as never;

describe("fromThisComputer (who may change the keys)", () => {
  it("accepts the computer itself", () => {
    expect(fromThisComputer(req({ remote: "127.0.0.1" }))).toBe(true);
    expect(fromThisComputer(req({ remote: "::1" }))).toBe(true);
    expect(fromThisComputer(req({ remote: "::ffff:127.0.0.1" }))).toBe(true);
  });
  it("accepts a request the dev proxy says came from loopback", () => {
    expect(fromThisComputer(req({ forwarded: "127.0.0.1" }))).toBe(true);
  });
  it("refuses another device on the network", () => {
    expect(fromThisComputer(req({ forwarded: "192.168.1.30" }))).toBe(false);
    expect(fromThisComputer(req({ remote: "192.168.1.30" }))).toBe(false);
  });
  it("is not fooled by a forged header: only the LAST forwarded address counts", () => {
    expect(fromThisComputer(req({ forwarded: "127.0.0.1, 192.168.1.30" }))).toBe(false);
  });
  it("refuses other websites even from this computer", () => {
    expect(fromThisComputer(req({ forwarded: "127.0.0.1", origin: "http://evil.example" }))).toBe(false);
    expect(fromThisComputer(req({ forwarded: "127.0.0.1", origin: "http://localhost:5173" }))).toBe(true);
  });
  it("does not treat look-alike addresses as localhost", () => {
    expect(fromThisComputer(req({ forwarded: "127.0.0.1", origin: "http://127x0y0z1:5173" }))).toBe(false);
  });
});

describe("upsertEnv (writing .env.local)", () => {
  it("replaces an existing key and keeps the others", () => {
    const out = upsertEnv("A=1\nAISSTREAM_API_KEY=old\nB=2\n", { AISSTREAM_API_KEY: "newkey123" });
    expect(out).toBe("A=1\nAISSTREAM_API_KEY=newkey123\nB=2\n");
  });
  it("appends a key that isn't there yet", () => {
    expect(upsertEnv("A=1\n", { FIRMS_MAP_KEY: "abcd1234" })).toBe("A=1\nFIRMS_MAP_KEY=abcd1234\n");
  });
  it("creates the file content when it was empty", () => {
    expect(upsertEnv("", { ADSBX_API_KEY: "abcd1234" })).toBe("ADSBX_API_KEY=abcd1234\n");
  });
  it("removes a key when asked to clear it", () => {
    expect(upsertEnv("A=1\nFIRMS_MAP_KEY=x\n", { FIRMS_MAP_KEY: null })).toBe("A=1\n");
  });
  it("copes with Windows line endings", () => {
    expect(upsertEnv("A=1\r\nOPENSKY_CLIENT_ID=old\r\n", { OPENSKY_CLIENT_ID: "idididid" })).toBe("A=1\nOPENSKY_CLIENT_ID=idididid\n");
  });
});
