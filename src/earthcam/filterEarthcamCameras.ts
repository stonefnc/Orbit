import { Cartographic, Rectangle, Viewer } from "cesium";
import type { EarthCamCamera, EarthCamFilterState } from "./earthcamTypes";

function matchesSearch(cam: EarthCamCamera, q: string): boolean {
  if (!q) return true;
  const hay = [
    cam.name,
    cam.city,
    cam.region,
    cam.country,
    cam.category,
    cam.id
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function filterEarthcamCameras(
  cameras: EarthCamCamera[],
  filters: EarthCamFilterState,
  viewportRect: Rectangle | undefined
): EarthCamCamera[] {
  const q = filters.search.trim().toLowerCase();

  return cameras.filter((cam) => {
    if (filters.country !== "__all__" && (cam.country ?? "") !== filters.country) return false;
    if (filters.city !== "__all__" && (cam.city ?? "") !== filters.city) return false;
    if (filters.category !== "__all__" && (cam.category ?? "") !== filters.category) return false;
    if (filters.status !== "__all__" && cam.status !== filters.status) return false;
    if (!matchesSearch(cam, q)) return false;

    if (filters.viewportOnly && viewportRect) {
      if (!Rectangle.contains(viewportRect, Cartographic.fromDegrees(cam.longitude, cam.latitude))) {
        return false;
      }
    }
    return true;
  });
}

export function viewportRectangleForViewer(viewer: Viewer): Rectangle | undefined {
  return viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid) ?? undefined;
}

export function uniqueFieldValues(
  cameras: EarthCamCamera[],
  field: "country" | "city" | "category" | "status"
): string[] {
  const set = new Set<string>();
  for (const c of cameras) {
    const v =
      field === "country"
        ? c.country
        : field === "city"
          ? c.city
          : field === "category"
            ? c.category
            : c.status;
    if (v?.trim()) set.add(v.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
