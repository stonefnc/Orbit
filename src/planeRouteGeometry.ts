import { Cartesian3, Cartographic, EllipsoidGeodesic, PolylineDashMaterialProperty, Color } from "cesium";

/** Great-circle path at roughly fixed baro height (globe-relative arc). */
export function greatCircleCartesians(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number,
  altitudeM: number,
  segments = 64
): Cartesian3[] {
  const geo = new EllipsoidGeodesic(
    Cartographic.fromDegrees(lon1Deg, lat1Deg),
    Cartographic.fromDegrees(lon2Deg, lat2Deg)
  );

  const out: Cartesian3[] = [];
  for (let i = 0; i <= segments; i++) {
    const c = geo.interpolateUsingFraction(i / segments);
    c.height = altitudeM;
    out.push(Cartographic.toCartesian(c));
  }
  return out;
}

/** Forward geodesic: true track ° from north, distance nautical miles */
export function destinationFromBearingNm(
  lonDeg: number,
  latDeg: number,
  bearingTrueDeg: number,
  distanceNm: number
): { lat: number; lon: number } {
  const EarthRadiusNm = 3440.065;
  const δ = distanceNm / EarthRadiusNm;
  const θ = (bearingTrueDeg * Math.PI) / 180;
  const φ1 = (latDeg * Math.PI) / 180;
  const λ1 = (lonDeg * Math.PI) / 180;

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return {
    lat: (φ2 * 180) / Math.PI,
    lon: ((((λ2 * 180) / Math.PI) + 540) % 360) - 180
  };
}

export function trackProjectionDashMaterial(alpha = 0.75): PolylineDashMaterialProperty {
  return new PolylineDashMaterialProperty({
    color: Color.fromCssColorString("#ffd27a").withAlpha(alpha),
    dashLength: 14
  });
}

export function filedRouteGlowColor(): Color {
  return Color.fromCssColorString("#9fd4ff").withAlpha(0.92);
}
