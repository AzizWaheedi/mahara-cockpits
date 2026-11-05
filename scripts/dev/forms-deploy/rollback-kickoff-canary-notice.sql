-- Restores the previous owner-only notice-queue implementation without altering historical notices.
-- Read back and record exact live function, ACL and test-card notice states before running.
-- This disables the test-card safety guard: do not submit another kickoff canary afterward.
-- Run in one transaction and stop on any mismatch. A short NOWAIT lock refuses concurrent writers.
LOCK TABLE public.cockpit_form_responses, public.cockpit_slack_notices IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $$
DECLARE
  v_reg regprocedure := to_regprocedure('public.cockpit_slack_notice_queue(text,text,text,text,jsonb,uuid,text,text)');
BEGIN
  IF v_reg IS NULL OR pg_catalog.md5(pg_get_functiondef(v_reg)) NOT IN ('d39d5484a54c91969d4786d1a1ef81a0','888bf4c1712de6449796c91e4da419f1') THEN
    RAISE EXCEPTION 'Kickoff notice source changed. Stop and review before rollback.' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = v_reg AND prosecdef AND proacl::text = '{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'Kickoff notice permissions changed. Stop and review before rollback.' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_slack_notices n JOIN public.cockpit_form_responses r
               ON n.dedupe_key = 'kickoff:' || r.id::text AND n.task_id = r.task_id
              WHERE n.kind = 'kickoff' AND n.task_id = '86eywg1cq' AND r.form_key = 'kickoff'
                AND r.source = 'cockpit' AND r.answer_meta @> '{"canary":true}'::jsonb
                AND n.state IN ('queued','sending','unknown','failed')) THEN
    RAISE EXCEPTION 'A kickoff canary notice needs reconciliation before rollback.' USING ERRCODE = '55000';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_queue(p_kind text, p_dedupe text, p_task text, p_client text,
  p_facts jsonb, p_parent uuid, p_state text, p_error text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_state text := coalesce(p_state, 'queued');
BEGIN
  INSERT INTO public.cockpit_slack_notices(kind, dedupe_key, task_id, client_name, parent_id, facts, state, error, finished_at)
  VALUES (p_kind, p_dedupe, p_task, p_client, p_parent, coalesce(p_facts, '{}'::jsonb), v_state,
          left(nullif(btrim(p_error), ''), 240), CASE WHEN v_state = 'skipped' THEN now() END)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
