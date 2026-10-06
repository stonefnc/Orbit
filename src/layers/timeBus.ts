/**
 * A tiny shared clock between the Time machine (which owns the "as of" date for satellite imagery) and layers that can
 * follow it, such as Conflict watch. No dependencies, just a current date and subscribers.
 */
let current: string | null = null;
let historyOn = false;
const subs = new Set<(date: string) => void>();

export function publishDate(isoDate: string): void {
  if (isoDate === current) return;
  current = isoDate;
  for (const fn of subs) fn(isoDate);
}

export function currentDate(): string | null {
  return current;
}

export function subscribeDate(fn: (date: string) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function setHistoryActive(on: boolean): void {
  historyOn = on;
  if (!on) current = null;
}

export function isHistoryActive(): boolean {
  return historyOn;
}
