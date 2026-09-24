import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Thursdays at 08:17 Kuwait. Per-client auto planning is off until enabled in the cockpit.
crons.cron(
  "prepare approved creative runway",
  "17 5 * * 4",
  internal.creativeCadence.autoPlanDue,
);

export default crons;
