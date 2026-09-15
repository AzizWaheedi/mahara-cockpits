import { useReducedMotion } from "framer-motion";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { count, isNum } from "./format";
import { Na } from "./Na";

// Keys that already counted up this page load, so switching tabs does not replay it.
const counted = new Set<string>();

function useCountUp(target: number | null, key: string, enabled: boolean) {
  const first = enabled && isNum(target) && !counted.has(key);
  const [shown, setShown] = useState<number | null>(first ? 0 : target);
  const raf = useRef(0);

  useEffect(() => {
    if (!isNum(target)) {
      setShown(target);
      return;
    }
    if (!enabled || counted.has(key)) {
      setShown(target);
      return;
    }
    counted.add(key);
    const start = performance.now();
    const duration = 900;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setShown(target * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, key, enabled]);

  return shown;
}

/** The one number a view leads with: 48 to 56px, counts up once per page load. */
export function HeroFigure({
  label,
  value,
  format = count,
  sub,
  delta,
  countKey,
  naHint,
  className,
}: {
  /** What the number is, e.g. "Cash collected this month". */
  label: string;
  /** The raw number; null shows n/a. */
  value: number | null | undefined;
  /** Formatter from format.ts (money, count...). */
  format?: (v: number) => string;
  /** Line under the figure, e.g. "Projected $84,000 for September". */
  sub?: ReactNode;
  /** A <Delta size="md" /> beside the sub line. */
  delta?: ReactNode;
  /** Identity for the once-only count-up; defaults to the label. */
  countKey?: string;
  /** Tooltip for n/a when the reason is specific. */
  naHint?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const target = isNum(value) ? value : null;
  const shown = useCountUp(target, countKey ?? label, !reduce);
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-5xl font-semibold leading-none tracking-tight text-foreground sm:text-[56px]">
        {target === null ? (
          <Na hint={naHint} />
        ) : (
          <>
            <span aria-hidden>{format(isNum(shown) ? shown : target)}</span>
            <span className="sr-only">{format(target)}</span>
          </>
        )}
      </p>
      {sub || delta ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {delta ? <span>{delta}</span> : null}
          {sub ? <span className="min-w-0">{sub}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
