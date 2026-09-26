-- Supabase cockpit chat jobs. Legacy AI producers require separate migration.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_ask_ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text NOT NULL,
  app text NOT NULL CHECK (app IN ('media-buyer', 'client-success', 'creative')),
  role text NOT NULL CHECK (role IN ('media_buyer', 'csm', 'creative', 'admin', 'ceo')),
  client_name text,
  kind text NOT NULL DEFAULT 'chat',
  prompt text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'claimed', 'completed', 'failed')),
  result jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  lease_token uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  hidden boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.cockpit_ask_ai_jobs ADD COLUMN IF NOT EXISTS scope_fingerprint text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cockpit_ask_ai_jobs_idempotency
 ON public.cockpit_ask_ai_jobs(auth_user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cockpit_ask_ai_jobs_status_created
 ON public.cockpit_ask_ai_jobs(status,created_at);

-- Worker checks must evaluate the request OWNER, not the service account.
-- Matches the verified membership/founder rules without replacing shared CSM helpers.
CREATE OR REPLACE FUNCTION public.cockpit_ask_ai_owner_allowed(p_uid uuid,p_app text,p_client text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=p_uid AND m.active AND u.email_confirmed_at IS NOT NULL
 AND m.email=lower(btrim(u.email)) AND p_app IN ('media-buyer','client-success','creative')
 AND ('admin'=ANY(m.roles) OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
   OR (CASE p_app WHEN 'media-buyer' THEN 'media_buyer' WHEN 'client-success' THEN 'csm' ELSE 'creative' END)=ANY(m.roles))
 AND (p_client IS NULL OR 'admin'=ANY(m.roles) OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
   OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(p_client)))));
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ask_ai_scope(p_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(jsonb_build_array(m.auth_user_id,m.email,m.active,m.roles,m.clients,u.email,u.email_confirmed_at)::text)
 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id WHERE m.auth_user_id=p_uid;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ask_ai_context(p_uid uuid,p_app text,p_client text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'actor',p_uid,'app',p_app,'client',p_client,'read_only',true,
 'instruction','Use only the scoped business context. Do not execute outward actions from a queued request.',
 'profiles',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
   SELECT p.client_name,p.service,p.stage,p.health,p.kpi,p.notes,p.overview,p.synced_at
   FROM public.cockpit_client_profiles p
   WHERE public.cockpit_ask_ai_owner_allowed(p_uid,p_app,p.client_name)
     AND (p_client IS NULL OR lower(btrim(p.client_name))=lower(btrim(p_client)))
   ORDER BY p.client_name LIMIT 50) q),'[]'::jsonb),
 'history',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
   SELECT j.prompt,j.result,j.created_at FROM public.cockpit_ask_ai_jobs j
   WHERE j.auth_user_id=p_uid AND j.app=p_app AND NOT j.hidden AND j.status='completed'
     AND j.scope_fingerprint=public.cockpit_ask_ai_scope(p_uid)
     AND public.cockpit_ask_ai_owner_allowed(p_uid,j.app,j.client_name)
     AND (p_client IS NULL OR lower(btrim(j.client_name))=lower(btrim(p_client)))
   ORDER BY j.created_at DESC,j.id LIMIT 12) q),'[]'::jsonb),
 'captured_at',now());
$$;
CREATE OR REPLACE FUNCTION public.trg_cockpit_ask_ai_jobs_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_cockpit_ask_ai_jobs_touch ON public.cockpit_ask_ai_jobs;
CREATE TRIGGER trg_cockpit_ask_ai_jobs_touch BEFORE UPDATE ON public.cockpit_ask_ai_jobs
 FOR EACH ROW EXECUTE FUNCTION public.trg_cockpit_ask_ai_jobs_touch();
CREATE OR REPLACE FUNCTION public.trg_cockpit_ask_ai_jobs_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(lower(TG_OP),'cockpit_ask_ai_jobs',NEW.id::text,NEW.actor_email,NEW.app,'ask-ai',
 CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD)-'lease_token' END,to_jsonb(NEW)-'lease_token');
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cockpit_ask_ai_jobs_audit ON public.cockpit_ask_ai_jobs;
CREATE TRIGGER trg_cockpit_ask_ai_jobs_audit AFTER INSERT OR UPDATE ON public.cockpit_ask_ai_jobs
 FOR EACH ROW EXECUTE FUNCTION public.trg_cockpit_ask_ai_jobs_audit();

CREATE OR REPLACE FUNCTION public.cockpit_submit_ask_ai_job(
 p_app text,p_role text,p_prompt text,p_client_name text DEFAULT NULL,p_kind text DEFAULT 'chat',
 p_context jsonb DEFAULT '{}'::jsonb,p_idempotency_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_client text:=nullif(btrim(p_client_name),'');
 v_prompt text:=btrim(p_prompt); v_key text:=nullif(btrim(p_idempotency_key),'');
 v_row public.cockpit_ask_ai_jobs; v_role text; v_email text; v_input jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT public.cockpit_ask_ai_owner_allowed(v_uid,p_app,v_client) THEN RAISE EXCEPTION 'Access denied: current cockpit role and client scope required'; END IF;
 v_role:=CASE p_app WHEN 'media-buyer' THEN 'media_buyer' WHEN 'client-success' THEN 'csm' ELSE 'creative' END;
 IF p_role IS NULL OR (p_role<>v_role AND p_role NOT IN ('admin','ceo')) OR
    NOT (public.cockpit_has_role(p_role) OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Access denied: role does not match app'; END IF;
 IF v_prompt IS NULL OR length(v_prompt) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Invalid prompt length'; END IF;
 IF p_kind IS DISTINCT FROM 'chat' THEN RAISE EXCEPTION 'This endpoint supports cockpit chat only; producer migration is required'; END IF;
 IF length(v_key)>200 OR p_context IS NULL OR jsonb_typeof(p_context)<>'object' OR octet_length(p_context::text)>10000 THEN RAISE EXCEPTION 'Invalid request context or key'; END IF;
 v_input:=jsonb_build_object('app',p_app,'role',p_role,'prompt',v_prompt,'client',v_client,'kind',p_kind,'context',p_context);
 -- Serializes even the first insert, where SELECT FOR UPDATE has no row to lock.
 PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text||coalesce(v_key,v_input::text),0));
 SELECT email INTO v_email FROM public.cockpit_members WHERE auth_user_id=v_uid;
 IF v_key IS NOT NULL THEN
   SELECT * INTO v_row FROM public.cockpit_ask_ai_jobs WHERE auth_user_id=v_uid AND idempotency_key=v_key;
   IF FOUND THEN
     IF v_row.metadata->'request' IS DISTINCT FROM v_input THEN RAISE EXCEPTION 'Idempotency conflict'; END IF;
     RETURN v_row.id;
   END IF;
 ELSE
   SELECT * INTO v_row FROM public.cockpit_ask_ai_jobs WHERE auth_user_id=v_uid
    AND metadata->'request'=v_input AND NOT hidden AND status IN ('queued','claimed')
    AND created_at>clock_timestamp()-interval '60 seconds' ORDER BY created_at DESC LIMIT 1;
   IF FOUND THEN RETURN v_row.id; END IF;
 END IF;
 INSERT INTO public.cockpit_ask_ai_jobs(auth_user_id,actor_email,app,role,client_name,kind,prompt,context,idempotency_key,metadata,scope_fingerprint)
 VALUES(v_uid,v_email,p_app,v_role,v_client,p_kind,v_prompt,public.cockpit_ask_ai_context(v_uid,p_app,v_client),v_key,
 jsonb_build_object('request',v_input),public.cockpit_ask_ai_scope(v_uid)) RETURNING * INTO v_row;
 RETURN v_row.id;
END;
$$;

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
 'attempts',j.attempts,'created_at',j.created_at,'completed_at',j.completed_at);
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_get_ask_ai_thread(p_app text,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),p_app,NULL) THEN RAISE EXCEPTION 'Access denied: active verified role required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid thread limit'; END IF;
 SELECT coalesce(jsonb_agg(public.cockpit_get_ask_ai_job(q.id) ORDER BY q.created_at DESC,q.id),'[]'::jsonb)
 INTO result FROM (SELECT id,created_at FROM public.cockpit_ask_ai_jobs j
 WHERE j.auth_user_id=auth.uid() AND j.app=p_app AND NOT j.hidden
 AND j.scope_fingerprint=public.cockpit_ask_ai_scope(auth.uid())
 AND public.cockpit_ask_ai_owner_allowed(auth.uid(),j.app,j.client_name)
 ORDER BY j.created_at DESC,j.id LIMIT p_limit) q;
 RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_clear_ask_ai_thread(p_app text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),p_app,NULL) THEN RAISE EXCEPTION 'Access denied: active verified role required'; END IF;
 UPDATE public.cockpit_ask_ai_jobs SET hidden=true,
 status=CASE WHEN status IN ('queued','claimed') THEN 'failed' ELSE status END,
 error=CASE WHEN status IN ('queued','claimed') THEN 'Conversation cleared by owner' ELSE error END
 WHERE auth_user_id=auth.uid() AND app=p_app AND NOT hidden;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_claim_ask_ai_jobs(p_worker_id text,p_limit integer DEFAULT 5,p_lease_seconds integer DEFAULT 300)
RETURNS TABLE(id uuid,app text,role text,client_name text,kind text,prompt text,context jsonb,attempts integer,max_attempts integer,lease_token uuid,lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
 IF nullif(btrim(p_worker_id),'') IS NULL OR length(p_worker_id)>160 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 3600 THEN RAISE EXCEPTION 'Invalid worker, limit or lease'; END IF;
 UPDATE public.cockpit_ask_ai_jobs j SET status='failed',error='Owner no longer has access',completed_at=v_now
 WHERE j.status IN ('queued','claimed') AND (j.hidden OR NOT public.cockpit_ask_ai_owner_allowed(j.auth_user_id,j.app,j.client_name));
 UPDATE public.cockpit_ask_ai_jobs j SET status='failed',error='Maximum attempts exceeded',completed_at=v_now
 WHERE (j.status='queued' OR (j.status='claimed' AND j.lease_expires_at<=v_now)) AND j.attempts>=j.max_attempts;
 RETURN QUERY WITH candidates AS (
 SELECT j.id FROM public.cockpit_ask_ai_jobs j
 WHERE (j.status='queued' OR (j.status='claimed' AND j.lease_expires_at<=v_now)) AND NOT j.hidden AND j.attempts<j.max_attempts
 AND public.cockpit_ask_ai_owner_allowed(j.auth_user_id,j.app,j.client_name)
 ORDER BY j.created_at,j.id LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE public.cockpit_ask_ai_jobs j SET status='claimed',attempts=j.attempts+1,claimed_at=v_now,claimed_by=p_worker_id,
 lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),lease_token=gen_random_uuid(),
 scope_fingerprint=public.cockpit_ask_ai_scope(j.auth_user_id),
 context=public.cockpit_ask_ai_context(j.auth_user_id,j.app,j.client_name)
 FROM candidates c WHERE j.id=c.id
 RETURNING j.id,j.app,j.role,j.client_name,j.kind,j.prompt,j.context,j.attempts,j.max_attempts,j.lease_token,j.lease_expires_at;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_complete_ask_ai_job(p_job_id uuid,p_lease_token uuid,p_result jsonb,p_worker_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer; reply text;
BEGIN
 reply:=CASE WHEN jsonb_typeof(p_result)='string' THEN p_result#>>'{}'
 WHEN jsonb_typeof(p_result)='object' THEN coalesce(
 CASE WHEN jsonb_typeof(p_result->'reply')='string' THEN p_result->>'reply' END,
 CASE WHEN jsonb_typeof(p_result->'answer')='string' THEN p_result->>'answer' END,
 CASE WHEN jsonb_typeof(p_result->'text')='string' THEN p_result->>'text' END) END;
 IF nullif(btrim(reply),'') IS NULL OR length(reply)>40000 THEN RAISE EXCEPTION 'Nonempty chat answer required'; END IF;
 UPDATE public.cockpit_ask_ai_jobs j SET status='completed',result=p_result,error=NULL,completed_at=clock_timestamp()
 WHERE j.id=p_job_id AND j.status='claimed' AND NOT j.hidden AND j.lease_token=p_lease_token
 AND j.claimed_by=p_worker_id AND j.lease_expires_at>clock_timestamp()
 AND public.cockpit_ask_ai_owner_allowed(j.auth_user_id,j.app,j.client_name)
 AND j.scope_fingerprint=public.cockpit_ask_ai_scope(j.auth_user_id);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_fail_ask_ai_job(p_job_id uuid,p_lease_token uuid,p_error text,p_worker_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.cockpit_ask_ai_jobs j SET
 status=CASE WHEN j.attempts<j.max_attempts AND NOT j.hidden AND public.cockpit_ask_ai_owner_allowed(j.auth_user_id,j.app,j.client_name) THEN 'queued' ELSE 'failed' END,
 error=left(coalesce(nullif(btrim(p_error),''),'Worker could not answer'),1000),
 completed_at=CASE WHEN j.attempts>=j.max_attempts THEN clock_timestamp() ELSE NULL END,
 lease_token=NULL,lease_expires_at=NULL,claimed_by=NULL
 WHERE j.id=p_job_id AND j.status='claimed' AND j.lease_token=p_lease_token AND j.claimed_by=p_worker_id AND j.lease_expires_at>clock_timestamp();
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END;
$$;
ALTER TABLE public.cockpit_ask_ai_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ask_ai_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.cockpit_ask_ai_jobs TO service_role;
-- Browser access is exclusively via guarded RPCs, never a raw table read.
DROP POLICY IF EXISTS cockpit_ask_ai_jobs_select_own ON public.cockpit_ask_ai_jobs;
DROP POLICY IF EXISTS cockpit_ask_ai_jobs_select_admin ON public.cockpit_ask_ai_jobs;
REVOKE ALL ON FUNCTION public.cockpit_ask_ai_owner_allowed(uuid,text,text),public.cockpit_ask_ai_scope(uuid),
 public.cockpit_ask_ai_context(uuid,text,text),public.trg_cockpit_ask_ai_jobs_touch(),public.trg_cockpit_ask_ai_jobs_audit()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_submit_ask_ai_job(text,text,text,text,text,jsonb,text),
 public.cockpit_get_ask_ai_job(uuid),public.cockpit_get_ask_ai_thread(text,integer),public.cockpit_clear_ask_ai_thread(text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_submit_ask_ai_job(text,text,text,text,text,jsonb,text),
 public.cockpit_get_ask_ai_job(uuid),public.cockpit_get_ask_ai_thread(text,integer),public.cockpit_clear_ask_ai_thread(text)
 TO authenticated;
REVOKE ALL ON FUNCTION public.cockpit_claim_ask_ai_jobs(text,integer,integer),
 public.cockpit_complete_ask_ai_job(uuid,uuid,jsonb,text),public.cockpit_fail_ask_ai_job(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_claim_ask_ai_jobs(text,integer,integer),
 public.cockpit_complete_ask_ai_job(uuid,uuid,jsonb,text),public.cockpit_fail_ask_ai_job(uuid,uuid,text,text)
 TO service_role;
NOTIFY pgrst,'reload schema';
CREATE OR REPLACE FUNCTION public.cockpit_ask_ai_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('queued',count(*) FILTER(WHERE status='queued' AND NOT hidden),
 'claimed',count(*) FILTER(WHERE status='claimed' AND NOT hidden),
 'failed',count(*) FILTER(WHERE status='failed' AND NOT hidden),
 'completed',count(*) FILTER(WHERE status='completed' AND NOT hidden),
 'last_completed_at',max(completed_at) FILTER(WHERE status='completed')) FROM public.cockpit_ask_ai_jobs;
$$;
REVOKE ALL ON FUNCTION public.cockpit_ask_ai_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_ask_ai_health() TO service_role;
COMMIT;
