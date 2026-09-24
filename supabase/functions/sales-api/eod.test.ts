// bun test supabase/functions/sales-api/eod.test.ts
import { describe, expect, test } from "bun:test";
import { EOD_FIELDS, eodColumns, eodDay, eodMessage, eodValue, sheetStamp } from "./lib.ts";

describe("the day an EOD is for", () => {
  test("the evening is that day, in Kuwait", () => {
    expect(eodDay(Date.parse("2026-09-24T16:30:00Z"))).toBe("2026-09-24");
  });
  test("before 04:00 it is still the day before (the sheet's 00:37 row)", () => {
    expect(eodDay(Date.parse("2026-08-26T21:37:57Z"))).toBe("2026-08-26");
  });
  test("a Friday filing is Thursday's", () => {
    expect(eodDay(Date.parse("2026-09-25T15:00:00Z"))).toBe("2026-09-24");
  });
});

test("the sheet's own stamp: Kuwait time, the hour unpadded", () => {
  expect(sheetStamp(Date.parse("2026-08-26T21:37:57Z"))).toBe("2026-08-27 0:37:57");
  expect(sheetStamp(Date.parse("2026-09-05T16:44:57Z"))).toBe("2026-09-05 19:44:57");
});

describe("answers", () => {
  test("counts, dollars and minutes as typed", () => {
    expect(eodValue("count", "12")).toEqual({ ok: true, value: 12 });
    expect(eodValue("money", "$1,500.5")).toEqual({ ok: true, value: 1500.5 });
    expect(eodValue("minutes", "45 min")).toEqual({ ok: true, value: 45 });
    expect(eodValue("count", "")).toEqual({ ok: true, value: null });
  });
  test("a count is whole and nothing is negative", () => {
    expect(eodValue("count", "2.5").ok).toBe(false);
    expect(eodValue("money", "-5").ok).toBe(false);
    expect(eodValue("count", "lots").ok).toBe(false);
  });
});

describe("what goes out", () => {
  const answers = { dials: 40, contact_made: 18, talk_time: "13-25 min", cash: 1500, objections: "Price", summary: "Good day" };
  test("the Slack text carries the name and the Submitted by line", () => {
    const text = eodMessage("setter", "Tahrir Abadi", "U123", "2026-09-24", answers);
    expect(text).toContain("*Name - Tahrir Abadi*");
    expect(text).toContain("Submitted by: <@U123>");
    expect(text).toContain("Dials - 40");
    expect(text).toContain("Talk time - 13-25 min");
    expect(text).toContain("Cash collected on your sets ($) - $1,500");
    expect(text).toContain("Intro calls scheduled - --");
  });
  test("with no Slack id the line says so instead of mentioning nobody", () => {
    expect(eodMessage("closer", "A", null, "2026-09-24", {})).toContain("Submitted by: A (no Slack id");
  });
  test("the row is named columns, the sheet's own column names", () => {
    const row = eodColumns("setter", "Tahrir", "2026-09-24", Date.parse("2026-09-24T16:00:00Z"), "cockpit-1", answers);
    expect(row["Submitted At"]).toBe("2026-09-24 19:00:00");
    expect(row["Date For"]).toBe("2026-09-24");
    expect(row.Dials).toBe(40);
    expect(row["Talk Time"]).toBe("13-25 min");
    expect(row["Intro Calls Scheduled"]).toBe("");
    expect(row["Cash Collected (Sets) $"]).toBe(1500);
  });
  test("every field has a column in its tab", () => {
    for (const role of ["setter", "closer"] as const)
      expect(new Set(EOD_FIELDS[role].map(f => f.column)).size).toBe(EOD_FIELDS[role].length);
  });
});
