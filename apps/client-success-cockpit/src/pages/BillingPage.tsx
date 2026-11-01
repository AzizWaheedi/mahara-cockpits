import { useEffect, useMemo, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  type BillingApi,
  BillingSheet,
} from "@/components/billing/BillingSheet";
import { ChecksWaiting } from "@/components/billing/ChecksWaiting";
import type { PendingApi } from "@/components/billing/PendingPayments";
import { PageHeader } from "@/components/kit";
import { type Doors, formDoors } from "@/forms/staff/lifecycleClient";
import {
  confirmPaid,
  editBillingAccount,
  fetchBillingSheet,
  fetchPendingPayments,
  logBillingPayment,
  staffForms,
  withdrawConfirmation,
} from "@/lib/billing";

/**
 * Billing: the same sheet as the CEO cockpit's Billing tab, over the clients
 * the portal gave this success manager. A payment logged here waits in the
 * billing inbox until the CEO cockpit takes it into the ledger.
 *
 * Pending payments sits on top (components/billing/PendingPayments.tsx): the
 * clients who signed and have not finished paying, with Confirm paid. The
 * server gives a success manager only their own clients and none of the
 * CEO's groups; linking a deal to a card stays in the CEO cockpit.
 *
 * Give more time, Pause, Resume and Set MRR open the staff forms in place
 * (20261101p); Checks waiting sits on top once 20261101n is live (a success
 * manager reads their own clients' receipts there; finance checks them).
 */
export function BillingPage({ embedded = false }: { embedded?: boolean }) {
  const auth = useCockpitAuth();

  const pending = useMemo<PendingApi>(() => {
    const signedIn = () => {
      if (!auth.client) throw new Error("Sign in to read pending payments.");
      return auth.client;
    };
    return {
      read: async () => fetchPendingPayments(signedIn()),
      confirm: async p => (await confirmPaid(signedIn(), p, "csm")).sentence,
      withdraw: async p => withdrawConfirmation(signedIn(), p, "csm"),
    };
  }, [auth.client]);

  const wired = useMemo<BillingApi>(
    () => ({
      sheet: async () => {
        if (!auth.client) throw new Error("Sign in to read billing.");
        return fetchBillingSheet(auth.client, auth.clients);
      },
      edit: async args => {
        if (!auth.client) throw new Error("Not signed in");
        return editBillingAccount(auth.client, auth.email, args, "csm");
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
      pending,
      forms: auth.client ? staffForms(auth.client, "csm") : undefined,
    }),
    [auth.client, auth.clients, auth.email, pending],
  );

  // The new doors, once per page load; any error reads as all closed.
  const [doors, setDoors] = useState<Doors | null>(null);
  useEffect(() => {
    if (!auth.client) return;
    let live = true;
    void formDoors(auth.client).then(d => {
      if (live) setDoors(d);
    });
    return () => {
      live = false;
    };
  }, [auth.client]);

  return (
    <div
      className={embedded ? "space-y-6" : "mx-auto w-full max-w-6xl space-y-6"}
    >
      <PageHeader
        as={embedded ? "h2" : "h1"}
        title="Billing"
        sub="Who pays next, how they pay, and what the billing SOP says to do today. Every change is made on the ClickUp card."
      />
      {doors?.checks && auth.client ? (
        <ChecksWaiting
          canCheck={auth.isCeo || auth.roles.includes("finance")}
        />
      ) : null}
      <BillingSheet api={wired} />
    </div>
  );
}
