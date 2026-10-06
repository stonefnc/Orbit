import {
  createWorldImageryAsync,
  IonWorldImageryStyle,
  OpenStreetMapImageryProvider,
  UrlTemplateImageryProvider,
  type Viewer
} from "cesium";

/**
 * Where the picture of the Earth comes from. Three free-to-view sources can be swapped at any time:
 *
 *  - aerial:  Cesium ion "World Imagery" (Bing aerial with labels) — needs the ion token in .env.local
 *  - esri:    Esri World Imagery (Maxar / Earthstar) plus place labels — keyless, a different, fast CDN
 *  - streets: OpenStreetMap map tiles — keyless
 *
 * If the chosen source can't be reached the next one is used automatically (aerial -> esri -> streets).
 */
export type ImagerySource = "aerial" | "esri" | "streets";

const KEY = "orbit-imagery";
const ESRI = "https://services.arcgisonline.com/arcgis/rest/services";

export const IMAGERY_LABEL: Record<ImagerySource, string> = {
  aerial: "Aerial",
  esri: "Esri",
  streets: "Streets"
};

const IMAGERY_NOTE: Record<ImagerySource, string> = {
  aerial: "Cesium ion World Imagery (Bing aerial). Needs the Cesium ion token.",
  esri: "Imagery © Esri, Maxar, Earthstar Geographics and the GIS user community. Free for display; a different network, so it can load faster.",
  streets: "Map © OpenStreetMap contributors."
};

export function savedImagery(hasIonToken: boolean): ImagerySource {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "aerial" || v === "esri" || v === "streets") {
      if (v !== "aerial" || hasIonToken) return v;
    }
  } catch {
    /* no storage */
  }
  return hasIonToken ? "aerial" : "esri";
}

function esriImagery(viewer: Viewer): void {
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(
    new UrlTemplateImageryProvider({
      url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
      maximumLevel: 19,
      credit: "Esri, Maxar, Earthstar Geographics, and the GIS User Community"
    })
  );
  // Country, city and road names on top of the photos (Esri's imagery has none of its own).
  viewer.imageryLayers.addImageryProvider(
    new UrlTemplateImageryProvider({
      url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
      maximumLevel: 13,
      credit: "Esri"
    })
  );
}

function streetsImagery(viewer: Viewer): void {
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }));
}

/** Applies a source, falling back down the chain when it fails. Resolves with the source that ended up in use. */
export async function applyImagery(viewer: Viewer, want: ImagerySource, hasIonToken: boolean): Promise<ImagerySource> {
  if (want === "aerial") {
    if (hasIonToken) {
      try {
        const provider = await createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL_WITH_LABELS });
        viewer.imageryLayers.removeAll();
        viewer.imageryLayers.addImageryProvider(provider);
        return "aerial";
      } catch (error) {
        console.warn("Cesium ion imagery failed; switching to Esri imagery:", error);
      }
    }
    want = "esri";
  }
  if (want === "esri") {
    try {
      esriImagery(viewer);
      return "esri";
    } catch (error) {
      console.warn("Esri imagery failed; switching to OpenStreetMap:", error);
    }
  }
  streetsImagery(viewer);
  return "streets";
}

/**
 * The little "Imagery" picker in the menu. Switching applies the new source at once and remembers the choice.
 * `onChange` runs after the swap so the caller can redraw.
 */
export function createImageryPicker(
  viewer: Viewer,
  hasIonToken: boolean,
  current: ImagerySource,
  onApplied: (used: ImagerySource) => void
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.id = "imagery-picker";
  wrap.className = "layer-group";
  const title = document.createElement("div");
  title.className = "layer-group-title imagery-title";
  title.textContent = "Imagery";
  const row = document.createElement("div");
  row.className = "layer-group-row imagery-row";
  const note = document.createElement("p");
  note.className = "layer-panel-note imagery-note";
  wrap.append(title, row, note);

  const buttons = new Map<ImagerySource, HTMLButtonElement>();
  const mark = (src: ImagerySource): void => {
    for (const [k, b] of buttons) {
      b.classList.toggle("is-on", k === src);
      b.setAttribute("aria-pressed", String(k === src));
    }
    note.textContent = IMAGERY_NOTE[src];
  };

  for (const src of ["aerial", "esri", "streets"] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "layer-chip";
    b.textContent = IMAGERY_LABEL[src];
    if (src === "aerial" && !hasIonToken) {
      b.disabled = true;
      b.title = "Needs a free Cesium ion token: paste it in the Keys menu";
    }
    b.addEventListener("click", () => {
      if (b.disabled) return;
      mark(src);
      b.classList.add("is-busy");
      void applyImagery(viewer, src, hasIonToken).then((used) => {
        b.classList.remove("is-busy");
        mark(used);
        try {
          localStorage.setItem(KEY, used);
        } catch {
          /* not remembered */
        }
        viewer.scene.requestRender();
        onApplied(used);
      });
    });
    buttons.set(src, b);
    row.append(b);
  }
  mark(current);
  return wrap;
}