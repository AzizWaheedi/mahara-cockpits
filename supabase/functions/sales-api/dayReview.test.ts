import { expect, test } from "bun:test";
import {
  callAttended,
  callReviewed,
  dayBounds,
  reviewVersion,
} from "./dayReview.ts";
test("a passed confirmation is not attended or reviewed", () => {
  const r = {
    appointment_id: "a",
    status: "confirmed",
    start_at: "2026-10-21T12:00:00Z",
  };
  expect(callReviewed(r)).toBe(false);
  expect(callAttended(r)).toBe(false);
});
test("human corrections take priority and terminal CRM states need no duplicate marking", () => {
  for (const status of [
    "showed",
    "completed",
    "noshow",
    "cancelled",
    "invalid",
  ]) {
    expect(callReviewed({ appointment_id: "a", status })).toBe(true);
  }
  expect(
    callAttended({
      appointment_id: "a",
      status: "showed",
      marked_status: "noshow",
    }),
  ).toBe(false);
});
test("review version changes with an outcome, owner, time or note", () => {
  const a = {
    appointment_id: "a",
    status: "showed",
    assigned_user_id: "u",
    start_at: "x",
    mark_note: "y",
  };
  for (const k of ["status", "assigned_user_id", "start_at", "mark_note"]) {
    expect(reviewVersion([a])).not.toBe(
      reviewVersion([{ ...a, [k]: "changed" }]),
    );
  }
});
test("the workday query uses Kuwait boundaries", () =>
  expect(dayBounds("2026-10-22")).toEqual({
    from: "2026-10-21T21:00:00.000Z",
    to: "2026-10-22T21:00:00.000Z",
  }));
