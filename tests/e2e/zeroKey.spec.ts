import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Zero-key first launch. Run with `npm run test:e2e:zerokey`: that config starts its own
 * server with an empty env folder, so none of the owner's keys are present. Nothing here may need a key to work, and
 * every layer that wants one has to say how to get it.
 */

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|net::ERR|403|404|429|CORS/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  // A keyless install must never be turned away by Cesium ion (its built-in demo token is rejected).
  page.on("response", (r) => {
    if (/cesium\.com/.test(r.url()) && r.status() >= 400) errors.push(`${r.status()} from ${new URL(r.url()).host}`);
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { __orbit?: { viewer?: unknown } }).__orbit?.viewer, undefined, { timeout: 45_000 });
  await page.waitForFunction(() => performance.getEntriesByName("orbit:globe-sources-ready").length > 0, undefined, { timeout: 45_000 });
  return errors;
}

/** On a phone the layer chips live in a sheet that closes itself after a tap; open it when it is closed. */
async function showLayers(page: Page, info: TestInfo): Promise<void> {
  if (info.project.name !== "phone") return;
  if (!(await page.locator("body").evaluate((b) => b.classList.contains("menu-layers-open")))) {
    await page.locator('[data-menu="layers"]').click();
  }
}

test("no keys at all: the server reports every key as not set", async ({ request }) => {
  // Guards the test itself: if a real key leaked in, the other checks here would prove nothing.
  const body = await (await request.get("/api/settings/status")).json();
  const set = Object.entries(body.keys as Record<string, { set: boolean }>).filter(([, v]) => v.set).map(([k]) => k);
  expect(set).toEqual([]);
});

test("the globe loads with no keys, on keyless imagery, with no errors", async ({ page }, info) => {
  const errors = await openApp(page);
  await expect(page.locator("#globe canvas").first()).toBeVisible();
  await showLayers(page, info);
  // Esri is the keyless default; Aerial (Cesium ion) is switched off and says why.
  await expect(page.locator("#imagery-picker .layer-chip.is-on")).toHaveText("Esri");
  const aerial = page.locator("#imagery-picker .layer-chip", { hasText: "Aerial" });
  await expect(aerial).toBeDisabled();
  await expect(aerial).toHaveAttribute("title", /free Cesium ion token.*Keys menu/);
  expect(errors).toEqual([]);
});

test("the Cesium ion token is explained in plain words, with where to get it", async ({ page }, info) => {
  await openApp(page);
  await showLayers(page, info);
  const hint = page.locator('#key-hints [data-key-hint="ion"]');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("Keys menu");
  await expect(hint.locator("a")).toHaveAttribute("href", "https://ion.cesium.com/tokens");
  const photo = page.locator("#toggle-photorealistic-3d");
  await expect(photo).toBeDisabled();
  const title = (await photo.getAttribute("title")) ?? "";
  expect(title).toMatch(/Keys menu/);
  expect(title).not.toMatch(/VITE_|\.env/);
});

test("ships without an AISStream key say how to get one", async ({ page }, info) => {
  await openApp(page);
  await showLayers(page, info);
  await page.locator("#toggle-vessels").click();
  await showLayers(page, info);
  const hint = page.locator('#key-hints [data-key-hint="ais"]');
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await expect(hint.locator("a")).toHaveAttribute("href", "https://aisstream.io/apikeys");
  // Switching ships off takes the note away again.
  await page.locator("#toggle-vessels").click();
  await showLayers(page, info);
  await expect(hint).toHaveCount(0);
});

test("choosing KeepTrack without a key says so instead of failing quietly", async ({ page }, info) => {
  await openApp(page);
  await showLayers(page, info);
  await page.locator("#toggle-satellites").click();
  await expect(page.locator("#toggle-satellites")).toContainText("ON", { timeout: 20_000 });
  await showLayers(page, info);
  await page.locator("#source-keeptrack").click();
  await expect(page.locator('#key-hints [data-key-hint="keeptrack"]')).toBeVisible({ timeout: 20_000 });
});

test("the Keys menu lists the keys as not set and says where each comes from", async ({ page }) => {
  await openApp(page);
  await page.locator('[data-menu="keys"]').click();
  const sheet = page.locator("#keys-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".keys-label")).toHaveCount(8);
  // Every key row says "Not set" and none claims to be saved.
  await expect(sheet.locator(".keys-status.is-set")).toHaveCount(0);
  await expect(sheet.locator(".keys-status.is-unset")).toHaveCount(8);
  await expect(sheet.locator("a[href^='https://']").first()).toBeVisible();
});

test("keyless layers still switch on", async ({ page }, info) => {
  await openApp(page);
  await showLayers(page, info);
  const cam = page.locator("#toggle-earthcam");
  await cam.click();
  await expect(cam).toContainText("ON", { timeout: 20_000 });
});
