import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  HorizontalOrigin,
  NearFarScalar,
  VerticalOrigin,
  Viewer
} from "cesium";
import type { AlprDataset, AlprSite } from "./alprTypes";
import { slugAlprEntityId } from "./alprTypes";
import { alprIconUri, alprKindForVendor, type AlprIconState } from "./alprIcons";
import { clusterOnlyWhenFar, fanOutOffsets } from "../clusterAtZoom";
import { horizonDepthTest, horizonDistance } from "../horizon";
import { groundHeightReference } from "../groundAnchor";
import { ViewRangeOverlay } from "../viewRange";
import { planAlprView } from "../viewRangePlan";

const PREFIX = "alpr-site-";

export type AlprFilterState = {
  source: string;
  vendor: string;
  region: string;
};

// Icons carry their own (vendor) colours, so markers are only faded slightly, never tinted.
const COLOR_DIM = Color.WHITE.withAlpha(0.9);
const COLOR_HOVER = Color.WHITE;
const COLOR_SEL = Color.WHITE;

/** Fallback glyph for places that don't know a vendor (e.g. cluster bubbles when canvas is unavailable). */
function getAlprBillboardIconUri(): string {
  return alprIconUri("generic");
}

const clusterIcons = new Map<string, string>();

/** Gold bubble with the camera count ("48", "1.2k"), cached per label. */
function getClusterIconUri(count: number): string {
  const label = count >= 10_000 ? `${Math.round(count / 1000)}k` : count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
  const hit = clusterIcons.get(label);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return getAlprBillboardIconUri();
  ctx.beginPath();
  ctx.arc(48, 48, 44, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(201, 162, 39, 0.28)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(48, 48, 34, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(201, 162, 39, 0.92)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(61, 47, 10, 0.9)";
  ctx.stroke();
  ctx.fillStyle = "#1d1d1f";
  ctx.font = `700 ${label.length > 3 ? 26 : 32}px -apple-system, "SF Pro Text", Inter, "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 48, 50);
  const uri = canvas.toDataURL("image/png");
  clusterIcons.set(label, uri);
  return uri;
}

function entityIdForSite(siteId: string): string {
  return `${PREFIX}${slugAlprEntityId(siteId)}`;
}

export class AlprLayerController {
  readonly dataSource: CustomDataSource;
  private dataset: AlprDataset | null = null;
  private filters: AlprFilterState = { source: "__all__", vendor: "__all__", region: "__all__" };
  private selectedEntityId: string | null = null;
  private hoveredEntityId: string | null = null;
  private readonly siteByEntityId = new Map<string, AlprSite>();
  /** The selected camera's estimated view (cone or circle); only the selected one is ever drawn. */
  private readonly viewRange: ViewRangeOverlay;

  constructor(
    private readonly viewer: Viewer,
    name = "alpr_surveillance"
  ) {
    this.viewRange = new ViewRangeOverlay(viewer);
    this.viewRange.setVisible(false);
    this.dataSource = new CustomDataSource(name);
    this.dataSource.show = false;

    // Zoomed out, thousands of cameras collapse into numbered bubbles that split apart as you zoom in.
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
      // Lets main.ts recognise a click on a bubble and zoom into it.
      const marker = new Entity({ id: "alpr-cluster" });
      (marker as Entity & { cluster?: unknown }).cluster = { clusteredEntities: clustered };
      cluster.billboard.id = marker;
    });
  }

  attach(): void {
    void this.viewer.dataSources.add(this.dataSource);
  }

  setDataset(dataset: AlprDataset | null): void {
    this.dataset = dataset;
    this.selectedEntityId = null;
    this.hoveredEntityId = null;
    this.viewRange.clear();
    this.rebuildEntities();
  }

  getDataset(): AlprDataset | null {
    return this.dataset;
  }

  setFilters(next: Partial<AlprFilterState>): void {
    this.filters = { ...this.filters, ...next };
    this.rebuildEntities();
  }

  getFilters(): AlprFilterState {
    return { ...this.filters };
  }

  setOverlayVisible(on: boolean): void {
    this.dataSource.show = on;
    this.viewRange.setVisible(on);
    this.viewer.scene.requestRender();
  }

  getOverlayVisible(): boolean {
    return this.dataSource.show;
  }

  setSelectedEntityId(id: string | null): void {
    const prev = this.selectedEntityId;
    this.selectedEntityId = id;
    this.restyleChanged(prev, id);
    this.showViewRange();
  }

  /** Draws the selected camera's estimated view, or clears it when nothing is selected. */
  private showViewRange(): void {
    const site = this.selectedEntityId ? this.siteByEntityId.get(this.selectedEntityId) : undefined;
    if (!site) {
      this.viewRange.clear();
      return;
    }
    this.viewRange.show(site.latitude, site.longitude, planAlprView(site), "alpr");
  }

  setHoveredEntityId(id: string | null): void {
    const prev = this.hoveredEntityId;
    this.hoveredEntityId = id;
    this.restyleChanged(prev, id);
  }

  /** Restyle only the markers whose state changed (a full pass over thousands of cameras on every hover is too slow). */
  private restyleChanged(prev: string | null, next: string | null): void {
    for (const eid of new Set([prev, next])) {
      if (!eid) continue;
      const e = this.dataSource.entities.getById(eid);
      const b = e?.billboard;
      if (b) {
        (b as { scale?: number }).scale = this.scaleForBillboard(eid);
        (b as { color?: Color }).color = this.colorForEntity(eid);
        (b as { image?: string }).image = this.iconFor(eid);
      }
    }
    this.viewer.scene.requestRender();
  }

  getSelectedEntityId(): string | null {
    return this.selectedEntityId;
  }

  getSiteForPickId(entityId: string | null | undefined): AlprSite | null {
    if (!entityId || !entityId.startsWith(PREFIX)) return null;
    return this.siteByEntityId.get(entityId) ?? null;
  }

  isAlprPointEntityId(entityId: string): boolean {
    return entityId.startsWith(PREFIX) && !entityId.includes("::");
  }

  filteredSites(): AlprSite[] {
    if (!this.dataset) return [];
    return this.dataset.sites.filter((s) => this.passes(s));
  }

  uniqueFieldValues(field: "source" | "vendor" | "region"): string[] {
    if (!this.dataset) return [];
    const set = new Set<string>();
    for (const s of this.dataset.sites) {
      const v = field === "source" ? s.source : field === "vendor" ? s.vendor : s.region;
      if (v && v.trim()) set.add(v.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  private passes(s: AlprSite): boolean {
    if (this.filters.source !== "__all__" && s.source !== this.filters.source) return false;
    if (this.filters.vendor !== "__all__") {
      const v = (s.vendor ?? "").trim();
      if (v !== this.filters.vendor) return false;
    }
    if (this.filters.region !== "__all__") {
      const r = (s.region ?? "").trim();
      if (r !== this.filters.region) return false;
    }
    return true;
  }

  private rebuildEntities(): void {
    this.siteByEntityId.clear();
    const entities = this.dataSource.entities;
    entities.removeAll();
    entities.suspendEvents();
    const sites = this.filteredSites();
    const groundRef = groundHeightReference(sites.length);
    // Cameras mapped at the same spot (several on one pole) are fanned out so each is visible and clickable.
    const fan = fanOutOffsets(sites.map((s) => ({ lat: s.latitude, lon: s.longitude })));
    for (const [si, site] of sites.entries()) {
      const eid = entityIdForSite(site.id);
      this.siteByEntityId.set(eid, site);
      entities.add({
        id: eid,
        name: site.name ?? site.id,
        position: Cartesian3.fromDegrees(site.longitude, site.latitude, 0),
        billboard: {
          heightReference: groundRef,
          image: alprIconUri(alprKindForVendor(site.vendor), "normal"),
          width: 52,
          height: 52,
          scale: 0.92,
          verticalOrigin: VerticalOrigin.BOTTOM,
          horizontalOrigin: HorizontalOrigin.CENTER,
          // Only cameras mapped on the same spot are shifted apart (fan-out); a lone camera has no offset.
          pixelOffset: new Cartesian2(fan[si]![0], fan[si]![1]),
          color: COLOR_DIM,
          scaleByDistance: new NearFarScalar(3_000, 1, 1_200_000, 0.55),
          disableDepthTestDistance: horizonDepthTest(this.viewer.camera)
        }
      });
    }
    entities.resumeEvents();
    if (this.selectedEntityId && !this.siteByEntityId.has(this.selectedEntityId)) {
      this.selectedEntityId = null;
      this.viewRange.clear();
    }
    this.applyMarkerVisuals();
    this.viewer.scene.requestRender();
  }

  private iconFor(eid: string): string {
    const state: AlprIconState =
      this.selectedEntityId === eid ? "selected" : this.hoveredEntityId === eid ? "hover" : "normal";
    return alprIconUri(alprKindForVendor(this.siteByEntityId.get(eid)?.vendor), state);
  }

  private colorForEntity(eid: string): Color {
    if (this.selectedEntityId === eid) return COLOR_SEL;
    if (this.hoveredEntityId === eid) return COLOR_HOVER;
    return COLOR_DIM;
  }

  private scaleForBillboard(eid: string): number {
    if (this.selectedEntityId === eid) return 1.18;
    if (this.hoveredEntityId === eid) return 1.06;
    return 0.92;
  }

  private applyMarkerVisuals(): void {
    for (const entity of this.dataSource.entities.values) {
      if (typeof entity.id !== "string" || !entity.id.startsWith(PREFIX)) continue;
      if (entity.id.includes("::")) continue;
      const b = entity.billboard;
      if (!b) continue;
      (b as { scale?: number }).scale = this.scaleForBillboard(entity.id);
      (b as { color?: Color }).color = this.colorForEntity(entity.id);
    }
  }

}
