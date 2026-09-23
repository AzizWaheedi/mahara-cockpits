import { useAction } from "convex/react";
import { useMemo } from "react";
import {
  type BillingApi,
  type BillingPayload,
  BillingSheet,
} from "@/components/billing/BillingSheet";
import { api } from "../../convex/_generated/api";
import type { Account } from "../../convex/billingCore";

/**
 * Billing: the same sheet as the CEO cockpit's Billing tab, over the clients
 * the portal gave this success manager. A payment logged here waits in the
 * billing inbox until the CEO cockpit takes it into the ledger.
 */
export function BillingPage() {
  const sheet = useAction(api.billing.sheet);
  const edit = useAction(api.billing.edit);
  const logPayment = useAction(api.billing.logPayment);

  const wired = useMemo<BillingApi>(
    () => ({
      sheet: a => sheet(a) as Promise<BillingPayload>,
      edit: a => edit(a) as Promise<Account>,
      logPayment: p =>
        logPayment({
          taskId: p.account.taskId,
          day: p.day,
          amount: p.amount,
          currency: p.currency,
          rail: p.rail,
          ...(p.reference ? { reference: p.reference } : {}),
          ...(p.evidenceUrl ? { evidenceUrl: p.evidenceUrl } : {}),
          ...(p.note ? { note: p.note } : {}),
          ...(p.nextDate ? { nextDate: p.nextDate } : {}),
        }),
      ledgerLine:
        "It waits for the CEO cockpit's next refresh, then counts toward cash and the client's LTV; a payment already in the ledger is caught, not counted twice.",
    }),
    [sheet, edit, logPayment],
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Who pays next, how they pay, and what the billing SOP says to do
          today. Every change is made on the ClickUp card.
        </p>
      </header>
      <BillingSheet api={wired} />
    </div>
  );
}
