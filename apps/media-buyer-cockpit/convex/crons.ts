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

/**
 * Aziz, 2026-09-09: everything refreshes every 15 minutes. The full sync runs
 * on the quarter hour through the Kuwait working day (06:00 to 22:00, which is
 * 03:00 to 19:00 UTC) and hourly overnight. Each run ends by feeding the other
 * two cockpits, so they refresh on the same clock. Convex never overlaps runs
 * of the same cron: a slow sync delays the next tick, it does not pile up.
 */
crons.cron(
  "refresh every 10 minutes through the working day",
  "*/10 3-18 * * *",
  internal.sync.runSync,
  {},
);
crons.cron(
  "refresh hourly overnight",
  "0 19-23,0-2 * * *",
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
/** Writes queued in the other two cockpits reach ClickUp within minutes. */
crons.interval(
  "drain the other cockpits' outboxes",
  // Every minute since 2026-09-12: WhatsApp replies sent from the cockpits
  // should leave within a minute, not five.
  { minutes: 1 },
  internal.outboxDrains.drainAll,
  {},
);

/**
 * The board's CPL / bookings / last-updated columns used to refresh only when
 * a decision was logged. Hourly through the working day keeps the board true
 * for whoever reads it in ClickUp. [2026-09-10]
 */
crons.cron(
  "write the board's KPI columns",
  "5 3-18 * * *",
  internal.writeback.pushMetrics,
  {},
);

/** Tracking audit (url_tags, lead forms) once a day; it had no schedule. */
crons.cron("audit ad tracking", "30 2 * * *", internal.tracking.audit, {});

/** The three cockpits' main screens, checked like a browser would, every 15 minutes. */
crons.cron(
  "smoke-check every screen",
  "7,22,37,52 * * * *",
  internal.smoke.check,
  {},
);

/** Client reports the CSM asked for become Google Docs within a few minutes. */
crons.interval(
  "write requested client reports",
  { minutes: 3 },
  internal.reportDocs.drain,
  {},
);

/** The chat with Hermes in every cockpit: questions out, answers back, every 20 seconds. */
crons.interval(
  "relay the Hermes chat",
  { seconds: 20 },
  internal.hermesDrain.run,
  {},
);

export default crons;
