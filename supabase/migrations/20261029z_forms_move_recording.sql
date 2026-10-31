-- Moving a recording to another client (docs/forms/STAGE2B-CONTRACT.md
-- sections 2.10, 3.8 and 4.11, build 11). Creative Triage
-- (bldgtotkfmhoxmlzowdx). Additive; applies twice. The last 2b file.
--
-- Today a recording the worker put on the wrong client is fixed only by an
-- admin through SQL, and the 1-1 notes window refuses it for every seat.
-- This file gives an admin or the CEO one explicit, confirmed gesture, behind
-- a switch that starts off (Z16):
--
-- 1. cockpit_settings_forms_audit: every change of a forms.% switch in
--    cockpit_settings writes one audit row, whoever makes it (the table
--    grants the service role full write and had no trigger, Z62).
-- 2. The switch forms.move_recording, seeded off.
-- 3. cockpit_forms_switch (the forms door reads a switch with the service key).
-- 4. cockpit_csm_move_recording: the call row moved to the chosen client,
--    re-linked to that client's booking by the one booking rule, with one
--    match audit row and one csm.recording_moved audit row. It refuses a
--    recording that carries 1-1 notes, and it never runs from a send:
--    cockpit_csm_attach_recording still refuses another client's recording.
--    The csm-calls worker keeps manual rows, so it never moves one back.
--
-- Every function is SECURITY DEFINER with an empty search path, revoked from
-- all four roles; only the move (authenticated, gated first) and the switch
-- read (the service key) are granted.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Every forms.% switch change leaves an audit row (created before the seed)

-- The actor: the cut-over's cockpit.audit_actor first; then updated_by, but
-- on an update only when this write changed it (a REST flip that leaves it
-- alone would otherwise name the last writer, the seed's 'migration'); then
-- the session's login role, as 2a's cockpit_forms_audit does, so a REST write
-- reads 'authenticator'. Never current_user: inside this definer function it
-- is the owner, whoever wrote.
CREATE OR REPLACE FUNCTION public.cockpit_settings_forms_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_key text := CASE TG_OP WHEN 'DELETE' THEN OLD.key ELSE NEW.key END;
  v_by text := CASE TG_OP
                 WHEN 'INSERT' THEN NEW.updated_by
                 WHEN 'UPDATE' THEN CASE WHEN NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN NEW.updated_by END
               END;
BEGIN
  IF v_key IS NULL OR v_key NOT LIKE 'forms.%' THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (CASE TG_OP WHEN 'INSERT' THEN 'forms.switch_seeded' WHEN 'UPDATE' THEN 'forms.switch_set' ELSE 'forms.switch_removed' END,
          'cockpit_settings', v_key,
          coalesce(nullif(current_setting('cockpit.audit_actor', true), ''), nullif(btrim(v_by), ''), session_user::text),
          'client-success', 'supabase',
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN jsonb_build_object('value', OLD.value) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN jsonb_build_object('value', NEW.value) END,
          jsonb_build_object('op', lower(TG_OP), 'key', v_key));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_settings_forms_audit ON public.cockpit_settings;
CREATE TRIGGER cockpit_settings_forms_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_settings
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_settings_forms_audit();

-- ---------------------------------------------------------------------------
-- 2. The switch, off (the trigger records the seed only when it happened)

INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.move_recording', '{"on":false}'::jsonb, 'migration')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Reading a switch

-- forms.{p_key} is on only when its value says {"on": true}; a missing row,
-- or anything else, reads off.
CREATE OR REPLACE FUNCTION public.cockpit_forms_switch_on(p_key text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN coalesce((SELECT CASE WHEN jsonb_typeof(s.value->'on') = 'boolean' THEN (s.value->>'on')::boolean END
                     FROM public.cockpit_settings s WHERE s.key = 'forms.' || p_key), false);
END $$;

-- The forms door's read (CallView.movable, 3.8): the service key only.
CREATE OR REPLACE FUNCTION public.cockpit_forms_switch(p_key text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  RETURN public.cockpit_forms_switch_on(p_key);
END $$;

-- ---------------------------------------------------------------------------
-- 4. The move

-- An admin or the CEO moves a recording that is on another client to this
-- one (section 4.11, steps 1 to 13). Refused, it writes nothing.
CREATE OR REPLACE FUNCTION public.cockpit_csm_move_recording(p_recording_id text, p_task_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor jsonb;
  v_seat uuid;
  c public.cockpit_csm_calls;
  m public.cockpit_fathom_meetings;
  v_link bigint;
  v_kind text;
  v_client text;
  v_share text;
  v_new_kind text;
BEGIN
  -- 1. An admin or the CEO.
  v_actor := public.cockpit_form_actor();
  v_seat := (v_actor->>'actorId')::uuid;
  IF NOT (coalesce((v_actor->>'admin')::boolean, false) OR coalesce((v_actor->>'ceo')::boolean, false)) THEN
    RAISE EXCEPTION 'Only an admin or the CEO can move a recording to another client.' USING ERRCODE = '42501';
  END IF;
  -- 2. The switch.
  IF NOT public.cockpit_forms_switch_on('move_recording') THEN
    RAISE EXCEPTION 'Moving a recording is not switched on yet.' USING ERRCODE = '22023';
  END IF;
  -- 3. Both ids, as the attach checks them.
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF p_recording_id IS NULL OR p_recording_id !~ '^[0-9]{3,20}$' THEN
    RAISE EXCEPTION 'That recording is not in the cockpit yet. Check again in a minute.' USING ERRCODE = '22023';
  END IF;
  -- 4. The target client, for this seat.
  v_client := public.cockpit_csm_client_gate_for_actor(v_seat, p_task_id)->>'clientName';
  -- 4b. Any draft naming this recording, held: the send holds its response from
  --     its own step 2, so the move waits for a send in flight and step 8 then
  --     reads it, and a later send waits for this move and its value check
  --     refuses the moved recording. Before the call row because a send takes
  --     them in that order (its attach locks the call row), so the two cannot
  --     deadlock.
  PERFORM 1 FROM public.cockpit_form_responses r
    WHERE r.form_key = 'checkin' AND r.state = 'draft' AND r.answers->'call'->>'recordingId' = p_recording_id
      FOR UPDATE;
  -- 5. The Fathom call row, held against a second mover.
  SELECT * INTO c FROM public.cockpit_csm_calls x WHERE x.source = 'fathom' AND x.source_id = p_recording_id FOR UPDATE;
  -- 6.
  IF NOT FOUND OR c.task_id IS NULL THEN
    RAISE EXCEPTION 'That recording is not on another client. Pick it from the list.' USING ERRCODE = '22023';
  END IF;
  IF c.task_id = p_task_id THEN
    RAISE EXCEPTION 'That recording is already on this client.' USING ERRCODE = '22023';
  END IF;
  -- 7. The store's own row, as the attach and the save read it.
  SELECT * INTO m FROM public.cockpit_fathom_meetings x WHERE x.recording_id = p_recording_id;
  IF m.recording_id IS NULL THEN
    RAISE EXCEPTION 'That recording is not in the cockpit yet. Check again in a minute.' USING ERRCODE = '22023';
  END IF;
  IF m.gone_at IS NOT NULL OR c.status = 'gone' THEN
    RAISE EXCEPTION 'Fathom no longer has that recording. Pick another call.' USING ERRCODE = '22023';
  END IF;
  IF m.class IS NULL OR m.class NOT IN ('client','candidate') THEN
    RAISE EXCEPTION 'That recording is a team meeting, not a client call.' USING ERRCODE = '22023';
  END IF;
  -- 8. 1-1 notes stay with their call: a stored form linked to it or to its
  --    booking, or holding its share link, or a live sent check-in naming it.
  v_share := substring(coalesce(m.share_url, c.recording_url) FROM 'https://fathom\.video/share/[A-Za-z0-9_-]+');
  IF EXISTS (SELECT 1 FROM public.cockpit_csm_call_forms f
              WHERE f.linked_call_id = c.id OR (c.linked_call_id IS NOT NULL AND f.linked_call_id = c.linked_call_id)
                 OR (v_share IS NOT NULL AND f.form_kind IN ('checkin','checkin_late')
                     AND substring(f.recording_url FROM 'https://fathom\.video/share/[A-Za-z0-9_-]+') = v_share))
     OR EXISTS (SELECT 1 FROM public.cockpit_form_responses r
                 WHERE r.form_key = 'checkin' AND r.mode = 'live' AND r.state IN ('submitted','confirmed')
                   AND r.answers->'call'->>'kind' = 'fathom' AND r.answers->'call'->>'recordingId' = p_recording_id) THEN
    RAISE EXCEPTION 'That recording has 1-1 notes on %. If those notes are on the wrong client too, tell the tech lead.',
      public.cockpit_form_client_shown(v_seat, c.task_id, c.client_name) USING ERRCODE = '22023';
  END IF;
  -- 9. The target client's booking of that call, by the one booking rule.
  v_link := public.cockpit_csm_booking_for(p_task_id, c.room, c.starts_at);
  IF v_link IS NOT NULL THEN
    SELECT b.kind INTO v_kind FROM public.cockpit_csm_calls b WHERE b.id = v_link;
  END IF;
  -- A kind inherited from the old client's booking does not travel.
  v_new_kind := coalesce(v_kind, CASE WHEN c.linked_call_id IS NOT NULL THEN 'other' ELSE c.kind END);
  -- 10.
  UPDATE public.cockpit_csm_calls x
     SET task_id = p_task_id, client_name = v_client, match_method = 'manual', match_confidence = 1,
         candidate = false, settled_reason = NULL, hints = '[]'::jsonb, linked_call_id = v_link,
         kind = v_new_kind, updated_at = now()
   WHERE x.id = c.id;
  -- 11. Any open queue row for it.
  UPDATE public.cockpit_csm_unmatched u
     SET resolved_task_id = p_task_id, resolved_by = v_actor->>'email', resolved_at = now(), updated_at = now()
   WHERE u.item_kind = 'call' AND u.item_ref = c.id::text AND u.resolved_at IS NULL;
  -- 12.
  INSERT INTO public.cockpit_csm_match_audit(item_kind, item_ref, task_id, actor_id, actor_email)
  VALUES ('call', c.id::text, p_task_id, v_seat, v_actor->>'email');
  -- 13.
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('csm.recording_moved', 'cockpit_csm_calls', c.id::text, v_actor->>'email', 'client-success', 'supabase',
          jsonb_build_object('taskId', c.task_id, 'clientName', c.client_name, 'matchMethod', c.match_method,
                             'matchConfidence', c.match_confidence, 'linkedCallId', c.linked_call_id, 'kind', c.kind),
          jsonb_build_object('taskId', p_task_id, 'clientName', v_client, 'matchMethod', 'manual',
                             'matchConfidence', 1, 'linkedCallId', v_link, 'kind', v_new_kind),
          jsonb_build_object('recordingId', p_recording_id, 'callId', c.id));
  RETURN jsonb_build_object('ok', true, 'callId', c.id, 'fromTaskId', c.task_id, 'taskId', p_task_id);
END $$;

-- ---------------------------------------------------------------------------
-- 5. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['cockpit_settings_forms_audit()', 'cockpit_forms_switch_on(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', fn);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.cockpit_forms_switch(text) FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_forms_switch(text) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.cockpit_csm_move_recording(text,text) FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_csm_move_recording(text,text) TO authenticated';
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
