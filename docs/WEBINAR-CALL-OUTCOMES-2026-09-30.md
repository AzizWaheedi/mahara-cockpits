# Webinar call outcomes

## Current checkpoint, 30 September 2026

Aziz requested separate second-call attendance, no-show, cancellation and closing outcomes. The expansion is implemented and tested, **not yet applied to the live GHL board or deployed**.

Live readback still shows the original eight stages in `WEBBY | Webinar Journey`, pipeline `gpytC6cU1OstqMZpRleR`, MaharaMedia location `7NI8yyJtwsh2OOWA5Icr`. One guarded public PUT returned HTTP 401; the subsequent GET confirmed eight stages. Do not repeat the write blindly. The browser editor returned only the app shell after a session bootstrap failure, including after one reload. Native Chrome control also timed out. Aziz was asked to restore a working GHL Pipelines session.

Creative Triage was read again: configuration remains `enabled=false`, with eight mapped stages and zero cards, bindings and signals. No database settings, contacts, appointments, messages or workflow statuses changed in this checkpoint. `config/webinar/pipeline.json` deliberately remains the verified live eight-stage mapping.

## Intended board

| Stage | Key | Existing ID retained? |
| --- | --- | --- |
| Registered | registered | Yes |
| Attended | attended | Yes |
| Missed webinar | webinar_missed | Yes |
| Survey completed | survey_completed | Yes |
| Call 1 booked | call_booked | Yes, renamed from Call booked |
| Call 1 showed | call_attended | Yes, renamed from Call attended |
| Call 1 no-show | call_1_no_show | New |
| Call 1 cancelled | call_1_cancelled | New |
| Call 2 booked | call_2_booked | New |
| Call 2 showed | call_2_attended | New |
| Call 2 no-show | call_2_no_show | New |
| Call 2 cancelled | call_2_cancelled | New |
| Follow-up needed | call_follow_up | Yes, renamed from Call follow-up |
| Closed won | client_won | Yes, renamed from Client won |
| Closed lost | closed_lost | New |
| Disqualified | disqualified | New |

The order groups outcomes for navigation. It is not a claim that every lead passed through each column. Do not delete or recreate the eight existing stages. Public PUT fully replaces the stage list, so the upgrader includes every existing ID and verifies those IDs after saving.

## Movement rules

- Only exact webinar-registration-to-appointment bindings can produce call stages. Tags and shared contact identity are not attribution.
- The two intro calendars are call 1. A demo on the one-call sales pipeline is call 1; a demo on the two-call sales pipeline is call 2. Missing exact sales-opportunity linkage holds a demo instead of guessing its sequence.
- A second-call outcome takes precedence over attendance at call 1. A future replacement booking takes precedence over the prior cancellation/no-show in that same round.
- A marked showed appointment is retained over a cancelled duplicate. Mixed cancelled/no-show states or a past appointment without an outcome go to Follow-up needed. Passing the appointment time alone never means no-show.
- Explicit won status, or the exact existing Closed stage while not lost/abandoned, maps to Closed won. Lost/abandoned maps to Closed lost; the exact existing DISQUALIFIED stages map to Disqualified. One lost earlier opportunity cannot close a different active opportunity.
- These are CRM outcomes, not collected-payment proof. Tracking cards remain open with zero monetary value; revenue stays on the sales opportunity. Payment/refund attribution remains a separate release gate.
- Manual tracking-card changes hold automatic writes. Existing contacts, appointments, sales opportunities and reminders are never rewritten by the stage projector.

## Prepared changes

- `lib/pipeline.js`: sixteen stages plus an inert-by-default, exact-ID-preserving eight-to-sixteen-stage upgrader. One attempted PUT, then readback; no automatic repeat after an uncertain response. Unknown/edited stages abort.
- `scripts/pipeline-expand.mjs`: plan by default; `--apply` only for an authorized pipeline write. If the user completes the UI edit, rerunning verifies the sixteen stage names/order and original IDs and returns the new mapping without writing.
- `lib/pipeline-sync.js`: evidence-based per-call and commercial outcomes.
- `scripts/ghl/webinar-workflows-console.js`: audit-only by default. The explicit install mode repairs only the exact internal P1 draft and prepares 22 triggers: one form, five tag hints, and confirmed/showed/noshow/cancelled across the four sales calendars. Existing ten-trigger drafts gain only the twelve missing triggers. It never publishes or sends messages. Closed-deal updates are detected by periodic authoritative reconciliation, not by a new inferred trigger.

## Exact next steps

1. In a working signed-in GHL editor, rename/reorder the existing eight stages and add the eight new ones in the table. Alternatively use the guarded public updater only with an appropriately authorized credential; do not expose or expand credentials just to work around the current 401.
2. Read back all sixteen IDs, prove the original eight remain, then update `config/webinar/pipeline.json` and the **disabled** Supabase mapping conditionally against the old mapping. Record the receipt in Git. Do not enable the mapping as part of this update.
3. Run the current console installer in the workflow frame, inspect its sanitized receipt, and verify the P1 action plus 22 triggers while still draft. The earlier uploaded receipt is version 2 with `complete=false` and `Missing workflow steps`; it does not prove the repair succeeded.
4. Finish exact sales-booking attribution and the existing deployment/provider acceptance gates in [the pipeline runbook](WEBINAR-GHL-PIPELINE-2026-09-27.md). If multiple appointments refer to one sales opportunity, note that the current binding schema permits only one row with that opportunity ID; an intro can be linked without it and the demo linked with it. A general multi-appointment attribution producer still requires explicit schema/design acceptance.

## Validation

All 73 registration API Node tests pass. Coverage includes both call rounds, cancelled spelling variants, rebooking, unknown past attendance, direct one-call demos, second-call no-shows following first-call attendance, closed/won/lost/disqualified outcomes, wrong-contact rejection, zero-value tracking, stage-ID preservation, ambiguous PUT responses, rejected writes, no duplicate stage creation and ten-to-twenty-two draft trigger upgrades. Diff whitespace checks pass. No frontend code or database schema changed, so the earlier full frontend/database results are historical and were not rerun for this change.
