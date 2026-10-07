// bun test supabase/functions/sales-api/stress_numbers_ceilings.test.ts
//
// Stress round 1, numbers and data integrity: the month's WhatsApp template
// budget (D18, $100 across every source) and the settings that bound it. The
// budget is a ceiling: no send may take the month's spend past it. A test
// that fails here is a finding, kept as a regression test for its fix.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { budgetCheck, budgetOf } from "./sendrules.ts";

describe("the month's template budget is never passed", () => {
  test("every send the check lets through keeps the month's spend at or under the budget", () => {
    for (const guard of [{}, { template_budget_usd_month: 100 }, { template_budget_usd_month: 50, template_rate_usd: 0.0792 }, { template_budget_usd_month: 10, template_rate_usd: 0.03 }]) {
      const { budget, rate } = budgetOf(guard);
      let over: number | null = null;
      for (let n = 0; n < 5000 && over === null; n++) {
        // n templates went this month; the check says whether the next one may go.
        if (budgetCheck(n, guard).refusal === null && (n + 1) * rate > budget + 1e-9) over = n;
      }
      // $100 at $0.0792: 1,262 sent is $99.95, the check lets the 1,263rd go, and the month ends at $100.03.
      expect(over === null ? null : `${over + 1} templates, $${((over + 1) * rate).toFixed(2)} of $${budget}`).toBeNull();
    }
  });

  test("the desk and sales-api stop at the same template (desk waves.py floor(budget / rate))", () => {
    const { budget, rate } = budgetOf({});
    const deskCap = Math.floor(budget / rate + 1e-9); // desk/waves.py template_budget: refuses when n >= cap
    expect(budgetCheck(deskCap, {}).refusal).not.toBeNull();
    expect(budgetCheck(deskCap - 1, {}).refusal).toBeNull();
  });

  test("the month's count can reach the budget at all: PostgREST answers at most 1,000 rows a request (Creative Triage max_rows)", () => {
    // index.ts sendTemplate reads this month's templates in one request (limit=20000, no paging, no count=exact),
    // and the project's API answers at most 1,000 rows (management API: postgrest max_rows = 1000, read 2026-10-03;
    // index.ts svcAll says the same). The count therefore stops at 1,000, which is $79.20 at the default rate:
    // the $100 budget never refuses a send from sales-api (reps, rooms, threads, autosend).
    const MAX_ROWS = 1000;
    const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(src).toContain("budgetCheck(");
    // While the month is read as one capped request, the most it can count must be able to trip the budget.
    const m = /kuwaitMonthStart\(Date\.now\(\)\)\)\}&select=id&limit=(\d+)`/.exec(src);
    if (m) {
      const countable = Math.min(Number(m[1]), MAX_ROWS);
      for (const budget of [100, 500])
        expect({ budget, countable, refusal: budgetCheck(countable, { template_budget_usd_month: budget }).refusal !== null }).toEqual({ budget, countable, refusal: true });
    }
  });

  test("followupAgent.ts reads the month the same way (stress2, round 1): paged or counted, never one capped GET", () => {
    // followup.batch's budget check read the month in one GET with limit=cap
    // (1,262 at the shipped budget): PostgREST answered 1,000, under the cap,
    // so Approve all was never refused once the month's budget was spent.
    const src = readFileSync(new URL("./followupAgent.ts", import.meta.url), "utf8");
    expect(src).toContain("budgetCheck(");
    const reads = src.split("\n").filter(l => /via=eq\.workflow/.test(l) && /created_at=gte/.test(l) && !/contact_id=eq/.test(l));
    expect(reads.length).toBeGreaterThan(0);
    for (const l of reads) expect({ read: l.trim(), paged: /offset=|count=exact/.test(l) }).toEqual({ read: l.trim(), paged: true });
  });

});
