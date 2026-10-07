import { collectTiles, createTileStore } from "./osmTiles";

/**
 * Candidate abandoned places from OpenStreetMap, each with a rule-based likelihood. Served per one-degree tile through
 * the shared OSM tile cache (osmTiles.ts), like the ALPR and data-center layers. Points only: a building or area is
 * reduced to its centre, and long linear things (disused railway lines, old roads) are left out.
 *
 * The likelihood comes from OpenStreetMap tags alone (no model, no key, no site visit), in four levels:
 *   very likely  abandoned=yes, abandoned:*, building=ruins, historic=ruins, ruins=*
 *   likely       disused=yes, disused:*, was:* on a real place (a school, a supermarket, a factory ...)
 *   maybe        the same on small shop units, offices and everyday amenities (they fall vacant all the time),
 *                a past end_date, opening_hours=closed, brownfield land, a name that says "former" / "closed" ...;
 *                two different "maybe" hints together make "likely"
 *   unlikely     only a weak hint (a name that starts with "Old")
 * It says what mappers recorded and nothing more: no access, entry or safety details are stored or invented.
 * Data © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
 */
export type AbandonedKind = "building" | "civic" | "industrial" | "transport" | "leisure" | "ruins" | "mine" | "other";
/** 0 unlikely, 1 maybe, 2 likely, 3 very likely. */
export type Likelihood = 0 | 1 | 2 | 3;
export const LIKELIHOOD_LABEL = ["Unlikely", "Maybe", "Likely", "Very likely"] as const;

/** [osm "n123" | "w123" | "r123", lat, lon, kind, name, what it is in plain words, the tags that produced the level, level] */
export type AbandonedItem = [string, number, number, AbandonedKind, string, string, string, Likelihood];

/** A tile takes Overpass up to a minute the first time, so a view may touch only a handful of new ones (about 3 degrees). */
const MAX_TILES_PER_QUERY = 16;
/** Per tile and query: a dense city tile holds thousands of disused shop units; keep the answer and the cache file sane. */
const MAX_ELEMENTS_PER_TILE = 8000;

/** What a place can have been, in the order they are tried: the first one found names it on the card. */
const FORMER_KEYS = [
  "amenity", "building", "shop", "man_made", "industrial", "landuse", "tourism", "leisure", "railway", "aeroway",
  "power", "military", "office", "craft", "healthcare", "historic"
] as const;

const KIND_OF: Record<string, AbandonedKind> = {
  amenity: "civic",
  healthcare: "civic",
  building: "building",
  shop: "building",
  office: "building",
  craft: "industrial",
  man_made: "industrial",
  industrial: "industrial",
  landuse: "industrial",
  power: "industrial",
  military: "industrial",
  railway: "transport",
  aeroway: "transport",
  tourism: "leisure",
  leisure: "leisure",
  historic: "ruins"
};

/** Railway values that are a place (a station) rather than a line; a disused line is not a point of interest. */
const RAILWAY_PLACES = new Set(["station", "halt", "stop", "depot", "roundhouse", "turntable"]);
/** Power values that are a site rather than a line. */
const POWER_PLACES = new Set(["plant", "generator", "substation", "station"]);
/** `landuse` values that mean a built-up site; farmland or forest that is "abandoned" is not what this layer is for. */
const LANDUSE_SITES = new Set(["industrial", "commercial", "retail", "railway", "quarry", "military", "construction", "brownfield", "garages"]);
/**
 * Street furniture and small fittings that carry lifecycle tags by the thousand (measured on three sample tiles: a
 * disused bench is as common as a disused school is rare). They are not places.
 */
const AMENITY_FITTINGS = new Set([
  "bench", "waste_basket", "waste_disposal", "bicycle_parking", "parking", "parking_space", "parking_entrance", "vending_machine",
  "telephone", "post_box", "atm", "bbq", "drinking_water", "toilets", "shelter", "clock", "recycling", "give_box", "charging_station",
  "bicycle_rental", "bicycle_repair_station", "taxi", "loading_dock", "hunting_stand", "lounger", "sanitary_dump_station",
  "device_charging_station", "fire_hydrant", "watering_place", "public_bookcase", "table", "dog_toilet", "grit_bin"
]);
/** Airfield parts that are strips and markings rather than buildings or sites. */
const AEROWAY_STRIPS = new Set(["runway", "taxiway", "parking_position", "navigationaid", "windsock", "holding_position", "gate", "stopway", "papi"]);
/** Mine openings: kept (owner's decision) under the same rules as everything else, drawn with their own pin, and flagged as a hazard on the card. */
const MINE_OPENINGS = new Set(["mineshaft", "adit"]);
/** Structures worth a pin. */
const MAN_MADE_STRUCTURES = new Set([
  "works", "water_tower", "chimney", "silo", "storage_tank", "tower", "lighthouse", "windmill", "watermill", "kiln", "wastewater_plant",
  "water_works", "gasometer", "crane", "observatory", "telescope", "pumping_station", "bunker_silo", "petroleum_well", "mast",
  ...MINE_OPENINGS
]);

/** The kind a main tag gives a place: mine openings are their own kind so they can be drawn and described differently. */
function kindFor(base: string, value: string): AbandonedKind {
  if (base === "man_made" && MINE_OPENINGS.has(value)) return "mine";
  return KIND_OF[base] ?? "other";
}
const LEISURE_SITES = new Set(["swimming_pool", "stadium", "sports_centre", "water_park", "ice_rink", "miniature_golf", "golf_course", "sports_hall", "bowling_alley", "racetrack", "resort"]);
const TOURISM_SITES = new Set(["hotel", "motel", "hostel", "guest_house", "chalet", "apartment", "camp_site", "caravan_site", "theme_park", "zoo", "museum", "gallery", "attraction", "resort"]);

/** Amenities and shops big or distinctive enough that "disused" means a place worth a look, not an empty unit. */
const LARGE_AMENITIES = new Set([
  "school", "college", "university", "kindergarten", "hospital", "clinic", "place_of_worship", "theatre", "cinema", "prison", "police",
  "fire_station", "townhall", "courthouse", "post_office", "library", "community_centre", "public_bath", "swimming_pool", "nightclub",
  "social_facility", "arts_centre", "conference_centre", "bus_station", "ferry_terminal", "fuel", "marketplace", "events_venue"
]);
const LARGE_SHOPS = new Set(["supermarket", "department_store", "mall", "doityourself", "furniture", "car", "garden_centre", "wholesale", "variety_store", "hardware"]);

export function humanise(value: string): string {
  const t = value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

function accepted(base: string, value: string): boolean {
  switch (base) {
    case "railway":
      return RAILWAY_PLACES.has(value);
    case "power":
      return POWER_PLACES.has(value);
    case "landuse":
      return LANDUSE_SITES.has(value);
    case "amenity":
      return !AMENITY_FITTINGS.has(value);
    case "aeroway":
      return !AEROWAY_STRIPS.has(value);
    case "man_made":
      return MAN_MADE_STRUCTURES.has(value);
    case "leisure":
      return LEISURE_SITES.has(value);
    case "tourism":
      return TOURISM_SITES.has(value);
    default:
      return true;
  }
}

/** "school" for `amenity=school`; the key's own name for `shop=yes`. Lower case, for use inside a sentence. */
function typeWord(base: string, value: string): string {
  const v = value === "yes" || value === "true" || value === "1" ? base : value;
  return v.replace(/_/g, " ").trim().toLowerCase();
}

/** Small shop units, offices and everyday amenities fall vacant all the time; a school or a supermarket is a place. */
function sized(base: string, value: string, level: Likelihood): Likelihood {
  if (level >= 3) return level;
  if (base === "shop") return LARGE_SHOPS.has(value) ? level : 1;
  if (base === "office" || base === "craft") return 1;
  if (base === "amenity") return LARGE_AMENITIES.has(value) ? level : 1;
  return level;
}

type Signal = {
  tag: string;
  level: Likelihood;
  /** Ties between equal levels go to the lowest priority number. */
  priority: number;
  /** The plain-words description this signal gives: "Abandoned school", "Ruined castle". */
  what: string;
  kind: AbandonedKind;
};

/** The first tag that says what kind of place this is (`amenity=school`), for hints that carry no type of their own. */
function mainPlace(tags: Record<string, string>): { base: string; value: string; tag: string } | null {
  for (const base of FORMER_KEYS) {
    if (base === "historic" || base === "landuse") continue;
    const value = tags[base];
    if (!value || value === "no" || !accepted(base, value)) continue;
    return { base, value, tag: `${base}=${value}` };
  }
  return null;
}

const ucfirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A past end date: a bare year is past once that year is over; a full date once the day has gone. */
export function endDateIsPast(raw: string | undefined, now: Date): boolean {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec((raw ?? "").trim());
  if (!m) return false;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : 0;
  const day = m[3] ? Number(m[3]) : 0;
  if (year < now.getUTCFullYear()) return true;
  if (year > now.getUTCFullYear()) return false;
  if (!month) return false;
  const nowMonth = now.getUTCMonth() + 1;
  if (month < nowMonth) return true;
  if (month > nowMonth) return false;
  return day > 0 && day < now.getUTCDate();
}

const STRONG_NAME = /^(former|closed|defunct|abandoned|derelict|disused|vacant)\b|\((former|closed|defunct|abandoned|disused)\)/i;
const WEAK_NAME = /^(old|ex-)\b/i;

/**
 * Scores a set of OSM tags. Returns null when nothing about them suggests an abandoned place (an ordinary object, a
 * disused railway line, a bench), otherwise the level, what it is in plain words, and the exact tags behind the level.
 */
export function scoreCandidate(
  tags: Record<string, string>,
  now: Date = new Date()
): { level: Likelihood; kind: AbandonedKind; name: string; what: string; why: string } | null {
  const name = (tags.name ?? tags["abandoned:name"] ?? tags["disused:name"] ?? tags["was:name"] ?? tags.old_name ?? "").trim().slice(0, 80);
  const signals: Signal[] = [];
  const place = mainPlace(tags);

  // Ruins: the clearest case, with no "former" key.
  if (tags.building === "ruins") signals.push({ tag: "building=ruins", level: 3, priority: 0, what: "Ruined building", kind: "ruins" });
  if (tags.historic === "ruins") signals.push({ tag: "historic=ruins", level: 3, priority: 0, what: "Ruins", kind: "ruins" });
  if (tags.ruins && tags.ruins !== "no") {
    const what = tags.ruins === "yes" ? "Ruins" : `Ruined ${typeWord("ruins", tags.ruins)}`;
    signals.push({ tag: `ruins=${tags.ruins}`, level: 3, priority: 0, what, kind: "ruins" });
  }

  // Lifecycle prefixes on the main keys: abandoned:amenity=school, disused:shop=supermarket, was:building=industrial ...
  const PREFIXES = [
    { key: "abandoned", level: 3 as Likelihood, state: "Abandoned", priority: 1 },
    { key: "disused", level: 2 as Likelihood, state: "Disused", priority: 3 },
    { key: "was", level: 2 as Likelihood, state: "Former", priority: 4 }
  ];
  for (const p of PREFIXES) {
    for (const base of FORMER_KEYS) {
      const value = tags[`${p.key}:${base}`];
      if (!value || value === "no" || !accepted(base, value)) continue;
      signals.push({
        tag: `${p.key}:${base}=${value}`,
        level: sized(base, value, p.level),
        priority: p.priority,
        what: `${p.state} ${typeWord(base, value)}`,
        kind: kindFor(base, value)
      });
    }
  }

  // Plain flags on a place that is still tagged for what it was: abandoned=yes + building=*, disused=yes + amenity=*.
  const flags: Array<{ key: "abandoned" | "disused"; level: Likelihood; state: string; priority: number }> = [
    { key: "abandoned", level: 3, state: "Abandoned", priority: 2 },
    { key: "disused", level: 2, state: "Disused", priority: 3 }
  ];
  for (const f of flags) {
    if (tags[f.key] !== "yes" || !place) continue;
    signals.push({
      tag: `${f.key}=yes`,
      level: sized(place.base, place.value, f.level),
      priority: f.priority,
      what: `${f.state} ${typeWord(place.base, place.value)}`,
      kind: kindFor(place.base, place.value)
    });
  }

  // Weaker hints, each needing a real place tag so a road or a river called "Old ..." never counts.
  if (tags.landuse === "brownfield") signals.push({ tag: "landuse=brownfield", level: 1, priority: 7, what: "Brownfield land", kind: "industrial" });
  if (place) {
    const type = typeWord(place.base, place.value);
    const kind = kindFor(place.base, place.value);
    if (endDateIsPast(tags.end_date, now)) {
      signals.push({ tag: `end_date=${tags.end_date}`, level: 1, priority: 5, what: `Closed ${type}`, kind });
    }
    if (tags.opening_hours === "closed" || tags.opening_hours === "off") {
      signals.push({ tag: `opening_hours=${tags.opening_hours}`, level: 1, priority: 6, what: `Closed ${type}`, kind });
    }
    if (tags.name && STRONG_NAME.test(tags.name)) {
      signals.push({ tag: `name="${tags.name.slice(0, 40)}"`, level: 1, priority: 8, what: `Possibly closed ${type}`, kind });
    } else if (tags.name && WEAK_NAME.test(tags.name)) {
      signals.push({ tag: `name="${tags.name.slice(0, 40)}"`, level: 0, priority: 9, what: ucfirst(type), kind });
    }
  }
  if (!signals.length) return null;

  signals.sort((a, b) => b.level - a.level || a.priority - b.priority);
  const primary = signals[0]!;
  let level = primary.level;
  // Two different "maybe" hints agreeing (say a past end date and opening_hours=closed) make a "likely".
  if (level === 1 && signals.filter((s) => s.level === 1).length >= 2) level = 2;

  const why: string[] = [];
  for (const s of signals) if (!why.includes(s.tag)) why.push(s.tag);
  // Flags and hints say nothing of their own about what the place was: show the tag that names the type.
  if (place && !why.includes(place.tag) && signals.some((s) => /^(abandoned|disused)=yes$|^end_date=|^opening_hours=|^name=/.test(s.tag))) {
    why.push(place.tag);
  }
  return { level, kind: primary.kind, name, what: primary.what, why: why.slice(0, 6).join(", ") };
}

type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

export function parseAbandoned(elements: unknown[], now: Date = new Date()): AbandonedItem[] {
  const out: AbandonedItem[] = [];
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const el = raw as OverpassElement;
    if ((el.type !== "node" && el.type !== "way" && el.type !== "relation") || typeof el.id !== "number") continue;
    const lat = el.type === "node" ? el.lat : el.center?.lat;
    const lon = el.type === "node" ? el.lon : el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const c = scoreCandidate(el.tags ?? {}, now);
    if (!c) continue;
    out.push([`${el.type[0]}${el.id}`, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, c.kind, c.name, c.what.slice(0, 60), c.why.slice(0, 220), c.level]);
  }
  return out;
}

/** Bases whose lifecycle prefixes are asked for. Railway is limited to stations and other places, never lines. */
const PREFIX_BASES = ["amenity", "building", "shop", "man_made", "industrial", "tourism", "leisure", "office", "craft", "healthcare"];
const RAILWAY_PLACE_RE = "^(station|halt|stop|depot|roundhouse|turntable)$";

const prefixFilters = (prefix: string): string[] => [
  ...PREFIX_BASES.map((b) => `["${prefix}:${b}"]`),
  `["${prefix}:railway"~"${RAILWAY_PLACE_RE}"]`
];

/**
 * The tag filters Overpass is asked for, split in two so each tile request stays within what the public servers bear
 * (measured on a dense tile: the lifecycle keys take about 20 s per group; name and end_date searches take two minutes and
 * are not asked for, so those rules only score objects fetched for another reason).
 */
export const CORE_FILTERS = [
  '["abandoned"="yes"]',
  '["building"="ruins"]',
  '["historic"="ruins"]',
  '["ruins"]',
  ...prefixFilters("abandoned"),
  '["abandoned:aeroway"]'
];
export const LIFECYCLE_FILTERS = ['["disused"="yes"]', ...prefixFilters("disused"), ...prefixFilters("was"), '["opening_hours"~"^(closed|off)$"]'];

const body = (filters: string[]): string => filters.map((f) => `nwr${f};`).join("");

// Tiles hold already-scored items, so change these names whenever the rules above change (4: mine openings are kept).
const coreStore = createTileStore<AbandonedItem>({
  dir: "abandoned4a",
  ttlMs: 14 * 86_400_000,
  timeoutMs: 70_000,
  lane: "abandoned",
  query: (s, w, n, e) => `[out:json][timeout:65][bbox:${s},${w},${n},${e}];(${body(CORE_FILTERS)});out center tags ${MAX_ELEMENTS_PER_TILE};`,
  parse: (els) => parseAbandoned(els)
});
const lifecycleStore = createTileStore<AbandonedItem>({
  dir: "abandoned4b",
  ttlMs: 14 * 86_400_000,
  timeoutMs: 110_000,
  lane: "abandoned",
  query: (s, w, n, e) => `[out:json][timeout:100][bbox:${s},${w},${n},${e}];(${body(LIFECYCLE_FILTERS)});out center tags ${MAX_ELEMENTS_PER_TILE};`,
  parse: (els) => parseAbandoned(els)
});

export type AbandonedQueryResult = {
  places: AbandonedItem[];
  /** How many places the box holds at each level before the minimum is applied: [unlikely, maybe, likely, very likely]. */
  counts: [number, number, number, number];
  tilesTotal: number;
  tilesPending: number;
  tilesFailed: number;
  truncated: boolean;
};

/**
 * Places in the box at `minLevel` and up, each once (the higher score if both tile sets found it), most likely and
 * nearest to the centre first when there are more than `limit`. Missing tiles load in the background (ask again soon).
 */
export async function queryAbandoned(
  west: number,
  south: number,
  east: number,
  north: number,
  limit: number,
  minLevel: Likelihood = 2
): Promise<AbandonedQueryResult | "too-wide"> {
  const [a, b] = await Promise.all([
    collectTiles(coreStore, west, south, east, north, MAX_TILES_PER_QUERY),
    collectTiles(lifecycleStore, west, south, east, north, MAX_TILES_PER_QUERY)
  ]);
  if (a === "too-wide" || b === "too-wide") return "too-wide";

  const cLat = (south + north) / 2;
  let cLon = west <= east ? (west + east) / 2 : (west + east + 360) / 2;
  if (cLon > 180) cLon -= 360;
  const best = new Map<string, AbandonedItem>();
  for (const it of [...a.items, ...b.items]) {
    const [, la, lo] = it;
    if (la < south || la > north) continue;
    if (!(west <= east ? lo >= west && lo <= east : lo >= west || lo <= east)) continue;
    const had = best.get(it[0]);
    if (!had || it[7] > had[7]) best.set(it[0], it); // a way that crosses a tile edge is stored in both tiles
  }
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const it of best.values()) counts[it[7]]++;
  const shown = [...best.values()].filter((it) => it[7] >= minLevel);
  let truncated = false;
  if (shown.length > limit) {
    const d = (it: AbandonedItem): number => (it[1] - cLat) ** 2 + (it[2] - cLon) ** 2;
    shown.sort((x, y) => y[7] - x[7] || d(x) - d(y));
    shown.length = limit;
    truncated = true;
  }
  return {
    places: shown,
    counts,
    tilesTotal: a.total + b.total,
    tilesPending: a.pending + b.pending,
    tilesFailed: a.failed + b.failed,
    truncated
  };
}
