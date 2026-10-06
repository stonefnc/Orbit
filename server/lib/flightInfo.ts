import type { AircraftPhotoResponse, FlightRouteAirport, FlightRouteResponse } from "../../shared/planeContract";
import { fetchJson, ProviderHttpError } from "./fetchUtil";
import { cooldownRemainingMs, recordFailure, recordSuccess } from "./providerGate";

const UA = "Orbit/1.0 (personal; +https://github.com/runna5k/Orbit)";

/**
 * In-memory only on purpose: adsbdb asks that its route data not be copied into other databases, so lookups are
 * cached for the life of the process (to avoid hammering a free community API) and never written to disk.
 */
type Cached<T> = { at: number; ttl: number; value: T };

function makeCache<T>(max: number) {
  const store = new Map<string, Cached<T>>();
  return {
    get(key: string): T | undefined {
      const e = store.get(key);
      if (!e) return undefined;
      if (Date.now() - e.at > e.ttl) {
        store.delete(key);
        return undefined;
      }
      return e.value;
    },
    set(key: string, value: T, ttl: number): void {
      store.delete(key);
      store.set(key, { at: Date.now(), ttl, value });
      while (store.size > max) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    }
  };
}

const HOUR = 60 * 60_000;

/** At most one request per `gapMs` per host, reserved synchronously so concurrent callers can't burst. */
const nextSlot = new Map<string, number>();
async function spaced(host: string, gapMs: number): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + gapMs);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

// ---------------------------------------------------------------- route (adsbdb)

const routeCache = makeCache<FlightRouteResponse | null>(500);
const routeInflight = new Map<string, Promise<FlightRouteResponse | null>>();

type AdsbdbAirport = {
  icao_code?: string;
  iata_code?: string;
  name?: string;
  municipality?: string;
  country_name?: string;
  latitude?: number;
  longitude?: number;
};

function toAirport(a: AdsbdbAirport | undefined | null): FlightRouteAirport | null {
  if (!a || typeof a.latitude !== "number" || typeof a.longitude !== "number") return null;
  return {
    icao: a.icao_code ?? null,
    iata: a.iata_code ?? null,
    name: a.name ?? null,
    municipality: a.municipality ?? null,
    country: a.country_name ?? null,
    lat: a.latitude,
    lon: a.longitude
  };
}

async function lookupRoute(callsign: string): Promise<FlightRouteResponse | null> {
  if (cooldownRemainingMs("adsbdb") > 0) throw new Error("adsbdb cooling down");
  await spaced("adsbdb", 250);
  try {
    const { ok, status, data, retryAfterSec } = await fetchJson<{
      response?:
        | string
        | {
            flightroute?: {
              callsign?: string;
              airline?: { name?: string; icao?: string; iata?: string } | null;
              origin?: AdsbdbAirport;
              destination?: AdsbdbAirport;
            };
          };
    }>(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
      timeoutMs: 10_000,
      retries: 0,
      headers: { "User-Agent": UA, Accept: "application/json" }
    });
    if (status === 404) {
      recordSuccess("adsbdb");
      return null;
    }
    if (!ok) throw new ProviderHttpError("adsbdb", status, retryAfterSec);
    recordSuccess("adsbdb");
    const fr = typeof data?.response === "object" ? data.response?.flightroute : undefined;
    if (!fr) return null; // "unknown callsign"
    const origin = toAirport(fr.origin);
    const destination = toAirport(fr.destination);
    if (!origin && !destination) return null;
    return {
      callsign: fr.callsign ?? callsign,
      airline: fr.airline?.name ? { name: fr.airline.name, icao: fr.airline.icao ?? null, iata: fr.airline.iata ?? null } : null,
      origin,
      destination
    };
  } catch (e) {
    recordFailure("adsbdb", e);
    throw e;
  }
}

/** Resolves to null when the callsign has no published route; throws only on provider trouble. */
export async function flightRouteFor(rawCallsign: string): Promise<FlightRouteResponse | null> {
  const callsign = rawCallsign.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(callsign)) return null;
  const hit = routeCache.get(callsign);
  if (hit !== undefined) return hit;
  const existing = routeInflight.get(callsign);
  if (existing) return existing;
  const p = lookupRoute(callsign)
    .then((v) => {
      routeCache.set(callsign, v, v ? 6 * HOUR : 30 * 60_000);
      return v;
    })
    .finally(() => routeInflight.delete(callsign));
  routeInflight.set(callsign, p);
  return p;
}

// ---------------------------------------------------------------- photo (Planespotters)

const photoCache = makeCache<AircraftPhotoResponse | null>(800);
const photoInflight = new Map<string, Promise<AircraftPhotoResponse | null>>();

type PlanespottersResponse = {
  photos?: Array<{
    thumbnail_large?: { src?: string };
    thumbnail?: { src?: string };
    link?: string;
    photographer?: string;
  }>;
};

async function lookupPhoto(hex: string): Promise<AircraftPhotoResponse | null> {
  if (cooldownRemainingMs("planespotters") > 0) throw new Error("planespotters cooling down");
  await spaced("planespotters", 300);
  try {
    const { ok, status, data, retryAfterSec } = await fetchJson<PlanespottersResponse>(
      `https://api.planespotters.net/pub/photos/hex/${hex}`,
      { timeoutMs: 10_000, retries: 0, headers: { "User-Agent": UA, Accept: "application/json" } }
    );
    if (!ok) throw new ProviderHttpError("planespotters", status, retryAfterSec);
    recordSuccess("planespotters");
    const p = data?.photos?.[0];
    const src = p?.thumbnail_large?.src ?? p?.thumbnail?.src;
    if (!p || !src || !/^https:\/\/t\.plnspttrs\.net\//.test(src)) return null;
    return {
      thumbUrl: src,
      attribution: `Photo © ${p.photographer ?? "unknown"} · Planespotters.net`,
      pageUrl: p.link ?? null,
      source: "planespotters"
    };
  } catch (e) {
    recordFailure("planespotters", e);
    throw e;
  }
}

/** Photo of this exact airframe (by ICAO24 hex), credited to its photographer, or null. */
export async function aircraftPhotoByHex(rawHex: string): Promise<AircraftPhotoResponse | null> {
  const hex = rawHex.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;
  const hit = photoCache.get(hex);
  if (hit !== undefined) return hit;
  const existing = photoInflight.get(hex);
  if (existing) return existing;
  const p = lookupPhoto(hex)
    .then((v) => {
      photoCache.set(hex, v, v ? 24 * HOUR : 2 * HOUR);
      return v;
    })
    .finally(() => photoInflight.delete(hex));
  photoInflight.set(hex, p);
  return p;
}
