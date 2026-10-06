import type { EarthCamDataset } from "../earthcamTypes";
import { parseEarthcamJsonPayload } from "../validateEarthcamRecord";
import type { EarthCamProvider } from "./earthcamProvider";

function resolveDataUrl(pathOrUrl: string): string {
  const t = pathOrUrl.trim();
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  return `${import.meta.env.BASE_URL}${t.replace(/^\//, "")}`.replace(/\/{2,}/g, "/");
}

export type StaticEarthcamProviderOptions = {
  /** Default `/data/earthcam-cameras.json` */
  dataUrl?: string;
};

/**
 * Loads camera metadata from a static JSON bundle.
 * Future: replace with LicensedEarthCamProvider pointing at your backend relay.
 */
export class StaticEarthcamProvider implements EarthCamProvider {
  readonly kind = "static-json";

  constructor(private readonly opts: StaticEarthcamProviderOptions = {}) {}

  async load(): Promise<EarthCamDataset> {
    const url =
      this.opts.dataUrl?.trim() ||
      (import.meta.env.VITE_EARTHCAM_DATA_URL as string | undefined)?.trim() ||
      resolveDataUrl("data/earthcam-cameras.json");

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`EarthCam dataset HTTP ${res.status} (${url})`);
    }
    const json: unknown = await res.json();
    const { dataset, skipped, warnings } = parseEarthcamJsonPayload(json, {
      providerId: "static-json"
    });
    if (warnings.length) {
      console.warn("[earthcam] dataset warnings:", warnings);
    }
    if (skipped > 0) {
      console.info(`[earthcam] skipped ${skipped} invalid record(s)`);
    }
    return dataset;
  }
}

/** Factory — use when VITE_EARTHCAM_ADAPTER=static (seed JSON). OSM viewport is default in EarthCamController. */
export function createEarthcamProviderFromEnv(): EarthCamProvider {
  return new StaticEarthcamProvider();
}
