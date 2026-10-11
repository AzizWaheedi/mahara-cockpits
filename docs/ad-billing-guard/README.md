# Ad billing watch

Status: implementation candidate. No migration, worker, schedule, or outbound test is live from this change.

This service checks Meta billing for explicitly enrolled clients. It requires a current Active status on the exact Clients task before each message. It sends one incident notification to the client group, private media channel, Client task and each verified Ads Management task. Repeated polls do not repeat the notification.

## What it can detect

| Source signal | Action |
| --- | --- |
| Meta account status 9 | Warn the client about the payment grace period before a possible interruption. |
| Meta account status 3 | Ask the client to check an unsettled balance. Notify the buyer and comment on both task types. |
| Meta account status 2 or another restriction | Notify the team for investigation. Do not tell the client that a card declined. |
| Two active-status reads at least four minutes apart | Record recovery. Send a client update only if the earlier incident message has a provider receipt. |
| Missing access, missing status, or a changed mapping | Block outbound messages for that binding. Show the fault. Keep the previous incident open. |

The API does not expose the bank's available funds or guarantee an advance warning of an issuer decline. Status 3 is not proof that a particular card was rejected. The messages preserve that distinction. They do not promise a retry time, claim that ads are delivering, or convert debt to dollars.

The card suffix is optional. The parser accepts a masked card label, including the observed `VISA *1234` format. It rejects full card numbers and account IDs. It displays Arabic digits in client messages. No card number, CVV, expiry, or banking credential is stored.

Sources: [Meta account fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py), [funding source fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/fundingsourcedetails.py), [Whapi API](https://whapi.cloud/docs).

## Daily use

1. Open **Today** or **Ads management** in the media buyer cockpit.
2. Read **Ad billing watch**. Check the last run, active-client coverage and open issues.
3. Open the linked client task or Meta billing account to investigate.
4. If a message says **unknown**, inspect provider history. Do not resend it manually without checking.
5. Correct a missing account link through technical operations. A name or tag is not enough to enroll an account.

“Accepted by provider” means the API returned a message or comment ID. It does not mean that a client read the WhatsApp message. Client and Ads Management comments are separate deliveries. A partial failure does not undo completed deliveries.

## Verified live audit, 11 October 2026

- The current manual flow, Make `8866601`, is active. Its earlier inactive status in shared notes is obsolete.
- It selects a Sheet row by client tag/name, uses Whapi connection `12702724`, and comments on the Clients task. It does not provide the new exact-ID account registry or durable four-destination delivery ledger.
- Its failure text promises a retry in three hours and formats the amount as USD. The new templates omit those unsupported claims.
- The private channel is `C0AF4SDLWNL`, named `media-announcments`.
- The existing native VPS Slack token returns `channel_not_found` for that channel. Membership/access must be fixed or an approved bot connection must be used.
- The native runtime has Meta, ClickUp, Google and Slack credentials. It has no `AD_BILLING_WHAPI_TOKEN`. The healthy Make connection does not prove that the new worker can send.
- Live ClickUp lists 18 Active tasks, including Zeiad Playing Account. The Sheet mirror earlier listed 17. The worker uses fresh ClickUp status and explicit enrollment, not the mirror's count.
- The audit found usable Meta account URLs on candidate ads tasks for only three of those Active clients. These are review candidates, not approved bindings.
- The Joe and Sera candidate account `955658453671990` reported status 3. The Alkhalil and Nuhood Najd candidate accounts reported status 1. These readings are time-specific, not a current all-client health certificate.
- The Joe and Sera funding response exposed a masked VISA label. The Alkhalil response exposed no display label. Missing digits are omitted, never invented.

No client, Slack, or ClickUp incident notification was sent by this implementation during the audit. No campaign, payment, manual scenario, or client record was changed.

## Release prerequisites

1. Review the PR and approve installation. The repository requires explicit deployment approval.
2. Verify each mapping. Keep Zeiad and other test accounts unenrolled. Check every Meta account a real client uses.
3. Repair missing Meta URLs on the correct ads tasks after identity verification. Do not fill them from fuzzy names.
4. Save the existing approved Whapi channel token privately as `AD_BILLING_WHAPI_TOKEN`. Confirm the intended sender and group access. Do not paste the token into Git or chat.
5. Give the approved Slack bot access to `C0AF4SDLWNL`. Read back `conversations.info` and confirm membership.
6. Complete the manual-flow cutover for each enrolled client. Preserve other platforms and unenrolled clients. Record evidence before setting `manual_cutover_verified`.
7. Run the installed worker with notifications off. Inspect its roster and billing results for one full scheduled interval.
8. Use a designated internal test group and synthetic ClickUp tasks for the transport test. Verify the WhatsApp message, Slack post and both comments by their provider IDs.
9. Enable one approved real client. Verify all receipts, then expand the enrollment. Verify the independent watchdog too.

## Manual-flow cutover

Make scenario `8866601` must not send the same Meta incident alongside this worker. Do not switch off the whole scenario: it also handles other platforms and clients.

Before enabling one client, add and read back an exact Clients-task-ID exclusion on both the `ADS_FAILED` and `ADS_BACK_LIVE` routes for that client's Meta notifications. Apply the exclusion to the WhatsApp and associated comment actions. Preserve the current routes for every other client/platform. If the form cannot supply or establish that exact ID without ambiguous name matching, correct the form/lookup first and leave the new binding blocked.

Save the scenario revision and test evidence in `manual_cutover_evidence`. A Boolean alone cannot establish the handover. This change does not modify the existing scenario or claim that its exclusion is installed.

## Files and verification

- `hermes/ad-billing-guard`: polling, exact-ID checks, provider adapters, enrollment validation, receipt reconciliation.
- `supabase/migrations/20261011174920_ad_billing_guard.sql`: private registry, incidents, outbox, atomic claims, audit records, scoped dashboard read.
- `apps/media-buyer-cockpit/src/components/AdBillingWatch.tsx`: the team view.
- `hermes/cockpit-guardian/checks/ad_billing.py`: independent stale-worker, coverage and failed-delivery detection. The guardian uses its existing alert path; it never retries a client message.
- `apps/media-buyer-cockpit/scripts/ad-billing-guard.test.ts`: 32 tests against the real SQL in isolated PostgreSQL and synthetic provider transports.
- Guardian regression suite: 314 tests with Python 3.11 or later.
- App production build and worker TypeScript check pass.
- Desktop 1280 px and phone 390 px previews pass overflow and Arabic-digit checks. These are synthetic previews, not delivery tests.

Follow [the operator runbook](RUNBOOK.md) for installation, incident handling and rollback.
