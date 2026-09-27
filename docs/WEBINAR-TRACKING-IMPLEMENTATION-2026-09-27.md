# Webinar tracking implementation checkpoint, 27 September 2026

This is the first implementation slice of [the acceptance contract](WEBINAR-TRACKING-ACCEPTANCE.md). It is not a public funnel release. Existing target editing remains live. No training date, GHL workflow, campaign, contact or appointment was changed; no customer message was sent.

## Installed and verified

- Recovery replay ran under the existing VPS `~/.webinar-pull.lock`: Zoom `--again`, Typeform `--full-backfill`, and reminder receipts. Supabase receipts show success at 07:40:55, 07:40:58 and 07:40:59 UTC. The ordinary 07:23 hourly run had also recovered. Typeform read zero responses against a source total of zero; Zoom returned no available sessions. This is empty-source collection proof, not a real attendance test. The abandoned 26 September run remains in history.
- Three additive Creative Triage migrations install the durable intake, job attempts, provider receipts, private Zoom registrant map, scoped reference store, immutable survey inbox and covering indexes. All nine tables have RLS and deny both browser roles. Intake/claim/binding/survey RPCs deny browser execution. No public policy was added.
- Hosted migration records use provider-generated versions: `webinar_durable_intake` is `20260927110440`; `webinar_intake_review_guards` is `20260927110700`. Git uses the Supabase CLI-generated files prefixed `20260927074120` and `20260927080543`. Match by name and reviewed SQL when inspecting this existing management-tool migration history; do not blindly replay all migrations because versions differ.
- A hosted transaction created only synthetic database rows, accepted and bound an intake, checked the Zoom prerequisite and uncertain-write guard, then rolled back. Final counts: zero intakes, zero jobs, zero events. No external provider operation was part of this test.
- Post-change advisors found one missing covering index on the intake's complete event/revision foreign key. Installed `webinar_intake_revision_index` (Git `20260927081808`, hosted `20260927111858`) and verified its definition. [Advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys). The remaining new-table notices were informational RLS-with-no-policy (intentional service-only access) and unused new indexes. No unrelated database policy or index was changed.

## Built and tested, not deployed

The standalone registration API and an authenticated native-GHL handoff now accept the same durable receipt contract. Public input cannot supply a trusted contact/location ID. The public path returns HTTP 202 only after its receipt and job commit; it does not report a completed booking. Original registration time survives receipt retries and duplicate registrations. GHL submissions require their real receipt ID and submission time.

The worker has bounded leases, attempt history, backoff, exact scope checks and one durable intent before each external mutation. A failed appointment lookup never permits a booking. A lost mutation response or expired lease after mutation becomes `uncertain`, excluded from automatic claiming. Conflicting email/phone contacts are held; same-identity uncertain work blocks another creation. Training bookings wait for the unique Zoom registration receipt. A stored schedule revision change holds old queued work for review.

HighLevel and Zoom adapters are implemented with timeouts, pagination/count checks, receipt validation and explicit write switches. Live responses and scopes for these *write* paths have not been accepted yet. Existing read collectors do not prove write access. Zoom recurring meetings are deliberately held until an occurrence-specific path is supported. Provider confirmation emails must be off before the worker creates a Zoom registrant. `toNotify:false` on GHL is not a promise that existing workflows cannot send messages; workflow review still gates dispatch.

Typeform intake requires HMAC-SHA256 over bounded raw bytes, exact form `P1xP4r24`, response ID and submission time. Replays deduplicate. Unmatched responses remain in the inbox; neither email nor a displayed name silently assigns them. The scoped reference is evidence that a personalized link was used, not proof that its recipient answered. Issuing and delivering these references and projecting responses into the existing survey report remain open.

Collection health reads source timestamps, unfinished runs, pagination counts, queue backlog and unmatched surveys. The existing outside watchdog is wired in source to this direct check, independently of the CEO page refresh. Warnings use two hourly windows for Zoom/Typeform, two six-hour windows for normal reminder polling, and hourly reminder windows near an event recorded in the ledger. Fifteen-minute job/run delays and uncertain writes need attention. Optional objection transcripts are excluded from core collection alerts because that stream is held by policy. This watchdog/UI code has not shipped and alert routing has not been tested in this checkpoint.

## Validation

- 80 targeted Bun/PostgreSQL tests, 264 assertions: previous attendance/retention/targets/privacy tests plus eight durable-intake and five collection-health tests.
- 18 Node API/worker tests: bad/missing signatures, wrong form/location, body size, durable acknowledgement, private-error redaction, contact ambiguity, failed duplicate lookup, uncertain writes, provider settings and pagination.
- 11 canonical schedule tests. 109 tests total across these suites.
- Full TypeScript/Vite/PWA production build and shared-file parity pass. Convex local type generation was refreshed after syncing current main; no `convex deploy` or ship command ran. Build has existing bundle-size/vendor annotation warnings.
- Worker with no enable flag returns `held` without accessing storage or providers.
- No new authenticated browser acceptance or physical-device test was performed. The API and source-health UI are not released.

## Remaining work in order

1. Provision the existing API/worker server secrets through approved provider/private storage, wire actual W1 form receipt fields, and declare the Typeform hidden reference. Do not paste keys into chat or put them in Git.
2. Finish schedule-to-ledger preparation, scoped join/survey/booking link issuing and delivery, safe operational reconciliation of uncertain jobs, reschedule handling and the final confirmation experience. Registration and dispatch switches remain off until these work together.
3. Replace legacy tag/month dashboard cohorts with the receipt/event ledger and exact meeting-instance bindings. The current production dashboard still uses legacy cohort logic. Unique Zoom registrant storage is implemented; live join/rejoin matching is not yet accepted.
4. Connect event-scoped reminder receipts, pitch bookings, verified transactions/refunds and supported Kit reports. Kit account coverage has not been verified; do not rely on planned open/click webhook events.
5. Prove the controlled real journey, source totals, watchdog routing, independent capacity monitoring and isolated restore. Restore is waiting for the location of a usable private database connection secret. Do not clone active production jobs to manufacture a restore test.
6. Supply the final date and explicit launch instruction, then run the existing schedule/release gates. The API remains a separate deployment from `scripts/ship.sh media-buyer`.

Concurrent infrastructure update: [Hermes's 08:05 shared handoff](https://github.com/AzizWaheedi/mahara-context/blob/main/shared/sessions/2026-09-27T080500Z-hermes-portal-reliability-monitor.md) reports the VPS portal monitor, Cloudflare dead-man check, business-database disk/WAL metrics and owner alert drills installed. Reuse that monitoring instead of duplicating it. This turn did not independently repeat those drills; webinar-specific source/queue alert acceptance and restore remain open.

Keep [PR26](https://github.com/AzizWaheedi/mahara-cockpits/pull/26) a draft until the remaining integration work intended for that release is complete. This checkpoint is useful infrastructure, not a claim that every item in the acceptance contract is done.
