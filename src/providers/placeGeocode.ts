export type PlaceHit = { lat: number; lon: number; label: string };

/**
 * Looks a place name up through the local server (which caches and rate-limits the upstream geocoder).
 * Resolves to the hit, `null` when nothing matches, or `undefined` when the lookup itself failed (retry later).
 */
export async function geocodePlace(query: string): Promise<PlaceHit | null | undefined> {
  const base = (import.meta.env.VITE_PLANE_API_BASE as string | undefined)?.trim().replace(/\/$/, "") ?? "";
  try {
    const res = await fetch(`${base}/api/geocode/place?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(20_000)
    });
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    return (await res.json()) as PlaceHit;
  } catch {
    return undefined;
  }
}
