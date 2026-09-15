import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { NA, NA_HINT } from "./format";
import { Hint } from "./Hint";

/** True for a value the screen must show as "n/a": null, undefined or the "n/a" string from format.ts. */
export function isNa(v: ReactNode): boolean {
  return v === null || v === undefined || v === NA;
}

/** "n/a" with a tooltip saying the source does not give this number yet. */
export function Na({
  hint = NA_HINT,
  className,
}: {
  /** Tooltip text, when the reason is more specific than the default. */
  hint?: string;
  className?: string;
}) {
  return (
    <Hint content={hint}>
      <button
        type="button"
        aria-label={`n/a: ${hint}`}
        className={cn(
          "cursor-help rounded-sm text-muted-foreground underline decoration-muted-foreground/35 decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {NA}
      </button>
    </Hint>
  );
}

/** Renders a formatted value, swapping null or "n/a" for the explained n/a. */
export function Value({ value, hint }: { value: ReactNode; hint?: string }) {
  return isNa(value) ? <Na hint={hint} /> : value;
}
