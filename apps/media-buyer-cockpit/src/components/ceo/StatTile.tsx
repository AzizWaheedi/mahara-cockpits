import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Hint } from "./Hint";
import { Value } from "./Na";
import { Sparkline } from "./Sparkline";

/**
 * One number with its context: label, value, delta, a status chip and an
 * optional sparkline. The value never breaks: "$28,863" stays on one line,
 * and the tile grid widens with its card (container queries) to make room.
 */
export function StatTile({
  label,
  value,
  sub,
  delta,
  status,
  trend,
  hint,
  naHint,
  variant = "card",
  onClick,
  className,
}: {
  /** Sentence case, no trailing colon. */
  label: string;
  /** Formatted value from format.ts; null or "n/a" shows the explained n/a. */
  value: ReactNode;
  /** Secondary line under the value, e.g. "within 5 min: 62%". */
  sub?: ReactNode;
  /** A <Delta /> for the change against a named period. */
  delta?: ReactNode;
  /** A <StatusChip /> in the top right. */
  status?: ReactNode;
  /** Oldest-first values for a sparkline at the foot of the tile. */
  trend?: (number | null)[];
  /** Tooltip on an info icon beside the label, for definitions. */
  hint?: string;
  /** Tooltip for n/a when the reason is specific. */
  naHint?: string;
  /** card draws its own border; plain sits inside another card. */
  variant?: "card" | "plain";
  /** Makes the tile a button (e.g. jump to a tab). */
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-1 text-xs leading-5 text-muted-foreground">
        <span className="line-clamp-2 min-w-0">{label}</span>
        {hint ? (
          <Hint content={hint}>
            <button
              type="button"
              className="no-touch relative mt-[3px] inline-flex shrink-0 cursor-help rounded-sm text-muted-foreground/70 after:absolute after:-inset-2 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={hint}
            >
              <Info className="size-3.5" aria-hidden />
            </button>
          </Hint>
        ) : null}
      </div>
      {/* The chip rides the value row so narrow tiles never truncate the label. */}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="whitespace-nowrap text-2xl font-semibold leading-8 tracking-tight tabular-nums text-foreground">
          <Value value={value} hint={naHint} />
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
      {delta || sub ? (
        <div className="mt-1 flex min-w-0 flex-col gap-0.5">
          {delta ? <div className="min-w-0">{delta}</div> : null}
          {sub ? (
            <div className="min-w-0 text-xs leading-5 text-muted-foreground">
              {sub}
            </div>
          ) : null}
        </div>
      ) : null}
      {trend && trend.length > 1 ? (
        <Sparkline values={trend} height={32} className="mt-3" />
      ) : null}
    </>
  );

  const base = cn(
    "relative flex min-w-0 flex-col text-left",
    variant === "card" && "ceo-card rounded-xl border bg-card p-4",
    className,
  );

  if (!onClick) return <div className={base}>{content}</div>;
  return (
    <div
      className={cn(
        base,
        "transition-colors hover:border-[color:var(--ceo-crosshair)] has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-ring",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none"
      />
      <div className="pointer-events-none relative z-[1] flex min-w-0 flex-col [&_button]:pointer-events-auto">
        {content}
      </div>
    </div>
  );
}
