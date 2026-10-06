/** JSON contract between `server/` plane aggregator and the browser client. */

export type PlanePositionSource = "opensky" | "adsb_lol" | "adsb_fi" | "airplanes_live" | "adsbx";

export const PLANE_POSITION_SOURCES: readonly PlanePositionSource[] = [
  "opensky",
  "adsb_lol",
  "adsb_fi",
  "airplanes_live",
  "adsbx"
];

export type ProviderHealth =
  | "ok"
  | "error"
  | "skipped_no_credentials"
  | "skipped_cooldown"
  | "skipped_fallback"
  | "timeout"
  | "rate_limited"
  | "forbidden";

export type NormalizedAircraft = {
  icao24: string;
  callsign: string | null;
  registration: string | null;
  aircraftType: string | null;
  /** Free-text type / model line when available (e.g. Airplanes.live `desc`). */
  description: string | null;
  latitude: number;
  longitude: number;
  altitudeFt: number | null;
  speedKt: number | null;
  headingDeg: number | null;
  verticalRateFpm: number | null;
  onGround: boolean;
  originAirport: string | null;
  destinationAirport: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  /** ISO 8601 — best-effort position freshness. */
  lastSeen: string;
  positionSource: PlanePositionSource;
  /** ICAO emitter category when known (e.g. A3). */
  category: string | null;
  /** Extra providers that contributed non-position fields (metadata merge). */
  enrichedFrom: PlanePositionSource[];
};

export type AggregatedAircraftResponse = {
  fetchedAt: string;
  /** True when every provider failed and this is the last good snapshot being re-served. */
  stale?: boolean;
  providerStatus: Record<string, ProviderHealth>;
  /** How many aircraft use each source for the winning position fix. */
  countsByPositionSource: Record<PlanePositionSource, number>;
  aircraft: NormalizedAircraft[];
};

export type AircraftPhotoResponse = {
  thumbUrl: string | null;
  attribution: string | null;
  /** Page the photo lives on (photographer credit link), when the source provides one. */
  pageUrl?: string | null;
  source: "planespotters" | "wikimedia_commons" | "none";
};

export type FlightRouteAirport = {
  icao: string | null;
  iata: string | null;
  name: string | null;
  municipality: string | null;
  country: string | null;
  lat: number;
  lon: number;
};

/** Published origin/destination for a flight callsign (community data; may be missing or out of date). */
export type FlightRouteResponse = {
  callsign: string;
  airline: { name: string; icao: string | null; iata: string | null } | null;
  origin: FlightRouteAirport | null;
  destination: FlightRouteAirport | null;
};

export type AircraftModelGalleryItem = {
  thumbUrl: string;
  pageUrl: string;
  title: string;
};

/** Thumbnails of the same ICAO type (or description-only) from Wikimedia Commons. */
export type AircraftModelGalleryResponse = {
  items: AircraftModelGalleryItem[];
  source: "wikimedia_commons" | "none";
};
