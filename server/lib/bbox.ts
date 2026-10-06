export type BBox = { lamin: number; lamax: number; lomin: number; lomax: number };

export function boundingBoxFromCenterNm(lat: number, lon: number, distNm: number): BBox | null {
  const latDelta = distNm / 60;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lonDelta = distNm / (60 * Math.max(0.12, Math.abs(cosLat)));
  let lamin = lat - latDelta;
  let lamax = lat + latDelta;
  let lomin = lon - lonDelta;
  let lomax = lon + lonDelta;
  lamin = Math.max(-85, lamin);
  lamax = Math.min(85, lamax);
  lomin = Math.max(-180, Math.min(180, lomin));
  lomax = Math.max(-180, Math.min(180, lomax));
  if (lamax <= lamin || lomax <= lomin) return null;
  return { lamin, lamax, lomin, lomax };
}

/** Like `boundingBoxFromCenterNm` but splits boxes that cross the antimeridian into two. */
export function boundingBoxesFromCenterNm(lat: number, lon: number, distNm: number): BBox[] {
  const latDelta = distNm / 60;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lonDelta = Math.min(180, distNm / (60 * Math.max(0.12, Math.abs(cosLat))));
  const lamin = Math.max(-85, lat - latDelta);
  const lamax = Math.min(85, lat + latDelta);
  if (lamax <= lamin) return [];
  if (lonDelta >= 180) return [{ lamin, lamax, lomin: -180, lomax: 180 }];

  const wrap = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180;
  const lomin = wrap(lon - lonDelta);
  const lomax = wrap(lon + lonDelta);
  if (lomin <= lomax) return [{ lamin, lamax, lomin, lomax }];
  return [
    { lamin, lamax, lomin, lomax: 180 },
    { lamin, lamax, lomin: -180, lomax }
  ];
}

export function boxContainsBox(outer: BBox, inner: BBox): boolean {
  return (
    inner.lamin >= outer.lamin &&
    inner.lamax <= outer.lamax &&
    inner.lomin >= outer.lomin &&
    inner.lomax <= outer.lomax
  );
}
