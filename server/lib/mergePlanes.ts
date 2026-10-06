import {
  PLANE_POSITION_SOURCES,
  type NormalizedAircraft,
  type PlanePositionSource
} from "../../shared/planeContract";
import type { RawPlaneLayer } from "./openskyStates";

const SOURCE_PRIORITY: readonly PlanePositionSource[] = PLANE_POSITION_SOURCES;

function pickFresher(a: RawPlaneLayer, b: RawPlaneLayer): RawPlaneLayer {
  if (a.lastSeenSec !== b.lastSeenSec) return a.lastSeenSec >= b.lastSeenSec ? a : b;
  const ia = SOURCE_PRIORITY.indexOf(a.source);
  const ib = SOURCE_PRIORITY.indexOf(b.source);
  return ia <= ib ? a : b;
}

function mergeScalar<T>(base: T | null | undefined, add: T | null | undefined): T | null {
  if (base !== null && base !== undefined && base !== "") return base as T;
  if (add === null || add === undefined || add === "") return null;
  return add as T;
}

function flightAlnum(f: string): string {
  return f.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Filed flight-plan style IDs (same idea as client `flightIdLooksScheduledAirlineStyle`). */
function looksScheduledAirline(f: string): boolean {
  const s = flightAlnum(f);
  if (/^[A-Z]{3}\d{1,4}[A-Z]?$/.test(s)) return true;
  return /^[A-Z]{2}\d{3,4}[A-Z]?$/.test(s);
}

/** Mode S field often holds a tail-style string instead of a flight number. */
function looksTailLikeCallsign(f: string): boolean {
  const raw = f.trim().toUpperCase();
  if (!raw) return false;
  const c = raw.replace(/\s+/g, "").replace(/-/g, "");
  if (/^N[1-9]\d{0,5}[A-Z0-9]{0,4}$/.test(c)) return true;
  if (/^VH[A-Z0-9]{3}$/.test(c)) return true;
  if (/^G[A-Z]{4}$/.test(c)) return true;
  if (/^D[A-Z]{3}\d/.test(c) || /^D[A-Z]{4}\d/.test(c)) return true;
  if (/^[CFG][A-Z]\d[W-Z]/.test(c) && c.length <= 8) return true;
  if (/^(PP|PR|PT|PS)[A-Z]/.test(c)) return true;
  if (/^9[VH]\d/.test(c) || /^9[VH]-/.test(raw)) return true;
  if (/^Z[KST][A-Z]/.test(c) && c.length >= 5) return true;
  return false;
}

function layerRank(layer: RawPlaneLayer, winner: RawPlaneLayer): number {
  let r = 0;
  if (layer.source === winner.source) r += 100;
  r -= SOURCE_PRIORITY.indexOf(layer.source);
  return r;
}

function pickBestCallsign(parts: RawPlaneLayer[], winner: RawPlaneLayer): string | null {
  type Row = { text: string; score: number; rank: number };
  const rows: Row[] = [];
  for (const layer of parts) {
    const raw = layer.callsign?.trim();
    if (!raw) continue;
    let score = 0;
    if (looksScheduledAirline(raw)) score += 120;
    if (looksTailLikeCallsign(raw) && !looksScheduledAirline(raw)) score -= 60;
    score += Math.min(raw.length, 12);
    rows.push({ text: raw, score, rank: layerRank(layer, winner) });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.rank - a.rank;
  });
  return rows[0]!.text;
}

function mergeRegistration(a: string | null, b: string | null): string | null {
  const ta = (a ?? "").trim();
  const tb = (b ?? "").trim();
  if (!ta) return tb.length ? tb : null;
  if (!tb) return ta.length ? ta : null;
  const alen = ta.replace(/[^A-Z0-9]/gi, "").length;
  const blen = tb.replace(/[^A-Z0-9]/gi, "").length;
  if (blen > alen) return tb;
  if (alen > blen) return ta;
  return ta.length >= tb.length ? ta : tb;
}

function looksLikeIcaoTypeCode(s: string): boolean {
  const t = s.trim().toUpperCase().replace(/\s+/g, "");
  if (t.length < 2 || t.length > 6) return false;
  return /^[A-Z]{1,4}\d{0,2}[A-Z]?$/.test(t);
}

function mergeAircraftType(a: string | null, b: string | null): string | null {
  const ta = (a ?? "").trim();
  const tb = (b ?? "").trim();
  if (!ta) return tb.length ? tb : null;
  if (!tb) return ta.length ? ta : null;
  const ia = looksLikeIcaoTypeCode(ta);
  const ib = looksLikeIcaoTypeCode(tb);
  if (ia && !ib) return ta;
  if (ib && !ia) return tb;
  return ta.length >= tb.length ? ta : tb;
}

function mergeDescription(a: string | null, b: string | null): string | null {
  const ta = (a ?? "").trim();
  const tb = (b ?? "").trim();
  if (!ta) return tb.length ? tb : null;
  if (!tb) return ta.length ? ta : null;
  return ta.length >= tb.length ? ta : tb;
}

function backfillKinematics(winner: RawPlaneLayer, parts: RawPlaneLayer[]): {
  altitudeFt: number | null;
  speedKt: number | null;
  headingDeg: number | null;
  verticalRateFpm: number | null;
} {
  const ordered = [...parts].sort((a, b) => b.lastSeenSec - a.lastSeenSec);
  let altitudeFt = winner.altitudeFt;
  let speedKt = winner.speedKt;
  let headingDeg = winner.headingDeg;
  let verticalRateFpm = winner.verticalRateFpm;
  for (const p of ordered) {
    if (altitudeFt == null && p.altitudeFt != null) altitudeFt = p.altitudeFt;
    if (speedKt == null && p.speedKt != null) speedKt = p.speedKt;
    if (headingDeg == null && p.headingDeg != null) headingDeg = p.headingDeg;
    if (verticalRateFpm == null && p.verticalRateFpm != null) verticalRateFpm = p.verticalRateFpm;
  }
  return { altitudeFt, speedKt, headingDeg, verticalRateFpm };
}

/**
 * Merge overlapping feeds: freshest timestamp wins for lat/lon and timestamp;
 * callsign/type/reg/description combine heuristically; scalar route fields from any layer;
 * altitude/speed/heading/vertical rate backfilled when the position winner omits them.
 */
export function mergeRawPlaneLayers(layers: RawPlaneLayer[][]): {
  aircraft: NormalizedAircraft[];
  countsByPositionSource: Record<PlanePositionSource, number>;
} {
  const byHex = new Map<string, RawPlaneLayer[]>();
  for (const layer of layers) {
    for (const p of layer) {
      const list = byHex.get(p.hex) ?? [];
      list.push(p);
      byHex.set(p.hex, list);
    }
  }

  const counts: Record<PlanePositionSource, number> = {
    opensky: 0,
    adsb_lol: 0,
    adsb_fi: 0,
    airplanes_live: 0,
    adsbx: 0
  };

  const aircraft: NormalizedAircraft[] = [];

  for (const [, parts] of byHex) {
    if (parts.length === 0) continue;
    let winner = parts[0];
    for (let i = 1; i < parts.length; i++) {
      winner = pickFresher(winner, parts[i]);
    }
    counts[winner.source] += 1;

    const enrichedFrom = new Set<PlanePositionSource>();
    for (const p of parts) {
      if (p.source !== winner.source) enrichedFrom.add(p.source);
    }

    const callsign = pickBestCallsign(parts, winner);

    let registration = winner.registration;
    let aircraftType = winner.aircraftType;
    let description = winner.description;
    for (const p of parts) {
      registration = mergeRegistration(registration, p.registration);
      aircraftType = mergeAircraftType(aircraftType, p.aircraftType);
      description = mergeDescription(description, p.description);
    }

    let category = winner.category;
    let originAirport = winner.originAirport;
    let destinationAirport = winner.destinationAirport;
    let departureTime = winner.departureTime;
    let arrivalTime = winner.arrivalTime;

    const metaOrder = [...parts].sort((a, b) => {
      if (a.source === winner.source) return -1;
      if (b.source === winner.source) return 1;
      return SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source);
    });

    for (const p of metaOrder) {
      category = mergeScalar(category, p.category);
      originAirport = mergeScalar(originAirport, p.originAirport);
      destinationAirport = mergeScalar(destinationAirport, p.destinationAirport);
      departureTime = mergeScalar(departureTime, p.departureTime);
      arrivalTime = mergeScalar(arrivalTime, p.arrivalTime);
    }

    const kin = backfillKinematics(winner, parts);

    aircraft.push({
      icao24: winner.hex,
      callsign,
      registration,
      aircraftType,
      description,
      latitude: winner.lat,
      longitude: winner.lon,
      altitudeFt: kin.altitudeFt,
      speedKt: kin.speedKt,
      headingDeg: kin.headingDeg,
      verticalRateFpm: kin.verticalRateFpm,
      onGround: winner.onGround,
      originAirport,
      destinationAirport,
      departureTime,
      arrivalTime,
      lastSeen: new Date(winner.lastSeenSec * 1000).toISOString(),
      positionSource: winner.source,
      category,
      enrichedFrom: Array.from(enrichedFrom)
    });
  }

  return { aircraft, countsByPositionSource: counts };
}
