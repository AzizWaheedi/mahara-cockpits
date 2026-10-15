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
Checks presence and configuration of required environment variables without exposing credentials, prefixes, or lengths, and asks Slack (read-only: `auth.test`, `conversations.info`) who the token posts as and whether that bot is a member of #media-eods, #eods-salesreps and #eods-csms. It fails unless the token is mahara-club-bot (`U0C0MJZNS2Y`, override with `EOD_SLACK_BOT_USER`) and the bot is in every channel:
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

### Retries and the report's Slack timestamp (`20261015b`)
- A row that failed on a Slack refusal proving nothing was posted (`channel_not_found`, `not_in_channel`, `is_archived`, `invalid_auth`, `token_revoked`, `account_inactive`, `missing_scope`, `ratelimited`, HTTP 429, no token) is queued again once an hour (pg_cron `mahara-eod-retry`, minute 12) for 48 hours from when it was filed, with `attempts` set to 4 so each retry is one try for either worker. Timeouts, 5xx, interrupted sends and anything already posted are never retried by it.
- After fixing the cause by hand, queue one row again with a full 5 tries: `select public.cockpit_requeue_eod_outbox(<id>);` as the service role. It refuses a row that is not failed, is already in Slack, or had a send started without a receipt (reconcile that first, section 3).
- Both are in `cockpit_audit_log` as `eod-retry` and `eod-requeue`. When the outbox records a Slack timestamp, a trigger copies it to `cockpit_eod_reports.slack_ts` (audit action `eod.delivered`).
- The cockpit screens read this through `cockpit_personal_eod` (`outbox`), and say "Posted to Slack at 21:04", "Waiting to post to Slack", or "Not posted yet: the Slack bot cannot see the EOD channel".
- The guardian's `queue-eod-outbox` reading is broken, at any hour, while a person's EOD is not in Slack, and names the channel and Slack's answer.

### What runs on the VPS (2026-10-15)
- The cron line runs `~/mahara-cockpits/hermes/eod-out/out.py` with no `--apply`, after sourcing `~/.editor-desk/env` then `/opt/data/bibi/api-keys.env`. That file is the 2026-09-24 copy (6faf57d8, kept on branch `vps-snapshot-2026-10-13`), not this one: it posts every `queued` row with plain REST updates, 5 tries, no claims. This repo's `out.py` is a dry run without `--apply` and needs a service-account sheet login; do not copy it over the live one until section 5 is done.
- `SLACK_BOT_TOKEN` comes from the shared `/opt/data/bibi/api-keys.env`. On 2026-10-09 to 10-14 it was another bot's token (U0BTL0GH79N, not in #media-eods), so the media buyer's EODs were refused with `channel_not_found`; from 10-14 12:36 it is mahara-club-bot's.

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

Run Python offline unit test suite (needs `google-auth`, as the worker does):
```bash
cd hermes/eod-out && python3 -m unittest test_out
```

Run in-memory PostgreSQL test suites:
```bash
cd apps/media-buyer-cockpit && bun test scripts/eod-delivery-supabase.test.ts scripts/eod-outbox-native-supabase.test.ts scripts/eod-slack-truth-supabase.test.ts scripts/personal-eod-supabase.test.ts
```

## 5. VPS release steps (Hermes)

Order: apply `20261015a` and `20261015b` first (from the Mac, through Composio), then the guardian, then the token pin. Nothing below posts to Slack or writes the sheet.

1. **Guardian** (`hermes/cockpit-guardian`, copied by hand like the rest). The VPS copy of `checks/queues.py` was byte for byte origin/main's on 10-13 (snapshot branch), but its `tests/test_coverage.py` is older than main's, so copy two files and edit two test lines rather than copying that test file:
   ```bash
   cd ~/mahara-cockpits/hermes/cockpit-guardian
   cp -a checks/queues.py checks/queues.py.bak-20261015 && cp -a tests/test_coverage.py tests/test_coverage.py.bak-20261015
   # copy in from this commit: checks/queues.py and tests/test_eod_outbox.py (new)
   # in tests/test_coverage.py, class C8FailedQueueRows:
   #   r = queues.queue_check(self.q("queue-eod-outbox"))(make(rows))  ->  r = queues.run_eod_outbox(make(rows))
   #   self.assertEqual(r.status, WARN)  (the line after it)          ->  self.assertEqual(r.status, FAIL)
   #   self.assertEqual(self.q("queue-eod-outbox").limit_min, 15)     ->  self.assertEqual(queues.EOD_WAIT_MIN, 15)
   python3 -m unittest discover -s tests -t .            # all pass, no network
   python3 guardian.py scan --only queue-eod-outbox --dry-run   # reads only: expect ok while nothing is failed
   ```
   The next cron run (every 5 minutes, under `~/.cockpit-guardian/run.lock`) uses it. To roll back, copy the `.bak-20261015` files back and delete `tests/test_eod_outbox.py`.
2. **The eod-out token** (stops the 10-12 failure coming back when someone edits the shared key file): put mahara-club-bot's token in its own file and source it last on the eod-out cron line.
   ```bash
   install -m 600 /dev/null ~/.eod-out.env && nano ~/.eod-out.env   # one line, pasted by hand: SLACK_BOT_TOKEN=<mahara-club-bot token>
   crontab -e   # on the eod-out line only: after ". /opt/data/bibi/api-keys.env;" add "[ -f $HOME/.eod-out.env ] && . $HOME/.eod-out.env;"
   ```
   Change that line in `hermes/cockpit-guardian/crontab.manifest` in the same commit (the `vps-crontab` check compares by command). Check the identity with this repo's doctor from a scratch copy, which only reads Slack:
   ```bash
   mkdir -p ~/eod-out-check && cp <this commit's out.py> ~/eod-out-check/out.py
   bash -c 'set -a; . ~/.editor-desk/env; . /opt/data/bibi/api-keys.env; . ~/.eod-out.env; set +a; python3 ~/eod-out-check/out.py --doctor'
   ```
   Expect "the token posts as mahara-club-bot (U0C0MJZNS2Y)" and "member" for the three channels. The Google line reads missing until step 3; that is expected for the live 6faf57d8 worker, which files the sheet through the editor desk's login.
3. **Only later, and only together**: replacing the live worker with this `out.py` needs the cron line changed to `python3 out.py --apply` (and `crontab.manifest`, `guard/jobs.py` and `tests/test_safety.py` updated to match), `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service account the EOD sheet is shared with, `google-auth` installed, `--doctor` passing and `python3 -m unittest test_out` run. Until then the 6faf57d8 copy stays.
