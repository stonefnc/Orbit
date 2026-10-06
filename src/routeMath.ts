const EARTH_RADIUS_NM = 3440.065;

/** Great-circle distance in nautical miles. */
export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing, degrees clockwise from true north. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLon = (lon2 - lon1) * r;
  const y = Math.sin(dLon) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLon);
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
}

/** Smallest angle between two compass directions, 0..180. */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

/** 72 -> "1 h 12 min", 45 -> "45 min", 3000 -> "2 d 2 h". */
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 1) return "under a minute";
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${String(min).padStart(2, "0")} min`;
  return `${min} min`;
}

/** Arrival clock time for "minutes from now", in the viewer's local time plus UTC. */
export function arrivalClock(minutesFromNow: number): string {
  const at = new Date(Date.now() + minutesFromNow * 60_000);
  const local = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const utc = `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")} UTC`;
  return `${local} your time · ${utc}`;
}

export type RouteProgress = {
  /** Straight-line distance still to go, NM. */
  remainingNm: number;
  /** Whole origin→destination distance, NM (null when the origin is unknown). */
  totalNm: number | null;
  /** 0..1 share already covered, when the origin is known. */
  fraction: number | null;
  /** Minutes to arrival at the current speed, when the speed is usable. */
  etaMinutes: number | null;
};

/**
 * Straight-line progress and ETA. This is an estimate: it assumes a direct great-circle path at the current
 * ground speed, so real routing, wind, delays and slow-downs will differ.
 */
export function routeProgress(
  cur: { lat: number; lon: number },
  speedKt: number | null | undefined,
  arr: { lat: number; lon: number },
  dep?: { lat: number; lon: number } | null,
  minUsableSpeedKt = 3
): RouteProgress {
  const remainingNm = haversineNm(cur.lat, cur.lon, arr.lat, arr.lon);
  const totalNm = dep ? haversineNm(dep.lat, dep.lon, arr.lat, arr.lon) : null;
  const fraction = totalNm && totalNm > 1 ? Math.min(1, Math.max(0, 1 - remainingNm / totalNm)) : null;
  const etaMinutes =
    typeof speedKt === "number" && speedKt >= minUsableSpeedKt ? (remainingNm / speedKt) * 60 : null;
  return { remainingNm, totalNm, fraction, etaMinutes };
}
