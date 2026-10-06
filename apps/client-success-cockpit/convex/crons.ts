import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The billing ledger behind Projections (cash actuals and "paid so far"),
// read from Supabase. Freshness: billingFeed.okAt, and failures in a row
// (the smoke check fails at six).
crons.interval(
  "projections billing ledger",
  { minutes: 30 },
  internal.projections.refreshBilling,
  {},
);

export default crons;
