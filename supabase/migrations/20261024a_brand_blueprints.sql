-- Brand Blueprint: the native form behind the Blueprint call deck, its three
-- partial submits, and the settings the creative director keeps
-- (docs/brand-blueprint/SPEC.md sections 2 and 3). Apply after 20261023a.
--
-- 1. cockpit_blueprints: one row per client card. answers holds the form,
--    answer_meta who saved each key, when, from which browser session and
--    from which prefill; parts holds the three presses ("1" Send to media,
--    "2" Close the call, "3" Lock the offer), absent while open.
-- 2. cockpit_blueprint_settings: the five starter-pack Drive folders (empty
--    until the creative director sets them), the launch media buyer (empty)
--    and close_route ('card_only'; 'slack' and 'make' are later switches
--    only an admin or the CEO may flip).
-- 3. A press queues one cockpit_creative_outbox row (kinds blueprintLaunch,
--    blueprintClose, blueprintOffer) that cockpit-creative-api runs exactly as
--    it runs a video request: cockpit_creative_client_action('get') loads it,
--    the runner fences, journals, claims and settles it. Nothing here calls a
--    provider.
--
-- Both tables are service-only (RLS on, no browser grants). A browser reaches
-- them only through the SECURITY DEFINER functions below, each with
-- search_path '' and cockpit_blueprint_gate_for_actor first: a creative seat
-- with that client writes; a client-success seat with that client reads;
-- admins and the founders pass both. Every write leaves one cockpit_audit_log
-- row through the trigger, and every press one 'blueprint.part_done' row.
-- Addresses never leave the server: the browser gets first names.
--
-- The file touches no existing function and applies twice without error.
BEGIN;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_blueprints (
  task_id        text PRIMARY KEY CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name    text NOT NULL CHECK (btrim(client_name) <> ''),
  answers        jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 65536),
  -- per key: {by: email, at, session, from}; by is never returned to a browser, only a first name
  answer_meta    jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(answer_meta) = 'object' AND octet_length(answer_meta::text) <= 65536),
  -- {"1": {...}, "2": {...}, "3": {...}}, a part absent is open
  parts          jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(parts) = 'object' AND (parts - '1' - '2' - '3') = '{}'::jsonb
                        AND octet_length(parts::text) <= 131072),
  revision       integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  launch_task_id text CHECK (launch_task_id IS NULL OR launch_task_id ~ '^[A-Za-z0-9]{4,20}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL CHECK (btrim(updated_by) <> '')
);

CREATE TABLE IF NOT EXISTS public.cockpit_blueprint_settings (
  key        text PRIMARY KEY CHECK (key ~ '^(pack\.(design-build|interior|architecture|fitout|construction)|launch_assignee|close_route)$'),
  value      text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 500),
  label      text CHECK (label IS NULL OR char_length(label) <= 120),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> '')
);
-- The press looks up the latest row of a part by card and kind.
CREATE INDEX IF NOT EXISTS cockpit_creative_outbox_task_kind
  ON public.cockpit_creative_outbox (task_id, kind, created_at DESC);

ALTER TABLE public.cockpit_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_blueprint_settings ENABLE ROW LEVEL SECURITY;
-- The service key reads, inserts and updates; it never deletes or truncates
-- (a TRUNCATE would skip the row audit), so Supabase's default grants go too.
REVOKE ALL ON public.cockpit_blueprints, public.cockpit_blueprint_settings
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_blueprints, public.cockpit_blueprint_settings TO service_role;

-- ---------------------------------------------------------------------------
-- Audit: one row per write, whoever writes. A row's answers are recorded as
-- the keys a write changed, and answer_meta (addresses, sessions) is left
-- out, so a debounced field does not copy the whole form each time. The
-- functions name the action through the transaction-local
-- cockpit.blueprint_action.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_blueprint_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_row jsonb; new_row jsonb; row_any jsonb; o jsonb; n jsonb; b jsonb; a jsonb;
  keys text[] := '{}'; entity text; who text; act text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN new_row := to_jsonb(NEW); END IF;
  row_any := coalesce(new_row, old_row);
  IF TG_TABLE_NAME = 'cockpit_blueprints' THEN
    entity := row_any->>'task_id';
    o := coalesce(old_row->'answers', '{}'::jsonb);
    n := coalesce(new_row->'answers', '{}'::jsonb);
    SELECT coalesce(jsonb_object_agg(x.k, o->x.k) FILTER (WHERE o ? x.k), '{}'::jsonb),
           coalesce(jsonb_object_agg(x.k, n->x.k) FILTER (WHERE n ? x.k), '{}'::jsonb),
           coalesce(array_agg(x.k ORDER BY x.k), '{}')
      INTO b, a, keys
      FROM (SELECT k FROM jsonb_object_keys(o) k UNION SELECT k FROM jsonb_object_keys(n) k) x
     WHERE (o->x.k) IS DISTINCT FROM (n->x.k);
    IF old_row IS NOT NULL THEN old_row := (old_row - 'answers' - 'answer_meta') || jsonb_build_object('answers', b); END IF;
    IF new_row IS NOT NULL THEN new_row := (new_row - 'answers' - 'answer_meta') || jsonb_build_object('answers', a); END IF;
  ELSE
    entity := row_any->>'key';
  END IF;
  act := coalesce(nullif(current_setting('cockpit.blueprint_action', true), ''), 'blueprint.' || lower(TG_OP));
  SELECT lower(btrim(u.email)) INTO who FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system,
                                       before, after, metadata)
  VALUES (act, TG_TABLE_NAME, entity, coalesce(who, session_user), 'creative', 'supabase', old_row, new_row,
          jsonb_build_object('op', TG_OP, 'changed', to_jsonb(keys),
                             'database_role', current_setting('role', true)));
  RETURN coalesce(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cockpit_blueprints_audit ON public.cockpit_blueprints;
CREATE TRIGGER cockpit_blueprints_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_blueprints
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_blueprint_audit();
DROP TRIGGER IF EXISTS cockpit_blueprint_settings_audit ON public.cockpit_blueprint_settings;
CREATE TRIGGER cockpit_blueprint_settings_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_blueprint_settings
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_blueprint_audit();

-- The close switch starts at card_only (SPEC 3.6). Seeded after the audit
-- trigger exists, so this first write has its audit row too; a second apply
-- writes nothing.
INSERT INTO public.cockpit_blueprint_settings(key, value, updated_by)
VALUES ('close_route', 'card_only', 'migration') ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Internal helpers (no browser grant)
-- ---------------------------------------------------------------------------

-- A seat's first name: the seat's own name, else the team list's by address,
-- an all-lowercase name capitalised; never the address itself.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_first_name(p_email text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN RETURN NULL; END IF;
  SELECT CASE WHEN m.name LIKE '%@%' THEN NULL ELSE nullif(btrim(m.name), '') END INTO v
    FROM public.cockpit_members m WHERE m.email = lower(btrim(p_email)) LIMIT 1;
  IF v IS NULL THEN
    SELECT p.name INTO v FROM public.cockpit_people p
     WHERE lower(p.email) = lower(btrim(p_email)) AND p.name NOT LIKE '%@%' AND btrim(p.name) <> ''
     ORDER BY p.active DESC NULLS LAST LIMIT 1;
  END IF;
  v := nullif(split_part(btrim(coalesce(v, '')), ' ', 1), '');
  RETURN CASE WHEN v = lower(v) THEN initcap(v) ELSE v END;
END $$;

-- The signed-in seat, for the reads and settings that are not one client's.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_seat() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cockpit_members; founder boolean;
BEGIN
  SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id = cm.auth_user_id
   WHERE auth.uid() IS NOT NULL AND cm.auth_user_id = auth.uid() AND cm.active
     AND u.email_confirmed_at IS NOT NULL AND cm.email = lower(btrim(u.email));
  -- The founders as cockpit_is_ceo lists them (this runs as auth.uid()).
  founder := coalesce(public.cockpit_is_ceo(), false);
  IF m.auth_user_id IS NULL OR NOT ('creative' = ANY(m.roles) OR 'csm' = ANY(m.roles)
                                    OR 'admin' = ANY(m.roles) OR founder) THEN
    RAISE EXCEPTION 'Current confirmed creative or client-success access is required' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('email', m.email, 'creative', 'creative' = ANY(m.roles), 'csm', 'csm' = ANY(m.roles),
                            'admin', 'admin' = ANY(m.roles), 'founder', founder);
END $$;

-- One list of short lines: trimmed, blanks and repeats dropped, in order.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_lines(p_value jsonb, p_what text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE items text[];
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN '{}'; END IF;
  IF jsonb_typeof(p_value) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_value) e WHERE jsonb_typeof(e) <> 'string') THEN
    RAISE EXCEPTION '% is a list of short lines', p_what USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(d.v ORDER BY d.o), '{}') INTO items
    FROM (SELECT z.v, min(z.o) AS o
            FROM (SELECT regexp_replace(btrim(e #>> '{}'), '\s+', ' ', 'g') AS v, q.o
                    FROM jsonb_array_elements(p_value) WITH ORDINALITY q(e, o)) z
           WHERE z.v <> '' GROUP BY z.v) d;
  IF cardinality(items) > 12 THEN
    RAISE EXCEPTION '% holds at most 12 lines', p_what USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(items) i WHERE char_length(i) > 200) THEN
    RAISE EXCEPTION 'Each line of % is at most 200 characters', p_what USING ERRCODE = '22023';
  END IF;
  RETURN items;
END $$;

-- One answer, validated and normalised. NULL (or a blank) removes the key.
-- The allow-list is SPEC 1.2 to 1.4 plus capacity_note, pack_changes,
-- dna_missing and scripts_date; shot_list_due is the server's own.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_value(p_key text, p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t text; s text; n numeric; d date; items text[]; x jsonb; v_out jsonb; nm text; seen text[] := '{}';
  allowed text[];
BEGIN
  t := CASE
    WHEN p_key IN ('service','capacity','starter','pack_approval','destination','identity','approval',
                   'dna_status','camera','content_rating','scripts_status') THEN 'choice'
    WHEN p_key IN ('capacity_note','margin') THEN 'text'
    WHEN p_key IN ('pack_changes','dna_missing','best_client','not_for','method','city_cant','pricing','terms',
                   'why_us','events','csm_signals','anything_else') THEN 'long'
    WHEN p_key = 'pack_url' THEN 'url'
    WHEN p_key = 'daily_budget' THEN 'usd'
    WHEN p_key = 'red_lines' THEN 'lines'
    WHEN p_key IN ('minimum','anchor') THEN 'money'
    WHEN p_key = 'competitors' THEN 'names'
    WHEN p_key = 'rules' THEN 'rules'
    WHEN p_key IN ('shot_list','readback_yes') THEN 'ticks'
    WHEN p_key = 'offer' THEN 'offer'
    WHEN p_key = 'scripts_date' THEN 'date'
  END;
  IF t IS NULL THEN
    RAISE EXCEPTION 'The Brand Blueprint has no answer called %', coalesce(p_key, '(none)') USING ERRCODE = '22023';
  END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;

  IF t IN ('choice','text','long','url','date') AND jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION 'The answer to % is text', p_key USING ERRCODE = '22023';
  END IF;

  IF t = 'choice' THEN
    s := btrim(p_value #>> '{}');
    IF s = '' THEN RETURN NULL; END IF;
    allowed := CASE p_key
      WHEN 'service' THEN ARRAY['design-build','interior','architecture','fitout','construction']
      WHEN 'capacity' THEN ARRAY['yes','tight','no']
      WHEN 'starter' THEN ARRAY['yes','no']
      WHEN 'pack_approval' THEN ARRAY['on_call','before','wants_changes']
      WHEN 'destination' THEN ARRAY['lead_form','landing_page']
      WHEN 'identity' THEN ARRAY['their_page','our_page']
      WHEN 'approval' THEN ARRAY['every','first_batch','run_then_show']
      WHEN 'dna_status' THEN ARRAY['complete','small_gaps','big_gaps']
      WHEN 'camera' THEN ARRAY['yes_studio','yes_phone','no','unsure']
      WHEN 'content_rating' THEN ARRAY['strong','usable','weak','none']
      WHEN 'scripts_status' THEN ARRAY['in_progress','with_editors']
    END;
    IF NOT (s = ANY(allowed)) THEN
      RAISE EXCEPTION '"%" is not one of the answers to %', left(s, 40), p_key USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(s);
  END IF;

  IF t IN ('text','long') THEN
    s := btrim(p_value #>> '{}', E' \t\r\n');
    IF t = 'text' THEN s := regexp_replace(s, '\s*[\r\n]+\s*', ' ', 'g'); END IF;
    IF s = '' THEN RETURN NULL; END IF;
    IF char_length(s) > (CASE t WHEN 'text' THEN 300 ELSE 4000 END) THEN
      RAISE EXCEPTION 'The answer to % is at most % characters', p_key, (CASE t WHEN 'text' THEN 300 ELSE 4000 END)
        USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(s);
  END IF;

  IF t = 'url' THEN
    s := btrim(p_value #>> '{}');
    IF s = '' THEN RETURN NULL; END IF;
    IF s !~ '^https://drive\.google\.com/drive/(u/[0-9]/)?folders/[A-Za-z0-9_-]{10,100}(\?[A-Za-z0-9=&_.-]{0,100})?$' THEN
      RAISE EXCEPTION 'Paste the starter pack''s Google Drive folder link' USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(s);
  END IF;

  IF t = 'date' THEN
    s := btrim(p_value #>> '{}');
    IF s = '' THEN RETURN NULL; END IF;
    IF s !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Choose a real date for %', p_key USING ERRCODE = '22023';
    END IF;
    BEGIN d := s::date; EXCEPTION WHEN OTHERS THEN d := NULL; END;
    IF d IS NULL OR to_char(d, 'YYYY-MM-DD') <> s THEN
      RAISE EXCEPTION 'Choose a real date for %', p_key USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(s);
  END IF;

  IF t = 'ticks' THEN
    IF jsonb_typeof(p_value) <> 'boolean' THEN
      RAISE EXCEPTION 'The answer to % is a tick', p_key USING ERRCODE = '22023';
    END IF;
    RETURN CASE WHEN p_value = 'true'::jsonb THEN 'true'::jsonb END;
  END IF;

  IF t = 'usd' THEN
    IF jsonb_typeof(p_value) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('usd','said')) THEN
      RAISE EXCEPTION 'The daily budget is a number of dollars and what was said' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_value->'usd') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Enter the daily budget in dollars' USING ERRCODE = '22023';
    END IF;
    n := (p_value->>'usd')::numeric;
    IF n < 1 OR n > 100000 THEN
      RAISE EXCEPTION 'The daily budget is from 1 to 100,000 dollars' USING ERRCODE = '22023';
    END IF;
    IF p_value ? 'said' AND jsonb_typeof(p_value->'said') NOT IN ('string','null') THEN
      RAISE EXCEPTION 'What was said about the budget is text' USING ERRCODE = '22023';
    END IF;
    s := nullif(btrim(coalesce(p_value->>'said', '')), '');
    IF char_length(s) > 200 THEN
      RAISE EXCEPTION 'What was said about the budget is at most 200 characters' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_strip_nulls(jsonb_build_object('usd', n, 'said', s));
  END IF;

  IF t = 'money' THEN
    IF jsonb_typeof(p_value) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('amount','currency')) THEN
      RAISE EXCEPTION 'The answer to % is an amount and its currency', p_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_value->'amount') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Enter the amount for % as a number', p_key USING ERRCODE = '22023';
    END IF;
    n := (p_value->>'amount')::numeric;
    IF n < 1 OR n > 100000000 THEN
      RAISE EXCEPTION 'The amount for % is from 1 to 100,000,000', p_key USING ERRCODE = '22023';
    END IF;
    s := p_value->>'currency';
    IF s IS NULL OR NOT (s = ANY(ARRAY['KWD','SAR','AED','QAR','BHD','OMR','USD'])) THEN
      RAISE EXCEPTION 'Choose the currency for %', p_key USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('amount', n, 'currency', s);
  END IF;

  IF t = 'lines' THEN
    items := public.cockpit_blueprint_lines(p_value, p_key);
    RETURN CASE WHEN cardinality(items) = 0 THEN NULL ELSE to_jsonb(items) END;
  END IF;

  IF t = 'rules' THEN
    IF jsonb_typeof(p_value) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('always','never','neverShow')) THEN
      RAISE EXCEPTION 'The rules are three lists: always, never and never show' USING ERRCODE = '22023';
    END IF;
    v_out := '{}'::jsonb;
    FOREACH s IN ARRAY ARRAY['always','never','neverShow'] LOOP
      items := public.cockpit_blueprint_lines(p_value->s, 'The ' || s || ' list');
      IF cardinality(items) > 0 THEN v_out := v_out || jsonb_build_object(s, to_jsonb(items)); END IF;
    END LOOP;
    RETURN CASE WHEN v_out = '{}'::jsonb THEN NULL ELSE v_out END;
  END IF;

  IF t = 'names' THEN
    IF jsonb_typeof(p_value) <> 'array' THEN
      RAISE EXCEPTION 'The competitors are a list of names' USING ERRCODE = '22023';
    END IF;
    v_out := '[]'::jsonb;
    FOR x IN SELECT e FROM jsonb_array_elements(p_value) e LOOP
      -- A name, marked or not as one they lose to, and what they are known
      -- for in the client's words (one line, the clipping on slide 8).
      IF jsonb_typeof(x) <> 'object'
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('name','lose','note'))
         OR jsonb_typeof(x->'name') IS DISTINCT FROM 'string'
         OR (x ? 'lose' AND jsonb_typeof(x->'lose') NOT IN ('boolean','null'))
         OR (x ? 'note' AND jsonb_typeof(x->'note') NOT IN ('string','null')) THEN
        RAISE EXCEPTION 'Each competitor is a name, marked or not as one they lose to, with a line on what they are known for' USING ERRCODE = '22023';
      END IF;
      nm := regexp_replace(btrim(x->>'name'), '\s+', ' ', 'g');
      CONTINUE WHEN nm = '' OR lower(nm) = ANY(seen);
      IF char_length(nm) > 120 THEN
        RAISE EXCEPTION 'A competitor''s name is at most 120 characters' USING ERRCODE = '22023';
      END IF;
      s := nullif(regexp_replace(btrim(coalesce(x->>'note', '')), '\s+', ' ', 'g'), '');
      IF char_length(s) > 160 THEN
        RAISE EXCEPTION 'What a competitor is known for is at most 160 characters' USING ERRCODE = '22023';
      END IF;
      seen := seen || lower(nm);
      v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('name', nm, 'lose', coalesce(x->'lose' = 'true'::jsonb, false), 'note', s)));
    END LOOP;
    IF jsonb_array_length(v_out) > 15 THEN
      RAISE EXCEPTION 'Name at most 15 competitors' USING ERRCODE = '22023';
    END IF;
    RETURN CASE WHEN jsonb_array_length(v_out) = 0 THEN NULL ELSE v_out END;
  END IF;

  -- offer: the name, what they get and the free first step, each trimmed.
  IF jsonb_typeof(p_value) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('name','what','firstStep'))
     OR EXISTS (SELECT 1 FROM jsonb_each(p_value) e WHERE jsonb_typeof(e.value) NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'The offer is its name, what they get and the free first step' USING ERRCODE = '22023';
  END IF;
  v_out := jsonb_strip_nulls(jsonb_build_object(
    'name', nullif(regexp_replace(btrim(coalesce(p_value->>'name', '')), '\s+', ' ', 'g'), ''),
    'what', nullif(regexp_replace(btrim(coalesce(p_value->>'what', '')), '\s+', ' ', 'g'), ''),
    'firstStep', nullif(regexp_replace(btrim(coalesce(p_value->>'firstStep', '')), '\s+', ' ', 'g'), '')));
  IF char_length(v_out->>'name') > 80 OR char_length(v_out->>'what') > 200 OR char_length(v_out->>'firstStep') > 160 THEN
    RAISE EXCEPTION 'The offer''s name is at most 80 characters, what they get 200 and the first step 160'
      USING ERRCODE = '22023';
  END IF;
  RETURN CASE WHEN v_out = '{}'::jsonb THEN NULL ELSE v_out END;
END $$;

-- A part's answers as they count for its press: its own keys, without the
-- ones its conditions switch off (SPEC 1.6).
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_part_answers(p_part integer, p_answers jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := coalesce(p_answers, '{}'::jsonb); keys text[]; v_out jsonb;
BEGIN
  keys := CASE p_part
    WHEN 1 THEN ARRAY['service','capacity','capacity_note','starter','pack_url','pack_approval','pack_changes',
                      'daily_budget','destination','identity','red_lines']
    WHEN 2 THEN ARRAY['best_client','not_for','method','city_cant','pricing','minimum','anchor','terms','margin',
                      'competitors','why_us','approval','dna_status','dna_missing','rules','camera','content_rating',
                      'shot_list','shot_list_due','events','readback_yes','csm_signals','anything_else']
    WHEN 3 THEN ARRAY['offer','scripts_status','scripts_date']
  END;
  IF keys IS NULL THEN RAISE EXCEPTION 'Choose part 1, 2 or 3' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(jsonb_object_agg(k, a->k), '{}'::jsonb) INTO v_out
    FROM unnest(keys) k WHERE a ? k AND jsonb_typeof(a->k) <> 'null';
  IF p_part = 1 THEN
    IF (v_out->>'starter') IS DISTINCT FROM 'yes' THEN v_out := v_out - 'pack_url' - 'pack_approval' - 'pack_changes'; END IF;
    IF (v_out->>'pack_approval') IS DISTINCT FROM 'wants_changes' THEN v_out := v_out - 'pack_changes'; END IF;
    IF coalesce(v_out->>'capacity', '') NOT IN ('tight','no') THEN v_out := v_out - 'capacity_note'; END IF;
  ELSIF p_part = 2 THEN
    IF coalesce(v_out->>'dna_status', 'complete') = 'complete' THEN v_out := v_out - 'dna_missing'; END IF;
    IF (v_out->'shot_list') IS DISTINCT FROM 'true'::jsonb THEN v_out := v_out - 'shot_list_due'; END IF;
  END IF;
  RETURN v_out;
END $$;

-- The required keys a part still lacks, in the form's order (SPEC 1.2 to
-- 1.6). The browser's registry mirrors it (blueprintForm.ts missing()).
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_missing(p_part integer, p_answers jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := public.cockpit_blueprint_part_answers(p_part, p_answers); m text[] := '{}'; k text;
BEGIN
  IF p_part = 1 THEN
    FOREACH k IN ARRAY ARRAY['service','capacity'] LOOP
      IF NOT a ? k THEN m := m || k; END IF;
    END LOOP;
    IF a->>'capacity' IN ('tight','no') AND NOT a ? 'capacity_note' THEN m := m || 'capacity_note'::text; END IF;
    IF NOT a ? 'starter' THEN m := m || 'starter'::text; END IF;
    IF a->>'starter' = 'yes' THEN
      IF NOT a ? 'pack_url' THEN m := m || 'pack_url'::text; END IF;
      IF NOT a ? 'pack_approval' THEN m := m || 'pack_approval'::text; END IF;
      IF a->>'pack_approval' = 'wants_changes' AND NOT a ? 'pack_changes' THEN m := m || 'pack_changes'::text; END IF;
    END IF;
    FOREACH k IN ARRAY ARRAY['daily_budget','destination','identity'] LOOP
      IF NOT a ? k THEN m := m || k; END IF;
    END LOOP;
  ELSIF p_part = 2 THEN
    FOREACH k IN ARRAY ARRAY['best_client','method','pricing','minimum','anchor','competitors','approval','dna_status'] LOOP
      IF NOT a ? k THEN m := m || k; END IF;
    END LOOP;
    IF a->>'dna_status' IN ('small_gaps','big_gaps') AND NOT a ? 'dna_missing' THEN m := m || 'dna_missing'::text; END IF;
    FOREACH k IN ARRAY ARRAY['rules','camera','readback_yes'] LOOP
      IF NOT a ? k THEN m := m || k; END IF;
    END LOOP;
  ELSE
    IF NOT (coalesce(a->'offer', '{}'::jsonb) ?& ARRAY['name','what','firstStep']) THEN m := m || 'offer'::text; END IF;
  END IF;
  RETURN m;
END $$;

-- The shot list is due 72 hours after today's Blueprint call starts, or
-- after now when no call of today is on record.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_shot_due(p_task_id text) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT c.starts_at FROM public.cockpit_csm_calls c
      WHERE c.task_id = p_task_id AND c.kind = 'blueprint' AND c.starts_at IS NOT NULL
        AND c.status IN ('booked','confirmed','showed','held')
        AND (c.starts_at AT TIME ZONE 'Asia/Kuwait')::date = (now() AT TIME ZONE 'Asia/Kuwait')::date
      ORDER BY c.starts_at LIMIT 1),
    now()) + interval '72 hours'
$$;

-- The three settings as the screens and the payloads read them.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_settings_json() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'packs', (SELECT jsonb_object_agg(s.service, (SELECT x.value FROM public.cockpit_blueprint_settings x
                                                   WHERE x.key = 'pack.' || s.service))
                FROM unnest(ARRAY['design-build','interior','architecture','fitout','construction']) s(service)),
    'assignee', (SELECT jsonb_build_object('id', x.value, 'label', x.label)
                   FROM public.cockpit_blueprint_settings x WHERE x.key = 'launch_assignee'),
    'closeRoute', coalesce((SELECT x.value FROM public.cockpit_blueprint_settings x WHERE x.key = 'close_route'), 'card_only'),
    'changes', (SELECT coalesce(jsonb_object_agg(x.key, jsonb_build_object(
                         'at', x.updated_at, 'by', public.cockpit_blueprint_first_name(x.updated_by))), '{}'::jsonb)
                  FROM public.cockpit_blueprint_settings x))
$$;

-- The card's Creative Onboarding steps 2, 3 and 4: the newest parent of kind
-- onboarding that names this client, then its children "2 ·", "3 ·", "4 ·".
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_steps(p_client_name text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_parent jsonb; v_steps jsonb := '{}'::jsonb; v_step jsonb; n text;
BEGIN
  SELECT r.data INTO v_parent FROM public.cockpit_creative_sources r
   WHERE r.table_name = 'creativeTasks' AND public.cockpit_creative_source_current(r.table_name, r.source_snapshot_at)
     AND r.data->>'kind' = 'onboarding' AND nullif(r.data->>'parentId', '') IS NULL
     AND EXISTS (SELECT 1 FROM unnest(r.client_names) c WHERE lower(btrim(c)) = lower(btrim(p_client_name)))
   ORDER BY CASE WHEN r.data->>'createdAt' ~ '^[0-9]+(\.[0-9]+)?$' THEN (r.data->>'createdAt')::numeric END DESC NULLS LAST,
            r.source_id DESC
   LIMIT 1;
  IF v_parent IS NULL THEN RETURN NULL; END IF;
  FOREACH n IN ARRAY ARRAY['2','3','4'] LOOP
    SELECT jsonb_build_object('taskId', r.data->>'taskId', 'parentId', r.data->>'parentId', 'name', r.data->>'name',
                              'status', r.data->>'status')
      INTO v_step FROM public.cockpit_creative_sources r
     WHERE r.table_name = 'creativeTasks' AND public.cockpit_creative_source_current(r.table_name, r.source_snapshot_at)
       AND r.data->>'parentId' = v_parent->>'taskId'
       AND r.data->>'name' ~ ('^\s*' || n || '\s*[·.:)-]')
     ORDER BY r.source_id LIMIT 1;
    IF v_step IS NOT NULL THEN v_steps := v_steps || jsonb_build_object(n, v_step); END IF;
    v_step := NULL;
  END LOOP;
  RETURN jsonb_build_object('parentId', v_parent->>'taskId', 'parentName', v_parent->>'name', 'steps', v_steps);
END $$;

-- One row as a browser reads it: first names only, never an address or a
-- session, and the latest outbox row of each part.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_json(p_row public.cockpit_blueprints) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_meta jsonb; v_parts jsonb; v_outbox jsonb;
BEGIN
  IF p_row.task_id IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_object_agg(e.key, jsonb_strip_nulls(jsonb_build_object(
           'by', public.cockpit_blueprint_first_name(e.value->>'by'), 'at', e.value->'at', 'from', e.value->'from'))),
         '{}'::jsonb)
    INTO v_meta FROM jsonb_each(p_row.answer_meta) e;
  SELECT coalesce(jsonb_object_agg(e.key, (e.value - 'firstBy' - 'lastBy') || jsonb_build_object(
           'firstBy', public.cockpit_blueprint_first_name(e.value->>'firstBy'),
           'lastBy', public.cockpit_blueprint_first_name(e.value->>'lastBy'))), '{}'::jsonb)
    INTO v_parts FROM jsonb_each(p_row.parts) e;
  SELECT jsonb_object_agg(p.n, (
           SELECT jsonb_build_object('id', o.id, 'state', o.state, 'error', o.error, 'result', o.result,
                                     'createdAt', o.created_at, 'settledAt', o.settled_at)
             FROM public.cockpit_creative_outbox o
            WHERE o.task_id = p_row.task_id AND o.kind = p.kind
            ORDER BY o.created_at DESC, o.id LIMIT 1))
    INTO v_outbox
    FROM (VALUES ('1', 'blueprintLaunch'), ('2', 'blueprintClose'), ('3', 'blueprintOffer')) p(n, kind);
  RETURN jsonb_build_object(
    'taskId', p_row.task_id, 'clientName', p_row.client_name, 'answers', p_row.answers, 'meta', v_meta,
    'parts', v_parts, 'revision', p_row.revision, 'launchTaskId', p_row.launch_task_id,
    'createdAt', p_row.created_at, 'updatedAt', p_row.updated_at,
    'updatedBy', public.cockpit_blueprint_first_name(p_row.updated_by), 'outbox', v_outbox);
END $$;

-- What a press queues (SPEC 3.2), built here so the record is the source.
-- p_row is to_jsonb() of the stored row, or NULL (a rehearsal with nothing
-- stored yet); p_answers is the whole form.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_payload(p_gate jsonb, p_part integer, p_answers jsonb, p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_task text := p_gate->>'taskId'; v_name text := p_gate->>'clientName';
  a jsonb := coalesce(p_answers, '{}'::jsonb); v_part jsonb; v_meta jsonb := coalesce(p_row->'answer_meta', '{}'::jsonb);
  v_links jsonb; v_handover jsonb; v_kick jsonb; v_csm text; cc jsonb; v_settings jsonb; v_steps jsonb;
  v_kickoff jsonb; v_out jsonb; v_link jsonb; v_call jsonb; v_previous jsonb;
  v_kind text := CASE p_part WHEN 1 THEN 'blueprintLaunch' WHEN 2 THEN 'blueprintClose' ELSE 'blueprintOffer' END;
BEGIN
  v_part := public.cockpit_blueprint_part_answers(p_part, a);
  -- What media last received for this part: the answers of its latest run
  -- that started (sending or done). None means this press is the first: the
  -- brief, the WhatsApp text, the Slack post and Make go only with a first
  -- press, so a run that never started does not swallow them. A close in
  -- reconcile counts too, since it may have sent the WhatsApp text, Slack or
  -- Make, which must never repeat. A launch or offer in reconcile does not:
  -- they send nothing to the client, and a launch task made by a run that
  -- stopped before its brief must still get the brief.
  SELECT o.payload->'answers' INTO v_previous FROM public.cockpit_creative_outbox o
   WHERE o.task_id = v_task AND o.kind = v_kind
     AND (o.state IN ('sending','done') OR (o.state = 'reconcile' AND v_kind = 'blueprintClose'))
   ORDER BY o.created_at DESC, o.id LIMIT 1;
  SELECT o.links, o.handover, o.forms->'kickoff'->'answers', o.csm INTO v_links, v_handover, v_kick, v_csm
    FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_task;
  SELECT r.data INTO cc FROM public.cockpit_creative_sources r
   WHERE r.table_name = 'clients' AND r.data->>'taskId' = v_task
     AND public.cockpit_creative_source_current(r.table_name, r.source_snapshot_at) LIMIT 1;
  v_settings := public.cockpit_blueprint_settings_json();
  v_steps := public.cockpit_blueprint_steps(v_name);

  -- A link counts only as an https string.
  SELECT jsonb_object_agg(x.k, x.v) INTO v_link FROM (
    SELECT l.k, (SELECT c.v FROM unnest(l.candidates) WITH ORDINALITY c(v, o) WHERE c.v ~ '^https://' ORDER BY c.o LIMIT 1) AS v
      FROM (VALUES
        ('drive', ARRAY[v_links->>'drive', cc->>'driveLink', cc->>'driveFolder']),
        ('driveFolder', ARRAY[v_links->>'drive_folder', cc->>'driveFolder']),
        ('brandDna', ARRAY[v_links->>'brand_dna', cc->>'brandDnaDoc']),
        ('offerSheet', ARRAY[v_links->>'offer_sheet', cc->>'offerCheatSheet']),
        ('research', ARRAY[v_links->>'market_research', cc->>'marketResearchDoc'])) l(k, candidates)) x;

  v_out := jsonb_build_object(
    'v', 1, 'part', p_part,
    'press', coalesce((p_row->'parts'->(p_part::text)->>'presses')::integer, 0) + 1,
    'card', jsonb_build_object('id', v_task, 'name', v_name),
    'answers', v_part,
    'from', (SELECT coalesce(jsonb_object_agg(k, v_meta->k->'from'), '{}'::jsonb)
               FROM jsonb_object_keys(v_part) k WHERE v_meta->k ? 'from'),
    'at', (SELECT coalesce(jsonb_object_agg(k, v_meta->k->'at'), '{}'::jsonb)
             FROM jsonb_object_keys(v_part) k WHERE v_meta->k ? 'at'),
    'previous', v_previous,
    'launchTaskId', p_row->>'launch_task_id',
    'sentAt', now(), 'sentBy', p_gate->>'firstName',
    'links', v_link);

  IF p_part = 1 THEN
    -- The kickoff's raw answers by their Typeform refs (tG7dnxBn).
    SELECT jsonb_build_object(
             'budgetSaid', max(CASE WHEN x->>'ref' LIKE 'cf53482c%' THEN x->>'value' END),
             'platforms', max(CASE WHEN x->>'ref' LIKE '7d16afbb%' THEN x->>'value' END),
             'adAccount', max(CASE WHEN x->>'ref' LIKE 'e4b9dbd3%' THEN x->>'value' END),
             'pageName', max(CASE WHEN x->>'ref' LIKE '940f494c%' THEN x->>'value' END),
             'cardFunded', max(CASE WHEN x->>'ref' LIKE '8bee68fc%' THEN x->>'value' END),
             'consultTypes', max(CASE WHEN x->>'ref' LIKE 'c0000001-%' AND x->>'ref' LIKE '%0008' THEN x->>'value' END),
             'templatedStatus', max(CASE WHEN x->>'ref' LIKE 'eb7ed18c%' THEN x->>'value' END),
             'facebookAccess', max(CASE WHEN x->>'ref' LIKE '6fcbd33c%' THEN x->>'value' END))
      INTO v_kickoff
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_kick) = 'array' THEN v_kick ELSE '[]'::jsonb END) x;
    v_out := v_out || jsonb_build_object(
      'kickoff', v_kickoff,
      'cardBudget', CASE WHEN jsonb_typeof(v_handover->'daily_budget') = 'number' THEN v_handover->'daily_budget' END,
      'settings', jsonb_build_object('assignee', v_settings->'assignee',
                                     'pack', v_settings->'packs'->(v_part->>'service')),
      'step4', CASE WHEN v_steps->'steps' ? '4' THEN jsonb_build_object(
                 'taskId', v_steps->'steps'->'4'->>'taskId', 'parentId', v_steps->>'parentId',
                 'name', v_steps->'steps'->'4'->>'name') END);
  ELSIF p_part = 2 THEN
    SELECT jsonb_build_object('startsAt', c.starts_at) INTO v_call FROM public.cockpit_csm_calls c
     WHERE c.task_id = v_task AND c.kind = 'launch' AND c.starts_at > now() AND c.status IN ('booked','confirmed')
     ORDER BY c.starts_at LIMIT 1;
    v_out := v_out || jsonb_build_object(
      'service', a->'service', 'offer', a->'offer',
      'step2', CASE WHEN v_steps->'steps' ? '2' THEN jsonb_build_object(
                 'taskId', v_steps->'steps'->'2'->>'taskId', 'parentId', v_steps->>'parentId',
                 'name', v_steps->'steps'->'2'->>'name') END,
      'launchCall', v_call,
      'closeRoute', v_settings->'closeRoute',
      'mapUrl', 'https://mahara-onboarding-map.vercel.app/?phase=5&cid=' || v_task,
      -- The first CSM's first name; an address is never one.
      'csmFirstName', (SELECT nullif(split_part(btrim(x.v), ' ', 1), '')
                         FROM unnest(string_to_array(coalesce(v_csm, ''), ',')) WITH ORDINALITY x(v, i)
                        WHERE btrim(x.v) <> '' AND x.v NOT LIKE '%@%' ORDER BY x.i LIMIT 1));
  ELSE
    v_out := v_out || jsonb_build_object(
      'dna_status', a->'dna_status',
      'dna_missing', CASE WHEN coalesce(a->>'dna_status', 'complete') <> 'complete' THEN a->'dna_missing' END,
      'step3', CASE WHEN v_steps->'steps' ? '3' THEN jsonb_build_object(
                 'taskId', v_steps->'steps'->'3'->>'taskId', 'parentId', v_steps->>'parentId',
                 'name', v_steps->'steps'->'3'->>'name') END,
      'offerSheet', v_link->'offerSheet');
  END IF;
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------

-- 1. The task ID. 2. An active seat whose confirmed address matches.
-- 3. The creative path: a creative or admin seat, or a founder; the card is
--    the one current row of the creative roster's clients with this task ID,
--    and the seat must hold that client. This path may write.
-- 4. The client-success path, read only: when the creative path refused (or
--    the seat is not creative) and nothing is to be written, the client
--    success gate decides.
-- write is true only on the creative path; rehearse only for admins and the
-- founders.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_gate_for_actor(p_actor uuid, p_task_id text, p_write boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.cockpit_members; founder boolean; admin boolean; v_name text; n integer; ctx jsonb; v_first text;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id = cm.auth_user_id
   WHERE p_actor IS NOT NULL AND cm.auth_user_id = p_actor AND cm.active
     AND u.email_confirmed_at IS NOT NULL AND cm.email = lower(btrim(u.email));
  IF m.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Current confirmed creative or client-success access is required' USING ERRCODE = '42501';
  END IF;
  -- Keyed by p_actor, not auth.uid(), so the list is spelled out here: keep
  -- it the same as public.cockpit_is_ceo()'s (20260923m_cockpit_ceo_gate.sql).
  founder := m.email IN ('aziz@maharamedia.com', 'awaheedi2008@gmail.com');
  admin := 'admin' = ANY(m.roles);
  v_first := public.cockpit_blueprint_first_name(m.email);

  IF 'creative' = ANY(m.roles) OR admin OR founder THEN
    BEGIN
      SELECT count(*), min(r.data->>'name') INTO n, v_name FROM public.cockpit_creative_sources r
       WHERE r.table_name = 'clients' AND r.data->>'taskId' = p_task_id
         AND public.cockpit_creative_source_current(r.table_name, r.source_snapshot_at);
      IF n = 0 OR nullif(btrim(v_name), '') IS NULL THEN
        RAISE EXCEPTION 'This client is not in the creative roster yet. Refresh the creative sync, then open the deck again.'
          USING ERRCODE = 'P0002';
      END IF;
      IF n > 1 THEN
        RAISE EXCEPTION 'This client card is in the creative roster twice. Refresh the creative sync, then open the deck again.'
          USING ERRCODE = 'P0002';
      END IF;
      IF NOT public.cockpit_ask_ai_owner_allowed(p_actor, 'creative', v_name) THEN
        RAISE EXCEPTION 'That client is not on your access list' USING ERRCODE = '42501';
      END IF;
      RETURN jsonb_build_object('actorId', p_actor, 'email', m.email, 'firstName', v_first, 'taskId', p_task_id,
                                'clientName', v_name, 'write', true, 'rehearse', admin OR founder);
    EXCEPTION WHEN OTHERS THEN
      IF p_write OR NOT ('csm' = ANY(m.roles) OR admin OR founder) THEN RAISE; END IF;
    END;
  ELSIF p_write THEN
    RAISE EXCEPTION 'Only the creative director sends the parts.' USING ERRCODE = '42501';
  END IF;

  IF 'csm' = ANY(m.roles) OR admin OR founder THEN
    ctx := public.cockpit_csm_client_gate_for_actor(p_actor, p_task_id);
    RETURN jsonb_build_object('actorId', p_actor, 'email', m.email, 'firstName', v_first, 'taskId', p_task_id,
                              'clientName', ctx->>'clientName', 'write', false, 'rehearse', admin OR founder);
  END IF;
  RAISE EXCEPTION 'Current confirmed creative or client-success access is required' USING ERRCODE = '42501';
END $$;

-- ---------------------------------------------------------------------------
-- For signed-in seats
-- ---------------------------------------------------------------------------

-- The rows of up to 200 cards, each gated for reading; a card the seat may
-- not open is left out, not an error, so a dashboard reads every card it may.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_read(p_task_ids text[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t text; g jsonb; r public.cockpit_blueprints; v_rows jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.cockpit_blueprint_seat();
  IF cardinality(p_task_ids) > 200 THEN
    RAISE EXCEPTION 'Choose at most 200 client cards' USING ERRCODE = '22023';
  END IF;
  FOR t IN SELECT DISTINCT x FROM unnest(coalesce(p_task_ids, '{}')) x WHERE x IS NOT NULL ORDER BY x LOOP
    g := NULL;
    BEGIN
      g := public.cockpit_blueprint_gate_for_actor(auth.uid(), t, false);
    EXCEPTION WHEN OTHERS THEN
      g := NULL;
    END;
    CONTINUE WHEN g IS NULL;
    SELECT * INTO r FROM public.cockpit_blueprints b WHERE b.task_id = t;
    CONTINUE WHEN NOT FOUND;
    v_rows := v_rows || jsonb_build_array(public.cockpit_blueprint_json(r)
                                          || jsonb_build_object('can', jsonb_build_object('write', g->'write')));
  END LOOP;
  RETURN jsonb_build_object('rows', v_rows, 'now', now());
END $$;

-- Everything the Blueprint deck reads, read only (SPEC 2.3). `deck` has the
-- shape of cockpit_csm_deck_sources, so the deck engine's deckData() runs
-- unchanged. Left out on purpose: billing notes, the payment plan, contract
-- fields, the next payment amount, the kickoff's payment, the sales
-- transcript, Meta ads and spend, leads and cost per lead.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_sources(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; v_name text; c jsonb; cc jsonb; v_logo jsonb; v_ghl jsonb; v_editor jsonb; v_dos jsonb;
  v_deckkit jsonb; v_kit jsonb; v_next jsonb; v_last jsonb; v_prep jsonb; v_row public.cockpit_blueprints;
  v_json jsonb; v_notes text[] := '{}'; v_has_kickoff boolean := false;
BEGIN
  g := public.cockpit_blueprint_gate_for_actor(auth.uid(), p_task_id, false);
  v_name := g->>'clientName';

  SELECT s.data INTO c FROM public.cockpit_csm_sources s
   WHERE s.table_name = 'clients' AND s.data->>'taskId' = p_task_id LIMIT 1;
  IF c IS NULL THEN
    v_notes := v_notes || 'This card is not in the client success roster, so its stage and launch date are unknown.'::text;
  END IF;
  SELECT r.data INTO cc FROM public.cockpit_creative_sources r
   WHERE r.table_name = 'clients' AND r.data->>'taskId' = p_task_id
     AND public.cockpit_creative_source_current(r.table_name, r.source_snapshot_at) LIMIT 1;

  SELECT jsonb_build_object('bucket', 'cockpit-client-logos', 'path', l.storage_path, 'verifiedAt', l.verified_at)
    INTO v_logo FROM public.cockpit_client_logos l
   WHERE l.clickup_task_id = p_task_id ORDER BY l.verified_at DESC LIMIT 1;

  SELECT jsonb_build_object(
           'name', nullif(btrim(x.client_name), ''),
           'country', CASE upper(nullif(btrim(x.country), '')) WHEN 'QT' THEN 'QA' ELSE upper(nullif(btrim(x.country), '')) END,
           'city', nullif(btrim(x.city), ''), 'language', lower(nullif(btrim(x.language), '')),
           'serviceMode', upper(nullif(btrim(x.service_mode), '')))
    INTO v_ghl FROM public.ghl_clients x WHERE x.clickup_id = p_task_id LIMIT 1;

  SELECT jsonb_build_object(
           'offer', nullif(btrim(e.offer), ''), 'offerUrl', nullif(btrim(e.offer_url), ''),
           'brandDna', nullif(btrim(e.brand_dna), ''), 'brandDnaUrl', nullif(btrim(e.brand_dna_url), ''),
           'driveUrl', nullif(btrim(e.drive_url), ''), 'website', nullif(btrim(e.website), ''),
           'instagram', nullif(btrim(e.instagram), ''), 'readAt', e.docs_read_at, 'syncedAt', e.synced_at),
         jsonb_build_object('text', nullif(btrim(e.dos_donts), ''), 'source', 'The client card''s Do''s & Don''ts field',
                            'syncedAt', e.synced_at)
    INTO v_editor, v_dos FROM public.editor_clients e WHERE e.task_id = p_task_id;
  IF v_editor IS NULL THEN
    v_notes := v_notes || 'The client card has not been read by the editor desk, so the offer and Do''s & Don''ts are unknown.'::text;
  END IF;

  SELECT jsonb_build_object(
           'onboardingCallOn', o.onboarding_call_on, 'launchOn', o.launch_on, 'signupOn', o.signup_on,
           'links', jsonb_strip_nulls(jsonb_build_object(
             'drive', CASE WHEN jsonb_typeof(o.links->'drive') = 'string' THEN o.links->>'drive' END,
             'driveFolder', CASE WHEN jsonb_typeof(o.links->'drive_folder') = 'string' THEN o.links->>'drive_folder' END,
             'onboardingMap', CASE WHEN jsonb_typeof(o.links->'onboarding_map') = 'string' THEN o.links->>'onboarding_map' END,
             'website', CASE WHEN jsonb_typeof(o.links->'website') = 'string' THEN o.links->>'website' END)),
           'syncedAt', o.synced_at),
         jsonb_build_object(
           'clickup_task_id', o.clickup_task_id, 'client_name', o.client_name, 'client_status', o.client_status,
           -- Names only: the sync writes a username or, without one, an address.
           'csm', nullif(array_to_string(ARRAY(
                    SELECT btrim(x) FROM unnest(string_to_array(coalesce(o.csm, ''), ',')) x
                     WHERE btrim(x) <> '' AND x NOT LIKE '%@%'), ', '), ''),
           -- Only the links the Blueprint opens: never the contract, the sales
           -- call recording or the report sheet (leads and cost per lead).
           'links', (SELECT coalesce(jsonb_object_agg(l.key, l.value), '{}'::jsonb)
                       FROM jsonb_each(CASE WHEN jsonb_typeof(o.links) = 'object' THEN o.links ELSE '{}'::jsonb END) l
                      WHERE l.key IN ('drive','drive_folder','brand_dna','offer_sheet','market_research','website',
                                      'onboarding_map','clickup')
                        AND jsonb_typeof(l.value) = 'string'),
           'handover', (SELECT coalesce(jsonb_object_agg(k, o.handover->k), '{}'::jsonb)
                          FROM unnest(ARRAY['closer','closer_notes','handoff_risks','go_live','client_profile',
                                            'daily_budget','service']) k
                         WHERE jsonb_typeof(o.handover) = 'object' AND o.handover ? k),
           'forms', jsonb_strip_nulls(jsonb_build_object(
             'onboarding', o.forms->'onboarding',
             -- The kickoff without its payment: the top-level key and the
             -- "Payment Amount" question (ref 75e97e7d…) among its answers.
             'kickoff', CASE WHEN jsonb_typeof(o.forms->'kickoff') = 'object' THEN
               ((o.forms->'kickoff') - 'payment') || jsonb_build_object('answers', (
                 SELECT coalesce(jsonb_agg(e.v ORDER BY e.i), '[]'::jsonb)
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.forms->'kickoff'->'answers') = 'array'
                                                  THEN o.forms->'kickoff'->'answers' ELSE '[]'::jsonb END)
                        WITH ORDINALITY e(v, i)
                  WHERE coalesce(e.v->>'ref', '') NOT LIKE '75e97e7d%')) END))),
         jsonb_typeof(o.forms->'kickoff') = 'object'
    INTO v_deckkit, v_kit, v_has_kickoff
    FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
  IF v_kit IS NULL THEN
    v_notes := v_notes || 'No onboarding record carries this card yet, so the onboarding and kickoff answers are unknown.'::text;
  END IF;
  IF v_has_kickoff IS NOT TRUE THEN
    v_notes := v_notes || 'No kickoff on record: ask the service and the budget.'::text;
  END IF;

  SELECT coalesce(jsonb_object_agg(x.kind, jsonb_build_object('startsAt', x.starts_at, 'endsAt', x.ends_at, 'status', x.status)), '{}'::jsonb)
    INTO v_next
    FROM (SELECT DISTINCT ON (k.kind) k.kind, k.starts_at, k.ends_at, k.status FROM public.cockpit_csm_calls k
           WHERE k.task_id = p_task_id AND k.kind <> 'other' AND k.starts_at > now() AND k.status IN ('booked','confirmed')
           ORDER BY k.kind, k.starts_at) x;
  SELECT coalesce(jsonb_object_agg(x.kind, jsonb_build_object('startsAt', x.starts_at, 'endsAt', x.ends_at, 'status', x.status)), '{}'::jsonb)
    INTO v_last
    FROM (SELECT DISTINCT ON (k.kind) k.kind, k.starts_at, k.ends_at, k.status FROM public.cockpit_csm_calls k
           WHERE k.task_id = p_task_id AND k.kind <> 'other' AND k.starts_at <= now()
             AND k.status IN ('held','showed','confirmed','booked')
           ORDER BY k.kind, k.starts_at DESC) x;

  -- The onboarding deck's prep, only the keys the Blueprint prefills from.
  SELECT jsonb_build_object(
           'deck', 'onboarding',
           'overrides', (SELECT coalesce(jsonb_object_agg(k, p.overrides->k), '{}'::jsonb)
                           FROM unnest(ARRAY['goals','red_lines','red_lines_ar','services','services_ar','service_focus',
                                             'service_focus_ar','service_chosen_at','starter_pack','dialect','language',
                                             'service_model']) k
                          WHERE p.overrides ? k),
           'revision', p.revision, 'updatedAt', p.updated_at,
           'updatedBy', public.cockpit_blueprint_first_name(p.updated_by))
    INTO v_prep FROM public.cockpit_csm_deck_prep p WHERE p.task_id = p_task_id AND p.deck = 'onboarding';

  SELECT * INTO v_row FROM public.cockpit_blueprints b WHERE b.task_id = p_task_id;
  v_json := public.cockpit_blueprint_json(v_row);

  RETURN jsonb_build_object(
    'taskId', p_task_id, 'clientName', v_name, 'at', now(),
    'can', jsonb_build_object('write', g->'write', 'rehearse', g->'rehearse'),
    'presenter', jsonb_build_object('firstName', g->>'firstName'),
    'deck', jsonb_build_object(
      'taskId', p_task_id, 'clientName', v_name, 'at', now(),
      'presenter', jsonb_build_object('firstName', g->>'firstName'),
      'client', CASE WHEN c IS NULL THEN NULL ELSE jsonb_build_object(
        'stage', c->>'stage', 'service', nullif(btrim(c->>'service'), ''), 'launchDate', c->'launchDate',
        'bucket', c->>'bucket') END,
      'logo', v_logo, 'ghl', v_ghl, 'editor', v_editor, 'dosDonts', v_dos, 'kit', v_deckkit,
      'calls', jsonb_build_object('next', v_next, 'last', v_last),
      'prep', jsonb_build_object('onboarding', v_prep),
      'launchAds', '[]'::jsonb, 'notes', to_jsonb(v_notes)),
    'kit', v_kit,
    'card', CASE WHEN cc IS NULL THEN NULL ELSE jsonb_build_object(
      'templatedAds', cc->>'templatedAdsStatus', 'canSelfRecord', cc->>'canSelfRecord',
      'adApproval', cc->>'adApprovalNeeded', 'offerCreation', cc->>'offerCreationStatus') END,
    'creativeOnboarding', public.cockpit_blueprint_steps(v_name),
    'settings', public.cockpit_blueprint_settings_json() - 'changes',
    'blueprint', v_json,
    'outbox', coalesce(v_json->'outbox', jsonb_build_object('1', NULL, '2', NULL, '3', NULL)));
END $$;

-- Autosave per field, with conflict detection (SPEC 2.4).
-- p_changes is {key: {value, seen, from?}}: seen is the value this browser
-- last had confirmed for the key (null when it never had one), from the
-- prefill's source when the creative director confirmed a suggestion.
-- p_session is one ID per browser profile (the deck and notes windows of one
-- call share it). With p_base_revision equal to the row's, every change
-- applies. Otherwise a key is a conflict, and is left as stored, when another
-- session saved it last, and what is stored is neither what this browser saw
-- nor the new value. Nothing typed is lost: the conflict comes back with the
-- stored value, so the browser can show both.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_save(p_task_id text, p_changes jsonb, p_session text, p_base_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; r public.cockpit_blueprints; k text; ch jsonb; v jsonb; seen jsonb; stored jsonb; smeta jsonb;
  v_answers jsonb; v_meta jsonb; v_from text; v_fresh boolean := false; v_changed boolean := false;
  v_applied text[] := '{}'; v_conflicts jsonb := '[]'::jsonb;
BEGIN
  g := public.cockpit_blueprint_gate_for_actor(auth.uid(), p_task_id, true);
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
    RAISE EXCEPTION 'That is not a revision of this Blueprint' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_blueprints:' || p_task_id, 0));
  SELECT * INTO r FROM public.cockpit_blueprints b WHERE b.task_id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    v_fresh := true; v_answers := '{}'::jsonb; v_meta := '{}'::jsonb;
  ELSE
    v_answers := r.answers; v_meta := r.answer_meta;
  END IF;

  FOR k, ch IN SELECT e.key, e.value FROM jsonb_each(p_changes) e ORDER BY e.key LOOP
    IF k = 'shot_list_due' THEN
      RAISE EXCEPTION 'The shot list''s due date is set by the server' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(ch) IS DISTINCT FROM 'object' OR NOT ch ? 'value'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(ch) x WHERE x NOT IN ('value','seen','from')) THEN
      RAISE EXCEPTION 'Each change carries its value, what this window saw, and where a suggestion came from'
        USING ERRCODE = '22023';
    END IF;
    v := public.cockpit_blueprint_value(k, ch->'value');
    v_from := CASE WHEN jsonb_typeof(ch->'from') = 'string' THEN ch->>'from' END;
    IF v_from IS NOT NULL AND v_from !~ '^[a-z][a-z0-9_.-]{0,39}$' THEN
      RAISE EXCEPTION 'That is not a prefill source' USING ERRCODE = '22023';
    END IF;
    stored := v_answers->k;
    seen := CASE WHEN jsonb_typeof(ch->'seen') IS DISTINCT FROM 'null' THEN ch->'seen' END;
    smeta := v_meta->k;
    IF NOT v_fresh AND p_base_revision IS DISTINCT FROM r.revision
       AND (smeta->>'session') IS DISTINCT FROM p_session
       AND stored IS DISTINCT FROM seen AND stored IS DISTINCT FROM v THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'key', k, 'theirs', stored, 'by', public.cockpit_blueprint_first_name(smeta->>'by'), 'at', smeta->'at'));
      CONTINUE;
    END IF;
    v_applied := v_applied || k;
    CONTINUE WHEN stored IS NOT DISTINCT FROM v;
    v_changed := true;
    IF v IS NULL THEN
      v_answers := v_answers - k; v_meta := v_meta - k;
    ELSE
      v_answers := jsonb_set(v_answers, ARRAY[k], v);
      v_meta := jsonb_set(v_meta, ARRAY[k], jsonb_strip_nulls(jsonb_build_object(
        'by', g->>'email', 'at', now(), 'session', p_session, 'from', v_from)));
    END IF;
    -- The shot list turns its due date on and off with it.
    IF k = 'shot_list' THEN
      IF v = 'true'::jsonb THEN
        v_answers := jsonb_set(v_answers, '{shot_list_due}', to_jsonb(public.cockpit_blueprint_shot_due(p_task_id)));
        v_meta := jsonb_set(v_meta, '{shot_list_due}', jsonb_build_object(
          'by', g->>'email', 'at', now(), 'session', p_session, 'from', 'server'));
      ELSE
        v_answers := v_answers - 'shot_list_due'; v_meta := v_meta - 'shot_list_due';
      END IF;
    END IF;
  END LOOP;

  IF v_changed THEN
    IF octet_length(v_answers::text) > 65536 THEN
      RAISE EXCEPTION 'The Blueprint is too long to save. Shorten the longest answers.' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('cockpit.blueprint_action', 'blueprint.save', true);
    IF v_fresh THEN
      INSERT INTO public.cockpit_blueprints(task_id, client_name, answers, answer_meta, updated_by)
      VALUES (p_task_id, g->>'clientName', v_answers, v_meta, g->>'email')
      RETURNING * INTO r;
    ELSE
      UPDATE public.cockpit_blueprints b
         SET answers = v_answers, answer_meta = v_meta, revision = b.revision + 1, client_name = g->>'clientName',
             updated_at = now(), updated_by = g->>'email'
       WHERE b.task_id = p_task_id
      RETURNING * INTO r;
    END IF;
  END IF;
  RETURN jsonb_build_object('row', public.cockpit_blueprint_json(r), 'applied', to_jsonb(v_applied),
                            'conflicts', v_conflicts);
END $$;

-- A press (SPEC 2.5): checks, one outbox row, the part's stamp and one
-- 'blueprint.part_done' audit row. The same request ID again returns its
-- first row; an unchanged second press returns the latest live one.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_part_done(p_task_id text, p_part integer, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; r public.cockpit_blueprints; v_kind text; q public.cockpit_creative_outbox; v_missing text[];
  v_sent jsonb; v_old jsonb; v_stamp jsonb; v_presses integer; v_payload jsonb;
BEGIN
  g := public.cockpit_blueprint_gate_for_actor(auth.uid(), p_task_id, true);
  IF p_part IS NULL OR p_part NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'Choose part 1, 2 or 3' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request ID is required' USING ERRCODE = '22023';
  END IF;
  v_kind := CASE p_part WHEN 1 THEN 'blueprintLaunch' WHEN 2 THEN 'blueprintClose' ELSE 'blueprintOffer' END;

  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_blueprints:' || p_task_id, 0));
  SELECT * INTO r FROM public.cockpit_blueprints b WHERE b.task_id = p_task_id FOR UPDATE;
  v_old := r.parts->(p_part::text);

  -- The same request again (a retry after a dropped connection).
  SELECT * INTO q FROM public.cockpit_creative_outbox o WHERE o.id = p_request_id;
  IF FOUND THEN
    IF q.kind IS DISTINCT FROM v_kind OR q.task_id IS DISTINCT FROM p_task_id
       OR q.client_name IS DISTINCT FROM g->>'clientName' OR q.actor_id IS DISTINCT FROM (g->>'actorId')::uuid THEN
      RAISE EXCEPTION 'This request does not match its first send' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('id', q.id, 'state', q.state, 'part', p_part, 'firstAt', v_old->'firstAt',
                              'presses', coalesce((v_old->>'presses')::integer, 0), 'again', true);
  END IF;

  IF p_part = 2 AND NOT (coalesce(r.parts, '{}'::jsonb) ? '1') THEN
    RAISE EXCEPTION 'Send part 1 to media first.' USING ERRCODE = '22023';
  END IF;
  IF p_part = 3 AND NOT (coalesce(r.parts, '{}'::jsonb) ? '2') THEN
    RAISE EXCEPTION 'Close the call first.' USING ERRCODE = '22023';
  END IF;
  v_missing := public.cockpit_blueprint_missing(p_part, coalesce(r.answers, '{}'::jsonb));
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'Still missing' USING ERRCODE = '22023', DETAIL = array_to_string(v_missing, ',');
  END IF;
  v_sent := public.cockpit_blueprint_part_answers(p_part, r.answers);

  -- Nothing changed since the last press, and that press is live or done.
  IF v_old IS NOT NULL AND v_old->'sent' = v_sent THEN
    SELECT * INTO q FROM public.cockpit_creative_outbox o
     WHERE o.task_id = p_task_id AND o.kind = v_kind ORDER BY o.created_at DESC, o.id LIMIT 1;
    IF FOUND AND q.state IN ('pending','sending','done') THEN
      RETURN jsonb_build_object('id', q.id, 'state', q.state, 'part', p_part, 'firstAt', v_old->'firstAt',
                                'presses', coalesce((v_old->>'presses')::integer, 0), 'duplicate', true,
                                'lastAt', v_old->'lastAt');
    END IF;
  END IF;

  -- An earlier send of this part still running: its run may not have made
  -- (or tagged) the launch task yet, so a second run now could make another.
  -- A run claimed over 10 minutes ago that never settled does not block the
  -- part for ever.
  IF EXISTS (SELECT 1 FROM public.cockpit_creative_outbox o
               LEFT JOIN public.cockpit_media_actions a ON a.id = o.id
              WHERE o.task_id = p_task_id AND o.kind = v_kind AND o.state = 'sending'
                AND coalesce(a.created_at, o.created_at) > now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'The last send of this part is still running. Wait for it to finish, then send the changes.'
      USING ERRCODE = '55P03';
  END IF;

  v_payload := public.cockpit_blueprint_payload(g, p_part, r.answers, to_jsonb(r));
  -- An earlier press of this part that never started is superseded, so a
  -- stale window cannot run it after this one.
  UPDATE public.cockpit_creative_outbox o
     SET state = 'failed', error = 'Superseded by a later press of the same part', settled_at = now()
   WHERE o.task_id = p_task_id AND o.kind = v_kind AND o.state = 'pending';
  INSERT INTO public.cockpit_creative_outbox(id, client_name, kind, task_id, payload, actor_id, actor_email)
  VALUES (p_request_id, g->>'clientName', v_kind, p_task_id, v_payload, (g->>'actorId')::uuid, g->>'email');

  v_presses := coalesce((v_old->>'presses')::integer, 0) + 1;
  v_stamp := jsonb_build_object(
    'status', 'done',
    'firstAt', coalesce(v_old->'firstAt', to_jsonb(now())), 'firstBy', coalesce(v_old->'firstBy', to_jsonb(g->>'email')),
    'lastAt', now(), 'lastBy', g->>'email', 'presses', v_presses, 'lastRequestId', p_request_id, 'sent', v_sent);
  PERFORM set_config('cockpit.blueprint_action', 'blueprint.part', true);
  UPDATE public.cockpit_blueprints b
     SET parts = jsonb_set(b.parts, ARRAY[p_part::text], v_stamp), client_name = g->>'clientName',
         updated_at = now(), updated_by = g->>'email'
   WHERE b.task_id = p_task_id;

  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system,
                                       before, after, metadata)
  VALUES ('blueprint.part_done', 'cockpit_blueprints', p_task_id, g->>'email', 'creative', 'supabase', NULL, NULL,
          jsonb_build_object('part', p_part, 'client_name', g->>'clientName', 'request_id', p_request_id,
                             'second', v_presses > 1));
  RETURN jsonb_build_object('id', p_request_id, 'state', 'pending', 'part', p_part, 'firstAt', v_stamp->'firstAt',
                            'presses', v_presses);
END $$;

-- Rehearsal (SPEC 3.7): admins and the founders only. Validates answers held
-- in the browser's memory with the same checks and returns what a press
-- would queue. Writes nothing.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_rehearse_payload(p_task_id text, p_part integer, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; r public.cockpit_blueprints; v_clean jsonb := '{}'::jsonb; k text; v jsonb;
BEGIN
  g := public.cockpit_blueprint_gate_for_actor(auth.uid(), p_task_id, false);
  IF (g->>'rehearse')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Only an admin or the CEO rehearses the Brand Blueprint' USING ERRCODE = '42501';
  END IF;
  IF p_part IS NULL OR p_part NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'Choose part 1, 2 or 3' USING ERRCODE = '22023';
  END IF;
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' OR octet_length(p_answers::text) > 65536 THEN
    RAISE EXCEPTION 'The rehearsal''s answers are not a Blueprint' USING ERRCODE = '22023';
  END IF;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(p_answers) e LOOP
    CONTINUE WHEN k = 'shot_list_due';
    v := public.cockpit_blueprint_value(k, v);
    IF v IS NOT NULL THEN v_clean := v_clean || jsonb_build_object(k, v); END IF;
  END LOOP;
  IF v_clean->'shot_list' = 'true'::jsonb THEN
    v_clean := v_clean || jsonb_build_object('shot_list_due', public.cockpit_blueprint_shot_due(p_task_id));
  END IF;
  SELECT * INTO r FROM public.cockpit_blueprints b WHERE b.task_id = p_task_id;
  RETURN jsonb_build_object(
    'kind', CASE p_part WHEN 1 THEN 'blueprintLaunch' WHEN 2 THEN 'blueprintClose' ELSE 'blueprintOffer' END,
    'taskId', p_task_id, 'clientName', g->>'clientName',
    'missing', to_jsonb(public.cockpit_blueprint_missing(p_part, v_clean)),
    'payload', public.cockpit_blueprint_payload(g, p_part, v_clean, CASE WHEN r.task_id IS NULL THEN NULL ELSE to_jsonb(r) END));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_blueprint_settings_read() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb;
BEGIN
  s := public.cockpit_blueprint_seat();
  RETURN public.cockpit_blueprint_settings_json() || jsonb_build_object('can', jsonb_build_object(
    'packs', (s->>'creative')::boolean OR (s->>'admin')::boolean OR (s->>'founder')::boolean,
    'closeRoute', (s->>'admin')::boolean OR (s->>'founder')::boolean));
END $$;

-- Validates and upserts one setting; a blank value removes it (never
-- close_route). Starter packs and the launch media buyer: creative seats,
-- admins and the founders; close_route: admins and the founders only.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_settings_set(p_key text, p_value text, p_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s jsonb; v text := nullif(btrim(coalesce(p_value, '')), ''); l text := nullif(btrim(coalesce(p_label, '')), '');
  v_old public.cockpit_blueprint_settings; boss boolean;
BEGIN
  s := public.cockpit_blueprint_seat();
  boss := (s->>'admin')::boolean OR (s->>'founder')::boolean;
  IF NOT ((s->>'creative')::boolean OR boss) THEN
    RAISE EXCEPTION 'Only the creative team changes the Brand Blueprint settings' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key !~ '^(pack\.(design-build|interior|architecture|fitout|construction)|launch_assignee|close_route)$' THEN
    RAISE EXCEPTION 'The Brand Blueprint has no setting called %', coalesce(left(p_key, 40), '(none)') USING ERRCODE = '22023';
  END IF;
  IF p_key = 'close_route' AND NOT boss THEN
    RAISE EXCEPTION 'Only an admin or the CEO changes what happens after Close the call' USING ERRCODE = '42501';
  END IF;
  IF l IS NOT NULL AND char_length(l) > 120 THEN
    RAISE EXCEPTION 'A setting''s label is at most 120 characters' USING ERRCODE = '22023';
  END IF;

  IF v IS NULL THEN
    IF p_key = 'close_route' THEN
      RAISE EXCEPTION 'Choose card_only, slack or make' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cockpit_blueprint_settings x WHERE x.key = p_key) THEN
      PERFORM set_config('cockpit.blueprint_action', 'blueprint.setting', true);
      DELETE FROM public.cockpit_blueprint_settings x WHERE x.key = p_key;
    END IF;
    RETURN public.cockpit_blueprint_settings_read();
  END IF;

  IF p_key LIKE 'pack.%' THEN
    IF v !~ '^https://drive\.google\.com/drive/(u/[0-9]/)?folders/[A-Za-z0-9_-]{10,100}(\?[A-Za-z0-9=&_.-]{0,100})?$' THEN
      RAISE EXCEPTION 'Paste the starter pack''s Google Drive folder link' USING ERRCODE = '22023';
    END IF;
  ELSIF p_key = 'launch_assignee' THEN
    IF v !~ '^[0-9]{3,12}$' THEN
      RAISE EXCEPTION 'Choose the launch media buyer from the list' USING ERRCODE = '22023';
    END IF;
    IF l IS NULL THEN
      RAISE EXCEPTION 'The launch media buyer needs the name the list showed' USING ERRCODE = '22023';
    END IF;
  ELSIF v NOT IN ('card_only','slack','make') THEN
    RAISE EXCEPTION 'Choose card_only, slack or make' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.cockpit_blueprint_settings x WHERE x.key = p_key;
  IF FOUND AND v_old.value = v AND v_old.label IS NOT DISTINCT FROM l THEN
    RETURN public.cockpit_blueprint_settings_read();
  END IF;
  PERFORM set_config('cockpit.blueprint_action', 'blueprint.setting', true);
  INSERT INTO public.cockpit_blueprint_settings(key, value, label, updated_by)
  VALUES (p_key, v, l, s->>'email')
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, label = excluded.label, updated_at = now(),
                                  updated_by = excluded.updated_by;
  RETURN public.cockpit_blueprint_settings_read();
END $$;

-- ---------------------------------------------------------------------------
-- For the server only
-- ---------------------------------------------------------------------------

-- After a Send to media run, cockpit-creative-api names the launch task the
-- run wrote to (created or commented), so the next press goes there first.
-- Only a finished blueprintLaunch row whose result names that task may set it.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_outbox_settled(p_request_id uuid, p_launch_task_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q public.cockpit_creative_outbox;
BEGIN
  IF p_launch_task_id IS NULL OR p_launch_task_id !~ '^[A-Za-z0-9]{4,20}$' THEN
    RAISE EXCEPTION 'That is not a ClickUp task ID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO q FROM public.cockpit_creative_outbox o WHERE o.id = p_request_id;
  IF NOT FOUND OR q.kind <> 'blueprintLaunch' OR q.state <> 'done' THEN
    RAISE EXCEPTION 'Only a finished Send to media run names the launch task' USING ERRCODE = '22023';
  END IF;
  IF (q.result->>'launchTaskId') IS DISTINCT FROM p_launch_task_id THEN
    RAISE EXCEPTION 'That is not the launch task this run wrote to' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.blueprint_action', 'blueprint.launch_task', true);
  UPDATE public.cockpit_blueprints b
     SET launch_task_id = p_launch_task_id, updated_at = now(), updated_by = 'cockpit-creative-api'
   WHERE b.task_id = q.task_id AND b.launch_task_id IS DISTINCT FROM p_launch_task_id;
END $$;

-- ---------------------------------------------------------------------------
-- Grants. Supabase's default grants go first, on every function here.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  public.cockpit_blueprint_audit(),
  public.cockpit_blueprint_first_name(text),
  public.cockpit_blueprint_seat(),
  public.cockpit_blueprint_lines(jsonb, text),
  public.cockpit_blueprint_value(text, jsonb),
  public.cockpit_blueprint_part_answers(integer, jsonb),
  public.cockpit_blueprint_missing(integer, jsonb),
  public.cockpit_blueprint_shot_due(text),
  public.cockpit_blueprint_settings_json(),
  public.cockpit_blueprint_steps(text),
  public.cockpit_blueprint_json(public.cockpit_blueprints),
  public.cockpit_blueprint_payload(jsonb, integer, jsonb, jsonb),
  public.cockpit_blueprint_gate_for_actor(uuid, text, boolean),
  public.cockpit_blueprint_read(text[]),
  public.cockpit_blueprint_sources(text),
  public.cockpit_blueprint_save(text, jsonb, text, integer),
  public.cockpit_blueprint_part_done(text, integer, uuid),
  public.cockpit_blueprint_rehearse_payload(text, integer, jsonb),
  public.cockpit_blueprint_settings_read(),
  public.cockpit_blueprint_settings_set(text, text, text),
  public.cockpit_blueprint_outbox_settled(uuid, text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.cockpit_blueprint_read(text[]),
  public.cockpit_blueprint_sources(text),
  public.cockpit_blueprint_save(text, jsonb, text, integer),
  public.cockpit_blueprint_part_done(text, integer, uuid),
  public.cockpit_blueprint_rehearse_payload(text, integer, jsonb),
  public.cockpit_blueprint_settings_read(),
  public.cockpit_blueprint_settings_set(text, text, text)
TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.cockpit_blueprint_gate_for_actor(uuid, text, boolean),
  public.cockpit_blueprint_outbox_settled(uuid, text)
TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
