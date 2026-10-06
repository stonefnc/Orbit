import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  DistanceDisplayCondition,
  HorizontalOrigin,
  NearFarScalar,
  PolygonHierarchy,
  VerticalOrigin,
  type Entity
} from "cesium";
import type { LayerHost } from "./layerHost";
import { showLayerCard, hideLayerCard } from "./layerCard";
import { horizonDepthTest } from "../horizon";
import { groundHeightReference } from "../groundAnchor";
import { eventNewsBlock } from "./eventNews";

/**
 * Event layers: earthquakes (USGS, last 24 h), wildfires (NASA EONET, or FIRMS hot-spots when a key is configured)
 * and active tropical cyclones with forecast track and cone (NOAA NHC).
 */
const ago = (ms: number): string => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

function flyTo(host: LayerHost, lon: number, lat: number, heightM: number): void {
  host.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, heightM), duration: 2 });
}

function idOf(entity: { id?: unknown }): string {
  return typeof entity.id === "string" ? entity.id : (entity as Entity).id ?? "";
}

// ---------- Earthquakes ----------

type Quake = {
  id: string;
  mag: number;
  place: string;
  time: number;
  depth: number;
  lon: number;
  lat: number;
  url: string;
  tsunami: boolean;
};

const QUAKE_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

function depthColor(km: number): Color {
  if (km < 20) return Color.fromCssColorString("#ff453a");
  if (km < 70) return Color.fromCssColorString("#ff9f0a");
  if (km < 300) return Color.fromCssColorString("#ffd60a");
  return Color.fromCssColorString("#64d2ff");
}

function registerEarthquakes(host: LayerHost): void {
  const ds = new CustomDataSource("quakes");
  ds.show = false;
  void host.viewer.dataSources.add(ds);
  const byId = new Map<string, Quake>();
  let timer: number | null = null;

  async function load(): Promise<void> {
    const res = await fetch(QUAKE_FEED);
    if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
    const j = (await res.json()) as {
      features: Array<{
        id: string;
        properties: { mag: number | null; place: string; time: number; url: string; tsunami?: number };
        geometry: { coordinates: [number, number, number] };
      }>;
    };
    byId.clear();
    ds.entities.suspendEvents();
    ds.entities.removeAll();
    const ground = groundHeightReference(j.features.length);
    for (const f of j.features) {
      const mag = f.properties.mag;
      if (mag == null) continue;
      const [lon, lat, depth] = f.geometry.coordinates;
      const q: Quake = {
        id: f.id,
        mag,
        place: f.properties.place,
        time: f.properties.time,
        depth,
        lon,
        lat,
        url: f.properties.url,
        tsunami: !!f.properties.tsunami
      };
      byId.set(`quake-${f.id}`, q);
      const size = Math.max(5, 3 + Math.max(0, mag) * 3.2);
      ds.entities.add({
        id: `quake-${f.id}`,
        position: Cartesian3.fromDegrees(lon, lat, 0),
        point: {
          pixelSize: size,
          color: depthColor(depth).withAlpha(0.78),
          outlineColor: Color.WHITE.withAlpha(0.9),
          outlineWidth: mag >= 5 ? 2 : 1,
          scaleByDistance: new NearFarScalar(2e5, 1.25, 2e7, 0.55),
          heightReference: ground,
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        },
        label:
          mag >= 5
            ? {
                heightReference: ground,
                text: `M${mag.toFixed(1)}`,
                font: '600 12px -apple-system, "SF Pro Text", Inter, sans-serif',
                fillColor: Color.WHITE,
                outlineColor: Color.BLACK,
                outlineWidth: 3,
                style: 2,
                pixelOffset: new Cartesian2(0, -size - 6),
                distanceDisplayCondition: new DistanceDisplayCondition(0, 1.2e7),
                disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
              }
            : undefined
      });
    }
    ds.entities.resumeEvents();
    const big = [...byId.values()].filter((q) => q.mag >= 4.5).length;
    host.setStatus("quakes", `${byId.size} in 24 h · ${big} ≥ M4.5 · small ones outside the US may be missing`);
    host.viewer.scene.requestRender();
  }

  host.register({
    id: "quakes",
    label: "Earthquakes",
    group: "Events",
    hint: "USGS earthquakes from the last 24 hours. Size = magnitude, colour = depth.",
    async enable() {
      ds.show = true;
      await load();
      timer = window.setInterval(() => void load().catch(() => {}), 5 * 60_000);
    },
    disable() {
      ds.show = false;
      if (timer != null) window.clearInterval(timer);
      timer = null;
      hideLayerCard();
    },
    onPick(entity) {
      const q = byId.get(idOf(entity));
      if (!q) return false;
      showLayerCard({
        kicker: "Earthquake",
        title: `M${q.mag.toFixed(1)} · ${q.place}`,
        rows: [
          ["When", `${ago(q.time)} (${new Date(q.time).toLocaleString()})`],
          ["Depth", `${q.depth.toFixed(1)} km`],
          ["Location", `${q.lat.toFixed(3)}°, ${q.lon.toFixed(3)}°`],
          ...(q.tsunami ? ([["Tsunami", "Alert flag set — see USGS"]] as Array<[string, string]>) : [])
        ],
        body: eventNewsBlock("quake", q.place),
        actions: [{ label: "Fly to", primary: true, run: () => flyTo(host, q.lon, q.lat, 400_000) }],
        links: [{ label: "USGS event page", href: q.url }]
      });
      return true;
    }
  });
}

// ---------- Wildfires ----------

type FireRow = {
  id: string;
  title: string;
  lat: number;
  lon: number;
  date: string | null;
  source?: string;
  link?: string;
  frp?: number;
  confidence?: string;
  acres?: number;
};

/** A US burned area from the server (NIFC), `box` = west, south, east, north in degrees (added on load). */
type Perimeter = {
  id: string;
  name: string;
  acres: number;
  contained: number | null;
  state: string;
  mapped: string | null;
  rings: number[][];
  box?: [number, number, number, number];
};
const PERIM_PREFIX = "fireperim-";

function ringsBox(rings: number[][]): [number, number, number, number] {
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      w = Math.min(w, r[i]!);
      e = Math.max(e, r[i]!);
      s = Math.min(s, r[i + 1]!);
      n = Math.max(n, r[i + 1]!);
    }
  }
  return [w, s, e, n];
}

let flameIcon: string | null = null;
function flameUri(): string {
  if (flameIcon) return flameIcon;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return "";
  const grad = g.createRadialGradient(32, 40, 4, 32, 36, 30);
  grad.addColorStop(0, "rgba(255,214,10,0.9)");
  grad.addColorStop(1, "rgba(255,69,58,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.beginPath();
  g.moveTo(32, 6);
  g.bezierCurveTo(44, 20, 52, 28, 50, 42);
  g.bezierCurveTo(48, 54, 40, 58, 32, 58);
  g.bezierCurveTo(24, 58, 14, 54, 14, 42);
  g.bezierCurveTo(14, 34, 20, 30, 24, 22);
  g.bezierCurveTo(26, 28, 28, 30, 30, 30);
  g.bezierCurveTo(28, 22, 28, 14, 32, 6);
  g.closePath();
  g.fillStyle = "#ff6a1a";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "#7a1f00";
  g.stroke();
  g.beginPath();
  g.moveTo(32, 30);
  g.bezierCurveTo(40, 38, 42, 44, 38, 50);
  g.bezierCurveTo(36, 53, 28, 53, 26, 49);
  g.bezierCurveTo(24, 44, 28, 38, 32, 30);
  g.fillStyle = "#ffd60a";
  g.fill();
  flameIcon = c.toDataURL("image/png");
  return flameIcon;
}

function registerFires(host: LayerHost): void {
  const ds = new CustomDataSource("fires");
  ds.show = false;
  void host.viewer.dataSources.add(ds);
  const byId = new Map<string, FireRow>();
  const perimById = new Map<string, Perimeter>();
  let timer: number | null = null;
  let moveHandler: (() => void) | null = null;
  let debounce: number | null = null;

  /** US burned areas (NIFC) as ground-hugging outlines in their own data source; silent when the feed is down. */
  const pds = new CustomDataSource("fire-perimeters");
  pds.show = false;
  void host.viewer.dataSources.add(pds);
  let perimeterCount = 0;

  async function loadPerimeters(): Promise<void> {
    const res = await fetch("/api/layers/fire-perimeters");
    if (!res.ok) throw new Error("Fire perimeters unavailable");
    const j = (await res.json()) as { perimeters: Perimeter[] };
    perimById.clear();
    pds.entities.suspendEvents();
    pds.entities.removeAll();
    const orange = Color.fromCssColorString("#ff6a1a");
    for (const p of j.perimeters) {
      const box = ringsBox(p.rings);
      perimById.set(`${PERIM_PREFIX}${p.id}`, { ...p, box });
      for (const [i, ring] of p.rings.entries()) {
        pds.entities.add({
          id: `${PERIM_PREFIX}${p.id}-a${i}`,
          polygon: { hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(ring)), material: orange.withAlpha(0.28) }
        });
        pds.entities.add({
          id: `${PERIM_PREFIX}${p.id}-l${i}`,
          polyline: { positions: Cartesian3.fromDegreesArray(ring), width: 2, material: orange.withAlpha(0.95), clampToGround: true }
        });
      }
    }
    pds.entities.resumeEvents();
    perimeterCount = j.perimeters.length;
    host.viewer.scene.requestRender();
  }
  async function load(): Promise<void> {
    const rect = host.viewer.camera.computeViewRectangle();
    const q = new URLSearchParams();
    if (rect) {
      const d = (r: number): number => (r * 180) / Math.PI;
      q.set("w", d(rect.west).toFixed(2));
      q.set("s", d(rect.south).toFixed(2));
      q.set("e", d(rect.east).toFixed(2));
      q.set("n", d(rect.north).toFixed(2));
    }
    const res = await fetch(`/api/layers/fires?${q.toString()}`);
    if (!res.ok) throw new Error("Fire data unavailable");
    const j = (await res.json()) as { source: "eonet" | "firms"; firmsAvailable?: boolean; fires: FireRow[] };
    byId.clear();
    ds.entities.suspendEvents();
    ds.entities.removeAll();
    const hotspot = j.source === "firms";
    const ground = groundHeightReference(j.fires.length);
    for (const f of j.fires) {
      byId.set(`fire-${f.id}`, f);
      // Fresher reports are stronger; an incident last reported weeks ago is drawn faded.
      const ageDays = f.date ? (Date.now() - Date.parse(f.date)) / 86_400_000 : 0;
      const fade = hotspot || ageDays <= 7 ? 1 : ageDays <= 14 ? 0.7 : 0.45;
      ds.entities.add({
        id: `fire-${f.id}`,
        position: Cartesian3.fromDegrees(f.lon, f.lat, 0),
        billboard: {
          image: flameUri(),
          color: Color.WHITE.withAlpha(fade),
          width: hotspot ? 16 : 24,
          height: hotspot ? 16 : 24,
          verticalOrigin: VerticalOrigin.BOTTOM,
          horizontalOrigin: HorizontalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(2e5, 1.1, 2.5e7, 0.5),
          heightReference: ground,
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        }
      });
    }
    ds.entities.resumeEvents();
    const outlines = perimeterCount ? ` · ${perimeterCount} US burned areas outlined` : "";
    host.setStatus(
      "fires",
      (hotspot ? `${j.fires.length} hot-spots in view (24 h)` : `${j.fires.length} reported in the last 30 days`) + outlines + " · outlines: US only"
    );
    host.viewer.scene.requestRender();
  }

  host.register({
    id: "fires",
    label: "Active fires",
    group: "Events",
    hint: "Active wildfires worldwide (NASA EONET), with US burned areas outlined (NIFC). Add a free NASA FIRMS key to see satellite hot-spots instead.",
    async enable() {
      ds.show = true;
      pds.show = true;
      // Perimeters first when they are quick; a failure only means no outlines.
      await loadPerimeters().catch(() => {});
      await load();
      timer = window.setInterval(() => {
        void loadPerimeters().catch(() => {});
        void load().catch(() => {});
      }, 10 * 60_000);
      // With a FIRMS key the server returns hot-spots for the box on screen, so refresh after the camera settles.
      moveHandler = () => {
        if (debounce != null) window.clearTimeout(debounce);
        debounce = window.setTimeout(() => void load().catch(() => {}), 1500);
      };
      host.viewer.camera.moveEnd.addEventListener(moveHandler);
    },
    disable() {
      ds.show = false;
      pds.show = false;
      if (timer != null) window.clearInterval(timer);
      timer = null;
      if (moveHandler) host.viewer.camera.moveEnd.removeEventListener(moveHandler);
      moveHandler = null;
      hideLayerCard();
    },
    onPick(entity) {
      const pm = new RegExp(`^${PERIM_PREFIX}(\\d+)-`).exec(idOf(entity));
      const perim = pm ? perimById.get(`${PERIM_PREFIX}${pm[1]}`) : undefined;
      if (perim) {
        const [w, s, e, n] = perim.box ?? ringsBox(perim.rings);
        const lon = (w + e) / 2;
        const lat = (s + n) / 2;
        const spanKm = Math.max((e - w) * Math.cos((lat * Math.PI) / 180), n - s) * 111;
        const rows: Array<[string, string]> = [
          ["Burned area", `${perim.acres.toLocaleString()} acres`],
          ...(perim.contained != null ? ([["Contained", `${perim.contained} %`]] as Array<[string, string]>) : []),
          ...(perim.state ? ([["State", perim.state]] as Array<[string, string]>) : []),
          ...(perim.mapped ? ([["Outline mapped", `${ago(Date.parse(perim.mapped))} (${new Date(perim.mapped).toLocaleString()})`]] as Array<[string, string]>) : []),
          ["Source", "NIFC / WFIGS (US, simplified)"]
        ];
        showLayerCard({
          kicker: "Wildfire · burned area",
          title: perim.name,
          rows,
          body: eventNewsBlock("fire", /fire|complex|incident/i.test(perim.name) ? perim.name : `${perim.name} Fire`),
          actions: [{ label: "Fly to", primary: true, run: () => flyTo(host, lon, lat, Math.max(15_000, spanKm * 2200)) }],
          links: [
            { label: "InciWeb", href: "https://inciweb.wildfire.gov/" },
            { label: "NIFC fire map", href: "https://data-nifc.opendata.arcgis.com/" }
          ]
        });
        return true;
      }
      const f = byId.get(idOf(entity));
      if (!f) return false;
      const rows: Array<[string, string]> = [];
      if (f.date) rows.push(["Last report", `${ago(Date.parse(f.date))} (${new Date(f.date).toLocaleString()})`]);
      if (f.acres) rows.push(["Size", `${Math.round(f.acres).toLocaleString()} acres`]);
      if (f.frp) rows.push(["Fire power", `${f.frp.toFixed(1)} MW`]);
      if (f.confidence) rows.push(["Confidence", f.confidence]);
      rows.push(["Location", `${f.lat.toFixed(3)}°, ${f.lon.toFixed(3)}°`]);
      if (f.source) rows.push(["Source", f.source]);
      const detection = f.frp != null || f.title === "Satellite fire detection";
      rows.push([
        "Extent",
        detection
          ? "One satellite detection (about 375 m), not the fire's outline"
          : "A reported point; US burned areas are outlined where NIFC publishes them"
      ]);
      showLayerCard({
        kicker: "Wildfire",
        title: f.title,
        rows,
        body: detection ? undefined : eventNewsBlock("fire", f.title),
        actions: [{ label: "Fly to", primary: true, run: () => flyTo(host, f.lon, f.lat, 60_000) }],
        links: f.link ? [{ label: "Details", href: f.link }] : []
      });
      return true;
    }
  });
}

// ---------- Tropical cyclones ----------

type Storm = {
  id: string;
  name: string;
  classification: string;
  windKt: number | null;
  pressureMb: number | null;
  lat: number;
  lon: number;
  movementDir: number | null;
  movementSpeedKt: number | null;
  advisoryTime: string | null;
  track: {
    past: Array<[number, number]>;
    forecast: Array<{ lon: number; lat: number; label?: string; windKt?: number }>;
    cone: Array<Array<[number, number]>>;
  };
};

const CLASS_NAME: Record<string, string> = {
  TD: "Tropical depression",
  TS: "Tropical storm",
  HU: "Hurricane",
  STS: "Subtropical storm",
  STD: "Subtropical depression",
  PTC: "Potential tropical cyclone",
  PC: "Post-tropical cyclone",
  EX: "Extratropical cyclone",
  TY: "Typhoon"
};

/** Saffir–Simpson colours. */
function stormColor(kt: number | null): string {
  if (kt == null || kt < 34) return "#64d2ff";
  if (kt < 64) return "#30d158";
  if (kt < 83) return "#ffd60a";
  if (kt < 96) return "#ff9f0a";
  if (kt < 113) return "#ff6a1a";
  if (kt < 137) return "#ff453a";
  return "#ff2d92";
}

const spiralIcons = new Map<string, string>();
function spiralUri(color: string): string {
  const hit = spiralIcons.get(color);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d");
  if (!g) return "";
  g.translate(48, 48);
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.beginPath();
  g.arc(0, 0, 40, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.lineCap = "round";
  for (let arm = 0; arm < 3; arm++) {
    g.beginPath();
    for (let t = 0; t <= 1; t += 0.04) {
      const a = arm * ((Math.PI * 2) / 3) + t * 3.6;
      const r = 6 + t * 30;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.beginPath();
  g.arc(0, 0, 5, 0, Math.PI * 2);
  g.fillStyle = "#fff";
  g.fill();
  const uri = c.toDataURL("image/png");
  spiralIcons.set(color, uri);
  return uri;
}

/** Makes longitudes continuous across the dateline (…179, 181 instead of …179, -179) so lines don't wrap the globe. */
function unwrapLon<T extends { lon: number }>(pts: T[]): T[] {
  let prev: number | null = null;
  let offset = 0;
  return pts.map((p) => {
    let lon = p.lon + offset;
    if (prev != null) {
      while (lon - prev > 180) {
        lon -= 360;
        offset -= 360;
      }
      while (lon - prev < -180) {
        lon += 360;
        offset += 360;
      }
    }
    prev = lon;
    return { ...p, lon };
  });
}

function unwrapPairs(pts: Array<[number, number]>): Array<[number, number]> {
  return unwrapLon(pts.map(([lon, lat]) => ({ lon, lat }))).map((p) => [p.lon, p.lat]);
}

function registerCyclones(host: LayerHost): void {
  const ds = new CustomDataSource("cyclones");
  ds.show = false;
  void host.viewer.dataSources.add(ds);
  const byId = new Map<string, Storm>();
  let timer: number | null = null;

  async function load(): Promise<void> {
    const res = await fetch("/api/layers/cyclones");
    if (!res.ok) throw new Error("Cyclone data unavailable");
    const j = (await res.json()) as { storms: Storm[] };
    byId.clear();
    ds.entities.suspendEvents();
    ds.entities.removeAll();
    for (const s0 of j.storms) {
      // Start from the storm's own longitude so the track, cone and marker agree about which side of the dateline.
      const s: Storm = {
        ...s0,
        track: {
          past: unwrapPairs(s0.track.past),
          forecast: unwrapLon(s0.track.forecast),
          cone: s0.track.cone.map(unwrapPairs)
        }
      };
      const color = stormColor(s.windKt);
      const css = Color.fromCssColorString(color);
      byId.set(`storm-${s.id}`, s);
      for (const [i, ring] of s.track.cone.entries()) {
        ds.entities.add({
          id: `storm-cone-${s.id}-${i}`,
          polygon: {
            hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(ring.flat())),
            material: css.withAlpha(0.16),
            outline: true,
            outlineColor: css.withAlpha(0.55),
            height: 0
          }
        });
      }
      if (s.track.past.length > 1) {
        ds.entities.add({
          id: `storm-past-${s.id}`,
          polyline: {
            positions: Cartesian3.fromDegreesArray(s.track.past.flat()),
            width: 3,
            material: Color.WHITE.withAlpha(0.8),
            clampToGround: true
          }
        });
      }
      if (s.track.forecast.length) {
        ds.entities.add({
          id: `storm-fc-${s.id}`,
          polyline: {
            positions: Cartesian3.fromDegreesArray([s.lon, s.lat, ...s.track.forecast.flatMap((p) => [p.lon, p.lat])]),
            width: 3,
            material: css,
            clampToGround: true
          }
        });
        for (const [i, p] of s.track.forecast.entries()) {
          ds.entities.add({
            id: `storm-pt-${s.id}-${i}`,
            position: Cartesian3.fromDegrees(p.lon, p.lat, 0),
            point: {
              pixelSize: 7,
              color: stormColor(p.windKt ?? null) === color ? css : Color.fromCssColorString(stormColor(p.windKt ?? null)),
              outlineColor: Color.WHITE,
              outlineWidth: 1,
              disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
            },
            label: p.label
              ? {
                  text: p.label,
                  font: '500 11px -apple-system, "SF Pro Text", Inter, sans-serif',
                  fillColor: Color.WHITE,
                  outlineColor: Color.BLACK,
                  outlineWidth: 3,
                  style: 2,
                  pixelOffset: new Cartesian2(0, -14),
                  distanceDisplayCondition: new DistanceDisplayCondition(0, 6e6),
                  disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
                }
              : undefined
          });
        }
      }
      ds.entities.add({
        id: `storm-${s.id}`,
        position: Cartesian3.fromDegrees(s.lon, s.lat, 0),
        billboard: {
          image: spiralUri(color),
          width: 54,
          height: 54,
          scaleByDistance: new NearFarScalar(1e6, 1.1, 3e7, 0.55),
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        },
        label: {
          text: s.name,
          font: '700 13px -apple-system, "SF Pro Text", Inter, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 4,
          style: 2,
          pixelOffset: new Cartesian2(0, 36),
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        }
      });
    }
    ds.entities.resumeEvents();
    host.setStatus(
      "cyclones",
      `${j.storms.length ? `${j.storms.length} active` : "None active right now"} · Atlantic and E & C Pacific only, not the western Pacific, Indian Ocean or southern hemisphere`
    );
    host.viewer.scene.requestRender();
  }

  host.register({
    id: "cyclones",
    label: "Cyclones",
    group: "Weather",
    hint: "Active hurricanes and tropical storms with NOAA forecast track and uncertainty cone (Atlantic and eastern/central Pacific only; the western Pacific, Indian Ocean and southern hemisphere are not covered).",
    async enable() {
      ds.show = true;
      await load();
      timer = window.setInterval(() => void load().catch(() => {}), 15 * 60_000);
    },
    disable() {
      ds.show = false;
      if (timer != null) window.clearInterval(timer);
      timer = null;
      hideLayerCard();
    },
    onPick(entity) {
      const s = byId.get(idOf(entity));
      if (!s) return false;
      const mph = s.windKt != null ? Math.round(s.windKt * 1.15078) : null;
      const rows: Array<[string, string]> = [
        ["Type", CLASS_NAME[s.classification] ?? s.classification],
        ["Winds", s.windKt != null ? `${s.windKt} kt (${mph} mph)` : "—"],
        ["Pressure", s.pressureMb != null ? `${s.pressureMb} mb` : "—"],
        [
          "Moving",
          s.movementSpeedKt != null && s.movementDir != null ? `${s.movementSpeedKt} kt toward ${s.movementDir}°` : "—"
        ],
        ["Position", `${s.lat.toFixed(1)}°, ${s.lon.toFixed(1)}°`]
      ];
      if (s.advisoryTime) rows.push(["Advisory", new Date(s.advisoryTime).toLocaleString()]);
      showLayerCard({
        kicker: "Tropical cyclone",
        title: s.name,
        subtitle: "NOAA National Hurricane Center",
        rows,
        actions: [{ label: "Fly to", primary: true, run: () => flyTo(host, s.lon, s.lat, 2_500_000) }],
        links: [{ label: "NHC", href: "https://www.nhc.noaa.gov/" }]
      });
      return true;
    }
  });
}

export function registerEventLayers(host: LayerHost): void {
  registerEarthquakes(host);
  registerFires(host);
  registerCyclones(host);
}
