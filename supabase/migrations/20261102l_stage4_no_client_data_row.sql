-- Stage 4 without a Client Data write (docs/forms/WAVE56-CONTRACT.md 4.14.3, 4.14.4, 4.15.2 and the
-- D-S4.0 row of 9). Creative Triage (bldgtotkfmhoxmlzowdx). Applies twice; stands on 20261102j.
--
-- D-S4.0 read the saved Make 13 blueprint (8922994): its module [31] is google-sheets:filterRows, a
-- search of Client Data column C for the card's row (where the phase 3 group is), not a row write. No
-- Make scenario writes a Client Data row: Make 10 (8979157) only reads columns C and R and sets R on a
-- row that is already there. The native onboarding planned client_data_row, a relay effect that
-- appended a row when the card had none: a write Make never makes. hermes/client-messages reads the
-- group from Client Data column F itself, so the cockpit needs no row of its own. This file takes the
-- effect out:
--
-- 1. The relay outbox takes only github_dispatch (its effect_key and dedupe_key CHECKs). The file stops
--    while the outbox holds any client_data_row row (read 2026-11-02: none; the relay never ran with
--    FORMS_RELAY_APPLY on).
-- 2. cockpit_form_stage4_effects: the onboarding version-2 array without client_data_row. Version 1
--    drops Make's client_data_row entry as well rather than relabelling it: the entry said Make writes a
--    Client Data row, which it never did. [31] is no effect of its own, but it gates the rest of Make
--    13's route 0: [49] (the map at phase 3), [50], [51] and [48] (the phase 3 message) run once for
--    each row it finds, so a card with no Client Data row gets neither map_phase3 nor phase3_whatsapp
--    from Make, and one with two rows gets both twice. The native plan moves the map once either way,
--    so a parity run must model zero or several rows. Make 12's [24] is not the same case: it comes
--    after [26], the map edit, so it gates only phase4_whatsapp. No effect row holds the key (read
--    2026-11-02: none), so no record loses its label. The kickoff arrays are unchanged.
-- 3. cockpit_form_stage4_build no longer plans client_data_row; every other effect is 20261102j's, in
--    the same order.
-- 4. The onboarding registry row takes the new array that matches the one it holds (version 1 while
--    Typeform, version 2 after a go-live), so cockpit_form_stage4_go_live's drift check still passes;
--    any other array stops the file.
--
-- Unchanged, because none of them names client_data_row: the planner (it walks the version-2 array),
-- the parity plan (it returns the builder's effects), cockpit_forms_effects_valid and the relay's claim,
-- done and counts. Nothing here sends a message, writes a card or reaches a sheet.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. What this file stands on (20261102j), then the drift guard: each replaced body is the one
--    20261102j made (the live md5, read 2026-11-02) or this file's own (a second apply).

DO $$
BEGIN
  IF to_regclass('public.cockpit_form_relay_outbox') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_go_live(text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261102j before 20261102l.' USING ERRCODE = '55000';
  END IF;
END $$;

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_form_stage4_effects(text,integer)', 'afa3e203fa6dda7182d9352b38254c0e', '1b01ccc56e88b8fa4f4fc8985d36c93c'),
      ('public.cockpit_form_stage4_build(jsonb)', 'a704e72a3921191d2f06a24855d7f219', '7e5f7fdaadc74983367cd07bd8c56e3c')
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

-- ---------------------------------------------------------------------------
-- 1. The relay outbox takes only the market intel dispatch. Each CHECK is narrowed only from the
--    definition 20261102j made; one already narrowed changes nothing.

DO $$
DECLARE v_def text; v_rows bigint;
BEGIN
  SELECT count(*) INTO v_rows FROM public.cockpit_form_relay_outbox o WHERE o.effect_key = 'client_data_row';
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'The relay outbox holds Client Data rows (%), so it cannot be narrowed to the GitHub dispatch and this file stops. Check each card''s row on Client Data by hand, then ask the tech lead how to retire those rows (forms records are never deleted).', v_rows
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_form_relay_outbox'::regclass AND c.conname = 'cockpit_form_relay_outbox_effect_key_check';
  IF v_def IS DISTINCT FROM 'CHECK ((effect_key = ''github_dispatch''::text))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((effect_key = ANY (ARRAY[''client_data_row''::text, ''github_dispatch''::text])))' THEN
      RAISE EXCEPTION 'cockpit_form_relay_outbox_effect_key_check changed since 20261102j; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_form_relay_outbox DROP CONSTRAINT cockpit_form_relay_outbox_effect_key_check;
    ALTER TABLE public.cockpit_form_relay_outbox ADD CONSTRAINT cockpit_form_relay_outbox_effect_key_check
      CHECK (effect_key = 'github_dispatch');
  END IF;

  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_form_relay_outbox'::regclass AND c.conname = 'cockpit_form_relay_outbox_dedupe_key_check';
  IF v_def IS DISTINCT FROM 'CHECK ((dedupe_key ~ ''^relay:[0-9a-f-]{36}:github_dispatch$''::text))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((dedupe_key ~ ''^relay:[0-9a-f-]{36}:(client_data_row|github_dispatch)$''::text))' THEN
      RAISE EXCEPTION 'cockpit_form_relay_outbox_dedupe_key_check changed since 20261102j; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_form_relay_outbox DROP CONSTRAINT cockpit_form_relay_outbox_dedupe_key_check;
    ALTER TABLE public.cockpit_form_relay_outbox ADD CONSTRAINT cockpit_form_relay_outbox_dedupe_key_check
      CHECK (dedupe_key ~ '^relay:[0-9a-f-]{36}:github_dispatch$');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The effects arrays (4.15.2): 20261102j's, without client_data_row in either onboarding array.

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_effects(p_form_key text, p_version integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_form_key = 'kickoff' AND p_version = 1 THEN
    RETURN '[{"key":"handoff_comment","label":"Handoff comment","owner":"make","delivery":"clickup_queue"},
             {"key":"onboarding_tasks","label":"Onboarding tasks","owner":"make","delivery":"clickup_queue"},
             {"key":"card_fields","label":"Card fields","owner":"make","delivery":"clickup_queue"},
             {"key":"map_phase4","label":"Map phase 4","owner":"make","delivery":"clickup_queue"},
             {"key":"phase4_whatsapp","label":"Phase 4 WhatsApp","owner":"make","delivery":"client_message"},
             {"key":"kickoff_notice","label":"Kickoff notice","owner":"cockpit","delivery":"slack_notice"},
             {"key":"recap","label":"Recap","owner":"shadow","delivery":"client_message"}]'::jsonb;
  ELSIF p_form_key = 'kickoff' AND p_version = 2 THEN
    RETURN '[{"key":"handoff_comment","label":"Handoff comment","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"native_status","label":"Task status In progress","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"card_fields","label":"Card fields","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"onboarding_tasks","label":"Tech and creative onboarding tasks","owner":"cockpit","delivery":"sql"},
             {"key":"map_phase4","label":"Map phase 4","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"phase4_whatsapp","label":"Phase 4 WhatsApp","owner":"cockpit","delivery":"client_message"},
             {"key":"kickoff_notice","label":"Kickoff notice","owner":"cockpit","delivery":"slack_notice"},
             {"key":"new_mrr","label":"New MRR","owner":"cockpit","delivery":"sql"},
             {"key":"recap","label":"Recap","owner":"shadow","delivery":"client_message"}]'::jsonb;
  ELSIF p_form_key = 'onboarding' AND p_version = 1 THEN
    -- Make's own effects. No client_data_row: Make 13 [31] searches Client Data for the card's row and
    -- writes nothing; [49] to [48] (map_phase3 and phase3_whatsapp) run once per row it finds (20261102l).
    RETURN '[{"key":"card_fields","label":"Onboarding answers on the card (Make)","owner":"make","delivery":"clickup_queue"},
             {"key":"phase3_whatsapp","label":"Phase 3 WhatsApp message (Make)","owner":"make","delivery":"client_message"},
             {"key":"brand_dna_task","label":"Brand DNA task (Make)","owner":"make","delivery":"clickup_queue"},
             {"key":"github_dispatch","label":"GitHub dispatch (Make)","owner":"make","delivery":"sql"}]'::jsonb;
  ELSIF p_form_key = 'onboarding' AND p_version = 2 THEN
    RETURN '[{"key":"profile_fields","label":"Client Profile and kickoff link","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"raw_answers_comment","label":"Raw answers comment","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"map_phase3","label":"Map phase 3","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"github_dispatch","label":"Market intel dispatch","owner":"cockpit","delivery":"relay"},
             {"key":"phase3_whatsapp","label":"Phase 3 WhatsApp","owner":"cockpit","delivery":"client_message"},
             {"key":"brand_dna_task","label":"Brand DNA task","owner":"cockpit","delivery":"sql"},
             {"key":"read_model","label":"Answers in the client record","owner":"cockpit","delivery":"sql"}]'::jsonb;
  END IF;
  RAISE EXCEPTION 'There is no Stage 4 effects array for % version %.', coalesce(p_form_key, '(none)'), coalesce(p_version::text, '(none)')
    USING ERRCODE = '22023';
END $$;

-- ---------------------------------------------------------------------------
-- 3. The plan builder: 20261102j's, without the client_data_row effect. Input and output as there
--    (one input in, every effect's write out, in the version-2 order).

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_build(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_form text := p_input->>'formKey';
  v_task text := p_input->>'taskId';
  v_client text := coalesce(nullif(btrim(p_input->>'client'), ''), 'this client');
  v_answers jsonb := CASE WHEN jsonb_typeof(p_input->'answers') = 'array' THEN p_input->'answers' ELSE '[]'::jsonb END;
  v_hidden jsonb := CASE WHEN jsonb_typeof(p_input->'hidden') = 'object' THEN p_input->'hidden' ELSE '{}'::jsonb END;
  v_second boolean := coalesce((p_input->>'second')::boolean, false);
  v_templates jsonb := public.cockpit_form_stage4_setting('stage4.templates');
  v_by_ref jsonb;
  v_vars jsonb;
  v_list text;
  v_hidden_lines text;
  v_handoff text;
  v_new numeric;
  v_card numeric;
  v_fields jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  c jsonb;
  v_answer text;
  v_option text;
  v_part text;
  v_map text;
  v_msg jsonb;
  v_profile text;
  v_raw text;
  v_out jsonb := '[]'::jsonb;
  v_skip text;
  e jsonb;
BEGIN
  IF v_form NOT IN ('kickoff','onboarding') OR v_task IS NULL OR v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'The Stage 4 plan needs the form and the card.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_object_agg(a->>'ref', a->>'value'), '{}'::jsonb) INTO v_by_ref FROM jsonb_array_elements(v_answers) a;
  SELECT string_agg((a->>'title') || ': ' || (a->>'value'), E'\n' ORDER BY n) INTO v_list
    FROM jsonb_array_elements(v_answers) WITH ORDINALITY AS u(a, n);

  IF v_form = 'kickoff' THEN
    -- The handoff text (Make 12 [11], [18], [23]): the hidden values, then every answer.
    SELECT string_agg((h->>'label') || ': ' || (v_hidden->>(h->>'key')), E'\n' ORDER BY n) INTO v_hidden_lines
      FROM jsonb_array_elements(public.cockpit_form_stage4_hidden_map()) WITH ORDINALITY AS u(h, n)
     WHERE nullif(btrim(coalesce(v_hidden->>(h->>'key'), '')), '') IS NOT NULL;
    v_new := CASE WHEN jsonb_typeof(p_input->'newMrrUsd') = 'number' THEN (p_input->>'newMrrUsd')::numeric END;
    v_card := CASE WHEN jsonb_typeof(p_input->'cardMrr') = 'number' THEN (p_input->>'cardMrr')::numeric END;
    v_vars := jsonb_build_object('hidden', v_hidden, 'byRef', v_by_ref, 'client', v_client, 'task', v_task,
                                 'answers', coalesce(v_list, ''),
                                 'newMrr', CASE WHEN v_new IS NULL THEN '' ELSE trim_scale(v_new)::text END);
    v_handoff := CASE WHEN nullif(btrim(coalesce(v_templates->>'handoff', '')), '') IS NOT NULL
                      THEN public.cockpit_form_stage4_render(v_templates->>'handoff', v_vars)
                      ELSE array_to_string(ARRAY[
                             'KICKOFF HANDOFF for ' || v_client,
                             'CLIENT DETAILS' || E'\n' || coalesce(v_hidden_lines, 'No onboarding answers on file.'),
                             'KICKOFF ANSWERS' || E'\n' || coalesce(v_list, 'No answers.'),
                             'New MRR: ' || CASE WHEN v_new IS NULL THEN 'not given' ELSE '$' || trim_scale(v_new)::text || ' a month' END],
                           E'\n\n') END;

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'handoff_comment', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'comment_text', v_handoff,
                                 'lines', jsonb_build_array('Handoff comment on the card (' || char_length(v_handoff) || ' characters)'))));
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'native_status', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'status', 'IN PROGRESS', 'lines', jsonb_build_array('Task status: IN PROGRESS'))));

    -- The card fields (Make 12 [21]): Client Status, the nine dropdowns by the option maps, and the
    -- Blueprint link pointing at the cockpit Blueprint (the intended difference of 4.13.3).
    v_fields := jsonb_build_array(jsonb_build_object('fieldId', '9368ca9e-3549-4320-84ff-9abd0a2901cb', 'kind', 'drop_down',
      'optionId', 'dbd21650-59ce-429c-882d-5afd7d8aaa8a', 'optionName', 'Brand Blueprint Booked♠️', 'label', 'Client Status'));
    v_lines := jsonb_build_array('Client Status: Brand Blueprint Booked♠️');
    FOR c IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_card_fields()) WITH ORDINALITY AS u(x, n) ORDER BY n LOOP
      v_answer := nullif(btrim(coalesce(v_by_ref->>(c->>'ref'), '')), '');
      CONTINUE WHEN v_answer IS NULL;
      v_option := NULL;
      -- A list (Service Advertised is a multi choice): the first listed answer the map knows. Make's
      -- switch() never matches a list (kickoff-path.md 2), so this field was empty on every card.
      FOREACH v_part IN ARRAY string_to_array(v_answer, ', ') LOOP
        SELECT m.option_name INTO v_option FROM public.cockpit_form_option_maps m
         WHERE m.form_key = 'kickoff' AND m.field_id = c->>'fieldId' AND m.answer = btrim(v_part);
        EXIT WHEN v_option IS NOT NULL;
      END LOOP;
      CONTINUE WHEN v_option IS NULL;
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', c->>'fieldId', 'kind', 'drop_down',
        'optionName', v_option, 'label', c->>'label'));
      v_lines := v_lines || to_jsonb((c->>'label') || ': ' || v_option);
    END LOOP;
    v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '1b7a4a74-d0e7-4a7f-9218-59c80a738186', 'kind', 'url',
      'value', 'https://cockpit.maharamedia.com/client-success/clients/' || v_task || '/present/blueprint?view=prep',
      'label', '🧬 Brand Blueprint Form Link'));
    v_lines := v_lines || to_jsonb('🧬 Brand Blueprint Form Link: the cockpit Blueprint'::text);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'card_fields', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'fields', v_fields, 'lines', v_lines)));

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'onboarding_tasks', 'delivery', 'sql',
      'plan', jsonb_build_object('typeKey', 'client_onboarding', 'details', left(v_handoff, 4000),
                                 'lines', jsonb_build_array('Technical Onboarding Check and Creative Onboarding tasks'))));

    v_map := public.cockpit_form_stage4_map_url(4, v_task);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'map_phase4', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'fieldId', '51f49cb1-9f76-48be-b639-c42ca552d20a', 'phase', 4, 'value', v_map,
                                 'lines', jsonb_build_array('Onboarding Map: phase 4')),
      'missing', CASE WHEN v_map IS NULL THEN 'The phase 4 map link is not set up yet (onboarding.map_urls), so the map was not moved.' END));

    v_msg := public.cockpit_form_stage4_message('phase4', p_input->>'client', v_map);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'phase4_whatsapp', 'delivery', 'client_message',
      'plan', jsonb_build_object('kind', 'phase4', 'body', v_msg->>'body', 'lines', jsonb_build_array('Phase 4 WhatsApp, waiting for the CSM''s approval')),
      'missing', v_msg->>'missing'));

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'kickoff_notice', 'delivery', 'slack_notice',
      'plan', jsonb_build_object('dedupe', 'kickoff:' || coalesce(p_input->>'readModelResponseId', p_input->>'responseId', ''),
                                 'lines', jsonb_build_array('Kickoff notice in #csm-general'))));

    -- New MRR (Q21, 3.5): the live mrr write only when the answer differs from the card's; never for
    -- 0 against an empty card MRR; never for a card off the billing sheet.
    v_skip := CASE
      WHEN v_new IS NULL THEN 'No New MRR answer, so the card''s MRR is left as it is.'
      WHEN NOT coalesce((p_input->>'cardOnSheet')::boolean, false) THEN 'This card is not on the billing sheet, so New MRR is not written.'
      WHEN v_card IS NOT NULL AND v_card = v_new THEN 'The card already shows that MRR.'
      WHEN v_new = 0 AND coalesce(v_card, 0) = 0 THEN 'New MRR is 0 and the card''s MRR is empty, so nothing changes.'
    END;
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'new_mrr', 'delivery', 'sql',
      'plan', jsonb_build_object('from', v_card, 'to', v_new,
                                 'reason', CASE WHEN v_new = 0 THEN 'Kickoff: paid in full, no monthly fee' ELSE 'Kickoff: New MRR answer' END,
                                 'lines', jsonb_build_array('MRR: ' || coalesce('$' || trim_scale(v_card)::text, 'empty') || ' to '
                                                            || coalesce('$' || trim_scale(v_new)::text, 'not given'))),
      'skip', v_skip));
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'recap', 'delivery', 'client_message',
      'plan', jsonb_build_object('lines', jsonb_build_array('Recap: stays off (Q22)')),
      'skip', 'Kickoff recaps stay off (Q22).'));

    -- A second kickoff (4.13, 3.3): only the handoff comment again.
    IF v_second THEN
      SELECT coalesce(jsonb_agg(CASE WHEN x->>'key' = 'handoff_comment' THEN x
                                     ELSE x || jsonb_build_object('skip', coalesce(x->>'skip',
                                       'A second kickoff posts only the handoff comment.')) END ORDER BY n), '[]'::jsonb)
        INTO v_out FROM jsonb_array_elements(v_out) WITH ORDINALITY AS u(x, n);
    END IF;
    RETURN v_out;
  END IF;

  -- Onboarding (Make 13): the Client Profile and the kickoff link, the raw answers comment, the map
  -- at phase 3, the market intel dispatch (relay), the phase 3 WhatsApp, the Brand DNA task and the
  -- read model. Nothing writes Client Data: Make 13 [31] only searches it (20261102l).
  v_vars := jsonb_build_object('hidden', v_hidden, 'byRef', v_by_ref, 'client', v_client, 'task', v_task,
                               'answers', coalesce(v_list, ''), 'newMrr', '');
  SELECT string_agg(x.label || ': ' || (v_by_ref->>x.ref), E'\n' ORDER BY x.n) INTO v_profile
    FROM (VALUES (1, '7ff5d37a-df7f-4002-8248-d0b4af6c28e8', 'Revenue last year'),
                 (2, '791b99b8-c7e9-40a4-96d6-868399e1ae97', '90-day goal'),
                 (3, 'f4b96a9b-bd7c-4398-98b4-6a28a7d3595a', '12 to 24-month goal'),
                 (4, 'bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6', 'Marketing tried'),
                 (5, 'fcf43e6a-cc84-4ae7-9cef-2336069d0280', 'Top challenges'),
                 (6, '7426c6c5-344f-44c9-9999-3b9daf3a06b8', 'Why they joined'),
                 (7, '41d2d5bb-b023-4fa4-906c-72aeef7a5e46', 'Anything else')) AS x(n, ref, label)
   WHERE nullif(btrim(coalesce(v_by_ref->>x.ref, '')), '') IS NOT NULL;
  v_profile := CASE WHEN nullif(btrim(coalesce(v_templates->>'profile', '')), '') IS NOT NULL
                    THEN public.cockpit_form_stage4_render(v_templates->>'profile', v_vars)
                    ELSE coalesce(v_profile, '') END;
  v_raw := CASE WHEN nullif(btrim(coalesce(v_templates->>'rawAnswers', '')), '') IS NOT NULL
                THEN public.cockpit_form_stage4_render(v_templates->>'rawAnswers', v_vars)
                ELSE 'Raw Onboarding Form Answers' || E'\n\n' || coalesce(v_list, 'No answers.') END;
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'profile_fields', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'fields', jsonb_build_array(
        jsonb_build_object('fieldId', '7755485f-74a8-496c-85d8-562588e77944', 'kind', 'text', 'value', left(v_profile, 5000), 'label', 'Client Profile'),
        jsonb_build_object('fieldId', '87d7d889-afea-42f8-9485-6f3ead5b857f', 'kind', 'url',
                           'value', 'https://cockpit.maharamedia.com/client-success/clients/' || v_task || '?form=kickoff',
                           'label', 'Kickoff Form Link')),
      'lines', jsonb_build_array('Client Profile (' || char_length(v_profile) || ' characters)', 'Kickoff Form Link: the cockpit kickoff'))));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'raw_answers_comment', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'comment_text', v_raw,
                               'lines', jsonb_build_array('Raw answers comment (' || char_length(v_raw) || ' characters)'))));
  v_map := public.cockpit_form_stage4_map_url(3, v_task);
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'map_phase3', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'fieldId', '51f49cb1-9f76-48be-b639-c42ca552d20a', 'phase', 3, 'value', v_map,
                               'lines', jsonb_build_array('Onboarding Map: phase 3')),
    'missing', CASE WHEN v_map IS NULL THEN 'The phase 3 map link is not set up yet (onboarding.map_urls), so the map was not moved.' END));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'github_dispatch', 'delivery', 'relay',
    'plan', jsonb_build_object('payload', jsonb_build_object('taskId', v_task, 'client', p_input->>'client'),
                               'lines', jsonb_build_array('Market intel dispatch'))));
  v_msg := public.cockpit_form_stage4_message('phase3', p_input->>'client', v_map);
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'phase3_whatsapp', 'delivery', 'client_message',
    'plan', jsonb_build_object('kind', 'phase3', 'body', v_msg->>'body', 'lines', jsonb_build_array('Phase 3 WhatsApp, waiting for the CSM''s approval')),
    'missing', v_msg->>'missing'));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'brand_dna_task', 'delivery', 'sql',
    'plan', jsonb_build_object('typeKey', 'brand_dna', 'details', left(v_raw, 4000), 'lines', jsonb_build_array('Brand DNA task'))));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'read_model', 'delivery', 'sql',
    'plan', jsonb_build_object('entry', jsonb_build_object('form_id', coalesce(p_input->>'readModelFormId', 'native'),
                                                           'response_id', coalesce(p_input->>'readModelResponseId', p_input->>'responseId'),
                                                           'submitted_at', p_input->>'submittedAt', 'answers', v_answers),
                               'lines', jsonb_build_array('Answers in the client record'))));
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The onboarding registry row: 20261102j's version-1 array (live while Typeform) becomes the new
--    version 1, its version-2 array (after a go-live) the new version 2. Either new array already
--    there changes nothing; any other array stops the file. One audit row (cockpit_forms_audit).

DO $$
DECLARE
  f public.cockpit_forms;
  v_old1 jsonb := '[{"key":"card_fields","label":"Onboarding answers on the card (Make)","owner":"make","delivery":"clickup_queue"},
             {"key":"client_data_row","label":"Client Data sheet row (Make)","owner":"make","delivery":"sql"},
             {"key":"phase3_whatsapp","label":"Phase 3 WhatsApp message (Make)","owner":"make","delivery":"client_message"},
             {"key":"brand_dna_task","label":"Brand DNA task (Make)","owner":"make","delivery":"clickup_queue"},
             {"key":"github_dispatch","label":"GitHub dispatch (Make)","owner":"make","delivery":"sql"}]'::jsonb;
  v_old2 jsonb := '[{"key":"profile_fields","label":"Client Profile and kickoff link","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"raw_answers_comment","label":"Raw answers comment","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"map_phase3","label":"Map phase 3","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"client_data_row","label":"Client Data sheet row","owner":"cockpit","delivery":"relay"},
             {"key":"github_dispatch","label":"Market intel dispatch","owner":"cockpit","delivery":"relay"},
             {"key":"phase3_whatsapp","label":"Phase 3 WhatsApp","owner":"cockpit","delivery":"client_message"},
             {"key":"brand_dna_task","label":"Brand DNA task","owner":"cockpit","delivery":"sql"},
             {"key":"read_model","label":"Answers in the client record","owner":"cockpit","delivery":"sql"}]'::jsonb;
  v_new1 jsonb := public.cockpit_form_stage4_effects('onboarding', 1);
  v_new2 jsonb := public.cockpit_form_stage4_effects('onboarding', 2);
  v_to jsonb;
BEGIN
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = 'onboarding' FOR UPDATE;
  IF f.key IS NULL THEN
    RAISE EXCEPTION 'There is no onboarding row in the forms registry; apply 20261102c before 20261102l.' USING ERRCODE = '55000';
  END IF;
  IF f.effects = v_new1 OR f.effects = v_new2 THEN
    RETURN;
  END IF;
  v_to := CASE WHEN f.effects = v_old1 THEN v_new1 WHEN f.effects = v_old2 THEN v_new2 END;
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'The onboarding effects changed since 20261102j; stop and re-read them.' USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('cockpit.audit_actor', 'migration 20261102l', true);
  PERFORM set_config('cockpit.audit_source', 'migration', true);
  PERFORM set_config('cockpit.forms_action', 'forms.stage4_no_client_data_row', true);
  UPDATE public.cockpit_forms SET effects = v_to, updated_by = 'migration 20261102l', updated_at = now()
   WHERE key = 'onboarding';
  PERFORM set_config('cockpit.forms_action', '', true);
END $$;

-- ---------------------------------------------------------------------------
-- 5. Privileges: the two replaced functions stay the owner's only (20261102j 18).

REVOKE ALL ON FUNCTION public.cockpit_form_stage4_effects(text,integer), public.cockpit_form_stage4_build(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
