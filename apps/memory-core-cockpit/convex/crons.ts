import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * One daily sync, early in the Kuwait morning (04:00 UTC is 07:00 in Kuwait),
 * so the memory core has the newest mail and pages before Aziz opens it.
 *
 * It is a sync, never a delete: a run that finds nothing changes nothing. The
 * Sources screen always shows when the last run happened, so a cron that stops
 * firing is visible as a stale row rather than as silence.
 */
const crons = cronJobs();

crons.daily(
  "sync the connected sources",
  { hourUTC: 4, minuteUTC: 0 },
  internal.sync.dailySync,
  {},
);

export default crons;
