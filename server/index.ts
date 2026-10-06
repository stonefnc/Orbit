import dotenv from "dotenv";
import { join } from "node:path";
import cors from "cors";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import type {
  AggregatedAircraftResponse,
  AircraftModelGalleryResponse,
  AircraftPhotoResponse,
  PlanePositionSource,
  ProviderHealth
} from "../shared/planeContract";
import { AisStreamSession } from "./aisStreamSession";
import { cctvRouter } from "./cctv/routes";
import { tleRouter } from "./tle";
import { keepTrackRouter } from "./routes/keeptrack";
import { layersRouter } from "./routes/layers";
import { settingsRouter } from "./routes/settings";
import { fetchAdsbxPoint } from "./lib/adsbx";
import { boundingBoxFromCenterNm } from "./lib/bbox";
import { coalesce, getFresh, getStale, planeCacheKey, setCached, snapCenter } from "./lib/planeCache";
import { mergeRawPlaneLayers } from "./lib/mergePlanes";
import { fetchOpenSkyStatesLayer, type RawPlaneLayer } from "./lib/openskyStates";
import { fetchReadsbPoint, type ReadsbSource } from "./lib/readsb";
import { fetchText } from "./lib/fetchUtil";
import { getOpenSkyBearer } from "./lib/openskyAuth";
import { cooldownRemainingMs, providerSnapshot, recordFailure, recordSuccess } from "./lib/providerGate";
import { commonsAircraftModelGallery, commonsAircraftPhoto } from "./lib/wikimediaPhoto";
import { aircraftPhotoByHex, flightRouteFor } from "./lib/flightInfo";
import { geocodePlace } from "./lib/geocode";
import { getLiveNotableAircraft, getNotableAircraft } from "./lib/notableAircraft";
import { queryAlpr } from "./lib/alpr";
import { queryDatacenters } from "./lib/datacenters";
import { LOCAL_ORIGIN, aisOriginAllowed } from "./lib/wsOrigin";
import { ENV_DIR } from "./lib/paths";

/** Node does not read `.env.local` automatically (Vite does). The folder comes from lib/paths.ts, so the working directory does not matter. */
dotenv.config({ path: join(ENV_DIR, ".env") });
dotenv.config({ path: join(ENV_DIR, ".env.local"), override: true });

const PORT = Number(process.env.PLANE_API_PORT ?? "8787");
/** Loopback by default: this API spends your provider quotas, so it must not be reachable from the LAN unless you opt in. */
const HOST = (process.env.PLANE_API_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const OPENSKY_ID = process.env.OPENSKY_CLIENT_ID ?? "";
const OPENSKY_SECRET = process.env.OPENSKY_CLIENT_SECRET ?? "";
const ADSBX_KEY = process.env.ADSBX_API_KEY ?? "";
/** Wikimedia requires a descriptive User-Agent; an empty one gets requests rejected, so never send blank. */
const WIKIMEDIA_UA =
  process.env.WIKIMEDIA_USER_AGENT?.trim() || "Orbit/1.0 (personal project; +https://github.com/runna5k/Orbit)";
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY ?? "";

/** Keyless community aggregators, tried in order until one answers. */
const READSB_CHAIN: ReadsbSource[] = ["adsb_lol", "adsb_fi", "airplanes_live"];

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const app = express();
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin))
  })
);
app.use(express.json({ limit: "48kb" }));

const aisSession = new AisStreamSession(AISSTREAM_API_KEY);

app.use("/api/cctv", cctvRouter());
app.use("/api/tle", tleRouter());
app.use("/api/keeptrack", keepTrackRouter());
app.use("/api/layers", layersRouter());
app.use("/api/settings", settingsRouter());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "orbit-plane-api",
    ais: Boolean(AISSTREAM_API_KEY.trim()),
    providers: providerSnapshot(),
    aisStatus: aisSession.statusSnapshot()
  });
});

/** Viewport subscription for AISStream (server holds API key; see https://aisstream.io/documentation ). */
app.post("/api/ais/subscription", (req, res) => {
  const lat = Number(req.body?.lat);
  const lon = Number(req.body?.lon);
  const distNm = Number(req.body?.distNm ?? 100);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(distNm)) {
    res.status(400).json({ error: "lat, lon, distNm must be finite numbers" });
    return;
  }
  // No AISStream key is fine: keyless regional feeds (e.g. the Baltic) still serve the view.
  // Up to 10,800 NM (wide enough for every longitude, i.e. the whole planet): the browser asks for the whole visible area, and AISStream's full
  // world stream is only ~80 messages a second.
  aisSession.requestSubscription(clamp(lat, -85, 85), clamp(lon, -180, 180), clamp(distNm, 20, 10_800));
  res.json({ ok: true, status: aisSession.statusSnapshot() });
});

app.get("/api/ais/status", (_req, res) => {
  res.json(aisSession.statusSnapshot());
});

async function runProvider(
  name: string,
  status: Record<string, ProviderHealth>,
  fn: () => Promise<RawPlaneLayer[]>
): Promise<RawPlaneLayer[]> {
  if (cooldownRemainingMs(name) > 0) {
    status[name] = "skipped_cooldown";
    return [];
  }
  try {
    const rows = await fn();
    recordSuccess(name);
    status[name] = "ok";
    return rows;
  } catch (e) {
    status[name] = recordFailure(name, e);
    console.warn(`[plane-api] ${name} failed (${status[name]}):`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function runReadsbChain(
  status: Record<string, ProviderHealth>,
  lat: number,
  lon: number,
  distNm: number
): Promise<RawPlaneLayer[]> {
  for (let i = 0; i < READSB_CHAIN.length; i++) {
    const src = READSB_CHAIN[i]!;
    const rows = await runProvider(src, status, () => fetchReadsbPoint(src, lat, lon, distNm));
    if (status[src] === "ok") {
      for (const rest of READSB_CHAIN.slice(i + 1)) status[rest] = "skipped_fallback";
      return rows;
    }
  }
  return [];
}

async function buildAircraftPayload(
  key: string,
  lat: number,
  lon: number,
  distNm: number
): Promise<AggregatedAircraftResponse> {
  const providerStatus: Record<string, ProviderHealth> = {};
  const box = boundingBoxFromCenterNm(lat, lon, distNm);

  const openSkyP: Promise<RawPlaneLayer[]> =
    !OPENSKY_ID || !OPENSKY_SECRET
      ? Promise.resolve().then(() => {
          providerStatus.opensky = "skipped_no_credentials";
          return [];
        })
      : !box
        ? Promise.resolve().then(() => {
            providerStatus.opensky = "error";
            return [];
          })
        : runProvider("opensky", providerStatus, () => fetchOpenSkyStatesLayer(box, OPENSKY_ID, OPENSKY_SECRET));

  const adsbxP: Promise<RawPlaneLayer[]> = ADSBX_KEY.trim()
    ? runProvider("adsbx", providerStatus, () => fetchAdsbxPoint(lat, lon, distNm, ADSBX_KEY))
    : Promise.resolve().then(() => {
        providerStatus.adsbx = "skipped_no_credentials";
        return [];
      });

  const readsbP = runReadsbChain(providerStatus, lat, lon, distNm);

  const layers = await Promise.all([openSkyP, adsbxP, readsbP]);
  const anyOk = Object.values(providerStatus).includes("ok");
  if (!anyOk) {
    throw new Error(`all aircraft providers failed: ${JSON.stringify(providerStatus)}`);
  }

  const { aircraft, countsByPositionSource } = mergeRawPlaneLayers(layers);
  const payload: AggregatedAircraftResponse = {
    fetchedAt: new Date().toISOString(),
    providerStatus,
    countsByPositionSource: countsByPositionSource as Record<PlanePositionSource, number>,
    aircraft
  };
  setCached(key, payload);
  return payload;
}

app.get("/api/aircraft", async (req, res) => {
  const latQ = Number(req.query.lat);
  const lonQ = Number(req.query.lon);
  const distQ = Number(req.query.distNm ?? req.query.dist ?? "100");
  if (!Number.isFinite(latQ) || !Number.isFinite(lonQ) || !Number.isFinite(distQ)) {
    res.status(400).json({ error: "lat, lon, distNm must be numbers" });
    return;
  }
  const lat = snapCenter(clamp(latQ, -85, 85));
  const lon = snapCenter(clamp(lonQ, -180, 180));
  const distNm = clamp(distQ, 10, 250);
  const key = planeCacheKey(lat, lon, distNm);

  const fresh = getFresh(key);
  if (fresh) {
    res.json(fresh);
    return;
  }

  try {
    res.json(await coalesce(key, () => buildAircraftPayload(key, lat, lon, distNm)));
  } catch (e) {
    const stale = getStale(key);
    if (stale) {
      res.json({ ...stale, stale: true });
      return;
    }
    console.warn("[plane-api] /api/aircraft failed with no stale data:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: "All aircraft providers are unavailable", providers: providerSnapshot() });
  }
});

/** Proxies OpenSky flights/aircraft with server-side OAuth (no browser secrets). */
app.get("/api/opensky/flights/aircraft", async (req, res) => {
  const icao24 = String(req.query.icao24 ?? "").trim().toLowerCase();
  const begin = String(req.query.begin ?? "").trim();
  const end = String(req.query.end ?? "").trim();
  if (!/^[0-9a-f]{6}$/.test(icao24) || !/^\d+$/.test(begin) || !/^\d+$/.test(end)) {
    res.status(400).json({ error: "icao24 (6 hex), begin, end (unix sec) required" });
    return;
  }
  if (cooldownRemainingMs("opensky") > 0) {
    res.status(503).json({ error: "OpenSky is cooling down after errors" });
    return;
  }

  const q = new URLSearchParams({ icao24, begin, end });
  const url = `https://opensky-network.org/api/flights/aircraft?${q.toString()}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const bearer = await getOpenSkyBearer(OPENSKY_ID, OPENSKY_SECRET);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  try {
    const { ok, status, text } = await fetchText(url, { headers, timeoutMs: 20_000, retries: 1 });
    res.status(status);
    res.setHeader("Content-Type", "application/json");
    res.send(text || "[]");
    if (!ok) console.warn(`[plane-api] OpenSky flights proxy HTTP ${status}`);
  } catch (e) {
    console.warn("[plane-api] OpenSky flights proxy error:", e);
    res.status(502).json({ error: "OpenSky flights proxy failed", detail: String(e) });
  }
});

/** Place name -> coordinates (used to put a ship's AIS destination on the map). Cached; 1 request/s upstream. */
app.get("/api/geocode/place", async (req, res) => {
  const q = String(req.query.q ?? "");
  try {
    const hit = await geocodePlace(q);
    if (!hit) {
      res.status(404).json({ error: "no match" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(hit);
  } catch (e) {
    console.warn("[plane-api] geocode failed:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: "geocoder unavailable" });
  }
});

/** ALPR locations (OpenStreetMap) in a bounding box, served from cached one-degree tiles. */
app.get("/api/alpr", async (req, res) => {
  const [w, s, e, n] = ["w", "s", "e", "n"].map((k) => Number(req.query[k]));
  if ([w, s, e, n].some((v) => !Number.isFinite(v)) || Math.abs(s!) > 90 || Math.abs(n!) > 90 || s! > n!) {
    res.status(400).json({ error: "w, s, e, n must be valid degrees" });
    return;
  }
  const lim = Number(req.query.limit ?? 30000);
  const limit = Number.isFinite(lim) ? Math.min(60000, Math.max(100, Math.floor(lim))) : 30000;
  try {
    const out = await queryAlpr(w!, s!, e!, n!, limit);
    if (out === "too-wide") {
      res.status(413).json({ error: "View too wide — zoom in a little to load ALPR" });
      return;
    }
    res.setHeader("Cache-Control", out.tilesPending ? "no-store" : "public, max-age=60");
    res.json(out);
  } catch (e) {
    console.warn("[plane-api] alpr failed:", e instanceof Error ? e.message : e);
    res.status(500).json({ error: "alpr registry error" });
  }
});

/** Data centers from OpenStreetMap + PeeringDB + Wikidata, merged so each facility appears once. */
app.get("/api/datacenters", async (req, res) => {
  const [w, s, e, n] = ["w", "s", "e", "n"].map((k) => Number(req.query[k]));
  if ([w, s, e, n].some((v) => !Number.isFinite(v)) || Math.abs(s!) > 90 || Math.abs(n!) > 90 || s! > n!) {
    res.status(400).json({ error: "w, s, e, n must be valid degrees" });
    return;
  }
  try {
    const out = await queryDatacenters(w!, s!, e!, n!, 20000);
    if (out === "too-wide") {
      res.status(413).json({ error: "View too wide — zoom in a little to load data centers" });
      return;
    }
    res.setHeader("Cache-Control", out.tilesPending ? "no-store" : "public, max-age=60");
    res.json(out);
  } catch (e) {
    console.warn("[plane-api] datacenters failed:", e instanceof Error ? e.message : e);
    res.status(500).json({ error: "data center registry error" });
  }
});

/** Registry of notable privately owned aircraft (hex -> owner label); the client uses it to highlight them. */
app.get("/api/notable-aircraft", async (_req, res) => {
  try {
    const aircraft = await getNotableAircraft();
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({ aircraft });
  } catch (e) {
    console.warn("[plane-api] notable list failed:", e instanceof Error ? e.message : e);
    res.json({ aircraft: [] });
  }
});

/** Registry aircraft that are airborne right now (worldwide). */
app.get("/api/notable-aircraft/live", async (_req, res) => {
  try {
    const live = await getLiveNotableAircraft();
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ live });
  } catch (e) {
    console.warn("[plane-api] notable live failed:", e instanceof Error ? e.message : e);
    res.json({ live: [] });
  }
});

/** Published origin/destination for a callsign (adsbdb, keyless). 404 = no route known; 502 = provider trouble. */
app.get("/api/flight/:callsign", async (req, res) => {
  try {
    const route = await flightRouteFor(String(req.params.callsign ?? ""));
    if (!route) {
      res.status(404).json({ error: "no published route for this callsign" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(route);
  } catch (e) {
    console.warn("[plane-api] flight route lookup failed:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: "route lookup unavailable" });
  }
});

app.get("/api/aircraft-photo", async (req, res) => {
  const registration = String(req.query.registration ?? "").trim();
  const aircraftType = String(req.query.type ?? "").trim();
  const description = String(req.query.description ?? "").trim();
  const hex = String(req.query.hex ?? "").trim();

  const out: AircraftPhotoResponse = {
    thumbUrl: null,
    attribution: null,
    source: "none"
  };

  // 1) A photo of this exact airframe (Planespotters, photographer credited).
  if (hex) {
    try {
      const exact = await aircraftPhotoByHex(hex);
      if (exact) {
        res.setHeader("Cache-Control", "public, max-age=600");
        res.json(exact);
        return;
      }
    } catch (e) {
      console.warn("[plane-api] Planespotters lookup failed:", e instanceof Error ? e.message : e);
    }
  }

  if (!registration && !aircraftType) {
    res.json(out);
    return;
  }

  // 2) Fall back to a generic photo of the type from Wikimedia Commons.
  try {
    const hit = await commonsAircraftPhoto(
      registration,
      aircraftType,
      description || undefined,
      WIKIMEDIA_UA
    );
    if (hit) {
      out.thumbUrl = hit.thumbUrl;
      out.attribution = `${hit.attribution} · ${hit.pageUrl}`;
      out.source = "wikimedia_commons";
    }
  } catch (e) {
    console.warn("[plane-api] Commons photo lookup failed:", e);
  }
  res.json(out);
});

app.get("/api/aircraft-model-gallery", async (req, res) => {
  const aircraftType = String(req.query.type ?? "").trim();
  const description = String(req.query.description ?? "").trim();
  const lim = Number(req.query.limit ?? 8);
  const limit = Number.isFinite(lim) ? Math.min(12, Math.max(1, Math.floor(lim))) : 8;

  const out: AircraftModelGalleryResponse = { items: [], source: "none" };
  if (aircraftType.length < 2 && description.length < 8) {
    res.json(out);
    return;
  }

  try {
    const items = await commonsAircraftModelGallery(
      aircraftType,
      description || undefined,
      WIKIMEDIA_UA,
      limit
    );
    if (items.length > 0) {
      out.items = items;
      out.source = "wikimedia_commons";
    }
  } catch (e) {
    console.warn("[plane-api] Commons model gallery failed:", e);
  }
  res.json(out);
});

/**
 * The packaged app serves the built client itself (there is no Vite proxy): ORBIT_STATIC_DIR is the `dist` folder.
 * Left unset in development, where Vite serves the page and proxies /api here.
 */
const STATIC_DIR = process.env.ORBIT_STATIC_DIR?.trim();
if (STATIC_DIR) {
  app.use(express.static(STATIC_DIR));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/") || req.path === "/health") {
      next();
      return;
    }
    res.sendFile(join(STATIC_DIR, "index.html"));
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const path = (req.url ?? "").split("?")[0] ?? "";
  const origin = req.headers.origin;
  // Vite's proxy rewrites Host, so the page's own host arrives as X-Forwarded-Host (see wsOrigin.ts).
  const pageHost = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  if (path === "/api/ais/stream" && aisOriginAllowed(origin, pageHost)) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      aisSession.addClient(ws);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.info(`[plane-api] listening on http://${HOST}:${PORT}`);
  if (!OPENSKY_ID || !OPENSKY_SECRET) {
    console.info("[plane-api] OPENSKY_CLIENT_ID/SECRET not set — OpenSky layer skipped (keyless adsb.lol / adsb.fi are used).");
  }
  if (!AISSTREAM_API_KEY.trim()) {
    console.warn("[plane-api] AISSTREAM_API_KEY not set — AIS vessel stream disabled (set in .env.local).");
  }
});

function shutdown(): void {
  aisSession.shutdown();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
