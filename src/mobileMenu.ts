/**
 * Phone menu: the top bar carries three buttons — Map (view options such as 3D photo mode and weather imagery),
 * Layers (everything else) and a dark/light switch. Map and Layers open as sheets that drop out from the bottom edge
 * of the bar. On wider screens none of this applies and the controls stay where they were.
 */
import { getPhoneQuality, PHONE_QUERY, PHONE_QUALITY_LABEL, PHONE_QUALITY_NOTE, setPhoneQuality, type PhoneQuality } from "./mobilePerf";

const PHONE = "(max-width: 720px)";
const THEME_KEY = "orbit-theme";

type Moved = { el: HTMLElement; home: Comment };

/** "Sharpness" row for the Map sheet: three phone render presets (see mobilePerf.ts). Reuses the Imagery picker's look. */
function buildQualityPicker(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.id = "quality-picker";
  wrap.className = "layer-group";
  const heading = document.createElement("div");
  heading.className = "layer-group-title imagery-title";
  heading.textContent = "Sharpness";
  const row = document.createElement("div");
  row.className = "layer-group-row imagery-row";
  const note = document.createElement("p");
  note.className = "layer-panel-note imagery-note";
  wrap.append(heading, row, note);

  const buttons = new Map<PhoneQuality, HTMLButtonElement>();
  const mark = (q: PhoneQuality): void => {
    for (const [k, b] of buttons) {
      b.classList.toggle("is-on", k === q);
      b.setAttribute("aria-pressed", String(k === q));
    }
    note.textContent = PHONE_QUALITY_NOTE[q];
  };
  for (const q of ["sharp", "balanced", "smooth"] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "layer-chip";
    b.dataset.quality = q;
    b.textContent = PHONE_QUALITY_LABEL[q];
    b.addEventListener("click", () => {
      setPhoneQuality(q);
      mark(q);
    });
    buttons.set(q, b);
    row.append(b);
  }
  mark(getPhoneQuality());
  // The row is for real touch devices: a narrow desktop window gets the phone layout but desktop render settings, so
  // the picker would do nothing there.
  const mq = window.matchMedia(PHONE_QUERY);
  const sync = (): void => {
    wrap.style.display = mq.matches ? "" : "none";
  };
  mq.addEventListener("change", sync);
  sync();
  return wrap;
}

export function setupMobileMenu(): void {
  const header = document.querySelector<HTMLElement>(".command-header");
  const bar = document.getElementById("menu-bar");
  const app = document.getElementById("app") ?? document.body;
  const layersSheet = document.querySelector<HTMLElement>(".map-overlay-left");
  const stage = document.querySelector<HTMLElement>(".command-map-stage");
  if (!header || !bar || !layersSheet || !stage) return;

  // ---- The Map sheet (built once; its contents are borrowed from the Layers sheet on phones) ----
  const mapSheet = document.createElement("section");
  mapSheet.id = "map-sheet";
  mapSheet.className = "menu-sheet";
  mapSheet.setAttribute("aria-label", "Map view");
  const title = document.createElement("div");
  title.className = "menu-sheet-title";
  title.textContent = "Map view";
  const grid = document.createElement("div");
  grid.className = "menu-sheet-grid";
  const weatherSlot = document.createElement("div");
  mapSheet.append(title, grid, buildQualityPicker(), weatherSlot);
  stage.append(mapSheet);

  const moved: Moved[] = [];
  const borrow = (el: HTMLElement | null, into: HTMLElement): void => {
    if (!el || !el.parentNode) return;
    const home = document.createComment("menu-home");
    el.parentNode.insertBefore(home, el);
    into.append(el);
    moved.push({ el, home });
  };
  const giveBack = (): void => {
    for (const { el, home } of moved.splice(0)) {
      home.parentNode?.insertBefore(el, home);
      home.remove();
    }
  };

  const weatherGroup = (): HTMLElement | null =>
    [...document.querySelectorAll<HTMLElement>("#more-layers-body .layer-group")].find(
      (g) => g.querySelector(".layer-group-title")?.textContent === "Weather"
    ) ?? null;

  const dock = document.createElement("nav");
  dock.id = "mobile-dock";
  dock.className = "mobile-dock";
  dock.setAttribute("aria-label", "Menu");
  app.append(dock);

  // ---- Opening and closing ----
  const buttons = new Map<string, HTMLButtonElement>();
  for (const b of bar.querySelectorAll<HTMLButtonElement>("[data-menu]")) buttons.set(b.dataset.menu!, b);
  let open: "map" | "layers" | "keys" | null = null;

  const setOpen = (next: "map" | "layers" | "keys" | null): void => {
    open = next;
    document.body.classList.toggle("menu-map-open", next === "map");
    document.body.classList.toggle("menu-layers-open", next === "layers");
    document.body.classList.toggle("menu-keys-open", next === "keys");
    buttons.get("keys")?.classList.toggle("is-open", next === "keys");
    buttons.get("keys")?.setAttribute("aria-expanded", String(next === "keys"));
    buttons.get("map")?.classList.toggle("is-open", next === "map");
    buttons.get("layers")?.classList.toggle("is-open", next === "layers");
    if (next === "layers") {
      // If a layer has settings showing (aircraft filters, camera search ...), start the sheet at them.
      const settings = layersSheet.querySelector<HTMLElement>(":scope > .cc-module:not(:first-child):not(.hidden)");
      window.setTimeout(() => layersSheet.scrollTo({ top: settings ? Math.max(0, settings.offsetTop - 70) : 0, behavior: "smooth" }), 60);
    }
    buttons.get("map")?.setAttribute("aria-expanded", String(next === "map"));
    buttons.get("layers")?.setAttribute("aria-expanded", String(next === "layers"));
  };

  /** Sheets hang from the bottom edge of the bar, wherever the bar currently ends. */
  const placeSheets = (): void => {
    const bottom = header.getBoundingClientRect().bottom + 8;
    document.documentElement.style.setProperty("--bar-bottom", `${Math.round(bottom)}px`);
  };
  new ResizeObserver(placeSheets).observe(header);
  window.addEventListener("resize", placeSheets);
  placeSheets();

  bar.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-menu]");
    if (!btn) return;
    const which = btn.dataset.menu;
    if (which === "theme") {
      toggleTheme();
      return;
    }
    if (which === "map" || which === "layers" || which === "keys") setOpen(open === which ? null : which);
  });

  // Picking a layer on a phone closes the sheet so the map is in view; reopening Layers shows the other sections folded
  // away with that layer's own settings right at the top.
  const closeOnPick = (ev: Event): void => {
    if (!mq.matches) return;
    const btn = (ev.target as HTMLElement).closest<HTMLElement>(".layer-chip, #layer-toggles .cc-btn, #toggle-photorealistic-3d");
    if (!btn) return;
    window.setTimeout(() => {
      if (btn.classList.contains("is-on") && open) setOpen(null);
    }, 450);
  };
  layersSheet.addEventListener("click", closeOnPick);
  mapSheet.addEventListener("click", closeOnPick);

  // Tapping the globe (or pressing Esc) tucks the sheets away.
  const canvas = document.getElementById("globe");
  canvas?.addEventListener("pointerdown", () => open && setOpen(null));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && open) setOpen(null);
  });
  // A search focus or opening the Directions bar also clears the way.
  document.getElementById("loc-search-input")?.addEventListener("focus", () => open && setOpen(null));

  // ---- Phone <-> wider screens ----
  const mq = window.matchMedia(PHONE);
  const sync = (): void => {
    giveBack();
    setOpen(null);
    // Desktop: the icons sit at the far end of the top bar. Phone: they become a dock along the bottom of the screen.
    if (!mq.matches) header.append(bar);
    else dock.append(bar);
    if (!mq.matches) return;
    borrow(document.getElementById("toggle-photorealistic-3d"), grid);
    // Fly mode sits beside 3D Photo in the Map sheet instead of crowding the phone bar.
    borrow(document.getElementById("fly-mode-btn"), grid);
    borrow(document.getElementById("imagery-picker"), weatherSlot);
    borrow(weatherGroup(), weatherSlot);
    placeSheets();
  };
  mq.addEventListener("change", sync);
  sync();

  // ---- Dark / light ----
  const themeBtn = buttons.get("theme");
  const applyTheme = (light: boolean): void => {
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    header.dataset.tone = light ? "light" : "dark";
    themeBtn?.setAttribute("aria-pressed", String(light));
    themeBtn?.setAttribute("title", light ? "Switch to the dark bar" : "Switch to the light bar");
    window.dispatchEvent(new CustomEvent("orbit:theme", { detail: { light } }));
  };
  function toggleTheme(): void {
    const light = document.documentElement.dataset.theme !== "light";
    applyTheme(light);
    try {
      localStorage.setItem(THEME_KEY, light ? "light" : "dark");
    } catch {
      /* private mode: the choice just won't be remembered */
    }
  }
  try {
    if (localStorage.getItem(THEME_KEY) === "light") applyTheme(true);
  } catch {
    /* ignore */
  }
}




