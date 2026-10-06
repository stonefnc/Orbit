import { describe, expect, it } from "vitest";
import { CREDITS, liveCesiumCredits } from "../../src/credits";

/** A stand-in for a DOM subtree: `querySelectorAll` answers by selector text. */
const tree = (bySelector: Record<string, string[]>) =>
  ({
    querySelectorAll: (sel: string) => (bySelector[sel] ?? []).map((textContent) => ({ textContent }))
  }) as unknown as ParentNode;

describe("live Cesium credits", () => {
  it("collects inline and data-attribution credits, tidied and without duplicates", () => {
    const sink = tree({
      ".cesium-credit-textContainer .cesium-credit-wrapper": ["Upgrade for commercial use.", "Clouds:  © EUMETSAT\n · Meteosat 0°"]
    });
    const doc = tree({
      ".cesium-credit-lightbox li": ["© 2026 Microsoft Corporation", "Earthstar Geographics SIO", "", "© 2026 Microsoft Corporation"]
    });
    expect(liveCesiumCredits(sink, doc)).toEqual([
      "Clouds: © EUMETSAT · Meteosat 0°",
      "© 2026 Microsoft Corporation",
      "Earthstar Geographics SIO"
    ]);
  });

  it("returns an empty list when Cesium has reported nothing", () => {
    expect(liveCesiumCredits(tree({}), tree({}))).toEqual([]);
  });
});

describe("credits list", () => {
  it("has a name, a credit and an https link for every entry, with no duplicates", () => {
    const names = new Set<string>();
    for (const c of CREDITS) {
      expect(c.name.length).toBeGreaterThan(2);
      expect(c.credit.length).toBeGreaterThan(5);
      expect(c.href).toMatch(/^https:\/\/[a-z0-9.-]+\//i);
      expect(names.has(c.name)).toBe(false);
      names.add(c.name);
    }
  });

  it("names the providers whose terms ask for a visible credit", () => {
    const text = CREDITS.map((c) => `${c.name} ${c.credit}`).join("\n");
    for (const must of [
      "Cesium",
      "Bing",
      "Google",
      "OpenStreetMap",
      "EUMETSAT",
      "Open-Meteo",
      "UCDP",
      "TeleGeography",
      "NASA",
      "Esri"
    ]) {
      expect(text).toContain(must);
    }
  });

  it("keeps personal details out of the published text", () => {
    const text = JSON.stringify(CREDITS);
    expect(text).not.toMatch(/C:\\\\Users|192\.168\./i);
  });
});
