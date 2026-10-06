import { defineConfig, devices } from "@playwright/test";

/**
 * The installable web app, tested the way a visitor gets it: a clean-env release build (`npm run build:release`, which also
 * scans the output for tokens) served by `vite preview` on its own port (`npm run test:e2e:pwa`). The dev server can't
 * stand in for this: it registers no service worker. Nothing here reads `.env.local`.
 */
const PORT = 4273;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /pwa\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/pwa",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        // Headless Chromium has no GPU: draw WebGL in software so Cesium works.
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] }
      }
    }
  ],
  webServer: {
    command: `node scripts/build-release.mjs && npx vite preview --port ${PORT} --strictPort`,
    // The API is not part of this test: point the preview's /api proxy at a port nothing listens on.
    env: { ...(process.env as Record<string, string>), PLANE_API_TARGET: "http://127.0.0.1:8899" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000
  }
});
