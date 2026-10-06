import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests: the real app in a real (headless) Chromium, at a desktop size and at a phone size.
 * They use the dev server that is normally already running (npm run dev); if it isn't, Playwright starts one.
 * On a failure the run keeps a video, a trace and a screenshot in test-results/ so the problem can be seen exactly as
 * the browser saw it.
 */
const launchOptions = {
  // Headless Chromium has no GPU: draw WebGL in software so Cesium works.
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"]
};

export default defineConfig({
  testDir: "tests/e2e",
  // Needs a server with no keys: it has its own config (playwright.zerokey.config.ts, `npm run test:e2e:zerokey`).
  // The PWA test needs a production build with a service worker: playwright.pwa.config.ts, `npm run test:e2e:pwa`.
  testIgnore: /(zeroKey|pwa)\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, launchOptions } },
    { name: "phone", use: { ...devices["Pixel 7"], launchOptions } }
  ],
  webServer: {
    command: "npm run dev",
    env: { ...(process.env as Record<string, string>), ORBIT_NO_OBS: "1" },
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
