import { count, money, pct } from "@/components/ceo/format";
import type { Unit } from "../../../convex/ceo/scoreboard";

/**
 * The parts the Goals screens share: how a target is written, and the one
 * element the whole tab is built around — the pace bar.
 *
 * A target is a number for a whole period. On the nineteenth of the month the
 * question is never "have we hit it", it is "is the run rate going to". So
 * every counted number gets a bar with two marks on it: how much of the
 * target has been done, and how much of it the working days so far should
 * have produced. One look answers the question, and nothing else on the
 * screen needs a colour.
 */

export function fmt(v: number | null | undefined, unit: Unit): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
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

/** How far off pace, in words, or null when it is on pace or cannot be judged. */
export function behindBy(
  actual: number | null,
  paced: number | null,
  direction: "up" | "down",
  unit: Unit,
): string | null {
  if (actual === null || paced === null) return null;
  const off = direction === "up" ? paced - actual : actual - paced;
  if (off <= 0) return null;
  if (unit === "rate") return `${pct(off)} under`;
  if (unit === "usd") return `${money(off)} short`;
  return `${fmt(off, unit)} short`;
}

/**
 * The bar. `progress` fills it, `pace` is the tick that says where the fill
 * should have reached by now. A rate has no pace tick, because a rate does
 * not accumulate: it is simply at or under the line.
 */
export function PaceBar({
  progress,
  pace,
  good,
  label,
}: {
  progress: number | null;
  pace: number | null;
  good: boolean | null;
  label: string;
}) {
  const fill = progress === null ? 0 : Math.max(0, Math.min(1, progress));
  const tick = pace === null ? null : Math.max(0, Math.min(1, pace));
  const tone =
    good === false
      ? "var(--ceo-critical)"
      : good === true
        ? "var(--ceo-emphasis)"
        : "var(--muted-foreground)";
  return (
    <div
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={label}
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${fill * 100}%`, background: tone }}
      />
      {tick !== null && tick > 0 && tick < 1 ? (
        <span
          className="absolute top-[-2px] h-[10px] w-px bg-foreground/60"
          style={{ left: `${tick * 100}%` }}
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
        <span className="text-sm font-semibold tabular-nums">
          {v === null ? "—" : `${v}/10`}
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
