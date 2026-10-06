import type { NormalizedAircraft } from "../shared/planeContract";
import type { Satellite } from "./providers/celestrak";
import type { AlprSite } from "./alpr/alprTypes";
import { ALPR_KIND_LABEL, alprKindForVendor } from "./alpr/alprIcons";
import { planeMatchesSearch } from "./planeSearch";
import { sanitizeCallsign } from "./providers/adsbfi";

/**
 * The matching rules behind the top-bar search for things on the map: aircraft (callsign, ICAO hex, registration,
 * airline, type), satellites (name, NORAD number, operator, country, purpose) and ALPR cameras (vendor, operator).
 * Pure functions over data the map already holds, so results appear as you type.
 */
const norm = (s: string | null | undefined): string => (s ?? "").toLowerCase();

// ---------- Satellites ----------

/** Operator guessed from the name family, for catalogs that don't carry an operator field. */
const SAT_FAMILIES: Array<[RegExp, string]> = [
  [/^STARLINK|^SPACEBEE|^STARSHIELD/, "SpaceX"],
  [/^ONEWEB/, "OneWeb (Eutelsat)"],
  [/^IRIDIUM/, "Iridium Communications"],
  [/^GLOBALSTAR/, "Globalstar"],
  [/^ORBCOMM/, "ORBCOMM"],
  [/^KUIPER/, "Amazon (Project Kuiper)"],
  [/^GPS|^NAVSTAR/, "US Space Force (GPS)"],
  [/^GLONASS|^COSMOS/, "Russia (GLONASS / Cosmos)"],
  [/^BEIDOU/, "China (BeiDou)"],
  [/^YAOGAN|^SHIYAN|^TIANHUI|^CZ-|^TIANGONG|^CSS|^TIANZHOU|^SHENZHOU/, "China (CNSA / PLA)"],
  [/^JILIN/, "Chang Guang Satellite Technology"],
  [/^GALILEO/, "European Union (Galileo)"],
  [/^SENTINEL/, "ESA (Copernicus)"],
  [/^LANDSAT|^TDRS|^AQUA|^TERRA|^AURA|^SUOMI/, "NASA"],
  [/^NOAA|^GOES|^DMSP|^JPSS/, "NOAA / US Government"],
  [/^METEOSAT|^METOP|^MSG/, "EUMETSAT"],
  [/^ISS|^ZARYA|^NAUKA|^POISK|^ROSCOSMOS/, "International Space Station partners"],
  [/^FLOCK|^DOVE|^SKYSAT|^PELICAN/, "Planet Labs"],
  [/^WORLDVIEW|^GEOEYE|^QUICKBIRD|^IKONOS/, "Maxar"],
  [/^LEMUR/, "Spire Global"],
  [/^HAWK/, "HawkEye 360"],
  [/^CAPELLA/, "Capella Space"],
  [/^ICEYE/, "ICEYE"],
  [/^UMBRA/, "Umbra"],
  [/^INTELSAT/, "Intelsat"],
  [/^SES|^ASTRA/, "SES"],
  [/^EUTELSAT/, "Eutelsat"],
  [/^TELESAT|^ANIK|^NIMIQ/, "Telesat"],
  [/^VIASAT/, "Viasat"],
  [/^INMARSAT/, "Inmarsat"],
  [/^ARABSAT/, "Arabsat"],
  [/^YAHSAT/, "Yahsat"],
  [/^THURAYA/, "Thuraya"],
  [/^HUBBLE|^JWST|^CHANDRA/, "NASA / ESA"]
];

export function satelliteOperatorGuess(name: string): string | null {
  const n = name.toUpperCase().trim();
  for (const [re, op] of SAT_FAMILIES) if (re.test(n)) return op;
  return null;
}

export type SatHit = { entityId: string; sat: Satellite; operator: string | null };

export function searchSatellites(sats: Map<string, Satellite>, rawQuery: string, limit = 5): { hits: SatHit[]; total: number } {
  const q = norm(rawQuery.trim());
  if (q.length < 2) return { hits: [], total: 0 };
  const numeric = /^\d{1,6}$/.test(q) ? Number(q) : null;
  const hits: Array<SatHit & { rank: number }> = [];
  let total = 0;
  for (const [entityId, sat] of sats) {
    const name = norm(sat.name);
    const op = sat.operator ?? satelliteOperatorGuess(sat.name);
    let rank = -1;
    if (numeric != null && sat.noradId === numeric) rank = 0;
    else if (name === q) rank = 1;
    else if (name.startsWith(q)) rank = 2;
    else if (name.includes(q)) rank = 3;
    else if (norm(op).includes(q)) rank = 4;
    else if (norm(sat.operator).includes(q) || norm(sat.operatorCountry).includes(q) || norm(sat.purpose).includes(q)) rank = 5;
    if (rank < 0) continue;
    total++;
    hits.push({ entityId, sat, operator: op, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.sat.name.localeCompare(b.sat.name));
  return { hits: hits.slice(0, limit), total };
}

// ---------- Aircraft ----------

export type PlaneHit = { entityId: string; ac: NormalizedAircraft; label: string };

/** Aircraft already on the map whose callsign / hex / registration / airline / type matches. */
export function searchPlanesLocal(
  planes: Map<string, NormalizedAircraft>,
  rawQuery: string,
  airlinePrefixes: string[],
  limit = 5
): { hits: PlaneHit[]; total: number } {
  const q = rawQuery.trim();
  if (q.length < 2) return { hits: [], total: 0 };
  const ql = q.toLowerCase();
  const prefixSet = new Set(airlinePrefixes);
  const scored: Array<PlaneHit & { rank: number }> = [];
  for (const [entityId, ac] of planes) {
    const cs = sanitizeCallsign(ac.callsign) ?? "";
    let rank = -1;
    if (planeMatchesSearch(ac, q)) rank = cs.toLowerCase() === ql ? 0 : 1;
    else if (prefixSet.size && prefixSet.has(cs.slice(0, 3).toUpperCase())) rank = 2;
    else if (norm(ac.aircraftType) === ql || norm(ac.description).includes(ql)) rank = 3;
    if (rank < 0) continue;
    scored.push({
      entityId,
      ac,
      rank,
      label: [cs || ac.icao24.toUpperCase(), ac.aircraftType, ac.registration].filter(Boolean).join(" · ")
    });
  }
  scored.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  return { hits: scored.slice(0, limit), total: scored.length };
}

// ---------- ALPR ----------

export type AlprGroup = { kind: "vendor" | "operator"; name: string; sites: AlprSite[] };

export function operatorOf(site: AlprSite): string {
  const m = /(?:^|·\s*)operator=([^·]+)/.exec(site.notes ?? "");
  return (m?.[1] ?? "").trim();
}

/**
 * Loaded cameras whose manufacturer or operator matches, grouped ("Flock Safety · 312", "Atlanta Police Department · 18").
 * Also matches the friendly vendor names ("flock", "motorola", "genetec") through the icon families.
 */
export function searchAlpr(sites: AlprSite[], rawQuery: string, limitGroups = 4): AlprGroup[] {
  const q = norm(rawQuery.trim());
  if (q.length < 2) return [];
  const vendors = new Map<string, AlprSite[]>();
  const operators = new Map<string, AlprSite[]>();
  for (const s of sites) {
    const vendor = (s.vendor ?? "").trim();
    const friendly = ALPR_KIND_LABEL[alprKindForVendor(vendor)];
    const op = operatorOf(s);
    if (vendor && (norm(vendor).includes(q) || norm(friendly).includes(q))) {
      const list = vendors.get(vendor) ?? [];
      list.push(s);
      vendors.set(vendor, list);
    }
    if (op && norm(op).includes(q)) {
      const list = operators.get(op) ?? [];
      list.push(s);
      operators.set(op, list);
    }
  }
  const groups: AlprGroup[] = [
    ...[...vendors].map(([name, list]) => ({ kind: "vendor" as const, name, sites: list })),
    ...[...operators].map(([name, list]) => ({ kind: "operator" as const, name, sites: list }))
  ];
  groups.sort((a, b) => b.sites.length - a.sites.length);
  return groups.slice(0, limitGroups);
}
