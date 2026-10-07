import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingPayload } from "@/components/billing/BillingSheet";
import {
  type Account,
  accountFrom,
  accountRow,
  addDays,
  buildSheet,
  type Edit,
  type EventRow,
  kuwaitToday,
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

export async function editBillingAccount(
  client: SupabaseClient,
  userEmail: string,
  args: { taskId: string; edit: Edit } | Any,
  source: "ceo" | "csm" = "ceo",
): Promise<Account> {
  const taskId: string = args.taskId ?? args.account?.taskId ?? "";
  const edit: Edit = args.edit ?? args;

  const { data: row, error: fetchErr } = await client
    .from("cockpit_billing_accounts")
    .select("*")
    .eq("clickup_task_id", taskId)
    .single();

  if (fetchErr) throw fetchErr;
  const current = accountFrom(row);

  const next: Account = {
    ...current,
    source,
    syncedAt: new Date().toISOString(),
  };

  const baseEvent: Omit<EventRow, "kind"> = {
    clickup_task_id: current.taskId,
    client_name: current.name,
    source,
    by_whom: userEmail || source,
    detail: null,
    reason: null,
    from_value: null,
    to_value: null,
  };

  let event: EventRow;
  const today = kuwaitToday();

  switch (edit.kind) {
    case "method": {
      next.method = edit.value;
      event = {
        ...baseEvent,
        kind: "method",
        from_value: current.method,
        to_value: edit.value,
      };
      break;
    }
    case "plan": {
      next.plan = edit.value;
      event = {
        ...baseEvent,
        kind: "plan",
        from_value: current.plan,
        to_value: edit.value,
      };
      break;
    }
    case "amount": {
      next.nextUsd = edit.value;
      event = {
        ...baseEvent,
        kind: "amount",
        from_value: current.nextUsd !== null ? String(current.nextUsd) : null,
        to_value: String(edit.value),
      };
      break;
    }
    case "date": {
      next.nextDate = edit.value;
      event = {
        ...baseEvent,
        kind: "date",
        from_value: current.nextDate,
        to_value: edit.value,
        reason: edit.reason || null,
      };
      break;
    }
    case "extension": {
      const prevWeeks = current.extensionWeeks ?? 0;
      next.extensionWeeks = prevWeeks + edit.weeks;
      if (edit.moveDate && current.nextDate) {
        next.nextDate = addDays(current.nextDate, edit.weeks * 7);
      }
      event = {
        ...baseEvent,
        kind: "extension",
        from_value: String(prevWeeks),
        to_value: String(next.extensionWeeks),
        reason: edit.reason,
        detail: {
          weeksAdded: edit.weeks,
          ours: edit.ours,
          movedDateTo: edit.moveDate ? next.nextDate : null,
        },
      };
      break;
    }
    case "pause": {
      next.group = "paused";
      next.status = "Paused";
      next.pausedOn = edit.on ?? today;
      event = {
        ...baseEvent,
        kind: "pause",
        from_value: current.status,
        to_value: "Paused",
        reason: edit.reason,
        detail: { on: next.pausedOn },
      };
      break;
    }
    case "resume": {
      next.group = "active";
      next.status = "Active";
      next.pausedOn = null;
      if (edit.nextDate) {
        next.nextDate = edit.nextDate;
      }
      event = {
        ...baseEvent,
        kind: "resume",
        from_value: "Paused",
        to_value: "Active",
        detail: { nextDate: next.nextDate },
      };
      break;
    }
    case "note": {
      event = {
        ...baseEvent,
        kind: "note",
        reason: edit.text,
      };
      break;
    }
  }

  // Update Supabase
  const rowUpdated = accountRow(next);
  const { error: accErr } = await client
    .from("cockpit_billing_accounts")
    .update(rowUpdated)
    .eq("clickup_task_id", current.taskId);
  if (accErr) throw accErr;

  const { error: evErr } = await client
    .from("cockpit_billing_events")
    .insert(event);
  if (evErr) throw evErr;

  return next;
}

export async function logBillingPayment(
  client: SupabaseClient,
  userEmail: string,
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
  },
  source: "ceo" | "csm" = "ceo",
): Promise<string> {
  const { error: inErr } = await client.from("cockpit_billing_inbox").insert({
    clickup_task_id: p.account.taskId,
    client_name: p.account.name,
    paid_on: p.day,
    amount: p.amount,
    currency: p.currency,
    method: p.rail,
    reference: p.reference || null,
    evidence_url: p.evidenceUrl || null,
    note: p.note || null,
    source,
    logged_by: userEmail || source,
    status: "pending",
  });

  if (inErr) throw inErr;

  // If nextDate was specified, move it
  if (p.nextDate) {
    await client
      .from("cockpit_billing_accounts")
      .update({ next_payment_date: p.nextDate })
      .eq("clickup_task_id", p.account.taskId);

    await client.from("cockpit_billing_events").insert({
      clickup_task_id: p.account.taskId,
      client_name: p.account.name,
      kind: "payment",
      from_value: p.account.nextDate,
      to_value: p.nextDate,
      reason: `Payment logged: ${p.amount} ${p.currency} via ${p.rail}`,
      source,
      by_whom: userEmail || source,
    });
  }

  const paid =
    p.currency === "KWD"
      ? `${p.amount.toLocaleString("en-US")} KWD`
      : `$${p.amount.toLocaleString("en-US")}`;

  return `Logged ${paid} from ${p.account.name}. It waits in the billing inbox for CEO refresh${
    p.nextDate ? `, and next date is now ${p.nextDate}` : ""
  }.`;
}

export async function assignBillingPayer(
  client: SupabaseClient,
  userEmail: string,
  p: {
    payer: string;
    taskId: string;
    clientName: string;
    usd: number;
    count: number;
  },
): Promise<string> {
  await client.from("cockpit_billing_events").insert({
    clickup_task_id: p.taskId,
    client_name: p.clientName,
    kind: "assign",
    from_value: p.payer,
    to_value: p.clientName,
    reason: `Assigned payer ${p.payer} (${p.count} payments, $${p.usd})`,
    source: "ceo",
    by_whom: userEmail || "ceo",
  });

  return `Tied ${p.payer} to ${p.clientName}.`;
}
