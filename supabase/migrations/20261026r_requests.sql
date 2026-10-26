-- Requests: ticketing for the whole team, routed from the cockpit
-- (docs/requests/CONTRACT.md section 2; PLAN D12, D17, D18, section 3.3).
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive; applies twice.
--
-- 1. cockpit_request_field_catalog and cockpit_request_templates: the
--    ClickUp folder fields a request type may write and the ClickUp template
--    objects (id and name only), refreshed hourly by cockpit-tasks.
-- 2. cockpit_request_types and cockpit_request_type_versions: the 31 types
--    (seeded by 20261026s), each with its parts (list, template, owner rule),
--    its questions, SOP steps, due days and priority. Editors (the CEO, an
--    admin or a seat they add) change any type in Requests settings; every
--    save is a new version and an audit row. A type is never deleted.
-- 3. cockpit_clickup_members and cockpit_member_clickup: the ClickUp
--    workspace members and which seat is which ClickUp user (by exact email
--    each hour, or set by an editor). An unlinked seat is "not linked".
-- 4. cockpit_requests and cockpit_request_parts: one row per request and
--    one per ClickUp task it makes. Each part is one cockpit_clickup_writeback_queue
--    row of the new kind 'request', written by clickup-writeback job
--    'requests' behind its own switch (CLICKUP_WRITEBACK_APPLY_REQUESTS).
--    The old 'log' claim never takes the new kinds; the requests job has its
--    own claim with one lane per ClickUp task.
-- 5. The browser RPCs (gate first), the service RPCs (the writer and the
--    task mirror), and a minute kick that posts the writer a run.
--
-- Row security is on for every new table, every browser and default grant is
-- revoked, and the service role may only read them: every write goes through
-- the SECURITY DEFINER functions below and leaves a cockpit_audit_log row
-- (source_app 'shared-cockpits'). pg_cron, pg_net and the vault are touched
-- only where they exist, so PGlite applies the file.
--
-- Operator notes
-- - Nothing reaches ClickUp unless the clickup-writeback secret
--   CLICKUP_WRITEBACK_APPLY_REQUESTS is exactly "true"; the canary
--   CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS narrows it to listed client cards.
-- - A request held as a dry run stays 'dry_run'. To send it after going live,
--   requeue its rows with a fresh plan (steps and progress cleared):
--     UPDATE public.cockpit_clickup_writeback_queue SET state='queued',attempts=0,next_attempt_at=now(),
--       planned=NULL,steps=NULL,progress='{}'::jsonb WHERE kind='request' AND state='dry_run' AND source_id='<request id>';

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_request_field_catalog (
  clickup_field_id uuid PRIMARY KEY,
  clickup_name     text NOT NULL CHECK (btrim(clickup_name) <> ''),
  kind             text NOT NULL CHECK (kind IN ('text','longtext','url','number','select')),
  label            text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  -- [{id, name}] for a select, NULL otherwise.
  options          jsonb CHECK (options IS NULL OR jsonb_typeof(options) = 'array'),
  -- missing: the hourly read of the field list no longer finds it.
  state            text NOT NULL DEFAULT 'ok' CHECK (state IN ('ok','missing')),
  read_at          timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'select' OR options IS NULL)
);

CREATE TABLE IF NOT EXISTS public.cockpit_request_templates (
  id      text PRIMARY KEY CHECK (id ~ '^t-[a-z0-9]{6,20}$'),
  name    text NOT NULL CHECK (btrim(name) <> ''),
  state   text NOT NULL DEFAULT 'ok' CHECK (state IN ('ok','missing')),
  seen_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cockpit_request_types (
  key                    text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  -- ClickUp's option order on the Request Type folder field.
  type_index             smallint NOT NULL UNIQUE CHECK (type_index BETWEEN 0 AND 99),
  label                  text NOT NULL CHECK (char_length(label) BETWEEN 3 AND 80),
  -- The option's name exactly as ClickUp holds it (stray spaces kept).
  clickup_option_name    text NOT NULL CHECK (clickup_option_name <> ''),
  request_type_option_id uuid NOT NULL UNIQUE,
  -- The team of the first part, kept equal by the guard.
  team                   text NOT NULL CHECK (team IN ('tech','ads','call_center','client_success','creative')),
  targets                jsonb NOT NULL CHECK (jsonb_typeof(targets) = 'array'),
  fields                 jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'array'),
  sop_steps              jsonb CHECK (sop_steps IS NULL OR jsonb_typeof(sop_steps) = 'array'),
  sop_steps_state        text NOT NULL CHECK (sop_steps_state IN ('none','source','draft','saved')),
  sop_url                text CHECK (sop_url IS NULL OR (sop_url ~ '^https://' AND char_length(sop_url) <= 500)),
  -- Working days, Sunday to Thursday.
  due_days               smallint NOT NULL CHECK (due_days BETWEEN 0 AND 60),
  priority               text NOT NULL CHECK (priority IN ('urgent','high','normal','low')),
  set_request_type       boolean NOT NULL DEFAULT false,
  enabled                boolean NOT NULL DEFAULT true,
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by             text NOT NULL CHECK (btrim(updated_by) <> ''),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cockpit_request_type_versions (
  key      text NOT NULL REFERENCES public.cockpit_request_types(key),
  version  integer NOT NULL CHECK (version >= 1),
  -- The whole type row as saved.
  "row"    jsonb NOT NULL CHECK (jsonb_typeof("row") = 'object'),
  saved_by text NOT NULL CHECK (btrim(saved_by) <> ''),
  saved_at timestamptz NOT NULL DEFAULT now(),
  note     text CHECK (note IS NULL OR char_length(note) <= 240),
  PRIMARY KEY (key, version)
);

CREATE TABLE IF NOT EXISTS public.cockpit_clickup_members (
  clickup_user_id bigint PRIMARY KEY,
  username        text,
  -- Lower case; never returned to a browser.
  email           text,
  active          boolean NOT NULL DEFAULT true,
  seen_at         timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cockpit_member_clickup (
  member_id       uuid PRIMARY KEY REFERENCES public.cockpit_members(id) ON DELETE CASCADE,
  clickup_user_id bigint,
  -- ok: matched by email; manual: set by an editor; cleared: an editor said no link.
  state           text NOT NULL CHECK (state IN ('ok','manual','not_found','ambiguous','cleared')),
  matched_by      text NOT NULL CHECK (matched_by IN ('email','editor')),
  note            text CHECK (note IS NULL OR char_length(note) <= 240),
  checked_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL CHECK (btrim(updated_by) <> ''),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((state IN ('ok','manual')) = (clickup_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS cockpit_member_clickup_user ON public.cockpit_member_clickup (clickup_user_id) WHERE clickup_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_requests (
  -- The browser's request id; an import row gets gen_random_uuid().
  id                  uuid PRIMARY KEY,
  type_key            text NOT NULL REFERENCES public.cockpit_request_types(key),
  type_version        integer NOT NULL CHECK (type_version >= 1),
  type_label          text NOT NULL,
  requester_member_id uuid REFERENCES public.cockpit_members(id),
  requester_email     text,
  requester_label     text NOT NULL,
  source              text NOT NULL CHECK (source IN ('requests_page','client_page','import')),
  client_task_id      text CHECK (client_task_id IS NULL OR client_task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name         text,
  answers             jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 32768),
  due_on              date,
  priority            text NOT NULL CHECK (priority IN ('urgent','high','normal','low')),
  state               text NOT NULL CHECK (state IN ('sending','dry_run','delivered','partial','failed','cancelled','imported','routed')),
  -- Set when every delivered part's ClickUp status type is done or closed.
  done_at             timestamptz,
  -- The All Tasks ticket this request routes.
  replaces_task_id    text CHECK (replaces_task_id IS NULL OR replaces_task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  imported_task_id    text UNIQUE,
  routed_to           uuid REFERENCES public.cockpit_requests(id),
  cancel_reason       text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 240),
  cancelled_by        text,
  -- md5 of type_key|client_task_id|answers::text|due_on|priority|replaces_task_id
  content_hash        text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'import') = (imported_task_id IS NOT NULL)),
  CHECK (source = 'import' OR requester_member_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS cockpit_requests_requester ON public.cockpit_requests (requester_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_requests_client ON public.cockpit_requests (client_task_id);
CREATE INDEX IF NOT EXISTS cockpit_requests_open_lifecycle ON public.cockpit_requests (type_key, client_task_id)
  WHERE state NOT IN ('cancelled','failed','routed') AND done_at IS NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_request_parts (
  request_id       uuid NOT NULL REFERENCES public.cockpit_requests(id),
  part             text NOT NULL CHECK (part ~ '^[a-z_]{2,20}$'),
  list_id          text NOT NULL,
  team             text NOT NULL CHECK (team IN ('tech','ads','call_center','client_success','creative','all_tasks')),
  template_id      text,
  template_name    text,
  task_name        text NOT NULL CHECK (char_length(task_name) <= 200),
  owner_rule       text NOT NULL CHECK (owner_rule IN ('systems_manager','csm_of_card','creative_strategist','media_buyer_of_record','person')),
  owner_clickup_id bigint,
  owner_how        text NOT NULL CHECK (owner_how IN ('named','card','rule','fallback','none','import')),
  owner_label      text NOT NULL,
  owner_note       text,
  -- Its cockpit_clickup_writeback_queue row.
  queue_id         uuid,
  state            text NOT NULL DEFAULT 'queued'
                     CHECK (state IN ('queued','sending','retry','unknown','delivered','dry_run','skipped','failed','imported')),
  error            text CHECK (error IS NULL OR char_length(error) <= 500),
  clickup_task_id  text,
  clickup_url      text,
  -- The 2-minute check.
  verify_state     text CHECK (verify_state IS NULL OR verify_state IN ('kept','restored','removed','moved')),
  verify_note      text,
  -- Mirrored from ClickUp by the task mirror (20261026t).
  status           text,
  status_type      text,
  assignee_ids     bigint[],
  mirrored_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, part)
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_request_parts_task ON public.cockpit_request_parts (clickup_task_id) WHERE clickup_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cockpit_request_parts_owner ON public.cockpit_request_parts (owner_clickup_id) WHERE owner_clickup_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cockpit_request_parts_queue ON public.cockpit_request_parts (queue_id) WHERE queue_id IS NOT NULL;

ALTER TABLE public.cockpit_request_field_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_request_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_request_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_request_type_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_clickup_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_member_clickup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_request_parts ENABLE ROW LEVEL SECURITY;
-- No policies: the browser reaches these only through the functions below.
REVOKE ALL ON public.cockpit_request_field_catalog, public.cockpit_request_templates, public.cockpit_request_types,
  public.cockpit_request_type_versions, public.cockpit_clickup_members, public.cockpit_member_clickup,
  public.cockpit_requests, public.cockpit_request_parts
  FROM PUBLIC, anon, authenticated, service_role;
-- The guardian and the workers read; every write goes through the definer functions.
GRANT SELECT ON public.cockpit_request_field_catalog, public.cockpit_request_templates, public.cockpit_request_types,
  public.cockpit_request_type_versions, public.cockpit_clickup_members, public.cockpit_member_clickup,
  public.cockpit_requests, public.cockpit_request_parts TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The writeback queue takes requests and task actions

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.cockpit_clickup_writeback_queue'::regclass
                    AND c.conname = 'cockpit_clickup_writeback_queue_kind_check'
                    AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%task_action%') THEN
    ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_queue_kind_check;
    ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
      CHECK (kind IN ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.cockpit_clickup_writeback_runs'::regclass
                    AND c.conname = 'cockpit_clickup_writeback_runs_job_check'
                    AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%requests%') THEN
    ALTER TABLE public.cockpit_clickup_writeback_runs DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_runs_job_check;
    ALTER TABLE public.cockpit_clickup_writeback_runs ADD CONSTRAINT cockpit_clickup_writeback_runs_job_check
      CHECK (job IN ('kpi','log','dosdonts','requests'));
  END IF;
END $$;

-- The live definitions (pg_get_functiondef, 2026-10-26) with 'requests' added
-- to their job lists. Nothing else changes.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_begin(p_job text, p_mode text, p_exclusive boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.cockpit_clickup_writeback_runs;
BEGIN
 IF p_job NOT IN('kpi','log','dosdonts','requests') OR p_mode NOT IN('dry_run','apply','apply_limited') THEN RAISE EXCEPTION 'Unsupported writeback run'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_clickup_writeback:'||p_job,0));
 UPDATE public.cockpit_clickup_writeback_runs SET finished_at=now(),ok=false,note=coalesce(note,'This run stopped without reporting back.')
 WHERE job=p_job AND finished_at IS NULL AND started_at<=now()-interval '15 minutes';
 IF p_exclusive THEN
  SELECT * INTO r FROM public.cockpit_clickup_writeback_runs WHERE job=p_job AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1;
  IF r.id IS NOT NULL THEN
   RETURN jsonb_build_object('id',NULL,'note','A '||p_job||' run that started at '||to_char(r.started_at AT TIME ZONE 'Asia/Kuwait','HH24:MI')||' Kuwait is still running.');
  END IF;
 END IF;
 INSERT INTO public.cockpit_clickup_writeback_runs(job,mode) VALUES(p_job,p_mode) RETURNING * INTO r;
 RETURN jsonb_build_object('id',r.id);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_idle(p_job text, p_ok boolean, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF p_job NOT IN('kpi','log','dosdonts','requests') THEN RETURN; END IF;
 PERFORM public.cockpit_clickup_writeback_state('clickup-writeback:'||p_job,p_ok,p_note,CASE WHEN p_ok THEN 0 END);
END $function$;

-- The live claim with one change: it never takes a request or a task action,
-- so the deployed log job never sees the new kinds.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_claim(p_token uuid, p_limit integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE out jsonb;
BEGIN
 IF p_token IS NULL THEN RAISE EXCEPTION 'A claim token is required'; END IF;
 -- A 'sending' claim older than ten minutes died mid-run: it is claimed again and read back first.
 WITH picked AS (
  SELECT q.id FROM public.cockpit_clickup_writeback_queue q
  WHERE ((q.state IN('queued','retry','unknown') AND q.next_attempt_at<=now())
     OR (q.state='sending' AND q.claimed_at<now()-interval '10 minutes'))
    AND q.kind NOT IN ('request','task_action')
  ORDER BY q.created_at
  LIMIT greatest(1,least(coalesce(p_limit,15),50))
  FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE public.cockpit_clickup_writeback_queue q
  SET state='sending',claim_token=p_token,claimed_at=now(),attempts=q.attempts+1,updated_at=now()
  FROM picked WHERE q.id=picked.id
  RETURNING q.*
 )
 SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('source_exists',CASE c.kind
   WHEN 'decision' THEN EXISTS(SELECT 1 FROM public.cockpit_decisions d WHERE d.id=c.source_id::bigint)
   WHEN 'manual_change' THEN EXISTS(SELECT 1 FROM public.cockpit_media_native_records r WHERE r.id=c.source_id::uuid)
   ELSE true END) ORDER BY c.created_at),'[]'::jsonb)
 INTO out FROM claimed c;
 RETURN out;
END $function$;

-- ---------------------------------------------------------------------------
-- 3. Internal helpers (no role may execute them)

-- The ClickUp lists a request may land on, in the order the screens use.
CREATE OR REPLACE FUNCTION public.cockpit_request_lists()
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT '[
    {"listId":"901816723190","team":"tech","label":"Operations / Tech","target":true},
    {"listId":"901816723196","team":"ads","label":"Marketing / ADs","target":true},
    {"listId":"901816723206","team":"call_center","label":"Call Center","target":true},
    {"listId":"901816723211","team":"client_success","label":"Client Success","target":true},
    {"listId":"901818016338","team":"creative","label":"Media/Creative","target":true},
    {"listId":"901816723226","team":"all_tasks","label":"All Tasks","target":false}
  ]'::jsonb
$$;

-- A team's label as ClickUp names its list.
CREATE OR REPLACE FUNCTION public.cockpit_request_team_label(p_team text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_team
    WHEN 'tech' THEN 'Operations / Tech'
    WHEN 'ads' THEN 'Marketing / ADs'
    WHEN 'call_center' THEN 'Call Center'
    WHEN 'client_success' THEN 'Client Success'
    WHEN 'creative' THEN 'Media/Creative'
    WHEN 'all_tasks' THEN 'All Tasks'
  END
$$;

-- The team of a target list; NULL for any other list (All Tasks included).
CREATE OR REPLACE FUNCTION public.cockpit_request_list_team(p_list_id text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x->>'team' FROM jsonb_array_elements(public.cockpit_request_lists()) x
   WHERE x->>'listId' = p_list_id AND (x->>'target')::boolean
$$;

-- The order the screens list teams in.
CREATE OR REPLACE FUNCTION public.cockpit_request_team_order(p_team text)
RETURNS integer LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_team WHEN 'client_success' THEN 1 WHEN 'tech' THEN 2 WHEN 'ads' THEN 3
                     WHEN 'creative' THEN 4 WHEN 'call_center' THEN 5 ELSE 6 END
$$;

-- The teams whose queue a seat sees.
CREATE OR REPLACE FUNCTION public.cockpit_request_teams(p_roles text[], p_ceo boolean)
RETURNS text[] LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(array_agg(t ORDER BY public.cockpit_request_team_order(t)), '{}'::text[])
    FROM unnest(ARRAY['client_success','tech','ads','creative','call_center']) AS t
   WHERE coalesce(p_ceo, false)
      OR (t IN ('client_success','call_center') AND 'csm' = ANY(coalesce(p_roles, '{}')))
      OR (t = 'ads' AND 'media_buyer' = ANY(coalesce(p_roles, '{}')))
      OR (t = 'creative' AND 'creative' = ANY(coalesce(p_roles, '{}')))
      OR (t = 'call_center' AND 'call_center' = ANY(coalesce(p_roles, '{}')))
      OR (t = 'tech' AND 'admin' = ANY(coalesce(p_roles, '{}')))
$$;

-- One audit row, as every write here leaves.
CREATE OR REPLACE FUNCTION public.cockpit_request_audit(p_action text, p_entity_type text, p_entity_id text, p_actor text,
  p_before jsonb, p_after jsonb, p_meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (p_action, p_entity_type, p_entity_id, p_actor, 'shared-cockpits',
          coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          p_before, p_after, coalesce(p_meta, '{}'::jsonb))
$$;

-- Who wrote a type or a version, as the team sees it.
CREATE OR REPLACE FUNCTION public.cockpit_request_by_label(p_by text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_by IS NULL OR btrim(p_by) = '' THEN RETURN 'the cockpit'; END IF;
  IF p_by = 'migration' THEN RETURN 'the first setup'; END IF;
  IF p_by = 'clickup-writeback' THEN RETURN 'the requests writer'; END IF;
  IF p_by = 'cockpit-tasks' THEN RETURN 'the task reader'; END IF;
  IF p_by LIKE '%@%' THEN RETURN coalesce(public.cockpit_slack_notice_role_of(p_by), 'a team member'); END IF;
  RETURN 'the cockpit';
END $$;

-- The signed-in seat (contract 2.4). Migration t calls it too.
CREATE OR REPLACE FUNCTION public.cockpit_request_seat()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid; v_auth uuid; v_email text; v_roles text[];
  v_ceo boolean; v_admin boolean; v_editor boolean := false; v_cu bigint;
BEGIN
  SELECT cm.id, cm.auth_user_id, cm.email, cm.roles INTO v_id, v_auth, v_email, v_roles
    FROM public.cockpit_members cm JOIN auth.users u ON u.id = cm.auth_user_id
   WHERE cm.active AND cm.auth_user_id = auth.uid() AND u.email_confirmed_at IS NOT NULL
     AND cm.email = lower(btrim(u.email))
   ORDER BY cm.updated_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sign in with an active seat to use requests.' USING ERRCODE = '42501';
  END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  v_admin := 'admin' = ANY(v_roles);
  BEGIN
    PERFORM public.cockpit_forms_editor_gate();
    v_editor := true;
  EXCEPTION WHEN insufficient_privilege THEN
    v_editor := false;
  END;
  SELECT l.clickup_user_id INTO v_cu FROM public.cockpit_member_clickup l
   WHERE l.member_id = v_id AND l.state IN ('ok','manual');
  RETURN jsonb_build_object('memberId', v_id, 'authUserId', v_auth, 'email', v_email, 'roles', to_jsonb(v_roles),
    'label', coalesce(public.cockpit_slack_notice_role_of(v_email), 'a team member'),
    'isCeo', v_ceo, 'isAdmin', v_admin, 'isEditor', v_editor,
    'clickupUserId', v_cu, 'link', CASE WHEN v_cu IS NULL THEN 'not_linked' ELSE 'linked' END,
    'teams', to_jsonb(public.cockpit_request_teams(v_roles, v_ceo)));
END $$;

-- A ClickUp member as the team sees them: their role, never their name.
CREATE OR REPLACE FUNCTION public.cockpit_request_owner_label(p_clickup bigint)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text; v_role text;
BEGIN
  IF p_clickup IS NULL THEN RETURN 'Nobody yet'; END IF;
  SELECT lower(btrim(c.email)) INTO v_email FROM public.cockpit_clickup_members c WHERE c.clickup_user_id = p_clickup;
  IF v_email IS NULL OR v_email = '' THEN RETURN 'a ClickUp member'; END IF;
  SELECT nullif(btrim(pp.role), '') INTO v_role FROM public.cockpit_people pp
   WHERE pp.active AND lower(btrim(pp.email)) = v_email ORDER BY pp.id LIMIT 1;
  IF v_role IS NOT NULL THEN
    RETURN CASE lower(v_role)
      WHEN 'systems manager' THEN 'the systems manager'
      WHEN 'creative strategist' THEN 'the creative strategist'
      WHEN 'client success manager' THEN 'the CSM'
      WHEN 'media buyer' THEN 'the media buyer'
      WHEN 'video editor' THEN 'a video editor'
      WHEN 'ceo' THEN 'the CEO'
      ELSE CASE WHEN v_role = upper(v_role) THEN 'the ' || v_role ELSE 'the ' || lower(v_role) END
    END;
  END IF;
  IF v_email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
     OR EXISTS (SELECT 1 FROM public.cockpit_members m WHERE m.active AND lower(btrim(m.email)) = v_email) THEN
    RETURN coalesce(public.cockpit_slack_notice_role_of(v_email), 'a ClickUp member');
  END IF;
  RETURN 'a ClickUp member';
END $$;

-- A named ClickUp id, unless the member list says that person has left.
CREATE OR REPLACE FUNCTION public.cockpit_request_usable_member(p_clickup bigint)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_clickup IS NULL THEN NULL
              WHEN EXISTS (SELECT 1 FROM public.cockpit_clickup_members c WHERE c.clickup_user_id = p_clickup AND NOT c.active) THEN NULL
              ELSE p_clickup END
$$;

-- The ClickUp id of the one active person with this role, by email.
CREATE OR REPLACE FUNCTION public.cockpit_request_person_by_role(p_role text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_emails text[]; v_ids bigint[];
BEGIN
  SELECT array_agg(DISTINCT lower(btrim(pp.email))) INTO v_emails FROM public.cockpit_people pp
   WHERE pp.active AND lower(btrim(pp.role)) = lower(btrim(p_role));
  IF coalesce(cardinality(v_emails), 0) <> 1 OR v_emails[1] IS NULL OR v_emails[1] = '' THEN RETURN NULL; END IF;
  SELECT array_agg(c.clickup_user_id) INTO v_ids FROM public.cockpit_clickup_members c
   WHERE c.active AND lower(btrim(c.email)) = v_emails[1];
  IF coalesce(cardinality(v_ids), 0) <> 1 THEN RETURN NULL; END IF;
  RETURN v_ids[1];
END $$;

-- Who owns a part (contract 2.4, owner rules). how and note show on the
-- preview and on every request row; nobody is ever assigned in silence.
CREATE OR REPLACE FUNCTION public.cockpit_request_owner(p_target jsonb, p_client_task text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rule text := p_target->>'owner_rule';
  v_named bigint;
  v_id bigint; v_how text; v_note text;
  v_csm text; v_ids bigint[]; v_setting text;
BEGIN
  IF jsonb_typeof(p_target->'owner_clickup_id') = 'number' THEN
    v_named := public.cockpit_request_usable_member((p_target->>'owner_clickup_id')::bigint);
  END IF;
  IF v_rule = 'person' THEN
    v_id := v_named; v_how := 'named';
  ELSIF v_rule = 'systems_manager' THEN
    IF v_named IS NOT NULL THEN v_id := v_named; v_how := 'named';
    ELSE v_id := public.cockpit_request_person_by_role('Systems manager'); v_how := 'rule'; END IF;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('clickupId', NULL, 'how', 'none', 'label', 'Nobody yet',
        'note', 'No owner could be found. The task goes to ClickUp without one; route it there.');
    END IF;
  ELSIF v_rule = 'creative_strategist' THEN
    IF v_named IS NOT NULL THEN v_id := v_named; v_how := 'named';
    ELSE v_id := public.cockpit_request_person_by_role('Creative strategist'); v_how := 'rule'; END IF;
  ELSIF v_rule = 'csm_of_card' THEN
    IF p_client_task IS NOT NULL THEN
      SELECT nullif(btrim(o.csm), '') INTO v_csm FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_client_task;
    END IF;
    IF v_csm IS NOT NULL THEN
      SELECT array_agg(DISTINCT c.clickup_user_id) INTO v_ids FROM public.cockpit_clickup_members c
       WHERE c.active AND lower(btrim(c.username)) = lower(v_csm)
         AND EXISTS (SELECT 1 FROM public.cockpit_members m
                      WHERE m.active AND 'csm' = ANY(m.roles) AND lower(btrim(m.email)) = lower(btrim(c.email)));
      IF coalesce(cardinality(v_ids), 0) = 1 THEN
        v_id := v_ids[1]; v_how := 'card'; v_note := 'The CSM named on the client card.';
      END IF;
    END IF;
    IF v_id IS NULL AND v_named IS NOT NULL THEN v_id := v_named; v_how := 'named'; END IF;
    IF v_id IS NULL THEN v_id := public.cockpit_request_person_by_role('Client success manager'); v_how := 'rule'; END IF;
  ELSIF v_rule = 'media_buyer_of_record' THEN
    IF v_named IS NOT NULL THEN v_id := v_named; v_how := 'named';
    ELSE
      SELECT s.value INTO v_setting FROM public.cockpit_blueprint_settings s WHERE s.key = 'launch_assignee';
      IF btrim(coalesce(v_setting, '')) ~ '^[0-9]{1,18}$' THEN
        v_id := public.cockpit_request_usable_member(btrim(v_setting)::bigint); v_how := 'rule';
      END IF;
    END IF;
    IF v_id IS NULL THEN
      v_id := public.cockpit_request_person_by_role('Systems manager');
      IF v_id IS NULL THEN
        RETURN jsonb_build_object('clickupId', NULL, 'how', 'none', 'label', 'Nobody yet',
          'note', 'No owner could be found. The task goes to ClickUp without one; route it there.');
      END IF;
      RETURN jsonb_build_object('clickupId', v_id, 'how', 'fallback', 'label', public.cockpit_request_owner_label(v_id),
        'note', 'No media buyer of record is set, so the systems manager gets it. Set one in Requests settings.');
    END IF;
  END IF;
  IF v_id IS NULL THEN
    v_id := public.cockpit_request_person_by_role('Systems manager');
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('clickupId', NULL, 'how', 'none', 'label', 'Nobody yet',
        'note', 'No owner could be found. The task goes to ClickUp without one; route it there.');
    END IF;
    RETURN jsonb_build_object('clickupId', v_id, 'how', 'fallback', 'label', public.cockpit_request_owner_label(v_id),
      'note', 'Nobody matched this rule, so the systems manager gets it.');
  END IF;
  RETURN jsonb_build_object('clickupId', v_id, 'how', v_how, 'label', public.cockpit_request_owner_label(v_id), 'note', v_note);
END $$;

-- Today in Kuwait plus that many Sunday-to-Thursday days (0 is today).
CREATE OR REPLACE FUNCTION public.cockpit_request_due_default(p_days integer)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_day date := (now() AT TIME ZONE 'Asia/Kuwait')::date; v_n integer := 0;
BEGIN
  WHILE v_n < greatest(coalesce(p_days, 0), 0) LOOP
    v_day := v_day + 1;
    IF extract(dow FROM v_day) NOT IN (5, 6) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_day;
END $$;

-- A Kuwait day as the screens and the description write it ("Wed 28 Oct").
CREATE OR REPLACE FUNCTION public.cockpit_request_day_words(p_day date)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_char(p_day, 'Dy FMDD Mon')
$$;

-- What a type's problem is, as one sentence an editor can act on; NULL when
-- it has none (contract 2.2). People and templates are checked by the save.
CREATE OR REPLACE FUNCTION public.cockpit_request_type_problem(p jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_targets jsonb := p->'targets';
  v_fields jsonb := p->'fields';
  v_t jsonb; v_f jsonb; v_o jsonb; v_s jsonb; v_w jsonb;
  v_parts text[] := '{}'; v_keys text[] := '{}';
  v_part text; v_label text; v_kind text; v_team text; v_list text; v_key text;
  v_cat_kind text; v_cat_options jsonb; v_opts jsonb;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_target_keys constant text[] := ARRAY['part','name_suffix','list_id','team','template_id','template_name','owner_rule','owner_clickup_id','when'];
  v_field_keys constant text[] := ARRAY['key','label','kind','clickup_field_id','required','options','help'];
BEGIN
  IF coalesce(p->>'key', '') !~ '^[a-z][a-z0-9_]{2,40}$' THEN
    RETURN 'The key must be 3 to 41 lower case letters, numbers and underscores, starting with a letter.';
  END IF;
  IF jsonb_typeof(p->'type_index') IS DISTINCT FROM 'number' OR (p->>'type_index')::numeric NOT BETWEEN 0 AND 99 THEN
    RETURN 'The ClickUp option position must be 0 to 99.';
  END IF;
  IF char_length(coalesce(p->>'label', '')) NOT BETWEEN 3 AND 80 OR btrim(p->>'label') = '' THEN
    RETURN 'The name must be 3 to 80 characters.';
  END IF;
  IF coalesce(p->>'clickup_option_name', '') = '' OR coalesce(p->>'request_type_option_id', '') !~ v_uuid THEN
    RETURN 'The ClickUp Request Type option is missing.';
  END IF;
  IF coalesce(p->>'priority', '') NOT IN ('urgent','high','normal','low') THEN
    RETURN 'Pick a priority: urgent, high, normal or low.';
  END IF;
  IF jsonb_typeof(p->'due_days') IS DISTINCT FROM 'number' OR (p->>'due_days')::numeric NOT BETWEEN 0 AND 60 THEN
    RETURN 'Due in must be 0 to 60 working days.';
  END IF;
  IF p->'sop_url' IS NOT NULL AND jsonb_typeof(p->'sop_url') <> 'null'
     AND (jsonb_typeof(p->'sop_url') <> 'string' OR p->>'sop_url' !~ '^https://' OR char_length(p->>'sop_url') > 500) THEN
    RETURN 'The SOP link must start with https:// and be under 500 characters.';
  END IF;

  -- Questions.
  IF jsonb_typeof(v_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(v_fields) NOT BETWEEN 1 AND 20 THEN
    RETURN 'Add between 1 and 20 questions.';
  END IF;
  FOR v_f IN SELECT e FROM jsonb_array_elements(v_fields) WITH ORDINALITY AS x(e, o) ORDER BY o LOOP
    IF jsonb_typeof(v_f) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_f) k WHERE k <> ALL (v_field_keys)) THEN
      RETURN 'A question has the wrong shape. Reload and try again.';
    END IF;
    v_key := v_f->>'key';
    IF jsonb_typeof(v_f->'key') IS DISTINCT FROM 'string' OR v_key !~ '^[a-z][a-z0-9_]{1,40}$' THEN
      RETURN 'Each question needs a key of lower case letters, numbers and underscores.';
    END IF;
    IF v_key = ANY(v_keys) THEN RETURN 'Two questions share the key ' || v_key || '.'; END IF;
    v_keys := v_keys || v_key;
    v_label := btrim(coalesce(v_f->>'label', ''));
    IF jsonb_typeof(v_f->'label') IS DISTINCT FROM 'string' OR char_length(v_label) NOT BETWEEN 1 AND 80 THEN
      RETURN v_key || ': the question needs a label of 1 to 80 characters.';
    END IF;
    v_kind := v_f->>'kind';
    IF coalesce(v_kind, '') NOT IN ('client','details','text','longtext','url','number','select','deadline','priority') THEN
      RETURN v_label || ': pick a question type.';
    END IF;
    IF v_kind IN ('client','deadline','priority') AND v_key <> v_kind THEN
      RETURN v_label || ': this question must use the key ' || v_kind || '.';
    END IF;
    IF jsonb_typeof(v_f->'required') IS DISTINCT FROM 'boolean' THEN
      RETURN v_label || ': say whether it is required.';
    END IF;
    IF v_f->'help' IS NOT NULL AND jsonb_typeof(v_f->'help') <> 'null'
       AND (jsonb_typeof(v_f->'help') <> 'string' OR char_length(v_f->>'help') > 140) THEN
      RETURN v_label || ': keep the help line under 140 characters.';
    END IF;
    v_cat_kind := NULL; v_cat_options := NULL;
    IF v_f->'clickup_field_id' IS NOT NULL AND jsonb_typeof(v_f->'clickup_field_id') <> 'null' THEN
      IF coalesce(v_f->>'clickup_field_id', '') !~ v_uuid THEN
        RETURN v_label || ': that ClickUp field is not in the field list.';
      END IF;
      SELECT c.kind, c.options INTO v_cat_kind, v_cat_options FROM public.cockpit_request_field_catalog c
       WHERE c.clickup_field_id = (v_f->>'clickup_field_id')::uuid;
      IF v_cat_kind IS NULL THEN RETURN v_label || ': that ClickUp field is not in the field list.'; END IF;
      IF v_cat_kind <> v_kind THEN RETURN v_label || ': the ClickUp field holds a different kind of answer.'; END IF;
    END IF;
    IF v_kind = 'select' AND v_cat_kind IS NULL THEN
      IF jsonb_typeof(v_f->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(v_f->'options') = 0 THEN
        RETURN v_label || ': a choice question needs its choices.';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_f->'options') o
                  WHERE jsonb_typeof(o) IS DISTINCT FROM 'object' OR coalesce(o->>'id', '') !~ '^[a-z0-9_-]{1,40}$'
                     OR btrim(coalesce(o->>'name', '')) = '') THEN
        RETURN v_label || ': each choice needs an id of lower case letters, numbers, - or _ and a name.';
      END IF;
      IF (SELECT count(*) <> count(DISTINCT o->>'id') FROM jsonb_array_elements(v_f->'options') o) THEN
        RETURN v_label || ': two choices share an id.';
      END IF;
    ELSIF v_f->'options' IS NOT NULL AND jsonb_typeof(v_f->'options') <> 'null' THEN
      RETURN v_label || ': only a choice question without a ClickUp field lists its own choices.';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(v_fields) f WHERE f->>'kind' = 'deadline') <> 1 THEN
    RETURN 'The form needs exactly one due day question.';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_fields) f WHERE f->>'kind' = 'priority') <> 1 THEN
    RETURN 'The form needs exactly one priority question.';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_fields) f WHERE f->>'kind' = 'client') > 1 THEN
    RETURN 'The form can ask for the client only once.';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_fields) f WHERE f->>'kind' = 'details') > 1 THEN
    RETURN 'The form can have only one details question.';
  END IF;

  -- Parts.
  IF jsonb_typeof(v_targets) IS DISTINCT FROM 'array' OR jsonb_array_length(v_targets) NOT BETWEEN 1 AND 3 THEN
    RETURN 'Pick between 1 and 3 parts.';
  END IF;
  FOR v_t IN SELECT e FROM jsonb_array_elements(v_targets) WITH ORDINALITY AS x(e, o) ORDER BY o LOOP
    IF jsonb_typeof(v_t) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_t) k WHERE k <> ALL (v_target_keys)) THEN
      RETURN 'A part has the wrong shape. Reload and try again.';
    END IF;
    v_part := v_t->>'part';
    IF jsonb_typeof(v_t->'part') IS DISTINCT FROM 'string' OR v_part !~ '^[a-z_]{2,20}$' THEN
      RETURN 'Each part needs a short name of 2 to 20 lower case letters.';
    END IF;
    IF v_part = ANY(v_parts) THEN RETURN 'Two parts share the name ' || v_part || '.'; END IF;
    v_parts := v_parts || v_part;
    v_team := public.cockpit_request_list_team(v_t->>'list_id');
    IF v_team IS NULL THEN RETURN 'The ' || v_part || ' part needs one of the five team boards.'; END IF;
    v_list := public.cockpit_request_team_label(v_team);
    IF v_t->>'team' IS DISTINCT FROM v_team THEN RETURN 'The ' || v_list || ' part has the wrong team for its board.'; END IF;
    IF jsonb_typeof(v_t->'name_suffix') IS DISTINCT FROM 'string' OR char_length(v_t->>'name_suffix') > 40 THEN
      RETURN 'The ' || v_list || ' part''s name ending must be text under 40 characters.';
    END IF;
    IF v_t->'template_id' IS NOT NULL AND jsonb_typeof(v_t->'template_id') <> 'null' THEN
      IF jsonb_typeof(v_t->'template_id') <> 'string' OR v_t->>'template_id' !~ '^t-[a-z0-9]{6,20}$' THEN
        RETURN 'The ' || v_list || ' part has a template id ClickUp would not know.';
      END IF;
      IF jsonb_typeof(v_t->'template_name') IS DISTINCT FROM 'string' OR btrim(v_t->>'template_name') = ''
         OR char_length(v_t->>'template_name') > 200 THEN
        RETURN 'The ' || v_list || ' part needs its template''s name.';
      END IF;
    ELSIF v_t->'template_name' IS NOT NULL AND jsonb_typeof(v_t->'template_name') <> 'null' THEN
      RETURN 'The ' || v_list || ' part names a template but has no template id.';
    END IF;
    IF coalesce(v_t->>'owner_rule', '') NOT IN ('systems_manager','csm_of_card','creative_strategist','media_buyer_of_record','person') THEN
      RETURN 'The ' || v_list || ' part needs an owner rule.';
    END IF;
    IF v_t->'owner_clickup_id' IS NOT NULL AND jsonb_typeof(v_t->'owner_clickup_id') <> 'null'
       AND (jsonb_typeof(v_t->'owner_clickup_id') <> 'number' OR v_t->>'owner_clickup_id' !~ '^[1-9][0-9]{0,17}$') THEN
      RETURN 'The ' || v_list || ' part has an owner ClickUp would not know.';
    END IF;
    IF v_t->>'owner_rule' = 'person' AND jsonb_typeof(v_t->'owner_clickup_id') IS DISTINCT FROM 'number' THEN
      RETURN 'Pick the person who owns the ' || v_list || ' part.';
    END IF;
    v_w := v_t->'when';
    IF v_w IS NOT NULL AND jsonb_typeof(v_w) <> 'null' THEN
      IF jsonb_typeof(v_w) <> 'object' OR jsonb_typeof(v_w->'options') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_w->'options') = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_w->'options') o WHERE jsonb_typeof(o) <> 'string') THEN
        RETURN 'The ' || v_list || ' part''s "runs when" choice has the wrong shape.';
      END IF;
      SELECT f INTO v_f FROM jsonb_array_elements(v_fields) f WHERE f->>'key' = v_w->>'field_key' LIMIT 1;
      IF v_f IS NULL THEN
        RETURN 'The ' || v_list || ' part decides when it runs from a question that is not on this form.';
      END IF;
      IF v_f->>'kind' <> 'select' THEN
        RETURN 'The ' || v_list || ' part decides when it runs from ' || (v_f->>'label') || ', which is not a choice question.';
      END IF;
      IF v_f->>'clickup_field_id' IS NOT NULL THEN
        SELECT c.options INTO v_opts FROM public.cockpit_request_field_catalog c WHERE c.clickup_field_id = (v_f->>'clickup_field_id')::uuid;
      ELSE
        v_opts := v_f->'options';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_w->'options') w
                  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_opts, '[]'::jsonb)) o WHERE o->>'id' = w)) THEN
        RETURN 'The ' || v_list || ' part runs on a choice that is not one of ' || (v_f->>'label') || '.';
      END IF;
      v_f := NULL;
    END IF;
  END LOOP;

  -- SOP steps.
  v_s := p->'sop_steps';
  IF v_s IS NOT NULL AND jsonb_typeof(v_s) <> 'null' THEN
    IF jsonb_typeof(v_s) <> 'array' OR jsonb_array_length(v_s) NOT BETWEEN 1 AND 40 THEN
      RETURN 'SOP steps: add between 1 and 40 steps, or none.';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_s) s
                WHERE jsonb_typeof(s) <> 'string' OR char_length(s #>> '{}') NOT BETWEEN 1 AND 300 OR btrim(s #>> '{}') = '') THEN
      RETURN 'SOP steps: each step needs 1 to 300 characters.';
    END IF;
    IF coalesce(p->>'sop_steps_state', '') NOT IN ('source','draft','saved') THEN
      RETURN 'SOP steps: say whether they are a draft or saved.';
    END IF;
  ELSIF coalesce(p->>'sop_steps_state', '') <> 'none' THEN
    RETURN 'SOP steps: there are no steps, so there is nothing to check.';
  END IF;
  RETURN NULL;
END $$;

-- The choices a question offers: ClickUp's for a ClickUp field ([] when the
-- hourly read no longer finds it), the question's own otherwise.
CREATE OR REPLACE FUNCTION public.cockpit_request_field_options(f jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state text; v_opts jsonb;
BEGIN
  IF f->>'kind' IS DISTINCT FROM 'select' THEN RETURN NULL; END IF;
  IF f->>'clickup_field_id' IS NULL THEN
    RETURN CASE WHEN jsonb_typeof(f->'options') = 'array' THEN f->'options' ELSE '[]'::jsonb END;
  END IF;
  SELECT c.state, c.options INTO v_state, v_opts FROM public.cockpit_request_field_catalog c
   WHERE c.clickup_field_id::text = f->>'clickup_field_id';
  IF v_state IS DISTINCT FROM 'ok' THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', o->>'id', 'name', o->>'name') ORDER BY n)
                     FROM jsonb_array_elements(v_opts) WITH ORDINALITY AS x(o, n)), '[]'::jsonb);
END $$;

-- An answer is given: present, not null, and not blank text.
CREATE OR REPLACE FUNCTION public.cockpit_request_answered(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT v IS NOT NULL AND jsonb_typeof(v) <> 'null'
     AND (jsonb_typeof(v) <> 'string' OR btrim(v #>> '{}') <> '')
$$;

-- An answer as the description and the screens show it.
CREATE OR REPLACE FUNCTION public.cockpit_request_answer_display(f jsonb, v jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name text;
BEGIN
  IF NOT public.cockpit_request_answered(v) THEN RETURN NULL; END IF;
  IF f->>'kind' = 'select' THEN
    SELECT o->>'name' INTO v_name FROM jsonb_array_elements(public.cockpit_request_field_options(f)) o
     WHERE o->>'id' = v #>> '{}' LIMIT 1;
    IF v_name IS NULL AND f->>'clickup_field_id' IS NOT NULL THEN
      SELECT o->>'name' INTO v_name FROM public.cockpit_request_field_catalog c, jsonb_array_elements(c.options) o
       WHERE c.clickup_field_id::text = f->>'clickup_field_id' AND o->>'id' = v #>> '{}' LIMIT 1;
    END IF;
    RETURN coalesce(v_name, v #>> '{}');
  END IF;
  RETURN btrim(v #>> '{}');
END $$;

-- An answer as ClickUp takes it: the option id, the number, or the text.
CREATE OR REPLACE FUNCTION public.cockpit_request_answer_value(f jsonb, v jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.cockpit_request_answered(v) THEN RETURN NULL; END IF;
  IF f->>'kind' = 'number' AND btrim(v #>> '{}') ~ '^[0-9]{1,4}$' THEN RETURN to_jsonb(btrim(v #>> '{}')::integer); END IF;
  IF f->>'kind' = 'select' THEN RETURN to_jsonb(v #>> '{}'); END IF;
  RETURN to_jsonb(btrim(v #>> '{}'));
END $$;

-- Whether a part runs for these answers (its "runs when" choice holds).
CREATE OR REPLACE FUNCTION public.cockpit_request_target_runs(t jsonb, p_answers jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t->'when' IS NULL OR jsonb_typeof(t->'when') = 'null'
      OR coalesce(p_answers->>(t->'when'->>'field_key'), '') IN (SELECT jsonb_array_elements_text(t->'when'->'options'))
$$;

-- How many SOP steps a part adds itself: the steps' count when it has no
-- template, NULL when the template carries them.
CREATE OR REPLACE FUNCTION public.cockpit_request_step_count(p_type public.cockpit_request_types, t jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN t->>'template_id' IS NOT NULL THEN NULL
              ELSE coalesce(jsonb_array_length(p_type.sop_steps), 0) END
$$;

-- What a rule is called on a part.
CREATE OR REPLACE FUNCTION public.cockpit_request_rule_label(t jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN CASE t->>'owner_rule'
    WHEN 'systems_manager' THEN 'the systems manager'
    WHEN 'csm_of_card' THEN 'the client''s CSM'
    WHEN 'creative_strategist' THEN 'the creative strategist'
    WHEN 'media_buyer_of_record' THEN 'the media buyer of record'
    WHEN 'person' THEN public.cockpit_request_owner_label(CASE WHEN jsonb_typeof(t->'owner_clickup_id') = 'number'
                                                               THEN (t->>'owner_clickup_id')::bigint END)
  END;
END $$;

-- A type as the form and Requests settings read it (TypeView, contract 2.5).
CREATE OR REPLACE FUNCTION public.cockpit_request_type_view(t public.cockpit_request_types, p_editor boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; v_fields jsonb; v_parts jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', f->>'key', 'label', f->>'label', 'kind', f->>'kind',
           'required', coalesce((f->>'required')::boolean, false), 'options', public.cockpit_request_field_options(f),
           'help', CASE WHEN jsonb_typeof(f->'help') = 'string' THEN f->'help' END) ORDER BY n), '[]'::jsonb)
    INTO v_fields FROM jsonb_array_elements(t.fields) WITH ORDINALITY AS x(f, n);
  SELECT coalesce(jsonb_agg(jsonb_build_object('part', g->>'part',
           'listName', public.cockpit_request_team_label(g->>'team'), 'teamLabel', public.cockpit_request_team_label(g->>'team'),
           'ruleLabel', public.cockpit_request_rule_label(g),
           'templateName', CASE WHEN g->>'template_id' IS NOT NULL THEN g->>'template_name' END,
           'stepCount', public.cockpit_request_step_count(t, g),
           'stepsDraft', g->>'template_id' IS NULL AND t.sop_steps IS NOT NULL AND t.sop_steps_state = 'draft') ORDER BY n), '[]'::jsonb)
    INTO v_parts FROM jsonb_array_elements(t.targets) WITH ORDINALITY AS x(g, n);
  v := jsonb_build_object('key', t.key, 'label', t.label, 'team', t.team, 'teamLabel', public.cockpit_request_team_label(t.team),
    'enabled', t.enabled, 'dueDays', t.due_days,
    'dueDefault', to_char(public.cockpit_request_due_default(t.due_days), 'YYYY-MM-DD'),
    'priority', t.priority, 'fields', v_fields, 'parts', v_parts, 'sopUrl', t.sop_url);
  IF coalesce(p_editor, false) THEN
    v := v || jsonb_build_object('version', t.version, 'typeIndex', t.type_index, 'clickupOptionName', t.clickup_option_name,
      'targets', t.targets, 'sopSteps', t.sop_steps, 'sopStepsState', t.sop_steps_state,
      'setRequestType', t.set_request_type, 'updatedByLabel', public.cockpit_request_by_label(t.updated_by),
      'updatedAt', t.updated_at,
      -- The questions as stored, with their ClickUp field ids, so an editor
      -- changes them without dropping a mapping.
      'fieldSpecs', t.fields);
  END IF;
  RETURN v;
END $$;

-- The parts a request makes, each with its frozen queue payload (contract
-- 2.4 and 2.6). The preview and the submit both read it, so a preview
-- always matches the send. p_request NULL (a preview) leaves the ref and
-- the request link out.
CREATE OR REPLACE FUNCTION public.cockpit_request_plan(p_type public.cockpit_request_types, p_request uuid, p_client_task text,
  p_client_name text, p_answers jsonb, p_due date, p_priority text, p_requester_label text, p_replaces text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_answers jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END;
  v_due date := coalesce(p_due, public.cockpit_request_due_default(p_type.due_days));
  v_priority text := coalesce(p_priority, p_type.priority);
  v_client text := nullif(btrim(coalesce(p_client_name, '')), '');
  v_card text := p_client_task;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_url text := CASE WHEN p_request IS NOT NULL THEN 'https://cockpit.maharamedia.com/requests?id=' || p_request::text END;
  v_hex text := CASE WHEN p_request IS NOT NULL THEN left(replace(p_request::text, '-', ''), 10) END;
  v_requester text := coalesce(nullif(btrim(p_requester_label), ''), 'a team member');
  v_has_steps boolean := p_type.sop_steps IS NOT NULL AND jsonb_array_length(p_type.sop_steps) > 0;
  v_details text; v_bullets text; v_fields jsonb; v_t jsonb; v_out jsonb := '[]'::jsonb;
  v_owner jsonb; v_name text; v_when text; v_steps jsonb; v_checklist text; v_tail text[]; v_desc text;
  v_first boolean := true; v_head text;
BEGIN
  SELECT public.cockpit_request_answer_display(f, v_answers->(f->>'key')) INTO v_details
    FROM jsonb_array_elements(p_type.fields) f WHERE f->>'kind' = 'details' LIMIT 1;
  SELECT string_agg('- ' || (f->>'label') || ': ' || public.cockpit_request_answer_display(f, v_answers->(f->>'key')), E'\n' ORDER BY n)
    INTO v_bullets FROM jsonb_array_elements(p_type.fields) WITH ORDINALITY AS x(f, n)
   WHERE f->>'kind' NOT IN ('client','details','deadline','priority') AND public.cockpit_request_answered(v_answers->(f->>'key'));
  SELECT coalesce(jsonb_agg(jsonb_build_object('fieldId', f->>'clickup_field_id', 'kind', f->>'kind',
           'value', public.cockpit_request_answer_value(f, v_answers->(f->>'key')), 'label', f->>'label',
           'display', public.cockpit_request_answer_display(f, v_answers->(f->>'key'))) ORDER BY n), '[]'::jsonb)
    INTO v_fields FROM jsonb_array_elements(p_type.fields) WITH ORDINALITY AS x(f, n)
   WHERE f->>'clickup_field_id' IS NOT NULL AND public.cockpit_request_answered(v_answers->(f->>'key'));
  v_head := '**' || p_type.label || '** for ' || coalesce(v_client, 'no client') || E'\n'
    || 'Requested by ' || v_requester || ' in the cockpit on ' || public.cockpit_request_day_words(v_today)
    || '. Due ' || public.cockpit_request_day_words(v_due) || '. Priority ' || v_priority || '.';

  FOR v_t IN SELECT e FROM jsonb_array_elements(p_type.targets) WITH ORDINALITY AS x(e, n) ORDER BY n LOOP
    IF NOT public.cockpit_request_target_runs(v_t, v_answers) THEN CONTINUE; END IF;
    v_owner := public.cockpit_request_owner(v_t, p_client_task);
    v_name := left(CASE WHEN v_client IS NOT NULL THEN v_client || ' - ' || p_type.label || coalesce(v_t->>'name_suffix', '')
                        ELSE p_type.label || coalesce(v_t->>'name_suffix', '') || ' - from ' || v_requester END, 200);
    v_when := CASE WHEN NOT v_has_steps THEN NULL
                   WHEN v_t->>'template_id' IS NULL THEN 'always'
                   ELSE 'if_template_empty' END;
    v_steps := CASE WHEN v_when IS NOT NULL THEN p_type.sop_steps END;
    v_checklist := CASE WHEN v_when IS NULL THEN NULL
                        WHEN p_type.sop_steps_state = 'draft' THEN 'SOP steps (draft)' ELSE 'SOP steps' END;
    v_tail := '{}';
    IF p_type.sop_url IS NOT NULL THEN v_tail := v_tail || ('SOP: ' || p_type.sop_url); END IF;
    IF p_type.sop_steps_state = 'draft' AND v_when IS NOT NULL THEN
      v_tail := v_tail || 'SOP steps are a draft until the systems manager checks them.'::text;
    END IF;
    IF v_card IS NOT NULL THEN v_tail := v_tail || ('Client card: https://app.clickup.com/t/' || v_card); END IF;
    IF v_url IS NOT NULL THEN v_tail := v_tail || ('Request in the cockpit: ' || v_url); END IF;
    v_desc := array_to_string(ARRAY[v_head, v_details, v_bullets,
                nullif(array_to_string(v_tail, E'\n'), '')], E'\n\n');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'part', v_t->>'part', 'listId', v_t->>'list_id', 'team', v_t->>'team',
      'listName', public.cockpit_request_team_label(v_t->>'team'),
      'templateId', v_t->>'template_id', 'templateName', CASE WHEN v_t->>'template_id' IS NOT NULL THEN v_t->>'template_name' END,
      'stepCount', public.cockpit_request_step_count(p_type, v_t),
      'stepsDraft', v_t->>'template_id' IS NULL AND v_has_steps AND p_type.sop_steps_state = 'draft',
      'owner', v_owner, 'taskName', v_name,
      'payload', jsonb_build_object(
        'requestId', p_request, 'part', v_t->>'part',
        'ref', CASE WHEN v_hex IS NOT NULL THEN 'R-' || v_hex || '-' || (v_t->>'part') END,
        'typeKey', p_type.key, 'typeLabel', p_type.label, 'typeVersion', p_type.version,
        'requestTypeOptionId', p_type.request_type_option_id, 'requestTypeOptionName', p_type.clickup_option_name,
        'setRequestType', p_type.set_request_type,
        'listId', v_t->>'list_id', 'listName', public.cockpit_request_team_label(v_t->>'team'),
        'templateId', v_t->>'template_id', 'templateName', CASE WHEN v_t->>'template_id' IS NOT NULL THEN v_t->>'template_name' END,
        'taskName', v_name, 'descriptionMarkdown', v_desc,
        'sopSteps', v_steps, 'sopChecklistName', v_checklist, 'sopStepsWhen', v_when,
        'clientTaskId', v_card, 'clientName', v_client, 'clientTag', lower(v_client),
        'ownerClickupId', v_owner->'clickupId', 'ownerLabel', v_owner->>'label',
        'dueOn', to_char(v_due, 'YYYY-MM-DD'),
        'dueMs', (extract(epoch FROM ((v_due::timestamp + time '09:00') AT TIME ZONE 'UTC')) * 1000)::bigint,
        'priority', v_priority,
        'priorityValue', CASE v_priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END,
        'fields', v_fields,
        'replacesTaskId', CASE WHEN v_first THEN p_replaces END,
        'requesterLabel', v_requester,
        'requestUrl', v_url)));
    v_first := false;
  END LOOP;
  RETURN v_out;
END $$;

-- A request's state and done time, from its parts (contract 2.7).
CREATE OR REPLACE FUNCTION public.cockpit_request_refresh(p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_requests; v_state text; v_done timestamptz;
  v_n integer; v_delivered integer; v_open integer; v_dry integer; v_seen integer; v_closed integer;
BEGIN
  SELECT * INTO r FROM public.cockpit_requests WHERE id = p_request FOR UPDATE;
  IF r.id IS NULL THEN RETURN; END IF;
  SELECT count(*), count(*) FILTER (WHERE p.state = 'delivered'),
         count(*) FILTER (WHERE p.state IN ('queued','sending','retry','unknown')),
         count(*) FILTER (WHERE p.state = 'dry_run'),
         count(*) FILTER (WHERE p.state IN ('delivered','imported')),
         count(*) FILTER (WHERE p.state IN ('delivered','imported') AND p.status_type IN ('done','closed'))
    INTO v_n, v_delivered, v_open, v_dry, v_seen, v_closed
    FROM public.cockpit_request_parts p WHERE p.request_id = p_request;
  IF r.state IN ('cancelled','imported','routed') OR v_n = 0 THEN v_state := r.state;
  ELSIF v_delivered = v_n THEN v_state := 'delivered';
  ELSIF v_open > 0 THEN v_state := 'sending';
  ELSIF v_dry = v_n THEN v_state := 'dry_run';
  ELSIF v_delivered > 0 THEN v_state := 'partial';
  ELSE v_state := 'failed';
  END IF;
  v_done := CASE WHEN v_seen > 0 AND v_closed = v_seen AND v_open = 0 THEN coalesce(r.done_at, now()) END;
  IF v_state IS DISTINCT FROM r.state OR v_done IS DISTINCT FROM r.done_at THEN
    UPDATE public.cockpit_requests SET state = v_state, done_at = v_done, updated_at = now() WHERE id = p_request;
  END IF;
END $$;

-- The requests writer's mode, from its last report (contract 2.4). Older
-- than 15 minutes or never reported: unknown. Migration t calls it too.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_requests_mode()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.cockpit_sync_state; v_at timestamptz; v_mode text; v_cards jsonb;
BEGIN
  SELECT * INTO s FROM public.cockpit_sync_state WHERE key = 'clickup-writeback:requests';
  BEGIN
    v_at := coalesce((s.detail->>'at')::timestamptz, s.last_run_at);
  EXCEPTION WHEN others THEN
    v_at := s.last_run_at;
  END;
  v_mode := s.detail->>'mode';
  v_cards := CASE WHEN jsonb_typeof(s.detail->'onlyCards') = 'array' THEN s.detail->'onlyCards' ELSE '[]'::jsonb END;
  IF s.key IS NULL OR v_at IS NULL OR v_at < now() - interval '15 minutes'
     OR coalesce(v_mode, '') NOT IN ('dry_run','apply','apply_limited') THEN
    RETURN jsonb_build_object('mode', 'unknown', 'onlyCards', v_cards, 'at', v_at, 'live', false);
  END IF;
  RETURN jsonb_build_object('mode', v_mode, 'onlyCards', v_cards, 'at', v_at, 'live', v_mode IN ('apply','apply_limited'));
END $$;

-- Whether a seat may send now: NULL when it may, else the sentence (2.8).
CREATE OR REPLACE FUNCTION public.cockpit_request_can_send(p_seat jsonb, p_client_task text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_mode jsonb := public.cockpit_clickup_requests_mode();
  v_priv boolean := coalesce((p_seat->>'isEditor')::boolean, false) OR coalesce((p_seat->>'isAdmin')::boolean, false)
                    OR coalesce((p_seat->>'isCeo')::boolean, false);
BEGIN
  CASE v_mode->>'mode'
    WHEN 'apply' THEN RETURN NULL;
    WHEN 'apply_limited' THEN
      IF NOT v_priv THEN
        RETURN 'Requests are being tested. They open to everyone soon. Use the ClickUp request form until then.';
      END IF;
      IF p_client_task IS NOT NULL AND v_mode->'onlyCards' ? p_client_task THEN RETURN NULL; END IF;
      RETURN 'Requests are being tested on the internal test card only. Pick that card, or wait until they open to everyone.';
    WHEN 'dry_run' THEN
      IF v_priv THEN RETURN NULL; END IF;
      RETURN 'Requests are not switched on yet. Use the ClickUp request form until then.';
    ELSE
      IF v_priv THEN
        RETURN 'The requests writer has not reported in the last 15 minutes. Check it on the Machine tab before sending.';
      END IF;
      RETURN 'Requests are not switched on yet. Use the ClickUp request form until then.';
  END CASE;
END $$;

-- The minute kick: post the writer a requests run (contract 2.9). Each run,
-- idle or not, refreshes the writer's mode.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_requests_kick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/clickup-writeback';
  v_secret text;
  v_note text;
  v_request bigint;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = $1 LIMIT 1'
      INTO v_secret USING 'cockpit_sync_secret';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    v_note := 'The vault has no cockpit_sync_secret, so the requests writer was not started. Add it to the vault.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace ns ON ns.oid = f.pronamespace
                     WHERE ns.nspname = 'net' AND f.proname = 'http_post') THEN
    v_note := 'pg_net is not installed, so the requests writer was not started.';
  END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at)
    VALUES ('clickup-writeback:requests-kick', now(), false, v_note, now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), ok = false, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  -- clickup-writeback answers when its run ends (up to about 100 seconds), so the post
  -- waits as long as the log job's does (150 s) rather than dropping the run at 5 s.
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 150000)' INTO v_request
    USING v_url, jsonb_build_object('job', 'requests'),
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
  VALUES ('clickup-writeback:requests-kick', now(), now(), true, 'Posted a requests run', now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
  RETURN v_request;
END $$;

-- A part's place in its type's parts, so every list shows them in the
-- type's order (the parts of one request share their created_at).
CREATE OR REPLACE FUNCTION public.cockpit_request_part_rank(p_type_key text, p_part text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT x.n::integer FROM public.cockpit_request_types t, jsonb_array_elements(t.targets) WITH ORDINALITY AS x(g, n)
                    WHERE t.key = p_type_key AND x.g->>'part' = p_part LIMIT 1), 99)
$$;

-- One part as the screens read it (PartRow).
CREATE OR REPLACE FUNCTION public.cockpit_request_part_row(p public.cockpit_request_parts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('part', p.part, 'listName', public.cockpit_request_team_label(p.team),
    'teamLabel', public.cockpit_request_team_label(p.team), 'taskName', p.task_name,
    'owner', jsonb_build_object('label', p.owner_label, 'how', p.owner_how, 'note', p.owner_note),
    'state', p.state, 'error', p.error, 'url', p.clickup_url, 'status', p.status, 'statusType', p.status_type,
    'verifyState', p.verify_state, 'verifyNote', p.verify_note)
$$;

-- Whether a seat may cancel a request now.
CREATE OR REPLACE FUNCTION public.cockpit_request_cancellable(r public.cockpit_requests, p_seat jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (r.requester_member_id::text = p_seat->>'memberId'
          OR coalesce((p_seat->>'isEditor')::boolean, false) OR coalesce((p_seat->>'isAdmin')::boolean, false)
          OR coalesce((p_seat->>'isCeo')::boolean, false))
     AND r.state NOT IN ('cancelled','imported','routed')
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_request_parts p
                      WHERE p.request_id = r.id AND p.state IN ('sending','delivered','unknown'))
$$;

-- One request as the screens read it (RequestRow).
CREATE OR REPLACE FUNCTION public.cockpit_request_row(r public.cockpit_requests, p_seat jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_team text; v_parts jsonb; v_all boolean;
BEGIN
  SELECT t.team INTO v_team FROM public.cockpit_request_types t WHERE t.key = r.type_key;
  SELECT coalesce(jsonb_agg(public.cockpit_request_part_row(p)
           ORDER BY p.created_at, public.cockpit_request_part_rank(r.type_key, p.part), p.part), '[]'::jsonb)
    INTO v_parts FROM public.cockpit_request_parts p WHERE p.request_id = r.id;
  v_all := coalesce((p_seat->>'isEditor')::boolean, false) OR coalesce((p_seat->>'isAdmin')::boolean, false)
           OR coalesce((p_seat->>'isCeo')::boolean, false);
  RETURN jsonb_build_object('id', r.id, 'typeKey', r.type_key, 'typeLabel', r.type_label,
    'team', v_team, 'teamLabel', public.cockpit_request_team_label(v_team),
    'clientTaskId', r.client_task_id, 'clientName', r.client_name, 'requesterLabel', r.requester_label,
    'mine', r.requester_member_id IS NOT NULL AND r.requester_member_id::text = p_seat->>'memberId',
    'dueOn', to_char(r.due_on, 'YYYY-MM-DD'), 'priority', r.priority, 'state', r.state, 'done', r.done_at IS NOT NULL,
    'createdAt', r.created_at, 'source', r.source,
    'canCancel', public.cockpit_request_cancellable(r, p_seat),
    'canRoute', r.state = 'imported'
                AND (v_all OR coalesce(p_seat->'teams', '[]'::jsonb) ? coalesce(v_team, ''))
                AND public.cockpit_request_can_send(p_seat, r.client_task_id) IS NULL,
    'parts', v_parts);
END $$;

-- Whether a request is in one of a seat's views (contract 2.5, requests_read).
CREATE OR REPLACE FUNCTION public.cockpit_request_in_view(r public.cockpit_requests, p_team text, p_view text, p_seat jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cu bigint := CASE WHEN jsonb_typeof(p_seat->'clickupUserId') = 'number' THEN (p_seat->>'clickupUserId')::bigint END;
BEGIN
  IF p_view = 'mine' THEN
    RETURN r.requester_member_id IS NOT NULL AND r.requester_member_id::text = p_seat->>'memberId';
  ELSIF p_view = 'assigned' THEN
    RETURN v_cu IS NOT NULL AND r.done_at IS NULL AND r.state NOT IN ('cancelled','routed')
       AND EXISTS (SELECT 1 FROM public.cockpit_request_parts p
                    WHERE p.request_id = r.id AND (p.owner_clickup_id = v_cu OR v_cu = ANY(coalesce(p.assignee_ids, '{}'))));
  ELSIF p_view = 'team' THEN
    RETURN r.done_at IS NULL AND r.state NOT IN ('cancelled','routed')
       AND (coalesce(p_seat->'teams', '[]'::jsonb) ? coalesce(p_team, '')
            OR EXISTS (SELECT 1 FROM public.cockpit_request_parts p
                        WHERE p.request_id = r.id AND coalesce(p_seat->'teams', '[]'::jsonb) ? p.team));
  ELSIF p_view = 'all' THEN
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- The md5 the idempotency check compares.
CREATE OR REPLACE FUNCTION public.cockpit_request_hash(p_type text, p_client text, p_answers jsonb, p_due date, p_priority text, p_replaces text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT md5(coalesce(p_type, '') || '|' || coalesce(p_client, '') || '|' || coalesce(p_answers, '{}'::jsonb)::text || '|'
             || coalesce(p_due::text, '') || '|' || coalesce(p_priority, '') || '|' || coalesce(p_replaces, ''))
$$;

-- An editor's part changes, checked against the caches: a newly named person
-- must be an active ClickUp member and a newly picked template must be in
-- ClickUp. Template names come from the cache. Raises the sentence.
CREATE OR REPLACE FUNCTION public.cockpit_request_targets_checked(p_new jsonb, p_old jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_t jsonb; v_out jsonb := '[]'::jsonb; v_id bigint; v_name text; v_state text;
BEGIN
  IF jsonb_typeof(p_new) IS DISTINCT FROM 'array' THEN RETURN p_new; END IF;
  FOR v_t IN SELECT e FROM jsonb_array_elements(p_new) WITH ORDINALITY AS x(e, n) ORDER BY n LOOP
    IF jsonb_typeof(v_t) = 'object' AND jsonb_typeof(v_t->'owner_clickup_id') = 'number'
       AND v_t->>'owner_clickup_id' ~ '^[1-9][0-9]{0,17}$' THEN
      v_id := (v_t->>'owner_clickup_id')::bigint;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o WHERE o->'owner_clickup_id' = v_t->'owner_clickup_id')
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_clickup_members c WHERE c.clickup_user_id = v_id AND c.active) THEN
        RAISE EXCEPTION 'That person is not in the ClickUp workspace. Pick someone from the list.' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF jsonb_typeof(v_t) = 'object' AND jsonb_typeof(v_t->'template_id') = 'string' THEN
      v_name := NULL; v_state := NULL;
      SELECT tp.name, tp.state INTO v_name, v_state FROM public.cockpit_request_templates tp WHERE tp.id = v_t->>'template_id';
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o WHERE o->>'template_id' = v_t->>'template_id')
         AND v_state IS DISTINCT FROM 'ok' THEN
        RAISE EXCEPTION 'That template is not in ClickUp any more. Pick another.' USING ERRCODE = '22023';
      END IF;
      IF v_name IS NOT NULL THEN v_t := jsonb_set(v_t, '{template_name}', to_jsonb(v_name)); END IF;
    ELSIF jsonb_typeof(v_t) = 'object' THEN
      v_t := jsonb_set(v_t, '{template_name}', 'null'::jsonb);
    END IF;
    v_out := v_out || jsonb_build_array(v_t);
  END LOOP;
  RETURN v_out;
END $$;

-- The answers of a request as its panel shows them, labelled by the type
-- version it was made on.
CREATE OR REPLACE FUNCTION public.cockpit_request_type_at(p_key text, p_version integer)
RETURNS public.cockpit_request_types LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.cockpit_request_types; v_row jsonb;
BEGIN
  SELECT v."row" INTO v_row FROM public.cockpit_request_type_versions v WHERE v.key = p_key AND v.version = p_version;
  IF v_row IS NOT NULL THEN
    t := jsonb_populate_record(NULL::public.cockpit_request_types, v_row);
  ELSE
    SELECT * INTO t FROM public.cockpit_request_types WHERE key = p_key;
  END IF;
  RETURN t;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Triggers: the type guard, no deletes, the seat link audit, the queue sync

CREATE OR REPLACE FUNCTION public.cockpit_request_type_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_problem text; v_t jsonb; v_old jsonb; v_list text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.key IS DISTINCT FROM OLD.key OR NEW.type_index IS DISTINCT FROM OLD.type_index
       OR NEW.request_type_option_id IS DISTINCT FROM OLD.request_type_option_id THEN
      RAISE EXCEPTION 'A request type keeps its key and its ClickUp option.' USING ERRCODE = '22023';
    END IF;
    -- A question a part reads to decide when it runs cannot go.
    FOR v_t IN SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.targets) = 'array' THEN NEW.targets ELSE '[]'::jsonb END) e LOOP
      IF jsonb_typeof(v_t) = 'object' AND jsonb_typeof(v_t->'when') = 'object'
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.fields) = 'array' THEN NEW.fields ELSE '[]'::jsonb END) f
                          WHERE jsonb_typeof(f) = 'object' AND f->>'key' = v_t->'when'->>'field_key') THEN
        SELECT f INTO v_old FROM jsonb_array_elements(OLD.fields) f WHERE f->>'key' = v_t->'when'->>'field_key' LIMIT 1;
        IF v_old IS NOT NULL THEN
          v_list := coalesce(public.cockpit_request_team_label(public.cockpit_request_list_team(v_t->>'list_id')), v_t->>'part');
          RAISE EXCEPTION USING MESSAGE = 'The ' || v_list || ' part uses ' || (v_old->>'label')
            || ' to decide when it runs. Change that part first.', ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
  END IF;
  v_problem := public.cockpit_request_type_problem(to_jsonb(NEW));
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = v_problem, ERRCODE = '22023';
  END IF;
  NEW.team := NEW.targets->0->>'team';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cockpit_request_types_guard ON public.cockpit_request_types;
CREATE TRIGGER cockpit_request_types_guard BEFORE INSERT OR UPDATE ON public.cockpit_request_types
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_request_type_guard();

CREATE OR REPLACE FUNCTION public.cockpit_request_refuse_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME IN ('cockpit_request_types','cockpit_request_type_versions') THEN
    RAISE EXCEPTION 'A request type is never deleted. Turn it off instead.' USING ERRCODE = '55000';
  END IF;
  RAISE EXCEPTION 'A request is never deleted. Cancel it instead.' USING ERRCODE = '55000';
END $$;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['cockpit_request_types','cockpit_request_type_versions','cockpit_requests','cockpit_request_parts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_no_delete', v_table);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cockpit_request_refuse_delete()',
      v_table || '_no_delete', v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_no_truncate', v_table);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_request_refuse_delete()',
      v_table || '_no_truncate', v_table);
  END LOOP;
END $$;

-- A seat's ClickUp link: an audit row whenever the link itself changes (the
-- hourly check that finds the same answer only moves checked_at).
CREATE OR REPLACE FUNCTION public.cockpit_member_clickup_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state IS NOT DISTINCT FROM NEW.state AND OLD.clickup_user_id IS NOT DISTINCT FROM NEW.clickup_user_id
     AND OLD.matched_by IS NOT DISTINCT FROM NEW.matched_by AND OLD.note IS NOT DISTINCT FROM NEW.note THEN
    RETURN NULL;
  END IF;
  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  PERFORM public.cockpit_request_audit('member_clickup.linked', 'cockpit_member_clickup', NEW.member_id::text,
    coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), NEW.updated_by),
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW), jsonb_build_object('op', lower(TG_OP)));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_member_clickup_audit ON public.cockpit_member_clickup;
CREATE TRIGGER cockpit_member_clickup_audit AFTER INSERT OR UPDATE ON public.cockpit_member_clickup
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_member_clickup_audit();

-- The writer's queue moves the request parts (contract 2.7). No audit here:
-- the queue's own trigger (20261009f) records every state change but sending.
CREATE OR REPLACE FUNCTION public.cockpit_request_queue_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_req uuid; v_part text; v_p public.cockpit_request_parts;
BEGIN
  BEGIN
    v_req := (NEW.payload->>'requestId')::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  v_part := NEW.payload->>'part';
  IF v_req IS NULL OR v_part IS NULL THEN RETURN NULL; END IF;
  IF NEW.kind = 'request' THEN
    UPDATE public.cockpit_request_parts p SET
      state = NEW.state,
      error = left(NEW.error, 500),
      clickup_task_id = coalesce(NEW.task_id, p.clickup_task_id),
      clickup_url = coalesce(NEW.progress->'task'->>'url', p.clickup_url),
      updated_at = now()
    WHERE p.request_id = v_req AND p.part = v_part
    RETURNING p.* INTO v_p;
    IF v_p.request_id IS NULL THEN RETURN NULL; END IF;
    IF NEW.state = 'delivered' AND OLD.state IS DISTINCT FROM 'delivered' AND v_p.clickup_task_id IS NOT NULL THEN
      INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, task_id, next_attempt_at, payload)
      VALUES ('verify:' || v_req::text || ':' || v_part, 'task_action', 'cockpit_requests', v_req::text, v_p.clickup_task_id,
        now() + interval '2 minutes',
        jsonb_build_object('op', 'verify', 'requestId', v_req, 'part', v_part, 'taskId', v_p.clickup_task_id,
          'listId', v_p.list_id, 'taskName', v_p.task_name, 'ownerClickupId', v_p.owner_clickup_id,
          'typeKey', NEW.payload->>'typeKey',
          'setRequestType', coalesce(NEW.payload->'setRequestType', 'false'::jsonb),
          'clientTaskId', NEW.payload->'clientTaskId'))
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state THEN
      PERFORM public.cockpit_request_refresh(v_req);
    END IF;
  ELSIF NEW.kind = 'task_action' AND NEW.payload->>'op' = 'verify'
        AND NEW.state IN ('delivered','failed','skipped')
        AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.progress IS DISTINCT FROM OLD.progress) THEN
    UPDATE public.cockpit_request_parts p SET
      verify_state = CASE WHEN NEW.progress->>'verify' IN ('kept','restored','removed','moved') THEN NEW.progress->>'verify' ELSE p.verify_state END,
      verify_note = left(coalesce(NEW.progress->>'verifyNote', NEW.error), 500),
      updated_at = now()
    WHERE p.request_id = v_req AND p.part = v_part;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_request_queue_sync ON public.cockpit_clickup_writeback_queue;
CREATE TRIGGER cockpit_request_queue_sync AFTER UPDATE OF state, task_id, progress ON public.cockpit_clickup_writeback_queue
  FOR EACH ROW WHEN (NEW.kind IN ('request','task_action'))
  EXECUTE FUNCTION public.cockpit_request_queue_sync();

-- ---------------------------------------------------------------------------
-- 5. Browser RPCs (a signed-in seat; the gate first)

CREATE OR REPLACE FUNCTION public.cockpit_request_types_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_editor boolean := (v_seat->>'isEditor')::boolean;
  v_note text := public.cockpit_request_can_send(v_seat, NULL);
  v_mode jsonb := public.cockpit_clickup_requests_mode();
  v_types jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(public.cockpit_request_type_view(t, v_editor)
           ORDER BY public.cockpit_request_team_order(t.team), t.type_index), '[]'::jsonb)
    INTO v_types FROM public.cockpit_request_types t WHERE t.enabled OR v_editor;
  RETURN jsonb_build_object('asOf', now(),
    'seat', jsonb_build_object('label', v_seat->>'label', 'link', v_seat->>'link', 'teams', v_seat->'teams',
      'editor', v_editor,
      'all', v_editor OR (v_seat->>'isAdmin')::boolean OR (v_seat->>'isCeo')::boolean),
    'writer', jsonb_build_object('mode', v_mode->>'mode', 'canSend', v_note IS NULL, 'note', v_note),
    'types', v_types)
    -- Editors pick fields and templates from what ClickUp last showed.
    || CASE WHEN v_editor THEN jsonb_build_object(
         'catalog', coalesce((SELECT jsonb_agg(jsonb_build_object('clickupFieldId', c.clickup_field_id, 'clickupName', c.clickup_name,
                       'label', c.label, 'kind', c.kind, 'options', c.options, 'state', c.state) ORDER BY lower(c.label), c.clickup_field_id)
                     FROM public.cockpit_request_field_catalog c), '[]'::jsonb),
         'templates', coalesce((SELECT jsonb_agg(jsonb_build_object('id', tp.id, 'name', tp.name, 'state', tp.state) ORDER BY lower(tp.name), tp.id)
                       FROM public.cockpit_request_templates tp), '[]'::jsonb))
       ELSE '{}'::jsonb END;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_clients(p_search text DEFAULT NULL, p_include_stopped boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_rows jsonb; v_total integer;
BEGIN
  IF v_search IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(left(v_search, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;
  WITH hits AS (
    SELECT o.clickup_task_id, o.client_name, o.client_status
      FROM public.cockpit_client_onboarding o
     WHERE public.cockpit_client_allowed(o.client_name)
       AND (v_like IS NULL OR o.client_name ILIKE v_like ESCAPE '\')
       AND (coalesce(p_include_stopped, false) OR coalesce(lower(btrim(o.client_status)), '') NOT IN ('stopped','ghosted'))
  )
  SELECT (SELECT count(*) FROM hits),
         coalesce((SELECT jsonb_agg(jsonb_build_object('taskId', h.clickup_task_id, 'name', h.client_name, 'status', h.client_status)
                                    ORDER BY lower(h.client_name), h.clickup_task_id)
                     FROM (SELECT * FROM hits ORDER BY lower(client_name), clickup_task_id LIMIT 30) h), '[]'::jsonb)
    INTO v_total, v_rows;
  RETURN jsonb_build_object('clients', v_rows, 'more', v_total > 30);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_preview(p_type_key text, p_client_task_id text DEFAULT NULL, p_answers jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  t public.cockpit_request_types;
  v_client text; v_plan jsonb; v_parts jsonb; v_note text; v_send text; v_label text;
BEGIN
  SELECT * INTO t FROM public.cockpit_request_types WHERE key = p_type_key;
  IF t.key IS NULL THEN
    RAISE EXCEPTION 'That request type does not exist. Reload the form.' USING ERRCODE = '22023';
  END IF;
  IF NOT t.enabled THEN
    RAISE EXCEPTION 'This request type is turned off. Pick another or ask the systems manager.' USING ERRCODE = '22023';
  END IF;
  IF p_client_task_id IS NOT NULL THEN
    SELECT o.client_name INTO v_client FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_client_task_id;
    IF v_client IS NULL OR NOT coalesce(public.cockpit_client_allowed(v_client), false) THEN
      RAISE EXCEPTION 'You cannot raise a request for this client.' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_plan := public.cockpit_request_plan(t, NULL, p_client_task_id, v_client,
    CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END,
    NULL, NULL, v_seat->>'label', NULL);
  SELECT coalesce(jsonb_agg(jsonb_build_object('part', e->>'part', 'listName', e->>'listName', 'teamLabel', e->>'listName',
           'taskName', e->>'taskName', 'templateName', e->'templateName', 'stepCount', e->'stepCount',
           'stepsDraft', e->'stepsDraft', 'owner', e->'owner') ORDER BY n), '[]'::jsonb)
    INTO v_parts FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS x(e, n);
  IF jsonb_array_length(v_parts) = 0 THEN
    SELECT f->>'label' INTO v_label FROM jsonb_array_elements(t.targets) g, jsonb_array_elements(t.fields) f
     WHERE jsonb_typeof(g->'when') = 'object' AND f->>'key' = g->'when'->>'field_key' LIMIT 1;
    v_note := 'Pick ' || coalesce(v_label, 'the choices above') || ' to see where it goes.';
  END IF;
  v_send := public.cockpit_request_can_send(v_seat, p_client_task_id);
  RETURN jsonb_build_object('parts', v_parts, 'note', v_note,
    'dueDefault', to_char(public.cockpit_request_due_default(t.due_days), 'YYYY-MM-DD'),
    'writer', jsonb_build_object('canSend', v_send IS NULL, 'note', v_send));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_submit(p_request_id uuid, p_type_key text, p_client_task_id text, p_answers jsonb,
  p_due_on date, p_priority text, p_source text, p_replaces_task_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_send text;
  t public.cockpit_request_types;
  v_answers jsonb := CASE WHEN p_answers IS NULL OR jsonb_typeof(p_answers) = 'null' THEN '{}'::jsonb ELSE p_answers END;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_due date; v_priority text; v_hash text; v_client text; v_client_field jsonb; v_f jsonb; v_v jsonb;
  v_label text; v_problem text; v_text text; v_opts jsonb; v_state text; v_k text;
  v_existing public.cockpit_requests; v_dup public.cockpit_requests; v_import public.cockpit_requests;
  v_plan jsonb; v_e jsonb; v_queue uuid; r public.cockpit_requests; v_parts jsonb;
BEGIN
  -- 1. Who sends, and whether the writer takes requests now.
  v_send := public.cockpit_request_can_send(v_seat, p_client_task_id);
  IF v_send IS NOT NULL THEN RAISE EXCEPTION USING MESSAGE = v_send, ERRCODE = '55000'; END IF;
  -- 2. Where it comes from, and the type.
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'The request has no id. Reload the form.' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_source, '') NOT IN ('requests_page','client_page') THEN
    RAISE EXCEPTION 'Send requests from the Requests page or a client page.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.cockpit_request_types WHERE key = p_type_key;
  IF t.key IS NULL THEN RAISE EXCEPTION 'That request type does not exist. Reload the form.' USING ERRCODE = '22023'; END IF;
  IF NOT t.enabled THEN
    RAISE EXCEPTION 'This request type is turned off. Pick another or ask the systems manager.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_answers) <> 'object' OR octet_length(v_answers::text) > 32768 THEN
    RAISE EXCEPTION 'The answers could not be read. Reload the form and send again.' USING ERRCODE = '22023';
  END IF;
  v_due := coalesce(p_due_on, public.cockpit_request_due_default(t.due_days));
  v_priority := coalesce(nullif(btrim(p_priority), ''), t.priority);
  -- 3. Idempotency: the same press sent again returns what it made.
  v_hash := public.cockpit_request_hash(t.key, p_client_task_id, v_answers, v_due, v_priority, p_replaces_task_id);
  SELECT * INTO v_existing FROM public.cockpit_requests WHERE id = p_request_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.content_hash = v_hash AND v_existing.requester_member_id::text = v_seat->>'memberId' THEN
      SELECT coalesce(jsonb_agg(public.cockpit_request_part_row(p)
               ORDER BY p.created_at, public.cockpit_request_part_rank(v_existing.type_key, p.part), p.part), '[]'::jsonb)
        INTO v_parts FROM public.cockpit_request_parts p WHERE p.request_id = v_existing.id;
      RETURN jsonb_build_object('id', v_existing.id, 'state', v_existing.state, 'reused', true, 'duplicateOf', NULL,
        'note', NULL, 'parts', v_parts);
    END IF;
    RAISE EXCEPTION 'This request was already sent with other answers. Reload the form and send again.' USING ERRCODE = '22023';
  END IF;
  -- 4. The client.
  SELECT f INTO v_client_field FROM jsonb_array_elements(t.fields) f WHERE f->>'kind' = 'client' LIMIT 1;
  IF p_client_task_id IS NULL AND coalesce((v_client_field->>'required')::boolean, false) THEN
    RAISE EXCEPTION USING MESSAGE = (v_client_field->>'label') || ': pick a client.', ERRCODE = '22023';
  END IF;
  IF p_client_task_id IS NOT NULL THEN
    SELECT o.client_name INTO v_client FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_client_task_id;
    IF v_client IS NULL OR NOT coalesce(public.cockpit_client_allowed(v_client), false) THEN
      RAISE EXCEPTION 'You cannot raise a request for this client.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_answers ?| ARRAY['client','deadline','priority'] THEN
    RAISE EXCEPTION 'Send the client, the due day and the priority on their own, not with the answers.' USING ERRCODE = '22023';
  END IF;
  FOR v_k IN SELECT jsonb_object_keys(v_answers) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.fields) f WHERE f->>'key' = v_k) THEN
      RAISE EXCEPTION 'One answer is not a question of this request type. Reload the form and send again.' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- 5. The answers, in the form's order; the first problem is the sentence.
  FOR v_f IN SELECT e FROM jsonb_array_elements(t.fields) WITH ORDINALITY AS x(e, n) ORDER BY n LOOP
    CONTINUE WHEN v_f->>'kind' IN ('client','deadline','priority');
    v_label := v_f->>'label';
    v_v := v_answers->(v_f->>'key');
    v_problem := NULL;
    IF NOT public.cockpit_request_answered(v_v) THEN
      IF coalesce((v_f->>'required')::boolean, false) THEN
        IF v_f->>'kind' = 'select' AND jsonb_array_length(coalesce(public.cockpit_request_field_options(v_f), '[]'::jsonb)) = 0 THEN
          v_problem := 'this choice could not be read from ClickUp. Ask the systems manager';
        ELSIF v_f->>'kind' = 'select' THEN v_problem := 'pick one';
        ELSE v_problem := 'fill this in';
        END IF;
      END IF;
    ELSE
      v_text := v_v #>> '{}';
      CASE v_f->>'kind'
        WHEN 'text' THEN
          IF jsonb_typeof(v_v) <> 'string' THEN v_problem := 'write it as text';
          ELSIF char_length(v_text) > 500 THEN v_problem := 'keep it under 500 characters'; END IF;
        WHEN 'longtext', 'details' THEN
          IF jsonb_typeof(v_v) <> 'string' THEN v_problem := 'write it as text';
          ELSIF char_length(v_text) > 4000 THEN v_problem := 'keep it under 4000 characters'; END IF;
        WHEN 'url' THEN
          IF jsonb_typeof(v_v) <> 'string' OR btrim(v_text) !~* '^https?://' THEN
            v_problem := 'paste a link that starts with http:// or https://';
          ELSIF char_length(v_text) > 2000 THEN v_problem := 'that link is too long'; END IF;
        WHEN 'number' THEN
          IF jsonb_typeof(v_v) NOT IN ('number','string') OR btrim(v_text) !~ '^[0-9]{1,4}$' THEN
            v_problem := 'enter a whole number from 0 to 1000';
          ELSIF btrim(v_text)::integer > 1000 THEN
            v_problem := 'enter a whole number from 0 to 1000';
          END IF;
        WHEN 'select' THEN
          v_opts := coalesce(public.cockpit_request_field_options(v_f), '[]'::jsonb);
          IF jsonb_typeof(v_v) <> 'string' OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_opts) o WHERE o->>'id' = v_text) THEN
            v_problem := CASE WHEN jsonb_array_length(v_opts) = 0
                              THEN 'this choice could not be read from ClickUp. Ask the systems manager'
                              ELSE 'pick one of the choices' END;
          END IF;
        ELSE NULL;
      END CASE;
    END IF;
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION USING MESSAGE = v_label || ': ' || v_problem || '.', ERRCODE = '22023';
    END IF;
  END LOOP;
  -- 6. At least one part runs; the due day and the priority.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.targets) g WHERE public.cockpit_request_target_runs(g, v_answers)) THEN
    SELECT f->>'label' INTO v_label FROM jsonb_array_elements(t.targets) g, jsonb_array_elements(t.fields) f
     WHERE jsonb_typeof(g->'when') = 'object' AND f->>'key' = g->'when'->>'field_key' LIMIT 1;
    RAISE EXCEPTION USING MESSAGE = 'Pick ' || coalesce(v_label, 'what you need') || ' first.', ERRCODE = '22023';
  END IF;
  IF v_due < v_today THEN RAISE EXCEPTION 'Pick today or a later day.' USING ERRCODE = '22023'; END IF;
  IF v_due > v_today + 365 THEN RAISE EXCEPTION 'Pick a day within the next year.' USING ERRCODE = '22023'; END IF;
  IF v_priority NOT IN ('urgent','high','normal','low') THEN
    RAISE EXCEPTION 'Priority: pick urgent, high, normal or low.' USING ERRCODE = '22023';
  END IF;
  -- 8 (checked before 7, so routing an old ticket is not its own duplicate).
  IF p_replaces_task_id IS NOT NULL THEN
    SELECT * INTO v_import FROM public.cockpit_requests WHERE imported_task_id = p_replaces_task_id FOR UPDATE;
    IF v_import.id IS NULL THEN
      RAISE EXCEPTION 'That old ticket is not in the cockpit. Reload the queue.' USING ERRCODE = '22023';
    END IF;
    IF v_import.state <> 'imported' THEN
      RAISE EXCEPTION 'That old ticket was already routed.' USING ERRCODE = '55000';
    END IF;
  END IF;
  -- 7. One open lifecycle request per card.
  IF t.key IN ('client_offboarding','client_pause','client_relaunch') AND p_client_task_id IS NOT NULL THEN
    SELECT * INTO v_dup FROM public.cockpit_requests q
     WHERE q.type_key = t.key AND q.client_task_id = p_client_task_id
       AND q.state NOT IN ('cancelled','failed','routed') AND q.done_at IS NULL
       AND q.created_at > now() - interval '60 days'
       AND (p_replaces_task_id IS NULL OR q.imported_task_id IS DISTINCT FROM p_replaces_task_id)
     ORDER BY q.created_at DESC LIMIT 1;
    IF v_dup.id IS NOT NULL THEN
      RETURN jsonb_build_object('id', NULL, 'state', 'duplicate', 'reused', false, 'duplicateOf', v_dup.id,
        'note', 'An open ' || lower(t.label) || ' request for ' || coalesce(v_client, 'this client') || ' already exists. Open it instead.',
        'parts', '[]'::jsonb);
    END IF;
  END IF;
  -- 9. The request, its parts and one queue row per part.
  v_plan := public.cockpit_request_plan(t, p_request_id, p_client_task_id, v_client, v_answers, v_due, v_priority,
    v_seat->>'label', p_replaces_task_id);
  INSERT INTO public.cockpit_requests(id, type_key, type_version, type_label, requester_member_id, requester_email, requester_label,
    source, client_task_id, client_name, answers, due_on, priority, state, replaces_task_id, content_hash)
  VALUES (p_request_id, t.key, t.version, t.label, (v_seat->>'memberId')::uuid, v_seat->>'email', v_seat->>'label',
    p_source, p_client_task_id, v_client, v_answers, v_due, v_priority, 'sending', p_replaces_task_id, v_hash)
  RETURNING * INTO r;
  FOR v_e IN SELECT e FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS x(e, n) ORDER BY n LOOP
    INSERT INTO public.cockpit_request_parts(request_id, part, list_id, team, template_id, template_name, task_name,
      owner_rule, owner_clickup_id, owner_how, owner_label, owner_note, state)
    SELECT r.id, v_e->>'part', v_e->>'listId', v_e->>'team', v_e->>'templateId', v_e->>'templateName', v_e->>'taskName',
      g->>'owner_rule', CASE WHEN jsonb_typeof(v_e->'owner'->'clickupId') = 'number' THEN (v_e->'owner'->>'clickupId')::bigint END,
      v_e->'owner'->>'how', v_e->'owner'->>'label', v_e->'owner'->>'note', 'queued'
      FROM jsonb_array_elements(t.targets) g WHERE g->>'part' = v_e->>'part';
    INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, campaign_name, payload)
    VALUES ('request:' || r.id::text || ':' || (v_e->>'part'), 'request', 'cockpit_requests', r.id::text, NULL, v_e->'payload')
    RETURNING id INTO v_queue;
    UPDATE public.cockpit_request_parts SET queue_id = v_queue WHERE request_id = r.id AND part = v_e->>'part';
  END LOOP;
  IF v_import.id IS NOT NULL THEN
    UPDATE public.cockpit_requests SET state = 'routed', routed_to = r.id, updated_at = now() WHERE id = v_import.id;
    PERFORM public.cockpit_request_audit('request.routed', 'cockpit_requests', v_import.id::text, v_seat->>'email',
      jsonb_build_object('state', v_import.state), jsonb_build_object('state', 'routed', 'routed_to', r.id),
      jsonb_build_object('task_id', p_replaces_task_id, 'request_id', r.id));
  END IF;
  PERFORM public.cockpit_request_audit('request.submitted', 'cockpit_requests', r.id::text, v_seat->>'email', NULL, to_jsonb(r),
    jsonb_build_object('type', t.key, 'type_version', t.version, 'source', p_source,
      'parts', (SELECT coalesce(jsonb_agg(e->>'part' ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS x(e, n)),
      'owners', (SELECT coalesce(jsonb_agg(e->'owner'->>'label' ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS x(e, n))));
  -- 10. Kick the writer; a failed kick never fails a request (the cron runs each minute).
  BEGIN
    PERFORM public.cockpit_clickup_requests_kick();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT coalesce(jsonb_agg(public.cockpit_request_part_row(p)
           ORDER BY p.created_at, public.cockpit_request_part_rank(r.type_key, p.part), p.part), '[]'::jsonb)
    INTO v_parts FROM public.cockpit_request_parts p WHERE p.request_id = r.id;
  SELECT q.state INTO v_state FROM public.cockpit_requests q WHERE q.id = r.id;
  RETURN jsonb_build_object('id', r.id, 'state', v_state, 'reused', false, 'duplicateOf', NULL, 'note', NULL, 'parts', v_parts);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_cancel(p_request_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  r public.cockpit_requests; v_after public.cockpit_requests;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_priv boolean := coalesce((v_seat->>'isEditor')::boolean, false) OR coalesce((v_seat->>'isAdmin')::boolean, false)
                    OR coalesce((v_seat->>'isCeo')::boolean, false);
BEGIN
  SELECT * INTO r FROM public.cockpit_requests WHERE id = p_request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'That request is not in the cockpit. Reload the list.' USING ERRCODE = '22023'; END IF;
  IF NOT v_priv AND r.requester_member_id::text IS DISTINCT FROM v_seat->>'memberId' THEN
    RAISE EXCEPTION 'Only the person who asked, an editor, an admin or the CEO can cancel this request.' USING ERRCODE = '42501';
  END IF;
  IF r.state = 'cancelled' THEN RETURN public.cockpit_request_row(r, v_seat); END IF;
  IF r.state IN ('imported','routed') THEN
    RAISE EXCEPTION 'This ticket came from the old ClickUp form. Close it in ClickUp.' USING ERRCODE = '55000';
  END IF;
  IF v_reason = '' OR char_length(v_reason) > 240 THEN
    RAISE EXCEPTION 'Say why you are cancelling it, in under 240 characters.' USING ERRCODE = '22023';
  END IF;
  -- Lock the queue rows first: a claim skips locked rows, so nothing starts sending under us.
  PERFORM 1 FROM public.cockpit_clickup_writeback_queue q
   WHERE q.kind = 'request' AND q.source_id = r.id::text FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.cockpit_request_parts p WHERE p.request_id = r.id AND p.state IN ('sending','delivered','unknown'))
     OR EXISTS (SELECT 1 FROM public.cockpit_clickup_writeback_queue q
                 WHERE q.kind = 'request' AND q.source_id = r.id::text AND q.state IN ('sending','delivered','unknown')) THEN
    RAISE EXCEPTION 'Part of this request is already in ClickUp. Close it there.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.cockpit_requests SET state = 'cancelled', cancel_reason = v_reason, cancelled_by = v_seat->>'email', updated_at = now()
   WHERE id = r.id RETURNING * INTO v_after;
  UPDATE public.cockpit_clickup_writeback_queue q SET state = 'skipped', error = 'Cancelled in the cockpit.', updated_at = now()
   WHERE q.kind = 'request' AND q.source_id = r.id::text AND q.state IN ('queued','retry','dry_run');
  UPDATE public.cockpit_request_parts p SET state = 'skipped', error = coalesce(p.error, 'Cancelled in the cockpit.'), updated_at = now()
   WHERE p.request_id = r.id AND p.state <> 'skipped';
  PERFORM public.cockpit_request_audit('request.cancelled', 'cockpit_requests', r.id::text, v_seat->>'email',
    jsonb_build_object('state', r.state), jsonb_build_object('state', 'cancelled', 'cancel_reason', v_reason),
    jsonb_build_object('type', r.type_key));
  SELECT * INTO v_after FROM public.cockpit_requests WHERE id = r.id;
  RETURN public.cockpit_request_row(v_after, v_seat);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_requests_read(p_view text, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_all boolean := coalesce((v_seat->>'isEditor')::boolean, false) OR coalesce((v_seat->>'isAdmin')::boolean, false)
                   OR coalesce((v_seat->>'isCeo')::boolean, false);
  v_linked boolean := v_seat->>'link' = 'linked';
  v_teams jsonb := coalesce(v_seat->'teams', '[]'::jsonb);
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_views jsonb := '[]'::jsonb; v_rows jsonb; v_note text;
BEGIN
  IF coalesce(p_view, '') NOT IN ('mine','assigned','team','all') THEN
    RAISE EXCEPTION 'Pick My requests, Assigned to me, a team queue or All requests.' USING ERRCODE = '22023';
  END IF;
  IF p_view = 'all' AND NOT v_all THEN
    RAISE EXCEPTION 'Only an editor, an admin or the CEO can see all requests.' USING ERRCODE = '42501';
  END IF;
  v_views := jsonb_build_array(jsonb_build_object('key', 'mine', 'label', 'My requests',
    'count', (SELECT count(*) FROM public.cockpit_requests r WHERE public.cockpit_request_in_view(r, NULL, 'mine', v_seat))));
  v_views := v_views || jsonb_build_object('key', 'assigned', 'label', 'Assigned to me',
    'count', CASE WHEN v_linked THEN (SELECT count(*) FROM public.cockpit_requests r
                                       WHERE public.cockpit_request_in_view(r, NULL, 'assigned', v_seat)) END);
  IF jsonb_array_length(v_teams) > 0 THEN
    v_views := v_views || jsonb_build_object('key', 'team',
      'label', CASE WHEN jsonb_array_length(v_teams) = 1 THEN public.cockpit_request_team_label(v_teams->>0) || ' queue' ELSE 'Team queue' END,
      'count', (SELECT count(*) FROM public.cockpit_requests r JOIN public.cockpit_request_types t ON t.key = r.type_key
                 WHERE public.cockpit_request_in_view(r, t.team, 'team', v_seat)));
  END IF;
  IF v_all THEN
    v_views := v_views || jsonb_build_object('key', 'all', 'label', 'All requests', 'count', (SELECT count(*) FROM public.cockpit_requests));
  END IF;
  IF p_view = 'assigned' AND NOT v_linked THEN
    v_note := 'Your seat is not linked to a ClickUp user, so requests assigned to you cannot show. Ask the systems manager to link it.';
  ELSIF p_view = 'team' AND jsonb_array_length(v_teams) = 0 THEN
    v_note := 'Your seat has no team queue. Use My requests to see what you asked for.';
  END IF;
  SELECT coalesce(jsonb_agg(public.cockpit_request_row(x.req, v_seat) ORDER BY x.open DESC, x.due_on ASC NULLS LAST, x.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT r AS req, (r.done_at IS NULL AND r.state NOT IN ('cancelled','routed')) AS open, r.due_on, r.created_at
            FROM public.cockpit_requests r JOIN public.cockpit_request_types t ON t.key = r.type_key
           WHERE public.cockpit_request_in_view(r, t.team, p_view, v_seat)
           ORDER BY (r.done_at IS NULL AND r.state NOT IN ('cancelled','routed')) DESC, r.due_on ASC NULLS LAST, r.created_at DESC
           LIMIT v_limit) x;
  RETURN jsonb_build_object('asOf', now(), 'view', p_view, 'views', v_views, 'rows', v_rows, 'note', v_note);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_get(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_cu bigint := CASE WHEN jsonb_typeof(v_seat->'clickupUserId') = 'number' THEN (v_seat->>'clickupUserId')::bigint END;
  v_teams jsonb := coalesce(v_seat->'teams', '[]'::jsonb);
  r public.cockpit_requests; t public.cockpit_request_types; v_team text;
  v_answers jsonb; v_details text; v_history jsonb;
BEGIN
  SELECT * INTO r FROM public.cockpit_requests WHERE id = p_request_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'That request is not in the cockpit. Reload the list.' USING ERRCODE = '22023'; END IF;
  SELECT tt.team INTO v_team FROM public.cockpit_request_types tt WHERE tt.key = r.type_key;
  IF NOT (r.requester_member_id::text IS NOT DISTINCT FROM v_seat->>'memberId'
          OR coalesce((v_seat->>'isEditor')::boolean, false) OR coalesce((v_seat->>'isAdmin')::boolean, false)
          OR coalesce((v_seat->>'isCeo')::boolean, false)
          OR v_teams ? coalesce(v_team, '')
          OR EXISTS (SELECT 1 FROM public.cockpit_request_parts p WHERE p.request_id = r.id
                      AND (v_teams ? p.team
                           OR (v_cu IS NOT NULL AND (p.owner_clickup_id = v_cu OR v_cu = ANY(coalesce(p.assignee_ids, '{}'))))))) THEN
    RAISE EXCEPTION 'This request is not yours to see. Ask the person who raised it.' USING ERRCODE = '42501';
  END IF;
  t := public.cockpit_request_type_at(r.type_key, r.type_version);
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', f->>'key', 'label', f->>'label',
           'display', public.cockpit_request_answer_display(f, r.answers->(f->>'key'))) ORDER BY n), '[]'::jsonb)
    INTO v_answers FROM jsonb_array_elements(t.fields) WITH ORDINALITY AS x(f, n)
   WHERE f->>'kind' NOT IN ('client','details','deadline','priority') AND public.cockpit_request_answered(r.answers->(f->>'key'));
  SELECT public.cockpit_request_answer_display(f, r.answers->(f->>'key')) INTO v_details
    FROM jsonb_array_elements(t.fields) f WHERE f->>'kind' = 'details' LIMIT 1;
  v_details := coalesce(v_details, nullif(btrim(r.answers->>'details'), ''));
  SELECT coalesce(jsonb_agg(jsonb_build_object('at', h.at, 'what', h.what, 'byLabel', h.by_label) ORDER BY h.at, h.what), '[]'::jsonb)
    INTO v_history
    FROM (
      SELECT a.created_at AS at,
             CASE a.action WHEN 'request.submitted' THEN 'Sent from the cockpit'
                           WHEN 'request.cancelled' THEN 'Cancelled: ' || coalesce(a.after->>'cancel_reason', '')
                           WHEN 'request.imported' THEN 'Came in through the old ClickUp form'
                           WHEN 'request.routed' THEN 'Routed as a new request'
                           ELSE a.action END AS what,
             public.cockpit_request_by_label(a.actor_email) AS by_label
        FROM public.cockpit_audit_log a
       WHERE a.entity_type = 'cockpit_requests'
         AND (a.entity_id = r.id::text OR (a.action = 'request.imported' AND a.metadata->'requestIds' ? r.id::text))
      UNION ALL
      SELECT a.created_at,
             public.cockpit_request_team_label(p.team) || ': ' ||
             CASE WHEN q.kind = 'task_action' THEN
                    CASE a.after->>'state' WHEN 'delivered' THEN 'owner checked two minutes after it was made'
                                           WHEN 'failed' THEN 'the owner check failed'
                                           WHEN 'skipped' THEN 'the owner check was not run'
                                           ELSE 'owner check ' || (a.after->>'state') END
                  ELSE
                    CASE a.after->>'state' WHEN 'delivered' THEN 'made in ClickUp'
                                           WHEN 'dry_run' THEN 'held as a test run, not sent to ClickUp'
                                           WHEN 'retry' THEN 'ClickUp asked to wait, trying again'
                                           WHEN 'unknown' THEN 'ClickUp did not answer, checking'
                                           WHEN 'failed' THEN 'did not reach ClickUp'
                                           WHEN 'skipped' THEN 'not sent'
                                           WHEN 'queued' THEN 'queued again'
                                           ELSE a.after->>'state' END
             END,
             public.cockpit_request_by_label(a.actor_email)
        FROM public.cockpit_audit_log a
        JOIN public.cockpit_clickup_writeback_queue q ON q.id::text = a.entity_id
        JOIN public.cockpit_request_parts p ON p.request_id = r.id AND p.part = q.payload->>'part'
       WHERE a.entity_type = 'cockpit_clickup_writeback_queue' AND a.action LIKE 'update:%'
         AND q.source_table = 'cockpit_requests' AND q.source_id = r.id::text
    ) h;
  RETURN public.cockpit_request_row(r, v_seat) || jsonb_build_object('answers', v_answers, 'details', v_details,
    'replacesTaskId', r.replaces_task_id, 'routedTo', r.routed_to, 'history', v_history);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_type_save(p_key text, p_patch jsonb, p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_gate jsonb := public.cockpit_forms_editor_gate();
  v_email text := lower(btrim(v_gate->>'email'));
  t public.cockpit_request_types; n public.cockpit_request_types; k text;
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'There is nothing to save.' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('label','targets','fields','sop_steps','sop_url','due_days','priority','set_request_type','enabled') THEN
      RAISE EXCEPTION USING MESSAGE = 'That change is not allowed here: ' || k || '.', ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT * INTO t FROM public.cockpit_request_types WHERE key = p_key FOR UPDATE;
  IF t.key IS NULL THEN RAISE EXCEPTION 'That request type does not exist. Reload the page.' USING ERRCODE = '22023'; END IF;
  IF p_expected_version IS DISTINCT FROM t.version THEN
    RAISE EXCEPTION 'Someone saved this type since you opened it. Reload to see their change.' USING ERRCODE = '40001';
  END IF;
  n := t;
  IF p_patch ? 'label' THEN
    IF jsonb_typeof(p_patch->'label') <> 'string' THEN RAISE EXCEPTION 'The name must be text.' USING ERRCODE = '22023'; END IF;
    n.label := btrim(p_patch->>'label');
  END IF;
  IF p_patch ? 'targets' THEN
    IF jsonb_typeof(p_patch->'targets') <> 'array' THEN RAISE EXCEPTION 'The parts could not be read. Reload and try again.' USING ERRCODE = '22023'; END IF;
    n.targets := public.cockpit_request_targets_checked(p_patch->'targets', t.targets);
  END IF;
  IF p_patch ? 'fields' THEN
    IF jsonb_typeof(p_patch->'fields') <> 'array' THEN RAISE EXCEPTION 'The questions could not be read. Reload and try again.' USING ERRCODE = '22023'; END IF;
    n.fields := p_patch->'fields';
  END IF;
  IF p_patch ? 'sop_steps' THEN
    IF jsonb_typeof(p_patch->'sop_steps') = 'null' THEN
      n.sop_steps := NULL; n.sop_steps_state := 'none';
    ELSIF jsonb_typeof(p_patch->'sop_steps') = 'array' THEN
      n.sop_steps := CASE WHEN jsonb_array_length(p_patch->'sop_steps') = 0 THEN NULL ELSE p_patch->'sop_steps' END;
      n.sop_steps_state := CASE WHEN n.sop_steps IS NULL THEN 'none' ELSE 'saved' END;
    ELSE
      RAISE EXCEPTION 'The SOP steps could not be read. Reload and try again.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_patch ? 'sop_url' THEN
    IF jsonb_typeof(p_patch->'sop_url') NOT IN ('string','null') THEN RAISE EXCEPTION 'The SOP link must be text.' USING ERRCODE = '22023'; END IF;
    n.sop_url := nullif(btrim(coalesce(p_patch->>'sop_url', '')), '');
  END IF;
  IF p_patch ? 'due_days' THEN
    IF jsonb_typeof(p_patch->'due_days') <> 'number' OR p_patch->>'due_days' !~ '^[0-9]{1,2}$' OR (p_patch->>'due_days')::integer > 60 THEN
      RAISE EXCEPTION 'Due in must be 0 to 60 working days.' USING ERRCODE = '22023';
    END IF;
    n.due_days := (p_patch->>'due_days')::smallint;
  END IF;
  IF p_patch ? 'priority' THEN
    IF coalesce(p_patch->>'priority', '') NOT IN ('urgent','high','normal','low') THEN
      RAISE EXCEPTION 'Pick a priority: urgent, high, normal or low.' USING ERRCODE = '22023';
    END IF;
    n.priority := p_patch->>'priority';
  END IF;
  IF p_patch ? 'set_request_type' THEN
    IF jsonb_typeof(p_patch->'set_request_type') <> 'boolean' THEN RAISE EXCEPTION 'Set Request Type must be on or off.' USING ERRCODE = '22023'; END IF;
    n.set_request_type := (p_patch->>'set_request_type')::boolean;
  END IF;
  IF p_patch ? 'enabled' THEN
    IF jsonb_typeof(p_patch->'enabled') <> 'boolean' THEN RAISE EXCEPTION 'The type must be on or off.' USING ERRCODE = '22023'; END IF;
    n.enabled := (p_patch->>'enabled')::boolean;
  END IF;
  UPDATE public.cockpit_request_types SET label = n.label, targets = n.targets, fields = n.fields, sop_steps = n.sop_steps,
    sop_steps_state = n.sop_steps_state, sop_url = n.sop_url, due_days = n.due_days, priority = n.priority,
    set_request_type = n.set_request_type, enabled = n.enabled, version = t.version + 1, updated_by = v_email, updated_at = now()
   WHERE key = p_key RETURNING * INTO n;
  INSERT INTO public.cockpit_request_type_versions(key, version, "row", saved_by, note)
  VALUES (n.key, n.version, to_jsonb(n), v_email, 'Saved');
  PERFORM public.cockpit_request_audit('request_type.saved', 'cockpit_request_types', n.key, v_email, to_jsonb(t), to_jsonb(n),
    jsonb_build_object('version', n.version, 'keys', (SELECT jsonb_agg(x ORDER BY x) FROM jsonb_object_keys(p_patch) x)));
  RETURN public.cockpit_request_type_view(n, true);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_type_versions(p_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_gate jsonb := public.cockpit_forms_editor_gate(); v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_request_types t WHERE t.key = p_key) THEN
    RAISE EXCEPTION 'That request type does not exist. Reload the page.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'savedAt', v.saved_at,
           'savedByLabel', public.cockpit_request_by_label(v.saved_by), 'note', v.note) ORDER BY v.version DESC), '[]'::jsonb)
    INTO v FROM public.cockpit_request_type_versions v WHERE v.key = p_key;
  RETURN jsonb_build_object('versions', v);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_type_restore(p_key text, p_version integer, p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_gate jsonb := public.cockpit_forms_editor_gate();
  v_email text := lower(btrim(v_gate->>'email'));
  t public.cockpit_request_types; n public.cockpit_request_types; v_row jsonb; o public.cockpit_request_types;
BEGIN
  SELECT * INTO t FROM public.cockpit_request_types WHERE key = p_key FOR UPDATE;
  IF t.key IS NULL THEN RAISE EXCEPTION 'That request type does not exist. Reload the page.' USING ERRCODE = '22023'; END IF;
  IF p_expected_version IS DISTINCT FROM t.version THEN
    RAISE EXCEPTION 'Someone saved this type since you opened it. Reload to see their change.' USING ERRCODE = '40001';
  END IF;
  SELECT v."row" INTO v_row FROM public.cockpit_request_type_versions v WHERE v.key = p_key AND v.version = p_version;
  IF v_row IS NULL THEN RAISE EXCEPTION 'That version does not exist. Reload the versions.' USING ERRCODE = '22023'; END IF;
  o := jsonb_populate_record(NULL::public.cockpit_request_types, v_row);
  UPDATE public.cockpit_request_types SET label = o.label,
    targets = public.cockpit_request_targets_checked(o.targets, t.targets), fields = o.fields,
    sop_steps = o.sop_steps, sop_steps_state = o.sop_steps_state, sop_url = o.sop_url, due_days = o.due_days,
    priority = o.priority, set_request_type = o.set_request_type, enabled = o.enabled,
    version = t.version + 1, updated_by = v_email, updated_at = now()
   WHERE key = p_key RETURNING * INTO n;
  INSERT INTO public.cockpit_request_type_versions(key, version, "row", saved_by, note)
  VALUES (n.key, n.version, to_jsonb(n), v_email, 'Back to version ' || p_version);
  PERFORM public.cockpit_request_audit('request_type.restored', 'cockpit_request_types', n.key, v_email, to_jsonb(t), to_jsonb(n),
    jsonb_build_object('version', n.version, 'from_version', p_version));
  RETURN public.cockpit_request_type_view(n, true);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_people()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_gate jsonb := public.cockpit_forms_editor_gate(); v jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('clickupUserId', c.clickup_user_id,
           'label', coalesce(nullif(btrim(c.username), ''), 'ClickUp user ' || c.clickup_user_id),
           'seat', (SELECT jsonb_build_object('memberId', m.id, 'label', public.cockpit_slack_notice_seat_label(m.email, m.name))
                      FROM public.cockpit_member_clickup l JOIN public.cockpit_members m ON m.id = l.member_id
                     WHERE l.clickup_user_id = c.clickup_user_id AND l.state IN ('ok','manual') AND m.active
                     ORDER BY m.updated_at DESC LIMIT 1))
           ORDER BY lower(coalesce(c.username, '')), c.clickup_user_id), '[]'::jsonb)
    INTO v FROM public.cockpit_clickup_members c WHERE c.active;
  RETURN jsonb_build_object('people', v);
END $$;

-- One seat's link as the People in ClickUp tab shows it.
CREATE OR REPLACE FUNCTION public.cockpit_member_clickup_seat(p_member_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('memberId', m.id, 'label', public.cockpit_slack_notice_seat_label(m.email, m.name),
    'roles', to_jsonb(m.roles),
    'link', (SELECT jsonb_build_object('state', l.state, 'clickupUserId', l.clickup_user_id,
               'username', (SELECT c.username FROM public.cockpit_clickup_members c WHERE c.clickup_user_id = l.clickup_user_id),
               'matchedBy', l.matched_by, 'note', l.note, 'checkedAt', l.checked_at)
               FROM public.cockpit_member_clickup l WHERE l.member_id = m.id))
    FROM public.cockpit_members m WHERE m.id = p_member_id
$$;

CREATE OR REPLACE FUNCTION public.cockpit_member_clickup_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_gate jsonb := public.cockpit_forms_editor_gate(); v_seats jsonb; v_members jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(public.cockpit_member_clickup_seat(m.id) ORDER BY lower(m.email)), '[]'::jsonb)
    INTO v_seats FROM public.cockpit_members m WHERE m.active;
  SELECT coalesce(jsonb_agg(jsonb_build_object('clickupUserId', c.clickup_user_id, 'username', c.username,
           'linkedTo', (SELECT l.member_id FROM public.cockpit_member_clickup l JOIN public.cockpit_members m ON m.id = l.member_id
                         WHERE l.clickup_user_id = c.clickup_user_id AND l.state IN ('ok','manual') AND m.active
                         ORDER BY m.updated_at DESC LIMIT 1))
           ORDER BY lower(coalesce(c.username, '')), c.clickup_user_id), '[]'::jsonb)
    INTO v_members FROM public.cockpit_clickup_members c WHERE c.active;
  RETURN jsonb_build_object('readAt', (SELECT max(c.seen_at) FROM public.cockpit_clickup_members c),
    'seats', v_seats, 'members', v_members);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_member_clickup_set(p_member_id uuid, p_clickup_user_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_gate jsonb := public.cockpit_forms_editor_gate(); v_email text := lower(btrim(v_gate->>'email'));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_members m WHERE m.id = p_member_id AND m.active) THEN
    RAISE EXCEPTION 'Choose an active seat.' USING ERRCODE = '22023';
  END IF;
  IF p_clickup_user_id IS NULL THEN
    INSERT INTO public.cockpit_member_clickup(member_id, clickup_user_id, state, matched_by, note, checked_at, updated_by, updated_at)
    VALUES (p_member_id, NULL, 'cleared', 'editor', 'An editor said this seat has no ClickUp user.', now(), v_email, now())
    ON CONFLICT (member_id) DO UPDATE SET clickup_user_id = NULL, state = 'cleared', matched_by = 'editor',
      note = EXCLUDED.note, checked_at = now(), updated_by = v_email, updated_at = now();
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_clickup_members c WHERE c.clickup_user_id = p_clickup_user_id AND c.active) THEN
      RAISE EXCEPTION 'That person is not in the ClickUp workspace. Pick someone from the list.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cockpit_member_clickup(member_id, clickup_user_id, state, matched_by, note, checked_at, updated_by, updated_at)
    VALUES (p_member_id, p_clickup_user_id, 'manual', 'editor', 'Set by an editor.', now(), v_email, now())
    ON CONFLICT (member_id) DO UPDATE SET clickup_user_id = EXCLUDED.clickup_user_id, state = 'manual', matched_by = 'editor',
      note = EXCLUDED.note, checked_at = now(), updated_by = v_email, updated_at = now();
  END IF;
  RETURN public.cockpit_member_clickup_seat(p_member_id);
END $$;

-- ---------------------------------------------------------------------------
-- 6. Service RPCs (clickup-writeback job requests and cockpit-tasks)

-- The requests job's claim: request and task_action rows only, one lane per
-- ClickUp task (a row waits while an older row for the same task is open).
CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_claim_requests(p_token uuid, p_limit integer DEFAULT 6)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE out jsonb;
BEGIN
  IF p_token IS NULL THEN RAISE EXCEPTION 'A claim token is required'; END IF;
  WITH picked AS (
    SELECT q.id FROM public.cockpit_clickup_writeback_queue q
     WHERE q.kind IN ('request','task_action')
       AND ((q.state IN ('queued','retry','unknown') AND q.next_attempt_at <= now())
         OR (q.state = 'sending' AND q.claimed_at < now() - interval '10 minutes'))
       AND (q.task_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.cockpit_clickup_writeback_queue o
              WHERE o.task_id = q.task_id AND o.id <> q.id AND o.kind IN ('request','task_action')
                AND o.state IN ('queued','sending','retry','unknown')
                -- The two-minute check waits for its time and only reads the task, so until
                -- it is due it holds nobody's tick, comment or Mark done behind it.
                AND NOT (o.payload->>'op' = 'verify' AND o.state IN ('queued','retry') AND o.next_attempt_at > now())
                AND (o.created_at < q.created_at OR (o.created_at = q.created_at AND o.id < q.id))))
     ORDER BY q.created_at, q.id
     LIMIT greatest(1, least(coalesce(p_limit, 6), 10))
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.cockpit_clickup_writeback_queue q
       SET state = 'sending', claim_token = p_token, claimed_at = now(), attempts = q.attempts + 1, updated_at = now()
      FROM picked WHERE q.id = picked.id
    RETURNING q.*
  )
  SELECT coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('source_exists', CASE c.kind
      WHEN 'request' THEN EXISTS (SELECT 1 FROM public.cockpit_requests r WHERE r.id::text = c.source_id AND r.state <> 'cancelled')
      ELSE true END) ORDER BY c.created_at, c.id), '[]'::jsonb)
    INTO out FROM claimed c;
  RETURN out;
END $$;

-- The second source: a part still queued with no queue row gets one, from
-- the type version the request was made on and the owner it was shown.
CREATE OR REPLACE FUNCTION public.cockpit_request_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.cockpit_request_parts; r public.cockpit_requests; t public.cockpit_request_types;
        v_plan jsonb; v_e jsonb; v_payload jsonb; v_queue uuid; v_n integer := 0; v_k integer;
BEGIN
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  FOR p IN SELECT * FROM public.cockpit_request_parts x WHERE x.state = 'queued' AND x.queue_id IS NULL ORDER BY x.created_at LOOP
    SELECT * INTO r FROM public.cockpit_requests WHERE id = p.request_id;
    CONTINUE WHEN r.id IS NULL OR r.state IN ('cancelled','imported','routed');
    t := public.cockpit_request_type_at(r.type_key, r.type_version);
    v_plan := public.cockpit_request_plan(t, r.id, r.client_task_id, r.client_name, r.answers, r.due_on, r.priority,
      r.requester_label, r.replaces_task_id);
    SELECT e INTO v_e FROM jsonb_array_elements(v_plan) e WHERE e->>'part' = p.part LIMIT 1;
    CONTINUE WHEN v_e IS NULL;
    v_payload := (v_e->'payload') || jsonb_build_object('ownerClickupId', p.owner_clickup_id, 'ownerLabel', p.owner_label,
      'taskName', p.task_name);
    INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, campaign_name, payload)
    VALUES ('request:' || r.id::text || ':' || p.part, 'request', 'cockpit_requests', r.id::text, NULL, v_payload)
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
    SELECT q.id INTO v_queue FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = 'request:' || r.id::text || ':' || p.part;
    UPDATE public.cockpit_request_parts SET queue_id = v_queue, updated_at = now() WHERE request_id = p.request_id AND part = p.part;
    v_e := NULL;
  END LOOP;
  RETURN v_n;
END $$;

-- Every run of the requests job reports its mode here (contract 2.6).
CREATE OR REPLACE FUNCTION public.cockpit_clickup_requests_state(p_ok boolean, p_note text, p_mode text, p_only_cards text[], p_counts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(p_mode, '') NOT IN ('dry_run','apply','apply_limited') THEN
    RAISE EXCEPTION 'Unsupported requests mode' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_sync_state AS s(key, last_run_at, last_ok_at, ok, note, detail, updated_at)
  VALUES ('clickup-writeback:requests', now(), CASE WHEN p_ok THEN now() END, coalesce(p_ok, false), left(p_note, 500),
    jsonb_build_object('mode', p_mode, 'onlyCards', to_jsonb(coalesce(p_only_cards, '{}'::text[])),
      'counts', CASE WHEN jsonb_typeof(p_counts) = 'object' THEN p_counts ELSE '{}'::jsonb END, 'at', now()),
    now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_ok_at = coalesce(EXCLUDED.last_ok_at, s.last_ok_at),
    ok = EXCLUDED.ok, note = EXCLUDED.note, detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_doctor_inputs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'types', coalesce((SELECT jsonb_agg(jsonb_build_object('key', t.key, 'optionId', t.request_type_option_id,
        'optionName', t.clickup_option_name, 'setRequestType', t.set_request_type, 'enabled', t.enabled,
        'targets', (SELECT jsonb_agg(jsonb_build_object('part', g->>'part', 'listId', g->>'list_id', 'templateId', g->>'template_id',
                       'ownerClickupId', g->'owner_clickup_id') ORDER BY n)
                      FROM jsonb_array_elements(t.targets) WITH ORDINALITY AS x(g, n)),
        'fieldIds', coalesce((SELECT jsonb_agg(DISTINCT f->>'clickup_field_id')
                                FROM jsonb_array_elements(t.fields) f WHERE f->>'clickup_field_id' IS NOT NULL), '[]'::jsonb))
        ORDER BY t.type_index) FROM public.cockpit_request_types t), '[]'::jsonb),
    'templates', coalesce((SELECT jsonb_agg(jsonb_build_object('id', tp.id, 'name', tp.name) ORDER BY tp.id)
                             FROM public.cockpit_request_templates tp), '[]'::jsonb),
    'lists', public.cockpit_request_lists())
$$;

-- The 2-minute check found ClickUp moved or renamed a task after its
-- Request Type was set: Request Type goes off for that type.
CREATE OR REPLACE FUNCTION public.cockpit_request_type_rt_off(p_key text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.cockpit_request_types; n public.cockpit_request_types; v_note text := left(coalesce(nullif(btrim(p_note), ''), 'Request Type turned off by the requests writer.'), 240);
BEGIN
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  SELECT * INTO t FROM public.cockpit_request_types WHERE key = p_key FOR UPDATE;
  IF t.key IS NULL THEN RAISE EXCEPTION 'Unknown request type' USING ERRCODE = '22023'; END IF;
  IF NOT t.set_request_type THEN RETURN; END IF;
  UPDATE public.cockpit_request_types SET set_request_type = false, version = t.version + 1, updated_by = 'clickup-writeback', updated_at = now()
   WHERE key = p_key RETURNING * INTO n;
  INSERT INTO public.cockpit_request_type_versions(key, version, "row", saved_by, note)
  VALUES (n.key, n.version, to_jsonb(n), 'clickup-writeback', v_note);
  PERFORM public.cockpit_request_audit('request_type.request_type_off', 'cockpit_request_types', n.key, 'clickup-writeback',
    to_jsonb(t), to_jsonb(n), jsonb_build_object('version', n.version, 'note', v_note));
END $$;

-- The workspace members, hourly; then each seat's link by exact email.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_members_sync(p_members jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m record; v_ids bigint[]; v_state text; v_id bigint; v_note text;
  v_members integer; v_linked integer; v_not_found integer; v_ambiguous integer;
BEGIN
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  PERFORM set_config('cockpit.audit_actor', 'cockpit-tasks', true);
  IF jsonb_typeof(p_members) IS DISTINCT FROM 'array' OR jsonb_array_length(p_members) = 0 THEN
    RAISE EXCEPTION 'The ClickUp member list came back empty; nothing was changed.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_members) e
              WHERE jsonb_typeof(e) <> 'object' OR coalesce(e->>'id', '') !~ '^[1-9][0-9]{0,17}$') THEN
    RAISE EXCEPTION 'A ClickUp member has no readable id; nothing was changed.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_clickup_members AS c(clickup_user_id, username, email, active, seen_at)
  SELECT DISTINCT ON ((e->>'id')::bigint) (e->>'id')::bigint, nullif(btrim(e->>'username'), ''),
         nullif(lower(btrim(e->>'email')), ''), true, now()
    FROM jsonb_array_elements(p_members) e
   ORDER BY (e->>'id')::bigint
  ON CONFLICT (clickup_user_id) DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email, active = true, seen_at = now();
  UPDATE public.cockpit_clickup_members c SET active = false
   WHERE c.active AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_members) e WHERE (e->>'id')::bigint = c.clickup_user_id);
  FOR m IN SELECT s.id, lower(btrim(s.email)) AS email FROM public.cockpit_members s
            WHERE s.active AND NOT EXISTS (SELECT 1 FROM public.cockpit_member_clickup l
                                            WHERE l.member_id = s.id AND l.state IN ('manual','cleared')) LOOP
    SELECT array_agg(c.clickup_user_id ORDER BY c.clickup_user_id) INTO v_ids FROM public.cockpit_clickup_members c
     WHERE c.active AND c.email = m.email;
    IF coalesce(cardinality(v_ids), 0) = 1 THEN
      v_state := 'ok'; v_id := v_ids[1]; v_note := 'Matched by email.';
    ELSIF coalesce(cardinality(v_ids), 0) = 0 THEN
      v_state := 'not_found'; v_id := NULL; v_note := 'No ClickUp member has this seat''s email. Link it by hand.';
    ELSE
      v_state := 'ambiguous'; v_id := NULL; v_note := 'Two ClickUp members have this seat''s email. Pick one by hand.';
    END IF;
    INSERT INTO public.cockpit_member_clickup AS l(member_id, clickup_user_id, state, matched_by, note, checked_at, updated_by, updated_at)
    VALUES (m.id, v_id, v_state, 'email', v_note, now(), 'cockpit-tasks', now())
    ON CONFLICT (member_id) DO UPDATE SET clickup_user_id = EXCLUDED.clickup_user_id, state = EXCLUDED.state,
      matched_by = 'email', note = EXCLUDED.note, checked_at = now(),
      updated_by = CASE WHEN l.state IS DISTINCT FROM EXCLUDED.state OR l.clickup_user_id IS DISTINCT FROM EXCLUDED.clickup_user_id
                        THEN 'cockpit-tasks' ELSE l.updated_by END,
      updated_at = CASE WHEN l.state IS DISTINCT FROM EXCLUDED.state OR l.clickup_user_id IS DISTINCT FROM EXCLUDED.clickup_user_id
                        THEN now() ELSE l.updated_at END;
  END LOOP;
  SELECT count(*) INTO v_members FROM public.cockpit_clickup_members c WHERE c.active;
  SELECT count(*) FILTER (WHERE l.state IN ('ok','manual')), count(*) FILTER (WHERE l.state = 'not_found'),
         count(*) FILTER (WHERE l.state = 'ambiguous')
    INTO v_linked, v_not_found, v_ambiguous
    FROM public.cockpit_member_clickup l JOIN public.cockpit_members s ON s.id = l.member_id WHERE s.active;
  PERFORM public.cockpit_request_audit('clickup_members.synced', 'cockpit_clickup_members', NULL, 'cockpit-tasks', NULL, NULL,
    jsonb_build_object('members', v_members, 'linked', v_linked, 'notFound', v_not_found, 'ambiguous', v_ambiguous));
  RETURN jsonb_build_object('members', v_members, 'linked', v_linked, 'notFound', v_not_found, 'ambiguous', v_ambiguous);
END $$;

-- The folder fields as GET list/901816723190/field reads them. Adds no field.
CREATE OR REPLACE FUNCTION public.cockpit_request_field_catalog_sync(p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_updated integer; v_missing integer;
BEGIN
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields) = 0 THEN
    RAISE EXCEPTION 'The ClickUp field list came back empty; nothing was changed.' USING ERRCODE = '22023';
  END IF;
  WITH seen AS (
    SELECT DISTINCT ON (e->>'id') e->>'id' AS id, e->>'name' AS name, e->'options' AS options
      FROM jsonb_array_elements(p_fields) e WHERE jsonb_typeof(e) = 'object' AND e->>'id' IS NOT NULL
     ORDER BY e->>'id'
  ), upd AS (
    UPDATE public.cockpit_request_field_catalog c SET
      clickup_name = coalesce(nullif(btrim(s.name), ''), c.clickup_name),
      options = CASE WHEN c.kind = 'select' AND jsonb_typeof(s.options) = 'array'
                     THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', o->>'id', 'name', o->>'name') ORDER BY n), '[]'::jsonb)
                             FROM jsonb_array_elements(s.options) WITH ORDINALITY AS x(o, n) WHERE o->>'id' IS NOT NULL)
                     ELSE c.options END,
      state = 'ok', read_at = now(), updated_at = now()
      FROM seen s WHERE c.clickup_field_id::text = s.id
    RETURNING c.clickup_field_id
  )
  SELECT count(*) INTO v_updated FROM upd;
  UPDATE public.cockpit_request_field_catalog c SET state = 'missing', updated_at = now()
   WHERE c.state <> 'missing'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_fields) e WHERE e->>'id' = c.clickup_field_id::text);
  SELECT count(*) INTO v_missing FROM public.cockpit_request_field_catalog c WHERE c.state = 'missing';
  PERFORM public.cockpit_request_audit('request_fields.synced', 'cockpit_request_field_catalog', NULL, 'cockpit-tasks', NULL, NULL,
    jsonb_build_object('updated', v_updated, 'missing', v_missing));
  RETURN jsonb_build_object('updated', v_updated, 'missing', v_missing);
END $$;

-- The template objects, hourly (id and name only).
CREATE OR REPLACE FUNCTION public.cockpit_request_templates_sync(p_templates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seen integer; v_missing integer;
BEGIN
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  IF jsonb_typeof(p_templates) IS DISTINCT FROM 'array' OR jsonb_array_length(p_templates) = 0 THEN
    RAISE EXCEPTION 'The ClickUp template list came back empty; nothing was changed.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_request_templates AS tp(id, name, state, seen_at)
  SELECT DISTINCT ON (e->>'id') e->>'id', btrim(e->>'name'), 'ok', now()
    FROM jsonb_array_elements(p_templates) e
   WHERE jsonb_typeof(e) = 'object' AND coalesce(e->>'id', '') ~ '^t-[a-z0-9]{6,20}$' AND btrim(coalesce(e->>'name', '')) <> ''
   ORDER BY e->>'id'
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, state = 'ok', seen_at = now();
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  UPDATE public.cockpit_request_templates tp SET state = 'missing'
   WHERE tp.state <> 'missing' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_templates) e WHERE e->>'id' = tp.id);
  SELECT count(*) INTO v_missing FROM public.cockpit_request_templates tp WHERE tp.state = 'missing';
  PERFORM public.cockpit_request_audit('request_templates.synced', 'cockpit_request_templates', NULL, 'cockpit-tasks', NULL, NULL,
    jsonb_build_object('seen', v_seen, 'missing', v_missing));
  RETURN jsonb_build_object('seen', v_seen, 'missing', v_missing);
END $$;

-- The old form's tickets that sit in All Tasks (contract 2.10). One audit row a run.
CREATE OR REPLACE FUNCTION public.cockpit_request_import(p_tasks jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e jsonb; t public.cockpit_request_types; v_id uuid; v_card text; v_client text; v_cards text[];
  v_answers jsonb; v_due date; v_priority text; v_created timestamptz; v_imported jsonb := '[]'::jsonb; v_ids jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  IF jsonb_typeof(p_tasks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'The All Tasks read could not be understood; nothing was imported.' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_tasks) x LOOP
    IF jsonb_typeof(e) <> 'object' OR coalesce(e->>'taskId', '') !~ '^[A-Za-z0-9_-]{1,40}$' THEN
      v_skipped := v_skipped || jsonb_build_object('taskId', e->>'taskId', 'why', 'Unreadable task id');
      CONTINUE;
    END IF;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.cockpit_requests r WHERE r.imported_task_id = e->>'taskId')
               OR EXISTS (SELECT 1 FROM public.cockpit_request_parts p WHERE p.clickup_task_id = e->>'taskId');
    SELECT * INTO t FROM public.cockpit_request_types x WHERE x.request_type_option_id::text = e->>'optionId';
    IF t.key IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('taskId', e->>'taskId', 'why', 'Unknown request type');
      CONTINUE;
    END IF;
    SELECT array_agg(DISTINCT o.clickup_task_id) INTO v_cards FROM public.cockpit_client_onboarding o
     WHERE lower(btrim(o.client_name)) IN (SELECT lower(btrim(tag)) FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(e->'tags') = 'array' THEN e->'tags' ELSE '[]'::jsonb END) tag);
    v_card := CASE WHEN coalesce(cardinality(v_cards), 0) = 1 THEN v_cards[1] END;
    v_client := NULL;
    IF v_card IS NOT NULL THEN SELECT o.client_name INTO v_client FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_card; END IF;
    v_answers := CASE WHEN nullif(btrim(coalesce(e->>'description', '')), '') IS NOT NULL
                      THEN jsonb_build_object('details', left(btrim(e->>'description'), 4000)) ELSE '{}'::jsonb END;
    v_due := CASE WHEN coalesce(e->>'dueAt', '') ~ '^[0-9]{10,15}$'
                  THEN (to_timestamp((e->>'dueAt')::bigint / 1000.0) AT TIME ZONE 'Asia/Kuwait')::date END;
    v_priority := CASE WHEN lower(coalesce(e->>'priority', '')) IN ('urgent','high','normal','low') THEN lower(e->>'priority') ELSE t.priority END;
    v_created := CASE WHEN coalesce(e->>'dateCreated', '') ~ '^[0-9]{10,15}$' THEN to_timestamp((e->>'dateCreated')::bigint / 1000.0) ELSE now() END;
    v_id := gen_random_uuid();
    INSERT INTO public.cockpit_requests(id, type_key, type_version, type_label, requester_member_id, requester_email, requester_label,
      source, client_task_id, client_name, answers, due_on, priority, state, imported_task_id, content_hash, created_at, updated_at)
    VALUES (v_id, t.key, t.version, t.label, NULL, NULL, 'the old ClickUp form', 'import', v_card, v_client, v_answers, v_due,
      v_priority, 'imported', e->>'taskId', public.cockpit_request_hash(t.key, v_card, v_answers, v_due, v_priority, NULL), v_created, now());
    INSERT INTO public.cockpit_request_parts(request_id, part, list_id, team, task_name, owner_rule, owner_clickup_id, owner_how,
      owner_label, state, clickup_task_id, clickup_url, status, status_type, mirrored_at)
    VALUES (v_id, 'main', '901816723226', 'all_tasks', left(coalesce(nullif(btrim(e->>'name'), ''), t.label), 200),
      t.targets->0->>'owner_rule', NULL, 'import', 'Nobody yet', 'imported', e->>'taskId',
      coalesce(nullif(e->>'url', ''), 'https://app.clickup.com/t/' || (e->>'taskId')), e->>'status', e->>'statusType', now());
    PERFORM public.cockpit_request_refresh(v_id);
    v_imported := v_imported || to_jsonb(e->>'taskId');
    v_ids := v_ids || to_jsonb(v_id::text);
  END LOOP;
  IF jsonb_array_length(v_imported) > 0 OR jsonb_array_length(v_skipped) > 0 THEN
    PERFORM public.cockpit_request_audit('request.imported', 'cockpit_requests', NULL, 'cockpit-tasks', NULL, NULL,
      jsonb_build_object('taskIds', v_imported, 'requestIds', v_ids, 'skipped', v_skipped));
  END IF;
  RETURN jsonb_build_object('imported', jsonb_array_length(v_imported), 'skipped', v_skipped);
END $$;

-- ---------------------------------------------------------------------------
-- 7. The minute schedule (only where pg_cron exists)

DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname=''mahara-clickup-writeback-requests''';
    EXECUTE $q$SELECT cron.schedule('mahara-clickup-writeback-requests','* * * * *',$job$SELECT public.cockpit_clickup_requests_kick();$job$)$q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (definer functions, triggers and pg_cron as owner).
  FOREACH f IN ARRAY ARRAY[
    'cockpit_request_lists()', 'cockpit_request_team_label(text)', 'cockpit_request_list_team(text)',
    'cockpit_request_team_order(text)', 'cockpit_request_teams(text[],boolean)',
    'cockpit_request_audit(text,text,text,text,jsonb,jsonb,jsonb)', 'cockpit_request_by_label(text)',
    'cockpit_request_seat()', 'cockpit_request_owner_label(bigint)', 'cockpit_request_usable_member(bigint)',
    'cockpit_request_person_by_role(text)', 'cockpit_request_owner(jsonb,text)', 'cockpit_request_due_default(integer)',
    'cockpit_request_day_words(date)', 'cockpit_request_type_problem(jsonb)', 'cockpit_request_field_options(jsonb)',
    'cockpit_request_answered(jsonb)', 'cockpit_request_answer_display(jsonb,jsonb)', 'cockpit_request_answer_value(jsonb,jsonb)',
    'cockpit_request_target_runs(jsonb,jsonb)', 'cockpit_request_step_count(public.cockpit_request_types,jsonb)',
    'cockpit_request_rule_label(jsonb)', 'cockpit_request_type_view(public.cockpit_request_types,boolean)',
    'cockpit_request_plan(public.cockpit_request_types,uuid,text,text,jsonb,date,text,text,text)',
    'cockpit_request_refresh(uuid)', 'cockpit_clickup_requests_mode()', 'cockpit_request_can_send(jsonb,text)',
    'cockpit_clickup_requests_kick()', 'cockpit_request_part_rank(text,text)', 'cockpit_request_part_row(public.cockpit_request_parts)',
    'cockpit_request_cancellable(public.cockpit_requests,jsonb)', 'cockpit_request_row(public.cockpit_requests,jsonb)',
    'cockpit_request_in_view(public.cockpit_requests,text,text,jsonb)',
    'cockpit_request_hash(text,text,jsonb,date,text,text)', 'cockpit_request_targets_checked(jsonb,jsonb)',
    'cockpit_request_type_at(text,integer)', 'cockpit_member_clickup_seat(uuid)',
    'cockpit_request_type_guard()', 'cockpit_request_refuse_delete()', 'cockpit_member_clickup_audit()',
    'cockpit_request_queue_sync()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- The writer's and the task mirror's RPCs, and the three replaced ones: the service key only.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_clickup_writeback_claim_requests(uuid,integer)', 'cockpit_request_sweep()',
    'cockpit_clickup_requests_state(boolean,text,text,text[],jsonb)', 'cockpit_request_doctor_inputs()',
    'cockpit_request_type_rt_off(text,text)', 'cockpit_clickup_members_sync(jsonb)',
    'cockpit_request_field_catalog_sync(jsonb)', 'cockpit_request_templates_sync(jsonb)', 'cockpit_request_import(jsonb)',
    'cockpit_clickup_writeback_begin(text,text,boolean)', 'cockpit_clickup_writeback_idle(text,boolean,text)',
    'cockpit_clickup_writeback_claim(uuid,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- The screens' RPCs: a signed-in seat, gated inside.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_request_types_read()', 'cockpit_request_clients(text,boolean)', 'cockpit_request_preview(text,text,jsonb)',
    'cockpit_request_submit(uuid,text,text,jsonb,date,text,text,text)', 'cockpit_request_cancel(uuid,text)',
    'cockpit_requests_read(text,integer)', 'cockpit_request_get(uuid)', 'cockpit_request_type_save(text,jsonb,integer)',
    'cockpit_request_type_versions(text)', 'cockpit_request_type_restore(text,integer,integer)', 'cockpit_request_people()',
    'cockpit_member_clickup_read()', 'cockpit_member_clickup_set(uuid,bigint)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
