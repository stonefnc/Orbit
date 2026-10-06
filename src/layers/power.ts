import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  DistanceDisplayCondition,
  Math as CesiumMath,
  NearFarScalar
} from "cesium";
import type { LayerHost } from "./layerHost";
import { hideLayerCard, showLayerCard } from "./layerCard";
import { horizonDepthTest } from "../horizon";
import { groundHeightReference } from "../groundAnchor";

/**
 * Electric power: the world's larger power plants (WRI Global Power Plant Database, 100 MW and up) and, as you zoom in,
 * the high-voltage transmission lines and substations (OpenStreetMap, 200 kV and up).
 */

type PlantRow = [name: string, lat: number, lon: number, mw: number, fuel: string, country: string, owner: string, year: number, url: string];
type LineItem = ["l", number, number, string, string, number, number, number[]];
type SubItem = ["s", number, number, number, number, string, string];

const FUEL_COLOR: Record<string, string> = {
  Hydro: "#0a84ff",
  Gas: "#ff9f0a",
  Coal: "#8e8e93",
  Oil: "#a2845e",
  Nuclear: "#bf5af2",
  Solar: "#ffd60a",
  Wind: "#64d2ff",
  Biomass: "#30d158",
  Geothermal: "#ff6482",
  Waste: "#ac8e68",
  Storage: "#5e5ce6",
  Wave: "#40c8e0",
  "Wave and Tidal": "#40c8e0",
  Petcoke: "#6e6e73",
  Cogeneration: "#ff9f0a"
};
const fuelColor = (f: string): string => FUEL_COLOR[f] ?? "#aeaeb2";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Line colour by voltage class. */
function kvColor(kv: number, hvdc: boolean): string {
  if (hvdc) return "#64d2ff";
  if (kv >= 500) return "#ff453a";
  if (kv >= 345) return "#ff9f0a";
  return "#ffd60a";
}

// ---------- Power plants ----------

function registerPlants(host: LayerHost): void {
  const ds = new CustomDataSource("power-plants");
  ds.show = false;
  void host.viewer.dataSources.add(ds);
  const byId = new Map<string, PlantRow>();
  let loaded = false;

  async function load(): Promise<void> {
    const res = await fetch("/api/layers/power/plants");
    if (!res.ok) throw new Error("Power plant data unavailable");
    const { plants } = (await res.json()) as { plants: PlantRow[] };
    ds.entities.suspendEvents();
    const ground = groundHeightReference(plants.length);
    plants.forEach((p, i) => {
      const id = `plant-${i}`;
      byId.set(id, p);
      const mw = p[3];
      // Area grows with output: a 22,500 MW dam reads far bigger than a 100 MW solar farm.
      const size = Math.max(5, Math.min(20, 3.5 + Math.sqrt(mw) * 0.1));
      ds.entities.add({
        id,
        position: Cartesian3.fromDegrees(p[2], p[1], 0),
        point: {
          pixelSize: size,
          color: Color.fromCssColorString(fuelColor(p[4])).withAlpha(0.92),
          outlineColor: Color.WHITE.withAlpha(0.85),
          outlineWidth: 1,
          scaleByDistance: new NearFarScalar(2e5, 1.25, 2.5e7, 0.65),
          heightReference: ground,
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        },
        label: {
          heightReference: ground,
          text: p[0],
          font: '500 11px -apple-system, "SF Pro Text", Inter, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: 2,
          pixelOffset: new Cartesian2(0, -size - 6),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 4e5),
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        }
      });
    });
    ds.entities.resumeEvents();
    loaded = true;
    host.setStatus("power-plants", `${plants.length.toLocaleString()} plants · 100 MW+`);
  }

  host.register({
    id: "power-plants",
    label: "Power plants",
    group: "Infrastructure",
    hint: "The world's larger power plants (100 MW and up) coloured by fuel and sized by output — WRI Global Power Plant Database (CC BY 4.0).",
    async enable() {
      ds.show = true;
      if (!loaded) await load();
    },
    disable() {
      ds.show = false;
      hideLayerCard();
    },
    onPick(entity) {
      const id = typeof entity.id === "string" ? entity.id : "";
      const p = byId.get(id);
      if (!p) return false;
      const [name, lat, lon, mw, fuel, country, owner, year, url] = p;
      const rows: Array<[string, string]> = [
        ["Fuel", fuel],
        ["Capacity", `${mw.toLocaleString()} MW`]
      ];
      if (country) rows.push(["Country", country]);
      if (owner) rows.push(["Owner", owner]);
      if (year) rows.push(["Commissioned", String(year)]);
      rows.push(["Location", `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`]);
      showLayerCard({
        kicker: `${fuel} power plant`,
        title: name,
        rows,
        actions: [
          {
            label: "Fly to",
            primary: true,
            run: () => host.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, 9000), duration: 2 })
          }
        ],
        links: url ? [{ label: "Source", href: url }] : []
      });
      return true;
    }
  });
}

// ---------- Transmission lines and substations ----------

const MAX_VIEW_DEG = 6; // wider than this would pull in dozens of tiles at once

function registerGrid(host: LayerHost): void {
  const viewer = host.viewer;
  const ds = new CustomDataSource("power-grid");
  ds.show = false;
  void viewer.dataSources.add(ds);
  const lines = new Map<string, LineItem>();
  const subs = new Map<string, SubItem>();
  let on = false;
  let timer = 0;
  let poll = 0;
  let seq = 0;
  let lastKey = "";

  function clear(): void {
    ds.entities.removeAll();
    lines.clear();
    subs.clear();
    lastKey = "";
    viewer.scene.requestRender();
  }

  function viewBox(): { w: number; s: number; e: number; n: number } | null {
    const r = viewer.camera.computeViewRectangle();
    if (!r) return null;
    const w = CesiumMath.toDegrees(r.west);
    const e = CesiumMath.toDegrees(r.east);
    return { w, s: CesiumMath.toDegrees(r.south), e, n: CesiumMath.toDegrees(r.north) };
  }

  async function refresh(): Promise<void> {
    window.clearTimeout(poll);
    if (!on) return;
    const box = viewBox();
    const width = box ? (box.e >= box.w ? box.e - box.w : 360 - (box.w - box.e)) : 360;
    if (!box || width > MAX_VIEW_DEG || box.n - box.s > MAX_VIEW_DEG) {
      host.setStatus("power-grid", "Zoom in to see lines");
      clear();
      return;
    }
    const mine = ++seq;
    const q = `w=${box.w.toFixed(3)}&s=${box.s.toFixed(3)}&e=${box.e.toFixed(3)}&n=${box.n.toFixed(3)}`;
    try {
      const res = await fetch(`/api/layers/power/grid?${q}`, { cache: "no-store" });
      if (mine !== seq || !on) return;
      if (res.status === 413) {
        host.setStatus("power-grid", "Zoom in to see lines");
        clear();
        return;
      }
      if (!res.ok) throw new Error("Power grid unavailable");
      const j = (await res.json()) as { lines: LineItem[]; substations: SubItem[]; tilesPending: number; tilesTotal: number };
      const key = `${j.lines.length}|${j.substations.length}|${j.lines[0]?.[1] ?? 0}`;
      if (key !== lastKey) {
        lastKey = key;
        render(j.lines, j.substations);
      }
      host.setStatus(
        "power-grid",
        j.tilesPending
          ? `Loading… ${j.tilesTotal - j.tilesPending}/${j.tilesTotal} areas`
          : `${j.lines.length.toLocaleString()} lines · ${j.substations.length.toLocaleString()} substations`
      );
      // Areas not seen before are fetched from OpenStreetMap in the background; ask again shortly.
      if (j.tilesPending) poll = window.setTimeout(() => void refresh(), 5000);
    } catch {
      if (mine === seq) host.setStatus("power-grid", "Couldn't load the grid");
    }
  }

  function render(ls: LineItem[], ss: SubItem[]): void {
    ds.entities.suspendEvents();
    ds.entities.removeAll();
    lines.clear();
    subs.clear();
    for (const l of ls) {
      const id = `pline-${l[1]}`;
      lines.set(id, l);
      const pts = l[7];
      if (pts.length < 4) continue;
      ds.entities.add({
        id,
        polyline: {
          positions: Cartesian3.fromDegreesArray(pts),
          width: l[2] >= 500 ? 2.4 : 1.7,
          material: Color.fromCssColorString(kvColor(l[2], l[6] === 1)).withAlpha(0.9),
          arcType: 0
        }
      });
    }
    const subGround = groundHeightReference(ss.length);
    for (const s of ss) {
      const id = `psub-${s[1]}`;
      subs.set(id, s);
      ds.entities.add({
        id,
        position: Cartesian3.fromDegrees(s[3], s[2], 0),
        point: {
          pixelSize: s[4] >= 345 ? 7 : 5.5,
          color: Color.fromCssColorString(kvColor(s[4], false)),
          outlineColor: Color.WHITE,
          outlineWidth: 1.2,
          heightReference: subGround,
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        },
        label: s[5]
          ? {
              heightReference: subGround,
              text: s[5],
              font: '500 10px -apple-system, "SF Pro Text", Inter, sans-serif',
              fillColor: Color.WHITE,
              outlineColor: Color.BLACK,
              outlineWidth: 3,
              style: 2,
              pixelOffset: new Cartesian2(0, -12),
              distanceDisplayCondition: new DistanceDisplayCondition(0, 1.2e5),
              disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
            }
          : undefined
      });
    }
    ds.entities.resumeEvents();
    viewer.scene.requestRender();
  }

  const onMoveEnd = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 500);
  };

  const legend = (): HTMLElement => {
    const p = el("div", "layer-panel");
    p.id = "power-legend";
    p.append(el("div", "layer-panel-title", "Power grid"));
    const row = el("div", "conf-legend");
    for (const [label, color] of [
      ["500 kV +", "#ff453a"],
      ["345 – 499 kV", "#ff9f0a"],
      ["200 – 344 kV", "#ffd60a"],
      ["HVDC", "#64d2ff"]
    ] as const) {
      const item = el("span", "conf-legend-item");
      const dot = el("i");
      dot.style.background = color;
      item.append(dot, document.createTextNode(label));
      row.append(item);
    }
    p.append(row, el("p", "layer-panel-note", "Lines and substations of 200 kV and up from OpenStreetMap. Zoom in to a region (about 6° across) to load them; new areas take a few seconds."));
    return p;
  };
  let panel: HTMLElement | null = null;

  host.register({
    id: "power-grid",
    label: "Power grid",
    group: "Infrastructure",
    hint: "High-voltage transmission lines and substations (200 kV and up) from OpenStreetMap. Zoom in to a region to load them.",
    enable() {
      on = true;
      ds.show = true;
      viewer.camera.moveEnd.addEventListener(onMoveEnd);
      const extras = document.getElementById("layer-extras");
      if (extras && !panel) {
        panel = legend();
        extras.append(panel);
      }
      void refresh();
    },
    disable() {
      on = false;
      window.clearTimeout(timer);
      window.clearTimeout(poll);
      viewer.camera.moveEnd.removeEventListener(onMoveEnd);
      ds.show = false;
      clear();
      panel?.remove();
      panel = null;
      hideLayerCard();
    },
    onPick(entity) {
      const id = typeof entity.id === "string" ? entity.id : "";
      const l = lines.get(id);
      if (l) {
        const [, , kv, name, op, circuits, hvdc] = l;
        const rows: Array<[string, string]> = [["Voltage", `${kv} kV${hvdc ? " · DC" : ""}`]];
        if (op) rows.push(["Operator", op]);
        if (circuits) rows.push(["Circuits", String(circuits)]);
        showLayerCard({
          kicker: hvdc ? "HVDC transmission line" : "Transmission line",
          title: name || `${kv} kV line`,
          rows,
          links: [{ label: "OpenStreetMap", href: `https://www.openstreetmap.org/way/${l[1]}` }]
        });
        return true;
      }
      const s = subs.get(id);
      if (s) {
        const rows: Array<[string, string]> = [["Voltage", `${s[4]} kV`]];
        if (s[6]) rows.push(["Operator", s[6]]);
        rows.push(["Location", `${s[2].toFixed(3)}°, ${s[3].toFixed(3)}°`]);
        showLayerCard({
          kicker: "Substation",
          title: s[5] || `${s[4]} kV substation`,
          rows,
          links: [{ label: "OpenStreetMap", href: `https://www.openstreetmap.org/${s[1] > 0 ? "node" : "way"}/${Math.abs(s[1])}` }]
        });
        return true;
      }
      return false;
    }
  });
}

export function registerPower(host: LayerHost): void {
  registerPlants(host);
  registerGrid(host);
}

