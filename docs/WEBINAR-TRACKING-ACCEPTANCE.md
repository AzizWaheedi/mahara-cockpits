# Webinar tracking: implementation and acceptance contract

Owner: existing CEO webinar project, ClickUp `z8xmdveerh`. Written 27 September 2026 after Aziz asked how to close the tracking gaps and ensure the work happens. This is the implementation contract, not a claim that the unfinished integrations are deployed. Use the latest shared webinar checkpoint for current live state.

## Outcome

For each webinar, show the path from acquisition to registration, attendance, qualification, booking and verified money. Every measurement carries source, coverage, timestamp and exclusions. Unavailable and incomplete data never becomes a measured zero. A total may be complete while per-person attribution is incomplete; display those states separately.

Reuse the existing cockpit, registration API, native GHL form, Supabase and VPS collector. No extra CRM or analytics subscription is assumed. The next date can stay undecided while the engineering work proceeds. Never activate messages, publish a date or start ads merely to test tracking.

## 1. Save a registration before downstream work

- Extend the installed event/registration ledger. One stable `event_id` per training, one `registration_id` per event + GHL location + contact. Preserve the first actual registration time and source receipt. Contact creation time and mutable month tags cannot establish that registration time.
- A reschedule creates a schedule revision on the same event. Another training gets a new event even if it is in the same month. Existing targets are frozen per event, independently of later default edits.
- Preserve anonymous page-visit/acquisition receipts separately from the known registration. Record the captured ad/campaign IDs and UTMs, plus first and registration-touch evidence. Link only when evidence exists. Organic or blocked tracking remains explicitly unattributed.
- Both entrypoints must use the same contract: the public native GHL form/W1 handoff and the recovered standalone API. Accept a valid scoped GHL contact from an authenticated handoff; otherwise resolve under the documented provider rules and reject ambiguous candidates. Never trust a browser-supplied contact ID by itself.
- Persist a validated incoming request and unique source receipt before scheduling Zoom/GHL/Kit work. Return success only after that write. If storage is unavailable, return a retryable response; never say the signup is complete. Acknowledge authenticated provider webhooks only after durable receipt.
- Store each outbound step separately with attempt, state, next retry and provider receipt. Use unique constraints and one claimed worker per step. Retry safe reads and known idempotent writes with bounded backoff. A timed-out appointment/message mutation is uncertain, so reconcile its provider ID before retrying. Failed duplicate lookup cannot permit another appointment.

## 2. Carry the identity through the journey

| Step | Required link and evidence | Unknown/ambiguous behavior |
| --- | --- | --- |
| Registration | Exact event revision + location/contact + incoming form/API receipt + registered timestamp | Retain for review; do not infer from current contact tags |
| Zoom | Store event/registration to Zoom registrant ID and private unique join URL; bind actual meeting-instance UUID | Show headcount separately; do not assign a guest by display name |
| Attendance/retention | Original join/leave intervals and exact instance, provider participant/registrant identity, independent channel coverage | Missing leave/end times make affected rates unknown; a rejoin adds intervals, not another registrant |
| Typeform | Declared hidden registration/event fields or a validated scoped reference; form ID, response ID, signature and submission time | Store unmatched response with reason; no silent email/name reassignment |
| Reminders | Exact event/registration + provider message ID + step + status timestamps | Sent, delivered, read and clicked remain separate; missing receipt is unknown |
| Pitch booking | Exact appointment/contact/calendar, originating registration, event and pitch where evidenced | Shared stage links identify the pitch/event; they do not prove which viewer clicked. Unresolved person linkage stays unassigned |
| Calls and deals | Exact call/appointment and deal IDs, actual outcome evidence | A past confirmed appointment alone is not proof of attendance; unverified closer claims stay reported |
| Payments/refunds | Immutable provider transaction/refund IDs linked to the deal and attributed event, amount, original currency and documented FX basis | Unmatched receipts stay in reconciliation; never sum one payment into multiple primary webinar totals |

Zoom's Meetings API supports a registrant ID and a unique join URL. The implementation must verify the account's required scopes and a real returned participant match. Register from the existing signup flow where supported so attendees do not fill in another form. Changing Zoom registration settings may trigger provider emails; inspect those settings during the scoped pilot before activation.

Public links use an opaque purpose-scoped, revocable reference resolved server-side, not names, email addresses, API secrets or raw contact IDs. A link records use of that link; forwarding and link scanners mean a click is not proof of identity or attendance. Never expose a host/start URL. Preserve expiry, redirect allowlists and no-store/no-referrer handling for private join links.

Typeform must declare the hidden fields, verify HMAC over the bounded raw body, allow only the configured form, deduplicate the response ID, and redact provider errors. The Responses API backfill remains a second collection path with the same deduplication key.

## 3. Add Kit reporting without relying on unavailable webhooks

Maintain the event to Kit sequence/broadcast IDs and registration to subscriber ID mapping. Verify the existing account connection and plan coverage before claiming access. Read only the mapped event campaign, not the entire account.

As checked on 27 September, Kit's new signed webhook event list marks `subscriber.email_opened` and `subscriber.link_clicked` as **planned**, not available. Do not build the release around subscribing to those events. Use supported broadcast stats/link-click and subscriber-stat APIs, subject to a real account read and coverage validation. Track sends/unsubscribes/bounces through supported receipts where available. Sequence-level/per-email completeness must be proved; aggregate broadcast reports cannot masquerade as a per-person delivery history.

Keep provider open/click measures labeled as reported engagement. Check tracking-disabled flags before interpreting a zero. Mahara-owned reminder/booking redirects can record link visits with the event/step reference, but are not proof that a human read an email. Discrepancies remain visible rather than forcing totals to agree. AI objection analysis is a separate, currently held optional stream; it is not part of the core launch gate.

## 4. Recover, reconcile and flag gaps

- First recover the observed collection interruption and compare backfill totals with the providers. Do not assume restored database connectivity means missed work has caught up. Supersede abandoned run receipts with a new correlated recovery attempt; do not rewrite old failure history as success.
- Keep webhook intake for supported events plus independent scheduled reconciliation. Resume from the last successfully committed complete page/window, with overlap and ID deduplication. Respect provider report delays, pagination and rate limits.
- Daily reconciliation and a post-session final pass compare registration counts, matched/unmatched Zoom people, survey responses, appointments and payment/refund sums against the original sources. Distinct people, join intervals and message attempts have different denominators.
- Extend the existing external watchdog before adding another monitoring service. Watch provider collection freshness, completed pagination, oldest queued work, orphaned links and heartbeat completion separately from the CEO page refresh timestamp. A fresh page cannot hide stale source data.
- Initial operational limits to validate: immediate warning for rejected credentials/signatures or incomplete pagination; warning after two missed hourly collection windows; an overdue step after its configured retry deadline; post-session figures stay provisional until report coverage is complete. Tune from observed provider latency and record the limits in config.
- Monitor outside the database being monitored, including failure of the monitor itself. Use the existing configured operational recipient only after checking its routing; no new recipient or message channel is activated by this document. Never include lead details or credentials in alerts.
- In the cockpit, each metric/source shows **verified**, **processing**, **needs attention**, or **unavailable**, with latest successful coverage and an inspectable reason. Present matched and unmatched counts. Preserve the latest good data while warning on a failed refresh.
- Confirm backup/restore and capacity monitoring independently. Do not delete data, enable paid capacity, or clone active jobs as an automatic response to an outage.

## 5. Acceptance checklist and evidence

Every open line stays open until it has a test result, exact source version and, where applicable, a live provider receipt. Tests use synthetic fixtures or Aziz's already-approved isolated recipient. Never send messages to other leads as a smoke test.

- [ ] Same contact registers twice for one event: one registration, original timestamp, deduplicated external actions.
- [ ] Same contact registers for a second event in the same month: two distinct registrations, correctly separated results.
- [ ] The event is rescheduled: same event/registration identities, preserved old schedule, verified revised appointments/reminder waits.
- [ ] Both native form and standalone API paths store real receipt IDs and recover from interrupted processing.
- [ ] Duplicate/out-of-order webhooks, invalid signatures, wrong form/location and replayed IDs fail or deduplicate correctly.
- [ ] Database/network failure before/after an external mutation: no false success or blind repeat booking/message; recovery reconciles the receipt.
- [ ] A real test registrant receives the intended scoped join link, joins, leaves and rejoins; one person and the correct intervals appear in Zoom and the cockpit.
- [ ] An attendee without a reliable identity appears as unmatched rather than being attached to someone with the same name.
- [ ] Survey, pitch-1/pitch-2 and booking evidence attach only to the intended event/registration. Test both shared stage links and personalized reminders.
- [ ] Test deals, payment/refund fixtures and multi-event attribution reconcile with no double-counted cash; a real existing provider receipt is checked separately without charging or refunding to manufacture proof.
- [ ] Kit reports read through the actual account, tracking-disabled data stays unknown, and unsupported engagement events are not treated as working.
- [ ] Source totals, excluded/test rows, unmatched counts and freshness agree between provider readback and cockpit.
- [ ] A failed collector, missing heartbeat and recovery are visible; authorized operational alert routing is verified without customer messages.
- [ ] Isolated restore/capacity checks pass, with outward jobs held, and no claim that daily backup inventory equals proven recovery.

The one live rehearsal covers the user-visible path, but it does not replace the automated failure and duplicate tests. A real payment/refund or complete natural conversion cohort may be unavailable before launch; label that boundary instead of fabricating production results.

## Execution order and release rule

1. Recover and verify collection; make source failures visible.
2. Implement one durable registration/occurrence path shared by both entrypoints, then connect unique Zoom links.
3. Attach surveys, reminders, bookings and revenue, and add Kit's supported reporting.
4. Run synthetic failure/replay tests and an isolated real rehearsal. Verify totals and access controls.
5. Add the evidence checks to the existing release helper and cockpit readiness view. A changed event/schedule, integration configuration or relevant deployment invalidates affected evidence.
6. Only open registration/enable reviewed reminders after the required gates pass and Aziz has supplied the date and launch instruction. The system can enforce its own release path; it cannot prevent an operator manually starting an ad or meeting elsewhere.

The date, topic/offer changes, promotion budget and launch instruction are Aziz's inputs. Engineering, data matching, source checks and the test report are the implementation owner's responsibility. Do not make Aziz maintain tracking spreadsheets.

## Primary references checked 27 September 2026

- [Zoom Meetings API](https://developers.zoom.us/docs/api/meetings/): registrant identity, unique join URLs and participant reports.
- [Typeform signed webhooks](https://www.typeform.com/developers/webhooks/secure-your-webhooks/) and [payload fields](https://www.typeform.com/developers/webhooks/example-payload/).
- [Kit webhook event availability](https://developers.kit.com/webhooks/event-types): available versus planned event types.
- [Kit broadcast stats](https://developers.kit.com/api-reference/broadcasts/get-stats-for-a-broadcast), [link clicks](https://developers.kit.com/api-reference/broadcasts/get-link-clicks-for-a-broadcast) and [subscriber stats](https://developers.kit.com/api-reference/subscribers/list-stats-for-a-subscriber).

Related: [registration release gates](../apps/webinar-registration-api/RELEASE-GATES.md), [repo-owned schedule](../config/webinar/README.md), [internal release proof](WEBINAR-RELEASE-2026-09-26.md), [recovery](WEBINAR-RECOVERY-2026-09-26.md).
