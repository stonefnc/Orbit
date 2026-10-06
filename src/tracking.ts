import {
  Cartesian3,
  Color,
  CustomDataSource,
  GeometryInstance,
  PolylineColorAppearance,
  PolylineGeometry,
  Primitive,
  type Viewer
} from "cesium";
import { startFollow } from "./layers/follow";

/**
 * Click-to-track: lock the camera onto the selected aircraft, ship or satellite and draw a fading trail behind it.
 * For aircraft the 24-hour path (the day's recorded positions, coloured by altitude) can be drawn as well.
 */
export type TrackTarget = {
  kind: "plane" | "vessel" | "satellite";
  id: string;
  label: string;
  /** ICAO24 hex, for aircraft (used to fetch the recorded path). */
  hex?: string;
  getPosition: () => Cartesian3 | undefined;
};

type Trace = { startUnix: number; points: Array<[number, number, number, number | null, number | null]>; total: number };

const SEGMENTS = 18;
const MAX_SAMPLES = 360;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Cold-to-warm ramp: ground blue, low orange, cruising altitude cyan-white. */
function altColor(ft: number | null): Color {
  if (ft == null) return Color.fromCssColorString("#8e8e93");
  const t = Math.max(0, Math.min(1, ft / 40_000));
  const stops: Array<[number, [number, number, number]]> = [
    [0, [90, 130, 255]],
    [0.12, [255, 159, 10]],
    [0.4, [255, 214, 10]],
    [0.75, [48, 209, 88]],
    [1, [100, 230, 255]]
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]!;
    const [t1, c1] = stops[i + 1]!;
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return new Color(
        (c0[0] + (c1[0] - c0[0]) * f) / 255,
        (c0[1] + (c1[1] - c0[1]) * f) / 255,
        (c0[2] + (c1[2] - c0[2]) * f) / 255,
        1
      );
    }
  }
  return Color.WHITE;
}

export function createTracker(
  viewer: Viewer,
  getSelection: () => TrackTarget | null
): { sync: () => void; stop: () => void } {
  const ds = new CustomDataSource("track-trail");
  void viewer.dataSources.add(ds);
  const pill = document.getElementById("track-pill");
  if (!pill) return { sync: () => {}, stop: () => {} };

  let tracking: TrackTarget | null = null;
  let stopFollow: (() => void) | null = null;
  let samples: Cartesian3[] = [];
  let sampleTimer: number | null = null;
  let historyPrimitive: Primitive | null = null;
  let historyFor: string | null = null;
  let historyNote = "";
  let lastKey = "";

  function clearTrail(): void {
    ds.entities.removeAll();
    samples = [];
  }

  function ensureSegments(): void {
    if (ds.entities.values.length) return;
    for (let i = 0; i < SEGMENTS; i++) {
      const alpha = 0.06 + (0.9 * (i + 1)) / SEGMENTS;
      ds.entities.add({
        id: `trail-${i}`,
        polyline: {
          positions: [],
          width: 2 + (2.5 * (i + 1)) / SEGMENTS,
          material: Color.fromCssColorString("#ffd60a").withAlpha(alpha)
        }
      });
    }
  }

  function redrawTrail(): void {
    ensureSegments();
    const n = samples.length;
    if (n < 2) return;
    const per = Math.max(2, Math.ceil(n / SEGMENTS));
    for (let i = 0; i < SEGMENTS; i++) {
      // Newest segment last; segments overlap by one point so the line is continuous.
      const end = n - (SEGMENTS - 1 - i) * per;
      const start = end - per - 1;
      const e = ds.entities.getById(`trail-${i}`);
      if (!e?.polyline) continue;
      const slice = end > 1 ? samples.slice(Math.max(0, start), Math.max(0, end)) : [];
      (e.polyline as unknown as { positions: Cartesian3[] }).positions = slice.length >= 2 ? slice : [];
    }
    viewer.scene.requestRender();
  }

  function stop(): void {
    stopFollow?.();
    stopFollow = null;
    if (sampleTimer != null) window.clearInterval(sampleTimer);
    sampleTimer = null;
    tracking = null;
    clearTrail();
    viewer.scene.requestRender();
    render();
  }

  function start(t: TrackTarget): void {
    stop();
    tracking = t;
    const first = t.getPosition();
    if (!first) {
      tracking = null;
      return;
    }
    samples = [first];
    stopFollow = startFollow(viewer, () => t.getPosition());
    sampleTimer = window.setInterval(() => {
      if (!tracking) return;
      const p = tracking.getPosition();
      if (!p) {
        // The target left the feed (an aircraft out of range, say): release the camera.
        stop();
        return;
      }
      const last = samples[samples.length - 1];
      if (!last || Cartesian3.distance(last, p) > 5) samples.push(p.clone());
      if (samples.length > MAX_SAMPLES) samples.shift();
      redrawTrail();
    }, 1000);
    render();
  }

  function clearHistory(): void {
    if (historyPrimitive) viewer.scene.primitives.remove(historyPrimitive);
    historyPrimitive = null;
    historyFor = null;
    historyNote = "";
    viewer.scene.requestRender();
  }

  async function showHistory(hex: string): Promise<void> {
    if (historyFor === hex) {
      clearHistory();
      render();
      return;
    }
    clearHistory();
    historyNote = "Loading path…";
    render();
    try {
      const res = await fetch(`/api/layers/trace/${hex}`);
      if (res.status === 404) throw new Error("No recorded history for this aircraft");
      if (!res.ok) throw new Error("History service unavailable");
      const tr = (await res.json()) as Trace;
      const pts = tr.points.filter((p) => Number.isFinite(p[1]) && Number.isFinite(p[2]));
      if (pts.length < 2) throw new Error("Not enough history to draw");
      const positions = pts.map((p) => Cartesian3.fromDegrees(p[2], p[1], Math.max(0, (p[3] ?? 0) * 0.3048)));
      const colors = pts.map((p) => altColor(p[3]));
      historyPrimitive = new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: new PolylineGeometry({ positions, colors, colorsPerVertex: true, width: 3.5 })
        }),
        appearance: new PolylineColorAppearance(),
        asynchronous: false
      });
      viewer.scene.primitives.add(historyPrimitive);
      historyFor = hex;
      const start = new Date(tr.startUnix * 1000);
      const hours = Math.round((pts[pts.length - 1]![0] / 3600) * 10) / 10;
      historyNote = `${hours} h of path · since ${start.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    } catch (e) {
      historyNote = e instanceof Error ? e.message : "History unavailable";
    }
    viewer.scene.requestRender();
    render();
  }

  function render(): void {
    const sel = tracking ?? getSelection();
    if (!sel) {
      pill!.classList.add("hidden");
      pill!.textContent = "";
      lastKey = "";
      return;
    }
    const key = `${tracking ? "t" : "s"}|${sel.id}|${historyFor ?? ""}|${historyNote}`;
    if (key === lastKey) return;
    lastKey = key;
    pill!.textContent = "";
    pill!.classList.remove("hidden");

    const label = el("span", "track-label", tracking ? `Following ${sel.label}` : sel.label);
    pill!.append(label);

    const follow = el("button", `track-btn${tracking ? " is-on" : ""}`, tracking ? "Stop" : "Follow");
    follow.type = "button";
    follow.title = tracking ? "Release the camera" : "Lock the camera onto this target and draw its trail";
    follow.addEventListener("click", () => (tracking ? stop() : start(sel)));
    pill!.append(follow);

    if (sel.kind === "plane" && sel.hex) {
      const hist = el("button", `track-btn${historyFor === sel.hex ? " is-on" : ""}`, historyFor === sel.hex ? "Hide 24 h path" : "24 h path");
      hist.type = "button";
      hist.title = "Draw where this aircraft has been over the last day, coloured by altitude";
      hist.addEventListener("click", () => void showHistory(sel.hex!));
      pill!.append(hist);
    }
    if (historyNote && sel.kind === "plane") pill!.append(el("span", "track-note", historyNote));
  }

  return {
    stop() {
      if (tracking) stop();
      if (historyFor) clearHistory();
    },
    sync() {
      // Called a couple of times a second: follows selection changes, and ends tracking if the target vanished.
      if (tracking && !tracking.getPosition()) {
        stop();
        return;
      }
      const sel = getSelection();
      if (!tracking && historyFor && (!sel || sel.hex !== historyFor)) clearHistory();
      render();
    }
  };
}
