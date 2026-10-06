import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  HorizontalOrigin,
  LabelStyle,
  VerticalOrigin,
  Viewer
} from "cesium";
import { filterEarthcamCameras, viewportRectangleForViewer } from "./filterEarthcamCameras";
import { getEarthcamBillboardIconUri } from "./earthcamIcon";
import type { EarthCamCamera, EarthCamDataset, EarthCamFilterState } from "./earthcamTypes";
import { EARTHCAM_CLUSTERING_MIN_COUNT, slugEarthcamEntityId } from "./earthcamTypes";
import { horizonDepthTest, horizonDistance } from "../horizon";
import { groundHeightReference } from "../groundAnchor";
import { ViewRangeOverlay } from "../viewRange";
import { planCctvView } from "../viewRangePlan";

const PREFIX = "ecam-";

const COLOR_DIM = Color.fromCssColorString("#ff8c3a").withAlpha(0.78);
const COLOR_HOVER = Color.fromCssColorString("#ffc070").withAlpha(0.95);
const COLOR_SEL = Color.fromCssColorString("#ffe8c8").withAlpha(1);
const CLUSTER_FILL = Color.fromCssColorString("#ff6a1a").withAlpha(0.88);
const CLUSTER_OUTLINE = Color.fromCssColorString("#1a0e06").withAlpha(0.9);

function entityIdForCamera(cameraId: string): string {
  return `${PREFIX}${slugEarthcamEntityId(cameraId)}`;
}

function statusLabel(cam: EarthCamCamera): string {
  if (cam.status === "live") return "● LIVE";
  if (cam.status === "available") return "◉ AVAIL";
  if (cam.status === "offline") return "○ OFF";
  return "—";
}

/**
 * Globe visualization for EarthCam (and future live-camera sources).
 * Uses Cesium entity clustering at distance; individual billboards when zoomed in.
 */
export class EarthCamLayer {
  readonly dataSource: CustomDataSource;
  private dataset: EarthCamDataset | null = null;
  private filters: EarthCamFilterState;
  private selectedEntityId: string | null = null;
  private hoveredEntityId: string | null = null;
  private readonly cameraByEntityId = new Map<string, EarthCamCamera>();
  private clusterListenerAttached = false;
  /** The selected camera's estimated view (cone, arrow or circle); only the selected one is ever drawn. */
  private readonly viewRange: ViewRangeOverlay;

  constructor(
    private readonly viewer: Viewer,
    filters: EarthCamFilterState,
    name = "earthcam_live"
  ) {
    this.viewRange = new ViewRangeOverlay(viewer);
    this.viewRange.setVisible(false);
    this.filters = { ...filters };
    this.dataSource = new CustomDataSource(name);
    this.dataSource.show = false;
    this.configureClustering();
  }

  private configureClustering(): void {
    const clustering = this.dataSource.clustering;
    clustering.enabled = true;
    clustering.pixelRange = 42;
    clustering.minimumClusterSize = 3;
    clustering.clusterBillboards = true;
    clustering.clusterLabels = true;
    clustering.clusterPoints = false;

    if (this.clusterListenerAttached) return;
    this.clusterListenerAttached = true;

    clustering.clusterEvent.addEventListener((clusteredEntities, cluster) => {
      cluster.label.show = true;
      cluster.label.text = `${clusteredEntities.length}`;
      cluster.label.font = "600 11px IBM Plex Mono, monospace";
      cluster.label.fillColor = Color.fromCssColorString("#ffe8c8");
      cluster.label.outlineColor = CLUSTER_OUTLINE;
      cluster.label.outlineWidth = 3;
      cluster.label.style = LabelStyle.FILL_AND_OUTLINE;
      cluster.label.verticalOrigin = VerticalOrigin.CENTER;
      cluster.label.horizontalOrigin = HorizontalOrigin.CENTER;
      cluster.label.disableDepthTestDistance = horizonDistance(this.viewer.camera.positionWC);

      cluster.billboard.show = true;
      cluster.billboard.image = getEarthcamBillboardIconUri();
      cluster.billboard.width = 36;
      cluster.billboard.height = 36;
      cluster.billboard.color = CLUSTER_FILL;
      cluster.billboard.disableDepthTestDistance = horizonDistance(this.viewer.camera.positionWC);
    });
  }

  attach(): void {
    void this.viewer.dataSources.add(this.dataSource);
  }

  setDataset(dataset: EarthCamDataset | null, opts?: { keepSelection?: boolean }): void {
    this.dataset = dataset;
    if (!opts?.keepSelection) {
      this.selectedEntityId = null;
      this.viewRange.clear();
    }
    this.hoveredEntityId = null;
    this.rebuildEntities();
  }

  getDataset(): EarthCamDataset | null {
    return this.dataset;
  }

  setFilters(next: Partial<EarthCamFilterState>): void {
    this.filters = { ...this.filters, ...next };
    this.rebuildEntities();
  }

  getFilters(): EarthCamFilterState {
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
    this.applyMarkerVisuals([prev, id]);
    this.showViewRange();
    this.viewer.scene.requestRender();
  }

  /** Draws the selected camera's estimated view, or clears it. Only cameras from the CCTV server carry a heading kind. */
  private showViewRange(): void {
    const cam = this.selectedEntityId ? this.cameraByEntityId.get(this.selectedEntityId) : undefined;
    if (!cam || !cam.headingKind) {
      this.viewRange.clear();
      return;
    }
    this.viewRange.show(
      cam.latitude,
      cam.longitude,
      planCctvView({ headingDeg: cam.headingDeg ?? null, headingKind: cam.headingKind }),
      "cctv"
    );
  }

  setHoveredEntityId(id: string | null): void {
    const prev = this.hoveredEntityId;
    this.hoveredEntityId = id;
    this.applyMarkerVisuals([prev, id]);
    this.viewer.scene.requestRender();
  }

  getSelectedEntityId(): string | null {
    return this.selectedEntityId;
  }

  getCameraForPickId(entityId: string | null | undefined): EarthCamCamera | null {
    if (!entityId || !entityId.startsWith(PREFIX)) return null;
    return this.cameraByEntityId.get(entityId) ?? null;
  }

  isEarthcamPointEntityId(entityId: string): boolean {
    return entityId.startsWith(PREFIX);
  }

  filteredCameras(): EarthCamCamera[] {
    if (!this.dataset) return [];
    const rect = this.filters.viewportOnly
      ? viewportRectangleForViewer(this.viewer)
      : undefined;
    return filterEarthcamCameras(this.dataset.cameras, this.filters, rect);
  }

  getEntityForCameraId(cameraId: string): Entity | undefined {
    const eid = entityIdForCamera(cameraId);
    return this.dataSource.entities.getById(eid);
  }

  /** Zoom toward a cluster pick — Cesium expands clusters as user zooms in. */
  flyToCluster(clusteredEntities: Entity[]): void {
    if (!clusteredEntities.length) return;
    void this.viewer.flyTo(clusteredEntities, { duration: 1.1 }).catch(() => {});
  }

  /** Fly the globe to frame all cameras matching current filters. */
  flyToAllFilteredCameras(): void {
    const cameras = this.filteredCameras();
    if (!cameras.length) return;
    const targets = cameras
      .map((c) => this.getEntityForCameraId(c.id))
      .filter((e): e is Entity => !!e);
    if (!targets.length) return;
    void this.viewer.flyTo(targets, { duration: 1.4 }).catch(() => {});
  }

  private rebuildEntities(): void {
    this.cameraByEntityId.clear();
    const entities = this.dataSource.entities;
    entities.removeAll();
    entities.suspendEvents();

    const cameras = this.filteredCameras();
    const groundRef = groundHeightReference(cameras.length);

    const clustering = this.dataSource.clustering;
    clustering.enabled = cameras.length > EARTHCAM_CLUSTERING_MIN_COUNT;

    for (const cam of cameras) {
      const eid = entityIdForCamera(cam.id);
      this.cameraByEntityId.set(eid, cam);
      // Labels are expensive at ~1,500 markers; real-feed cameras are identified by the panel instead.
      const showLabel = cam.status === "live" && !cam.frameUrl;

      entities.add({
        id: eid,
        name: cam.name,
        position: Cartesian3.fromDegrees(cam.longitude, cam.latitude, 0),
        billboard: {
          image: getEarthcamBillboardIconUri(),
          width: 40,
          height: 40,
          scale: 0.92,
          heightReference: groundRef,
          // The badge is round (its lens is the data point), so it is centred on the coordinate, not hung above it.
          verticalOrigin: VerticalOrigin.CENTER,
          horizontalOrigin: HorizontalOrigin.CENTER,
          color: COLOR_DIM,
          disableDepthTestDistance: horizonDepthTest(this.viewer.camera)
        },
        label: showLabel
          ? {
              text: "LIVE",
              font: "600 8px IBM Plex Mono, monospace",
              fillColor: Color.fromCssColorString("#ff6a1a"),
              outlineColor: Color.BLACK,
              outlineWidth: 2,
              style: LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: VerticalOrigin.TOP,
              pixelOffset: new Cartesian2(0, -30),
              heightReference: groundRef,
              show: true,
              disableDepthTestDistance: horizonDepthTest(this.viewer.camera),
              scale: 0.9
            }
          : undefined,
        description: `${statusLabel(cam)} · ${cam.city ?? ""} ${cam.country ?? ""}`.trim()
      });
    }

    entities.resumeEvents();
    if (this.selectedEntityId && !this.cameraByEntityId.has(this.selectedEntityId)) {
      this.selectedEntityId = null;
      this.viewRange.clear();
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
    if (this.selectedEntityId === eid) return 1.2;
    if (this.hoveredEntityId === eid) return 1.08;
    return 0.92;
  }

  /** Restyles only the given marker ids, or every marker when none are given (after a rebuild). */
  private applyMarkerVisuals(onlyIds?: Array<string | null>): void {
    const style = (entity: Entity): void => {
      if (typeof entity.id !== "string" || !entity.id.startsWith(PREFIX)) return;
      const b = entity.billboard;
      if (b) {
        (b as { scale?: number }).scale = this.scaleForBillboard(entity.id);
        (b as { color?: Color }).color = this.colorForEntity(entity.id);
      }
    };
    if (onlyIds) {
      for (const id of new Set(onlyIds)) {
        if (!id) continue;
        const e = this.dataSource.entities.getById(id);
        if (e) style(e);
      }
      return;
    }
    for (const entity of this.dataSource.entities.values) style(entity);
  }
}
