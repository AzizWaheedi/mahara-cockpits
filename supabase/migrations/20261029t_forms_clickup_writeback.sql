-- The ClickUp writer's 1-1 notes lane (docs/forms/STAGE2B-CONTRACT.md 2.4,
-- 3.3 and build 1). Creative Triage (bldgtotkfmhoxmlzowdx). Additive;
-- applies twice. Migration t of the 2b block, after 20261029s_forms_registry.
--
-- A check-in effect the cockpit owns becomes one cockpit_clickup_writeback_queue
-- row of the new kind 'form' (20261029w writes it). This file gives that kind
-- its own path through clickup-writeback job 'forms', apart from the log and
-- the requests:
--
-- 1. The queue takes kind 'form' and the runs take job 'forms'.
-- 2. The live log claim never takes a form row (it would settle it skipped),
--    the release hands a held form row back without counting a try, and begin
--    and idle know the job. Nothing else in those four bodies changes.
-- 3. cockpit_clickup_writeback_claim_forms: one lane per client card, the
--    rows of one response together in Make's order (the comment first, then
--    Client Happiness and the two dates), only what the writer would send now
--    by the mode it last reported (cockpit_clickup_forms_mode), and every row
--    asked of the owner gate (cockpit_form_effect_gate, 20261029s) first: a
--    row the gate refuses is settled in the same call and never reaches the
--    writer. The gate is asked of every open form row in every mode, dry_run
--    included, so a rollback settles them. A kept row carries its effect's
--    plan without the browser lines, because the comment text lives only in
--    the effect plan (Z6) and is frozen in the queue row's steps column
--    before the first write.
-- 4. The mode mirror, the state row, the doctor's inputs and a minute kick
--    that posts a forms run only when the claim could take a row now and the
--    writer is live, when an open row the owner gate refuses waits to be
--    settled, or when its last report is older than ten minutes, and never
--    while another forms run is still writing (one run at a time keeps the
--    job's pace).
--
-- Nothing here makes a form row; while the registry's checkin effects are
-- shadow none can exist, and the writer stays a dry run until
-- CLICKUP_WRITEBACK_APPLY_FORMS is exactly "true" (2b section 1.4).
--
-- Every new or replaced function is revoked from all four roles, then granted
-- exactly as 2.4 says. Each replaced body is checked first against the body
-- the 2b contract read (the drift guard, 2.1 and Z61). pg_cron, pg_net and the
-- vault are touched only where they exist, so PGlite applies the file.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: each body this file replaces is the one the contract read
--    (2.2's live body md5) or the one this file installs (a second apply).

DO $$
DECLARE f record; v_md5 text;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('cockpit_clickup_writeback_claim(uuid,integer)', '39c142839f9d669354e9b0d0b6079842', '2a3313b36fb6e0b4b86d1312ea922697'),
    ('cockpit_clickup_writeback_release(uuid,uuid,jsonb,text,timestamptz)', '7329848a1ef67391a962c68b5ef67fd3', '19526fc6726c6273b180cfedf527e1b7'),
    ('cockpit_clickup_writeback_begin(text,text,boolean)', '29906b33362f9cbcacd591e70071c0fa', '4d649b297933116a4bf1e5a954bf552a'),
    ('cockpit_clickup_writeback_idle(text,boolean,text)', 'e67840b5b981fe6fc5eca237a351c55c', '08b5e5a296dfa7f00c0d6da422f4cd54')
  ) AS x(sig, live, after) LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_md5
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.' || f.sig);
    IF v_md5 IS NULL OR v_md5 NOT IN (f.live, f.after) THEN
      RAISE EXCEPTION '% changed since the 2b contract read it; stop and re-read it.', 'public.' || f.sig
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The queue takes 1-1 notes rows and the runs take the forms job

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.cockpit_clickup_writeback_queue'::regclass
                    AND c.conname = 'cockpit_clickup_writeback_queue_kind_check'
                    AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%''form''%') THEN
    ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_queue_kind_check;
    ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
      CHECK (kind IN ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action','form'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.cockpit_clickup_writeback_runs'::regclass
                    AND c.conname = 'cockpit_clickup_writeback_runs_job_check'
                    AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%''forms''%') THEN
    ALTER TABLE public.cockpit_clickup_writeback_runs DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_runs_job_check;
    ALTER TABLE public.cockpit_clickup_writeback_runs ADD CONSTRAINT cockpit_clickup_writeback_runs_job_check
      CHECK (job IN ('kpi','log','dosdonts','requests','forms'));
  END IF;
END $$;

-- One lane per card: the claim's wait reads the open form rows of a card.
CREATE INDEX IF NOT EXISTS cockpit_clickup_writeback_form_lane ON public.cockpit_clickup_writeback_queue (task_id, created_at)
  WHERE kind = 'form' AND state IN ('queued','sending','retry','unknown');

-- ---------------------------------------------------------------------------
-- 2. The four live bodies (20261026r_requests.sql) with 'forms' added to the
--    job lists and 'form' to the kinds; nothing else changes.

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_begin(p_job text, p_mode text, p_exclusive boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.cockpit_clickup_writeback_runs;
BEGIN
 IF p_job NOT IN('kpi','log','dosdonts','requests','forms') OR p_mode NOT IN('dry_run','apply','apply_limited') THEN RAISE EXCEPTION 'Unsupported writeback run'; END IF;
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
 IF p_job NOT IN('kpi','log','dosdonts','requests','forms') THEN RETURN; END IF;
 PERFORM public.cockpit_clickup_writeback_state('clickup-writeback:'||p_job,p_ok,p_note,CASE WHEN p_ok THEN 0 END);
END $function$;

-- The live claim with one change: it never takes a 1-1 notes row either, so
-- the deployed log job never settles one skipped.
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
    AND q.kind NOT IN ('request','task_action','form')
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

-- The live release with one change: a 1-1 notes row is handed back too,
-- queued, or retry once its steps hold anything, the claim's try taken off.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_release(p_id uuid, p_token uuid, p_planned jsonb, p_note text,
  p_next_attempt_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q public.cockpit_clickup_writeback_queue; v_state text;
BEGIN
  SELECT * INTO q FROM public.cockpit_clickup_writeback_queue WHERE id = p_id FOR UPDATE;
  IF q.id IS NULL OR q.state <> 'sending' OR p_token IS NULL OR q.claim_token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'This queue item is no longer claimed by this run';
  END IF;
  IF q.kind NOT IN ('request','task_action','form') THEN
    RAISE EXCEPTION 'Only a request or a task change is handed back this way';
  END IF;
  v_state := CASE WHEN q.kind = 'request' AND q.task_id IS NULL AND q.progress->'task'->>'id' IS NULL
                    AND jsonb_typeof(q.progress->'steps') = 'object' AND q.progress->'steps' ? 'create'
                  THEN 'unknown'
                  WHEN q.kind = 'form'
                  THEN CASE WHEN jsonb_typeof(q.progress->'steps') = 'object' AND q.progress->'steps' <> '{}'::jsonb
                            THEN 'retry' ELSE 'queued' END
                  WHEN q.progress ? 'task'
                    OR (jsonb_typeof(q.progress->'steps') = 'object' AND q.progress->'steps' <> '{}'::jsonb)
                    OR (jsonb_typeof(q.progress->'steps') = 'array' AND jsonb_array_length(q.progress->'steps') > 0)
                  THEN 'retry' ELSE 'queued' END;
  UPDATE public.cockpit_clickup_writeback_queue SET
    state = v_state,
    attempts = greatest(q.attempts - 1, 0),
    claim_token = NULL,
    claimed_at = NULL,
    planned = CASE WHEN jsonb_typeof(p_planned) = 'array' THEN p_planned ELSE planned END,
    error = CASE WHEN p_note IS NULL THEN error ELSE left(p_note, 500) END,
    next_attempt_at = coalesce(p_next_attempt_at, now()),
    updated_at = now()
   WHERE id = p_id RETURNING * INTO q;
  RETURN jsonb_build_object('id', q.id, 'state', q.state);
END $$;

-- ---------------------------------------------------------------------------
-- 3. The forms job's mode, state, claim, doctor inputs and kick

-- The forms writer's mode, from its last report (the requests mirror,
-- 20261026r cockpit_clickup_requests_mode, with its own key). Older than 15
-- minutes or never reported: unknown, so the claim takes nothing.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_forms_mode()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.cockpit_sync_state; v_at timestamptz; v_mode text; v_cards jsonb; v_last text;
BEGIN
  SELECT * INTO s FROM public.cockpit_sync_state WHERE key = 'clickup-writeback:forms';
  BEGIN
    v_at := coalesce((s.detail->>'at')::timestamptz, s.last_run_at);
  EXCEPTION WHEN others THEN
    v_at := s.last_run_at;
  END;
  v_mode := s.detail->>'mode';
  v_last := CASE WHEN v_mode IN ('dry_run','apply','apply_limited') THEN v_mode END;
  v_cards := CASE WHEN jsonb_typeof(s.detail->'onlyCards') = 'array' THEN s.detail->'onlyCards' ELSE '[]'::jsonb END;
  IF s.key IS NULL OR v_at IS NULL OR v_at < now() - interval '15 minutes'
     OR coalesce(v_mode, '') NOT IN ('dry_run','apply','apply_limited') THEN
    RETURN jsonb_build_object('mode', 'unknown', 'onlyCards', v_cards, 'at', v_at, 'live', false, 'lastMode', v_last);
  END IF;
  RETURN jsonb_build_object('mode', v_mode, 'onlyCards', v_cards, 'at', v_at, 'live', v_mode IN ('apply','apply_limited'),
    'lastMode', v_last);
END $$;

-- Every run of the forms job reports its mode, canary cards and counts here
-- (clickup-writeback:forms, 3.11); the claim and the kick read it back.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_forms_state(p_ok boolean, p_note text, p_mode text, p_only_cards text[], p_counts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF coalesce(p_mode, '') NOT IN ('dry_run','apply','apply_limited') THEN
    RAISE EXCEPTION 'Unsupported 1-1 notes writer mode' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_sync_state AS s(key, last_run_at, last_ok_at, ok, note, detail, updated_at)
  VALUES ('clickup-writeback:forms', now(), CASE WHEN p_ok THEN now() END, coalesce(p_ok, false), left(p_note, 500),
    jsonb_build_object('mode', p_mode, 'onlyCards', to_jsonb(coalesce(p_only_cards, '{}'::text[])),
      'counts', CASE WHEN jsonb_typeof(p_counts) = 'object' THEN p_counts ELSE '{}'::jsonb END, 'at', now()),
    now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_ok_at = coalesce(EXCLUDED.last_ok_at, s.last_ok_at),
    ok = EXCLUDED.ok, note = EXCLUDED.note, detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at;
END $$;

-- The forms job's claim (4.1). Only form rows, only while the writer last
-- reported apply or apply_limited (in apply_limited only the canary cards'
-- rows), one lane per card: a row waits while another form row on its card is
-- freshly sending, or is open, older and from another response, so one
-- response's rows go together and an older call's dates land first. Each
-- claimed row then asks the owner gate (3.1); a refusal settles the row here,
-- skipped with the gate's reason, or failed when the effect was unknown and
-- Make owns it again (an earlier try may have reached the card). The kept
-- rows come back in claim order with {effect: {id, state, plan}}, the plan
-- without its browser lines.
--
-- Before the mode check, in every mode, the gate is asked for every open form
-- row (queued, retry, unknown, or sending for more than ten minutes; any card,
-- due or not) and each refusal is settled the same way (review round 3). A
-- rollback past cut-over step 7b turns the writer back to dry_run, so without
-- this pass its rows (the other cards' rows held during the canary, rows in
-- retry or unknown backoff) would stay queued and reach the writer at a later
-- cut-over, writing an old call's comment and Client Happiness on a real card.
-- The kick posts a run within a minute while any such row is open. A row
-- whose progress holds a started step (a run that stopped mid-write) or a done
-- one (the write was read back, then the run stopped before settling the row)
-- is failed with the check-the-card sentence as an unknown effect is: its write
-- may have landed, so the trail never says nothing was written. A step booked
-- unchanged or skipped wrote nothing. A freshly sending row belongs to the run
-- writing it.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_claim_forms(p_token uuid, p_limit integer DEFAULT 8)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_mode jsonb;
  v_ids uuid[];
  v_id uuid;
  c public.cockpit_clickup_writeback_queue;
  g jsonb;
  v_reason text;
  v_landed boolean;
  v_effect jsonb;
  v_out jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_token IS NULL THEN RAISE EXCEPTION 'A claim token is required'; END IF;
  FOR c IN
    SELECT q.* FROM public.cockpit_clickup_writeback_queue q
     WHERE q.kind = 'form'
       AND (q.state IN ('queued','retry','unknown')
         OR (q.state = 'sending' AND q.claimed_at < now() - interval '10 minutes'))
     ORDER BY q.created_at, q.id
     FOR UPDATE SKIP LOCKED
  LOOP
    g := public.cockpit_form_effect_gate('clickup_queue', c.id::text);
    CONTINUE WHEN coalesce((g->>'ok')::boolean, false);
    v_reason := coalesce(nullif(btrim(g->>'reason'), ''), 'Make owns this again.');
    v_landed := v_reason = 'Make owns this again.'
      AND (g->>'effectState' = 'unknown'
        OR pg_catalog.jsonb_path_exists(coalesce(c.progress, '{}'::jsonb), '$.steps.* ? (@.state == "started" || @.state == "done")'));
    UPDATE public.cockpit_clickup_writeback_queue SET
      state = CASE WHEN v_landed THEN 'failed' ELSE 'skipped' END,
      error = CASE WHEN v_landed
                   THEN 'Make owns this again. An earlier try may have reached the card, so check it in ClickUp.'
                   ELSE left(v_reason, 500) END,
      claim_token = NULL,
      claimed_at = NULL,
      updated_at = now()
     WHERE id = c.id;
  END LOOP;
  v_mode := public.cockpit_clickup_forms_mode();
  IF coalesce(v_mode->>'mode', 'unknown') NOT IN ('apply','apply_limited') THEN RETURN '[]'::jsonb; END IF;
  WITH picked AS (
    SELECT q.id FROM public.cockpit_clickup_writeback_queue q
     WHERE q.kind = 'form'
       AND (v_mode->>'mode' = 'apply'
            OR (q.task_id IS NOT NULL AND coalesce(v_mode->'onlyCards', '[]'::jsonb) ? q.task_id))
       AND ((q.state IN ('queued','retry','unknown') AND q.next_attempt_at <= now())
         OR (q.state = 'sending' AND q.claimed_at < now() - interval '10 minutes'))
       AND NOT EXISTS (
             SELECT 1 FROM public.cockpit_clickup_writeback_queue o
              WHERE o.kind = 'form' AND o.task_id = q.task_id AND o.id <> q.id
                AND ((o.state = 'sending' AND o.claimed_at >= now() - interval '10 minutes')
                  OR (o.state IN ('queued','sending','retry','unknown')
                      AND o.payload->>'responseId' IS DISTINCT FROM q.payload->>'responseId'
                      AND (o.created_at < q.created_at OR (o.created_at = q.created_at AND o.id < q.id)))))
     ORDER BY q.created_at,
              array_position(ARRAY['todo_comment','happiness','last_poc','last_checkin_call'], q.payload->>'effectKey'),
              q.id
     LIMIT greatest(1, least(coalesce(p_limit, 8), 12))
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.cockpit_clickup_writeback_queue q
       SET state = 'sending', claim_token = p_token, claimed_at = now(), attempts = q.attempts + 1, updated_at = now()
      FROM picked WHERE q.id = picked.id
    RETURNING q.id, q.created_at, q.payload
  )
  SELECT coalesce(array_agg(cl.id ORDER BY cl.created_at,
           array_position(ARRAY['todo_comment','happiness','last_poc','last_checkin_call'], cl.payload->>'effectKey'), cl.id),
         '{}'::uuid[])
    INTO v_ids FROM claimed cl;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO c FROM public.cockpit_clickup_writeback_queue WHERE id = v_id;
    g := public.cockpit_form_effect_gate('clickup_queue', c.id::text);
    IF coalesce((g->>'ok')::boolean, false) THEN
      SELECT jsonb_build_object('id', e.id, 'state', e.state, 'plan', e.plan - 'lines') INTO v_effect
        FROM public.cockpit_form_effects e WHERE e.id = (g->>'effectId')::uuid;
      v_out := v_out || jsonb_build_array(to_jsonb(c) || jsonb_build_object('effect', v_effect));
    ELSE
      v_reason := coalesce(nullif(btrim(g->>'reason'), ''), 'Make owns this again.');
      v_landed := v_reason = 'Make owns this again.'
        AND (g->>'effectState' = 'unknown'
          OR pg_catalog.jsonb_path_exists(coalesce(c.progress, '{}'::jsonb), '$.steps.* ? (@.state == "started" || @.state == "done")'));
      UPDATE public.cockpit_clickup_writeback_queue SET
        state = CASE WHEN v_landed THEN 'failed' ELSE 'skipped' END,
        error = CASE WHEN v_landed
                     THEN 'Make owns this again. An earlier try may have reached the card, so check it in ClickUp.'
                     ELSE left(v_reason, 500) END,
        claim_token = NULL,
        claimed_at = NULL,
        updated_at = now()
       WHERE id = c.id;
    END IF;
    v_effect := NULL;
  END LOOP;
  RETURN v_out;
END $$;

-- What the forms doctor checks against ClickUp (4.1): the form rows by state,
-- the oldest due and the stuck sending, the six Client Happiness option ids
-- the planner writes (cockpit_form_happiness_option, 20261027h), the three
-- field ids, the registry owners of the four ClickUp effects and the mode.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_forms_doctor_inputs()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  RETURN jsonb_build_object(
    'queue', (SELECT coalesce(jsonb_object_agg(s.state, s.n), '{}'::jsonb)
                FROM (SELECT q.state, count(*) AS n FROM public.cockpit_clickup_writeback_queue q
                       WHERE q.kind = 'form' GROUP BY q.state) s),
    'oldestDue', (SELECT min(q.next_attempt_at) FROM public.cockpit_clickup_writeback_queue q
                   WHERE q.kind = 'form' AND q.state IN ('queued','retry','unknown')),
    'stuckSending', (SELECT count(*) FROM public.cockpit_clickup_writeback_queue q
                      WHERE q.kind = 'form' AND q.state = 'sending' AND q.claimed_at < now() - interval '10 minutes'),
    'happinessOptions', (SELECT jsonb_agg(jsonb_build_object('label', u.label, 'optionId', public.cockpit_form_happiness_option(u.label))
                                          ORDER BY u.n)
                           FROM unnest(ARRAY['Paused','At Risk','Neutral','Happy','Very Happy (testimonial)','Churned'])
                                WITH ORDINALITY AS u(label, n)),
    'fields', jsonb_build_object('happiness', '4e3924e3-4898-4e98-aca1-cc1ac3015b73',
                                 'lastPoc', 'e183f2ce-8b7a-491a-b160-2287a247758b',
                                 'lastCheckinCall', '032203ad-e327-4d76-a0ce-c07496da6486'),
    'owners', (SELECT coalesce(jsonb_object_agg(e->>'key', e->>'owner'), '{}'::jsonb)
                 FROM public.cockpit_forms f, jsonb_array_elements(f.effects) e
                WHERE f.key = 'checkin' AND e->>'delivery' = 'clickup_queue'),
    'mode', public.cockpit_clickup_forms_mode());
END $$;

-- The minute kick (the requests kick, 20261026r, with its own rule): it posts
-- a forms run only when a form row is due and the writer last reported a live
-- mode (in apply_limited, a canary card's row), or when the writer's last
-- report is older than ten minutes, so an idle writer still reports its mode
-- every ten minutes without 1,440 posts a day. It posts nothing while a forms
-- run that started under 4 minutes ago is still open: the writer's pace
-- (CLICKUP_FORMS_CALLS_PER_MINUTE) belongs to one run, a run of 8 rows at 10
-- calls a minute sends for about two minutes, and a second run beside it
-- would double the job's calls on the ClickUp token every caller shares
-- (review round 2; the run's exclusive begin closes the same door). A run
-- still open after 4 minutes stopped without reporting back (a live run ends
-- by about 150 seconds), so the kick no longer waits on it. Every minute it
-- writes clickup-writeback:forms-kick, so a stopped cron shows as a stale row.
--
-- Review round 3: a row is due only when the claim could take it now, so the
-- claim's one-lane-per-card rule is part of the test (a newer response behind
-- an older call's row in retry posts nothing until that row's next try); and
-- an open form row the owner gate refuses is due in every mode, so a run
-- settles it within a minute (after a rollback the writer reports dry_run,
-- and only the claim settles those rows).
CREATE OR REPLACE FUNCTION public.cockpit_clickup_forms_kick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/clickup-writeback';
  v_mode jsonb := public.cockpit_clickup_forms_mode();
  v_last timestamptz;
  v_due boolean;
  v_refused integer;
  v_open timestamptz;
  v_secret text;
  v_note text;
  v_request bigint;
BEGIN
  BEGIN
    v_last := (v_mode->>'at')::timestamptz;
  EXCEPTION WHEN others THEN
    v_last := NULL;
  END;
  -- Due: what claim_forms would take now (mode, canary, due time and the lane rule, as the claim has them).
  v_due := coalesce(v_mode->>'mode', 'unknown') IN ('apply','apply_limited') AND EXISTS (
    SELECT 1 FROM public.cockpit_clickup_writeback_queue q
     WHERE q.kind = 'form'
       AND (v_mode->>'mode' = 'apply' OR (q.task_id IS NOT NULL AND coalesce(v_mode->'onlyCards', '[]'::jsonb) ? q.task_id))
       AND ((q.state IN ('queued','retry','unknown') AND q.next_attempt_at <= now())
         OR (q.state = 'sending' AND q.claimed_at < now() - interval '10 minutes'))
       AND NOT EXISTS (
             SELECT 1 FROM public.cockpit_clickup_writeback_queue o
              WHERE o.kind = 'form' AND o.task_id = q.task_id AND o.id <> q.id
                AND ((o.state = 'sending' AND o.claimed_at >= now() - interval '10 minutes')
                  OR (o.state IN ('queued','sending','retry','unknown')
                      AND o.payload->>'responseId' IS DISTINCT FROM q.payload->>'responseId'
                      AND (o.created_at < q.created_at OR (o.created_at = q.created_at AND o.id < q.id))))));
  -- Refused: open rows the owner gate turns away, which the claim settles in any mode.
  SELECT count(*) INTO v_refused FROM public.cockpit_clickup_writeback_queue q
   WHERE q.kind = 'form'
     AND (q.state IN ('queued','retry','unknown')
       OR (q.state = 'sending' AND q.claimed_at < now() - interval '10 minutes'))
     AND NOT coalesce((public.cockpit_form_effect_gate('clickup_queue', q.id::text)->>'ok')::boolean, false);
  IF NOT v_due AND v_refused = 0 AND v_last IS NOT NULL AND v_last >= now() - interval '10 minutes' THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
    VALUES ('clickup-writeback:forms-kick', now(), now(), true,
      'Nothing due. The 1-1 notes writer last reported at ' || to_char(v_last AT TIME ZONE 'Asia/Kuwait', 'HH24:MI') || ' Kuwait.', now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  -- One forms run at a time: the open run takes what is due, or the next minute's kick posts once it ends.
  SELECT max(r.started_at) INTO v_open FROM public.cockpit_clickup_writeback_runs r
   WHERE r.job = 'forms' AND r.finished_at IS NULL AND r.started_at > now() - interval '4 minutes';
  IF v_open IS NOT NULL THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
    VALUES ('clickup-writeback:forms-kick', now(), now(), true,
      'A 1-1 notes run that started at ' || to_char(v_open AT TIME ZONE 'Asia/Kuwait', 'HH24:MI')
        || ' Kuwait is still writing, so no second run was posted.', now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = $1 LIMIT 1'
      INTO v_secret USING 'cockpit_sync_secret';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    v_note := 'The vault has no cockpit_sync_secret, so the 1-1 notes writer was not started. Add it to the vault.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace ns ON ns.oid = f.pronamespace
                     WHERE ns.nspname = 'net' AND f.proname = 'http_post') THEN
    v_note := 'pg_net is not installed, so the 1-1 notes writer was not started.';
  END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at)
    VALUES ('clickup-writeback:forms-kick', now(), false, v_note, now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), ok = false, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  -- clickup-writeback answers when its run ends (up to about 100 seconds), so the post waits as the requests kick's does.
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 150000)' INTO v_request
    USING v_url, jsonb_build_object('job', 'forms'),
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
  VALUES ('clickup-writeback:forms-kick', now(), now(), true,
    CASE WHEN v_due THEN 'Posted a 1-1 notes run.'
         WHEN v_refused > 0 THEN 'Posted a 1-1 notes run to settle ' || v_refused
           || CASE WHEN v_refused = 1 THEN ' write' ELSE ' writes' END || ' the cockpit no longer sends.'
         ELSE 'Posted a 1-1 notes run so the writer reports its mode.' END, now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
  RETURN v_request;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The minute schedule (only where pg_cron exists): the one cron 2b adds (Z10)

DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname=''mahara-clickup-writeback-forms''';
    EXECUTE $q$SELECT cron.schedule('mahara-clickup-writeback-forms','* * * * *',$job$SELECT public.cockpit_clickup_forms_kick();$job$)$q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (definer functions and pg_cron as owner).
  FOREACH f IN ARRAY ARRAY['cockpit_clickup_forms_mode()', 'cockpit_clickup_forms_kick()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- The writer's RPCs and the four replaced ones: the service key only.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_clickup_writeback_claim(uuid,integer)', 'cockpit_clickup_writeback_release(uuid,uuid,jsonb,text,timestamptz)',
    'cockpit_clickup_writeback_begin(text,text,boolean)', 'cockpit_clickup_writeback_idle(text,boolean,text)',
    'cockpit_clickup_forms_state(boolean,text,text,text[],jsonb)', 'cockpit_clickup_writeback_claim_forms(uuid,integer)',
    'cockpit_clickup_forms_doctor_inputs()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
