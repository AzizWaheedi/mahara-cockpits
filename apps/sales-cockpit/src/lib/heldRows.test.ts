import { describe, expect, test } from "bun:test";
import { keepOpenRow, orderDays, withHeld } from "./heldRows";

const row = (id: string, start: string | null) => ({
  appointment_id: id,
  start_at: start,
});

describe("keepOpenRow (Today)", () => {
  const a = row("a", "2026-10-11T10:00:00Z");
  const b = row("b", "2026-10-11T12:00:00Z");
  const c = row("c", "2026-10-11T14:00:00Z");

  test("no panel, or a panel of the other list: the read as it is", () => {
    expect(keepOpenRow([a, c], null, "owed", true)).toEqual([a, c]);
    expect(
      keepOpenRow([a, c], { id: "b", from: "coming", row: b }, "owed", true),
    ).toEqual([a, c]);
  });

  test("a row still in the read is not added twice", () => {
    const fresh = row("b", "2026-10-12T09:00:00Z");
    const out = keepOpenRow(
      [c, fresh, a],
      { id: "b", from: "owed", row: b },
      "owed",
      true,
    );
    expect(out).toEqual([c, fresh, a]);
  });

  test("marked missed and gone from the owed read: back in its place, newest first", () => {
    const out = keepOpenRow(
      [c, a],
      { id: "b", from: "owed", row: b },
      "owed",
      true,
    );
    expect(out.map(r => r.appointment_id)).toEqual(["c", "b", "a"]);
  });

  test("moved past the 36 hours: kept in Coming up, soonest first", () => {
    const out = keepOpenRow(
      [a, c],
      { id: "b", from: "coming", row: b },
      "coming",
      false,
    );
    expect(out.map(r => r.appointment_id)).toEqual(["a", "b", "c"]);
  });
});

describe("withHeld (the Calendar)", () => {
  const a = row("a", "2026-10-11T10:00:00Z");
  const b = row("b", "2026-10-11T12:00:00Z");

  test("nothing held, or every held row still read: the same list", () => {
    const rows = [a, b];
    expect(withHeld(rows, {})).toBe(rows);
    expect(withHeld(rows, { b: { row: b } })).toBe(rows);
  });

  test("a held row the read dropped comes back at the end", () => {
    expect(withHeld([a], { b: { row: b } }).map(r => r.appointment_id)).toEqual(
      ["a", "b"],
    );
  });
});

describe("orderDays", () => {
  test("oldest first for Upcoming, newest first for Past and Owed, no time last", () => {
    const keys = ["2026-10-12", "", "2026-10-11", "2026-10-14"];
    expect(orderDays(keys, false)).toEqual([
      "2026-10-11",
      "2026-10-12",
      "2026-10-14",
      "",
    ]);
    expect(orderDays(keys, true)).toEqual([
      "2026-10-14",
      "2026-10-12",
      "2026-10-11",
      "",
    ]);
  });
});
