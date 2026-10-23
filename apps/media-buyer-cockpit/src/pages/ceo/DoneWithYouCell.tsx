import type { ReactNode } from "react";
import { Hint } from "@/components/ceo/Hint";
import { cn } from "@/lib/utils";
import type { DeliveryPayload } from "@/types/ceo/payloads";
import { cplOnlyOf, DWY_BOOKINGS } from "./deliveryStatus";

type ClientRow = DeliveryPayload["clients"][number];

/**
 * "Done with you" in a cell built on bookings Mahara would make (the CEO, 23
 * Oct 2026, cost per booking decisions, 2: "No keep the CPL but ignore CPB").
 * The cell is blank by rule, never missing data, so it never reads "n/a";
 * the sentence is in the hint. Styled as the explained n/a so it reads as
 * something to hover, in the muted tone with no status and no dot.
 */
export function DoneWithYouCell({
  hint = DWY_BOOKINGS,
  className,
}: {
  hint?: string;
  className?: string;
}) {
  return (
    <Hint content={hint}>
      <button
        type="button"
        aria-label={hint}
        className={cn(
          "no-touch relative cursor-help whitespace-nowrap rounded-sm text-muted-foreground underline decoration-muted-foreground/35 decoration-dotted underline-offset-4 after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        Done with you
      </button>
    </Hint>
  );
}

/**
 * The "Done with you" cell for a Done With You row, or null for any other
 * row: every per-client bookings, cost per booking and booking rate cell on
 * the CEO tabs starts with it.
 */
export function dwyCell(r: ClientRow): ReactNode | null {
  return cplOnlyOf(r) === "dwy" ? <DoneWithYouCell /> : null;
}
