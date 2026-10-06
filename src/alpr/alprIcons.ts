/**
 * Map icons for ALPR cameras, drawn to resemble the real hardware each vendor installs (shape and colour of the
 * housing, solar panel, lens and illuminators). They are stylised depictions of the devices, not vendor logos.
 * Everything is drawn once per vendor/state onto a canvas and cached as a data URL.
 */
export type AlprKind = "flock" | "motorola" | "genetec" | "axis" | "axon" | "leonardo" | "generic";
export type AlprIconState = "normal" | "hover" | "selected";

export function alprKindForVendor(vendor: string | undefined | null): AlprKind {
  const v = (vendor ?? "").toLowerCase();
  if (v.includes("flock")) return "flock";
  if (v.includes("motorola") || v.includes("vigilant") || v.includes("watchguard")) return "motorola";
  if (v.includes("genetec") || v.includes("autovu")) return "genetec";
  if (v.includes("axis")) return "axis";
  if (v.includes("axon")) return "axon";
  if (v.includes("leonardo") || v.includes("elsag")) return "leonardo";
  return "generic";
}

/** Human-readable name for each look (used by the legend). */
export const ALPR_KIND_LABEL: Record<AlprKind, string> = {
  flock: "Flock Safety",
  motorola: "Motorola / Vigilant",
  genetec: "Genetec AutoVu",
  axis: "Axis",
  axon: "Axon",
  leonardo: "Leonardo / ELSAG",
  generic: "Other / unknown"
};

const SIZE = 72;
const cache = new Map<string, string>();

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lens(ctx: Ctx, x: number, y: number, r: number, rim = "#59626e"): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#07090c";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rim;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fill();
}

function pole(ctx: Ctx, color = "#3b4048"): void {
  ctx.fillStyle = color;
  ctx.fillRect(33, 46, 6, 24);
}

const painters: Record<AlprKind, (ctx: Ctx) => void> = {
  // Flock Falcon: slim black camera with a small solar panel angled on top.
  flock(ctx) {
    pole(ctx);
    ctx.fillStyle = "#17191e";
    roundRect(ctx, 14, 24, 44, 22, 5);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#4a5260";
    ctx.stroke();
    // solar panel
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(12, 20);
    ctx.lineTo(60, 20);
    ctx.lineTo(56, 9);
    ctx.lineTo(16, 9);
    ctx.closePath();
    ctx.fillStyle = "#1b3a6e";
    ctx.fill();
    ctx.strokeStyle = "#6f9ad6";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const x = 12 + i * 12;
      ctx.moveTo(x - (i * 1) , 20);
      ctx.lineTo(16 + i * 10, 9);
    }
    ctx.moveTo(14, 14.5);
    ctx.lineTo(58, 14.5);
    ctx.stroke();
    ctx.restore();
    lens(ctx, 36, 36, 6.5);
    ctx.fillStyle = "#f2f4f7";
    ctx.beginPath();
    ctx.arc(51, 29, 1.6, 0, Math.PI * 2);
    ctx.fill();
  },

  // Motorola / Vigilant: grey housing with two infra-red illuminator panels either side of the lens.
  motorola(ctx) {
    pole(ctx, "#4b525c");
    ctx.fillStyle = "#8d95a1";
    roundRect(ctx, 8, 20, 56, 28, 5);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#566070";
    ctx.stroke();
    ctx.fillStyle = "#1b6fe0";
    ctx.fillRect(10, 20, 52, 4);
    for (const x of [12, 46]) {
      ctx.fillStyle = "#4a1a20";
      roundRect(ctx, x, 28, 14, 14, 2);
      ctx.fill();
      ctx.fillStyle = "#d2434f";
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ctx.fillRect(x + 2.2 + i * 4, 30.2 + j * 4, 2, 2);
    }
    lens(ctx, 36, 35, 7);
  },

  // Genetec AutoVu: dark bullet camera with a sun-shield and an orange band.
  genetec(ctx) {
    pole(ctx, "#434a54");
    ctx.fillStyle = "#3a4857";
    roundRect(ctx, 8, 26, 50, 18, 9);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#1f2832";
    ctx.stroke();
    ctx.fillStyle = "#f28b21";
    ctx.fillRect(38, 26, 5, 18);
    ctx.fillStyle = "#56677a";
    roundRect(ctx, 10, 22, 36, 5, 2.5);
    ctx.fill();
    lens(ctx, 52, 35, 8, "#7d8c9c");
  },

  // Axis: light grey-white bullet with a yellow accent.
  axis(ctx) {
    pole(ctx, "#5b626c");
    ctx.fillStyle = "#dde2e8";
    roundRect(ctx, 10, 26, 48, 18, 9);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#8d96a3";
    ctx.stroke();
    ctx.fillStyle = "#ffcc33";
    ctx.fillRect(14, 31, 8, 8);
    lens(ctx, 50, 35, 7, "#9aa3af");
  },

  // Axon: black housing with the brand's yellow bar.
  axon(ctx) {
    pole(ctx);
    ctx.fillStyle = "#16171a";
    roundRect(ctx, 12, 22, 48, 26, 6);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#4a4d55";
    ctx.stroke();
    ctx.fillStyle = "#ffc20e";
    ctx.fillRect(14, 22, 44, 5);
    lens(ctx, 36, 37, 7);
  },

  // Leonardo / ELSAG: grey box with a square infra-red LED array beside the lens.
  leonardo(ctx) {
    pole(ctx, "#4d535c");
    ctx.fillStyle = "#a7acb4";
    roundRect(ctx, 10, 20, 52, 28, 4);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#646b76";
    ctx.stroke();
    ctx.fillStyle = "#3b1418";
    roundRect(ctx, 14, 25, 20, 18, 2);
    ctx.fill();
    ctx.fillStyle = "#e0505a";
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) ctx.fillRect(16.5 + i * 4.5, 27.5 + j * 5, 2.4, 2.8);
    lens(ctx, 48, 34, 7);
  },

  // Unknown vendor: the original gold camera glyph.
  generic(ctx) {
    ctx.beginPath();
    ctx.arc(36, 30, 19, 0, Math.PI * 2);
    ctx.fillStyle = "#c9a227";
    ctx.fill();
    ctx.strokeStyle = "#3d2f0a";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(36, 30, 8.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(40,32,10,0.55)";
    ctx.fill();
    ctx.fillStyle = "#3d2f0a";
    ctx.fillRect(30, 49, 12, 14);
  }
};

export function alprIconUri(kind: AlprKind, state: AlprIconState = "normal"): string {
  const key = `${kind}|${state}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (state !== "normal") {
    // Soft halo so hovered/selected cameras stand out from a crowd of identical ones.
    const g = ctx.createRadialGradient(36, 34, 8, 36, 34, 36);
    g.addColorStop(0, state === "selected" ? "rgba(255, 232, 168, 0.95)" : "rgba(255, 232, 168, 0.6)");
    g.addColorStop(1, "rgba(255, 232, 168, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  painters[kind](ctx);
  const uri = canvas.toDataURL("image/png");
  cache.set(key, uri);
  return uri;
}
