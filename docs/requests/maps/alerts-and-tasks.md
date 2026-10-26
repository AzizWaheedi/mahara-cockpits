# Alerts and tasks: one task feed and one alert feed for every seat

Read-only map, 2026-10-26, worktree `forms-1025` (branch `tickets-1026`, from
main `86ee4e84`). It serves PLAN.md D19 ("every seat gets task alerts and a
simple Tasks section on Today"), with D17 (rules edited in the cockpit) and
D18 (the ticket mirror). Its sibling maps are `today-and-shell.md` (where the
bell, "Your tasks" and the focus view go; its section 6.3 lists the calls the
shell expects) and `writers.md` (how a tick, comment or "Mark done" reaches
ClickUp).

How it was read:

- **Supabase:** SELECT only, through `sq.py` (read-only flag).
- **ClickUp:** MCP read tools, plus about 160 plain `GET`s from the VPS with
  the token read by name (`CLICKUP_API_KEY` in `/opt/data/bibi/api-keys.env`,
  never printed). The probes printed counts, ids, key names and rate-limit
  headers only.
- **VPS:** `crontab -l`, `ls`, and the alert worker's SQLite ledger opened
  with `mode=ro`.
- **ClickUp docs:** WebFetch.

Nothing was created, edited, posted or sent. Staff are named by role.
ClickUp user ids by role, as in `docs/forms/maps/clickup-ticketing.md` (CT)
Follow-up:

| Role | ClickUp id |
|---|---|
| Systems manager | `113459516` |
| Creative strategist | `113520400` |
| CSM | `113688800` |
| Media buyer A | `119413219` |
| Media buyer B | `113428468` |
| CEO and API user | `284616470` |
| Video editor A | `113492660` (matched by email today) |
| Video editor B | `113691506` (matched by email today) |

## 1. What matters most

1. **The media buyer's alerts belong to one person, and every media buyer
   sees them.** The task part of `ClientAlerts.tsx` comes from one feed
   computed for ClickUp user `113428468`, media buyer B
   (`hermes/cockpit-sync/calculator.ts:34`). It reads two lists only (`:37`,
   `:2961`). It is published every 15 minutes as `cockpit_media_sources`
   `table_name='inbox'`. Every media buyer, admin and CEO seat is then shown
   the same rows; the database rewrites "assigned to you" to "Assigned to
   the media buyer"
   (`supabase/migrations/20261024125012_media_clients_workspace.sql:26-27`).
   Today the feed holds 2 rows. ClickUp holds **8** open work tasks
   assigned to media buyer B (section 6). Media buyer A has 0 in ClickUp.
2. **No table links a seat to its ClickUp user.** No column on any table,
   in any schema, holds a ClickUp user id for a person (an
   `information_schema` search). An exact email match links **8 of 13**
   active seats to the 12 ClickUp members. The 2 call centre agents, the
   closer, one video editor seat and the CEO's second sign-in have no
   ClickUp account by email. Slack ids exist for 9 of 13 seats, through
   `cockpit_people` and `cockpit_eod_radar_slack_ids` (section 4).
3. **One ClickUp call returns a seat's open tasks across the whole
   workspace:** `GET team/90182518398/task?assignees[]=<id>&subtasks=true`.
   One page (up to 100 tasks) covers every seat except the creative
   strategist, who needs 2 pages. Two traps were found live:
   - `include_closed=false` still returns **done-type statuses** such as
     "complete": 12 of the systems manager's 17 rows, and 61 of the
     creative strategist's 164.
   - The team endpoint **does not return `due_date_time`**, so a date-only
     due date cannot be told from a timed one without `GET task/{id}`.
4. **The workspace changes slowly.** A workspace-wide
   `date_updated_gt` read returned 2 tasks changed in 10 minutes and 31 in
   24 hours, one page each (16:29 Kuwait, a Monday). A 2-minute delta poll
   costs about 720 calls a day.
5. **The token's limit is 1,000 calls a minute, not 100.**
   - Every response carried `X-RateLimit-Limit: 1000`. ClickUp's docs give
     1,000 a minute per token on Business Plus, and 100 on Business and
     below.
   - The writeback code paces itself at 90 a minute on the belief that the
     limit is 100 (`supabase/functions/clickup-writeback/index.ts:78-79`).
   - The ledgers show about 7,000 ClickUp calls in the last 24 hours, with
     a peak of 80 in one minute and no 429.
6. **ClickUp has no API for a person's notifications or mentions**
   (ClickUp `llms.txt` index). A comment that tags someone can only be found
   in two ways:
   - by reading comments (`GET task/{id}/comment`, then
     `GET comment/{id}/reply` where `reply_count > 0`);
   - by a `taskCommentPosted` webhook.

   "Who changed the status" comes only from a webhook's `history_items`.
   Polling sees *that* a status changed, never *who* changed it.
7. **`hermes/task-assignment-alerts` is live and healthy, but it is not a
   per-seat feed.**
   - It posts new main-task assignments on 6 lists into 6 department
     channels: 71 accepted since 2026-10-12, 0 unknown, 0 failed.
   - Its state lives in a SQLite ledger on the VPS by design, and it
     refuses any route change without a ledger migration (`worker.py:218-220`).
   - It should keep its job. The per-seat feed should be a separate mirror
     in Supabase. The cockpit should not send a second Slack message for the
     same assignment (section 8.6).
8. **Nobody has marked a media alert read.** `cockpit_media_notice_reads`
   has 0 rows. Marking read writes no audit row: the table has no trigger
   (`pg_trigger`).

## 2. The model: the media buyer's alerts, end to end

### 2.1 The screen (`apps/media-buyer-cockpit/src/components/launch/ClientAlerts.tsx`)

| What | How | Lines |
|---|---|---|
| Where it shows | A bell button labelled "Alerts", mounted in the portal shell | `AppLayout.tsx:88` |
| Who sees it | Only on `/clients`, `/launch`, `/ads`, `/dashboard`, `/eod`, `/playbook`, `/ideation`, `/swipe`, and only for `media_buyer`, admin or CEO | `:16-21` |
| How it reads | `rpc('cockpit_media_client_notices')` at most every 30 seconds. It reads on open, every 2 minutes while the tab is visible, and on focus or visibility change | `:34-64` |
| Unread | The count of notices with `read=false` | `:73` |
| Mark read | `rpc('cockpit_media_notices_seen', {p_notices:[{id,version}]})`, up to 200, on "Mark all read" or on opening one notice | `:74-102`, `:154-164`, `:190-203` |
| Source state | "Task updates are unavailable. Check Today or ClickUp." when `tasksReady` is false; "Task source checked {time}" | `:138-153` |
| Each row | A dot (read or unread), title, body, the client for task rows; ClickUp links open in a new tab, the rest are cockpit links | `:169-209` |
| Empty | "No client action or media task is waiting." | `:211` |
| Footer | "Checked while this cockpit is open. Source updates follow the existing sync." | `:214-217` |

### 2.2 The database side

| Object | What it does | Source |
|---|---|---|
| `cockpit_media_notice_reads` (`actor_id` auth user, `notice_id`, `version`, `seen_at`) | Read state per person and notice. Row security on. The migration grants the service role SELECT, INSERT, UPDATE and DELETE; the live ACL shows the service role with every privilege (`arwdDxtm`) | `20261024125012…:2-9`; `pg_class.relacl` read today |
| `cockpit_media_client_notices()` | The live function is a wrapper (`20261024172848_media_client_lifecycle.sql:154-168`). It hides relaunch notices for clients on hold and adds "service" notices for active holds. It calls the renamed body `cockpit_media_client_notices_before_client_hold()` (`20261024131543_launch_creative_imports.sql:81-136`). That body unions **work** (inbox rows, open, mapped to one client or left on the team) and **attention** (launch states `reconcile`, `built`, switched on with no impressions after 24 hours, or no campaign listed). The live ACL also grants the service role EXECUTE, because the wrapper's REVOKE leaves it out (`:167`). | migrations as cited; `pg_proc.proacl` |
| Gate | `cockpit_launch_member()`: a confirmed, active seat whose email equals the auth email, and the CEO, admin or `media_buyer` | `20261024b_media_launch_desk.sql:41-50` |
| `tasksReady` | The `inbox` source is ready, stamped, and its row count matches | `20261024125012…:16` |
| `version` | The md5 of the source row without `_creationTime`. Any change to the task's row makes the notice unread again | `:30` |
| `cockpit_media_notices_seen(jsonb)` | Re-reads the current notices and upserts only those whose `{id, version}` still match. No audit row | `:68-80`; no trigger on the table |

### 2.3 Where the task rows come from

`hermes/cockpit-sync/calculator.ts`, run by the native media cycle every 15
minutes under `flock` (cron line in `hermes/cockpit-sync/RUNBOOK.md:5-8`,
the same in `hermes/cockpit-guardian/crontab.manifest:2`):

- **Tasks** (`:2955-3001`):
  - lists Ads Managment `901817774521` and Marketing / ADs `901816723196`
    (`HER_LISTS`, `:37`), read with
    `list/{id}/task?include_closed=false&subtasks=false`;
  - a task is kept if it is assigned to `113428468` (`NADA`, `:34`), or
    named "Campaign Launch" or "New Client", or open on Marketing / ADs
    (`:40`, `:2976-2984`);
  - it drops statuses named complete, closed or done.
- **Mentions** (`:3003-3040`): comments on the 40 most recent Ads Managment
  tasks updated in the last 14 days. A comment counts when one of its parts
  tags `113428468`, or the comment is assigned to that user. Resolved
  comments and that user's own comments are skipped.
- **Published** through `hermes/cockpit-sync/capture.ts:45` and `:70` into
  `cockpit_media_sources` (`table_name='inbox'`). Every ClickUp read goes
  through `transport.ts:229-243`: GET only, paginated, and refused off
  `api.clickup.com`.
- **Today:** 2 rows. Both are "assigned to you", on Marketing / ADs,
  overdue, with statuses "review required" and "pending", last changed
  2026-10-21. Stamp 2026-10-26 16:20, `ready`, `row_count 2` (SQL).

The media buyer's Today (`/dashboard`, `pages/CockpitPage.tsx`) shows the
same inbox in the card "Your ClickUp tasks" (`:2330-2400`). The card shows
every row, with "Open work on the Ads Management and Marketing / ADs boards"
as its subtitle. Its "Who needs to answer?" picker reads `snap.members`
from the `clickupMembers` source (`20260927w_media_read_models.sql:46`),
which has **0 rows** since 2026-10-07 (SQL). The picker is therefore empty.

## 3. `hermes/task-assignment-alerts`

| Item | Value | Source |
|---|---|---|
| Watches | 6 home lists (main tasks only, not archived, status type not closed or done). Operations / Tech, Marketing / ADs, Call Center, Client Success and Media/Creative use assignment events. Video Pipeline uses "new video request" events | `worker.py:21-28`, `:69-76`; README:6-15 |
| ClickUp events | **Assignment added**: a diff of assignee ids against the last SQLite snapshot (`observe`, `:224-247`). **New video request**: a new task in that status (`:236-237`). Title, due, comment and status edits never alert. A removed person never alerts | README:17-29 |
| Reads | `GET list/{id}/task?include_closed=true&subtasks=false&order_by=updated&date_updated_gt=<cursor - 10 min>`, every page up to 100 (`:126-141`, `:33`). A full read every 6 hours (`:352`). `GET task/{id}` again before each send (`:143-149`, `:314`) | worker |
| Slack | `users.list` (exact, unique, active email to Slack id; `:151-164`). It posts `chat.postMessage` to the department channel with mentions, the due date (Kuwait time if timed), a ClickUp button and a `TA-<uuid>` reference (`:250-290`). An unknown send is never replayed; it is looked up in history by `client_msg_id` or the `TA-` marker (`:166-180`, `:293-333`) | worker |
| Channels | tech-general `C0AS2JLMJCB`, client-ads-general `C0C8DLZGTMZ`, csr-general-channel `C09R83NNQV9`, csm-general `C09RZ0GS0V9`, media-general `C0AE8G5MT7Y`, video-editors-labs `C0BJF7RR09Y` | `:21-28` |
| State tables (SQLite, `/home/hermes/.task-assignment-alerts/ledger.sqlite3`) | `meta(key,value)` (`ready`, `routes`, `last_full`, `health`), `lists(id,cursor_ms)`, `tasks(id,list_id,assignees,generation)`, `deliveries(id,task_id,list_id,assignees,state,created_ms,kind,attempts,next_ms,sent_ms,receipt,error,unmapped)` | `:207-216`; VPS `mode=ro` read |
| Supabase | One row only: `cockpit_sync_state` key `task-assignment-alerts` (`:191-198`). The guardian fails it after 10 minutes without a run, or when it is not ok (`hermes/cockpit-guardian/checks/task_assignments.py:6-25`) | |
| Cron (live) | `*/2 * * * *` with `TASK_ALERT_CONFIG` and `TASK_ALERT_STATE`, running `task-assignment-alerts-current/run.sh` (`timeout 110`). The OS lock is taken in `worker.py:393-397`, not by `flock` in cron. The line is **not** in `hermes/cockpit-guardian/crontab.manifest` | VPS `crontab -l` line 75; manifest grep |
| Health now | `apply true`, `healthy true`, 405 tasks observed, `states {accepted: 71}`, last run 2026-10-26 16:24 | `cockpit_sync_state` |
| Volume | 71 posts from 2026-10-12 17:48 to 2026-10-24 13:42: Video Pipeline 21 (1 new video request), Marketing / ADs 15, Client Success 13, Media/Creative 12, Operations / Tech 10, Call Center 0. 6 posts named more than one person. Tasks seen per list: Marketing / ADs 141, Video Pipeline 94, Operations / Tech 75, Media/Creative 67, Client Success 28, Call Center 0 | ledger `mode=ro` |
| Ledger of ClickUp calls | None per call. The worker has its own `API` class (`:89-124`), not a `tools.ts` helper, so its ClickUp and Slack calls do not land in a provider health ledger. Only the heartbeat does | worker |

What it cannot do for D19:

- It sees 6 lists, not the workspace.
- It sees main tasks only.
- It knows assignment only, not due dates, comments or status.
- It keeps no per-seat rows a cockpit can read.

Its README (line 39) keeps it off Supabase on purpose.

## 4. Who a seat is in ClickUp and in Slack

### 4.1 The tables

| Table | Rows (live) | Holds | Holds a ClickUp id? | Holds a Slack id? |
|---|---|---|---|---|
| `cockpit_members` | 16 (13 active, 3 inactive) | `id`, `auth_user_id`, `email`, `name`, `roles[]`, `clients[]`, `active`, `last_seen_at`, `last_cockpit` … | no | no |
| `cockpit_people` | 27 (13 active) | `id`, `name`, `email`, `role`, `active`, `schedule` (jsonb), pay fields | no | no |
| `cockpit_eod_radar_slack_ids` | 11 (10 `ok`, 1 `not_found`) | `person_id` → `slack_user_id`, `state`, `checked_at` (last 2026-10-23) | no | yes |
| `cockpit_slack_people` (Stage 1, `20261025n_slack_notices.sql:137-149`) | 0 | `person_id` → `slack_user_id`, `state` (`checking`, `ok`, `not_found`, `refused`) | no | yes |
| `team_people` | 24 (22 active, 14 with `slack_id`) | `id`, `name`, `role`, `department`, `email`, `slack_id` | no | yes |
| `editor_people` | 13 | `email`, `role`, `via_clickup`, `clickup_seen_at` | no | no |

Columns named like `clickup_user`, `assignee`, `slack_user`, `slack_id` or
`clickup_id` in every non-system schema: only the Slack ids above, plus
`clickup_id` on client and task tables (`information_schema.columns`). The
only seat-to-ClickUp link in code is the constant `NADA` (`calculator.ts:34`).

Stage 1 already resolves a person's Slack id once:
`cockpit_slack_person_id(person_id)` reads the EOD radar's checked id first,
then `cockpit_slack_people` (`20261025n…:276-283`). A seat reaches a person
by email (`cockpit_members.email = cockpit_people.email`). That join holds
for 10 of 13 active seats. The other three have no person row: the CEO's
second sign-in and two video editor seats.

### 4.2 Email match to ClickUp, 2026-10-26

There are 12 ClickUp workspace members (MCP `clickup_get_workspace_members`;
CT section 8 counted 10 the day before). The email comparison ran inside SQL
and returned roles only.

| Seat roles | ClickUp member by email | In `cockpit_people` | Slack id (radar) |
|---|---|---|---|
| CEO (company address) | `284616470` | yes | none |
| CEO (personal sign-in) | **none** | no | none |
| Systems manager | `113459516` | yes | ok |
| Creative strategist | `113520400` | yes | ok |
| CSM | `113688800` | yes | ok |
| Media buyer A | `119413219` | yes | ok |
| Media buyer B | `113428468` | yes | ok |
| Video editor A | `113492660` | yes | ok |
| Video editor B | `113691506` | no | none |
| Video editor C | **none** | no | none |
| Call centre agent (2 seats) | **none** | yes | not checked here |
| Closer | **none** | yes | not checked here |

Four ClickUp members match no seat: `119417550`, `234166914`, `113432734`,
`113432729`, all on personal email domains. Two of them hold 1 open task
each (section 6). Whether any of them is one of the unmatched seats under
another address was not checked.

## 5. Task mirrors that exist today

Each was built for one cockpit, scoped by list, and none is per seat.

| Mirror | Rows | Built from | Cadence | Per-seat field |
|---|---|---|---|---|
| `cockpit_media_sources` `inbox` | 2 | 2 lists for one ClickUp user (section 2.3) | 15 min (native cycle) | no; one fixed user |
| `cockpit_creative_sources` `creativeTasks` | 151 | Media/Creative tasks (`hermes/cockpit-sync/creativeProducer.ts:578`) | 15 min | `assignees` in the row |
| `cockpit_csm_sources` `csTasks` | 9 | Client Success list `901816723211` (`csmProducer.ts:284`, `:407`) | 15 min | `assignee` in the row |
| `editor_jobs` | 66, last update 16:32 today | Video Pipeline, by the editor desk (`hermes/editor-desk/README.md:109`) | 5 min | `editors` |
| `portal_data.tasks` | 60 | not read | | |

The editor cockpit already has a one-task focus page, `/job/:taskId`
(`apps/video-editor-cockpit/src/App.tsx:295`, `:335-338`), over `editor_jobs`.

The D18 ticket tables do not exist yet: `cockpit_request_types`,
`cockpit_requests` and any task mirror table return null from `to_regclass`.
`cockpit_forms_editors` exists, with 0 rows.

## 6. What "open tasks assigned to this seat" is, measured

`GET team/90182518398/task?assignees[]=<id>&include_closed=false&subtasks=true`,
all pages, run at 16:31 Kuwait on 2026-10-26.

Column meanings:

- **Returned:** what ClickUp sent back.
- **Done-type:** rows whose status type is `done`, which ClickUp still sends
  with `include_closed=false`.
- **Cards:** client cards on `Clients - Mahara` `901816559981`, where the
  CSM is the assignee of record.
- **Work:** what is left after removing done-type rows and cards.
- **Overdue\*:** due timestamp earlier than now. A date-only task due today
  may count as overdue here, because the team endpoint gives no
  `due_date_time`.

| Seat | Pages | Returned | Done-type | Cards | Work | Main tasks | Overdue\* | Due in 7 days | No due date | Lists |
|---|---|---|---|---|---|---|---|---|---|---|
| Systems manager | 1 | 17 | 12 | 1 | 4 | 4 | 3 | 0 | 1 | Ops / Tech 3, Marketing / ADs 1 |
| Creative strategist | 2 | 164 | 61 | 1 | 102 | 38 | 19 | 0 | 83 | Media/Creative 84, Video Pipeline 17, Client Success 1 |
| CSM | 1 | 25 | 0 | 17 | 8 | 8 | 7 | 0 | 1 | Client Success 6, Media/Creative 1, Video Pipeline 1 |
| Media buyer A | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | |
| Media buyer B | 1 | 17 | 8 | 1 | 8 | 8 | 7 | 0 | 1 | Video Pipeline 5, Marketing / ADs 2, Media/Creative 1 |
| Video editor A | 1 | 49 | 0 | 1 | 48 | 48 | 41 | 1 | 6 | Video Pipeline 46, Media/Creative 2 |
| Video editor B | 1 | 35 | 0 | 0 | 35 | 35 | 29 | 1 | 5 | Video Pipeline 33, Media/Creative 2 |
| CEO | 1 | 13 | 6 | 1 | 6 | 6 | 5 | 0 | 1 | Video Pipeline 4, Client Success 1, Personal List 1 |

What this means for "not too busy":

- **Most "overdue" is stale dates.** The editors' Video Pipeline tasks sit
  mostly in "planning" or "internal approved", waiting on someone else.
  - Leaving Video Pipeline out of "Your tasks" for editors is
    `today-and-shell.md` decision 11.5; the editor desk already lists those
    jobs.
  - A row cap and a "N more past due" line are needed anyway.
- **The creative strategist has 64 subtasks among 102 open work tasks, and
  83 have no due date.** Counting main tasks for the 5 Today rows, and
  showing subtasks in the focus view, keeps the list short.
- **The CSM's 17 client cards are clients, not tasks.** Leave list
  `901816559981` out of "Your tasks".

Fields the team endpoint returns per task (key names, 2026-10-26):

> `archived, assignees, checklists, creator, custom_fields, custom_id,
> custom_item_id, date_closed, date_created, date_done, date_updated,
> dependencies, description, due_date, folder, group_assignees, id,
> linked_tasks, list, locations, name, orderindex, parent, permission_level,
> points, priority, project, sharing, space, start_date, status, tags,
> team_id, text_content, time_estimate, top_level_parent, url, watchers`

The page carries `last_page`. There is **no `due_date_time`**.
`group_assignees` exists: a task assigned to a ClickUp user group would not
match `assignees[]` (not tested). The sampled task had an empty checklist,
so whether items come inline was not seen.

## 7. ClickUp limits, helpers and ledgers

### 7.1 Rate limits

| Fact | Value | Source |
|---|---|---|
| Limit on the token used | `X-RateLimit-Limit: 1000` in every probe run that printed headers (four runs) | VPS GETs, 2026-10-26 16:29 to 16:33 |
| ClickUp's rule | Per token, by the workspace plan: 100 a minute for Free Forever, Unlimited and Business; 1,000 for Business Plus; 10,000 for Enterprise. Over the limit: HTTP 429. Headers `X-RateLimit-Limit`, `-Remaining`, `-Reset` | developer.clickup.com/docs/rate-limits |
| What the code assumes | 100 a minute ("on Business plans"); it paces at 90 unless `CLICKUP_CALLS_PER_MINUTE` is set | `clickup-writeback/index.ts:78-79` |
| Ledgered ClickUp calls, last 24 hours | media ledger 3,991 (peak 80 in one minute), CSM ledger about 2,883 (peak 31), CEO ledger 100; 0 responses with 429 | `cockpit_media_provider_health`, `cockpit_csm_provider_health` (null provider counted as ClickUp), `cockpit_ceo_provider_health` |
| Not ledgered per call | `task-assignment-alerts` (at least 6 list reads every 2 minutes, about 4,300 a day), the editor desk, `review-watch`, `video-review-flow` | worker code |
| Shared token? | In one probe minute `X-RateLimit-Remaining` fell by about 52 more than the probe's own calls. That minute was the 16:30 native cycle, which fits one token shared by several workers. Not proven: the variable names differ (`CLICKUP_API_KEY` on the shared VPS env, `CLICKUP_API_TOKEN` in workers and Edge secrets) | probe headers |

### 7.2 Helpers that already ledger a ClickUp call

| Helper | Ledger | Source |
|---|---|---|
| `providerTools(env, health)` (ClickUp, Meta, Slack, GHL) | `cockpit_media_provider_health` (intent, response, unknown) | `supabase/functions/cockpit-media-api/tools.ts:5-48` |
| `clickup-writeback` uses the same helper, with a pacer | `cockpit_media_provider_health` with `action_id` | `clickup-writeback/index.ts:69-79` |
| `providerTools(token, health)` (ClickUp only) | `cockpit_csm_provider_health` | `supabase/functions/cockpit-csm-api/tools.ts:3-11` |
| Native cycle transport, GET only, paginated | native receipts, then the media provider ledger | `hermes/cockpit-sync/transport.ts:229-243`; RUNBOOK:130 |

The writeback queue's kinds are `decision`, `manual_change`,
`provider_action`, `tracking_backlog` and `billing` (CHECK constraint, live).
None fits a tick, comment or "Mark done" from the focus view; `writers.md`
section 10 covers that.

### 7.3 Webhooks already on the workspace

`GET team/90182518398/webhook` returns 24 webhooks, all created by the CEO's
user and all `health {status: active, fail_count: 0}`:

- **22 Hubstaff folder webhooks**, one of them on All Assignments
  `901812879297`. Events: `taskCreated`, `taskUpdated`, `taskDeleted`,
  `listUpdated`, `listDeleted`, `taskStatusUpdated`.
- **1 Hubstaff workspace webhook** for folder and space events.
- **1 Make webhook** on Ads Managment `901817774521`, `taskCreated` only.

None subscribes to `taskCommentPosted` or `taskAssigneeUpdated`, and none
points at Supabase.

From ClickUp's docs (developer.clickup.com/docs/webhooks,
/docs/webhooksignature):

- **Task events:** `taskCreated`, `taskUpdated`, `taskDeleted`,
  `taskPriorityUpdated`, `taskStatusUpdated`, `taskAssigneeUpdated`,
  `taskDueDateUpdated`, `taskTagUpdated`, `taskMoved`, `taskCommentPosted`,
  `taskCommentUpdated`, `taskTimeEstimateUpdated`, `taskTimeTrackedUpdated`.
- **Who made the change:** each `history_items` entry has `user.id`.
- **Scope:** one location per level (space, folder, list or task).
- **Signature:** `X-Signature` is an HMAC-SHA256 hex digest of the body,
  keyed with the webhook's secret.
- **Creator:** a webhook whose creating user is disabled stops firing.

### 7.4 Comments and `date_updated`

Of 30 tasks updated in the last 3 days that have comments, **none** had a
`date_updated` earlier than its latest comment. Six matched it within 5
seconds. This is consistent with "a new comment bumps the task's
`date_updated`", which would let a delta poll find commented tasks. It is
not proven, and threaded replies were not tested.

The comment shape in use:

- comment keys: `assignee, comment, comment_text, date, group_assignee, id,
  reactions, reply_count, user`;
- a tag part: `{text, type: "tag", user: {id, username, email, …}}`.

In the same window, 4 comments tagged someone and 0 were assigned
comments. Comments written by the cockpit, Make or the agents show the
API user (the CEO) as author (CT top section).

## 8. Proposal: one task mirror and one alert feed for every seat

This is a proposal for the build session, in line with PLAN.md D17 to D19
and the repo rules. Names follow `today-and-shell.md` 6.3 where it already
named them.

### 8.1 How to read open tasks per seat

| Option | Calls a day (today's volume) | Catches | Misses | Verdict |
|---|---|---|---|---|
| A. Per seat, team endpoint, every 5 minutes | 9 calls a run (8 linked users; the creative strategist needs 2 pages) × 288 runs = **about 2,600** | assignment, due, status, per seat | who did it; comments; tasks of unlinked seats | simple, but it grows with every seat |
| **B. Workspace delta every 2 minutes, plus a per-seat check every hour** | delta 720 (1 page at today's volume, `include_closed=true&subtasks=true&order_by=updated&date_updated_gt=<cursor - 10 min>`, the overlap `task-assignment-alerts` uses), + hourly check 9 × 24 = 216, + comment reads on changed tasks (31 a day today, plus replies) = **about 1,000** | everything A catches, plus comments on changed tasks, plus tasks leaving a seat (from the hourly full read) | who changed a status; changes inside one 2-minute window that undo themselves | **recommended** |
| C. A workspace webhook (`taskAssigneeUpdated`, `taskStatusUpdated`, `taskDueDateUpdated`, `taskCommentPosted`, `taskCreated`, `taskMoved`) into an Edge Function with `verify_jwt` off and the `X-Signature` check | about 0 polling calls | the actor (`history_items.user`), mentions at once | everything while the webhook is failing or suspended | **later, as the fast path, with B kept as the second source** |

Why B fits the repo rules:

- It is one ClickUp `GET` every 2 minutes through `providerTools`, so
  every call lands in `cockpit_media_provider_health` (about 2,000 ledger
  rows a day).
- It sits next to the job `mahara-clickup-writeback-log`, which already
  runs every 2 minutes from pg_cron (`cron.job`, live).
- D18 already puts the request mirror inside `clickup-writeback`, so one
  mirror serves both "Your tasks" and "My requests".
- C needs a ClickUp write (creating the webhook) under the CEO's yes (D16).
  That webhook would sit beside 23 Hubstaff webhooks on the same user.

### 8.2 Tables (Creative Triage, prefix `cockpit_`)

Each table needs row security on, a revoke from PUBLIC, anon,
authenticated and service role, the exact service grant in the same file,
an audit trigger, idempotency, and `NOTIFY pgrst`.

| Table | Holds |
|---|---|
| `cockpit_member_clickup` | `member_id` (`cockpit_members.id`), `clickup_user_id`, `state` (`ok`, `not_found`, `ambiguous`, `manual`), `matched_by` (`email` or the editor's member id), `checked_at`. Filled by exact, unique email from the members read (as `task-assignment-alerts` does for Slack). An editor (`cockpit_forms_editor_gate`, D17) can set or clear a link, with old and new values audited. It is keyed by seat, not person, because two editor seats have no person row |
| `cockpit_task_mirror` | One row per task the delta or the per-seat check has seen. Columns: `task_id` PK, `list_id`, `list_name`, `parent_id`, `name`, `status`, `status_type`, `due_at`, `due_has_time` (null until a `GET task` fills it), `assignee_ids bigint[]`, `watcher_ids bigint[]`, `creator_id`, `tags text[]`, `client_task_id` (from the tag or card match, as the requests plan does), `url`, `date_updated`, `checklist_done`, `checklist_total`, `seen_at`, `gone_at` |
| `cockpit_task_alerts` | Append-only events. Columns: `id`, `member_id`, `task_id`, `kind` (`assigned`, `due_today`, `overdue`, `comment`, `mention`, `status`), `dedupe_key` UNIQUE, `at`, `actor_label` (a role, or "Someone in ClickUp" when unknown), `summary`, `read_at`, `dm_state` (`none`, `held`, `queued`, `sent`, `unknown`) |
| `cockpit_task_alert_rules` | One row per seat. Columns: which kinds are on, `slack_dm` (default **off**), quiet hours (null means use `cockpit_people.schedule`), digest time. The seat edits its own row; an editor edits anyone's (D17); every change audited |
| `cockpit_sync_state` key `task-mirror` | Last delta, last full check, the cursor, `ok`, and a note. The bell's "unavailable" line reads it |

### 8.3 Functions (`SECURITY DEFINER SET search_path=''`, gate first)

| Call | Gate | Notes |
|---|---|---|
| `cockpit_my_tasks(p_cockpit)` | confirmed active seat | Returns `{asOf, sourceAt, ready, link, tasks}` (`today-and-shell.md` 6.3). Rules: rows where `assignee_ids` holds the seat's linked id; status type not `done` or `closed`; not on `901816559981`; list exclusions per cockpit (Video Pipeline for editors). `link` is `not_linked` when the seat has no `ok` row in `cockpit_member_clickup`; that is never an empty list. `ready` is false when `task-mirror` is older than 10 minutes |
| `cockpit_task_alerts(p_cockpit)` / `cockpit_task_alerts_seen(p_alerts)` | same | As the media pair (section 2.2), but over event rows. Each mark-read leaves an audit row (the media version does not) |
| `cockpit_task_detail(p_task_id)` | the seat is an assignee or a watcher of the task, or the seat is admin or CEO | Mirror fields, plus a live `GET task/{id}` (checklist items, `due_date_time`, description) and `GET task/{id}/comment` through the Edge Function and `providerTools`. Cached on the mirror row |
| `cockpit_task_act(...)` | same | Queues a writeback row; `writers.md` section 10 |

### 8.4 The events that make an alert

| Event | Found by (B) | Found by (C, later) | Who did it | Dedupe key | Notes |
|---|---|---|---|---|---|
| **Assigned to you** | The seat's id appears in `assignee_ids` (a new task, or added) between two reads | `taskAssigneeUpdated` `history_items` | B: not known (only `creator_id` on a new task). C: `history_items.user` | `assigned:{task}:{member}:{n}` (n counts re-assignments) | If the seat assigned itself, say nothing (C only; with B, skip when `creator_id` is the seat on a new task) |
| **Due today** | Once a day at the start of the seat's shift: open tasks whose due day in Kuwait is today | (computed) | n/a | `due:{task}:{member}:{day}` | One alert row for the batch ("3 tasks are due today"), not one per task |
| **Overdue** | Once, the first read after the due day ends (date-only) or the due time passes (timed) | (computed) | n/a | `overdue:{task}:{member}:{due day}` | Never repeated. Tasks already past due when the feed starts are baselined without alerts, as `task-assignment-alerts` does (README:19) |
| **Comment on your task** | For each changed task assigned to the seat, `GET task/{id}/comment` (and replies where `reply_count > 0`); comments newer than the last read, not written by the seat | `taskCommentPosted` | `comment.user`. The cockpit, Make and agents write as the API user, so their comments show as the CEO. Use the writeback row's requester where the comment is the cockpit's (its `Ref` line) | `comment:{comment id}:{member}` | |
| **A comment that mentions you** | The same read: a part with `type:"tag"` and `user.id` equal to the seat, or `comment.assignee.id` equal to the seat | `taskCommentPosted` | as above | `mention:{comment id}:{member}` | Applies on **any** task, not only the seat's own. B only sees tasks the delta returns, so this rests on 7.4 |
| **Status changed by someone else** | `status` differs from the mirror on a task assigned to the seat, and no writeback row of this seat for that task settled in the window | `taskStatusUpdated` with `history_items.user` not equal to the seat | B: unknown ("Status moved to review required"); C: known | `status:{task}:{status}:{date_updated}` | API-user changes look like the CEO in C too |

### 8.5 Unread state per seat

- `read_at` on each alert row, set only through
  `cockpit_task_alerts_seen`, each mark leaving an audit row.
- The bell counts unread alerts from the last 14 days. "Mark all read"
  marks at most 200, as the media bell does.
- The media bell's own notices (relaunch, review, delivery, service holds)
  keep `cockpit_media_notice_reads`. The shared bell can merge both lists
  once the media task rows come from the new mirror. Then the `inbox`
  source and its fixed user id can retire.

### 8.6 Slack DMs and quiet hours

- **Default:** in-cockpit alerts only. `slack_dm` is off until a seat or an
  editor turns it on (D17).
- **No double notice.** `task-assignment-alerts` already posts new
  assignments on its 6 lists in the department channel, with the person
  mentioned. A DM for those adds nothing. DM only these:
  - mentions;
  - comments;
  - status changes;
  - the daily "due today" line;
  - assignments on lists outside those 6.
- **Quiet hours come from `cockpit_people.schedule`** (`20260921b_people_schedule.sql`):
  - shape `{timezone, week:{mon..sun:{on,start,end}}, exceptions}`;
  - set for 9 of 13 active people; none for the CEO, the closer, one
    video editor or the bot's person row;
  - Friday is off for everyone who has one.

  Outside the shift a DM is held (`dm_state held`) and sent at the next
  shift start as one digest. With no schedule, the default is Sunday to
  Thursday 10:00 to 18:00 Kuwait.
- **Cap and digest:** `hermes/exception-alerts` (README "The guards")
  already caps alerts at 5 per person per Kuwait day, with the rest in one
  digest from 16:00. Use the same numbers.
- **Sender:**
  - Delivery should go through one outbox (D4), so either the Stage 1
    sender `cockpit-notices` (cron `mahara-slack-notices` every minute,
    live) gains a DM target, or the exception-alerts DM path is reused.
  - mahara-club-bot already holds `chat:write` and `users:read.email`
    (`docs/forms/maps/slack.md` lines 98-110). The exception-alerts doctor
    needs `im:write` for `conversations.open` (`hermes/exception-alerts/worker.ts:248`,
    `:608`).
  - That path is still a dry run ("Delivery dry run: nothing new",
    `cockpit_sync_state` key `exception-alerts`). So a DM from
    mahara-club-bot has no live receipt yet.

### 8.7 Missing is never zero

| State | What the seat sees |
|---|---|
| Seat not linked to ClickUp | "Your ClickUp account is not linked. Ask the systems manager to link it." |
| Mirror older than 10 minutes or not ok | "Task updates are unavailable. Open ClickUp for now." with the time of the last check |
| Linked, no open task | "Nothing is assigned to you in ClickUp." |
| A task whose detail read failed | "This task could not be read from ClickUp. Open it in ClickUp." |

The guardian gets a `task-mirror` check like `task_assignments.py`: red
after 10 minutes without a run, or when the delta fails twice in a row.

## 9. Gaps found in passing

| # | Gap | Source |
|---|---|---|
| 1 | The media inbox is one person's tasks, shown to every media buyer seat with rewritten wording | `calculator.ts:34`; `20261024125012…:26-27` |
| 2 | The media inbox reads 2 of the lists media buyer B is assigned on; 6 of 8 open work tasks never show | section 6 vs `inbox` rows |
| 3 | "Who needs to answer?" on the media Today card reads an empty source (`clickupMembers` 0 rows since 2026-10-07) | `CockpitPage.tsx:2380-2382`; `cockpit_media_source_state` |
| 4 | Marking a media alert read writes no audit row | no trigger on `cockpit_media_notice_reads` |
| 5 | The live notices function grants EXECUTE to the service role; the wrapper migration's REVOKE leaves it out | `20261024172848…:167`; `proacl` |
| 6 | `include_closed=false` returns done-type tasks; any reader that trusts it over-counts open work | section 6 |
| 7 | Writeback paces for a 100-a-minute limit; the token's limit is 1,000 | section 7.1 |
| 8 | `task-assignment-alerts` calls ClickUp and Slack outside any per-call ledger, and its cron line is missing from the guardian's crontab manifest | section 3 |
| 9 | Nothing records a seat's ClickUp id, so every per-person ClickUp feature hardcodes one or matches email at read time | section 4 |

## 10. Not verified

- **Who the 4 ClickUp members without a seat are**, and whether any is an
  unmatched seat under a personal address. Not looked up on purpose.
- **Whether every worker and Edge secret uses the same ClickUp token.** The
  rate-limit drop in one minute suggests they share one; the values were
  not compared.
- **Comments and `date_updated`.** That a comment always bumps the task's
  `date_updated` (section 7.4: consistent on 30 tasks, not proven), and
  that a threaded reply does.
- **Archived tasks:** whether the team endpoint returns them by default.
  The docs do not say, and the probe did not look.
- **Group assignees:** whether `assignees[]` matches tasks assigned through
  a ClickUp user group (`group_assignees`).
- **Checklist items:** whether the team endpoint returns them inline (the
  sampled task had none).
- **Webhooks:** retry behaviour and the `failing` or `suspended`
  thresholds. The docs pages read do not cover them; the live list shows
  only `status` and `fail_count`.
- **Edge Function run time** for a delta plus up to 40 comment reads at the
  writeback pacer. Not measured.
- **Overdue counts in section 6:** they compare timestamps, so a date-only
  task due today may count as overdue. The real split needs `GET task/{id}`
  for `due_date_time`.
- **That mahara-club-bot can DM**: no live DM receipt was found. The hours
  watch ledger shows 58 accepted `chat.postMessage` calls but does not say
  which were DMs.
- **`portal_data.tasks`**: 60 rows; its contents and writer were not
  read.
- **ClickUp plan name.** "Business Plus" is inferred from the 1,000 limit,
  not read from an account page.

## 11. Sources

- **Code:**
  - `apps/media-buyer-cockpit/src/components/launch/ClientAlerts.tsx`
  - `apps/media-buyer-cockpit/src/components/AppLayout.tsx:88`
  - `apps/media-buyer-cockpit/src/pages/CockpitPage.tsx:2330-2400`, `:4080-4106`
  - `hermes/cockpit-sync/{calculator.ts, capture.ts, transport.ts, creativeProducer.ts, csmProducer.ts, RUNBOOK.md}`
  - `hermes/task-assignment-alerts/{README.md, worker.py, run.sh}`
  - `hermes/cockpit-guardian/checks/task_assignments.py`, `crontab.manifest`
  - `hermes/exception-alerts/README.md`, `worker.ts`
  - `supabase/functions/clickup-writeback/index.ts`
  - `supabase/functions/cockpit-media-api/tools.ts`
  - `supabase/functions/cockpit-csm-api/tools.ts`
  - `apps/video-editor-cockpit/src/App.tsx`
- **Migrations:** `20261024125012_media_clients_workspace.sql`,
  `20261024131543_launch_creative_imports.sql`,
  `20261024172848_media_client_lifecycle.sql`,
  `20261024b_media_launch_desk.sql`, `20260927w_media_read_models.sql`,
  `20261025n_slack_notices.sql`, `20260921b_people_schedule.sql`.
- **Supabase (SELECT, 2026-10-26 16:20 to 16:40):**
  - table lists from `pg_class` and `information_schema`;
  - row counts;
  - `cockpit_media_sources` and `cockpit_media_source_state`;
  - `cockpit_sync_state`;
  - `pg_trigger`, `relacl`, `proacl`;
  - `cron.job`;
  - the three provider health ledgers;
  - the CHECK constraints on `cockpit_clickup_writeback_queue`;
  - the email match against ClickUp members, returning roles only.
- **ClickUp:**
  - MCP `clickup_get_workspace_members`;
  - VPS GETs on `user`, `team/{id}/webhook`, `team/{id}/task` (by assignee
    and by `date_updated_gt`) and `task/{id}/comment`, about 160 calls,
    headers and counts only.
- **ClickUp docs:** developer.clickup.com `docs/rate-limits`,
  `docs/webhooks`, `docs/webhooksignature`, `reference/getfilteredteamtasks`,
  `llms.txt`.
- **VPS:** `crontab -l` (user hermes),
  `ls /home/hermes/.task-assignment-alerts`, and the SQLite ledger opened
  read-only.
