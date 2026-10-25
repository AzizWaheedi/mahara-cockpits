# Stage 1 build contract: notices, the Blueprint close and drain, the screens

Binding for the five Stage 1 builders (db-notices, db-blueprint, notices-fn,
screens, workers-docs). Written 2026-10-25 in worktree `forms-1025` (branch
`forms-1025` from origin/main `d2c9817c`) from `docs/forms/PLAN.md` (sections
0, 1, 4.5, 4.7, 4.8) and the maps. Every table, column, function and file named
here was checked against the repo and, read only, against the live database on
2026-10-25 (section 10 lists what was found). Where this contract and the plan
differ, this contract wins; each difference is listed in section 11 with its
reason.

How to use it:

- Build only the files your role owns (section 8). If you need a change in a
  file you do not own, stop and report it; do not edit it.
- The interfaces between roles are the SQL function signatures and JSON shapes
  in sections 2 and 3, the HTTP bodies in section 4, and the result keys in
  section 5. Build to them exactly, even where you would design it differently.
  If one is impossible, stop and report.
- Nothing is deployed in this run: no migration apply, no function deploy, no
  `scripts/ship.sh`, no Vercel, no VPS, no Slack, ClickUp, Make, Typeform or
  GoHighLevel call, no git commit, push, reset, stash or branch change. Supabase
  reads only, through `~/.cache/mahara-ship/pybin/python ~/.cache/mahara-ship/sq.py "<select>"`.
  Never print a secret.

Global rules every role checks (repo `CLAUDE.md`, plan 4.5):

- Tables: row security on; `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`;
  then grant `service_role` exactly what this contract says, in the same file.
- Functions: `SECURITY DEFINER SET search_path = ''`, every name schema-qualified,
  the gate first, then `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated, service_role`
  and exactly the grant named here.
- One `public.cockpit_audit_log` row per write, by the function or by a trigger
  (columns: `action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata`).
- Migrations: `BEGIN; ... NOTIFY pgrst, 'reload schema'; COMMIT;`, apply twice
  without error (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`,
  `ON CONFLICT DO NOTHING`, constraints added inside a `DO` block that checks `pg_constraint`).
- pg_cron, pg_net and vault calls sit only in guarded blocks
  (`to_regclass('cron.job')`, `to_regclass('vault.decrypted_secrets')`, a `pg_proc`
  check for `net.http_post`), the `cockpit_hours_watch_kick` pattern of
  `20261013d_cockpit_hours_watch.sql:1180-1218`, so PGlite applies the files.
- Missing is never zero: every empty or failed state says what it is and what to do.
- Copy: plain, active, sentence case, no exclamation marks, no em dashes,
  Kuwait time. Staff are named by role in everything the team sees (a Slack
  mention is a tag, not a name in text).
- Every external call goes through a `tools.ts` helper that writes an intent
  row before and a response or unknown row after (section 4.5).

Before anything runs: the worktree has no `node_modules`. The orchestrator runs
`scripts/prepare-worktree.sh --apply` once, before the builders start. Builders
do not run `bun install`.

---

## 1. The two migrations

Applied in this order. Neither depends on the other; both apply on top of
production as it is today, and both apply twice.

| Order | File | Owner | Holds |
|---|---|---|---|
| 1 | `supabase/migrations/20261025n_slack_notices.sql` | db-notices | The Slack outbox `cockpit_slack_notices`, its settings, channel list and editors (D17), the editor gate, the queue triggers on `cockpit_client_onboarding` and `cockpit_creative_outbox`, the sweep, the seed, the claim, result, read and settings RPCs, the `mahara-slack-notices` cron job |
| 2 | `supabase/migrations/20261025o_blueprint_close_drain.sql` | db-blueprint | `attempts` on `cockpit_creative_outbox`, the outbox audit with `source_system`, `cockpit_blueprint_settings_set` without the `slack` and `make` routes, `cockpit_blueprint_sources` with `blueprintCall`, `cockpit_blueprint_json` with `attempts`, the drain RPCs, the `mahara-creative-drain` cron job |

The names are new: no `cockpit_slack_*`, `cockpit_forms_*` table or function and
no `20261025*` migration exists in the repo, in any other worktree, or in
`supabase_migrations.schema_migrations` today.

Vault secrets and function secrets are never in a migration. The main session
creates them later (section 4.7). Until they exist, each kick function records
"missing" in `public.cockpit_sync_state` and posts nothing.

---

## 2. DDL and functions

### 2.1 Migration 1: `20261025n_slack_notices.sql` (db-notices)

#### Tables

**`public.cockpit_slack_channels`**: the channels a notice may use (replaces the
plan's CHECK allow-list).

| Column | Type | Rule |
|---|---|---|
| `id` | `text PRIMARY KEY` | `CHECK (id ~ '^[CG][A-Z0-9]{8,12}$')` |
| `name` | `text` | without `#`; `CHECK (name IS NULL OR (char_length(name) BETWEEN 1 AND 80 AND name !~ '[<>&#\s]'))` |
| `private` | `boolean` | null until checked |
| `state` | `text NOT NULL DEFAULT 'checking'` | `CHECK (state IN ('checking','ok','refused','removed'))` |
| `note` | `text` | `CHECK (note IS NULL OR char_length(note) <= 240)`; the plain sentence of the last check |
| `checked_at` | `timestamptz` | |
| `added_by` | `text NOT NULL` | `CHECK (btrim(added_by) <> '')`; an email or `migration` |
| `added_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Seed (`ON CONFLICT (id) DO NOTHING`):
`('C09RZ0GS0V9','csm-general',true,'ok','Seeded: mahara-club-bot was a member on 2026-10-25.',now(),'migration')`,
`('C0AE8G5MT7Y','media-general',true,'ok','Seeded: mahara-club-bot was a member on 2026-10-25.',now(),'migration')`.

**`public.cockpit_slack_notice_settings`**: one row per notice kind and per
kickoff variant (D17, plan 4.8). `on` is a reserved word in Postgres, so the
column is `enabled`; the JSON key the browser sees is `on`.

| Column | Type | Rule |
|---|---|---|
| `kind` | `text PRIMARY KEY` | `CHECK (kind IN ('kickoff','kickoff.late','kickoff.second','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer'))` |
| `enabled` | `boolean NOT NULL DEFAULT true` | |
| `channel` | `text REFERENCES public.cockpit_slack_channels(id)` | |
| `mention_rule` | `text[] NOT NULL DEFAULT '{}'` | the seats to tag; `CHECK (mention_rule <@ ARRAY['seat:creative','seat:csm','seat:systems_manager']::text[])`. Plan 4.8's `people` is "`mention_people` not empty", its `none` is both empty |
| `mention_people` | `bigint[] NOT NULL DEFAULT '{}'` | `public.cockpit_people.id`s, resolved to Slack at send time; `CHECK (cardinality(mention_people) <= 10)` |
| `updated_by` | `text NOT NULL` | `CHECK (btrim(updated_by) <> '')` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Table CHECKs:
`CHECK ((kind IN ('kickoff','blueprint.close','blueprint.media')) = (channel IS NOT NULL))`
(only the three top-level kinds name a channel; replies post in their parent's
thread and channel; the two variant rows post where the kickoff posts) and
`CHECK (kind NOT IN ('kickoff.late','kickoff.second') OR enabled)` (the variant
rows only choose tags).

Shapes, used by every function below and by the screens (`cockpit_slack_notice_shape(kind)`):
`post` = `kickoff`, `blueprint.close`, `blueprint.media`; `reply` =
`kickoff.updated`, `blueprint.updated`, `blueprint.offer`; `variant` =
`kickoff.late`, `kickoff.second`.

Seed (`updated_by = 'migration'`, `ON CONFLICT (kind) DO NOTHING`):

| kind | enabled | channel | mention_rule |
|---|---|---|---|
| `kickoff` | true | `C09RZ0GS0V9` | `{seat:creative}` |
| `kickoff.late` | true | null | `{seat:csm,seat:systems_manager}` |
| `kickoff.second` | true | null | `{seat:csm}` |
| `kickoff.updated` | true | null | `{}` |
| `blueprint.close` | true | `C09RZ0GS0V9` | `{seat:csm}` |
| `blueprint.updated` | true | null | `{}` |
| `blueprint.media` | true | `C0AE8G5MT7Y` | `{}` |
| `blueprint.offer` | true | null | `{}` |

**`public.cockpit_forms_editors`**: the seats the CEO or an admin has given the
editing right (section 11, decision X1).

| Column | Type | Rule |
|---|---|---|
| `member_id` | `uuid PRIMARY KEY REFERENCES public.cockpit_members(id) ON DELETE CASCADE` | |
| `added_by` | `text NOT NULL` | `CHECK (btrim(added_by) <> '')` |
| `added_at` | `timestamptz NOT NULL DEFAULT now()` | |

**`public.cockpit_slack_notices`**: the outbox (plan 1.3, SL 5.1).

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | the marker is `Ref CN-` + `left(id::text, 8)` |
| `kind` | `text NOT NULL` | `CHECK (kind IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','rehearsal'))` |
| `dedupe_key` | `text NOT NULL UNIQUE` | `CHECK (char_length(dedupe_key) BETWEEN 3 AND 200)` |
| `task_id` | `text` | `CHECK (task_id IS NULL OR task_id ~ '^[A-Za-z0-9_-]{1,40}$')` |
| `client_name` | `text` | |
| `parent_id` | `uuid REFERENCES public.cockpit_slack_notices(id)` | |
| `facts` | `jsonb NOT NULL DEFAULT '{}'` | `CHECK (jsonb_typeof(facts) = 'object' AND octet_length(facts::text) <= 16384)`; section 3 |
| `variant` | `text` | `CHECK (variant IS NULL OR variant ~ '^[a-z_]{1,20}$')`; set when sent |
| `target` | `text` | the requested id; `CHECK (target IS NULL OR target ~ '^[CGUW][A-Z0-9]{8,12}$')` |
| `channel` | `text` | the id Slack returned; `CHECK (channel IS NULL OR channel ~ '^[CGD][A-Z0-9]{8,12}$')` |
| `text` | `text` | `CHECK (text IS NULL OR char_length(text) <= 4000)`; kept for the audit |
| `blocks` | `jsonb` | `CHECK (blocks IS NULL OR jsonb_typeof(blocks) = 'array')` |
| `state` | `text NOT NULL DEFAULT 'queued'` | `CHECK (state IN ('queued','sending','posted','failed','unknown','skipped','muted'))` |
| `attempts` | `integer NOT NULL DEFAULT 0` | `CHECK (attempts BETWEEN 0 AND 3)`; counted retries only (outcome `retry`) |
| `next_attempt_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `claimed_at` | `timestamptz` | last claim |
| `finished_at` | `timestamptz` | |
| `checked_at` | `timestamptz` | last reconcile look at an `unknown` |
| `slack_ts` | `text` | `CHECK (slack_ts IS NULL OR slack_ts ~ '^[0-9]+\.[0-9]+$')` |
| `permalink` | `text` | `CHECK (permalink IS NULL OR permalink ~ '^https://[a-z0-9.-]+\.slack\.com/')` |
| `error` | `text` | `CHECK (error IS NULL OR char_length(error) <= 240)`; a plain sentence |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Table CHECKs: `CHECK (state <> 'posted' OR (slack_ts IS NOT NULL AND channel IS NOT NULL))`,
`CHECK (kind = 'rehearsal' OR task_id IS NOT NULL)`,
`CHECK (kind <> 'rehearsal' OR target IS NULL OR target ~ '^[UW]')` (a rehearsal
never targets a channel).

Indexes (`IF NOT EXISTS`):
`cockpit_slack_notices_due ON (next_attempt_at) WHERE state = 'queued'`;
`cockpit_slack_notices_task ON (task_id, created_at DESC)`;
`cockpit_slack_notices_open ON (state, created_at) WHERE state IN ('queued','sending','unknown')`;
`cockpit_slack_notices_parent ON (parent_id) WHERE parent_id IS NOT NULL`.

Grants for all four tables: RLS on, `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`,
then `GRANT SELECT ON` all four `TO service_role` (the guardian reads; every
write goes through the definer functions). No policies.

#### Triggers

| Trigger | On | Function | What it does |
|---|---|---|---|
| `cockpit_slack_notices_guard` | `BEFORE INSERT OR UPDATE ON cockpit_slack_notices` | `cockpit_slack_notice_guard()` | INSERT: state must be `queued` or `skipped`. UPDATE: `kind`, `dedupe_key`, `task_id`, `parent_id`, `created_at` never change; a set `slack_ts` never changes; sets `updated_at = now()`; state moves (below). On INSERT, and on an UPDATE that changes `target`: a non-null `target` on a non-rehearsal row must be a `cockpit_slack_channels` row in state `ok`, unless the row is a reply whose target equals its parent's returned `channel` (an unchanged target is never re-checked, so removing a channel never blocks recording a post) |
| `cockpit_slack_notices_no_delete` | `BEFORE DELETE ON cockpit_slack_notices`, and `BEFORE TRUNCATE` (statement) | `cockpit_slack_notice_refuse_delete()` | raises `A notice is never deleted` (55000) |
| `cockpit_slack_notices_audit` | `AFTER INSERT OR UPDATE OF state ON cockpit_slack_notices` | `cockpit_slack_notice_audit()` | one audit row per insert and per state change (not when only `checked_at` moves) |
| `cockpit_slack_notice_settings_audit` | `AFTER INSERT OR UPDATE ON cockpit_slack_notice_settings` | `cockpit_slack_notice_audit()` | old and new row |
| `cockpit_slack_notice_settings_no_delete` | `BEFORE DELETE OR TRUNCATE` | `cockpit_slack_notice_refuse_delete()` | |
| `cockpit_slack_channels_audit` | `AFTER INSERT OR UPDATE ON cockpit_slack_channels` | `cockpit_slack_notice_audit()` | |
| `cockpit_slack_channels_no_delete` | `BEFORE DELETE OR TRUNCATE` | `cockpit_slack_notice_refuse_delete()` | a channel is marked `removed`, never deleted |
| `cockpit_forms_editors_audit` | `AFTER INSERT OR DELETE ON cockpit_forms_editors` | `cockpit_slack_notice_audit()` | |
| `cockpit_slack_notice_kickoff` | `AFTER INSERT OR UPDATE ON public.cockpit_client_onboarding FOR EACH ROW WHEN ((NEW.forms ? 'kickoff') OR (NEW.forms ? 'blueprint'))` | `cockpit_slack_notice_from_onboarding()` | section "Queue triggers" |
| `cockpit_slack_notice_blueprint` | `AFTER UPDATE OF state ON public.cockpit_creative_outbox FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.kind IN ('blueprintClose','blueprintOffer'))` | `cockpit_slack_notice_from_outbox()` | section "Queue triggers" |

State moves the guard allows (any other raises `A notice goes from % to % only through the sender` 55000):

| From | To | When |
|---|---|---|
| `queued` | `sending`, `skipped`, `muted` | the claim |
| `sending` | `queued` | outcome `requeue` or `retry` |
| `sending` | `posted`, `failed`, `unknown` | outcome, or the sweep (`unknown`) |
| `unknown` | `posted` | reconcile |
| `unknown` | `failed` | only while `current_setting('cockpit.notice_fix', true) = 'on'` (the runbook's fix RPC) |
| `failed` | `queued` | only while `current_setting('cockpit.notice_fix', true) = 'on'` |
| same | same | allowed (no state change) |

The audit function `cockpit_slack_notice_audit() RETURNS trigger` (one for all four tables):

- `action`: `coalesce(nullif(current_setting('cockpit.notice_action', true), ''), default)`;
  defaults: notices `'slack_notice.' || NEW.state`, settings `'slack_notice.setting'`,
  channels `'slack_notice.channel'`, editors `'forms.editor_added'` / `'forms.editor_removed'`.
- `entity_type` `TG_TABLE_NAME`; `entity_id` the row's `id`, `kind` or `member_id`.
- `actor_email` the email of `auth.uid()` from `auth.users`, else `session_user`.
- `source_app` `'client-success'`; `source_system`
  `coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase')`.
- `before`/`after`: notices: `{state, attempts, variant, target, channel, slack_ts, error}` only
  (never `text`, `blocks` or `facts`); the other tables: `to_jsonb(OLD)` / `to_jsonb(NEW)`.
- `metadata`: notices `{kind, task_id, dedupe_key, op}`; others `{op}`.

Every service RPC below that writes does `PERFORM set_config('cockpit.audit_source', 'cron', true)` first.

#### Internal functions (no grant to any role)

| Signature | Returns | Job |
|---|---|---|
| `cockpit_slack_notice_ts(p text)` | `timestamptz` STABLE | safe cast; NULL when empty or not a time |
| `cockpit_slack_notice_card_done(p_status text, p_card_updated timestamptz, p_since timestamptz)` | `boolean` IMMUTABLE | "the card looks done": the stage pattern (below the table) on `coalesce(p_status, '')` with `~*`, AND `p_card_updated IS NOT NULL AND p_since IS NOT NULL AND p_card_updated >= p_since`; a test pins the pattern (section 9) |
| `cockpit_slack_notice_shape(p_kind text)` | `text` IMMUTABLE | `post` / `reply` / `variant` / `test` (rehearsal) |
| `cockpit_slack_notice_role_of(p_email text)` | `text` STABLE | the role label of a seat: founder address (`aziz@maharamedia.com`, `awaheedi2008@gmail.com`) `the CEO`; active `cockpit_people.role = 'Systems manager'` `the systems manager`; member roles `csm` `the CSM`, `creative` `the creative director`, `media_buyer` `the media buyer`, `editor` `the video editor`, `admin` `an admin`; else `a team member`; NULL for NULL |
| `cockpit_slack_notice_mentions(p_rules text[], p_people bigint[], p_client text)` | `jsonb` STABLE | array of `Mention` rows (section 3.9), resolved now: seat rules from `cockpit_members` (active, confirmed, not `admin`, the role in `roles`, `cardinality(clients) = 0` or the client in `clients` by `lower(btrim())`), joined to active `cockpit_people` by `lower(btrim(email))`, then `cockpit_eod_radar_slack_ids` with `state = 'ok'`; `seat:systems_manager` from active `cockpit_people` with `role = 'Systems manager'`; `p_people` from active `cockpit_people` by id. A rule that finds nobody gives one `{rule, missing: true}` entry. Deduped by person (or email when no person row) |
| `cockpit_slack_notice_queue(p_kind text, p_dedupe text, p_task text, p_client text, p_facts jsonb, p_parent uuid, p_state text, p_error text)` | `uuid` | `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`; `skipped` rows get `finished_at = now()` and `p_error`; NULL when it existed |
| `cockpit_slack_notice_kickoff_facts(p_task text, p_client text, p_forms jsonb, p_old_response text)` | `jsonb` STABLE | the `kickoff` facts of section 3.1 |
| `cockpit_slack_notice_close_facts(p_row public.cockpit_creative_outbox)` | `jsonb` STABLE | 3.3 |
| `cockpit_slack_notice_offer_facts(p_row public.cockpit_creative_outbox)` | `jsonb` STABLE | 3.6 |
| `cockpit_slack_notice_live(p_row public.cockpit_slack_notices)` | `jsonb` STABLE | the `live` object of 3.8, read now |
| `cockpit_slack_notice_view(p_row public.cockpit_slack_notices)` | `jsonb` STABLE | one notice as a browser sees it (`NoticeView`, section 2.1 read) |
| `cockpit_slack_notice_from_onboarding()` | `trigger` | queue trigger, below |
| `cockpit_slack_notice_from_outbox()` | `trigger` | queue trigger, below |
| `cockpit_slack_notice_guard()`, `cockpit_slack_notice_refuse_delete()`, `cockpit_slack_notice_audit()` | `trigger` | above |
| `cockpit_forms_editor_gate()` | `jsonb` STABLE | the editor gate, below |
| `cockpit_slack_notice_viewer()` | `jsonb` STABLE | `cockpit_forms_editor_gate()` passes, or `cockpit_has_role('csm')` or `cockpit_has_role('creative')`; returns `{"edit": bool, "editors": bool}` (`editors` = `cockpit_is_ceo() OR cockpit_has_role('admin')`); else raises `Current confirmed client-success or creative access is required` (42501) |
| `cockpit_slack_notices_kick()` | `bigint` | pg_cron's caller, below |

**The stage pattern** used by `cockpit_slack_notice_card_done`, in the SQL as
the string literal below (with `~*`, so case-insensitive). It is byte for byte
the source of `BLUEPRINT_ON` in `apps/client-success-cockpit/src/forms/formStatus.ts:33-34`
(flag `i`): "contains" for the first three stages, anchored only for Active.

```text
brand blueprint booked|launch booked|ready for launch|^\s*active\s*$
```

In every table of this contract, `\|` inside a cell stands for a plain `|`
(Markdown needs the escape); write a plain `|` in code.

**The editor gate** `cockpit_forms_editor_gate() RETURNS jsonb`:

1. The caller's member row: active, `auth_user_id = auth.uid()`, `email_confirmed_at IS NOT NULL`, `email = lower(btrim(auth email))`. None: raise.
2. `who`: `ceo` when `public.cockpit_is_ceo()`; else `admin` when `'admin' = ANY(roles)`; else `forms_editor` when `'forms_editor' = ANY(roles)` or a `cockpit_forms_editors` row has this `member_id`; else raise `Only the CEO, an admin or someone they add can change notices and routing.` (42501).
3. Returns `{"actorId": uuid, "memberId": uuid, "email": text, "who": "ceo"|"admin"|"forms_editor", "label": text}` (`label` = `cockpit_slack_notice_role_of(email)`).

`cockpit_has_role(r)` is true for every admin seat (live definition), so the
gate never calls `cockpit_has_role('forms_editor')`; it reads `roles` itself.

#### Queue triggers

`cockpit_slack_notice_from_onboarding()` (AFTER INSERT OR UPDATE on
`cockpit_client_onboarding`). The whole body is inside
`BEGIN ... EXCEPTION WHEN OTHERS THEN ... END`; on an error it upserts
`cockpit_sync_state` key `slack-notices-queue` (`ok = false`, `note` = `left(SQLERRM, 240)`,
`last_run_at = now()`) and returns NULL. It never raises: it runs inside
`cockpit_csm_onboarding_cron_publish` (SL F3a).

1. Kickoff. `v_rid := NEW.forms->'kickoff'->>'response_id'`. When `v_rid` is
   non-empty and (`TG_OP = 'INSERT'` or `OLD.forms->'kickoff'->>'response_id' IS DISTINCT FROM v_rid`):
   `v_sub := cockpit_slack_notice_ts(NEW.forms->'kickoff'->>'submitted_at')`;
   facts from `cockpit_slack_notice_kickoff_facts(NEW.clickup_task_id, NEW.client_name, NEW.forms, OLD.forms->'kickoff'->>'response_id' when UPDATE)`;
   state and error:
   - `v_sub` NULL: `skipped`, `The kickoff has no readable submit time, so it was not posted.`
   - `v_sub <= now() - interval '48 hours'`: `skipped`, `This kickoff was more than 48 hours old when the mirror listed it, so it was not posted.`
   - else `queued`.
   `cockpit_slack_notice_queue('kickoff', 'kickoff:' || v_rid, NEW.clickup_task_id, NEW.client_name, facts, NULL, state, error)`.
2. Typeform Blueprint (until A1 removes it). `v_bid := NEW.forms->'blueprint'->>'response_id'`, new by the same INSERT or IS DISTINCT FROM OLD test, and
   `cockpit_slack_notice_ts(NEW.forms->'blueprint'->>'submitted_at') > now() - interval '48 hours'`:
   queue `blueprint.close`, key `'blueprint:' || NEW.clickup_task_id || ':close'`,
   facts 3.3 with `source = 'typeform'`. Older: nothing at all (no row, so an
   old Typeform record never blocks a native close notice with the same key).

`cockpit_slack_notice_from_outbox()` (AFTER UPDATE OF state on
`cockpit_creative_outbox`). Same never-raise wrapper, key `slack-notices-queue`.
`v_close := 'blueprint:' || NEW.task_id || ':close'`.

| Move | Queues |
|---|---|
| `blueprintClose`: `sending` to `done` or `reconcile` | `blueprint.close` (key `v_close`, facts 3.3 with `settled` = NEW.state) and `blueprint.media` (key `'blueprint:' \|\| task \|\| ':media'`, facts 3.4). Both `ON CONFLICT DO NOTHING`, so only the first close posts |
| `blueprintClose`: `reconcile` to `done` | `blueprint.updated` (key `'blueprint:' \|\| task \|\| ':updated'`, `parent_id` = the `v_close` row's id, facts 3.5) |
| `blueprintClose`: `sending` to `done`, when the `v_close` row exists with `facts->>'settled' = 'reconcile'` | `blueprint.updated`, the same key (a later press confirmed the card) |
| `blueprintOffer`: `sending` to `done` | `blueprint.offer` (key `'blueprint:' \|\| task \|\| ':offer'`, `parent_id` = the `v_close` row's id or NULL, facts 3.6) |

#### The seed (end of the migration, after the triggers exist)

```sql
SELECT public.cockpit_slack_notice_queue('kickoff', 'kickoff:' || (o.forms->'kickoff'->>'response_id'),
  o.clickup_task_id, o.client_name,
  public.cockpit_slack_notice_kickoff_facts(o.clickup_task_id, o.client_name, o.forms, NULL),
  NULL, 'skipped', 'This kickoff was more than 48 hours old when the notices began, so it was not posted.')
FROM public.cockpit_client_onboarding o
WHERE nullif(o.forms->'kickoff'->>'response_id', '') IS NOT NULL
  AND coalesce(public.cockpit_slack_notice_ts(o.forms->'kickoff'->>'submitted_at'), '-infinity') <= now() - interval '48 hours';
```

Kickoffs newer than 48 hours at apply time are not seeded; the sweep queues
them (there are 0 today). No Blueprint row is seeded.

#### Service RPCs (`GRANT EXECUTE ... TO service_role` only)

All return `jsonb` unless said. All write `cockpit.audit_source = 'cron'` first.

**`cockpit_slack_notice_sweep()`** returns `{"unknown": int, "kickoffs": int, "closes": int, "media": int, "offers": int, "followups": int}`:

1. `sending` with `claimed_at < now() - interval '10 minutes'` becomes `unknown`, error
   `The sender stopped while posting. Look in Slack for this notice's Ref before anything else.`
2. Missed kickoffs: onboarding rows whose kickoff `response_id` has no `kickoff:` row and whose `submitted_at` is within 48 hours: queued as in the trigger; `second` from `cockpit_csm_form_sends.second`, or true when another `kickoff` notice exists for the same `task_id` with a different `facts->>'responseId'`.
3. Missed closes: `cockpit_creative_outbox` `kind = 'blueprintClose'`, `state IN ('done','reconcile')`, `coalesce(settled_at, created_at) > now() - interval '48 hours'`: insert the close and the media rows when their keys are absent (the trigger's facts).
4. Missed offers: `kind = 'blueprintOffer'`, `state = 'done'`, `settled_at` within 48 hours, no offer key.
5. Missed `blueprint.updated`: a close notice with `facts->>'settled' = 'reconcile'` whose task has a `blueprintClose` outbox row in `done` settled after the notice's `created_at`.
6. `kickoff.updated`: a `kickoff` notice with `variant = 'late'`, `state = 'posted'`, `created_at` within 48 hours, no `kickoff:{rid}:updated` row, whose onboarding row now passes `cockpit_slack_notice_card_done(client_status, card_updated_at, submittedAt)`: queue key `'kickoff:' || rid || ':updated'`, `parent_id` the late notice, facts 3.2.
7. Typeform Blueprint records within 48 hours with no close key: queue as the trigger does.

**`cockpit_slack_notice_claim(p_limit integer, p_only uuid DEFAULT NULL)`** returns `{"busy": boolean, "rows": ClaimedRow[]}`:

```
IF NOT pg_try_advisory_xact_lock(hashtextextended('cockpit_slack_notices', 0)) THEN
  RETURN {"busy": true, "rows": []};
v_lim := least(greatest(coalesce(p_limit, 10), 1), 25)
FOR r IN queued rows with next_attempt_at <= now() (and id = p_only when given)
         ORDER BY created_at, id FOR UPDATE SKIP LOCKED:
  EXIT when v_lim rows are claimed
  s := settings row of r.kind (none for rehearsal)
  1. s.enabled false: queued -> muted, finished_at now(), error 'Turned off in Settings, Notices and routing.'; CONTINUE
  2. reply (parent_id set), p := parent:
     p.state in (queued, sending), or unknown claimed under 30 minutes ago: CONTINUE (wait)
     p.state = posted: thread_ts := p.slack_ts; target := p.channel
     p.state in (muted, skipped) and r.kind <> 'blueprint.offer': queued -> skipped,
        error 'Its first notice did not post, so this reply was not sent.'; CONTINUE
     otherwise (failed, old unknown, or an offer whose parent did not post): top level
  3. top-level target: kickoff, blueprint.close, blueprint.media: s.channel;
     kickoff.updated: the `kickoff` settings row's channel; blueprint.updated,
     blueprint.offer: the `blueprint.close` settings row's channel; rehearsal: r.target, else the requester's
     Slack id (facts.requestedBy = an auth uid: member email -> active people ->
     cockpit_eod_radar_slack_ids ok), else NULL with rehearsal.lookupEmail = that email.
     A rehearsal with neither: queued -> sending -> failed,
     'No Slack account was found for you. Ask the tech lead to add your address to the team list.'
  4. kickoff due rule: v_sub := facts.submittedAt; claim only when
     cockpit_slack_notice_card_done(onboarding.client_status, onboarding.card_updated_at, v_sub)
     or now() >= v_sub + interval '20 minutes'; else CONTINUE (stays queued, nothing written)
  5. non-rehearsal top-level target not an `ok` channel: queued -> sending -> failed
     (the target is not written, so the guard does not refuse the move),
     format('The channel for this notice is not ready (%s). Choose one in Settings, Notices and routing.', coalesce(target, 'none')); CONTINUE
  6. queued -> sending, claimed_at now(), target := the target above (attempts unchanged)
  7. append ClaimedRow
RETURN {"busy": false, "rows": [...]}
```

`ClaimedRow`:

```json
{
  "id": "uuid", "ref": "CN-1a2b3c4d", "kind": "kickoff", "taskId": "z8xmdvj7hm",
  "clientName": "text", "attempts": 0, "createdAt": "timestamptz",
  "facts": {},                          // the stored facts (section 3)
  "live": {},                           // read now (section 3.8)
  "target": "C09RZ0GS0V9 | U... | null",
  "threadTs": "1792872070.187739 | null",
  "parentId": "uuid | null",
  "mentions": {"main": [], "late": [], "second": []},   // Mention[] each; late and second only for kickoff
  "rehearsal": {"of": "kickoff", "lookupEmail": "text | null"} // only for kind rehearsal
}
```

Mentions come from `cockpit_slack_notice_mentions(settings.mention_rule, settings.mention_people, client_name)`:
`main` from the row's own kind; for `kickoff`, `late` from `kickoff.late` and
`second` from `kickoff.second`. A reply's `main` comes from its own kind.
A rehearsal gets `{"main": []}`.

**`cockpit_slack_notice_result(p_id uuid, p_outcome text, p_ts text, p_channel text, p_error text, p_detail jsonb DEFAULT '{}'::jsonb)`** returns the row's `NoticeView`. Locks the row. `v_err := left(nullif(btrim(p_error), ''), 240)`.

| `p_outcome` | From | Sets |
|---|---|---|
| `posted` | `sending` or `unknown` | needs `p_ts ~ '^[0-9]+\.[0-9]+$'`, `p_channel ~ '^[CGD][A-Z0-9]{8,12}$'` and the channel rule against `target` (C, G or D target: equal; U or W target: a D channel); else raises 22023 `Slack answered for another channel`. `state = 'posted'`, `slack_ts`, `channel`, `finished_at = now()`, `error = NULL`. Repeating it with the same `slack_ts` on a posted row returns the view (idempotent) |
| `failed` | `sending` | `v_err` required; `state = 'failed'`, `finished_at` |
| `unknown` | `sending` | `v_err` required; `state = 'unknown'`, `finished_at` |
| `requeue` | `sending` | waiting, not an attempt: `state = 'queued'`, `next_attempt_at = now() + make_interval(secs => greatest(coalesce((p_detail->>'retryAfterSec')::int, 60), 30))`, `error = v_err` |
| `retry` | `sending` | a counted retry (Slack rate limit, or a break before the request left): `attempts + 1`; at 3 `state = 'failed'`, `error = coalesce(v_err, 'It could not be sent after 3 tries.')`, `finished_at`; else `state = 'queued'`, `next_attempt_at = now() + greatest(retryAfterSec, 1) seconds` |
| other | | raises `Choose posted, failed, unknown, requeue or retry` (22023) |

`p_detail` keys, each applied when present: `variant` (text), `text` (text,
4000 max), `blocks` (array), `permalink` (kept only when it matches the column
CHECK), `target` (only for a rehearsal whose `target` is NULL, `^[UW]`),
`facts` (an object merged into `facts`: the send-time keys of section 3),
`retryAfterSec` (int). Any other key is ignored.

**`cockpit_slack_notice_unknowns(p_limit integer)`** returns
`[{id, ref, kind, target, channel, threadTs, oldest}]`: `unknown` rows with
`claimed_at > now() - interval '24 hours'` and `checked_at` NULL or older than
10 minutes, `FOR UPDATE SKIP LOCKED`, at most `least(p_limit, 10)`; sets
`checked_at = now()`. `channel` = the stored `channel`, else `target` when it is
a C or G id, else NULL (cannot be reconciled). `threadTs` = the parent's
`slack_ts` when the row is a reply to a posted parent. `oldest` =
`extract(epoch from claimed_at) - 60` as text.

**`cockpit_slack_channel_pending()`** returns `[{id, name}]`: channels in `checking`, at most 5.

**`cockpit_slack_channel_checked(p_id text, p_ok boolean, p_name text, p_private boolean, p_note text)`** sets `state` (`ok` or `refused`), `name` (when given and valid), `private`, `note`, `checked_at = now()` on a channel not `removed`; returns the channel row as JSON. Used by the sender for `checking` rows and by the doctor for every row.

**`cockpit_slack_notice_inputs(p jsonb)`** (dry run) returns
`{kind, taskId, clientName, ref: 'CN-dryrun00', facts, live, target, threadTs: null, mentions}`:
`p = {"responseId": text}` finds the onboarding row whose kickoff carries it
(else raises `No kickoff with that response ID is in the mirror.`) and builds
kickoff facts; `p = {"kind": text, "taskId": text, "facts": object}` takes the
given facts (an object under 16 KB) for any non-rehearsal kind and adds `live`
and `mentions` for that task. Writes nothing.

**`cockpit_slack_notice_doctor_inputs()`** returns
`{channels: [{id, name, private, state}], settings: [{kind, enabled, channel, mentions: Mention[]}]}`
(channels not `removed`; mentions resolved with `p_client = NULL`, so seats scoped to clients still count).

**`cockpit_slack_notice_rehearse_service(p_kind text, p_target text)`** returns `{id}`: `p_kind` one of the six non-rehearsal kinds (default `kickoff` when NULL), `p_target ~ '^[UW][A-Z0-9]{8,12}$'`; inserts kind `rehearsal`, key `'rehearsal:' || gen_random_uuid()`, `target = p_target`, `task_id NULL`, facts 3.7 with `requestedBy = 'cron'`.

**`cockpit_slack_notice_fix(p_id uuid, p_action text, p_note text)`** returns the `NoticeView`. Runbook only. Sets `cockpit.notice_fix = 'on'` locally. `requeue`: `failed` to `queued`, `attempts = 0`, `next_attempt_at = now()`, `error = NULL`. `not_posted`: `unknown` to `failed`, `error = left('Checked by a person: not in Slack. ' || coalesce(p_note, ''), 240)`. Anything else raises 22023.

#### Browser RPCs (`GRANT EXECUTE ... TO authenticated` only)

**`cockpit_slack_notice_read(p_task_id text)`** returns:

```json
{"taskId": "text", "now": "timestamptz", "notices": [NoticeView]}
```

Gate, first: `p_task_id ~ '^[A-Za-z0-9_-]{1,40}$'` else 22023. Pass when
`cockpit_is_ceo()` or `cockpit_has_role('admin')`; else when
`cockpit_csm_client_gate(p_task_id)` does not raise (inside its own
`BEGIN/EXCEPTION`, keeping its message); else when `cockpit_has_role('creative')`
and `cockpit_client_allowed(v_name)`, `v_name` = the onboarding row's
`client_name`, else the newest notice's `client_name`. Otherwise raise: the
CSM gate's own message when the seat holds `csm`, else
`That client is not on your access list` (42501). Rows: every non-rehearsal
notice with that `task_id`, newest first, at most 20.

`NoticeView` (also used inside the settings read):

```json
{"id": "uuid", "kind": "text", "state": "text", "variant": "text|null",
 "responseId": "text|null", "outboxId": "uuid|null", "parentKind": "text|null",
 "channel": {"id": "text", "name": "text|null"} ,
 "at": "timestamptz", "dueAt": "timestamptz|null", "permalink": "text|null", "reason": "text|null"}
```

- `channel`: the returned `channel`, else `target`, with the name from `cockpit_slack_channels`; NULL when neither.
- `at`: `finished_at` when set, else `claimed_at` when `sending`, else `created_at`.
- `dueAt`: kickoff queued: `facts.submittedAt + 20 minutes`; other queued: `next_attempt_at`; else NULL.
- `reason`: NULL when posted; queued kickoff: `error` when set, else `Waiting for Make to update the card.`; queued reply: `Waiting for its first notice.`; other queued: `Queued.`; sending: `Posting now.`; failed, unknown, skipped, muted: `error`.
- Never `text`, `blocks`, `facts` (other than `responseId` and `outboxId`) or `target` of a rehearsal.

**`cockpit_slack_notice_settings_read()`** returns (`SettingsRead`):

```json
{
  "can": {"edit": false, "editors": false},
  "notices": [{
    "kind": "kickoff", "shape": "post|reply|variant", "on": true, "fixedOn": false,
    "channel": {"id": "C09RZ0GS0V9", "name": "csm-general"},
    "mentionRule": ["seat:creative"],
    "mentionPeople": [{"id": 12, "label": "Noura, Media buyer", "slackKnown": true}],
    "tags": [{"rule": "seat:creative", "found": true, "slackKnown": true}],
    "updatedBy": "the systems manager", "updatedAt": "timestamptz",
    "last": NoticeView | null
  }],
  "channels": [{"id": "text", "name": "text|null", "private": true, "state": "ok", "note": "text|null", "checkedAt": "timestamptz|null", "inUse": true}],
  "people": [{"id": 12, "label": "Noura, Media buyer"}],
  "editors": [{"memberId": "uuid", "label": "text"}],
  "members": [{"memberId": "uuid", "label": "text"}],
  "test": {"id": "uuid", "kind": "kickoff", "state": "posted", "at": "timestamptz", "reason": "text|null"} ,
  "now": "timestamptz"
}
```

Gate first: `cockpit_slack_notice_viewer()`. `notices` in the seed order of the
table above. `fixedOn` true for the two variant rows. `channel` NULL for reply
and variant rows. `tags`: one per rule, `found` = the rule resolves to at least
one person or seat now, `slackKnown` = at least one has an `ok` Slack id.
`last`: the newest notice of that kind. `people` (active `cockpit_people` with
an email, `label` = first name and role) only when `can.edit`, else `[]`.
`editors` (the CEO and admin seats are implied and not listed; the
`cockpit_forms_editors` rows, `label` = first name and role) and `members`
(active seats that are not admin, `label` = first name and role) only when
`can.editors`, else `[]`. `test`: the caller's newest rehearsal of the last
hour, else NULL. `updatedBy` is a role label (`cockpit_slack_notice_role_of`), or
`the migration`.

**`cockpit_slack_notice_settings_set(p_kind text, p_patch jsonb)`** returns `SettingsRead`. Gate first: `cockpit_forms_editor_gate()`.

| Patch key | Type | Rule, with the refusal sentence (22023 unless said) |
|---|---|---|
| `on` | boolean | variant rows: `This one is part of the kickoff notice and stays on. Turn the kickoff notice off instead.` |
| `channel` | text | post rows only (`Replies post in their first notice's thread.`); must be an `ok` channel: `Add that channel under Channels first; the cockpit checks the bot is in it.` |
| `mentionRule` | text[] | a subset of the three seat rules, deduped: `Choose who to tag from the list.` |
| `mentionPeople` | bigint[] | at most 10, each an active `cockpit_people` row with an email: `Choose people from the team list.` |

Unknown kind: `There is no notice called {kind}.`; unknown patch key:
`Unknown setting: {key}.`; patch not an object: `Send the changes as an object.`
No change: returns the read without writing. A change: `UPDATE` with
`updated_by` = the gate's email, `updated_at = now()`, action `slack_notice.setting`
(the audit trigger records old and new).

**`cockpit_slack_channel_add(p_channel text, p_name text)`** returns `SettingsRead`. Editor gate. `p_channel` (trimmed, upper case) `~ '^[CG][A-Z0-9]{8,12}$'` else `Paste the channel's ID from Slack (it starts with C or G).`; `p_name` optional (without `#`). Already `ok`: `That channel is already on the list.`; new, `refused` or `removed`: upsert to `checking`, `note = 'Checking that mahara-club-bot is in it.'`, `added_by` = the gate's email. The sender checks it within a minute.

**`cockpit_slack_channel_remove(p_channel text)`** returns `SettingsRead`. Editor gate. In use by a settings row: `The {kind} notice posts there. Choose another channel for it first.`; else `state = 'removed'`.

**`cockpit_slack_notice_rehearse(p_kind text)`** returns `{"id": "uuid", "state": "queued", "note": "Your test reaches your Slack direct messages within a minute."}`. Editor gate. `p_kind` one of the six non-rehearsal kinds. Refuses when the caller has a `queued` or `sending` rehearsal (`A test is already on its way. Wait for it, then send another.`) or five in the last hour (`That is five tests in an hour. Try again later.`). Inserts kind `rehearsal`, key `'rehearsal:' || gen_random_uuid()`, `target NULL`, facts 3.7 with `requestedBy = auth.uid()::text`.

**`cockpit_forms_editor_set(p_member_id uuid, p_on boolean)`** returns `SettingsRead`. Gate: `cockpit_is_ceo() OR cockpit_has_role('admin')`, else `Only the CEO or an admin chooses who changes notices and routing.` (42501). The member must be active (`Choose an active seat.`). `p_on` true inserts (`ON CONFLICT DO NOTHING`), false deletes.

#### The cron job

`cockpit_slack_notices_kick() RETURNS bigint` (no grant; pg_cron runs it as owner):

1. `PERFORM public.cockpit_slack_notice_sweep();`
2. Work exists when any of: a `queued` row with `next_attempt_at <= now()`; an
   `unknown` row the unknowns RPC would hand out; a channel in `checking`. No
   work: upsert `cockpit_sync_state` key `slack-notices-kick` (`ok = true`,
   `note = 'Nothing to send'`) and return NULL.
3. Vault, only inside `to_regclass('vault.decrypted_secrets') IS NOT NULL`:
   `cockpit_notices_cron_secret` (required) and `cockpit_anon_key` (optional).
   No secret: note `The vault has no cockpit_notices_cron_secret, so the Slack notices did not run. Add it to the vault.`, `ok = false`, return NULL. No `net.http_post`: note `pg_net is not installed, so the Slack notices did not run.`.
4. `net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-notices', body := '{"job":"run"}', headers := {"Content-Type": "application/json", "x-cron-secret": secret} plus "Authorization": "Bearer " || anon when the anon key is present, timeout_milliseconds := 5000)`, by `EXECUTE` as in `cockpit_hours_watch_kick`; note `Posted a notices run`, `ok = true`, `last_ok_at = now()`; return the request id.

```sql
DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname=''mahara-slack-notices''';
    EXECUTE $q$SELECT cron.schedule('mahara-slack-notices','* * * * *',$job$SELECT public.cockpit_slack_notices_kick();$job$)$q$;
  END IF;
END $$;
```

### 2.2 Migration 2: `20261025o_blueprint_close_drain.sql` (db-blueprint)

Save `pg_get_functiondef` of every replaced function before the build (done
on 2026-10-25: each live body is identical to `20261024a_brand_blueprints.sql`
and `20260927s_creative_read_models.sql`, so build on the repo text).

1. **Column.** `ALTER TABLE public.cockpit_creative_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;`
   and, in a `DO` block that checks `pg_constraint`, `cockpit_creative_outbox_attempts_check CHECK (attempts BETWEEN 0 AND 3)`.
   Index `cockpit_creative_outbox_pending_bp ON public.cockpit_creative_outbox (created_at) WHERE state = 'pending' AND kind IN ('blueprintLaunch','blueprintClose','blueprintOffer')`.
   Grants on the table are unchanged (`SELECT, INSERT, UPDATE` to `service_role`).
2. **`cockpit_creative_outbox_audit()`** replaced: the same insert as today plus
   `source_system`: `coalesce(nullif(current_setting('cockpit.audit_source', true), ''), CASE WHEN <x-cockpit-source header> = 'cron' THEN 'cron' END)`,
   where the header is read as `nullif(current_setting('request.headers', true), '')::jsonb->>'x-cockpit-source'`
   inside its own `BEGIN/EXCEPTION WHEN OTHERS THEN NULL` (the table is
   service-only, so only the service key can set the header). It never raises.
3. **`cockpit_blueprint_settings_set(p_key text, p_value text, p_label text)`** replaced: the repo body, with the route branch changed to:
   blank `close_route`: `Choose card_only.`; `close_route` other than `card_only`:
   `The close writes the card only. #csm-general and #media-general hear through the notices: Settings, Notices and routing in the client success cockpit.` (22023).
   Every other rule, gate and message unchanged. Then
   `UPDATE public.cockpit_blueprint_settings SET value = 'card_only', updated_at = now(), updated_by = 'migration' WHERE key = 'close_route' AND value <> 'card_only';`
   (a no-op today: the value is `card_only`). `cockpit_blueprint_settings_read` is not replaced; it still returns `closeRoute` and `can.closeRoute`.
4. **`cockpit_blueprint_sources(p_task_id text)`** replaced: the repo body plus one top-level key `blueprintCall`:

   ```json
   "blueprintCall": {"heldAt": "timestamptz|null", "status": "text|null", "stage": "text|null", "mapPhase": "int|null", "nudge": false}
   ```

   - `heldAt`, `status`: the latest `cockpit_csm_calls` row with `task_id = p_task_id`, `kind = 'blueprint'`, `starts_at <= now()`, `status IN ('held','showed','confirmed','booked')`.
   - `stage`: `cockpit_client_onboarding.client_status`; `mapPhase`: `substring(links->>'onboarding_map' from '[?&]phase=([0-9]+)')::int`.
   - `nudge`: `stage ~* '(brand blueprint booked|ready for launch)'` AND `coalesce(mapPhase, 0) <= 4` AND `heldAt IS NOT NULL` AND the card's `cockpit_blueprints.parts` has no `'2'` (or no row).
   On live data this is true for exactly Alalia.co, Makers and Smmim studio. The gate (creative write, CSM read) is unchanged.
5. **`cockpit_blueprint_json(p_row public.cockpit_blueprints)`** replaced: each part's outbox object gains `'attempts', o.attempts`.
6. **`cockpit_creative_outbox_due(p_apply boolean DEFAULT true)`** returns
   `{"apply": bool, "failed": int, "rows": [{"id": uuid, "kind": text, "taskId": text, "clientName": text, "actorId": uuid, "attempts": int, "createdAt": timestamptz}]}`.
   Blueprint kinds only. When `p_apply`: sets `cockpit.audit_source = 'cron'` and moves `pending` rows with `created_at < now() - interval '30 minutes'` to `failed`, `error = 'This press did not finish within 30 minutes. Press again.'`, `settled_at = now()`. Lists `pending` rows with `created_at` between `now() - 30 minutes` and `now() - 2 minutes` and `attempts < 3`, oldest first, at most 5. With `p_apply = false` it writes nothing (`failed` = the count that would fail).
7. **`cockpit_creative_outbox_load_for_actor(p_id uuid)`** returns exactly what `cockpit_creative_client_action('get', {id})` returns: `to_jsonb(row) || jsonb_build_object('sourceTask', <the same sourceTask subquery as get>)`. Refuses a missing or non-Blueprint row (`This press is not a Brand Blueprint press.`, 22023). Calls `public.cockpit_blueprint_gate_for_actor(row.actor_id, row.task_id, true)` first, which raises when the presser lost the creative seat or the client.
8. **`cockpit_creative_outbox_refused(p_id uuid, p_error text)`** returns `{"id": uuid, "state": text, "attempts": int}`. Sets `cockpit.audit_source = 'cron'`. Only from `pending` (else returns the row unchanged): `attempts + 1`, `error = left(p_error, 1000)`; at 3: `state = 'failed'`, `settled_at = now()`.
9. **`cockpit_creative_drain_kick()` RETURNS bigint** (no grant): when no Blueprint row is `pending` with `created_at < now() - 2 minutes`, note `Nothing to drain` and return NULL; else read vault `cockpit_creative_cron_secret` and `cockpit_anon_key` (both required: the function keeps its JWT check, plan 1.7); missing: `cockpit_sync_state` key `creative-drain-kick`, `ok = false`, note naming the missing secret; else `net.http_post` to `https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-creative-api` with body `{"operation":"cron","job":"drain","apply":true}`, headers `Content-Type`, `x-cron-secret`, `Authorization: Bearer <anon>`, `apikey: <anon>`, timeout 5000.
   Cron `mahara-creative-drain`, `'*/2 * * * *'`, `SELECT public.cockpit_creative_drain_kick();`, in the guarded `DO` block of 2.1.
10. **Grants.** Re-assert, after the `CREATE OR REPLACE`s: `cockpit_blueprint_settings_set(text,text,text)` and `cockpit_blueprint_sources(text)` `TO authenticated` only; `cockpit_blueprint_json(cockpit_blueprints)` and `cockpit_creative_outbox_audit()` no grant; the three drain RPCs `TO service_role` only; the kick no grant. Each after `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`.

---

## 3. Notice facts, per kind

`facts` hold names, ids, times and links only. Never answers, prices,
budgets, phone numbers, emails, WhatsApp text or AI summaries (SL 7.4). All
times are ISO 8601 strings. Keys are camelCase. Each key's source is named.

### 3.1 `kickoff` (trigger, sweep; dedupe `kickoff:{responseId}`)

| Key | Type | Source |
|---|---|---|
| `taskId` | text | `cockpit_client_onboarding.clickup_task_id` |
| `client` | text | `cockpit_client_onboarding.client_name` |
| `responseId` | text | `forms->'kickoff'->>'response_id'` |
| `formId` | text or null | `forms->'kickoff'->>'form_id'` (`tG7dnxBn` or `BbJy6xg4`) |
| `submittedAt` | text | `forms->'kickoff'->>'submitted_at'` as stored (`2026-10-20T11:55:11Z`) |
| `second` | boolean | OLD held another response ID, or `cockpit_csm_form_sends.second` for this `response_id` (PK), or (sweep) another kickoff notice on the task |
| `previousResponseId` | text or null | OLD's `response_id` when it differed |

Added at send (`p_detail.facts`): `commentCheck` (`found`, `missing`, `unread`),
`handoffAt` (the Kickoff Handoff comment's time or null), `filledByRole`.

### 3.2 `kickoff.updated` (sweep; dedupe `kickoff:{responseId}:updated`, parent = the late kickoff)

`taskId`, `client`, `responseId` (from the parent), `cardUpdatedAt` (text,
`cockpit_client_onboarding.card_updated_at` at sweep time).

### 3.3 `blueprint.close` (outbox trigger, sweep, Typeform branch; dedupe `blueprint:{taskId}:close`)

| Key | Type | Source |
|---|---|---|
| `taskId`, `client` | text | `cockpit_creative_outbox.task_id`, `.client_name` (Typeform: the onboarding row) |
| `source` | `cockpit` or `typeform` | which path |
| `outboxId` | text or null | `cockpit_creative_outbox.id` (Typeform: null) |
| `responseId` | text or null | Typeform only: `forms->'blueprint'->>'response_id'` |
| `settled` | `done`, `reconcile` or null | the NEW outbox state (Typeform: null) |
| `closedAt` | text | `coalesce(settled_at, now())` (Typeform: `forms->'blueprint'->>'submitted_at'`) |
| `closedByRole` | text or null | `cockpit_slack_notice_role_of(actor_email)` (Typeform: null) |
| `launchTaskId` | text or null | `result->>'launchTaskId'` |
| `mapPhase` | integer or null | `(result->>'mapPhase')::int` (section 5.2) |
| `service` | text or null | `payload->>'service'` (`design-build`, `interior`, `architecture`, `fitout`, `construction`) |

### 3.4 `blueprint.media` (outbox trigger, sweep; dedupe `blueprint:{taskId}:media`)

`taskId`, `client`, `outboxId`, `service`, `launchTaskId`, `mapPhase`: the
same sources as 3.3.

### 3.5 `blueprint.updated` (outbox trigger, sweep; dedupe `blueprint:{taskId}:updated`, parent = the close notice)

`taskId`, `client`, `outboxId` (the row that reached `done`), `confirmedAt`
(its `settled_at`).

### 3.6 `blueprint.offer` (outbox trigger, sweep; dedupe `blueprint:{taskId}:offer`, parent = the close notice or null)

`taskId`, `client`, `outboxId`, `offeredAt` (`settled_at`), `offeredByRole`
(`cockpit_slack_notice_role_of(actor_email)`), `dnaComplete` (boolean,
`payload->>'dna_status' = 'complete'`).

### 3.7 `rehearsal` (rehearse RPCs; dedupe `rehearsal:{uuid}`)

`of` (the kind it rehearses), `variant` (text or null), `sample` (true),
`requestedBy` (`cron` or the requester's auth uid as text, never an email).

### 3.8 `live` (computed by the claim and by the dry-run inputs, never stored)

| Kind | Keys |
|---|---|
| `kickoff` | `clientStatus` (text or null), `cardUpdatedAt` (text or null), `blueprintLink` (boolean: `links ? 'blueprint_form'`), `looksDone` (boolean: `cockpit_slack_notice_card_done`), `filledByRole` (role of the newest `cockpit_csm_form_sends.sent_by_email` for this response, else null = "in Typeform"), `dueBy` (`submittedAt + 20 minutes`) |
| `kickoff.updated` | `clientStatus`, `cardUpdatedAt` |
| `blueprint.close` | `clientStatus`, `launchCallAt` (the next `cockpit_csm_calls` row with `kind = 'launch'`, `starts_at > now()`, `status IN ('booked','confirmed')`, else null) |
| `blueprint.media` | `clientStatus` |
| others | `{}` |

### 3.9 `Mention`

```json
{"rule": "seat:creative|seat:csm|seat:systems_manager|people", "personId": 12, "label": "the creative director",
 "slackId": "U0B2SHGS1JA|null", "email": "text|null", "missing": false}
```

`label` is the role label: `the creative director`, `the CSM`, `the systems
manager`, or for `people` `the ` + lower-case `cockpit_people.role`. `email` is
for the sender's `users.lookupByEmail` fallback only; it never goes into facts,
text, receipts or a browser response. On live data the seat rules resolve to:
creative `U0B2SHGS1JA`, CSM `U0C5JHUCTPG`, systems manager `U0AS90SHMH8`.

---

## 4. The `cockpit-notices` Edge Function (notices-fn)

### 4.1 Files

`supabase/functions/cockpit-notices/`: `index.ts` (Deno.serve of the door,
deps from env), `door.ts`, `run.ts` (one run: sweep, channel checks, reconcile,
claim, send), `send.ts` (one claimed row), `reconcile.ts`, `doctor.ts`,
`mentions.ts`, `text.ts`, `deno.json` (`{"imports":{"zod":"npm:zod@4.1.12"}}`,
the same as `cockpit-csm-api/deno.json`, because it imports that folder's
`tools.ts`), `README.md`, `testkit.ts` (fake Slack, ClickUp and RPC), tests
(section 9). Plus `supabase/functions/_shared/slackReceipt.ts` (import-free).

The database door is `restRpc(url, serviceKey)` from
`supabase/functions/cockpit-hours-sync/db.ts` (its name check `^cockpit_[a-z_]+$`
fits every RPC here). Ledger rows go to `cockpit_csm_provider_health` by a REST
insert with the service key (`Prefer: return=minimal`); a receipt that cannot be
saved throws, so no call is made without one (the eod-radar rule).

Env, read by name: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SLACK_BOT_TOKEN`,
`CLICKUP_API_TOKEN`, `NOTICES_CRON_SECRET`, `ALERT_SLACK_TO` (optional, default
`U09305KE2KS`), `NOTICES_BOT_USER` (optional, default `U0C0MJZNS2Y`). Supabase
function secrets are project-wide, so `SLACK_BOT_TOKEN` and `CLICKUP_API_TOKEN`
already exist; `NOTICES_CRON_SECRET` is new.

### 4.2 The door and its jobs

POST only (else 405 `{"ok": false, "note": "POST only"}`). `x-cron-secret`
must equal `NOTICES_CRON_SECRET`, compared in constant time before the body is
read (else 401 `{"ok": false, "note": "not allowed"}`). The function is meant to
be deployed with `verify_jwt` off; if the deploy cannot set it, pg_cron's
optional anon `Authorization` header passes the gateway and the door still
checks the secret. There is no JWT path: editors reach the sender only through
the RPC-queued test and channel checks (section 2.1). Bodies, strictly (any
other key or shape is 400 with the sentence
`Send {"job":"run"}, {"job":"doctor"}, {"job":"dryRun", ...} or {"job":"rehearse", ...}.`):

| Body | Answer |
|---|---|
| `{"job":"run"}` | 202 `{"ok": true, "started": "run"}`; the run goes on in `EdgeRuntime.waitUntil` |
| `{"job":"doctor"}` | 200 `Doctor` (4.6) |
| `{"job":"dryRun","responseId":"0dvg18xtj99sjea0dxi2ixarmxqdxw5y"}` | 200 `DryRun` |
| `{"job":"dryRun","kind":"blueprint.close","taskId":"86ex70t90","facts":{...},"variant":"done"}` | 200 `DryRun` (`variant` optional; else picked by 4.3) |
| `{"job":"rehearse","kind":"kickoff","to":"U09305KE2KS"}` | 200 `{"ok": bool, "id": uuid, "state": text, "channel": "D...\|null", "ts": "text\|null", "reconcileFound": bool, "note": text}`; `kind` optional (default `kickoff`), `to` optional (default `ALERT_SLACK_TO`), must match `^[UW][A-Z0-9]{8,12}$` |

`DryRun` = `{"ok": true, "kind", "variant", "target", "threadTs", "text", "blocks", "tags": [{"label", "tagged": bool}], "commentCheck": "found|missing|unread|null"}`.
A dry run writes no notice row; a kickoff dry run makes one ClickUp GET (its
receipts carry `run_key = 'dry-run'`).

### 4.3 One run (`run.ts`, `send.ts`)

1. `cockpit_slack_notice_sweep()`.
2. Channels: `cockpit_slack_channel_pending()`; for each, `conversations.info`;
   on `missing_scope` fall back to `conversations.history` with `limit 1`.
   Member (or a readable history): `cockpit_slack_channel_checked(id, true, name, is_private, 'mahara-club-bot is in it.')`.
   Not a member: `false`, `Invite @mahara-club-bot to #{name}, then add it again.`;
   `channel_not_found`: `Slack shows no channel {id} to the bot. If it is private, invite @mahara-club-bot first, then add it again.`;
   a public channel when the scopes lack `channels:history`:
   `The bot cannot read #{name}, so its posts cannot be checked. Use a private channel, or add channels:history to the Slack app.`
3. Reconcile (4.4).
4. `cockpit_slack_notice_claim(10)`. `busy`: stop.
5. Before the first post of the run: `auth.test`. Its `user_id` must equal
   `NOTICES_BOT_USER`; otherwise every claimed row gets outcome `requeue`
   (`retryAfterSec` 300, error `The Slack token is not mahara-club-bot, so nothing was posted. The tech lead sets SLACK_BOT_TOKEN again.`)
   and the run stops. No token: every row `failed`, `SLACK_BOT_TOKEN is not set on cockpit-notices.`
6. Per row:
   - **Kickoff comment check.** `providerTools(CLICKUP_API_TOKEN, health).call('GET', 'task/{taskId}/comment')`
     from `cockpit-csm-api/tools.ts`. `found` when a comment's `comment_text`
     matches `/kickoff handoff/i` and `Number(date) >= Date.parse(submittedAt) - 1000`
     (`handoffAt` = that date); else `missing`; a throw is `unread`. Not found
     and `now < submittedAt + 20 min`: outcome `requeue`, `retryAfterSec` 60,
     error `Waiting for Make's Kickoff Handoff comment.` (not an attempt).
     Else variant `complete` when found, `late` when not.
   - **Variant** for the other kinds: `blueprint.close`: `typeform` when
     `source = 'typeform'`, `reconcile` when `settled = 'reconcile'`, else `done`;
     `blueprint.media`: `live` when `mapPhase >= 5` or `clientStatus ~* '^\s*active\s*$'`,
     else `new`; replies: `thread` when `threadTs` is set, else `top`; a rehearsal:
     `facts.variant`, else `complete` (kickoff), `done` (close), `new` (media), `top` (replies).
   - **Mentions.** The list for the variant: `complete`: `main` then `second`
     when `facts.second`; `late`: `late` then `second` when `facts.second`; all
     else `main`. A `Mention` with `slackId` null and an `email`:
     `slackTools.lookupByEmail`; found sets `slackId`. Still none, or a
     `missing` rule: the text uses the role label in plain text, and the sender
     writes one ledger row `{provider: 'slack', method: 'GET', resource: 'notices/mentions', phase: 'response', http_status: null, run_key: id}`
     (the native monitor shows it until a later run writes the same resource
     with `http_status: 200` because every tag resolved). A rehearsal never
     tags: every mention is plain text.
   - **Text.** `noticeText(kind, variant, facts)` (4.5); a rehearsal calls it
     with `facts.of`, `sampleFacts(facts.of)` and `rehearsal: true`.
   - **Post.** `slackTools.postMessage({channel: target, text, blocks, thread_ts: threadTs})`
     (a rehearsal with `target` null posts to the looked-up `U` id and sends it as `p_detail.target`).
   - **Record.** `posted`: `slackReceiptConfirmed(target, receipt)` (4.5); not
     confirmed: outcome `unknown`, `Slack answered for another channel ({channel}). Look there first; it is not sent again.`;
     confirmed: `slackTools.permalink(channel, ts)` (best effort) then outcome
     `posted` with `{variant, text, blocks, permalink, facts: sendFacts}`.
     `ratelimited`: outcome `retry` with `retryAfterSec`. Refused: outcome
     `failed` with the sentence below. Unknown, or a throw after the request
     left: `unknown`, `Slack did not confirm the post; it is not sent again in case it arrived.`
     A throw before the request left: outcome `retry`, the error as a sentence.
7. Return `{"ok": bool, "swept": {...}, "channels": n, "reconciled": n, "claimed": n, "posted": n, "requeued": n, "retried": n, "failed": n, "unknown": n}`.

Refusal sentences (`code` from Slack's `error`):

| Code | Sentence |
|---|---|
| `not_in_channel`, `channel_not_found` | `Slack refused it: mahara-club-bot is not in #{name}. Invite it there, then ask the tech lead to requeue this notice.` |
| `is_archived` | `#{name} is archived. Choose another channel in Settings, Notices and routing.` |
| `missing_scope` | `Slack refused it: the bot lacks a permission. The tech lead adds it to the Slack app.` |
| `invalid_auth`, `not_authed`, `token_revoked`, `account_inactive` | `Slack refused the bot's token. The tech lead sets SLACK_BOT_TOKEN again.` |
| `invalid_blocks`, `msg_too_long` | `Slack refused the message's layout. The tech lead checks the notice text.` |
| other | `Slack refused it ({code}).` |

### 4.4 Reconcile

`cockpit_slack_notice_unknowns(10)`. Rows with `channel` null are left alone.
Replies: `conversations.replies(channel, ts = threadTs, oldest)`; top level:
`conversations.history(channel, oldest)`; `limit` 200, up to 20 pages by
`response_metadata.next_cursor`. A message whose `text` contains `Ref {ref}`
and has a `bot_id` (or `subtype = 'bot_message'`): outcome `posted` with that
`ts` and the channel. Not found: nothing (it stays `unknown` for a person; the
RPC hands it out again after 10 minutes, for 24 hours).

### 4.5 `slackTools`, the receipt rule and `noticeText`

**Added to `supabase/functions/cockpit-csm-api/tools.ts`** (append only; the
existing exports are not touched), written on `eod-radar/slack.ts:41-87`:

```ts
export type SlackHealthRow = {provider:'slack'; method:'GET'|'POST'; resource:string;
  phase:'intent'|'response'|'unknown'; http_status?:number|null; object_id?:string|null};
export type SlackAnswer =
  | {kind:'ok'; body:Record<string,unknown>; scopes:string|null}
  | {kind:'refused'; code:string; status:number; retryAfter:number|null; scopes:string|null}
  | {kind:'unknown'};
export type SlackPost =
  | {state:'posted'; ts:string; channel:string; botId:string|null}
  | {state:'ratelimited'; retryAfter:number}
  | {state:'failed'; code:string}
  | {state:'unknown'; error:string};
export type SlackResource = 'chat.postMessage'|'chat.getPermalink'|'conversations.history'
  |'conversations.replies'|'conversations.info'|'users.lookupByEmail'|'auth.test';
export function slackTools(token:string, health:(row:SlackHealthRow)=>Promise<void>, request:typeof fetch=fetch):{
  call(method:'GET'|'POST', resource:SlackResource, input:Record<string,unknown>, onSend?:()=>void):Promise<SlackAnswer>;
  postMessage(input:{channel:string; text:string; blocks?:unknown[]; thread_ts?:string}, onSend?:()=>void):Promise<SlackPost>;
  history(channel:string, opts:{oldest?:string; latest?:string; inclusive?:boolean; limit?:number; cursor?:string}):Promise<SlackAnswer>;
  replies(channel:string, ts:string, opts:{oldest?:string; limit?:number; cursor?:string}):Promise<SlackAnswer>;
  info(channel:string):Promise<{ok:true; id:string; name:string|null; isPrivate:boolean; isMember:boolean; isArchived:boolean; scopes:string|null}|{ok:false; code:string; scopes:string|null}>;
  permalink(channel:string, ts:string):Promise<string|null>;
  lookupByEmail(email:string):Promise<{state:'ok'; id:string}|{state:'not_found'}|{state:'refused'; code:string}|{state:'unknown'}>;
  authTest():Promise<{ok:true; userId:string|null; teamUrl:string|null; scopes:string|null}|{ok:false; code:string}>;
};
```

Rules: an empty token throws `SLACK_BOT_TOKEN is not configured`; one intent
row before every call and one response or unknown row after; `resource` is
`slack.com/api/{method}` (the form the ledger already holds), never a channel,
user, email or text; `object_id` is the `ts` of a post, else null; GET sends a
query string, POST JSON (`application/json; charset=utf-8`); `redirect: 'error'`,
15 s timeout; `postMessage` always sends `unfurl_links: false, unfurl_media: false`;
HTTP 429 or `ratelimited` is `refused` with `code = 'ratelimited'` and
`retryAfter` from the header; a 5xx or an unreadable 200 is `unknown`; the
`x-oauth-scopes` header is passed back as `scopes`; error codes are cut to
`[a-z0-9_]{1,60}`. The sender's health callback inserts
`{...row, action_id: null, run_key}` with `run_key` = the notice id, or `run`,
`doctor`, `dry-run`.

**`supabase/functions/_shared/slackReceipt.ts`** (import-free, used by
`cockpit-notices` and by `cockpit-media-api/execute.ts`):

```ts
export type ReceiptCheck = {ok:true; ts:string; channel:string} | {ok:false; why:string};
export function slackReceiptConfirmed(requested:string, receipt:{ok?:unknown; ts?:unknown; channel?:unknown}):ReceiptCheck;
```

Confirmed when `receipt.ok === true`, `ts` matches `^\d+\.\d+$`, `channel`
matches `^[CDG][A-Z0-9]+$`, and: a requested `C`, `G` or `D` id equals the
returned channel; a requested `U` or `W` id returns a `D` channel. Anything else
is not confirmed.

**`text.ts`** exports:

```ts
export type NoticeKind = 'kickoff'|'kickoff.updated'|'blueprint.close'|'blueprint.updated'|'blueprint.media'|'blueprint.offer';
export type Variant = 'complete'|'late'|'done'|'reconcile'|'typeform'|'new'|'live'|'thread'|'top';
export type TextMention = {label:string; slackId:string|null};
export type NoticeFacts = Record<string, unknown> & {ref:string; taskId:string; client:string;
  mentions?:TextMention[]; rehearsal?:boolean};   // section 3 facts + live + send-time keys, flat
export type SlackBlock = Record<string, unknown>;
export function noticeText(kind:NoticeKind, variant:Variant, facts:NoticeFacts):{text:string; blocks:SlackBlock[]};
export function sampleFacts(kind:NoticeKind, now?:Date):NoticeFacts;   // "Sample client", no real ids
export function escapeSlack(s:string):string;    // & < > to &amp; &lt; &gt;
export function kuwaitWhen(iso:string):string;   // "Sun 25 Oct, 14:02" (UTC+3)
export function kuwaitClock(iso:string):string;  // "14:02"
export function kuwaitDay(iso:string):string;    // "Sun 1 Nov"
export function cleanStatus(s:string):string;    // letters, numbers, spaces, hyphens: "Brand Blueprint Booked"
export function noticeLinks(taskId:string):{cockpit:string; card:string; blueprint:string};
export const SERVICE_LABEL:Record<string,string>;  // the five, as blueprintBrief.ts SERVICE_LABEL
```

Links: cockpit `https://cockpit.maharamedia.com/client-success/clients/{taskId}?tab=onboarding`;
card `https://app.clickup.com/t/{taskId}`; Blueprint
`https://cockpit.maharamedia.com/client-success/clients/{taskId}/present/blueprint?view=prep`;
launch task `https://app.clickup.com/t/{launchTaskId}`. Links are mrkdwn
`<url|words>` in a `context` block, not interactive buttons (section 11, X6).
A mention renders `<@{id}>` only when `id` matches `^[UW][A-Z0-9]{8,12}$`, else
the escaped label. Never `@channel` or `@here`. Every dynamic string is escaped.
`text` (the fallback, and what reconcile searches) always ends with
`Ref CN-xxxxxxxx`. Blocks: one `section` (mrkdwn) with the lines, one `context`
with the links, one `context` `Client success · Ref CN-xxxxxxxx` (media:
`Media · Ref ...`). A rehearsal prefixes `[Rehearsal] ` to `text` and to the
first line, tags nobody (labels in plain text, `would tag the CSM`), and leaves
the links out with the line `Links are left out of a test.`

The copy, line by line (`{mentions}` = the list joined by spaces; a line that
would start with an empty mention starts with the next word capitalised):

| Kind, variant | `text` | Section lines |
|---|---|---|
| kickoff, complete | `Kickoff complete: {client}. Next is the Brand Blueprint call. Ref CN-x` | `*Kickoff complete: {client}*` / `Filled {by {filledByRole} \| in Typeform} on {kuwaitWhen(submittedAt)}.` / `The card shows {cleanStatus(clientStatus)}{, and the Brand Blueprint link}.` / `The Kickoff Handoff comment is on the card ({kuwaitClock(handoffAt)}).` / second: `This is the second kickoff for this client. The card has a new Kickoff Handoff comment, so check it for a second Technical and Creative task, and do not send it a third time.` / `Next is the Brand Blueprint call. {mentions}` |
| kickoff, late | `Kickoff in, card not updated: {client}. Open the card and check it. Ref CN-x` | `*Kickoff in, card not updated: {client}*` / `Filled ... on ...` / missing: `The card has no Kickoff Handoff comment 20 minutes after the kickoff. Open the card and check it. Do not send the kickoff again. {mentions}`; unread: `The cockpit could not read the card's comments 20 minutes after the kickoff. Open the card and check it for the Kickoff Handoff comment. Do not send the kickoff again. {mentions}` / second: `This is the second kickoff for this client. Do not send it a third time.` |
| kickoff.updated, thread | `Card updated at {kuwaitClock(cardUpdatedAt)}. Ref CN-x` | `Card updated at {kuwaitClock}.` (no link block) |
| kickoff.updated, top | `Kickoff card updated: {client}, at {kuwaitWhen}. Ref CN-x` | `*Kickoff card updated: {client}*` / `Card updated at {kuwaitWhen(cardUpdatedAt)}.` |
| blueprint.close, done | `Brand Blueprint complete: {client}. Next is the launch call. Ref CN-x` | `*Brand Blueprint complete: {client}*` / `Closed by {closedByRole \| the creative director} on {kuwaitWhen(closedAt)}. Scripts and custom creative can start.` / `{mentions} next: send the phase 5 WhatsApp from your comment on the card, then book the launch call.` (mapPhase 5 or more: `{mentions} next: the Onboarding Map is already at phase {n}, so there is no phase 5 WhatsApp to send.`) / `Launch call booked for {kuwaitWhen(launchCallAt)}.` or `Launch call not booked yet.` |
| blueprint.close, reconcile | `Blueprint closed: {client}. The card update needs a check. Ref CN-x` | `*Blueprint closed: {client}*` / `The card update needs a check. Open the call page. {mentions}` |
| blueprint.close, typeform | `Brand Blueprint complete: {client}. Next is the launch call. Ref CN-x` | `*Brand Blueprint complete: {client}*` / `The Blueprint form is in. Next is the launch call. {mentions}` |
| blueprint.media, new | `Brand Blueprint completed: {client}. Scripts and custom creative can start. Ref CN-x` | `*Brand Blueprint completed*` / `Client: {client}` / `Service focus: {SERVICE_LABEL[service] \| not chosen}` / `<card\|card>` and, with a launch task, ` · <launch\|launch task>` / `Scripts and custom creative can start.` |
| blueprint.media, live | `Brand Blueprint completed: {client}. The client is already live. Ref CN-x` | as `new`, last line `The client is already live; nothing new starts from this close.` |
| blueprint.updated, thread | `The card update is confirmed. Ref CN-x` | `The card update is confirmed.` |
| blueprint.updated, top | `Blueprint card confirmed: {client}. Ref CN-x` | `*Blueprint card confirmed: {client}*` / `The card update is confirmed.` |
| blueprint.offer, thread | `Offer locked by {offeredByRole \| the creative director}. Brand DNA is {complete \| still missing}. Ref CN-x` | the same sentence |
| blueprint.offer, top | `Offer locked: {client}. Ref CN-x` | `*Offer locked: {client}*` / `Offer locked by ... Brand DNA is ...` |

Link blocks: kickoff `Open in the cockpit` · `Open the ClickUp card`;
blueprint.close `Open in the cockpit` · `Read the Blueprint` · `Open the ClickUp card`;
replies in a thread: none; top-level replies: `Open in the cockpit`. Footer
`Client success · Ref CN-x` on every message except thread replies (whose
`text` ends with the Ref).

### 4.6 The doctor

`Doctor` = `{"ok": bool, "bot": {"userId": "text|null", "ok": bool}, "missingScopes": ["..."], "channels": [{"id", "name", "private", "member": bool, "ok": bool, "note"}], "mentions": [{"kind", "rule", "people": [{"label", "slack": "ok|not_found|refused|unknown|none"}], "ok": bool}], "secrets": {"SLACK_BOT_TOKEN": bool, "CLICKUP_API_TOKEN": bool, "NOTICES_CRON_SECRET": bool}, "note": "text"}`.
`auth.test` `user_id` must equal `NOTICES_BOT_USER`. Scopes needed: `chat:write`,
`groups:history`, `users:read.email` (plus `channels:history` when a public
channel is listed). Each channel from `cockpit_slack_notice_doctor_inputs()`
is checked as in 4.3 step 2 and recorded with `cockpit_slack_channel_checked`
(the only write besides receipts). Each settings row's mentions are listed by
role label; a person without a Slack id is looked up by email (read only); a
rule that resolves to nobody fails the doctor. `ok` only when all pass.

### 4.7 Secrets, vault and cron (applied later by the main session, not in any file)

Function secret `NOTICES_CRON_SECRET` and vault `cockpit_notices_cron_secret`
(the same value); function secret `CREATIVE_CRON_SECRET` and vault
`cockpit_creative_cron_secret`; vault `cockpit_anon_key` (the project's public
anon key: the creative API keeps `verify_jwt` on, so pg_cron needs a JWT). The
cron jobs come from the migrations; they post nothing until the vault rows
exist.

---

## 5. The creative and media API changes

### 5.1 `cockpit-media-api` (notices-fn): S1

`execute.ts`, the `resolved.slackMessage` branch is replaced by:

1. `const check = slackReceiptConfirmed(String(resolved.body?.channel ?? ''), made)`; not confirmed: throw `Slack did not return a verifiable message receipt`.
2. `conversations.history?channel={check.channel}&latest={check.ts}&inclusive=true&limit=1`.
3. `actual` = the message with `ts === check.ts`; throw `Slack message read-back could not be confirmed; reconcile before sending again` when there is none, or it has neither `bot_id` nor `subtype === 'bot_message'`, or `made.message?.bot_id` is set and differs from it. The text is never compared.
4. `actual = {...actual, channel: check.channel}`; `receipts.push({id: check.ts, channel: check.channel})`.

`slack.ts` is unchanged. An unknown stays in `reconcile` for a person, as today.

### 5.2 `cockpit-creative-api` (db-blueprint): S3, S5, S8

`blueprint.ts`:

- `prepareClose` ignores `p.closeRoute`. No Slack step, no Make step, no `make`
  in the plan, `fallback` and `makeLive` gone; Can Self-Record? always written
  (by label, as now); `closeCsmComment(p, {whatsapp, launchFound, makeFallback: false})`.
- Map phase (S8), first press only: `mapPhase` = the integer in the card's
  Onboarding Map value (`/[?&]phase=(\d+)/`), else null. `mapPhase >= 5`: no map
  step, the line `The Onboarding Map is already at phase {n}, so it is left as it is.`,
  and `whatsapp = false` (no phase 5 paste for a client already past it). Else
  the map step as today.
- On a first press the plan adds the line
  `On the first close the cockpit's notices tell the team in Slack (Settings, Notices and routing).`
- The close result is exactly
  `{kind: 'blueprintClose', launchTaskId: string|null, closeRoute: 'card_only', mapPhase: number|null, mapSkipped: boolean}`.
  `mapPhase` is the parsed phase (null when unreadable); the notice trigger reads it.
- `BlueprintPlan.blueprint.make` is removed; `slackCloseText` and `makeClose`
  stay in `blueprintBrief.ts` untouched and unused by the plan.

`outbox.ts`:

- `executeOutbox` loses its Make branch.
- `export type OutboxLoader = (id: string) => Promise<Row>`;
  `export const browserLoader = (client: any): OutboxLoader` (the
  `cockpit_creative_client_action('get')` call of today);
  `export const serviceLoader = (admin: any): OutboxLoader` (`cockpit_creative_outbox_load_for_actor`).
- `export class ClientActionError extends Error { started: boolean }`.
- `runClientAction(input: Row, load: OutboxLoader, admin: any, env: Env, actorId: string, opts: {source?: 'browser'|'cron'} = {})`:
  the fence, journal, claim and settle of today, with `load` for both the first
  read and `check()`. With `source: 'cron'`: a loaded row not `pending` returns
  `{id, skipped: true, state}`; the journal `request` is `{outbox: row, source: 'cron'}`;
  `actor_id` is `actorId` (the presser's). Errors are thrown as
  `ClientActionError` with `started`.

`drain.ts` (new): `runDrain(admin: any, env: Env, apply: boolean): Promise<{ok: true; apply: boolean; failed: number; ran: {id: string; kind: string; outcome: 'done'|'reconcile'|'refused'|'skipped'|'dryRun'; attempts?: number; error?: string}[]}>`:
`admin.rpc('cockpit_creative_outbox_due', {p_apply: apply})`; each row through
`runClientAction({args: {id}, apply}, serviceLoader(admin), admin, env, row.actorId, {source: 'cron'})`;
a `ClientActionError` with `started === false` and `apply`: `admin.rpc('cockpit_creative_outbox_refused', {p_id, p_error: message})`;
`started === true`: outcome `reconcile` (runClientAction already settled it).

`index.ts`: the body is read once with `req.json()` before `getUser()`. When
`input.operation === 'cron'`: `x-cron-secret` must equal `CREATIVE_CRON_SECRET`
(constant time; 401 `{ok: false, error: 'not allowed'}`), `input.job` must be
`drain` (400 `Send {"operation":"cron","job":"drain","apply":true}.`), then
`admin = createClient(url, service, {auth: {persistSession: false}, global: {headers: {'x-cockpit-source': 'cron'}}})`
and `return json(await runDrain(admin, env, input.apply === true))`. Every other
operation goes on to `getUser()` as today and uses the parsed `input`;
`clientAction` calls `runClientAction(input, browserLoader(client), admin, env, auth.user.id)`.

---

## 6. The screens (screens)

Before writing a screen, read `~/.cache/mahara-ship/mc/skills/frontend-design/SKILL.md`
and `~/.cache/mahara-ship/skills/hallmark/SKILL.md` and put the design plan
below, with your own notes, at the top of your build log. Run the slop test on
screenshots from the harness before calling it done.

**Design plan (component scope inside two existing cockpits).** Tokens: the
cockpits' own (`--mahara-teal` primary, `--primary-ink` for teal text in light
mode, Geist and Geist Mono, IBM Plex Sans Arabic for Arabic inside
`<bdi dir="auto">`); no new colour, every colour a token. Type: Geist for words,
Geist Mono for channel names, IDs and times. Layout: the CSM app has no
`SectionCard`, `StatusChip` or `EmptyState`; use its kit (`components/kit.tsx`:
`PageHeader`, `StatTile`, `Chip`, `Pill`, `Dot`, `Kicker`, `Fold`, `ExtLink`),
`components/ui` (`button`, `switch`, `dialog`, `input`, `label`, `empty`) and
the Settings page's own `<section className="rounded-2xl border bg-card p-4 sm:p-6">`.
The CD app uses its own `components/ui` and the Blueprint card's existing
`Dot`, `PartRow` and `stateView`. Signature element: the trail's Slack stop
(a dot, `Posted in #csm-general at 14:03`, `Open in Slack`), the same in the
kickoff window, the Onboarding panel and the Blueprint card. The Notices and
routing card reads each notice as one sentence ("Posts in #csm-general and tags
the creative director.") with the edit controls folded under it. No italics in
headings, no fake chrome, no invented numbers, works at 320 px.

### 6.1 Client success cockpit (`apps/client-success-cockpit`)

| File | Change |
|---|---|
| `src/forms/kickoff.ts` | S10 and S9 copy below |
| `src/forms/formConfig.ts` | `after.linkBack.href?: (taskId: string) => string` (the button's target; the stop still reads `links[key]`); `after.notice?: {kind: 'kickoff'; pending: string; line: string}`; `FormContext.notices: NoticeRead \| null` and `failed.notices?: string` |
| `src/forms/formStatus.ts` | `StopKey` gains `"slack"`; `TrailStop` gains `problem?: boolean`; `trailFor` takes the notice (the `NoticeView` of kind `kickoff` whose `responseId` is the send's) and adds the Slack stop after `link`; `trailSummary` says `· posted in Slack` / `· not posted in Slack`. `BLUEPRINT_ON` stays byte for byte (it may gain `export`) |
| `src/forms/FormPanel.tsx` | renders the Slack stop and its `Open in Slack` link; the link-back button uses `linkBack.href(taskId)` when given; a quiet line `This kickoff's window` with a copy button for `window.location.origin + formUrl(taskId, 'kickoff')` |
| `src/forms/useLiveForm.ts`, `src/forms/useFormPanel.ts`, `src/forms/FormWindow.tsx` | read `cockpit_slack_notice_read(taskId)` with the other reads and on each check; while the Slack stop is pending and the window is visible, re-read it every 60 s for 25 minutes |
| `src/present/kickoffStop.ts`, `src/present/KickoffSlide.tsx` | type changes only; the deck never shows the Slack stop (the deck is on the client's screen) |
| `src/lib/notices.ts` (new) | zod-parsed clients for the seven browser RPCs of 2.1 |
| `src/lib/blueprintStatus.ts` | `blueprintNudge({stage, mapUrl, parts, calls, now}): {heldAt: string} \| null`, the rule of 2.2 item 4 on the CSM's own reads |
| `src/components/OnboardingKit.tsx` | Kickoff item: `Copy the kickoff window's link` (done: `Link copied. It opens this client's kickoff window.`). Brand Blueprint item: the nudge (reads `readClientTimeline` only when the stage is Brand Blueprint Booked or Ready For Launch and part 2 is absent; tone warn; `Blueprint call held {Sun 18 Oct}. No Blueprint record yet. Open the call page.` with the existing Open the Blueprint deck button); after part 2, the close's Slack stop from `cockpit_slack_notice_read` (kinds `blueprint.close` and `blueprint.media`) |
| `src/components/NoticesRouting.tsx` (new) | the Notices and routing card (6.3) |
| `src/pages/SettingsPage.tsx` | mounts `NoticesRouting` as its own section |
| `src/dev/formHarness.tsx` and a notices fixture | fixtures for the new states |

The Blueprint close result renders in `src/present/BlueprintFields.tsx`
(`PartsBar`, `RunLines`), inside the deck that is shared on the call, not in
`blueprintDeck.tsx`. The CSM's Blueprint Slack stop goes on the Onboarding
panel instead (section 11, X5); `BlueprintFields.tsx` is not changed.

Kickoff copy (`kickoff.ts`):

```ts
again: "a second Kickoff Handoff comment, a second Technical and Creative task and a second WhatsApp to the client's group",
makeDoes: [
  "The Kickoff Handoff comment, with every answer, on the client's ClickUp card.",
  "A Technical Onboarding task and a Creative Onboarding task.",
  "The Brand Blueprint link on the card, and the card at Brand Blueprint Booked.",
  "The Onboarding Map at phase 4.",
  "The phase 4 WhatsApp to the client's group.",
],
after: {
  say: "Kickoff sent. Make is updating the card. Book the Brand Blueprint call below.",
  sub: "The team hears in #csm-general once the card is updated.",
  // lateSay, lateMake, checksAtSec, lateAfterMin, cardDone, cardLine: unchanged
  linkBack: {
    key: "blueprint_form",
    label: "The card has the Brand Blueprint link",
    pending: "Make adds the Brand Blueprint link to the card",
    short: "the Blueprint link",
    open: "Open the Brand Blueprint",
    href: taskId => blueprintPrepUrl(taskId),
  },
  notice: {
    kind: "kickoff",
    pending: "The team hears in #csm-general",
    line: "Once Make has updated the card, usually within a few minutes.",
  },
},
```

The Slack stop, by notice state: `posted`: `Posted in #{name} at {14:03}`, done,
with `Open in Slack` when there is a permalink; `queued`, `sending` or no row
yet: `notice.pending`, line `notice.line`; `failed`:
`Not posted: {reason}. Tell the tech lead.`, `problem: true`; `unknown`:
`Not confirmed: {reason}. Tell the tech lead.`, `problem: true` (X17); `muted`:
`Not posted: the kickoff notice is off in Settings.`, done; `skipped`:
`Not posted: {reason}`, done; read failed: `The cockpit could not read the Slack notice just now.`
(not done, not current).

### 6.2 Creative director cockpit (`apps/creative-director-cockpit`)

| File | Change |
|---|---|
| `src/lib/blueprint.ts` | remove `CLOSE_ROUTES` and `CloseRoute`; `setBlueprintSetting` key type without `"close_route"`; outbox schema gains `attempts: z.number().int().optional()`; `readBlueprintCall(client, taskId)` reads `cockpit_blueprint_sources(taskId).blueprintCall` |
| `src/lib/notices.ts` (new) | zod-parsed `cockpit_slack_notice_read` only |
| `src/components/BlueprintCard.tsx` | nudge (when `blueprintCall.nudge`): `Blueprint call held {Sun 18 Oct}. No Blueprint record yet. Open the call page.` linking `callLink(...)`; part 2 row: `Posted in #csm-general at 14:03` and `#media-general at 14:03` (or `Not posted in #{name}: {reason}. Tell the tech lead.`); part 3 row: `Reply posted in #{name} at {time}`; a pending press with `attempts > 0`: `This press was refused: {error}. The cockpit tries again in 2 minutes ({attempts} of 3).`; failed with `attempts >= 3`: `This press was refused: {error}. Fix it and press again.`; failed after 30 minutes: the stored error as it is |
| `src/components/BlueprintSettings.tsx` | the `CloseSwitch` group is replaced by a read-only group `After Close the call`: `The cockpit writes the card and its comments, and the CSM pastes the phase 5 WhatsApp from the card comment. #csm-general and #media-general hear through the notices.` with a link `Change where and who in the client success cockpit` to `https://cockpit.maharamedia.com/client-success/settings` |
| `src/lib/creativeSourceModels.ts` | remove line 1281 (`line("Brand blueprint form", client.blueprintFormLink);`) |
| `src/dev/blueprintFixtures.ts`, `src/dev/blueprintHarness.tsx` | fixtures for the nudge, the stops and the refusals |

### 6.3 The Notices and routing card (`NoticesRouting.tsx`)

Reads `cockpit_slack_notice_settings_read()`. Title `Notices and routing`;
intro `Where the cockpit posts in Slack when a kickoff or a Brand Blueprint is done, and who it tags. A change applies to the next notice.`

Rows, in this order, with these labels and one-line hints:

| kind | Label | Hint |
|---|---|---|
| `kickoff` | Kickoff complete | Posts when Make has updated the card. |
| `kickoff.late` | Kickoff late | Posts where Kickoff complete posts, 20 minutes after a kickoff the card has not caught up with. Always on. |
| `kickoff.second` | Second kickoff | A line added to either kickoff notice. Always on. |
| `kickoff.updated` | Kickoff card updated | A reply under a late notice once the card is updated. |
| `blueprint.close` | Brand Blueprint closed | Posts when the creative director closes the Blueprint call. |
| `blueprint.media` | Brand Blueprint completed, for media | Tells the media team scripts and custom creative can start. |
| `blueprint.updated` | Blueprint card confirmed | A reply under the close once a card update that needed a check is confirmed. |
| `blueprint.offer` | Offer locked | A reply under the close when the offer is locked. |

Each row's sentence: `Posts in #{channel} and tags {the creative director, the CSM, ...}.`
(`Replies in the first notice's thread`, `Tags nobody`, `Off.`); a tag that
finds nobody shows `nobody is in that seat`; the last notice's state as a stop
(`Posted at 14:03` / `Not posted: {reason}`). Editors (`can.edit`): an `On`
switch (post and reply rows), a channel select from `ok` channels (post rows),
seat chips and a people picker (`people`), `Save` (toast `Saved. The next notice uses it.`),
and `Send a test to me` (post and reply rows): `Test on its way. It reaches your Slack direct messages within a minute.`,
then from `test`: `Sent to your direct messages at 14:03.` or `Not sent: {reason}`;
poll the read every 10 s for 2 minutes after a press.
Channels sub-section: the list with state (`Checking`, `Ready`, `Refused: {note}`),
`Add a channel` (ID and an optional name; `Checking`, then `Added` or the
note), `Remove` (refusal sentence shown in place). Editors sub-section, only
when `can.editors`: `Who can change these: the CEO, admins, and:` the list,
`Add` from `members`, `Remove`. Non-editors see the sentences only and
`Only the CEO, an admin or someone they add can change these.`
A failed read: `The notice settings could not be read: {reason}. Refresh the page; if it stays, tell the tech lead.`
An RPC refusal is shown under the control that caused it, in the server's words.

### 6.4 Shared-file pins

`scripts/check-shared.sh` pins `src/present/deckHost.ts` (CS) and
`src/lib/deckHost.ts` (CD) byte for byte, and the CSM's `kit.tsx` is not
pinned. No file this contract changes is pinned; do not change `deckHost.ts`,
`blueprintBrief.ts` or any pinned file. Run `scripts/check-shared.sh` at the end.

---

## 7. Workers and docs (workers-docs)

| File | Change |
|---|---|
| `hermes/cockpit-guardian/checks/queues.py` | `Queue` gains `status_col: str = "status"`, `kind_col: Optional[str] = None`, `kinds: tuple[str, ...] = ()`; `queue_check` selects and filters by `status_col` (and `kind_col in kinds` when set) and reports it as `status`. Add `cockpit_slack_notices` and `cockpit_creative_outbox` to `WITH_ERROR`. Three rows below |
| `hermes/cockpit-guardian/checks/edge_functions.py` | `EXPECTED` gains `"cockpit-notices": False` (comment: pg_cron with `x-cron-secret`; flip to True only if the deploy could not turn the JWT check off) and `"cockpit-creative-api": True` |
| `hermes/cockpit-guardian/checks/pg_cron.py` | `EXPECTED_JOBS` gains `"mahara-slack-notices"` and `"mahara-creative-drain"` (comment: 20261025n and 20261025o) |
| `hermes/cockpit-guardian/README.md` | the three queue rows and the two lists in the "Every check" table and the runbook rows |
| `hermes/cockpit-guardian/tests/test_checks_data.py` | tests for the three rows (waiting past the limit warns; within it is OK; a `failed` in 24 h warns; the kind filter leaves non-Blueprint outbox rows out) |
| `hermes/cockpit-guardian/tests/test_hiring_sync.py` | `len(pg_cron.EXPECTED_JOBS)` 22 becomes 24, with the comment |
| `hermes/cockpit-sync/creativeProducer.ts`, `creative-fields.test.ts` | no change: S6's four fields are already at `creativeProducer.ts:70-73` and the test passes; S6 is only the VPS release now |
| `RUNBOOK.md` | a `## Slack notices (kickoff and Brand Blueprint)` section and a `## Brand Blueprint press drain` section, below |
| `docs/csm-forms/KICKOFF.md` | 1 "After the call", 4.1 the trail (the Slack stop, the native Blueprint button, the window link), 4.3, 5.2 (`cockpit-notices`), 5.4 (A2, A3) to match this contract |
| `docs/brand-blueprint/SPEC.md` | 3.4 (no Slack or Make step; the map phase skip; the result keys), 3.6 (the route fixed at `card_only`), 3.1 (the drain), 4.1 (nudge, stops, refusals), 4.3 (Settings without the switch), 6.1 (the CSM's nudge and stop) |
| `scripts/ship.sh` | one block after the client deck tests, below |
| `scripts/verify-cutover-readiness.py` | `RELEVANT_TEST_FILES` gains every test of section 9 that passes when run as `bun test <path>` from the repo root; one that does not is left out and named in the report |

Guardian queue rows:

```python
BLUEPRINT_KINDS = ("blueprintLaunch", "blueprintClose", "blueprintOffer")
Queue("queue-slack-notices", "cockpit_slack_notices", "Slack notice", ("queued", "sending", "unknown"), "created_at", 30,
      "the tech lead", "Run the cockpit-notices doctor; an unknown needs a person to look in Slack for its Ref "
      "(RUNBOOK, Slack notices).", "", status_col="state", failed_col="finished_at"),
Queue("queue-creative-blueprint", "cockpit_creative_outbox", "Brand Blueprint press", ("pending",), "created_at", 10,
      "the tech lead", "Read the press's error on the Blueprint card; the drain runs every 2 minutes "
      "(RUNBOOK, Brand Blueprint press drain).", "", status_col="state", kind_col="kind", kinds=BLUEPRINT_KINDS,
      failed_col="settled_at"),
Queue("queue-creative-reconcile", "cockpit_creative_outbox", "Brand Blueprint press needing a look", ("reconcile",),
      "created_at", 0, "the tech lead", "Check the card in ClickUp against the press, then settle the row by hand "
      "(RUNBOOK, Brand Blueprint press drain).", "", status_col="state", kind_col="kind", kinds=BLUEPRINT_KINDS),
```

The notices limit is 30 minutes, not the plan's 15, because a kickoff waits up
to 20 minutes for Make by design (section 11, X7).

RUNBOOK content (plain rows: symptom, what to do, who):

- Doctor: `POST /functions/v1/cockpit-notices {"job":"doctor"}` with `x-cron-secret`; what each failure means.
- Dry run: `{"job":"dryRun","responseId":...}` and `{"job":"dryRun","kind":"blueprint.close","taskId":...,"facts":{...}}`.
- Rehearse: `{"job":"rehearse","to":"U..."}`, or `Send a test to me` in Settings, Notices and routing.
- An `unknown`: look in the channel for `Ref CN-xxxxxxxx`; found:
  `select public.cockpit_slack_notice_result('<id>','posted','<ts>','<channel>',null);`;
  not found: `select public.cockpit_slack_notice_fix('<id>','not_posted','<what you checked>');`, then requeue.
- A `failed`: fix the cause, then `select public.cockpit_slack_notice_fix('<id>','requeue',null);` (service role).
- The kick: `cockpit_sync_state` keys `slack-notices-kick`, `slack-notices-queue`, `creative-drain-kick`.
- The drain: a press `failed` after 30 minutes or after 3 refusals is pressed again from the card; a `reconcile` press is checked in ClickUp first.

`scripts/ship.sh` block:

```bash
# Slack notices and the Blueprint drain (docs/forms/STAGE1-CONTRACT.md): the outbox's
# states and triggers, the sender's text and receipts, the drain's refusals. Wrong is a
# kickoff nobody hears about, a notice posted twice, or a press that never runs.
if [ -f apps/media-buyer-cockpit/scripts/slack-notices-supabase.test.ts ]; then
  (cd apps/media-buyer-cockpit && bun test scripts/slack-notices-supabase.test.ts scripts/blueprints-supabase.test.ts >/dev/null 2>&1) \
    || { echo "the Slack notices or Brand Blueprint database tests fail"; exit 1; }
  (bun test supabase/functions/cockpit-notices supabase/functions/cockpit-creative-api supabase/functions/cockpit-media-api/slack.test.ts supabase/functions/cockpit-media-api/workflows.test.ts >/dev/null 2>&1) \
    || { echo "the notices sender, Blueprint drain or Slack receipt tests fail"; exit 1; }
  (cd apps/client-success-cockpit && bun test scripts/form-status.test.ts scripts/form-panel.test.tsx scripts/notices-routing.test.tsx scripts/blueprint-csm-line.test.ts >/dev/null 2>&1) \
    || { echo "the kickoff trail or notices settings tests fail"; exit 1; }
  (cd apps/creative-director-cockpit && bun test scripts/blueprint.test.tsx >/dev/null 2>&1) \
    || { echo "the creative director's Blueprint card tests fail"; exit 1; }
fi
```

---

## 8. File ownership

Every file has exactly one owner. A file not listed is not changed.

| File | Owner |
|---|---|
| `supabase/migrations/20261025n_slack_notices.sql` (new) | db-notices |
| `apps/media-buyer-cockpit/scripts/slack-notices-supabase.test.ts` (new) | db-notices |
| `supabase/migrations/20261025o_blueprint_close_drain.sql` (new) | db-blueprint |
| `apps/media-buyer-cockpit/scripts/blueprints-supabase.test.ts` | db-blueprint |
| `supabase/functions/cockpit-creative-api/index.ts` | db-blueprint |
| `supabase/functions/cockpit-creative-api/outbox.ts` | db-blueprint |
| `supabase/functions/cockpit-creative-api/blueprint.ts` | db-blueprint |
| `supabase/functions/cockpit-creative-api/drain.ts` (new) | db-blueprint |
| `supabase/functions/cockpit-creative-api/blueprint.test.ts` | db-blueprint |
| `supabase/functions/cockpit-creative-api/outbox.test.ts` | db-blueprint |
| `supabase/functions/cockpit-creative-api/drain.test.ts` (new) | db-blueprint |
| `supabase/functions/cockpit-notices/*` (all new: `index.ts`, `door.ts`, `run.ts`, `send.ts`, `reconcile.ts`, `doctor.ts`, `mentions.ts`, `text.ts`, `testkit.ts`, `deno.json`, `README.md`, `text.test.ts`, `door.test.ts`, `run.test.ts`, `receipt.test.ts`) | notices-fn |
| `supabase/functions/_shared/slackReceipt.ts` (new) | notices-fn |
| `supabase/functions/cockpit-csm-api/tools.ts` (append `slackTools`) | notices-fn |
| `supabase/functions/cockpit-media-api/execute.ts` | notices-fn |
| `supabase/functions/cockpit-media-api/slack.test.ts` (new) | notices-fn |
| `supabase/functions/cockpit-media-api/workflows.test.ts` (the Slack test at line 83 only) | notices-fn |
| `apps/client-success-cockpit/src/forms/kickoff.ts` | screens |
| `apps/client-success-cockpit/src/forms/formConfig.ts` | screens |
| `apps/client-success-cockpit/src/forms/formStatus.ts` | screens |
| `apps/client-success-cockpit/src/forms/FormPanel.tsx` | screens |
| `apps/client-success-cockpit/src/forms/useFormPanel.ts` | screens |
| `apps/client-success-cockpit/src/forms/useLiveForm.ts` | screens |
| `apps/client-success-cockpit/src/forms/FormWindow.tsx` | screens |
| `apps/client-success-cockpit/src/present/kickoffStop.ts` | screens |
| `apps/client-success-cockpit/src/present/KickoffSlide.tsx` | screens |
| `apps/client-success-cockpit/src/lib/notices.ts` (new) | screens |
| `apps/client-success-cockpit/src/lib/blueprintStatus.ts` | screens |
| `apps/client-success-cockpit/src/components/OnboardingKit.tsx` | screens |
| `apps/client-success-cockpit/src/components/NoticesRouting.tsx` (new) | screens |
| `apps/client-success-cockpit/src/pages/SettingsPage.tsx` | screens |
| `apps/client-success-cockpit/src/dev/formHarness.tsx` and new files under `src/dev/` | screens |
| `apps/client-success-cockpit/scripts/form-status.test.ts`, `form-panel.test.tsx`, `form-contract.test.ts`, `deck-kickoff.test.tsx`, `blueprint-csm-line.test.ts`, `csm-page.test.tsx`, `notices-routing.test.tsx` (new) | screens |
| `apps/creative-director-cockpit/src/lib/blueprint.ts` | screens |
| `apps/creative-director-cockpit/src/lib/notices.ts` (new) | screens |
| `apps/creative-director-cockpit/src/lib/creativeSourceModels.ts` | screens |
| `apps/creative-director-cockpit/src/components/BlueprintCard.tsx` | screens |
| `apps/creative-director-cockpit/src/components/BlueprintSettings.tsx` | screens |
| `apps/creative-director-cockpit/src/dev/blueprintFixtures.ts`, `src/dev/blueprintHarness.tsx` | screens |
| `apps/creative-director-cockpit/scripts/blueprint.test.tsx` | screens |
| `hermes/cockpit-guardian/checks/queues.py`, `checks/edge_functions.py`, `checks/pg_cron.py`, `README.md` | workers-docs |
| `hermes/cockpit-guardian/tests/test_checks_data.py`, `tests/test_hiring_sync.py` | workers-docs |
| `hermes/cockpit-sync/creativeProducer.ts`, `creative-fields.test.ts` (verify only) | workers-docs |
| `RUNBOOK.md` | workers-docs |
| `docs/csm-forms/KICKOFF.md`, `docs/brand-blueprint/SPEC.md` | workers-docs |
| `scripts/ship.sh`, `scripts/verify-cutover-readiness.py` | workers-docs |
| `docs/forms/STAGE1-CONTRACT.md`, `docs/forms/PLAN.md`, `docs/forms/maps/*` | the orchestrator (no builder edits them) |

Not touched by anyone: `apps/client-success-cockpit/src/present/blueprintBrief.ts`,
`src/present/BlueprintFields.tsx`, `src/present/deckHost.ts`,
`apps/creative-director-cockpit/src/lib/deckHost.ts`,
`supabase/functions/cockpit-media-api/slack.ts`, `tools.ts`,
`apps/media-buyer-cockpit/src/pages/AdminPage.tsx`, every other migration.

Hand-offs between roles (build to the contract, not to each other's code):

| Producer | Consumer | Interface |
|---|---|---|
| db-notices | notices-fn | the service RPCs of 2.1, `ClaimedRow`, `Mention`, facts (3) |
| db-notices | screens | the browser RPCs of 2.1, `NoticeView`, `SettingsRead` |
| db-blueprint | db-notices | the close result keys `mapPhase`, `mapSkipped`, `launchTaskId` (5.2); the trigger reads them from `result` |
| db-blueprint | screens | `blueprintCall` (2.2 item 4), outbox `attempts` |
| screens | db-notices | `BLUEPRINT_ON` stays byte for byte in `formStatus.ts` |
| db-notices, db-blueprint | workers-docs | table and column names in 2 for the guardian, RPC names for the RUNBOOK |
| notices-fn | db-blueprint | none: the creative API no longer posts to Slack |

---

## 9. Tests each builder runs green

Run from the worktree root unless a `cd` is shown. The PGlite tests follow
`apps/media-buyer-cockpit/scripts/csm-form-sends-supabase.test.ts` and
`launch-desk-supabase.test.ts`: `cockpitTestDb({supabaseDefaultPrivileges: true})`
(roles `anon`, `authenticated`, `service_role` BYPASSRLS, `auth.users`,
`auth.uid()` from `request.jwt.claim.sub`, members, audit log, the CEO gate),
`member()`, `actor()`, real definitions cut from their canonical migrations,
cut-down stand-ins with the live column names, invented people and clients.
PGlite has no pg_cron, vault or pg_net, so the guarded blocks skip; a test
asserts the kick returns NULL and writes its `cockpit_sync_state` note.

**db-notices**: `cd apps/media-buyer-cockpit && bun test scripts/slack-notices-supabase.test.ts`.
Fixtures cut from: `20260921e_tap_charges.sql` (`cockpit_sync_state`),
`20260919b_people.sql` (`cockpit_people`), `20261015210000_eod_radar.sql`
(`cockpit_eod_radar_slack_ids`), `20261005a_client_onboarding.sql` (the
onboarding table), `20260927s_creative_read_models.sql` (the outbox line),
`20261023a_csm_form_sends.sql`, `20261011c_csm_call_store.sql` (calls),
`20260927v` and `20261006c` (the CSM gate), `20260926m` or `20261017b`
(`cockpit_client_allowed`). It must cover: apply twice; table and function
privileges for `anon`, `authenticated`, `service_role` exactly as 2.1; the seed
(old kickoffs `skipped`, none `queued`); the kickoff trigger (new ID queues one
row, a re-publish does nothing, a new ID sets `second`, an old one is skipped, an
unreadable time is skipped, a broken insert does not raise and leaves the note);
the outbox trigger (sending to done and to reconcile each queue close and media
once, a second close none, reconcile to done and a later done after a reconcile
queue `blueprint.updated` once, an offer queues a child of the close); the
Typeform branch; the claim (the kickoff due rule both ways, off becomes muted,
replies wait, thread, top level and skip, a not-ready channel fails, `p_only`);
the results (posted and the channel rule, requeue keeps attempts, retry counts
to 3 then failed, every illegal move refused, unknown to posted, both fix
actions); the sweep (10-minute unknown, missed kickoff, close, offer,
`kickoff.updated`); the read gate (CSM of the client, another CSM refused,
creative of the client, media buyer refused, CEO, admin; no text or facts;
rehearsals hidden); settings (viewer and editor gates, a forms editor by table
row and by role, every patch refusal, the audit row's old and new, channels
add, remove-in-use refused, editors set only by CEO or admin); the browser
rehearse (editor only, one at a time, target resolved by the claim); mentions
(each seat rule, the systems manager by people role, a missing rule); and the
`BLUEPRINT_ON` pin (read `apps/client-success-cockpit/src/forms/formStatus.ts`
as text, extract the literal after `BLUEPRINT_ON =`, assert the migration holds
the same pattern inside `cockpit_slack_notice_card_done`).

**db-blueprint**:
`cd apps/media-buyer-cockpit && bun test scripts/blueprints-supabase.test.ts scripts/launch-desk-supabase.test.ts`
and `bun test supabase/functions/cockpit-creative-api`
and `cd apps/client-success-cockpit && bun test scripts/blueprint-brief.test.ts`.
`blueprints-supabase.test.ts` applies `20261025o` twice after `20261024a` in
`beforeAll`; its `close_route = 'slack'` tests change to the new refusal; new
cases: `blueprintCall` and `nudge` (true, and false with part 2, when Active,
with no call), `attempts` in the outbox JSON, `due` (window, 30-minute fail,
`p_apply = false` writes nothing, other kinds ignored), `load_for_actor` (equals
the presser's `get`; refuses a lost seat or client and a non-Blueprint row),
`refused` (counts, fails at 3, ignores non-pending), the outbox audit's
`source_system` with the setting and with the header, the kick's note.
`drain.test.ts`: due rows run; refused three times then failed; gate lost then
refused; `apply: false` writes nothing; the cron door's 401 before `getUser`,
its 400; a row no longer pending is skipped. `blueprint.test.ts`: no Slack or
Make step for any `closeRoute`; the result keys; the notices line; phase 6 skips
the map and the paste; phase 4 keeps both.

**notices-fn**: `bun test supabase/functions/cockpit-notices supabase/functions/cockpit-media-api/slack.test.ts supabase/functions/cockpit-media-api/workflows.test.ts`,
then `bun test supabase/functions/cockpit-creative-api` (read only, to see
`execute.ts` broke nothing), then the bundle check
`bun build supabase/functions/cockpit-notices/index.ts --target=browser --format=esm --external 'npm:*' --external 'jsr:*' --external 'node:*' --outfile <scratchpad>/cockpit-notices.js`.
`text.test.ts`: every row of the 4.5 table; escaping; no budget, answer, phone or
email key ever rendered; the role fallback for a mention; Kuwait time; the
already-live line; the rehearsal prefix and no tags; `text` ends with the Ref;
`SERVICE_LABEL` equals `blueprintBrief.ts`'s. `receipt.test.ts`: C and G must
match, U and W must return D, anything else not confirmed. `door.test.ts`: 405,
401 before the body is read, 400 for each malformed body, routing.
`run.test.ts` (fake fetch for Slack and ClickUp, fake RPC): kickoff complete
posts once; missing within 20 minutes requeues; after it, late; unread, late with
its line; a wrong `auth.test` user requeues all and posts nothing; rate limit is
`retry`; a break after the request left is `unknown`; a channel mismatch is
`unknown`; reconcile finds the Ref in history and in replies; permalink stored;
every call has its intent and response rows with `run_key`; an unresolved tag
is plain text plus the warning row; a rehearsal posts only to a `U` target and
records the `D` channel. `slack.test.ts`: the fake stores text the way Slack
does (URLs in `<>`, `mailto`, `&amp;`), and askViktorFor through
`executePlan` confirms; a history without the message or without `bot_id`
throws.

**screens**:
`cd apps/client-success-cockpit && bun test scripts/form-status.test.ts scripts/form-panel.test.tsx scripts/form-contract.test.ts scripts/deck-kickoff.test.tsx scripts/blueprint-csm-line.test.ts scripts/csm-page.test.tsx scripts/notices-routing.test.tsx && bunx biome check --line-ending=auto src && bun run tsc --project tsconfig.app.json --noEmit && bun run tsc --project tsconfig.node.json --noEmit`;
`cd apps/creative-director-cockpit && bun test scripts/blueprint.test.tsx && bunx biome check --line-ending=auto src && bun run tsc --project tsconfig.app.json --noEmit && bun run tsc --project tsconfig.node.json --noEmit`;
then `scripts/check-shared.sh`. The tests cover the new copy, the Slack stop in
every state, the native Blueprint button, the window link, no Slack stop in the
deck, the nudge rule and copy, the card's stops and refusals, Settings without
the switch, and the Notices and routing card read-only and as an editor
(channel add states, test states, refusals in place).

**workers-docs**: `cd hermes/cockpit-guardian && python3 -m unittest`;
`bun test hermes/cockpit-sync/creative-fields.test.ts`; `bash -n scripts/ship.sh`;
`python3 -c "import ast,sys; ast.parse(open('scripts/verify-cutover-readiness.py').read())"`;
and `bun test <path>` from the root for each file added to `RELEVANT_TEST_FILES`.

**The orchestrator, after all five**: every command above again, then
`apps/media-buyer-cockpit/scripts/csm-form-sends-supabase.test.ts` and the
existing creative and media function suites, `scripts/check-shared.sh`, and a
read of the two migrations together (`20261025n` then `20261025o`) applied twice
in one PGlite.

---

## 10. Checked for this contract (read only, 2026-10-25)

| Check | Result |
|---|---|
| Live `cockpit_blueprint_settings_set`, `cockpit_blueprint_sources`, `_payload`, `_part_done`, `_json`, `_settings_read`, `_settings_json`, `_seat`, `_outbox_settled` against `20261024a` | identical bodies (normalised diff); no drift |
| Live `cockpit_creative_outbox_audit`, `cockpit_creative_client_action` against `20260927s` | identical; the audit writes no `source_system` |
| `cockpit_creative_outbox` | 0 rows; states CHECK `pending, sending, done, failed, reconcile`; no `kind` CHECK; no `attempts`; triggers: the audit only |
| `cockpit_client_onboarding` | `forms` keys `onboarding` (42), `kickoff` (30), `blueprint` (1: Ardon, Typeform, 2026-09-13); kickoff object `form_id, response_id, submitted_at` (ISO text), `answers, payment, recording`; newest kickoff 2026-10-20, 0 within 48 hours; one trigger `cockpit_client_onboarding_native_audit` |
| `client_status` values | Stopped 27, Active 20, SALES TEAM TO CONTACT 14, GHOSTED 5, Brand Blueprint Booked♠️ 3, Ready For Launch🚀 1; the `BLUEPRINT_ON` pattern matches the last 24 |
| `cockpit_members.roles` | `text[]`, no CHECK; values in use `admin, call_center, ceo, creative, csm, editor, media_buyer, sales`; the only writer `cockpit_admin_upsert_member` keeps only `admin, media_buyer, csm, creative, editor, call_center` |
| Gates | `cockpit_has_role` (admin passes every role), `cockpit_is_ceo` (two founder addresses), `cockpit_client_allowed`, `cockpit_csm_client_gate` / `_for_actor`, `cockpit_blueprint_gate_for_actor(uuid,text,boolean)` all live as in the repo |
| `cockpit_people.role` | `Systems manager` exactly; seats resolve: creative `U0B2SHGS1JA`, CSM `U0C5JHUCTPG`, systems manager `U0AS90SHMH8`; the CEO has no Slack id row |
| `cockpit_csm_calls.kind` | CHECK `onboarding, blueprint, launch, checkin, other`; the nudge rule gives Makers, Alalia.co, Smmim studio |
| `cockpit_csm_form_sends` | PK `response_id`; `second boolean` |
| `cockpit_csm_provider_health` | `id, action_id (FK cockpit_csm_actions), method, resource, phase, http_status, object_id, created_at, provider (default clickup), run_key`; no `error`; service role insert and select only; Slack rows use `slack.com/api/{method}` |
| Vault | `appointments_webhook_secret, cockpit_sync_secret, creative_dashboard_sync_token, ghl_accounts, ghl_agency_token`; no anon key |
| pg_cron | 42 jobs; none named `mahara-slack-notices` or `mahara-creative-drain` |
| Collisions | no `cockpit_slack_*`, `cockpit_forms_*` object; no `20261025*` migration anywhere |
| Guardian | `queues.py` reads `status`; `test_hiring_sync.py` pins 22 jobs; `edge_functions.EXPECTED` lacks both functions |
| Repo | S6 fields present (`creativeProducer.ts:70-73`, test passes); the close result renders in `present/BlueprintFields.tsx`; the CD cockpit does not read `cockpit_blueprint_sources` today; `workflows.test.ts:83` feeds a history message without `bot_id` |

---

## 11. Decisions this contract adds or changes, with reasons

| # | Decision | Why |
|---|---|---|
| X1 | The editing right lives in `cockpit_forms_editors`, and the gate also honours a `forms_editor` role | The Admin page's save (`cockpit_admin_upsert_member`) keeps only six roles, so a `forms_editor` role would vanish on the next save, and the Admin page is outside Stage 1 |
| X2 | `mention_rule` is a `text[]` of seat rules; `mention_people` holds `cockpit_people` ids, not Slack ids | Kickoff late tags two seats; people resolve to Slack at send time, as the plan's rule says; the CEO has no cached Slack id |
| X3 | Variant rows `kickoff.late` and `kickoff.second` in the settings | They carry their own tags (CSM and systems manager; CSM) |
| X4 | Channel and people checks for editors are rows the sender checks within a minute, and "Send a test to me" is a queued rehearsal row; the function has no JWT path | Keeps every Slack call in one cron sender with one secret |
| X5 | The CSM's Blueprint Slack stop is on the Onboarding panel, not in the deck | The deck that renders the close is on the client's screen during the call |
| X6 | Links are mrkdwn links in a context block, not buttons | URL buttons send an interaction to an app with no interactivity set up |
| X7 | Guardian notices limit 30 minutes | A kickoff legitimately waits up to 20 minutes |
| X8 | Notice copy names roles ("Filled by the CSM", "Closed by the creative director"), not first names | The standing rule for anything the team sees |
| X9 | A receipt that is `ok` but fails the channel rule is `unknown`, never `failed` | It posted somewhere; `failed` would allow a resend |
| X10 | Outcome `retry` (counted) beside `requeue` (waiting) | The plan's `ratelimited`, plus breaks before the request left, without an endless loop |
| X11 | At map phase 5 or higher the close also leaves out the phase 5 paste, and the notice says so | A client already past phase 5 must not get the phase 5 message again |
| X12 | The kick functions run the sweep themselves and post only when there is work | One HTTP call a minute only when needed |
| X13 | `cockpit_creative_outbox_due(p_apply boolean DEFAULT true)` | The production dry run must write nothing |
| X14 | No Typeform Blueprint seed | An old record with key `blueprint:{task}:close` would silence that card's first native close |
| X15 | The SQL stage pattern is the TypeScript pattern exactly (contains, not anchored) | The plan's anchored version differs from `kickoffCardDone` |
| X16 | The close preview no longer quotes `slackCloseText` | The real post's text lives in `cockpit-notices/text.ts`; a quoted preview would not match it |
| X17 | An `unknown` notice reads "Not confirmed: {reason}." on every stop, not "Not posted"; "Tell the tech lead." is left off when the reason already names the tech lead (integration, 2026-10-25) | An unknown may already be in Slack (X9); "Not posted" beside "it is not sent again in case it arrived" contradicts itself |
