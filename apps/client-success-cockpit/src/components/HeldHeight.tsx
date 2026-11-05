import { type ReactNode, useEffect, useRef, useState } from "react";

/** Where a held block keeps the height it last settled at. */
const KEY = "mahara-held-height:";

/** How long the children must stay still before their height is remembered. */
const STABLE_MS = 1500;

/** The height last recorded for this block, or 0 when nothing is stored. */
export function readHeldHeight(id: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const height = Number(window.localStorage.getItem(KEY + id));
    return Number.isFinite(height) && height > 0 ? height : 0;
  } catch {
    return 0;
  }
}

function writeHeldHeight(id: string, height: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY + id, String(height));
  } catch {
    // A blocked storage keeps the page working, just without the memory.
  }
}

/**
 * Holds the space that a block of self-loading bands will fill, so the
 * sections below stay put while their reads settle. Once the bands keep one
 * height for a moment, that height is remembered and the hold is released.
 */
export function HeldHeight({
  id,
  section,
  children,
}: {
  id: string;
  section?: string;
  children: ReactNode;
}) {
  const [minHeight, setMinHeight] = useState(() => readHeldHeight(id));
  const inner = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMinHeight(readHeldHeight(id));
  }, [id]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined")
      return;
    const node = inner.current;
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = -1;
    let settled = false;
    const measure = () => {
      // The inner wrapper's own height, never the held min-height above it.
      const height = Math.round(node.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      if (timer) clearTimeout(timer);
      // Every settled height is remembered, so a band that arrives late is
      // in next time's hold; the hold itself is released only once.
      timer = setTimeout(() => {
        writeHeldHeight(id, last);
        if (!settled) {
          settled = true;
          setMinHeight(0);
        }
      }, STABLE_MS);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  return (
    <div data-held={id} data-section={section} style={{ minHeight }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}
