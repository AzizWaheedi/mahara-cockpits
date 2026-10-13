# CSM calls worker runbook

**Owner:** Hermes. **Decision:** no client messages, bookings, ClickUp writes or provider writes. The worker reads GoHighLevel, Fathom, Typeform, Meta and the cockpit's source tables; it publishes only to the private CSM call store. It never edits `hermes/cockpit-sync/worker.ts`, never resumes Convex, and never turns on `CLICKUP_WRITEBACK_APPLY`.

## Where it runs

- Release: `/home/hermes/csm-calls-current` → `/home/hermes/.csm-calls-releases/<sha>`. Never run from `~/mahara-cockpits`.
- Bun is the tool packaged with `/home/hermes/cockpit-native-current/tools/bun`. Runtime env is `/home/hermes/.cockpit-native-state/runtime-<native-release-name>.json`, with optional `/opt/data/bibi/api-keys.env`. Values must not enter output or Git.
- Cron, under hermes on a UTC VPS clock:
  ```cron
  */15 * * * * flock -n $HOME/.csm-calls/run.lock $HOME/csm-calls-current/hermes/csm-calls/run.sh run --apply --report $HOME/.csm-calls/last-run.json >> $HOME/.csm-calls/cron.log 2>&1
  0 3 * * * flock -n $HOME/.csm-calls/reconcile.lock $HOME/csm-calls-current/hermes/csm-calls/run.sh reconcile --apply --report $HOME/.csm-calls/last-reconcile.json >> $HOME/.csm-calls/reconcile.log 2>&1
  ```
  The release’s `run.sh` resolves the current native release each tick and names its private runtime file. No copied keys or static env path.
- Doctor: `$HOME/csm-calls-current/hermes/csm-calls/run.sh doctor` from the release. It checks key names and reads one item per provider. It never prints values.
- Dry run: same command with `run --report ~/.csm-calls/dry.json` (without `--apply`). `--apply` only after doctor and a dry run pass. Reports stay outside Git.

## Sources

| Health key | Reads | Named key | Rerun | History |
|---|---|---|---|---|
| `csm-ghl-calls` | The client GHL location's appointment calendars, plus each appointment's contact Client ID. A full window marks absent appointments `gone` only after every calendar succeeds. | `GHL_CLIENT_PIT` | `run --apply --only ghl` | `backfill --source ghl --apply` from 1 Jun 2026 in windows |
| `csm-checkin-form` | Typeform fRokTITH, every response, every answer. The client is the hidden `task_id` the client page's form link carries (`hidden_field`), else the typed Client ID (`typed_task_id`); the typed answer is always kept, and the note counts links that differ from the typed id. A response with neither on the board goes to the unmatched queue. | `TYPEFORM_TOKEN` | `run --apply --only typeform` | Full responses on rerun |
| `csm-forms-history` | The onboarding, current and retired kickoff, and Blueprint Typeforms, all answers even if the question ref was deleted. | `TYPEFORM_TOKEN` | same | Full responses on rerun |
| `csm-fathom` | Fathom meetings since 7 days before the latest good read; only an external invitee becomes a client call. Summaries and transcripts are retained only for external-invitee meetings. No recording shared with this key can be read, including private CSM recordings. | `FATHOM_API_KEY` | `run --apply --only fathom` | `backfill --source fathom --apply` from 1 Jul 2026 |
| `csm-meta-activities` | Ad account `/activities` for clients; only person-made changes. Each account failure is named. | `META_SYSTEM_TOKEN` | `run --apply --only meta` | `backfill --source meta --apply` 90 days |
| `csm-media-changes` | The cockpit's media buyer decisions, actions, campaign messages and manual changes, plus the separate Meta activity table. | Supabase service role key | `run --apply --only changes` | Rerun rebuilds 90 days |
| `csm-reconcile` | Yesterday's counts/IDs in GHL, Fathom, Typeform and Meta compared with the store. | The same read keys | `reconcile --apply` | Daily at 03:00 UTC, 06:00 Kuwait |

Every provider read goes through `lib.ts` transport. Receipts land in `cockpit_csm_provider_health`, keyed by run. Health is in `cockpit_sync_state`; a failure in one source keeps its last good rows while others run. Guardian sends its own incidents to Slack `#health`, never Telegram. It checks seven source keys, 21-day live-client call coverage, 7-day unmatched share, latest 1-1 note, linked recording/form coverage, and changes for spending clients. An HTTP 200 with a body of errors is failure, not a successful sync.

## Alerts

- `csm-*-stale` or `-failing`: inspect the health row's `note`/`detail`, private `~/.csm-calls/cron.log`, and provider receipts; rerun only the affected source. No key in the log.
- A GoHighLevel unmatched call: check the contact's Client ID against ClickUp list `901816559981`. The CSM can use the client's unmatched queue; the match is audited and survives reruns. Do not edit real GHL contacts just to test.
- Fathom low coverage: recordings belong to the recorder. Shared team recordings only are visible with this key. CSM sharing or a per-user key is Aziz's decision. Internal meetings never become client calls.
- Blueprint missing: the bare creative Key Links form does not carry `onboarding_client_id`. Send the client-specific link from their card. Adding a hidden field to the Typeform is Aziz's decision.
- Meta stale: the creative dashboard's Meta API may still be blocked even if this independent activity read works. Check per-account errors. Do not claim a change-free client while the source is stale.
- Reconciliation mismatch: inspect the named source and missing IDs in the `csm-reconcile` row. Never replay old outbox rows or switch ClickUp writeback on as a recovery step.

## Release / rollback

Stage a fresh immutable folder from a commit on GitHub `main`. Run doctor and dry run from that folder, then atomically repoint `csm-calls-current`, keeping the old release path. Add the two flock cron lines after the release passes; add the same exact lines to `hermes/cockpit-guardian/crontab.manifest`. The worker is not the guardian and must never open or close incidents. Rollback: repoint the link to the previous release and run doctor/dry-run; rows are upserted, not deleted. If a store migration is not applied, ship **nothing** that calls its RPCs.

## Team EODs (csm-eod-mentions)
- Reads the cockpit EODs (`cockpit_eod_reports`), every tab of the EOD Reports sheet (read-only service account) and all five Slack EOD channels (`#eods-csms`, `#eods-salesreps`, `#media-eods`, `#tech-eods`, `#eods-csr`) as @maharaclubbot. A new channel: invite the bot and add its id to `EOD_CHANNELS` in `eods.ts`.
- Stores only the lines that name a client (whole-word name or alias, 4+ letters), never energy, stress or focus answers, in `cockpit_csm_eod_mentions`. A copy of the same EOD in the sheet and Slack is kept once.
- Each tick re-reads the last 3 days (EODs get edited). Backfill: `run.sh backfill --source eods --apply` (90 days).
