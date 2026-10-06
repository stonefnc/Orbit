/**
 * Orbit for Windows: a thin Electron shell around the same server and client as `npm run dev`.
 *
 * It runs the bundled server inside this process, on a loopback port only, and opens a window on it. The server serves
 * the built client itself (ORBIT_STATIC_DIR). Nothing is written to the install folder: keys (`.env.local`) and the
 * server's caches live in the user's app-data folder, so the Keys menu works and keys survive a restart.
 * No auto-update, no telemetry, no code signing.
 */
const { app, BrowserWindow, Menu, session, shell } = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

/** A fixed first choice keeps the page's origin, and so its saved browser settings, the same on every launch. */
const FIRST_PORT = 18787;

const appDir = path.join(__dirname, "..");
let mainWindow = null;
let origin = "";

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function pickPort() {
  for (let port = FIRST_PORT; port < FIRST_PORT + 50; port++) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`No free port between ${FIRST_PORT} and ${FIRST_PORT + 49}`);
}

async function waitForServer(port) {
  const url = `http://127.0.0.1:${port}/health`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("The Orbit server did not start.");
}

/** Keys are read once at start-up by some providers, so a changed key file restarts the app (as `npm run dev` does). */
function restartWhenKeysChange(envDir) {
  let timer = null;
  try {
    fs.watch(envDir, (_event, name) => {
      if (name !== ".env.local") return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 1500);
    });
  } catch {
    /* watching is a convenience; without it keys apply on the next start */
  }
}

function openWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 480,
    minHeight: 480,
    backgroundColor: "#050608",
    title: "Orbit",
    icon: path.join(appDir, "icon.ico"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Links to other sites open in the normal browser; the app window never leaves its own address.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  void mainWindow.loadURL(origin);
}

async function start() {
  const userData = app.getPath("userData");
  const cacheDir = path.join(userData, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const port = await pickPort();
  origin = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    PLANE_API_PORT: String(port),
    PLANE_API_HOST: "127.0.0.1",
    ORBIT_APP_DIR: appDir,
    ORBIT_ENV_DIR: userData,
    ORBIT_CACHE_DIR: cacheDir,
    ORBIT_STATIC_DIR: path.join(appDir, "dist")
  });
  await import(pathToFileURL(path.join(appDir, "server", "server.mjs")).href);
  await waitForServer(port);

  // The page needs no device permissions beyond playing audio and showing full screen.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "fullscreen" || permission === "clipboard-sanitized-write");
  });
  Menu.setApplicationMenu(null);
  restartWhenKeysChange(userData);
  openWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(() =>
    start().catch((error) => {
      console.error(error);
      app.exit(1);
    })
  );
}
