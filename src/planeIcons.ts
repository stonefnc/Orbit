import type { PlaneTrafficKind } from "./planeTrafficClass";

/**
 * Map icons for aircraft: one clean silhouette per aircraft (nose pointing up), tinted by traffic class and shaped
 * by aircraft type. Drawn once per shape/color/state onto a canvas and cached as data URLs, so ~1,000 aircraft share
 * a handful of images instead of each carrying a bitmap.
 */
export type PlaneShape = "jet" | "prop" | "heli" | "fighter";
export type PlaneIconState = "normal" | "hover" | "selected" | "notable";

// All paths are drawn in a 100 × 100 box with the nose at the top.
const PATHS: Record<PlaneShape, string> = {
  // Swept-wing airliner / business jet
  jet:
    "M50 3 C54.5 3 57 10 57 22 L57 40 L95 62 L95 69 L57 58 L57 80 L69 90 L69 95 L50 90 L31 95 L31 90 L43 80 L43 58 L5 69 L5 62 L43 40 L43 22 C43 10 45.5 3 50 3 Z",
  // Light single/twin prop: straight wing, small tailplane, spinner
  prop:
    "M50 5 C52.5 5 54 8 54 14 L54 36 L94 38 L94 47 L54 47 L54 78 L72 83 L72 90 L54 88 L52.5 95 L47.5 95 L46 88 L28 90 L28 83 L46 78 L46 47 L6 47 L6 38 L46 36 L46 14 C46 8 47.5 5 50 5 Z",
  // Fighter / trainer: delta wing, twin tail fins
  fighter:
    "M50 2 C52 2 54 8 54 16 L55 30 L93 76 L93 84 L56 74 L55 86 L63 96 L37 96 L45 86 L44 74 L7 84 L7 76 L45 30 L46 16 C46 8 48 2 50 2 Z",
  // Helicopter body + tail boom; the rotor is drawn separately as a disc
  heli:
    "M50 20 C58 20 63 28 63 40 C63 52 59 60 55 66 L55 86 L62 93 L62 98 L38 98 L38 93 L45 86 L45 66 C41 60 37 52 37 40 C37 28 42 20 50 20 Z"
};

const SIZE = 128;
const OUTLINE = "rgba(6, 10, 18, 0.96)";
const cache = new Map<string, string>();

/** A four-pointed sparkle centred at (x, y) with the given radius. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(255, 220, 140, 1)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 0.12, -r * 0.12, r, 0);
  ctx.quadraticCurveTo(r * 0.12, r * 0.12, 0, r);
  ctx.quadraticCurveTo(-r * 0.12, r * 0.12, -r, 0);
  ctx.quadraticCurveTo(-r * 0.12, -r * 0.12, 0, -r);
  ctx.fill();
  ctx.restore();
}

// Sparkle positions (in the 100-unit box) for each animation frame; sizes pulse so the halo twinkles.
const SPARKLES: Array<Array<[number, number, number, number]>> = [
  [[14, 20, 9, 1], [86, 30, 6, 0.7], [78, 86, 8, 0.9], [20, 80, 5, 0.6]],
  [[16, 24, 6, 0.7], [84, 24, 9, 1], [82, 82, 5, 0.6], [18, 84, 8, 0.9]],
  [[10, 28, 5, 0.6], [90, 34, 8, 0.9], [74, 90, 6, 0.7], [24, 76, 9, 1]]
];

function draw(shape: PlaneShape, color: string, state: PlaneIconState, frame: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const k = SIZE / 100;
  ctx.scale(k, k);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (state === "notable") {
    // Warm glow behind the plane, then shrink the plane so the halo and sparkles have room inside the bitmap.
    const glow = ctx.createRadialGradient(50, 50, 8, 50, 50, 50);
    glow.addColorStop(0, "rgba(255, 214, 120, 0.85)");
    glow.addColorStop(0.45, "rgba(255, 140, 200, 0.38)");
    glow.addColorStop(1, "rgba(255, 140, 200, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 100, 100);
    for (const [x, y, r, a] of SPARKLES[frame % SPARKLES.length]!) sparkle(ctx, x, y, r, a);
    ctx.translate(50, 50);
    ctx.scale(0.58, 0.58);
    ctx.translate(-50, -50);
  }
  const path = new Path2D(PATHS[shape]);

  if (state === "selected") {
    // Soft white halo so the selected aircraft is unmistakable at any zoom.
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.95)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#fff";
    ctx.fill(path);
    ctx.restore();
  }

  if (shape === "heli") {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(50, 42, 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(50, 42, 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(14, 18);
    ctx.lineTo(86, 66);
    ctx.moveTo(86, 18);
    ctx.lineTo(14, 66);
    ctx.stroke();
    ctx.restore();
  }

  // Dark outline first so the icon reads on bright imagery and on dark ocean alike.
  ctx.strokeStyle = state === "hover" ? "rgba(255,255,255,0.95)" : OUTLINE;
  ctx.lineWidth = state === "normal" ? 5 : 6;
  ctx.stroke(path);
  ctx.fillStyle = color;
  ctx.fill(path);
  // A thin light edge keeps the silhouette crisp.
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.2;
  ctx.stroke(path);
  return canvas.toDataURL("image/png");
}

export function planeIconUrl(
  shape: PlaneShape,
  colorCss: string,
  state: PlaneIconState = "normal",
  frame = 0
): string {
  const key = `${shape}|${colorCss}|${state}|${state === "notable" ? frame % 3 : 0}`;
  let url = cache.get(key);
  if (url === undefined) {
    url = draw(shape, colorCss, state, frame);
    cache.set(key, url);
  }
  return url;
}

const HELI_TYPE = /^(H\d|EC\d|AS3|AS5|B06|B407|B412|B429|B47|R22|R44|R66|S76|S92|S61|A109|A119|A139|A189|AW\d|UH\d|CH\d|AH\d|HH\d|MH\d|OH\d|SH\d|EH\d|NH9|KMAX|MI\d|KA\d|BK117|BO10|MD52|MD60|MD90|EXEC|ROT)/;
const FIGHTER_TYPE = /^(F\d{1,2}[A-Z]?$|FA\d|EF\d|TORN|T38|T6|T45|T7|A10|HAWK|TEX2|M346|L39|F5|F4|J\d|MIG|SU\d|RFL|M2K|GR4|GR7|AV8|HAR|PC21|PC9)/;

export function planeShapeFor(
  ac: { category?: string | null; aircraftType?: string | null },
  kind: PlaneTrafficKind
): PlaneShape {
  const cat = (ac.category ?? "").toUpperCase();
  const type = (ac.aircraftType ?? "").toUpperCase().replace(/[-\s]/g, "");
  if (cat === "A7" || HELI_TYPE.test(type)) return "heli";
  if (kind === "military") {
    if (FIGHTER_TYPE.test(type) || cat === "A6") return "fighter";
    return "jet"; // transports, tankers, bombers
  }
  if (kind === "other") {
    // Light aircraft are straight-winged; anything bigger that landed in "other" still flies like a jet.
    if (cat === "A3" || cat === "A4" || cat === "A5") return "jet";
    return "prop";
  }
  return "jet";
}
