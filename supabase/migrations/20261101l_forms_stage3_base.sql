-- The forms base for stage 3 (docs/forms/WAVE12-CONTRACT.md 2.3, 3.1, 3.4,
-- 4.3 and 4.4: F0a, C4a-2's SQL, the pause-request capture, notice kinds and
-- S0). Creative Triage (bldgtotkfmhoxmlzowdx). Additive; applies twice. The
-- first of the waves 1-2 block (20261101l to 20261101q); every later file of
-- the block calls what is made here.
--
-- 1. Six notice kinds (3.4): termination.notice ("Termination notice in", on,
--    #csm-general, tags the CSM), termination.submitted (seeded off while
--    Make's own post still runs, W4), and the four staff notices
--    churn.confirmed, extension.granted, pause.agreed and client.resumed in
--    #csm-announcements. The three settings CHECKs and the outbox's kind
--    CHECK widen once (W3); the outbox's card rule lets a termination notice
--    with no card through, since a survey can arrive unmatched (W12, W22).
--    Eleven notice functions learn the kinds, each with the smallest edit.
-- 2. S0: #csm-announcements and #nps-survey-feedback join the channel list,
--    checking. The bot invite is the CEO's (Q4); until then a notice there
--    settles "Not posted".
-- 3. The forms registry: rows for the termination survey (knIe4eF3) and the
--    pause request (CTUjv6l3), both still filled in Typeform, and for the
--    five staff forms (a record of formDefs.ts's keys, set in code, W19). The
--    registry's checkin-only refusal becomes an allow-list (4.3).
-- 4. forms-door's two new forms: their signing keys (the keys CHECK and the
--    four key functions), the door's health row per form
--    (cockpit_forms_door_seen), and cockpit_form_record_legacy, the one
--    writer of their responses (state legacy, never a card change, D11).
-- 5. The records the later files and screens share: cockpit_form_staff_record,
--    cockpit_form_trail (FormSheet's after-send trail),
--    cockpit_form_notices_in (the derived Today rows, W5),
--    cockpit_form_legacy_match (a person picks a survey's card),
--    cockpit_form_doors (which new doors may show) and
--    cockpit_request_type_add (deploy step D-R1 only).
-- 6. The responses guard gets two carve-outs, each under a transaction-local
--    setting, for a stored survey only: a person's card match, and the one
--    answer to its notice (20261101o calls it with cockpit.forms_legacy =
--    'answer', so o need not replace the guard again).
--
-- Nothing here posts, writes a card or reaches a client: rows are queued and
-- recorded only. Every function is SECURITY DEFINER with an empty search
-- path, revoked from all four roles, then granted as 2.2 and 2.3 say. Objects
-- of later files (20261101m's voids, 20261101o's confirm columns, n's and p's
-- functions) are read by name at run time, so this file stands alone.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (2.1): each replaced body is the one the contract read
--    (the live body md5, 11.2-c) or this file's own (a second apply).

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_slack_notice_shape(text)', 'a22c7f71b3a8398c96b0dcb5336b7f0d', '19fdd9d7e444648e6b7a8ec37789b00c'),
      ('public.cockpit_slack_notice_kind_label(text)', 'fea0b1c735a76ecfdd5d6880615f9f3d', 'd44ee66b9ff6f0eb01cc6d053e0b9176'),
      ('public.cockpit_slack_notice_live(public.cockpit_slack_notices)', '236e6af483f41c3514d7dc41e6a81086', '61d9e369f2b555acb1ac3e185df28dae'),
      ('public.cockpit_slack_notice_inputs(jsonb)', '2d980b72862995467fdca66da74945c7', '8f03d16f00739d63b2ed2442526f5a3b'),
      ('public.cockpit_slack_notice_doctor_inputs()', 'a17ee0591518eb3f5eb0fae0cc2b9a02', 'b535391a05c453ec109eb81f29b89898'),
      ('public.cockpit_slack_notice_settings_read()', '57b78a275b1378ef49b9d092c70f86a0', 'ea3863b49c25ed786fa7b3e81e1c6d17'),
      ('public.cockpit_slack_notice_settings_set(text,jsonb)', '37cfe1700eaae4a1d23b6000ed3429a9', '60751ee78283238fc89d33bb76b050df'),
      ('public.cockpit_slack_channel_remove(text)', '36a18b31cd6ffefb87ebe234264db782', '06adfc699c3110b99f084d1e60cb16a0'),
      ('public.cockpit_slack_notice_rehearse(text)', '62fb92a21b367ab6b98eabdeb07a071c', '20cab5786b0a54be30f88fcaa5f1931f'),
      ('public.cockpit_slack_notice_rehearse_service(text,text)', 'bc273014f46cf04a06c95b61d46a1ba2', '4cfbc884fe8c2c6946f09d818fa7be17'),
      ('public.cockpit_slack_notice_read(text)', '8937626f99eaf17aed97080144a9a05c', 'cfdcb4241f40a4452d50219f3ba11291'),
      ('public.cockpit_forms_key_put(jsonb)', '6bc3394855a1120060c8105d93399f52', '24478cd132a02c9a370f27bccff506dc'),
      ('public.cockpit_forms_key_mark(jsonb)', 'da921eebe001f597840e8e930bc0b69e', '1075daac5191d53bae1e17c87b296160'),
      ('public.cockpit_forms_key_label(text)', 'a4a69845be8fcc978842aa024ce298e4', '85af18f124fd053ef832cca3eae6eb2b'),
      ('public.cockpit_forms_keys_status()', 'f37568dfb69e44327ca8c5552c1d04f2', '695113cef48b9994447a539ae5fd7949'),
      ('public.cockpit_forms_door_seen(text,text,text)', 'f300e9a2184fba75d8b4f5693cb20e83', '063bd0689f11f79aeebc6270b370d28a'),
      ('public.cockpit_form_registry_apply(text,jsonb,jsonb)', 'af5e541b7f489b9871e4ad49a6c32460', '73a88dc6513b074e54d76ec4472d3539'),
      -- Not in 2.2's table: the legacy match needs its carve-out (section 6 above).
      ('public.cockpit_form_responses_guard()', '168ce29dc03c2867603af6a488da2790', 'e05e4baa2c0059d9fd04a98684963bbb')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since the waves 1-2 contract read it; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The CHECKs, each widened only from the definition the contract read
--    (11.2-o); any other definition stops the file, and one already widened
--    changes nothing.

DO $$
DECLARE v_def text;
BEGIN
  -- The settings' kinds.
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notice_settings'::regclass AND c.conname = 'cockpit_slack_notice_settings_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.late''::text, ''kickoff.second''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.late''::text, ''kickoff.second''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''checkin.grade''::text, ''checkin.recap_late''::text])))' THEN
      RAISE EXCEPTION 'cockpit_slack_notice_settings_kind_check changed since the waves 1-2 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notice_settings DROP CONSTRAINT IF EXISTS cockpit_slack_notice_settings_kind_check;
    ALTER TABLE public.cockpit_slack_notice_settings ADD CONSTRAINT cockpit_slack_notice_settings_kind_check
      CHECK (kind IN ('kickoff','kickoff.late','kickoff.second','kickoff.updated',
                      'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                      'checkin.grade','checkin.recap_late',
                      'termination.notice','termination.submitted','churn.confirmed',
                      'extension.granted','pause.agreed','client.resumed'));
  END IF;

  -- The kinds that name a channel: all six are top level, termination.submitted included though off.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notice_settings'::regclass AND c.conname = 'cockpit_slack_notice_settings_check';
  IF v_def IS DISTINCT FROM 'CHECK (((kind = ANY (ARRAY[''kickoff''::text, ''blueprint.close''::text, ''blueprint.media''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text])) = (channel IS NOT NULL)))' THEN
    IF v_def IS DISTINCT FROM 'CHECK (((kind = ANY (ARRAY[''kickoff''::text, ''blueprint.close''::text, ''blueprint.media''::text, ''checkin.grade''::text, ''checkin.recap_late''::text])) = (channel IS NOT NULL)))' THEN
      RAISE EXCEPTION 'cockpit_slack_notice_settings_check changed since the waves 1-2 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notice_settings DROP CONSTRAINT IF EXISTS cockpit_slack_notice_settings_check;
    ALTER TABLE public.cockpit_slack_notice_settings ADD CONSTRAINT cockpit_slack_notice_settings_check
      CHECK ((kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late',
                       'termination.notice','termination.submitted','churn.confirmed',
                       'extension.granted','pause.agreed','client.resumed')) = (channel IS NOT NULL));
  END IF;

  -- The outbox's kinds.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''rehearsal''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''rehearsal''::text, ''checkin.grade''::text, ''checkin.recap_late''::text])))' THEN
      RAISE EXCEPTION 'cockpit_slack_notices_kind_check changed since the waves 1-2 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT IF EXISTS cockpit_slack_notices_kind_check;
    ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_kind_check
      CHECK (kind IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated',
                      'blueprint.media','blueprint.offer','rehearsal','checkin.grade','checkin.recap_late',
                      'termination.notice','termination.submitted','churn.confirmed',
                      'extension.granted','pause.agreed','client.resumed'));
  END IF;

  -- The outbox's card rule: a termination notice may have no card (a survey
  -- with no card id in its hidden fields stays unmatched, W12); every other
  -- notice but a rehearsal keeps its card.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_check1';
  IF v_def IS DISTINCT FROM 'CHECK (((kind = ANY (ARRAY[''rehearsal''::text, ''termination.notice''::text])) OR (task_id IS NOT NULL)))' THEN
    IF v_def IS DISTINCT FROM 'CHECK (((kind = ''rehearsal''::text) OR (task_id IS NOT NULL)))' THEN
      RAISE EXCEPTION 'cockpit_slack_notices_check1 changed since the waves 1-2 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT IF EXISTS cockpit_slack_notices_check1;
    ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_check1
      CHECK (kind IN ('rehearsal','termination.notice') OR task_id IS NOT NULL);
  END IF;

  -- The forms keys: the two new forms' signing keys beside kickoff's.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_forms_keys'::regclass AND c.conname = 'cockpit_forms_keys_provider_check';
  IF v_def IS DISTINCT FROM 'CHECK ((provider = ANY (ARRAY[''fathom''::text, ''fathom_webhook''::text, ''anthropic''::text, ''deepseek''::text, ''typeform_kickoff''::text, ''typeform_exit_survey''::text, ''typeform_pause_request''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((provider = ANY (ARRAY[''fathom''::text, ''fathom_webhook''::text, ''anthropic''::text, ''deepseek''::text, ''typeform_kickoff''::text])))' THEN
      RAISE EXCEPTION 'cockpit_forms_keys_provider_check changed since the waves 1-2 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_forms_keys DROP CONSTRAINT IF EXISTS cockpit_forms_keys_provider_check;
    ALTER TABLE public.cockpit_forms_keys ADD CONSTRAINT cockpit_forms_keys_provider_check
      CHECK (provider IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff',
                          'typeform_exit_survey','typeform_pause_request'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. S0: the two Slack channels, checking until the notices doctor reads the
--    bot's membership (ok or refused). The bot invite is the CEO's (Q4).

INSERT INTO public.cockpit_slack_channels (id, name, private, state, note, added_by) VALUES
  ('C09SNG5BP53', 'csm-announcements', false, 'checking',
   'The CEO invites the bot (Q4); until then notices here read Not posted.', 'migration 20261101l (S0)'),
  ('C09TTGBRQ0G', 'nps-survey-feedback', false, 'checking',
   'The CEO invites the bot (Q4); until then notices here read Not posted.', 'migration 20261101l (S0)')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The replaced functions: each live body with the edits of 2.2, 3.4 and
--    4.3 (the PGlite suite proves each)

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_shape(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late',
                    'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed') THEN 'post'
    WHEN p_kind IN ('kickoff.updated','blueprint.updated','blueprint.offer') THEN 'reply'
    WHEN p_kind IN ('kickoff.late','kickoff.second') THEN 'variant'
    WHEN p_kind = 'rehearsal' THEN 'test'
  END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_kind_label(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_kind
    WHEN 'kickoff' THEN 'Kickoff complete'
    WHEN 'kickoff.late' THEN 'Kickoff late'
    WHEN 'kickoff.second' THEN 'Second kickoff'
    WHEN 'kickoff.updated' THEN 'Kickoff card updated'
    WHEN 'blueprint.close' THEN 'Brand Blueprint closed'
    WHEN 'blueprint.media' THEN 'Brand Blueprint completed, for media'
    WHEN 'blueprint.updated' THEN 'Blueprint card confirmed'
    WHEN 'blueprint.offer' THEN 'Offer locked'
    WHEN 'checkin.grade' THEN 'Call grade'
    WHEN 'checkin.recap_late' THEN 'Recap not sent'
    WHEN 'termination.notice' THEN 'Termination notice in'
    WHEN 'termination.submitted' THEN 'Termination survey sent'
    WHEN 'churn.confirmed' THEN 'Client has left'
    WHEN 'extension.granted' THEN 'Extension given'
    WHEN 'pause.agreed' THEN 'Pause agreed'
    WHEN 'client.resumed' THEN 'Client resumed'
    ELSE p_kind
  END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_live(p_row public.cockpit_slack_notices)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text; v_updated timestamptz; v_links jsonb; v_sub timestamptz; v_by text; v_launch timestamptz;
  v_rec text; v_grade jsonb; v_class text; v_gone timestamptz; v_call_gone boolean; v_email text; v_starts timestamptz;
  v_share text; v_effect text; v_ref text; v_message text;
  v_rid uuid; v_answered boolean; v_resp_task text; v_resp_at timestamptz; v_notice_on date; v_covered boolean;
  v_event bigint; v_voided boolean; v_dep bigint; v_removed boolean;
BEGIN
  -- A 1-1 notes notice (2b). The call grade's words come from the draft its
  -- facts name, read now and only once that draft is ready; they are never
  -- stored in the outbox (Z7). Who took the call is a role, never a name.
  IF p_row.kind = 'checkin.grade' THEN
    v_rec := p_row.facts->>'recordingId';
    IF coalesce(p_row.facts->>'draftId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT jsonb_build_object('criteria', d.output->'criteria', 'overall', d.output->'overall', 'color', d.output->'color',
                                'score', d.output->'score', 'draftId', d.id)
        INTO v_grade
        FROM public.cockpit_form_drafts d
       WHERE d.id = (p_row.facts->>'draftId')::uuid AND d.kind = 'grade' AND d.state = 'ready'
         AND d.recording_id = v_rec AND jsonb_typeof(d.output) = 'object';
    END IF;
    SELECT m.class, m.gone_at, lower(btrim(m.recorded_by_email)), m.starts_at, m.share_url
      INTO v_class, v_gone, v_email, v_starts, v_share
      FROM public.cockpit_fathom_meetings m WHERE m.recording_id = v_rec;
    v_call_gone := EXISTS (SELECT 1 FROM public.cockpit_csm_calls c
                            WHERE c.source = 'fathom' AND c.source_id = v_rec AND c.status = 'gone');
    v_by := CASE WHEN nullif(v_email, '') IS NOT NULL THEN public.cockpit_slack_notice_role_of(v_email) END;
    IF v_by IS NULL AND coalesce(p_row.facts->>'responseId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT public.cockpit_slack_notice_role_of(r.submitted_by) INTO v_by
        FROM public.cockpit_form_responses r WHERE r.id = (p_row.facts->>'responseId')::uuid;
    END IF;
    RETURN jsonb_build_object(
      'takenByRole', v_by,
      'callAt', public.cockpit_slack_notice_iso(v_starts),
      'shareUrl', v_share,
      'recordingShown', coalesce(v_class IN ('client','candidate') AND v_gone IS NULL AND NOT v_call_gone, false))
      || CASE WHEN v_grade IS NOT NULL THEN jsonb_build_object('grade', v_grade) ELSE '{}'::jsonb END;
  ELSIF p_row.kind = 'checkin.recap_late' THEN
    -- Where the recap is now: its effect, and the message the effect points at.
    IF coalesce(p_row.facts->>'responseId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT e.state, e.delivery_ref INTO v_effect, v_ref
        FROM public.cockpit_form_effects e
       WHERE e.response_id = (p_row.facts->>'responseId')::uuid AND e.effect_key = 'recap';
    END IF;
    IF coalesce(v_ref, '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT m.state INTO v_message FROM public.cockpit_client_messages m WHERE m.id = v_ref::uuid;
    END IF;
    RETURN jsonb_build_object('recap', jsonb_build_object('effectState', v_effect, 'messageState', v_message));
  ELSIF p_row.kind IN ('termination.notice','termination.submitted') THEN
    -- Waves 1-2 (3.4): a termination notice is still true while its survey
    -- is unanswered and no churn confirmed after it covers the card. The
    -- confirm's columns arrive with 20261101o, so they are read by name.
    IF coalesce(p_row.facts->>'responseId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      v_rid := (p_row.facts->>'responseId')::uuid;
      SELECT r.answer_meta ? 'answered', r.task_id, r.submitted_at, (r.answer_meta->>'notice_on')::date
        INTO v_answered, v_resp_task, v_resp_at, v_notice_on
        FROM public.cockpit_form_responses r WHERE r.id = v_rid AND r.form_key = 'exit_survey';
    END IF;
    IF v_resp_task IS NOT NULL AND EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = 'public.cockpit_churn_departures'::regclass AND a.attname = 'confirmed_at' AND NOT a.attisdropped) THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.cockpit_churn_departures d WHERE d.clickup_task_id = $1 AND d.removed_at IS NULL'
              ' AND d.confirmed_at IS NOT NULL AND (d.confirmed_at >= $2 OR d.left_on >= $3))'
        INTO v_covered USING v_resp_task, v_resp_at, v_notice_on;
    END IF;
    RETURN jsonb_build_object(
      'responseFound', v_answered IS NOT NULL,
      'matched', v_resp_task IS NOT NULL,
      'stillTrue', CASE WHEN p_row.kind = 'termination.submitted' THEN v_answered IS NOT NULL
                        ELSE v_answered IS FALSE AND NOT coalesce(v_covered, false) END,
      'why', CASE WHEN v_answered IS NULL THEN 'The survey is no longer in the cockpit.'
                  WHEN p_row.kind = 'termination.notice' AND v_answered THEN 'The notice was answered in the cockpit before it went out.'
                  WHEN p_row.kind = 'termination.notice' AND coalesce(v_covered, false)
                    THEN 'The churn was confirmed in the cockpit before the notice went out.' END);
  ELSIF p_row.kind = 'churn.confirmed' THEN
    IF coalesce(p_row.facts->>'departureId', '') ~ '^[0-9]{1,18}$' THEN
      v_dep := (p_row.facts->>'departureId')::bigint;
      SELECT d.removed_at IS NOT NULL INTO v_removed FROM public.cockpit_churn_departures d WHERE d.id = v_dep;
    END IF;
    RETURN jsonb_build_object('stillTrue', v_removed IS FALSE,
      'why', CASE WHEN v_removed IS NULL THEN 'The departure is no longer in the register.'
                  WHEN v_removed THEN 'The departure was removed from the register before the notice went out.' END);
  ELSIF p_row.kind IN ('extension.granted','pause.agreed','client.resumed') THEN
    -- A voided billing event (20261101m's voids, read by name) is no news.
    IF coalesce(p_row.facts->>'eventId', '') ~ '^[0-9]{1,18}$' THEN
      v_event := (p_row.facts->>'eventId')::bigint;
      IF NOT EXISTS (SELECT 1 FROM public.cockpit_billing_events e WHERE e.id = v_event) THEN
        v_event := NULL;
      ELSIF to_regclass('public.cockpit_billing_event_voids') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = $1)'
          INTO v_voided USING v_event;
      END IF;
    END IF;
    RETURN jsonb_build_object('stillTrue', v_event IS NOT NULL AND NOT coalesce(v_voided, false),
      'why', CASE WHEN v_event IS NULL THEN 'The billing change is no longer in the cockpit.'
                  WHEN v_voided THEN 'The billing change was voided before the notice went out.' END);
  END IF;
  IF p_row.task_id IS NULL OR p_row.kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.media') THEN
    RETURN '{}'::jsonb;
  END IF;
  SELECT o.client_status, o.card_updated_at, o.links INTO v_status, v_updated, v_links
    FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_row.task_id;
  IF p_row.kind = 'kickoff' THEN
    v_sub := public.cockpit_slack_notice_ts(p_row.facts->>'submittedAt');
    SELECT public.cockpit_slack_notice_role_of(s.sent_by_email) INTO v_by
      FROM public.cockpit_csm_form_sends s WHERE s.response_id = p_row.facts->>'responseId'
     ORDER BY s.sent_at DESC LIMIT 1;
    RETURN jsonb_build_object(
      'clientStatus', v_status,
      'cardUpdatedAt', public.cockpit_slack_notice_iso(v_updated),
      'blueprintLink', nullif(btrim(coalesce(v_links->>'blueprint_form', '')), '') IS NOT NULL,
      'looksDone', public.cockpit_slack_notice_card_done(v_status, v_updated, v_sub),
      'filledByRole', v_by,
      'dueBy', public.cockpit_slack_notice_iso(v_sub + interval '20 minutes'));
  ELSIF p_row.kind = 'kickoff.updated' THEN
    RETURN jsonb_build_object('clientStatus', v_status, 'cardUpdatedAt', public.cockpit_slack_notice_iso(v_updated));
  ELSIF p_row.kind = 'blueprint.close' THEN
    SELECT c.starts_at INTO v_launch FROM public.cockpit_csm_calls c
     WHERE c.task_id = p_row.task_id AND c.kind = 'launch' AND c.starts_at > now() AND c.status IN ('booked','confirmed')
     ORDER BY c.starts_at LIMIT 1;
    RETURN jsonb_build_object('clientStatus', v_status, 'launchCallAt', public.cockpit_slack_notice_iso(v_launch));
  END IF;
  RETURN jsonb_build_object('clientStatus', v_status);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_inputs(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_kind text;
  v_task text;
  v_client text;
  v_forms jsonb;
  v_facts jsonb;
  v_row public.cockpit_slack_notices;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR NOT (p ? 'responseId' OR (p ? 'kind' AND p ? 'taskId' AND p ? 'facts')) THEN
    RAISE EXCEPTION 'Send {"responseId": ...} or {"kind": ..., "taskId": ..., "facts": {...}}.' USING ERRCODE = '22023';
  END IF;
  IF p ? 'responseId' THEN
    SELECT o.clickup_task_id, o.client_name, o.forms INTO v_task, v_client, v_forms
      FROM public.cockpit_client_onboarding o
     WHERE nullif(p->>'responseId', '') IS NOT NULL AND o.forms->'kickoff'->>'response_id' = p->>'responseId'
     ORDER BY o.synced_at DESC LIMIT 1;
    IF v_task IS NULL THEN
      RAISE EXCEPTION 'No kickoff with that response ID is in the mirror.' USING ERRCODE = '22023';
    END IF;
    v_kind := 'kickoff';
    v_facts := public.cockpit_slack_notice_kickoff_facts(v_task, v_client, v_forms, NULL);
  ELSE
    v_kind := p->>'kind';
    v_task := p->>'taskId';
    IF v_kind IS NULL OR v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late',
                                       'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed') THEN
      RAISE EXCEPTION 'There is no notice called %.', coalesce(v_kind, '') USING ERRCODE = '22023';
    END IF;
    IF v_task IS NULL OR v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN
      RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p->'facts') IS DISTINCT FROM 'object' OR octet_length((p->'facts')::text) > 16384 THEN
      RAISE EXCEPTION 'Send the facts as an object under 16 KB.' USING ERRCODE = '22023';
    END IF;
    v_facts := p->'facts';
    SELECT o.client_name INTO v_client FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_task;
    v_client := coalesce(v_client, nullif(v_facts->>'client', ''));
  END IF;
  v_row.kind := v_kind;
  v_row.task_id := v_task;
  v_row.client_name := v_client;
  v_row.facts := v_facts;
  RETURN jsonb_build_object(
    'kind', v_kind,
    'taskId', v_task,
    'clientName', v_client,
    'ref', 'CN-dryrun00',
    'facts', v_facts,
    'live', public.cockpit_slack_notice_live(v_row),
    'target', public.cockpit_slack_notice_target(v_kind),
    'threadTs', NULL,
    'mentions', public.cockpit_slack_notice_claim_mentions(v_kind, v_client));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_doctor_inputs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'channels', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'private', c.private, 'state', c.state)
                                           ORDER BY c.added_at, c.id)
                            FROM public.cockpit_slack_channels c WHERE c.state <> 'removed'), '[]'::jsonb),
    'settings', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', s.kind, 'enabled', s.enabled, 'channel', s.channel,
                                             'mentions', public.cockpit_slack_notice_mentions(s.mention_rule, s.mention_people, NULL))
                                           ORDER BY array_position(ARRAY['kickoff','kickoff.late','kickoff.second','kickoff.updated',
                                             'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                                             'checkin.grade','checkin.recap_late',
                                             'termination.notice','termination.submitted','churn.confirmed',
                                             'extension.granted','pause.agreed','client.resumed'], s.kind))
                            FROM public.cockpit_slack_notice_settings s), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_settings_read()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_can jsonb;
  v_edit boolean;
  v_editors boolean;
  v_notices jsonb := '[]'::jsonb;
  v_shape text;
  v_last public.cockpit_slack_notices;
  v_test public.cockpit_slack_notices;
  v_test_view jsonb;
  s public.cockpit_slack_notice_settings;
BEGIN
  v_can := public.cockpit_slack_notice_viewer();
  v_edit := (v_can->>'edit')::boolean;
  v_editors := (v_can->>'editors')::boolean;

  FOR s IN
    SELECT * FROM public.cockpit_slack_notice_settings x
     ORDER BY array_position(ARRAY['kickoff','kickoff.late','kickoff.second','kickoff.updated',
                                   'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                                   'checkin.grade','checkin.recap_late',
                                   'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed'], x.kind)
  LOOP
    v_shape := public.cockpit_slack_notice_shape(s.kind);
    v_last := NULL;
    SELECT * INTO v_last FROM public.cockpit_slack_notices n
     WHERE CASE s.kind
             WHEN 'kickoff.late' THEN n.kind = 'kickoff' AND n.variant = 'late'
             WHEN 'kickoff.second' THEN n.kind = 'kickoff' AND n.facts->>'second' = 'true'
             ELSE n.kind = s.kind END
     ORDER BY n.created_at DESC, n.id LIMIT 1;
    v_notices := v_notices || jsonb_build_array(jsonb_build_object(
      'kind', s.kind,
      'shape', v_shape,
      'on', s.enabled,
      'fixedOn', v_shape = 'variant',
      'channel', CASE WHEN v_shape = 'post' AND s.channel IS NOT NULL THEN
                   jsonb_build_object('id', s.channel, 'name', (SELECT c.name FROM public.cockpit_slack_channels c WHERE c.id = s.channel)) END,
      'mentionRule', to_jsonb(s.mention_rule),
      -- A named person reads as their role to everyone (the sentence the
      -- team sees); only an editor's picker shows the first name. `slack`
      -- says what the next notice does with them (contract X4).
      'mentionPeople', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', u.id,
                 'label', CASE WHEN pp.id IS NULL OR NOT pp.active THEN 'Not on the team list'
                               WHEN v_edit THEN split_part(btrim(pp.name), ' ', 1) || coalesce(', ' || nullif(btrim(pp.role), ''), '')
                               ELSE public.cockpit_slack_person_label(pp.role) END,
                 'role', CASE WHEN pp.id IS NULL OR NOT pp.active THEN 'a team member'
                              ELSE public.cockpit_slack_person_label(pp.role) END,
                 'slack', CASE WHEN pp.id IS NULL OR NOT pp.active THEN 'not_found'
                               ELSE public.cockpit_slack_person_state(pp.id) END,
                 'slackKnown', coalesce(pp.active, false) AND public.cockpit_slack_person_id(pp.id) IS NOT NULL)
               ORDER BY u.ord)
          FROM unnest(s.mention_people) WITH ORDINALITY AS u(id, ord)
          LEFT JOIN public.cockpit_people pp ON pp.id = u.id), '[]'::jsonb),
      'tags', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'rule', u.rule,
                 'found', EXISTS (SELECT 1 FROM jsonb_array_elements(m.list) e WHERE NOT coalesce((e->>'missing')::boolean, false)),
                 'slackKnown', EXISTS (SELECT 1 FROM jsonb_array_elements(m.list) e WHERE e->>'slackId' IS NOT NULL),
                 'checking', EXISTS (SELECT 1 FROM jsonb_array_elements(m.list) e
                                      WHERE e->>'slackId' IS NULL AND e->>'personId' ~ '^[0-9]+$'
                                        AND public.cockpit_slack_person_state((e->>'personId')::bigint) = 'checking'))
               ORDER BY u.ord)
          FROM unnest(s.mention_rule) WITH ORDINALITY AS u(rule, ord)
          CROSS JOIN LATERAL (SELECT public.cockpit_slack_notice_mentions(ARRAY[u.rule], '{}'::bigint[], NULL) AS list) m), '[]'::jsonb),
      'updatedBy', CASE WHEN s.updated_by = 'migration' THEN 'the migration'
                        ELSE coalesce(public.cockpit_slack_notice_role_of(s.updated_by), 'a team member') END,
      'updatedAt', s.updated_at,
      'last', public.cockpit_slack_notice_view(v_last)));
  END LOOP;

  v_test := NULL;
  SELECT * INTO v_test FROM public.cockpit_slack_notices n
   WHERE n.kind = 'rehearsal' AND auth.uid() IS NOT NULL AND n.facts->>'requestedBy' = auth.uid()::text
     AND n.created_at > now() - interval '1 hour'
   ORDER BY n.created_at DESC, n.id LIMIT 1;
  IF v_test.id IS NOT NULL THEN
    v_test_view := public.cockpit_slack_notice_view(v_test);
    v_test_view := jsonb_build_object('id', v_test.id, 'kind', v_test.facts->>'of', 'state', v_test.state,
      'at', v_test_view->'at', 'reason', v_test_view->'reason');
  END IF;

  RETURN jsonb_build_object(
    'can', jsonb_build_object('edit', v_edit, 'editors', v_editors),
    'notices', v_notices,
    'channels', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'private', c.private, 'state', c.state, 'note', c.note,
               'checkedAt', c.checked_at,
               'inUse', EXISTS (SELECT 1 FROM public.cockpit_slack_notice_settings x WHERE x.channel = c.id))
             ORDER BY c.added_at, c.id)
        FROM public.cockpit_slack_channels c WHERE c.state <> 'removed'), '[]'::jsonb),
    'people', CASE WHEN v_edit THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', pp.id,
               'label', split_part(btrim(pp.name), ' ', 1) || coalesce(', ' || nullif(btrim(pp.role), ''), ''))
             ORDER BY lower(pp.name), pp.id)
        FROM public.cockpit_people pp WHERE pp.active AND nullif(btrim(pp.email), '') IS NOT NULL), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'editors', CASE WHEN v_editors THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('memberId', e.member_id,
               'label', public.cockpit_slack_notice_seat_label(m.email, m.name)) ORDER BY e.added_at, e.member_id)
        FROM public.cockpit_forms_editors e JOIN public.cockpit_members m ON m.id = e.member_id), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'members', CASE WHEN v_editors THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('memberId', m.id,
               'label', public.cockpit_slack_notice_seat_label(m.email, m.name)) ORDER BY lower(m.email), m.id)
        FROM public.cockpit_members m
       WHERE m.active AND NOT ('admin' = ANY(m.roles))
         AND lower(btrim(m.email)) NOT IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_forms_editors e WHERE e.member_id = m.id)), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'test', v_test_view,
    'now', now());
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_settings_set(p_kind text, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb;
  s public.cockpit_slack_notice_settings;
  v_key text;
  v_shape text;
  v_on boolean;
  v_channel text;
  v_rule text[];
  v_people bigint[];
BEGIN
  g := public.cockpit_forms_editor_gate();
  SELECT * INTO s FROM public.cockpit_slack_notice_settings x WHERE x.kind = p_kind FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no notice called %.', coalesce(p_kind, '') USING ERRCODE = '22023';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Send the changes as an object.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('on','channel','mentionRule','mentionPeople') THEN
      RAISE EXCEPTION 'Unknown setting: %.', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_shape := public.cockpit_slack_notice_shape(s.kind);
  v_on := s.enabled;
  v_channel := s.channel;
  v_rule := s.mention_rule;
  v_people := s.mention_people;

  IF p_patch ? 'on' THEN
    IF jsonb_typeof(p_patch->'on') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Send on as true or false.' USING ERRCODE = '22023';
    END IF;
    IF v_shape = 'variant' AND NOT (p_patch->>'on')::boolean THEN
      RAISE EXCEPTION 'This one is part of the kickoff notice and stays on. Turn the kickoff notice off instead.' USING ERRCODE = '22023';
    END IF;
    v_on := (p_patch->>'on')::boolean;
  END IF;

  IF p_patch ? 'channel' THEN
    IF v_shape <> 'post' THEN
      RAISE EXCEPTION 'Replies post in their first notice''s thread.' USING ERRCODE = '22023';
    END IF;
    v_channel := upper(btrim(CASE WHEN jsonb_typeof(p_patch->'channel') = 'string' THEN p_patch->>'channel' END));
    IF v_channel IS NULL OR NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c WHERE c.id = v_channel AND c.state = 'ok') THEN
      RAISE EXCEPTION 'Add that channel under Channels first; the cockpit checks the bot is in it.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'mentionRule' THEN
    IF jsonb_typeof(p_patch->'mentionRule') IS DISTINCT FROM 'array' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'mentionRule') e
          WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') NOT IN ('seat:creative','seat:csm','seat:systems_manager')) THEN
      RAISE EXCEPTION 'Choose who to tag from the list.' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(q.v ORDER BY q.first), '{}'::text[]) INTO v_rule
      FROM (SELECT t.v, min(t.ord) AS first FROM jsonb_array_elements_text(p_patch->'mentionRule') WITH ORDINALITY AS t(v, ord)
             GROUP BY t.v) q;
  END IF;

  IF p_patch ? 'mentionPeople' THEN
    IF jsonb_typeof(p_patch->'mentionPeople') IS DISTINCT FROM 'array' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'mentionPeople') e
          WHERE jsonb_typeof(e) NOT IN ('number','string') OR (e #>> '{}') !~ '^[0-9]{1,18}$') THEN
      RAISE EXCEPTION 'Choose people from the team list.' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(q.v ORDER BY q.first), '{}'::bigint[]) INTO v_people
      FROM (SELECT (t.e #>> '{}')::bigint AS v, min(t.ord) AS first
              FROM jsonb_array_elements(p_patch->'mentionPeople') WITH ORDINALITY AS t(e, ord)
             GROUP BY (t.e #>> '{}')::bigint) q;
    IF cardinality(v_people) > 10 OR EXISTS (
         SELECT 1 FROM unnest(v_people) AS u(id)
          WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_people pp
                             WHERE pp.id = u.id AND pp.active AND nullif(btrim(pp.email), '') IS NOT NULL)) THEN
      RAISE EXCEPTION 'Choose people from the team list.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The call grade (2b) is about a person's call: it tags nobody and posts
  -- only in a channel the cockpit has checked as private.
  IF s.kind = 'checkin.grade' THEN
    IF cardinality(v_rule) > 0 OR cardinality(v_people) > 0 THEN
      RAISE EXCEPTION 'The call grade tags nobody.' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'channel' AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c
                                            WHERE c.id = v_channel AND c.private IS TRUE) THEN
      RAISE EXCEPTION 'The call grade posts only in a private channel. Choose one the cockpit has checked as private.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Termination survey sent stays off while Make's own post still runs in
  -- #csm-announcements (W4): one post per event per channel. Wave 3 (C4b)
  -- merges {"c4b": true} into forms.doors when that post is off.
  IF s.kind = 'termination.submitted' AND v_on AND NOT s.enabled
     AND coalesce((SELECT c.value->>'c4b' FROM public.cockpit_settings c WHERE c.key = 'forms.doors'), '') <> 'true' THEN
    RAISE EXCEPTION 'Termination survey sent stays off while the old Make post still runs in #csm-announcements. It turns on when that post is switched off.'
      USING ERRCODE = '22023';
  END IF;

  IF (v_on, v_channel, v_rule, v_people) IS NOT DISTINCT FROM (s.enabled, s.channel, s.mention_rule, s.mention_people) THEN
    RETURN public.cockpit_slack_notice_settings_read();
  END IF;
  UPDATE public.cockpit_slack_notice_settings
     SET enabled = v_on, channel = v_channel, mention_rule = v_rule, mention_people = v_people,
         updated_by = g->>'email', updated_at = now()
   WHERE kind = s.kind;
  -- Everyone the change tags with no Slack id yet is checked by the sender
  -- within a minute: the named people, and whoever holds the seats now.
  IF (v_rule, v_people) IS DISTINCT FROM (s.mention_rule, s.mention_people) THEN
    PERFORM public.cockpit_slack_people_queue(
      v_people || coalesce((SELECT array_agg(DISTINCT (e->>'personId')::bigint)
                              FROM jsonb_array_elements(public.cockpit_slack_notice_mentions(v_rule, '{}'::bigint[], NULL)) e
                             WHERE e->>'personId' ~ '^[0-9]+$' AND e->>'slackId' IS NULL), '{}'::bigint[]),
      g->>'email');
  END IF;
  RETURN public.cockpit_slack_notice_settings_read();
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_channel_remove(p_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; c public.cockpit_slack_channels; v_kind text; v_id text := upper(btrim(coalesce(p_channel, '')));
BEGIN
  g := public.cockpit_forms_editor_gate();
  SELECT * INTO c FROM public.cockpit_slack_channels x WHERE x.id = v_id FOR UPDATE;
  IF NOT FOUND OR c.state = 'removed' THEN
    RAISE EXCEPTION 'That channel is not on the list.' USING ERRCODE = '22023';
  END IF;
  SELECT s.kind INTO v_kind FROM public.cockpit_slack_notice_settings s WHERE s.channel = v_id
   ORDER BY array_position(ARRAY['kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late',
                                 'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed'], s.kind) LIMIT 1;
  IF v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'The % notice posts there. Choose another channel for it first.', public.cockpit_slack_notice_kind_label(v_kind)
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.cockpit_slack_channels SET state = 'removed', note = 'Removed from the list.', updated_at = now() WHERE id = v_id;
  RETURN public.cockpit_slack_notice_settings_read();
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_rehearse(p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; v_uid text; v_kind text := coalesce(nullif(btrim(p_kind), ''), 'kickoff'); v_id uuid;
BEGIN
  g := public.cockpit_forms_editor_gate();
  v_uid := g->>'actorId';
  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late',
                    'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed') THEN
    RAISE EXCEPTION 'There is no notice called %.', v_kind USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_slack_rehearse:' || v_uid, 0));
  IF EXISTS (SELECT 1 FROM public.cockpit_slack_notices n
              WHERE n.kind = 'rehearsal' AND n.facts->>'requestedBy' = v_uid AND n.state IN ('queued','sending')) THEN
    RAISE EXCEPTION 'A test is already on its way. Wait for it, then send another.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.cockpit_slack_notices n
       WHERE n.kind = 'rehearsal' AND n.facts->>'requestedBy' = v_uid AND n.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'That is five tests in an hour. Try again later.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_slack_notices(kind, dedupe_key, task_id, target, facts)
  VALUES ('rehearsal', 'rehearsal:' || gen_random_uuid()::text, NULL, NULL,
          jsonb_build_object('of', v_kind, 'variant', NULL, 'sample', true, 'requestedBy', v_uid))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'state', 'queued',
    'note', 'Your test reaches your Slack direct messages within a minute.');
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_rehearse_service(p_kind text, p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind text := coalesce(nullif(btrim(p_kind), ''), 'kickoff'); v_id uuid;
BEGIN
  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late',
                    'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed') THEN
    RAISE EXCEPTION 'There is no notice called %.', v_kind USING ERRCODE = '22023';
  END IF;
  IF p_target IS NULL OR p_target !~ '^[UW][A-Z0-9]{8,12}$' THEN
    RAISE EXCEPTION 'Send a Slack member ID (it starts with U or W).' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  INSERT INTO public.cockpit_slack_notices(kind, dedupe_key, task_id, target, facts)
  VALUES ('rehearsal', 'rehearsal:' || gen_random_uuid()::text, NULL, p_target,
          jsonb_build_object('of', v_kind, 'variant', NULL, 'sample', true, 'requestedBy', 'cron'))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_read(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ok boolean := false; v_msg text; v_code text; v_name text; v_checkin boolean := false;
  v_creative boolean := false; v_finance boolean := false;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false) THEN
    v_ok := true;
    v_checkin := true;
  ELSE
    BEGIN
      PERFORM public.cockpit_csm_client_gate(p_task_id);
      v_ok := true;
      v_checkin := true;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_code = RETURNED_SQLSTATE;
    END;
    IF NOT v_ok AND coalesce(public.cockpit_has_role('creative'), false) THEN
      SELECT o.client_name INTO v_name FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
      IF v_name IS NULL THEN
        SELECT n.client_name INTO v_name FROM public.cockpit_slack_notices n
         WHERE n.task_id = p_task_id AND n.client_name IS NOT NULL ORDER BY n.created_at DESC LIMIT 1;
      END IF;
      v_creative := coalesce(public.cockpit_client_allowed(v_name), false);
      v_ok := v_creative;
    END IF;
    -- The client lifecycle notices (waves 1-2, 3.4) are money and status
    -- news: finance sees them on every card, and only them.
    IF NOT v_checkin AND coalesce(public.cockpit_has_role('finance'), false) THEN
      v_finance := true;
      v_ok := true;
    END IF;
    IF NOT v_ok THEN
      IF coalesce(public.cockpit_has_role('csm'), false) AND v_msg IS NOT NULL THEN
        RAISE EXCEPTION USING MESSAGE = v_msg, ERRCODE = coalesce(v_code, '42501');
      END IF;
      RAISE EXCEPTION 'That client is not on your access list' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'taskId', p_task_id,
    'now', now(),
    'notices', coalesce((SELECT jsonb_agg(v.j ORDER BY v.created_at DESC, v.id)
                           FROM (SELECT public.cockpit_slack_notice_view(x) AS j, x.created_at, x.id
                                   FROM public.cockpit_slack_notices x
                                  WHERE x.task_id = p_task_id AND x.kind <> 'rehearsal'
                                    -- The 1-1 notes notices are client success's: never a creative-only seat's.
                                    AND (v_checkin OR x.kind NOT LIKE 'checkin.%')
                                    -- Lifecycle news is client success's, finance's and the CEO's,
                                    -- never a creative-only seat's; a finance seat sees only it.
                                    AND (v_checkin
                                         OR (v_creative AND x.kind NOT IN ('termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed'))
                                         OR (v_finance AND x.kind IN ('termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed')))
                                  ORDER BY x.created_at DESC, x.id LIMIT 20) v), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_forms_key_put(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_provider text := p->>'provider';
  v_secret text := p->>'secret';
  v_by text := lower(btrim(coalesce(p->>'savedBy', '')));
  v_state text := coalesce(nullif(p->>'state', ''), 'unchecked');
  v_meta jsonb := CASE WHEN jsonb_typeof(p->'meta') = 'object' THEN p->'meta' ELSE '{}'::jsonb END;
  v_name text;
  v_id uuid;
  v_ok boolean;
  v_registered boolean;
  v_form text;
  v_noun text;
  k public.cockpit_forms_keys;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff',
                                              'typeform_exit_survey','typeform_pause_request') THEN
    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic, deepseek, typeform_kickoff, typeform_exit_survey or typeform_pause_request.'
      USING ERRCODE = '22023';
  END IF;
  -- A Typeform form's signing key (kickoff since 2b; the termination survey
  -- and the pause request since waves 1-2): its form and the noun its notes use.
  v_form := CASE WHEN v_provider LIKE 'typeform\_%' THEN substr(v_provider, 10) END;
  v_noun := CASE v_form WHEN 'kickoff' THEN 'kickoff' WHEN 'exit_survey' THEN 'termination survey'
                        WHEN 'pause_request' THEN 'pause request' END;
  v_ok := CASE v_provider
    WHEN 'fathom' THEN char_length(v_secret) BETWEEN 20 AND 400 AND v_secret !~ '[[:space:]]'
    WHEN 'fathom_webhook' THEN v_secret ~ '^whsec_[A-Za-z0-9+/=_-]{16,}$'
    WHEN 'anthropic' THEN v_secret ~ '^sk-ant-[A-Za-z0-9_-]{20,}$'
    WHEN 'deepseek' THEN v_secret ~ '^sk-[A-Za-z0-9]{20,}$'
    WHEN 'typeform_kickoff' THEN v_secret ~ '^[A-Za-z0-9_-]{32,128}$'
    WHEN 'typeform_exit_survey' THEN v_secret ~ '^[A-Za-z0-9_-]{32,128}$'
    WHEN 'typeform_pause_request' THEN v_secret ~ '^[A-Za-z0-9_-]{32,128}$' END;
  IF NOT coalesce(v_ok, false) AND v_form IS NOT NULL THEN
    RAISE EXCEPTION 'That doesn''t look like a Typeform signing secret: 32 to 128 letters, digits, - or _. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'That doesn''t look like % % key. Nothing was changed.',
      CASE WHEN v_provider = 'anthropic' THEN 'an' ELSE 'a' END, public.cockpit_forms_key_label(v_provider)
      USING ERRCODE = '22023';
  END IF;
  IF v_by <> 'server' AND v_by !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A key is saved by a verified email or the server.' USING ERRCODE = '22023';
  END IF;
  IF v_state NOT IN ('connected','unchecked','refused') THEN
    RAISE EXCEPTION 'Choose connected, unchecked or refused.' USING ERRCODE = '22023';
  END IF;
  v_name := 'cockpit_forms_key_' || v_provider;
  -- Two pastes of one key at once take turns, so the second finds the first's
  -- secret and updates it instead of racing it on the vault's unique name.
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_forms_key:' || v_provider, 0));
  SELECT s.id INTO v_id FROM vault.secrets s WHERE s.name = v_name LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_id, v_secret);
  ELSE
    PERFORM vault.create_secret(v_secret, v_name, 'cockpit forms key: ' || v_provider);
  END IF;
  INSERT INTO public.cockpit_forms_keys AS k0 (provider, vault_name, last4, state, state_note, saved_by, saved_at, checked_at, meta)
  VALUES (v_provider, v_name, right(v_secret, 4), v_state, left(p->>'stateNote', 240), v_by, now(),
          CASE WHEN v_state <> 'unchecked' THEN now() END, v_meta)
  ON CONFLICT (provider) DO UPDATE
     SET last4 = EXCLUDED.last4, state = EXCLUDED.state, state_note = EXCLUDED.state_note, saved_by = EXCLUDED.saved_by,
         saved_at = now(), checked_at = EXCLUDED.checked_at,
         meta = CASE WHEN EXCLUDED.provider IN ('fathom_webhook','typeform_kickoff','typeform_exit_survey','typeform_pause_request')
                     THEN EXCLUDED.meta ELSE k0.meta || EXCLUDED.meta END
  RETURNING * INTO k;
  IF v_provider = 'fathom_webhook' THEN
    INSERT INTO public.cockpit_sync_state AS s0 (key, note, detail, updated_at)
    VALUES ('fathom-webhook',
            CASE WHEN nullif(btrim(coalesce(k.meta->>'webhookId', '')), '') IS NOT NULL
                 THEN 'Registered webhook ending ' || right(btrim(k.meta->>'webhookId'), 4)
                 ELSE 'The webhook key is saved without a webhook ID.' END,
            public.cockpit_forms_webhook_detail(k.meta, k.saved_at), now())
    ON CONFLICT (key) DO UPDATE SET note = EXCLUDED.note, detail = EXCLUDED.detail, updated_at = now();
  END IF;
  IF v_form IS NOT NULL THEN
    -- Registered: a webhook id and no unregisteredAt, as the Fathom webhook.
    v_registered := (public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean;
    -- A saved key is no failing job. While nothing is registered there is no
    -- delivery to lose, so an earlier failure stops counting too.
    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
    VALUES ('forms-door:' || v_form, now(), now(), true,
            CASE WHEN v_registered THEN 'The ' || v_noun || ' webhook is registered.'
                 ELSE 'The ' || v_noun || ' signing key is saved; the webhook is not registered with it yet.' END,
            jsonb_build_object('registered', v_registered,
                               'registeredAt', CASE WHEN v_registered THEN coalesce(k.meta->'registeredAt', to_jsonb(k.saved_at)) END,
                               'lastDelivery', NULL, 'outcome', NULL), now())
    ON CONFLICT (key) DO UPDATE
       SET note = EXCLUDED.note,
           ok = s0.ok OR NOT v_registered,
           last_ok_at = CASE WHEN s0.ok OR v_registered THEN s0.last_ok_at ELSE now() END,
           detail = coalesce(s0.detail, '{}'::jsonb)
                    || jsonb_build_object('registered', EXCLUDED.detail->'registered', 'registeredAt', EXCLUDED.detail->'registeredAt'),
           updated_at = now();
  END IF;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('forms.keySaved', 'cockpit_forms_keys', v_provider, v_by, 'client-success',
          CASE WHEN v_by = 'server' THEN 'forms_key.py' ELSE 'cockpit-forms-api' END, NULL, NULL,
          jsonb_build_object('provider', v_provider, 'savedBy', v_by, 'state', v_state, 'last4', right(v_secret, 4)));
  RETURN jsonb_build_object('ok', true, 'provider', v_provider, 'last4', right(v_secret, 4), 'state', v_state);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_forms_key_mark(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_provider text := p->>'provider';
  v_state text := p->>'state';
  v_meta jsonb := CASE WHEN jsonb_typeof(p->'meta') = 'object' THEN p->'meta' ELSE '{}'::jsonb END;
  v_saved timestamptz;
  v_off timestamptz;
  k public.cockpit_forms_keys;
  n public.cockpit_forms_keys;
  v_was boolean;
  v_now boolean;
  v_form text;
  v_noun text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff',
                                              'typeform_exit_survey','typeform_pause_request') THEN
    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic, deepseek, typeform_kickoff, typeform_exit_survey or typeform_pause_request.'
      USING ERRCODE = '22023';
  END IF;
  -- A Typeform form's signing key (kickoff since 2b; the termination survey
  -- and the pause request since waves 1-2): its form and the noun its notes use.
  v_form := CASE WHEN v_provider LIKE 'typeform\_%' THEN substr(v_provider, 10) END;
  v_noun := CASE v_form WHEN 'kickoff' THEN 'kickoff' WHEN 'exit_survey' THEN 'termination survey'
                        WHEN 'pause_request' THEN 'pause request' END;
  IF v_state IS NULL OR v_state NOT IN ('connected','refused') THEN
    RAISE EXCEPTION 'Choose connected or refused.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_saved := (p->>'savedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_saved := NULL;
  END;
  SELECT * INTO k FROM public.cockpit_forms_keys x WHERE x.provider = v_provider FOR UPDATE;
  IF NOT FOUND OR v_saved IS NULL OR k.saved_at IS DISTINCT FROM v_saved THEN
    RETURN jsonb_build_object('ok', false, 'note', 'The key changed during the check');
  END IF;
  UPDATE public.cockpit_forms_keys x
     SET state = v_state, state_note = left(p->>'note', 240), checked_at = now(), meta = x.meta || v_meta
   WHERE x.provider = v_provider
  RETURNING * INTO n;
  IF v_provider = 'fathom_webhook' THEN
    v_was := (public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean;
    v_now := (public.cockpit_forms_webhook_detail(n.meta, n.saved_at)->>'registered')::boolean;
    IF coalesce(jsonb_typeof(v_meta->'unregisteredAt'), 'null') <> 'null' THEN
      BEGIN
        v_off := (v_meta->>'unregisteredAt')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        v_off := now();
      END;
    END IF;
    INSERT INTO public.cockpit_sync_state AS s0 (key, note, detail, updated_at)
    VALUES ('fathom-webhook',
            CASE WHEN v_off IS NOT NULL
                 THEN 'Webhook ending ' || coalesce(right(btrim(n.meta->>'webhookId'), 4), '????') || ' unregistered at '
                      || public.cockpit_form_kuwait_time(v_off) END,
            public.cockpit_forms_webhook_detail(n.meta, n.saved_at), now())
    ON CONFLICT (key) DO UPDATE
       SET note = coalesce(EXCLUDED.note, s0.note), detail = EXCLUDED.detail, updated_at = now();
  ELSIF v_form IS NOT NULL THEN
    -- Registered: a webhook id and no unregisteredAt, as the Fathom webhook.
    -- registeredAt is the registration's own time, so the guardian counts
    -- missed kickoffs only from then.
    v_was := (public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean;
    v_now := (public.cockpit_forms_webhook_detail(n.meta, n.saved_at)->>'registered')::boolean;
    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
    VALUES ('forms-door:' || v_form, now(), now(), true,
            CASE WHEN v_now THEN 'The ' || v_noun || ' webhook is registered.'
                 WHEN v_form = 'kickoff' THEN 'The kickoff webhook is not registered: kickoffs arrive by the 15-minute read.'
                 ELSE 'The ' || v_noun || ' webhook is not registered: its answers wait in Typeform until it is.' END,
            jsonb_build_object('registered', v_now,
                               'registeredAt', CASE WHEN v_now THEN coalesce(n.meta->'registeredAt', to_jsonb(n.checked_at)) END,
                               'lastDelivery', NULL, 'outcome', NULL), now())
    ON CONFLICT (key) DO UPDATE
       SET note = EXCLUDED.note,
           ok = s0.ok OR NOT v_now,
           last_ok_at = CASE WHEN s0.ok OR v_now THEN s0.last_ok_at ELSE now() END,
           detail = coalesce(s0.detail, '{}'::jsonb)
                    || jsonb_build_object('registered', v_now, 'registeredAt', EXCLUDED.detail->'registeredAt'),
           updated_at = now();
  END IF;
  IF k.state IS DISTINCT FROM n.state OR v_was IS DISTINCT FROM v_now THEN
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('forms.keyState', 'cockpit_forms_keys', v_provider,
            coalesce(nullif(current_setting('cockpit.audit_actor', true), ''), 'server'), 'client-success',
            coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'service'),
            jsonb_build_object('state', k.state, 'registered', v_was), jsonb_build_object('state', n.state, 'registered', v_now),
            jsonb_build_object('provider', v_provider, 'state', n.state, 'note', left(p->>'note', 240)));
  END IF;
  RETURN jsonb_build_object('ok', true, 'provider', v_provider, 'state', n.state);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_forms_key_label(p_provider text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_provider WHEN 'fathom' THEN 'Fathom' WHEN 'fathom_webhook' THEN 'Fathom webhook'
                         WHEN 'anthropic' THEN 'Anthropic' WHEN 'deepseek' THEN 'DeepSeek'
                         WHEN 'typeform_kickoff' THEN 'Typeform kickoff signing key'
                         WHEN 'typeform_exit_survey' THEN 'Termination survey webhook'
                         WHEN 'typeform_pause_request' THEN 'Pause request webhook' END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_forms_keys_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p text;
  k public.cockpit_forms_keys;
  hook public.cockpit_forms_keys;
  s public.cockpit_sync_state;
  v_keys jsonb := '[]'::jsonb;
  v_registered boolean;
  v_label text;
  v_sentence text;
  tk public.cockpit_forms_keys;
  v_door public.cockpit_sync_state;
  v_form text;
  v_typeform jsonb := '[]'::jsonb;
BEGIN
  IF NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO can see the 1-1 notes connections.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO hook FROM public.cockpit_forms_keys x WHERE x.provider = 'fathom_webhook';
  v_registered := hook.provider IS NOT NULL AND (public.cockpit_forms_webhook_detail(hook.meta, hook.saved_at)->>'registered')::boolean;
  FOREACH p IN ARRAY ARRAY['fathom','fathom_webhook','deepseek','anthropic'] LOOP
    SELECT * INTO k FROM public.cockpit_forms_keys x WHERE x.provider = p;
    v_label := public.cockpit_forms_key_label(p);
    v_sentence := CASE
      WHEN k.provider IS NULL OR (p = 'fathom_webhook' AND NOT v_registered) THEN CASE p
        WHEN 'fathom' THEN 'Not connected: calls come only from the 15-minute read.'
        WHEN 'deepseek' THEN 'Not connected: client notes drafts are off.'
        WHEN 'anthropic' THEN 'Not connected: DEFCON and priority suggestions, the call grade and the recap drafts are off.'
        -- The notes pull on open only with a Fathom key saved (A7.16), as the card says.
        ELSE CASE WHEN EXISTS (SELECT 1 FROM public.cockpit_forms_keys f WHERE f.provider = 'fathom')
                  THEN 'Not registered: calls arrive by the 15-minute read and when the notes open.'
                  ELSE 'Not registered: calls arrive by the 15-minute read.' END END
      WHEN k.state = 'connected' THEN 'Connected.'
      WHEN k.state = 'unchecked' THEN 'Saved, not checked yet.'
      ELSE v_label || ' refused this key. Paste a new one.' END;
    v_keys := v_keys || jsonb_build_array(jsonb_build_object(
      'provider', p,
      'label', v_label,
      'connected', coalesce(k.state = 'connected', false) AND (p <> 'fathom_webhook' OR v_registered),
      'state', coalesce(k.state, 'missing'),
      'last4', k.last4,
      'savedAt', k.saved_at,
      'savedBy', CASE WHEN k.saved_by IS NULL THEN NULL WHEN k.saved_by = 'server' THEN 'the server'
                      ELSE coalesce(public.cockpit_slack_notice_role_of(k.saved_by), 'a team member') END,
      'checkedAt', k.checked_at,
      'sentence', v_sentence));
  END LOOP;
  SELECT * INTO s FROM public.cockpit_sync_state x WHERE x.key = 'fathom-pull';
  -- Each Typeform form's signing key, apart from keys (Z57): kickoff since
  -- 2b, the termination survey and the pause request since waves 1-2.
  FOREACH v_form IN ARRAY ARRAY['kickoff','exit_survey','pause_request'] LOOP
    tk := NULL;
    v_door := NULL;
    SELECT * INTO tk FROM public.cockpit_forms_keys x WHERE x.provider = 'typeform_' || v_form;
    SELECT * INTO v_door FROM public.cockpit_sync_state x WHERE x.key = 'forms-door:' || v_form;
    v_typeform := v_typeform || jsonb_build_array(jsonb_build_object(
      'form', v_form,
      'connected', coalesce(tk.state = 'connected', false),
      'last4', tk.last4,
      'registered', coalesce((public.cockpit_forms_webhook_detail(tk.meta, tk.saved_at)->>'registered')::boolean, false),
      'lastDelivery', v_door.detail->'lastDelivery'));
  END LOOP;
  RETURN jsonb_build_object(
    'keys', v_keys,
    'webhook', jsonb_build_object(
      'registered', coalesce(v_registered, false),
      'triggeredFor', CASE WHEN jsonb_typeof(hook.meta->'triggeredFor') = 'array' THEN hook.meta->'triggeredFor' ELSE '[]'::jsonb END,
      'lastDeliveryAt', (SELECT max(d.last_at) FROM public.cockpit_fathom_webhook_deliveries d WHERE d.outcome IN ('stored','ignored')),
      'stored24h', (SELECT count(*) FROM public.cockpit_fathom_webhook_deliveries d
                     WHERE d.outcome = 'stored' AND d.last_at > now() - interval '24 hours'),
      'ignored24h', (SELECT count(*) FROM public.cockpit_fathom_webhook_deliveries d
                      WHERE d.outcome = 'ignored' AND d.last_at > now() - interval '24 hours'),
      'failed24h', (SELECT count(*) FROM public.cockpit_fathom_webhook_deliveries d
                     WHERE d.outcome = 'failed' AND d.last_at > now() - interval '24 hours')),
    'pull', jsonb_build_object('lastRunAt', s.last_run_at, 'ok', s.ok, 'note', s.note),
    'typeform', v_typeform,
    'now', now());
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_forms_door_seen(p_form_key text, p_outcome text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_at text := public.cockpit_form_kuwait_time(now());
  v_reason text := left(nullif(btrim(p_reason), ''), 240);
  v_fault boolean;
  v_quiet boolean;
  v_note text;
  k public.cockpit_forms_keys;
  v_registered boolean;
  v_noun text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  -- forms-door's FORM_KEYS (waves 1-2, 4.4): kickoff, the termination survey and the pause request.
  v_noun := CASE p_form_key WHEN 'kickoff' THEN 'kickoff' WHEN 'exit_survey' THEN 'termination survey'
                            WHEN 'pause_request' THEN 'pause request' END;
  IF v_noun IS NULL THEN
    RAISE EXCEPTION 'Only kickoff, the termination survey and the pause request have a cockpit webhook.' USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('recorded','repeat','ignored','probe','unsigned','failed') THEN
    RAISE EXCEPTION 'Choose recorded, repeat, ignored, probe, unsigned or failed.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO k FROM public.cockpit_forms_keys x WHERE x.provider = 'typeform_' || p_form_key;
  v_registered := coalesce((public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean, false);
  -- The URL is open, so what anyone can cause without the key says nothing about
  -- the door: an unsigned request, or any request while no key is saved and no
  -- webhook is registered. Those are quiet: recorded, but they neither fail the
  -- job nor clear a real failure. The job fails only when a signed delivery
  -- could not be stored, or a registered webhook has lost its key.
  v_fault := p_outcome = 'failed' AND (v_registered OR v_reason IS DISTINCT FROM 'No signing key saved');
  v_quiet := p_outcome = 'unsigned' OR (p_outcome = 'failed' AND NOT v_fault);
  v_note := CASE
    WHEN p_outcome = 'failed' AND NOT v_fault THEN 'A delivery at ' || v_at || ' could not be checked: no signing key is saved yet.'
    ELSE CASE p_outcome
    WHEN 'recorded' THEN 'A ' || v_noun || ' arrived and was stored at ' || v_at || '.'
    WHEN 'repeat' THEN 'Typeform sent a ' || v_noun || ' again at ' || v_at || '; it was already stored.'
    WHEN 'ignored' THEN 'A signed delivery at ' || v_at || ' was not a ' || v_noun || ' response, so nothing was stored.'
    WHEN 'probe' THEN 'The signed probe reached the door at ' || v_at || '.'
    WHEN 'unsigned' THEN 'A delivery at ' || v_at || ' had no valid signature, so nothing was stored.'
    ELSE 'A ' || v_noun || ' could not be stored at ' || v_at || ': ' || coalesce(v_reason, 'no reason was given.') END
  END;
  INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
  VALUES ('forms-door:' || p_form_key, now(), CASE WHEN NOT v_fault THEN now() END, NOT v_fault, v_note,
          jsonb_build_object('registered', v_registered,
                             'registeredAt', CASE WHEN v_registered THEN coalesce(k.meta->'registeredAt', to_jsonb(coalesce(k.checked_at, k.saved_at))) END,
                             'lastDelivery', now(), 'outcome', p_outcome, 'reason', v_reason), now())
  ON CONFLICT (key) DO UPDATE
     SET last_run_at = now(),
         last_ok_at = CASE WHEN v_fault OR v_quiet THEN s0.last_ok_at ELSE now() END,
         ok = CASE WHEN v_quiet THEN s0.ok ELSE NOT v_fault END,
         note = CASE WHEN v_quiet AND NOT s0.ok THEN s0.note ELSE v_note END,
         detail = coalesce(s0.detail, '{}'::jsonb)
                  || jsonb_build_object('lastDelivery', now(), 'outcome', p_outcome, 'reason', v_reason),
         updated_at = now();
  RETURN jsonb_build_object('ok', true, 'outcome', p_outcome);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_registry_apply(p_form_key text, p_patch jsonb, p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_bad constant text := 'Change only provider and owners, with make, shadow or cockpit for effects this form has.';
  f public.cockpit_forms;
  v_actor jsonb := CASE WHEN jsonb_typeof(p_actor) = 'object' THEN p_actor ELSE '{}'::jsonb END;
  v_via text;
  v_who text;
  v_owners jsonb;
  v_provider text;
  v_effects jsonb := '[]'::jsonb;
  e jsonb;
  v_owner text;
  v_clause text;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
  k text;
BEGIN
  v_via := v_actor->>'via';
  v_who := v_actor->>'who';
  IF v_via IS NULL OR v_via NOT IN ('cockpit','cutover','cutover-rollback') THEN
    RAISE EXCEPTION 'The registry changes only from the cockpit or the cut-over.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no form called %.', coalesce(p_form_key, '') USING ERRCODE = '22023';
  END IF;
  -- The allow-list (waves 1-2, 4.3): checkin keeps every 2b rule; the
  -- termination survey, the pause request, kickoff and the Brand Blueprint
  -- take owner changes from the CEO seat; the five staff forms are set in
  -- code (formDefs.ts, W19) and every other form by migration.
  IF f.key IN ('extension','pause','resume','churn_confirm','mrr') THEN
    RAISE EXCEPTION 'This form is set in the cockpit''s code until the form editor ships.' USING ERRCODE = '22023';
  ELSIF f.key NOT IN ('checkin','exit_survey','pause_request','kickoff','blueprint') THEN
    RAISE EXCEPTION 'That form changes only by migration until its editor ships.' USING ERRCODE = '22023';
  ELSIF f.key <> 'checkin' AND NOT (v_via = 'cockpit' AND v_who = 'ceo') THEN
    RAISE EXCEPTION 'Only the CEO changes who delivers this form''s steps.' USING ERRCODE = '42501';
  END IF;

  -- The patch's shape.
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch = '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) x WHERE x NOT IN ('provider','owners')) THEN
    RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'provider' AND (jsonb_typeof(p_patch->'provider') IS DISTINCT FROM 'string'
                               OR p_patch->>'provider' NOT IN ('typeform','native')) THEN
    RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023';
  END IF;
  v_owners := p_patch->'owners';
  IF p_patch ? 'owners' THEN
    IF jsonb_typeof(v_owners) = 'string' THEN
      IF v_owners #>> '{}' NOT IN ('make','shadow','cockpit') THEN
        RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023';
      END IF;
    ELSIF jsonb_typeof(v_owners) = 'object' AND v_owners <> '{}'::jsonb THEN
      FOR k IN SELECT x FROM jsonb_object_keys(v_owners) x LOOP
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f.effects) q WHERE q->>'key' = k)
           OR jsonb_typeof(v_owners->k) IS DISTINCT FROM 'string'
           OR v_owners->>k NOT IN ('make','shadow','cockpit') THEN
          RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023';
        END IF;
      END LOOP;
    ELSE
      RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The provider: native only through the cut-over; any other move by the
  -- CEO seat or the cut-over's rollback.
  v_provider := coalesce(p_patch->>'provider', f.provider);
  IF v_provider IS DISTINCT FROM f.provider AND f.key <> 'checkin' THEN
    -- Only the termination survey and the pause request move, forward to
    -- the cockpit, by the CEO (gated above); kickoff and the Blueprint keep
    -- where they are filled.
    IF NOT (f.key IN ('exit_survey','pause_request') AND f.provider = 'typeform' AND v_provider = 'native') THEN
      RAISE EXCEPTION 'Only the termination survey and the pause request move here, from Typeform to the cockpit.'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_provider IS DISTINCT FROM f.provider THEN
    IF v_provider = 'native' AND v_via IS DISTINCT FROM 'cutover' THEN
      RAISE EXCEPTION 'The 1-1 notes open in the cockpit only through the switch-over function at the cut-over hour.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT (v_who = 'ceo' OR v_via IN ('cutover','cutover-rollback')) THEN
      RAISE EXCEPTION 'Only the CEO switches where the 1-1 notes are filled: it goes with closing the Typeform and turning Make off.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- The effects, in the registry's order, each keeping its key, delivery and label.
  FOR e IN SELECT q FROM jsonb_array_elements(f.effects) WITH ORDINALITY z(q, o) ORDER BY o LOOP
    v_owner := CASE WHEN jsonb_typeof(v_owners) = 'string' THEN v_owners #>> '{}'
                    WHEN jsonb_typeof(v_owners) = 'object' AND v_owners ? (e->>'key') THEN v_owners->>(e->>'key')
                    ELSE e->>'owner' END;
    -- Delivery paths are checked for the 1-1 notes; the other forms' owners are a record of who delivers.
    IF v_owner = 'cockpit' AND e->>'owner' IS DISTINCT FROM 'cockpit' AND f.key = 'checkin' THEN
      v_clause := public.cockpit_form_delivery_ready(f.key, e->>'key');
      IF v_clause IS NOT NULL THEN
        RAISE EXCEPTION '% cannot move to the cockpit yet: %.', e->>'label', v_clause USING ERRCODE = '55000';
      END IF;
    END IF;
    v_effects := v_effects || jsonb_build_array(e || jsonb_build_object('owner', v_owner));
  END LOOP;
  IF v_provider = 'native' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_effects) q
        WHERE q->>'key' IN ('call_form','call_match') AND q->>'owner' IS DISTINCT FROM 'cockpit') THEN
    RAISE EXCEPTION 'Move the notes row and the recording match to the cockpit with the switch, or the notes reach no client brief.'
      USING ERRCODE = '22023';
  END IF;

  -- Nothing to change: the view, and no row.
  IF v_provider = f.provider AND v_effects = f.effects THEN
    RETURN public.cockpit_form_registry_view(f);
  END IF;

  PERFORM set_config('cockpit.forms_action', 'forms.registry_set', true);
  PERFORM set_config('cockpit.audit_actor', coalesce(nullif(btrim(v_actor->>'email'), ''), v_via), true);
  PERFORM set_config('cockpit.audit_source', v_via, true);
  UPDATE public.cockpit_forms x
     SET provider = v_provider, effects = v_effects,
         updated_by = coalesce(nullif(btrim(v_actor->>'email'), ''), v_via), updated_at = now()
   WHERE x.key = f.key
  RETURNING * INTO f;
  -- The flip closes every open shadow draft in the same transaction.
  IF v_provider = 'native' THEN
    PERFORM public.cockpit_form_shadow_close(f.key);
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN public.cockpit_form_registry_view(f);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_responses_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  -- Waves 1-2: two carve-outs for a stored termination survey or pause
  -- request (state legacy), each only under its transaction-local
  -- setting: a person's match to a card (task_id from none, set by
  -- cockpit_form_legacy_match) and the one answer to its notice
  -- (answer_meta.answered, added once, by 20261101o's notice answer).
  v_legacy boolean := OLD.state = 'legacy' AND OLD.form_key IN ('exit_survey','pause_request');
  v_match boolean := false;
  v_answer boolean := false;
BEGIN
  v_match := v_legacy AND coalesce(current_setting('cockpit.forms_legacy', true), '') = 'match'
             AND OLD.task_id IS NULL AND NEW.task_id IS NOT NULL;
  v_answer := v_legacy AND coalesce(current_setting('cockpit.forms_legacy', true), '') = 'answer'
              AND NOT (OLD.answer_meta ? 'answered') AND jsonb_typeof(NEW.answer_meta->'answered') = 'object'
              AND (NEW.answer_meta - 'answered') = OLD.answer_meta;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.form_key IS DISTINCT FROM OLD.form_key
     OR NEW.form_version IS DISTINCT FROM OLD.form_version OR NEW.source IS DISTINCT FROM OLD.source
     OR (NEW.task_id IS DISTINCT FROM OLD.task_id AND NOT v_match) OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A response keeps its form, version, source, card, mode, seat and creation time' USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'draft' AND (NEW.answers IS DISTINCT FROM OLD.answers
                              OR (NEW.answer_meta IS DISTINCT FROM OLD.answer_meta AND NOT v_answer)) THEN
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

-- ---------------------------------------------------------------------------
-- 6. The records (contract 3.1)

-- Whether a column exists, so a function here can read what a later file of
-- the block adds (20261101o's confirm columns on the churn register) without
-- naming it before it is there. Never to_regclass: the table already exists.
CREATE OR REPLACE FUNCTION public.cockpit_form_column_exists(p_table text, p_column text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = to_regclass('public.' || p_table) AND a.attname = p_column
                    AND a.attnum > 0 AND NOT a.attisdropped)
$$;

-- A termination survey on a card fills that card's open departure: the
-- latest one not removed, not confirmed and with no survey yet, credited to
-- p_by (forms-door, or the person who matched the survey). Guarded on the
-- columns 20261101o adds, so before o it stores nothing and says false.
CREATE OR REPLACE FUNCTION public.cockpit_form_survey_link(p_response_id uuid, p_task text, p_by text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer := 0;
BEGIN
  IF p_response_id IS NULL OR p_task IS NULL
     OR NOT public.cockpit_form_column_exists('cockpit_churn_departures', 'survey_response_id')
     OR NOT public.cockpit_form_column_exists('cockpit_churn_departures', 'confirmed_at') THEN
    RETURN false;
  END IF;
  EXECUTE 'UPDATE public.cockpit_churn_departures d SET survey_response_id = $1, survey_state = ''filled'','
          ' updated_by = $3, updated_at = now()'
          ' WHERE d.id = (SELECT x.id FROM public.cockpit_churn_departures x'
          '                WHERE x.clickup_task_id = $2 AND x.removed_at IS NULL AND x.confirmed_at IS NULL'
          '                  AND x.survey_response_id IS NULL'
          '                ORDER BY x.left_on DESC, x.id DESC LIMIT 1)'
    USING p_response_id, p_task, coalesce(nullif(btrim(p_by), ''), 'forms-door');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;

-- The forms door's writer for the two client Typeforms that stay live in
-- waves 1 and 2 (the termination survey knIe4eF3 and the pause request
-- CTUjv6l3), and the backfill's. One legacy response per Typeform token. The
-- card is the form's hidden onboarding_client_id when it is a card on the
-- billing sheet, else none: the typed or hidden client name is kept but never
-- matched (W12). A new termination survey queues its "Termination notice in"
-- for the CSM; a pause request queues nothing (its Today row is the signal,
-- W18); a backfilled row queues nothing at all (3.4).
--
-- The Typeform signature proves Typeform delivered the response, not who
-- filled it or which card it is for: the hidden id is in a public link anyone
-- can edit. So a card found that way is kept as hidden_id_unverified in
-- answer_meta, and the survey is never attached to a departure here: a
-- person attaches it (the churn confirm's survey pick, or
-- cockpit_form_legacy_match on an unmatched row). Signed links (an HMAC of
-- the card id in a second hidden field) would lift this; until they are
-- issued, the notice still reaches the card's CSM to check.
CREATE OR REPLACE FUNCTION public.cockpit_form_record_legacy(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_form text;
  v_token text;
  v_at timestamptz;
  v_backfill boolean;
  v_answers jsonb;
  v_hidden jsonb := '{}'::jsonb;
  v_raw jsonb;
  v_card text;
  v_task text;
  v_client text;
  v_form_client text;
  v_day date;
  v_id uuid;
  v_inserted boolean := false;
  v_matched boolean := false;
  v_notice uuid;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Send the response as an object.' USING ERRCODE = '22023';
  END IF;
  v_form := p->>'formKey';
  IF v_form IS NULL OR v_form NOT IN ('exit_survey','pause_request') THEN
    RAISE EXCEPTION 'Only the termination survey and the pause request are recorded here.' USING ERRCODE = '22023';
  END IF;
  v_token := p->>'externalId';
  IF v_token IS NULL OR v_token !~ '^[A-Za-z0-9]{8,64}$' THEN
    RAISE EXCEPTION 'That is not a Typeform response token.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_at := (p->>'submittedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_at := NULL;
  END;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'The response has no readable submit time.' USING ERRCODE = '22023';
  END IF;
  v_answers := CASE WHEN jsonb_typeof(p->'answers') = 'object' THEN p->'answers' END;
  IF v_answers IS NULL OR octet_length(v_answers::text) > 65536 THEN
    RAISE EXCEPTION 'Send the answers as an object under 64 KB.' USING ERRCODE = '22023';
  END IF;
  IF p ? 'backfill' AND jsonb_typeof(p->'backfill') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'Send backfill as true or false.' USING ERRCODE = '22023';
  END IF;
  v_backfill := coalesce((p->>'backfill')::boolean, false);
  -- Only the form's two hidden fields are kept (inventory 3.3 and 3.4), each a short string.
  v_raw := CASE WHEN jsonb_typeof(p->'hidden') = 'object' THEN p->'hidden' ELSE '{}'::jsonb END;
  v_hidden := jsonb_strip_nulls(jsonb_build_object(
    'client_name', CASE WHEN jsonb_typeof(v_raw->'client_name') = 'string'
                        THEN left(nullif(btrim(v_raw->>'client_name'), ''), 200) END,
    'onboarding_client_id', CASE WHEN jsonb_typeof(v_raw->'onboarding_client_id') = 'string'
                                 THEN left(nullif(btrim(v_raw->>'onboarding_client_id'), ''), 60) END));

  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = v_form;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The % form is not in the registry.', v_form USING ERRCODE = '22023';
  END IF;

  -- The card: the form's own hidden id, when it is a card on the billing sheet.
  v_card := coalesce(nullif(btrim(p->>'taskId'), ''), v_hidden->>'onboarding_client_id');
  IF v_card ~ '^[A-Za-z0-9_-]{1,40}$' THEN
    SELECT a.clickup_task_id, a.client_name INTO v_task, v_client
      FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_card;
  END IF;
  v_form_client := coalesce(left(nullif(btrim(p->>'clientName'), ''), 200), v_hidden->>'client_name');
  v_day := public.cockpit_form_kuwait_day(v_at);

  PERFORM set_config('cockpit.forms_action', 'forms.legacy_recorded', true);
  PERFORM set_config('cockpit.audit_actor', 'typeform', true);
  PERFORM set_config('cockpit.audit_source', CASE WHEN v_backfill THEN 'forms-backfill' ELSE 'forms-door' END, true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, answer_meta, hidden, created_by, submitted_by, submitted_at)
  VALUES (v_form, f.version, CASE WHEN v_backfill THEN 'typeform_sync' ELSE 'typeform_webhook' END, v_token, v_task,
          coalesce(v_client, v_form_client), 'live', 'legacy',
          v_answers,
          jsonb_build_object('notice_on', v_day)
            || CASE WHEN v_task IS NOT NULL THEN jsonb_build_object('match', 'hidden_id_unverified') ELSE '{}'::jsonb END,
          v_hidden, 'forms-door', 'typeform', v_at)
  ON CONFLICT (form_key, external_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    v_inserted := true;
    IF v_form = 'exit_survey' THEN
      -- Not attached to a departure here (the card is unverified, above); v_matched stays false.
      IF NOT v_backfill THEN
        -- Matched: the CSM of the card is tagged by name of the client.
        -- Unmatched: no card and no client, so every CSM seat is tagged and
        -- the form's own name is shown as the form gave it (W22).
        v_notice := public.cockpit_slack_notice_queue('termination.notice', 'termination:' || v_id::text, v_task,
          CASE WHEN v_task IS NOT NULL THEN v_client END,
          jsonb_strip_nulls(jsonb_build_object(
            'responseId', v_id, 'submittedAt', public.cockpit_slack_notice_iso(v_at), 'noticeOn', v_day,
            'matched', v_task IS NOT NULL, 'client', CASE WHEN v_task IS NOT NULL THEN v_client END,
            'formClientName', CASE WHEN v_task IS NULL THEN v_form_client END)),
          NULL, NULL, NULL);
      END IF;
    END IF;
  ELSE
    SELECT r.id, r.task_id INTO v_id, v_task FROM public.cockpit_form_responses r
     WHERE r.form_key = v_form AND r.external_id = v_token;
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN jsonb_build_object('inserted', v_inserted, 'responseId', v_id, 'matched', v_matched,
    'noticeQueued', v_notice IS NOT NULL, 'taskId', v_task);
END $$;

-- A person picks the card of a survey that arrived with none (W12, W22):
-- the CEO, or a CSM, only for one of their own clients.
CREATE OR REPLACE FUNCTION public.cockpit_form_legacy_match(p_response_id uuid, p_task_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb;
  r public.cockpit_form_responses;
  a public.cockpit_billing_accounts;
  v_ceo boolean;
  v_matched boolean := false;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_legacy text := current_setting('cockpit.forms_legacy', true);
BEGIN
  g := public.cockpit_form_actor();
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT v_ceo AND NOT coalesce(public.cockpit_has_role('csm'), false) THEN
    RAISE EXCEPTION 'Only a client success seat or the CEO matches a survey to a card.' USING ERRCODE = '42501';
  END IF;
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Pick a card from the list.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id FOR UPDATE;
  IF NOT FOUND OR r.form_key NOT IN ('exit_survey','pause_request') OR r.state <> 'legacy' THEN
    RAISE EXCEPTION 'Only a stored termination survey or pause request is matched here.' USING ERRCODE = '22023';
  END IF;
  IF r.task_id IS NOT NULL THEN
    RAISE EXCEPTION 'This survey is already matched to a card.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That card is not on the billing sheet. Pick another.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(a.client_name), false) THEN
    RAISE EXCEPTION '% is not one of your clients. Ask its CSM or the CEO to match it.', a.client_name USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('cockpit.forms_action', 'forms.legacy_match', true);
  PERFORM set_config('cockpit.forms_legacy', 'match', true);
  UPDATE public.cockpit_form_responses x SET task_id = a.clickup_task_id, client_name = a.client_name
   WHERE x.id = r.id;
  PERFORM set_config('cockpit.forms_legacy', coalesce(v_prev_legacy, ''), true);
  IF r.form_key = 'exit_survey' THEN
    v_matched := public.cockpit_form_survey_link(r.id, a.clickup_task_id, g->>'email');
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  RETURN jsonb_build_object('responseId', r.id, 'taskId', a.clickup_task_id, 'clientName', a.client_name,
    'matched', v_matched);
END $$;

-- The record of a staff form (extension, pause, resume, churn_confirm, mrr),
-- written inside the money and churn functions (20261101o, p) in the same
-- transaction as their billing event. One per request id: a repeat returns
-- the first. 'import' is the owner's path through Composio for the 6-row
-- churn backfill (Q5), and only with no signed-in seat.
CREATE OR REPLACE FUNCTION public.cockpit_form_staff_record(p_form_key text, p_task_id text, p_answers jsonb,
  p_request_id uuid, p_source text DEFAULT 'cockpit')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_uid uuid := auth.uid();
  v_by text;
  v_client text;
  v_id uuid;
  v_prev_action text := current_setting('cockpit.forms_action', true);
BEGIN
  IF p_form_key IS NULL OR p_form_key NOT IN ('extension','pause','resume','churn_confirm','mrr') THEN
    RAISE EXCEPTION 'There is no staff form called %.', coalesce(p_form_key, '') USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Send the form''s request id, so a second press saves nothing twice.' USING ERRCODE = '22023';
  END IF;
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_answers) IS DISTINCT FROM 'object' OR octet_length(p_answers::text) > 65536 THEN
    RAISE EXCEPTION 'Send the answers as an object under 64 KB.' USING ERRCODE = '22023';
  END IF;
  IF p_source = 'cockpit' THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Sign in before saving a form.' USING ERRCODE = '42501';
    END IF;
    SELECT lower(btrim(u.email)) INTO v_by FROM auth.users u WHERE u.id = v_uid;
    IF v_by IS NULL THEN
      RAISE EXCEPTION 'Sign in before saving a form.' USING ERRCODE = '42501';
    END IF;
  ELSIF p_source = 'import' THEN
    IF v_uid IS NOT NULL THEN
      RAISE EXCEPTION 'An import runs only from the owner''s SQL, never from a seat.' USING ERRCODE = '42501';
    END IF;
    v_by := 'the CEO''s word (Q5), 2026-11-01';
  ELSE
    RAISE EXCEPTION 'Choose cockpit or import.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The % form is not in the registry.', p_form_key USING ERRCODE = '22023';
  END IF;
  SELECT a.client_name INTO v_client FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task_id;
  PERFORM set_config('cockpit.forms_action', 'forms.staff_recorded', true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, created_by, created_by_id, submitted_by, submitted_at, confirmed_by, confirmed_at)
  VALUES (p_form_key, f.version, p_source, 'req:' || p_request_id::text, p_task_id, v_client, 'live', 'confirmed',
          p_answers, v_by, CASE WHEN p_source = 'cockpit' THEN v_uid END, v_by, now(), v_by, now())
  ON CONFLICT (form_key, external_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.cockpit_form_responses r
     WHERE r.form_key = p_form_key AND r.external_id = 'req:' || p_request_id::text;
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  RETURN v_id;
END $$;

-- FormSheet's after-send trail (contract 3.1, 5.1): where one saved staff
-- form, billing change, survey or departure has got to. Names, states and
-- plain sentences only: never a token, an address or a request body.
CREATE OR REPLACE FUNCTION public.cockpit_form_trail(p_ref jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.cockpit_billing_events;
  d public.cockpit_churn_departures;
  r public.cockpit_form_responses;
  q public.cockpit_clickup_writeback_queue;
  n public.cockpit_slack_notices;
  v_event bigint;
  v_dep bigint;
  v_resp uuid;
  v_task text;
  v_name text;
  v_ok boolean;
  v_mode text;
  v_card_state text;
  v_channel text;
  v_channel_name text;
  v_channel_ok boolean;
  v_notice_state text;
  v_notice_error text;
  v_stored timestamptz;
BEGIN
  PERFORM public.cockpit_form_actor();
  IF jsonb_typeof(p_ref) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Say which saved form to follow.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_ref->>'eventId', '') ~ '^[0-9]{1,18}$' THEN v_event := (p_ref->>'eventId')::bigint; END IF;
  IF coalesce(p_ref->>'departureId', '') ~ '^[0-9]{1,18}$' THEN v_dep := (p_ref->>'departureId')::bigint; END IF;
  IF coalesce(p_ref->>'responseId', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_resp := (p_ref->>'responseId')::uuid;
  END IF;
  IF v_event IS NULL AND v_dep IS NULL AND v_resp IS NULL THEN
    RAISE EXCEPTION 'Say which saved form to follow.' USING ERRCODE = '22023';
  END IF;
  IF v_dep IS NOT NULL THEN
    SELECT * INTO d FROM public.cockpit_churn_departures x WHERE x.id = v_dep;
    -- The confirm's own billing event (20261101o), read by name.
    IF d.id IS NOT NULL AND v_event IS NULL AND public.cockpit_form_column_exists('cockpit_churn_departures', 'billing_event_id') THEN
      EXECUTE 'SELECT x.billing_event_id FROM public.cockpit_churn_departures x WHERE x.id = $1' INTO v_event USING d.id;
    END IF;
  END IF;
  IF v_event IS NOT NULL THEN
    SELECT * INTO e FROM public.cockpit_billing_events x WHERE x.id = v_event;
  END IF;
  IF v_resp IS NOT NULL THEN
    SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = v_resp;
  END IF;

  -- The gate: the CEO, finance, or a CSM allowed on the card (any CSM for a
  -- survey not matched to a card yet, W22).
  v_task := coalesce(e.clickup_task_id, d.clickup_task_id, r.task_id);
  SELECT a.client_name INTO v_name FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_task;
  v_name := coalesce(v_name, e.client_name, d.client, r.client_name);
  v_ok := coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('finance'), false)
          OR (coalesce(public.cockpit_has_role('csm'), false)
              AND ((v_task IS NULL AND r.id IS NOT NULL AND e.id IS NULL AND d.id IS NULL)
                   OR coalesce(public.cockpit_client_allowed(v_name), false)));
  IF NOT v_ok THEN
    RAISE EXCEPTION 'That client is not on your access list' USING ERRCODE = '42501';
  END IF;

  v_stored := coalesce(e.at, r.confirmed_at, r.submitted_at, r.created_at, d.created_at);

  -- The card: the billing event's queue item (20261009j's dedupe), held while
  -- its kind's card writes are off (dry_run, 1.4).
  IF e.id IS NOT NULL THEN
    SELECT * INTO q FROM public.cockpit_clickup_writeback_queue x
     WHERE x.kind = 'billing' AND x.source_table = 'cockpit_billing_events' AND x.source_id = e.id::text
     ORDER BY x.created_at DESC LIMIT 1;
    SELECT s.detail->>'mode' INTO v_mode FROM public.cockpit_sync_state s WHERE s.key = 'clickup-writeback:billing';
  END IF;
  v_card_state := CASE q.state
    WHEN 'dry_run' THEN 'held' WHEN 'queued' THEN 'queued' WHEN 'sending' THEN 'sending' WHEN 'unknown' THEN 'sending'
    WHEN 'retry' THEN 'retry' WHEN 'delivered' THEN 'delivered' WHEN 'skipped' THEN 'skipped' WHEN 'failed' THEN 'failed'
    ELSE 'none' END;

  -- The notice: the one this record queued (its dedupe key or its facts).
  SELECT * INTO n FROM public.cockpit_slack_notices x
   WHERE x.kind <> 'rehearsal'
     AND ((e.id IS NOT NULL AND x.facts->>'eventId' = e.id::text)
       OR (d.id IS NOT NULL AND (x.dedupe_key = 'churn:' || d.id::text OR x.facts->>'departureId' = d.id::text))
       OR (r.id IS NOT NULL AND (x.dedupe_key = 'termination:' || r.id::text OR x.facts->>'responseId' = r.id::text)))
   ORDER BY x.created_at DESC, x.id LIMIT 1;
  IF n.id IS NOT NULL THEN
    v_channel := coalesce(n.channel, n.target, public.cockpit_slack_notice_target(n.kind));
    SELECT c.name, c.state = 'ok' INTO v_channel_name, v_channel_ok FROM public.cockpit_slack_channels c WHERE c.id = v_channel;
    v_notice_state := CASE n.state WHEN 'queued' THEN 'queued' WHEN 'sending' THEN 'queued' WHEN 'unknown' THEN 'queued'
                                   WHEN 'posted' THEN 'posted' WHEN 'failed' THEN 'failed' WHEN 'skipped' THEN 'skipped'
                                   WHEN 'muted' THEN 'muted' END;
    -- A channel the bot is not in yet (the S0 rows until the CEO invites it, Q4) says so in the contract's words.
    v_notice_error := CASE
      WHEN n.state = 'failed' AND v_channel IS NOT NULL AND NOT coalesce(v_channel_ok, false)
        THEN 'Not posted: the bot is not in #' || coalesce(v_channel_name, v_channel) || '. Ask the CEO to invite it.'
      WHEN n.state = 'unknown' THEN 'Slack has not confirmed the post yet; the cockpit checks it.'
      WHEN n.state IN ('failed','skipped','muted') THEN n.error END;
  END IF;

  RETURN jsonb_build_object(
    'stored', jsonb_build_object('state', CASE WHEN v_stored IS NOT NULL THEN 'done' ELSE 'none' END, 'at', v_stored),
    'card', jsonb_build_object('state', v_card_state, 'mode', v_mode,
                               'error', CASE WHEN q.state IN ('retry','failed','skipped') THEN left(q.error, 240) END,
                               'at', coalesce(q.delivered_at, q.updated_at)),
    'notice', jsonb_build_object('kind', n.kind, 'state', coalesce(v_notice_state, 'none'),
                                 'channelName', v_channel_name, 'error', v_notice_error, 'permalink', n.permalink));
END $$;

-- The derived "Notice in" and "Pause request in" rows (contract 3.1, W5): a
-- person acts on each; nothing here opens a ticket. A survey answered in the
-- cockpit, a termination survey covered by a churn confirmed after it, or a
-- pause request followed by a pause on its card drops out.
CREATE OR REPLACE FUNCTION public.cockpit_form_notices_in()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ceo boolean;
  v_confirm boolean;
  v_covered uuid[] := '{}'::uuid[];
  v_open jsonb := '{}'::jsonb;
  v_rows jsonb;
BEGIN
  PERFORM public.cockpit_form_actor();
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT v_ceo AND NOT coalesce(public.cockpit_has_role('csm'), false) THEN
    RAISE EXCEPTION 'Notices in are for client success and the CEO.' USING ERRCODE = '42501';
  END IF;
  -- 20261101o's confirm columns, read by name: before o no departure is confirmed.
  v_confirm := public.cockpit_form_column_exists('cockpit_churn_departures', 'confirmed_at');
  IF v_confirm THEN
    EXECUTE 'SELECT coalesce(array_agg(r.id), ''{}''::uuid[]) FROM public.cockpit_form_responses r'
            ' WHERE r.form_key = ''exit_survey'' AND r.task_id IS NOT NULL AND EXISTS ('
            '   SELECT 1 FROM public.cockpit_churn_departures d WHERE d.clickup_task_id = r.task_id AND d.removed_at IS NULL'
            '      AND d.confirmed_at IS NOT NULL'
            '      AND (d.confirmed_at >= r.submitted_at OR d.left_on >= (r.answer_meta->>''notice_on'')::date))'
      INTO v_covered;
    EXECUTE 'SELECT coalesce(jsonb_object_agg(x.t, x.id), ''{}''::jsonb) FROM ('
            '  SELECT DISTINCT ON (d.clickup_task_id) d.clickup_task_id AS t, d.id FROM public.cockpit_churn_departures d'
            '   WHERE d.removed_at IS NULL AND d.confirmed_at IS NULL AND d.clickup_task_id IS NOT NULL'
            '   ORDER BY d.clickup_task_id, d.left_on DESC, d.id DESC) x'
      INTO v_open;
  ELSE
    SELECT coalesce(jsonb_object_agg(x.t, x.id), '{}'::jsonb) INTO v_open
      FROM (SELECT DISTINCT ON (d.clickup_task_id) d.clickup_task_id AS t, d.id FROM public.cockpit_churn_departures d
             WHERE d.removed_at IS NULL AND d.clickup_task_id IS NOT NULL
             ORDER BY d.clickup_task_id, d.left_on DESC, d.id DESC) x;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kind', CASE WHEN z.form_key = 'exit_survey' THEN 'termination' ELSE 'pause_request' END,
           'responseId', z.id,
           'taskId', z.task_id,
           'clientName', z.shown_name,
           'noticeOn', z.answer_meta->>'notice_on',
           'submittedAt', z.submitted_at,
           'matched', z.task_id IS NOT NULL,
           'departureId', CASE WHEN z.form_key = 'exit_survey' AND z.task_id IS NOT NULL
                               THEN (v_open->>z.task_id)::bigint END)
         ORDER BY z.submitted_at DESC, z.id), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT r.*,
                 CASE WHEN r.task_id IS NULL THEN coalesce(r.hidden->>'client_name', r.client_name)
                      ELSE coalesce(a.client_name, r.client_name) END AS shown_name,
                 a.client_name AS card_name
            FROM public.cockpit_form_responses r
            LEFT JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = r.task_id
           WHERE r.form_key IN ('exit_survey','pause_request') AND r.mode = 'live'
             AND r.state IN ('legacy','submitted','confirmed')
             AND NOT (r.answer_meta ? 'answered')
             AND NOT (r.id = ANY(v_covered))
             AND NOT (r.form_key = 'pause_request' AND r.task_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.cockpit_billing_events e
                    WHERE e.clickup_task_id = r.task_id AND e.kind = 'pause' AND e.at > r.submitted_at))
           ORDER BY r.submitted_at DESC, r.id
           LIMIT 200) z
   -- Matched rows: the CEO, or the CSM of the client. Unmatched: every CSM seat (W22).
   WHERE z.task_id IS NULL OR v_ceo OR coalesce(public.cockpit_client_allowed(coalesce(z.card_name, z.client_name)), false);
  RETURN v_rows;
END $$;

-- Which new doors may show (contract 3.1): a door is open only when every
-- function it calls exists and its migration's marker in forms.doors is
-- true, so a rollback that restores an old body (which still exists) closes
-- the door by flipping the marker. Any signed-in seat.
CREATE OR REPLACE FUNCTION public.cockpit_form_doors()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_marks jsonb;
  v_churn boolean;
  v_money boolean;
  v_checks boolean;
  v_base boolean;
BEGIN
  PERFORM public.cockpit_form_actor();
  SELECT CASE WHEN jsonb_typeof(c.value) = 'object' THEN c.value END INTO v_marks
    FROM public.cockpit_settings c WHERE c.key = 'forms.doors';
  v_marks := coalesce(v_marks, '{}'::jsonb);
  v_churn := coalesce(v_marks->>'churn', '') = 'true';
  v_money := coalesce(v_marks->>'money', '') = 'true';
  v_checks := coalesce(v_marks->>'checks', '') = 'true';
  -- This file's own reads and record, which every door's screen uses.
  v_base := to_regprocedure('public.cockpit_form_trail(jsonb)') IS NOT NULL
            AND to_regprocedure('public.cockpit_form_notices_in()') IS NOT NULL
            AND to_regprocedure('public.cockpit_form_staff_record(text,text,jsonb,uuid,text)') IS NOT NULL;
  RETURN jsonb_build_object(
    'churnConfirm', v_base AND v_churn
      AND to_regprocedure('public.cockpit_client_lifecycle_confirm(text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_notice_answer(uuid,text,text)') IS NOT NULL
      AND to_regprocedure('public.cockpit_client_lifecycle_read(text)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_legacy_match(uuid,text)') IS NOT NULL,
    'extension', v_base AND v_money
      AND to_regprocedure('public.cockpit_billing_write(text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.cockpit_extensions_read(date,date)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_prefill(text,text)') IS NOT NULL,
    'pause', v_base AND v_money
      AND to_regprocedure('public.cockpit_billing_write(text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.cockpit_billing_ladder_read()') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_prefill(text,text)') IS NOT NULL,
    'mrr', v_base AND v_money
      AND to_regprocedure('public.cockpit_billing_write(text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.cockpit_mrr_read()') IS NOT NULL,
    'reviews', v_base AND v_money
      AND to_regprocedure('public.cockpit_billing_ladder_due()') IS NOT NULL
      AND to_regprocedure('public.cockpit_billing_ladder_read()') IS NOT NULL,
    'checks', v_base AND v_checks
      AND to_regprocedure('public.cockpit_manual_payment_check(text,text,text,text)') IS NOT NULL
      AND to_regprocedure('public.cockpit_manual_payments_to_check()') IS NOT NULL,
    'prefill', v_base AND v_money
      AND to_regprocedure('public.cockpit_form_prefill(text,text)') IS NOT NULL);
END $$;

-- Deploy step D-R1 only (contract 3.1, W5): one new request type, after its
-- option exists on ClickUp's Request Type field. The type guard checks the
-- row (20261026r, cockpit_request_type_problem); version 1 is its record.
CREATE OR REPLACE FUNCTION public.cockpit_request_type_add(p_row jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n public.cockpit_request_types;
  v_key text := p_row->>'key';
BEGIN
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Send the request type as an object.' USING ERRCODE = '22023';
  END IF;
  IF v_key IS NULL OR EXISTS (SELECT 1 FROM public.cockpit_request_types t WHERE t.key = v_key) THEN
    RAISE EXCEPTION 'The request type % already exists. Change it in the editor instead.', coalesce(v_key, '(no key)')
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_row->'type_index') IS DISTINCT FROM 'number' OR jsonb_typeof(p_row->'due_days') IS DISTINCT FROM 'number'
     OR coalesce(p_row->>'request_type_option_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     OR jsonb_typeof(p_row->'targets') IS DISTINCT FROM 'array' OR jsonb_typeof(p_row->'fields') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Send key, type_index, label, clickup_option_name, request_type_option_id, team, targets, fields, due_days and priority.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_source', 'migration', true);
  INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
    targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
  VALUES (v_key, (p_row->>'type_index')::smallint, p_row->>'label', p_row->>'clickup_option_name',
          (p_row->>'request_type_option_id')::uuid, coalesce(p_row->>'team', p_row->'targets'->0->>'team'),
          public.cockpit_request_targets_checked(p_row->'targets', NULL), p_row->'fields',
          CASE WHEN jsonb_typeof(p_row->'sop_steps') = 'array' THEN p_row->'sop_steps' END,
          CASE WHEN jsonb_typeof(p_row->'sop_steps') = 'array' THEN 'draft' ELSE 'none' END,
          p_row->>'sop_url', (p_row->>'due_days')::smallint, p_row->>'priority',
          coalesce((p_row->>'set_request_type')::boolean, false), coalesce((p_row->>'enabled')::boolean, true), 1,
          'deploy D-R1 (waves 1-2)')
  RETURNING * INTO n;
  INSERT INTO public.cockpit_request_type_versions (key, version, "row", saved_by, note)
  VALUES (n.key, 1, to_jsonb(n), 'deploy D-R1 (waves 1-2)', 'Added at deploy step D-R1 of the waves 1-2 contract');
  PERFORM public.cockpit_request_audit('request_type.added', 'cockpit_request_types', n.key, 'deploy D-R1 (waves 1-2)',
    NULL, to_jsonb(n), jsonb_build_object('version', 1));
  RETURN n.key;
END $$;

-- A card's termination surveys and pause requests, newest first (the Today
-- rows and the churn tracker read them by card).
CREATE INDEX IF NOT EXISTS cockpit_form_responses_exit_task
  ON public.cockpit_form_responses (task_id, submitted_at DESC) WHERE form_key IN ('exit_survey','pause_request');

-- ---------------------------------------------------------------------------
-- 7. The registry rows (2.3), each with its version 1. The two client forms
--    stay filled in Typeform; the five staff forms are code-defined
--    (apps/*/src/forms/staff/formDefs.ts) and their schema here is a record
--    of the same field keys (W19; readers-supabase.test.ts keeps them equal).

SELECT set_config('cockpit.audit_actor', 'migration', true), set_config('cockpit.audit_source', 'migration', true);

INSERT INTO public.cockpit_forms (key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
VALUES
  ('exit_survey', 'Termination survey', 'client', 'typeform', 'knIe4eF3', 1,
   '{"key":"exit_survey","version":1,"fields":[],"lives":"typeform","typeformId":"knIe4eF3"}'::jsonb, ARRAY['csm'], true,
   '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Stored in the cockpit"},
     {"key":"termination_notice","owner":"cockpit","delivery":"slack_notice","label":"Termination notice in #csm-general"},
     {"key":"announcement","owner":"make","delivery":"slack_notice","label":"Termination post in #csm-announcements (Make)"}]'::jsonb,
   'migration 20261101l'),
  ('pause_request', 'Pause request', 'client', 'typeform', 'CTUjv6l3', 1,
   '{"key":"pause_request","version":1,"fields":[],"lives":"typeform","typeformId":"CTUjv6l3"}'::jsonb, ARRAY['csm'], true,
   '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Stored in the cockpit"},
     {"key":"card_pause","owner":"make","delivery":"clickup_queue","label":"Pause on the card (Make, until the staff pause owns it)"}]'::jsonb,
   'migration 20261101l'),
  ('extension', 'Give more time', 'team', 'native', NULL, 1,
   '{"key":"extension","version":1,"lives":"apps/client-success-cockpit/src/forms/staff/formDefs.ts",
     "fields":[{"key":"weeks"},{"key":"reason"},{"key":"ours"},{"key":"limitations"},{"key":"atRisk"},
               {"key":"callId"},{"key":"noCall"},{"key":"noCallReason"},{"key":"prevent"}]}'::jsonb, ARRAY['csm'], true,
   '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Saved in the cockpit"},
     {"key":"card","owner":"cockpit","delivery":"clickup_queue","label":"The ClickUp card"},
     {"key":"notice","owner":"cockpit","delivery":"slack_notice","label":"Extension given in #csm-announcements"}]'::jsonb,
   'migration 20261101l'),
  ('pause', 'Pause this client', 'team', 'native', NULL, 1,
   '{"key":"pause","version":1,"lives":"apps/client-success-cockpit/src/forms/staff/formDefs.ts",
     "fields":[{"key":"pauseKind"},{"key":"restart"},{"key":"reasonCat"},{"key":"reason"},{"key":"callId"},
               {"key":"consentTerm"},{"key":"consentOver14"}]}'::jsonb, ARRAY['csm'], true,
   '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Saved in the cockpit"},
     {"key":"card","owner":"cockpit","delivery":"clickup_queue","label":"The ClickUp card"},
     {"key":"notice","owner":"cockpit","delivery":"slack_notice","label":"Pause agreed in #csm-announcements"}]'::jsonb,
   'migration 20261101l'),
  ('resume', 'Resume this client', 'team', 'native', NULL, 1,
   '{"key":"resume","version":1,"lives":"apps/client-success-cockpit/src/forms/staff/formDefs.ts",
     "fields":[{"key":"on"},{"key":"nextDate"}]}'::jsonb, ARRAY['csm'], true,
   '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Saved in the cockpit"},
     {"key":"card","owner":"cockpit","delivery":"clickup_queue","label":"The ClickUp card"},
     {"key":"notice","owner":"cockpit","delivery":"slack_notice","label":"Client resumed in #csm-announcements"}]'::jsonb,
   'migration 20261101l'),
  ('churn_confirm', 'Client is leaving', 'team', 'native', NULL, 1,
   '{"key":"churn_confirm","version":1,"lives":"apps/client-success-cockpit/src/forms/staff/formDefs.ts",
     "fields":[{"key":"leftOn"},{"key":"noticeOn"},{"key":"reason"},{"key":"churnType"},{"key":"whyDetail"},
               {"key":"howToStop"},{"key":"mrrLostUsd"},{"key":"exitCallId"},{"key":"surveyState"}]}'::jsonb, ARRAY['csm'], true,
   '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Saved in the churn register"},
     {"key":"card","owner":"cockpit","delivery":"clickup_queue","label":"The ClickUp card"},
     {"key":"notice","owner":"cockpit","delivery":"slack_notice","label":"Client has left in #csm-announcements"}]'::jsonb,
   'migration 20261101l'),
  ('mrr', 'Set MRR', 'team', 'native', NULL, 1,
   '{"key":"mrr","version":1,"lives":"apps/client-success-cockpit/src/forms/staff/formDefs.ts",
     "fields":[{"key":"mrrUsd"},{"key":"reasonCat"},{"key":"reason"},{"key":"effective"}]}'::jsonb, ARRAY['csm'], true,
   '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Saved in the cockpit"},
     {"key":"card","owner":"cockpit","delivery":"clickup_queue","label":"The ClickUp card"}]'::jsonb,
   'migration 20261101l')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.cockpit_form_versions (form_key, version, schema, published_by, note)
SELECT f.key, 1, f.schema, 'migration 20261101l',
       CASE WHEN f.provider = 'typeform' THEN 'Filled in Typeform; stored by forms-door.'
            ELSE 'A record of formDefs.ts (W19); set in code until the form editor ships.' END
  FROM public.cockpit_forms f
 WHERE f.key IN ('exit_survey','pause_request','extension','pause','resume','churn_confirm','mrr')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. The six settings rows (3.4), each insert with one notices.setting_seeded
--    audit row (a second apply inserts and writes none)

DO $$
DECLARE s record;
BEGIN
  FOR s IN
    INSERT INTO public.cockpit_slack_notice_settings (kind, enabled, channel, mention_rule, updated_by) VALUES
      ('termination.notice', true, 'C09RZ0GS0V9', ARRAY['seat:csm']::text[], 'migration'),
      -- Off while Make 9805538 [5] still posts the same line in #csm-announcements (W4).
      ('termination.submitted', false, 'C09SNG5BP53', '{}'::text[], 'migration'),
      ('churn.confirmed', true, 'C09SNG5BP53', '{}'::text[], 'migration'),
      ('extension.granted', true, 'C09SNG5BP53', '{}'::text[], 'migration'),
      ('pause.agreed', true, 'C09SNG5BP53', '{}'::text[], 'migration'),
      ('client.resumed', true, 'C09SNG5BP53', '{}'::text[], 'migration')
    ON CONFLICT (kind) DO NOTHING
    RETURNING kind, enabled, channel
  LOOP
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('notices.setting_seeded', 'cockpit_slack_notice_settings', s.kind, 'migration', 'client-success', 'supabase', NULL,
            jsonb_build_object('kind', s.kind, 'enabled', s.enabled, 'channel', s.channel), jsonb_build_object('op', 'insert'));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges: revoked from all four roles, then exactly as 2.2
--    and 2.3 say. The replaced ones keep their live grants.

DO $$
DECLARE f text;
BEGIN
  -- Internal: the owner only.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_slack_notice_shape(text)', 'cockpit_slack_notice_kind_label(text)',
    'cockpit_slack_notice_live(public.cockpit_slack_notices)', 'cockpit_forms_key_label(text)',
    'cockpit_form_registry_apply(text,jsonb,jsonb)', 'cockpit_form_responses_guard()',
    'cockpit_form_column_exists(text,text)', 'cockpit_form_survey_link(uuid,text,text)',
    'cockpit_form_staff_record(text,text,jsonb,uuid,text)', 'cockpit_request_type_add(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- The sender's, the doctor's, forms-door's and the key script's: the service key only.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_slack_notice_inputs(jsonb)', 'cockpit_slack_notice_doctor_inputs()',
    'cockpit_slack_notice_rehearse_service(text,text)', 'cockpit_forms_key_put(jsonb)', 'cockpit_forms_key_mark(jsonb)',
    'cockpit_forms_door_seen(text,text,text)', 'cockpit_form_record_legacy(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- The screens' RPCs: a signed-in seat, gated inside.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_slack_notice_read(text)', 'cockpit_slack_notice_settings_read()',
    'cockpit_slack_notice_settings_set(text,jsonb)', 'cockpit_slack_channel_remove(text)',
    'cockpit_slack_notice_rehearse(text)', 'cockpit_forms_keys_status()',
    'cockpit_form_legacy_match(uuid,text)', 'cockpit_form_trail(jsonb)', 'cockpit_form_notices_in()',
    'cockpit_form_doors()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
