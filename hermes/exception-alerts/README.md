# Exception alerts

Checks every active client once an hour, flags **only the broken ones**, and tells the client's owner, with a link to the right cockpit page. Plan item 4.1, approved by Muhammed on 2026-10-26.

It reads tables other jobs already keep fresh in Creative Triage (`bldgtotkfmhoxmlzowdx`). It never calls Meta or GoHighLevel. It has **no scheduler of its own**: it runs inside the lead sync watch's 15-minute cron line and does its work at most once in 55 minutes.

## The four rules

| Rule | Alerts when | Too little data when |
|---|---|---|
| **Spend with no leads** | The client still spent today or yesterday, and the spend since the last lead, by campaigns that have run 48 hours or more, reaches the line. A day has no lead only when Meta reports 0 and the CRM got no ad lead. The line is 2 x the larger of the board's cost per lead line ($15) and the client's own cost per lead over 60 days (own only with 10+ leads). | The line is reached only with spend from campaigns under 48 hours old. |
| **Cost per booking over the line** | The 7-day cost per booking is over the client's line (the board's watch line, $80 today) on 3 days in a row (windows ending yesterday, the day before and the day before that). | A window has under 3 bookings, or fewer leads than the client's floor (half its usual week, at least 10), or the ads have run under 7 days. Done-with-you clients never alert. |
| **Campaign stopped** | A Mahara campaign that spent in the last 2 days is switched on but not delivering, or ended. | Not used. Stopped for billing (Meta's payment reasons, account status 3, 8 or 9, or the ad billing guard's grace or unsettled signal) is **not** an alert: the ad billing guard handles it. |
| **Leads not reaching the CRM** | The lead sync watch has an open gap or stall. Folded in, **not sent again**: the lead sync watch already posts it to #tech-general, so the ledger gets a mirror row. | Not used. |

Floors come from each client's own last 60 days. Client targets would come from `cockpit_board_targets`; that table is empty today, so every client uses the board's defaults (`OFFICIAL` in `rules.ts`, kept in step with `cockpit_board_default_targets()` and `kpi.ts`).

**Missing is never zero.** A day Meta has not reported yet, a chat campaign with no lead count, or Meta's campaign status older than 3 hours makes the rule **unknown**: no alert, no close, the episode stays as it was.

## The guards

- **Two runs in a row** (45+ minutes apart) before a problem opens. Two clean runs before it closes. The lead sync gap opens and closes with the lead sync watch.
- **One alert per episode**, per person. The ledger row is claimed (`INSERT ... ON CONFLICT DO NOTHING`) before every send, keyed by rule, client, episode, recipient and kind. A forced duplicate run writes nothing new.
- **At most 5 alerts a person a day** (Kuwait day). The rest wait as `queued` and go out in one digest from 16:00 Kuwait.
- **No owner, never dropped.** An alert with no owner goes to the fallback digest in #tech-general.
- An interrupted send is looked up in Slack history by its reference tag (`exa:<ledger id>`) before it is tried again, at most 3 attempts.

## Owners

There is no media-buyer owner field yet (plan 4.2, not in scope). So:

- **Media buyers:** the cockpit's own access rule, the same as the lead sync watch. Active members with the `media_buyer` role who are not admin or CEO, whose client list is empty or names the client. Today that is Abdelaziz Radwan and nada@maharamedia.com for every client.
- **CSM:** the ClickUp "CSM assigned" on the client's card (`cockpit_csm_sources`), matched to a cockpit member by name. The CSM gets only the cost per booking alert.
- Spend with no leads and a stopped campaign go to the media buyers. Cost per booking goes to both.

## Delivery and the ledger

Slack DMs from **maharaclubbot** (`SLACK_BOT_TOKEN` in the native runtime file, the same bot as the lead sync watch). The person is found by exact email (`users.lookupByEmail`), never by name. Needed scopes: `chat:write`, `im:write`, `users:read.email`, `channels:history`, `im:history`; `doctor` checks them.

Ledger statuses (`cockpit_exception_alerts`, service role only): `sending`, `sent`, `failed`, `unknown` as in the lead sync ledger, plus `dry` (delivery is a dry run, nothing was sent), `queued` (over the 5 a day, waits for the digest) and `mirror` (the lead sync watch's own post).

Rows queued while delivery was a dry run are never sent once delivery goes live (`EXCEPTION_ALERTS_LIVE_SINCE`), so the go-live does not flood anyone with a backlog.

## Switches

Named keys, read from the lead sync watch's env files and then `/home/hermes/.exception-alerts/env` (set by `run.sh`). Muhammed owns these switches.

| Key | Effect |
|---|---|
| `EXCEPTION_ALERTS=off` | Skip the step entirely. |
| `EXCEPTION_ALERTS_DELIVERY=live` | Send Slack messages. Anything else is a **dry run** that still writes the state, the ledger (status `dry`) and the health row. Default: dry run. |
| `EXCEPTION_ALERTS_LIVE_SINCE=<ISO time>` | Set with `live`: nothing queued before this time is sent. |
| `EXCEPTION_ALERTS_RULES_OFF=a,b` | Rules switched off (`zero_leads`, `cpb_over_line`, `campaign_stopped`, `lead_sync`). |
| `EXCEPTION_ALERTS_FALLBACK=C...` | Channel for the no-owner digest. Default #tech-general `C0AS2JLMJCB`. |

## Where it shows

- **Media buyer cockpit, Today:** the "Exception alerts" card lists the open alerts this person may see, with a link to the client's Ads page. An all-clear when nothing is open. The footer says when the last check ran and whether messages are on (`cockpit_exception_summary()`).
- **Monitor:** `cockpit_native_monitor()` lists `worker:exception-alerts`. It is red when the last clean run is over 150 minutes old, or when any send failed, is unknown, or is stuck in `sending` for 10+ minutes in the last 24 hours (`failed` carries that count).
- **Health row:** `cockpit_sync_state` key `exception-alerts` (note, open alerts, too little data, sends, failures, read counts).

## Operate

On the VPS, as `hermes`, from `/home/hermes/lead-sync-watch-current`:

```
hermes/lead-sync-watch/run.sh run              # both checks, read only
bun hermes/exception-alerts/worker.ts doctor   # keys, tables, inputs, Slack scopes, owners' Slack accounts
bun hermes/exception-alerts/worker.ts status   # every rule and client that is not ok
bun hermes/exception-alerts/worker.ts replay --days 30 --out /tmp/replay.md
```

Run `doctor` and `replay` with the lead sync env (`LEAD_SYNC_ENV_FILES` as `run.sh` sets it). Never run a worker CLI locally from inside the repo: Bun loads `.env.local` from the current folder on its own, and a failure path then writes to the live health row.

The cron line is the lead sync watch's own (see its README). Each run logs one line: `exception-alerts ok: ...`, `exception-alerts skipped (not due): ...` or `exception-alerts FAILED: ...`. A failure never changes the lead sync watch's exit code.

**Release:** copy **both** `hermes/lead-sync-watch/` and `hermes/exception-alerts/` into `/home/hermes/lead-sync-watch-<sha>/hermes/`, run both test suites and both `doctor`s there, do a read-only `run`, then point `lead-sync-watch-current` at it.

**Go live** (stop point 3, waits for the database gate): set `EXCEPTION_ALERTS_DELIVERY=live` and `EXCEPTION_ALERTS_LIVE_SINCE=<now>` in `/home/hermes/.exception-alerts/env`. **Switch off:** `EXCEPTION_ALERTS=off` in the same file.

## Known limits

- A client with leads but **0 bookings** never alerts: the cost per booking rule needs 3 bookings. Alkhalil had 19 leads and 0 bookings in the replay window.
- "Campaign stopped" cannot be replayed: Meta's delivery status is kept for now only.
- Owners are everyone with access until the media-buyer owner field exists (plan 4.2).

## Files

- `rules.ts`: the four rules, floors, the two-run decision and the message texts. Pure functions.
- `inputs.ts`: the reads (one per table, one after another).
- `worker.ts`: owners, delivery, the ledger, the health row, `doctor` and the CLI.
- `replay.ts`: the 30-day replay.
- Migration `supabase/migrations/20261026150000_exception_alerts.sql`. Tests: `*.test.ts` here and `apps/media-buyer-cockpit/scripts/exception-alerts-supabase.test.ts`.
- The replay report: `docs/exception-alerts/REPLAY-20261026.md`.
