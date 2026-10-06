import {
  BoundingSphere,
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  HorizontalOrigin,
  ImageryLayer,
  JulianDate,
  NearFarScalar,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  WebMercatorTilingScheme
} from "cesium";
import type { LayerHost } from "./layerHost";
import { hideLayerCard, showLayerCard } from "./layerCard";
import { publishDate, setHistoryActive } from "./timeBus";
import { horizonDepthTest, horizonDistance } from "../horizon";
import { groundHeightReference } from "../groundAnchor";

/**
 * Time machine. Two ways to look back, both keyless:
 *  - Earth by day: NASA's daily true-colour satellite mosaics (GIBS) from 24 Feb 2000 to yesterday, with a date
 *    slider and play button, so you can watch weather, fires, floods and seasons unfold.
 *  - Battles: ~9,500 battles with a place and a date from Wikidata, from antiquity to today, filtered by era and
 *    playable as a moving window through time.
 * A short list of notable events jumps to the right place, date and era in one click.
 */
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const FIRST_IMAGE_DAY = "2000-02-24";
const VIIRS_FROM = "2012-03-01";

type Battle = [id: string, name: string, lat: number, lon: number, date: string, end: string, conflict: string, wiki: string];

type HistoricEvent = {
  id: string;
  title: string;
  when: string;
  /** Satellite imagery day (only for events from 2000 on). */
  date?: string;
  /** Battle era window, in years. */
  era?: [number, number];
  lon: number;
  lat: number;
  heightM: number;
  blurb: string;
  wiki: string;
  replayDays?: number;
};

const EVENTS: HistoricEvent[] = [
  {
    id: "ukraine-2022",
    title: "Russia's invasion of Ukraine begins",
    when: "24 Feb 2022",
    date: "2022-02-24",
    era: [2022, 2023.2],
    lon: 31.5,
    lat: 49.0,
    heightM: 1_700_000,
    blurb: "On 24 February 2022 Russian forces launched a full-scale invasion of Ukraine. Step through the days that follow to watch the weather and the season change over the country.",
    wiki: "Russian_invasion_of_Ukraine",
    replayDays: 45
  },
  {
    id: "iraq-2003",
    title: "US-led invasion of Iraq",
    when: "20 Mar 2003",
    date: "2003-03-20",
    era: [2003, 2004],
    lon: 44.4,
    lat: 33.3,
    heightM: 1_300_000,
    blurb: "The US-led invasion of Iraq began on 20 March 2003. A large sandstorm swept the region a few days into the campaign — play the replay to look for it.",
    wiki: "2003_invasion_of_Iraq",
    replayDays: 14
  },
  {
    id: "mosul-2016",
    title: "Offensive to retake Mosul",
    when: "17 Oct 2016",
    date: "2016-10-17",
    era: [2016, 2017.6],
    lon: 43.13,
    lat: 36.34,
    heightM: 450_000,
    blurb: "Iraqi forces, with coalition support, began the offensive to retake Mosul from ISIL in October 2016; the city was declared retaken in July 2017.",
    wiki: "Battle_of_Mosul_(2016–2017)",
    replayDays: 30
  },
  {
    id: "kabul-2021",
    title: "Fall of Kabul",
    when: "15 Aug 2021",
    date: "2021-08-15",
    era: [2021, 2022],
    lon: 69.17,
    lat: 34.53,
    heightM: 650_000,
    blurb: "Taliban forces entered Kabul on 15 August 2021, completing a rapid offensive across Afghanistan.",
    wiki: "Fall_of_Kabul_(2021)"
  },
  {
    id: "tohoku-2011",
    title: "Tōhoku earthquake and tsunami",
    when: "11 Mar 2011",
    date: "2011-03-11",
    lon: 142.37,
    lat: 38.3,
    heightM: 1_500_000,
    blurb: "A magnitude 9.0–9.1 earthquake struck off Japan's Pacific coast on 11 March 2011 and generated a devastating tsunami.",
    wiki: "2011_Tōhoku_earthquake_and_tsunami",
    replayDays: 14
  },
  {
    id: "turkey-2023",
    title: "Turkey–Syria earthquakes",
    when: "6 Feb 2023",
    date: "2023-02-06",
    lon: 37.0,
    lat: 37.2,
    heightM: 1_200_000,
    blurb: "Two major earthquakes (M7.8 and M7.5) struck southern Turkey and northern Syria on 6 February 2023.",
    wiki: "2023_Turkey–Syria_earthquakes"
  },
  {
    id: "tonga-2022",
    title: "Hunga Tonga–Hunga Haʻapai eruption",
    when: "15 Jan 2022",
    date: "2022-01-15",
    lon: -175.38,
    lat: -20.54,
    heightM: 1_400_000,
    blurb: "The Hunga Tonga–Hunga Haʻapai volcano erupted violently on 15 January 2022, sending an ash and steam plume tens of kilometres high and a pressure wave around the planet.",
    wiki: "2022_Hunga_Tonga–Hunga_Ha'apai_eruption_and_tsunami",
    replayDays: 10
  },
  {
    id: "katrina-2005",
    title: "Hurricane Katrina",
    when: "29 Aug 2005",
    date: "2005-08-29",
    lon: -89.6,
    lat: 29.3,
    heightM: 1_800_000,
    blurb: "Hurricane Katrina made landfall on the US Gulf Coast on 29 August 2005.",
    wiki: "Hurricane_Katrina",
    replayDays: 10
  },
  {
    id: "black-summer",
    title: "Australia's Black Summer bushfires",
    when: "Jan 2020",
    date: "2020-01-04",
    lon: 149.0,
    lat: -36.5,
    heightM: 2_400_000,
    blurb: "Australia's 2019–20 bushfire season burned more than 18 million hectares; smoke crossed the Tasman Sea to New Zealand.",
    wiki: "2019–20_Australian_bushfire_season",
    replayDays: 30
  },
  {
    id: "eyjafjallajokull",
    title: "Eyjafjallajökull ash cloud",
    when: "17 Apr 2010",
    date: "2010-04-17",
    lon: -19.6,
    lat: 63.63,
    heightM: 2_600_000,
    blurb: "Ash from Iceland's Eyjafjallajökull eruption grounded much of Europe's air traffic in April 2010.",
    wiki: "2010_eruptions_of_Eyjafjallajökull",
    replayDays: 10
  },
  {
    id: "amazon-2019",
    title: "Amazon fires",
    when: "Aug 2019",
    date: "2019-08-23",
    lon: -60.0,
    lat: -9.0,
    heightM: 3_200_000,
    blurb: "In August 2019 fires across the Amazon basin drew worldwide attention.",
    wiki: "2019_Amazon_rainforest_wildfires",
    replayDays: 20
  },
  {
    id: "aral-sea",
    title: "The shrinking Aral Sea",
    when: "2000 → today",
    date: "2000-08-25",
    lon: 60.0,
    lat: 45.0,
    heightM: 750_000,
    blurb: "The Aral Sea has shrunk dramatically since the 1960s. Drag the date from 2000 to today and watch the eastern basin dry out.",
    wiki: "Aral_Sea"
  },
  {
    id: "dday-1944",
    title: "D-Day, Normandy",
    when: "6 Jun 1944",
    era: [1944.4, 1944.65],
    lon: -0.9,
    lat: 49.4,
    heightM: 600_000,
    blurb: "On 6 June 1944 Allied forces landed on five Normandy beaches in the largest seaborne invasion in history. (Satellite imagery only goes back to 2000, so this one shows the battles layer.)",
    wiki: "Normandy_landings"
  },
  {
    id: "stalingrad-1942",
    title: "Battle of Stalingrad",
    when: "Aug 1942 – Feb 1943",
    era: [1942.6, 1943.2],
    lon: 44.5,
    lat: 48.7,
    heightM: 1_000_000,
    blurb: "One of the largest and bloodiest battles of the Second World War, fought around the Volga city of Stalingrad.",
    wiki: "Battle_of_Stalingrad"
  },
  {
    id: "gettysburg-1863",
    title: "Battle of Gettysburg",
    when: "1–3 Jul 1863",
    era: [1863, 1864],
    lon: -77.23,
    lat: 39.83,
    heightM: 700_000,
    blurb: "The largest battle of the American Civil War, fought in Pennsylvania over three days in July 1863.",
    wiki: "Battle_of_Gettysburg"
  },
  {
    id: "waterloo-1815",
    title: "Battle of Waterloo",
    when: "18 Jun 1815",
    era: [1815.3, 1815.7],
    lon: 4.41,
    lat: 50.68,
    heightM: 500_000,
    blurb: "Napoleon's final defeat, at the hands of the Duke of Wellington's Anglo-allied army and Blücher's Prussians.",
    wiki: "Battle_of_Waterloo"
  },
  {
    id: "hastings-1066",
    title: "Battle of Hastings",
    when: "14 Oct 1066",
    era: [1066, 1067],
    lon: 0.49,
    lat: 50.91,
    heightM: 450_000,
    blurb: "William of Normandy defeated King Harold II of England near Hastings, beginning the Norman conquest.",
    wiki: "Battle_of_Hastings"
  }
];

const ERAS: Array<{ label: string; from: number; to: number }> = [
  { label: "All of history", from: -3000, to: 2100 },
  { label: "Ancient world (to AD 500)", from: -3000, to: 500 },
  { label: "Middle Ages (500–1500)", from: 500, to: 1500 },
  { label: "Early modern (1500–1800)", from: 1500, to: 1800 },
  { label: "Napoleonic Wars (1792–1815)", from: 1792, to: 1816 },
  { label: "American Civil War (1861–65)", from: 1861, to: 1866 },
  { label: "World War I (1914–18)", from: 1914, to: 1919 },
  { label: "World War II (1939–45)", from: 1939, to: 1946 },
  { label: "Cold War (1946–91)", from: 1946, to: 1992 },
  { label: "Since 2000", from: 2000, to: 2100 }
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** "-0044-03-15" -> -43.8; "1944-06-06" -> 1944.43. */
function yearFrac(iso: string): number {
  const m = /^(-?)(\d+)-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  const y = (m[1] === "-" ? -1 : 1) * Number(m[2]);
  return y + (Number(m[3]) - 1) / 12 + (Number(m[4]) - 1) / 365;
}

function prettyDate(iso: string): string {
  const m = /^(-?)(\d+)-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const y = Number(m[2]);
  const era = m[1] === "-" ? `${y} BCE` : String(y);
  if (m[3] === "01" && m[4] === "01") return era;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[4])} ${months[Number(m[3]) - 1]} ${era}`;
}

function isoUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoUtc(d);
}

function dayIndex(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${FIRST_IMAGE_DAY}T00:00:00Z`)) / 86_400_000);
}

const battleIcons = new Map<string, string>();
function battleUri(): string {
  let u = battleIcons.get("b");
  if (u) return u;
  const c = document.createElement("canvas");
  c.width = c.height = 40;
  const g = c.getContext("2d");
  if (!g) return "";
  g.beginPath();
  g.arc(20, 20, 13, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,69,58,0.95)";
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = "#fff";
  g.stroke();
  g.lineWidth = 3;
  g.lineCap = "round";
  g.strokeStyle = "#fff";
  g.beginPath();
  g.moveTo(14, 14);
  g.lineTo(26, 26);
  g.moveTo(26, 14);
  g.lineTo(14, 26);
  g.stroke();
  u = c.toDataURL("image/png");
  battleIcons.set("b", u);
  return u;
}

function battleClusterUri(n: number): string {
  const label = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const hit = battleIcons.get(label);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 80;
  const g = c.getContext("2d");
  if (!g) return battleUri();
  g.beginPath();
  g.arc(40, 40, 36, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,69,58,0.28)";
  g.fill();
  g.beginPath();
  g.arc(40, 40, 28, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,69,58,0.95)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "#fff";
  g.stroke();
  g.fillStyle = "#fff";
  g.font = '700 25px -apple-system, "SF Pro Text", Inter, sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 40, 42);
  const uri = c.toDataURL("image/png");
  battleIcons.set(label, uri);
  return uri;
}

export function registerHistory(host: LayerHost): void {
  const viewer = host.viewer;
  const ds = new CustomDataSource("history-battles");
  ds.show = false;
  void viewer.dataSources.add(ds);

  const cl = ds.clustering;
  cl.enabled = true;
  cl.pixelRange = 36;
  cl.minimumClusterSize = 4;
  cl.clusterBillboards = true;
  cl.clusterLabels = false;
  cl.clusterPoints = false;
  cl.clusterEvent.addEventListener((clustered, cluster) => {
    cluster.label.show = false;
    cluster.billboard.show = true;
    cluster.billboard.image = battleClusterUri(clustered.length);
    cluster.billboard.width = 38;
    cluster.billboard.height = 38;
    cluster.billboard.verticalOrigin = VerticalOrigin.CENTER;
    cluster.billboard.horizontalOrigin = HorizontalOrigin.CENTER;
    cluster.billboard.disableDepthTestDistance = horizonDistance(host.viewer.camera.positionWC);
    const marker = new Entity({ id: "battle-cluster" });
    (marker as Entity & { cluster?: unknown }).cluster = { clusteredEntities: clustered };
    cluster.billboard.id = marker;
  });

  // ---- state ----
  let battles: Battle[] = [];
  const byEntity = new Map<string, Battle>();
  const years = new Map<string, number>();
  let battlesOn = true;
  let imageryOn = true;
  let eraFrom = -3000;
  let eraTo = 2100;
  let playingBattles = false;
  let battleTimer: number | null = null;
  let windowEnd = 0;
  let windowWidth = 1;

  let imgLayer: ImageryLayer | null = null;
  let imgDay = isoUtc(new Date(Date.now() - 2 * 86_400_000));
  const lastDay = isoUtc(new Date(Date.now() - 86_400_000));
  let imgPlaying = false;
  let imgTimer: number | null = null;
  let imgStep = 1;

  let panel: HTMLElement | null = null;
  const ui: Record<string, HTMLElement> = {};

  // ---- imagery ----
  function applyImagery(): void {
    const old = imgLayer;
    imgLayer = null;
    if (imageryOn) {
      const name = imgDay >= VIIRS_FROM ? "VIIRS_SNPP_CorrectedReflectance_TrueColor" : "MODIS_Terra_CorrectedReflectance_TrueColor";
      const provider = new UrlTemplateImageryProvider({
        url: `${GIBS}/${name}/default/${imgDay}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
        tilingScheme: new WebMercatorTilingScheme(),
        maximumLevel: 9,
        credit: `Imagery: NASA GIBS · ${imgDay >= VIIRS_FROM ? "VIIRS" : "MODIS Terra"} · ${imgDay}`
      });
      imgLayer = viewer.imageryLayers.addImageryProvider(provider);
    }
    // The new day sits on top of the old one, which stays underneath until the new tiles have had time to arrive.
    if (old) window.setTimeout(() => viewer.imageryLayers.remove(old, true), 2600);
    viewer.scene.requestRender();
  }

  function setDay(day: string, apply = true): void {
    const clamped = day < FIRST_IMAGE_DAY ? FIRST_IMAGE_DAY : day > lastDay ? lastDay : day;
    imgDay = clamped;
    const slider = ui.slider as HTMLInputElement | undefined;
    const date = ui.date as HTMLInputElement | undefined;
    if (slider) slider.value = String(dayIndex(clamped));
    if (date) date.value = clamped;
    if (ui.dayLabel) ui.dayLabel.textContent = prettyDate(clamped);
    publishDate(clamped);
    if (apply) applyImagery();
  }

  function setImgPlaying(on: boolean): void {
    imgPlaying = on;
    if (ui.imgPlay) ui.imgPlay.textContent = on ? "Pause" : "Play";
    if (imgTimer != null) window.clearInterval(imgTimer);
    imgTimer = null;
    if (on) {
      imgTimer = window.setInterval(() => {
        if (imgDay >= lastDay) {
          setImgPlaying(false);
          return;
        }
        setDay(addDays(imgDay, imgStep));
      }, 900);
    }
  }

  // ---- battles ----
  function drawBattles(): void {
    ds.entities.suspendEvents();
    ds.entities.removeAll();
    byEntity.clear();
    let from = eraFrom;
    let to = eraTo;
    if (playingBattles) {
      from = windowEnd - windowWidth;
      to = windowEnd;
    }
    let shown = 0;
    const ground = groundHeightReference(Math.min(battles.length, 12_000));
    for (const b of battles) {
      const y = years.get(b[0])!;
      if (y < from || y > to) continue;
      if (shown >= 12_000) break;
      shown++;
      const id = `battle-${b[0]}`;
      byEntity.set(id, b);
      const age = playingBattles ? Math.max(0, Math.min(1, (windowEnd - y) / windowWidth)) : 0;
      ds.entities.add({
        id,
        position: Cartesian3.fromDegrees(b[3], b[2], 0),
        billboard: {
          image: battleUri(),
          width: 24,
          height: 24,
          color: Color.WHITE.withAlpha(playingBattles ? 0.3 + 0.7 * (1 - age) : 0.95),
          scaleByDistance: new NearFarScalar(1e5, 1.2, 3e7, 0.55),
          heightReference: ground,
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        }
      });
    }
    ds.entities.resumeEvents();
    const label = playingBattles
      ? `${shown} battles · ${formatYear(from)} – ${formatYear(to)}`
      : `${shown.toLocaleString()} battles · ${formatYear(eraFrom)} – ${formatYear(eraTo)}`;
    if (ui.battleCount) ui.battleCount.textContent = label;
    host.setStatus("history", imageryOn ? prettyDate(imgDay) : battlesOn ? `${shown.toLocaleString()} battles` : "");
    viewer.scene.requestRender();
  }

  function formatYear(y: number): string {
    if (y <= -3000) return "3000 BCE";
    if (y >= 2100) return "today";
    const r = Math.floor(y);
    return r < 0 ? `${-r} BCE` : String(r);
  }

  function setBattlesPlaying(on: boolean): void {
    playingBattles = on;
    if (ui.battlePlay) ui.battlePlay.textContent = on ? "Stop" : "Play through time";
    if (battleTimer != null) window.clearInterval(battleTimer);
    battleTimer = null;
    if (on) {
      const hi = Math.min(eraTo, new Date().getUTCFullYear() + 1);
      const lo = Math.max(eraFrom, -3000);
      const span = Math.max(1, hi - lo);
      windowWidth = Math.max(0.2, span / 40);
      windowEnd = lo + windowWidth;
      const step = Math.max(0.05, span / 160);
      battleTimer = window.setInterval(() => {
        windowEnd += step;
        if (windowEnd > hi + windowWidth) {
          setBattlesPlaying(false);
          return;
        }
        drawBattles();
        if (ui.battleCount) ui.battleCount.textContent += ` · now ${formatYear(windowEnd)}`;
      }, 350);
    }
    drawBattles();
  }

  async function loadBattles(): Promise<void> {
    if (battles.length) return;
    const res = await fetch("/api/layers/battles");
    if (!res.ok) throw new Error("Battle data unavailable");
    battles = ((await res.json()) as { battles: Battle[] }).battles;
    for (const b of battles) years.set(b[0], yearFrac(b[4]));
  }

  function setEra(from: number, to: number): void {
    setBattlesPlaying(false);
    eraFrom = from;
    eraTo = to;
    const fi = ui.fromYear as HTMLInputElement | undefined;
    const ti = ui.toYear as HTMLInputElement | undefined;
    if (fi) fi.value = String(Math.max(-3000, Math.floor(from)));
    if (ti) ti.value = String(Math.min(2100, Math.ceil(to)));
    if (battlesOn) drawBattles();
  }

  // ---- events ----
  function showEventCard(e: HistoricEvent): void {
    showLayerCard({
      kicker: e.when,
      title: e.title,
      body: el("p", "layer-panel-note", e.blurb),
      actions: [
        ...(e.date && e.replayDays
          ? [
              {
                label: `Replay ${e.replayDays} days`,
                primary: true,
                run: () => {
                  setDay(e.date!);
                  imgStep = 1;
                  setImgPlaying(true);
                  if (ui.speed) ui.speed.textContent = "1 day / step";
                  stopAfter(e.replayDays!);
                }
              }
            ]
          : [])
      ],
      links: [{ label: "Wikipedia", href: `https://en.wikipedia.org/wiki/${e.wiki}` }]
    });
  }

  let replayStopAt: string | null = null;
  function stopAfter(days: number): void {
    replayStopAt = addDays(imgDay, days);
    const watch = window.setInterval(() => {
      if (!imgPlaying) {
        window.clearInterval(watch);
        return;
      }
      if (replayStopAt && imgDay >= replayStopAt) {
        setImgPlaying(false);
        replayStopAt = null;
        window.clearInterval(watch);
      }
    }, 300);
  }

  function goTo(e: HistoricEvent): void {
    setImgPlaying(false);
    setBattlesPlaying(false);
    if (e.date) {
      imageryOn = true;
      (ui.imageryToggle as HTMLInputElement).checked = true;
      setDay(e.date);
    }
    if (e.era) {
      battlesOn = true;
      (ui.battlesToggle as HTMLInputElement).checked = true;
      ds.show = true;
      setEra(e.era[0], e.era[1]);
    } else if (!e.date) {
      // nothing to change
    }
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(e.lon, e.lat, e.heightM), duration: 2.6 });
    showEventCard(e);
  }

  // ---- panel ----
  function buildPanel(): void {
    const extras = document.getElementById("layer-extras");
    if (!extras || panel) return;
    panel = el("div", "layer-panel hist-panel");
    panel.id = "history-panel";
    panel.append(el("div", "layer-panel-title", "Time machine"));

    // Events
    const sel = el("select", "hist-select");
    sel.setAttribute("aria-label", "Jump to an event");
    const ph = el("option", undefined, "Jump to an event…");
    ph.value = "";
    sel.append(ph);
    const modern = el("optgroup");
    modern.label = "With satellite imagery (2000 →)";
    const old = el("optgroup");
    old.label = "Earlier history (battles layer)";
    for (const e of EVENTS) {
      const o = el("option", undefined, `${e.title} · ${e.when}`);
      o.value = e.id;
      (e.date ? modern : old).append(o);
    }
    sel.append(modern, old);
    sel.addEventListener("change", () => {
      const e = EVENTS.find((x) => x.id === sel.value);
      if (e) goTo(e);
      sel.value = "";
    });
    panel.append(sel);

    // Satellite imagery by day
    const imgHead = el("label", "hist-check");
    const imgToggle = el("input");
    imgToggle.type = "checkbox";
    imgToggle.checked = true;
    imgToggle.addEventListener("change", () => {
      imageryOn = imgToggle.checked;
      if (!imageryOn) setImgPlaying(false);
      applyImagery();
    });
    ui.imageryToggle = imgToggle;
    imgHead.append(imgToggle, el("span", undefined, "Earth as it looked on"));
    ui.dayLabel = el("strong", "hist-day", prettyDate(imgDay));
    imgHead.append(ui.dayLabel);

    const slider = el("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(dayIndex(lastDay));
    slider.step = "1";
    slider.setAttribute("aria-label", "Satellite imagery day");
    slider.addEventListener("input", () => {
      setImgPlaying(false);
      setDay(addDays(FIRST_IMAGE_DAY, Number(slider.value)));
    });
    ui.slider = slider;

    const row = el("div", "layer-panel-row hist-row");
    const date = el("input", "hist-date");
    date.type = "date";
    date.min = FIRST_IMAGE_DAY;
    date.max = lastDay;
    date.addEventListener("change", () => {
      if (date.value) {
        setImgPlaying(false);
        setDay(date.value);
      }
    });
    ui.date = date;
    const play = el("button", "layer-card-btn primary", "Play");
    play.type = "button";
    play.addEventListener("click", () => {
      if (!imageryOn) {
        imgToggle.checked = true;
        imageryOn = true;
        applyImagery();
      }
      setImgPlaying(!imgPlaying);
    });
    ui.imgPlay = play;
    const speed = el("button", "layer-card-btn", "1 day / step");
    speed.type = "button";
    const speeds: Array<[number, string]> = [
      [1, "1 day / step"],
      [7, "1 week / step"],
      [30, "1 month / step"],
      [91, "1 quarter / step"]
    ];
    speed.addEventListener("click", () => {
      const i = speeds.findIndex((s) => s[0] === imgStep);
      const next = speeds[(i + 1) % speeds.length]!;
      imgStep = next[0];
      speed.textContent = next[1];
    });
    ui.speed = speed;
    const today = el("button", "layer-card-btn", "Latest");
    today.type = "button";
    today.addEventListener("click", () => {
      setImgPlaying(false);
      setDay(lastDay);
    });
    row.append(date, play, speed, today);
    panel.append(imgHead, slider, row, el("p", "layer-panel-note", "NASA daily true-colour mosaics from 24 Feb 2000 (Terra, then VIIRS from 2012). Clouds, swath gaps and haze are real."));

    // Battles
    const bHead = el("label", "hist-check");
    const bToggle = el("input");
    bToggle.type = "checkbox";
    bToggle.checked = true;
    bToggle.addEventListener("change", () => {
      battlesOn = bToggle.checked;
      ds.show = battlesOn;
      if (!battlesOn) setBattlesPlaying(false);
      else drawBattles();
      viewer.scene.requestRender();
    });
    ui.battlesToggle = bToggle;
    bHead.append(bToggle, el("span", undefined, "Battles & conflicts"));
    const era = el("select", "hist-select");
    era.setAttribute("aria-label", "Era");
    for (const [i, e] of ERAS.entries()) {
      const o = el("option", undefined, e.label);
      o.value = String(i);
      era.append(o);
    }
    era.addEventListener("change", () => {
      const e = ERAS[Number(era.value)]!;
      setEra(e.from, e.to);
    });
    const yrs = el("div", "layer-panel-row hist-row");
    const fi = el("input", "hist-year");
    fi.type = "number";
    fi.value = "-3000";
    fi.setAttribute("aria-label", "From year");
    const ti = el("input", "hist-year");
    ti.type = "number";
    ti.value = "2100";
    ti.setAttribute("aria-label", "To year");
    const applyYears = (): void => {
      const f = Number(fi.value);
      const t = Number(ti.value);
      if (Number.isFinite(f) && Number.isFinite(t) && f < t) setEra(f, t);
    };
    fi.addEventListener("change", applyYears);
    ti.addEventListener("change", applyYears);
    ui.fromYear = fi;
    ui.toYear = ti;
    yrs.append(el("span", "layer-panel-note", "From"), fi, el("span", "layer-panel-note", "to"), ti);
    const bPlay = el("button", "layer-card-btn primary", "Play through time");
    bPlay.type = "button";
    bPlay.addEventListener("click", () => {
      if (!battlesOn) {
        bToggle.checked = true;
        battlesOn = true;
        ds.show = true;
      }
      setBattlesPlaying(!playingBattles);
    });
    ui.battlePlay = bPlay;
    ui.battleCount = el("p", "layer-panel-note", "Loading battles…");
    panel.append(bHead, era, yrs, bPlay, ui.battleCount, el("p", "layer-panel-note", "Battles: Wikidata (CC0). Dates are as recorded there; older battles are often known only by year."));
    extras.append(panel);
    setDay(imgDay, false);
  }

  host.register({
    id: "history",
    label: "Time machine",
    group: "History",
    hint: "Go back in time: daily satellite imagery since 2000, ~9,500 battles from antiquity to today, and a list of notable events with replays.",
    async enable() {
      ds.show = true;
      setHistoryActive(true);
      buildPanel();
      await loadBattles();
      drawBattles();
      applyImagery();
    },
    disable() {
      setHistoryActive(false);
      setImgPlaying(false);
      setBattlesPlaying(false);
      ds.show = false;
      ds.entities.removeAll();
      if (imgLayer) viewer.imageryLayers.remove(imgLayer, true);
      imgLayer = null;
      panel?.remove();
      panel = null;
      for (const k of Object.keys(ui)) delete ui[k];
      hideLayerCard();
    },
    onPick(entity) {
      const id = typeof entity.id === "string" ? entity.id : "";
      if (id === "battle-cluster") {
        const clustered = (entity as Entity & { cluster?: { clusteredEntities: Entity[] } }).cluster?.clusteredEntities ?? [];
        const pts: Cartesian3[] = [];
        for (const e of clustered) {
          const p = e.position?.getValue(JulianDate.now());
          if (p) pts.push(p);
        }
        if (pts.length) {
          const bs = BoundingSphere.fromPoints(pts);
          bs.radius = Math.max(bs.radius * 1.6, 8000);
          viewer.camera.flyToBoundingSphere(bs, { duration: 1.1 });
        }
        return true;
      }
      const b = byEntity.get(id);
      if (!b) return false;
      const [, name, lat, lon, date, end, conflict, wiki] = b;
      const rows: Array<[string, string]> = [["Date", end && end !== date ? `${prettyDate(date)} – ${prettyDate(end)}` : prettyDate(date)]];
      if (conflict) rows.push(["Part of", conflict]);
      rows.push(["Location", `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`]);
      const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
      showLayerCard({
        kicker: "Battle",
        title: name,
        rows,
        actions: [
          {
            label: "Fly to",
            primary: true,
            run: () => viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, 120_000), duration: 2 })
          },
          ...(day >= FIRST_IMAGE_DAY && day <= lastDay
            ? [
                {
                  label: "Satellite view of that day",
                  run: () => {
                    imageryOn = true;
                    (ui.imageryToggle as HTMLInputElement).checked = true;
                    setImgPlaying(false);
                    setDay(day);
                    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, 250_000), duration: 2 });
                  }
                }
              ]
            : [])
        ],
        links: wiki ? [{ label: "Wikipedia", href: `https://en.wikipedia.org/wiki/${wiki}` }] : []
      });
      return true;
    }
  });
}
