import {
  Color,
  ImageryLayer,
  type ImageryProvider,
  Rectangle,
  UrlTemplateImageryProvider,
  WebMapServiceImageryProvider,
  WebMercatorTilingScheme
} from "cesium";
import type { LayerHost } from "./layerHost";

/**
 * Weather imagery draped on the globe, all keyless:
 *  - Rain radar: RainViewer's global radar mosaic, last two hours, with a playable timeline.
 *  - Clouds: infrared satellite imagery from NASA GIBS (GOES-East, GOES-West, Himawari), with the dark ground made
 *    transparent so only the clouds remain.
 *  - Lightning: NOAA nowCOAST lightning strike density (Americas and Pacific).
 */
const EXTRAS_ID = "layer-extras";

function extras(): HTMLElement | null {
  return document.getElementById(EXTRAS_ID);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------- Rain radar ----------

type RadarFrame = { time: number; path: string };

function registerRadar(host: LayerHost): void {
  const viewer = host.viewer;
  let frames: RadarFrame[] = [];
  let layers: ImageryLayer[] = [];
  let hostUrl = "https://tilecache.rainviewer.com";
  let index = 0;
  let playing = false;
  let timer: number | null = null;
  let refresh: number | null = null;
  let panel: HTMLElement | null = null;
  let slider: HTMLInputElement | null = null;
  let label: HTMLElement | null = null;
  let playBtn: HTMLButtonElement | null = null;

  function clearLayers(): void {
    for (const l of layers) viewer.imageryLayers.remove(l, true);
    layers = [];
  }

  function show(i: number): void {
    index = Math.max(0, Math.min(frames.length - 1, i));
    layers.forEach((l, k) => {
      const current = k === index;
      // The next frame stays "visible" at almost zero opacity so its tiles are already loaded when we step to it.
      const prefetch = playing && k === (index + 1) % frames.length;
      l.show = current || prefetch;
      l.alpha = current ? 0.72 : 0.001;
    });
    if (slider) slider.value = String(index);
    const f = frames[index];
    if (label && f) {
      const d = new Date(f.time * 1000);
      const mins = Math.round((Date.now() - d.getTime()) / 60_000);
      label.textContent = `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${
        mins <= 6 ? "latest" : `${mins} min ago`
      }`;
    }
    viewer.scene.requestRender();
  }

  function setPlaying(on: boolean): void {
    playing = on;
    if (playBtn) playBtn.textContent = on ? "Pause" : "Play";
    if (timer != null) window.clearInterval(timer);
    timer = null;
    if (on) {
      timer = window.setInterval(() => show(index + 1 >= frames.length ? 0 : index + 1), 700);
    }
    show(index);
  }

  async function load(): Promise<void> {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    if (!res.ok) throw new Error("Radar service unavailable");
    const j = (await res.json()) as { host?: string; radar?: { past?: RadarFrame[]; nowcast?: RadarFrame[] } };
    hostUrl = j.host ?? hostUrl;
    frames = [...(j.radar?.past ?? []), ...(j.radar?.nowcast ?? [])];
    if (!frames.length) throw new Error("No radar frames available");
    clearLayers();
    layers = frames.map((f) => {
      const provider = new UrlTemplateImageryProvider({
        url: `${hostUrl}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
        tilingScheme: new WebMercatorTilingScheme(),
        maximumLevel: 7,
        credit: "Radar: RainViewer"
      });
      const l = viewer.imageryLayers.addImageryProvider(provider);
      l.show = false;
      return l;
    });
    if (slider) {
      slider.max = String(frames.length - 1);
    }
    show(frames.length - 1);
  }

  function buildPanel(): void {
    const host2 = extras();
    if (!host2 || panel) return;
    panel = el("div", "layer-panel");
    panel.id = "radar-panel";
    panel.append(el("div", "layer-panel-title", "Rain radar"));
    slider = el("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "0";
    slider.value = "0";
    slider.setAttribute("aria-label", "Radar time");
    slider.addEventListener("input", () => {
      setPlaying(false);
      show(Number(slider!.value));
    });
    const row = el("div", "layer-panel-row");
    playBtn = el("button", "layer-card-btn primary", "Play");
    playBtn.type = "button";
    playBtn.addEventListener("click", () => setPlaying(!playing));
    const latest = el("button", "layer-card-btn", "Latest");
    latest.type = "button";
    latest.addEventListener("click", () => {
      setPlaying(false);
      show(frames.length - 1);
    });
    label = el("span", "layer-panel-note");
    row.append(playBtn, latest, label);
    panel.append(slider, row, el("p", "layer-panel-note", "Past 2 hours · RainViewer radar mosaic · land radar only, none over the oceans"));
    host2.append(panel);
  }

  host.register({
    id: "radar",
    label: "Rain radar",
    group: "Weather",
    hint: "Rain radar for the last two hours (RainViewer). Coverage follows ground radar networks: none over the oceans, thinner in parts of Africa, South America and Asia. Use the timeline to play it back.",
    async enable() {
      buildPanel();
      await load();
      refresh = window.setInterval(() => void load().catch(() => {}), 10 * 60_000);
      host.setStatus("radar", `${frames.length} frames · land radar only`);
    },
    disable() {
      setPlaying(false);
      if (refresh != null) window.clearInterval(refresh);
      refresh = null;
      clearLayers();
      panel?.remove();
      panel = slider = label = playBtn = null;
    }
  });
}

// ---------- Clouds ----------

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
/**
 * Each satellite draws only its own band of longitudes, close to its own view. Drawn out to the far limb every disc
 * smears into a grey haze and the discs overlap (GOES-East's limb used to cover the Atlantic and Africa). The bands
 * meet at -140, -105, -35, 40 and 100 degrees; west/east are degrees, and Himawari's band crosses the dateline.
 */
const CLOUD_SOURCES = [
  { layer: "GOES-East_ABI_Band13_Clean_Infrared", name: "GOES-East", west: -105, east: -35 },
  { layer: "GOES-West_ABI_Band13_Clean_Infrared", name: "GOES-West", west: -140, east: -105 },
  { layer: "Himawari_AHI_Band13_Clean_Infrared", name: "Himawari", west: 100, east: -140 }
];

/** EUMETSAT's keyless view service: Meteosat IR 10.8 um, the newest slot by default (free, attribution "EUMETSAT"). */
const EUMETVIEW = "https://view.eumetsat.int/geoserver/wms";
const METEOSAT_SOURCES = [
  { layer: "msg_fes:ir108", name: "Meteosat 0°", west: -35, east: 40 },
  { layer: "msg_iodc:ir108", name: "Meteosat Indian Ocean", west: 40, east: 100 }
];

function registerClouds(host: LayerHost): void {
  const viewer = host.viewer;
  let layers: ImageryLayer[] = [];
  let refresh: number | null = null;

  /** Adds one satellite's layer, limited to its own band of longitudes. */
  function addCloudLayer(provider: ImageryProvider, s: { west: number; east: number }): ImageryLayer {
    // `rectangle` limits where a layer draws; `cutoutRectangle` removes what is inside it, so a band that crosses the
    // dateline (west > east) is drawn everywhere except the band that lies between east and west.
    const wraps = s.west > s.east;
    const l = new ImageryLayer(provider, wraps ? {} : { rectangle: Rectangle.fromDegrees(s.west, -90, s.east, 90) });
    if (wraps) l.cutoutRectangle = Rectangle.fromDegrees(s.east, -90, s.west, 90);
    viewer.imageryLayers.add(l);
    // Infrared: clouds are cold (bright), land and sea are warm (dark). Make the dark part see-through.
    l.colorToAlpha = Color.BLACK;
    l.colorToAlphaThreshold = 0.42;
    l.alpha = 0.85;
    return l;
  }

  function build(): void {
    for (const l of layers) viewer.imageryLayers.remove(l, true);
    layers = CLOUD_SOURCES.map((s) => {
      const provider = new UrlTemplateImageryProvider({
        // The newest image NASA has; the query string changes every refresh so the browser re-fetches the tiles.
        url: `${GIBS}/${s.layer}/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png?r=${Math.floor(Date.now() / 600_000)}`,
        tilingScheme: new WebMercatorTilingScheme(),
        maximumLevel: 6,
        credit: `Clouds: NASA GIBS · ${s.name}`
      });
      return addCloudLayer(provider, s);
    });
    for (const s of METEOSAT_SOURCES) {
      // No TIME parameter: the service answers with its newest slot. `_r` makes the browser re-fetch after each refresh
      // (the service lets browsers keep a plain URL for a week). Geographic tiling: the layer is published in EPSG:4326.
      const provider = new WebMapServiceImageryProvider({
        url: EUMETVIEW,
        layers: s.layer,
        parameters: { transparent: true, format: "image/png", _r: Math.floor(Date.now() / 600_000) },
        maximumLevel: 5,
        credit: `Clouds: © EUMETSAT · ${s.name}`
      });
      layers.push(addCloudLayer(provider, s));
    }
    viewer.scene.requestRender();
  }

  host.register({
    id: "clouds",
    label: "Clouds",
    group: "Weather",
    hint: "Infrared cloud imagery from weather satellites (NASA GIBS: GOES-East, GOES-West, Himawari; EUMETSAT: Meteosat). Covers the Americas, Europe, Africa, Asia, Australia and the Pacific; the poles are not covered.",
    enable() {
      build();
      refresh = window.setInterval(build, 15 * 60_000);
      host.setStatus("clouds", "GOES · Meteosat · Himawari IR · not the poles");
    },
    disable() {
      if (refresh != null) window.clearInterval(refresh);
      refresh = null;
      for (const l of layers) viewer.imageryLayers.remove(l, true);
      layers = [];
    }
  });
}

// ---------- Lightning ----------

function registerLightning(host: LayerHost): void {
  const viewer = host.viewer;
  let layer: ImageryLayer | null = null;
  let refresh: number | null = null;

  function build(): void {
    if (layer) viewer.imageryLayers.remove(layer, true);
    const provider = new WebMapServiceImageryProvider({
      url: "https://nowcoast.noaa.gov/geoserver/lightning_detection/ows",
      layers: "ldn_lightning_strike_density",
      parameters: { transparent: true, format: "image/png", _r: Math.floor(Date.now() / 300_000) },
      tilingScheme: new WebMercatorTilingScheme(),
      maximumLevel: 8,
      credit: "Lightning: NOAA nowCOAST"
    });
    layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = 0.85;
    viewer.scene.requestRender();
  }

  host.register({
    id: "lightning",
    label: "Lightning",
    group: "Weather",
    hint: "Lightning strike density over the last few minutes (NOAA nowCOAST; Americas and Pacific).",
    enable() {
      build();
      refresh = window.setInterval(build, 5 * 60_000);
      host.setStatus("lightning", "NOAA · Americas & Pacific");
    },
    disable() {
      if (refresh != null) window.clearInterval(refresh);
      refresh = null;
      if (layer) viewer.imageryLayers.remove(layer, true);
      layer = null;
    }
  });
}

export function registerWeatherImagery(host: LayerHost): void {
  registerRadar(host);
  registerClouds(host);
  registerLightning(host);
}
