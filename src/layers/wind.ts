import { Math as CesiumMath, Matrix4, PerspectiveFrustum } from "cesium";
import type { LayerHost } from "./layerHost";

/**
 * Animated wind: thousands of particles drift along the 10 m wind field (model data from the server, interpolated
 * between grid points) and leave short fading trails on a canvas laid over the globe. The drift speed is scaled to the
 * zoom level so the motion reads the same from orbit and from a city.
 */
type WindField = {
  lat0: number;
  lon0: number;
  stepLat: number;
  stepLon: number;
  nLat: number;
  nLon: number;
  u: ArrayLike<number>;
  v: ArrayLike<number>;
  time: string | null;
};

type Particle = { lon: number; lat: number; age: number; life: number; px: number; py: number; vis: boolean };

const PARTICLES = 4200;
const EARTH_R = 6_378_137;

/** Bilinear lookup of the wind at a position; writes u, v and speed into `out` (no allocations in the hot loop). */
const wind3 = new Float64Array(3);
export function sample(f: WindField, lon: number, lat: number, out: Float64Array = wind3): void {
  const gy = (lat - f.lat0) / f.stepLat;
  let gx = (lon - f.lon0) / f.stepLon;
  gx = ((gx % f.nLon) + f.nLon) % f.nLon;
  const y0 = Math.max(0, Math.min(f.nLat - 2, Math.floor(gy)));
  const x0 = Math.floor(gx);
  const x1 = (x0 + 1) % f.nLon;
  const fy = Math.max(0, Math.min(1, gy - y0));
  const fx = gx - x0;
  const r0 = y0 * f.nLon;
  const r1 = r0 + f.nLon;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const u = f.u;
  const v = f.v;
  const uu = (u[r0 + x0] ?? 0) * w00 + (u[r0 + x1] ?? 0) * w10 + (u[r1 + x0] ?? 0) * w01 + (u[r1 + x1] ?? 0) * w11;
  const vv = (v[r0 + x0] ?? 0) * w00 + (v[r0 + x1] ?? 0) * w10 + (v[r1 + x0] ?? 0) * w01 + (v[r1 + x1] ?? 0) * w11;
  out[0] = uu;
  out[1] = vv;
  out[2] = Math.sqrt(uu * uu + vv * vv);
}

// Colour by speed: calm -> breezy -> windy -> storm-force. Trails are drawn in a fixed set of (speed, opacity)
// buckets, one canvas stroke per bucket per frame, instead of one stroke (and one colour string) per particle.
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [120, 190, 255]],
  [8, [150, 235, 255]],
  [16, [255, 255, 255]],
  [26, [255, 214, 90]],
  [38, [255, 110, 80]]
];
const SPEED_BINS = 20; // 2 m/s each, up to 40 m/s
const ALPHA_BINS = 6;
const BUCKET_STYLE: string[] = [];
for (let s = 0; s < SPEED_BINS; s++) {
  const ms = s * 2 + 1;
  let a = STOPS[0]!;
  let b = STOPS[STOPS.length - 1]!;
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (ms >= STOPS[i]![0] && ms <= STOPS[i + 1]![0]) {
      a = STOPS[i]!;
      b = STOPS[i + 1]!;
      break;
    }
  }
  const t = a === b ? 0 : Math.max(0, Math.min(1, (ms - a[0]) / (b[0] - a[0])));
  const c = a[1].map((v, i) => Math.round(v + (b[1][i]! - v) * t));
  for (let al = 0; al < ALPHA_BINS; al++) {
    const alpha = 0.85 * Math.max(0.05, (al + 1) / ALPHA_BINS);
    BUCKET_STYLE.push(`rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(2)})`);
  }
}

// WGS84 for placing particles on the globe without going through Cartesian3.fromDegrees every time.
const WGS_A = 6_378_137;
const WGS_E2 = 0.00669437999014;
const FRAME_MS = 1000 / 30; // the drift is slow; 30 updates a second reads the same as 60 at half the cost
export function registerWind(host: LayerHost): void {
  const viewer = host.viewer;
  const scene = viewer.scene;
  const camera = viewer.camera;
  let field: WindField | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let raf = 0;
  let parts: Particle[] = [];
  let lastCam = "";
  let refresh: number | null = null;
  let legend: HTMLElement | null = null;

  const viewProj = new Matrix4();
  const buckets: number[][] = Array.from({ length: SPEED_BINS * ALPHA_BINS }, () => []);
  let lastFrameAt = 0;

  function fit(): void {
    if (!canvas) return;
    const src = scene.canvas;
    const w = src.clientWidth;
    const h = src.clientHeight;
    // 1.3 px lines don't need a retina-sized canvas; capping the scale keeps the fade/clear passes cheap.
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastCam = "";
    }
  }
  function viewBox(): { w: number; s: number; e: number; n: number } | null {
    const r = camera.computeViewRectangle();
    if (!r) return null;
    const west = CesiumMath.toDegrees(r.west);
    let east = CesiumMath.toDegrees(r.east);
    if (east < west) east += 360;
    return { w: west, s: CesiumMath.toDegrees(r.south), e: east, n: CesiumMath.toDegrees(r.north) };
  }

  function respawn(p: Particle, box: ReturnType<typeof viewBox>): void {
    if (box) {
      p.lon = box.w + Math.random() * (box.e - box.w);
      p.lat = box.s + Math.random() * (box.n - box.s);
    } else {
      p.lon = Math.random() * 360 - 180;
      p.lat = Math.asin(Math.random() * 2 - 1) * (180 / Math.PI);
    }
    if (p.lon > 180) p.lon -= 360;
    p.age = 0;
    p.life = 50 + Math.random() * 90;
    p.vis = false;
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!canvas || !ctx || !field || document.hidden) return;
    const elapsed = now - lastFrameAt;
    if (elapsed < FRAME_MS - 2) return;
    // How many 60 Hz steps this update stands for, so the drift speed doesn't depend on the update rate.
    const steps = Math.min(3, Math.max(1, elapsed / (1000 / 60)));
    lastFrameAt = now;
    fit();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const camPos = camera.positionWC;
    const camDist = Math.sqrt(camPos.x * camPos.x + camPos.y * camPos.y + camPos.z * camPos.z);
    const height = camera.positionCartographic.height;
    const camKey = `${camPos.x.toFixed(0)}|${camPos.y.toFixed(0)}|${camPos.z.toFixed(0)}|${camera.heading.toFixed(3)}|${camera.pitch.toFixed(3)}`;
    if (camKey !== lastCam) {
      // The picture under the trails moved: start the trails over so they don't smear across the map.
      ctx.clearRect(0, 0, w, h);
      lastCam = camKey;
      for (const p of parts) p.vis = false;
    }

    // Fade old trails a little each update.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${(1 - Math.pow(0.93, steps)).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";

    const box = viewBox();
    // Degrees moved per 60 Hz step per m/s of wind; shrinks as you zoom in so the flow keeps a constant apparent speed.
    const zoomScale = Math.max(0.006, Math.min(1, height / 1.4e7));
    const k = 0.0034 * zoomScale * steps;

    // World -> screen for every particle through one combined matrix (what Cesium itself uses), instead of a
    // function call and allocations per particle.
    Matrix4.multiply((camera.frustum as PerspectiveFrustum).projectionMatrix, camera.viewMatrix, viewProj);
    const m = viewProj;
    const horizon = EARTH_R / camDist;
    const DEG = Math.PI / 180;
    const sw = wind3;

    for (const p of parts) {
      p.age += steps;
      if (p.age > p.life || p.lat > 84 || p.lat < -84) {
        respawn(p, box);
        continue;
      }
      sample(field, p.lon, p.lat, sw);
      const latR = p.lat * DEG;
      const sinLat = Math.sin(latR);
      const cosLat = Math.cos(latR);
      const cosC = Math.max(0.15, cosLat);
      p.lon += (sw[0]! * k) / cosC;
      p.lat += sw[1]! * k;
      if (p.lon > 180) p.lon -= 360;
      else if (p.lon < -180) p.lon += 360;

      const lonR = p.lon * DEG;
      const N = WGS_A / Math.sqrt(1 - WGS_E2 * sinLat * sinLat);
      const X = N * cosLat * Math.cos(lonR);
      const Y = N * cosLat * Math.sin(lonR);
      const Z = N * (1 - WGS_E2) * sinLat;
      // Past the horizon: hidden.
      const dot = (X * camPos.x + Y * camPos.y + Z * camPos.z) / (N * camDist);
      let qx = 0;
      let qy = 0;
      let onScreen = false;
      if (dot >= horizon) {
        const cw = m[3]! * X + m[7]! * Y + m[11]! * Z + m[15]!;
        if (cw > 0) {
          qx = ((m[0]! * X + m[4]! * Y + m[8]! * Z + m[12]!) / cw * 0.5 + 0.5) * w;
          qy = (0.5 - ((m[1]! * X + m[5]! * Y + m[9]! * Z + m[13]!) / cw) * 0.5) * h;
          onScreen = qx >= -20 && qy >= -20 && qx <= w + 20 && qy <= h + 20;
        }
      } else {
        p.age += 10;
      }
      if (!onScreen) {
        p.vis = false;
        continue;
      }
      if (p.vis) {
        const fade = Math.min(1, p.age / 12, (p.life - p.age) / 12);
        const ab = Math.min(ALPHA_BINS - 1, Math.max(0, Math.floor(fade * ALPHA_BINS)));
        const sb = Math.min(SPEED_BINS - 1, Math.floor(sw[2]! / 2));
        buckets[sb * ALPHA_BINS + ab]!.push(p.px, p.py, qx, qy);
      }
      p.px = qx;
      p.py = qy;
      p.vis = true;
    }

    // One stroke per colour bucket.
    for (let b = 0; b < buckets.length; b++) {
      const seg = buckets[b]!;
      if (!seg.length) continue;
      ctx.strokeStyle = BUCKET_STYLE[b]!;
      ctx.beginPath();
      for (let i = 0; i < seg.length; i += 4) {
        ctx.moveTo(seg[i]!, seg[i + 1]!);
        ctx.lineTo(seg[i + 2]!, seg[i + 3]!);
      }
      ctx.stroke();
      seg.length = 0;
    }
  }
  async function load(): Promise<void> {
    const res = await fetch("/api/layers/wind");
    if (!res.ok) throw new Error("Wind data unavailable");
    const raw = (await res.json()) as WindField;
    field = { ...raw, u: Float32Array.from(raw.u), v: Float32Array.from(raw.v) };
    const t = field.time ? new Date(`${field.time}Z`) : null;
    host.setStatus("wind", t ? `Model run ${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Model wind");
  }

  function start(): void {
    const globe = document.getElementById("globe");
    if (!globe || canvas) return;
    canvas = document.createElement("canvas");
    canvas.className = "wind-canvas";
    canvas.setAttribute("aria-hidden", "true");
    globe.append(canvas);
    ctx = canvas.getContext("2d");
    parts = Array.from({ length: PARTICLES }, () => {
      const p: Particle = { lon: 0, lat: 0, age: 0, life: 1, px: 0, py: 0, vis: false };
      respawn(p, viewBox());
      p.age = Math.random() * p.life;
      return p;
    });
    raf = requestAnimationFrame(frame);

    const extras = document.getElementById("layer-extras");
    if (extras) {
      legend = document.createElement("div");
      legend.className = "layer-panel";
      legend.id = "wind-legend";
      const title = document.createElement("div");
      title.className = "layer-panel-title";
      title.textContent = "Wind · 10 m";
      const bar = document.createElement("div");
      bar.className = "wind-legend-bar";
      const labels = document.createElement("div");
      labels.className = "wind-legend-labels";
      for (const t of ["0", "10", "20", "30", "40 m/s"]) {
        const s = document.createElement("span");
        s.textContent = t;
        labels.append(s);
      }
      const note = document.createElement("p");
      note.className = "layer-panel-note";
      note.textContent = "Model forecast on a coarse grid (Open-Meteo), animated for readability — not a measured wind.";
      legend.append(title, bar, labels, note);
      extras.append(legend);
    }
  }

  function stop(): void {
    cancelAnimationFrame(raf);
    canvas?.remove();
    canvas = null;
    ctx = null;
    parts = [];
    legend?.remove();
    legend = null;
  }

  host.register({
    id: "wind",
    label: "Wind",
    group: "Weather",
    hint: "Animated global 10 m wind (model forecast from Open-Meteo, interpolated between grid points).",
    async enable() {
      await load();
      start();
      refresh = window.setInterval(() => void load().catch(() => {}), 30 * 60_000);
    },
    disable() {
      if (refresh != null) window.clearInterval(refresh);
      refresh = null;
      stop();
    }
  });
}



