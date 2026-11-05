-- Operational rollback of the structured onboarding switch after 20261104d.
-- This is deliberately non-destructive: existing version-3 invitations, answers,
-- schemas and version-aware readers stay in place. New invitations use version 2.
-- It does not change forms.stage4, Typeform, Make or the production worker.
-- Run as the database owner, only after re-reading live migrations and the nine
-- replaced function bodies. Never restore the old version-unaware CSM reader
-- while version 3 is stored. A full code/data reversal requires a separate review.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.cockpit_forms IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.cockpit_form_versions IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.cockpit_form_invites, public.cockpit_form_responses IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $$
DECLARE
  v_body text;
  v_before_invites bigint; v_after_invites bigint;
  v_before_answers bigint; v_after_answers bigint;
  v_result jsonb;
  v_guard record;
BEGIN
  FOR v_guard IN SELECT * FROM (VALUES
    ('public.cockpit_form_schema_v2_switch(text,text)', 'b156b6b4ed70db295c29b1d8ccaebcb0'),
    ('public.cockpit_form_schema_v2_state()', 'a4ce259b480d028be0414b815f6997d2'),
    ('public.cockpit_form_client_version(text)', '4087f8f1b3fd759ecc8b0183a1db1fbd')
  ) AS x(fn, expected)
  LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_body
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(v_guard.fn);
    IF v_body IS DISTINCT FROM v_guard.expected THEN
      RAISE EXCEPTION 'Rollback function % changed; stop and re-read it.', v_guard.fn USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF (SELECT md5(schema::text) FROM public.cockpit_form_versions WHERE form_key='onboarding' AND version=2)
       IS DISTINCT FROM '230653a3d7bd14a79ee7edba40976cb4'
     OR ((SELECT md5(schema::text) FROM public.cockpit_form_versions WHERE form_key='onboarding' AND version=3)
           IS DISTINCT FROM '2e187490c06d61169588bc9724870aed'
         AND (SELECT md5(schema::text) FROM public.cockpit_form_versions WHERE form_key='onboarding' AND version=3)
           IS DISTINCT FROM 'ca5a873dd26eeb55299c5f6da4a1bba0') THEN
    RAISE EXCEPTION 'Onboarding schemas changed; stop and re-read them.' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_before_invites FROM public.cockpit_form_invites WHERE form_key='onboarding' AND form_version=3;
  SELECT count(*) INTO v_before_answers FROM public.cockpit_form_responses WHERE form_key='onboarding' AND form_version=3;
  v_result := public.cockpit_form_schema_v2_switch('off', 'structured onboarding rollback');
  SELECT count(*) INTO v_after_invites FROM public.cockpit_form_invites WHERE form_key='onboarding' AND form_version=3;
  SELECT count(*) INTO v_after_answers FROM public.cockpit_form_responses WHERE form_key='onboarding' AND form_version=3;
  IF public.cockpit_form_schema_v2_state() IS DISTINCT FROM 'off'
     OR public.cockpit_form_client_version('onboarding') IS DISTINCT FROM 2
     OR v_result->>'state' IS DISTINCT FROM 'off'
     OR v_before_invites IS DISTINCT FROM v_after_invites
     OR v_before_answers IS DISTINCT FROM v_after_answers THEN
    RAISE EXCEPTION 'Rollback readback failed; the transaction is cancelled.' USING ERRCODE = '55000';
  END IF;
  RAISE NOTICE 'Structured onboarding is off; existing version-3 forms and answers are preserved.';
END $$;
COMMIT;
