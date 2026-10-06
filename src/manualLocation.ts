/**
 * A location the user sets by hand, for devices that cannot share one. iOS Safari only allows geolocation on a secure
 * origin (https or localhost), and the phone opens Orbit over plain `http://<pc-ip>:5173` in `dev:lan`, so "my location"
 * never works there. The manual point is kept on this device (localStorage), used wherever "my location" is used, and
 * always labelled as manual. Nothing here is sent anywhere.
 */
export type ManualLoc = { lat: number; lon: number; label: string; at: number };

export const MANUAL_LOCATION_KEY = "orbit-manual-location";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Why the browser cannot give a device position at all, or null when it may ask. */
export function geolocationBlockedReason(
  ctx: { secure: boolean; hasApi: boolean } = {
    secure: typeof window !== "undefined" && window.isSecureContext,
    hasApi: typeof navigator !== "undefined" && "geolocation" in navigator
  }
): "insecure" | "unsupported" | null {
  if (!ctx.secure) return "insecure";
  if (!ctx.hasApi) return "unsupported";
  return null;
}

export const INSECURE_LOCATION_MESSAGE =
  "Your phone only shares location over a secure connection (https), and this page was opened over plain http. Set your location by hand below instead; it stays on this device.";

const validLat = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= -90 && n <= 90;
const validLon = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= -180 && n <= 180;

/** Reads a stored value back, refusing anything that is not a sane point. */
export function parseManualLocation(raw: string | null): ManualLoc | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ManualLoc>;
    if (!validLat(v.lat) || !validLon(v.lon)) return null;
    return { lat: v.lat, lon: v.lon, label: typeof v.label === "string" ? v.label.slice(0, 120) : "", at: Number(v.at) || 0 };
  } catch {
    return null;
  }
}

export function getManualLocation(store: Store | null = defaultStore()): ManualLoc | null {
  try {
    return parseManualLocation(store?.getItem(MANUAL_LOCATION_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Saves a point (rounded to about 1 m). Returns it, or null when the numbers are out of range. */
export function setManualLocation(lat: number, lon: number, label = "", store: Store | null = defaultStore(), now = Date.now()): ManualLoc | null {
  if (!validLat(lat) || !validLon(lon)) return null;
  const loc: ManualLoc = { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, label: label.trim().slice(0, 120), at: now };
  try {
    store?.setItem(MANUAL_LOCATION_KEY, JSON.stringify(loc));
  } catch {
    /* storage unavailable: the point still works until the page is closed */
  }
  return loc;
}

export function clearManualLocation(store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(MANUAL_LOCATION_KEY);
  } catch {
    /* ignore */
  }
}

/** "lat, lon" typed by hand (also "lat lon"), or null. */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return validLat(lat) && validLon(lon) ? { lat, lon } : null;
}
