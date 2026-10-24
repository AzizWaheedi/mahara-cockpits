import { useMemo, useRef, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  type BillingApi,
  type BillingPayload,
  BillingSheet,
} from "@/components/billing/BillingSheet";
import type { PendingApi } from "@/components/billing/PendingPayments";
import {
  assignBillingPayer,
  confirmPaid,
  editBillingAccount,
  excludePayment,
  fetchBillingSheet,
  fetchPendingPayments,
  linkDealToCard,
  logBillingPayment,
  unexcludePayment,
  unlinkDeal,
  withdrawConfirmation,
} from "@/lib/billing";
import { tieOpener } from "./billingTie";
import { AttributeSheet } from "./money/AttributeSheet";
import { freshPending, type MoneyLine, type PendingTie } from "./money/credit";
import type { CeoTabProps } from "./types";

/**
 * Billing: every client on the books, when they pay next, and the decision
 * to make about it (convex/billing.ts, convex/billingCore.ts). The client
 * success cockpit shows the same sheet; here a logged payment goes straight
 * into the ledger the Money tab reads, and money nobody has tied to a client
 * can be tied from the same screen, so LTV adds up.
 *
 * Pending payments sits on top (components/billing/PendingPayments.tsx): who
 * signed and has not finished paying. Here it also carries what only the CEO
 * gets: the deals with no card (Link to a card), Back with sales, and the
 * untied money that could be a part. Its "Tie it" opens the Money section's
 * tie sheet on that payment, here (billingTie.ts).
 */
export function BillingTab({ sections, goTab }: CeoTabProps) {
  const auth = useCockpitAuth();

  // Possible money's tie sheet: the Money section's published lines, as on
  // the Transactions tab, and the ties saved here until the next refresh.
  const money = sections.money;
  const lines: MoneyLine[] = money?.payload?.attribution?.transactions ?? [];
  const linesNow = useRef(lines);
  linesNow.current = lines;
  const [tying, setTying] = useState<MoneyLine | null>(null);
  const [saved, setSaved] = useState<PendingTie[]>([]);
  const lastOkAt = money?.lastOkAt ?? null;
  const ties = useMemo(() => freshPending(saved, lastOkAt), [saved, lastOkAt]);

  const pending = useMemo<PendingApi>(() => {
    const signedIn = () => {
      if (!auth.client) throw new Error("Sign in to read pending payments.");
      return auth.client;
    };
    return {
      read: async () => fetchPendingPayments(signedIn()),
      confirm: async p => (await confirmPaid(signedIn(), p, "ceo")).sentence,
      withdraw: async p => withdrawConfirmation(signedIn(), p, "ceo"),
      link: async p => linkDealToCard(signedIn(), p, "ceo"),
      unlink: async p => unlinkDeal(signedIn(), p, "ceo"),
      exclude: async p => excludePayment(signedIn(), p, "ceo"),
      unexclude: async p => unexcludePayment(signedIn(), p, "ceo"),
      // Money's tie sheet on that payment; Transactions when it is not there.
      openTie: tieOpener(() => linesNow.current, setTying, goTab),
    };
  }, [auth.client, goTab]);

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
        return editBillingAccount(auth.client, auth.email, args, "ceo");
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
            allowRepeat: p.allowRepeat === true,
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
      pending,
    }),
    [auth.client, auth.email, pending],
  );

  return (
    <>
      <BillingSheet api={wired} />
      <AttributeSheet
        subject={tying ? { kind: "payment", line: tying } : null}
        lines={lines}
        lastRefreshAt={lastOkAt}
        pending={ties}
        onTied={t => setSaved(v => [...v, t])}
        onClose={() => setTying(null)}
      />
    </>
  );
}
