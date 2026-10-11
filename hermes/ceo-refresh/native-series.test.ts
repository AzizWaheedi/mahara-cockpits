import { describe, expect, test } from "bun:test";
import { KICKOFF_READ_FROM, kickoffAmount, kickoffIn, readKickoffs, withKickoff } from "./native/adapters/growth.js";
import { churnRegisterOf, clientDailyOf, extensionJobNote, grantRowsOf } from "./native/adapters/clients.js";
import { eodDaysOf } from "./native/adapters/team.js";
import { hiringSeries } from "./native/adapters/hiring.js";

describe("Kickoff cash joins front-end cash, confirmed on the rails (A087)", () => {
  const forms = [
    { clickup_task_id: "z8xmdvffcd", client_name: "مدانة", day: "2026-10-04", payment: "1500" },
    { clickup_task_id: "z8xmdvfpyw", client_name: "Shades", day: "2026-10-08", payment: "0" },
    { clickup_task_id: "t-blank", client_name: "Blank Co", day: "2026-10-09", payment: null },
    { clickup_task_id: "86eywazcu", client_name: "mergestudio", day: "2026-09-13", payment: null },
    { clickup_task_id: "t-tap", client_name: "Tap Co", day: "2026-10-10", payment: "$2,000" },
  ];
  const payments = [
    // Shades' deposit logged by hand: not a rail, never confirms.
    { payment_id: "manual:1", clickup_task_id: "z8xmdvfpyw", day: "2026-10-06", usd: 5608.8, rail: "manual" },
    // Tap Co paid 1,980 on Tap two days later: within 3 days and 5%.
    { payment_id: "tap:1", clickup_task_id: "t-tap", day: "2026-10-12", usd: 1980, rail: "tap" },
    // A Whop payment for مدانة, but 10 days off: not a confirmation.
    { payment_id: "whop:1", clickup_task_id: "z8xmdvffcd", day: "2026-10-14", usd: 1500, rail: "whop" },
  ];

  test("amounts are read as typed, blanks are missing, never zero", () => {
    expect(kickoffAmount("1500")).toBe(1500);
    expect(kickoffAmount("$2,000.50")).toBe(2000.5);
    expect(kickoffAmount("")).toBeNull();
    expect(kickoffAmount(null)).toBeNull();
    expect(kickoffAmount("about 1500 KWD")).toBeNull();
    const { kickoffs, blank } = readKickoffs(forms, payments);
    expect(kickoffs.map(k => [k.taskId, k.amount, k.confirmed, k.rail])).toEqual([
      ["z8xmdvffcd", 1500, 0, null],
      ["z8xmdvfpyw", 0, 0, null],
      ["t-tap", 2000, 2000, "tap"],
    ]);
    expect(blank).toEqual([{ day: "2026-10-09", client: "Blank Co" }]);
  });

  test("a window before the form was read says not read; a window across it counts from the first day", () => {
    const { kickoffs } = readKickoffs(forms, payments);
    expect(kickoffIn(kickoffs, "2026-09-01", "2026-09-30")).toBeNull();
    expect(kickoffIn(null, "2026-10-01", "2026-10-11")).toBeNull();
    expect(kickoffIn(kickoffs, "2026-10-01", "2026-10-11")).toEqual({ amount: 3500, confirmed: 2000, forms: 3, from: KICKOFF_READ_FROM, partial: true });
    expect(kickoffIn(kickoffs, "2026-10-05", "2026-10-07")).toEqual({ amount: 0, confirmed: 0, forms: 0, from: "2026-10-05", partial: false });
  });

  test("front-end cash is deposit plus kickoff, and front-end ROAS uses that total", () => {
    const { kickoffs } = readKickoffs(forms, payments);
    const base = { from: "2026-10-01", to: "2026-10-11", spend: 1000, frontEndCash: { deposit: 500, kickoff: null, total: 500, deals: 1, dealsConfirmed: 1, confirmed: 500, confirmedShare: 1 }, roasCash: 0.5 };
    const w = withKickoff(base, kickoffs);
    expect(w.frontEndCash.kickoff).toBe(3500);
    expect(w.frontEndCash.total).toBe(4000);
    expect(w.frontEndCash.kickoffConfirmed).toBe(2000);
    expect(w.frontEndCash.kickoffConfirmedShare).toBe(0.571);
    expect(w.roasCash).toBe(4);
    const before = withKickoff({ ...base, from: "2026-09-01", to: "2026-09-30" }, kickoffs);
    expect(before.frontEndCash.kickoff).toBeNull();
    expect(before.frontEndCash.total).toBe(500);
    expect(before.roasCash).toBe(0.5);
  });
});

describe("Churn from the register (A078)", () => {
  test("the client success rule over the register's months and departures", () => {
    const reg = churnRegisterOf(
      [
        { month: "2026-01", active_at_start: 15, new_clients: 5, lost_before_register: 3, note: "sheet" },
        { month: "2026-08", active_at_start: null, new_clients: 10, lost_before_register: 2, note: null },
        { month: "2026-09", active_at_start: 22, new_clients: null, lost_before_register: 1, note: null },
      ],
      [],
      "2026-10-11",
    );
    expect(reg.through).toBe("2026-10");
    expect(reg.departures).toBe(0);
    const sep = reg.months.find(m => m.month === "2026-09")!;
    expect(sep.churned).toBe(1);
    expect(sep.churnPct).toBe(4.5);
    const oct = reg.months.find(m => m.month === "2026-10")!;
    expect(oct.activeAtStart).toBeNull();
    expect(oct.churnPct).toBeNull();
    expect(reg.months.at(-1)?.month).toBe("2026-10");
  });

  test("a logged departure before day 90 is churn, after it is a completed term", () => {
    const reg = churnRegisterOf([{ month: "2026-10", active_at_start: 20, new_clients: 2, lost_before_register: null, note: null }], [
      { left_on: "2026-10-05", launched_on: "2026-08-01" },
      { left_on: "2026-10-06", launched_on: "2026-06-01" },
    ], "2026-10-11");
    const oct = reg.months.find(m => m.month === "2026-10")!;
    expect(oct.churned).toBe(1);
    expect(oct.completed).toBe(1);
    expect(oct.churnPct).toBe(5);
  });
});

describe("The extension field note follows the hourly job (A120, A136)", () => {
  test("dry run, writing, no run yet, and no field", () => {
    const at = Date.parse("2026-10-11T12:47:02Z");
    expect(extensionJobNote({ job: "ceo-extensions-auto", ok: true, error: "Dry run: every card already says what the form says.", at }, true))
      .toBe("Automatic writes are off (dry run): the hourly job at :47 checks the 'Current extension (weeks)' field against the extension form but writes nothing (last run 2026-10-11 15:47 Kuwait: Dry run: every card already says what the form says.). The button writes it now.");
    expect(extensionJobNote({ job: "ceo-extensions-auto", ok: true, error: "Wrote 2 cards.", at }, true))
      .toBe("Kept current every hour at :47 from the extension form (last run 2026-10-11 15:47 Kuwait: Wrote 2 cards.). The button writes it now.");
    expect(extensionJobNote(null, true)).toContain("has not reported a run yet");
    expect(extensionJobNote(null, false)).toContain("Create a Number field");
    expect(extensionJobNote({ error: "Dry run" }, true)).not.toContain("never automatically");
  });

  test("grant rows by day for twelve months, matched to a card, tests left out", () => {
    const cards = [{ taskId: "t1", name: "Ocean Home" }, { taskId: "t2", name: "Internal Test" }];
    const rows = grantRowsOf([
      { client: "ocean home", day: "2026-10-02", weeks: 2, until: "2026-10-16", submittedAt: 0 },
      { client: "Someone New", day: "2026-09-10", weeks: 1, until: "2026-09-17", submittedAt: 0 },
      { client: "internal test", day: "2026-10-03", weeks: 4, until: "2026-10-31", submittedAt: 0 },
      { client: "ocean home", day: "2025-09-01", weeks: 4, until: "2025-09-29", submittedAt: 0 },
    ], cards, "2026-10-11");
    expect(rows).toEqual([
      { day: "2026-09-10", taskId: null, client: "Someone New", weeks: 1, until: "2026-09-17" },
      { day: "2026-10-02", taskId: "t1", client: "Ocean Home", weeks: 2, until: "2026-10-16" },
    ]);
  });
});

describe("Per-day series for the timeframe bar (A127)", () => {
  test("client spend, leads and due bookings per day, deleted campaigns kept by their tags", () => {
    const cardByKey = new Map([["oceanhome", "t-ocean"], ["liwan", "t-liwan"]]);
    const cardOf = (keys: unknown[]) => keys.map(k => String(k ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).map(k => cardByKey.get(k)).find(Boolean) ?? null;
    const { byTask } = clientDailyOf({
      campaignTags: [
        { name: "Ocean A", tag: "oceanhome", tags: ["oceanhome"], client: "Ocean Home" },
        { name: "Liwan old (deleted)", tag: null, tags: [], client: "Liwan" },
        { name: "Nobody", tag: "nobody", tags: [], client: "Nobody" },
      ],
      cardOf,
      daily: [
        { campaignName: "Ocean A", date: "2026-10-09", spend: 10.5, leads: 2 },
        { campaignName: "Ocean A", date: "2026-10-09", spend: 4.5, leads: 1 },
        { campaignName: "Liwan old (deleted)", date: "2026-10-10", spend: 7, leads: 0 },
        { campaignName: "Nobody", date: "2026-10-10", spend: 99, leads: 9 },
      ],
      bookings: [
        { campaignName: "Ocean A", date: "2026-10-10", count: 3, future: 1 },
      ],
      from: "2026-10-09",
      to: "2026-10-11",
    });
    expect(byTask.get("t-ocean")).toEqual([
      { date: "2026-10-09", spend: 15, leads: 3, bookings: 0 },
      { date: "2026-10-10", spend: 0, leads: 0, bookings: 2 },
      { date: "2026-10-11", spend: 0, leads: 0, bookings: 0 },
    ]);
    expect(byTask.get("t-liwan")?.[1]).toEqual({ date: "2026-10-10", spend: 7, leads: 0, bookings: 0 });
    expect(byTask.has("nobody")).toBe(false);
  });

  test("the frozen snapshot fill adds only ad-days the live rows did not count, and gives a card with no live campaign its days", () => {
    const cardByKey = new Map([["oceanhome", "t-ocean"]]);
    const cardOf = (keys: unknown[]) => keys.map(k => String(k ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).map(k => cardByKey.get(k)).find(Boolean) ?? null;
    const { byTask, filled, filledUsd } = clientDailyOf({
      campaignTags: [{ name: "Ocean A", tag: "oceanhome", tags: [], client: "Ocean Home" }],
      cardOf,
      daily: [{ campaignName: "Ocean A", metaAdId: "ad-1", date: "2026-09-20", spend: 10, leads: 1 }],
      bookings: [],
      from: "2026-09-20",
      to: "2026-09-21",
      fill: [
        // The live row's own ad-day: already counted, so not added again.
        { taskId: "t-ocean", date: "2026-09-20", ad: "ad-1", spend: 10, leads: 1 },
        // An ad the live table does not hold: added.
        { taskId: "t-ocean", date: "2026-09-20", ad: "ad-2", spend: 5.25, leads: 2 },
        // A card whose campaigns are not on the board at all.
        { taskId: "t-ribalo", date: "2026-09-21", ad: "ad-9", spend: 20, leads: 0 },
      ],
    });
    expect(byTask.get("t-ocean")?.[0]).toEqual({ date: "2026-09-20", spend: 15.25, leads: 3, bookings: 0 });
    expect(byTask.get("t-ribalo")).toEqual([
      { date: "2026-09-20", spend: 0, leads: 0, bookings: 0 },
      { date: "2026-09-21", spend: 20, leads: 0, bookings: 0 },
    ]);
    expect(filled).toBe(2);
    expect(filledUsd).toBe(25.25);
  });

  test("EOD days: due, filed and late, from the person's first day, Fridays and paused days not due", () => {
    const days = new Map([
      ["2026-10-07", { day: "2026-10-07", at: 1, onTime: true }],
      ["2026-10-08", { day: "2026-10-08", at: 1, onTime: false }],
    ]);
    const p = { key: "csm:sara", since: "2026-10-06", days, history: days };
    const offOn = (_key: string, day: string) => day === "2026-10-10";
    const series = eodDaysOf(p, "2026-10-01", "2026-10-10", offOn);
    expect(series[0]).toEqual({ date: "2026-10-06", due: true, filed: false, late: false });
    expect(series.find(d => d.date === "2026-10-07")).toEqual({ date: "2026-10-07", due: true, filed: true, late: false });
    expect(series.find(d => d.date === "2026-10-08")).toEqual({ date: "2026-10-08", due: true, filed: true, late: true });
    // 2026-10-09 is a Friday; 2026-10-10 the person was paused.
    expect(series.find(d => d.date === "2026-10-09")?.due).toBe(false);
    expect(series.find(d => d.date === "2026-10-10")?.due).toBe(false);
    expect(series).toHaveLength(5);
  });

  test("applied and hired per Kuwait day over every candidate", () => {
    const ms = (iso: string) => Date.parse(iso);
    const series = hiringSeries([
      { applied_ms: ms("2026-10-01T22:30:00Z"), stage: "application", stage_ms: ms("2026-10-01T22:30:00Z") },
      { applied_ms: ms("2026-10-02T08:00:00Z"), stage: "hired", stage_ms: ms("2026-10-09T10:00:00Z") },
      { applied_ms: null, stage: "hired", stage_ms: null },
    ]);
    // 22:30 UTC on 1 Oct is 2 Oct in Kuwait.
    expect(series.appliedByDay).toEqual([{ date: "2026-10-02", count: 2 }]);
    expect(series.hiredByDay).toEqual([{ date: "2026-10-09", count: 1 }]);
  });
});
