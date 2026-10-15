-- A video review belongs to one ClickUp job and one cut. Existing social reviews
-- keep their existing behavior. Client delivery remains a deliberate CSM action.
BEGIN;
ALTER TABLE public.review_links
 ADD COLUMN flow_task_id text,
 ADD COLUMN flow_source_url text,
 ADD COLUMN flow_ready_at timestamptz,
 ADD COLUMN flow_sync_error text;
CREATE UNIQUE INDEX review_one_current_video ON public.review_links(flow_task_id)
 WHERE flow_task_id IS NOT NULL AND NOT revoked;

CREATE FUNCTION public.cockpit_video_review_access(p_task text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (public.cockpit_has_role('creative') OR public.cockpit_has_role('csm') OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo())
 AND EXISTS(SELECT 1 FROM public.editor_jobs j JOIN public.editor_clients c ON c.task_id=j.client_task_id
 WHERE j.task_id=p_task AND j.state IS DISTINCT FROM 'gone' AND public.cockpit_client_allowed(c.name));
$$;
REVOKE ALL ON FUNCTION public.cockpit_video_review_access(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.cockpit_video_review_panel(p_task text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.cockpit_video_review_access(p_task) THEN RAISE EXCEPTION 'This video is unavailable for your account' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('taskId',j.task_id,'title',j.name,'client',c.name,'clientTaskId',c.task_id,
 'status',j.status,'sourceUrl',j.edited_url,'syncedAt',j.synced_at,
 'review',(SELECT jsonb_build_object('token',l.token,'readyAt',l.flow_ready_at,'error',l.flow_sync_error,
 'sourceUrl',l.flow_source_url,'decision',(SELECT i.decision FROM public.review_items i WHERE i.token=l.token LIMIT 1))
 FROM public.review_links l WHERE l.flow_task_id=j.task_id AND NOT l.revoked LIMIT 1)) INTO result
 FROM public.editor_jobs j JOIN public.editor_clients c ON c.task_id=j.client_task_id WHERE j.task_id=p_task;
 RETURN result;
END $$;

CREATE FUNCTION public.cockpit_video_review_create(p_task text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.editor_jobs; c public.editor_clients; l public.review_links; made jsonb; email text;
BEGIN
 IF NOT public.cockpit_video_review_access(p_task) THEN RAISE EXCEPTION 'This video is unavailable for your account' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM public.editor_jobs WHERE task_id=p_task FOR UPDATE;
 SELECT * INTO c FROM public.editor_clients WHERE task_id=j.client_task_id;
 IF j.synced_at IS NULL OR j.synced_at<now()-interval '10 minutes' THEN RAISE EXCEPTION 'The video source is stale. Refresh after the ClickUp sync.'; END IF;
 IF j.edited_url IS NULL OR j.edited_url !~ '^https://[^ /]+' THEN RAISE EXCEPTION 'Add the approved cut to Edited Video Link on the ClickUp task first.'; END IF;
 SELECT * INTO l FROM public.review_links WHERE flow_task_id=p_task AND NOT revoked FOR UPDATE;
 IF l.token IS NOT NULL AND l.flow_source_url=j.edited_url AND (l.expires_at IS NULL OR l.expires_at>now()) THEN
  RETURN jsonb_build_object('token',l.token,'ready',l.flow_ready_at IS NOT NULL);
 END IF;
 IF lower(j.status) <> 'internal approved' THEN RAISE EXCEPTION 'Approve this cut internally in ClickUp before creating the client link.'; END IF;
 IF l.token IS NOT NULL THEN UPDATE public.review_links SET revoked=true WHERE token=l.token; END IF;
 SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=auth.uid();
 made:=public.review_create(coalesce(j.name,'Video review'),
  'شاهدوا الفيديو، ثم اضغطوا موافقة أو اكتبوا ملاحظاتكم على التعديلات المطلوبة.',c.name,c.task_id,email,
  jsonb_build_array(jsonb_build_object('task_id',p_task,'title',coalesce(j.name,'Video'),'video_url',j.edited_url,'kind','video')),30);
 UPDATE public.review_links SET flow_task_id=p_task,flow_source_url=j.edited_url WHERE token=made->>'token';
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,after)
 VALUES('prepare_client_review','video',p_task,email,'creative',jsonb_build_object('review',made->>'token'));
 RETURN jsonb_build_object('token',made->>'token','ready',false);
END $$;

-- Old links cannot approve a replacement cut. The worker also checks live
-- ClickUp immediately before a status change or a ready-to-launch message.
CREATE FUNCTION public.video_review_current_cut() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.review_links; j public.editor_jobs;
BEGIN
 SELECT * INTO l FROM public.review_links WHERE token=NEW.token;
 IF l.flow_task_id IS NULL OR NEW.decision IS NOT DISTINCT FROM OLD.decision THEN RETURN NEW; END IF;
 SELECT * INTO j FROM public.editor_jobs WHERE task_id=l.flow_task_id;
 IF l.revoked OR l.flow_ready_at IS NULL OR l.expires_at<=now() OR j.task_id IS NULL
 OR j.edited_url IS DISTINCT FROM l.flow_source_url
 OR lower(j.status) NOT IN('client review','client approved','update required')
 THEN RAISE EXCEPTION 'This cut is no longer available for approval. Ask the team for its current review link.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER video_review_current_cut BEFORE UPDATE OF decision ON public.review_items
FOR EACH ROW EXECUTE FUNCTION public.video_review_current_cut();
CREATE FUNCTION public.video_review_note_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.review_links; j public.editor_jobs;
BEGIN
 SELECT lnk.* INTO l FROM public.review_links lnk JOIN public.review_items i ON i.token=lnk.token WHERE i.id=NEW.item_id;
 IF l.flow_task_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO j FROM public.editor_jobs WHERE task_id=l.flow_task_id;
 IF l.revoked OR l.flow_ready_at IS NULL OR l.expires_at<=now() OR j.task_id IS NULL
 OR j.edited_url IS DISTINCT FROM l.flow_source_url OR NEW.task_id IS DISTINCT FROM l.flow_task_id
 OR lower(j.status) NOT IN('client review','client approved','update required')
 THEN RAISE EXCEPTION 'This cut is no longer open for comments. Ask the team for the current link.'; END IF;
 -- A new client comment after approval must return to review before launch.
 UPDATE public.review_items SET decision='changes',decided_at=now() WHERE id=NEW.item_id;
 RETURN NEW;
END $$;
CREATE TRIGGER video_review_note_guard BEFORE INSERT ON public.review_notes
FOR EACH ROW EXECUTE FUNCTION public.video_review_note_guard();
REVOKE ALL ON FUNCTION public.video_review_note_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.video_review_current_cut() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_video_review_panel(text),public.cockpit_video_review_create(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_video_review_panel(text),public.cockpit_video_review_create(text) TO authenticated;
COMMIT;
