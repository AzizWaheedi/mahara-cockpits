# Cockpit guardian

Watches every Mahara cockpit and the machinery behind it, every five
minutes, from the VPS: the pages, the CEO and machine sections the native
workers write (Convex is paused and no longer probed),
Creative Triage (tables, Edge Functions, pg_cron and what pg_net got back),
the hiring sync (Typeform applications into HighLevel, the board copy),
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
   when it opens, one more if it gets worse, one when it clears, a 09:00
   Kuwait summary, and only the fixes the failure catalogue calls safe.
2. **The AI fixer** (`guardian.py ai-fix`, fix mode only, and `PROMPT.md` for
   a Claude session or a scheduled routine). Claude Code writes a fix with
   tests on a fresh branch and a draft pull request opens. Nothing is ever
   deployed by it.

**Who watches the guardian.** After every full scan on the VPS it puts
`beat:cockpit-guardian` into the Cloudflare KV namespace the Hermes dead-man
worker reads (`/docker/hermes-agent-ff5p/data/portal-monitor/deadman-worker.mjs`).
That worker runs on Cloudflare, not on the VPS, and posts to #health when the
beat is more than 10 minutes old (a wiped crontab, a crash at import, a full
disk, the VPS down) or when the guardian's undelivered alerts are older than
15 minutes (Slack refusing the token). The keys are read by name from the
monitor's own `monitor.env` (`PORTAL_MONITOR_CF_TOKEN`, `_CF_ACCOUNT`,
`_CF_KV_NAMESPACE`). The worker watches a project from its first beat; to
retire the guardian, delete `beat:cockpit-guardian` and
`deadman:cockpit-guardian` from that namespace. The `guardian-beat` check
says when the beat itself fails, and `report` says first when the last scan
is more than 15 minutes old.

The beat is off on the VPS for now (`GUARDIAN_BEAT=off` in
`~/.cockpit-guardian/env`, 2026-10-03). Every beat is a Cloudflare KV write.
The account is on the free plan, which allows 1,000 writes a day (error 10048
after that, until 00:00 UTC). The five Hermes monitors and the worker's
`watcher` key already write about 1,700 a day, so from mid-afternoon UTC every
beat, theirs included, is refused and the dead-man switch is blind.
`deadman-beats` reports this. Turn the guardian's beat back on (delete that line)
once the account is on Workers Paid, or once the monitors beat less often.

```bash
python3 guardian.py doctor                  # keys by name, what answers, its own files
python3 guardian.py checks                  # every check: meaning, reading, threshold, safe fix
python3 guardian.py scan                    # read everything; open, update, resolve incidents
python3 guardian.py run                     # scan, then fix (what cron runs)
python3 guardian.py report                  # the plain-English summary
python3 guardian.py report --post           # the same to Slack, once a Kuwait day
python3 guardian.py ai-brief --incident ID  # a brief a Claude Code session can act on
python3 guardian.py ai-fix --incident ID    # Claude Code headless -> branch -> pull request
python3 -m unittest                          # 402 tests, no network (Python 3.11 or later)
```

Flags: `--mode report-only|fix` (report-only for a run by hand; the VPS cron line
runs `--mode fix` since 2026-10-11, see "Fix mode" below),
`--dry-run` (no Supabase write, no Slack; without `--state-dir` it works on a
scratch copy of the state file, so the real one is never touched),
`--only id,id`, `--json`, `--quiet`. ID is an incident id, its first eight
characters, or a check id.

Runs that change the state (`scan`, `run`, `fix`, `report --post`) take
`~/.cockpit-guardian/state.lock`, waiting up to 120 s, so a manual run beside
cron never overwrites the other's state (a different file from cron's
`run.lock`, which the cron line's own `flock` holds). `ai-fix` works without
the lock and takes it only to record its attempt on the state as it is then.

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
"Claude sign-in lapsed" row) is folded into that check's incident, without a
"Resolved" message for the reading folded in. Every "could not be checked"
caused by Creative Triage or the VPS not answering folds into
`supabase-health` or `vps-snapshot`: an outage is one incident. A machine
section too old to read (`native-sources`, `ask-ai-queue`) folds into
`ceo-sections`, which reads that same row. A circuit
breaker keeps it short: `supabase-health` runs first, and after the first
database call that times out or answers 5xx, every later database read in
that scan fails at once instead of waiting out 30 s each.

`supabase-health` confirms by the clock (bad for 15 minutes), not by scans,
because slow scans get skipped. Checks that flap need good readings in a row
to clear (`clear`): VPS memory (and only above 1,536 MB), the log checks, the
CRM syncs. A log check counts only the tracebacks written since the last
scan. Live calls: "not deployed yet" stops being an excuse once a piece was
seen working (gone again is a failure) or once live calls are switched on (a
missing piece then fails, folded into an urgent `live-settings`). The pieces
deployed by 2026-10-07 (tables, database jobs, the watchdog's alerts,
sales-live, the rooms worker) are remembered in `checks/live_calls.py` as well
as in the state file, so a lost state or a new, empty Supabase project reads as
"gone", not "not deployed yet". `live-code` reads which source modules sales-api
and sales-live were deployed with, once per deploy: a deploy from a branch
without live calls keeps the function's name and raises its version, and only
the missing modules give it away. A bundled deploy (Composio's
`scripts/dev/deploy_composio.py` sends one bun bundle, so the API gives back a
single `index.ts`) has no module names; each live-calls module is then found by
strings its code leaves in the bundle (`LIVE_MARKERS`: `hungSend`,
`ROOM_STATES`, `makeLiveIO`, `makeFollowupAgent`, `LEAD_ZONES` ... checked
against sales-api v71 and sales-live v7 on 2026-10-11). Before that, every
Composio deploy of sales-api read as "deployed without its live-calls modules"
(a false alarm from 2026-10-10).

## Alerts

Since 2026-10-13 (Muhammed) every message is Slack formatting: a coloured dot and a bold headline ("Broken:",
"Warning:", "Worse:", "Better:", "Resolved:"), what it reads, a `*Guardian:*` line only when the guardian did or
will do something, `*Do:*` with the action, then a grey line with the owner, since when and the check id. Owners in
`OWNER_MENTIONS` (`guard/alerts.py`; the systems manager) are tagged, in the owner line and wherever the action names
them. A "Better" post follows when a broken incident drops back to a warning, under the same 6-hour hold as any
repeat, so the last word in the channel is no longer a stale "Worse". The 09:00 summary has bold section names and
bullets.

One message per new incident and one when it resolves, to
`SLACK_HEALTH_CHANNEL` with `SLACK_BOT_TOKEN` (both in
`/opt/data/bibi/api-keys.env`). Each says what broke, since when, what the
guardian already tried, and what a person must do. No secret, phone
number, email or lead name: every sentence is cleaned, evidence is never
posted, and the guardian never reads a name column.

- At most one message per check every 6 hours (a flapping check is held).
- One more when an open incident gets worse: its level rises (an urgent one
  skips the 6-hour hold for that) or a new name joins what is failing (a new
  missing key, a new failing job or function, Meta's own account on top of
  the B2B block, a real Tap error on top of the empty-window one).
- At most 3 new incidents posted one by one per run; the rest go in one
  digest line. Resolved messages likewise.
- Saturday to Thursday, 09:00 to 21:00 Kuwait time; outside that a message
  waits for the next scan inside it. Urgent ones go at any hour: the CEO
  sections stale, Supabase down, the VPS not answering, the crontab losing lines, memory
  under 700 MB with no swap, the disk over 90%, the sales mirror stale, and
  the rooms worker or sales-live failing while live calls are switched on.
- Quiet only while someone else is shown to deliver: the Hermes monitors'
  own incidents while they tick and their outbox is not
  stuck for 30 minutes; the SQL sales watchdog only while its job is
  scheduled, it ran in the last 15 minutes, the vault has its webhook, and no
  alert waited 15 minutes unposted in working hours. The incident is still
  recorded and listed.
- Retired check ids (2026-10-09: `convex-deployments` dropped; `convex-ceo-sections`,
  `convex-jobs`, `convex-sources` and `hermes-ask-ai` renamed `ceo-sections`, `native-jobs`,
  `native-sources` and `ask-ai-queue`): an incident still open under one is closed on the
  next scan, in state.json and cockpit_guardian_incidents, with no Resolved message
  (`RETIRED_CHECKS` in guard/engine.py).
- The 09:00 Kuwait summary is posted by the first scan at or after 09:00:
  what is broken, what is watched, what could not be checked, what is not
  deployed yet or paused, what cleared. `report --post` sends it by hand.
- Slack not answering ends the run's posting at once; the rest stay queued,
  and the heartbeat reports the oldest one to the dead-man switch.

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
later scan. A lost state file is rebuilt from the open rows. A row Supabase
refuses for itself is set aside (`db_rejected`) so the rest still go; an
open row a lost state left behind is resolved as superseded and the write
retried; rows waiting over an hour open `guardian-db-copy`. Only the
guardian's own run on the VPS writes rows.

Every throttle and backoff lives in the state file, so a run that cannot
save it (a full disk) only reads: it posts nothing but one "cannot write"
message (at most every 6 hours) and fixes nothing. Each post and each fix
attempt is saved before it happens.

Open Hermes-owned incidents are also written, in the Hermes monitor's own
shape, to `/docker/hermes-agent-ff5p/data/portal-monitor/state/cockpit-guardian/state.json`.
The reliability fixer picks them up once a person adds a `cockpit-guardian`
row (`fix_policy` "pr") to `/opt/data/bibi/workspace/reliability/fixer-projects.json`.
CEO-owned alerts stay in #health: the CEO's 2 Oct routing is every alert to
Slack #health only (deadman-worker.mjs, fixer_notify.py).

The same migration adds `public.cockpit_guardian_probe()`, a service-role
function returning pg_cron job names, schedules and run results, pg_net
answer codes for the last hour (a 404 from a function that is not deployed
counted apart), and auth accounts by role. It never returns
`cron.job.command`, which holds a literal Authorization value for three
jobs; it says only whether a job's command carries one (`has_literal_auth`,
read by `pg-cron-secrets`). Until the migration is applied the incidents live in the state file
only and the pg_cron checks say "could not be checked" (doctor says so).

## The safe automatic fixes (fix mode only)

Each can be repeated, can be undone, touches no lead or client data, sends
nothing and spends nothing. At most once per incident per hour, then 2 h,
4 h ... up to 24 h, never past the fix's attempt limit, and at most 3 times
a day per check across incidents (after that the alert says the cause keeps
coming back). Every attempt is saved on the incident before the fix runs,
and logged in `~/.cockpit-guardian/guardian.log`. A fix never runs within 15
minutes of the Hermes reliability fixer really acting (its log entries that
are a no-op, a data/ops diagnosis or an escalation do not count), a
follow-up that was blocked is kept and done on a later run, only one
guardian fixes at a time (`fix.lock`), and fixes act on a fresh look at the
VPS, not the one the scan started with.

| Fix | When | What it does |
| --- | --- | --- |
| Catch-up run | A copy-only job is late: recordings, calls-vault, maqsam-calls, team-sync, webinar pull, editor sync | Starts the exact command the live crontab runs, under the same flock and log, with cron's bare environment (no key passed down). Watched for 2 s: when `flock -n` refuses it, nothing new ran and the guardian takes no credit. Not when the job is failing (it would fail the same way) |
| Stop a hung run | A copy-only cron run of hermes's own (an ancestor is its own `flock -n`) past max(4 x interval, 60 min) whose CPU time has not moved for 15 minutes | Re-reads the process just before, then SIGTERM, then SIGKILL after 30 s; at most once per job a day. A run still using CPU (a long backfill), a manual run, or another user's process is never touched |
| Rotate logs | The disk is over 80% and a hermes cron log is over 50 MB | gzip a copy (written as `.gz.part`, renamed when whole; skipped when free space is under a third of the log), empty the live file in place; every line kept, at most 5 copies, nothing deleted |
| Tighten env files | A hermes-owned env file is looser than 600 | chmod 600 |
| Radar resend | Creative Triage was down (a fail, not a slow read) for 5 min or more and answers again | `radar.py resend --ideas` with only the ideas captured since the outage began, and the weekly scan only if it ran during it (local files, upserts, no cost) |
| editor-stills bucket | The editor desk says "Bucket not found" | Creates the private bucket (empty, removable) |
| Crontab restore, prepared | A manifest job is missing from the crontab | Backs up the crontab and writes `~/.cockpit-guardian/crontab.proposed` (the live crontab exactly as `crontab -l` printed it, comments kept, plus the missing lines) and `crontab.diff`. A job commented out on purpose is paused, never put back. Never installs it |

`desk.py doctor` is not a fix: running it whenever its row went stale
launched Chrome and read Maqsam and HighLevel about 18 times a day, while
the real cause (no cron line for doctor) never changed.

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

## The AI fixer (fix mode only)

`guardian.py --mode fix ai-fix --incident ID` hands one incident to Claude
Code on a fresh clone in a private temporary folder, then pushes the branch
and opens a draft pull request itself. It refuses in report-only mode. The
brief carries text from logs and providers (a worker's detail can quote a
lead's WhatsApp), so it is treated as hostile:

- Claude may read, edit and commit, and run only `git status`, `git diff`,
  `git add`, `git commit`, `git log` and `ls`. No python, bun, npx or node:
  each of those runs arbitrary code. The tests it writes are run on review,
  never on the VPS next to the keys.
- Claude's environment is PATH, HOME and LANG; no key. Reading the key files,
  `/docker`, the guardian's folder, `~/.ssh`, `~/.config` and `~/.claude`,
  and editing the live worker code in `~/mahara-cockpits` or the clone's
  `.git`, are denied.
- The incident's reading, evidence and earlier attempts sit in a fenced
  block marked as data, never instructions.
- Before the push the guardian refuses when `.git/config` or `.git/hooks`
  changed, or when the diff or the pull request body holds any key value from
  the key files. It pushes to the fixed GitHub URL with hooks off.

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
Triage (a person applies migrations). The guardian reads its keys by name
from `~/.cockpit-guardian/env`, `~/.editor-desk/env`,
`/opt/data/bibi/api-keys.env` and the Hermes monitor's
`/docker/hermes-agent-ff5p/data/portal-monitor/monitor.env` (the dead-man
`PORTAL_MONITOR_CF_*` keys and `SUPABASE_ACCESS_TOKEN`, which doctor
requires on the VPS). Every value of 8 or more characters in those files,
and the other workers' env files it can read, is hidden by value wherever it
might appear in an alert, a row, a brief or a log line, whole or in part.
Optional, in `~/.cockpit-guardian/env` (mode 600): `GUARDIAN_SLACK_CHANNEL`
to post somewhere other than `SLACK_HEALTH_CHANNEL`, `GUARDIAN_MODE`,
`GUARDIAN_BEAT=off` (no heartbeat PUT; see below), and
`GITHUB_TOKEN` for `ai-fix`. Do not add `GITHUB_TOKEN` until port 3456 is
closed (the `claude-proxy-exposed` check): the AI fixer is locked down, but
a proxy open to the internet is a door into the same box.

Cron, one line, under its own lock, log in `~/.cockpit-guardian/cron.log`:

```
*/5 * * * *  flock -n $HOME/.cockpit-guardian/run.lock bash -c "cd $HOME/mahara-cockpits/hermes/cockpit-guardian && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; [ -f $HOME/.cockpit-guardian/env ] && . $HOME/.cockpit-guardian/env; set +a; python3 guardian.py --mode fix --quiet run" >> $HOME/.cockpit-guardian/cron.log 2>&1
```

(Installed 2026-10-03 with `--mode report-only`; fix mode since 2026-10-11.)

There is no second line for the 09:00 summary: the first scan at or after
09:00 Kuwait time posts it (a separate line waiting on the same lock could be
skipped by a long scan, with no retry that day). After installing, add the
line to `crontab.manifest` here so the guardian watches its own schedule; if
it is ever lost anyway, the dead-man switch says so within 10 minutes.

Then, once: a person adds a `cockpit-guardian` row to
`/opt/data/bibi/workspace/reliability/fixer-projects.json` (`fix_policy`
"pr", `repo` mahara-cockpits) so the Hermes reliability fixer reads the
guardian's Hermes-owned incidents.

## Fix mode (since 2026-10-11)

The CEO asked for a guardian that would "Scan for any issues happening with it
and fix them immediately". It ran report-only from 2026-10-03 to 2026-10-11:
236 incident rows, and every fix it would have made (a prepared crontab
restore, catch-up runs of team-sync, the desk's copy jobs, editor-sync and the
webinar pull, one radar resend) is on the safe list above. So the cron line
runs `--mode fix`.

What changes: the safe fixes in the table above run, each logged in
`~/.cockpit-guardian/guardian.log` and named in the next alert, and
`cockpit_guardian_incidents.mode` reads `fix`. What does not: the "never
automatic" list. No secret, deploy, migration, crontab install, HighLevel or
Meta write, and nothing that reaches a lead or a candidate. On 2026-10-11 none
of the 19 open incidents had a safe fix (each needs a key, a deploy, a person or
Hermes), so fix mode closes none of them by itself. It catches the next late
copy job, hung run, full log or loose env file.

To switch, as hermes on the VPS, after copying this folder in:

```bash
mkdir -p ~/.cockpit-guardian/backups
crontab -l > ~/.cockpit-guardian/backups/crontab.$(date -u +%Y%m%dT%H%M%SZ).before-fix-mode
crontab -l | sed -e 's#python3 guardian.py --mode report-only --quiet run#python3 guardian.py --mode fix --quiet run#' \
                 -e 's#scan every 5 min, report-only until its reports prove accurate#scan every 5 min and make the safe fixes (fix mode since 2026-10-11)#' \
  > ~/.cockpit-guardian/crontab.new
diff <(crontab -l) ~/.cockpit-guardian/crontab.new    # exactly the comment and the guardian line change
crontab ~/.cockpit-guardian/crontab.new && rm ~/.cockpit-guardian/crontab.new
crontab -l | grep -c 'guardian.py --mode fix --quiet run'   # 1
```

Back to report-only: the same `sed` the other way round (or restore the backup
taken above). A run off the VPS (ssh) or a dry run never fixes, whatever the
mode. `GUARDIAN_MODE` in `~/.cockpit-guardian/env` is unset on purpose: the cron
line's flag decides.

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
| Claude proxy open to the internet | Port 3456 answers from outside without a key | the CEO | Bind the proxy to 127.0.0.1 (a firewall rule alone does not clear the check, which reads the listening address) |
| VPS memory | Under 1 GB available three scans running, no swap (urgent under 700 MB) | the CEO | Add swap, or stop the leftover cloudflared tunnels and restart the largest process |
| Leftover cloudflared tunnels | Hermes's gateway tunnel watchdog keeps starting tunnels | Hermes | Stop the leftovers; fix the watchdog's `kill -0` check |
| VPS crontab | A job line is gone (urgent) | the CEO | Read `~/.cockpit-guardian/crontab.diff`, then `crontab ~/.cockpit-guardian/crontab.proposed` after a backup. To pause a job on purpose, comment its line out (#) |
| A job's log or status row is late | The job stopped or keeps failing | Hermes | The alert names the log and the last error; in fix mode a copy-only job got one catch-up run |
| Hung cron runs | A run holds its lock far past its interval and its CPU time stopped moving | Hermes | Read the job's log first; a run that sends is never stopped by the guardian |
| Meta access | "API access blocked": B2B's Meta sync and the creative dashboard stop | the CEO, the systems manager | Settle the balance in Ads Manager or check Business Settings |
| Webinar pull: the gift survey | Composio gives no session | the CEO | Reconnect Typeform in Composio or check `COMPOSIO_API_KEY` |
| Tap payments sync | No good run for over an hour; 1249 "Charges not found" was an empty window that `listPage` threw on, fixed on main in 0a71aec (`tapResponse.ts`, deployed as v14 on 2026-10-07) | Hermes | If 1249 shows again, the function was redeployed from code without 0a71aec: redeploy tap-charges-sync from main (a person does this) |
| Hiring sync | Typeform applications are not reaching HighLevel, or the hiring board copy is old (hiring-sync on Supabase since Convex stopped on 2026-10-07) | the CEO | Never run: set `GHL_HIRING_PIT`, `GHL_HIRING_LOCATION` and `HIRING_APPLY=true` as Edge Function secrets, then apply `20261009c_hiring_native.sql` (docs/hiring/SWITCH-ON.md). Failing: read the newest failed row in `cockpit_hiring_runs` and the hiring-sync log |
| VPS backup | The nightly backup is old or failed | Hermes | Run the Nightly Backup job by hand and read why it exits with 1 |
| WhatsApp double sends | The WA Connector is not recorded off with a single-copy test | the CEO | Switch it off in HighLevel, test one message, set `connector_off` and `single_copy_ok_at` |
| CEO sections refresh | No section refreshed for 45 min: the native CEO refresh worker stopped or every run fails | Hermes | `bun run doctor` in hermes/ceo-refresh on the VPS; read the newest `cockpit_ceo_refresh_runs` row |
| Creative Triage (Supabase) | No answer, or a service not healthy, for 15 min | the CEO | status.supabase.com; the cockpits show their last good numbers |
| Live calls: ... not deployed yet | That piece does not exist yet | none | Nothing; it becomes a real check once deployed |
| Could not be checked | The guardian's source did not answer three scans running | Hermes | `python3 guardian.py doctor` on the VPS |
| The VPS answers | The guardian could not read the VPS (urgent); every VPS check waits on it | the CEO | Check the VPS is up, then its memory and disk |
| Guardian heartbeat | The dead-man beat to Cloudflare fails, so the guardian's silence would go unnoticed | the CEO | Check `PORTAL_MONITOR_CF_*` in monitor.env |
| Guardian incident rows | Rows waited over an hour for Supabase, or Supabase refused one | Hermes | Read `~/.cockpit-guardian/guardian.log` |
| Dead-man switch: cockpit-guardian | (from the Cloudflare worker, not the guardian) No beat for 10 minutes, or its alerts stuck 15 minutes | Hermes | `tail ~/.cockpit-guardian/cron.log`; `crontab -l`; `python3 guardian.py doctor` |
| The guardian cannot write its folder | A full disk: it only reads until it can save again | Hermes | Free space (`df -h`), then check `~/.cockpit-guardian` is writable |
| Slack notice queue | A kickoff or Brand Blueprint notice in `cockpit_slack_notices` (not a late kickoff's reply, next row) stayed queued, sending or unknown over 30 minutes, or one failed in 24 h. A kickoff waits up to 20 minutes for Make on purpose, so 30 is the line | the tech lead | Run the cockpit-notices doctor (`RUNBOOK.md`, Slack notices). An `unknown` may have posted: look in its channel for its `Ref CN-` first and never send it again blind. A `failed` names its cause: fix that, then requeue it with `cockpit_slack_notice_fix` (not one whose cause is Slack's `internal_error` or `fatal_error`: those are `unknown`, and may be in the channel). Nothing posting at all: read `slack-notices-kick` in `cockpit_sync_state` |
| Kickoff card updated reply queue | A late kickoff's reply (`kickoff.updated`) whose turn passed over 30 minutes ago, one sending or unknown that long, or one failed in 24 h. It waits on purpose, checking every 10 minutes for the card's Kickoff Handoff comment for up to 48 hours, so it is read by `next_attempt_at`, not by when it was made | the tech lead | The sender is not running: as the row above. A reply that waits is not a fault; the late notice above it is what the team acts on |
| Brand Blueprint press queue | A Brand Blueprint press in `cockpit_creative_outbox` stayed pending, or sending, over 10 minutes (the drain runs every 2 minutes; a run takes seconds), or one failed in 24 h | the tech lead | Read the press's error on the Blueprint card and `creative-drain-kick` in `cockpit_sync_state`. A press that failed after 30 minutes or 3 refusals is pressed again from the card once its cause is fixed. One still `sending` lost its run part way: check the card against its journal, then settle it by hand (`RUNBOOK.md`, Brand Blueprint press drain) |
| Brand Blueprint press needing a look | A press is in `reconcile`: ClickUp took the writes but the read-back did not match. Nothing retries it | the tech lead | Check the card in ClickUp against the press first, then settle the row by hand. Never press again before looking |
| Fathom webhook delivers | The webhook is registered, a Customer Success recording with a summary and shared with a team reached the store in the last 24 h (Fathom pushes only those, so a day of short or unshared calls is nothing due), and no delivery was stored in that time: Fathom stopped pushing, or the function refuses or fails its deliveries (the webhook deleted in Fathom's settings, the function down). Not registered yet, or unregistered: a note, nothing is due | the tech lead | Nothing is lost: the 15-minute read still brings every recording. Read the newest rows of `cockpit_fathom_webhook_deliveries` and the `fathom-webhook` note in `cockpit_sync_state`, check the webhook in Fathom's settings, or register it again with `scripts/dev/forms_key.py` (`RUNBOOK.md`, 1-1 notes in the cockpit) |
| ClickUp calls a minute | A minute in the last hour held over 80 ClickUp calls (over 95 fails), or ClickUp refused calls with 429 (10 or more fail). Since the move to ClickUp Business, the one token the Supabase functions and the VPS workers share may make 100 calls a minute. It counts the four provider ledgers (media, CSM, CEO, board); the VPS workers outside them add more, so the count is a floor. The native cycle stamps every receipt of a run with its publish time, so each run's calls are counted in every minute of its run (`cockpit_native_media_runs` `created_at` to `published_at`; a run not found there, the 15 minutes before its receipts): the busiest minute reads "up to" when a run is in it. That table unreadable, or no row at all in the hour, reads unknown, never zero | the systems manager | Read the busiest minute's split in the evidence. A cockpit job: lower its pacing secret (`CLICKUP_REQUESTS_CALLS_PER_MINUTE` 25, `CLICKUP_CALLS_PER_MINUTE` 30, `CLICKUP_TASKS_CALLS_PER_MINUTE` 30, `CLICKUP_FORMS_CALLS_PER_MINUTE` 10; 60 at most). The native cycle or the CEO refresh: ask Hermes to pace it. A press in the cockpit tries once more after ClickUp's wait; background jobs retry by themselves (`RUNBOOK.md`, What to do, by system, ClickUp; plan `docs/requests/CLICKUP-DOWNGRADE.md`) |

## Files

| Path | What |
| --- | --- |
| `guardian.py` | The commands |
| `guard/` | config (keys by name), db (two doors, the probe SQL), host and `vps_snapshot.py` (the read-only VPS look), context (sources and the breaker), engine (scan, dedupe, folding, fixes, alerts), store (state file and Supabase rows), alerts, beat (the dead-man heartbeat), fixes, report, ai, redact |
| `checks/` | One module per area; each check has an id, what it means, its severity, how it reads, its threshold and its optional safe fix |
| `crontab.manifest` | The 28 job lines of 2026-10-03, the guardian's own and the three live-calls lines of 2026-10-07 (`rooms --for 57`, `rooms --check-hosts`, `doctor --cron`), compared with the live crontab (a line commented out there reads paused) |
| `PROMPT.md` | The AI fixer prompt for a Claude session or a scheduled routine |
| `tests/` | Fakes for every source; `python3 -m unittest` |

## Every check

Generated with `python3 guardian.py checks --json`.

Two checks read a list in the code rather than a threshold. `edge-functions`
expects 24 functions (`checks/edge_functions.py`); since Stage 1 of the forms
program (`docs/forms/STAGE1-CONTRACT.md`) that includes `cockpit-notices` with
verify_jwt off (pg_cron calls it with `x-cron-secret`) and
`cockpit-creative-api` with it on, and since Stage 2a
(`docs/forms/STAGE2-CONTRACT.md`) `cockpit-forms-api` with it on (the 1-1
notes window's signed-in seats) and `fathom-webhook` with it off (Fathom signs
each delivery and sends no JWT). `pg-cron-jobs` expects 28 jobs
(`checks/pg_cron.py`), including `mahara-slack-notices` (20261025n, every
minute) and `mahara-creative-drain` (20261025o, every 2 minutes). Both fail
until those functions are deployed and those migrations applied, so the
guardian copy on the VPS is updated after them, not before. The three queue
rows read `state`, not `status`, and the two Blueprint rows count only the
kinds `blueprintLaunch`, `blueprintClose` and `blueprintOffer`.

Stage 2b (`docs/forms/STAGE2B-CONTRACT.md`, dark until the cut-over) adds
`forms-door` with verify_jwt off (Typeform signs each kickoff) to
`edge-functions` and `mahara-clickup-writeback-forms` (20261029t, every minute)
to `pg-cron-jobs`; `native-jobs` also reads `clickup-writeback:forms` (15 min: an
idle writer reports every ten), `forms-effects-kick` (10 min) and
`csm-forms-record` (45 min), and `csm-calls-sync` reads `csm-forms-record`,
warning when its `detail.errors` is above 0 (the row stays ok on purpose, Z15). All
of it fails until deploy steps D5, D8, D11 and D13 ran, so this copy lands at
D15, after them. Every 2b row is report-only. `csm-impromptu-notes` and the late
reading of `csm-checkin-form` count nothing before the cut-over. The `client-messages`
row reads `detail.receiptsMissing` as well: a provider call that left and whose
answer the health ledger lost warns, because the sender keeps that run ok and
never repeats the call. `queue-form-recap` leaves out a `queued` recap, which
waits on a person in Messages by design (Z36).

| Check | Catalogue | Threshold | Safe fix |
| --- | --- | --- | --- |
| `supabase-health` | S1 | A service not ACTIVE_HEALTHY, or no answer, for 15 minutes (by the clock, not by scans): fail; a read over 10 s: warn. |  |
| `vps-snapshot` | H9 | No snapshot two scans running: fail (urgent); a part unreadable: warn. |  |
| `guardian-db-copy` |  | Rows waiting over 1 h: fail (folded into supabase-health while that is down); a row refused: warn. |  |
| `guardian-beat` |  | Keys unreadable, or no good beat for 15 min: fail; `GUARDIAN_BEAT=off`: paused. |  |
| `claude-signin` | H1 | Any of them says the sign-in lapsed or signed out: fail. |  |
| `claude-proxy-up` | H2 | No answer, or a status other than ok: fail. |  |
| `claude-proxy-exposed` | H3 | Listening on 0.0.0.0 or [::], or an outside GET answers 200: fail. |  |
| `ceo-sections` | C1, C3 | All older than 45 min: fail (urgent); some old or failing: warn. |  |
| `native-jobs` | C3 | ok false, or older than 3 times its interval (45 min at least): fail. `clickup-writeback:kpi` and `:dosdonts` run only 03:00-19:00 UTC, so only those hours count. |  |
| `native-sources` | C7 | Any ok false: fail. |  |
| `ask-ai-queue` | H12 | Jobs waiting while nothing finished for 20 min: fail; 10 or more new failures in an hour: warn. |  |
| `csm-checkin-form` |  | Older than 7 days, or any 1-1 notes that arrived in Typeform after the switch-over: warn. |  |
| `csm-notes-parity` |  | Any client whose 1-1 notes from the store read `differs` from Typeform: warn (confirm 3). No `notesFrom` on the client rows reads ok (release N4 not live); all `off` reads ok (the notes are native); otherwise ok with the day of 7 counted from `notesParity.cleanSince` (G6, `docs/forms/STAGE2B-CONTRACT.md` 4.4). Only these four readings of rows that exist: G6 counts every incident of this check in 7 days, so its incidents mean only that the notes differ. No client row at all reads unknown, never ok: it could not compare, it clears nothing, and G6 leaves it out. A feed that stops publishing is `native-source-producer`'s (fail after 90 min), and G6 also holds while the newest `source_snapshot_at` is over an hour old; the publish time shows here as evidence only. |  |
| `csm-fathom-webhook` |  | Registered, a Customer Success recording first seen in the last 24 h that holds a summary and is shared with a team, and no stored delivery in 24 h: warn. |  |
| `csm-impromptu-notes` |  | Any such candidate not gone and not set aside: warn. Before the cut-over: ok. |  |
| `forms-kickoff-webhook` |  | Registered, and a kickoff of the last 24 h since registering, over 30 min old, stored by the read and not the webhook: warn. Not registered: ok. |  |
| `client-messages` |  | No run for 10 min once the row exists, or ok false without a hold: fail; approved recaps held (detail.held, written only in apply mode), provider calls whose answer the health ledger lost (detail.receiptsMissing above 0, either mode) or a mode other than dry or apply: warn. No row (before deploy D14): ok. |  |
| `client-messages-read-back` |  | A sent recap with no read-back, 60 min to 24 h after it was sent: warn. |  |
| `client-messages-read-back-stopped` |  | A sent recap with no read-back, 24 to 48 h after it was sent: warn, carried by one daily summary. Older ones are counted in the reading only. |  |
| `client-messages-g5` |  | Anything but ok with the note same number: warn. |  |
| `vps-memory` | H7 | Under 1024 MB available: warn; under 700 MB: fail (urgent with no swap); 3 scans in a row; clears only above 1536 MB, two scans in a row. |  |
| `vps-tunnels` |  | More than 50: warn. |  |
| `vps-disk` | H8 | Over 85%: warn; over 90%: fail (urgent). | gzip hermes's own logs over 50 MB (every line kept) |
| `vps-code-copy` | H11 | Older than 7 days or any local change: warn (daily summary only). |  |
| `vps-crontab` | H4 | A manifest job missing: fail (urgent); a schedule changed: warn; commented out on purpose: paused. | back up the crontab and write the proposed restore (not installed) |
| `vps-hung-runs` | H6 | Older than 4 times the job's interval (at least 60 min) and no CPU time for 15 min: fail; past that age but still working: warn. | stop the hung copy-only cron run once its CPU time has stopped moving (SIGTERM, then SIGKILL after 30 s) |
| `log-eod-out` | H5 | No write for 15 min: fail; a Python traceback written since the last scan: warn. |  |
| `log-review-import` | H5 | No write for 10 min: fail; a Python traceback written since the last scan: warn. |  |
| `log-review-watch` | H5 | No write for 25 min: fail; a Python traceback written since the last scan: warn. |  |
| `log-hala` | H5 | No write for 35 min: fail; a Python traceback written since the last scan: warn. |  |
| `log-team-sync` | H5 | No write for 15 min: fail; a Python traceback written since the last scan: warn. | start one catch-up run of team-sync under its own lock |
| `log-editor-desk` | H5 | No write for 15 min: fail; a Python traceback written since the last scan: warn. |  |
| `log-ideation-radar` | H5 | No write for 10 min: fail; a Python traceback written since the last scan: warn. |  |
| `log-sales-desk` | H5 | No write for 10 min: fail; a Python traceback written since the last scan: warn. |  |
| `desk-doctor` | W2 | Older than 75 min while the live-calls watchdog exists: warn. |  |
| `salma-status` | W10, M3 | Newest row older than 15 min (a row from this second is fresh), or no row with a time, or a check failing: fail; captions paused by the Claude sign-in: folded into claude-signin; publishing switched off for every client: paused. |  |
| `salma-publishing` | W10 | Any client switched on: warn (report only). |  |
| `webinar-zoom` | W13 | No ok read in 3 h, or no run in 90 min: fail. | start one catch-up run of webinar-pull under its own lock |
| `webinar-survey` | W13 | No ok read in 24 h: fail. |  |
| `webinar-reminders` | W13 | No ok read in 14 h, or no run in 7 h: fail. |  |
| `webinar-objections` | W13 | Paused on purpose is a decision, not a failure; otherwise no ok read in 24 h: fail. |  |
| `editor-sync` | W11 | Older than 90 min: fail. | start one catch-up run of editor-sync under its own lock |
| `team-recordings` | W11 | Older than 3 h: fail. |  |
| `radar-scan` | W14 | Older than 8 days: fail. |  |
| `tap-charges` |  | ok false, or no ok run in 1 h: fail. |  |
| `desk-vault-lag` | W3 | The vault 3 or more days behind: warn. |  |
| `desk-maqsam` | W4 | Fewer copied than Maqsam reports on any of the last 3 days: fail; no call at all for 7 days: warn. |  |
| `hiring-engine` | W15 | Armed: warn. |  |
| `hiring-sync` |  | No hiring-sync row, a job with ok false, the mirror or engine with no good run for 30 min, the intake for 90 min, or the newest candidate copied over 30 min ago: fail; the intake in a dry run because HIRING_APPLY is not true, or dry for over 75 min (the first run after the switch-on is dry on purpose): warn. |  |
| `desk-requests` | H5, W2 | ok false, or older than 15 min: fail. A missing row: unknown. |  |
| `desk-followups` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. |  |
| `desk-notes` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. |  |
| `desk-reviews` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. |  |
| `desk-recordings` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. | start one catch-up run of desk-recordings under its own lock |
| `desk-calls-vault` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. | start one catch-up run of desk-calls-vault under its own lock |
| `desk-maqsam-calls` | H5, W2 | ok false, or older than 75 min: fail. A missing row: unknown. | start one catch-up run of desk-maqsam-calls under its own lock |
| `desk-digest` | H5, W2 | ok false, or older than 26.0 h: fail. A missing row: unknown. |  |
| `sales-mirror` | S4 | Newest run older than 15 min (urgent), or 3 failures in a row: fail. |  |
| `sales-mirror-drop` | S5 | The newest run refused a drop: fail. |  |
| `sales-locks` | S6 | Held more than 15 min ahead: warn. |  |
| `crm-syncs` |  | Any last_status that is not ok (a 429 only once older than 2 h), or older than 26 h: warn. |  |
| `client-panels` |  | Not ok, or older than 26 h: fail. |  |
| `meta-access` | M7 | 'API access blocked', an OAuthException, or an account status other than 1: fail. |  |
| `b2b-sources` | W5 | A status other than success or running, or a last success older than its cadence (meta 60 min): warn. |  |
| `clickup-rate-budget` |  | Any minute in the last hour over 80: warn; over 95: fail. Any 429 in the hour: warn; 10 or more: fail. |  |
| `live-tables` |  | None: not deployed yet; some of a migration but not all: fail. |  |
| `live-function` |  | Missing: not deployed yet; anything else wrong: fail. |  |
| `live-code` |  | A function deployed without its live-calls modules: fail (urgent). |  |
| `live-cron` |  | Tables missing: not deployed yet; tables there and a job missing: fail. |  |
| `live-dns` |  | No DNS: not deployed yet; resolves but no answer: fail. |  |
| `live-rooms-worker` |  | Not there: not deployed yet; older than 90 s: warn; 10 min: fail. |  |
| `live-status-rows` |  | Tables missing: not deployed yet; a part failing: fail. |  |
| `live-settings` |  | Missing: not deployed yet; enabled false: paused. |  |
| `live-alerts` |  | Missing: not deployed yet; an alert that did not reach Slack (no webhook, or unposted 15 min in working hours): fail, posted by the guardian; the watchdog late or unscheduled: warn; open alerts it posts itself: warn, quiet. |  |
| `pg-cron-jobs` | S2 | A job missing or inactive: fail. |  |
| `pg-cron-runs` | S3 | A 400+ answer or a timeout in the last hour: fail (a missing function only while it cannot be sales-live before its deploy); 2 or more failed runs of one job in 24 h: warn. |  |
| `pg-cron-secrets` |  | Any job with a literal Authorization value: warn (summary only). |  |
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
| `queue-social-jobs` | W9 | Any row waiting over 60 min, or any row failed in 24 h: warn. |  |
| `queue-sales-requests` | W1 | Any row waiting over 60 min: warn. |  |
| `queue-sales-requests-waiting` | W1 | Any row waiting over 15 min: warn. |  |
| `queue-editor-requests` | W11 | Any row waiting over 60 min, or any row failed in 24 h: warn. |  |
| `queue-ideation-requests` | W14 | Any row waiting over 60 min, or any row failed in 24 h: warn. |  |
| `queue-post-jobs` | M4 | Any row waiting over 60 min, or any row failed in 24 h: warn. |  |
| `queue-ask-ai` | H12 | Any row waiting over 30 min: warn. |  |
| `queue-eod-outbox` | W8 | An EOD failed, cut off or refused and not posted (last 7 days, however old within them): fail, at any hour while a person's EOD is missing from Slack; the action names its channel and Slack's answer. A row waiting over 15 min with no answer from the worker: warn. |  |
| `queue-team-calendar` | W12 | Any row waiting over 30 min: warn. |  |
| `queue-feedback` | X3 | Any row waiting over 24.0 h: warn. |  |
| `queue-slack-notices` |  | Any row waiting over 30 min, or any row failed in 24 h: warn. |  |
| `queue-slack-notice-replies` |  | Any row waiting over 30 min, or any row failed in 24 h: warn. |  |
| `queue-creative-blueprint` |  | Any row waiting over 10 min, or any row failed in 24 h: warn. |  |
| `queue-creative-reconcile` |  | Any open row: warn. |  |
| `queue-clickup-forms` |  | Any row waiting over 15 min, or any row failed in 24 h: warn. |  |
| `queue-form-effects` |  | Any row waiting over 30 min, or any row failed in 24 h: warn. |  |
| `queue-form-recap` |  | Any row waiting over 30 min: warn. |  |
| `queue-client-messages` |  | Any row waiting over 15 min, or any row failed in 24 h: warn. |  |
| `queue-client-messages-unknown` |  | Any open row: warn. |  |
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
| `hermes-monitor-cockpits` |  | No tick for 3 min, or an alert undelivered for 30 min: fail; open incidents: listed (it alerts on its own). |  |
| `hermes-monitor-sites` |  | No tick for 3 min, or an alert undelivered for 30 min: fail; open incidents: listed. |  |
| `hermes-monitor-portal` |  | No tick for 3 min, or an alert undelivered for 30 min: fail; open incidents: listed. |  |
| `hermes-monitor-dialer` |  | No tick for 3 min, or an alert undelivered for 30 min: fail; open incidents: listed. |  |
| `deadman-beats` |  | A Hermes monitor's beat older than 15 min, or more KV writes a day than Cloudflare's free 1,000: warn. |  |
| `hermes-jobs` |  | An enabled job whose last run failed: warn (the Cron guardian job already watches these). |  |
| `vps-backup` |  | Either says the backup failed or is old: fail. |  |
