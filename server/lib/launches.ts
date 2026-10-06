/**
 * Rocket launches from The Space Devs' Launch Library 2 (keyless, 15 requests/hour): upcoming launches plus the last
 * 30 days. Cached for an hour (and served stale on errors) so the rate limit is never an issue.
 */
export type LaunchStream = {
  url: string;
  /** "YouTube", "X", "NASA+", "Twitch" ... or the site's host name. */
  platform: string;
  /** YouTube video id when the stream can be embedded in the page. */
  youtubeId: string | null;
  title: string;
  publisher: string;
  official: boolean;
  /** ISO time the broadcast starts (or started), when known. */
  start: string | null;
};

export type Launch = {
  id: string;
  name: string;
  net: string;
  windowEnd: string | null;
  status: string;
  statusAbbrev: string;
  provider: string;
  rocket: string;
  mission: string | null;
  missionType: string | null;
  missionText: string | null;
  orbit: string | null;
  orbitAbbrev: string | null;
  padName: string;
  padLat: number;
  padLon: number;
  location: string;
  country: string;
  image: string | null;
  webcast: boolean;
  probability: number | null;
  wiki: string | null;
  info: string | null;
  /** Livestreams and replays collected by Launch Library, best first (official before unofficial). */
  streams: LaunchStream[];
};

const BASE = "https://ll.thespacedevs.com/2.2.0/launch";
const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)" };
const TTL_MS = 60 * 60_000;

let cache: { at: number; launches: Launch[] } | null = null;
let inflight: Promise<Launch[]> | null = null;

type Raw = {
  id: string;
  name: string;
  net: string;
  window_end?: string | null;
  status?: { name?: string; abbrev?: string };
  launch_service_provider?: { name?: string };
  rocket?: { configuration?: { name?: string } };
  mission?: {
    name?: string;
    type?: string;
    description?: string;
    orbit?: { name?: string; abbrev?: string };
    info_urls?: Array<{ url?: string }>;
  } | null;
  pad?: {
    name?: string;
    latitude?: string;
    longitude?: string;
    wiki_url?: string | null;
    info_url?: string | null;
    location?: { name?: string; country_code?: string };
  };
  image?: string | null;
  webcast_live?: boolean;
  probability?: number | null;
  vidURLs?: Array<{
    priority?: number;
    title?: string;
    url?: string;
    type?: { name?: string };
    start_time?: string | null;
    publisher?: string | null;
  }>;
};

/** The YouTube video id in any of the usual link shapes (watch, youtu.be, live, embed, shorts). */
export function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = /^\/(?:live|embed|shorts|v)\/([\w-]{11})/.exec(u.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function platformOf(u: URL): string {
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return "YouTube";
  if (host === "x.com" || host === "twitter.com") return "X";
  if (host === "plus.nasa.gov" || host.endsWith("nasa.gov")) return "NASA";
  if (host.endsWith("twitch.tv")) return "Twitch";
  if (host.endsWith("vimeo.com")) return "Vimeo";
  if (host.endsWith("facebook.com")) return "Facebook";
  return host;
}

export function streamsOf(r: Raw): LaunchStream[] {
  const out: Array<LaunchStream & { rank: number }> = [];
  const seen = new Set<string>();
  for (const v of r.vidURLs ?? []) {
    const href = httpUrl(v.url);
    if (!href) continue;
    const u = new URL(href);
    const key = youtubeId(u) ?? href;
    if (seen.has(key)) continue;
    seen.add(key);
    const official = /official/i.test(v.type?.name ?? "") && !/unofficial/i.test(v.type?.name ?? "");
    out.push({
      url: href,
      platform: platformOf(u),
      youtubeId: youtubeId(u),
      title: (v.title ?? "").slice(0, 120),
      publisher: (v.publisher ?? "").slice(0, 60),
      official,
      start: v.start_time ?? null,
      // Official first, then whatever order Launch Library ranks them in (lower number = preferred).
      rank: (official ? 0 : 1000) + (v.priority ?? 500)
    });
  }
  return out.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...s }) => s);
}

function httpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : null;
  } catch {
    return null;
  }
}

function convert(r: Raw): Launch | null {
  const lat = Number(r.pad?.latitude);
  const lon = Number(r.pad?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: r.id,
    name: r.name,
    net: r.net,
    windowEnd: r.window_end ?? null,
    status: r.status?.name ?? "Unknown",
    statusAbbrev: r.status?.abbrev ?? "",
    provider: r.launch_service_provider?.name ?? "",
    rocket: r.rocket?.configuration?.name ?? "",
    mission: r.mission?.name ?? null,
    missionType: r.mission?.type ?? null,
    missionText: r.mission?.description ? r.mission.description.slice(0, 420) : null,
    orbit: r.mission?.orbit?.name ?? null,
    orbitAbbrev: r.mission?.orbit?.abbrev ?? null,
    padName: r.pad?.name ?? "",
    padLat: lat,
    padLon: lon,
    location: r.pad?.location?.name ?? "",
    country: r.pad?.location?.country_code ?? "",
    image: httpUrl(r.image),
    webcast: !!r.webcast_live,
    probability: r.probability ?? null,
    wiki: httpUrl(r.pad?.wiki_url),
    info: httpUrl(r.mission?.info_urls?.[0]?.url) ?? httpUrl(r.pad?.info_url),
    streams: streamsOf(r)
  };
}

async function get(url: string): Promise<Raw[]> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`Launch Library HTTP ${res.status}`);
  return ((await res.json()) as { results?: Raw[] }).results ?? [];
}

async function load(): Promise<Launch[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [upcoming, previous] = await Promise.all([
    // "detailed" mode is what carries the livestream links (vidURLs).
    get(`${BASE}/upcoming/?limit=40&ordering=net&mode=detailed`),
    get(`${BASE}/previous/?limit=40&ordering=-net&mode=detailed&net__gte=${encodeURIComponent(since)}`)
  ]);
  const seen = new Set<string>();
  const out: Launch[] = [];
  for (const r of [...upcoming, ...previous]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const l = convert(r);
    if (l) out.push(l);
  }
  return out.sort((a, b) => Date.parse(a.net) - Date.parse(b.net));
}

export function getLaunches(): Promise<Launch[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.launches);
  inflight ??= load()
    .then((launches) => {
      cache = { at: Date.now(), launches };
      return launches;
    })
    .catch((e) => {
      if (cache) return cache.launches;
      throw e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

