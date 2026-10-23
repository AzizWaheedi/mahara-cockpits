/**
 * The board's Bookings column says what it leaves out (R4, the cost per
 * booking build of 22 Oct 2026). Since 20261021l the board drops the call
 * centre's call-back bookings and a reschedule whose original still counts
 * (D0b), as the media sync does since release 033b93a7; the help text named
 * only cancelled, invalid and Google Calendar copies. Read from the source:
 * boardColumns.ts reaches the signed-in client through its imports.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("the Bookings help names every booking the board leaves out", () => {
  const columns = readFileSync(
    join(import.meta.dir, "..", "src/lib/boardColumns.ts"),
    "utf8",
  );
  const block = columns.slice(
    columns.indexOf('key: "confirmedBookings"'),
    columns.indexOf('key: "leadToBooking"'),
  );
  expect(block).toContain(
    `how: "Main and online calendar bookings made on these days. Cancelled, invalid, Google Calendar copies, the call centre's call-back bookings and rescheduled bookings whose original still counts are left out.",`,
  );
  expect(block).not.toMatch(/—/);
});
