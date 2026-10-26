# Lead sync watch

Checks every 15 minutes whether each client's **Facebook (Meta) leads reach its CRM (GoHighLevel)**, shows the result in the media buyer cockpit and the CEO view, and warns **#tech-general** when they do not.

## What it compares

| Side | Source | Notes |
|---|---|---|
| Meta | Graph API `act_<id>/insights`, account level, hourly breakdown in the ad account's own time zone, action `lead` | Read live every run, summed over every ad account of the client. Never taken from a cached table. |
| CRM | `public.client_leads` for the client's GoHighLevel sub-account (kept fresh by the existing GHL lead sync, `lead_sync_state`) | Every new non-deleted contact, the way the Master Dashboard's **Leads in CRM** column counted it (`Leads View` rows per client per date). The Meta-tagged part is shown next to it. |
| Slack | #tech-general `C0AS2JLMJCB` | Alert and "fixed" reply only. Read for history to avoid double posts. |

Both sides count the same window: the last 24 and 6 whole hours, ending at the end of the current hour.

Client to CRM link, in order: `clients.ghl_location_id`, then `ghl_client_ad_accounts`, then the CRM client list's display name (`ghl_clients.client_name`). The client list itself is the board's live campaigns (`cockpit_campaigns`). Ad accounts that share a sub-account are one client.

## Rules (Aziz, 2026-10-14)

- **Gap:** over 24h the CRM is 30%+ below Meta **and** at least 3 leads are missing.
- **Stalled:** the CRM got 0 in the last 6h while Meta reported 3+.
- Seen on **2 runs in a row** before it alerts. Must **match again on 3 runs in a row** (within 1 lead or 90%) before the "fixed" reply.
- Under 3 Meta leads in 24h is **quiet**: nothing to compare.
- More CRM than Meta never alerts (organic, walk-ins, other channels).
- **Missing is never zero.** If Meta refuses an account, or the cockpit's copy of the CRM is older than 90 minutes, the client is **unknown**: no alert, no resolve, and any open episode is kept as it was.

## Slack

One message per client per episode in #tech-general, tagging the **systems manager** (active `cockpit_people` rows whose role is "Systems manager"; Slack ID by exact email, never by name). Aziz moved ownership from the media buyer to the systems manager on 2026-10-26. The "fixed" reply goes in the same thread. No channel mentions, no repeats.

Every post is a row in `cockpit_lead_sync_alerts` written **before** the send, with a reference tag in the message (`lsw:<episode>:<kind>`):

- `sent`: done; never posted again.
- `failed`: Slack definitely refused (e.g. `not_in_channel`). Retried next run.
- `sending` / `unknown`: the send was interrupted. The next run searches the channel (or thread) history for the reference tag. If it is there, it is recorded as sent. If not, the row stays `unknown` and **is not resent automatically**. A person checks Slack, then either sets the row to `failed` (to retry) or `sent`.

The bot is **maharaclubbot** (`SLACK_BOT_TOKEN` from the native runtime file), which is a member of #tech-general. The `SLACK_BOT_TOKEN` in `/opt/data/bibi/api-keys.env` is a different bot that is **not** in the EOD or tech channels; `run.sh` loads the runtime file first so that one wins.

## Tables (migration `20261014b_lead_sync_watch.sql`)

- `cockpit_lead_sync_status`: one row per client, the current picture. RLS: CEO, admins, and media buyers allowed on that client.
- `cockpit_lead_sync_runs`: one row per run. RLS: CEO, admins, media buyers.
- `cockpit_lead_sync_alerts`: the Slack ledger. Service role only.
- Health: `cockpit_sync_state` key `lead-sync-watch` (`ok`, `note`, `detail.failed`, `detail.sends`). Not ok when every account failed, when more than 20% of accounts failed, or when a Slack post is `failed`/`unknown`.

A run that could read no Meta account at all does not overwrite the last good picture.

## Cockpit

- **Media buyer, Ads board:** a red strip above the board lists clients losing leads (nothing when all is well), and a red badge `CRM x / Meta y` sits next to the client's name.
- **Client page** (`/ads?account=<client>`): the Lead sync panel with 24h and 6h counts and the last 7 days, day by day, in the ad account's time zone.
- **CEO, Delivery tab:** every client, worst first.

## Operate

```sh
# health, keys by name, Meta, Slack membership, roster size
/home/hermes/lead-sync-watch-current/hermes/lead-sync-watch/run.sh doctor
# dry run: reads everything, writes nothing, posts nothing
/home/hermes/lead-sync-watch-current/hermes/lead-sync-watch/run.sh run --report /tmp/lsw.json
# the current picture
/home/hermes/lead-sync-watch-current/hermes/lead-sync-watch/run.sh status
```

Cron (user `hermes`), its own lock, never the native media feed:

```
*/15 * * * * /usr/bin/flock -n /home/hermes/.lead-sync-watch/lock /home/hermes/lead-sync-watch-current/hermes/lead-sync-watch/run.sh run --apply >> /home/hermes/.lead-sync-watch/cron.log 2>&1
```

Release: copy `hermes/lead-sync-watch/` **and** `hermes/exception-alerts/` into `/home/hermes/lead-sync-watch-<sha>/hermes/`, run both test suites and both `doctor`s there, then point `lead-sync-watch-current` at it. Roll back by pointing the link at the previous release.

**Exception alerts ride this cron line** (plan 4.1, `hermes/exception-alerts/README.md`). After each `run`, the worker calls them. They do their work at most once in 55 minutes, write their own health row (`exception-alerts`) and log line, and never change this job's exit code. Their switches live in `/home/hermes/.exception-alerts/env` (`run.sh` exports `EXCEPTION_ALERTS_ENV_FILES`); `EXCEPTION_ALERTS=off` there switches them off without touching the lead sync check.

**Stop the alerts without stopping the checks:** remove `--apply` from the cron line (it then only reads). To mute one client during a known migration, nothing extra is needed: it alerts once per episode only.

## When it alerts, what to check

1. Meta Business Settings → the page's **Leads Access**: is the GoHighLevel/LeadConnector app still allowed?
2. GoHighLevel sub-account → Settings → Integrations → **Facebook**: still connected to the right page? Reconnect if expired.
3. GoHighLevel → **Facebook Form Mapping**: is the live form mapped?
4. Meta's **Lead Ads Testing Tool** on the form: does a test lead arrive in the sub-account?

## Not in scope

- TikTok, Snapchat and Google leads (Meta only for now).
- Changing anything in Meta or GoHighLevel. It only reads.
- Leads the GHL lead sync itself fails to copy into `client_leads`: that shows as **unknown** (stale copy), and the guardian's sync check already watches `lead_sync_state`.

## How we know it works

- `bun test hermes/lead-sync-watch/` (rules, windows, time zones across the clock change, roster join, exactly-once Slack ledger including crash recovery).
- `doctor` on the VPS: Supabase, Meta, Slack membership of #tech-general, roster.
- First live dry run, 2026-10-14 13:51 UTC: 15 clients, 15/15 ad accounts read, 0 gaps; e.g. Ocean Home Meta 6 / CRM 7, mergestudio.kw 5 / 5, Castello 5 / 6.
