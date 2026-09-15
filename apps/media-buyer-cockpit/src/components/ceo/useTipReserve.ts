import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/**
 * Width to keep free at the right of a bar row so the value printed at the
 * bar's tip always fits: the widest `[data-tip]` element inside the container,
 * plus the gap. All bars scale to the same reduced track, so lengths stay honest.
 */
export function useTipReserve<T extends HTMLElement>(
  fallback = 88,
): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [reserve, setReserve] = useState(fallback);

  // No dependency list on purpose: rows and their text can change on any render,
  // and setting the same number again does not re-render.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      let max = 0;
      for (const tip of el.querySelectorAll<HTMLElement>("[data-tip]"))
        max = Math.max(max, tip.offsetWidth);
      if (max > 0) setReserve(Math.ceil(max) + 8);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // Web fonts landing after the first paint widen the text.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  return [ref, reserve];
}
