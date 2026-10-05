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

// Each client's onboarding links and forms (ClickUp card + Typeform) into
// Supabase cockpit_client_onboarding. Freshness and failures: the newest
// row of cockpit_client_onboarding_runs, which the Clients screen shows.
crons.interval(
  "onboarding links and forms",
  { minutes: 10 },
  internal.onboarding.syncAll,
  {},
);

export default crons;
