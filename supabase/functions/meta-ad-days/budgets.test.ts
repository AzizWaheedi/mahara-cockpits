import { describe, expect, test } from "bun:test";
import { adsetRow, campaignRow } from "./fixtures.ts";
import {
  accountWhyNot,
  accountWords,
  type AccountSnapshot,
  BUDGET_FIELDS,
  type BudgetRow,
  CAMPAIGN_STATUSES,
  currencyOffset,
  CURRENCY_OFFSETS,
  minorUnits,
  noOffsetSentence,
  ParseError,
  parseBudgets,
  toBudgetApplyRow,
} from "./parse.ts";

/** 17 Oct 2026 10:00 Riyadh. */
const NOW = Date.parse("2026-10-17T10:00:00+03:00");
const ACTIVE: AccountSnapshot = { status: 1, disableReason: 0, spendCap: null, amountSpent: 611277 };

function rows(campaigns: ReturnType<typeof campaignRow>[], account: AccountSnapshot = ACTIVE, offset = 100): BudgetRow[] {
  return parseBudgets(campaigns, { account, offset, nowMs: NOW }).rows;
}
const campaign = (out: BudgetRow[], id: string) => out.find(r => r.level === "campaign" && r.objectId === id) as BudgetRow;
const adset = (out: BudgetRow[], id: string) => out.find(r => r.level === "adset" && r.objectId === id) as BudgetRow;

function caught(fn: () => unknown): ParseError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
  throw new Error("expected a ParseError");
}

describe("currency offsets", () => {
  test("Meta's table: 100 for the currencies stored, 1 for the ones without minor units, nothing assumed", () => {
    for (const c of ["USD", "SAR", "QAR", "AED", "BHD", "EGP", "JOD", "EUR", "VES"]) expect({ c, o: currencyOffset(c) }).toEqual({ c, o: 100 });
    for (const c of ["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]) expect({ c, o: currencyOffset(c) }).toEqual({ c, o: 1 });
    // KWD, OMR, LKR and MAD are not in Meta's table (read 2026-10-17): refused, never 100.
    for (const c of ["KWD", "OMR", "LKR", "MAD", "XYZ", "", null, undefined, "toString"]) expect(currencyOffset(c as string)).toBeNull();
    expect(Object.values(CURRENCY_OFFSETS).every(o => o === 1 || o === 100)).toBe(true);
    expect(noOffsetSentence("1111111111111", "KWD")).toContain("act_1111111111111 is in KWD");
    expect(noOffsetSentence("1111111111111", null)).toContain("no currency");
  });

  test("minor units: digits only; \"0\" is no budget; a remaining 0 is a real 0", () => {
    expect(minorUnits("12000", "x")).toBe(12000);
    expect(minorUnits("0", "x")).toBeNull();
    expect(minorUnits("0", "x", false)).toBe(0);
    expect(minorUnits(undefined, "x")).toBeNull();
    expect(minorUnits("", "x")).toBeNull();
    for (const bad of ["12.5", "-1", "abc", "1e9"]) expect(() => minorUnits(bad, "x")).toThrow(ParseError);
  });

  test("an offset of 1 is the amount as Meta wrote it; 100 divides", () => {
    const c = [campaignRow("120000000000501", { daily_budget: "5000" }, [adsetRow("120000000000502", ["ACTIVE"])])];
    expect(campaign(rows(c, ACTIVE, 1), "120000000000501").dailyBudget).toBe(5000);
    expect(campaign(rows(c, ACTIVE, 100), "120000000000501").dailyBudget).toBe(50);
  });
});

describe("the budgets read", () => {
  test("one read, nested to the ads' statuses, archived and deleted left out", () => {
    expect(BUDGET_FIELDS).toContain("daily_budget");
    expect(BUDGET_FIELDS).toContain("adsets.limit(200){");
    expect(BUDGET_FIELDS).toContain("ads.limit(200){effective_status}");
    expect(BUDGET_FIELDS).toContain("issues_info");
    expect(CAMPAIGN_STATUSES).toEqual(["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES"]);
  });

  test("CBO: the campaign's budget; its ad set holds none", () => {
    const out = rows([
      campaignRow("120000000000501", { daily_budget: "3000", budget_remaining: "1166" }, [adsetRow("120000000000502", ["ACTIVE", "PAUSED"])]),
    ]);
    expect(campaign(out, "120000000000501")).toMatchObject({
      budgetLevel: "campaign",
      budgetType: "daily",
      dailyBudget: 30,
      lifetimeBudget: null,
      budgetRemaining: 11.66,
      adsActive: 1,
      adsWithIssues: 0,
      switchedOn: true,
      delivering: true,
      whyNot: null,
    });
    expect(adset(out, "120000000000502")).toMatchObject({ budgetLevel: "campaign", budgetType: null, dailyBudget: null, budgetRemaining: null, delivering: true });
  });

  test("ABO: the ad sets switched on, delivering or not, never a paused one", () => {
    const out = rows([
      campaignRow("120000000000701", {}, [
        adsetRow("120000000000702", ["ACTIVE"], { daily_budget: "10000", lifetime_budget: "0", budget_remaining: "4000" }),
        adsetRow("120000000000703", ["DISAPPROVED"], { daily_budget: "5000", lifetime_budget: "0", budget_remaining: "5000" }),
        adsetRow("120000000000704", ["ACTIVE"], { status: "PAUSED", effective_status: "PAUSED", daily_budget: "90000", lifetime_budget: "0" }),
      ]),
    ]);
    // The ad set blocked by its ads is set to spend too: its budget counts, and Budget used shows it unspent.
    expect(campaign(out, "120000000000701")).toMatchObject({
      budgetLevel: "adset",
      budgetType: "daily",
      dailyBudget: 150,
      budgetRemaining: 90,
      switchedOn: true,
      delivering: true,
      adsWithIssues: 1,
    });
    expect(adset(out, "120000000000703")).toMatchObject({ dailyBudget: 50, delivering: false, whyNot: "Ads with issues", switchedOn: true });
    expect(adset(out, "120000000000704")).toMatchObject({ dailyBudget: 900, delivering: false, whyNot: "Paused", switchedOn: false });
  });

  test("ABO with every ad blocked (Khalda, 17 Oct): the budget it is set to, and why it does not spend", () => {
    const out = rows([
      campaignRow("120246911751090088", { budget_remaining: "110400" }, [
        adsetRow("120246911853470088", ["WITH_ISSUES"], { daily_budget: "55200", lifetime_budget: "0" }),
        adsetRow("120246911751070088", ["WITH_ISSUES"], { daily_budget: "55200", lifetime_budget: "0" }),
      ]),
    ]);
    expect(campaign(out, "120246911751090088")).toMatchObject({
      budgetLevel: "adset",
      dailyBudget: 1104,
      switchedOn: true,
      delivering: false,
      whyNot: "Ads with issues",
      adsActive: 0,
      adsWithIssues: 2,
    });
  });

  test("a paused campaign keeps its budget, switched off; its ad sets say the campaign is paused", () => {
    const out = rows([
      campaignRow("120000000000801", { status: "PAUSED", effective_status: "PAUSED", daily_budget: "2500" }, [
        adsetRow("120000000000802", ["CAMPAIGN_PAUSED"], { effective_status: "CAMPAIGN_PAUSED" }),
      ]),
      campaignRow("120247012327240088", { status: "PAUSED", effective_status: "PAUSED" }, [
        adsetRow("120247012327260088", ["CAMPAIGN_PAUSED"], { effective_status: "CAMPAIGN_PAUSED", daily_budget: "922000", lifetime_budget: "0" }),
      ]),
    ]);
    expect(campaign(out, "120000000000801")).toMatchObject({ dailyBudget: 25, switchedOn: false, delivering: false, whyNot: "Paused" });
    expect(adset(out, "120000000000802")).toMatchObject({ delivering: false, whyNot: "Campaign paused" });
    // A paused ABO campaign shows the budget its ad sets are set to, like a paused CBO one.
    expect(campaign(out, "120247012327240088")).toMatchObject({ budgetLevel: "adset", dailyBudget: 9220, switchedOn: false, whyNot: "Paused" });
  });

  test("lifetime budgets stay lifetime: no daily figure, on the campaign or summed from the ad sets", () => {
    const out = rows([
      campaignRow("120000000000901", { lifetime_budget: "70000", stop_time: "2026-10-30T00:00:00+0300" }, [adsetRow("120000000000902", ["ACTIVE"])]),
      campaignRow("120000000000911", {}, [
        adsetRow("120000000000912", ["ACTIVE"], { daily_budget: "0", lifetime_budget: "50000", end_time: "2026-10-25T00:00:00+0300" }),
      ]),
    ]);
    expect(campaign(out, "120000000000901")).toMatchObject({ budgetLevel: "campaign", budgetType: "lifetime", dailyBudget: null, lifetimeBudget: 700, delivering: true });
    expect(campaign(out, "120000000000911")).toMatchObject({ budgetLevel: "adset", budgetType: "lifetime", dailyBudget: null, lifetimeBudget: 500, delivering: true });
    expect(adset(out, "120000000000912")).toMatchObject({ budgetType: "lifetime", dailyBudget: null, lifetimeBudget: 500 });
  });

  test("\"0\" is no budget: a campaign with daily_budget \"0\" is ABO, and an ended one (Shades' 2023 campaigns) is switched off", () => {
    const out = rows([
      campaignRow("23853806199530702", { daily_budget: "0", stop_time: "2023-08-10T15:33:27+0300" }, [
        adsetRow("23853806199560702", ["ACTIVE"], { daily_budget: "0", lifetime_budget: "200000", end_time: "2023-08-10T15:33:27+0300" }),
      ]),
    ]);
    expect(campaign(out, "23853806199530702")).toMatchObject({
      budgetLevel: "adset",
      budgetType: null,
      dailyBudget: null,
      lifetimeBudget: null,
      switchedOn: false,
      delivering: false,
      whyNot: "Ended",
    });
  });

  test("the account decides first: unsettled, disabled, a reached spending limit", () => {
    const c = [campaignRow("120000000000501", { daily_budget: "3000" }, [adsetRow("120000000000502", ["ACTIVE"])])];
    expect(campaign(rows(c, { ...ACTIVE, status: 3 }), "120000000000501")).toMatchObject({
      delivering: false,
      switchedOn: true,
      dailyBudget: 30,
      whyNot: "Account unsettled: payment needed",
    });
    expect(adset(rows(c, { ...ACTIVE, status: 3 }), "120000000000502").whyNot).toBe("Account unsettled: payment needed");
    // Grace period still delivers.
    expect(campaign(rows(c, { ...ACTIVE, status: 9 }), "120000000000501").delivering).toBe(true);
    // Ardon: a 3,000 SAR limit; spent 2,851.66 delivers, 3,000 does not.
    expect(campaign(rows(c, { ...ACTIVE, spendCap: 300000, amountSpent: 285166 }), "120000000000501").delivering).toBe(true);
    expect(campaign(rows(c, { ...ACTIVE, spendCap: 300000, amountSpent: 300000 }), "120000000000501").whyNot).toBe("Spending limit reached");
    // Meta's statuses in the cockpit's words; Meta's capitals kept, one colon at most.
    expect([1, 2, 3, 7, 8, 9, 100, 101, 201, 4, null].map(accountWords)).toEqual([
      null,
      "Account disabled",
      "Account unsettled: payment needed",
      "Account under risk review",
      "Payment being settled",
      "In grace period: payment due",
      "Account closing",
      "Account closed",
      "Account disabled",
      "Meta account status 4",
      "Account status not known",
    ]);
    expect(accountWhyNot(9)).toBeNull();
    expect(accountWhyNot(101)).toBe("Account closed");
  });

  test("a prepaid account whose funds are used up says to add funds, never that a limit was reached", () => {
    const c = [campaignRow("120248695393070532", {}, [adsetRow("120248695460420532", ["ACTIVE"], { daily_budget: "3000", lifetime_budget: "0" })])];
    // mergestudio.kw, 17 Oct: funds added 351.77, spent 340.96: $10.81 left, still delivering.
    expect(campaign(rows(c, { ...ACTIVE, spendCap: 35177, amountSpent: 34096, prepay: true }), "120248695393070532").delivering).toBe(true);
    expect(campaign(rows(c, { ...ACTIVE, spendCap: 35177, amountSpent: 35177, prepay: true }), "120248695393070532")).toMatchObject({
      switchedOn: true,
      delivering: false,
      dailyBudget: 30,
      whyNot: "Prepaid balance used up: add funds",
    });
    // Not known whether it is prepaid: the limit's words.
    expect(campaign(rows(c, { ...ACTIVE, spendCap: 35177, amountSpent: 35177 }), "120248695393070532").whyNot).toBe("Spending limit reached");
  });

  test("what is left today on an ABO campaign is its counted ad sets' own, not Meta's campaign-level figure", () => {
    const out = rows([
      // Safad, 17 Oct: the campaign says "0", its only ad set "62000".
      campaignRow("120254791600340066", { budget_remaining: "0" }, [
        adsetRow("120254791600350066", ["ACTIVE"], { daily_budget: "62000", lifetime_budget: "0", budget_remaining: "62000" }),
      ]),
      // Khalda, 17 Oct: the campaign says "110400", its two ad sets "0".
      campaignRow("120246911751090088", { budget_remaining: "110400" }, [
        adsetRow("120246911853470088", ["WITH_ISSUES"], { daily_budget: "55200", lifetime_budget: "0", budget_remaining: "0" }),
        adsetRow("120246911751070088", ["WITH_ISSUES"], { daily_budget: "55200", lifetime_budget: "0", budget_remaining: "0" }),
      ]),
      // Shades, 17 Oct: a lifetime ABO, the campaign "0", the ad set "14775".
      campaignRow("120227354657630703", { budget_remaining: "0" }, [
        adsetRow("120227354657640703", ["ACTIVE"], { daily_budget: "0", lifetime_budget: "50000", budget_remaining: "14775", end_time: "2026-10-30T00:00:00+0300" }),
      ]),
      // An ABO campaign whose ad sets hold no budget at all: nothing left to say.
      campaignRow("120000000001501", { budget_remaining: "500" }, [adsetRow("120000000001502", ["ACTIVE"], { budget_remaining: "500" })]),
    ]);
    expect(campaign(out, "120254791600340066")).toMatchObject({ budgetType: "daily", dailyBudget: 620, budgetRemaining: 620 });
    expect(campaign(out, "120246911751090088")).toMatchObject({ dailyBudget: 1104, budgetRemaining: 0 });
    expect(campaign(out, "120227354657630703")).toMatchObject({ budgetType: "lifetime", lifetimeBudget: 500, budgetRemaining: 147.75 });
    expect(campaign(out, "120000000001501")).toMatchObject({ budgetType: null, budgetRemaining: null });
  });

  test("why not, in plain words: ads not approved yet, not started, no ads, ad sets paused, campaign issues", () => {
    const out = rows([
      // Shades, 17 Oct: the ad is in review.
      campaignRow("120250793408940703", { daily_budget: "12000" }, [adsetRow("120250793408930703", ["PENDING_REVIEW"])]),
      campaignRow("120000000001001", { daily_budget: "3000", start_time: "2026-10-20T09:00:00+0300" }, [adsetRow("120000000001002", ["ACTIVE"])]),
      campaignRow("120000000001101", { daily_budget: "3000" }, [adsetRow("120000000001102", [])]),
      campaignRow("120000000001201", {}, [adsetRow("120000000001202", ["ACTIVE"], { status: "PAUSED", effective_status: "PAUSED", daily_budget: "1000" })]),
      campaignRow("120000000001301", {
        daily_budget: "3000",
        effective_status: "WITH_ISSUES",
        issues_info: [{ level: "CAMPAIGN", error_code: 1815694, error_summary: "Your ad was rejected", error_message: "x", error_type: "HARD_ERROR" }],
      }, [adsetRow("120000000001302", ["ACTIVE"])]),
      campaignRow("120000000001401", { daily_budget: "3000" }, []),
    ]);
    expect(campaign(out, "120250793408940703")).toMatchObject({ whyNot: "Ads not approved yet", switchedOn: true, dailyBudget: 120 });
    // Not started: not switched on yet, the day as the cockpit writes one, and when.
    expect(campaign(out, "120000000001001")).toMatchObject({
      whyNot: "Starts 20 Oct",
      switchedOn: false,
      startsAt: "2026-10-20T06:00:00.000Z",
    });
    expect(campaign(out, "120000000001101")).toMatchObject({ whyNot: "No ads", switchedOn: true });
    // Every ad set paused: nothing is set to spend, so it is not switched on.
    expect(campaign(out, "120000000001201")).toMatchObject({ whyNot: "Ad sets paused", switchedOn: false, dailyBudget: null, budgetType: null });
    expect(campaign(out, "120000000001301")).toMatchObject({
      whyNot: "Campaign has issues: Your ad was rejected",
      issues: [{ level: "CAMPAIGN", code: 1815694, summary: "Your ad was rejected" }],
    });
    expect(campaign(out, "120000000001401")).toMatchObject({ whyNot: "No ad sets", switchedOn: false });
    // Every row not delivering says why; every delivering row is switched on.
    for (const r of out) {
      if (!r.delivering) expect(r.whyNot).toBeTruthy();
      else expect(r.switchedOn).toBe(true);
    }
  });

  test("refused, never cut short: a nested block with another page, a campaign listed twice, a budget that is not minor units", () => {
    const paged = campaignRow("120000000000501", { daily_budget: "3000" }, []);
    (paged.adsets as Record<string, unknown>).paging = { cursors: { after: "x" }, next: "https://graph.facebook.com/v25.0/next" };
    expect(caught(() => rows([paged])).message).toContain("more than 200");
    const ads = campaignRow("120000000000501", { daily_budget: "3000" }, [adsetRow("120000000000502", ["ACTIVE"])]);
    const set = ((ads.adsets as { data: Record<string, unknown>[] }).data[0].ads as Record<string, unknown>);
    set.paging = { cursors: { after: "x" }, next: "https://graph.facebook.com/v25.0/next" };
    expect(caught(() => rows([ads])).message).toContain("more than 200");
    expect(caught(() => rows([campaignRow("120000000000501"), campaignRow("120000000000501")])).message).toContain("twice");
    expect(caught(() => rows([campaignRow("120000000000501", { daily_budget: "30.00" })])).message).toContain("minor units");
    expect(caught(() => rows([campaignRow("120000000000501", { status: "active!" })])).message).toContain("statuses");
  });

  test("the apply row carries the table's names and the account", () => {
    const out = rows([campaignRow("120000000000501", { daily_budget: "3000" }, [adsetRow("120000000000502", ["ACTIVE"])])]);
    expect(toBudgetApplyRow(out[0], "1111111111111")).toEqual({
      level: "campaign",
      object_id: "120000000000501",
      account_id: "1111111111111",
      campaign_id: "120000000000501",
      name: "Campaign 501",
      objective: "OUTCOME_LEADS",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      budget_level: "campaign",
      budget_type: "daily",
      daily_budget: 30,
      lifetime_budget: null,
      budget_remaining: null,
      start_time: "2026-10-01T07:00:00.000Z",
      end_time: null,
      ads_active: 1,
      ads_with_issues: 0,
      issues: null,
      switched_on: true,
      starts_at: null,
      delivering: true,
      why_not: null,
    });
  });

  test("a running campaign whose every ad set switched on starts later waits for them", () => {
    const out = rows([
      campaignRow("120000000001601", { daily_budget: "3000" }, [
        adsetRow("120000000001602", ["ACTIVE"], { start_time: "2026-10-21T09:00:00+0300" }),
        adsetRow("120000000001603", ["ACTIVE"], { start_time: "2026-10-19T09:00:00+0300" }),
        adsetRow("120000000001604", ["ACTIVE"], { status: "PAUSED", effective_status: "PAUSED" }),
      ]),
    ]);
    expect(campaign(out, "120000000001601")).toMatchObject({
      switchedOn: false,
      delivering: false,
      startsAt: "2026-10-19T06:00:00.000Z",
      whyNot: "Starts 19 Oct",
      dailyBudget: 30,
    });
    expect(adset(out, "120000000001603")).toMatchObject({ switchedOn: false, startsAt: "2026-10-19T06:00:00.000Z", whyNot: "Starts 19 Oct" });
    expect(adset(out, "120000000001604").startsAt).toBeNull();
  });
});
