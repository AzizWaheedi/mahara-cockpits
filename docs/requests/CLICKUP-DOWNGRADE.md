# ClickUp Business readiness: the change plan

Written 2026-10-29 on branch `clickup-diet-1029` (from origin/main 64807762).
Paths are relative to the repository root. Line numbers are those of 64807762.

**Why.** The CEO pays for ClickUp Business Plus only for the conditional logic
in ClickUp Forms. The cockpit's own request form ("Ask a team") replaces the
ticket form, so he will move to ClickUp **Business**. Business keeps webhook
Automations, templates and custom fields. What changes for the cockpit is the
API limit: **1,000 calls a minute per token on Business Plus, 100 on
Business** (developer.clickup.com/docs/rate-limits). One personal ClickUp
token serves the Supabase functions and every VPS worker
(`hermes/cockpit-sync/transport.ts:229-231` reads the same
`CLICKUP_API_TOKEN`; the audit compared the VPS key files by hash).

Live facts used below were read on 2026-10-29 with read-only selects
(Creative Triage) and `crontab -l` on the VPS. Nothing was written anywhere.

## Decisions at a glance

1. **Budget: 80 calls a minute for the whole token**, warn above 80, fail
   above 95, ClickUp refuses above 100. The cockpit's own Supabase jobs aim
   at **40 at their busiest expected minute** and stay off the native
   cycle's minutes; the VPS gets the other 40.
2. **New pacing defaults:** requests 120 → **25**, log/kpi/dosdonts 90 →
   **30**, task mirror 120 → **30**, comment watch and onboarding sync
   700 ms → **2,000 ms** between calls. Every pace is capped at 60. Delta
   caps go from 40 comment threads and 10 reply reads to **25 and 5**, so a
   full delta run is at most 40 calls (80 s) and never overlaps the next.
   Focus-view and doctor reads are not paced (a person is waiting).
3. **Two pg_cron moves are worth one small migration:** comment watch from
   `7-59/15` to **`13,29,43,59 * * * *`** and the KPI writeback from
   `5 3-18` to **`23 3-18 * * *`**. Both ran inside the native cycle's
   runs (:00-:07, :15-:22, :30-:37, :45-:52); counting each native run in
   every minute it ran, the worst minute over 307 runs was 98 (the KPI at
   06:05), 79 with the comment watch, and 66 without the two. The new
   minutes are odd and no multiple of 3 or 5, so no */2, */3 or */5 job
   shares them, on pg_cron or on the VPS (the editor desk's ClickUp
   requests run is */3).
4. **429 safety:** every interactive ClickUp helper tries **once more** after
   ClickUp's own wait (Retry-After, else X-RateLimit-Reset), at least 1 s and
   at most 5 s, for reads and writes alike, because a 429 means ClickUp did
   nothing. Background writers keep their own retries and do not opt in.
5. **Visibility:** a new guardian check, `clickup-rate-budget`, reads the
   four ClickUp ledgers every scan and warns on any minute over 80 in the
   last hour, fails over 95, and warns on any 429. The cockpit-tasks doctor
   already reports the live limit; it also prints its own pace.
6. **No ClickUp form anywhere in the cockpit.** The send gate lets **every
   seat** save a request when it cannot go to ClickUp at once (writer quiet,
   dry run, testing): the request is held and goes to ClickUp by itself.
   The five "Use the ClickUp request form" branches go. Every link to form
   1178 goes. The creative director's key link and command palette entry
   point to "Ask a team".

---

## 1. The budget

### 1.1 What the ledgers hold

ClickUp calls land in four provider ledgers, one row per call
(`phase` `response` or `unknown`):

| Ledger | Who writes it | ClickUp rows |
| --- | --- | --- |
| `cockpit_media_provider_health` | clickup-writeback, cockpit-tasks, cockpit-media-api, cockpit-creative-api, tracking-audit (Edge, `action_id`), and the VPS native cycle (`native_run_id`) | 19,885 |
| `cockpit_csm_provider_health` | comment-watch, onboarding-sync, billing-sync, cockpit-notices, cockpit-csm-api | 11,123 |
| `cockpit_ceo_provider_health` | cockpit-ceo-api and ceo-extensions-sync, and the VPS ceo-refresh (`refresh_id`/`run_id`) | 384 |
| `cockpit_board_provider_health` | cockpit-board-api levers (`cockpit-board-api/lever.ts:139-146`) | 0 (the audit named three; this is the fourth) |

**Retention matters.** `cockpit_backend_retention` (daily at 01:17 UTC)
keeps successful responses **3 days**, failures (429 included) 30 days and
intent rows 1 day. So the "7-day" call counts are really
**2026-10-26 to 2026-10-29 (about 3.7 days)**. Run durations come from the
run tables, which keep 7 days. No 429 is on record (30 days).

### 1.2 Per job: real runs and per-minute use

Per run = ClickUp calls under one action id. "Max in a minute" = the most
calls that job made inside one clock minute. Writeback runs are joined on
`cockpit_clickup_writeback_runs.id` and queue items on
`cockpit_clickup_writeback_queue.id`; task-mirror runs are told apart by
their resources (a seats run reads `team`).

| Job (schedule, UTC = Kuwait minute) | Runs | Calls per run p50 / p95 / max | Max in a minute | Pace today | Pace now | Largest real run at the new pace | Window |
| --- | --- | --- | --- | --- | --- | --- | --- |
| requests: a request (every minute, only with work) | 5 (the 27 Oct rehearsal) | 13 / 18 / 18 | 43 (5 filed at once) | 120 | **25** | 18 calls: one window, about 15 s. Worst type (Social media, 10 SOP steps, no template) about 22: one window. 5 at once (70 calls): 3 windows, about 2.5 min over two runs | run budget 100 s (`clickup-writeback/run.ts:469`), Edge wall 150 s: worst item started at 100 s waits for the next window and ends by about 135 s. One requests run sends at a time (section 1.3), so 25 is the job's pace, not one run's |
| requests: a focus-view press | 8 | 1 / 3 / 3 | 3 | 120 | **25** | 3 calls | every minute |
| 1-1 notes, job `forms` (every minute, only with work; dark until the 1-1 notes cut-over, `docs/forms/STAGE2B-CONTRACT.md` 4.1) | 0 | about 11 for one response (not yet run live) | 0 | new | **10** (`CLICKUP_FORMS_CALLS_PER_MINUTE`, 60 at most, one run at a time) | none yet; one response takes a little over a minute | every minute |
| kpi (`5 3-18`, moving to `23 3-18`) | 66 in the ledger, 78 apply runs in 7 days (avg 10.3 s, max 44.8 s) | 18 / 41 / 51 (the 06:05 Kuwait run; 75 once, a manual run on 24 Oct) | 51 | 90 | **30** | 51 calls: 2 windows, about 70 s. 75 calls: 3 windows, about 130 s | hourly; Edge 150 s |
| log (`*/2`) | 13 items | 1 / 2 / 2 | 4 | 90 | **30** | claim of 15 items, about 30 calls: one window | 2 min |
| dosdonts (`35 3-18`) | 60 | 1 / 1 / 1 (dry run) | 1 | 90 | **30** | 1 call | hourly |
| task mirror delta (`*/2`) | 1,571 | 1 / 2 / 18 | 37 (27 Oct 14:26, the rehearsal, with focus views) | 120 | **30** (2 s apart) | 18 calls: 36 s. Capped worst run, 10 pages + 25 threads + 5 replies = 40 calls: 80 s | 2 min (no overlap) |
| task mirror seats (`11 *`) | 56 | 17 / 18 / 18 | 18 | 120 | **30** | 18 calls: 36 s | hourly |
| focus view, tasks doctor (on press) | 3 | 2 | 2 | 120 | **not paced** | 2 calls, no added wait (a 2 s gap would delay the person) | interactive |
| comment watch (`7-59/15`, moving to `13,29,43,59`) | 343 in the ledger, 655 in 7 days (avg 23.9 s; 28 cards) | 29 / 30 / 30 | 30 | about 86 (700 ms) | **30** (2,000 ms) | 30 calls: about 60 s. The rules step runs first and stops starting rules at 25 s (`RULES_BUDGET_MS`: 3 or 4 rules written, about 12 only read); the card scan has the rest of the 95 s budget: about 30 cards after a full rules step, about 46 with none. Cards left unread are read first next run (fixed order by card id, starting after the last card read, `counts.resume_after` on the run row), so none is skipped run after run | 15 min |
| onboarding sync (`4-59/10`) | 514 | 2 / 2 / 2 | 2 | about 86 (700 ms) | **30** (2,000 ms) | 2 calls (21 if the list ever reaches 20 pages: 42 s) | 10 min; budget 100 s |
| billing sync (`7,37 3-18`) | 121 | 2 | 2 | none (2 in a row) | unchanged | 2 calls | 30 min |
| ceo-extensions-auto (`47 *`) | about 85 calls | 1 | 1 | none | unchanged (gains the 429 retry) | 1-2 calls | hourly |
| cockpit presses (media, creative, CSM, CEO, board) | 143 + 11 + 85 calls | 1-4 | 10 | none | unchanged (gain the 429 retry) | | interactive |

VPS callers inside these ledgers (not the cockpit's to change):

| Caller | Runs | Calls per run | Max in a minute |
| --- | --- | --- | --- |
| native cycle (`run-source-ceo-cycle.py`, `*/15`) | 334 | 46-48 (about 40 comment threads on Clients - Mahara cards updated in 14 days, `hermes/cockpit-sync/calculator.ts:3025-3037`, plus list reads) | 48 |
| ceo-refresh | | about 1 a minute | 1 |

**One caveat on the native cycle.** Its receipts all carry the moment the
run published (`cockpit_native_media_runs.published_at`, 5-7 minutes after
it starts at :00/:15/:30/:45; 352 s on average, 805 s at most), so the
ledger shows its 47 calls in the publish minute (:04-:07, :19-:22, :34-:37,
:49-:52), not the minutes they were made (run 070ca214: 48 calls between
19:00:05 and 19:07:45 Kuwait, every one stamped 19:07:40). So a busiest
minute read from the stamps says little about when the native calls came.
The guardian and migration q count each native run in every minute from its
start to its publish instead, an upper bound (section 3.1).

### 1.3 The busiest minutes, before and after

Token total (all four ledgers), 2026-10-24 to 2026-10-29: busiest minute
**90** (28 Oct 07:05 Kuwait: native 46 + kpi 44), p99 64, 51 minutes over
50, 16 minutes at 70 or more, 0 over 100, average 12. Supabase jobs alone:
average 6.9, p99 31, 132 minutes over 30, 6 over 40, busiest 80 (the
rehearsal).

The 16 minutes at 70 or more, by their stamps (see the caveat in 1.2: the
native share is counted in its publish minute, so these say which jobs met
the publish, not when the native calls were made; migration q's header has
the run-window count, worst 98, 79 and 66):

| Pattern | Minutes | Busiest | After this plan |
| --- | --- | --- | --- |
| native publish + comment watch (:07, :22, :37, :52) | 13 | 79 | apart: native minute about 48 plus background (delta p95 2, onboarding 2); comment-watch minute about 30 |
| native publish + kpi (:05) | 2 | 90 | apart: kpi at :23 caps at 30 (a 51-call run puts 30 in :23 and 21 in :24) |
| rehearsal: 5 requests at once + task mirror | 1 | 80 | requests at most 25 a minute for the whole job (one run at a time, below), delta at 30: at most 55 |

**One requests run at a time.** Every submit
(`cockpit_clickup_requests_kick`, `20261026r_requests.sql:2051`), every
focus-view press (`20261026t_task_alerts.sql:986`) and the minute cron each
start a requests run, and runs claim different rows (`FOR UPDATE SKIP
LOCKED`), while the pacer belongs to one Edge Function call. So the pace only
covers the job if one run sends at a time. `runRequests`
(`clickup-writeback/run.ts`) opens its run with an exclusive
`cockpit_clickup_writeback_begin` (20261026r: under the job's advisory lock,
no id while a requests run is open). A run that finds another open hands back
every row it claimed through `cockpit_clickup_writeback_release` (the claim's
try taken off, so no rung of the retry ladder is spent) and reports "Another
requests run is still sending, so this one handed back the rows it claimed;
the next run takes them." A run still open 4 minutes after it started on the
Kuwait clock stopped without reporting back (a live run stops taking rows at
100 s and ends by about 150 s), so the next run goes ahead and says so; the
database closes it at 15 minutes. No migration: the exclusive begin, its
busy note and the release are live (read 2026-10-29; the longest requests run
in 7 days took 43 s). Rows the run's 100 s budget holds back are handed back
the same way. Lowering `CLICKUP_REQUESTS_CALLS_PER_MINUTE`, as the runbook
says, therefore lowers the whole job.

The task mirror's two readers are separate runs, each paced at 30: the seats
read (hourly at :11, 18 calls) and a delta that started at :10 can share the
:11 minute, at most 48 between them.

**Expected after the change:** busiest stored minute about 50 (a native
publish), Supabase jobs about 30 at their scheduled peaks (comment watch,
kpi). That is inside 80 with room for the VPS workers no ledger counts.

**Ceilings are not expected use.** If every Supabase ceiling met in one even
minute (delta 30 + log 30 + requests 25 for the whole job + presses 10 +
onboarding 2) the sum would be 97. The seats read's 18 fall in the odd :11
minute, which the log's even minutes never share. That needs a delta of 40
calls, a log backlog of 15 items, a request and a busy press minute at once; on record the log never passed 4
and the delta passed 2 in under 5% of runs. The ceilings bound a runaway
(a backlog, a new card list); the guardian (section 3) sees an alignment.

### 1.4 The pacing changes (builder: budget)

| File | Change |
| --- | --- |
| `supabase/functions/clickup-writeback/run.ts` | Export `writebackPerMinute(job: string, env): number`: requests and requests_doctor read `CLICKUP_REQUESTS_CALLS_PER_MINUTE`, default **25**; every other job reads `CLICKUP_CALLS_PER_MINUTE`, default **30**; a missing, non-numeric or non-positive value gives the default; the result is clamped to **5..60**. Comment: ClickUp Business allows 100 a minute for the one token the VPS shares; no job takes more than 60; this plan's file name. |
| `supabase/functions/clickup-writeback/index.ts:6, 33-35, 77-79, 90-91` | Use `writebackPerMinute(job, env)`; drop `Math.min(1000, Math.max(10, …))`; header comment: kpi "hourly at :23, 03-18 UTC (20261029q)", the two secrets with their defaults 25 and 30. Remove "the token allows 1,000 calls a minute (read 2026-10-26)". |
| `supabase/functions/cockpit-tasks/clickup.ts:45-48` | `callsPerMinute` default **30**, clamp **5..60**; comment says why. `ClickUpReader` takes an optional third argument `{interactive?: boolean}`: interactive readers are not paced and pass `{retry429: true}` to `providerTools` (section 2). |
| `supabase/functions/cockpit-tasks/delta.ts:26-28` | `COMMENT_TASKS` 40 → **25**, `REPLY_READS` 10 → **5** (`DELTA_PAGES` stays 10). The due queue rotates (`cockpit_task_mirror_comment_due`), so a busy minute only delays a comment alert by one run. |
| `supabase/functions/cockpit-tasks/detail.ts:53`, `doctor.ts:30` | `new ClickUpReader(deps, deps.uuid(), { interactive: true })`. |
| `supabase/functions/cockpit-tasks/doctor.ts:69` | Note: "ClickUp answers ({limit} calls a minute allowed; the task mirror reads at {pace} a minute); …". A problem when the pace is more than 60% of the reported limit: "The task mirror is set to {pace} calls a minute, more than 60% of the {limit} ClickUp allows this token. Lower CLICKUP_TASKS_CALLS_PER_MINUTE." |
| `supabase/functions/cockpit-tasks/README.md:37, 54` | 120 → 30; the cap; the interactive reader. |
| `supabase/functions/clickup-writeback/run.ts` `runRequests` (review) | The begin is exclusive (`p_exclusive: true`); a run that finds another open hands its claimed rows back with `cockpit_clickup_writeback_release` and reports `anotherRunNote`; an open run 4 or more Kuwait minutes old (`openRunMinutes`, `STALE_RUN_MINUTES`) does not hold the next one up. Rows held by the run budget, by a stop or because the run could not start go back through the same release (fallback: `retry` with `progress.held` + 1), never a `retry` save with the claim's try still counted. |
| `supabase/functions/comment-watch/watch.ts:23-24, 44-45` | `CLICKUP_GAP_MS` 700 → **2_000**; comment "30 calls a minute; ClickUp Business allows 100 for the token the VPS shares". Review: `RULES_BUDGET_MS` 25 s for the rules step, so the scan keeps the rest of `SCAN_BUDGET_MS`; the scan reads the cards in a fixed order by id starting after the last card the previous run read (`counts.resume_after`, read through `Store.resumeAfter`), and the out-of-time note names the cards left ("... are read first next run"). The place moves only once what was read is saved. |
| `supabase/functions/onboarding-sync/sync.ts:20-23, 37-38` | `CLICKUP_GAP_MS` 700 → **2_000**; same comment. |

Secrets: set `CLICKUP_REQUESTS_CALLS_PER_MINUTE=25`,
`CLICKUP_CALLS_PER_MINUTE=30` and `CLICKUP_TASKS_CALLS_PER_MINUTE=30`
explicitly at deploy (section 6). Their current values could not be read;
an old value (120 say) would override the new defaults, and the clamp at 60
is the backstop.

### 1.5 pg_cron collisions and the two moves

Jobs that call ClickUp, by the minutes the audit named (Supabase jobs from
`cron.job`, VPS jobs from `crontab -l`):

| Minute | Supabase jobs | VPS at the same minute |
| --- | --- | --- |
| :05 | `mahara-clickup-writeback-kpi` (`5 3-18`), `mahara-clickup-writeback-requests` (every minute) | native publish (typical :04-:07), editor desk `sync` (`*/5`), ad-billing guard (`*/5`), Hermes Merge Studio readiness (every 5 min) |
| :07 | `mahara-comment-watch` (`7-59/15`), `mahara-billing-sync` (`7,37 3-18`), requests | native publish, editor desk `prepare` (`7,37`) |
| :22 | comment watch, `mahara-task-mirror` and `mahara-clickup-writeback-log` (`*/2`), `mahara-creative-drain` (`*/2`), requests | native publish (:19-:22), task-assignment alerts, video review flow (`*/2`) |
| :37 | comment watch, billing sync, requests | native publish, editor desk `prepare` |
| :52 | comment watch, task mirror, log, creative drain, requests | native publish (:49-:52), task-assignment alerts, video review flow |

Decision: **move two jobs, in one migration** (builder db-guardian,
`supabase/migrations/20261029q_clickup_cron_spread.sql`):

- `mahara-comment-watch` (jobid 464, command md5
  `49e2a52769dd3ddfceab803c43e03060`): `7-59/15 * * * *` →
  **`13,29,43,59 * * * *`**. All four minutes are odd, so no `*/2` job
  (task mirror, log, creative drain, task-assignment alerts, video review)
  and no multiple of 5 or 3 (the VPS editor desk's ClickUp requests run is
  `*/3`) shares them, none is the editor desk's meetings minute (:27), and
  none falls in a typical native run. A run at :29 or :59 can last into the
  first seconds of the next native run (at most the last 35 s of its 95 s
  budget). Gaps of 16 and 14 minutes; the guardian allows 45
  (`hermes/cockpit-guardian/checks/sections.py:107`).
- `mahara-clickup-writeback-kpi` (jobid 459, command md5
  `39c110fd69f26fd5b58543e63a1ef9ea`): `5 3-18 * * *` → **`23 3-18 * * *`**.
  Odd, no multiple of 3 or 5, after the :15 native run, the same 03-18 UTC hours
  (`sections.py:23-25` reads the hours, not the minute).

The file uses `cron.alter_job(jobid, schedule := …)` so the command is not
touched. It refuses and changes nothing (RAISE EXCEPTION, whole file) when a
job is missing or its schedule is neither the one read live today nor the
new one; a second run changes nothing. With no `cron` schema it raises a
notice and does nothing (PGlite). Nothing else moves: billing sync (2 calls)
and seats at :11 (odd, alone) do not need it.

### 1.6 VPS callers the cockpit does not own (recommendations only)

None of these is changed by this plan. "Unledgered" means no ledger counts
their calls, so the guardian's number is a floor.

| Caller | Schedule | ClickUp use | 429 handling | Recommendation |
| --- | --- | --- | --- | --- |
| cockpit-sync, the native cycle (`hermes/cockpit-sync`, `run-source-ceo-cycle.py`) | `*/15` | 46-48 a run, one burst, ledgered at publish | none found in the calculator | **The biggest single burst on the token.** Read comments from `cockpit_task_mirror_comments` (the task mirror reads new comments on changed tasks every 2 minutes) instead of about 40 threads every 15 minutes, or read only threads whose task `date_updated` moved since the last run. Pace at 20 a minute. Stamp each receipt when its call is made. |
| ceo-refresh (`hermes/ceo-refresh`) | `*/15` | about 1 a minute, ledgered | | Keep. |
| task-assignment alerts (`hermes/task-assignment-alerts/worker.py:95-146`) | `*/2` | about 4,300 a day, unledgered | retries 429 (`worker.py:114`) | Count calls in its heartbeat note; later read the cockpit's task mirror instead of polling ClickUp itself. |
| editor desk (`hermes/editor-desk/desk/clickup.py`) | `sync */5`, `requests */3`, `prepare 7,37`, `notes 17`, `deck-import` every minute | unledgered | retries 429 twice with Retry-After (`desk/http.py:18, 87-90`) | Count calls per command in its log. |
| video review flow (`hermes/video-review-flow/worker.py:44-45`) | `*/2` | comment reads and writes, unledgered | retries 429 (`worker.py:56`) | Count calls. |
| review watch (`/opt/data/bibi/agents/review-watch/watch.py`, repo copy `hermes/review-watch/watch.py:65-85`) | `*/10` | comment posts, unledgered | **none** | One retry after Retry-After on a 429, then count calls. |
| ad-billing guard (`hermes/ad-billing-guard/transport.ts:140-346`) | `*/5` | comments and reads, unledgered | retries 429 (`transport.ts:65`) | Count calls. |
| cockpit-worker (`~/.cockpit-worker`: `cockpit_worker.py`, `content_studio.py`, `frameio-review-cycle.sh` `*/5`) | | ClickUp use not measured | unknown | Measure first. |
| Hermes scheduled jobs (`/opt/data/cron/jobs.json`): Next POC sync (every 15 min, writes Last and Next POC fields), Merge Studio launch readiness (every 5 min), Billing Agent (daily 06:00), Overdue payments (daily) | as listed | same key, unledgered | unknown | Count calls; spread the 5- and 15-minute jobs off :00/:05. |

If the guardian warns more than once a day after the switch, the cheapest
structural fix is a second ClickUp user (one more seat) whose token the VPS
workers use: each token has its own 100.

---

## 2. 429 safety for interactive tools

ClickUp answers 429 before it does anything, so one retry is safe for a
read and for a write. The helpers today throw at once:
`cockpit-csm-api/tools.ts:11` ("ClickUp rejected the request (429); inspect
its receipt."), `cockpit-media-api/tools.ts:46-52` (header line 2: "never an
automatic write retry") and `cockpit-ceo-api/tools.ts:179-182` (header line
151: "No automatic retry after a response").

### 2.1 The shared rule (builder: budget)

New file `supabase/functions/_shared/clickupRetry.ts`:

- `clickupRetryWait(headers: Headers, now: number): number`: `Retry-After`
  in seconds when present and positive; else `X-RateLimit-Reset` (a value
  above 1e9 is epoch seconds, `reset * 1000 - now`; a smaller one is
  seconds from now); else 1,000 ms. Clamped to **1,000..5,000 ms**.
- `CLICKUP_BUSY = "ClickUp is at its limit of calls this minute and refused
  this step."` It speaks for the refused call only. A press can make several
  calls in a row (`executeCsm`: fields, read-back, ticket, Request Type,
  comment; media lifecycle and creative builds likewise), so it never says
  the action changed nothing, nor that a second press will work: after a
  failure the press's own receipt rules apply (the CSM action and the board
  lever go to reconcile and the same request id is refused until then).
- `CLICKUP_BUSY_LANDED = "An earlier step of this action already went
  through, so check what it changed before you try again."` The CSM and
  media helpers note, per provider instance (one press), whether an earlier
  non-GET call got a success answer (any provider, for media); when it did,
  this sentence follows `CLICKUP_BUSY`. Reads never count.
- `type RetryOptions = { retry429?: boolean; sleep?: (ms: number) =>
  Promise<void>; now?: () => number }`.

Each helper, only when `retry429` is on and only for ClickUp: on the first
429 it writes the 429 response row as today, sleeps
`clickupRetryWait(response.headers, now())`, writes a new intent row and
sends the same request again (the same method, path and encoded body). A
second 429 throws the helper's existing sentence followed by
`CLICKUP_BUSY` (and `CLICKUP_BUSY_LANDED` when an earlier write in the press
went through), so every pattern that parses `rejected the request (NNN)`
keeps working. Any other status, a timeout or an unreadable answer behaves
exactly as today. Every attempt is its own pair of ledger rows.

### 2.2 Every Supabase helper that calls ClickUp interactively, and the change

| Helper | Change | Interactive call sites that opt in |
| --- | --- | --- |
| `cockpit-media-api/tools.ts` `providerTools(env, health, request = fetch, opts?: RetryOptions)` | Retry as 2.1 when `provider === 'clickup'` and `opts.retry429`; Meta, Slack, GoHighLevel and Make never retry. Header line 2 becomes "never an automatic write retry, except one after ClickUp's 429, which ClickUp refuses before doing anything". | `cockpit-media-api/index.ts:53` (client lifecycle) and `:80` (the door's other operations); `cockpit-creative-api/index.ts:55` (creative requests); `cockpit-creative-api/build.ts:41` (campaign build); `cockpit-creative-api/blueprint.ts:180` and `:187` (the rehearsal and the Settings member picker call `tools(env, health)`: pass `fetch, {retry429: true}`); `cockpit-tasks/clickup.ts:77` for an interactive `ClickUpReader` only (focus view `detail.ts:53`, doctor `doctor.ts:30`). |
| `cockpit-csm-api/tools.ts` `providerTools(token, health, request = fetch, opts?: RetryOptions)` | Retry as 2.1. | `cockpit-csm-api/index.ts:78`; `cockpit-csm-api/portalTasks.ts:87`; `cockpit-csm-api/onboarding.ts:46`; `cockpit-csm-api/projections.ts:106`; `cockpit-csm-api/checkins.ts:69`; `cockpit-board-api/lever.ts:139`. |
| `cockpit-ceo-api/tools.ts:153-182` `clickupRequest(env, health, request, method, path, body?, label?, options: {sleep?, now?} = {})` | Retry **always** (both callers are low volume and neither retries today): the CEO's Extension (weeks) write (`cockpit-ceo-api/endpoints.ts:36, 55`) and the cron pass `ceo-extensions-sync/run.ts:10` that runs the same code. Header line 151 changes to match. | (all) |

`cockpit-media-api/whatsapp.ts:31` calls GoHighLevel, not ClickUp: no change.

### 2.3 Background writers already retry: confirmed, left alone

These do not pass `retry429`, so their behaviour does not change:

- clickup-writeback `log`: `queue.ts:71-80` classifies a 429 as `retry`; the
  ladder gives up only after it (`run.ts:362, 472`). `requests`:
  `requests.ts:378, 415` (a 429 on a write never landed) and `queue.ts:407`.
- cockpit-tasks delta and seats: a failed read keeps the cursor
  (`delta.ts:115-121`); a failed thread steps back (`delta.ts:17-20`);
  seats steps are each in their own try (`seats.ts:95-120`).
- comment-watch: GETs retried after 5 s and 15 s on 429 or 5xx
  (`watch.ts:222-240`); a write is `retry` for the next run (`watch.ts:251`).
- onboarding-sync: retried on 429 or 5xx while time allows (`sync.ts:70-95`).
- billing-sync: reads retried twice (`billing-sync/index.ts:141-150`).
- cockpit-notices: an unread Kickoff comment is `unread` and checked again
  (`cockpit-notices/send.ts:150-170`).
- creative drain (`cockpit-creative-api/outbox.ts:60`): a refusal is pressed
  again up to 3 times, 2 minutes apart (`RUNBOOK.md:618`).
- tracking-audit: daily; its ticket goes through the writeback queue.

### 2.4 Tests (budget)

- `supabase/functions/_shared/clickupRetry.test.ts` (new): Retry-After 2 →
  2,000; Reset epoch now+3 s → 3,000; Reset 30 s away → 5,000; Reset 0.2 s
  away → 1,000; no header → 1,000; garbage → 1,000.
- `supabase/functions/cockpit-media-api/tools.test.ts` (new) and
  `supabase/functions/cockpit-csm-api/tools.test.ts` (new): with
  `retry429`, 429 then 200 returns the body, sleeps once with the header's
  wait, sends the same POST body twice and writes intent/response/intent/
  response with statuses 429 then 200; 429 twice throws a message holding
  `(429)` and `CLICKUP_BUSY` after exactly two calls; 500 is not retried;
  without the option a 429 throws today's exact sentence after one call;
  (media) a Meta or Slack 429 is never retried.
- `supabase/functions/cockpit-ceo-api/tools.test.ts`: the same three cases
  for `clickupRequest` (always on).
- `supabase/functions/cockpit-tasks/` (in `detail.test.ts` or a new
  `pacing.test.ts`): an interactive reader makes two GETs with no sleep and
  retries a 429; delta and seats readers stay paced at 30 (2,000 ms gap) and
  do not retry; `callsPerMinute` default 30, `"120"` → 60, `"x"` → 30.
- `supabase/functions/clickup-writeback/run.test.ts`: `writebackPerMinute`
  defaults 25 and 30, clamp 60, junk → default; a requests run at 25 a minute
  with six queued 18-call items stops taking items after 100 s and makes its
  last call before 150 s (fake clock). Review: three runs started together
  over one queue, each with its own pacer, make at most 25 calls in any 60 s
  and the two that found the first open hand their rows back with 0
  attempts; an open run 2 minutes old holds the next run, one 5 minutes old
  does not; `openRunMinutes` reads the Kuwait clock; every row the budget
  holds back has `triesOf() === 0` and its next 429 waits `RETRY_MINUTES[0]`;
  without the release, `progress.held` keeps it at 0.
- `supabase/functions/cockpit-csm-api/tools.test.ts` and
  `cockpit-media-api/tools.test.ts` (review): a double 429 on the press's
  first write says `CLICKUP_BUSY` only; after a write that went through (a
  Meta write, for media) it adds `CLICKUP_BUSY_LANDED`; reads never count;
  `executeCsm` with the field landed and the comment refused twice never says
  "nothing was changed".
- `delta.test.ts` keeps reading the constants; add: `DELTA_PAGES +
  COMMENT_TASKS + REPLY_READS <= 40`.
- comment-watch and onboarding-sync: the gap is 2,000 ms; 28 cards plus two
  list pages fit `SCAN_BUDGET_MS`. Review: 28 cards with 15 rules to write
  read all 28 (3 or 4 rules written, the rest wait); 50 cards: the first run
  names the cards it left and the second reads them first, every card read
  in two runs; a failed save keeps the place; the store reads the place from
  the newest finished run that kept one.

---

## 3. Visibility

### 3.1 Guardian check `clickup-rate-budget` (builder: db-guardian)

New module `hermes/cockpit-guardian/checks/clickup_budget.py`, registered in
`hermes/cockpit-guardian/checks/__init__.py` `MODULES` (after `syncs`).

- Reads, through `ctx.rows`, the last 60 minutes of ClickUp calls:
  `cockpit_media_provider_health` (`created_at,native_run_id,http_status`),
  `cockpit_csm_provider_health` (`created_at,http_status`),
  `cockpit_ceo_provider_health` (`created_at,refresh_id,run_id,http_status`)
  with `provider eq clickup`, `phase in (response, unknown)`,
  `created_at gte now-60min`; and `cockpit_board_provider_health` (all
  ClickUp, no provider column) with the same phase and time filters. Order
  by `created_at`, limit 5,000. About 350 rows an hour today.
- Counts calls per clock minute across the four, and the split of the
  busiest minute: native cycle (media rows with `native_run_id`), cockpit
  jobs (other media rows), CSM ledger, CEO ledger, board levers.
- Check fields: id `clickup-rate-budget`, area `providers`, name "ClickUp
  calls a minute", means "The cockpit's ClickUp calls stay under ClickUp
  Business's 100 a minute for the one token they share with the VPS
  workers.", severity `medium`, owner `the systems manager`, confirm 2,
  clear 2, reads (the line above), threshold "Any minute in the last hour
  over 80: warn; over 95: fail. Any 429 in the hour: warn; 10 or more:
  fail.", action "Read the busiest minute's split in the evidence. A cockpit
  job: lower its pacing secret (CLICKUP_REQUESTS_CALLS_PER_MINUTE,
  CLICKUP_CALLS_PER_MINUTE, CLICKUP_TASKS_CALLS_PER_MINUTE). The native
  cycle: ask Hermes to pace it. Plan: docs/requests/CLICKUP-DOWNGRADE.md."
- Readings, word for word (`{time}` from `guard.model.kuwait`, `{split}`
  only the non-zero parts, for example "native cycle 47, cockpit jobs 3"):
  - ok: "Busiest minute in the last hour: {n} ClickUp calls at {time}
    ({split}). Budget 80; ClickUp allows 100. VPS workers outside these
    ledgers add more."
  - warn: "{n} ClickUp calls in one minute at {time} ({split}), over the
    budget of 80. VPS workers outside these ledgers add more, so ClickUp may
    already be refusing calls."
  - fail: "{n} ClickUp calls in one minute at {time} ({split}), at ClickUp's
    limit of 100. Requests reach ClickUp late and presses in the cockpit can
    fail."
  - 429 (warn under 10, fail at 10): "ClickUp refused {k} calls with 429 in
    the last hour. Busiest minute: {n} at {time} ({split})."
  - unknown, no row at all: "No ClickUp call is recorded in the last hour,
    though the task mirror reads ClickUp every 2 minutes. The ledgers may
    have stopped; this is not zero."
  - a ledger that returns 1,000 rows (PostgREST's page cap) or more: the
    reading adds "At least: one ledger hit its 1,000-row page." and
    `evidence.truncated = true`.
- Evidence: `peak`, `peak_at`, `split`, `minutes_over_80`, `http_429`,
  `rows` per ledger, `truncated`, and
  `native_counted_across_run` and `native_runs` (run, calls, from, to,
  whether the window was read from `cockpit_native_media_runs` or assumed as
  the 15 minutes up to its receipts). The native cycle's receipts carry only
  the minute it published, so each run's calls are counted in every minute
  of its run, an upper bound; a peak minute with a native run in it reads
  "up to" and says so. If the runs table cannot be read, a reading under
  budget is unknown, never ok.
- Test `hermes/cockpit-guardian/tests/test_clickup_budget.py` (FakeDb, as
  `tests/test_checks_data.py`): ok at 49; warn at 81; fail at 96; 429 counts
  1 and 10; no rows → unknown; rows older than 60 minutes and `intent` rows
  ignored; the split names the native cycle; a 1,000-row ledger marks
  `truncated`; the board ledger counts.
- `hermes/cockpit-guardian/README.md`: a "Runbook rows" row (as in the
  RUNBOOK row of 3.3) and its line in "Every check".
  `hermes/cockpit-guardian/checks/sections.py:23`: the comment's `5 3-18`
  becomes `23 3-18 (20261029q)`.

### 3.2 The cockpit-tasks doctor already reports the live limit

Yes. `cockpit-tasks/doctor.ts:27-35` makes one `GET user` through
`ClickUpReader`, which keeps `X-RateLimit-Limit` (`cockpit-tasks/clickup.ts:
66-75`), and its note says "ClickUp answers (N calls a minute allowed)"
(`doctor.ts:57-58`). It writes no state row (`doctor.ts:1-6`), so the number
is seen only when someone runs it. Today it should say 1000; after the switch
it must say **100**. Section 1.4 adds the pace to the note.

### 3.3 RUNBOOK row (db-guardian)

`RUNBOOK.md`, table "What to do, by system", after line 38:

| System | Symptom | Fix | Who |
| --- | --- | --- | --- |
| ClickUp | `HTTP 429`, or the guardian's "ClickUp calls a minute" warns (a minute over 80) or fails (over 95) | Since the move to ClickUp Business, one token shared by the Supabase functions and the VPS workers may make 100 calls a minute. Read the busiest minute's split in the guardian's evidence. A cockpit job: lower its pacing secret (`CLICKUP_REQUESTS_CALLS_PER_MINUTE` 25, `CLICKUP_CALLS_PER_MINUTE` 30, `CLICKUP_TASKS_CALLS_PER_MINUTE` 30; 60 at most). The native cycle: ask Hermes to pace it. A press in the cockpit tries once more after ClickUp's wait; if ClickUp refuses again it says ClickUp refused that step, and when an earlier step of the same press went through it says to check what that changed before trying again. Background jobs retry by themselves. Plan: `docs/requests/CLICKUP-DOWNGRADE.md` | the systems manager |

And `RUNBOOK.md:1038`: "Pace: `CLICKUP_REQUESTS_CALLS_PER_MINUTE` (120)" →
"(25; ClickUp Business allows 100 a minute for the shared token)".

---

## 4. The request form without the ClickUp form

### 4.1 Every place the form is shown, and what each case really means

Live writer mode: `apply` (cockpit_sync_state `clickup-writeback:requests`,
2026-10-29 17:13 Kuwait). Old form tickets left to import: 0.

**Server: `cockpit_request_send_gate`** (`supabase/migrations/
20261026r_requests.sql:1180-1225`, live prosrc md5
`945810c7e12cda1635830359a3793d7e`, the same as the file; grant
`{postgres=X/postgres}`, called only from other database functions). Five
branches refuse a seat that is not an editor, an admin or the CEO and send
it to the ClickUp form:

| Line | Mode | What it really means | Reachable today |
| --- | --- | --- | --- |
| 1193 | `apply_limited` (the canary test), any card | The writer sends only the test card; a plain seat may not even save. | No (mode is apply) |
| 1206 | `dry_run` | Writes to ClickUp are switched off on purpose; a plain seat may not save. | No |
| 1216 | `unknown`, last report `apply` | **The writer has not reported for 15 minutes** (`cockpit_clickup_requests_mode`, `20261026r:1131-1150`): the function, its cron kick or ClickUp is down. A plain seat is refused; editors already get a held request. | **Yes**, whenever the writer goes quiet |
| 1220 | `unknown`, last report `apply_limited` | The same, during the test. | No |
| 1223 | `unknown`, no report or last `dry_run` | Requests were never opened. | No |

`cockpit_request_can_route` (`20261026r:1458`) and
`cockpit_request_writer_view` (`20261026r:1239-1242`, `canSend`) read the
same gate.

**UI** (`requestsCore.ts`, `RequestForm.tsx` and `requests.css` are the same
in the five apps, `scripts/check-shared.sh:263-307`; `RequestPanel.tsx` is the
portal's only, `apps/media-buyer-cockpit/src/pages/requests/`):

| Where | Shown when | Really means |
| --- | --- | --- |
| `requestsCore.ts:361-363` `CLICKUP_FORM_URL` (5 apps) | the target of every link below | form 2kzmr1ky-1178 |
| `RequestForm.tsx:3360-3378` with `lostBlocked` (`requestsCore.ts:425-433`) | a required dropdown of the picked type has no option (`lostChoices`, `RequestForm.tsx:1201-1205`) | the field's catalog row is not `ok` (`cockpit_request_field_options`, `20261026r:842-844`). The catalog is refreshed by the hourly seats read at :11 (`cockpit-tasks/seats.ts:103-118`); a failed read changes nothing, so only a real change in ClickUp (a field or its choices removed or renamed) causes this. It does not come back "in a minute". |
| `RequestForm.tsx:3421-3450` `WriterOff`, default words at `:3432-3433`, link when the note names the form (`:3439`) | `writer.canSend` is false (`RequestForm.tsx:910`) | one of the five gate branches; the default words only when the database gave no note |
| `offAsked`, `offKept` (`requestsCore.ts:519-528`), under `WriterOff` once a type is picked (`RequestForm.tsx:982-1006`) | the same | the same |
| `RequestForm.tsx:3697-3712`, the sent panel's next step | `model.next` (`requestsCore.ts:3204-3210`): tasks refused and nothing moving | `sentFailed` (`:486-487`, nothing reached ClickUp) or `partialNext` (`:896-918`, some did) |
| `RequestPanel.tsx:574-646` `NextStep`, link `:633-644` | a failed, deleted or partly sent request | `againFailed` (`:470-472`), `againDeleted` (`:477-478`), `partialNext` |
| `missingFunction` (`requestsCore.ts:455-456`), thrown by `requestsClient.ts:111` | the requests RPCs are missing (a database without 20261026r) | a deploy fault |
| `creativeLinks.ts:92-94`, shown on `KeyLinksPage.tsx:23` and in `CommandPalette.tsx:154-166` | always | "Client ticketing form" |
| `apps/media-buyer-cockpit/src/lib/csmLinks.ts:49-51`; `LINKS.ticketingForm` in `apps/media-buyer-cockpit/src/lib/csmTemplates.ts:41-42` and `apps/client-success-cockpit/src/lib/csmTemplates.ts:46-47` | never (not imported, never read) | dead copies |

Not changed (they describe old tickets, not the way out):
`importedElsewhere`, `importHandled`, `sentAlone`, `oldHandledNext`, the
"old ClickUp form" lines of `RequestsPage.tsx:64, 210-215`,
`cockpit_request_cancel` and `cockpit_request_submit`.

### 4.2 The replacement: every seat may save, and the request is held

The held path exists and is tested for editors: queue rows stay `queued`,
the writer claims nothing it would not send, and a held request goes to
ClickUp by itself once the writer takes its card
(`20261026r:1168-1179` comment, `cockpit_request_held` `:1330-1338`). The
change is to let **every seat** take it. The gate keeps its shape
`{allowed, held, note}`; `allowed` is now always true.

Migration `supabase/migrations/20261029p_requests_held_for_every_seat.sql`
(builder db-guardian) replaces only `cockpit_request_send_gate(jsonb, text)`:

- Guard first, as `20261028a_request_types_read_routes.sql:69-78`: refuse
  and change nothing unless the live prosrc md5 is
  `945810c7e12cda1635830359a3793d7e` or this file's own body's md5 (written
  into the header and the guard once the body is final).
- Then `CREATE OR REPLACE` with the same signature, `STABLE SECURITY DEFINER
  SET search_path = ''`, and `REVOKE ALL ON FUNCTION
  public.cockpit_request_send_gate(jsonb, text) FROM PUBLIC, anon,
  authenticated, service_role;` with no grant, exactly as live
  (`20261026r:3004, 3017`).
- New behaviour:

| Mode | Seat | Answer | Note, word for word |
| --- | --- | --- | --- |
| `apply` | any | sends | null |
| `apply_limited`, card in `onlyCards` | any | sends | null |
| `apply_limited`, another card or none | any | held | "Requests are being tested on the internal test card only, where they go to ClickUp at once. Anything else you send is saved and goes to ClickUp by itself once they open to everyone." |
| `dry_run` | any | held | "Requests are not open yet. What you send is saved and goes to ClickUp by itself once they are." |
| `unknown` | editor, admin or CEO | held | "The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself once it runs with requests open. Check it on the Machine tab." |
| `unknown`, last report `apply` | anyone else | held | "The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself when the writer is back." |
| `unknown`, last report `apply_limited` | anyone else | held | on a canary card (the writer is silent for it, `cockpit_request_writer_silent`), the quiet-writer note "…when the writer is back."; on another card or none, the `apply_limited` note above |
| `unknown`, no report or last `dry_run` | anyone else | held | the `dry_run` note above |

No note mentions a form. `cockpit_request_row`'s held notes
(`20261026r:1481-1486`) are already true for every seat and are not
touched: "Saved, not sent yet: the requests writer has not reported in the
last 15 minutes. It goes to ClickUp once the writer runs again." and "Saved,
not sent yet. It goes to ClickUp once requests open."

**Every guarantee the writer gives stays:**

- *No lost request.* A held request is committed rows in `cockpit_requests`,
  its parts and its queue rows (`queued`, `attempts` 0); the writer claims
  them when it runs and takes the card (`cockpit_request_writer_takes`).
  Nothing in the queue, the claim or the writer changes.
- *No duplicate task.* A held part was never tried (`cockpit_request_held`
  requires `queued` and `attempts = 0`), so no create is in doubt; the
  writer still reads back by its Cockpit ref before any create
  (`clickup-writeback/requests.ts:655-697`); the same answers sent twice are
  caught as `duplicate` (`20261026r:2006-2010`).
- *Audit.* Submit writes its audit row as today (`cockpit_request_audit`);
  the migration replaces a read-only function and adds no write.
- *Alerting.* A quiet writer already fails the guardian's `native-jobs`
  check after 10 minutes (`hermes/cockpit-guardian/checks/sections.py:122`),
  before the gate calls it quiet at 15.

**How the held state reaches the person** (all of it exists):

1. Before Send: the gate note at the top and on the route
   (`RequestForm.tsx:913-916, 941-946`), the button reads "Save request" and
   the hint "Saved here until requests open" or "until the writer runs with
   requests open" (`RequestForm.tsx:3394-3405`, `requestsCore.ts:2782-2783`).
2. After Save: the sent panel says "Saved" with "Saved. Goes to {list} once
   the writer runs with requests open." and "It goes to ClickUp by itself
   once the requests writer runs with requests open."
   (`requestsCore.ts:2770-2781, 3135`).
3. The requester's list, My requests: `cockpit_request_row` sends `held` and
   `heldNote` (`20261026r:1480-1486`) to the row and the panel.
4. When the writer is back it sends the request; the row moves to sending,
   then delivered, with no action from anyone.

### 4.3 The UI copy, word for word (builder: requests-ui)

In `requestsCore.ts` (all five, identical):

| Key | New text |
| --- | --- |
| `CLICKUP_FORM_URL` | **removed** (and its imports in `RequestForm.tsx:80`, `RequestPanel.tsx:8`) |
| `lostBlocked(question, lists, each)` | `` `ClickUp's choices for "${question}" could not be read, so this request cannot be sent from here yet. Tell the systems manager; the cockpit reads ClickUp again at 11 minutes past each hour. If it cannot wait, make the task on the ${list} list in ClickUp.` `` (`lists` from `handLists(type)`: the lists in the type's parts, else its team's list. One list: as shown. Lists chosen by an answer: "make it on the A or B list in ClickUp, or on both, as the request needs" (three or more: "or on more than one"). Every part always runs (`each`): "make a task on each of the A and B lists in ClickUp".) |
| `missingFunction` | "Requests cannot be read: the database does not have them yet. Tell the systems manager." |
| `againFailed` | "Nothing reached ClickUp. File it again with the same answers." (the panel still adds "If it fails again, tell the systems manager.") |
| `againDeleted` | "The task was deleted in ClickUp. File it again with the same answers if the work is still needed." |
| `sentFailed` | "Open the request to file it again with the same answers." |
| `offAsked` | "Requests cannot be sent from this seat just now, so the cockpit asks you nothing here. The questions open here as soon as they can be sent." |
| `offKept` | "Your answers stay on this screen until requests can be sent from this seat." |
| `partialNext` | `` `${what}; ${kept}. Ask the systems manager to make the missing ${many ? "tasks" : "task"}. Filing the whole request again would make ${landed === 1 ? "the one that arrived" : "the ones that arrived"} twice.` `` |

In `RequestForm.tsx` (all five, identical):

- `:3360-3378` (lost choice): the sentence above; the ClickUp form link
  becomes an outline link "Open the {list} list in ClickUp" to
  `https://app.clickup.com/90182518398/v/li/{listId}` (`TARGET_LISTS` by the
  type's team, `requestsCore.ts:394-400`), new tab, the same `rq-btn
  rq-btn-outline rq-off-action` classes, `NewTab` and `ArrowUpRight`. No team
  list found: no link. Send stays as today (outline, `aria-describedby`).
- `:3421-3450` `WriterOff`: default words "Requests cannot be sent from this
  seat just now. Tell the systems manager."; the regex and the link go.
- `:3697-3712`: the sent panel keeps the next-step sentence; the link goes.
- `:928-934` comment: no ClickUp form.

`RequestPanel.tsx:574-646`: the link goes; "File it again" stays; the
comment at `:574-581` drops the form.

`creativeLinks.ts:9-11, 83-97`: the group becomes title "The two places you
file work", blurb "If it is not filed, it did not happen."; the second row
becomes label **"Ask a team"**, url `` `${portalUrl()}/requests` ``
(`@/lib/portal`, `https://cockpit.maharamedia.com/requests` in production,
the sidebar's own target at `AppSidebar.tsx:175`), note "Anything a client
needs from tech, ads, client success, the call center or media. One request
each; the cockpit files it in ClickUp for you." The header comment drops
"the ClickUp client ticketing form". `KeyLinksPage.tsx` and
`CommandPalette.tsx:154-166` show it with no change (they render every row
with a url); the builder confirms.

Dead copies go: the row at `media-buyer csmLinks.ts:49-51` and the
`ticketingForm` keys in both `csmTemplates.ts`. After the change
`grep -rn "2kzmr1ky-1178\|CLICKUP_FORM_URL\|ClickUp request form" apps/*/src`
finds nothing.

Design: no new screen and no reshaped one, so no new design plan; only the
cockpit's existing classes (`rq-off`, `rq-btn-outline`, `rq-link`) and
tokens. `requests.css` changes only if the outline link needs spacing.

`docs/requests/CONTRACT.md` (requests-ui): the gate table at `:676-688`
becomes the table in 4.2; the copy table rows at `:1688-1690` and `:1701`
and the text at `:1494` and `:1541-1545` take the new words; pacing lines
`:1075-1076` (requests: 25, and "ClickUp Business allows 100 a minute for
the shared token") and `:1241` (task mirror: 30); decision row X6 at `:2466`
gets "(2026-10-29: 25, for ClickUp Business; docs/requests/
CLICKUP-DOWNGRADE.md)".

### 4.4 Tests (requests-ui and db-guardian)

requests-ui:
- `apps/media-buyer-cockpit/scripts/request-form.test.tsx` (`:639-646,
  :799-818, :867, :1258, :1394-1410, :1884-1892`),
  `requests-page.test.tsx` (`:584, :630-634, :861-866, :964`),
  `requests-core.test.ts` (`:761-783`): the new words; no link to
  `forms.clickup.com` in any rendered state; the lost-choice block shows
  "Open the Marketing / ADs list in ClickUp" for Create an ad account; a
  plain seat with `canSend: true, held: true` sees "Save request".
- `apps/creative-director-cockpit/scripts/key-links.test.ts` (new): no
  `LINK_GROUPS` url contains `2kzmr1ky-1178`; one row is "Ask a team" with
  url `${portalUrl()}/requests`; the palette's link list (built from
  `LINK_GROUPS`) includes it.

db-guardian:
- `apps/media-buyer-cockpit/scripts/request-held-gate-supabase.test.ts`
  (new, PGlite, set up as `request-routes-supabase.test.ts`: 20261026r, its
  seed 20261026s, then 20261029p twice): for every mode and lastMode, a
  plain seat and an editor, `allowed` true, `held` and the note exactly as
  4.2, and no note contains "ClickUp request form"; a plain seat submits in
  `dry_run` and in `unknown`/lastMode `apply`: the request is `sending`,
  every part `queued`, every queue row `queued` with 0 attempts,
  `cockpit_request_held` true, its row carries `held` and the right
  `heldNote`; the writer's claim takes nothing while not apply and takes it
  exactly once after the state says apply; the same answers again give
  `duplicate`; `proacl` stays `{postgres=X/postgres}` and anon,
  authenticated and service_role cannot execute; a body that is neither the
  old one nor this file's makes the file raise and change nothing.
- `apps/media-buyer-cockpit/scripts/clickup-cron-spread-supabase.test.ts`
  (new, PGlite with a stub `cron.job` and `cron.alter_job`): the two
  schedules move, commands untouched; a second run changes nothing; another
  schedule refuses and changes nothing; no `cron` schema is a notice.

---

## 5. File ownership by builder

Each file has exactly one owner. A builder edits only its own files.

| Builder | Files |
| --- | --- |
| **budget** | `supabase/functions/_shared/clickupRetry.ts` (new), `supabase/functions/_shared/clickupRetry.test.ts` (new); `supabase/functions/cockpit-media-api/tools.ts`, `cockpit-media-api/tools.test.ts` (new), `cockpit-media-api/index.ts`; `supabase/functions/cockpit-csm-api/tools.ts`, `cockpit-csm-api/tools.test.ts` (new), `cockpit-csm-api/index.ts`, `portalTasks.ts`, `onboarding.ts`, `projections.ts`, `checkins.ts`; `supabase/functions/cockpit-board-api/lever.ts`; `supabase/functions/cockpit-creative-api/index.ts`, `build.ts`, `blueprint.ts`; `supabase/functions/cockpit-ceo-api/tools.ts`, `cockpit-ceo-api/tools.test.ts`; `supabase/functions/clickup-writeback/index.ts`, `run.ts`, `run.test.ts`; `supabase/functions/cockpit-tasks/clickup.ts`, `delta.ts`, `delta.test.ts`, `detail.ts`, `doctor.ts`, `detail.test.ts` (or a new `pacing.test.ts`), `README.md`; `supabase/functions/comment-watch/watch.ts`, `watch.test.ts`; `supabase/functions/onboarding-sync/sync.ts`, `sync.test.ts` |
| **requests-ui** | `apps/{media-buyer,client-success,creative-director,sales,video-editor}-cockpit/src/lib/requestsCore.ts`; the same five `src/components/tasks/RequestForm.tsx`; the same five `src/components/tasks/requests.css` (only if needed, all five alike); `apps/media-buyer-cockpit/src/pages/requests/RequestPanel.tsx`; `apps/creative-director-cockpit/src/lib/creativeLinks.ts`, `src/pages/KeyLinksPage.tsx`, `src/components/CommandPalette.tsx` (only if needed); `apps/media-buyer-cockpit/src/lib/csmLinks.ts`, `apps/media-buyer-cockpit/src/lib/csmTemplates.ts`, `apps/client-success-cockpit/src/lib/csmTemplates.ts`; `apps/media-buyer-cockpit/scripts/request-form.test.tsx`, `requests-page.test.tsx`, `requests-core.test.ts`; `apps/creative-director-cockpit/scripts/key-links.test.ts` (new); `docs/requests/CONTRACT.md` |
| **db-guardian** | `supabase/migrations/20261029p_requests_held_for_every_seat.sql` (new), `supabase/migrations/20261029q_clickup_cron_spread.sql` (new); `apps/media-buyer-cockpit/scripts/request-held-gate-supabase.test.ts` (new), `apps/media-buyer-cockpit/scripts/clickup-cron-spread-supabase.test.ts` (new); `hermes/cockpit-guardian/checks/clickup_budget.py` (new), `checks/__init__.py`, `checks/sections.py` (comment only), `tests/test_clickup_budget.py` (new), `README.md`; `scripts/ship.sh` (test-list lines only); `RUNBOOK.md`; this file, `docs/requests/CLICKUP-DOWNGRADE.md` (its runbook, section 7, and the deploy read-back values in section 6 only) |

Migration names: `20261029a`-`20261029j` are taken in the folder and in
`supabase_migrations.schema_migrations` (sales work today). If `p` or `q`
is taken by apply time, take the next free letters, keep the send gate
first, and rename the two test references.

`scripts/ship.sh` lines (db-guardian), in the requests block (`:114-119`):
add `scripts/request-held-gate-supabase.test.ts
scripts/clickup-cron-spread-supabase.test.ts` to the media-buyer list at
`:115-116` (and its echo); add `supabase/functions/_shared/clickupRetry.test.ts
supabase/functions/cockpit-media-api/tools.test.ts
supabase/functions/cockpit-csm-api/tools.test.ts
supabase/functions/cockpit-ceo-api/tools.test.ts
supabase/functions/onboarding-sync` to the `bun test` line at `:117-118`
(and its echo); add `(cd apps/creative-director-cockpit && bun test
scripts/key-links.test.ts >/dev/null 2>&1) || { echo "the creative
director's key links tests fail (cd apps/creative-director-cockpit && bun
test scripts/key-links.test.ts)"; exit 1; }`; and `(cd
hermes/cockpit-guardian && "$py_bin" -m unittest tests.test_clickup_budget
>/dev/null 2>&1) || { echo "the guardian's ClickUp budget check tests fail
(cd hermes/cockpit-guardian && python3 -m unittest
tests.test_clickup_budget)"; exit 1; }`.

---

## 6. Tests each builder runs, and the deploy

All from the worktree root (`.claude/worktrees/clickup-diet-1029` in the mahara-cockpits checkout).
Run each builder's list once **before** editing to record the baseline;
every test that passed before passes after. No vite build, no deploy, no
ClickUp call.

**budget**

```bash
bun test supabase/functions/_shared/clickupRetry.test.ts supabase/functions/clickup-writeback supabase/functions/cockpit-tasks supabase/functions/comment-watch/watch.test.ts supabase/functions/onboarding-sync supabase/functions/cockpit-media-api supabase/functions/cockpit-csm-api supabase/functions/cockpit-ceo-api supabase/functions/ceo-extensions-sync supabase/functions/cockpit-board-api supabase/functions/cockpit-creative-api supabase/functions/billing-sync supabase/functions/cockpit-notices supabase/functions/tracking-audit
grep -rn "allows 1,000\|Math.min(1000" supabase/functions --include='*.ts' | grep -v '\.test\.'   # nothing
```

**requests-ui**

```bash
scripts/check-shared.sh
(cd apps/media-buyer-cockpit && bun test scripts/requests-core.test.ts scripts/request-form.test.tsx scripts/requests-page.test.tsx scripts/your-tasks.test.tsx scripts/tasks-core.test.ts scripts/requests-settings.test.tsx)
(cd apps/creative-director-cockpit && bun test scripts/key-links.test.ts scripts/blueprint.test.tsx)
for a in media-buyer client-success creative-director sales video-editor; do (cd apps/$a-cockpit && bunx biome check --line-ending=auto src >/dev/null && bun run tsc --project tsconfig.app.json --noEmit) || echo "FAILED $a"; done
grep -rn "2kzmr1ky-1178\|CLICKUP_FORM_URL\|ClickUp request form" apps/*/src   # nothing
```

**db-guardian**

```bash
(cd apps/media-buyer-cockpit && bun test scripts/request-held-gate-supabase.test.ts scripts/clickup-cron-spread-supabase.test.ts scripts/requests-supabase.test.ts scripts/request-routes-supabase.test.ts scripts/requests-fit-supabase.test.ts)
(cd hermes/cockpit-guardian && ~/.cache/mahara-ship/pybin/python -m unittest tests.test_clickup_budget && ~/.cache/mahara-ship/pybin/python -m unittest)
(cd hermes/cockpit-guardian && ~/.cache/mahara-ship/pybin/python guardian.py checks --json | grep -c clickup-rate-budget)   # 1
bash -n scripts/ship.sh
```

### Deploy (the main session; in this order)

Python: `~/.cache/mahara-ship/pybin/python`. Every read-back is a
read-only select unless it says otherwise.

0. Merge to `main` (ship.sh refuses a commit main does not have) and note
   the merge sha.
1. **Pre-reads.** `select md5(prosrc) from pg_proc where oid =
   'public.cockpit_request_send_gate(jsonb,text)'::regprocedure` →
   `945810c7e12cda1635830359a3793d7e`. `select jobid, schedule, md5(command)
   from cron.job where jobname in ('mahara-comment-watch',
   'mahara-clickup-writeback-kpi')` → 464 `7-59/15 * * * *` `49e2a527…`, 459
   `5 3-18 * * *` `39c110fd…`. `select name from
   supabase_migrations.schema_migrations where name like '20261029%'` → `p`
   and `q` still free (read 2026-10-29: `a`-`j`, `l`, `m` and
   `20261029170000_client_asks` are applied; `t` is a forms worktree's file).
2. **Dry runs:** `scripts/dev/apply_migration.py
   supabase/migrations/20261029p_requests_held_for_every_seat.sql --dry`,
   then the same for `20261029q_clickup_cron_spread.sql` (or the migration
   route the ship notes use).
3. **Apply `p`.** Read back: the new prosrc md5 equals the file header's
   (`f3f83c347523ec15a73c436d2256f337`);
   `proacl` = `{postgres=X/postgres}`; `select
   public.cockpit_request_send_gate('{}'::jsonb, null)` →
   `{"allowed": true, "held": false, "note": null}` (mode apply); the
   migration name is in `schema_migrations`.
   **Apply `q`.** It prints one notice per job moved (none on a second run).
   Read back: schedules `13,29,43,59 * * * *` and
   `23 3-18 * * *`, both command md5s unchanged (`49e2a527…`, `39c110fd…`); the next
   `cockpit_comment_watch_runs` row starts at :13/:29/:43/:59 and the next
   kpi row in `cockpit_clickup_writeback_runs` at :23.
4. **Secrets** (project Edge Function secrets, names only in any output):
   `CLICKUP_REQUESTS_CALLS_PER_MINUTE=25`, `CLICKUP_CALLS_PER_MINUTE=30`,
   `CLICKUP_TASKS_CALLS_PER_MINUTE=30`. Read back by name.
5. **Functions.** For each slug: `scripts/dev/deploy_composio.py <slug>
   --rev <merge sha> --extra $(scripts/dev/fn_extras.py . <slug>)
   --verify-jwt <its live value>` (run `--dry` first; it prints the live
   version and verify_jwt). Slugs: `clickup-writeback`, `cockpit-tasks`,
   `comment-watch`, `onboarding-sync` (all off), `cockpit-media-api`,
   `cockpit-csm-api`, `cockpit-board-api`, `cockpit-creative-api`,
   `cockpit-ceo-api` (on), `ceo-extensions-sync` (off). Functions that only
   import the changed helpers without opting in (billing-sync,
   cockpit-notices, tracking-audit) keep their bundles; their behaviour does
   not change.
   Read back: each version went up; the next runs are ok in
   `cockpit_sync_state` (`clickup-writeback:requests`, `:log`, `:kpi`,
   `task-mirror:delta`, `task-mirror:seats`, `comment-watch`,
   `onboarding-sync`, `ceo-extensions-auto`); the cockpit-tasks doctor
   (`net.http_post` to `functions/v1/cockpit-tasks` with body
   `{"job":"doctor"}` and the vault's `cockpit_tasks_cron_secret`, as
   `RUNBOOK.md:1058-1063` does for the requests doctor) says "(1000 calls a
   minute allowed; the task mirror reads at 30 a minute)".
6. **Guardian to the VPS.** The VPS copy is stale with local edits: never
   pull (`hermes/cockpit-guardian/README.md:270-276`). First compare the VPS
   `checks/__init__.py` with origin/main's (`ssh … cat` and `diff`). Back it
   up, then `scp` `checks/clickup_budget.py`, `checks/__init__.py`,
   `checks/sections.py` and `README.md` to
   `~/mahara-cockpits/hermes/cockpit-guardian/`. On the VPS, with the env
   files loaded as the README says: `python3 guardian.py doctor`, then
   `python3 guardian.py --dry-run --state-dir /tmp/guardian-try --only
   clickup-rate-budget scan`: an ok reading naming the busiest minute.
7. **The five app ships**, media-buyer first (it serves `/requests`):
   `scripts/ship.sh media-buyer`, `client-success`, `creative`,
   `video-editor`, `sales`. Read back on each site: the served bundle has no
   `2kzmr1ky-1178` and has "could not be read, so this request cannot be
   sent from here yet"; the creative director's Key links and Ctrl-K show
   "Ask a team" opening `cockpit.maharamedia.com/requests`.
8. **Ledger read-back after a day:**

```sql
-- Each native run's calls in every minute of its run: its receipts carry only
-- the publish time (as the guardian's clickup-rate-budget counts them).
with calls as (
  select created_at, native_run_id from cockpit_media_provider_health where provider = 'clickup' and phase in ('response','unknown') and created_at > now() - interval '24 hours'
  union all select created_at, null from cockpit_csm_provider_health where provider = 'clickup' and phase in ('response','unknown') and created_at > now() - interval '24 hours'
  union all select created_at, null from cockpit_ceo_provider_health where provider = 'clickup' and phase in ('response','unknown') and created_at > now() - interval '24 hours'
  union all select created_at, null from cockpit_board_provider_health where phase in ('response','unknown') and created_at > now() - interval '24 hours'),
other as (select date_trunc('minute', created_at) m, count(*) n from calls where native_run_id is null group by 1),
native as (select g.m, count(*) n from calls c join cockpit_native_media_runs r on r.run_id = c.native_run_id
  cross join lateral generate_series(date_trunc('minute', r.created_at), date_trunc('minute', r.published_at), interval '1 minute') g(m) group by 1)
select coalesce(o.m, n.m) at time zone 'Asia/Kuwait' as kuwait, coalesce(o.n, 0) + coalesce(n.n, 0) as up_to
  from other o full join native n on n.m = o.m order by 2 desc limit 5;
```

   Expect the busiest minute up to about 65 (a native run of 48 plus the
   requests writer, task mirror, log, creative drain and onboarding inside
   it) and none over 80. Read on 2026-10-29, before the moves: 98 (29 Oct
   06:05, the KPI inside the 06:00 run) and 79 (the comment watch at :07).
9. Record the session in mahara-context `shared/sessions/`.

---

## 7. The CEO's downgrade runbook

Plain steps. Only you can do 1 to 5 and 7.

**Before you start.** Wait until we say the cockpit side is live (sections
1-6) and the guardian's "ClickUp calls a minute" has read under 80 for three
days. The cockpit works the same on Business Plus meanwhile. From then on,
when a request cannot go to ClickUp at once (the requests writer has not
reported for 15 minutes, or requests are not open), every seat's request is
saved and goes to ClickUp by itself later; nobody is sent to a ClickUp form.

1. **Billing** (ClickUp, Settings, Billing). Confirm the plan is Business
   Plus (the API answered "Business Plus", plan 20), the renewal date and
   the 7 paid seats. Open the change-plan screen and note **which Business
   plan you are offered and its price**. The public page lists the new
   Business at $17 a user a month billed yearly ($25 monthly); older
   Business prices are not on any official page. If the saving is only $2-4
   a user a month, decide whether it is worth dropping from 1,000 to 100
   calls a minute.
2. **Your 15 ClickUp forms.** On Business, forms lose conditional logic,
   hidden fields, the redirect after submitting, the resubmit button,
   reCAPTCHA and copying answers into the description. The API cannot show
   any of this, so open each one in the form editor and note what it uses.
   Check the first four first.

   | Form | Name | Where | Note |
   | --- | --- | --- | --- |
   | 2kzmr1ky-6778 | Report WhatsApp Disconnection | WhatsApp Reconnection | in use (last 28 Oct); Make 9799073 takes only this form |
   | 2kzmr1ky-1218 | Payment Failure | Marketing / ADs | the media buyer's "card declined" button opens it; Make 8866601 |
   | 2kzmr1ky-1058 | Video Request Form | Video Pipeline | 14 submissions in 60 days; linked in the creative director cockpit |
   | 2kzmr1ky-7138 | Form | Client Portal Tasks | embedded in the client success cockpit |
   | 2kzmr1ky-1178 | Submit a New Request! | All Assignments | the old ticket form, 25 rules; "Ask a team" replaces it |
   | 2kzmr1ky-3878 | Launch New Campaign | Ads Managment | linked from the media buyer's feed text |
   | 2kzmr1ky-7638 | Form | Review Inbox | used 26 Oct |
   | 2kzmr1ky-1078 | 🚀 | Clients - Mahara | |
   | 2kzmr1ky-2278 | Client Update Form | Clients - Mahara | |
   | 2kzmr1ky-2258 | Project Intake Form | Clients - Mahara | |
   | 2kzmr1ky-4338 | Order Form | Marketing / ADs | |
   | 2kzmr1ky-2298 | Campaign Launch From | Client Success | |
   | 2kzmr1ky-6978 | ZZ field probe | Form Migration Test | leftover test, can go |
   | 2kzmr1ky-7038 | ZZ shape 3 | Form Migration Test | leftover test, can go |
   | 2kzmr1ky-7078 | ZZ cf probe | Form Migration Test | leftover test, can go |

   If a form uses logic you need, tell us before you switch; otherwise
   accept losing it.
3. **Automation usage.** In ClickUp's Automations manager, open Usage.
   Business allows **10,000 actions a month** and cannot buy more (Business
   Plus allows 25,000). Business also shows only 1 day of history, so read
   it now while you can see 30 days.
4. **GoHighLevel.** In the Mahara sub-account, Automation, Workflows, open
   "Ticketing Forms To PM System" and make sure it is off. Nothing in the
   cockpit uses it, and its two Make scenarios (8064859, 8063994) are off.
5. **The old ticket form 1178.** After the cockpit ships, nothing in the
   cockpit links it. Two other places still do, outside the cockpit: the
   Hermes skill `mahara-client-ticketing` and the Slack #client-comms
   agent's knowledge, which it re-reads from Google Docs (also the "Client
   Journey SOP" and "Post Launch Call Steps" docs). Point those links to
   `https://cockpit.maharamedia.com/requests`, then close form 1178. Without
   its rules it would show every question to everyone. Closing it breaks
   nothing in the cockpit: it only stops new old-form tickets coming in.
6. **Already checked, no action:** no custom roles, no user groups, at most
   19 lists in a space (Business allows 400), no time entries in 90 days.
7. **Switch.** Billing, change plan, Business. It takes effect at the end of
   the billing cycle and keeps all data. If something breaks afterwards, the
   upgrade screen still offers Business Plus today; if it ever does not,
   going back up means Enterprise.

**After it takes effect** (we do 1-4, you do 5):

1. The cockpit-tasks doctor says **100 calls a minute allowed**.
2. The guardian's "ClickUp calls a minute" is ok for a full day, and no 429
   is in the four ledgers since the switch (`select count(*) from
   cockpit_media_provider_health where provider = 'clickup' and http_status =
   429 and created_at > '<switch time>'`, and the same for the CSM and CEO
   ledgers; the board ledger has no provider column, so drop that filter
   there). Failures are kept 30 days, so a 429 stays visible.
3. The requests doctor (`RUNBOOK.md:1058-1063`) says "Ready" with no
   problems, in apply mode.
4. The VPS logs show no 429 for a few days: task-assignment alerts, the
   editor desk, video review flow, review watch.
5. Send one real request from "Ask a team" and see it land on its list.
   Submit the Payment Failure and the WhatsApp Disconnection forms once
   each with a test client and check the WhatsApp message goes out through
   Make; check the Client Update hook (Make 8903351) too.

**If the limit bites afterwards.** The guardian's "ClickUp calls a minute"
warns (a minute over 80) or fails (over 95), or a 429 shows; the RUNBOOK row
"ClickUp, `HTTP 429`" says what to do. Nothing is lost meanwhile: a press in
the cockpit tries once more after ClickUp's wait and then says ClickUp
refused that step (and, when an earlier step of the press went through, to
check what it changed before trying again), and the background jobs, the
requests writer included, retry by themselves. In order:

1. We lower the pacing secret of the job the guardian's evidence names
   (`CLICKUP_REQUESTS_CALLS_PER_MINUTE`, `CLICKUP_CALLS_PER_MINUTE`,
   `CLICKUP_TASKS_CALLS_PER_MINUTE`), or ask Hermes to pace the native cycle.
2. If it still warns more than once a day, the cheapest fix is a second
   ClickUp seat whose token the VPS workers use: each token has its own 100.
   That is your call (one more paid seat).
3. Going back up: the upgrade screen still offers Business Plus today.
