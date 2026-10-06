import type { Viewer } from "cesium";

/**
 * Hosts the optional data layers (weather, events, infrastructure, utilities): draws their toggle chips in the
 * "More layers" panel, remembers which are on, shows a short status under each, and routes map clicks to the layer
 * that owns the clicked entity. Each layer lives in its own module and only implements `LayerDef`.
 */
export type LayerGroup = "Weather" | "Events" | "Infrastructure" | "History" | "Utilities";

export type LayerDef = {
  id: string;
  label: string;
  group: LayerGroup;
  hint: string;
  /** Called when the chip is switched on. May be async; throw to show the error under the chip. */
  enable(): void | Promise<void>;
  disable(): void;
  /** Return true if the clicked entity belongs to this layer (and the click was handled). */
  onPick?(entity: { id?: unknown }): boolean;
};

export type LayerHost = {
  register(def: LayerDef): void;
  setStatus(id: string, text: string): void;
  isOn(id: string): boolean;
  /** Switches a layer on (as clicking its chip would) if it is off; resolves once it has started. */
  activate(id: string): Promise<void>;
  /** Offers a map click to the layers; true if one handled it. */
  pick(entity: { id?: unknown } | null): boolean;
  viewer: Viewer;
};

const GROUP_ORDER: LayerGroup[] = ["Weather", "Events", "Infrastructure", "History", "Utilities"];

export function createLayerHost(viewer: Viewer, root: HTMLElement): LayerHost {
  const defs = new Map<string, LayerDef>();
  const on = new Set<string>();
  const chips = new Map<string, { btn: HTMLButtonElement; status: HTMLElement }>();
  const groups = new Map<LayerGroup, HTMLElement>();

  // Which sections the user has folded away is remembered between visits.
  const COLLAPSE_KEY = "orbit-collapsed-sections";
  const collapsed = new Set<string>();
  try {
    for (const k of JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]") as string[]) collapsed.add(k);
  } catch {
    /* no saved state */
  }

  const sections: Array<{ wrap: HTMLElement; title: HTMLElement }> = [];

  /** Turns a section title into a fold/unfold toggle for the given content. */
  function makeCollapsible(wrap: HTMLElement, title: HTMLElement, key: string): void {
    title.setAttribute("role", "button");
    title.tabIndex = 0;
    const apply = (): void => {
      const closed = collapsed.has(key);
      wrap.classList.toggle("is-collapsed", closed);
      title.setAttribute("aria-expanded", String(!closed));
    };
    const toggle = (): void => {
      // Go by what is on screen: a section can also be folded automatically (see below), which isn't remembered.
      if (wrap.classList.contains("is-collapsed")) collapsed.delete(key);
      else collapsed.add(key);
      apply();
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
      } catch {
        /* not remembered */
      }
    };
    title.addEventListener("click", toggle);
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    apply();
    sections.push({ wrap, title });
  }

  for (const g of GROUP_ORDER) {
    const wrap = document.createElement("div");
    wrap.className = "layer-group hidden";
    const title = document.createElement("div");
    title.className = "layer-group-title";
    title.textContent = g;
    const row = document.createElement("div");
    row.className = "layer-group-row";
    wrap.append(title, row);
    root.append(wrap);
    groups.set(g, row);
    makeCollapsible(wrap, title, g);
  }

  // The built-in tracking toggles (satellites, aircraft, ships ...) get the same fold-away heading.
  const builtin = document.getElementById("layer-toggles");
  if (builtin?.parentElement) {
    const wrap = document.createElement("div");
    wrap.className = "layer-group layer-group-live";
    const title = document.createElement("div");
    title.className = "layer-group-title";
    title.textContent = "Live tracking";
    const body = document.createElement("div");
    body.className = "layer-group-row";
    builtin.parentElement.insertBefore(wrap, builtin);
    wrap.append(title, body);
    body.append(builtin);
    const sources = document.getElementById("source-controls");
    if (sources) body.append(sources);
    makeCollapsible(wrap, title, "Live tracking");
  }

  // Switching a layer on folds every other section away, so the layer's own settings (aircraft filters, camera
  // search, ALPR vendor ...) move up into view. This fold is temporary and is not remembered.
  const overlay = root.closest<HTMLElement>(".map-overlay-left");
  overlay?.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>(".layer-chip, #layer-toggles .cc-btn");
    if (!btn) return;
    let done = false;
    // Some layers finish switching on a moment later (they load data first), so look a few times.
    for (const delay of [80, 350, 900]) {
      window.setTimeout(() => {
        if (done || !btn.classList.contains("is-on")) return;
        done = true;
        const own = btn.closest(".layer-group");
        for (const s of sections) {
          if (s.wrap === own) continue;
          s.wrap.classList.add("is-collapsed");
          s.title.setAttribute("aria-expanded", "false");
        }
        overlay.scrollTo({ top: 0, behavior: "smooth" });
      }, delay);
    }
  });

  /** Switches a layer off exactly as clicking its chip would. */
  function turnOff(id: string): void {
    const c = chips.get(id);
    if (c && on.has(id)) c.btn.click();
  }

  // Every floating panel a layer opens (radar timeline, radio, directions, ...) gets a × that switches that layer off.
  const PANEL_LAYER: Record<string, string> = {
    "radar-panel": "radar",
    "wind-legend": "wind",
    "radio-panel": "radio",
    "directions-panel": "directions",
    "history-panel": "history",
    "power-legend": "power-grid",
    "conflicts-panel": "conflicts"
  };
  const extras = document.getElementById("layer-extras");
  if (extras) {
    const addClose = (panel: HTMLElement): void => {
      if (panel.querySelector(":scope > .panel-close")) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "panel-close";
      b.textContent = "×";
      b.setAttribute("aria-label", "Close");
      b.title = "Close";
      b.addEventListener("click", () => {
        if (panel.id === "launch-replay") {
          // The replay has its own Close button that also releases the camera.
          [...panel.querySelectorAll("button")].find((x) => x.textContent === "Close")?.click();
          return;
        }
        const layerId = PANEL_LAYER[panel.id];
        // A panel that finished loading after its chip was switched off has no layer left to turn off: just remove it.
        if (layerId && on.has(layerId)) turnOff(layerId);
        else panel.remove();
      });
      panel.prepend(b);
    };
    const scan = (): void => {
      for (const p of extras.querySelectorAll<HTMLElement>(":scope > .layer-panel")) addClose(p);
    };
    new MutationObserver(scan).observe(extras, { childList: true });
    scan();
  }

  const host: LayerHost = {
    viewer,
    register(def) {
      defs.set(def.id, def);
      const row = groups.get(def.group)!;
      row.parentElement!.classList.remove("hidden");
      const cell = document.createElement("div");
      cell.className = "layer-cell";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "layer-chip";
      btn.textContent = def.label;
      btn.title = def.hint;
      const status = document.createElement("small");
      status.className = "layer-status";
      cell.append(btn, status);
      row.append(cell);
      chips.set(def.id, { btn, status });

      btn.addEventListener("click", async () => {
        if (on.has(def.id)) {
          on.delete(def.id);
          btn.classList.remove("is-on");
          status.textContent = "";
          try {
            def.disable();
          } catch (e) {
            console.warn(`[layer ${def.id}] disable failed`, e);
          }
          viewer.scene.requestRender();
          return;
        }
        on.add(def.id);
        btn.classList.add("is-on", "is-busy");
        status.textContent = "Loading…";
        try {
          await def.enable();
          if (status.textContent === "Loading…") status.textContent = "";
        } catch (e) {
          console.warn(`[layer ${def.id}] enable failed`, e);
          // Back to "off" so a second click retries, with the reason left under the chip.
          on.delete(def.id);
          btn.classList.remove("is-on");
          try {
            def.disable();
          } catch {
            /* nothing to clean up */
          }
          status.textContent = e instanceof Error ? e.message.slice(0, 60) : "Unavailable right now";
        } finally {
          btn.classList.remove("is-busy");
          viewer.scene.requestRender();
        }
      });
    },
    setStatus(id, text) {
      const c = chips.get(id);
      if (c) c.status.textContent = text;
    },
    isOn: (id) => on.has(id),
    activate(id) {
      const c = chips.get(id);
      if (c && !on.has(id)) c.btn.click();
      return new Promise((r) => window.setTimeout(r, 80));
    },
    pick(entity) {
      if (!entity) return false;
      for (const def of defs.values()) {
        if (on.has(def.id) && def.onPick?.(entity)) return true;
      }
      return false;
    }
  };
  return host;
}


