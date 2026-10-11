import { describe, expect, test } from "bun:test";
import { withRuntime, type Row, type Runtime } from "./runtime.ts";
import { createMoneyAdapter } from "./native/adapters/money.js";
import { createExpensesAdapter } from "./native/adapters/expenses.js";

/**
 * R1 (2026-10-11): Aziz's rule for the bank statement is "Show 'days since
 * the last statement' on the tab and warn past 7 days" (A109). A stale
 * statement must warn and still publish: every source stays confirmed (the
 * worker and the publish RPC refuse a section with any unconfirmed source),
 * and the payload carries a warn note. A statement dated after today is a
 * parse error and still fails.
 */
const now = Date.now();
const today = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function snapshot(statementEnds: string): Row {
  const lineDay = addDays(statementEnds, -1);
  return {
    revision: 7, totals_revision: 0, history_ready: true, aliases_ready: true, manual_ready: true,
    updated_at: new Date(now).toISOString(),
    manual: [], aliases: [], payers: [], exclusions: [],
    billing: [
      { clickup_task_id: "task-a", client_name: "Client A", stage: "Active", mrr_usd: 1000, ltv_usd: 9000.5, payment_plan: "Monthly", captured_at: new Date(now).toISOString() },
      { clickup_task_id: "task-b", client_name: "Client B", stage: "Onboarding", mrr_usd: null, ltv_usd: null, payment_plan: null, captured_at: new Date(now).toISOString() },
    ],
    series: [
      { day: `${addDays(today, -40).slice(0, 7)}-01`, metric: "money.book.projected", scope: "company", value: 2000 },
      { day: `${addDays(today, -40).slice(0, 7)}-01`, metric: "money.book.collected", scope: "company", value: 1500 },
    ],
    statements: [{ id: "st-1", account: "XXXX4348", account_kind: "account", from_day: addDays(statementEnds, -30), to_day: statementEnds, lines: 2, imported_at: new Date(now - 86_400_000).toISOString() }],
    bank_lines: [
      { id: 1, statement_id: "st-1", day: lineDay, usd: 326, amount: 100, currency: "KWD", reference: "Client A", account: "XXXX4348", kind: "client_payment" },
      { id: 2, statement_id: "st-1", day: lineDay, usd: -32.6, amount: -10, currency: "KWD", reference: "Software vendor", account: "XXXX4348", kind: "expense", category: "software" },
    ],
  };
}

function reader(overrides: Record<string, Row[]> = {}) {
  const fixtures: Record<string, Row[]> = {
    "money.cash": [{ day: today, cash: 100 }],
    "money.summary": [{ whop_synced_ms: now, whop_last_paid_ms: now, deals_synced_ms: now, failed_count_30: 0, failed_amount_30: 0, refunds_mtd: 0, refunds_90: 0, avg_contract_90: 500, first_deal_day: today }],
    "money.monthly": [{ month: today.slice(0, 7), cash: 100, refunds: 0, deals: 1, contracted: 500 }],
    "money.recent_deals": [],
    "money.targets": [],
    "money.attribution.whop": [],
    "money.attribution.transfers": [],
    "money.attribution.deals": [],
    "money.attribution.logins": [],
    "money.attribution.expenses": [],
    "money.tap_state": [{ ok: true, note: null, rows_seen: 0, run_ms: now, ok_ms: now }],
    "money.tap_charges": [],
    "money.media_feed": [{ ready: true, source_rows: 2, actual_rows: 2, snapshot_ms: now - 600_000, first_day: "2026-08-13", last_day: today }],
    "money.client_ads": [
      { client_id: "c-1", day: today, spend_usd: 40, leads: 2, campaigns: ["Camp A"], currency: "USD", source: "media", own: false },
      { client_id: "own-1", day: today, spend_usd: 25, leads: 1, campaigns: ["Mahara own"], currency: "USD", source: "media", own: true },
    ],
    "expenses.revenue": [{ revenue: 100, synced_ms: now }],
    "expenses.client_ads": [{ spend: 40, clients: 1, own_spend: 0, own_clients: 0, unknown_days: 0, frozen_days: 0 }],
    "expenses.media_feed": [{ ready: true, source_rows: 2, actual_rows: 2, snapshot_ms: now - 600_000, first_day: "2026-08-13", last_day: today }],
    "expenses.eods": [{ people: 3 }],
    ...overrides,
  };
  return async (_project: string, query: string): Promise<Row[]> => {
    const marker = /\/\*\s*ceo-refresh:([a-z0-9._-]+)\s*\*\//i.exec(query)?.[1];
    if (!marker || !(marker in fixtures)) throw new Error(`No fixture for ${marker ?? query.slice(0, 80)}`);
    return fixtures[marker];
  };
}

function runtimeWith(read: Runtime["read"]): Runtime {
  return { env: () => undefined, read, repository: {} as Runtime["repository"], tools: {} as Runtime["tools"] };
}

async function computeBoth(statementEnds: string, overrides: Record<string, Row[]> = {}) {
  const snap = snapshot(statementEnds);
  return withRuntime(runtimeWith(reader(overrides)), async () => {
    const money = await createMoneyAdapter(snap).compute({ repository: {} as Runtime["repository"] });
    const expenses = await createExpensesAdapter(snap).compute({ repository: {} as Runtime["repository"] });
    return { money, expenses };
  });
}

describe("A stale bank statement warns and still publishes (R1)", () => {
  test("a 20-day-old statement computes Money and Expenses with every source confirmed and a warning", async () => {
    const { money, expenses } = await computeBoth(addDays(today, -20));
    for (const result of [money, expenses]) {
      expect(result.sources.length).toBeGreaterThan(0);
      for (const source of result.sources) expect(source.ok).toBe(true);
    }
    const m = money.payload as Row & { bank: Row; notes: { level: string; text: string }[] };
    expect(m.bank.daysSince).toBe(20);
    expect(m.bank.stale).toBe(true);
    expect(m.notes.some(n => n.level === "warn" && n.text.includes("20 days ago (past 7 days)"))).toBe(true);
    const bankSource = money.sources.find(s => s.name === "Bank statements and classification");
    expect(bankSource?.note).toContain("past 7 days");
    // The bank knows nothing after the statement's last day: those windows
    // are n/a, never $0, and the series stops at that day.
    const bank = (m as Row & { rails: { bank: Row & { daily: { date: string }[] } } }).rails.bank;
    expect(bank.coveredTo).toBe(addDays(today, -20));
    expect(bank.today).toBeNull();
    expect(bank.yesterday).toBeNull();
    expect(bank.daily.at(-1)?.date).toBe(addDays(today, -20));
    if (addDays(today, -20) < `${today.slice(0, 7)}-01`) {
      expect(bank.mtd).toBeNull();
      expect(bank.projectedMonth).toBeNull();
    }
    // Mahara's own account is not client ad spend.
    const adSource = money.sources.find(s => s.name === "Client ad spend (media daily statistics)");
    expect(adSource?.note).toContain("1 client ad accounts, $40.00");
    expect(adSource?.note).toContain("Mahara's own accounts, $25.00, left out");
    const e = expenses.payload as Row & { notes: { level: string; text: string }[]; clientAdSpend: Row };
    expect(e.notes[0].level).toBe("warn");
    expect(e.notes[0].text).toContain("20 days ago (past 7 days)");
    expect(e.clientAdSpend.amount).toBe(40);
  });

  test("a fresh statement adds no stale warning", async () => {
    const { money, expenses } = await computeBoth(addDays(today, -2));
    const m = money.payload as Row & { bank: Row; notes: { level: string; text: string }[]; rails: { bank: Row } };
    expect(m.bank.stale).toBe(false);
    // Even a fresh statement says nothing about the days after it ends.
    expect(m.rails.bank.yesterday).toBeNull();
    expect(m.rails.bank.today).toBeNull();
    expect((m.rails.bank.daily as { date: string }[]).at(-1)?.date).toBe(addDays(today, -2));
    expect(m.notes.some(n => n.text.includes("past 7 days"))).toBe(false);
    const e = expenses.payload as Row & { notes: { level: string; text: string }[] };
    expect(e.notes.some(n => n.text.includes("past 7 days"))).toBe(false);
  });

  test("a statement dated after today still fails both sections", async () => {
    const snap = snapshot(addDays(today, 3));
    await withRuntime(runtimeWith(reader()), async () => {
      await expect(createMoneyAdapter(snap).compute({ repository: {} as Runtime["repository"] })).rejects.toThrow("after today");
      await expect(createExpensesAdapter(snap).compute({ repository: {} as Runtime["repository"] })).rejects.toThrow("after today");
    });
  });
});

describe("Client ad spend reads the live media table (R2)", () => {
  test("a media feed mid-rewrite fails the source rather than reading as zero", async () => {
    const midRewrite = [{ ready: true, source_rows: 1101, actual_rows: 300, snapshot_ms: now, first_day: "2026-08-13", last_day: today }];
    await expect(computeBoth(addDays(today, -2), { "money.media_feed": midRewrite })).rejects.toThrow("rewrite in flight");
  });

  test("a media feed older than three hours fails the source", async () => {
    const stale = [{ ready: true, source_rows: 2, actual_rows: 2, snapshot_ms: now - 4 * 3600_000, first_day: "2026-08-13", last_day: today }];
    await expect(computeBoth(addDays(today, -2), { "expenses.media_feed": stale })).rejects.toThrow("4 hours ago");
  });
});

describe("Money keeps the LTV baseline and the book history (R4, A124)", () => {
  test("every card with an LTV field gets a money.ltv.card point; the book history comes from the kept series", async () => {
    const { money } = await computeBoth(addDays(today, -2));
    const ltv = (money.daily ?? []).filter(p => p.metric === "money.ltv.card");
    expect(ltv).toEqual([{ date: today, metric: "money.ltv.card", scope: "client:task-a", value: 9000.5 }]);
    const book = (money.payload as Row & { book: { history: Row[] } }).book;
    expect(book.history).toEqual([{ month: addDays(today, -40).slice(0, 7), projected: 2000, collected: 1500, rate: 0.75 }]);
    expect((money.payload as Row & { attribution: Row }).attribution.kickoffRead).toBe(true);
  });
});

describe("The worker's dry run accepts a stale statement end to end", () => {
  test("money and expenses both compute through runRefresh, with the money.ltv.card points registered", async () => {
    const { runRefresh } = await import("./worker.ts");
    const read = reader();
    const snap = snapshot(addDays(today, -20));
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.hostname === "api.supabase.com") {
        const body = JSON.parse(String(init.body ?? "{}"));
        const project = /projects\/([^/]+)\//.exec(url.pathname)?.[1] ?? "";
        return Response.json(await read(project, String(body.query)));
      }
      if (url.pathname.endsWith("/rpc/cockpit_ceo_refresh_finance_source_snapshot")) return Response.json(snap);
      throw new Error(`Unexpected request ${url.hostname}${url.pathname}`);
    }) as typeof fetch;
    const report = await runRefresh({
      apply: false, only: ["money", "expenses"], fetcher,
      env: { SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co", SUPABASE_ACCESS_TOKEN: "test", SUPABASE_SERVICE_ROLE_KEY: "test" },
    });
    expect(report.error).toBeUndefined();
    expect(report.status).toBe("dry-run");
    expect(report.ok).toBe(true);
    expect(report.sections.map(s => s.status)).toEqual(["computed", "computed"]);
  });
});
