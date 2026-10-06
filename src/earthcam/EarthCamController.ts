import type { Viewer } from "cesium";
import { Cartesian3, Entity } from "cesium";
import { flyStraightDown } from "../flyDown";
import { postOverpassQl } from "../alpr/overpassAdapter";
import {
  shouldLoadEarthcamViaCctv,
  shouldLoadEarthcamViaOsm,
  shouldLoadEarthcamViaNetwork,
  getEarthcamOverpassInterpreterFromEnv
} from "./createEarthcamAdapter";
import { fetchCctvViewport, type CctvSourceInfo, type ViewBounds } from "./cctvClient";
import { openLiveViewer } from "../liveViewer";
import { planCctvView } from "../viewRangePlan";
import { uniqueFieldValues, viewportRectangleForViewer } from "./filterEarthcamCameras";
import { overpassJsonToEarthcamDataset } from "./overpassAdapter";
import {
  buildViewportEarthcamOverpassQuery,
  viewportEarthcamSkipMessage
} from "./overpassViewport";
import { EarthCamLayer } from "./EarthCamLayer";
import type { EarthCamProvider } from "./providers/earthcamProvider";
import { createEarthcamProviderFromEnv, StaticEarthcamProvider } from "./providers/staticEarthcamProvider";
import { EarthcamNetworkProvider } from "./providers/earthcamNetworkProvider";
import {
  canEmbedEarthCamStream,
  DEFAULT_EARTHCAM_FILTERS,
  EARTHCAM_CLUSTERING_MIN_COUNT,
  type EarthCamCamera,
  type EarthCamDataset,
  type EarthCamDetailState,
  type EarthCamFilterState
} from "./earthcamTypes";

/** What the camera layer really covers (agency feeds only); keep in step with `CCTV_SOURCES` in `server/cctv/registry.ts`. */
const CCTV_COVERAGE_NOTE =
  "Coverage: most US states, Ontario, British Columbia, Calgary, London, Finland, Hong Kong and New Zealand; nothing yet in South America, Africa or the rest of Asia, Europe and Australia.";

export type EarthCamDomRefs = {
  toggleEl: HTMLButtonElement | null;
  moduleEl: HTMLElement | null;
  statusEl: HTMLElement | null;
  filtersEl: HTMLElement | null;
  searchInputEl: HTMLInputElement | null;
  countryEl: HTMLSelectElement | null;
  cityEl: HTMLSelectElement | null;
  categoryEl: HTMLSelectElement | null;
  statusFilterEl: HTMLSelectElement | null;
  viewportOnlyEl: HTMLInputElement | null;
  viewAllBtnEl: HTMLButtonElement | null;
  panelBodyEl: HTMLElement | null;
  panelStateEl: HTMLElement | null;
  panelHeadEl: HTMLElement | null;
  thumbEl: HTMLImageElement | null;
  thumbPlaceholderEl: HTMLElement | null;
  embedWrapEl: HTMLElement | null;
  embedFrameEl: HTMLIFrameElement | null;
  externalBtnEl: HTMLAnchorElement | null;
  flyBtnEl: HTMLButtonElement | null;
  liveBtnEl: HTMLButtonElement | null;
  metaLocationEl: HTMLElement | null;
  metaCategoryEl: HTMLElement | null;
  metaStatusEl: HTMLElement | null;
  metaSourceEl: HTMLElement | null;
  metaAttribEl: HTMLElement | null;
  metaNotesEl: HTMLElement | null;
  /** Unclamped line under the table that says what the drawn view range is based on. */
  viewNoteEl: HTMLElement | null;
  /** The card row with the same "angle × range" line as the map label. */
  metaViewEl: HTMLElement | null;
  satInfoEl: HTMLElement | null;
  satNameEl: HTMLElement | null;
  infoTitleEl: HTMLElement | null;
  intelBadgeEl: HTMLElement | null;
  hideCoreInfoRows: () => void;
  showCoreInfoRows: () => void;
  clearOtherSelections: () => void;
};

const OSM_EMPTY_DATASET: EarthCamDataset = {
  cameras: [],
  attribution:
    "© OpenStreetMap contributors — EarthCam webcams (viewport Overpass; pan to discover; ODbL).",
  licenseNote: "https://www.openstreetmap.org/copyright",
  providerId: "osm-overpass"
};

function fillSelect(
  el: HTMLSelectElement | null,
  values: string[],
  allLabel: string
): void {
  if (!el) return;
  const prev = el.value;
  el.innerHTML = "";
  const all = document.createElement("option");
  all.value = "__all__";
  all.textContent = allLabel;
  el.appendChild(all);
  for (const v of values) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  }
  if ([...el.options].some((o) => o.value === prev)) el.value = prev;
}

/**
 * Wires EarthCam provider → layer → Orbit UI (toggle, filters, intel panel).
 * Default source: EarthCam network catalog (~280 sites) + optional OSM viewport merge. Static JSON: `VITE_EARTHCAM_ADAPTER=static`.
 */
export class EarthCamController {
  readonly layer: EarthCamLayer;
  private visible = false;
  private loading = false;
  private error: string | null = null;
  private dataset: EarthCamDataset | null = null;
  private detailState: EarthCamDetailState = "idle";
  private selectedCamera: EarthCamCamera | null = null;
  private hoveredEntityId: string | null = null;
  private readonly useCctv = shouldLoadEarthcamViaCctv();
  private readonly useOsmViewport = shouldLoadEarthcamViaOsm();
  private readonly useNetworkCatalog = shouldLoadEarthcamViaNetwork();
  private readonly provider: EarthCamProvider | null;
  private readonly osmCameraCache = new Map<string, EarthCamCamera>();
  private viewportDebounce: ReturnType<typeof setTimeout> | null = null;
  private viewportAbort: AbortController | null = null;
  private viewportLoading = false;
  private viewportHint: string | null = null;

  private cctvDebounce: ReturnType<typeof setTimeout> | null = null;
  private cctvAbort: AbortController | null = null;
  private cctvRepoll: ReturnType<typeof setTimeout> | null = null;
  private cctvLastKey = "";
  private cctvIdSignature = "";
  private cctvTotal = 0;
  private cctvTruncated = false;
  private cctvSources: CctvSourceInfo[] = [];
  private frameTimer: number | null = null;

  constructor(
    private readonly viewer: Viewer,
    private readonly dom: EarthCamDomRefs,
    provider?: EarthCamProvider
  ) {
    this.provider =
      this.useOsmViewport || this.useCctv ? null : (provider ?? createEarthcamProviderFromEnv());
    this.layer = new EarthCamLayer(viewer, DEFAULT_EARTHCAM_FILTERS);
  }

  attach(): void {
    this.layer.attach();
    this.syncToggleLabel();
    this.syncModuleVisibility();
  }

  setupUi(): void {
    this.dom.toggleEl?.addEventListener("click", () => {
      void this.setVisible(!this.visible);
    });
    this.dom.searchInputEl?.addEventListener("input", () => this.applyFiltersFromDom());
    this.dom.countryEl?.addEventListener("change", () => this.applyFiltersFromDom());
    this.dom.cityEl?.addEventListener("change", () => this.applyFiltersFromDom());
    this.dom.categoryEl?.addEventListener("change", () => this.applyFiltersFromDom());
    this.dom.statusFilterEl?.addEventListener("change", () => this.applyFiltersFromDom());
    this.dom.viewportOnlyEl?.addEventListener("change", () => this.applyFiltersFromDom());
    this.dom.viewAllBtnEl?.addEventListener("click", () => {
      this.layer.flyToAllFilteredCameras();
    });
    this.dom.flyBtnEl?.addEventListener("click", () => {
      if (this.selectedCamera) void this.flyToCamera(this.selectedCamera);
    });
    this.dom.liveBtnEl?.addEventListener("click", () => {
      if (this.selectedCamera) this.openCameraLive(this.selectedCamera);
    });
  }

  /** Plays a camera in the floating live window (video when the agency publishes it, otherwise a refreshing still). */
  openCameraLive(cam: EarthCamCamera): void {
    openLiveViewer(cam, { onShowOnGlobe: (c) => void this.flyToCamera(c) });
  }

  /** Flies the globe to a camera without needing its marker to be loaded. */
  showCameraOnGlobe(cam: EarthCamCamera): Promise<void> {
    return this.flyToCamera(cam);
  }

  private initOsmDatasetShell(): void {
    this.dataset = { ...OSM_EMPTY_DATASET, cameras: [...this.osmCameraCache.values()] };
    this.layer.setDataset(this.dataset);
    this.syncFilterSelects();
  }

  private applyOsmCacheToLayer(): void {
    if (!this.dataset) this.initOsmDatasetShell();
    else {
      this.dataset = { ...this.dataset, cameras: [...this.osmCameraCache.values()] };
      this.layer.setDataset(this.dataset);
      this.syncFilterSelects();
    }
  }

  private mergeOsmCameras(incoming: EarthCamCamera[]): void {
    for (const cam of incoming) this.osmCameraCache.set(cam.id, cam);
    this.applyOsmCacheToLayer();
  }

  scheduleViewportRefresh(): void {
    if (!this.useOsmViewport || !this.visible || !this.layer.getOverlayVisible()) return;
    if (this.viewportDebounce) clearTimeout(this.viewportDebounce);
    this.viewportDebounce = setTimeout(() => {
      this.viewportDebounce = null;
      void this.runViewportFetch();
    }, 700);
  }

  private async runViewportFetch(): Promise<void> {
    if (!this.useOsmViewport || !this.visible || !this.layer.getOverlayVisible()) return;

    const built = buildViewportEarthcamOverpassQuery(this.viewer);
    if (!built.ok) {
      this.viewportHint = viewportEarthcamSkipMessage(built.reason);
      this.refreshStatusLine();
      return;
    }

    this.viewportHint = null;
    this.viewportAbort?.abort();
    this.viewportAbort = new AbortController();
    const { signal } = this.viewportAbort;
    this.viewportLoading = true;
    this.refreshStatusLine();

    try {
      const data = await postOverpassQl(
        getEarthcamOverpassInterpreterFromEnv(),
        built.query,
        signal
      );
      const ds = overpassJsonToEarthcamDataset(data);
      this.mergeOsmCameras(ds.cameras);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      console.warn("[earthcam] OSM viewport Overpass failed:", e);
      this.viewportHint = "Overpass request failed — check network or dev /overpass-proxy.";
    } finally {
      this.viewportLoading = false;
      this.refreshStatusLine();
      this.viewer.scene.requestRender();
    }
  }

  /** Viewport bounds (degrees) padded ~15% so small pans don't refetch; null when the camera isn't over the globe. */
  private paddedViewBounds(): ViewBounds | null {
    const rect = viewportRectangleForViewer(this.viewer);
    if (!rect) return null;
    const toDeg = (r: number): number => (r * 180) / Math.PI;
    let west = toDeg(rect.west);
    let east = toDeg(rect.east);
    const south = toDeg(rect.south);
    const north = toDeg(rect.north);
    const lonSpan = west <= east ? east - west : 360 - (west - east);
    const padLon = lonSpan * 0.15;
    const padLat = (north - south) * 0.15;
    const wrap = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180;
    west = lonSpan + 2 * padLon >= 360 ? -180 : wrap(west - padLon);
    east = lonSpan + 2 * padLon >= 360 ? 180 : wrap(east + padLon);
    return { west, east, south: Math.max(-90, south - padLat), north: Math.min(90, north + padLat) };
  }

  private scheduleCctvRefresh(): void {
    if (!this.useCctv || !this.visible) return;
    if (this.cctvDebounce) clearTimeout(this.cctvDebounce);
    this.cctvDebounce = setTimeout(() => {
      this.cctvDebounce = null;
      void this.refreshCctvViewport();
    }, 600);
  }

  private async refreshCctvViewport(force = false): Promise<void> {
    if (!this.useCctv || !this.visible) return;
    const b = this.paddedViewBounds();
    if (!b) {
      this.viewportHint = "Point the camera at the globe to load cameras.";
      this.refreshStatusLine();
      return;
    }
    const key = [b.west, b.south, b.east, b.north].map((v) => v.toFixed(1)).join(",");
    if (!force && key === this.cctvLastKey) return;
    this.cctvLastKey = key;

    this.cctvAbort?.abort();
    this.cctvAbort = new AbortController();
    const { signal } = this.cctvAbort;
    this.viewportLoading = true;
    this.error = null;
    this.refreshStatusLine();

    try {
      const res = await fetchCctvViewport(b, 1500, signal);
      this.cctvSources = res.sources;
      if (res.kind === "too-wide") {
        const labels = res.sources.map((s) => s.label);
        const shownNames = labels.slice(0, 6).join(" · ");
        this.viewportHint =
          `Zoom in to load cameras. Coverage includes ${shownNames}` +
          (labels.length > 6 ? ` and ${labels.length - 6} more regions` : "");
        this.cctvTotal = 0;
        this.cctvTruncated = false;
        this.applyCctvDataset([]);
        return;
      }
      this.viewportHint = null;
      this.cctvTotal = res.total;
      this.cctvTruncated = res.truncated;
      this.applyCctvDataset(res.cameras);
      if (res.loadingSources.length > 0) {
        if (this.cctvRepoll) clearTimeout(this.cctvRepoll);
        this.cctvRepoll = setTimeout(() => void this.refreshCctvViewport(true), 4000);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      console.warn("[cctv] viewport load failed:", e);
      this.error = e instanceof Error ? e.message : "Camera load failed";
    } finally {
      this.viewportLoading = false;
      this.refreshStatusLine();
      this.viewer.scene.requestRender();
    }
  }

  /** Replaces the camera set but skips the (costly) marker rebuild when the same cameras came back. */
  private applyCctvDataset(cameras: EarthCamCamera[]): void {
    const signature = cameras.map((c) => c.id).join("|");
    if (this.dataset && signature === this.cctvIdSignature) return;
    this.cctvIdSignature = signature;
    const attributions = [...new Set(this.cctvSources.filter((s) => s.count > 0).map((s) => s.attribution ?? s.label))];
    this.dataset = {
      cameras,
      attribution: attributions.join(" · ") || "Public agency traffic cameras",
      providerId: "cctv"
    };
    this.layer.setDataset(this.dataset, { keepSelection: true });
    this.syncFilterSelects();
  }

  private stopFrameRefresh(): void {
    if (this.frameTimer != null) {
      window.clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
  }

  private startFrameRefresh(cam: EarthCamCamera): void {
    this.stopFrameRefresh();
    if (!cam.frameUrl) return;
    const everyMs = Math.min(60, Math.max(10, cam.frameRefreshSec ?? 30)) * 1000;
    const stamp = (): void => {
      const t = new Date().toLocaleTimeString();
      this.setPanelStateMessage(
        `Live still image from ${cam.cameraSource} · fetched ${t} · refreshes about every ${Math.round(everyMs / 1000)} s`
      );
    };
    stamp();
    this.frameTimer = window.setInterval(() => {
      if (document.hidden || this.selectedCamera?.id !== cam.id) return;
      const probe = new Image();
      probe.onload = () => {
        if (this.selectedCamera?.id !== cam.id || !this.dom.thumbEl) return;
        this.dom.thumbEl.src = probe.src;
        this.dom.thumbEl.classList.remove("hidden");
        this.dom.thumbPlaceholderEl?.classList.add("hidden");
        stamp();
      };
      probe.src = `${cam.frameUrl}${cam.frameUrl!.includes("?") ? "&" : "?"}t=${Date.now()}`;
    }, everyMs);
  }

  async loadDataset(): Promise<void> {
    if (this.useCctv) {
      await this.refreshCctvViewport(true);
      return;
    }
    if (this.useOsmViewport || this.useNetworkCatalog) {
      this.loading = true;
      this.error = null;
      this.refreshStatusLine();
      if (this.useNetworkCatalog) {
        try {
          const network = await new EarthcamNetworkProvider().load();
          this.mergeOsmCameras(network.cameras);
        } catch (e) {
          console.warn("[earthcam] network catalog failed:", e);
        }
      }
      if (this.osmCameraCache.size === 0) {
        try {
          const seed = await new StaticEarthcamProvider().load();
          this.mergeOsmCameras(seed.cameras);
        } catch (e) {
          console.warn("[earthcam] seed fallback failed:", e);
          if (!this.useNetworkCatalog) {
            this.error = e instanceof Error ? e.message : "Load failed";
          }
        }
      }
      if (!this.dataset) this.initOsmDatasetShell();
      this.loading = false;
      if (this.osmCameraCache.size === 0 && !this.error) {
        this.error = "No cameras loaded — check network or use VITE_EARTHCAM_ADAPTER=static.";
      }
      if (this.useOsmViewport) this.scheduleViewportRefresh();
      this.refreshStatusLine();
      return;
    }

    if (!this.provider) return;
    this.loading = true;
    this.error = null;
    this.detailState = "loading";
    this.refreshStatusLine();
    try {
      const ds = await this.provider.load();
      this.dataset = ds;
      this.layer.setDataset(ds);
      this.syncFilterSelects();
      this.detailState = "idle";
    } catch (e) {
      console.warn("[earthcam] load failed:", e);
      this.error = e instanceof Error ? e.message : "Load failed";
      this.dataset = null;
      this.layer.setDataset(null);
      this.detailState = "error";
    } finally {
      this.loading = false;
      this.refreshStatusLine();
    }
  }

  async setVisible(on: boolean): Promise<void> {
    this.visible = on;
    this.layer.setOverlayVisible(on);
    this.syncToggleLabel();
    this.syncModuleVisibility();
    if (on && this.useCctv) {
      await this.refreshCctvViewport(true);
    } else if (on && !this.dataset && !this.loading) {
      await this.loadDataset();
    }
    if (on && this.useOsmViewport) {
      this.scheduleViewportRefresh();
    }
    if (!on) {
      this.selectCamera(null);
      this.cctvAbort?.abort();
      if (this.cctvDebounce) clearTimeout(this.cctvDebounce);
      if (this.cctvRepoll) clearTimeout(this.cctvRepoll);
      this.cctvLastKey = "";
    }
    this.viewer.scene.requestRender();
  }

  onCameraMoveEnd(): void {
    if (!this.visible) return;
    if (this.useCctv) {
      this.scheduleCctvRefresh();
      return;
    }
    if (this.useOsmViewport) {
      this.scheduleViewportRefresh();
      return;
    }
    if (this.layer.getFilters().viewportOnly) {
      this.layer.setFilters(this.layer.getFilters());
      this.refreshStatusLine();
    }
  }

  handlePick(entityId: string | null, clusteredEntities?: Entity[]): boolean {
    if (clusteredEntities?.length) {
      this.layer.flyToCluster(clusteredEntities);
      return true;
    }
    if (!entityId || !this.layer.isEarthcamPointEntityId(entityId)) return false;
    this.selectCamera(entityId);
    return true;
  }

  handleHover(entityId: string | null): void {
    const next =
      entityId && this.layer.isEarthcamPointEntityId(entityId) ? entityId : null;
    if (next === this.hoveredEntityId) return;
    this.hoveredEntityId = next;
    this.layer.setHoveredEntityId(next);
  }

  selectCamera(entityId: string | null): void {
    this.layer.setSelectedEntityId(entityId);
    if (!entityId) {
      this.stopFrameRefresh();
      this.selectedCamera = null;
      this.detailState = "idle";
      this.dom.panelBodyEl?.classList.add("hidden");
      this.dom.showCoreInfoRows();
      this.dom.satNameEl?.classList.remove("hidden");
      if (this.dom.intelBadgeEl) this.dom.intelBadgeEl.textContent = "SIGINT";
      this.clearEmbed();
      return;
    }

    const cam = this.layer.getCameraForPickId(entityId);
    if (!cam) return;

    this.dom.clearOtherSelections();
    this.selectedCamera = cam;
    this.dom.hideCoreInfoRows();
    this.dom.panelBodyEl?.classList.remove("hidden");
    this.dom.satNameEl?.classList.add("hidden");
    if (this.dom.intelBadgeEl) this.dom.intelBadgeEl.textContent = "LIVE CAM";
    if (this.dom.infoTitleEl) this.dom.infoTitleEl.textContent = "Observation";
    this.dom.satInfoEl?.classList.remove("hidden");
    this.fillPanel(cam);
    void this.flyToCamera(cam);
  }

  private async flyToCamera(cam: EarthCamCamera): Promise<void> {
    // Straight down, north up, close enough to read the view-range cone like a plan (owner, 2026-10-04).
    flyStraightDown(this.viewer, cam.longitude, cam.latitude, 600);
  }

  private fillPanel(cam: EarthCamCamera): void {
    const loc = [cam.city, cam.region, cam.country].filter(Boolean).join(", ") || "—";
    if (this.dom.panelHeadEl) this.dom.panelHeadEl.textContent = cam.name;
    if (this.dom.metaLocationEl) this.dom.metaLocationEl.textContent = loc;
    if (this.dom.metaCategoryEl) this.dom.metaCategoryEl.textContent = cam.category ?? "—";
    if (this.dom.metaStatusEl) {
      this.dom.metaStatusEl.textContent = cam.frameUrl ? "LIVE STILL" : cam.status.toUpperCase();
    }
    if (this.dom.metaSourceEl) this.dom.metaSourceEl.textContent = cam.cameraSource;
    if (this.dom.metaNotesEl) this.dom.metaNotesEl.textContent = cam.notes ?? "—";
    const view = cam.headingKind ? planCctvView({ headingDeg: cam.headingDeg ?? null, headingKind: cam.headingKind }) : null;
    if (this.dom.metaViewEl) this.dom.metaViewEl.textContent = view?.summary ?? "—";
    if (this.dom.viewNoteEl) this.dom.viewNoteEl.textContent = view?.detail ?? "";
    if (this.dom.metaAttribEl) {
      const attr = cam.attribution ?? this.dataset?.attribution ?? "—";
      const lic = cam.attribution ? undefined : this.dataset?.licenseNote;
      this.dom.metaAttribEl.textContent = lic ? `${attr} · ${lic}` : attr;
    }

    if (cam.thumbnail && this.dom.thumbEl) {
      this.dom.thumbEl.src = cam.thumbnail;
      this.dom.thumbEl.alt = cam.name;
      this.dom.thumbEl.classList.remove("hidden");
      this.dom.thumbEl.onerror = () => {
        this.dom.thumbEl?.classList.add("hidden");
        this.dom.thumbPlaceholderEl?.classList.remove("hidden");
      };
      this.dom.thumbPlaceholderEl?.classList.add("hidden");
    } else {
      this.dom.thumbEl?.classList.add("hidden");
      this.dom.thumbPlaceholderEl?.classList.remove("hidden");
    }

    if (this.dom.liveBtnEl) {
      this.dom.liveBtnEl.classList.toggle("hidden", !cam.frameUrl);
      this.dom.liveBtnEl.textContent = cam.videoUrl ? "Watch live video" : "Open live window";
    }
    this.dom.externalBtnEl?.setAttribute("href", cam.earthcamPageUrl || "#");
    this.dom.externalBtnEl?.classList.toggle("hidden", !cam.earthcamPageUrl);

    if (cam.frameUrl) {
      this.detailState = "ready";
      this.clearEmbed();
      this.startFrameRefresh(cam);
    } else if (canEmbedEarthCamStream(cam)) {
      this.detailState = "ready";
      this.dom.embedWrapEl?.classList.remove("hidden");
      this.dom.externalBtnEl?.classList.add("earthcam-external-secondary");
      if (this.dom.embedFrameEl && cam.streamUrl) {
        this.dom.embedFrameEl.src = cam.streamUrl;
      }
      this.setPanelStateMessage("Licensed embed stream");
    } else if (cam.status === "offline") {
      this.detailState = "unavailable";
      this.clearEmbed();
      this.setPanelStateMessage("Camera offline — metadata only");
    } else {
      this.detailState = "external-only";
      this.clearEmbed();
      this.setPanelStateMessage("Open on EarthCam for live view (embedding not licensed)");
    }
  }

  private clearEmbed(): void {
    this.dom.embedWrapEl?.classList.add("hidden");
    if (this.dom.embedFrameEl) this.dom.embedFrameEl.src = "about:blank";
    this.dom.externalBtnEl?.classList.remove("earthcam-external-secondary");
  }

  private setPanelStateMessage(msg: string): void {
    if (this.dom.panelStateEl) this.dom.panelStateEl.textContent = msg;
  }

  private readFiltersFromDom(): EarthCamFilterState {
    return {
      country: this.dom.countryEl?.value ?? "__all__",
      city: this.dom.cityEl?.value ?? "__all__",
      category: this.dom.categoryEl?.value ?? "__all__",
      status: this.dom.statusFilterEl?.value ?? "__all__",
      search: this.dom.searchInputEl?.value ?? "",
      viewportOnly: this.dom.viewportOnlyEl?.checked ?? false
    };
  }

  private applyFiltersFromDom(): void {
    this.layer.setFilters(this.readFiltersFromDom());
    const sel = this.layer.getSelectedEntityId();
    if (sel && !this.layer.getCameraForPickId(sel)) {
      this.selectCamera(null);
      this.dom.satInfoEl?.classList.add("hidden");
    }
    this.refreshStatusLine();
    this.viewer.scene.requestRender();
  }

  private syncFilterSelects(): void {
    const ds = this.dataset;
    if (!ds || ds.cameras.length === 0) {
      this.dom.filtersEl?.classList.add("hidden");
      return;
    }
    this.dom.filtersEl?.classList.remove("hidden");
    fillSelect(this.dom.countryEl, uniqueFieldValues(ds.cameras, "country"), "All countries");
    fillSelect(this.dom.cityEl, uniqueFieldValues(ds.cameras, "city"), "All cities");
    fillSelect(this.dom.categoryEl, uniqueFieldValues(ds.cameras, "category"), "All categories");
    fillSelect(this.dom.statusFilterEl, uniqueFieldValues(ds.cameras, "status"), "All statuses");
    this.layer.setFilters(this.readFiltersFromDom());
  }

  private refreshStatusLine(): void {
    if (!this.dom.statusEl) return;
    if (this.useCctv) {
      this.dom.statusEl.textContent = this.cctvStatusText();
      return;
    }
    if (this.useOsmViewport && this.viewportLoading) {
      this.dom.statusEl.textContent = "Loading OSM EarthCam webcams for current view…";
      return;
    }
    if (this.loading) {
      this.dom.statusEl.textContent = "Loading EarthCam catalog…";
      return;
    }
    if (this.error) {
      this.dom.statusEl.textContent = `EarthCam load failed: ${this.error}`;
      return;
    }
    const ds = this.dataset;
    if (!ds) {
      this.dom.statusEl.textContent = "No catalog — enable CAM · ON to load from OSM.";
      return;
    }
    const n = this.layer.filteredCameras().length;
    const total = ds.cameras.length;
    let line = this.useNetworkCatalog
      ? `Markers: ${n} / ${total} (EarthCam network)`
      : `Markers: ${n} / ${total} in catalog`;

    if (!this.visible) line += " · layer hidden";
    else if (n === 0) {
      const hint = this.viewportHint
        ? ` ${this.viewportHint}`
        : this.useOsmViewport
          ? " Zoom in and pan for supplemental OSM sites."
          : " · widen filters or disable viewport-only";
      line += hint;
    } else {
      if (this.useNetworkCatalog) line += " · pan for supplemental OSM tags";
      else line += " · rotate globe to see sites on the far side";
      if (n <= EARTHCAM_CLUSTERING_MIN_COUNT) line += " · individual markers (no clustering)";
    }
    if (this.layer.getFilters().viewportOnly) line += " · display filter: viewport-only ON";
    this.dom.statusEl.textContent = line;
  }

  private cctvStatusText(): string {
    if (this.error) return `Camera load failed: ${this.error}`;
    if (this.viewportLoading) {
      return "Loading live cameras for this view… (the first load of a region can take ~20 s)";
    }
    if (!this.visible) return "Layer hidden";
    if (this.viewportHint) return this.viewportHint;
    const n = this.layer.filteredCameras().length;
    if (n === 0) return `No agency cameras in this view. ${CCTV_COVERAGE_NOTE} Try Atlanta, London, Vancouver, Hong Kong or Auckland.`;
    const shown = this.cctvTruncated ? `nearest ${n} of ${this.cctvTotal}` : `${n}`;
    // Name only the agencies actually in view, not every source that happens to be loaded.
    const inView = new Set(this.layer.filteredCameras().map((c) => c.cameraSource));
    const names = [...inView];
    const who = names.length <= 3 ? names.join(" · ") : `${names.slice(0, 3).join(" · ")} +${names.length - 3} more`;
    return `Cameras in view: ${shown} · live still images from ${who} · ${CCTV_COVERAGE_NOTE}`;
  }

  private syncToggleLabel(): void {
    if (this.dom.toggleEl) {
      this.dom.toggleEl.textContent = this.visible ? "CAM · ON" : "CAM · OFF";
    }
  }

  private syncModuleVisibility(): void {
    this.dom.moduleEl?.classList.toggle("hidden", !this.visible);
  }

  isVisible(): boolean {
    return this.visible;
  }
}
