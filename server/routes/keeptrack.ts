import { pipeline, Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Router, type Response as ExpressResponse } from "express";
import { CCTV_UA } from "../cctv/sources/http";
import { ProviderHttpError } from "../lib/fetchUtil";
import { cooldownRemainingMs, recordFailure, recordSuccess } from "../lib/providerGate";

/**
 * KeepTrack for the browser. The KeepTrack key lives only on this server (`KEEPTRACK_API_KEY`, set from the Keys menu):
 * the browser asks `/api/keeptrack/v4/...`, this adds the `x-api-key` header and streams the answer back, so the key is
 * never in the page, the bundle or the browser's network log. Only the few KeepTrack paths Orbit uses are passed through.
 */

const UPSTREAM = "https://api.keeptrack.space";
const UPSTREAM_TIMEOUT_MS = 120_000;
const GATE = "keeptrack";

/** The one place the KeepTrack key is read (the TLE tier in `server/tle.ts` uses it too). */
export function keepTrackKey(): string {
  return process.env.KEEPTRACK_API_KEY?.trim() ?? "";
}

/** `/v4/sats`, `/v4/sats/celestrak`, `/v4/sats/brief` and `/v4/sat/<norad id>`: exactly what `src/providers/keeptrack.ts` calls. */
const ALLOWED = /^\/v4\/(?:sats(?:\/(?:celestrak|brief))?|sat\/\d{1,9})$/;

/** The KeepTrack path to call for a request path, or null when the browser may not ask for it. */
export function keepTrackUpstreamPath(path: string): string | null {
  return ALLOWED.test(path) ? path : null;
}

/**
 * Only a refused key starts the server cooldown, so a bad key is not hammered. A 429, 5xx or network error is passed
 * straight to the browser with KeepTrack's own Retry-After: the browser already backs off, and a server cooldown on top
 * would swallow its retries (a pull would return 0 satellites). A 404 for an unknown satellite is an answer, not an outage.
 */
function refusedKey(status: number): boolean {
  return status === 401 || status === 403;
}

/** Copies KeepTrack's Retry-After (seconds) onto the answer when it sent a usable one. */
function passRetryAfter(up: Response, res: ExpressResponse): void {
  const raw = up.headers.get("retry-after")?.trim();
  const retry = raw ? Number(raw) : NaN;
  if (Number.isFinite(retry) && retry >= 0) res.setHeader("Retry-After", String(Math.ceil(retry)));
}

export function keepTrackRouter(): Router {
  const r = Router();

  r.get("/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ available: keepTrackKey().length > 0 });
  });

  r.get(/^\/v4\/.+$/, async (req, res) => {
    const path = keepTrackUpstreamPath(req.path);
    if (!path) {
      res.status(404).json({ error: "Not a KeepTrack path Orbit uses" });
      return;
    }
    const key = keepTrackKey();
    if (!key) {
      res.status(503).json({ error: "No KeepTrack key on the server (add it in the Keys menu)" });
      return;
    }
    const waitMs = cooldownRemainingMs(GATE);
    if (waitMs > 0) {
      res.setHeader("Retry-After", String(Math.ceil(waitMs / 1000)));
      res.status(503).json({ error: "KeepTrack is cooling down" });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    // Fires when the browser leaves or the answer is done; aborting a finished request does nothing.
    let clientLeft = false;
    res.on("close", () => {
      clientLeft = true;
      clearTimeout(timer);
      controller.abort();
    });

    try {
      const up = await fetch(`${UPSTREAM}${path}`, {
        headers: { "User-Agent": CCTV_UA, "x-api-key": key, Accept: "application/json" },
        signal: controller.signal,
        // A redirect would carry the key header to wherever it points; treat it as an error instead.
        redirect: "manual"
      });
      if (!up.ok) {
        void up.body?.cancel().catch(() => undefined);
        if (refusedKey(up.status)) {
          recordFailure(GATE, new ProviderHttpError("keeptrack", up.status, null));
          // Never pass a 401/403 through: the browser must not learn anything about the key.
          res.status(502).json({ error: `KeepTrack HTTP ${up.status}` });
        } else if (up.status === 429) {
          passRetryAfter(up, res);
          res.status(429).json({ error: "KeepTrack is rate limiting this server" });
        } else if (up.status === 404) {
          res.status(404).json({ error: "KeepTrack has no such object" });
        } else if (up.status >= 500) {
          passRetryAfter(up, res);
          res.status(up.status === 503 ? 503 : 502).json({ error: `KeepTrack HTTP ${up.status}` });
        } else {
          // Redirects (blocked above) and other unexpected answers.
          res.status(502).json({ error: `KeepTrack HTTP ${up.status}` });
        }
        return;
      }
      recordSuccess(GATE);
      res.status(200);
      res.setHeader("Content-Type", up.headers.get("content-type") ?? "application/json");
      res.setHeader("Cache-Control", "no-store");
      if (!up.body) {
        res.end();
        return;
      }
      // `fetch` has already decompressed the body, so the upstream content-length is not forwarded.
      pipeline(Readable.fromWeb(up.body as unknown as WebReadableStream), res, () => {
        /* browser left or upstream stalled: the stream is already torn down */
      });
    } catch (e) {
      // Network errors and timeouts go to the browser, which backs off on its own (see `refusedKey`).
      if (clientLeft) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const timedOut = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
      res.status(timedOut ? 504 : 502).json({ error: timedOut ? "KeepTrack timed out" : "KeepTrack is unreachable" });
    }
  });

  return r;
}
