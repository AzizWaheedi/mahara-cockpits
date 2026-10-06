import { useSyncExternalStore } from "react";

/**
 * Light or dark, held once for the whole cockpit. The sidebar and the menu
 * bar each kept their own copy, so a switch in one left the other showing
 * the wrong icon until a reload (the simplification audit, 2026-10-06).
 * index.html sets the class before the first paint; this keeps it after.
 */
const KEY = "theme";
const listeners = new Set<() => void>();

function stored(): boolean {
  try {
    const s = localStorage.getItem(KEY);
    if (s === "light" || s === "dark") return s === "dark";
  } catch {
    // A private window forbids this; fall through to the default.
  }
  // Dark unless someone chose light: the brand's web default.
  return true;
}

let dark = typeof window === "undefined" ? true : stored();

export function setDark(next: boolean): void {
  dark = next;
  document.documentElement.classList.toggle("dark", next);
  document.documentElement.style.colorScheme = next ? "dark" : "light";
  try {
    localStorage.setItem(KEY, next ? "dark" : "light");
  } catch {
    // The tool still works, it just forgets.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the cockpit is dark, and the switch that flips it everywhere. */
export function useDark(): [boolean, () => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => dark,
    () => true,
  );
  return [value, () => setDark(!dark)];
}
