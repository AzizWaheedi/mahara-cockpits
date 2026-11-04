-- Late Typeform 1-1 notes (docs/forms/STAGE2B-CONTRACT.md sections 2.8 and
-- 4.9, build 9). Creative Triage (bldgtotkfmhoxmlzowdx). Additive; applies
-- twice. The sixth 2b file, after 20261029s (cockpit_form_native_since).
--
-- Once the 1-1 notes open in the cockpit, a response to the old Typeform
-- (fRokTITH) submitted at or after the switch is "late": it fired nothing
-- (Make is off) and must not read as the client's latest notes. Whoever
-- writes the store (the csm-calls worker, a rolled-back release of it, a
-- person), a database trigger decides:
--
-- 1. cockpit_csm_call_forms.form_kind takes 'checkin_late'.
-- 2. cockpit_csm_call_forms_late (BEFORE): an fRokTITH row submitted at or
--    after cockpit_form_native_since('checkin'), or a row already late
--    (sticky, whatever the registry says later), is written checkin_late and
--    linked to no call, so neither the timeline's call form nor the brief
--    reads it. Its first classification leaves one csm.checkin_late audit
--    row (no answers).
-- 3. cockpit_csm_call_forms_legacy (AFTER): a late row with a card gets one
--    cockpit_form_responses row in state legacy (no answers, no effects), the
--    record that a 1-1 call was noted outside the cockpit. A failure there
--    is recorded (forms.late_typeform_failed) and never blocks the store's
--    own write.
--
-- While the registry's checkin provider is typeform, native_since is NULL
-- and the trigger changes nothing. Both trigger functions are SECURITY
-- DEFINER with an empty search path and no role may execute them.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The kind

-- Widened only from the definition the contract read: another session's value
-- would be dropped here without a word and fail its writer later, so any other
-- definition stops the file (the CHECK's own drift guard, as Z61's for bodies).
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_csm_call_forms'::regclass
     AND c.conname = 'cockpit_csm_call_forms_form_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((form_kind = ANY (ARRAY[''checkin''::text, ''onboarding''::text, ''kickoff''::text, ''kickoff_old''::text, ''blueprint''::text, ''checkin_late''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((form_kind = ANY (ARRAY[''checkin''::text, ''onboarding''::text, ''kickoff''::text, ''kickoff_old''::text, ''blueprint''::text])))' THEN
      RAISE EXCEPTION 'cockpit_csm_call_forms_form_kind_check changed since the 2b contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT IF EXISTS cockpit_csm_call_forms_form_kind_check;
    ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT cockpit_csm_call_forms_form_kind_check
      CHECK (form_kind = ANY (ARRAY['checkin','onboarding','kickoff','kickoff_old','blueprint','checkin_late']));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Late is decided here, for every writer

CREATE OR REPLACE FUNCTION public.cockpit_csm_call_forms_late()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_since timestamptz;
  v_first boolean;
  v_actor text;
BEGIN
  IF NEW.form_id IS DISTINCT FROM 'fRokTITH' THEN
    RETURN NEW;
  END IF;
  -- Sticky: a late row stays late and unlinked, whatever writes it again.
  IF TG_OP = 'UPDATE' AND OLD.form_kind = 'checkin_late' THEN
    NEW.form_kind := 'checkin_late';
    NEW.linked_call_id := NULL;
    RETURN NEW;
  END IF;
  v_since := public.cockpit_form_native_since('checkin');
  IF v_since IS NULL OR NEW.submitted_at IS NULL OR NEW.submitted_at < v_since THEN
    RETURN NEW;
  END IF;
  NEW.form_kind := 'checkin_late';
  NEW.linked_call_id := NULL;
  -- The first classification only: an upsert of a stored row fires the
  -- insert trigger before its conflict turns into an update.
  v_first := CASE WHEN TG_OP = 'UPDATE' THEN true
                  ELSE NOT EXISTS (SELECT 1 FROM public.cockpit_csm_call_forms f WHERE f.token = NEW.token) END;
  IF v_first THEN
    SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('csm.checkin_late', 'cockpit_csm_call_forms', NEW.token,
            coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), session_user::text),
            'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
            jsonb_build_object('formKind', 'checkin'), jsonb_build_object('formKind', 'checkin_late'),
            jsonb_build_object('submittedAt', NEW.submitted_at, 'nativeSince', v_since, 'taskId', NEW.task_id));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cockpit_csm_call_forms_late ON public.cockpit_csm_call_forms;
CREATE TRIGGER cockpit_csm_call_forms_late
  BEFORE INSERT OR UPDATE OF form_kind, submitted_at, form_id, linked_call_id ON public.cockpit_csm_call_forms
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_call_forms_late();

-- ---------------------------------------------------------------------------
-- 3. The legacy record of a late row with a card

CREATE OR REPLACE FUNCTION public.cockpit_csm_call_forms_legacy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_action text := current_setting('cockpit.forms_action', true);
  v_actor text := current_setting('cockpit.audit_actor', true);
  v_err text;
BEGIN
  BEGIN
    PERFORM set_config('cockpit.forms_action', 'forms.late_typeform', true);
    PERFORM set_config('cockpit.audit_actor', 'typeform', true);
    INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
      answers, hidden, created_by, submitted_at)
    VALUES ('checkin', (SELECT f.version FROM public.cockpit_forms f WHERE f.key = 'checkin'), 'typeform_sync', NEW.token,
            NEW.task_id,
            coalesce((SELECT nullif(btrim(s.data->>'name'), '') FROM public.cockpit_csm_sources s
                       WHERE s.table_name = 'clients' AND s.data->>'taskId' = NEW.task_id LIMIT 1), NEW.typed_client),
            'live', 'legacy', '{}'::jsonb,
            jsonb_build_object('typeformToken', NEW.token, 'formId', 'fRokTITH', 'submittedAt', NEW.submitted_at),
            'typeform', NEW.submitted_at)
    ON CONFLICT (form_key, external_id) DO NOTHING;
    PERFORM set_config('cockpit.forms_action', coalesce(v_action, ''), true);
    PERFORM set_config('cockpit.audit_actor', coalesce(v_actor, ''), true);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    BEGIN
      INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      VALUES ('forms.late_typeform_failed', 'cockpit_csm_call_forms', NEW.token, 'typeform', 'client-success',
              coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'), NULL, NULL,
              jsonb_build_object('token', NEW.token, 'taskId', NEW.task_id, 'error', left(v_err, 240)));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_csm_call_forms_legacy ON public.cockpit_csm_call_forms;
CREATE TRIGGER cockpit_csm_call_forms_legacy
  AFTER INSERT OR UPDATE OF task_id, form_kind ON public.cockpit_csm_call_forms
  FOR EACH ROW WHEN (NEW.form_kind = 'checkin_late' AND NEW.task_id IS NOT NULL)
  EXECUTE FUNCTION public.cockpit_csm_call_forms_legacy();

-- ---------------------------------------------------------------------------
-- 4. Function privileges: trigger functions, no role at all

REVOKE ALL ON FUNCTION public.cockpit_csm_call_forms_late() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_csm_call_forms_legacy() FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
