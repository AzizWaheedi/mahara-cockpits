import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  asksWhy,
  heldCall,
  heldRow,
  outcomeMissing,
  qualityTone,
  REASON_GROUPS,
  reasonLabel,
} from "./afterCall";
import { reviewed } from "./dayReview";
import type { CalendarRow } from "./types";

const base = heldRow({
  id: "a",
  type: "intro",
  start_at: "2026-10-29T07:00:00Z",
  booked_at: null,
  assigned_user_id: "u",
  contact_id: "c",
  contact_name: "Lead",
});
const row = (over: Partial<CalendarRow>): CalendarRow => ({ ...base, ...over });

test("a held intro needs the lead rated and, with no demo, a reason", () => {
  expect(heldCall(base)).toBe(true);
  expect(outcomeMissing(base)).toBe(true);
  expect(outcomeMissing(row({ lead_quality: 7 }))).toBe(true);
  expect(
    outcomeMissing(row({ lead_quality: 7, no_demo_reason: "thinking" })),
  ).toBe(false);
  expect(asksWhy(row({ demo_after_at: "2026-10-30T10:00:00Z" }))).toBe(false);
  expect(
    outcomeMissing(
      row({ lead_quality: 7, demo_after_at: "2026-10-30T10:00:00Z" }),
    ),
  ).toBe(false);
  expect(outcomeMissing(row({ lead_quality: 7, signed_after: true }))).toBe(
    false,
  );
});

test("a disqualified intro is rated, and its mark says why", () => {
  const dq = row({
    marked_status: "invalid",
    status: "invalid",
    mark_reason: "No budget",
  });
  expect(asksWhy(dq)).toBe(false);
  expect(outcomeMissing(dq)).toBe(true);
  expect(outcomeMissing({ ...dq, lead_quality: 2 })).toBe(false);
});

test("a demo is rated, never asked why no demo", () => {
  const demo = row({ call_type: "demo" });
  expect(asksWhy(demo)).toBe(false);
  expect(outcomeMissing(demo)).toBe(true);
  expect(outcomeMissing({ ...demo, lead_quality: 9 })).toBe(false);
});

test("no-shows, cancellations, unmarked calls and follow-ups are never asked", () => {
  for (const status of ["noshow", "cancelled", "confirmed", "new"])
    expect(outcomeMissing(row({ marked_status: null, status }))).toBe(false);
  // The rep's mark wins over HighLevel's status.
  expect(
    outcomeMissing(row({ marked_status: "noshow", status: "showed" })),
  ).toBe(false);
  expect(outcomeMissing(row({ call_type: "follow_up" }))).toBe(false);
});

test("the end of day's check waits on the answers", () => {
  expect(reviewed(base)).toBe(false);
  expect(reviewed(row({ lead_quality: 5, no_demo_reason: "no_budget" }))).toBe(
    true,
  );
  expect(reviewed(row({ marked_status: "noshow", status: "noshow" }))).toBe(
    true,
  );
});

test("the scale's bands: 1 to 3 low, 4 to 6 middle, 7 to 10 high", () => {
  expect([1, 3, 4, 6, 7, 10].map(qualityTone)).toEqual([
    "bad",
    "bad",
    "watch",
    "watch",
    "good",
    "good",
  ]);
});

test("the reasons are the server's and the migration's, in the same order", () => {
  const keys = [
    "signed",
    ...REASON_GROUPS.flatMap(g => g.reasons.map(r => r.key)),
    "other",
  ];
  const server = readFileSync(
    new URL(
      "../../../../supabase/functions/sales-api/callOutcomes.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const list = server.slice(
    server.indexOf("NO_DEMO_REASONS = ["),
    server.indexOf("] as const"),
  );
  expect([...list.matchAll(/"([a-z_]+)"/g)].map(m => m[1])).toEqual(keys);
  const sql = readFileSync(
    new URL(
      "../../../../supabase/migrations/20261029a_sales_call_outcomes.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const check = sql.slice(
    sql.indexOf("no_demo_reason in ("),
    sql.indexOf(")),", sql.indexOf("no_demo_reason in (")),
  );
  expect([...check.matchAll(/'([a-z_]+)'/g)].map(m => m[1])).toEqual(keys);
  for (const k of keys) expect(reasonLabel(k)).not.toBe(k);
  expect(reasonLabel("none")).toBe("No reason yet");
});
