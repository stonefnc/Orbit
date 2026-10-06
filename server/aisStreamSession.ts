import WebSocket from "ws";
import { boundingBoxesFromCenterNm, boxContainsBox, type BBox } from "./lib/bbox";
import { etaMsFromParts, RegionalAisFeeds } from "./lib/regionalAis";
import type {
  AisUpstreamState,
  VesselClientRow,
  VesselSnapshotMessage,
  VesselStatusMessage
} from "../shared/vesselContract";

const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const STALE_MS = 6 * 60 * 1000;
const MAX_VESSELS = 6000;
const TICK_MS = 1000;
const SUB_THROTTLE_MS = 1100;
/** Close the upstream socket (and stop spending quota) once nobody is watching. */
const IDLE_CLOSE_MS = 60_000;
/** Open but completely silent this long → assume a stalled socket and reconnect. */
const SILENCE_RECONNECT_MS = 5 * 60_000;
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000, 60_000];
const AUTH_RETRY_MS = 5 * 60_000;
const CLIENT_PING_MS = 30_000;

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return undefined;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function sanitizeAisText(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/@+$/g, "").trim() || null;
}

function etaTextFromShipStatic(eta: unknown): string | null {
  if (!eta || typeof eta !== "object") return null;
  const e = eta as Record<string, unknown>;
  const m = num(e.Month);
  const d = num(e.Day);
  const h = num(e.Hour);
  const min = num(e.Minute);
  if (m === 0 && d === 0 && h === 0 && min === 0) return null;
  const parts = [
    m != null && m > 0 ? `M${m}` : null,
    d != null && d > 0 ? `D${d}` : null,
    h != null ? `${String(h).padStart(2, "0")}:${String(min ?? 0).padStart(2, "0")} UTC` : null
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

type Rec = VesselClientRow & { hasPos: boolean; rev: number };

function etaMsFromShipStatic(eta: unknown): number | null {
  if (!eta || typeof eta !== "object") return null;
  const e = eta as Record<string, unknown>;
  const m = num(e.Month);
  const d = num(e.Day);
  const h = num(e.Hour);
  const min = num(e.Minute);
  if (m == null || d == null || h == null || min == null) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59) return null;
  return etaMsFromParts(m, d, h, min);
}

type ClientState = { sentRev: number; needFull: boolean; alive: boolean };

type Sub = { lat: number; lon: number; distNm: number };

function messageBody(message: Record<string, unknown> | undefined, messageType: string): Record<string, unknown> | null {
  if (!message) return null;
  const inner = message[messageType];
  if (!inner || typeof inner !== "object") return null;
  return inner as Record<string, unknown>;
}

export class AisStreamSession {
  private upstream: WebSocket | null = null;
  private upstreamState: AisUpstreamState;
  private stateDetail: string | null = null;
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly vessels = new Map<number, Rec>();
  private tombstones: Array<{ mmsi: number; rev: number }> = [];
  private rev = 0;

  private want: Sub | null = null;
  private sentBoxes: BBox[] = [];
  private subTimer: ReturnType<typeof setTimeout> | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private authBlockedUntil = 0;
  private lastMessageAt: number | null = null;
  private openedAt = 0;
  private lastStatusKey = "";
  private emptySince: number | null = null;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  /** Keyless regional feeds (open-water coverage in the Baltic) that work with or without an AISStream key. */
  private readonly regional = new RegionalAisFeeds((rows) => this.ingestRegional(rows));

  constructor(private readonly apiKey: string) {
    this.upstreamState = apiKey.trim() ? "idle" : "no_key";
    // Timers run even without an AISStream key: the regional feeds still need the broadcast loop.
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.pingTimer = setInterval(() => this.pingClients(), CLIENT_PING_MS);
  }

  statusSnapshot(): VesselStatusMessage {
    const bySource: Record<string, number> = {};
    for (const v of this.vessels.values()) {
      if (v.hasPos) bySource[v.source ?? "aisstream"] = (bySource[v.source ?? "aisstream"] ?? 0) + 1;
    }
    return {
      type: "status",
      upstream: this.upstreamState,
      detail: this.stateDetail,
      vessels: this.countLive(),
      bySource,
      lastMessageAgeSec: this.lastMessageAt == null ? null : Math.round((Date.now() - this.lastMessageAt) / 1000)
    };
  }

  private viewBoxes(): BBox[] {
    return this.want ? boundingBoxesFromCenterNm(this.want.lat, this.want.lon, this.want.distNm) : [];
  }

  /** Rows from a keyless regional feed; a fresher AISStream fix for the same ship always wins. */
  private ingestRegional(rows: VesselClientRow[]): void {
    for (const row of rows) {
      const rec = this.vessels.get(row.mmsi);
      if (rec && rec.source === "aisstream" && rec.updatedAt >= row.updatedAt - 5_000) continue;
      const next: Rec = { ...row, hasPos: true, rev: ++this.rev };
      this.vessels.set(row.mmsi, next);
    }
  }

  shutdown(): void {
    this.regional.shutdown();
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.subTimer) clearTimeout(this.subTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.tickTimer = this.pingTimer = this.subTimer = this.reconnectTimer = null;
    this.closeUpstream();
    for (const c of this.clients.keys()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  addClient(ws: WebSocket): void {
    this.clients.set(ws, { sentRev: 0, needFull: true, alive: true });
    this.emptySince = null;
    ws.on("pong", () => {
      const c = this.clients.get(ws);
      if (c) c.alive = true;
    });
    ws.on("close", () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) {
        this.emptySince = Date.now();
        this.regional.setView(this.viewBoxes(), false);
      }
    });
    ws.on("error", () => {
      this.clients.delete(ws);
    });
    this.send(ws, this.statusSnapshot());
    this.regional.setView(this.viewBoxes(), true);
    this.ensureUpstream();
  }

  /** Called whenever the browser's view changes. Cheap when the new view is already covered. */
  requestSubscription(lat: number, lon: number, distNm: number): void {
    this.want = { lat, lon, distNm };
    const boxes = boundingBoxesFromCenterNm(lat, lon, distNm);
    this.regional.setView(boxes, this.clients.size > 0);
    this.dropVesselsOutside(boxes);
    if (!this.apiKey.trim()) return;
    this.ensureUpstream();
    if (this.upstreamState !== "open") return; // `open` handler sends `want` immediately
    if (boxes.length === 0) return;
    if (boxes.every((b) => this.sentBoxes.some((s) => boxContainsBox(s, b)))) return;
    if (this.subTimer) return;
    this.subTimer = setTimeout(() => {
      this.subTimer = null;
      this.sendSubscription();
    }, SUB_THROTTLE_MS);
  }

  private setState(state: AisUpstreamState, detail: string | null = null): void {
    this.upstreamState = state;
    this.stateDetail = detail;
    this.broadcastStatus();
  }

  private broadcastStatus(force = false): void {
    const s = this.statusSnapshot();
    const key = `${s.upstream}|${s.detail}|${s.vessels}`;
    if (!force && key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    const raw = JSON.stringify(s);
    for (const c of this.clients.keys()) this.sendRaw(c, raw);
  }

  private send(ws: WebSocket, payload: unknown): void {
    this.sendRaw(ws, JSON.stringify(payload));
  }

  private sendRaw(ws: WebSocket, raw: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(raw);
    } catch {
      /* ignore */
    }
  }

  private pingClients(): void {
    for (const [ws, st] of this.clients) {
      if (!st.alive) {
        this.clients.delete(ws);
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        continue;
      }
      st.alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
    if (this.clients.size === 0 && this.emptySince == null) this.emptySince = Date.now();
  }

  private countLive(): number {
    let n = 0;
    for (const v of this.vessels.values()) if (v.hasPos) n++;
    return n;
  }

  private tick(): void {
    this.tickCount++;
    const now = Date.now();

    if (this.clients.size === 0) {
      if (this.upstream && this.emptySince != null && now - this.emptySince > IDLE_CLOSE_MS) {
        console.info("[ais] no clients — closing upstream to save quota");
        this.closeUpstream();
        this.setState("idle");
      }
    } else {
      this.broadcastDeltas();
    }

    if (this.tickCount % 30 === 0) {
      this.pruneStale();
      this.broadcastStatus(true);
    }

    if (
      this.upstream &&
      this.upstreamState === "open" &&
      now - Math.max(this.openedAt, this.lastMessageAt ?? 0) > SILENCE_RECONNECT_MS
    ) {
      console.warn("[ais] upstream silent for 5 min — reconnecting");
      this.closeUpstream();
      this.scheduleReconnect("upstream silent");
    }
  }

  private broadcastDeltas(): void {
    const now = Date.now();
    for (const [ws, st] of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      let msg: VesselSnapshotMessage | null = null;
      if (st.needFull) {
        const vessels: VesselClientRow[] = [];
        for (const v of this.vessels.values()) {
          if (!v.hasPos || now - v.updatedAt > STALE_MS) continue;
          vessels.push(this.toRow(v));
        }
        msg = { type: "vessels", fetchedAt: new Date().toISOString(), count: vessels.length, vessels, full: true };
        st.needFull = false;
      } else {
        const upserts: VesselClientRow[] = [];
        for (const v of this.vessels.values()) {
          if (v.rev > st.sentRev && v.hasPos) upserts.push(this.toRow(v));
        }
        const removed: number[] = [];
        for (const t of this.tombstones) if (t.rev > st.sentRev) removed.push(t.mmsi);
        if (upserts.length > 0 || removed.length > 0) {
          msg = {
            type: "vessels",
            fetchedAt: new Date().toISOString(),
            count: this.countLive(),
            vessels: upserts,
            full: false,
            removed
          };
        }
      }
      st.sentRev = this.rev;
      if (msg) this.send(ws, msg);
    }
  }

  private toRow(v: Rec): VesselClientRow {
    const { hasPos: _h, rev: _r, ...row } = v;
    return row;
  }

  private pruneStale(): void {
    const now = Date.now();
    const drop = (mmsi: number): void => {
      this.vessels.delete(mmsi);
      this.tombstones.push({ mmsi, rev: ++this.rev });
    };
    for (const [k, v] of this.vessels) {
      if (now - v.updatedAt > STALE_MS) drop(k);
    }
    if (this.vessels.size > MAX_VESSELS) {
      const oldest = [...this.vessels.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      const extra = this.vessels.size - MAX_VESSELS + 200;
      for (let i = 0; i < extra && i < oldest.length; i++) drop(oldest[i]![0]);
    }
    const keepAfter = this.rev - 5000;
    if (this.tombstones.length > 5000) this.tombstones = this.tombstones.filter((t) => t.rev > keepAfter);
  }

  /** After the view moves, vessels from the old area would otherwise linger for the whole stale window. */
  private dropVesselsOutside(boxes: BBox[]): void {
    for (const [mmsi, v] of this.vessels) {
      if (!v.hasPos) continue;
      const inside = boxes.some((b) => v.lat >= b.lamin && v.lat <= b.lamax && v.lon >= b.lomin && v.lon <= b.lomax);
      if (!inside) {
        this.vessels.delete(mmsi);
        this.tombstones.push({ mmsi, rev: ++this.rev });
      }
    }
  }

  private ensureUpstream(): void {
    if (!this.apiKey.trim() || !this.want || this.clients.size === 0) return;
    if (this.upstream) return;
    if (this.reconnectTimer) return;
    const now = Date.now();
    if (now < this.authBlockedUntil) return;

    // AISStream drops sockets that don't send a subscription within seconds of connecting,
    // so the socket is only opened once a subscription is ready to be sent from `open`.
    this.setState("connecting");
    const ws = new WebSocket(AISSTREAM_URL);
    this.upstream = ws;

    ws.on("open", () => {
      if (this.upstream !== ws) return;
      this.openedAt = Date.now();
      this.attempt = 0;
      console.info("[ais] upstream connected");
      this.setState("open");
      this.sendSubscription();
    });
    ws.on("message", (buf) => {
      if (this.upstream !== ws) return;
      this.onUpstreamMessage(typeof buf === "string" ? buf : buf.toString("utf8"));
    });
    ws.on("close", (code) => {
      if (this.upstream !== ws) return;
      this.upstream = null;
      this.sentBoxes = [];
      console.warn(`[ais] upstream closed (code ${code})`);
      if (this.upstreamState === "auth_failed") return;
      this.scheduleReconnect(`closed (${code})`);
    });
    ws.on("error", (e) => {
      console.warn("[ais] upstream error:", e instanceof Error ? e.message : e);
    });
  }

  private scheduleReconnect(reason: string): void {
    if (this.clients.size === 0 || !this.want) {
      this.setState("idle");
      return;
    }
    if (this.reconnectTimer) return;
    const wait = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt += 1;
    this.setState("backoff", `${reason}; retrying in ${Math.round(wait / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureUpstream();
    }, wait);
  }

  private closeUpstream(): void {
    const ws = this.upstream;
    this.upstream = null;
    this.sentBoxes = [];
    if (!ws) return;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  private sendSubscription(): void {
    const ws = this.upstream;
    const want = this.want;
    if (!ws || ws.readyState !== WebSocket.OPEN || !want) return;
    const boxes = boundingBoxesFromCenterNm(want.lat, want.lon, want.distNm);
    if (boxes.length === 0) return;
    const payload = {
      APIKey: this.apiKey,
      BoundingBoxes: boxes.map((b) => [
        [b.lamax, b.lomin],
        [b.lamin, b.lomax]
      ]),
      FilterMessageTypes: [
        "PositionReport",
        "ShipStaticData",
        "StandardClassBPositionReport",
        "ExtendedClassBPositionReport"
      ]
    };
    try {
      ws.send(JSON.stringify(payload));
      this.sentBoxes = boxes;
      this.dropVesselsOutside(boxes);
      console.info(
        `[ais] subscription ~${want.distNm.toFixed(0)} NM @ ${want.lat.toFixed(3)}, ${want.lon.toFixed(3)} (${boxes.length} box${boxes.length > 1 ? "es" : ""})`
      );
    } catch (e) {
      console.warn("[ais] subscription send failed:", e);
    }
  }

  private onUpstreamMessage(txt: string): void {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(txt) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof o.error === "string") {
      console.warn("[ais] upstream error payload:", o.error);
      if (/api ?key|unauthor|invalid|forbidden/i.test(o.error)) {
        this.authBlockedUntil = Date.now() + AUTH_RETRY_MS;
        this.setState("auth_failed", o.error);
      } else {
        this.setState(this.upstreamState, o.error);
      }
      return;
    }
    const mt = str(o.MessageType);
    if (!mt) return;
    this.lastMessageAt = Date.now();
    const meta = o.MetaData as Record<string, unknown> | undefined;
    const message = o.Message as Record<string, unknown> | undefined;
    const body = messageBody(message, mt);
    const mmsi = num(meta?.MMSI) ?? num(body?.UserID);
    if (mmsi == null || mmsi <= 0) return;

    let rec = this.vessels.get(mmsi);
    if (!rec) {
      rec = {
        mmsi,
        lat: 0,
        lon: 0,
        sogKt: null,
        cogDeg: null,
        headingDeg: null,
        navStatus: null,
        name: null,
        callSign: null,
        destination: null,
        etaText: null,
        etaMs: null,
        imo: null,
        shipType: null,
        source: "aisstream",
        updatedAt: Date.now(),
        hasPos: false,
        rev: 0
      };
      this.vessels.set(mmsi, rec);
    }

    switch (mt) {
      case "PositionReport":
      case "StandardClassBPositionReport":
      case "ExtendedClassBPositionReport":
        this.mergePosition(rec, body, meta);
        if (mt === "ExtendedClassBPositionReport" && body) {
          const nm = str(body.Name);
          if (nm) rec.name = sanitizeAisText(nm) ?? rec.name;
        }
        break;
      case "ShipStaticData":
        this.mergeStatic(rec, body);
        break;
      default:
        return;
    }
    rec.rev = ++this.rev;
  }

  private mergePosition(into: Rec, body: Record<string, unknown> | null, meta: Record<string, unknown> | undefined): void {
    if (!body) return;
    const lat = num(body.Latitude) ?? num(meta?.latitude) ?? num(meta?.Latitude);
    const lon = num(body.Longitude) ?? num(meta?.longitude) ?? num(meta?.Longitude);
    if (lat == null || lon == null) return;
    // AIS uses 91 / 181 as "not available"; (0,0) is the classic uninitialised-GPS value.
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
    // Messages from the previous area can still arrive for a moment after the view moves.
    if (
      this.sentBoxes.length > 0 &&
      !this.sentBoxes.some((b) => lat >= b.lamin && lat <= b.lamax && lon >= b.lomin && lon <= b.lomax)
    ) {
      return;
    }
    into.lat = lat;
    into.lon = lon;
    into.hasPos = true;
    const sog = num(body.Sog);
    into.sogKt = sog != null && sog < 102.3 ? sog : null;
    const cog = num(body.Cog);
    into.cogDeg = cog != null && cog < 360 ? cog : null;
    const th = num(body.TrueHeading);
    into.headingDeg = th != null && th >= 0 && th < 360 ? th : null;
    into.navStatus = num(body.NavigationalStatus) ?? null;
    const shipName = str(meta?.ShipName);
    if (shipName) into.name = sanitizeAisText(shipName) ?? into.name;
    into.updatedAt = Date.now();
  }

  private mergeStatic(into: Rec, body: Record<string, unknown> | null): void {
    if (!body) return;
    const name = str(body.Name);
    if (name) into.name = sanitizeAisText(name) ?? into.name;
    const cs = str(body.CallSign);
    if (cs) into.callSign = sanitizeAisText(cs) ?? into.callSign;
    const dest = str(body.Destination);
    if (dest) into.destination = sanitizeAisText(dest) ?? into.destination;
    const eta = etaTextFromShipStatic(body.Eta);
    if (eta) into.etaText = eta;
    const etaMs = etaMsFromShipStatic(body.Eta);
    if (etaMs != null) into.etaMs = etaMs;
    const imo = num(body.ImoNumber);
    if (imo != null && imo > 0) into.imo = imo;
    const typ = num(body.Type);
    if (typ != null) into.shipType = typ;
    into.updatedAt = Date.now();
  }
}
