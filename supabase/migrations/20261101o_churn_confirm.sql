-- The churn confirm (waves 1 and 2, L0; docs/forms/WAVE12-CONTRACT.md 2.6, 3.1,
-- 3.2, 3.5 and 4.5; plan docs/forms/CSM-CLIENT-FORMS-PLAN.md 4.2 L0 and 5.8).
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive. Applied after
-- 20261101l_forms_stage3_base.sql (the staff-form record, the derived notice
-- rows, the churn.confirmed notice kind) and 20261101m_billing_rails.sql (the
-- one detail builder, the card's churn reason, the churn writes on the card,
-- the event voids); the first DO block refuses to run without them.
--
-- "Client is leaving" on the client page and "Confirm churn" on the churn
-- tracker call one gated, audited function. It writes the register's new
-- columns on the card's open departure (or a new one), records the response,
-- and inserts one billing event of kind churn, which queues Churn Date,
-- Stopped, Churn Reason and Churn Type for the card (20261101m) and reads them
-- back. The card write waits for its kind to open (CLICKUP_WRITEBACK_BILLING_KINDS).
--
-- 1. Drift guard and dependency check.
-- 2. cockpit_churn_departures: the confirm's columns. No new unique index: the
--    live (task, left_on) index stays the rule, so a client who resumes and
--    later leaves again gets a second departure and past months keep theirs (W21).
-- 3. The card's Churn Type options, and the day-90 default (3.5).
-- 4. (No guard change here: 20261101l's cockpit_form_responses_guard already
--    lets a legacy notice gain answer_meta.answered once, under
--    cockpit.forms_legacy = 'answer', which cockpit_form_notice_answer sets.)
-- 5. cockpit_client_lifecycle_confirm('churn', ...) (3.1).
-- 6. cockpit_form_notice_answer: "Not leaving" and "Handled" (3.1).
-- 7. cockpit_churn_backfill_confirm: the 6-row backfill door (owner only, a
--    deploy step, D-B6 and D-B7).
-- 8. cockpit_client_lifecycle_v and cockpit_client_lifecycle_read (3.2).
-- 9. cockpit_csm_churn_read: departures carry the new columns; notices,
--    unmatched surveys and the Stopped cards not in the register (4.5).
-- 10. forms.doors merged with {"churn":true}, so the doors open.
-- 11. Privileges.
--
-- Missing is never zero: a value nobody holds is NULL here and a sentence on
-- screen. Rollback (section 9, D-O1): flip forms.doors.churn to false in the
-- same step as restoring the saved bodies; the columns stay.

BEGIN;

-- 1. Drift guard and dependency check ------------------------------------------------

DO $guard$
DECLARE v_md5 text; v_name text; v_ok text[];
BEGIN
  FOR v_name, v_ok IN VALUES
    -- live body read 2026-11-01 (contract 11.2-c), then this file's own body.
    ('cockpit_csm_churn_read', ARRAY['b008dbe49a35e451bd8979424b5fcdb3', '8f19c5b1488146d73f72e8d8aa1aba07'])
  LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_md5 IS NULL OR NOT v_md5 = ANY (v_ok) THEN
      RAISE EXCEPTION '% changed since the waves 1-2 contract read it; stop and re-read it.', v_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF to_regprocedure('public.cockpit_form_staff_record(text,text,jsonb,uuid,text)') IS NULL
     OR to_regprocedure('public.cockpit_form_notices_in()') IS NULL
     OR to_regprocedure('public.cockpit_billing_detail(text,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_churn_reason_card(text)') IS NULL
     OR to_regclass('public.cockpit_billing_event_voids') IS NULL
     -- l's guard carries the notice answer's carve-out (cockpit.forms_legacy = 'answer').
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.cockpit_form_responses_guard()')
                     AND p.prosrc LIKE '%cockpit.forms_legacy%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c
                     WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass
                       AND c.conname = 'cockpit_slack_notices_kind_check'
                       AND pg_get_constraintdef(c.oid) LIKE '%churn.confirmed%') THEN
    RAISE EXCEPTION '20261101o needs 20261101l and 20261101m applied first; apply them, then this file.'
      USING ERRCODE = '55000';
  END IF;
END $guard$;

-- 2. The register's confirm columns --------------------------------------------------

ALTER TABLE public.cockpit_churn_departures
  ADD COLUMN IF NOT EXISTS notice_on date,
  ADD COLUMN IF NOT EXISTS exit_call_id text
    CHECK (exit_call_id IS NULL OR char_length(exit_call_id) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS survey_response_id uuid REFERENCES public.cockpit_form_responses(id),
  ADD COLUMN IF NOT EXISTS survey_state text NOT NULL DEFAULT 'not_sent'
    CHECK (survey_state IN ('not_sent','sent','filled','declined')),
  ADD COLUMN IF NOT EXISTS why_detail text CHECK (why_detail IS NULL OR char_length(why_detail) <= 2000),
  ADD COLUMN IF NOT EXISTS how_to_stop text CHECK (how_to_stop IS NULL OR char_length(how_to_stop) <= 2000),
  ADD COLUMN IF NOT EXISTS churn_type text CHECK (churn_type IS NULL OR churn_type IN ('mid_programme','completed')),
  ADD COLUMN IF NOT EXISTS confirmed_by text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_event_id bigint REFERENCES public.cockpit_billing_events(id);

COMMENT ON COLUMN public.cockpit_churn_departures.churn_type IS
  'The confirmed type, as the card''s Churn Type: mid_programme counts as churn, completed does not. NULL until confirmed. The tracker''s month counts still follow the day-90 rule (it feeds pay); this is the decision of record on the card.';
COMMENT ON COLUMN public.cockpit_churn_departures.confirmed_at IS
  'When a CSM or the CEO confirmed the churn (cockpit_client_lifecycle_confirm), or the backfill recorded the CEO''s word (Q5). NULL: logged, not confirmed.';

-- 3. The card's Churn Type, and the day-90 default -----------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_churn_type_card(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_type
    WHEN 'mid_programme' THEN 'Mid-programme loss (counts as churn)'
    WHEN 'completed' THEN 'Completed term (does NOT count as churn)'
  END
$$;

-- The reverse, for the backfill: the card's own option back to the register's type.
CREATE OR REPLACE FUNCTION public.cockpit_churn_type_from_card(p_option text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_option IS NULL OR btrim(p_option) = '' THEN NULL
    WHEN lower(btrim(p_option)) LIKE 'mid-programme%' OR lower(btrim(p_option)) LIKE 'mid programme%' THEN 'mid_programme'
    WHEN lower(btrim(p_option)) LIKE 'completed term%' THEN 'completed'
  END
$$;

-- 3.5: completed only when the client left on day 90 or later AND a renewal
-- date is known and on or before the day they left (the term finished).
-- Otherwise mid_programme, which counts as churn: the safe side, since today
-- all six departures have no renewal date (11.2-e).
CREATE OR REPLACE FUNCTION public.cockpit_churn_type_default(p_task text, p_left_on date)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_launch date; v_renewal date; v_snap_launch date;
BEGIN
  IF p_task IS NULL OR p_left_on IS NULL THEN RETURN 'mid_programme'; END IF;
  SELECT d.launched_on INTO v_launch
    FROM public.cockpit_churn_departures d
   WHERE d.clickup_task_id = p_task AND d.removed_at IS NULL AND d.launched_on IS NOT NULL
   ORDER BY (d.left_on = p_left_on) DESC, d.left_on DESC, d.id DESC
   LIMIT 1;
  SELECT s.launch_date, s.next_renewal_date INTO v_snap_launch, v_renewal
    FROM public.cockpit_client_billing_days s
   WHERE s.clickup_task_id = p_task
   ORDER BY s.day DESC
   LIMIT 1;
  v_launch := coalesce(v_launch, v_snap_launch);
  IF v_launch IS NOT NULL AND p_left_on >= v_launch + 90
     AND v_renewal IS NOT NULL AND v_renewal <= p_left_on THEN
    RETURN 'completed';
  END IF;
  RETURN 'mid_programme';
END $$;

-- The termination survey's ratings, for the tracker's notice band: numbers
-- only, never a typed answer, at most four.
CREATE OR REPLACE FUNCTION public.cockpit_churn_survey_ratings(p_answers jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('title', left(btrim(f->>'title'), 80), 'value', (f->>'value')::numeric) ORDER BY n), '[]'::jsonb)
    FROM (SELECT f, n FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(p_answers->'fields') = 'array' THEN p_answers->'fields' ELSE '[]'::jsonb END)
            WITH ORDINALITY AS t(f, n)
           WHERE f->>'type' IN ('opinion_scale','rating','nps')
             AND jsonb_typeof(f->'value') = 'number'
             AND coalesce(btrim(f->>'title'), '') <> ''
           ORDER BY n LIMIT 4) x
$$;

-- 5. The churn confirm -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_client_lifecycle_confirm(p_kind text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_who text;
  v_ceo boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_task text;
  v_req uuid;
  v_acc public.cockpit_billing_accounts;
  v_dep public.cockpit_churn_departures;
  v_before public.cockpit_churn_departures;
  v_first public.cockpit_billing_events;
  v_left date; v_notice date; v_reason text; v_type text; v_why text; v_how text;
  v_mrr numeric; v_call text; v_survey text; v_survey_id uuid; v_launch date;
  v_clear boolean; v_seat text; v_source text;
  v_resp uuid; v_event bigint; v_detail jsonb; v_built jsonb; v_card text;
  v_answers jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before confirming a churn.' USING ERRCODE = '42501'; END IF;
  IF p_kind IS DISTINCT FROM 'churn' THEN
    RAISE EXCEPTION 'Only a churn is confirmed here for now.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text) > 12000 THEN
    RAISE EXCEPTION 'That form could not be read. Reload the page and send it again.' USING ERRCODE = '22023';
  END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false)) THEN
    RAISE EXCEPTION 'Confirming a churn needs a client success or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = v_uid;

  v_task := btrim(coalesce(p_args->>'taskId', ''));
  IF v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023'; END IF;
  BEGIN
    v_req := (p_args->>'requestId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN v_req := NULL;
  END;
  IF v_req IS NULL THEN
    RAISE EXCEPTION 'That form could not be read. Reload the page and send it again.' USING ERRCODE = '22023';
  END IF;

  -- One confirm at a time per card: the second press waits, then finds the first.
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_task FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_acc.client_name), false) THEN
    RAISE EXCEPTION '% is not one of your clients. Ask its CSM or the CEO to confirm the churn.', v_acc.client_name
      USING ERRCODE = '42501';
  END IF;

  -- A repeat of the same press returns the first result and writes nothing.
  SELECT * INTO v_first FROM public.cockpit_billing_events e
   WHERE e.clickup_task_id = v_task AND e.kind = 'churn' AND e.detail->>'request_id' = v_req::text
   ORDER BY e.id LIMIT 1;
  IF FOUND THEN
    SELECT q.state INTO v_card FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = 'billing:' || v_first.id;
    RETURN jsonb_build_object('departureId', (v_first.detail->>'departure_id')::bigint, 'eventId', v_first.id,
      'responseId', v_first.detail->>'response_id',
      'cardState', CASE WHEN v_card IS NULL THEN 'none' WHEN v_card = 'dry_run' THEN 'held' ELSE v_card END,
      'repeat', true);
  END IF;

  -- What the form says, checked as the form checks it (formDefs churn_confirm).
  BEGIN
    v_left := (p_args->>'leftOn')::date;
  EXCEPTION WHEN OTHERS THEN v_left := NULL;
  END;
  IF v_left IS NULL OR v_left > v_today OR v_left < date '2025-01-01' THEN
    RAISE EXCEPTION 'Pick the day they left, today or before.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_args->>'noticeOn', '')), '') IS NOT NULL THEN
    BEGIN
      v_notice := (p_args->>'noticeOn')::date;
    EXCEPTION WHEN OTHERS THEN v_notice := NULL;
    END;
    IF v_notice IS NULL OR v_notice > v_today OR v_notice < date '2025-01-01' THEN
      RAISE EXCEPTION 'Pick the day the notice came, today or before.' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_reason := p_args->>'reason';
  IF v_reason IS NULL OR v_reason NOT IN ('Cancelled', 'Refund', 'Chargeback', 'Non-payment 14+ days',
       'Paused past 14 days', 'Ghosted', 'Completed term, did not renew', 'Other') THEN
    RAISE EXCEPTION 'Pick the reason they left.' USING ERRCODE = '22023';
  END IF;
  v_type := p_args->>'churnType';
  IF v_type IS NULL OR v_type NOT IN ('mid_programme', 'completed') THEN
    RAISE EXCEPTION 'Pick the churn type.' USING ERRCODE = '22023';
  END IF;
  v_why := left(btrim(regexp_replace(coalesce(p_args->>'whyDetail', ''), '\s+', ' ', 'g')), 2000);
  IF char_length(v_why) < 10 THEN
    RAISE EXCEPTION 'Say why they left in detail, so the lock-in reads back.' USING ERRCODE = '22023';
  END IF;
  v_how := left(btrim(regexp_replace(coalesce(p_args->>'howToStop', ''), '\s+', ' ', 'g')), 2000);
  IF char_length(v_how) < 10 THEN
    RAISE EXCEPTION 'Say how we stop this next time.' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'mrrLostUsd' AND p_args->'mrrLostUsd' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_args->'mrrLostUsd') IS DISTINCT FROM 'number' OR (p_args->>'mrrLostUsd')::numeric < 0
       OR (p_args->>'mrrLostUsd')::numeric > 1000000 THEN
      RAISE EXCEPTION 'MRR lost is a dollar amount, 0 or more.' USING ERRCODE = '22023';
    END IF;
    v_mrr := round((p_args->>'mrrLostUsd')::numeric, 2);
  END IF;
  v_call := nullif(left(btrim(coalesce(p_args->>'exitCallId', '')), 200), '');
  v_survey := coalesce(nullif(p_args->>'surveyState', ''), 'not_sent');
  IF v_survey NOT IN ('not_sent', 'sent', 'filled', 'declined') THEN
    RAISE EXCEPTION 'Pick what happened with the exit survey.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_args->>'surveyResponseId', '')), '') IS NOT NULL THEN
    BEGIN
      v_survey_id := (p_args->>'surveyResponseId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN v_survey_id := NULL;
    END;
    IF v_survey_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.cockpit_form_responses r
         WHERE r.id = v_survey_id AND r.form_key = 'exit_survey' AND r.task_id = v_task) THEN
      RAISE EXCEPTION 'That termination survey is not this client''s. Pick the card on the survey first.' USING ERRCODE = '22023';
    END IF;
    v_survey := 'filled';
  END IF;

  v_seat := CASE WHEN v_ceo THEN 'ceo' ELSE 'csm' END;
  v_source := v_seat;
  v_clear := v_acc.paused_on IS NOT NULL;

  -- The card's open departure: not removed, not confirmed, and no resume after
  -- it (W21). Otherwise a new departure; the (task, left_on) index refuses a
  -- second row on the same day.
  SELECT * INTO v_before FROM public.cockpit_churn_departures d
   WHERE d.clickup_task_id = v_task AND d.removed_at IS NULL
   ORDER BY d.left_on DESC, d.id DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND (v_before.confirmed_at IS NOT NULL OR EXISTS (
       SELECT 1 FROM public.cockpit_billing_events e
        WHERE e.clickup_task_id = v_task AND e.kind = 'resume'
          AND (e.at AT TIME ZONE 'Asia/Kuwait')::date > v_before.left_on
          AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id))) THEN
    v_before := NULL;
  END IF;

  SELECT s.launch_date INTO v_launch FROM public.cockpit_client_billing_days s
   WHERE s.clickup_task_id = v_task ORDER BY s.day DESC LIMIT 1;

  BEGIN
    IF v_before.id IS NOT NULL THEN
      v_launch := coalesce(v_before.launched_on, v_launch);
      UPDATE public.cockpit_churn_departures SET
        left_on = v_left,
        launched_on = CASE WHEN v_launch IS NOT NULL AND v_launch <= v_left THEN v_launch END,
        reason = v_reason,
        mrr_lost_usd = CASE WHEN p_args ? 'mrrLostUsd' THEN v_mrr ELSE mrr_lost_usd END,
        notice_on = v_notice, exit_call_id = v_call,
        survey_response_id = coalesce(v_survey_id, survey_response_id),
        survey_state = CASE WHEN survey_response_id IS NOT NULL AND v_survey_id IS NULL THEN 'filled' ELSE v_survey END,
        why_detail = v_why, how_to_stop = v_how, churn_type = v_type,
        confirmed_by = v_who, confirmed_at = now(), updated_by = v_who, updated_at = now()
      WHERE id = v_before.id
      RETURNING * INTO v_dep;
    ELSE
      INSERT INTO public.cockpit_churn_departures(client, clickup_task_id, left_on, launched_on, reason, mrr_lost_usd, csm,
        source, created_by, updated_by, notice_on, exit_call_id, survey_response_id, survey_state, why_detail, how_to_stop,
        churn_type, confirmed_by, confirmed_at)
      VALUES (v_acc.client_name, v_task, v_left, CASE WHEN v_launch IS NOT NULL AND v_launch <= v_left THEN v_launch END,
        v_reason, coalesce(v_mrr, CASE WHEN p_args ? 'mrrLostUsd' THEN NULL ELSE v_acc.mrr_usd END), v_acc.csm,
        'cockpit', v_who, v_who, v_notice, v_call, v_survey_id, v_survey, v_why, v_how, v_type, v_who, now())
      RETURNING * INTO v_dep;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This client already has a departure on %; confirm that one.', to_char(v_left, 'FMDD Mon YYYY')
      USING ERRCODE = '22023';
  END;

  -- The staff form's record (20261101l): one response per request id.
  v_answers := jsonb_strip_nulls(jsonb_build_object(
    'leftOn', v_left, 'noticeOn', v_notice, 'reason', v_reason, 'churnType', v_type,
    'whyDetail', v_why, 'howToStop', v_how, 'mrrLostUsd', v_mrr, 'exitCallId', v_call,
    'surveyState', v_dep.survey_state, 'surveyResponseId', v_dep.survey_response_id));
  v_resp := public.cockpit_form_staff_record('churn_confirm', v_task, v_answers, v_req, 'cockpit');

  -- The event's detail, through the one builder (20261101m). Keys the builder
  -- leaves out are filled from this confirm, so the card write always has the
  -- shape of contract 3.3.
  v_built := public.cockpit_billing_detail('churn', jsonb_build_object(
    'taskId', v_task, 'leftOn', v_left, 'noticeOn', v_notice, 'reason', v_reason, 'churnType', v_type,
    'whyDetail', v_why, 'howToStop', v_how, 'surveyState', v_dep.survey_state, 'exitCallId', v_call,
    'departureId', v_dep.id, 'responseId', v_resp, 'requestId', v_req, 'seatRole', v_seat,
    'clearPaused', v_clear, 'cardType', public.cockpit_churn_type_card(v_type)));
  v_detail := jsonb_build_object(
    'left_on', v_left, 'card_reason', public.cockpit_churn_reason_card(v_reason),
    'card_type', public.cockpit_churn_type_card(v_type), 'clear_paused', v_clear,
    'departure_id', v_dep.id, 'response_id', v_resp, 'request_id', v_req, 'seat_role', v_seat,
    'why_detail', v_why, 'notice_on', v_notice, 'survey_state', v_dep.survey_state, 'churn_type', v_type)
    || jsonb_strip_nulls(coalesce(v_built, '{}'::jsonb));

  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (v_task, v_acc.client_name, 'churn', v_acc.client_status, 'Stopped', v_reason, v_detail, v_source, v_who)
  RETURNING id INTO v_event;
  UPDATE public.cockpit_churn_departures SET billing_event_id = v_event WHERE id = v_dep.id RETURNING * INTO v_dep;

  -- The mirror follows the decision until the card confirms it (billing-sync
  -- keeps a cockpit edit while its item waits, 20261101m).
  UPDATE public.cockpit_billing_accounts SET
    client_status = 'Stopped', stage = 'Stopped', stage_group = 'gone', churn_date = v_left,
    paused_on = CASE WHEN v_clear THEN NULL ELSE paused_on END,
    source = v_source, synced_at = now()
  WHERE clickup_task_id = v_task;

  -- "Client has left" in #csm-announcements (20261101l). A notice that cannot
  -- be queued never undoes the confirm; the queue says why.
  BEGIN
    PERFORM public.cockpit_slack_notice_queue('churn.confirmed', 'churn:' || v_dep.id, v_task, v_acc.client_name,
      jsonb_build_object('taskId', v_task, 'client', v_acc.client_name, 'departureId', v_dep.id,
                         'reason', v_reason, 'leftOn', v_left),
      NULL, 'queued', NULL);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed('A churn notice could not be queued: ' || SQLERRM);
  END;

  INSERT INTO public.cockpit_churn_log(by_whom, what, detail)
  VALUES (v_who, 'confirmed ' || v_acc.client_name || ' leaving',
          jsonb_build_object('client', v_acc.client_name, 'departureId', v_dep.id, 'eventId', v_event,
                             'responseId', v_resp, 'leftOn', v_left, 'reason', v_reason, 'churnType', v_type));
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('churn.confirm', 'cockpit_churn_departures', v_dep.id::text, v_who,
          CASE WHEN v_ceo THEN 'media-buyer-cockpit' ELSE 'client-success-cockpit' END, 'supabase',
          CASE WHEN v_before.id IS NOT NULL THEN to_jsonb(v_before) END, to_jsonb(v_dep),
          jsonb_build_object('event_id', v_event, 'response_id', v_resp, 'request_id', v_req));

  SELECT q.state INTO v_card FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = 'billing:' || v_event;
  RETURN jsonb_build_object('departureId', v_dep.id, 'eventId', v_event, 'responseId', v_resp,
    'cardState', CASE WHEN v_card IS NULL THEN 'none' WHEN v_card = 'dry_run' THEN 'held' ELSE v_card END);
END $$;
COMMENT ON FUNCTION public.cockpit_client_lifecycle_confirm(text, jsonb) IS
  'Client is leaving / Confirm churn (contract 3.1): the CEO, or a CSM allowed on the client. Updates the card''s open departure (not removed, not confirmed, no later resume) or inserts one; records the churn_confirm response; inserts one billing event of kind churn (the card write, 20261101m); queues churn.confirmed; churn log and audit rows. A repeated requestId returns the first result.';

-- 6. "Not leaving" and "Handled" -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_form_notice_answer(p_response_id uuid, p_answer text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_who text;
  v_ceo boolean;
  v_r public.cockpit_form_responses;
  v_client text;
  v_note text := left(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), 500);
  v_role text;
  v_answered jsonb;
  v_prev_legacy text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before answering a notice.' USING ERRCODE = '42501'; END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false)) THEN
    RAISE EXCEPTION 'Answering a notice needs a client success or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = v_uid;

  SELECT * INTO v_r FROM public.cockpit_form_responses r
   WHERE r.id = p_response_id AND r.form_key IN ('exit_survey', 'pause_request') FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That notice is no longer in the cockpit. Reload the page.' USING ERRCODE = 'P0002';
  END IF;
  IF (v_r.form_key = 'exit_survey' AND p_answer IS DISTINCT FROM 'staying')
     OR (v_r.form_key = 'pause_request' AND p_answer IS DISTINCT FROM 'handled') THEN
    RAISE EXCEPTION 'A termination notice is answered with staying, a pause request with handled.' USING ERRCODE = '22023';
  END IF;
  IF v_r.task_id IS NULL THEN
    RAISE EXCEPTION 'Pick the card first, so the answer lands on the right client.' USING ERRCODE = '22023';
  END IF;
  SELECT b.client_name INTO v_client FROM public.cockpit_billing_accounts b WHERE b.clickup_task_id = v_r.task_id;
  v_client := coalesce(v_client, v_r.client_name, v_r.task_id);
  IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_client), false) THEN
    RAISE EXCEPTION '% is not one of your clients. Ask its CSM or the CEO to answer the notice.', v_client USING ERRCODE = '42501';
  END IF;
  IF v_r.answer_meta ? 'answered' THEN
    RAISE EXCEPTION 'This notice was answered on %.',
      to_char(((v_r.answer_meta->'answered'->>'at')::timestamptz AT TIME ZONE 'Asia/Kuwait')::date, 'FMDD Mon YYYY')
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) < 4 THEN
    RAISE EXCEPTION 'Say what the client said, so the answer reads back.' USING ERRCODE = '22023';
  END IF;

  v_role := CASE WHEN v_ceo THEN 'the CEO' ELSE 'the CSM' END;
  v_answered := jsonb_build_object('answer', p_answer, 'note', v_note, 'by', v_role, 'at', now());
  -- 20261101l's guard allows this one change under its 'answer' carve-out.
  v_prev_legacy := current_setting('cockpit.forms_legacy', true);
  PERFORM set_config('cockpit.forms_legacy', 'answer', true);
  UPDATE public.cockpit_form_responses
     SET answer_meta = answer_meta || jsonb_build_object('answered', v_answered)
   WHERE id = v_r.id;
  PERFORM set_config('cockpit.forms_legacy', coalesce(v_prev_legacy, ''), true);

  INSERT INTO public.cockpit_churn_log(by_whom, what, detail)
  VALUES (v_who, 'Answered the notice: ' || p_answer,
          jsonb_build_object('client', v_client, 'responseId', v_r.id, 'formKey', v_r.form_key,
                             'answer', p_answer, 'note', v_note));
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('forms.notice_answer', 'cockpit_form_responses', v_r.id::text, v_who,
          CASE WHEN v_ceo THEN 'media-buyer-cockpit' ELSE 'client-success-cockpit' END, 'supabase',
          NULL, jsonb_build_object('answered', v_answered),
          jsonb_build_object('form_key', v_r.form_key, 'task_id', v_r.task_id));
  RETURN jsonb_build_object('responseId', v_r.id, 'answer', p_answer, 'at', v_answered->'at');
END $$;
COMMENT ON FUNCTION public.cockpit_form_notice_answer(uuid, text, text) IS
  'Not leaving (staying, an exit_survey) or Handled (a pause_request): the CEO, or the CSM allowed on the response''s card. One answer per notice, a note of 4+ characters; writes answer_meta.answered (the one change a legacy row allows), a churn log row and an audit row. Nothing changes on the card.';

-- 7. The backfill door (owner only, deploy steps D-B6 and D-B7) ---------------------------

CREATE OR REPLACE FUNCTION public.cockpit_churn_backfill_confirm(p_departure_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_by constant text := 'the CEO''s word (Q5), 2026-11-01';
  v_d public.cockpit_churn_departures;
  v_after public.cockpit_churn_departures;
  v_acc public.cockpit_billing_accounts;
  v_type text; v_card_type text; v_why text; v_how constant text := 'Recorded before the confirm existed (Q5).';
  v_clear boolean; v_req uuid; v_resp uuid; v_event bigint; v_built jsonb; v_detail jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'The churn backfill runs only as the database owner, at deploy.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.cockpit_churn_departures WHERE id = p_departure_id FOR UPDATE;
  IF NOT FOUND OR v_d.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Departure % is not in the register.', p_departure_id USING ERRCODE = 'P0002';
  END IF;
  IF v_d.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Departure % was already confirmed on %.', p_departure_id,
      to_char((v_d.confirmed_at AT TIME ZONE 'Asia/Kuwait')::date, 'FMDD Mon YYYY') USING ERRCODE = '22023';
  END IF;
  IF v_d.clickup_task_id IS NULL THEN
    RAISE EXCEPTION 'Departure % has no ClickUp card; pick the card on the churn tracker first.', p_departure_id USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_d.clickup_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The card of departure % is not on the billing sheet.', p_departure_id USING ERRCODE = 'P0002';
  END IF;

  -- The type the card already carries (the CEO's hand mark of 11-01); the
  -- day-90 default only when the card's field is empty.
  SELECT s.churn_type INTO v_card_type FROM public.cockpit_client_billing_days s
   WHERE s.clickup_task_id = v_d.clickup_task_id ORDER BY s.day DESC LIMIT 1;
  v_type := coalesce(public.cockpit_churn_type_from_card(v_card_type),
                     public.cockpit_churn_type_default(v_d.clickup_task_id, v_d.left_on));
  v_why := left(coalesce(nullif(btrim(v_d.note), ''), 'Logged in the register before the confirm existed (Q5).'), 2000);
  v_clear := v_acc.paused_on IS NOT NULL;
  v_req := md5('churn_backfill:' || v_d.id)::uuid;

  v_resp := public.cockpit_form_staff_record('churn_confirm', v_d.clickup_task_id,
    jsonb_strip_nulls(jsonb_build_object('leftOn', v_d.left_on, 'reason', v_d.reason, 'churnType', v_type,
      'whyDetail', v_why, 'howToStop', v_how, 'mrrLostUsd', v_d.mrr_lost_usd, 'surveyState', v_d.survey_state)),
    v_req, 'import');

  UPDATE public.cockpit_churn_departures SET
    why_detail = v_why, how_to_stop = v_how, churn_type = v_type,
    confirmed_by = v_by, confirmed_at = now(), updated_by = v_by, updated_at = now()
  WHERE id = v_d.id RETURNING * INTO v_after;

  v_built := public.cockpit_billing_detail('churn', jsonb_build_object(
    'taskId', v_d.clickup_task_id, 'leftOn', v_d.left_on, 'reason', v_d.reason, 'churnType', v_type,
    'whyDetail', v_why, 'howToStop', v_how, 'surveyState', v_d.survey_state,
    'departureId', v_d.id, 'responseId', v_resp, 'requestId', v_req, 'seatRole', 'ceo',
    'clearPaused', v_clear, 'cardType', public.cockpit_churn_type_card(v_type)));
  v_detail := jsonb_build_object(
    'left_on', v_d.left_on, 'card_reason', public.cockpit_churn_reason_card(v_d.reason),
    'card_type', public.cockpit_churn_type_card(v_type), 'clear_paused', v_clear,
    'departure_id', v_d.id, 'response_id', v_resp, 'request_id', v_req, 'seat_role', 'ceo',
    'why_detail', v_why, 'notice_on', v_d.notice_on, 'survey_state', v_d.survey_state, 'churn_type', v_type,
    'backfill', true)
    || jsonb_strip_nulls(coalesce(v_built, '{}'::jsonb));

  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (v_d.clickup_task_id, v_acc.client_name, 'churn', v_acc.client_status, 'Stopped', v_d.reason, v_detail, 'ceo', v_by)
  RETURNING id INTO v_event;
  UPDATE public.cockpit_churn_departures SET billing_event_id = v_event WHERE id = v_d.id RETURNING * INTO v_after;
  UPDATE public.cockpit_billing_accounts SET
    client_status = 'Stopped', stage = 'Stopped', stage_group = 'gone', churn_date = v_d.left_on,
    paused_on = CASE WHEN v_clear THEN NULL ELSE paused_on END, source = 'ceo', synced_at = now()
  WHERE clickup_task_id = v_d.clickup_task_id;

  -- No notice: a month-old departure is not announced (as the survey backfill).
  INSERT INTO public.cockpit_churn_log(by_whom, what, detail)
  VALUES (v_by, 'confirmed ' || v_d.client || ' leaving (backfill)',
          jsonb_build_object('client', v_d.client, 'departureId', v_d.id, 'eventId', v_event, 'responseId', v_resp,
                             'leftOn', v_d.left_on, 'reason', v_d.reason, 'churnType', v_type, 'cardType', v_card_type));
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('churn.backfill_confirm', 'cockpit_churn_departures', v_d.id::text, v_by, 'migration 20261101o', 'supabase',
          to_jsonb(v_d), to_jsonb(v_after), jsonb_build_object('event_id', v_event, 'response_id', v_resp));
  RETURN v_event;
END $$;
COMMENT ON FUNCTION public.cockpit_churn_backfill_confirm(bigint) IS
  'Deploy only (D-B6, D-B7): confirms one register row on the CEO''s word (Q5). The type is the card''s own Churn Type (the latest snapshot), the day-90 default only when the card has none; the response is recorded with source import; event source ceo; Paused On cleared when the mirror shows one. Refuses a confirmed row. No notice.';

-- 8. The lifecycle view and its read ---------------------------------------------------------

-- One row per mirrored card (3.2). Until 20261101p lands, extension_until is
-- the newest grant's end from the billing events, days_late the card's own
-- date (an Active card whose Next Payment Date has passed) and the ladder's
-- days are the billing.ladder setting, or the contract's 4 and 15 while it is
-- absent.
CREATE OR REPLACE VIEW public.cockpit_client_lifecycle_v WITH (security_invoker = true) AS
WITH k AS (SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date AS today),
ladder AS (
  SELECT coalesce((SELECT (s.value->>'pauseReviewDay')::integer FROM public.cockpit_settings s
                    WHERE s.key = 'billing.ladder' AND s.value->>'pauseReviewDay' ~ '^[0-9]{1,2}$'), 4) AS pause_day,
         coalesce((SELECT (s.value->>'cancelReviewDay')::integer FROM public.cockpit_settings s
                    WHERE s.key = 'billing.ladder' AND s.value->>'cancelReviewDay' ~ '^[0-9]{1,2}$'), 15) AS cancel_day
),
ev AS (
  SELECT e.* FROM public.cockpit_billing_events e
   WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id)
)
SELECT
  b.clickup_task_id,
  b.client_name,
  b.client_status,
  b.paused_on,
  p.id AS pause_event_id,
  CASE WHEN p.detail->>'pause_kind' IN ('client_request', 'non_payment') THEN p.detail->>'pause_kind' END AS pause_kind,
  CASE WHEN p.detail->>'restart' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p.detail->>'restart')::date END AS pause_restart,
  CASE WHEN b.client_status = 'Paused' AND b.paused_on IS NOT NULL THEN k.today - b.paused_on END AS pause_days,
  CASE WHEN x.until >= k.today THEN x.until END AS extension_until,
  d.id AS departure_id,
  d.left_on,
  d.confirmed_at AS churn_confirmed_at,
  d.survey_state,
  late.days_late,
  CASE
    WHEN b.client_status = 'Paused' AND b.paused_on IS NOT NULL AND k.today - b.paused_on >= 14 THEN 'pause_day14'
    -- A live extension holds both reviews (cockpit_billing_ladder_due says the same).
    WHEN x.until >= k.today THEN 'none'
    WHEN late.days_late >= ladder.cancel_day THEN 'cancel_review'
    WHEN late.days_late >= ladder.pause_day THEN 'pause_review'
    ELSE 'none'
  END AS ladder_step
FROM public.cockpit_billing_accounts b
CROSS JOIN k
CROSS JOIN ladder
LEFT JOIN LATERAL (
  SELECT e.id, e.detail FROM ev e
   WHERE e.clickup_task_id = b.clickup_task_id AND e.kind = 'pause' AND b.client_status = 'Paused'
     AND NOT EXISTS (SELECT 1 FROM ev r WHERE r.clickup_task_id = e.clickup_task_id AND r.kind = 'resume' AND r.at > e.at)
   ORDER BY e.at DESC, e.id DESC LIMIT 1
) p ON true
LEFT JOIN LATERAL (
  SELECT CASE
           WHEN e.detail->>'new_date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (e.detail->>'new_date')::date
           WHEN e.detail->'movedDate' = 'true'::jsonb AND e.to_value ~ '^\d{4}-\d{2}-\d{2}$' THEN e.to_value::date
           ELSE (e.at AT TIME ZONE 'Asia/Kuwait')::date + (e.detail->>'weeks')::integer * 7
         END AS until
    FROM ev e
   WHERE e.clickup_task_id = b.clickup_task_id AND e.kind = 'extension'
     AND e.source IN ('ceo', 'csm', 'maher') AND e.detail->>'weeks' IN ('1', '2', '4')
   ORDER BY e.at DESC, e.id DESC LIMIT 1
) x ON true
LEFT JOIN LATERAL (
  SELECT dd.id, dd.left_on, dd.confirmed_at, dd.survey_state FROM public.cockpit_churn_departures dd
   WHERE dd.clickup_task_id = b.clickup_task_id AND dd.removed_at IS NULL
   ORDER BY dd.left_on DESC, dd.id DESC LIMIT 1
) d ON true
LEFT JOIN LATERAL (
  SELECT CASE WHEN b.client_status = 'Active' AND b.next_payment_date < k.today
              THEN k.today - b.next_payment_date END AS days_late
) late ON true;
COMMENT ON VIEW public.cockpit_client_lifecycle_v IS
  'One row per mirrored card: pause (event, kind, Resume On, days), a live extension''s end, the latest departure and its confirm, the days late on the card''s own date and the ladder step. NULL means nobody holds that value, never zero. Browser reads go through cockpit_client_lifecycle_read.';

CREATE OR REPLACE FUNCTION public.cockpit_client_lifecycle_read(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row jsonb; v_name text; v_ceo boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to read a client.' USING ERRCODE = '42501'; END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false) OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'A client''s lifecycle needs a client success, finance or CEO seat.' USING ERRCODE = '42501';
  END IF;
  SELECT client_name INTO v_name FROM public.cockpit_billing_accounts WHERE clickup_task_id = p_task_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_name), false) THEN
    RAISE EXCEPTION '% is not one of your clients.', v_name USING ERRCODE = '42501';
  END IF;
  SELECT to_jsonb(v) INTO v_row FROM public.cockpit_client_lifecycle_v v WHERE v.clickup_task_id = p_task_id;
  RETURN v_row || jsonb_build_object('events', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'at', e.at,
             'seatRole', CASE coalesce(e.detail->>'seat_role', e.source)
               WHEN 'ceo' THEN 'the CEO' WHEN 'csm' THEN 'the CSM' WHEN 'finance' THEN 'finance'
               WHEN 'maher' THEN 'the billing agent' WHEN 'clickup' THEN 'ClickUp' WHEN 'system' THEN 'the cockpit'
               -- 20261101p's money acts store the words themselves.
               WHEN 'the CEO' THEN 'the CEO' WHEN 'the CSM' THEN 'the CSM'
               ELSE 'the cockpit' END,
             'voided', EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids vv WHERE vv.event_id = e.id))
           ORDER BY e.at DESC, e.id DESC)
      FROM (SELECT * FROM public.cockpit_billing_events ee WHERE ee.clickup_task_id = p_task_id
             ORDER BY ee.at DESC, ee.id DESC LIMIT 5) e), '[]'::jsonb));
END $$;
COMMENT ON FUNCTION public.cockpit_client_lifecycle_read(text) IS
  'One allowed card''s cockpit_client_lifecycle_v row plus its latest five billing events (kind, time, seat role: never an email). The CEO, or a CSM or finance seat allowed on the client.';

-- 9. The churn tracker's read ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_csm_churn_read() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid; today date := (now() AT TIME ZONE 'Asia/Kuwait')::date; mon text; src jsonb; roster jsonb; starts jsonb;
  v_in jsonb; v_notices jsonb; v_unmatched jsonb; v_stopped jsonb;
BEGIN
  uid := public.cockpit_csm_actor(); mon := to_char(today, 'YYYY-MM');
  src := public.cockpit_csm_source_read()->'tables';
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', c->>'taskId', 'name', c->>'name', 'stage', coalesce(c->>'stage', ''),
    'launchedOn', c->>'launchDate', 'csm', c->>'csmAssigned', 'pausedSince', c->>'pausedSince', 'pausedDays', c->'pausedDays')), '[]')
    INTO roster FROM jsonb_array_elements(src->'clients') c;
  SELECT coalesce(jsonb_agg(jsonb_build_object('month', months.mon, 'day', r.data->>'day', 'paying', r.data->'paying') ORDER BY months.mon), '[]')
    INTO starts
    FROM (SELECT to_char(generate_series(date_trunc('month', today) - interval '3 months', date_trunc('month', today), interval '1 month'), 'YYYY-MM') mon) months
    LEFT JOIN LATERAL (SELECT d AS data FROM jsonb_array_elements(src->'rosterDays') d WHERE d->>'month' = months.mon ORDER BY d->>'day' LIMIT 1) r ON true;

  -- The derived notice rows (20261101l): its own scope rules, so a CSM sees
  -- matched notices of their clients and every unmatched one (W22).
  v_in := coalesce(public.cockpit_form_notices_in(), '[]'::jsonb);
  SELECT coalesce(jsonb_agg(n || jsonb_build_object(
           'ratings', public.cockpit_churn_survey_ratings(r.answers),
           'typeDefault', public.cockpit_churn_type_default(n->>'taskId', today))
         ORDER BY n->>'submittedAt' DESC), '[]')
    INTO v_notices
    FROM jsonb_array_elements(v_in) n
    LEFT JOIN public.cockpit_form_responses r ON r.id::text = n->>'responseId'
   WHERE n->>'kind' = 'termination' AND (n->>'matched')::boolean IS TRUE;
  SELECT coalesce(jsonb_agg(n ORDER BY n->>'submittedAt' DESC), '[]')
    INTO v_unmatched
    FROM jsonb_array_elements(v_in) n
   WHERE n->>'kind' = 'termination' AND (n->>'matched')::boolean IS NOT TRUE;

  -- Stopped on the card with no departure in the register: a review list,
  -- never a bulk write (Q5). stoppedSince is NULL when every snapshot of the
  -- card reads Stopped, so the day it stopped is not known.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'taskId', b.clickup_task_id, 'clientName', b.client_name, 'churnDate', b.churn_date,
           'mrrUsd', b.mrr_usd, 'csm', b.csm,
           'stoppedSince', (SELECT min(s.day) FROM public.cockpit_client_billing_days s
                             WHERE s.clickup_task_id = b.clickup_task_id AND s.stage = 'Stopped'
                               AND s.day > (SELECT max(o.day) FROM public.cockpit_client_billing_days o
                                             WHERE o.clickup_task_id = b.clickup_task_id AND o.stage IS DISTINCT FROM 'Stopped')),
           'typeDefault', public.cockpit_churn_type_default(b.clickup_task_id, coalesce(b.churn_date, today)))
         ORDER BY b.churn_date DESC NULLS LAST, b.client_name), '[]')
    INTO v_stopped
    FROM public.cockpit_billing_accounts b
   WHERE b.client_status = 'Stopped'
     AND public.cockpit_client_allowed(b.client_name)
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_churn_departures d
                      WHERE d.clickup_task_id = b.clickup_task_id AND d.removed_at IS NULL);

  RETURN jsonb_build_object('today', today, 'month', mon,
    'me', jsonb_build_object('email', (SELECT email FROM auth.users WHERE id = uid), 'isCeo', public.cockpit_is_ceo(),
                             'isAdmin', public.cockpit_has_role('admin')),
    'deps', coalesce((SELECT jsonb_agg(to_jsonb(d) || jsonb_build_object(
               'confirmed_role', CASE WHEN d.confirmed_at IS NULL THEN NULL
                                      WHEN d.confirmed_by LIKE 'the CEO%' THEN 'the CEO'
                                      ELSE coalesce(public.cockpit_slack_notice_role_of(d.confirmed_by), 'a team member') END,
               'card_state', CASE WHEN d.billing_event_id IS NULL THEN NULL
                                  ELSE coalesce((SELECT CASE q.state WHEN 'dry_run' THEN 'held' ELSE q.state END
                                                   FROM public.cockpit_clickup_writeback_queue q
                                                  WHERE q.dedupe_key = 'billing:' || d.billing_event_id), 'none') END,
               'card_error', (SELECT left(q.error, 240) FROM public.cockpit_clickup_writeback_queue q
                               WHERE q.dedupe_key = 'billing:' || d.billing_event_id AND q.state IN ('failed', 'skipped')),
               'churn_type_default', CASE WHEN d.clickup_task_id IS NOT NULL
                                          THEN public.cockpit_churn_type_default(d.clickup_task_id, d.left_on) END)
             ORDER BY left_on DESC, id DESC)
             FROM public.cockpit_churn_departures d WHERE removed_at IS NULL AND public.cockpit_client_allowed(client)), '[]'),
    'monthRows', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY month) FROM public.cockpit_churn_months m WHERE public.cockpit_csm_scope_all()), '[]'),
    'cards', coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM public.cockpit_billing_accounts b WHERE public.cockpit_client_allowed(client_name)), '[]'),
    'log', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY at DESC) FROM public.cockpit_churn_log l
                      WHERE public.cockpit_csm_scope_all() OR public.cockpit_client_allowed(coalesce(detail->>'client', detail->'after'->>'client', detail->'before'->>'client'))), '[]'),
    'roster', jsonb_build_object('cards', roster, 'starts', starts,
      'left', coalesce((SELECT jsonb_agg(jsonb_build_object('key', e->>'key', 'name', e->>'name', 'day', e->>'day', 'to', coalesce(e->>'to', e->>'kind')))
                          FROM jsonb_array_elements(src->'churnEvents') e
                         WHERE e->>'kind' IN ('lost', 'removed', 'offboarded') AND e->>'month' >= to_char(today - interval '3 months', 'YYYY-MM')), '[]')),
    'notices', v_notices,
    'unmatched', v_unmatched,
    'stoppedNotInRegister', v_stopped);
END $$;

-- 10. The doors -------------------------------------------------------------------------------

INSERT INTO public.cockpit_settings(key, value, updated_by)
VALUES ('forms.doors', '{"churn":true}'::jsonb, 'migration 20261101o')
ON CONFLICT (key) DO UPDATE
   SET value = CASE WHEN jsonb_typeof(public.cockpit_settings.value) = 'object'
                    THEN public.cockpit_settings.value ELSE '{}'::jsonb END || '{"churn":true}'::jsonb,
       updated_by = 'migration 20261101o', updated_at = now()
 WHERE NOT (public.cockpit_settings.value @> '{"churn":true}'::jsonb);

-- 10b. The billing log, scoped by client ----------------------------------------------------
--
-- From here on cockpit_billing_events.detail holds a form's free text (why a client left, how to
-- stop it; from 20261101p also why more time was given, what would prevent it, at-risk, a pause's
-- consent). The read RPCs scope it by client (cockpit_billing_reader_ok); the table's own seat
-- policy let any active seat read every client's rows. This restrictive policy holds a direct read
-- to the same rule: the CEO, finance, or a CSM on their own client (the sheet's fetch already
-- filters by the CSM's clients, so its rows do not change). The balance-kinds policy stays as it is.
DO $rls$
BEGIN
  IF to_regclass('public.cockpit_billing_events') IS NULL THEN RETURN; END IF;
  EXECUTE 'DROP POLICY IF EXISTS cockpit_billing_events_client_scope ON public.cockpit_billing_events';
  EXECUTE $p$CREATE POLICY cockpit_billing_events_client_scope ON public.cockpit_billing_events
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING ((SELECT public.cockpit_is_ceo()) OR (SELECT public.cockpit_has_role('finance'))
           OR ((SELECT public.cockpit_has_role('csm')) AND public.cockpit_client_allowed(client_name)))$p$;
END $rls$;

-- 11. Privileges ------------------------------------------------------------------------------

REVOKE ALL ON public.cockpit_client_lifecycle_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_client_lifecycle_v TO service_role;

REVOKE ALL ON FUNCTION
  public.cockpit_churn_type_card(text),
  public.cockpit_churn_type_from_card(text),
  public.cockpit_churn_type_default(text, date),
  public.cockpit_churn_survey_ratings(jsonb),
  public.cockpit_client_lifecycle_confirm(text, jsonb),
  public.cockpit_form_notice_answer(uuid, text, text),
  public.cockpit_churn_backfill_confirm(bigint),
  public.cockpit_client_lifecycle_read(text),
  public.cockpit_csm_churn_read()
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_client_lifecycle_confirm(text, jsonb),
  public.cockpit_form_notice_answer(uuid, text, text),
  public.cockpit_client_lifecycle_read(text),
  public.cockpit_csm_churn_read()
TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
