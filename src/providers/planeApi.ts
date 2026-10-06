import type {
  AggregatedAircraftResponse,
  AircraftModelGalleryResponse,
  AircraftPhotoResponse,
  FlightRouteResponse,
  NormalizedAircraft
} from "../../shared/planeContract";
import type { PlaneClassifyInput } from "../planeTrafficClass";

function planeApiBase(): string {
  const fromEnv = import.meta.env.VITE_PLANE_API_BASE as string | undefined;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  return "";
}

export function classifyInputFromNormalized(ac: NormalizedAircraft): PlaneClassifyInput {
  return {
    hex: ac.icao24,
    flight: ac.callsign,
    t: ac.aircraftType,
    desc: ac.description,
    category: ac.category,
    r: ac.registration
  };
}

const MAX_FETCH_ATTEMPTS = 3;

export async function fetchAggregatedAircraft(
  lat: number,
  lon: number,
  distNm: number
): Promise<AggregatedAircraftResponse> {
  const root = planeApiBase();
  const q = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    distNm: String(distNm)
  });
  const url = `${root}/api/aircraft?${q.toString()}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const to = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      window.clearTimeout(to);
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Plane API HTTP ${res.status}: ${t.slice(0, 200)}`);
      }
      return (await res.json()) as AggregatedAircraftResponse;
    } catch (e) {
      window.clearTimeout(to);
      lastErr = e;
      if (attempt < MAX_FETCH_ATTEMPTS) {
        await new Promise((r) => window.setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Published origin/destination for a callsign, or null when none is known. Never throws. */
export async function fetchFlightRoute(callsign: string): Promise<FlightRouteResponse | null> {
  const cs = callsign.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(cs)) return null;
  try {
    const res = await fetch(`${planeApiBase()}/api/flight/${encodeURIComponent(cs)}`, {
      signal: AbortSignal.timeout(15_000)
    });
    return res.ok ? ((await res.json()) as FlightRouteResponse) : null;
  } catch {
    return null;
  }
}

export async function fetchAircraftPhotoMeta(
  registration: string | null,
  aircraftType: string | null,
  description?: string | null,
  hex?: string | null
): Promise<AircraftPhotoResponse> {
  const root = planeApiBase();
  const q = new URLSearchParams();
  if (hex) q.set("hex", hex);
  if (registration) q.set("registration", registration);
  if (aircraftType) q.set("type", aircraftType);
  if (description?.trim()) q.set("description", description.trim());
  const url = `${root}/api/aircraft-photo?${q.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    return { thumbUrl: null, attribution: null, source: "none" };
  }
  return (await res.json()) as AircraftPhotoResponse;
}

export async function fetchAircraftModelGallery(
  aircraftType: string | null,
  description: string | null | undefined,
  limit = 8
): Promise<AircraftModelGalleryResponse> {
  const root = planeApiBase();
  const t = (aircraftType ?? "").trim();
  const d = (description ?? "").trim();
  if (t.length < 2 && d.length < 8) {
    return { items: [], source: "none" };
  }
  const q = new URLSearchParams();
  if (t.length >= 2) q.set("type", t);
  if (d) q.set("description", d);
  q.set("limit", String(Math.min(12, Math.max(1, Math.floor(limit)))));
  const url = `${root}/api/aircraft-model-gallery?${q.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    return { items: [], source: "none" };
  }
  return (await res.json()) as AircraftModelGalleryResponse;
}
