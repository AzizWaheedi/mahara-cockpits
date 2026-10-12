-- Rules every WhatsApp reply passes on the server (2026-10-12).
--
-- Each function below starts from its live definition (pg_get_functiondef,
-- read 2026-10-12, identical to 20261005g) and keeps its SET search_path and
-- its privileges.
--
-- cockpit_wa_reply_begin, on the dry run and on the real request:
--  a. From the client success cockpit, a chat linked to a client needs client
--     success access to that client (cockpit_csm_client_gate). An unlinked
--     chat stays as before: only a seat that covers every client may answer
--     it (cockpit_wa_context).
--  b. Ceilings counted on cockpit_wa_reply_intents (failed requests, which
--     never reached GoHighLevel, do not count): 20 per person and 5 per chat
--     in any 10 minutes.
--  c. Client messages never quote leads or cost per lead: English "lead",
--     "leads", "CPL", "cost per lead" as whole words; Arabic ليد, ليدز, ليدات
--     with the usual attached prefixes (ال, ب, ك, ل, و/ف before those), and
--     "عملاء محتملين". The name وليد and words like تقليدي do not match.
--  The ceilings and the wording rule hold for every desk, because they protect
--  the one WhatsApp number and its clients. The client gate is client success
--  only. The media buyer and creative desks have no connected number today.
-- cockpit_wa_context adds lastReplyId, the newest accepted or delivered reply
--  in the chat. The context changes the moment a reply is accepted, so a
--  second message no longer waits up to 15 minutes for the worker to see
--  delivery. A double press, or a second tab, is still refused: until the
--  first reply is accepted the context is the same and the one-live-intent
--  index (cockpit_wa_one_reply_context) holds.
-- cockpit_wa_health also accepts the do-not-disturb read that
--  cockpit-media-api makes before sending (GET contacts/{id}), so it lands in
--  the WhatsApp health ledger with the reply it belongs to.
--
-- Every contextKey a browser holds changes once with this migration: an open
-- inbox is told "The conversation changed" once and re-reads.
BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_wa_context(p_uid uuid, p_app text, p_thread text, p_allow_archived boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE t public.wa_threads; d public.wa_drafts; name text; full_scope boolean; desk text; matched bigint; last_reply uuid;
BEGIN
 IF p_app IS NULL OR p_app NOT IN('media-buyer','client-success','creative') OR NOT public.cockpit_ask_ai_owner_allowed(p_uid,p_app,NULL) THEN RAISE EXCEPTION 'WhatsApp access is no longer available';END IF;
 SELECT * INTO t FROM public.wa_threads WHERE id=p_thread;
 IF NOT FOUND OR (t.archived AND NOT p_allow_archived) THEN RAISE EXCEPTION 'The WhatsApp thread is unavailable';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_wa_connections c WHERE c.app=p_app AND c.enabled AND c.location_id=t.location_id) THEN RAISE EXCEPTION 'WhatsApp is not connected for this desk. Do not use another desk inbox';END IF;
 desk:=CASE p_app WHEN 'media-buyer' THEN 'ads' WHEN 'client-success' THEN 'csm' ELSE 'creative' END;
 SELECT ('admin'=ANY(m.roles) OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com') OR cardinality(m.clients)=0) INTO full_scope FROM public.cockpit_members m WHERE m.auth_user_id=p_uid;
 IF t.desk<>desk AND NOT EXISTS(SELECT 1 FROM public.cockpit_members m WHERE m.auth_user_id=p_uid AND ('admin'=ANY(m.roles) OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com'))) THEN RAISE EXCEPTION 'This conversation belongs to another WhatsApp desk';END IF;
 SELECT count(*),max(s.data->>'name') INTO matched,name FROM public.cockpit_csm_sources s JOIN public.cockpit_csm_source_state f ON f.table_name=s.table_name AND f.source_snapshot_at=s.source_snapshot_at
 WHERE s.table_name='clients' AND f.ready AND f.row_count=(SELECT count(*) FROM public.cockpit_csm_sources WHERE table_name='clients') AND s.data->>'taskId'=t.client_task_id;
 IF matched<>1 THEN name:=NULL;END IF;
 IF full_scope IS DISTINCT FROM true AND (name IS NULL OR NOT public.cockpit_ask_ai_owner_allowed(p_uid,p_app,name)) THEN RAISE EXCEPTION 'Verify the client mapping before replying to this conversation';END IF;
 SELECT * INTO d FROM public.wa_drafts WHERE thread_id=t.id;
 SELECT r.id INTO last_reply FROM public.cockpit_wa_reply_intents r WHERE r.thread_id=t.id AND r.state IN('accepted','delivered') ORDER BY r.accepted_at DESC NULLS LAST,r.created_at DESC LIMIT 1;
 RETURN jsonb_build_object('threadId',t.id,'contactId',t.contact_id,'locationId',t.location_id,'providerId',t.provider_id,'desk',t.desk,'clientName',name,'archived',t.archived,'lastInboundAt',t.last_inbound_at,'lastOutboundAt',t.last_outbound_at,'lastAt',t.last_at,'draftedAt',d.drafted_at,'basedOn',d.based_on,'lastReplyId',last_reply);
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_wa_context(uuid,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_wa_reply_begin(p_app text, p_thread text, p_body text, p_context_key text, p_request_id uuid, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE ctx jsonb;r public.cockpit_wa_reply_intents;email text;task text;
BEGIN
 PERFORM public.cockpit_wa_actor(p_app);
 IF p_request_id IS NULL OR p_body IS NULL OR length(p_body) NOT BETWEEN 1 AND 4000 OR nullif(btrim(p_body),'') IS NULL THEN RAISE EXCEPTION 'Enter a reply and retain its original request ID';END IF;
 IF p_app='client-success' THEN
  SELECT t.client_task_id INTO task FROM public.wa_threads t WHERE t.id=p_thread;
  IF task IS NOT NULL THEN PERFORM public.cockpit_csm_client_gate(task);END IF;
 END IF;
 IF p_body ~* '(^|[^ء-ي٠-٩A-Za-z0-9_])([وف]?(ال|[بكل]|[بك]ال))?ليد(ز|ات)?($|[^ء-ي٠-٩A-Za-z0-9_])|(ال)?عملاء\s+(ال)?محتمل(ين|ون)|\mleads?\M|\mcpl\M|\mcost\s+per\s+lead\M' THEN
  RAISE EXCEPTION 'Client messages never quote leads or cost per lead. Say how the campaign is doing, or count appointments for clients we book for.';
 END IF;
 IF NOT p_apply THEN
  PERFORM public.cockpit_wa_context(auth.uid(),p_app,p_thread);
  IF (SELECT count(*) FROM public.cockpit_wa_reply_intents WHERE actor_id=auth.uid() AND state<>'failed' AND created_at>now()-interval '10 minutes')>=20 THEN RAISE EXCEPTION 'You have sent 20 messages in 10 minutes. Wait a few minutes; this protects Rasem''s number.';END IF;
  IF (SELECT count(*) FROM public.cockpit_wa_reply_intents WHERE thread_id=p_thread AND state<>'failed' AND created_at>now()-interval '10 minutes')>=5 THEN RAISE EXCEPTION 'This chat has had 5 messages in 10 minutes. Wait a few minutes before sending more.';END IF;
  RETURN jsonb_build_object('ok',false,'dryRun',true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO r FROM public.cockpit_wa_reply_intents WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.actor_id<>auth.uid() OR r.app<>p_app OR r.thread_id<>p_thread OR r.body<>p_body OR r.context_hash<>p_context_key THEN RAISE EXCEPTION 'Reply ID already used for different inputs';END IF;
  PERFORM public.cockpit_wa_context(auth.uid(),p_app,p_thread);
  RETURN jsonb_build_object('state',r.state,'id',r.id,'receipt',r.receipt,'errorCode',r.error_code);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wa-thread:'||p_thread,0));
 PERFORM 1 FROM public.wa_threads WHERE id=p_thread FOR UPDATE;
 PERFORM 1 FROM public.cockpit_members WHERE auth_user_id=auth.uid() FOR SHARE;PERFORM 1 FROM auth.users WHERE id=auth.uid() FOR SHARE;
 ctx:=public.cockpit_wa_context(auth.uid(),p_app,p_thread);
 IF md5(ctx::text) IS DISTINCT FROM p_context_key THEN RAISE EXCEPTION 'The conversation changed. Review it before making a new reply';END IF;
 IF nullif(ctx->>'providerId','') IS NULL OR nullif(ctx->>'contactId','') IS NULL OR nullif(ctx->>'locationId','') IS NULL THEN RAISE EXCEPTION 'Verified custom-provider, contact and location identifiers are required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.wa_state s WHERE s.location_id=ctx->>'locationId' AND s.last_scan>now()-interval '20 minutes') THEN RAISE EXCEPTION 'WhatsApp has not synced recently. Refresh the native inbox before replying';END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_wa_reply_intents WHERE thread_id=p_thread AND context_hash=p_context_key AND state IN('intent','accepted','reconcile','delivered')) THEN RAISE EXCEPTION 'This conversation already has a reply intent. Reconcile it before sending another';END IF;
 -- The thread lock above serialises the per-chat count; the per-person count
 -- is taken under a lock on the person.
 PERFORM pg_advisory_xact_lock(hashtextextended('wa-actor:'||auth.uid()::text,0));
 IF (SELECT count(*) FROM public.cockpit_wa_reply_intents WHERE actor_id=auth.uid() AND state<>'failed' AND created_at>now()-interval '10 minutes')>=20 THEN RAISE EXCEPTION 'You have sent 20 messages in 10 minutes. Wait a few minutes; this protects Rasem''s number.';END IF;
 IF (SELECT count(*) FROM public.cockpit_wa_reply_intents WHERE thread_id=p_thread AND state<>'failed' AND created_at>now()-interval '10 minutes')>=5 THEN RAISE EXCEPTION 'This chat has had 5 messages in 10 minutes. Wait a few minutes before sending more.';END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id=auth.uid();
 INSERT INTO public.cockpit_wa_reply_intents(id,app,actor_id,actor_email,thread_id,body,context_hash,context,state) VALUES(p_request_id,p_app,auth.uid(),email,p_thread,p_body,p_context_key,ctx,'intent') RETURNING * INTO r;
 RETURN jsonb_build_object('state','new','id',r.id,'claimToken',r.claim_token,'context',ctx);
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_wa_reply_begin(text,text,text,text,uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_wa_reply_begin(text,text,text,text,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_wa_health(p_id uuid, p_token uuid, p_receipt jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_wa_reply_intents WHERE id=p_id AND claim_token=p_token) THEN RAISE EXCEPTION 'Unknown WhatsApp intent';END IF;
 IF p_receipt->>'provider'<>'ghl' OR p_receipt->>'phase' NOT IN('intent','response','unknown') OR p_receipt->>'method' NOT IN('GET','POST')
  OR NOT(p_receipt->>'resource' LIKE 'conversations/messages%' OR (p_receipt->>'method'='GET' AND p_receipt->>'resource' ~ '^contacts/[A-Za-z0-9_-]{1,64}$')) THEN RAISE EXCEPTION 'Invalid WhatsApp provider health receipt';END IF;
 INSERT INTO public.cockpit_wa_provider_health(intent_id,provider,method,resource,phase,http_status,object_id) VALUES(p_id,'ghl',p_receipt->>'method',p_receipt->>'resource',p_receipt->>'phase',nullif(p_receipt->>'http_status','')::integer,p_receipt->>'object_id');
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_wa_health(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_wa_health(uuid,uuid,jsonb) TO service_role;

COMMIT;
