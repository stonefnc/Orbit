import { expect, test, type Page } from "@playwright/test";
import { networkInterfaces } from "node:os";

/** Waits until the globe exists and its imagery/terrain set-up has finished (the app marks that moment itself). */
async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Failed network calls to third-party services are not bugs in Orbit; script errors are.
    if (m.type() === "error" && !/Failed to load resource|net::ERR|403|404|429|CORS/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { __orbit?: { viewer?: unknown } }).__orbit?.viewer, undefined, { timeout: 45_000 });
  await page.waitForFunction(() => performance.getEntriesByName("orbit:globe-sources-ready").length > 0, undefined, { timeout: 45_000 });
  return errors;
}

/** How many times the globe was redrawn during `ms` (the app draws only when something changes). */
async function renders(page: Page, ms: number): Promise<number> {
  return page.evaluate(
    (t) =>
      new Promise<number>((resolve) => {
        const v = (window as unknown as { __orbit: { viewer: { scene: { postRender: { addEventListener(f: () => void): void; removeEventListener(f: () => void): void } } } } }).__orbit.viewer;
        let n = 0;
        const f = (): void => void n++;
        v.scene.postRender.addEventListener(f);
        setTimeout(() => {
          v.scene.postRender.removeEventListener(f);
          resolve(n);
        }, t);
      }),
    ms
  );
}

test("starts without script errors and draws the globe", async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator("#globe canvas").first()).toBeVisible();
  await expect(page.locator(".command-header")).toBeVisible();
  expect(errors).toEqual([]);
});

test("settles to a still picture when nothing is switched on (no constant redraw, so nothing to flicker)", async ({ page }) => {
  await openApp(page);
  // Headless Chromium draws in software, so tiles keep streaming for a while. The app must reach a calm state: at
  // least one 4-second window with (almost) no redraws within about 45 seconds.
  const seen: number[] = [];
  for (let i = 0; i < 10; i++) {
    const n = await renders(page, 4000);
    seen.push(n);
    if (n <= 2) return;
  }
  expect(Math.min(...seen), `redraws per 4 s window: ${seen.join(", ")}`).toBeLessThanOrEqual(2);
});
test("a layer can be switched on and off", async ({ page }, info) => {
  await openApp(page);
  if (info.project.name === "phone") await page.locator('[data-menu="layers"]').click();
  const chip = page.locator("#toggle-satellites");
  await chip.click();
  await expect(chip).toContainText("ON", { timeout: 20_000 });
  // On a phone the sheet closes itself once a layer is on; open it again to switch the layer off.
  if (info.project.name === "phone") await page.locator('[data-menu="layers"]').click();
  await chip.click();
  await expect(chip).toContainText("OFF");
});

test("the page never scrolls sideways", async ({ page }) => {
  await openApp(page);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});

test("the Keys menu opens and lists the keys", async ({ page }) => {
  await openApp(page);
  await page.locator('[data-menu="keys"]').click();
  const sheet = page.locator("#keys-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".keys-label")).toHaveCount(8);
  await expect(sheet).toContainText("Cesium ion token");
});

test("the Keys API refuses requests without the safety header and cross-site origins", async ({ request }) => {
  const noHeader = await request.post("/api/settings/keys", { data: { AISSTREAM_API_KEY: "abcd1234" } });
  expect(noHeader.status()).toBe(403);
  const evil = await request.post("/api/settings/keys", {
    data: { AISSTREAM_API_KEY: "abcd1234" },
    headers: { "X-Orbit-Settings": "1", Origin: "http://evil.example" }
  });
  expect(evil.status()).toBe(403);
  const status = await request.get("/api/settings/status");
  expect(status.ok()).toBe(true);
  const body = await status.json();
  expect(body.canEdit).toBe(true);
  // Values are never returned, only whether each key is set.
  expect(JSON.stringify(body)).not.toMatch(/[A-Za-z0-9]{24,}/);
});

/** This computer's Wi-Fi address (what a phone types), or undefined when there is none. */
function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
  }
  return undefined;
}

/** Tries to open the AIS websocket from a page whose address is `pageUrl`; resolves "open" or "refused". */
async function aisSocketFromPage(page: Page, pageUrl: string): Promise<string> {
  // Any document the server really serves at that address will do: the browser sends that address as the websocket's
  // Origin, exactly as a phone does. Don't fake the page with page.route(): Chromium then sees no network address for it,
  // treats it as a public page and blocks the connection itself (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS).
  await page.goto(pageUrl);
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/api/ais/stream`);
        ws.onopen = () => (ws.close(), resolve("open"));
        ws.onerror = () => resolve("refused");
        setTimeout(() => resolve("timeout"), 10_000);
      })
  );
}

test("the AIS stream opens from a page on this computer's Wi-Fi address (a phone in LAN mode)", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "same check for both sizes");
  const lan = lanAddress();
  test.skip(!lan, "no private Wi-Fi address on this computer");
  const lanBase = `http://${lan}:5173`;
  const reachable = await request.get(`${lanBase}/api/settings/status`, { timeout: 5000 }).then((r) => r.ok(), () => false);
  test.skip(!reachable, "the dev server is not in LAN mode (npm run dev:lan)");
  // The refusals (another website, another device's page, a public or named address) are in tests/unit/wsOrigin.test.ts;
  // a browser test can't prove them, because Chromium may block such a page by itself.
  expect(await aisSocketFromPage(page, `${lanBase}/api/settings/status`)).toBe("open");
});

test("phone only: the dock has Map, Layers, Keys and Theme and the sheets open", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  await openApp(page);
  const dock = page.locator(".mobile-dock");
  await expect(dock).toBeVisible();
  await expect(dock.locator("[data-menu]")).toHaveCount(4);
  await page.locator('[data-menu="layers"]').click();
  await expect(page.locator("body")).toHaveClass(/menu-layers-open/);
  await page.locator('[data-menu="map"]').click();
  await expect(page.locator("body")).toHaveClass(/menu-map-open/);
});

test("desktop only: typing an address lists street addresses first and asks the server with a location bias", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "the top-bar search box is collapsed on a phone");
  const asked: string[] = [];
  // The real address services are not called from a test: answer the geocode route with a fixed reply.
  await page.route("**/api/layers/geocode?**", async (route) => {
    asked.push(route.request().url());
    await route.fulfill({
      json: {
        results: [
          { label: "120 Example Dr, Springfield, GA, 30000", lat: 33.4, lon: -84.2, source: "census", address: true, kind: "address" },
          { label: "Example Drive, Springfield, Georgia, United States", lat: 33.39, lon: -84.21, source: "photon", kind: "residential" }
        ],
        unavailable: []
      }
    });
  });
  await openApp(page);
  await page.locator("#loc-search-input").fill("120 example dr springfield");
  const first = page.locator("#loc-suggest .dir-suggest-row", { hasText: "120 Example Dr, Springfield" });
  await expect(first).toBeVisible({ timeout: 15_000 });
  await expect(first).toContainText("Street address");
  expect(asked[0]).toContain("q=120+example+dr+springfield");
  expect(asked[0]).toMatch(/lat=-?\d/); // the view / my location is sent as the ranking bias
  expect(asked[0]).not.toContain("submit=1"); // typing never asks for the Nominatim fallback
});

test("my location on an insecure page (a phone over plain http): says why, and a hand-set location is kept and used", async ({ page }) => {
  // localhost is a secure context, so pretend to be a plain-http LAN page the way iOS Safari sees it.
  await page.addInitScript(() => Object.defineProperty(window, "isSecureContext", { value: false }));
  await openApp(page);
  await page.locator("#loc-locate-btn").click();
  const card = page.locator("#layer-card");
  await expect(card).toContainText("secure connection");
  await card.locator(".manual-loc-finder input").fill("33.45, -84.12");
  await card.getByRole("button", { name: "Find" }).click();
  await expect(card).toContainText("set by you");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("orbit-manual-location") ?? "null"))).toMatchObject({ lat: 33.45, lon: -84.12 });
  // The next tap on the locate button uses the saved point instead of asking again; Clear removes it.
  await page.locator("#loc-locate-btn").click();
  await expect(card).toContainText("Set by hand");
  await card.getByRole("button", { name: "Clear" }).click();
  expect(await page.evaluate(() => localStorage.getItem("orbit-manual-location"))).toBeNull();
});

test("desktop only: a window narrower than 720 px keeps the desktop render and zoom settings (phone layout, no phone mode)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "a mouse-driven browser only");
  await page.setViewportSize({ width: 600, height: 800 });
  await openApp(page);
  await expect(page.locator(".mobile-dock")).toBeVisible(); // the phone layout still applies
  const state = await page.evaluate(() => {
    const v = (window as unknown as { __orbit: { viewer: { useBrowserRecommendedResolution: boolean; scene: { screenSpaceCameraController: { zoomFactor: number } } } } }).__orbit.viewer;
    return { cssPixels: v.useBrowserRecommendedResolution, zoom: v.scene.screenSpaceCameraController.zoomFactor };
  });
  expect(state.cssPixels).toBe(true);
  expect(state.zoom).toBeLessThan(10); // Cesium's stock 5, not the phone's 24
  await page.locator('[data-menu="map"]').click();
  await expect(page.locator("#quality-picker")).toBeHidden();
});

test("phone only: the Sharpness picker in the Map sheet switches the render resolution and is remembered", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  await openApp(page);
  await page.locator('[data-menu="map"]').click();
  const chip = (q: string) => page.locator(`#quality-picker [data-quality="${q}"]`);
  await expect(chip("sharp")).toHaveClass(/is-on/);
  const viewer = () =>
    page.evaluate(() => {
      const v = (window as unknown as { __orbit: { viewer: { resolutionScale: number; useBrowserRecommendedResolution: boolean } } }).__orbit.viewer;
      return { scale: v.resolutionScale, device: !v.useBrowserRecommendedResolution, dpr: window.devicePixelRatio };
    });
  expect((await viewer()).device).toBe(true);
  await chip("smooth").click();
  await expect(chip("smooth")).toHaveClass(/is-on/);
  const after = await viewer();
  if (after.dpr > 1) expect(after.scale).toBeLessThan(1);
  expect(await page.evaluate(() => localStorage.getItem("orbit-phone-quality"))).toBe("smooth");
});

test("with aircraft and satellites on and the globe zoomed out, redraws stay calm", async ({ page }, info) => {
  await openApp(page);
  if (info.project.name === "phone") await page.locator('[data-menu="layers"]').click();
  await page.locator("#toggle-planes").click();
  await page.locator("#toggle-satellites").click();
  await page.waitForTimeout(12_000);
  // Zoomed out the plane redraw is throttled to about one a second; take the quietest of a few windows so a burst of
  // tile loading in a slow software renderer doesn't fail the test. The first window after loading reads 14-17 even on a
  // quiet PC; on a busy one the burst can outlast four windows, so keep sampling (up to eight) until one is calm. A real
  // always-redrawing regression still fails every window.
  const seen: number[] = [];
  for (let i = 0; i < 8 && !(seen.length && Math.min(...seen) <= 15); i++) seen.push(await renders(page, 5000));
  expect(Math.min(...seen), `redraws per 5 s window: ${seen.join(", ")}`).toBeLessThanOrEqual(15);
});