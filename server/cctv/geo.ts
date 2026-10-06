const COMPASS: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5
};

const WORD: Record<string, string> = {
  north: "N",
  northbound: "N",
  nb: "N",
  south: "S",
  southbound: "S",
  sb: "S",
  east: "E",
  eastbound: "E",
  eb: "E",
  west: "W",
  westbound: "W",
  wb: "W"
};

/** "Eastbound" / "East" / "NE" / "north east" → degrees clockwise from north, or null if not a single direction. */
export function headingFromDirection(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return null;
  if (WORD[t]) return COMPASS[WORD[t]!]!;
  const combo = /^(north|south)(east|west)(bound)?$/.exec(t);
  if (combo) return COMPASS[`${combo[1] === "north" ? "N" : "S"}${combo[2] === "east" ? "E" : "W"}`]!;
  const upper = t.toUpperCase();
  return upper in COMPASS ? COMPASS[upper]! : null;
}

export function validLatLon(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
