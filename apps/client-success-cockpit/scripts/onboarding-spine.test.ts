import { expect, test } from "bun:test";
import { spineFor } from "../src/lib/csmOnboardingSpine";
import { cadence } from "../src/lib/csmTemplates";

test("on launch day the spine says the ads are live, not 'we go live tomorrow'", () => {
  const { dayIndex, day } = spineFor({ liveDays: 0, signupDays: null });
  expect(dayIndex).toBe(8);
  expect(day?.en).toContain("your ads are live");
});

test("missed days start after the last contact day, not on it", () => {
  // Signed up 10 days ago, last message 3 days ago (day 7): days 8 and 9 fell through.
  const { missed } = spineFor({ signupDays: 10, silentDays: 3 });
  expect(missed.map(s => s.day)).toEqual([8, 9]);
});

test("long silence still names at most the last five days", () => {
  const { missed } = spineFor({ signupDays: 12, silentDays: 9 });
  expect(missed.map(s => s.day).every(d => d >= 7 && d < 12)).toBe(true);
});

test("a message is due on the cadence day and late only after it", () => {
  const base = { bucket: "active", liveDays: 40, callDays: 0 } as never;
  const due = cadence({ ...(base as object), silentDays: 3 } as never);
  expect([due.messageDue, due.messageOverdue, due.daysLate]).toEqual([true, false, 0]);
  const late = cadence({ ...(base as object), silentDays: 4 } as never);
  expect([late.messageDue, late.messageOverdue, late.daysLate]).toEqual([true, true, 1]);
});
