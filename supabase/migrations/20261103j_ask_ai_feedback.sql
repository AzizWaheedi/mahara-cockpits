-- Hermes answer feedback: the owner rates a completed chat answer helpful (1)
-- or not helpful (-1), and can clear it (0). The existing audit trigger already
-- records every update of cockpit_ask_ai_jobs.
BEGIN;
ALTER TABLE public.cockpit_ask_ai_jobs
 ADD COLUMN IF NOT EXISTS feedback smallint CHECK (feedback IN (-1,1)),
 ADD COLUMN IF NOT EXISTS feedback_at timestamptz;
CREATE OR REPLACE FUNCTION public.cockpit_rate_ask_ai_job(p_job_id uuid,p_rating integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cockpit_ask_ai_jobs;
BEGIN
 IF p_rating IS NULL OR p_rating NOT IN (-1,0,1) THEN RAISE EXCEPTION 'Invalid rating'; END IF;
 SELECT * INTO j FROM public.cockpit_ask_ai_jobs WHERE id=p_job_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access denied: current owner scope required'; END IF;
 IF j.auth_user_id IS DISTINCT FROM auth.uid() OR j.hidden
   OR NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),j.app,j.client_name)
   OR j.scope_fingerprint IS DISTINCT FROM public.cockpit_ask_ai_scope(auth.uid()) THEN RAISE EXCEPTION 'Access denied: current owner scope required'; END IF;
 IF j.status<>'completed' OR j.kind<>'chat' THEN RAISE EXCEPTION 'Only a completed chat answer can be rated'; END IF;
 UPDATE public.cockpit_ask_ai_jobs SET feedback=NULLIF(p_rating,0),
  feedback_at=CASE WHEN p_rating=0 THEN NULL ELSE clock_timestamp() END
  WHERE id=p_job_id;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_rate_ask_ai_job(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_rate_ask_ai_job(uuid,integer) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.cockpit_get_ask_ai_job(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cockpit_ask_ai_jobs;
BEGIN
 SELECT * INTO j FROM public.cockpit_ask_ai_jobs WHERE id=p_job_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF j.auth_user_id IS DISTINCT FROM auth.uid() OR j.hidden
   OR NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),j.app,j.client_name)
   OR j.scope_fingerprint IS DISTINCT FROM public.cockpit_ask_ai_scope(auth.uid()) THEN RAISE EXCEPTION 'Access denied: current owner scope required'; END IF;
 RETURN jsonb_build_object('id',j.id,'status',j.status,'phase',CASE WHEN j.status IN ('queued','claimed') THEN 'pending' ELSE j.status END,
 'app',j.app,'role',j.role,'client_name',j.client_name,'kind',j.kind,'prompt',j.prompt,'result',j.result,'error',j.error,
 'attempts',j.attempts,'created_at',j.created_at,'completed_at',j.completed_at,'feedback',j.feedback);
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_get_ask_ai_job(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_get_ask_ai_job(uuid)
 TO authenticated;
COMMIT;
