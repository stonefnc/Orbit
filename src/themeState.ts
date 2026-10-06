/**
 * Layer toggles show their state only in their label ("SAT · OFF" / "SAT · ON"). This mirrors that label into an
 * `is-on` class so the theme can fill a switched-on button, without touching the code that owns the labels.
 */
export function mirrorToggleState(root: ParentNode = document): void {
  const buttons = root.querySelectorAll<HTMLButtonElement>(".bottom-controls .cc-btn");
  const sync = (b: HTMLButtonElement): void => {
    const text = b.textContent ?? "";
    b.classList.toggle("is-on", /·\s*ON\b/i.test(text));
  };
  for (const b of buttons) {
    sync(b);
    new MutationObserver(() => sync(b)).observe(b, { childList: true, characterData: true, subtree: true });
  }
}
