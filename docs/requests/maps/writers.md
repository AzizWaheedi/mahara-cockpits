# Writers: how the cockpit writes tickets and task changes to ClickUp

Read-only map, 2026-10-26, worktree `forms-1025`, branch `tickets-1026` from
main `86ee4e84`. Nothing was written to ClickUp, Supabase or Slack. Supabase
was read with `SELECT` through `sq.py`. ClickUp was read with the MCP read
tools and plain `GET` calls on the VPS (key read by name as
`CLICKUP_API_KEY`, never printed). ClickUp's public API reference was read on
developer.clickup.com. Staff are named by role. ClickUp user ids by role (CT
follow-up): systems manager `113459516`, creative strategist `113520400`, CSM
`113688800`, media buyer A `119413219`, media buyer B `113428468`, CEO and API
user `284616470`.

Source tags: **CT** `docs/forms/maps/clickup-ticketing.md`, **RF**
`docs/forms/maps/repo-forms.md`, **PLAN** `docs/forms/PLAN.md`, **R** a read
made for this map (today), **DOC** the ClickUp API reference page named.

---

## 1. What matters most

1. **There are eight ClickUp task-writing paths in five Edge Functions, and
   only one has ever filed a ticket.** `clickup-writeback` delivered 7 client success tickets
   (2026-10-12 to 10-21). The direct writers in `cockpit-csm-api` (client page
   "Add a task", board levers), `cockpit-media-api` (offboarding) and
   `cockpit-creative-api` (creative outbox, Blueprint) have filed none: 0
   ticket rows in `cockpit_csm_actions`, 0 rows in `cockpit_board_levers`,
   0 rows in `cockpit_creative_outbox` (R, SQL). Choosing one writer now moves
   no live traffic.
2. **The switches today** (read from run modes, because secrets cannot be read):
   `CLICKUP_WRITEBACK_APPLY` is off, `CLICKUP_WRITEBACK_APPLY_CSM_TICKETS` is
   on (since 2026-10-12 13:54), `CLICKUP_WRITEBACK_APPLY_KPI` is on (since
   2026-10-24, between 19:05 and 19:59), `CLICKUP_WRITEBACK_ONLY_TASKS` is
   empty. **There is no `CLICKUP_WRITEBACK_APPLY_BILLING` and no
   `CLICKUP_WRITEBACK_APPLY_FORMS` in the code**, although PLAN 3.1 and 4.2
   name them. Billing rides on the general switch (section 3.4).
3. **Turning the general switch on to make tickets live would also make
   billing live**, plus media buyer decision and change comments, provider
   action comments, the weekly tracking backlog task and the Do's & Don'ts
   tidy (`run.ts:57-75`, `:312-314`). The ticket writer needs its own switch,
   and the general switch must not open it.
4. **Dates do not read back by the millisecond.** The two "Log a call" writes
   in production (2026-10-14, 10-17) both landed (HTTP 200) and both ended in
   `reconcile` with "Client field read-back did not match". ClickUp stored
   06:00 Kuwait where the cockpit sent 09:00 Kuwait (R). Every date read-back
   in the new writer compares the Kuwait calendar day. The same exact-ms
   comparison sits in the Blueprint launch press (`blueprint.ts:91`) and the
   creative outbox (`outbox.ts:17`, `:27`); not verified for task due dates
   (section 5.3).
5. **Request Type option names carry stray spaces.** The folder field's first
   option is `"Connect a New Lead Form  🆕 "` (two spaces, trailing space; R).
   A lookup by exact name misses it. The new writer pins the option id in the
   request-type row and checks a normalised name at run time.
6. **Whether setting Request Type fires the folder rules is still not
   proven.** One observation says a task created by the API with Request Type
   already set did not move (section 8). The writer sets it last, only for
   types a rehearsal has cleared.
7. **Recommendation: one writer, `clickup-writeback`, with a new job
   `requests`, two new queue kinds (`request`, `task_action`) and its own
   switch `CLICKUP_WRITEBACK_APPLY_REQUESTS`**, which opens nothing else and
   which nothing else opens. A canary list of client cards narrows it. Read-back
   rules per step are in section 10.5.

---

## 2. Every ClickUp task writer in the code today

| # | Writer | What it writes | Switch | Production use | Read-back | Retry |
|---|---|---|---|---|---|---|
| W1 | `clickup-writeback` job `log`, kind `decision`, `role = csm` (CSM "Ask a team" panel) | Task on a department list, Tech gets Additional Notes (and Request Type for the 5 action wordings in `rules.ts:59-66`), link comment on the client card | `CLICKUP_WRITEBACK_APPLY_CSM_TICKETS` | **7 delivered**: 5 Media/Creative, 1 Marketing / ADs, 1 Operations / Tech, last 2026-10-21 (R, SQL) | On resume only: marker search (`queue.ts:344-366`); a field write has none (`:372-375`) | Ladder 1, 5, 15, 60, 240 min (`queue.ts:83`) |
| W2 | `clickup-writeback` job `log`, kind `decision`, `role = media_buyer`, `kind = rerouted` (media buyer reroute) | Comment on the board card, task on a department list, link comment | `CLICKUP_WRITEBACK_APPLY` | 1 held `dry_run` (2026-10-15, "Client card declined, chase the payment" to Client Success) (R) | as W1 | as W1 |
| W3 | `clickup-writeback` kind `tracking_backlog` | Weekly backlog task | `CLICKUP_WRITEBACK_APPLY` | 4 held `dry_run` (R) | as W1 | as W1 |
| W4 | `cockpit-csm-api` `act` with `department` or `kind = ticket` (`core.ts:34-38`, `:42`, `:47`); caller: client page "Add a task for this client" (`ClientPerformancePage.tsx:818`, `lib/performance.ts:93`) and the board lever (`cockpit-board-api/lever.ts:18`, imports `core.ts`) | Task on a department list (default Client Success), Request Type by exact name for 7 action names, comment on the client card | none: live code, synchronous | **0 tickets**: `cockpit_csm_actions` has 4 rows (2 happiness, 2 calls), none a ticket; `cockpit_board_levers` 0 rows (R) | Strict and immediate: id, list, name, due day; Request Type value; comment by id and exact text (`core.ts:41-50`) | None: a row in `sending` or `reconcile` refuses a retry ("Reconcile it before retrying", `index.ts:69`, `:77`) |
| W5 | `cockpit-csm-api` `plan` (`core.ts:22`, `:44`) | Daily plan items on Client Success `901816723211` with due dates | none | 0 rows (R) | as W4 | none |
| W6 | `cockpit-media-api` `client.offboard` (`clientLifecycle.ts:35-49`) | "{client} - Full offboarding" on Operations / Tech with Request Type **in the create body** and the client tag | `LAUNCH_APPLY = on` (`launchDesk.ts:14`) | 0 holds ever (RF F.3) | `executePlan`: GET after create, name, list, field value, tag (`execute.ts:26-31`) | none (reconcile) |
| W7 | `cockpit-creative-api` creative outbox, kinds `videoRequest`, `planScript`, `comment`, `complete`, `schedule` (`outbox.ts:7-33`; RPC kinds `20260927s…sql:62`) | Tasks on Video Pipeline and Media/Creative, a comment, status to the list's done status, due date | none beyond the creative seat gate | **0 outbox rows ever** (R) | `executePlan`, precondition plus read-back each step | none (reconcile) |
| W8 | `cockpit-creative-api` Blueprint presses (`blueprint.ts:73-151`), the D9 exception | Launch task from template `t-86ex8xaf1`, tag, assignee and due date, comments, card fields | creative seat gate | 0 presses (PLAN 1.1) | `executePlan` | the cron drain, 3 refusals (PLAN 1.3 Drain) |

Not counted: Make scenarios and the VPS agents, which also write as the API
user (CT §4).

---

## 3. `clickup-writeback` in detail

### 3.1 Entry and schedules

- One Edge Function, four jobs by body `{"job": ...}`: `kpi`, `log`,
  `dosdonts`, `doctor` (`index.ts:82-87`). Only a caller with
  `x-cron-secret` equal to `CRON_SECRET` runs it (`index.ts:54-56`).
- pg_cron (R, `cron.job`): `mahara-clickup-writeback-log` every 2 minutes,
  `-kpi` at :05 03-18 UTC, `-dosdonts` at :35 03-18 UTC, all active. The cron
  reads the secret from vault name `cockpit_sync_secret`
  (`20261009f…sql:578`).
- Every provider call goes through `cockpit-media-api/tools.ts` and writes an
  intent and a response row into `cockpit_media_provider_health` with
  `action_id` = the queue item id (`index.ts:71-75`). A receipt that cannot be
  saved stops the call.
- Pace: at most `CLICKUP_CALLS_PER_MINUTE` (default 90) ClickUp calls a minute
  **per invocation** (`index.ts:79`, `run.ts:99-117`). ClickUp's limit is per
  token: 100 a minute on Business, 1,000 on Business Plus (DOC Rate limits).
  Not verified: the workspace plan, and whether the Edge Functions and the VPS
  share one token.

### 3.2 The queue, its kinds and dedupe keys

Table `cockpit_clickup_writeback_queue` (`20261009f…sql:43-65`): `dedupe_key`
UNIQUE, `kind`, `source_table`, `source_id`, `payload`, `state`, `attempts`,
`next_attempt_at`, `claim_token`, `claimed_at`, `task_id`, `steps` (frozen
once written, `:316`), `progress` (per step), `planned` (dry-run plan),
`error`, `delivered_at`. Row security on, revoked from `PUBLIC`, `anon`,
`authenticated`; `service_role` gets `SELECT, INSERT, UPDATE` (`:116-123`).
An audit row on insert and on every state change except to `sending`
(`:142-147`).

| Kind | Dedupe key | Enqueued by | Source |
|---|---|---|---|
| `decision` | `decision:{cockpit_decisions.id}` | trigger on insert, `role = media_buyer`, or `role = csm AND kind = ticket` (`20261012a…sql:93-96`), plus the sweep at each `log` run | `20261012a…sql:40-58` |
| `manual_change` | `manual:{record id}` | trigger plus sweep | `20261009f…sql:201-213` |
| `provider_action` | `action:{media action id}` | trigger plus sweep, confirmed actions of 9 operations (live definition includes `forms.publish`, `forms.switch`; R) | `20261012a…sql:72-89` |
| `tracking_backlog` | `tracking-backlog:{yyyy}-W{ww}` | `cockpit_clickup_writeback_enqueue` from `tracking-audit` | `20261009f…sql:261-273` |
| `billing` | `billing:{cockpit_billing_events.id}` | trigger in the same transaction as the billing edit | `20261009j…sql:105-118` |

Live CHECK (R): `kind IN ('decision','manual_change','provider_action','tracking_backlog','billing')`.
States: `queued`, `sending`, `retry`, `unknown`, `delivered`, `dry_run`,
`skipped`, `failed`. The claim takes `queued`, `retry` and `unknown` that are
due, and `sending` older than 10 minutes, ordered by `created_at`, up to 50,
`FOR UPDATE SKIP LOCKED` (`20261009f…sql:277-302`). **`dry_run` rows are never
claimed again**; they need the operator `UPDATE` in the migration header
(`:26-28`).

Queue today (R, SQL, all time):

| Kind | State | Rows | First | Last |
|---|---|---|---|---|
| billing | dry_run | 2 | 2026-10-19 | 2026-10-19 |
| decision | delivered | 7 | 2026-10-12 | 2026-10-21 |
| decision | dry_run | 11 | 2026-10-12 | 2026-10-21 |
| manual_change | dry_run | 20 | 2026-10-12 | 2026-10-22 |
| provider_action | dry_run | 17 | 2026-10-12 | 2026-10-24 |
| tracking_backlog | dry_run | 4 | 2026-10-09 | 2026-10-24 |

Nothing is `queued`, `retry`, `unknown`, `sending` or `failed`. The log's
health line at 2026-10-26 16:24: "The ClickUp log queue is empty."

### 3.3 Steps and what each reads back today

| Step type | Write | Read-back today | Gap for tickets and task actions |
|---|---|---|---|
| `comment` | `POST task/{id}/comment` with `notify_all: false`; the text ends in `Cockpit ref {10 hex}[-step]` (`rules.ts:286-289`) | Only on resume: first page of comments, looks for the marker (`queue.ts:344-351`) | The comment list returns the 25 newest (DOC Get Task Comments); a busy client card needs paging back to the step's start |
| `create_task` | `POST list/{L}/task`, marker in `markdown_description` | Only on resume: `list/{L}/task?date_created_gt=…` and the marker (`queue.ts:357-366`); after a fresh create only the id's shape is checked (`:370`) | No GET after create; no template create; no assignee, due or priority |
| `field` | `POST task/{id}/field/{fid}` | **None**; a refusal is noted and the item still counts as delivered (`queue.ts:372-375`, `:414-418`) | Request Type must be read back |
| `ad_status` | reads Meta and the card, then a field write | none after the write | n/a |
| `billing_field` | per field, reads the card first, a newer ClickUp value wins (`billing.ts:115-120`) | compares by Kuwait day for dates (`billing.ts:94`) | the model to copy for preconditions |

Errors (`queue.ts:71-80`): 429 is `retry` and never landed; 5xx, a timeout or
an unreadable answer is `unknown` and read back before any new write; other
4xx are `refused`; a missing secret stops the run.

The markdown field works: a delivered ticket (`z8xmdvjzb7`) shows the full
description and the marker in `text_content` (R, MCP `get_task`).

### 3.4 The switches and their current values

Secrets cannot be read. Values are inferred from `cockpit_clickup_writeback_runs`
and `cockpit_sync_state` (R, SQL); the mode written there comes only from
`gate()` and `kpiGate()` (`run.ts:57-87`).

| Switch | Read by | Opens | Value today | Evidence |
|---|---|---|---|---|
| `CLICKUP_WRITEBACK_APPLY` | `gate()` (`run.ts:58`) | `log` (decision, manual_change, provider_action, tracking_backlog, **billing**) and `dosdonts` | **off** | 273 `dosdonts` runs, all `dry_run`, last 2026-10-26 15:35; every `log` note since 10-12 starts "Dry run:", text written only when `!g.apply` (`run.ts:349-353`) |
| `CLICKUP_WRITEBACK_APPLY_CSM_TICKETS` | `gate()` (`run.ts:67`) | `decision` rows with `role = csm` only (`run.ts:311-313`) | **on** since 2026-10-12 | 45 `log` runs in mode `apply_limited` from 2026-10-12 13:54 (the mode `!apply && csmTickets` gives, `run.ts:282`); notes "Client success tickets are live" |
| `CLICKUP_WRITEBACK_APPLY_KPI` | `kpiGate()` (`run.ts:80`), `runKpi` only | the KPI columns on Ads Managment | **on** since 2026-10-24 | one `apply_limited` canary 18:29, last `dry_run` 19:05, first `apply` 19:59; 28 `apply` runs to 2026-10-26 16:05, health "15 cards updated" |
| `CLICKUP_WRITEBACK_ONLY_TASKS` | both gates | narrows APPLY and APPLY_KPI to listed cards; **does not** narrow CSM tickets (`run.ts:17-19`) | **empty** | KPI mode is `apply`, not `apply_limited`, since 10-24 19:59 |
| `CLICKUP_WRITEBACK_APPLY_BILLING` | **nothing** | n/a | n/a | grep finds it only in PLAN 3.1 and C1; RF F.1: "Billing has no switch of its own" |
| `CLICKUP_WRITEBACK_APPLY_FORMS` | **nothing** | n/a | n/a | grep finds it only in PLAN 4.2 |

What turning the general switch on would do today: new items of every `log`
kind go live at the next run (billing edits included), and Do's & Don'ts
tidies go live. The 54 rows already in `dry_run` stay as they are, because the
claim skips `dry_run` (`20261009f…sql:285-286`).

### 3.5 The wrong Request Type ids (`rules.ts:59-66`), checked today

Read of folder field `e9fd8024-8abe-4094-ac08-e6c0e736ad7e` on
`901812879297` (R, MCP `get_custom_fields`):

| Cockpit action (`rules.ts`) | Id written | ClickUp says that id is | The right option |
|---|---|---|---|
| Add qualification questions to the lead form | `37d99ca0…` | "Connect a New Lead Form  🆕 " | `7fc82c41-7bcd-47f7-bae0-868d4954495b` Add Custom Qualification Questions🙋 |
| Switch to a landing page | `37d99ca0…` | same | `a2d9483c-2dde-486d-969e-78679e5d27a6` Create Landing Page📊 |
| Switch this campaign to a landing page | `37d99ca0…` | same | `a2d9483c-…` |
| Landing page or tracking is broken | `9fd304bb…` | Missing Leads ❌ | fair match (CT §7) |
| Tracking / page is broken | `9fd304bb…` | Missing Leads ❌ | fair match |

None of these ever reached ClickUp: no delivered row has a `ticket_type`
step (R, SQL on `progress`). The Convex copy (`convex/writeback.ts:136-141`)
has the same two wrong ids; that deployment is paused. Option names are not
clean: `"Connect a New Lead Form  🆕 "` has a double space and a trailing
space; `core.ts:19` and `clientLifecycle.ts:37` compare names exactly.

Marketing / ADs has two fields named "Request Type": `e9fd8024` (31 options)
and the list field `09abf737` (2 options: Ads Failed, Ads Active). The other
five lists in the folder have only `e9fd8024` (R, VPS `GET list/{id}/field`).
A list rule on Marketing / ADs sets a task complete and calls a webhook when
`09abf737` goes from Ads Failed to Ads Active (CT F3). Never write `09abf737`.

---

## 4. `cockpit-csm-api` direct writes (`core.ts`)

- **Who calls it.** The "Ask a team" panel on the CSM page does **not**: its
  `ticket` kind goes through `cockpit_log_decision` and the queue (W1;
  `useCsmSnapshot.ts:378-394`, test `csm-act-route.test.ts` "a ticket still
  goes through the log"). The direct ticket path is reached by the client
  page's "Add a task for this client" (`ClientPerformancePage.tsx:818`,
  department default `client_success`, `performance.ts:93-101`) and by board
  levers (`lever.ts:146-160`). Its toast says "in ClickUp within 5 minutes",
  but the write is immediate (`ClientPerformancePage.tsx:827-830`).
- **What it writes.** `POST list/{L}/task` with name `{client} - {action}`,
  a plain description, due date (+2 days at 09:00 Kuwait unless given);
  then Request Type by exact option name for 7 actions (`core.ts:6-15`,
  `:37`, `:47`); then a comment on the client card. No assignee, no tag, no
  template.
- **Read-back.** A GET after create checks id, list, name and the due date's
  Kuwait day (`core.ts:42`); the Request Type value by id or orderindex
  (`:41`, `:47`); the comment by id and exact text (`:49-50`). The card field
  writes of "Log a call" use `fieldMatches`, which compares the exact
  millisecond value (`:41`, `:46`).
- **Receipts.** `cockpit_csm_actions` (request id, actor, state) and
  `cockpit_csm_provider_health` (`index.ts:66-80`). Any failure after the
  receipt row is `reconcile`, and the same request id is refused after that.
- **The provider allows only `GET` and `POST`** (`tools.ts:2`), so it cannot
  set status or assignees (`PUT task/{id}`).
- **Finding: "Log a call" fails in production.** Both call rows (2026-10-14,
  card `86eypmbp3`; 2026-10-17, card `86ex4m5ux`) are `reconcile` with "Client
  field read-back did not match". Both field POSTs answered 200 (R,
  `cockpit_csm_provider_health`). Today both cards hold 06:00 Kuwait in Last
  POC and Last Check-in Call where the cockpit sent 09:00 Kuwait
  (`1791946800000` vs `1791957600000`, `1792206000000` vs `1792216800000`; R,
  VPS `GET task`). The 10-17 read-back ran one second after the writes. So
  ClickUp stores a date-only value at its own hour, the read-back fails, the
  CSM sees an error for a write that landed, and `logCall` never writes the
  call-history row (`csmCalls.ts:305-318`). Not verified: what ClickUp's
  normalising hour depends on (sampled due dates sit at 04:00 or 06:00 Kuwait,
  R). Outside this map's scope to fix; named for the CSM build.

---

## 5. `cockpit-creative-api` fenced plans

### 5.1 How a plan runs

`prepareOutbox` builds a plan with GETs only (`blueprint.ts:19`, `:159`);
`runClientAction` fences it (client, task, actor, payload, source task),
re-checks the fence before every non-GET call, journals in
`cockpit_media_actions`, claims `pending → sending`, runs `executePlan`, and
settles `done` or `reconcile` (`outbox.ts:51-91`). `executePlan` checks an
optional precondition by GET, writes, then reads back by `verifyPath` with
`expected` and `has` (`execute.ts:11-37`). A ClickUp comment is confirmed by
id and exact `comment_text` (`execute.ts:24`).

### 5.2 Create from a template (Blueprint part 1)

`blueprint.ts:87-91`, in order:

1. `POST list/901816723196/taskTemplate/t-86ex8xaf1` with `{name}`; the id is
   taken from the top or from `task.id` (`idFrom`, `core.ts` Plan comment);
   read back by `GET task/{id}`: name and list.
2. `POST task/{id}/tag/{tag}`; read back: `tags` has the name.
3. `PUT task/{id}` with `assignees.add` and `due_date`, `due_date_time:
   false`; read back: `due_date` equals the exact ms (09:00 Kuwait,
   `blueprintBrief.ts:292`), and `assignees` has the id.
4. The brief as a comment.

`assertSafe` limits a task PUT to `assignees`, `due_date`, `due_date_time`
and `status` (`blueprint.ts:65-72`). Settings check the assignee is a member
of the list (`blueprint.ts:85`).

### 5.3 Risk for Stage 1

Step 3 compares `due_date` by the exact millisecond. Section 4 shows ClickUp
re-times a date-only custom field value. If it does the same for a task due
date with `due_date_time: false`, the first real "Send to media" creates the
launch task and then lands in `reconcile`. The same comparison is in
`outbox.ts:17` (video and script requests) and `outbox.ts:27` (schedule).
**Not verified for task due dates**: no press has run (0 outbox rows), and the
sampled due dates (04:00 or 06:00 Kuwait on all five department lists, 46
tasks, R) have unknown writers. The proof run (PLAN 1.6) shows it; the
Stage 1 session should compare by Kuwait day before then.

---

## 6. `cockpit-media-api` offboarding ticket

`offboardTask` (`clientLifecycle.ts:35-49`) is the only writer that sets
Request Type **in the create body** (`custom_fields`). Its type, Client
Offboarding Request 🔴, has no folder rule (CT F2), so nothing moves it. It
lands on Operations / Tech, whose list rule assigns only on "moved here" (CT
F3), so it is created with no owner and `task-assignment-alerts` posts
nothing. Never used (0 holds).

---

## 7. ClickUp API facts the writer needs

| Action | Endpoint and body | Answer | Source | Checked here |
|---|---|---|---|---|
| Create a task | `POST list/{list_id}/task` with `name`, `markdown_content` (the example uses `markdown_description`), `assignees` (ids), `tags` (names), `status`, `priority`, `due_date` (ms), `due_date_time`, `notify_all`, `custom_fields: [{id, value}]` | the task, with `id` and `url` | DOC Create Task | `markdown_description` works: R, `z8xmdvjzb7` |
| Create from a template | `POST list/{list_id}/taskTemplate/{template_id}` with `{name}` only | "type: object"; where the id sits is not documented | DOC Create Task From Template | not run; `blueprint.ts:87` expects top or `task.id` |
| List template objects | `GET team/90182518398/taskTemplate?page=n` | `{templates: [{id, name}]}`; 34 objects, id and name only | R, VPS GET | yes, 34, same ids as CT F2 |
| Update a task | `PUT task/{task_id}`: `name`, `description`, `markdown_content`, `status`, `priority`, `due_date`, `due_date_time`, `assignees: {add, rem}`, `watchers`, `archived`; **no custom fields** | the task | DOC Update Task | not run |
| Set a custom field | `POST task/{task_id}/field/{field_id}`; dropdown `{value: option uuid}`; date `{value: ms, value_options: {time: true}}` to show a time; people `{value: {add, rem}}`; 400 when the field does not apply to the task type | `{}` | DOC Set Custom Field Value | dropdown writes work (2 happiness acts confirmed, R) |
| Date-only values | not documented | ClickUp stored 06:00 Kuwait for a 09:00 Kuwait write | DOC silent; R | yes, 2 of 2 |
| Add a tag | `POST task/{task_id}/tag/{tag_name}`, no body | n/a | DOC Add Tag To Task | whether a missing tag is created: not documented, not run |
| Add a checklist | `POST task/{task_id}/checklist` with `{name}` | `{checklist: {id, task_id, name, orderindex, resolved, unresolved, items}}` | DOC Create Checklist | not run |
| Add a checklist item | `POST checklist/{checklist_id}/checklist_item` with `{name, assignee?}` | `{checklist: {… items: [{id, name, orderindex, assignee, resolved, parent, date_created}]}}` | DOC Create Checklist Item | not run |
| Tick or untick an item | `PUT checklist/{checklist_id}/checklist_item/{item_id}` with `{resolved: true \| false}` (also `name`, `assignee`, `parent`) | `{checklist: {…}}` | DOC Edit Checklist Item | not run |
| Read checklists | `GET task/{id}`: `checklists[].items[]` with `id`, `name`, `resolved`, `orderindex`, `date_created` | | R, MCP `get_task 86eytarzg` | yes |
| Comment | `POST task/{task_id}/comment` with `comment_text`, `notify_all` (required), `assignee?` | `{id (string), hist_id, date}` | DOC Create Task Comment | yes, 7 link comments delivered |
| Read comments | `GET task/{task_id}/comment`: 25 newest, newest first; older pages by `start` (the last comment's `date`) and `start_id` | | DOC Get Task Comments | yes |
| Change status | `PUT task/{id}` with `{status: name}`; take the list's status of type `done` | | DOC Update Task; `outbox.ts:29` | statuses read (below) |
| Priority values | `priority` integer; the reference gives no mapping; its example shows id `3` = normal. Mapping 1 urgent, 2 high, 3 normal, 4 low is ClickUp's convention, not stated on the page | | DOC Update Task | not verified |
| Rate limit | 100 requests a minute per token (Business), 429 with `X-RateLimit-Reset` | | DOC Rate limits | plan not read |

Statuses (R, VPS `GET list/{id}`): Operations / Tech, Marketing / ADs, Call
Center, Client Success and All Tasks have `to do` (open), `in progress`,
`review required`, `pending`, `complete` (done), `cancelled` (closed).
Media/Creative has `done footage pending` in place of `pending`. "Mark done"
is `complete` on all six today; the writer reads it per list, never
`cancelled`. No list has a list owner.

---

## 8. Does setting Request Type fire the folder rules?

What is known:

| Fact | Source |
|---|---|
| The 26 folder rules all trigger on "a task is created" with a Request Type condition, and move, template and rename | CT F2 (Automations manager) |
| ClickUp's "Task Created" trigger can be limited to tasks created from a Template, an Automation, a Form or a User; "default selects all" | ClickUp changelog "New Automation Trigger Options for 'Task Created'" |
| Whether these 26 rules are limited to Form submits | not read; the rule editor was not opened (CT F12) |
| Template source tasks carry no custom field values, so a task made from a template starts with no Request Type | CT F4 |
| `86eyvmpxj`: created by the API user on 2026-09-09 on Form Migration Test (in the folder) with Request Type General Tech Request; `date_updated` equals `date_created`; still on that list, same name, no checklist. Folder rule #4 (General Tech Request: move, rename) did not act on it | R, MCP and VPS `GET task` |
| The 7 cockpit tickets, created with no Request Type, kept their list and name; those on Media/Creative got the creative strategist within a second | R, VPS `GET task` |
| No cockpit write has ever set Request Type after creating a task | R, SQL on `progress`; W4 and W6 never ran |
| "Custom Field changes that occur when a template is applied won't trigger any Automations" | ClickUp help "Use Custom Fields in Automations", quoted in a search result; the page returned 403 to a direct read |

Reading: a field set after creation should not match a "task created"
trigger, and one API create with the field already set did not fire rule
#4. That is one observation, not proof, and ClickUp may evaluate a "task
created" condition a moment after the create. **Not verified.**

Rule for the writer: never put Request Type in the create body. Set it as the
last step, on its own, only for a type whose `set_request_type` flag the
rehearsal ticket for that list has cleared (PLAN 3.3 Folder rules, C3). Two
minutes later, read list, name and checklist count again; if any changed,
record it, put nothing back, turn the flag off for that type with an audit
row, and keep the type in Supabase.

## 9. List rules that act on a cockpit write

| List | Rule (CT F3) | Effect on a task the cockpit creates there |
|---|---|---|
| Operations / Tech | assigns the systems manager when a task is **moved** here | none: the cockpit sets the owner itself (`z8xmdvjzb7` is unassigned, R) |
| Marketing / ADs | add assignees when **moved** here; two rules on list field `09abf737` | none for the owner; never write `09abf737` |
| Client Success | "a task is created": add **and remove** assignees (names not shown) | may remove the owner the cockpit set: re-read at 2 minutes |
| Call Center | "a task is created": add assignees ("Assign CCM") | may add someone: re-read at 2 minutes |
| Media/Creative | shortcut: always assign the creative strategist when a task moves here | fires on create too (5 of 5 cockpit tickets, R); a different owner may be replaced (not verified) |
| WhatsApp Reconnection | status change with a filled reconnect link calls a webhook | a "Mark done" there may call it: keep the list off the task-action allow-list |
| Clients - Mahara | "when comment is added, send webhook", failing on every run listed 10-20 to 10-25 | every link comment on a client card fires it (noise, no harm seen) |

Once a task has an owner on a department list, `hermes/task-assignment-alerts`
posts it in that department's channel (CT §3 step 5). Setting the owner is
what makes the Slack alert happen.

---

## 10. Recommendation: one writer for requests and task actions

### 10.1 The choice

**`clickup-writeback`, a new job `requests`, two new kinds in the same queue:
`request` (create one ticket part) and `task_action` (tick, untick, comment,
mark done).**

Why this one:

- It is the only writer with live delivery (7 of 7 tickets delivered) and it
  already has what the others lack: an outbox with a unique dedupe key, steps
  frozen before the first write, progress per step, a reference marker in
  every comment and created task, read-back before any retry, a retry ladder,
  run rows, an audit trigger, a doctor and a guardian freshness line (sections
  3.1 to 3.3). PLAN 4.2 and D19 already name it the ClickUp writer for forms,
  requests and task actions.
- The browser never waits on ClickUp, so a slow ClickUp, a 429 or a closed tab
  cannot lose a request. The direct writers turn every ambiguity into
  `reconcile` for a person (W4, W6, W7).
- Its provider takes any method (`tools.ts:6`, media), so `PUT` for status,
  owner and checklist items works; `cockpit-csm-api`'s provider allows only
  `GET` and `POST`.

What it borrows from `executePlan`: a precondition read before a write that
could overwrite a person's change, and a read-back after each write, not only
on resume.

### 10.2 Kinds, payloads and dedupe keys

| Kind | One row per | Dedupe key | Enqueued by | Payload (frozen into steps on first claim) |
|---|---|---|---|---|
| `request` | task part of a request (a two-task type is two rows) | `request:{cockpit_requests.id}:{part}` with `part` = `main`, `tech` or `media` | the gated submit RPC, in the same transaction as the request row; plus a sweep at each `requests` run for any request with no row | list id, template object id or none, name, description lines, client card id and tag, owner ClickUp id, due day, priority, Request Type option id and label, `set_request_type` flag, SOP steps when there is no template, `sop_url`, requester seat |
| `task_action` | one press in the focus view | `task:{browser request uuid}`; a second insert with the same uuid and different content is refused, as `cockpit_creative_client_action` does (`20260927s…sql:78-81`) | the gated action RPC | task id, list id, action (`tick`, `untick`, `comment`, `done`), checklist id and item id with the name and state the person saw, comment text, the status the person saw, actor seat and ClickUp user id |

`source_exists` at claim (`20261009f…sql:296-299`) gains `request` (the request
row exists and is not cancelled) and `task_action` (the action row exists).

### 10.3 The switch and the canary

- **`CLICKUP_WRITEBACK_APPLY_REQUESTS`**, exactly `"true"`, read by a new
  `requestsGate()` on the `kpiGate()` pattern (`run.ts:78-87`). It opens only
  `request` and `task_action`. `CLICKUP_WRITEBACK_APPLY` does not open them,
  and `APPLY_REQUESTS` does not open billing, decisions, changes, provider
  actions, the tracking backlog, Do's & Don'ts or the KPI columns. Tests as
  `run.test.ts:78-102`: every other switch value leaves both kinds in
  `dry_run`, and `APPLY_REQUESTS` alone leaves a billing item in `dry_run`.
- **`CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS`** (comma-separated client card
  ids): while set, a `request` is live only when its client card is listed,
  and a `task_action` only when its task's client card is listed. First value:
  the internal test card `86eywg1cq` for the five `[TEST]` tickets (PLAN 3.3,
  C3). `CLICKUP_WRITEBACK_ONLY_TASKS` stays for APPLY and KPI only.
- A dry run records the plan on the row (`planned`) and in the run, as today.
  Rows held as `dry_run` are requeued by the operator `UPDATE` with a fresh
  plan, never replayed.
- Separately, for the billing build: add the real `CLICKUP_WRITEBACK_APPLY_BILLING`
  that PLAN 3.1 and C1 assume, in the same gate change, so that turning the
  general switch on later cannot push billing.
- The CSM tickets switch keeps serving `decision` rows until the "Ask a team"
  panel writes requests; then `csmTicketSteps` serves only rows already
  queued.

### 10.4 Order, lanes and speed

- **Own job, own cron.** `requests` runs every minute
  (`mahara-clickup-writeback-requests`), claims only its two kinds (the claim
  gains a `p_kinds text[]` filter), and keeps its own run rows and health key
  `clickup-writeback:requests`. A slow `log` or `kpi` run never delays a tick.
- **One lane per task.** The claim skips a row while an earlier row for the
  same task id (or, for a request, the same request) is not settled
  (`queued`, `sending`, `retry`, `unknown`). A late retry can then never
  overwrite a newer press.
- **Kick after save.** The action RPC may queue one `net.http_post` to the
  function with the vault secret, so a press is tried within seconds instead
  of at the next minute. pg_net queues the request in a table, so a save that
  rolls back sends nothing (pg_net design; not tested here). The browser shows
  "Saving to ClickUp" until the row reads `delivered`, through a gated read.
- **Pace.** All jobs share one token's 100 a minute. The `requests` job paces
  at 40 a minute by default; the KPI run at :05 already uses much of a minute
  (about 15 cards, 28 runs since 10-24).

### 10.5 The read-back rule for each step

Every write step records `started` before the call and `done` with the ids it
learned after the read-back, as `executeItem` does. A step whose result is
unknown is read back before anything is written again. A step that finds
ClickUp already in the wanted state records `unchanged` and writes nothing.

**Ticket (`request`), in this order:**

| # | Step | Write | Read-back after the write | On resume (started, not done) |
|---|---|---|---|---|
| 1 | Create | No template: `POST list/{L}/task` with name, `markdown_description` (request lines, `sop_url`, client card link, marker), client tag (only if it exists in the space tag list), priority, `due_date` + `due_date_time: false`, `status: "to do"`, `assignees: [owner]`. With a template: `POST list/{L}/taskTemplate/{T}` with `{name}` | Id from the top or `task.id`; `GET task/{id}`: list id equals L, name equals the name sent | Search `list/{L}/task?order_by=created&include_closed=true&date_created_gt={started − 60 s}` for the marker (no template) or the exact name (template). One match: adopt it. Two or more: `unknown`, reconcile by a person. None after 5 minutes: create again |
| 2 | Description (template only) | `GET task/{id}?include_markdown_description=true`, then `PUT task/{id}` with `markdown_content` = the template's own text plus the request lines and marker, so the template's SOP text is kept | The description contains the marker and still starts with the template's text | The marker is there: done |
| 3 | Owner, due, priority (template only; in the create body otherwise) | `PUT task/{id}` with `assignees: {add: [owner], rem: []}`, `due_date`, `due_date_time: false`, `priority` | `assignees` has the owner; the due date's **Kuwait calendar day** equals the wanted day (never the ms, section 4); priority name equals the wanted one | Read; write only what differs |
| 4 | SOP checklist (only when the type has no template; never both) | `POST task/{id}/checklist` `{name: "SOP"}`, then one `POST checklist/{cid}/checklist_item` per step in order | Answer has `checklist.id`; `GET task/{id}`: a checklist with that id and name, items with the step names in order | Adopt a checklist with the exact name and `date_created` ≥ started − 60 s (two: reconcile); add only the step names it lacks |
| 5 | Tag (template only) | `POST task/{id}/tag/{tag}` when the tag exists in the space | `tags` has the name, compared in lower case (as `execute.ts:31`) | Read |
| 6 | Request Type, last, only when the type's `set_request_type` is on | Check that the pinned option id still exists on `e9fd8024` and its name, with spaces collapsed and trimmed, equals the row's label; else refuse with "ClickUp renamed this request type". Then `POST task/{id}/field/e9fd8024…` `{value: option id}` | The field value is the option id (or its orderindex, as `core.ts:41`) | Read; write only if empty |
| 7 | Link comment on the client card | `POST task/{card}/comment` "Cockpit · {seat} asked {list}: {type}\n{task url}\n\nCockpit ref …", `notify_all: false` | The answer's `id`; `GET task/{card}/comment` has that id and its text contains the marker (not an exact-text match; the exact match passed for the two happiness comments, R, but was never tried on a text with a URL) | Page back with `start` and `start_id` until the comments are older than started − 60 s; adopt the one with the marker |
| 8 | Settle | `delivered`, the task id and url on the request row | | |
| 9 | Two-minute check (a follow-up `task_action` of kind `verify`, due 2 minutes later) | none | `GET task/{id}`: list, name, owner, checklist count. Owner missing: put it back once with `assignees.add` and read again; gone again: `failed` with "A ClickUp rule on {list} keeps removing the owner." and a health line. List or name changed after step 6: section 8 rule | n/a |

**Task actions (`task_action`):**

Before any write, the writer reads `GET task/{id}` and checks: the task is on
a list in the allow-list (the five department lists, All Tasks and the lists
the alerts backend mirrors; not WhatsApp Reconnection), and the actor's
ClickUp user id is still an assignee, or the actor is the requester, an admin
seat or the CEO. A seat maps to a ClickUp user by email from the workspace
members; `cockpit_members` and `cockpit_people` hold no ClickUp id (R,
`information_schema`). A failed check is `skipped` with a plain sentence
("This task is no longer yours in ClickUp. Open it there.").

| Action | Precondition (from the same GET) | Write | Read-back |
|---|---|---|---|
| Tick / untick | The item id is in that checklist, its name equals what the person saw, and `resolved` equals the "from" state. Already in the "to" state: `unchanged`. Name differs or the item is gone: `skipped`, "ClickUp changed this step. Open the task there." | `PUT checklist/{cid}/checklist_item/{iid}` `{resolved}` | `GET task/{id}`: that item's `resolved` equals the wanted state |
| Comment | none | `POST task/{id}/comment` "{first name} ({seat}) in the cockpit: {text}\n\nCockpit ref …", `notify_all: false`. Every write shows as the CEO's API user (CT §4), so the author is in the text | The answer's `id`; the comment list has that id and the marker. Resume: page back for the marker, as step 7 |
| Mark done | The status equals what the person saw. Already a `done` type: `unchanged`. Otherwise changed: `skipped`, "Someone moved this task in ClickUp. Open it there." | Read the list's statuses, take the one of type `done` (`complete` today); `PUT task/{id}` `{status}` | `GET task/{id}`: `status.status` equals it and its type is `done` |

The alerts reader learns the real author of a cockpit comment or close from
the queue row (task id, comment id in `progress`) or the marker, so it can
alert the assignee and skip the person who pressed.

### 10.6 What the other writers become

| Writer | Becomes |
|---|---|
| W1 CSM "Ask a team" (queue, `decision`) | The panel writes a request with the client prefilled (PLAN 3.3 Where); the `decision` ticket branch keeps only rows already queued |
| W2 media buyer reroute | writes a request; until then it stays under the general switch, as today |
| W4 client page "Add a task" and W5 board levers (`core.ts` ticket branch) | write requests; remove the ticket branch from `core.ts:34-38`, `:47`. 0 uses, so nothing to migrate |
| W5 CSM daily plan items | out of scope; they are personal to-dos, not requests |
| W6 media buyer offboarding | writes request type 10 (two parts, Tech and Media, PLAN 3.3) instead of `offboardTask`; 0 uses |
| W7 creative outbox `comment`, `complete`, `schedule` | superseded by `task_action`; 0 uses. `videoRequest` and `planScript` stay until the request types cover them |
| W8 Blueprint presses | stay in `cockpit-creative-api` (D9); fix the exact-ms due-date read-back first (5.3) |
| `rules.ts:59-66` and `convex/writeback.ts:136-141` | the request-type row pins the option id; delete the fixed map |

### 10.7 Discipline

- **Ledger:** every call through `cockpit-media-api/tools.ts` into
  `cockpit_media_provider_health` with `action_id` = the row id, as today.
- **Audit:** the queue's own trigger records state changes as
  `clickup-writeback`; the submit and action RPCs write their own
  `cockpit_audit_log` row with the real seat, gate first, `SECURITY DEFINER
  SET search_path = ''`, in the same migration as the CHECK change, the grant
  and `NOTIFY pgrst`.
- **Doctor:** the three switches and the canary list by name and mode; every
  template object in the request types exists with a matching name (34 today);
  every pinned Request Type option exists with a matching normalised name;
  every owner email resolves to a ClickUp member and is a member of the target
  list; each allow-listed list has a `done` status.
- **Guardian:** a queue row in `hermes/cockpit-guardian/checks/queues.py` for
  kinds `request` and `task_action` in `queued`, `sending`, `retry` or
  `unknown` over 10 minutes, and any `failed` in a day (the `Queue` class
  already has `status_col`, `kind_col` and `kinds`, `queues.py:51`, `:90-112`).
  Today no guardian row watches this queue; only the `log` freshness line does
  (`checks/sections.py:106`).
- **Runbook row:** dry run, the canary, how to read an `unknown`, how to
  requeue a `failed` row with a fresh plan.
- **Missing is never zero:** a request shows "Not in ClickUp yet: {reason}"
  until `delivered`; an owner a rule removed shows "No owner in ClickUp".

---

## 11. Not verified

- The current values of the switches themselves; they are inferred from run
  modes (3.4).
- Whether creating a task, with or without Request Type, from the API or from
  a template, fires the 26 folder rules; and whether those rules are limited to
  Form submits (section 8).
- The response shape of Create Task From Template, whether it copies the
  template's checklists and subtasks when called through the API, and whether
  that happens at once (DOC silent; 0 Blueprint presses).
- Whether ClickUp re-times a task `due_date` sent with `due_date_time:
  false`, as it did for the date custom fields (5.3).
- What decides ClickUp's normalising hour (04:00 or 06:00 Kuwait seen).
- Whether `POST task/{id}/tag/{name}` creates a missing space tag.
- Whether a comment `comment_text` with a URL reads back unchanged.
- Who the "add assignees" rules on Client Success, Call Center and Marketing /
  ADs pick, and whether the Media/Creative shortcut replaces an owner the
  cockpit sets (CT F12).
- The workspace plan (rate limit) and whether the Edge Functions and the VPS
  workers share one ClickUp token.
- The deployed `clickup-writeback` code against the repo (not compared; the
  live SQL functions were checked: the sweep includes CSM tickets and
  `forms.publish`).
- The priority integer mapping beyond the docs example (3 = normal).
- Whether pg_net from a user's RPC is acceptable for the kick (10.4).

## 12. Sources

Code (worktree at `86ee4e84`):
`supabase/functions/clickup-writeback/{index,run,queue,rules,billing}.ts`;
`supabase/functions/cockpit-csm-api/{core,index,tools}.ts`;
`supabase/functions/cockpit-creative-api/{blueprint,outbox,index}.ts`;
`supabase/functions/cockpit-media-api/{execute,tools,core,clientLifecycle,launchDesk}.ts`;
`supabase/functions/cockpit-board-api/lever.ts`;
`supabase/migrations/20261009f_clickup_writeback_native.sql`,
`20261009j_billing_clickup_writeback.sql`, `20261012a_csm_ticket_writeback.sql`,
`20260927s_creative_read_models.sql`;
`apps/client-success-cockpit/src/{lib/useCsmSnapshot.ts,lib/csmActionClient.ts,lib/performance.ts,lib/csmCalls.ts,pages/CsmPage.tsx,pages/ClientPerformancePage.tsx}`;
`apps/client-success-cockpit/scripts/csm-act-route.test.ts`;
`apps/client-success-cockpit/src/present/blueprintBrief.ts:13-14, 283-293`;
`apps/media-buyer-cockpit/convex/writeback.ts:130-141`;
`hermes/cockpit-guardian/checks/{queues,sections,pg_cron}.py`.

Supabase reads (R, 2026-10-26): `cockpit_clickup_writeback_queue` by kind
and state, by `progress`; `cockpit_clickup_writeback_runs` by job and mode;
`cockpit_sync_state` keys `clickup-writeback:%`; `cron.job`;
`pg_get_functiondef` of the live sweep; `pg_constraint` kind CHECK;
`cockpit_csm_actions`; `cockpit_csm_provider_health` for the two reconciled
calls; `cockpit_creative_outbox`; `cockpit_board_levers`;
`information_schema` for `cockpit_members` and `cockpit_people`.

ClickUp reads (R): MCP `get_custom_fields folder 901812879297`; MCP
`get_task` `86eyvmpxj`, `86eytarzg`, `z8xmdvjzb7`; VPS `GET task/{id}` for
the 7 cockpit tickets, `86eyvmpxj`, `86eypmbp3`, `86ex4m5ux`; `GET
list/{id}/field` and `GET list/{id}` on six lists; `GET
list/{id}/task` (due-date sample, 46 tasks on four lists); `GET
team/90182518398/taskTemplate` pages 0 to 4.

ClickUp docs (DOC): developer.clickup.com reference pages Create Task, Create
Task From Template, Update Task, Set Custom Field Value, Add Tag To Task,
Create Checklist, Create Checklist Item, Edit Checklist Item, Create Task
Comment, Get Task Comments, and docs/rate-limits; feedback.clickup.com
changelog "New Automation Trigger Options for 'Task Created'"; help.clickup.com
"Use Custom Fields in Automations" (search result only, 403 on read).
