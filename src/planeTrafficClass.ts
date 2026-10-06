/** Minimal fields for traffic heuristics (normalized API or legacy feeds). */
export type PlaneClassifyInput = {
  hex: string;
  flight?: string | null;
  t?: string | null;
  desc?: string | null;
  category?: string | null;
  r?: string | null;
};

/** Visual buckets: airlines vs biz/charter/owner transports vs GA vs military. */
export type PlaneTrafficKind = "military" | "airline" | "bizjet" | "other";

/** Chosen to stay distinct from each other and readable on both imagery and dark ocean (outlined on the map). */
const COLOR_MILITARY = "#ff5a4f"; // red
const COLOR_AIRLINE = "#4db3ff"; // blue
const COLOR_BIZJET = "#c58bff"; // purple
const COLOR_OTHER = "#5fe08a"; // green — general aviation, light aircraft, helicopters, misc

export function planeTrafficColorCss(kind: PlaneTrafficKind): string {
  switch (kind) {
    case "military":
      return COLOR_MILITARY;
    case "airline":
      return COLOR_AIRLINE;
    case "bizjet":
      return COLOR_BIZJET;
    default:
      return COLOR_OTHER;
  }
}

export const SELECTED_PLANE_COLOR_CSS = "#ffe4b5";

function normType(t: string): string {
  return t.replace(/[-\s]/g, "").toUpperCase();
}

function startsCode(u: string, code: string): boolean {
  return u.startsWith(code.toUpperCase());
}

/** ICAO emitter category letters (e.g. A3 = heavy / airliner-ish). */
function emitterCategory(ac: PlaneClassifyInput): string {
  const c = (ac.category ?? "").trim().toUpperCase();
  return c.length >= 2 ? c.slice(0, 2) : "";
}

/** Compact alphanumeric callsign/flight ID for regex tests. */
function flightAlnum(flight?: string | null): string {
  return (flight ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Filed flight-plan style IDs: ABC123 (ICAO designator); AB123 / AB1234 (IATA+LH carriers). */
export function flightIdLooksScheduledAirlineStyle(flight: string | null | undefined): boolean {
  const s = flightAlnum(flight);
  // Airlines often append one or two letters to the number (EZY12AB, BAW1AB, DLH4YK).
  if (/^[A-Z]{3}\d{1,4}[A-Z]{0,2}$/.test(s)) return true;
  return /^[A-Z]{2}\d{3,4}[A-Z]?$/.test(s);
}

/** Heuristic: Mode S flight field is holding a civil registration-style callsign, not ICAO+IATA numbering. */
export function flightIdLooksTailRegistrationOrNonAirline(flight: string | null | undefined): boolean {
  const raw = (flight ?? "").trim().toUpperCase();
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

/** Corporate jet / turboprop executive transports (distinct from RJ/NB scheduled types). */
function isCorporateJetType(ac: PlaneClassifyInput): boolean {
  const tRaw = (ac.t ?? "").trim();
  const u = tRaw ? normType(tRaw) : "";
  if (!u) return false;
  const corp = [
    "GLF",
    "G115",
    "G150",
    "G280",
    "G400",
    "G500",
    "G650",
    "GLEX",
    "FA7X",
    "FA8X",
    "F900",
    "F2TH",
    "F2000",
    "LJ",
    "LJ25",
    "LJ35",
    "LJ45",
    "LJ60",
    "LJ70",
    "LJ75",
    "LJ85",
    "GALX",
    "G200",
    "C25",
    "C510",
    "C525",
    "C550",
    "C560",
    "C680",
    "C700",
    "C750",
    "C72R",
    "CNJ",
    "CL30",
    "CL35",
    "CL60",
    "BD700",
    "E35L",
    "E545",
    "E550",
    "E55P",
    "P180",
    "PC12",
    "PC24",
    "BE40",
    "BE9L",
    "BE9T",
    "MU30",
    "HDJT",
    "HA4T",
    "WW24",
    "SBR1",
    "SBR2",
    "GL5T",
    "PRM1",
    "Eclipse",
    "EA50",
    "TBM8",
    "TBM9"
  ];
  for (const p of corp) {
    if (startsCode(u, p)) return true;
  }
  return false;
}

function isNarrowWideAirlinerFamily(ac: PlaneClassifyInput): boolean {
  const cat = emitterCategory(ac);
  if (cat === "A3" || cat === "A4" || cat === "A5") return true;

  const tRaw = (ac.t ?? "").trim();
  const u = tRaw ? normType(tRaw) : "";
  if (u.length < 3) return false;

  const paxPrefixes = [
    "B737",
    "B738",
    "B739",
    "B77",
    "B78",
    "B787",
    "B747",
    "B757",
    "B767",
    "B717",
    "A318",
    "A319",
    "A320",
    "A321",
    "A330",
    "A332",
    "A333",
    "A350",
    "A359",
    "A35K",
    "A380",
    "A346",
    "BCS1",
    "BCS3",
    "E170",
    "E175",
    "E190",
    "E195",
    "E75L",
    "E75",
    "CRJ",
    "DH8",
    "AT76",
    "AT72",
    "AT43",
    "MD80",
    "MD82",
    "MD83",
    "MD88",
    "MD90",
    "SFB",
    "A220",
    "B38M",
    "B39M"
  ];
  for (const p of paxPrefixes) {
    if (startsCode(u, p)) return true;
  }
  return false;
}

/**
 * Rough routing into four buckets. Airline vs biz jet uses callsign/filed-flight shape + airframe hints.
 */
export function classifyAircraftTraffic(ac: PlaneClassifyInput): PlaneTrafficKind {
  const cat = emitterCategory(ac);
  const tRaw = (ac.t ?? "").trim();
  const u = tRaw ? normType(tRaw) : "";
  const desc = (ac.desc ?? "").toUpperCase();
  const flight = ac.flight;
  const militaryFromCategory = cat === "A6";
  const militaryFromDescription =
    /\bAIR\s*FORCE\b|\bUSAF\b|\bRAF\b|\bNAVY\b|\bARMY\b|\bMARINES?\b|\bCOAST\s*GUARD\b|\bMILITARY\b|\bLUFTWAFFE\b/.test(
      desc
    );
  let militaryFromType = false;

  if (u.length >= 2) {
    const milPrefixes = [
      "F14",
      "F15",
      "F16",
      "F18",
      "F22",
      "F35",
      "A10",
      "B1A",
      "B1B",
      "B2",
      "B52",
      "C130",
      "C135",
      "C17",
      "C5",
      "E3",
      "E6",
      "E8",
      "P8",
      "T38",
      "V22",
      "CV22",
      "AH64",
      "CH47",
      "CH53",
      "UH60",
      "MH60",
      "SH60",
      "HH60",
      "SH62",
      "P3",
      "KC10",
      "KC135",
      "KC46",
      "MQ9",
      "RQ4",
      "U28",
      "AC130",
      "E4"
    ];
    for (const p of milPrefixes) {
      if (startsCode(u, p)) {
        militaryFromType = true;
        break;
      }
    }
  }

  /**
   * Weighted scoring:
   * - category A6 / explicit military words are strong signals by themselves.
   * - type prefix alone is not enough (reduces false positives), but it boosts confidence.
   */
  const militaryScore =
    (militaryFromCategory ? 2 : 0) +
    (militaryFromDescription ? 2 : 0) +
    (militaryFromType ? 1 : 0);
  if (militaryScore >= 2) return "military";

  if (isCorporateJetType(ac)) return "bizjet";

  if (isNarrowWideAirlinerFamily(ac)) {
    if (flightIdLooksTailRegistrationOrNonAirline(flight)) return "bizjet";
    if (flightIdLooksScheduledAirlineStyle(flight)) return "airline";
    return "bizjet";
  }

  return "other";
}

export function planeTrafficColorCssForAc(ac: PlaneClassifyInput): string {
  return planeTrafficColorCss(classifyAircraftTraffic(ac));
}
