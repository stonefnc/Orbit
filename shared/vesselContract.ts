/** Normalized vessel row pushed from the plane API AIS WebSocket bridge. */
export type VesselClientRow = {
  mmsi: number;
  lat: number;
  lon: number;
  sogKt: number | null;
  cogDeg: number | null;
  headingDeg: number | null;
  navStatus: number | null;
  name: string | null;
  callSign: string | null;
  destination: string | null;
  etaText: string | null;
  imo: number | null;
  shipType: number | null;
  /** Reported arrival time (epoch ms) decoded from the AIS ETA field, when the crew filled it in. */
  etaMs?: number | null;
  /** Which feed supplied the position: "aisstream" or a keyless regional feed such as "digitraffic". */
  source?: string;
  updatedAt: number;
};

/**
 * `full: true` (or omitted) replaces the client's whole vessel set; `full: false` is a delta:
 * `vessels` are upserts and `removed` lists MMSIs to drop.
 */
export type VesselSnapshotMessage = {
  type: "vessels";
  fetchedAt: string;
  count: number;
  vessels: VesselClientRow[];
  full?: boolean;
  removed?: number[];
};

export type VesselServerErrorMessage = {
  type: "error";
  message: string;
};

export type AisUpstreamState = "idle" | "connecting" | "open" | "backoff" | "auth_failed" | "no_key";

/** Lets the UI explain *why* the vessel layer is empty instead of showing nothing. */
export type VesselStatusMessage = {
  type: "status";
  upstream: AisUpstreamState;
  detail: string | null;
  vessels: number;
  /** Live vessel count per feed, e.g. { aisstream: 80, digitraffic: 700 }. */
  bySource?: Record<string, number>;
  /** Seconds since the last AIS message arrived upstream (null = none yet). */
  lastMessageAgeSec: number | null;
};
