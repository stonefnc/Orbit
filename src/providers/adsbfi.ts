export type AdsbAircraft = {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  squawk?: string;
  category?: string;
};

export function sanitizeCallsign(flight: string | null | undefined): string | undefined {
  if (flight == null) return undefined;
  const t = flight.trim();
  return t.length ? t : undefined;
}
