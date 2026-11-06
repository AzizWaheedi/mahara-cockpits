-- UNSAFE HISTORICAL PROTOTYPE: not a migration. Never deploy.
-- Guarded against the live function inspected 6 November 2026. No request-type settings change here.
DO $guard$
DECLARE f oid := to_regprocedure('public.cockpit_request_plan(public.cockpit_request_types,uuid,text,text,jsonb,date,text,text,text)');
BEGIN
  IF f IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = f AND md5(pg_get_functiondef(p.oid)) = '96677a21b5d8fd7478b419d244c8b2b3'
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proacl::text = '{postgres=X/postgres}'
      AND p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']::text[]
  ) THEN RAISE EXCEPTION 'Request planner differs from the reviewed definition; stop and review.'; END IF;
END $guard$;

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
       p_type.key IN ('card_missing', 'whatsapp_connection') OR
       NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_type.fields) f WHERE f->>'kind' = 'details')
     ) THEN
    SELECT nullif(btrim(i.answers->>'details'), '') INTO v_old_words FROM public.cockpit_requests i
     WHERE i.imported_task_id = p_replaces AND i.source = 'import';
  END IF;
  -- For the two kickoff types the original is explicitly retained and new
  -- details are separate. If the two texts are identical, print them once.
  IF p_type.key IN ('card_missing', 'whatsapp_connection') AND v_old_words IS NOT NULL AND v_details = v_old_words THEN
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
                CASE WHEN v_old_words IS NOT NULL AND p_type.key IN ('card_missing', 'whatsapp_connection') AND v_details IS NOT NULL
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

DO $guard$
DECLARE f oid := to_regprocedure('public.cockpit_request_plan(public.cockpit_request_types,uuid,text,text,jsonb,date,text,text,text)');
BEGIN
  IF f IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = f AND md5(pg_get_functiondef(p.oid)) = '9920281946cbc5f20740407340593c85'
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proacl::text = '{postgres=X/postgres}'
      AND p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']::text[]
  ) THEN RAISE EXCEPTION 'Request planner replacement or privileges differ; roll back.'; END IF;
END $guard$;
