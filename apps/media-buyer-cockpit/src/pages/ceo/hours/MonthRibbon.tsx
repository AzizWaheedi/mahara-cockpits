import "./hours.css";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { DayView, Seconds, Ymd } from "@/types/ceo/hoursContract";
import { dayOfMonth, dayShares, isSaturday, weekday } from "./hoursFormat";

/**
 * The month ribbon, the one element this card is remembered by: a slim cell
 * per day, a teal fill rising to counted ÷ expected, patterns for leave, a
 * dotted outline for a holiday, a dashed hollow cell for a day we know
 * nothing about, and an orange outline for a day that needs a decision. A
 * 3px gap opens before every Saturday, where the company week starts.
 */

/** The longest expected day, so day-off work has something to rise against. */
export function longestDay(days: DayView[]): Seconds {
  return days.reduce((m, d) => Math.max(m, d.expected), 0);
}

const UNKNOWN = new Set<DayView["kind"]>(["no_data", "unverified"]);

/** One day as a cell: the track, the fills and the outlines. */
export function DayCell({
  d,
  longest,
  decide,
  fixed,
  className,
}: {
  d: DayView;
  longest: Seconds;
  /** One of the four questions is open on this day. */
  decide?: boolean;
  /** Fixed pay: tracked time is information only, so only leave and holidays draw. */
  fixed?: boolean;
  className?: string;
}) {
  const s = dayShares(d, longest);
  const gone = d.kind === "not_employed";
  const holiday = d.kind === "holiday";
  const unknown = !fixed && UNKNOWN.has(d.kind);
  const off =
    d.kind === "off" ||
    d.kind === "worked_day_off" ||
    (d.kind === "future" && d.expected === 0);
  const showWork = !fixed && !unknown && !gone;
  const excused = d.kind === "excused";
  const hasWork = showWork && s.work > 0;
  return (
    <span
      className={cn("hours-cell", className)}
      data-fixed={fixed || undefined}
      data-off={off || undefined}
      data-has-work={off && hasWork ? true : undefined}
      data-future={d.kind === "future" || undefined}
      data-gone={gone || undefined}
      data-holiday={holiday || undefined}
      data-unknown={unknown || undefined}
      data-decide={(!fixed && decide) || undefined}
      data-today={d.kind === "today" || undefined}
    >
      {hasWork ? (
        <span
          className={cn("hours-seg", excused ? "hours-excused" : "hours-work")}
          style={{ height: `${s.work * 100}%` }}
        />
      ) : null}
      {s.paid > 0 && !gone ? (
        <span
          className="hours-seg hours-paid"
          style={{ height: `${s.paid * 100}%` }}
        />
      ) : null}
      {s.unpaid > 0 && !gone ? (
        <span
          className="hours-seg hours-unpaid"
          style={{ height: `${s.unpaid * 100}%` }}
        />
      ) : null}
      {showWork && s.extra ? <span className="hours-notch" /> : null}
      {unknown ? (
        <span className="hours-q" aria-hidden>
          ?
        </span>
      ) : null}
    </span>
  );
}

/** The days a question is open on, from a person's reasons. */
export function decideDaysOf(
  reasons: { severity: string; days?: Ymd[] }[],
): Set<Ymd> {
  const out = new Set<Ymd>();
  for (const r of reasons)
    if (r.severity === "decide") for (const d of r.days ?? []) out.add(d);
  return out;
}

/** The ribbon on a person's row: decorative, the row itself says it in words. */
export function MonthRibbon({
  days,
  decide,
  fixed,
  rise = true,
  className,
}: {
  days: DayView[];
  decide?: Set<Ymd>;
  fixed?: boolean;
  /** The one 160ms rise on first render. */
  rise?: boolean;
  className?: string;
}) {
  const longest = useMemo(() => longestDay(days), [days]);
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-7 min-w-0 items-stretch gap-[2px]",
        rise && "hours-rise",
        className,
      )}
    >
      {days.map((d, i) => (
        <DayCell
          key={d.day}
          d={d}
          longest={longest}
          decide={decide?.has(d.day)}
          fixed={fixed}
          className={cn(
            "min-w-[4px] max-w-[18px] flex-1",
            i > 0 && isSaturday(d.day) && "ml-[3px]",
          )}
        />
      ))}
    </span>
  );
}

const WEEK = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

/**
 * The same month as a calendar, Saturday first. Every cell is a button that
 * says the day in a sentence; the arrow keys move a roving focus (left and
 * right a day, up and down a week), Enter or a tap picks the day.
 */
export function MonthCalendar({
  days,
  decide,
  fixed,
  selected,
  onSelect,
}: {
  days: DayView[];
  decide?: Set<Ymd>;
  fixed?: boolean;
  selected: Ymd | null;
  onSelect: (day: Ymd) => void;
}) {
  const longest = useMemo(() => longestDay(days), [days]);
  const lead = days.length ? (weekday(days[0].day) + 1) % 7 : 0;
  const [focus, setFocus] = useState(() =>
    Math.max(
      0,
      days.findIndex(d => d.day === selected),
    ),
  );
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (to: number) => {
    const next = Math.max(0, Math.min(days.length - 1, to));
    setFocus(next);
    refs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const step =
      e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowLeft"
          ? -1
          : e.key === "ArrowDown"
            ? 7
            : e.key === "ArrowUp"
              ? -7
              : e.key === "Home"
                ? -i
                : e.key === "End"
                  ? days.length - 1 - i
                  : 0;
    if (!step) return;
    e.preventDefault();
    move(i + step);
  };

  return (
    <div className="grid gap-1">
      <div
        className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] font-medium text-muted-foreground"
        aria-hidden
      >
        {WEEK.map(w => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div
        role="group"
        aria-label="The month, day by day"
        className="hours-rise grid grid-cols-7 gap-1"
      >
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden />
        ))}
        {days.map((d, i) => {
          const isSel = d.day === selected;
          return (
            <button
              key={d.day}
              ref={el => {
                refs.current[i] = el;
              }}
              type="button"
              tabIndex={i === focus ? 0 : -1}
              aria-label={d.label}
              aria-pressed={isSel}
              onFocus={() => setFocus(i)}
              onKeyDown={e => onKey(e, i)}
              onClick={() => onSelect(d.day)}
              className={cn(
                "no-touch group relative flex h-11 min-w-0 flex-col items-stretch gap-1 rounded-md p-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @md:h-14",
                isSel
                  ? "bg-muted ring-1 ring-inset ring-border"
                  : "hover:bg-muted/60",
              )}
            >
              <span className="font-mono text-[10px] font-medium leading-none text-muted-foreground tabular-nums">
                {dayOfMonth(d.day)}
              </span>
              <DayCell
                d={d}
                longest={longest}
                decide={decide?.has(d.day)}
                fixed={fixed}
                className="min-h-0 flex-1"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The key under the calendar: each pattern once, with its words. */
export function RibbonLegend({ fixed }: { fixed?: boolean }) {
  const item = (label: string, cell: Partial<DayView>, decide?: boolean) => (
    <span className="inline-flex items-center gap-1.5">
      <DayCell
        d={{
          day: "2026-01-01",
          kind: "worked",
          expected: 1,
          counted: 0,
          tracked: 0,
          paidLeave: 0,
          unpaid: 0,
          holiday: null,
          leave: [],
          adjustmentIds: [],
          label,
          ...cell,
        }}
        longest={1}
        decide={decide}
        className="hours-swatch"
      />
      {label}
    </span>
  );
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {fixed ? null : item("Worked", { counted: 1 })}
      {item("Paid leave", { kind: "leave_paid", counted: 1, paidLeave: 1 })}
      {item("Unpaid or absent", { kind: "leave_unpaid", unpaid: 1 })}
      {item("Public holiday", { kind: "holiday" })}
      {fixed ? null : item("No data", { kind: "no_data", counted: null })}
      {fixed ? null : item("Needs a decision", { kind: "absent" }, true)}
    </p>
  );
}
