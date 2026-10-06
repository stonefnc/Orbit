/**
 * Plain-language notes shown under the layer toggles when a layer needs a key the person hasn't added yet.
 * Orbit ships with no keys: every layer that needs one says what is missing, where to get a free key, and where to paste
 * it (the Keys menu), instead of failing quietly. Pure table plus a little DOM glue, so the wording can be unit-tested.
 */
export type KeyHintId = "ion" | "ais" | "keeptrack";

export interface KeyHint {
  text: string;
  linkText: string;
  href: string;
}

export const KEY_HINTS: Record<KeyHintId, KeyHint> = {
  ion: {
    text: "Aerial imagery, terrain and 3D Photo need a free Cesium ion token. Paste it in the Keys menu (the key icon).",
    linkText: "Get a free token",
    href: "https://ion.cesium.com/tokens"
  },
  ais: {
    text: "Ships: no AISStream key yet, so only the Baltic shows. A free key adds coastal ships worldwide. Paste it in the Keys menu.",
    linkText: "Get a free key",
    href: "https://aisstream.io/apikeys"
  },
  keeptrack: {
    text: "KeepTrack needs a key. Satellites still load from CelesTrak without it. Paste a key in the Keys menu to use KeepTrack.",
    linkText: "keeptrack.space",
    href: "https://keeptrack.space/"
  }
};

/** Shows the note for `id` under the layer toggles (once; calling again does nothing). */
export function showKeyHint(id: KeyHintId): void {
  const host = document.getElementById("key-hints");
  if (!host || host.querySelector(`[data-key-hint="${id}"]`)) return;
  const hint = KEY_HINTS[id];
  const p = document.createElement("p");
  p.className = "layer-panel-note key-hint";
  p.dataset.keyHint = id;
  p.append(`${hint.text} `);
  const a = document.createElement("a");
  a.href = hint.href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = hint.linkText;
  p.append(a);
  host.append(p);
}

/** Removes the note for `id` (the key arrived, or the layer was switched off). */
export function clearKeyHint(id: KeyHintId): void {
  document.getElementById("key-hints")?.querySelector(`[data-key-hint="${id}"]`)?.remove();
}
