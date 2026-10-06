import type { PlanePositionSource } from "../../shared/planeContract";
import { fetchJson, ProviderHttpError } from "./fetchUtil";
import { getOpenSkyBearer } from "./openskyAuth";

export type RawPlaneLayer = {
  hex: string;
  lat: number;
  lon: number;
  lastSeenSec: number;
  source: PlanePositionSource;
  callsign: string | null;
  registration: string | null;
  aircraftType: string | null;
  description: string | null;
  altitudeFt: number | null;
  speedKt: number | null;
  headingDeg: number | null;
  verticalRateFpm: number | null;
  onGround: boolean;
  category: string | null;
  originAirport: string | null;
  destinationAirport: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
};

function sanitizeHex(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return h;
}

function callsignClean(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length ? t.replace(/\s+/g, " ") : null;
}

type StateRow = readonly (string | number | boolean | null | undefined)[];

export async function fetchOpenSkyStatesLayer(
  box: { lamin: number; lamax: number; lomin: number; lomax: number },
  clientId: string,
  clientSecret: string
): Promise<RawPlaneLayer[]> {
  const q = new URLSearchParams({
    lamin: box.lamin.toFixed(5),
    lamax: box.lamax.toFixed(5),
    lomin: box.lomin.toFixed(5),
    lomax: box.lomax.toFixed(5)
  });
  const url = `https://opensky-network.org/api/states/all?${q.toString()}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const bearer = await getOpenSkyBearer(clientId, clientSecret);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const { ok, status, data, retryAfterSec } = await fetchJson<{ states?: unknown }>(url, {
    headers,
    timeoutMs: 15_000,
    retries: 0
  });

  if (!ok) throw new ProviderHttpError("opensky", status, retryAfterSec);
  // OpenSky returns `"states": null` when no aircraft are in the box — that is success, not failure.
  if (!data || !Array.isArray(data.states)) return [];

  const nowSec = Date.now() / 1000;
  const out: RawPlaneLayer[] = [];

  for (const row of data.states) {
    if (!Array.isArray(row)) continue;
    const r = row as StateRow;
    const hexRaw = r[0];
    if (typeof hexRaw !== "string") continue;
    const hex = sanitizeHex(hexRaw);
    if (!hex) continue;

    const lon = r[5];
    const lat = r[6];
    if (typeof lon !== "number" || typeof lat !== "number") continue;

    const onGround = r[8] === true;
    const baroM = r[7];
    let altitudeFt: number | null = null;
    if (onGround) altitudeFt = 0;
    else if (typeof baroM === "number") altitudeFt = baroM * 3.28084;

    let speedKt: number | null = null;
    const velMs = r[9];
    if (typeof velMs === "number") speedKt = velMs * 1.94384;

    let headingDeg: number | null = null;
    const tt = r[10];
    if (typeof tt === "number") headingDeg = tt;

    let verticalRateFpm: number | null = null;
    const vr = r[11];
    if (typeof vr === "number") verticalRateFpm = vr * 196.85;

    const timePos = r[3];
    const lastContact = r[4];
    let lastSeenSec = nowSec;
    if (typeof timePos === "number") lastSeenSec = timePos;
    else if (typeof lastContact === "number") lastSeenSec = lastContact;

    out.push({
      hex,
      lat,
      lon,
      lastSeenSec,
      source: "opensky",
      callsign: callsignClean(r[1]),
      registration: null,
      aircraftType: null,
      description: typeof r[2] === "string" ? r[2] : null,
      altitudeFt,
      speedKt,
      headingDeg,
      verticalRateFpm,
      onGround,
      category: null,
      originAirport: null,
      destinationAirport: null,
      departureTime: null,
      arrivalTime: null
    });
  }

  return out;
}
