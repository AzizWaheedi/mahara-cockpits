import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { fetchBillingAccount } from "@/lib/billing";
import type { Account } from "@/lib/billingCore";
import { usd } from "@/lib/csmMoney";

/**
 * How they pay on the client page's Billing card (Aziz, 2026-11-02: "How they
 * pay should update the ClickUp and client profile card"). It reads the
 * client's row of the billing sheet (cockpit_billing_accounts), which a How
 * they pay save in Billing updates in the same transaction, so a change shows
 * here at once; the ClickUp card follows through the write-back in about two
 * minutes.
 */

export const HOW_THEY_PAY_EMPTY = "How they pay is not set. Set it in Billing.";
export const HOW_THEY_PAY_NO_ROW =
  "This client is not in the billing sheet. If they pay us, ask the systems manager to add their card.";
export const HOW_THEY_PAY_FAILED =
  "How they pay did not load. Reload the page to try again.";

/** One part of the line; `missing` reads muted, never as a zero. */
export type PayPart = { text: string; missing?: boolean };

/**
 * The line's parts in the card's own words: the method, the plan and the next
 * amount. null when none of the three is set. The day stays in the sentence
 * above it, which reads ClickUp's Next Payment Date; this row's own date can
 * run ahead of it for a few minutes after an edit. An amount of 0 is not set:
 * cockpit_billing_write refuses 0, and four Paid in full rows carry it.
 */
export function howTheyPayParts(a: Account): PayPart[] | null {
  const amount = Number(a.nextUsd) > 0 ? Number(a.nextUsd) : null;
  if (!a.method && !a.plan && amount === null) return null;
  return [
    a.method
      ? { text: a.method }
      : { text: "Payment method not set", missing: true },
    a.plan ? { text: a.plan } : { text: "Plan not set", missing: true },
    amount !== null
      ? { text: `next ${usd(amount)}` }
      : { text: "Next amount not set", missing: true },
  ];
}

type State =
  | { status: "loading" }
  | { status: "ready"; account: Account | null }
  | { status: "failed" };

/** The How they pay line, read once per client page. */
export function HowTheyPay({
  client,
  taskId,
}: {
  client: SupabaseClient | null;
  taskId: string;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    if (!client || !taskId) return;
    let live = true;
    setState({ status: "loading" });
    fetchBillingAccount(client, taskId).then(
      account => {
        if (live) setState({ status: "ready", account });
      },
      () => {
        if (live) setState({ status: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [client, taskId]);

  const parts =
    state.status === "ready" && state.account
      ? howTheyPayParts(state.account)
      : null;
  // Each sentence but the line names How they pay itself.
  const quiet = (text: string, data?: "empty" | "failed") => (
    <p
      data-how-they-pay
      data-empty={data === "empty" ? "" : undefined}
      data-failed={data === "failed" ? "" : undefined}
      className="text-muted-foreground"
    >
      {text}
    </p>
  );
  if (state.status === "loading") return quiet("Reading how they pay");
  if (state.status === "failed") return quiet(HOW_THEY_PAY_FAILED, "failed");
  if (!state.account) return quiet(HOW_THEY_PAY_NO_ROW, "empty");
  if (!parts) return quiet(HOW_THEY_PAY_EMPTY, "empty");
  return (
    <p data-how-they-pay>
      <span className="text-muted-foreground">How they pay: </span>
      <span data-line className="tabular-nums">
        {parts.map((p, i) => (
          <span key={p.text}>
            {i ? " · " : ""}
            <span className={p.missing ? "text-muted-foreground" : undefined}>
              {p.text}
            </span>
          </span>
        ))}
      </span>
    </p>
  );
}
