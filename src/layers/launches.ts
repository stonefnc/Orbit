import {
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  CustomDataSource,
  DistanceDisplayCondition,
  HeadingPitchRange,
  HorizontalOrigin,
  NearFarScalar,
  VerticalOrigin,
  type Entity
} from "cesium";
import type { LayerHost } from "./layerHost";
import { hideLayerCard, showLayerCard } from "./layerCard";
import { startFollow } from "./follow";
import { horizonDepthTest } from "../horizon";
import { groundHeightReference } from "../groundAnchor";

/**
 * Rocket launches: pads with an upcoming or recent (30 days) launch, a details card per launch, and an ascent replay.
 * The replay is a RECONSTRUCTED ESTIMATE: a typical ascent profile flown from the pad along a launch azimuth guessed
 * from the target orbit — it is not telemetry.
 */
type LaunchStream = {
  url: string;
  platform: string;
  youtubeId: string | null;
  title: string;
  publisher: string;
  official: boolean;
  start: string | null;
};

type Launch = {
  id: string;
  name: string;
  net: string;
  windowEnd: string | null;
  status: string;
  statusAbbrev: string;
  provider: string;
  rocket: string;
  mission: string | null;
  missionType: string | null;
  missionText: string | null;
  orbit: string | null;
  orbitAbbrev: string | null;
  padName: string;
  padLat: number;
  padLon: number;
  location: string;
  country: string;
  image: string | null;
  webcast: boolean;
  probability: number | null;
  wiki: string | null;
  info: string | null;
  streams?: LaunchStream[];
};

const R = 6_371_000;
const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function relative(netMs: number): string {
  const d = netMs - Date.now();
  const a = Math.abs(d);
  const h = a / 3_600_000;
  const txt = h < 1 ? `${Math.round(a / 60_000)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
  return d >= 0 ? `in ${txt}` : `${txt} ago`;
}

const OUTCOME_COLOR: Record<string, string> = {
  Success: "#30d158",
  Failure: "#ff453a",
  "Partial Failure": "#ff9f0a"
};

// ---------- Ascent estimate ----------

/** [seconds after liftoff, altitude km, downrange km] for a typical medium-lift ascent to a ~200 km orbit. */
const ASCENT: Array<[number, number, number]> = [
  [0, 0, 0],
  [30, 2.2, 0.2],
  [60, 8, 4],
  [100, 36, 30],
  [150, 76, 92],
  [200, 112, 190],
  [300, 150, 520],
  [420, 186, 1100],
  [540, 200, 1900]
];
const ORBIT_SPEED_KMS = 7.8;
const REPLAY_END_S = 40 * 60;

function interp(t: number): { altKm: number; downKm: number } {
  if (t >= 540) return { altKm: 200, downKm: 1900 + ORBIT_SPEED_KMS * (t - 540) };
  for (let i = 0; i < ASCENT.length - 1; i++) {
    const a = ASCENT[i]!;
    const b = ASCENT[i + 1]!;
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      const s = f * f * (3 - 2 * f) * 0.35 + f * 0.65; // slightly eased, still monotonic
      return { altKm: a[1] + (b[1] - a[1]) * s, downKm: a[2] + (b[2] - a[2]) * s };
    }
  }
  return { altKm: 0, downKm: 0 };
}

/** Launch azimuth (degrees clockwise from north) for the likely target orbit. */
function azimuthFor(l: Launch): number {
  const lat = Math.abs(l.padLat);
  const text = `${l.name} ${l.mission ?? ""}`.toLowerCase();
  const orbit = (l.orbitAbbrev ?? "").toUpperCase();
  let incl: number;
  if (/sso|po|polar/.test(orbit.toLowerCase()) || orbit === "SSO") incl = 97.6;
  else if (/crew|cargo|crs|cygnus|dragon|iss|soyuz ms|progress/.test(text)) incl = 51.6;
  else if (/starlink/.test(text)) incl = lat > 40 ? 70 : 53.2;
  else if (/gto|geo|gso|tli|heo|mars|moon|lunar/.test(orbit.toLowerCase()) || ["GTO", "GEO", "GSO"].includes(orbit)) incl = lat;
  else incl = Math.max(lat, 40);
  const ratio = Math.cos(rad(incl)) / Math.cos(rad(lat));
  if (Math.abs(ratio) > 1) return l.padLat >= 0 ? 90 : 90;
  const az = deg(Math.asin(ratio));
  // asin gives the north-of-east solution; polar/retrograde orbits launch south of east.
  const base = incl > 90 ? 180 - az : az < 0 ? 360 + az : az;
  const southern = l.padLat < 0;
  return southern ? 180 - base : base;
}

function destination(lat: number, lon: number, azDeg: number, distM: number): { lat: number; lon: number } {
  const δ = distM / R;
  const θ = rad(azDeg);
  const φ1 = rad(lat);
  const λ1 = rad(lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: deg(φ2), lon: ((deg(λ2) + 540) % 360) - 180 };
}

function pathAt(l: Launch, t: number): Cartesian3 {
  const az = azimuthFor(l);
  const { altKm, downKm } = interp(t);
  const d = destination(l.padLat, l.padLon, az, downKm * 1000);
  return Cartesian3.fromDegrees(d.lon, d.lat, altKm * 1000 + 30);
}

function phaseAt(t: number): string {
  if (t < 0) return "On the pad";
  if (t < 70) return "Liftoff · climbing through the thick air";
  if (t < 150) return "Max-Q passed · first stage burning";
  if (t < 210) return "Stage separation · second stage ignites";
  if (t < 540) return "Second stage burning · fairing away";
  if (t < 570) return "Orbit insertion (≈ 200 km)";
  return "Coasting in parking orbit";
}

function fmtT(t: number): string {
  const s = Math.abs(Math.round(t));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `T${t < 0 ? "−" : "+"}${mm}:${ss}`;
}

let rocketIcon: string | null = null;
function rocketUri(color = "#ffffff"): string {
  if (rocketIcon && color === "#ffffff") return rocketIcon;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return "";
  g.translate(32, 32);
  g.rotate(-Math.PI / 4);
  g.fillStyle = color;
  g.strokeStyle = "#1d1d1f";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, -26);
  g.bezierCurveTo(10, -14, 10, 8, 7, 16);
  g.lineTo(-7, 16);
  g.bezierCurveTo(-10, 8, -10, -14, 0, -26);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(7, 6);
  g.lineTo(16, 20);
  g.lineTo(7, 16);
  g.moveTo(-7, 6);
  g.lineTo(-16, 20);
  g.lineTo(-7, 16);
  g.fill();
  g.stroke();
  g.fillStyle = "#4fb3ff";
  g.beginPath();
  g.arc(0, -8, 4, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#ff9f0a";
  g.beginPath();
  g.moveTo(-4, 17);
  g.lineTo(0, 28);
  g.lineTo(4, 17);
  g.fill();
  const uri = c.toDataURL("image/png");
  if (color === "#ffffff") rocketIcon = uri;
  return uri;
}

function padUri(color: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = 56;
  const g = c.getContext("2d");
  if (!g) return "";
  const grad = g.createRadialGradient(28, 28, 3, 28, 28, 26);
  grad.addColorStop(0, `${color}cc`);
  grad.addColorStop(1, `${color}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 56, 56);
  g.beginPath();
  g.arc(28, 28, 9, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = "#fff";
  g.stroke();
  g.fillStyle = "#1d1d1f";
  g.beginPath();
  g.moveTo(28, 21);
  g.lineTo(32, 31);
  g.lineTo(24, 31);
  g.closePath();
  g.fill();
  return c.toDataURL("image/png");
}

export function registerLaunches(host: LayerHost): void {
  const viewer = host.viewer;
  const ds = new CustomDataSource("launches");
  ds.show = false;
  void viewer.dataSources.add(ds);
  let launches: Launch[] = [];
  const padLaunches = new Map<string, Launch[]>();
  let loaded = false;
  const iconCache = new Map<string, string>();
  const icon = (color: string): string => {
    let u = iconCache.get(color);
    if (!u) iconCache.set(color, (u = padUri(color)));
    return u;
  };

  // ----- Replay state -----
  let replay: {
    launch: Launch;
    t: number;
    speed: number;
    playing: boolean;
    follow: boolean;
    raf: number;
    last: number;
    rocket: Entity;
    full: Entity;
    done: Entity;
    stopFollow: (() => void) | null;
    panel: HTMLElement;
    slider: HTMLInputElement;
    clock: HTMLElement;
    phase: HTMLElement;
    playBtn: HTMLButtonElement;
    pos: Cartesian3;
  } | null = null;

  function endReplay(): void {
    if (!replay) return;
    cancelAnimationFrame(replay.raf);
    replay.stopFollow?.();
    ds.entities.remove(replay.rocket);
    ds.entities.remove(replay.full);
    ds.entities.remove(replay.done);
    replay.panel.remove();
    replay = null;
    viewer.scene.requestRender();
  }

  function startReplay(l: Launch): void {
    endReplay();
    const extras = document.getElementById("layer-extras");
    if (!extras) return;
    const full: Cartesian3[] = [];
    for (let t = 0; t <= REPLAY_END_S; t += t < 600 ? 5 : 30) full.push(pathAt(l, t));
    let count = 1;

    const rocket = ds.entities.add({
      id: "launch-replay-rocket",
      position: new ConstantPositionProperty(full[0]!),
      billboard: {
        image: rocketUri(),
        width: 40,
        height: 40,
        disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
      },
      label: {
        text: "T+00:00",
        font: '600 12px -apple-system, "SF Pro Text", Inter, sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: 2,
        pixelOffset: new Cartesian2(0, 34),
        disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
      }
    });
    const fullLine = ds.entities.add({
      id: "launch-replay-full",
      polyline: { positions: full, width: 2, material: Color.WHITE.withAlpha(0.28) }
    });
    const doneLine = ds.entities.add({
      id: "launch-replay-done",
      polyline: {
        positions: new CallbackProperty(() => full.slice(0, Math.max(2, count)), false) as never,
        width: 4,
        material: Color.fromCssColorString("#ff9f0a")
      }
    });

    const panel = el("div", "layer-panel");
    panel.id = "launch-replay";
    panel.append(el("div", "layer-panel-title", `Launch replay · ${l.name}`));
    const clock = el("div", "radio-now", "T+00:00");
    const phase = el("p", "layer-panel-note", phaseAt(0));
    const slider = el("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(REPLAY_END_S);
    slider.step = "1";
    slider.value = "0";
    slider.setAttribute("aria-label", "Replay time");
    const row = el("div", "layer-panel-row");
    const playBtn = el("button", "layer-card-btn primary", "Pause");
    playBtn.type = "button";
    const speedBtn = el("button", "layer-card-btn", "1×");
    speedBtn.type = "button";
    const followBtn = el("button", "layer-card-btn", "Following");
    followBtn.type = "button";
    const closeBtn = el("button", "layer-card-btn", "Close");
    closeBtn.type = "button";
    row.append(playBtn, speedBtn, followBtn, closeBtn);
    panel.append(clock, phase, slider, row);
    panel.append(el("p", "layer-panel-note", "RECONSTRUCTED ESTIMATE — a typical ascent profile along a guessed launch azimuth, not telemetry."));
    extras.prepend(panel);

    const state = {
      launch: l,
      t: 0,
      speed: 1,
      playing: true,
      follow: true,
      raf: 0,
      last: 0,
      rocket,
      full: fullLine,
      done: doneLine,
      stopFollow: null as (() => void) | null,
      panel,
      slider,
      clock,
      phase,
      playBtn,
      pos: full[0]!
    };
    replay = state;

    const apply = (): void => {
      const p = pathAt(l, state.t);
      state.pos = p;
      (rocket.position as ConstantPositionProperty).setValue(p);
      (rocket.label as unknown as { text: string }).text = fmtT(state.t);
      count = Math.max(2, Math.floor(state.t / 5) + 1);
      state.slider.value = String(Math.round(state.t));
      state.clock.textContent = fmtT(state.t);
      state.phase.textContent = phaseAt(state.t);
      viewer.scene.requestRender();
    };

    const loop = (now: number): void => {
      if (replay !== state) return;
      state.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.2, (now - (state.last || now)) / 1000);
      state.last = now;
      if (state.playing) {
        state.t += dt * state.speed;
        if (state.t >= REPLAY_END_S) {
          state.t = REPLAY_END_S;
          state.playing = false;
          playBtn.textContent = "Replay";
        }
        apply();
      }
    };

    const beginFollow = (): void => {
      // Start a few kilometres away so the whole stack is in view.
      viewer.camera.flyToBoundingSphere(new BoundingSphere(pathAt(l, 0), 600), {
        duration: 1.5,
        offset: new HeadingPitchRange(viewer.camera.heading, -0.35, 9000),
        complete: () => {
          if (replay === state && state.follow) state.stopFollow = startFollow(viewer, () => state.pos);
        }
      });
    };

    playBtn.addEventListener("click", () => {
      if (state.t >= REPLAY_END_S) state.t = 0;
      state.playing = !state.playing;
      playBtn.textContent = state.playing ? "Pause" : "Play";
    });
    const speeds = [1, 4, 16, 60];
    speedBtn.addEventListener("click", () => {
      state.speed = speeds[(speeds.indexOf(state.speed) + 1) % speeds.length]!;
      speedBtn.textContent = `${state.speed}×`;
    });
    followBtn.addEventListener("click", () => {
      state.follow = !state.follow;
      followBtn.textContent = state.follow ? "Following" : "Follow";
      if (state.follow) state.stopFollow = startFollow(viewer, () => state.pos);
      else {
        state.stopFollow?.();
        state.stopFollow = null;
      }
    });
    slider.addEventListener("input", () => {
      state.t = Number(slider.value);
      apply();
    });
    closeBtn.addEventListener("click", endReplay);

    apply();
    state.raf = requestAnimationFrame(loop);
    beginFollow();
  }

  // ----- Livestreams -----

  function endStream(): void {
    document.getElementById("launch-stream")?.remove();
  }

  /** Opens the stream panel: an embedded player for YouTube streams, plus every other source as a button. */
  function openStreams(l: Launch, pick?: number): void {
    const extras = document.getElementById("layer-extras");
    const streams = l.streams ?? [];
    if (!extras || !streams.length) return;
    endStream();
    // Start with the best source that can play inside the page; otherwise the best one overall.
    const first = pick ?? Math.max(0, streams.findIndex((s) => s.youtubeId));
    const cur = streams[Math.min(first, streams.length - 1)]!;

    const panel = el("div", "layer-panel");
    panel.id = "launch-stream";
    panel.append(el("div", "layer-panel-title", `Watch · ${l.mission ?? l.name}`));

    if (cur.youtubeId) {
      const frame = el("iframe", "launch-stream-frame");
      frame.src = `https://www.youtube-nocookie.com/embed/${cur.youtubeId}?autoplay=1&rel=0&playsinline=1`;
      frame.title = `${cur.publisher || cur.platform} livestream`;
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.loading = "lazy";
      panel.append(frame);
    } else {
      panel.append(
        el("p", "layer-panel-note", `${cur.platform} streams can't be embedded here, so this one opens in a new tab.`)
      );
    }
    const open = el("a", "layer-card-btn primary", `Open on ${cur.platform}`);
    open.href = cur.url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    const bar = el("div", "layer-panel-row");
    bar.append(open);
    panel.append(bar);

    if (streams.length > 1) {
      panel.append(el("div", "layer-panel-title", "Other sources"));
      const list = el("div", "launch-list");
      streams.forEach((s, i) => {
        if (i === first) return;
        const b = el("button", "launch-row");
        b.type = "button";
        const who = s.publisher || s.title || s.platform;
        b.append(
          el("strong", undefined, `${s.official ? "Official" : "Unofficial"} · ${who}`),
          el("small", undefined, `${s.platform}${s.youtubeId ? " · plays here" : " · opens in a new tab"}`)
        );
        b.addEventListener("click", () => (s.youtubeId ? openStreams(l, i) : window.open(s.url, "_blank", "noopener,noreferrer")));
        list.append(b);
      });
      panel.append(list);
    }
    panel.append(
      el("p", "layer-panel-note", "Stream links are collected by Launch Library from the launch providers and community broadcasters. Some only go live shortly before liftoff.")
    );
    extras.prepend(panel);
  }

  /** A search link that finds a stream when none has been listed yet. */
  function searchLink(l: Launch): string {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${l.mission ?? l.name} ${l.rocket} launch live`)}`;
  }

  // ----- Pads and cards -----

  function launchDetails(l: Launch): void {
    const netMs = Date.parse(l.net);
    const rows: Array<[string, string]> = [
      ["Status", l.status],
      ["Launch", `${new Date(netMs).toLocaleString()} (${relative(netMs)})`],
      ["Rocket", `${l.rocket}${l.provider ? ` · ${l.provider}` : ""}`],
      ["Pad", `${l.padName}${l.location ? `, ${l.location}` : ""}`]
    ];
    if (l.orbit) rows.push(["Orbit", l.orbit]);
    if (l.missionType) rows.push(["Mission type", l.missionType]);
    if (l.probability != null && netMs > Date.now()) rows.push(["Go probability", `${l.probability}%`]);
    const body = l.missionText ? el("p", "layer-panel-note", l.missionText) : undefined;
    const streams = l.streams ?? [];
    const sinceMs = Date.now() - netMs;
    const watchLabel = sinceMs > 4 * 3_600_000 ? "Watch replay" : sinceMs > -3_600_000 ? "Watch live" : "Watch stream";
    if (streams.length) rows.push(["Streams", `${streams.length} found · ${streams.filter((s) => s.official).length} official`]);
    showLayerCard({
      kicker: "Rocket launch",
      title: l.mission ?? l.name,
      subtitle: l.name,
      rows,
      body,
      actions: [
        ...(streams.length ? [{ label: watchLabel, primary: true, run: () => openStreams(l) }] : []),
        { label: "Replay ascent", primary: !streams.length, run: () => startReplay(l) },
        {
          label: "Fly to pad",
          run: () =>
            viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(l.padLon, l.padLat, 25_000), duration: 2 })
        }
      ],
      links: [
        ...(streams.length ? [] : [{ label: "Find a stream (YouTube)", href: searchLink(l) }]),
        ...(l.info ? [{ label: "Mission info", href: l.info }] : []),
        ...(l.wiki ? [{ label: "Pad (Wikipedia)", href: l.wiki }] : [])
      ]
    });
  }

  function padCard(key: string): void {
    const list = padLaunches.get(key) ?? [];
    if (!list.length) return;
    if (list.length === 1) {
      launchDetails(list[0]!);
      return;
    }
    const body = el("div", "launch-list");
    for (const l of list.slice(0, 8)) {
      const b = el("button", "launch-row");
      b.type = "button";
      const netMs = Date.parse(l.net);
      b.append(el("strong", undefined, l.mission ?? l.name), el("small", undefined, `${l.rocket} · ${relative(netMs)} · ${l.statusAbbrev}`));
      b.addEventListener("click", () => launchDetails(l));
      body.append(b);
    }
    const p = list[0]!;
    showLayerCard({
      kicker: `${list.length} launches from this pad`,
      title: p.padName,
      subtitle: p.location,
      body
    });
  }

  async function load(): Promise<void> {
    const res = await fetch("/api/layers/launches");
    if (!res.ok) throw new Error("Launch schedule unavailable");
    launches = ((await res.json()) as { launches: Launch[] }).launches;
    ds.entities.removeAll();
    padLaunches.clear();
    const horizon = Date.now() + 120 * 86_400_000;
    for (const l of launches) {
      const t = Date.parse(l.net);
      if (!Number.isFinite(t) || t > horizon) continue;
      const key = `${l.padLat.toFixed(3)},${l.padLon.toFixed(3)}`;
      padLaunches.set(key, [...(padLaunches.get(key) ?? []), l]);
    }
    for (const [key, list] of padLaunches) {
      const nextUp = list.find((l) => Date.parse(l.net) > Date.now() - 6 * 3_600_000 && !OUTCOME_COLOR[l.status]);
      const lead = nextUp ?? list[list.length - 1]!;
      const color = nextUp
        ? Date.parse(nextUp.net) - Date.now() < 48 * 3_600_000
          ? "#ff9f0a"
          : "#2997ff"
        : (OUTCOME_COLOR[lead.status] ?? "#8e8e93");
      ds.entities.add({
        id: `launchpad-${key}`,
        position: Cartesian3.fromDegrees(lead.padLon, lead.padLat, 0),
        billboard: {
          image: icon(color),
          width: 38,
          height: 38,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(1e5, 1.2, 3e7, 0.6),
          heightReference: groundHeightReference(padLaunches.size),
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        },
        label: {
          heightReference: groundHeightReference(padLaunches.size),
          text: nextUp ? `${nextUp.mission ?? nextUp.name} · ${relative(Date.parse(nextUp.net))}` : lead.padName,
          font: '500 11px -apple-system, "SF Pro Text", Inter, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: 2,
          pixelOffset: new Cartesian2(0, 26),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 4e6),
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        }
      });
    }
    loaded = true;
    const upcoming = launches.filter((l) => Date.parse(l.net) > Date.now() && Date.parse(l.net) < horizon).length;
    host.setStatus("launches", `${upcoming} upcoming · ${padLaunches.size} pads`);
    viewer.scene.requestRender();
  }

  host.register({
    id: "launches",
    label: "Launches",
    group: "Utilities",
    hint: "Rocket launches from the last 30 days and the next few months (Launch Library 2). Click a pad for details and an ascent replay.",
    async enable() {
      ds.show = true;
      if (!loaded) await load();
    },
    disable() {
      endReplay();
      endStream();
      ds.show = false;
      hideLayerCard();
    },
    onPick(entity) {
      const id = typeof entity.id === "string" ? entity.id : "";
      if (!id.startsWith("launchpad-")) return false;
      padCard(id.slice("launchpad-".length));
      return true;
    }
  });
}

