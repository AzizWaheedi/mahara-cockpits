import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The Results tab's chapters (Muhammed, 2026-10-12: "I feel that I'm
 * scrolling through a 600-page book"). Each part has one 18px heading and one
 * grey line under it; a hairline and 48px separate the parts; the contents
 * bar stays at the top and says which part you are reading.
 */

export type ResultsPart = { id: string; label: string; count?: number };

// The slim bar below 1024px is 56px plus its hairline and the safe area; the
// contents bar (49px) sits under it. A part scrolled to tucks its divider just
// under the contents bar, so one hairline shows, then its own top space.
const STICKY_TOP =
  "top-[calc(3.5rem_+_1px_+_env(safe-area-inset-top,0px))] lg:top-0";
const PART_OFFSET =
  "scroll-mt-[calc(6.5rem_+_env(safe-area-inset-top,0px))] lg:scroll-mt-12";
// A part counts as being read once its top is this close under the bar.
const READING_LINE = 48;

export function ResultsSection({
  id,
  title,
  count,
  lede,
  actions,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  count?: number;
  /** One grey line: what the part is from, or what to do with it. */
  lede?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "space-y-4 py-6 first:pt-0 last:pb-0",
        PART_OFFSET,
        className,
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h2
            id={`${id}-title`}
            className="text-lg font-semibold tracking-tight"
          >
            {title}
            {count ? (
              <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                {count}
              </span>
            ) : null}
          </h2>
          {lede ? (
            <p className="text-[13px] text-muted-foreground">{lede}</p>
          ) : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** The parts, one hairline between each. */
export function ResultsParts({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border/60">{children}</div>;
}

/**
 * The contents bar: one pill per part, with its count. A tap scrolls to the
 * part; the part you are reading carries the teal.
 */
export function ResultsNav({ parts }: { parts: ResultsPart[] }) {
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
      aria-label="On this tab"
      className={cn(
        "sticky z-20 -mx-1 border-b border-border/60 bg-background/95 px-1 py-2 backdrop-blur",
        STICKY_TOP,
      )}
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
                "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-colors",
                on
                  ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {p.label}
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
