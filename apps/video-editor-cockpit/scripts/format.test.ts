import { expect, test } from "bun:test";
import { dueDays, kuwaitDay, whenDue } from "../src/lib/format";
import { holder, onEditor, stageRank } from "../src/lib/stages";
import type { Job } from "../src/lib/types";

for (const [instant, expected] of [
  ["2026-10-04T20:59:59.999Z", "2026-10-04"],
  ["2026-10-04T21:00:00.000Z", "2026-10-05"],
  ["2026-12-31T21:00:00.000Z", "2027-01-01"],
  ["2028-02-28T21:00:00.000Z", "2028-02-29"],
]) {
  test(`EOD filing day for ${instant} follows Kuwait midnight`, () => {
    expect(kuwaitDay(new Date(instant))).toBe(expected);
  });
}

// ClickUp keeps a date-only due date at 04:00 Kuwait (01:00 UTC).
const DUE_TODAY = "2026-10-20T01:00:00.000Z";

test("a job due today stays due today all day in Kuwait", () => {
  for (const now of [
    "2026-10-20T05:00:00Z",
    "2026-10-20T14:00:00Z",
    "2026-10-20T20:30:00Z",
  ]) {
    expect(dueDays(DUE_TODAY, new Date(now))).toBe(0);
    expect(whenDue(DUE_TODAY, new Date(now))).toEqual({
      text: "due today",
      late: false,
    });
  }
});

test("a job turns late at Kuwait midnight, not after twelve hours", () => {
  expect(whenDue(DUE_TODAY, new Date("2026-10-20T21:00:00Z"))).toEqual({
    text: "1 day late",
    late: true,
  });
  expect(
    whenDue("2026-10-21T01:00:00Z", new Date("2026-10-20T14:00:00Z")).text,
  ).toBe("due tomorrow");
  expect(
    whenDue("2026-09-15T01:00:00Z", new Date("2026-10-20T14:00:00Z")).text,
  ).toBe("35 days late");
});

test("every live board status has a place and a holder", () => {
  const live = [
    "new video request",
    "planning",
    "in progress",
    "internal review",
    "internal approved",
    "client review",
    "client approved",
    "update required",
    "on hold",
    "live 🚀",
    "cancelled",
  ];
  live.forEach((s, i) => expect(stageRank(s)).toBe(i));
  expect(holder("live 🚀")).toBe("finished");
  expect(holder("client approved")).toBe("review");
  expect(holder("internal review")).toBe("review");
  expect(holder("update required")).toBe("editor");
  expect(holder("on hold")).toBe("hold");
  expect(holder("a status added later")).toBe("editor");
});

test("only work on the editor counts as theirs", () => {
  const job = (status: string, state: Job["state"]) =>
    ({ status, state }) as Job;
  expect(onEditor(job("planning", "ready"))).toBe(true);
  expect(onEditor(job("client review", "ready"))).toBe(false);
  expect(onEditor(job("in progress", "delivered"))).toBe(false);
  expect(onEditor(job("in progress", "gone"))).toBe(false);
});
