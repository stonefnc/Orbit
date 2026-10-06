import type { VesselClientRow } from "../../shared/vesselContract";
import { fetchJson, ProviderHttpError } from "./fetchUtil";
import type { BBox } from "./bbox";
import { cooldownRemainingMs, recordFailure, recordSuccess } from "./providerGate";

/**
 * Keyless regional AIS feeds that, unlike AISStream's terrestrial network, include ships out in open water.
 * Digitraffic Marine (Fintraffic, Finland) publishes every vessel its coastal + Baltic receiver network hears
 * (CC BY 4.0). It only covers the Baltic / Gulf of Finland / Bothnian waters — there is no free global
 * open-ocean AIS feed; that needs satellite AIS, which is commercial.
 */
const UA = "Orbit/1.0 (personal; +https://github.com/runna5k/Orbit)";
const DIGITRAFFIC_USER = "Orbit";
const LOCATIONS_URL = "https://meri.digitraffic.fi/api/ais/v1/locations";
const VESSELS_URL = "https://meri.digitraffic.fi/api/ais/v1/vessels";
const COVERAGE: BBox = { lamin: 53.5, lamax: 66.8, lomin: 9, lomax: 33.8 };
const POLL_MS = 60_000;
const MAX_POSITION_AGE_MS = 20 * 60_000;
const META_TTL_MS = 6 * 60 * 60_000;

type Meta = { name?: string; callSign?: string; imo?: number; shipType?: number; destination?: string; eta?: number };
type Feature = {
  mmsi?: number;
  geometry?: { coordinates?: [number, number] };
  properties?: {
    mmsi?: number;
    sog?: number;
    cog?: number;
    navStat?: number;
    heading?: number;
    timestampExternal?: number;
  };
};

function intersects(a: BBox, b: BBox): boolean {
  return a.lamin <= b.lamax && a.lamax >= b.lamin && a.lomin <= b.lomax && a.lomax >= b.lomin;
}

function clean(s: string | undefined | null): string | null {
  const t = (s ?? "").replace(/@+$/g, "").trim();
  return t || null;
}

/** AIS packs the ETA as minute(6 bits) | hour(5) | day(5) | month(4); out-of-range values mean "not available". */
export function etaMsFromPacked(eta: number | undefined, now = Date.now()): number | null {
  if (typeof eta !== "number" || !Number.isFinite(eta) || eta <= 0) return null;
  const minute = eta & 63;
  const hour = (eta >> 6) & 31;
  const day = (eta >> 11) & 31;
  const month = (eta >> 16) & 15;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return etaMsFromParts(month, day, hour, minute, now);
}

/** AIS ETAs carry no year: pick the next occurrence (allowing a day of lateness) after `now`. */
export function etaMsFromParts(month: number, day: number, hour: number, minute: number, now = Date.now()): number | null {
  const year = new Date(now).getUTCFullYear();
  let t = Date.UTC(year, month - 1, day, hour, minute);
  if (t < now - 36 * 3_600_000) t = Date.UTC(year + 1, month - 1, day, hour, minute);
  return Number.isFinite(t) ? t : null;
}

export class RegionalAisFeeds {
  private boxes: BBox[] = [];
  private wantActive = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private meta = new Map<number, Meta>();
  private metaAt = 0;

  constructor(private readonly onRows: (rows: VesselClientRow[]) => void) {}

  /** Called whenever the browser's view changes or clients come and go. */
  setView(boxes: BBox[], hasClients: boolean): void {
    this.boxes = boxes;
    this.wantActive = hasClients;
    this.reschedule();
  }

  shutdown(): void {
    this.wantActive = false;
    this.reschedule();
  }

  private wanted(): boolean {
    return this.wantActive && this.boxes.some((b) => intersects(b, COVERAGE));
  }

  private reschedule(): void {
    if (this.wanted()) {
      if (!this.timer) {
        void this.poll();
        this.timer = setInterval(() => void this.poll(), POLL_MS);
      }
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async loadMeta(): Promise<void> {
    if (Date.now() - this.metaAt < META_TTL_MS && this.meta.size > 0) return;
    try {
      const { ok, status, data } = await fetchJson<Array<Meta & { mmsi?: number }>>(VESSELS_URL, {
        timeoutMs: 45_000,
        retries: 0,
        headers: { "User-Agent": UA, "Digitraffic-User": DIGITRAFFIC_USER }
      });
      if (!ok || !Array.isArray(data)) throw new Error(`vessel details HTTP ${status}`);
      this.meta = new Map(data.filter((v) => typeof v.mmsi === "number").map((v) => [v.mmsi!, v]));
      this.metaAt = Date.now();
    } catch (e) {
      // Names are a nicety; positions are still useful without them.
      this.metaAt = Date.now() - META_TTL_MS + 10 * 60_000;
      console.warn("[ais] Digitraffic vessel details unavailable:", e instanceof Error ? e.message : e);
    }
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.wanted() || cooldownRemainingMs("digitraffic-ais") > 0) return;
    this.polling = true;
    try {
      const { ok, status, data, retryAfterSec } = await fetchJson<{ features?: Feature[] }>(LOCATIONS_URL, {
        timeoutMs: 40_000,
        retries: 0,
        headers: { "User-Agent": UA, "Digitraffic-User": DIGITRAFFIC_USER }
      });
      if (!ok) throw new ProviderHttpError("digitraffic-ais", status, retryAfterSec);
      recordSuccess("digitraffic-ais");
      await this.loadMeta();
      const now = Date.now();
      const rows: VesselClientRow[] = [];
      for (const f of data?.features ?? []) {
        const p = f.properties;
        const mmsi = p?.mmsi ?? f.mmsi;
        const lon = f.geometry?.coordinates?.[0];
        const lat = f.geometry?.coordinates?.[1];
        if (typeof mmsi !== "number" || typeof lat !== "number" || typeof lon !== "number") continue;
        if (!this.boxes.some((b) => lat >= b.lamin && lat <= b.lamax && lon >= b.lomin && lon <= b.lomax)) continue;
        const ts = p?.timestampExternal ?? 0;
        if (now - ts > MAX_POSITION_AGE_MS) continue;
        const m = this.meta.get(mmsi);
        const eta = etaMsFromPacked(m?.eta, now);
        rows.push({
          mmsi,
          lat,
          lon,
          sogKt: typeof p?.sog === "number" && p.sog < 102.3 ? p.sog : null,
          cogDeg: typeof p?.cog === "number" && p.cog < 360 ? p.cog : null,
          headingDeg: typeof p?.heading === "number" && p.heading >= 0 && p.heading < 360 ? p.heading : null,
          navStatus: typeof p?.navStat === "number" ? p.navStat : null,
          name: clean(m?.name),
          callSign: clean(m?.callSign),
          destination: clean(m?.destination),
          etaText: null,
          etaMs: eta,
          imo: m?.imo && m.imo > 0 ? m.imo : null,
          shipType: typeof m?.shipType === "number" ? m.shipType : null,
          source: "digitraffic",
          updatedAt: ts > 0 ? ts : now
        });
      }
      this.onRows(rows);
    } catch (e) {
      recordFailure("digitraffic-ais", e);
      console.warn("[ais] Digitraffic poll failed:", e instanceof Error ? e.message : e);
    } finally {
      this.polling = false;
    }
  }
}
