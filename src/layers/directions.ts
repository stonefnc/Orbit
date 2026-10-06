import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  PolylineDashMaterialProperty,
  PolylineOutlineMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin
} from "cesium";
import type { LayerHost } from "./layerHost";
import { horizonDepthTest } from "../horizon";
import { groundHeightReference } from "../groundAnchor";

/**
 * Directions: pick A and B on the globe, get a street-following drive / walk / cycle route (OpenStreetMap data via
 * the FOSSGIS OSRM servers) drawn on the terrain with turn-by-turn steps, and fly the camera along it like a drone.
 */
type Profile = "driving" | "foot" | "bike";
type Step = {
  name: string;
  distance: number;
  duration: number;
  type: string;
  modifier: string | null;
  exit: number | null;
  location: [number, number];
};
type Route = { distance: number; duration: number; geometry: Array<[number, number]>; steps: Step[] };
type AvoidReport = {
  onFastest: number;
  onChosen: number;
  extraSeconds: number;
  extraMeters: number;
  dataComplete: boolean;
  outcome: string;
};



function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const mi = m / 1609.344;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km · ${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
}

function fmtTime(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${Math.max(1, m)} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function instruction(s: Step): string {
  const street = s.name ? ` onto ${s.name}` : "";
  const dir = s.modifier ? s.modifier.replace("slight ", "slight ").replace("sharp ", "sharp ") : "";
  switch (s.type) {
    case "depart":
      return s.name ? `Start on ${s.name}` : "Start";
    case "arrive":
      return "Arrive at your destination";
    case "turn":
      return `Turn ${dir}${street}`;
    case "new name":
      return s.name ? `Continue onto ${s.name}` : "Continue";
    case "continue":
      return s.name ? `Continue on ${s.name}` : "Continue straight";
    case "merge":
      return `Merge ${dir}${street}`;
    case "on ramp":
      return `Take the ramp${street}`;
    case "off ramp":
      return `Take the exit${street}`;
    case "fork":
      return `Keep ${dir}${street}`;
    case "end of road":
      return `At the end of the road, turn ${dir}${street}`;
    case "roundabout":
    case "rotary":
      return `At the roundabout${s.exit ? `, take exit ${s.exit}` : ""}${street}`;
    case "roundabout turn":
      return `At the roundabout, turn ${dir}${street}`;
    default:
      return s.name ? `Continue on ${s.name}` : "Continue";
  }
}

const R = 6_371_000;
function hav(a: [number, number], b: [number, number]): number {
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const dφ = φ2 - φ1;
  const dλ = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(a: [number, number], b: [number, number]): number {
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const dλ = ((b[0] - a[0]) * Math.PI) / 180;
  return Math.atan2(Math.sin(dλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ));
}

export function registerDirections(host: LayerHost): void {
  const viewer = host.viewer;
  const ds = new CustomDataSource("directions");
  ds.show = false;
  void viewer.dataSources.add(ds);

  let panel: HTMLElement | null = null;
  let handler: ScreenSpaceEventHandler | null = null;
  let picking: "A" | "B" | null = null;
  let profile: Profile = "driving";
  let a: [number, number] | null = null;
  let b: [number, number] | null = null;
  let route: Route | null = null;
  let flyRaf = 0;
  let stopFly: (() => void) | null = null;

  let aBtn: HTMLButtonElement | null = null;
  let bBtn: HTMLButtonElement | null = null;
  let summary: HTMLElement | null = null;
  let stepsEl: HTMLElement | null = null;
  let hint: HTMLElement | null = null;
  let flyBtn: HTMLButtonElement | null = null;
  let avoidAlpr = false;
  let avoidNote: HTMLElement | null = null;

  function setHint(text: string): void {
    if (hint) hint.textContent = text;
  }

  function coordText(p: [number, number] | null): string {
    return p ? `${p[1].toFixed(4)}, ${p[0].toFixed(4)}` : "not set";
  }

  function drawPoints(): void {
    ds.entities.removeById("dir-a");
    ds.entities.removeById("dir-b");
    for (const [id, p, color, label] of [
      ["dir-a", a, "#30d158", "A"],
      ["dir-b", b, "#ff453a", "B"]
    ] as const) {
      if (!p) continue;
      ds.entities.add({
        id,
        position: Cartesian3.fromDegrees(p[0], p[1], 0),
        point: {
          pixelSize: 14,
          color: Color.fromCssColorString(color),
          outlineColor: Color.WHITE,
          outlineWidth: 3,
          heightReference: groundHeightReference(2),
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        },
        label: {
          heightReference: groundHeightReference(2),
          text: label,
          font: '700 14px -apple-system, "SF Pro Text", Inter, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 4,
          style: 2,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -14),
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        }
      });
    }
    viewer.scene.requestRender();
  }

  function clearRoute(): void {
    stopFlying();
    ds.entities.removeById("dir-line");
    ds.entities.removeById("dir-fast");
    for (const e of [...ds.entities.values]) if (typeof e.id === "string" && e.id.startsWith("dir-cam-")) ds.entities.remove(e);
    route = null;
    if (avoidNote) avoidNote.textContent = "";
    if (summary) summary.textContent = "";
    if (stepsEl) stepsEl.textContent = "";
    if (flyBtn) flyBtn.disabled = true;
  }

  function stopFlying(): void {
    cancelAnimationFrame(flyRaf);
    stopFly?.();
    stopFly = null;
    if (flyBtn) flyBtn.textContent = "Fly the route";
  }

  /** Plain-language result of the ALPR-avoidance search. */
  function showAvoidResult(r: AvoidReport, route: Route): void {
    if (!avoidNote) return;
    const mins = Math.round(r.extraSeconds / 60);
    const cost = `${mins >= 1 ? `+${mins} min` : r.extraSeconds > 0 ? "+<1 min" : "no extra time"}${r.extraMeters > 200 ? `, +${fmtDist(r.extraMeters)}` : ""}`;
    let text: string;
    switch (r.outcome) {
      case "none-on-fastest":
        text = "The fastest route passes no mapped license-plate readers.";
        break;
      case "ok":
        text = `Avoids all ${r.onFastest} mapped readers on the fastest route (${cost}).`;
        break;
      case "reduced":
        text = `Passes ${r.onChosen} mapped readers instead of ${r.onFastest} on the fastest route (${cost}). The rest sit on roads this trip can't avoid.`;
        break;
      case "too-wide":
        text = "This trip is too long to check against the camera map. Try a shorter one.";
        break;
      default:
        text = `Couldn't avoid the ${r.onFastest} mapped readers on this trip — they are on roads every sensible route uses.`;
    }
    if (!r.dataComplete) text += " (The camera map was still loading, so the count may be low — run it again in a minute.)";
    avoidNote.textContent = `${text} Red dots are readers on this route; orange ones are on the fastest route only (dashed). Only readers mapped in OpenStreetMap are known.`;
    void route;
  }

  async function compute(): Promise<void> {
    if (!a || !b) return;
    clearRoute();
    setHint(avoidAlpr ? "Looking for a route that dodges mapped license-plate readers — this takes about 10 seconds…" : "Finding the best route…");
    try {
      const q = new URLSearchParams({ profile, from: `${a[0]},${a[1]}`, to: `${b[0]},${b[1]}` });
      if (avoidAlpr) q.set("avoidAlpr", "1");
      const res = await fetch(`/api/layers/route?${q.toString()}`);
      const j = (await res.json()) as Route & { error?: string; avoid?: AvoidReport; fastest?: Array<[number, number]> | null; cameras?: Array<[number, number, boolean, boolean]> };
      if (!res.ok) throw new Error(j.error ?? "Routing unavailable");
      route = j;
      if (j.avoid) showAvoidResult(j.avoid, j);
      if (j.fastest) {
        ds.entities.add({
          id: "dir-fast",
          polyline: {
            positions: Cartesian3.fromDegreesArray(j.fastest.flatMap(([lo, la]) => [lo, la])),
            width: 4,
            material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString("#ff9f0a"), dashLength: 14 }),
            clampToGround: true
          }
        });
      }
      for (const [i, c] of (j.cameras ?? []).entries()) {
        const [clat, clon, onFast, onChosen] = c;
        ds.entities.add({
          id: `dir-cam-${i}`,
          position: Cartesian3.fromDegrees(clon, clat, 0),
          point: {
            pixelSize: onChosen ? 9 : 7,
            color: Color.fromCssColorString(onChosen ? "#ff453a" : onFast ? "#ff9f0a" : "#8e8e93").withAlpha(0.95),
            outlineColor: Color.WHITE,
            outlineWidth: onChosen || onFast ? 1.5 : 1,
            heightReference: groundHeightReference((j.cameras ?? []).length),
            disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
          }
        });
      }
      ds.entities.add({
        id: "dir-line",
        polyline: {
          positions: Cartesian3.fromDegreesArray(j.geometry.flatMap(([lo, la]) => [lo, la])),
          width: 7,
          material: new PolylineOutlineMaterialProperty({
            color: Color.fromCssColorString("#2997ff"),
            outlineColor: Color.WHITE,
            outlineWidth: 2
          }),
          clampToGround: true
        }
      });
      if (summary) summary.textContent = `${fmtDist(j.distance)} · ${fmtTime(j.duration)}`;
      if (stepsEl) {
        stepsEl.textContent = "";
        for (const s of j.steps) {
          const row = el("button", "dir-step");
          row.type = "button";
          row.append(el("span", undefined, instruction(s)), el("small", undefined, s.type === "arrive" ? "" : fmtDist(s.distance)));
          row.addEventListener("click", () => {
            viewer.camera.flyTo({
              destination: Cartesian3.fromDegrees(s.location[0], s.location[1], 350),
              orientation: { heading: viewer.camera.heading, pitch: CesiumMath.toRadians(-50), roll: 0 },
              duration: 1.4
            });
          });
          stepsEl.append(row);
        }
      }
      if (flyBtn) flyBtn.disabled = false;
      setHint("Route ready. Click any step to look at that turn.");
      // Frame the whole route.
      const lons = j.geometry.map((p) => p[0]);
      const lats = j.geometry.map((p) => p[1]);
      const west = Math.min(...lons);
      const east = Math.max(...lons);
      const south = Math.min(...lats);
      const north = Math.max(...lats);
      const pad = Math.max(0.002, (east - west + (north - south)) * 0.12);
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees((west + east) / 2, (south + north) / 2, Math.max(1500, hav([west, south], [east, north]) * 1.6)),
        duration: 1.6
      });
      void pad;
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Routing unavailable");
    } finally {
      viewer.scene.requestRender();
    }
  }

  function flyRoute(): void {
    if (!route) return;
    if (stopFly) {
      stopFlying();
      return;
    }
    const pts = route.geometry;
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + hav(pts[i - 1]!, pts[i]!));
    const total = cum[cum.length - 1]!;
    // About 50 seconds for any route length, between a brisk walk and a jet.
    const speed = Math.min(900, Math.max(25, total / 50));
    let travelled = 0;
    let last = 0;
    let heading = bearing(pts[0]!, pts[Math.min(pts.length - 1, 3)]!);

    const at = (d: number): [number, number] => {
      let i = 1;
      while (i < cum.length - 1 && cum[i]! < d) i++;
      const seg = cum[i]! - cum[i - 1]!;
      const f = seg > 0 ? (d - cum[i - 1]!) / seg : 0;
      const p0 = pts[i - 1]!;
      const p1 = pts[i]!;
      return [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f];
    };

    if (flyBtn) flyBtn.textContent = "Stop flying";
    const frame = (now: number): void => {
      if (!stopFly) return;
      flyRaf = requestAnimationFrame(frame);
      const dt = Math.min(0.2, (now - (last || now)) / 1000);
      last = now;
      travelled = Math.min(total, travelled + speed * dt);
      const p = at(travelled);
      const ahead = at(Math.min(total, travelled + Math.max(60, speed * 2.5)));
      let target = bearing(p, ahead);
      // Smooth the heading so corners swing instead of snapping.
      let diff = target - heading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      heading += diff * Math.min(1, dt * 2.2);
      target = heading;
      // Stay high enough that the map tiles under the camera are coarse ones that load in time.
      const range = Math.max(450, Math.min(2200, speed * 6));
      viewer.camera.lookAt(
        Cartesian3.fromDegrees(p[0], p[1], 3),
        new HeadingPitchRange(target, CesiumMath.toRadians(-34), range)
      );
      viewer.scene.requestRender();
      if (travelled >= total) stopFlying();
    };
    // Coarser tiles while flying keep the picture filled in at speed; restored when the flight ends.
    const oldSse = viewer.scene.globe.maximumScreenSpaceError;
    viewer.scene.globe.maximumScreenSpaceError = Math.max(oldSse, 6);
    stopFly = () => {
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      viewer.scene.globe.maximumScreenSpaceError = oldSse;
    };
    flyRaf = requestAnimationFrame(frame);
  }

  function startPicking(which: "A" | "B"): void {
    picking = which;
    setHint(`Click the map to place point ${which}.`);
    (which === "A" ? aBtn : bBtn)?.classList.add("is-picking");
    viewer.scene.canvas.style.cursor = "crosshair";
  }

  function endPicking(): void {
    picking = null;
    aBtn?.classList.remove("is-picking");
    bBtn?.classList.remove("is-picking");
    viewer.scene.canvas.style.cursor = "";
  }

  function refreshButtons(): void {
    if (aBtn) aBtn.textContent = `A · ${coordText(a)}`;
    if (bBtn) bBtn.textContent = `B · ${coordText(b)}`;
  }

  function pickLonLat(pos: Cartesian2): [number, number] | null {
    const scene = viewer.scene;
    let world: Cartesian3 | undefined;
    if (scene.pickPositionSupported) {
      try {
        world = scene.pickPosition(pos);
      } catch {
        /* fall through to the ellipsoid */
      }
    }
    world ??= viewer.camera.pickEllipsoid(pos, scene.globe.ellipsoid) ?? undefined;
    if (!world) return null;
    const c = Cartographic.fromCartesian(world);
    return [CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)];
  }

  // ----- Search boxes in the top bar -----

  let searchWired = false;
  let suggestTimer: number | null = null;
  let suggestSeq = 0;
  let activeField: "A" | "B" | null = null;

  const q = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

  function setFieldText(which: "A" | "B", text: string): void {
    const input = q<HTMLInputElement>(which === "A" ? "dir-from" : "dir-to");
    if (input) input.value = text;
  }

  function hideSuggest(): void {
    q("dir-suggest")?.classList.add("hidden");
  }

  /** Accepts "lat, lon" typed straight into a box. */
  function parseCoords(text: string): [number, number] | null {
    const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
    if (!m) return null;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
  }

  function placePoint(which: "A" | "B", lon: number, lat: number, label: string): void {
    if (which === "A") a = [lon, lat];
    else b = [lon, lat];
    setFieldText(which, label);
    endPicking();
    refreshButtons();
    drawPoints();
    hideSuggest();
    if (a && b) void compute();
    else {
      viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, 4000), duration: 1.6 });
      setHint(which === "A" ? "Now enter or click the destination (B)." : "Now enter or click the start (A).");
    }
  }

  async function suggest(which: "A" | "B", text: string): Promise<void> {
    const box = q("dir-suggest");
    const seq = ++suggestSeq;
    if (!box) return;
    const coords = parseCoords(text);
    if (coords) {
      renderSuggest(which, [{ label: `Use coordinates ${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`, lat: coords[1], lon: coords[0] }]);
      return;
    }
    if (text.trim().length === 0) {
      renderSuggest(which, [], true);
      return;
    }
    if (text.trim().length < 3) {
      hideSuggest();
      return;
    }
    try {
      // The ground point under the camera ranks nearby addresses and places first.
      const here = viewer.camera.positionCartographic;
      const near = here ? `&lat=${(here.latitude * 180 / Math.PI).toFixed(3)}&lon=${(here.longitude * 180 / Math.PI).toFixed(3)}` : "";
      const res = await fetch(`/api/layers/places?q=${encodeURIComponent(text.trim())}${near}`);
      if (!res.ok || seq !== suggestSeq) return;
      const j = (await res.json()) as { results: Array<{ label: string; lat: number; lon: number }> };
      if (seq !== suggestSeq || activeField !== which) return;
      renderSuggest(which, j.results);
    } catch {
      /* typing continues; try again on the next keystroke */
    }
  }

  function renderSuggest(which: "A" | "B", results: Array<{ label: string; lat: number; lon: number }>, empty = false): void {
    const box = q("dir-suggest");
    if (!box) return;
    box.textContent = "";
    // "My location" is always on offer, and is the only row while the box is still empty.
    const me = el("button", "dir-suggest-row", "My location");
    me.type = "button";
    me.append(el("small", undefined, "Use this device's position"));
    me.addEventListener("mousedown", (ev) => ev.preventDefault());
    me.addEventListener("click", () => {
      hideSuggest();
      document.dispatchEvent(new CustomEvent("orbit:use-my-location", { detail: { which } }));
    });
    box.append(me);
    if (!results.length && !empty) {
      box.append(el("div", "dir-suggest-empty", "No matching places — try adding a city or state."));
    }
    for (const r of results) {
      const b = el("button", "dir-suggest-row", r.label);
      b.type = "button";
      b.setAttribute("role", "option");
      b.addEventListener("mousedown", (ev) => ev.preventDefault()); // keep focus so the click lands
      b.addEventListener("click", () => placePoint(which, r.lon, r.lat, r.label.startsWith("Use coordinates") ? `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}` : r.label));
      box.append(b);
    }
    // Sit under the field being typed in.
    const form = q("dir-search");
    const input = q(which === "A" ? "dir-from" : "dir-to");
    if (form && input) {
      const fr = form.getBoundingClientRect();
      const ir = input.parentElement!.getBoundingClientRect();
      box.style.left = `${Math.max(0, ir.left - fr.left)}px`;
      box.style.width = `${Math.max(260, ir.width)}px`;
    }
    box.classList.remove("hidden");
  }

  function wireSearch(): void {
    const form = q<HTMLFormElement>("dir-search");
    if (!form || searchWired) return;
    searchWired = true;
    for (const [id, which] of [["dir-from", "A"], ["dir-to", "B"]] as const) {
      const input = q<HTMLInputElement>(id)!;
      input.addEventListener("focus", () => {
        activeField = which;
        if (input.value.trim().length === 0) void suggest(which, "");
        else if (input.value.trim().length >= 3 && !(which === "A" ? a : b)) void suggest(which, input.value);
      });
      input.addEventListener("input", () => {
        activeField = which;
        if (which === "A") a = null;
        else b = null;
        if (suggestTimer != null) window.clearTimeout(suggestTimer);
        suggestTimer = window.setTimeout(() => void suggest(which, input.value), 350);
      });
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") hideSuggest();
        if (ev.key === "ArrowDown") {
          (q("dir-suggest")?.querySelector(".dir-suggest-row") as HTMLElement | null)?.focus();
          ev.preventDefault();
        }
      });
    }
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      // Enter takes the top suggestion for the field being typed in.
      (q("dir-suggest")?.querySelector(".dir-suggest-row") as HTMLElement | null)?.click();
    });
    q("dir-swap")?.addEventListener("click", () => {
      const from = q<HTMLInputElement>("dir-from");
      const to = q<HTMLInputElement>("dir-to");
      if (from && to) [from.value, to.value] = [to.value, from.value];
      [a, b] = [b, a];
      refreshButtons();
      drawPoints();
      void compute();
    });
    for (const btn of form.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      btn.addEventListener("click", () => {
        profile = btn.dataset.mode as Profile;
        for (const sib of form.querySelectorAll("[data-mode]")) sib.classList.toggle("active", sib === btn);
        void compute();
      });
    }
    const avoidBtn = q<HTMLButtonElement>("dir-avoid");
    avoidBtn?.addEventListener("click", () => {
      avoidAlpr = !avoidAlpr;
      avoidBtn.classList.toggle("active", avoidAlpr);
      avoidBtn.setAttribute("aria-pressed", String(avoidAlpr));
      void compute();
    });
    document.addEventListener("click", (ev) => {
      if (!form.contains(ev.target as Node)) hideSuggest();
    });
  }

  function showSearch(on: boolean): void {
    q("dir-search")?.classList.toggle("hidden", !on);
    if (on) {
      wireSearch();
      window.setTimeout(() => q<HTMLInputElement>("dir-from")?.focus(), 50);
    } else {
      hideSuggest();
      setFieldText("A", "");
      setFieldText("B", "");
    }
    document.querySelector(".command-header")?.classList.toggle("has-dir-search", on);
    // The general place search shrinks to a magnifier while the From/To boxes use the bar.
    const loc = document.getElementById("loc-search");
    loc?.classList.toggle("compact", on);
    loc?.classList.remove("open");
  }

  function buildPanel(): void {
    const extras = document.getElementById("layer-extras");
    if (!extras || panel) return;
    panel = el("div", "layer-panel dir-panel");
    panel.id = "directions-panel";
    panel.append(el("div", "layer-panel-title", "Directions"));
    panel.append(el("p", "layer-panel-note", "Type addresses in the top bar, or pick points on the map:"));

    aBtn = el("button", "layer-card-btn dir-point");
    aBtn.type = "button";
    aBtn.addEventListener("click", () => startPicking("A"));
    bBtn = el("button", "layer-card-btn dir-point");
    bBtn.type = "button";
    bBtn.addEventListener("click", () => startPicking("B"));
    const swap = el("button", "layer-card-btn", "Swap");
    swap.type = "button";
    swap.addEventListener("click", () => q("dir-swap")?.click());
    const clear = el("button", "layer-card-btn", "Clear");
    clear.type = "button";
    clear.addEventListener("click", () => {
      a = b = null;
      endPicking();
      clearRoute();
      setFieldText("A", "");
      setFieldText("B", "");
      refreshButtons();
      drawPoints();
      setHint("Type a start and destination in the top bar, or pick them on the map.");
    });
    const pointRow = el("div", "layer-panel-row dir-points");
    pointRow.append(aBtn, bBtn);
    const toolRow = el("div", "layer-panel-row");
    flyBtn = el("button", "layer-card-btn primary", "Fly the route");
    flyBtn.type = "button";
    flyBtn.disabled = true;
    flyBtn.addEventListener("click", flyRoute);
    toolRow.append(flyBtn, swap, clear);

    summary = el("div", "radio-now");
    avoidNote = el("p", "layer-panel-note dir-avoid-note");
    hint = el("p", "layer-panel-note", "Type a start and destination in the top bar, or pick them on the map.");
    stepsEl = el("div", "dir-steps");
    panel.append(pointRow, summary, avoidNote, toolRow, hint, stepsEl, el("p", "layer-panel-note", "Routes: OpenStreetMap data via FOSSGIS OSRM."));
    extras.append(panel);
    refreshButtons();
  }

  // Other parts of the app (the store search, "my location") can set a start or destination: they send this event.
  document.addEventListener("orbit:directions-point", (ev) => {
    const d = (ev as CustomEvent<{ which: "A" | "B"; lat: number; lon: number; label: string }>).detail;
    void (async () => {
      if (!host.isOn("directions")) await host.activate("directions");
      placePoint(d.which, d.lon, d.lat, d.label);
    })();
  });

  host.register({
    id: "directions",
    label: "Directions",
    group: "Utilities",
    hint: "Street-following drive, walk or cycle routes between two points you pick on the map, with turn-by-turn steps and a fly-along.",
    enable() {
      ds.show = true;
      buildPanel();
      showSearch(true);
      handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((e: { position: Cartesian2 }) => {
        if (!picking) return;
        const p = pickLonLat(e.position);
        if (!p) {
          setHint("That spot isn't on the globe — try again.");
          return;
        }
        if (picking === "A") a = p;
        else b = p;
        const done = picking;
        setFieldText(done, `Dropped pin · ${p[1].toFixed(5)}, ${p[0].toFixed(5)}`);
        endPicking();
        refreshButtons();
        drawPoints();
        if (a && b) void compute();
        else setHint(done === "A" ? "Now enter or click the destination (B)." : "Now enter or click the start (A).");
      }, ScreenSpaceEventType.LEFT_CLICK);
      host.setStatus("directions", "Search in the top bar");
    },
    disable() {
      endPicking();
      stopFlying();
      showSearch(false);
      handler?.destroy();
      handler = null;
      ds.show = false;
      ds.entities.removeAll();
      a = b = null;
      route = null;
      panel?.remove();
      panel = aBtn = bBtn = summary = stepsEl = hint = flyBtn = null;
    }
  });
}
