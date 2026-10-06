#!/usr/bin/env node
// `npm run dev:lan:https`: the LAN dev server over HTTPS, so a phone opens a secure page and can share its location.
// Needs a certificate made once with mkcert; until it exists this prints the
// steps instead of starting. The normal `npm run dev` / `dev:lan` are untouched and stay on plain http.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const cert = resolve(process.env.ORBIT_HTTPS_CERT ?? ".certs/orbit.pem");
const key = resolve(process.env.ORBIT_HTTPS_KEY ?? ".certs/orbit-key.pem");

if (!existsSync(cert) || !existsSync(key)) {
  console.error(`No certificate yet (looked for ${cert} and ${key}).

One-time setup, in PowerShell from the Orbit folder:
  winget install FiloSottile.mkcert
  mkcert -install
  New-Item -ItemType Directory -Force .certs
  mkcert -cert-file .certs/orbit.pem -key-file .certs/orbit-key.pem <this PC's Wi-Fi address> localhost 127.0.0.1
then copy mkcert's root certificate (mkcert -CAROOT shows the folder) to the iPhone, install the profile, turn on full trust in
Settings > General > About > Certificate Trust Settings, and run this command again.`);
  process.exit(1);
}

console.log("Starting dev:lan over HTTPS. Open https://<this PC's Wi-Fi address>:5173 on the phone.");
const child = spawn("npm", ["run", "dev:lan"], { stdio: "inherit", shell: true, env: { ...process.env, ORBIT_HTTPS: "1" } });
child.on("exit", (code) => process.exit(code ?? 0));
