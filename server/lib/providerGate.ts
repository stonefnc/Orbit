import type { ProviderHealth } from "../../shared/planeContract";
import { ProviderHttpError } from "./fetchUtil";

type State = { failures: number; cooldownUntil: number; lastError: string | null; lastOkAt: number | null };

const MAX_COOLDOWN_MS = 15 * 60_000;
const states = new Map<string, State>();

function st(name: string): State {
  let s = states.get(name);
  if (!s) {
    s = { failures: 0, cooldownUntil: 0, lastError: null, lastOkAt: null };
    states.set(name, s);
  }
  return s;
}

/** Milliseconds left before this provider may be called again (0 = ready). */
export function cooldownRemainingMs(name: string): number {
  return Math.max(0, st(name).cooldownUntil - Date.now());
}

export function recordSuccess(name: string): void {
  const s = st(name);
  s.failures = 0;
  s.cooldownUntil = 0;
  s.lastError = null;
  s.lastOkAt = Date.now();
}

export function healthForError(e: unknown): ProviderHealth {
  if (e instanceof ProviderHttpError) {
    if (e.status === 429) return "rate_limited";
    if (e.status === 401 || e.status === 403) return "forbidden";
    return "error";
  }
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return "timeout";
  return "error";
}

/** Records a failure and starts an exponential (or Retry-After based) cooldown. */
export function recordFailure(name: string, e: unknown): ProviderHealth {
  const s = st(name);
  s.failures += 1;
  s.lastError = e instanceof Error ? e.message : String(e);
  let waitMs: number;
  if (e instanceof ProviderHttpError && e.status === 429) {
    waitMs = Math.max(30_000, (e.retryAfterSec ?? 60) * 1000);
  } else if (e instanceof ProviderHttpError && (e.status === 401 || e.status === 403)) {
    waitMs = 5 * 60_000;
  } else {
    waitMs = Math.min(5_000 * 2 ** (s.failures - 1), 120_000);
  }
  s.cooldownUntil = Date.now() + Math.min(waitMs, MAX_COOLDOWN_MS);
  return healthForError(e);
}

export function providerSnapshot(): Record<string, { failures: number; cooldownMs: number; lastError: string | null; lastOkAt: number | null }> {
  const out: Record<string, { failures: number; cooldownMs: number; lastError: string | null; lastOkAt: number | null }> = {};
  for (const [k, v] of states) {
    out[k] = {
      failures: v.failures,
      cooldownMs: Math.max(0, v.cooldownUntil - Date.now()),
      lastError: v.lastError,
      lastOkAt: v.lastOkAt
    };
  }
  return out;
}
