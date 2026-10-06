import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cooldownRemainingMs, recordSuccess } from "../../server/lib/providerGate";
import { keepTrackKey, keepTrackRouter, keepTrackUpstreamPath } from "../../server/routes/keeptrack";

const realFetch = globalThis.fetch;
const KEY = "kt-test-key-0123456789"; // gitleaks:allow (a placeholder, not a real key)

describe("keepTrackUpstreamPath (which KeepTrack paths the browser may ask for)", () => {
  it("accepts exactly the paths src/providers/keeptrack.ts uses", () => {
    for (const p of ["/v4/sats", "/v4/sats/celestrak", "/v4/sats/brief", "/v4/sat/25544", "/v4/sat/5"]) {
      expect(keepTrackUpstreamPath(p)).toBe(p);
    }
  });
  it("refuses everything else", () => {
    for (const p of [
      "",
      "/",
      "/v4",
      "/v4/sats/full",
      "/v4/sats/brief/",
      "/v4/sats/../users",
      "/v4/sat/",
      "/v4/sat/12ab",
      "/v4/sat/1234567890",
      "/v4/sat/25544/extra",
      "/v3/sats",
      "//v4/sats",
      "/v4/sats%2Fbrief",
      "/v4/sats?x=1",
      "https://evil.example/v4/sats",
      "/v4/users"
    ]) {
      expect(keepTrackUpstreamPath(p), p).toBeNull();
    }
  });
});

describe("/api/keeptrack", () => {
  let server: Server;
  let base: string;
  const upstream = vi.fn();
  const saved = { a: process.env.KEEPTRACK_API_KEY, b: process.env.VITE_KEEPTRACK_API_KEY };

  beforeAll(async () => {
    const app = express();
    app.use("/api/keeptrack", keepTrackRouter());
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/keeptrack`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    process.env.KEEPTRACK_API_KEY = KEY;
    delete process.env.VITE_KEEPTRACK_API_KEY;
    recordSuccess("keeptrack");
    upstream.mockReset();
    // Only KeepTrack is stubbed; the test's own calls use `realFetch`.
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      String(url).startsWith("https://api.keeptrack.space") ? upstream(String(url), init) : realFetch(url, init)
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    recordSuccess("keeptrack");
    if (saved.a === undefined) delete process.env.KEEPTRACK_API_KEY;
    else process.env.KEEPTRACK_API_KEY = saved.a;
    if (saved.b === undefined) delete process.env.VITE_KEEPTRACK_API_KEY;
    else process.env.VITE_KEEPTRACK_API_KEY = saved.b;
  });

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  it("reports whether the server holds a key, and never the key itself", async () => {
    let res = await realFetch(`${base}/status`);
    expect(await res.json()).toEqual({ available: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    delete process.env.KEEPTRACK_API_KEY;
    res = await realFetch(`${base}/status`);
    expect(await res.json()).toEqual({ available: false });
  });

  it("sends the key upstream as Orbit and streams the answer back without exposing the key", async () => {
    upstream.mockResolvedValue(json([{ name: "ISS", tle1: "1 ...", tle2: "2 ..." }]));
    const res = await realFetch(`${base}/v4/sats/brief?x=1&apikey=nope`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ name: "ISS", tle1: "1 ...", tle2: "2 ..." }]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect([...res.headers.entries()].join("\n")).not.toContain(KEY);

    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.keeptrack.space/v4/sats/brief"); // the caller's query string is not forwarded
    const h = init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe(KEY);
    expect(h["User-Agent"]).toMatch(/^Orbit\//);
  });

  it("refuses paths it does not know without calling KeepTrack", async () => {
    for (const p of ["/v4/sats/full", "/v4/users", "/v4/sat/abc"]) {
      const res = await realFetch(`${base}${p}`);
      expect(res.status, p).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers 503 and does not call KeepTrack when the server has no key", async () => {
    delete process.env.KEEPTRACK_API_KEY;
    const res = await realFetch(`${base}/v4/sats/brief`);
    expect(res.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not turn a 404 for an unknown satellite into a cooldown", async () => {
    upstream.mockResolvedValue(json({ message: "nope" }, 404));
    const res = await realFetch(`${base}/v4/sat/99999`);
    expect(res.status).toBe(404);
    expect(cooldownRemainingMs("keeptrack")).toBe(0);
  });

  it("hides a 401 from the browser and cools down so a bad key is not hammered", async () => {
    upstream.mockResolvedValue(json({ message: `bad key ${KEY}` }, 401));
    let res = await realFetch(`${base}/v4/sats/brief`);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(KEY);
    expect(cooldownRemainingMs("keeptrack")).toBeGreaterThan(0);

    upstream.mockClear();
    res = await realFetch(`${base}/v4/sats/brief`);
    expect(res.status).toBe(503);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not follow redirects (the key header must not travel elsewhere)", async () => {
    upstream.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const res = await realFetch(`${base}/v4/sats/brief`);
    expect(res.status).toBe(502);
    const [, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("passes a 429 on with KeepTrack's own Retry-After and no server cooldown", async () => {
    upstream.mockResolvedValue(json({}, 429, { "retry-after": "120" }));
    let res = await realFetch(`${base}/v4/sats/celestrak`);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("120");
    expect(cooldownRemainingMs("keeptrack")).toBe(0);

    // The browser's retry reaches KeepTrack instead of landing in a server cooldown.
    upstream.mockResolvedValue(json([{ name: "ISS" }]));
    res = await realFetch(`${base}/v4/sats/celestrak`);
    expect(res.status).toBe(200);
  });

  it("passes a 5xx on with its Retry-After and no server cooldown", async () => {
    upstream.mockResolvedValue(json({}, 503, { "retry-after": "30" }));
    let res = await realFetch(`${base}/v4/sats/brief`);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    upstream.mockResolvedValue(json({}, 500));
    res = await realFetch(`${base}/v4/sats/brief`);
    expect(res.status).toBe(502);
    expect(res.headers.get("retry-after")).toBeNull();
    expect(cooldownRemainingMs("keeptrack")).toBe(0);
  });

  it("answers 502 without a server cooldown when KeepTrack cannot be reached", async () => {
    upstream.mockRejectedValue(new TypeError("fetch failed"));
    const res = await realFetch(`${base}/v4/sats/brief`);
    expect(res.status).toBe(502);
    expect(cooldownRemainingMs("keeptrack")).toBe(0);
  });
});

describe("keepTrackKey", () => {
  const saved = { a: process.env.KEEPTRACK_API_KEY, b: process.env.VITE_KEEPTRACK_API_KEY };
  afterEach(() => {
    if (saved.a === undefined) delete process.env.KEEPTRACK_API_KEY;
    else process.env.KEEPTRACK_API_KEY = saved.a;
    if (saved.b === undefined) delete process.env.VITE_KEEPTRACK_API_KEY;
    else process.env.VITE_KEEPTRACK_API_KEY = saved.b;
  });

  it("reads KEEPTRACK_API_KEY and trims it", () => {
    process.env.KEEPTRACK_API_KEY = "  abc123  ";
    expect(keepTrackKey()).toBe("abc123");
  });
  it("ignores the retired VITE_ name and treats a blank key as empty", () => {
    process.env.KEEPTRACK_API_KEY = "  ";
    process.env.VITE_KEEPTRACK_API_KEY = "legacy";
    expect(keepTrackKey()).toBe("");
  });
  it("is empty when nothing is set", () => {
    delete process.env.KEEPTRACK_API_KEY;
    delete process.env.VITE_KEEPTRACK_API_KEY;
    expect(keepTrackKey()).toBe("");
  });
});
