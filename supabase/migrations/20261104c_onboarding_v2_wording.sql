-- Candidate migration name; recheck every live migration and worktree before applying.
-- Correct only client-facing version-2 copy while it has no answers or invites.
BEGIN;
-- Every issuance reads the registry before it reads a version or inserts an invite.
-- Wait for those transactions to finish and prevent new issuers from reading an old
-- schema until this update commits. A short timeout avoids blocking normal work.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.cockpit_forms IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $$
DECLARE
  v_old jsonb; v_new jsonb; v_fields jsonb; v_registry text; v_problem text; v_stage jsonb; v_form public.cockpit_forms%ROWTYPE;
  old_hash constant text := '38d371cd509ced4fef9b7cad6e09fb80';
  new_hash constant text := '230653a3d7bd14a79ee7edba40976cb4';
BEGIN
  -- Go-live locks the registry row first; take the same lock even when it is still version 1.
  SELECT * INTO v_form FROM public.cockpit_forms WHERE key='onboarding' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Onboarding registry row missing; stop and re-read it.' USING ERRCODE='55000'; END IF;
  SELECT schema INTO v_old FROM public.cockpit_form_versions WHERE form_key='onboarding' AND version=2 FOR UPDATE NOWAIT;
  IF v_old IS NULL OR md5(v_old::text) NOT IN (old_hash,new_hash) THEN
    RAISE EXCEPTION 'Onboarding version 2 changed; stop and re-read it.' USING ERRCODE='55000';
  END IF;
  IF v_form.version=2 THEN
    v_registry := md5(v_form.schema::text);
    IF v_registry IS NULL THEN RAISE EXCEPTION 'Onboarding registry schema missing; stop and re-read it.' USING ERRCODE='55000'; END IF;
  END IF;
  IF v_registry IS NOT NULL AND v_registry NOT IN (old_hash,new_hash) THEN
    RAISE EXCEPTION 'Onboarding registry copy changed; stop and re-read it.' USING ERRCODE='55000';
  END IF;
  IF md5(v_old::text)=old_hash OR v_registry=old_hash THEN
    SELECT value INTO v_stage FROM public.cockpit_settings WHERE key='forms.stage4' FOR UPDATE NOWAIT;
    IF v_stage->'onboarding' IS DISTINCT FROM 'false'::jsonb THEN
      RAISE EXCEPTION 'Native onboarding is not confirmed off; stop and re-read it.' USING ERRCODE='55000';
    END IF;
    LOCK TABLE public.cockpit_form_invites, public.cockpit_form_responses IN SHARE ROW EXCLUSIVE MODE NOWAIT;
    IF EXISTS (SELECT 1 FROM public.cockpit_form_invites WHERE form_key='onboarding' AND form_version=2)
       OR EXISTS (SELECT 1 FROM public.cockpit_form_responses WHERE form_key='onboarding' AND form_version=2) THEN
      RAISE EXCEPTION 'Onboarding version 2 is in use; leave it unchanged and use version 3.' USING ERRCODE='55000';
    END IF;
    SELECT jsonb_agg(CASE
      WHEN f->>'key'='freeConsults' THEN jsonb_set(f,'{hint}','null'::jsonb)
      WHEN f->>'key'='challenges' THEN jsonb_set(f,'{hint,ar}',to_jsonb('اذكروا جم شي نقدر نساعدكم فيه سيده.'::text))
      ELSE f END ORDER BY n) INTO v_fields
      FROM jsonb_array_elements(v_old->'fields') WITH ORDINALITY AS x(f,n);
    v_new := jsonb_set(jsonb_set(v_old,'{fields}',v_fields),'{intro}',
      '{"en":"Tell us about your business so your onboarding call starts in the right place.","ar":"عرّفونا على شغلكم عشان مكالمة الانطلاق تبدي من المكان الصح."}'::jsonb);
    IF md5(v_new::text)<>new_hash THEN
      RAISE EXCEPTION 'Corrected onboarding schema differs from the reviewed copy.' USING ERRCODE='55000';
    END IF;
    v_problem:=public.cockpit_form_schema_check(v_new);
    IF v_problem IS NOT NULL THEN RAISE EXCEPTION 'Corrected onboarding schema failed validation: %',v_problem USING ERRCODE='22023'; END IF;
    PERFORM set_config('cockpit.audit_actor','migration 20261104c',true);
    PERFORM set_config('cockpit.audit_source','migration',true);
    PERFORM set_config('cockpit.forms_action','forms.onboarding_v2_wording',true);
    UPDATE public.cockpit_form_versions SET schema=v_new WHERE form_key='onboarding' AND version=2 AND md5(schema::text)=old_hash;
    UPDATE public.cockpit_forms SET schema=v_new,updated_by='migration 20261104c',updated_at=now() WHERE key='onboarding' AND version=2 AND md5(schema::text)=old_hash;
    PERFORM set_config('cockpit.forms_action','',true);
  END IF;
END $$;
COMMIT;
