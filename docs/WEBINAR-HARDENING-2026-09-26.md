# Webinar hardening checkpoint, 26 September 2026

## Verified production database changes

Creative Triage only (`bldgtotkfmhoxmlzowdx`); B2B remains read-only.

- Applied `restrict_reporting_view_access`: six internal views no longer grant browser reads. Service reads and the token-protected client panel still work; invalid panel tokens fail. See the earlier audit for the dependency review.
- Applied `webinar_target_versions`: versioned CEO targets, RLS, service-only audited save with conflicts and retry deduplication. No live target values changed.
- Applied `webinar_atomic_snapshots`: transactional per-Zoom-instance ingestion, append-only snapshot receipts, older-run rejection, identical retry handling, and independent attendance/chat/poll/Q&A coverage. The migration preserves any pre-existing projection as a legacy snapshot before replacement. It does not alter the current worker.
- Applied `webinar_occurrence_ledger_v1`: stable planned events, immutable schedule revisions (date may remain unknown), frozen initial targets, registrations unique per event/location/contact, provider-receipt deduplication, exact Zoom-instance binding records. Browser reads and execution denied; service access verified.
- Live service-role snapshot smoke passed inside a rolled-back transaction: receipt saved and missing channels remained incomplete. No synthetic test rows retained.
- Before migrations: zero Zoom sessions, attendance rows and engagement rows. There is no real-session retention acceptance yet.

## Code ready for release

- Missing leave times are never filled with the session end. Invalid intervals are excluded and flagged; watch/retention rates stay unknown when timestamps are incomplete.
- Exact-second peak and pitch presence, independent source coverage, unknown chat identities excluded from distinct-person counts, staff/private poll/Q&A exclusions.
- Retention checkpoints show both share of peak and share of the starting group remaining. Watch bands count people with at least 25/50/75/90% joined time. Chart truncation is explicit for sessions over five hours; calculations retain full intervals.
- Guest identity uses the session's provider participant ID, not display name. Name-based chat associations require a single candidate. Full international phone matching and duplicate-email/phone rejection replace last-eight-digit/last-wins matching.
- Worker: bounded transient retries only for reads/idempotent operations; explicit failures for missing/repeated/capped pages; Zoom source-count checks; Typeform count checks and `--full-backfill`; failed prerequisites cannot report a successful empty dependent run. Recent completed Zoom instances replay for seven days. Old chat errors never become successful zeros merely because 48 hours passed.
- Snapshot save is one RPC rather than writing a completed parent before child rows. Missing Zoom meeting end stays unknown rather than using the last guest leaving as the end.

## What is NOT complete

The occurrence ledger is an installed foundation. The external registration API has NOT been rewired to it, the dashboard still uses legacy contact-based cohorts, and no old registration history was invented from mutable tags. Do not advertise repeat-event attribution as finished.

Registration API source is readable in Vercel: project `webby-live-training`, production deployment `Arg8EB9DEr24CinmYJ9PhL3pk6Fk` from 8 September, no connected Git repository. Its handler currently upserts GHL contacts and books the webinar calendar. Recover and review the complete deployed source into Git before modifying it; preserve existing behavior and introduce durable provider receipts/outbox reconciliation before changing the cohort adapter.

VPS SSH to the documented `hermes@187.77.156.166` timed out twice during banner exchange. No worker files or cron changed. Restore access, compare remote files with the intended revision, preserve any concurrent work, install the two additive database migrations first (already installed), then replace only the reviewed worker under the existing process lock. Run `doctor`, `zoom --again`, `survey --full-backfill`, and reconcile source counts before accepting recovery. The transcript-provider hold remains in force.

Supabase dashboard login expired; backup inventory and isolated restore remain unverified. Never restore production to test recovery. Choose/approve any paid isolated restore resource before provisioning. Provider backup availability is not equivalent to a successful restore drill.

The next public date remains Aziz's choice. His own saved test email and WhatsApp ending 4963 are authorized for isolated testing; this checkpoint sent no messages, changed no public date and activated no workflows. A real joined/rejoined Zoom occurrence, identity-linked survey/booking, verified payment/refund receipts, and production CEO target save/reload remain required.

## Validation

- 67 targeted TypeScript/embedded-Postgres tests, 211 assertions pass.
- 47 Python collector tests pass, including transient read retry, no automatic unsafe POST retry, repeated cursors, source-count mismatch, incomplete Typeform replay, same-name guests, and old chat-error behavior.
- Full TypeScript/Vite/PWA build passes; shared-file checks pass.
- Synthetic dashboard retention table renders with the expected cohort values; mobile 390px has no page overflow or browser errors. This is not a physical-device or authenticated production test.

## Release / rollback

Ship the cockpit only from reviewed GitHub main using `SHIP_SMOKE_READ_ONLY=1 scripts/ship.sh media-buyer`; verify actual served SHA and authenticated source/data behavior. The additive migrations can remain installed if application deployment must roll back. Do not restore anonymous grants to resolve an unrelated outage. Snapshot receipts preserve previous projected source data; a restoration requires an explicit reviewed selection and a newer audited ingestion receipt, never an in-place edit of history.
