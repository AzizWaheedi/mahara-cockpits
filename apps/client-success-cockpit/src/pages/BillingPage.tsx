import { useAction } from "convex/react";
import { useMemo, useRef } from "react";
import {
  type BillingApi,
  type BillingPayload,
  BillingSheet,
} from "@/components/billing/BillingSheet";
import { PageHeader } from "@/components/kit";
import { api } from "../../convex/_generated/api";
import type { Account } from "../../convex/billingCore";

/**
 * Billing: the same sheet as the CEO cockpit's Billing tab, over the clients
 * the portal gave this success manager. A payment logged here waits in the
 * billing inbox until the CEO cockpit takes it into the ledger.
 */
export function BillingPage() {
  const requests = useRef(new Map<string, string>());
  const sheet = useAction(api.billing.sheet);
  const edit = useAction(api.billing.edit);
  const logPayment = useAction(api.billing.logPayment);

  const wired = useMemo<BillingApi>(
    () => ({
      sheet: a => sheet(a) as Promise<BillingPayload>,
      edit: a => edit(a) as Promise<Account>,
      logPayment: async p => {
        const fingerprint = JSON.stringify({
          taskId: p.account.taskId,
          day: p.day,
          amount: p.amount,
          currency: p.currency,
          rail: p.rail,
          reference: p.reference,
          evidenceUrl: p.evidenceUrl,
          note: p.note,
          nextDate: p.nextDate,
        });
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(fingerprint),
        );
        const storageKey = `csm-payment-request:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")}`;
        let requestId = requests.current.get(storageKey);
        if (!requestId) {
          try {
            requestId = sessionStorage.getItem(storageKey) || undefined;
          } catch {
            /* Memory fallback. */
          }
          requestId ||= crypto.randomUUID();
          requests.current.set(storageKey, requestId);
          try {
            sessionStorage.setItem(storageKey, requestId);
          } catch {
            /* Memory fallback. */
          }
        }
        const result = await logPayment({
          requestId,
          taskId: p.account.taskId,
          day: p.day,
          amount: p.amount,
          currency: p.currency,
          rail: p.rail,
          ...(p.reference ? { reference: p.reference } : {}),
          ...(p.evidenceUrl ? { evidenceUrl: p.evidenceUrl } : {}),
          ...(p.note ? { note: p.note } : {}),
          ...(p.nextDate ? { nextDate: p.nextDate } : {}),
        });
        requests.current.delete(storageKey);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Memory fallback. */
        }
        return result;
      },
      ledgerLine:
        "Payments stay in the billing inbox until the CEO cockpit reconciles them with the ledger.",
    }),
    [sheet, edit, logPayment],
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Billing"
        sub="Who pays next, how they pay, and what the billing SOP says to do today. Every change is made on the ClickUp card."
      />
      <BillingSheet api={wired} />
    </div>
  );
}
