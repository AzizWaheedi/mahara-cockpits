-- The Client Profile backfill (docs/forms/WAVE56-CONTRACT.md 4.17; the CEO's "Sure" to CEO-2, the next-design plan's
-- build B2 and its design backfill.md 3.1). Creative Triage (bldgtotkfmhoxmlzowdx). Stands on 20261102o; applies twice.
--
-- 1. cockpit_form_effect_gate: 20261102j's body byte for byte, plus exactly two branches keyed on the effect, for the two
--    one-off ClickUp card fills the cockpit queues on its own: (onboarding, profile_backfill), this file's backfill, and
--    (new_client, sale_facts), the sale's card facts (build B3 plans them; the plan's 2.2 puts both branches here so the
--    gate changes once). Either passes only a queued or unknown effect the cockpit owns, asked for a ClickUp queue row.
--    Without the branch the claim (cockpit_clickup_writeback_claim_forms) would settle every such row as refused: the
--    backfill's answer is an old Typeform one, sent before any native window, and the New Client Form has no native
--    window at all (cockpit_form_native_since is NULL). The switch for both is the writer's CLICKUP_WRITEBACK_FORMS_KEYS
--    lane (profile_backfill, new_client), which holds a row unwritten. It must not live here: a refusal here settles the
--    row. Every other case is 20261102j's. The ACL stays the owner's only.
-- 2. cockpit_form_profile_backfill(p_mode, p_cards, p_actor): the service role's only (cockpit_hours_require_service
--    first). For 1 to 10 named cards, in order, it plans Make 13 [29]'s Client Profile (field 7755485f) from the card's
--    stored Typeform onboarding answer, only for a card still in onboarding whose Client Profile is empty:
--    - dry_run writes nothing and answers, per card, would_queue or skip with a plain reason, the answer's id and day,
--      the text's length, how many of the seven profile answers it has, and the first 12 hex of its sha256. Never the
--      text.
--    - apply makes one effect (onboarding, profile_backfill, owner cockpit, delivery clickup_queue) and one form queue
--      row per eligible card, under the writer's contract (build B1): the plan {taskId, fields:[{fieldId '7755485f-...',
--      kind 'text', label 'Client Profile', value, onlyIfEmpty true}], lines} and the payload {formKey 'onboarding',
--      effectKey 'profile_backfill', effectId, responseId, taskId, valueChars, valueSha256}. The text is in the plan
--      only: the queue's audit trigger copies payloads into cockpit_audit_log. A second apply queues nothing (the
--      queue's dedupe key profile_backfill:<card> and the effect's response and key are unique).
--    - cancel takes back a row the writer has not started (queued or retry, no step started or done): the row ends
--      skipped "Cancelled before it reached ClickUp, so nothing was written." and its effect follows. A row that has
--      started, is sending or unknown is left alone.
--    apply and cancel write one cockpit_audit_log row (forms.profile_backfill_apply, forms.profile_backfill_cancel) with
--    ids and counts only; every effect and queue row change is audited by the tables' own triggers, with no text.
--
-- The text is cockpit_form_stage4_profile_text (20261102o) over the stored answers as Typeform hands them to Make
-- (cockpit_form_typeform_text), a ref answered twice giving its last answer: the text Make 13 [29] writes. Nothing here
-- reaches ClickUp: the writer does, only while CLICKUP_WRITEBACK_FORMS_KEYS lists profile_backfill, only into an empty
-- field, and it reads the field back (deploy step D-PB, RUNBOOK "Client Profile backfill").

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: the gate is 20261102j's (live, read 2026-11-03) or this file's own (a second apply). This file
--    stands on 20261102o's three text bodies (live md5s read 2026-11-03) and on the claim that asks the gate.

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_form_effect_gate(text,text)', 'a683c23676194229cc175e4d47cb8b2b', '4ca44d25514e25806229a7e6d185673b')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since 20261102j; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_form_stage4_profile_text(jsonb)', '6c652fb15684e5c928f4d868e033f2ca', '20261102o'),
      ('public.cockpit_form_typeform_text(text)', '4509bcd520194d07a477d24dd183df91', '20261102o'),
      ('public.cockpit_form_stage4_make_text(text,text)', 'b14bfda43df528ef80bdc79c107b7681', '20261102o'),
      ('public.cockpit_clickup_writeback_claim_forms(uuid,integer)', 'c79ffe4c8d0273ee517e745feb672186', '20261029t')
    ) AS x(fn, md5_read, src)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL AND g.src = '20261102o' THEN
      RAISE EXCEPTION 'Apply 20261102o before this file (% is missing).', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    ELSIF v_now IS DISTINCT FROM g.md5_read THEN
      RAISE EXCEPTION '% changed since % (this file stands on it); stop and re-read it.', replace(g.fn, 'public.', ''), g.src
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF to_regprocedure('public.cockpit_hours_require_service()') IS NULL
     OR to_regclass('public.cockpit_client_onboarding') IS NULL THEN
    RAISE EXCEPTION 'The service check (20261009a) or the client records (20261005a) are missing, so this file stops.'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. cockpit_form_effect_gate: 20261102j's body, plus the two keyed branches (1 above).
CREATE OR REPLACE FUNCTION public.cockpit_form_effect_gate(p_delivery text, p_ref text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rows integer := 0;
  v_open integer := 0;
  e record;
  v_pass jsonb;
  v_held jsonb;
  v_first jsonb;
  v_pick jsonb;
  v_reason text;
BEGIN
  -- Waves 3-4 (2.2): a form link message answers to its invite, not to a
  -- 1-1 notes effect. Every other write below is unchanged.
  IF p_delivery = 'client_message' AND p_ref ~ '^[0-9a-fA-F-]{36}$' AND EXISTS (
       SELECT 1 FROM public.cockpit_client_messages cm WHERE cm.id = p_ref::uuid AND cm.kind = 'form_invite') THEN
    RETURN public.cockpit_form_invite_gate(p_ref::uuid);
  END IF;
  -- A queued effect before an unknown one, then the oldest.
  FOR e IN
    SELECT x.id, x.response_id, x.form_key, x.effect_key, x.state, x.owner, r.mode, r.submitted_at, r.form_version, r.task_id,
           public.cockpit_form_native_since(x.form_key) AS since
      FROM public.cockpit_form_effects x
      JOIN public.cockpit_form_responses r ON r.id = x.response_id
     WHERE x.delivery = p_delivery AND x.delivery_ref = p_ref
     ORDER BY CASE x.state WHEN 'queued' THEN 0 WHEN 'unknown' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END,
              x.created_at, x.id
  LOOP
    v_rows := v_rows + 1;
    v_pick := jsonb_build_object('effectId', e.id, 'responseId', e.response_id, 'formKey', e.form_key,
      'effectKey', e.effect_key, 'effectState', e.state);
    IF v_first IS NULL THEN v_first := v_pick; END IF;
    IF e.state NOT IN ('delivered','skipped','failed','dry_run') THEN
      v_open := v_open + 1;
      IF v_held IS NULL THEN v_held := v_pick; END IF;
    END IF;
    -- No send time, or no native window (since is NULL): the comparison is
    -- NULL and this effect does not pass (missing is never a pass).
    IF v_pass IS NULL AND e.state IN ('queued','unknown') AND e.owner = 'cockpit' AND e.mode = 'live'
       AND public.cockpit_form_effect_owner(e.form_key, e.effect_key) = 'cockpit'
       AND e.submitted_at >= e.since THEN
      v_pass := v_pick;
    END IF;
    -- Waves 5-6 (Stage 4): before the go-live, a native kickoff or onboarding answer on the test card
    -- 86eywg1cq (the canary) passes on its own effect's owner, whatever the registry says.
    IF v_pass IS NULL AND e.state IN ('queued','unknown') AND e.owner = 'cockpit'
       AND e.form_key IN ('kickoff','onboarding') AND e.form_version >= 2 AND e.task_id = '86eywg1cq' THEN
      v_pass := v_pick;
    END IF;
    -- The next-design plan, B2 (20261103c): two card fills the cockpit queues on its own pass on their own effect,
    -- whatever the registry and the native window say: the Client Profile backfill (onboarding, profile_backfill;
    -- its answer is an old Typeform one) and the sale's card facts (new_client, sale_facts; the New Client Form is
    -- Typeform's, so it has no native window). Each is a ClickUp card write. Their switch is the writer's
    -- CLICKUP_WRITEBACK_FORMS_KEYS lane, which holds a row unwritten; this gate never refuses them, because a refusal
    -- here settles the row (claim_forms).
    IF v_pass IS NULL AND p_delivery = 'clickup_queue' AND e.state IN ('queued','unknown') AND e.owner = 'cockpit'
       AND ((e.form_key = 'onboarding' AND e.effect_key = 'profile_backfill')
         OR (e.form_key = 'new_client' AND e.effect_key = 'sale_facts')) THEN
      v_pass := v_pick;
    END IF;
  END LOOP;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'effectId', NULL, 'responseId', NULL, 'formKey', NULL, 'effectKey', NULL,
      'effectState', NULL, 'reason', 'No 1-1 notes effect points at this write, so nothing was written.');
  END IF;
  IF v_pass IS NOT NULL THEN
    v_pick := v_pass;
    v_reason := NULL;
  ELSIF v_open = 0 THEN
    v_pick := v_first;
    v_reason := 'This write was settled in the cockpit, so nothing was written.';
  ELSE
    v_pick := v_held;
    v_reason := 'Make owns this again.';
  END IF;
  RETURN v_pick || jsonb_build_object('ok', v_pass IS NOT NULL, 'reason', v_reason);
END $$;

-- ---------------------------------------------------------------------------
-- 2. cockpit_form_profile_backfill (2 above). p_actor says who approved it (a role and the decision, never a client's
--    data); it is the audit rows' actor. dry_run takes no actor.
CREATE OR REPLACE FUNCTION public.cockpit_form_profile_backfill(p_mode text, p_cards text[], p_actor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_field constant text := '7755485f-74a8-496c-85d8-562588e77944';
  -- Make 13 [29]'s seven labels in order (clickup-writeback forms.ts PROFILE_LABELS): the writer refuses any other text.
  c_shape constant text := E'^Last Year''s Total Revenue: [^\n]*\n\n90-Day Goal Revenue: [^\n]*\n\n12-24 Month Revenue Goal: [^\n]*\n\nMarketing they''ve tried A-Z: .*\n\nTop 3 challenges: .*\n\nWhy they joined: .*\n\nAdditional notes: .*$';
  c_refs constant text[] := ARRAY['7ff5d37a-df7f-4002-8248-d0b4af6c28e8', '791b99b8-c7e9-40a4-96d6-868399e1ae97',
    'f4b96a9b-bd7c-4398-98b4-6a28a7d3595a', 'bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6', 'fcf43e6a-cc84-4ae7-9cef-2336069d0280',
    '7426c6c5-344f-44c9-9999-3b9daf3a06b8', '41d2d5bb-b023-4fa4-906c-72aeef7a5e46'];
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_card text;
  o public.cockpit_client_onboarding;
  r public.cockpit_form_responses;
  q public.cockpit_clickup_writeback_queue;
  v_n integer;
  v_by jsonb;
  v_text text;
  v_sha text;
  v_answered integer;
  v_reason text;
  v_state text;
  v_effect uuid;
  v_queue uuid;
  v_row jsonb;
  v_out jsonb := '[]'::jsonb;
  v_counts jsonb := '{"would_queue":0,"queued":0,"cancelled":0,"not_cancelled":0,"skip":0}'::jsonb;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_mode IS NULL OR p_mode NOT IN ('dry_run','apply','cancel') THEN
    RAISE EXCEPTION 'Say dry_run, apply or cancel.' USING ERRCODE = '22023';
  END IF;
  IF p_cards IS NULL OR cardinality(p_cards) NOT BETWEEN 1 AND 10 OR array_ndims(p_cards) <> 1
     OR EXISTS (SELECT 1 FROM unnest(p_cards) AS k(v) WHERE k.v IS NULL OR k.v !~ '^[A-Za-z0-9_-]{1,40}$')
     OR (SELECT count(DISTINCT k.v) FROM unnest(p_cards) AS k(v)) <> cardinality(p_cards) THEN
    RAISE EXCEPTION 'Name the cards: 1 to 10 different ClickUp ids.' USING ERRCODE = '22023';
  END IF;
  IF p_mode <> 'dry_run' AND (v_actor IS NULL OR char_length(v_actor) > 200) THEN
    RAISE EXCEPTION 'Say who approved this.' USING ERRCODE = '22023';
  END IF;
  IF p_mode <> 'dry_run' THEN
    PERFORM set_config('cockpit.audit_actor', v_actor, true);
  END IF;

  FOREACH v_card IN ARRAY p_cards LOOP
    o := NULL; r := NULL; q := NULL;
    v_by := NULL; v_text := NULL; v_sha := NULL; v_answered := NULL; v_reason := NULL; v_effect := NULL; v_queue := NULL;

    -- cancel: only a row the writer has not started.
    IF p_mode = 'cancel' THEN
      SELECT * INTO q FROM public.cockpit_clickup_writeback_queue x
       WHERE x.dedupe_key = 'profile_backfill:' || v_card FOR UPDATE;
      IF q.id IS NULL THEN
        v_state := 'skip';
        v_reason := 'Nothing to cancel: no Client Profile backfill was queued for this card.';
      ELSIF q.state IN ('delivered','skipped','failed','dry_run') THEN
        v_state := 'skip';
        v_reason := 'Nothing to cancel: this write already ended (' || q.state || ').';
      ELSIF q.state IN ('queued','retry')
            AND NOT pg_catalog.jsonb_path_exists(coalesce(q.progress, '{}'::jsonb),
                      '$.steps.* ? (@.state == "started" || @.state == "done")') THEN
        PERFORM set_config('cockpit.forms_action', 'forms.profile_backfill_cancelled', true);
        UPDATE public.cockpit_clickup_writeback_queue x
           SET state = 'skipped', error = 'Cancelled before it reached ClickUp, so nothing was written.',
               updated_at = now()
         WHERE x.id = q.id;
        v_state := 'cancelled';
        v_reason := 'Cancelled before it reached ClickUp, so nothing was written.';
      ELSE
        v_state := 'not_cancelled';
        v_reason := 'Not cancelled: a write may have reached the card. Let the writer finish, then read the card.';
      END IF;
      v_counts := jsonb_set(v_counts, ARRAY[v_state], to_jsonb((v_counts->>v_state)::integer + 1));
      v_out := v_out || jsonb_build_array(jsonb_build_object('taskId', v_card, 'state', v_state, 'reason', v_reason,
        'queueId', q.id, 'queueState', q.state));
      CONTINUE;
    END IF;

    -- dry_run and apply: the card's client record (locked for apply, so two applies take turns).
    IF p_mode = 'apply' THEN
      SELECT * INTO o FROM public.cockpit_client_onboarding x WHERE x.clickup_task_id = v_card FOR UPDATE;
    ELSE
      SELECT * INTO o FROM public.cockpit_client_onboarding x WHERE x.clickup_task_id = v_card;
    END IF;
    IF o.clickup_task_id IS NULL THEN
      v_reason := 'Skipped: this card is not in the client records.';
    ELSIF NOT o.in_onboarding THEN
      v_reason := 'Skipped: this client is not in onboarding.';
    ELSIF btrim(coalesce(o.handover->>'client_profile', '')) <> '' THEN
      v_reason := 'Skipped: the card already has a Client Profile.';
    ELSIF jsonb_typeof(o.forms->'onboarding'->'answers') IS DISTINCT FROM 'array'
          OR jsonb_array_length(o.forms->'onboarding'->'answers') = 0 THEN
      v_reason := 'Skipped: no stored onboarding answer for this card.';
    ELSIF o.forms->'onboarding'->>'form_id' IS DISTINCT FROM 'KFRCXPFx' THEN
      v_reason := 'Skipped: this client answered the onboarding in the portal, so its own Client Profile step fills the card.';
    ELSE
      SELECT count(*) INTO v_n FROM public.cockpit_form_responses x
       WHERE x.form_key = 'onboarding' AND x.task_id = v_card AND x.external_id = o.forms->'onboarding'->>'response_id';
      IF v_n = 1 THEN
        SELECT * INTO r FROM public.cockpit_form_responses x
         WHERE x.form_key = 'onboarding' AND x.task_id = v_card AND x.external_id = o.forms->'onboarding'->>'response_id';
      END IF;
      IF v_n <> 1 OR r.state NOT IN ('submitted','confirmed') OR r.mode <> 'live' THEN
        v_reason := 'Skipped: the stored answer is not in the forms records. Tell the tech lead.';
      ELSIF (r.answers->'fields') IS DISTINCT FROM (o.forms->'onboarding'->'answers') THEN
        v_reason := 'Skipped: the stored answer and the client record disagree, so nothing was queued. Tell the tech lead.';
      ELSIF EXISTS (SELECT 1 FROM public.cockpit_form_effects e JOIN public.cockpit_form_responses x ON x.id = e.response_id
                     WHERE x.task_id = v_card AND e.effect_key = 'profile_backfill')
         OR EXISTS (SELECT 1 FROM public.cockpit_clickup_writeback_queue x WHERE x.dedupe_key = 'profile_backfill:' || v_card) THEN
        v_reason := 'Skipped: already queued once for this card.';
      ELSIF EXISTS (SELECT 1 FROM public.cockpit_form_effects e JOIN public.cockpit_form_responses x ON x.id = e.response_id
                     WHERE x.task_id = v_card AND e.effect_key = 'profile_fields' AND e.state IN ('planned','queued','unknown')) THEN
        v_reason := 'Skipped: the native onboarding is writing this card''s Client Profile now.';
      ELSE
        -- The answers as Typeform hands them to Make, by ref; a ref answered twice gives its last answer.
        SELECT jsonb_object_agg(a.x->>'ref', public.cockpit_form_typeform_text(a.x->>'value') ORDER BY a.n)
          INTO v_by
          FROM jsonb_array_elements(r.answers->'fields') WITH ORDINALITY AS a(x, n)
         WHERE coalesce(a.x->>'ref', '') <> '';
        v_by := coalesce(v_by, '{}'::jsonb);
        SELECT count(*) INTO v_answered FROM unnest(c_refs) WITH ORDINALITY AS k(ref, n)
         WHERE coalesce(CASE WHEN k.n <= 3 THEN public.cockpit_form_stage4_make_text(v_by->>k.ref, 'number')
                             ELSE v_by->>k.ref END, '') <> '';
        v_text := public.cockpit_form_stage4_profile_text(v_by);
        IF v_answered = 0 THEN
          v_reason := 'Skipped: the stored answer has none of the seven Client Profile answers, so there is nothing to write.';
        ELSIF v_text IS NULL OR v_text !~ c_shape THEN
          v_reason := 'Skipped: the Client Profile built from this answer does not have Make''s seven labels, so nothing was queued. Tell the tech lead.';
        ELSE
          v_sha := encode(pg_catalog.sha256(convert_to(v_text, 'UTF8')), 'hex');
        END IF;
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_state := 'skip';
    ELSIF p_mode = 'dry_run' THEN
      v_state := 'would_queue';
    ELSE
      -- apply: the effect, its queue row and the effect queued, together or not at all for this card.
      BEGIN
        PERFORM set_config('cockpit.forms_action', 'forms.profile_backfill_queued', true);
        INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state)
        VALUES (r.id, 'onboarding', 'profile_backfill', r.id::text || ':profile_backfill', 'cockpit', 'clickup_queue',
                jsonb_build_object(
                  'taskId', v_card,
                  'fields', jsonb_build_array(jsonb_build_object('fieldId', c_field, 'kind', 'text', 'label', 'Client Profile',
                    'value', v_text, 'onlyIfEmpty', true)),
                  'lines', jsonb_build_array(
                    'Client Profile from the stored onboarding answer (' || char_length(v_text) || ' characters)',
                    'Only where the card''s Client Profile is empty')),
                'planned')
        RETURNING id INTO v_effect;
        INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, task_id, payload)
        VALUES ('profile_backfill:' || v_card, 'form', 'cockpit_form_effects', v_effect::text, v_card,
                jsonb_build_object('formKey', 'onboarding', 'effectKey', 'profile_backfill', 'effectId', v_effect,
                  'responseId', r.id, 'taskId', v_card, 'valueChars', char_length(v_text), 'valueSha256', v_sha))
        RETURNING id INTO v_queue;
        UPDATE public.cockpit_form_effects x
           SET state = 'queued', delivery_ref = v_queue::text, receipt = jsonb_build_object('queueId', v_queue), reason = NULL
         WHERE x.id = v_effect;
        v_state := 'queued';
      EXCEPTION WHEN OTHERS THEN
        v_state := 'skip';
        v_reason := left('Skipped: ' || SQLERRM, 240);
        v_effect := NULL;
        v_queue := NULL;
      END;
    END IF;

    v_counts := jsonb_set(v_counts, ARRAY[v_state], to_jsonb((v_counts->>v_state)::integer + 1));
    v_row := jsonb_build_object('taskId', v_card, 'state', v_state, 'reason', v_reason,
      'responseId', r.id,
      'sentOn', CASE WHEN r.submitted_at IS NOT NULL THEN to_char(r.submitted_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD') END,
      'chars', CASE WHEN v_sha IS NOT NULL THEN char_length(v_text) END,
      'answered', v_answered,
      'sha256', left(v_sha, 12));
    IF p_mode = 'apply' THEN
      v_row := v_row || jsonb_build_object('effectId', v_effect, 'queueId', v_queue);
    END IF;
    v_out := v_out || jsonb_build_array(v_row);
  END LOOP;

  IF p_mode <> 'dry_run' THEN
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after,
                                         metadata)
    VALUES ('forms.profile_backfill_' || p_mode, 'cockpit_form_effects', NULL, v_actor, 'client-success', 'supabase', NULL,
            NULL,
            jsonb_build_object('cards', to_jsonb(p_cards), 'counts', v_counts,
              'rows', (SELECT coalesce(jsonb_agg(jsonb_build_object('taskId', x->'taskId', 'state', x->'state',
                         'effectId', x->'effectId', 'queueId', x->'queueId')), '[]'::jsonb)
                         FROM jsonb_array_elements(v_out) x)));
    PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
    PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  END IF;
  RETURN jsonb_build_object('mode', p_mode, 'cards', v_out, 'counts', v_counts);
END $$;

-- ---------------------------------------------------------------------------
-- 3. Privileges: the gate stays the owner's only (as 20261102j left it); the backfill is the service role's only.

REVOKE ALL ON FUNCTION public.cockpit_form_effect_gate(text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_form_profile_backfill(text,text[],text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_form_profile_backfill(text,text[],text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
