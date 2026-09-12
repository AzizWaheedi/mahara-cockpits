import { useSyncExternalStore } from "react";

/**
 * The client whose profile or row is open on the current page.
 *
 * The pages open a client from local state, not from the URL, so the Hermes
 * chat cannot read it off the address bar. Each page publishes its open
 * client here and clears it when it unmounts; the chat reads it to send that
 * client's numbers with every question.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export function publishOpenClient(name: string | null): void {
  if (current === name) return;
  current = name;
  for (const notify of listeners) notify();
}

export function useOpenClient(): string | null {
  return useSyncExternalStore(
    notify => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    () => current,
    () => null,
  );
}
