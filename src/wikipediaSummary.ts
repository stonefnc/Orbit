/** Parsed `wikipedia` tag from Nominatim, e.g. `en:Statue of Liberty`. */
export type WikipediaTag = { lang: string; title: string };

export function parseWikipediaTag(raw: string | undefined): WikipediaTag | null {
  if (!raw || typeof raw !== "string") return null;
  const idx = raw.indexOf(":");
  if (idx <= 0 || idx >= raw.length - 1) return null;
  const lang = raw.slice(0, idx).trim().toLowerCase();
  const title = raw.slice(idx + 1).trim();
  if (!/^[a-z]{2,10}$/.test(lang) || !title) return null;
  return { lang, title };
}

export type WikipediaSummary = {
  title: string;
  extract: string;
  pageUrl: string;
};

const MAX_EXTRACT_CHARS = 520;

/**
 * [MediaWiki REST summary](https://www.mediawiki.org/wiki/API:REST_API/Reference#Get_page_summary)
 * — short lead paragraph only (no HTML body fetch).
 */
export async function fetchWikipediaPageSummary(tag: WikipediaTag): Promise<WikipediaSummary | null> {
  const host = `${tag.lang}.wikipedia.org`;
  const path = `/api/rest_v1/page/summary/${encodeURIComponent(tag.title.replace(/ /g, "_"))}`;
  const res = await fetch(`https://${host}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title : tag.title;
  let extract = typeof data.extract === "string" ? data.extract.trim() : "";
  if (extract.length > MAX_EXTRACT_CHARS) extract = `${extract.slice(0, MAX_EXTRACT_CHARS - 1)}…`;
  const contentUrls = data.content_urls as Record<string, unknown> | undefined;
  const desktop = contentUrls?.desktop as Record<string, unknown> | undefined;
  const page =
    typeof desktop?.page === "string"
      ? desktop.page
      : `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  if (!extract) return null;
  return { title, extract, pageUrl: page };
}
