import { Entity, HorizontalOrigin, VerticalOrigin, type Camera, type CustomDataSource } from "cesium";
import { horizonDistance } from "../horizon";

/**
 * Turns on map clustering for a data source and draws each cluster as a numbered bubble in the given colour.
 * Clicking a bubble hands layers a pseudo entity (`id`) carrying the clustered entities so they can zoom into it.
 */
const cache = new Map<string, string>();

function bubbleUri(count: number, fill: string, ring: string): string {
  const label = count >= 10_000 ? `${Math.round(count / 1000)}k` : count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
  const key = `${fill}|${ring}|${label}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 80;
  const g = c.getContext("2d");
  if (!g) return "";
  g.beginPath();
  g.arc(40, 40, 36, 0, Math.PI * 2);
  g.fillStyle = `${fill}47`;
  g.fill();
  g.beginPath();
  g.arc(40, 40, 28, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = ring;
  g.stroke();
  g.fillStyle = "#fff";
  g.font = `700 ${label.length > 3 ? 21 : 25}px -apple-system, "SF Pro Text", Inter, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 40, 42);
  const uri = c.toDataURL("image/png");
  cache.set(key, uri);
  return uri;
}

export function enableBubbleClusters(
  ds: CustomDataSource,
  camera: Camera,
  pseudoId: string,
  fill: string,
  ring = "rgba(255,255,255,0.9)"
): void {
  const cl = ds.clustering;
  cl.enabled = true;
  cl.pixelRange = 36;
  cl.minimumClusterSize = 4;
  cl.clusterBillboards = true;
  cl.clusterLabels = false;
  cl.clusterPoints = false;
  cl.clusterEvent.addEventListener((clustered, cluster) => {
    cluster.label.show = false;
    cluster.billboard.show = true;
    cluster.billboard.image = bubbleUri(clustered.length, fill, ring);
    cluster.billboard.width = 38;
    cluster.billboard.height = 38;
    cluster.billboard.verticalOrigin = VerticalOrigin.CENTER;
    cluster.billboard.horizontalOrigin = HorizontalOrigin.CENTER;
    // A plain number, not a property: clusters are rebuilt whenever the camera moves (camera.changed), so it stays current.
    cluster.billboard.disableDepthTestDistance = horizonDistance(camera.positionWC);
    const marker = new Entity({ id: pseudoId });
    (marker as Entity & { cluster?: unknown }).cluster = { clusteredEntities: clustered };
    cluster.billboard.id = marker;
  });
}
