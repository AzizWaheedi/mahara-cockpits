import { useMemo } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  type BillingApi,
  type BillingPayload,
  BillingSheet,
} from "@/components/billing/BillingSheet";
import {
  assignBillingPayer,
  editBillingAccount,
  fetchBillingSheet,
  logBillingPayment,
} from "@/lib/billing";
import type { CeoTabProps } from "./types";

/**
 * Billing: every client on the books, when they pay next, and the decision
 * to make about it (convex/billing.ts, convex/billingCore.ts). The client
 * success cockpit shows the same sheet; here a logged payment goes straight
 * into the ledger the Money tab reads, and money nobody has tied to a client
 * can be tied from the same screen, so LTV adds up.
 */
export function BillingTab(_: CeoTabProps) {
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
        return fetchBillingSheet(auth.client, null);
      },
      edit: async args => {
        if (!auth.client) throw new Error("Not signed in");
        return editBillingAccount(
          auth.client,
          auth.email,
          args,
          "ceo",
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
          "ceo",
        );
      },
      assign: async p => {
        if (!auth.client) throw new Error("Not signed in");
        return assignBillingPayer(auth.client, auth.email, p);
      },
      ledgerLine:
        "It goes straight into the ledger the Money tab reads, and counts toward cash and LTV at the next refresh.",
    }),
    [auth.client, auth.email],
  );

  return <BillingSheet api={wired} />;
}
