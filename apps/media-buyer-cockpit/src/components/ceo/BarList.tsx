import { ChartBarBig } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { count, isNum } from "./format";
import { Na } from "./Na";
import { useTipReserve } from "./useTipReserve";

export type BarListItem = {
  /** Stable key; defaults to the label. */
  key?: string;
  /** Row name, e.g. an ad or a lead source. */
  label: string;
  /** Bar length; null shows n/a with no bar. */
  value: number | null | undefined;
  /** Text at the bar tip instead of the formatted value, e.g. "$420 at $12 CPL". */
  display?: ReactNode;
  /** Muted line under the label. */
  sub?: ReactNode;
};

/** Ranked horizontal bars, one emphasis color, the value at each bar's tip. */
export function BarList({
  items,
  format = count,
  max,
  limit,
  emptyText = "Nothing to rank yet.",
  ariaLabel,
  className,
}: {
  /** Rows in the order to show (sort before passing). */
  items: BarListItem[];
  /** Formatter for the value at the tip. */
  format?: (v: number) => string;
  /** Full-length value; defaults to the largest item. */
  max?: number;
  /** Show only the first N rows. */
  limit?: number;
  /** Text when there are no rows. */
  emptyText?: string;
  /** Screen reader name for the list. */
  ariaLabel?: string;
  className?: string;
}) {
  const [ref, reserve] = useTipReserve<HTMLUListElement>();
  const rows = limit ? items.slice(0, limit) : items;
  if (rows.length === 0)
    return <EmptyState icon={ChartBarBig} title={emptyText} compact />;
  const top =
    max ?? Math.max(0, ...rows.map(r => (isNum(r.value) ? r.value : 0)));

  return (
    <ul ref={ref} aria-label={ariaLabel} className={cn("space-y-3", className)}>
      {rows.map(r => {
        const v = isNum(r.value) ? Math.max(0, r.value) : null;
        const frac = v !== null && top > 0 ? Math.min(1, v / top) : 0;
        return (
          <li key={r.key ?? r.label} className="min-w-0">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <span
                className="min-w-0 truncate text-[13px] text-foreground"
                title={r.label}
              >
                {r.label}
              </span>
              {r.sub ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.sub}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex h-4 min-w-0 items-center gap-2">
              <div
                className="h-2.5 shrink-0 rounded-r-[4px]"
                style={{
                  width: `calc((100% - ${reserve}px) * ${frac.toFixed(4)})`,
                  minWidth: v !== null && v > 0 ? 2 : 0,
                  backgroundColor: "var(--ceo-emphasis)",
                }}
                aria-hidden
              />
              <span
                data-tip
                className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums text-foreground"
              >
                {r.display ?? (v === null ? <Na /> : format(r.value as number))}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
