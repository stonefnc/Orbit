/**
 * Builds the Windows app: `npm run build:exe`. Output: exe-out/Orbit-win32-x64/Orbit.exe and a zip of that folder.
 *
 * 1. `npm run build:release`: the client with no keys baked in (it scans its own output for key shapes).
 * 2. The Express server bundled into one file (esbuild), so the app needs no node_modules.
 * 3. A staging folder: client, server, the Electron entry, bundled data, licences and an icon.
 * 4. A second key scan over the staged files, then @electron/packager.
 *
 * No keys are read or copied, nothing is signed, nothing updates itself, and exe-build/ and exe-out/ are git-ignored.
 */
import { build } from "esbuild";
import { packager } from "@electron/packager";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const STAGE = "exe-build/app";
const OUT = "exe-out";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

function run(cmd) {
  const r = spawnSync(cmd, { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`\n"${cmd}" failed.`);
    process.exit(r.status ?? 1);
  }
}

// 1. Client, built with no keys.
run("npm run build:release");
if (!existsSync("dist/index.html")) throw new Error("dist/index.html is missing after the release build");

rmSync("exe-build", { recursive: true, force: true });
mkdirSync(join(STAGE, "server"), { recursive: true });
mkdirSync(join(STAGE, "electron"), { recursive: true });

// 2. The server in one file. `bufferutil` / `utf-8-validate` are optional speed-ups of `ws` that it loads in a try block.
const result = await build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(STAGE, "server", "server.mjs"),
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: "import { createRequire as __orbitCreateRequire } from 'node:module'; const require = __orbitCreateRequire(import.meta.url);" },
  legalComments: "none",
  metafile: true,
  logLevel: "warning"
});

// 3. Licences: every package that went into the server bundle, plus the browser libraries.
function packageDir(name) {
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    return join("node_modules", name);
  }
}
const bundled = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input.replace(/\\/g, "/"));
  if (m) bundled.add(m[1]);
}
const notices = [];
for (const name of [...[...bundled].sort(), ...Object.keys(pkg.dependencies).filter((d) => !bundled.has(d))]) {
  const dir = packageDir(name);
  if (!existsSync(join(dir, "package.json"))) continue;
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f));
  notices.push(
    `${"=".repeat(78)}\n${meta.name} ${meta.version}  (${typeof meta.license === "string" ? meta.license : JSON.stringify(meta.license)})\n${"=".repeat(78)}\n` +
      (file ? readFileSync(join(dir, file), "utf8").trim() : "(no licence file in the package; see its package.json)") +
      "\n"
  );
}
writeFileSync(
  join(STAGE, "THIRD_PARTY_LICENSES.txt"),
  "Orbit includes the following third-party software. Electron's own licences are in LICENSE and LICENSES.chromium.html.\n\n" +
    notices.join("\n")
);

// 4. Everything the app needs at run time.
cpSync("dist", join(STAGE, "dist"), { recursive: true });
cpSync("electron/main.cjs", join(STAGE, "electron", "main.cjs"));
mkdirSync(join(STAGE, "data"), { recursive: true });
cpSync("data/notable-aircraft.json", join(STAGE, "data", "notable-aircraft.json"));
cpSync("DATA_SOURCES.md", join(STAGE, "DATA_SOURCES.md"));
cpSync("LICENSE", join(STAGE, "ORBIT-LICENSE.txt"));
writeFileSync(
  join(STAGE, "package.json"),
  JSON.stringify(
    { name: "orbit", productName: "Orbit", version: pkg.version, description: "A live 3D globe", main: "electron/main.cjs", license: "SEE LICENSE IN ORBIT-LICENSE.txt" },
    null,
    2
  )
);

/** A Windows icon: an .ico can hold PNG images directly, so wrap the project's own PNGs. */
function makeIco(files) {
  const pngs = files.map((f) => ({ data: readFileSync(f), size: Number(/(\d+)/.exec(f.split("/").pop())?.[1] ?? 32) }));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ data, size }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.data)]);
}
writeFileSync(join(STAGE, "icon.ico"), makeIco(["public/icons/icon-192.png", "public/icons/favicon-32.png"]));

// Second key scan, over what is about to be packaged (the client's own scan only covered dist/).
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
    if (statSync(p).isDirectory()) {
      if (p.replace(/\\/g, "/").endsWith("dist/cesium")) continue; // the globe library carries Cesium's own demo token, not ours
      yield* files(p);
    } else yield p;
  }
}
const problems = [];
for (const f of files(STAGE)) {
  if (/(^|[\\/])\.env(\.|$)/.test(f)) problems.push(`${f}: an env file`);
  if (!/\.(m?js|cjs|html|json|css|txt|md)$/i.test(f)) continue;
  const text = readFileSync(f, "utf8");
  for (const { name, re } of PATTERNS) if (re.test(text)) problems.push(`${f}: ${name}`);
}
if (problems.length) {
  console.error("\nKey-shaped text or env files found in the staged app:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`staged app is clean (${bundled.size} bundled server packages, licences listed)`);

// 5. Package. The folder holds Orbit.exe plus the files Electron needs beside it; the zip is the thing to share.
rmSync(OUT, { recursive: true, force: true });
const [appDir] = await packager({
  dir: STAGE,
  out: OUT,
  name: "Orbit",
  platform: "win32",
  arch: "x64",
  electronVersion: require("electron/package.json").version,
  overwrite: true,
  asar: false,
  prune: false,
  icon: join(STAGE, "icon.ico"),
  appCopyright: "Copyright (c) 2026 Orbit project authors",
  win32metadata: { ProductName: "Orbit", FileDescription: "Orbit", InternalName: "Orbit", OriginalFilename: "Orbit.exe" }
});

const zip = join(OUT, "Orbit-win32-x64.zip");
// Windows' own tar writes zip files; arguments are passed as a list so paths need no quoting.
const zipped = spawnSync("tar", ["-a", "-c", "-f", resolve(zip), "-C", resolve(OUT), appDir.split(/[\\/]/).pop()], { stdio: "inherit" });
if (zipped.status !== 0) {
  console.error("Could not write the zip (the app folder itself is fine).");
  process.exit(zipped.status ?? 1);
}

const size = (p) => `${(statSync(p).size / 1048576).toFixed(0)} MB`;
console.log(`\nApp folder: ${resolve(appDir)}\nEXE:        ${resolve(appDir, "Orbit.exe")} (${size(join(appDir, "Orbit.exe"))})\nZip:        ${resolve(zip)} (${size(zip)})`);
