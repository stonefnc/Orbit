import { HeightReference } from "cesium";

/**
 * Point markers (cameras, ALPR, data centers) are planted on the ground: the entity sits at height 0 and the billboard
 * is clamped to the terrain / 3D tiles, so its foot is exactly the data coordinate at every zoom and tilt. (A fixed
 * height above the ellipsoid put the icon tens of metres off wherever the real ground is not at sea level.)
 * Clamping makes Cesium sample the ground for each billboard, which is fine for a few thousand but not for tens of
 * thousands; with more markers than this the view is far out and the offset is invisible, so they stay unclamped.
 */
export const GROUND_CLAMP_MAX_MARKERS = 2500;

export function groundHeightReference(markerCount: number): HeightReference {
  return markerCount <= GROUND_CLAMP_MAX_MARKERS ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE;
}
