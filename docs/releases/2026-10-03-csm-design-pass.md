# Client Success cockpit design and reliability pass

Status: ready for design and code review in [PR #27](https://github.com/AzizWaheedi/mahara-cockpits/pull/27). Not deployed. No real appointments, invitations, client messages, payment records or staff EOD messages were created in verification. The Higgsfield SOP video remains pending Aziz's approval of the finished cockpit.

## What changed

- Eight primary destinations replace thirteen sidebar links. Client work uses Follow-ups, Performance and Data issues. Growth uses Renewals, Opportunities, Retention and My income. Existing routes still work.
- Today focuses on the day's priorities and a collapsed day plan. The broad inbox and review composer no longer fill the dashboard. Meetings and client messages share one workspace.
- Clients can be found by name or ClickUp Client ID, including clients with no outstanding follow-up. The card and profile offer Copy ID and Book next check-in. Duplicate manual check-in controls were removed. Onboarding and other journey calls remain available where relevant.
- Opportunities suppress duplicate client/type suggestions. Resource search finds booking links, forms, SOPs and boards. Phone navigation closes after selection; wide tables scroll within the page. A page failure no longer traps navigation.
- Important saves have pending/error states. EOD save failures stay visible. Queue acceptance is described as queued, not completed. Data freshness warnings and WhatsApp send receipts no longer promise unverified completion.

## Reliability and access

The live read-only audit found unrelated personal WhatsApp threads in the old CSM feed. Their contents were not copied into evidence. The replacement API requires a verified CSM seat, the configured Mahara client account, the CSM desk and an authorized ClickUp Client ID. It verifies the current CRM contact again before sending. The Python inbox worker now records the exact client link and skips message collection/drafting for unmapped contacts. Existing unrelated rows are hidden, not deleted.

Role revocation now overrides historical allowlists. Client reads and writes are checked in snapshots, calendar feeds, review links/import status, retention, AI context and mutation paths. A task ID cannot be paired with another client's name. Scoped seats do not see unlinked legacy task feeds or edit company-wide retention counts.

Durable receipts prevent repeated check-in bookings, CSM actions, WhatsApp replies and payment submissions for the same request. Unknown provider outcomes block automatic replay. A payment receipt is retained if the separate next-payment-date update fails. An edited opportunity note does not undo an existing closed win.

EOD records belong to the verified author. Delivery requires an explicit email-to-person mapping through `CSM_EOD_ROSTER`; the old single-person fallback was removed. A missing mapping saves the report with an actionable error. Energy/stress are carried into the export. Identical saved reports do not enqueue again. Unknown delivery results need an operator check.

This strengthens the existing Convex/Supabase/provider architecture. It does not complete or replace the planned Supabase migration. Service-role credentials stay on the server. No new paid service or new Supabase table was introduced.

## Verified

`bun run test:csm-reliability` passes **155 tests**, in separate processes to isolate React mocks: 13 check-in, 20 projections, 17 churn, 17 access/retry, 5 billing reliability, 12 CSM render, 32 auth UI, 3 authenticated-function contracts, 24 log-redaction and 12 authentication-scanner tests. Three Python inbox identity tests pass. Frontend production build, backend TypeScript, shared-file parity, authentication scanner and Git whitespace checks pass. The release script includes these CSM and inbox checks.

The default desktop viewport and a 390 x 844 phone viewport were checked in a local fictional preview. All 14 route screens rendered: Today, Clients, Performance/profile, Tasks, Meetings/messages, EOD, Billing, Renewals, Opportunities, Retention, My income, Resources, Data issues and Settings.

Selected browser interactions passed: client name/ID search, search of a client with no outstanding follow-up, actual clipboard ID readback, matched booking contact and time selection, fictional booking confirmation, profile deep link, checklist save, bilingual draft editing without losing typed text, accepted-not-delivered reply state, opportunity add/edit, income-plan save, EOD save and persistent failure, data-fix queue state, empty search/client views, loading recovery, no available times, stale-data warning, and navigation away from a failed route. Phone menu, client card, booking dialog, opportunities and billing had no page-wide horizontal overflow in measured 390px views.

Fictional evidence:

- [Today, desktop](assets/csm-design-pass-20261003/today-desktop.png) and [phone](assets/csm-design-pass-20261003/today-mobile.png)
- [Client workspace](assets/csm-design-pass-20261003/client-desktop.png)
- [Booking, desktop](assets/csm-design-pass-20261003/booking-desktop.png) and [phone](assets/csm-design-pass-20261003/booking-mobile.png)
- [Client messages](assets/csm-design-pass-20261003/messages-desktop.png)
- [Failed save](assets/csm-design-pass-20261003/failed-save-desktop.png)

Reproduce with `bun run preview:design` from the CSM app, then open `http://127.0.0.1:4179/client-success/scripts/design-preview/index.html#/dashboard`. The [preview README](../../apps/client-success-cockpit/scripts/design-preview/README.md) explains its limitations. The production entrypoint does not include these fixture adapters.

## Release checks still required

1. Obtain Aziz's design/release review. Merge the exact approved source into main without overwriting concurrent work. Deploy the additive CSM backend and frontend through `scripts/ship.sh client-success` from clean main. This turn did not run that command.
2. Check the existing GHL account/calendar configuration described in the [booking release note](2026-10-03-csm-check-in.md). Verify available production slots. Normal calendar notifications apply, so use an explicitly selected staff/test contact and agreed time for appointment acceptance.
3. Set `CSM_EOD_ROSTER` from verified staff identities. Its shape is `{"staff@example.test":{"name":"Example Staff","slackId":"U..."}}`; those values are illustrative. Confirm the existing Supabase connection and `wa_threads.client_task_id` column. Deploy the reviewed inbox worker and verify one exact linked conversation plus exclusion of unmapped conversations. Do not interpret an empty inbox as worker health.
4. Verify deployed access using an ordinary CSM seat, a scoped seat and revoked access. Check private data boundaries, calendar ownership and the visible client roster. The preview does not authenticate against production.
5. Read back provider receipts and the ClickUp outbox result for a controlled booking. Verify EOD queue/worker delivery, message status reconciliation and payment inbox-to-ledger processing through approved controlled cases. Do not send real customer messages or create financial entries as incidental smoke tests.
6. Confirm the existing monitor, jobs and data-source freshness after release. Verify calendar sharing, report/review workers, AI replies and external resources as separate integrations. These were not proved end-to-end by the fictional preview.
7. Once the finished workflow has Aziz's approval, create the step-by-step SOP video with Higgsfield and voiceover. Use the approved UI. Do not expose personal conversations or credentials in training footage.

Known limits: the authenticated production chunk remains about 1.22 MB minified (360 KB gzip), with Vite's existing size warning. Network/provider failures still exist; this pass adds clear failure states and safe recovery, not a guarantee that the system is unbreakable. It does not change existing pay policies or prove every external worker healthy.

## Recovery

Roll the frontend back to the last verified deployment if required, while retaining the additive `checkInBookings` and `actionReceipts` tables. Keep access restrictions and the corrected worker identity guard. Do not delete receipts or automatically replay uncertain operations.

For a pending/unknown booking, inspect the exact GHL contact, calendar and time before using the internal reconciliation path documented in the booking release note. For a pending/unknown message, inspect the CRM message record before any new send. For a pending/unknown payment, inspect the exact Supabase billing inbox and ledger before any new request. Repair display fields, next dates or queue delivery separately from the original external write.
