-- The 1-1 notes notices: the call grade and the recap reminder
-- (docs/forms/STAGE2B-CONTRACT.md 2.5 and 4.2, build 2). Creative Triage
-- (bldgtotkfmhoxmlzowdx). Additive; applies twice. Migration u of 2b's eight
-- (20261029s to 20261029z); it stands on 20261025n (the notices) and 2a's
-- forms tables (20261027f to h), and calls 20261029s's owner gate.
--
-- 1. Two kinds join the notices: checkin.grade (the stored grade of a
--    recorded 1-1 call, posted once per call in #client-call-feedback, a
--    private channel, tagging nobody) and checkin.recap_late (a recap still
--    not sent 24 hours after the call, in #csm-general). Their settings rows
--    are seeded on, with one notices.setting_seeded audit row per row the
--    seed really inserted; while the checkin registry is shadow nothing can
--    queue either kind (the grade comes only from the 2b dispatch, and the
--    reminder only for a live response's cockpit-owned recap), so the
--    registry owner is the switch (Z25) and Settings, Notices and routing
--    the kill switch.
-- 2. Thirteen notice functions of 20261025n are replaced, each with the
--    smallest edit: the kind lists, the labels, the call grade's live read
--    (by the draft its facts name, never facts, Z7), the claim's steps 1c
--    (the owner gate, the recording, the grade, the private channel) and 1d
--    (the recap since sent or skipped, the owner), the Call grade rules in
--    settings_set, check-in notices hidden from a creative-only seat, and
--    the kick's two guarded calls at its top (the recap reminder sweep and
--    20261029w's effects kick, Z10). Each keeps its live grants. The Stage 1
--    notices behave exactly as before.
-- 3. cockpit_slack_notice_sweep_checkin(): the reminder sweep, run by the
--    kick only.
--
-- The drift guard (section 2.1, Z61) opens the file: each replaced body must
-- still be the one the contract read (the live body md5) or this file's own
-- (the after md5, a second apply); otherwise nothing here applies.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (Z61): md5 of the whitespace-normalised prosrc, before
--    or after this file.

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_slack_notices_kick()', '49fd012b2325fbaeae9d28b7ea268dd1', '7b4d09c4c87ebf5655fab2b0c5d7a9b6'),
      ('public.cockpit_slack_notice_claim(integer,uuid)', 'b415014351f4aa144aa845cbabf6cec0', 'cd439569a4e99c98b38dca5c6a69ff24'),
      ('public.cockpit_slack_notice_live(public.cockpit_slack_notices)', '3644e7cd5eb63c7719fd5ff3666a8d84', '236e6af483f41c3514d7dc41e6a81086'),
      ('public.cockpit_slack_notice_shape(text)', '4c02edfc21ceaa750e57f5cea8c9e547', 'a22c7f71b3a8398c96b0dcb5336b7f0d'),
      ('public.cockpit_slack_notice_kind_label(text)', '499725dbaac9baf12f000161438c63d7', 'fea0b1c735a76ecfdd5d6880615f9f3d'),
      ('public.cockpit_slack_notice_inputs(jsonb)', 'b4c826e37e783201fb3d777e5309b902', '2d980b72862995467fdca66da74945c7'),
      ('public.cockpit_slack_notice_doctor_inputs()', '0a5c57a07e31ab08c7259dcb8f3d18f4', 'a17ee0591518eb3f5eb0fae0cc2b9a02'),
      ('public.cockpit_slack_notice_settings_read()', 'a6cf20c2d9129b5716de6cda89f4192d', '57b78a275b1378ef49b9d092c70f86a0'),
      ('public.cockpit_slack_notice_settings_set(text,jsonb)', '80e2a814b671a43e0e78fe95788db934', '37cfe1700eaae4a1d23b6000ed3429a9'),
      ('public.cockpit_slack_channel_remove(text)', '1b21f1b259844b485b132f0a331bb97d', '36a18b31cd6ffefb87ebe234264db782'),
      ('public.cockpit_slack_notice_rehearse(text)', 'b8264c6a7f918e76a56bf750ab46ecec', '62fb92a21b367ab6b98eabdeb07a071c'),
      ('public.cockpit_slack_notice_rehearse_service(text,text)', '036e4ea0b8088ff3b259b229ef79a0ec', 'bc273014f46cf04a06c95b61d46a1ba2'),
      ('public.cockpit_slack_notice_read(text)', '4ae835e5809a599d0e4af167b8153dc0', '8937626f99eaf17aed97080144a9a05c')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since the 2b contract read it; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The two kinds in the CHECKs (each re-added only while it lacks them)

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notice_settings'::regclass AND c.conname = 'cockpit_slack_notice_settings_kind_check';
  IF v_def IS NULL OR v_def NOT LIKE '%checkin.recap_late%' THEN
    ALTER TABLE public.cockpit_slack_notice_settings DROP CONSTRAINT IF EXISTS cockpit_slack_notice_settings_kind_check;
    ALTER TABLE public.cockpit_slack_notice_settings ADD CONSTRAINT cockpit_slack_notice_settings_kind_check
      CHECK (kind IN ('kickoff','kickoff.late','kickoff.second','kickoff.updated',
                      'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                      'checkin.grade','checkin.recap_late'));
  END IF;

  -- Only the top-level kinds name a channel; the two 1-1 notes kinds are top level.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notice_settings'::regclass AND c.conname = 'cockpit_slack_notice_settings_check';
  IF v_def IS NULL OR v_def NOT LIKE '%checkin.recap_late%' THEN
    ALTER TABLE public.cockpit_slack_notice_settings DROP CONSTRAINT IF EXISTS cockpit_slack_notice_settings_check;
    ALTER TABLE public.cockpit_slack_notice_settings ADD CONSTRAINT cockpit_slack_notice_settings_check
      CHECK ((kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late')) = (channel IS NOT NULL));
  END IF;

  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_kind_check';
  IF v_def IS NULL OR v_def NOT LIKE '%checkin.recap_late%' THEN
    ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT IF EXISTS cockpit_slack_notices_kind_check;
    ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_kind_check
      CHECK (kind IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated',
                      'blueprint.media','blueprint.offer','rehearsal','checkin.grade','checkin.recap_late'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. #client-call-feedback (live, the row is already ok and private, so this
--    changes nothing; a fresh database checks it like any added channel)

INSERT INTO public.cockpit_slack_channels (id, name, private, state, note, added_by)
VALUES ('C09SVG6FHGU', 'client-call-feedback', true, 'checking', 'Checking that mahara-club-bot is in it.', 'migration')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The thirteen replaced functions: 20261025n's bodies with the edits of
--    contract 4.2 (the PGlite suite proves each edit, line for line)

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_shape(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late') THEN 'post'
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
    ELSE p_kind
  END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_live(p_row public.cockpit_slack_notices)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text; v_updated timestamptz; v_links jsonb; v_sub timestamptz; v_by text; v_launch timestamptz;
  v_rec text; v_grade jsonb; v_class text; v_gone timestamptz; v_call_gone boolean; v_email text; v_starts timestamptz;
  v_share text; v_effect text; v_ref text; v_message text;
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

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_claim(p_limit integer, p_only uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lim integer := least(greatest(coalesce(p_limit, 10), 1), 25);
  v_n integer := 0;
  v_rows jsonb := '[]'::jsonb;
  r public.cockpit_slack_notices;
  p public.cockpit_slack_notices;
  v_found boolean;
  v_enabled boolean;
  v_top boolean;
  v_target text;
  v_thread text;
  v_lookup text;
  v_email text;
  v_sub timestamptz;
  v_event timestamptz;
  v_status text;
  v_updated timestamptz;
  v_row jsonb;
  v_gate jsonb;
  v_live jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cockpit_slack_notices', 0)) THEN
    RETURN jsonb_build_object('busy', true, 'rows', '[]'::jsonb);
  END IF;
  PERFORM set_config('cockpit.audit_source', 'cron', true);

  FOR r IN
    SELECT * FROM public.cockpit_slack_notices x
     WHERE x.state = 'queued' AND x.next_attempt_at <= now() AND (p_only IS NULL OR x.id = p_only)
     ORDER BY x.created_at, x.id
     FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN v_n >= v_lim;
    v_top := true;
    v_target := NULL;
    v_thread := NULL;
    v_lookup := NULL;

    -- 1. Turned off: muted, never sent.
    v_enabled := NULL;
    IF r.kind <> 'rehearsal' THEN
      SELECT s.enabled INTO v_enabled FROM public.cockpit_slack_notice_settings s WHERE s.kind = r.kind;
    END IF;
    IF v_enabled IS FALSE THEN
      UPDATE public.cockpit_slack_notices SET state = 'muted', finished_at = now(),
             error = 'Turned off in Settings, Notices and routing.'
       WHERE id = r.id;
      CONTINUE;
    END IF;

    -- 1b. Too old to be true now. After an outage (the vault secret, the
    --     bot's token, the sender) a backlog must end in a recorded skip,
    --     never in posts whose words no longer hold ("20 minutes after the
    --     kickoff" days later). The event's own time: the kickoff's submit,
    --     the close's, the offer's or the confirmation's, else when the row
    --     was queued. A late kickoff's reply keeps its own 48-hour rule (2).
    IF r.kind NOT IN ('rehearsal','kickoff.updated') THEN
      v_event := coalesce(public.cockpit_slack_notice_ts(r.facts->>'submittedAt'),
                          public.cockpit_slack_notice_ts(r.facts->>'closedAt'),
                          public.cockpit_slack_notice_ts(r.facts->>'offeredAt'),
                          public.cockpit_slack_notice_ts(r.facts->>'confirmedAt'),
                          public.cockpit_slack_notice_ts(r.facts->>'dueAt'),
                          r.created_at);
      IF v_event <= now() - interval '48 hours' THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = CASE WHEN r.kind = 'kickoff'
                            THEN 'This kickoff was more than 48 hours old by the time the cockpit could send it, so it was not posted.'
                            ELSE 'This notice was more than 48 hours old by the time the cockpit could send it, so it was not posted.' END
         WHERE id = r.id;
        CONTINUE;
      END IF;
    END IF;

    -- 1c. A call grade (2b): only while the cockpit owns it (the owner
    --     gate), for a recording still shown as a client call, with its grade
    --     in the cockpit, to a private channel. A refusal found after the
    --     claim goes through sending to failed: the guard lets a queued notice
    --     go only to sending, skipped or muted.
    IF r.kind = 'checkin.grade' THEN
      v_gate := public.cockpit_form_effect_gate('slack_notice', r.id::text);
      IF NOT coalesce((v_gate->>'ok')::boolean, false) THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = left(coalesce(nullif(v_gate->>'reason', ''), 'Make owns this again.'), 240)
         WHERE id = r.id;
        CONTINUE;
      END IF;
      v_live := public.cockpit_slack_notice_live(r);
      IF NOT coalesce((v_live->>'recordingShown')::boolean, false) THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'That recording is no longer a client call, so its grade was not posted.'
         WHERE id = r.id;
        CONTINUE;
      END IF;
      IF jsonb_typeof(v_live->'grade') IS DISTINCT FROM 'object' THEN
        UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now() WHERE id = r.id;
        UPDATE public.cockpit_slack_notices SET state = 'failed', finished_at = now(),
               error = 'The call''s grade is not in the cockpit, so nothing was posted. Tell the tech lead.'
         WHERE id = r.id;
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c
                      WHERE c.id = public.cockpit_slack_notice_target(r.kind) AND c.private IS TRUE) THEN
        UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now() WHERE id = r.id;
        UPDATE public.cockpit_slack_notices SET state = 'failed', finished_at = now(),
               error = 'The call grade posts only in a private channel. Choose one in Settings, Notices and routing.'
         WHERE id = r.id;
        CONTINUE;
      END IF;
    END IF;

    -- 1d. A recap reminder (2b): not once the recap has gone or been
    --     skipped, nor once Make owns the recap again.
    IF r.kind = 'checkin.recap_late' THEN
      v_live := public.cockpit_slack_notice_live(r);
      IF v_live->'recap'->>'messageState' = 'sent' OR v_live->'recap'->>'effectState' = 'delivered' THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'The recap was sent before this reminder went out.'
         WHERE id = r.id;
        CONTINUE;
      ELSIF v_live->'recap'->>'messageState' = 'skipped' OR v_live->'recap'->>'effectState' = 'skipped' THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'The recap was skipped, so no reminder was posted.'
         WHERE id = r.id;
        CONTINUE;
      ELSIF public.cockpit_form_effect_owner('checkin', 'recap') IS DISTINCT FROM 'cockpit'
         OR public.cockpit_form_native_since('checkin') IS NULL THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'Make owns this again.'
         WHERE id = r.id;
        CONTINUE;
      END IF;
    END IF;

    -- 2. A reply waits for its first notice, then goes in its thread.
    IF r.parent_id IS NOT NULL THEN
      SELECT * INTO p FROM public.cockpit_slack_notices x WHERE x.id = r.parent_id;
      v_found := FOUND;
      IF v_found AND (p.state IN ('queued','sending') OR (p.state = 'unknown' AND p.claimed_at > now() - interval '30 minutes')) THEN
        CONTINUE;
      ELSIF v_found AND p.state = 'posted' AND r.kind = 'kickoff.updated'
            AND now() > coalesce(public.cockpit_slack_notice_ts(coalesce(r.facts->>'submittedAt', p.facts->>'submittedAt')),
                                 r.created_at) + interval '48 hours' THEN
        -- The sender waited for the card's Kickoff Handoff comment and it
        -- never came: the late notice stands, and no reply says otherwise.
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'The card had no Kickoff Handoff comment 48 hours after the kickoff, so no reply was posted. The late notice stands.'
         WHERE id = r.id;
        CONTINUE;
      ELSIF v_found AND p.state = 'posted' THEN
        v_thread := p.slack_ts;
        v_target := p.channel;
        v_top := false;
      ELSIF v_found AND p.state IN ('muted','skipped') AND r.kind <> 'blueprint.offer' THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'Its first notice did not post, so this reply was not sent.'
         WHERE id = r.id;
        CONTINUE;
      END IF;
      -- Otherwise (failed, an old unknown, or an offer whose close did not post): top level.
    END IF;

    -- 3. Where it goes.
    IF v_top THEN
      IF r.kind = 'rehearsal' THEN
        v_target := r.target;
        IF v_target IS NULL THEN
          v_email := NULL;
          IF coalesce(r.facts->>'requestedBy', '') ~ '^[0-9a-fA-F-]{36}$' THEN
            SELECT lower(btrim(m.email)) INTO v_email FROM public.cockpit_members m
             WHERE m.auth_user_id = (r.facts->>'requestedBy')::uuid
             ORDER BY m.active DESC, m.updated_at DESC LIMIT 1;
          END IF;
          IF v_email IS NOT NULL THEN
            SELECT public.cockpit_slack_person_id(pp.id) INTO v_target
              FROM public.cockpit_people pp
             WHERE pp.active AND lower(btrim(pp.email)) = v_email AND public.cockpit_slack_person_id(pp.id) IS NOT NULL
             ORDER BY pp.id LIMIT 1;
            IF v_target IS NULL THEN v_lookup := v_email; END IF;
          END IF;
          IF v_target IS NULL AND v_lookup IS NULL THEN
            UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now() WHERE id = r.id;
            UPDATE public.cockpit_slack_notices SET state = 'failed', finished_at = now(),
                   error = 'No Slack account was found for you. Ask the tech lead to add your address to the team list.'
             WHERE id = r.id;
            CONTINUE;
          END IF;
        END IF;
      ELSE
        v_target := public.cockpit_slack_notice_target(r.kind);
      END IF;
    END IF;

    -- 4. A kickoff waits until the card looks done, or 20 minutes have passed.
    IF r.kind = 'kickoff' THEN
      v_sub := public.cockpit_slack_notice_ts(r.facts->>'submittedAt');
      v_status := NULL;
      v_updated := NULL;
      SELECT o.client_status, o.card_updated_at INTO v_status, v_updated
        FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = r.task_id;
      IF v_sub IS NOT NULL AND NOT public.cockpit_slack_notice_card_done(v_status, v_updated, v_sub)
         AND now() < v_sub + interval '20 minutes' THEN
        CONTINUE;
      END IF;
    END IF;

    -- 5. A top-level notice needs a ready channel (the target is not written,
    --    so the guard does not refuse the move).
    IF v_top AND r.kind <> 'rehearsal'
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c WHERE c.id = v_target AND c.state = 'ok') THEN
      UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now() WHERE id = r.id;
      UPDATE public.cockpit_slack_notices SET state = 'failed', finished_at = now(),
             error = format('The channel for this notice is not ready (%s). Choose one in Settings, Notices and routing.',
                            coalesce(v_target, 'none'))
       WHERE id = r.id;
      CONTINUE;
    END IF;

    -- 6. Claimed.
    UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now(), target = v_target, thread_ts = v_thread
     WHERE id = r.id RETURNING * INTO r;

    -- 7. The row the sender works from.
    v_row := jsonb_build_object(
      'id', r.id,
      'ref', 'CN-' || left(r.id::text, 8),
      'kind', r.kind,
      'taskId', r.task_id,
      'clientName', r.client_name,
      'attempts', r.attempts,
      'createdAt', r.created_at,
      'facts', r.facts,
      'live', public.cockpit_slack_notice_live(r),
      'target', r.target,
      'threadTs', r.thread_ts,
      'parentId', r.parent_id,
      'mentions', public.cockpit_slack_notice_claim_mentions(r.kind, r.client_name));
    IF r.kind = 'rehearsal' THEN
      v_row := v_row || jsonb_build_object('rehearsal', jsonb_build_object('of', r.facts->>'of', 'lookupEmail', v_lookup));
    END IF;
    v_rows := v_rows || jsonb_build_array(v_row);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('busy', false, 'rows', v_rows);
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
    IF v_kind IS NULL OR v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late') THEN
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
                                             'checkin.grade','checkin.recap_late'], s.kind))
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
                                   'checkin.grade','checkin.recap_late'], x.kind)
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
   ORDER BY array_position(ARRAY['kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late'], s.kind) LIMIT 1;
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
  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late') THEN
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
  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late') THEN
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
      v_ok := coalesce(public.cockpit_client_allowed(v_name), false);
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
                                  ORDER BY x.created_at DESC, x.id LIMIT 20) v), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notices_kick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-notices';
  v_secret text;
  v_anon text;
  v_headers jsonb;
  v_request bigint;
  v_note text;
BEGIN
  -- 2b (Z10): the recap reminders and the 1-1 notes dispatch sweep ride this
  -- kick. Each is noted with the queue's failures and never stops the rest.
  BEGIN
    PERFORM public.cockpit_slack_notice_sweep_checkin();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed('The recap reminder sweep failed: ' || SQLERRM);
  END;
  BEGIN
    IF to_regprocedure('public.cockpit_form_effects_kick()') IS NOT NULL THEN
      PERFORM public.cockpit_form_effects_kick();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed('The 1-1 notes sweep failed: ' || SQLERRM);
  END;
  -- A sweep that fails is noted with the queue's other failures; what is
  -- already queued still goes out.
  BEGIN
    PERFORM public.cockpit_slack_notice_sweep();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed('The sweep failed: ' || SQLERRM);
  END;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_slack_notices n WHERE n.state = 'queued' AND n.next_attempt_at <= now())
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_notices n
                      WHERE n.state = 'unknown' AND n.claimed_at > now() - interval '24 hours'
                        AND (n.checked_at IS NULL OR n.checked_at < now() - interval '10 minutes'))
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c WHERE c.state = 'checking')
     AND public.cockpit_slack_person_pending() = '[]'::jsonb THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
    VALUES ('slack-notices-kick', now(), now(), true, 'Nothing to send', now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = $1 LIMIT 1'
      INTO v_secret USING 'cockpit_notices_cron_secret';
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = $1 LIMIT 1'
      INTO v_anon USING 'cockpit_anon_key';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    v_note := 'The vault has no cockpit_notices_cron_secret, so the Slack notices did not run. Add it to the vault.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace ns ON ns.oid = f.pronamespace
                     WHERE ns.nspname = 'net' AND f.proname = 'http_post') THEN
    v_note := 'pg_net is not installed, so the Slack notices did not run.';
  END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at)
    VALUES ('slack-notices-kick', now(), false, v_note, now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), ok = false, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
  IF nullif(btrim(v_anon), '') IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || btrim(v_anon));
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)' INTO v_request
    USING v_url, jsonb_build_object('job', 'run'), v_headers;
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
  VALUES ('slack-notices-kick', now(), now(), true, 'Posted a notices run', now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
  RETURN v_request;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The recap reminder sweep (internal; the kick runs it every minute)

-- A check-in recap the cockpit owns (the effect row and the registry both say
-- so, and the provider is native: an effect row alone never queues a post, and
-- Slack has no second switch), on a live response, still waiting (its
-- effect planned or queued, or failed with its message failed; its message
-- none yet, a draft, approved, refused or failed) 24 hours after the later of
-- the call's end (else its start) and the send, queues one checkin.recap_late
-- notice, for 24 hours only (Z43). Its dedupe key makes it once only, so a
-- skipped or posted reminder is never queued again. Each row in its own
-- block: one bad row is noted with the queue's failures and never stops the rest.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_sweep_checkin()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_queued integer := 0;
  v_call timestamptz;
  v_due timestamptz;
  x record;
BEGIN
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  FOR x IN
    SELECT r.id AS response_id, r.task_id, r.client_name, r.submitted_at,
           coalesce(nullif(r.answers->'call'->>'endsAt', ''), nullif(r.answers->'call'->>'startsAt', '')) AS call_at
      FROM public.cockpit_form_effects e
      JOIN public.cockpit_form_responses r ON r.id = e.response_id
      LEFT JOIN public.cockpit_client_messages m
             ON m.id = CASE WHEN e.delivery_ref ~ '^[0-9a-fA-F-]{36}$' THEN e.delivery_ref::uuid END
     WHERE e.effect_key = 'recap' AND e.delivery = 'client_message' AND e.owner = 'cockpit'
       AND public.cockpit_form_effect_owner('checkin', e.effect_key) = 'cockpit'
       AND public.cockpit_form_native_since('checkin') IS NOT NULL
       AND r.form_key = 'checkin' AND r.mode = 'live' AND r.state IN ('submitted','confirmed')
       AND (e.state IN ('planned','queued') OR (e.state = 'failed' AND m.state = 'failed'))
       AND (m.id IS NULL OR m.state IN ('draft','approved','refused','failed'))
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_notices n WHERE n.dedupe_key = 'recap_late:' || r.id::text)
     ORDER BY r.submitted_at, r.id
  LOOP
    BEGIN
      v_call := public.cockpit_slack_notice_ts(x.call_at);
      v_due := greatest(v_call, x.submitted_at) + interval '24 hours';
      CONTINUE WHEN v_due IS NULL OR v_due > now() OR now() >= v_due + interval '24 hours';
      IF public.cockpit_slack_notice_queue('checkin.recap_late', 'recap_late:' || x.response_id::text, x.task_id, x.client_name,
           jsonb_build_object('taskId', x.task_id, 'client', x.client_name, 'responseId', x.response_id,
                              'callAt', public.cockpit_slack_notice_iso(v_call), 'dueAt', public.cockpit_slack_notice_iso(v_due)),
           NULL, 'queued', NULL) IS NOT NULL THEN
        v_queued := v_queued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.cockpit_slack_notice_queue_failed('A recap reminder could not be queued: ' || SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('queued', v_queued);
END $$;

-- ---------------------------------------------------------------------------
-- 5. Function privileges: revoked from all four roles, then exactly the live
--    grant of each replaced function (contract 2.2), none for the new sweep

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (definer functions, triggers and pg_cron as owner).
  FOREACH f IN ARRAY ARRAY[
    'cockpit_slack_notices_kick()', 'cockpit_slack_notice_live(public.cockpit_slack_notices)',
    'cockpit_slack_notice_shape(text)', 'cockpit_slack_notice_kind_label(text)',
    'cockpit_slack_notice_sweep_checkin()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- The sender's RPCs: the service key only.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_slack_notice_claim(integer,uuid)', 'cockpit_slack_notice_inputs(jsonb)',
    'cockpit_slack_notice_doctor_inputs()', 'cockpit_slack_notice_rehearse_service(text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- The screens' RPCs: a signed-in seat, gated inside.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_slack_notice_read(text)', 'cockpit_slack_notice_settings_read()',
    'cockpit_slack_notice_settings_set(text,jsonb)', 'cockpit_slack_channel_remove(text)',
    'cockpit_slack_notice_rehearse(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. The two settings rows, on (Z25), each insert that happened with one
--    notices.setting_seeded audit row (a second apply inserts and writes none)

DO $$
DECLARE s record;
BEGIN
  FOR s IN
    INSERT INTO public.cockpit_slack_notice_settings (kind, enabled, channel, mention_rule, updated_by) VALUES
      ('checkin.grade', true, 'C09SVG6FHGU', '{}'::text[], 'migration'),
      ('checkin.recap_late', true, 'C09RZ0GS0V9', '{}'::text[], 'migration')
    ON CONFLICT (kind) DO NOTHING
    RETURNING kind, enabled, channel
  LOOP
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('notices.setting_seeded', 'cockpit_slack_notice_settings', s.kind, 'migration', 'client-success', 'supabase', NULL,
            jsonb_build_object('kind', s.kind, 'enabled', s.enabled, 'channel', s.channel), jsonb_build_object('op', 'insert'));
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
