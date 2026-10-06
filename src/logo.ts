import type { Viewer } from "cesium";

/**
 * Adaptive logo. The supplied artwork is a dark globe on white, so at start-up it is converted into two
 * transparent versions (a dark one for light backdrops, a white one for dark backdrops) and the page cross-fades
 * between them. The header's `data-tone` attribute follows the same decision, so its text and glass adapt too.
 *
 * What counts as "behind the header" is read straight from the globe canvas (right after Cesium renders, when the
 * drawing buffer is still valid), so it reacts to snow, desert, cloud, ocean and space alike.
 */
type Tone = "light" | "dark"; // tone of the BACKDROP: "dark" backdrop gets the white logo

const LOGO_URL = `${import.meta.env.BASE_URL}orbit-logo.webp`.replace(/\/{2,}/g, "/");
const SIZE = 256;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Builds the dark-ink and white-ink versions: shape from "distance from white", land vs ocean from lightness. */
function buildVariants(img: HTMLImageElement): { ink: string; paper: string } | null {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // The artwork may carry transparency; flatten it onto white so "distance from white" is meaningful.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  let src: ImageData;
  try {
    src = ctx.getImageData(0, 0, SIZE, SIZE);
  } catch {
    return null;
  }
  const dark = ctx.createImageData(SIZE, SIZE);
  const white = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < src.data.length; i += 4) {
    const d = 255 - Math.min(src.data[i]!, src.data[i + 1]!, src.data[i + 2]!);
    const shape = smoothstep(26, 62, d);
    // 1 for land and the ring (lighter than the ocean), 0 for deep ocean.
    const land = d < 60 ? 1 : 1 - smoothstep(110, 215, d);
    // Dark ink (for light backdrops): ocean solid, land and ring lighter.
    dark.data[i] = 29;
    dark.data[i + 1] = 29;
    dark.data[i + 2] = 31;
    dark.data[i + 3] = Math.round(255 * shape * (0.95 - 0.5 * land));
    // White ink (for dark backdrops): land and ring bright, ocean subdued.
    white.data[i] = 255;
    white.data[i + 1] = 255;
    white.data[i + 2] = 255;
    white.data[i + 3] = Math.round(255 * shape * (0.3 + 0.7 * land));
  }
  const out = (data: ImageData): string => {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.putImageData(data, 0, 0);
    return c.toDataURL("image/png");
  };
  return { ink: out(dark), paper: out(white) };
}

export function initAdaptiveLogo(viewer: Viewer, logoEl: HTMLElement, headerEl: HTMLElement): void {
  headerEl.dataset.tone = "dark";
  const img = new Image();
  img.onload = () => {
    const v = buildVariants(img);
    const make = (src: string, cls: string): HTMLImageElement => {
      const el = new Image();
      el.className = `orbit-logo-img ${cls}`;
      el.alt = "";
      el.decoding = "async";
      el.src = src;
      return el;
    };
    // Fall back to the original artwork if the pixels can't be read.
    logoEl.append(
      make(v?.ink ?? LOGO_URL, "for-light"),
      make(v?.paper ?? LOGO_URL, "for-dark")
    );
  };
  img.src = LOGO_URL;

  const probe = document.createElement("canvas");
  probe.width = 8;
  probe.height = 8;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  let tone: Tone = "dark";
  let lastCheck = 0;

  const apply = (next: Tone): void => {
    if (next === tone) return;
    tone = next;
    headerEl.dataset.tone = next;
  };

  // The search box gets its own reading: it sits at the far end of the bar, where the imagery can be a different
  // brightness from the logo's side, so its text follows what is actually behind it.
  let searchTone: Tone = "dark";
  headerEl.dataset.searchTone = "dark";
  const applySearch = (next: Tone): void => {
    if (next === searchTone) return;
    searchTone = next;
    headerEl.dataset.searchTone = next;
  };

  /** Average brightness (0-255) of the globe canvas behind a rectangle, or null if it can't be read. */
  function lumBehind(r: DOMRect): number | null {
    if (!pctx) return null;
    const canvas = viewer.scene.canvas;
    const cr = canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const kx = canvas.width / canvas.clientWidth;
    const ky = canvas.height / canvas.clientHeight;
    pctx.drawImage(canvas, (r.left - cr.left) * kx, (r.top - cr.top) * ky, r.width * kx, Math.max(1, r.height * ky), 0, 0, 8, 8);
    const px = pctx.getImageData(0, 0, 8, 8).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
    return sum / (px.length / 4);
  }
  viewer.scene.postRender.addEventListener(() => {
    // The user's light-bar choice wins over the automatic read of the imagery behind the bar.
    if (document.documentElement.dataset.theme === "light") {
      if (tone !== "light") {
        tone = "light";
        headerEl.dataset.tone = "light";
      }
      if (searchTone !== "light") {
        searchTone = "light";
        headerEl.dataset.searchTone = "light";
      }
      return;
    }
    const now = performance.now();
    if (now - lastCheck < 350 || !pctx) return;
    lastCheck = now;
    try {
      const canvas = viewer.scene.canvas;
      const r = headerEl.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      // If the header sits above the map rather than over it there is nothing to sample: keep the white text.
      if (r.top < cr.top - 1 || r.width < 1) {
        apply("dark");
        applySearch("dark");
        return;
      }
      const lum = lumBehind(r);
      // Hysteresis so it doesn't flicker around the threshold.
      if (lum != null) {
        if (tone === "dark" && lum > 150) apply("light");
        else if (tone === "light" && lum < 105) apply("dark");
      }

      // Whichever search box is showing: the places search, or the Directions fields.
      const places = document.getElementById("loc-search");
      const dirs = document.getElementById("dir-search");
      const target = dirs && !dirs.classList.contains("hidden") ? dirs : places;
      if (target) {
        const sl = lumBehind(target.getBoundingClientRect());
        if (sl != null) {
          if (searchTone === "dark" && sl > 130) applySearch("light");
          else if (searchTone === "light" && sl < 95) applySearch("dark");
        }
      }
    } catch {
      /* canvas unreadable: keep the current tone */
    }
  });}





