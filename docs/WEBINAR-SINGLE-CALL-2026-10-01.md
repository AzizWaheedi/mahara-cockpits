# Webinar single-call and qualification correction, 1 October 2026

## User decision

The funnel has **one webinar and one sales call**. The webinar is never Call 1. The earlier two-sales-call interpretation is superseded.

After the webinar, leads answer qualification questions, and qualifying answers take them to the booking page. **Qualified - Not Booked** means they passed those questions but have no attributed sales booking. Merely completing a survey does not qualify them. Once they book, Call booked takes priority. Call showed is attended but undecided; Showed Won/Lost are attended sales outcomes. No-shows and cancellations stay separate.

## Saved and verified

MaharaMedia location `7NI8yyJtwsh2OOWA5Icr`, pipeline `gpytC6cU1OstqMZpRleR` (WEBBY | Webinar Journey), now has twelve stages. Aziz explicitly approved removing the four unused Call 2 columns after a read-only opportunity search proved total 0. The removal and eight corrected names are saved and independently API-verified at provider update time `2026-10-01T09:20:40.238Z`.

All twelve retained IDs are unchanged. All pipeline/stage reporting flags remain false. `config/webinar/pipeline.json` and the disabled Supabase configuration match the twelve IDs. The database write compared the exact prior sixteen-ID mapping and zero-card state, retained `enabled=false`, and created immutable audit receipt `f46d0d8c-30d4-4e62-b88c-65d181bd04a1`. Readback proves exact mapping equality, twelve keys, disabled, zero cards/bindings and the receipt.

No contacts, appointments, sales opportunities, messages, workflow publications or workers were changed.

## Twelve stages

| Stage | Key | Retained ID source |
| --- | --- | --- |
| Registered | registered | Original registration |
| Webinar attended | attended | Original attendance |
| Missed webinar | webinar_missed | Original missed webinar |
| Qualified - Not Booked | qualified_not_booked | Original Survey completed |
| Call booked | call_booked | Original call booking |
| Call showed | call_attended | Original call attendance |
| Call no-show | call_no_show | Previously Call 1 no-show |
| Call cancelled | call_cancelled | Previously Call 1 cancelled |
| Follow-up needed | call_follow_up | Original follow-up |
| Showed Won | client_won | Original won |
| Showed Lost | closed_lost | Previously Closed lost |
| Disqualified | disqualified | Existing disqualified |

Display order is independent of exact-ID routing. The existing UI order retains exceptions near the end; no retained stage was recreated for layout.

## Qualification source correction

A fresh Typeform API read shows `P1xP4r24` is titled **Mahara Media Free Gift Survey**, has no qualification logic in its returned definition, has `use_lead_qualification=false`, and ends with a gift-delivery message rather than a booking redirect. The historical `/intro-booking` URL opens a fifteen-minute calendar directly. Neither verifies the post-webinar qualification flow Aziz described. No form was modified or submitted.

The existing `survey_completed` evidence comes from the gift-survey receipt and must not feed Qualified - Not Booked. The code now ignores that boolean for stage qualification. It accepts only a server-owned `qualification_status` verdict from an exact registration-scoped qualifying receipt. **That producer and database projection are not implemented yet**; no current column supplies the verdict. The correct form/link, pass/fail rules, booking-page routing and occurrence attribution must be verified before implementing it or enabling projection. Do not substitute an old ROAS tag, gifted-form profit band or shared contact identity. Aziz has been asked for the correct form link.

## Routing and tests

- Removed call-number classification from calendars and legacy sales-pipeline names. Explicitly bound receipts on approved calendars all use the same one-call stages. The four-calendar allowlist is not four calls.
- Showed Won/Lost require an appointment marked showed and the commercial result on the same bound sales opportunity. Webinar attendance, another deal's attendance, a won flag alone, no-show or cancellation cannot establish showed.
- Rebooking takes priority over previous no-show/cancellation. Cancelled duplicates do not erase attendance. Past unmarked appointments and ambiguous uncompleted outcomes require follow-up.
- Disqualified is distinct. A lost earlier attempt cannot close a different active attempt. Tracking cards remain open and zero-value; won is not collected-payment proof.
- Exact-registration identity, manual-change holds, leases, mutation receipts, uncertain-write checks and account/contact validation remain.
- All 75 API Node tests pass, including qualification-vs-gift separation and booking precedence. The legacy eight-stage updater preserves the former survey ID when mapping it to qualified_not_booked. It refuses obsolete extra stages instead of deleting them.

## Remaining release gates

1. Verify the post-webinar qualifying form and its pass/fail/booking redirect rules; create the exact-registration qualification receipt/projection and prove pass, fail, incomplete and booked cases.
2. Finish exact registration-to-sales-booking attribution. Rebooking still needs an explicit binding design; the current schema makes sales_opportunity_id unique.
3. Verify the saved P1 internal draft action and all 22 triggers. Existing uploaded installer receipt remains incomplete; 22 means one form, five hints and four outcomes across four allowed calendars, not multiple calls.
4. Wire native-form intake and confirmed personal-link delivery, deploy reviewed API/workers/health checks, and run isolated real-provider acceptance.

Automatic movement remains off. No reminder or workflow publication is authorized by this correction.
