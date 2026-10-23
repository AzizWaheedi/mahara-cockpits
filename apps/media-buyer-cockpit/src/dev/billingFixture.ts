/**
 * The Billing tab in the layout harness (2026-10-23): the billing sheet and
 * Pending payments, read from fixtures, without signing in. Open
 * /harness.html?tab=billing. Never imported by the production app.
 *
 * The rows are the ones cockpit_billing_balances_read() returned to the CEO
 * on 23 Oct 2026 (scripts/fixtures/billingBalances20261023.ts, the rule
 * test's fixture: contact and payer names are made up, no email or phone).
 * The sheet's own tables are built from the same cards, events and inbox, so
 * "Log it as a payment" finds the client's row. Writes stay in memory and
 * answer the way 20261023y and cockpit_billing_write do.
 *
 * ?pending= picks the scenario:
 *   live       (default) the CEO's read on 23 Oct
 *   csm        a success manager: none of the CEO's groups, no payer names
 *   confirmed  a confirmation waiting for Tap (yours, on the metal
 *              works), a success manager's Tap one from 11 days ago that no
 *              rail proves (Alalia: it reaches the CEO), a withdrawn one
 *              (Marble), and Ardon's card with no next amount, so "Put the
 *              next part on the card" shows
 *   empty      nobody owes anything
 *   never      the money ledger has never run (every amount reads n/a)
 *   stale      the money ledger last ran two hours ago
 *   error      the read is refused (the sheet still loads)
 *   slow       the read answers after four seconds
 * &write=refuse makes every Confirm paid come back with the server's refusal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BalancesRead,
  ReadConfirmation,
  ReadDeal,
} from "@/lib/billingBalances";
import { LIVE_2026_10_23 } from "../../scripts/fixtures/billingBalances20261023";

type Answer = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Answer => ({ data, error: null });
const refuse = (message: string): Answer => ({
  data: null,
  error: { message },
});

const param = (k: string): string | null =>
  typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.search).get(k);

export type PendingScenario =
  | "live"
  | "csm"
  | "confirmed"
  | "empty"
  | "never"
  | "stale"
  | "error"
  | "slow";

export function pendingScenario(): PendingScenario {
  const p = param("pending");
  return (
    [
      "live",
      "csm",
      "confirmed",
      "empty",
      "never",
      "stale",
      "error",
      "slow",
    ] as const
  ).includes(p as PendingScenario)
    ? (p as PendingScenario)
    : "live";
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The read for a scenario, with "now" as the fixture's read time unless the scenario moves it. */
export function billingRead(
  scenario: PendingScenario = "live",
  now: number = Date.now(),
): BalancesRead {
  const read = clone(LIVE_2026_10_23);
  // The fixture was read on 23 Oct; the harness keeps that day, so the
  // figures match PLAN.md section 5, and the clocks read fresh.
  const fresh = new Date(now - 5 * 60_000).toISOString();
  read.moneyAsOf = fresh;
  read.cardsAsOf = fresh;
  read.dealsAsOf = fresh;
  read.callsAsOf = fresh;
  read.untiedAsOf = fresh;
  switch (scenario) {
    case "csm":
      return asSuccessManager(read);
    case "empty":
      return {
        ...read,
        cards: [],
        deals: [],
        rails: [],
        calls: [],
        kickoffs: [],
        cardHistory: [],
        events: [],
        inbox: [],
        invoices: [],
        ecomOpen: [],
        confirmations: [],
        untied: [],
        unlinked: [],
        backWithSales: [],
      };
    case "never":
      // No ledger run: no rail rows either, so nothing is counted.
      read.moneyAsOf = null;
      read.untiedAsOf = null;
      read.rails = [];
      read.untied = [];
      return read;
    case "stale":
      read.moneyAsOf = new Date(now - 2 * 3600_000).toISOString();
      return read;
    case "confirmed":
      return withConfirmations(read, now);
    default:
      return read;
  }
}

/** What the server leaves out for a success manager (20261023x): no CEO groups, no payer or contact names. */
function asSuccessManager(read: BalancesRead): BalancesRead {
  return {
    ...read,
    ceo: false,
    deals: read.deals.map(d => {
      const { contactName: _c, conflictWith: _w, ...rest } = d;
      return rest as ReadDeal;
    }),
    untied: read.untied.map(u => ({ ...u, payerName: null })),
    unlinked: [],
    backWithSales: [],
  };
}

const card = (read: BalancesRead, name: RegExp) =>
  read.cards.find(c => name.test(c.name));
const dealOf = (read: BalancesRead, taskId: string | undefined) =>
  read.deals.find(d => d.taskId === taskId) ?? null;

function withConfirmations(read: BalancesRead, now: number): BalancesRead {
  const at = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const metals = card(read, /المعادن/);
  const alalia = card(read, /^Alalia/);
  const marble = card(read, /^Marble/);
  const ardon = card(read, /^Ardon$/);
  const base = {
    evidenceUrl: null,
    railsAsOf: read.moneyAsOf,
    withdrawnByName: null,
    withdrawnAt: null,
    withdrawnReason: null,
  };
  const list: ReadConfirmation[] = [];
  if (metals)
    list.push({
      ...base,
      id: 9001,
      taskId: metals.taskId,
      dealResponseId: dealOf(read, metals.taskId)?.responseId ?? null,
      part: "onboarding",
      partNo: 0,
      amount: 5750,
      currency: "USD",
      usd: 5750,
      rail: "tap",
      paidOn: read.today,
      note: "Paid on the call; the link was sent on WhatsApp",
      evidenceUrl: "https://example.test/receipt",
      railsUsdAtConfirm: 250,
      source: "ceo",
      confirmedByName: "The CEO",
      confirmedByCeo: true,
      byYou: true,
      confirmedAt: at(0),
    });
  if (alalia)
    list.push({
      ...base,
      id: 9002,
      taskId: alalia.taskId,
      dealResponseId: dealOf(read, alalia.taskId)?.responseId ?? null,
      part: "onboarding",
      partNo: 0,
      amount: 1500,
      currency: "USD",
      usd: 1500,
      rail: "tap",
      paidOn: "2026-10-12",
      note: null,
      railsUsdAtConfirm: 2497.18,
      source: "csm",
      confirmedByName: "Noor Example",
      confirmedByCeo: false,
      byYou: false,
      confirmedAt: at(11),
    });
  if (marble)
    list.push({
      ...base,
      id: 9003,
      taskId: marble.taskId,
      dealResponseId: dealOf(read, marble.taskId)?.responseId ?? null,
      part: "onboarding",
      partNo: 0,
      amount: 1000,
      currency: "USD",
      usd: 1000,
      rail: "tap",
      paidOn: "2026-10-15",
      note: null,
      railsUsdAtConfirm: 2000,
      source: "csm",
      confirmedByName: "Noor Example",
      confirmedByCeo: false,
      byYou: false,
      confirmedAt: at(6),
      withdrawnByName: "Noor Example",
      withdrawnAt: at(5),
      withdrawnReason: "It was the card's renewal, not this part",
    });
  // Ardon's card with no next amount: the panel offers to put the next part on it.
  if (ardon) ardon.nextUsd = null;
  read.confirmations = list;
  return read;
}

// --- the sheet's own tables ---------------------------------------------------

type Row = Record<string, unknown>;

/** The sheet's three tables (accounts, events, pending inbox), built from the same read. */
export function sheetTables(read: BalancesRead) {
  const accounts: Row[] = [
    ...read.cards.map(c => ({
      clickup_task_id: c.taskId,
      client_name: c.name,
      task_url: c.url,
      client_status: c.status,
      stage_group: c.group,
      payment_method: c.method ?? null,
      payment_plan: c.plan,
      next_payment_usd: c.nextUsd,
      next_payment_date: c.nextDate,
      ltv_field_usd: c.ltvFieldUsd,
      extension_weeks: c.extensionWeeks,
      csm: c.csm ?? null,
      synced_at: read.cardsAsOf,
      source: "sync",
    })),
    ...read.backWithSales.map(s => ({
      clickup_task_id: s.taskId,
      client_name: s.name,
      task_url: s.url,
      client_status: s.status,
      stage_group: "sales",
      ltv_field_usd: s.ltvFieldUsd,
      synced_at: read.cardsAsOf,
      source: "sync",
    })),
  ];
  const nameOf = new Map(accounts.map(a => [a.clickup_task_id, a.client_name]));
  const events: Row[] = read.events.map((e, i) => ({
    id: e.id ?? 100_000 + i,
    clickup_task_id: e.taskId,
    client_name: nameOf.get(e.taskId) ?? e.taskId,
    kind: e.kind,
    from_value: e.from,
    to_value: e.to,
    reason: e.reason,
    detail: e.weeks !== null ? { weeks: e.weeks } : {},
    source: e.source ?? "ceo",
    by_whom: e.byName ?? "someone",
    at: e.at,
  }));
  const inbox: Row[] = read.inbox.map(i => ({
    id: i.id,
    clickup_task_id: i.taskId,
    client_name: nameOf.get(i.taskId) ?? i.taskId,
    paid_on: i.paidOn,
    amount: i.amount,
    currency: i.currency,
    method: i.method,
    source: i.source,
    logged_by: i.loggedByName ?? "someone",
    logged_at: i.loggedAt,
    status: i.status,
  }));
  return { accounts, events, inbox };
}

/** A read-only query builder over fixture rows, for `client.from(...)`. */
function rowsQuery(rows: () => Row[]) {
  let out: Row[] | null = null;
  const steps: ((r: Row[]) => Row[])[] = [];
  const q = {
    select: () => q,
    order: (col: string, o?: { ascending?: boolean }) => {
      steps.push(r => {
        const s = [...r].sort((a, b) =>
          String(a[col] ?? "").localeCompare(String(b[col] ?? "")),
        );
        return o?.ascending === false ? s.reverse() : s;
      });
      return q;
    },
    limit: (n: number) => {
      steps.push(r => r.slice(0, n));
      return q;
    },
    eq: (col: string, v: unknown) => {
      steps.push(r => r.filter(x => x[col] === v));
      return q;
    },
    // biome-ignore lint/suspicious/noThenProperty: a thenable like supabase-js's builder
    then: (resolve: (a: Answer) => unknown) => {
      out = steps.reduce((r, f) => f(r), rows());
      return resolve(ok(out));
    },
  };
  return q;
}

// --- the install --------------------------------------------------------------

/** Lay the Billing tab's reads and writes over the harness client. */
export function installBillingHarness(client: SupabaseClient): void {
  const c = client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
    from: (table: string) => unknown;
  };
  const scenario = pendingScenario();
  const read = billingRead(scenario);
  const tables = sheetTables(read);
  let nextId = 9100;

  const before = c.rpc;
  c.rpc = async (name, args = {}) => {
    switch (name) {
      case "cockpit_billing_balances_read":
        if (scenario === "error")
          return refuse(
            "Pending payments need a client success, finance or CEO seat. Ask an admin to add the role.",
          );
        if (scenario === "slow") await new Promise(r => setTimeout(r, 4000));
        return ok(clone(read));
      case "cockpit_billing_balance_write":
        return balanceWrite(
          String(args.p_action ?? ""),
          (args.p_args ?? {}) as Row,
        );
      case "cockpit_billing_write":
        return sheetWrite(
          String(args.p_action ?? ""),
          (args.p_args ?? {}) as Row,
        );
      default:
        return before(name, args);
    }
  };

  const realFrom = c.from.bind(c);
  c.from = (table: string) => {
    if (table === "cockpit_billing_accounts")
      return rowsQuery(() => tables.accounts);
    if (table === "cockpit_billing_events")
      return rowsQuery(() => tables.events);
    if (table === "cockpit_billing_inbox") return rowsQuery(() => tables.inbox);
    return realFrom(table);
  };

  const logEvent = (taskId: string, kind: string, extra: Row) => {
    const name =
      tables.accounts.find(a => a.clickup_task_id === taskId)?.client_name ??
      taskId;
    tables.events.unshift({
      id: nextId++,
      clickup_task_id: taskId,
      client_name: name,
      kind,
      from_value: null,
      to_value: null,
      reason: null,
      detail: {},
      source: read.ceo ? "ceo" : "csm",
      by_whom: read.ceo ? "ceo@example.test" : "csm@example.test",
      at: new Date().toISOString(),
      ...extra,
    });
  };

  async function balanceWrite(action: string, a: Row): Promise<Answer> {
    await new Promise(r => setTimeout(r, 700));
    const taskId = String(a.taskId ?? "");
    if (action === "confirm") {
      if (param("write") === "refuse")
        return refuse(
          "That is more than the $5,750 the rails have not shown. Check the amount, or withdraw an older confirmation first.",
        );
      const amount = Number(a.amount);
      const usd =
        a.currency === "KWD" ? Math.round(amount * 326) / 100 : amount;
      const railName =
        { whop: "Whop", tap: "Tap", ecom: "Ecom" }[String(a.rail)] ?? "a rail";
      const row: ReadConfirmation = {
        id: nextId++,
        taskId,
        dealResponseId: (a.dealResponseId as string | null) ?? null,
        part: a.part as ReadConfirmation["part"],
        partNo: Number(a.partNo ?? 0),
        amount,
        currency: a.currency === "KWD" ? "KWD" : "USD",
        usd,
        rail: a.rail as ReadConfirmation["rail"],
        paidOn: String(a.paidOn),
        evidenceUrl: (a.evidenceUrl as string | null) ?? null,
        note: (a.note as string | null) ?? null,
        railsUsdAtConfirm: null,
        railsAsOf: read.moneyAsOf,
        source: read.ceo ? "ceo" : "csm",
        confirmedByName: read.ceo ? "The CEO" : "A success manager",
        confirmedByCeo: read.ceo,
        byYou: true,
        confirmedAt: new Date().toISOString(),
        withdrawnByName: null,
        withdrawnAt: null,
        withdrawnReason: null,
      };
      read.confirmations.push(row);
      logEvent(taskId, "confirm", {
        to_value: String(usd),
        detail: {
          part: row.part,
          partNo: row.partNo,
          rail: row.rail,
          usd,
          paidOn: row.paidOn,
        },
      });
      return ok({
        ok: true,
        sentence: `Confirmed by you · waiting for ${railName}`,
        confirmation: { id: row.id },
      });
    }
    if (action === "withdraw") {
      const conf = read.confirmations.find(
        x => x.id === Number(a.confirmationId),
      );
      if (!conf || conf.withdrawnAt)
        return refuse(
          "That confirmation is already withdrawn. Reload the page.",
        );
      conf.withdrawnAt = new Date().toISOString();
      conf.withdrawnByName = read.ceo ? "The CEO" : "A success manager";
      conf.withdrawnReason = String(a.reason ?? "");
      logEvent(conf.taskId, "unconfirm", {
        from_value: String(conf.usd),
        reason: conf.withdrawnReason,
      });
      return ok({ ok: true, sentence: "Withdrawn." });
    }
    if (action === "link") {
      if (!read.ceo)
        return refuse("Only the CEO can link a signed deal to a client card.");
      const i = read.unlinked.findIndex(
        u => u.responseId === String(a.dealResponseId),
      );
      const target = read.cards.find(x => x.taskId === taskId);
      if (i < 0 || !target)
        return refuse("That deal or card is not on the list. Reload the page.");
      const [u] = read.unlinked.splice(i, 1);
      const {
        suggestedTaskId: _s,
        suggestedName: _n,
        suggestedSignupOn: _o,
        rails,
        ...deal
      } = u;
      read.deals.push({
        ...deal,
        taskId,
        matchedBy: "link",
        linkedByName: "The CEO",
      });
      read.rails.push(...rails);
      logEvent(taskId, "link", { to_value: deal.responseId });
      return ok({ ok: true, sentence: `Linked to ${target.name}.` });
    }
    if (action === "unlink") {
      const d = read.deals.find(
        x =>
          x.responseId === String(a.dealResponseId) && x.matchedBy === "link",
      );
      if (!d?.taskId)
        return refuse("That deal is not linked to a card. Reload the page.");
      const name = read.cards.find(x => x.taskId === d.taskId)?.name;
      logEvent(d.taskId, "unlink", { reason: String(a.reason ?? "") });
      d.taskId = null;
      d.matchedBy = null;
      return ok({ ok: true, sentence: `Unlinked from ${name ?? "the card"}.` });
    }
    return refuse("That is not a pending payments action.");
  }

  async function sheetWrite(action: string, a: Row): Promise<Answer> {
    await new Promise(r => setTimeout(r, 500));
    const taskId = String(a.taskId ?? "");
    const acc = tables.accounts.find(x => x.clickup_task_id === taskId);
    if (!acc) return refuse("That client card is not in the harness.");
    if (action === "payment") {
      logEvent(taskId, "payment", {
        detail: { amount: a.amount, currency: a.currency, rail: a.rail },
      });
      return ok({ route: read.ceo ? "ledger" : "inbox", moved: false });
    }
    if (action === "edit") {
      const e = (a.edit ?? {}) as Row;
      if (e.kind === "amount") acc.next_payment_usd = Number(e.value);
      if (e.kind === "date") acc.next_payment_date = String(e.value);
      logEvent(taskId, String(e.kind ?? "note"), {
        to_value: e.value === undefined ? null : String(e.value),
        reason: (e.reason as string | undefined) ?? null,
      });
      // Pending payments reads the card too: keep the two in step.
      const own = read.cards.find(x => x.taskId === taskId);
      if (own && e.kind === "amount") own.nextUsd = Number(e.value);
      if (own && e.kind === "date") own.nextDate = String(e.value);
      return ok({ ...acc });
    }
    return refuse(`The harness has no fixture for ${action}.`);
  }
}
