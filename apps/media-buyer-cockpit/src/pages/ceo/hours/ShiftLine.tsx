import "./hoursWatch.css";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { time } from "@/components/ceo/format";
import { cn } from "@/lib/utils";
import type { WatchShot } from "@/types/ceo/hoursWatch";
import {
  hourLabel,
  type LineModel,
  type LineSegment,
  PHONE_BAR_PX,
  pctOf,
  type TickGroup,
  tickGroups,
} from "./watchCopy";

/** Measure before paint in the browser; the server render keeps the phone width. */
const useBeforePaint =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The bar's width in pixels, followed as the card resizes. */
function useBarWidth(fixed: number | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fixed ?? PHONE_BAR_PX);
  useBeforePaint(() => {
    const el = ref.current;
    if (fixed !== undefined || !el) return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(w);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, [fixed]);
  return { ref, width: fixed ?? width };
}

function tickLabel(name: string, g: TickGroup): string {
  if (g.ticks.length === 1) {
    const t = g.ticks[0];
    return `Open ${name}'s screenshot from ${time(t.at)}, judged not work${t.shot.label ? `: ${t.shot.label}` : ""}`;
  }
  return `Open ${name}'s ${g.ticks.length} screenshots from ${time(g.from)} to ${time(g.to)}, judged not work`;
}

/**
 * The shift line (Hubstaff watch's signature element): one bar per person
 * across the same hours as every other row. Tracked 10-minute blocks fill in
 * teal at an opacity that follows keyboard and mouse, idle blocks are hatched,
 * part-day leave is the quiet off-time fill, a gap past the grace is orange, a screenshot off work is a red tick above
 * the bar that opens it, and a needle marks now. The bar reads itself aloud
 * (`line.summary`); the ticks are buttons with their own words.
 */
export function ShiftLine({
  line,
  name,
  live,
  onOpenShot,
  onOpenGroup,
  widthPx,
  className,
}: {
  line: LineModel;
  /** Whose line, for the ticks' labels. */
  name: string;
  /** On shift now: the shift's track takes the teal glow. */
  live: boolean;
  onOpenShot: (shot: WatchShot) => void;
  /** Ticks merged because they sit closer than 12 px: opens their alert's screenshots. */
  onOpenGroup?: (shots: WatchShot[]) => void;
  /** The bar's width, for tests; measured in the browser otherwise. */
  widthPx?: number;
  className?: string;
}) {
  const { ref, width } = useBarWidth(widthPx);
  const groups = tickGroups(line, width);
  const place = (s: LineSegment): CSSProperties => ({
    left: `${pctOf(s.from, line)}%`,
    width: `${Math.max(0.15, pctOf(s.to, line) - pctOf(s.from, line))}%`,
  });
  return (
    <div ref={ref} className={cn("min-w-0", className)}>
      <div className="hw-ticks">
        {groups.map(g => {
          const one = g.ticks.length === 1;
          const newest = g.ticks[g.ticks.length - 1].shot;
          return (
            <button
              key={g.key}
              type="button"
              className="hw-tick no-touch"
              data-count={one ? undefined : g.ticks.length}
              style={{
                left: `${pctOf(g.from, line)}%`,
                width: one
                  ? undefined
                  : `calc(${pctOf(g.to, line) - pctOf(g.from, line)}% + 4px)`,
              }}
              onClick={() =>
                one || !onOpenGroup
                  ? onOpenShot(newest)
                  : onOpenGroup(g.ticks.map(t => t.shot))
              }
              aria-label={tickLabel(name, g)}
              title={
                one
                  ? `${time(g.from)}${newest.label ? ` · ${newest.label}` : ""}`
                  : `${g.ticks.length} screenshots, ${time(g.from)} to ${time(g.to)}`
              }
            />
          );
        })}
      </div>
      <div className="hw-bar" role="img" aria-label={line.summary}>
        {line.segments.map(s => (
          <span
            key={`${s.kind}-${s.from}`}
            data-kind={s.kind}
            data-outside={s.outside ? "true" : undefined}
            data-live={s.kind === "shift" && live ? "true" : undefined}
            className={cn("hw-seg", `hw-${s.kind}`)}
            style={{
              ...place(s),
              ...(s.kind === "tracked" && !s.outside
                ? ({
                    "--hw-a": String(
                      Math.round((0.35 + 0.65 * (s.activity ?? 0)) * 100) / 100,
                    ),
                  } as CSSProperties)
                : null),
            }}
          />
        ))}
        {line.now !== null ? (
          <span
            className="hw-now"
            data-kind="now"
            style={{ left: `${pctOf(line.now, line)}%` }}
          />
        ) : null}
      </div>
      <div className="hw-hours" aria-hidden>
        {line.hours.map((h, i) => (
          <span
            key={h}
            className={cn("hw-hour", i % 2 ? "hidden @md:block" : null)}
            data-edge={
              pctOf(h, line) < 3
                ? "start"
                : pctOf(h, line) > 97
                  ? "end"
                  : undefined
            }
            style={{ left: `${pctOf(h, line)}%` }}
          >
            {hourLabel(h)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The key under the rows: what each mark on the line means. */
export function ShiftLegend({ className }: { className?: string }) {
  const items: { cls: string; label: string; style?: CSSProperties }[] = [
    { cls: "hw-tracked", label: "Tracked (brighter is busier)" },
    { cls: "hw-idle", label: "Timer on, no activity" },
    { cls: "hw-gap", label: "Not tracked past the grace" },
    { cls: "hw-unread", label: "Not in from Hubstaff yet" },
    { cls: "hw-leave", label: "On leave" },
  ];
  return (
    <ul
      className={cn(
        "flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {items.map(i => (
        <li key={i.cls} className="inline-flex items-center gap-1.5">
          <span className={cn("hw-swatch", i.cls)} aria-hidden />
          {i.label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span
          className="hw-swatch"
          style={{ width: 4, background: "var(--ceo-critical)" }}
          aria-hidden
        />
        Screenshot off work
      </li>
    </ul>
  );
}
