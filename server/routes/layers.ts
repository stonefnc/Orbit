import { Router } from "express";
import { getCyclones } from "../lib/cyclones";
import { getWindField } from "../lib/wind";
import { getCableDetail, getCableGeo, getLandingGeo } from "../lib/cables";
import { getDams } from "../lib/dams";
import { getPowerPlants, queryPowerGrid } from "../lib/power";
import { queryAbandoned } from "../lib/abandoned";
import { getRadioStations } from "../lib/radio";
import { getLaunches } from "../lib/launches";
import { getRoute, getRouteAvoidingAlpr, type RouteProfile } from "../lib/route";
import { getTrace } from "../lib/trace";
import { geocoder, type Bias } from "../lib/geocoder";
import { getBattles } from "../lib/battles";
import { findAircraft } from "../lib/aircraftLookup";
import { searchPois } from "../lib/poi";
import {
  conflictBuildError,
  conflictStore,
  getConflictNews,
  latestConflictUpdates,
  listConflicts,
  queryConflictEvents
} from "../lib/conflicts";
import { firmsConfigured, getEonetFires, getFirePerimeters, getFirmsFires } from "../lib/fires";
import { getEventNews } from "../lib/eventNews";

/** `lat` / `lon` query values as a location bias (the view or "my location"), or null when absent or not on Earth. */
function biasFrom(query: Record<string, unknown>): Bias | null {
  if (query.lat == null || query.lon == null || query.lat === "" || query.lon === "") return null;
  const lat = Number(query.lat);
  const lon = Number(query.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** Data endpoints for the optional map layers (weather, events, infrastructure, utilities). */
export function layersRouter(): Router {
  const r = Router();

  const fail = (res: import("express").Response, what: string, e: unknown): void => {
    console.warn(`[layers] ${what} failed:`, e instanceof Error ? e.message : e);
    res.status(502).json({ error: `${what} unavailable` });
  };

  r.get("/cables", async (_req, res) => {
    try {
      const [cables, landings] = await Promise.all([getCableGeo(), getLandingGeo()]);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.json({ cables, landings });
    } catch (e) {
      fail(res, "cable data", e);
    }
  });

  r.get("/cables/:id", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.json(await getCableDetail(String(req.params.id)));
    } catch (e) {
      fail(res, "cable details", e);
    }
  });

  r.get("/dams", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=86400");
      // Compact rows keep the payload small: [id, name, lat, lon, heightM|0, river, country, year|0, wikipedia path].
      const dams = (await getDams()).map((d) => [
        d.id,
        d.name,
        Math.round(d.lat * 1e4) / 1e4,
        Math.round(d.lon * 1e4) / 1e4,
        d.heightM ?? 0,
        d.river ?? "",
        d.country ?? "",
        d.year ?? 0,
        (d.wiki ?? "").replace("https://en.wikipedia.org/wiki/", "")
      ]);
      res.json({ dams });
    } catch (e) {
      fail(res, "dam data", e);
    }
  });

  r.get("/power/plants", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.json({ plants: await getPowerPlants() });
    } catch (e) {
      fail(res, "power plant data", e);
    }
  });

  /** Transmission lines (200 kV+) and substations in a box, from cached OpenStreetMap tiles. */
  r.get("/power/grid", async (req, res) => {
    const [w, s, e, n] = ["w", "s", "e", "n"].map((k) => Number(req.query[k]));
    if ([w, s, e, n].some((v) => !Number.isFinite(v)) || Math.abs(s!) > 90 || Math.abs(n!) > 90 || s! > n!) {
      res.status(400).json({ error: "w, s, e, n must be valid degrees" });
      return;
    }
    try {
      const out = await queryPowerGrid(w!, s!, e!, n!);
      if (out === "too-wide") {
        res.status(413).json({ error: "View too wide — zoom in a little to load the power grid" });
        return;
      }
      res.setHeader("Cache-Control", out.tilesPending ? "no-store" : "public, max-age=60");
      res.json(out);
    } catch (e) {
      fail(res, "power grid", e);
    }
  });
  r.get("/abandoned", async (req, res) => {
    const [w, s, e, n] = ["w", "s", "e", "n"].map((k) => Number(req.query[k]));
    if ([w, s, e, n].some((v) => !Number.isFinite(v)) || Math.abs(s!) > 90 || Math.abs(n!) > 90 || s! > n!) {
      res.status(400).json({ error: "w, s, e, n must be valid degrees" });
      return;
    }
    const limit = Math.min(6000, Math.max(100, Number(req.query.limit) || 3000));
    // 0 unlikely, 1 maybe, 2 likely (default), 3 very likely.
    const minRaw = Number(req.query.min);
    const min = (minRaw === 0 || minRaw === 1 || minRaw === 3 ? minRaw : 2) as 0 | 1 | 2 | 3;
    try {
      const out = await queryAbandoned(w!, s!, e!, n!, limit, min);
      if (out === "too-wide") {
        res.status(413).json({ error: "View too wide — zoom in a little to load abandoned places" });
        return;
      }
      res.setHeader("Cache-Control", out.tilesPending ? "no-store" : "public, max-age=60");
      res.json(out);
    } catch (err) {
      fail(res, "abandoned places", err);
    }
  });
  r.get("/trace/:hex", async (req, res) => {
    try {
      const t = await getTrace(String(req.params.hex).toLowerCase());
      if (!t) {
        res.status(404).json({ error: "no recorded history for this aircraft" });
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=30");
      res.json(t);
    } catch (e) {
      fail(res, "trace history", e);
    }
  });

  // ----- Conflict watch (UCDP events + GDELT headlines) -----
  r.get("/conflicts/list", (_req, res) => {
    const s = conflictStore();
    if (!s) {
      const err = conflictBuildError();
      if (err) {
        res.status(502).json({ error: err });
        return;
      }
      res.status(202).json({ status: "building" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ status: "ready", ...listConflicts(s) });
  });

  r.get("/conflicts/events", (req, res) => {
    const s = conflictStore();
    if (!s) {
      res.status(202).json({ status: "building" });
      return;
    }
    const id = String(req.query.c ?? "");
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
      return;
    }
    const lim = Number(req.query.limit ?? 3000);
    const out = queryConflictEvents(s, id, from, to, Number.isFinite(lim) ? Math.min(6000, Math.max(50, lim)) : 3000);
    if (!out) {
      res.status(404).json({ error: "unknown conflict" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=120");
    res.json({ status: "ready", ...out });
  });

  r.get("/conflicts/updates", (req, res) => {
    const s = conflictStore();
    if (!s) {
      res.status(202).json({ status: "building" });
      return;
    }
    const days = Math.min(120, Math.max(3, Number(req.query.days ?? 30) || 30));
    const out = latestConflictUpdates(s, String(req.query.c ?? ""), days);
    if (!out) {
      res.status(404).json({ error: "unknown conflict" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ status: "ready", updates: out });
  });

  r.get("/conflicts/news", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json(await getConflictNews(String(req.query.c ?? "")));
    } catch (e) {
      fail(res, "news headlines", e);
    }
  });

  r.get("/battles", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.json({ battles: await getBattles() });
    } catch (e) {
      fail(res, "battle data", e);
    }
  });

  r.get("/aircraft-search", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=15");
      res.json({ results: await findAircraft(String(req.query.q ?? "")) });
    } catch (e) {
      fail(res, "aircraft search", e);
    }
  });

  r.get("/poi", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({ results: await searchPois(String(req.query.q ?? ""), Number(req.query.lat), Number(req.query.lon)) });
    } catch (e) {
      fail(res, "store search", e);
    }
  });

  // Directions boxes (type-ahead): addresses and places, nearest to the optional lat/lon first. See server/lib/geocoder.ts.
  r.get("/places", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=600");
      const reply = await geocoder.geocode(String(req.query.q ?? ""), { bias: biasFrom(req.query) });
      res.json({ results: reply.results, unavailable: reply.unavailable });
    } catch (e) {
      fail(res, "place search", e);
    }
  });

  // The top-bar search and "Set my location": same lookup; `submit=1` (Enter / Find) also allows Nominatim.
  r.get("/geocode", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=300");
      const reply = await geocoder.geocode(String(req.query.q ?? ""), { bias: biasFrom(req.query), submit: req.query.submit === "1" });
      res.json(reply);
    } catch (e) {
      fail(res, "place search", e);
    }
  });

  // One Nominatim lookup for the place panel after a click (`osm` like "W123").
  r.get("/place-detail", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json({ result: await geocoder.lookupOsm(String(req.query.osm ?? "")) });
    } catch (e) {
      fail(res, "place detail", e);
    }
  });

  r.get("/route", async (req, res) => {
    const profile = String(req.query.profile ?? "driving") as RouteProfile;
    const parse = (v: unknown): [number, number] | null => {
      const p = String(v ?? "").split(",").map(Number);
      return p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]!) <= 180 && Math.abs(p[1]!) <= 90
        ? [p[0]!, p[1]!]
        : null;
    };
    const from = parse(req.query.from);
    const to = parse(req.query.to);
    if (!["driving", "foot", "bike"].includes(profile) || !from || !to) {
      res.status(400).json({ error: "profile, from=lon,lat and to=lon,lat are required" });
      return;
    }
    try {
      res.json(
        req.query.avoidAlpr === "1" ? await getRouteAvoidingAlpr(profile, from, to) : await getRoute(profile, from, to)
      );
    } catch (e) {
      console.warn("[layers] route failed:", e instanceof Error ? e.message : e);
      res.status(502).json({ error: e instanceof Error ? e.message : "routing unavailable" });
    }
  });

  r.get("/launches", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=600");
      res.json({ launches: await getLaunches() });
    } catch (e) {
      fail(res, "launch schedule", e);
    }
  });

  r.get("/radio", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json({ stations: await getRadioStations() });
    } catch (e) {
      fail(res, "radio directory", e);
    }
  });

  r.get("/wind", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=600");
      res.json(await getWindField());
    } catch (e) {
      fail(res, "wind data", e);
    }
  });

  r.get("/cyclones", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({ storms: await getCyclones() });
    } catch (e) {
      fail(res, "cyclone data", e);
    }
  });

  r.get("/fires", async (req, res) => {
    try {
      const [w, s, e, n] = ["w", "s", "e", "n"].map((k) => Number(req.query[k]));
      const box = [w, s, e, n].every((v) => Number.isFinite(v));
      res.setHeader("Cache-Control", "public, max-age=300");
      if (firmsConfigured() && box && Math.abs(e! - w!) <= 40 && Math.abs(n! - s!) <= 30) {
        res.json({ source: "firms", fires: await getFirmsFires(w!, s!, e!, n!) });
        return;
      }
      res.json({ source: "eonet", firmsAvailable: firmsConfigured(), fires: await getEonetFires() });
    } catch (e) {
      fail(res, "fire data", e);
    }
  });

  // US burned areas (NIFC perimeters); other countries have no keyless perimeter feed.
  r.get("/fire-perimeters", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=900");
      res.json({ perimeters: await getFirePerimeters() });
    } catch (e) {
      fail(res, "fire perimeters", e);
    }
  });

  // Recent headlines for one quake (kind=quake, name = USGS place text) or one fire (kind=fire, name = its title).
  r.get("/event-news", async (req, res) => {
    const kind = req.query.kind === "quake" || req.query.kind === "fire" ? req.query.kind : null;
    if (!kind) {
      res.status(400).json({ error: "kind must be quake or fire" });
      return;
    }
    try {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(await getEventNews(kind, String(req.query.name ?? "").slice(0, 200)));
    } catch (e) {
      fail(res, "event headlines", e);
    }
  });

  return r;
}

