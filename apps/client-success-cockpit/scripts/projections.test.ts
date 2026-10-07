import { describe, expect, test } from "bun:test";
import {
  actualOf,
  addDays,
  assertNeutralTitle,
  BANNED_TITLE,
  FIRST_WIN_NEEDED,
  filtersOf,
  hardestOf,
  hotUsedThisMonth,
  inWindow,
  isMissed,
  isRed,
  metricOfHotType,
  metricOfWin,
  resellGate,
  reviewTitle,
  rowState,
  verdictOf,
  weekStartOf,
  whereTheyAre,
  winsInWeek,
  wonAction,
} from "../src/lib/projectionsCore";

const TODAY = "2026-09-27";
const out = (n: number) => addDays(TODAY, n);

describe("the renewal window", () => {
  test("a client enters it 60 days before the date, not 61", () => {
    expect(inWindow(out(60), TODAY)).toBe(true);
    expect(inWindow(out(61), TODAY)).toBe(false);
    expect(inWindow(out(0), TODAY)).toBe(true);
    expect(inWindow(null, TODAY)).toBe(false);
    expect(inWindow("not a day", TODAY)).toBe(false);
  });

  test("a passed date stays in the window until an outcome is logged", () => {
    expect(inWindow(out(-3), TODAY, "planned")).toBe(true);
    expect(inWindow(out(-3), TODAY, "renewed")).toBe(false);
  });

  test("red at 30 days with no call and no reason, not at 31", () => {
    expect(isRed(out(30), {}, TODAY)).toBe(true);
    expect(isRed(out(31), {}, TODAY)).toBe(false);
    expect(isRed(out(0), { status: "planned" }, TODAY)).toBe(true);
    expect(rowState(out(30), {}, TODAY)).toBe("red");
    expect(rowState(out(31), {}, TODAY)).toBe("planned");
  });

  test("a booked call or a not-this-cycle reason clears the red", () => {
    expect(isRed(out(10), { callBookedFor: out(5) }, TODAY)).toBe(false);
    expect(
      isRed(out(10), { notThisCycleReason: "Paused for Ramadan" }, TODAY),
    ).toBe(false);
    expect(isRed(out(10), { notThisCycleReason: "   " }, TODAY)).toBe(true);
    expect(isRed(out(10), { status: "renewed" }, TODAY)).toBe(false);
  });

  test("missed after the date while still planned, never on the date itself", () => {
    expect(isMissed(out(-1), {}, TODAY)).toBe(true);
    expect(isMissed(out(-1), { status: "planned" }, TODAY)).toBe(true);
    expect(isMissed(out(0), {}, TODAY)).toBe(false);
    expect(isMissed(out(-1), { status: "renewed" }, TODAY)).toBe(false);
    expect(isMissed(out(-1), { status: "call_booked" }, TODAY)).toBe(false);
    expect(rowState(out(-1), {}, TODAY)).toBe("missed");
    expect(
      rowState(
        out(-1),
        { status: "call_booked", callBookedFor: out(-4) },
        TODAY,
      ),
    ).toBe("outcome_due");
  });

  test("filter chips: 0-30, 31-60, booked and done", () => {
    expect(filtersOf(out(12), {}, TODAY)).toEqual(["0-30"]);
    expect(filtersOf(out(45), { callBookedFor: out(20) }, TODAY)).toEqual([
      "31-60",
      "booked",
    ]);
    expect(filtersOf(out(45), { status: "lost" }, TODAY)).toEqual(["done"]);
  });

  test("the hardest row is the least likely, then the nearest", () => {
    const rows = [
      { id: "a", renewalDate: out(10), likelihood: "high" },
      { id: "b", renewalDate: out(40), likelihood: "low" },
      { id: "c", renewalDate: out(20), likelihood: "low" },
      { id: "d", renewalDate: out(5), likelihood: "low", status: "renewed" },
    ];
    expect(hardestOf(rows, TODAY)?.id).toBe("c");
    expect(hardestOf([], TODAY)).toBeNull();
  });
});

describe("one re-sell conversation a month, after a first win", () => {
  const client = { name: "Client A", stage: "Active", liveDays: 40 };
  const decision = (
    subject: string,
    action: string,
    day: string,
    kind = "approved",
  ) => ({
    role: "csm",
    subject,
    action,
    day,
    kind,
  });

  test("no first win: the offer says so", () => {
    const gate = resellGate(
      { name: "Client B", stage: "Active", liveDays: 5 },
      new Set(),
      TODAY,
    );
    expect(gate).toEqual({ ok: false, why: FIRST_WIN_NEEDED });
    expect(
      resellGate(
        { name: "Client B", firstWin: false, stage: "Active", liveDays: 90 },
        new Set(),
        TODAY,
      ).ok,
    ).toBe(false);
  });

  test("the first conversation of the month is open, the second is capped", () => {
    expect(resellGate(client, new Set(), TODAY)).toEqual({ ok: true });
    const used = hotUsedThisMonth(
      [
        decision(
          "Client A",
          wonAction("resell", "SMM package"),
          "2026-09-10",
          "won",
        ),
      ],
      "2026-09",
    );
    const gate = resellGate(client, used, TODAY);
    expect(gate.ok).toBe(false);
    expect(gate.ok ? "" : gate.why).toContain("1 Oct");
  });

  test("the cap is the start-of-day hot-list rule: a left decision and last month do not count", () => {
    const used = hotUsedThisMonth(
      [
        decision("Client A", "Upsell conversation", "2026-09-02", "left"),
        decision("Client B", "Upsell conversation", "2026-08-30"),
        decision("Client C", "Referral ask", "2026-09-03"),
        decision(
          "Client D",
          "Booked the proactive results call for 2026-10-01",
          "2026-09-04",
        ),
      ],
      "2026-09",
    );
    expect([...used]).toEqual(["Client C"]);
  });
});

describe("the booked call's title", () => {
  test("never says upgrade, upsell or renewal, whatever the client is called", () => {
    for (const name of [
      "Renewal Clinic",
      "Upgrade Motors",
      "The Upsell Shop",
      "renewables co",
      "Plain Name",
    ]) {
      const title = reviewTitle(name);
      expect(BANNED_TITLE.test(title)).toBe(false);
      expect(title.startsWith("Results and strategy review")).toBe(true);
    }
    expect(reviewTitle("Plain Name")).toBe(
      "Results and strategy review: Plain Name",
    );
    expect(reviewTitle("Renewal")).toBe("Results and strategy review");
  });

  test("the guard refuses a title that slips through", () => {
    expect(() => assertNeutralTitle("Renewal call")).toThrow();
    expect(() => assertNeutralTitle("Upgrade chat")).toThrow();
    expect(() => assertNeutralTitle("upsell")).toThrow();
    expect(() =>
      assertNeutralTitle("Results and strategy review: A"),
    ).not.toThrow();
  });
});

describe("actuals", () => {
  test("never zero when the source is missing", () => {
    const a = actualOf(
      { ok: false, note: "Billing has not refreshed since 20 Sep." },
      undefined,
    );
    expect(a.value).toBeNull();
    expect(a.from).toBe("missing");
    expect(a.note).toContain("Manual entry");
    expect(actualOf({ ok: false, note: "x" }, null).value).toBeNull();
  });

  test("a hand-typed number is used when the source is missing, and says so", () => {
    const a = actualOf({ ok: false, note: "No renewal dates yet." }, 2);
    expect(a).toEqual({
      value: 2,
      from: "manual",
      note: "Entered by hand. No renewal dates yet.",
    });
    expect(actualOf({ ok: false, note: "x" }, 0).value).toBe(0);
  });

  test("the source wins over a hand-typed number", () => {
    expect(actualOf({ ok: true, value: 3, note: "wins logged" }, 9)).toEqual({
      value: 3,
      from: "source",
      note: "wins logged",
    });
  });

  test("hit, stretch, below and missed", () => {
    expect(verdictOf({}, 2, true)).toBe("unset");
    expect(verdictOf({ blood: 1, stretch: 3 }, null, true)).toBe("no_actual");
    expect(verdictOf({ blood: 1, stretch: 3 }, 3, false)).toBe("stretch");
    expect(verdictOf({ blood: 1, stretch: 3 }, 1, false)).toBe("hit");
    expect(verdictOf({ blood: 2, stretch: 3 }, 1, false)).toBe("behind");
    expect(verdictOf({ blood: 2, stretch: 3 }, 1, true)).toBe("missed");
  });

  test("wins are counted by week and a win taken back comes off", () => {
    const week = "2026-09-27";
    const d = (action: string, day: string, kind = "won") => ({
      role: "csm",
      subject: "A",
      action,
      day,
      kind,
    });
    const wins = winsInWeek(
      [
        d(wonAction("resell"), "2026-09-27"),
        d(wonAction("resell"), "2026-10-03"),
        d(wonAction("resell"), "2026-10-04"),
        d(wonAction("review"), "2026-09-28"),
        d(wonAction("review"), "2026-09-29", "unwon"),
        d(wonAction("renewal"), "2026-09-30"),
        d("Booked the proactive results call", "2026-09-30", "approved"),
      ],
      week,
    );
    expect(wins).toEqual({
      resell: 2,
      renewal: 1,
      cash: 0,
      review: 0,
      referral: 0,
    });
  });

  test("hot-list types and won actions map to their metric", () => {
    expect(metricOfHotType("Upsell - SMM")).toBe("resell");
    expect(metricOfHotType("Referral")).toBe("referral");
    expect(metricOfHotType("Review")).toBe("review");
    expect(metricOfHotType("")).toBeNull();
    expect(metricOfWin("Won: renewal, 6 months")).toBe("renewal");
    expect(metricOfWin("Won undone: referral")).toBe("referral");
    expect(metricOfWin("Upsell conversation")).toBeNull();
  });

  test("weeks start on Sunday in Kuwait", () => {
    expect(weekStartOf("2000-01-02")).toBe("2000-01-02");
    expect(weekStartOf("2000-01-08")).toBe("2000-01-02");
    expect(weekStartOf("2026-10-01")).toBe("2026-09-27");
  });
});

describe("where the client is", () => {
  test("every line carries its source, and a missing fact is left out, not zero", () => {
    const facts = whereTheyAre(
      {
        stage: "Active",
        liveDays: 40,
        launchDate: "2026-08-18",
        happiness: "Happy",
      },
      { month: { leads: 12, booked: 4 }, monthLabel: "Sep" },
      { usd: 4500, payments: 3, since: "2026-06-01", source: "ledger" },
    );
    expect(facts.every(f => f.source.length > 0)).toBe(true);
    expect(facts.find(f => f.label === "Paid so far")?.value).toBe("$4,500");
    expect(facts.find(f => f.label.startsWith("Closes"))).toBeUndefined();
    expect(whereTheyAre({}, null, null)).toEqual([]);
  });
});
