import { CornerDownRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { count, isNum, pct } from "./format";
import { Na } from "./Na";
import { StatusChip } from "./StatusChip";
import { useTipReserve } from "./useTipReserve";

export type FunnelStep = {
  /** Step name, e.g. "Demos booked". */
  label: string;
  /** Count at this step; null shows n/a and breaks the rates on either side. */
  value: number | null | undefined;
  /** Rate from the previous step when the source computes it differently (e.g. show rate on marked calls); defaults to value / previous value. */
  rateFromPrevious?: number | null;
  /** Hide the rate into this step when it is not a conversion (dials per lead can pass 100%). */
  skipRate?: boolean;
  /** Formatter for the value; counts by default. */
  format?: (v: number) => string;
};

type Transition = { index: number; rate: number | null; skip: boolean };

/**
 * Ordered steps as horizontal bars on one scale (the largest step is the full
 * length), the conversion between steps, and the weakest conversion marked as
 * the biggest leak. Steps must share a unit: put money (spend, cash) in `context`.
 */
export function FunnelStrip({
  steps,
  context,
  rateNoun = "converted",
  ariaLabel,
  className,
}: {
  /** Two or more count steps, in funnel order. */
  steps: FunnelStep[];
  /** Figures above the bars that are not counts, e.g. [{ label: "Spend", value: "$4,210" }]. */
  context?: { label: string; value: ReactNode }[];
  /** Word after the rate between steps. */
  rateNoun?: string;
  /** Screen reader name for the list. */
  ariaLabel?: string;
  className?: string;
}) {
  const [ref, reserve] = useTipReserve<HTMLOListElement>();
  const values = steps.map(s => (isNum(s.value) ? Math.max(0, s.value) : null));
  const max = Math.max(0, ...values.filter(isNum));

  const transitions: Transition[] = steps.slice(1).map((s, k) => {
    const i = k + 1;
    if (s.skipRate) return { index: i, rate: null, skip: true };
    if (s.rateFromPrevious !== undefined)
      return {
        index: i,
        rate: isNum(s.rateFromPrevious) ? s.rateFromPrevious : null,
        skip: false,
      };
    const prev = values[i - 1];
    const cur = values[i];
    return {
      index: i,
      rate: prev !== null && cur !== null && prev > 0 ? cur / prev : null,
      skip: false,
    };
  });
  const ranked = transitions.filter(t => t.rate !== null);
  // A leak only means something with at least two conversions to compare.
  const leak =
    ranked.length >= 2
      ? ranked.reduce((a, b) =>
          (b.rate as number) < (a.rate as number) ? b : a,
        )
      : null;

  return (
    <div className={cn("min-w-0", className)}>
      {context?.length ? (
        <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
          {context.map(c => (
            <div key={c.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{c.label}</dt>
              <dd className="text-base font-semibold tracking-tight text-foreground">
                {c.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ol ref={ref} aria-label={ariaLabel}>
        {steps.map((step, i) => {
          const v = values[i];
          const frac = v !== null && max > 0 ? v / max : 0;
          const t = i > 0 ? transitions[i - 1] : null;
          const isLeak = leak !== null && t !== null && leak.index === t.index;
          const fmt = step.format ?? count;
          return (
            <li key={`${step.label}-${i}`} className="min-w-0">
              {t ? (
                <div
                  aria-hidden={t.skip || undefined}
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 text-xs sm:pl-[9.25rem]",
                    t.skip ? "h-2" : "h-7",
                    isLeak ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {t.skip ? null : (
                    <>
                      <CornerDownRight
                        className="size-3.5 shrink-0 text-muted-foreground/70"
                        aria-hidden
                      />
                      <span className="font-medium tabular-nums">
                        {t.rate === null ? <Na /> : pct(t.rate)}
                      </span>
                      <span className="truncate">{rateNoun}</span>
                    </>
                  )}
                  {isLeak ? (
                    <StatusChip
                      tone="serious"
                      label="Biggest leak"
                      className="ml-1"
                    />
                  ) : null}
                </div>
              ) : null}
              <div className="grid min-w-0 items-center gap-x-3 gap-y-1 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                <span className="min-w-0 truncate text-[13px] text-foreground">
                  {step.label}
                </span>
                <div className="flex h-6 min-w-0 items-center gap-2">
                  <div
                    className="h-[18px] shrink-0 rounded-r-[4px]"
                    style={{
                      width: `calc((100% - ${reserve}px) * ${frac.toFixed(4)})`,
                      minWidth: v !== null && v > 0 ? 2 : 0,
                      backgroundColor: "var(--ceo-emphasis)",
                    }}
                    aria-hidden
                  />
                  <span
                    data-tip
                    className="shrink-0 whitespace-nowrap text-sm font-medium tabular-nums text-foreground"
                  >
                    {v === null ? <Na /> : fmt(step.value as number)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
