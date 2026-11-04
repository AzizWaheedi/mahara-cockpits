-- The 1-1 notes effect dispatch (docs/forms/STAGE2B-CONTRACT.md sections
-- 2.7, 3.3 to 3.6, 3.11, 3.12 and 4.0, build 0). Creative Triage
-- (bldgtotkfmhoxmlzowdx). Additive; applies twice. The fifth 2b file: after
-- 20261029s (the owner gate), 20261029t (the ClickUp form kind),
-- 20261029u (the Call grade kind) and 20261029v (the recap approval).
--
-- 1. cockpit_form_dispatch turns a live check-in's cockpit-owned effects into
--    delivery rows: one ClickUp queue row per card effect (3.3, no comment
--    text in the payload), the grade notice once the recording's grade is
--    ready (3.4, ids and times only), the recap message once its draft is
--    ready (3.5, the draft's text byte for byte). It runs from three places:
--    the submit (one added line), a draft leaving drafting (trigger), and the
--    minute sweep the notices kick calls. Kickoff and Blueprint are never
--    dispatched (Y49). A failing insert keeps the effect planned with its
--    error and never rolls back the notes; the whole body never raises.
-- 2. cockpit_form_effects_settle and three triggers move each effect from
--    its outbox's state (3.6); an illegal move is recorded, never raised.
-- 3. The effects guard gains two moves: unknown to skipped, and an insert in
--    state delivered for build 8's records only (cockpit.forms_record).
-- 4. The sweep, the kick (no cron of its own: the notices kick calls it),
--    the drafts reader and the waiting list the forms door's effects.sweep
--    op reads, and cockpit_form_effect_note, the one way a reason changes
--    without a state move (with its own audit row).
--
-- Nothing here can reach a card, Slack or a client while the registry's
-- checkin effects are shadow: only a cockpit-owned effect of a live response
-- is ever dispatched. Every function is SECURITY DEFINER with an empty search
-- path, revoked from all four roles, then granted exactly as section 2.7
-- says. The two replaced bodies are checked first (the drift guard, Z61).
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: each replaced function is the body the contract read
--    (or this file's, on a second apply).

DO $$
DECLARE
  v text;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('cockpit_form_submit(uuid,integer)', 'fb609612258ad0d547b8fdfa4c0c91c7', '2a0a49cafcd0e5dfe7ca6949837154f5'),
      ('cockpit_form_effects_guard()', 'c981fe2cbc92a24ee393b974952de98f', 'b3d4444b4f9cd7645cdecfab1b2204c3')
    ) AS x(fn, live, after) LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.' || r.fn);
    IF v IS DISTINCT FROM r.live AND v IS DISTINCT FROM r.after THEN
      RAISE EXCEPTION '% changed since the 2b contract read it; stop and re-read it.', r.fn USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Small writers (internal)

-- The one way an effect's reason changes without a state move: only when it
-- differs, and then one forms.effect_reason audit row, because the 2a effects
-- audit fires only on UPDATE OF state (20261027f_forms_core.sql:561-562).
-- True when it wrote.
CREATE OR REPLACE FUNCTION public.cockpit_form_effect_note(p_id uuid, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.cockpit_form_effects;
  v_reason text := left(p_reason, 240);
  v_actor text;
BEGIN
  SELECT * INTO e FROM public.cockpit_form_effects x WHERE x.id = p_id;
  IF NOT FOUND OR e.reason IS NOT DISTINCT FROM v_reason THEN
    RETURN false;
  END IF;
  UPDATE public.cockpit_form_effects x SET reason = v_reason WHERE x.id = p_id;
  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('forms.effect_reason', 'cockpit_form_effects', e.id::text,
          coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), session_user::text),
          'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          jsonb_build_object('reason', e.reason), jsonb_build_object('reason', v_reason),
          jsonb_build_object('effectId', e.id, 'responseId', e.response_id, 'state', e.state));
  RETURN true;
END $$;

-- The forms-effects-kick health row, never raising.
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_health(p_ok boolean, p_note text, p_detail jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
    VALUES ('forms-effects-kick', now(), CASE WHEN p_ok THEN now() END, p_ok, left(p_note, 400), p_detail, now())
    ON CONFLICT (key) DO UPDATE
       SET last_run_at = now(), last_ok_at = CASE WHEN p_ok THEN now() ELSE s0.last_ok_at END, ok = p_ok,
           note = EXCLUDED.note, detail = coalesce(EXCLUDED.detail, s0.detail), updated_at = now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The dispatch

-- One live check-in's cockpit-owned delivery effects (section 4.0 step 1):
-- every planned one, and a failed recap that never made its message while
-- the notes are under 24 hours old (Z28). Each effect is tried on its own: an
-- error keeps the effect where it was, with the error as its reason, and the
-- notes are never rolled back (Z5). An error outside those blocks notes
-- forms-effects-kick not ok and answers {error}; it never raises (Z53).
-- Answer: {queued, waiting, failed, skipped}.
CREATE OR REPLACE FUNCTION public.cockpit_form_dispatch(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  e public.cockpit_form_effects;
  d public.cockpit_form_drafts;
  v_prev text := current_setting('cockpit.forms_action', true);
  v_queued integer := 0;
  v_waiting integer := 0;
  v_failed integer := 0;
  v_skipped integer := 0;
  v_payload jsonb;
  v_ref uuid;
  v_rec text;
  v_body text;
  v_state text;
  v_error text;
  v_err text;
BEGIN
  BEGIN
    SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
    -- Y49: only a live check-in is ever dispatched; kickoff and Blueprint never.
    IF NOT FOUND OR r.form_key IS DISTINCT FROM 'checkin' OR r.mode IS DISTINCT FROM 'live'
       OR r.state NOT IN ('submitted','confirmed') THEN
      RETURN jsonb_build_object('queued', 0, 'waiting', 0, 'failed', 0, 'skipped', 0);
    END IF;
    PERFORM set_config('cockpit.forms_action', 'forms.effect_dispatched', true);
    FOR e IN
      SELECT * FROM public.cockpit_form_effects x
       WHERE x.response_id = r.id AND x.owner = 'cockpit'
         AND x.delivery IN ('clickup_queue','slack_notice','client_message')
         AND (x.state = 'planned'
              OR (x.state = 'failed' AND x.delivery = 'client_message' AND x.delivery_ref IS NULL
                  AND r.submitted_at > now() - interval '24 hours'))
       ORDER BY x.created_at, x.effect_key
         FOR UPDATE SKIP LOCKED
    LOOP
      -- The registry took it back, or the response is outside the native window
      -- (the provider is typeform, so the window is NULL and never passes; or it
      -- was sent before this flip): a planned effect is skipped, a failed recap
      -- stays failed. The same rule as the gate (3.1, Z70), so nothing is queued
      -- that the gate would refuse and no draft is asked for it.
      IF public.cockpit_form_effect_owner(e.form_key, e.effect_key) IS DISTINCT FROM 'cockpit'
         OR (r.submitted_at >= public.cockpit_form_native_since(e.form_key)) IS NOT TRUE THEN
        IF e.state = 'planned' THEN
          UPDATE public.cockpit_form_effects x SET state = 'skipped', reason = 'Make owns this again.' WHERE x.id = e.id;
          v_skipped := v_skipped + 1;
        END IF;
        CONTINUE;
      END IF;
      BEGIN
        IF e.delivery = 'clickup_queue' THEN
          -- 3.3: the plan without its lines and comment text, which the
          -- writer reads from the effect through its claim.
          v_payload := jsonb_build_object('formKey', 'checkin', 'responseId', r.id, 'effectId', e.id,
                         'effectKey', e.effect_key, 'taskId', r.task_id, 'clientName', r.client_name)
                       || (e.plan - 'lines' - 'comment_text');
          IF jsonb_typeof(e.plan->'comment_text') = 'string' THEN
            v_payload := v_payload || jsonb_build_object(
              'commentChars', char_length(e.plan->>'comment_text'),
              'commentSha256', encode(pg_catalog.sha256(convert_to(e.plan->>'comment_text', 'UTF8')), 'hex'));
          END IF;
          INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, task_id, payload)
          VALUES (e.dedupe_key, 'form', 'cockpit_form_effects', e.id::text, r.task_id, v_payload)
          ON CONFLICT (dedupe_key) DO NOTHING;
          SELECT q.id, q.state, q.error INTO v_ref, v_state, v_error
            FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = e.dedupe_key;
          UPDATE public.cockpit_form_effects x
             SET state = 'queued', delivery_ref = v_ref::text, receipt = jsonb_build_object('queueId', v_ref), reason = NULL
           WHERE x.id = e.id;
          v_queued := v_queued + 1;
          IF v_state IN ('delivered','failed','skipped','unknown','dry_run') THEN
            PERFORM public.cockpit_form_effects_settle('clickup_queue', v_ref::text, v_state, v_error,
              jsonb_build_object('table', 'cockpit_clickup_writeback_queue', 'id', v_ref, 'state', v_state, 'at', now()), false);
          END IF;

        ELSIF e.delivery = 'slack_notice' THEN
          -- 3.4: the recording's grade, whichever client's window began it.
          v_rec := coalesce(e.plan->>'recordingId', r.answers->'call'->>'recordingId');
          SELECT * INTO d FROM public.cockpit_form_drafts x
           WHERE x.kind = 'grade' AND x.recording_id = v_rec
           ORDER BY x.started_at DESC, x.attempt DESC LIMIT 1;
          IF d.state = 'ready' THEN
            v_ref := public.cockpit_slack_notice_queue('checkin.grade', 'grade:' || v_rec, r.task_id, r.client_name,
              jsonb_build_object('responseId', r.id, 'recordingId', v_rec, 'draftId', d.id, 'taskId', r.task_id,
                                 'effectId', e.id, 'client', r.client_name, 'submittedAt', r.submitted_at),
              NULL, 'queued', NULL);
            IF v_ref IS NULL THEN
              SELECT n.id INTO v_ref FROM public.cockpit_slack_notices n WHERE n.dedupe_key = 'grade:' || v_rec;
            END IF;
            SELECT n.state, n.error INTO v_state, v_error FROM public.cockpit_slack_notices n WHERE n.id = v_ref;
            UPDATE public.cockpit_form_effects x
               SET state = 'queued', delivery_ref = v_ref::text, receipt = jsonb_build_object('noticeId', v_ref), reason = NULL
             WHERE x.id = e.id;
            v_queued := v_queued + 1;
            -- The notice already ended (made for this recording before): settle at once.
            IF v_state IN ('posted','failed','unknown','skipped','muted') THEN
              PERFORM public.cockpit_form_effects_settle('slack_notice', v_ref::text,
                CASE v_state WHEN 'posted' THEN 'delivered' WHEN 'muted' THEN 'skipped' ELSE v_state END,
                CASE WHEN v_state = 'muted' THEN 'The call grade notice is off in Notices and routing.' ELSE v_error END,
                jsonb_build_object('table', 'cockpit_slack_notices', 'id', v_ref, 'state', v_state, 'at', now()), false);
            END IF;
          ELSIF d.state IN ('off','failed','skipped') THEN
            UPDATE public.cockpit_form_effects x
               SET state = 'failed', reason = left('No grade: ' || coalesce(nullif(btrim(d.reason), ''), 'the grader gave no reason.'), 240)
             WHERE x.id = e.id;
            v_failed := v_failed + 1;
          ELSE
            IF e.reason IS NULL THEN
              PERFORM public.cockpit_form_effect_note(e.id, 'Waiting for the grade.');
            END IF;
            v_waiting := v_waiting + 1;
          END IF;

        ELSE
          -- 3.5: the newest recap draft of this response.
          SELECT * INTO d FROM public.cockpit_form_drafts x
           WHERE x.kind = 'recap' AND x.response_id = r.id
           ORDER BY x.started_at DESC, x.attempt DESC LIMIT 1;
          IF d.state = 'ready' THEN
            v_body := d.text;
            IF v_body IS NULL OR v_body = '' OR char_length(v_body) > 4096 THEN
              IF e.state = 'planned' THEN
                UPDATE public.cockpit_form_effects x
                   SET state = 'failed', reason = 'The recap draft is empty or over 4,096 characters. Draft it again.'
                 WHERE x.id = e.id;
              ELSE
                PERFORM public.cockpit_form_effect_note(e.id,
                  'The recap draft is empty or over 4,096 characters. Draft it again.');
              END IF;
              v_failed := v_failed + 1;
            ELSE
              INSERT INTO public.cockpit_client_messages(dedupe_key, task_id, client_name, kind, response_id, draft_id,
                body, body_sha256, state, expires_at)
              VALUES (e.dedupe_key, r.task_id, r.client_name, 'recap_checkin', r.id, d.id,
                      v_body, encode(pg_catalog.sha256(convert_to(v_body, 'UTF8')), 'hex'), 'draft', NULL)
              ON CONFLICT (dedupe_key) DO NOTHING;
              SELECT m.id, m.state, m.reason INTO v_ref, v_state, v_error
                FROM public.cockpit_client_messages m WHERE m.dedupe_key = e.dedupe_key;
              IF e.state = 'failed' THEN
                PERFORM set_config('cockpit.forms_fix', 'on', true);
              END IF;
              UPDATE public.cockpit_form_effects x
                 SET state = 'queued', delivery_ref = v_ref::text, receipt = jsonb_build_object('messageId', v_ref), reason = NULL
               WHERE x.id = e.id;
              PERFORM set_config('cockpit.forms_fix', '', true);
              v_queued := v_queued + 1;
              IF v_state IN ('sent','failed','unknown','skipped') THEN
                PERFORM public.cockpit_form_effects_settle('client_message', v_ref::text,
                  CASE v_state WHEN 'sent' THEN 'delivered' ELSE v_state END, v_error,
                  jsonb_build_object('table', 'cockpit_client_messages', 'id', v_ref, 'state', v_state, 'at', now()), false);
              END IF;
            END IF;
          ELSIF e.state = 'planned' AND d.state IN ('off','failed','skipped') THEN
            UPDATE public.cockpit_form_effects x
               SET state = 'failed', reason = left('No recap: ' || coalesce(nullif(btrim(d.reason), ''), 'the drafter gave no reason.'), 240)
             WHERE x.id = e.id;
            v_failed := v_failed + 1;
          ELSIF e.state = 'planned' THEN
            IF e.reason IS NULL THEN
              PERFORM public.cockpit_form_effect_note(e.id, 'Waiting for the recap draft.');
            END IF;
            v_waiting := v_waiting + 1;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- The effect keeps its state; the error is its reason (once, audited).
        PERFORM set_config('cockpit.forms_fix', '', true);
        PERFORM public.cockpit_form_effect_note(e.id, left(SQLERRM, 240));
        v_waiting := v_waiting + 1;
      END;
    END LOOP;
    PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
    RETURN jsonb_build_object('queued', v_queued, 'waiting', v_waiting, 'failed', v_failed, 'skipped', v_skipped);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.cockpit_form_effects_health(false,
      'The 1-1 notes dispatch failed: ' || left(v_err, 200) || '. The notes are saved; the sweep tries again every minute.',
      NULL);
    RETURN jsonb_build_object('error', left(v_err, 240));
  END;
END $$;

-- 20261027f's cockpit_form_submit with one added line, the dispatch after the
-- adoption loop and before step 12 (section 4.0 step 2).
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
  PERFORM public.cockpit_form_dispatch(r.id);
  -- 12.
  RETURN jsonb_build_object('response', public.cockpit_form_response_view(r),
    'effects', public.cockpit_form_effects_of(r.id), 'duplicate', false);
END $$;

-- ---------------------------------------------------------------------------
-- 3. Settling an effect from its outbox (section 3.6)

-- Moves every effect with this delivery and ref to p_target when the effects
-- guard allows it; an illegal move writes one forms.settle_refused audit row
-- and leaves the effect as it was. It never raises, so an outbox's own write
-- (the ClickUp writer, the notices sender, the WhatsApp sender) always
-- commits. p_fix requeues a failed effect (cockpit.forms_fix, set and cleared
-- here). A delivered or requeued effect drops its old reason; any other move
-- takes the outbox's reason, cut to 240.
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_settle(p_delivery text, p_ref text, p_target text, p_reason text,
  p_receipt jsonb, p_fix boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.cockpit_form_effects;
  v_prev text := current_setting('cockpit.forms_action', true);
  v_actor text;
BEGIN
  BEGIN
    FOR e IN SELECT * FROM public.cockpit_form_effects x
              WHERE x.delivery = p_delivery AND x.delivery_ref = p_ref ORDER BY x.created_at, x.id LOOP
      CONTINUE WHEN e.state = p_target;
      BEGIN
        PERFORM set_config('cockpit.forms_action', 'forms.effect_settled', true);
        IF coalesce(p_fix, false) THEN
          PERFORM set_config('cockpit.forms_fix', 'on', true);
        END IF;
        UPDATE public.cockpit_form_effects x
           SET state = p_target,
               reason = CASE WHEN p_target IN ('delivered','queued') THEN left(p_reason, 240)
                             ELSE coalesce(left(p_reason, 240), x.reason) END,
               receipt = coalesce(x.receipt, '{}'::jsonb) || coalesce(p_receipt, '{}'::jsonb)
         WHERE x.id = e.id;
        PERFORM set_config('cockpit.forms_fix', '', true);
        PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
      EXCEPTION WHEN OTHERS THEN
        SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
        INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system,
                                             before, after, metadata)
        VALUES ('forms.settle_refused', 'cockpit_form_effects', e.id::text,
                coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), session_user::text),
                'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
                jsonb_build_object('state', e.state), jsonb_build_object('state', p_target),
                jsonb_build_object('delivery', p_delivery, 'ref', p_ref, 'reason', left(SQLERRM, 240)));
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_form_effects_health(false, 'An effect could not be settled: ' || left(SQLERRM, 200), NULL);
  END;
END $$;

-- The ClickUp queue's moves (kind form only).
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_from_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_source text := current_setting('cockpit.audit_source', true);
  v_receipt jsonb;
BEGIN
  BEGIN
    IF NEW.state NOT IN ('delivered','failed','skipped','unknown','dry_run') THEN
      RETURN NULL;
    END IF;
    PERFORM set_config('cockpit.audit_source', 'clickup-writeback', true);
    v_receipt := jsonb_build_object('table', 'cockpit_clickup_writeback_queue', 'id', NEW.id, 'state', NEW.state, 'at', now());
    IF NEW.state = 'delivered' THEN
      PERFORM public.cockpit_form_effects_settle('clickup_queue', NEW.id::text, 'delivered', NULL,
        v_receipt || jsonb_build_object('step', NEW.progress->'steps'->(NEW.payload->>'effectKey')), false);
    ELSIF NEW.state = 'dry_run' THEN
      PERFORM public.cockpit_form_effects_settle('clickup_queue', NEW.id::text, 'failed',
        'The ClickUp writer ran this as a dry run; nothing was written.', v_receipt, false);
    ELSE
      PERFORM public.cockpit_form_effects_settle('clickup_queue', NEW.id::text, NEW.state, NEW.error, v_receipt, false);
    END IF;
    PERFORM set_config('cockpit.audit_source', coalesce(v_source, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_form_effects_health(false, 'An effect could not be settled: ' || left(SQLERRM, 200), NULL);
  END;
  RETURN NULL;
END $$;

-- The notices' moves (kind checkin.grade only).
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_from_notices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_source text := current_setting('cockpit.audit_source', true);
  v_receipt jsonb;
BEGIN
  BEGIN
    PERFORM set_config('cockpit.audit_source', 'cockpit-notices', true);
    v_receipt := jsonb_build_object('table', 'cockpit_slack_notices', 'id', NEW.id, 'state', NEW.state, 'at', now());
    IF NEW.state = 'posted' THEN
      PERFORM public.cockpit_form_effects_settle('slack_notice', NEW.id::text, 'delivered', NULL,
        v_receipt || jsonb_build_object('channel', NEW.channel, 'ts', NEW.slack_ts), false);
    ELSIF NEW.state IN ('failed','unknown','skipped') THEN
      PERFORM public.cockpit_form_effects_settle('slack_notice', NEW.id::text, NEW.state, NEW.error, v_receipt, false);
    ELSIF NEW.state = 'muted' THEN
      PERFORM public.cockpit_form_effects_settle('slack_notice', NEW.id::text, 'skipped',
        'The call grade notice is off in Notices and routing.', v_receipt, false);
    ELSIF OLD.state = 'failed' AND NEW.state = 'queued' THEN
      -- cockpit_slack_notice_fix sent it again: the effect waits on it again.
      PERFORM public.cockpit_form_effects_settle('slack_notice', NEW.id::text, 'queued', NULL, v_receipt, true);
    END IF;
    PERFORM set_config('cockpit.audit_source', coalesce(v_source, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_form_effects_health(false, 'An effect could not be settled: ' || left(SQLERRM, 200), NULL);
  END;
  RETURN NULL;
END $$;

-- The client messages' moves (kind recap_checkin only). A refused message
-- waits on a person (the effect stays queued); a person's Skip of a refused
-- message closes the effect; a failed message skipped leaves it failed (Z55).
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_from_messages()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_source text := current_setting('cockpit.audit_source', true);
  v_receipt jsonb;
BEGIN
  BEGIN
    PERFORM set_config('cockpit.audit_source', 'client-messages', true);
    v_receipt := jsonb_build_object('table', 'cockpit_client_messages', 'id', NEW.id, 'state', NEW.state, 'at', now());
    IF NEW.state = 'sent' THEN
      PERFORM public.cockpit_form_effects_settle('client_message', NEW.id::text, 'delivered', NULL, v_receipt, false);
    ELSIF NEW.state IN ('failed','unknown') THEN
      PERFORM public.cockpit_form_effects_settle('client_message', NEW.id::text, NEW.state, NEW.reason, v_receipt, false);
    ELSIF NEW.state = 'skipped' AND OLD.state IS DISTINCT FROM 'failed' THEN
      PERFORM public.cockpit_form_effects_settle('client_message', NEW.id::text, 'skipped', NEW.reason, v_receipt, false);
    ELSIF OLD.state = 'failed' AND NEW.state = 'draft' THEN
      -- Reopened after a failure: the effect waits on the message again.
      PERFORM public.cockpit_form_effects_settle('client_message', NEW.id::text, 'queued', NULL, v_receipt, true);
    END IF;
    PERFORM set_config('cockpit.audit_source', coalesce(v_source, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_form_effects_health(false, 'An effect could not be settled: ' || left(SQLERRM, 200), NULL);
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_form_effects_from_queue ON public.cockpit_clickup_writeback_queue;
CREATE TRIGGER cockpit_form_effects_from_queue AFTER UPDATE OF state ON public.cockpit_clickup_writeback_queue
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.kind = 'form')
  EXECUTE FUNCTION public.cockpit_form_effects_from_queue();
DROP TRIGGER IF EXISTS cockpit_form_effects_from_notices ON public.cockpit_slack_notices;
CREATE TRIGGER cockpit_form_effects_from_notices AFTER UPDATE OF state ON public.cockpit_slack_notices
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.kind = 'checkin.grade')
  EXECUTE FUNCTION public.cockpit_form_effects_from_notices();
DROP TRIGGER IF EXISTS cockpit_form_effects_from_messages ON public.cockpit_client_messages;
CREATE TRIGGER cockpit_form_effects_from_messages AFTER UPDATE OF state ON public.cockpit_client_messages
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.kind = 'recap_checkin')
  EXECUTE FUNCTION public.cockpit_form_effects_from_messages();

-- 20261027f's effects guard with exactly two added moves (section 3.6): an
-- unknown effect may end skipped (a read-back proved nothing was written, or
-- a kept date), and build 8 may record a kickoff or Blueprint effect as
-- delivered at insert while cockpit.forms_record is on, owned by the cockpit,
-- naming the Stage 1 row it records.
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_fix boolean := coalesce(current_setting('cockpit.forms_fix', true), '') = 'on';
BEGIN
  IF NEW.owner IS DISTINCT FROM 'cockpit' AND NEW.state NOT IN ('dry_run','skipped') THEN
    RAISE EXCEPTION 'Only an effect the cockpit owns can be %', NEW.state USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('planned','dry_run','skipped')
       AND NOT (NEW.state = 'delivered' AND coalesce(current_setting('cockpit.forms_record', true), '') = 'on'
                AND NEW.owner = 'cockpit' AND NEW.delivery_ref IS NOT NULL AND NEW.form_key IN ('kickoff','blueprint')) THEN
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
      OR (OLD.state = 'unknown' AND NEW.state IN ('delivered','failed','skipped'))
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

-- A grade or recap draft that leaves drafting dispatches the responses
-- waiting on it: the planned grade effects of its recording, the recap
-- effect of its response. It never fails cockpit_form_draft_finish.
CREATE OR REPLACE FUNCTION public.cockpit_form_drafts_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  BEGIN
    IF NEW.kind = 'grade' THEN
      FOR v_id IN
        SELECT DISTINCT e.response_id FROM public.cockpit_form_effects e
         WHERE e.effect_key = 'grade_notice' AND e.state = 'planned' AND e.owner = 'cockpit'
           AND e.plan->>'recordingId' = NEW.recording_id
      LOOP
        PERFORM public.cockpit_form_dispatch(v_id);
      END LOOP;
    ELSIF NEW.kind = 'recap' AND NEW.response_id IS NOT NULL THEN
      PERFORM public.cockpit_form_dispatch(NEW.response_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_form_effects_health(false,
      'The 1-1 notes dispatch failed: ' || left(SQLERRM, 200) || '. The notes are saved; the sweep tries again every minute.',
      NULL);
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_form_drafts_dispatch ON public.cockpit_form_drafts;
CREATE TRIGGER cockpit_form_drafts_dispatch AFTER UPDATE OF state ON public.cockpit_form_drafts
  FOR EACH ROW WHEN (OLD.state = 'drafting' AND NEW.state IS DISTINCT FROM 'drafting' AND NEW.kind IN ('grade','recap'))
  EXECUTE FUNCTION public.cockpit_form_drafts_dispatch();

-- ---------------------------------------------------------------------------
-- 4. The sweep, the kick and the forms door's readers

-- Every minute (from the notices kick): dispatch every live check-in with a
-- planned cockpit effect again, then, 30 minutes after the send, fail what is
-- still planned with a plain sentence. A reason changes only through
-- cockpit_form_effect_note or with a state move, so nothing is rewritten.
-- A dispatch that answered {error} is counted in errors, and the first such
-- error is kept in firstError, so the kick can say what failed.
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_out jsonb;
  v_prev text := current_setting('cockpit.forms_action', true);
  v_responses integer := 0;
  v_queued integer := 0;
  v_waiting integer := 0;
  v_failed integer := 0;
  v_skipped integer := 0;
  v_errors integer := 0;
  v_first_error text;
  v_timed integer := 0;
  n integer;
BEGIN
  FOR v_id IN
    SELECT DISTINCT r.id FROM public.cockpit_form_effects e
      JOIN public.cockpit_form_responses r ON r.id = e.response_id
     WHERE r.form_key = 'checkin' AND r.mode = 'live' AND r.state IN ('submitted','confirmed')
       AND e.owner = 'cockpit' AND e.delivery IN ('clickup_queue','slack_notice','client_message')
       AND (e.state = 'planned'
            OR (e.state = 'failed' AND e.delivery = 'client_message' AND e.delivery_ref IS NULL
                AND r.submitted_at > now() - interval '24 hours'))
     LIMIT 200
  LOOP
    v_out := public.cockpit_form_dispatch(v_id);
    v_responses := v_responses + 1;
    IF v_out ? 'error' THEN
      v_errors := v_errors + 1;
      v_first_error := coalesce(v_first_error, nullif(btrim(v_out->>'error'), ''), 'no error text');
    ELSE
      v_queued := v_queued + coalesce((v_out->>'queued')::integer, 0);
      v_waiting := v_waiting + coalesce((v_out->>'waiting')::integer, 0);
      v_failed := v_failed + coalesce((v_out->>'failed')::integer, 0);
      v_skipped := v_skipped + coalesce((v_out->>'skipped')::integer, 0);
    END IF;
  END LOOP;

  -- Thirty minutes after the send, what is still planned fails.
  PERFORM set_config('cockpit.forms_action', 'forms.effect_timed_out', true);
  UPDATE public.cockpit_form_effects e
     SET state = 'failed',
         reason = CASE e.effect_key
                    WHEN 'grade_notice' THEN 'No grade: the grader did not answer.'
                    WHEN 'recap' THEN 'No recap: the drafter did not answer.'
                    ELSE coalesce(e.reason, 'The ClickUp write could not be queued.') END
    FROM public.cockpit_form_responses r
   WHERE r.id = e.response_id AND r.form_key = 'checkin' AND r.mode = 'live'
     AND e.owner = 'cockpit' AND e.state = 'planned'
     AND e.delivery IN ('clickup_queue','slack_notice','client_message')
     AND r.submitted_at <= now() - interval '30 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  v_timed := n;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  RETURN jsonb_build_object('responses', v_responses, 'queued', v_queued, 'waiting', v_waiting, 'failed', v_failed,
    'skipped', v_skipped, 'errors', v_errors, 'firstError', v_first_error, 'timedOut', v_timed);
END $$;

-- The grade and recap effects waiting on a draft nobody began: planned,
-- younger than 30 minutes, the registry's owner still the cockpit, with no
-- drafting or ready draft (the grade by its recording, the recap by its
-- response), sent inside the native window. An effect the registry has taken
-- back, or a response from before this flip or while the provider is typeform,
-- is the dispatch's to skip, never a reason to ask for a draft.
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_waiting_rows()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'effectId', z.id, 'responseId', z.response_id,
             'kind', CASE z.effect_key WHEN 'grade_notice' THEN 'grade' ELSE 'recap' END,
             'taskId', z.task_id, 'recordingId', z.rec, 'since', z.created_at,
             'draftState', z.draft_state, 'actorId', z.created_by_id,
             'response', public.cockpit_form_response_view(z.r))
           ORDER BY z.created_at, z.id)
      FROM (SELECT e.id, e.response_id, e.effect_key, e.created_at, r.task_id, r.created_by_id, r AS r,
                   coalesce(e.plan->>'recordingId', r.answers->'call'->>'recordingId') AS rec,
                   (SELECT d.state FROM public.cockpit_form_drafts d
                     WHERE (e.effect_key = 'grade_notice' AND d.kind = 'grade'
                            AND d.recording_id = coalesce(e.plan->>'recordingId', r.answers->'call'->>'recordingId'))
                        OR (e.effect_key = 'recap' AND d.kind = 'recap' AND d.response_id = r.id)
                     ORDER BY d.started_at DESC, d.attempt DESC LIMIT 1) AS draft_state
              FROM public.cockpit_form_effects e
              JOIN public.cockpit_form_responses r ON r.id = e.response_id
             WHERE r.form_key = 'checkin' AND r.mode = 'live' AND r.state IN ('submitted','confirmed')
               AND e.owner = 'cockpit' AND e.state = 'planned' AND e.effect_key IN ('grade_notice','recap')
               AND public.cockpit_form_effect_owner('checkin', e.effect_key) = 'cockpit'
               AND r.submitted_at >= public.cockpit_form_native_since('checkin')
               AND r.submitted_at > now() - interval '30 minutes'
               AND NOT EXISTS (
                     SELECT 1 FROM public.cockpit_form_drafts d
                      WHERE d.state IN ('drafting','ready')
                        AND ((e.effect_key = 'grade_notice' AND d.kind = 'grade'
                              AND d.recording_id = coalesce(e.plan->>'recordingId', r.answers->'call'->>'recordingId'))
                          OR (e.effect_key = 'recap' AND d.kind = 'recap' AND d.response_id = r.id)))
             LIMIT 50) z), '[]'::jsonb);
END $$;

-- The forms door's effects.sweep reads this (the service key only).
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_waiting()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  RETURN public.cockpit_form_effects_waiting_rows();
END $$;

-- cockpit_form_drafts_read's answer with no seat gate, for the effects
-- sweep's drafts reader (Z56): the cron request has no auth.uid().
CREATE OR REPLACE FUNCTION public.cockpit_form_drafts_service(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_form_responses;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open the notes from the client page.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'recordingId', CASE WHEN r.answers->'call'->>'kind' = 'fathom' THEN r.answers->'call'->>'recordingId' END,
    'drafts', public.cockpit_form_drafts_for(r), 'now', now());
END $$;

-- The minute kick, called from the notices kick (20261029u owns that body;
-- no cron of its own, Z10): the sweep, then, when a grade or recap waits on a
-- draft nobody began, one post to the forms door's effects.sweep at most
-- every 2 minutes. It writes forms-effects-kick each run. When any dispatch of
-- the sweep failed, that row is not ok with 3.12's dispatch sentence whatever
-- else the run did (the post still goes out under its 2-minute rule), so a
-- dispatch that fails every minute never reads healthy (Z53).
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_kick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-forms-api';
  v_sweep jsonb;
  v_waiting jsonb;
  v_n integer;
  v_last timestamptz;
  v_secret text;
  v_anon text;
  v_headers jsonb;
  v_request bigint;
  v_note text;
  v_failed text;
BEGIN
  BEGIN
    v_sweep := public.cockpit_form_effects_sweep();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_form_effects_health(false,
      'The 1-1 notes dispatch failed: ' || left(SQLERRM, 200) || '. The notes are saved; the sweep tries again every minute.',
      NULL);
    RETURN NULL;
  END;
  IF coalesce((v_sweep->>'errors')::integer, 0) > 0 THEN
    v_failed := 'The 1-1 notes dispatch failed: '
      || left(coalesce(nullif(btrim(v_sweep->>'firstError'), ''), 'no error text'), 200)
      || '. The notes are saved; the sweep tries again every minute.';
  END IF;
  v_waiting := public.cockpit_form_effects_waiting_rows();
  SELECT count(DISTINCT w->>'responseId') INTO v_n FROM jsonb_array_elements(v_waiting) w;
  SELECT CASE WHEN s.detail->>'postedAt' ~ '^\d{4}-' THEN (s.detail->>'postedAt')::timestamptz END INTO v_last
    FROM public.cockpit_sync_state s WHERE s.key = 'forms-effects-kick';
  IF v_n = 0 THEN
    PERFORM public.cockpit_form_effects_health(v_failed IS NULL, coalesce(v_failed, 'Nothing waiting.'),
      jsonb_build_object('sweep', v_sweep, 'postedAt', v_last, 'waiting', 0));
    RETURN NULL;
  END IF;
  IF v_last IS NOT NULL AND v_last > now() - interval '2 minutes' THEN
    PERFORM public.cockpit_form_effects_health(v_failed IS NULL, coalesce(v_failed,
      'Waiting for the drafts of ' || CASE WHEN v_n = 1 THEN 'one set of 1-1 notes' ELSE v_n || ' 1-1 notes' END
        || '; asked at ' || public.cockpit_form_kuwait_clock(v_last) || '.'),
      jsonb_build_object('sweep', v_sweep, 'postedAt', v_last, 'waiting', v_n));
    RETURN NULL;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = $1 LIMIT 1'
      INTO v_secret USING 'cockpit_notices_cron_secret';
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = $1 LIMIT 1'
      INTO v_anon USING 'cockpit_anon_key';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    v_note := 'The vault has no cockpit_notices_cron_secret, so the 1-1 notes sweep did not run. Add it to the vault.';
  -- cockpit-forms-api checks the JWT (D11), so a post with no key would be
  -- answered 401 and nothing would be asked.
  ELSIF v_anon IS NULL OR btrim(v_anon) = '' THEN
    v_note := 'The vault has no cockpit_anon_key, so the 1-1 notes sweep did not run. Add it to the vault.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace ns ON ns.oid = f.pronamespace
                     WHERE ns.nspname = 'net' AND f.proname = 'http_post') THEN
    v_note := 'pg_net is not installed, so the 1-1 notes sweep did not run.';
  END IF;
  IF v_note IS NOT NULL THEN
    -- Both are faults; the failing dispatch is the note (it stops every
    -- delivery), and the blocked post stays in the detail.
    PERFORM public.cockpit_form_effects_health(false, coalesce(v_failed, v_note),
      jsonb_build_object('sweep', v_sweep, 'postedAt', v_last, 'waiting', v_n)
        || CASE WHEN v_failed IS NOT NULL THEN jsonb_build_object('blocked', v_note) ELSE '{}'::jsonb END);
    RETURN NULL;
  END IF;
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret,
                                  'Authorization', 'Bearer ' || btrim(v_anon));
  -- The forms door answers when its sweep ends (up to about 100 seconds), so the
  -- post waits 150 s, as the requests kick does, rather than dropping the run at 5 s.
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 150000)' INTO v_request
    USING v_url, jsonb_build_object('op', 'effects.sweep'), v_headers;
  PERFORM public.cockpit_form_effects_health(v_failed IS NULL, coalesce(v_failed,
    'Asked the drafts for ' || CASE WHEN v_n = 1 THEN 'one set of 1-1 notes' ELSE v_n || ' 1-1 notes' END || '.'),
    jsonb_build_object('sweep', v_sweep, 'postedAt', now(), 'waiting', v_n));
  RETURN v_request;
END $$;

CREATE INDEX IF NOT EXISTS cockpit_form_effects_delivery_ref
  ON public.cockpit_form_effects (delivery, delivery_ref) WHERE delivery_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE fn text;
BEGIN
  -- Internal: no role at all (definer functions, triggers and the kick as owner).
  FOREACH fn IN ARRAY ARRAY[
    'cockpit_form_effect_note(uuid,text)', 'cockpit_form_effects_health(boolean,text,jsonb)',
    'cockpit_form_dispatch(uuid)', 'cockpit_form_effects_settle(text,text,text,text,jsonb,boolean)',
    'cockpit_form_effects_from_queue()', 'cockpit_form_effects_from_notices()', 'cockpit_form_effects_from_messages()',
    'cockpit_form_effects_guard()', 'cockpit_form_drafts_dispatch()', 'cockpit_form_effects_sweep()',
    'cockpit_form_effects_waiting_rows()', 'cockpit_form_effects_kick()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', fn);
  END LOOP;
  -- The forms door's readers: the service key only.
  FOREACH fn IN ARRAY ARRAY['cockpit_form_effects_waiting()', 'cockpit_form_drafts_service(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- The window's send keeps its live grant.
  EXECUTE 'REVOKE ALL ON FUNCTION public.cockpit_form_submit(uuid,integer) FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_form_submit(uuid,integer) TO authenticated';
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
