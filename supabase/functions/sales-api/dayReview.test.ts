import { expect, test } from "bun:test";
import {
  callAttended,
  callReviewed,
  dayBounds,
  outcomeMissing,
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
test("a held intro or demo needs the lead's quality; a held intro with no demo needs a reason", () => {
  const intro = { appointment_id: "i", call_type: "intro", status: "showed" };
  expect(outcomeMissing(intro)).toBe(true);
  expect(outcomeMissing({ ...intro, lead_quality: 7 })).toBe(true);
  expect(outcomeMissing({ ...intro, lead_quality: 7, no_demo_reason: "not_ready" })).toBe(false);
  expect(outcomeMissing({ ...intro, lead_quality: 7, demo_after_at: "2026-10-30T10:00:00Z" })).toBe(false);
  expect(outcomeMissing({ ...intro, lead_quality: 7, signed_after: true })).toBe(false);
  // Disqualified: the mark's own reason says why.
  expect(outcomeMissing({ ...intro, status: "invalid", lead_quality: 3 })).toBe(false);
  expect(outcomeMissing({ ...intro, status: "invalid" })).toBe(true);
  // The rep's mark wins over HighLevel's status.
  expect(outcomeMissing({ ...intro, status: "showed", marked_status: "noshow" })).toBe(false);
  const demo = { appointment_id: "d", call_type: "demo", status: "showed" };
  expect(outcomeMissing(demo)).toBe(true);
  expect(outcomeMissing({ ...demo, lead_quality: 9 })).toBe(false);
  for (const status of ["noshow", "cancelled", "confirmed", "new"])
    expect(outcomeMissing({ ...intro, status })).toBe(false);
  expect(outcomeMissing({ appointment_id: "f", call_type: "follow_up", status: "showed" })).toBe(false);
  expect(callReviewed(intro)).toBe(false);
  expect(callReviewed({ ...intro, lead_quality: 5, no_demo_reason: "thinking" })).toBe(true);
});
