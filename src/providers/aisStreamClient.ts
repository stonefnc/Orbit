import type {
  VesselClientRow,
  VesselServerErrorMessage,
  VesselSnapshotMessage,
  VesselStatusMessage
} from "../../shared/vesselContract";

/** Fold a newer message into one that has not been delivered yet, so rAF coalescing never drops delta rows. */
function mergePending(prev: VesselSnapshotMessage | null, next: VesselSnapshotMessage): VesselSnapshotMessage {
  if (!prev || next.full !== false) return next;
  const byMmsi = new Map<number, VesselClientRow>();
  for (const v of prev.vessels) byMmsi.set(v.mmsi, v);
  for (const v of next.vessels) byMmsi.set(v.mmsi, v);
  const removed = new Set<number>(prev.removed ?? []);
  for (const m of next.removed ?? []) {
    removed.add(m);
    byMmsi.delete(m);
  }
  for (const v of next.vessels) removed.delete(v.mmsi);
  return {
    ...next,
    full: prev.full,
    vessels: [...byMmsi.values()],
    removed: [...removed]
  };
}

function wsUrlFromLocation(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ais/stream`;
}

export async function postAisSubscription(lat: number, lon: number, distNm: number): Promise<boolean> {
  try {
    const res = await fetch("/api/ais/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon, distNm })
    });
    if (!res.ok) {
      let detail = String(res.status);
      try {
        const j = (await res.json()) as { error?: unknown };
        if (typeof j.error === "string") detail = `${res.status}: ${j.error}`;
      } catch {
        /* ignore */
      }
      console.warn("[vessels] POST /api/ais/subscription failed:", detail);
    }
    return res.ok;
  } catch (e) {
    console.warn("[vessels] POST /api/ais/subscription error:", e);
    return false;
  }
}

export type AisStreamClient = {
  connect: () => void;
  disconnect: () => void;
};

export function createAisStreamClient(handlers: {
  onSnapshot: (msg: VesselSnapshotMessage) => void;
  onError?: (message: string) => void;
  onStatus?: (status: VesselStatusMessage) => void;
  /** false when the socket is closed or refused (it retries every 3.5 s), true once it opens. */
  onLink?: (up: boolean) => void;
}): AisStreamClient {
  let ws: WebSocket | null = null;
  let wantOpen = false;
  let snapshotRaf = 0;
  let pendingSnapshot: VesselSnapshotMessage | null = null;

  const flushSnapshot = (): void => {
    snapshotRaf = 0;
    const snap = pendingSnapshot;
    pendingSnapshot = null;
    if (snap) handlers.onSnapshot(snap);
  };

  const connect = (): void => {
    wantOpen = true;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
      ws = new WebSocket(wsUrlFromLocation());
    } catch {
      handlers.onError?.("WebSocket create failed");
      return;
    }
    ws.onopen = () => {
      // The snapshot and a status message are pushed by the server on connect.
      handlers.onLink?.(true);
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as unknown;
        if (!data || typeof data !== "object") return;
        const o = data as Record<string, unknown>;
        if (o.type === "vessels") {
          pendingSnapshot = mergePending(pendingSnapshot, o as unknown as VesselSnapshotMessage);
          if (!snapshotRaf) {
            snapshotRaf = requestAnimationFrame(flushSnapshot);
          }
          return;
        }
        if (o.type === "status") {
          handlers.onStatus?.(o as unknown as VesselStatusMessage);
          return;
        }
        if (o.type === "error" && typeof (o as VesselServerErrorMessage).message === "string") {
          handlers.onError?.((o as VesselServerErrorMessage).message);
        }
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      handlers.onError?.("AIS WebSocket error");
    };
    ws.onclose = () => {
      ws = null;
      if (wantOpen) {
        handlers.onLink?.(false);
        window.setTimeout(() => {
          if (wantOpen) connect();
        }, 3500);
      }
    };
  };

  const disconnect = (): void => {
    wantOpen = false;
    if (snapshotRaf) {
      cancelAnimationFrame(snapshotRaf);
      snapshotRaf = 0;
    }
    pendingSnapshot = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  };

  return { connect, disconnect };
}
