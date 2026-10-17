import { describe, expect, test } from "bun:test";
import { accountStatus, activityRow, adsetRow, budgetChange, campaignRow, created, runStatus } from "./fixtures.ts";
import { type HistoryRow, parseActivities, rebuildBudgetHistory, toHistoryApplyRow } from "./history.ts";
import { readLiveCampaigns } from "./parse.ts";
import type { Row } from "./graph.ts";

// A Riyadh account read on 17 Oct 2026, its 14 days rebuilt (the nightly span).
const SINCE = "2026-10-03";
const UNTIL = "2026-10-16";
const C1 = "120252263714510391"; // CBO 120 SAR now, 100 until 15 Oct 15:14 Riyadh (Pidco's change)
const C2 = "120252508860190391"; // CBO 50, created 11 Oct 17:47 Riyadh
const C3 = "120000000003001"; // CBO 20, paused 16 Oct 13:00 Riyadh
const C4 = "120246911751090088"; // ABO, created 8 Oct 20:28 Riyadh; ad sets 300 -> 55300 -> 95300 and 300 -> 55300 (Khalda's chain)
const S4A = "120246912291140088";
const S4B = "120246912291180088";

const live = () =>
  readLiveCampaigns([
    campaignRow(C1, { daily_budget: "12000", start_time: "2026-09-28T16:22:40+0300" }, [adsetRow("120252263714520391", ["ACTIVE"])]),
    campaignRow(C2, { daily_budget: "5000", start_time: "2026-10-11T17:47:17+0300" }, [adsetRow("120252508860200391", ["ACTIVE"])]),
    campaignRow(C3, { daily_budget: "2000", status: "PAUSED", effective_status: "PAUSED" }, [
      adsetRow("120000000003002", ["CAMPAIGN_PAUSED"], { effective_status: "CAMPAIGN_PAUSED" }),
    ]),
    campaignRow(C4, { start_time: "2026-10-08T20:28:10+0300" }, [
      adsetRow(S4A, ["WITH_ISSUES"], { daily_budget: "95300", lifetime_budget: "0", start_time: "2026-10-08T20:28:31+0300" }),
      adsetRow(S4B, ["WITH_ISSUES"], { daily_budget: "55300", lifetime_budget: "0", start_time: "2026-10-08T20:28:11+0300" }),
    ]),
  ]);

/** Meta's log, newest first, as act_<id>/activities answers it. */
const LOG: Row[] = [
  activityRow("create_audience", "2026-10-16T12:02:06+0000", "CAMPAIGN", "120247025874410088", { type: 4 }),
  activityRow("update_campaign_run_status", "2026-10-16T10:00:00+0000", "CAMPAIGN_GROUP", C3, runStatus(1, 15)),
  activityRow("update_campaign_run_status", "2026-10-15T12:14:50+0000", "CAMPAIGN_GROUP", C1, runStatus(17, 1)),
  activityRow("update_campaign_budget", "2026-10-15T12:14:32+0000", "CAMPAIGN_GROUP", C1, budgetChange(10000, 12000, "SAR")),
  activityRow("update_campaign_run_status", "2026-10-15T12:14:32+0000", "CAMPAIGN_GROUP", C1, runStatus(1, 17)),
  activityRow("update_ad_run_status", "2026-10-12T09:00:00+0000", "ADGROUP", "120000000000999", runStatus(1, 15)),
  activityRow("update_ad_set_run_status", "2026-10-11T14:47:35+0000", "CAMPAIGN", "120252508860200391", runStatus(17, 1)),
  activityRow("create_ad_set", "2026-10-11T14:47:17+0000", "CAMPAIGN", "120252508860200391", created(null)),
  activityRow("create_campaign_group", "2026-10-11T14:47:16+0000", "CAMPAIGN_GROUP", C2, created(5000, "SAR")),
  activityRow("ad_account_update_status", "2026-10-11T11:06:39+0000", "ACCOUNT", "134992869555229", accountStatus("Payment Needed", "Active")),
  activityRow("ad_account_billing_charge", "2026-10-11T11:06:37+0000", "ACCOUNT", "134992869555229", { currency: "SAR", new_value: 87470 }),
  activityRow("update_ad_set_budget", "2026-10-09T02:40:10+0000", "CAMPAIGN", S4A, budgetChange(55300, 95300)),
  activityRow("update_ad_set_budget", "2026-10-08T17:31:55+0000", "CAMPAIGN", S4A, budgetChange(300, 55300)),
  activityRow("update_ad_set_budget", "2026-10-08T17:31:43+0000", "CAMPAIGN", S4B, budgetChange(300, 55300)),
  activityRow("create_ad_set", "2026-10-08T17:28:31+0000", "CAMPAIGN", S4A, created(300)),
  activityRow("create_ad_set", "2026-10-08T17:28:10+0000", "CAMPAIGN", S4B, created(300)),
  activityRow("create_campaign_group", "2026-10-08T17:28:10+0000", "CAMPAIGN_GROUP", C4, created(null)),
  activityRow("ad_account_update_status", "2026-10-08T05:31:37+0000", "ACCOUNT", "134992869555229", accountStatus("Active", "Payment Needed")),
  activityRow("update_campaign_budget", "2026-09-30T08:00:00+0000", "CAMPAIGN_GROUP", C1, budgetChange(9000, 10000, "SAR")),
];

function rebuild(log: Row[] = LOG) {
  const parsed = parseActivities(log);
  return rebuildBudgetHistory({
    live: live(),
    accountStatus: 1,
    events: parsed.events,
    unreadable: parsed.unreadable,
    timezone: "Asia/Riyadh",
    offset: 100,
    since: SINCE,
    until: UNTIL,
  });
}
const row = (rows: HistoryRow[], id: string, day: string) => rows.find(r => r.campaignId === id && r.day === day);

describe("Meta's activity log", () => {
  test("only the events the history uses, newest first, Meta's order kept within a second; a malformed one is counted", () => {
    const { events, unreadable } = parseActivities(LOG);
    expect(events.map(e => e.type)).not.toContain("create_audience");
    expect(events.map(e => e.type)).not.toContain("ad_account_billing_charge");
    expect(events.map(e => e.type)).not.toContain("update_ad_run_status");
    expect(events.length).toBe(16);
    expect(unreadable).toBe(0);
    // Two events in the same second keep Meta's order: the budget, then the status that preceded it.
    const c1 = events.filter(e => e.objectId === C1 && e.timeMs === Date.parse("2026-10-15T12:14:32Z"));
    expect(c1.map(e => e.type)).toEqual(["update_campaign_budget", "update_campaign_run_status"]);
    const bad = parseActivities([
      { event_type: "update_campaign_budget", event_time: "2026-10-15T12:14:32+0000", object_id: C1, object_type: "CAMPAIGN_GROUP", extra_data: "not json" },
      { event_type: "update_ad_set_budget", event_time: "2026-10-15T12:14:32+0000", object_id: C1, object_type: "CAMPAIGN_GROUP", extra_data: "{}" },
      { event_type: "update_campaign_budget", event_time: "yesterday", object_id: C1, object_type: "CAMPAIGN_GROUP", extra_data: "{}" },
    ]);
    expect(bad).toEqual({ events: [], unreadable: 3 });
  });
});

describe("budget history, rebuilt backwards from the live budgets", () => {
  test("a CBO budget change: the old budget before it, both on the day it changed, verified (the chain ends at the live budget)", () => {
    const h = rebuild();
    expect(row(h.rows, C1, "2026-10-16")).toMatchObject({
      budgetType: "daily",
      dailyBudget: 120,
      switchedOn: true,
      whyNot: null,
      changedDuringDay: false,
      verified: true,
    });
    expect(row(h.rows, C1, "2026-10-15")).toMatchObject({ dailyBudget: 120, maxBudget: 120, changedDuringDay: true, verified: true });
    expect(row(h.rows, C1, "2026-10-14")).toMatchObject({ dailyBudget: 100, maxBudget: 100, changedDuringDay: false });
    expect(row(h.rows, C1, SINCE)).toMatchObject({ dailyBudget: 100, verified: true });
    // Every day of the span has its row for a campaign that was on throughout.
    expect(h.rows.filter(r => r.campaignId === C1).length).toBe(14);
    expect(h.broken).toEqual([]);
    expect(h.note).toBeNull();
  });

  test("the account's billing stop: the budget stays switched on (the board shows it unspent), and the log's reason is said", () => {
    const h = rebuild();
    for (const day of ["2026-10-08", "2026-10-09", "2026-10-10"]) {
      expect(row(h.rows, C1, day)).toMatchObject({
        switchedOn: true,
        switchedOnAny: true,
        maxBudget: 100,
        dailyBudget: 100,
        whyNot: "Account unsettled: payment needed",
      });
    }
    expect(row(h.rows, C1, "2026-10-11")).toMatchObject({ switchedOn: true, maxBudget: 100, whyNot: null });
    // Nothing in a row says the campaign delivered: the log does not show the ads.
    expect(Object.keys(row(h.rows, C1, "2026-10-11") as HistoryRow)).not.toContain("delivering");
  });

  test("a campaign made on a day has rows from that day; before it, none", () => {
    const h = rebuild();
    expect(row(h.rows, C2, "2026-10-10")).toBeUndefined();
    expect(row(h.rows, C2, "2026-10-11")).toMatchObject({ dailyBudget: 50, switchedOn: true, maxBudget: 50, changedDuringDay: false, verified: true });
    expect(h.rows.filter(r => r.campaignId === C2).length).toBe(6);
  });

  test("a campaign paused in the afternoon keeps that day's row and the budget it was on with, off at the end", () => {
    const h = rebuild();
    expect(row(h.rows, C3, "2026-10-16")).toMatchObject({ switchedOn: false, switchedOnAny: true, whyNot: "Paused", dailyBudget: 20, maxBudget: 20 });
    expect(row(h.rows, C3, "2026-10-15")).toMatchObject({ switchedOn: true, dailyBudget: 20, maxBudget: 20 });
  });

  test("ABO: the ad sets' budgets summed per day, through Khalda's chain 300 -> 55300 -> 95300", () => {
    const h = rebuild();
    expect(row(h.rows, C4, "2026-10-07")).toBeUndefined();
    // Made in the evening of 8 Oct with $3 ad sets, raised to $553 each the same evening; the account was unsettled.
    expect(row(h.rows, C4, "2026-10-08")).toMatchObject({
      budgetLevel: "adset",
      dailyBudget: 1106,
      changedDuringDay: true,
      switchedOn: true,
      maxBudget: 1106,
      whyNot: "Account unsettled: payment needed",
      verified: true,
    });
    // Raised again at 05:40 the next morning: the day counts its highest budget.
    expect(row(h.rows, C4, "2026-10-09")).toMatchObject({ dailyBudget: 1506, maxBudget: 1506, changedDuringDay: true });
    expect(row(h.rows, C4, "2026-10-11")).toMatchObject({ dailyBudget: 1506, changedDuringDay: false, switchedOn: true, maxBudget: 1506 });
    // Its ads have had issues since 14 Oct: still a budget switched on, which Budget used shows unspent.
    expect(row(h.rows, C4, "2026-10-16")).toMatchObject({ dailyBudget: 1506, maxBudget: 1506, switchedOn: true, verified: true });
  });

  test("one row a day per account: the days, each verified, counted", () => {
    const h = rebuild();
    expect(h.days.map(d => d.day)).toEqual(Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 3).padStart(2, "0")}`));
    expect(h.days.every(d => d.verified && d.note === null)).toBe(true);
    expect(h.days.find(d => d.day === "2026-10-11")?.campaigns).toBe(4);
    expect(h.days.find(d => d.day === "2026-10-07")?.campaigns).toBe(2);
    expect(toHistoryApplyRow(row(h.rows, C1, "2026-10-15") as HistoryRow, "134992869555229")).toEqual({
      campaign_id: C1,
      account_id: "134992869555229",
      day: "2026-10-15",
      budget_level: "campaign",
      budget_type: "daily",
      daily_budget: 120,
      max_budget: 120,
      switched_on: true,
      switched_on_any: true,
      why_not: null,
      changed_during_day: true,
      verified: true,
    });
  });

  test("a chain that does not end at the live budget is unverified up to the break, and said", () => {
    const log = LOG.map(r => (r.event_type === "update_campaign_budget" && r.object_id === C1 && String(r.event_time).startsWith("2026-10-15")
      ? activityRow("update_campaign_budget", "2026-10-12T08:00:00+0000", "CAMPAIGN_GROUP", C1, budgetChange(10000, 11000, "SAR"))
      : r));
    const h = rebuild(log);
    expect(h.broken).toEqual([C1]);
    expect(row(h.rows, C1, "2026-10-13")?.verified).toBe(true);
    expect(row(h.rows, C1, "2026-10-12")?.verified).toBe(false);
    expect(row(h.rows, C1, SINCE)?.verified).toBe(false);
    // The other campaigns stand.
    expect(row(h.rows, C2, "2026-10-12")?.verified).toBe(true);
    const day = h.days.find(d => d.day === "2026-10-12");
    expect(day?.verified).toBe(false);
    expect(day?.note).toContain(`does not lead to the live budget for campaign ${C1}`);
    expect(h.note).toContain("days not verified: the log does not lead to the live budget for 1 campaign");
  });

  test("an ad set Meta no longer lists: ABO days up to it unverified, CBO days stand; a campaign gone since leaves its days unverified", () => {
    const stray = [activityRow("update_ad_set_budget", "2026-10-10T08:00:00+0000", "CAMPAIGN", "120000000009999", budgetChange(1000, 2000)), ...LOG];
    stray.sort((a, b) => Date.parse(String(b.event_time).replace("+0000", "Z")) - Date.parse(String(a.event_time).replace("+0000", "Z")));
    const h = rebuild(stray);
    expect(row(h.rows, C4, "2026-10-10")?.verified).toBe(false);
    expect(row(h.rows, C4, "2026-10-11")?.verified).toBe(true);
    expect(row(h.rows, C1, "2026-10-10")?.verified).toBe(true);
    expect(h.days.find(d => d.day === "2026-10-10")?.note).toContain("An ad set Meta no longer lists");
    // C4 is unverified for the stray ad set, not for its own chain: the note does not name it.
    expect(h.days.find(d => d.day === "2026-10-10")?.note).not.toContain("does not lead to");
    expect(h.broken).toEqual([]);
    const gone = rebuild([activityRow("update_campaign_budget", "2026-10-12T08:00:00+0000", "CAMPAIGN_GROUP", "120000000008888", budgetChange(1, 2)), ...LOG]);
    expect(gone.unlisted).toEqual(["120000000008888"]);
    expect(row(gone.rows, C1, "2026-10-12")?.verified).toBe(true);
    expect(gone.days.find(d => d.day === "2026-10-12")?.verified).toBe(false);
    expect(gone.days.find(d => d.day === "2026-10-13")?.verified).toBe(true);
  });

  test("an event that cannot be read leaves every day unverified", () => {
    const h = rebuild([{ event_type: "update_campaign_budget", event_time: "2026-10-12T08:00:00+0000", object_id: C1, object_type: "CAMPAIGN_GROUP", extra_data: "{oops" }, ...LOG]);
    expect(h.rows.every(r => !r.verified)).toBe(true);
    expect(h.days[0].note).toContain("1 activity events could not be read");
  });

  test("a lifetime budget has no daily figure on any day", () => {
    const parsed = parseActivities([]);
    const h = rebuildBudgetHistory({
      live: readLiveCampaigns([campaignRow("120000000000901", { lifetime_budget: "70000" }, [adsetRow("120000000000902", ["ACTIVE"])])]),
      accountStatus: 1,
      events: parsed.events,
      unreadable: 0,
      timezone: "Asia/Riyadh",
      offset: 100,
      since: "2026-10-15",
      until: UNTIL,
    });
    expect(h.rows.map(r => [r.day, r.budgetType, r.dailyBudget, r.maxBudget])).toEqual([
      ["2026-10-15", "lifetime", null, null],
      ["2026-10-16", "lifetime", null, null],
    ]);
  });
});

describe("the edges of a day and of a change", () => {
  const C = "120000000005001";
  /** One CBO campaign of 30/day on a Riyadh account, its ad set live, rebuilt over 10 to 16 Oct. */
  const history = (log: Row[], over: Row = {}, status: number | null = 1) => {
    const parsed = parseActivities(log);
    return rebuildBudgetHistory({
      live: readLiveCampaigns([campaignRow(C, { daily_budget: "3000", ...over }, [adsetRow("120000000005002", ["ACTIVE"])])]),
      accountStatus: status,
      events: parsed.events,
      unreadable: parsed.unreadable,
      timezone: "Asia/Riyadh",
      offset: 100,
      since: "2026-10-10",
      until: "2026-10-16",
    });
  };

  test("an end at midnight ends the day before (Arcturus' 1 Sep stops), on the account's clock", () => {
    const h = history([], { stop_time: "2026-10-13T00:00:00+0300" });
    expect(row(h.rows, C, "2026-10-12")).toMatchObject({ switchedOn: true, maxBudget: 30 });
    expect(row(h.rows, C, "2026-10-13")).toBeUndefined();
    // An end in the afternoon keeps its day.
    expect(row(history([], { stop_time: "2026-10-13T15:00:00+0300" }).rows, C, "2026-10-13")).toMatchObject({ maxBudget: 30 });
  });

  test("a budget of 0 before a change is unknown: no daily figure, never a $0 budget, and not verified", () => {
    const zero = {
      old_value: { type: "payment_amount", currency: "USD", old_value: 0, additional_type: "status_string", additional_value: "" },
      new_value: { type: "payment_amount", currency: "USD", new_value: 3000, additional_type: "status_string", additional_value: "Per day" },
      type: "composite_data",
    };
    const h = history([activityRow("update_campaign_budget", "2026-10-15T09:00:00+0000", "CAMPAIGN_GROUP", C, zero)]);
    expect(row(h.rows, C, "2026-10-16")).toMatchObject({ budgetType: "daily", dailyBudget: 30, maxBudget: 30, verified: true });
    // The day of the change started at the unknown budget: its highest known budget, not verified.
    expect(row(h.rows, C, "2026-10-15")).toMatchObject({ dailyBudget: 30, maxBudget: 30, verified: false });
    expect(row(h.rows, C, "2026-10-14")).toMatchObject({ budgetType: null, dailyBudget: null, maxBudget: null, verified: false });
    expect(h.broken).toEqual([C]);
    // An old side that is not a daily budget is unknown too.
    const lifetime = { ...zero, old_value: { ...zero.old_value, old_value: 90000, additional_value: "Lifetime" } };
    expect(row(history([activityRow("update_campaign_budget", "2026-10-15T09:00:00+0000", "CAMPAIGN_GROUP", C, lifetime)]).rows, C, "2026-10-14")).toMatchObject({
      dailyBudget: null,
      maxBudget: null,
      verified: false,
    });
  });

  test("the account's own words from the log, Meta's capitals kept", () => {
    const h = history([
      activityRow("ad_account_update_status", "2026-10-14T09:00:00+0000", "ACCOUNT", "1", accountStatus("Pending Risk Review", "Active")),
      activityRow("ad_account_update_status", "2026-10-12T09:00:00+0000", "ACCOUNT", "1", accountStatus("Some New State", "Pending Risk Review")),
    ]);
    expect(row(h.rows, C, "2026-10-13")?.whyNot).toBe("Account under risk review");
    expect(row(h.rows, C, "2026-10-11")?.whyNot).toBe('Meta account status "Some New State"');
    expect(row(h.rows, C, "2026-10-15")?.whyNot).toBeNull();
  });
});
