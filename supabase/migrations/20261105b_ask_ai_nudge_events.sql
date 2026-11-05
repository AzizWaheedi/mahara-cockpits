-- Cockpit chat suggestion bubble: count how often it is shown, tapped and dismissed.
-- Decision 2026-11-05: a bubble beside the chat button offers one question, at most
-- once per page per day. These rows say whether it helps; nothing else reads them.
-- The table has row security and no policies: the browser writes only through the
-- function below, and only the service key reads.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_ask_ai_nudges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_user_id uuid NOT NULL,
  actor_email text,
  app text NOT NULL CHECK (app IN ('media-buyer', 'client-success', 'creative', 'sales', 'editor')),
  event text NOT NULL CHECK (event IN ('shown', 'tapped', 'dismissed')),
  page text,
  question text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cockpit_ask_ai_nudges_app_created_idx ON public.cockpit_ask_ai_nudges (app, created_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_ask_ai_nudges_user_created_idx ON public.cockpit_ask_ai_nudges (auth_user_id, created_at DESC);

ALTER TABLE public.cockpit_ask_ai_nudges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ask_ai_nudges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.cockpit_ask_ai_nudges TO service_role;

-- Records one bubble event for the signed-in member of that cockpit. At most 200 a day
-- per person, so a stuck page cannot fill the table.
CREATE OR REPLACE FUNCTION public.cockpit_log_ask_ai_nudge(p_app text, p_event text, p_page text DEFAULT NULL, p_question text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_email text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT public.cockpit_ask_ai_owner_allowed(v_uid,p_app,NULL) THEN RAISE EXCEPTION 'Access denied: current cockpit role required'; END IF;
 IF p_event IS NULL OR p_event NOT IN ('shown','tapped','dismissed') THEN RAISE EXCEPTION 'Invalid event'; END IF;
 IF (SELECT count(*) FROM public.cockpit_ask_ai_nudges WHERE auth_user_id=v_uid AND created_at>now()-interval '1 day')>=200 THEN RETURN; END IF;
 SELECT email INTO v_email FROM public.cockpit_members WHERE auth_user_id=v_uid;
 INSERT INTO public.cockpit_ask_ai_nudges(auth_user_id,actor_email,app,event,page,question)
 VALUES(v_uid,v_email,p_app,p_event,left(nullif(btrim(p_page),''),300),left(nullif(btrim(p_question),''),500));
END;
$function$;

REVOKE ALL ON FUNCTION public.cockpit_log_ask_ai_nudge(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_log_ask_ai_nudge(text, text, text, text) TO authenticated;

COMMIT;
