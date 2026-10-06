import {
  BoundingSphere,
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  HorizontalOrigin,
  JulianDate,
  NearFarScalar,
  VerticalOrigin
} from "cesium";
import type { LayerHost } from "./layerHost";
import { hideLayerCard, showLayerCard } from "./layerCard";
import { horizonDepthTest, horizonDistance } from "../horizon";
import { groundHeightReference } from "../groundAnchor";

/**
 * Radio on the globe: thousands of geolocated stations from the Radio Browser directory. Click one to hear it; the
 * "now playing" panel keeps it going while you fly around, and Shuffle drops you on a random broadcaster.
 */
type Station = [
  id: string,
  name: string,
  lat: number,
  lon: number,
  country: string,
  tags: string,
  codec: string,
  bitrate: number,
  homepage: string,
  streamUrl: string
];

let dotIcon: string | null = null;
function radioUri(): string {
  if (dotIcon) return dotIcon;
  const c = document.createElement("canvas");
  c.width = c.height = 40;
  const g = c.getContext("2d");
  if (!g) return "";
  const grad = g.createRadialGradient(20, 20, 2, 20, 20, 18);
  grad.addColorStop(0, "rgba(255,69,58,0.9)");
  grad.addColorStop(1, "rgba(255,69,58,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 40, 40);
  g.beginPath();
  g.arc(20, 20, 6, 0, Math.PI * 2);
  g.fillStyle = "#ff453a";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "#fff";
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.8)";
  g.lineWidth = 1.6;
  for (const r of [10, 14]) {
    g.beginPath();
    g.arc(20, 20, r, -0.9, 0.9);
    g.stroke();
  }
  dotIcon = c.toDataURL("image/png");
  return dotIcon;
}

const clusterIcons = new Map<string, string>();
function clusterUri(n: number): string {
  const label = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const hit = clusterIcons.get(label);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 80;
  const g = c.getContext("2d");
  if (!g) return radioUri();
  g.beginPath();
  g.arc(40, 40, 36, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,69,58,0.28)";
  g.fill();
  g.beginPath();
  g.arc(40, 40, 28, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,69,58,0.95)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.stroke();
  g.fillStyle = "#fff";
  g.font = '700 25px -apple-system, "SF Pro Text", Inter, sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 40, 42);
  const uri = c.toDataURL("image/png");
  clusterIcons.set(label, uri);
  return uri;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function registerRadio(host: LayerHost): void {
  const ds = new CustomDataSource("radio");
  ds.show = false;
  void host.viewer.dataSources.add(ds);
  const byId = new Map<string, Station>();
  let loaded = false;
  let audio: HTMLAudioElement | null = null;
  let current: Station | null = null;
  let panel: HTMLElement | null = null;
  let nowLine: HTMLElement | null = null;
  let stateLine: HTMLElement | null = null;

  const cl = ds.clustering;
  cl.enabled = true;
  cl.pixelRange = 34;
  cl.minimumClusterSize = 4;
  cl.clusterBillboards = true;
  cl.clusterLabels = false;
  cl.clusterPoints = false;
  cl.clusterEvent.addEventListener((clustered, cluster) => {
    cluster.label.show = false;
    cluster.billboard.show = true;
    cluster.billboard.image = clusterUri(clustered.length);
    cluster.billboard.width = 38;
    cluster.billboard.height = 38;
    cluster.billboard.verticalOrigin = VerticalOrigin.CENTER;
    cluster.billboard.horizontalOrigin = HorizontalOrigin.CENTER;
    cluster.billboard.disableDepthTestDistance = horizonDistance(host.viewer.camera.positionWC);
    const marker = new Entity({ id: "radio-cluster" });
    (marker as Entity & { cluster?: unknown }).cluster = { clusteredEntities: clustered };
    cluster.billboard.id = marker;
  });

  function ensureAudio(): HTMLAudioElement {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("playing", () => setState("Playing"));
    audio.addEventListener("waiting", () => setState("Buffering…"));
    audio.addEventListener("error", () => setState("This stream isn't responding — try another station"));
    return audio;
  }

  function setState(text: string): void {
    if (stateLine) stateLine.textContent = text;
  }

  function stop(): void {
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    current = null;
    if (nowLine) nowLine.textContent = "Nothing playing — click a station on the globe";
    setState("");
  }

  function play(s: Station): void {
    const [, name, , , country, , , , , url] = s;
    if (location.protocol === "https:" && url.startsWith("http:")) {
      setState("This station only streams over plain http, which the browser blocks on a secure page");
      return;
    }
    const a = ensureAudio();
    current = s;
    a.src = url;
    setState("Connecting…");
    if (nowLine) nowLine.textContent = `${name}${country ? ` · ${country}` : ""}`;
    void a.play().catch(() => setState("Press play again — the browser asked for a click first"));
  }

  function buildPanel(): void {
    const extras = document.getElementById("layer-extras");
    if (!extras || panel) return;
    panel = el("div", "layer-panel");
    panel.id = "radio-panel";
    panel.append(el("div", "layer-panel-title", "Radio"));
    nowLine = el("div", "radio-now", "Nothing playing — click a station on the globe");
    stateLine = el("p", "layer-panel-note");
    const row = el("div", "layer-panel-row");
    const stopBtn = el("button", "layer-card-btn", "Stop");
    stopBtn.type = "button";
    stopBtn.addEventListener("click", stop);
    const shuffle = el("button", "layer-card-btn primary", "Shuffle");
    shuffle.type = "button";
    shuffle.title = "Fly to a random station and play it";
    shuffle.addEventListener("click", () => {
      const all = [...byId.values()];
      if (!all.length) return;
      const s = all[Math.floor(Math.random() * all.length)]!;
      host.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(s[3], s[2], 900_000), duration: 2.2 });
      play(s);
      showStation(s);
    });
    const vol = el("input");
    vol.type = "range";
    vol.min = "0";
    vol.max = "1";
    vol.step = "0.05";
    vol.value = "0.8";
    vol.setAttribute("aria-label", "Volume");
    vol.addEventListener("input", () => {
      ensureAudio().volume = Number(vol.value);
    });
    row.append(shuffle, stopBtn);
    panel.append(nowLine, stateLine, row, vol, el("p", "layer-panel-note", "Stations: Radio Browser community directory"));
    extras.append(panel);
    ensureAudio().volume = 0.8;
  }

  function showStation(s: Station): void {
    const [, name, lat, lon, country, tags, codec, bitrate, homepage] = s;
    const rows: Array<[string, string]> = [];
    if (country) rows.push(["Country", country]);
    if (tags) rows.push(["Style", tags]);
    if (codec) rows.push(["Stream", `${codec}${bitrate ? ` · ${bitrate} kbps` : ""}`]);
    showLayerCard({
      kicker: "Radio station",
      title: name,
      rows,
      actions: [
        { label: current === s ? "Playing…" : "Play", primary: true, run: () => play(s) },
        { label: "Stop", run: stop },
        {
          label: "Fly to",
          run: () => host.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, 40_000), duration: 2 })
        }
      ],
      links: homepage ? [{ label: "Station site", href: homepage }] : []
    });
  }

  async function load(): Promise<void> {
    const res = await fetch("/api/layers/radio");
    if (!res.ok) throw new Error("Radio directory unavailable");
    const j = (await res.json()) as { stations: Station[] };
    ds.entities.suspendEvents();
    const ground = groundHeightReference(j.stations.length);
    for (const s of j.stations) {
      byId.set(`radio-${s[0]}`, s);
      ds.entities.add({
        id: `radio-${s[0]}`,
        position: Cartesian3.fromDegrees(s[3], s[2], 0),
        billboard: {
          image: radioUri(),
          width: 22,
          height: 22,
          color: Color.WHITE,
          scaleByDistance: new NearFarScalar(1e5, 1.2, 2e7, 0.55),
          heightReference: ground,
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        }
      });
    }
    ds.entities.resumeEvents();
    loaded = true;
    host.setStatus("radio", `${j.stations.length.toLocaleString()} stations · most-listened only`);
  }

  host.register({
    id: "radio",
    label: "Radio",
    group: "Utilities",
    hint: "Live radio stations around the world (Radio Browser). Click a station to listen.",
    async enable() {
      ds.show = true;
      buildPanel();
      if (!loaded) await load();
      else host.setStatus("radio", `${byId.size.toLocaleString()} stations · most-listened only`);
    },
    disable() {
      ds.show = false;
      stop();
      panel?.remove();
      panel = nowLine = stateLine = null;
      hideLayerCard();
    },
    onPick(entity) {
      const id = typeof entity.id === "string" ? entity.id : "";
      if (id === "radio-cluster") {
        const clustered = (entity as Entity & { cluster?: { clusteredEntities: Entity[] } }).cluster?.clusteredEntities ?? [];
        const pts: Cartesian3[] = [];
        for (const e of clustered) {
          const p = e.position?.getValue(JulianDate.now());
          if (p) pts.push(p);
        }
        if (pts.length) {
          const bs = BoundingSphere.fromPoints(pts);
          bs.radius = Math.max(bs.radius * 1.6, 8000);
          host.viewer.camera.flyToBoundingSphere(bs, { duration: 1.1 });
        }
        return true;
      }
      const s = byId.get(id);
      if (!s) return false;
      showStation(s);
      play(s);
      return true;
    }
  });
}
