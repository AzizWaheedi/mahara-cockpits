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
 * scrolls sideways instead of wrapping, so it stays one row. The active chip
 * is the teal pill; a chip that would show nothing ("All 0") is left out
 * unless it is the one selected.
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
      // The 4px of padding lets each chip's invisible tap margin reach past
      // it: a scroller clips everything inside it, vertically too.
      className={cn(
        "ceo-scroll-x -my-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto py-1",
        className,
      )}
    >
      {options
        .filter(o => o.count !== 0 || o.key === value)
        .map(o => {
          const active = o.key === value;
          const Icon = o.icon;
          const chip = (
            <button
              key={o.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.key)}
              className={cn(
                "no-touch relative inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors after:absolute after:-inset-1 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active
                  ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
                    active ? "text-foreground/70" : "text-muted-foreground/80",
                  )}
                >
                  {count(o.count)}
                </span>
              ) : null}
            </button>
          );
          // The chip's own tap filters; its hint stays a hover tooltip.
          return o.hint ? (
            <Hint key={o.key} content={o.hint} tap={false}>
              {chip}
            </Hint>
          ) : (
            chip
          );
        })}
    </div>
  );
}
