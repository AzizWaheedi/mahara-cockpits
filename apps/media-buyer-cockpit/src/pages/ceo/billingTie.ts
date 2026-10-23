import { canAttribute, type MoneyLine } from "./money/credit";
import type { CeoTabKey } from "./types";

/**
 * Pending payments' Possible money, "Tie it" (Billing tab, 2026-10-23): the
 * Money section's own tie sheet (money/AttributeSheet.tsx) opens over the
 * Billing tab on that very payment, so the CEO ties it to the deal without
 * finding it again on Transactions. A payment the money section no longer
 * lists, or one the tie cannot take (an Ecom id), opens the Transactions tab
 * instead, so the button never does nothing.
 *
 * `lines` is read when the button is pressed, not when the wiring is made,
 * so a money section that arrives later is used.
 */
export function tieOpener(
  lines: () => MoneyLine[],
  open: (line: MoneyLine) => void,
  goTab: (tab: CeoTabKey) => void,
): (paymentId: string) => void {
  return paymentId => {
    const line = lines().find(l => l.id === paymentId);
    if (line && canAttribute(line)) open(line);
    else goTab("transactions");
  };
}
