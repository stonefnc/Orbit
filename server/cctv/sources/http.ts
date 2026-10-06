import { fetchJson, ProviderHttpError } from "../../lib/fetchUtil";

export const CCTV_UA = "Orbit/1.0 (personal; +https://github.com/runna5k/Orbit)";

export async function getJson<T>(provider: string, url: string, timeoutMs = 30_000): Promise<T> {
  const { ok, status, data, retryAfterSec } = await fetchJson<T>(url, {
    timeoutMs,
    retries: 1,
    headers: { Accept: "application/json", "User-Agent": CCTV_UA }
  });
  if (!ok) throw new ProviderHttpError(provider, status, retryAfterSec);
  if (data == null) throw new Error(`${provider}: response was not JSON`);
  return data;
}

/** Run `fn` over `items` with at most `limit` in flight; failed items are skipped, not fatal. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      try {
        out.push(await fn(items[i]!));
      } catch (e) {
        console.warn("[cctv] item failed:", e instanceof Error ? e.message : e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
