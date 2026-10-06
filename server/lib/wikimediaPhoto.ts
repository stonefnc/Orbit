import { fetchText } from "./fetchUtil";

/**
 * Wikimedia Commons API — permitted for programmatic access with a descriptive User-Agent.
 * https://commons.wikimedia.org/wiki/Commons:API
 */

export type CommonsHit = {
  thumbUrl: string;
  attribution: string;
  pageUrl: string;
  title: string;
  score: number;
};

function compactAlnum(s: string): string {
  return s.replace(/[\s_-]/g, "").toUpperCase();
}

/** Prefer exterior/airframe shots; penalize diagrams, maps, interiors. */
export function scoreCommonsTitleForAircraft(title: string, registration: string, typeCode: string): number {
  const tl = title.toLowerCase();
  let score = 0;
  const reg = registration.trim();
  if (reg.length >= 3) {
    const rc = compactAlnum(reg);
    const tc = compactAlnum(title);
    if (rc.length >= 4 && tc.includes(rc)) score += 120;
    else if (tl.includes(reg.replace(/\s/g, "").toLowerCase())) score += 70;
  }
  const ty = typeCode.replace(/\s+/g, "").toUpperCase();
  if (ty.length >= 2) {
    if (tl.includes(ty.toLowerCase())) score += 65;
    const prefix = ty.slice(0, 3);
    if (prefix.length === 3 && tl.includes(prefix.toLowerCase())) score += 25;
  }
  if (/\b(airport|diagram|chart|route map|satellite|orthophoto|aerial view of airport)\b/i.test(tl)) {
    score -= 120;
  }
  if (/\b(logo|livery diagram|silhouette|outline|vector)\b/i.test(tl)) score -= 50;
  if (/\b(cabin|interior|cockpit|seat|galley|meal)\b/i.test(tl)) score -= 45;
  if (/\b(incident|crash|accident|fire|wreck)\b/i.test(tl)) score -= 80;
  if (/\b(aircraft|airplane|airliner|jet|plane|aviation)\b/i.test(tl)) score += 8;
  return score;
}

function parseHitsFromQueryResponse(data: unknown): Array<{ title: string; thumbUrl: string; pageUrl: string }> {
  const pages =
    data &&
    typeof data === "object" &&
    "query" in data &&
    (data as { query?: { pages?: Record<string, unknown> } }).query?.pages;
  if (!pages || typeof pages !== "object") return [];

  const out: Array<{ title: string; thumbUrl: string; pageUrl: string }> = [];
  for (const p of Object.values(pages)) {
    if (!p || typeof p !== "object") continue;
    const page = p as { title?: string; imageinfo?: Array<{ thumburl?: string; url?: string }> };
    const ii = page.imageinfo?.[0];
    const thumb = ii?.thumburl ?? ii?.url;
    if (typeof thumb !== "string" || !thumb.startsWith("http")) continue;
    const title = typeof page.title === "string" ? page.title : "";
    if (!title) continue;
    const pageUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    out.push({ title, thumbUrl: thumb, pageUrl });
  }
  return out;
}

async function commonsSearchRaw(
  gsrsearch: string,
  userAgent: string,
  gsrlimit: string,
  iiurlwidth = "480"
): Promise<unknown | null> {
  const ua = userAgent.trim() || "OrbitPlanePhoto/1.0 (local dev; not for production)";
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch,
    gsrnamespace: "6",
    gsrlimit,
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth
  });
  const url = `https://commons.wikimedia.org/w/api.php?${params.toString()}`;
  const { ok, text } = await fetchText(url, {
    timeoutMs: 12_000,
    retries: 1,
    headers: { "User-Agent": ua, Accept: "application/json" }
  });
  if (!ok) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function pickBestHits(
  raw: unknown,
  registration: string,
  aircraftType: string
): CommonsHit | null {
  const hits = parseHitsFromQueryResponse(raw);
  if (hits.length === 0) return null;
  let best: CommonsHit | null = null;
  for (const h of hits) {
    const score = scoreCommonsTitleForAircraft(h.title, registration, aircraftType);
    const row: CommonsHit = {
      thumbUrl: h.thumbUrl,
      title: h.title,
      pageUrl: h.pageUrl,
      score,
      attribution: `Wikimedia Commons · ${h.title}`
    };
    if (!best || row.score > best.score) best = row;
  }
  return best;
}

/**
 * Legacy single-query helper (first hit only — prefer `commonsAircraftPhoto` for type-aware scoring).
 */
export async function commonsThumbnailForQuery(
  searchQuery: string,
  userAgent: string
): Promise<{ thumbUrl: string; attribution: string; pageUrl: string } | null> {
  const data = await commonsSearchRaw(searchQuery, userAgent, "8");
  const best = pickBestHits(data, "", "");
  if (!best) return null;
  return { thumbUrl: best.thumbUrl, attribution: best.attribution, pageUrl: best.pageUrl };
}

/**
 * Searches Commons with registration / ICAO type context, scores candidates, and may fall back to a second query.
 */
export async function commonsAircraftPhoto(
  registration: string,
  aircraftType: string,
  description: string | undefined,
  userAgent: string
): Promise<{ thumbUrl: string; attribution: string; pageUrl: string } | null> {
  const reg = registration.trim();
  const typ = aircraftType.trim();
  const desc = (description ?? "").trim();

  const queries: string[] = [];
  if (reg && typ) queries.push(`${reg} ${typ} aircraft`);
  else if (reg) queries.push(`${reg} aircraft`);
  if (typ && /^[A-Z0-9]{2,6}$/i.test(typ.replace(/\s/g, ""))) {
    queries.push(`${typ.replace(/\s+/g, "")} airliner aircraft`);
  }
  if (reg && !queries.some((q) => q.startsWith(reg))) queries.push(`${reg} aircraft`);
  if (!reg && desc.length >= 8 && desc.length < 120) {
    const short = desc.replace(/\s+/g, " ").slice(0, 72);
    queries.push(`${short} aircraft`);
  }

  const seen = new Set<string>();
  let globalBest: CommonsHit | null = null;

  for (const q of queries) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const data = await commonsSearchRaw(q, userAgent, "12");
    const hit = pickBestHits(data, reg, typ);
    if (!hit) continue;
    if (!globalBest || hit.score > globalBest.score) globalBest = hit;
    if (globalBest && globalBest.score >= 85) break;
  }

  if (!globalBest) return null;
  return {
    thumbUrl: globalBest.thumbUrl,
    attribution: globalBest.attribution,
    pageUrl: globalBest.pageUrl
  };
}

/**
 * Several Commons searches merged, scored for type (not tail-specific), deduped by file title.
 * Thumbnails use a smaller `iiurlwidth` to keep the strip light.
 */
export async function commonsAircraftModelGallery(
  aircraftType: string,
  description: string | undefined,
  userAgent: string,
  maxItems: number
): Promise<Array<{ thumbUrl: string; pageUrl: string; title: string }>> {
  const typ = aircraftType.trim();
  const desc = (description ?? "").trim();
  const max = Math.min(12, Math.max(1, Math.floor(maxItems)));

  const queries: string[] = [];
  if (typ.length >= 2) {
    queries.push(`${typ} aircraft`);
    queries.push(`${typ} airliner`);
    if (typ.length <= 6 && /^[A-Z0-9]+$/i.test(typ.replace(/\s/g, ""))) {
      queries.push(`${typ.replace(/\s+/g, "")} airplane`);
    }
    if (desc.length >= 6) {
      queries.push(`${typ} ${desc.replace(/\s+/g, " ").slice(0, 48)}`);
    }
  } else if (desc.length >= 8) {
    queries.push(`${desc.replace(/\s+/g, " ").slice(0, 72)} aircraft`);
  } else {
    return [];
  }

  const typeForScore = typ.length >= 2 ? typ : desc.slice(0, 40);
  const pool: CommonsHit[] = [];
  const seenTitle = new Set<string>();

  for (const q of queries) {
    if (pool.length >= max * 6) break;
    const data = await commonsSearchRaw(q, userAgent, "18", "220");
    const hits = parseHitsFromQueryResponse(data);
    for (const h of hits) {
      if (seenTitle.has(h.title)) continue;
      seenTitle.add(h.title);
      const score = scoreCommonsTitleForAircraft(h.title, "", typeForScore);
      pool.push({
        thumbUrl: h.thumbUrl,
        title: h.title,
        pageUrl: h.pageUrl,
        score,
        attribution: `Wikimedia Commons · ${h.title}`
      });
    }
  }

  pool.sort((a, b) => b.score - a.score);
  return pool.slice(0, max).map(({ thumbUrl, pageUrl, title }) => ({ thumbUrl, pageUrl, title }));
}
