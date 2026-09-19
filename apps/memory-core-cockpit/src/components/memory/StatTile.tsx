import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Hint } from "./Hint";
import { Value } from "./Na";

/**
 * One number with its context: label, value, a status chip and a line of
 * explanation. Values use proportional figures (they stand alone).
 */
export function StatTile({
  label,
  value,
  sub,
  status,
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
  /** Secondary line under the value. */
  sub?: ReactNode;
  /** A status chip in the top right. */
  status?: ReactNode;
  /** Tooltip on an info icon beside the label, for definitions. */
  hint?: string;
  /** Tooltip for n/a when the reason is specific. */
  naHint?: string;
  /** card draws its own border; plain sits inside another card. */
  variant?: "card" | "plain";
  /** Makes the tile a button (e.g. jump to a view). */
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-1 text-[13px] leading-5 text-muted-foreground">
        <span className="line-clamp-2 min-w-0">{label}</span>
        {hint ? (
          <Hint content={hint}>
            <button
              type="button"
              className="mt-[3px] inline-flex shrink-0 cursor-help rounded-sm text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={hint}
            >
              <Info className="size-3.5" aria-hidden />
            </button>
          </Hint>
        ) : null}
      </div>
      {/* The chip rides the value row so narrow tiles never truncate the label. */}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="text-2xl font-semibold leading-8 tracking-tight text-foreground sm:text-[26px]">
          <Value value={value} hint={naHint} />
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
      {sub ? (
        <div className="mt-1 min-w-0 text-xs leading-5 text-muted-foreground">
          {sub}
        </div>
      ) : null}
    </>
  );

  const base = cn(
    "relative flex min-w-0 flex-col text-left",
    variant === "card" && "mc-card rounded-xl border bg-card p-4",
    className,
  );

  if (!onClick) return <div className={base}>{content}</div>;
  return (
    <div
      className={cn(
        base,
        "transition-colors hover:border-[color:var(--mc-emphasis)] has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-ring",
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
