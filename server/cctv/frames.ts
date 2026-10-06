import type { CctvCamera, CctvSource, UpstreamAllow } from "./types";
import { CCTV_UA } from "./sources/http";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_CACHE_ENTRIES = 400;
const MAX_CONCURRENT_PER_HOST = 6;

export type Frame = { body: Buffer; contentType: string; fetchedAt: number };

export class FrameError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "FrameError";
  }
}

const cache = new Map<string, Frame>();
const inflight = new Map<string, Promise<Frame>>();
const hostActive = new Map<string, number>();
const hostWaiters = new Map<string, Array<() => void>>();

function allowed(url: URL, allow: UpstreamAllow[]): boolean {
  if (url.protocol !== "https:") return false;
  return allow.some((a) => url.hostname === a.host && (!a.pathPrefix || url.pathname.startsWith(a.pathPrefix)));
}

function sniff(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 4 && b.toString("latin1", 0, 4) === "GIF8") return "image/gif";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

async function acquire(host: string): Promise<() => void> {
  while ((hostActive.get(host) ?? 0) >= MAX_CONCURRENT_PER_HOST) {
    await new Promise<void>((resolve) => {
      const q = hostWaiters.get(host) ?? [];
      q.push(resolve);
      hostWaiters.set(host, q);
    });
  }
  hostActive.set(host, (hostActive.get(host) ?? 0) + 1);
  return () => {
    hostActive.set(host, Math.max(0, (hostActive.get(host) ?? 1) - 1));
    hostWaiters.get(host)?.shift()?.();
  };
}

async function readCapped(res: Response): Promise<Buffer> {
  if (!res.body) throw new FrameError(502, "upstream sent no body");
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new FrameError(502, "upstream image too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function fetchUpstream(camera: CctvCamera, source: CctvSource): Promise<Frame> {
  let url = new URL(camera.frameUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowed(url, source.allow)) throw new FrameError(502, "frame URL is not on the source allowlist");
    const release = await acquire(url.hostname);
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": CCTV_UA, Accept: "image/*", ...source.frameHeaders }
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) throw new FrameError(502, "redirect without location");
        url = new URL(loc, url);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new FrameError(res.status === 404 ? 404 : 502, `upstream HTTP ${res.status}`);
      }
      const body = await readCapped(res);
      const type = sniff(body);
      if (!type) throw new FrameError(502, "upstream did not return an image");
      return { body, contentType: type, fetchedAt: Date.now() };
    } finally {
      release();
    }
  }
  throw new FrameError(502, "too many redirects");
}

/** Cached for roughly half the agency's refresh interval (5–30 s) and shared between concurrent viewers. */
export async function getFrame(camera: CctvCamera, source: CctvSource): Promise<Frame> {
  const ttl = Math.min(30_000, Math.max(5_000, (camera.refreshSec * 1000) / 2));
  const hit = cache.get(camera.id);
  if (hit && Date.now() - hit.fetchedAt < ttl) return hit;

  const existing = inflight.get(camera.id);
  if (existing) return existing;

  const p = fetchUpstream(camera, source)
    .then((frame) => {
      cache.delete(camera.id);
      cache.set(camera.id, frame);
      while (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return frame;
    })
    .catch((e) => {
      // Serve a recent-enough previous frame rather than a broken image if the upstream hiccups.
      if (hit && Date.now() - hit.fetchedAt < 120_000) return hit;
      throw e;
    })
    .finally(() => {
      inflight.delete(camera.id);
    });
  inflight.set(camera.id, p);
  return p;
}
