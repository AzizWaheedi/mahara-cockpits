import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingPayload } from "@/components/billing/BillingSheet";
import {
  type Account,
  accountFrom,
  buildSheet,
  type Edit,
} from "./billingCore";

// biome-ignore lint/suspicious/noExplicitAny: generic billing payload
type Any = any;

export async function fetchBillingSheet(
  client: SupabaseClient,
  allowedClients?: string[] | null,
): Promise<BillingPayload> {
  const [
    { data: accountsData, error: aErr },
    { data: eventsData, error: eErr },
    { data: inboxData, error: iErr },
  ] = await Promise.all([
    client.from("cockpit_billing_accounts").select("*"),
    client
      .from("cockpit_billing_events")
      .select("*")
      .order("at", { ascending: false })
      .limit(60),
    client
      .from("cockpit_billing_inbox")
      .select("*")
      .eq("status", "pending")
      .order("logged_at", { ascending: false })
      .limit(50),
  ]);

  if (aErr) throw aErr;
  if (eErr) throw eErr;
  if (iErr) throw iErr;

  const accounts: Account[] = (accountsData ?? []).map(accountFrom);
  const events = eventsData ?? [];
  const inbox = inboxData ?? [];

  const s = buildSheet(accounts, events, inbox);

  if (!allowedClients || allowedClients.length === 0) {
    return s;
  }

  const scope = new Set(allowedClients.map(c => c.toLowerCase()));
  const rows = s.rows.filter(r => scope.has(r.name.toLowerCase()));
  const mine = new Set(rows.map(r => r.taskId));

  return {
    ...s,
    rows,
    cards: s.cards.filter(c => mine.has(c.taskId)),
    events: s.events.filter(x => mine.has(x.clickup_task_id)),
    inbox: s.inbox.filter(x => mine.has(String(x.clickup_task_id))),
    totals: {
      ...s.totals,
      dueThisWeek: {
        count: rows.filter(
          r =>
            r.ladder.days !== null &&
            r.ladder.days >= 0 &&
            r.ladder.days <= 7 &&
            r.group !== "paused",
        ).length,
        usd:
          Math.round(
            rows
              .filter(
                r =>
                  r.ladder.days !== null &&
                  r.ladder.days >= 0 &&
                  r.ladder.days <= 7 &&
                  r.group !== "paused",
              )
              .reduce((t, r) => t + (r.nextUsd ?? 0), 0) * 100,
          ) / 100,
      },
      overdue: {
        count: rows.filter(
          r =>
            r.ladder.days !== null && r.ladder.days < 0 && r.group !== "paused",
        ).length,
        usd:
          Math.round(
            rows
              .filter(
                r =>
                  r.ladder.days !== null &&
                  r.ladder.days < 0 &&
                  r.group !== "paused",
              )
              .reduce((t, r) => t + (r.nextUsd ?? 0), 0) * 100,
          ) / 100,
      },
      paused: rows.filter(r => r.group === "paused").length,
      extended: rows.filter(r => (r.extensionWeeks ?? 0) > 0).length,
      noMethod: rows.filter(r => r.group === "active" && !r.method).length,
      noDate: rows.filter(r => r.group === "active" && !r.nextDate).length,
    },
  };
}

/**
 * A refusal the sheet can show. Every billing write goes through the
 * cockpit_billing_write RPC (supabase/migrations/20261009a_billing_native_sync.sql):
 * the server checks the seat and the client, writes the billing log and the
 * audit row, and sends back the sentence to show. `data` is what
 * BillingSheet's errorText and isRepeat read.
 */
export class BillingWriteError extends Error {
  data: { code: "repeat" | "refused"; message: string };
  constructor(message: string, code: "repeat" | "refused" = "refused") {
    super(message);
    this.name = "BillingWriteError";
    this.data = { code, message };
  }
}

async function billingWrite(
  client: SupabaseClient,
  action: "edit" | "payment" | "assign",
  args: Record<string, unknown>,
): Promise<Any> {
  const { data, error } = await client.rpc("cockpit_billing_write", {
    p_action: action,
    p_args: args,
  });
  if (error) {
    let code: "repeat" | "refused" = "refused";
    try {
      if (JSON.parse(String(error.details ?? ""))?.code === "repeat")
        code = "repeat";
    } catch {}
    throw new BillingWriteError(
      error.message ||
        "That did not save, so nothing changed. Try again in a minute.",
      code,
    );
  }
  if (data === null || data === undefined)
    throw new BillingWriteError(
      "The server did not confirm the change. Refresh the sheet before you try again.",
    );
  return data;
}

export async function editBillingAccount(
  client: SupabaseClient,
  _userEmail: string,
  args: { taskId: string; edit: Edit } | Any,
  source: "ceo" | "csm" = "csm",
): Promise<Account> {
  const taskId: string = args.taskId ?? args.account?.taskId ?? "";
  const edit: Edit = args.edit ?? args;
  return accountFrom(
    await billingWrite(client, "edit", { taskId, edit, source }),
  );
}

export async function logBillingPayment(
  client: SupabaseClient,
  _userEmail: string,
  p: {
    account: Account;
    day: string;
    amount: number;
    currency: "USD" | "KWD";
    rail: string;
    reference?: string;
    evidenceUrl?: string;
    note?: string;
    nextDate?: string;
    allowRepeat?: boolean;
  },
  source: "ceo" | "csm" = "csm",
): Promise<string> {
  const out = await billingWrite(client, "payment", {
    taskId: p.account.taskId,
    day: p.day,
    amount: p.amount,
    currency: p.currency,
    rail: p.rail,
    reference: p.reference || null,
    evidenceUrl: p.evidenceUrl || null,
    note: p.note || null,
    nextDate: p.nextDate || null,
    allowRepeat: p.allowRepeat === true,
    source,
  });

  const paid =
    p.currency === "KWD"
      ? `${p.amount.toLocaleString("en-US")} KWD`
      : `$${p.amount.toLocaleString("en-US")}`;
  const moved = out.moved ? `, and next date is now ${out.nextDate}` : "";

  return out.route === "ledger"
    ? `Logged ${paid} from ${p.account.name} in the ledger. It counts toward cash and LTV at the next refresh${moved}.`
    : `Logged ${paid} from ${p.account.name}. It waits in the billing inbox until the next billing sync takes it into the ledger${moved}.`;
}

export async function assignBillingPayer(
  client: SupabaseClient,
  _userEmail: string,
  p: {
    payer: string;
    taskId: string;
    clientName: string;
    usd: number;
    count: number;
  },
): Promise<string> {
  const out = await billingWrite(client, "assign", {
    payer: p.payer,
    taskId: p.taskId,
    clientName: p.clientName,
    usd: p.usd,
    count: p.count,
    source: "ceo",
  });
  const name = String(out.client ?? p.clientName);
  return `Tied ${p.payer} to ${name}. Their payments count as ${name}'s money from the next refresh.`;
}
