/**
 * The Credits section: who the map data and imagery come from, and the credit each provider asks us to show.
 *
 * Cesium's own credit widget is hidden (it carries "Upgrade" prompts and a logo over the map), so the credits it collects
 * would otherwise be nowhere. This puts them, and every other source, in the Keys sheet under "Credits", with a small
 * "Credits" link in the corner of the map (where map attributions normally sit) that opens it. The list is plain data so
 * the wording can be unit-tested; keep it in step with `DATA_SOURCES.md`.
 */
export type CreditEntry = { name: string; credit: string; href: string };

export const CREDITS: CreditEntry[] = [
  { name: "Cesium ion · Bing Maps aerial · World Terrain", credit: "© Cesium, Microsoft Bing Maps and the data providers Cesium lists below", href: "https://cesium.com/" },
  { name: "Google Photorealistic 3D Tiles", credit: "© Google, delivered through Cesium ion (3D Photo)", href: "https://developers.google.com/maps/documentation/tile/3d-tiles" },
  { name: "Esri World Imagery", credit: "Imagery © Esri, Maxar, Earthstar Geographics and the GIS user community", href: "https://www.esri.com/" },
  { name: "OpenStreetMap", credit: "© OpenStreetMap contributors, ODbL: streets imagery, ALPR cameras, data centers, power lines, abandoned places, places, directions", href: "https://www.openstreetmap.org/copyright" },
  { name: "TrespassersHQ", credit: "Outbound link only, from an Abandoned places card; Orbit fetches nothing from this site and uses none of its data", href: "https://trespassershq.com/explore/" },
  { name: "NASA GIBS / EOSDIS", credit: "Cloud imagery (GOES, Himawari) and the Time machine's daily Earth imagery", href: "https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" },
  { name: "EUMETSAT", credit: "© EUMETSAT: Meteosat cloud imagery over Europe, Africa and the Indian Ocean", href: "https://view.eumetsat.int/" },
  { name: "RainViewer", credit: "Rain radar mosaic", href: "https://www.rainviewer.com/" },
  { name: "Open-Meteo", credit: "Weather data by Open-Meteo.com (CC BY 4.0): the wind layer", href: "https://open-meteo.com/" },
  { name: "NOAA", credit: "National Hurricane Center storms; nowCOAST lightning", href: "https://www.noaa.gov/" },
  { name: "USGS", credit: "Earthquakes", href: "https://earthquake.usgs.gov/" },
  { name: "NASA EONET and FIRMS", credit: "Wildfire events and satellite hot-spots", href: "https://eonet.gsfc.nasa.gov/" },
  { name: "NIFC / WFIGS", credit: "US wildfire perimeters (US only)", href: "https://data-nifc.opendata.arcgis.com/" },
  { name: "UCDP", credit: "Uppsala Conflict Data Program, CC BY 4.0: Davies, Pettersson & Öberg; Sundberg & Melander (2013)", href: "https://ucdp.uu.se/" },
  { name: "GDELT", credit: "News headlines; the text and links belong to the publishers", href: "https://www.gdeltproject.org/" },
  { name: "TeleGeography", credit: "Submarine Cable Map, CC BY-SA 4.0", href: "https://www.submarinecablemap.com/" },
  { name: "WRI Global Power Plant Database", credit: "Power plants, CC BY 4.0", href: "https://datasets.wri.org/dataset/globalpowerplantdatabase" },
  { name: "Wikidata, Wikipedia, Wikimedia Commons", credit: "Dams, battles, summaries and aircraft photos; Commons licences per photo", href: "https://www.wikidata.org/" },
  { name: "Radio Browser", credit: "Community radio station directory", href: "https://www.radio-browser.info/" },
  { name: "The Space Devs · Launch Library 2", credit: "Rocket launch schedule and webcast links", href: "https://thespacedevs.com/" },
  { name: "adsb.lol · adsb.fi · Airplanes.live · OpenSky · ADS-B Exchange", credit: "Community and research aircraft feeds", href: "https://www.adsb.lol/" },
  { name: "adsbdb · Planespotters", credit: "Flight routes; aircraft photos credited to their photographers on each card", href: "https://www.planespotters.net/" },
  { name: "AISStream · Fintraffic Digitraffic", credit: "Ship positions (Digitraffic Marine: Fintraffic, CC BY 4.0)", href: "https://aisstream.io/" },
  { name: "CelesTrak · KeepTrack · SatNOGS · N2YO", credit: "Satellite orbits and details", href: "https://celestrak.org/" },
  { name: "OurAirports · OpenFlights", credit: "Airport and airline lookups (OurAirports public domain; OpenFlights ODbL)", href: "https://ourairports.com/" },
  { name: "US Census Geocoder · Photon (komoot) · Nominatim · OSRM", credit: "Address, place search and routing; OpenStreetMap data, ODbL", href: "https://www.openstreetmap.org/copyright" },
  { name: "PeeringDB", credit: "Colocation facility data", href: "https://www.peeringdb.com/" },
  { name: "Traffic cameras", credit: "US state 511 and transportation agencies, Caltrans, Transport for London (TfL Open Data), DriveBC (Open Government Licence – BC), City of Calgary (Open Government Licence), City of Austin, Fintraffic (CC BY 4.0), Hong Kong Transport Department, NZ Transport Agency Waka Kotahi. Each still belongs to its agency", href: "https://github.com/runna5k/Orbit/blob/main/DATA_SOURCES.md" }
];

/** The credits Cesium has collected for what is on screen right now (imagery, terrain, 3D tiles, cloud layers). */
export function liveCesiumCredits(sink: ParentNode, doc: ParentNode = document): string[] {
  const seen = new Set<string>();
  const add = (raw: string | null): void => {
    const t = (raw ?? "").replace(/\s+/g, " ").trim();
    // Cesium's own sales prompt is not a credit.
    if (t && t.length < 700 && !/upgrade|commercial use|data attribution/i.test(t)) seen.add(t);
  };
  // Credits Cesium shows inline (our own layers add some, e.g. "Clouds: © EUMETSAT") ...
  for (const node of sink.querySelectorAll<HTMLElement>(".cesium-credit-textContainer .cesium-credit-wrapper")) add(node.textContent);
  // ... and the data providers it keeps in its "Data attribution" list (Bing Maps, Earthstar, terrain sources).
  for (const li of doc.querySelectorAll<HTMLElement>(".cesium-credit-lightbox li")) add(li.textContent);
  return [...seen];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Adds the Credits group to the Keys sheet and a "Credits" link in the corner of the map that opens it. */
export function mountCredits(sheet: HTMLElement, creditSink: HTMLElement, app: HTMLElement): void {
  const box = el("div", "keys-group credits-group");
  box.id = "credits-group";
  box.append(el("div", "keys-group-title", "Credits"));
  box.append(el("p", "keys-note", "Orbit shows data and imagery from the providers below. Their terms apply. Details: DATA_SOURCES.md."));

  const live = el("div", "credits-live");
  box.append(live);
  const renderLive = (): void => {
    live.textContent = "";
    const items = liveCesiumCredits(creditSink);
    if (!items.length) return;
    live.append(el("div", "credits-subtitle", "On the map right now (reported by Cesium)"));
    for (const t of items) live.append(el("p", "credits-live-line", t));
  };
  renderLive();
  // Cesium fills its credit list as imagery and tiles load, so read it again each time the sheet is opened.
  document.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest('[data-menu="keys"], .credits-link')) window.setTimeout(renderLive, 150);
  });

  const list = el("ul", "credits-list");
  for (const c of CREDITS) {
    const li = el("li");
    const a = el("a", undefined, c.name);
    a.href = c.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    li.append(a, document.createTextNode(` — ${c.credit}`));
    list.append(li);
  }
  box.append(list);
  sheet.append(box);

  const link = el("button", "credits-link", "Credits");
  link.type = "button";
  link.setAttribute("aria-label", "Data and imagery credits");
  link.addEventListener("click", () => {
    if (!document.body.classList.contains("menu-keys-open")) {
      document.querySelector<HTMLButtonElement>('#menu-bar [data-menu="keys"]')?.click();
    }
    window.setTimeout(() => box.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  });
  app.append(link);
}
