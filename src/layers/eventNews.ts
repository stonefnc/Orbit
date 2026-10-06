/**
 * "Recent headlines" block for the earthquake and wildfire cards. The server builds the news query from the place or fire
 * name (GDELT, see server/lib/gdelt.ts); this only draws the answer. Links go to the publishers' own pages.
 */
type NewsItem = { title: string; url: string; domain: string; seen: string };

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function httpUrl(href: string): string | null {
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Returns the block at once (with "Looking for headlines…") and fills it when the answer arrives. If the card was closed
 * or replaced meanwhile (the block is no longer in the page) nothing is drawn.
 */
export function eventNewsBlock(kind: "quake" | "fire", name: string): HTMLElement {
  const box = node("div", "layer-card-news");
  box.append(node("p", "layer-card-news-title", "Recent headlines"), node("p", "layer-panel-note", "Looking for headlines…"));
  void (async () => {
    let items: NewsItem[] = [];
    let stale = false;
    let failed = false;
    try {
      const r = await fetch(`/api/layers/event-news?kind=${kind}&name=${encodeURIComponent(name)}`);
      if (r.ok) {
        const j = (await r.json()) as { items?: NewsItem[]; stale?: boolean };
        items = j.items ?? [];
        stale = !!j.stale;
      } else failed = true;
    } catch {
      failed = true;
    }
    if (!box.isConnected) return;
    box.replaceChildren(node("p", "layer-card-news-title", "Recent headlines"));
    const list = node("div", "conf-news-list");
    for (const it of items) {
      const href = httpUrl(it.url);
      if (!href) continue;
      const a = node("a", "conf-news-item");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      const when = it.seen
        ? ` · ${new Date(it.seen).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
        : "";
      a.append(node("span", undefined, it.title), node("small", undefined, `${it.domain}${when}`));
      list.append(a);
    }
    if (list.childElementCount) {
      box.append(list);
      if (stale) box.append(node("p", "layer-panel-note", "Showing the last list we could fetch."));
    } else {
      box.append(
        node(
          "p",
          "layer-panel-note",
          failed || stale
            ? "Headlines are unavailable right now (the news index is rate-limited). Open the official page below."
            : "No matching headlines in the news index for this event."
        )
      );
    }
    box.append(node("p", "layer-panel-note", "Headlines from GDELT; text and links belong to each publisher."));
  })();
  return box;
}
