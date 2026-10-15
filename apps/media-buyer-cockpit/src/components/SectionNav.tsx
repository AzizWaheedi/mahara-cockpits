import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The contents bar for a long page, the client success Results tab's own
 * (`client-success-cockpit/src/components/ResultsLayout.tsx`). Muhammed,
 * 2026-10-13: a client's page here is the numbers, the ads and the campaigns
 * one under another, and reaching the ads meant scrolling past the rest.
 *
 * One pill per part, with its count. A tap scrolls to the part; the part you
 * are reading carries the teal. The media buyer has no top bar, so the bar
 * sticks to the top of the screen and pads itself clear of the status bar in
 * the installed app.
 */

export type SectionNavPart = { id: string; label: string; count?: number };

/** A part scrolled to sits this far down: the bar (49px) and 16px. */
export const SECTION_OFFSET =
  "scroll-mt-[calc(4.25rem_+_env(safe-area-inset-top,0px))]";
// A part counts as being read once its top is this close under the bar.
const READING_LINE = 48;

export function SectionNav({ parts }: { parts: SectionNavPart[] }) {
  const bar = useRef<HTMLElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(parts[0]?.id);
  // A tapped part stays lit until the reader scrolls on their own, so a short
  // part near the end does not hand the teal to the one below it.
  const chosen = useRef<string | null>(null);
  const ids = parts.map(p => p.id).join(" ");

  useEffect(() => {
    const list = ids.split(" ");
    let frame = 0;
    const read = () => {
      frame = 0;
      if (chosen.current) return setCurrent(chosen.current);
      const below =
        (bar.current?.getBoundingClientRect().bottom ?? 0) + READING_LINE;
      let at = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= below) at = id;
      }
      // At the foot of the page the last part is the one being read, even
      // when it is too short to reach the bar.
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4
      )
        at = list[list.length - 1];
      setCurrent(at);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    const own = () => {
      chosen.current = null;
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    for (const k of ["wheel", "touchstart", "keydown"] as const)
      window.addEventListener(k, own, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const k of ["wheel", "touchstart", "keydown"] as const)
        window.removeEventListener(k, own);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  // Keep the lit pill in view when the row scrolls sideways on a phone.
  useEffect(() => {
    const r = row.current;
    const pill = r?.querySelector<HTMLElement>(`[data-part="${current}"]`);
    if (!r || !pill) return;
    const left = pill.offsetLeft - r.offsetLeft;
    if (
      left < r.scrollLeft ||
      left + pill.offsetWidth > r.scrollLeft + r.clientWidth
    )
      r.scrollTo({ left: Math.max(0, left - 16) });
  }, [current]);

  return (
    <nav
      ref={bar}
      aria-label="On this page"
      className="sticky top-0 z-20 -mx-1 border-b border-border/60 bg-background/95 px-1 pt-[calc(0.5rem_+_env(safe-area-inset-top,0px))] pb-2 backdrop-blur"
    >
      <div
        ref={row}
        className="no-scrollbar flex flex-nowrap items-center gap-1 overflow-x-auto"
      >
        {parts.map(p => {
          const on = p.id === current;
          return (
            <a
              key={p.id}
              href={`#${p.id}`}
              data-part={p.id}
              title={p.label}
              aria-current={on ? "location" : undefined}
              onClick={e => {
                e.preventDefault();
                const reduce = window.matchMedia(
                  "(prefers-reduced-motion: reduce)",
                ).matches;
                chosen.current = p.id;
                setCurrent(p.id);
                document.getElementById(p.id)?.scrollIntoView({
                  behavior: reduce ? "auto" : "smooth",
                  block: "start",
                });
              }}
              className={cn(
                "inline-flex h-8 max-w-[16rem] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-colors",
                on
                  ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="truncate" dir="auto">
                {p.label}
              </span>
              {p.count ? (
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {p.count}
                </span>
              ) : null}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
