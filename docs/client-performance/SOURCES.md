# Client performance sources

The historical audit contained client-specific operational and financial information and is no longer included in the public tree. Client records belong in authorized private systems. Earlier Git revisions may still contain the original record.

## Implementation references

- Client Success performance reads: `apps/client-success-cockpit/src/lib/performance.ts`.
- Client Success screen: `apps/client-success-cockpit/src/pages/ClientPerformancePage.tsx`.
- Media Buyer performance screen: `apps/media-buyer-cockpit/src/pages/performance/PerformancePage.tsx`.
- Metric and period behavior: `apps/client-success-cockpit/scripts/performance-numbers.test.ts` and `apps/client-success-cockpit/scripts/performance-period-native.test.ts`.

Check the current implementation and tests before relying on a definition. The removed historical audit is not a live data source.

## Metric guidance retained from the historical audit

- Aggregate a period's cost per booking as the eligible spend for the period divided by its counted bookings, using aligned dates. Do not average daily ratios. A missing source or a zero denominator needs its own display state.
- Show rate uses attended appointments divided by attended plus marked no-shows. Unmarked appointments are not no-shows.
- Lead-to-booking comparisons depend on the lead and booking sources, date alignment and which rows are eligible. Check the current implementation before comparing a displayed value with a different report.
- A missing source is unknown, not zero. The current period tests describe how the screens handle absent ad data.

## Fields to reconcile

The performance screens combine several types of information. A source can be missing or arrive later than another, so show its freshness and avoid inferring a value that was not returned.

- Client identity, status, service mode and the account-to-client link come before any per-client aggregation.
- Advertising measures include spend and currency, budget, impressions, reach, frequency, clicks, leads, landing-page visits and video metrics. Check each field's source and date range. Reach is not safely summed across overlapping periods.
- Customer journey measures include CRM leads, confirmed and provisional bookings, meetings due, outcomes, quotations, closes and revenue. Keep unmarked outcomes separate from no-shows, and do not conflate a quotation with a close.
- Call-centre measures include calls, leads reached and first-call timing. Check the exact denominator, time window and caller assignment in the current implementation.
- Costs per lead or booking require a known numerator and a nonzero denominator for the same period. Currency conversion and account boundaries should remain explicit.
- Source freshness and the reporting timezone affect every comparison. Check both before interpreting a sudden change.

These are review prompts, not a replacement for the current field-level implementation and tests linked above.
