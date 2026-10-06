import type { CustomDataSource, Viewer } from "cesium";

/**
 * Clustering is for zoomed-out views. Close in, markers that share a spot (six cameras on one pole, a campus of data
 * halls) can never separate on screen, so the bubble would hide them for good, including a camera you just selected.
 * This switches a data source's clustering off below `belowM` metres of camera height and back on above it.
 */
export function clusterOnlyWhenFar(viewer: Viewer, ds: CustomDataSource, belowM = 5_000): void {
  const apply = (): void => {
    const far = viewer.camera.positionCartographic.height > belowM;
    if (ds.clustering.enabled !== far) {
      ds.clustering.enabled = far;
      viewer.scene.requestRender();
    }
  };
  viewer.camera.changed.addEventListener(apply);
  viewer.camera.moveEnd.addEventListener(apply);
  apply();
}

/**
 * Pixel offsets that fan out markers sharing (almost) the same coordinates into a small ring, so each one can be seen
 * and clicked. Returns [dx, dy] per input index; a lone marker gets [0, 0].
 */
export function fanOutOffsets(points: Array<{ lat: number; lon: number }>, radiusPx = 15): Array<[number, number]> {
  const groups = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = `${Math.round(p.lat * 20_000)}:${Math.round(p.lon * 20_000)}`; // ~5 m cells
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  const out: Array<[number, number]> = points.map(() => [0, 0]);
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const r = radiusPx + Math.max(0, idx.length - 6) * 2;
    idx.forEach((pi, k) => {
      const a = (k / idx.length) * Math.PI * 2 - Math.PI / 2;
      out[pi] = [Math.cos(a) * r, Math.sin(a) * r];
    });
  }
  return out;
}
