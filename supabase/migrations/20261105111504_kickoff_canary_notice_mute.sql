-- Suppress only the explicitly marked, CEO-only kickoff canary for the internal test card.
-- Normal kickoff notices and all other kinds keep their existing behavior.
-- The insert and transition to muted occur in one transaction, so no sender can claim the row between them.
DO $$
DECLARE
  v_reg regprocedure := to_regprocedure('public.cockpit_slack_notice_queue(text,text,text,text,jsonb,uuid,text,text)');
BEGIN
  IF v_reg IS NULL OR pg_catalog.md5(pg_get_functiondef(v_reg)) NOT IN ('d39d5484a54c91969d4786d1a1ef81a0', '888bf4c1712de6449796c91e4da419f1') THEN
    RAISE EXCEPTION 'Kickoff notice source changed. Review live source before applying.' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = v_reg AND prosecdef AND proacl::text = '{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'Kickoff notice permissions changed. Review live permissions before applying.' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.cockpit_form_responses') IS NULL THEN
    RAISE EXCEPTION 'Form responses are not installed.' USING ERRCODE = '55000';
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
  IF v_id IS NOT NULL AND v_state = 'queued' AND p_kind = 'kickoff' AND p_task = '86eywg1cq'
     AND EXISTS (SELECT 1 FROM public.cockpit_form_responses r
                   WHERE r.task_id = p_task AND r.form_key = 'kickoff' AND r.source = 'cockpit'
                     AND r.answer_meta @> '{"canary":true}'::jsonb
                     AND p_dedupe = 'kickoff:' || r.id::text) THEN
    UPDATE public.cockpit_slack_notices
       SET state = 'muted', finished_at = now(), error = 'Canary on the test card: not posted.'
     WHERE id = v_id AND state = 'queued';
  END IF;
  RETURN v_id;
END $$;
