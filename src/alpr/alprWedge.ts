import { Cartesian3, Math as CesiumMath } from "cesium";

const R_EARTH = 6371008.8;

/** Bearing in degrees clockwise from true north; distance in meters. */
export function destinationLatLon(
  latDeg: number,
  lonDeg: number,
  bearingDeg: number,
  distanceM: number
): [number, number] {
  const φ1 = CesiumMath.toRadians(latDeg);
  const λ1 = CesiumMath.toRadians(lonDeg);
  const θ = CesiumMath.toRadians(bearingDeg);
  const δ = distanceM / R_EARTH;

  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  return [CesiumMath.toDegrees(φ2), CesiumMath.toDegrees(λ2)];
}

/** Closed wedge polygon at fixed height (meters above ellipsoid). */
export function wedgeCartesians(
  latDeg: number,
  lonDeg: number,
  bearingDegClockwiseFromNorth: number,
  fovDeg: number,
  rangeM: number,
  heightM: number,
  arcSteps = 18
): Cartesian3[] {
  const half = fovDeg / 2;
  const start = bearingDegClockwiseFromNorth - half;
  const end = bearingDegClockwiseFromNorth + half;
  const hub = Cartesian3.fromDegrees(lonDeg, latDeg, heightM);
  const ring: Cartesian3[] = [hub];
  for (let i = 0; i <= arcSteps; i++) {
    const brg = start + ((end - start) * i) / arcSteps;
    const [la, lo] = destinationLatLon(latDeg, lonDeg, brg, rangeM);
    ring.push(Cartesian3.fromDegrees(lo, la, heightM));
  }
  ring.push(hub);
  return ring;
}

/** Closed circle outline of `radiusM` around the point (for the dashed ring of the "direction unknown" circle). */
export function circleCartesians(latDeg: number, lonDeg: number, radiusM: number, heightM: number, steps = 48): Cartesian3[] {
  const ring: Cartesian3[] = [];
  for (let i = 0; i <= steps; i++) {
    const [la, lo] = destinationLatLon(latDeg, lonDeg, (360 * i) / steps, radiusM);
    ring.push(Cartesian3.fromDegrees(lo, la, heightM));
  }
  return ring;
}
