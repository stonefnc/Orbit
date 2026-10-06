import { Router, type Request } from "express";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_ROOT, ENV_DIR } from "../lib/paths";

/**
 * Lets the person running Orbit enter provider keys from the page instead of editing `.env.local` by hand.
 *
 * These keys are secrets, so this is deliberately strict:
 *  - it only works for requests that come from the computer the server runs on (not other devices on the network);
 *  - cross-site requests are refused (the page's origin must be localhost) and a custom header is required;
 *  - only a fixed list of key names is accepted, with a strict character set (no way to inject other settings);
 *  - values are never sent back to the page, only whether each key is set and its last four characters.
 */
const ROOT = APP_ROOT;
const ENV_FILE = join(ENV_DIR, ".env.local");

export const SERVER_KEYS = [
  "AISSTREAM_API_KEY",
  "OPENSKY_CLIENT_ID",
  "OPENSKY_CLIENT_SECRET",
  "ADSBX_API_KEY",
  "KEEPTRACK_API_KEY",
  "FIRMS_MAP_KEY"
] as const;
type KeyName = (typeof SERVER_KEYS)[number];

const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const SAFE_VALUE = /^[A-Za-z0-9._~+\/=:@-]{4,300}$/;

/** True when the request really comes from this computer. The dev proxy appends the caller's address to X-Forwarded-For. */
export function fromThisComputer(req: Request): boolean {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // The last entry is the one the nearest proxy added itself; earlier ones could be written by the caller.
  const addr = forwarded.length ? forwarded[forwarded.length - 1]! : (req.socket.remoteAddress ?? "");
  if (!LOOPBACK.test(addr)) return false;
  const origin = req.headers.origin;
  return !origin || LOCAL_ORIGIN.test(String(origin));
}

function hint(name: KeyName): { set: boolean; hint: string } {
  const v = (process.env[name] ?? "").trim();
  return { set: v.length > 0, hint: v.length >= 8 ? `••••${v.slice(-4)}` : v ? "••••" : "" };
}

/** Rewrites the given KEY=value lines in the env file, keeping everything else. `null` removes a key. */
export function upsertEnv(text: string, updates: Partial<Record<KeyName, string | null>>): string {
  const lines = text.length ? text.split(/\r?\n/) : [];
  // A file that ends with a newline splits into a trailing empty entry; drop it so new keys don't follow a blank line.
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const [name, value] of Object.entries(updates) as Array<[KeyName, string | null]>) {
    const at = lines.findIndex((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
    if (value === null) {
      if (at >= 0) lines.splice(at, 1);
    } else if (at >= 0) lines[at] = `${name}=${value}`;
    else lines.push(`${name}=${value}`);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

export function settingsRouter(): Router {
  const r = Router();

  r.get("/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      canEdit: fromThisComputer(req),
      keys: Object.fromEntries(SERVER_KEYS.map((k) => [k, hint(k)]))
    });
  });

  r.post("/keys", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!fromThisComputer(req) || req.headers["x-orbit-settings"] !== "1") {
      res.status(403).json({ error: "Keys can only be changed from the computer that runs Orbit." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Partial<Record<KeyName, string | null>> = {};
    for (const name of SERVER_KEYS) {
      if (!(name in body)) continue;
      const raw = body[name];
      if (raw === null || raw === "") {
        updates[name] = null; // clear
        continue;
      }
      if (typeof raw !== "string" || !SAFE_VALUE.test(raw.trim())) {
        res.status(400).json({ error: `${name} looks wrong (letters, numbers and . _ - + / = : @ only, 4–300 characters).` });
        return;
      }
      updates[name] = raw.trim();
    }
    const names = Object.keys(updates) as KeyName[];
    if (!names.length) {
      res.status(400).json({ error: "Nothing to save." });
      return;
    }
    try {
      let current = "";
      try {
        current = await readFile(ENV_FILE, "utf8");
      } catch {
        /* no file yet */
      }
      await writeFile(ENV_FILE, upsertEnv(current, updates), "utf8");
      for (const n of names) {
        const v = updates[n];
        if (v === null || v === undefined) delete process.env[n];
        else process.env[n] = v;
      }
      res.json({ saved: names, status: Object.fromEntries(SERVER_KEYS.map((k) => [k, hint(k)])) });
      // Several providers read their key once at start-up. In development the server restarts itself whenever one of
      // its files changes, so touching one applies the new keys; otherwise they take effect on the next start.
      setTimeout(() => {
        const now = new Date();
        void utimes(join(ROOT, "server", "index.ts"), now, now).catch(() => {});
      }, 400);
    } catch (e) {
      console.warn("[settings] could not save keys:", e instanceof Error ? e.message : e);
      res.status(500).json({ error: "Couldn't write .env.local" });
    }
  });

  return r;
}
