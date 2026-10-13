# Ad billing watch

Status: shared approval is live as of 12 October 2026 for 16 verified Active clients. Both apply switches are enabled after SQL, both frontends and provider readback were verified. Activation posted seven CSM cards and edited seven existing media cards, with no new client WhatsApp or ClickUp comments. The five-minute source worker, guardian and independent watchdog continue. See the shared project record for current release evidence.

This service checks Meta billing for explicitly enrolled clients. It requires a current Active status on the exact Clients task before each message. It posts a review to private CSM general and media announcements and records observations on both ClickUp task types. Client WhatsApp requires approval from either the CSM or media buyer. The first decision closes the review for both; denial requires a reason. Both Slack cards lose their decision buttons on the next worker update, normally within five minutes. Duplicate approval is blocked immediately in the database, including stale links or simultaneous clicks. The status and audit record remain visible. New Slack posts and client messages each have a rolling 72-hour cap. Unresolved incidents keep the same compact card, even after 72 hours. Only a genuinely new incident can post again after that limit.

## What it can detect

| Source signal | Action |
| --- | --- |
| Meta account status 9 | Draft a payment-grace warning for approval before a possible interruption. |
| Meta account status 3 | Draft an unsettled-balance notice for approval. Notify the team and comment on both task types. |
| Meta account status 2 or another restriction | Notify the team for investigation. Do not tell the client that a card declined. |
| Two active-status reads at least four minutes apart | Record recovery, expire unsent approvals and update the existing Slack cards. No automatic client message. |
| Missing access, missing status, or a changed mapping | Block outbound messages for that binding. Show the fault. Keep the previous incident open. |

The API does not expose the bank's available funds or guarantee an advance warning of an issuer decline. Status 3 is not proof that a particular card was rejected. The messages preserve that distinction. They do not promise a retry time, claim that ads are delivering, or convert debt to dollars.

The card suffix is optional. The parser accepts a masked card label, including the observed `VISA *1234` format. It rejects full card numbers and account IDs. It displays Arabic digits in client messages. No card number, CVV, expiry, or banking credential is stored.

Sources: [Meta account fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py), [funding source fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/fundingsourcedetails.py), [Whapi API](https://whapi.cloud/docs).

## Daily use

1. Open **Today** or **Ads management** in the media buyer cockpit.
2. Read **Ad billing watch**. Check the last run, active-client coverage and open issues.
3. Open **Daily ad billing review**. Check the exact account and Arabic draft. Approve, edit then approve, or deny with a reason. Record today’s check without clearing pending issues.
4. If a message says **unknown**, inspect provider history. Do not resend it manually without checking.
5. Correct a missing account link through technical operations. A name or tag is not enough to enroll an account.

“Accepted by provider” means the API returned a message or comment ID. It does not mean that a client read the WhatsApp message. Client and Ads Management comments are separate deliveries. A partial failure does not undo completed deliveries.

## Historical installation, 11 October 2026

These receipt counts describe the former automatic sender. The approval policy above supersedes that behavior.

- Runtime and database notification switches are on. All 16 bindings have current identity checks and recorded manual cutover evidence.
- First live batch: 5 WhatsApp messages, 6 private Slack messages and 12 ClickUp comments accepted. No delivery is queued, failed or unknown.
- The 19:45 UTC unattended poll checked 16 bindings with no failures and no duplicate notifications.
- Private media channel: `C0AF4SDLWNL`, `media-announcments`. The existing native bot can now access it.
- Whapi.Cloud uses the existing approved sender. The private runtime contains its token. No credentials belong in this repository.
- Make `8866601` remains active. Both failure and recovery branches exclude only enrolled client Meta alerts. Other clients and platforms retain their manual routes. Verified revision: `2026-10-11T19:39:26.103Z`.
- نهوض نجد now uses its verified current group. The stale Client Data group was corrected after a member matched the exact client contact.
- Brillant Touch Company (`86ex4j8f3`) remains unenrolled. Its group is verified, but no usable Meta account ID exists in its Sheet row or two ads tasks. A fully paged scan of 45 accessible accounts and their campaigns found no exact match. Signed-in Ads Manager account searches also found no matching alias. Keep the manual route until ownership and API access are verified. Mahara has no access to its Meta ad account (Muhammed, 13 October 2026), so the guardian's coverage check excludes it (`NO_META_ACCESS` in `hermes/cockpit-guardian/checks/ad_billing.py`). The same check now accepts a finish time up to 5 minutes after the scan's clock: the worker and the guardian start on the same 5-minute marks, and a run that finished during the scan had read as "no completed run within 15 minutes" (the false Broken of 12 October).
- Zeiad Playing Account (`86ex08t5v`) is an internal sandbox. An explicit ID exclusion keeps it out of production eligibility and coverage, even when its dropdown says Active.
- The panel is live at <https://cockpit.maharamedia.com/dashboard>. Production deployment `dpl_FLysUt5eQrtMVnWLfrSXuAHxZeSc` serves frontend source `f711d9b94f2d2fcf7ab25577536c143580c262d9`.

Provider acceptance is verified. Client device delivery and reading are not established by these receipts. Account status is time-specific.

## Remaining coverage action

Find Brillant Touch's numeric Meta account from its actual Ads Manager account or a current owner-provided account link. Verify the worker token can read that exact account. Then verify the matching campaign and ads task, repair the blank account reference, enroll disabled, validate, and complete its scoped manual handover before enabling.

## Manual-flow cutover

Make scenario `8866601` must not send the same Meta incident alongside this worker. Do not switch off the whole scenario: it also handles other platforms and clients.

Before enabling one client, add and read back an exact Clients-task-ID exclusion on both the `ADS_FAILED` and `ADS_BACK_LIVE` routes for that client's Meta notifications. Apply the exclusion to the WhatsApp and associated comment actions. Preserve the current routes for every other client/platform. If the form cannot supply or establish that exact ID without ambiguous name matching, correct the form/lookup first and leave the new binding blocked.

Save the scenario revision and test evidence in `manual_cutover_evidence`. A Boolean alone cannot establish the handover. The installed 16-client handover follows these rules. New clients still require their own verified exclusion.

## Files and verification

- `hermes/ad-billing-guard`: polling, exact-ID checks, provider adapters, enrollment validation, receipt reconciliation.
- `supabase/migrations/20261011174920_ad_billing_guard.sql`: private registry, incidents, outbox, atomic claims, audit records, scoped dashboard read.
- `apps/media-buyer-cockpit/src/components/AdBillingWatch.tsx`: the team view.
- `hermes/cockpit-guardian/checks/ad_billing.py`: independent stale-worker, coverage and failed-delivery detection. The guardian uses its existing alert path; it never retries a client message.
- `apps/media-buyer-cockpit/scripts/ad-billing-guard.test.ts`: 35 tests against the real SQL in isolated PostgreSQL and synthetic provider transports.
- `apps/media-buyer-cockpit/scripts/ad-billing-watchdog.test.ts`: 7 independent-watchdog tests.
- `apps/media-buyer-cockpit/scripts/ad-billing-approval.test.ts`: 32 approval, access, cooldown, race and two-channel card tests.
- Guardian regression suite: 314 tests with Python 3.11 or later.
- App production build and worker TypeScript check pass.
- Desktop 1280 px and phone 390 px previews pass overflow and Arabic-digit checks. These are synthetic previews, not delivery tests.

Follow [the operator runbook](RUNBOOK.md) for installation, incident handling and rollback.
