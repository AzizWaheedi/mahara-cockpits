-- Kickoff and Brand Blueprint in the forms tables (docs/forms/STAGE2B-CONTRACT.md
-- sections 2.9, 3.9 and 4.8, build 8). Creative Triage (bldgtotkfmhoxmlzowdx).
-- Additive; applies twice. The seventh 2b file.
--
-- Records only, never a delivery (Z21): Stage 1 keeps delivering the kickoff
-- notice, the Blueprint presses and their notices under its own keys; this
-- file writes what happened into cockpit_form_responses and
-- cockpit_form_effects, so kickoff and Blueprint read like the 1-1 notes.
--
-- 1. cockpit_forms_keys takes the one provider typeform_kickoff (Z58): the
--    signing secret of the kickoff form's cockpit webhook (forms-door). Its
--    put, mark, label and the CEO card's status learn it; the status lists it
--    in a separate typeform array and keeps keys to its four providers (Z57).
-- 2. cockpit_form_record_typeform (the forms door and the 15-minute read):
--    one kickoff response per Typeform token, its content kept once in
--    cockpit_csm_call_forms (the response holds a pointer and the card id
--    only: kickoff hidden fields carry the client's email and phone), and
--    its make and shadow effects recorded skipped.
-- 3. cockpit_form_record_sweep (hermes/csm-calls, every 15 minutes): every
--    stored kickoff with no response, every Blueprint press with no response,
--    and each cockpit-owned effect recorded from its Stage 1 row's outcome
--    (delivered, skipped with Stage 1's reason, or waiting while Stage 1 is
--    in flight). p_apply false writes nothing. A row it cannot record is left
--    for the next call and counted; firstError is the first one's SQLSTATE
--    (the code only, never a message that could hold a row's text), or null.
-- 4. cockpit_forms_door_seen: the forms door's last delivery and outcome in
--    cockpit_sync_state forms-door:kickoff. That row fails only on a real
--    fault of the door, never because it exists or an outsider posted to it.
--
-- No row reaches a card, Slack or a client from here, and the counts of
-- cockpit_slack_notices, cockpit_creative_outbox and the writeback queue never
-- change. Every function is SECURITY DEFINER with an empty search path,
-- revoked from all four roles, then granted as section 2.9 says; the four
-- replaced bodies keep their live grants and are checked first (Z61).
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
      ('cockpit_forms_key_put(jsonb)', '68763f4ab3de37be2fe538bc80155a43', '6bc3394855a1120060c8105d93399f52'),
      ('cockpit_forms_key_mark(jsonb)', 'db3c2859624bdbb75b43bf7de85f2672', 'da921eebe001f597840e8e930bc0b69e'),
      ('cockpit_forms_key_label(text)', '5f01adc978c71ba5b7834b6083ea0b93', 'a4a69845be8fcc978842aa024ce298e4'),
      ('cockpit_forms_keys_status()', '5ecbb4ae9493c0ef1c6f14cc78c84e12', 'f37568dfb69e44327ca8c5552c1d04f2')
    ) AS x(fn, live, after) LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.' || r.fn);
    IF v IS DISTINCT FROM r.live AND v IS DISTINCT FROM r.after THEN
      RAISE EXCEPTION '% changed since the 2b contract read it; stop and re-read it.', r.fn USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The kickoff form's signing key

-- One literal, no pattern: no other form's key can be saved in 2b (Z58).
-- Widened only from the definition the contract read: another session's value
-- would be dropped here without a word and fail its writer later, so any other
-- definition stops the file (the CHECK's own drift guard, as Z61's for bodies).
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_forms_keys'::regclass
     AND c.conname = 'cockpit_forms_keys_provider_check';
  IF v_def IS DISTINCT FROM 'CHECK ((provider = ANY (ARRAY[''fathom''::text, ''fathom_webhook''::text, ''anthropic''::text, ''deepseek''::text, ''typeform_kickoff''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((provider = ANY (ARRAY[''fathom''::text, ''fathom_webhook''::text, ''anthropic''::text, ''deepseek''::text])))' THEN
      RAISE EXCEPTION 'cockpit_forms_keys_provider_check changed since the 2b contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_forms_keys DROP CONSTRAINT IF EXISTS cockpit_forms_keys_provider_check;
    ALTER TABLE public.cockpit_forms_keys ADD CONSTRAINT cockpit_forms_keys_provider_check
      CHECK (provider IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff'));
  END IF;
END $$;

-- 20261027g's four key functions, each with the typeform_kickoff lines only.
-- The put validates the secret (32 to 128 url-safe characters), keeps a new
-- secret's meta whole (a new registration) and writes forms-door:kickoff's
-- registered flag and registeredAt; the mark writes them too. "Registered"
-- is read as forms_key.py and the Fathom webhook read it
-- (cockpit_forms_webhook_detail): a webhook id and no unregisteredAt in the
-- key's meta. register-typeform marks it connected with both,
-- unregister-typeform marks it refused with unregisteredAt, and a new secret
-- replaces the meta, so it is not registered until registered again. The
-- guardian counts missed kickoffs only from registeredAt. The status adds the
-- typeform array beside keys.

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
  k public.cockpit_forms_keys;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff') THEN
    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic, deepseek or typeform_kickoff.' USING ERRCODE = '22023';
  END IF;
  v_ok := CASE v_provider
    WHEN 'fathom' THEN char_length(v_secret) BETWEEN 20 AND 400 AND v_secret !~ '[[:space:]]'
    WHEN 'fathom_webhook' THEN v_secret ~ '^whsec_[A-Za-z0-9+/=_-]{16,}$'
    WHEN 'anthropic' THEN v_secret ~ '^sk-ant-[A-Za-z0-9_-]{20,}$'
    WHEN 'deepseek' THEN v_secret ~ '^sk-[A-Za-z0-9]{20,}$'
    WHEN 'typeform_kickoff' THEN v_secret ~ '^[A-Za-z0-9_-]{32,128}$' END;
  IF NOT coalesce(v_ok, false) AND v_provider = 'typeform_kickoff' THEN
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
         meta = CASE WHEN EXCLUDED.provider IN ('fathom_webhook','typeform_kickoff') THEN EXCLUDED.meta ELSE k0.meta || EXCLUDED.meta END
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
  IF v_provider = 'typeform_kickoff' THEN
    -- Registered: a webhook id and no unregisteredAt, as the Fathom webhook.
    v_registered := (public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean;
    -- A saved key is no failing job. While nothing is registered there is no
    -- delivery to lose, so an earlier failure stops counting too.
    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
    VALUES ('forms-door:kickoff', now(), now(), true,
            CASE WHEN v_registered THEN 'The kickoff webhook is registered.'
                 ELSE 'The kickoff signing key is saved; the webhook is not registered with it yet.' END,
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
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff') THEN
    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic, deepseek or typeform_kickoff.' USING ERRCODE = '22023';
  END IF;
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
  ELSIF v_provider = 'typeform_kickoff' THEN
    -- Registered: a webhook id and no unregisteredAt, as the Fathom webhook.
    -- registeredAt is the registration's own time, so the guardian counts
    -- missed kickoffs only from then.
    v_was := (public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean;
    v_now := (public.cockpit_forms_webhook_detail(n.meta, n.saved_at)->>'registered')::boolean;
    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
    VALUES ('forms-door:kickoff', now(), now(), true,
            CASE WHEN v_now THEN 'The kickoff webhook is registered.'
                 ELSE 'The kickoff webhook is not registered: kickoffs arrive by the 15-minute read.' END,
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
                         WHEN 'typeform_kickoff' THEN 'Typeform kickoff signing key' END
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
  -- The kickoff form's Typeform signing key, apart from keys (Z57).
  SELECT * INTO tk FROM public.cockpit_forms_keys x WHERE x.provider = 'typeform_kickoff';
  SELECT * INTO v_door FROM public.cockpit_sync_state x WHERE x.key = 'forms-door:kickoff';
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
    'typeform', jsonb_build_array(jsonb_build_object(
      'form', 'kickoff',
      'connected', coalesce(tk.state = 'connected', false),
      'last4', tk.last4,
      'registered', coalesce((public.cockpit_forms_webhook_detail(tk.meta, tk.saved_at)->>'registered')::boolean, false),
      'lastDelivery', v_door.detail->'lastDelivery')),
    'now', now());
END $$;

-- ---------------------------------------------------------------------------
-- 2. Recording a kickoff response (internal, then the service RPC)

-- One kickoff response from its stored Typeform row: the pointer answers
-- {source, formId, token} and hidden {onboarding_client_id} only, never the
-- row's answers or other hidden fields; then each registry effect owned by
-- Make or shadow, recorded skipped. Once per token (the responses' unique
-- key). The cockpit-owned kickoff notice is recorded by the sweep from
-- Stage 1's own row.
CREATE OR REPLACE FUNCTION public.cockpit_form_record_kickoff(p_token text, p_via text, p_submitted timestamptz,
  p_card text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  t public.cockpit_csm_call_forms;
  v_id uuid;
  v_task text;
  v_inserted boolean := false;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  e jsonb;
BEGIN
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = 'kickoff';
  SELECT * INTO t FROM public.cockpit_csm_call_forms x WHERE x.token = p_token;
  v_task := CASE WHEN t.task_id ~ '^[A-Za-z0-9_-]{1,40}$' THEN t.task_id END;
  PERFORM set_config('cockpit.forms_action', 'forms.recorded', true);
  PERFORM set_config('cockpit.audit_actor', 'typeform', true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, hidden, created_by, submitted_by, submitted_at)
  VALUES ('kickoff', f.version, p_via, p_token, v_task,
          (SELECT nullif(btrim(s.data->>'name'), '') FROM public.cockpit_csm_sources s
            WHERE s.table_name = 'clients' AND s.data->>'taskId' = v_task LIMIT 1),
          'live', 'submitted',
          jsonb_build_object('source', 'typeform', 'formId', f.typeform_id, 'token', p_token),
          jsonb_strip_nulls(jsonb_build_object('onboarding_client_id', nullif(btrim(p_card), ''))),
          'typeform', 'typeform', coalesce(p_submitted, t.submitted_at, now()))
  ON CONFLICT (form_key, external_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    v_inserted := true;
    FOR e IN SELECT q FROM jsonb_array_elements(f.effects) WITH ORDINALITY z(q, o)
              WHERE q->>'owner' IN ('make','shadow') ORDER BY o LOOP
      INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, state, reason)
      VALUES (v_id, 'kickoff', e->>'key', v_id::text || ':' || (e->>'key'), e->>'owner', e->>'delivery', 'skipped',
              CASE WHEN e->>'owner' = 'make' THEN 'Make owns this.' ELSE 'No cockpit plan for this yet.' END)
      ON CONFLICT DO NOTHING;
    END LOOP;
  ELSE
    SELECT r.id INTO v_id FROM public.cockpit_form_responses r WHERE r.form_key = 'kickoff' AND r.external_id = p_token;
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'inserted', v_inserted,
    'taskId', (SELECT r.task_id FROM public.cockpit_form_responses r WHERE r.id = v_id),
    'state', (SELECT r.state FROM public.cockpit_form_responses r WHERE r.id = v_id));
END $$;

-- The forms door (via typeform_webhook) and the read (typeform_sync), section
-- 3.9: p = {formKey ('kickoff' only in 2b), token, submittedAt, hidden,
-- answers: [{ref, type, title, value}], recordingUrl, via}. The webhook path
-- first stores the Typeform row the csm-calls worker would write (never over
-- a stored one, so a person's match stays), then the response.
CREATE OR REPLACE FUNCTION public.cockpit_form_record_typeform(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_token text := p->>'token';
  v_via text := p->>'via';
  v_at timestamptz;
  v_hidden jsonb := CASE WHEN jsonb_typeof(p->'hidden') = 'object' THEN p->'hidden' ELSE '{}'::jsonb END;
  v_card text;
  v_task text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Send the response as an object.' USING ERRCODE = '22023';
  END IF;
  IF p->>'formKey' IS DISTINCT FROM 'kickoff' THEN
    RAISE EXCEPTION 'Only the kickoff form is recorded from Typeform in 2b.' USING ERRCODE = '22023';
  END IF;
  IF v_token IS NULL OR v_token !~ '^[A-Za-z0-9]{8,64}$' THEN
    RAISE EXCEPTION 'That is not a Typeform response token.' USING ERRCODE = '22023';
  END IF;
  IF v_via IS NULL OR v_via NOT IN ('typeform_webhook','typeform_sync') THEN
    RAISE EXCEPTION 'Choose typeform_webhook or typeform_sync.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_at := (p->>'submittedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_at := NULL;
  END;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'The response has no readable submit time.' USING ERRCODE = '22023';
  END IF;
  IF p ? 'answers' AND jsonb_typeof(p->'answers') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'The answers come as a list.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = 'kickoff';
  IF f.typeform_id IS NULL OR f.provider IS DISTINCT FROM 'typeform' THEN
    RAISE EXCEPTION 'The kickoff form is not on Typeform in the registry.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_source', CASE v_via WHEN 'typeform_webhook' THEN 'forms-door' ELSE 'csm-calls' END, true);
  v_card := nullif(btrim(v_hidden->>'onboarding_client_id'), '');
  IF v_via = 'typeform_webhook' THEN
    -- The worker's rule (hermes/csm-calls/sources.ts readTypeforms): the card
    -- when the hidden id is one on the roster, else the typed id.
    v_task := CASE WHEN v_card ~ '^[A-Za-z0-9_-]{1,40}$' AND EXISTS (
                     SELECT 1 FROM public.cockpit_csm_sources s WHERE s.table_name = 'clients' AND s.data->>'taskId' = v_card)
                   THEN v_card END;
    INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, typed_client, matched_by, submitted_at,
      answers, hidden, recording_url)
    VALUES (v_token, f.typeform_id, 'kickoff', v_task, CASE WHEN v_task IS NULL THEN v_card END,
            CASE WHEN v_task IS NOT NULL THEN 'hidden_field' END, v_at,
            coalesce(p->'answers', '[]'::jsonb), v_hidden,
            CASE WHEN jsonb_typeof(p->'recordingUrl') = 'string' THEN p->>'recordingUrl' END)
    ON CONFLICT (token) DO NOTHING;
  END IF;
  RETURN public.cockpit_form_record_kickoff(v_token, v_via, v_at, v_card);
END $$;

-- ---------------------------------------------------------------------------
-- 3. The record sweep

-- One cockpit-owned kickoff or Blueprint effect recorded from its Stage 1
-- row (internal): Stage 1 sent it, delivered with the row it recorded; it
-- ended unsent, skipped with Stage 1's own reason; in flight, nothing yet.
-- A failed notice is not final: a person can requeue it (cockpit_slack_notice_fix)
-- and it then posts, and an effect row is never revisited. So it waits, as one in
-- flight does, until 48 hours after the response, then skips with Stage 1's reason.
-- Answers 'delivered', 'skipped' or 'waiting'.
CREATE OR REPLACE FUNCTION public.cockpit_form_record_effect(p_response public.cockpit_form_responses, p_effect jsonb,
  p_table text, p_id text, p_dedupe text, p_state text, p_reason text, p_what text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_state text;
  v_reason text;
  v_record text := current_setting('cockpit.forms_record', true);
BEGIN
  IF p_table = 'cockpit_slack_notices' THEN
    v_state := CASE WHEN p_state = 'posted' THEN 'delivered'
                    WHEN p_state IN ('skipped','muted') THEN 'skipped'
                    WHEN p_state = 'failed' AND p_response.submitted_at <= now() - interval '48 hours' THEN 'skipped' END;
    v_reason := CASE WHEN v_state = 'skipped'
                     THEN 'Stage 1 did not send it: ' || coalesce(nullif(btrim(p_reason), ''), 'the notice ended ' || p_state || '.') END;
  ELSIF p_table = 'cockpit_creative_outbox' THEN
    v_state := CASE WHEN p_state IN ('done','reconcile') THEN 'delivered' WHEN p_state = 'failed' THEN 'skipped' END;
    v_reason := CASE WHEN v_state = 'skipped'
                     THEN 'The press did not run: ' || coalesce(nullif(btrim(p_reason), ''), 'no reason was recorded.') END;
  ELSIF p_table IS NULL THEN
    -- No Stage 1 row 48 hours after the response.
    IF p_response.submitted_at <= now() - interval '48 hours' THEN
      v_state := 'skipped';
      v_reason := 'No Stage 1 notice was made for this ' || p_what || '.';
    END IF;
  ELSE
    -- A notice of that key made for another press.
    v_state := 'skipped';
    v_reason := 'Posted for an earlier press.';
  END IF;
  IF v_state IS NULL THEN
    RETURN 'waiting';
  END IF;
  PERFORM set_config('cockpit.forms_record', 'on', true);
  INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, delivery_ref, plan,
    receipt, state, reason)
  VALUES (p_response.id, p_response.form_key, p_effect->>'key', p_response.id::text || ':' || (p_effect->>'key'), 'cockpit',
          p_effect->>'delivery', CASE WHEN v_state = 'delivered' THEN p_id END,
          jsonb_build_object('recorded', true, 'lines', '[]'::jsonb,
            'stage1', CASE WHEN p_id IS NOT NULL THEN jsonb_build_object('table', p_table, 'id', p_id, 'dedupeKey', p_dedupe,
                                                                        'state', p_state) END),
          CASE WHEN v_state = 'delivered' THEN jsonb_build_object('table', p_table, 'id', p_id, 'state', p_state) END,
          v_state, left(v_reason, 240))
  ON CONFLICT DO NOTHING;
  PERFORM set_config('cockpit.forms_record', coalesce(v_record, ''), true);
  RETURN v_state;
END $$;

-- Every 15 minutes from hermes/csm-calls (sources.ts formsRecord), and from
-- its doctor with p_apply false, which runs the same steps and writes
-- nothing. At most 200 records a call. Answer: {apply, kickoff: {recorded,
-- already}, blueprint: {recorded}, effects: {delivered, skipped, waiting},
-- errors}. A row that cannot be recorded is counted in errors and left for
-- the next call; it never stops the others.
CREATE OR REPLACE FUNCTION public.cockpit_form_record_sweep(p_apply boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_apply boolean := coalesce(p_apply, true);
  fk public.cockpit_forms;
  fb public.cockpit_forms;
  t public.cockpit_csm_call_forms;
  o public.cockpit_creative_outbox;
  r public.cockpit_form_responses;
  n public.cockpit_slack_notices;
  ob public.cockpit_creative_outbox;
  e jsonb;
  v_part integer;
  v_kind text;
  v_key text;
  v_done text;
  v_budget integer := 200;
  v_recorded integer := 0;
  v_already integer := 0;
  v_presses integer := 0;
  v_delivered integer := 0;
  v_skipped integer := 0;
  v_waiting integer := 0;
  v_errors integer := 0;
  v_first_error text;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
BEGIN
  PERFORM public.cockpit_hours_require_service();
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_form_record_sweep', 0));
  SELECT * INTO fk FROM public.cockpit_forms x WHERE x.key = 'kickoff';
  SELECT * INTO fb FROM public.cockpit_forms x WHERE x.key = 'blueprint';
  BEGIN
    PERFORM set_config('cockpit.audit_source', 'csm-calls', true);

    -- (a) Every stored kickoff with no response.
    FOR t IN SELECT * FROM public.cockpit_csm_call_forms x
              WHERE fk.typeform_id IS NOT NULL AND x.form_id = fk.typeform_id ORDER BY x.submitted_at, x.token LOOP
      IF EXISTS (SELECT 1 FROM public.cockpit_form_responses z WHERE z.form_key = 'kickoff' AND z.external_id = t.token) THEN
        v_already := v_already + 1;
      ELSIF v_budget > 0 AND t.token ~ '^[A-Za-z0-9]{8,64}$' THEN
        BEGIN
          PERFORM public.cockpit_form_record_kickoff(t.token, 'typeform_sync', t.submitted_at,
            nullif(btrim(t.hidden->>'onboarding_client_id'), ''));
          v_recorded := v_recorded + 1;
          v_budget := v_budget - 1;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors + 1;
          v_first_error := coalesce(v_first_error, SQLSTATE);
        END;
      END IF;
    END LOOP;

    -- (b) Every Blueprint press with no response: the outbox row's id is the response's.
    PERFORM set_config('cockpit.forms_action', 'forms.recorded', true);
    FOR o IN SELECT * FROM public.cockpit_creative_outbox x
              WHERE x.kind IN ('blueprintLaunch','blueprintClose','blueprintOffer')
                AND NOT EXISTS (SELECT 1 FROM public.cockpit_form_responses z WHERE z.id = x.id)
              ORDER BY x.created_at, x.id LOOP
      EXIT WHEN v_budget <= 0;
      BEGIN
        v_part := CASE o.kind WHEN 'blueprintLaunch' THEN 1 WHEN 'blueprintClose' THEN 2 ELSE 3 END;
        PERFORM set_config('cockpit.audit_actor', coalesce(nullif(btrim(o.actor_email), ''), 'import'), true);
        INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, task_id, client_name, mode, state,
          answers, created_by, created_by_id, submitted_by, submitted_at)
        VALUES (o.id, 'blueprint', fb.version, CASE WHEN o.actor_id IS NOT NULL THEN 'cockpit' ELSE 'import' END,
                CASE WHEN o.task_id ~ '^[A-Za-z0-9_-]{1,40}$' THEN o.task_id END, o.client_name, 'live', 'submitted',
                jsonb_build_object('part', v_part, 'outboxId', o.id,
                  'press', (SELECT count(*) FROM public.cockpit_creative_outbox p
                             WHERE p.task_id IS NOT DISTINCT FROM o.task_id AND p.kind = o.kind
                               AND (p.created_at, p.id) <= (o.created_at, o.id))),
                CASE WHEN o.actor_id IS NOT NULL THEN coalesce(nullif(btrim(o.actor_email), ''), 'import') ELSE 'import' END,
                o.actor_id, CASE WHEN o.actor_id IS NOT NULL THEN nullif(btrim(o.actor_email), '') END, o.created_at)
        ON CONFLICT (id) DO NOTHING;
        -- That part's shadow effects (phase 5 and the recap follow the close).
        IF v_part = 2 THEN
          FOR e IN SELECT q FROM jsonb_array_elements(fb.effects) WITH ORDINALITY z(q, k)
                    WHERE q->>'owner' = 'shadow' AND q->>'key' IN ('phase5_whatsapp','recap') ORDER BY k LOOP
            INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, state, reason)
            VALUES (o.id, 'blueprint', e->>'key', o.id::text || ':' || (e->>'key'), 'shadow', e->>'delivery', 'skipped',
                    'No cockpit plan for this yet.')
            ON CONFLICT DO NOTHING;
          END LOOP;
        END IF;
        v_presses := v_presses + 1;
        v_budget := v_budget - 1;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors + 1;
        v_first_error := coalesce(v_first_error, SQLSTATE);
      END;
    END LOOP;
    PERFORM set_config('cockpit.audit_actor', 'typeform', true);

    -- (c) Each cockpit-owned kickoff or Blueprint effect, from its Stage 1 row.
    PERFORM set_config('cockpit.forms_action', 'forms.recorded_from_stage1', true);
    FOR r IN SELECT * FROM public.cockpit_form_responses x
              WHERE x.form_key IN ('kickoff','blueprint') AND x.mode = 'live' AND x.state IN ('submitted','confirmed')
              ORDER BY x.submitted_at, x.id LOOP
      FOR e IN SELECT q FROM jsonb_array_elements(CASE WHEN r.form_key = 'kickoff' THEN fk.effects ELSE fb.effects END)
                         WITH ORDINALITY z(q, k)
                WHERE q->>'owner' = 'cockpit' ORDER BY k LOOP
        v_key := e->>'key';
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.cockpit_form_effects x WHERE x.response_id = r.id AND x.effect_key = v_key);
        v_part := CASE WHEN r.form_key = 'blueprint' AND (r.answers->>'part') ~ '^[123]$' THEN (r.answers->>'part')::integer END;
        -- Only the effects of this press's own part.
        CONTINUE WHEN r.form_key = 'blueprint' AND NOT coalesce(
             (v_part = 1 AND v_key = 'launch_task')
          OR (v_part = 2 AND v_key IN ('close_card','close_notice','media_notice'))
          OR (v_part = 3 AND v_key = 'offer_card'), false);
        IF v_budget <= 0 THEN
          v_waiting := v_waiting + 1;
          CONTINUE;
        END IF;
        BEGIN
          IF r.form_key = 'kickoff' THEN
            SELECT * INTO n FROM public.cockpit_slack_notices x WHERE x.dedupe_key = 'kickoff:' || r.external_id;
            v_done := public.cockpit_form_record_effect(r, e,
              CASE WHEN n.id IS NOT NULL THEN 'cockpit_slack_notices' END, n.id::text, n.dedupe_key, n.state, n.error,
              'kickoff');
          ELSIF v_key IN ('launch_task','close_card','offer_card') THEN
            SELECT * INTO ob FROM public.cockpit_creative_outbox x WHERE x.id = r.id;
            v_done := public.cockpit_form_record_effect(r, e,
              CASE WHEN ob.id IS NOT NULL THEN 'cockpit_creative_outbox' END, ob.id::text, NULL, ob.state, ob.error,
              'press');
          ELSE
            v_kind := CASE v_key WHEN 'close_notice' THEN 'close' ELSE 'media' END;
            SELECT * INTO n FROM public.cockpit_slack_notices x WHERE x.dedupe_key = 'blueprint:' || r.task_id || ':' || v_kind;
            IF n.id IS NOT NULL AND n.facts->>'outboxId' IS DISTINCT FROM r.id::text THEN
              v_done := public.cockpit_form_record_effect(r, e, 'other', n.id::text, n.dedupe_key, n.state, NULL, 'press');
            ELSE
              v_done := public.cockpit_form_record_effect(r, e,
                CASE WHEN n.id IS NOT NULL THEN 'cockpit_slack_notices' END, n.id::text, n.dedupe_key, n.state, n.error,
                'press');
            END IF;
          END IF;
          IF v_done = 'delivered' THEN
            v_delivered := v_delivered + 1;
            v_budget := v_budget - 1;
          ELSIF v_done = 'skipped' THEN
            v_skipped := v_skipped + 1;
            v_budget := v_budget - 1;
          ELSE
            v_waiting := v_waiting + 1;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors + 1;
          v_first_error := coalesce(v_first_error, SQLSTATE);
        END;
      END LOOP;
    END LOOP;

    -- A dry run: everything above is undone, the counts kept.
    IF NOT v_apply THEN
      RAISE EXCEPTION 'dry run' USING ERRCODE = 'P0R01';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0R01' THEN
    NULL;
  END;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN jsonb_build_object(
    'apply', v_apply,
    'kickoff', jsonb_build_object('recorded', v_recorded, 'already', v_already),
    'blueprint', jsonb_build_object('recorded', v_presses),
    'effects', jsonb_build_object('delivered', v_delivered, 'skipped', v_skipped, 'waiting', v_waiting),
    'errors', v_errors,
    'firstError', v_first_error);
END $$;

-- ---------------------------------------------------------------------------
-- 4. The forms door's health row

-- The forms door's last delivery and its outcome (section 3.9), for the
-- doctor and the guardian. Only the kickoff form has a door in 2b. The
-- registration stays as the key's put and mark wrote it; a row removed by
-- hand is rebuilt from the key, never as unregistered.
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
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_form_key IS DISTINCT FROM 'kickoff' THEN
    RAISE EXCEPTION 'Only the kickoff form has a cockpit webhook in 2b.' USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('recorded','repeat','ignored','probe','unsigned','failed') THEN
    RAISE EXCEPTION 'Choose recorded, repeat, ignored, probe, unsigned or failed.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO k FROM public.cockpit_forms_keys x WHERE x.provider = 'typeform_kickoff';
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
    WHEN 'recorded' THEN 'A kickoff arrived and was stored at ' || v_at || '.'
    WHEN 'repeat' THEN 'Typeform sent a kickoff again at ' || v_at || '; it was already stored.'
    WHEN 'ignored' THEN 'A signed delivery at ' || v_at || ' was not a kickoff response, so nothing was stored.'
    WHEN 'probe' THEN 'The signed probe reached the door at ' || v_at || '.'
    WHEN 'unsigned' THEN 'A delivery at ' || v_at || ' had no valid signature, so nothing was stored.'
    ELSE 'A kickoff could not be stored at ' || v_at || ': ' || coalesce(v_reason, 'no reason was given.') END
  END;
  INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
  VALUES ('forms-door:kickoff', now(), CASE WHEN NOT v_fault THEN now() END, NOT v_fault, v_note,
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

-- ---------------------------------------------------------------------------
-- 5. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE fn text;
BEGIN
  -- Internal: no role at all.
  FOREACH fn IN ARRAY ARRAY[
    'cockpit_forms_key_label(text)', 'cockpit_form_record_kickoff(text,text,timestamptz,text)',
    'cockpit_form_record_effect(public.cockpit_form_responses,jsonb,text,text,text,text,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', fn);
  END LOOP;
  -- The forms door's, the read's and the key script's RPCs: the service key only.
  FOREACH fn IN ARRAY ARRAY[
    'cockpit_forms_key_put(jsonb)', 'cockpit_forms_key_mark(jsonb)', 'cockpit_form_record_typeform(jsonb)',
    'cockpit_form_record_sweep(boolean)', 'cockpit_forms_door_seen(text,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- The CEO card's read keeps its live grant (gated inside).
  EXECUTE 'REVOKE ALL ON FUNCTION public.cockpit_forms_keys_status() FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_forms_keys_status() TO authenticated';
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
