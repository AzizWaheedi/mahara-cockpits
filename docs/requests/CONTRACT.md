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
| R1 | Three migrations: `20261026r_requests.sql` (db), `20261026s_request_types_seed.sql` (db, generated), `20261026t_task_alerts.sql` (mirror-alerts). Applied in that order. The department map round (2026-10-28) adds a fourth, `20261028a_request_types_read_routes.sql` (db), after them (section 21). | Names sort after every file in the repo and in other worktrees (`20261026n`, `20261026u_upsell_catalog.sql` in another worktree); none exists live. Splitting the SQL lets two builders work at once |
| R2 | One request table pair: `cockpit_requests` (one row per request, the requester's seat) and `cockpit_request_parts` (one row per ClickUp task; two-task types have two). | PLAN 3.3 "two tasks"; owners and status are per task |
| R3 | The 31 types live in `cockpit_request_types`, seeded from `docs/requests/request-types.json` (built for this contract from TS section 4, the folder fields and the template listing read today). Editors change any type; they cannot add or delete one (a type is a ClickUp Request Type option). | D17, D18 |
| R4 | **The writer is `clickup-writeback`, job `requests`**, two new queue kinds `request` and `task_action`, its own switch **`CLICKUP_WRITEBACK_APPLY_REQUESTS`** (exactly `"true"`, default off) and canary **`CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS`** (rehearsal value `86eywg1cq`). The general switch does not open these kinds and this switch opens nothing else. | WR 10: the only writer that ever delivered a ticket; outbox, frozen steps, read-back, ledger |
| R5 | The old `log` claim stops taking the new kinds in the same migration that adds them; the requests job has its own claim with one lane per task. | Otherwise the deployed `log` job would claim rows it cannot build |
| R6 | While the writer is not live, `/requests` does not take requests from the team: the form says so and points to the ClickUp form. (2026-10-29, `20261029p`, docs/requests/CLICKUP-DOWNGRADE.md: superseded. Every seat may file and is held; no ClickUp form is linked anywhere in the cockpit.) Editors, admins and the CEO may still file: the request is **held** (saved, its queue rows stay queued, said plainly) and goes to ClickUp once requests open; on the canary card it goes at once. (Review R1, 2026-10-26: replaces "their rows become dry runs".) | A dry-run row was never claimed again (WR 3.2), so a request filed in a dry run sat dead; a held row waits and goes by itself |
| R7 | Owner rules: the systems manager, the creative strategist and the media buyer of record take the named person first; the client's CSM takes the card's CSM first. Every rule falls back to the systems manager with a visible note; nobody is ever assigned in silence. | TS finding 6 (no media buyer of record today), CT F3 |
| R8 | Request Type is written last and only where `set_request_type` is on. It is on at seed for the 11 types that have no folder rule (nothing can fire) and off for the 20 that have one, until the `[TEST]` rehearsal clears them. The 2-minute check turns it off by itself if ClickUp moved or renamed the task, when it runs on time (within 15 minutes of its due time; a later check changes nothing). Going back to an older type version never turns it on, and no question may map to the Request Type field (review round 2). | WR 8, CT F2 |
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
| 4 | `supabase/migrations/20261028a_request_types_read_routes.sql` (the department map round, 2026-10-28; section 21) | db | `cockpit_request_types_read()` only, `CREATE OR REPLACE` of its live body plus one statement: every part of every type gains `when` and `steps` for every seat (2.5). A guard refuses any live body but 20261026r's or its own; the grant is given back as it is live. No table, row or other function changes |

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
`d3ac52c5-b71c-4782-9fea-1f9371cbae47` (CT F3). The hourly field read never
adds `e9fd8024`, `09abf737` or `d3ac52c5` to the catalog. The type guard
refuses a question mapped to one: "{label}: only the Set Request Type in
ClickUp switch writes Request Type. Remove this question." or "{label}: the
cockpit never writes this ClickUp field. Remove this question."
`cockpit_request_plan` never puts one in `payload.fields` (internal
`cockpit_request_never_written(text)`), and the writer's fields step never
posts one either (a second guard, retest round 2). Migration r deletes any
such catalog row once, with audit `request_fields.removed` (review round 2).

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
| `import_left_at` | timestamptz | NULL; an import only (review round 3): when a complete hourly read of All Tasks first no longer found its old ticket open there (moved, closed, deleted, renamed or its Request Type cleared in ClickUp); cleared when a complete read finds it again (2.10) |
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
| `cockpit_request_seat()` | jsonb `{memberId, authUserId, email, roles, label, isCeo, isAdmin, isEditor, clickupUserId, link, linkState, teams, teamOnly}` (`teamOnly` = `cockpit_is_team_only()`, 20261017b) | The active, confirmed seat of `auth.uid()` (the `cockpit_forms_editor_gate()` lookup). `label` is `public.cockpit_slack_notice_role_of(email)`. `isEditor` is true when `cockpit_forms_editor_gate()` passes. `link` is `linked` when `cockpit_member_clickup.state IN ('ok','manual')`, else `not_linked`. `linkState` (review round 3) is the link row's own state (`ok`, `manual`, `not_found`, `ambiguous`, `cleared`; null when the hourly read has not checked the seat): `cleared` is an editor saying the seat has no ClickUp user, so no screen asks anyone to link it. Raises `42501` "Sign in with an active seat to use requests." Migration t calls it too |
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
| `cockpit_clickup_requests_mode()` | jsonb `{mode, onlyCards, at, live, lastMode}` | From `cockpit_sync_state` key `clickup-writeback:requests`, `detail->>'mode'` and `detail->'onlyCards'`. Older than 15 minutes or missing: `mode 'unknown'`, `live false`. `live` is true for `apply` and `apply_limited`. `lastMode` (review round 3) is the mode the writer last reported, even when that report is stale (`dry_run`, `apply`, `apply_limited`, or null with no report), so a writer that went quiet after requests opened is said as such. Migration t calls it too |
| `cockpit_request_send_gate(p_seat jsonb, p_client_task text)` | jsonb `{allowed, held, note}` | 2.8: whether the seat may file now, whether the request is held, and the sentence |
| `cockpit_request_can_send(p_seat jsonb, p_client_task text)` | text | The gate's `note`: null only when the request goes to ClickUp at once; a held request has its note too |
| `cockpit_request_writer_view(p_seat jsonb, p_client_task text)` | jsonb | `{mode, canSend, held, note}` (`canSend` = the gate's `allowed`) |
| `cockpit_request_writer_takes(p_client_task text)` | boolean | The writer sends a row for this card now: `apply`, or `apply_limited` and the card in `onlyCards` |
| `cockpit_request_held(r)` | boolean | `state 'sending'`, every part `queued`, every queue row `queued` with `attempts 0`, and the writer would not take it now: NOT (`cockpit_request_writer_takes(card)` AND `cockpit_request_replaces_ok(replaces, mode)`) (review round 3) |
| `cockpit_request_client_visible(r, p_seat)` | boolean | A request with a client: `cockpit_client_allowed(client_name)`; with none: not for a team-only seat |
| `cockpit_request_never_written(p_field_id text)` | boolean | True for `e9fd8024-…` (Request Type: only the writer's own `request_type` step sets it), `09abf737-…` and `d3ac52c5-…` (review round 2) |
| `cockpit_request_sees_all(r, p_seat)` | boolean | An editor, an admin or the CEO; a team-only seat named an editor keeps `cockpit_request_client_visible` (review round 2). The All requests view and its count, the request panel, cancel and Route use it |
| `cockpit_request_may_open(r, p_seat)` | boolean | The requester; `cockpit_request_sees_all`; a seat whose teams hold the type's or a part's team plus `cockpit_request_client_visible`; a part's owner or assignee. The gate of `cockpit_request_get` and of the duplicate answer's "Open it" (review round 2) |
| `cockpit_request_unroute(r, p_why, p_actor)` | boolean | Puts the old form ticket a request routed back to `imported` (`routed_to` null, audit `request.unrouted` with metadata `{task_id, request_id, why}`) when nothing of that request will close it: no queue row carrying `replacesTaskId` is still open, delivered or a dry run, and none has `progress.steps.replaces`. Only the import this request routed (review round 2). Review round 3: also false when a `skipped` row of the request has an error starting "The old ticket was already moved or closed in ClickUp" (the writer's `SAY.oldHandled`, an interface the database matches on, so never reworded), or when the import is handled (`cockpit_request_import_handled`): an old ticket dealt with in ClickUp never goes back to a queue that would offer Route again |
| `cockpit_request_can_route(r, p_seat)` | boolean | An import still `imported` and not handled in ClickUp (`cockpit_request_import_handled`, review round 3); an editor, an admin or the CEO (a team-only one within its client limit), or a seat whose teams hold the type's team and `cockpit_request_client_visible(r, seat)` (a ticket with no client is never a team-only seat's, review round 2); and the gate allows the import's card |
| `cockpit_request_owner_note(p_note, p_editor)` / `cockpit_request_owner_for(p_owner, p_editor)` | text / jsonb | The "Set one in Requests settings" note is for editors; anyone else reads "No media buyer is named for this request type yet." (review round 2) |
| `cockpit_request_writer_silent(p_client_task text)` | boolean | Review round 3: the writer's report is older than 15 minutes (mode `unknown`) and its last report would have sent this card (`lastMode` `apply`, or `apply_limited` with the card in `onlyCards`; a null card counts only for `apply`). The screens then say the writer is not reporting, never "not switched on yet" |
| `cockpit_request_replaces_ok(p_replaces text, p_mode jsonb)` | boolean | Review round 3 (E-CANARY): whether a request that routes an old form ticket may go in this mode: true for no ticket or any mode but `apply_limited`; in `apply_limited` only when the old ticket's own card is a canary card, so the rehearsal never closes a real ticket on All Tasks, also for a request filed held before the test began. The requests claim, `cockpit_request_held` and submit step 8 read it |
| `cockpit_request_import_handled(r cockpit_requests)` | boolean | Review round 3: an import whose old ticket was dealt with in ClickUp, by the writer's own rule (`requests.ts` `oldTicketHandled`): `import_left_at` is set, or the task mirror (migration t, read only where it exists) shows it on another list or with status type `done` or `closed`. The mirror's `gone_at` is not used (a ticket waiting untouched on All Tasks goes unseen for 7 days too). Such a ticket leaves the team and assigned views, sorts as not open, is never routed or counted as a duplicate, and never goes back to `imported` |
| `cockpit_request_queue_in_clickup(q cockpit_clickup_writeback_queue)` | boolean | Review round 3: whether a queue row may already have made its ClickUp task: `sending`, `delivered` or `unknown`; a `task_id` or `progress.task.id`; or `queued`/`retry` with a create step on record (the writer records the create before its POST and forgets it only after a 429 on that POST, so a create on record means the POST went out and its answer was lost). Cancel and `canCancel` refuse while one exists |
| `cockpit_request_step_at(p_step jsonb)` | timestamptz | Review round 3: a step's `at` as the writer stamped it (an ISO time with its offset), else null; never a word PostgreSQL would read as a time |
| `cockpit_clickup_requests_kick()` | bigint | 2.9 |

**Owner rules** (`cockpit_request_owner`). `how` and `note` show on the
preview and on every request row.

| Rule | Order | Notes |
|---|---|---|
| `person` | `owner_clickup_id` | `how named` |
| `systems_manager` | `owner_clickup_id`, else the people row `Systems manager` | `named`, `rule` |
| `creative_strategist` | `owner_clickup_id`, else `Creative strategist` | `named`, `rule` |
| `csm_of_card` | the card's CSM: `cockpit_client_onboarding.csm` equal (case-insensitive) to a `cockpit_clickup_members.username` whose email belongs to an active seat with role `csm`; else `owner_clickup_id`; else `Client success manager` | `card` ("The CSM named on the client card."), then `named`, `rule` |
| `media_buyer_of_record` | `owner_clickup_id`, else `cockpit_blueprint_settings` key `launch_assignee` (digits), else the systems manager rule. The database holds no media buyer per client (checked 2026-10-26: no client, card or seat column names one; every media buyer seat has an empty client list; `launch_assignee` is not set live) | `named`, `rule`, then `fallback` with note "No media buyer of record is named on this request type, so the systems manager gets it. Set one in Requests settings." (stored as is; read by a non-editor as "No media buyer is named for this request type yet.", D12, review round 2) |
| any rule that finds nobody | the systems manager rule | `fallback`, note "Nobody matched this rule, so the systems manager gets it." |
| the systems manager cannot be found either | none | `none`, note "No owner could be found. The task goes to ClickUp without one; route it there." |

### 2.5 Browser RPCs (`GRANT EXECUTE ... TO authenticated`; gate first)

Shapes (camelCase keys, ISO times, Kuwait `YYYY-MM-DD` days):

```
TypeView = {key, label, team, teamLabel, enabled, dueDays, dueDefault, priority,
  fields: [{key, label, kind, required, options: [{id,name}] | null, help}],
  parts: [{part, listName, teamLabel, ruleLabel, templateName, stepCount, stepsDraft, when, steps}],
  sopUrl}
  + for editors: {version, typeIndex, clickupOptionName, targets, sopSteps, sopStepsState,
                  setRequestType, updatedByLabel, updatedAt,
                  fieldSpecs: [{key, label, kind, clickup_field_id, required, options, help}]}
                  (fieldSpecs is the stored `fields`, so the editor keeps each ClickUp field id)
  ruleLabel: "the systems manager" | "the client's CSM" | "the creative strategist"
             | "the media buyer of record" | the person's role label
  stepCount: sop_steps length when the part has no template (else null)
  when (migration 20261028a, every seat): null when the part always runs, else
        {fieldKey, options: [{id, name}]}: fieldKey is the type's choice question that
        decides the part (its stored targets[].when.field_key), options the choices of
        that question that make it run, with the ids, names and order of that question's
        own fields[].options in the same answer. A choice the question no longer offers
        is left out, so options can be [] (ClickUp lost the question, or dropped every
        choice the part runs on): then no choice on the form runs the part
  steps (migration 20261028a, every seat): null when the part has a ClickUp template
        (WhatsApp connection included: its fallback steps go only when its template
        brings no checklist), else the type's sop_steps in order, drafts included
        (stepsDraft says so), [] when it has none: the checklist the writer adds
        (the request payload's sopSteps with sopStepsWhen 'always', 2.6). Its length
        is stepCount
  A database from before 20261028a sends neither key; the form then draws no routing
  marks and shows only the step count (6.7). The TypeView that cockpit_request_type_save
  and cockpit_request_type_restore return carries neither key (cockpit_request_type_view
  is unchanged): re-read the types for them

PartRow = {part, listName, teamLabel, taskName, owner: {label, how, note}, state, error,
  url, status, statusType, verifyState, verifyNote}

RequestRow = {id, typeKey, typeLabel, team, teamLabel, clientTaskId, clientName,
  requesterLabel, mine, dueOn, priority, state, done, createdAt, source,
  canCancel, canRoute, importHandled, held, heldNote, parts: [PartRow]}
  held: saved, not sent (cockpit_request_held); heldNote: "Saved, not sent yet. It goes to ClickUp once requests open." or null,
    and (review round 3) when the writer is silent for that card (cockpit_request_writer_silent) "Saved, not sent yet: the
    requests writer has not reported in the last 15 minutes. It goes to ClickUp once the writer runs again."
  importHandled (review round 3): an import whose old ticket was moved, closed or deleted in ClickUp (cockpit_request_import_handled)
  PartRow.owner.note: as the reading seat sees it (D12)
```

A select field's `options` come from the catalog when it has a ClickUp
field; a catalog field in state `missing` is returned with `options: []`
and the form says "This choice could not be read from ClickUp. Ask the
systems manager."

| Function | Gate | Returns and rules |
|---|---|---|
| `cockpit_request_types_read()` | any active seat | `{asOf, seat: {label, link, teams, editor, all}, writer: {mode, canSend, held, note}, types: [TypeView]}`, and for editors only `catalog: [{clickupFieldId, clickupName, label, kind, options, state}]` and `templates: [{id, name, state}]` (the field catalog and the template cache the type editor picks from). Non-editors get enabled types only; the form offers enabled types only, to editors too. `all` is true for an editor, an admin or the CEO. Order: team (Client Success, Operations / Tech, Marketing / ADs, Media/Creative, Call Center), then `type_index`. Since 20261028a every part of every type carries `when` and `steps` (TypeView above), for every seat, editors included; nothing else in the answer changed |
| `cockpit_request_clients(p_search text DEFAULT NULL, p_include_stopped boolean DEFAULT false)` | any active seat | `{clients: [{taskId, name, status}], more}` (`more` is true when over 30 cards match): `cockpit_client_onboarding` rows where `cockpit_client_allowed(client_name)`, name `ILIKE '%'||search||'%'`, Stopped and GHOSTED left out unless asked, ordered by name, 30 at most |
| `cockpit_request_preview(p_type_key text, p_client_task_id text DEFAULT NULL, p_answers jsonb DEFAULT '{}')` | any active seat | `{parts: [{part, listName, teamLabel, taskName, templateName, stepCount, stepsDraft, owner}], note, dueDefault, writer: {canSend, held, note}}` (`owner.note` as the seat sees it, D12). When no target runs yet (its `when` field is unanswered), `parts` is empty and `note` is "Pick {field label} to see where it goes." Writes nothing |
| `cockpit_request_submit(p_request_id uuid, p_type_key text, p_client_task_id text, p_answers jsonb, p_due_on date, p_priority text, p_source text, p_replaces_task_id text DEFAULT NULL)` | any active seat, then `cockpit_request_send_gate()->allowed` | See below. Returns `{id, state, reused, duplicateOf, note, held, parts: [PartRow]}`; a held request has `held: true` and `note` = the gate's sentence ("Requests are not open yet. What you send is saved and goes to ClickUp once they are.", review round 2) |
| `cockpit_request_cancel(p_request_id uuid, p_reason text)` | the requester, or `cockpit_request_sees_all` (an editor, an admin or the CEO; a team-only one within its client limit) | Refused once any part is `sending`, `delivered` or `unknown`, or any part or queue row has a ClickUp task (a `retry` after the task was made included), or a `queued` or `retry` queue row has a create step on record (`cockpit_request_queue_in_clickup`, review round 3): "Part of this request is already in ClickUp. Close it there." Otherwise every part's queue row in `queued`, `retry` or `dry_run` goes to `skipped` with "Cancelled in the cockpit.", the parts to `skipped`, the request to `cancelled`; audit `request.cancelled`. A request that routed an old form ticket puts the import back to `imported`, `routed_to` null, audit `request.unrouted` (metadata why `cancelled`; review round 2). Returns RequestRow |
| `cockpit_requests_read(p_view text, p_limit integer DEFAULT 50, p_since timestamptz DEFAULT NULL)` | any active seat; `all` needs editor, admin or CEO | `{asOf, view, views: [{key, label, count}], rows: [RequestRow], note}`. `p_since` (integration round 2, contract F3): only the rows created at or after it, so a card about today reads today's rows on the server; the views' counts are not filtered. `mine`: requester is the seat. `assigned`: a part whose `owner_clickup_id` or mirrored `assignee_ids` holds the seat's ClickUp id, request not done or cancelled (an unlinked seat gets no rows and the note "Your seat is not linked to a ClickUp user, so requests assigned to you cannot show. Ask the systems manager to link it."; a seat an editor cleared, `linkState` `cleared`, reads "Your seat has no ClickUp user, so nothing is assigned to you here. Requests you raise show under My requests.", review round 3). `team`: the type's team or a part's team is one of the seat's teams, not done or cancelled, imports included (an import's part sits on All Tasks, so its type's team decides) but not one handled in ClickUp (`cockpit_request_import_handled`, which `assigned` leaves out too; review round 3), and within the client limit every other screen uses: a request for a client needs `cockpit_client_allowed(client_name)` (a team-only seat's empty list is no client, 20261017b); one with no client is not shown to a team-only seat (review R1, SEC-1). `all`: everything, but a team-only seat named an editor keeps its client limit, in the rows and the count (review round 2). Open first (not done, cancelled or routed, and not an import handled in ClickUp), then `due_on` ascending with nulls last, then newest. `p_limit` 1 to 200. `views` lists only the views the seat has: `mine` "My requests", `assigned` "Assigned to me", `team` "{team label} queue" (one label per team; two teams read "Team queue"), `all` "All requests" |
| `cockpit_request_get(p_request_id uuid)` | `cockpit_request_may_open`: the requester, an owner or assignee of a part, a seat whose teams hold the type's or a part's team **and that may see the client** (as the `team` view), an editor, an admin or the CEO (a team-only one within its client limit) | RequestRow plus `{answers: [{key, label, display}], details, replacesTaskId, routedTo, history: [{at, what, byLabel}]}` from this request's audit rows; `request.unrouted` reads "Back in the queue: the request that routed it was cancelled" or "Back in the queue: the request that routed it did not reach ClickUp" (review round 2). Review round 3 adds "Left All Tasks: moved, closed or deleted in ClickUp" and "Back on All Tasks in ClickUp" (audit `request.import_left`, 2.10), and "{team}: ClickUp did not answer; checked once requests open" (a create whose answer was lost, handed back `unknown` while requests are not open) |
| `cockpit_request_type_save(p_key text, p_patch jsonb, p_expected_version integer)` | `cockpit_forms_editor_gate()` | Allowed patch keys: `label`, `targets`, `fields`, `sop_steps`, `sop_url`, `due_days`, `priority`, `set_request_type`, `enabled`; any other key refuses. A version other than the current refuses: "Someone saved this type since you opened it. Reload to see their change." A named person must be an active row of `cockpit_clickup_members`: "That person is not in the ClickUp workspace. Pick someone from the list." A template must be a `cockpit_request_templates` row in state `ok`: "That template is not in ClickUp any more. Pick another." Saving `sop_steps` sets `sop_steps_state = 'saved'`. Bumps `version`, inserts a versions row (note `Saved`), audit `request_type.saved` with the whole old and new rows. Returns TypeView (editor) |
| `cockpit_request_type_versions(p_key text)` | editor gate | `{versions: [{version, savedAt, savedByLabel, note}]}` newest first |
| `cockpit_request_type_restore(p_key text, p_version integer, p_expected_version integer)` | editor gate | Writes that version's row back as a new version (note `Back to version {n}`), same checks and audit (`request_type.restored`). It never turns `set_request_type` on: the new value is the version's AND the current one (review round 2). When it kept it off: version note "Back to version {n}. Request Type stays off.", audit metadata `requestTypeKeptOff: true`, and the return is TypeView plus `restoreNote` "Request Type stays off. Version {n} had it on, but it is off now; turn it on with its switch once the rehearsal ticket shows ClickUp keeps the task where it is." (else `restoreNote` null). The type editor's toast reads "Back to version {n}. " plus that note |
| `cockpit_request_people()` | editor gate | `{people: [{clickupUserId, label, seat: {memberId, label} or null}]}` from active `cockpit_clickup_members`; `label` is the username for an editor's picker |
| `cockpit_member_clickup_read()` | editor gate | `{readAt, seats: [{memberId, label, roles, link: {state, clickupUserId, username, matchedBy, note, checkedAt} or null}], members: [{clickupUserId, username, linkedTo}]}`; active seats only; `label` is "first name, role" (`cockpit_slack_notice_seat_label`) |
| `cockpit_member_clickup_set(p_member_id uuid, p_clickup_user_id bigint)` | editor gate | Null clears (`state 'cleared'`, never relinked by email). Otherwise the id must be an active member: `state 'manual'`, `matched_by 'editor'`. Refused (review R1, SEC-3): an editor's own seat unless the editor is the CEO (`42501` "You cannot link your own seat. Ask the CEO or another editor to do it."); a ClickUp user another active seat holds (`23505` "That ClickUp user is already linked to another seat. Clear that link first."); the API user `284616470` on any seat but the CEO's (`22023`). The hourly email match never takes a user another active seat holds (`ambiguous`). The audit trigger records each change with the editor's address. A seat newly linked to a ClickUp user (no link before, a link that was not `ok` or `manual`, or another user) calls `cockpit_task_mirror_kick('seats')` inside an exception block, so its older open tasks reach the mirror at once rather than at the next :11 (review round 3). Returns the seat row of `_read` |

**`cockpit_request_submit` in order:**

1. Seat; `cockpit_request_send_gate(seat, p_client_task_id)` raises its
   sentence (errcode `55000`) when `allowed` is false. A held request is
   filed as any other; its queue rows wait queued (2.8).
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
   writes nothing. `duplicateOf` is set only when
   `cockpit_request_may_open(existing, seat)`; otherwise `duplicateOf: null`
   and the note "An open {type} request for {client} already exists, raised
   by {requester role}. Ask them about it.", or for an old form ticket "An
   open {type} request for {client} already exists. It came in through the
   old ClickUp form and waits in the {team label} queue." (review round 2).
   An import handled in ClickUp is never the duplicate (review round 3).
8. Replaces (checked before step 7, so routing an old ticket is never its
   own duplicate): `p_replaces_task_id` must be an import row's task id still
   in state `imported` and not handled in ClickUp (`cockpit_request_import_handled`,
   review round 3), checked first ("That old ticket was already routed.",
   `55000`; the same sentence lets a request filed again with `replacesIfOpen`
   go on its own); the seat must
   pass `cockpit_request_can_route` (the rule that shows Route; `42501` "Only
   that team, an editor, an admin or the CEO can route this old ticket.");
   when the import has a card, `p_client_task_id` must be that card ("This
   old ticket is for {client}. Route it for that client."). In
   `apply_limited` a ticket with no card cannot be routed onto a card the
   writer takes (`cockpit_request_writer_takes` and not
   `cockpit_request_replaces_ok`; `55000` "This old ticket has no client card, so it cannot go
   out on the internal test card. Route it for its own client, or with none;
   it waits until requests open to everyone.", review round 2). That row
   moves to `routed`, `routed_to` set; it goes back to `imported` when the
   routing request is cancelled or fails before its replaces step (2.7).
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
| `cockpit_clickup_writeback_claim_requests(p_token uuid, p_limit integer DEFAULT 6) returns jsonb` | The live claim's shape, for kinds `request` and `task_action` only, limit 1 to 10. It takes only what the writer would send, by the mode the writer last reported (`cockpit_clickup_requests_mode`): nothing in `dry_run` or `unknown`; in `apply_limited` only rows whose `payload.clientTaskId` is a canary card, and 2-minute checks (review R1), and a `request` row that routes an old form ticket only when that ticket's own card is a canary card (`cockpit_request_replaces_ok`, review round 3). A switch flip shows from the run after (the writer reports its mode every run). One lane per task: a row whose `task_id` is not null is skipped while an older row with the same `task_id` is `queued`, `sending`, `retry` or `unknown`, except a 2-minute check (`op 'verify'`) that is not due yet (section 13). `source_exists`: `request` when the request exists and is not `cancelled`; `task_action` true. Each `request` row also carries `replaces_task_id`, from its request's `cockpit_requests.replaces_task_id` (null for a `task_action`), so every part of a routing request reads its old ticket before it makes anything, even one claimed in a later run than the first part (review round 2; retest round 2). Each `request` row also carries `replaces_client_task_id` (the old ticket's own card, null when it has none; review round 3), so the writer holds such a row itself in the run right after a switch flip, which still claims by the mode reported before it |
| `cockpit_request_sweep() returns integer` | Inserts the missing queue row for any part in `queued` with no `queue_id` (the second source) |
| `cockpit_clickup_writeback_release(p_id uuid, p_token uuid, p_planned jsonb, p_note text, p_next_attempt_at timestamptz) returns jsonb` | A `request` or `task_action` row the writer claimed (state `sending`, its token) but will not send now goes back: a `request` row with no task id, no `progress.task` and a create step on record stays `unknown` (its create went out and lost its answer; the task may be in ClickUp, so the screens say "checking", cancel stays refused and the writer reads it back before anything else; review round 3); else `retry` when `progress` has `task` or any `steps`, else `queued`; `attempts - 1` (not below 0); token and `claimed_at` cleared; `planned` = `p_planned` when an array; `error` = `p_note` (500 chars) when given; `next_attempt_at` = `p_next_attempt_at` or now. Anything else refuses "This queue item is no longer claimed by this run". The part follows through the sync trigger; the queue's audit trigger records it. Returns `{id, state}`. Request and task_action rows are never settled `dry_run` any more |
| `cockpit_clickup_writeback_task_owners(p_task_ids text[]) returns jsonb` | `[{taskId, queueId}]`: the `request` queue rows whose `task_id` is one of these (the writer never adopts another part's task) |
| `cockpit_clickup_requests_state(p_ok boolean, p_note text, p_mode text, p_only_cards text[], p_counts jsonb) returns void` | Upserts `cockpit_sync_state` key `clickup-writeback:requests` (`last_ok_at` only when ok; `detail = {mode, onlyCards, counts, at}`). Every run of the job calls it |
| `cockpit_request_doctor_inputs() returns jsonb` | `{types: [{key, optionId, optionName, setRequestType, targets: [{part, listId, templateId, ownerClickupId}], fieldIds}], templates: [{id, name}], lists}` |
| `cockpit_request_type_rt_off(p_key text, p_note text) returns void` | `set_request_type = false`, version plus one, versions row (`saved_by 'clickup-writeback'`, note), audit `request_type.request_type_off` (metadata `waitingRowsTurnedOff`). The type's `request` rows still waiting (`queued`, `retry`) get `payload.setRequestType = false` too (also when the type was already off); a row being sent or delivered keeps its own 2-minute check, whose payload carries Request Type as it was sent (review R1, RT-5) |
| `cockpit_clickup_members_sync(p_members jsonb) returns jsonb` | Upserts `cockpit_clickup_members` from `[{id, username, email}]` (members not in the list become `active false`). Then for every active seat without a `manual` or `cleared` row: one active member with the same lower-case email gives `ok`, none `not_found`, more than one `ambiguous`. Returns `{members, linked, notFound, ambiguous}` |
| `cockpit_request_field_catalog_sync(p_fields jsonb) returns jsonb` | From `GET list/901816723190/field` (`[{id, name, type, options}]`): updates `clickup_name`, `options` and `read_at` of catalog rows, marks catalog rows absent from the read `missing` (rows come back to `ok` when seen). A field ClickUp added is inserted (state `ok`, `label` = its name, used by no type until an editor maps it) when its type is one a request can write: `short_text` (text), `text` (longtext), `url`, `number`, `drop_down` (select, with its options); other types, and `e9fd8024`, `09abf737` and `d3ac52c5`, are counted as `skipped` and never added (review R1, F11; review round 2). Returns `{updated, missing, added, skipped}` |
| `cockpit_request_templates_sync(p_templates jsonb) returns jsonb` | Upserts `[{id, name}]`; rows absent become `missing`. Returns `{seen, missing}` |
| `cockpit_request_import(p_tasks jsonb, p_open_ids text[] DEFAULT NULL) returns jsonb` | Section 2.10. The one-argument version is dropped (review round 3) |

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
    ownerClickupId, typeKey, setRequestType, clientTaskId, ownerAt, madeAt}`
    (`ON CONFLICT DO NOTHING`). Then `cockpit_request_refresh`. Review round
    3: the payload says what the part's steps did, not what the frozen
    payload asked for: `setRequestType` is true only when the `request_type`
    step set Request Type (`done`) or found it set (`unchanged`); `ownerAt`
    is when the owner was written (the `owner_due_priority` step on a template
    part, else the create); `madeAt` is the part's last task write the check
    judges (the `request_type` step when it set Request Type, else
    `ownerAt`). Each comes from `cockpit_request_step_at`. The writer times
    "on time" from them (4.4), not from delivery, which a retried later step
    (the card comment, the old ticket) can push hours past the writes it
    checks.
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
  `status_type` is `done` or `closed`, and cleared when one reopens. A
  request with `replaces_task_id` that ends `failed`, or `partial` with the
  queue row carrying `replacesTaskId` failed or skipped and no
  `progress.steps.replaces`, puts its import back to `imported`
  (`cockpit_request_unroute`, audit `request.unrouted`, why `failed` or
  `partial`, actor `clickup-writeback`; review round 2).
- `cockpit_request_type_guard` (2.2), the no-delete triggers, the audit
  triggers on `cockpit_member_clickup`.

### 2.8 Who may send, by the writer's mode (`cockpit_request_can_send`)

Review R1 (2026-10-26, binding): a request the writer will not send now is
**held**, never a dead dry run. `cockpit_request_send_gate` answers
`{allowed, held, note}`:

Since `20261029p` (2026-10-29, docs/requests/CLICKUP-DOWNGRADE.md 4.2)
**every seat** may file: a request the writer will not send now is held for
anyone, `allowed` is always true, and no note names a ClickUp form (the
cockpit's own form replaced it, so the CEO can move to ClickUp Business):

| Mode | Seat | Answer |
|---|---|---|
| `apply` | any | sends (`allowed`, not held, note null) |
| `apply_limited`, card in `onlyCards` | any | sends |
| `apply_limited`, another card or none | any | held: "Requests are being tested on the internal test card only, where they go to ClickUp at once. Anything else you send is saved and goes to ClickUp by itself once they open to everyone." |
| `dry_run` | any | held: "Requests are not open yet. What you send is saved and goes to ClickUp by itself once they are." |
| `unknown` | editor, admin or CEO | held: "The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself once it runs with requests open. Check it on the Machine tab." |
| `unknown`, last report `apply` (`lastMode`) | anyone else | held: "The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself when the writer is back." |
| `unknown`, last report `apply_limited` | anyone else | held: on a canary card (`cockpit_request_writer_silent` is true for it), the quiet-writer note "…goes to ClickUp by itself when the writer is back.", the same as the row's held note; on another card or none, the `apply_limited` note above |
| `unknown`, no report or last report `dry_run` | anyone else | held: the `dry_run` note above |

Before 20261029p a seat that was not an editor, an admin or the CEO was
refused in every mode but `apply` (and `apply_limited` on the test card) and
told to use the ClickUp request form (review R1, round 3). The form still
draws a refusal (`canSend` false) for a database that has not taken
20261029p, in its own words when the note is empty: "Requests cannot be
sent from this seat just now. Tell the systems manager."

The form shows a held note before anything is sent and beside Send, so none
begins "Saved." (review round 2); the request itself still says "Saved, not
sent yet. It goes to ClickUp once requests open." (`heldNote`), or, when the
writer went quiet after it was sending that card (`cockpit_request_writer_silent`,
review round 3), "Saved, not sent yet: the requests writer has not reported in
the last 15 minutes. It goes to ClickUp once the writer runs again."

A held request's parts stay `queued` and its request `sending`; RequestRow
says `held` with `heldNote`. The requests claim takes nothing the writer
would not send (2.6), and the writer hands back any row it claims but will
not send (`cockpit_clickup_writeback_release`, its note "Waiting in the
queue: ..." lands on the part's `error`). When requests open, the rows go on
the next run with no requeue by hand. `cockpit_request_types_read` and
`_preview` return the same answer as `writer: {mode, canSend, held, note}`
(the preview without `mode`), so the form says it before anyone types;
`canSend` means "may file now", held included. `canRoute` uses the same gate,
so it never implies sending.

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
"Came in through the old ClickUp form. Make it a request to route it." where
the seat may route it (`canRoute`), else "Came in through the old ClickUp
form. Route it in ClickUp." (review round 2).

Review round 3: `p_open_ids`, given only after a complete hourly read of All
Tasks (every page; 5.3 step 5), is every task found open there (status type
not `done` or `closed`), form ticket or not; NULL when the read was cut short.
An import whose ticket is not among them left All Tasks or was closed or
deleted in ClickUp: `import_left_at` is set, so it leaves the queues
(`cockpit_request_import_handled`). One a complete read finds again has it
cleared. The return then adds `left` and `back` (counts), and one audit row
`request.import_left {left: [task ids], back: [task ids]}` is written when
either is non-empty. Two seats runs at once (the hourly one and a hand link's)
import a ticket once (`ON CONFLICT (imported_task_id) DO NOTHING`). A handled
import reads "Came in through the old ClickUp form. It was moved or closed in
ClickUp, so it needs no routing here." (6.6).

### 2.11 Grants (end of migration r)

- Internal: every function in 2.4 (review round 3 added
  `cockpit_request_writer_silent(text)`, `cockpit_request_replaces_ok(text,jsonb)`,
  `cockpit_request_import_handled(cockpit_requests)`,
  `cockpit_request_queue_in_clickup(cockpit_clickup_writeback_queue)` and
  `cockpit_request_step_at(jsonb)`), the triggers' functions.
- `service_role`: `cockpit_clickup_writeback_claim_requests(uuid,integer)`,
  `cockpit_request_sweep()`, `cockpit_clickup_writeback_release(uuid,uuid,jsonb,text,timestamptz)`,
  `cockpit_clickup_writeback_task_owners(text[])`, `cockpit_clickup_requests_state(boolean,text,text,text[],jsonb)`,
  `cockpit_request_doctor_inputs()`, `cockpit_request_type_rt_off(text,text)`,
  `cockpit_clickup_members_sync(jsonb)`, `cockpit_request_field_catalog_sync(jsonb)`,
  `cockpit_request_templates_sync(jsonb)`, `cockpit_request_import(jsonb,text[])` (review round 3);
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
| `client_task_id` | text | NULL: the card itself on `901816559981`, and for a card's subtask its card (the parent when it is a card, else the parent's own card; integration round 2); else the part's request card; else one tag equal to a card's `lower(client_name)` |
| `url` | text | NOT NULL |
| `date_created`, `date_updated` | timestamptz | NOT NULL |
| `date_closed` | timestamptz | NULL |
| `archived` | boolean | NOT NULL DEFAULT false |
| `checklist_done`, `checklist_total` | integer | NULL |
| `comments_read_at` | timestamptz | NULL (read up to the moment that thread's read began) |
| `comments_failures` | integer | NOT NULL DEFAULT 0: comment thread reads that failed in a row |
| `comments_failed_at` | timestamptz | NULL: when the last one failed |
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
| `scope` | text | NULL (every cockpit), `editor` (only the editor desk) or `not_editor` (every cockpit but the editor desk); used by a due today count that holds Video Pipeline tasks |
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

No alert before `baselinedAt`. Review R1 (contract F1): `assigned` and
`status` come from **every** mirror write (the delta, the hourly seat read,
the focus view's read and its cache), through one shared diff
(`cockpit_task_mirror_changed(old, cur, p_real, p_base)`), so no read
swallows a change. They need a change ClickUp itself reports (`p_real`: its
`date_updated` moved on, or the live read's status differs), so the mirror
correcting itself (a seat read putting back an id `cockpit_task_mirror_seat`
took off) never alerts; and a task new to the mirror alerts a seat only when
it changed after the baseline and after that seat was linked, so linking a
seat later never floods its bell. Alerts go only to active seats with a
linked ClickUp id (requests alerts: to the requester's seat, linked or not),
only for kinds in the seat's rules, never for a client card itself (a
top-level task on `901816559981`) except `mention` (a real subtask of a card
alerts as any task, ask F2), and never to the person who caused the event
when that is known. ClickUp's task read names no one who moved a task, so
the only mover known is a seat's own focus view Mark done, while it is on its
way or just delivered (review round 2): a `status` alert still goes to an
assignee who moved the task in ClickUp themselves (F9, a known limit; history
reads would cost a call per task).

| Kind | Made by | When | Dedupe key | Title / body |
|---|---|---|---|---|
| `assigned` | `cockpit_task_mirror_changed` (every mirror write) | A real change (above) puts a linked seat's id in `assignee_ids` that was not in the old ones; or the row is new to the mirror and changed after the baseline and the seat's link. Skipped when the seat is the task's creator on a new task, or the seat filed the request that made it | `assigned:{task}:{member}:{date_updated ms}` | task name / "Assigned to you" |
| `status` | `cockpit_task_mirror_changed` (every mirror write) | `status` changed on a task assigned to the seat, unless the new status is done or closed and that seat has a `task_action` op `done` on the task still `queued`, `sending`, `retry` or `unknown`, or `delivered` no more than 10 minutes before ClickUp's change (within 24 hours; `cockpit_task_own_done`); a tick or comment press hides nothing (review round 2) | `status:{task}:{member}:{status}:{date_updated ms}` | task name / "Moved to {status}" |
| `comment` | `cockpit_task_mirror_comments` | A comment newer than the cut-off (below) on a task assigned to the seat, not by the seat, not on a client card itself. Comments by the API user `284616470` alert only when they carry a focus view's `Cockpit ref T-{hex}` (the actor is that queue row's seat); with another cockpit marker they are the cockpit's, and with none they are the CEO's own account (by hand or an automation; ClickUp cannot tell), labelled "the CEO" but making no comment alert (F8) | `comment:{comment id}:{member}` | task name / "{actor role} commented" or "A teammate commented" |
| `mention` | `cockpit_task_mirror_comments` | A comment part `{type: 'tag', user.id}` or `assignee.id` equal to the seat's id, on any task, not by the seat. A mention replaces the comment alert for that seat. The API user with no marker mentions as "The CEO"; with a cockpit marker, "You were mentioned in a comment" | `mention:{comment id}:{member}` | task name / "{actor role} mentioned you" |
| `due_today` | `cockpit_task_alerts_tick` | Once a Kuwait day, after the seat's shift start, on a working day of the seat, counting the tasks due today **on the seat's Your tasks** (`cockpit_task_my_set`: subtasks fold under a listed parent, client cards themselves left out; contract F2). When the editor desk's count differs (it keeps Video Pipeline on its Jobs page), two rows: the full count with `scope 'not_editor'` and the desk's count (when above 0) with `scope 'editor'` | `due_today:{member}:{day}` (and `…:editor`) | "{n} tasks are due today" (1: "1 task is due today") / "Open Your tasks to see them." (`task_id` null) |
| `overdue` | `cockpit_task_alerts_tick` | After the seat's shift start, for each open task assigned to the seat (not a client card itself) with `due_on` before today and on or after the later of the baseline's day and the day the seat's link was made | `overdue:{task}:{member}:{due_on}` | task name / "Was due {Sun 26 Oct}" |
| `request_done` | `cockpit_task_mirror_changed` (every mirror write) | A request part's mirrored `status_type` becomes `done` or `closed`; not to the requester when their own Mark done made it (the same rule as `status`, review round 2) | `request_done:{request}:{part}` | "{type label}: {client}" / "Done in ClickUp." or "Closed in ClickUp." |
| `request_failed` | trigger on `cockpit_request_parts` | A part's state becomes `failed` or `skipped` and the request is not cancelled | `request_failed:{request}:{part}` | "{type label}: {client}" / "Did not reach ClickUp: {error}", or "Deleted in ClickUp: {error}" for a `failed` part that holds a ClickUp task (the writer fails such a part only when its task was deleted in ClickUp, `SAY.gone`; integration round 4) |

Comment cut-off: `coalesce(comments_read_at, greatest(baselinedAt,
first_seen_at - interval '10 minutes'))`.

Shift start: the rules' `shift_start`; else the seat's `cockpit_people`
row (by email) `schedule->'week'->{sun..sat}` for today, `on` and `start`,
in `schedule->>'timezone'` (default `Asia/Kuwait`); else 10:00 Kuwait on
Sunday to Thursday. A day whose schedule says `on: false`, or a Friday or
Saturday with no schedule, makes no daily alert.

### 3.3 Browser RPCs (`GRANT EXECUTE ... TO authenticated`)

`p_cockpit` is `portal`, `media_buyer`, `csm`, `creative`, `editor` or
`sales`; anything else refuses. `cockpit_task_hidden(p_cockpit, p_list,
p_kind, p_top)` (review R1, asks F1 and F2): every list leaves out a client
card itself (a top-level task on `901816559981`), never a real subtask of a
card; `editor` also leaves Video Pipeline `901816720767` out of **Your
tasks** (the Jobs page lists them, TD 2.4) but never out of its bell: the
editor's own pipeline alerts always show. The bell applies an alert's
`scope` too (3.1).

```
TaskRow = {taskId, title, clientName, clientTaskId, listId, listName, status, statusType,
  dueOn, dueAt, dueHasTime, overdue, dueToday, priority, url, createdAt, parentId,
  checklist: {done, total} | null, requestId, requestTypeLabel}
MyTasks = {asOf, sourceAt, ready, link, linkState, note, counts: {overdue, today, total}, tasks: [TaskRow], more}
AlertRow = {id, kind, taskId, requestId, title, body, clientName, at, read}
TaskAlerts = {asOf, sourceAt, ready, link, linkState, note, unread, alerts: [AlertRow]}
  linkState (review round 3): the seat's link row state (cockpit_request_seat), so a seat an editor
  cleared is told it has no ClickUp user and is never sent to link it
```

| Function | Gate | Rules |
|---|---|---|
| `cockpit_my_tasks(p_cockpit text)` | any active seat | `link 'not_linked'`: `tasks []`, `note` = the not-linked sentence (6.6), or for a seat an editor cleared (`linkState` `cleared`, review round 3) "Your seat has no ClickUp user, so no ClickUp tasks show here. Requests you raise show under My requests.". Else open tasks (`status_type` not `done` or `closed`, not archived, `gone_at` null) whose `assignee_ids` hold the seat's id, minus a subtask whose parent is also in the set. Order: overdue (`due_on` before today, or `due_has_time` and `due_at` before now) oldest due first; then due today; then everything else newest `date_created` first. At most 200 rows; `more` = the rest. `sourceAt` = `task-mirror:delta` `last_ok_at`; `ready` = that row ok and at most 10 minutes old |
| `cockpit_task_alerts(p_cockpit text)` | any active seat | The seat's alerts of the last 14 days, newest first (ties ordered by id), at most 50, the cockpit's list filter applied; `unread` counts the unread among the at most 50 returned, so Mark all read clears the count (review round 2). `link`, `linkState` and `ready` as above; request alerts show even when not linked. The not-linked note is "Your seat is not linked to a ClickUp user, so only request alerts show here. Ask the systems manager to link it.", or for a cleared seat "Your seat has no ClickUp user, so only request alerts show here." (review round 3) |
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
  actions: [{id, op, state, error, at, itemId}],   (this seat's own task_action rows on this task of the last 24 hours, newest first; another seat's action ids never leave the database, SEC-5)
  can: {tick, comment, done, why},
  writer: {mode, live}}
```
Comment authors come out as labels at read time
(`cockpit_request_owner_label`; the API user `284616470` is the CEO's own
account: with a `Cockpit ref T-` that matches a press, that seat's role;
with any other cockpit marker, "the cockpit"; with none, "the CEO", and
`mine` for the CEO's seat; F8). Only a `Cockpit ref` that ends the text
counts, and a `T-` ref names only a Comment press on the same task (review
round 2, SEC-5); a marker's tail may hold an underscore (a part named
`call_center` writes `R-…-call_center-card`), and the focus view cuts the
ending marker from the text (retest round 2). Comment text is cut to 1,000
characters, keeping a trailing `Cockpit ref …` last and never ending on half
a surrogate pair (cockpit-tasks `commentText`, review round 2): a focus view
comment may hold 2,000 characters (3.4), and the mirror keeps its first
1,000 with the marker still last, so its writer stays known. The newest 10
comments.

### 3.4 Task actions (`cockpit_task_act`)

| Op | `p_payload` | Lists allowed |
|---|---|---|
| `tick`, `untick` | `{checklistId, itemId, itemName, from}` (`from` the resolved state the person saw) | any task but a client card itself |
| `comment` | `{text}` 1 to 2000 chars | any task but a client card itself |
| `done` | `{statusSeen}` | any task but a client card itself, Video Pipeline `901816720767` and WhatsApp Reconnection `901821803697` |

Review round 2 (ask F12): a seat's own tasks on any list take a tick, a
comment and Mark done in the focus view, not only the team request boards.
A client card itself (a top-level task on `901816559981`) takes no change
from the cockpit; its real subtasks (ask F2 put them on Your tasks) take all
three, in `cockpit_task_can`, `cockpit_task_act` and the writer alike.
Mark done writes the list's done-type status, which on two lists sets more
off than closing a task, so it is not offered there
(`cockpit_task_done_blocked`, and `DONE_BLOCKED` in the writer): on Video
Pipeline done means the video is live, and on WhatsApp Reconnection a status
change messages the client. Mark done on a card's subtask uses the done
status of Clients - Mahara; with none, the writer fails the press with
"Clients - Mahara has no done status in ClickUp. Mark it done there."

Checks in order, each refusing with its sentence (`55000`):
seat linked, or admin or CEO ("Link your seat to ClickUp to tick, comment
and mark done here. Ask the systems manager.", or for a seat an editor cleared
"Your seat has no ClickUp user, so you cannot tick, comment or mark done here.
Ask the task's owner."; internal `cockpit_task_link_why(jsonb)`, review round
3); the task is in the mirror;
the task allows the op ("This is a client card. Open it in ClickUp." for any
change on a card itself / for `done`: "Mark done is not offered on Video
Pipeline, where done means the video is live. Move it in ClickUp." or "Mark
done is not offered on WhatsApp Reconnection, where a status change messages
the client. Move it in ClickUp."); `cockpit_clickup_requests_mode()` is
`apply`, or `apply_limited` with the task's `client_task_id` in `onlyCards`
("Changes from the cockpit are not switched on yet. Open the task in
ClickUp.", or when the writer went quiet after it was writing that card,
`cockpit_request_writer_silent`, "Changes from the cockpit cannot be sent just
now: the requests writer has not reported in the last 15 minutes. Open the task
in ClickUp."; internal `cockpit_task_writer_why(text)`, review round 3). `cockpit_task_can` gives the same answer as `{tick, comment,
done, why}`. Comment words matching `(?i)cockpit\s+ref\s+[a-z0-9]` are
refused (`22023`) "Leave out the words "Cockpit ref". The cockpit adds its own
to every comment." (review round 2, SEC-5); the writer refuses such a row too
(failed with the same sentence, never posted; retest round 2).

Then one queue row: `kind 'task_action'`, `dedupe_key 'task:{p_action_id}'`,
`source_table 'cockpit_task_mirror'`, `source_id` = the task id, `task_id` =
the task id, payload:

```json
{"actionId": "uuid", "ref": "T-<10 hex the database chose>", "op": "tick", "taskId": "…", "listId": "…",
 "clientTaskId": "…", "checklistId": "…", "itemId": "…", "itemName": "…", "from": false, "to": true,
 "text": null, "statusSeen": null,
 "actor": {"memberId": "uuid", "clickupUserId": 113459516, "label": "the systems manager", "isAdmin": false},
 "requesterOfTask": false}
```
`actor.isAdmin` is true for an admin seat or the CEO; `requesterOfTask` is
true when the seat filed the request this task came from. `ref` is chosen by
the database (`T-` and 10 hex of an md5 over the action id, the clock and a
random number), never made from the browser's action id, so no press can
take another's comment marker (review R1, SEC-5).
A repeat with the same id and payload returns it with `reused: true`; a
different payload refuses "This change was already sent. Reload the task."
One audit row `task.act` (`metadata`: op, task id, item id; never the
comment text). Then the kick of 2.9, inside an exception block.

### 3.5 Service RPCs (`GRANT EXECUTE ... TO service_role`)

| Function | Does |
|---|---|
| `cockpit_task_mirror_inputs() returns jsonb` | `{cursorMs, baselinedAt, teamId: '90182518398', linked: [{memberId, clickupUserId}], allTasksList: '901816723226', fieldsList: '901816723190', deltaTruncated}` (`deltaTruncated`: the last delta's `detail.truncated`, false when absent) |
| `cockpit_task_mirror_upsert(p_tasks jsonb, p_source text) returns jsonb` | `p_source` is `delta`, `seat` or `detail`; at most 200 rows (MirrorTask, 5.2). Upserts rows (sets `seen_at`, clears `gone_at`), computes `due_on` and `client_task_id`, then each row through `cockpit_task_mirror_changed` (internal): the matching `cockpit_request_parts` (`status`, `status_type`, `assignee_ids`, `mirrored_at`) and `cockpit_request_refresh`, and the 3.2 alerts from any source (none before the baseline). Returns `{upserted, alerts, skipped}` |
| `cockpit_task_mirror_seat(p_clickup_user_id bigint, p_task_ids text[]) returns jsonb` | For open mirror rows holding that id but not in `p_task_ids`, removes the id from `assignee_ids` (the next delta has the truth); rows no read has seen for 7 days get `gone_at`. Returns `{removed}` |
| `cockpit_task_mirror_comment_due(p_limit integer) returns jsonb` | Up to `p_limit` (at most 60) `[{taskId, sinceMs}]`: rows updated in the last 24 hours whose `date_updated` is after their cut-off, tasks assigned to a linked seat first, then the rest by `date_updated`. A task whose thread reads failed waits `least(2 minutes × 2^(failures - 1), 1 hour)` after the last failure |
| `cockpit_task_mirror_comments(p_task_id text, p_comments jsonb, p_read_at timestamptz DEFAULT now(), p_failed boolean DEFAULT false) returns jsonb` | `p_comments` = `[{id, authorId, atMs, text, tagIds, assigneeId, parentId}]` (text cut to 1,000 characters by cockpit-tasks `commentText`, keeping a trailing `Cockpit ref …` last and never ending on half a surrogate pair, review round 2). Makes 3.2's comment and mention alerts, sets `comments_read_at` to `p_read_at` (the moment that thread's read began, at most now, never back in time; F6) and clears the failure count. With `p_failed`: no alert, `comments_read_at` untouched, `comments_failures + 1`, `comments_failed_at = now()`. Two-argument callers still work. Returns `{alerts}` |
| `cockpit_task_alerts_tick() returns jsonb` | 3.2's `due_today` and `overdue` for every linked seat. Returns `{dueToday, overdue}` |
| `cockpit_task_detail_cache(p_task_id text, p_detail jsonb) returns void` | Stores `{dueHasTime, description (2000 chars), checklists, subtasks, comments: [{id, authorId, atMs, text}], statuses}` (cockpit-tasks cuts the description, names and comments with the same surrogate-safe cut, a comment's trailing marker kept last) with `detail_at = now()`; also refreshes the row's `status`, `status_type`, `due_has_time`, `checklist_done`, `checklist_total`. A status the mirror did not have goes through `cockpit_task_mirror_changed` (its status alert and the request parts), never swallowed (contract F1) |
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
- Pace: its own pacer, `CLICKUP_REQUESTS_CALLS_PER_MINUTE`, default 25,
  60 at most (2026-10-29: ClickUp Business allows 100 a minute for the
  shared token, docs/requests/CLICKUP-DOWNGRADE.md; it was 120 while the
  token's limit was 1,000 a minute, AT 7.1). Claim limit 6 a run.
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
6. Not live (dry run, or off the canary in `apply_limited`): the row is
   **never settled** (review R1, RT-1). `planned` = the steps it would run
   (no ClickUp call), and the row goes back to the queue through
   `cockpit_clickup_writeback_release(p_id, p_token, p_planned, p_note,
   p_next_attempt_at)`: `queued` again, or `retry` when it already has ClickUp
   progress, the claim's attempt taken off, due again in 5 minutes
   (`HOLD_MS`) so the rows behind it get their turn, its error the sentence
   "Waiting in the queue: …". It is sent once the switch lets it. In
   `apply_limited` a request that routes an old form ticket (`replaces_task_id`
   from the claim, or the first part's `replacesTaskId`) is live only when the
   claim's `replaces_client_task_id` is a canary card, else held the same way
   (review round 3, E-CANARY): the run right after a switch flip still claims
   by the mode reported before it. A database that sends no
   `replaces_client_task_id` holds every routing request during the canary. On a
   database without the release the writer saves `retry` with the progress
   kept and `progress.held` + 1; the ladder counts `attempts - progress.held`
   (`triesOf`). No row is ever saved `dry_run` by this job.
7. Live: run the item (4.3 or 4.4). Outcomes and the retry ladder as
   `runLog` (`RETRY_MINUTES`, 429 is `retry`, 5xx or a timeout is `unknown`
   and read back before any new write, another 4xx is `failed`), with one
   rule for a request part whose task exists (ClickUp answered its create
   with the task's id, or a task was adopted: `progress.task.id` or
   `steps.create.id`; review round 3): it is never settled `failed` except
   when the task is gone from ClickUp. A
   step ClickUp refuses for good (a 4xx, or a Request Type option renamed
   after the create) is saved `mismatch` with `refused`, named in the part's
   note (`STEP_REFUSED`), and the remaining steps run; the part is
   `delivered` with that note (RT-2). A part still unfinished at the end of
   the ladder is `delivered` with "The task is in ClickUp, but the cockpit
   could not finish every step on it. Check it in ClickUp." plus the error,
   minus any sentence promising a next run (`finalWords`). A request part
   whose create is still in doubt at the end of the ladder (create `started`
   with no id: an answer lost or without an id, two tasks matching, a search
   refused or unanswered) is never settled `failed`. It stays `unknown` with
   its error plus "The cockpit checks ClickUp again every 4 hours." and
   `next_attempt_at` now + 240 min (`DOUBT_MINUTES`), until it is adopted or a
   person settles it (RUNBOOK). A create never begun, or forgotten after a
   429, still fails at the end of the ladder.
   Only ClickUp's own answer is a refusal: an error with no status in
   "rejected the request (NNN)" (a receipt that could not be saved after
   ClickUp answered, a timeout, a dropped body read) is `unknown` and read
   back before any new write, in every step and inline catch (`requests.ts`
   `errorKind`, review round 2). A read ClickUp answered without what it
   should hold ("ClickUp did not return ...") stays a refusal.
8. `cockpit_clickup_writeback_finish` and
   `cockpit_clickup_requests_state(ok, note, mode, onlyCards, counts)`.
   `ok` is false when any item failed or a secret is missing. Note examples:
   "3 requests delivered, 0 to retry, 0 failed." / "Dry run: 2 requests
   planned. Nothing was written to ClickUp. They wait in the queue for the
   switch." / "Testing on the canary card: 1 delivered, 1 held as a dry run
   (waiting in the queue)."

Progress keys: `progress.steps[<step>] = {state: 'started'|'done'|'unchanged'|'skipped'|'mismatch', at, ids…}`,
`progress.task = {id, url}`, and for a verify `progress.verify`,
`progress.verifyNote`. The writer saves `task_id` as soon as the task id is
known. Every write records `started` before the call and `done` after its
read-back; a step found already in the wanted state records `unchanged`.

### 4.3 A `request` item, step by step

The marker line is `Cockpit ref {payload.ref}`.

| # | Step | Write | Read-back | On resume (started, not done) |
|---|---|---|---|---|
| 0 | old ticket check (a request that routes one: `replacesTaskId` on the first part, the claim's `replaces_task_id` on every part) | none | Before the create starts and while no task is known: `GET task/{old}`. Deleted, closed or done, or no longer on `901816723226`, and no comment on it holding this request's `Cockpit ref R-{10 hex}-`: the part is `skipped` with "The old ticket was already moved or closed in ClickUp, so no new task was made. Check it there." and nothing is written (review round 2). Not a frozen step | Not a step: a part whose task may exist never stops here |
| 1 | `create` | No template: `POST list/{listId}/task` with `name`, `markdown_description` (description plus a blank line and the marker), `assignees: [owner]` when an owner, `priority`, `due_date: dueMs`, `due_date_time: false`, `status: "to do"`, `notify_all: false`; never `custom_fields`. With a template: `POST list/{listId}/taskTemplate/{templateId}` with `{name: taskName}` | Id from the top or `task.id`; `GET task/{id}`: `list.id` equals `listId`, `name` equals `taskName`. Review round 3: a 404 right after the create, or on later reads of a task the create made but never saw, until 30 minutes after the create started (`SHOW_WAIT_MS`): `unknown`, "ClickUp has not shown the new task yet. The next run reads it again."; after that, or for a task adopted earlier or a requeued row's own task id: `failed`, "The task is no longer in ClickUp, so the cockpit stopped. Raise the request again if it is still needed.". ClickUp refusing that read (a 4xx, but not 404 or 429): create `mismatch` with `refused`, the note "ClickUp made the task but refused to show it to the cockpit. Check it in ClickUp." (`STEP_REFUSED.create`), and the remaining steps run (RT-2) | `GET list/{listId}/task?order_by=created&include_closed=true&date_created_gt={started - 60 s}`. Matching (review round 3): the marker in the text first (both kinds), matched as a whole word: the ref not followed by a letter, digit, `_`, `-` or `\` (`holdsMarker`). A template task with no marker yet is matched by exact name, leaving out any task whose text holds another `Cockpit ref R-…`. Either way, any task another queue row holds is left out (`cockpit_clickup_writeback_task_owners`; for marker matches since round 3). One match: adopt it (if its read is refused or 404s, use the list's copy). Two or more: drop those with status type `closed`; one left open: adopt it; two or more open: `unknown`, "Two tasks match this request in ClickUp. Keep one and cancel the other."; none open: `unknown`, "Every task that matches this request in ClickUp is cancelled. Reopen the one to keep, and the next run adopts it.". Search refused (a 4xx): `unknown`, "ClickUp refused the search for this request's task, so the cockpit cannot tell whether it was made. The next run searches again. ClickUp said: {error}". None found after 5 minutes: create again |
| 2 | `description` (template only) | `GET task/{id}?include_markdown_description=true`, then `PUT task/{id}` `{markdown_content: <template text> + "\n\n---\n\n" + description + marker}` | The description holds the marker as a whole word (`holdsMarker`) and still starts with the template's text | The marker is there as a whole word (`holdsMarker`): `done` |
| 3 | `owner_due_priority` (template only) | `PUT task/{id}` `{assignees: {add: [owner], rem: []}, due_date, due_date_time: false, priority}` | `assignees` has the owner; the Kuwait day of `due_date` equals `dueOn` (never the milliseconds); `priority.priority` is the name sent | Read; write only what differs |
| 4 | `checklist` | Every template part has this step (F14). A template part with no `sopSteps`: read back; the template's checklist is there, `unchanged`; none, `mismatch` and the note "The template brought no checklist in ClickUp, and this request type has no SOP steps to add. Add them in Requests settings." With `sopSteps`: no template is `always`, a template is `if_template_empty` whatever `sopStepsWhen` says. When `always`, or `if_template_empty` and `GET task/{id}` shows no checklist: `POST task/{id}/checklist` `{name: sopChecklistName}`, then one `POST checklist/{cid}/checklist_item` `{name}` per step, in order | `GET task/{id}`: a checklist with that id and name whose items are the steps in order | Adopt a checklist with that exact name created after `started - 60 s` (two: `unknown`); add only the missing step names |
| 5 | `tag` | When `clientTag` is in `GET space/901810248115/tag` (read once a run, compared in lower case): `POST task/{id}/tag/{tag}` | `tags` holds it (lower case) | Read |
| 6 | `fields` | For each `fields` entry: `POST task/{id}/field/{fieldId}` `{value}` | `GET task/{id}` `custom_fields`: a select by option id or its orderindex, else the exact value | Read; write what differs. A field that will not save is `mismatch` with its label, not a failure: the answer is in the description. The item's note lists them: "Some fields did not save in ClickUp: {labels}. They are in the description." An entry naming `e9fd8024`, `09abf737` or `d3ac52c5` (any case) is never posted and counts as `mismatch` the same way (the database never freezes one; a second guard, retest round 2) |
| 7 | `request_type` (only when `setRequestType`) | In order (review round 2): the value already set, `done` or `unchanged`; the type's switch off now (read again with `cockpit_request_doctor_inputs` once a run, and turned off at once in the run by a two-minute check that calls rt_off), `skipped` with the note "Request Type is off for this type now, so the cockpit left it empty." (the read failing: `retry`); the option missing or renamed on `e9fd8024-…` (`GET list/{listId}/field`, names compared trimmed with spaces collapsed), `skipped`, never written and never a failure, with the note "ClickUp renamed or removed this type's Request Type option, so the cockpit left Request Type empty. The systems manager can rename it back in ClickUp or turn Set Request Type off for this type in Requests settings."; another value already there, `mismatch`; else `POST task/{id}/field/e9fd8024-8abe-4094-ac08-e6c0e736ad7e` `{value: option id}`. Nothing about Request Type is checked before the create | The value is the option id or its orderindex | Read; write only if empty |
| 8 | `card_comment` (when a client) | `POST task/{clientTaskId}/comment` `{comment_text, notify_all: false}`, text: `Cockpit · {Requester label} asked {listName}: {typeLabel}` newline `{task url}` blank line `Cockpit ref {ref}-card` | The answer's `id`; `GET task/{card}/comment` holds that id and the marker (contains, not equals) | Page back with `start` and `start_id` until older than `started - 60 s`; adopt the comment with the marker |
| 9 | `replaces` (when `replacesTaskId`) | `GET task/{replacesTaskId}`: still on `901816723226` and not closed, else `skipped` with why "The old ticket was already moved or closed." and the part's note "The old ticket was moved or closed in ClickUp before the cockpit could route it, so it was left as it is. Check that the work is not done twice." (review round 2). Then `POST task/{replacesTaskId}/comment` "Routed in the cockpit as {typeLabel}: {task url}" + marker `-old`, then `PUT task/{replacesTaskId}` `{status: 'cancelled'}` | The comment by id and marker; `status.type` is `closed` | Read |
| 10 | settle | `delivered`, `task_id`, `progress.task = {id, url}`, `delivered_at` | | |

### 4.4 A `task_action` item

Before any write: `GET task/{taskId}` (one read serves the precondition and
later the read-back). The same lists as 3.4 (review round 2): a client card
itself (on `901816559981` with no `parent`) takes no op ("This is a client
card. Open it in ClickUp."); any other task takes `tick`, `untick` and
`comment`, and `done` except on Video Pipeline `901816720767` and WhatsApp
Reconnection `901821803697`, each skipped with its 3.4 sentence
(`taskActions.ts` `DONE_BLOCKED`; the old boards sentence is gone); and the
actor's ClickUp id must still be an assignee or watcher, or `actor.isAdmin`,
or `requesterOfTask`. Otherwise `skipped`: "This task is no longer yours in
ClickUp. Open it there." A `comment` whose words hold a Cockpit ref (3.4's
pattern) is `failed` with "Leave out the words "Cockpit ref". The cockpit adds
its own to every comment." before any call (retest round 2).

| Op | Precondition | Write | Read-back |
|---|---|---|---|
| `tick` / `untick` | The item is in that checklist, its name equals `itemName`, its `resolved` equals `from`. Already `to`: `unchanged`. Name differs or gone: `skipped`, "ClickUp changed this step. Open the task there." | `PUT checklist/{checklistId}/checklist_item/{itemId}` `{resolved: to}` | `GET task/{taskId}`: the item's `resolved` equals `to` |
| `comment` | none | `POST task/{taskId}/comment` `{comment_text: "{Actor label} wrote in the cockpit: {text}\n\nCockpit ref {ref}", notify_all: false}` | The answer's id; the comment list holds it with the marker. Resume as step 8 |
| `done` | `status.status` equals `statusSeen`. Already a `done` type: `unchanged`. Otherwise changed: `skipped`, "Someone moved this task in ClickUp. Open it there." | The list's status whose type is `done` (`GET list/{listId}`, cached for the run; `complete` on all six lists today); `PUT task/{taskId}` `{status}` | `status.status` equals it and `status.type` is `done` |
| `verify` | none | none, or once `PUT task/{taskId}` `{assignees: {add: [owner], rem: []}}` | `GET task/{taskId}`. With no `ownerClickupId`, only the list and name are checked. The owner is there: `verify 'kept'`. Missing: put it back once and read again; there now: `'restored'`; gone again: `failed`, `verify 'removed'`, "A ClickUp rule on {listName} keeps removing the owner." When `setRequestType` was on and the list or the name changed: `verify 'moved'`, call `cockpit_request_type_rt_off(typeKey, "ClickUp moved or renamed {taskName} after its Request Type was set, so Request Type is off for this type.")`, put nothing back. Parts of the type still queued or in retry then leave Request Type empty (4.3 step 7); a part delivered inside those two minutes has its own check, which finds its own move. Another person added by a list rule: `verifyNote` "ClickUp also added another person." On time only (review round 2): due 2 minutes after the write it judges (review round 3: `madeAt` for rt_off, `ownerAt` then `madeAt` for the owner put-back, each falling back to the check's `created_at`; a value that is not an ISO time with its offset is absent, `taskActions.ts` `stampMs`); more than 15 minutes after that, a check that would call rt_off or put the owner back changes nothing: `skipped`, no `progress.verify`, `verifyNote` and error "{what it saw} This check ran too late to tell a ClickUp rule from a person's change, so the cockpit changed nothing." A move seen on time (`steps.verify.movedAt`) still calls rt_off on a late retry; a `putBack` begun on time is only read back. A late check with nothing to act on reads as before |

### 4.5 The doctor (`{"job":"requests_doctor"}`)

Reads only. Secrets by name (`CLICKUP_API_TOKEN`, `CRON_SECRET`,
`CLICKUP_WRITEBACK_APPLY_REQUESTS`, `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS`;
present or not, never the value), the mode, then with
`cockpit_request_doctor_inputs()`: every template id in a target is in
`GET team/90182518398/taskTemplate` pages 0 to 5; for each type whose
`setRequestType` is not false, its option id exists on `e9fd8024-…` with a
matching normalised name (review round 2), else "{key}: its Request Type
option is not in ClickUp any more, so its requests leave Request Type empty.
Turn Set Request Type off for this type in Requests settings." or "{key}:
ClickUp renamed its Request Type option to "{name}", so its requests leave
Request Type empty. Rename it back in ClickUp, or turn Set Request Type off
for this type in Requests settings."; every field id is on
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
call. Pace `CLICKUP_TASKS_CALLS_PER_MINUTE`, default 30, 60 at most
(2026-10-29, ClickUp Business; it was 120); a focus-view or doctor read is
not paced, a person is waiting. Only GETs: this
function never writes to ClickUp. Secrets read by name:
`CLICKUP_API_TOKEN`, `TASKS_CRON_SECRET`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### 5.2 `delta` (every 2 minutes)

1. `cockpit_task_mirror_inputs()`. No cursor yet: `now - 24 h`.
2. `GET team/90182518398/task?include_closed=true&subtasks=true&order_by=updated&reverse=true&date_updated_gt={from}&page={n}`
   until `last_page` or fewer than 100 tasks, at most 10 pages (over that:
   `truncated: true`, `ok false`, "More than 1,000 tasks changed in one
   read; the next run goes on."). `from` is `cursorMs - 600000`, except
   right after a truncated run (`inputs.deltaTruncated`, or the last delta
   note holding that sentence): `cursorMs` itself, so more than 1,000
   changes inside 10 minutes never stall (F4).
3. Map each task to MirrorTask and `cockpit_task_mirror_upsert(batch, 'delta')`
   in batches of 100:
   `{taskId, listId, listName, folderId, spaceId, parentId, name, status, statusType, priority, dueAtMs, assigneeIds, watcherIds, creatorId, tags, url, dateCreatedMs, dateUpdatedMs, dateClosedMs, archived, checklistDone, checklistTotal}`
   (`checklistDone`/`Total` from `checklists[].items` when the endpoint
   sends them, else null).
4. `cockpit_task_mirror_comment_due(40)`; for each, `GET task/{id}/comment`
   (newest 25), and `GET comment/{id}/reply` for a comment newer than
   `sinceMs` with `reply_count > 0` (at most 10 reply reads a run); then
   `cockpit_task_mirror_comments(taskId, comments, p_read_at)`, `p_read_at`
   the moment that thread's read began (F6). Each comment's text is cut to
   1,000 characters with its trailing `Cockpit ref …` kept last (`commentText`);
   task names (500) and the import descriptions (4,000) use the same
   surrogate-safe cut (review round 2). A thread that cannot be read is
   named in the note and counted (`commentsFailed`), and its task is marked
   tried with `cockpit_task_mirror_comments(taskId, [], p_read_at,
   p_failed => true)` (it steps back; best effort). It makes the run not ok
   only when most threads fail (at least 2 and more than half), F5/F7.
5. `cockpit_task_alerts_tick()`.
6. `cockpit_task_mirror_state('delta', ok, note, {cursorMs, pages, tasks, comments, commentsFailed, alerts, truncated})`.
   `cursorMs`: a finished read, the newest `date_updated` read; a read that
   stopped part way in order, the last one read less 1 ms (ties on the next
   page are read again); out of order, null.
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
   `cockpit_request_import`. After a complete read (every page, at most 5),
   `p_open_ids` goes too: the ids of every task there whose status type is not
   `done` or `closed`, by the task's own id and status type (review round 3);
   a read cut short sends none, so no ticket on an unread page is taken for
   gone.
6. `cockpit_task_mirror_state('seats', ok, note, {members, linked, seats, imported, templates, fields, complete})`.

### 5.4 `detail` (the focus view)

1. User-JWT `cockpit_task_detail(taskId)`: refused means 403 with the
   database's sentence.
2. When `refresh`, or `detailAt` is missing or older than 60 seconds:
   `GET task/{id}?include_markdown_description=true&include_subtasks=true`
   and `GET task/{id}/comment`; then `cockpit_task_detail_cache(id, {dueHasTime: due_date_time, description: markdown_description, checklists, subtasks, comments: [{id, authorId: user.id, atMs: date, text: comment_text}], statuses})`
   and `cockpit_task_mirror_upsert([that task], 'detail')` (each comment's
   text through `commentText`, its trailing `Cockpit ref …` kept last; the
   description through the same surrogate-safe cut; review round 2). A ClickUp error
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
  until 2026-10-28 **the route line** under the form, before Send, saying
  exactly where the ticket lands: "Goes to Operations / Tech as "Acme -
  Client pause (Tech)". Owner: the systems manager. Uses the ClickUp
  template Client Pause ⏸️ (Tech). Due Wed 28 Oct." One line per part.
  This is the CEO's "routed correctly, connected to the SOP template", made
  visible before anyone presses Send. Since the CEO's ask of 2026-10-28
  (6.7) the same facts are drawn as **the route on the map**: one stop per
  fact, one lane per task, and the same drawing becomes the tracker after
  Send. `routeLine()` stays in the core with its words (the fit tests read
  it).
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
| `src/lib/tasksClient.ts` | cockpit-screens | `useTaskFeed()` -> `{tasks, alerts, error, refresh(), markRead(ids)}`: one poll per tab, client, cockpit and signed-in user (`seatId`; review round 2) for `cockpit_my_tasks` and `cockpit_task_alerts`; when its last card or bell unmounts it stops, empties and drops any answer still on its way, and the next mount reads at once; `readCanLinkSeats(client, seatId)` asks once per seat and is forgotten when the poll stops (on mount, every 120 s while visible, on focus and visibility, never twice within 30 s; `ClientAlerts.tsx:34-70`); `readTaskDetail(client, taskId, refresh)` through `client.functions.invoke('cockpit-tasks', {body: {op: 'detail', taskId, refresh}})`; `actOnTask(client, {taskId, op, payload})` (a new `crypto.randomUUID()` action id, `rpc('cockpit_task_act')`); `focusSearch(search, taskId | null)` |
| `src/components/tasks/TaskPanel.tsx` | cockpit-screens | `TaskPanel({open, onClose, title, subtitle?, footer?, wide?, children})`: a dependency-free dialog, centred from `sm`, a full-height sheet on a phone, Escape and outside click close, focus kept inside and returned, `aria-modal`, body scroll locked. Built the way `video-editor-cockpit/src/components/ui/dialog.tsx:1-30` is |
| `src/components/tasks/YourTasks.tsx` | cockpit-screens | `YourTasks({id?})`: the Today card. Reads `useTaskFeed()`. Rows open the focus view (`?focus=`). "See all {n}" opens the full list in `TaskPanel` in place |
| `src/components/tasks/AlertsBell.tsx` | cockpit-screens | `AlertsBell({variant: 'row' | 'icon', extra?: ExtraAlerts})`. `row`: a right-aligned outline button "Alerts" plus the unread count (as `.client-alert-bar`). `icon`: a 40px button whose `aria-label` says "Alerts, {n} unread"; inside `.tk-bell-compact` it is 28px with a 16px bell and a 14px count (review round 2). Opens `TaskPanel` with the list (6.5). `ExtraAlerts = {label, ready, note?, items: ExtraAlert[], markRead(items): Promise<void>}`, `ExtraAlert = {id, version, title, body, clientName?, href, external, read, at?}` |
| `src/components/tasks/TaskFocus.tsx` | cockpit-screens | `TaskFocusHost()`: mounted once per layout; opens when the address has `?focus=<taskId>`, closes on Escape, Back or Close by removing the parameter (replace). The view itself (6.5) |
| `src/components/tasks/tasks.css` | cockpit-screens | `tk-` classes on the tokens of 6.1 only, `var(--primary-ink, var(--primary))` for teal text |
| `src/lib/requestsCore.ts` | portal-screens | Import-free. Types `TypeView`, `FieldView`, `PartRow`, `RequestRow` (2.5, exactly), `RoutePreview` (the answer of `cockpit_request_preview`) and `SubmitResult` (the answer of `cockpit_request_submit`); `validateAnswers(type, answers, clientTaskId, dueOn) -> Record<string, string>` (the same rules and sentences as 2.5 step 5, so the form says them before the server does); `display(field, value)`; `stateWords(row)`, `partWords(part)`, `routeLine(part, dueOn)`; `REQUEST_SENTENCES` (6.6). Since 2026-10-28 (6.7) also the department map's looks and models: `TEAM_LOOK`, `TYPE_LOOK`, `GENERAL_KEYS`, `teamLook`, `typeLook` (by `type.key`, falling back to the team's mark, then `Ticket` with a line from the type's own data); `searchTypes`, `searchCountWords`, `markWords` (the search; `groupTypes` groups its results); `reachPieces`, `answerTeamLines`, `conditionWords`, `typeFacts`, `teamTypes`, `teamExamples`, `teamRelated`, `everyType`, `partReachable`; `choiceControl`, `questionGroups`, `dueChoices`, `nextWorkingDay`; `routeModel`, `sentModel`, `ROUTE_WORDS`; `plainTemplateName`, `taskNameParts`. `TypePartView` gains the optional `when` and `steps` of migration 20261028a |
| `src/lib/requestsClient.ts` | portal-screens | `readRequestTypes`, `readRequestClients`, `previewRequest`, `submitRequest`, `cancelRequest`, `readRequests`, `readRequest`: thin wrappers over 2.5 that throw the server's sentence. `readRequestTypes` reads each part's `when` and `steps` as optional (`partFacts`): a key the database does not send stays absent, null is kept, a value of the wrong shape is dropped |
| `src/components/tasks/RequestForm.tsx` | portal-screens | `RequestForm({source: 'requests_page' | 'client_page', presetClient?: {taskId, name}, presetType?, presetDetails?, presetAnswers?, presetPriority?: Priority, presetDueOn?: string, replacesTaskId?, replacesIfOpen?, compact?, onSent?(result)})`. Review round 3: what a request brings (`presetDetails`, `presetAnswers`, `presetPriority`, `presetDueOn`) goes with whichever type is picked, Change included, until "Ask for something else"; a due day before today in Kuwait or more than 365 days ahead gives the type's default (`requestsCore` exports `carriedDueOn(dueOn, today)`); a `presetType` not offered says `presetOff` or `presetNoClient`, plus `presetKept` when it brought words; a picked type with no details question shows the brought details read-only under `keptLabel`, with `keptNotSent`, or `keptRouted` when it routes an old ticket (integration round 4: the database then adds them to the new task's description, X2). Uses `useTaskSeat()`. Since 2026-10-28 it is the department map (6.7), and it raises no toast: the sent view is the one voice for a send. `presetAnswers` (review R1, D2): a request filed again starts from its own answers, as words. `replacesIfOpen` (retest round 2): a request filed again routes its old form ticket while it still waits; when the server answers "That old ticket was already routed." the same request id goes on its own, said in the sent view: "Request sent. Its old ClickUp form ticket was already routed, so this one goes on its own." "Make it a request" leaves it off, so a ticket a teammate routed first is never asked for twice. 6.4 |
| `src/components/tasks/requests.css` | portal-screens | `rq-` classes, same token rule |

Per app, not shared, one file each (cockpit-screens):

`src/lib/taskSeat.ts` exports `useTaskSeat(): {client: SupabaseClient | null, ready, signedIn, seatId: string | null, cockpit: 'portal'|'csm'|'creative'|'editor'|'sales', portalHref(path), inPortal, toast: {success(m), error(m)}}`. `seatId` is the signed-in user's id (review round 2): the portal, client success and creative take it from `useCockpitAuth().session`, the editor and sales apps from `useWho().session`.
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
| sales | `src/components/MacOSMenuBar.tsx:95-121` | Bell `icon` in the right group before the theme button, inside `<span className="tk-bell-compact">` (review round 2) |
| sales | `src/App.tsx` | Bell `icon` in the phone header's right group (292-314); `<TaskFocusHost />` beside `<SearchBox />` (368) |
| sales | `src/pages/TodayPage.tsx` | `<YourTasks />` at the top of the right column (170) |
| sales | `src/components/Sidebar.tsx:178-202`, `src/components/SearchBox.tsx` | "Ask a team" door after Team meetings (188); an "Ask a team" hit |

The CEO's `/ceo` gets the bell (from the portal layout), and `TodayTab.tsx`
places `<YourTasks />` directly after `<KpiRow />` (review R1 F13, placed in
review round 2). The
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
team" (default) and the `views` the read returns; the row is keyed by the
pills it shows, so a deep link (`?view=all`) scrolls the active pill into view
(review round 2). Address: `?view=ask|mine|assigned|team|all`,
`?id=<request id>` opens one request in `TaskPanel`,
`?type=<key>&client=<taskId>` prefills the form.

- *Ask a team* (`RequestForm`, in a card at the page's full width since
  2026-10-28; until then `max-w-2xl`): the department map of 6.7. In short:
  1. "What do you need?": search on top, the seat's recent requests, and
  the map of the five teams (`TypeView.team` order of 2.5), each team's
  requests one click away, and every request A to Z. 2. The chosen
  request's plate, then only that type's questions, in order: client
  picker (search over `cockpit_request_clients`, "Show stopped clients";
  locked when `presetClient`), text, longtext, url, number, a choice as
  pills, radios or the native select by its number of choices, details.
  3. Due (the usual day `dueDefault`, the next working day, "Pick a day")
  and priority (prefilled, "usual" marked). 4. The route
  (`cockpit_request_preview`, re-read when the type, client or a `when`
  field changes). 5. "Send request" (teal), "Save request" while a send
  would be held. While `writer.canSend` is false (a database without
  20261029p) the form shows `writer.note`, or "Requests cannot be sent from
  this seat just now. Tell the systems manager.", in place of the questions
  and the button, with no link (2026-10-29: no ClickUp form). After a send:
  the sent view, rooted in `.rq-sent[data-tone]`; its
  mark follows `sentTone` (review round 2): a task refused, `CircleAlert` in
  `--destructive`; on its way, a static `CircleDashed`, muted; saved until
  requests open, `Clock` in the teal ink (`--tk-ink`; `--warning` until
  2026-10-29, the held mark of 6.7); every task in ClickUp,
  `CircleCheck` in `--success`. Each task's line is `sentLines()` printed
  whole. On a refusal, once nothing is moving, the view shows `sentFailed`
  ("Open the request to file it again with the same answers.")
  or `partialNext`, no link, and "Open the request" to
  `/requests?id=` in place of "See it in My requests". A `duplicate` answer
  shows its note and "Open it" only when `duplicateOf` is set (review round
  2). Inputs keep their values on an error; the field named in the sentence
  gets the message under it.
- *My requests / Assigned to me / {team} queue / All requests*: a flush
  list of RequestRow, one line each from `sm` (status chip, type label,
  client, due word, owner label from `lg`); below `sm` two lines: the type
  label (wrapping, never cut) with the due word on the right, then the status
  chip and the client (review round 3); a press opens `?id=`. When
  `cockpit_requests_read` returns a `note` and no rows (a seat not linked
  asking for Assigned to me, a seat with no team asking for its queue), the
  note is the view's whole state; no empty-state line follows it (R11). An
  import handled in ClickUp is not open: no late due word (`isOpen`), its chip
  in the neutral tone (integration round 4). A request with two parts
  shows one chip summarising both and both lines in the panel. An open
  request with a delivered task's note keeps its status label in the warning
  tone; the row's title is `stateHint`, plus a screen-reader line "Not
  finished: {note}"; the CSM card shows the same line (review round 2).
- *The request panel*: type, client, requested by, due, priority, the
  answers, each part (list, task name, owner and its note, state chip, the
  ClickUp link with `ArrowUpRight`, the 2-minute check's note), history.
  Each state is said once (review round 3). The line beside the request's
  chip shows only what the chip does not (a held request's when-it-goes, an
  old form ticket's way to route it). A task's words show only a refusal's
  reason, a retry, an arrival check or a held note not already said above.
  They never repeat a ClickUp status its chip names (or, with one task, the
  request's chip), never say "Sending to ClickUp" beside a Sending chip, and
  say nothing when the old-ticket next step already gives the reason. A held
  request's line is the database's `heldNote` when it sends one (so a writer
  gone quiet is said as such), and its tasks then do not repeat it; a task in
  doubt (`unknown`) says "Checking whether it reached ClickUp." plus the
  writer's note, which names what a person must do, or, handed back while
  requests are not open, "ClickUp did not answer. The cockpit checks whether
  it arrived once requests open" (integration round 4).
  "Cancel request" (outline, the requester, editors, admins and the CEO,
  only while `canCancel`) asks for a reason. An import row has "Make it a
  request" (teal), which opens the form with the import's type, client,
  details, priority and due day and `replacesTaskId` (review round 3; "File it
  again" also carries the request's priority and due day; a due day before
  today in Kuwait or more than 365 days ahead gives the type's default;
  `RouteFrom` gains `priority` and `dueOn`). An import handled in ClickUp
  (`importHandled`) has no Make it a request and reads "Came in through the old
  ClickUp form. It was moved or closed in ClickUp, so it needs no routing
  here." (integration round 4). The next step, said once above the tasks
  (review round 2): `failed`, "Nothing reached ClickUp. File it again with
  the same answers." (`againFailed`, true for
  every `failed` the writer settles but a task deleted in ClickUp, review
  round 3; a failed task that keeps its ClickUp link was deleted there and
  reads "The task was deleted in ClickUp. File it again with the same
  answers if the work is still needed.", `againDeleted`, integration
  round 4), "File it again" and no other link (2026-10-29: no ClickUp
  form); after the new request is sent the first one is
  cancelled with "Filed again as a new request." when the seat may, and the
  notice above the form reads "Sending it cancels the first one." or "The
  first one stays in the queue until the person who asked for it or the
  systems manager cancels it." (else the toast "The new request is sent, but
  the first one is still open. Open it and cancel it."). A routing request
  filed again carries its `replacesTaskId` and `replacesIfOpen` (the notice
  adds "It routes the same old ClickUp form ticket, unless someone routed it
  meanwhile."; retest round 2). `partial` (done or not): no re-file, the
  `partialNext` sentence, with no link (2026-10-29). A `failed` routing request whose
  task error is the writer's old-ticket check ("The old ticket was already
  moved or closed in ClickUp ..."): no "File it again", the sentence "The old
  ClickUp form ticket was moved or closed in ClickUp while this request
  waited, so no task was made. Check the old ticket, and ask again only if
  the work is still needed." and "Open the old ticket in ClickUp" (retest
  round 2).

**`/requests/settings`.** Tabs: "Request types", "People in ClickUp",
"Alerts". Non-editors see only "Alerts" (their own rules). A line at the
top links "Slack notices" to `/client-success/notices`, only for an editor
or a seat whose `teams` include `client_success` or `creative` (the gate of
`cockpit_slack_notice_viewer`); nothing shows while the seat is read
(review round 2).

- *Request types* (editors): one flush row per type: label, team, "{list},
  {owner}" per part (with its runs-when, `when "{question}" is {a} or {b}`:
  the choices' names from the question's own choices, then the stored spec's,
  then the catalog the editor read, never an option id; a choice none of them
  names reads "a choice that could not be read from ClickUp"; review round 3,
  L1), a chip "Template", "{n} SOP steps", "{n} draft
  steps" or "No SOP steps", "Due in {n} days", an On/Off switch. A press
  opens the type in `TaskPanel` (`wide`): label; per part the list, the
  template (picked from `cockpit_request_templates` by name, "None" adds
  the SOP steps instead), who owns it (the client's CSM, the systems
  manager, the creative strategist, the media buyer of record, a named
  person; with the named person or fallback beside it, from
  `cockpit_request_people`), the "runs when" choice for types that have
  one; each task also has "Name ending" (at most 40 characters) and "Runs"
  ("Every time" or "Depending on {question}"); "Add a task" while under 3
  (the first unused board, that board's usual owner and ending, both
  following the board until changed; saved under its board's short name,
  `ads`, `ads_two`), "Remove this task" while over 1, and two tasks with the
  same ending on one board are refused before the save, but only when one
  request can make both (both run every time, or their runs-when choices on
  the same question overlap; `bothRun`): Create an ad account keeps its three
  tasks on one board with an empty ending, each on its own `ads_platform`
  answer (review round 2; review round 3, L2; R3 stands: whole types are not
  added or deleted); fields (reword, require,
  reorder, add from the ClickUp field list or as a cockpit-only question,
  remove); SOP steps (one line each, add,
  reorder, remove; a draft shows "Draft: check with the systems manager");
  SOP link; due days; priority; "Set Request Type in ClickUp" with its
  line "Off until the rehearsal ticket for this list shows ClickUp does
  not move it. The writer turns it off by itself if ClickUp moves a task.";
  Save (teal) and "Versions", which lists versions and offers "Go back to
  version {n}" (its toast adds the server's `restoreNote` when Request Type
  stays off; retest round 2). A 409-style version clash shows the server's
  sentence and "Reload".
- *People in ClickUp* (editors): one row per active seat: "first name,
  role", the linked ClickUp user or "Not linked", how (matched by email /
  set by hand / no match / two matches), a picker to set it and "Clear".
  Clear shows on rows whose link is `ok`, `manual`, `not_found` or
  `ambiguous`, not on `cleared` or never-checked rows (review round 2). The
  read time of the members list sits in the header.
- *Alerts*: the seat's own rules: the eight kinds as switches
  ("A failed request" is always on, its switch disabled with "Always on";
  the status kind's hint reads "When its status changes, also when you move
  it in ClickUp yourself.", review round 2),
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
  in Requests settings", never for a seat an editor cleared: `linkState`
  `cleared` reads the cleared note and asks nobody to link it, review round
  3), not read, stale ("Last read at 14:02." in Mono), empty.
- **The bell.** List newest first: a dot for unread, the title, one line
  (`body`), the client. The client follows the body only when the title does
  not already name it, and the body's final full stop goes before it; unread
  rows have a dot in `var(--tk-ink)` and a 600-weight title; launch notices
  also carry the screen-reader "Unread" (review round 2). A press opens the focus view (task alerts) or the
  request panel at `${portal}/requests?id=` (request alerts) and marks it
  read. "Mark all read" (at most 200). The launch notices (`extra`) follow
  under their own label. Footer: "Checked every 2 minutes while this
  cockpit is open." and "Alert settings" to `${portal}/requests/settings?tab=alerts`.
  Empty: "No alerts in the last 14 days."
- **The focus view** (`TaskPanel`, opened by `?focus=`): the title; one line
  "{client} · {list} · {due word}" with the spine; the status chip; when
  the task came from a request, "Request from {role}" and "SOP" (the
  `sopUrl`, `ArrowUpRight`); the status chip and subtask statuses in
  sentence case (review round 2); the checklists ("{done} of {total} done"),
  each item a checkbox row; the description folded under "Details"; the
  newest three comments and "Show the other {n}"; a comment box with
  "Comment" (outline); at the foot "Mark done" (teal, the one primary) and
  "Open in ClickUp" (outline, `ArrowUpRight`); Mark done's skipped, failed or
  waiting sentence sits on its own line above both buttons (`.tk-foot-note`),
  so the buttons keep one row (review round 3). A press writes through
  `actOnTask` and shows "Saving…" on that control, then polls
  `readTaskDetail(…, true)` every 3 seconds for up to a minute until the
  action row is `delivered` ("Saved", the box ticks; "Done" replaces "Mark
  done"), `skipped` or `failed` (the row's sentence), else "Waiting for
  ClickUp to confirm." Each `can.*` that is false hides its control and
  shows `can.why` once (on Video Pipeline and WhatsApp Reconnection only Mark
  done is hidden, with its 3.4 sentence; review round 2). A task the seat may
  not open shows the server's sentence and only "Open in ClickUp".

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
| Form, sent | until 2026-10-28 the toast "Request sent." and the panel "Sent to {list}. Owner: {owner}."; since then no toast, and the sent view of 6.7: "Sent: {type} for {client}" (held "Saved:", a refusal "Not sent:" or "Partly sent:"), focus on that heading, and each task's `sentLines()` sentence |
| Form, writer off | `writer.note` (2.8), or when it is empty "Requests cannot be sent from this seat just now. Tell the systems manager." (2026-10-29) |
| Form, no type picked | "Pick what you need first." |
| Request states | `sending` "Sending to ClickUp" · `dry_run` "Not in ClickUp: the writer is in its test run" · `delivered` "In ClickUp: {status}" · `partial` "Part of it did not reach ClickUp: {error}" · `failed` "Not in ClickUp: {error}" · `cancelled` "Cancelled" · `imported` "Came in through the old ClickUp form. Make it a request to route it." where `canRoute`, else "Came in through the old ClickUp form. Route it in ClickUp." (review round 2) · `routed` "Routed as a new request" · done "Done" |
| Owner how | `card` "The CSM named on the client card." · `fallback`, `none` the server's note |
| 2-minute check | `restored` "A ClickUp rule removed the owner; the cockpit put them back." · `removed` "A ClickUp rule keeps removing the owner. Assign it in ClickUp." · `moved` "ClickUp moved this task after its Request Type was set. Request Type is now off for this type." |
| Rail, palette, search | "Ask a team" |
| Tab bar | "Requests" |
| Alert settings, status (review round 2) | hint "When its status changes, also when you move it in ClickUp yourself."; `alertWords('status')` "Your task moves" |
| Request panel, nothing reached ClickUp (`againFailed`) | "Nothing reached ClickUp. File it again with the same answers." (the panel adds "If it fails again, tell the systems manager.") |
| Request panel and sent panel, part of it reached ClickUp (`partialNext`) | "The {list} task did not reach ClickUp; the one that did stays there. Ask the systems manager to make the missing task. Filing the whole request again would make the one that arrived twice." (plural: "tasks", "the ones that did stay there", "the ones that arrived") |
| Sent panel, a task refused (`sentFailed`) | "Open the request to file it again with the same answers." |
| Form, a required choice ClickUp lost (`lostBlocked`, 2026-10-29) | 'ClickUp's choices for "{question}" could not be read, so this request cannot be sent from here yet. Tell the systems manager; the cockpit reads ClickUp again at 11 minutes past each hour. If it cannot wait, make the task on the {list} list in ClickUp.' and "Open the {list} list in ClickUp". {list} and the links come from the lists the type's tasks go to (`handLists`), never its team alone. Tasks on more than one list: "... If it cannot wait, make it on the {list} or {list} list in ClickUp, or on both, as the request needs." ("or on more than one" past two), or, when every task always runs, "... make a task on each of the {list} and {list} lists in ClickUp."; one "Open the {list} list in ClickUp" per list (clickup-diet-1029) |
| Form, requests cannot be sent from the seat (`offAsked`, `offKept`, 2026-10-29) | "Requests cannot be sent from this seat just now, so the cockpit asks you nothing here. The questions open here as soon as they can be sent." / "Your answers stay on this screen until requests can be sent from this seat." |
| Requests functions missing (`missingFunction`, 2026-10-29) | "Requests cannot be read: the database does not have them yet. Tell the systems manager." |
| Filed again, notice | "Sending it cancels the first one." / "The first one stays in the queue until the person who asked for it or the systems manager cancels it." (a routing request adds "It routes the same old ClickUp form ticket, unless someone routed it meanwhile.") |
| Filed again, the first one not cancelled | toast "The new request is sent, but the first one is still open. Open it and cancel it." |
| Filed again, its old ticket routed meanwhile (`sentAlone`, retest round 2) | "Request sent. Its old ClickUp form ticket was already routed, so this one goes on its own.": a toast until 2026-10-28, since then a note in the sent view |
| Request panel, old ticket handled in ClickUp (`oldHandledNext`, retest round 2) | "The old ClickUp form ticket was moved or closed in ClickUp while this request waited, so no task was made. Check the old ticket, and ask again only if the work is still needed." and "Open the old ticket in ClickUp" |
| Type editor, going back a version that had Request Type on (retest round 2) | toast "Back to version {n}. " + the server's `restoreNote` |
| Request types, runs-when (review round 3) | `when "{question}" is {a} or {b}`; "a choice that could not be read from ClickUp" / "{n} choices that could not be read from ClickUp" |
| Type editor, Runs (review round 3) | `Depending on "{question}"`, `Runs when "{question}" is` |
| Form, a brought type not offered (review round 3) | "The request type it came with is turned off. Pick another type." / "The request type it came with does not take a client card, so it is not offered here. Pick another type."; appended when it brought words: "What was asked is kept." |
| Form, kept words (review round 3; integration round 4) | label "What was asked"; "This type has no question for these words, so they are not sent with it."; routing an old ticket: "This type has no question for these words, so the cockpit adds them to the new task's description, with a link to the old ticket." (`keptRouted`) |
| A seat an editor cleared (review round 3) | Your tasks: "Your seat has no ClickUp user, so no ClickUp tasks show here. Requests you raise show under My requests." · bell: "Your seat has no ClickUp user, so only request alerts show here." · focus view: "Your seat has no ClickUp user, so you cannot tick, comment or mark done here. Ask the task's owner." · Assigned to me: "Your seat has no ClickUp user, so nothing is assigned to you here. Requests you raise show under My requests." |
| A writer gone quiet after requests opened (review round 3) | form, anyone but an editor, an admin or the CEO (since 20261029p, held): "The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself when the writer is back." · held request: "Saved, not sent yet: the requests writer has not reported in the last 15 minutes. It goes to ClickUp once the writer runs again." · focus view: "Changes from the cockpit cannot be sent just now: the requests writer has not reported in the last 15 minutes. Open the task in ClickUp." |
| An old form ticket handled in ClickUp (`importHandled`, integration round 4) | "Came in through the old ClickUp form. It was moved or closed in ClickUp, so it needs no routing here." |
| Request panel, a task deleted in ClickUp (`againDeleted`, integration round 4) | "The task was deleted in ClickUp. File it again with the same answers if the work is still needed." |
| A task in doubt (integration round 4) | "Checking whether it reached ClickUp." + the writer's note; handed back while requests are not open: "ClickUp did not answer. The cockpit checks whether it arrived once requests open" (`checkingHeld`) |
| Bell, a failed part whose task was deleted (integration round 4) | "Deleted in ClickUp: {error}" |

### 6.7 The department map: the request form as built (2026-10-28)

The CEO, 2026-10-28: "Make sure to make the ticketing look as nice as
possible and as easy as possible for the team to understand what is for
which department and what happens exactly. This is a very obvious ticketing
form, so through design parts, make it extremely solid, make it very easy,
and make it the best, easiest, and visually nice as well. Just don't make it
like a boring form. Make it visually nice for each task, depending on what
the task is, and just make it amazing." And about every form: "make sure all
the forms are perfect work really hard on everything with a solid backend
and really easy to use and visually nice and user friendly use any skills
and research that will help". Round tickets-look-1028 built the winning
concept, "The department map", with every item of its three judges' must-fix
lists and the grafts named below. It replaces the type list, the route line
and the sent panel of 6.4; behaviour is unchanged except where this section
says so.

**The plan.** Tokens: each app's own, mixed in `requests.css` (`--rq-edge`,
the 45% foreground edge at 3:1 for fields, pills and the route; `--rq-quiet`,
the quiet panel; the seal; the 15% teal of the active state; `--rq-focus`,
the teal ink, never plain `--ring`; `--rq-warn`, orange mixed with ink on
white). No department colour: a department is a lucide mark in a seal, its
ClickUp list name word for word, one plain line and its place on the map.
Type: Geist; Geist Mono only for the short uppercase kickers and the
"Checked 14:03" stamp; text at 11 (the kickers), 12, 13, 14, 15, 16, 18 or
20px on even line heights, gaps and paddings on 4px steps, bar the route's
drawn fork (review D14). Layout: container queries on the form's own width.
Signature: the route on the map (6.1). One teal per view: Send (none while
a lost choice blocks it, 2026-10-29). The held mark (2026-10-29,
clickup-diet-1029): saved, not sent yet, is the cockpit keeping the request,
so its clock is drawn in the teal ink in each place it shows (the note
before Send, the hint beside "Save request", the route's held stop, the
Saved heading), and My requests' "Saved" chip takes the neutral on-its-way
mark "Sending" has; orange stays for what a person must check.

**What do you need?** A 48px search ("Search, for example: card
declined"), then, while nothing is searched:
- *Your recent requests*: up to three of the seat's own, newest first, from
  one `readRequests(client, 'mine', 20)` that fails silently, filtered
  through the types on offer (a client page never offers the employee
  types).
- *Who does what*: "Five teams take requests. Start from the team, or search
  above." and "Every request, A to Z {n}". The map: a tile per team in the
  server's order (three columns from 860px, two from 540px), each with its
  seal, its ClickUp name (`.rq-group-label`, the five names only), its line,
  its shortcuts (`TEAM_LOOK` examples filtered at render by what is offered
  and by `type.team`, filled with the team's other requests, three; two on
  the client page), and "See all {n}"; then "Not sure which team?" with the
  three general requests and "ask the systems manager". The faint team mark
  sits in a tile's corner and on a team's page only, and the hero's words
  keep clear of it at every width (review D5). A tile is a group, not a
  landmark (the map is the one region), and it does not light up on hover:
  its shortcuts and "See all" are the targets (review A11Y-18, D12). Two
  teams end in one quiet pointer to a request filed elsewhere that people
  look for there (`TEAM_LOOK.related`, `teamRelated`, only for keys on offer
  and filed under another team; review CL-09): "Ads stopped because a
  payment card failed? Card missing for ads, under Client Success." and
  "Changing who calls a client's leads? Change from DFY to DWY or Change
  from DWY to DFY, under Client Success.", on the tile and the team's page.
- *A team*: the Teams navigation: the two overviews, "All teams" and
  "Every request {n}" (outlined), then the team pills with counts, on one
  row when they fit (1440); else the teams take a line of their own under
  the overviews, one row that scrolls sideways where it must and snaps to
  whole pills, never a ragged wrap (review T3-design-clarity-01). A current
  team out of view is brought to the row's start, the row alone scrolled
  (review D8, T3-design-clarity-09). The current view is `aria-current`,
  never a toggle (review T3-a11y-behaviour-03). Then the team's hero ("{n}
  requests, and {m} from other teams that also give it a task", or, when
  some of them give it a task only for some answers, "..., and {m} from
  other teams that can give it a task, {k} of them only for some answers";
  `teamByAnswer`, only on a database that says when each task runs; review
  T3-design-clarity-02), its pointer, and every request that gives it a
  task: its own first, then those filed under another team, each saying
  "Filed under {team}" (graft 9) unless its reach words already name that
  team (review D16).
- *Every request*: A to Z, each row naming its team.
- *A row*: the type's mark, its name (`.rq-type-name`), one line of what it is
  for in the asker's words (`TYPE_LOOK`, by `type.key`), and its facts: "Due
  in {n} working days", a priority other than normal, "Also {team}" or, when
  a task depends on an answer, words true for every answer ("Call Center,
  Marketing / ADs or both, by your answer"; while requests are not open to
  the seat, 'Call Center, Marketing / ADs or both, depending on the answer
  to "Where is the problem?"', on the rows and the plate alike, as the route
  says it; review T2-clarity-04, 2026-10-29), "No client" or "Client
  optional"; the home team is named once, never again when the reach words
  name it (review D16). Only the three general requests wear their team's
own mark, so a team's page never repeats it on its rows (review D13). A key
the map does not know takes its team's mark,
  else `Ticket`, and the line "Goes to {reach words}. Owner: {rule}", in the
  plate's own reach words (so "Goes to Call Center, Marketing / ADs or both,
  by your answer", never "and" for tasks an answer decides), the owner
  left out while the rule is "the media buyer of record", which no seat
  holds (review CL-12, BT-12). A task no offered choice can run (its `when`
  keeps no option: ClickUp dropped them, or lost the question) never counts:
  no team in the reach words, facts or that line, no owner from it, no place
  on that team's list, no search hit on that team's name, no lane
  (`partReachable`; review BT-6, S4). A row is named by its name and
  described by its line and facts (review A11Y-17).

**Search** (graft 8, `searchTypes`): the name, the hidden words, the line,
the question labels and the team names, in that weight; filler words
ignored; a word finds its own root ("calls" finds "calling", "joining"
finds "joiner"); ranked by how many of the words match, an everyday word
("client", "issue", "problem", "request", "new") not counted unless the
search has nothing else, then by the words of the hidden phrases the search
holds in their order ("stop ads" puts Client pause first; "dfy to dwy" puts
Change from DFY to DWY first and "dwy to dfy" its opposite; filler such as
"off" counts inside a phrase: "ads off"), the request's own name counting as
a phrase ("new lead form"), then by weight, a word few requests share
weighing more, then the server's order (review CL-02, 2026-10-28). Each of
the DFY and DWY switches holds the words of where it goes, never of where it
comes from. New employee onboarding also holds "first day", "start date"
and "starting", and Client offboarding "quit", "leave" and "client
leaving", so a start or a client's exit never finds only the opposite
lifecycle request; "client" and "new" stay everyday words (review
T2-clarity-01, 2026-10-29). For two words only what matches both stays;
for a sentence, what matches one word fewer than the best. The line of
Change from DFY to DWY says "the client's own team calls their leads from
now on", so a new starter's "starts" is not its word. "pause" and
"script" still find only their own request. One wrong letter is allowed
only when nothing matches as typed, and said: 'No match for "watsapp". 2 requests match "whatsapp".' The
count is the one polite status line; matched words are bold; a hit found by
a hidden word says "Found by {word}"; Return opens the first only when it
leads on matched words or phrases (`searchLeads`), and never one of the DFY
and DWY switches while the other is listed too, unless the search says its
way ("to dwy" or "done with you"; "to dfy" or "done for you") and not the
other's, since "client no longer wants our call centre" holds the
opposite's "our call centre" (`TypeLook.opposite`; review T2-clarity-02,
2026-10-29); else focus moves to the first row to pick from; every list
ends in "Not it? Pick the general request
closest to it, or ask the systems manager." with the three general requests.

**The chosen request.** A plate: the type's mark, where it goes (the reach
words, a mark on each team), the name, the line and Change (focus moves to
the plate after a pick, back to the search after Change). The usual due day
is said once, by Due. Then, from 880px, the questions beside the route; below,
one column that ends in the route, then Send.
- *Questions*: the deciding question first, marked "Decides where it goes"
  (or "Decides which task it makes"), each of its choices naming the team it
  reaches ("Ads issue / Marketing / ADs", "Both / Both teams"; graft 1). A
  choice is pills for up to five short ones, a list of radios up to ten, the
  native select beyond; native radios whose chosen state follows React's own
  state, `data-field` on the checked one (else the first). An optional choice
  has "Clear". New script's questions sit under "The script" and "Filming
  and language" (graft 7), only while those questions keep their order.
- *Due*: the usual day (`TypeView.dueDefault`) and the next working day as
  two choices in date order, the usual one tagged "usual" wherever it falls
  and the other "sooner" or "later" (the day after when they are the same;
  review D16, CL-11), and "Pick a day", which opens the native date input
  that is always on the page with the due day in it (graft 10), labelled by
  Due and "Pick a day". Help: "{n} working days is the usual for this type.
  Working days are Sunday to Thursday, Kuwait time."; with a picked day,
  "{day}, Kuwait time. {n} working days is the usual for this type. Working
  days are Sunday to Thursday." ("Kuwait time" once).
- *Priority*: four pills, the type's own marked "usual".
- *Under the questions* (graft 12): the error summary ("Fix these {n}
  answers first:", each entry a button to its field), a refusal, and the
  button. Errors stay in ink under their field with a red mark and edge (a
  choice question's pills take the red edge, a radio list a red rule at its
  leading edge, and the client's note sits under its search, before the
  list; review A11Y-13); each radio carries its question's error as its
  description (review A11Y-07). The summary is said once a press, politely,
  through a line already on the page, filled only once focus is on the
  first answer to fix, so the focus change never cuts it off; the visible
  summary is not live, so a fix shrinks it quietly and only the next press
  says what is left (review A11Y-02; 2026-10-29). A required choice whose
  options ClickUp lost is `aria-disabled`, so the summary can still take
  focus to it; its sentence describes it and it still looks unavailable
  (review A11Y-21).

**The route** ("What happens next", a read-out that stays in view on wide
screens): a polite summary ("Two tasks, for Call Center and Marketing /
ADs"), then stops: *Now* ("You send it. The cockpit checks it and saves
it."); *Saved, not sent* while a send would be held ("Waits in the cockpit."
and the writer's own sentence, a teal-ink clock (orange until 2026-10-29), the track after it
dashed; the button then says "Save request"; graft 4); *Your answer* at the fork (a
diamond: "Where is the problem? Both"); a lane per task (its list, the task's
name with only the client isolated, its owner and the server's note, what it
works from: "the ClickUp template {name}" without emoji, or "{n} SOP steps,
added as a checklist" with the first two steps, "Show the other {n}" and "A
draft until the systems manager checks them."; graft 6); *How they do it*
("Read the SOP for this request", where the type has one); *Due* ("Mon 2 Nov,
normal priority", the day said once; while held, "The due day stays, even
if it reaches ClickUp later." under it; review CL-13,
T3-design-clarity-04); *After that* ("You hear in the bell when it is done,
or if it fails, while a cockpit tab is open." and "My requests shows its
ClickUp status until then."; while held, "My requests shows it as Saved
until it reaches ClickUp, then its ClickUp status."; review
T3-design-clarity-08); then "The owner is chosen by rule, not picked here.",
"Nothing is sent to the client." (client types) and "You can cancel it from
the request until it reaches ClickUp." Lanes sit side by side only for
exactly two tasks, else they stack on the trunk (graft 3); side by side,
the trunk runs on from the first lane past the join to the next stop, one
line with one dash rhythm, and a pair that ends the route ends both lanes
at their seals (review T2-design-1, T2-design-2, 2026-10-29). Before the
deciding answer, each task that may run is a dashed "May go to" lane with its
condition ("If the problem is Call Center Issue or Both") and the owner that
answer's own preview names, under "One or two tasks, by your answer" (graft
2): from `parts[].when` (migration 20261028a), never from the preview's
sentence. A database from before 20261028a sends no `when` or `steps`: the
form then shows the server's "Pick ... to see where it goes." (while
requests are not open to the seat, "Where it goes depends on the answer to
one of its questions." in its place, since that question is not on the
page and its name is never read out of the server's sentence; review
T2-clarity-03, 2026-10-29), joins the
teams with "and" and shows only the step count. Before a client-required
type has its client, a lane says "Pick the client to see its name." The
timing words appear only while requests are open to the seat ("Usually in a
minute or two"; "When requests open" while a send would be held, "Waits for
the writer" while the writer has not reported, its mode `unknown`, when the
hint by the button says "Saved here until the writer runs with requests
open."; review CL-04). Those quiet words are a lead seat's (an editor, an
admin or the CEO: `seat.all`). A plain seat's follow its own held note
(`heldWait`, clickup-diet-1029): "when the writer is back" after requests
opened ("Saved here until the writer is back.", the summary's "saved until
the writer is back"), "When requests open" and "Saved here until requests
open." when its note says requests are not open yet or are tested on one
card; a note the form does not know keeps the hedge. Tasks that may run on one list, for one owner, under
one name and on one question, one per answer (Create an ad account), are one
lane: the answers joined in the question's order, the task and owner said
once, and under "Works from" what each answer's task works from
("Facebook/Meta: the ClickUp template Create Meta Ad Account"; review D7).
The route is drawn from the answers and client the shown preview was read
for, so its lanes and summary change only when the new preview lands
(review BT-4). The summary line is the one polite line and says only a
settled answer: the first read's "Working out where it goes" shows in its
place, unsaid (review A11Y-08). With no lane to draw, the server's "Pick ...
to see where it goes." is said once, on its stop, never as the summary too
(review CL-07). When every task an answer decides runs on a choice ClickUp no
longer gives (the question lost, so 20261028a sends `when.options` []), that
stop and Send say "Where it goes rests on a choice that could not be read
from ClickUp. Ask the systems manager." instead, never "Pick ..." for what
cannot be picked (`routeNote`, `ROUTE_WORDS.routeLost`; review BT-6, S4).
While any required choice has no option ClickUp gives, the request cannot
be sent here (review T3-design-clarity-05, 2026-10-29): above Send, before
any press, a quiet panel with the orange mark says 'ClickUp's choices for
"{question}" could not be read, so this request cannot be sent from here
yet. Tell the systems manager; the cockpit reads ClickUp again at 11
minutes past each hour. If it cannot wait, make the task on the {list}
list in ClickUp.' ({list} the list the type's tasks go to, `handLists`;
when they go to more than one, every list is named, since the lost answer
may be what picks among them: "make it on the Call Center or Marketing /
ADs list in ClickUp, or on both, as the request needs.", or "make a task on
each of the ... lists" when every task always runs; clickup-diet-1029) with
"Open the {list} list in ClickUp", one per list, as an outlined link to that list
(`app.clickup.com/90182518398/v/li/{listId}`, a new tab; none for a team
with no list of its own; clickup-diet-1029: no ClickUp form, and only a
real change in ClickUp loses a choice, so it does not come back in a
minute); Send is outlined and
described by that sentence, and still takes a press, so the summary takes
focus to the lost choice (A11Y-21), led by "This request cannot be sent
here yet:" when every answer in it is a lost choice; the route is "Where it
goes" with no Now, held, Due or After that stop, no timing words and no
cancel line, as ahead of requests opening, the questions still on the page.

**Requests not open to the seat.** Since 20261029p every seat is held
instead (2.8): the held note above the map with the held mark, the
questions, "Save request" and the held stop, as for an editor. A database
without 20261029p may still refuse: before a pick, the writer's sentence
above the map, with no link (2026-10-29: no ClickUp form; the form's
columns never grow past the card); after a pick, the plate,
the same sentence in place of the questions, "Requests cannot be sent from
this seat just now, so the cockpit asks you nothing here. The questions
open here as soon as they can be sent."
(`offAsked`; true for every refusal, a writer gone quiet after requests
opened included), or, when answers were given before requests stopped being
open to the seat, those answers under "Your answers so far" and "Your
answers stay on this screen until requests can be sent from this seat."
(`offKept`; review BT-7), and "Where it goes" (review
CL-04): no Now, Due or After that stops, no timing words
(a lane says "Goes to" or "May go to"; a pair's fork says "Two tasks", or
"Depends on the answer" before the deciding question), a lane with no client
says "Named after the client it is for." (no client is asked here), and the
summary names the deciding question: 'One or two tasks, depending on the
answer to "Where is the problem?"' (review BT-1 and CL-03, 2026-10-28); the
plate and the rows name it the same way, never "by your answer" (review
T2-clarity-04, 2026-10-29).

**A client only with a request that asks for one** (review BT-2,
2026-10-28). A client picked for one request stays through Change to
another that asks for a client; a request that asks for none previews,
sends and titles no client (`clientTaskId` null), and picking one clears
it, so an HR request never lands on a client's card. A fixed client says
"This page's client." on the client page and "Fixed for this request."
elsewhere (review BT-12). A client's name is isolated inside a span that
takes the row, so an Arabic name starts where every name starts, and both
searches are `dir="auto"` (review D9, A11Y-19).

**Focus** (research 2.12; review A11Y-01, 2026-10-28). A pressed control
that goes takes focus to what replaces it, never the page body: a picked
client to its Change (named "Change client", apart from the plate's Change,
and described by the client's name and its status; review T2-a11y-02); the
client's Change to the client search; Clear to the question's first choice;
"Show the other {n}" (search, client list, SOP steps) to the first item it
showed (a step's number sits inside the step, so its focus ring takes in
the number; review T2-a11y-03); "Try again" after the request types fail
to the search once they are read, or to the next "Try again" if the read
fails again (review T2-a11y-01, 2026-10-29); "Ask for
something else" to the search; an "Already open" answer to its heading,
which the server's note describes, the client's name isolated in it, with
no status inserted around it (review A11Y-05, A11Y-19). The plate's heading
is described by the reach words and the line (review A11Y-10), and a
heading that takes focus shows the focus ring (review A11Y-12). When
requests stop being open to the seat partway through, the control the
person was on goes with the questions, so focus moves to the writer's note
that replaces them, a group named by its sentence and described by the
line under it (`offKept` or `offAsked`), with a focus ring; above the map
the note stays a status (review T3-a11y-behaviour-02). A search's
count shows at once and is said once typing pauses; the client list's
count is said only once the person types, and only once the read for what
is typed lands: each read keeps the search it was for, the count shown
keeps its read's words ("{n} clients." until the read for what is typed
lands, then "{n} clients match.", "1 client matches." for one), and the
polite line stays empty while a newer read
waits, never an older search's count (review A11Y-08,
T3-a11y-behaviour-01).
Send stays focusable while it sends (`aria-disabled`, one press at a time),
and focus stays on it after a refusal that names no field, which the alert
above it says (review A11Y-06). A control scrolled into view for focus stops
136px above the bottom (the floating Ask Hermes button's top on a phone,
plus 20px), and the unseen native radio covers its whole face, so the face
clears the button too (review A11Y-14). On a touch screen the SOP, "Open in
ClickUp" and the inline links are 40px tall and the search's clear button
40px wide (review A11Y-20). In forced colours (Windows contrast themes) a
ring shows only on the focused control, a chosen face or current pill takes
a thicker edge and the chosen radio's dot is drawn as an edge (review
A11Y-15).
The chosen due day carries the tick, as every chosen pill does, and the
small muted words on a chosen face or current pill lean towards the ink, so
they keep 4.5:1 on the teal tint in both themes (review A11Y-03, A11Y-04).

**After Send** (graft 5; no toast, focus to the heading, the sub-line the one
polite live line): "Sent: {type} for {client}" ("Saved:" while held;
"Partly sent:" as soon as a task is refused while another reached ClickUp
or is on its way, "Not sent:" when none did; review CL-05) and "Nothing
else to do now." with where the tasks are ("It is on its way to ClickUp,
usually within a minute or two.", "One task is in ClickUp; the other is on
its way.", "Both tasks are in ClickUp.", "It goes to ClickUp by itself once
requests open.", "Neither task reached ClickUp."). The minute or two is said
only while every task on its way is queued or sending and the page still
reads it; a create in doubt says "The cockpit is checking whether it
reached ClickUp." (review BT-5, CL-08). While the writer has not reported, a
held request says "It goes to ClickUp by itself once the requests writer
runs with requests open." with no "Nothing else to do now." for an editor,
an admin or the CEO, since their note asks them to check the Machine tab
(review CL-04; `sentModel`'s `asks`). A plain seat's note asks nothing, so
it keeps "Nothing else to do now." and says the gate's own words: "Nothing
else to do now. It goes to ClickUp by itself when the writer is back.",
each task "Saved. Goes to {list} when the writer is back." (or "In {list},
not finished yet. The cockpit finishes it when the writer is back.";
`ROUTE_WORDS.goesByItselfBack`, `heldBack`, `heldInListBack`; with
`wait: "back"`, clickup-diet-1029). For a lead seat each
held task's line then says "Saved. Goes to {list} once the writer runs with
requests open." (or "In {list}, not finished yet. The cockpit finishes it
once the writer runs with requests open."; `ROUTE_WORDS.heldQuiet`,
`heldInListQuiet`) in place of `sentLines()`' "when requests open";
`sentLines()` itself stays as pinned (review CL-04, 2026-10-29). Nor
while a task in ClickUp carries the writer's note (a refused later
step): then the line points at the note:
"It is in ClickUp, but not finished. The note under the task says what to
check there.", or, with more tasks, where they are and "One is not
finished: the note under it says what to check there." once every task is
in ClickUp, else which one: "The one in ClickUp is not finished: ..."
(review CL-01, 2026-10-28; T2-clarity-06, 2026-10-29). `sentTone`, the
heading's words and `sentLines()` are unchanged, but such a task's mark,
and the heading's, is the orange warning, never the green check, as My
requests' chip is (review T2-clarity-05, 2026-10-29); the
`sentAlone` sentence when it applies; after a refusal, the next step (no
link since 2026-10-29), a quiet panel with the red mark (review D17); the focused block
is named by its heading and described by the sub-line and the `sentAlone`
sentence; the sub-line is read whole (`aria-atomic`) and also says a
refusal's next step to a screen reader, so a refusal that comes in while
the page reads the request is said with it (review A11Y-09). Then "Where it is now" (beside
from 880px; under the heading on a phone, and in the page right after the
heading, so Tab follows the screen; review A11Y-11): "Sent at {14:02},
Kuwait time." ("Saved at" while held: one stop, with the send mark as the
route's Now, never a second held stop or clock; review D6; under it "The
cockpit checked it and keeps it here.", or, while the writer is quiet, the
writer's own sentence, which says what to check; the sentence said before
a send, "What you send is saved ...", is a rule and is not repeated after
Save; the kept due day is the Due stop's note; review CL-13,
T3-design-clarity-04, T3-design-clarity-08); each
task's `sentLines()` sentence whole, with its mark (green only on the
check; orange on a task in ClickUp that is not finished), its name and
"Open in ClickUp" from a delivered task's own `url`
(named for its list and as opening a new tab; the SOP link and "Open the
{list} list in ClickUp" say "(opens in a new tab)" to a screen reader too;
review A11Y-17), two tasks
under "Sent together" only while no task failed, else "Two tasks" (review
CL-05); then the SOP, Due and After that stops. Once nothing reached
ClickUp and nothing moves, After that says "Nothing more happens with it by
itself." and "The bell keeps the failure.", and the cancel line goes (review
CL-05). Then "What you asked" (the client and the answers given; due and
priority are the Due stop's, said once; review T3-design-clarity-04); "Ask
for something else" and "See it in My
requests" (or "Open the request", with its chevron); "The owner is chosen
by rule, not picked here.", "Nothing is sent to the client." only when a
client went with it (review D18), and the cancel line or, once a task is in
ClickUp, where to change it. Links inside the card are ink, underlined
(review D17). While the page reads the request (every 5 seconds, 24 reads at
most) the stamp says "Checked {14:03}, Kuwait time"; after it, "Stopped
checking at {14:04}, Kuwait time. My requests shows where it stands." or,
with a task still on its way, "Still on its way. This page has stopped
checking; My requests shows where it is." No held request shows a success
mark. A lifecycle duplicate reads "Already open: {type} for {client}" with the
server's note and "Open it".

**Per app.** The portal's `RequestsPage.tsx` puts the form in a card at the
page's width (the map's three columns and the route beside the questions
need it; the form still works in a narrower card, in one column). The portal
and client success name IBM Plex Sans Arabic after Geist (the portal also
loads it), so an Arabic client name renders in the cockpit's Arabic face.
The client page mounts the form as before (three props).

**Tests** (only these files): `request-form.test.tsx` (the route before and
after the deciding answer, three tasks, an older database, search, a team's
list and the A to Z list, clearing an optional choice, the recent row, the
held state, the sent view's stamps and link; the route while requests are
not open to the seat, a client never sent with a request that asks for
none, where focus goes after each control that goes, the chosen due day's
tick; the error summary said once a press, the route kept until its
preview lands, the owners of the lanes that run, one lane for three tasks
on one list, a team's pointer, the duplicate's described heading, a
refused request that has ended, "Two tasks" after a refusal, one Saved stop
with the kept due day, a writer gone quiet, answers kept when requests stop
being open to the seat; the plate and rows naming the deciding question
and the route ahead of an older database while requests are not open to
the seat, a client cleared by Change to a request that asks for none,
"Try again"'s focus, the warning mark of a task that is not finished;
Send focused while it sends and after a refusal that names no field, the
summary said only once focus has moved, each radio's error sentence, the
polite lines of a search, the route and the client list, the map's one
region, the names of rows, Clear, the due day's date input and the links
that open a new tab, the sent view in screen order, a refusal said with its
next step, and a lost choice that still takes focus; review A11Y-02 to
A11Y-21, 2026-10-29; a switch of answer that keeps the drawn route until
its preview lands, the fixed client's words by page, and a lost question's
route sentence; review BT-4, BT-12, BT-6 and S4, 2026-10-29; the team's
hero true for every answer, the current pill as `aria-current`, the client
count never said for an older search, focus on the writer's note when it
replaces the questions, the kept due day and the held bell note on the Due
and After that stops, the Saved stop without the rule said before Save,
"What you asked" without due and priority, and a lost choice's panel, its
outlined Send and its route; review T3-design-clarity-02, -04, -05, -08,
T3-a11y-behaviour-01 to -03, 2026-10-29),
`requests-core.test.ts` (the looks and their
icons, only the general requests in a team's own mark, the judges'
findability needs and their everyday rewordings,
`searchLeads`, the DFY and DWY switches never opened on Return without
their way, the lifecycle requests' starts and exits, `teamByAnswer`, the pinned "pause"
and "script" outcomes against every
look's words, `routeModel` and `sentModel` with one, two and three tasks,
ahead of requests opening (the reach words and an older database's note
too) and with a delivered task's note, `partFacts`;
the due choices in date order, a part no choice runs (no lane, reach
words, fact, line, owner or search hit, and the lost question's route
sentence), the unheld owner,
`teamRelated`, the sent words while checking, stopped, quiet, partly sent
and ended, and the CSS's accessibility rules: the focus ring on headings
that take focus, the red on a choice in error, the radio covering its face
and the scroll margin, forced colours, the touch targets and the lost
choice's look), `requests-page.test.tsx` (`sentAlone` in the sent view), and,
for the `when` and `steps` keys the route is drawn from,
`request-routes-supabase.test.ts` over migration
`supabase/migrations/20261028a_request_types_read_routes.sql` (the db
role's; its N1 to N7 in section 21, with `requests-fit-supabase.test.ts`).
The layout harness's `send=note` lands every task with the first one's
owner step refused, and `lastMode=` sets the last report of a writer gone
quiet (`writer=unknown`).

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
  `WITH_ERROR`. Integration round 2: `held_unless ('clickup-writeback:requests',
  'mode', 'apply')`, so a `queued` row counts only while the writer reports
  mode `apply`; before requests open, a request an editor, an admin or the CEO
  filed waits queued on purpose (2.8) and the reading says "{n} held until
  requests open." (`sending`, `retry` and `unknown` count in every mode).
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
  `[TEST]` tickets (set cancelled, never delete). Review round 2 and its
  retest add rows for: an `unknown` that covers a call whose receipt could
  not be saved; the renamed or removed Request Type option (now a note on a
  delivered part); Request Type turned off only by an on-time check, and
  never turned back on by going back a version; a routing request skipped
  because its old ticket was handled in ClickUp; an old ticket back in its
  queue; Clear before moving a ClickUp user to another seat; Mark done not
  offered on Video Pipeline and WhatsApp Reconnection; the refused "Cockpit
  ref" words. Review round 3 adds rows for: a part in doubt read every 4 hours
  and how to read it now; "Every task that matches ... is cancelled"; a
  refused search (run the requests doctor); settling a part in doubt by hand
  (the cockpit refuses to cancel it); a create in doubt handed back `unknown`
  while requests are not open (look for its Cockpit ref); an old ticket that
  left All Tasks (`import_left_at`); a hand link starting a seats read; a seat
  an editor cleared; a writer gone quiet after requests opened.
- `scripts/ship.sh`: one block after the Slack notices block, run when
  `apps/media-buyer-cockpit/scripts/requests-supabase.test.ts` exists:
  `cd apps/media-buyer-cockpit && bun test scripts/requests-supabase.test.ts scripts/request-types-seed.test.ts scripts/task-alerts-supabase.test.ts scripts/tasks-core.test.ts scripts/your-tasks.test.tsx scripts/requests-core.test.ts scripts/request-form.test.tsx scripts/requests-page.test.tsx scripts/requests-settings.test.tsx`
  and `bun test supabase/functions/clickup-writeback supabase/functions/cockpit-tasks supabase/functions/comment-watch/watch.test.ts`
  (the comment watch's test joined in the retest of round 2), each failing
  the ship with one plain line, as the block above it does. The block also
  runs `scripts/requests-fit-supabase.test.ts` (section 13) and, since the
  department map round, `scripts/request-routes-supabase.test.ts` (migration
  20261028a, section 21), in the same command and its failure line.

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
| `supabase/migrations/20261028a_request_types_read_routes.sql` (new, the department map round, section 21) | db |
| `apps/media-buyer-cockpit/scripts/request-routes-supabase.test.ts` (new, the department map round) | db |
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
| `supabase/functions/clickup-writeback/reviewR1.test.ts` (new, review R1) | writer |
| `supabase/functions/comment-watch/watch.ts`, `watch.test.ts` (retest round 2: the comment watch never digests the writer's own card comments; deployed on its own, section 12) | writer |
| `supabase/migrations/20261026t_task_alerts.sql` (new) | mirror-alerts |
| `apps/media-buyer-cockpit/scripts/task-alerts-supabase.test.ts` (new) | mirror-alerts |
| `supabase/functions/cockpit-tasks/*` (all new: `index.ts`, `door.ts`, `delta.ts`, `seats.ts`, `detail.ts`, `doctor.ts`, `clickup.ts`, `testkit.ts`, `deno.json`, `README.md`, `door.test.ts`, `delta.test.ts`, `seats.test.ts`, `detail.test.ts`) | mirror-alerts |
| `hermes/cockpit-guardian/checks/queues.py`, `checks/sections.py`, `checks/pg_cron.py`, `checks/edge_functions.py` | mirror-alerts |
| `hermes/cockpit-guardian/tests/test_checks_data.py` and any other guardian test whose counts change (`tests/test_hiring_sync.py`) | mirror-alerts |
| `RUNBOOK.md` | mirror-alerts |
| `scripts/ship.sh` | mirror-alerts |
| `src/lib/requestsCore.ts`, `src/lib/requestsClient.ts`, `src/components/tasks/RequestForm.tsx`, `src/components/tasks/requests.css` in all five apps (new) | portal-screens |
| `apps/media-buyer-cockpit/src/pages/requests/RequestsPage.tsx`, `RequestsSettings.tsx`, `RequestRow.tsx`, `RequestPanel.tsx`, `TypeEditor.tsx`, `SeatLinks.tsx`, `AlertRules.tsx` (new) | portal-screens |
| `apps/media-buyer-cockpit/src/lib/requestsAdmin.ts` (new) | portal-screens |
| `apps/media-buyer-cockpit/src/auth/authenticated/AuthenticatedAppRoutes.tsx` (the two routes only) | portal-screens |
| `apps/media-buyer-cockpit/src/dev/requestsHarness.ts` (new), `apps/media-buyer-cockpit/src/dev/harness.tsx` | portal-screens |
| `apps/media-buyer-cockpit/scripts/requests-core.test.ts`, `request-form.test.tsx`, `requests-page.test.tsx`, `requests-settings.test.tsx` (new) | portal-screens |
| `apps/client-success-cockpit/src/index.css`, `apps/media-buyer-cockpit/src/index.css` (the department map round: IBM Plex Sans Arabic follows Geist in `--font-sans`, for Arabic client names; the media buyer app also adds it to its Google Fonts import, as creative director and video editor already load it there and client success and sales in `index.html`) | portal-screens |
| `src/lib/tasksCore.ts`, `src/lib/tasksClient.ts`, `src/components/tasks/TaskPanel.tsx`, `YourTasks.tsx`, `AlertsBell.tsx`, `TaskFocus.tsx`, `tasks.css` in all five apps (new) | cockpit-screens |
| `src/lib/taskSeat.ts` in all five apps (new) | cockpit-screens |
| `src/lib/cockpits.ts` in all five apps (the `requests` icon only) | cockpit-screens |
| `apps/media-buyer-cockpit/src/components/AppLayout.tsx`, `components/AppSidebar.tsx`, `components/MobileTabBar.tsx`, `components/CommandPalette.tsx`, `components/launch/ClientAlerts.tsx` | cockpit-screens |
| `apps/media-buyer-cockpit/src/pages/CockpitPage.tsx`, `pages/team/TeamPage.tsx`, `pages/AdminPage.tsx` | cockpit-screens |
| `apps/media-buyer-cockpit/src/pages/ceo/TodayTab.tsx` (review R1, ask F13: Your tasks on the CEO's Today) | cockpit-screens |
| `apps/media-buyer-cockpit/src/dev/tasksHarness.ts` (new; exports `installTasksHarness(client)`) | cockpit-screens |
| `apps/client-success-cockpit/src/components/AppLayout.tsx`, `components/AppSidebar.tsx`, `pages/CsmPage.tsx`, `pages/ClientPerformancePage.tsx`, `pages/NoticesPage.tsx` | cockpit-screens |
| `apps/client-success-cockpit/src/lib/requestsOpen.ts` (new, review R1, ask F6: the old Ask a team stays until requests are open for the client) | cockpit-screens |
| `apps/creative-director-cockpit/src/components/AppLayout.tsx`, `components/AppSidebar.tsx`, `pages/DashboardPage.tsx` | cockpit-screens |
| `apps/video-editor-cockpit/src/App.tsx`, `pages/JobsPage.tsx`, `components/Sidebar.tsx`, `components/SearchBox.tsx` | cockpit-screens |
| `apps/sales-cockpit/src/App.tsx`, `pages/TodayPage.tsx`, `components/Sidebar.tsx`, `components/SearchBox.tsx`, `components/MacOSMenuBar.tsx` | cockpit-screens |
| `scripts/check-shared.sh` | cockpit-screens |
| `apps/media-buyer-cockpit/scripts/tasks-core.test.ts`, `your-tasks.test.tsx` (new) | cockpit-screens |
| `apps/media-buyer-cockpit/scripts/sections.e2e.ts` (line 7: "Your ClickUp tasks" becomes "Your tasks") | cockpit-screens |
| `apps/client-success-cockpit/scripts/csm-page.test.tsx` (only where the Ask a team panel or the tickets card changed) | cockpit-screens |
| `docs/requests/CONTRACT.md`, `docs/requests/request-types.json`, `docs/requests/maps/*` | the orchestrator (no builder edits them) |
| `docs/requests/REVIEW-R1-raw.txt` (the round 1 findings and verdicts), `docs/forms/HANDOVER.md` (the forms handover) | the orchestrator |
| `apps/media-buyer-cockpit/scripts/requests-ownership.test.ts` (new: every file this branch changes is in this table) | the orchestrator |
| `apps/media-buyer-cockpit/scripts/requests-fit-supabase.test.ts` (new: the integration fit, section 13; in the department map round the db role added 20261028a to it, section 21) | the orchestrator |

`requests-ownership.test.ts` compares this table with `git diff --name-only`
from the merge-base with `origin/main` (3f9f5c41 after the rebase of
2026-10-26; 86ee4e84 when the build began) plus the untracked files, so
main's own commits are never counted as this build's (integration round 2).
It runs on a build branch of this contract and skips itself on any other
checkout. Until the department map round's last look it ran only on
`tickets-1026`, so on `tickets-look-1028` (merge-base b642283b) it skipped
itself and the two `index.css` files above went unlisted. It now runs on
both branches.

Not touched by anyone: `supabase/functions/cockpit-csm-api/*`,
`cockpit-media-api/*`, `cockpit-creative-api/*`, `cockpit-notices/*`,
`comment-watch/index.ts` and `deno.json`,
`apps/media-buyer-cockpit/convex/*`, `hermes/task-assignment-alerts/*`,
`hermes/cockpit-sync/*`, every migration but the four above.

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
Since the department map round (2026-10-28) also
`cd apps/media-buyer-cockpit && bun test scripts/request-routes-supabase.test.ts`
(20261028a applied twice over r and s): the guard's two md5s and the header
that names them; the body is the live one plus one statement; the function's
settings, owner and grant unchanged, and the gate; `when` and `steps` on every
part for every seat; Low schedule rate's and Create an ad account's parts named
as their questions name their choices; exactly the five seeded routed parts read
a `when`; `steps` equal `sop_steps` on the 13 parts without a template and null
on template parts; both keys agree with `cockpit_request_plan` (the parts each
choice runs, the checklist the writer adds); every other key of the answer is
the old body's, byte for byte; an editor's reordered choices, a renamed, dropped
or lost ClickUp choice, a part with no steps, a cockpit-only question, a type
turned off and the type editor's save answer; the guard refuses a moved or
missing body and its grant lines restore the exact grant.

**writer**: `bun test supabase/functions/clickup-writeback`. With a fake
ClickUp and a fake RPC: the gate (only `APPLY_REQUESTS` opens the two
kinds; it opens nothing else; the canary narrows by card); a dry run calls
no provider; every step of 4.3 for a no-template type, a template type, a
two-part type, a template with no checklist (WhatsApp connection) and a
replaces request; resume of each step after a lost answer (create adopts
by marker or name, two matches go `unknown`); the due read-back passes when
ClickUp stores 06:00 Kuwait for a 12:00 Kuwait write; a field that will not
save is a `mismatch` note, not a failure; Request Type left empty with a note
on a renamed or removed option; errors with no ClickUp answer (a receipt not
saved, a timeout, a dropped body) are read back, never failed; a routing part
whose old ticket was handled in ClickUp is skipped with no write; each
`task_action` op with its preconditions, `unchanged` and `skipped`
sentences, on any list but a client card itself, Mark done skipped on Video
Pipeline and WhatsApp Reconnection; comment words that hold a Cockpit ref
fail before any call; a field entry naming Request Type or a protected
field is never posted; verify `kept`, `restored`, `removed`, `moved` (calls
`rt_off`), and a late check changes nothing; the doctor reports a missing
template and a renamed option (only for types with Request Type on); the
comment watch skips the writer's card comment (`cardCommentText`) and any
Cockpit ref (`bun test supabase/functions/comment-watch/watch.test.ts`);
`rules.ts` maps the three wordings to the right options; the existing
`run.test.ts`, `queue.test.ts`, `kpi.test.ts`, `billing.test.ts` still pass.
Review round 3: a cancelled task drops out of two matches and the one left
open is adopted; a create in doubt is never `failed` at the end of the
ladder; a task that shows late is read for 30 minutes; a refused read-back
or search never fails a part; parts `tech` and `tech_two` never take each
other's task. Integration round 4: during the canary a routing request goes
only when its old ticket's card is a canary card (held on a database that
names no card); a create in doubt handed back while requests are not open
stays `unknown`; the 2-minute check judges Request Type from `madeAt` and the
owner from `ownerAt`, an unreadable time absent.

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
is ever made; the seats job sends `p_open_ids` only after a complete read of
All Tasks (integration round 4).

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
| X6 | WR 10.4: the requests job paces at 40 a minute | 120 a minute, its own setting (2026-10-29: 25, for ClickUp Business; docs/requests/CLICKUP-DOWNGRADE.md) | The token's limit is 1,000 a minute (AT 7.1); 6 requests a run fit one invocation |
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
| X17 | WR 10.5: focus view presses only on the team request boards (an allow-list) | Any task but a client card itself takes a tick, a comment and Mark done, with a block list for Mark done: Video Pipeline `901816720767` and WhatsApp Reconnection `901821803697` (3.4, 4.4; review round 2) | Ask F12: "open it to just focus on it" means a seat's own task on any list; on those two lists a done status publishes a video or messages a client |
| X18 | 2.5: going back to a type version restores every column | It never turns Set Request Type on (review round 2) | Request Type was off for a reason (a 2-minute check found ClickUp moved a task, or an editor switched it off); turning it on is the editor's own switch after the rehearsal ticket (R8) |

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
  (C3, two weeks after go-live). Since 2026-10-29 nothing in the cockpit
  links the form; closing it is the CEO's step in
  docs/requests/CLICKUP-DOWNGRADE.md section 7.
- Asked by the round 2 fixers and left out on purpose (retest round 2):
  - A `p_again_of` argument on `cockpit_request_submit` (re-plan only an
    original's failed parts, retire it in the same transaction). A partial
    request's panel names the missing task (`partialNext`) and points to the
    ClickUp form or the systems manager; a failed original that the seat
    filing again may not cancel stays until its requester, an editor, an
    admin or the CEO cancels it, and the notice says so.
  - Keeping `done_at` null while a part is failed or skipped. Such a request
    could never leave the queues: cancel is refused once a task exists, and a
    partial request is never filed again whole. Its requester had the
    `request_failed` alert, and the panel keeps the missing-task note.
  - Re-pinning `clickup_option_name` from the field catalog. The catalog never
    holds the Request Type field (R8), and a renamed option needs no code
    change: rename it back in ClickUp or turn Set Request Type off for that
    type in Requests settings.
  - A null `client_name` on request alerts and no full stop in "Done in
    ClickUp." and the like: the bell names the client once and drops the stop
    before it (6.5).
  - The same "a receipt not saved is a refusal" problem in the live log job
    (`queue.ts` `executeItem`, the CSM tickets): `queue.ts` is not this
    build's (section 8); noted for its own fix.
- Asked by the round 3 fixers and left out on purpose (integration round 4):
  - The writer saving `unknown` (not `retry`) when it holds a row whose create
    is in doubt at its time budget or when a run cannot begin. The database
    already refuses to cancel such a row (`cockpit_request_queue_in_clickup`:
    a create on record in `queued` or `retry` counts as in ClickUp), the
    writer reads it back before any new write, and the screens say "trying
    again"; only the wording differs.
  - A `lastMode` in the requests harness. The silent-writer sentences are the
    database's, proven there (requests-supabase "a writer that stops
    reporting after requests opened ...", task-alerts "the focus view says a
    writer that stopped reporting ..."), and the screens show what it sends
    (`heldNote`, `writer.note`, `can.why`).

---

## 12. After the build: deploy order and the CEO's items (main session)

Deploy (nothing here is done by a builder; integration round 2 set this
order against the code, the retest of round 2 checked it again, and
integration round 4 moved the linking after the media buyer ship (review
round 3, CN11): each step with the read-back that proves it):

0. Rebase onto the current `origin/main`, then commit the branch
   (`requests-ownership.test.ts` 3 pass first, and the section 9 suites
   green) and push to main; every later step deploys from that commit.
   Integration round 4 read `origin/main` at `ef2262a1` (the upsell studio,
   2026-10-27; its five migrations `20261026u_upsell_catalog` to
   `20261027011000_upsell_monitor_web` are live and touch none of this
   build's objects). Two files changed on both sides,
   `apps/client-success-cockpit/src/pages/CsmPage.tsx` and
   `scripts/check-shared.sh`; a trial three-way merge of each is clean. After
   the rebase run again: check-shared (main added the offer page copies),
   client success's `csm-page` tests, `tsc -b` and biome (main added
   `apps/client-success-cockpit/biome.json`), and
   `supabase/functions/comment-watch/watch.test.ts` (main changed
   `cockpit-csm-api/tools.ts`, which comment-watch bundles). Read-back:
   `git ls-remote origin main` names the commit.
1. `clickup-writeback` first, `verify_jwt` off, bundled from the commit
   (`scripts/dev/deploy_composio.py` with the `fn_extras.py` list). It is
   backward compatible: kpi, log and dosdonts are as live but for the
   `rules.ts` Request Type ids, and the requests cron of migration r posts
   `{"job":"requests"}` to it every minute from step 2 on. It must be live
   before migration t: t lets a focus view press a seat's task on any list,
   and only this writer takes such a press (3.4, 4.4; the old one skipped it
   with the boards sentence). `CLICKUP_WRITEBACK_APPLY_REQUESTS` and
   `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS` stay unset. Read-back: version up
   one, `verify_jwt` false, neither switch in the secrets list (names only);
   `{"job":"doctor"}` ends "Requests and task changes: ..."; `clickup-writeback:log`
   still ok.
2. `comment-watch`, `verify_jwt` off, bundled from the commit the same way
   (its `fn_extras.py` list: `apps/media-buyer-cockpit/src/lib/kpi.ts`,
   `clickup-writeback/rules.ts`, `cockpit-csm-api/tools.ts`), before any
   request reaches ClickUp (the canary's link comments land on the test
   card). Only `kindOf` changed: the writer's card comments are never
   digested. Read-back: version up one, `verify_jwt` false; after its next
   run (minute 7, 22, 37 or 52) `cockpit_sync_state` key `comment-watch` ok
   with a fresh `last_ok_at`.
3. Migration r, then s, then t: each dry run as `BEGIN; <file without its
   own BEGIN;/COMMIT;> ROLLBACK;` through the Composio Supabase connection,
   then applied with its migration name through `SUPABASE_APPLY_A_MIGRATION`
   (PLAN 1.7). Read-backs: r: the eight tables, the claim's
   `q.kind NOT IN ('request','task_action')`, the requests claim naming
   `replaces_task_id` and `replaces_client_task_id`, `cockpit_requests_read`'s
   arguments `p_view text, p_limit integer, p_since timestamp with time zone`,
   `cockpit_request_import` only as `(p_tasks jsonb, p_open_ids text[])`,
   `cockpit_requests.import_left_at` present, no catalog row for
   `e9fd8024-…`, cron `mahara-clickup-writeback-requests` `* * * * *`, and
   within two minutes `clickup-writeback:requests` ok, mode `dry_run`,
   "Nothing to write."; s: 31 types, 31 versions, 24 catalog fields, 34
   templates, `set_request_type` on for exactly the 11 keys of 2.3; t: the
   three tables with row security, crons `mahara-task-mirror` `*/2 * * * *`
   and `mahara-task-mirror-seats` `11 * * * *`, the queue audit trigger
   holding "left out of the audit" with its grant unchanged,
   `cockpit_task_client_of` taking `p_parent`, `cockpit_task_done_blocked`,
   `cockpit_task_writer_why` and `cockpit_task_link_why` present and
   `cockpit_task_board` gone, `cockpit_task_request_failed` holding
   "Deleted in ClickUp: ", and `task-mirror:kick` saying the
   vault has no `cockpit_tasks_cron_secret` (expected until step 4).
4. `cockpit-tasks` (new), `verify_jwt` off; the function secret
   `TASKS_CRON_SECRET` (a new value, never printed) and the same value in the
   vault as `cockpit_tasks_cron_secret`. `CLICKUP_API_TOKEN`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are already there
   (by name). Read-back: ACTIVE with `verify_jwt` false; the vault holds the
   name once; `{"job":"doctor"}` answers ok with the secrets by name and the
   rate limit; within two minutes `task-mirror:kick` "Posted a delta run" and
   `task-mirror:delta` ok.
5. The first `seats` run (`cockpit_task_mirror_kick('seats')`, or wait for
   :11): baseline, members, seat links, fields, templates, imports.
   Read-back: `task-mirror:seats` ok with `baselinedAt`; catalog and
   templates in state `ok` (still no `e9fd8024` row: the read skips it);
   seat links `ok` for the matched seats; the old form's open tickets on All
   Tasks imported, none with `import_left_at` (a complete read sends every
   open id, so a ticket gets it only once it leaves All Tasks).
6. The requests doctor (`{"job":"requests_doctor"}`). Read-back:
   `clickup-writeback:requests-doctor` ok with no problems, note "Ready.
   Requests and task changes: ... 31 request types and 38 targets checked
   against ClickUp."
7. `scripts/ship.sh media-buyer`. Linking cannot come before it: "People in
   ClickUp" exists only in the media buyer's `/requests/settings`, and
   `cockpit_member_clickup_set` needs a signed-in editor (review round 3,
   CN11). Read-back: the live bundle holds "Your tasks", "Ask a team" and
   "People in ClickUp"; `/requests/settings` opens for the CEO.
8. Link the unmatched seats in "People in ClickUp" (the CEO or an editor; no
   editor links their own seat; Clear first to move a ClickUp user). Read-back:
   those rows `manual`; each new link starts a seats read at once
   (`task-mirror:kick` "Posted a seats run" within a minute), and the seat's
   open tasks show on its card within minutes.
9. `scripts/ship.sh creative`, `video-editor`, `sales`, then `client-success`
   last. Read-back: each live bundle holds "Your tasks" and "Ask a team"
   (client success also "Requests you raised today").
10. The guardian on the VPS, released the usual way after steps 1 to 6
   (its rows need the function, the crons and the state keys). Read-back: a
   report-only scan is green for `queue-clickup-requests` (held requests say
   "held until requests open"), the three `run_jobs` keys, the three
   `EXPECTED_JOBS` and `cockpit-tasks` with `verify_jwt` false.

The department map round (2026-10-28) adds one database step, after r is
applied (step 3; r, s and t were live from 2026-10-27) and before its five
apps ship: migration 20261028a, with its dry run and read-backs in section 21.

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
  2-minute check. Before cancelling them, open one of the five in a cockpit's
  focus view (the canary opens the test card's tasks) and tick a step, write a
  comment and press Mark done: read its three `task_action` rows `delivered`,
  the comment ending in its own `Cockpit ref T-…` and shown under the seat's
  role (retest round 2: the writer's task actions have not run live yet).
  Then set the five tasks to cancelled.
- During the rehearsal, read `GET list/901816559981` once (read only): Mark
  done on a client card's subtask needs a status of type done on Clients -
  Mahara (3.4). With none, add one in ClickUp or accept that those presses
  fail with the writer's sentence.
- Then clear `CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS`: requests open to the
  whole team, and the held requests go on the next runs by themselves,
  routing requests whose old ticket is not on the test card included
  (review round 3, E-CANARY). Read-back: `clickup-writeback:requests` mode
  `apply`; no request left `held` (after a few runs, `select count(*) from
  public.cockpit_clickup_writeback_queue where kind='request' and
  state='queued' and attempts=0 and next_attempt_at < now() - interval '5
  minutes'` is 0).
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
| I8 | 12 | Ship order for the client success app: its client page's old "Ask a team" (the live decision-log path) is replaced by the request form, so ship it after the rehearsal opens requests to everyone, or accept that CSMs use the ClickUp form for that window. Superseded by review R1 F6: the client page keeps the old Ask a team and AddTask's teams until requests are open for that client (`requestsOpen.ts`), so client success ships last in step 7 of section 12 |


---

## 14. Review R1, the database side (2026-10-26)

Migrations r and t after the R1 review (`docs/requests/REVIEW-R1-raw.txt`).
Sections 2 and 3 above now say the rules; this is the list, with every shape
a screen or a worker reads that changed. The seed (migration s) did not
change.

| # | Finding | Settled in the database | Proven by |
|---|---|---|---|
| D-SEC-1 | The team queue and the request panel ignored a team-only seat's client limit | `cockpit_request_client_visible`: a team's request needs `cockpit_client_allowed(client)`; a request with no client is not a team-only seat's. Applies to `cockpit_requests_read('team')` (rows and count) and `cockpit_request_get` | requests-supabase "SEC-1: …" |
| D-SEC-2 | Routing an old ticket skipped the Route rule | `cockpit_request_submit` step 8 calls `cockpit_request_can_route`, the rule behind `canRoute` | "SEC-2 and RT-4: …" |
| D-RT-4 | Routing was gated only by the new request's card | The import's card must be `p_client_task_id`; the gate runs on the import's card | same |
| D-SEC-3 | An editor could link any seat to any ClickUp user | One active seat per ClickUp user (set and the hourly match); no editor links their own seat but the CEO; the API user only on the CEO's seat | "SEC-3: …" |
| D-SEC-4 | A `retry` part may already have a task | Cancel (and `canCancel`) refuses when a part or queue row has a ClickUp task | "SEC-4: …" |
| D-SEC-5 | Focus view refs were the browser's id; the detail showed others' action ids | `ref` chosen by the database; `TaskDetail.actions` holds only the seat's own presses | task-alerts "a press is one queue row …"; fit "the focus view opens …" |
| D-F3/4/5 | Dry run: an editor's request became a dead `dry_run` row | Held requests (2.8); the claim takes only what the writer sends; `cockpit_clickup_writeback_release` for a row the writer will not send | "dry run: …", "the canary: …", "release: …" |
| D-RT-5 | Request Type off reached only the type row | Waiting rows of the type get `setRequestType false`; sent ones keep their 2-minute check | "RT-5: …" |
| D-F10/D12 | The media buyer of record and its note | No per-client source exists (checked); the note is honest and its "set one" line is for editors only | "one open lifecycle request per card", "the media buyer of record: …" |
| D-F11 | The field read never added a field | New writable fields are added, state `ok`, unmapped; never the three never-written fields (`e9fd8024`, `09abf737`, `d3ac52c5`; review round 2) | "the field read keeps …"; "review round 2: R8 …" |
| T-Ask F1 | The editor desk dropped every Video Pipeline alert | `cockpit_task_hidden(…, p_top)`: Video Pipeline leaves only the desk's Your tasks | task-alerts "the bell: …" |
| T-Ask F2 | A card's real subtasks were hidden | Only a card itself (top-level) is left out: Your tasks, alerts, due today, overdue, comments | "assigned: …", "ask F2: …" |
| T-F1 | Seat and detail reads swallowed assignment and status changes | One shared diff for every mirror write; alerts on a change ClickUp reports | "assigned: …", "contract F1: …" |
| T-F2 | Due today counted lists Your tasks leaves out | Counted from `cockpit_task_my_set`; the editor desk gets its own scoped row | "contract F2: …" |
| T-F6 | Comments were marked read at RPC time | `p_read_at` (default now) | "F6: …" |
| T-F8 | The CEO's own comments read "the cockpit" | No marker: "the CEO"; a cockpit marker: "the cockpit" | "the API user's note …", "F8: …" |
| T-F9 | Status alerts to the seat that moved the task in ClickUp | Not knowable from the task read; the seat's own focus view press is still excluded; recorded as a limit in 3.2 | (limit) |
| Writer asks | Release, task owners, failed comment reads, truncated delta | `cockpit_clickup_writeback_release`, `cockpit_clickup_writeback_task_owners`, `cockpit_task_mirror_comments(…, p_read_at, p_failed)` with the backoff in `comment_due`, `deltaTruncated` in the inputs | "release: …", "task owners: …", "a thread read that failed …", "the inputs say …" |

Shapes that changed (all additions; no RPC was renamed and no argument was
removed):

- `cockpit_request_types_read().writer` and `cockpit_request_preview().writer`:
  new key `held` (boolean). `canSend` now means "may file now", held
  included; `note` is set for a held request too.
- `cockpit_request_submit` returns a new key `held`; `note` carries the held
  sentence (null when the request goes at once).
- RequestRow (`cockpit_requests_read`, `cockpit_request_get`,
  `cockpit_request_cancel`): new keys `held`, `heldNote`. `PartRow.owner.note`
  is now per reader (D12).
- `cockpit_request_field_catalog_sync` returns new keys `added`, `skipped`.
- `cockpit_task_mirror_inputs` returns a new key `deltaTruncated`.
- `cockpit_task_mirror_comments` takes two optional arguments, `p_read_at`
  and `p_failed` (old two-argument calls still work).
- New service RPCs: `cockpit_clickup_writeback_release(uuid,uuid,jsonb,text,timestamptz)`,
  `cockpit_clickup_writeback_task_owners(text[])`.
- `cockpit_member_clickup_set` refuses more (SEC-3), with the sentences in 2.5.
- `cockpit_task_alerts` rows carry `scope`; the bell reads it, the AlertRow
  shape is unchanged.

---

## 15. Integration round 2 (2026-10-26 and 27, after the round 1 fixes)

The branch was rebased onto main `3f9f5c41` (main's `20261026p`, `s`, `t`
and both `u` files are live and touch none of this build's objects). What
this round changed so the pieces fit, each with its proof:

| # | Where | Settled | Proven by |
|---|---|---|---|
| J1 | 3.1, 3.4, 4.4, migration t, `taskActions.ts` | A client card's real subtasks (on Your tasks since ask F2) take a tick, a comment and Mark done in `cockpit_task_can`, `cockpit_task_act` and the writer alike; a card itself takes none, with "This is a client card. Open it in ClickUp." for every op. A card's subtask carries its card as `client_task_id` (`cockpit_task_client_of` takes `p_parent`), so the client's name shows on it and the canary card opens its subtasks. The boards sentence now names card subtasks | task-alerts "ask F2 in the focus view: …", "the upsert refuses …", "each refusal in order …"; taskActions "a real subtask of a client card …" |
| J2 | 2.5, migration r, `requestsClient.ts`, CsmPage | `cockpit_requests_read(p_view, p_limit, p_since)`; `readRequests(client, view, limit, since)` sends `p_since` only when given. The CSM's "Requests you raised today" and the end of day's ticket count read from the start of today in Kuwait, or from 04:00 of the end of day's own day when that is earlier (`requestsSince`), so the old "latest 200, open ones first" note is gone | requests-supabase "since: …"; csm-page "today's requests are read on the server …", "the read starts at today's start …" |
| J3 | 8, `requests-ownership.test.ts` | The test diffs from the merge-base with `origin/main`, not the old base `86ee4e84`, and section 8 names the five files the round 1 fixes added | requests-ownership 3 pass |
| J4 | 7, guardian `queues.py` | `queue-clickup-requests` counts a `queued` row only while the writer reports mode `apply`: a held request (2.8) is not stuck | guardian "a held request waits on purpose until requests open" |
| J5 | live drift | `cockpit_clickup_writeback_audit`, `_begin`, `_claim` and `_idle` are the only functions r and t replace that exist live; each live body equals its 20261009f body (whitespace aside) and keeps the grant `postgres, service_role`. r and t change only the intended lines (the `requests` job, the claim's kind filter, the comment length in the audit). The live queue kind and runs job checks are as r expects. No drift to carry | `pg_get_functiondef` read 2026-10-26 |
| J6 | migrations | r, s and t apply twice in filename order between main's 20261026 files, and twice after them (as production will take them), on the fit test's Stage 1 base | PGlite run, both orders |

Known and not this build's (each also fails on a clean export of main
`3f9f5c41`): `apps/media-buyer-cockpit/scripts/ceo-delivery-cost.test.ts`
needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the environment
(`src/lib/supabase.ts` builds its client at import; with any values set it
passes 25 of 25); `scripts/eod-rollup.test.ts` "the EOD form's over-the-gate
field reads the no-lead line too" expects a line main's `CockpitPage.tsx`
still has.

---

## 16. Review round 2, the database side (2026-10-27)

Migrations r and t after the round 2 review. Sections 2 and 3 above now say
the rules; this is the list, with every shape a screen or a worker reads that
changed. The seed (migration s) did not change.

| # | Finding | Settled in the database | Proven by |
|---|---|---|---|
| E-R8 | Request Type could be set outside its own switch: the hourly field read could add the folder field, a question could map to it, a payload could carry it | `cockpit_request_never_written` (`e9fd8024`, `09abf737`, `d3ac52c5`): the read skips them, the type guard refuses a question mapped to one, `cockpit_request_plan` leaves them out; migration r deletes any such catalog row once (audit `request_fields.removed`) | requests-supabase "review round 2: R8: …" |
| E-UNROUTE | An old form ticket stayed `routed` when the request that routed it was cancelled or failed before its replaces step, so Route never showed again | `cockpit_request_unroute`, from cancel and from `cockpit_request_refresh` (`failed`, or `partial` with the carrying row failed or skipped and no replaces step); audit `request.unrouted`; the history says "Back in the queue: …" | "a routing request cancelled before ClickUp …", "a routing request that fails before its replaces step …", "a two-part routing request whose part that carries the old ticket failed …" |
| E-CANARY | In the canary, an old ticket with no card could be routed onto the test card, go at once and close a real ticket | submit step 8 refuses (`55000`) | "in the canary, an old ticket with no card cannot go out on the test card …" |
| E-ROUTE | A team-only seat could route an old ticket with no client, which its queue never shows it | `cockpit_request_can_route` uses `cockpit_request_client_visible` | "a team-only seat cannot route an old ticket with no client …" |
| E-EDITOR | A team-only seat named an editor saw every client's requests | `cockpit_request_sees_all`: All requests and its count, the request panel, cancel and Route keep its client limit | "a team-only seat named an editor keeps its client limit …" |
| E-DUP | The duplicate answer's "Open it" led to a request the seat may not open | `cockpit_request_may_open` (also the request panel's gate); otherwise `duplicateOf: null` and a note naming who raised it by role, or the queue an old ticket waits in | "the duplicate answer for an old form ticket names the queue it waits in …" |
| E-RESTORE | Going back to an older version turned Request Type back on | Restore sets the version's value AND the current one; version note, audit `requestTypeKeptOff`, and `restoreNote` | "going back to a version never turns Request Type back on; it may turn it off" |
| E-HELD | The held notes began "Saved." on a form where nothing was sent yet | Reworded (2.8) | "the held notes are true before Send: none begins with Saved." |
| E-OWNER | A non-editor read "Goes to the systems manager." beside the owner line that already names them | "No media buyer is named for this request type yet." | "one open lifecycle request per card" (the preview and the row as a non-editor reads them) |
| E-SEC5 | A ref typed or quoted in a comment's words relabelled the comment | `cockpit_task_comment_author(bigint,text,text)`: only the marker that ends the text, a `T-` ref only among Comment presses on the same task; `cockpit_task_act` refuses words that hold a marker (`22023`) | task-alerts "SEC-5: …" |
| E-BELL | The bell's unread count counted alerts beyond the 50 it lists, so Mark all read never cleared it | `unread` counts the unread among the 50 returned (ties by id) | "the bell's unread count is the unread among the 50 it lists …" |
| E-F9 | A seat's own Mark done alerted it while still on its way; a tick or a comment hid status alerts | `cockpit_task_own_done`: an in-flight or just-delivered Mark done of that seat hides only a done or closed status, and the requester's own `request_done` | "F9: …" |
| E-F12 | The focus view worked only on the team request boards | `cockpit_task_done_blocked` (Video Pipeline, WhatsApp Reconnection) replaces `cockpit_task_board`; `cockpit_task_can` and `cockpit_task_act` take any task but a client card itself | "ask F12: …" |

Shapes that changed (all additions; no browser RPC was renamed and no
argument was removed):

- `cockpit_request_type_restore` returns TypeView plus `restoreNote` (text or
  null).
- `cockpit_request_submit`'s duplicate answer may carry `duplicateOf: null`
  with the role or queue note.
- `cockpit_task_can` answers `done: false` only on a client card itself,
  Video Pipeline and WhatsApp Reconnection, with its sentence in `why`.
- Internal: `cockpit_task_comment_author(bigint,text,text)` replaces the
  two-argument one; `cockpit_task_board(text)` is dropped for
  `cockpit_task_done_blocked(text)`; new `cockpit_request_never_written`,
  `cockpit_request_sees_all`, `cockpit_request_may_open`,
  `cockpit_request_unroute`, `cockpit_task_own_done`. New audit actions
  `request.unrouted`, `request_fields.removed`.

The writer's and the screens' halves of round 2 are in 4.2 to 4.5, 6.2 to
6.6 and section 17.

---

## 17. Integration round 3 (2026-10-27, the retest after the round 2 fixes)

What this round changed so the pieces fit, each with its proof. The base is
still main `3f9f5c41` (`git ls-remote origin main`, read 2026-10-27).

| # | Where | Settled | Proven by |
|---|---|---|---|
| K1 | 2.6, migration r | `cockpit_clickup_writeback_claim_requests` gives every `request` row its request's `replaces_task_id`, so a part claimed in a later run than the first part still reads the old ticket before it makes anything (the writer read it, but nothing sent it) | requests-supabase "every part of a routing request names the old ticket in its claim …" |
| K2 | 3.3, migration t | The "any other cockpit marker" check and the focus view's marker cut take an underscore (`[A-Za-z0-9_-]`): a part named `call_center` writes `R-…-call_center-card`, which read as the CEO's own and kept its marker in the text | task-alerts "a marker whose part holds an underscore is the cockpit's own …" (fails on the old pattern) |
| K3 | 3.4, 4.4, `taskActions.ts` | The writer takes a tick, a comment and Mark done on any task but a client card itself, and skips Mark done on Video Pipeline and WhatsApp Reconnection with the database's sentences (`DONE_BLOCKED`); `ACTION_SAY.boards` is gone. A comment whose words hold a Cockpit ref fails before any call (second guard). Without it, presses the database now accepts ended skipped | taskActions "a seat's task on any list takes …", "comment words that hold a Cockpit ref are never posted …" |
| K4 | 4.3, `requests.ts` | The fields step never posts Request Type or a protected field, in any case: `mismatch` with the fields note (second guard) | requests "a field entry naming Request Type or a protected field is never posted …" |
| K5 | 8, 12, `comment-watch/watch.ts` | `kindOf` skips "Cockpit · … asked …" and any `Cockpit ref` (also the CSM cockpit's older marker), so a request's link comment on a card is never digested as a typed note. The writer owns the two files; the function deploys on its own (step 2) | comment-watch "the cockpit's own request link comment on a card is never digested …" |
| K6 | 6.2, 6.4, `RequestPanel.tsx`, `RequestsPage.tsx`, `RequestForm.tsx`, `requestsCore.ts` | "File it again" on a routing request carries its `replacesTaskId` with `replacesIfOpen`: it routes the old ticket the server put back in its queue, or, when the ticket was routed meanwhile, the same request id goes on its own with a toast. A routing request the old-ticket check skipped shows the ticket's link and no "File it again" | requests-page "a routing request filed again routes its old ticket again …", "routing an old ticket a teammate routed first is refused, never sent twice", "a routing request that made nothing because the old ticket was handled …" |
| K7 | 6.4, `TypeEditor.tsx`, `requestsAdmin.ts` | Going back a version shows the server's `restoreNote` in the toast | requests-settings "going back to a version never turns Set Request Type back on …" |
| K8 | `requestsHarness.ts`, `tasksHarness.ts` | The harness answers as the database now does: the held notes, the owner note per reader, the duplicate answer, the `request.unrouted` line on cancel, the no-card canary refusal, restore keeping Request Type off; the task harness applies the done rule by list | request-form, requests-page and requests-settings; your-tasks "on Video Pipeline a task takes a tick and a comment but no Mark done …" |
| K9 | 7, `RUNBOOK.md`, `scripts/ship.sh`, `seats.ts` | The round 2 RUNBOOK rows (section 7); the ship gate's requests block also runs `supabase/functions/comment-watch/watch.test.ts`; the stale "never a new field" comment in `seats.ts` says what the read does | `bash -n scripts/ship.sh`; the block's commands run green |
| K10 | tests | The four happy-dom screen files allow 20 s a test (`setDefaultTimeout`). Two of this round's first full runs of the eleven files timed out one screen test at about 7.5 s (it takes about 1 s alone) and the overlapping `act()` calls then failed the rest of that file and the next one (33 failures); nothing else changed between those runs and the green ones. No assertion changed | the eleven files green in one process again and again (section 9 commands) |
| K11 | 8, `requests-ownership.test.ts` | `comment-watch/watch.ts` and `watch.test.ts` belong to the writer; every changed file has one owner | requests-ownership 3 pass |
| K12 | live drift | Only `cockpit_clickup_writeback_audit`, `_begin`, `_claim` and `_idle` of the functions r and t replace exist live; each live body still equals its 20261009f body (comments and whitespace aside), grant `postgres, service_role`. r and t change only their intended lines. Live checks still the five queue kinds and `kpi, log, dosdonts`. No drift to carry | `pg_get_functiondef` read 2026-10-27 |
| K13 | migrations | r, s and t apply twice in filename order among main's 20261026 files (p, r, s, s, t, t, u, u, then again), and twice after them as production takes them, on the fit test's Stage 1 base | PGlite run, both orders (scratch, deleted) |

Asked and left out on purpose: see section 11, "Not in this build". The
known failures outside this build in section 15 stand.

---

## 18. Review round 3, the database side (2026-10-27)

Migrations r and t after the round 3 review. Sections 2 and 3 above now say
the rules; this is the list, with every shape a screen or a worker reads that
changed. The seed (migration s) did not change.

| # | Finding | Settled in the database | Proven by |
|---|---|---|---|
| G-DOUBT | A part whose create went out and lost its answer (a create on record, no task id) could be cancelled while it waited in `queued` or `retry`, orphaning the task ClickUp made; a hand back put it to `queued` | `cockpit_request_queue_in_clickup` (cancel and `canCancel`); `cockpit_clickup_writeback_release` keeps such a row `unknown`; the history says "{team}: ClickUp did not answer; checked once requests open" | requests-supabase "a part whose create went out and lost its answer is never cancelled while it waits ...", "a routing request whose create is in doubt keeps its old ticket routed ..." |
| G-CLOCK | The 2-minute check timed "on time" from delivery, which a retried later step can push hours past the writes it judges, and read `setRequestType` from the frozen payload | The verify payload carries `ownerAt` and `madeAt` (`cockpit_request_step_at`) and `setRequestType` from the `request_type` step's state (2.7) | "the 2-minute check's payload says what the part's steps did ..." |
| G-CANARY | A request filed held before the canary began, routing an old ticket with no card onto the test card, could go out during it and close a real ticket | `cockpit_request_replaces_ok` in the requests claim, `cockpit_request_held` and submit step 8; the claim's rows carry `replaces_client_task_id` | "E-CANARY: a request filed held before the test ..." |
| G-HANDLED | An old ticket moved, closed or deleted in ClickUp stayed in the team queue with Route, and a routing request the writer skipped for it put it back to `imported`, so the loop could start again | `cockpit_requests.import_left_at` from a complete hourly read (`cockpit_request_import(jsonb, text[])`, audit `request.import_left`); `cockpit_request_import_handled` (with the task mirror) in the views, the sort, `can_route`, submit steps 7 and 8 and `unroute`; `unroute` also stops on the writer's `SAY.oldHandled` | "an old ticket a complete hourly read no longer finds open on All Tasks leaves the queues ...", "a routing request the writer skipped because the old ticket was handled in ClickUp keeps it routed ..."; task-alerts "an old form ticket the task mirror shows moved off All Tasks ..." |
| G-QUIET | A writer that stopped reporting after requests opened read as "not switched on yet" | `cockpit_clickup_requests_mode().lastMode`, `cockpit_request_writer_silent`; the send gate's `unknown` rows (2.8), `heldNote`, and the focus view's `cockpit_task_writer_why` | "a writer that stops reporting after requests opened is said as such ..."; task-alerts "the focus view says a writer that stopped reporting ..." |
| G-CLEARED | A seat an editor cleared on purpose was still asked to "ask the systems manager to link it" | `cockpit_request_seat().linkState`; `MyTasks.linkState` and `TaskAlerts.linkState` with the cleared notes; Assigned to me's note; `cockpit_task_link_why` | task-alerts "a seat an editor cleared is told it has no ClickUp user ..." |
| G-LINK | A hand link showed the seat's older open tasks only at the next :11 | `cockpit_member_clickup_set` calls `cockpit_task_mirror_kick('seats')` for a seat newly linked, inside an exception block | task-alerts "a hand link reads the seat's ClickUp tasks at once ..." |

Shapes that changed (all additions; no browser RPC was renamed and no
argument was removed):

- RequestRow gains `importHandled`; `heldNote` has a second sentence (2.5).
- `MyTasks` and `TaskAlerts` gain `linkState` (3.3).
- The verify payload gains `ownerAt` and `madeAt` (2.7).
- `cockpit_clickup_writeback_claim_requests` rows gain `replaces_client_task_id` (2.6).
- Service: `cockpit_request_import(jsonb, text[])` replaces the one-argument
  version (dropped); its return gains `left` and `back` when `p_open_ids` is given.
- Internal: `cockpit_request_writer_silent(text)`, `cockpit_request_replaces_ok(text,jsonb)`,
  `cockpit_request_import_handled(cockpit_requests)`,
  `cockpit_request_queue_in_clickup(cockpit_clickup_writeback_queue)`,
  `cockpit_request_step_at(jsonb)`, `cockpit_task_writer_why(text)`,
  `cockpit_task_link_why(jsonb)`. New audit action `request.import_left`.

---

## 19. Review round 3, the writer and the screens (2026-10-27)

**The writer** (`requests.ts`, `run.ts`; 4.2 item 7, 4.3 rows 1 and 2, 6.4
`againFailed`). Proven in `requests.test.ts` (the two "review round 3"
groups, 16 tests):

| # | Settled | Proven by |
|---|---|---|
| W1 | Two matches drop the cancelled; one left open is adopted; every match cancelled is `unknown` with its own sentence | "two tasks match: once a person cancels one in ClickUp ...", "every matching task cancelled: nothing is adopted ..." |
| W2 | A create still in doubt at the end of the ladder stays `unknown`, read every 4 hours (`DOUBT_MINUTES`, `STILL_CHECKING`), never `failed`; a refused search searches again | "at the end of the ladder a create still in doubt stays unknown ...", "a create whose every answer was a 5xx ...", "ClickUp refusing the search ..." |
| W3 | A task ClickUp answered the create with is read for 30 minutes before it is called gone (`SHOW_WAIT_MS`); a refused read-back is `STEP_REFUSED.create` and the part is delivered with a note | "a task ClickUp answered the create with but shows late ...", "... still does not show 30 minutes after ...", "... whose read-back keeps failing ...", "a task ClickUp made and then refused to show ..." |
| W4 | A part delivered at the end of the ladder promises no next run (`finalWords`) | "the note of a part delivered at the end of the ladder promises no next run" |
| W5 | A part's ref is matched as a whole token (`holdsMarker`), so parts `tech` and `tech_two` never take each other's task, in the create and the description steps | "matches the ref as a whole token ...", "a create that never landed waits ...", "a create that landed and lost its answer adopts its own task ...", "a template part that lost its answer adopts its own task by name ...", "a task holding this part's own ref that another queue row holds ...", "the description step never takes a sibling part's longer ref ..." |

**The screens** (6.2, 6.4, 6.5, 6.6, 12):

| # | Settled | Proven by |
|---|---|---|
| L1 | The Request types row names each part's runs-when with the question quoted and the choices' names; the harness editor read is in the I1 shape by default | requests-settings "one row a type ...", "on a database from before I1 ...", "runs-when words ..." |
| L2 | The same-name rule on one board applies only when one request can make both (`bothRun`) | "Create an ad account saves a due change ...", "two tasks clash only when one request can make both" |
| L3 | A note with no rows is the list's whole state | requests-page "a seat that is not linked sees why ...", "a seat with no team ..." |
| L4 | Below `sm` a row is two lines: the whole type with its due word, then the chip and the client | "on a phone a row shows the whole type and status ..." |
| L5 | The request panel says each state once | "the panel says each state once ...", "a held request's when-it-goes is said once ...", "an old ticket whose check found it handled says so once ..." |
| L6 | Mark done's sentence sits on its own line above the foot buttons | your-tasks "a Mark done that comes back skipped ..." |
| L7 | A request filed again or an old ticket made a request carries its words, priority and due day into whichever type is picked; a turned-off type and kept words are said | three request-form tests, four requests-page tests, requests-core "a request's own due day carries into the form only when the server would take it" |
| L8 | request-form.test.tsx sets the test clock to `NOW` | the request-form tests, run on any day |
| L9 | Section 12 links the seats after the media buyer ship (CN11) | section 12 steps 7 to 10 |

---

## 20. Integration round 4 (2026-10-27, the retest after the round 3 fixes)

What this round changed so the pieces fit, each with its proof. The base is
still main `3f9f5c41`; the branch head is `58d6b62f` (round 1), with rounds 2,
3 and this round uncommitted. `origin/main` has moved on to `ef2262a1` (the
upsell studio); section 12 step 0 says what the rebase needs.

| # | Where | Settled | Proven by |
|---|---|---|---|
| M1 | 4.4, `taskActions.ts` | The 2-minute check times the owner put-back from `ownerAt ?? madeAt ?? created_at` and rt_off from `madeAt ?? created_at`; a value that is not an ISO time with its offset is absent (`stampMs`) | taskActions "on time is measured from when Request Type and the owner were written ...", "the owner's clock falls back to madeAt ...", "end to end: a part whose card comment kept retrying is delivered late ..." |
| M2 | 4.2 item 6, `run.ts`, `requests.ts` | In `apply_limited` a routing request is live only when the claim's `replaces_client_task_id` is a canary card, else held with the canary waiting note; a database that names no card holds it. Covers the run right after a switch flip, which still claims by the old mode | requests "review round 3: during the canary a routing request goes only when its old ticket's card is a canary card" (3 tests; 2 fail with the rule taken out) |
| M3 | `requestsTestkit.ts` | The fake database mirrors migration r: the release keeps a create in doubt `unknown`; an opt-in claim by the reported mode with the canary rule (`claimMode`, `imports`) and `replaces_client_task_id`; the verify payload's `setRequestType` from the step, `ownerAt`, `madeAt` | requests "a part whose create went out with no task the cockpit holds goes back unknown ..."; the M1 end-to-end test |
| M4 | 5.3, `cockpit-tasks/seats.ts`, `testkit.ts` | The seats job sends `p_open_ids` (every task open on All Tasks, by its own id and status type) only after a complete read; the fake answers `left` and `back` | seats "members, fields, templates, every linked seat in full ...", "a read of All Tasks cut short names no open tasks ..."; the fit test drives it through migration r |
| M5 | 6.5, shared `tasksCore.ts`, `YourTasks.tsx`, `AlertsBell.tsx` (all five), `tasksHarness.ts` | `MyTasks.linkState` and `TaskAlerts.linkState`; a cleared seat is never offered "Link it in Requests settings" and the rules read is not asked; the harness has a `cleared` scenario answering as the database does | your-tasks "a seat an editor cleared is told it has no ClickUp user and is never sent to link it ..." |
| M6 | 6.4, 6.6, shared `requestsCore.ts` (all five), `RequestPanel.tsx`, `requestsHarness.ts` | `importHandled` words, chip tone and not open; `againDeleted` for a failed task that keeps its link; an `unknown` task shows the writer's note, or `checkingHeld` for one handed back; a held request reads the database's `heldNote` once; the harness's `cancellable()` follows the database (a task, or a create in doubt, refuses), its hand back keeps a create in doubt `unknown`, and it answers `importHandled` | requests-core "review round 3: an old ticket handled in ClickUp, a create in doubt, a quiet writer's held note"; requests-page "an old form ticket moved or closed in ClickUp leaves the team queue ...", "a request whose task was deleted in ClickUp says so ...", "a part whose create may have reached ClickUp cannot be cancelled ...", "a held request reads in the database's words ..." |
| M7 | 3.2, migration t | The `request_failed` alert of a failed part that holds a ClickUp task reads "Deleted in ClickUp: {error}" | task-alerts "request failed: ..." |
| M8 | 2.4, 2.6, 6.2, migration r, `RequestForm.tsx`, `requestsCore.ts` (X2) | A routing request's tasks link back ("Routed from the old ClickUp form ticket: {url}") and carry the old ticket's words ("Asked on the old ClickUp form:") when the type has no details question, since the old ticket is cancelled once routed; the form says `keptRouted` | requests-supabase "making it a request routes it ...", "a type with a details question routing an old ticket gets the link back ..."; requests-page "Make it a request, then Change ..." |
| M9 | 7, 12, RUNBOOK, HANDOVER | The round 3 RUNBOOK rows; section 12 steps 0 to 10 (CN11); `docs/forms/HANDOVER.md`'s status lines and deploy list | read |
| M10 | live drift | `cockpit_clickup_writeback_audit`, `_begin`, `_claim` and `_idle` are still the only functions r and t replace that exist live; each live body equals its 20261009f body (comments and whitespace aside), grant `postgres, service_role`; r and t change only their intended lines. Live checks still the five queue kinds and `kpi, log, dosdonts`; no table, function, cron or vault name of this build exists live. Main's five upsell migrations were applied live during this round (`20261026u_upsell_catalog` to `20261027011000_upsell_monitor_web`, about 10:12 UTC); read again after them, the four bodies hash the same and nothing else changed. No drift to carry | `pg_get_functiondef` read twice 2026-10-27 |
| M11 | migrations | r, s and t apply twice in filename order among main's 20261026 files (p, r, s, s, t, t, u, u, then r, s, t again) and twice after all of them as production takes them, on the fit test's Stage 1 base (main's files with their own tables stood in and function bodies unchecked); the whole fit suite passes on each (13 of 13) | PGlite run, both orders (scratch, deleted) |
| M12 | 8 | Every changed file has one owner; no file was added | requests-ownership 3 pass |

Asked and left out on purpose: see section 11, "Not in this build". The
known failures outside this build in section 15 stand.

---

## 21. The department map round, the database side (2026-10-28)

One migration, `supabase/migrations/20261028a_request_types_read_routes.sql`
(section 1, row 4), so the request form (6.7) can mark the question that
decides where a request goes and list the steps an owner works through,
before Send. It replaces only `cockpit_request_types_read()`. Before it, only
editors read either fact (as `targets` and `sopSteps`), so the form could only
guess from the preview's "Pick ... to see where it goes."

| # | Settled | Proven by |
|---|---|---|
| N1 | Every part of every type in the types read carries `when` and `steps`, for every seat (2.5) | request-routes-supabase "a seat that is not an editor reads both keys on every part", "Low schedule rate: ...", "Create an ad account: ...", "a part that always runs reads when null ...", "steps: the type's SOP steps for a part with no template ..." |
| N2 | `when` is the server's own routing and `steps` the writer's own checklist. For every choice of every deciding question, `cockpit_request_plan` runs exactly the parts whose `when` names it, plus those whose `when` is null; with nothing answered, only the latter. `steps` is the payload's `sopSteps` when its `sopStepsWhen` is `always`, `[]` when the part adds none, null with a template | request-routes-supabase "both keys say what the server makes ..."; requests-fit-supabase "20261028a: every seat's form reads when and steps on every part, and each choice of a deciding question makes the tasks the preview names" (the portal's own `readRequestTypes`, `answerRoutes` and `previewRequest`: six choices, and every type with nothing answered), and "the route line before Send matches what the writer makes in ClickUp ..." (General tech request's `steps` equal its queue row's `sopSteps` and the checklist the writer made in the made-up ClickUp) |
| N3 | The body is the live one byte for byte, with one statement added after the types are read; nothing else in the answer changes, for any seat or writer mode | request-routes-supabase "the body is the live one with one statement added ...", "every other key is the old body's, byte for byte ..." |
| N4 | The guard: the file refuses, and changes nothing, unless the live `prosrc` md5 is 20261026r's (`2f12d9541235919c176db2c0cc400f95`) or its own (`130d4b4d67d1e6ee32c9ed55f33c8f21`). Its REVOKE then GRANT gives back exactly the live grant (`authenticated` only) | request-routes-supabase "applies twice ...", "the grant and the function's settings are as they were", "the guard" |
| N5 | On a database without 20261028a the portal's client reads neither key, `routesKnown` is false and the form falls back (6.7). The rollback (20261026r's types read again) keeps the grant, and the file applies over it again | requests-fit-supabase "20261028a rolled back (20261026r's types read again) ..." |
| N6 | The four files apply twice in order over Stage 1 (r, s, t, 20261028a, then again: r's second run puts the old types read back, and the guard takes it) | requests-fit-supabase "r, s, t and 20261028a apply twice over Stage 1 ..." |
| N7 | The ship gate's requests block runs `scripts/request-routes-supabase.test.ts` beside the fit test (section 7) | `bash -n scripts/ship.sh`; the block's command green |
| N8 | Every file this round changed has one owner in section 8, the two `index.css` files included, and the ownership check runs on this round's branch instead of skipping itself | requests-ownership 3 pass on `tickets-look-1028` (it was 2 pass, 1 skip) |

Shapes that changed: `TypeView.parts` gains `when` and `steps` (2.5), in the
answer of `cockpit_request_types_read` only. Not changed:
`cockpit_request_type_view` and every other function, so the preview, the
send, the writer, the type editor's save and restore answers (which carry
neither key) and the alerts are as before. No table, row or other grant
changes. The SOP steps every seat can now read were checked live (read only,
2026-10-28): 87 steps in all, of which every seat now reads 81 (WhatsApp
connection issue's 6 stay with editors, since its part has a template); none
holds an email address, a phone number, a link or a secret.

Deploy (the main session; no builder does this). It is safe before the five
apps ship, since the live form ignores the two keys and the new form only falls
back without them, and it must go before them for the routing marks and the
step lists to show. Read 2026-10-28: r, s and t are applied live, 20261028a is
not.

1. Check the live body has not moved:
   `SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = 'public.cockpit_request_types_read()'::regprocedure;`
   gives `2f12d9541235919c176db2c0cc400f95` (with `pg_get_functiondef` md5
   `985e749039f893240dad242f967cc59a` and grant
   `{postgres=X/postgres,authenticated=X/postgres}`, read 2026-10-28). Any
   other value: stop, and rebase the file on the live body.
2. Dry run as `BEGIN; <file without its own BEGIN;/COMMIT;> ROLLBACK;` through
   the Composio Supabase connection, then apply it with its migration name
   through `SUPABASE_APPLY_A_MIGRATION` (as section 12 step 3).
3. Read-backs: `prosrc` md5 `130d4b4d67d1e6ee32c9ed55f33c8f21`; the grant
   still `{postgres=X/postgres,authenticated=X/postgres}`; one
   `cockpit_request_types_read` in `pg_proc`;
   `supabase_migrations.schema_migrations` names
   `20261028a_request_types_read_routes`; a seat's types read gives Low
   schedule rate's two parts a `when` on `schedule_rate_issue` and General tech
   request's part its `sop_steps` as `steps` (five, read 2026-10-28).
4. The five apps then ship as section 12 steps 7 and 9 say. Read-back: a
   seat's form shows the routing marks of Low schedule rate and Create an ad
   account.

Rollback: run 20261026r's types read definition again (its lines 1742 to
1767; `CREATE OR REPLACE` keeps the grant), then `NOTIFY pgrst, 'reload
schema'`. Nothing to re-run; the form falls back as N5 says.
