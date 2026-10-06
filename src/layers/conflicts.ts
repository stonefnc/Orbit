import { BoundingSphere, Cartesian3, Color, CustomDataSource, Entity, JulianDate, NearFarScalar } from "cesium";
import type { LayerHost } from "./layerHost";
import { hideLayerCard, showLayerCard } from "./layerCard";
import { enableBubbleClusters } from "./bubbles";
import { currentDate, isHistoryActive, subscribeDate } from "./timeBus";
import { horizonDepthTest } from "../horizon";
import { groundHeightReference } from "../groundAnchor";

/**
 * Conflict watch: georeferenced armed-conflict events from UCDP (state-based, non-state and one-sided violence),
 * shown for a window of days ending on an "as of" date that you can scrub and play — or that follows the Time
 * machine's date. A news panel tracks the latest developments: live headlines (GDELT) and the reports UCDP's newest
 * events were coded from. Featured: Russia–Ukraine and Israel–Gaza/West Bank/Lebanon, plus the world's other most active
 * conflicts.
 */
type Summary = { id: string; label: string; blurb?: string; featured: boolean; events30d: number; deaths30d: number; lastDate: string | null };
type Ev = {
  id: string;
  d: string;
  lat: number;
  lon: number;
  best: number;
  low: number;
  high: number;
  civilians: number;
  v: number;
  conflict: string;
  a: string;
  b: string;
  where: string;
  country: string;
  p: number;
  span: number;
  src: Array<{ s: string; d: string; h: string }>;
};
type EventsResponse = { status: string; events: Ev[]; total: number; roughHidden: number; roughDeaths: number };
type Update = { source: string; date: string; headline: string; where: string; deaths: number };
type NewsItem = { title: string; url: string; domain: string; seen: string };

const FIRST_DAY = "2014-01-01";
const VIOLENCE: Record<number, { label: string; color: string }> = {
  1: { label: "State-based armed conflict", color: "#ff453a" },
  2: { label: "Non-state conflict", color: "#ff9f0a" },
  3: { label: "One-sided violence against civilians", color: "#bf5af2" }
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dayIdx = (iso: string): number => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${FIRST_DAY}T00:00:00Z`)) / 86_400_000);
const pretty = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

const icons = new Map<string, string>();
function dotUri(color: string): string {
  const hit = icons.get(color);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d");
  if (!g) return "";
  const grad = g.createRadialGradient(24, 24, 3, 24, 24, 22);
  grad.addColorStop(0, `${color}d0`);
  grad.addColorStop(1, `${color}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 48, 48);
  g.beginPath();
  g.arc(24, 24, 9, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.stroke();
  const uri = c.toDataURL("image/png");
  icons.set(color, uri);
  return uri;
}

export function registerConflicts(host: LayerHost): void {
  const viewer = host.viewer;
  const ds = new CustomDataSource("conflicts");
  ds.show = false;
  void viewer.dataSources.add(ds);
  enableBubbleClusters(ds, viewer.camera, "conflict-cluster", "#ff453a");

  let featured: Summary[] = [];
  let others: Summary[] = [];
  let dataThrough = "";
  let conflictId = "ukraine";
  let asOf = "";
  let windowDays = 30;
  let sync = false;
  let playing = false;
  let timer: number | null = null;
  let step = 7;
  // Separate counters so a news reply can't cancel an events reply (or the other way round); `life` changes on every
  // disable(), so work started before the layer was switched off stops at its next await.
  let fetchSeq = 0;
  let newsSeq = 0;
  let life = 0;
  const byId = new Map<string, Ev>();
  let unsub: (() => void) | null = null;
  let newsTab: "live" | "reports" = "live";

  let panel: HTMLElement | null = null;
  const ui: Record<string, HTMLElement> = {};

  function label(): string {
    return [...featured, ...others].find((c) => c.id === conflictId)?.label ?? "conflict";
  }

  // ---- events on the map ----
  async function loadEvents(): Promise<void> {
    if (!asOf) return;
    const mine = ++fetchSeq;
    const from = addDays(asOf, -(windowDays - 1));
    const res = await fetch(`/api/layers/conflicts/events?c=${encodeURIComponent(conflictId)}&from=${from}&to=${asOf}&limit=3000`);
    if (mine !== fetchSeq) return;
    if (!res.ok) throw new Error("Conflict data unavailable");
    const j = (await res.json()) as EventsResponse;
    if (mine !== fetchSeq || j.status !== "ready") return;
    byId.clear();
    ds.entities.suspendEvents();
    ds.entities.removeAll();
    let deaths = 0;
    const ground = groundHeightReference(j.events.length);
    const end = Date.parse(`${asOf}T00:00:00Z`);
    for (const e of j.events) {
      byId.set(`conflict-${e.id}`, e);
      deaths += e.best;
      const age = Math.max(0, Math.min(1, (end - Date.parse(`${e.d}T00:00:00Z`)) / 86_400_000 / windowDays));
      const v = VIOLENCE[e.v] ?? VIOLENCE[1]!;
      ds.entities.add({
        id: `conflict-${e.id}`,
        position: Cartesian3.fromDegrees(e.lon, e.lat, 0),
        billboard: {
          image: dotUri(v.color),
          width: 26,
          height: 26,
          scale: Math.min(2.1, 0.62 + Math.sqrt(Math.max(0, e.best)) * 0.17),
          color: Color.WHITE.withAlpha(0.35 + 0.65 * (1 - age)),
          scaleByDistance: new NearFarScalar(1e5, 1.15, 2.5e7, 0.5),
          heightReference: ground,
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        }
      });
    }
    ds.entities.resumeEvents();
    const rough = j.roughHidden ? ` · ${j.roughHidden} country-level estimates (~${j.roughDeaths.toLocaleString()} deaths) not mapped` : "";
    if (ui.stats) {
      ui.stats.textContent = `${j.events.length.toLocaleString()} events · ${deaths.toLocaleString()} reported deaths · ${windowDays} days to ${pretty(asOf)}${rough}`;
    }
    host.setStatus("conflicts", `${j.events.length} events · to ${pretty(asOf)} · data ~1 month behind`);
    viewer.scene.requestRender();
  }

  function setAsOf(day: string, reload = true): void {
    const clamped = day < FIRST_DAY ? FIRST_DAY : day > dataThrough ? dataThrough : day;
    asOf = clamped;
    (ui.slider as HTMLInputElement | undefined)?.setAttribute("value", String(dayIdx(clamped)));
    if (ui.slider) (ui.slider as HTMLInputElement).value = String(dayIdx(clamped));
    if (ui.dayLabel) ui.dayLabel.textContent = pretty(clamped);
    if (reload) void loadEvents().catch(() => {});
  }

  function setPlaying(on: boolean): void {
    playing = on;
    if (ui.play) ui.play.textContent = on ? "Pause" : "Play";
    if (timer != null) window.clearInterval(timer);
    timer = null;
    if (on) {
      timer = window.setInterval(() => {
        if (asOf >= dataThrough) {
          setPlaying(false);
          return;
        }
        setAsOf(addDays(asOf, step));
      }, 1100);
    }
  }

  // ---- news / updates ----
  async function loadNews(): Promise<void> {
    const box = ui.news;
    if (!box) return;
    box.textContent = "";
    box.append(el("p", "layer-panel-note", "Loading the latest…"));
    const mine = ++newsSeq;
    const out = el("div", "conf-news-list");
    if (newsTab === "live") {
      const isFeatured = featured.some((f) => f.id === conflictId);
      let items: NewsItem[] = [];
      let stale = false;
      if (isFeatured) {
        try {
          const r = await fetch(`/api/layers/conflicts/news?c=${encodeURIComponent(conflictId)}`);
          if (r.ok) {
            const j = (await r.json()) as { items: NewsItem[]; stale: boolean };
            items = j.items;
            stale = j.stale;
          }
        } catch {
          /* fall through to the empty note */
        }
      }
      if (mine !== newsSeq || ui.news !== box) return;
      box.textContent = "";
      if (!isFeatured) box.append(el("p", "layer-panel-note", "Live headlines are tracked for the two featured conflicts. See “Reported events” for this one."));
      else if (!items.length) box.append(el("p", "layer-panel-note", "Live headlines are unavailable right now (the news index is rate-limited). Try again in a minute, or open “Reported events”."));
      else {
        for (const it of items) {
          const a = el("a", "conf-news-item");
          a.href = it.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.append(el("span", undefined, it.title), el("small", undefined, `${it.domain}${it.seen ? ` · ${new Date(it.seen).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}`));
          out.append(a);
        }
        box.append(out);
        if (stale) box.append(el("p", "layer-panel-note", "Showing the last list we could fetch."));
      }
    } else {
      let ups: Update[] = [];
      try {
        const r = await fetch(`/api/layers/conflicts/updates?c=${encodeURIComponent(conflictId)}&days=30`);
        if (r.ok) ups = ((await r.json()) as { updates?: Update[] }).updates ?? [];
      } catch {
        /* empty list below */
      }
      if (mine !== newsSeq || ui.news !== box) return;
      box.textContent = "";
      if (!ups.length) box.append(el("p", "layer-panel-note", "No reports in the newest data for this conflict."));
      for (const u of ups) {
        const row = el("div", "conf-news-item static");
        row.append(
          el("span", undefined, u.headline),
          el("small", undefined, `${u.source} · ${u.date}${u.where ? ` · ${u.where}` : ""}${u.deaths ? ` · ${u.deaths} killed` : ""}`)
        );
        out.append(row);
      }
      box.append(out);
      box.append(el("p", "layer-panel-note", `UCDP data runs to ${dataThrough ? pretty(dataThrough) : "last month"}; live headlines are newer.`));
    }
  }

  // ---- panel ----
  function buildPanel(): void {
    const extras = document.getElementById("layer-extras");
    if (!extras || panel) return;
    panel = el("div", "layer-panel conf-panel");
    panel.id = "conflicts-panel";
    panel.append(el("div", "layer-panel-title", "Conflict watch"));

    const sel = el("select", "hist-select");
    sel.setAttribute("aria-label", "Conflict");
    const g1 = el("optgroup");
    g1.label = "Featured";
    for (const f of featured) {
      const o = el("option", undefined, `${f.label} · ${f.events30d.toLocaleString()} events / 30 d`);
      o.value = f.id;
      g1.append(o);
    }
    const g2 = el("optgroup");
    g2.label = "Other active conflicts";
    for (const f of others) {
      const o = el("option", undefined, `${f.label.length > 52 ? `${f.label.slice(0, 50)}…` : f.label} · ${f.events30d} / 30 d`);
      o.value = f.id;
      g2.append(o);
    }
    sel.append(g1, g2);
    sel.value = conflictId;
    sel.addEventListener("change", () => {
      conflictId = sel.value;
      setPlaying(false);
      void loadEvents().catch(() => {});
      void loadNews();
      flyToConflict();
    });
    panel.append(sel);

    ui.stats = el("p", "layer-panel-note conf-stats", "Loading events…");
    panel.append(ui.stats);

    // Date controls
    const head = el("div", "layer-panel-row conf-asof");
    head.append(el("span", "layer-panel-note", "As of"));
    ui.dayLabel = el("strong", "hist-day", asOf ? pretty(asOf) : "");
    head.append(ui.dayLabel);
    const slider = el("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(dayIdx(dataThrough));
    slider.step = "1";
    slider.setAttribute("aria-label", "As-of date");
    slider.addEventListener("input", () => {
      setPlaying(false);
      setAsOf(addDays(FIRST_DAY, Number(slider.value)));
    });
    ui.slider = slider;

    const row = el("div", "layer-panel-row hist-row");
    const play = el("button", "layer-card-btn primary", "Play");
    play.type = "button";
    play.addEventListener("click", () => {
      if (sync) return;
      if (asOf >= dataThrough) setAsOf(addDays(dataThrough, -90));
      setPlaying(!playing);
    });
    ui.play = play;
    // The panel is rebuilt on every enable(); step, window and sync keep their values, so the controls start from them.
    const speeds: Array<[number, string]> = [
      [1, "1 day / step"],
      [7, "1 week / step"],
      [30, "1 month / step"]
    ];
    const spd = el("button", "layer-card-btn", speeds.find((s) => s[0] === step)?.[1] ?? "1 week / step");
    spd.type = "button";
    spd.addEventListener("click", () => {
      const i = speeds.findIndex((s) => s[0] === step);
      const n = speeds[(i + 1) % speeds.length]!;
      step = n[0];
      spd.textContent = n[1];
    });
    const win = el("button", "layer-card-btn", `${windowDays}-day window`);
    win.type = "button";
    const wins = [7, 30, 90];
    win.addEventListener("click", () => {
      windowDays = wins[(wins.indexOf(windowDays) + 1) % wins.length]!;
      win.textContent = `${windowDays}-day window`;
      void loadEvents().catch(() => {});
    });
    const latest = el("button", "layer-card-btn", "Latest");
    latest.type = "button";
    latest.addEventListener("click", () => {
      setPlaying(false);
      setAsOf(dataThrough);
    });
    row.append(play, spd, win, latest);

    const syncLabel = el("label", "hist-check");
    const syncBox = el("input");
    syncBox.type = "checkbox";
    syncBox.checked = sync;
    slider.disabled = sync;
    play.toggleAttribute("disabled", sync);
    syncBox.addEventListener("change", () => {
      sync = syncBox.checked;
      slider.disabled = sync;
      play.toggleAttribute("disabled", sync);
      if (sync) {
        setPlaying(false);
        const d = currentDate();
        if (d) setAsOf(d);
      }
    });
    ui.sync = syncBox;
    syncLabel.append(syncBox, el("span", undefined, "Follow the Time machine date"));
    syncLabel.title = "Turn the Time machine on, then scrub or play it: the conflict events follow its date";

    panel.append(head, slider, row, syncLabel);

    // Legend
    const legend = el("div", "conf-legend");
    for (const k of [1, 2, 3]) {
      const v = VIOLENCE[k]!;
      const s = el("span", "conf-legend-item");
      const dot = el("i");
      dot.style.background = v.color;
      s.append(dot, document.createTextNode(v.label));
      legend.append(s);
    }
    panel.append(legend, el("p", "layer-panel-note", "Bigger dot = more reported deaths. Fainter = older within the window."));

    // News tabs
    const tabs = el("div", "layer-panel-row conf-tabs");
    for (const [id, text] of [["live", "Live headlines"], ["reports", "Reported events"]] as const) {
      const b = el("button", `layer-card-btn${id === newsTab ? " primary" : ""}`, text);
      b.type = "button";
      b.addEventListener("click", () => {
        newsTab = id;
        for (const sib of tabs.querySelectorAll("button")) sib.classList.toggle("primary", sib === b);
        void loadNews();
      });
      tabs.append(b);
    }
    ui.news = el("div", "conf-news");
    panel.append(tabs, ui.news);
    panel.append(
      el(
        "p",
        "layer-panel-note",
        "Events: Uppsala Conflict Data Program (UCDP GED & candidate releases, CC BY 4.0) — one coded event can lag reality and totals are estimates. Headlines: GDELT."
      )
    );
    extras.append(panel);
    if (asOf) setAsOf(asOf, false);
  }

  function flyToConflict(): void {
    const target = conflictId === "ukraine" ? [31.5, 49.0, 2_000_000] : conflictId === "israel-palestine" ? [35.0, 31.8, 900_000] : null;
    if (target) {
      viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(target[0]!, target[1]!, target[2]!), duration: 2.2 });
      return;
    }
    // Other conflicts: frame the events that are loaded.
    const gen = life;
    window.setTimeout(() => {
      if (gen !== life) return;
      const pts: Cartesian3[] = [];
      for (const e of ds.entities.values) {
        const p = e.position?.getValue(JulianDate.now());
        if (p) pts.push(p);
      }
      if (pts.length) {
        const bs = BoundingSphere.fromPoints(pts);
        bs.radius = Math.max(bs.radius * 1.4, 60_000);
        viewer.camera.flyToBoundingSphere(bs, { duration: 2.2 });
      }
    }, 1400);
  }

  async function loadList(gen: number): Promise<void> {
    for (let i = 0; i < 60; i++) {
      const res = await fetch("/api/layers/conflicts/list");
      if (gen !== life) return;
      if (res.status === 202) {
        host.setStatus("conflicts", "Preparing data (first time ~1 min)…");
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (!res.ok) throw new Error("Conflict data unavailable");
      const j = (await res.json()) as { featured: Summary[]; others: Summary[]; dataThrough: string };
      featured = j.featured;
      others = j.others;
      dataThrough = j.dataThrough;
      return;
    }
    throw new Error("Conflict data is still being prepared — try again shortly");
  }

  host.register({
    id: "conflicts",
    label: "Conflict watch",
    group: "Events",
    hint: "Armed-conflict events (UCDP) for Russia–Ukraine, Israel–Gaza and other active conflicts, with a date scrubber and live headlines.",
    async enable() {
      const gen = life;
      ds.show = true;
      await loadList(gen);
      // Switched off while the list was loading: disable() already cleaned up, so start nothing.
      if (gen !== life) return;
      if (!asOf) asOf = dataThrough;
      buildPanel();
      setAsOf(isHistoryActive() && currentDate() ? currentDate()! : asOf, false);
      unsub = subscribeDate((d) => {
        if (sync) setAsOf(d);
      });
      void loadNews();
      await loadEvents();
      if (gen !== life) return;
      if (!isHistoryActive()) flyToConflict();
    },
    disable() {
      life++;
      fetchSeq++;
      newsSeq++;
      setPlaying(false);
      unsub?.();
      unsub = null;
      ds.show = false;
      ds.entities.removeAll();
      panel?.remove();
      panel = null;
      for (const k of Object.keys(ui)) delete ui[k];
      hideLayerCard();
    },
    onPick(entity) {
      const id = typeof entity.id === "string" ? entity.id : "";
      if (id === "conflict-cluster") {
        const clustered = (entity as Entity & { cluster?: { clusteredEntities: Entity[] } }).cluster?.clusteredEntities ?? [];
        const pts: Cartesian3[] = [];
        for (const e of clustered) {
          const p = e.position?.getValue(JulianDate.now());
          if (p) pts.push(p);
        }
        if (pts.length) {
          const bs = BoundingSphere.fromPoints(pts);
          bs.radius = Math.max(bs.radius * 1.6, 6000);
          viewer.camera.flyToBoundingSphere(bs, { duration: 1.1 });
        }
        return true;
      }
      const e = byId.get(id);
      if (!e) return false;
      const v = VIOLENCE[e.v] ?? VIOLENCE[1]!;
      const rows: Array<[string, string]> = [
        ["Date", e.span > 0 ? `${pretty(e.d)} (+${e.span} d)` : pretty(e.d)],
        ["Where", e.where || e.country],
        ["Sides", `${e.a} — ${e.b}`],
        ["Type", v.label],
        ["Reported deaths", `${e.best.toLocaleString()}${e.low !== e.high ? ` (range ${e.low}–${e.high})` : ""}${e.civilians ? ` · ${e.civilians} civilians` : ""}`]
      ];
      const body = el("div", "conf-sources");
      if (e.src.length) {
        body.append(el("div", "layer-panel-note", "Reported by"));
        for (const s of e.src) body.append(el("p", "conf-source", `${s.s}${s.d ? ` · ${s.d}` : ""}: ${s.h}`));
      }
      showLayerCard({
        kicker: e.conflict,
        title: e.where || e.country,
        rows,
        body,
        actions: [
          {
            label: "Fly to",
            primary: true,
            run: () => viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(e.lon, e.lat, 40_000), duration: 2 })
          }
        ]
      });
      return true;
    }
  });
  void label;
}
