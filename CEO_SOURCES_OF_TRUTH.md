# CEO sources of truth

The historical audit contained client-specific operational information and is no longer included in the public tree. Client records belong in authorized private systems. Earlier Git revisions may still contain the original record.

## Current implementation references

- Billing rows, grouping and summary: `supabase/functions/cockpit-ceo-api/finance/billing.ts`.
- Pending payment calculations: `apps/media-buyer-cockpit/src/lib/billingBalances.ts` and `apps/client-success-cockpit/src/lib/billingBalances.ts`.
- Read and write behavior should be checked in the relevant current code, tests and runbooks before an operational decision. Historical snapshots do not establish current client state.

## Review principles

- A dated snapshot explains what was observed at the time; it does not establish current client status or current account balances.
- Check the origin and reporting period of each number before comparing totals from different systems.
- Keep source uncertainty visible and use the current implementation and tests for calculation behavior.

## Domains to check

- Marketing and sales: compare the same reporting window, lead definitions and booking outcomes before reconciling funnel totals.
- Client delivery and advertising: identify the ad account, currency, source and reporting window for each measure.
- Calling: distinguish attempted calls, reached contacts and appointment outcomes.
- Client success: verify the client record and lifecycle status before using churn, pause or onboarding counts.
- Money: separate contracted revenue, payments received, amounts outstanding and operating costs. A pending amount is not cash received.
- Data health: check source freshness and missing inputs before treating an empty result as zero.

## Unit-economics review

Use a consistent period and population when reviewing acquisition cost, gross profit, lifetime value, churn, extensions and margin. Record assumptions alongside the figures. Definitions and decisions can change, so use the current code and agreed policy rather than treating an old calculation as authoritative.
