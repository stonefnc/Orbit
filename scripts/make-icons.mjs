/**
 * Makes the app icons (PWA, home screen, tab icon) from public/orbit-logo.webp: `node scripts/make-icons.mjs`.
 * The logo is transparent with a dark globe, so each icon is the logo centred on a deep-blue radial backdrop.
 * Output: public/icons/*.png. Uses the Chromium that Playwright installs, so no image library is needed.
 * Re-run only when the logo changes; the PNGs are committed.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "public/icons";
/** name, pixel size, share of the icon the logo fills (maskable icons keep to the inner 80 % safe zone). */
const ICONS = [
  ["icon-192.png", 192, 0.86],
  ["icon-512.png", 512, 0.86],
  ["icon-maskable-512.png", 512, 0.62],
  ["apple-touch-icon.png", 180, 0.8],
  ["favicon-32.png", 32, 0.96]
];

mkdirSync(OUT, { recursive: true });
const logo = readFileSync("public/orbit-logo.webp").toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();

for (const [name, size, share] of ICONS) {
  const dataUrl = await page.evaluate(
    async ({ data, size, share }) => {
      const img = new Image();
      img.src = `data:image/webp;base64,${data}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const x = c.getContext("2d");
      const g = x.createRadialGradient(size * 0.5, size * 0.45, size * 0.05, size * 0.5, size * 0.5, size * 0.75);
      g.addColorStop(0, "#1d4a7c");
      g.addColorStop(1, "#050c18");
      x.fillStyle = g;
      x.fillRect(0, 0, size, size);
      x.imageSmoothingQuality = "high";
      const d = size * share;
      x.drawImage(img, (size - d) / 2, (size - d) / 2, d, d);
      return c.toDataURL("image/png");
    },
    { data: logo, size, share }
  );
  writeFileSync(join(OUT, name), Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`${name} ${size}x${size}`);
}
await browser.close();
