# Ad billing watch operator runbook

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
13. Release the cockpit panel and guardian check through their normal reviewed releases. Confirm the guardian detects a synthetic stale heartbeat without sending a client alert. The guardian is a separate process on the VPS. Verify the existing external VPS outage alert before broad rollout; two processes on one failed host cannot alert each other.

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

Back up the database with the existing Supabase backup process. Retain unresolved events and unknown receipts. This candidate does not delete billing history automatically. Review retention before a broad rollout.
