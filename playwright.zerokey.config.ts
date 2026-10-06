import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Zero-key first launch: the real app with NO keys at all, as a fresh clone behaves (`npm run test:e2e:zerokey`).
 *
 * It starts its own API and Vite on other ports (8887 / 5273) with `ORBIT_ENV_DIR` pointing at an empty folder, so the
 * owner's `.env.local` is never read and a running dev server (which has keys) is never reused. Every key variable is
 * also blanked in case the shell has one.
 */
const ENV_DIR = join(tmpdir(), "orbit-zero-key-env");
mkdirSync(ENV_DIR, { recursive: true });
for (const f of readdirSync(ENV_DIR)) if (f.startsWith(".env")) rmSync(join(ENV_DIR, f), { force: true });

const API_PORT = 8887;
const WEB_PORT = 5273;

const noKeys: Record<string, string> = Object.fromEntries(
  [
    "AISSTREAM_API_KEY",
    "OPENSKY_CLIENT_ID",
    "OPENSKY_CLIENT_SECRET",
    "ADSBX_API_KEY",
    "KEEPTRACK_API_KEY",
    "FIRMS_MAP_KEY",
    "AVIATIONSTACK_ACCESS_KEY",
    "VITE_CESIUM_ION_TOKEN",
    "VITE_PHOTOREALISTIC_3D_ASSET_ID"
  ].map((k) => [k, ""])
);

const launchOptions = {
  // Headless Chromium has no GPU: draw WebGL in software so Cesium works.
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"]
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /zeroKey\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/zerokey",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, launchOptions } },
    { name: "phone", use: { ...devices["Pixel 7"], launchOptions } }
  ],
  webServer: {
    command: `npx concurrently -k -n api,vite "tsx server/index.ts" "vite --port ${WEB_PORT} --strictPort"`,
    env: {
      ...(process.env as Record<string, string>),
      ...noKeys,
      ORBIT_ENV_DIR: ENV_DIR,
      ORBIT_NO_OBS: "1",
      PLANE_API_PORT: String(API_PORT),
      PLANE_API_TARGET: `http://127.0.0.1:${API_PORT}`
    },
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
