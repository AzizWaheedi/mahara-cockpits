# cockpit-tasks

The task mirror behind "Your tasks", the alerts bell and the focus view in
every cockpit (`docs/requests/CONTRACT.md` sections 3 and 5; PLAN D19). It
reads ClickUp and never writes to it: a tick, comment or Mark done from the
focus view is a `cockpit_clickup_writeback_queue` row of kind `task_action`,
which `clickup-writeback` job `requests` writes and reads back.

Migration `20261026t_task_alerts.sql` holds the tables (`cockpit_task_mirror`,
`cockpit_task_alerts`, `cockpit_task_alert_rules`), the browser and service
functions, and the two kicks.

## Jobs

Deployed with the JWT check **off**. pg_cron reaches it with `x-cron-secret`
(vault `cockpit_tasks_cron_secret` = function secret `TASKS_CRON_SECRET`),
checked in constant time before the body is read.

| Body | When | What happens |
| --- | --- | --- |
| `{"job":"delta"}` | every 2 minutes (`mahara-task-mirror`) | 202 at once; in the background: the workspace's changed tasks since the cursor less 10 minutes (the cursor itself right after a truncated run), oldest change first, up to 10 pages; the comments (and up to 5 reply threads) of up to 25 changed tasks; the daily due and overdue alerts; state `task-mirror:delta` |
| `{"job":"seats"}` | hourly at :11 (`mahara-task-mirror-seats`) | 202 at once; in the background: the workspace members (links seats by exact email), the request field catalog, the template objects, every linked seat's open tasks in full (up to 5 pages each), the old ClickUp form's tickets on All Tasks; state `task-mirror:seats` |
| `{"job":"doctor"}` | by hand | the secrets by name, one `GET user` (and its rate limit), the linked seats, the last two runs |

A signed-in cockpit calls it with `Authorization: Bearer <the person's JWT>`:

| Body | What happens |
| --- | --- |
| `{"op":"detail","taskId":"...","refresh":false}` | `cockpit_task_detail` with the person's own JWT (the database decides who may open a task; 403 with its sentence otherwise); when asked to refresh, or when the cache is older than a minute, `GET task/{id}` and its comments, saved with the service key; then the person's read again |

Anything else is 400 with the sentence saying what to send. A job body without
the secret is 401, never a sign-in.

## Rules it keeps

- Every ClickUp call is a GET through `cockpit-media-api/tools.ts`, with an
  intent and a response row in `cockpit_media_provider_health` under the
  run's `action_id`. A receipt that cannot be saved stops the call.
- The delta and seats reads are paced at `CLICKUP_TASKS_CALLS_PER_MINUTE`
  (30 by default, 5 to 60 whatever it is set to) and do not retry: a failed
  read keeps the cursor or steps back. ClickUp Business allows 100 calls a
  minute for the one token the Supabase functions and the VPS workers share
  (`docs/requests/CLICKUP-DOWNGRADE.md`). A delta run reads at most 10 pages,
  25 comment threads and 5 reply threads: 40 calls, about 80 s.
- The focus view and the doctor read with an interactive reader (a person is
  waiting): not paced, and it tries once more after ClickUp's 429, after
  ClickUp's own wait of 1 to 5 s (`_shared/clickupRetry.ts`). The doctor's
  note gives ClickUp's limit and the task mirror's pace, and names a pace
  above 60% of that limit as a problem.
- No alert before the baseline: the first seats run that read every linked
  seat in full sets `baselinedAt` once. Assignment and status alerts come
  only from the delta; the seats and focus reads correct the mirror quietly,
  so linking a seat never floods its bell.
- The mirror is a cache of ClickUp: one audit row per run
  (`task_mirror.run`), never one per task. A person's writes (marking alerts
  read, a press in the focus view, alert rules) each leave their own.
- Missing is never zero: no token, no secret or a failed step is written into
  the state row's note, and the screens say "not linked", "not read" or
  "late" rather than an empty list.

## Secrets (read by name)

`CLICKUP_API_TOKEN`, `TASKS_CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, optional `CLICKUP_TASKS_CALLS_PER_MINUTE` (30
when unset; set it to 30 explicitly at deploy, so an old value cannot
override the default).

## Tests

`bun test supabase/functions/cockpit-tasks` (a fake ClickUp and a fake
database; no network) and, for the SQL,
`cd apps/media-buyer-cockpit && bun test scripts/task-alerts-supabase.test.ts`.
