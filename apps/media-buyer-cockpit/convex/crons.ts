import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * The cockpit refreshes itself before she opens it.
 *
 * 03:30 UTC is 06:30 in Kuwait — an hour before the working day, Saturday to
 * Thursday. Without this she would open the screen to whatever the last manual
 * sync left behind and make budget decisions on stale numbers.
 */
const crons = cronJobs();

crons.cron(
  "refresh the board before the working day",
  "30 3 * * 0-4,6",
  internal.sync.runSync,
  {},
);

/**
 * Re-mine every ad account into the "What works" playbook once a week. Friday
 * is the quiet day, and the Saturday 06:30 sync then archives the winners.
 */
crons.cron(
  "collect market plays for the playbook",
  "0 2 * * 5",
  internal.marketCollect.collectPlays,
  {},
);

export default crons;
