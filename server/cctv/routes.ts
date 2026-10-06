import { Router } from "express";
import type { Bounds } from "./types";
import { describeSources, getCamera, getSourceForCamera, queryCameras } from "./registry";
import { FrameError, getFrame } from "./frames";

const MAX_LIMIT = 2000;
/** Wider than this and a "viewport" query is really a whole-continent dump — refuse instead of flooding the client. */
const MAX_SPAN_LON = 60;
const MAX_SPAN_LAT = 40;

function parseBounds(q: Record<string, unknown>): Bounds | null | "invalid" {
  const keys = ["w", "s", "e", "n"] as const;
  if (keys.every((k) => q[k] === undefined)) return null;
  const v = keys.map((k) => Number(q[k]));
  if (v.some((n) => !Number.isFinite(n))) return "invalid";
  const [w, s, e, n] = v as [number, number, number, number];
  if (Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180 || s > n) return "invalid";
  return [w, s, e, n];
}

export function cctvRouter(): Router {
  const r = Router();

  r.get("/sources", (_req, res) => {
    res.json({ sources: describeSources() });
  });

  r.get("/cameras", async (req, res) => {
    const b = parseBounds(req.query);
    if (b === "invalid") {
      res.status(400).json({ error: "w, s, e, n must be valid degrees (south <= north)" });
      return;
    }
    if (b) {
      const lonSpan = b[0] <= b[2] ? b[2] - b[0] : 360 - (b[0] - b[2]);
      if (lonSpan > MAX_SPAN_LON || b[3] - b[1] > MAX_SPAN_LAT) {
        res.status(413).json({
          error: "View too wide — zoom in to load cameras",
          sources: describeSources().map(({ id, label, count, coverage }) => ({ id, label, count, coverage }))
        });
        return;
      }
    }
    const lim = Number(req.query.limit ?? 1200);
    const limit = Number.isFinite(lim) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(lim))) : 1200;
    const text = typeof req.query.q === "string" ? req.query.q.slice(0, 80) : "";
    try {
      res.json({
        ...(await queryCameras(b, limit, text)),
        sources: describeSources().map(({ id, label, agency, attribution, license, count, error }) => ({
          id,
          label,
          agency,
          attribution,
          license,
          count,
          error
        }))
      });
    } catch (e) {
      console.warn("[cctv] /cameras failed:", e instanceof Error ? e.message : e);
      res.status(500).json({ error: "camera registry error" });
    }
  });

  r.get("/frame/:id", async (req, res) => {
    const cam = getCamera(String(req.params.id));
    const src = cam ? getSourceForCamera(cam) : undefined;
    if (!cam || !src) {
      res.status(404).json({ error: "unknown camera" });
      return;
    }
    try {
      const frame = await getFrame(cam, src);
      res.status(200);
      res.setHeader("Content-Type", frame.contentType);
      res.setHeader("Cache-Control", "private, max-age=5");
      res.setHeader("X-Frame-Fetched-At", String(frame.fetchedAt));
      res.setHeader("X-Cctv-Source", src.id);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(frame.body);
    } catch (e) {
      const status = e instanceof FrameError ? e.status : 502;
      if (!(e instanceof FrameError) || status !== 404) {
        console.warn(`[cctv] frame ${cam.id} failed:`, e instanceof Error ? e.message : e);
      }
      res.status(status).json({ error: "frame unavailable" });
    }
  });

  return r;
}
