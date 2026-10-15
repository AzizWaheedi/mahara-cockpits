# Ad billing watch operator runbook

## Shared approval and three-day cadence (12 October)

Client WhatsApp is never sent from detection alone. Either the CSM or media buyer opens the private
`#csm-general` or `#media-announcments` card, reviews the Arabic text and either
approves it, edits then approves, or denies with a mandatory written reason.
Buttons are safe links to the authenticated shared review page:
https://cockpit.maharamedia.com/client-success/ad-billing
Opening a link, including a Slack unfurl, cannot approve anything.

The CSM Today page and media buyer billing panel include **Daily ad billing review**.
Either role may decide within their existing client access. The first decision
locks the review for both. Media buyers do not gain access to other CSM pages. Record the daily check
there; this records attention without clearing unresolved items or sending.
Decisions and their authors are retained. Current seat/client access is checked
at decision time and again before sending an approved draft.

- A compact three-line Slack card identifies the client, issue and decision.
  Approve, Edit and Deny URL buttons open the secure review page with the full Arabic draft.
  An unresolved incident always reuses its existing card, even after 72 hours.
  A genuinely new incident can create a new card only after the rolling 72-hour budget.
  Status changes and decisions update that bot's existing card with `chat.update`.
  Approve/Edit/Deny buttons are present only for a pending review. After either role
  decides, both cards retain the status and review link but lose those buttons on
  the next five-minute worker run. The database closes the review immediately,
  so stale buttons, concurrent clicks and an open browser cannot cause a second send.
  Ambiguous or failed Slack receipts do not cause replacement spam.
- Client WhatsApp also has a rolling 72-hour cooldown across billing states.
  Existing accepted messages count. An unresolved send blocks further messages
  until its actual provider result is reconciled.
- A pending review expires after 72 hours. An approved draft expires after 24
  hours or on a changed account, card suffix, billing signal or destination.
  A continuing incident can produce a new review cycle, always requiring a new
  human decision. No automatic recovery WhatsApp is generated.
- Approve queues a message, normally delivered on the next five-minute run.
  The UI distinguishes queued from provider-accepted. A fresh Active-client,
  task, sheet, exact Meta account and current signal check still precedes send.
- ClickUp comments continue to record actual billing observations on the client
  and its verified Ads Management tasks, independently of the client decision.
- The yellow-warning draft does not invent a three-hour payment retry, debt,
  currency or confirmed bank decline. Card suffixes appear only when verified.

Migration `20261012110708_ad_billing_approval.sql` deliberately pauses database
apply. Apply `20261012114355_ad_billing_shared_reviewers.sql` and
`20261012115521_ad_billing_quiet_slack_cards.sql` and
`20261012120601_ad_billing_close_slack_review.sql`. Deploy the matching worker and both UIs, verify permissions and review
links, then enable database/runtime apply together. Never roll back to the
pre-approval observer/sender; rollback must leave apply disabled. Raw review
and delivery tables remain unavailable to browser roles.

Existing manual Make scenario 8866601 stays excluded for the 16 enrolled Meta
clients. Unenrolled clients and other platforms still use the existing manual
route; this rollout does not migrate those unrelated manual paths. Brillant
Touch still requires exact Meta account identity before enrollment.

## Ownership and credentials

Use the existing Creative Triage Supabase project `bldgtotkfmhoxmlzowdx`. The worker refuses any other database URL. Do not create a new project or modify the native media publication tables.

Use a private JSON runtime file, readable only by its service user. Required keys:

```text
DESK_SUPABASE_URL
DESK_SUPABASE_KEY
CLICKUP_API_TOKEN
META_SYSTEM_TOKEN
GOOGLE_APPLICATION_CREDENTIALS
SLACK_BOT_TOKEN
AD_BILLING_WHAPI_TOKEN
AD_BILLING_APPLY=false
```

`AD_BILLING_SUPABASE_URL` and `AD_BILLING_SUPABASE_KEY` are explicit overrides. Otherwise the worker uses the existing DESK keys, then the generic Supabase keys. The provider is Whapi.Cloud. A separate Waapi provider requires a separate reviewed adapter.

Do not reuse or replace the `cockpit-native-current` symlink to deploy this worker. Install its bundle and wrapper in a separate versioned directory. Keep logs and its lock in a private state directory.

## Build and test

From the repository root, with the repository's compatible Bun version:

```sh
cd apps/media-buyer-cockpit
bun install --frozen-lockfile
bun test scripts/ad-billing-guard.test.ts
bun run build
cd ../..
bun build hermes/ad-billing-guard/main.ts --target=node --outfile=dist-ad-billing/worker.mjs
bun build hermes/ad-billing-guard/enroll.ts --target=node --outfile=dist-ad-billing/enroll.mjs
```

From `hermes/cockpit-guardian`, run `python3 -m unittest discover -s tests` with Python 3.11 or later. The macOS system Python 3.9 cannot run six pre-existing guardian tests that use `TestCase.enterContext`.

From `apps/media-buyer-cockpit`, run `bun run harness` and open `/ad-billing-harness.html` for the synthetic English/Arabic preview. It has no provider calls.

## Install after approval

1. Apply the reviewed migration to Creative Triage. Verify its grants. Browser roles must not read the raw tables or execute worker RPCs.
2. Copy the built `worker.mjs`, `enroll.mjs`, and `run.sh` into the separate release directory. Node 22 or later is required.
3. Run `node worker.mjs --doctor --config /private/runtime.json`. It prints presence checks, not credentials.
4. Run `node worker.mjs --audit --config /private/runtime.json`. This reads Active client tasks and candidate account links. It does not enroll a client, persist data, or send anything.
5. Prepare a private reviewed enrollment manifest. Each entry needs `client_task_id`, `client_name`, numeric `account_id`, `ads_task_ids`, `whatsapp_group`, the exact `sheet_account_ref`, `identity_evidence`, and `identity_verified_at`.
6. Verify the manifest with `node enroll.mjs --manifest /private/bindings.json --config /private/runtime.json`. No save occurs.
7. Add `--save-disabled` to save new bindings disabled. The command has no upsert and cannot overwrite an existing binding. After a partial import failure, inspect saved rows before importing the remaining rows.
8. Enable monitoring on reviewed bindings with a scoped service-role update. Keep global `apply=false` and runtime `AD_BILLING_APPLY=false`.
9. Install a five-minute cron entry for `run.sh`. Set `AD_BILLING_CONFIG` and `AD_BILLING_STATE_DIR` in the private service environment. Set PATH to the installed Node, flock and timeout binaries. Preserve every unrelated cron line.
10. Observe the next unattended run. Verify `last_finished_at`, the complete Active roster, each binding, the actual schedule, and logs. A fresh heartbeat is not proof of message delivery.
11. Finish the manual scenario exclusions and save the evidence. Set `manual_cutover_verified=true` only for the approved bindings.
12. Complete the internal transport test. Enable both global `apply` and runtime `AD_BILLING_APPLY` only after approval of the real-client pilot.
13. Release the cockpit panel and guardian check through their normal reviewed releases. Confirm the guardian detects a synthetic stale heartbeat without sending a client alert. The guardian is a separate process on the VPS. Verify the independent Supabase watchdog described below. Two processes on one failed host cannot alert each other.

No cron or deployment is installed by the migration. There are three separate notification gates: runtime apply, database apply, and the binding's verified manual cutover.

## Exact identity rules

- The Clients task must be in list `901816559981`, unarchived, and currently Active by the Client Status option.
- Client Data must have exactly one row for that task ID. Its WhatsApp group and account reference must match the verified binding.
- A numeric account value is preferred. An account name requires a reviewed numeric binding and an unchanged source reference. Names and tags can suggest audit candidates but never create an enrollment.
- Every ads task must be in list `901817774521`, unarchived, and have a trusted Meta URL for the exact account.
- The database permits only one binding for each numeric account. Shared accounts require manual investigation; never attach them to two clients.
- Changes to identity or enrollment increment the binding revision, invalidate unsent notifications, and require a fresh check.
- The worker repeats the source checks before every external write. A payment can still change after the last read. An in-flight request cannot be recalled by a later stop.

## Delivery failures

| State | Action |
| --- | --- |
| queued | Wait for the scheduled worker. Check the three gates and last source check if it remains queued. |
| retry | The provider explicitly rejected the request with HTTP 429. The worker uses bounded backoff, up to five attempts. |
| claimed | No send intent exists yet. An expired claim can return to the queue. |
| sending | The durable send intent was recorded. A crash or timeout becomes unknown, not a replay. |
| accepted | Keep the provider receipt. This does not confirm WhatsApp delivery to a device or a read. |
| failed | Repair credentials, destination access, or the source mismatch. Check the error and reconcile before a scoped requeue. |
| unknown | Inspect provider history for the exact `BG-<delivery UUID>` marker. Automatic reconciliation records a matching receipt. Absence from the recent history page is not proof of failure. |
| skipped | A newer observation or binding revision replaced the intent. Do not restore the old notification. |

For a failed delivery, do not bulk-reset the queue. Check the exact account, Active status and destination again. Record the operator's review in the incident before resetting only a definitely rejected, current delivery. Never reset an unknown delivery without provider evidence.

The guardian alerts technical operations on stale runs, failed or unknown sends, overdue queued sends, and missing coverage. The media panel remains the detailed incident view. The initial client alert and private media alert use the same incident event. No automatic client reminder loop is enabled.

## Stop and recover

Set `cockpit_ad_billing_config.apply=false`. Set `AD_BILLING_APPLY=false` in the private runtime. These stop new sends; they do not recall a request already accepted by a provider.

Keep the incident tables, receipts and logs. Do not restore the old Make path until you check in-flight and unknown notifications. Re-enable the old client/platform route only after an explicit handover, or both systems can send the same message.

Back up the database with the existing Supabase backup process. Retain unresolved events and unknown receipts. This service does not delete billing history automatically. Review retention before a broad rollout.


## Installed external watchdog

The billing-specific watchdog runs outside the VPS in Creative Triage Supabase. It does not depend on the older Cloudflare guardian heartbeat.

- Edge Function: `ad-billing-watchdog`, version 1.
- Database migration: `20261011195000_ad_billing_watchdog.sql`.
- Cron: job `472`, `mahara-ad-billing-watchdog`, schedule `2-59/5 * * * *`.
- Cron invokes the Edge Function with the existing Vault-held `CRON_SECRET`. Do not print or copy the secret into SQL scripts or logs.
- `POST {"probe":true}` with authorized credentials checks private Slack access without sending a message.
- Scheduled `POST {}` checks stale runs, source failures and overdue or failed deliveries.
- `cockpit_ad_billing_watchdog` records the claim and Slack receipt. A repeated condition does not send another alert.
- A timeout retains `unknown`. Inspect Slack history before a manual retry.

Verify the cron row, recent `cron.job_run_details`, and the watchdog `checked_at`. A healthy state does not prove that a simulated VPS outage was tested live. Offline tests cover stale-worker detection and notification deduplication. The first unattended healthy run passed at 19:42 UTC on 11 October 2026.

## Installed worker and rollback paths

Runtime: `/home/hermes/.ad-billing-guard/runtime.json`, mode 600. Logs and lock share that private directory. Release symlink: `/home/hermes/ad-billing-current`. Keep `/home/hermes/cockpit-native-current` unchanged.

The worker runs every five minutes under `flock` and a 540-second timeout. It rechecks all source mappings before each send. Zeiad sandbox task `86ex08t5v` is excluded by exact ID.

The first live run produced 23 accepted receipts. The next scheduled run produced no duplicate alerts. Preserve these receipts during rollback. Never enable both the old manual route and this worker for the same client and platform.
