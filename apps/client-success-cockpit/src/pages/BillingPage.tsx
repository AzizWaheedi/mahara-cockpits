import { useCallback, useEffect, useMemo, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  type BillingApi,
  BillingSheet,
} from "@/components/billing/BillingSheet";
import { ChecksWaiting } from "@/components/billing/ChecksWaiting";
import type {
  PendingApi,
  ReceiptAsk,
} from "@/components/billing/PendingPayments";
import { SendFormSheet, type SendPreset } from "@/components/ClientForms";
import { PageHeader } from "@/components/kit";
import type { W56Doors } from "@/forms/staff/formSheetCore";
import {
  type Doors,
  formDoors,
  formDoorsW56,
} from "@/forms/staff/lifecycleClient";
import {
  confirmPaid,
  editBillingAccount,
  fetchBillingSheet,
  fetchPendingPayments,
  logBillingPayment,
  staffForms,
  withdrawConfirmation,
} from "@/lib/billing";
import { formsIO } from "@/lib/clientForms";

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
 *
 * Waves 5-6 (WAVE56-CONTRACT.md 3.6): once the receipts door is open, a part
 * in Pending payments and a logged transfer in Checks waiting can ask the
 * client for the bank transfer receipt: the Send panel opens on the bank
 * receipt with origin billing and that part's context.
 */
export function BillingPage({ embedded = false }: { embedded?: boolean }) {
  const auth = useCockpitAuth();

  // Waves 5-6: the receipts door, read once; any error reads as closed.
  const [w56, setW56] = useState<W56Doors | null>(null);
  useEffect(() => {
    if (!auth.client) return;
    let live = true;
    void formDoorsW56(auth.client).then(d => {
      if (live) setW56(d);
    });
    return () => {
      live = false;
    };
  }, [auth.client]);
  const receiptsOpen = Boolean(w56?.receipts.open);
  const fio = useMemo(
    () => (auth.client ? formsIO(auth.client) : null),
    [auth.client],
  );
  const [sendOpen, setSendOpen] = useState<{
    taskId: string;
    name: string;
    preset: SendPreset;
  } | null>(null);
  // The day a receipt ask went out from this page, per card, so the button waits.
  const [asked, setAsked] = useState<Record<string, string>>({});
  const askReceipt = useCallback((p: ReceiptAsk) => {
    setSendOpen({
      taskId: p.taskId,
      name: p.name,
      preset: {
        formKey: "bank_receipt",
        origin: "billing",
        context: {
          part: p.part,
          partNo: p.partNo,
          expectedAmount: p.expectedAmount,
          currency: p.currency,
          dueOn: p.dueOn,
          dealResponseId: p.dealResponseId,
        },
      },
    });
  }, []);

  const pending = useMemo<PendingApi>(() => {
    const signedIn = () => {
      if (!auth.client) throw new Error("Sign in to read pending payments.");
      return auth.client;
    };
    return {
      read: async () => fetchPendingPayments(signedIn()),
      confirm: async p => (await confirmPaid(signedIn(), p, "csm")).sentence,
      withdraw: async p => withdrawConfirmation(signedIn(), p, "csm"),
      receipts: receiptsOpen
        ? { ask: askReceipt, outSince: taskId => asked[taskId] ?? null }
        : undefined,
    };
  }, [auth.client, receiptsOpen, askReceipt, asked]);

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
        sub="Who pays next, how they pay, and what the billing SOP says to do today. Log every change here; the ClickUp card follows in about two minutes."
      />
      {doors?.checks && auth.client ? (
        <ChecksWaiting
          canCheck={auth.isCeo || auth.roles.includes("finance")}
          onAskReceipt={
            receiptsOpen
              ? row => {
                  if (!row.taskId) return;
                  setSendOpen({
                    taskId: String(row.taskId),
                    name: row.clientName,
                    preset: {
                      formKey: "bank_receipt",
                      origin: "billing",
                      context: {
                        part: "payment",
                        partNo: 0,
                        expectedAmount: row.amount,
                        currency: row.currency,
                        dueOn: null,
                        manualPaymentId: row.id,
                        dealResponseId: null,
                      },
                    },
                  });
                }
              : undefined
          }
        />
      ) : null}
      {receiptsOpen ? (
        <SendFormSheet
          io={fio}
          open={sendOpen !== null}
          taskId={sendOpen?.taskId ?? ""}
          clientName={sendOpen?.name ?? ""}
          preset={sendOpen?.preset}
          view={null}
          onClose={() => setSendOpen(null)}
          onSent={() => {
            const t = sendOpen?.taskId;
            if (t)
              setAsked(a => ({
                ...a,
                [t]: new Date(Date.now() + 3 * 3600_000)
                  .toISOString()
                  .slice(0, 10),
              }));
          }}
        />
      ) : null}
      <BillingSheet api={wired} />
    </div>
  );
}
