import { expect, test, type Page } from "@playwright/test";

/**
 * Installable web app. Run with `npm run test:e2e:pwa`: that config builds a clean-env release
 * and serves it with `vite preview`, because the dev server registers no service worker.
 */

/** Opens the page and waits until the service worker controls it (it takes over on the first load, then the page is reloaded). */
async function openControlled(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 15_000 });
  await page.waitForFunction(() => !!document.querySelector("#globe canvas"), undefined, { timeout: 45_000 });
}

test("the page links a manifest, icons and the home-screen settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest$/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /^#/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon\.png$/);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
});

test("the manifest is installable: standalone, a start page, 192 and 512 icons and a maskable one that really are PNGs of that size", async ({ page, request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toBeTruthy();
  expect(m.short_name).toBe("Orbit");
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBeTruthy();
  const icons = m.icons as { src: string; sizes: string; type: string; purpose?: string }[];
  expect(icons.some((i) => i.sizes === "192x192" && (i.purpose ?? "any") === "any")).toBe(true);
  expect(icons.some((i) => i.sizes === "512x512" && (i.purpose ?? "any") === "any")).toBe(true);
  expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
  await page.goto("/");
  for (const icon of icons) {
    const size = await page.evaluate(
      (src) =>
        new Promise<string>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
          img.onerror = () => resolve("missing");
          img.src = new URL(src, location.origin + "/").href;
        }),
      icon.src
    );
    expect(size, icon.src).toBe(icon.sizes);
  }
});

test("a service worker takes over, and it keeps only the app shell: no API replies, no other websites", async ({ page }) => {
  await openControlled(page);
  // Give the live layers a moment to ask for data, then look at everything the worker saved.
  await page.waitForTimeout(3000);
  const saved = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(r.url);
    return urls;
  });
  expect(saved.length).toBeGreaterThan(3);
  const origin = new URL(page.url()).origin;
  expect(saved.filter((u) => new URL(u).origin !== origin)).toEqual([]);
  expect(saved.filter((u) => new URL(u).pathname.startsWith("/api/"))).toEqual([]);
  expect(saved.some((u) => /\/assets\/index-.*\.js$/.test(u))).toBe(true);
});

test("offline, the installed app still opens its page and draws the globe frame", async ({ page, context }) => {
  await openControlled(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".command-header")).toBeVisible();
  await expect(page.locator("#globe canvas").first()).toBeVisible({ timeout: 30_000 });
});
