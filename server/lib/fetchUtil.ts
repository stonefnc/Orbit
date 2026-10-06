export type FetchJsonOpts = {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
};

export type FetchTextResult = {
  ok: boolean;
  status: number;
  text: string;
  retryAfterSec: number | null;
};

/** Thrown by provider fetchers on a non-2xx response so callers can back off correctly. */
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly retryAfterSec: number | null
  ) {
    super(`${provider} HTTP ${status}`);
    this.name = "ProviderHttpError";
  }
}

function parseRetryAfter(h: Headers): number | null {
  const raw = h.get("retry-after") ?? h.get("x-rate-limit-retry-after-seconds");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function fetchText(
  url: string,
  init: RequestInit & FetchJsonOpts = {}
): Promise<FetchTextResult> {
  const timeoutMs = init.timeoutMs ?? 12_000;
  const retries = init.retries ?? 2;
  const { timeoutMs: _t, retries: _r, ...rest } = init;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...rest,
        signal: controller.signal,
        headers: { Accept: "*/*", ...init.headers }
      });
      const text = await res.text();
      clearTimeout(to);
      return { ok: res.ok, status: res.status, text, retryAfterSec: parseRetryAfter(res.headers) };
    } catch (e) {
      clearTimeout(to);
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & FetchJsonOpts = {}
): Promise<{ ok: boolean; status: number; data: T | null; retryAfterSec: number | null }> {
  const { text, ok, status, retryAfterSec } = await fetchText(url, init);
  try {
    return { ok, status, data: JSON.parse(text) as T, retryAfterSec };
  } catch {
    return { ok, status, data: null, retryAfterSec };
  }
}
