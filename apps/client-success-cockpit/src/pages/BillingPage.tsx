import { useMemo } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  type BillingApi,
  type BillingPayload,
  BillingSheet,
} from "@/components/billing/BillingSheet";
import {
  editBillingAccount,
  fetchBillingSheet,
  logBillingPayment,
} from "@/lib/billing";

/**
 * Billing: the same sheet as the CEO cockpit's Billing tab, over the clients
 * the portal gave this success manager. A payment logged here waits in the
 * billing inbox until the CEO cockpit takes it into the ledger.
 */
export function BillingPage() {
  const auth = useCockpitAuth();

  const wired = useMemo<BillingApi>(
    () => ({
      sheet: async () => {
        if (!auth.client) {
          return {
            today: new Date().toISOString().slice(0, 10),
            rows: [],
            cards: [],
            events: [],
            inbox: [],
            syncedAt: null,
            totals: {
              dueThisWeek: { count: 0, usd: 0 },
              overdue: { count: 0, usd: 0 },
              paused: 0,
              extended: 0,
              noMethod: 0,
              noDate: 0,
            },
          } as unknown as BillingPayload;
        }
        return fetchBillingSheet(auth.client, auth.clients);
      },
      edit: async args => {
        if (!auth.client) throw new Error("Not signed in");
        return editBillingAccount(
          auth.client,
          auth.email,
          args,
          "csm",
        );
      },
      logPayment: async p => {
        if (!auth.client) throw new Error("Not signed in");
        return logBillingPayment(
          auth.client,
          auth.email,
          {
            account: p.account,
            day: p.day,
            amount: p.amount,
            currency: p.currency,
            rail: p.rail,
            reference: p.reference ?? undefined,
            evidenceUrl: p.evidenceUrl ?? undefined,
            note: p.note ?? undefined,
            nextDate: p.nextDate ?? undefined,
          },
          "csm",
        );
      },
      ledgerLine:
        "It waits for the CEO cockpit's next refresh, then counts toward cash and the client's LTV; a payment already in the ledger is caught, not counted twice.",
    }),
    [auth.client, auth.clients, auth.email],
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
