# Personalized webinar journey checkpoint, 27 September 2026

Continuation of the [durable intake implementation](WEBINAR-TRACKING-IMPLEMENTATION-2026-09-27.md) and [acceptance contract](WEBINAR-TRACKING-ACCEPTANCE.md). This closes the personal-link and confirmation implementation slice. It does not release the public funnel or replace the dashboard's legacy cohorts.

## Verified changes

- Typeform survey `P1xP4r24` now declares `webinar_ref`. Read-modify-write preserved all eight question definitions and IDs, the twelve existing hidden fields, ending screens and every original setting. Readback also showed Typeform materialized its `enrichment_in_renderer` default with `toggle:false`; it was not supplied as a new feature. No response was submitted. Raw before/after form snapshots are local verification artifacts, not Git content.
- Additive migration `20260927083946_webinar_personal_links.sql` is installed in Creative Triage. Hosted history names it `webinar_personal_links`, version `20260927115912`. Match migration names and reviewed SQL because the management tool assigns its own version. Do not blindly replay CLI timestamps.
- The new audit table has RLS; both views use `security_invoker=true`. Browser roles cannot select these objects or execute the new functions; service role can. A hosted draft preparation and unknown-reference assertion ran inside a transaction and rolled back. Remaining events, intakes and links: zero. No provider operation is involved in this smoke test.
- Advisors returned only the expected informational service-only RLS/no-policy notice and an unused new index among this slice's objects. [RLS notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Do not add public policies to silence this notice.
- Live GHL form-submission API for form `5wC0SkFcgCfFzbpOUBWk` is readable in the exact webinar location. Its 1-27 September window returned zero records and source total zero. This proves the read door and empty pagination metadata, not a real submission payload. The six WEBBY workflows remain draft, verified with the existing exact-name classifier.

## Built and tested, awaiting deployment

`api/status` accepts a random 256-bit browser capability and only stores its SHA-256 hash. It returns limited processing/review/changed/confirmed status, never CRM IDs or private records. The public form scopes idempotency to event and revision, preserves attribution, and rejects a schedule changed between page load and submission. A registration is confirmed only when both Zoom and GHL provider receipts exist for the same revision.

`api/links` is separately authenticated for a future delivery worker. `api/access` resolves only the two accepted purposes: joining the exact Zoom meeting or opening the exact survey. Links use URL fragments on a first-party page, POST the capability, and exclude third-party scripts/referrers. Resolution waits for a deliberate button press. Tokens are deterministic HMACs of registration, revision and purpose; storage holds only hashes. Issuance and revocation are audited. Revoked, expired, unknown, wrong-purpose and stale-revision links fail closed. There is no custom redirect, host URL, pitch-booking destination or message sender in this code.

A link is a bearer capability. Forwarding it can attribute an action to its registration; possession does not prove who answered or attended. The public signup path does not verify email/phone ownership. Do not call it identity verification. No survey answers or CRM profiles are revealed by status or access endpoints. Keep link signing and admin secrets private, at least 32 bytes; do not log request bodies or raw capability URLs. Rotating the signing key issues different links but does not revoke previously stored hashes: explicitly revoke those if required.

The Arabic confirmation and access pages use a single receipt layout: Pearl `#FBF9E4`, Midnight `#122C4F`, Ocean `#5B88B2`, Fade `#9CB1C7`, Arabic system/local IBM Plex with a Latin utility brand label. One date/time block, one primary action per state, 48px controls, RTL and plain Kuwaiti wording. A whole-hour time reads `٨ مساءً`, without `:00`. This changes the API's confirmation journey only. The native landing page and legacy thank-you page are not connected to this new flow yet.

`node apps/webinar-registration-api/scripts/prepare.mjs` validates the canonical repo schedule without network calls. `--apply` writes a closed event/config revision using saved CEO defaults. First creation freezes targets, replay checks immutable fields, and later revisions close older registration configs. It never opens registration, invents a date, updates providers or silently reschedules existing appointments. Apply historical revisions in sequence if the ledger is behind; do not relabel a later revision as revision 1.

The survey backfill now sends each actual response through the same receipt RPC before advancing the reporting projection. Different webhook/backfill envelopes deduplicate by common submitted answers, question IDs and hidden values. Raw `webinar_ref` is removed from stored payloads and the legacy projection. A failed receipt prevents watermark advancement; dry run makes no receipt writes. The updated collector is not installed on the VPS yet.

New service-only projections:

- `cockpit_webinar_survey_matches`: exact response receipt to registration/event, with explicit `details_collected` when the report projection has arrived. No email/name fallback for this projection.
- `cockpit_webinar_attendance_matches`: exact bound Zoom session plus provider registrant ID. Keeps every rejoin row, excludes internal/waiting-room rows from registration matching, and keeps missing/unmatched evidence visible. Session binding still needs real provider evidence; no time/name-based automatic binding was added.

The production CEO adapter still reads the legacy cohort and matching logic. These projections do not by themselves change displayed numbers.

## Validation

- 89 focused Bun/PostgreSQL tests and 312 assertions, including nine new preparation/link/receipt/evidence/privacy tests.
- 26 API/worker Node tests plus 11 schedule tests.
- 50 collector Python tests, including backfill hashing, no writes in dry run, and receipt-failure recovery. 176 tests total across these suites.
- Production TypeScript/Vite/PWA build and shared-file parity pass after merging main through `68e1428`. Existing bundle-size/vendor annotation warnings remain.
- Synthetic browser inspection at 390, 820 and 1440 widths: no horizontal overflow; phone controls are 48px; Arabic digits/whole-hour time render; review state has no links; invalid link offers no navigation. No real phone or external provider journey was tested.

## Exact next integration work

1. Configure the existing API and worker private environment, including `WEBINAR_LINK_SECRET` and separate `WEBINAR_LINK_ADMIN_SECRET`; keep intake and dispatch off. New API routes/UI and collector changes are not deployed.
2. Inspect the exact native W1 webhook payload or a controlled form receipt. The supported [GHL submissions endpoint](https://marketplace.gohighlevel.com/docs/ghl/forms/get-forms-submissions/) provides submission ID, contact ID, form ID and creation time, but the empty read does not verify this account's actual row shape. Never fabricate workflow merge-field names or treat contact creation time as submission time.
3. Bind the native form to the intended event revision, send its actual receipt to the durable handoff, and deliver links only after completed booking. Reorder the old W1 messaging steps so a durable HTTP 202 is not mistaken for confirmation. Contact-level custom values must not overwrite an older event's links during repeat registration. Preserve draft state until rehearsal and launch approval.
4. Migrate CEO reporting to event/registration cohorts using these views, preserve unbound historical evidence, and bind a real Zoom instance. Verify actual join/rejoin, survey webhook/backfill parity and source totals with the isolated test recipient.
5. Complete uncertain-write reconciliation, actual provider reschedules, reminders, pitch booking and verified transaction/refund attribution, supported Kit coverage, alert routing and isolated restore. Then choose/apply the next date and complete public launch gates.

No date, workflow, campaign, appointment, contact or customer message changed in this slice. Shared provider form metadata and additive database schema are the live changes. Keep [PR26](https://github.com/AzizWaheedi/mahara-cockpits/pull/26) draft.
