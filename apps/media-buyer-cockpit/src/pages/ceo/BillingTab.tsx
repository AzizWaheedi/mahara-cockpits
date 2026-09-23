import { useAction, useMutation } from "convex/react";
import { useMemo } from "react";
import {
  type BillingApi,
  type BillingPayload,
  BillingSheet,
} from "@/components/billing/BillingSheet";
import { api } from "../../../convex/_generated/api";
import type { Account } from "../../../convex/billingCore";
import type { CeoTabProps } from "./types";

/**
 * Billing: every client on the books, when they pay next, and the decision
 * to make about it (convex/billing.ts, convex/billingCore.ts). The client
 * success cockpit shows the same sheet; here a logged payment goes straight
 * into the ledger the Money tab reads, and money nobody has tied to a client
 * can be tied from the same screen, so LTV adds up.
 */
export function BillingTab(_: CeoTabProps) {
  const sheet = useAction(api.billing.sheet);
  const edit = useAction(api.billing.edit);
  const addPayment = useMutation(api.ceo.manualPayments.add);
  const afterPayment = useAction(api.billing.afterPayment);
  const assign = useAction(api.ceo.payers.assign);
  const afterAssign = useAction(api.billing.afterAssign);

  const wired = useMemo<BillingApi>(
    () => ({
      sheet: a => sheet(a) as Promise<BillingPayload>,
      edit: a => edit(a) as Promise<Account>,
      logPayment: async p => {
        const note = [
          p.reference ? `ref ${p.reference}` : null,
          p.note || null,
          p.evidenceUrl ? `receipt ${p.evidenceUrl}` : null,
        ]
          .filter(Boolean)
          .join("; ");
        // The ledger first: if it refuses (a repeat, a Tap charge that
        // arrives by itself), nothing else moves.
        await addPayment({
          day: p.day,
          amount: p.amount,
          currency: p.currency,
          clientName: p.account.name,
          clickupTaskId: p.account.taskId,
          rail: p.rail,
          ...(note ? { note } : {}),
          ...(p.allowRepeat ? { allowRepeat: true } : {}),
        });
        try {
          await afterPayment({
            taskId: p.account.taskId,
            amount: p.amount,
            currency: p.currency,
            day: p.day,
            rail: p.rail,
            ...(p.nextDate ? { nextDate: p.nextDate } : {}),
            ...(p.reference ? { reference: p.reference } : {}),
          });
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          return `The payment is in the ledger, but the card's next date did not move (${why.replace(/^[\s\S]*Uncaught Error: /, "").slice(0, 120)}). Move it with "Move the date".`;
        }
        const paid =
          p.currency === "KWD"
            ? `${p.amount.toLocaleString("en-US")} KWD`
            : `$${p.amount.toLocaleString("en-US")}`;
        return `Logged ${paid} from ${p.account.name}. It counts toward cash and LTV at the next refresh${p.nextDate ? `, and the card now says they pay next on ${p.nextDate}` : ""}.`;
      },
      assign: async p => {
        await assign({ payer: p.payer, clickupTaskId: p.taskId });
        await afterAssign({
          taskId: p.taskId,
          clientName: p.clientName,
          payer: p.payer,
          usd: p.usd,
          count: p.count,
        }).catch(() => null);
        return `Tied ${p.payer} to ${p.clientName}. Their payments count toward ${p.clientName}'s LTV from the next refresh.`;
      },
      ledgerLine:
        "It goes straight into the ledger the Money tab reads, and counts toward cash and LTV at the next refresh.",
    }),
    [sheet, edit, addPayment, afterPayment, assign, afterAssign],
  );

  return <BillingSheet api={wired} />;
}
