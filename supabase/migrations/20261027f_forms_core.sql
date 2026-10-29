-- The forms backend: the 1-1 call notes in the cockpit (docs/forms/STAGE2-CONTRACT.md
-- section 2.1, docs/forms/PLAN.md 4.1 and 4.3). Creative Triage (bldgtotkfmhoxmlzowdx).
-- Additive; applies twice. Migration v of three: 20261027g_fathom_intake (w) and
-- 20261027h_checkin_plans (x) follow it.
--
-- 1. cockpit_forms and cockpit_form_versions: the registry (checkin, kickoff,
--    blueprint). provider says where the team fills a form today; one value
--    (checkin's provider) flips every entry point at the cut-over.
-- 2. cockpit_form_responses: one row per response. While the registry provider
--    of a form is not native every response is a shadow run, and a response
--    keeps its mode for good.
-- 3. cockpit_form_effects: the fan-out ledger. A submit plans one row per
--    effect; only an effect owned by the cockpit may be planned or delivered
--    (table CHECK and guard). In 2a every check-in effect is a shadow, so a
--    submit writes dry_run and skipped rows and nothing outside these tables.
-- 4. cockpit_form_drafts: the Fathom and AI drafts, keyed per recording and
--    client; one grade per recording, never rewritten once ready.
-- 5. cockpit_client_messages: the WhatsApp outbox, table and guard only.
--    Nothing writes it until 2b.
-- 6. The gated browser RPCs (entry, open, save, submit, discard, the two
--    reads), the draft service RPCs and the SQL-effect executor.
--
-- Row security is on for the six tables, every browser and default grant is
-- revoked, and the service role may only read them: every write goes through
-- the SECURITY DEFINER functions below and leaves one cockpit_audit_log row
-- (by trigger). Nothing is ever deleted.
--
-- Function language across the three files: v is applied before w, and w
-- before x, so every function here that names a w column or an x function is
-- plpgsql (its body is resolved when it runs, not when it is created).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables

-- The registry's effect list: at most 20 objects, each exactly
-- {key, owner, delivery, label}, keys distinct. Created before the table that
-- checks it.
CREATE OR REPLACE FUNCTION public.cockpit_forms_effects_valid(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e jsonb; v_keys text[] := '{}';
BEGIN
  IF p IS NULL OR jsonb_typeof(p) IS DISTINCT FROM 'array' OR jsonb_array_length(p) > 20 THEN RETURN false; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p) x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) IS DISTINCT FROM ARRAY['delivery','key','label','owner'] THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(e->'key') IS DISTINCT FROM 'string' OR jsonb_typeof(e->'owner') IS DISTINCT FROM 'string'
       OR jsonb_typeof(e->'delivery') IS DISTINCT FROM 'string' OR jsonb_typeof(e->'label') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
    IF (e->>'key') !~ '^[a-z][a-z0-9_]{1,40}$'
       OR (e->>'owner') NOT IN ('make','shadow','cockpit')
       OR (e->>'delivery') NOT IN ('clickup_queue','slack_notice','client_message','creative_outbox','sql')
       OR char_length(e->>'label') NOT BETWEEN 1 AND 80
       OR (e->>'key') = ANY(v_keys) THEN
      RETURN false;
    END IF;
    v_keys := v_keys || (e->>'key');
  END LOOP;
  RETURN true;
END $$;

CREATE TABLE IF NOT EXISTS public.cockpit_forms (
  key           text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  audience      text NOT NULL CHECK (audience IN ('team','client')),
  -- Where the team fills it today.
  provider      text NOT NULL CHECK (provider IN ('native','typeform','clickup')),
  typeform_id   text CHECK (typeform_id IS NULL OR typeform_id ~ '^[A-Za-z0-9]{8}$'),
  -- The published schema version.
  version       integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  schema        jsonb NOT NULL CHECK (jsonb_typeof(schema) = 'object' AND octet_length(schema::text) <= 65536),
  seats         text[] NOT NULL DEFAULT '{}'::text[]
                  CHECK (seats <@ ARRAY['csm','creative','media_buyer','editor','call_center','sales','admin']::text[]),
  client_scoped boolean NOT NULL,
  effects       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (public.cockpit_forms_effects_valid(effects)),
  updated_by    text NOT NULL CHECK (btrim(updated_by) <> ''),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- A Typeform form names its form; checkin keeps fRokTITH after it turns
  -- native, so a late Typeform response is still recognised (2b).
  CHECK (provider <> 'typeform' OR typeform_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.cockpit_form_versions (
  form_key     text NOT NULL REFERENCES public.cockpit_forms(key),
  version      integer NOT NULL CHECK (version >= 1),
  schema       jsonb NOT NULL CHECK (jsonb_typeof(schema) = 'object' AND octet_length(schema::text) <= 65536),
  published_by text NOT NULL CHECK (btrim(published_by) <> ''),
  published_at timestamptz NOT NULL DEFAULT now(),
  note         text CHECK (note IS NULL OR char_length(note) <= 240),
  PRIMARY KEY (form_key, version)
);

CREATE TABLE IF NOT EXISTS public.cockpit_form_responses (
  -- For a native form, the browser's request ID.
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_key      text NOT NULL REFERENCES public.cockpit_forms(key),
  form_version  integer NOT NULL,
  source        text NOT NULL CHECK (source IN ('cockpit','embed','typeform_webhook','typeform_sync','public','import')),
  external_id   text CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 200),
  task_id       text CHECK (task_id IS NULL OR task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name   text,
  -- shadow while the registry provider is not native; never changes.
  mode          text NOT NULL CHECK (mode IN ('live','shadow')),
  state         text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','confirmed','legacy','void')),
  -- Keyed by field key (section 3.1).
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 65536),
  -- Per key {by, at, session, from}; plus _drafts, written once at submit.
  -- by is an address and never reaches a browser (the views give first names).
  answer_meta   jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(answer_meta) = 'object' AND octet_length(answer_meta::text) <= 65536),
  hidden        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(hidden) = 'object'),
  revision      integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  -- An email, or import.
  created_by    text NOT NULL CHECK (btrim(created_by) <> ''),
  -- The seat's auth user id.
  created_by_id uuid,
  submitted_by  text,
  submitted_at  timestamptz,
  confirmed_by  text,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_key, form_version) REFERENCES public.cockpit_form_versions(form_key, version),
  UNIQUE (form_key, external_id),
  CHECK (state <> 'submitted' OR submitted_at IS NOT NULL),
  CHECK (source <> 'cockpit' OR created_by_id IS NOT NULL),
  CHECK (form_key <> 'checkin' OR task_id IS NOT NULL)
);

-- One open draft per seat, card and form.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_form_responses_one_draft
  ON public.cockpit_form_responses (form_key, task_id, created_by_id) WHERE state = 'draft';
CREATE INDEX IF NOT EXISTS cockpit_form_responses_task
  ON public.cockpit_form_responses (task_id, form_key, submitted_at DESC);
-- The backstop of submit step 8 (one record per call): two seats sending the
-- same call at the same moment cannot both commit.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_form_responses_one_live_recording
  ON public.cockpit_form_responses ((answers->'call'->>'recordingId'))
  WHERE form_key = 'checkin' AND mode = 'live' AND state IN ('submitted','confirmed') AND answers->'call'->>'kind' = 'fathom';
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_form_responses_one_live_booking
  ON public.cockpit_form_responses ((answers->'call'->>'callId'))
  WHERE form_key = 'checkin' AND mode = 'live' AND state IN ('submitted','confirmed') AND answers->'call'->>'kind' = 'booking';

CREATE TABLE IF NOT EXISTS public.cockpit_form_effects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id  uuid NOT NULL REFERENCES public.cockpit_form_responses(id),
  form_key     text NOT NULL,
  effect_key   text NOT NULL CHECK (effect_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  dedupe_key   text NOT NULL UNIQUE,
  -- Copied from the registry at plan time; always shadow for a shadow response.
  owner        text NOT NULL CHECK (owner IN ('make','shadow','cockpit')),
  delivery     text NOT NULL CHECK (delivery IN ('clickup_queue','slack_notice','client_message','creative_outbox','sql')),
  -- The delivery row's id (2b).
  delivery_ref text,
  -- Section 7.1; only plan.lines ever reaches a browser. 128 KB at most: the
  -- write-through of long Arabic notes passes 32 KB (two bytes a letter).
  plan         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 131072),
  receipt      jsonb CHECK (receipt IS NULL OR jsonb_typeof(receipt) = 'object'),
  state        text NOT NULL CHECK (state IN ('planned','dry_run','queued','delivered','failed','unknown','skipped')),
  -- A plain sentence.
  reason       text CHECK (reason IS NULL OR char_length(reason) <= 240),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  settled_at   timestamptz,
  UNIQUE (response_id, effect_key),
  CHECK (dedupe_key = response_id::text || ':' || effect_key),
  -- A shadow or Make effect can never be planned, queued, delivered, failed
  -- or unknown, whatever a function does.
  CHECK (owner = 'cockpit' OR state IN ('dry_run','skipped'))
);
CREATE INDEX IF NOT EXISTS cockpit_form_effects_open
  ON public.cockpit_form_effects (state, created_at) WHERE state IN ('planned','queued','unknown');

CREATE TABLE IF NOT EXISTS public.cockpit_form_drafts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_key       text NOT NULL REFERENCES public.cockpit_forms(key),
  task_id        text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  recording_id   text NOT NULL CHECK (recording_id ~ '^[0-9]{3,20}$'),
  -- Set when a submit adopts the draft; a recap's is set at insert.
  response_id    uuid REFERENCES public.cockpit_form_responses(id),
  kind           text NOT NULL CHECK (kind IN ('todos','client_notes','defcon_priority','grade','recap')),
  -- At most five ready or failed attempts per (recording, task, kind, prompt
  -- version), enforced by cockpit_form_draft_begin; off and skipped do not count.
  attempt        integer NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 20),
  provider       text NOT NULL CHECK (provider IN ('none','deepseek','anthropic')),
  -- The model that answered.
  model          text CHECK (model IS NULL OR char_length(model) <= 80),
  prompt_version text NOT NULL CHECK (prompt_version ~ '^checkin\.[a-z_]+\.v[0-9]+$'),
  input_sha256   text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  state          text NOT NULL CHECK (state IN ('drafting','ready','off','failed','skipped')),
  output         jsonb CHECK (output IS NULL OR (jsonb_typeof(output) = 'object' AND octet_length(output::text) <= 65536)),
  text           text CHECK (text IS NULL OR char_length(text) <= 8000),
  -- The submitted answer of the drafted field, set at submit.
  final          jsonb,
  -- final differs from the draft.
  edited         boolean,
  reason         text CHECK (reason IS NULL OR char_length(reason) <= 240),
  -- Token counts as the provider returned them.
  usage          jsonb,
  -- The seat whose request started it, or server.
  created_by     text NOT NULL CHECK (btrim(created_by) <> ''),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  UNIQUE (recording_id, task_id, kind, prompt_version, attempt)
);
-- One grade per call, whichever client's window started it.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_form_drafts_one_grade
  ON public.cockpit_form_drafts (recording_id) WHERE kind = 'grade' AND state IN ('drafting','ready');
CREATE INDEX IF NOT EXISTS cockpit_form_drafts_find
  ON public.cockpit_form_drafts (task_id, recording_id, kind, started_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_client_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key   text NOT NULL UNIQUE CHECK (char_length(dedupe_key) BETWEEN 3 AND 200),
  task_id      text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name  text,
  kind         text NOT NULL CHECK (kind IN ('recap_checkin','recap_kickoff','recap_blueprint','phase5')),
  response_id  uuid REFERENCES public.cockpit_form_responses(id),
  draft_id     uuid REFERENCES public.cockpit_form_drafts(id),
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4096),
  body_sha256  text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  group_source text NOT NULL DEFAULT 'client_data_f' CHECK (group_source IN ('client_data_f')),
  state        text NOT NULL DEFAULT 'draft'
                 CHECK (state IN ('draft','approved','claimed','sending','sent','unknown','failed','refused','skipped')),
  approved_by  text,
  approved_at  timestamptz,
  expires_at   timestamptz,
  claim_token  uuid,
  claimed_at   timestamptz,
  intent_at    timestamptz,
  sent_at      timestamptz,
  provider_id  text,
  -- When the worker read the sent message back (2b), and its receipt
  -- {by: 'message_id'|'body_sha256', providerId, at}, never the body.
  read_back_at timestamptz,
  read_back    jsonb CHECK (read_back IS NULL OR jsonb_typeof(read_back) = 'object'),
  reason       text CHECK (reason IS NULL OR char_length(reason) <= 240),
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (state NOT IN ('claimed','sending') OR claim_token IS NOT NULL),
  CHECK (state <> 'sent' OR provider_id IS NOT NULL),
  CHECK ((read_back_at IS NULL) = (read_back IS NULL))
);

ALTER TABLE public.cockpit_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_client_messages ENABLE ROW LEVEL SECURITY;
-- No policies: the browser reaches these only through the functions below.
REVOKE ALL ON public.cockpit_forms, public.cockpit_form_versions, public.cockpit_form_responses,
  public.cockpit_form_effects, public.cockpit_form_drafts, public.cockpit_client_messages
  FROM PUBLIC, anon, authenticated, service_role;
-- The guardian and the doctors read; every write goes through a definer function.
GRANT SELECT ON public.cockpit_forms, public.cockpit_form_versions, public.cockpit_form_responses,
  public.cockpit_form_effects, public.cockpit_form_drafts, public.cockpit_client_messages TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Small helpers (internal: no role may execute them)

-- Kuwait has no daylight saving: its day is the UTC time plus three hours.
CREATE OR REPLACE FUNCTION public.cockpit_form_kuwait_day(p timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ((p AT TIME ZONE 'UTC') + interval '3 hours')::date
$$;

-- "14:10", Kuwait time.
CREATE OR REPLACE FUNCTION public.cockpit_form_kuwait_clock(p timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_char((p AT TIME ZONE 'UTC') + interval '3 hours', 'HH24:MI')
$$;

-- "14:10 on Wed 28 Oct", Kuwait time, for the sync notes.
CREATE OR REPLACE FUNCTION public.cockpit_form_kuwait_time(p timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_char((p AT TIME ZONE 'UTC') + interval '3 hours', 'HH24:MI "on" Dy FMDD Mon')
$$;

-- A seat as the forms see it: active, its address confirmed and equal to the
-- sign-in's (the cockpit_csm_visible_tasks join, 20261011c).
CREATE OR REPLACE FUNCTION public.cockpit_form_seat(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cockpit_members;
BEGIN
  SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id = cm.auth_user_id
   WHERE p_actor IS NOT NULL AND cm.auth_user_id = p_actor AND cm.active AND u.email_confirmed_at IS NOT NULL
     AND cm.email = lower(btrim(u.email))
   ORDER BY cm.updated_at DESC LIMIT 1;
  IF m.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to the cockpit first.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('actorId', m.auth_user_id, 'email', m.email, 'memberId', m.id, 'roles', to_jsonb(m.roles),
    'ceo', m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com'),
    'admin', 'admin' = ANY(m.roles), 'csm', 'csm' = ANY(m.roles));
END $$;

-- The caller's seat, from the sign-in.
CREATE OR REPLACE FUNCTION public.cockpit_form_actor()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN public.cockpit_form_seat(auth.uid());
END $$;

-- The CSM's own seats (section 3.5): active, confirmed, holding csm and
-- neither admin nor ceo, and not the CEO's two addresses. "Your newest call"
-- and recorder "csm" mean these seats only, never the CEO's or an admin's.
CREATE OR REPLACE FUNCTION public.cockpit_form_csm_emails()
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (SELECT coalesce(array_agg(DISTINCT m.email ORDER BY m.email), '{}'::text[])
            FROM public.cockpit_members m JOIN auth.users u ON u.id = m.auth_user_id
           WHERE m.active AND u.email_confirmed_at IS NOT NULL AND m.email = lower(btrim(u.email))
             AND 'csm' = ANY(m.roles) AND NOT 'admin' = ANY(m.roles) AND NOT 'ceo' = ANY(m.roles)
             AND m.email NOT IN ('aziz@maharamedia.com','awaheedi2008@gmail.com'));
END $$;

-- ---------------------------------------------------------------------------
-- 3. Triggers: the audit, no deletes, the state guards

-- One audit function for the six tables. A response records the answer keys a
-- write changed and their values (the cockpit_blueprint_audit rule,
-- 20261024a), never answer_meta; an effect never its plan; a draft never its
-- output or text (its response_id is recorded, so an adoption names the
-- notes that took it); a message never its body. The functions name the action
-- through the transaction-local cockpit.forms_action, and a service RPC names
-- the seat it acts for through cockpit.audit_actor.
CREATE OR REPLACE FUNCTION public.cockpit_forms_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_keys text[];
  v_before jsonb;
  v_after jsonb;
  v_changed text[] := '{}';
  v_entity text;
  v_form text;
  v_task text;
  v_actor text;
  o jsonb;
  n jsonb;
  b jsonb;
  a jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  v_new := to_jsonb(NEW);
  IF TG_TABLE_NAME = 'cockpit_form_responses' THEN
    o := coalesce(v_old->'answers', '{}'::jsonb);
    n := coalesce(v_new->'answers', '{}'::jsonb);
    SELECT coalesce(jsonb_object_agg(x.k, o->x.k) FILTER (WHERE o ? x.k), '{}'::jsonb),
           coalesce(jsonb_object_agg(x.k, n->x.k) FILTER (WHERE n ? x.k), '{}'::jsonb),
           coalesce(array_agg(x.k ORDER BY x.k), '{}')
      INTO b, a, v_changed
      FROM (SELECT k FROM jsonb_object_keys(o) k UNION SELECT k FROM jsonb_object_keys(n) k) x
     WHERE (o->x.k) IS DISTINCT FROM (n->x.k);
    IF v_old IS NOT NULL THEN v_before := (v_old - 'answers' - 'answer_meta') || jsonb_build_object('answers', b); END IF;
    v_after := (v_new - 'answers' - 'answer_meta') || jsonb_build_object('answers', a);
    v_entity := v_new->>'id';
    v_form := v_new->>'form_key';
    v_task := v_new->>'task_id';
  ELSE
    IF TG_TABLE_NAME = 'cockpit_form_versions' THEN
      v_new := v_new || jsonb_build_object('key', v_new->'form_key');
      IF v_old IS NOT NULL THEN v_old := v_old || jsonb_build_object('key', v_old->'form_key'); END IF;
    END IF;
    v_keys := CASE TG_TABLE_NAME
      WHEN 'cockpit_forms' THEN ARRAY['key','version','provider','effects']
      WHEN 'cockpit_form_versions' THEN ARRAY['key','version']
      WHEN 'cockpit_form_effects' THEN ARRAY['state','owner','delivery_ref','reason']
      WHEN 'cockpit_form_drafts' THEN ARRAY['kind','attempt','state','provider','model','response_id']
      ELSE ARRAY['state','reason','provider_id','read_back_at'] END;
    IF v_old IS NOT NULL THEN
      SELECT jsonb_object_agg(k, v_old->k) INTO v_before FROM unnest(v_keys) AS k;
    END IF;
    SELECT jsonb_object_agg(k, v_new->k) INTO v_after FROM unnest(v_keys) AS k;
    SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_changed
      FROM unnest(v_keys) AS k WHERE v_old IS NULL OR (v_old->k) IS DISTINCT FROM (v_new->k);
    v_entity := CASE TG_TABLE_NAME
      WHEN 'cockpit_forms' THEN v_new->>'key'
      WHEN 'cockpit_form_versions' THEN (v_new->>'form_key') || ':' || (v_new->>'version')
      ELSE v_new->>'id' END;
    v_form := coalesce(v_new->>'form_key', v_new->>'key');
    v_task := v_new->>'task_id';
    IF TG_TABLE_NAME = 'cockpit_form_effects' THEN
      SELECT r.task_id INTO v_task FROM public.cockpit_form_responses r WHERE r.id = (v_new->>'response_id')::uuid;
    END IF;
  END IF;
  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (coalesce(nullif(current_setting('cockpit.forms_action', true), ''), 'forms.' || TG_TABLE_NAME || '.' || lower(TG_OP)),
          TG_TABLE_NAME, v_entity,
          coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), session_user::text),
          'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          v_before, v_after,
          jsonb_build_object('op', lower(TG_OP), 'form_key', v_form, 'task_id', v_task, 'changed', to_jsonb(v_changed)));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_forms_refuse_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Forms records are never deleted' USING ERRCODE = '55000';
END $$;

-- A response keeps its identity; its answers change only while it is a
-- draft; it moves draft to submitted or void, and submitted to confirmed.
-- A shadow response stays shadow for good.
CREATE OR REPLACE FUNCTION public.cockpit_form_responses_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.form_key IS DISTINCT FROM OLD.form_key
     OR NEW.form_version IS DISTINCT FROM OLD.form_version OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A response keeps its form, version, source, card, mode, seat and creation time' USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'draft' AND (NEW.answers IS DISTINCT FROM OLD.answers OR NEW.answer_meta IS DISTINCT FROM OLD.answer_meta) THEN
    RAISE EXCEPTION 'Sent notes keep their answers' USING ERRCODE = '55000';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'draft' AND NEW.state IN ('submitted','void'))
    OR (OLD.state = 'submitted' AND NEW.state = 'confirmed')) THEN
    RAISE EXCEPTION 'A response goes from % to % only through the cockpit', OLD.state, NEW.state USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Only a cockpit-owned effect is ever planned or later; an effect starts
-- planned, dry_run or skipped; dry_run, delivered and skipped are final; a
-- failed effect is queued again only by a person (cockpit.forms_fix).
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_fix boolean := coalesce(current_setting('cockpit.forms_fix', true), '') = 'on';
BEGIN
  IF NEW.owner IS DISTINCT FROM 'cockpit' AND NEW.state NOT IN ('dry_run','skipped') THEN
    RAISE EXCEPTION 'Only an effect the cockpit owns can be %', NEW.state USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('planned','dry_run','skipped') THEN
      RAISE EXCEPTION 'An effect starts planned, dry_run or skipped' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF NEW.response_id IS DISTINCT FROM OLD.response_id OR NEW.form_key IS DISTINCT FROM OLD.form_key
       OR NEW.effect_key IS DISTINCT FROM OLD.effect_key OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
       OR NEW.owner IS DISTINCT FROM OLD.owner OR NEW.delivery IS DISTINCT FROM OLD.delivery
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'An effect keeps its response, key, owner and delivery' USING ERRCODE = '55000';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
         (OLD.state = 'planned' AND NEW.state IN ('queued','skipped','failed'))
      OR (OLD.state = 'planned' AND NEW.state = 'delivered' AND NEW.delivery = 'sql')
      OR (OLD.state = 'queued' AND NEW.state IN ('delivered','failed','unknown','skipped'))
      OR (OLD.state = 'unknown' AND NEW.state IN ('delivered','failed'))
      OR (OLD.state = 'failed' AND NEW.state = 'queued' AND v_fix)) THEN
      RAISE EXCEPTION 'An effect goes from % to % only through the cockpit', OLD.state, NEW.state USING ERRCODE = '55000';
    END IF;
    NEW.updated_at := now();
  END IF;
  IF NEW.state IN ('dry_run','delivered','skipped') AND (TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state) THEN
    NEW.settled_at := now();
  END IF;
  RETURN NEW;
END $$;

-- A draft starts drafting, off or skipped and finishes once; once it is
-- finished its output, text, model and provider never change (a draft is
-- never rewritten); a submit may adopt it once.
CREATE OR REPLACE FUNCTION public.cockpit_form_drafts_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('drafting','off','skipped') THEN
      RAISE EXCEPTION 'A draft starts drafting, off or skipped' USING ERRCODE = '55000';
    END IF;
    IF NEW.state <> 'drafting' THEN NEW.finished_at := coalesce(NEW.finished_at, now()); END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.form_key IS DISTINCT FROM OLD.form_key OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.recording_id IS DISTINCT FROM OLD.recording_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.attempt IS DISTINCT FROM OLD.attempt OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
     OR NEW.input_sha256 IS DISTINCT FROM OLD.input_sha256 OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'A draft keeps its call, kind, attempt and input' USING ERRCODE = '55000';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state = 'drafting' AND NEW.state IN ('ready','failed','off','skipped')) THEN
    RAISE EXCEPTION 'A draft goes from % to % only once', OLD.state, NEW.state USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'drafting' AND (NEW.output IS DISTINCT FROM OLD.output OR NEW.text IS DISTINCT FROM OLD.text
     OR NEW.model IS DISTINCT FROM OLD.model OR NEW.provider IS DISTINCT FROM OLD.provider) THEN
    RAISE EXCEPTION 'A draft is never rewritten' USING ERRCODE = '55000';
  END IF;
  IF (OLD.response_id IS NOT NULL AND NEW.response_id IS DISTINCT FROM OLD.response_id)
     OR (OLD.final IS NOT NULL AND NEW.final IS DISTINCT FROM OLD.final)
     OR (OLD.edited IS NOT NULL AND NEW.edited IS DISTINCT FROM OLD.edited) THEN
    RAISE EXCEPTION 'A draft is adopted once' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'drafting' AND NEW.state <> 'drafting' THEN NEW.finished_at := coalesce(NEW.finished_at, now()); END IF;
  RETURN NEW;
END $$;

-- The outbox's moves (drafts-and-messages 4.8, with the sending state of a
-- crash between intent and answer). A body is fixed once approved; a
-- read-back is written once, only on a sent message, and never changes.
CREATE OR REPLACE FUNCTION public.cockpit_client_messages_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_fix boolean := coalesce(current_setting('cockpit.forms_fix', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'A message starts as a draft' USING ERRCODE = '55000';
    END IF;
    IF NEW.read_back_at IS NOT NULL OR NEW.read_back IS NOT NULL THEN
      RAISE EXCEPTION 'A message is read back only after it is sent' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A message keeps its key' USING ERRCODE = '55000';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'draft' AND NEW.state IN ('approved','skipped'))
    OR (OLD.state = 'approved' AND NEW.state IN ('claimed','draft','skipped'))
    OR (OLD.state = 'claimed' AND NEW.state IN ('sending','approved','refused'))
    OR (OLD.state = 'sending' AND NEW.state IN ('sent','failed','unknown'))
    OR (OLD.state = 'unknown' AND NEW.state = 'sent')
    OR (OLD.state = 'unknown' AND NEW.state = 'failed' AND v_fix)) THEN
    RAISE EXCEPTION 'A message goes from % to % only through the sender', OLD.state, NEW.state USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'draft' AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256) THEN
    RAISE EXCEPTION 'An approved message keeps its text' USING ERRCODE = '55000';
  END IF;
  IF OLD.read_back_at IS NOT NULL OR OLD.read_back IS NOT NULL THEN
    IF NEW.read_back_at IS DISTINCT FROM OLD.read_back_at OR NEW.read_back IS DISTINCT FROM OLD.read_back THEN
      RAISE EXCEPTION 'A read-back is kept as it was written' USING ERRCODE = '55000';
    END IF;
  ELSIF (NEW.read_back_at IS NOT NULL OR NEW.read_back IS NOT NULL) AND NEW.state <> 'sent' THEN
    RAISE EXCEPTION 'A message is read back only after it is sent' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cockpit_forms_audit ON public.cockpit_forms;
CREATE TRIGGER cockpit_forms_audit AFTER INSERT OR UPDATE ON public.cockpit_forms
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_audit();
DROP TRIGGER IF EXISTS cockpit_forms_audit ON public.cockpit_form_versions;
CREATE TRIGGER cockpit_forms_audit AFTER INSERT OR UPDATE ON public.cockpit_form_versions
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_audit();
DROP TRIGGER IF EXISTS cockpit_form_responses_audit ON public.cockpit_form_responses;
CREATE TRIGGER cockpit_form_responses_audit AFTER INSERT OR UPDATE ON public.cockpit_form_responses
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_audit();
DROP TRIGGER IF EXISTS cockpit_form_effects_audit ON public.cockpit_form_effects;
CREATE TRIGGER cockpit_form_effects_audit AFTER INSERT OR UPDATE OF state ON public.cockpit_form_effects
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_audit();
DROP TRIGGER IF EXISTS cockpit_form_drafts_audit ON public.cockpit_form_drafts;
CREATE TRIGGER cockpit_form_drafts_audit AFTER INSERT OR UPDATE OF state, response_id ON public.cockpit_form_drafts
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_audit();
DROP TRIGGER IF EXISTS cockpit_client_messages_audit ON public.cockpit_client_messages;
CREATE TRIGGER cockpit_client_messages_audit AFTER INSERT OR UPDATE OF state, read_back_at ON public.cockpit_client_messages
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_audit();

DROP TRIGGER IF EXISTS cockpit_form_responses_guard ON public.cockpit_form_responses;
CREATE TRIGGER cockpit_form_responses_guard BEFORE UPDATE ON public.cockpit_form_responses
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_responses_guard();
DROP TRIGGER IF EXISTS cockpit_form_effects_guard ON public.cockpit_form_effects;
CREATE TRIGGER cockpit_form_effects_guard BEFORE INSERT OR UPDATE ON public.cockpit_form_effects
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_effects_guard();
DROP TRIGGER IF EXISTS cockpit_form_drafts_guard ON public.cockpit_form_drafts;
CREATE TRIGGER cockpit_form_drafts_guard BEFORE INSERT OR UPDATE ON public.cockpit_form_drafts
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_drafts_guard();
DROP TRIGGER IF EXISTS cockpit_client_messages_guard ON public.cockpit_client_messages;
CREATE TRIGGER cockpit_client_messages_guard BEFORE INSERT OR UPDATE ON public.cockpit_client_messages
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_client_messages_guard();

-- No delete (per row) and no truncate (per statement) on any of the six.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_forms','cockpit_form_versions','cockpit_form_responses',
    'cockpit_form_effects','cockpit_form_drafts','cockpit_client_messages'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_delete BEFORE DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_truncate BEFORE TRUNCATE ON public.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The gate and the check-in values (internal)

-- Who may open a form for a card (section 2.1, the gate): a signed-in seat,
-- the client gate for a client-scoped form (csm, admin and the CEO only),
-- only checkin natively in 2a, and shadow while the provider is not native.
CREATE OR REPLACE FUNCTION public.cockpit_form_access(p_form_key text, p_task_id text, p_rehearse boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor jsonb; f public.cockpit_forms; v_gate jsonb;
BEGIN
  v_actor := public.cockpit_form_actor();
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no form called %.', coalesce(p_form_key, '') USING ERRCODE = '22023';
  END IF;
  IF f.client_scoped THEN
    v_gate := public.cockpit_csm_client_gate(p_task_id);
  END IF;
  IF f.key <> 'checkin' THEN
    RAISE EXCEPTION 'This form is filled in Typeform, not in the cockpit.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('actor', v_actor, 'gate', v_gate, 'form', to_jsonb(f),
    'mode', CASE WHEN f.provider = 'native' THEN 'live' ELSE 'shadow' END,
    'rehearse', coalesce(p_rehearse, false));
END $$;

-- Whether a recording may stand for this card's call: A7.14's tie rule, the
-- forms door's (cockpit-forms-api/fathom.ts), held here as well because the
-- window saves and sends through PostgREST, past the door, and the browser's
-- why is never trusted. The door can ask this function for its own listing,
-- drafts and transcript (cockpit_form_recordings_tied), so both sides may
-- read one rule. A recording on another card stands for none here (3.2
-- refuses another card first). Else it may stand for this card when:
-- 1. it is a Customer Success recording: its recorder's Fathom team says so,
--    or it is one of the CSM's own seats (3.5);
-- 2. its call row is on this card, placed by an exact sign or a person: a
--    match_method of same_room, appointment_time, form_task_id, manual or
--    client_id_field, or invitee_email at match_confidence 0.9 or more (a
--    known contact's address). A row the worker's matchMeeting placed from a
--    likely sign (name at 0.6, the company domain as invitee_email at 0.8)
--    settles nothing, and the recording goes on to rules 1, 3 and 4 like one
--    on no card (A7.14 rule 2, round 3, A7.17); so does a row on no card;
-- 3. an exact sign of 5.2 names this card: the same room as this card's
--    booking within 90 minutes that no other card's booking there shares;
--    an external invitee on this card's booking (within 30 minutes of the
--    recording when the card is not on the clients list, A7.13); its share
--    link in a stored 1-1 form of this card;
-- 4. the seat (p_actor) may place the recording on this card itself, as the
--    queue lets it (cockpit_csm_manual_match): it passes this card's client
--    gate and is an admin, the CEO or the recording's recorder. No seat, or a
--    seat the gate refuses, ties nothing.
-- A likely sign (the title, the company domain) never ties a recording made
-- outside Customer Success, and neither does a pasted link: the window's why
-- is never read here. A sales call reads client until the sales desk indexes
-- it, a day or more later, so without this rule a prospect's call could be
-- saved as a client's call and, in 2b, attached to the client by call_match.
CREATE OR REPLACE FUNCTION public.cockpit_form_recording_tied(p_recording_id text, p_task_id text, p_actor uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.cockpit_fathom_meetings;
  c public.cockpit_csm_calls;
  v_room text;
  v_at timestamptz;
  v_invitees jsonb;
  v_mails text[];
  v_listed boolean;
  v_share text;
  v_recorder text;
  v_seat jsonb;
BEGIN
  IF p_recording_id IS NULL OR p_task_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO m FROM public.cockpit_fathom_meetings x WHERE x.recording_id = p_recording_id;
  SELECT * INTO c FROM public.cockpit_csm_calls x WHERE x.source = 'fathom' AND x.source_id = p_recording_id;
  IF m.recording_id IS NULL AND c.id IS NULL THEN RETURN false; END IF;
  -- A recording on another card stands for none here, whoever asks.
  IF c.task_id IS NOT NULL AND c.task_id <> p_task_id THEN RETURN false; END IF;
  -- Rule 2: only a row on this card that an exact sign or a person placed.
  IF c.task_id = p_task_id
     AND (c.match_method IN ('same_room','appointment_time','form_task_id','manual','client_id_field')
          OR (c.match_method = 'invitee_email' AND c.match_confidence >= 0.9)) THEN
    RETURN true;
  END IF;
  v_recorder := lower(btrim(coalesce(m.recorded_by_email, c.host_email, '')));
  -- Rule 1.
  IF lower(btrim(coalesce(m.recorder_team, m.raw->'recorded_by'->>'team', ''))) = 'customer success'
     OR v_recorder = ANY(public.cockpit_form_csm_emails()) THEN
    RETURN true;
  END IF;
  -- Rule 3. The same room: every live booking in that room within 90 minutes
  -- is this card's.
  v_room := coalesce(m.room, c.room);
  v_at := coalesce(m.starts_at, c.starts_at);
  IF v_room IS NOT NULL AND v_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.cockpit_csm_calls b
                  WHERE b.source = 'ghl_appointment' AND b.status <> 'gone' AND b.task_id = p_task_id AND b.room = v_room
                    AND b.starts_at BETWEEN v_at - interval '90 minutes' AND v_at + interval '90 minutes')
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_csm_calls b
                      WHERE b.source = 'ghl_appointment' AND b.status <> 'gone' AND b.task_id IS NOT NULL
                        AND b.task_id <> p_task_id AND b.room = v_room
                        AND b.starts_at BETWEEN v_at - interval '90 minutes' AND v_at + interval '90 minutes') THEN
    RETURN true;
  END IF;
  -- The client on the invite: an invitee outside Mahara is on this card's
  -- live booking, at any time when the card is on the clients list, else
  -- within 30 minutes of the recording (A7.13).
  v_invitees := CASE WHEN m.recording_id IS NOT NULL THEN m.invitees ELSE c.external_invitees END;
  SELECT coalesce(array_agg(DISTINCT z.e), '{}'::text[]) INTO v_mails
    FROM (SELECT lower(btrim(i->>'email')) AS e
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_invitees) = 'array' THEN v_invitees ELSE '[]'::jsonb END) i) z
   WHERE z.e LIKE '%@%' AND z.e !~ '@maharamedia\.com$';
  IF cardinality(v_mails) > 0 THEN
    v_listed := EXISTS (SELECT 1 FROM public.cockpit_csm_sources s
                         WHERE s.table_name = 'clients' AND s.data->>'taskId' = p_task_id
                           AND nullif(btrim(s.data->>'name'), '') IS NOT NULL);
    IF EXISTS (SELECT 1 FROM public.cockpit_csm_calls b
                CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.external_invitees) = 'array'
                                                             THEN b.external_invitees ELSE '[]'::jsonb END) bi
               WHERE b.source = 'ghl_appointment' AND b.status <> 'gone' AND b.task_id = p_task_id
                 AND lower(btrim(bi->>'email')) = ANY(v_mails)
                 AND (v_listed OR (v_at IS NOT NULL
                                   AND b.starts_at BETWEEN v_at - interval '30 minutes' AND v_at + interval '30 minutes'))) THEN
      RETURN true;
    END IF;
  END IF;
  -- A stored 1-1 form of this card holds its share link (MatchInputs.formLinks).
  v_share := substring(coalesce(m.share_url, c.recording_url) FROM 'https://fathom\.video/share/[A-Za-z0-9_-]+');
  IF v_share IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.cockpit_csm_call_forms f
        WHERE f.form_kind = 'checkin' AND f.task_id = p_task_id
          AND substring(f.answers::text FROM 'https://fathom\.video/share/[A-Za-z0-9_-]+') = v_share) THEN
    RETURN true;
  END IF;
  -- Rule 4.
  IF p_actor IS NOT NULL THEN
    BEGIN
      v_seat := public.cockpit_form_seat(p_actor);
      PERFORM public.cockpit_csm_client_gate_for_actor(p_actor, p_task_id);
    EXCEPTION WHEN OTHERS THEN
      v_seat := NULL;
    END;
    IF coalesce((v_seat->>'admin')::boolean, false) OR coalesce((v_seat->>'ceo')::boolean, false)
       OR (v_recorder <> '' AND v_seat->>'email' = v_recorder) THEN
      RETURN true;
    END IF;
  END IF;
  RETURN false;
END $$;

-- How a refusal names another client to a seat (the forms door's seesClient):
-- admins and the CEO see every client; any other seat only a client its
-- client gate lets it open. Otherwise, or when no name is known, it says
-- "another client". A refusal of the gate is a no, never an error.
CREATE OR REPLACE FUNCTION public.cockpit_form_client_shown(p_actor uuid, p_task_id text, p_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb; v_name text;
BEGIN
  v_name := coalesce(nullif(btrim(p_name), ''),
    (SELECT nullif(btrim(s.data->>'name'), '') FROM public.cockpit_csm_sources s
      WHERE s.table_name = 'clients' AND s.data->>'taskId' = p_task_id LIMIT 1));
  IF v_name IS NULL OR p_actor IS NULL OR p_task_id IS NULL THEN RETURN 'another client'; END IF;
  BEGIN
    v_seat := public.cockpit_form_seat(p_actor);
    IF NOT (coalesce((v_seat->>'admin')::boolean, false) OR coalesce((v_seat->>'ceo')::boolean, false)) THEN
      PERFORM public.cockpit_csm_client_gate_for_actor(p_actor, p_task_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'another client';
  END;
  RETURN v_name;
END $$;

-- One check-in answer, normalised, or the field's refusal (sections 3.1 and
-- 3.2). A JSON null clears the key. The call's times, link and title are read
-- from the store, never trusted from the browser; a recording must be one the
-- tie rule lets the saving seat use for this card (cockpit_form_recording_tied
-- with auth.uid(), A7.14), whatever the browser's why says; its refusal reads
-- A7.14's second sentence when the call row is on this card (a likely sign
-- placed it, round 4, A7.18), else the first. The save and the send both come
-- through here, each as the seat that owns the notes.
CREATE OR REPLACE FUNCTION public.cockpit_form_checkin_value(p_key text, p_value jsonb, p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_kind text;
  v_why text;
  v_rec text;
  v_id bigint;
  v_text text;
  v_team text;
  v_name text;
  v_choices text[];
  v_seen text[] := '{}';
  v_items jsonb := '[]'::jsonb;
  e jsonb;
  m public.cockpit_fathom_meetings;
  c public.cockpit_csm_calls;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;

  IF p_key = 'call' THEN
    IF jsonb_typeof(p_value) <> 'object' THEN
      RAISE EXCEPTION 'Pick the call these notes are for, or choose No recording.' USING ERRCODE = '22023';
    END IF;
    v_kind := p_value->>'kind';
    IF v_kind = 'none' THEN
      RETURN jsonb_build_object('kind', 'none', 'why', 'none', 'confirmed', true);
    ELSIF v_kind = 'booking' THEN
      v_id := CASE WHEN jsonb_typeof(p_value->'callId') IN ('number','string') AND (p_value->>'callId') ~ '^[0-9]{1,18}$'
                   THEN (p_value->>'callId')::bigint END;
      SELECT * INTO c FROM public.cockpit_csm_calls x
       WHERE x.id = v_id AND x.source = 'ghl_appointment' AND x.task_id = p_task_id AND x.status <> 'gone';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'That booked call is not on this client.' USING ERRCODE = '22023';
      END IF;
      IF c.status = 'cancelled' THEN
        RAISE EXCEPTION 'That booked call was cancelled. Pick its recording or No recording.' USING ERRCODE = '22023';
      END IF;
      IF c.starts_at IS NULL OR c.starts_at > now() THEN
        RAISE EXCEPTION 'That booked call has not happened yet.' USING ERRCODE = '22023';
      END IF;
      RETURN jsonb_build_object('kind', 'booking', 'callId', c.id, 'startsAt', c.starts_at, 'endsAt', c.ends_at,
        'why', 'booking', 'confirmed', true);
    ELSIF v_kind = 'fathom' THEN
      v_why := p_value->>'why';
      IF v_why IS NULL OR v_why NOT IN ('same_room','invitee_email','pasted','matched','speaker_name','title','domain',
                                        'near_booking','latest_unlinked','picked') THEN
        RAISE EXCEPTION 'Pick the call these notes are for, or choose No recording.' USING ERRCODE = '22023';
      END IF;
      v_rec := CASE WHEN jsonb_typeof(p_value->'recordingId') IN ('string','number') THEN p_value->>'recordingId' END;
      IF v_rec IS NOT NULL AND v_rec ~ '^[0-9]{3,20}$' THEN
        SELECT * INTO m FROM public.cockpit_fathom_meetings x WHERE x.recording_id = v_rec;
      END IF;
      IF m.recording_id IS NULL THEN
        RAISE EXCEPTION 'That recording is not in the cockpit yet. Check again in a minute.' USING ERRCODE = '22023';
      END IF;
      IF m.gone_at IS NOT NULL THEN
        RAISE EXCEPTION 'Fathom no longer has that recording. Pick another call.' USING ERRCODE = '22023';
      END IF;
      IF m.class IS NULL OR m.class NOT IN ('client','candidate') THEN
        RAISE EXCEPTION 'That recording is a team meeting, not a client call.' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO c FROM public.cockpit_csm_calls x WHERE x.source = 'fathom' AND x.source_id = v_rec;
      IF c.task_id IS NOT NULL AND c.task_id <> p_task_id THEN
        -- The other client is named only to a seat that may see it.
        v_name := public.cockpit_form_client_shown(auth.uid(), c.task_id, c.client_name);
        RAISE EXCEPTION 'That recording is on %. If that is wrong, ask an admin to move it.', v_name USING ERRCODE = '22023';
      END IF;
      IF NOT public.cockpit_form_recording_tied(v_rec, p_task_id, auth.uid()) THEN
        -- A7.14's two sentences: a call row on this card that the tie rule
        -- still refuses was placed by a likely sign (rule 2), and the
        -- client's Calls card lists it here, so "is not on this client"
        -- would be false; a call row on no card, or none, keeps the first.
        IF c.task_id = p_task_id THEN
          RAISE EXCEPTION 'That recording is from outside Customer Success and was put on this client only by a name or email domain in it. If it is this client''s call, ask an admin to send the 1-1 notes with it.'
            USING ERRCODE = '22023';
        END IF;
        RAISE EXCEPTION 'That recording is from outside Customer Success and is not on this client. If it is this client''s call, ask an admin to match it.'
          USING ERRCODE = '22023';
      END IF;
      v_team := lower(btrim(coalesce(m.recorder_team, m.raw->'recorded_by'->>'team', '')));
      RETURN jsonb_build_object(
        'kind', 'fathom',
        'recordingId', v_rec,
        'callId', c.id,
        'shareUrl', CASE WHEN m.share_url ~ '^https://fathom\.video/share/' THEN m.share_url END,
        'startsAt', m.starts_at,
        'endsAt', m.ends_at,
        'title', coalesce(nullif(btrim(m.title), ''), nullif(btrim(m.raw->>'meeting_title'), ''), 'Recorded call'),
        'why', v_why,
        'recorder', CASE WHEN lower(btrim(m.recorded_by_email)) = ANY(public.cockpit_form_csm_emails()) THEN 'csm'
                         WHEN v_team = 'customer success' THEN 'team' ELSE 'other' END,
        -- A guess ("Is this the call?") stays unconfirmed until the seat
        -- presses Yes, this call; an exact signal or a pick is confirmed.
        'confirmed', v_why IN ('same_room','invitee_email','pasted','matched','picked')
                     OR coalesce(p_value->'confirmed' = 'true'::jsonb, false));
    END IF;
    RAISE EXCEPTION 'Pick the call these notes are for, or choose No recording.' USING ERRCODE = '22023';

  ELSIF p_key IN ('defcon','priority') THEN
    v_text := CASE WHEN jsonb_typeof(p_value) IN ('string','number') THEN p_value #>> '{}' ELSE p_value::text END;
    -- The labels are the registry's own, so an editor's list needs no code change.
    SELECT array_agg(ch) INTO v_choices
      FROM public.cockpit_forms f
     CROSS JOIN LATERAL jsonb_array_elements(f.schema->'fields') fl
     CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(fl->'choices') = 'array' THEN fl->'choices' ELSE '[]'::jsonb END) ch
     WHERE f.key = 'checkin' AND fl->>'key' = p_key;
    IF v_choices IS NULL OR NOT (v_text = ANY(v_choices)) THEN
      RAISE EXCEPTION '"%" is not one of the answers.', v_text USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(v_text);

  ELSIF p_key IN ('we_owe','they_owe') THEN
    IF jsonb_typeof(p_value) <> 'array' THEN
      RAISE EXCEPTION 'A line is missing its text.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_value) > 30 THEN
      RAISE EXCEPTION 'Keep it to 30 lines.' USING ERRCODE = '22023';
    END IF;
    FOR e IN SELECT x FROM jsonb_array_elements(p_value) x LOOP
      IF jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'text') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'A line is missing its text.' USING ERRCODE = '22023';
      END IF;
      v_text := btrim(regexp_replace(e->>'text', '\s+', ' ', 'g'));
      IF v_text = '' THEN
        RAISE EXCEPTION 'A line is missing its text.' USING ERRCODE = '22023';
      END IF;
      IF char_length(v_text) > 300 THEN
        RAISE EXCEPTION 'Keep each line under 300 characters.' USING ERRCODE = '22023';
      END IF;
      -- The same line twice is kept once.
      CONTINUE WHEN lower(v_text) = ANY(v_seen);
      v_seen := v_seen || lower(v_text);
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'text', v_text,
        'owner', CASE WHEN jsonb_typeof(e->'owner') = 'string' THEN nullif(left(btrim(e->>'owner'), 80), '') END,
        'at', CASE WHEN jsonb_typeof(e->'at') = 'number' AND (e->>'at')::numeric BETWEEN 0 AND 86400
                   THEN floor((e->>'at')::numeric)::integer END,
        'href', CASE WHEN jsonb_typeof(e->'href') = 'string' AND e->>'href' ~ '^https://fathom\.video/'
                          AND char_length(e->>'href') <= 500 THEN e->>'href' END,
        'from', CASE WHEN e->>'from' = 'fathom' THEN 'fathom' ELSE 'csm' END,
        'unsure', coalesce(e->'unsure' = 'true'::jsonb, false)));
    END LOOP;
    RETURN v_items;

  ELSIF p_key = 'client_notes' THEN
    IF jsonb_typeof(p_value) IN ('object','array') THEN
      RAISE EXCEPTION 'Keep it under 4,000 characters.' USING ERRCODE = '22023';
    END IF;
    v_text := btrim(p_value #>> '{}');
    IF char_length(v_text) > 4000 THEN
      RAISE EXCEPTION 'Keep it under 4,000 characters.' USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(v_text);
  END IF;
  RAISE EXCEPTION 'That is not a question of this form.' USING ERRCODE = '22023';
END $$;

-- The required answers still missing: call, defcon, priority. A call counts
-- as missing while it is not confirmed, so notes never go out on a guess.
CREATE OR REPLACE FUNCTION public.cockpit_form_checkin_missing(p_answers jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN jsonb_typeof(p_answers->'call') IS DISTINCT FROM 'object'
              OR (p_answers->'call'->'confirmed') IS DISTINCT FROM 'true'::jsonb THEN 'call' END,
    CASE WHEN nullif(btrim(p_answers->>'defcon'), '') IS NULL THEN 'defcon' END,
    CASE WHEN nullif(btrim(p_answers->>'priority'), '') IS NULL THEN 'priority' END], NULL)
$$;

-- The effects one submit plans: checkin through migration x's planner; a
-- kickoff or Blueprint response never plans an effect here (their cockpit
-- effects are Stage 1's own deliveries, section 2.1 seeds).
CREATE OR REPLACE FUNCTION public.cockpit_form_plan_effects(p_response public.cockpit_form_responses)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF p_response.form_key IS DISTINCT FROM 'checkin' THEN RETURN '[]'::jsonb; END IF;
  v := public.cockpit_form_checkin_plan(p_response);
  IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'The 1-1 notes could not be planned. Tell the tech lead.' USING ERRCODE = 'P0001';
  END IF;
  RETURN v;
END $$;

-- What a draft becomes once its field is sent, and whether the seat changed it.
CREATE OR REPLACE FUNCTION public.cockpit_form_draft_final(p_kind text, p_answers jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_kind
    WHEN 'todos' THEN jsonb_build_object('we_owe', coalesce(p_answers->'we_owe', '[]'::jsonb),
                                         'they_owe', coalesce(p_answers->'they_owe', '[]'::jsonb))
    WHEN 'client_notes' THEN coalesce(p_answers->'client_notes', 'null'::jsonb)
    WHEN 'defcon_priority' THEN jsonb_build_object('defcon', p_answers->'defcon', 'priority', p_answers->'priority')
  END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_form_draft_edited(p_kind text, p_output jsonb, p_final jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_items jsonb := CASE WHEN jsonb_typeof(p_output->'items') = 'array' THEN p_output->'items' ELSE '[]'::jsonb END;
BEGIN
  IF p_kind = 'todos' THEN
    RETURN (SELECT coalesce(array_agg(btrim(regexp_replace(i->>'text', '\s+', ' ', 'g')) ORDER BY o), '{}')
              FROM jsonb_array_elements(v_items) WITH ORDINALITY q(i, o) WHERE i->>'side' = 'we')
           IS DISTINCT FROM
           (SELECT coalesce(array_agg(i->>'text' ORDER BY o), '{}')
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_final->'we_owe') = 'array' THEN p_final->'we_owe' ELSE '[]'::jsonb END)
                   WITH ORDINALITY q(i, o))
        OR (SELECT coalesce(array_agg(btrim(regexp_replace(i->>'text', '\s+', ' ', 'g')) ORDER BY o), '{}')
              FROM jsonb_array_elements(v_items) WITH ORDINALITY q(i, o) WHERE i->>'side' = 'they')
           IS DISTINCT FROM
           (SELECT coalesce(array_agg(i->>'text' ORDER BY o), '{}')
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_final->'they_owe') = 'array' THEN p_final->'they_owe' ELSE '[]'::jsonb END)
                   WITH ORDINALITY q(i, o));
  ELSIF p_kind = 'client_notes' THEN
    RETURN coalesce(btrim(p_output->>'text'), '') IS DISTINCT FROM coalesce(btrim(p_final #>> '{}'), '');
  ELSIF p_kind = 'defcon_priority' THEN
    RETURN (p_output->'defcon'->>'value') IS DISTINCT FROM (p_final->>'defcon')
        OR (p_output->'priority'->>'value') IS DISTINCT FROM (p_final->>'priority');
  END IF;
  RETURN NULL;
END $$;

-- When this call already has live 1-1 notes, the newest of them (submit step
-- 8): another live check-in on the same recording or booking, one of the
-- other kind on the same booking, or a stored check-in form with the same
-- share link or linked to the same call. This response's own row aside.
CREATE OR REPLACE FUNCTION public.cockpit_form_call_noted_at(p_response_id uuid, p_call jsonb, p_booking bigint)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_kind text := p_call->>'kind';
  v_rec text := p_call->>'recordingId';
  v_share text := p_call->>'shareUrl';
  v_call bigint := CASE WHEN (p_call->>'callId') ~ '^[0-9]{1,18}$' THEN (p_call->>'callId')::bigint END;
  v_at timestamptz;
BEGIN
  SELECT max(z.at) INTO v_at FROM (
    SELECT o.submitted_at AS at FROM public.cockpit_form_responses o
     WHERE o.form_key = 'checkin' AND o.mode = 'live' AND o.state IN ('submitted','confirmed') AND o.id <> p_response_id
       AND ((v_kind = 'fathom' AND o.answers->'call'->>'kind' = 'fathom' AND o.answers->'call'->>'recordingId' = v_rec)
         OR (v_kind = 'booking' AND o.answers->'call'->>'kind' = 'booking' AND o.answers->'call'->>'callId' = v_call::text)
         OR (p_booking IS NOT NULL AND o.answers->'call'->>'kind' = 'booking' AND o.answers->'call'->>'callId' = p_booking::text)
         OR (p_booking IS NOT NULL AND o.answers->'call'->>'kind' = 'fathom' AND EXISTS (
               SELECT 1 FROM public.cockpit_csm_calls oc
                WHERE oc.source = 'fathom' AND oc.source_id = o.answers->'call'->>'recordingId' AND oc.linked_call_id = p_booking)))
    UNION ALL
    SELECT f.submitted_at FROM public.cockpit_csm_call_forms f
     WHERE f.form_kind = 'checkin' AND f.token <> 'cockpit:' || p_response_id::text
       AND ((v_share IS NOT NULL AND substring(f.recording_url FROM 'https://fathom\.video/share/[A-Za-z0-9_-]+') = v_share)
         OR (v_call IS NOT NULL AND f.linked_call_id = v_call)
         OR (p_booking IS NOT NULL AND f.linked_call_id = p_booking))) z;
  RETURN v_at;
END $$;

-- Put a recording on a client (the call_match effect, 2b only): the call row
-- is made from the store when missing; a recording on another client is
-- refused (moving one is 2b build 11), naming that client only to a seat that
-- may see it; a recording the tie rule does not let the submitting seat use
-- (cockpit_form_recording_tied with p_actor's actorId; a malformed actorId is
-- no seat, so rule 4 ties nothing) is refused here too, before anything is
-- written, with the save's sentence chosen the save's way (the second for a
-- row already on this card, round 4, A7.18), so no send can put a prospect's
-- call on a client; the client's
-- booking is linked by the one booking rule (cockpit_csm_booking_for,
-- migration w), so the timeline shows one call; the row keeps no hints
-- (A7.13); the queue row is resolved; one match audit and one audit row.
CREATE OR REPLACE FUNCTION public.cockpit_csm_attach_recording(p_task_id text, p_client text, p_recording_id text, p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.cockpit_csm_calls;
  m public.cockpit_fathom_meetings;
  v_link bigint;
  v_kind text;
  v_inserted boolean := false;
  v_seat uuid := CASE WHEN p_actor->>'actorId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN (p_actor->>'actorId')::uuid END;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF p_recording_id IS NULL OR p_recording_id !~ '^[0-9]{3,20}$' THEN
    RAISE EXCEPTION 'That recording is not in the cockpit yet. Check again in a minute.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.cockpit_csm_calls x WHERE x.source = 'fathom' AND x.source_id = p_recording_id FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO m FROM public.cockpit_fathom_meetings x WHERE x.recording_id = p_recording_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That recording is not in the cockpit yet. Check again in a minute.' USING ERRCODE = '22023';
    END IF;
    IF m.class IS NULL OR m.class NOT IN ('client','candidate') THEN
      RAISE EXCEPTION 'That recording is a team meeting, not a client call.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cockpit_csm_calls(source, source_id, kind, title, starts_at, ends_at, status, provider_status,
      host_email, host_name, recording_url, summary, external_invitees, room)
    VALUES ('fathom', m.recording_id, 'other',
            left(coalesce(nullif(btrim(m.title), ''), nullif(btrim(m.raw->>'meeting_title'), ''), 'Recorded call'), 300),
            m.starts_at, m.ends_at, 'held', 'recorded', lower(btrim(m.recorded_by_email)), m.recorded_by_name,
            coalesce(m.url, m.share_url), m.summary,
            coalesce((SELECT jsonb_agg(jsonb_build_object('email', i->>'email', 'name', i->>'name'))
                        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.invitees) = 'array' THEN m.invitees ELSE '[]'::jsonb END) i
                       WHERE i->>'is_external' = 'true'), '[]'::jsonb),
            m.room)
    ON CONFLICT (source, source_id) DO NOTHING;
    SELECT * INTO c FROM public.cockpit_csm_calls x WHERE x.source = 'fathom' AND x.source_id = p_recording_id FOR UPDATE;
    v_inserted := true;
  END IF;
  IF c.task_id IS NOT NULL AND c.task_id <> p_task_id THEN
    RAISE EXCEPTION 'That recording is on %. If that is wrong, ask an admin to move it.',
      public.cockpit_form_client_shown(v_seat, c.task_id, c.client_name) USING ERRCODE = '22023';
  END IF;
  -- A row made just above is rolled back with this refusal. No own-card
  -- shortcut: a row already on this card passes by the tie rule's rule 2 only
  -- when an exact sign or a person placed it; a row a likely sign placed (name
  -- 0.6, invitee_email under 0.9) is held to rules 1, 3 and 4 for the
  -- submitting seat, like a row on no card (A7.14 rule 2, round 3, A7.17).
  IF NOT public.cockpit_form_recording_tied(p_recording_id, p_task_id, v_seat) THEN
    -- A7.14's two sentences, chosen as the save chooses them: the second for
    -- a row already on this card (a likely sign placed it), else the first.
    IF c.task_id = p_task_id THEN
      RAISE EXCEPTION 'That recording is from outside Customer Success and was put on this client only by a name or email domain in it. If it is this client''s call, ask an admin to send the 1-1 notes with it.'
        USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'That recording is from outside Customer Success and is not on this client. If it is this client''s call, ask an admin to match it.'
      USING ERRCODE = '22023';
  END IF;
  v_link := public.cockpit_csm_booking_for(p_task_id, c.room, c.starts_at);
  IF v_link IS NOT NULL THEN
    SELECT b.kind INTO v_kind FROM public.cockpit_csm_calls b WHERE b.id = v_link;
  END IF;
  UPDATE public.cockpit_csm_calls x
     SET task_id = p_task_id, client_name = p_client, match_method = 'manual', match_confidence = 1,
         candidate = false, settled_reason = NULL, hints = '[]'::jsonb, linked_call_id = v_link,
         kind = coalesce(v_kind, x.kind), updated_at = now()
   WHERE x.id = c.id;
  UPDATE public.cockpit_csm_unmatched u
     SET resolved_task_id = p_task_id, resolved_by = p_actor->>'email', resolved_at = now(), updated_at = now()
   WHERE u.item_kind = 'call' AND u.item_ref = c.id::text AND u.resolved_at IS NULL;
  INSERT INTO public.cockpit_csm_match_audit(item_kind, item_ref, task_id, actor_id, actor_email)
  VALUES ('call', c.id::text, p_task_id, (p_actor->>'actorId')::uuid, p_actor->>'email');
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('csm.recording_attached', 'cockpit_csm_calls', c.id::text, p_actor->>'email', 'client-success',
          coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          jsonb_build_object('taskId', c.task_id, 'matchMethod', c.match_method, 'linkedCallId', c.linked_call_id, 'kind', c.kind),
          jsonb_build_object('taskId', p_task_id, 'matchMethod', 'manual', 'linkedCallId', v_link, 'kind', coalesce(v_kind, c.kind)),
          jsonb_build_object('recordingId', p_recording_id, 'callId', c.id, 'taskId', p_task_id, 'inserted', v_inserted));
  RETURN jsonb_build_object('ok', true, 'callId', c.id, 'taskId', p_task_id, 'linkedCallId', v_link,
    'kind', coalesce(v_kind, c.kind), 'inserted', v_inserted);
END $$;

-- The SQL effects of one response, call_match first and then call_form (2b
-- only: every 2a owner is shadow, so nothing here is planned). call_form
-- links the call the Calls card shows (7.1): a recording's booking when its
-- row is linked to a live one on this card, else the recording's row; a
-- booking itself; for No recording its own call row (plan.ownCall). Each
-- delivered effect names the row it wrote (delivery_ref), so its audit row
-- traces the write.
CREATE OR REPLACE FUNCTION public.cockpit_form_apply_sql_effects(p_response_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  e public.cockpit_form_effects;
  rec public.cockpit_csm_calls;
  v_actor jsonb;
  v_call jsonb;
  v_res jsonb;
  v_row jsonb;
  v_own jsonb;
  v_link bigint;
  v_token text;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_actor := jsonb_build_object('actorId', r.created_by_id, 'email', coalesce(r.submitted_by, r.created_by));
  v_call := r.answers->'call';
  FOR e IN
    SELECT * FROM public.cockpit_form_effects x
     WHERE x.response_id = r.id AND x.owner = 'cockpit' AND x.delivery = 'sql' AND x.state = 'planned'
     ORDER BY CASE x.effect_key WHEN 'call_match' THEN 0 WHEN 'call_form' THEN 1 ELSE 2 END, x.created_at
       FOR UPDATE
  LOOP
    BEGIN
      IF e.effect_key = 'call_match' THEN
        v_res := public.cockpit_csm_attach_recording(r.task_id, r.client_name,
          coalesce(e.plan->>'recordingId', v_call->>'recordingId'), v_actor);
        UPDATE public.cockpit_form_effects x
           SET state = 'delivered', delivery_ref = v_res->>'callId', receipt = jsonb_build_object('callId', v_res->'callId')
         WHERE x.id = e.id;
      ELSIF e.effect_key = 'call_form' THEN
        v_row := coalesce(e.plan->'row', '{}'::jsonb);
        v_token := coalesce(nullif(v_row->>'token', ''), 'cockpit:' || r.id::text);
        v_link := NULL;
        IF v_call->>'kind' = 'fathom' THEN
          -- Only a row on this card: when call_match could not attach the
          -- recording (it is on another client), the notes link no call.
          SELECT * INTO rec FROM public.cockpit_csm_calls x
           WHERE x.source = 'fathom' AND x.source_id = v_call->>'recordingId' AND x.task_id = r.task_id;
          IF FOUND THEN
            v_link := CASE WHEN EXISTS (SELECT 1 FROM public.cockpit_csm_calls p
                                         WHERE p.id = rec.linked_call_id AND p.task_id = r.task_id AND p.status <> 'gone')
                           THEN rec.linked_call_id ELSE rec.id END;
          END IF;
        ELSIF v_call->>'kind' = 'booking' THEN
          v_link := (v_call->>'callId')::bigint;
        ELSIF v_call->>'kind' = 'none' AND jsonb_typeof(e.plan->'ownCall') = 'object' THEN
          v_own := e.plan->'ownCall';
          INSERT INTO public.cockpit_csm_calls AS c0 (source, source_id, task_id, client_name, match_method, match_confidence,
            kind, title, starts_at, status, provider_status)
          VALUES (coalesce(v_own->>'source', 'checkin_form'), coalesce(v_own->>'source_id', v_token), r.task_id, r.client_name,
                  coalesce(v_own->>'match_method', 'form_task_id'), coalesce((v_own->>'match_confidence')::numeric, 1),
                  coalesce(v_own->>'kind', 'checkin'), coalesce(v_own->>'title', 'Check-in call (1-1 notes in the cockpit)'),
                  coalesce((v_own->>'starts_at')::timestamptz, r.submitted_at), coalesce(v_own->>'status', 'held'),
                  coalesce(v_own->>'provider_status', 'notes sent'))
          ON CONFLICT (source, source_id) DO UPDATE SET updated_at = now()
          RETURNING c0.id INTO v_link;
        END IF;
        INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, typed_client, matched_by,
          submitted_at, answers, hidden, recording_url, linked_call_id)
        VALUES (v_token, coalesce(v_row->>'form_id', 'cockpit-checkin'), coalesce(v_row->>'form_kind', 'checkin'), r.task_id,
                v_row->>'typed_client', coalesce(v_row->>'matched_by', 'cockpit_form'),
                coalesce((v_row->>'submitted_at')::timestamptz, r.submitted_at),
                CASE WHEN jsonb_typeof(v_row->'answers') = 'array' THEN v_row->'answers' ELSE '[]'::jsonb END,
                CASE WHEN jsonb_typeof(v_row->'hidden') = 'object' THEN v_row->'hidden' ELSE '{}'::jsonb END,
                v_row->>'recording_url', v_link)
        ON CONFLICT (token) DO NOTHING;
        UPDATE public.cockpit_form_effects x
           SET state = 'delivered', delivery_ref = v_token, receipt = jsonb_build_object('token', v_token, 'linkedCallId', v_link)
         WHERE x.id = e.id;
      ELSE
        UPDATE public.cockpit_form_effects x SET state = 'failed', reason = 'The cockpit does not know how to deliver this.'
         WHERE x.id = e.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.cockpit_form_effects x SET state = 'failed', reason = left(SQLERRM, 240) WHERE x.id = e.id;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Views (internal; section 3.3)

CREATE OR REPLACE FUNCTION public.cockpit_form_effect_view(p public.cockpit_form_effects)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN jsonb_build_object(
    'key', p.effect_key,
    'label', coalesce((SELECT x->>'label' FROM public.cockpit_forms f CROSS JOIN LATERAL jsonb_array_elements(f.effects) x
                        WHERE f.key = p.form_key AND x->>'key' = p.effect_key LIMIT 1), p.effect_key),
    'owner', p.owner,
    'delivery', p.delivery,
    'state', p.state,
    'at', coalesce(p.settled_at, p.updated_at),
    'reason', p.reason,
    'lines', CASE WHEN jsonb_typeof(p.plan->'lines') = 'array' THEN p.plan->'lines' ELSE '[]'::jsonb END);
END $$;

-- meta carries who saved each answer as a first name, never an address, and
-- leaves _drafts out.
CREATE OR REPLACE FUNCTION public.cockpit_form_response_view(p public.cockpit_form_responses)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN jsonb_build_object(
    'id', p.id,
    'formKey', p.form_key,
    'formVersion', p.form_version,
    'mode', p.mode,
    'state', p.state,
    'revision', p.revision,
    'taskId', p.task_id,
    'clientName', p.client_name,
    'answers', p.answers,
    'meta', coalesce((SELECT jsonb_object_agg(m.key, jsonb_build_object('at', m.value->'at', 'from', m.value->'from',
                                'by', public.cockpit_blueprint_first_name(m.value->>'by')))
                        FROM jsonb_each(p.answer_meta) m
                       WHERE m.key <> '_drafts' AND jsonb_typeof(m.value) = 'object'), '{}'::jsonb),
    'createdAt', p.created_at,
    'submittedAt', p.submitted_at);
END $$;

-- A grade shows only its score and colour; its criteria and feedback never
-- reach the window. A ready recap carries its stored text (the message and
-- the booking block, byte for byte) as output.text, so the window shows what
-- would go and never rebuilds it.
CREATE OR REPLACE FUNCTION public.cockpit_form_draft_view(p public.cockpit_form_drafts)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN jsonb_build_object(
    'kind', p.kind,
    'state', p.state,
    'attempt', p.attempt,
    'provider', p.provider,
    'model', p.model,
    'promptVersion', p.prompt_version,
    'at', coalesce(p.finished_at, p.started_at),
    'reason', p.reason,
    'output', CASE WHEN p.kind = 'grade' AND p.output IS NOT NULL
                   THEN jsonb_build_object('score', p.output->'score', 'color', p.output->'color')
                   WHEN p.kind = 'recap' AND p.state = 'ready'
                   THEN coalesce(p.output, '{}'::jsonb) || jsonb_build_object('text', p.text)
                   ELSE p.output END);
END $$;

-- The effects of one response, in the registry's order.
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_of(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(public.cockpit_form_effect_view(e) ORDER BY coalesce(o.ord, 1000), e.created_at, e.effect_key)
      FROM public.cockpit_form_effects e
      LEFT JOIN LATERAL (
        SELECT q.ord FROM public.cockpit_forms f CROSS JOIN LATERAL jsonb_array_elements(f.effects) WITH ORDINALITY q(x, ord)
         WHERE f.key = e.form_key AND q.x->>'key' = e.effect_key LIMIT 1) o ON true
     WHERE e.response_id = p_response_id), '[]'::jsonb);
END $$;

-- The drafts of one response's call: the newest attempt per kind for the card
-- and the recording, the grade by the recording alone (one grade per call,
-- whichever client's window started it), the recap by this response alone.
-- Fathom's visibility decides what the cockpit may show (Y10): once the store
-- says the recording is gone or no longer a client or candidate call, every
-- draft of it reads as skipped with checkin.drafts' sentence (6.5) and no
-- output, so a direct read answers as the window does. The rows stay as
-- written, and draft_view, which answers the door's finish, is unchanged.
CREATE OR REPLACE FUNCTION public.cockpit_form_drafts_for(p public.cockpit_form_responses)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rec text := CASE WHEN p.answers->'call'->>'kind' = 'fathom' THEN p.answers->'call'->>'recordingId' END;
  v_shown boolean;
BEGIN
  IF v_rec IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT m.class IN ('client','candidate') AND m.gone_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_csm_calls c
                          WHERE c.source = 'fathom' AND c.source_id = m.recording_id AND c.status = 'gone')
    INTO v_shown
    FROM public.cockpit_fathom_meetings m WHERE m.recording_id = v_rec;
  RETURN coalesce((
    SELECT jsonb_agg(CASE WHEN coalesce(v_shown, false) THEN public.cockpit_form_draft_view(z.d)
                          ELSE public.cockpit_form_draft_view(z.d)
                               || jsonb_build_object('state', 'skipped', 'reason', 'That recording is not a client call.',
                                                     'output', NULL)
                     END
                     ORDER BY array_position(ARRAY['todos','client_notes','defcon_priority','grade','recap'], z.kind))
      FROM (SELECT DISTINCT ON (x.kind) x AS d, x.kind
              FROM public.cockpit_form_drafts x
             WHERE x.form_key = p.form_key AND x.recording_id = v_rec
               AND ((x.kind IN ('todos','client_notes','defcon_priority') AND x.task_id = p.task_id)
                    OR x.kind = 'grade'
                    OR (x.kind = 'recap' AND x.response_id = p.id))
             ORDER BY x.kind, x.started_at DESC, x.attempt DESC) z), '[]'::jsonb);
END $$;

-- ---------------------------------------------------------------------------
-- 6. Browser RPCs (authenticated only, each gated first)

-- What every entry point shows: the main action follows provider, the shadow
-- menu item follows mode = shadow. native is true where the cockpit's window
-- can open the form (checkin, in 2a); mode is null where it cannot.
CREATE OR REPLACE FUNCTION public.cockpit_form_entry(p_form_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor jsonb; f public.cockpit_forms; v_native boolean;
BEGIN
  v_actor := public.cockpit_form_actor();
  IF NOT (coalesce((v_actor->>'csm')::boolean, false) OR coalesce((v_actor->>'admin')::boolean, false)
          OR coalesce((v_actor->>'ceo')::boolean, false)) THEN
    RAISE EXCEPTION 'Current confirmed client-success access is required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no form called %.', coalesce(p_form_key, '') USING ERRCODE = '22023';
  END IF;
  v_native := f.key = 'checkin';
  RETURN jsonb_build_object('key', f.key, 'title', f.title, 'provider', f.provider, 'typeformId', f.typeform_id,
    'version', f.version, 'native', v_native,
    'mode', CASE WHEN NOT v_native THEN NULL WHEN f.provider = 'native' THEN 'live' ELSE 'shadow' END,
    'now', now());
END $$;

-- Open the notes for a card (section 2.1 open, steps 1-6). A seat's draft of
-- the same mode is resumed; one of the other mode (a shadow draft left from
-- before the cut-over) is closed, so the one-draft index never blocks a live
-- open; a new draft takes the browser's request ID. This seat's own submitted,
-- confirmed or void notes named by the ID come back as a read: after a void
-- one the window mints a new ID and opens again. Another seat's are refused.
CREATE OR REPLACE FUNCTION public.cockpit_form_open(p_form_key text, p_task_id text, p_response_id uuid, p_rehearse boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v jsonb;
  f public.cockpit_forms;
  r public.cockpit_form_responses;
  d public.cockpit_form_responses;
  ver public.cockpit_form_versions;
  v_actor uuid;
  v_rehearse boolean := coalesce(p_rehearse, false);
  v_found boolean := false;
  v_client jsonb;
BEGIN
  v := public.cockpit_form_access(p_form_key, p_task_id, v_rehearse);
  v_actor := (v->'actor'->>'actorId')::uuid;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key;
  SELECT jsonb_build_object('taskId', p_task_id, 'name', coalesce(v->'gate'->>'clientName', s.data->>'name'),
                            'stage', nullif(btrim(s.data->>'stage'), ''), 'happiness', nullif(btrim(s.data->>'happiness'), ''))
    INTO v_client
    FROM public.cockpit_csm_sources s WHERE s.table_name = 'clients' AND s.data->>'taskId' = p_task_id LIMIT 1;

  IF NOT v_rehearse THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_form_open:' || p_form_key || ':' || p_task_id || ':' || v_actor::text, 0));
    FOR d IN
      SELECT * FROM public.cockpit_form_responses x
       WHERE x.form_key = p_form_key AND x.task_id = p_task_id AND x.created_by_id = v_actor AND x.state = 'draft'
       ORDER BY x.created_at DESC FOR UPDATE
    LOOP
      IF d.mode = v->>'mode' AND NOT v_found THEN
        r := d;
        v_found := true;
      ELSIF d.mode IS DISTINCT FROM v->>'mode' THEN
        PERFORM set_config('cockpit.forms_action', 'forms.shadow_closed', true);
        UPDATE public.cockpit_form_responses x SET state = 'void' WHERE x.id = d.id;
        PERFORM set_config('cockpit.forms_action', '', true);
      END IF;
    END LOOP;
    IF NOT v_found AND p_response_id IS NOT NULL THEN
      SELECT * INTO d FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
      IF FOUND THEN
        IF d.created_by_id IS DISTINCT FROM v_actor THEN
          RAISE EXCEPTION 'These notes belong to another seat.' USING ERRCODE = '42501';
        END IF;
        IF d.form_key IS DISTINCT FROM p_form_key OR d.task_id IS DISTINCT FROM p_task_id THEN
          RAISE EXCEPTION 'Open the notes from the client page.' USING ERRCODE = '22023';
        END IF;
        -- Sent, confirmed or void (a draft of this seat is resumed or closed
        -- above): a read, nothing written.
        r := d;
      ELSE
        PERFORM set_config('cockpit.forms_action', 'forms.opened', true);
        INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, task_id, client_name, mode, state,
          created_by, created_by_id)
        VALUES (p_response_id, p_form_key, f.version, 'cockpit', p_task_id, v->'gate'->>'clientName', v->>'mode', 'draft',
                v->'actor'->>'email', v_actor)
        RETURNING * INTO r;
        PERFORM set_config('cockpit.forms_action', '', true);
      END IF;
      v_found := true;
    END IF;
    IF NOT v_found THEN
      RAISE EXCEPTION 'Open the notes from the client page.' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO ver FROM public.cockpit_form_versions x
   WHERE x.form_key = f.key AND x.version = coalesce(r.form_version, f.version);
  RETURN jsonb_build_object(
    'form', jsonb_build_object('key', f.key, 'title', f.title, 'provider', f.provider,
              'version', coalesce(ver.version, f.version), 'schema', coalesce(ver.schema, f.schema),
              'effects', f.effects, 'mode', v->>'mode'),
    'response', CASE WHEN v_found THEN public.cockpit_form_response_view(r) END,
    'client', coalesce(v_client, jsonb_build_object('taskId', p_task_id, 'name', v->'gate'->>'clientName',
                                                    'stage', NULL, 'happiness', NULL)),
    'rehearse', v_rehearse,
    'now', now());
END $$;

-- Autosave per field with conflict detection: the cockpit_blueprint_save
-- contract (20261024a) on a response. p_changes is {key: {value, seen,
-- from?}}; seen is the value this window last had confirmed. With
-- p_base_revision equal to the row's every change applies; otherwise a key
-- another session saved last, whose stored value is neither what this window
-- saw nor the new value, is a conflict and comes back with the stored value.
CREATE OR REPLACE FUNCTION public.cockpit_form_save(p_response_id uuid, p_changes jsonb, p_session text, p_base_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v jsonb;
  r public.cockpit_form_responses;
  k text;
  ch jsonb;
  v_val jsonb;
  seen jsonb;
  stored jsonb;
  smeta jsonb;
  v_answers jsonb;
  v_meta jsonb;
  v_from text;
  v_fields text[];
  v_changed boolean := false;
  v_applied text[] := '{}';
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open the notes from the client page.' USING ERRCODE = '22023';
  END IF;
  v := public.cockpit_form_access(r.form_key, r.task_id, false);
  IF r.created_by_id IS DISTINCT FROM (v->'actor'->>'actorId')::uuid THEN
    RAISE EXCEPTION 'Only your own notes can be changed.' USING ERRCODE = '42501';
  END IF;
  IF p_session IS NULL OR p_session !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'This window has no session ID. Reload it, then type again.' USING ERRCODE = '22023';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'There is nothing to save' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_changes)) > 40 THEN
    RAISE EXCEPTION 'Save at most 40 answers at a time' USING ERRCODE = '22023';
  END IF;
  IF p_base_revision IS NOT NULL AND p_base_revision < 1 THEN
    RAISE EXCEPTION 'That is not a revision of these notes' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_form_responses:' || p_response_id::text, 0));
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id FOR UPDATE;
  IF r.state IN ('submitted','confirmed','legacy') THEN
    RAISE EXCEPTION 'These notes are sent. They can no longer change.' USING ERRCODE = '22023';
  ELSIF r.state <> 'draft' THEN
    RAISE EXCEPTION 'Open the notes from the client page.' USING ERRCODE = '22023';
  END IF;
  -- The questions of the version this response was opened with.
  SELECT coalesce(array_agg(fl->>'key'), '{}') INTO v_fields
    FROM public.cockpit_form_versions fv CROSS JOIN LATERAL jsonb_array_elements(fv.schema->'fields') fl
   WHERE fv.form_key = r.form_key AND fv.version = r.form_version;
  v_answers := r.answers;
  v_meta := r.answer_meta;

  FOR k, ch IN SELECT e.key, e.value FROM jsonb_each(p_changes) e ORDER BY e.key LOOP
    IF NOT (k = ANY(v_fields)) THEN
      RAISE EXCEPTION 'That is not a question of this form.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(ch) IS DISTINCT FROM 'object' OR NOT ch ? 'value'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(ch) x WHERE x NOT IN ('value','seen','from')) THEN
      RAISE EXCEPTION 'Each change carries its value, what this window saw, and where a suggestion came from'
        USING ERRCODE = '22023';
    END IF;
    v_from := CASE WHEN jsonb_typeof(ch->'from') = 'string' THEN ch->>'from' END;
    IF v_from IS NOT NULL AND v_from !~ '^[a-z][a-z0-9_.-]{0,39}$' THEN
      RAISE EXCEPTION 'That is not a prefill source' USING ERRCODE = '22023';
    END IF;
    -- A model's DEFCON or priority suggestion is accepted on its own field only.
    IF (v_from = 'ai.defcon' AND k <> 'defcon') OR (v_from = 'ai.priority' AND k <> 'priority') THEN
      RAISE EXCEPTION 'That answer cannot come from a draft.' USING ERRCODE = '22023';
    END IF;
    v_val := public.cockpit_form_checkin_value(k, ch->'value', r.task_id);
    stored := v_answers->k;
    seen := CASE WHEN jsonb_typeof(ch->'seen') IS DISTINCT FROM 'null' THEN ch->'seen' END;
    smeta := v_meta->k;
    IF p_base_revision IS DISTINCT FROM r.revision
       AND (smeta->>'session') IS DISTINCT FROM p_session
       AND stored IS DISTINCT FROM seen AND stored IS DISTINCT FROM v_val THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'key', k, 'theirs', stored, 'by', public.cockpit_blueprint_first_name(smeta->>'by'), 'at', smeta->'at'));
      CONTINUE;
    END IF;
    v_applied := v_applied || k;
    CONTINUE WHEN stored IS NOT DISTINCT FROM v_val;
    v_changed := true;
    IF v_val IS NULL THEN
      v_answers := v_answers - k;
      v_meta := v_meta - k;
    ELSE
      v_answers := jsonb_set(v_answers, ARRAY[k], v_val);
      v_meta := jsonb_set(v_meta, ARRAY[k], jsonb_strip_nulls(jsonb_build_object(
        'by', v->'actor'->>'email', 'at', now(), 'session', p_session, 'from', v_from)));
    END IF;
  END LOOP;

  IF v_changed THEN
    IF octet_length(v_answers::text) > 65536 THEN
      RAISE EXCEPTION 'These notes are too long to save. Shorten the longest answers.' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('cockpit.forms_action', 'forms.saved', true);
    UPDATE public.cockpit_form_responses x
       SET answers = v_answers, answer_meta = v_meta, revision = x.revision + 1
     WHERE x.id = r.id
    RETURNING * INTO r;
    PERFORM set_config('cockpit.forms_action', '', true);
  END IF;
  RETURN jsonb_build_object(
    'row', jsonb_build_object('answers', r.answers, 'meta', public.cockpit_form_response_view(r)->'meta', 'revision', r.revision),
    'applied', to_jsonb(v_applied),
    'conflicts', v_conflicts);
END $$;

-- Send the notes (section 2.1 submit, steps 1-12). The same request ID again
-- returns the first result. A shadow response plans every effect as a
-- shadow; a live one follows the registry's owners, and only a live response
-- is held to one record per call.
CREATE OR REPLACE FUNCTION public.cockpit_form_submit(p_response_id uuid, p_base_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v jsonb;
  r public.cockpit_form_responses;
  f public.cockpit_forms;
  d public.cockpit_form_drafts;
  v_missing text[];
  v_call jsonb;
  v_booking bigint;
  v_other timestamptz;
  v_drafts jsonb := '{}'::jsonb;
  v_plans jsonb;
  e jsonb;
  v_reg jsonb;
  v_key text;
  v_owner text;
  v_state text;
  v_reason text;
  k text;
BEGIN
  -- 1. The response's gate; only this seat's response.
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open the notes from the client page.' USING ERRCODE = '22023';
  END IF;
  v := public.cockpit_form_access(r.form_key, r.task_id, false);
  IF r.created_by_id IS DISTINCT FROM (v->'actor'->>'actorId')::uuid THEN
    RAISE EXCEPTION 'These notes belong to another seat.' USING ERRCODE = '42501';
  END IF;
  -- 2.
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_form_responses:' || p_response_id::text, 0));
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id FOR UPDATE;
  -- 3.
  IF r.state IN ('submitted','confirmed') THEN
    RETURN jsonb_build_object('response', public.cockpit_form_response_view(r),
      'effects', public.cockpit_form_effects_of(r.id), 'duplicate', true);
  END IF;
  -- 4.
  IF r.state <> 'draft' THEN
    RAISE EXCEPTION 'These notes can no longer be sent.' USING ERRCODE = '22023';
  END IF;
  IF p_base_revision IS NOT NULL AND p_base_revision IS DISTINCT FROM r.revision THEN
    RAISE EXCEPTION 'These notes changed in another window. Read them again, then send.' USING ERRCODE = '40001';
  END IF;
  -- 5. A response never changes mode.
  IF r.mode IS DISTINCT FROM v->>'mode' THEN
    IF r.mode = 'shadow' THEN
      RAISE EXCEPTION 'These notes were started as a shadow run. Discard them and start again.' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'The 1-1 notes went back to the Typeform. Discard these notes and use the 1-1 form.' USING ERRCODE = '22023';
  END IF;
  -- 6.
  v_missing := public.cockpit_form_checkin_missing(r.answers);
  IF cardinality(v_missing) > 0 THEN
    IF 'call' = ANY(v_missing) AND jsonb_typeof(r.answers->'call') = 'object' THEN
      RAISE EXCEPTION 'Confirm the call: press Yes, this call, or pick another.' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'Pick the call these notes are for, then DEFCON and priority.' USING ERRCODE = '22023';
  END IF;
  -- 7. The recording may have gone since the save.
  v_call := public.cockpit_form_checkin_value('call', r.answers->'call', r.task_id);
  -- 8. One record per call (a live response only; inert in 2a). The lock is
  -- on the booking when the call has one, else on the recording, so a
  -- booking pick and a recording pick of the same call wait for each other.
  IF r.mode = 'live' AND v_call->>'kind' IN ('fathom','booking') THEN
    IF v_call->>'kind' = 'booking' THEN
      v_booking := (v_call->>'callId')::bigint;
    ELSE
      SELECT p.id INTO v_booking
        FROM public.cockpit_csm_calls c JOIN public.cockpit_csm_calls p ON p.id = c.linked_call_id
       WHERE c.source = 'fathom' AND c.source_id = v_call->>'recordingId' AND p.source = 'ghl_appointment';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_checkin_call:' ||
      CASE WHEN v_booking IS NOT NULL THEN 'booking:' || v_booking::text ELSE 'rec:' || (v_call->>'recordingId') END, 0));
    v_other := public.cockpit_form_call_noted_at(r.id, v_call, v_booking);
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'This call already has 1-1 notes, sent at %.', public.cockpit_form_kuwait_clock(v_other)
        USING ERRCODE = '22023';
    END IF;
  END IF;
  -- 9. A draft kind another response already adopted is recorded here.
  IF v_call->>'kind' = 'fathom' THEN
    FOREACH k IN ARRAY ARRAY['todos','client_notes','defcon_priority'] LOOP
      SELECT * INTO d FROM public.cockpit_form_drafts x
       WHERE x.form_key = r.form_key AND x.task_id = r.task_id AND x.recording_id = v_call->>'recordingId'
         AND x.kind = k AND x.state = 'ready'
       ORDER BY x.started_at DESC, x.attempt DESC LIMIT 1;
      IF FOUND AND d.response_id IS NOT NULL THEN
        v_drafts := v_drafts || jsonb_build_object(k, jsonb_build_object('draftId', d.id,
          'edited', public.cockpit_form_draft_edited(k, d.output, public.cockpit_form_draft_final(k, r.answers))));
      END IF;
    END LOOP;
  END IF;
  PERFORM set_config('cockpit.forms_action', 'forms.submitted', true);
  BEGIN
    UPDATE public.cockpit_form_responses x
       SET state = 'submitted', submitted_at = now(), submitted_by = v->'actor'->>'email',
           answers = jsonb_set(x.answers, '{call}', v_call),
           answer_meta = CASE WHEN v_drafts = '{}'::jsonb THEN x.answer_meta
                              ELSE x.answer_meta || jsonb_build_object('_drafts', v_drafts) END
     WHERE x.id = r.id
    RETURNING * INTO r;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This call already has 1-1 notes, sent at %.',
      public.cockpit_form_kuwait_clock(coalesce(public.cockpit_form_call_noted_at(r.id, v_call, v_booking), now()))
      USING ERRCODE = '22023';
  END;
  PERFORM set_config('cockpit.forms_action', '', true);
  -- 10. One effect row per plan element.
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = r.form_key;
  v_plans := public.cockpit_form_plan_effects(r);
  FOR e IN SELECT x FROM jsonb_array_elements(v_plans) x LOOP
    v_key := e->>'effect';
    SELECT x INTO v_reg FROM jsonb_array_elements(f.effects) x WHERE x->>'key' = v_key LIMIT 1;
    v_reason := NULL;
    IF r.mode = 'shadow' THEN
      v_owner := 'shadow';
      v_state := CASE WHEN e->>'state' = 'skipped' THEN 'skipped' ELSE 'dry_run' END;
    ELSE
      v_owner := coalesce(v_reg->>'owner', 'shadow');
      v_state := CASE WHEN e->>'state' = 'skipped' THEN 'skipped'
                      WHEN v_owner = 'make' THEN 'skipped'
                      WHEN v_owner = 'cockpit' THEN 'planned'
                      ELSE 'dry_run' END;
      IF e->>'state' IS DISTINCT FROM 'skipped' AND v_owner = 'make' THEN
        v_reason := 'Make does this until the switch-over.';
      END IF;
    END IF;
    IF e->>'state' = 'skipped' THEN v_reason := e->>'reason'; END IF;
    INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state, reason)
    VALUES (r.id, r.form_key, v_key, r.id::text || ':' || v_key, v_owner, coalesce(e->>'delivery', v_reg->>'delivery'),
            CASE WHEN jsonb_typeof(e->'plan') = 'object' THEN e->'plan' ELSE '{}'::jsonb END, v_state, left(v_reason, 240))
    ON CONFLICT DO NOTHING;
  END LOOP;
  -- 11. The SQL effects (none in 2a), then the drafts this send adopts. The
  -- grade belongs to the recording and the recap to its own response, so
  -- neither is adopted.
  PERFORM public.cockpit_form_apply_sql_effects(r.id);
  IF v_call->>'kind' = 'fathom' THEN
    FOREACH k IN ARRAY ARRAY['todos','client_notes','defcon_priority'] LOOP
      SELECT * INTO d FROM public.cockpit_form_drafts x
       WHERE x.form_key = r.form_key AND x.task_id = r.task_id AND x.recording_id = v_call->>'recordingId'
         AND x.kind = k AND x.state = 'ready'
       ORDER BY x.started_at DESC, x.attempt DESC LIMIT 1;
      IF FOUND AND d.response_id IS NULL THEN
        UPDATE public.cockpit_form_drafts x
           SET response_id = r.id, final = public.cockpit_form_draft_final(k, r.answers),
               edited = public.cockpit_form_draft_edited(k, x.output, public.cockpit_form_draft_final(k, r.answers))
         WHERE x.id = d.id AND x.response_id IS NULL;
      END IF;
    END LOOP;
  END IF;
  -- 12.
  RETURN jsonb_build_object('response', public.cockpit_form_response_view(r),
    'effects', public.cockpit_form_effects_of(r.id), 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_discard(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; r public.cockpit_form_responses;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open the notes from the client page.' USING ERRCODE = '22023';
  END IF;
  v := public.cockpit_form_access(r.form_key, r.task_id, false);
  IF r.created_by_id IS DISTINCT FROM (v->'actor'->>'actorId')::uuid THEN
    RAISE EXCEPTION 'Only your own notes can be changed.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_form_responses:' || p_response_id::text, 0));
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id FOR UPDATE;
  IF r.state = 'void' THEN
    RETURN jsonb_build_object('id', r.id, 'state', 'void');
  END IF;
  IF r.state <> 'draft' THEN
    RAISE EXCEPTION 'These notes are sent. They can no longer change.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.forms_action', 'forms.discarded', true);
  UPDATE public.cockpit_form_responses x SET state = 'void' WHERE x.id = r.id;
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN jsonb_build_object('id', r.id, 'state', 'void');
END $$;

-- Any seat that passes the client gate for the card may read (in 2a every
-- csm, admin and CEO seat, all in shadow).
CREATE OR REPLACE FUNCTION public.cockpit_form_responses_read(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_form_responses;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open the notes from the client page.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_form_access(r.form_key, r.task_id, false);
  RETURN jsonb_build_object('response', public.cockpit_form_response_view(r),
    'effects', public.cockpit_form_effects_of(r.id), 'drafts', public.cockpit_form_drafts_for(r), 'now', now());
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_drafts_read(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_form_responses;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open the notes from the client page.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_form_access(r.form_key, r.task_id, false);
  RETURN jsonb_build_object(
    'recordingId', CASE WHEN r.answers->'call'->>'kind' = 'fathom' THEN r.answers->'call'->>'recordingId' END,
    'drafts', public.cockpit_form_drafts_for(r), 'now', now());
END $$;

-- ---------------------------------------------------------------------------
-- 7. Service RPCs (service_role only; cockpit_hours_require_service first)

-- The door's verified user as a seat.
CREATE OR REPLACE FUNCTION public.cockpit_forms_actor(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  PERFORM set_config('cockpit.audit_source', 'cockpit-forms-api', true);
  RETURN public.cockpit_form_seat(p_actor) - 'memberId';
END $$;

-- The save's tie rule for the forms door (A7.14): which of these recordings,
-- at most 50, may stand for this card's call by cockpit_form_recording_tied,
-- so the door's listing, drafts and transcript can read the rule the save
-- holds. The seat is the response's own (created_by_id) when a response is
-- named, and that response must be on this card or nothing ties; else
-- p_actor, the door's verified user. The ids come back in the order asked,
-- once each. A read: no audit row. The door runs 3.2's checks (gone, the
-- class, another client) itself.
CREATE OR REPLACE FUNCTION public.cockpit_form_recordings_tied(p_task_id text, p_recording_ids text[], p_actor uuid,
  p_response_id uuid DEFAULT NULL)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat uuid; v_out text[];
BEGIN
  PERFORM public.cockpit_hours_require_service();
  PERFORM set_config('cockpit.audit_source', 'cockpit-forms-api', true);
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_recording_ids), 0) > 50 THEN
    RAISE EXCEPTION 'Ask about 50 recordings at most.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_recording_ids), 0) = 0 THEN RETURN '{}'::text[]; END IF;
  IF p_response_id IS NOT NULL THEN
    -- An imported response has no seat: rules 1 to 3 only.
    SELECT r.created_by_id INTO v_seat FROM public.cockpit_form_responses r
     WHERE r.id = p_response_id AND r.task_id = p_task_id;
    IF NOT FOUND THEN RETURN '{}'::text[]; END IF;
  ELSE
    v_seat := p_actor;
  END IF;
  SELECT coalesce(array_agg(z.id ORDER BY z.n), '{}'::text[]) INTO v_out
    FROM (SELECT x.id, min(x.n) AS n
            FROM unnest(p_recording_ids) WITH ORDINALITY AS x(id, n)
           WHERE x.id ~ '^[0-9]{3,20}$'
           GROUP BY x.id) z
   WHERE public.cockpit_form_recording_tied(z.id, p_task_id, v_seat);
  RETURN v_out;
END $$;

-- Start a draft, or find the one already there (section 2.1 begin, rules 0-4).
-- p = {formKey, taskId, recordingId, responseId?, kind, provider,
-- promptVersion, inputSha256, again, actorEmail}; actorEmail names the seat
-- whose request started a paid draft on a client's transcript.
CREATE OR REPLACE FUNCTION public.cockpit_form_draft_begin(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_form text := coalesce(nullif(p->>'formKey', ''), 'checkin');
  v_task text := p->>'taskId';
  v_rec text := p->>'recordingId';
  v_kind text := p->>'kind';
  v_provider text := p->>'provider';
  v_version text := p->>'promptVersion';
  v_sha text := p->>'inputSha256';
  v_again boolean := coalesce(p->'again' = 'true'::jsonb, false);
  v_actor text := lower(btrim(coalesce(p->>'actorEmail', '')));
  v_response uuid;
  d public.cockpit_form_drafts;
  v_counted integer;
  v_last integer;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  PERFORM set_config('cockpit.audit_source', 'cockpit-forms-api', true);
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Send the draft as an object.' USING ERRCODE = '22023';
  END IF;
  IF v_actor = '' THEN
    RAISE EXCEPTION 'A draft names the seat that asked for it.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_forms f WHERE f.key = v_form) THEN
    RAISE EXCEPTION 'There is no form called %.', v_form USING ERRCODE = '22023';
  END IF;
  IF v_task IS NULL OR v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF v_rec IS NULL OR v_rec !~ '^[0-9]{3,20}$' THEN
    RAISE EXCEPTION 'That recording is not in the cockpit yet. Check again in a minute.' USING ERRCODE = '22023';
  END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('todos','client_notes','defcon_priority','grade','recap') THEN
    RAISE EXCEPTION 'There is no draft called %.', coalesce(v_kind, '') USING ERRCODE = '22023';
  END IF;
  IF v_provider IS NULL OR v_provider NOT IN ('none','deepseek','anthropic') THEN
    RAISE EXCEPTION 'Choose none, deepseek or anthropic.' USING ERRCODE = '22023';
  END IF;
  IF v_version IS NULL OR v_version !~ '^checkin\.[a-z_]+\.v[0-9]+$' THEN
    RAISE EXCEPTION 'That is not a prompt version.' USING ERRCODE = '22023';
  END IF;
  IF v_sha IS NULL OR v_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'The draft has no input hash.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_actor', v_actor, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_form_drafts:' || v_rec || ':' ||
    CASE WHEN v_kind = 'grade' THEN 'grade' ELSE v_task || ':' || v_kind END, 0));

  -- An Edge run that ended without an answer would hold its attempt (and,
  -- for a grade, the one-grade index) for good.
  UPDATE public.cockpit_form_drafts x
     SET state = 'failed', reason = 'The draft did not finish. Draft again.', finished_at = now()
   WHERE x.state = 'drafting' AND x.started_at < now() - interval '5 minutes'
     AND x.recording_id = v_rec AND x.kind = v_kind AND (v_kind = 'grade' OR x.task_id = v_task);

  -- 0. The recap is written from what was sent, for that response alone.
  IF v_kind = 'recap' THEN
    v_response := CASE WHEN p->>'responseId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       THEN (p->>'responseId')::uuid END;
    IF v_response IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.cockpit_form_responses r
          WHERE r.id = v_response AND r.form_key = v_form AND r.task_id = v_task
            AND r.state IN ('submitted','confirmed') AND r.answers->'call'->>'recordingId' = v_rec) THEN
      RAISE EXCEPTION 'The recap is drafted after you send the notes.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- 1. One grade per call, whichever client and version.
  IF v_kind = 'grade' THEN
    IF v_again THEN
      RAISE EXCEPTION 'A call is graded once.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO d FROM public.cockpit_form_drafts x
     WHERE x.recording_id = v_rec AND x.kind = 'grade' AND x.state IN ('ready','drafting')
     ORDER BY x.started_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('id', d.id, 'existing', true, 'state', d.state, 'attempt', d.attempt);
    END IF;
  END IF;
  -- 2 and 3. The newest attempt, unless asked to draft again.
  SELECT * INTO d FROM public.cockpit_form_drafts x
   WHERE x.recording_id = v_rec AND x.task_id = v_task AND x.kind = v_kind AND x.prompt_version = v_version
     AND (v_kind <> 'recap' OR x.response_id = v_response)
   ORDER BY x.attempt DESC LIMIT 1;
  IF FOUND AND NOT v_again AND d.input_sha256 = v_sha
     AND (d.state IN ('ready','drafting') OR (d.state = 'failed' AND d.finished_at > now() - interval '10 minutes')) THEN
    RETURN jsonb_build_object('id', d.id, 'existing', true, 'state', d.state, 'attempt', d.attempt);
  END IF;
  -- 4. Five ready or failed attempts is the limit; off and skipped do not count.
  SELECT count(*) FILTER (WHERE x.state IN ('ready','failed')), coalesce(max(x.attempt), 0)
    INTO v_counted, v_last
    FROM public.cockpit_form_drafts x
   WHERE x.recording_id = v_rec AND x.task_id = v_task AND x.kind = v_kind AND x.prompt_version = v_version;
  IF v_counted >= 5 OR v_last >= 20 THEN
    RAISE EXCEPTION 'Five drafts is the limit for this call.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_form_drafts(form_key, task_id, recording_id, response_id, kind, attempt, provider,
    prompt_version, input_sha256, state, created_by)
  VALUES (v_form, v_task, v_rec, CASE WHEN v_kind = 'recap' THEN v_response END, v_kind, v_last + 1, v_provider,
          v_version, v_sha, 'drafting', v_actor)
  RETURNING * INTO d;
  RETURN jsonb_build_object('id', d.id, 'existing', false, 'state', d.state, 'attempt', d.attempt);
END $$;

-- Finish a draft, only from drafting (else the row comes back unchanged).
-- p = {state, output?, text?, model?, usage?, reason?, actorEmail}.
CREATE OR REPLACE FUNCTION public.cockpit_form_draft_finish(p_id uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.cockpit_form_drafts; v_state text := p->>'state'; v_output jsonb;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  PERFORM set_config('cockpit.audit_source', 'cockpit-forms-api', true);
  IF nullif(btrim(p->>'actorEmail'), '') IS NOT NULL THEN
    PERFORM set_config('cockpit.audit_actor', lower(btrim(p->>'actorEmail')), true);
  END IF;
  IF v_state IS NULL OR v_state NOT IN ('ready','failed','off','skipped') THEN
    RAISE EXCEPTION 'Choose ready, failed, off or skipped.' USING ERRCODE = '22023';
  END IF;
  v_output := CASE WHEN jsonb_typeof(p->'output') = 'object' THEN p->'output' END;
  IF octet_length(coalesce(v_output, '{}'::jsonb)::text) > 65536 THEN
    RAISE EXCEPTION 'The draft is too long to keep.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM public.cockpit_form_drafts x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no draft with that ID.' USING ERRCODE = '22023';
  END IF;
  IF d.state = 'drafting' THEN
    UPDATE public.cockpit_form_drafts x
       SET state = v_state, output = v_output,
           text = left(CASE WHEN jsonb_typeof(p->'text') = 'string' THEN p->>'text' END, 8000),
           model = left(CASE WHEN jsonb_typeof(p->'model') = 'string' THEN p->>'model' END, 80),
           usage = CASE WHEN jsonb_typeof(p->'usage') IN ('object','array') THEN p->'usage' END,
           reason = left(CASE WHEN jsonb_typeof(p->'reason') = 'string' THEN p->>'reason' END, 240),
           finished_at = now()
     WHERE x.id = p_id
    RETURNING * INTO d;
  END IF;
  RETURN public.cockpit_form_draft_view(d);
END $$;

-- ---------------------------------------------------------------------------
-- 8. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (definer functions and triggers call them).
  FOREACH f IN ARRAY ARRAY[
    'cockpit_forms_effects_valid(jsonb)', 'cockpit_form_kuwait_day(timestamptz)', 'cockpit_form_kuwait_clock(timestamptz)',
    'cockpit_form_kuwait_time(timestamptz)', 'cockpit_form_seat(uuid)', 'cockpit_form_actor()', 'cockpit_form_csm_emails()',
    'cockpit_forms_audit()', 'cockpit_forms_refuse_delete()', 'cockpit_form_responses_guard()', 'cockpit_form_effects_guard()',
    'cockpit_form_drafts_guard()', 'cockpit_client_messages_guard()', 'cockpit_form_access(text,text,boolean)',
    'cockpit_form_recording_tied(text,text,uuid)', 'cockpit_form_client_shown(uuid,text,text)',
    'cockpit_form_checkin_value(text,jsonb,text)', 'cockpit_form_checkin_missing(jsonb)',
    'cockpit_form_plan_effects(public.cockpit_form_responses)', 'cockpit_form_draft_final(text,jsonb)',
    'cockpit_form_draft_edited(text,jsonb,jsonb)', 'cockpit_form_call_noted_at(uuid,jsonb,bigint)',
    'cockpit_csm_attach_recording(text,text,text,jsonb)', 'cockpit_form_apply_sql_effects(uuid)',
    'cockpit_form_effect_view(public.cockpit_form_effects)', 'cockpit_form_response_view(public.cockpit_form_responses)',
    'cockpit_form_draft_view(public.cockpit_form_drafts)', 'cockpit_form_effects_of(uuid)',
    'cockpit_form_drafts_for(public.cockpit_form_responses)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- The forms door's RPCs: the service key only.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_forms_actor(uuid)', 'cockpit_form_recordings_tied(text,text[],uuid,uuid)', 'cockpit_form_draft_begin(jsonb)',
    'cockpit_form_draft_finish(uuid,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- The window's RPCs: a signed-in seat, gated inside.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_form_entry(text)', 'cockpit_form_open(text,text,uuid,boolean)', 'cockpit_form_save(uuid,jsonb,text,integer)',
    'cockpit_form_submit(uuid,integer)', 'cockpit_form_discard(uuid)', 'cockpit_form_responses_read(uuid)',
    'cockpit_form_drafts_read(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Seeds (after the audit triggers exist, so each first write has its audit
--    row; a second apply writes nothing)

SELECT set_config('cockpit.audit_actor', 'migration', true), set_config('cockpit.audit_source', 'migration', true);

-- The checkin schema v1 sits between the two marker lines below, as one
-- dollar-quoted literal (the screens' checkin-form.test.ts reads it there).
INSERT INTO public.cockpit_forms (key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
VALUES ('checkin', '1-1 call notes', 'team', 'typeform', 'fRokTITH', 1,
-- checkin schema v1 begin
$checkin_v1${"key":"checkin","version":1,
 "fields":[
  {"key":"call","type":"call","label":"This call","required":true,"locked":true},
  {"key":"defcon","type":"choice","label":"DEFCON","required":true,"locked":"choices",
   "hint":"How the client feels after this call. You pick it; the card's Client Happiness follows.",
   "choices":["Paused","At Risk","Neutral","Happy","Very Happy (testimonial)","Churned"],
   "legacy":{"ref":"ff7970f7-9fad-4fa5-b12b-4d719dfb7587","title":"Defcon Status","type":"multiple_choice"}},
  {"key":"priority","type":"choice","label":"Priority","required":true,
   "choices":["911","High","Medium","Low"],
   "legacy":{"ref":"c9f99fb1-fec9-47e7-9baa-c5554733723d","title":"Task Priority","type":"multiple_choice"}},
  {"key":"we_owe","type":"todos","label":"We owe","side":"ours","max":30,
   "legacy":{"ref":"82a6b434-15d9-4a14-8496-c20c94628536","title":"Additional Notes","type":"long_text","prefix":"Mahara: "}},
  {"key":"they_owe","type":"todos","label":"They owe","side":"theirs","max":30,
   "legacy":{"ref":"82a6b434-15d9-4a14-8496-c20c94628536","title":"Additional Notes","type":"long_text","prefix":"Client: "}},
  {"key":"client_notes","type":"long","label":"Client notes","max":4000,
   "hint":"Internal: their mood, promises, risk talk (pause, cancel, budget), a testimonial offer.",
   "legacy":{"ref":"5d071906-da6a-4413-a729-0c76d0188d91","title":"Client Notes","type":"long_text"}}
 ],
 "legacy":{"clientId":{"ref":"c484f390-9695-4ffa-9693-9cc219592713","title":"Client ID","type":"short_text"},
           "recording":{"ref":"cockpit:call","title":"Call recording","type":"url"}}}$checkin_v1$
-- checkin schema v1 end
  ::jsonb, ARRAY['csm'], true,
  '[{"key":"call_form","owner":"shadow","delivery":"sql","label":"Notes where the client brief reads them"},
    {"key":"call_match","owner":"shadow","delivery":"sql","label":"The recording on this client"},
    {"key":"todo_comment","owner":"shadow","delivery":"clickup_queue","label":"To-do comment on the card"},
    {"key":"happiness","owner":"shadow","delivery":"clickup_queue","label":"Client Happiness"},
    {"key":"last_poc","owner":"shadow","delivery":"clickup_queue","label":"Last POC"},
    {"key":"last_checkin_call","owner":"shadow","delivery":"clickup_queue","label":"Last Check-in Call"},
    {"key":"grade_notice","owner":"shadow","delivery":"slack_notice","label":"Call grade in #client-call-feedback"},
    {"key":"recap","owner":"shadow","delivery":"client_message","label":"Recap for the client''s group"}]'::jsonb,
  'migration')
ON CONFLICT (key) DO NOTHING;

-- Kickoff and the Brand Blueprint get registry rows only in 2a (their
-- responses enter these tables in 2b). Their cockpit effects are deliveries
-- Stage 1 already makes under its own dedupe keys (20261025n); the owner
-- records who delivers and never asks a dispatch here to deliver again.
INSERT INTO public.cockpit_forms (key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
VALUES
  ('kickoff', 'Kickoff', 'team', 'typeform', 'tG7dnxBn', 1,
   '{"key":"kickoff","version":1,"fields":[],"lives":"typeform"}'::jsonb, ARRAY['csm'], true,
   '[{"key":"handoff_comment","owner":"make","delivery":"clickup_queue","label":"Handoff comment"},
     {"key":"onboarding_tasks","owner":"make","delivery":"clickup_queue","label":"Onboarding tasks"},
     {"key":"card_fields","owner":"make","delivery":"clickup_queue","label":"Card fields"},
     {"key":"map_phase4","owner":"make","delivery":"clickup_queue","label":"Map phase 4"},
     {"key":"phase4_whatsapp","owner":"make","delivery":"client_message","label":"Phase 4 WhatsApp"},
     {"key":"kickoff_notice","owner":"cockpit","delivery":"slack_notice","label":"Kickoff notice"},
     {"key":"recap","owner":"shadow","delivery":"client_message","label":"Recap"}]'::jsonb,
   'migration'),
  ('blueprint', 'Brand Blueprint', 'team', 'native', NULL, 1,
   '{"key":"blueprint","version":1,"fields":[],"lives":"apps/client-success-cockpit/src/present/blueprintForm.ts"}'::jsonb,
   ARRAY['creative','csm'], true,
   '[{"key":"launch_task","owner":"cockpit","delivery":"creative_outbox","label":"Launch task"},
     {"key":"close_card","owner":"cockpit","delivery":"creative_outbox","label":"Close card"},
     {"key":"offer_card","owner":"cockpit","delivery":"creative_outbox","label":"Offer card"},
     {"key":"close_notice","owner":"cockpit","delivery":"slack_notice","label":"Close notice"},
     {"key":"media_notice","owner":"cockpit","delivery":"slack_notice","label":"Media notice"},
     {"key":"phase5_whatsapp","owner":"shadow","delivery":"client_message","label":"Phase 5 WhatsApp"},
     {"key":"recap","owner":"shadow","delivery":"client_message","label":"Recap"}]'::jsonb,
   'migration')
ON CONFLICT (key) DO NOTHING;

-- Version 1 of each form copies the stored schema, so the JSON is written once.
INSERT INTO public.cockpit_form_versions (form_key, version, schema, published_by)
SELECT f.key, 1, f.schema, 'migration' FROM public.cockpit_forms f WHERE f.key IN ('checkin','kickoff','blueprint')
ON CONFLICT DO NOTHING;

SELECT set_config('cockpit.audit_actor', '', true), set_config('cockpit.audit_source', '', true);

NOTIFY pgrst, 'reload schema';
COMMIT;
