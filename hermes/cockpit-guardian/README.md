# Cockpit guardian

Watches every Mahara cockpit and the machinery behind it, every five
minutes, from the VPS: the pages, Convex (through its Supabase mirror),
Creative Triage (tables, Edge Functions, pg_cron and what pg_net got back),
every hermes worker (crontab, logs, locks, status rows), the VPS itself
(memory, disk, tunnels, the Claude proxy), the keys by name, the WhatsApp
guard, the monitors Hermes already runs, and the live-calls build as it
lands.

The CEO, 2026-10-03: "Set up a cron job in my VPS, or give me a prompt so
that it can scan for any issues happening with it and fix them immediately.
the overall cockpit".

Two tiers:

1. **The guardian** (`guardian.py`, this folder). Deterministic, standard
   library only, no model. One incident per broken check, one Slack message
   when it opens and one when it clears, a 09:00 Kuwait summary, and only the
   fixes the failure catalogue calls safe.
2. **The AI fixer** (`guardian.py ai-fix`, and `PROMPT.md` for a Claude
   session or a scheduled routine). Claude Code writes a fix with tests on a
   fresh branch and a pull request opens. Nothing is ever deployed by it.

```bash
python3 guardian.py doctor                  # keys by name, what answers, its own files
python3 guardian.py checks                  # every check: meaning, reading, threshold, safe fix
python3 guardian.py scan                    # read everything; open, update, resolve incidents
python3 guardian.py run                     # scan, then fix (what cron runs)
python3 guardian.py report                  # the plain-English summary
python3 guardian.py report --post           # the same to Slack, once a Kuwait day
python3 guardian.py ai-brief --incident ID  # a brief a Claude Code session can act on
python3 guardian.py ai-fix --incident ID    # Claude Code headless -> branch -> pull request
python3 -m unittest                          # 158 tests, no network
```

Flags: `--mode report-only|fix` (report-only unless the CEO says otherwise),
`--dry-run` (no Supabase write, no Slack; pair it with `--state-dir`),
`--only id,id`, `--json`, `--quiet`. ID is an incident id, its first eight
characters, or a check id.

## What a reading can be

| Reading | Means | Incident |
| --- | --- | --- |
| ok | Checked and healthy | Resolves an open one |
| warn | Worth a look | Opens one (after `confirm` scans in a row where set) |
| fail | Broken | Opens one |
| unknown | Could not be checked (the source did not answer) | Opens one after 3 scans in a row; never resolves one |
| unknown, coverage gap | Could not be checked from here (a key or a door is missing on this machine) | Never; listed in the summary |
| not deployed | A live-calls piece that does not exist yet | Never |
| paused | Off on purpose (webinar objections, live calls switched off) | Never |

Missing data is never healthy: a probe that fails says "could not be
checked", never zero. A reading caused by another failing check (every
"Claude sign-in lapsed" row) is folded into that check's incident.

## Alerts

One message per new incident and one when it resolves, to
`SLACK_HEALTH_CHANNEL` with `SLACK_BOT_TOKEN` (both in
`/opt/data/bibi/api-keys.env`). Each says what broke, since when, what the
guardian already tried, and what a person must do. No secret, phone
number, email or lead name: every sentence is cleaned, evidence is never
posted, and the guardian never reads a name column.

- At most one message per check every 6 hours (a flapping check is held).
- Saturday to Thursday, 09:00 to 21:00 Kuwait time; outside that a message
  waits for the next scan inside it. Urgent ones go at any hour: Convex down
  (no CEO section refreshed for 45 min) and Supabase down.
- Quiet while someone else already alerts: Convex's own salesWatch and
  health ledger (the desk rows, the mirror, Convex jobs and sources) while
  Convex runs; the Hermes monitors' own incidents while they tick; the SQL
  sales watchdog (`cockpit_sales_alerts`) once it exists. The incident is
  still recorded and listed.
- `report --post` at 09:00 Kuwait: what is broken, what is watched, what
  could not be checked, what is not deployed yet or paused, what cleared.

## Incidents

`public.cockpit_guardian_incidents` (`supabase/migrations/20261003e_guardian_incidents.sql`):
row security on, no policy for any seat, select/insert/update granted to
`service_role` only; the CEO cockpit reads it later through its own
server. At most one open row per check (a partial unique index). Each row
keeps when it was first seen, its level and severity, the reading, the
owner and the human action, every fix attempt, and when it resolved and
what fixed it.

The state file `~/.cockpit-guardian/state.json` (mode 600, folder 700) is
what the guardian works from, so it keeps deduping and alerting while
Supabase is down; rows that could not be written wait there and go on a
later scan. A lost state file is rebuilt from the open rows.

The same migration adds `public.cockpit_guardian_probe()`, a service-role
function returning pg_cron job names, schedules and run results, pg_net
answer codes for the last hour (a 404 from a function that is not deployed
counted apart), and auth accounts by role. It never returns
`cron.job.command`, which holds a literal Authorization value for three
jobs. Until the migration is applied the incidents live in the state file
only and the pg_cron checks say "could not be checked" (doctor says so).

## The safe automatic fixes (fix mode only)

Each can be repeated, can be undone, touches no lead or client data, sends
nothing and spends nothing. At most once per incident per hour, then 2 h,
4 h ... up to 24 h, and never past the fix's attempt limit; every attempt
is recorded on the incident and in `~/.cockpit-guardian/guardian.log`. A
fix never runs within 15 minutes of the Hermes reliability fixer acting
(it watches `fixer-attempts.json`), and only one guardian fixes at a time
(`fix.lock`).

| Fix | When | What it does |
| --- | --- | --- |
| Catch-up run | A copy-only job is late: recordings, calls-vault, maqsam-calls, team-sync, webinar pull, editor sync | Starts the exact command the live crontab runs, under the same flock and log. Not when the job is failing (it would fail the same way) |
| Stop a hung run | A copy-only run of hermes's own past max(4 x interval, 60 min) | SIGTERM, then SIGKILL after 30 s; the next run resumes (writes are upserts) |
| Rotate logs | The disk is over 80% and a hermes cron log is over 50 MB | gzip a copy, empty the live file in place; every line kept, at most 5 copies, nothing deleted |
| Tighten env files | A hermes-owned env file is looser than 600 | chmod 600 |
| Radar resend | Creative Triage was down 5 min or more and answers again | `radar.py resend` once (local files, upserts, no cost) |
| editor-stills bucket | The editor desk says "Bucket not found" | Creates the private bucket (empty, removable) |
| Sales desk doctor | The live-calls watchdog watches `sales-desk/doctor` and the row is over 75 min old | `desk.py doctor`, only while the desk drafts through the VPS proxy (its one-token ping then costs nothing) |
| Crontab restore, prepared | A manifest job is missing from the crontab | Backs up the crontab and writes `~/.cockpit-guardian/crontab.proposed` and `crontab.diff`. Never installs it |

Never automatic, whatever the mode: any sign-in or consent; anything that
spends money; setting, copying or rotating a secret; any deploy; installing
a crontab or unit, `git pull` or reset on the VPS copy or a shared
checkout; firewall, port or proxy changes; stopping another user's process
or a job that sends; re-queuing anything that reaches a lead or client, or
any paid generation; switching on a send, autosend or engine; deleting lead,
deal, appointment, client or B2B rows; HighLevel, Meta, ClickUp, Typeform
or Make; schema, grants, RLS, pg_cron, the vault or auth roles; Convex env;
editing a worker's queue row; anything on B2B. The rooms sweep is left to
pg_cron (its tick posts room events that can reach a lead's call), and the
mirror's lease lock is left to lapse by itself.

## Install on the VPS (as hermes)

The VPS copy of the repo is stale and has local edits; never pull or reset
it. Copy this folder in, as the other workers were:

```bash
scp -r hermes/cockpit-guardian hermes@187.77.156.166:~/mahara-cockpits/hermes/
ssh hermes@187.77.156.166
mkdir -p ~/.cockpit-guardian && chmod 700 ~/.cockpit-guardian
cd ~/mahara-cockpits/hermes/cockpit-guardian
set -a; . ~/.editor-desk/env; . /opt/data/bibi/api-keys.env; set +a
python3 guardian.py doctor
python3 guardian.py --dry-run --state-dir /tmp/guardian-try scan   # look before the first real run
```

Apply `supabase/migrations/20261003e_guardian_incidents.sql` to Creative
Triage (a person applies migrations). Optional keys, by name, in
`~/.cockpit-guardian/env` (mode 600): `SUPABASE_ACCESS_TOKEN` for the Edge
Function list and Supabase service health (without it those are coverage
gaps), `GITHUB_TOKEN` for `ai-fix`, `GUARDIAN_SLACK_CHANNEL` to post
somewhere other than `SLACK_HEALTH_CHANNEL`, `GUARDIAN_MODE`.

Cron, under its own lock, log in `~/.cockpit-guardian/cron.log`:

```
*/5 * * * *  flock -n $HOME/.cockpit-guardian/run.lock bash -c "cd $HOME/mahara-cockpits/hermes/cockpit-guardian && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; [ -f $HOME/.cockpit-guardian/env ] && . $HOME/.cockpit-guardian/env; set +a; python3 guardian.py --mode report-only --quiet run" >> $HOME/.cockpit-guardian/cron.log 2>&1
0 6 * * *    flock -w 120 $HOME/.cockpit-guardian/run.lock bash -c "cd $HOME/mahara-cockpits/hermes/cockpit-guardian && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; [ -f $HOME/.cockpit-guardian/env ] && . $HOME/.cockpit-guardian/env; set +a; python3 guardian.py --quiet report --post" >> $HOME/.cockpit-guardian/cron.log 2>&1
```

The VPS runs on UTC, so `0 6` is 09:00 Kuwait. After installing, add both
lines to `crontab.manifest` here so the guardian watches its own schedule.

## Switching from report-only to fix

1. Run report-only for a few days. `python3 guardian.py report` lists
   "Fixes it would make in fix mode" and every alert says what it did not
   try. Check each would-be fix against the incident it was for.
2. Change `--mode report-only` to `--mode fix` in the first cron line (or
   set `GUARDIAN_MODE=fix` in `~/.cockpit-guardian/env` and drop the flag).
3. Watch `~/.cockpit-guardian/guardian.log` and the next alerts: each now
   says what the guardian tried and when.

Back to report-only by putting the flag back. A run off the VPS (ssh) or a
dry run never fixes, whatever the mode.

## A read-only run from the Mac

```bash
export GUARDIAN_SSH="ssh -i ~/.ssh/faris-key -o BatchMode=yes hermes@187.77.156.166"
export GUARDIAN_DB=mgmt GUARDIAN_MGMT_TOKEN_FILE=~/.config/mahara/sb_mgmt_token GUARDIAN_KEY_FILES=/nonexistent
python3 guardian.py --dry-run --state-dir /tmp/guardian-mac run
python3 guardian.py --dry-run --state-dir /tmp/guardian-mac report
```

The VPS is read once over ssh (the snapshot script piped to `python3 -`:
key names and set/empty only, process counts and ages only, never a value
or a process's arguments); Creative Triage through the Management API with
`read_only`. Nothing is written, posted or fixed. Key probes that need a
value (Slack, DeepSeek, OpenAI, the Meta ad account) are coverage gaps off
the box.

## Runbook rows

| The guardian says | What it means | Who | What to do |
| --- | --- | --- | --- |
| Claude sign-in on the VPS | Drafting (follow-ups, notes, reviews, digest, Salma's captions) is paused; the proxy's /health still says ok | the CEO | SSH in as aziz, `claude`, then `/login` |
| Claude proxy open to the internet | Port 3456 answers from outside without a key | the CEO | Bind the proxy to 127.0.0.1, or `sudo ufw deny 3456` |
| VPS memory | Under 1 GB available three scans running, no swap | the CEO | Add swap, or stop the leftover cloudflared tunnels and restart the largest process |
| Leftover cloudflared tunnels | Hermes's gateway tunnel watchdog keeps starting tunnels | Hermes | Stop the leftovers; fix the watchdog's `kill -0` check |
| VPS crontab | A job line is gone | the CEO | Read `~/.cockpit-guardian/crontab.diff`, then `crontab ~/.cockpit-guardian/crontab.proposed` after a backup |
| A job's log or status row is late | The job stopped or keeps failing | Hermes | The alert names the log and the last error; in fix mode a copy-only job got one catch-up run |
| Hung cron runs | A run holds its lock far past its interval | Hermes | Read the job's log first; a run that sends is never stopped by the guardian |
| Meta access | "API access blocked": B2B's Meta sync and the creative dashboard stop | the CEO, the systems manager | Settle the balance in Ads Manager or check Business Settings |
| Webinar pull: the gift survey | Composio gives no session | the CEO | Reconnect Typeform in Composio or check `COMPOSIO_API_KEY` |
| Tap payments sync | No good run for over an hour | Hermes | Read the function log; "Charges not found" may be an empty window counted as an error |
| VPS backup | The nightly backup is old or failed | Hermes | Run the Nightly Backup job by hand and read why it exits with 1 |
| WhatsApp double sends | The WA Connector is not recorded off with a single-copy test | the CEO | Switch it off in HighLevel, test one message, set `connector_off` and `single_copy_ok_at` |
| Convex runs (CEO sections) | No section refreshed for 45 min: Convex is off or its jobs stopped | the CEO | dashboard.convex.dev; if switched off for usage, move the team to Pro |
| Creative Triage (Supabase) | No answer, or a service not healthy, for 15 min | the CEO | status.supabase.com; the cockpits show their last good numbers |
| Live calls: ... not deployed yet | That piece does not exist yet | none | Nothing; it becomes a real check once deployed |
| Could not be checked | The guardian's source did not answer three scans running | Hermes | `python3 guardian.py doctor` on the VPS |
| The guardian itself is silent | No message and no summary at 09:00 | Hermes | `tail ~/.cockpit-guardian/cron.log`; `python3 guardian.py doctor` |

## Files

| Path | What |
| --- | --- |
| `guardian.py` | The commands |
| `guard/` | config (keys by name), db (two doors, the probe SQL), host and `vps_snapshot.py` (the read-only VPS look), context, engine (scan, dedupe, fixes, alerts), store (state file and Supabase rows), alerts, fixes, report, ai, redact |
| `checks/` | One module per area; each check has an id, what it means, its severity, how it reads, its threshold and its optional safe fix |
| `crontab.manifest` | The 28 job lines of 2026-10-03, compared with the live crontab |
| `PROMPT.md` | The AI fixer prompt for a Claude session or a scheduled routine |
| `tests/` | Fakes for every source; `python3 -m unittest` |

## Every check

Generated with `python3 guardian.py checks --json`.

| Check | Catalogue | Threshold | Safe fix |
| --- | --- | --- | --- |
| `claude-signin` | H1 | Any of them says the sign-in lapsed or signed out: fail. |  |
| `claude-proxy-up` | H2 | No answer, or a status other than ok: fail. |  |
| `claude-proxy-exposed` | H3 | Listening on 0.0.0.0 or [::], or an outside GET answers 200: fail. |  |
| `supabase-health` | S1 | A service not ACTIVE_HEALTHY, or no answer, for 15 minutes (3 scans): fail; a read over 10 s: warn. |  |
| `convex-ceo-sections` | C1, C3 | All older than 45 min: fail (urgent); some old or failing: warn. |  |
| `convex-deployments` |  | Any answer other than 200: fail. |  |
| `convex-jobs` | C3 | ok false, or older than 3 times its interval (45 min at least): fail. |  |
| `convex-sources` | C7 | Any ok false: fail. |  |
| `hermes-ask-ai` | H12 | Jobs waiting while nothing finished for 20 min: fail; 10 or more new failures in an hour: warn. |  |
| `vps-memory` | H7 | Under 1024 MB available: warn; under 700 MB: fail; 3 scans in a row. |  |
| `vps-tunnels` |  | More than 50: warn. |  |
| `vps-disk` | H8 | Over 85%: warn; over 90%: fail. | gzip hermes's own logs over 50 MB (every line kept) |
| `vps-code-copy` | H11 | Older than 7 days or any local change: warn (daily summary only). |  |
| `vps-crontab` | H4 | A manifest job missing: fail; a schedule changed: warn. | back up the crontab and write the proposed restore (not installed) |
| `vps-hung-runs` | H6 | Older than 4 times the job's interval, at least 60 min: fail. | stop the hung copy-only run (SIGTERM, then SIGKILL after 30 s) |
| `log-eod-out` | H5 | No write for 15 min: fail; a Python traceback in the tail: warn. |  |
| `log-review-import` | H5 | No write for 10 min: fail; a Python traceback in the tail: warn. |  |
| `log-review-watch` | H5 | No write for 25 min: fail; a Python traceback in the tail: warn. |  |
| `log-hala` | H5 | No write for 35 min: fail; a Python traceback in the tail: warn. |  |
| `log-team-sync` | H5 | No write for 15 min: fail; a Python traceback in the tail: warn. | start one catch-up run of team-sync under its own lock |
| `log-editor-desk` | H5 | No write for 15 min: fail; a Python traceback in the tail: warn. |  |
| `log-ideation-radar` | H5 | No write for 10 min: fail; a Python traceback in the tail: warn. |  |
| `log-sales-desk` | H5 | No write for 10 min: fail; a Python traceback in the tail: warn. |  |
| `desk-doctor` | W2 | Older than 75 min while the live-calls watchdog exists: warn. | run desk.py doctor so its status row is current |
| `salma-status` | W10, M3 | Newest row older than 15 min, or a check failing: fail. |  |
| `salma-publishing` | W10 | Any client switched on: warn (report only). |  |
| `webinar-zoom` | W13 | No ok read in 3 h, or no run in 90 min: fail. | start one catch-up run of webinar-pull under its own lock |
| `webinar-survey` | W13 | No ok read in 24 h: fail. |  |
| `webinar-reminders` | W13 | No ok read in 14 h, or no run in 7 h: fail. |  |
| `webinar-objections` | W13 | Paused on purpose is a decision, not a failure; otherwise no ok read in 24 h: fail. |  |
| `editor-sync` | W11 | Older than 90 min: fail. | start one catch-up run of editor-sync under its own lock |
| `team-recordings` | W11 | Older than 3 h: fail. |  |
| `radar-scan` | W14 | Older than 8 days: fail. |  |
| `tap-charges` |  | ok false, or no ok run in 1 h: fail. |  |
| `desk-requests` | H5, W2 | ok false, or older than 15 min: fail. A missing row: unknown. |  |
| `desk-followups` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. |  |
| `desk-notes` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. |  |
| `desk-reviews` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. |  |
| `desk-recordings` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. | start one catch-up run of desk-recordings under its own lock |
| `desk-calls-vault` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. | start one catch-up run of desk-calls-vault under its own lock |
| `desk-maqsam-calls` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. | start one catch-up run of desk-maqsam-calls under its own lock |
| `desk-digest` | H5, W2 | ok false, or older than 26.0 h: fail. A missing row: unknown. |  |
| `sales-mirror` | S4 | Newest run older than 15 min, or 3 failures in a row: fail. |  |
| `sales-mirror-drop` | S5 | The newest run refused a drop: fail. |  |
| `sales-locks` | S6 | Held more than 15 min ahead: warn. |  |
| `crm-syncs` |  | Any last_status that is not ok, or older than 26 h: warn. |  |
| `client-panels` |  | Not ok, or older than 26 h: fail. |  |
| `meta-access` | M7 | 'API access blocked', an OAuthException, or an account status other than 1: fail. |  |
| `b2b-sources` | W5 | A status that is not success, or older than its cadence: warn. |  |
| `pg-cron-jobs` | S2 | A job missing or inactive: fail. |  |
| `pg-cron-runs` | S3 | A 400+ answer or a timeout in the last hour: fail; a failed run in 24 h: warn. |  |
| `auth-roles` | S8 | Any other role: warn. |  |
| `edge-functions` | S7 | A function missing, not ACTIVE, or with the wrong verify_jwt: fail. |  |
| `sales-api-up` |  | Anything but 401: fail. |  |
| `whatsapp-doubles` | W6 | Not recorded off, or no single-copy test: warn. Counting real double pairs needs HighLevel's conversations, which the guardian does not read. |  |
| `whatsapp-wallet` | M5 | Any: fail. |  |
| `whatsapp-refusals` | W7 | Any refusal code: warn. |  |
| `keys-present` | H10 | A required key missing or empty: fail. |  |
| `keys-file-modes` | H10 | Any group or other permission: warn. | set hermes-owned env files to mode 600 |
| `keys-team-sync` | W12 | Missing: warn (summary only). |  |
| `key-slack` |  | Refused: fail. |  |
| `key-deepseek` | M2 | Unavailable or under 2: fail. |  |
| `key-openai` | M1 | 401, or credit_balance_exhausted in research: fail. |  |
| `queue-social-jobs` | W9 | Any row waiting over 60 min: warn. |  |
| `queue-sales-requests` | W1 | Any row waiting over 60 min: warn. |  |
| `queue-editor-requests` | W11 | Any row waiting over 60 min: warn. |  |
| `queue-ideation-requests` | W14 | Any row waiting over 60 min: warn. |  |
| `queue-post-jobs` | M4 | Any row waiting over 60 min: warn. |  |
| `queue-ask-ai` | H12 | Any row waiting over 30 min: warn. |  |
| `queue-eod-outbox` | W8 | Any row waiting over 30 min: warn. |  |
| `queue-team-calendar` | W12 | Any row waiting over 30 min: warn. |  |
| `queue-feedback` | X3 | Any row waiting over 24.0 h: warn. |  |
| `issue-reports` |  | Any open: warn (summary only). |  |
| `site-cockpit` | V2 | Not 200, the wrong title, or the script not 200: fail. |  |
| `site-ceo` | V2 | Not 200, the wrong title, or the script not 200: fail. |  |
| `site-media-buyer-vercel` | V2 | Not 200, the wrong title, or the script not 200: fail. |  |
| `site-client-success` | V2 | Not 200, the wrong title, or the script not 200: fail. |  |
| `site-creative` | V2 | Not 200, the wrong title, or the script not 200: fail. |  |
| `site-editor` | V1, V2 | Not 200, the wrong title, or the script not 200, or no database address in the bundle: fail. |  |
| `site-sales` | V1, V2 | Not 200, the wrong title, or the script not 200, or no database address in the bundle: fail. |  |
| `site-dialer` | V2 | Not 200, the wrong title, or the script not 200: fail. |  |
| `site-creative-dashboard` | V2 | Not 200, the wrong title, or the script not 200: fail. |  |
| `site-webinar` | V4 | Any not 200: fail. |  |
| `hermes-monitor-cockpits` |  | No tick for 3 min: fail; open incidents: listed (it alerts on its own). |  |
| `hermes-monitor-sites` |  | No tick for 3 min: fail; open incidents: listed. |  |
| `hermes-jobs` |  | An enabled job whose last run failed: warn (the Cron guardian job already watches these). |  |
| `vps-backup` |  | Either says the backup failed or is old: fail. |  |
| `live-tables` |  | None: not deployed yet; some of a migration but not all: fail. |  |
| `live-function` |  | Missing: not deployed yet; anything else wrong: fail. |  |
| `live-cron` |  | Tables missing: not deployed yet; tables there and a job missing: fail. |  |
| `live-dns` |  | No DNS: not deployed yet; resolves but no answer: fail. |  |
| `live-rooms-worker` |  | Not there: not deployed yet; older than 90 s: warn; 10 min: fail. |  |
| `live-status-rows` |  | Tables missing: not deployed yet; a part failing: fail. |  |
| `live-settings` |  | Missing: not deployed yet; enabled false: paused. |  |
| `live-alerts` |  | Missing: not deployed yet; open alerts: warn (it posts them itself). |  |
