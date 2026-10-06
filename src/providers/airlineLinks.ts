/**
 * Finds an airline's Wikipedia article and official website from its name, using Wikipedia's and Wikidata's public
 * CORS-enabled APIs (no key). Results are cached for the session, including misses.
 */
export type AirlineLinks = { wikipediaUrl: string; websiteUrl: string | null };

const cache = new Map<string, Promise<AirlineLinks | null>>();

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function safeHttpUrl(u: string | undefined): string | null {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : null;
  } catch {
    return null;
  }
}

async function lookup(name: string): Promise<AirlineLinks | null> {
  const search = await getJson<{ query?: { search?: Array<{ title: string }> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=${encodeURIComponent(
      `${name} airline`
    )}`
  );
  const title = search?.query?.search?.[0]?.title;
  if (!title) return null;
  const wikipediaUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

  // Official website: Wikidata property P856 on the article's item.
  let websiteUrl: string | null = null;
  const props = await getJson<{ query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&format=json&origin=*&titles=${encodeURIComponent(
      title
    )}`
  );
  const qid = Object.values(props?.query?.pages ?? {})[0]?.pageprops?.wikibase_item;
  if (qid && /^Q\d+$/.test(qid)) {
    const claims = await getJson<{
      claims?: { P856?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> };
    }>(`https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&origin=*&entity=${qid}&property=P856`);
    websiteUrl = safeHttpUrl(claims?.claims?.P856?.[0]?.mainsnak?.datavalue?.value);
  }
  return { wikipediaUrl, websiteUrl };
}

export function airlineLinksFor(name: string): Promise<AirlineLinks | null> {
  const key = name.trim().toLowerCase();
  let hit = cache.get(key);
  if (!hit) {
    hit = lookup(name.trim());
    cache.set(key, hit);
  }
  return hit;
}
