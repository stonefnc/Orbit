import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type HttpProxy, type Plugin } from "vite";
import cesium from "vite-plugin-cesium";
import { aviationstackDevProxy } from "./vite-aviationstack-proxy-plugin";

/** `VITE_*_KEY` / `VITE_*_SECRET` names that must never reach the page (secret keys live on the server only). */
const CLIENT_SECRET_NAME = /^VITE_.*_(?:KEY|SECRET)$/;

/**
 * Drops secret-looking `VITE_` names from `import.meta.env`, so a leftover line in `.env.local` (for example the legacy
 * `VITE_KEEPTRACK_API_KEY`) is not served to the dev page or written into the bundle. Every plugin that builds
 * `import.meta.env` reads `config.env` lazily, after `configResolved`.
 */
function dropClientSecrets(): Plugin {
  return {
    name: "orbit-drop-client-secrets",
    configResolved(config) {
      const env = config.env as Record<string, unknown>;
      const dropped = Object.keys(env).filter((k) => CLIENT_SECRET_NAME.test(k));
      for (const k of dropped) delete env[k];
      if (dropped.length) {
        config.logger.warn(`[orbit] kept out of the browser: ${dropped.join(", ")} (secret keys belong on the server)`);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  /** ORBIT_ENV_DIR points at another folder for the env files (the zero-key browser test uses an empty one). */
  const envDir = process.env.ORBIT_ENV_DIR?.trim() || process.cwd();
  const env = loadEnv(mode, envDir, "");
  const aviationstackKey = env.AVIATIONSTACK_ACCESS_KEY ?? "";
  const planeApiTarget = (env.PLANE_API_TARGET ?? "http://127.0.0.1:8787").trim();

  /** Shared by `vite` and `vite preview` — preview does not inherit `server.proxy` by default. */
  const devPreviewProxy = {
    /** Plane aggregation + OpenSky flights proxy (OAuth on the Node server only). */
    "/api": {
      target: planeApiTarget,
      changeOrigin: true,
      /** Passes the caller's address on (X-Forwarded-For) so the server can tell this computer from other devices. */
      xfwd: true,
      ws: true,
      /**
       * The websocket proxy adds X-Forwarded-For/Port/Proto but not X-Forwarded-Host (the plain-request proxy does), and
       * changeOrigin rewrites Host. The API needs the page's own host to tell a phone on the Wi-Fi address (same origin)
       * from another website, so it is set here, always overwriting whatever the caller sent. See server/lib/wsOrigin.ts.
       */
      configure: (proxy: HttpProxy.Server) => {
        proxy.on("proxyReqWs", (proxyReq, req) => {
          proxyReq.setHeader("x-forwarded-host", req.headers.host ?? "");
        });
      },
      timeout: 120_000,
      proxyTimeout: 120_000,
    },
    // Browser cannot call opendata.adsb.fi directly (no CORS headers); dev uses same-origin proxy.
    "/adsb-proxy": {
      target: "https://opendata.adsb.fi",
      changeOrigin: true,
      secure: true,
      /** Longer timeouts can reduce flaky proxy teardowns toward opendata.adsb.fi (TLS resets). */
      timeout: 90_000,
      proxyTimeout: 90_000,
      rewrite: (p: string) => p.replace(/^\/adsb-proxy/, ""),
    },
    /** CelesTrak blocks browser-origin CORS on direct `celestrak.org`; same-origin proxy for dev + preview. */
    "/celestrak-proxy": {
      target: "https://celestrak.org",
      changeOrigin: true,
      secure: true,
      timeout: 90_000,
      proxyTimeout: 90_000,
      rewrite: (p: string) => p.replace(/^\/celestrak-proxy/, ""),
    },
    /** Overpass API — use in dev so the browser can POST Overpass QL without CORS issues. */
    "/overpass-proxy": {
      target: "https://overpass-api.de",
      changeOrigin: true,
      secure: true,
      timeout: 120_000,
      proxyTimeout: 120_000,
      rewrite: (p: string) => p.replace(/^\/overpass-proxy/, ""),
    },
    /** FlockHopper public GeoJSON — dev-only same-origin fetch when the CDN omits CORS. */
    "/flockhopper-data": {
      target: "https://data.dontgetflocked.com",
      changeOrigin: true,
      secure: true,
      timeout: 300_000,
      proxyTimeout: 300_000,
      rewrite: (p: string) => p.replace(/^\/flockhopper-data/, ""),
    },
    /** OSM Nominatim — browser cannot set a compliant User-Agent; proxy adds one (see Nominatim usage policy). */
    "/nominatim-proxy": {
      target: "https://nominatim.openstreetmap.org",
      changeOrigin: true,
      secure: true,
      timeout: 30_000,
      proxyTimeout: 30_000,
      rewrite: (p: string) => p.replace(/^\/nominatim-proxy/, ""),
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq) => {
          proxyReq.setHeader(
            "User-Agent",
            "Orbit/1.0 (https://github.com/runna5k/Orbit; Nominatim place search)"
          );
        });
      },
    },
    /** EarthCam network location catalog — same-origin proxy for browser CORS. */
    "/earthcam-api-proxy": {
      target: "https://www.earthcam.com",
      changeOrigin: true,
      secure: true,
      timeout: 60_000,
      proxyTimeout: 60_000,
      rewrite: (p: string) => p.replace(/^\/earthcam-api-proxy/, ""),
    },
  };

  /**
   * Optional HTTPS for `npm run dev:lan:https` only (scripts/dev-lan-https.mjs sets ORBIT_HTTPS=1): a phone shares its
   * location only on a secure page. The certificate is made once with mkcert (the command prints the steps when
   * it has none); the files stay out of git (.certs/). Without ORBIT_HTTPS=1 nothing changes.
   */
  const certFile = resolve(process.env.ORBIT_HTTPS_CERT ?? ".certs/orbit.pem");
  const keyFile = resolve(process.env.ORBIT_HTTPS_KEY ?? ".certs/orbit-key.pem");
  const devHttps = process.env.ORBIT_HTTPS === "1" && existsSync(certFile) && existsSync(keyFile) ? { cert: readFileSync(certFile), key: readFileSync(keyFile) } : undefined;

  return {
    envDir,
    plugins: [dropClientSecrets(), aviationstackDevProxy({ accessKey: aviationstackKey }), cesium()],
    server: {
      proxy: devPreviewProxy,
      ...(devHttps ? { https: devHttps } : {}),
    },
    preview: {
      proxy: devPreviewProxy,
    },
  };
});
