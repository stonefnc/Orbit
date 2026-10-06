import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard for the aircraft graphics in `src/main.ts`: planes on the far side of the Earth must hide behind the globe.
 * `disableDepthTestDistance: Number.POSITIVE_INFINITY` draws them on top of it; the plane billboard and the notable
 * owner's label use `horizonDepthTest(viewer.camera)` from `src/horizon.ts` instead (as the ship points do).
 */
const MAIN = readFileSync(join(__dirname, "..", "..", "src", "main.ts"), "utf8");

/** Source of a top-level function, from its declaration to the next top-level declaration. */
function functionSource(name: string): string {
  const start = MAIN.indexOf(`\nfunction ${name}(`);
  expect(start, `function ${name} not found in src/main.ts`).toBeGreaterThan(-1);
  const rest = MAIN.slice(start + 1);
  const end = rest.search(/\n(?:async function|function|const|let|export|class) /);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("aircraft and the far side of the Earth", () => {
  for (const name of ["applyPlaneFeedSnapshot", "restylePlane"]) {
    it(`${name} hides planes behind the Earth`, () => {
      const src = functionSource(name);
      expect(src).not.toMatch(/disableDepthTestDistance\s*[:=]\s*Number\.POSITIVE_INFINITY/);
      expect(src).toMatch(/disableDepthTestDistance\s*:\s*horizonDepthTest\(viewer\.camera\)/);
    });
  }
});
