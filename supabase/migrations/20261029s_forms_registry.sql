-- The 1-1 notes registry switch, the owner gate and the cut-over function
-- (docs/forms/STAGE2B-CONTRACT.md sections 2.3, 3.1, 3.2, 3.12 and 4.7, build 7).
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive; applies twice. The first
-- of the eight 2b files (20261029s to 20261029z): every later one reads the
-- gate and the readiness check made here.
--
-- 1. cockpit_forms.provider_since: when the provider last changed, set by a
--    trigger in the same statement as the 2a audit row (its second source).
--    No backfill: NULL reads "since the seed".
-- 2. cockpit_form_registry_set (the browser) and cockpit_form_registry_apply
--    (the one core): only checkin changes in 2b; owners by the editor gate;
--    the provider back to typeform by the CEO seat; native only through the
--    owner-run cut-over (via 'cutover'), never from a seat, the CEO included.
--    Nothing becomes cockpit-owned before its delivery path exists.
-- 3. cockpit_form_effect_gate: the one owner gate every claim, the WhatsApp
--    sender's intent and the recap approval call before a delivery proceeds.
--    Only a response sent at or after cockpit_form_native_since passes, so
--    nothing passes while the provider is typeform, whatever the effects'
--    owners say, and a rollback's leftovers never deliver at a later cut-over.
-- 4. cockpit_form_delivery_ready, cockpit_form_effect_owner,
--    cockpit_form_native_since, cockpit_form_shadow_close and
--    cockpit_form_checkin_cutover (cut-over step 7b).
--
-- This file changes no row: the registry stays typeform with eight shadow
-- effects until the CEO's cut-over hour. No table is created; cockpit_forms
-- keeps row security on and no browser grant. Every function is SECURITY
-- DEFINER with an empty search path, revoked from all four roles, and only
-- cockpit_form_registry_set is granted (to authenticated, gated first). The
-- readiness check names objects of later files (t, u, v, w), so it is plpgsql
-- and reads them by name at run time.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. provider_since

ALTER TABLE public.cockpit_forms ADD COLUMN IF NOT EXISTS provider_since timestamptz;
COMMENT ON COLUMN public.cockpit_forms.provider_since IS
  'When provider last changed (set by trigger, the same statement as its forms.registry_set audit row). NULL: unchanged since the seed.';

CREATE OR REPLACE FUNCTION public.cockpit_forms_provider_since()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.provider_since := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cockpit_forms_provider_since ON public.cockpit_forms;
CREATE TRIGGER cockpit_forms_provider_since BEFORE UPDATE OF provider ON public.cockpit_forms
  FOR EACH ROW WHEN (OLD.provider IS DISTINCT FROM NEW.provider)
  EXECUTE FUNCTION public.cockpit_forms_provider_since();

-- ---------------------------------------------------------------------------
-- 2. Reads (internal)

-- The registry's current owner of one effect, or NULL.
CREATE OR REPLACE FUNCTION public.cockpit_form_effect_owner(p_form_key text, p_effect_key text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (SELECT e->>'owner' FROM public.cockpit_forms f CROSS JOIN LATERAL jsonb_array_elements(f.effects) e
           WHERE f.key = p_form_key AND e->>'key' = p_effect_key LIMIT 1);
END $$;

-- When a form opened in the cockpit: the provider's last change while it is
-- native (the seed time when it never changed), else NULL.
CREATE OR REPLACE FUNCTION public.cockpit_form_native_since(p_form_key text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (SELECT CASE WHEN f.provider = 'native' THEN coalesce(f.provider_since, f.updated_at) END
            FROM public.cockpit_forms f WHERE f.key = p_form_key);
END $$;

-- What a screen may see of a registry row: no address (no updated_by).
CREATE OR REPLACE FUNCTION public.cockpit_form_registry_view(p public.cockpit_forms)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN jsonb_build_object(
    'key', p.key,
    'title', p.title,
    'provider', p.provider,
    'typeformId', p.typeform_id,
    'version', p.version,
    'effects', coalesce((SELECT jsonb_agg(jsonb_build_object('key', e->>'key', 'owner', e->>'owner',
                                                             'delivery', e->>'delivery', 'label', e->>'label') ORDER BY o)
                           FROM jsonb_array_elements(p.effects) WITH ORDINALITY q(e, o)), '[]'::jsonb),
    'updatedAt', p.updated_at,
    'nativeSince', CASE WHEN p.provider = 'native' THEN coalesce(p.provider_since, p.updated_at) END);
END $$;

-- Whether an effect's delivery path is installed (section 3.2): NULL when it
-- is, else the missing piece as a clause for "{label} cannot move to the
-- cockpit yet: {clause}." Every object of a later file is read by name.
CREATE OR REPLACE FUNCTION public.cockpit_form_delivery_ready(p_form_key text, p_effect_key text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_delivery text;
  v_channel text;
BEGIN
  SELECT e->>'delivery' INTO v_delivery
    FROM public.cockpit_forms f CROSS JOIN LATERAL jsonb_array_elements(f.effects) e
   WHERE f.key = p_form_key AND e->>'key' = p_effect_key LIMIT 1;
  IF v_delivery IS NULL THEN
    RETURN 'the registry has no such effect';
  END IF;
  IF v_delivery = 'sql' THEN
    RETURN NULL;
  END IF;
  IF to_regprocedure('public.cockpit_form_dispatch(uuid)') IS NULL THEN
    RETURN 'the effect dispatch is not installed';
  END IF;
  IF v_delivery = 'clickup_queue' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                    WHERE c.conrelid = 'public.cockpit_clickup_writeback_queue'::regclass
                      AND c.conname = 'cockpit_clickup_writeback_queue_kind_check'
                      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%''form''%')
       OR to_regprocedure('public.cockpit_clickup_writeback_claim_forms(uuid,integer)') IS NULL THEN
      RETURN 'the ClickUp writer has no 1-1 notes lane';
    END IF;
  ELSIF v_delivery = 'slack_notice' THEN
    SELECT s.channel INTO v_channel FROM public.cockpit_slack_notice_settings s
     WHERE s.kind = 'checkin.grade' AND s.enabled;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                    WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass
                      AND c.conname = 'cockpit_slack_notices_kind_check'
                      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%''checkin.grade''%')
       OR v_channel IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels ch
                       WHERE ch.id = v_channel AND ch.state = 'ok' AND ch.private IS TRUE) THEN
      RETURN 'the Call grade notice has no ready private channel';
    END IF;
  ELSIF v_delivery = 'client_message' THEN
    IF to_regprocedure('public.cockpit_client_message_approve(uuid,text,text,uuid,text[])') IS NULL
       OR to_regprocedure('public.cockpit_client_message_claim(text[],text[],integer)') IS NULL THEN
      RETURN 'the recap approval is not installed';
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- The owner gate (section 3.1, its pass rule amended by Z70, then hardened).
-- A delivery proceeds only while an effect points at it that is queued or
-- unknown, owned by the cockpit, still the cockpit's in the registry, and of a
-- live response sent in the registry's native window: submitted_at at or after
-- cockpit_form_native_since(form_key). That is NULL unless the provider is
-- native, and a NULL never passes, so nothing passes while the provider is
-- typeform, whatever the effects' owners say. An admin may move owners while
-- the provider stays typeform, and Slack has no second switch, so the provider
-- has to be part of this rule. What a
-- rolled-back hour left open and nothing settled in between (a ClickUp row no
-- forms run reached, a draft recap, a queued grade notice) therefore reads
-- `Make owns this again.` at a later cut-over like any registry refusal, and
-- each caller settles it as 3.1 says: a queued ClickUp row skipped, an unknown
-- one failed with the check-the-card sentence, an old recap refused at approve
-- and skipped at claim, an old grade notice skipped. A caller never updates
-- cockpit_form_effects itself: it settles its own outbox row with the reason,
-- and the settle triggers (20261029w) move the effect.
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
  -- A queued effect before an unknown one, then the oldest.
  FOR e IN
    SELECT x.id, x.response_id, x.form_key, x.effect_key, x.state, x.owner, r.mode, r.submitted_at,
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
-- 3. Writes (internal, but for the gated browser RPC)

-- Close every open shadow draft of a form: a void response is final, so the
-- notes stay readable as a record and can never be sent. The responses guard
-- allows draft to void (20261027f_forms_core.sql:426-430); the 2a audit
-- writes one forms.shadow_closed row each. Only the cut-over closes shadow
-- drafts (step 7a's own SELECT, and the flip through 'cutover'), so a caller
-- that named no actor or source is credited to it: 'cut-over' / 'cutover',
-- as the registry row of the same hour. Returns how many it closed.
CREATE OR REPLACE FUNCTION public.cockpit_form_shadow_close(p_form_key text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_prev text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
  v_count integer;
BEGIN
  PERFORM set_config('cockpit.forms_action', 'forms.shadow_closed', true);
  IF coalesce(v_prev_actor, '') = '' THEN
    PERFORM set_config('cockpit.audit_actor', 'cut-over', true);
  END IF;
  IF coalesce(v_prev_source, '') = '' THEN
    PERFORM set_config('cockpit.audit_source', 'cutover', true);
  END IF;
  UPDATE public.cockpit_form_responses x SET state = 'void'
   WHERE x.form_key = p_form_key AND x.state = 'draft' AND x.mode = 'shadow';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN v_count;
END $$;

-- The one core that changes the registry (section 4.7). p_patch is
-- {provider?, owners?}: owners is make, shadow or cockpit for every effect,
-- or an object of those keyed by the form's own effect keys. p_actor is
-- {email, who, via}: via 'cockpit' from the browser (who from the editor
-- gate), or 'cutover' / 'cutover-rollback' from the owner-run SQL of the
-- cut-over hour. Only effects' owners change (key, delivery and label kept),
-- typeform_id is never written, and a patch that changes nothing writes
-- nothing. The 2a trigger writes the audit row and provider_since follows.
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
  IF f.key <> 'checkin' THEN
    RAISE EXCEPTION 'Only the 1-1 notes change here in 2b. Kickoff and Brand Blueprint keep the Stage 1 path.'
      USING ERRCODE = '22023';
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
  IF v_provider IS DISTINCT FROM f.provider THEN
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
    IF v_owner = 'cockpit' AND e->>'owner' IS DISTINCT FROM 'cockpit' THEN
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

-- The browser's door to the core: the editor gate first, its refusal re-said
-- for the 1-1 notes (the gate's own sentence names notices and routing).
CREATE OR REPLACE FUNCTION public.cockpit_form_registry_set(p_form_key text, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb;
BEGIN
  BEGIN
    g := public.cockpit_forms_editor_gate();
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'Only the CEO, an admin or someone they add can change where the 1-1 notes go.' USING ERRCODE = '42501';
  END;
  RETURN public.cockpit_form_registry_apply(p_form_key, p_patch,
    jsonb_build_object('email', g->>'email', 'who', g->>'who', 'via', 'cockpit'));
END $$;

-- Cut-over step 7b (section 11): run as the owner through SQL, never from a
-- seat. Refuses, writing nothing, when the 1-1 notes already open in the
-- cockpit, when the store holds no Typeform 1-1 notes (missing is not placed),
-- when the newest of them are on no client or on a card off the client roster,
-- when an effect's delivery path is missing, or while the 1-1 notes writer
-- last reported apply, fresh or stale (20261029t, read by name at run time):
-- step 6 leaves it at apply_limited, and a card-wide writer at this flip would
-- write on every client's card with no canary. apply_limited passes, and so
-- do dry_run and never reported, which write nothing. It checks the database
-- only: the gates, B1, B2, Make, the Typeform webhook, which cards step 6
-- limited the writer to and the WhatsApp sender's switches stay the people's
-- to check before this SELECT (RUNBOOK). It does not refuse on live check-in
-- responses already stored (a rollback keeps them as records, Z65), so a
-- second hour runs it again with all its checks. Then it closes the shadow
-- drafts and flips the registry in this one transaction. Every audit row it
-- writes, each forms.shadow_closed included, is credited to 'cut-over' /
-- 'cutover'; the settings are put back before it answers. A rollback's
-- leftovers do not block it: they were sent before this flip, so the gate
-- refuses them from here on (Z70).
CREATE OR REPLACE FUNCTION public.cockpit_form_checkin_cutover()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  t public.cockpit_csm_call_forms;
  e jsonb;
  v_clause text;
  v_voided integer;
  v_registry jsonb;
  v_audit uuid;
  v_writer jsonb;
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
BEGIN
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = 'checkin' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no form called checkin.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_actor', 'cut-over', true);
  PERFORM set_config('cockpit.audit_source', 'cutover', true);
  IF f.provider = 'native' THEN
    RAISE EXCEPTION 'The 1-1 notes already open in the cockpit.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO t FROM public.cockpit_csm_call_forms x
   WHERE x.form_id = 'fRokTITH' ORDER BY x.submitted_at DESC, x.token DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The store holds no Typeform notes, so the newest cannot be checked. Run the Typeform sync first.' USING ERRCODE = '55000';
  END IF;
  IF t.task_id IS NULL THEN
    RAISE EXCEPTION 'Put the newest Typeform notes on their client from the queue first.' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_csm_sources s
                  WHERE s.table_name = 'clients' AND s.data->>'taskId' = t.task_id) THEN
    RAISE EXCEPTION 'The newest Typeform notes are on card %, which is not on the client roster. Refresh the roster, or put the notes on a client on it, then run this again.', t.task_id
      USING ERRCODE = '55000';
  END IF;
  FOR e IN SELECT q FROM jsonb_array_elements(f.effects) WITH ORDINALITY z(q, o) ORDER BY o LOOP
    v_clause := public.cockpit_form_delivery_ready('checkin', e->>'key');
    IF v_clause IS NOT NULL THEN
      RAISE EXCEPTION '% cannot move to the cockpit yet: %.', e->>'label', v_clause USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- An apply report older than 15 minutes reads unknown, and that writer has not closed.
  v_writer := public.cockpit_clickup_forms_mode();
  IF v_writer->>'mode' = 'apply' OR (v_writer->>'mode' = 'unknown' AND v_writer->>'lastMode' = 'apply') THEN
    RAISE EXCEPTION 'Limit the 1-1 notes writer to the test card at step 6 first: it last reported apply, which writes on every client''s card.'
      USING ERRCODE = '55000';
  END IF;

  v_voided := public.cockpit_form_shadow_close('checkin');
  v_registry := public.cockpit_form_registry_apply('checkin', '{"provider":"native","owners":"cockpit"}'::jsonb,
    '{"via":"cutover","email":"cut-over"}'::jsonb);
  SELECT a.id INTO v_audit FROM public.cockpit_audit_log a
   WHERE a.entity_type = 'cockpit_forms' AND a.entity_id = 'checkin' AND a.action = 'forms.registry_set'
     AND a.created_at = now()
   ORDER BY a.created_at DESC LIMIT 1;
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN jsonb_build_object(
    'voided', v_voided,
    'registry', v_registry,
    'nativeSince', public.cockpit_form_native_since('checkin'),
    'auditId', v_audit,
    'newestTypeform', jsonb_build_object('token', t.token, 'submittedAt', t.submitted_at, 'taskId', t.task_id),
    'unlinked14d', coalesce((SELECT jsonb_agg(x.token ORDER BY x.submitted_at DESC, x.token)
                               FROM public.cockpit_csm_call_forms x
                              WHERE x.form_id = 'fRokTITH' AND x.submitted_at >= now() - interval '14 days'
                                AND x.recording_url IS NULL AND x.linked_call_id IS NULL), '[]'::jsonb));
END $$;

-- ---------------------------------------------------------------------------
-- 4. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE fn text;
BEGIN
  -- Internal: no role at all (definer functions, triggers and the owner's SQL).
  FOREACH fn IN ARRAY ARRAY[
    'cockpit_forms_provider_since()', 'cockpit_form_effect_owner(text,text)', 'cockpit_form_native_since(text)',
    'cockpit_form_registry_view(public.cockpit_forms)', 'cockpit_form_delivery_ready(text,text)',
    'cockpit_form_effect_gate(text,text)', 'cockpit_form_shadow_close(text)',
    'cockpit_form_registry_apply(text,jsonb,jsonb)', 'cockpit_form_checkin_cutover()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', fn);
  END LOOP;
  -- The screens' RPC: a signed-in seat, the editor gate inside.
  EXECUTE 'REVOKE ALL ON FUNCTION public.cockpit_form_registry_set(text,jsonb) FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_form_registry_set(text,jsonb) TO authenticated';
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
