import { fetchJson } from "./fetchUtil";

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

let cache: { token: string; expiresAtMs: number } | null = null;

export async function getOpenSkyBearer(
  clientId: string,
  clientSecret: string
): Promise<string | undefined> {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id || !secret) return undefined;

  const now = Date.now();
  if (cache && now < cache.expiresAtMs) return cache.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret
  });

  const { ok, data } = await fetchJson<{
    access_token?: string;
    expires_in?: number;
  }>(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    timeoutMs: 15_000,
    retries: 2
  });

  if (!ok || !data?.access_token) {
    console.warn("[opensky-auth] Token request failed or empty access_token");
    return undefined;
  }

  const skewSec = 120;
  const ttl = Math.max(60, (data.expires_in ?? 1800) - skewSec);
  cache = { token: data.access_token, expiresAtMs: Date.now() + ttl * 1000 };
  return cache.token;
}
