import type { Viewer } from "cesium";
import { createLayerHost, type LayerHost } from "./layerHost";
import { registerEventLayers } from "./events";
import { registerWeatherImagery } from "./weatherImagery";
import { registerWind } from "./wind";
import { registerInfrastructureLayers } from "./infrastructure";
import { registerRadio } from "./radio";
import { registerLaunches } from "./launches";
import { registerDirections } from "./directions";
import { registerHistory } from "./history";
import { registerConflicts } from "./conflicts";
import { registerPower } from "./power";
import { registerAbandoned } from "./abandoned";

/**
 * Registers every optional layer. Their toggle buttons are drawn straight into the main "Data layers" menu, under
 * the built-in layers, grouped as Weather / Events / Infrastructure / Utilities.
 * Returns the host so main.ts can route map clicks to the layers.
 */
export function initExtraLayers(viewer: Viewer): LayerHost | null {
  const body = document.getElementById("more-layers-body");
  if (!body) return null;

  const host = createLayerHost(viewer, body);
  registerWind(host);
  registerWeatherImagery(host);
  registerEventLayers(host);
  registerConflicts(host);
  registerInfrastructureLayers(host);
  registerPower(host);
  registerAbandoned(host);
  registerRadio(host);
  registerLaunches(host);
  registerDirections(host);
  registerHistory(host);
  return host;
}

