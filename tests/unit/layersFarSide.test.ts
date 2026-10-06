import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard for the map-layer folders: map-layer dots must hide behind the Earth. `disableDepthTestDistance` set to
 * `Number.POSITIVE_INFINITY` draws the far side's dots on top of the globe; entity graphics use
 * `horizonDepthTest(camera)` and cluster billboards `horizonDistance(camera.positionWC)` from `src/horizon.ts`.
 */
const FOLDERS = ["src/layers", "src/alpr", "src/datacenter", "src/earthcam"];
const ROOT = join(__dirname, "..", "..");

function tsFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []
  );
}

describe("layer dots and the far side of the Earth", () => {
  it("no layer turns the depth test off at every distance", () => {
    const offenders: string[] = [];
    for (const dir of FOLDERS) {
      for (const file of tsFiles(dir)) {
        readFileSync(join(ROOT, file), "utf8")
          .split(/\r?\n/)
          .forEach((line, i) => {
            if (/disableDepthTestDistance\s*[:=]\s*Number\.POSITIVE_INFINITY/.test(line)) offenders.push(`${file}:${i + 1}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
