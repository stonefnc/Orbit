import { describe, expect, it } from "vitest";
import { KEY_HINTS, type KeyHintId } from "../../src/keyHints";

describe("key hints (zero-key first launch)", () => {
  const ids = Object.keys(KEY_HINTS) as KeyHintId[];

  it("covers the keyed layers", () => {
    expect(ids.sort()).toEqual(["ais", "ion", "keeptrack"]);
  });

  it.each(ids)("%s: plain words, a real https link, and where to paste the key", (id) => {
    const h = KEY_HINTS[id];
    expect(h.href).toMatch(/^https:\/\//);
    expect(h.text).toMatch(/Keys menu/);
    // No developer jargon for a person who just cloned the repo and wants to see the globe.
    expect(h.text).not.toMatch(/VITE_|\.env|process\.env/);
  });
});
