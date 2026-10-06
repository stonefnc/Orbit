import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

const KEYS = ["ORBIT_APP_DIR", "ORBIT_ENV_DIR", "ORBIT_CACHE_DIR"] as const;

async function load(env: Partial<Record<(typeof KEYS)[number], string>>) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return import("../../server/lib/paths");
}

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  vi.resetModules();
});

describe("server paths", () => {
  it("defaults to the repository folder, with caches in .cache inside it", async () => {
    const p = await load({});
    expect(p.ENV_DIR).toBe(p.APP_ROOT);
    expect(p.CACHE_ROOT).toBe(join(p.APP_ROOT, ".cache"));
  });

  it("moves keys and caches out of the install folder when told to", async () => {
    const p = await load({ ORBIT_APP_DIR: "/app", ORBIT_ENV_DIR: "/data/user", ORBIT_CACHE_DIR: "/data/user/cache" });
    expect(p.APP_ROOT).toBe("/app");
    expect(p.ENV_DIR).toBe("/data/user");
    expect(p.CACHE_ROOT).toBe("/data/user/cache");
  });

  it("puts the default cache under a relocated app folder, and ignores blank values", async () => {
    const p = await load({ ORBIT_APP_DIR: "/app", ORBIT_ENV_DIR: "  ", ORBIT_CACHE_DIR: "" });
    expect(p.ENV_DIR).toBe("/app");
    expect(p.CACHE_ROOT).toBe(join("/app", ".cache"));
  });
});
