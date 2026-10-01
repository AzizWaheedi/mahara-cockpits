# Webinar pipeline and workflow connection

> Latest correction: [one webinar and one sales call](WEBINAR-SINGLE-CALL-2026-10-01.md). Showed Won/Lost labels are saved; four unused Call 2 columns await deletion confirmation. The twelve-stage source is tested, not activated. All two-call requirements below are historical and superseded.

> 1 October update: [The expanded sixteen-stage board](WEBINAR-CALL-OUTCOMES-2026-09-30.md) is now saved and API-verified; Git and the disabled Supabase mapping match. Both call rounds and closing outcomes are distinct. All 74 API tests pass. The prepared 22-trigger draft and automatic movement still require attribution, installation/readback and deployment acceptance. The eight-stage/ten-trigger details below are the historical 27 September checkpoint.

## Verified live on 27 September 2026

MaharaMedia location `7NI8yyJtwsh2OOWA5Icr` now has **WEBBY | Webinar Journey**, pipeline `gpytC6cU1OstqMZpRleR`. It was created in the signed-in GHL interface and verified through the public API. The eight exact stage IDs are versioned in `config/webinar/pipeline.json`.

Registered → Attended → Survey completed → Call booked → Call attended → Client won.

Two exception columns follow: Missed webinar and Call follow-up. The board represents the latest verified outcome, not proof that someone completed every preceding step. Someone can book without attending or finish a survey without attending.

The existing Webinar pipeline is unchanged. A read-only search returned zero opportunities in the new pipeline. Tracking cards are intended to stay open with monetary value zero; actual sales revenue remains on the sales opportunity. Pipeline stages were excluded from funnel/pie reports during creation.

The user-run 09:45 UTC audit found 60 published workflows and six WEBBY drafts. A second audit at 09:52 UTC exported the actual opportunity filters: all 11 active opportunity/pipeline triggers across 10 workflows are restricted to the existing sales pipelines, not this new pipeline. This establishes their current direct trigger scope, not the behavior of every downstream workflow or future edit. Sales reminders already run on the four calendars used by W6. No reminder sequence was duplicated.

The first installer created `WEBBY - P1 Reconcile Webinar Journey` (`a063275f-150a-4d68-803e-17bb02fa24dc`) as draft, then stopped on GHL's uninitialized workflow graph. Public API readback independently confirms draft status. The corrected script accepts null/empty graphs only for this exact named draft, preserves unknown graphs, and has regression tests for this case. The final repair receipt must be checked before claiming the action/triggers are installed.

The additive `webinar_pipeline_projection` migration is installed in Creative Triage. Saved mapping has eight stages and `enabled=false`. Five tables have RLS and no browser grants; three views use `security_invoker=true`. Service-only heartbeat start/finish was tested inside a rolled-back transaction. Source-health SQL ran against live storage; no pipeline cards/signals were pending. Supabase's only scoped security advisory is the intentional service-only [RLS with no browser policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

No API/worker/cron deployment, enrollment, contact mutation, appointment change, message, or publishing was performed by this checkpoint.

## How automatic movement works

| Board stage | Required evidence |
| --- | --- |
| Registered | Exact occurrence registration has both verified Zoom registrant and training appointment receipts |
| Attended | Exact Zoom registrant plus bound session match |
| Survey completed | A signed survey response carrying an issued registration reference |
| Call booked | An explicitly attributed sales appointment, exact contact/location/allowed calendar, future and new/confirmed |
| Call attended | The attributed appointment is marked showed in GHL |
| Client won | An explicitly attributed sales opportunity has GHL status won; this does not prove payment |
| Missed webinar | Every bound session is complete, ended at least two hours ago, counts reconcile, no unmatched external attendance, and no exact attendance for this registration |
| Call follow-up | An attributed booking exists but is cancelled, missed, invalid or past without confirmed attendance; a new future booking supersedes this state |

A GHL webhook/tag is only a wake-up hint. The worker reads evidence again before moving anything. A per-registration lease and persisted mutation intent prevent concurrent writes. A timeout after a write becomes uncertain and requires receipt review. No automatic repeat POST, no contact-only opportunity upsert and no nearest-date sales attribution. Manual changes to a tracking card pause automation for that card.

Each card uses the immutable full registration UUID in its opportunity name. Repeat registrations can coexist. If the GHL account disallows a second opportunity for the contact, stop and resolve that setting or provider contract after review; never move the previous webinar's card as a workaround.

## Components and runbook

- `lib/pipeline.js`, `scripts/pipeline.mjs`: idempotent plan/provision/readback. Current public docs support pipeline POST with Version v3. This account's existing token returned 401 on POST, while GET succeeded. The UI was used for creation. Opportunity write permissions still need isolated acceptance.
- `lib/native-forms.js`, `scripts/native-forms.mjs`: bounded, count-checked GHL form reads. Real submission IDs and timestamps become immutable intake receipts. Date reads are padded for timezone boundaries, then strictly filtered. No contact-created timestamp substitution. `config/webinar/ghl-form-windows.json` is intentionally empty until the occurrence and intake window are selected. A nonempty real response shape is still unverified.
- `api/ghl-pipeline.js`: authenticated internal endpoint. `WEBINAR_PIPELINE_SIGNAL_SECRET` must be at least 32 characters. Accepts only this location/contact hint; ignores supplied stages and revenue. Unknown non-webinar contacts are not retained by the RPC.
- `scripts/pipeline-work.mjs`: defaults held, read-only `--doctor`, at most 25 cards / 90-second budget per batch. DB mapping must also be enabled. Do not call with live switches during routine testing.
- `lib/bridge-run.js`: writes running/completed/failed source ledger rows, including idle success. A crash remains visibly unfinished. Native form dry-run does not write health. Cockpit collection health consumes these rows; the new UI/backend adapter is built but not yet deployed.
- `scripts/ghl/webinar-workflows-console.js`: default audit only. Setting `AUDIT_ONLY=false` creates one internal DRAFT with one authenticated webhook and ten triggers (one form, five tag hints, four confirmed sales calendars). It preserves old workflows and message copy, never calls publish, refuses unknown draft graphs and version conflicts, and verifies saved actions/triggers.

The GHL secret belongs in private Custom Values as `webby_pipeline_secret`, matching the Vercel server's `WEBINAR_PIPELINE_SIGNAL_SECRET`. It is not created or copied into Git by the script. No browser session credential leaves GHL.

After acceptance, deploy only reviewed files into an isolated release directory on the VPS, load existing private environment names, and use a shared `flock` lock for native intake, registration dispatch and pipeline projection. Target polling at most every five minutes and measure backlog capacity before traffic. Existing hourly Zoom/Typeform collection is separate; workflow hints cannot replace completed collection. CLI examples from repo root:

```sh
node apps/webinar-registration-api/scripts/native-forms.mjs
node apps/webinar-registration-api/scripts/pipeline-work.mjs --doctor
# Only after provider acceptance and explicit cutover:
# node apps/webinar-registration-api/scripts/native-forms.mjs --apply
# node apps/webinar-registration-api/scripts/work.mjs
# node apps/webinar-registration-api/scripts/pipeline-work.mjs
```

No cron has been installed. No secret values belong in command arguments, screenshots or shared files.

## Remaining release work

1. Read the corrected installer receipt and check the saved webhook/ten triggers while still draft. Preserve the original W1-W6 as drafts.
2. Complete occurrence-scoped sales booking attribution. `cockpit_webinar_sales_bindings` is deliberately empty; no booking-link callback or automatic binding producer is installed. A real registration reference must survive into the exact appointment receipt. During isolated acceptance, an operator may bind exact verified test identities with evidence/actor. Do not infer the webinar from a tag, latest month, contact alone or nearest time. This blocks automatic Call booked/Call attended/Client won until implemented and tested.
3. Connect the new registration path and personalized-link delivery. W1 currently points at the old pipeline and its legacy registration action; do not publish it unchanged. W2/W4/W5 must use confirmed personal links and the selected revision before activation. Preserve existing sales-call reminders. Inspect modified-by/contact-mode filters before relying on sales appointment API writes.
4. Select a future date, generate the canonical schedule revision and an exact native-form intake window. Prepare the ledger with registration still closed. Verify Zoom registration mode/confirmation settings, provider credentials, GHL opportunity-write capability, duplicate opportunity behavior, form pagination and private endpoint secrets.
5. Deploy API, the reviewed registration/pipeline workers and the cockpit collection-health adapter through their separate release paths. Test crash/timeout recovery, one registration across every board state, repeat occurrence separation and no accidental messages. The public GHL API only confirmed empty opportunity search shape in this session.
6. Confirm payment/refund tracking separately. A card at Client won does not certify collected cash. Retain the previous launch gates for real attendance, delivery receipts, retention, pitch attribution, cohort reporting, recovery and restore acceptance.

## Validation

96 TypeScript/embedded-Postgres tests, 70 Node/schedule tests and 50 Python collector tests passed before the empty-draft correction. The correction adds one Node regression test, with all six console-script tests passing. Full TypeScript/Vite/PWA build passed. Build warnings are dependency annotation and large-chunk advisories. Tests are synthetic; no provider mutation was used as a test.
