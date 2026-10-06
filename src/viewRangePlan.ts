/**
 * What to draw (and say) for a selected ALPR or traffic camera's view range. No Cesium here, so it is unit-tested.
 *
 * Rule: a shape only states what the data supports. Everything not published by the agency or mapped in OSM is an
 * estimate, and every plan carries the sentence that says so (`detail`, shown under the card table), the one-line
 * `summary` (the card's "View range" row) and a short `label` (drawn on the map). Directions are never guessed from
 * road geometry. Shapes are cones (a pie slice: two straight edges at the lens angle closed by an arc at the range)
 * or circles; there are no arrows.
 */

/** `data`: the numbers come from the data source; `estimated`: a typical shape around a published direction;
 *  `likely`: the direction itself is only inferred (traffic direction), so the cone is wide, lighter and dashed. */
export type ViewBasis = "data" | "estimated" | "likely";

export type ViewPlan =
  | { kind: "cone"; bearingDeg: number; widthDeg: number; depthM: number; basis: ViewBasis; label: string; summary: string; detail: string }
  | { kind: "circle"; radiusM: number; label: string; summary: string; detail: string };

/** Flock Safety's own spec sheet: plate reads "up to 75 ft" (about 23 m) from the camera. */
export const FLOCK_READ_RANGE_M = 23;
/** Far end of a typical adjustable ALPR lens: about 100 ft (30 m), with the angle narrowing from about 40 to 15 degrees. */
export const GENERIC_ALPR_RANGE_M = 30;
/** The wide end of that lens range; the real plate-read zone is narrower. */
export const ALPR_WIDTH_DEG = 40;
export const CCTV_FACING_WIDTH_DEG = 60;
export const CCTV_FACING_DEPTH_M = 250;
/** Traffic direction only says which way the watched traffic flows, so the cone is wide and short. */
export const CCTV_LIKELY_WIDTH_DEG = 90;
export const CCTV_LIKELY_DEPTH_M = 150;
export const CCTV_UNKNOWN_RADIUS_M = 150;
export const ALPR_PAN_RADIUS_M = 30;

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export function compassName(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export type AlprViewInput = {
  bearingDeg?: number | null;
  fovDeg?: number | null;
  rangeMeters?: number | null;
  vendor?: string | null;
  notes?: string | null;
};

/** `camera:type=dome|panning|ptz|panorama...` tags mean the lens moves, so one fixed cone would be wrong. */
function canPan(notes: string | null | undefined): boolean {
  return /camera:type=(dome|panning|ptz|panorama)/i.test(notes ?? "");
}

export function planAlprView(site: AlprViewInput): ViewPlan {
  const flock = /flock/i.test(site.vendor ?? "");
  const depth = flock ? FLOCK_READ_RANGE_M : GENERIC_ALPR_RANGE_M;
  const why = flock
    ? "Flock publishes plate reads up to 75 ft (23 m)"
    : "a typical adjustable plate-reader lens reaches about 100 ft (30 m)";
  if (canPan(site.notes)) {
    return {
      kind: "circle",
      radiusM: ALPR_PAN_RADIUS_M,
      label: `Can pan · ${ALPR_PAN_RADIUS_M} m`,
      summary: `Can pan · circle ${ALPR_PAN_RADIUS_M} m (estimated)`,
      detail: `Estimated: OpenStreetMap tags this as a dome / panning camera, so it can turn and no fixed view is drawn; the circle only shows the rough reach (${ALPR_PAN_RADIUS_M} m).`
    };
  }
  if (!finite(site.bearingDeg)) {
    return {
      kind: "circle",
      radiusM: depth,
      label: "Direction not recorded",
      summary: `Direction not recorded · circle ${depth} m (estimated)`,
      detail: `Estimated: no direction is mapped for this camera in OpenStreetMap, so no cone can be drawn; the faint circle shows only the reach (${why}).`
    };
  }
  const fov = site.fovDeg;
  const rng = site.rangeMeters;
  if (finite(fov) && finite(rng) && fov > 2 && fov < 180 && rng > 3 && rng < 500) {
    return {
      kind: "cone",
      bearingDeg: site.bearingDeg,
      widthDeg: fov,
      depthM: rng,
      basis: "data",
      label: `View · ${Math.round(fov)}° × ${Math.round(rng)} m`,
      summary: `${Math.round(fov)}° × ${Math.round(rng)} m (from the data)`,
      detail: `Direction, angle and range come from the data source (${Math.round(site.bearingDeg)}° true, ${Math.round(fov)}° wide, ${Math.round(rng)} m).`
    };
  }
  return {
    kind: "cone",
    bearingDeg: site.bearingDeg,
    widthDeg: ALPR_WIDTH_DEG,
    depthM: depth,
    basis: "estimated",
    label: `Est. view · ${ALPR_WIDTH_DEG}° × ${depth} m`,
    summary: `${ALPR_WIDTH_DEG}° × ${depth} m (estimated)`,
    detail: `Estimated: the direction (${Math.round(site.bearingDeg)}° true, ${compassName(site.bearingDeg)}) is mapped in OpenStreetMap, but the angle and range are not; ${why}, and the lens angle varies from about 15° to 40° (drawn at the wide end). The real read zone is narrower.`
  };
}

export type CctvViewInput = {
  headingDeg: number | null;
  headingKind: "facing" | "traffic-direction" | "unknown";
};

export function planCctvView(c: CctvViewInput): ViewPlan {
  if (c.headingKind === "facing" && finite(c.headingDeg)) {
    const dir = compassName(c.headingDeg);
    return {
      kind: "cone",
      bearingDeg: c.headingDeg,
      widthDeg: CCTV_FACING_WIDTH_DEG,
      depthM: CCTV_FACING_DEPTH_M,
      basis: "estimated",
      label: `Est. view ${dir} · ${CCTV_FACING_WIDTH_DEG}° × ${CCTV_FACING_DEPTH_M} m`,
      summary: `${CCTV_FACING_WIDTH_DEG}° × ${CCTV_FACING_DEPTH_M} m (estimated)`,
      detail: `Estimated: the agency says the camera looks ${dir}, but publishes no lens angle or range; the ${CCTV_FACING_WIDTH_DEG}° × ${CCTV_FACING_DEPTH_M} m cone is a typical traffic-camera shape, not the real field of view.`
    };
  }
  if (c.headingKind === "traffic-direction" && finite(c.headingDeg)) {
    const dir = compassName(c.headingDeg);
    return {
      kind: "cone",
      bearingDeg: c.headingDeg,
      widthDeg: CCTV_LIKELY_WIDTH_DEG,
      depthM: CCTV_LIKELY_DEPTH_M,
      basis: "likely",
      label: `Likely view: traffic direction ${dir} (not published)`,
      summary: `${CCTV_LIKELY_WIDTH_DEG}° × ${CCTV_LIKELY_DEPTH_M} m (likely, from traffic direction)`,
      detail: `Estimated: the agency publishes only the direction of the traffic this camera watches (${dir}), not where the lens points; the wide, dashed cone is a likely view along that direction, not the camera's real field of view.`
    };
  }
  return {
    kind: "circle",
    radiusM: CCTV_UNKNOWN_RADIUS_M,
    label: "Direction not published (may pan)",
    summary: `Direction not published · circle ${CCTV_UNKNOWN_RADIUS_M} m (estimated)`,
    detail: `Estimated: the agency does not publish which way this camera looks, and it may be able to pan; the faint circle (${CCTV_UNKNOWN_RADIUS_M} m) only marks the camera's rough surroundings, not a view.`
  };
}
