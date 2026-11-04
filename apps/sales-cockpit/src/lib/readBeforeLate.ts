import { useEffect, useRef } from "react";

/** Read this long before the data would be called late. */
export const READ_AHEAD_MS = 2 * 60_000;
/** Never read again sooner than this after the last try. */
export const MIN_GAP_MS = 5 * 60_000;
/** How often an open, visible page checks. */
export const CHECK_EVERY_MS = 60_000;

/**
 * Whether to read again now: the tab shows, the data is within READ_AHEAD_MS
 * of being called late (or past it), and the last try is MIN_GAP_MS old.
 */
export function shouldReadAgain(a: {
  now: number;
  lateAt: number | null;
  lastTry: number;
  visible: boolean;
  aheadMs?: number;
  minGapMs?: number;
}): boolean {
  if (!a.visible || a.lateAt === null || !Number.isFinite(a.lateAt))
    return false;
  if (a.now < a.lateAt - (a.aheadMs ?? READ_AHEAD_MS)) return false;
  return a.now - a.lastTry >= (a.minGapMs ?? MIN_GAP_MS);
}

/**
 * A page that judges its own data late from a copy it read once shows a
 * false warning when it stays open (the invoice banner, 4 Nov 2026). This
 * reads again shortly before `lateAt`, and when the tab comes back, so the
 * warning shows only when the source itself is late. Cheap on purpose: no
 * read while the data is fresh or the tab is hidden, and at most one read per
 * MIN_GAP_MS while it stays late.
 */
export function useReadBeforeLate(
  read: () => unknown,
  lateAt: number | null,
  opts: { aheadMs?: number; minGapMs?: number } = {},
): void {
  const readRef = useRef(read);
  readRef.current = read;
  const lateRef = useRef(lateAt);
  lateRef.current = lateAt;
  const lastTry = useRef(Date.now());
  const { aheadMs, minGapMs } = opts;
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      if (
        !shouldReadAgain({
          now,
          lateAt: lateRef.current,
          lastTry: lastTry.current,
          visible: document.visibilityState === "visible",
          aheadMs,
          minGapMs,
        })
      )
        return;
      lastTry.current = now;
      void readRef.current();
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [aheadMs, minGapMs]);
}
