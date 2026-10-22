-- CSM form sends: the kickoff form embedded in the client success cockpit
-- (docs/csm-forms/KICKOFF.md 5.1). Apply after 20261022p.
--
-- Typeform keeps the answers and Make does the work, as before; this table
-- only notes that a response went in from the cockpit's form window, for
-- which client, with which hidden field names (never their values) and a
-- SHA-256 of the hidden object, so the trail and the duplicate guard can be
-- worked out from data.
--
-- 1. cockpit_csm_form_sends: one row per Typeform response. Row security on,
--    no browser grants; the service key may read it. Nothing writes it but
--    cockpit_csm_form_sent, so every row has its audit row.
-- 2. cockpit_csm_form_sent: SECURITY DEFINER, gated by
--    cockpit_csm_client_gate. Accepts the kickoff only for now (each later
--    form adds its own line), takes the form ID from its own constant, never
--    from the browser, refuses Typeform's sandbox and an ID the form did not
--    carry for this card, decides "second" itself, and writes one
--    cockpit_audit_log row only when it inserted. A repeat response ID
--    changes nothing.
-- 3. cockpit_csm_form_sends_read: the card's newest ten sends of one form,
--    with the server's clock, gated the same way.
--
-- No provider is called, so there is no Edge Function. The file applies twice
-- without error.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_csm_form_sends (
  response_id   text PRIMARY KEY CHECK (response_id ~ '^[A-Za-z0-9]{8,64}$'),
  form_key      text NOT NULL CHECK (form_key IN ('kickoff','blueprint','checkin')),
  form_id       text NOT NULL CHECK (form_id ~ '^[A-Za-z0-9]{6,16}$'),
  task_id       text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name   text NOT NULL CHECK (btrim(client_name) <> ''),
  -- Names only; the values live in Typeform.
  hidden_keys   text[] NOT NULL CHECK (cardinality(hidden_keys) BETWEEN 1 AND 40),
  hidden_sha256 text NOT NULL CHECK (hidden_sha256 ~ '^[0-9a-f]{64}$'),
  second        boolean NOT NULL,
  sent_by       uuid NOT NULL,
  sent_by_email text NOT NULL CHECK (btrim(sent_by_email) <> ''),
  sent_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cockpit_csm_form_sends_task_idx
  ON public.cockpit_csm_form_sends (task_id, form_key, sent_at DESC);

ALTER TABLE public.cockpit_csm_form_sends ENABLE ROW LEVEL SECURITY;
-- The service key reads; only the function below writes, so no write skips
-- its audit row. Supabase's default grants go too.
REVOKE ALL ON public.cockpit_csm_form_sends FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_csm_form_sends TO service_role;

-- One send as the screen reads it: the sender's first name, never more.
CREATE OR REPLACE FUNCTION public.cockpit_csm_form_send_json(s public.cockpit_csm_form_sends)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'responseId', s.response_id, 'formKey', s.form_key, 'formId', s.form_id,
    'taskId', s.task_id, 'clientName', s.client_name,
    'hiddenKeys', to_jsonb(s.hidden_keys), 'second', s.second,
    'sentBy', (SELECT CASE WHEN x.first = lower(x.first) THEN initcap(x.first) ELSE x.first END
                 FROM (SELECT nullif(split_part(btrim(coalesce(
                                CASE WHEN m.name LIKE '%@%' THEN NULL ELSE nullif(btrim(m.name), '') END,
                                '')), ' ', 1), '') AS first
                         FROM public.cockpit_members m WHERE m.auth_user_id = s.sent_by LIMIT 1) x),
    'sentAt', s.sent_at)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_form_sent(
  p_task_id text, p_form_key text, p_response_id text,
  p_hidden_keys text[], p_hidden_sha256 text, p_carried_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ctx jsonb; v_form_id text; v_second boolean; k text;
  v_row public.cockpit_csm_form_sends; v_had public.cockpit_csm_form_sends;
BEGIN
  ctx := public.cockpit_csm_client_gate(p_task_id);
  -- One line per form, each with its own form ID; the kickoff only for now.
  IF p_form_key IS DISTINCT FROM 'kickoff' THEN
    RAISE EXCEPTION 'Only the kickoff form is noted from this cockpit' USING ERRCODE = '22023';
  END IF;
  v_form_id := 'tG7dnxBn';
  IF p_response_id = '__sandbox' THEN
    RAISE EXCEPTION 'A rehearsal in Typeform''s sandbox is never noted' USING ERRCODE = '22023';
  END IF;
  IF p_response_id IS NULL OR p_response_id !~ '^[A-Za-z0-9]{8,64}$' THEN
    RAISE EXCEPTION 'That is not a Typeform response ID' USING ERRCODE = '22023';
  END IF;
  IF p_carried_id IS DISTINCT FROM p_task_id THEN
    RAISE EXCEPTION 'The form carried another card''s ID. Find this response in Typeform before anything else.' USING ERRCODE = '22023';
  END IF;
  IF p_hidden_keys IS NULL OR cardinality(p_hidden_keys) NOT BETWEEN 1 AND 40
     OR NOT ('onboarding_client_id' = ANY (p_hidden_keys)) THEN
    RAISE EXCEPTION 'The form''s hidden fields did not carry the client ID' USING ERRCODE = '22023';
  END IF;
  FOREACH k IN ARRAY p_hidden_keys LOOP
    IF k IS NULL OR k !~ '^[a-z0-9_]{1,40}$' THEN
      RAISE EXCEPTION 'A hidden field name is not one Typeform uses' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_hidden_sha256 IS NULL OR p_hidden_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'The hidden fields'' fingerprint is not a SHA-256' USING ERRCODE = '22023';
  END IF;

  -- One send at a time per card and form, so "second" cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended('csm-form-send:' || p_task_id || ':' || p_form_key, 0));
  SELECT * INTO v_had FROM public.cockpit_csm_form_sends WHERE response_id = p_response_id;
  IF FOUND THEN
    IF v_had.task_id <> p_task_id OR v_had.form_key <> p_form_key THEN
      RAISE EXCEPTION 'That response is already noted for another client' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('send', public.cockpit_csm_form_send_json(v_had), 'noted', false);
  END IF;

  -- The server's call: an earlier send from the cockpit, or another kickoff
  -- already on the client's record (either form version).
  v_second := EXISTS (SELECT 1 FROM public.cockpit_csm_form_sends s
                       WHERE s.task_id = p_task_id AND s.form_key = p_form_key)
           OR EXISTS (SELECT 1 FROM public.cockpit_client_onboarding o
                       WHERE o.clickup_task_id = p_task_id AND o.forms ? 'kickoff'
                         AND (o.forms->'kickoff'->>'response_id') IS DISTINCT FROM p_response_id);

  INSERT INTO public.cockpit_csm_form_sends(response_id, form_key, form_id, task_id, client_name, hidden_keys,
                                            hidden_sha256, second, sent_by, sent_by_email)
  VALUES (p_response_id, p_form_key, v_form_id, p_task_id, ctx->>'clientName', p_hidden_keys,
          p_hidden_sha256, v_second, (ctx->>'actorId')::uuid, ctx->>'email')
  ON CONFLICT (response_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.response_id IS NULL THEN
    -- Another card's send took this response ID in the meantime.
    SELECT * INTO v_had FROM public.cockpit_csm_form_sends WHERE response_id = p_response_id;
    IF v_had.task_id IS DISTINCT FROM p_task_id OR v_had.form_key IS DISTINCT FROM p_form_key THEN
      RAISE EXCEPTION 'That response is already noted for another client' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('send', public.cockpit_csm_form_send_json(v_had), 'noted', false);
  END IF;

  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system,
                                       before, after, metadata)
  VALUES ('csm_form.sent', 'cockpit_csm_form_sends', v_row.response_id, ctx->>'email', 'client-success', 'typeform',
          NULL, to_jsonb(v_row),
          jsonb_build_object('client_name', v_row.client_name, 'form_key', v_row.form_key,
                             'second', v_row.second, 'task_id', v_row.task_id));
  RETURN jsonb_build_object('send', public.cockpit_csm_form_send_json(v_row), 'noted', true);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_form_sends_read(p_task_id text, p_form_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx jsonb; v jsonb;
BEGIN
  ctx := public.cockpit_csm_client_gate(p_task_id);
  IF p_form_key IS NULL OR p_form_key NOT IN ('kickoff','blueprint','checkin') THEN
    RAISE EXCEPTION 'Choose a form this cockpit knows' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(z.j ORDER BY z.at DESC, z.rid), '[]'::jsonb) INTO v
    FROM (SELECT public.cockpit_csm_form_send_json(s) AS j, s.sent_at AS at, s.response_id AS rid
            FROM public.cockpit_csm_form_sends s
           WHERE s.task_id = p_task_id AND s.form_key = p_form_key
           ORDER BY s.sent_at DESC, s.response_id LIMIT 10) z;
  RETURN jsonb_build_object('sends', v, 'now', now());
END $$;

REVOKE ALL ON FUNCTION public.cockpit_csm_form_send_json(public.cockpit_csm_form_sends) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_csm_form_sent(text, text, text, text[], text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_form_sent(text, text, text, text[], text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.cockpit_csm_form_sends_read(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_form_sends_read(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
