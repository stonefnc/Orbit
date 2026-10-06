import type { EarthCamDataset } from "../earthcamTypes";

/**
 * Provider interface for camera metadata ingestion.
 *
 * Swap implementations without changing EarthCamLayer or UI:
 * - StaticEarthcamProvider — local JSON (dev / seed)
 * - LicensedEarthCamProvider — future licensed EarthCam API
 * - AggregatedCameraProvider — municipal, traffic, resort feeds
 */
export interface EarthCamProvider {
  readonly kind: string;
  load(): Promise<EarthCamDataset>;
}

/** Alias for a generic multi-source live-camera network. */
export type CameraLayerProvider = EarthCamProvider;
