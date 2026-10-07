import {
  BoundingSphere,
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  JulianDate,
  Math as CesiumMath,
  NearFarScalar,
  VerticalOrigin
} from "cesium";
import type { LayerHost } from "./layerHost";
import { hideLayerCard, showLayerCard } from "./layerCard";
import { enableBubbleClusters } from "./bubbles";
import { horizonDepthTest } from "../horizon";
import { groundHeightReference } from "../groundAnchor";
import {
  ABANDONED_COVERAGE,
  DEFAULT_MIN_LEVEL,
  LEVEL_COLOR,
  LEVEL_LABEL,
  LEVEL_PIN_SCALE,
  LIKELIHOOD_NOTE,
  MIN_LEVEL_CHOICES,
  osmUrl,
  placeKicker,
  placeRows,
  placeTitle,
  statusText,
  trespassersUrl,
  type AbandonedKind,
  type AbandonedPlace,
  type Likelihood
} from "./abandonedText";

/**
 * Abandoned places: spots OpenStreetMap tags suggest are abandoned, each with a rule-based likelihood (very likely,
 * likely, maybe) worked out on the server from the tags alone. Drawn as clustered pins planted on the ground, coloured
 * and sized by likelihood, for the view only (about 3 degrees across at most) through the server's tile cache. The card
 * lists the exact tags behind the level, links to the OpenStreetMap object and, as a plain outbound link, to
 * TrespassersHQ's map; nothing is fetched from that site and no access or entry details are shown anywhere.
 */
const MAX_VIEW_DEG = 3;
const LIMIT = 2500;

const pinIcons = new Map<string, string>();

/** Mine shafts and adits get a round badge with a dark opening, so they read differently from the house-shaped pins. */
function minePinUri(level: Likelihood): string {
  const key = `mine-${level}`;
  const hit = pinIcons.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 40;
  const g = c.getContext("2d");
  if (!g) return "";
  g.beginPath();
  g.arc(20, 20, 17, 0, Math.PI * 2);
  g.fillStyle = LEVEL_COLOR[level];
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.stroke();
  g.beginPath();
  g.ellipse(20, 20, 9, 7, 0, 0, Math.PI * 2);
  g.fillStyle = "rgba(14,14,18,0.92)";
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.stroke();
  const uri = c.toDataURL("image/png");
  pinIcons.set(key, uri);
  return uri;
}

function pinUri(level: Likelihood, kind: AbandonedKind): string {
  if (kind === "mine") return minePinUri(level);
  const key = `house-${level}`;
  const hit = pinIcons.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 40;
  c.height = 52;
  const g = c.getContext("2d");
  if (!g) return "";
  g.beginPath();
  g.moveTo(20, 50);
  g.bezierCurveTo(6, 32, 4, 24, 4, 18);
  g.arc(20, 18, 16, Math.PI, 0);
  g.bezierCurveTo(36, 24, 34, 32, 20, 50);
  g.closePath();
  g.fillStyle = LEVEL_COLOR[level];
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.stroke();
  // A broken-roof house outline, so the pin reads as "building" at a glance whatever its colour.
  g.strokeStyle = "rgba(20,20,24,0.85)";
  g.lineWidth = 2.4;
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(12, 22);
  g.lineTo(12, 15);
  g.lineTo(17, 10);
  g.lineTo(20, 14);
  g.lineTo(23, 9);
  g.lineTo(28, 15);
  g.lineTo(28, 22);
  g.closePath();
  g.stroke();
  const uri = c.toDataURL("image/png");
  pinIcons.set(key, uri);
  return uri;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function registerAbandoned(host: LayerHost): void {
  const viewer = host.viewer;
  const ds = new CustomDataSource("abandoned");
  ds.show = false;
  void viewer.dataSources.add(ds);
  enableBubbleClusters(ds, viewer.camera, "abandoned-cluster", "#c58b4f");
  const byId = new Map<string, AbandonedPlace>();
  let on = false;
  let timer = 0;
  let poll = 0;
  let seq = 0;
  let lastKey = "";
  let panel: HTMLElement | null = null;
  /** The lowest level shown: "likely and up" unless the person asks for more or fewer. Kept for this visit only. */
  let minLevel: Likelihood = DEFAULT_MIN_LEVEL;

  function clear(): void {
    ds.entities.removeAll();
    byId.clear();
    lastKey = "";
    viewer.scene.requestRender();
  }

  function viewBox(): { w: number; s: number; e: number; n: number } | null {
    const r = viewer.camera.computeViewRectangle();
    if (!r) return null;
    return {
      w: CesiumMath.toDegrees(r.west),
      s: CesiumMath.toDegrees(r.south),
      e: CesiumMath.toDegrees(r.east),
      n: CesiumMath.toDegrees(r.north)
    };
  }

  function render(places: AbandonedPlace[]): void {
    ds.entities.suspendEvents();
    ds.entities.removeAll();
    byId.clear();
    const ground = groundHeightReference(places.length);
    for (const p of places) {
      const id = `aband-${p[0]}`;
      byId.set(id, p);
      const scale = LEVEL_PIN_SCALE[p[7]];
      const isMine = p[3] === "mine";
      ds.entities.add({
        id,
        position: Cartesian3.fromDegrees(p[2], p[1], 0),
        billboard: {
          image: pinUri(p[7], p[3]),
          // The round mine badge is centred on its point (the opening is the place); the house pins stand on theirs.
          width: Math.round((isMine ? 22 : 24) * scale),
          height: Math.round((isMine ? 22 : 31) * scale),
          color: Color.WHITE,
          verticalOrigin: isMine ? VerticalOrigin.CENTER : VerticalOrigin.BOTTOM,
          scaleByDistance: new NearFarScalar(2e4, 1.15, 3e6, 0.6),
          heightReference: ground,
          disableDepthTestDistance: horizonDepthTest(viewer.camera)
        }
      });
    }
    ds.entities.resumeEvents();
    viewer.scene.requestRender();
  }

  async function refresh(): Promise<void> {
    window.clearTimeout(poll);
    if (!on) return;
    const box = viewBox();
    const width = box ? (box.e >= box.w ? box.e - box.w : 360 - (box.w - box.e)) : 360;
    if (!box || width > MAX_VIEW_DEG || box.n - box.s > MAX_VIEW_DEG) {
      host.setStatus("abandoned", "Zoom in to see places");
      clear();
      return;
    }
    const mine = ++seq;
    const q = `w=${box.w.toFixed(3)}&s=${box.s.toFixed(3)}&e=${box.e.toFixed(3)}&n=${box.n.toFixed(3)}&limit=${LIMIT}&min=${minLevel}`;
    try {
      const res = await fetch(`/api/layers/abandoned?${q}`, { cache: "no-store" });
      if (mine !== seq || !on) return;
      if (res.status === 413) {
        host.setStatus("abandoned", "Zoom in to see places");
        clear();
        return;
      }
      if (!res.ok) throw new Error("Abandoned places unavailable");
      const j = (await res.json()) as {
        places: AbandonedPlace[];
        counts: number[];
        tilesPending: number;
        tilesTotal: number;
        truncated: boolean;
      };
      const key = `${minLevel}|${j.places.length}|${j.places[0]?.[0] ?? ""}|${j.places[j.places.length - 1]?.[0] ?? ""}`;
      if (key !== lastKey) {
        lastKey = key;
        render(j.places);
      }
      host.setStatus(
        "abandoned",
        j.tilesPending
          ? `Loading… ${j.tilesTotal - j.tilesPending}/${j.tilesTotal} areas`
          : statusText(j.places.length, j.counts ?? [], minLevel, j.truncated)
      );
      // Areas not seen before are fetched from OpenStreetMap in the background; ask again shortly.
      if (j.tilesPending) poll = window.setTimeout(() => void refresh(), 5000);
    } catch {
      if (mine === seq) host.setStatus("abandoned", "Couldn't load places");
    }
  }

  const onMoveEnd = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 600);
  };

  function buildPanel(): HTMLElement {
    const p = el("div", "layer-panel");
    p.id = "abandoned-panel";
    p.append(el("div", "layer-panel-title", "Abandoned places"));

    const show = el("div", "layer-panel-row");
    show.append(el("span", "layer-panel-note", "Show"));
    const sel = el("select", "hist-select");
    sel.id = "abandoned-min-level";
    sel.setAttribute("aria-label", "Lowest likelihood to show");
    for (const c of MIN_LEVEL_CHOICES) {
      const o = el("option", undefined, c.label);
      o.value = String(c.value);
      o.selected = c.value === minLevel;
      sel.append(o);
    }
    sel.addEventListener("change", () => {
      minLevel = Number(sel.value) as Likelihood;
      lastKey = "";
      void refresh();
    });
    show.append(sel);
    p.append(show);

    const legend = el("div", "conf-legend");
    for (const level of [3, 2, 1] as const) {
      const item = el("span", "conf-legend-item");
      const dot = el("i");
      dot.style.background = LEVEL_COLOR[level];
      item.append(dot, document.createTextNode(LEVEL_LABEL[level]));
      legend.append(item);
    }
    p.append(legend, el("p", "layer-panel-note", "Round pin with a dark centre: a mine shaft or adit, an open hole that can be deep and unstable."));
    p.append(el("p", "layer-panel-note", LIKELIHOOD_NOTE), el("p", "layer-panel-note", ABANDONED_COVERAGE));
    p.append(
      el(
        "p",
        "layer-panel-note",
        "Zoom in to a region (about 3° across) to load places. A new area can take a minute or two the first time; it is saved for two weeks after that."
      )
    );
    return p;
  }

  function showPlace(p: AbandonedPlace): void {
    const [osm, lat, lon] = p;
    const links = [{ label: "Look on TrespassersHQ", href: trespassersUrl(lat, lon) }];
    const osmLink = osmUrl(osm);
    if (osmLink) links.unshift({ label: "Open in OpenStreetMap", href: osmLink });
    showLayerCard({
      kicker: placeKicker(p),
      title: placeTitle(p),
      rows: placeRows(p),
      actions: [
        {
          label: "Fly to",
          primary: true,
          run: () => viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, 1500), duration: 2 })
        }
      ],
      links
    });
  }

  host.register({
    id: "abandoned",
    label: "Abandoned places",
    group: "Infrastructure",
    hint: `${ABANDONED_COVERAGE} ${LIKELIHOOD_NOTE}`,
    enable() {
      on = true;
      ds.show = true;
      viewer.camera.moveEnd.addEventListener(onMoveEnd);
      const extras = document.getElementById("layer-extras");
      if (extras && !panel) {
        panel = buildPanel();
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
      if (id === "abandoned-cluster") {
        const clustered = (entity as Entity & { cluster?: { clusteredEntities: Entity[] } }).cluster?.clusteredEntities ?? [];
        const pts: Cartesian3[] = [];
        for (const e of clustered) {
          const pos = e.position?.getValue(JulianDate.now());
          if (pos) pts.push(pos);
        }
        if (pts.length) {
          const bs = BoundingSphere.fromPoints(pts);
          bs.radius = Math.max(bs.radius * 1.6, 1500);
          viewer.camera.flyToBoundingSphere(bs, { duration: 1.1 });
        }
        return true;
      }
      const p = byId.get(id);
      if (!p) return false;
      showPlace(p);
      return true;
    }
  });
}
