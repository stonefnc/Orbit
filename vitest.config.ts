import { defineConfig } from "vitest/config";

/** Unit tests: pure logic only (no browser, no network). Browser tests live in tests/e2e and run with Playwright. */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000
  }
});
