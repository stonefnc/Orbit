/** Live observational network glyph — amber lens + signal arcs. */
let earthcamBillboardUri: string | undefined;

export function getEarthcamBillboardIconUri(): string {
  if (earthcamBillboardUri) return earthcamBillboardUri;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    earthcamBillboardUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    return earthcamBillboardUri;
  }
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = "rgba(255, 120, 48, 0.55)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(32, 34, 14 + i * 6, -2.4, 0.4);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(32, 34, 16, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1208";
  ctx.fill();
  ctx.strokeStyle = "#ff9a3c";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(32, 34, 9, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(28, 30, 1, 32, 34, 9);
  g.addColorStop(0, "#ffd080");
  g.addColorStop(0.45, "#ff6a1a");
  g.addColorStop(1, "#8a2800");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = "rgba(255, 220, 160, 0.9)";
  ctx.beginPath();
  ctx.arc(28, 30, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff3b1a";
  ctx.beginPath();
  ctx.arc(44, 18, 4, 0, Math.PI * 2);
  ctx.fill();
  earthcamBillboardUri = canvas.toDataURL("image/png");
  return earthcamBillboardUri;
}
