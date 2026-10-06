import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  HorizontalOrigin,
  VerticalOrigin,
  Viewer
} from "cesium";
import type { DatacenterDataset, DatacenterFilterState, DatacenterSite } from "./datacenterTypes";
import { slugDatacenterEntityId } from "./datacenterTypes";
import { clusterOnlyWhenFar, fanOutOffsets } from "../clusterAtZoom";
import { horizonDepthTest, horizonDistance } from "../horizon";
import { groundHeightReference } from "../groundAnchor";

const PREFIX = "dc-site-";

const COLOR_DIM = Color.fromCssColorString("#7c6bff").withAlpha(0.72);
const COLOR_HOVER = Color.fromCssColorString("#a898ff").withAlpha(0.92);
const COLOR_SEL = Color.fromCssColorString("#d4ccff").withAlpha(0.98);

let dcBillboardIconUri: string | undefined;

/** Server-rack style glyph (purple) for map markers. */
function getDatacenterBillboardIconUri(): string {
  if (dcBillboardIconUri) return dcBillboardIconUri;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    dcBillboardIconUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    return dcBillboardIconUri;
  }
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#2a2248";
  ctx.strokeStyle = "#9b8cff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(14, 10, 36, 44, 4);
  } else {
    ctx.rect(14, 10, 36, 44);
  }
  ctx.fill();
  ctx.stroke();
  for (let row = 0; row < 4; row++) {
    const y = 18 + row * 9;
    ctx.fillStyle = row % 2 === 0 ? "#6b5ce6" : "#4f45b8";
    ctx.fillRect(18, y, 28, 5);
    ctx.fillStyle = "#c8beff";
    ctx.fillRect(20, y + 1.5, 4, 2);
    ctx.fillRect(28, y + 1.5, 4, 2);
    ctx.fillRect(36, y + 1.5, 4, 2);
  }
  dcBillboardIconUri = canvas.toDataURL("image/png");
  return dcBillboardIconUri;
}

const clusterIcons = new Map<string, string>();

/** Purple bubble with the facility count ("48", "1.2k"), cached per label. */
function getClusterIconUri(count: number): string {
  const label = count >= 10_000 ? `${Math.round(count / 1000)}k` : count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
  const hit = clusterIcons.get(label);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return getDatacenterBillboardIconUri();
  ctx.beginPath();
  ctx.arc(48, 48, 44, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(124, 107, 255, 0.28)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(48, 48, 34, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(124, 107, 255, 0.95)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${label.length > 3 ? 26 : 32}px -apple-system, "SF Pro Text", Inter, "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 48, 50);
  const uri = canvas.toDataURL("image/png");
  clusterIcons.set(label, uri);
  return uri;
}

function entityIdForSite(siteId: string): string {
  return `${PREFIX}${slugDatacenterEntityId(siteId)}`;
}

export class DatacenterLayerController {
  readonly dataSource: CustomDataSource;
  private dataset: DatacenterDataset | null = null;
  private filters: DatacenterFilterState = { operator: "__all__" };
  private selectedEntityId: string | null = null;
  private hoveredEntityId: string | null = null;
  private readonly siteByEntityId = new Map<string, DatacenterSite>();

  constructor(
    private readonly viewer: Viewer,
    name = "osm_datacenters"
  ) {
    this.dataSource = new CustomDataSource(name);
    this.dataSource.show = false;

    // Zoomed out, a metro's worth of facilities collapses into a numbered bubble that splits as you zoom in.
    const c = this.dataSource.clustering;
    c.enabled = true;
    clusterOnlyWhenFar(this.viewer, this.dataSource);
    c.pixelRange = 42;
    c.minimumClusterSize = 3;
    c.clusterBillboards = true;
    c.clusterLabels = false;
    c.clusterPoints = false;
    c.clusterEvent.addEventListener((clustered, cluster) => {
      cluster.label.show = false;
      cluster.billboard.show = true;
      cluster.billboard.image = getClusterIconUri(clustered.length);
      cluster.billboard.width = 46;
      cluster.billboard.height = 46;
      cluster.billboard.verticalOrigin = VerticalOrigin.CENTER;
      cluster.billboard.horizontalOrigin = HorizontalOrigin.CENTER;
      cluster.billboard.disableDepthTestDistance = horizonDistance(this.viewer.camera.positionWC);
      const marker = new Entity({ id: "dc-cluster" });
      (marker as Entity & { cluster?: unknown }).cluster = { clusteredEntities: clustered };
      cluster.billboard.id = marker;
    });
  }

  attach(): void {
    void this.viewer.dataSources.add(this.dataSource);
  }

  setDataset(dataset: DatacenterDataset | null): void {
    this.dataset = dataset;
    this.selectedEntityId = null;
    this.hoveredEntityId = null;
    this.rebuildEntities();
  }

  getDataset(): DatacenterDataset | null {
    return this.dataset;
  }

  setFilters(next: Partial<DatacenterFilterState>): void {
    this.filters = { ...this.filters, ...next };
    this.rebuildEntities();
  }

  getFilters(): DatacenterFilterState {
    return { ...this.filters };
  }

  setOverlayVisible(on: boolean): void {
    this.dataSource.show = on;
    this.viewer.scene.requestRender();
  }

  getOverlayVisible(): boolean {
    return this.dataSource.show;
  }

  setSelectedEntityId(id: string | null): void {
    const prev = this.selectedEntityId;
    this.selectedEntityId = id;
    this.restyleChanged(prev, id);
  }

  setHoveredEntityId(id: string | null): void {
    const prev = this.hoveredEntityId;
    this.hoveredEntityId = id;
    this.restyleChanged(prev, id);
  }

  /** Restyle only markers whose state changed (a pass over thousands of sites on every hover is too slow). */
  private restyleChanged(prev: string | null, next: string | null): void {
    for (const eid of new Set([prev, next])) {
      if (!eid) continue;
      const b = this.dataSource.entities.getById(eid)?.billboard;
      if (!b) continue;
      (b as { scale?: number }).scale = this.scaleForBillboard(eid);
      (b as { color?: Color }).color = this.colorForEntity(eid);
    }
    this.viewer.scene.requestRender();
  }

  getSelectedEntityId(): string | null {
    return this.selectedEntityId;
  }

  getSiteForPickId(entityId: string | null | undefined): DatacenterSite | null {
    if (!entityId || !entityId.startsWith(PREFIX)) return null;
    return this.siteByEntityId.get(entityId) ?? null;
  }

  isDatacenterPointEntityId(entityId: string): boolean {
    return entityId.startsWith(PREFIX);
  }

  filteredSites(): DatacenterSite[] {
    if (!this.dataset) return [];
    return this.dataset.sites.filter((s) => this.passes(s));
  }

  uniqueOperators(): string[] {
    if (!this.dataset) return [];
    const set = new Set<string>();
    for (const s of this.dataset.sites) {
      const v = (s.operator ?? "").trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  private passes(s: DatacenterSite): boolean {
    if (this.filters.operator === "__all__") return true;
    return (s.operator ?? "").trim() === this.filters.operator;
  }

  private rebuildEntities(): void {
    this.siteByEntityId.clear();
    const entities = this.dataSource.entities;
    entities.removeAll();
    entities.suspendEvents();
    const all = this.filteredSites();
    const groundRef = groundHeightReference(all.length);
    const fan = fanOutOffsets(all.map((s) => ({ lat: s.latitude, lon: s.longitude })));
    for (const [si, site] of all.entries()) {
      const eid = entityIdForSite(site.id);
      this.siteByEntityId.set(eid, site);
      entities.add({
        id: eid,
        name: site.name ?? site.id,
        position: Cartesian3.fromDegrees(site.longitude, site.latitude, 0),
        billboard: {
          image: getDatacenterBillboardIconUri(),
          width: 40,
          height: 40,
          scale: 0.9,
          heightReference: groundRef,
          verticalOrigin: VerticalOrigin.BOTTOM,
          horizontalOrigin: HorizontalOrigin.CENTER,
          pixelOffset: new Cartesian2(fan[si]![0], fan[si]![1]),
          color: COLOR_DIM,
          disableDepthTestDistance: horizonDepthTest(this.viewer.camera)
        }
      });
    }
    entities.resumeEvents();
    if (this.selectedEntityId && !this.siteByEntityId.has(this.selectedEntityId)) {
      this.selectedEntityId = null;
    }
    this.applyMarkerVisuals();
    this.viewer.scene.requestRender();
  }

  private colorForEntity(eid: string): Color {
    if (this.selectedEntityId === eid) return COLOR_SEL;
    if (this.hoveredEntityId === eid) return COLOR_HOVER;
    return COLOR_DIM;
  }

  private scaleForBillboard(eid: string): number {
    if (this.selectedEntityId === eid) return 1.15;
    if (this.hoveredEntityId === eid) return 1.05;
    return 0.9;
  }

  private applyMarkerVisuals(): void {
    for (const entity of this.dataSource.entities.values) {
      if (typeof entity.id !== "string" || !entity.id.startsWith(PREFIX)) continue;
      const b = entity.billboard;
      if (!b) continue;
      (b as { scale?: number }).scale = this.scaleForBillboard(entity.id);
      (b as { color?: Color }).color = this.colorForEntity(entity.id);
    }
  }
}
