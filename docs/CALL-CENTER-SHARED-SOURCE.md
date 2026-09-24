# Shared call center scorecard

The CEO Calls view consumes `public.mahara_call_center_report` v1 in Creative Triage, the same report contract used by the power dialer. The source function and event view are maintained in `AzizWaheedi/mahara-power-dialer`; the cockpit does not join raw calls to leads or implement another working-hours clock.

## Reader and interface

- The prepared CEO section makes two bounded requests per normal 15-minute refresh: 30 days and 7 days. Additive call counts populate existing overview cards. Period distinct-lead counts, rates, average speed and true medians are read verbatim.
- The Calls scorecard provides a common date range, Overall / Per caller / Per client / Day by day views, searchable sortable comparison tables, and calling versus bookings/outcomes column groups. Custom ranges are requested through a CEO-authorized action and limited to 93 inclusive Kuwait dates. It preserves the prior report and its original dates on failure.
- Layout follows the existing Geist/teal CEO kit: date controls first, a quiet comparison table, and a paired confirmed/provisional booking panel. There is no additional global working-hours editor; the button opens Team & Payroll.
- `convex/ceo/callCenterContract.ts` validates the version, dates, identity dimensions and metric values. A missing field fails visibly rather than becoming zero. `callCenterSource.ts` uses the existing instrumented service-role transport; the browser never receives the key.
- `cockpit_metric_values` remains an existing downstream projection, with exact report window bounds, caller email scopes and location scopes. It is not the canonical calculator. Legacy payloads with earlier definitions are not republished as the new definitions.

## Meaning

Dials are saved dispositions with notes; actual calls, connections, talk time, gaps and first-dial speed require provider evidence. The two-minute share includes all new leads; averages and medians include only measurable samples. The first actual caller supplies the lead's caller attribution and working-hours schedule; untouched or ambiguous leads remain unassigned/unverified.

Confirmed bookings are main plus online calendars; provisional bookings are separate. Both use booking creation date and exclude replacement reschedules. Unknown calendars remain outside those two totals. Client-sheet outcomes supply shows, no-shows and closes; show rate uses recorded outcomes and close rate uses shown appointments. Project values keep their currencies. Unknown-currency values may appear within a single client's total; the source withholds them when multiple clients would be combined and reports the limitation.

Delivery remains a separate appointment-date cohort. Mahara's own B2B sales project and its metrics are unchanged. The global `cockpit_settings.working_hours` editor no longer drives the call center report. Current Team & Payroll schedules apply historically until effective-dated schedules and recorded breaks exist.

## Validation and release gates

Run:

```sh
cd apps/media-buyer-cockpit
bun test scripts/call-center-contract.test.ts scripts/schedule.test.ts scripts/working-hours.test.ts scripts/delivery-rates.test.ts
bun run build
```

Contract tests cover missing data versus zero, invalid/wide ranges, rate/median preservation, stable caller/location identity, separate booking categories, currency preservation, additive overview mapping, and legacy-definition rejection. The code must be checked against an actual aggregate RPC response after the source migration. No raw lead data is needed in test fixtures.

Production requires the source RPC, grants, aggregate parity verification, and the normal `SHIP_SMOKE_READ_ONLY=1 scripts/ship.sh media-buyer` process after publishing the reviewed source. Local tests or this document alone do not establish deployment, live data parity or authenticated visual acceptance.

## Local verification, 24 September 2026

The focused contract, schedule, clock and Delivery regression suite passed locally (75 tests). The complete Vite/TypeScript production build passed. A fictional-data browser harness passed at 1280px and 390px in dark/light themes: no document overflow, no browser errors or Vite overlay, separate booking columns, client search, and preserving the original report dates/rows after a deliberately mismatched-range response. Screenshots remain local under `/private/tmp/mahara-scorecard-cockpit-*.png`; no live client captures are committed.

A read-only transaction on Creative Triage called the live RPC as `service_role` for 18–24 September. It returned version 1, the expected source, exact Kuwait dates, and valid required metric fields across the overall row, five caller rows, sixteen client rows and seven daily rows. SQL checked every dimension row without exporting identities; the cockpit validator also accepted the returned overall DTO and retained optional reconciliation metadata. Privilege inspection confirmed that `anon` and `authenticated` cannot execute either report/backfill RPC or select the event view, while `service_role` can. The event view is `security_invoker=true` and the RPC is not security definer.

This establishes live contract and authorization compatibility, not independent verification of every upstream record. The snapshot still identified ambiguous calls, which remain unassigned rather than being guessed. No calls, messages, appointment changes or source CRM writes were made. These checks do not establish cockpit deployment or authenticated production UI acceptance.

## Coordinated release sequence

1. Publish the reviewed dialer migration and canonical source first. Verify the report RPC/grants and a bounded aggregate read; keep unknown identities, source warnings and missing values explicit. The historical detail worker is a separate paced, resumable provider-read job and must not reset recent-import watermarks.
2. Fetch the latest cockpit `origin/main`, preserve concurrent changes, and publish the reviewed consumer commit only after resolving any overlap. The production shipping script requires a clean checkout whose app source is already on GitHub main.
3. Re-run the focused tests and build above. From the repository root run `SHIP_SMOKE_READ_ONLY=1 scripts/ship.sh media-buyer`. This deploys the existing Convex backend and Vercel app through the normal checks. Keep the read-only smoke flag; the default smoke path may send a failure alert.
4. In an authenticated CEO session at `https://cockpit.maharamedia.com`, open Calls. Confirm the report's original range, source time and warnings, compare the same range against the dialer, and verify caller/client/day views, date changes, failed-refresh retention, and Team & Payroll navigation. Confirm B2B and Delivery still show their separately labelled cohorts. Do not test by placing calls or changing appointments.
5. Record the source commit, hosted deployment, aggregate comparison and any remaining data-coverage gaps in shared Mahara context. A successful build is not a substitute for this hosted acceptance.

The consumer reuses the existing service-role connection and 15-minute section refresh. It adds no subscription, independent metrics database, extra recurring schedule or change to the paused local reliability automation. Before release, rollback remains the previous cockpit deployment; a consumer failure must retain the last successful report with its original timestamp instead of substituting zeroes or legacy definitions.
