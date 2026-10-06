/**
 * A release build with no keys baked in: `npm run build:release`.
 *
 * Vite copies every `VITE_*` value (from `.env.local` and from the shell) into the browser bundle, and the owner's own
 * Cesium ion token is one of them. This script builds with ORBIT_ENV_DIR pointing at an empty folder (so no env file is
 * read), removes every `VITE_*` and key variable from the build's environment, runs the normal `npm run build`, then scans
 * the app's own output (dist/index.html and dist/assets) for token-shaped strings and fails if it finds any. The globe
 * library under dist/cesium is not scanned: it carries Cesium's own built-in demo token, which is not ours.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SECRET_NAMES = /^(VITE_|AISSTREAM_|OPENSKY_|ADSBX_|KEEPTRACK_|FIRMS_|AVIATIONSTACK_|N2YO_)/;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET_NAMES.test(k)));
env.ORBIT_ENV_DIR = mkdtempSync(join(tmpdir(), "orbit-release-env-"));

const build = spawnSync("npm run build", { stdio: "inherit", shell: true, env });
if (build.status !== 0) process.exit(build.status ?? 1);

/** Shapes a real credential takes: a JWT (Cesium ion tokens are), or a key/secret/token assignment with a long value. */
const PATTERNS = [
  { name: "JWT-shaped token", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    name: "key/secret/token assignment",
    re: /(?:api[_-]?key|access[_-]?token|client[_-]?secret|map[_-]?key)["']?\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{20,}["']/i
  }
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const targets = ["dist/index.html", ...[...files("dist/assets")]];
const hits = [];
for (const file of targets) {
  if (!/\.(js|css|html|json|webmanifest)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const { name, re } of PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push(`${file}: ${name} (${m[0].slice(0, 12)}...)`);
  }
}
if (hits.length) {
  console.error("\nRelease build REFUSED: token-shaped strings in the output:\n  " + hits.join("\n  "));
  process.exit(1);
}
console.log(`\nRelease build OK: ${targets.length} files scanned, no token-shaped strings in dist/index.html or dist/assets.`);
