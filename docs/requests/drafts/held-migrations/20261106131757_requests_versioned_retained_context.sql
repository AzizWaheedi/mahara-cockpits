-- HELD DRAFT: CLI-generated migration, not in the active migrations directory.
-- Do not deploy until independent review, exact-head tests and rollout approval.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.cockpit_request_types, public.cockpit_request_type_versions,
  public.cockpit_requests, public.cockpit_clickup_writeback_queue, public.cockpit_settings IN ACCESS EXCLUSIVE MODE;
DO $guard$
DECLARE x record; f oid; v_hash text; v_acl text; v_rls boolean;
BEGIN
  FOR x IN SELECT * FROM (VALUES
    ('cockpit_kickoff_item_raise(text,text,uuid)','f5966507cbb80908bed6d3ae695a7617','v','{postgres=X/postgres,authenticated=X/postgres}'),
    ('cockpit_request_plan(public.cockpit_request_types,uuid,text,text,jsonb,date,text,text,text)','96677a21b5d8fd7478b419d244c8b2b3','s','{postgres=X/postgres}'),
    ('cockpit_request_preview(text,text,jsonb)','5d78ad5db4d2da7592b73b9760c39a4b','s','{postgres=X/postgres,authenticated=X/postgres}'),
    ('cockpit_request_submit(uuid,text,text,jsonb,date,text,text,text)','8218732912d8f49246ef1ada95e7faff','v','{postgres=X/postgres,authenticated=X/postgres}'),
    ('cockpit_request_sweep()','d85d7c18e9f37b81716cd7d39543a597','v','{postgres=X/postgres,service_role=X/postgres}'),
    ('cockpit_request_type_at(text,integer)','75d2046f61ee92381bd14baf62b5bfba','s','{postgres=X/postgres}'),
    ('cockpit_request_type_guard()','ca5f462d0225e16d57c04235c5c52468','v','{postgres=X/postgres}'),
    ('cockpit_request_type_restore(text,integer,integer)','28ab8cbc0ac1bdba0e07628c4f5a1a4f','v','{postgres=X/postgres,authenticated=X/postgres}'),
    ('cockpit_request_type_rt_off(text,text)','480dcb4d2fff277b2d448736e407c6bb','v','{postgres=X/postgres,service_role=X/postgres}'),
    ('cockpit_request_type_save(text,jsonb,integer)','2c16614baae44953afa41316d9c69e15','v','{postgres=X/postgres,authenticated=X/postgres}'),
    ('cockpit_request_type_view(public.cockpit_request_types,boolean)','154fd47466dd9fa59eb6c57842c24906','s','{postgres=X/postgres}')
  ) AS expected(signature, defhash, volatility, grants) LOOP
    f := to_regprocedure('public.' || x.signature);
    IF f IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=f AND md5(pg_get_functiondef(p.oid))=x.defhash
        AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile::text=x.volatility
        AND p.proconfig = ARRAY['search_path=""']::text[] AND p.proacl::text=x.grants) THEN
      RAISE EXCEPTION 'Preflight function drift: %', x.signature USING ERRCODE='55000';
    END IF;
  END LOOP;
  FOR x IN SELECT * FROM (VALUES
    ('cockpit_clickup_writeback_queue','f2576b30180547a5c3786932d10cb881','{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'),
    ('cockpit_request_type_versions','eae32db36306ad70243e1e7cf1e16e0a','{postgres=arwdDxtm/postgres,service_role=r/postgres}'),
    ('cockpit_request_types','902a0d6f7b913ea51d033c814eeb0c0a','{postgres=arwdDxtm/postgres,service_role=r/postgres}'),
    ('cockpit_requests','d01897dba555ef42fe5d2e60bfa6d822','{postgres=arwdDxtm/postgres,service_role=r/postgres}'),
    ('cockpit_settings','4e69092e8626b465e85d953c2d20395c','{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}')
  ) AS expected(name, column_hash, grants) LOOP
    SELECT md5(coalesce(string_agg(a.attname || ':' || format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum),'')), c.relacl::text, c.relrowsecurity
      INTO v_hash,v_acl,v_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      WHERE n.nspname='public' AND c.relname=x.name GROUP BY c.oid;
    IF v_hash IS DISTINCT FROM x.column_hash OR v_acl IS DISTINCT FROM x.grants OR v_rls IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Preflight table drift: %', x.name USING ERRCODE='55000';
    END IF;
  END LOOP;
  FOR x IN SELECT * FROM (VALUES
    ('cockpit_request_type_versions','cockpit_request_type_versions_no_delete','b801c312040907c5bb04ab4f5bfae886'),
    ('cockpit_request_type_versions','cockpit_request_type_versions_no_truncate','5790b8a4d9209f099faac0e718d3e3fa'),
    ('cockpit_request_types','cockpit_request_types_guard','e06aedf29d9a044b2310a50c84540778'),
    ('cockpit_request_types','cockpit_request_types_no_delete','747f05b01304a5c2933f0400c6eb9f06'),
    ('cockpit_request_types','cockpit_request_types_no_truncate','411a2544fa027214751c9eedcc9e0b92')
  ) AS expected(table_name, trigger_name, defhash) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.' || x.table_name)
      AND t.tgname=x.trigger_name AND NOT t.tgisinternal AND t.tgenabled='O' AND md5(pg_get_triggerdef(t.oid))=x.defhash) THEN
      RAISE EXCEPTION 'Preflight trigger drift: %', x.trigger_name USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.cockpit_settings WHERE key='requests.retained_context_v1_ready') THEN
    RAISE EXCEPTION 'Preflight readiness setting must be absent.' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_requests r LEFT JOIN public.cockpit_request_type_versions v ON v.key=r.type_key AND v.version=r.type_version WHERE v.key IS NULL)
     OR EXISTS (SELECT 1 FROM public.cockpit_request_type_versions v JOIN public.cockpit_request_types t ON t.key=v.key WHERE v.version>t.version) THEN
    RAISE EXCEPTION 'Preflight request type snapshots need reconciliation.' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_request_type_versions v
    WHERE jsonb_typeof(v."row") IS DISTINCT FROM 'object'
       OR v."row"->>'key' IS DISTINCT FROM v.key
       OR v."row"->>'version' IS DISTINCT FROM v.version::text
       OR v."row" ?| ARRAY['retained_context_policy','retained_context_ever_enabled','legacy_snapshot_cutoff']) THEN
    RAISE EXCEPTION 'Preflight request type snapshot content needs reconciliation.' USING ERRCODE='55000';
  END IF;
  IF to_regprocedure('public.cockpit_request_v1_ready_locked()') IS NOT NULL
     OR to_regprocedure('public.cockpit_request_preview_v1(text,text,jsonb,integer)') IS NOT NULL
     OR to_regprocedure('public.cockpit_request_submit_v1(uuid,text,text,jsonb,date,text,text,text,integer)') IS NOT NULL
     OR to_regprocedure('public.cockpit_request_submit_impl(uuid,text,text,jsonb,date,text,text,text,text,integer)') IS NOT NULL
     OR to_regprocedure('public.cockpit_request_preview_impl(text,text,jsonb,text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight v1 functions already exist.' USING ERRCODE='55000';
  END IF;
END $guard$;

ALTER TABLE public.cockpit_request_types ADD COLUMN retained_context_policy text NOT NULL DEFAULT 'legacy' CHECK (retained_context_policy IN ('legacy','retained_v1')), ADD COLUMN retained_context_ever_enabled boolean NOT NULL DEFAULT false, ADD COLUMN legacy_snapshot_cutoff integer NOT NULL DEFAULT 0 CHECK (legacy_snapshot_cutoff >= 0);
UPDATE public.cockpit_request_types SET legacy_snapshot_cutoff=version;

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
  v_first boolean := true; v_head text; v_old_words text;
BEGIN
  SELECT public.cockpit_request_answer_display(f, v_answers->(f->>'key')) INTO v_details
    FROM jsonb_array_elements(p_type.fields) f WHERE f->>'kind' = 'details' LIMIT 1;
  IF p_replaces IS NOT NULL AND (
       (p_type.retained_context_policy = 'retained_v1' AND p_type.key IN ('card_missing', 'whatsapp_connection')) OR
       NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_type.fields) f WHERE f->>'kind' = 'details')
     ) THEN
    SELECT nullif(btrim(i.answers->>'details'), '') INTO v_old_words FROM public.cockpit_requests i
     WHERE i.imported_task_id = p_replaces AND i.source = 'import';
  END IF;
  -- For the two kickoff types the original is explicitly retained and new
  -- details are separate. If the two texts are identical, print them once.
  IF p_type.retained_context_policy = 'retained_v1' AND p_type.key IN ('card_missing', 'whatsapp_connection') AND v_old_words IS NOT NULL AND v_details = v_old_words THEN
    v_details := NULL;
  END IF;
  SELECT string_agg('- ' || (f->>'label') || ': ' || public.cockpit_request_answer_display(f, v_answers->(f->>'key')), E'\n' ORDER BY n)
    INTO v_bullets FROM jsonb_array_elements(p_type.fields) WITH ORDINALITY AS x(f, n)
   WHERE f->>'kind' NOT IN ('client','details','deadline','priority') AND public.cockpit_request_answered(v_answers->(f->>'key'));
  SELECT coalesce(jsonb_agg(jsonb_build_object('fieldId', f->>'clickup_field_id', 'kind', f->>'kind',
           'value', public.cockpit_request_answer_value(f, v_answers->(f->>'key')), 'label', f->>'label',
           'display', public.cockpit_request_answer_display(f, v_answers->(f->>'key'))) ORDER BY n), '[]'::jsonb)
    INTO v_fields FROM jsonb_array_elements(p_type.fields) WITH ORDINALITY AS x(f, n)
   WHERE f->>'clickup_field_id' IS NOT NULL AND public.cockpit_request_answered(v_answers->(f->>'key'))
     -- Never Request Type or the two fields the cockpit never writes, even from an
     -- old type version (R8, CT F3): their answer stays in the description only.
     AND NOT public.cockpit_request_never_written(f->>'clickup_field_id');
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
    IF p_replaces IS NOT NULL THEN
      v_tail := v_tail || ('Routed from the old ClickUp form ticket: https://app.clickup.com/t/' || p_replaces);
    END IF;
    IF v_url IS NOT NULL THEN v_tail := v_tail || ('Request in the cockpit: ' || v_url); END IF;
    v_desc := array_to_string(ARRAY[v_head,
                CASE WHEN p_type.retained_context_policy = 'retained_v1' AND v_old_words IS NOT NULL AND p_type.key IN ('card_missing', 'whatsapp_connection') AND v_details IS NOT NULL
                     THEN 'Additional details:' || E'\n' || v_details ELSE v_details END,
                CASE WHEN v_old_words IS NOT NULL THEN 'Asked on the old ClickUp form:' || E'\n' || v_old_words END,
                v_bullets, nullif(array_to_string(v_tail, E'\n'), '')], E'\n\n');
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

CREATE OR REPLACE FUNCTION public.cockpit_request_type_at(p_key text, p_version integer)
RETURNS public.cockpit_request_types LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.cockpit_request_types; v_row jsonb;
BEGIN
  SELECT v."row" INTO v_row FROM public.cockpit_request_type_versions v WHERE v.key = p_key AND v.version = p_version;
  IF v_row IS NOT NULL THEN
    IF NOT (v_row ? 'retained_context_policy') AND p_key IN ('card_missing','whatsapp_connection') AND p_version > coalesce((SELECT legacy_snapshot_cutoff FROM public.cockpit_request_types WHERE key=p_key),0) THEN
      RAISE EXCEPTION 'The saved request policy is missing. Review before replay.' USING ERRCODE = '55000';
    END IF;
    IF v_row ? 'retained_context_policy' AND (jsonb_typeof(v_row->'retained_context_policy') IS DISTINCT FROM 'string' OR v_row->>'retained_context_policy' NOT IN ('legacy','retained_v1')) THEN
      RAISE EXCEPTION 'The saved request policy is invalid. Review before replay.' USING ERRCODE = '55000';
    END IF;
    t := jsonb_populate_record(NULL::public.cockpit_request_types, v_row);
  ELSE
    SELECT * INTO t FROM public.cockpit_request_types WHERE key = p_key;
    IF p_key IN ('card_missing','whatsapp_connection') AND (coalesce(t.retained_context_ever_enabled,false) OR t.retained_context_policy='retained_v1' OR EXISTS (SELECT 1 FROM public.cockpit_request_type_versions v WHERE v.key = p_key AND v."row" ? 'retained_context_policy' AND (jsonb_typeof(v."row"->'retained_context_policy') IS DISTINCT FROM 'string' OR v."row"->>'retained_context_policy' IS DISTINCT FROM 'legacy'))) THEN
      RAISE EXCEPTION 'The saved request type version is missing. Review before replay.' USING ERRCODE = '55000';
    END IF;
    t.retained_context_policy := 'legacy';
  END IF;
  t.retained_context_policy := coalesce(t.retained_context_policy, 'legacy');
  RETURN t;
END $$;

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
  IF t.retained_context_policy = 'retained_v1' AND t.key IN ('card_missing','whatsapp_connection') THEN
    v := v || jsonb_build_object('retainedContextPolicy', 'retained_v1', 'typeVersion', t.version);
  END IF;
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

CREATE OR REPLACE FUNCTION public.cockpit_request_v1_ready_locked() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb;
BEGIN
  SELECT value INTO v FROM public.cockpit_settings WHERE key='requests.retained_context_v1_ready' FOR SHARE;
  RETURN coalesce(v = '{"ready":true}'::jsonb,false);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_request_v1_ready_locked() FROM PUBLIC,anon,authenticated,service_role;

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
  IF TG_OP = 'UPDATE' AND NEW.legacy_snapshot_cutoff IS DISTINCT FROM OLD.legacy_snapshot_cutoff THEN
    RAISE EXCEPTION 'The legacy snapshot cutoff is immutable.' USING ERRCODE='22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.retained_context_ever_enabled := OLD.retained_context_ever_enabled OR NEW.retained_context_ever_enabled OR NEW.retained_context_policy = 'retained_v1';
  ELSE
    NEW.retained_context_ever_enabled := NEW.retained_context_ever_enabled OR NEW.retained_context_policy = 'retained_v1';
  END IF;
  IF NEW.retained_context_policy = 'retained_v1' THEN
    IF NEW.key NOT IN ('card_missing','whatsapp_connection') OR (SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.fields) = 'array' THEN NEW.fields ELSE '[]'::jsonb END) f WHERE f->>'kind'='details' AND f->>'required'='false') <> 1 THEN
      RAISE EXCEPTION 'Retained context needs one optional details question. Turn it off before restoring an older version.' USING ERRCODE='22023';
    END IF;
    IF TG_OP = 'INSERT' OR OLD.retained_context_policy <> 'retained_v1' THEN
      IF NOT public.cockpit_request_v1_ready_locked() THEN RAISE EXCEPTION 'Retained context is not ready for activation.' USING ERRCODE='55000'; END IF;
    END IF;
  END IF;
  v_problem := public.cockpit_request_type_problem(to_jsonb(NEW));
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = v_problem, ERRCODE = '22023';
  END IF;
  NEW.team := NEW.targets->0->>'team';
  RETURN NEW;
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
    IF k NOT IN ('label','targets','fields','sop_steps','sop_url','due_days','priority','set_request_type','enabled','retained_context_policy') THEN
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
  IF p_patch ? 'retained_context_policy' THEN
    IF p_key NOT IN ('card_missing','whatsapp_connection') OR jsonb_typeof(p_patch->'retained_context_policy') IS DISTINCT FROM 'string' OR p_patch->>'retained_context_policy' NOT IN ('legacy','retained_v1') THEN
      RAISE EXCEPTION 'This request policy is not allowed.' USING ERRCODE = '22023';
    END IF;
    n.retained_context_policy := p_patch->>'retained_context_policy';
  END IF;
  IF n.retained_context_policy = 'retained_v1' AND t.retained_context_policy <> 'retained_v1' AND NOT public.cockpit_request_v1_ready_locked() THEN
    RAISE EXCEPTION 'Retained context is not ready for activation.' USING ERRCODE = '55000';
  END IF;
  IF n.retained_context_policy = 'retained_v1' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(n.fields) f WHERE f->>'kind' = 'details' AND coalesce((f->>'required')::boolean,false) = false) THEN
    RAISE EXCEPTION 'An optional details question is required for this policy.' USING ERRCODE = '22023';
  END IF;
  n.retained_context_ever_enabled := coalesce(t.retained_context_ever_enabled,false) OR n.retained_context_policy = 'retained_v1';
  UPDATE public.cockpit_request_types SET retained_context_ever_enabled = n.retained_context_ever_enabled, retained_context_policy = n.retained_context_policy, label = n.label, targets = n.targets, fields = n.fields, sop_steps = n.sop_steps,
    sop_steps_state = n.sop_steps_state, sop_url = n.sop_url, due_days = n.due_days, priority = n.priority,
    set_request_type = n.set_request_type, enabled = n.enabled, version = t.version + 1, updated_by = v_email, updated_at = now()
   WHERE key = p_key RETURNING * INTO n;
  INSERT INTO public.cockpit_request_type_versions(key, version, "row", saved_by, note)
  VALUES (n.key, n.version, to_jsonb(n), v_email, 'Saved');
  PERFORM public.cockpit_request_audit('request_type.saved', 'cockpit_request_types', n.key, v_email, to_jsonb(t), to_jsonb(n),
    jsonb_build_object('version', n.version, 'keys', (SELECT jsonb_agg(x ORDER BY x) FROM jsonb_object_keys(p_patch) x)));
  RETURN public.cockpit_request_type_view(n, true);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_submit_impl(p_request_id uuid, p_type_key text, p_client_task_id text, p_answers jsonb,
  p_due_on date, p_priority text, p_source text, p_replaces_task_id text, p_policy_guard text, p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_gate jsonb;
  t public.cockpit_request_types;
  v_answers jsonb := CASE WHEN p_answers IS NULL OR jsonb_typeof(p_answers) = 'null' THEN '{}'::jsonb ELSE p_answers END;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_due date; v_priority text; v_hash text; v_client text; v_client_field jsonb; v_f jsonb; v_v jsonb;
  v_label text; v_problem text; v_text text; v_opts jsonb; v_state text; v_k text;
  v_existing public.cockpit_requests; v_dup public.cockpit_requests; v_import public.cockpit_requests;
  v_plan jsonb; v_e jsonb; v_queue uuid; r public.cockpit_requests; v_parts jsonb;
BEGIN
  -- 1. Who sends, and whether the writer takes requests now. An editor, an
  -- admin or the CEO may file while requests are not open: the request is
  -- held (queued, not sent) and goes to ClickUp once they open.
  v_gate := public.cockpit_request_send_gate(v_seat, p_client_task_id);
  IF NOT coalesce((v_gate->>'allowed')::boolean, false) THEN
    RAISE EXCEPTION USING MESSAGE = v_gate->>'note', ERRCODE = '55000';
  END IF;
  -- 2. Where it comes from, and the type.
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'The request has no id. Reload the form.' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_source, '') NOT IN ('requests_page','client_page') THEN
    RAISE EXCEPTION 'Send requests from the Requests page or a client page.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.cockpit_request_types WHERE key = p_type_key;
  IF p_policy_guard = 'retained_v1' OR p_type_key IN ('card_missing','whatsapp_connection') THEN
    SELECT * INTO t FROM public.cockpit_request_types WHERE key = p_type_key FOR SHARE;
  END IF;
  IF t.key IS NULL THEN RAISE EXCEPTION 'That request type does not exist. Reload the form.' USING ERRCODE = '22023'; END IF;
  IF p_policy_guard = 'retained_v1' THEN
    SELECT * INTO v_existing FROM public.cockpit_requests WHERE id=p_request_id AND requester_member_id::text=v_seat->>'memberId';
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.type_key IS DISTINCT FROM p_type_key OR v_existing.type_version IS DISTINCT FROM p_expected_version OR (public.cockpit_request_type_at(v_existing.type_key,v_existing.type_version)).retained_context_policy IS DISTINCT FROM 'retained_v1' OR jsonb_typeof(v_answers) IS DISTINCT FROM 'object' OR octet_length(v_answers::text) > 32768 OR v_existing.content_hash IS DISTINCT FROM public.cockpit_request_hash(p_type_key,p_client_task_id,v_answers,coalesce(p_due_on,v_existing.due_on),coalesce(nullif(btrim(p_priority),''),v_existing.priority),p_replaces_task_id) THEN
        RAISE EXCEPTION 'This request was already sent with other answers. Reload the form and send again.' USING ERRCODE='22023';
      END IF;
      SELECT coalesce(jsonb_agg(public.cockpit_request_part_row(p, v_seat) ORDER BY p.created_at, public.cockpit_request_part_rank(v_existing.type_key,p.part),p.part),'[]'::jsonb) INTO v_parts FROM public.cockpit_request_parts p WHERE p.request_id=v_existing.id;
      RETURN jsonb_build_object('id',v_existing.id,'state',v_existing.state,'reused',true,'duplicateOf',NULL,'note',CASE WHEN public.cockpit_request_held(v_existing) THEN v_gate->>'note' END,'held',public.cockpit_request_held(v_existing),'parts',v_parts);
    END IF;
  END IF;
  IF NOT t.enabled THEN
    RAISE EXCEPTION 'This request type is turned off. Pick another or ask the systems manager.' USING ERRCODE = '22023';
  END IF;
  IF p_policy_guard NOT IN ('legacy','retained_v1') THEN RAISE EXCEPTION 'Invalid request policy.' USING ERRCODE = '22023'; END IF;
  IF t.retained_context_policy = 'retained_v1' OR p_policy_guard = 'retained_v1' THEN
    SELECT * INTO v_existing FROM public.cockpit_requests WHERE id=p_request_id AND requester_member_id::text=v_seat->>'memberId';
    IF v_existing.id IS NULL THEN
      IF p_policy_guard = 'legacy' THEN RAISE EXCEPTION 'Reload with the supported request form.' USING ERRCODE = '55000'; END IF;
      IF t.retained_context_policy IS DISTINCT FROM 'retained_v1' OR t.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'The request changed. Reload the form.' USING ERRCODE = '40001'; END IF;
      IF NOT public.cockpit_request_v1_ready_locked() THEN RAISE EXCEPTION 'Retained context is not ready.' USING ERRCODE = '55000'; END IF;
    END IF;
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
      SELECT coalesce(jsonb_agg(public.cockpit_request_part_row(p, v_seat)
               ORDER BY p.created_at, public.cockpit_request_part_rank(v_existing.type_key, p.part), p.part), '[]'::jsonb)
        INTO v_parts FROM public.cockpit_request_parts p WHERE p.request_id = v_existing.id;
      RETURN jsonb_build_object('id', v_existing.id, 'state', v_existing.state, 'reused', true, 'duplicateOf', NULL,
        'note', CASE WHEN public.cockpit_request_held(v_existing) THEN v_gate->>'note' END,
        'held', public.cockpit_request_held(v_existing), 'parts', v_parts);
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
    -- Routed already, here or in ClickUp (review round 3: moved, closed or deleted
    -- there, which the writer would skip). The same sentence lets a request filed
    -- again with replacesIfOpen go on its own.
    IF v_import.state <> 'imported' OR public.cockpit_request_import_handled(v_import) THEN
      RAISE EXCEPTION 'That old ticket was already routed.' USING ERRCODE = '55000';
    END IF;
    -- The same rule that shows Route on the queue (canRoute), and the ticket's own card.
    IF NOT public.cockpit_request_can_route(v_import, v_seat) THEN
      RAISE EXCEPTION 'Only that team, an editor, an admin or the CEO can route this old ticket.' USING ERRCODE = '42501';
    END IF;
    IF v_import.client_task_id IS NOT NULL AND p_client_task_id IS DISTINCT FROM v_import.client_task_id THEN
      RAISE EXCEPTION USING MESSAGE = 'This old ticket is for ' || coalesce(v_import.client_name, 'another client')
        || '. Route it for that client.', ERRCODE = '22023';
    END IF;
    -- During the test on the internal test card (apply_limited), only that card's
    -- own tickets go out. A ticket with no card routed onto the test card would go
    -- at once and close a real ticket on All Tasks (review round 2): it is routed
    -- for its own client instead, held until requests open to everyone. The claim
    -- keeps the same rule for a request filed before the test began (review round 3,
    -- cockpit_request_replaces_ok), so a held one never goes out during it either.
    IF public.cockpit_request_writer_takes(p_client_task_id)
       AND NOT public.cockpit_request_replaces_ok(p_replaces_task_id, public.cockpit_clickup_requests_mode()) THEN
      RAISE EXCEPTION 'This old ticket has no client card, so it cannot go out on the internal test card. Route it for its own client, or with none; it waits until requests open to everyone.'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  -- 7. One open lifecycle request per card.
  IF t.key IN ('client_offboarding','client_pause','client_relaunch') AND p_client_task_id IS NOT NULL THEN
    SELECT * INTO v_dup FROM public.cockpit_requests q
     WHERE q.type_key = t.key AND q.client_task_id = p_client_task_id
       AND q.state NOT IN ('cancelled','failed','routed') AND q.done_at IS NULL
       AND q.created_at > now() - interval '60 days'
       AND (p_replaces_task_id IS NULL OR q.imported_task_id IS DISTINCT FROM p_replaces_task_id)
       -- An old form ticket already dealt with in ClickUp waits for nobody (review round 3).
       AND NOT public.cockpit_request_import_handled(q)
     ORDER BY q.created_at DESC LIMIT 1;
    IF v_dup.id IS NOT NULL THEN
      -- "Open it" only for a seat that may open it (review round 2); anyone else
      -- is told who raised it, by role, or which queue an old form ticket waits in.
      IF public.cockpit_request_may_open(v_dup, v_seat) THEN
        RETURN jsonb_build_object('id', NULL, 'state', 'duplicate', 'reused', false, 'duplicateOf', v_dup.id, 'held', false,
          'note', 'An open ' || lower(t.label) || ' request for ' || coalesce(v_client, 'this client') || ' already exists. Open it instead.',
          'parts', '[]'::jsonb);
      END IF;
      RETURN jsonb_build_object('id', NULL, 'state', 'duplicate', 'reused', false, 'duplicateOf', NULL, 'held', false,
        'note', 'An open ' || lower(t.label) || ' request for ' || coalesce(v_client, 'this client') || ' already exists'
          || CASE WHEN v_dup.source = 'import'
                  THEN '. It came in through the old ClickUp form and waits in the '
                       || coalesce(public.cockpit_request_team_label(t.team), 'team') || ' queue.'
                  ELSE ', raised by ' || coalesce(nullif(btrim(v_dup.requester_label), ''), 'a team member') || '. Ask them about it.' END,
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
  SELECT coalesce(jsonb_agg(public.cockpit_request_part_row(p, v_seat)
           ORDER BY p.created_at, public.cockpit_request_part_rank(r.type_key, p.part), p.part), '[]'::jsonb)
    INTO v_parts FROM public.cockpit_request_parts p WHERE p.request_id = r.id;
  SELECT * INTO r FROM public.cockpit_requests q WHERE q.id = r.id;
  -- A held request says so: saved, and sent once requests open.
  RETURN jsonb_build_object('id', r.id, 'state', r.state, 'reused', false, 'duplicateOf', NULL,
    'note', CASE WHEN coalesce((v_gate->>'held')::boolean, false) THEN v_gate->>'note' END,
    'held', coalesce((v_gate->>'held')::boolean, false), 'parts', v_parts);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_preview_impl(p_type_key text, p_client_task_id text, p_answers jsonb, p_policy_guard text, p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  t public.cockpit_request_types;
  v_client text; v_plan jsonb; v_parts jsonb; v_note text; v_label text;
BEGIN
  SELECT * INTO t FROM public.cockpit_request_types WHERE key = p_type_key;
  IF t.key IS NULL THEN
    RAISE EXCEPTION 'That request type does not exist. Reload the form.' USING ERRCODE = '22023';
  END IF;
  IF p_policy_guard NOT IN ('legacy','retained_v1') THEN RAISE EXCEPTION 'Invalid request policy.' USING ERRCODE = '22023'; END IF;
  IF p_policy_guard = 'legacy' AND t.retained_context_policy = 'retained_v1' THEN RAISE EXCEPTION 'Reload with the supported request form.' USING ERRCODE = '55000'; END IF;
  IF p_policy_guard = 'retained_v1' AND (t.retained_context_policy IS DISTINCT FROM 'retained_v1' OR t.version IS DISTINCT FROM p_expected_version) THEN RAISE EXCEPTION 'The request changed. Reload the form.' USING ERRCODE = '40001'; END IF;
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
           'stepsDraft', e->'stepsDraft',
           'owner', public.cockpit_request_owner_for(e->'owner', coalesce((v_seat->>'isEditor')::boolean, false))) ORDER BY n), '[]'::jsonb)
    INTO v_parts FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS x(e, n);
  IF jsonb_array_length(v_parts) = 0 THEN
    SELECT f->>'label' INTO v_label FROM jsonb_array_elements(t.targets) g, jsonb_array_elements(t.fields) f
     WHERE jsonb_typeof(g->'when') = 'object' AND f->>'key' = g->'when'->>'field_key' LIMIT 1;
    v_note := 'Pick ' || coalesce(v_label, 'the choices above') || ' to see where it goes.';
  END IF;
  RETURN jsonb_build_object('parts', v_parts, 'note', v_note,
    'dueDefault', to_char(public.cockpit_request_due_default(t.due_days), 'YYYY-MM-DD'),
    'writer', public.cockpit_request_writer_view(v_seat, p_client_task_id) - 'mode');
END $$;


REVOKE ALL ON FUNCTION public.cockpit_request_submit_impl(uuid,text,text,jsonb,date,text,text,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_request_preview_impl(text,text,jsonb,text,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_request_preview(p_type_key text,p_client_task_id text DEFAULT NULL,p_answers jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.cockpit_request_preview_impl(p_type_key,p_client_task_id,p_answers,'legacy',NULL)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_request_preview_v1(p_type_key text,p_client_task_id text,p_answers jsonb,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.cockpit_request_types;
BEGIN
  PERFORM public.cockpit_request_seat();
  SELECT * INTO t FROM public.cockpit_request_types WHERE key=p_type_key FOR SHARE;
  IF t.key IS NULL OR t.retained_context_policy IS DISTINCT FROM 'retained_v1' OR t.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'The request changed. Reload the form.' USING ERRCODE='40001';
  END IF;
  IF NOT public.cockpit_request_v1_ready_locked() THEN RAISE EXCEPTION 'Retained context is not ready.' USING ERRCODE='55000'; END IF;
  RETURN public.cockpit_request_preview_impl(p_type_key,p_client_task_id,p_answers,'retained_v1',p_expected_version);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_submit(p_request_id uuid,p_type_key text,p_client_task_id text,p_answers jsonb,p_due_on date,p_priority text,p_source text,p_replaces_task_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.cockpit_request_submit_impl(p_request_id,p_type_key,p_client_task_id,p_answers,p_due_on,p_priority,p_source,p_replaces_task_id,'legacy',NULL)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_request_submit_v1(p_request_id uuid,p_type_key text,p_client_task_id text,p_answers jsonb,p_due_on date,p_priority text,p_source text,p_replaces_task_id text,p_expected_version integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.cockpit_request_submit_impl(p_request_id,p_type_key,p_client_task_id,p_answers,p_due_on,p_priority,p_source,p_replaces_task_id,'retained_v1',p_expected_version)
$$;
REVOKE ALL ON FUNCTION public.cockpit_request_preview_v1(text,text,jsonb,integer) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.cockpit_request_submit_v1(uuid,text,text,jsonb,date,text,text,text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_request_preview_v1(text,text,jsonb,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_request_submit_v1(uuid,text,text,jsonb,date,text,text,text,integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.cockpit_kickoff_item_raise(p_task_id text, p_item text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_kickoff_items_seat(p_task_id);
  v_rseat jsonb;
  c jsonb;
  d public.cockpit_kickoff_item_answers;
  v_after public.cockpit_kickoff_item_answers;
  v_state jsonb;
  v_row jsonb;
  ty public.cockpit_request_types;
  v_details_key text;
  v_answers jsonb := '{}'::jsonb;
  v_submit jsonb;
  v_k jsonb;
  v_again boolean;
  v_req public.cockpit_requests;
  v_held boolean;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Send the request id, so a second press raises nothing twice.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_kickoff_items_known(p_item);
  -- Two presses on two screens are taken in turn.
  PERFORM pg_advisory_xact_lock(hashtext('kickoff_item:' || p_task_id || ':' || p_item));
  v_rseat := public.cockpit_request_seat();
  SELECT * INTO d FROM public.cockpit_kickoff_item_answers a WHERE a.task_id = p_task_id AND a.item = p_item FOR UPDATE;
  -- A retry of the same press.
  IF d.request_id = p_request_id THEN
    SELECT * INTO v_req FROM public.cockpit_requests q WHERE q.id = d.request_id;
    v_held := coalesce(public.cockpit_request_held(v_req), false);
    v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
    RETURN jsonb_build_object('ok', true, 'raised', true, 'reused', true,
      'item', public.cockpit_kickoff_items_row(v_state, p_item),
      'submit', jsonb_build_object('id', v_req.id, 'state', v_req.state, 'held', v_held,
        'note', CASE WHEN v_held THEN public.cockpit_request_send_gate(v_rseat, p_task_id)->>'note' END));
  END IF;
  v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
  v_row := public.cockpit_kickoff_items_row(v_state, p_item);
  IF v_row IS NULL OR (v_row->>'state' IN ('declined', 'reopened') AND NOT (v_row->>'stillOpen')::boolean) THEN
    RAISE EXCEPTION 'That item is not open on this client''s kickoff any more.' USING ERRCODE = '22023';
  END IF;
  IF v_row->>'state' = 'raised' THEN
    RAISE EXCEPTION 'Already raised on % by %.', public.cockpit_request_day_words((d.decided_at AT TIME ZONE 'Asia/Kuwait')::date),
      d.decided_by_label USING ERRCODE = '55000';
  END IF;
  IF v_row->>'state' = 'type_off' THEN
    RAISE EXCEPTION '% is turned off in Requests settings, so it cannot be raised here. Ask the systems manager.',
      v_row->>'typeLabel' USING ERRCODE = '55000';
  END IF;
  IF v_row->>'blocked' IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = v_row->>'blocked', ERRCODE = '55000';
  END IF;
  IF NOT coalesce((v_row->>'oneTap')::boolean, false) THEN
    RAISE EXCEPTION '% needs answers the kickoff does not have. Raise it with the form.', v_row->>'typeLabel'
      USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(v_row->'existing') = 'object' THEN
    -- Nothing is written: the screen offers "Count it".
    RETURN jsonb_build_object('ok', true, 'raised', false, 'reused', false, 'state', 'already_open', 'item', v_row);
  END IF;

  -- The answers as the form builds them: the details sentence where the type asks for details.
  SELECT e INTO c FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) e WHERE e->>'item' = p_item;
  SELECT * INTO ty FROM public.cockpit_request_types q WHERE q.key = c->>'typeKey';
  IF ty.retained_context_policy = 'retained_v1' THEN
    SELECT * INTO ty FROM public.cockpit_request_types q WHERE q.key = c->>'typeKey' FOR SHARE;
    v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
    v_row := public.cockpit_kickoff_items_row(v_state, p_item);
    IF v_row IS NULL OR (v_row->>'state' IN ('declined','reopened') AND NOT (v_row->>'stillOpen')::boolean) OR v_row->>'state' IN ('raised','type_off') OR v_row->>'blocked' IS NOT NULL OR NOT coalesce((v_row->>'oneTap')::boolean,false) OR jsonb_typeof(v_row->'existing') = 'object' THEN
      RAISE EXCEPTION 'The kickoff request changed. Reload before raising it.' USING ERRCODE = '40001';
    END IF;
  END IF;
  SELECT f->>'key' INTO v_details_key FROM jsonb_array_elements(ty.fields) WITH ORDINALITY AS z(f, n)
   WHERE f->>'kind' = 'details' ORDER BY n LIMIT 1;
  IF v_details_key IS NOT NULL AND v_row->>'details' IS NOT NULL THEN
    v_answers := jsonb_build_object(v_details_key, v_row->>'details');
  END IF;
  -- The one create path, as the caller (the requests gate, the client check, the checks, the audit, the kick).
  IF ty.retained_context_policy = 'retained_v1' THEN
    v_submit := public.cockpit_request_submit_v1(p_request_id, ty.key, p_task_id, v_answers,
      public.cockpit_request_due_default(ty.due_days), coalesce(c->>'priority', ty.priority), 'client_page', NULL, ty.version);
  ELSE
    v_submit := public.cockpit_request_submit(p_request_id, ty.key, p_task_id, v_answers,
      public.cockpit_request_due_default(ty.due_days), coalesce(c->>'priority', ty.priority), 'client_page', NULL);
  END IF;
  IF v_submit->>'id' IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = coalesce(v_submit->>'note', 'The request could not be raised. Raise it with the form.'),
      ERRCODE = '55000';
  END IF;

  v_k := v_state->'kickoff';
  v_again := d.task_id IS NOT NULL;
  INSERT INTO public.cockpit_kickoff_item_answers AS a(task_id, item, kickoff_ref, kickoff_at, kickoff_value, answer, request_id,
    how, type_key, note, decided_by_member, decided_by_email, decided_by_label, decided_at, updated_at)
  VALUES (p_task_id, p_item, v_k->>'ref', (v_k->>'at')::timestamptz, v_row->>'value', 'raised', (v_submit->>'id')::uuid,
    'one_tap', ty.key, NULL, (v_seat->>'memberId')::uuid, v_seat->>'email',
    coalesce(public.cockpit_slack_notice_role_of(v_seat->>'email'), 'a team member'), now(), now())
  ON CONFLICT (task_id, item) DO UPDATE SET kickoff_ref = excluded.kickoff_ref, kickoff_at = excluded.kickoff_at,
    kickoff_value = excluded.kickoff_value, answer = excluded.answer, request_id = excluded.request_id, how = excluded.how,
    type_key = excluded.type_key, note = NULL, decided_by_member = excluded.decided_by_member,
    decided_by_email = excluded.decided_by_email, decided_by_label = excluded.decided_by_label,
    decided_at = excluded.decided_at, updated_at = now()
  RETURNING * INTO v_after;
  PERFORM public.cockpit_request_audit('kickoff_item.raised', 'cockpit_kickoff_item_answers', p_task_id || ':' || p_item,
    v_seat->>'email', CASE WHEN v_again THEN to_jsonb(d) END, to_jsonb(v_after),
    jsonb_build_object('item', p_item, 'type', ty.key, 'requestId', v_submit->>'id', 'kickoffRef', v_k->>'ref',
      'value', v_row->>'value', 'how', 'one_tap', 'again', v_again));

  v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
  RETURN jsonb_build_object('ok', true, 'raised', true, 'reused', coalesce((v_submit->>'reused')::boolean, false),
    'item', public.cockpit_kickoff_items_row(v_state, p_item),
    'submit', jsonb_build_object('id', v_submit->'id', 'state', v_submit->'state', 'held', v_submit->'held',
      'note', v_submit->'note'));
END $$;

COMMIT;
