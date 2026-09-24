// bun test src/lib/goals.test.ts
import { describe, expect, test } from "bun:test";
import {
  type GoalRow,
  goalFor,
  monthKeys,
  monthLines,
  monthWords,
  shiftMonth,
} from "./goals";
import type { Scorecard } from "./types";

const card = (over: Partial<Scorecard>): Scorecard =>
  ({
    person_key: "r1",
    display_name: "Tahrir",
    role: "setter",
    is_known: true,
    calls_scheduled: 0,
    calls_due: 0,
    calls_shown: 0,
    calls_qualified: 0,
    demos_scheduled: 0,
    demos_due: 0,
    demos_shown: 0,
    demos_qualified: 0,
    disqualified_count: 0,
    noshow_count: 0,
    cancelled_count: 0,
    show_rate: null,
    noshow_rate: null,
    disqualified_rate: null,
    closes: 0,
    revenue: null,
    cash_collected: null,
    new_mrr: null,
    close_rate: null,
    avg_deal: null,
    ...over,
  }) as Scorecard;

const row = (over: Partial<GoalRow>): GoalRow => ({
  person_key: "r1",
  month: "2026-09-01",
  metric: "booked",
  goal: null,
  forecast: null,
  goal_by: null,
  goal_at: null,
  forecast_by: null,
  forecast_at: null,
  ...over,
});

describe("months", () => {
  test("Kuwait's month, then back through the year", () => {
    // 22:00 UTC on 30 September is already 1 October in Kuwait.
    expect(monthKeys(Date.parse("2026-09-30T22:00:00Z"), 2)).toEqual([
      "2026-10",
      "2026-09",
      "2026-08",
    ]);
    expect(monthKeys(Date.parse("2026-01-15T09:00:00Z"), 1)).toEqual([
      "2026-01",
      "2025-12",
    ]);
  });
  test("shifting and naming", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthWords("2026-09")).toBe("September 2026");
  });
});

describe("the goal in force", () => {
  test("the month's own row wins over the seat's standing goal", () => {
    const rows = [row({ goal: 30 })];
    expect(goalFor(rows, "2026-09", "booked", { booked: 20 })).toEqual({
      value: 30,
      from: "month",
    });
  });
  test("a month with no row takes the standing goal, and says so", () => {
    expect(goalFor([], "2026-09", "booked", { booked: 20 })).toEqual({
      value: 20,
      from: "standing",
    });
  });
  test("a row with only a forecast does not hide the standing goal", () => {
    const rows = [row({ goal: null, forecast: 25 })];
    expect(goalFor(rows, "2026-09", "booked", { booked: 20 }).value).toBe(20);
  });
  test("no goal anywhere is no goal, not zero", () => {
    expect(goalFor([], "2026-09", "closes", null)).toEqual({
      value: null,
      from: null,
    });
  });
});

describe("a month's lines", () => {
  test("mid-month: the pace projects to the month's working days", () => {
    // 24 Sep 2026: September has 26 working days (4 Fridays off); 21 have begun.
    const lines = monthLines({
      month: "2026-09",
      nowMs: Date.parse("2026-09-24T09:00:00Z"),
      card: card({ calls_scheduled: 21 }),
      dials: 36,
      rows: [row({ goal: 30, forecast: 28 })],
    });
    const booked = lines.find(l => l.metric === "booked");
    expect(booked?.actual).toBe(21);
    expect(booked?.goal).toBe(30);
    expect(booked?.forecast).toBe(28);
    expect(booked?.projected).toBeCloseTo(26, 5);
    // 26 of 30 is within a fifth of the goal: close, not behind.
    expect(booked?.verdict?.label).toBe("Close");
    expect(lines.find(l => l.metric === "dials")?.actual).toBe(36);
  });
  test("a pace under four fifths of the goal is behind", () => {
    const lines = monthLines({
      month: "2026-09",
      nowMs: Date.parse("2026-09-24T09:00:00Z"),
      card: card({ calls_scheduled: 10 }),
      dials: null,
      rows: [row({ goal: 30 })],
    });
    const booked = lines.find(l => l.metric === "booked");
    expect(booked?.projected).toBeCloseTo((10 / 21) * 26, 5);
    expect(booked?.verdict).toEqual({ tone: "critical", label: "Behind" });
  });
  test("a finished month is met or missed on the actual", () => {
    const lines = monthLines({
      month: "2026-08",
      nowMs: Date.parse("2026-09-24T09:00:00Z"),
      card: card({ closes: 3 }),
      dials: null,
      rows: [row({ month: "2026-08-01", metric: "closes", goal: 4 })],
    });
    const closes = lines.find(l => l.metric === "closes");
    expect(closes?.projected).toBe(3);
    expect(closes?.verdict).toEqual({ tone: "critical", label: "Missed" });
  });
  test("no scorecard is no data, not zero; no Maqsam address is no dials", () => {
    const lines = monthLines({
      month: "2026-08",
      nowMs: Date.parse("2026-09-24T09:00:00Z"),
      card: null,
      dials: null,
      rows: [],
    });
    expect(lines.every(l => l.actual === null)).toBe(true);
  });
  test("a month that has not begun has no actuals yet", () => {
    const lines = monthLines({
      month: "2026-10",
      nowMs: Date.parse("2026-09-24T09:00:00Z"),
      card: card({ calls_scheduled: 5 }),
      dials: 3,
      rows: [row({ month: "2026-10-01", goal: 30 })],
    });
    expect(lines.find(l => l.metric === "booked")?.actual).toBeNull();
    expect(lines.find(l => l.metric === "booked")?.goal).toBe(30);
  });
});
