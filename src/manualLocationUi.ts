import { searchGeocode } from "./geocodeClient";
import { parseLatLon } from "./manualLocation";

/**
 * The "type a place" part of the manual-location card: a text box, a Find button and up to five matches from the same
 * address and place lookup the top bar uses (US Census for street addresses, Photon / OpenStreetMap for places, ranked
 * nearest to `getBias()` first). `onPick` receives the chosen point. Typing "lat, lon" works too. Everything is set with
 * textContent.
 */
export function buildPlaceFinder(
  onPick: (lat: number, lon: number, label: string) => void,
  getBias: () => { lat: number; lon: number } | null = () => null
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "manual-loc-finder";
  const row = document.createElement("div");
  row.className = "manual-loc-row";
  const input = document.createElement("input");
  input.type = "search";
  input.className = "keys-input";
  input.placeholder = "Street address, place or lat, lon";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Place to use as my location");
  const find = document.createElement("button");
  find.type = "button";
  find.className = "layer-card-btn";
  find.textContent = "Find";
  row.append(input, find);
  const results = document.createElement("div");
  results.className = "manual-loc-results";
  const note = document.createElement("p");
  note.className = "layer-panel-note";
  wrap.append(row, results, note);

  let seq = 0;
  const run = async (): Promise<void> => {
    const q = input.value.trim();
    results.textContent = "";
    note.textContent = "";
    if (q.length < 3) return;
    const direct = parseLatLon(q);
    if (direct) {
      onPick(direct.lat, direct.lon, "");
      return;
    }
    const mine = ++seq;
    note.textContent = "Searching…";
    try {
      // Find is an explicit search, so it may also use Nominatim when the other sources find little.
      const { hits, unavailable } = await searchGeocode(q, { bias: getBias(), submit: true });
      if (mine !== seq) return;
      note.textContent = hits.length
        ? "Tap one to use it as your location."
        : unavailable.length
          ? "The address lookup isn't reachable right now. Try again in a moment, or tap the map instead."
          : "Nothing found. Add the city and state (for example “100 Main St, Springfield IL”; house-number addresses work in the US only), or tap the map.";
      for (const h of hits.slice(0, 5)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "layer-card-btn manual-loc-hit";
        const name = h.displayName.split(",").slice(0, h.isAddress ? 4 : 3).join(",").trim() || h.displayName;
        b.textContent = name;
        b.addEventListener("click", () => onPick(h.lat, h.lon, name));
        results.append(b);
      }
    } catch {
      if (mine === seq) note.textContent = "The place search isn't reachable right now. Try again, or tap the map instead.";
    }
  };
  find.addEventListener("click", () => void run());
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void run();
    }
  });
  return wrap;
}
