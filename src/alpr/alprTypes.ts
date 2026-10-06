/** Normalized ALPR site (globe layer; independent of aircraft pipeline). */

export type AlprConfidence = "low" | "medium" | "high" | "unknown";

export type AlprSite = {
  id: string;
  latitude: number;
  longitude: number;
  name?: string;
  source: string;
  vendor?: string;
  region?: string;
  confidence?: AlprConfidence;
  bearingDeg?: number | null;
  fovDeg?: number | null;
  rangeMeters?: number | null;
  notes?: string;
  extra?: Record<string, unknown>;
};

export type AlprDataset = {
  sites: AlprSite[];
  attribution: string;
  licenseNote?: string;
};

export interface AlprDataAdapter {
  readonly kind: string;
  load(): Promise<AlprDataset>;
}

export function parseConfidence(raw: unknown): AlprConfidence {
  if (typeof raw !== "string") return "unknown";
  const t = raw.trim().toLowerCase();
  if (t === "low" || t === "medium" || t === "high") return t;
  if (t === "l") return "low";
  if (t === "m") return "medium";
  if (t === "h") return "high";
  return "unknown";
}

export function slugAlprEntityId(siteId: string): string {
  return siteId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "site";
}
