/**
 * GDELT DOC API headlines, shared by Conflict watch and the quake / fire cards. GDELT asks for about one request every
 * 5 s, so every caller goes through one queue (one request per 6 s, answers cached 10 min, last good list on failure).
 */
const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit)" };

export type NewsItem = { title: string; url: string; domain: string; seen: string };

const CACHE_MS = 10 * 60_000;
/** GDELT answers {} (no articles) when it is overloaded as well as when nothing matches, so an empty list is kept briefly. */
const EMPTY_CACHE_MS = 2 * 60_000;
const SLOT_MS = 6_000;
/** A request that would have to wait longer than this for its turn is skipped (the caller shows what it has). */
const MAX_WAIT_MS = 30_000;
const MAX_CACHED = 200;

const cache = new Map<string, { at: number; ttl: number; items: NewsItem[] }>();
let nextSlot = 0;

/** Recent headlines for a GDELT query (`timespan` like "48h" or "7d"), cached by `key`. Never throws. */
export async function gdeltHeadlines(key: string, query: string, timespan = "48h"): Promise<{ items: NewsItem[]; stale: boolean }> {
  const ck = `${key}|${timespan}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < hit.ttl) return { items: hit.items, stale: false };
  if (nextSlot - Date.now() > MAX_WAIT_MS) return { items: hit?.items ?? [], stale: true };
  const wait = Math.max(0, nextSlot - Date.now());
  nextSlot = Date.now() + wait + SLOT_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=40&format=json&timespan=${timespan}&sort=DateDesc`;
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
    const j = JSON.parse(await res.text()) as { articles?: Array<{ title?: string; url?: string; domain?: string; seendate?: string }> };
    const seen = new Set<string>();
    const items: NewsItem[] = [];
    for (const a of j.articles ?? []) {
      const title = (a.title ?? "").trim();
      const dedupe = title.toLowerCase().slice(0, 60);
      if (!title || !a.url || seen.has(dedupe)) continue;
      try {
        const u = new URL(a.url);
        if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      } catch {
        continue;
      }
      seen.add(dedupe);
      // GDELT dates look like 20260930T154500Z
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(a.seendate ?? "");
      items.push({
        title: title.slice(0, 200),
        url: a.url,
        domain: a.domain ?? "",
        seen: m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : ""
      });
      if (items.length >= 20) break;
    }
    cache.set(ck, { at: Date.now(), ttl: items.length ? CACHE_MS : EMPTY_CACHE_MS, items });
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    return { items, stale: false };
  } catch {
    // Rate-limited or down: keep showing the last good list, however old.
    return { items: hit?.items ?? [], stale: true };
  }
}
