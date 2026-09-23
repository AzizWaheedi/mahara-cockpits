import assert from "node:assert/strict";
import { test } from "node:test";
import { compareChange, shiftDay } from "../convex/changeResultsCore.ts";

const event = { id: "one", at: Date.parse("2026-09-10T10:00:00Z") };
const rows = [-3, -2, -1, 1, 2, 3].map(offset => ({
  date: shiftDay("2026-09-10", offset),
  spend: 100,
  leads: 5,
}));
const now = Date.parse("2026-09-15T10:00:00Z");

test("uses complete days either side and labels only observed results", () => {
  const result = compareChange(event, [event], rows, [], now);
  assert.equal(result.state, "observed");
  assert.equal(result.before.from, "2026-09-07");
  assert.equal(result.before.to, "2026-09-09");
  assert.equal(result.after.from, "2026-09-11");
  assert.equal(result.after.to, "2026-09-13");
  assert.equal(result.before.cpl, 20);
  assert.equal(result.after.attributedBookings, 0);
});

test("does not call a result while the after days or feed are incomplete", () => {
  assert.equal(
    compareChange(event, [event], rows, [], Date.parse("2026-09-13T10:00:00Z"))
      .state,
    "too_early",
  );
  assert.equal(
    compareChange(event, [event], rows.slice(0, -1), [], now).state,
    "too_early",
  );
});

test("overlapping edits and thin data are inconclusive", () => {
  const other = { id: "two", at: Date.parse("2026-09-12T10:00:00Z") };
  assert.equal(
    compareChange(event, [event, other], rows, [], now).state,
    "inconclusive",
  );
  const thin = rows.map(row => ({ ...row, leads: 1 }));
  assert.equal(
    compareChange(event, [event], thin, [], now).state,
    "inconclusive",
  );
});
