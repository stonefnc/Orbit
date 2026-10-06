/** Origins of pages on this computer. Used by CORS and by the AIS websocket gate. */
export const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * True for a private-network IPv4 literal (10/8, 172.16/12, 192.168/16). Only literals count: a host *name* can be
 * re-pointed at this computer by DNS rebinding, an IP address cannot.
 */
export function isPrivateIpv4(host: string): boolean {
  const m = IPV4.exec(host);
  if (!m) return false;
  const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Which browser pages may open the AIS websocket.
 *
 * - No Origin header (curl, scripts, not a browser): allowed, as before.
 * - A page on this computer (localhost, 127.0.0.1, [::1]): allowed, as before.
 * - A page opened on this computer's Wi-Fi address in LAN mode (`npm run dev:lan`, e.g. a phone at
 *   http://192.168.1.20:5173): allowed only when the page's origin is a private IPv4 address AND equals the host the
 *   page was loaded from. `pageHost` is `X-Forwarded-Host` (what Vite's proxy saw, since it rewrites `Host`) or `Host`.
 *   That is a same-origin check, so another website, another device's page, a public address or a DNS name still fails.
 */
export function aisOriginAllowed(origin: string | undefined, pageHost: string | undefined): boolean {
  if (!origin) return true;
  if (LOCAL_ORIGIN.test(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!isPrivateIpv4(url.hostname)) return false;
  return !!pageHost && url.host.toLowerCase() === pageHost.trim().toLowerCase();
}
