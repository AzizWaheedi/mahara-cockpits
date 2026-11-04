-- Cockpit chat for the sales cockpit (Ace) and the video editor cockpit (Frame).
-- Decision 2026-11-04: one responder serves five cockpits. Only the app and role
-- lists change; every other rule of the two functions is unchanged from live.

BEGIN;

ALTER TABLE public.cockpit_ask_ai_jobs DROP CONSTRAINT IF EXISTS cockpit_ask_ai_jobs_app_check;
ALTER TABLE public.cockpit_ask_ai_jobs ADD CONSTRAINT cockpit_ask_ai_jobs_app_check
  CHECK (app IN ('media-buyer', 'client-success', 'creative', 'sales', 'editor'));
ALTER TABLE public.cockpit_ask_ai_jobs DROP CONSTRAINT IF EXISTS cockpit_ask_ai_jobs_role_check;
ALTER TABLE public.cockpit_ask_ai_jobs ADD CONSTRAINT cockpit_ask_ai_jobs_role_check
  CHECK (role IN ('media_buyer', 'csm', 'creative', 'sales', 'editor', 'admin', 'ceo'));

CREATE OR REPLACE FUNCTION public.cockpit_ask_ai_owner_allowed(p_uid uuid, p_app text, p_client text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=p_uid AND m.active AND u.email_confirmed_at IS NOT NULL
 AND m.email=lower(btrim(u.email)) AND p_app IN ('media-buyer','client-success','creative','sales','editor')
 AND ('admin'=ANY(m.roles) OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
   OR (CASE p_app WHEN 'media-buyer' THEN 'media_buyer' WHEN 'client-success' THEN 'csm'
        WHEN 'creative' THEN 'creative' WHEN 'sales' THEN 'sales' WHEN 'editor' THEN 'editor' END)=ANY(m.roles))
 AND (p_client IS NULL OR 'admin'=ANY(m.roles) OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
   OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(p_client)))));
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_submit_ask_ai_job(p_app text, p_role text, p_prompt text, p_client_name text DEFAULT NULL::text, p_kind text DEFAULT 'chat'::text, p_context jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_client text:=nullif(btrim(p_client_name),'');
 v_prompt text:=btrim(p_prompt); v_key text:=nullif(btrim(p_idempotency_key),'');
 v_row public.cockpit_ask_ai_jobs; v_role text; v_email text; v_input jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT public.cockpit_ask_ai_owner_allowed(v_uid,p_app,v_client) THEN RAISE EXCEPTION 'Access denied: current cockpit role and client scope required'; END IF;
 v_role:=CASE p_app WHEN 'media-buyer' THEN 'media_buyer' WHEN 'client-success' THEN 'csm'
   WHEN 'creative' THEN 'creative' WHEN 'sales' THEN 'sales' WHEN 'editor' THEN 'editor' END;
 IF v_role IS NULL OR p_role IS NULL OR (p_role<>v_role AND p_role NOT IN ('admin','ceo')) OR
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
$function$;

COMMIT;
