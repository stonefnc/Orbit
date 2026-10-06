import { alprPointsInBox } from "./alpr";

/**
 * Street-following routes from the community OSRM servers run by FOSSGIS (OpenStreetMap data, keyless). Separate
 * servers handle driving, walking and cycling. Fair-use: results are cached and requests are spaced out.
 *
 * "Avoid ALPR" is a simulation built on top of plain OSRM, which cannot avoid points: it asks for alternative routes,
 * counts the mapped ALPR cameras within ~40 m of each, and when the best still passes cameras it tries detours through
 * waypoints placed to either side of the first camera, keeping whichever candidate passes the fewest (within a time
 * budget). It can only avoid cameras that are mapped in OpenStreetMap, and a camera on the only road in or out of a place
 * cannot be avoided.
 */
export type RouteProfile = "driving" | "foot" | "bike";

export type RouteStep = {
  name: string;
  distance: number;
  duration: number;
  type: string;
  modifier: string | null;
  exit: number | null;
  location: [number, number];
};

export type RouteResult = {
  distance: number;
  duration: number;
  geometry: Array<[number, number]>;
  steps: RouteStep[];
};

export type AvoidReport = {
  /** Mapped cameras within ~40 m of the fastest route. */
  onFastest: number;
  /** Mapped cameras within ~40 m of the route returned. */
  onChosen: number;
  extraSeconds: number;
  extraMeters: number;
  /** False when some camera map tiles were still loading, so the count may be low. */
  dataComplete: boolean;
  /** "ok", "none-on-fastest", "unavoidable", "too-wide" */
  outcome: string;
};

export type AvoidingRoute = RouteResult & {
  avoid: AvoidReport;
  fastest: Array<[number, number]> | null;
  /** [lat, lon, onFastest, onChosen] for cameras near either route (for drawing). */
  cameras: Array<[number, number, boolean, boolean]>;
};

const HOSTS: Record<RouteProfile, string> = {
  driving: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  foot: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
  bike: "https://routing.openstreetmap.de/routed-bike/route/v1/bike"
};
const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)" };
const TTL_MS = 10 * 60_000;
const HIT_M = 40;

const cache = new Map<string, { at: number; value: RouteResult[] }>();
let nextSlot = 0;

async function spaced(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 700;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

type OsrmStep = {
  name?: string;
  distance?: number;
  duration?: number;
  maneuver?: { type?: string; modifier?: string; exit?: number; location?: [number, number] };
};
type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: Array<[number, number]> };
  legs?: Array<{ steps?: OsrmStep[] }>;
};
type OsrmResponse = { code?: string; message?: string; routes?: OsrmRoute[] };

function convert(r: OsrmRoute): RouteResult {
  const steps: RouteStep[] = [];
  for (const leg of r.legs ?? []) {
    for (const s of leg.steps ?? []) {
      if (!s.maneuver?.location) continue;
      steps.push({
        name: s.name ?? "",
        distance: s.distance ?? 0,
        duration: s.duration ?? 0,
        type: s.maneuver.type ?? "continue",
        modifier: s.maneuver.modifier ?? null,
        exit: s.maneuver.exit ?? null,
        location: s.maneuver.location
      });
    }
  }
  return { distance: r.distance, duration: r.duration, geometry: r.geometry.coordinates, steps };
}

/** One OSRM request through any number of waypoints; with exactly two points it can return alternatives too. */
async function osrm(profile: RouteProfile, pts: Array<[number, number]>, alternatives: boolean): Promise<RouteResult[]> {
  const coords = pts.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";");
  const key = `${profile}|${coords}|${alternatives && pts.length === 2 ? "alt" : ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  await spaced();
  const url = `${HOSTS[profile]}/${coords}?overview=full&geometries=geojson&steps=true${alternatives && pts.length === 2 ? "&alternatives=3" : ""}`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) });
  const j = (await res.json().catch(() => ({}))) as OsrmResponse;
  if (!res.ok || j.code !== "Ok" || !j.routes?.length) {
    throw new Error(j.code === "NoRoute" ? "No route found between those points" : j.message ?? `Routing HTTP ${res.status}`);
  }
  const value = j.routes.map(convert);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return value;
}

export async function getRoute(
  profile: RouteProfile,
  from: [number, number],
  to: [number, number]
): Promise<RouteResult> {
  return (await osrm(profile, [from, to], false))[0]!;
}

// ---------- ALPR avoidance ----------

type Pt = [lon: number, lat: number];

/** Metres east/north of an origin (good enough over a city-sized area). */
function makeProjector(lat0: number, lon0: number): (lon: number, lat: number) => [number, number] {
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * 111_320];
}

/** Indices of cameras within HIT_M of the route, with where along the route each one is. */
function hitCameras(
  geometry: Pt[],
  cams: Array<[number, number]>,
  proj: (lon: number, lat: number) => [number, number]
): Array<{ cam: number; at: number }> {
  const P = geometry.map(([lo, la]) => proj(lo, la));
  const hits: Array<{ cam: number; at: number }> = [];
  cams.forEach(([clat, clon], ci) => {
    const [cx, cy] = proj(clon, clat);
    let best = Infinity;
    let at = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, ay] = P[i]!;
      const [bx, by] = P[i + 1]!;
      // quick reject on the segment's padded bounding box
      if (cx < Math.min(ax, bx) - HIT_M || cx > Math.max(ax, bx) + HIT_M || cy < Math.min(ay, by) - HIT_M || cy > Math.max(ay, by) + HIT_M) continue;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0;
      const d = Math.hypot(cx - (ax + t * dx), cy - (ay + t * dy));
      if (d < best) {
        best = d;
        at = i;
      }
    }
    if (best <= HIT_M) hits.push({ cam: ci, at });
  });
  return hits.sort((a, b) => a.at - b.at);
}

function bboxOf(routes: RouteResult[], pad: number): { w: number; s: number; e: number; n: number } {
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  for (const r of routes) {
    for (const [lo, la] of r.geometry) {
      if (lo < w) w = lo;
      if (lo > e) e = lo;
      if (la < s) s = la;
      if (la > n) n = la;
    }
  }
  return { w: w - pad, s: s - pad, e: e + pad, n: n + pad };
}

function offsetPoint(lat: number, lon: number, eastM: number, northM: number): Pt {
  return [lon + eastM / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + northM / 111_320];
}

/**
 * Fastest route, or the best route found that passes the fewest mapped ALPR cameras without taking more than ~60% longer.
 * Waits up to ~25 s for camera map tiles that are not cached yet.
 */
export async function getRouteAvoidingAlpr(
  profile: RouteProfile,
  from: [number, number],
  to: [number, number]
): Promise<AvoidingRoute> {
  const candidates = await osrm(profile, [from, to], true);
  const fastest = candidates[0]!;

  const box = bboxOf(candidates, 0.004);
  let cams: Array<[number, number]> = [];
  let dataComplete = true;
  const deadline = Date.now() + 25_000;
  for (;;) {
    const got = await alprPointsInBox(box.w, box.s, box.e, box.n);
    if (got === "too-wide") {
      return {
        ...fastest,
        fastest: null,
        cameras: [],
        avoid: { onFastest: 0, onChosen: 0, extraSeconds: 0, extraMeters: 0, dataComplete: false, outcome: "too-wide" }
      };
    }
    cams = got.points;
    dataComplete = got.pending === 0;
    if (dataComplete || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 1_500));
  }

  const proj = makeProjector(from[1], from[0]);
  const score = (r: RouteResult): number => hitCameras(r.geometry as Pt[], cams, proj).length;
  const scored = candidates.map((r) => ({ r, hits: score(r) }));
  const onFastest = scored[0]!.hits;

  const finish = (best: RouteResult, hits: number, outcome: string): AvoidingRoute => {
    const fastHits = new Set(hitCameras(fastest.geometry as Pt[], cams, proj).map((h) => h.cam));
    const chosenHits = new Set(hitCameras(best.geometry as Pt[], cams, proj).map((h) => h.cam));
    // Cameras worth drawing: anything within ~250 m of either route.
    const near: Array<[number, number, boolean, boolean]> = [];
    const proj2 = proj;
    const lines = [fastest.geometry, best.geometry].map((g) => g.map(([lo, la]) => proj2(lo, la)));
    cams.forEach(([la, lo], ci) => {
      const [cx, cy] = proj2(lo, la);
      const close = lines.some((P) => {
        for (let i = 0; i < P.length; i += 2) {
          if (Math.hypot(P[i]![0] - cx, P[i]![1] - cy) < 250) return true;
        }
        return false;
      });
      if (close) near.push([la, lo, fastHits.has(ci), chosenHits.has(ci)]);
    });
    return {
      ...best,
      fastest: best === fastest ? null : fastest.geometry,
      cameras: near.slice(0, 600),
      avoid: {
        onFastest,
        onChosen: hits,
        extraSeconds: Math.round(best.duration - fastest.duration),
        extraMeters: Math.round(best.distance - fastest.distance),
        dataComplete,
        outcome
      }
    };
  };

  if (onFastest === 0) return finish(fastest, 0, "none-on-fastest");

  // Start from whichever alternative passes the fewest cameras (fastest wins ties).
  let best = scored.reduce((a, b) => (b.hits < a.hits || (b.hits === a.hits && b.r.duration < a.r.duration) ? b : a));
  const budget = fastest.duration * 1.6 + 240;
  const better = (h: number, r: RouteResult, cur: { r: RouteResult; hits: number }): boolean =>
    h < cur.hits || (h === cur.hits && r.duration < cur.r.duration);

  // Different corridors: route via points offset to either side of the straight line between the ends. This is what
  // finds a genuinely different set of roads when the fastest way runs along a camera-lined arterial.
  if (best.hits > 0) {
    const [mx, my] = [to[0] - from[0], to[1] - from[1]];
    const lenM = Math.hypot(mx * 111_320 * Math.cos((from[1] * Math.PI) / 180), my * 111_320);
    const off = Math.max(700, Math.min(6_000, lenM * 0.14));
    const nxy: [number, number] = [-(my * 111_320), mx * 111_320 * Math.cos((from[1] * Math.PI) / 180)];
    const nlen = Math.hypot(nxy[0], nxy[1]) || 1;
    for (const frac of [0.5, 0.33, 0.67]) {
      for (const side of [1, -1]) {
        if (best.hits === 0) break;
        const px = from[0] + mx * frac;
        const py = from[1] + my * frac;
        const wp = offsetPoint(py, px, (nxy[0] / nlen) * off * side, (nxy[1] / nlen) * off * side);
        try {
          const r = (await osrm(profile, [from, wp, to], false))[0]!;
          if (r.duration > budget) continue;
          const h = score(r);
          if (better(h, r, best)) best = { r, hits: h };
        } catch {
          /* this via point could not be routed; try the next */
        }
      }
    }
  }

  // Detours around the first camera still on the route: try waypoints to either side of it.
  for (let round = 0; round < 4 && best.hits > 0; round++) {
    const hits = hitCameras(best.r.geometry as Pt[], cams, proj);
    const first = hits[0];
    if (!first) break;
    const [clat, clon] = cams[first.cam]!;
    const g = best.r.geometry;
    const a = g[Math.max(0, first.at - 1)]!;
    const b = g[Math.min(g.length - 1, first.at + 2)]!;
    const [ax, ay] = proj(a[0], a[1]);
    const [bx, by] = proj(b[0], b[1]);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;

    let roundBest: { r: RouteResult; hits: number } | null = null;
    for (const off of [180, 360]) {
      for (const side of [1, -1]) {
        const wp = offsetPoint(clat, clon, nx * off * side, ny * off * side);
        try {
          const r = (await osrm(profile, [from, wp, to], false))[0]!;
          if (r.duration > budget) continue;
          const h = score(r);
          if (h < best.hits && (!roundBest || h < roundBest.hits || (h === roundBest.hits && r.duration < roundBest.r.duration))) {
            roundBest = { r, hits: h };
          }
        } catch {
          /* this waypoint could not be routed; try the next */
        }
      }
    }
    if (!roundBest) break;
    best = roundBest;
  }

  return finish(best.r, best.hits, best.hits < onFastest ? (best.hits === 0 ? "ok" : "reduced") : "unavoidable");
}
