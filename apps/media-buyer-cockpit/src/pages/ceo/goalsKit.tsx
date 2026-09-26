import { count, money, NA, pct } from "@/components/ceo/format";
import { gateTone, STATUS_COLOR } from "@/components/ceo/StatusChip";
import type { TargetRow } from "../../../convex/ceo/goals";
import type { Unit } from "../../../convex/ceo/scoreboard";

/**
 * The parts the Goals screens share: how a target is written, and the one
 * element the whole tab is built around, the pace bar.
 *
 * A target is a number for a whole period. On the nineteenth of the month the
 * question is never "have we hit it", it is "is the run rate going to". So
 * every counted number gets a bar with two marks on it: how much of the
 * target has been done, and how much of it the working days so far should
 * have produced. One look answers the question, and nothing else on the
 * screen needs a colour.
 */

export function fmt(v: number | null | undefined, unit: Unit): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  switch (unit) {
    case "usd":
      return money(v);
    case "rate":
      return pct(v);
    case "x":
      return `${v.toFixed(1)}×`;
    case "days":
      return `${count(v)} ${v === 1 ? "day" : "days"}`;
    case "pts":
      return `${count(v)} pts`;
    default:
      return count(v);
  }
}

/**
 * How far off pace, in words, or null when it is on pace or cannot be judged.
 * A number we want up is "behind pace" (or "under target" when it does not
 * accumulate, like a rate); a cost or anything we want down is "over": a cost
 * per lead of $29.16 against $10 is "$19.16 over target", never "short".
 */
export function behindBy(
  actual: number | null,
  paced: number | null,
  direction: "up" | "down",
  unit: Unit,
  /** True for a number that does not accumulate (a rate, a cost, an average). */
  level = false,
): string | null {
  if (actual === null || paced === null) return null;
  const off = direction === "up" ? paced - actual : actual - paced;
  if (off <= 0) return null;
  const amount =
    unit === "rate" ? pct(off) : unit === "usd" ? money(off) : fmt(off, unit);
  const against = level ? "target" : "pace";
  if (direction === "down") return `${amount} over ${against}`;
  return level ? `${amount} under target` : `${amount} behind pace`;
}

/**
 * The colour of a target against its pace. Behind is orange. Red is kept for
 * the worst of it: a target the plan's verdict names among its three worst
 * (`worst`, from the board's own behind list, worst first) that is also far
 * off, beyond the kit's 25% band (the band a cost uses against its gate). So
 * red marks the few numbers the verdict line calls out, not every row.
 */
export function paceTone(
  t: TargetRow,
  worst?: ReadonlySet<string>,
): "good" | "warning" | "critical" | null {
  if (t.onPace === null) return null;
  if (t.onPace) return "good";
  if (worst && !worst.has(t.label)) return "warning";
  const band = gateTone(t.actual, t.pacedTarget ?? 0, {
    higherIsBetter: t.direction === "up",
  });
  return band === "serious" ? "critical" : "warning";
}

/** The labels the plan's verdict line names: the three worst behind pace. */
export function worstThree(behind: { label: string }[] | null | undefined) {
  return new Set((behind ?? []).slice(0, 3).map(b => b.label));
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "October 2026 plan", the name a new plan starts with, from its first day. */
export function planTitle(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y} plan`;
}

/** A plan's name as shown: an older generated "September 2026 — The Plan" reads "September 2026 plan". */
export function planName(title: string): string {
  return title.replace(/\s+[—–-]\s+the plan\s*$/i, " plan");
}

/**
 * The bar, drawn like the kit's Meter: a track in a light step of the fill's
 * own colour. `progress` fills it, `pace` is the tick that says where the fill
 * should have reached by now. A rate has no pace tick, because a rate does not
 * accumulate: it is simply at or under the line. On pace the fill is teal;
 * behind it is orange, or red when far behind (pass `tone`).
 */
export function PaceBar({
  progress,
  pace,
  good,
  tone,
  label,
}: {
  progress: number | null;
  pace: number | null;
  good: boolean | null;
  /** How far behind, when `good` is false; orange unless it is far behind. */
  tone?: "warning" | "critical";
  label: string;
}) {
  const fill = progress === null ? 0 : Math.max(0, Math.min(1, progress));
  const tick = pace === null ? null : Math.max(0, Math.min(1, pace));
  const color =
    good === false
      ? STATUS_COLOR[tone ?? "warning"]
      : good === true
        ? "var(--ceo-emphasis)"
        : "var(--muted-foreground)";
  return (
    <div className="relative" role="img" aria-label={label}>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
        }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{
            width: `${(fill * 100).toFixed(2)}%`,
            minWidth: fill > 0 ? 4 : 0,
            backgroundColor: color,
          }}
        />
      </div>
      {tick !== null && tick > 0 && tick < 1 ? (
        <span
          className="absolute -top-0.5 h-3 w-0.5 rounded-full bg-foreground/70"
          style={{ left: `calc(${(tick * 100).toFixed(2)}% - 1px)` }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

/** Under five is a problem, five or six is watch it, seven and up is fine. */
function band(v: number): string {
  return v <= 4
    ? "var(--ceo-critical)"
    : v <= 6
      ? "var(--ceo-warning)"
      : "var(--ceo-good)";
}

/** Three small bars that say what kind of person somebody is at a glance. */
export function Dial({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint?: string;
}) {
  const v = value === null ? null : Math.max(0, Math.min(10, value));
  return (
    <div className="grid gap-1" title={hint}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className={
            v === null
              ? "text-sm text-muted-foreground"
              : "text-sm font-semibold tabular-nums"
          }
        >
          {v === null ? NA : `${v}/10`}
        </span>
      </div>
      <div className="flex gap-0.5" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={`${label}-${i}`}
            className="h-1.5 flex-1 rounded-full"
            // Every filled segment takes the colour of the score itself, not
            // of its own position: a nine is a green bar, not a bar that
            // starts red and recovers.
            style={{
              background: v !== null && i < v ? band(v) : "var(--muted)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
