import { describe, expect, it } from "vitest";
import { platformOf, streamsOf, youtubeId } from "../../server/lib/launches";

const id = (url: string) => youtubeId(new URL(url));

describe("youtubeId", () => {
  it("reads watch, youtu.be, live, embed and shorts links", () => {
    expect(id("https://www.youtube.com/watch?v=7ZiUbT1-djA")).toBe("7ZiUbT1-djA");
    expect(id("https://youtu.be/7ZiUbT1-djA")).toBe("7ZiUbT1-djA");
    expect(id("https://www.youtube.com/live/7ZiUbT1-djA")).toBe("7ZiUbT1-djA");
    expect(id("https://www.youtube.com/embed/7ZiUbT1-djA")).toBe("7ZiUbT1-djA");
    expect(id("https://m.youtube.com/shorts/7ZiUbT1-djA")).toBe("7ZiUbT1-djA");
  });
  it("is null for other sites and for malformed ids", () => {
    expect(id("https://x.com/i/broadcasts/1qxvvepEVdRxB")).toBeNull();
    expect(id("https://www.youtube.com/watch?v=short")).toBeNull();
  });
});

describe("platformOf", () => {
  it("names the common platforms", () => {
    expect(platformOf(new URL("https://www.youtube.com/watch?v=x"))).toBe("YouTube");
    expect(platformOf(new URL("https://x.com/i/broadcasts/1"))).toBe("X");
    expect(platformOf(new URL("https://plus.nasa.gov/scheduled-video/a/"))).toBe("NASA");
    expect(platformOf(new URL("https://www.twitch.tv/spacex"))).toBe("Twitch");
  });
  it("falls back to the host name", () => {
    expect(platformOf(new URL("https://example.org/live"))).toBe("example.org");
  });
});

describe("streamsOf", () => {
  const raw = (vidURLs: unknown[]) => ({ id: "x", name: "n", net: "2026-01-01T00:00:00Z", vidURLs }) as never;

  it("lists official streams before unofficial ones, then by Launch Library priority", () => {
    const out = streamsOf(
      raw([
        { priority: 1, url: "https://www.youtube.com/watch?v=AAAAAAAAAAA", type: { name: "Unofficial Webcast" }, publisher: "Fan" },
        { priority: 9, url: "https://x.com/i/broadcasts/abc", type: { name: "Official Webcast" }, publisher: "SpaceX" }
      ])
    );
    expect(out.map((s) => s.publisher)).toEqual(["SpaceX", "Fan"]);
    expect(out[0]!.official).toBe(true);
    expect(out[1]!.youtubeId).toBe("AAAAAAAAAAA");
  });

  it("removes duplicates of the same YouTube video and ignores non-web links", () => {
    const out = streamsOf(
      raw([
        { priority: 1, url: "https://www.youtube.com/watch?v=BBBBBBBBBBB", type: { name: "Official Webcast" } },
        { priority: 2, url: "https://youtu.be/BBBBBBBBBBB", type: { name: "Official Webcast" } },
        { priority: 3, url: "javascript:alert(1)", type: { name: "Official Webcast" } }
      ])
    );
    expect(out).toHaveLength(1);
  });

  it("is empty when there is nothing to watch", () => {
    expect(streamsOf(raw([]))).toEqual([]);
  });
});
