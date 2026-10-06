import type { PlanePositionSource } from "../../shared/planeContract";
import { fetchText, ProviderHttpError } from "./fetchUtil";
import type { RawPlaneLayer } from "./openskyStates";

/** ADS-B Exchange v2 lat/lon/dist (requires `api-auth` API key). */
export async function fetchAdsbxPoint(
  lat: number,
  lon: number,
  distNm: number,
  apiKey: string
): Promise<RawPlaneLayer[]> {
  const key = apiKey.trim();
  if (!key) return [];

  const d = Math.min(250, Math.max(25, Math.round(distNm)));
  const url = `https://gateway.adsbexchange.com/api/aircraft/v2/lat/${lat}/lon/${lon}/dist/${d}`;
  const { ok, status, text, retryAfterSec } = await fetchText(url, {
    timeoutMs: 15_000,
    retries: 0,
    headers: {
      Accept: "application/json",
      "api-auth": key
    }
  });

  if (!ok) throw new ProviderHttpError("adsbx", status, retryAfterSec);

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return [];
  }

  const ac =
    json && typeof json === "object" && "ac" in json && Array.isArray((json as { ac: unknown }).ac)
      ? (json as { ac: unknown[] }).ac
      : Array.isArray(json)
        ? (json as unknown[])
        : [];

  const nowSec = Date.now() / 1000;
  const out: RawPlaneLayer[] = [];

  for (const row of ac) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const hexRaw = o.hex ?? o.icao;
    if (typeof hexRaw !== "string") continue;
    const hex = hexRaw.trim().toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{6}$/.test(hex)) continue;

    const latN = o.lat;
    const lonN = o.lon;
    if (typeof latN !== "number" || typeof lonN !== "number") continue;

    const seenPos = typeof o.seen_pos === "number" ? o.seen_pos : typeof o.seen === "number" ? o.seen : 0;
    const lastSeenSec = Math.max(0, nowSec - seenPos);

    const altRaw = o.alt_baro;
    let altitudeFt: number | null = null;
    let onGround = false;
    if (altRaw === "ground") {
      onGround = true;
      altitudeFt = 0;
    } else if (typeof altRaw === "number") altitudeFt = altRaw;

    const gs = typeof o.gs === "number" ? o.gs : null;
    const track = typeof o.track === "number" ? o.track : null;
    const baroRate = typeof o.baro_rate === "number" ? o.baro_rate : null;

    const flight = typeof o.flight === "string" ? o.flight.trim() : null;
    const reg = typeof o.r === "string" ? o.r.trim() : null;
    const t = typeof o.t === "string" ? o.t.trim() : null;
    const desc = typeof o.desc === "string" ? o.desc.trim() : null;
    const cat = typeof o.category === "string" ? o.category.trim() : null;

    out.push({
      hex,
      lat: latN,
      lon: lonN,
      lastSeenSec,
      source: "adsbx" as PlanePositionSource,
      callsign: flight?.length ? flight : null,
      registration: reg?.length ? reg : null,
      aircraftType: t?.length ? t : null,
      description: desc?.length ? desc : null,
      altitudeFt,
      speedKt: gs,
      headingDeg: track,
      verticalRateFpm: baroRate,
      onGround,
      category: cat?.length ? cat : null,
      originAirport: null,
      destinationAirport: null,
      departureTime: null,
      arrivalTime: null
    });
  }

  return out;
}
