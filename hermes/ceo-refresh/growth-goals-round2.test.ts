import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dailySql, frontEndMonths, paidOnWindowDeals, readDealLedger, withPaid } from "./native/adapters/growth.js";

/**
 * The Goals sheet, round 2 (2026-11-02), the CEO refresh's growth section:
 * - fix 7: intro to demo by day, so every day and every 4/7/14/30-day row of the sheet has a value and
 *   any run of days sums to b2b_window_metrics' intros_advanced;
 * - fix 11: UF cash % on this month's deals only (the CEO's choice): front-end money paid in a window
 *   on deals signed in that window, per window and per whole ledger month, never per day;
 * - fix 15: front-end ROAS over all Mahara ad spend, lead gen and retargeting (the CEO's 30 Oct rule).
 */
const SQL = dailySql("2026-10-01", "2026-10-31");
const step = (name: string) => SQL.slice(SQL.indexOf(`${name} as (`), SQL.indexOf("\n),", SQL.indexOf(`${name} as (`)));
const SOURCE = readFileSync(new URL("./native/adapters/growth.js", import.meta.url), "utf8");

describe("fix 7: intros advanced by the day of the intro", () => {
  test("the held step counts a shown intro whose contact booked a demo at or after its start, B2B's intro_handoff rule", () => {
    const held = step("held");
    expect(held).toContain(
      "count(*) filter (where call_type = 'intro' and (status = 'showed' or (status in ('confirmed', 'invalid') and start_at <= now())) and exists (\n" +
        "      select 1 from public.calls d2\n" +
        "      where d2.contact_id = c.contact_id and d2.call_type = 'demo' and d2.booked_at >= c.start_at)) as intros_advanced",
    );
    // The same shown rule as intros_shown in the same step, so advanced can never pass shown.
    expect(held).toContain("count(*) filter (where call_type = 'intro' and (status = 'showed' or (status in ('confirmed', 'invalid') and start_at <= now()))) as intros_shown");
    // The windows' own handoff (wb_handoff) uses the same demo test, so days add up to the windows.
    expect(SOURCE).toContain("where d2.contact_id = i.contact_id and d2.call_type = 'demo' and d2.booked_at >= i.start_at");
    // By the intro's Riyadh call day, webinar calls left out, as every held count.
    expect(held).toContain("select (start_at at time zone 'Asia/Riyadh')::date as d,");
    expect(held).toContain("and not (");
  });

  test("each day selects and maps it beside intros shown", () => {
    expect(SQL).toContain("coalesce(held.intros_advanced, 0) as intros_advanced,");
    const daily = SOURCE.slice(SOURCE.indexOf('attempt("The 365-day daily series"'), SOURCE.indexOf('attempt("The rep scorecard"'));
    expect(daily).toContain("introsShown: num(r.intros_shown),");
    expect(daily).toContain("introsAdvanced: num(r.intros_advanced),");
  });
});

/** October 2026's deal ledger in small: the deals the audit names, plus the edge cases. */
const computed = Date.parse("2026-11-02T10:00:00Z");
const section = JSON.stringify({ rows: 8, usd: 0, from: "2025-12-01" });
const row = (payment_id: string, deal_response_id: string, day: string, usd: number, kind = "deposit") =>
  ({ computed_ms: computed, ledger: section, payment_id, deal_response_id, day, usd, rail: "whop", kind, matched_by: "deal_id" });
const ledgerRows = [
  // Madana: signed 2 Oct, its $500 paid the day before the form (the ledger reaches 7 days back).
  row("whop:madana-1", "madana", "2026-10-01", 500),
  row("whop:madana-2", "madana", "2026-10-07", 1500, "remainder"),
  // Al Ola and Ardon: remainders on September deals, front-end cash in October but not October's deals.
  row("tap:alola", "alola", "2026-10-20", 2021.2, "remainder"),
  row("manual:ardon", "ardon", "2026-10-27", 2000, "remainder"),
  // Paid on 30 Oct ahead of a form signed on 3 Nov: November's deal.
  row("whop:early", "nov-deal", "2026-10-30", 400),
  // A payment whose form the closer table no longer holds: no signing day, so no window's deal.
  row("whop:gone", "gone", "2026-10-15", 250),
  // November money on an October deal: never moves October.
  row("whop:madana-3", "madana", "2026-11-01", 1000, "remainder"),
  // September money on a September deal.
  row("whop:ardon-sep", "ardon", "2026-09-20", 500),
];
const deals = [
  { response_id: "madana", day: "2026-10-02", business: "Madana", closer: "Ahmed", deposit: 500, webinar: false, voided: false },
  { response_id: "alola", day: "2026-09-25", business: "Al Ola", closer: "Ahmed", deposit: 500, webinar: false, voided: false },
  { response_id: "ardon", day: "2026-09-18", business: "Ardon", closer: "Ahmed", deposit: 500, webinar: false, voided: false },
  { response_id: "nov-deal", day: "2026-11-03", business: "Next", closer: "Ahmed", deposit: 400, webinar: false, voided: false },
];
const october = { from: "2026-10-01", to: "2026-10-31", spend: 1654.51, raw: { spend_retargeting: 207.75 }, frontEndCash: { deposit: 2250, kickoff: null, total: null, deals: 5, dealsConfirmed: 5, confirmed: 2250, confirmedShare: 1 }, roasCash: null };

describe("fix 11: front-end money paid on the window's own deals", () => {
  test("each ledger row carries its deal's signing day, null when the form is gone", () => {
    const ledger = readDealLedger(ledgerRows, deals);
    const signed = Object.fromEntries(ledger.rows.map((r: { paymentId: string; signedDay: string | null }) => [r.paymentId, r.signedDay]));
    expect(signed["whop:madana-1"]).toBe("2026-10-02");
    expect(signed["tap:alola"]).toBe("2026-09-25");
    expect(signed["whop:gone"]).toBeNull();
  });

  test("paid and signed both inside the window: earlier deals, deals paid ahead of a later form and unknown forms are out", () => {
    const ledger = readDealLedger(ledgerRows, deals);
    // 500 + 1500 on Madana; not Al Ola 2,021.20, Ardon 2,000, the 400 ahead of 3 Nov, the 250 with no form, or 1 Nov's 1,000.
    expect(paidOnWindowDeals(ledger.rows, "2026-10-01", "2026-10-31")).toBe(2000);
    expect(paidOnWindowDeals(ledger.rows, "2026-09-01", "2026-09-30")).toBe(500);
    // A window that holds the signing day but not the payment, or the reverse, counts nothing.
    expect(paidOnWindowDeals(ledger.rows, "2026-10-02", "2026-10-06")).toBe(0);
    expect(paidOnWindowDeals(ledger.rows, "2026-11-01", "2026-11-02")).toBe(0);
  });

  test("withPaid puts it on the window beside the money paid; an unread ledger leaves both null", () => {
    const ledger = readDealLedger(ledgerRows, deals);
    const w = withPaid(october, ledger, deals, []);
    expect(w.frontEndCash.paid).toBe(6671.2);
    expect(w.frontEndCash.paidOnWindowDeals).toBe(2000);
    const old = readDealLedger([{ computed_ms: computed, ledger: null, payment_id: null }], deals);
    const none = withPaid(october, old, deals, []);
    expect(none.frontEndCash.paid).toBeNull();
    expect(none.frontEndCash.paidOnWindowDeals).toBeNull();
  });

  test("each whole ledger month carries the same measure, so months before last month have one too", () => {
    const ledger = readDealLedger(ledgerRows, deals);
    const months = frontEndMonths({ ...ledger, from: "2026-09-01" }, "2026-11-02", "2025-11-03", deals);
    expect(months).toEqual([
      { month: "2026-09", paid: 500, paidOnWindowDeals: 500 },
      { month: "2026-10", paid: 6671.2, paidOnWindowDeals: 2000 },
      // The current month runs to today.
      { month: "2026-11", paid: 1000, paidOnWindowDeals: 0 },
    ]);
    // A ledger that starts mid-month does not hold that month whole: it starts at the next one.
    expect(frontEndMonths({ ...ledger, from: "2026-09-15" }, "2026-11-02", "2025-11-03", deals).map(m => m.month)).toEqual(["2026-10", "2026-11"]);
    // Not read: no month, never a zero month.
    expect(frontEndMonths(readDealLedger([], deals), "2026-11-02", "2025-11-03", deals)).toEqual([]);
    expect(frontEndMonths(null, "2026-11-02", "2025-11-03", deals)).toEqual([]);
  });

  test("a month before the first closer-form deal is missing, not 0 (review, 2026-11-02)", () => {
    // Live: Money's ledger starts 1 Dec 2025, the first closer-form deal is 1 Apr 2026, and Whop took
    // $5,965 to $8,467 a month before it. Those months are left out, never listed as a measured 0.
    const ledger = readDealLedger(ledgerRows, [...deals, { response_id: "first", day: "2026-04-01", business: "First", closer: "Ahmed", deposit: 0, webinar: false, voided: false }]);
    const months = frontEndMonths({ ...ledger, from: "2025-12-01" }, "2026-11-02", "2025-11-03", [{ day: "2026-04-01" }, ...deals]);
    expect(months[0]).toEqual({ month: "2026-04", paid: 0, paidOnWindowDeals: 0 });
    expect(months.map(m => m.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    // A first deal mid-month: that month is listed (the form's money starts there), earlier ones are not.
    expect(frontEndMonths({ ...ledger, from: "2025-12-01" }, "2026-11-02", "2025-11-03", deals.slice(2, 3))[0].month).toBe("2026-09");
    // A voided or webinar deal still shows the form was in use: any deal the read holds counts.
    expect(frontEndMonths({ ...ledger, from: "2025-12-01" }, "2026-11-02", "2025-11-03", [{ day: "2026-08-20", voided: true }])[0].month).toBe("2026-08");
    // No deal read at all: no month can be said to be measured.
    expect(frontEndMonths({ ...ledger, from: "2025-12-01" }, "2026-11-02", "2025-11-03", [])).toEqual([]);
  });

  test("a month growth's own read does not hold whole is left out, not shown short (review, 2026-11-02)", () => {
    // 1 Dec 2026, first cycle: Money's last payload (30 Nov) starts its ledger on 1 Dec 2025, but growth reads
    // payments from today-364 = 2 Dec 2025, so December 2025 would miss its 1st. It starts at January.
    const ledger = readDealLedger(ledgerRows, deals);
    const old = [{ day: "2025-08-01" }];
    expect(frontEndMonths({ ...ledger, from: "2025-12-01" }, "2026-12-01", "2025-12-02", old)[0].month).toBe("2026-01");
    // The read starting on a 1st holds that month whole.
    expect(frontEndMonths({ ...ledger, from: "2025-12-01" }, "2026-11-30", "2025-12-01", old)[0].month).toBe("2025-12");
    // Money's ledger starting later than the read: the ledger's first whole month.
    expect(frontEndMonths({ ...ledger, from: "2026-01-01" }, "2026-12-01", "2025-12-02", old)[0].month).toBe("2026-01");
  });

  test("it is a month measure: the daily rows carry no paid-on-window-deals field, the payload carries the months", () => {
    const daily = SOURCE.slice(SOURCE.indexOf('attempt("The 365-day daily series"'), SOURCE.indexOf('attempt("The rep scorecard"'));
    expect(daily).not.toContain("paidOnWindowDeals");
    // From growth's own read and the deals it holds (2026-11-02 review).
    expect(SOURCE).toContain("frontEndMonths: frontEndMonths(ledger, today, ledgerFrom, ledgerDeals),");
    expect(SOURCE).toContain("const ledgerFrom = addDays(today, -364);");
  });
});

describe("fix 15: front-end ROAS over all Mahara ad spend", () => {
  test("October: $24,377.36 over $1,654.51 lead gen + $207.75 retargeting reads 13.09x, not 14.73x", () => {
    const one = [{ computed_ms: computed, ledger: section, payment_id: "all", deal_response_id: "madana", day: "2026-10-10", usd: 24377.36, rail: "whop", kind: "deposit", matched_by: "deal_id" }];
    const w = withPaid(october, readDealLedger(one, deals), deals, []);
    expect(w.roasCash).toBe(13.09);
    // Lead gen alone would read 14.73x.
    expect(Math.round((24377.36 / 1654.51) * 100) / 100).toBe(14.73);
  });

  test("retargeting not read leaves the ROAS missing, never on lead gen alone", () => {
    const ledger = readDealLedger(ledgerRows, deals);
    expect(withPaid({ ...october, raw: {} }, ledger, deals, []).roasCash).toBeNull();
    expect(withPaid({ ...october, raw: { spend_retargeting: null } }, ledger, deals, []).roasCash).toBeNull();
    // No spend at all: no ROAS.
    expect(withPaid({ ...october, spend: 0, raw: { spend_retargeting: 0 } }, ledger, deals, []).roasCash).toBeNull();
  });
});
