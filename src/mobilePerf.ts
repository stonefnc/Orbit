import { Cartesian3, type Viewer } from "cesium";

/**
 * Phones and tablets have the pixel density of a desktop monitor but a fraction of its graphics power. Orbit therefore
 * draws a phone in two qualities and switches between them automatically:
 *
 *  - at rest (nothing is moving): as sharp as it gets — a high render resolution, edge smoothing, fine terrain
 *    imagery and detailed 3D tiles. The map only redraws when something changes, so this costs almost nothing;
 *  - while the finger is moving the globe: a lighter picture so panning and pinching stay smooth. It sharpens again a
 *    moment after you let go.
 *
 * A desktop is never touched. Everything stays on the map; only how finely it is drawn changes.
 */
/**
 * A touch device (the main pointer is a finger), not a narrow window: a desktop browser squeezed below 720 px keeps the
 * desktop zoom speed and render quality (owner's call, 2026-10-04). The phone *layout* is separate (CSS max-width).
 */
export const PHONE_QUERY = "(pointer: coarse)";
const QUERY = PHONE_QUERY;

export function isPhoneClass(): boolean {
  return window.matchMedia(QUERY).matches;
}

/**
 * The phone's quality presets (the owner picks one in the Map sheet). `rest` / `moving` are device pixels drawn per CSS
 * pixel, capped at the screen's own ratio; `sse` is the terrain/imagery detail error (lower = finer).
 */
export type PhoneQuality = "sharp" | "balanced" | "smooth";
export const PHONE_QUALITY_LABEL: Record<PhoneQuality, string> = { sharp: "Sharp", balanced: "Balanced", smooth: "Smooth" };
export const PHONE_QUALITY_NOTE: Record<PhoneQuality, string> = {
  sharp: "Full detail when still (up to 2 pixels per point); light while you move.",
  balanced: "1.5 pixels per point when still, a little lighter while you move.",
  smooth: "Lightest: smoothest panning on an older phone, softer picture."
};
const PRESETS: Record<PhoneQuality, { rest: number; moving: number; sseRest: number; sseMoving: number }> = {
  sharp: { rest: 2, moving: 1, sseRest: 1.5, sseMoving: 3.5 },
  balanced: { rest: 1.5, moving: 0.75, sseRest: 2, sseMoving: 4 },
  smooth: { rest: 1, moving: 0.5, sseRest: 3, sseMoving: 5 }
};
const QUALITY_KEY = "orbit-phone-quality";

export function getPhoneQuality(): PhoneQuality {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v === "sharp" || v === "balanced" || v === "smooth") return v;
  } catch {
    /* private mode */
  }
  return "sharp";
}

let quality: PhoneQuality = getPhoneQuality();
let reapply: (() => void) | null = null;

/** Switches the phone preset now and remembers it. No effect on a desktop. */
export function setPhoneQuality(next: PhoneQuality): void {
  quality = next;
  try {
    localStorage.setItem(QUALITY_KEY, next);
  } catch {
    /* the choice just won't be remembered */
  }
  reapply?.();
}

let interacting = false;
const listeners = new Set<() => void>();

/** True while the camera is being moved (and for a moment after). */
export function isInteracting(): boolean {
  return interacting;
}

/** Runs `cb` whenever the phone quality level switches (so 3D tiles can follow it). */
export function onQualityChange(cb: () => void): void {
  listeners.add(cb);
}

/**
 * Multiplier for `viewer.resolutionScale` for the current quality level. On a phone the viewer is switched to
 * `useBrowserRecommendedResolution = false`, where Cesium's pixel ratio is `devicePixelRatio * resolutionScale`, so the
 * scale is the wanted pixels-per-point divided by the device ratio (never above 1: no more pixels than the screen has).
 */
export function baseResolutionScale(): number {
  if (!isPhoneClass()) return 1;
  const dpr = window.devicePixelRatio || 1;
  const p = PRESETS[quality];
  return Math.min(1, (interacting ? p.moving : p.rest) / dpr);
}

/** How many satellite dots a phone draws at once (a desktop draws them all). */
export const PHONE_SATELLITE_BUDGET = 3000;

export function applyPhoneRenderBudget(viewer: Viewer): void {
  const scene = viewer.scene;
  const camera = viewer.camera;
  const desktop = {
    msaa: scene.msaaSamples,
    fxaa: scene.postProcessStages.fxaa.enabled,
    sse: scene.globe.maximumScreenSpaceError,
    atmosphere: scene.globe.showGroundAtmosphere
  };

  const apply = (): void => {
    const phone = isPhoneClass();
    // Cesium's default draws at CSS pixels and ignores the screen's pixel ratio, which made phones look pixelated.
    // A phone draws at device pixels (scaled by baseResolutionScale); a desktop keeps Cesium's default.
    viewer.useBrowserRecommendedResolution = !phone;
    viewer.resolutionScale = baseResolutionScale();
    // Multisampling multiplies the cost of every pixel, so a phone uses the cheaper FXAA edge smoothing instead,
    // and only while still.
    scene.msaaSamples = phone ? 1 : desktop.msaa;
    scene.postProcessStages.fxaa.enabled = phone ? !interacting : desktop.fxaa;
    // Terrain and imagery detail: finer than Cesium's default at rest, coarser while moving.
    const p = PRESETS[quality];
    scene.globe.maximumScreenSpaceError = phone ? (interacting ? p.sseMoving : p.sseRest) : desktop.sse;
    scene.globe.showGroundAtmosphere = phone ? false : desktop.atmosphere;
    for (const cb of listeners) cb();
    scene.requestRender();
  };
  reapply = apply;
  apply();
  window.matchMedia(QUERY).addEventListener("change", apply);

  // Cesium only reports "the camera stopped" when another frame happens to be drawn, and this app draws frames only
  // when something changes, so that event can be missed. Instead, once the camera starts moving we look at it a few
  // times a second and drop back to the sharp picture as soon as it has held still.
  let watch = 0;
  const lastPos = new Cartesian3();
  const lastDir = new Cartesian3();
  const startWatching = (): void => {
    if (watch) return;
    Cartesian3.clone(camera.positionWC, lastPos);
    Cartesian3.clone(camera.directionWC, lastDir);
    let still = 0;
    watch = window.setInterval(() => {
      const height = Math.max(1, camera.positionCartographic.height);
      const moved =
        Cartesian3.distance(camera.positionWC, lastPos) > height * 2e-4 ||
        Cartesian3.distance(camera.directionWC, lastDir) > 2e-4;
      Cartesian3.clone(camera.positionWC, lastPos);
      Cartesian3.clone(camera.directionWC, lastDir);
      still = moved ? 0 : still + 1;
      if (still >= 2) {
        window.clearInterval(watch);
        watch = 0;
        interacting = false;
        apply();
      }
    }, 200);
  };
  camera.moveStart.addEventListener(() => {
    if (!isPhoneClass()) return;
    if (!interacting) {
      interacting = true;
      apply();
    }
    startWatching();
  });
}