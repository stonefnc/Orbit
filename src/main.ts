import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import "./theme-apple.css";
import { mirrorToggleState } from "./themeState";
import { initAdaptiveLogo } from "./logo";
import { createFlyMode } from "./flyMode";
import { initExtraLayers } from "./layers";
import { createTracker, type TrackTarget } from "./tracking";
import { setupTouchControls } from "./touchControls";
import { setupMobileMenu } from "./mobileMenu";
import { createKeysPanel, storedKey } from "./settings";
import { mountCredits } from "./credits";
import { clearKeyHint, showKeyHint } from "./keyHints";
import { registerServiceWorker } from "./pwa";
import { applyImagery, createImageryPicker, savedImagery, type ImagerySource } from "./imagery";
import { horizonDepthTest } from "./horizon";
import { planAlprView } from "./viewRangePlan";
import { flyStraightDown } from "./flyDown";
import { applyPhoneRenderBudget, baseResolutionScale, isInteracting, isPhoneClass, onQualityChange, PHONE_SATELLITE_BUDGET } from "./mobilePerf";
import { clearManualLocation, geolocationBlockedReason, getManualLocation, INSECURE_LOCATION_MESSAGE, setManualLocation, type ManualLoc } from "./manualLocation";
import { buildPlaceFinder } from "./manualLocationUi";
import { enrichHit, searchGeocode, type GeoHit } from "./geocodeClient";
import { closeLayerCardByUser, isLayerCardOpen, setLayerCardUserCloseListener, showLayerCard } from "./layers/layerCard";
import type { LayerHost } from "./layers/layerHost";

/** Optional data layers (weather, events, infrastructure, utilities); set up once the page is ready. */
let layerHost: LayerHost | null = null;
/** The camera pose the app opened with, so closing a card can return to it. */
let homeView: { position: Cartesian3; direction: Cartesian3; up: Cartesian3 } | null = null;
let trackerRef: ReturnType<typeof createTracker> | null = null;
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Ellipsoid,
  HeightReference,
  Ion,
  JulianDate,
  Math as CesiumMath,
  ConstantPositionProperty,
  CustomDataSource,
  Entity,
  HorizontalOrigin,
  DistanceDisplayCondition,
  LabelStyle,
  NearFarScalar,
  PerspectiveFrustum,
  PolylineGlowMaterialProperty,
  BoundingSphere,
  HeadingPitchRange,
  Rectangle,
  RequestScheduler,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  Viewer,
  createWorldTerrainAsync,
  Cesium3DTileset,
  ClassificationType,
  Matrix4
} from "cesium";
import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate, twoline2satrec } from "satellite.js";
import { fetchActiveSatellites, getSatCatalogNote, Satellite } from "./providers/celestrak";
import { fetchN2YoSatelliteDetails } from "./providers/n2yo";
import {
  fetchKeepTrackCelestrakMirrorSatellites,
  fetchKeepTrackMergedCatalog,
  keepTrackAvailable
} from "./providers/keeptrack";
import { sanitizeCallsign } from "./providers/adsbfi";
import { aviationstackRouteForAirlineAircraft } from "./providers/aviationstackRealtime";
import { fetchOpenSkyEstimatedAirports, openSkyFlightWindowNow } from "./providers/openskyFlights";
import {
  classifyInputFromNormalized,
  fetchAggregatedAircraft,
  fetchAircraftModelGallery,
  fetchAircraftPhotoMeta,
  fetchFlightRoute
} from "./providers/planeApi";
import type { FlightRouteAirport, NormalizedAircraft } from "../shared/planeContract";
import { angleDiffDeg, arrivalClock, bearingDeg, formatDuration, haversineNm, routeProgress } from "./routeMath";
import { geocodePlace, type PlaceHit } from "./providers/placeGeocode";
import {
  type AirportApiOverlay,
  airportRecordForIcao,
  ensureAirportsLoaded,
  formatAirportSidebar,
  icaoFromIata
} from "./airportLookup";
import {
  destinationFromBearingNm,
  filedRouteGlowColor,
  greatCircleCartesians,
  trackProjectionDashMaterial
} from "./planeRouteGeometry";
import { airlineFromFlightId, airlinePrefixesForName, ensureAirlinePrefixesLoaded } from "./airlineCallsignLookup";
import { searchAlpr, searchPlanesLocal, searchSatellites, type AlprGroup } from "./globalSearch";
import { airlineLinksFor } from "./providers/airlineLinks";
import {
  fetchLiveNotables,
  listNotables,
  loadNotableAircraft,
  notableFor,
  registerNotable,
  type LiveNotable
} from "./notableAircraft";
import {
  classifyAircraftTraffic,
  flightIdLooksScheduledAirlineStyle,
  planeTrafficColorCss,
  type PlaneTrafficKind
} from "./planeTrafficClass";
import { planeIconUrl, planeShapeFor } from "./planeIcons";
import { fetchCamerasNear } from "./earthcam/cctvClient";
import type { EarthCamCamera } from "./earthcam/earthcamTypes";
import {
  flightradar24CompareUrl,
  formatPlaneSearchLine,
  sortedPlaneSearchHits
} from "./planeSearch";
import { AlprLayerController } from "./alpr/alprLayerController";
import { slugAlprEntityId, type AlprDataset, type AlprSite } from "./alpr/alprTypes";
import { createAlprAdapterFromEnv, shouldLoadAlprViaViewport } from "./alpr/createAlprAdapter";
import { fetchAlprBox } from "./alpr/alprApi";
import { ALPR_KIND_LABEL, alprIconUri, alprKindForVendor, type AlprKind } from "./alpr/alprIcons";
import {
  architectLineFromExtratags,
  nominatimWikipediaBrowseUrl,
  placeAddressLine,
  placeCategoryLine,
  placeExtraTagRows,
  searchNominatimPlaces,
  wikidataBrowseUrl,
  type NominatimHit
} from "./alpr/nominatimSearch";
import { fetchWikipediaPageSummary, parseWikipediaTag } from "./wikipediaSummary";
import { fetchArchitectLabelsFromWikidata } from "./wikidataArchitect";
import { createAisStreamClient, postAisSubscription } from "./providers/aisStreamClient";
import type { VesselClientRow, VesselSnapshotMessage, VesselStatusMessage } from "../shared/vesselContract";
import { DatacenterLayerController } from "./datacenter/datacenterLayerController";
import type { DatacenterDataset, DatacenterSite } from "./datacenter/datacenterTypes";
import { fetchDatacenterBox } from "./datacenter/datacenterApi";
import { EarthCamController } from "./earthcam/EarthCamController";
import { getSatCache, hydrateSatCache, putSatCache, satCacheAgeMs } from "./satCache";

const SAT_CACHE_LOG_KEY = "orbit_satellite_cache_logs_v1";
const MAX_VISIBLE_SATELLITES_IN_VIEW = 999;
/** Keep plane dots briefly after a missed API poll to reduce flicker from sparse ADS-B coverage. */
const PLANE_TRACK_STALE_MS = 95_000;
/** How often cache age is *checked* (cheap, in-memory). */
const CACHE_REFRESH_MS = 10 * 60_000;
/** CelesTrak republishes element sets roughly every 2 h and throttles clients that fetch more often. */
const SAT_CATALOG_TTL_MS = 2 * 60 * 60_000;
const SAT_PARTIAL_RETRY_MS = 10 * 60_000;
const CACHE_LOG_RETENTION_MS = 20 * 24 * 60 * 60 * 1000;
/** Minimum interval between aggregated plane API polls (the server merges adsb.lol, then adsb.fi, then airplanes.live, plus optional OpenSky and ADS-B Exchange). */
const PLANE_POLL_MIN_MS = (() => {
  const raw = import.meta.env.VITE_PLANE_POLL_MS as string | undefined;
  if (raw && /^\d+$/.test(raw.trim())) return Math.max(2000, Number(raw.trim()));
  return 5000;
})();
/** Tick rate for dead-reckoning aircraft between polls. */
const PLANE_ADVANCE_MS = 250;
/** A camera move this far (km) triggers a fetch even inside the poll window, so panning stays responsive. */
const PLANE_REFETCH_MOVE_KM = 40;
let lastPlaneProviderSummary = "";
// A token pasted into the Keys menu (kept in this browser) wins over the one in .env.local.
const token: string | undefined = storedKey("cesium") || import.meta.env.VITE_CESIUM_ION_TOKEN;
/** Cesium ion's "Google Photorealistic 3D Tiles" asset; any ion token can stream it. Override via VITE_PHOTOREALISTIC_3D_ASSET_ID. */
const DEFAULT_PHOTOREALISTIC_ASSET_ID = 2275207;
const photorealisticAssetId = Number(
  (import.meta.env.VITE_PHOTOREALISTIC_3D_ASSET_ID as string | undefined)?.trim() || DEFAULT_PHOTOREALISTIC_ASSET_ID
);
const hasPhotorealisticAssetId = Number.isFinite(photorealisticAssetId) && photorealisticAssetId > 0;
// The N2YO key lives only in this browser (Keys menu); the KeepTrack key lives only on the server.
const n2yoApiKey = storedKey("n2yo");
if (token) {
  Ion.defaultAccessToken = token;
}

const globe = document.getElementById("globe");
if (!globe) {
  throw new Error("Missing #globe");
}

const statusEl = document.getElementById("status");
const toggleSatellitesEl = document.getElementById("toggle-satellites");
const togglePlanesEl = document.getElementById("toggle-planes");
const toggleVesselsEl = document.getElementById("toggle-vessels");
const togglePhotorealistic3dEl = document.getElementById("toggle-photorealistic-3d") as HTMLButtonElement | null;
const planeFilterControlsEl = document.getElementById("plane-filter-controls");
const aircraftFiltersModuleEl = document.getElementById("aircraft-filters-module");
const alprControlModuleEl = document.getElementById("alpr-control-module");
const planeFilterAirlineEl = document.getElementById("plane-filter-airline");
const planeFilterBizjetEl = document.getElementById("plane-filter-bizjet");
const planeFilterOtherEl = document.getElementById("plane-filter-other");
const planeFilterMilitaryEl = document.getElementById("plane-filter-military");
const sourceControlsEl = document.getElementById("source-controls");
const sourceKeepTrackEl = document.getElementById("source-keeptrack");
const sourceCelestrakEl = document.getElementById("source-celestrak");
const sourceShowAllEl = document.getElementById("source-show-all");
const satInfoEl = document.getElementById("sat-info");
const satNameEl = document.getElementById("sat-name");
const satOperatorEl = document.getElementById("sat-operator");
const satCountryEl = document.getElementById("sat-country");
const satSpeedEl = document.getElementById("sat-speed");
const satPurposeEl = document.getElementById("sat-purpose");
const satSourceEl = document.getElementById("sat-source");
const satOrbitRowsEl = document.getElementById("sat-orbit-rows");
const infoTitleEl = document.getElementById("info-title");
const infoL1El = document.getElementById("info-l1");
const infoL2El = document.getElementById("info-l2");
const infoL3El = document.getElementById("info-l3");
const infoL4El = document.getElementById("info-l4");
const infoL5El = document.getElementById("info-l5");
const planeRouteBlockEl = document.getElementById("plane-route-block");
const satRouteFromEl = document.getElementById("sat-route-from");
const satRouteToEl = document.getElementById("sat-route-to");
const satTrafficKindEl = document.getElementById("sat-traffic-kind");
const satFlightCarrierGuessEl = document.getElementById("sat-flight-carrier-guess");
const planeAviationstackHintRowEl = document.getElementById("plane-aviationstack-hint-row");
const satAviationstackHintEl = document.getElementById("sat-aviationstack-hint");
const planeInfoPhotoEl = document.getElementById("plane-info-photo") as HTMLImageElement | null;
const planeInfoSilhouetteEl = document.getElementById("plane-info-silhouette");
const planeInfoAttribEl = document.getElementById("plane-info-attrib");
const planeModelGalleryHintEl = document.getElementById("plane-model-gallery-hint");
const planeModelGalleryEl = document.getElementById("plane-model-gallery");
const planeExtraRowsEl = document.getElementById("plane-extra-rows");
const satInfoCoreEl = document.getElementById("sat-info-core");
const alprPanelBodyEl = document.getElementById("alpr-panel-body");
const intelCardModeBadgeEl = document.getElementById("intel-card-mode-badge");
const alprSensorHeadEl = document.getElementById("alpr-sensor-head");
const alprMetaIdEl = document.getElementById("alpr-meta-id");
const alprMetaNameEl = document.getElementById("alpr-meta-name");
const alprMetaSourceEl = document.getElementById("alpr-meta-source");
const alprMetaVendorEl = document.getElementById("alpr-meta-vendor");
const alprMetaRegionEl = document.getElementById("alpr-meta-region");
const alprMetaConfidenceEl = document.getElementById("alpr-meta-confidence");
const alprMetaBearingEl = document.getElementById("alpr-meta-bearing");
const alprViewNoteEl = document.getElementById("alpr-view-note");
const alprMetaViewEl = document.getElementById("alpr-meta-view");
const alprMetaNotesEl = document.getElementById("alpr-meta-notes");
const alprMetaAttribEl = document.getElementById("alpr-meta-attrib");
const placeInfoPanelEl = document.getElementById("place-info-panel");
const placeInfoHeadlineEl = document.getElementById("place-info-headline");
const placeInfoCategoryEl = document.getElementById("place-info-category");
const placeInfoAddressEl = document.getElementById("place-info-address");
const placeInfoArchitectRowEl = document.getElementById("place-info-architect-row");
const placeInfoArchitectEl = document.getElementById("place-info-architect");
const placeInfoTagRowsEl = document.getElementById("place-info-tag-rows");
const placeInfoWikiSectionEl = document.getElementById("place-info-wikipedia-section");
const placeInfoWikiLeadRowEl = document.getElementById("place-info-wiki-lead-row");
const placeInfoWikiLeadEl = document.getElementById("place-info-wiki-lead");
const placeInfoWikiArticleRowEl = document.getElementById("place-info-wiki-article-row");
const placeInfoCoordsEl = document.getElementById("place-info-coords");
const placeInfoOsmLinkEl = document.getElementById("place-info-osm-link") as HTMLAnchorElement | null;
const placeInfoWikipediaLinkEl = document.getElementById("place-info-wikipedia-link") as HTMLAnchorElement | null;
const placeInfoWikidataRowEl = document.getElementById("place-info-wikidata-row");
const placeInfoWikidataLinkEl = document.getElementById("place-info-wikidata-link") as HTMLAnchorElement | null;
const vesselPanelBodyEl = document.getElementById("vessel-panel-body");
const vesselDisplayHeadEl = document.getElementById("vessel-display-head");
const vesselMmsiEl = document.getElementById("vessel-mmsi");
const vesselNameEl = document.getElementById("vessel-name");
const vesselCallEl = document.getElementById("vessel-call");
const vesselSogEl = document.getElementById("vessel-sog");
const vesselCogEl = document.getElementById("vessel-cog");
const vesselHeadingEl = document.getElementById("vessel-heading");
const vesselNavEl = document.getElementById("vessel-nav");
const vesselDestEl = document.getElementById("vessel-dest");
const vesselDepEl = document.getElementById("vessel-dep");
const vesselEtaEl = document.getElementById("vessel-eta");
const vesselImoEl = document.getElementById("vessel-imo");
const vesselTypeEl = document.getElementById("vessel-type");
const vesselSourceEl = document.getElementById("vessel-source");
const vesselKickerEl = document.getElementById("vessel-kicker");
const vesselExtraRowsEl = document.getElementById("vessel-extra-rows");
const vesselRouteBlockEl = document.getElementById("vessel-route-block");
const vesselRouteFromEl = document.getElementById("vessel-route-from");
const vesselRouteToEl = document.getElementById("vessel-route-to");
const toggleAlprEl = document.getElementById("toggle-alpr");
const toggleDatacentersEl = document.getElementById("toggle-datacenters");
const datacenterControlModuleEl = document.getElementById("datacenter-control-module");
const datacenterDatasetStatusEl = document.getElementById("datacenter-dataset-status");
const datacenterFiltersEl = document.getElementById("datacenter-filters");
const datacenterFilterOperatorEl = document.getElementById(
  "datacenter-filter-operator"
) as HTMLSelectElement | null;
const datacenterPanelBodyEl = document.getElementById("datacenter-panel-body");
const datacenterDisplayHeadEl = document.getElementById("datacenter-display-head");
const datacenterMetaOsmEl = document.getElementById("datacenter-meta-osm");
const datacenterMetaNameEl = document.getElementById("datacenter-meta-name");
const datacenterMetaOperatorEl = document.getElementById("datacenter-meta-operator");
const datacenterMetaOwnerEl = document.getElementById("datacenter-meta-owner");
const datacenterMetaRefEl = document.getElementById("datacenter-meta-ref");
const datacenterMetaTagsEl = document.getElementById("datacenter-meta-tags");
const datacenterMetaRegionEl = document.getElementById("datacenter-meta-region");
const datacenterMetaNotesEl = document.getElementById("datacenter-meta-notes");
const datacenterMetaOsmLinkEl = document.getElementById("datacenter-meta-osm-link") as HTMLAnchorElement | null;
const datacenterMetaAttribEl = document.getElementById("datacenter-meta-attrib");
const toggleEarthcamEl = document.getElementById("toggle-earthcam") as HTMLButtonElement | null;
const earthcamControlModuleEl = document.getElementById("earthcam-control-module");
const earthcamDatasetStatusEl = document.getElementById("earthcam-dataset-status");
const earthcamFiltersEl = document.getElementById("earthcam-filters");
const earthcamSearchInputEl = document.getElementById("earthcam-search-input") as HTMLInputElement | null;
const earthcamFilterCountryEl = document.getElementById("earthcam-filter-country") as HTMLSelectElement | null;
const earthcamFilterCityEl = document.getElementById("earthcam-filter-city") as HTMLSelectElement | null;
const earthcamFilterCategoryEl = document.getElementById("earthcam-filter-category") as HTMLSelectElement | null;
const earthcamFilterStatusEl = document.getElementById("earthcam-filter-status") as HTMLSelectElement | null;
const earthcamViewportOnlyEl = document.getElementById("earthcam-viewport-only") as HTMLInputElement | null;
const earthcamViewAllBtnEl = document.getElementById("earthcam-view-all-btn") as HTMLButtonElement | null;
const earthcamPanelBodyEl = document.getElementById("earthcam-panel-body");
const earthcamPanelStateEl = document.getElementById("earthcam-panel-state");
const earthcamDisplayHeadEl = document.getElementById("earthcam-display-head");
const earthcamThumbEl = document.getElementById("earthcam-thumb") as HTMLImageElement | null;
const earthcamThumbPlaceholderEl = document.getElementById("earthcam-thumb-placeholder");
const earthcamEmbedWrapEl = document.getElementById("earthcam-embed-wrap");
const earthcamEmbedFrameEl = document.getElementById("earthcam-embed-frame") as HTMLIFrameElement | null;
const earthcamExternalBtnEl = document.getElementById("earthcam-external-btn") as HTMLAnchorElement | null;
const earthcamFlyBtnEl = document.getElementById("earthcam-fly-btn") as HTMLButtonElement | null;
const earthcamMetaLocationEl = document.getElementById("earthcam-meta-location");
const earthcamMetaCategoryEl = document.getElementById("earthcam-meta-category");
const earthcamMetaStatusEl = document.getElementById("earthcam-meta-status");
const earthcamMetaSourceEl = document.getElementById("earthcam-meta-source");
const earthcamMetaNotesEl = document.getElementById("earthcam-meta-notes");
const earthcamViewNoteEl = document.getElementById("earthcam-view-note");
const earthcamMetaViewEl = document.getElementById("earthcam-meta-view");
const earthcamMetaAttribEl = document.getElementById("earthcam-meta-attrib");
const alprDatasetStatusEl = document.getElementById("alpr-dataset-status");
const alprFiltersEl = document.getElementById("alpr-filters");
const alprFilterSourceEl = document.getElementById("alpr-filter-source") as HTMLSelectElement | null;
const alprFilterVendorEl = document.getElementById("alpr-filter-vendor") as HTMLSelectElement | null;
const alprFilterRegionEl = document.getElementById("alpr-filter-region") as HTMLSelectElement | null;
let planeSidebarPhotoSeq = 0;
let alprVisible = false;
let hoveredAlprEntityId: string | null = null;
let lastAlprDataset: AlprDataset | null = null;
let datacentersVisible = false;
let hoveredDatacenterEntityId: string | null = null;
let hoveredEarthcamEntityId: string | null = null;
let lastDatacenterDataset: DatacenterDataset | null = null;
let datacenterViewportHint: string | null = null;
let datacenterViewportLoading = false;
let datacenterViewportDebounce: ReturnType<typeof setTimeout> | null = null;
let datacenterViewportAbort: AbortController | null = null;
let alprViewportHint: string | null = null;
let alprViewportLoading = false;
let alprViewportDebounce: ReturnType<typeof setTimeout> | null = null;
let alprViewportAbort: AbortController | null = null;

/** Off-screen mount for Cesium/Ion credits (required by API; keeps Upgrade/Use/logo off the map). */
const cesiumCreditSink = document.createElement("div");
cesiumCreditSink.setAttribute("aria-hidden", "true");
cesiumCreditSink.style.cssText =
  "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
(globe.closest("#app") ?? document.body).appendChild(cesiumCreditSink);

const viewer = new Viewer(globe, {
  animation: false,
  timeline: false,
  baseLayerPicker: false,
  geocoder: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  homeButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  creditContainer: cesiumCreditSink,
  // No default imagery: Cesium would fetch ion's World Imagery with its own built-in token (rejected with a 401 on a
  // clean install) and `applyImagery` replaces it right away anyway.
  baseLayer: false,
  // Render only when something changed (camera, tiles, data) instead of 60 fps forever; every data
  // update path below calls scene.requestRender(). The clock never animates here.
  requestRenderMode: true,
  maximumRenderTimeChange: Number.POSITIVE_INFINITY
});

setupTouchControls(viewer);
applyPhoneRenderBudget(viewer);

/** The imagery source in use (the Imagery picker in the menu can swap it; it falls back automatically if one fails). */
const hasIonToken = !!token?.trim();
let imagerySource: ImagerySource = savedImagery(hasIonToken);

async function applyGlobeImagery(): Promise<void> {
  imagerySource = await applyImagery(viewer, imagerySource, hasIonToken);
}

/**
 * true  = realistic day/night terminator (the night side of the Earth renders almost black).
 * false = the whole globe is always lit, so imagery never "disappears" when you rotate to the night side.
 */
const GLOBE_DAY_NIGHT_SHADING = false;

async function configureGlobeVisuals(): Promise<void> {
  const scene = viewer.scene;
  scene.globe.show = true;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.backgroundColor = Color.fromCssColorString("#050608");
  scene.globe.baseColor = Color.fromCssColorString("#1b2f4a");

  // Imagery and terrain are set up at the same time and the app does not wait for either: the globe appears at once
  // in its base colour and fills in as each arrives (they used to be fetched one after the other, and the rest of
  // start-up waited for both).
  const imagery = applyGlobeImagery();
  const terrain = token
    ? createWorldTerrainAsync()
        .then((provider) => {
          viewer.terrainProvider = provider;
          scene.globe.enableLighting = GLOBE_DAY_NIGHT_SHADING;
        })
        .catch((error) => console.error("World terrain unavailable, using ellipsoid terrain:", error))
    : Promise.resolve();
  void Promise.all([imagery, terrain]).then(() => {
    performance.mark("orbit:globe-sources-ready");
    scene.requestRender();
  });

  viewer.resize();
  scene.requestRender();
}

/** Photorealistic 3D tiles (Cesium ion) — loaded lazily the first time 3D PHOTO is switched on. */
let photorealisticTileset: Cesium3DTileset | null = null;
let photorealistic3dVisible = false;
let photorealisticLoadPromise: Promise<Cesium3DTileset | null> | null = null;

/** Parallel downloads per host: Cesium's own default on a desktop, more on a phone (its servers speak HTTP/2, so extra requests share one connection and hide the round-trip delay of mobile networks). */
const BASE_REQUESTS_PER_SERVER = isPhoneClass() ? 24 : RequestScheduler.maximumRequestsPerServer;
RequestScheduler.maximumRequestsPerServer = BASE_REQUESTS_PER_SERVER;

/** Level of detail for a 3D tileset: a desktop gets the fine setting, a phone a coarser one, both easing off while flying. */
function tuneTileset(ts: Cesium3DTileset, flying: boolean): void {
  const phone = isPhoneClass();
  const MB = 1_024 * 1_024;
  // A phone: detailed when still, coarse while moving (the picture sharpens a moment after you let go).
  ts.maximumScreenSpaceError = phone ? (flying ? 56 : isInteracting() ? 40 : 16) : flying ? 24 : 16;
  ts.dynamicScreenSpaceError = phone || flying;
  ts.foveatedScreenSpaceError = true;
  // On a phone, drop requests for tiles that slide off screen while panning, and paint a coarse first pass sooner.
  ts.cullRequestsWhileMovingMultiplier = phone ? 200 : 60;
  ts.progressiveResolutionHeightFraction = phone ? 0.2 : 0.3;
  ts.cacheBytes = (phone ? (flying ? 256 : 160) : flying ? 1_024 : 512) * MB;
  ts.maximumCacheOverflowBytes = (phone ? 64 : flying ? 512 : 128) * MB;
}

/** Free-flight camera for exploring the 3D layers at street level (see flyMode.ts). */
const flyMode = createFlyMode(viewer, {
  onChange: (active) => {
    document.getElementById("fly-hint")?.classList.toggle("hidden", !active);
    const btn = document.getElementById("fly-mode-btn");
    if (btn) {
      btn.classList.toggle("is-on", active);
      btn.setAttribute("aria-pressed", String(active));
      btn.title = active ? "Exit fly mode (Esc)" : "Fly freely through the 3D city (F)";
    }
    syncFlyButton();
  },
  onFlying: (flying) => {
    // Smoothness while flying: stream tiles over more parallel connections and accept slightly coarser detail,
    // spending it first on the edges of the screen and the distance. Restored on exit.
    RequestScheduler.maximumRequestsPerServer = flying ? 24 : BASE_REQUESTS_PER_SERVER;
    // Cheaper pixels while moving: a slightly lower render resolution and no FXAA pass buy a lot of frame rate on
    // integrated GPUs, and motion hides the softness.
    viewer.resolutionScale = baseResolutionScale() * (flying ? 0.8 : 1);
    viewer.scene.postProcessStages.fxaa.enabled = !flying && !isPhoneClass();
    if (photorealisticTileset) tuneTileset(photorealisticTileset, flying);
  },
  onStats: ({ aglM, speedMs }) => {
    const el = document.getElementById("fly-stats");
    if (el) el.textContent = `${Math.round(aglM)} m above ground · ${Math.round(speedMs * 3.6)} km/h`;
  }
});

// Keep the 3D photo tiles in step with the phone's two quality levels (sharp at rest, light while moving).
onQualityChange(() => {
  if (photorealisticTileset) tuneTileset(photorealisticTileset, flyMode.isActive());
});

function syncFlyButton(): void {
  const wrap = document.getElementById("fly-mode");
  if (!wrap) return;
  const available = photorealistic3dVisible || flyMode.isActive();
  wrap.classList.toggle("hidden", !available);
  // The Fly mode icon lives in the top bar and only shows while 3D photo mode is on.
  document.getElementById("fly-mode-btn")?.classList.toggle("is-unavailable", !available);
}

document.getElementById("fly-mode-btn")?.addEventListener("click", () => flyMode.toggle());
window.addEventListener("keydown", (e) => {
  if (e.code !== "KeyF" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (flyMode.isActive()) return; // fly mode handles its own exit
  if (photorealistic3dVisible) flyMode.toggle();
});

function syncPhotorealistic3dToggleLabel(): void {
  syncFlyButton();
  if (!togglePhotorealistic3dEl) return;
  if (!token?.trim()) {
    togglePhotorealistic3dEl.textContent = "3D PHOTO · N/A";
    togglePhotorealistic3dEl.disabled = true;
    togglePhotorealistic3dEl.title = "Needs a free Cesium ion token: paste it in the Keys menu";
    return;
  }
  if (!hasPhotorealisticAssetId) {
    togglePhotorealistic3dEl.textContent = "3D PHOTO · CFG";
    togglePhotorealistic3dEl.disabled = true;
    togglePhotorealistic3dEl.title = "Set VITE_PHOTOREALISTIC_3D_ASSET_ID in .env.local";
    return;
  }
  togglePhotorealistic3dEl.disabled = photorealisticLoadPromise !== null && !photorealisticTileset;
  togglePhotorealistic3dEl.title = photorealistic3dVisible
    ? "Hide photorealistic 3D tiles"
    : "Show photorealistic 3D tiles";
  togglePhotorealistic3dEl.textContent = photorealistic3dVisible ? "3D PHOTO · ON" : "3D PHOTO · OFF";
}

async function ensurePhotorealisticTileset(): Promise<Cesium3DTileset | null> {
  if (!token?.trim() || !hasPhotorealisticAssetId) return null;
  if (photorealisticTileset) return photorealisticTileset;
  if (photorealisticLoadPromise) return photorealisticLoadPromise;

  photorealisticLoadPromise = Cesium3DTileset.fromIonAssetId(photorealisticAssetId)
    .then((tileset) => {
      tileset.show = photorealistic3dVisible;
      tuneTileset(tileset, false);
      viewer.scene.primitives.add(tileset);
      photorealisticTileset = tileset;
      return tileset;
    })
    .catch((e) => {
      console.error("[photorealistic3d] Failed to load ion tileset:", e);
      return null;
    })
    .finally(() => {
      photorealisticLoadPromise = null;
      syncPhotorealistic3dToggleLabel();
    });

  return photorealisticLoadPromise;
}

async function setPhotorealistic3dVisible(on: boolean): Promise<void> {
  if (!token?.trim() || !hasPhotorealisticAssetId) {
    console.warn("[photorealistic3d] Missing token or VITE_PHOTOREALISTIC_3D_ASSET_ID.");
    return;
  }
  photorealistic3dVisible = on;
  syncPhotorealistic3dToggleLabel();
  if (on) {
    const tileset = await ensurePhotorealisticTileset();
    if (tileset) {
      tileset.show = true;
    } else {
      photorealistic3dVisible = false;
      syncPhotorealistic3dToggleLabel();
    }
  } else if (photorealisticTileset) {
    photorealisticTileset.show = false;
  }
  viewer.scene.requestRender();
}

function setupPhotorealistic3dToggle(): void {
  syncPhotorealistic3dToggleLabel();
  togglePhotorealistic3dEl?.addEventListener("click", () => {
    if (!token?.trim() || togglePhotorealistic3dEl?.disabled) return;
    void setPhotorealistic3dVisible(!photorealistic3dVisible);
  });
}

const satellitesDataSource = new CustomDataSource("satellites");
void viewer.dataSources.add(satellitesDataSource);
satellitesDataSource.show = false;

const alprLayer = new AlprLayerController(viewer);
alprLayer.attach();
const datacenterLayer = new DatacenterLayerController(viewer);
datacenterLayer.attach();

function clearOtherGlobeSelectionsForEarthcam(): void {
  alprLayer.setSelectedEntityId(null);
  hideAlprDetailRows();
  datacenterLayer.setSelectedEntityId(null);
  hideDatacenterDetailRows();
  clearVesselSelectionQuietly();
  clearPlaneSelection();
  clearSatelliteSelectionQuietly();
  placeInfoPanelEl?.classList.add("hidden");
  resetPlaceInfoPanelDom();
}

const earthCamController = new EarthCamController(viewer, {
  toggleEl: toggleEarthcamEl,
  moduleEl: earthcamControlModuleEl,
  statusEl: earthcamDatasetStatusEl,
  filtersEl: earthcamFiltersEl,
  searchInputEl: earthcamSearchInputEl,
  countryEl: earthcamFilterCountryEl,
  cityEl: earthcamFilterCityEl,
  categoryEl: earthcamFilterCategoryEl,
  statusFilterEl: earthcamFilterStatusEl,
  viewportOnlyEl: earthcamViewportOnlyEl,
  viewAllBtnEl: earthcamViewAllBtnEl,
  panelBodyEl: earthcamPanelBodyEl,
  panelStateEl: earthcamPanelStateEl,
  panelHeadEl: earthcamDisplayHeadEl,
  thumbEl: earthcamThumbEl,
  thumbPlaceholderEl: earthcamThumbPlaceholderEl,
  embedWrapEl: earthcamEmbedWrapEl,
  embedFrameEl: earthcamEmbedFrameEl,
  externalBtnEl: earthcamExternalBtnEl,
  flyBtnEl: earthcamFlyBtnEl,
  liveBtnEl: document.getElementById("earthcam-live-btn") as HTMLButtonElement | null,
  metaLocationEl: earthcamMetaLocationEl,
  metaCategoryEl: earthcamMetaCategoryEl,
  metaStatusEl: earthcamMetaStatusEl,
  metaSourceEl: earthcamMetaSourceEl,
  metaAttribEl: earthcamMetaAttribEl,
  metaNotesEl: earthcamMetaNotesEl,
  viewNoteEl: earthcamViewNoteEl,
  metaViewEl: earthcamMetaViewEl,
  satInfoEl,
  satNameEl,
  infoTitleEl,
  intelBadgeEl: intelCardModeBadgeEl,
  hideCoreInfoRows,
  showCoreInfoRows,
  clearOtherSelections: clearOtherGlobeSelectionsForEarthcam
});
earthCamController.attach();

function clearEarthcamSelectionQuietly(): void {
  earthCamController.selectCamera(null);
}

function clusterEntitiesFromPick(ent: Entity): Entity[] | undefined {
  const cluster = (ent as Entity & { cluster?: { clusteredEntities?: Entity[] } }).cluster;
  if (cluster?.clusteredEntities?.length) return cluster.clusteredEntities;
  return undefined;
}

const planesDataSource = new CustomDataSource("adsb_planes");
planesDataSource.show = false;
void viewer.dataSources.add(planesDataSource);

const vesselsDataSource = new CustomDataSource("ais_vessels");
vesselsDataSource.show = false;
void viewer.dataSources.add(vesselsDataSource);

const PLACE_SEARCH_PIN_ID = "geocode-search-pin";
const placeSearchDataSource = new CustomDataSource("place_search");
placeSearchDataSource.show = true;
void viewer.dataSources.add(placeSearchDataSource);
/** Hit shown at the magenta search pin (for pick + place panel). */
let cachedPlaceSearchHitForPin: NominatimHit | null = null;
let placeWikiFetchSeq = 0;
const trackedEntities = new Map<string, Satellite>();
const trackedPlanes = new Map<string, NormalizedAircraft>();
const planeTrackByHex = new Map<string, { ac: NormalizedAircraft; lastSeenMs: number; fixMs: number }>();
let hoveredPlaneEntityId: string | null = null;

let selectedSatelliteId: string | null = null;
let selectedPlaneId: string | null = null;
const SELECTED_PLANE_ROUTE_ENTITY_ID = "selected-plane-route";
const SELECTED_PLANE_AHEAD_ID = "selected-plane-ahead";
let selectedPlaneRouteHint: string | null = null;
/** Known route endpoints of the selected aircraft; drives the progress/ETA rows and the "still to fly" leg. */
let selectedPlaneRouteGeom: {
  dep: { lat: number; lon: number } | null;
  arr: { lat: number; lon: number } | null;
  arrLabel: string;
  cruiseM: number;
  depInfo: PlaneAirportInfo | null;
  arrInfo: PlaneAirportInfo | null;
} | null = null;
type PlaneAirportInfo = { code: string; name: string; lat: number; lon: number };
/** Cameras found near one of the selected flight's airports (kept so live ticks don't wipe the list). */
let planeAirportCams: {
  which: "dep" | "arr";
  state: "loading" | "done";
  cams: EarthCamCamera[];
} | null = null;
let planeSummaryKey = "";
/** Aircraft whose photo/gallery the card currently shows (or is loading) — so live updates never reset it. */
let planeMediaState: { hex: string } | null = null;
let selectedPlaneRouteFromText = "";
let selectedPlaneRouteToText = "";
let selectedPastTrail: Entity | null = null;
let selectedFutureTrail: Entity | null = null;
let satellitesVisible = false;
let planesVisible = false;
let vesselsVisible = false;
const vesselTrackByMmsi = new Map<number, { row: VesselClientRow; lastSeenMs: number }>();
let selectedVesselId: string | null = null;
const SELECTED_VESSEL_ROUTE_ID = "selected-vessel-route";
const SELECTED_VESSEL_DEST_ID = "selected-vessel-dest";
/** Destination text → map position (null = no match). Filled on demand when a ship is selected. */
const vesselGeoCache = new Map<string, PlaceHit | null>();
const vesselGeoRetryAt = new Map<string, number>();
let lastVesselDestSig: string | null = null;
const scratchVesselCartesian = new Cartesian3();
let vesselStreamClient: ReturnType<typeof createAisStreamClient> | null = null;
/** Short human reason for an empty/slow vessel layer, fed by the server's AIS status messages. */
let aisStatusNote = "";
/** Shown when the browser can't hold the websocket open (e.g. refused): no server status message can explain it. */
const AIS_NOT_CONNECTED = "stream not connected, retrying…";

function aisNoteFromStatus(s: VesselStatusMessage): string {
  switch (s.upstream) {
    case "no_key":
      return s.vessels > 0
        ? `no AISStream key — keyless Baltic feed only (${s.vessels})`
        : "no AISStream key — only the Baltic has keyless coverage";
    case "connecting":
      return "connecting…";
    case "backoff":
      return s.detail ?? "reconnecting…";
    case "auth_failed":
      return `key rejected${s.detail ? `: ${s.detail}` : ""}`;
    case "idle":
      return "idle";
    case "open": {
      if (s.vessels === 0) return "connected, waiting for traffic — AISStream coverage is mostly near ports";
      const parts = Object.entries(s.bySource ?? {}).map(
        ([k, n]) => `${k === "digitraffic" ? "Baltic (Digitraffic)" : "AISStream"} ${n}`
      );
      return `live · ${parts.join(" · ")}`;
    }
  }
}
/** When a category is off, those aircraft are hidden (not removed from the track buffer). */
const planeCategoryEnabled: Record<PlaneTrafficKind, boolean> = {
  military: true,
  airline: true,
  bizjet: true,
  other: true
};
let flightCarrierGuessSeq = 0;
let aviationstackHintSeq = 0;
let aviationstackConfiguredProbe: Promise<boolean> | null = null;
let lastPlaneFetchMs = 0;
let planeFetchInFlight = false;
/** Default is the server-backed catalog (CelesTrak → KeepTrack → SatNOGS); the KeepTrack button is an opt-in direct pull. */
let currentSource: "keeptrack" | "celestrak" = "celestrak";
/** Below this many objects a catalog counts as partial and the browser tops it up from KeepTrack directly. */
const FULL_CATALOG_MIN = 5000;
/** Default true so counts match full cached catalogs; users can switch to view-region culling. */
let showAllSatellitesFromCache = true;

type SourceName = "keeptrack" | "celestrak";
type CacheLogEntry = {
  timestamp: number;
  source: SourceName;
  count: number;
  status: "success" | "error";
  message: string;
};

/** Feed text (ship names/destinations, airport names…) is untrusted: never put it into innerHTML unescaped. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function rowsHtml(rows: Array<[string, string | boolean]>): string {
  return rows
    .map(
      ([k, v]) =>
        `<div class="plane-extra-row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(typeof v === "boolean" ? (v ? "yes" : "no") : String(v))}</strong></div>`
    )
    .join("");
}

function setStatus(message: string): void {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function appendTrackingSuffix(satellitesLine: string, aircraftExtra?: string): string {
  let out = satellitesLine;
  if (!planesVisible) {
    out = `${out} | Aircraft: hidden`;
  } else if (aircraftExtra) {
    out = `${out} | ${aircraftExtra}`;
  } else {
    const meta = lastPlaneProviderSummary ? ` · ${lastPlaneProviderSummary}` : "";
    out = `${out} | Aircraft: ${trackedPlanes.size}${meta}`;
  }
  if (!vesselsVisible) {
    out = `${out} | Vessels: hidden`;
  } else {
    out = `${out} | Vessels: ${vesselTrackByMmsi.size} (AIS${aisStatusNote ? ` · ${aisStatusNote}` : ""})`;
  }
  if (!datacentersVisible) {
    out = `${out} | DC: hidden`;
  } else {
    const n = datacenterLayer.filteredSites().length;
    out = `${out} | DC: ${n} (OSM)`;
  }
  if (!earthCamController.isVisible()) {
    out = `${out} | CAM: hidden`;
  } else {
    const n = earthCamController.layer.filteredCameras().length;
    out = `${out} | CAM: ${n}`;
  }
  return out;
}

/** Last satellite line passed to `appendTrackingSuffix` — updated only by `updateVisibleSatellitesInView`. */
let lastSatelliteStatusLine = "Satellites hidden";

function refreshTrackingStatusStrip(aircraftHint?: string): void {
  setStatus(appendTrackingSuffix(lastSatelliteStatusLine, aircraftHint));
}

/** Aircraft card drop-down: grows the card and (phone) hides the menu dock while open. */
function setPlaneCardExpanded(open: boolean): void {
  satInfoEl?.classList.toggle("plane-expanded", open);
  document.documentElement.classList.toggle("plane-card-expanded", open);
  document.getElementById("plane-card-toggle")?.setAttribute("aria-expanded", String(open));
  const lbl = document.getElementById("plane-card-toggle-label");
  if (lbl) lbl.textContent = open ? "Hide details" : "Show all details";
  viewer.scene.requestRender();
}
document.getElementById("plane-card-toggle")?.addEventListener("click", () => {
  setPlaneCardExpanded(!satInfoEl?.classList.contains("plane-expanded"));
});

function toggleAircraftOnlyInfoRows(show: boolean): void {
  satInfoEl?.classList.toggle("aircraft-mode", show);
  if (!show) setPlaneCardExpanded(false);
  for (const el of document.querySelectorAll<HTMLElement>(".aircraft-only-info")) {
    el.classList.toggle("hidden", !show);
  }
}

function aircraftTrafficBucketLabel(kind: PlaneTrafficKind): string {
  switch (kind) {
    case "airline":
      return "Scheduled airline";
    case "bizjet":
      return "Biz / charter / owner flights";
    case "military":
      return "Military";
    default:
      return "Misc · GA · light aircraft";
  }
}

function showCoreInfoRows(): void {
  satInfoCoreEl?.classList.remove("hidden");
}

function hideCoreInfoRows(): void {
  satInfoCoreEl?.classList.add("hidden");
}

function showAlprDetailRows(): void {
  alprPanelBodyEl?.classList.remove("hidden");
}

function hideAlprDetailRows(): void {
  alprPanelBodyEl?.classList.add("hidden");
}

function hideDatacenterDetailRows(): void {
  datacenterPanelBodyEl?.classList.add("hidden");
}

function showDatacenterDetailRows(): void {
  datacenterPanelBodyEl?.classList.remove("hidden");
}

function hideVesselDetailRows(): void {
  vesselPanelBodyEl?.classList.add("hidden");
}

function showVesselDetailRows(): void {
  vesselPanelBodyEl?.classList.remove("hidden");
}

function removeSelectedVesselRoute(): void {
  const e = vesselsDataSource.entities.getById(SELECTED_VESSEL_ROUTE_ID);
  if (e) vesselsDataSource.entities.remove(e);
}

function removeSelectedVesselDestination(): void {
  const e = vesselsDataSource.entities.getById(SELECTED_VESSEL_DEST_ID);
  if (e) vesselsDataSource.entities.remove(e);
  lastVesselDestSig = null;
}

/**
 * AIS destination is free text typed by the crew: "HOUSTON", "NYNASHAMN<>GDANSK", "FOR ORDERS", or a 5-letter
 * UN/LOCODE like "DETRV". Returns a name worth geocoding, or null (codes and notes can't be resolved yet).
 */
function cleanVesselDestination(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw
    .toUpperCase()
    .split(/<>|=>|->|>|\s-\s|\bTO\b/)
    .map((s) => s.replace(/[^A-Z .'-]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  if (/ORDER|\bSAR\b|VESSEL|ANCHOR|PILOT|TEST|NONE|UNKNOWN/.test(last)) return null;
  if (/^[A-Z]{2} ?[A-Z]{3}$/.test(last)) return null; // UN/LOCODE (e.g. "GB NGG") — no lookup table bundled
  return last.replace(/\s+[A-Z]{2}$/, "").length >= 4 ? last : null;
}

function drawVesselDestinationLine(v: VesselClientRow, dest: string, geo: PlaceHit): void {
  const sig = `${dest}|${v.lat.toFixed(2)}|${v.lon.toFixed(2)}`;
  if (sig === lastVesselDestSig && vesselsDataSource.entities.getById(SELECTED_VESSEL_DEST_ID)) return;
  removeSelectedVesselDestination();
  lastVesselDestSig = sig;
  vesselsDataSource.entities.add({
    id: SELECTED_VESSEL_DEST_ID,
    polyline: {
      positions: greatCircleCartesians(v.lat, v.lon, geo.lat, geo.lon, 12, 64),
      width: 2.2,
      material: trackProjectionDashMaterial(0.9),
      clampToGround: false
    }
  });
  viewer.scene.requestRender();
}

/** Destination, distance and ETA rows for the selected ship, plus the dashed line to its destination. */
function renderVesselExtra(v: VesselClientRow): void {
  if (!vesselExtraRowsEl) return;
  const rows: Array<[string, string]> = [];
  const destRaw = v.destination?.trim() || null;
  const dest = cleanVesselDestination(destRaw);

  if (dest) {
    const known = vesselGeoCache.get(dest);
    const retryOk = (vesselGeoRetryAt.get(dest) ?? 0) < Date.now();
    if (known === undefined && retryOk) {
      vesselGeoRetryAt.set(dest, Date.now() + 15_000);
      void geocodePlace(dest).then((hit) => {
        if (hit !== undefined) vesselGeoCache.set(dest, hit);
        const cur = selectedVesselId ? vesselTrackByMmsi.get(Number(selectedVesselId.replace(/^vessel-/, "")))?.row : null;
        if (cur) renderVesselExtra(cur);
      });
    }
    if (known) {
      const nm = haversineNm(v.lat, v.lon, known.lat, known.lon);
      rows.push(["Destination (resolved)", `${known.label} · approximate, matched from the AIS text "${dest}"`]);
      rows.push(["Distance to destination", `${Math.round(nm)} NM direct line (ships follow sea lanes, so the real distance is longer)`]);
      if (v.sogKt != null && v.sogKt >= 2) {
        const mins = (nm / v.sogKt) * 60;
        rows.push(["ETA (estimated)", `${formatDuration(mins)} · ${arrivalClock(mins)} — direct line at current speed`]);
      } else {
        rows.push(["ETA (estimated)", "Not shown — the vessel is stationary or moving very slowly"]);
      }
      drawVesselDestinationLine(v, dest, known);
    } else if (known === null) {
      rows.push(["Destination", `"${dest}" — could not be matched to a place on the map`]);
      removeSelectedVesselDestination();
    } else {
      rows.push(["Destination", `"${dest}" — looking up its position…`]);
    }
  } else {
    removeSelectedVesselDestination();
    if (destRaw) {
      rows.push(["Destination", `"${destRaw}" — a port code or note, not resolved to a map position`]);
    }
  }

  if (v.etaMs != null) {
    const mins = (v.etaMs - Date.now()) / 60_000;
    rows.push([
      "ETA (reported by crew)",
      mins > 0
        ? `in ${formatDuration(mins)} · ${new Date(v.etaMs).toUTCString().slice(5, 22)} UTC`
        : "that time has passed — the crew may not have updated it"
    ]);
  }
  vesselExtraRowsEl.innerHTML = rowsHtml(rows);
}

function clearVesselSelectionQuietly(): void {
  selectedVesselId = null;
  lastVesselRouteDrawSig = null;
  removeSelectedVesselRoute();
  removeSelectedVesselDestination();
  if (vesselExtraRowsEl) vesselExtraRowsEl.innerHTML = "";
  vesselRouteBlockEl?.classList.add("hidden");
  hideVesselDetailRows();
  for (const ent of vesselsDataSource.entities.values) {
    if (typeof ent.id !== "string" || !ent.id.startsWith("vessel-")) continue;
    if (ent.point) {
      (ent.point as any).pixelSize = 8;
      (ent.point as any).color = Color.fromCssColorString("#56e0a0");
    }
  }
}

function clearSatelliteSelectionQuietly(): void {
  if (selectedSatelliteId) {
    const prevSat = satellitesDataSource.entities.getById(selectedSatelliteId);
    if (prevSat?.point) {
      (prevSat.point as any).pixelSize = SAT_POINT_PX;
      (prevSat.point as any).color = Color.fromCssColorString("#6ed8ff");
    }
  }
  selectedSatelliteId = null;
  clearSelectedTrail();
}

function fillAlprPanel(site: AlprSite): void {
  const ds = lastAlprDataset;
  const head = site.name?.trim() || site.id;
  if (alprSensorHeadEl) alprSensorHeadEl.textContent = head;
  if (alprMetaIdEl) alprMetaIdEl.textContent = site.id;
  if (alprMetaNameEl) alprMetaNameEl.textContent = site.name?.trim() || "—";
  if (alprMetaSourceEl) alprMetaSourceEl.textContent = site.source;
  if (alprMetaVendorEl) alprMetaVendorEl.textContent = site.vendor?.trim() || "—";
  if (alprMetaRegionEl) alprMetaRegionEl.textContent = site.region?.trim() || "—";
  const conf = site.confidence ?? "unknown";
  if (alprMetaConfidenceEl) {
    alprMetaConfidenceEl.textContent = conf.charAt(0).toUpperCase() + conf.slice(1);
  }
  // The map shows the selected camera's view range; the note under the table says what it is based on (viewRangePlan.ts).
  const hasBearing = typeof site.bearingDeg === "number" && Number.isFinite(site.bearingDeg);
  if (alprMetaBearingEl) alprMetaBearingEl.textContent = hasBearing ? `${site.bearingDeg!.toFixed(0)}° true` : "—";
  const viewPlan = planAlprView(site);
  if (alprMetaViewEl) alprMetaViewEl.textContent = viewPlan.summary;
  if (alprViewNoteEl) alprViewNoteEl.textContent = viewPlan.detail;
  if (alprMetaNotesEl) alprMetaNotesEl.textContent = site.notes?.trim() || "—";
  const attr = ds?.attribution?.trim() ?? "—";
  const lic = ds?.licenseNote?.trim();
  if (alprMetaAttribEl) {
    alprMetaAttribEl.textContent = lic ? `${attr} · ${lic}` : attr;
  }
}

function fillDatacenterPanel(site: DatacenterSite): void {
  const ds = lastDatacenterDataset;
  const head = site.name?.trim() || site.operator?.trim() || site.id;
  if (datacenterDisplayHeadEl) datacenterDisplayHeadEl.textContent = head;
  if (datacenterMetaOsmEl) {
    datacenterMetaOsmEl.textContent = [
      site.osm.length ? `OSM ${site.osm.slice(0, 3).join(", ")}${site.osm.length > 3 ? ` +${site.osm.length - 3}` : ""}` : "",
      site.peeringdb ? `PeeringDB ${site.peeringdb}` : "",
      site.wikidata ? `Wikidata ${site.wikidata}` : ""
    ]
      .filter(Boolean)
      .join(" · ") || "—";
  }
  if (datacenterMetaNameEl) datacenterMetaNameEl.textContent = site.name?.trim() || "—";
  if (datacenterMetaOperatorEl) datacenterMetaOperatorEl.textContent = site.operator?.trim() || "—";
  if (datacenterMetaOwnerEl) datacenterMetaOwnerEl.textContent = site.owner?.trim() || "—";
  if (datacenterMetaRefEl) datacenterMetaRefEl.textContent = site.ref?.trim() || "—";
  if (datacenterMetaTagsEl) {
    datacenterMetaTagsEl.textContent = `${site.sources.join(" + ")}${site.buildings > 1 ? ` · ${site.buildings} buildings` : ""}`;
  }
  if (datacenterMetaRegionEl) {
    datacenterMetaRegionEl.textContent = [site.region, site.country].filter(Boolean).join(", ") || "—";
  }
  if (datacenterMetaNotesEl) {
    datacenterMetaNotesEl.textContent = [site.address, site.notes].filter(Boolean).join(" · ") || "—";
  }
  if (datacenterMetaOsmLinkEl) {
    const link =
      site.website ??
      (site.osm[0] ? `https://www.openstreetmap.org/${site.osm[0]}` : undefined) ??
      (site.wikidata ? `https://www.wikidata.org/wiki/${site.wikidata}` : undefined) ??
      (site.peeringdb ? `https://www.peeringdb.com/fac/${site.peeringdb}` : undefined) ??
      "https://www.openstreetmap.org/";
    datacenterMetaOsmLinkEl.href = link;
    datacenterMetaOsmLinkEl.textContent = site.website ? "Facility website" : link;
  }
  const attr = ds?.attribution?.trim() ?? "—";
  const lic = ds?.licenseNote?.trim();
  if (datacenterMetaAttribEl) {
    datacenterMetaAttribEl.textContent = lic ? `${attr} · ${lic}` : attr;
  }
}
function selectDatacenterSite(entityId: string | null): void {
  datacenterLayer.setSelectedEntityId(entityId);
  if (!entityId) {
    hideDatacenterDetailRows();
    showCoreInfoRows();
    satNameEl?.classList.remove("hidden");
    if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "SIGINT";
    return;
  }
  const site = datacenterLayer.getSiteForPickId(entityId);
  if (!site) return;
  clearEarthcamSelectionQuietly();
  selectAlprSite(null);
  clearVesselSelectionQuietly();
  selectGeocodePlace(null);
  clearPlaneSelection();
  clearSatelliteSelectionQuietly();
  hideCoreInfoRows();
  showDatacenterDetailRows();
  satNameEl?.classList.add("hidden");
  if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "DATA CTR";
  if (infoTitleEl) infoTitleEl.textContent = "Data center";
  fillDatacenterPanel(site);
  satInfoEl?.classList.remove("hidden");
  flyStraightDown(viewer, site.longitude, site.latitude, 800);
}

function selectAlprSite(entityId: string | null): void {
  alprLayer.setSelectedEntityId(entityId);
  if (!entityId) {
    hideAlprDetailRows();
    showCoreInfoRows();
    satNameEl?.classList.remove("hidden");
    if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "SIGINT";
    return;
  }
  const site = alprLayer.getSiteForPickId(entityId);
  if (!site) return;
  clearEarthcamSelectionQuietly();
  selectDatacenterSite(null);
  clearVesselSelectionQuietly();
  selectGeocodePlace(null);
  clearPlaneSelection();
  clearSatelliteSelectionQuietly();
  hideCoreInfoRows();
  showAlprDetailRows();
  satNameEl?.classList.add("hidden");
  if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "ALPR";
  if (infoTitleEl) infoTitleEl.textContent = "ALPR fixture";
  fillAlprPanel(site);
  satInfoEl?.classList.remove("hidden");
  // Straight down, north up, close enough to read the 23-30 m view cone like a plan (never pulls a closer view out).
  flyStraightDown(viewer, site.longitude, site.latitude, 250);
}

function readAlprFiltersFromDom(): { source: string; vendor: string; region: string } {
  return {
    source: alprFilterSourceEl?.value ?? "__all__",
    vendor: alprFilterVendorEl?.value ?? "__all__",
    region: alprFilterRegionEl?.value ?? "__all__"
  };
}

function applyAlprFiltersFromDom(): void {
  alprLayer.setFilters(readAlprFiltersFromDom());
  const sel = alprLayer.getSelectedEntityId();
  if (sel && alprLayer.getSiteForPickId(sel) === null) {
    selectAlprSite(null);
    satInfoEl?.classList.add("hidden");
  }
  refreshAlprStatusLine();
}

function fillSelectOptions(
  el: HTMLSelectElement | null,
  values: string[],
  emptyLabel: string
): void {
  if (!el) return;
  const cur = el.value;
  el.innerHTML = "";
  const all = document.createElement("option");
  all.value = "__all__";
  all.textContent = emptyLabel;
  el.appendChild(all);
  for (const v of values) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  }
  if (values.includes(cur)) el.value = cur;
  else el.value = "__all__";
}

function syncAlprFilterSelects(): void {
  const ds = alprLayer.getDataset();
  if (!ds || ds.sites.length === 0) {
    alprFiltersEl?.classList.add("hidden");
    return;
  }
  alprFiltersEl?.classList.remove("hidden");
  const prev = readAlprFiltersFromDom();
  fillSelectOptions(alprFilterSourceEl, alprLayer.uniqueFieldValues("source"), "All sources");
  fillSelectOptions(alprFilterVendorEl, alprLayer.uniqueFieldValues("vendor"), "All vendors");
  fillSelectOptions(alprFilterRegionEl, alprLayer.uniqueFieldValues("region"), "All regions");
  if (alprFilterSourceEl && [...alprFilterSourceEl.options].some((o) => o.value === prev.source)) {
    alprFilterSourceEl.value = prev.source;
  }
  if (alprFilterVendorEl && [...alprFilterVendorEl.options].some((o) => o.value === prev.vendor)) {
    alprFilterVendorEl.value = prev.vendor;
  }
  if (alprFilterRegionEl && [...alprFilterRegionEl.options].some((o) => o.value === prev.region)) {
    alprFilterRegionEl.value = prev.region;
  }
  alprLayer.setFilters(readAlprFiltersFromDom());
}

function scheduleAlprViewportRefresh(): void {
  if (!shouldLoadAlprViaViewport()) return;
  if (!alprVisible || !alprLayer.getOverlayVisible()) return;
  if (alprViewportDebounce) clearTimeout(alprViewportDebounce);
  alprViewportDebounce = setTimeout(() => {
    alprViewportDebounce = null;
    void runAlprViewportFetch();
  }, 700);
}

/** Longitude/latitude box of what is on screen (null when the camera isn't looking at the globe). */
function currentViewBox(): { west: number; south: number; east: number; north: number } | null {
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rect) return null;
  return {
    west: CesiumMath.toDegrees(rect.west),
    south: CesiumMath.toDegrees(rect.south),
    east: CesiumMath.toDegrees(rect.east),
    north: CesiumMath.toDegrees(rect.north)
  };
}

let alprPollTimer: ReturnType<typeof setTimeout> | null = null;
let alprDatasetSignature = "";

/**
 * Loads ALPR for everything on screen from the server's tile cache. Tiles that aren't cached yet are fetched in the
 * background, so this re-asks every few seconds until they arrive and the map fills in as they do.
 */
async function runAlprViewportFetch(): Promise<void> {
  if (!shouldLoadAlprViaViewport() || !alprVisible || !alprLayer.getOverlayVisible()) return;
  if (alprPollTimer) {
    clearTimeout(alprPollTimer);
    alprPollTimer = null;
  }
  const box = currentViewBox();
  if (!box) {
    alprViewportHint = "Point the camera at the Earth, then ALPR loads for the area on screen.";
    refreshAlprStatusLine();
    return;
  }
  alprViewportAbort?.abort();
  alprViewportAbort = new AbortController();
  const { signal } = alprViewportAbort;
  alprViewportLoading = true;
  refreshAlprStatusLine();
  try {
    const r = await fetchAlprBox(box, signal);
    if (!r.ok) {
      alprViewportHint =
        r.reason === "too-wide"
          ? "Zoom in a little (about a 10° view or closer) to load ALPR for this area."
          : "ALPR service unavailable right now — try again in a moment.";
      if (r.reason === "too-wide") {
        lastAlprDataset = { sites: [], attribution: "© OpenStreetMap contributors (ODbL)", licenseNote: "https://www.openstreetmap.org/copyright" };
        alprDatasetSignature = "";
        alprLayer.setDataset(lastAlprDataset);
        syncAlprFilterSelects();
      }
      return;
    }
    const sig = `${r.dataset.sites.length}:${r.dataset.sites[0]?.id ?? ""}:${r.dataset.sites[r.dataset.sites.length - 1]?.id ?? ""}`;
    if (sig !== alprDatasetSignature) {
      alprDatasetSignature = sig;
      lastAlprDataset = r.dataset;
      alprLayer.setDataset(r.dataset);
      syncAlprFilterSelects();
    }
    const done = r.total - r.pending - r.failed;
    alprViewportHint =
      r.pending > 0
        ? `Loading map tiles (${done} of ${r.total} ready)…`
        : r.failed > 0
          ? `${r.failed} of ${r.total} map tiles are temporarily unavailable (OpenStreetMap server busy) — retrying…`
          : r.truncated
            ? "Showing the nearest 30,000 — zoom in to see the rest."
            : null;
    if (r.pending > 0 || r.failed > 0) {
      alprPollTimer = setTimeout(() => void runAlprViewportFetch(), r.pending > 0 ? 3000 : 12_000);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    console.warn("[alpr] viewport load failed:", e);
    alprViewportHint = "ALPR service unavailable right now — try again in a moment.";
  } finally {
    alprViewportLoading = false;
    refreshAlprStatusLine();
    viewer.scene.requestRender();
  }
}

/** Legend of the camera looks present in the current view (icon, vendor, count). */
function renderAlprLegend(): void {
  const box = document.getElementById("alpr-legend");
  if (!box) return;
  box.textContent = "";
  const counts = new Map<AlprKind, number>();
  for (const s of alprLayer.filteredSites()) {
    const k = alprKindForVendor(s.vendor);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [kind, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const row = summaryEl("div", "alpr-legend-row");
    const img = new Image();
    img.src = alprIconUri(kind);
    img.alt = "";
    img.width = 22;
    img.height = 22;
    row.append(img, summaryEl("span", undefined, ALPR_KIND_LABEL[kind]), summaryEl("small", undefined, n.toLocaleString()));
    box.append(row);
  }
}

function refreshAlprStatusLine(): void {
  renderAlprLegend();
  if (!alprDatasetStatusEl) return;
  const ds = alprLayer.getDataset();
  if (!ds) {
    alprDatasetStatusEl.textContent =
      "No dataset — Overpass request failed or blocked. Dev: ensure `npm run dev` (uses /overpass-proxy). Try VITE_ALPR_ADAPTER=geojson for offline sample.";
    return;
  }
  const viewMode = shouldLoadAlprViaViewport();
  if (viewMode && alprViewportLoading && ds.sites.length === 0) {
    alprDatasetStatusEl.textContent = "Loading OSM ALPR for current view…";
    return;
  }
  if (ds.sites.length === 0) {
    if (viewMode && alprViewportHint) {
      alprDatasetStatusEl.textContent = alprViewportHint;
      return;
    }
    if (viewMode && ds.attribution.includes("viewport")) {
      const hint = alprViewportHint ? ` ${alprViewportHint}` : " Turn ALPR on, zoom in, and pan.";
      alprDatasetStatusEl.textContent = `No ALPR loaded yet.${hint}`;
      return;
    }
    const hint = ds.attribution.includes("Overpass")
      ? " Default query is `around:600000` from SF — edit `public/data/alpr-overpass-example.ql` or set `VITE_ALPR_OVERPASS_QUERY_URL`."
      : "";
    alprDatasetStatusEl.textContent = `Dataset empty · ${ds.attribution.slice(0, 72)}${hint}`;
    return;
  }
  const n = alprLayer.filteredSites().length;
  let line = `Nodes: ${n} / ${ds.sites.length} · ${ds.attribution.slice(0, 72)}${ds.attribution.length > 72 ? "…" : ""}`;
  if (!alprLayer.getOverlayVisible()) {
    line += " · Globe overlay OFF — press ALPR · OFF to show.";
  } else if (n === 0) {
    line = `0 / ${ds.sites.length} after filters — set Source / Vendor / Region to “All …”.`;
  } else if (viewMode) {
    line = `${n.toLocaleString()} ALPR in view · OpenStreetMap${alprViewportHint ? ` · ${alprViewportHint}` : ""}`;
  }
  alprDatasetStatusEl.textContent = line;
}

async function loadAlprDataset(): Promise<void> {
  if (shouldLoadAlprViaViewport()) {
    lastAlprDataset = {
      sites: [],
      attribution:
        "© OpenStreetMap contributors — viewport Overpass (visible area when zoomed in; ODbL).",
      licenseNote: "https://www.openstreetmap.org/copyright"
    };
    alprLayer.setDataset(lastAlprDataset);
    syncAlprFilterSelects();
    refreshAlprStatusLine();
    if (alprVisible) scheduleAlprViewportRefresh();
    return;
  }

  const adapter = createAlprAdapterFromEnv();
  try {
    const ds = await adapter.load();
    lastAlprDataset = ds;
    alprLayer.setDataset(ds);
    syncAlprFilterSelects();
    if (ds.sites.length > 0) {
      alprVisible = true;
      alprLayer.setOverlayVisible(true);
      if (toggleAlprEl) toggleAlprEl.textContent = "ALPR · ON";
    }
    refreshAlprStatusLine();
  } catch (e) {
    console.warn("[alpr] dataset load failed:", e);
    lastAlprDataset = null;
    alprLayer.setDataset(null);
    syncAlprFilterSelects();
    refreshAlprStatusLine();
  }
}

function setupAlprControls(): void {
  toggleAlprEl?.addEventListener("click", () => {
    alprVisible = !alprVisible;
    alprLayer.setOverlayVisible(alprVisible);
    if (toggleAlprEl) toggleAlprEl.textContent = alprVisible ? "ALPR · ON" : "ALPR · OFF";
    if (alprVisible) {
      syncAlprFilterSelects();
      if (shouldLoadAlprViaViewport()) void runAlprViewportFetch();
    } else {
      alprViewportAbort?.abort();
      alprViewportAbort = null;
      if (alprPollTimer) {
        clearTimeout(alprPollTimer);
        alprPollTimer = null;
      }
      if (alprViewportDebounce) {
        clearTimeout(alprViewportDebounce);
        alprViewportDebounce = null;
      }
      alprViewportLoading = false;
      const hadAlprPanel = alprPanelBodyEl && !alprPanelBodyEl.classList.contains("hidden");
      selectAlprSite(null);
      if (hadAlprPanel && !selectedPlaneId && !selectedSatelliteId) {
        satInfoEl?.classList.add("hidden");
      }
    }
    refreshAlprStatusLine();
    syncAlprModuleVisibility();
    viewer.scene.requestRender();
  });
  alprFilterSourceEl?.addEventListener("change", () => applyAlprFiltersFromDom());
  alprFilterVendorEl?.addEventListener("change", () => applyAlprFiltersFromDom());
  alprFilterRegionEl?.addEventListener("change", () => applyAlprFiltersFromDom());
}

function openStreetMapBrowseUrl(hit: NominatimHit): string {
  const k = hit.osmKind?.toLowerCase();
  if (hit.osmId != null && (k === "node" || k === "way" || k === "relation")) {
    return `https://www.openstreetmap.org/${k}/${hit.osmId}`;
  }
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${hit.lat},${hit.lon}`)}`;
}

function clearPlaceTagRows(): void {
  if (placeInfoTagRowsEl) placeInfoTagRowsEl.innerHTML = "";
}

function fillPlaceTagRows(hit: NominatimHit): void {
  clearPlaceTagRows();
  if (!placeInfoTagRowsEl) return;
  for (const { label, value } of placeExtraTagRows(hit, 8)) {
    const row = document.createElement("div");
    row.className = "row";
    const span = document.createElement("span");
    span.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value.length > 140 ? `${value.slice(0, 137)}…` : value;
    row.append(span, strong);
    placeInfoTagRowsEl.appendChild(row);
  }
}

function applyPlaceArchitectRow(hit: NominatimHit, seq: number): void {
  const osmLine = architectLineFromExtratags(hit);
  const qRaw = hit.wikidata?.trim();
  const hasWikidata = qRaw && /^Q\d+$/i.test(qRaw);

  if (!osmLine && !hasWikidata) {
    placeInfoArchitectRowEl?.classList.add("hidden");
    if (placeInfoArchitectEl) placeInfoArchitectEl.textContent = "—";
    return;
  }

  placeInfoArchitectRowEl?.classList.remove("hidden");
  const qid = hasWikidata ? qRaw!.toUpperCase() : "";

  if (osmLine && !hasWikidata) {
    if (placeInfoArchitectEl) placeInfoArchitectEl.textContent = osmLine;
    return;
  }

  if (!osmLine && hasWikidata) {
    if (placeInfoArchitectEl) placeInfoArchitectEl.textContent = "Loading…";
    void fetchArchitectLabelsFromWikidata(qid)
      .then((names) => {
        if (seq !== placeWikiFetchSeq) return;
        if (!placeInfoArchitectEl) return;
        if (names.length) {
          placeInfoArchitectEl.textContent = names.join(" · ");
        } else {
          placeInfoArchitectRowEl?.classList.add("hidden");
          placeInfoArchitectEl.textContent = "—";
        }
      })
      .catch(() => {
        if (seq !== placeWikiFetchSeq) return;
        placeInfoArchitectRowEl?.classList.add("hidden");
        if (placeInfoArchitectEl) placeInfoArchitectEl.textContent = "—";
      });
    return;
  }

  if (osmLine && hasWikidata) {
    if (placeInfoArchitectEl) placeInfoArchitectEl.textContent = `${osmLine} · …`;
    void fetchArchitectLabelsFromWikidata(qid)
      .then((names) => {
        if (seq !== placeWikiFetchSeq) return;
        if (!placeInfoArchitectEl || !osmLine) return;
        if (!names.length) {
          placeInfoArchitectEl.textContent = osmLine;
          return;
        }
        const extra = names.filter((n) => !osmLine.toLowerCase().includes(n.toLowerCase()));
        placeInfoArchitectEl.textContent = extra.length ? `${osmLine} · ${extra.join(" · ")}` : osmLine;
      })
      .catch(() => {
        if (seq !== placeWikiFetchSeq) return;
        if (placeInfoArchitectEl) placeInfoArchitectEl.textContent = osmLine;
      });
  }
}

function resetPlaceInfoPanelDom(): void {
  placeWikiFetchSeq++;
  if (placeInfoHeadlineEl) placeInfoHeadlineEl.textContent = "—";
  if (placeInfoCategoryEl) placeInfoCategoryEl.textContent = "—";
  if (placeInfoAddressEl) placeInfoAddressEl.textContent = "—";
  if (placeInfoCoordsEl) placeInfoCoordsEl.textContent = "—";
  if (placeInfoOsmLinkEl) placeInfoOsmLinkEl.href = "#";
  clearPlaceTagRows();
  placeInfoWikiSectionEl?.classList.add("hidden");
  placeInfoWikiLeadRowEl?.classList.add("hidden");
  placeInfoWikiArticleRowEl?.classList.add("hidden");
  if (placeInfoWikiLeadEl) placeInfoWikiLeadEl.textContent = "—";
  if (placeInfoWikipediaLinkEl) placeInfoWikipediaLinkEl.href = "#";
  placeInfoWikidataRowEl?.classList.add("hidden");
  if (placeInfoWikidataLinkEl) placeInfoWikidataLinkEl.href = "#";
  placeInfoArchitectRowEl?.classList.add("hidden");
  if (placeInfoArchitectEl) placeInfoArchitectEl.textContent = "—";
}

/**
 * Hides the fly-to place panel (does not remove the globe pin or `cachedPlaceSearchHitForPin`).
 */
function selectGeocodePlace(hit: NominatimHit | null): void {
  if (!hit) {
    placeInfoPanelEl?.classList.add("hidden");
    resetPlaceInfoPanelDom();
    if (
      !selectedSatelliteId &&
      !selectedPlaneId &&
      !selectedVesselId &&
      !alprLayer.getSelectedEntityId() &&
      !datacenterLayer.getSelectedEntityId() &&
      !earthCamController.layer.getSelectedEntityId()
    ) {
      satInfoEl?.classList.add("hidden");
    }
    return;
  }

  satInfoEl?.classList.remove("hidden");
  clearEarthcamSelectionQuietly();
  clearVesselSelectionQuietly();
  clearPlaneSelection();
  clearSatelliteSelectionQuietly();
  hideCoreInfoRows();
  hideAlprDetailRows();
  hideDatacenterDetailRows();
  alprLayer.setSelectedEntityId(null);
  datacenterLayer.setSelectedEntityId(null);
  placeInfoPanelEl?.classList.remove("hidden");
  satNameEl?.classList.add("hidden");
  if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "GEO";
  if (infoTitleEl) infoTitleEl.textContent = "Place";

  const shortName = hit.displayName.split(",").slice(0, 2).join(",").trim() || hit.displayName;
  if (placeInfoHeadlineEl) placeInfoHeadlineEl.textContent = shortName.slice(0, 160);
  if (placeInfoCategoryEl) placeInfoCategoryEl.textContent = placeCategoryLine(hit);
  if (placeInfoAddressEl) placeInfoAddressEl.textContent = placeAddressLine(hit);
  fillPlaceTagRows(hit);

  const seq = ++placeWikiFetchSeq;
  applyPlaceArchitectRow(hit, seq);

  if (placeInfoCoordsEl) {
    placeInfoCoordsEl.textContent = `${hit.lat.toFixed(5)}°, ${hit.lon.toFixed(5)}°`;
  }
  if (placeInfoOsmLinkEl) placeInfoOsmLinkEl.href = openStreetMapBrowseUrl(hit);

  const wikiTag = parseWikipediaTag(hit.wikipedia);
  const articleFallback = nominatimWikipediaBrowseUrl(hit.wikipedia);

  if (!wikiTag && !articleFallback) {
    placeInfoWikiSectionEl?.classList.add("hidden");
  } else {
    placeInfoWikiSectionEl?.classList.remove("hidden");
    placeInfoWikiArticleRowEl?.classList.remove("hidden");
    if (placeInfoWikipediaLinkEl) placeInfoWikipediaLinkEl.href = articleFallback ?? "#";

    if (wikiTag) {
      placeInfoWikiLeadRowEl?.classList.remove("hidden");
      if (placeInfoWikiLeadEl) placeInfoWikiLeadEl.textContent = "Loading…";
      void fetchWikipediaPageSummary(wikiTag)
        .then((sum) => {
          if (seq !== placeWikiFetchSeq) return;
          if (placeInfoWikiLeadEl) {
            placeInfoWikiLeadEl.textContent = sum?.extract?.trim() || "—";
          }
          if (sum?.pageUrl && placeInfoWikipediaLinkEl) {
            placeInfoWikipediaLinkEl.href = sum.pageUrl;
          }
        })
        .catch(() => {
          if (seq !== placeWikiFetchSeq) return;
          if (placeInfoWikiLeadEl) placeInfoWikiLeadEl.textContent = "—";
        });
    } else {
      placeInfoWikiLeadRowEl?.classList.add("hidden");
      if (placeInfoWikiLeadEl) placeInfoWikiLeadEl.textContent = "—";
    }
  }

  const wdBrowse = wikidataBrowseUrl(hit.wikidata);
  if (placeInfoWikidataRowEl && placeInfoWikidataLinkEl) {
    if (wdBrowse) {
      placeInfoWikidataLinkEl.href = wdBrowse;
      placeInfoWikidataRowEl.classList.remove("hidden");
    } else {
      placeInfoWikidataRowEl.classList.add("hidden");
    }
  }
}

function upsertPlaceSearchPinFromHit(hit: NominatimHit): void {
  selectGeocodePlace(null);
  cachedPlaceSearchHitForPin = hit;

  const pos = Cartesian3.fromDegrees(hit.lon, hit.lat, 0);
  const entities = placeSearchDataSource.entities;
  const existing = entities.getById(PLACE_SEARCH_PIN_ID);
  if (existing) {
    existing.position = new ConstantPositionProperty(pos);
  } else {
    entities.add({
      id: PLACE_SEARCH_PIN_ID,
      position: pos,
      point: {
        pixelSize: 14,
        color: Color.fromCssColorString("#ff5cfc"),
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: HeightReference.CLAMP_TO_GROUND
      }
    });
  }
  viewer.scene.requestRender();
}

function flyGlobeToNominatimHit(hit: NominatimHit): void {
  upsertPlaceSearchPinFromHit(hit);
  const afterFly = (): void => {
    if (shouldLoadAlprViaViewport() && alprVisible && alprLayer.getOverlayVisible()) {
      void runAlprViewportFetch();
    }
    viewer.scene.requestRender();
  };

  if (hit.west <= hit.east) {
    const rect = Rectangle.fromDegrees(hit.west, hit.south, hit.east, hit.north);
    viewer.camera.flyTo({
      destination: rect,
      duration: 1.55,
      complete: afterFly
    });
    return;
  }

  const latSpanDeg = Math.max(1e-6, hit.north - hit.south);
  const altM = Math.min(280_000, Math.max(15_000, latSpanDeg * 111_000 * 2.2));
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(hit.lon, hit.lat, altM),
    duration: 1.45,
    complete: afterFly
  });
}

// ---------- "My location" and store/place pins ----------

type UserLoc = { lat: number; lon: number; accuracyM: number; at: number; /** set by hand on this device, not measured */ manual?: boolean };
let userLoc: UserLoc | null = null;
const meDataSource = new CustomDataSource("my-location");
void viewer.dataSources.add(meDataSource);

type StorePoi = { name: string; address: string; kind: string; lat: number; lon: number; osm: string | null; distanceKm: number | null };

/** Where "near me" searches are centred: the device's position if we have one, otherwise the middle of the view. */
function searchCenter(): { lat: number; lon: number } | null {
  if (userLoc && (userLoc.manual || Date.now() - userLoc.at < 3_600_000)) return { lat: userLoc.lat, lon: userLoc.lon };
  const manual = getManualLocation();
  if (manual) return { lat: manual.lat, lon: manual.lon };
  return getViewCenterLatLon();
}

function drawMyLocation(loc: UserLoc): void {
  meDataSource.entities.removeAll();
  const pos = Cartesian3.fromDegrees(loc.lon, loc.lat, 0);
  meDataSource.entities.add({
    id: "my-location-accuracy",
    position: pos,
    ellipse: {
      semiMajorAxis: Math.max(15, loc.accuracyM),
      semiMinorAxis: Math.max(15, loc.accuracyM),
      material: Color.fromCssColorString("#2997ff").withAlpha(0.16),
      classificationType: ClassificationType.TERRAIN
    }
  });
  meDataSource.entities.add({
    id: "my-location",
    position: pos,
    point: {
      pixelSize: 15,
      color: Color.fromCssColorString("#2997ff"),
      outlineColor: Color.WHITE,
      outlineWidth: 3,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      heightReference: HeightReference.CLAMP_TO_GROUND,
      text: loc.manual ? "My location (set by you)" : "You are here",
      font: '600 12px -apple-system, "SF Pro Text", Inter, sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      style: 2,
      pixelOffset: new Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });
  viewer.scene.requestRender();
}

/** Asks the browser for the device's position (the user sees the browser's own permission prompt). */
function getDevicePosition(): Promise<UserLoc> {
  return new Promise((resolve, reject) => {
    const blocked = geolocationBlockedReason();
    if (blocked) {
      reject(new Error(blocked === "insecure" ? INSECURE_LOCATION_MESSAGE : "This browser can't share a location."));
      return;
    }
    // Watch for a few seconds and keep the most accurate fix: the first reading is often a coarse Wi-Fi/IP guess
    // that sharpens as the device settles. Stops early once it is good enough.
    let best: GeolocationPosition | null = null;
    let done = false;
    let watchId = 0;
    const finish = (err?: Error): void => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(timer);
      if (best) {
        userLoc = { lat: best.coords.latitude, lon: best.coords.longitude, accuracyM: best.coords.accuracy || 5000, at: Date.now() };
        resolve(userLoc);
      } else {
        reject(err ?? new Error("Your position isn't available right now."));
      }
    };
    const timer = window.setTimeout(() => finish(new Error("Finding your position took too long — try again.")), 12_000);
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
        if (best.coords.accuracy <= 75) finish();
        else if (!done) window.setTimeout(() => best && finish(), 6_000); // settle for the best so far
      },
      (err) =>
        finish(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location access is blocked for this site. Allow it from the lock/tune icon in the address bar (or the system's location privacy settings), then try again."
              : err.code === err.TIMEOUT
                ? "Finding your position took too long — try again."
                : "This device couldn't work out where it is (no GPS/Wi-Fi location service available)."
          )
        ),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 }
    );
  });
}

/** Locates the device, marks it on the globe and (optionally) flies there with a card of next steps. */
async function locateMe(opts: { fly?: boolean; card?: boolean } = {}): Promise<UserLoc | null> {
  const btn = document.getElementById("loc-locate-btn");
  btn?.classList.add("is-busy");
  try {
    const loc = await getDevicePosition();
    drawMyLocation(loc);
    if (opts.fly !== false) {
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(loc.lon, loc.lat, Math.min(30_000, Math.max(2_500, loc.accuracyM * 14))),
        duration: 2
      });
    }
    if (opts.card !== false) {
      const nearby = (word: string): void => {
        const input = document.getElementById("loc-search-input") as HTMLInputElement | null;
        if (!input) return;
        const root = document.getElementById("loc-search");
        if (root?.classList.contains("compact")) root.classList.add("open");
        input.focus();
        input.value = word;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      showLayerCard({
        kicker: "Your location",
        title: "You are here",
        resetsCamera: false,
        rows: [
          ["Coordinates", `${loc.lat.toFixed(5)}°, ${loc.lon.toFixed(5)}°`],
          [
            "Accuracy",
            loc.accuracyM >= 1000
              ? `about ${(loc.accuracyM / 1000).toFixed(1)} km — rough (IP/network based)`
              : loc.accuracyM > 150
                ? `about ${Math.round(loc.accuracyM)} m — Wi-Fi/network based`
                : `about ${Math.round(loc.accuracyM)} m`
          ]
        ],
        body: loc.accuracyM > 1000 ? (() => {
          const p = document.createElement("p");
          p.className = "layer-panel-note";
          p.textContent = "This device has no GPS, so the browser only estimated your area. Turn on Wi-Fi and the system's Location Services for a closer fix, then press locate again.";
          return p;
        })() : undefined,
        actions: [
          {
            label: "Directions from here",
            primary: true,
            run: () =>
              document.dispatchEvent(
                new CustomEvent("orbit:directions-point", { detail: { which: "A", lat: loc.lat, lon: loc.lon, label: "My location" } })
              )
          },
          { label: "Pharmacies", run: () => nearby("pharmacy") },
          { label: "Gas", run: () => nearby("gas station") },
          { label: "Coffee", run: () => nearby("coffee") },
          { label: "Groceries", run: () => nearby("grocery") }
        ],
        links: [{ label: "OpenStreetMap", href: `https://www.openstreetmap.org/#map=16/${loc.lat}/${loc.lon}` }]
      });
    }
    return loc;
  } catch (e) {
    // The device can't say where it is (plain http on a phone, a refusal, no signal): use the point set by hand, if any.
    const saved = getManualLocation();
    if (saved) return useManualLocation(saved, opts);
    showLocationHelp(e instanceof Error ? e.message : "Location is unavailable.");
    return null;
  } finally {
    btn?.classList.remove("is-busy");
  }
}

// ---------- A location set by hand (for devices that cannot share one, e.g. an iPhone over plain http) ----------

let pickingMyLocation = false;
let pickHintEl: HTMLElement | null = null;

function searchNearby(word: string): void {
  const input = document.getElementById("loc-search-input") as HTMLInputElement | null;
  if (!input) return;
  const root = document.getElementById("loc-search");
  if (root?.classList.contains("compact")) root.classList.add("open");
  input.focus();
  input.value = word;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Marks a hand-set point on the globe, flies there and (unless told not to) shows its card. */
function useManualLocation(saved: ManualLoc, opts: { fly?: boolean; card?: boolean } = {}): UserLoc {
  const loc: UserLoc = { lat: saved.lat, lon: saved.lon, accuracyM: 15, at: Date.now(), manual: true };
  userLoc = loc;
  drawMyLocation(loc);
  if (opts.fly !== false) {
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(loc.lon, loc.lat, 2_500), duration: 2 });
  }
  if (opts.card !== false) showManualLocationCard(saved);
  return loc;
}

function applyManualLocation(lat: number, lon: number, label: string): void {
  const saved = setManualLocation(lat, lon, label);
  if (saved) useManualLocation(saved);
}

function showManualLocationCard(saved: ManualLoc): void {
  showLayerCard({
    kicker: "Your location (set by you)",
    title: saved.label || "My location",
    resetsCamera: false,
    rows: [
      ["Coordinates", `${saved.lat.toFixed(5)}Â°, ${saved.lon.toFixed(5)}Â°`],
      ["Source", "Set by hand and kept on this device. Not measured by GPS."]
    ],
    actions: [
      {
        label: "Directions from here",
        primary: true,
        run: () =>
          document.dispatchEvent(
            new CustomEvent("orbit:directions-point", { detail: { which: "A", lat: saved.lat, lon: saved.lon, label: "My location (set by you)" } })
          )
      },
      { label: "Pharmacies", run: () => searchNearby("pharmacy") },
      { label: "Gas", run: () => searchNearby("gas station") },
      { label: "Coffee", run: () => searchNearby("coffee") },
      { label: "Groceries", run: () => searchNearby("grocery") },
      { label: "Change", run: () => showLocationHelp("Tap the map or type a place to move your location.", "Change my location") },
      {
        label: "Clear",
        run: () => {
          clearManualLocation();
          if (userLoc?.manual) userLoc = null;
          meDataSource.entities.removeAll();
          viewer.scene.requestRender();
          closeLayerCardByUser();
        }
      }
    ]
  });
}

/** Explains why the device position isn't available and offers the manual ways to set one (tap the map, type a place). */
function showLocationHelp(message: string, title = "Couldn't get your location"): void {
  const body = document.createElement("div");
  const note = document.createElement("p");
  note.className = "layer-panel-note";
  note.textContent = message;
  body.append(note, buildPlaceFinder((lat, lon, label) => applyManualLocation(lat, lon, label), () => searchCenter()));
  showLayerCard({
    kicker: "Your location",
    title,
    resetsCamera: false,
    body,
    actions: [{ label: "Tap the map to set it", primary: true, run: startPickMyLocation }]
  });
}

function stopPickMyLocation(): void {
  pickingMyLocation = false;
  pickHintEl?.classList.add("hidden");
}

/** The next tap on the globe becomes "my location". */
function startPickMyLocation(): void {
  closeLayerCardByUser();
  pickingMyLocation = true;
  if (!pickHintEl) {
    pickHintEl = document.createElement("div");
    pickHintEl.id = "pick-location-hint";
    pickHintEl.className = "pick-location-hint";
    const text = document.createElement("span");
    text.textContent = "Tap the map where you are";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", stopPickMyLocation);
    pickHintEl.append(text, cancel);
    document.body.append(pickHintEl);
  }
  pickHintEl.classList.remove("hidden");
}

/** Called from the globe's click handler while picking: turns the tapped point into the manual location. */
function finishPickMyLocation(position: Cartesian2): void {
  const spot = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
  if (!spot) return; // tapped the sky: keep waiting
  const c = Cartographic.fromCartesian(spot);
  stopPickMyLocation();
  applyManualLocation(CesiumMath.toDegrees(c.latitude), CesiumMath.toDegrees(c.longitude), "");
}

// A point set by hand earlier on this device is shown straight away (it needs no permission).
{
  const savedManual = getManualLocation();
  if (savedManual) {
    userLoc = { lat: savedManual.lat, lon: savedManual.lon, accuracyM: 15, at: Date.now(), manual: true };
    drawMyLocation(userLoc);
  }
}

document.addEventListener("orbit:use-my-location", (ev) => {
  const which = (ev as CustomEvent<{ which: "A" | "B" }>).detail?.which ?? "A";
  void locateMe({ fly: false, card: false }).then((loc) => {
    if (loc) {
      document.dispatchEvent(
        new CustomEvent("orbit:directions-point", { detail: { which, lat: loc.lat, lon: loc.lon, label: loc.manual ? "My location (set by you)" : "My location" } })
      );
    }
  });
});

/** Pins a store or place on the globe and shows its details. */
function showStoreOnMap(p: StorePoi): void {
  const entities = placeSearchDataSource.entities;
  entities.removeById("poi-pin");
  entities.add({
    id: "poi-pin",
    position: Cartesian3.fromDegrees(p.lon, p.lat, 0),
    point: {
      pixelSize: 14,
      color: Color.fromCssColorString("#30d158"),
      outlineColor: Color.WHITE,
      outlineWidth: 3,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      heightReference: HeightReference.CLAMP_TO_GROUND,
      text: p.name,
      font: '600 12px -apple-system, "SF Pro Text", Inter, sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      style: 2,
      pixelOffset: new Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });
  viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(p.lon, p.lat, 2200), duration: 1.8 });
  showLayerCard({
    kicker: p.kind,
    title: p.name,
    resetsCamera: false,
    rows: [
      ...(p.address ? ([["Address", p.address]] as Array<[string, string]>) : []),
      ...(p.distanceKm != null ? ([["Distance", `${p.distanceKm} km from ${userLoc && (userLoc.manual || Date.now() - userLoc.at < 3_600_000) ? "you" : "the map centre"}`]] as Array<[string, string]>) : []),
      ["Coordinates", `${p.lat.toFixed(5)}°, ${p.lon.toFixed(5)}°`]
    ],
    actions: [
      {
        label: "Directions here",
        primary: true,
        run: () =>
          document.dispatchEvent(new CustomEvent("orbit:directions-point", { detail: { which: "B", lat: p.lat, lon: p.lon, label: p.name } }))
      }
    ],
    links: p.osm ? [{ label: "OpenStreetMap", href: `https://www.openstreetmap.org/${p.osm}` }] : [],
    onClose: () => {
      entities.removeById("poi-pin");
      viewer.scene.requestRender();
    }
  });
}

/**
 * The search box in the top bar. One box finds:
 *  - places and addresses (OpenStreetMap), which fly the globe there with a pin and a place card;
 *  - aircraft by callsign, ICAO hex, registration, airline or type (on the map now, or anywhere via a live lookup);
 *  - satellites by name, NORAD number, operator, country or purpose (e.g. "spacex", "starlink", "25544");
 *  - ALPR cameras by vendor or operator (e.g. "flock", "atlanta police") among those loaded on the map.
 * The box collapses to a magnifier while Directions is open (the From/To boxes take over the bar).
 */
function setupLocationSearch(): void {
  const root = document.getElementById("loc-search");
  const btn = document.getElementById("loc-search-btn");
  const input = document.getElementById("loc-search-input") as HTMLInputElement | null;
  const box = document.getElementById("loc-suggest");
  if (!root || !btn || !input || !box) return;

  type Remote = { hex: string; callsign: string | null; registration: string | null; type: string | null; lat: number; lon: number; altFt: number | null };
  let seq = 0;
  let timer: number | null = null;
  let places: GeoHit[] = [];
  let placeNote: string | null = null;
  let remotePlanes: Remote[] = [];
  let prefixes: string[] = [];
  let stores: StorePoi[] = [];
  let query = "";

  const hide = (): void => box.classList.add("hidden");
  const closeCompact = (): void => {
    if (root.classList.contains("compact")) root.classList.remove("open");
  };
  const finish = (label: string): void => {
    hide();
    input.value = label;
    input.blur();
    closeCompact();
  };

  const turnOnLayer = (toggleId: string, isOn: () => boolean): void => {
    if (!isOn()) document.getElementById(toggleId)?.click();
  };
  const waitFor = (test: () => boolean, ms: number, then: () => void): void => {
    let waited = 0;
    const t = window.setInterval(() => {
      waited += 400;
      if (test()) {
        window.clearInterval(t);
        then();
      } else if (waited >= ms) window.clearInterval(t);
    }, 400);
  };

  // ----- actions -----
  let pickSeq = 0;
  const goPlace = (hit: GeoHit): void => {
    finish(hit.displayName.split(",").slice(0, 2).join(",").trim());
    flyGlobeToNominatimHit(hit);
    selectGeocodePlace(hit);
    // Type-ahead results carry little detail: fetch the full OpenStreetMap record once, after the click.
    const mine = ++pickSeq;
    if (hit.osm) {
      void enrichHit(hit).then((full) => {
        if (full && mine === pickSeq) selectGeocodePlace(full);
      });
    }
  };

  const goPlane = (entityId: string, ac: NormalizedAircraft): void => {
    finish(sanitizeCallsign(ac.callsign) ?? ac.icao24.toUpperCase());
    turnOnLayer("toggle-planes", () => planesVisible);
    ensurePlaneTrafficCategoryEnabled(classifyAircraftTraffic(classifyInputFromNormalized(ac)));
    selectPlane(entityId, { flyTo: true });
  };

  const goRemotePlane = (r: Remote): void => {
    finish(r.callsign ?? r.registration ?? r.hex.toUpperCase());
    turnOnLayer("toggle-planes", () => planesVisible);
    const id = `plane-${r.hex}`;
    if (trackedPlanes.has(id)) {
      const ac = trackedPlanes.get(id)!;
      ensurePlaneTrafficCategoryEnabled(classifyAircraftTraffic(classifyInputFromNormalized(ac)));
      selectPlane(id, { flyTo: true });
      return;
    }
    // Not in the feed for the current view: fly to where it is, and pick it up as soon as the feed includes it.
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(r.lon, r.lat, 350_000), duration: 2.2 });
    waitFor(
      () => trackedPlanes.has(id),
      25_000,
      () => {
        const ac = trackedPlanes.get(id);
        if (ac) ensurePlaneTrafficCategoryEnabled(classifyAircraftTraffic(classifyInputFromNormalized(ac)));
        selectPlane(id, { flyTo: true });
      }
    );
  };

  const goSatellite = (entityId: string, name: string): void => {
    finish(name);
    turnOnLayer("toggle-satellites", () => satellitesVisible);
    const focus = (): void => {
      selectSatellite(entityId);
      const p = satellitesDataSource.entities.getById(entityId)?.position?.getValue(JulianDate.now());
      if (p) {
        viewer.camera.flyToBoundingSphere(new BoundingSphere(p, 80_000), {
          offset: new HeadingPitchRange(0, -0.6, 5_500_000),
          duration: 2.2
        });
      }
    };
    if (satellitesDataSource.entities.getById(entityId)) focus();
    else waitFor(() => !!satellitesDataSource.entities.getById(entityId), 20_000, focus);
  };

  const goAlpr = (group: AlprGroup): void => {
    finish(group.name);
    turnOnLayer("toggle-alpr", () => alprVisible);
    const c = getViewCenterLatLon();
    let best = group.sites[0]!;
    if (c) {
      let bd = Infinity;
      for (const s of group.sites) {
        const d = (s.latitude - c.lat) ** 2 + ((s.longitude - c.lon) * Math.cos((c.lat * Math.PI) / 180)) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
    }
    // selectAlprSite flies straight down to it.
    selectAlprSite(`alpr-site-${slugAlprEntityId(best.id)}`);
  };

  // ----- rendering -----
  const section = (title: string): void => {
    const h = document.createElement("div");
    h.className = "dir-suggest-head";
    h.textContent = title;
    box.append(h);
  };
  const row = (label: string, sub: string | null, run: () => void): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dir-suggest-row";
    const main = document.createElement("span");
    main.textContent = label.length > 96 ? `${label.slice(0, 93)}…` : label;
    b.append(main);
    if (sub) {
      const s = document.createElement("small");
      s.textContent = sub;
      b.append(s);
    }
    b.addEventListener("mousedown", (ev) => ev.preventDefault());
    b.addEventListener("click", run);
    box.append(b);
  };

  const renderEmpty = (): void => {
    box.textContent = "";
    row("My location", "Fly to where you are", () => {
      hide();
      void locateMe();
    });
    const hint = document.createElement("div");
    hint.className = "dir-suggest-empty";
    hint.textContent = "Search a place or address, a store (walmart, pharmacy), a flight (DAL123), a satellite (starlink, 25544) or ALPR cameras (flock).";
    box.append(hint);
    box.classList.remove("hidden");
  };

  const render = (): void => {
    box.textContent = "";
    const q = query;
    if (q.length < 2) {
      hide();
      return;
    }

    // Aircraft: on the map now, then live lookups for ones that aren't.
    const local = searchPlanesLocal(trackedPlanes, q, prefixes, 4);
    const shown = new Set(local.hits.map((h) => h.ac.icao24.toLowerCase()));
    const extra = remotePlanes.filter((r) => !shown.has(r.hex));
    if (local.hits.length || extra.length) {
      section("Aircraft");
      for (const h of local.hits) row(h.label, "On the map", () => goPlane(h.entityId, h.ac));
      for (const r of extra) {
        row(
          [r.callsign ?? r.registration ?? r.hex.toUpperCase(), r.type, r.registration && r.callsign ? r.registration : null].filter(Boolean).join(" · "),
          `Flying now${r.altFt != null ? ` · ${Math.round(r.altFt).toLocaleString()} ft` : ""}`,
          () => goRemotePlane(r)
        );
      }
      if (local.total > local.hits.length) {
        const more = document.createElement("div");
        more.className = "dir-suggest-empty";
        more.textContent = `+${local.total - local.hits.length} more aircraft match — keep typing to narrow it down`;
        box.append(more);
      }
    }

    // Satellites
    const sat = searchSatellites(trackedEntities, q, 4);
    if (sat.hits.length) {
      section("Satellites");
      for (const h of sat.hits) {
        row(h.sat.name, [h.operator, `NORAD ${h.sat.noradId}`].filter(Boolean).join(" · "), () => goSatellite(h.entityId, h.sat.name));
      }
      if (sat.total > sat.hits.length) {
        const more = document.createElement("div");
        more.className = "dir-suggest-empty";
        more.textContent = `+${(sat.total - sat.hits.length).toLocaleString()} more satellites match`;
        box.append(more);
      }
    }

    // ALPR cameras
    const groups = searchAlpr(alprLayer.filteredSites(), q, 4);
    if (groups.length) {
      section("ALPR cameras");
      for (const g of groups) {
        row(g.name, `${g.kind === "vendor" ? "Vendor" : "Operator"} · ${g.sites.length.toLocaleString()} loaded — fly to the nearest`, () => goAlpr(g));
      }
    }

    // Stores and other businesses near the user (or the middle of the map)
    if (stores.length) {
      section("Stores & places nearby");
      for (const s of stores.slice(0, 5)) {
        row(s.name, [s.kind, s.address, s.distanceKm != null ? `${s.distanceKm} km` : null].filter(Boolean).join(" · "), () => {
          finish(s.name);
          showStoreOnMap(s);
        });
      }
    }

    // Places
    if (places.length || placeNote) {
      section("Places");
      if (placeNote) {
        const n = document.createElement("div");
        n.className = "dir-suggest-empty";
        n.textContent = placeNote;
        box.append(n);
      }
      for (const h of places.slice(0, 5)) row(h.displayName, h.isAddress ? "Street address" : null, () => goPlace(h));
    }

    // Layers that have to be on before their things can be found.
    const off: string[] = [];
    if (!satellitesVisible && trackedEntities.size === 0) off.push("SAT");
    if (!alprVisible) off.push("ALPR");
    if (off.length && !box.querySelector(".dir-suggest-row") && placeNote === null) {
      const n = document.createElement("div");
      n.className = "dir-suggest-empty";
      n.textContent = `Searching… (turn ${off.join(" / ")} on to search satellites and ALPR cameras)`;
      box.append(n);
    }
    if (box.childElementCount === 0) {
      const n = document.createElement("div");
      n.className = "dir-suggest-empty";
      n.textContent = "Searching…";
      box.append(n);
    }
    box.classList.remove("hidden");
  };

  const searchRemote = async (q: string, submit = false): Promise<void> => {
    const mine = ++seq;
    placeNote = null;
    const airline = airlinePrefixesForName(q).then((p) => {
      if (mine === seq) prefixes = p;
    });
    const planes = fetch(`/api/layers/aircraft-search?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ results: Remote[] }>) : { results: [] as Remote[] }))
      .then((j) => {
        if (mine === seq) remotePlanes = j.results;
      })
      .catch(() => {});
    const center = searchCenter();
    const storesP = center
      ? fetch(`/api/layers/poi?q=${encodeURIComponent(q)}&lat=${center.lat.toFixed(4)}&lon=${center.lon.toFixed(4)}`)
          .then((r) => (r.ok ? (r.json() as Promise<{ results: StorePoi[] }>) : { results: [] as StorePoi[] }))
          .then((j) => {
            if (mine === seq) stores = j.results;
          })
          .catch(() => {})
      : Promise.resolve();
    await Promise.all([airline, planes, storesP]);
    if (mine === seq) render();

    try {
      // Addresses (US Census) and places (Photon), nearest first; Enter (`submit`) may also ask Nominatim.
      const found = await searchGeocode(q, { bias: searchCenter(), submit });
      if (mine !== seq) return;
      places = found.hits;
      placeNote = found.hits.length ? null : found.unavailable.length ? "The address lookup is busy or offline. Try again in a moment." : "No matching places. Try adding a city and state (for example 100 Main St, Springfield IL). House-number street addresses work in the US only; places work worldwide.";
    } catch (e) {
      if (mine !== seq) return;
      places = [];
      placeNote = e instanceof Error ? e.message.slice(0, 100) : "Place search unavailable right now.";
    }
    render();
  };

  btn.addEventListener("click", () => {
    if (root.classList.contains("compact")) root.classList.toggle("open");
    if (!root.classList.contains("compact") || root.classList.contains("open")) window.setTimeout(() => input.focus(), 30);
  });
  document.getElementById("loc-locate-btn")?.addEventListener("click", () => {
    hide();
    void locateMe();
  });
  input.addEventListener("focus", () => {
    if (input.value.trim().length === 0) {
      query = "";
      renderEmpty();
    }
  });
  input.addEventListener("input", () => {
    if (timer != null) window.clearTimeout(timer);
    query = input.value.trim();
    seq++;
    places = [];
    placeNote = null;
    remotePlanes = [];
    prefixes = [];
    stores = [];
    if (query.length === 0) {
      renderEmpty();
      return;
    }
    if (query.length < 2) {
      hide();
      return;
    }
    render(); // instant results from what the map already holds
    timer = window.setTimeout(() => void searchRemote(query), 550);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      input.value = "";
      query = "";
      hide();
      closeCompact();
      input.blur();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const first = box.querySelector<HTMLElement>(".dir-suggest-row");
      if (first) first.click();
      else if (query.length >= 2) void searchRemote(query, true);
    }
  });
  document.addEventListener("click", (ev) => {
    if (!root.contains(ev.target as Node)) {
      hide();
      closeCompact();
    }
  });
  // "/" jumps to the search box, like most sites.
  window.addEventListener("keydown", (ev) => {
    if (ev.key !== "/" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    ev.preventDefault();
    if (root.classList.contains("compact")) root.classList.add("open");
    input.focus();
  });
}

function setupAlprPlaceSearch(): void {
  const inputEl = document.getElementById("alpr-place-search-input") as HTMLInputElement | null;
  const goBtn = document.getElementById("alpr-place-search-go");
  const feedbackEl = document.getElementById("alpr-place-search-feedback");
  const resultsEl = document.getElementById("alpr-place-search-results");
  if (!inputEl || !goBtn || !feedbackEl || !resultsEl) return;

  const clearUi = (): void => {
    feedbackEl.textContent = "";
    resultsEl.innerHTML = "";
    resultsEl.hidden = true;
  };

  const runSearch = async (): Promise<void> => {
    const q = inputEl.value.trim();
    if (!q) {
      clearUi();
      return;
    }

    feedbackEl.textContent = "Searching…";
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";

    try {
      const hits = await searchNominatimPlaces(q);
      if (hits.length === 0) {
        feedbackEl.textContent = "No results — try a different spelling or a broader place name.";
        return;
      }

      if (hits.length === 1) {
        feedbackEl.textContent = `Flying to: ${hits[0].displayName.slice(0, 72)}${hits[0].displayName.length > 72 ? "…" : ""}`;
        flyGlobeToNominatimHit(hits[0]);
        return;
      }

      feedbackEl.textContent = `${hits.length} matches — pick one:`;
      resultsEl.hidden = false;
      for (const h of hits) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "plane-search-hit";
        const label = h.displayName;
        b.textContent = label.length > 96 ? `${label.slice(0, 93)}…` : label;
        b.addEventListener("click", () => {
          feedbackEl.textContent = `Flying to: ${label.slice(0, 72)}${label.length > 72 ? "…" : ""}`;
          resultsEl.hidden = true;
          flyGlobeToNominatimHit(h);
        });
        resultsEl.appendChild(b);
      }
    } catch (e) {
      console.warn("[alpr] place search failed:", e);
      feedbackEl.textContent =
        e instanceof Error ? e.message.slice(0, 140) : "Search failed — try again or check dev /nominatim-proxy.";
    }
  };

  goBtn.addEventListener("click", () => void runSearch());
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      inputEl.value = "";
      clearUi();
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") void runSearch();
  });
}

function resetInfoPanelTitles(): void {
  toggleAircraftOnlyInfoRows(false);
  if (infoTitleEl) infoTitleEl.textContent = "Selected Satellite";
  if (infoL1El) infoL1El.textContent = "Operator";
  if (infoL2El) infoL2El.textContent = "Operator Country";
  if (infoL3El) infoL3El.textContent = "Speed";
  if (infoL4El) infoL4El.textContent = "Purpose";
  if (infoL5El) infoL5El.textContent = "Data Source";
  satNameEl?.classList.remove("hidden");
  if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "SIGINT";
  showCoreInfoRows();
  hideAlprDetailRows();
}

function setAircraftPanelLabels(): void {
  toggleAircraftOnlyInfoRows(true);
  if (infoTitleEl) infoTitleEl.textContent = "Selected Aircraft";
  if (infoL1El) infoL1El.textContent = "Type";
  const trafficLbl = document.getElementById("info-traffic");
  const carrierLbl = document.getElementById("info-flight-carrier-lbl");
  const asHintLbl = document.getElementById("info-aviationstack-hint-lbl");
  if (trafficLbl) trafficLbl.textContent = "Traffic bucket";
  if (carrierLbl) carrierLbl.textContent = "Carrier (flight ID)";
  if (asHintLbl) asHintLbl.textContent = "Airline destination data";
  if (infoL2El) infoL2El.textContent = "Operator Country / Registration";
  if (infoL3El) infoL3El.textContent = "Speed / track";
  if (infoL4El) infoL4El.textContent = "Altitude";
  if (infoL5El) infoL5El.textContent = "Data Source";
}

function hidePlaneRouteSection(): void {
  planeRouteBlockEl?.classList.add("hidden");
}

function preloadPlaneSupportingData(): void {
  void ensureAirlinePrefixesLoaded().catch(() => {});
}

/** True when Aviationstack can be called: dev proxy has a key, or production API base is set. */
async function isAviationstackClientConfigured(): Promise<boolean> {
  if (!import.meta.env.DEV) {
    return !!(import.meta.env.VITE_AVIATIONSTACK_API_BASE as string | undefined)?.trim();
  }
  aviationstackConfiguredProbe ??= (async () => {
    try {
      const res = await fetch("/aviationstack-proxy/v1/flights?limit=1");
      return res.status !== 503;
    } catch {
      return false;
    }
  })();
  return aviationstackConfiguredProbe;
}

function hideAirlineDestinationDataRow(): void {
  planeAviationstackHintRowEl?.classList.add("hidden");
}

/** Keeps “Airline destination data” populated: setup hints, fetching state, route summary once APIs resolve. */
function syncAirlineDestinationDataRow(aircraft: NormalizedAircraft, bucket: PlaneTrafficKind): void {
  if (!planeAviationstackHintRowEl || !satAviationstackHintEl) return;
  if (bucket !== "airline") {
    hideAirlineDestinationDataRow();
    return;
  }

  aviationstackHintSeq++;
  const hk = aviationstackHintSeq;

  planeAviationstackHintRowEl.classList.remove("hidden");

  const toTxt = selectedPlaneRouteToText.trim();
  const fromTxt = selectedPlaneRouteFromText.trim();

  const showFetching =
    toTxt === "Retrieving…" ||
    fromTxt === "Retrieving…" ||
    (toTxt === "" && fromTxt === "");
  if (showFetching) {
    satAviationstackHintEl.textContent =
      sanitizeCallsign(aircraft.callsign) ? "Fetching route & destination…" : "—";
  }

  void (async () => {
    const ok = await isAviationstackClientConfigured();
    if (hk !== aviationstackHintSeq) return;
    if (!selectedPlaneId || trackedPlanes.get(selectedPlaneId)?.icao24 !== aircraft.icao24) return;
    if (!satAviationstackHintEl) return;

    if (!ok) {
      satAviationstackHintEl.textContent = import.meta.env.DEV
        ? "Add AVIATIONSTACK_ACCESS_KEY to .env.local for flight-status airports (restart npm run dev)."
        : "Airports for this flight aren't available in this build (they need a hosted lookup service).";
      return;
    }

    const toLine = selectedPlaneRouteToText.trim();
    const fromLine = selectedPlaneRouteFromText.trim();

    if (toLine === "Retrieving…" || fromLine === "Retrieving…") {
      satAviationstackHintEl.textContent = sanitizeCallsign(aircraft.callsign)
        ? "Fetching route & destination…"
        : "—";
      return;
    }

    if (
      typeof selectedPlaneRouteHint === "string" &&
      selectedPlaneRouteHint.trim() &&
      toLine !== "Not available"
    ) {
      satAviationstackHintEl.textContent = selectedPlaneRouteHint.trim();
      return;
    }

    const hasArrival =
      toLine &&
      toLine !== "Not available" &&
      !toLine.includes("Ahead on track") &&
      !toLine.includes("240 NM ahead");
    const hasDeparture =
      fromLine &&
      fromLine !== "Not available" &&
      fromLine !== "Current ADS-B position";

    if (hasDeparture && hasArrival) {
      satAviationstackHintEl.textContent = `${fromLine} ←→ ${toLine}`;
      return;
    }

    if (hasArrival) {
      satAviationstackHintEl.textContent = `Destination: ${toLine}`;
      return;
    }

    satAviationstackHintEl.textContent =
      "No Aviationstack flight match for this ID/date. Confirm flight field looks like DAL123 or DL123 · OpenSky may still populate Estimated route below.";
  })();
}

function syncPlaneRouteSectionToPanel(): void {
  if (!planeRouteBlockEl) return;
  planeRouteBlockEl.classList.remove("hidden");
  if (satRouteFromEl)
    satRouteFromEl.textContent =
      selectedPlaneRouteFromText.trim() || "—";
  if (satRouteToEl)
    satRouteToEl.textContent =
      selectedPlaneRouteToText.trim() || "—";
}

function getViewCenterLatLon(): { lat: number; lon: number } | null {
  const canvas = viewer.scene.canvas;
  const center = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const picked = viewer.camera.pickEllipsoid(center, viewer.scene.globe.ellipsoid);
  if (!picked) return null;
  const c = Cartographic.fromCartesian(picked);
  return {
    lat: CesiumMath.toDegrees(c.latitude),
    lon: CesiumMath.toDegrees(c.longitude)
  };
}

type PxRect = { left: number; top: number; right: number; bottom: number };

/**
 * The part of the globe canvas not covered by the layer panel / intel card, in canvas CSS pixels.
 * Overlays that span most of the width are top/bottom docks (phone layout); narrow ones are side columns.
 */
function mapFreeRect(): PxRect {
  const canvas = viewer.scene.canvas;
  const cr = canvas.getBoundingClientRect();
  const full: PxRect = { left: 0, top: 0, right: cr.width, bottom: cr.height };
  // On a phone the bars float over a full-screen globe and the sheets are hidden until opened, so the planet
  // simply sits in the middle of the screen.
  if (window.matchMedia("(max-width: 720px)").matches) return full;
  const free = { ...full };
  const consider = (el: Element | null): void => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    const x0 = r.left - cr.left;
    const x1 = r.right - cr.left;
    const y0 = r.top - cr.top;
    const y1 = r.bottom - cr.top;
    if (x1 - x0 > cr.width * 0.6) {
      if ((y0 + y1) / 2 < cr.height / 2) free.top = Math.max(free.top, y1);
      else free.bottom = Math.min(free.bottom, y0);
    } else if ((x0 + x1) / 2 < cr.width / 2) {
      free.left = Math.max(free.left, x1);
    } else {
      free.right = Math.min(free.right, x0);
    }
  };
  consider(document.querySelector(".map-overlay-left"));
  consider(document.querySelector(".map-overlay-right .sidebar-stack"));
  return free.right - free.left < 120 || free.bottom - free.top < 120 ? full : free;
}

/**
 * Frames the whole Earth: keeps the point the user is looking at as the viewing direction, backs straight
 * out along it (so the planet is round and nothing is cropped) and slides the view so the planet sits in the
 * middle of the area not covered by panels. Plain camera translation — no frustum tricks — so picking,
 * dragging and zooming keep working normally afterwards.
 */
function frameEarth(opts: { duration?: number; fill?: number } = {}): void {
  const canvas = viewer.scene.canvas;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (W < 50 || H < 50) return;

  const free = mapFreeRect();
  const fw = free.right - free.left;
  const fh = free.bottom - free.top;
  const sx = (free.left + free.right) / 2 - W / 2; // Earth should appear this many px right of centre
  const sy = H / 2 - (free.top + free.bottom) / 2; // …and this many px above centre

  const frustum = viewer.camera.frustum;
  const fovy = frustum instanceof PerspectiveFrustum && frustum.fovy ? frustum.fovy : CesiumMath.toRadians(45);
  const focalPx = H / 2 / Math.tan(fovy / 2);
  const alpha = Math.atan(((opts.fill ?? 0.8) * Math.min(fw, fh)) / 2 / focalPx);
  const distance = Ellipsoid.WGS84.maximumRadius / Math.sin(alpha);

  const look =
    getViewCenterLatLon() ??
    (() => {
      const c = viewer.camera.positionCartographic;
      return { lat: CesiumMath.toDegrees(c.latitude), lon: CesiumMath.toDegrees(c.longitude) };
    })();
  const dir = Cartesian3.normalize(Cartesian3.fromDegrees(look.lon, look.lat, 0), new Cartesian3());
  const east = Cartesian3.cross(Cartesian3.UNIT_Z, dir, new Cartesian3());
  if (Cartesian3.magnitude(east) < 1e-6) Cartesian3.clone(Cartesian3.UNIT_X, east); // exactly over a pole
  Cartesian3.normalize(east, east);
  const north = Cartesian3.cross(dir, east, new Cartesian3());

  const position = Cartesian3.multiplyByScalar(dir, distance, new Cartesian3());
  Cartesian3.subtract(position, Cartesian3.multiplyByScalar(east, (sx * distance) / focalPx, new Cartesian3()), position);
  Cartesian3.subtract(position, Cartesian3.multiplyByScalar(north, (sy * distance) / focalPx, new Cartesian3()), position);

  const orientation = { direction: Cartesian3.negate(dir, new Cartesian3()), up: north };
  if (opts.duration === 0) {
    viewer.camera.setView({ destination: position, orientation });
  } else {
    viewer.camera.flyTo({ destination: position, orientation, duration: opts.duration ?? 1.4 });
  }
  viewer.scene.requestRender();
}

if (import.meta.env.DEV) {
  (window as unknown as { __orbit?: unknown }).__orbit = {
    viewer,
    frameEarth,
    mapFreeRect,
    selectPlane: (id: string) => selectPlane(id),
    selectSatellite: (id: string) => selectSatellite(id),
    selectVessel: (id: string) => selectVessel(id),
    registerNotable,
    get trackedPlanes() {
      return trackedPlanes;
    },
    get vessels() {
      return vesselTrackByMmsi;
    }
  };
}

/**
 * NM radius for the server aircraft query (max 250 NM). Larger bubble = more traffic, capped by the API.
 * We bias toward the max for typical globe distances — you only ever see planes inside this circle around
 * the screen center, not “everything in the air”.
 */
function planeSearchRadiusNm(): number {
  const carto = viewer.camera.positionCartographic;
  const h = carto?.height ?? 500_000;
  if (h > 200_000) return 250;
  if (h > 85_000) return 170;
  if (h > 35_000) return 110;
  if (h > 12_000) return 75;
  return 50;
}

/** Top-down silhouette (nose toward top of image = north); tint is mostly visible on anti-aliased edges. */

function altitudeFtToMeters(altFt: number | null | undefined): number | null {
  if (altFt == null || Number.isNaN(altFt)) return null;
  return altFt * 0.3048;
}

/** Applies selection / hover / traffic-class styling to one aircraft entity (called on change, never per frame). */
function restylePlane(id: string | null): void {
  if (!id) return;
  const entity = planesDataSource.entities.getById(id);
  if (!entity?.billboard) return;
  const row = planeTrackByHex.get(id.slice("plane-".length));
  const kind = row ? classifyAircraftTraffic(classifyInputFromNormalized(row.ac)) : "other";
  const shape = row ? planeShapeFor(row.ac, kind) : "jet";
  const selected = selectedPlaneId === id;
  const hovered = hoveredPlaneEntityId === id;
  const glowing = notableGlowEnabled && !!row && !!notableFor(row.ac.icao24);
  const state = glowing ? "notable" : selected ? "selected" : hovered ? "hover" : "normal";
  const bb = entity.billboard as any;
  const url = planeIconUrl(shape, planeTrafficColorCss(kind), state, notableFrame);
  if (bb.image?.getValue?.() !== url) bb.image = url;
  // Glowing icons carry extra bitmap padding for the halo, so they are drawn larger to keep the plane the same size.
  const base = glowing ? 0.62 : 0.36;
  bb.scale = selected ? base * 1.4 : hovered ? base * 1.17 : base;

  // Owner name under glowing aircraft (kept cheap: only notable planes ever carry a label).
  const owner = glowing ? notableFor(row!.ac.icao24)?.owner : undefined;
  if (owner) {
    if ((entity.label as any)?.text?.getValue?.() !== owner) {
      (entity as any).label = {
        text: owner,
        font: '600 13px -apple-system, "SF Pro Text", Inter, "Helvetica Neue", Arial, sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString("#1d1d1f"),
        outlineWidth: 4,
        style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, 34),
        verticalOrigin: VerticalOrigin.TOP,
        showBackground: false,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 3_500_000),
        disableDepthTestDistance: horizonDepthTest(viewer.camera)
      };
    }
  } else if (entity.label) {
    (entity as any).label = undefined;
  }
}

/** Highlight (and always show) aircraft from the notable-owner registry. */
let notableGlowEnabled = true;
let notableFrame = 0;

function restyleNotablePlanes(): void {
  if (!planesVisible || !notableGlowEnabled) return;
  let any = false;
  for (const hex of planeTrackByHex.keys()) {
    if (!notableFor(hex)) continue;
    restylePlane(`plane-${hex}`);
    any = true;
  }
  if (any) viewer.scene.requestRender();
}

window.setInterval(() => {
  notableFrame = (notableFrame + 1) % 3;
  if (!document.hidden) restyleNotablePlanes();
}, 420);

void loadNotableAircraft().then(() => {
  restyleNotablePlanes();
  applyPlaneCategoryVisibility();
  renderNotableList();
});

/** Browsable list of every registry owner; ones airborne right now come first and fly the globe to the aircraft. */
let notableLive = new Map<string, LiveNotable>();
let notableListOpen = false;
let notableListTimer: number | null = null;

function renderNotableList(): void {
  const body = document.getElementById("notable-list-body");
  const count = document.getElementById("notable-list-count");
  if (!body || !count) return;
  const all = listNotables();
  const live = all.filter((a) => notableLive.has(a.hex));
  count.textContent = all.length ? `${live.length} in the air · ${all.length} tracked` : "";
  if (!notableListOpen) return;
  body.textContent = "";
  const sorted = [...all].sort((a, b) => {
    const la = notableLive.has(a.hex) ? 0 : 1;
    const lb = notableLive.has(b.hex) ? 0 : 1;
    return la - lb || a.owner.localeCompare(b.owner);
  });
  for (const a of sorted) {
    const l = notableLive.get(a.hex);
    const row = summaryEl("button", `notable-row${l ? " is-live" : ""}`);
    row.type = "button";
    row.dataset.hex = a.hex;
    row.disabled = !l;
    row.title = l ? "Fly to this aircraft" : "Not airborne right now";
    row.append(
      summaryEl("span", "notable-owner", a.owner),
      summaryEl(
        "small",
        undefined,
        l
          ? `In the air${l.altitudeFt != null ? ` · ${Math.round(l.altitudeFt).toLocaleString()} ft` : ""}`
          : [a.type, a.registration].filter(Boolean).join(" · ") || "On the ground / not reporting"
      )
    );
    body.append(row);
  }
}

async function refreshNotableLive(): Promise<void> {
  const live = await fetchLiveNotables();
  notableLive = new Map(live.map((l) => [l.hex, l]));
  renderNotableList();
}

document.getElementById("notable-list-toggle")?.addEventListener("click", (ev) => {
  notableListOpen = !notableListOpen;
  (ev.currentTarget as HTMLElement).setAttribute("aria-expanded", String(notableListOpen));
  document.getElementById("notable-list-body")?.classList.toggle("hidden", !notableListOpen);
  if (notableListTimer != null) {
    window.clearInterval(notableListTimer);
    notableListTimer = null;
  }
  if (notableListOpen) {
    renderNotableList();
    void refreshNotableLive();
    notableListTimer = window.setInterval(() => void refreshNotableLive(), 60_000);
  }
});

document.getElementById("notable-list-body")?.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-hex]");
  const l = btn?.dataset.hex ? notableLive.get(btn.dataset.hex) : undefined;
  if (!l) return;
  if (!planesVisible) toggleAircraftLayerForNotable();
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(l.lon, l.lat, 350_000),
    duration: 2.2
  });
  // The aircraft joins the normal feed once the camera arrives; select it as soon as it shows up.
  const id = `plane-${l.hex}`;
  let tries = 0;
  const wait = window.setInterval(() => {
    tries++;
    if (trackedPlanes.has(id)) {
      window.clearInterval(wait);
      selectPlane(id);
    } else if (tries > 40) window.clearInterval(wait);
  }, 500);
});

function toggleAircraftLayerForNotable(): void {
  document.getElementById("toggle-planes")?.click();
}

/** Full size up close, shrinking to 25% by ~6,000 km so ~1,000 aircraft don't merge into one blob at wide zoom. */
const PLANE_SCALE_BY_DISTANCE = new NearFarScalar(3e5, 1, 6e6, 0.25);
const KT_TO_MS = 0.514444;
const FPM_TO_MS = 0.00508;
/** Don't extrapolate older fixes than this; the feed just hasn't heard from the aircraft. */
const PLANE_MAX_EXTRAPOLATE_S = 90;
const scratchPlaneCartesian = new Cartesian3();
const scratchUp = new Cartesian3();
const scratchEast = new Cartesian3();
const scratchNorth = new Cartesian3();

/**
 * World-space direction of travel at `position` for a compass heading (0° = north, 90° = east). Used as the
 * billboard's aligned axis so the nose points along the track from any camera angle, instead of a screen-space spin
 * that only matches when the view is north-up and top-down.
 */
function headingAxis(position: Cartesian3, headingDeg: number | null | undefined, out = new Cartesian3()): Cartesian3 {
  // Scratch vectors: this runs for every aircraft several times a second, so keep it allocation-free apart from `out`.
  const up = Ellipsoid.WGS84.geodeticSurfaceNormal(position, scratchUp);
  const east = Cartesian3.cross(Cartesian3.UNIT_Z, up, scratchEast);
  if (Cartesian3.magnitudeSquared(east) < 1e-12) Cartesian3.clone(Cartesian3.UNIT_X, east); // exactly at a pole
  Cartesian3.normalize(east, east);
  const north = Cartesian3.cross(up, east, scratchNorth);
  const h = typeof headingDeg === "number" && Number.isFinite(headingDeg) ? (headingDeg * Math.PI) / 180 : 0;
  Cartesian3.multiplyByScalar(north, Math.cos(h), north);
  Cartesian3.multiplyByScalar(east, Math.sin(h), east);
  return Cartesian3.normalize(Cartesian3.add(north, east, out), out);
}

/** Dead-reckons every airborne track from its last fix so icons glide instead of jumping each poll. */
let lastPlaneRenderAt = 0;

function advancePlanePositions(): void {
  if (!planesVisible || document.hidden) return;
  const now = Date.now();
  const entities = planesDataSource.entities;
  entities.suspendEvents();
  for (const [hex, row] of planeTrackByHex) {
    const ac = row.ac;
    const entity = entities.getById(`plane-${hex}`);
    if (!entity) continue;
    const dt = Math.min(PLANE_MAX_EXTRAPOLATE_S, Math.max(0, (now - row.fixMs) / 1000));
    let lat = ac.latitude;
    let lon = ac.longitude;
    let altM = altitudeFtToMeters(ac.altitudeFt) ?? 10_000 * 0.3048;
    if (!ac.onGround && ac.speedKt != null && ac.headingDeg != null && dt > 0) {
      const v = ac.speedKt * KT_TO_MS;
      const h = (ac.headingDeg * Math.PI) / 180;
      lat += (v * Math.cos(h) * dt) / 111_320;
      lon += (v * Math.sin(h) * dt) / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
      if (ac.verticalRateFpm != null) altM = Math.max(0, altM + ac.verticalRateFpm * FPM_TO_MS * dt);
    }
    Cartesian3.fromDegrees(lon, lat, altM, Ellipsoid.WGS84, scratchPlaneCartesian);
    const p = entity.position;
    if (p instanceof ConstantPositionProperty) p.setValue(scratchPlaneCartesian);
    else entity.position = new ConstantPositionProperty(Cartesian3.clone(scratchPlaneCartesian));
    (entity.billboard as any).alignedAxis = headingAxis(scratchPlaneCartesian, ac.headingDeg);
  }
  entities.resumeEvents();
  // Zoomed out, an aircraft moves less than a pixel a second, so redrawing the whole globe four times a second only
  // burns power and makes everything on top of the map flicker. Redraw that often only when it can be seen.
  if (viewer.camera.positionCartographic.height < 2_500_000 || now - lastPlaneRenderAt > 1000) {
    lastPlaneRenderAt = now;
    viewer.scene.requestRender();
  }
}

function rebuildTrackedPlanesMap(): void {
  trackedPlanes.clear();
  for (const [hex, { ac }] of planeTrackByHex) {
    const id = `plane-${hex}`;
    if (planesDataSource.entities.getById(id)) {
      trackedPlanes.set(id, ac);
    }
  }
}

function applyPlaneFeedSnapshot(aircraft: NormalizedAircraft[]): void {
  const entities = planesDataSource.entities;
  const previousSelection = selectedPlaneId;
  const now = Date.now();
  const feedHexes = new Set<string>();

  entities.suspendEvents();

  for (const ac of aircraft) {
    const hexKey = ac.icao24.trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hexKey)) continue;
    const lonN = ac.longitude;
    const latN = ac.latitude;
    if (typeof lonN !== "number" || typeof latN !== "number") continue;

    feedHexes.add(hexKey);
    const fixParsed = Date.parse(ac.lastSeen);
    const fixMs = Number.isFinite(fixParsed) ? Math.min(now, fixParsed) : now;
    planeTrackByHex.set(hexKey, { ac, lastSeenMs: now, fixMs });

    const altM = altitudeFtToMeters(ac.altitudeFt);
    const heightM = typeof altM === "number" && !Number.isNaN(altM) ? altM : 10_000 * 0.3048;
    const position = Cartesian3.fromDegrees(lonN, latN, heightM);
    const id = `plane-${hexKey}`;
    const existing = entities.getById(id);
    if (existing) {
      const p = existing.position;
      if (p instanceof ConstantPositionProperty) p.setValue(position);
      else existing.position = new ConstantPositionProperty(position);
      (existing.billboard as any).rotation = 0;
      (existing.billboard as any).alignedAxis = headingAxis(position, ac.headingDeg);
    } else {
      entities.add({
        id,
        position: new ConstantPositionProperty(position),
        /** One marker per aircraft: silhouette shape = aircraft type, color = traffic class (see restylePlane). */
        billboard: {
          image: planeIconUrl("jet", "#ffffff"),
          width: 128,
          height: 128,
          scale: 0.36,
          color: Color.WHITE,
          rotation: 0,
          alignedAxis: headingAxis(position, ac.headingDeg),
          verticalOrigin: VerticalOrigin.CENTER,
          horizontalOrigin: HorizontalOrigin.CENTER,
          // Hidden behind the Earth instead of drawn through it; near planes still skip the depth test (3D Photo).
          disableDepthTestDistance: horizonDepthTest(viewer.camera),
          scaleByDistance: PLANE_SCALE_BY_DISTANCE,
          translucencyByDistance: new NearFarScalar(1.5e6, 1, 8e6, 0.35)
        }
      });
    }
    restylePlane(id);
  }

  for (const [hexKey, row] of [...planeTrackByHex.entries()]) {
    if (feedHexes.has(hexKey)) continue;
    if (now - row.lastSeenMs > PLANE_TRACK_STALE_MS) {
      planeTrackByHex.delete(hexKey);
      const e = entities.getById(`plane-${hexKey}`);
      if (e) entities.remove(e);
    }
  }

  rebuildTrackedPlanesMap();

  entities.resumeEvents();

  if (previousSelection && trackedPlanes.has(previousSelection)) {
    // Keep the selection as-is. Re-selecting here (as before) cleared the route, reset the card text and
    // re-requested the photo on every poll, which is what made images blink in and out.
    refreshSelectedPlaneLive(previousSelection);
  } else if (previousSelection) {
    selectPlane(null);
  }

  applyPlaneCategoryVisibility();
}

function syncAircraftFiltersModuleVisibility(): void {
  aircraftFiltersModuleEl?.classList.toggle("hidden", !planesVisible);
  planeFilterControlsEl?.classList.toggle("hidden", !planesVisible);
}

function syncAlprModuleVisibility(): void {
  alprControlModuleEl?.classList.toggle("hidden", !alprVisible);
}

function syncDatacenterModuleVisibility(): void {
  datacenterControlModuleEl?.classList.toggle("hidden", !datacentersVisible);
}

function readDatacenterFiltersFromDom(): { operator: string } {
  return { operator: datacenterFilterOperatorEl?.value ?? "__all__" };
}

function applyDatacenterFiltersFromDom(): void {
  datacenterLayer.setFilters(readDatacenterFiltersFromDom());
  const sel = datacenterLayer.getSelectedEntityId();
  if (sel && datacenterLayer.getSiteForPickId(sel) === null) {
    selectDatacenterSite(null);
    satInfoEl?.classList.add("hidden");
  }
  refreshDatacenterStatusLine();
  viewer.scene.requestRender();
}

function syncDatacenterFilterSelects(): void {
  const prev = readDatacenterFiltersFromDom();
  const ds = datacenterLayer.getDataset();
  if (!ds || ds.sites.length === 0) {
    datacenterFiltersEl?.classList.add("hidden");
    return;
  }
  datacenterFiltersEl?.classList.remove("hidden");
  fillSelectOptions(datacenterFilterOperatorEl, datacenterLayer.uniqueOperators(), "All operators");
  if (
    datacenterFilterOperatorEl &&
    [...datacenterFilterOperatorEl.options].some((o) => o.value === prev.operator)
  ) {
    datacenterFilterOperatorEl.value = prev.operator;
  }
  datacenterLayer.setFilters(readDatacenterFiltersFromDom());
}

function scheduleDatacenterViewportRefresh(): void {
  if (!datacentersVisible || !datacenterLayer.getOverlayVisible()) return;
  if (datacenterViewportDebounce) clearTimeout(datacenterViewportDebounce);
  datacenterViewportDebounce = setTimeout(() => {
    datacenterViewportDebounce = null;
    void runDatacenterViewportFetch();
  }, 700);
}

let datacenterPollTimer: ReturnType<typeof setTimeout> | null = null;
let datacenterSignature = "";

/** Loads data centers for everything on screen from the server (merged from three maps, de-duplicated there). */
async function runDatacenterViewportFetch(): Promise<void> {
  if (!datacentersVisible || !datacenterLayer.getOverlayVisible()) return;
  if (datacenterPollTimer) {
    clearTimeout(datacenterPollTimer);
    datacenterPollTimer = null;
  }
  const box = currentViewBox();
  if (!box) {
    datacenterViewportHint = "Point the camera at the Earth, then data centers load for the area on screen.";
    refreshDatacenterStatusLine();
    return;
  }
  datacenterViewportAbort?.abort();
  datacenterViewportAbort = new AbortController();
  const { signal } = datacenterViewportAbort;
  datacenterViewportLoading = true;
  refreshDatacenterStatusLine();
  try {
    const r = await fetchDatacenterBox(box, signal);
    if (!r.ok) {
      datacenterViewportHint =
        r.reason === "too-wide"
          ? "Zoom in a little (about a 10° view or closer) to load data centers for this area."
          : "Data center service unavailable right now — try again in a moment.";
      if (r.reason === "too-wide") {
        lastDatacenterDataset = { sites: [], attribution: "Zoom in to load data centers", licenseNote: "" };
        datacenterSignature = "";
        datacenterLayer.setDataset(lastDatacenterDataset);
        syncDatacenterFilterSelects();
      }
      return;
    }
    const sig = `${r.dataset.sites.length}:${r.dataset.sites[0]?.id ?? ""}:${r.dataset.sites[r.dataset.sites.length - 1]?.id ?? ""}`;
    if (sig !== datacenterSignature) {
      datacenterSignature = sig;
      lastDatacenterDataset = r.dataset;
      datacenterLayer.setDataset(r.dataset);
      syncDatacenterFilterSelects();
    }
    const c = r.counts;
    const note = `${c.merged.toLocaleString()} facilities (from ${c.openstreetmap.toLocaleString()} OSM + ${c.peeringdb.toLocaleString()} PeeringDB + ${c.wikidata.toLocaleString()} Wikidata entries)`;
    datacenterViewportHint =
      r.pending > 0
        ? `${note} · loading map tiles (${r.total - r.pending - r.failed} of ${r.total})…`
        : r.failed > 0
          ? `${note} · ${r.failed} tiles temporarily unavailable, retrying…`
          : note;
    if (r.pending > 0 || r.failed > 0) {
      datacenterPollTimer = setTimeout(() => void runDatacenterViewportFetch(), r.pending > 0 ? 3000 : 12_000);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    console.warn("[datacenter] load failed:", e);
    datacenterViewportHint = "Data center service unavailable right now — try again in a moment.";
  } finally {
    datacenterViewportLoading = false;
    refreshDatacenterStatusLine();
    viewer.scene.requestRender();
  }
}

function refreshDatacenterStatusLine(): void {
  if (!datacenterDatasetStatusEl) return;
  const ds = datacenterLayer.getDataset();
  if (!ds) {
    datacenterDatasetStatusEl.textContent = "No dataset yet — turn DC · ON and zoom in.";
    return;
  }
  if (datacenterViewportLoading && ds.sites.length === 0) {
    datacenterDatasetStatusEl.textContent = "Loading data centers for the current view…";
    return;
  }
  if (ds.sites.length === 0) {
    datacenterDatasetStatusEl.textContent = datacenterViewportHint ?? "No data centers loaded yet. Turn DC · ON and pan over a metro area.";
    return;
  }
  const n = datacenterLayer.filteredSites().length;
  let line = `${n.toLocaleString()} shown${n !== ds.sites.length ? ` of ${ds.sites.length.toLocaleString()}` : ""}${datacenterViewportHint ? ` · ${datacenterViewportHint}` : ""}`;
  if (!datacenterLayer.getOverlayVisible()) line += " · Globe overlay OFF — press DC · OFF to show.";
  else if (n === 0) line = `0 / ${ds.sites.length} after operator filter — set Operator to “All operators”.`;
  datacenterDatasetStatusEl.textContent = line;
}
async function loadDatacenterDataset(): Promise<void> {
  lastDatacenterDataset = {
    sites: [],
    attribution:
      "© OpenStreetMap contributors — viewport Overpass (visible area when zoomed in; ODbL).",
    licenseNote: "https://www.openstreetmap.org/copyright"
  };
  datacenterLayer.setDataset(lastDatacenterDataset);
  syncDatacenterFilterSelects();
  refreshDatacenterStatusLine();
  if (datacentersVisible) scheduleDatacenterViewportRefresh();
}

function setupDatacenterControls(): void {
  toggleDatacentersEl?.addEventListener("click", () => {
    datacentersVisible = !datacentersVisible;
    datacenterLayer.setOverlayVisible(datacentersVisible);
    if (toggleDatacentersEl) {
      toggleDatacentersEl.textContent = datacentersVisible ? "DC · ON" : "DC · OFF";
    }
    if (datacentersVisible) {
      syncDatacenterFilterSelects();
      void runDatacenterViewportFetch();
    } else {
      datacenterViewportAbort?.abort();
      datacenterViewportAbort = null;
      if (datacenterViewportDebounce) {
        clearTimeout(datacenterViewportDebounce);
        datacenterViewportDebounce = null;
      }
      datacenterViewportLoading = false;
      const hadPanel = datacenterPanelBodyEl && !datacenterPanelBodyEl.classList.contains("hidden");
      selectDatacenterSite(null);
      if (hadPanel && !selectedPlaneId && !selectedSatelliteId && !selectedVesselId) {
        satInfoEl?.classList.add("hidden");
      }
    }
    refreshDatacenterStatusLine();
    syncDatacenterModuleVisibility();
    refreshTrackingStatusStrip();
    viewer.scene.requestRender();
  });
  datacenterFilterOperatorEl?.addEventListener("change", () => applyDatacenterFiltersFromDom());
}

function applyPlaneCategoryVisibility(): void {
  if (!planesVisible) return;
  for (const entity of planesDataSource.entities.values) {
    const eid = typeof entity.id === "string" ? entity.id : "";
    if (!eid.startsWith("plane-")) continue;
    const hexKey = eid.slice("plane-".length);
    const row = planeTrackByHex.get(hexKey);
    if (!row) {
      entity.show = false;
      continue;
    }
    const kind = classifyAircraftTraffic(classifyInputFromNormalized(row.ac));
    entity.show = planeCategoryEnabled[kind] || (notableGlowEnabled && !!notableFor(hexKey));
  }

  if (selectedPlaneId) {
    const sel = trackedPlanes.get(selectedPlaneId);
    if (
      sel &&
      !planeCategoryEnabled[classifyAircraftTraffic(classifyInputFromNormalized(sel))] &&
      !(notableGlowEnabled && notableFor(sel.icao24))
    ) {
      selectPlane(null);
    }
  }
}

/** Turn on traffic bucket filter so searched aircraft is visible when user had it disabled. */
function ensurePlaneTrafficCategoryEnabled(kind: PlaneTrafficKind): void {
  if (planeCategoryEnabled[kind]) return;
  planeCategoryEnabled[kind] = true;
  const elMap: Partial<Record<PlaneTrafficKind, HTMLElement | null>> = {
    airline: planeFilterAirlineEl,
    bizjet: planeFilterBizjetEl,
    other: planeFilterOtherEl,
    military: planeFilterMilitaryEl
  };
  elMap[kind]?.classList.add("active");
  applyPlaneCategoryVisibility();
}

function setupPlaneCategoryFilterButtons(): void {
  const pairs: Array<[PlaneTrafficKind, HTMLElement | null]> = [
    ["airline", planeFilterAirlineEl],
    ["bizjet", planeFilterBizjetEl],
    ["other", planeFilterOtherEl],
    ["military", planeFilterMilitaryEl]
  ];

  for (const [kind, el] of pairs) {
    if (!el) continue;
    el.addEventListener("click", () => {
      planeCategoryEnabled[kind] = !planeCategoryEnabled[kind];
      el.classList.toggle("active", planeCategoryEnabled[kind]);
      applyPlaneCategoryVisibility();
    });
  }

  const notableBtn = document.getElementById("plane-filter-notable");
  notableBtn?.addEventListener("click", () => {
    notableGlowEnabled = !notableGlowEnabled;
    notableBtn.classList.toggle("active", notableGlowEnabled);
    for (const hex of planeTrackByHex.keys()) if (notableFor(hex)) restylePlane(`plane-${hex}`);
    applyPlaneCategoryVisibility();
    viewer.scene.requestRender();
  });
}

let lastPlaneFetchCenter: { lat: number; lon: number } | null = null;

function approxKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (a.lat - b.lat) * 111.32;
  const dLon = (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

async function refreshPlanesFromApi(): Promise<void> {
  if (!planesVisible || planeFetchInFlight) return;
  const elapsed = Date.now() - lastPlaneFetchMs;
  if (elapsed < 1000) return;

  const center = getViewCenterLatLon();
  if (elapsed < PLANE_POLL_MIN_MS) {
    const movedFar =
      center && lastPlaneFetchCenter && approxKm(center, lastPlaneFetchCenter) >= PLANE_REFETCH_MOVE_KM;
    if (!movedFar) return;
  }
  if (!center) {
    planeFetchInFlight = false;
    updateVisibleSatellitesInView("Aircraft: center the globe in view");
    return;
  }

  planeFetchInFlight = true;
  lastPlaneFetchMs = Date.now();
  lastPlaneFetchCenter = center;
  try {
    preloadPlaneSupportingData();
    const dist = planeSearchRadiusNm();
    const agg = await fetchAggregatedAircraft(center.lat, center.lon, dist);
    const counts = Object.entries(agg.countsByPositionSource)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(" · ");
    const issues = Object.entries(agg.providerStatus)
      .filter(([, s]) => s !== "ok" && !s.startsWith("skipped"))
      .map(([k, s]) => `${k}:${s}`);
    lastPlaneProviderSummary =
      `${counts || "no aircraft in range"}` +
      (issues.length ? ` · issues ${issues.join(", ")}` : "") +
      (agg.stale ? " · STALE (providers down)" : "");
    applyPlaneFeedSnapshot(agg.aircraft);
    updateVisibleSatellitesInView();
  } catch (error) {
    console.error(error);
    updateVisibleSatellitesInView(`Aircraft API error: ${String(error)}`);
  } finally {
    planeFetchInFlight = false;
  }
}

function aisNavStatusLabel(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const m: Record<number, string> = {
    0: "Under way (engine)",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted maneuverability",
    5: "Moored",
    6: "Aground",
    7: "Engaged in fishing",
    8: "Under way (sailing)",
    12: "Pushing / towing",
    15: "Undefined (default)"
  };
  return m[n] ?? `Code ${n}`;
}

function vesselEntityId(mmsi: number): string {
  return `vessel-${mmsi}`;
}

/** Avoid rebuilding projected polyline when AIS snapshot has not meaningfully moved. */
let lastVesselRouteDrawSig: string | null = null;

function drawSelectedVesselRoute(v: VesselClientRow): void {
  const sog = v.sogKt ?? 0;
  const bearing =
    v.headingDeg != null && v.headingDeg >= 0 && v.headingDeg < 360
      ? v.headingDeg
      : v.cogDeg != null && v.cogDeg >= 0 && v.cogDeg <= 360
        ? v.cogDeg
        : null;

  if (bearing == null || sog < 0.3) {
    lastVesselRouteDrawSig = null;
    removeSelectedVesselRoute();
    const reason = sog < 0.3 ? "Vessel nearly stationary" : "No reliable heading / COG";
    if (vesselRouteFromEl) vesselRouteFromEl.textContent = "Current AIS fix";
    if (vesselRouteToEl) vesselRouteToEl.textContent = reason;
    vesselRouteBlockEl?.classList.remove("hidden");
    viewer.scene.requestRender();
    return;
  }

  const nm = Math.min(80, Math.max(8, sog * 0.75));
  const sig = `line|${v.lat.toFixed(5)}|${v.lon.toFixed(5)}|${bearing.toFixed(0)}|${nm.toFixed(1)}`;
  const existingRoute = vesselsDataSource.entities.getById(SELECTED_VESSEL_ROUTE_ID);
  if (existingRoute && sig === lastVesselRouteDrawSig) return;
  lastVesselRouteDrawSig = sig;

  removeSelectedVesselRoute();
  const end = destinationFromBearingNm(v.lon, v.lat, bearing, nm);
  const hM = 8;
  const positions = greatCircleCartesians(v.lat, v.lon, end.lat, end.lon, hM, 28);
  vesselsDataSource.entities.add({
    id: SELECTED_VESSEL_ROUTE_ID,
    polyline: {
      positions,
      width: 2.8,
      material: new PolylineGlowMaterialProperty({
        color: Color.fromCssColorString("#7ef491").withAlpha(0.92),
        glowPower: 0.22
      }),
      clampToGround: true
    }
  });
  if (vesselRouteFromEl) vesselRouteFromEl.textContent = "Current AIS fix";
  if (vesselRouteToEl) {
    vesselRouteToEl.textContent = `~${nm.toFixed(0)} NM ahead on ${bearing.toFixed(0)}° T (approx.)`;
  }
  vesselRouteBlockEl?.classList.remove("hidden");
  viewer.scene.requestRender();
}

function fillVesselPanel(v: VesselClientRow): void {
  hideCoreInfoRows();
  hideAlprDetailRows();
  showVesselDetailRows();
  satNameEl?.classList.add("hidden");
  if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "AIS";
  if (infoTitleEl) infoTitleEl.textContent = "Vessel";

  const head = (v.name?.trim() || `MMSI ${v.mmsi}`).slice(0, 140);
  if (vesselDisplayHeadEl) vesselDisplayHeadEl.textContent = head;
  if (vesselMmsiEl) vesselMmsiEl.textContent = String(v.mmsi);
  if (vesselNameEl) vesselNameEl.textContent = v.name?.trim() || "—";
  if (vesselCallEl) vesselCallEl.textContent = v.callSign?.trim() || "—";
  if (vesselSogEl) vesselSogEl.textContent = v.sogKt != null ? `${v.sogKt.toFixed(1)} kt` : "—";
  if (vesselCogEl) vesselCogEl.textContent = v.cogDeg != null ? `${v.cogDeg.toFixed(0)}°` : "—";
  if (vesselHeadingEl) {
    vesselHeadingEl.textContent =
      v.headingDeg != null && v.headingDeg >= 0 && v.headingDeg < 360 ? `${v.headingDeg.toFixed(0)}°` : "—";
  }
  if (vesselNavEl) vesselNavEl.textContent = aisNavStatusLabel(v.navStatus);
  if (vesselDestEl) vesselDestEl.textContent = v.destination?.trim() || "—";
  if (vesselDepEl) {
    vesselDepEl.textContent =
      "Not broadcast on AIS static (voyage origin is rarely sent on Class A/B).";
  }
  if (vesselEtaEl) {
    vesselEtaEl.textContent =
      v.etaText?.trim() || (v.etaMs != null ? `${new Date(v.etaMs).toUTCString().slice(5, 22)} UTC` : "—");
  }
  if (vesselImoEl) vesselImoEl.textContent = v.imo != null && v.imo > 0 ? String(v.imo) : "—";
  if (vesselTypeEl) vesselTypeEl.textContent = v.shipType != null ? String(v.shipType) : "—";
  const fromDigitraffic = v.source === "digitraffic";
  if (vesselSourceEl) {
    vesselSourceEl.textContent = fromDigitraffic
      ? "Digitraffic Marine · Fintraffic (CC BY 4.0), keyless"
      : "AISStream (via local API)";
  }
  if (vesselKickerEl) vesselKickerEl.textContent = fromDigitraffic ? "AIS (Digitraffic · Baltic)" : "AIS (AISStream)";
  renderVesselExtra(v);
  satInfoEl?.classList.remove("hidden");
  drawSelectedVesselRoute(v);
}

function selectVessel(entityId: string | null, opts?: { flyTo?: boolean }): void {
  if (!entityId || !entityId.startsWith("vessel-")) {
    clearVesselSelectionQuietly();
    showCoreInfoRows();
    satNameEl?.classList.remove("hidden");
    if (
      !selectedPlaneId &&
      !selectedSatelliteId &&
      !alprLayer.getSelectedEntityId() &&
      !datacenterLayer.getSelectedEntityId() &&
      !earthCamController.layer.getSelectedEntityId()
    ) {
      satInfoEl?.classList.add("hidden");
      resetInfoPanelTitles();
      if (satNameEl) satNameEl.textContent = "Click a satellite";
      if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "SIGINT";
    }
    return;
  }

  clearVesselSelectionQuietly();
  clearEarthcamSelectionQuietly();
  selectGeocodePlace(null);
  clearPlaneSelection();
  updateAircraftInfoCard(null);
  selectDatacenterSite(null);
  selectAlprSite(null);
  if (selectedSatelliteId) {
    const prev = satellitesDataSource.entities.getById(selectedSatelliteId);
    if (prev?.point) {
      (prev.point as any).pixelSize = SAT_POINT_PX;
      (prev.point as any).color = Color.fromCssColorString("#6ed8ff");
    }
    selectedSatelliteId = null;
    clearSelectedTrail();
  }
  updateInfoCard(null);

  selectedVesselId = entityId;
  const mmsi = Number(entityId.replace(/^vessel-/, ""));
  const row = vesselTrackByMmsi.get(mmsi)?.row;
  if (!row) return;

  const current = vesselsDataSource.entities.getById(entityId);
  if (current?.point) {
    (current.point as any).pixelSize = 12;
    (current.point as any).color = Color.fromCssColorString("#c8ff70");
  }
  for (const ent of vesselsDataSource.entities.values) {
    if (typeof ent.id !== "string" || !ent.id.startsWith("vessel-") || ent.id === entityId) continue;
    if (ent.point) {
      (ent.point as any).pixelSize = 8;
      (ent.point as any).color = Color.fromCssColorString("#56e0a0");
    }
  }

  fillVesselPanel(row);
  if (opts?.flyTo && current) {
    void viewer.flyTo(current, { duration: 1.2 }).catch(() => {});
  }
  viewer.scene.requestRender();
}

/**
 * The area to ask AISStream for: the whole visible part of the globe, not a fixed 250 NM square around the middle of the
 * screen (that square is why ships only showed near the centre when zoomed out). Returns the centre and half-width in
 * nautical miles, padded a little so panning doesn't immediately outrun it; the server turns it into one or two boxes.
 * AISStream sends roughly 80 messages a second for the whole world, so even a full-globe box is affordable.
 */
function vesselViewArea(): { lat: number; lon: number; distNm: number } | null {
  const r = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!r) {
    // The whole planet (or no ground) is in view: ask for everything.
    const c = getViewCenterLatLon();
    return { lat: c?.lat ?? 0, lon: c?.lon ?? 0, distNm: VESSEL_MAX_RADIUS_NM };
  }
  const mid = (r.north + r.south) / 2;
  let lonSpan = r.east - r.west;
  if (lonSpan < 0) lonSpan += 2 * Math.PI;
  const latSpanNm = CesiumMath.toDegrees(r.north - r.south) * 60;
  const lonSpanNm = CesiumMath.toDegrees(lonSpan) * 60 * Math.max(0.12, Math.cos(mid));
  const half = Math.max(latSpanNm, lonSpanNm) / 2;
  const centre = Rectangle.center(r);
  return {
    lat: CesiumMath.toDegrees(centre.latitude),
    lon: CesiumMath.toDegrees(centre.longitude),
    distNm: Math.min(VESSEL_MAX_RADIUS_NM, Math.max(50, half * 1.15))
  };
}
/** Large enough that centre +- this reaches every longitude (180 degrees x 60 NM): the whole planet. The server clamps to the same value. */
const VESSEL_MAX_RADIUS_NM = 10_800;

async function refreshVesselSubscription(): Promise<void> {
  if (!vesselsVisible) return;
  const area = vesselViewArea();
  if (!area) return;
  await postAisSubscription(area.lat, area.lon, area.distNm);
}

function applyVesselSnapshot(msg: VesselSnapshotMessage): void {
  if (!vesselsVisible) return;
  const now = Date.now();
  const entities = vesselsDataSource.entities;
  entities.suspendEvents();
  const dropVessel = (mmsi: number): void => {
    vesselTrackByMmsi.delete(mmsi);
    const e = entities.getById(vesselEntityId(mmsi));
    if (e) entities.remove(e);
  };
  if (msg.full !== false) {
    const incoming = new Set(msg.vessels.map((v) => v.mmsi));
    for (const mmsi of [...vesselTrackByMmsi.keys()]) {
      if (!incoming.has(mmsi)) dropVessel(mmsi);
    }
  } else {
    for (const mmsi of msg.removed ?? []) dropVessel(mmsi);
  }
  for (const v of msg.vessels) {
    vesselTrackByMmsi.set(v.mmsi, { row: v, lastSeenMs: now });
    const id = vesselEntityId(v.mmsi);
    const pos = Cartesian3.fromDegrees(v.lon, v.lat, 6, Ellipsoid.WGS84, scratchVesselCartesian);
    const existing = entities.getById(id);
    if (existing) {
      const p = existing.position;
      if (p instanceof ConstantPositionProperty) {
        p.setValue(pos);
      } else {
        existing.position = new ConstantPositionProperty(pos);
      }
    } else {
      entities.add({
        id,
        position: new ConstantPositionProperty(Cartesian3.clone(pos, new Cartesian3())),
        point: {
          pixelSize: 8,
          color: Color.fromCssColorString("#56e0a0"),
          outlineColor: Color.BLACK,
          outlineWidth: 1,
          // Hidden behind the Earth instead of drawn through it (Infinity showed the far side's ships at the globe view).
          disableDepthTestDistance: horizonDepthTest(viewer.camera),
          heightReference: HeightReference.CLAMP_TO_GROUND
        }
      });
    }
  }
  entities.resumeEvents();

  if (selectedVesselId) {
    const mmsi = Number(selectedVesselId.replace(/^vessel-/, ""));
    const pack = vesselTrackByMmsi.get(mmsi);
    if (pack) fillVesselPanel(pack.row);
    else selectVessel(null);
  }
  refreshTrackingStatusStrip();
  viewer.scene.requestRender();
}

function setupVesselsToggle(): void {
  if (!toggleVesselsEl) return;
  toggleVesselsEl.addEventListener("click", () => {
    vesselsVisible = !vesselsVisible;
    vesselsDataSource.show = vesselsVisible;
    toggleVesselsEl.textContent = vesselsVisible ? "SHP · ON" : "SHP · OFF";
    if (!vesselsVisible) {
      aisStatusNote = "";
      clearKeyHint("ais");
      if (vesselStreamClient) {
        vesselStreamClient.disconnect();
        vesselStreamClient = null;
      }
      vesselTrackByMmsi.clear();
      vesselsDataSource.entities.removeAll();
      selectVessel(null);
    } else {
      vesselStreamClient ??= createAisStreamClient({
        onSnapshot: (snap) => applyVesselSnapshot(snap),
        onError: (m) => console.warn("[vessels]", m),
        onLink: (up) => {
          if (up || aisStatusNote === AIS_NOT_CONNECTED) return;
          aisStatusNote = AIS_NOT_CONNECTED;
          refreshTrackingStatusStrip();
        },
        onStatus: (s) => {
          if (s.upstream === "no_key") showKeyHint("ais");
          else clearKeyHint("ais");
          const note = aisNoteFromStatus(s);
          if (note !== aisStatusNote) {
            aisStatusNote = note;
            refreshTrackingStatusStrip();
          }
        }
      });
      vesselStreamClient.connect();
      void refreshVesselSubscription();
    }
    updateVisibleSatellitesInView();
    viewer.scene.requestRender();
  });
}

function setupPlanesToggle(): void {
  if (!togglePlanesEl) return;

  togglePlanesEl.addEventListener("click", () => {
    planesVisible = !planesVisible;
    planesDataSource.show = planesVisible;
    togglePlanesEl.textContent = planesVisible ? "AC · ON" : "AC · OFF";
    if (!planesVisible) {
      syncAircraftFiltersModuleVisibility();
      selectPlane(null);
      trackedPlanes.clear();
      planeTrackByHex.clear();
      planesDataSource.entities.removeAll();
      updateVisibleSatellitesInView();
      return;
    }
    syncAircraftFiltersModuleVisibility();
    preloadPlaneSupportingData();
    void refreshPlanesFromApi();
  });
}

function setupPlaneSearch(): void {
  const inputEl = document.getElementById("plane-search-input") as HTMLInputElement | null;
  const goBtn = document.getElementById("plane-search-go");
  const feedbackEl = document.getElementById("plane-search-feedback");
  const resultsEl = document.getElementById("plane-search-results");
  const fr24El = document.getElementById("plane-search-fr24") as HTMLAnchorElement | null;
  if (!inputEl || !goBtn || !feedbackEl || !resultsEl || !fr24El) return;

  const clearFeedback = (): void => {
    feedbackEl.textContent = "";
    resultsEl.innerHTML = "";
    resultsEl.hidden = true;
  };

  const runSearch = (): void => {
    const qRaw = inputEl.value;
    fr24El.href = flightradar24CompareUrl(null, qRaw);
    fr24El.classList.remove("hidden");

    if (!planesVisible) {
      clearFeedback();
      feedbackEl.textContent = "Turn planes on first.";
      return;
    }

    if (!qRaw.trim()) {
      clearFeedback();
      fr24El.classList.add("hidden");
      return;
    }

    const hits = sortedPlaneSearchHits(trackedPlanes, qRaw);
    resultsEl.innerHTML = "";

    if (hits.length === 0) {
      feedbackEl.textContent =
        "Not in the current live aircraft bubble (radius around your view). Move the map or zoom, then try again — or open Flightradar24 to compare.";
      resultsEl.hidden = true;
      return;
    }

    fr24El.href = flightradar24CompareUrl(hits[0].ac, qRaw);

    if (hits.length === 1) {
      ensurePlaneTrafficCategoryEnabled(classifyAircraftTraffic(classifyInputFromNormalized(hits[0].ac)));
      feedbackEl.textContent = `On map: ${formatPlaneSearchLine(hits[0].ac)}`;
      selectPlane(hits[0].entityId, { flyTo: true });
      resultsEl.hidden = true;
      return;
    }

    feedbackEl.textContent = `${hits.length} matches — pick one:`;
    resultsEl.hidden = false;

    for (const h of hits) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "plane-search-hit";
      b.textContent = formatPlaneSearchLine(h.ac);
      b.addEventListener("click", () => {
        ensurePlaneTrafficCategoryEnabled(classifyAircraftTraffic(classifyInputFromNormalized(h.ac)));
        selectPlane(h.entityId, { flyTo: true });
        fr24El.href = flightradar24CompareUrl(h.ac, qRaw);
        feedbackEl.textContent = `Focused: ${formatPlaneSearchLine(h.ac)}`;
        resultsEl.hidden = true;
      });
      resultsEl.appendChild(b);
    }
  };

  goBtn.addEventListener("click", () => runSearch());
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      inputEl.value = "";
      clearFeedback();
      fr24El.classList.add("hidden");
      fr24El.href = "https://www.flightradar24.com/";
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") runSearch();
  });
}

function planeSidebarFmt(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v).trim();
  return s.length ? s : "—";
}

/** Photo + supplemental rows in the shared `#sat-info` panel (avoids a second floating box). */
function renderPlaneExtraRows(ac: NormalizedAircraft): void {
  if (!planeExtraRowsEl) return;
  const enr =
    ac.enrichedFrom && ac.enrichedFrom.length ? ac.enrichedFrom.join(", ") : "—";

  /** Live position APIs do not file origin/dest; mirror “Estimated route” + ICAO fields when present. */
  const routeFrom =
    (ac.originAirport && ac.originAirport.trim()) ||
    selectedPlaneRouteFromText.trim() ||
    "";
  const routeTo =
    (ac.destinationAirport && ac.destinationAirport.trim()) ||
    selectedPlaneRouteToText.trim() ||
    "";
  const originDisplay = routeFrom.length ? routeFrom : "—";
  const destDisplay = routeTo.length ? routeTo : "—";
  const routeLooksMissing =
    (originDisplay === "—" || originDisplay === "Not available") &&
    (destDisplay === "—" || destDisplay === "Not available");

  /** Lines above already show callsign, type, reg, alt, speed, heading — keep non-duplicated fields. */
  const rows: Array<[string, string | boolean]> = [
    ["ICAO24", ac.icao24.toUpperCase()],
    ["Latitude", ac.latitude.toFixed(5)],
    ["Longitude", ac.longitude.toFixed(5)],
    ["Vertical rate (fpm)", ac.verticalRateFpm != null ? ac.verticalRateFpm.toFixed(0) : "—"],
    ["On ground", ac.onGround],
    ["Origin (estimated)", originDisplay],
    ["Destination (estimated)", destDisplay]
  ];
  if (ac.departureTime) {
    rows.push(["Departure (scheduled)", planeSidebarFmt(ac.departureTime)]);
  }
  if (ac.arrivalTime) {
    rows.push(["Arrival (scheduled)", planeSidebarFmt(ac.arrivalTime)]);
  }
  rows.push(...planeProgressRows(ac));
  rows.push(
    ["Last position (ISO)", ac.lastSeen],
    ["Position source", ac.positionSource],
    ["Also from", enr]
  );
  if (routeLooksMissing && selectedPlaneRouteFromText !== "Retrieving…") {
    rows.push([
      "Why no route?",
      "No published route for this callsign. Private, cargo, military and some charter flights usually have none; it can also be a new or changed flight number."
    ]);
  }
  planeExtraRowsEl.innerHTML = rowsHtml(rows);
}

/** Photo + gallery for the selected aircraft. Runs once per airframe — live ticks never come through here. */
function syncAircraftSidebarMediaAndExtras(ac: NormalizedAircraft): void {
  if (!planeExtraRowsEl) return;
  renderPlaneExtraRows(ac);
  if (planeMediaState?.hex === ac.icao24) return; // same airframe: keep its photo (or the fetch already running)
  planeMediaState = { hex: ac.icao24 };
  planeSidebarPhotoSeq++;
  const seq = planeSidebarPhotoSeq;

  if (planeInfoAttribEl) planeInfoAttribEl.textContent = "";
  if (planeInfoPhotoEl) {
    planeInfoPhotoEl.classList.add("hidden");
    planeInfoPhotoEl.removeAttribute("src");
  }
  planeInfoSilhouetteEl?.classList.remove("hidden");
  if (planeModelGalleryEl) {
    planeModelGalleryEl.innerHTML = "";
    planeModelGalleryEl.classList.add("hidden");
  }
  planeModelGalleryHintEl?.classList.add("hidden");

  void (async () => {
    const [meta, modelGallery] = await Promise.all([
      fetchAircraftPhotoMeta(ac.registration, ac.aircraftType, ac.description, ac.icao24),
      fetchAircraftModelGallery(ac.aircraftType, ac.description, 8)
    ]);
    if (seq !== planeSidebarPhotoSeq || !planeInfoPhotoEl || !planeInfoAttribEl) return;
    if (meta.thumbUrl) {
      planeInfoPhotoEl.src = meta.thumbUrl;
      planeInfoPhotoEl.classList.remove("hidden");
      planeInfoSilhouetteEl?.classList.add("hidden");
      planeInfoAttribEl.textContent = "";
      planeInfoAttribEl.append(document.createTextNode(meta.attribution ?? ""));
      if (meta.pageUrl && /^https:\/\/www\.planespotters\.net\//.test(meta.pageUrl)) {
        const a = document.createElement("a");
        a.href = meta.pageUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = " (view original)";
        planeInfoAttribEl.append(a);
      }
    }

    if (!planeModelGalleryEl || !planeModelGalleryHintEl) return;
    planeModelGalleryEl.innerHTML = "";
    planeModelGalleryEl.classList.add("hidden");
    planeModelGalleryHintEl.classList.add("hidden");
    if (modelGallery.items.length === 0) return;

    let items = modelGallery.items;
    if (meta.thumbUrl) {
      const withoutHero = items.filter((it) => it.thumbUrl !== meta.thumbUrl);
      if (withoutHero.length >= 2) items = withoutHero;
    }

    planeModelGalleryHintEl.classList.remove("hidden");
    planeModelGalleryEl.classList.remove("hidden");
    for (const it of items) {
      const cell = document.createElement("div");
      cell.className = "plane-model-gallery-cell";
      cell.setAttribute("role", "listitem");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "plane-model-gallery-thumb";
      btn.title = it.title;
      const img = document.createElement("img");
      img.src = it.thumbUrl;
      img.loading = "lazy";
      img.alt = "";
      btn.appendChild(img);
      btn.addEventListener("click", () => {
        if (seq !== planeSidebarPhotoSeq || !planeInfoPhotoEl || !planeInfoAttribEl) return;
        planeInfoPhotoEl.src = it.thumbUrl;
        planeInfoPhotoEl.classList.remove("hidden");
        planeInfoSilhouetteEl?.classList.add("hidden");
        planeInfoAttribEl.textContent = `Wikimedia Commons · ${it.title} · ${it.pageUrl}`;
      });
      cell.appendChild(btn);
      planeModelGalleryEl.appendChild(cell);
    }
  })();
}

function clearAircraftSidebarMedia(): void {
  planeMediaState = null;
  planeSidebarPhotoSeq++;
  if (planeInfoAttribEl) planeInfoAttribEl.textContent = "";
  if (planeInfoPhotoEl) {
    planeInfoPhotoEl.classList.add("hidden");
    planeInfoPhotoEl.removeAttribute("src");
  }
  planeInfoSilhouetteEl?.classList.remove("hidden");
  if (planeModelGalleryEl) {
    planeModelGalleryEl.innerHTML = "";
    planeModelGalleryEl.classList.add("hidden");
  }
  planeModelGalleryHintEl?.classList.add("hidden");
  if (planeExtraRowsEl) planeExtraRowsEl.innerHTML = "";
}

const satrecCache = new Map<number, { tle1: string; satrec: ReturnType<typeof twoline2satrec> }>();

/** Parsing a TLE is the expensive part of propagation, so each satellite is parsed once per element set. */
function satrecFor(satellite: Satellite): ReturnType<typeof twoline2satrec> {
  const hit = satrecCache.get(satellite.noradId);
  if (hit && hit.tle1 === satellite.tle1) return hit.satrec;
  const satrec = twoline2satrec(satellite.tle1, satellite.tle2);
  satrecCache.set(satellite.noradId, { tle1: satellite.tle1, satrec });
  return satrec;
}

function getSatellitePosition(satellite: Satellite, date: Date, gmst: number = gstime(date)): Cartesian3 | null {
  const satrec = satrecFor(satellite);
  const propagation = propagate(satrec, date);
  if (!propagation || !propagation.position) return null;

  const geodetic = eciToGeodetic(propagation.position, gmst);
  return Cartesian3.fromDegrees(
    degreesLong(geodetic.longitude),
    degreesLat(geodetic.latitude),
    geodetic.height * 1000
  );
}

function getSatelliteSpeedKmS(satellite: Satellite, date: Date): number | null {
  const satrec = satrecFor(satellite);
  const propagation = propagate(satrec, date);
  if (!propagation || !propagation.velocity) return null;
  const { x, y, z } = propagation.velocity;
  return Math.sqrt(x * x + y * y + z * z);
}

function inferOperator(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes("ISS") || upper.includes("SOYUZ") || upper.includes("PROGRESS")) return "Roscosmos / International Partners";
  if (upper.includes("CSS") || upper.includes("TIANHE") || upper.includes("SHENZHOU")) return "CNSA";
  if (upper.includes("DRAGON") || upper.includes("CYGNUS")) return "NASA / Commercial";
  return "Unknown";
}

function inferPurpose(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes("ISS") || upper.includes("CSS") || upper.includes("TIANHE")) return "Crewed orbital station";
  if (upper.includes("SOYUZ") || upper.includes("DRAGON") || upper.includes("SHENZHOU")) return "Crew transport";
  if (upper.includes("PROGRESS") || upper.includes("CYGNUS") || upper.includes("TIANZHOU")) return "Cargo resupply";
  return "Orbital platform";
}

function guessMilitaryOperatorCountry(ac: NormalizedAircraft): string | null {
  const desc = (ac.description ?? "").toUpperCase();
  const flight = sanitizeCallsign(ac.callsign)?.toUpperCase() ?? "";

  if (/\bUSAF\b|\bUS\s*AIR\s*FORCE\b|\bUS\s*NAVY\b|\bUS\s*ARMY\b|\bUSMC\b|\bCOAST\s*GUARD\b/.test(desc))
    return "United States";
  if (/\bRAF\b|\bROYAL\s*AIR\s*FORCE\b/.test(desc) || /^RRR\d/.test(flight)) return "United Kingdom";
  if (/\bLUFTWAFFE\b/.test(desc)) return "Germany";
  if (/\bRCAF\b|\bROYAL\s*CANADIAN\s*AIR\s*FORCE\b/.test(desc)) return "Canada";
  if (/\bRAAF\b|\bROYAL\s*AUSTRALIAN\s*AIR\s*FORCE\b/.test(desc)) return "Australia";
  if (/\bJASDF\b|\bJAPAN\s*AIR\s*SELF\s*DEFEN[CS]E\s*FORCE\b/.test(desc)) return "Japan";
  if (/\bROKAF\b|\bREPUBLIC\s*OF\s*KOREA\s*AIR\s*FORCE\b/.test(desc)) return "South Korea";
  if (/\bAERONAUTICA\s*MILITARE\b/.test(desc)) return "Italy";
  if (/\bARMEE\s*DE\s*L[’']?\s*AIR\b|\bFRENCH\s*AIR\s*FORCE\b/.test(desc)) return "France";
  if (/^RCH\d/.test(flight)) return "United States";
  return null;
}

function updateInfoCard(satellite: Satellite | null): void {
  clearVesselSelectionQuietly();
  hidePlaneRouteSection();
  clearAircraftSidebarMedia();
  toggleAircraftOnlyInfoRows(false);
  hideAirlineDestinationDataRow();
  hideAlprDetailRows();
  showCoreInfoRows();
  satNameEl?.classList.remove("hidden");
  if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "SIGINT";
  if (!satellite) {
    satOrbitRowsEl?.classList.add("hidden");
    satInfoEl?.classList.add("hidden");
    resetInfoPanelTitles();
    if (satNameEl) satNameEl.textContent = "Click a satellite";
    if (satOperatorEl) satOperatorEl.textContent = "-";
    if (satCountryEl) satCountryEl.textContent = "-";
    if (satSpeedEl) satSpeedEl.textContent = "-";
    if (satPurposeEl) satPurposeEl.textContent = "-";
    if (satSourceEl) satSourceEl.textContent = "N2YO";
    return;
  }

  resetInfoPanelTitles();
  satInfoEl?.classList.remove("hidden");
  if (satNameEl) satNameEl.textContent = satellite.name;
  if (satOperatorEl) satOperatorEl.textContent = satellite.operator ?? inferOperator(satellite.name);
  if (satCountryEl) satCountryEl.textContent = satellite.operatorCountry ?? "Unknown";
  if (satPurposeEl) satPurposeEl.textContent = satellite.purpose ?? inferPurpose(satellite.name);
  if (satSourceEl) satSourceEl.textContent = currentSource === "keeptrack" ? "KeepTrack" : "CelesTrak";
  const speed = getSatelliteSpeedKmS(satellite, new Date());
  if (satSpeedEl) satSpeedEl.textContent = speed ? `${speed.toFixed(2)} km/s` : "Unknown";
  if (satOrbitRowsEl) {
    const rows = orbitSummaryRows(satellite);
    satOrbitRowsEl.innerHTML = rowsHtml(rows);
    satOrbitRowsEl.classList.toggle("hidden", rows.length === 0);
  }
}

/** Orbital period in minutes from the element set, or null when the TLE can't be used. */
function orbitalPeriodMin(satellite: Satellite): number | null {
  const no = satrecFor(satellite).no; // mean motion, radians per minute
  const p = typeof no === "number" && no > 0 ? (2 * Math.PI) / no : NaN;
  return Number.isFinite(p) && p > 0 ? p : null;
}

/** What the orbit "route" looks like: lap time, altitude range, tilt and class — all derived from the TLE. */
function orbitSummaryRows(satellite: Satellite): Array<[string, string]> {
  const rec = satrecFor(satellite);
  const period = orbitalPeriodMin(satellite);
  if (period == null) return [];
  const earthKm = 6378.137;
  const perigee = (rec.a * (1 - rec.ecco) - 1) * earthKm;
  const apogee = (rec.a * (1 + rec.ecco) - 1) * earthKm;
  const incDeg = (rec.inclo * 180) / Math.PI;
  const pos = getSatellitePosition(satellite, new Date());
  const altNow = pos ? Cartographic.fromCartesian(pos).height / 1000 : null;
  const meanAlt = (perigee + apogee) / 2;
  let klass: string;
  if (rec.ecco > 0.25) klass = "Highly elliptical orbit (HEO)";
  else if (meanAlt < 2000) klass = "Low Earth orbit (LEO)";
  else if (meanAlt < 34_000) klass = "Medium Earth orbit (MEO)";
  else if (meanAlt < 37_000 && incDeg < 25) klass = "Geostationary / geosynchronous (GEO)";
  else klass = "High Earth orbit";
  const rows: Array<[string, string]> = [
    ["Orbit class", klass],
    ["Time per orbit", `${formatDuration(period)} · ${(1440 / period).toFixed(2)} orbits per day`],
    ["Next lap completes", arrivalClock(period)]
  ];
  if (altNow != null) rows.push(["Altitude now", `${Math.round(altNow).toLocaleString()} km`]);
  rows.push(
    ["Perigee / apogee", `${Math.round(perigee).toLocaleString()} km / ${Math.round(apogee).toLocaleString()} km`],
    ["Inclination", `${incDeg.toFixed(1)}° (highest latitude it passes over ≈ ${Math.min(incDeg, 180 - incDeg).toFixed(0)}°)`],
    ["Map track", "Bright line = the next full orbit; grey = the last half orbit"]
  );
  return rows;
}

async function enrichSelectedWithN2Yo(satellite: Satellite): Promise<void> {
  if (!n2yoApiKey) return;
  const details = await fetchN2YoSatelliteDetails(satellite.noradId, n2yoApiKey);
  if (!details) return;

  if (satNameEl && details.satName) satNameEl.textContent = details.satName;
  if (satSourceEl) satSourceEl.textContent = "N2YO";
}

function getSourceLabel(source: "keeptrack" | "celestrak"): string {
  return source === "keeptrack" ? "KeepTrack" : "CelesTrak";
}

function clearSelectedTrail(): void {
  if (selectedPastTrail) {
    satellitesDataSource.entities.remove(selectedPastTrail);
    selectedPastTrail = null;
  }
  if (selectedFutureTrail) {
    satellitesDataSource.entities.remove(selectedFutureTrail);
    selectedFutureTrail = null;
  }
}

function buildTrailPoints(
  satellite: Satellite,
  fromSeconds: number,
  toSeconds: number,
  stepSeconds = 60
): Cartesian3[] {
  const points: Cartesian3[] = [];
  const now = new Date();
  for (let s = fromSeconds; s <= toSeconds; s += stepSeconds) {
    const at = new Date(now.getTime() + s * 1000);
    const p = getSatellitePosition(satellite, at);
    if (p) points.push(p);
  }
  return points;
}

function removePlaneRoutePolyline(): void {
  const existing = planesDataSource.entities.getById(SELECTED_PLANE_ROUTE_ENTITY_ID);
  if (existing) planesDataSource.entities.remove(existing);
}

function clearSelectedPlaneRoute(): void {
  selectedPlaneRouteHint = null;
  selectedPlaneRouteFromText = "";
  selectedPlaneRouteToText = "";
  selectedPlaneRouteGeom = null;
  planeAirportCams = null;
  planeSummaryKey = "";
  const ahead = planesDataSource.entities.getById(SELECTED_PLANE_AHEAD_ID);
  if (ahead) planesDataSource.entities.remove(ahead);
  removePlaneRoutePolyline();
}

function drawSelectedPlaneRouteGlowLine(positions: Cartesian3[], color: Color, glowPower: number): void {
  removePlaneRoutePolyline();
  planesDataSource.entities.add({
    id: SELECTED_PLANE_ROUTE_ENTITY_ID,
    polyline: {
      positions,
      width: 3,
      material: new PolylineGlowMaterialProperty({ color, glowPower }),
      clampToGround: false
    }
  });
}

function drawSelectedPlaneRouteDashLine(positions: Cartesian3[]): void {
  removePlaneRoutePolyline();
  planesDataSource.entities.add({
    id: SELECTED_PLANE_ROUTE_ENTITY_ID,
    polyline: {
      positions,
      width: 2.5,
      material: trackProjectionDashMaterial(0.9),
      clampToGround: false
    }
  });
}

async function loadAndDrawSelectedPlaneRoute(entityId: string): Promise<void> {
  const ac0 = trackedPlanes.get(entityId);
  const watchHex = ac0?.icao24;
  selectedPlaneRouteHint = null;
  selectedPlaneRouteFromText = "Retrieving…";
  selectedPlaneRouteToText = "Retrieving…";
  if (ac0) updateAircraftInfoCard(ac0);

  if (
    !ac0 ||
    typeof ac0.latitude !== "number" ||
    typeof ac0.longitude !== "number" ||
    typeof watchHex !== "string"
  ) {
    return;
  }

  const altM = altitudeFtToMeters(ac0.altitudeFt);
  let cruiseM = typeof altM === "number" && !Number.isNaN(altM) ? altM : 10_500 * 0.3048;
  cruiseM = Math.min(13_000, Math.max(800, cruiseM));

  await ensureAirportsLoaded().catch(() => {});
  if (selectedPlaneId !== entityId || trackedPlanes.get(entityId)?.icao24 !== watchHex) return;

  let depIcao: string | null = null;
  let arrIcao: string | null = null;
  let depApiOverlay: AirportApiOverlay | null = null;
  let arrApiOverlay: AirportApiOverlay | null = null;
  type RouteTelSource = "" | "aviationstack" | "opensky" | "mixed" | "adsbdb";
  let routeTelSource: RouteTelSource = "";

  /** First choice: the keyless community flight-route database (callsign → origin/destination with coordinates). */
  let adsbOrigin: FlightRouteAirport | null = null;
  let adsbDest: FlightRouteAirport | null = null;
  const callsignForRoute = sanitizeCallsign(ac0.callsign);
  if (callsignForRoute) {
    const fr = await fetchFlightRoute(callsignForRoute);
    if (selectedPlaneId !== entityId || trackedPlanes.get(entityId)?.icao24 !== watchHex) return;
    if (fr) {
      adsbOrigin = fr.origin;
      adsbDest = fr.destination;
      if (fr.origin?.icao) {
        depIcao = fr.origin.icao;
        depApiOverlay = { name: fr.origin.name ?? "", ...(fr.origin.iata ? { iata: fr.origin.iata } : {}) };
      }
      if (fr.destination?.icao) {
        arrIcao = fr.destination.icao;
        arrApiOverlay = { name: fr.destination.name ?? "", ...(fr.destination.iata ? { iata: fr.destination.iata } : {}) };
      }
      if (depIcao || arrIcao) routeTelSource = "adsbdb";
    }
  }

  /** OpenSky (ICAO24 + time window) — only consulted if the route is still incomplete. */
  let routeHadOpenSky = false;
  if (!depIcao || !arrIcao) try {
    const w = openSkyFlightWindowNow();
    const r = await fetchOpenSkyEstimatedAirports(watchHex, w.beginSec, w.endSec);
    if (r) {
      if (r.dep) {
        const d =
          r.dep.length === 3 ? await icaoFromIata(r.dep) : r.dep.length === 4 ? r.dep : null;
        if (d) depIcao = d;
      }
      if (r.arr) {
        const a =
          r.arr.length === 3 ? await icaoFromIata(r.arr) : r.arr.length === 4 ? r.arr : null;
        if (a) arrIcao = a;
      }
      if (depIcao || arrIcao) {
        routeTelSource = "opensky";
        routeHadOpenSky = true;
      }
    }
  } catch {
    /* auth / rate limits */
  }

  const airlineFrame = classifyAircraftTraffic(classifyInputFromNormalized(ac0)) === "airline";
  const flightLooksScheduled = flightIdLooksScheduledAirlineStyle(ac0.callsign);
  const rawAvMode = (
    (import.meta.env.VITE_AVIATIONSTACK_MODE as string | undefined) ?? "fallback"
  )
    .trim()
    .toLowerCase();
  const avMode =
    rawAvMode === "off" || rawAvMode === "fallback" || rawAvMode === "preferred"
      ? rawAvMode
      : "fallback";
  /** `fallback`: only hit Aviationstack if OpenSky lacks dep or arr — keeps free-tier viable. `preferred`: always queries AS when eligible (high quota use). Eligibility includes cargo / “other” with a filed flight number. */
  const aviationstackNeedsFill =
    (airlineFrame || flightLooksScheduled) &&
    avMode !== "off" &&
    (avMode === "preferred" || !depIcao || !arrIcao);

  if (aviationstackNeedsFill) {
    const asRoute = await aviationstackRouteForAirlineAircraft({
      hex: ac0.icao24,
      flight: ac0.callsign,
      r: ac0.registration
    });
    if (selectedPlaneId !== entityId || trackedPlanes.get(entityId)?.icao24 !== watchHex) return;
    if (
      asRoute &&
      (asRoute.depIcao ||
        asRoute.arrIcao ||
        asRoute.depApiName ||
        asRoute.arrApiName ||
        asRoute.depApiIata ||
        asRoute.arrApiIata)
    ) {
      if (!depIcao && asRoute.depIcao) depIcao = asRoute.depIcao;
      if (!arrIcao && asRoute.arrIcao) arrIcao = asRoute.arrIcao;
      if (!depIcao && asRoute.depApiIata) depIcao = await icaoFromIata(asRoute.depApiIata);
      if (!arrIcao && asRoute.arrApiIata) arrIcao = await icaoFromIata(asRoute.arrApiIata);
      if (asRoute.depApiName || asRoute.depApiIata) {
        depApiOverlay = {
          name: (asRoute.depApiName ?? "").trim(),
          ...(asRoute.depApiIata ? { iata: asRoute.depApiIata.trim() } : {})
        };
      }
      if (asRoute.arrApiName || asRoute.arrApiIata) {
        arrApiOverlay = {
          name: (asRoute.arrApiName ?? "").trim(),
          ...(asRoute.arrApiIata ? { iata: asRoute.arrApiIata.trim() } : {})
        };
      }
      routeTelSource = routeHadOpenSky ? "mixed" : "aviationstack";
    }
  }

  if (selectedPlaneId !== entityId || trackedPlanes.get(entityId)?.icao24 !== watchHex) return;

  const depRecord = depIcao ? await airportRecordForIcao(depIcao) : null;
  const arrRecord = arrIcao ? await airportRecordForIcao(arrIcao) : null;
  const dep =
    depRecord != null
      ? { lat: depRecord.lat, lon: depRecord.lon }
      : adsbOrigin
        ? { lat: adsbOrigin.lat, lon: adsbOrigin.lon }
        : null;
  const arr =
    arrRecord != null
      ? { lat: arrRecord.lat, lon: arrRecord.lon }
      : adsbDest
        ? { lat: adsbDest.lat, lon: adsbDest.lon }
        : null;
  const ac = trackedPlanes.get(entityId);
  if (
    !ac ||
    typeof ac.latitude !== "number" ||
    typeof ac.longitude !== "number" ||
    selectedPlaneId !== entityId ||
    ac.icao24 !== watchHex
  ) {
    return;
  }

  const trafficKind = classifyAircraftTraffic(classifyInputFromNormalized(ac));
  const preferAirportNames =
    trafficKind === "airline" ||
    trafficKind === "bizjet" ||
    trafficKind === "military";
  const curLat = ac.latitude;
  const curLon = ac.longitude;
  const routeGlow = filedRouteGlowColor();
  let drewRoute = false;

  const routeDataTag = (): string => {
    switch (routeTelSource) {
      case "aviationstack":
        return " · Aviationstack flight status";
      case "opensky":
        return " · OpenSky ICAO24 history";
      case "mixed":
        return " · Aviationstack + OpenSky";
      case "adsbdb":
        return " · adsbdb flight route";
      default:
        return "";
    }
  };

  if (dep && arr) {
    drawSelectedPlaneRouteGlowLine(
      greatCircleCartesians(dep.lat, dep.lon, arr.lat, arr.lon, cruiseM),
      routeGlow,
      0.15
    );
    selectedPlaneRouteHint = `${depIcao}→${arrIcao}${routeDataTag()}`;
    selectedPlaneRouteFromText = formatAirportSidebar(
      depIcao!,
      depRecord,
      "departure",
      preferAirportNames,
      undefined,
      depApiOverlay
    );
    selectedPlaneRouteToText = formatAirportSidebar(
      arrIcao!,
      arrRecord,
      "arrival",
      preferAirportNames,
      undefined,
      arrApiOverlay
    );
    drewRoute = true;
  } else if (dep && !arr) {
    drawSelectedPlaneRouteGlowLine(
      greatCircleCartesians(dep.lat, dep.lon, curLat, curLon, cruiseM, 48),
      routeGlow.withAlpha(0.55),
      0.1
    );
    selectedPlaneRouteHint = `from ${depIcao} (partial${routeDataTag()})`;
    selectedPlaneRouteFromText = formatAirportSidebar(
      depIcao!,
      depRecord,
      "departure",
      preferAirportNames,
      undefined,
      depApiOverlay
    );
    selectedPlaneRouteToText = arrIcao
      ? formatAirportSidebar(
          arrIcao,
          arrRecord,
          "arrival",
          preferAirportNames,
          "map position missing",
          arrApiOverlay
        )
      : "Unknown destination (en route)";
    drewRoute = true;
  } else if (arr && !dep) {
    drawSelectedPlaneRouteGlowLine(
      greatCircleCartesians(curLat, curLon, arr.lat, arr.lon, cruiseM, 48),
      routeGlow.withAlpha(0.55),
      0.1
    );
    selectedPlaneRouteHint = `toward ${arrIcao} (partial${routeDataTag()})`;
    selectedPlaneRouteFromText = depIcao
      ? formatAirportSidebar(
          depIcao,
          depRecord,
          "departure",
          preferAirportNames,
          "map position missing",
          depApiOverlay
        )
      : "Unknown origin (en route)";
    selectedPlaneRouteToText = formatAirportSidebar(
      arrIcao!,
      arrRecord,
      "arrival",
      preferAirportNames,
      undefined,
      arrApiOverlay
    );
    drewRoute = true;
  } else if (
    typeof ac.headingDeg === "number" &&
    Number.isFinite(ac.headingDeg) &&
    !depIcao &&
    !arrIcao
  ) {
    /** Only when no filed airports were returned — otherwise text-only rows below still show ICAO/IATA from APIs. */
    const end = destinationFromBearingNm(curLon, curLat, ac.headingDeg, 240);
    drawSelectedPlaneRouteDashLine(greatCircleCartesians(curLat, curLon, end.lat, end.lon, cruiseM, 36));
    selectedPlaneRouteHint = "~240 NM track projection";
    selectedPlaneRouteFromText = "Current ADS-B position";
    selectedPlaneRouteToText = preferAirportNames
      ? `Along track · ~240 NM ahead (${ac.headingDeg.toFixed(0)}° true · no filed airport in data)`
      : `~240 NM ahead on ${ac.headingDeg.toFixed(0)}° true (approx.)`;
    drewRoute = true;
  }

  const textOnlyFrom = (): string =>
    depIcao
      ? formatAirportSidebar(
          depIcao,
          depRecord,
          "departure",
          preferAirportNames,
          "estimate · map unavailable",
          depApiOverlay
        )
      : "Not available";

  const textOnlyTo = (): string =>
    arrIcao
      ? formatAirportSidebar(
          arrIcao,
          arrRecord,
          "arrival",
          preferAirportNames,
          "estimate · map unavailable",
          arrApiOverlay
        )
      : "Not available";

  if (!drewRoute && depIcao && arrIcao) {
    selectedPlaneRouteHint = `${depIcao}→${arrIcao}${routeDataTag()}`;
    selectedPlaneRouteFromText = textOnlyFrom();
    selectedPlaneRouteToText = textOnlyTo();
  } else if (!drewRoute && depIcao) {
    selectedPlaneRouteHint = `from ${depIcao} (text only${routeDataTag()})`;
    selectedPlaneRouteFromText = textOnlyFrom();
    selectedPlaneRouteToText = "Not available";
  } else if (!drewRoute && arrIcao) {
    selectedPlaneRouteHint = `toward ${arrIcao} (text only${routeDataTag()})`;
    selectedPlaneRouteFromText = "Not available";
    selectedPlaneRouteToText = textOnlyTo();
  } else if (!drewRoute) {
    selectedPlaneRouteFromText = "Not available";
    selectedPlaneRouteToText = "Not available";
  }

  if (!drewRoute) removePlaneRoutePolyline();

  // Remember the endpoints so the card can show progress/ETA and the map can show what is still to fly.
  const arrLabel =
    (adsbDest?.municipality || adsbDest?.name || arrRecord?.displayName || arrIcao || "destination") +
    (arrIcao ? ` (${arrIcao})` : "");
  const airportInfo = (
    icao: string | null,
    pt: { lat: number; lon: number } | null,
    api: FlightRouteAirport | null,
    rec: { displayName?: string } | null
  ): PlaneAirportInfo | null =>
    pt
      ? {
          code: api?.iata || icao || "—",
          name: api?.municipality || api?.name || rec?.displayName || icao || "",
          lat: pt.lat,
          lon: pt.lon
        }
      : null;
  selectedPlaneRouteGeom =
    dep || arr
      ? {
          dep,
          arr,
          arrLabel,
          cruiseM,
          depInfo: airportInfo(depIcao, dep, adsbOrigin, depRecord),
          arrInfo: airportInfo(arrIcao, arr, adsbDest, arrRecord)
        }
      : null;
  planeAirportCams = null;
  drawPlaneRemainingLeg(ac);

  updateAircraftInfoCard(ac);
}

/** Bright dashed line from the aircraft's current position to its destination (the part still to fly). */
function drawPlaneRemainingLeg(ac: NormalizedAircraft): void {
  const existing = planesDataSource.entities.getById(SELECTED_PLANE_AHEAD_ID);
  if (existing) planesDataSource.entities.remove(existing);
  const g = selectedPlaneRouteGeom;
  if (!g?.arr || ac.onGround) {
    viewer.scene.requestRender();
    return;
  }
  const altM = altitudeFtToMeters(ac.altitudeFt);
  const heightM = typeof altM === "number" && !Number.isNaN(altM) ? altM : g.cruiseM;
  planesDataSource.entities.add({
    id: SELECTED_PLANE_AHEAD_ID,
    polyline: {
      positions: greatCircleCartesians(ac.latitude, ac.longitude, g.arr.lat, g.arr.lon, Math.max(heightM, 800), 48),
      width: 2.5,
      material: trackProjectionDashMaterial(0.95),
      clampToGround: false
    }
  });
  viewer.scene.requestRender();
}

/** Lightweight refresh while a plane stays selected: updates numbers and the route leg, never the photo or route. */
function refreshSelectedPlaneLive(entityId: string): void {
  const ac = trackedPlanes.get(entityId);
  if (!ac) {
    selectPlane(null);
    return;
  }
  updateAircraftInfoCard(ac, { live: true });
  drawPlaneRemainingLeg(ac);
}

function summaryEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function flyToAirport(a: PlaneAirportInfo): void {
  viewer.camera.flyToBoundingSphere(new BoundingSphere(Cartesian3.fromDegrees(a.lon, a.lat, 0), 2500), {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-50), 14_000),
    duration: 2.2
  });
}

function airportBlock(a: PlaneAirportInfo | null, which: "dep" | "arr", fallback: string): HTMLElement {
  const box = summaryEl("div", `plane-airport ${which === "arr" ? "to" : "from"}`);
  const code = summaryEl("button", "plane-airport-code", a?.code ?? "—");
  code.type = "button";
  if (a) {
    code.dataset.act = "fly-airport";
    code.dataset.which = which;
    code.title = `Zoom the globe to ${a.name || a.code}`;
  } else {
    code.disabled = true;
    code.title = fallback;
  }
  box.append(code, summaryEl("div", "plane-airport-name", a?.name ?? fallback));
  return box;
}

/** "Operated by Delta Air Lines · Wikipedia · Website" — the carrier is decoded from the callsign prefix. */
async function fillPlaneOperator(ac: NormalizedAircraft, kind: PlaneTrafficKind): Promise<void> {
  const box = document.getElementById("plane-summary-operator");
  if (!box) return;
  box.textContent = "";
  if (kind === "military" || !sanitizeCallsign(ac.callsign)) return;
  const hex = ac.icao24;
  const stillSelected = (): boolean =>
    !!selectedPlaneId && trackedPlanes.get(selectedPlaneId)?.icao24 === hex;
  preloadPlaneSupportingData();
  const guess = await airlineFromFlightId(ac.callsign ?? undefined);
  if (!guess || !stillSelected()) return;

  const line = summaryEl("p", "plane-operator");
  line.append(summaryEl("span", "plane-operator-label", "Operated by "), summaryEl("strong", undefined, guess.airlineName));
  box.append(line);

  const links = await airlineLinksFor(guess.airlineName);
  if (!links || !stillSelected()) return;
  const addLink = (label: string, href: string): void => {
    const a = summaryEl("a", "plane-operator-link", label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    line.append(summaryEl("span", "plane-operator-dot", " · "), a);
  };
  addLink("Wikipedia", links.wikipediaUrl);
  if (links.websiteUrl) addLink("Website", links.websiteUrl);
}

/** Plain-language one-glance card for the selected aircraft. Technical rows live under "More details". */
function renderPlaneSummary(ac: NormalizedAircraft, live: boolean): void {
  const head = document.getElementById("plane-summary-head");
  const routeEl = document.getElementById("plane-summary-route");
  const statsEl = document.getElementById("plane-summary-stats");
  const camsEl = document.getElementById("plane-summary-cams");
  if (!head || !routeEl || !statsEl || !camsEl) return;

  const kind = classifyAircraftTraffic(classifyInputFromNormalized(ac));
  const g = selectedPlaneRouteGeom;
  const routeState = selectedPlaneRouteFromText === "Retrieving…" ? "loading" : g ? "ok" : "none";
  // The slow parts (route, airports, camera links) are rebuilt only when their inputs change, never on live ticks.
  const key = `${ac.icao24}|${kind}|${notableGlowEnabled && notableFor(ac.icao24) ? "n" : ""}|${routeState}|${g?.depInfo?.code ?? ""}|${g?.arrInfo?.code ?? ""}|${planeAirportCams?.state ?? ""}|${planeAirportCams?.which ?? ""}`;

  if (key !== planeSummaryKey) {
    planeSummaryKey = key;
    head.textContent = "";
    const kindChip = summaryEl("span", "plane-chip", aircraftTrafficBucketLabel(kind));
    kindChip.style.setProperty("--pk", planeTrafficColorCss(kind));
    head.append(kindChip);
    const notable = notableGlowEnabled ? notableFor(ac.icao24) : undefined;
    if (notable) {
      const chip = notable.link ? summaryEl("a", "plane-chip plain plane-chip-notable") : summaryEl("span", "plane-chip plain plane-chip-notable");
      chip.textContent = `✦ ${notable.owner}`;
      if (chip instanceof HTMLAnchorElement && notable.link) {
        chip.href = notable.link;
        chip.target = "_blank";
        chip.rel = "noopener noreferrer";
        chip.title = "More about this aircraft";
      }
      head.append(chip);
    }
    const type = [ac.aircraftType, ac.registration].filter(Boolean).join(" · ");
    if (type) head.append(summaryEl("span", "plane-chip plain", type));

    void fillPlaneOperator(ac, kind);

    routeEl.textContent = "";
    if (routeState === "loading") {
      routeEl.append(summaryEl("p", "plane-route-note", "Looking up route…"));
    } else if (g?.depInfo || g?.arrInfo) {
      const line = summaryEl("div", "plane-route-line");
      line.append(
        airportBlock(g.depInfo, "dep", "Origin unknown"),
        summaryEl("span", "plane-route-arrow", "→"),
        airportBlock(g.arrInfo, "arr", "Destination unknown")
      );
      routeEl.append(line);
      const bar = summaryEl("div", "plane-progress");
      bar.append(document.createElement("i"));
      bar.id = "plane-progress-bar";
      routeEl.append(bar, summaryEl("p", "plane-route-note"));
      routeEl.lastElementChild!.id = "plane-route-note";
    } else {
      routeEl.append(
        summaryEl(
          "p",
          "plane-route-note",
          "No published route for this flight (private, military and many charter flights have none)."
        )
      );
    }

    camsEl.textContent = "";
    const ends = [
      ["dep", g?.depInfo] as const,
      ["arr", g?.arrInfo] as const
    ].filter(([, a]) => !!a);
    if (ends.length) {
      const links = summaryEl("div", "plane-cam-links");
      for (const [which, a] of ends) {
        const b = summaryEl("button", "plane-link-btn", `Cameras near ${a!.code}`);
        b.type = "button";
        b.dataset.act = "airport-cams";
        b.dataset.which = which;
        links.append(b);
      }
      camsEl.append(links);
      if (planeAirportCams) {
        const list = summaryEl("div", "plane-cam-list");
        if (planeAirportCams.state === "loading") {
          list.append(summaryEl("p", "plane-route-note", "Searching for cameras…"));
        } else if (!planeAirportCams.cams.length) {
          list.append(
            summaryEl("p", "plane-route-note", "No public cameras found within 25 km of this airport.")
          );
        } else {
          planeAirportCams.cams.forEach((cam, i) => {
            const b = summaryEl("button", "plane-link-btn", cam.name);
            b.type = "button";
            b.dataset.act = "open-cam";
            b.dataset.idx = String(i);
            b.append(summaryEl("small", undefined, cam.videoUrl ? "live video" : "still image"));
            list.append(b);
          });
        }
        camsEl.append(list);
      }
    }
  }

  // Live part: three big numbers, plus progress and ETA.
  const alt = ac.onGround ? "On ground" : ac.altitudeFt != null ? `${Math.round(ac.altitudeFt).toLocaleString()} ft` : "—";
  const spd = typeof ac.speedKt === "number" ? `${Math.round(ac.speedKt)} kt` : "—";
  const hdg = typeof ac.headingDeg === "number" ? `${Math.round(ac.headingDeg)}°` : "—";
  statsEl.textContent = "";
  const grid = summaryEl("div", "plane-stats");
  for (const [label, value] of [
    ["Altitude", alt],
    ["Speed", spd],
    ["Heading", hdg]
  ]) {
    const cell = summaryEl("div", "plane-stat");
    cell.append(summaryEl("span", undefined, label), summaryEl("strong", undefined, value));
    grid.append(cell);
  }
  statsEl.append(grid);

  const bar = document.getElementById("plane-progress-bar");
  const note = document.getElementById("plane-route-note");
  if (bar && note && g?.arr) {
    if (ac.onGround) {
      (bar.firstElementChild as HTMLElement).style.width = "100%";
      note.textContent = `On the ground · ${g.arrLabel}`;
    } else {
      const p = routeProgress({ lat: ac.latitude, lon: ac.longitude }, ac.speedKt, g.arr, g.dep, 80);
      const bearingToDest = bearingDeg(ac.latitude, ac.longitude, g.arr.lat, g.arr.lon);
      const offCourse =
        typeof ac.headingDeg === "number" && p.remainingNm > 40 && angleDiffDeg(ac.headingDeg, bearingToDest) > 75;
      const beyondOrigin = p.totalNm != null && p.remainingNm > p.totalNm + 60;
      if (offCourse || beyondOrigin) {
        (bar.firstElementChild as HTMLElement).style.width = "0%";
        note.textContent = "Not heading to the listed destination, so this route is probably a different leg.";
      } else {
        (bar.firstElementChild as HTMLElement).style.width = `${Math.round((p.fraction ?? 0) * 100)}%`;
        note.textContent =
          p.etaMinutes != null
            ? `${Math.round(p.remainingNm)} NM to go · arrives in ${formatDuration(p.etaMinutes)} (about ${arrivalClock(p.etaMinutes)})`
            : `${Math.round(p.remainingNm)} NM to go`;
      }
    }
  } else if (note) {
    note.textContent = "";
  }
}

async function loadAirportCameras(which: "dep" | "arr"): Promise<void> {
  const a = which === "dep" ? selectedPlaneRouteGeom?.depInfo : selectedPlaneRouteGeom?.arrInfo;
  const ac = selectedPlaneId ? trackedPlanes.get(selectedPlaneId) : undefined;
  if (!a || !ac) return;
  const hex = ac.icao24;
  planeAirportCams = { which, state: "loading", cams: [] };
  renderPlaneSummary(ac, false);
  let cams: EarthCamCamera[] = [];
  try {
    cams = await fetchCamerasNear(a.lat, a.lon, 25, 6);
  } catch {
    /* network error: shown as "none found" */
  }
  if (!planeAirportCams || planeAirportCams.which !== which) return;
  const cur = selectedPlaneId ? trackedPlanes.get(selectedPlaneId) : undefined;
  if (!cur || cur.icao24 !== hex) return;
  planeAirportCams = { which, state: "done", cams };
  renderPlaneSummary(cur, false);
}

document.getElementById("plane-summary")?.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!t) return;
  const which = t.dataset.which === "arr" ? "arr" : "dep";
  const g = selectedPlaneRouteGeom;
  if (t.dataset.act === "fly-airport") {
    const a = which === "dep" ? g?.depInfo : g?.arrInfo;
    if (a) flyToAirport(a);
  } else if (t.dataset.act === "airport-cams") {
    void loadAirportCameras(which);
  } else if (t.dataset.act === "open-cam") {
    const cam = planeAirportCams?.cams[Number(t.dataset.idx)];
    if (cam) earthCamController.openCameraLive(cam);
  }
});

/** "Progress" and "ETA" card rows from the selected aircraft's route, or [] when no destination is known. */
function planeProgressRows(ac: NormalizedAircraft): Array<[string, string]> {
  const g = selectedPlaneRouteGeom;
  if (!g?.arr) return [];
  if (ac.onGround) return [["Route status", `On the ground · destination ${g.arrLabel}`]];
  const p = routeProgress({ lat: ac.latitude, lon: ac.longitude }, ac.speedKt, g.arr, g.dep, 80);
  const rows: Array<[string, string]> = [];

  // Callsigns are reused across legs, so the published route can belong to a different flight than the one
  // actually in the air. If the aircraft isn't pointed at the listed destination, don't invent progress or an ETA.
  const bearingToDest = bearingDeg(ac.latitude, ac.longitude, g.arr.lat, g.arr.lon);
  const offCourse =
    typeof ac.headingDeg === "number" && p.remainingNm > 40 && angleDiffDeg(ac.headingDeg, bearingToDest) > 75;
  const beyondOrigin = p.totalNm != null && p.remainingNm > p.totalNm + 60;
  if (offCourse || beyondOrigin) {
    return [
      [
        "Route check",
        `This aircraft is not heading toward ${g.arrLabel}, so the published route is probably a different leg of this flight number. Progress and ETA are not shown.`
      ]
    ];
  }

  if (p.fraction != null && p.totalNm != null) {
    rows.push([
      "Route progress",
      `${Math.round(p.fraction * 100)}% · ${Math.round(p.totalNm - p.remainingNm)} of ${Math.round(p.totalNm)} NM direct distance`
    ]);
  }
  rows.push(["Distance to destination", `${Math.round(p.remainingNm)} NM (direct line to ${g.arrLabel})`]);
  if (p.etaMinutes != null) {
    rows.push([
      "ETA (estimated)",
      `${formatDuration(p.etaMinutes)} · ${arrivalClock(p.etaMinutes)} — direct line at current speed`
    ]);
  }
  return rows;
}

function drawSelectedTrail(satellite: Satellite): void {
  clearSelectedTrail();
  // One full orbit ahead (capped at a day), half an orbit behind; ~240 points per lap keeps curves smooth.
  const periodSec = Math.min(24 * 3600, (orbitalPeriodMin(satellite) ?? 90) * 60);
  const step = Math.max(20, periodSec / 240);
  const pastPositions = buildTrailPoints(satellite, -periodSec / 2, 0, step);
  const futurePositions = buildTrailPoints(satellite, 0, periodSec, step);

  selectedPastTrail = satellitesDataSource.entities.add({
    id: "selected-trail-past",
    polyline: {
      positions: pastPositions,
      width: 1.8,
      material: new PolylineGlowMaterialProperty({
        color: Color.fromCssColorString("#90a8c5").withAlpha(0.5),
        glowPower: 0.12
      })
    }
  });

  selectedFutureTrail = satellitesDataSource.entities.add({
    id: "selected-trail-future",
    polyline: {
      positions: futurePositions,
      width: 2.4,
      material: new PolylineGlowMaterialProperty({
        color: Color.fromCssColorString("#66d8ff").withAlpha(0.95),
        glowPower: 0.2
      })
    }
  });
}

function clearPlaneSelection(): void {
  clearSelectedPlaneRoute();
  const prev = selectedPlaneId;
  selectedPlaneId = null;
  restylePlane(prev);
}

function updateAircraftInfoCard(aircraft: NormalizedAircraft | null, opts?: { live?: boolean }): void {
  if (!aircraft) {
    flightCarrierGuessSeq++;
    aviationstackHintSeq++;
    clearAircraftSidebarMedia();
    hidePlaneRouteSection();
    toggleAircraftOnlyInfoRows(false);
    hideAlprDetailRows();
    showCoreInfoRows();
    satNameEl?.classList.remove("hidden");
    if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "SIGINT";
    satInfoEl?.classList.add("hidden");
    resetInfoPanelTitles();
    if (satNameEl) satNameEl.textContent = "Click a satellite";
    if (satOperatorEl) satOperatorEl.textContent = "-";
    if (satCountryEl) satCountryEl.textContent = "-";
    if (satSpeedEl) satSpeedEl.textContent = "-";
    if (satPurposeEl) satPurposeEl.textContent = "-";
    if (satSourceEl) satSourceEl.textContent = "-";
    hideAirlineDestinationDataRow();
    return;
  }

  hideAlprDetailRows();
  showCoreInfoRows();
  satNameEl?.classList.remove("hidden");
  if (intelCardModeBadgeEl) intelCardModeBadgeEl.textContent = "SIGINT";

  setAircraftPanelLabels();
  satInfoEl?.classList.remove("hidden");
  const label = sanitizeCallsign(aircraft.callsign) ?? aircraft.icao24.toUpperCase();
  if (satNameEl) satNameEl.textContent = label;
  const bucket = classifyAircraftTraffic(classifyInputFromNormalized(aircraft));
  if (satTrafficKindEl) satTrafficKindEl.textContent = aircraftTrafficBucketLabel(bucket);

  if (!opts?.live) {
    flightCarrierGuessSeq++;
    const inferSeq = flightCarrierGuessSeq;
    const inferHex = aircraft.icao24;
    if (satFlightCarrierGuessEl)
      satFlightCarrierGuessEl.textContent = sanitizeCallsign(aircraft.callsign) ? "…" : "—";
    void (async () => {
      preloadPlaneSupportingData();
      const guess = await airlineFromFlightId(aircraft.callsign ?? undefined);
      if (
        inferSeq !== flightCarrierGuessSeq ||
        !selectedPlaneId ||
        trackedPlanes.get(selectedPlaneId)?.icao24 !== inferHex
      ) {
        return;
      }
      if (!satFlightCarrierGuessEl) return;
      if (!guess) {
        satFlightCarrierGuessEl.textContent = sanitizeCallsign(aircraft.callsign)
          ? "No carrier decode"
          : "—";
        return;
      }
      const filed = `${guess.code}${guess.flightNumberPart}`;
      satFlightCarrierGuessEl.textContent = `${guess.airlineName} (${filed} · OpenFlight prefix match)`;
    })();
  }

  const typeLine = [aircraft.aircraftType, aircraft.description].filter(Boolean).join(" · ") || "—";
  if (satOperatorEl) satOperatorEl.textContent = typeLine;
  if (bucket === "military") {
    if (infoL2El) infoL2El.textContent = "Military operator country";
    const guess = guessMilitaryOperatorCountry(aircraft);
    if (satCountryEl) {
      satCountryEl.textContent = guess
        ? aircraft.registration
          ? `${guess} (reg ${aircraft.registration})`
          : `${guess} (estimated)`
        : aircraft.registration
          ? `Unknown (reg ${aircraft.registration})`
          : "Unknown";
    }
  } else {
    if (infoL2El) infoL2El.textContent = "Operator Country / Registration";
    if (satCountryEl) satCountryEl.textContent = aircraft.registration ?? "—";
  }

  let speedTrack = "—";
  const gsPart = typeof aircraft.speedKt === "number" ? `${aircraft.speedKt.toFixed(0)} kt` : null;
  const trPart =
    typeof aircraft.headingDeg === "number" ? `${aircraft.headingDeg.toFixed(0)}°` : null;
  if (gsPart && trPart) speedTrack = `${gsPart}, ${trPart}`;
  else if (gsPart) speedTrack = gsPart;
  else if (trPart) speedTrack = trPart;
  if (satSpeedEl) satSpeedEl.textContent = speedTrack;

  if (satPurposeEl) {
    if (aircraft.onGround) satPurposeEl.textContent = "On ground";
    else if (typeof aircraft.altitudeFt === "number")
      satPurposeEl.textContent = `${aircraft.altitudeFt.toFixed(0)} ft baro`;
    else satPurposeEl.textContent = "—";
  }
  if (satSourceEl) {
    const enr =
      aircraft.enrichedFrom && aircraft.enrichedFrom.length
        ? ` · +${aircraft.enrichedFrom.join(", ")}`
        : "";
    let src = `Position: ${aircraft.positionSource}${enr}`;
    if (selectedPlaneRouteHint) src += ` · ${selectedPlaneRouteHint}`;
    satSourceEl.textContent = src;
  }

  syncPlaneRouteSectionToPanel();
  renderPlaneSummary(aircraft, !!opts?.live);
  if (opts?.live) {
    // Live tick: only the changing numbers. Photo, gallery, route lookups and hints are left untouched.
    renderPlaneExtraRows(aircraft);
    return;
  }
  syncAirlineDestinationDataRow(aircraft, bucket);
  syncAircraftSidebarMediaAndExtras(aircraft);
}

function selectPlane(entityId: string | null, opts?: { flyTo?: boolean }): void {
  clearEarthcamSelectionQuietly();
  selectDatacenterSite(null);
  selectAlprSite(null);
  selectGeocodePlace(null);
  clearVesselSelectionQuietly();
  if (selectedSatelliteId) {
    const prevSat = satellitesDataSource.entities.getById(selectedSatelliteId);
    if (prevSat?.point) {
      (prevSat.point as any).pixelSize = SAT_POINT_PX;
      (prevSat.point as any).color = Color.fromCssColorString("#6ed8ff");
    }
    selectedSatelliteId = null;
    clearSelectedTrail();
  }

  if (entityId !== selectedPlaneId) {
    clearSelectedPlaneRoute();
  }

  const prevSelectedPlane = selectedPlaneId;
  selectedPlaneId = entityId;
  restylePlane(prevSelectedPlane);
  restylePlane(entityId);
  viewer.scene.requestRender();
  if (entityId) {
    selectedPlaneRouteFromText = "Retrieving…";
    selectedPlaneRouteToText = "Retrieving…";
    selectedPlaneRouteHint = null;
  }
  if (!entityId) {
    updateAircraftInfoCard(null);
    applyPlaneCategoryVisibility();
    return;
  }

  const current = planesDataSource.entities.getById(entityId);

  const aircraft = trackedPlanes.get(entityId) ?? null;
  if (aircraft) {
    updateAircraftInfoCard(aircraft);
    void loadAndDrawSelectedPlaneRoute(entityId);
  }

  applyPlaneCategoryVisibility();

  if (opts?.flyTo && current) {
    void viewer.flyTo(current, { duration: 1.25 }).catch(() => {});
  }
}

function selectSatellite(entityId: string | null): void {
  clearEarthcamSelectionQuietly();
  selectGeocodePlace(null);
  clearPlaneSelection();
  selectDatacenterSite(null);
  selectAlprSite(null);
  clearVesselSelectionQuietly();

  if (selectedSatelliteId && selectedSatelliteId !== entityId) {
    const prev = satellitesDataSource.entities.getById(selectedSatelliteId);
    if (prev?.point) {
      (prev.point as any).pixelSize = SAT_POINT_PX;
      (prev.point as any).color = Color.fromCssColorString("#6ed8ff");
    }
  }

  selectedSatelliteId = entityId;
  if (!entityId) {
    clearSelectedTrail();
    updateInfoCard(null);
    return;
  }

  const current = satellitesDataSource.entities.getById(entityId);
  if (current?.point) {
    (current.point as any).pixelSize = 9;
    (current.point as any).color = Color.fromCssColorString("#ffd56b");
  }

  const sat = trackedEntities.get(entityId) ?? null;
  if (sat) {
    updateInfoCard(sat);
    void enrichSelectedWithN2Yo(sat);
    drawSelectedTrail(sat);
  }
}

function setupPicking(): void {
  const clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction((event: { position: Cartesian2 }) => {
    if (pickingMyLocation) {
      finishPickMyLocation(event.position);
      return;
    }
    const picked = viewer.scene.pick(event.position);
    const pickedEntity =
      picked && typeof picked === "object" && "id" in picked ? (picked.id as Entity) : null;

    if (pickedEntity instanceof Entity && layerHost?.pick(pickedEntity)) return;

    if (pickedEntity instanceof Entity && typeof pickedEntity.id === "string") {
      const clustered = clusterEntitiesFromPick(pickedEntity);
      if (clustered?.length && /^(alpr|dc)-site-/.test(String(clustered[0]!.id))) {
        // A bubble of ALPR cameras or data centers: zoom in until it splits apart.
        const pts: Cartesian3[] = [];
        for (const e of clustered) {
          const p = e.position?.getValue(JulianDate.now());
          if (p) pts.push(p);
        }
        if (pts.length) {
          const bs = BoundingSphere.fromPoints(pts);
          bs.radius = Math.max(bs.radius * 1.6, 1500);
          viewer.camera.flyToBoundingSphere(bs, { duration: 1.1 });
        }
        return;
      }
      if (clustered?.length && earthCamController.isVisible()) {
        earthCamController.handlePick(null, clustered);
        return;
      }
      const eid = pickedEntity.id;
      if (trackedPlanes.has(eid)) {
        selectPlane(eid);
        return;
      }
      if (trackedEntities.has(eid)) {
        selectSatellite(eid);
        return;
      }
      if (typeof eid === "string" && eid.startsWith("vessel-")) {
        selectVessel(eid);
        return;
      }
      if (alprLayer.isAlprPointEntityId(eid)) {
        selectAlprSite(eid);
        return;
      }
      if (datacenterLayer.isDatacenterPointEntityId(eid)) {
        selectDatacenterSite(eid);
        return;
      }
      if (earthCamController.layer.isEarthcamPointEntityId(eid)) {
        earthCamController.selectCamera(eid);
        return;
      }
      if (eid === PLACE_SEARCH_PIN_ID && cachedPlaceSearchHitForPin) {
        selectGeocodePlace(cachedPlaceSearchHitForPin);
        return;
      }
    }

    selectSatellite(null);
  }, ScreenSpaceEventType.LEFT_CLICK);

  /** Hover picking renders an id pass, so it is limited to ~25 picks/s with a trailing pick at the final position. */
  let hoverPickAt = 0;
  let hoverTimer = 0;
  const pendingHover = new Cartesian2();
  const runHoverPick = (endPosition: Cartesian2): void => {
    const picked = viewer.scene.pick(endPosition);
    const pickedEntity =
      picked && typeof picked === "object" && "id" in picked ? (picked.id as Entity) : null;
    const next =
      pickedEntity instanceof Entity &&
      typeof pickedEntity.id === "string" &&
      trackedPlanes.has(pickedEntity.id)
        ? pickedEntity.id
        : null;
    if (next !== hoveredPlaneEntityId) {
      const prevHover = hoveredPlaneEntityId;
      hoveredPlaneEntityId = next;
      restylePlane(prevHover);
      restylePlane(next);
      viewer.scene.requestRender();
    }
    const nextAlpr =
      pickedEntity instanceof Entity &&
      typeof pickedEntity.id === "string" &&
      alprLayer.isAlprPointEntityId(pickedEntity.id)
        ? pickedEntity.id
        : null;
    if (nextAlpr !== hoveredAlprEntityId) {
      hoveredAlprEntityId = nextAlpr;
      alprLayer.setHoveredEntityId(nextAlpr);
      viewer.scene.requestRender();
    }
    const nextDc =
      pickedEntity instanceof Entity &&
      typeof pickedEntity.id === "string" &&
      datacenterLayer.isDatacenterPointEntityId(pickedEntity.id)
        ? pickedEntity.id
        : null;
    if (nextDc !== hoveredDatacenterEntityId) {
      hoveredDatacenterEntityId = nextDc;
      datacenterLayer.setHoveredEntityId(nextDc);
      viewer.scene.requestRender();
    }
    const nextEc =
      pickedEntity instanceof Entity &&
      typeof pickedEntity.id === "string" &&
      earthCamController.layer.isEarthcamPointEntityId(pickedEntity.id)
        ? pickedEntity.id
        : null;
    if (nextEc !== hoveredEarthcamEntityId) {
      hoveredEarthcamEntityId = nextEc;
      earthCamController.handleHover(nextEc);
      viewer.scene.requestRender();
    }
  };
  clickHandler.setInputAction((movement: { endPosition: Cartesian2 }) => {
    Cartesian2.clone(movement.endPosition, pendingHover);
    if (hoverTimer) return;
    const wait = Math.max(0, 40 - (performance.now() - hoverPickAt));
    hoverTimer = window.setTimeout(() => {
      hoverTimer = 0;
      hoverPickAt = performance.now();
      runHoverPick(pendingHover);
    }, wait);
  }, ScreenSpaceEventType.MOUSE_MOVE);
}

const SAT_POINT_PX = 5;
const SAT_POINT_COLOR = Color.fromCssColorString("#6ed8ff");
/** Full size within ~2,000 km, shrinking to 35% by ~30,000 km so a whole-Earth view stays readable. */
const SAT_POINT_SCALE = new NearFarScalar(2e6, 1, 3e7, 0.35);

function renderSatellites(satellites: Satellite[], opts?: { zoom?: boolean }): void {
  const now = new Date();
  const gmst = gstime(now);
  const viewRect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  const renderPool = showAllSatellitesFromCache
    ? satellites
    : pickSatellitesForCurrentView(satellites, now, viewRect);
  const entities = satellitesDataSource.entities;
  trackedEntities.clear();

  entities.removeAll();
  entities.suspendEvents();

  for (const satellite of renderPool) {
    const position = getSatellitePosition(satellite, now, gmst);
    if (!position) continue;

    const entity = entities.add({
      id: `sat-${satellite.noradId}`,
      position: new ConstantPositionProperty(position),
      point: {
        pixelSize: SAT_POINT_PX,
        color: SAT_POINT_COLOR,
        // No outline and shrink with distance: 16k outlined 6 px dots otherwise paint over the whole globe.
        scaleByDistance: SAT_POINT_SCALE,
        // Keep the depth test on so satellites on the far side of the Earth are hidden by it, not drawn through it.
        disableDepthTestDistance: 0
      }
    });

    if (typeof entity.id === "string") trackedEntities.set(entity.id, satellite);
  }

  entities.resumeEvents();
  updateVisibleSatellitesInView();
  // Frame the planet, not the satellite cloud: the cloud's bounding sphere spans GEO and puts Earth off-centre.
  if (opts?.zoom) frameEarth();
  viewer.scene.requestRender();
}

/** Bumped every time a position pass starts, so an unfinished older pass stops itself. */
let satPassToken = 0;
/** Longest stretch of the main thread a slice of the position pass may use before it yields to rendering. */
const SAT_SLICE_MS = 6;

function refreshSatellitePositions(): void {
  // Propagating thousands of orbits while the layer is hidden or the tab is in the background is pure waste.
  if (!satellitesVisible || document.hidden) return;
  const token = ++satPassToken;
  const now = new Date();
  const gmst = gstime(now);
  const entities = satellitesDataSource.entities;
  const items = Array.from(trackedEntities.entries());
  let i = 0;

  // Tens of thousands of orbit propagations in one go froze the page for ~60 ms every few seconds. The same work is
  // done in short slices between frames instead, so nothing visibly hitches and no position is skipped.
  const slice = (): void => {
    if (token !== satPassToken || !satellitesVisible) return;
    const t0 = performance.now();
    entities.suspendEvents();
    while (i < items.length) {
      const [entityId, satellite] = items[i++]!;
      const entity = entities.getById(entityId);
      if (entity) {
        const position = getSatellitePosition(satellite, now, gmst);
        if (position) {
          const p = entity.position;
          if (p instanceof ConstantPositionProperty) p.setValue(position);
          else entity.position = new ConstantPositionProperty(position);
        }
      }
      if ((i & 31) === 0 && performance.now() - t0 > SAT_SLICE_MS) break;
    }
    entities.resumeEvents();
    // Redraw once, when the whole pass is done: a pass takes several slices and a redraw after each one made the
    // whole globe repaint (and the menus above it flicker) many times for a single update.
    if (i < items.length) {
      window.setTimeout(slice, 0);
      return;
    }
    if (selectedSatelliteId && trackedEntities.has(selectedSatelliteId)) {
      const selected = trackedEntities.get(selectedSatelliteId) ?? null;
      if (selected) updateInfoCard(selected);
    }
    updateVisibleSatellitesInView();
    viewer.scene.requestRender();
  };
  slice();
}

async function ensureSatellitesRenderedIfNeeded(): Promise<void> {
  if (trackedEntities.size > 0) return;
  setStatus(appendTrackingSuffix(`Loading ${getSourceLabel(currentSource)} catalog…`));
  try {
    let sats = loadSatelliteCache(currentSource);
    if (!sats || sats.length === 0) {
      const snaps = loadSatelliteSourceSnapshots(currentSource);
      if (snaps.length > 0) sats = snaps;
    }
    if (!sats || sats.length === 0) {
      sats = await loadSatellitesForSource(currentSource);
    }
    if (!sats || sats.length === 0) {
      throw new Error("No satellites available for this source.");
    }
    renderSatellites(sats, { zoom: true });
    // Only persist a catalog we actually just downloaded; re-saving the cached copy would reset its age.
    if (!satCatalogFresh(currentSource)) saveSatelliteCache(currentSource, sats);
  } catch (e) {
    console.error(e);
    setStatus(
      appendTrackingSuffix(
        "Could not load satellites. Check network or API key, or try the other source."
      )
    );
  }
}

function setupVisibilityToggle(): void {
  if (!toggleSatellitesEl) return;

  toggleSatellitesEl.addEventListener("click", () => {
    satellitesVisible = !satellitesVisible;
    satellitesDataSource.show = satellitesVisible;
    if (!satellitesVisible) {
      selectSatellite(null);
      sourceControlsEl?.classList.add("hidden");
      toggleSatellitesEl.textContent = "SAT · OFF";
      updateVisibleSatellitesInView();
      return;
    }

    sourceControlsEl?.classList.remove("hidden");
    toggleSatellitesEl.textContent = "SAT · ON";
    void ensureSatellitesRenderedIfNeeded().finally(() => updateVisibleSatellitesInView());
  });

  sourceKeepTrackEl?.addEventListener("click", () => {
    void switchSource("keeptrack");
  });

  sourceCelestrakEl?.addEventListener("click", () => {
    void switchSource("celestrak");
  });

  sourceShowAllEl?.addEventListener("click", () => {
    showAllSatellitesFromCache = !showAllSatellitesFromCache;
    setActiveSourceButton(currentSource);
    const sourceSatellites = loadSatelliteSourceSnapshots(currentSource);
    if (sourceSatellites.length > 0) {
      renderSatellites(sourceSatellites);
    } else {
      renderSatellites(Array.from(trackedEntities.values()));
    }
  });
}

function isLongitudeInRectangle(rectangle: Rectangle, lon: number): boolean {
  if (rectangle.west <= rectangle.east) {
    return lon >= rectangle.west && lon <= rectangle.east;
  }
  return lon >= rectangle.west || lon <= rectangle.east;
}

function pickSatellitesForCurrentView(
  satellites: Satellite[],
  now: Date,
  viewRect: Rectangle | undefined
): Satellite[] {
  if (!viewRect) return satellites.slice(0, MAX_VISIBLE_SATELLITES_IN_VIEW * 2);

  const out: Satellite[] = [];
  const gmst = gstime(now);
  for (const sat of satellites) {
    const position = getSatellitePosition(sat, now, gmst);
    if (!position) continue;
    const cartographic = Cartographic.fromCartesian(position);
    const inLatitude =
      cartographic.latitude >= viewRect.south && cartographic.latitude <= viewRect.north;
    const inLongitude = isLongitudeInRectangle(viewRect, cartographic.longitude);
    if (inLatitude && inLongitude) out.push(sat);
    if (out.length >= MAX_VISIBLE_SATELLITES_IN_VIEW * 2) break;
  }

  return out.length > 0 ? out : satellites.slice(0, MAX_VISIBLE_SATELLITES_IN_VIEW);
}

const scratchCullCarto = new Cartographic();

function updateVisibleSatellitesInView(aircraftHint?: string): void {
  if (!satellitesVisible) {
    const hidden = "Satellites hidden";
    lastSatelliteStatusLine = hidden;
    setStatus(appendTrackingSuffix(hidden, aircraftHint));
    return;
  }

  const viewRect = showAllSatellitesFromCache ? undefined : viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  const entities = satellitesDataSource.entities.values;
  const cullTime = JulianDate.now();
  const cam = viewer.camera.positionWC;
  // A dot behind the Earth is hidden by the planet anyway, so it is not worth sending to the graphics card. The
  // threshold is generous on purpose: satellites high above the limb are still visible past the horizon plane.
  const horizonDot = SAT_HORIZON_R * SAT_HORIZON_R * 0.85;

  const candidates: Entity[] = [];
  let total = 0;
  for (const entity of entities) {
    if (typeof entity.id !== "string" || !trackedEntities.has(entity.id)) continue;
    total += 1;
    const keep = entity.id === selectedSatelliteId;
    const position = entity.position?.getValue?.(cullTime) as Cartesian3 | undefined;
    if (!position) {
      entity.show = false;
      continue;
    }
    if (Cartesian3.dot(position, cam) < horizonDot) {
      entity.show = keep;
      continue;
    }
    if (viewRect) {
      const cartographic = Cartographic.fromCartesian(position, undefined, scratchCullCarto);
      const inLatitude = cartographic.latitude >= viewRect.south && cartographic.latitude <= viewRect.north;
      if (!inLatitude || !isLongitudeInRectangle(viewRect, cartographic.longitude)) {
        entity.show = keep;
        continue;
      }
    }
    candidates.push(entity);
  }

  // A phone draws an evenly spread sample of what is in view; the desktop draws all of it (or the old 999 cap when
  // "View region only" is on).
  const phone = isPhoneClass();
  const budget = Math.min(showAllSatellitesFromCache ? Infinity : MAX_VISIBLE_SATELLITES_IN_VIEW, phone ? PHONE_SATELLITE_BUDGET : Infinity);
  const stride = candidates.length > budget ? candidates.length / budget : 1;
  let acc = 0;
  let shown = 0;
  for (const entity of candidates) {
    acc += 1;
    let show = true;
    if (stride > 1) {
      if (acc >= stride) acc -= stride;
      else show = false;
    }
    entity.show = show || entity.id === selectedSatelliteId;
    if (show) shown += 1;
  }

  const catalogNote = getSatCatalogNote();
  const sampled = stride > 1 ? ` · sample of ${candidates.length}` : "";
  const scope = showAllSatellitesFromCache ? ` (all cached${catalogNote ? ` · ${catalogNote}` : ""}${sampled})` : sampled ? ` (${sampled.slice(3)})` : "";
  const satellitesLine = `Satellites shown: ${shown} / ${total} | Source: ${getSourceLabel(currentSource)}${scope}`;
  lastSatelliteStatusLine = satellitesLine;
  setStatus(appendTrackingSuffix(satellitesLine, aircraftHint));
}

const SAT_HORIZON_R = 6_378_137;
function appendCacheLog(entry: CacheLogEntry): void {
  try {
    const raw = localStorage.getItem(SAT_CACHE_LOG_KEY);
    const logs = raw ? ((JSON.parse(raw) as CacheLogEntry[]) ?? []) : [];
    const cutoff = Date.now() - CACHE_LOG_RETENTION_MS;
    const pruned = logs.filter((log) => log.timestamp >= cutoff);
    pruned.push(entry);
    localStorage.setItem(SAT_CACHE_LOG_KEY, JSON.stringify(pruned));
  } catch {
    // Ignore cache log write errors.
  }
}

function saveSatelliteCache(source: SourceName, satellites: Satellite[]): void {
  putSatCache(source, satellites);
  appendCacheLog({
    timestamp: Date.now(),
    source,
    count: satellites.length,
    status: "success",
    message: "Cached source satellites"
  });
}

/** Kept for call-site compatibility: there is now exactly one (latest) snapshot per source. */
function loadSatelliteSourceSnapshots(source: SourceName): Satellite[] {
  return getSatCache(source) ?? [];
}

function loadSatelliteCache(source?: SourceName): Satellite[] | null {
  if (source) return getSatCache(source);
  const merged = new Map<number, Satellite>();
  for (const key of ["keeptrack", "celestrak"] as SourceName[]) {
    for (const sat of getSatCache(key) ?? []) merged.set(sat.noradId, sat);
  }
  return merged.size > 0 ? Array.from(merged.values()) : null;
}

/** Later lists overwrite earlier entries for the same NORAD (CelesTrak wins over KeepTrack). */
function mergeSatelliteListsPreferLater(lists: Satellite[][]): Satellite[] {
  const m = new Map<number, Satellite>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      if (s && typeof s.noradId === "number") m.set(s.noradId, s);
    }
  }
  return Array.from(m.values());
}

/** A partial (fallback) catalog is only trusted for minutes so the full one replaces it as soon as it is available. */
function satCatalogFresh(source: SourceName): boolean {
  const n = getSatCache(source)?.length ?? 0;
  return satCacheAgeMs(source) < (n >= FULL_CATALOG_MIN ? SAT_CATALOG_TTL_MS : SAT_PARTIAL_RETRY_MS);
}

/** Saves a freshly downloaded catalog and, if that layer is on screen, redraws it (without moving the camera). */
function adoptFreshCatalog(source: SourceName, sats: Satellite[]): void {
  const previous = getSatCache(source)?.length ?? 0;
  saveSatelliteCache(source, sats);
  if (satellitesVisible && source === currentSource && Math.abs(sats.length - previous) > 50) {
    renderSatellites(sats);
  }
}

async function prefetchSatelliteCaches(): Promise<void> {
  // The browser keeps its own copy (IndexedDB), so satellites still show if the local server is down.
  if (!satCatalogFresh("celestrak")) {
    setStatus(appendTrackingSuffix("Loading satellite catalog…"));
    try {
      const sats = await loadSatellitesForSource("celestrak");
      if (sats.length > 0) adoptFreshCatalog("celestrak", sats);
    } catch (e) {
      console.warn("[satellites] prefetch failed, keeping any cached catalog:", e);
    }
  }
  const n = loadSatelliteCache("celestrak")?.length ?? 0;
  const note = getSatCatalogNote();
  setStatus(
    appendTrackingSuffix(`Ready — ${n} satellites cached${note ? ` (${note})` : ""}. Tap Show Satellites.`)
  );
}

async function refreshSourceCache(source: SourceName): Promise<void> {
  if (source === "keeptrack" && (currentSource !== "keeptrack" || !(await keepTrackAvailable()))) return;
  if (satCatalogFresh(source)) return;
  try {
    const satellites = await loadSatellitesForSource(source);
    if (satellites.length > 0) {
      adoptFreshCatalog(source, satellites);
    }
  } catch (error) {
    appendCacheLog({
      timestamp: Date.now(),
      source,
      count: 0,
      status: "error",
      message: String(error)
    });
  }
}

/** Checks cache age every few minutes; a catalog is only re-downloaded once it is older than the TTL. */
function setupPeriodicCacheRefresh(): void {
  window.setInterval(() => {
    if (document.hidden) return;
    void refreshSourceCache("keeptrack");
    void refreshSourceCache("celestrak");
  }, CACHE_REFRESH_MS);
}

function setActiveSourceButton(source: "keeptrack" | "celestrak"): void {
  sourceKeepTrackEl?.classList.toggle("active", source === "keeptrack");
  sourceCelestrakEl?.classList.toggle("active", source === "celestrak");
  sourceShowAllEl?.classList.toggle("active", showAllSatellitesFromCache);
  if (sourceShowAllEl) {
    sourceShowAllEl.textContent = showAllSatellitesFromCache ? "View region only" : "Show all cache";
  }
}

async function loadSatellitesForSource(source: "keeptrack" | "celestrak"): Promise<Satellite[]> {
  if (source === "keeptrack") {
    if (!(await keepTrackAvailable())) {
      showKeyHint("keeptrack");
      throw new Error("KeepTrack key missing on the server (add it in the Keys menu).");
    }
    return fetchKeepTrackMergedCatalog();
  }

  /**
   * The local server already chains CelesTrak → KeepTrack → SatNOGS+cache, so the browser asks it first.
   * Only if the result is a partial catalog does the browser pull KeepTrack itself (≈50 MB), as a last resort.
   */
  const layers: Satellite[][] = [];
  let direct: Satellite[] = [];
  try {
    direct = await fetchActiveSatellites();
  } catch {
    /* cache / KeepTrack-only below */
  }
  if (direct.length < FULL_CATALOG_MIN && (await keepTrackAvailable())) {
    try {
      layers.push(await fetchKeepTrackMergedCatalog());
    } catch {
      const ktSnap = loadSatelliteCache("keeptrack");
      if (ktSnap && ktSnap.length > 0) layers.push(ktSnap);
    }
  }
  layers.push(direct);
  const merged = mergeSatelliteListsPreferLater(layers);
  if (merged.length > 0) return merged;
  const recent = loadSatelliteSourceSnapshots("celestrak");
  if (recent.length > 0) return recent;
  throw new Error("No satellites loaded from CelesTrak feeds.");
}

/** While a new source loads, prefer the last source’s disk cache (then target cache) so the globe stays populated. */
function satellitesForSwitchPlaceholder(
  previous: SourceName,
  target: SourceName
): Satellite[] | null {
  const trySource = (s: SourceName): Satellite[] | null => {
    const c = loadSatelliteCache(s);
    if (c && c.length > 0) return c;
    const snaps = loadSatelliteSourceSnapshots(s);
    return snaps.length > 0 ? snaps : null;
  };
  return trySource(previous) ?? trySource(target);
}

async function switchSource(source: "keeptrack" | "celestrak"): Promise<void> {
  if (source === currentSource) {
    return;
  }
  const previousSource = currentSource;
  clearKeyHint("keeptrack");
  setStatus(appendTrackingSuffix(`Switching source to ${getSourceLabel(source)}…`));

  if (trackedEntities.size === 0) {
    const ph = satellitesForSwitchPlaceholder(previousSource, source);
    if (ph && ph.length > 0) {
      renderSatellites(ph);
    }
  }

  try {
    const satellites = await loadSatellitesForSource(source);
    if (satellites.length === 0) {
      throw new Error(`No satellites returned from ${getSourceLabel(source)}`);
    }
    currentSource = source;
    setActiveSourceButton(source);
    renderSatellites(satellites);
    saveSatelliteCache(source, satellites);
  } catch (error) {
    console.error(error);
    const recentForSource = loadSatelliteSourceSnapshots(source);
    if (recentForSource.length > 0) {
      currentSource = source;
      setActiveSourceButton(source);
      renderSatellites(recentForSource);
      saveSatelliteCache(source, recentForSource);
      setStatus(
        appendTrackingSuffix(`Live ${getSourceLabel(source)} unavailable. Showing cached snapshots: ${recentForSource.length}`)
      );
      return;
    }
    if (source !== "keeptrack" && (await keepTrackAvailable())) {
      try {
        if (source === "celestrak") {
          const mirrorSatellites = await fetchKeepTrackCelestrakMirrorSatellites();
          if (mirrorSatellites.length > 0) {
            currentSource = "celestrak";
            setActiveSourceButton("celestrak");
            renderSatellites(mirrorSatellites);
            saveSatelliteCache("celestrak", mirrorSatellites);
            return;
          }
        }

        const keepTrackSatellites = await loadSatellitesForSource("keeptrack");
        if (keepTrackSatellites.length > 0) {
          currentSource = "keeptrack";
          setActiveSourceButton("keeptrack");
          renderSatellites(keepTrackSatellites);
          saveSatelliteCache("keeptrack", keepTrackSatellites);
          setStatus(
            appendTrackingSuffix(
              source === "celestrak"
                ? `CelesTrak unavailable — using KeepTrack catalog (${keepTrackSatellites.length} satellites).`
                : `Showing KeepTrack catalog (${keepTrackSatellites.length} satellites).`
            )
          );
          return;
        }
      } catch (fallbackError) {
        console.error(fallbackError);
      }
    }

    setStatus(appendTrackingSuffix(`Failed to load ${getSourceLabel(source)} satellites`));
  }
}

async function bootstrap(): Promise<void> {
  setStatus(appendTrackingSuffix("Initializing globe…"));
  if (toggleSatellitesEl) {
    toggleSatellitesEl.textContent = "SAT · OFF";
  }
  await configureGlobeVisuals();
  // Open with the whole planet centred in the space the panels leave free (the stock view is cropped and off-centre).
  frameEarth({ duration: 0 });
  homeView = {
    position: Cartesian3.clone(viewer.camera.positionWC),
    direction: Cartesian3.clone(viewer.camera.directionWC),
    up: Cartesian3.clone(viewer.camera.upWC)
  };
  setupPicking();
  setupLocationSearch();
  setupAlprControls();
  setupAlprPlaceSearch();
  syncAlprModuleVisibility();
  void loadAlprDataset().finally(() => syncAlprModuleVisibility());
  setupDatacenterControls();
  syncDatacenterModuleVisibility();
  void loadDatacenterDataset().finally(() => syncDatacenterModuleVisibility());
  earthCamController.setupUi();
  mirrorToggleState();
  layerHost = initExtraLayers(viewer);
  {
    const body = document.getElementById("more-layers-body");
    if (body) {
      body.prepend(
        createImageryPicker(viewer, hasIonToken, imagerySource, (used) => {
          imagerySource = used;
        })
      );
    }
  }
  const keysSheet = createKeysPanel(!!import.meta.env.VITE_CESIUM_ION_TOKEN?.trim());
  const appRoot = document.getElementById("app");
  appRoot?.append(keysSheet);
  if (appRoot) mountCredits(keysSheet, cesiumCreditSink, appRoot);
  if (!hasIonToken) showKeyHint("ion");
  setupMobileMenu();
  {
    // The × on the selection card (and Esc) clears whatever is selected and hides the card.
    /** Closing a card only stops tracking: it never moves the camera (owner, 2026-10-04: staying zoomed in matters). */
    const stopTracking = (): void => {
      trackerRef?.stop();
    };
    const closeInfoCard = (): void => {
      selectPlane(null);
      selectSatellite(null);
      selectVessel(null);
      selectAlprSite(null);
      selectDatacenterSite(null);
      selectGeocodePlace(null);
      earthCamController.selectCamera(null);
      satInfoEl?.classList.add("hidden");
      viewer.scene.requestRender();
      stopTracking();
    };
    document.getElementById("intel-card-close")?.addEventListener("click", closeInfoCard);
    // The whole-Earth button in the camera pad: ease back out to the opening view from anywhere (street level included).
    document.addEventListener("orbit:home", () => {
      if (flyMode.isActive() || !homeView) return;
      trackerRef?.stop();
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      viewer.camera.flyTo({
        destination: homeView.position,
        orientation: { direction: homeView.direction, up: homeView.up },
        duration: 2
      });
    });
    setLayerCardUserCloseListener(stopTracking);
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || flyMode.isActive()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (isLayerCardOpen()) {
        closeLayerCardByUser();
        return;
      }
      if (satInfoEl && !satInfoEl.classList.contains("hidden")) closeInfoCard();
    });
  }
  {
    // Click-to-track: a pill appears whenever a plane, ship or satellite is selected.
    const tracker = (trackerRef = createTracker(viewer, (): TrackTarget | null => {
      const posOf = (ds: CustomDataSource, id: string) => (): Cartesian3 | undefined =>
        ds.entities.getById(id)?.position?.getValue(JulianDate.now());
      if (selectedPlaneId) {
        const ac = trackedPlanes.get(selectedPlaneId);
        if (!ac) return null;
        return {
          kind: "plane",
          id: selectedPlaneId,
          label: sanitizeCallsign(ac.callsign) ?? ac.icao24.toUpperCase(),
          hex: ac.icao24.toLowerCase(),
          getPosition: posOf(planesDataSource, selectedPlaneId)
        };
      }
      if (selectedVesselId) {
        const row = vesselTrackByMmsi.get(Number(selectedVesselId.replace(/^vessel-/, "")))?.row;
        return {
          kind: "vessel",
          id: selectedVesselId,
          label: row?.name?.trim() || `MMSI ${selectedVesselId.replace(/^vessel-/, "")}`,
          getPosition: posOf(vesselsDataSource, selectedVesselId)
        };
      }
      if (selectedSatelliteId) {
        const sat = trackedEntities.get(selectedSatelliteId);
        return {
          kind: "satellite",
          id: selectedSatelliteId,
          label: sat?.name ?? "Satellite",
          getPosition: posOf(satellitesDataSource, selectedSatelliteId)
        };
      }
      return null;
    }));
    window.setInterval(() => tracker.sync(), 500);
  }
  {
    const logoEl = document.getElementById("orbit-logo");
    const headerEl = document.querySelector<HTMLElement>(".command-header");
    if (logoEl && headerEl) initAdaptiveLogo(viewer, logoEl, headerEl);
  }
  setupVisibilityToggle();
  setupPlanesToggle();
  syncAircraftFiltersModuleVisibility();
  setupVesselsToggle();
  setupPhotorealistic3dToggle();
  // Once everything else has started, fetch the 3D photo tileset's index in the background (hidden, nothing is drawn or
  // downloaded beyond that) so switching 3D Photo on later doesn't start from zero. Skipped on data-saver or slow links.
  {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const slow = !!conn && (conn.saveData === true || /(^|-)2g$|3g/.test(conn.effectiveType ?? ""));
    const warm = (): void => void ensurePhotorealisticTileset();
    if (!slow) window.setTimeout(warm, 5000);
  }
  setupPlaneCategoryFilterButtons();
  setupPlaneSearch();
  updateInfoCard(null);
  await hydrateSatCache();

  function onCameraMoveEnd(): void {
    updateVisibleSatellitesInView();
    if (planesVisible) void refreshPlanesFromApi();
    if (vesselsVisible) void refreshVesselSubscription();
    if (shouldLoadAlprViaViewport() && alprVisible && alprLayer.getOverlayVisible()) {
      scheduleAlprViewportRefresh();
    }
    if (datacentersVisible && datacenterLayer.getOverlayVisible()) {
      scheduleDatacenterViewportRefresh();
    }
    earthCamController.onCameraMoveEnd();
  }
  viewer.camera.moveEnd.addEventListener(onCameraMoveEnd);

  // While the globe is being turned, keep the satellite sample in step with what is facing the camera (otherwise
  // dots that were behind the Earth would only appear once the gesture ends). Throttled, and only when the view has
  // really changed.
  {
    let pending = 0;
    viewer.camera.percentageChanged = 0.08;
    viewer.camera.changed.addEventListener(() => {
      if (!satellitesVisible || pending) return;
      pending = window.setTimeout(() => {
        pending = 0;
        updateVisibleSatellitesInView();
      }, 350);
    });
  }

  // Not awaited: a slow or failing catalog download must never delay the timers and layers below.
  void prefetchSatelliteCaches().catch((error) => {
    console.error(error);
    setStatus(
      appendTrackingSuffix(
        "Prefetch failed partly or fully — tap Show Satellites to load from cache or retry."
      )
    );
  });

  setActiveSourceButton(currentSource);

  // Orbits move slowly on screen; a phone recomputes them half as often.
  window.setInterval(refreshSatellitePositions, isPhoneClass() ? 6000 : 3000);
  window.setInterval(() => {
    if (planesVisible && !document.hidden) void refreshPlanesFromApi();
  }, 2000);
  window.setInterval(advancePlanePositions, PLANE_ADVANCE_MS);
  window.setInterval(() => {
    if (selectedSatelliteId && trackedEntities.has(selectedSatelliteId)) {
      const selected = trackedEntities.get(selectedSatelliteId) ?? null;
      if (selected) drawSelectedTrail(selected);
    }
  }, 15000);

  setupPeriodicCacheRefresh();
  updateVisibleSatellitesInView();

  if (n2yoApiKey && statusEl) {
    statusEl.textContent = `${statusEl.textContent ?? ""} | N2YO available`;
  }
}

void bootstrap();
registerServiceWorker();


