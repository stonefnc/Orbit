import { afterEach, describe, expect, it, vi } from "vitest";
import { gdeltHeadlines } from "../../server/lib/gdelt";

afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 429, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

describe("gdeltHeadlines", () => {
  it("keeps http(s) articles, drops duplicates, formats the date and caches the answer", async () => {
    const fetchMock = vi.fn(async () =>
      reply({
        articles: [
          { title: "Quake hits coast", url: "https://news.example/a", domain: "news.example", seendate: "20261003T154500Z" },
          { title: "Quake hits coast", url: "https://other.example/b", domain: "other.example", seendate: "20261003T160000Z" },
          { title: "Script link", url: "javascript:alert(1)", domain: "x" },
          { title: "", url: "https://news.example/c" }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = await gdeltHeadlines("test:quake-a", "earthquake Test");
    expect(first.stale).toBe(false);
    expect(first.items).toEqual([
      { title: "Quake hits coast", url: "https://news.example/a", domain: "news.example", seen: "2026-10-03T15:45:00Z" }
    ]);
    const again = await gdeltHeadlines("test:quake-a", "earthquake Test");
    expect(again.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
