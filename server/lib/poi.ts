/**
 * "Stores and places near here": businesses, shops and amenities by name or kind ("walmart", "pharmacy", "gas
 * station"), ranked toward a point. Uses Photon (komoot's OpenStreetMap geocoder, which accepts a location bias), falling
 * back to a bounded Nominatim search around the point. Keyless; cached for 10 minutes. Data © OpenStreetMap contributors.
 */
export type Poi = {
  name: string;
  address: string;
  kind: string;
  lat: number;
  lon: number;
  osm: string | null;
  distanceKm: number | null;
};

const UA = { "User-Agent": "Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)" };

/** Everyday words -> OSM tags, so "pharmacy" finds pharmacies and not places that merely have the word in their name. */
const KINDS: Array<[RegExp, string, string]> = [
  [/^(gas( station)?|fuel|petrol)$/i, "amenity", "fuel"],
  [/^(pharmacy|drugstore|chemist)$/i, "amenity", "pharmacy"],
  [/^(grocery|groceries|supermarket|grocery store)$/i, "shop", "supermarket"],
  [/^(coffee( shop)?|cafe|café)$/i, "amenity", "cafe"],
  [/^(restaurant|restaurants|food)$/i, "amenity", "restaurant"],
  [/^(fast food)$/i, "amenity", "fast_food"],
  [/^(bar|pub)$/i, "amenity", "bar"],
  [/^(atm|cash machine)$/i, "amenity", "atm"],
  [/^(bank)$/i, "amenity", "bank"],
  [/^(hospital)$/i, "amenity", "hospital"],
  [/^(urgent care|clinic)$/i, "amenity", "clinic"],
  [/^(hotel|motel)$/i, "tourism", "hotel"],
  [/^(ev charging|charging station|ev charger)$/i, "amenity", "charging_station"],
  [/^(hardware|hardware store)$/i, "shop", "doityourself"],
  [/^(convenience|convenience store)$/i, "shop", "convenience"],
  [/^(bakery)$/i, "shop", "bakery"],
  [/^(bookstore|books)$/i, "shop", "books"],
  [/^(electronics)$/i, "shop", "electronics"],
  [/^(clothing|clothes)$/i, "shop", "clothes"],
  [/^(mall|shopping mall)$/i, "shop", "mall"],
  [/^(parking|car park)$/i, "amenity", "parking"],
  [/^(library)$/i, "amenity", "library"],
  [/^(post office)$/i, "amenity", "post_office"],
  [/^(gym|fitness)$/i, "leisure", "fitness_centre"],
  [/^(park)$/i, "leisure", "park"],
  [/^(school)$/i, "amenity", "school"]
];

const cache = new Map<string, { at: number; pois: Poi[] }>();

const km = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const dLat = (bLat - aLat) * 111.32;
  const dLon = (bLon - aLon) * 111.32 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    postcode?: string;
    osm_key?: string;
    osm_value?: string;
    osm_id?: number;
    osm_type?: string;
  };
};

function label(kind: string | undefined, key: string | undefined): string {
  const v = (kind ?? "").replace(/_/g, " ");
  return v ? `${v}${key && key !== "amenity" && key !== "shop" ? ` (${key})` : ""}` : "place";
}

async function photon(q: string, lat: number, lon: number, tag: [string, string] | null): Promise<Poi[]> {
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&limit=12&lang=en` +
    (tag ? `&osm_tag=${tag[0]}:${tag[1]}` : "");
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const j = (await res.json()) as { features?: PhotonFeature[] };
  const out: Poi[] = [];
  for (const f of j.features ?? []) {
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c || !p.name) continue;
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    out.push({
      name: p.name,
      address: [street, p.city, p.state].filter(Boolean).join(", "),
      kind: label(p.osm_value, p.osm_key),
      lat: c[1],
      lon: c[0],
      osm: p.osm_type && p.osm_id ? `${p.osm_type === "N" ? "node" : p.osm_type === "W" ? "way" : "relation"}/${p.osm_id}` : null,
      distanceKm: Math.round(km(lat, lon, c[1], c[0]) * 10) / 10
    });
  }
  return out;
}

async function nominatimNear(q: string, lat: number, lon: number): Promise<Poi[]> {
  const d = 0.35;
  const url =
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=10&bounded=1` +
    `&viewbox=${lon - d},${lat + d},${lon + d},${lat - d}`;
  const res = await fetch(url, { headers: { ...UA, Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string; name?: string; type?: string; category?: string; osm_type?: string; osm_id?: number }>;
  return rows
    .map((r): Poi | null => {
      const la = Number(r.lat);
      const lo = Number(r.lon);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
      const parts = (r.display_name ?? "").split(",").map((s) => s.trim());
      return {
        name: r.name || parts[0] || q,
        address: parts.slice(1, 4).join(", "),
        kind: label(r.type, r.category),
        lat: la,
        lon: lo,
        osm: r.osm_type && r.osm_id ? `${r.osm_type}/${r.osm_id}` : null,
        distanceKm: Math.round(km(lat, lon, la, lo) * 10) / 10
      };
    })
    .filter((p): p is Poi => p !== null);
}

export async function searchPois(query: string, lat: number, lon: number): Promise<Poi[]> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 80);
  if (q.length < 3 || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const key = `${q.toLowerCase()}|${lat.toFixed(1)}|${lon.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.pois;

  const kind = KINDS.find(([re]) => re.test(q));
  let pois: Poi[];
  try {
    pois = await photon(q, lat, lon, kind ? [kind[1], kind[2]] : null);
  } catch {
    pois = await nominatimNear(q, lat, lon).catch(() => []);
  }
  // Nearest first, and only things that are actually nearby (a store name also matches towns and far-off branches).
  pois = pois.filter((p) => (p.distanceKm ?? 0) <= 400).sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0)).slice(0, 8);
  cache.set(key, { at: Date.now(), pois });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return pois;
}
