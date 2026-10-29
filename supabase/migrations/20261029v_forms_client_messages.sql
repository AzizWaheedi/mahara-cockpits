-- Client messages: the 1-1 recap to a client's WhatsApp group, approved in
-- the cockpit and sent by hermes/client-messages only
-- (docs/forms/STAGE2B-CONTRACT.md 2.6 and 4.3, build 3a). Creative Triage
-- (bldgtotkfmhoxmlzowdx). Additive; applies twice. Migration v of 2b's eight;
-- it stands on 2a's outbox (20261027f: the table, its CHECKs, its audit) and
-- calls 20261029s's owner gate and registry owner.
--
-- 1. The outbox guard keeps 2a's moves and gains four: a person reopens a
--    refused message (or a failed one, as a fix under cockpit.forms_fix) and
--    may skip either (Z55); nothing ever leaves unknown or sent that way.
--    The stored fingerprint must be the sha256 of the stored text, on insert
--    and whenever either changes.
-- 2. MessageView (contract 3.7) and the browser RPCs: the client's messages,
--    Today's waiting rows, one message, Skip and Reopen. Each is gated first:
--    the CEO, an admin, or the client gate of the message's card.
-- 3. The service RPCs: approve (only through cockpit-forms-api's
--    recap.approve, with the verified seat, Z27), and the sender's claim,
--    intent, result, sweep, work, fix and team_today.
--
-- Nothing here sends anything, and while the checkin registry keeps the
-- recap effect shadow no message row can exist (the 2b dispatch creates the
-- only rows) and the owner gate refuses every approval and claim: the
-- registry owner and CLIENT_MESSAGES_APPLY are both switches (Z26). Every
-- write is a state move the 2a audit trigger records, never with the body.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (Z61): md5 of the whitespace-normalised prosrc, before
--    or after this file.

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_client_messages_guard()', '6a0fe60fee0be51c3d22ddcd28986bdb', 'c676efff216517fc709ec927ca9edc55')
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
-- 1. The guard: 20261027f's body with the four moves and the fingerprint rule

CREATE OR REPLACE FUNCTION public.cockpit_client_messages_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_fix boolean := coalesce(current_setting('cockpit.forms_fix', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'A message starts as a draft' USING ERRCODE = '55000';
    END IF;
    IF NEW.read_back_at IS NOT NULL OR NEW.read_back IS NOT NULL THEN
      RAISE EXCEPTION 'A message is read back only after it is sent' USING ERRCODE = '55000';
    END IF;
    IF NEW.body_sha256 IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(NEW.body, 'UTF8')), 'hex') THEN
      RAISE EXCEPTION 'The text and its fingerprint differ.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A message keeps its key' USING ERRCODE = '55000';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'draft' AND NEW.state IN ('approved','skipped'))
    OR (OLD.state = 'approved' AND NEW.state IN ('claimed','draft','skipped'))
    OR (OLD.state = 'claimed' AND NEW.state IN ('sending','approved','refused'))
    OR (OLD.state = 'sending' AND NEW.state IN ('sent','failed','unknown'))
    OR (OLD.state = 'unknown' AND NEW.state = 'sent')
    OR (OLD.state = 'unknown' AND NEW.state = 'failed' AND v_fix)
    -- 2b: a person reopens a refused message, or a failed one as a fix, and
    -- may skip either; nothing ever leaves unknown or sent this way.
    OR (OLD.state = 'refused' AND NEW.state IN ('draft','skipped'))
    OR (OLD.state = 'failed' AND NEW.state = 'skipped')
    OR (OLD.state = 'failed' AND NEW.state = 'draft' AND v_fix)) THEN
    RAISE EXCEPTION 'A message goes from % to % only through the sender', OLD.state, NEW.state USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'draft' AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256) THEN
    RAISE EXCEPTION 'An approved message keeps its text' USING ERRCODE = '55000';
  END IF;
  IF (NEW.body IS DISTINCT FROM OLD.body OR NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256)
     AND NEW.body_sha256 IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(NEW.body, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'The text and its fingerprint differ.' USING ERRCODE = '55000';
  END IF;
  IF OLD.read_back_at IS NOT NULL OR OLD.read_back IS NOT NULL THEN
    IF NEW.read_back_at IS DISTINCT FROM OLD.read_back_at OR NEW.read_back IS DISTINCT FROM OLD.read_back THEN
      RAISE EXCEPTION 'A read-back is kept as it was written' USING ERRCODE = '55000';
    END IF;
  ELSIF (NEW.read_back_at IS NOT NULL OR NEW.read_back IS NOT NULL) AND NEW.state <> 'sent' THEN
    RAISE EXCEPTION 'A message is read back only after it is sent' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Indexes

CREATE INDEX IF NOT EXISTS cockpit_client_messages_open
  ON public.cockpit_client_messages (state, updated_at) WHERE state IN ('draft','approved','claimed','sending','unknown','refused');
CREATE INDEX IF NOT EXISTS cockpit_client_messages_task
  ON public.cockpit_client_messages (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_client_messages_response
  ON public.cockpit_client_messages (response_id);

-- ---------------------------------------------------------------------------
-- 3. MessageView (contract 3.7; internal)

-- One message as a screen sees it: who approved it as a role, never an
-- address; never its claim token or WhatsApp's message id. callAt is the
-- call's end, else its start; owner is the registry's owner of the recap
-- effect now; effectState is the state of the effect that points at it.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_view(p_row public.cockpit_client_messages)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_call text; v_form text; v_effect text;
BEGIN
  IF p_row.id IS NULL THEN RETURN NULL; END IF;
  IF p_row.response_id IS NOT NULL THEN
    SELECT coalesce(nullif(r.answers->'call'->>'endsAt', ''), nullif(r.answers->'call'->>'startsAt', '')), r.form_key
      INTO v_call, v_form
      FROM public.cockpit_form_responses r WHERE r.id = p_row.response_id;
  END IF;
  v_form := coalesce(v_form, CASE p_row.kind WHEN 'recap_checkin' THEN 'checkin' WHEN 'recap_kickoff' THEN 'kickoff'
                                             WHEN 'recap_blueprint' THEN 'blueprint' END);
  SELECT e.state INTO v_effect FROM public.cockpit_form_effects e
   WHERE e.delivery = 'client_message' AND e.delivery_ref = p_row.id::text
   ORDER BY e.created_at, e.id LIMIT 1;
  RETURN jsonb_build_object(
    'id', p_row.id,
    'kind', p_row.kind,
    'state', p_row.state,
    'taskId', p_row.task_id,
    'clientName', p_row.client_name,
    'responseId', p_row.response_id,
    'body', p_row.body,
    'reason', p_row.reason,
    'callAt', public.cockpit_slack_notice_iso(public.cockpit_slack_notice_ts(v_call)),
    'approvedBy', public.cockpit_slack_notice_role_of(p_row.approved_by),
    'approvedAt', p_row.approved_at,
    'expiresAt', p_row.expires_at,
    'sentAt', p_row.sent_at,
    'readBack', CASE WHEN p_row.read_back_at IS NOT NULL
                     THEN jsonb_build_object('by', p_row.read_back->>'by', 'at', p_row.read_back_at) END,
    'owner', CASE WHEN v_form IS NOT NULL THEN public.cockpit_form_effect_owner(v_form, 'recap') END,
    'effectState', v_effect);
END $$;

-- ---------------------------------------------------------------------------
-- 4. Browser RPCs (authenticated only, each gated first: the CEO, an admin,
--    or the client gate of the card)

-- A card's messages, newest 20, for the Messages card and the window.
CREATE OR REPLACE FUNCTION public.cockpit_client_messages_read(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  v_seat := public.cockpit_form_actor();
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
    PERFORM public.cockpit_csm_client_gate(p_task_id);
  END IF;
  RETURN jsonb_build_object(
    'taskId', p_task_id,
    'now', now(),
    'messages', coalesce((SELECT jsonb_agg(v.j ORDER BY v.created_at DESC, v.id)
                            FROM (SELECT public.cockpit_client_message_view(x) AS j, x.created_at, x.id
                                    FROM public.cockpit_client_messages x
                                   WHERE x.task_id = p_task_id
                                   ORDER BY x.created_at DESC, x.id LIMIT 20) v), '[]'::jsonb));
END $$;

-- Today's rows: drafts, refused and failed messages of the seat's clients,
-- and for the CEO or an admin the unknown ones too (a person must look in the
-- group). Newest change first, 50 at most. An incomplete roster is an error,
-- never an empty list (missing is never zero).
CREATE OR REPLACE FUNCTION public.cockpit_client_messages_waiting()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb;
  v_all boolean;
  v_out jsonb := '[]'::jsonb;
  v_allowed text[] := '{}'::text[];
  v_denied text[] := '{}'::text[];
  v_msg text;
  m public.cockpit_client_messages;
BEGIN
  v_seat := public.cockpit_form_actor();
  v_all := coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false);
  IF NOT v_all AND NOT coalesce((v_seat->>'csm')::boolean, false) THEN
    RAISE EXCEPTION 'Current confirmed client-success access is required' USING ERRCODE = '42501';
  END IF;
  FOR m IN
    SELECT * FROM public.cockpit_client_messages x
     WHERE x.state IN ('draft','refused','failed') OR (v_all AND x.state = 'unknown')
     ORDER BY x.updated_at DESC, x.id
     LIMIT 500
  LOOP
    EXIT WHEN jsonb_array_length(v_out) >= 50;
    IF NOT v_all THEN
      CONTINUE WHEN m.task_id = ANY(v_denied);
      IF NOT (m.task_id = ANY(v_allowed)) THEN
        BEGIN
          PERFORM public.cockpit_csm_client_gate(m.task_id);
          v_allowed := v_allowed || m.task_id;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
          IF v_msg LIKE 'The client roster is incomplete%' THEN
            RAISE;
          END IF;
          v_denied := v_denied || m.task_id;
          CONTINUE;
        END;
      END IF;
    END IF;
    v_out := v_out || jsonb_build_array(public.cockpit_client_message_view(m));
  END LOOP;
  RETURN jsonb_build_object('now', now(), 'messages', v_out);
END $$;

-- One message.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_read(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb; m public.cockpit_client_messages;
BEGIN
  v_seat := public.cockpit_form_actor();
  SELECT * INTO m FROM public.cockpit_client_messages x WHERE x.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no message with that ID.' USING ERRCODE = '22023';
  END IF;
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
    PERFORM public.cockpit_csm_client_gate(m.task_id);
  END IF;
  RETURN public.cockpit_client_message_view(m);
END $$;

-- Skip: nothing is sent. A draft, an approved, a refused or a failed message
-- (Z55). The reason is the person's, else "Skipped by {role}.".
CREATE OR REPLACE FUNCTION public.cockpit_client_message_skip(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb; m public.cockpit_client_messages; v_reason text;
BEGIN
  v_seat := public.cockpit_form_actor();
  SELECT * INTO m FROM public.cockpit_client_messages x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no message with that ID.' USING ERRCODE = '22023';
  END IF;
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
    PERFORM public.cockpit_csm_client_gate(m.task_id);
  END IF;
  IF m.state = 'skipped' THEN
    RETURN public.cockpit_client_message_view(m);
  END IF;
  IF m.state NOT IN ('draft','approved','refused','failed') THEN
    RAISE EXCEPTION '%', CASE m.state
        WHEN 'sent' THEN 'This recap was already sent, so there is nothing to skip.'
        WHEN 'unknown' THEN 'This recap may already be in the group. Look in the group; the tech lead settles it.'
        ELSE 'This recap is being sent now, so it cannot be skipped.' END
      USING ERRCODE = '22023';
  END IF;
  v_reason := left(coalesce(nullif(btrim(p_reason), ''),
                            'Skipped by ' || coalesce(public.cockpit_slack_notice_role_of(v_seat->>'email'), 'a team member') || '.'), 240);
  PERFORM set_config('cockpit.forms_action', 'forms.message_skipped', true);
  UPDATE public.cockpit_client_messages SET state = 'skipped', reason = v_reason, claim_token = NULL
   WHERE id = m.id RETURNING * INTO m;
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN public.cockpit_client_message_view(m);
END $$;

-- Reopen: back to a draft to edit and approve again, the approval, claim and
-- expiry cleared. A failed message reopens as a person's fix (forms_fix),
-- which also puts its effect back in the queue. The tries WhatsApp refused
-- are kept, so a fourth is still refused at intent (Z66).
CREATE OR REPLACE FUNCTION public.cockpit_client_message_reopen(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb; m public.cockpit_client_messages;
BEGIN
  v_seat := public.cockpit_form_actor();
  SELECT * INTO m FROM public.cockpit_client_messages x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no message with that ID.' USING ERRCODE = '22023';
  END IF;
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
    PERFORM public.cockpit_csm_client_gate(m.task_id);
  END IF;
  IF m.state = 'draft' THEN
    RETURN public.cockpit_client_message_view(m);
  END IF;
  IF m.state NOT IN ('approved','refused','failed') THEN
    RAISE EXCEPTION '%', CASE m.state
        WHEN 'sent' THEN 'This recap was already sent, so it cannot be reopened.'
        WHEN 'unknown' THEN 'This recap may already be in the group. Look in the group; the tech lead settles it.'
        WHEN 'skipped' THEN 'This recap was skipped. Nothing was sent, and a skipped recap stays skipped.'
        ELSE 'This recap is being sent now, so it cannot be reopened.' END
      USING ERRCODE = '22023';
  END IF;
  IF m.state = 'failed' THEN
    PERFORM set_config('cockpit.forms_fix', 'on', true);
  END IF;
  PERFORM set_config('cockpit.forms_action', 'forms.message_reopened', true);
  UPDATE public.cockpit_client_messages
     SET state = 'draft', claim_token = NULL, claimed_at = NULL, intent_at = NULL,
         approved_by = NULL, approved_at = NULL, expires_at = NULL, reason = NULL
   WHERE id = m.id RETURNING * INTO m;
  PERFORM set_config('cockpit.forms_fix', 'off', true);
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN public.cockpit_client_message_view(m);
END $$;

-- ---------------------------------------------------------------------------
-- 5. Service RPCs (service_role only; each requires the service role first)

-- The approval, from cockpit-forms-api's recap.approve after recapRules.ts
-- checked the exact text (Z27). The seat is the verified actor the op passes,
-- never a browser's id. The fingerprint is of the exact UTF-8 bytes.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_approve(p_id uuid, p_body text, p_body_sha256 text, p_actor uuid,
  p_warnings text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb; m public.cockpit_client_messages; g jsonb; v_hash text; v_warn text[];
BEGIN
  PERFORM public.cockpit_hours_require_service();
  v_seat := public.cockpit_form_seat(p_actor);
  SELECT * INTO m FROM public.cockpit_client_messages x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no message with that ID.' USING ERRCODE = '22023';
  END IF;
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
    PERFORM public.cockpit_csm_client_gate_for_actor(p_actor, m.task_id);
  END IF;
  IF m.state <> 'draft' THEN
    RAISE EXCEPTION '%', CASE m.state
        WHEN 'approved' THEN 'This recap is already approved. It sends within about 3 minutes.'
        WHEN 'sent' THEN 'This recap was already sent.'
        WHEN 'skipped' THEN 'This recap was skipped. Nothing was sent.'
        WHEN 'unknown' THEN 'This recap may already be in the group. Look in the group; the tech lead settles it.'
        WHEN 'refused' THEN 'Reopen this recap first, then approve it.'
        WHEN 'failed' THEN 'Reopen this recap first, then approve it.'
        ELSE 'This recap is being sent now.' END
      USING ERRCODE = '22023';
  END IF;
  g := public.cockpit_form_effect_gate('client_message', m.id::text);
  IF NOT coalesce((g->>'ok')::boolean, false) THEN
    IF coalesce(g->>'reason', 'Make owns this again.') = 'Make owns this again.' THEN
      -- Native, and this recap's response was sent before the window opened (an old
      -- recap after a second cut-over): Make does not send it, and neither does the cockpit.
      IF EXISTS (SELECT 1 FROM public.cockpit_form_responses r
                  WHERE r.id = m.response_id
                    AND r.submitted_at < public.cockpit_form_native_since(r.form_key)) THEN
        RAISE EXCEPTION 'This recap is from before the latest switch-over, so it is not sent from here. Press Skip.' USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION '%', g->>'reason' USING ERRCODE = '22023';
  END IF;
  IF p_body IS NULL OR btrim(p_body) = '' OR char_length(p_body) > 4096 THEN
    RAISE EXCEPTION 'The recap is empty or over 4,096 characters. Edit the text, then approve again.' USING ERRCODE = '22023';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(p_body, 'UTF8')), 'hex');
  IF p_body_sha256 IS NULL OR lower(btrim(p_body_sha256)) <> v_hash THEN
    RAISE EXCEPTION 'The text changed after it was checked. Approve it again.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(left(btrim(u.w), 240) ORDER BY u.o), '{}'::text[]) INTO v_warn
    FROM unnest(coalesce(p_warnings, '{}'::text[])) WITH ORDINALITY AS u(w, o)
   WHERE nullif(btrim(u.w), '') IS NOT NULL AND u.o <= 14;
  PERFORM set_config('cockpit.forms_action', 'forms.message_approved', true);
  PERFORM set_config('cockpit.audit_actor', v_seat->>'email', true);
  PERFORM set_config('cockpit.audit_source', 'cockpit-forms-api', true);
  UPDATE public.cockpit_client_messages
     SET state = 'approved', body = p_body, body_sha256 = v_hash, approved_by = v_seat->>'email', approved_at = now(),
         expires_at = now() + interval '24 hours', reason = NULL
   WHERE id = m.id RETURNING * INTO m;
  -- "Approve anyway": the warnings the person read and accepted, never the text.
  IF cardinality(v_warn) > 0 THEN
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('forms.message_warnings_accepted', 'cockpit_client_messages', m.id::text, v_seat->>'email', 'client-success',
            'cockpit-forms-api', NULL, NULL,
            jsonb_build_object('op', 'approve', 'task_id', m.task_id, 'warnings', to_jsonb(v_warn)));
  END IF;
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN public.cockpit_client_message_view(m);
END $$;

-- The sender's claim: approved messages of the kinds and cards it may send,
-- oldest approval first, three at most. Per row, in order: an approval older
-- than 24 hours goes back to a draft; the owner gate refused skips it; an
-- approver who no longer holds the client sends it back to a draft; else it
-- is claimed with a new token. An incomplete roster claims nothing and
-- changes nothing.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_claim(p_kinds text[], p_only_cards text[] DEFAULT NULL,
  p_limit integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lim integer := least(greatest(coalesce(p_limit, 1), 1), 3);
  v_n integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_uid uuid;
  v_seat jsonb;
  v_keep boolean;
  v_wait boolean;
  v_msg text;
  g jsonb;
  m public.cockpit_client_messages;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_kinds IS NULL OR cardinality(p_kinds) = 0 OR EXISTS (
       SELECT 1 FROM unnest(p_kinds) AS k(v) WHERE k.v IS NULL OR k.v NOT IN ('recap_checkin','recap_kickoff','recap_blueprint','phase5')) THEN
    RAISE EXCEPTION 'Choose the kinds of message to claim.' USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cockpit_client_messages', 0)) THEN
    RETURN jsonb_build_object('busy', true, 'rows', '[]'::jsonb);
  END IF;
  PERFORM set_config('cockpit.audit_source', 'client-messages', true);
  FOR m IN
    SELECT * FROM public.cockpit_client_messages x
     WHERE x.state = 'approved' AND x.kind = ANY(p_kinds)
       AND (p_only_cards IS NULL OR cardinality(p_only_cards) = 0 OR x.task_id = ANY(p_only_cards))
     ORDER BY x.approved_at, x.id
     FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN v_n >= v_lim;

    -- 1. An approval lasts 24 hours.
    IF m.expires_at IS NULL OR m.expires_at <= now() THEN
      PERFORM set_config('cockpit.forms_action', 'forms.message_expired', true);
      UPDATE public.cockpit_client_messages
         SET state = 'draft', approved_by = NULL, approved_at = NULL, expires_at = NULL,
             reason = 'The approval ran out after 24 hours. Approve it again.'
       WHERE id = m.id;
      CONTINUE;
    END IF;

    -- 2. The owner gate (3.1).
    g := public.cockpit_form_effect_gate('client_message', m.id::text);
    IF NOT coalesce((g->>'ok')::boolean, false) THEN
      PERFORM set_config('cockpit.forms_action', 'forms.message_skipped', true);
      UPDATE public.cockpit_client_messages
         SET state = 'skipped', reason = left(coalesce(nullif(g->>'reason', ''), 'Make owns this again.'), 240)
       WHERE id = m.id;
      CONTINUE;
    END IF;

    -- 3. The approver still holds this client (Z27).
    v_keep := false;
    v_wait := false;
    v_uid := NULL;
    SELECT cm.auth_user_id INTO v_uid FROM public.cockpit_members cm
     WHERE cm.active AND cm.email = lower(btrim(coalesce(m.approved_by, '')))
     ORDER BY cm.updated_at DESC LIMIT 1;
    BEGIN
      v_seat := public.cockpit_form_seat(v_uid);
      IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
        PERFORM public.cockpit_csm_client_gate_for_actor(v_uid, m.task_id);
      END IF;
      v_keep := true;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      v_wait := v_msg LIKE 'The client roster is incomplete%';
    END;
    CONTINUE WHEN v_wait;
    IF NOT v_keep THEN
      PERFORM set_config('cockpit.forms_action', 'forms.message_approver_lost', true);
      UPDATE public.cockpit_client_messages
         SET state = 'draft', approved_by = NULL, approved_at = NULL, expires_at = NULL,
             reason = 'The person who approved it no longer has this client. Approve it again.'
       WHERE id = m.id;
      CONTINUE;
    END IF;

    -- 4. Claimed.
    PERFORM set_config('cockpit.forms_action', 'forms.message_claimed', true);
    UPDATE public.cockpit_client_messages
       SET state = 'claimed', claim_token = gen_random_uuid(), claimed_at = now(), reason = NULL
     WHERE id = m.id RETURNING * INTO m;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', m.id, 'claimToken', m.claim_token, 'taskId', m.task_id, 'clientName', m.client_name, 'kind', m.kind,
      'body', m.body, 'bodySha256', m.body_sha256, 'approvedAt', m.approved_at, 'claimedAt', m.claimed_at));
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN jsonb_build_object('busy', false, 'rows', v_rows);
END $$;

-- Just before the one POST (Z66): the owner gate again, because 30 to 120
-- seconds have passed since the claim; a refusal goes back to approved, and
-- the next claim's gate skips it with the reason. A fourth try is refused
-- with a sentence, so nothing loops. Else it is sending, one more try. The
-- sender posts only on ok true.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_intent(p_id uuid, p_claim uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cockpit_client_messages; g jsonb; v_reason text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT * INTO m FROM public.cockpit_client_messages x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND OR m.state <> 'claimed' OR p_claim IS NULL OR m.claim_token IS DISTINCT FROM p_claim THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This run no longer holds the message, so nothing was sent.');
  END IF;
  PERFORM set_config('cockpit.audit_source', 'client-messages', true);
  g := public.cockpit_form_effect_gate('client_message', m.id::text);
  IF NOT coalesce((g->>'ok')::boolean, false) THEN
    PERFORM set_config('cockpit.forms_action', 'forms.message_released', true);
    UPDATE public.cockpit_client_messages SET state = 'approved', claim_token = NULL, claimed_at = NULL WHERE id = m.id;
    PERFORM set_config('cockpit.forms_action', '', true);
    RETURN jsonb_build_object('ok', false, 'reason', coalesce(nullif(g->>'reason', ''), 'Make owns this again.'));
  END IF;
  IF m.attempts >= 3 THEN
    v_reason := 'WhatsApp refused this recap three times. Send it by hand in the group if it is still needed, then skip it here.';
    PERFORM set_config('cockpit.forms_action', 'forms.message_refused', true);
    UPDATE public.cockpit_client_messages SET state = 'refused', reason = v_reason WHERE id = m.id;
    PERFORM set_config('cockpit.forms_action', '', true);
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;
  PERFORM set_config('cockpit.forms_action', 'forms.message_sending', true);
  UPDATE public.cockpit_client_messages SET state = 'sending', intent_at = now(), attempts = m.attempts + 1 WHERE id = m.id;
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN jsonb_build_object('ok', true);
END $$;

-- What happened, from the sender holding the claim: refused (claimed, with a
-- reason), release (claimed back to approved), sent (with WhatsApp's id),
-- failed, unknown, reconciled (an unknown found in the group by its
-- fingerprint) and read_back (once, on a sent message, never with a body).
CREATE OR REPLACE FUNCTION public.cockpit_client_message_result(p_id uuid, p_claim uuid, p_outcome text, p_provider_id text,
  p_reason text, p_read_back jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.cockpit_client_messages;
  v_reason text := left(nullif(btrim(p_reason), ''), 240);
  v_pid text := nullif(btrim(p_provider_id), '');
  v_by text := CASE WHEN jsonb_typeof(p_read_back) = 'object' THEN p_read_back->>'by' END;
  v_rb text := CASE WHEN jsonb_typeof(p_read_back) = 'object' THEN nullif(btrim(p_read_back->>'providerId'), '') END;
  v_from text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_outcome IS NULL OR p_outcome NOT IN ('refused','release','sent','failed','unknown','reconciled','read_back') THEN
    RAISE EXCEPTION 'Choose refused, release, sent, failed, unknown, reconciled or read_back.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM public.cockpit_client_messages x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no message with that ID.' USING ERRCODE = '22023';
  END IF;
  IF p_claim IS NULL OR m.claim_token IS DISTINCT FROM p_claim THEN
    RAISE EXCEPTION 'This run does not hold that message.' USING ERRCODE = '22023';
  END IF;
  IF v_pid IS NOT NULL AND v_pid !~ '^\S{1,200}$' THEN
    RAISE EXCEPTION 'WhatsApp''s message id is one word of at most 200 characters.' USING ERRCODE = '22023';
  END IF;
  v_from := CASE p_outcome WHEN 'refused' THEN 'claimed' WHEN 'release' THEN 'claimed' WHEN 'reconciled' THEN 'unknown'
                           WHEN 'read_back' THEN 'sent' ELSE 'sending' END;
  -- A read-back is written once: a second one changes nothing.
  IF p_outcome = 'read_back' AND m.state = 'sent' AND m.read_back_at IS NOT NULL THEN
    RETURN public.cockpit_client_message_view(m);
  END IF;
  IF m.state <> v_from THEN
    RAISE EXCEPTION 'A message goes from % to % only through the sender', m.state,
      CASE p_outcome WHEN 'release' THEN 'approved' WHEN 'reconciled' THEN 'sent' WHEN 'read_back' THEN 'read back' ELSE p_outcome END
      USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('cockpit.audit_source', 'client-messages', true);
  PERFORM set_config('cockpit.forms_action', 'forms.message_' || p_outcome, true);
  IF p_outcome = 'refused' THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Say why in a plain sentence.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_client_messages SET state = 'refused', reason = v_reason WHERE id = m.id RETURNING * INTO m;
  ELSIF p_outcome = 'release' THEN
    UPDATE public.cockpit_client_messages SET state = 'approved', claim_token = NULL, claimed_at = NULL
     WHERE id = m.id RETURNING * INTO m;
  ELSIF p_outcome = 'sent' THEN
    IF v_pid IS NULL THEN
      RAISE EXCEPTION 'A sent message needs WhatsApp''s message id.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_client_messages SET state = 'sent', provider_id = v_pid, sent_at = now(), reason = NULL
     WHERE id = m.id RETURNING * INTO m;
  ELSIF p_outcome = 'failed' THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Say why in a plain sentence.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_client_messages SET state = 'failed', reason = v_reason WHERE id = m.id RETURNING * INTO m;
  ELSIF p_outcome = 'unknown' THEN
    UPDATE public.cockpit_client_messages
       SET state = 'unknown', reason = coalesce(v_reason, 'WhatsApp did not confirm the send. Look in the group before anything else.')
     WHERE id = m.id RETURNING * INTO m;
  ELSIF p_outcome = 'reconciled' THEN
    IF v_pid IS NULL OR v_by IS DISTINCT FROM 'body_sha256' THEN
      RAISE EXCEPTION 'A reconciled message needs WhatsApp''s message id and a read-back by its fingerprint.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_client_messages
       SET state = 'sent', provider_id = v_pid, sent_at = coalesce(m.intent_at, now()), reason = NULL,
           read_back_at = now(), read_back = jsonb_build_object('by', 'body_sha256', 'providerId', v_pid, 'at', now())
     WHERE id = m.id RETURNING * INTO m;
  ELSE
    IF v_by IS NULL OR v_by NOT IN ('message_id','body_sha256') OR v_rb IS NULL OR v_rb !~ '^\S{1,200}$' THEN
      RAISE EXCEPTION 'A read-back says how it was found (message_id or body_sha256) and WhatsApp''s message id.' USING ERRCODE = '22023';
    END IF;
    IF v_by = 'message_id' AND v_rb IS DISTINCT FROM m.provider_id THEN
      RAISE EXCEPTION 'A read-back by message id must find the id WhatsApp gave the send.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_client_messages
       SET read_back_at = now(), read_back = jsonb_build_object('by', v_by, 'providerId', v_rb, 'at', now())
     WHERE id = m.id RETURNING * INTO m;
  END IF;
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN public.cockpit_client_message_view(m);
END $$;

-- The second source behind the sender: a send that stopped part way is
-- unknown (never sent again; a person looks in the group), a claim with no
-- intent after 10 minutes goes back to approved, and an approval older than
-- 24 hours goes back to a draft. A database-only move; it sends nothing, and
-- runs in dry mode too (Z67).
CREATE OR REPLACE FUNCTION public.cockpit_client_message_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_unknown integer := 0; v_released integer := 0; v_expired integer := 0;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  PERFORM set_config('cockpit.audit_source', 'client-messages', true);
  PERFORM set_config('cockpit.forms_action', 'forms.message_unknown', true);
  UPDATE public.cockpit_client_messages x
     SET state = 'unknown', reason = 'The sender stopped while sending. Look in the group before anything else.'
   WHERE x.state = 'sending' AND coalesce(x.intent_at, x.claimed_at, x.updated_at) < now() - interval '10 minutes';
  GET DIAGNOSTICS v_unknown = ROW_COUNT;
  PERFORM set_config('cockpit.forms_action', 'forms.message_released', true);
  UPDATE public.cockpit_client_messages x
     SET state = 'approved', claim_token = NULL, claimed_at = NULL
   WHERE x.state = 'claimed' AND x.intent_at IS NULL AND x.claimed_at < now() - interval '10 minutes';
  GET DIAGNOSTICS v_released = ROW_COUNT;
  PERFORM set_config('cockpit.forms_action', 'forms.message_expired', true);
  UPDATE public.cockpit_client_messages x
     SET state = 'draft', approved_by = NULL, approved_at = NULL, expires_at = NULL,
         reason = 'The approval ran out after 24 hours. Approve it again.'
   WHERE x.state = 'approved' AND (x.expires_at IS NULL OR x.expires_at <= now());
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN jsonb_build_object('unknown', v_unknown, 'released', v_released, 'expired', v_expired);
END $$;

-- What the sender reads, writing nothing: unknowns of the last 24 hours to
-- look for in the group, sent messages with no read-back yet (24 hours), with
-- the text for fingerprint matching, and the approved rows for a dry run's plan.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_work(p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_lim integer := least(greatest(coalesce(p_limit, 5), 1), 10);
BEGIN
  PERFORM public.cockpit_hours_require_service();
  RETURN jsonb_build_object(
    'unknowns', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'claimToken', x.claim_token, 'taskId', x.task_id, 'kind', x.kind,
               'body', x.body, 'bodySha256', x.body_sha256, 'claimedAt', x.claimed_at, 'intentAt', x.intent_at)
             ORDER BY x.claimed_at, x.id)
        FROM (SELECT * FROM public.cockpit_client_messages m
               WHERE m.state = 'unknown' AND coalesce(m.claimed_at, m.updated_at) > now() - interval '24 hours'
               ORDER BY m.claimed_at, m.id LIMIT v_lim) x), '[]'::jsonb),
    'unread', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'claimToken', x.claim_token, 'taskId', x.task_id, 'kind', x.kind,
               'body', x.body, 'bodySha256', x.body_sha256, 'providerId', x.provider_id, 'claimedAt', x.claimed_at,
               'sentAt', x.sent_at)
             ORDER BY x.sent_at, x.id)
        FROM (SELECT * FROM public.cockpit_client_messages m
               WHERE m.state = 'sent' AND m.read_back_at IS NULL AND m.sent_at > now() - interval '24 hours'
               ORDER BY m.sent_at, m.id LIMIT v_lim) x), '[]'::jsonb),
    'approved', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'taskId', x.task_id, 'clientName', x.client_name, 'kind', x.kind,
               'approvedAt', x.approved_at, 'expiresAt', x.expires_at)
             ORDER BY x.approved_at, x.id)
        FROM (SELECT * FROM public.cockpit_client_messages m WHERE m.state = 'approved'
               ORDER BY m.approved_at, m.id LIMIT 20) x), '[]'::jsonb));
END $$;

-- The runbook's hand fix, for a person who looked in the group: an unknown
-- that is not there becomes failed, with what they saw.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_fix(p_id uuid, p_what text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cockpit_client_messages;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_what IS DISTINCT FROM 'not_sent' THEN
    RAISE EXCEPTION 'Choose not_sent.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM public.cockpit_client_messages x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no message with that ID.' USING ERRCODE = '22023';
  END IF;
  IF m.state <> 'unknown' THEN
    RAISE EXCEPTION 'A message goes from % to failed only through the sender', m.state USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('cockpit.audit_source', 'client-messages', true);
  PERFORM set_config('cockpit.forms_fix', 'on', true);
  PERFORM set_config('cockpit.forms_action', 'forms.message_fixed', true);
  UPDATE public.cockpit_client_messages
     SET state = 'failed', reason = left(rtrim('Checked by a person: not in the group. ' || coalesce(btrim(p_note), '')), 240)
   WHERE id = m.id RETURNING * INTO m;
  PERFORM set_config('cockpit.forms_fix', 'off', true);
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN public.cockpit_client_message_view(m);
END $$;

-- recapRules' one-a-day warning: did the client's group already have a team
-- message today (Kuwait day)? NULL when no group thread is linked to the card.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_team_today(p_task_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_threads t WHERE t.client_task_id = p_task_id AND t.is_group) THEN
    RETURN NULL;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.wa_messages w JOIN public.wa_threads t ON t.id = w.thread_id
     WHERE t.client_task_id = p_task_id AND t.is_group
       AND public.cockpit_form_kuwait_day(w.at) = public.cockpit_form_kuwait_day(now())
       AND (w.speaker ILIKE '%| MaharaMedia%' OR w.direction = 'outbound'));
END $$;

-- ---------------------------------------------------------------------------
-- 6. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (the trigger and the view).
  FOREACH f IN ARRAY ARRAY[
    'cockpit_client_messages_guard()', 'cockpit_client_message_view(public.cockpit_client_messages)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- The screens' RPCs: a signed-in seat, gated inside.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_client_messages_read(text)', 'cockpit_client_messages_waiting()', 'cockpit_client_message_read(uuid)',
    'cockpit_client_message_skip(uuid,text)', 'cockpit_client_message_reopen(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- cockpit-forms-api's approval and the sender's RPCs: the service key only.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_client_message_approve(uuid,text,text,uuid,text[])', 'cockpit_client_message_claim(text[],text[],integer)',
    'cockpit_client_message_intent(uuid,uuid)', 'cockpit_client_message_result(uuid,uuid,text,text,text,jsonb)',
    'cockpit_client_message_sweep()', 'cockpit_client_message_work(integer)', 'cockpit_client_message_fix(uuid,text,text)',
    'cockpit_client_message_team_today(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
