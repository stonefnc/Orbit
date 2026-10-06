/** Client side of the notable-aircraft registry: a hex -> owner lookup loaded once from the Orbit server. */
export type NotableAircraft = {
  hex: string;
  owner: string;
  registration?: string;
  type?: string;
  note?: string;
  link?: string;
};

const byHex = new Map<string, NotableAircraft>();
let loadPromise: Promise<void> | null = null;

export function loadNotableAircraft(): Promise<void> {
  loadPromise ??= (async () => {
    try {
      const res = await fetch("/api/notable-aircraft");
      if (!res.ok) return;
      const j = (await res.json()) as { aircraft?: NotableAircraft[] };
      for (const a of j.aircraft ?? []) byHex.set(a.hex.toLowerCase(), a);
    } catch {
      /* optional feature: no registry just means no highlights */
    }
  })();
  return loadPromise;
}

export function notableFor(hex: string): NotableAircraft | undefined {
  return byHex.get(hex.toLowerCase());
}

export type LiveNotable = { hex: string; lat: number; lon: number; altitudeFt: number | null; callsign: string | null };

export function listNotables(): NotableAircraft[] {
  return [...byHex.values()];
}

/** Registry aircraft that are airborne anywhere in the world right now (server caches this for a minute). */
export async function fetchLiveNotables(): Promise<LiveNotable[]> {
  try {
    const res = await fetch("/api/notable-aircraft/live");
    if (!res.ok) return [];
    return ((await res.json()) as { live?: LiveNotable[] }).live ?? [];
  } catch {
    return [];
  }
}

/** Adds or replaces an entry in this browser session only (handy for trying the highlight on any aircraft). */
export function registerNotable(a: NotableAircraft): void {
  byHex.set(a.hex.toLowerCase(), a);
}

export function notableCount(): number {
  return byHex.size;
}
