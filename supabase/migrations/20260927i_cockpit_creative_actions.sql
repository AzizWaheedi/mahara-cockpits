-- Authenticated cockpit wrappers reuse the existing review and editor-desk queues.
-- Legacy service-role functions stay available to the existing workers.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_creative_actor()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE email text;
BEGIN
 IF NOT (public.cockpit_has_role('creative') OR public.cockpit_has_role('csm') OR public.cockpit_has_role('editor') OR public.cockpit_has_role('media_buyer') OR public.cockpit_is_ceo()) THEN
  RAISE EXCEPTION 'Active creative access required' USING ERRCODE='42501';
 END IF;
 SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=auth.uid();
 RETURN email;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_review_client(p_name text,p_task text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE name text;
BEGIN
 PERFORM public.cockpit_creative_actor();
 IF nullif(btrim(p_task),'') IS NOT NULL THEN
  SELECT c.name INTO name FROM public.editor_clients c WHERE c.task_id=p_task;
  IF name IS NULL OR (nullif(btrim(p_name),'') IS NOT NULL AND lower(btrim(p_name))<>lower(btrim(name))) THEN
   RAISE EXCEPTION 'Review client does not match the selected client';
  END IF;
 ELSE name:=nullif(btrim(p_name),''); END IF;
 IF name IS NULL OR NOT public.cockpit_client_allowed(name) THEN
  RAISE EXCEPTION 'Choose an assigned client for this review' USING ERRCODE='42501';
 END IF;
 RETURN name;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_review_create(p_title text,p_note text,p_client text,p_client_task_id text,p_by text,p_items jsonb,p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text:=public.cockpit_creative_actor(); name text; result jsonb;
BEGIN
 name:=public.cockpit_review_client(p_client,p_client_task_id);
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Add between 1 and 100 review items'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE coalesce(x->>'video_url','') !~* '^https?://[^ /]+') THEN RAISE EXCEPTION 'Every review item needs a valid link'; END IF;
 result:=public.review_create(p_title,p_note,name,p_client_task_id,email,p_items,p_days);
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,after)
 VALUES('create','review',result->>'token',email,'creative',jsonb_build_object('client',name,'items',result->'items'));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_review_import_folder(p_folder text,p_title text,p_note text,p_client text,p_client_task_id text,p_by text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text:=public.cockpit_creative_actor(); name text; result jsonb;
BEGIN
 name:=public.cockpit_review_client(p_client,p_client_task_id);
 IF p_folder IS NULL OR p_folder !~ '^(https://drive\.google\.com/(drive/)?folders/[A-Za-z0-9_-]+([?].*)?|[A-Za-z0-9_-]{20,})$' THEN RAISE EXCEPTION 'Paste the Google Drive folder link'; END IF;
 result:=public.review_import_folder(p_folder,p_title,p_note,name,p_client_task_id,email);
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,after)
 VALUES('queue_import','review',result->>'id',email,'creative',jsonb_build_object('client',name));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_review_import_status(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_creative_actor();
 IF NOT EXISTS(SELECT 1 FROM public.review_imports r WHERE r.id=p_id AND public.cockpit_client_allowed(r.client_name)) THEN RETURN NULL; END IF;
 RETURN public.review_import_status(p_id);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_review_clients()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cockpit_creative_actor();
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'),'[]') INTO result FROM jsonb_array_elements(public.review_clients()) x WHERE public.cockpit_client_allowed(x->>'name');
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_review_list(p_limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cockpit_creative_actor();
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC),'[]') INTO result FROM (
  SELECT l.token,l.title,l.client_name,l.created_at,l.sent_at,l.opened_at,l.revoked,
   (SELECT count(*) FROM public.review_items i WHERE i.token=l.token) AS items,
   (SELECT count(*) FROM public.review_items i WHERE i.token=l.token AND i.decision IS NOT NULL) AS decided,
   (SELECT count(*) FROM public.review_items i WHERE i.token=l.token AND i.decision='changes') AS changes
  FROM public.review_links l WHERE public.cockpit_client_allowed(l.client_name)
  ORDER BY l.created_at DESC LIMIT greatest(1,least(100,p_limit))
 ) x;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_creative_requests_list(p_campaign text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cockpit_creative_actor();
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC),'[]') INTO result FROM (
  SELECT r.* FROM public.cockpit_creative_requests r
  WHERE public.cockpit_client_allowed(r.client_name) AND (p_campaign IS NULL OR r.campaign_name=p_campaign)
  ORDER BY r.created_at DESC LIMIT 100
 ) x;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_review_status(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_creative_actor();
 IF NOT EXISTS(SELECT 1 FROM public.review_links l WHERE l.token=p_token AND public.cockpit_client_allowed(l.client_name)) THEN RETURN NULL; END IF;
 RETURN public.review_status(p_token);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_review_revoke(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text:=public.cockpit_creative_actor(); l public.review_links; result jsonb;
BEGIN
 SELECT * INTO l FROM public.review_links WHERE token=p_token FOR UPDATE;
 IF NOT FOUND OR NOT public.cockpit_client_allowed(l.client_name) THEN RAISE EXCEPTION 'Review not found' USING ERRCODE='42501'; END IF;
 IF l.revoked THEN RETURN jsonb_build_object('revoked',true); END IF;
 result:=public.review_revoke(p_token);
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app) VALUES('revoke','review',p_token,email,'creative');
 RETURN result;
END $$;

-- Verdict persistence is truthful about the external feedback dependency.
CREATE OR REPLACE FUNCTION public.cockpit_creative_request_review(p_id uuid,p_campaign text,p_verdict text,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text:=public.cockpit_creative_actor(); r public.cockpit_creative_requests;
BEGIN
 IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Media buyer access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.cockpit_creative_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.campaign_name<>p_campaign OR NOT public.cockpit_client_allowed(r.client_name) THEN RAISE EXCEPTION 'Creative request not found' USING ERRCODE='42501'; END IF;
 IF p_verdict IS NULL OR p_verdict NOT IN ('worked','needs_another_version','stop') THEN RAISE EXCEPTION 'Choose a valid assessment'; END IF;
 IF r.launched_meta_ad_id IS NULL OR r.launched_at IS NULL THEN RAISE EXCEPTION 'Link a launched ad before reviewing this request'; END IF;
 IF (now() AT TIME ZONE 'Asia/Kuwait')::date <= (r.launched_at AT TIME ZONE 'Asia/Kuwait')::date+3 THEN RAISE EXCEPTION 'Wait for three complete days after the launch before reviewing it'; END IF;
 IF r.verdict IS NOT NULL THEN
  IF r.verdict<>p_verdict OR r.verdict_note IS DISTINCT FROM nullif(left(btrim(p_note),500),'') THEN RAISE EXCEPTION 'This request has already been reviewed'; END IF;
  RETURN to_jsonb(r);
 END IF;
 UPDATE public.cockpit_creative_requests SET status='reviewed',verdict=p_verdict,verdict_note=nullif(left(btrim(p_note),500),''),reviewed_by=email,reviewed_at=now(),last_actor=email,updated_at=now(),
 feedback_error=CASE WHEN feedback_posted_at IS NULL THEN 'Assessment saved. Feedback has not been confirmed yet.' ELSE feedback_error END
 WHERE id=p_id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

REVOKE EXECUTE ON FUNCTION public.review_create(text,text,text,text,text,jsonb,integer),public.review_import_folder(text,text,text,text,text,text),public.review_import_status(bigint),public.review_clients(),public.review_list(integer),public.review_status(text),public.review_revoke(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_review_status(text),public.cockpit_review_revoke(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_review_status(text),public.cockpit_review_revoke(text) TO authenticated;
REVOKE ALL ON FUNCTION public.cockpit_creative_actor(),public.cockpit_review_client(text,text),public.cockpit_review_create(text,text,text,text,text,jsonb,integer),public.cockpit_review_import_folder(text,text,text,text,text,text),public.cockpit_review_import_status(bigint),public.cockpit_review_clients(),public.cockpit_review_list(integer),public.cockpit_creative_requests_list(text),public.cockpit_creative_request_review(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_review_create(text,text,text,text,text,jsonb,integer),public.cockpit_review_import_folder(text,text,text,text,text,text),public.cockpit_review_import_status(bigint),public.cockpit_review_clients(),public.cockpit_review_list(integer),public.cockpit_creative_requests_list(text),public.cockpit_creative_request_review(uuid,text,text,text) TO authenticated;
COMMIT;
