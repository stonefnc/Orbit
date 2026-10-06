import { gdeltHeadlines, type NewsItem } from "./gdelt";

/**
 * Headlines for one earthquake or one wildfire card. The browser sends the USGS place text or the fire's name; the query
 * is built here from letters and digits only, so nothing a feed contains can inject GDELT query syntax.
 */
export type EventKind = "quake" | "fire";

/** Words and numbers only, collapsed, capped. */
function plain(s: string, max = 60): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** USGS place text is "12 km SW of Ridgecrest, CA" (or just "Fiji region"): keep the named place. */
export function quakePlace(place: string): string {
  const named = /\bof\s+(.+)$/i.exec(place)?.[1] ?? place;
  return plain(named.split(",")[0] ?? named);
}

/** Fire titles look like "Bear Fire, Placer, California" or "Bear Fire (CA-PNF-001234)": keep the incident name. */
export function fireName(title: string): string {
  return plain(title.split(/[,(]/)[0] ?? title);
}

export function eventNewsQuery(kind: EventKind, name: string): string | null {
  if (kind === "quake") {
    const place = quakePlace(name);
    return place.length >= 3 ? `earthquake "${place}" sourcelang:eng` : null;
  }
  const fire = fireName(name);
  // A bare "Fire" or "Complex" would match everything.
  return fire.length >= 4 && /\s/.test(fire) ? `"${fire}" (wildfire OR fire OR evacuations) sourcelang:eng` : null;
}

export async function getEventNews(kind: EventKind, name: string): Promise<{ items: NewsItem[]; stale: boolean }> {
  const query = eventNewsQuery(kind, name);
  if (!query) return { items: [], stale: false };
  return gdeltHeadlines(`${kind}:${query}`, query, kind === "quake" ? "48h" : "7d");
}
