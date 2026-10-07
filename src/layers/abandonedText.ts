/**
 * Wording, colours and links for the "Abandoned places" layer. Pure functions (no DOM) so they can be unit-tested.
 * The card says what OpenStreetMap tags record and how likely they make an abandoned place; it never gives, guesses or
 * hints at how to get in.
 */
export type AbandonedKind = "building" | "civic" | "industrial" | "transport" | "leisure" | "ruins" | "mine" | "other";
/** 0 unlikely, 1 maybe, 2 likely, 3 very likely. */
export type Likelihood = 0 | 1 | 2 | 3;

/** [osm "n123" | "w123" | "r123", lat, lon, kind, name, what it is in plain words, the tags behind the level, level] */
export type AbandonedPlace = [string, number, number, AbandonedKind, string, string, string, Likelihood];

export const LEVEL_LABEL = ["Unlikely", "Maybe", "Likely", "Very likely"] as const;
/** Colder for weaker evidence, hotter for stronger. */
export const LEVEL_COLOR = ["#9aa0a6", "#7fb0e0", "#ffb02e", "#ff5a3c"] as const;
/** Pin size by level, so the likelier places stand out even when the colours are hard to tell apart. */
export const LEVEL_PIN_SCALE = [0.7, 0.8, 1, 1.12] as const;

export const ABANDONED_COVERAGE =
  "From OpenStreetMap: places mappers tagged abandoned, disused or ruined. As complete as local mapping, not a guide to entering them.";
export const LIKELIHOOD_NOTE =
  "Likelihood from OpenStreetMap tags, not a site visit. Places can be demolished, reopened or guarded; not a guide to entering them.";

/** What the "Show" setting offers, and what it asks the server for (the lowest level to include). */
export const MIN_LEVEL_CHOICES: ReadonlyArray<{ value: Likelihood; label: string }> = [
  { value: 3, label: "Very likely only" },
  { value: 2, label: "Likely and up" },
  { value: 1, label: "Maybe and up" }
];
export const DEFAULT_MIN_LEVEL: Likelihood = 2;

const OSM_KIND: Record<string, string> = { n: "node", w: "way", r: "relation" };

/** The page of this object on openstreetmap.org, or null if the id is not in the expected shape. */
export function osmUrl(osm: string): string | null {
  const m = /^([nwr])(\d{1,12})$/.exec(osm);
  return m ? `https://www.openstreetmap.org/${OSM_KIND[m[1]!]}/${m[2]}` : null;
}

/** A link out to TrespassersHQ's explore map centred on the place. Nothing is fetched from that site. */
export function trespassersUrl(lat: number, lon: number): string {
  return `https://trespassershq.com/explore/?lat=${lat.toFixed(5)}&lng=${lon.toFixed(5)}&z=17`;
}

/** The place's name, or its plain description when it has none ("Disused school", "Ruined castle"). */
export function placeTitle(p: AbandonedPlace): string {
  const [, , , , name, what] = p;
  return name || what || "Abandoned place";
}

export function placeKicker(p: AbandonedPlace): string {
  return `${LEVEL_LABEL[p[7]]} abandoned`;
}

/** The one plain line shown on the card of a mine shaft or adit. */
export const MINE_HAZARD = "Mine shaft or adit: an open hole that can be deep and unstable";

/** The card's rows: the level, what it is, the exact tags behind the level, a hazard line for mine openings, where, and the caution. */
export function placeRows(p: AbandonedPlace): Array<[string, string]> {
  const [, lat, lon, kind, , what, why, level] = p;
  const rows: Array<[string, string]> = [["Likelihood", LEVEL_LABEL[level]]];
  if (what) rows.push(["What", what]);
  if (why) rows.push(["Why", why]);
  if (kind === "mine") rows.push(["Hazard", MINE_HAZARD]);
  rows.push(["Location", `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`]);
  rows.push(["Note", "Mapped by volunteers. It may be private property, unsafe, or already gone."]);
  return rows;
}

/** The status line under the chip: how many are shown, and how many weaker ones the current setting hides. */
export function statusText(shown: number, counts: readonly number[], minLevel: Likelihood, truncated: boolean): string {
  const parts = [`${shown.toLocaleString()} ${shown === 1 ? "place" : "places"}${truncated ? " (most likely shown)" : ""}`];
  if (minLevel > 1 && (counts[1] ?? 0) > 0) parts.push(`${counts[1]!.toLocaleString()} maybe hidden`);
  if (minLevel > 2 && (counts[2] ?? 0) > 0) parts.push(`${counts[2]!.toLocaleString()} likely hidden`);
  parts.push("from OpenStreetMap");
  return parts.join(" · ");
}
