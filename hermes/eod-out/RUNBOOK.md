# Runbook: EOD Delivery Worker (`hermes/eod-out/out.py`)

Carries End of Day reports from `eod_outbox` in Supabase to Slack channels and the EOD Reports Google Sheet tabs safely.

## 1. Operational Modes & Deployment Recipe

### Deployment with `flock`
To prevent overlapping cron runs on the host VPS, always execute live delivery under a non-blocking `flock`:
```bash
flock -n /var/lock/hermes-eod-out.lock python3 hermes/eod-out/out.py --apply
```
> [!IMPORTANT]
> Explicit orchestrator/human approval is required before running outward `--apply` or modifying rows during reconciliation.

### Dry Run (Default)
When run without `--apply`, the worker defaults to `DRY_RUN = True`. It queries queued rows and logs an intended-action summary without executing Slack posts, Google Sheets appends, or database modifications:
```bash
python3 hermes/eod-out/out.py
```
Preview output accurately notes if Slack or Sheet is already receipted from a previous partial run.

### Live Delivery (`--apply`)
```bash
python3 hermes/eod-out/out.py --apply [--limit 20] [--lease 300]
```
Bounds enforced: `--limit` (1..100), `--lease` (10..3600 seconds).

### Doctor (`--doctor`)
Checks presence and configuration of required environment variables without exposing credentials, prefixes, or lengths:
```bash
python3 hermes/eod-out/out.py --doctor
```
Required variables:
- `DESK_SUPABASE_URL`
- `DESK_SUPABASE_KEY` (service role)
- `SLACK_BOT_TOKEN`
- `GOOGLE_APPLICATION_CREDENTIALS`: path to the service-account JSON on the host. Share the EOD sheet with that service account. Personal OAuth refresh tokens are not used.
- Python dependencies: `google-auth` 2.48.0 and `requests` 2.32.5 were used for local verification. The production environment must supply compatible packages before activation.

### Producers
- Native media buyer, CSM and creative director EODs: a submit through `cockpit_save_personal_eod` queues exactly one row, linked by `eod_outbox.report_id` (migration `20261009g_eod_outbox_native.sql`, which needs `20260927b` first). A draft queues nothing. A repeated submit returns the same row.
- Sales EODs: `supabase/functions/sales-api` (`sales_setter`, `sales_closer`). Client success wins: `csm-win` rows from `20261004a_csm_churn_projections.sql`.
- Reports submitted before `20261009g` were never queued. Queue one only after approval: `select public.cockpit_enqueue_personal_eod(<report id>);` as the service role.

## 2. Safety, Claims & Fencing Architecture

1. **Atomic Claims**: Worker calls `cockpit_claim_eod_outbox(worker_id, lease_seconds, limit)`. It uses `FOR UPDATE SKIP LOCKED` and generates a unique `claim_token`. Simultaneous workers never claim the same row.
2. **Durable Intent Before Send**: Before initiating Slack or Google Sheets calls, the worker records durable send intent via `cockpit_start_eod_send(id, worker_id, claim_token, transport)`.
3. **Lease & Identity Fence**: Receipts are confirmed via `cockpit_record_eod_receipt` matching `status = 'processing'`, `claimed_by = worker_id`, `claim_token = token`, and active unexpired lease.
4. **Receipt Persistence Failure**: If an external send succeeds but the receipt cannot be persisted to Supabase, further sends on that row are halted immediately to fail closed. The successful external effect is not downgraded to retryable.
5. **Confirmation of `sent`**: Status is only marked `sent` once both required receipts (`slack_ts` and `sheet_at` when sheet is configured) are confirmed in the database.
6. **Producer Protection Trigger**: `trg_protect_eod_outbox` prevents cockpit producers from re-queuing in-flight processing rows or overwriting confirmed receipts on sent rows.
7. **Audit Logging**: Every outbox insert/update, including recovery, is recorded in `public.cockpit_audit_log`. A missing audit table fails the write.
8. **Provider Calls**: Each append/post gets one HTTP attempt. Explicit provider rejections may retry; malformed receipts and unknown outcomes require reconciliation. The shared editor HTTP wrapper retries POSTs and is deliberately not used here.

## 3. Ambiguous Outcomes & Reconciliation

Because HTTP calls to external APIs are not transactional:
- If a Slack post or Google Sheets append experiences a network timeout, dropped socket, or 5xx response after transmission, the worker cannot guarantee whether the external service completed the action.
- The worker **fails closed**:
  - Sets `reconciliation_needed = true`.
  - Records `reconcile_reason` detailing the transport error.
  - Marks `status = 'failed'` to halt automatic processing.
- Similarly, on lease recovery, if a crashed row had a send started (`slack_started_at` or `sheet_started_at`) but no confirmed receipt, it automatically transitions to `reconciliation_needed = true`.

### Reconciliation Procedure
1. Query rows flagged for reconciliation:
   ```sql
   select id, role, day, person, channel, tab, slack_ts, sheet_at, reconcile_reason
   from public.eod_outbox
   where reconciliation_needed is true;
   ```
2. Check Slack channel for message timestamp and target Google Sheet tab for row existence.
3. If delivery already succeeded externally:
   After approval, record the observed receipt (`slack_ts` or `sheet_at`). Mark `sent` only when every required transport is confirmed; the database enforces this.
4. If delivery did not occur:
   After approval and verification that no request remains in flight, clear only the unresolved transport's send-start marker, release the claim/token/lease, clear the reconciliation flag, and queue the row. Preserve any successful receipt. Review exhausted attempts explicitly. Never change recipients or report contents after a claim.

## 4. Verification Commands for Codex

Run Python offline unit test suite:
```bash
python3 -m unittest hermes/eod-out/test_out.py
```

Run in-memory PostgreSQL test suite:
```bash
bun test apps/media-buyer-cockpit/scripts/eod-delivery-supabase.test.ts
```
