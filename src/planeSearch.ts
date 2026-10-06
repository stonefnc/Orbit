import type { NormalizedAircraft } from "../shared/planeContract";
import { sanitizeCallsign } from "./providers/adsbfi";

/** If the trimmed query is exactly 6 hex digits (optional 0x, spaces). */
export function normalizeHexQuery(query: string): string | null {
  const collapsed = query.replace(/^0x/i, "").replace(/[\s-]/g, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(collapsed) ? collapsed : null;
}

/** Match callsign · ICAO24 hex · aircraft registration against normalized aircraft. */
export function planeMatchesSearch(ac: NormalizedAircraft, rawQuery: string): boolean {
  const qTrim = rawQuery.trim();
  if (!qTrim.length) return false;

  const hexQ = normalizeHexQuery(qTrim);
  const hexAc = typeof ac.icao24 === "string" ? ac.icao24.trim().toLowerCase() : "";
  if (hexQ && hexAc === hexQ) return true;

  const qLoose = qTrim.toUpperCase().replace(/\s+/g, "");

  const reg = (ac.registration ?? "").toUpperCase().replace(/\s+/g, "");
  if (reg.length && qLoose.length >= 2) {
    if (reg === qLoose) return true;
    if (reg.includes(qLoose) || qLoose.includes(reg)) return true;
  }

  const flight = sanitizeCallsign(ac.callsign)?.toUpperCase().replace(/\s+/g, "") ?? "";
  if (flight.length && qLoose.length) {
    if (flight === qLoose) return true;
    if (flight.startsWith(qLoose)) return true;
    if (qLoose.length >= 3 && flight.includes(qLoose)) return true;
  }

  return false;
}

export function flightradar24CompareUrl(ac: NormalizedAircraft | null, fallbackQuery: string): string {
  const hex =
    typeof ac?.icao24 === "string" ? ac.icao24.trim().toLowerCase().replace(/^0x/, "") : "";
  if (/^[0-9a-f]{6}$/.test(hex)) {
    return `https://www.flightradar24.com/data/aircraft/${hex}`;
  }
  const reg = (ac?.registration ?? "").trim().toUpperCase().replace(/^REG-/i, "");
  if (reg.length >= 3 && /^[A-Z]{1,2}[A-Z0-9-]+$/.test(reg)) {
    return `https://www.flightradar24.com/data/aircraft/reg-${encodeURIComponent(reg)}`;
  }
  const cf = sanitizeCallsign(ac?.callsign)?.trim() ?? fallbackQuery.trim();
  if (cf.length >= 2) {
    return `https://www.flightradar24.com/simple?query=${encodeURIComponent(cf)}`;
  }
  if (fallbackQuery.trim().length >= 2) {
    return `https://www.flightradar24.com/simple?query=${encodeURIComponent(fallbackQuery.trim())}`;
  }
  return "https://www.flightradar24.com/";
}

export type PlaneSearchHit = {
  entityId: string;
  ac: NormalizedAircraft;
  /** Rough rank for ordering (lower = stronger match). */
  rank: number;
};

function rankMatch(ac: NormalizedAircraft, rawQuery: string): number | null {
  if (!planeMatchesSearch(ac, rawQuery)) return null;
  const qTrim = rawQuery.trim();
  const qUpper = qTrim.toUpperCase().replace(/\s+/g, "");

  const hexQ = normalizeHexQuery(qTrim);
  const hexAc = typeof ac.icao24 === "string" ? ac.icao24.trim().toLowerCase() : "";
  if (hexQ && hexAc === hexQ) return 0;

  const flight = sanitizeCallsign(ac.callsign)?.toUpperCase().replace(/\s+/g, "") ?? "";
  if (flight === qUpper) return 10;

  const reg = (ac.registration ?? "").toUpperCase().replace(/\s+/g, "");
  if (reg === qUpper) return 15;

  if (flight.startsWith(qUpper)) return 40;
  if (reg.includes(qUpper)) return 45;
  return 80;
}

/** One-line label for search hits / feedback. */
export function formatPlaneSearchLine(ac: NormalizedAircraft): string {
  const fl = sanitizeCallsign(ac.callsign);
  const parts = [
    fl && fl.trim().length ? fl.trim() : null,
    (ac.icao24 ?? "").toLowerCase() || null,
    ac.registration?.trim() || null
  ].filter((x): x is string => Boolean(x));
  return parts.length ? parts.join(" · ") : (ac.icao24 ?? "").toLowerCase();
}

export function sortedPlaneSearchHits(
  trackedPlanes: Map<string, NormalizedAircraft>,
  rawQuery: string
): PlaneSearchHit[] {
  const out: PlaneSearchHit[] = [];
  for (const [entityId, ac] of trackedPlanes) {
    const rank = rankMatch(ac, rawQuery);
    if (rank == null) continue;
    out.push({ entityId, ac, rank });
  }
  out.sort((a, b) => a.rank - b.rank || (a.ac.icao24 ?? "").localeCompare(b.ac.icao24 ?? ""));
  return out;
}
