/**
 * Installable web app: registers the service worker (public/sw.js, app shell only). Production builds only, because in
 * `npm run dev` a service worker would serve stale modules and fight hot reload. Browsers allow service workers on https
 * and on localhost only, so a phone on a plain http Wi-Fi address still gets "Add to Home Screen" (the manifest and icons
 * are in index.html) but no offline shell.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
      console.warn("Service worker not registered:", error);
    });
  });
}
