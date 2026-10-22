import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  budgetCurrency,
  budgetToUsd,
  campaignBudgets,
  HUNDREDTHS,
  USD_PER,
  unconvertedBudgetNote,
} from "./currency";

// 2026-10-21: the native media worker stored Meta's riyal budgets as dollars.
// Ardon (act_718146936708597) and Shades (act_762687672022667) are SAR CBO
// campaigns; Meta's daily_budget "17500" and "12000" are SAR 175 and SAR 120,
// which the media buyer cockpit showed as $175 and $120 a day. The numbers
// below are the live ones of that day.

const ARDON = "718146936708597";
const SHADES = "762687672022667";

const cbo = (daily_budget: string, adsets: object[] = []) => ({
  daily_budget,
  adsets: { data: adsets },
});
const adSet = (id: string, daily_budget?: string, status = "ACTIVE") => ({
  id,
  name: id,
  status,
  effective_status: status,
  daily_budget,
});
const abo = (...adsets: object[]) => ({ adsets: { data: adsets } });

describe("a Meta budget in dollars", () => {
  test("Ardon's SAR 175 a day is $46.66, Shades' SAR 120 is $31.99", () => {
    expect(campaignBudgets(cbo("17500"), "SAR")).toMatchObject({
      level: "campaign",
      daily: 46.66,
      unconverted: false,
    });
    expect(campaignBudgets(cbo("12000"), "SAR").daily).toBe(31.99);
  });

  test("a dollar account reads as it is; QAR and AED convert at their rates", () => {
    expect(campaignBudgets(cbo("3000"), "USD").daily).toBe(30);
    expect(campaignBudgets(cbo("10000"), "QAR").daily).toBe(27.47);
    expect(campaignBudgets(cbo("10000"), "AED").daily).toBe(27.23);
    expect(budgetToUsd("17500", "aed")).toBe(47.65);
  });

  test("a lifetime budget converts the same way", () => {
    const b = campaignBudgets({ lifetime_budget: "300000" }, "SAR");
    expect(b).toMatchObject({ level: "campaign", lifetime: 799.8 });
    expect(b.daily).toBeUndefined();
  });

  test("$30 written to a SAR account (11253) reads back as $30; on USD, 3000", () => {
    expect(budgetToUsd(11253, "SAR")).toBe(30);
    expect(budgetToUsd(3000, "USD")).toBe(30);
  });

  test("ad set budgets: two SAR ad sets of SAR 100 sum to $53.32", () => {
    const b = campaignBudgets(
      abo(adSet("a", "10000"), adSet("b", "10000")),
      "SAR",
    );
    expect(b).toMatchObject({ level: "adset", daily: 53.32 });
    expect(b.lifetime).toBeUndefined();
  });

  test("only the delivering ad sets count, as before", () => {
    const b = campaignBudgets(
      abo(adSet("a", "10000"), adSet("b", "10000", "PAUSED")),
      "SAR",
    );
    expect(b.daily).toBe(26.66);
    const none = campaignBudgets(
      abo(adSet("a", "10000", "PAUSED"), adSet("b", "10000", "PAUSED")),
      "SAR",
    );
    expect(none.daily).toBe(53.32);
  });

  test("the live tree's ad set dailyBudget is in dollars, on CBO and ABO", () => {
    const tree = campaignBudgets(
      abo(adSet("120000000000000001", "10000"), adSet("120000000000000002")),
      "SAR",
    ).adSetDaily;
    expect(tree.get("120000000000000001")).toBe(26.66);
    expect(tree.get("120000000000000002")).toBeUndefined();
    expect(
      campaignBudgets(cbo("17500", [adSet("s1")]), "SAR").adSetDaily.get("s1"),
    ).toBeUndefined();
  });

  test("KWD, JPY or no currency leave the budget blank, never the raw number", () => {
    for (const cur of ["KWD", "JPY", "", undefined]) {
      const b = campaignBudgets(cbo("17500", [adSet("s1", "10000")]), cur);
      expect(b.daily).toBeUndefined();
      expect(b.adSetDaily.get("s1")).toBeUndefined();
      expect(b.unconverted).toBe(true);
      expect(
        campaignBudgets(abo(adSet("a", "10000")), cur).daily,
      ).toBeUndefined();
    }
    // No budget at all is not a conversion problem.
    expect(campaignBudgets(abo(adSet("a")), "JPY").unconverted).toBe(false);
  });

  test("an unconverted account is said once per run, in a plain sentence", () => {
    const first = unconvertedBudgetNote("act_111111111111111", "KWD");
    expect(first).toContain("KWD budgets on ad account 111111111111111");
    expect(first).toContain("left blank, not shown as dollars");
    expect(unconvertedBudgetNote("111111111111111", "KWD")).toBeUndefined();
    expect(unconvertedBudgetNote("222222222222222", undefined)).toBe(
      "Meta's account listing gave no currency for ad account 222222222222222; its budgets are left blank, not shown as dollars. Add the account to the business's ad accounts in Meta so the listing includes it.",
    );
  });
});

describe("which currency an account's budgets are in", () => {
  const meta = new Map([
    [ARDON, "SAR"],
    [SHADES, "SAR"],
  ]);

  test("Meta's account listing beats the sheet's blank-means-USD", () => {
    const cur = budgetCurrency(meta, `act_${ARDON}`, "USD");
    expect(cur).toBe("SAR");
    expect(campaignBudgets(cbo("17500"), cur).daily).toBe(46.66);
    expect(budgetCurrency(meta, SHADES, "USD")).toBe("SAR");
  });

  test("the sheet's currency only when Meta gave none and it is not dollars", () => {
    expect(budgetCurrency(new Map(), `act_${ARDON}`, "sar")).toBe("SAR");
    expect(budgetCurrency(new Map([[ARDON, ""]]), ARDON, "SAR")).toBe("SAR");
    // The calculator reads a blank sheet cell as "USD", so a sheet "USD" is
    // no evidence: SAR 175 must not come back as $175 for an account Meta's
    // listing missed.
    const unlisted = budgetCurrency(new Map(), ARDON, "USD");
    expect(unlisted).toBeUndefined();
    expect(campaignBudgets(cbo("17500"), unlisted)).toMatchObject({
      daily: undefined,
      unconverted: true,
    });
    expect(budgetCurrency(new Map(), ARDON, "")).toBeUndefined();
    expect(budgetCurrency(new Map(), ARDON, undefined)).toBeUndefined();
    // Meta saying USD is evidence.
    expect(budgetCurrency(new Map([[ARDON, "USD"]]), ARDON, "SAR")).toBe("USD");
  });
});

describe("the worker reads budgets through this module", () => {
  const calc = readFileSync(
    new URL("./calculator.ts", import.meta.url),
    "utf8",
  );

  test("no budget is divided by 100 without the account's rate", () => {
    expect(calc).not.toMatch(/Number\(x\) \/ 100/);
    expect(calc).not.toMatch(/Number\(s\.daily_budget\) \/ 100/);
    expect(calc).toContain("currencyByAccount.set(a.account_id");
    // Meta's currency is looked up for the campaign's own account.
    expect(calc).toMatch(
      /const budgetCur = budgetCurrency\(\s*currencyByAccount,\s*c\.metaAccountId,\s*c\.currency,?\s*\);/,
    );
    expect(calc).toContain("campaignBudgets(campRes, budgetCur)");
    expect(calc).toContain("dailyBudget: budget.adSetDaily.get(String(s.id))");
  });

  test("a budget it cannot convert is a warning, never an error that stops the run", () => {
    expect(calc).toMatch(/if \(note\) recordLog\("warn", note\);/);
    expect(calc).not.toMatch(/recordLog\("error", note\)/);
  });

  test("the budget rates are the spend rates (FX in calculator.ts)", () => {
    const block =
      calc.slice(calc.indexOf("const FX")).match(/\{([^}]*)\}/)?.[1] ?? "";
    const fx = Object.fromEntries(
      [...block.matchAll(/([A-Z]{3}):\s*([0-9.]+)/g)].map(m => [
        m[1],
        Number(m[2]),
      ]),
    );
    expect(USD_PER).toEqual(fx);
    expect([...HUNDREDTHS].sort()).toEqual(["AED", "QAR", "SAR", "USD"]);
  });
});
