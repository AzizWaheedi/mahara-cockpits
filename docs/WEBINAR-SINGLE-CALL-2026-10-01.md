# Webinar single-call correction, 1 October 2026

## User decision

The funnel has **one webinar and one sales call**. The webinar is never Call 1. The earlier two-sales-call interpretation was incorrect and is superseded.

The existing webinar gift survey is Typeform `P1xP4r24`. Survey completed is the pre-booking state for a linked response while no sales appointment is bound. A booking or later call outcome takes priority. Completing the survey does not establish webinar or call attendance.

Aziz requested **Showed Won** and **Showed Lost**, not Closed won/lost. Call showed remains the attended-but-undecided state. No-shows and cancellations remain separate.

## Verified live state

In MaharaMedia `7NI8yyJtwsh2OOWA5Icr`, pipeline `gpytC6cU1OstqMZpRleR` (WEBBY | Webinar Journey), seven renames are saved and API-verified at provider update time `2026-10-01T09:10:41.997Z`: Webinar attended, Call booked, Call showed, Call no-show, Call cancelled, Showed Won and Showed Lost. All IDs and reporting flags were preserved; all stage and pipeline report flags remain false.

The read-only opportunity search returned total 0 and zero rows. Supabase remains disabled with sixteen mapped IDs and zero cards/bindings. No contacts, bookings, messages, workflow publication or workers were changed.

**Pending:** the four empty Call 2 stages are still live. Their permanent removal requires action-time browser confirmation, which was requested but not yet received. `config/webinar/pipeline.json` intentionally retains the sixteen live IDs and explicitly records this pending correction. The new twelve-stage validator fails closed against the old board; do not enable projection or claim full live correction yet.

## Intended twelve stages

| Stage | Key | Retained ID source |
| --- | --- | --- |
| Registered | registered | Original registration |
| Webinar attended | attended | Original attendance |
| Missed webinar | webinar_missed | Original missed webinar |
| Survey completed | survey_completed | Original survey |
| Call booked | call_booked | Original call booking |
| Call showed | call_attended | Original call attendance |
| Call no-show | call_no_show | Previously Call 1 no-show |
| Call cancelled | call_cancelled | Previously Call 1 cancelled |
| Follow-up needed | call_follow_up | Original follow-up |
| Showed Won | client_won | Original won |
| Showed Lost | closed_lost | Previously Closed lost |
| Disqualified | disqualified | Existing disqualified |

Remove only Call 2 booked `639c9227-51b2-4b10-951a-16f180114e20`, Call 2 showed `9f9c0028-707c-43ae-b5da-100ff486d857`, Call 2 no-show `454b6e36-9181-4265-bfae-6522d453f67a` and Call 2 cancelled `589ea7bd-885d-42c3-bc9d-9c623c5a1c8c`. All remaining twelve stage IDs must survive unchanged. Display order is independent of exact-ID routing.

## Routing and tests

- Removed call-number classification from calendars and legacy sales-pipeline names. Explicitly bound receipts on any approved sales calendar use the same one-call stages. The existing four-calendar allowlist is not evidence of four calls.
- Showed Won/Lost require an appointment marked showed and a won/lost outcome on the **same bound sales opportunity**. Webinar attendance, a different deal's attendance, a won flag alone, no-show or cancellation cannot establish showed.
- Rebooking takes a pre-booking, missed or cancelled lead to Call booked. Duplicate cancelled bookings do not erase established attendance. Past unmarked appointments and conflicting uncompleted outcomes require follow-up.
- Disqualified is distinct; a lost earlier attempt cannot close a different active attempt. Tracking cards remain open and zero-value, and won is not proof of collected payment.
- Existing exact-registration identity, manual-change holds, leases, mutation receipts, uncertain-write checks and account/contact validation remain.
- All 74 API Node tests pass. No second-call stage can pass the new board validator. The additive legacy eight-stage updater targets twelve and refuses the obsolete sixteen-stage board; it is not a deletion tool.

## Next action

After Aziz confirms removal, remove only the four empty Call 2 columns in the existing GHL editor. Read back twelve exact names and IDs and all reporting flags. Rewrite Git mapping with `call_no_show`/`call_cancelled`, preserving their IDs, and conditionally replace the disabled Supabase mapping against the exact old JSON in one audited transaction. Keep `enabled=false`.

The remaining release gates are unchanged: exact registration-to-sales-booking producer, a saved P1 draft action and 22 verified triggers, native-form/intake/personal-link connections, API/worker deployment and isolated real-provider acceptance. The old installer receipt is still incomplete. No reminder/workflow publication is part of this correction.
