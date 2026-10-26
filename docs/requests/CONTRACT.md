# Requests and task alerts: the build contract

Binding for five builders working in parallel: **db**, **writer**,
**mirror-alerts**, **portal-screens**, **cockpit-screens**. Written
2026-10-26 in worktree `forms-1025` (branch `tickets-1026` from main
`86ee4e84`) from `docs/forms/PLAN.md` (D12, D17, D18, D19, sections 3.3 and
4.8), `docs/forms/maps/clickup-ticketing.md` (CT, with its Follow-up) and the
four maps in `docs/requests/maps/` (TS types-and-sops, AT alerts-and-tasks, TD
today-and-shell, WR writers). Every table, column, function, file and line
named here was checked against the repo and, read only, against the live
database and ClickUp on 2026-10-26 (section 10). Where this contract differs
from the plan or a map, this contract wins; each difference is in section 11.

The CEO's three asks this build answers:

1. Ticketing for the whole team, routed correctly, each ticket a ClickUp task
   built from its SOP template (D12, D18).
2. An alerts bell for every seat and a short "Your tasks" card on every Today,
   with a focus view for one task (D19).
3. Forms and routing edited in the cockpit by the systems manager, the CEO or
   anyone given the right, never by a code change (D17).

How to use it:

- Build only the files your role owns (section 8). If you need a change in a
  file you do not own, stop and report it.
- The interfaces between roles are the SQL signatures and JSON shapes in
  sections 2 and 3, the queue payloads in 2.6 and 4, the HTTP bodies in 5,
  and the component props in 6. Build to them exactly. If one is impossible,
  stop and report.
- Nothing is deployed: no migration apply, no function deploy, no
  `scripts/ship.sh`, no Vercel, no VPS, no ClickUp, Slack, Make, Typeform or
  GoHighLevel call, no git commit, push, reset, stash or branch change.
  Supabase reads only, through
  `~/.cache/mahara-ship/pybin/python ~/.cache/mahara-ship/sq.py "<select>"`.
  Never print a secret. Disk is tight (about 4 GB): no new worktree, no
  install, delete scratch files you make.

Global rules every role checks (repo `CLAUDE.md`, PLAN 4.5):

- Tables: row security on; `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`;
  then grant `service_role` exactly what this contract says, in the same file.
- Functions: `SECURITY DEFINER SET search_path = ''`, every name
  schema-qualified, the gate first, then
  `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated, service_role`
  and exactly the grant named here. "Internal" means no grant at all.
- One `public.cockpit_audit_log` row per write (columns `action, entity_type,
  entity_id, actor_email, source_app, source_system, before, after,
  metadata`), by the function or a trigger. `source_app = 'shared-cockpits'`;
  `source_system = 'supabase'` for a browser call and `'cron'` for a service
  call (set `cockpit.audit_source` as `20261025n` does). The task mirror is a
  cache of ClickUp, not a write by a person: it leaves one audit row per run,
  not per task (section 3.5).
- Migrations: `BEGIN; ... NOTIFY pgrst, 'reload schema'; COMMIT;`, apply twice
  without error (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF
  EXISTS`, `ON CONFLICT DO NOTHING`, constraints changed inside `DO` blocks
  that read `pg_constraint`). pg_cron, pg_net and the vault only inside
  guarded blocks (`to_regclass('cron.job')`, `to_regclass('vault.decrypted_secrets')`,
  a `pg_proc` check for `net.http_post`), as `cockpit_slack_notices_kick()`
  in `20261025n_slack_notices.sql:2066-2130` does, so PGlite applies the files.
- Every external call goes through `providerTools` in
  `supabase/functions/cockpit-media-api/tools.ts` and lands in
  `cockpit_media_provider_health` (`action_id uuid`, no foreign key).
- Missing is never zero: an empty or failed state says what it is and what
  to do next. Copy is plain and active, sentence case, no exclamation marks,
  no em dashes, no emoji, Kuwait time. Staff are named by role in everything
  the team sees; only an editor's person picker shows a first name.
- Kuwait day: `(now() AT TIME ZONE 'Asia/Kuwait')::date`. Working days are
  Sunday to Thursday.

---

## 0. Decisions on one screen

| # | Decision | Why |
|---|---|---|
| R1 | Three migrations: `20261026r_requests.sql` (db), `20261026s_request_types_seed.sql` (db, generated), `20261026t_task_alerts.sql` (mirror-alerts). Applied in that order. | Names sort after every file in the repo and in other worktrees (`20261026n`, `20261026u_upsell_catalog.sql` in another worktree); none exists live. Splitting the SQL lets two builders work at once |
| R2 | One request table pair: `cockpit_requests` (one row per request, the requester's seat) and `cockpit_request_parts` (one row per ClickUp task; two-task types have two). | PLAN 3.3 "two tasks"; owners and status are per task |
| R3 | The 31 types live in `cockpit_request_types`, seeded from `docs/requests/request-types.json` (built for this contract from TS section 4, the folder fields and the template listing read today). Editors change any type; they cannot add or delete one (a type is a ClickUp Request Type option). | D17, D18 |
| R4 | **The writer is `clickup-writeback`, job `requests`**, two new queue kinds `request` and `task_action`, its own switch **`CLICKUP_WRITEBACK_APPLY_REQUESTS`** (exactly `"true"`, default off) and canary **`CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS`** (rehearsal value `86eywg1cq`). The general switch does not open these kinds and this switch opens nothing else. | WR 10: the only writer that ever delivered a ticket; outbox, frozen steps, read-back, ledger |
| R5 | The old `log` claim stops taking the new kinds in the same migration that adds them; the requests job has its own claim with one lane per task. | Otherwise the deployed `log` job would claim rows it cannot build |
| R6 | While the writer is not live, `/requests` does not take requests from the team: the form says so and points to the ClickUp form. Editors may still send (their rows become dry runs, or go live for the canary card). | Dry-run queue rows are never claimed again (WR 3.2); a request must never sit silently unsent |
| R7 | Owner rules: the systems manager, the creative strategist and the media buyer of record take the named person first; the client's CSM takes the card's CSM first. Every rule falls back to the systems manager with a visible note; nobody is ever assigned in silence. | TS finding 6 (no media buyer of record today), CT F3 |
| R8 | Request Type is written last and only where `set_request_type` is on. It is on at seed for the 11 types that have no folder rule (nothing can fire) and off for the 20 that have one, until the `[TEST]` rehearsal clears them. The 2-minute check turns it off by itself if ClickUp moved or renamed the task. | WR 8, CT F2 |
| R9 | One task mirror for every seat, in Supabase, filled by a new Edge Function `cockpit-tasks` (verify_jwt off): a workspace delta every 2 minutes, a full per-seat read, members, fields and templates every hour, and the live focus-view read. It also mirrors request status and imports the old form's unrouted tickets from All Tasks. | AT 8.1 option B; one mirror serves "Your tasks" and "My requests" |
| R10 | Alerts are rows in `cockpit_task_alerts`, made in SQL from mirror changes, comment reads, a daily due check and request outcomes. **No Slack DM in this build**: the rules table carries `slack_dm` (held false by a CHECK) for the later slice. | The ask is in-cockpit alerts "same as the media buyer"; `task-assignment-alerts` already posts every assignment with a mention; a DM kind would rewrite the Stage 1 claim and sender that went live today, before their proof run; no DM receipt exists for the bot yet (AT 8.6) |
| R11 | Seats link to ClickUp users in `cockpit_member_clickup`: by exact unique email each hour, or set by an editor. An unlinked seat sees "not linked", never zero. | AT 4, TD 5 |
| R12 | One shared component set of 11 files, byte-identical in all five apps and pinned in `scripts/check-shared.sh`; one adapter `src/lib/taskSeat.ts` per app. | TD 6 |
| R13 | `/requests` and `/requests/settings` live in the portal. "Ask a team" in every rail opens `${portal}/requests`. The CSM client page embeds the same `RequestForm` with the client fixed. "See all" and the focus view open in place, never navigating away. | PLAN 3.3, TD 8 |
| R14 | Converted now: the CSM "Ask a team" select and the team choices of "Add a task" (both write requests). Left as they are: the media buyer reroute (all dry run), the media buyer offboarding task (never used), the Card declined form, `cockpit-csm-api` personal reminders. | Only the CSM path is live (7 delivered); the others move no traffic (WR 1) |

---

## 1. The migrations

| Order | File | Owner | Holds |
|---|---|---|---|
| 1 | `supabase/migrations/20261026r_requests.sql` | db | Field catalog, template cache, request types and versions, ClickUp members and seat links, requests and parts, the writeback queue changes (kinds, runs, claims, part sync trigger), the writer's mode, every request RPC, the requests kick and cron |
| 2 | `supabase/migrations/20261026s_request_types_seed.sql` | db | Generated: 24 catalog fields, 34 template objects, 31 types and their version 1 rows |
| 3 | `supabase/migrations/20261026t_task_alerts.sql` | mirror-alerts | Task mirror, alerts, alert rules, the mirror and alert RPCs, the request status mirror and request alerts, task actions, the mirror kicks and crons |

Checked today: no `cockpit_request*`, `cockpit_task_*`, `cockpit_member_clickup`
or `cockpit_clickup_members` relation or function exists live (`to_regclass`,
`pg_proc`), and none is named in `apps/*/src`, `supabase`, `hermes` or
`scripts` (one old line in `scripts/generate_contract_matrix.py:175` names a
Convex-era `cockpit_requests` queue; it is not a table).

Vault and function secrets are never in a migration (section 12). Until they
exist, a kick records "missing" in `public.cockpit_sync_state` and posts
nothing.

---

## 2. Migration r: requests core (db)

### 2.1 Constants (SQL, internal function `public.cockpit_request_lists()` returning jsonb)

| list_id | team | team label (as ClickUp names it) | Target? |
|---|---|---|---|
| `901816723190` | `tech` | Operations / Tech | yes |
| `901816723196` | `ads` | Marketing / ADs | yes |
| `901816723206` | `call_center` | Call Center | yes |
| `901816723211` | `client_success` | Client Success | yes |
| `901818016338` | `creative` | Media/Creative | yes |
| `901816723226` | `all_tasks` | All Tasks | imports only |

Other ids used: workspace `90182518398`, folder `901812879297`, space
`901810248115`, Request Type folder field `e9fd8024-8abe-4094-ac08-e6c0e736ad7e`,
client cards `901816559981`, Video Pipeline `901816720767`, test card
`86eywg1cq`, the API user `284616470`. Never write the Marketing / ADs list
field `09abf737-302f-422a-9d17-8fb9619903d1` or Type of Submission
`d3ac52c5-b71c-4782-9fea-1f9371cbae47` (CT F3).

Role to team (internal `public.cockpit_request_teams(p_roles text[], p_ceo boolean) returns text[]`):
`csm` gives `client_success` and `call_center`; `media_buyer` gives `ads`;
`creative` gives `creative`; `call_center` gives `call_center`; `admin`
gives `tech`; the CEO gets every team. `editor` and `sales` get none.

### 2.2 Tables

All `public.`, row security on, revoked from the four roles, then
`GRANT SELECT ON ... TO service_role` only (every write goes through the
definer functions). No deletes: a `BEFORE DELETE` and `BEFORE TRUNCATE`
trigger refuses on `cockpit_request_types`, `cockpit_request_type_versions`,
`cockpit_requests`, `cockpit_request_parts` ("A request is never deleted.
Cancel it instead." / "A request type is never deleted. Turn it off
instead.").

**`cockpit_request_field_catalog`** (the ClickUp fields a type may use)

| Column | Type | Rule |
|---|---|---|
| `clickup_field_id` | uuid | PK |
| `clickup_name` | text | NOT NULL, as ClickUp names it |
| `kind` | text | NOT NULL, `text`, `longtext`, `url`, `number`, `select` |
| `label` | text | NOT NULL, the cockpit's wording |
| `options` | jsonb | NULL or an array of `{id, name}` (select only) |
| `state` | text | NOT NULL DEFAULT `ok`, `ok` or `missing` (the hourly read no longer finds it) |
| `read_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() |

**`cockpit_request_templates`** (ClickUp template objects, id and name only)

`id text PK CHECK (id ~ '^t-[a-z0-9]{6,20}$')`, `name text NOT NULL`,
`state text NOT NULL DEFAULT 'ok' CHECK (state IN ('ok','missing'))`,
`seen_at timestamptz NOT NULL`.

**`cockpit_request_types`**

| Column | Type | Rule |
|---|---|---|
| `key` | text | PK, `^[a-z][a-z0-9_]{2,40}$` |
| `type_index` | smallint | NOT NULL UNIQUE, 0 to 99 (ClickUp's option order) |
| `label` | text | NOT NULL, 3 to 80 chars, the cockpit's wording |
| `clickup_option_name` | text | NOT NULL, the option's name exactly as ClickUp holds it (stray spaces kept) |
| `request_type_option_id` | uuid | NOT NULL UNIQUE |
| `team` | text | NOT NULL, the team of the first target (kept equal by the guard) |
| `targets` | jsonb | NOT NULL, array of Target (below), 1 to 3 |
| `fields` | jsonb | NOT NULL, array of Field (below), 1 to 20 |
| `sop_steps` | jsonb | NULL or an array of 1 to 40 strings, each 1 to 300 chars |
| `sop_steps_state` | text | NOT NULL, `none`, `source`, `draft`, `saved` |
| `sop_url` | text | NULL or `^https://`, at most 500 chars |
| `due_days` | smallint | NOT NULL, 0 to 60 working days |
| `priority` | text | NOT NULL, `urgent`, `high`, `normal`, `low` |
| `set_request_type` | boolean | NOT NULL DEFAULT false |
| `enabled` | boolean | NOT NULL DEFAULT true |
| `version` | integer | NOT NULL DEFAULT 1, at least 1 |
| `updated_by` | text | NOT NULL |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() |

Target: `{part, name_suffix, list_id, team, template_id, template_name,
owner_rule, owner_clickup_id, when}`. `part` is `^[a-z_]{2,20}$` and unique
in the type. `list_id` is one of the five target lists; `team` matches it.
`template_id` is null or `^t-[a-z0-9]{6,20}$`. `owner_rule` is
`systems_manager`, `csm_of_card`, `creative_strategist`,
`media_buyer_of_record` or `person` (then `owner_clickup_id` is required).
`when` is null or `{field_key, options: [option ids]}`, where `field_key`
names a `select` field of the same type.

Field: `{key, label, kind, clickup_field_id, required, options, help}`.
`key` is `^[a-z][a-z0-9_]{1,40}$` and unique. `kind` is `client`,
`details`, `text`, `longtext`, `url`, `number`, `select`, `deadline` or
`priority`. `clickup_field_id` is null (the answer goes to the description
only) or a catalog field whose kind equals this kind. `options` is null, or
for a select with no ClickUp field an array of `{id, name}` with ids
`^[a-z0-9_-]{1,40}$`. `help` is null or at most 140 chars. Every type has
exactly one `deadline` and one `priority` field and at most one `client`
and one `details` field.

A `BEFORE INSERT OR UPDATE` trigger runs internal
`public.cockpit_request_type_problem(p jsonb) returns text` and raises its
sentence (errcode `22023`) when it is not null. It checks every rule above,
plus: a field a target's `when` reads cannot be removed ("The {list} part
uses {field label} to decide when it runs. Change that part first."). It
sets `team` from the first target. It does not check people or templates
against the caches (the seed runs before any cache is filled); the save RPC
does.

**`cockpit_request_type_versions`**: `key text REFERENCES
cockpit_request_types(key)`, `version integer`, `row jsonb NOT NULL` (the
whole type row as saved), `saved_by text NOT NULL`, `saved_at timestamptz
NOT NULL DEFAULT now()`, `note text` (at most 240), PK `(key, version)`.

**`cockpit_clickup_members`** (the workspace members, filled hourly):
`clickup_user_id bigint PK`, `username text`, `email text` (lower case;
never returned to a browser), `active boolean NOT NULL DEFAULT true`,
`seen_at timestamptz NOT NULL`.

**`cockpit_member_clickup`** (a seat's ClickUp user)

| Column | Type | Rule |
|---|---|---|
| `member_id` | uuid | PK, REFERENCES `cockpit_members(id)` ON DELETE CASCADE |
| `clickup_user_id` | bigint | NULL |
| `state` | text | NOT NULL, `ok` (matched by email), `manual` (set by an editor), `not_found`, `ambiguous`, `cleared` (an editor said no link) |
| `matched_by` | text | NOT NULL, `email` or `editor` |
| `note` | text | NULL, at most 240 |
| `checked_at` | timestamptz | NOT NULL DEFAULT now() |
| `updated_by` | text | NOT NULL |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() |

`CHECK ((state IN ('ok','manual')) = (clickup_user_id IS NOT NULL))`. An
audit trigger (`AFTER INSERT OR UPDATE`) writes `member_clickup.linked`
with before and after.

**`cockpit_requests`**

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK; the browser's request id (an import row gets `gen_random_uuid()`) |
| `type_key` | text | NOT NULL REFERENCES `cockpit_request_types(key)` |
| `type_version` | integer | NOT NULL |
| `type_label` | text | NOT NULL (as it was) |
| `requester_member_id` | uuid | NULL REFERENCES `cockpit_members(id)` |
| `requester_email` | text | NULL |
| `requester_label` | text | NOT NULL (`the CSM`; `the old ClickUp form` for an import) |
| `source` | text | NOT NULL, `requests_page`, `client_page`, `import` |
| `client_task_id` | text | NULL, `^[A-Za-z0-9_-]{1,40}$` |
| `client_name` | text | NULL |
| `answers` | jsonb | NOT NULL DEFAULT '{}', an object, at most 32768 bytes |
| `due_on` | date | NULL |
| `priority` | text | NOT NULL, as above |
| `state` | text | NOT NULL, `sending`, `dry_run`, `delivered`, `partial`, `failed`, `cancelled`, `imported`, `routed` |
| `done_at` | timestamptz | NULL; set when every delivered part's ClickUp status type is `done` or `closed` |
| `replaces_task_id` | text | NULL (the All Tasks ticket this request routes) |
| `imported_task_id` | text | NULL UNIQUE |
| `routed_to` | uuid | NULL REFERENCES `cockpit_requests(id)` |
| `cancel_reason` | text | NULL, at most 240 |
| `cancelled_by` | text | NULL |
| `content_hash` | text | NOT NULL, md5 of `type_key|client_task_id|answers::text|due_on|priority|replaces_task_id` |
| `created_at`, `updated_at` | timestamptz | NOT NULL DEFAULT now() |

`CHECK ((source = 'import') = (imported_task_id IS NOT NULL))`,
`CHECK (source = 'import' OR requester_member_id IS NOT NULL)`. Indexes on
`(requester_member_id, created_at DESC)`, `(client_task_id)`,
`(type_key, client_task_id) WHERE state NOT IN ('cancelled','failed','routed') AND done_at IS NULL`.

**`cockpit_request_parts`**

| Column | Type | Rule |
|---|---|---|
| `request_id` | uuid | NOT NULL REFERENCES `cockpit_requests(id)` |
| `part` | text | NOT NULL, `^[a-z_]{2,20}$`; PK `(request_id, part)` |
| `list_id`, `team` | text | NOT NULL |
| `template_id`, `template_name` | text | NULL |
| `task_name` | text | NOT NULL, at most 200 |
| `owner_rule` | text | NOT NULL |
| `owner_clickup_id` | bigint | NULL |
| `owner_how` | text | NOT NULL, `named`, `card`, `rule`, `fallback`, `none`, `import` |
| `owner_label` | text | NOT NULL |
| `owner_note` | text | NULL |
| `queue_id` | uuid | NULL (its `cockpit_clickup_writeback_queue` row) |
| `state` | text | NOT NULL DEFAULT `queued`: the queue's states plus `imported` |
| `error` | text | NULL, at most 500 |
| `clickup_task_id` | text | NULL; UNIQUE where not null |
| `clickup_url` | text | NULL |
| `verify_state` | text | NULL, `kept`, `restored`, `removed`, `moved` |
| `verify_note` | text | NULL |
| `status`, `status_type` | text | NULL (mirrored by migration t) |
| `assignee_ids` | bigint[] | NULL (mirrored) |
| `mirrored_at` | timestamptz | NULL |
| `created_at`, `updated_at` | timestamptz | NOT NULL DEFAULT now() |

### 2.3 The seed (migration s) and the JSON

`docs/requests/request-types.json` is binding data (owner: the
orchestrator). It holds `field_catalog` (24 folder fields with ids, kinds,
labels and option ids, read today with `clickup_get_custom_fields
folder_id=901812879297`) and `types` (31 objects: `type_index`, `key`,
`label`, `clickup_option_name`, `request_type_option_id`, `team`, `targets`,
`fields`, `sop_steps`, `sop_steps_state`, `sop_url`, `due_days`,
`priority`, `set_request_type`, `enabled`, `sources`). `sources` is for
people and is not stored.

`scripts/gen-request-types-seed.ts` (db) reads that JSON and prints the
migration; `supabase/migrations/20261026s_request_types_seed.sql` is its
output, byte for byte. It inserts, all `ON CONFLICT DO NOTHING` so an
editor's change survives a re-apply:

- the 24 catalog rows (`read_at = '2026-10-26'`);
- the 34 template objects read today with `GET team/90182518398/taskTemplate`
  (section 10 lists them; `seen_at = '2026-10-26'`);
- the 31 types with `version 1`, `updated_by 'migration'`;
- 31 `cockpit_request_type_versions` rows (version 1, `saved_by 'migration'`,
  note `Seeded 2026-10-26 from docs/requests/request-types.json`).

What the seed decides (each one an editor can change later):

| Type keys | Decision |
|---|---|
| all 31 | Labels in plain cockpit wording (`client_pause` is "Client pause"); ClickUp's option names stay in `clickup_option_name` |
| `create_ad_account` | three targets `meta`, `tiktok`, `snapchat`, each with `when` on `ads_platform` (option ids `88d55b4b…`, `c115bdfe…`, `97b22a7b…`) |
| `whatsapp_reactivation` | parts `message` (Media/Creative, `t-86exj3g1a`) and `send` (Operations / Tech, `t-86exj3h8f`), TS finding 2 |
| `client_offboarding`, `client_pause`, `client_relaunch` | parts `tech` and `media`, name suffixes " (Tech)" and " (Media)" |
| `low_schedule_rate` | parts `call_center` (when Call Center Issue or Both) and `ads` (when Ads issue or Both) |
| `card_missing` | no template (TS finding 3: it sends the retired card form); 5 draft SOP steps |
| `whatsapp_connection` | template `t-86ex62m1b` plus its 6 source steps, added only when the template gives no checklist (state `source`) |
| `funnel_intent` | template `t-86exj3gk4` (TS) |
| `social_media` | no template; 10 draft steps |
| media buyer of record types (1, 10, 13, 14, 23, 24, 26, 28) | `owner_clickup_id` null: the rule resolves at send time (2.4) |
| `general_tech`, `general_marketing`, `general_csm` | an optional client; "What is needed?" goes to the description |
| `missing_leads`, `whatsapp_connection`, `card_missing` | priority `high`; every other type `normal` |
| due days | 1: missing leads, employee offboarding, WhatsApp connection, card missing. 2: most. 3: ad account, onboarding, privacy policy, company name, funnel intent, low show and low schedule rate. 5: reactivation, DFY and DWY switches. 7: new script. 10: landing page, social media |
| `set_request_type` | on for the 11 types with no folder rule: `employee_offboarding`, `privacy_policy`, `client_offboarding`, `dfy_to_dwy`, `dwy_to_dfy`, `company_name`, `company_address`, `csm_request`, `business_licence`, `ads_request`, `edit_campaign`. Off for the other 20 |
| `sop_steps_state` | `draft` for every drafted list (TS marks them "check with the systems manager"); `source` for WhatsApp connection; `none` where the template carries the steps |

### 2.4 Internal helpers (no grant; definer functions and triggers call them)

| Function | Returns | Does |
|---|---|---|
| `cockpit_request_seat()` | jsonb `{memberId, authUserId, email, roles, label, isCeo, isAdmin, isEditor, clickupUserId, link, teams}` | The active, confirmed seat of `auth.uid()` (the `cockpit_forms_editor_gate()` lookup). `label` is `public.cockpit_slack_notice_role_of(email)`. `isEditor` is true when `cockpit_forms_editor_gate()` passes. `link` is `linked` when `cockpit_member_clickup.state IN ('ok','manual')`, else `not_linked`. Raises `42501` "Sign in with an active seat to use requests." Migration t calls it too |
| `cockpit_request_lists()` | jsonb | 2.1 |
| `cockpit_request_teams(text[], boolean)` | text[] | 2.1 |
| `cockpit_request_owner_label(p_clickup bigint)` | text | `cockpit_clickup_members.email` matched to an active `cockpit_people` row: role `Systems manager` gives "the systems manager", `Creative strategist` "the creative strategist", `Client success manager` "the CSM", `Media buyer` "the media buyer", `Video editor` "a video editor", `CEO` "the CEO"; a seat with no people row: `cockpit_slack_notice_role_of`; unknown: "a ClickUp member" |
| `cockpit_request_person_by_role(p_role text)` | bigint | The ClickUp id whose email equals the one active `cockpit_people` row with that role (exact, case-insensitive), else null |
| `cockpit_request_owner(p_target jsonb, p_client_task text)` | jsonb `{clickupId, how, label, note}` | The owner rules below |
| `cockpit_request_due_default(p_days integer)` | date | Today in Kuwait plus that many Sunday-to-Thursday days (0 is today) |
| `cockpit_request_type_problem(jsonb)` | text | 2.2 |
| `cockpit_request_type_view(t cockpit_request_types, p_editor boolean)` | jsonb | TypeView (2.5) |
| `cockpit_request_plan(p_type cockpit_request_types, p_request uuid, p_client_task text, p_client_name text, p_answers jsonb, p_due date, p_priority text, p_requester_label text, p_replaces text)` | jsonb array | One element per target that runs (its `when` holds): `{part, listId, team, listName, templateId, templateName, stepCount, owner, taskName, payload}`. `payload` is the queue payload of 2.6. Preview and submit both use it, so a preview always matches the send |
| `cockpit_request_refresh(p_request uuid)` | void | Recomputes `state` and `done_at` from the parts (2.7) |
| `cockpit_clickup_requests_mode()` | jsonb `{mode, onlyCards, at, live}` | From `cockpit_sync_state` key `clickup-writeback:requests`, `detail->>'mode'` and `detail->'onlyCards'`. Older than 15 minutes or missing: `mode 'unknown'`, `live false`. `live` is true for `apply` and `apply_limited`. Migration t calls it too |
| `cockpit_request_can_send(p_seat jsonb, p_client_task text)` | text | Null when the seat may send now, else the sentence of 2.8 |
| `cockpit_clickup_requests_kick()` | bigint | 2.9 |

**Owner rules** (`cockpit_request_owner`). `how` and `note` show on the
preview and on every request row.

| Rule | Order | Notes |
|---|---|---|
| `person` | `owner_clickup_id` | `how named` |
| `systems_manager` | `owner_clickup_id`, else the people row `Systems manager` | `named`, `rule` |
| `creative_strategist` | `owner_clickup_id`, else `Creative strategist` | `named`, `rule` |
| `csm_of_card` | the card's CSM: `cockpit_client_onboarding.csm` equal (case-insensitive) to a `cockpit_clickup_members.username` whose email belongs to an active seat with role `csm`; else `owner_clickup_id`; else `Client success manager` | `card` ("The CSM named on the client card."), then `named`, `rule` |
| `media_buyer_of_record` | `owner_clickup_id`, else `cockpit_blueprint_settings` key `launch_assignee` (digits), else the systems manager rule | `named`, `rule`, then `fallback` with note "No media buyer of record is set, so the systems manager gets it. Set one in Requests settings." |
| any rule that finds nobody | the systems manager rule | `fallback`, note "Nobody matched this rule, so the systems manager gets it." |
| the systems manager cannot be found either | none | `none`, note "No owner could be found. The task goes to ClickUp without one; route it there." |

### 2.5 Browser RPCs (`GRANT EXECUTE ... TO authenticated`; gate first)

Shapes (camelCase keys, ISO times, Kuwait `YYYY-MM-DD` days):

```
TypeView = {key, label, team, teamLabel, enabled, dueDays, dueDefault, priority,
  fields: [{key, label, kind, required, options: [{id,name}] | null, help}],
  parts: [{part, listName, teamLabel, ruleLabel, templateName, stepCount, stepsDraft}],
  sopUrl}
  + for editors: {version, typeIndex, clickupOptionName, targets, sopSteps, sopStepsState,
                  setRequestType, updatedByLabel, updatedAt,
                  fieldSpecs: [{key, label, kind, clickup_field_id, required, options, help}]}
                  (fieldSpecs is the stored `fields`, so the editor keeps each ClickUp field id)
  ruleLabel: "the systems manager" | "the client's CSM" | "the creative strategist"
             | "the media buyer of record" | the person's role label
  stepCount: sop_steps length when the part has no template (else null)

PartRow = {part, listName, teamLabel, taskName, owner: {label, how, note}, state, error,
  url, status, statusType, verifyState, verifyNote}

RequestRow = {id, typeKey, typeLabel, team, teamLabel, clientTaskId, clientName,
  requesterLabel, mine, dueOn, priority, state, done, createdAt, source,
  canCancel, canRoute, parts: [PartRow]}
```

A select field's `options` come from the catalog when it has a ClickUp
field; a catalog field in state `missing` is returned with `options: []`
and the form says "This choice could not be read from ClickUp. Ask the
systems manager."

| Function | Gate | Returns and rules |
|---|---|---|
| `cockpit_request_types_read()` | any active seat | `{asOf, seat: {label, link, teams, editor, all}, writer: {mode, canSend, note}, types: [TypeView]}`, and for editors only `catalog: [{clickupFieldId, clickupName, label, kind, options, state}]` and `templates: [{id, name, state}]` (the field catalog and the template cache the type editor picks from). Non-editors get enabled types only; the form offers enabled types only, to editors too. `all` is true for an editor, an admin or the CEO. Order: team (Client Success, Operations / Tech, Marketing / ADs, Media/Creative, Call Center), then `type_index` |
| `cockpit_request_clients(p_search text DEFAULT NULL, p_include_stopped boolean DEFAULT false)` | any active seat | `{clients: [{taskId, name, status}], more}` (`more` is true when over 30 cards match): `cockpit_client_onboarding` rows where `cockpit_client_allowed(client_name)`, name `ILIKE '%'||search||'%'`, Stopped and GHOSTED left out unless asked, ordered by name, 30 at most |
| `cockpit_request_preview(p_type_key text, p_client_task_id text DEFAULT NULL, p_answers jsonb DEFAULT '{}')` | any active seat | `{parts: [{part, listName, teamLabel, taskName, templateName, stepCount, stepsDraft, owner}], note, dueDefault, writer: {canSend, note}}`. When no target runs yet (its `when` field is unanswered), `parts` is empty and `note` is "Pick {field label} to see where it goes." Writes nothing |
| `cockpit_request_submit(p_request_id uuid, p_type_key text, p_client_task_id text, p_answers jsonb, p_due_on date, p_priority text, p_source text, p_replaces_task_id text DEFAULT NULL)` | any active seat, then `cockpit_request_can_send` | See below. Returns `{id, state, reused, duplicateOf, note, parts: [PartRow]}` |
| `cockpit_request_cancel(p_request_id uuid, p_reason text)` | the requester, an editor, an admin or the CEO | Refused once any part is `sending`, `delivered` or `unknown`: "Part of this request is already in ClickUp. Close it there." Otherwise every part's queue row in `queued`, `retry` or `dry_run` goes to `skipped` with "Cancelled in the cockpit.", the parts to `skipped`, the request to `cancelled`; audit `request.cancelled`. Returns RequestRow |
| `cockpit_requests_read(p_view text, p_limit integer DEFAULT 50)` | any active seat; `all` needs editor, admin or CEO | `{asOf, view, views: [{key, label, count}], rows: [RequestRow], note}`. `mine`: requester is the seat. `assigned`: a part whose `owner_clickup_id` or mirrored `assignee_ids` holds the seat's ClickUp id, request not done or cancelled (an unlinked seat gets no rows and the note "Your seat is not linked to a ClickUp user, so requests assigned to you cannot show. Ask the systems manager to link it."). `team`: the type's team or a part's team is one of the seat's teams, not done or cancelled, imports included (an import's part sits on All Tasks, so its type's team decides). `all`: everything. Open first (not done, not cancelled), then `due_on` ascending with nulls last, then newest. `p_limit` 1 to 200. `views` lists only the views the seat has: `mine` "My requests", `assigned` "Assigned to me", `team` "{team label} queue" (one label per team; two teams read "Team queue"), `all` "All requests" |
| `cockpit_request_get(p_request_id uuid)` | the requester, an owner or assignee of a part, a seat whose teams hold the type's or a part's team, an editor, an admin, the CEO | RequestRow plus `{answers: [{key, label, display}], details, replacesTaskId, routedTo, history: [{at, what, byLabel}]}` from this request's audit rows |
| `cockpit_request_type_save(p_key text, p_patch jsonb, p_expected_version integer)` | `cockpit_forms_editor_gate()` | Allowed patch keys: `label`, `targets`, `fields`, `sop_steps`, `sop_url`, `due_days`, `priority`, `set_request_type`, `enabled`; any other key refuses. A version other than the current refuses: "Someone saved this type since you opened it. Reload to see their change." A named person must be an active row of `cockpit_clickup_members`: "That person is not in the ClickUp workspace. Pick someone from the list." A template must be a `cockpit_request_templates` row in state `ok`: "That template is not in ClickUp any more. Pick another." Saving `sop_steps` sets `sop_steps_state = 'saved'`. Bumps `version`, inserts a versions row (note `Saved`), audit `request_type.saved` with the whole old and new rows. Returns TypeView (editor) |
| `cockpit_request_type_versions(p_key text)` | editor gate | `{versions: [{version, savedAt, savedByLabel, note}]}` newest first |
| `cockpit_request_type_restore(p_key text, p_version integer, p_expected_version integer)` | editor gate | Writes that version's row back as a new version (note `Back to version {n}`), same checks and audit (`request_type.restored`). Returns TypeView |
| `cockpit_request_people()` | editor gate | `{people: [{clickupUserId, label, seat: {memberId, label} or null}]}` from active `cockpit_clickup_members`; `label` is the username for an editor's picker |
| `cockpit_member_clickup_read()` | editor gate | `{readAt, seats: [{memberId, label, roles, link: {state, clickupUserId, username, matchedBy, note, checkedAt} or null}], members: [{clickupUserId, username, linkedTo}]}`; active seats only; `label` is "first name, role" (`cockpit_slack_notice_seat_label`) |
| `cockpit_member_clickup_set(p_member_id uuid, p_clickup_user_id bigint)` | editor gate | Null clears (`state 'cleared'`, never relinked by email). Otherwise the id must be an active member: `state 'manual'`, `matched_by 'editor'`. Returns the seat row of `_read` |

**`cockpit_request_submit` in order:**

1. Seat; `cockpit_request_can_send(seat, p_client_task_id)` raises its
   sentence (errcode `55000`) when not null.
2. `p_source` is `requests_page` or `client_page`. The type exists and is
   enabled ("This request type is turned off. Pick another or ask the
   systems manager.").
3. Idempotency: a row with this id and the same `content_hash` and
   requester returns it with `reused: true`; a different hash refuses
   "This request was already sent with other answers. Reload the form and
   send again."
4. Client: required when the type's client field is required. When given,
   the card exists in `cockpit_client_onboarding` and
   `cockpit_client_allowed(client_name)` ("You cannot raise a request for
   this client."). `p_answers` never holds `client`, `deadline` or
   `priority`.
5. Answers: each required field present; `text` at most 500 chars,
   `longtext` and `details` at most 4000, `url` `^https?://`, `number` an
   integer 0 to 1000, `select` an option id of that field. The first problem
   raises "{label}: {what is wrong}." (`22023`).
6. At least one target runs; else "Pick {field label} first." (`22023`). Due: `p_due_on` or the default; not before today in Kuwait ("Pick today
   or a later day."), at most 365 days ahead. Priority: `p_priority` or the
   type's.
7. One open lifecycle request per card: for `client_offboarding`,
   `client_pause` and `client_relaunch`, an open request (not cancelled,
   failed or routed, `done_at` null, created in the last 60 days) for the
   same card and type returns `{state: 'duplicate', duplicateOf, note: "An
   open {type} request for {client} already exists. Open it instead."}` and
   writes nothing.
8. Replaces: `p_replaces_task_id` must be an import row's task id still in
   state `imported` ("That old ticket was already routed."); that row moves
   to `routed`, `routed_to` set.
9. Insert the request, its parts (`cockpit_request_plan`) and one queue row
   per part: `kind 'request'`, `dedupe_key 'request:{id}:{part}'`,
   `source_table 'cockpit_requests'`, `source_id` = the request id,
   `campaign_name` null, `payload` (2.6); store `queue_id` on the part.
   `state` starts `sending`. Audit `request.submitted` (metadata: type,
   parts, owners' labels).
10. Kick: `PERFORM public.cockpit_clickup_requests_kick()` inside
    `BEGIN ... EXCEPTION WHEN OTHERS THEN NULL; END` (a failed kick never
    fails a request; the cron picks it up within a minute).

### 2.6 The writeback queue changes and the `request` payload

In a `DO` block reading `pg_constraint`:

- `cockpit_clickup_writeback_queue_kind_check` becomes `kind IN
  ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action')`.
- `cockpit_clickup_writeback_runs_job_check` becomes `job IN
  ('kpi','log','dosdonts','requests')`.
- `cockpit_clickup_writeback_begin(text,text,boolean)` and
  `cockpit_clickup_writeback_idle(text,boolean,text)`: `CREATE OR REPLACE`
  from the live definitions (read today with `pg_get_functiondef`) with
  `'requests'` added to their job lists; nothing else changes.
- `cockpit_clickup_writeback_claim(uuid,integer)`: the live body with one
  change, `AND q.kind NOT IN ('request','task_action')` in its `picked`
  query. The deployed `log` job then never sees the new kinds.

New service RPCs (`GRANT EXECUTE ... TO service_role` only):

| Function | Does |
|---|---|
| `cockpit_clickup_writeback_claim_requests(p_token uuid, p_limit integer DEFAULT 6) returns jsonb` | The live claim's shape, for kinds `request` and `task_action` only, limit 1 to 10. One lane per task: a row whose `task_id` is not null is skipped while an older row with the same `task_id` is `queued`, `sending`, `retry` or `unknown`, except a 2-minute check (`op 'verify'`) that is not due yet (section 13). `source_exists`: `request` when the request exists and is not `cancelled`; `task_action` true |
| `cockpit_request_sweep() returns integer` | Inserts the missing queue row for any part in `queued` with no `queue_id` (the second source) |
| `cockpit_clickup_requests_state(p_ok boolean, p_note text, p_mode text, p_only_cards text[], p_counts jsonb) returns void` | Upserts `cockpit_sync_state` key `clickup-writeback:requests` (`last_ok_at` only when ok; `detail = {mode, onlyCards, counts, at}`). Every run of the job calls it |
| `cockpit_request_doctor_inputs() returns jsonb` | `{types: [{key, optionId, optionName, setRequestType, targets: [{part, listId, templateId, ownerClickupId}], fieldIds}], templates: [{id, name}], lists}` |
| `cockpit_request_type_rt_off(p_key text, p_note text) returns void` | `set_request_type = false`, version plus one, versions row (`saved_by 'clickup-writeback'`, note), audit `request_type.request_type_off` |
| `cockpit_clickup_members_sync(p_members jsonb) returns jsonb` | Upserts `cockpit_clickup_members` from `[{id, username, email}]` (members not in the list become `active false`). Then for every active seat without a `manual` or `cleared` row: one active member with the same lower-case email gives `ok`, none `not_found`, more than one `ambiguous`. Returns `{members, linked, notFound, ambiguous}` |
| `cockpit_request_field_catalog_sync(p_fields jsonb) returns jsonb` | From `GET list/901816723190/field` (`[{id, name, type, options}]`): updates `clickup_name`, `options` and `read_at` of catalog rows, marks catalog rows absent from the read `missing` (rows come back to `ok` when seen). Adds no new row. Returns `{updated, missing}` |
| `cockpit_request_templates_sync(p_templates jsonb) returns jsonb` | Upserts `[{id, name}]`; rows absent become `missing`. Returns `{seen, missing}` |
| `cockpit_request_import(p_tasks jsonb) returns jsonb` | Section 2.10 |

**`request` payload** (frozen into the row; the writer never reads the type
table):

```json
{
  "requestId": "uuid", "part": "tech", "ref": "R-1a2b3c4d5e-tech",
  "typeKey": "client_pause", "typeLabel": "Client pause", "typeVersion": 1,
  "requestTypeOptionId": "196991a9-dac9-4da8-a693-6b6d64372be5",
  "requestTypeOptionName": "Client Pause Request ⏸️",
  "setRequestType": false,
  "listId": "901816723190", "listName": "Operations / Tech",
  "templateId": "t-86ex63qk5", "templateName": "Client Pause ⏸️ (Tech)",
  "taskName": "Acme Interiors - Client pause (Tech)",
  "descriptionMarkdown": "…",
  "sopSteps": null, "sopChecklistName": null, "sopStepsWhen": null,
  "clientTaskId": "86ex4m5ux", "clientName": "Acme Interiors", "clientTag": "acme interiors",
  "ownerClickupId": 113459516, "ownerLabel": "the systems manager",
  "dueOn": "2026-10-28", "dueMs": 1793178000000,
  "priority": "normal", "priorityValue": 3,
  "fields": [{"fieldId": "uuid", "kind": "select", "value": "option id", "label": "Ad platform", "display": "Facebook/Meta"}],
  "replacesTaskId": null,
  "requesterLabel": "the CSM",
  "requestUrl": "https://cockpit.maharamedia.com/requests?id=<uuid>"
}
```

- `ref`: `R-` plus the first 10 hex characters of the request id without
  dashes, `-`, the part.
- `taskName`: `{client} - {label}{name_suffix}`; with no client
  `{label}{name_suffix} - from {requester label}`; cut to 200 chars.
- `descriptionMarkdown` (no marker; the writer appends it):

  ```
  **{label}** for {client, or "no client"}
  Requested by {requester label} in the cockpit on {Sun 26 Oct}. Due {Wed 28 Oct}. Priority {normal}.

  {details, when given}

  - {field label}: {display}        (every answered field except client, details, deadline, priority)

  SOP: {sop_url}                    (when set)
  SOP steps are a draft until the systems manager checks them.   (when sop_steps_state is draft and steps are added)
  Client card: https://app.clickup.com/t/{card}                  (when a client)
  Request in the cockpit: {requestUrl}
  ```
- `sopSteps`, `sopChecklistName`, `sopStepsWhen`: with no template and
  steps, `sopStepsWhen 'always'`; with a template and steps (WhatsApp
  connection), `'if_template_empty'`; otherwise null. The checklist is
  named "SOP steps", or "SOP steps (draft)" while the state is `draft`.
- `clientTag`: the client name in lower case (the writer adds it only when
  the space has that tag).
- `dueMs`: 12:00 Kuwait (09:00 UTC) of `dueOn`, so ClickUp's re-timing of a
  date-only value stays on the same Kuwait day (WR 4).
- `priorityValue`: urgent 1, high 2, normal 3, low 4.
- `fields`: one per answered field with a `clickup_field_id`; `value` is
  the option id for a select, the number for a number, else the text.
- `replacesTaskId`: only on the first part.

### 2.7 Triggers

- `cockpit_request_queue_sync()`, `AFTER UPDATE OF state, task_id, progress
  ON cockpit_clickup_writeback_queue FOR EACH ROW WHEN (NEW.kind IN
  ('request','task_action'))`:
  - `request`: the part `(payload->>'requestId', payload->>'part')` takes
    `state`, `error`, `clickup_task_id = coalesce(NEW.task_id, …)`,
    `clickup_url = coalesce(NEW.progress->'task'->>'url', …)`. On the move to
    `delivered` it inserts the verify row: `kind 'task_action'`,
    `dedupe_key 'verify:{requestId}:{part}'`, `source_table
    'cockpit_requests'`, `source_id` = the request id, `task_id` = the
    ClickUp task id, `next_attempt_at = now() + interval '2 minutes'`,
    payload `{op: 'verify', requestId, part, taskId, listId, taskName,
    ownerClickupId, typeKey, setRequestType, clientTaskId}`
    (`ON CONFLICT DO NOTHING`). Then `cockpit_request_refresh`.
  - `task_action` with `payload->>'op' = 'verify'`, on `delivered`,
    `failed` or `skipped`: the part's `verify_state =
    NEW.progress->>'verify'`, `verify_note = coalesce(NEW.progress->>'verifyNote', NEW.error)`.
  - No audit here: the queue's own trigger (`20261009f`) records every
    state change but `sending`.
- `cockpit_request_refresh` rules for `state`, in order: `cancelled`,
  `imported` and `routed` stay; every part `delivered` gives `delivered`;
  any part `queued`, `sending`, `retry` or `unknown` gives `sending`; every
  part `dry_run` gives `dry_run`; at least one `delivered` gives `partial`;
  else `failed`. `done_at` is set when every delivered part's mirrored
  `status_type` is `done` or `closed`, and cleared when one reopens.
- `cockpit_request_type_guard` (2.2), the no-delete triggers, the audit
  triggers on `cockpit_member_clickup`.

### 2.8 Who may send, by the writer's mode (`cockpit_request_can_send`)

| Mode | Seat | Answer |
|---|---|---|
| `apply` | any | may send |
| `apply_limited` | editor, admin or CEO, card in `onlyCards` | may send |
| `apply_limited` | editor, admin or CEO, another card or none | "Requests are being tested on the internal test card only. Pick that card, or wait until they open to everyone." |
| `apply_limited` | anyone else | "Requests are being tested. They open to everyone soon. Use the ClickUp request form until then." |
| `dry_run` | editor, admin or CEO | may send (the row becomes a dry run) |
| `dry_run` or `unknown` | anyone else | "Requests are not switched on yet. Use the ClickUp request form until then." |
| `unknown` | editor, admin or CEO | "The requests writer has not reported in the last 15 minutes. Check it on the Machine tab before sending." |

`cockpit_request_types_read` and `_preview` return the same answer as
`writer: {canSend, note}`, so the form says it before anyone types.

### 2.9 The kick and its cron

`public.cockpit_clickup_requests_kick() returns bigint` (internal): the
`cockpit_slack_notices_kick()` pattern. It always posts (each run, idle or
not, refreshes the writer's mode in 2.6's state row):
`net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/clickup-writeback',
body := '{"job":"requests"}', headers := {Content-Type, x-cron-secret},
timeout_milliseconds := 150000)` (clickup-writeback answers when its run ends, as the log job's post waits; section 13) with the secret from vault
`cockpit_sync_secret` (the one `mahara-clickup-writeback-log` uses; the
function keeps `verify_jwt` off). With no vault secret or no pg_net it
writes `cockpit_sync_state` key `clickup-writeback:requests-kick` with
`ok false` and the plain sentence, and returns null. Otherwise that key gets
`ok true`, "Posted a requests run".

```sql
SELECT cron.schedule('mahara-clickup-writeback-requests', '* * * * *',
  $job$SELECT public.cockpit_clickup_requests_kick();$job$);
```
(unschedule by name first, inside the guarded block).

### 2.10 The old form's tickets in All Tasks (`cockpit_request_import`, service)

Input from the hourly read (5.3): `[{taskId, name, url, optionId, tags,
description, dateCreated, priority, dueAt, status, statusType}]`, open tasks
on All Tasks `901816723226` named `Form Submission%` with a Request Type.
For each task not already imported: the type by `request_type_option_id`
(unknown option: skipped with "Unknown request type"), the client by one
tag equal to a card's `lower(client_name)` (else none), `answers =
{details: description cut to 4000}`, `source 'import'`,
`requester_label 'the old ClickUp form'`, `state 'imported'`, one part
`main` on All Tasks with `clickup_task_id`, `owner_how 'import'`,
`owner_label 'Nobody yet'`, `state 'imported'`, the mirrored status. No
queue row. One audit row per run (`request.imported`, the task ids).
Returns `{imported, skipped: [{taskId, why}]}`. A team queue shows it with
"Came in through the old ClickUp form. Make it a request to route it."

### 2.11 Grants (end of migration r)

- Internal: every function in 2.4, the triggers' functions.
- `service_role`: `cockpit_clickup_writeback_claim_requests(uuid,integer)`,
  `cockpit_request_sweep()`, `cockpit_clickup_requests_state(boolean,text,text,text[],jsonb)`,
  `cockpit_request_doctor_inputs()`, `cockpit_request_type_rt_off(text,text)`,
  `cockpit_clickup_members_sync(jsonb)`, `cockpit_request_field_catalog_sync(jsonb)`,
  `cockpit_request_templates_sync(jsonb)`, `cockpit_request_import(jsonb)`;
  the replaced `begin`, `idle` and `claim` keep their live grant (service
  role only).
- `authenticated`: every function in 2.5.

---

## 3. Migration t: the task mirror and alerts (mirror-alerts)

`supabase/migrations/20261026t_task_alerts.sql`. It applies after r and s
and calls their internal `cockpit_request_seat()`,
`cockpit_clickup_requests_mode()`, `cockpit_request_owner_label()`,
`cockpit_request_lists()` and `cockpit_clickup_requests_kick()`.

### 3.1 Tables

Row security on, revoked from the four roles, `GRANT SELECT ... TO service_role`.

**`cockpit_task_mirror`** (one row per ClickUp task a read has seen)

| Column | Type | Rule |
|---|---|---|
| `task_id` | text | PK, `^[A-Za-z0-9_-]{1,40}$` |
| `list_id` | text | NOT NULL |
| `list_name`, `folder_id`, `space_id`, `parent_id` | text | NULL |
| `name` | text | NOT NULL, at most 500 |
| `status`, `status_type` | text | NOT NULL |
| `priority` | text | NULL, `urgent`, `high`, `normal`, `low` |
| `due_at` | timestamptz | NULL |
| `due_on` | date | NULL, the Kuwait day of `due_at` |
| `due_has_time` | boolean | NULL until the focus read fills it (the team endpoint has no `due_date_time`, AT 3) |
| `assignee_ids`, `watcher_ids` | bigint[] | NOT NULL DEFAULT '{}' |
| `creator_id` | bigint | NULL |
| `tags` | text[] | NOT NULL DEFAULT '{}' |
| `client_task_id` | text | NULL: the card itself on `901816559981`; else the part's request card; else one tag equal to a card's `lower(client_name)` |
| `url` | text | NOT NULL |
| `date_created`, `date_updated` | timestamptz | NOT NULL |
| `date_closed` | timestamptz | NULL |
| `archived` | boolean | NOT NULL DEFAULT false |
| `checklist_done`, `checklist_total` | integer | NULL |
| `comments_read_at` | timestamptz | NULL |
| `detail` | jsonb | NULL (the focus read's cache, 3.4) |
| `detail_at` | timestamptz | NULL |
| `first_seen_at`, `seen_at` | timestamptz | NOT NULL DEFAULT now() |
| `gone_at` | timestamptz | NULL (not seen by any read for 7 days) |

Indexes: GIN `(assignee_ids)`, `(date_updated)`, `(list_id)`, `(client_task_id)`.

**`cockpit_task_alerts`** (append-only)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK DEFAULT gen_random_uuid() |
| `member_id` | uuid | NOT NULL REFERENCES `cockpit_members(id)` ON DELETE CASCADE |
| `kind` | text | NOT NULL, `assigned`, `due_today`, `overdue`, `comment`, `mention`, `status`, `request_done`, `request_failed` |
| `dedupe_key` | text | NOT NULL UNIQUE |
| `task_id` | text | NULL |
| `request_id` | uuid | NULL |
| `list_id` | text | NULL |
| `title` | text | NOT NULL, at most 200 |
| `body` | text | NOT NULL, at most 240 |
| `client_name` | text | NULL |
| `actor_label` | text | NULL |
| `at` | timestamptz | NOT NULL (when it happened) |
| `read_at` | timestamptz | NULL |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

A guard trigger allows one update only, `read_at` from null to a time, and
refuses deletes and truncation. Index `(member_id, at DESC)`.

**`cockpit_task_alert_rules`** (one row per seat; absent means the defaults)

| Column | Type | Rule |
|---|---|---|
| `member_id` | uuid | PK REFERENCES `cockpit_members(id)` ON DELETE CASCADE |
| `kinds` | text[] | NOT NULL DEFAULT all eight kinds; `<@` the eight; must hold `request_failed` (a failed request always alerts) |
| `shift_start`, `shift_end` | time | NULL together or set together; null uses `cockpit_people.schedule`, else 10:00 to 18:00 Sunday to Thursday |
| `slack_dm` | boolean | NOT NULL DEFAULT false, `CHECK (slack_dm = false)`: the DM slice lifts it (section 11, R10) |
| `updated_by` | text | NOT NULL |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() |

An audit trigger writes `task_alert_rules.saved` with before and after.

State lives in `cockpit_sync_state`: key `task-mirror:delta` (`detail =
{cursorMs, pages, tasks, comments, alerts, truncated}`) and key
`task-mirror:seats` (`detail = {members, linked, seats, imported,
templates, fields, baselinedAt}`). `baselinedAt` is set by the first `seats`
run that finished every linked seat, and never changes after.

### 3.2 How alerts are made (all in SQL)

No alert before `baselinedAt`. `assigned` and `status` come only from a
`delta` read: the hourly `seat` read and the `detail` read correct the
mirror without alerting, so linking a seat later never floods its bell.
Alerts go only to active seats with a
linked ClickUp id (requests alerts: to the requester's seat, linked or
not), only for kinds in the seat's rules, never for the client cards list
`901816559981` except `mention`, and never to the person who caused the
event when that is known.

| Kind | Made by | When | Dedupe key | Title / body |
|---|---|---|---|---|
| `assigned` | `cockpit_task_mirror_upsert` | A linked seat's id is in the new `assignee_ids` and was not in the old ones; or the row is new to the mirror. Skipped when the seat is the task's creator on a new task, or the seat filed the request that made it | `assigned:{task}:{member}:{date_updated ms}` | task name / "Assigned to you" |
| `status` | `cockpit_task_mirror_upsert` | `status` changed on a task assigned to the seat, unless a `task_action` of that seat on that task settled `delivered` in the last 10 minutes | `status:{task}:{member}:{status}:{date_updated ms}` | task name / "Moved to {status}" |
| `comment` | `cockpit_task_mirror_comments` | A comment newer than the cut-off (below) on a task assigned to the seat, not by the seat. Comments by the API user `284616470` are skipped unless they carry `Cockpit ref T-{hex}` (a teammate's comment from the focus view; the actor is that queue row's seat) | `comment:{comment id}:{member}` | task name / "{actor role} commented" or "A teammate commented" |
| `mention` | `cockpit_task_mirror_comments` | A comment part `{type: 'tag', user.id}` or `assignee.id` equal to the seat's id, on any task, not by the seat. A mention replaces the comment alert for that seat | `mention:{comment id}:{member}` | task name / "{actor role} mentioned you" |
| `due_today` | `cockpit_task_alerts_tick` | Once a Kuwait day, after the seat's shift start, on a working day of the seat, when it has open tasks due today | `due_today:{member}:{day}` | "{n} tasks are due today" (1: "1 task is due today") / "Open Your tasks to see them." (`task_id` null) |
| `overdue` | `cockpit_task_alerts_tick` | After the seat's shift start, for each open task assigned to the seat with `due_on` before today and on or after the later of the baseline's day and the day the seat's link was made | `overdue:{task}:{member}:{due_on}` | task name / "Was due {Sun 26 Oct}" |
| `request_done` | `cockpit_task_mirror_upsert` | A request part's mirrored `status_type` becomes `done` or `closed` | `request_done:{request}:{part}` | "{type label}: {client}" / "Done in ClickUp." or "Closed in ClickUp." |
| `request_failed` | trigger on `cockpit_request_parts` | A part's state becomes `failed` or `skipped` and the request is not cancelled | `request_failed:{request}:{part}` | "{type label}: {client}" / "Did not reach ClickUp: {error}" |

Comment cut-off: `coalesce(comments_read_at, greatest(baselinedAt,
first_seen_at - interval '10 minutes'))`.

Shift start: the rules' `shift_start`; else the seat's `cockpit_people`
row (by email) `schedule->'week'->{sun..sat}` for today, `on` and `start`,
in `schedule->>'timezone'` (default `Asia/Kuwait`); else 10:00 Kuwait on
Sunday to Thursday. A day whose schedule says `on: false`, or a Friday or
Saturday with no schedule, makes no daily alert.

### 3.3 Browser RPCs (`GRANT EXECUTE ... TO authenticated`)

`p_cockpit` is `portal`, `media_buyer`, `csm`, `creative`, `editor` or
`sales`; anything else refuses. Every list leaves out the client cards
`901816559981`; `editor` also leaves out Video Pipeline `901816720767`
(the Jobs page owns it, TD 2.4).

```
TaskRow = {taskId, title, clientName, clientTaskId, listId, listName, status, statusType,
  dueOn, dueAt, dueHasTime, overdue, dueToday, priority, url, createdAt, parentId,
  checklist: {done, total} | null, requestId, requestTypeLabel}
MyTasks = {asOf, sourceAt, ready, link, note, counts: {overdue, today, total}, tasks: [TaskRow], more}
AlertRow = {id, kind, taskId, requestId, title, body, clientName, at, read}
TaskAlerts = {asOf, sourceAt, ready, link, note, unread, alerts: [AlertRow]}
```

| Function | Gate | Rules |
|---|---|---|
| `cockpit_my_tasks(p_cockpit text)` | any active seat | `link 'not_linked'`: `tasks []`, `note` = the not-linked sentence (6.6). Else open tasks (`status_type` not `done` or `closed`, not archived, `gone_at` null) whose `assignee_ids` hold the seat's id, minus a subtask whose parent is also in the set. Order: overdue (`due_on` before today, or `due_has_time` and `due_at` before now) oldest due first; then due today; then everything else newest `date_created` first. At most 200 rows; `more` = the rest. `sourceAt` = `task-mirror:delta` `last_ok_at`; `ready` = that row ok and at most 10 minutes old |
| `cockpit_task_alerts(p_cockpit text)` | any active seat | The seat's alerts of the last 14 days, newest first, at most 50, the cockpit's list filter applied; `unread` counts them unread. `link` and `ready` as above; request alerts show even when not linked |
| `cockpit_task_alerts_seen(p_ids uuid[])` | any active seat | Sets `read_at = now()` on at most 200 of the seat's own unread alerts; one audit row `task_alerts.seen` with the count and ids. Returns `{ok, marked}` |
| `cockpit_task_detail(p_task_id text)` | the seat's id is an assignee or watcher, or the seat filed a request whose part is this task, or admin or CEO; else `42501` "This task is not assigned to you. Open it in ClickUp." | TaskDetail (below) |
| `cockpit_task_act(p_action_id uuid, p_task_id text, p_op text, p_payload jsonb)` | as `cockpit_task_detail`, plus 3.4 | `{id, state, reused}` |
| `cockpit_task_alert_rules_read(p_member_id uuid DEFAULT NULL)` | own row; another seat's needs `cockpit_forms_editor_gate()` | `{member: {id, label}, rules: {kinds, shiftStart, shiftEnd, slackDm}, shift: {source: 'rules'|'schedule'|'default', start, end, days}, seats: [{memberId, label}] (editors only), canEditOthers}` |
| `cockpit_task_alert_rules_set(p_member_id uuid, p_patch jsonb)` | as read | Keys `kinds`, `shiftStart`, `shiftEnd` (`HH:MM`); `slackDm true` refuses "Slack messages for alerts are not switched on yet. New assignments already post in your team's Slack channel." Returns the read shape |

```
TaskDetail = {asOf,
  task: TaskRow + {description},
  request: {id, typeLabel, requesterLabel, part} | null,
  sopUrl,                                   (the request type's sop_url, when the task came from a request)
  detail: {at, dueHasTime, description, checklists: [{id, name, items: [{id, name, resolved}]}],
           subtasks: [{id, name, status, statusType}],
           comments: [{id, authorLabel, mine, at, text}]} | null,
  detailNote,                               (the sentence when the last live read failed)
  actions: [{id, op, state, error, at, itemId}],   (this task's task_action rows of the last 24 hours, newest first)
  can: {tick, comment, done, why},
  writer: {mode, live}}
```
Comment authors come out as labels at read time
(`cockpit_request_owner_label`; the API user is "the cockpit" unless the
text carries `Cockpit ref T-`, then that seat's role); comment text is cut
to 1000 chars; the newest 10 comments.

### 3.4 Task actions (`cockpit_task_act`)

| Op | `p_payload` | Lists allowed |
|---|---|---|
| `tick`, `untick` | `{checklistId, itemId, itemName, from}` (`from` the resolved state the person saw) | the five department lists and All Tasks |
| `comment` | `{text}` 1 to 2000 chars | any list but the client cards |
| `done` | `{statusSeen}` | the five department lists and All Tasks |

Checks in order, each refusing with its sentence (`55000`):
seat linked, or admin or CEO ("Link your seat to ClickUp to tick, comment
and mark done here. Ask the systems manager."); the task is in the mirror;
the list allows the op ("Ticking and Mark done work on the team request
boards. Open this one in ClickUp." / "This is a client card. Open it in
ClickUp."); `cockpit_clickup_requests_mode()` is `apply`, or
`apply_limited` with the task's `client_task_id` in `onlyCards` ("Changes
from the cockpit are not switched on yet. Open the task in ClickUp.").

Then one queue row: `kind 'task_action'`, `dedupe_key 'task:{p_action_id}'`,
`source_table 'cockpit_task_mirror'`, `source_id` = the task id, `task_id` =
the task id, payload:

```json
{"actionId": "uuid", "ref": "T-1a2b3c4d5e", "op": "tick", "taskId": "…", "listId": "…",
 "clientTaskId": "…", "checklistId": "…", "itemId": "…", "itemName": "…", "from": false, "to": true,
 "text": null, "statusSeen": null,
 "actor": {"memberId": "uuid", "clickupUserId": 113459516, "label": "the systems manager", "isAdmin": false},
 "requesterOfTask": false}
```
`actor.isAdmin` is true for an admin seat or the CEO; `requesterOfTask` is
true when the seat filed the request this task came from.
A repeat with the same id and payload returns it with `reused: true`; a
different payload refuses "This change was already sent. Reload the task."
One audit row `task.act` (`metadata`: op, task id, item id; never the
comment text). Then the kick of 2.9, inside an exception block.

### 3.5 Service RPCs (`GRANT EXECUTE ... TO service_role`)

| Function | Does |
|---|---|
| `cockpit_task_mirror_inputs() returns jsonb` | `{cursorMs, baselinedAt, teamId: '90182518398', linked: [{memberId, clickupUserId}], allTasksList: '901816723226', fieldsList: '901816723190'}` |
| `cockpit_task_mirror_upsert(p_tasks jsonb, p_source text) returns jsonb` | `p_source` is `delta`, `seat` or `detail`; at most 200 rows (MirrorTask, 5.2). Upserts rows (sets `seen_at`, clears `gone_at`), computes `due_on` and `client_task_id`, updates the matching `cockpit_request_parts` (`status`, `status_type`, `assignee_ids`, `mirrored_at`) and calls `cockpit_request_refresh` for them, and makes the 3.2 alerts (none before the baseline). Returns `{upserted, alerts}` |
| `cockpit_task_mirror_seat(p_clickup_user_id bigint, p_task_ids text[]) returns jsonb` | For open mirror rows holding that id but not in `p_task_ids`, removes the id from `assignee_ids` (the next delta has the truth); rows no read has seen for 7 days get `gone_at`. Returns `{removed}` |
| `cockpit_task_mirror_comment_due(p_limit integer) returns jsonb` | Up to `p_limit` (at most 60) `[{taskId, sinceMs}]`: rows updated in the last 24 hours whose `date_updated` is after their cut-off, tasks assigned to a linked seat first, then the rest by `date_updated` |
| `cockpit_task_mirror_comments(p_task_id text, p_comments jsonb) returns jsonb` | `p_comments` = `[{id, authorId, atMs, text, tagIds, assigneeId, parentId}]` (text cut to 1000). Makes 3.2's comment and mention alerts, sets `comments_read_at = now()`. Returns `{alerts}` |
| `cockpit_task_alerts_tick() returns jsonb` | 3.2's `due_today` and `overdue` for every linked seat. Returns `{dueToday, overdue}` |
| `cockpit_task_detail_cache(p_task_id text, p_detail jsonb) returns void` | Stores `{dueHasTime, description (2000 chars), checklists, subtasks, comments: [{id, authorId, atMs, text}], statuses}` with `detail_at = now()`; also refreshes the row's `status`, `status_type`, `due_has_time`, `checklist_done`, `checklist_total` |
| `cockpit_task_mirror_state(p_job text, p_ok boolean, p_note text, p_detail jsonb) returns void` | Upserts `task-mirror:delta` or `task-mirror:seats`; for `seats` with `p_detail->>'complete' = 'true'` sets `baselinedAt` once. One audit row per call, `task_mirror.run` (`metadata` = the counts), `source_system 'cron'` |

### 3.6 Kicks and crons

`public.cockpit_task_mirror_kick(p_job text) returns bigint` (internal),
`p_job` `delta` or `seats`: the 2.9 pattern, posting `{"job": p_job}` to
`https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-tasks` with
`x-cron-secret` from vault `cockpit_tasks_cron_secret`; missing secret or
pg_net: `cockpit_sync_state` key `task-mirror:kick` with the sentence.

```sql
SELECT cron.schedule('mahara-task-mirror', '*/2 * * * *', $job$SELECT public.cockpit_task_mirror_kick('delta');$job$);
SELECT cron.schedule('mahara-task-mirror-seats', '11 * * * *', $job$SELECT public.cockpit_task_mirror_kick('seats');$job$);
```

Grants: internal for the kick, the guard and audit functions and the alert
helpers; `service_role` for 3.5; `authenticated` for 3.3.

---

## 4. The writer: `clickup-writeback`, job `requests` (writer)

### 4.1 Door, switches and pace

- `index.ts` accepts `{"job": "requests"}` and `{"job": "requests_doctor"}`
  beside `kpi`, `log`, `dosdonts`, `doctor`, behind the same `x-cron-secret`.
  The unknown-job sentence lists all six.
- `requestsGate(env)` in `requests.ts`, on the `kpiGate()` pattern:
  `apply = env("CLICKUP_WRITEBACK_APPLY_REQUESTS") === "true"`;
  `onlyCards` from `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS` (comma-separated
  card ids); `mode = !apply ? 'dry_run' : onlyCards.size ? 'apply_limited' : 'apply'`.
  `CLICKUP_WRITEBACK_APPLY`, `_APPLY_CSM_TICKETS`, `_APPLY_KPI` and
  `_ONLY_TASKS` neither open nor narrow it, and it opens nothing else.
- Live: a `request` when `apply` and (no `onlyCards`, or its `clientTaskId`
  is listed); a `task_action` likewise by its `clientTaskId`; a `verify`
  when `apply`.
- Pace: its own pacer, `CLICKUP_REQUESTS_CALLS_PER_MINUTE`, default 120
  (the token's limit read on 2026-10-26 is 1,000 a minute, AT 7.1). Claim
  limit 6 a run.
- `runDoctor` in `run.ts` adds `requestsMode` and the canary list to its
  note.

### 4.2 One run (`runRequests(deps)`)

1. No `CLICKUP_API_TOKEN`: `cockpit_clickup_requests_state(false, NO_TOKEN, mode, …)` and stop.
2. `cockpit_request_sweep()`; claim with
   `cockpit_clickup_writeback_claim_requests(token, 6)`.
3. Nothing claimed: `cockpit_clickup_requests_state(true, "Nothing to write.", mode, onlyCards, {})` and stop.
4. `cockpit_clickup_writeback_begin('requests', mode, false)`; per item,
   `providerFor(item.id)` paced; save through
   `cockpit_clickup_writeback_save` (state, steps, progress, planned,
   task_id, error, next_attempt_at, delivered_at only).
5. `source_exists` false: `skipped`, "The request was cancelled before it
   reached ClickUp."
6. Not live: `dry_run` with `planned` = the steps it would run (no ClickUp
   call in a dry run).
7. Live: run the item (4.3 or 4.4). Outcomes and the retry ladder as
   `runLog` (`RETRY_MINUTES`, 429 is `retry`, 5xx or a timeout is `unknown`
   and read back before any new write, another 4xx is `failed`).
8. `cockpit_clickup_writeback_finish` and
   `cockpit_clickup_requests_state(ok, note, mode, onlyCards, counts)`.
   `ok` is false when any item failed or a secret is missing. Note examples:
   "3 requests delivered, 0 to retry, 0 failed." / "Dry run: 2 requests
   planned. Nothing was written to ClickUp." / "Testing on the canary card:
   1 delivered, 1 held as a dry run."

Progress keys: `progress.steps[<step>] = {state: 'started'|'done'|'unchanged'|'skipped'|'mismatch', at, ids…}`,
`progress.task = {id, url}`, and for a verify `progress.verify`,
`progress.verifyNote`. The writer saves `task_id` as soon as the task id is
known. Every write records `started` before the call and `done` after its
read-back; a step found already in the wanted state records `unchanged`.

### 4.3 A `request` item, step by step

The marker line is `Cockpit ref {payload.ref}`.

| # | Step | Write | Read-back | On resume (started, not done) |
|---|---|---|---|---|
| 1 | `create` | No template: `POST list/{listId}/task` with `name`, `markdown_description` (description plus a blank line and the marker), `assignees: [owner]` when an owner, `priority`, `due_date: dueMs`, `due_date_time: false`, `status: "to do"`, `notify_all: false`; never `custom_fields`. With a template: `POST list/{listId}/taskTemplate/{templateId}` with `{name: taskName}` | Id from the top or `task.id`; `GET task/{id}`: `list.id` equals `listId`, `name` equals `taskName` | `GET list/{listId}/task?order_by=created&include_closed=true&date_created_gt={started - 60 s}`: the marker in `text_content` (no template) or the exact name (template). One: adopt. Two or more: `unknown`, error "Two tasks match this request in ClickUp. Keep one and cancel the other." None after 5 minutes: create again |
| 2 | `description` (template only) | `GET task/{id}?include_markdown_description=true`, then `PUT task/{id}` `{markdown_content: <template text> + "\n\n---\n\n" + description + marker}` | The description holds the marker and still starts with the template's text | The marker is there: `done` |
| 3 | `owner_due_priority` (template only) | `PUT task/{id}` `{assignees: {add: [owner], rem: []}, due_date, due_date_time: false, priority}` | `assignees` has the owner; the Kuwait day of `due_date` equals `dueOn` (never the milliseconds); `priority.priority` is the name sent | Read; write only what differs |
| 4 | `checklist` | When `sopStepsWhen` is `always`, or `if_template_empty` and `GET task/{id}` shows no checklist: `POST task/{id}/checklist` `{name: sopChecklistName}`, then one `POST checklist/{cid}/checklist_item` `{name}` per step, in order | `GET task/{id}`: a checklist with that id and name whose items are the steps in order | Adopt a checklist with that exact name created after `started - 60 s` (two: `unknown`); add only the missing step names |
| 5 | `tag` | When `clientTag` is in `GET space/901810248115/tag` (read once a run, compared in lower case): `POST task/{id}/tag/{tag}` | `tags` holds it (lower case) | Read |
| 6 | `fields` | For each `fields` entry: `POST task/{id}/field/{fieldId}` `{value}` | `GET task/{id}` `custom_fields`: a select by option id or its orderindex, else the exact value | Read; write what differs. A field that will not save is `mismatch` with its label, not a failure: the answer is in the description. The item's note lists them: "Some fields did not save in ClickUp: {labels}. They are in the description." |
| 7 | `request_type` (only when `setRequestType`) | First `GET list/{listId}/field`: the option `requestTypeOptionId` exists on `e9fd8024-…` and its name, trimmed with spaces collapsed, equals `requestTypeOptionName` trimmed and collapsed, else `failed` "ClickUp renamed this request type. Fix it in Requests settings." Then `POST task/{id}/field/e9fd8024-8abe-4094-ac08-e6c0e736ad7e` `{value: option id}` | The value is the option id or its orderindex | Read; write only if empty |
| 8 | `card_comment` (when a client) | `POST task/{clientTaskId}/comment` `{comment_text, notify_all: false}`, text: `Cockpit · {Requester label} asked {listName}: {typeLabel}` newline `{task url}` blank line `Cockpit ref {ref}-card` | The answer's `id`; `GET task/{card}/comment` holds that id and the marker (contains, not equals) | Page back with `start` and `start_id` until older than `started - 60 s`; adopt the comment with the marker |
| 9 | `replaces` (when `replacesTaskId`) | `GET task/{replacesTaskId}`: still on `901816723226` and not closed, else `skipped` with "The old ticket was already moved or closed." Then `POST task/{replacesTaskId}/comment` "Routed in the cockpit as {typeLabel}: {task url}" + marker `-old`, then `PUT task/{replacesTaskId}` `{status: 'cancelled'}` | The comment by id and marker; `status.type` is `closed` | Read |
| 10 | settle | `delivered`, `task_id`, `progress.task = {id, url}`, `delivered_at` | | |

### 4.4 A `task_action` item

Before any write: `GET task/{taskId}` (one read serves the precondition and
later the read-back). The task's list must be one of the five department
lists or All Tasks for `tick`, `untick`, `done`, and not the client cards
for `comment`; and the actor's ClickUp id must still be an assignee or
watcher, or `actor.isAdmin`, or `requesterOfTask`. Otherwise `skipped`:
"This task is no longer yours in ClickUp. Open it there."

| Op | Precondition | Write | Read-back |
|---|---|---|---|
| `tick` / `untick` | The item is in that checklist, its name equals `itemName`, its `resolved` equals `from`. Already `to`: `unchanged`. Name differs or gone: `skipped`, "ClickUp changed this step. Open the task there." | `PUT checklist/{checklistId}/checklist_item/{itemId}` `{resolved: to}` | `GET task/{taskId}`: the item's `resolved` equals `to` |
| `comment` | none | `POST task/{taskId}/comment` `{comment_text: "{Actor label} wrote in the cockpit: {text}\n\nCockpit ref {ref}", notify_all: false}` | The answer's id; the comment list holds it with the marker. Resume as step 8 |
| `done` | `status.status` equals `statusSeen`. Already a `done` type: `unchanged`. Otherwise changed: `skipped`, "Someone moved this task in ClickUp. Open it there." | The list's status whose type is `done` (`GET list/{listId}`, cached for the run; `complete` on all six lists today); `PUT task/{taskId}` `{status}` | `status.status` equals it and `status.type` is `done` |
| `verify` | none | none, or once `PUT task/{taskId}` `{assignees: {add: [owner], rem: []}}` | `GET task/{taskId}`. With no `ownerClickupId`, only the list and name are checked. The owner is there: `verify 'kept'`. Missing: put it back once and read again; there now: `'restored'`; gone again: `failed`, `verify 'removed'`, "A ClickUp rule on {listName} keeps removing the owner." When `setRequestType` was on and the list or the name changed: `verify 'moved'`, call `cockpit_request_type_rt_off(typeKey, "ClickUp moved or renamed {taskName} after its Request Type was set, so Request Type is off for this type.")`, put nothing back. Another person added by a list rule: `verifyNote` "ClickUp also added another person." |

### 4.5 The doctor (`{"job":"requests_doctor"}`)

Reads only. Secrets by name (`CLICKUP_API_TOKEN`, `CRON_SECRET`,
`CLICKUP_WRITEBACK_APPLY_REQUESTS`, `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS`;
present or not, never the value), the mode, then with
`cockpit_request_doctor_inputs()`: every template id in a target is in
`GET team/90182518398/taskTemplate` pages 0 to 5; every option id exists on
`e9fd8024-…` with a matching normalised name; every field id is on
`GET list/901816723190/field`; every named owner is in `GET team` members;
each target list has a status of type `done` (`GET list/{id}`). Writes
`cockpit_sync_state` key `clickup-writeback:requests-doctor` and returns
`{ok, note, problems: [sentence]}`.

### 4.6 What else the writer changes

- `rules.ts:59-66`: "Add qualification questions to the lead form" to
  `7fc82c41-7bcd-47f7-bae0-868d4954495b`; "Switch to a landing page" and
  "Switch this campaign to a landing page" to
  `a2d9483c-2dde-486d-969e-78679e5d27a6` (CT section 7, WR 3.5). The
  Tracking rows stay. `apps/media-buyer-cockpit/convex/writeback.ts` is the
  paused Convex copy and is not touched.
- Nothing in `cockpit-csm-api`, `cockpit-media-api` or
  `cockpit-creative-api` changes in this build.

---

## 5. The mirror: Edge Function `cockpit-tasks` (mirror-alerts)

### 5.1 Door

`verify_jwt` off (as `cockpit-notices`). POST JSON only; CORS as
`cockpit-creative-api/index.ts:9`.

- Cron: `x-cron-secret` equal to `TASKS_CRON_SECRET`, body `{"job":
  "delta" | "seats" | "doctor"}`. Wrong or missing secret: 401 "not allowed".
- Browser: `Authorization: Bearer <user JWT>`, body `{"op": "detail",
  "taskId": "...", "refresh": true|false}`. The function signs the user in
  with `auth.getUser()` (401 "Sign in again" on failure) and calls
  `cockpit_task_detail` **with the user's JWT**, so the database gate
  decides; the service key is used only for `cockpit_task_detail_cache`.

Every ClickUp call goes through `providerTools` with the service-key insert
into `cockpit_media_provider_health` and `action_id` = the run's uuid (a
detail read gets its own uuid); a receipt that cannot be saved stops the
call. Pace `CLICKUP_TASKS_CALLS_PER_MINUTE`, default 120. Only GETs: this
function never writes to ClickUp. Secrets read by name:
`CLICKUP_API_TOKEN`, `TASKS_CRON_SECRET`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### 5.2 `delta` (every 2 minutes)

1. `cockpit_task_mirror_inputs()`. No cursor yet: `now - 24 h`.
2. `GET team/90182518398/task?include_closed=true&subtasks=true&order_by=updated&date_updated_gt={cursorMs - 600000}&page={n}`
   until `last_page` or fewer than 100 tasks, at most 10 pages (over that:
   `truncated: true`, `ok false`, "More than 1,000 tasks changed in one
   read; the next run goes on.").
3. Map each task to MirrorTask and `cockpit_task_mirror_upsert(batch, 'delta')`
   in batches of 100:
   `{taskId, listId, listName, folderId, spaceId, parentId, name, status, statusType, priority, dueAtMs, assigneeIds, watcherIds, creatorId, tags, url, dateCreatedMs, dateUpdatedMs, dateClosedMs, archived, checklistDone, checklistTotal}`
   (`checklistDone`/`Total` from `checklists[].items` when the endpoint
   sends them, else null).
4. `cockpit_task_mirror_comment_due(40)`; for each, `GET task/{id}/comment`
   (newest 25), and `GET comment/{id}/reply` for a comment newer than
   `sinceMs` with `reply_count > 0` (at most 10 reply reads a run); then
   `cockpit_task_mirror_comments(taskId, comments)`.
5. `cockpit_task_alerts_tick()`.
6. `cockpit_task_mirror_state('delta', ok, note, {cursorMs: max date_updated seen, pages, tasks, comments, alerts, truncated})`.
   Note: "Read {n} changed tasks and {m} comment threads; {k} alerts."

### 5.3 `seats` (hourly at :11)

1. `GET team` (the workspace and its members) to
   `cockpit_clickup_members_sync([{id, username, email}])`.
2. `GET list/901816723190/field` to `cockpit_request_field_catalog_sync`.
3. `GET team/90182518398/taskTemplate?page=0..5` to `cockpit_request_templates_sync`.
4. `cockpit_task_mirror_inputs()`; for each linked seat,
   `GET team/90182518398/task?assignees[]={id}&subtasks=true&include_closed=false&page={n}`
   (at most 5 pages), `cockpit_task_mirror_upsert(…, 'seat')`, then
   `cockpit_task_mirror_seat(id, all task ids read)`. A seat whose read
   failed is skipped and named in the note; `complete` is true only when
   every seat finished.
5. `GET list/901816723226/task?include_closed=false&subtasks=false`: tasks
   named `Form Submission%` with a value on `e9fd8024-…` to
   `cockpit_request_import`.
6. `cockpit_task_mirror_state('seats', ok, note, {members, linked, seats, imported, templates, fields, complete})`.

### 5.4 `detail` (the focus view)

1. User-JWT `cockpit_task_detail(taskId)`: refused means 403 with the
   database's sentence.
2. When `refresh`, or `detailAt` is missing or older than 60 seconds:
   `GET task/{id}?include_markdown_description=true&include_subtasks=true`
   and `GET task/{id}/comment`; then `cockpit_task_detail_cache(id, {dueHasTime: due_date_time, description: markdown_description, checklists, subtasks, comments: [{id, authorId: user.id, atMs: date, text: comment_text}], statuses})`
   and `cockpit_task_mirror_upsert([that task], 'detail')`. A ClickUp error
   leaves the cache and returns it with `detailNote` "This task could not
   be read from ClickUp just now. What you see was read at {14:02}."
3. Return user-JWT `cockpit_task_detail(taskId)` again.

### 5.5 `doctor`

Secrets by name, one `GET user` (the token works; reports
`X-RateLimit-Limit`), the members and linked counts, the two state rows.
Returns `{ok, note, secrets, rateLimit, linked, notLinked, lastDelta, lastSeats}`.

---

## 6. Screens

Before writing any screen, each screen builder reads
`~/.cache/mahara-ship/mc/skills/frontend-design/SKILL.md`,
`~/.cache/mahara-ship/skills/hallmark/SKILL.md` and `docs/DESIGN.md` (the
locked system; Hallmark treats it as overriding its own picks). These are
component-scope pieces in Hallmark's terms: every interactive part ships
default, hover, focus-visible, active, disabled, loading, error and success,
and passes the slop test on screenshots at 390, 820 and 1440 in dark before
the build reports done.

### 6.1 The design plan (binding)

- **Subject and job.** A thirteen-person agency team asking each other for
  work and keeping up with their own ClickUp tasks without opening ClickUp.
  The Today card answers "what do I do next"; the bell "what changed for
  me"; the focus view "do this one task"; `/requests` "ask the right team,
  the right way".
- **Tokens.** The cockpit's own only: `--card`, `--border`, `--foreground`,
  `--muted-foreground`, `--background`, `--primary` (Mahara teal, the one
  primary action per view), `--warning` (orange: due today),
  `--destructive` (late, failed), `--success` (done), and
  `var(--primary-ink, var(--primary))` for teal text in light mode
  (`--primary-ink` exists only in client success and creative). No new
  colour, no gradient and no glow (nothing here is the featured live
  element).
- **Type.** Geist. Card titles `15px` semibold, rows `14px`, second lines
  `13px` muted, counts and due words with tabular figures and
  `white-space: nowrap`. Geist Mono only for the "Checked 14:02" timestamp.
  Task and client names in `<bdi dir="auto">` (IBM Plex Sans Arabic follows
  Geist in each app's stack).
- **Layout.** Today card: `rounded-2xl border bg-card`, header row, a flush
  list of at most five one-line rows (44px tall, the whole row is the one
  action), footer "See all {n}" only above five. No buttons on a row, no
  card inside a card, one arrow per link (DESIGN.md "Arrows").
- **Signatures.** Today and the focus view: **the due spine**, a 3px bar on
  a row's left edge, `--destructive` when late, `--warning` when due today,
  none otherwise; it is the media buyer's own `.client-state-spine`
  (`components/launch/launch.css`), reused, not invented. `/requests`:
  **the route line** under the form, before Send, saying exactly where the
  ticket lands: "Goes to Operations / Tech as "Acme - Client pause (Tech)".
  Owner: the systems manager. Uses the ClickUp template Client Pause ⏸️
  (Tech). Due Wed 28 Oct." One line per part. This is the CEO's "routed
  correctly, connected to the SOP template", made visible before anyone
  presses Send.
- **Not too busy.** Five rows; one line per row (title, then client hidden
  below `sm`, then the due word right-aligned); counts beside a title only
  when above zero; explanations longer than two lines fold.

### 6.2 The shared set (11 files, byte-identical in all five apps)

Paths are the same in `apps/media-buyer-cockpit`, `client-success-cockpit`,
`creative-director-cockpit`, `video-editor-cockpit`, `sales-cockpit`. The
copy in `apps/client-success-cockpit` is the master `check-shared.sh`
compares against. They import only `react`, `react-dom`, `react-router`,
`lucide-react` (icons named in TD 3, checked in every app's installed
package before use; use `ExternalLink` where `ArrowUpRight` is missing),
`type SupabaseClient` from `@supabase/supabase-js`, `@/lib/taskSeat`, each
other, and their CSS. No Radix, no sonner, no zod, no Tailwind class that
another app may not generate: styles are classes in the set's CSS files,
prefixed `tk-` and `rq-`.

| File | Owner | Exports and job |
|---|---|---|
| `src/lib/tasksCore.ts` | cockpit-screens | Import-free. The types `TaskRow`, `MyTasks`, `AlertKind`, `AlertRow`, `TaskAlerts`, `TaskDetail` (3.3, exactly); `firstFive(tasks)`; `kuwaitDay(ms)`; `dueWords(row, nowMs) -> {text, tone: 'late'|'today'|'none'}` ("3 days late", "1 day late", "Late, was 14:00", "Today", "Today 15:00", "Thu", "Thu 6 Nov", ""); `alertWords(kind)`; `TASK_SENTENCES` (6.6) |
| `src/lib/tasksClient.ts` | cockpit-screens | `useTaskFeed()` -> `{tasks, alerts, error, refresh(), markRead(ids)}`: one shared poll per tab and client for `cockpit_my_tasks` and `cockpit_task_alerts` (on mount, every 120 s while visible, on focus and visibility, never twice within 30 s; `ClientAlerts.tsx:34-70`); `readTaskDetail(client, taskId, refresh)` through `client.functions.invoke('cockpit-tasks', {body: {op: 'detail', taskId, refresh}})`; `actOnTask(client, {taskId, op, payload})` (a new `crypto.randomUUID()` action id, `rpc('cockpit_task_act')`); `focusSearch(search, taskId | null)` |
| `src/components/tasks/TaskPanel.tsx` | cockpit-screens | `TaskPanel({open, onClose, title, subtitle?, footer?, wide?, children})`: a dependency-free dialog, centred from `sm`, a full-height sheet on a phone, Escape and outside click close, focus kept inside and returned, `aria-modal`, body scroll locked. Built the way `video-editor-cockpit/src/components/ui/dialog.tsx:1-30` is |
| `src/components/tasks/YourTasks.tsx` | cockpit-screens | `YourTasks({id?})`: the Today card. Reads `useTaskFeed()`. Rows open the focus view (`?focus=`). "See all {n}" opens the full list in `TaskPanel` in place |
| `src/components/tasks/AlertsBell.tsx` | cockpit-screens | `AlertsBell({variant: 'row' | 'icon', extra?: ExtraAlerts})`. `row`: a right-aligned outline button "Alerts" plus the unread count (as `.client-alert-bar`). `icon`: a 40px button whose `aria-label` says "Alerts, {n} unread". Opens `TaskPanel` with the list (6.5). `ExtraAlerts = {label, ready, note?, items: ExtraAlert[], markRead(items): Promise<void>}`, `ExtraAlert = {id, version, title, body, clientName?, href, external, read, at?}` |
| `src/components/tasks/TaskFocus.tsx` | cockpit-screens | `TaskFocusHost()`: mounted once per layout; opens when the address has `?focus=<taskId>`, closes on Escape, Back or Close by removing the parameter (replace). The view itself (6.5) |
| `src/components/tasks/tasks.css` | cockpit-screens | `tk-` classes on the tokens of 6.1 only, `var(--primary-ink, var(--primary))` for teal text |
| `src/lib/requestsCore.ts` | portal-screens | Import-free. Types `TypeView`, `FieldView`, `PartRow`, `RequestRow` (2.5, exactly), `RoutePreview` (the answer of `cockpit_request_preview`) and `SubmitResult` (the answer of `cockpit_request_submit`); `validateAnswers(type, answers, clientTaskId, dueOn) -> Record<string, string>` (the same rules and sentences as 2.5 step 5, so the form says them before the server does); `display(field, value)`; `stateWords(row)`, `partWords(part)`, `routeLine(part, dueOn)`; `REQUEST_SENTENCES` (6.6) |
| `src/lib/requestsClient.ts` | portal-screens | `readRequestTypes`, `readRequestClients`, `previewRequest`, `submitRequest`, `cancelRequest`, `readRequests`, `readRequest`: thin wrappers over 2.5 that throw the server's sentence |
| `src/components/tasks/RequestForm.tsx` | portal-screens | `RequestForm({source: 'requests_page' | 'client_page', presetClient?: {taskId, name}, presetType?, presetDetails?, replacesTaskId?, compact?, onSent?(result)})`. Uses `useTaskSeat()`. 6.4 |
| `src/components/tasks/requests.css` | portal-screens | `rq-` classes, same token rule |

Per app, not shared, one file each (cockpit-screens):

`src/lib/taskSeat.ts` exports `useTaskSeat(): {client: SupabaseClient | null, ready, signedIn, cockpit: 'portal'|'csm'|'creative'|'editor'|'sales', portalHref(path), inPortal, toast: {success(m), error(m)}}`.
The portal, client success and creative build it from `useCockpitAuth()`
and `sonner`; the editor and sales from `useWho()`, `lib/supabase`,
`lib/toast` and `lib/portal`. The portal's `portalHref` returns the path
itself; the others `${portalUrl()}${path}`.

And one line in the already pinned `src/lib/cockpits.ts` (all five,
cockpit-screens): `requests: Ticket` in `COCKPIT_ICON`.

`scripts/check-shared.sh` (cockpit-screens) gains one block before the
summary: the 11 files above compared with `cmp -s` from `$CS` to `$MB`,
`$CD`, `$ED`, `$SA` ("DRIFTED  {file}: copy $CS/{file} to {app}/"); both
`tasksCore.ts` and `requestsCore.ts` checked import-free; every import line
of the other nine checked against the allow-list above (the `callCentre.ts`
pattern); `src/lib/taskSeat.ts` present in all five.

### 6.3 Per-app wiring (cockpit-screens)

Line numbers are today's (TD 2 and 7); re-read each before editing.

| App | File | Change |
|---|---|---|
| portal | `src/components/AppLayout.tsx:88` | `<ClientAlerts />` becomes `<AlertsBell variant="row" extra={launchNotices} />` on every page in the layout; `<TaskFocusHost />` beside `<CommandPalette />` (110) |
| portal | `src/components/launch/ClientAlerts.tsx` | Becomes `useLaunchNotices(): ExtraAlerts | undefined`: its read of `cockpit_media_client_notices` and `cockpit_media_notices_seen`, for media buyer, admin and CEO seats only (its own role rule; every page, not only the media buyer's). Once the seat's task feed is `linked`, notices of `kind === 'task'` are left out, so a task shows once |
| portal | `src/pages/CockpitPage.tsx` | `<YourTasks id="tasks" />` under `<ExceptionAlerts />` (4086); remove `tasksCard` (2330-2446) and its ask form state; the old `/tasks` redirect to `/dashboard#tasks` keeps working |
| portal | `src/pages/team/TeamPage.tsx` | `<YourTasks />` after the header (157) when the seat has no cockpit of its own (`cockpits.length === 0`) |
| portal | `src/pages/AdminPage.tsx` | `<YourTasks />` after the header (312) |
| portal | `src/components/AppSidebar.tsx` | "Ask a team" `NavLink` to `/requests` after Team meetings (353), every signed-in seat; the same row in the CEO rail's `elsewhere` (174-185) |
| portal | `src/components/MobileTabBar.tsx:152-167` | A "Requests" cell after Team in the non-media-buyer branch (the media buyer reaches it through More) |
| portal | `src/components/CommandPalette.tsx:105-110` | "Ask a team" beside Team meetings, words "request ticket ask tech creative call centre" |
| client success | `src/components/AppLayout.tsx` | Bell `icon` in the slim bar before Search (95); bell `row` at the top of main (after 105), hidden below `lg`; `<TaskFocusHost />` beside `CommandPalette` (111) |
| client success | `src/pages/CsmPage.tsx` | `<YourTasks />` after the tiles (2788). The client page's "Ask a team" block (2303-2340) becomes `<RequestForm source="client_page" presetClient={{taskId, name}} compact />`; `TICKETS` (157-203) and `teamName` go when nothing else reads them. "Tickets raised today" (2832-2895) becomes "Requests you raised today", read with `readRequests(client, 'mine', 50)` filtered to today in Kuwait, each row a status chip and the ClickUp link. "Client Success board" (2952-3005) stays (open decision kept, TD 11.3) |
| client success | `src/pages/ClientPerformancePage.tsx:776-832` | `AddTask` keeps only "Me (Client Success list)": the four team choices go, the heading becomes "A reminder for you", and its toast says "Added to your Client Success list." (the write is immediate, WR 4). Team requests go through the form above |
| client success | `src/components/AppSidebar.tsx:156-170` | "Ask a team" row to `${portal}/requests` after Team meetings (164) |
| client success | `src/pages/NoticesPage.tsx` | One line at the foot: "Ticket routing and alert settings are in Requests settings." linking `${portal}/requests/settings` |
| creative | `src/components/AppLayout.tsx` | Bell `icon` before Search (97); `row` at the top of the content (113), hidden below `lg`; `<TaskFocusHost />` beside `CommandPalette` (130) |
| creative | `src/pages/DashboardPage.tsx` | `<YourTasks />` in `#morning` after the late section (401). Script tickets show here and in "Script requests" (TD 11.4) |
| creative | `src/components/AppSidebar.tsx:165-179` | "Ask a team" row after Team meetings (173) |
| editor | `src/App.tsx` | Bell `icon` in the phone header before Search (241); `row` at the top of `<main>` (252), hidden below `lg`; `<TaskFocusHost />` beside `<SearchBox />` (315) |
| editor | `src/pages/JobsPage.tsx` | `<YourTasks />` after the tally, before the chips (267), list view only; the seat adapter's `cockpit` is `editor`, so Video Pipeline stays on Jobs |
| editor | `src/components/Sidebar.tsx:139-158`, `src/components/SearchBox.tsx:148-176` | "Ask a team" in `footLinks` after Team meetings (150); an "Ask a team" hit beside `page:team` |
| sales | `src/components/MacOSMenuBar.tsx:95-121` | Bell `icon` in the right group before the theme button |
| sales | `src/App.tsx` | Bell `icon` in the phone header's right group (292-314); `<TaskFocusHost />` beside `<SearchBox />` (368) |
| sales | `src/pages/TodayPage.tsx` | `<YourTasks />` at the top of the right column (170) |
| sales | `src/components/Sidebar.tsx:178-202`, `src/components/SearchBox.tsx` | "Ask a team" door after Team meetings (188); an "Ask a team" hit |

The CEO's `/ceo` gets the bell (from the portal layout) and no card. The
media buyer reroute panel (`CockpitPage.tsx:3395-3440`), the Card declined
button and the media buyer's Service tab are not changed (R14).

### 6.4 `/requests` and `/requests/settings` (portal-screens)

Routes in `apps/media-buyer-cockpit/src/auth/authenticated/AuthenticatedAppRoutes.tsx`,
beside `/team` (120) inside the layout and outside every `RoleRoute` (the
database gates): `/requests` -> `pages/requests/RequestsPage.tsx`,
`/requests/settings` -> `pages/requests/RequestsSettings.tsx`.

**`/requests`.** Header "Requests", one muted line "Ask another team for
something. It becomes a ClickUp task with its SOP steps and an owner." A
32px pill row (scrolls sideways on a phone; zero-count pills hide): "Ask a
team" (default) and the `views` the read returns. Address: `?view=ask|mine|assigned|team|all`,
`?id=<request id>` opens one request in `TaskPanel`,
`?type=<key>&client=<taskId>` prefills the form.

- *Ask a team* (`RequestForm`, `max-w-2xl`): 1. "What do you need?": a
  searchable list of the types grouped by team label (`TypeView.team`
  order of 2.5), each row the label and the team. 2. Only that type's
  fields, in order: client picker (search over `cockpit_request_clients`,
  "Show stopped clients" toggle; locked when `presetClient`), text,
  longtext, url, number, select, details. 3. Due (prefilled
  `dueDefault`) and priority (prefilled). 4. The route line
  (`cockpit_request_preview`, re-read when the type, client or a `when`
  field changes). 5. "Send request" (teal). While `writer.canSend` is false
  the form shows `writer.note` in place of the button. After a send: a
  quiet panel "Sent to {list}. Owner: {owner}." with "Ask for something
  else" and "See it in My requests"; a `duplicate` answer shows its note
  and "Open it". Inputs keep their values on an error; the field named in
  the sentence gets the message under it.
- *My requests / Assigned to me / {team} queue / All requests*: a flush
  list of RequestRow, one line each: status chip, type label, client,
  due word, owner label; a press opens `?id=`. A request with two parts
  shows one chip summarising both and both lines in the panel.
- *The request panel*: type, client, requested by, due, priority, the
  answers, each part (list, task name, owner and its note, state chip, the
  ClickUp link with `ArrowUpRight`, the 2-minute check's note), history.
  "Cancel request" (outline, the requester, editors, admins and the CEO,
  only while `canCancel`) asks for a reason. An import row has "Make it a
  request" (teal), which opens the form with the import's type, client and
  details and `replacesTaskId`.

**`/requests/settings`.** Tabs: "Request types", "People in ClickUp",
"Alerts". Non-editors see only "Alerts" (their own rules). A line at the
top links "Slack notices" to `/client-success/notices`.

- *Request types* (editors): one flush row per type: label, team, "{list},
  {owner}" per part, a chip "Template", "{n} SOP steps", "{n} draft
  steps" or "No SOP steps", "Due in {n} days", an On/Off switch. A press
  opens the type in `TaskPanel` (`wide`): label; per part the list, the
  template (picked from `cockpit_request_templates` by name, "None" adds
  the SOP steps instead), who owns it (the client's CSM, the systems
  manager, the creative strategist, the media buyer of record, a named
  person; with the named person or fallback beside it, from
  `cockpit_request_people`), the "runs when" choice for types that have
  one; fields (reword, require, reorder, add from the ClickUp field list or
  as a cockpit-only question, remove); SOP steps (one line each, add,
  reorder, remove; a draft shows "Draft: check with the systems manager");
  SOP link; due days; priority; "Set Request Type in ClickUp" with its
  line "Off until the rehearsal ticket for this list shows ClickUp does
  not move it. The writer turns it off by itself if ClickUp moves a task.";
  Save (teal) and "Versions", which lists versions and offers "Go back to
  version {n}". A 409-style version clash shows the server's sentence and
  "Reload".
- *People in ClickUp* (editors): one row per active seat: "first name,
  role", the linked ClickUp user or "Not linked", how (matched by email /
  set by hand / no match / two matches), a picker to set it and "Clear".
  The read time of the members list sits in the header.
- *Alerts*: the seat's own rules: the eight kinds as switches
  ("A failed request" is always on, its switch disabled with "Always on"),
  "Your shift" (from your schedule / set here / the default 10:00 to
  18:00, Sunday to Thursday) and the Slack line "Slack: new assignments
  already post in your team's channel. Slack messages for these alerts are
  not switched on yet." Editors get a seat picker above.

Supporting files (portal-screens): `src/lib/requestsAdmin.ts` (wrappers for
the editor RPCs and the alert rules RPCs), `src/pages/requests/RequestRow.tsx`,
`src/pages/requests/RequestPanel.tsx`, `src/pages/requests/TypeEditor.tsx`,
`src/pages/requests/SeatLinks.tsx`, `src/pages/requests/AlertRules.tsx`,
`src/dev/requestsHarness.ts` (fakes every 2.5 call and the two rules
calls), and `src/dev/harness.tsx` (installs `installRequestsHarness` and
cockpit-screens' `installTasksHarness`, and adds the `/requests` and
`/requests/settings` routes).

### 6.5 The bell, the card and the focus view (cockpit-screens)

- **Your tasks.** Header "Your tasks" and the count when above zero. Rows
  in the server's order, `firstFive`. The spine per 6.1. Footer "See all
  {n}" above five. States (6.6): not linked (and, for an editor, "Link it
  in Requests settings"), not read, stale ("Last read at 14:02." in Mono),
  empty.
- **The bell.** List newest first: a dot for unread, the title, one line
  (`body`), the client. A press opens the focus view (task alerts) or the
  request panel at `${portal}/requests?id=` (request alerts) and marks it
  read. "Mark all read" (at most 200). The launch notices (`extra`) follow
  under their own label. Footer: "Checked every 2 minutes while this
  cockpit is open." and "Alert settings" to `${portal}/requests/settings?tab=alerts`.
  Empty: "No alerts in the last 14 days."
- **The focus view** (`TaskPanel`, opened by `?focus=`): the title; one line
  "{client} · {list} · {due word}" with the spine; the status chip; when
  the task came from a request, "Request from {role}" and "SOP" (the
  `sopUrl`, `ArrowUpRight`); the checklists ("{done} of {total} done"),
  each item a checkbox row; the description folded under "Details"; the
  newest three comments and "Show the other {n}"; a comment box with
  "Comment" (outline); at the foot "Mark done" (teal, the one primary) and
  "Open in ClickUp" (outline, `ArrowUpRight`). A press writes through
  `actOnTask` and shows "Saving…" on that control, then polls
  `readTaskDetail(…, true)` every 3 seconds for up to a minute until the
  action row is `delivered` ("Saved", the box ticks; "Done" replaces "Mark
  done"), `skipped` or `failed` (the row's sentence), else "Waiting for
  ClickUp to confirm." Each `can.*` that is false hides its control and
  shows `can.why` once. A task the seat may not open shows the server's
  sentence and only "Open in ClickUp".

### 6.6 Copy (use exactly)

| Where | Text |
|---|---|
| Your tasks, not linked | "Your seat is not linked to a ClickUp user, so your tasks cannot show here. Ask the systems manager to link it." |
| Your tasks, not read | "Your tasks could not be read just now. They are still in ClickUp. Try again in a minute." |
| Your tasks, stale | "Task updates are late. Last read at {14:02}. Open ClickUp for anything urgent." |
| Your tasks, empty | "Nothing is assigned to you in ClickUp. New tasks show here within two minutes." |
| Bell, empty | "No alerts in the last 14 days." |
| Bell, not read | "Alerts could not refresh. Try again." |
| Focus, detail failed | the server's `detailNote` |
| Focus, saving / saved / waiting | "Saving…" / "Saved" / "Waiting for ClickUp to confirm." |
| Focus, done | "Mark done" becomes "Done" |
| Form, sent | toast "Request sent." and the panel "Sent to {list}. Owner: {owner}." |
| Form, writer off | `writer.note` (2.8) |
| Form, no type picked | "Pick what you need first." |
| Request states | `sending` "Sending to ClickUp" · `dry_run` "Not in ClickUp: the writer is in its test run" · `delivered` "In ClickUp: {status}" · `partial` "Part of it did not reach ClickUp: {error}" · `failed` "Not in ClickUp: {error}" · `cancelled` "Cancelled" · `imported` "Came in through the old ClickUp form. Make it a request to route it." · `routed` "Routed as a new request" · done "Done" |
| Owner how | `card` "The CSM named on the client card." · `fallback`, `none` the server's note |
| 2-minute check | `restored` "A ClickUp rule removed the owner; the cockpit put them back." · `removed` "A ClickUp rule keeps removing the owner. Assign it in ClickUp." · `moved` "ClickUp moved this task after its Request Type was set. Request Type is now off for this type." |
| Rail, palette, search | "Ask a team" |
| Tab bar | "Requests" |

---

## 7. Health, runbook and the ship gate (mirror-alerts)

- `hermes/cockpit-guardian/checks/queues.py`: one `Queue` row
  `queue-clickup-requests` on `cockpit_clickup_writeback_queue`, states
  `queued`, `sending`, `retry`, `unknown`, `time_col 'created_at'`, 15
  minutes, owner "the tech lead", action "Run the requests doctor
  (clickup-writeback job requests_doctor); an unknown needs a person to
  look in ClickUp for its Cockpit ref (RUNBOOK, Requests writer).",
  `status_col 'state'`, `kind_col 'kind'`, `kinds ('request','task_action')`,
  `failed_col 'updated_at'`; add `cockpit_clickup_writeback_queue` to
  `WITH_ERROR`.
- `checks/sections.py` `run_jobs` keys: `"clickup-writeback:requests": 10`,
  `"task-mirror:delta": 10`, `"task-mirror:seats": 90`.
- `checks/pg_cron.py` `EXPECTED_JOBS`: `mahara-clickup-writeback-requests`,
  `mahara-task-mirror`, `mahara-task-mirror-seats`.
- `checks/edge_functions.py` `EXPECTED`: `"cockpit-tasks": False`.
- Their tests in `hermes/cockpit-guardian/tests/` updated to the new counts.
- `RUNBOOK.md`: two sections, "Requests writer (clickup-writeback job
  requests)" and "Task mirror and alerts (cockpit-tasks)": the switches and
  canary, the doctor jobs, how to read an `unknown` (search the list for the
  `Cockpit ref`), how to requeue a `failed` or `dry_run` row with a fresh
  plan (the operator `UPDATE` of `20261009f…sql:26-28`, `steps` and
  `progress` cleared), how to turn Request Type back on for a type, how to
  link a seat, what "not linked" and "late" mean, and the clean-up of the
  `[TEST]` tickets (set cancelled, never delete).
- `scripts/ship.sh`: one block after the Slack notices block, run when
  `apps/media-buyer-cockpit/scripts/requests-supabase.test.ts` exists:
  `cd apps/media-buyer-cockpit && bun test scripts/requests-supabase.test.ts scripts/request-types-seed.test.ts scripts/task-alerts-supabase.test.ts scripts/tasks-core.test.ts scripts/your-tasks.test.tsx scripts/requests-core.test.ts scripts/request-form.test.tsx scripts/requests-page.test.tsx scripts/requests-settings.test.tsx`
  and `bun test supabase/functions/clickup-writeback supabase/functions/cockpit-tasks`,
  each failing the ship with one plain line, as the block above it does.

---

## 8. File ownership

Every file has exactly one owner. A file not listed is not changed. "All
five apps" means the same path under `apps/media-buyer-cockpit`,
`apps/client-success-cockpit`, `apps/creative-director-cockpit`,
`apps/video-editor-cockpit` and `apps/sales-cockpit`.

| File | Owner |
|---|---|
| `supabase/migrations/20261026r_requests.sql` (new) | db |
| `supabase/migrations/20261026s_request_types_seed.sql` (new, generated) | db |
| `scripts/gen-request-types-seed.ts` (new) | db |
| `apps/media-buyer-cockpit/scripts/requests-supabase.test.ts` (new) | db |
| `apps/media-buyer-cockpit/scripts/request-types-seed.test.ts` (new) | db |
| `supabase/functions/clickup-writeback/index.ts` | writer |
| `supabase/functions/clickup-writeback/run.ts` | writer |
| `supabase/functions/clickup-writeback/run.test.ts` | writer |
| `supabase/functions/clickup-writeback/rules.ts` | writer |
| `supabase/functions/clickup-writeback/rules.test.ts` | writer |
| `supabase/functions/clickup-writeback/requests.ts` (new) | writer |
| `supabase/functions/clickup-writeback/taskActions.ts` (new) | writer |
| `supabase/functions/clickup-writeback/requestsTestkit.ts` (new) | writer |
| `supabase/functions/clickup-writeback/requests.test.ts` (new) | writer |
| `supabase/functions/clickup-writeback/taskActions.test.ts` (new) | writer |
| `supabase/migrations/20261026t_task_alerts.sql` (new) | mirror-alerts |
| `apps/media-buyer-cockpit/scripts/task-alerts-supabase.test.ts` (new) | mirror-alerts |
| `supabase/functions/cockpit-tasks/*` (all new: `index.ts`, `door.ts`, `delta.ts`, `seats.ts`, `detail.ts`, `doctor.ts`, `clickup.ts`, `testkit.ts`, `deno.json`, `README.md`, `door.test.ts`, `delta.test.ts`, `seats.test.ts`, `detail.test.ts`) | mirror-alerts |
| `hermes/cockpit-guardian/checks/queues.py`, `checks/sections.py`, `checks/pg_cron.py`, `checks/edge_functions.py` | mirror-alerts |
| `hermes/cockpit-guardian/tests/test_checks_data.py` and any other guardian test whose counts change | mirror-alerts |
| `RUNBOOK.md` | mirror-alerts |
| `scripts/ship.sh` | mirror-alerts |
| `src/lib/requestsCore.ts`, `src/lib/requestsClient.ts`, `src/components/tasks/RequestForm.tsx`, `src/components/tasks/requests.css` in all five apps (new) | portal-screens |
| `apps/media-buyer-cockpit/src/pages/requests/RequestsPage.tsx`, `RequestsSettings.tsx`, `RequestRow.tsx`, `RequestPanel.tsx`, `TypeEditor.tsx`, `SeatLinks.tsx`, `AlertRules.tsx` (new) | portal-screens |
| `apps/media-buyer-cockpit/src/lib/requestsAdmin.ts` (new) | portal-screens |
| `apps/media-buyer-cockpit/src/auth/authenticated/AuthenticatedAppRoutes.tsx` (the two routes only) | portal-screens |
| `apps/media-buyer-cockpit/src/dev/requestsHarness.ts` (new), `apps/media-buyer-cockpit/src/dev/harness.tsx` | portal-screens |
| `apps/media-buyer-cockpit/scripts/requests-core.test.ts`, `request-form.test.tsx`, `requests-page.test.tsx`, `requests-settings.test.tsx` (new) | portal-screens |
| `src/lib/tasksCore.ts`, `src/lib/tasksClient.ts`, `src/components/tasks/TaskPanel.tsx`, `YourTasks.tsx`, `AlertsBell.tsx`, `TaskFocus.tsx`, `tasks.css` in all five apps (new) | cockpit-screens |
| `src/lib/taskSeat.ts` in all five apps (new) | cockpit-screens |
| `src/lib/cockpits.ts` in all five apps (the `requests` icon only) | cockpit-screens |
| `apps/media-buyer-cockpit/src/components/AppLayout.tsx`, `components/AppSidebar.tsx`, `components/MobileTabBar.tsx`, `components/CommandPalette.tsx`, `components/launch/ClientAlerts.tsx` | cockpit-screens |
| `apps/media-buyer-cockpit/src/pages/CockpitPage.tsx`, `pages/team/TeamPage.tsx`, `pages/AdminPage.tsx` | cockpit-screens |
| `apps/media-buyer-cockpit/src/dev/tasksHarness.ts` (new; exports `installTasksHarness(client)`) | cockpit-screens |
| `apps/client-success-cockpit/src/components/AppLayout.tsx`, `components/AppSidebar.tsx`, `pages/CsmPage.tsx`, `pages/ClientPerformancePage.tsx`, `pages/NoticesPage.tsx` | cockpit-screens |
| `apps/creative-director-cockpit/src/components/AppLayout.tsx`, `components/AppSidebar.tsx`, `pages/DashboardPage.tsx` | cockpit-screens |
| `apps/video-editor-cockpit/src/App.tsx`, `pages/JobsPage.tsx`, `components/Sidebar.tsx`, `components/SearchBox.tsx` | cockpit-screens |
| `apps/sales-cockpit/src/App.tsx`, `pages/TodayPage.tsx`, `components/Sidebar.tsx`, `components/SearchBox.tsx`, `components/MacOSMenuBar.tsx` | cockpit-screens |
| `scripts/check-shared.sh` | cockpit-screens |
| `apps/media-buyer-cockpit/scripts/tasks-core.test.ts`, `your-tasks.test.tsx` (new) | cockpit-screens |
| `apps/media-buyer-cockpit/scripts/sections.e2e.ts` (line 7: "Your ClickUp tasks" becomes "Your tasks") | cockpit-screens |
| `apps/client-success-cockpit/scripts/csm-page.test.tsx` (only where the Ask a team panel or the tickets card changed) | cockpit-screens |
| `docs/requests/CONTRACT.md`, `docs/requests/request-types.json`, `docs/requests/maps/*` | the orchestrator (no builder edits them) |
| `apps/media-buyer-cockpit/scripts/requests-ownership.test.ts` (new: every file this branch changes is in this table) | the orchestrator |

Not touched by anyone: `supabase/functions/cockpit-csm-api/*`,
`cockpit-media-api/*`, `cockpit-creative-api/*`, `cockpit-notices/*`,
`apps/media-buyer-cockpit/convex/*`, `hermes/task-assignment-alerts/*`,
`hermes/cockpit-sync/*`, every migration but the three above.

Hand-offs (build to the contract, not to each other's code):

| Producer | Consumer | Interface |
|---|---|---|
| db | writer | the `request` payload (2.6), the verify payload (2.7), the service RPCs of 2.6, the progress keys the sync trigger reads (`task_id`, `progress.task.url`, `progress.verify`, `progress.verifyNote`) |
| mirror-alerts | writer | the `task_action` payload (3.4) |
| db | mirror-alerts | `cockpit_request_seat()`, `cockpit_clickup_requests_mode()`, `cockpit_request_owner_label()`, `cockpit_request_lists()`, `cockpit_clickup_requests_kick()`, the parts' mirror columns, `cockpit_request_refresh()`, `cockpit_clickup_members_sync`, `cockpit_request_field_catalog_sync`, `cockpit_request_templates_sync`, `cockpit_request_import` |
| db | portal-screens, cockpit-screens | the browser RPCs and shapes of 2.5 |
| mirror-alerts | cockpit-screens, portal-screens | the browser RPCs and shapes of 3.3, the `detail` op of 5.4 |
| portal-screens | cockpit-screens | `RequestForm` props and `requests.css` (6.2); `readRequests` for the CSM's "Requests you raised today" |
| cockpit-screens | portal-screens | `TaskPanel`, `useTaskSeat`, `installTasksHarness` (6.2, 8) |
| db, mirror-alerts | mirror-alerts (docs) | table, RPC, cron and state-key names for the guardian and RUNBOOK |

---

## 9. Tests each builder runs green

Run from the worktree root unless a `cd` is shown. Cross-role imports
(`@/lib/taskSeat`, `TaskPanel`, `RequestForm`, `requests.css`,
`installTasksHarness`) may be missing while the other builder is still at
work: a type or test error that names only a file another role owns is
reported, never fixed by stubbing it. The orchestrator runs every command
once more after all five finish. PGlite tests follow
`apps/media-buyer-cockpit/scripts/slack-notices-supabase.test.ts`:
`cockpitTestDb({supabaseDefaultPrivileges: true})`, `member()`, `actor()`,
real definitions cut from their canonical migrations (the queue, runs,
config, audit trigger and live `begin`, `idle`, `claim`, `save` from
`20261009f_clickup_writeback_native.sql`; `cockpit_forms_editor_gate`,
`cockpit_forms_editors`, `cockpit_slack_notice_role_of`,
`cockpit_slack_notice_seat_label` from `20261025n`; `cockpit_client_allowed`,
`cockpit_has_role`, `cockpit_is_ceo` from their migrations), cut-down
stand-ins with the live column names (`cockpit_people` with `schedule`,
`cockpit_client_onboarding`, `cockpit_sync_state`,
`cockpit_blueprint_settings`), invented people, clients and ClickUp ids.

**db**: `cd apps/media-buyer-cockpit && bun test scripts/requests-supabase.test.ts scripts/request-types-seed.test.ts`. They prove at least:
r and s apply twice; every new table has row security, no browser grant
and only `SELECT` for the service role; every function's ACL is exactly
2.11; the seed equals `docs/requests/request-types.json` (regenerated and
compared byte for byte; 31 types, 38 targets, 24 catalog rows, 34
templates); the guard refuses a bad target, a duplicate part, a removed
`when` field; submit as a CSM, a call centre seat (own clients only) and
a sales seat; refusals by mode (2.8) for each seat kind; idempotent resubmit
and the changed-content refusal; the lifecycle duplicate; owner rules
including the card's CSM, the media buyer of record fallback and `none`;
`low_schedule_rate` with Both makes two parts and with Ads issue one;
`create_ad_account` picks its template by platform; preview equals submit;
one queue row per part with the 2.6 payload; the old `claim` never returns
`request` or `task_action` while the new claim returns only them and keeps
one lane per task; the sync trigger moves parts and the request state for
every queue state, inserts the verify row once on `delivered`, and records
the verify outcome; cancel before and after delivery; the type save
(version clash, person and template checks, versions row, audit before and
after), restore and `rt_off`; member links by email (one, none, two;
`manual` and `cleared` never overwritten); the import and "make it a
request" routing; every write leaves its audit row.

**writer**: `bun test supabase/functions/clickup-writeback`. With a fake
ClickUp and a fake RPC: the gate (only `APPLY_REQUESTS` opens the two
kinds; it opens nothing else; the canary narrows by card); a dry run calls
no provider; every step of 4.3 for a no-template type, a template type, a
two-part type, a template with no checklist (WhatsApp connection) and a
replaces request; resume of each step after a lost answer (create adopts
by marker or name, two matches go `unknown`); the due read-back passes when
ClickUp stores 06:00 Kuwait for a 12:00 Kuwait write; a field that will not
save is a `mismatch` note, not a failure; Request Type refused on a renamed
option; each `task_action` op with its preconditions, `unchanged` and
`skipped` sentences; verify `kept`, `restored`, `removed`, `moved` (calls
`rt_off`); the doctor reports a missing template and a renamed option;
`rules.ts` maps the three wordings to the right options; the existing
`run.test.ts`, `queue.test.ts`, `kpi.test.ts`, `billing.test.ts` still pass.

**mirror-alerts**: `cd apps/media-buyer-cockpit && bun test scripts/task-alerts-supabase.test.ts`;
`bun test supabase/functions/cockpit-tasks`; `cd hermes/cockpit-guardian && python3 -m unittest`;
`bash -n scripts/ship.sh`. The PGlite test (r, s and t applied twice)
proves: no alert before the baseline; each 3.2 kind is made once and only
for its seat, rules respected, client cards and Video Pipeline handled as
3.2 and 3.3 say; the creator and the requester are never alerted for their
own act; `cockpit_my_tasks` order, subtask collapse, list exclusions,
`not_linked` and `ready`; `cockpit_task_alerts_seen` marks only own alerts
and audits; the detail gate; every `cockpit_task_act` refusal and the queue
row it writes; rules read and set, `slack_dm` refused; the request status
mirror sets `done_at` and makes `request_done`; a failed part makes
`request_failed`. The function tests use a fake ClickUp: delta paging and
the cursor, truncation at 10 pages, comment and reply reads with their
caps, the seats job (members, fields, templates, per seat, import), the
detail op's user-JWT gate, cache and failure note, and that no non-GET call
is ever made.

**portal-screens**: `cd apps/media-buyer-cockpit && bun test scripts/requests-core.test.ts scripts/request-form.test.tsx scripts/requests-page.test.tsx scripts/requests-settings.test.tsx && bunx biome check --line-ending=auto src && bun run tsc --project tsconfig.app.json --noEmit && bun run tsc --project tsconfig.node.json --noEmit`.
The happy-dom tests (`scripts/appointment-feedback.test.tsx` pattern): the
form shows only the chosen type's fields, prefills due and priority,
validates with the same sentences as the server, shows the route line and
`writer.note`, sends once per press (the same request id on a retry), and
shows `duplicate`; the views and the request panel (cancel, make it a
request); the settings tabs by seat (non-editors see only Alerts), the
type editor's save, version clash and restore, seat links, alert rules.
Then the harness at 390, 820 and 1440: `bun run harness`,
`/harness.html?path=%2Frequests`, `?path=%2Frequests%3Fview%3Dmine`,
`?path=%2Frequests%2Fsettings`.

**cockpit-screens**: `bash scripts/check-shared.sh`;
`cd apps/media-buyer-cockpit && bun test scripts/tasks-core.test.ts scripts/your-tasks.test.tsx && bunx biome check --line-ending=auto src && bun run tsc --project tsconfig.app.json --noEmit && bun run tsc --project tsconfig.node.json --noEmit`;
`cd apps/client-success-cockpit && bun test scripts/csm-page.test.tsx && bunx biome check --line-ending=auto src && bun run tsc --project tsconfig.app.json --noEmit`;
and `bunx biome check --line-ending=auto src && bun run tsc --project tsconfig.app.json --noEmit`
in `apps/creative-director-cockpit`, `apps/video-editor-cockpit` and
`apps/sales-cockpit`. `tasks-core.test.ts`: `firstFive`, `dueWords` across
Kuwait midnight, the sentences. `your-tasks.test.tsx` (happy-dom): at most
five rows; not linked, not read, stale and empty; "See all" opens the list
in place; `?focus=` opens the view and Escape closes it; a tick goes
"Saving…" then "Saved"; the bell's unread count, Mark all read, the
`extra` list. Then the harness at 390, 820 and 1440: `?path=%2Fdashboard`,
`%2Fteam`, `%2Fadmin`, `%2Fdashboard%3Ffocus%3D<fixture id>`.

---

## 10. Checked for this contract (read only, 2026-10-26)

| Check | Result |
|---|---|
| Migrations in the repo, other worktrees and `supabase_migrations.schema_migrations` | Newest repo file `20261026n_native_monitor_recent_provider_failures.sql`; another worktree holds `20261026u_upsell_catalog.sql`; Stage 1's `20261025n` and `20261025o` are live (applied 2026-10-26 15:44) |
| New names | No relation, function or code reference for any name in sections 2, 3 and 5 |
| `cockpit_clickup_writeback_queue` | Kind CHECK `decision, manual_change, provider_action, tracking_backlog, billing`; states `queued, sending, retry, unknown, delivered, dry_run, skipped, failed`; columns as WR 3.2 |
| `cockpit_clickup_writeback_runs` | Job CHECK `kpi, log, dosdonts`; `begin` and `idle` refuse other jobs (`pg_get_functiondef`) |
| Live claim | Takes every kind, `source_exists` for `decision` and `manual_change` only |
| `cockpit_clickup_writeback_save` | Patch keys `state, steps, progress, planned, task_id, error, next_attempt_at, delivered_at`; steps frozen once written |
| pg_cron | `mahara-clickup-writeback-log` `*/2` with vault `cockpit_sync_secret`, no Authorization (function `verify_jwt` off); `mahara-slack-notices` uses the kick pattern |
| Vault names | `cockpit_anon_key`, `cockpit_creative_cron_secret`, `cockpit_notices_cron_secret`, `cockpit_sync_secret` and others; no `cockpit_tasks_cron_secret` yet |
| `cockpit_media_provider_health` | `action_id uuid` with no foreign key; `phase` `intent`, `response`, `unknown` |
| Gates | `cockpit_has_role(text)`, `cockpit_is_ceo()`, `cockpit_client_allowed(text)` (team-only seats limited to their list), `cockpit_forms_editor_gate()` (CEO, admin, `forms_editor` role or a `cockpit_forms_editors` row), `cockpit_slack_notice_role_of(text)`, `cockpit_slack_notice_seat_label(text,text)`, `cockpit_is_team_only()` all exist |
| Seats | 13 active: 2 admin+CEO, 1 admin with every role, 2 call centre, 1 creative, 1 CSM, 3 editor, 2 media buyer, 1 sales |
| People roles | Active: Systems manager 1, Creative strategist 1, Client success manager 1, Media buyer 2, Video editor 3, Call centre agent 2, Closer 1, CEO 1, Bot 1 |
| Client cards | 70 in `cockpit_client_onboarding` (Stopped 27, Active 20, SALES TEAM TO CONTACT 14, GHOSTED 5, Brand Blueprint Booked 3, Ready For Launch 1); `csm` is text (20 empty); the test card `86eywg1cq` is there |
| `cockpit_blueprint_settings` | Only `close_route = card_only`; no `launch_assignee` |
| Folder fields of `901812879297` (MCP `clickup_get_custom_fields`) | 31 Request Type options with the ids in the JSON (option 0's name has stray spaces); the 24 catalog fields and their options as in `request-types.json` |
| Template objects (VPS `GET team/90182518398/taskTemplate`, key by name, never printed) | 34: `t-86ex8x9xw` Tech Onboarding, `t-86ex8xaf1` Media Onboarding 2.0, `t-86eyu1w3d` Creative Onboarding, `t-86ex6fpu3` Ad Spend Invoice Request 🧾, `t-86ex1965m` Add Custom Values to Client's sub account, `t-86exj3gx1` Add custom qualifiation questions🙋, `t-86ex6fdwu` Card Missing 💳 ❌, `t-86exj3ngz` Change Company Address📍, `t-86exj3n5t` Change Company Name⏎, `t-86ex629x6` Client Offboarding (Media) 👋❌, `t-86ex629ve` Client Offboarding (Tech) 👋❌, `t-86ex63qm7` Client Pause ⏸️ (Media), `t-86ex63qk5` Client Pause ⏸️ (Tech), `t-86exj3g1a` Client Reactivation Campaign (Media)📣, `t-86exghd6t` Client Reactivation Campaign📣, `t-86exj3h8f` Client Reactivation Campaign📣 (Tech), `t-86ex63qjj` Client Relaunch 🚀↪️ (Media), `t-86ex63qhr` Client Relaunch 🚀↪️ (Tech), `t-86ex09tmh` Connecting a new lead form, `t-86exer2gv` Create Landing Page📊, `t-86ex6f3q7` Create Meta Ad Account 🛜, `t-86ex6ehwe` Create Snapchat Ad Account 👻, `t-86ex6ee7a` Create TikTok Ad Account 🎵, `t-86ex1964h` Lanuch New Client Campaign 🚀, `t-86exj3cvt` Low Schedule Rate📉 (Ads), `t-86exj3d37` Low Schedule Rate📉 (Call Center), `t-86exj3ddv` Low Show Rate📉, `t-86ex09vmq` Missing Leads ❌, `t-86ex09ytj` New Employee Onboarding 🙋‍♂️, `t-86ex63j6n` New Script Request✍️, `t-86exy04v4` Social Media Management Template, `t-86exj3gk4` Switch funnel intent level🌪️, `t-86exj3gfx` Switch to funnel intent🌪️, `t-86ex62m1b` Whatsapp Connection Issue📲❌. Every template the seed names is among them |
| Repo files and lines | Every file in section 8 exists today except those marked new; `AppLayout.tsx:88` (`<ClientAlerts />`), `AuthenticatedAppRoutes.tsx:119-126`, `CsmPage.tsx:157-203` and `:2303-2340`, `ClientPerformancePage.tsx:776-832`, `CockpitPage.tsx:128-159` and `:3395-3440`, `clientLifecycle.ts:35-49` read as the maps say; `cockpits.ts` md5-identical in all five apps; `check-shared.sh` sets `CD`, `MB`, `ED`, `SA` at 17-20 and `CS` at 109; all five apps have `node_modules`, `tsconfig.app.json` and `tsconfig.node.json` |
| Guardian | `Queue` has `status_col`, `kind_col`, `kinds`, `failed_col`; `run_jobs` reads `cockpit_sync_state` keys; `EXPECTED_JOBS` and `EXPECTED` lists exist |

---

## 11. Decisions this contract adds or changes, with reasons

| # | Plan or map said | This contract | Why |
|---|---|---|---|
| X1 | PLAN 3.3: the media buyer of record is the Blueprint `launch_assignee` | The named person on the target first, then `launch_assignee`, then the systems manager with a visible note | `launch_assignee` is unset (TS finding 6); nobody may be assigned in silence |
| X2 | PLAN 3.3 row 8: `t-86exj3h8f` on Media/Creative and `t-86exghd6t` on Tech | `t-86exj3g1a` on Media/Creative, `t-86exj3h8f` on Tech | TS finding 2: the first is named "(Tech)" |
| X3 | PLAN 3.3 row 21: template `t-86ex6fdwu` | No template, 5 draft steps | The template sends the retired card-number form (TS finding 3) |
| X4 | WR 8: Request Type only after a rehearsal clears the type | On at seed for the 11 types with no folder rule | No rule can fire for them (CT F2); the 2-minute check still turns it off if ClickUp moves a task |
| X5 | PLAN 4.2 and WR 10.3: `CLICKUP_WRITEBACK_APPLY_FORMS` / `APPLY_REQUESTS` | `CLICKUP_WRITEBACK_APPLY_REQUESTS` and `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS` | WR: `APPLY_FORMS` does not exist; forms are a later stage |
| X6 | WR 10.4: the requests job paces at 40 a minute | 120 a minute, its own setting | The token's limit is 1,000 a minute (AT 7.1); 6 requests a run fit one invocation |
| X7 | AT 8.1: the mirror as a `clickup-writeback` job | Its own function `cockpit-tasks` | One owner per file for parallel builders, and the focus view needs a signed-in door that `clickup-writeback` does not have |
| X8 | PLAN 3.3: a 10-minute request mirror job | The task mirror's delta (2 minutes) updates request parts | One mirror, one poll |
| X9 | PLAN D19 and AT 8.6: Slack DM per seat | Not in this build; `slack_dm` held false | R10 |
| X10 | D19: alert rules include quiet hours | `shift_start` and `shift_end` set when the daily due and overdue alerts appear | With no DM, the shift is the only thing hours change |
| X11 | TD 6.3: `cockpit_task_alerts_seen({id, version})` | `p_ids uuid[]` | Alert rows never change, so a version adds nothing |
| X12 | TD 6.1: seven shared files | Eleven: the request form, its client and core, and its CSS join the set | The CSM client page embeds the same form, so it must be shared |
| X13 | TD 11.6: "See all" goes to `/requests?view=assigned` | "See all" opens in place; `/requests` "Assigned to me" lists requests assigned to the seat | "Open it to just focus on it": no cockpit sends a person away to see their own list |
| X14 | Audit per write | The mirror writes one audit row per run, not per task | It is a cache of ClickUp; the audit log was compacted from 4.18M rows on 2026-10-09 |
| X15 | PLAN 3.3: department queue for the department lead | A seat's teams by role (2.1); the CSM also sees Call Center | The CSM owns call centre types until a lead seat exists (PLAN 3.3 row 25) |
| X16 | The ClickUp form has "Deadline" with a time | A due day only, written at 12:00 Kuwait | Date-only values re-time in ClickUp (WR 4); a day keeps "not too busy" |

**Not in this build** (named so nobody counts them done):

- Slack DMs for alerts (a `task.alert` notice kind in `cockpit-notices`,
  after Stage 1's proof run).
- The media buyer reroute and offboarding writing requests (both are dry
  run or unused; the offboarding must first move its hold off a ClickUp
  task id).
- Retiring `inbox` in `hermes/cockpit-sync/calculator.ts` and the `task`
  half of `cockpit_media_client_notices` (the portal hides them once the
  seat is linked).
- The `task-assignment-alerts` cron line missing from the guardian's
  `crontab.manifest`, and its unledgered calls (AT gap 8).
- The "Log a call" exact-millisecond read-back in `cockpit-csm-api`
  (WR 4) and the same check in `blueprint.ts:91` and `outbox.ts:17, 27`.
- Closing the ClickUp form `2kzmr1ky-1178` and the create-time list rules
  (C3, two weeks after go-live).

---

## 12. After the build: deploy order and the CEO's items (main session)

Deploy (nothing here is done by a builder):

1. Migrations r, s, t: dry run `BEGIN; …; ROLLBACK;` through Composio, then
   apply, each with its own `BEGIN;`/`COMMIT;` stripped (PLAN 1.7).
2. `clickup-writeback` (keeps `verify_jwt` off) and `cockpit-tasks` (new,
   `verify_jwt` off), bundled from committed code.
3. Function secrets: `TASKS_CRON_SECRET` on `cockpit-tasks`; the same value
   in the vault as `cockpit_tasks_cron_secret`. `CLICKUP_WRITEBACK_APPLY_REQUESTS`
   stays unset.
4. `doctor` on both functions; the first `seats` run (baseline, members,
   seat links); read "People in ClickUp" and link the unmatched seats.
5. `scripts/ship.sh media-buyer`, `client-success`, `creative`,
   `video-editor`, `sales`; check each live bundle for "Your tasks" and
   "Ask a team".

For the CEO's C3 batch, added to PLAN 5.2 (the build session carries out
each on his yes, D16):

- Switch on the rehearsal: `CLICKUP_WRITEBACK_APPLY_REQUESTS=true`,
  `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS=86eywg1cq`. File five requests on
  the test card from `/requests`: `general_tech`, `general_marketing`,
  `general_csm`, `low_show_rate`, `new_script`, with "Set Request Type"
  turned on for those five first. They create five ClickUp tasks with
  owners, five link comments on the test card, and five
  `task-assignment-alerts` posts in #tech-general, #client-ads-general,
  #csm-general, #csr-general-channel and #media-general. Read each request's
  2-minute check, then set the five tasks to cancelled.
- Then clear `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS`: requests open to the
  whole team.
- The systems manager checks the draft SOP steps and re-saves the drifted
  templates (Client Pause Tech, Switch Funnel Intent, Client Offboarding
  Tech, WhatsApp Connection, Card Missing without the card form, Low Show
  Rate at 60%, both Low Schedule Rate at $15 a lead and $60 a booking);
  the new object ids are picked in Requests settings, no code change.
- Name the media buyer of record on the eight media buyer types in
  Requests settings.

---

## 13. Integration (2026-10-26, after the five builders)

What the integration read changed or settled, so the documented shapes match
the code that ships. `apps/media-buyer-cockpit/scripts/requests-fit-supabase.test.ts`
drives every boundary through its real code (r, s and t applied twice over
the whole of Stage 1; the portal's own clients; the writer's requests job
through `tools.ts`; cockpit-tasks' seats, delta, detail and doctor through
its door) and is in the `scripts/ship.sh` requests block.
`requests-ownership.test.ts` checks section 8 on the build branch.

| # | Where | Settled |
|---|---|---|
| I1 | 2.5 | Editors get `TypeView.fieldSpecs` and `types_read.catalog` and `.templates` (D17: questions and templates are edited in the cockpit); `cockpit_request_clients.more` is a boolean |
| I2 | 2.6, migration r | The one-lane-per-task rule does not count a 2-minute check that is not due yet, so a tick, comment or Mark done right after delivery is not held two minutes. A check that is due still goes first. Two presses on one task still go one per run (each press kicks a run) |
| I3 | 2.9, migration r | The requests kick waits 150 s for clickup-writeback (the live log, kpi and Do's & Don'ts posts do the same), because the function answers when its run ends (up to about 100 s); 5 s would drop the connection mid-run |
| I4 | 3.4, migration t | The queue's audit trigger `cockpit_clickup_writeback_audit` (20261009f, its live body) copied a focus-view comment's words into the audit log. Migration t replaces it with the same body that keeps only the comment's length for `task_action` rows; every other table and kind is audited as before, and the function keeps its live grant |
| I5 | 3.3 | `shift.days` comes back as `["Sun","Mon",...]`; the screens read any case. `TaskDetail.actions[].id` is the press's action id, which is also its queue row's id |
| I6 | 5.4 | A refused detail read is 403, 404 or 400 with `{error: <the database's sentence>}`; the focus view shows it |
| I7 | tests | `your-tasks.test.tsx` loads react-dom with its DOM in place and hands its seat mock back when it is done, so the nine screen and database files pass in one `bun test` run as ship.sh runs them |
| I8 | 12 | Ship order for the client success app: its client page's old "Ask a team" (the live decision-log path) is replaced by the request form, so ship it after the rehearsal opens requests to everyone, or accept that CSMs use the ClickUp form for that window |

