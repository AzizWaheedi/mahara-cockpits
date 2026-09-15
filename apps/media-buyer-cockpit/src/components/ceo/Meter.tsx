import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { count, isNum, pct } from "./format";
import { Value } from "./Na";
import { STATUS_COLOR, type StatusTone } from "./StatusChip";

/**
 * Value against a target on one track. The fill carries the tone; the track is
 * a lighter step of the same color, so the state reads across the whole bar.
 * When the value passes the target, a tick marks where the target sits.
 */
export function Meter({
  label,
  value,
  target,
  format = count,
  tone = "emphasis",
  sub,
  className,
}: {
  /** What is measured, e.g. "Projected cash vs target". */
  label: string;
  /** Current or projected value; null shows n/a. */
  value: number | null | undefined;
  /** The target; null or 0 shows the value with no track. */
  target: number | null | undefined;
  /** Formatter for value and target (money, count...). */
  format?: (v: number) => string;
  /** emphasis by default; a status tone when the fill should carry severity. */
  tone?: "emphasis" | Exclude<StatusTone, "neutral">;
  /** Line under the track. */
  sub?: ReactNode;
  className?: string;
}) {
  const color =
    tone === "emphasis" ? "var(--ceo-emphasis)" : STATUS_COLOR[tone];
  const hasTarget = isNum(target) && target > 0;
  const v = isNum(value) ? Math.max(0, value) : null;
  const scale = hasTarget ? Math.max(target, v ?? 0) : 0;
  const fill = hasTarget && v !== null ? v / scale : 0;
  const targetAt = hasTarget ? target / scale : 1;
  const share = hasTarget && v !== null ? v / target : null;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] text-muted-foreground">
          {label}
        </p>
        {share !== null ? (
          <p className="shrink-0 text-xs font-medium tabular-nums text-foreground">
            {pct(share)}
          </p>
        ) : null}
      </div>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-foreground">
        <span className="text-lg font-semibold tracking-tight">
          <Value value={isNum(value) ? format(value) : null} />
        </span>
        {hasTarget ? (
          <span className="text-xs text-muted-foreground">
            of {format(target)} target
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">no target set</span>
        )}
      </p>
      {hasTarget ? (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={v ?? undefined}
          aria-valuetext={`${isNum(value) ? format(value) : "n/a"} of ${format(target)}`}
          className="relative mt-2.5 h-2 w-full rounded-full"
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
          {targetAt < 1 ? (
            <div
              className="absolute -top-1 h-4 w-0.5 rounded-full bg-foreground"
              style={{ left: `calc(${(targetAt * 100).toFixed(2)}% - 1px)` }}
              aria-hidden
            />
          ) : null}
        </div>
      ) : null}
      {sub ? <p className="mt-2 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
