# Webinar data reliability and editable targets, 26 September 2026

Implementation and production database hardening, not full production acceptance. Supersedes the target-settings portion of the 25 September checkpoint. PR #21 remains open; no application ship, VPS replacement, workflow activation or messages in this checkpoint.

## Live hardening checkpoint

Aziz authorized the reliability work on 26 September. Applied `restrict_reporting_view_access` to Creative Triage: all six listed views deny both anonymous and authenticated direct SELECT while service-role reads remain available. Reviewed database dependencies first: token-gated `panel_data` retains owner access, backend pulse functions retain service access. In a rolled-back transaction, an actual existing panel token still returned a client projection and an invalid token returned `not found`; no token or personal rows were printed. The isolated PostgreSQL regression covers 22 access assertions.

Applied `webinar_target_versions` too. Verified RLS enabled, browser SELECT denied and service INSERT granted. No target values were changed; the editor application still needs release. The descriptions below retain the original audit findings for context, superseded by this checkpoint where stated.

The next training date is intentionally undecided and editable. Aziz approved his own existing email and test WhatsApp recipient for isolated acceptance; do not invent a public date or activate client messaging. External API source access, VPS connectivity and real-event acceptance remain open.

## Current evidence

- Production Creative Triage `cockpit_sections.webinar` computed at 10:35:50 Kuwait on 26 September: `ok=true`, zero rounds, no `readiness` field. The reporting PR is not deployed.
- All eight existing `cockpit_webinar_*` tables have RLS enabled; `anon` and `authenticated` lack SELECT. Attendance/engagement have session foreign keys and deduplication constraints; the remaining tables use primary keys. These controls already exist.
- Latest successful pulls around 10:23 Kuwait: Zoom, Typeform, reminders and objections. One Typeform HTTP 502 and one temporary Supabase connection failure occurred in the last 24 hours and were followed by successes. A later successful request is not an independent reconciliation of all source records.
- Today's audit did not recheck the 25 September workflow/date/registration settings. The old blocker list remains dated evidence, not a fresh claim.

## Urgent shared-database permissions issue

The Supabase security advisor reports nine owner-privileged views. Six grant SELECT to `anon`: `recent_sync_calls`, `recent_cron_runs`, `v_panel_spend`, `v_panel_appointments`, `v_panel_leads`, and `media_buyer_changes`. Their definitions do not restrict rows to the signed-in caller.

A transaction with `SET LOCAL ROLE anon` successfully evaluated `EXISTS(...)` for the lead, appointment, spend and ad-change views; all returned true. This proves database-role access to existing rows. Only booleans were retrieved, no personal records or log contents. The transaction rolled back. External HTTP exposure was not separately probed.

Before release, map current consumers, restrict these views to the actual authorized backend or replace them with invoker views plus appropriate base-table RLS, then verify anonymous and unrelated-account denials and permitted workflows. Do not blindly revoke every function: several protected RPCs intentionally execute with owner privileges and enforce their own identity checks.

Other advisor findings: seven mutable function search paths; 17 anonymous-callable and 39 authenticated-callable owner-privileged functions; leaked-password protection disabled. These need focused review, not an assumption that every warning is an exploit. RLS-without-policies on service-only tables is intentional default denial.

References: [view linter](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [function access](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Editable targets built

The CEO webinar view has one Edit targets button and grouped fields for acquisition, conversion, sales and review thresholds. Percentages are entered as 0–100, money as USD. Choose the selected named round or future defaults. Ambiguous `next` / `untagged` buckets cannot receive a persistent round override.

Supabase is the sole target store; the existing Convex authentication/action path is a transitional server bridge, not a second target database. This does not claim the broader direct-Supabase login/jobs migration is complete.

- `cockpit_webinar_target_versions`: append-only setting plus audit receipt, with scope, revision, values, timestamp, server-derived actor and unique request ID. RLS; service-role SELECT/INSERT only; no browser grants or public RPC execute.
- Transaction advisory lock and expected revision prevent stale writes. Reusing the identical request ID safely returns its first committed receipt. A reused ID with a different payload is rejected.
- Exact shapes, numeric units, whole registration counts, percentage bounds and low/plan/high ordering are validated in TypeScript and PostgreSQL. Missing, blank, nonfinite and extra fields cannot masquerade as valid zeros.
- Future defaults apply as of the earliest known registration or spend day. Older rounds and unknown start times retain the original brief baseline unless explicitly overridden. This is conservative inheritance, not a canonical event-history model; a later historical backfill can move that inferred start date, so the event-model work below must ultimately freeze the target revision on each event.
- Per-round saves update the displayed comparisons immediately. The background refresh reconciles other sessions. Failure to enqueue that refresh cannot reverse or conceal a confirmed database save.
- History shows the latest ten revisions with all saved values; all revisions remain in the database. Reload latest is required after a conflict. No automatic ad-budget or workflow changes.
- The local harness uses explicit synthetic, in-memory receipts, reset on page reload. It is not proof of production persistence.

Migration **applied remotely on 26 September**: `supabase/migrations/20260926074942_webinar_target_versions.sql`. Installed in Creative Triage before the application release. B2B remains read-only. No production targets were changed.

## Remaining data work, in order

1. **Close the shared-database access gap.** Verify anonymous/unrelated-user rejection and authorized consumers, with a reviewed rollback plan.
2. **Use stable event and registration identities.** Add a planned webinar event (UTC timestamp, display timezone, date/version history, Zoom instance binding), and a registration occurrence unique by event + CRM location + contact. Preserve repeat registrations; do not infer history from the contact's latest month tag. Attach ad attribution, survey response, reminders, attendance and booking to the occurrence. Quarantine ambiguous records with reasons instead of guessing by name or last eight phone digits.
3. **Make ingestion completeness visible.** Retain source IDs and raw receipt hashes, idempotent upserts, paginated backfills, overlapping watermarks, run counts and replay state. Explicitly fail/flag capped pagination and partial responses. Test 429/502, missing pages, late updates and a multi-day outage; reconcile recovered source counts. The existing Typeform two-day overlap and hourly reruns are useful but not sufficient proof.
4. **Reconcile each funnel step.** Registrations against CRM/API receipts; source spend in its original currency plus explicit FX basis; Zoom attendees vs matched registrations; bookings/held calls vs appointment history; confirmed cash vs payment receipts/refunds. Surface unmatched/excluded counts. Keep reported cash separate from verified cash. Freeze metric definitions and attribution windows by version.
5. **Finish controlled end-to-end acceptance.** Align the next date in Zoom/API/page/calendar, verify registration credential and reminders, then an explicitly authorized test registration, phone join/rejoin, survey, pitch booking, held outcome and payment reconciliation. Require matching provider IDs and dashboard totals, not a green sync badge.
6. **Prove operations and recovery.** Freshness/completeness alerts with a named owner; verify backup policy and restore into an isolated environment; measure required recovery time and acceptable data loss. Backups, physical-device sign-in and production target save/reload are not yet verified.

## Validation and release order

- 54 targeted TypeScript/embedded-Postgres tests pass: webinar regressions, target units/ranges, inherited defaults, RLS/grants, service-role writes, immutable history, stale revisions, retry deduplication, unauthenticated denial and non-founder admin denial.
- Actual migration executed in isolated PGlite PostgreSQL. No production database mutation.
- Full TypeScript/Vite/PWA build passes (existing chunk-size advisory).
- Browser synthetic form: impossible percentage rejected, edit/save/reload retains values, revision history present. Desktop 1440px and phone viewport 390px checked. No physical-device or authenticated production test claimed.

Release: resolve security issue; approve PR/release; apply the one reviewed migration through the migration tool to Creative Triage; verify live grants/RPC; use `SHIP_SMOKE_READ_ONLY=1 scripts/ship.sh media-buyer`; then perform a deliberate CEO target save/reload and denied non-CEO check with agreed values. Keep any campaign activation and messaging separate. The 25 September worker replacement instructions still apply, including the transcript-provider hold.
