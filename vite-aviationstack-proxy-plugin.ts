import type { ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";

export type AviationstackProxyOptions = {
  /** Aviationstack REST `access_key` — keep in `.env` / `.env.local`, never `VITE_*`. */
  accessKey: string;
};

/**
 * Dev-only proxy: forwards `/aviationstack-proxy/*` → `https://api.aviationstack.com/*`,
 * injecting `access_key` so credentials never ship in the browser bundle.
 *
 * Free tier docs: https://aviationstack.com/documentation
 */
export function aviationstackDevProxy(opts: AviationstackProxyOptions): Plugin {
  const accessKey = opts.accessKey.trim();

  return {
    name: "aviationstack-dev-proxy",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(
        async (req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
          const url = req.originalUrl ?? req.url ?? "";
          if (!url.startsWith("/aviationstack-proxy")) {
            next();
            return;
          }

          if (!accessKey) {
            res.statusCode = 503;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                error: { info: "Set AVIATIONSTACK_ACCESS_KEY in .env.local for airline flight lookup." }
              })
            );
            return;
          }

          try {
            const trimmed = url.replace(/^\/aviationstack-proxy/, "");
            const [pathOnly, qs = ""] = trimmed.includes("?")
              ? [trimmed.slice(0, trimmed.indexOf("?")), trimmed.slice(trimmed.indexOf("?") + 1)]
              : [trimmed, ""];
            const pathname = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
            const params = new URLSearchParams(qs);
            params.set("access_key", accessKey);
            const upstream = `https://api.aviationstack.com${pathname}?${params.toString()}`;
            const r = await fetch(upstream);
            const body = await r.text();
            res.statusCode = r.status;
            const ct = r.headers.get("content-type") ?? "application/json";
            res.setHeader("Content-Type", ct);
            res.end(body);
          } catch (e) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        }
      );
    },
  };
}
