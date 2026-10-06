/**
 * The "Keys" menu: a place to paste the tokens Orbit needs, instead of editing `.env.local` by hand.
 *
 *  - In this browser: the Cesium ion token (imagery, terrain, 3D Photo) and the N2YO key. They are kept in this browser's
 *    storage and only ever sent to the provider they belong to. A page reload applies them.
 *  - On the server: AISStream, OpenSky, ADS-B Exchange, KeepTrack and NASA FIRMS. These are secrets for the server's own
 *    requests, saved to `.env.local` on the computer running Orbit — and only editable from that computer.
 */
export type BrowserKey = "cesium" | "n2yo";
const PREFIX = "orbit-key-";

/** A key saved in this browser, or "" when none. */
export function storedKey(name: BrowserKey): string {
  try {
    return (localStorage.getItem(PREFIX + name) ?? "").trim();
  } catch {
    return "";
  }
}

function saveKey(name: BrowserKey, value: string): void {
  try {
    if (value) localStorage.setItem(PREFIX + name, value);
    else localStorage.removeItem(PREFIX + name);
  } catch {
    /* storage unavailable */
  }
}

type FieldDef = { id: string; label: string; help: string; link?: [string, string]; secret?: boolean };

const SERVER_FIELDS: FieldDef[] = [
  {
    id: "AISSTREAM_API_KEY",
    label: "AISStream key",
    help: "Ships near ports and coasts (SHP layer).",
    link: ["Get one free", "https://aisstream.io/apikeys"]
  },
  {
    id: "OPENSKY_CLIENT_ID",
    label: "OpenSky client ID",
    help: "More reliable aircraft data (optional).",
    link: ["OpenSky account", "https://opensky-network.org/"]
  },
  { id: "OPENSKY_CLIENT_SECRET", label: "OpenSky client secret", help: "Goes with the client ID above.", secret: true },
  {
    id: "ADSBX_API_KEY",
    label: "ADS-B Exchange key",
    help: "Extra aircraft coverage (optional; a paid service, the free aircraft feeds already work).",
    link: ["adsbexchange.com", "https://www.adsbexchange.com/data/"]
  },
  {
    id: "KEEPTRACK_API_KEY",
    label: "KeepTrack key",
    help: "A fuller satellite catalog (optional).",
    link: ["keeptrack.space", "https://keeptrack.space/"]
  },
  {
    id: "FIRMS_MAP_KEY",
    label: "NASA FIRMS key",
    help: "Satellite-detected wildfires (optional; the fires layer works without it).",
    link: ["Get one free", "https://firms.modaps.eosdis.nasa.gov/api/map_key/"]
  }
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

type ServerStatus = {
  canEdit: boolean;
  keys: Record<string, { set: boolean; hint: string }>;
};

function field(def: FieldDef, status: string, isSet: boolean, value = ""): { row: HTMLElement; input: HTMLInputElement } {
  const row = el("label", "keys-field");
  const top = el("div", "keys-field-top");
  top.append(el("span", "keys-label", def.label), el("span", `keys-status ${isSet ? "is-set" : "is-unset"}`, status));
  const input = el("input", "keys-input");
  input.type = "password";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  input.placeholder = "Paste here";
  input.value = value;
  input.name = def.id;
  const wrap = el("div", "keys-input-row");
  const show = el("button", "keys-show", "Show");
  show.type = "button";
  show.addEventListener("click", (ev) => {
    ev.preventDefault();
    input.type = input.type === "password" ? "text" : "password";
    show.textContent = input.type === "password" ? "Show" : "Hide";
  });
  wrap.append(input, show);
  const help = el("small", "keys-help", def.help);
  if (def.link) {
    help.append(" ");
    const a = el("a", undefined, def.link[0]);
    a.href = def.link[1];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    help.append(a);
  }
  row.append(top, wrap, help);
  return { row, input };
}

/** Builds the panel and returns it (the caller adds it to the page and opens/closes it). */
export function createKeysPanel(hasEnvCesium: boolean): HTMLElement {
  const panel = el("section", "keys-sheet");
  panel.id = "keys-sheet";
  panel.setAttribute("aria-label", "API keys");
  panel.append(el("div", "menu-sheet-title", "Keys & tokens"));

  // A short list at the top of which keys are saved and which are not, so nobody has to scroll the whole sheet to find out.
  const summary = el("div", "keys-summary");
  summary.id = "keys-summary";
  panel.append(summary);
  const known = new Map<string, { label: string; set: boolean }>();
  const renderSummary = (): void => {
    summary.textContent = "";
    if (!known.size) return;
    const saved = [...known.values()].filter((k) => k.set).map((k) => k.label);
    const unset = [...known.values()].filter((k) => !k.set).map((k) => k.label);
    const line = (cls: string, head: string, names: string[]): void => {
      if (!names.length) return;
      const p = el("p", `keys-summary-line ${cls}`);
      p.append(el("strong", undefined, `${head}: `), document.createTextNode(names.join(", ")));
      summary.append(p);
    };
    line("is-set", "Saved", saved);
    line("is-unset", "Not set", unset);
  };

  // ---- This browser ----
  const browserBox = el("div", "keys-group");
  browserBox.append(el("div", "keys-group-title", "In this browser"));
  const cesiumSet = !!storedKey("cesium") || hasEnvCesium;
  const cesium = field(
    {
      id: "cesium",
      label: "Cesium ion token",
      help: "Satellite imagery, terrain and the 3D Photo map.",
      link: ["Get a free token", "https://ion.cesium.com/tokens"]
    },
    storedKey("cesium") ? "Saved in this browser" : hasEnvCesium ? "Using the one in .env.local" : "Not set",
    cesiumSet,
    storedKey("cesium")
  );
  const n2yo = field(
    { id: "n2yo", label: "N2YO key", help: "Extra satellite details (optional).", link: ["n2yo.com", "https://www.n2yo.com/api/"] },
    storedKey("n2yo") ? "Saved in this browser" : "Not set",
    !!storedKey("n2yo"),
    storedKey("n2yo")
  );
  known.set("cesium", { label: "Cesium ion token", set: cesiumSet });
  known.set("n2yo", { label: "N2YO key", set: !!storedKey("n2yo") });
  renderSummary();
  const browserSave = el("button", "layer-card-btn primary", "Save and reload");
  browserSave.type = "button";
  const browserMsg = el("p", "keys-msg");
  browserSave.addEventListener("click", () => {
    saveKey("cesium", cesium.input.value.trim());
    saveKey("n2yo", n2yo.input.value.trim());
    browserMsg.textContent = "Saved in this browser — reloading…";
    window.setTimeout(() => location.reload(), 450);
  });
  browserBox.append(cesium.row, n2yo.row, browserSave, browserMsg);
  browserBox.append(el("p", "keys-note", "Kept only in this browser, and sent only to Cesium / N2YO."));

  // ---- The server ----
  const serverBox = el("div", "keys-group");
  serverBox.append(el("div", "keys-group-title", "On the server"));
  const serverBody = el("div");
  serverBox.append(serverBody);

  async function loadServer(): Promise<void> {
    serverBody.textContent = "";
    let status: ServerStatus | null = null;
    try {
      const res = await fetch("/api/settings/status", { cache: "no-store" });
      if (res.ok) status = (await res.json()) as ServerStatus;
    } catch {
      /* server unreachable */
    }
    if (!status) {
      serverBody.append(el("p", "keys-note", "The server isn't reachable right now."));
      return;
    }
    const st = status;
    const inputs = new Map<string, HTMLInputElement>();
    for (const def of SERVER_FIELDS) {
      const s = st.keys[def.id];
      const f = field(def, s?.set ? `Saved on this PC ${s.hint}` : "Not set", !!s?.set);
      f.input.placeholder = s?.set ? "Paste a new one to replace" : "Paste here";
      f.input.disabled = !st.canEdit;
      inputs.set(def.id, f.input);
      serverBody.append(f.row);
      known.set(def.id, { label: def.label, set: !!s?.set });
    }
    renderSummary();
    if (!st.canEdit) {
      serverBody.append(
        el("p", "keys-note", "These can only be changed from the computer that runs Orbit. You can see here which ones are set.")
      );
      return;
    }
    const save = el("button", "layer-card-btn primary", "Save server keys");
    save.type = "button";
    const msg = el("p", "keys-msg");
    save.addEventListener("click", async () => {
      const body: Record<string, string> = {};
      for (const [id, input] of inputs) if (input.value.trim()) body[id] = input.value.trim();
      if (!Object.keys(body).length) {
        msg.textContent = "Paste at least one key first.";
        return;
      }
      save.disabled = true;
      msg.textContent = "Saving…";
      try {
        const res = await fetch("/api/settings/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Orbit-Settings": "1" },
          body: JSON.stringify(body)
        });
        const j = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(j.error ?? "Couldn't save");
        msg.textContent = "Saved. The server is restarting to use the new keys…";
        // The server restarts itself in development; wait for it to come back, then reload.
        const t0 = Date.now();
        const wait = window.setInterval(async () => {
          try {
            const r = await fetch("/api/settings/status", { cache: "no-store" });
            if (r.ok && Date.now() - t0 > 2500) {
              window.clearInterval(wait);
              location.reload();
            }
          } catch {
            /* still restarting */
          }
          if (Date.now() - t0 > 20_000) {
            window.clearInterval(wait);
            msg.textContent = "Saved. If the new keys don't seem active, restart the server.";
            save.disabled = false;
          }
        }, 1000);
      } catch (e) {
        msg.textContent = e instanceof Error ? e.message : "Couldn't save";
        save.disabled = false;
      }
    });
    serverBody.append(save, msg, el("p", "keys-note", "Stored in .env.local on this computer and never sent back to the page."));
  }
  void loadServer();

  panel.append(browserBox, serverBox);
  return panel;
}

