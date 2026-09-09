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

/** Anything queued for the assistant that the instant wake-up missed. */
crons.interval(
  "drain the assist queue",
  { minutes: 10 },
  internal.assistWorker.run,
  {},
);

/**
 * Feed the creative director's and client success cockpits. Aziz, 2026-09-07:
 * "have a sync every 15 minutes so nothing breaks and everything updates."
 * Every 30 minutes keeps ClickUp and Sheets well inside their limits; the
 * morning sync also triggers it with the stat sheets included.
 */
crons.interval(
  "feed the other two cockpits",
  { minutes: 30 },
  internal.fanout.runFanout,
  {},
);

export default crons;
