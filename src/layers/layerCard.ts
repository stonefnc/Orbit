/**
 * A small floating details card used by the optional layers (an earthquake, a launch, a radio station, ...).
 * Everything is set with textContent; links are only created for http(s) URLs.
 */
export type CardRow = [label: string, value: string];
export type CardLink = { label: string; href: string };
export type CardAction = { label: string; run: () => void; primary?: boolean };

export type CardSpec = {
  kicker?: string;
  title: string;
  subtitle?: string;
  rows?: CardRow[];
  links?: CardLink[];
  actions?: CardAction[];
  /** Extra nodes (e.g. an audio player) appended under the rows. */
  body?: HTMLElement;
  onClose?: () => void;
  /**
   * Whether closing this card sends the camera back to the opening view. True for the cards of map layers; set false
   * for notices and other cards that aren't a layer (an error message, your location, a store).
   */
  resetsCamera?: boolean;
};

let el: HTMLElement | null = null;
let closeHandler: (() => void) | null = null;
let userCloseListener: (() => void) | null = null;
let currentResetsCamera = true;

/** Called when the user dismisses a card with its × (or Esc) — not when a layer is switched off or a card is replaced. */
export function setLayerCardUserCloseListener(fn: () => void): void {
  userCloseListener = fn;
}

export function isLayerCardOpen(): boolean {
  return !!el && !el.classList.contains("hidden");
}

/** Closes the card as the user's own action (× button or Esc). */
export function closeLayerCardByUser(): void {
  const wasOpen = isLayerCardOpen();
  hideLayerCard();
  if (wasOpen && currentResetsCamera) userCloseListener?.();
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function root(): HTMLElement {
  if (el) return el;
  el = document.getElementById("layer-card");
  if (!el) {
    el = node("aside", "layer-card hidden");
    el.id = "layer-card";
    document.body.append(el);
  }
  return el;
}

function safeHref(href: string): string | null {
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function hideLayerCard(): void {
  const r = root();
  r.classList.add("hidden");
  r.textContent = "";
  const h = closeHandler;
  closeHandler = null;
  h?.();
}

export function showLayerCard(spec: CardSpec): void {
  const r = root();
  // Switching straight to another card shouldn't fire the previous card's close handler twice.
  closeHandler = null;
  r.textContent = "";
  const head = node("div", "layer-card-head");
  const titles = node("div", "layer-card-titles");
  if (spec.kicker) titles.append(node("div", "layer-card-kicker", spec.kicker));
  titles.append(node("div", "layer-card-title", spec.title));
  if (spec.subtitle) titles.append(node("div", "layer-card-sub", spec.subtitle));
  const close = node("button", "layer-card-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => closeLayerCardByUser());
  head.append(titles, close);
  r.append(head);

  if (spec.rows?.length) {
    const rows = node("div", "layer-card-rows");
    for (const [k, v] of spec.rows) {
      const row = node("div", "layer-card-row");
      row.append(node("span", undefined, k), node("strong", undefined, v));
      rows.append(row);
    }
    r.append(rows);
  }
  if (spec.body) r.append(spec.body);

  const buttons = node("div", "layer-card-actions");
  for (const a of spec.actions ?? []) {
    const b = node("button", `layer-card-btn${a.primary ? " primary" : ""}`, a.label);
    b.type = "button";
    b.addEventListener("click", a.run);
    buttons.append(b);
  }
  for (const l of spec.links ?? []) {
    const href = safeHref(l.href);
    if (!href) continue;
    const a = node("a", "layer-card-link", l.label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    buttons.append(a);
  }
  if (buttons.childElementCount) r.append(buttons);

  closeHandler = spec.onClose ?? null;
  currentResetsCamera = spec.resetsCamera !== false;
  r.classList.remove("hidden");
}
