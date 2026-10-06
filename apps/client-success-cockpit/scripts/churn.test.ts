import { describe, expect, test } from "bun:test";
import {
  bandOf,
  countsAs,
  daysIn,
  departureProblem,
  type MonthInput,
  rollUp,
  verdictLine,
} from "../src/lib/churnCore";

// The day a client left, a launch date `days` before it.
function left(leftOn: string, days: number | null) {
  if (days === null) return { leftOn, launchedOn: null };
  const at = new Date(Date.parse(`${leftOn}T00:00:00Z`) - days * 86_400_000);
  return { leftOn, launchedOn: at.toISOString().slice(0, 10) };
}

describe("one departure", () => {
  test("before day 90 is churn, day 90 or later finished the term", () => {
    expect(countsAs(left("2026-10-05", 47))).toBe("churn");
    expect(countsAs(left("2026-10-05", 89))).toBe("churn");
    expect(countsAs(left("2026-10-05", 90))).toBe("completed");
    expect(countsAs(left("2026-10-05", 119))).toBe("completed");
    expect(countsAs(left("2026-10-05", null))).toBe("unknown");
    expect(daysIn(left("2026-10-05", 47))).toBe(47);
  });

  test("says what it counts as, in plain words", () => {
    expect(verdictLine(left("2026-10-05", 47))).toBe(
      "Day 47 of 90: counts as churn in October 2026",
    );
    expect(verdictLine(left("2026-10-05", 112))).toBe(
      "Day 112: finished the term, not churn",
    );
    expect(verdictLine(left("2026-10-05", null))).toBe(
      "Needs a launch date before it counts either way",
    );
  });

  test("refuses what cannot be saved, with a sentence", () => {
    const ok = {
      client: "North Gulf",
      leftOn: "2026-10-05",
      launchedOn: "2026-08-01",
      reason: "Cancelled",
      mrrLostUsd: 1333,
    };
    expect(departureProblem(ok)).toBeNull();
    expect(departureProblem({ ...ok, client: " " })).toBe("Name the client.");
    expect(departureProblem({ ...ok, launchedOn: "2026-11-01" })).toBe(
      "The launch date is after the day they left.",
    );
    expect(departureProblem({ ...ok, reason: "Bored" })).toBe(
      "Pick why they left.",
    );
    expect(departureProblem({ ...ok, mrrLostUsd: -5 })).toBe(
      "MRR lost is a dollar amount, 0 or more.",
    );
  });
});

describe("a month", () => {
  test("mahara-context's check: days 50, 24 and 119 at 17 clients read 2 churned, 1 completed, 11.8%, Watch", () => {
    const inputs: MonthInput[] = [
      {
        month: "2026-10",
        activeAtStart: 17,
        newClients: 0,
        lostBeforeRegister: null,
        note: null,
      },
    ];
    const deps = [
      left("2026-10-03", 50),
      left("2026-10-12", 24),
      left("2026-10-20", 119),
    ];
    const [oct] = rollUp(inputs, deps, "2026-10");
    expect(oct.churned).toBe(2);
    expect(oct.completed).toBe(1);
    expect(oct.churnPct).toBe(11.8);
    expect(oct.activeAtEnd).toBe(14);
    expect(oct.band?.label).toBe("Watch");
  });

  test("a blank start carries from the month before, once that month's end is known", () => {
    const inputs: MonthInput[] = [
      {
        month: "2026-09",
        activeAtStart: 22,
        newClients: null,
        lostBeforeRegister: 1,
        note: "old sheet",
      },
    ];
    let rows = rollUp(inputs, [], "2026-10");
    expect(rows.map(r => r.month)).toEqual(["2026-09", "2026-10"]);
    // September's new clients were never typed: October cannot carry a start.
    expect(rows[1].activeAtStart).toBeNull();

    inputs[0].newClients = 2;
    rows = rollUp(inputs, [left("2026-10-08", 30)], "2026-10");
    expect(rows[0].churned).toBe(1); // the old sheet's count
    expect(rows[0].activeAtEnd).toBe(23);
    expect(rows[1].activeAtStart).toBe(23);
    expect(rows[1].startCarried).toBe(true);
    expect(rows[1].churnPct).toBe(4.3);
  });

  test("the rolling three months sums churned over starts, skipping a month with no start", () => {
    const inputs: MonthInput[] = [
      {
        month: "2026-08",
        activeAtStart: null,
        newClients: 10,
        lostBeforeRegister: 2,
        note: null,
      },
      {
        month: "2026-09",
        activeAtStart: 22,
        newClients: 2,
        lostBeforeRegister: 1,
        note: null,
      },
      {
        month: "2026-10",
        activeAtStart: 23,
        newClients: 1,
        lostBeforeRegister: null,
        note: null,
      },
    ];
    const rows = rollUp(inputs, [left("2026-10-08", 30)], "2026-10");
    const oct = rows[rows.length - 1];
    expect(oct.rolling3Pct).toBe(4.4); // (1 + 1) / (22 + 23)
    expect(oct.band?.label).toBe("Good");
  });

  test("once the register covers a month, the old sheet's count for it steps aside", () => {
    const rows = rollUp(
      [{ month: "2026-09", activeAtStart: 22, newClients: 2, lostBeforeRegister: 1, note: null }],
      [left("2026-09-20", 40)],
      "2026-09",
    );
    expect(rows[0].churned).toBe(1);
    expect(rows[0].lostBeforeRegister).toBeNull();
  });

  test("a departure with no launch date counts neither way until it has one", () => {
    const rows = rollUp(
      [
        {
          month: "2026-10",
          activeAtStart: 20,
          newClients: 0,
          lostBeforeRegister: null,
          note: null,
        },
      ],
      [left("2026-10-08", null)],
      "2026-10",
    );
    expect(rows[0].churned).toBe(0);
    expect(rows[0].completed).toBe(0);
    expect(rows[0].unknown).toBe(1);
  });

  test("months with nothing in them are marked, so the page can leave them out", () => {
    const rows = rollUp(
      [
        {
          month: "2026-01",
          activeAtStart: 15,
          newClients: 5,
          lostBeforeRegister: 3,
          note: null,
        },
      ],
      [],
      "2026-04",
    );
    expect(rows.map(r => [r.month, r.hasData])).toEqual([
      ["2026-01", true],
      ["2026-02", false],
      ["2026-03", false],
      ["2026-04", true],
    ]);
  });
});

describe("the bands match the CSM's retention bonus", () => {
  test.each([
    [0, "Excellent"],
    [4, "Excellent"],
    [5.9, "Good"],
    [8, "Good"],
    [10, "On target"],
    [11.8, "Watch"],
    [15, "Bad"],
    [15.1, "Critical"],
  ])("%p%% is %s", (pct, label) => {
    expect(bandOf(pct).label).toBe(label);
  });
});
