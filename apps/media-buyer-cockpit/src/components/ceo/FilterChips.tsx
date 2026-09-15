import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { count } from "./format";
import { Hint } from "./Hint";
import { STATUS_COLOR, type StatusTone } from "./StatusChip";

export type FilterOption<K extends string> = {
  key: K;
  /** Chip text, sentence case. */
  label: string;
  /** Rows behind the chip; leave out to show no count. */
  count?: number;
  /** Icon before the label, e.g. a feed kind. */
  icon?: LucideIcon;
  /** A status dot before the label, for chips that filter by status. */
  tone?: StatusTone;
  /** Tooltip saying what the chip keeps. */
  hint?: string;
};

/**
 * One row of toggle chips that scope the list below them. On a phone the row
 * scrolls sideways instead of wrapping, so it stays one row.
 */
export function FilterChips<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  /** Chips in order; the first is usually "All". */
  options: FilterOption<K>[];
  /** The active chip. */
  value: K;
  /** Called with the chip that was pressed. */
  onChange: (key: K) => void;
  /** Screen reader name for the group, e.g. "Show clients". */
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "ceo-scroll-x flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto",
        className,
      )}
    >
      {options.map(o => {
        const active = o.key === value;
        const Icon = o.icon;
        const chip = (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active
                ? "border-foreground/20 bg-foreground/[0.07] text-foreground"
                : "bg-card text-muted-foreground hover:bg-[var(--ceo-hover)] hover:text-foreground",
            )}
          >
            {o.tone ? (
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    o.tone === "neutral"
                      ? "var(--ceo-deemphasis)"
                      : STATUS_COLOR[o.tone],
                }}
              />
            ) : null}
            {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
            {o.label}
            {typeof o.count === "number" ? (
              <span
                className={cn(
                  "tabular-nums",
                  active ? "text-foreground/65" : "text-muted-foreground/80",
                )}
              >
                {count(o.count)}
              </span>
            ) : null}
          </button>
        );
        return o.hint ? (
          <Hint key={o.key} content={o.hint}>
            {chip}
          </Hint>
        ) : (
          chip
        );
      })}
    </div>
  );
}
