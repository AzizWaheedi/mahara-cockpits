-- OFFLINE PROTOTYPE ONLY. Not a migration; do not apply to a live database.
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
