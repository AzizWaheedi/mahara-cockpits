import { describe, expect, test } from "bun:test";
import { withRuntime, type Row, type Runtime } from "./runtime.ts";
import { createMoneyAdapter, mrrCheckRows } from "./native/adapters/money.js";
import { readKickoffs } from "./native/adapters/growth.js";

/**
 * Checked money in the money refresh (supabase/migrations/20261101n_checked_money.sql;
 * docs/forms/WAVE12-CONTRACT.md 3.6 and 4.2.3). A payment logged by hand is cash,
 * pay and LTV only once finance or the CEO checked it against the bank; a logged
 * one is listed (checked false) and said on its own line (rails.manualLogged), a
 * rejected one is no money anywhere. Made-up clients and amounts only.
 */
const now = Date.now();
const today = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthOf = (day: string) => day.slice(0, 7);
const firstOf = (month: string) => `${month}-01`;
const shift = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const lastMonth = shift(monthOf(today), -1);
const twoAgo = shift(monthOf(today), -2);

type Manual = Partial<Record<string, unknown>> & { id: string; day: string; amount_usd: number };
const manualRow = (r: Manual) => ({
  amount: r.amount_usd, currency: "USD", usd_per_unit: 1, client_name: "Client A", client_key: "clienta",
  clickup_task_id: "task-a", rail: "bank_transfer", kind: "payment", deal_contracted: null, deal_contracted_usd: null,
  note: null, added_by: "csm: sara@example.test", added_at: new Date(now - 86_400_000).toISOString(), deleted_by: null, deleted_at: null,
  check_state: "logged", checked_by: null, checked_at: null, checked_ref: null, statement_line_id: null,
  ...r,
});

function snapshot(manual: Row[]): Row {
  return {
    revision: 9, totals_revision: 0, history_ready: true, aliases_ready: true, manual_ready: true,
    updated_at: new Date(now).toISOString(),
    manual, aliases: [], payers: [], exclusions: [], ties: [],
    billing: [
      { clickup_task_id: "task-a", client_name: "Client A", stage: "Active", mrr_usd: 1000, ltv_usd: 9000, payment_plan: "Monthly", captured_at: new Date(now).toISOString() },
      { clickup_task_id: "task-b", client_name: "Client B", stage: "Active", mrr_usd: 2000, ltv_usd: 2000, payment_plan: "Monthly", captured_at: new Date(now).toISOString() },
    ],
    series: [],
    statements: [{ id: "st-1", account: "XXXX4348", account_kind: "card", from_day: addDays(today, -30), to_day: addDays(today, -2), lines: 1, imported_at: new Date(now - 86_400_000).toISOString() }],
    bank_lines: [
      { id: 2, statement_id: "st-1", day: addDays(today, -3), usd: -32.6, amount: -10, currency: "KWD", reference: "Software vendor", account: "XXXX4348", kind: "expense", category: "software" },
    ],
  };
}

type Fixture = Row[] | ((query: string) => Row[]);

function reader(overrides: Record<string, Fixture> = {}) {
  const fixtures: Record<string, Fixture> = {
    "money.cash": [{ day: today, cash: 0 }],
    "money.summary": [{ whop_synced_ms: now, whop_last_paid_ms: now, deals_synced_ms: now, failed_count_30: 0, failed_amount_30: 0, refunds_mtd: 0, refunds_90: 0, avg_contract_90: 500, first_deal_day: today }],
    "money.monthly": [{ month: monthOf(today), cash: 0, refunds: 0, deals: 0, contracted: 0 }],
    "money.recent_deals": [],
    "money.targets": [],
    // One Whop payment from Client A's own card name last month: tied to the card, as a rail.
    "money.attribution.whop": [{ payment_id: "pay_whop_a", day: firstOf(lastMonth), net_amount: 600, final_amount: 600, refunded_amount: 0, refund_day: null, email: null, billing: "Client A", username: null, deal_response_id: null, billing_reason: "subscription_cycle" }],
    "money.attribution.transfers": [],
    "money.attribution.deals": [],
    "money.attribution.logins": [],
    "money.attribution.expenses": [],
    "money.tap_state": [{ ok: true, note: null, rows_seen: 0, run_ms: now, ok_ms: now }],
    "money.tap_charges": [],
    "money.ecom_state": [{ ok: true, note: null, ok_ms: now }],
    "money.ecom_invoices": [],
    "money.media_feed": [{ ready: true, source_rows: 1, actual_rows: 1, snapshot_ms: now - 600_000, first_day: "2026-08-13", last_day: today }],
    "money.client_ads": [],
    ...overrides,
  };
  return async (_project: string, query: string): Promise<Row[]> => {
    const marker = /\/\*\s*ceo-refresh:([a-z0-9._-]+)\s*\*\//i.exec(query)?.[1];
    if (!marker || !(marker in fixtures)) throw new Error(`No fixture for ${marker ?? query.slice(0, 80)}`);
    const fixture = fixtures[marker];
    return typeof fixture === "function" ? fixture(query) : fixture;
  };
}

function runtimeWith(read: Runtime["read"]): Runtime {
  return { env: () => undefined, read, repository: {} as Runtime["repository"], tools: {} as Runtime["tools"] };
}

type Txn = { id: string; rail: string; usd: number; side: string; direction: string; checked: boolean; clientTaskId: string | null; detail: string | null };
type MoneyOut = {
  payload: Row & {
    rails: Record<string, Row> & { manualLogged: { count: number; usd: number; oldestDay: string | null } };
    attribution: { totals: Row & { in?: number }; transactions: Txn[]; dealLedger: { rows: number; usd: number } };
    manualChecks: { id: string; state: string; at: string | null; ref: string | null }[];
    mrrCheck: { asOf: string; rows: { taskId: string; railMonthlyUsd: number; months: number; rails: string[]; note: string }[] };
    notes: { level: string; text: string }[];
    book: Row;
  };
  clientPayments: { payment_id: string; clickup_task_id: string; usd: number }[];
  dealPayments: { payment_id: string }[];
};

async function compute(manual: Row[], overrides: Record<string, Fixture> = {}): Promise<MoneyOut> {
  return withRuntime(runtimeWith(reader(overrides)), async () =>
    (await createMoneyAdapter(snapshot(manual)).compute({ repository: {} as Runtime["repository"] })) as unknown as MoneyOut);
}

const CHECKED = manualRow({ id: "m-checked", day: addDays(firstOf(lastMonth), 4), amount_usd: 1000, check_state: "checked", checked_by: "fin@example.test", checked_at: new Date(now - 3_600_000).toISOString(), checked_ref: "CBK FT0001" });
const LOGGED = manualRow({ id: "m-logged", day: addDays(today, -1) < firstOf(monthOf(today)) ? today : addDays(today, -1), amount_usd: 500 });
const REJECTED = manualRow({ id: "m-rejected", day: addDays(firstOf(lastMonth), 6), amount_usd: 200, check_state: "rejected", checked_by: "fin@example.test", checked_at: new Date(now - 7_200_000).toISOString(), checked_ref: "Not on the statement" });
const OTHER_CARD_LOGGED = manualRow({ id: "m-logged-b", day: firstOf(lastMonth), amount_usd: 700, clickup_task_id: "task-b", client_name: "Client B", client_key: "clientb" });

describe("the money section counts checked money and says logged money apart", () => {
  test("cash, the rails and the attribution count the checked row only; the logged row is on its own line", async () => {
    const out = await compute([CHECKED, LOGGED, REJECTED]);
    const p = out.payload;
    const manual = p.rails.manual as Row & { lastMonth: number; mtd: number };
    expect(manual.lastMonth).toBe(1000);
    expect(p.rails.manualLogged).toEqual({ count: 1, usd: 500, oldestDay: LOGGED.day });
    // The total over the rails never carries the logged 500 or the rejected 200.
    // (Whop cash on the rails comes from its own daily read, nil here.)
    const total = p.rails.total as Row & { lastMonth: number; mtd: number };
    expect(total.lastMonth).toBe(1000);
    expect(total.mtd).toBe(0);
    expect(p.notes.some(n => n.level === "warn" && n.text.startsWith("1 payment logged by hand waits on a check against the bank ($500,"))).toBe(true);
  });

  test("transactions: every row says checked; the logged row is listed false and summed into no total", async () => {
    const { payload, dealPayments } = await compute([CHECKED, LOGGED, REJECTED]);
    const t = payload.attribution.transactions;
    for (const row of t) expect(typeof row.checked).toBe("boolean");
    expect(t.find(r => r.id === "manual:m-checked")).toMatchObject({ checked: true, clientTaskId: "task-a" });
    expect(t.find(r => r.id === "manual:m-logged")).toMatchObject({ checked: false, clientTaskId: "task-a", detail: "Logged by hand, not checked against the bank yet" });
    expect(t.find(r => r.id === "whop:pay_whop_a")).toMatchObject({ checked: true });
    expect(t.some(r => r.id === "manual:m-rejected")).toBe(false);
    // Attribution totals and the deal ledger are checked money.
    const inUsd = (payload.attribution.totals as Row & { frontEnd: number; backEnd: number; unattributed: number; notClient?: number });
    expect(inUsd.frontEnd + inUsd.backEnd + inUsd.unattributed).toBe(1600);
    expect(dealPayments.some(d => d.payment_id === "manual:m-logged")).toBe(false);
  });

  test("the client payment store gets the logged row too, so Pending payments can say it apart", async () => {
    const { clientPayments } = await compute([CHECKED, LOGGED]);
    expect(clientPayments.map(r => r.payment_id).sort()).toEqual(["manual:m-checked", "manual:m-logged", "whop:pay_whop_a"]);
  });

  test("manualChecks carries each row's state and check time for the list's chips", async () => {
    const { payload } = await compute([CHECKED, LOGGED, REJECTED]);
    const byId = new Map(payload.manualChecks.map(r => [r.id, r]));
    expect(byId.get("m-checked")).toMatchObject({ state: "checked", ref: "CBK FT0001" });
    expect(byId.get("m-checked")?.at).toBe(new Date(String(CHECKED.checked_at)).toISOString());
    expect(byId.get("m-logged")).toEqual({ id: "m-logged", state: "logged", at: null, ref: null });
    expect(byId.get("m-rejected")?.state).toBe("rejected");
  });

  test("a row from before the check rule (no state) waits as logged and a note says why", async () => {
    const { check_state: _drop, ...noState } = manualRow({ id: "m-old", day: firstOf(lastMonth), amount_usd: 300 });
    const { payload } = await compute([noState as Row]);
    expect(payload.rails.manualLogged.count).toBe(1);
    expect((payload.rails.manual as Row & { lastMonth: number | null }).lastMonth).toBe(0);
    expect(payload.notes.some(n => n.text.includes("no check state") && n.text.includes("20261101n"))).toBe(true);
  });

  test("with nothing logged, manualLogged reads a true zero and no waiting note", async () => {
    const { payload } = await compute([CHECKED]);
    expect(payload.rails.manualLogged).toEqual({ count: 0, usd: 0, oldestDay: null });
    expect(payload.notes.some(n => /wait(s)? on a check/.test(n.text))).toBe(false);
  });
});

describe("the MRR check (payload.mrrCheck)", () => {
  test("tied rail cash over the last two full months, divided by 2, checked manual rows only", async () => {
    const { payload } = await compute([CHECKED, LOGGED, REJECTED, OTHER_CARD_LOGGED]);
    expect(payload.mrrCheck.asOf).toBe(today);
    // Client A: Whop 600 + checked transfer 1000 last month; the logged and rejected rows never count.
    expect(payload.mrrCheck.rows).toEqual([
      expect.objectContaining({ taskId: "task-a", railMonthlyUsd: 800, months: 2, rails: ["manual", "whop"] }),
    ]);
    // Client B has only a logged row: left out, never 0.
    expect(payload.mrrCheck.rows.some(r => r.taskId === "task-b")).toBe(false);
  });

  test("the window is the two months before this one, inclusive at both ends", () => {
    const rows = mrrCheckRows([
      { id: "a", clientTaskId: "task-x", day: firstOf(twoAgo), rail: "tap", usd: 100 },
      { id: "b", clientTaskId: "task-x", day: addDays(firstOf(monthOf(today)), -1), rail: "ecom", usd: 300 },
      { id: "c", clientTaskId: "task-x", day: firstOf(monthOf(today)), rail: "whop", usd: 9000 },
      { id: "d", clientTaskId: "task-x", day: addDays(firstOf(twoAgo), -1), rail: "whop", usd: 9000 },
      { id: "e", clientTaskId: null, day: firstOf(lastMonth), rail: "whop", usd: 50 },
      { id: "f", clientTaskId: "task-y", day: firstOf(lastMonth), rail: "bank", usd: 70 },
    ], today);
    expect(rows).toEqual([expect.objectContaining({ taskId: "task-x", railMonthlyUsd: 200, rails: ["ecom", "tap"] })]);
    expect(rows[0].note).toContain("2 payments tied to this card");
  });
});

describe("growth: a payment not checked confirms no kickoff", () => {
  test("a transfer the store marks not checked is not a rail for the kickoff", () => {
    const form = [{ clickup_task_id: "task-a", client_name: "Client A", day: "2026-10-20", payment: "1500" }];
    const notChecked = readKickoffs(form, [{ payment_id: "transfer:1", clickup_task_id: "task-a", day: "2026-10-21", usd: 1500, rail: "transfer", checked: false }]);
    expect(notChecked.kickoffs[0].confirmed).toBe(0);
    const checked = readKickoffs(form, [{ payment_id: "transfer:1", clickup_task_id: "task-a", day: "2026-10-21", usd: 1500, rail: "transfer", checked: true }]);
    expect(checked.kickoffs[0].confirmed).toBe(1500);
  });
});
