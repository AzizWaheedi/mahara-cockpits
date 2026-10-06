BEGIN;
-- These columns are already consumed by the actual GHL inbox worker.
ALTER TABLE public.wa_threads ADD COLUMN IF NOT EXISTS provider_id text;
ALTER TABLE public.wa_threads ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;
ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS speaker text;
ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS delivery_status text CHECK(delivery_status IN('pending','sent','delivered','read','failed'));
ALTER TABLE public.wa_drafts ADD COLUMN submitted_at timestamptz;
ALTER TABLE public.wa_drafts ADD COLUMN submitted_by text;
-- Preserve main's explicit rule: only CSM has a connected personal WhatsApp desk.
CREATE TABLE public.cockpit_wa_connections(
 app text PRIMARY KEY CHECK(app IN('media-buyer','client-success','creative')),
 desk text NOT NULL UNIQUE CHECK(desk IN('ads','csm','creative')),enabled boolean NOT NULL DEFAULT false,
 location_id text,configured_at timestamptz,source_note text NOT NULL
);
ALTER TABLE public.cockpit_wa_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_wa_connections FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_wa_connections TO service_role;
CREATE TRIGGER cockpit_wa_connections_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_wa_connections FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
INSERT INTO public.cockpit_wa_connections(app,desk,enabled,location_id,source_note) VALUES
 ('client-success','csm',true,'wwG426bwruWWv9W3fazQ','Existing CSM connection from main. Provider freshness must be verified by the inbox ledger.'),
 ('media-buyer','ads',false,NULL,'This desk has no connected WhatsApp account. Another person''s inbox must not be used.'),
 ('creative','creative',false,NULL,'This desk has no connected WhatsApp account. Another person''s inbox must not be used.');
CREATE TABLE public.cockpit_wa_commands(
 id uuid PRIMARY KEY,app text NOT NULL,actor_id uuid NOT NULL REFERENCES auth.users(id),thread_id text NOT NULL REFERENCES public.wa_threads(id),
 archived boolean NOT NULL,context_hash text NOT NULL,outcome jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cockpit_wa_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_wa_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.cockpit_wa_commands TO service_role;
CREATE TRIGGER cockpit_wa_commands_audit AFTER INSERT ON public.cockpit_wa_commands FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE TABLE public.cockpit_wa_reply_intents(
 id uuid PRIMARY KEY,app text NOT NULL CHECK(app IN('media-buyer','client-success','creative')),
 actor_id uuid NOT NULL REFERENCES auth.users(id),actor_email text NOT NULL,thread_id text NOT NULL REFERENCES public.wa_threads(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),context_hash text NOT NULL,context jsonb NOT NULL,
 claim_token uuid NOT NULL DEFAULT gen_random_uuid(),state text NOT NULL CHECK(state IN('intent','accepted','reconcile','failed','delivered')),
 provider_message_id text,receipt jsonb,error_code text,created_at timestamptz NOT NULL DEFAULT now(),accepted_at timestamptz,delivery_observed_at timestamptz
);
CREATE UNIQUE INDEX cockpit_wa_one_reply_context ON public.cockpit_wa_reply_intents(thread_id,context_hash) WHERE state IN('intent','accepted','reconcile','delivered');
CREATE TABLE public.cockpit_wa_provider_health(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,intent_id uuid NOT NULL REFERENCES public.cockpit_wa_reply_intents(id),
 provider text NOT NULL CHECK(provider='ghl'),method text NOT NULL,resource text NOT NULL,phase text NOT NULL CHECK(phase IN('intent','response','unknown')),
 http_status integer,object_id text,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cockpit_wa_reply_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_wa_provider_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_wa_reply_intents,public.cockpit_wa_provider_health FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_wa_reply_intents TO service_role;
GRANT SELECT,INSERT ON public.cockpit_wa_provider_health TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_wa_provider_health_id_seq TO service_role;
CREATE TRIGGER cockpit_wa_reply_intents_audit AFTER INSERT OR UPDATE ON public.cockpit_wa_reply_intents FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE TRIGGER cockpit_wa_provider_health_audit AFTER INSERT ON public.cockpit_wa_provider_health FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE TRIGGER cockpit_wa_threads_audit AFTER INSERT OR UPDATE OR DELETE ON public.wa_threads FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE TRIGGER cockpit_wa_messages_audit AFTER INSERT OR UPDATE OR DELETE ON public.wa_messages FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE TRIGGER cockpit_wa_drafts_audit AFTER INSERT OR UPDATE OR DELETE ON public.wa_drafts FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE TRIGGER cockpit_wa_state_audit AFTER INSERT OR UPDATE OR DELETE ON public.wa_state FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE FUNCTION public.cockpit_wa_actor(p_app text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_app IS NULL OR p_app NOT IN('media-buyer','client-success','creative') OR NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),p_app,NULL) THEN RAISE EXCEPTION 'A confirmed active cockpit seat is required for WhatsApp';END IF;
END $$;
CREATE FUNCTION public.cockpit_wa_context(p_uid uuid,p_app text,p_thread text,p_allow_archived boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.wa_threads; d public.wa_drafts; name text; full_scope boolean; desk text; matched bigint;
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
 RETURN jsonb_build_object('threadId',t.id,'contactId',t.contact_id,'locationId',t.location_id,'providerId',t.provider_id,'desk',t.desk,'clientName',name,'archived',t.archived,'lastInboundAt',t.last_inbound_at,'lastOutboundAt',t.last_outbound_at,'lastAt',t.last_at,'draftedAt',d.drafted_at,'basedOn',d.based_on);
END $$;
CREATE FUNCTION public.cockpit_wa_reply_context(p_app text,p_thread text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb;
BEGIN
 PERFORM public.cockpit_wa_actor(p_app);ctx:=public.cockpit_wa_context(auth.uid(),p_app,p_thread);
 RETURN jsonb_build_object('contextKey',md5(ctx::text),'sendSupported',nullif(ctx->>'providerId','') IS NOT NULL,'note',CASE WHEN nullif(ctx->>'providerId','') IS NULL THEN 'The custom WhatsApp provider is missing. Refresh the native inbox before replying.' END);
END $$;
CREATE FUNCTION public.cockpit_wa_reply_begin(p_app text,p_thread text,p_body text,p_context_key text,p_request_id uuid,p_apply boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb;r public.cockpit_wa_reply_intents;email text;
BEGIN
 PERFORM public.cockpit_wa_actor(p_app);
 IF p_request_id IS NULL OR p_body IS NULL OR length(p_body) NOT BETWEEN 1 AND 4000 OR nullif(btrim(p_body),'') IS NULL THEN RAISE EXCEPTION 'Enter a reply and retain its original request ID';END IF;
 IF NOT p_apply THEN PERFORM public.cockpit_wa_context(auth.uid(),p_app,p_thread);RETURN jsonb_build_object('ok',false,'dryRun',true);END IF;
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
 SELECT u.email INTO email FROM auth.users u WHERE u.id=auth.uid();
 INSERT INTO public.cockpit_wa_reply_intents(id,app,actor_id,actor_email,thread_id,body,context_hash,context,state) VALUES(p_request_id,p_app,auth.uid(),email,p_thread,p_body,p_context_key,ctx,'intent') RETURNING * INTO r;
 RETURN jsonb_build_object('state','new','id',r.id,'claimToken',r.claim_token,'context',ctx);
END $$;
CREATE FUNCTION public.cockpit_wa_reply_guard(p_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_wa_reply_intents;ctx jsonb;
BEGIN
 SELECT * INTO r FROM public.cockpit_wa_reply_intents WHERE id=p_id AND claim_token=p_token AND state='intent' AND created_at>now()-interval '5 minutes' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The original WhatsApp intent is no longer current';END IF;
 ctx:=public.cockpit_wa_context(r.actor_id,r.app,r.thread_id);
 IF md5(ctx::text)<>r.context_hash THEN RAISE EXCEPTION 'The conversation or provider mapping changed before sending';END IF;
 RETURN jsonb_build_object('id',r.id,'context',ctx,'body',r.body);
END $$;
CREATE FUNCTION public.cockpit_wa_health(p_id uuid,p_token uuid,p_receipt jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_wa_reply_intents WHERE id=p_id AND claim_token=p_token) THEN RAISE EXCEPTION 'Unknown WhatsApp intent';END IF;
 IF p_receipt->>'provider'<>'ghl' OR p_receipt->>'phase' NOT IN('intent','response','unknown') OR p_receipt->>'method' NOT IN('GET','POST') OR p_receipt->>'resource' NOT LIKE 'conversations/messages%' THEN RAISE EXCEPTION 'Invalid WhatsApp provider health receipt';END IF;
 INSERT INTO public.cockpit_wa_provider_health(intent_id,provider,method,resource,phase,http_status,object_id) VALUES(p_id,'ghl',p_receipt->>'method',p_receipt->>'resource',p_receipt->>'phase',nullif(p_receipt->>'http_status','')::integer,p_receipt->>'object_id');
END $$;
CREATE FUNCTION public.cockpit_wa_reply_accepted(p_id uuid,p_token uuid,p_receipt jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_wa_reply_intents;current_ctx jsonb;same_context boolean:=false;
BEGIN
 SELECT * INTO r FROM public.cockpit_wa_reply_intents WHERE id=p_id AND claim_token=p_token FOR UPDATE;
 IF NOT FOUND OR r.state NOT IN('intent','accepted','reconcile') THEN RAISE EXCEPTION 'Unknown or settled WhatsApp intent';END IF;
 IF coalesce(p_receipt->>'conversationId','')!~'^[A-Za-z0-9_-]{1,100}$' OR coalesce(p_receipt->>'messageId','')!~'^[A-Za-z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'Structured GHL accepted-message identifiers are required';END IF;
 IF r.receipt IS NOT NULL THEN IF r.receipt<>p_receipt THEN RAISE EXCEPTION 'A different provider receipt is already recorded';END IF;RETURN r.receipt;END IF;
 -- The external effect may already exist after revocation. Retain its real receipt
 -- privately, but do not publish it into a changed or unauthorized thread.
 BEGIN current_ctx:=public.cockpit_wa_context(r.actor_id,r.app,r.thread_id);same_context:=md5(current_ctx::text)=r.context_hash AND p_receipt->>'conversationId'=r.thread_id AND NOT EXISTS(SELECT 1 FROM public.wa_messages m WHERE m.id=p_receipt->>'messageId' AND (m.thread_id<>r.thread_id OR m.direction<>'outbound'));EXCEPTION WHEN OTHERS THEN same_context:=false;END;
 UPDATE public.cockpit_wa_reply_intents SET state=CASE WHEN same_context THEN 'accepted' ELSE 'reconcile' END,provider_message_id=p_receipt->>'messageId',receipt=p_receipt,accepted_at=now(),error_code=CASE WHEN p_receipt->>'conversationId'<>r.thread_id THEN 'provider_conversation_mismatch' WHEN NOT same_context THEN 'context_changed_after_acceptance' END WHERE id=r.id;
 IF same_context THEN
  INSERT INTO public.wa_messages(id,thread_id,direction,body,kind,speaker,at,delivery_status) VALUES(p_receipt->>'messageId',r.thread_id,'outbound',r.body,'text',r.actor_email,now(),'pending') ON CONFLICT(id) DO NOTHING;
  UPDATE public.wa_drafts SET submitted_at=now(),submitted_by=r.actor_email WHERE thread_id=r.thread_id;
 END IF;
 RETURN jsonb_build_object('id',r.id,'state',CASE WHEN same_context THEN 'accepted' ELSE 'reconcile' END,'providerMessageId',p_receipt->>'messageId','deliveryConfirmed',false);
END $$;
CREATE FUNCTION public.cockpit_wa_reply_failed(p_id uuid,p_token uuid,p_unknown boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.cockpit_wa_reply_intents SET state=CASE WHEN p_unknown THEN 'reconcile' ELSE 'failed' END,error_code=CASE WHEN p_unknown THEN 'provider_outcome_unknown' ELSE 'request_not_sent' END WHERE id=p_id AND claim_token=p_token AND state='intent';
 IF NOT FOUND THEN RAISE EXCEPTION 'The original WhatsApp intent is not available';END IF;
END $$;
CREATE FUNCTION public.cockpit_wa_delivery_observed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_wa_reply_intents;
BEGIN
 IF NEW.delivery_status IS NULL OR NEW.delivery_status NOT IN('delivered','read') THEN RETURN NEW;END IF;
 SELECT * INTO r FROM public.cockpit_wa_reply_intents WHERE provider_message_id=NEW.id AND thread_id=NEW.thread_id AND state='accepted' FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW;END IF;
 UPDATE public.cockpit_wa_reply_intents SET state='delivered',delivery_observed_at=now() WHERE id=r.id;
 UPDATE public.wa_drafts SET sent_at=now(),sent_by=r.actor_email,sent_body=r.body WHERE thread_id=r.thread_id AND drafted_at IS NOT DISTINCT FROM (r.context->>'draftedAt')::timestamptz AND NOT EXISTS(SELECT 1 FROM public.wa_threads t WHERE t.id=r.thread_id AND t.last_inbound_at>r.created_at);
 UPDATE public.wa_threads SET awaiting_us=false,last_outbound_at=NEW.at WHERE id=r.thread_id AND (last_inbound_at IS NULL OR last_inbound_at<=r.created_at);
 RETURN NEW;
END $$;
CREATE TRIGGER cockpit_wa_delivery_observed AFTER INSERT OR UPDATE OF delivery_status ON public.wa_messages FOR EACH ROW EXECUTE FUNCTION public.cockpit_wa_delivery_observed();
CREATE FUNCTION public.cockpit_wa_inbox(p_app text,p_waiting_only boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE connection public.cockpit_wa_connections; scan public.wa_state; full_scope boolean; rows jsonb; ready boolean; note text; roster_ready boolean;
BEGIN
 PERFORM public.cockpit_wa_actor(p_app);
 SELECT * INTO connection FROM public.cockpit_wa_connections WHERE app=p_app;
 IF connection.enabled IS DISTINCT FROM true THEN RETURN jsonb_build_object('configured',false,'ready',false,'sourceNote',coalesce(connection.source_note,'WhatsApp is not configured for this desk.'),'syncedAt',NULL,'totalAwaiting',NULL,'threads','[]'::jsonb);END IF;
 SELECT * INTO scan FROM public.wa_state WHERE location_id=connection.location_id;
 ready:=scan.last_scan IS NOT NULL AND scan.last_scan>now()-interval '20 minutes';
 IF NOT ready THEN note:='WhatsApp has not synced within 20 minutes. Refresh the native inbox before relying on an empty list.';END IF;
 SELECT ('admin'=ANY(m.roles) OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com') OR cardinality(m.clients)=0) INTO full_scope FROM public.cockpit_members m WHERE m.auth_user_id=auth.uid();
 SELECT f.ready AND f.source_snapshot_at IS NOT NULL AND f.row_count=(SELECT count(*) FROM public.cockpit_csm_sources WHERE table_name='clients') AND NOT EXISTS(SELECT 1 FROM public.cockpit_csm_sources s WHERE s.table_name='clients' AND s.source_snapshot_at<>f.source_snapshot_at) INTO roster_ready FROM public.cockpit_csm_source_state f WHERE f.table_name='clients';
 IF NOT full_scope AND roster_ready IS DISTINCT FROM true THEN ready:=false;note:='The verified client roster is unavailable. Refresh it before reading this WhatsApp desk.';END IF;
 WITH visible AS MATERIALIZED(
  SELECT t.*,mapped.name client_name FROM public.wa_threads t
  LEFT JOIN LATERAL(SELECT CASE WHEN count(*)=1 THEN max(s.data->>'name') END name FROM public.cockpit_csm_sources s JOIN public.cockpit_csm_source_state f ON f.table_name=s.table_name AND f.source_snapshot_at=s.source_snapshot_at WHERE s.table_name='clients' AND f.ready AND s.data->>'taskId'=t.client_task_id) mapped ON true
  WHERE t.desk=connection.desk AND t.location_id=connection.location_id AND NOT t.archived AND (NOT p_waiting_only OR t.awaiting_us)
   AND (full_scope OR (roster_ready AND mapped.name IS NOT NULL AND public.cockpit_ask_ai_owner_allowed(auth.uid(),p_app,mapped.name)))
 ),scoped AS MATERIALIZED(SELECT t.*,md5(public.cockpit_wa_context(auth.uid(),p_app,t.id)::text) context_key FROM visible t)
 SELECT coalesce(jsonb_agg((to_jsonb(t)-'context_key')||jsonb_build_object(
  'contextKey',t.context_key,
  'sendSupported',nullif(t.provider_id,'') IS NOT NULL AND ready AND NOT EXISTS(SELECT 1 FROM public.cockpit_wa_reply_intents r WHERE r.thread_id=t.id AND r.context_hash=t.context_key AND r.state IN('intent','accepted','reconcile','delivered')),
  'draft',(SELECT to_jsonb(d) FROM public.wa_drafts d WHERE d.thread_id=t.id),
  'messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.at) FROM(SELECT * FROM public.wa_messages WHERE thread_id=t.id ORDER BY at DESC LIMIT 14) m),'[]'),
  'replyState',(SELECT state FROM public.cockpit_wa_reply_intents WHERE thread_id=t.id AND context_hash=t.context_key ORDER BY created_at DESC LIMIT 1)
 ) ORDER BY t.last_inbound_at),'[]') INTO rows FROM scoped t;
 RETURN jsonb_build_object('configured',true,'ready',ready,'sourceNote',note,'syncedAt',CASE WHEN scan.last_scan IS NOT NULL THEN extract(epoch FROM scan.last_scan)*1000 END,'totalAwaiting',CASE WHEN ready THEN (SELECT count(*) FROM jsonb_array_elements(rows) t WHERE t->'awaiting_us'='true'::jsonb) END,'threads',rows);
END $$;
CREATE FUNCTION public.cockpit_comms_overview(p_app text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE calendars jsonb; inbox jsonb; threads jsonb;
BEGIN
 calendars:=public.cockpit_calendar_overview(p_app);inbox:=public.cockpit_wa_inbox(p_app,false);
 SELECT coalesce(jsonb_agg(jsonb_build_object('chatId',t->>'id','name',coalesce(t->>'contact_name',t->>'phone','Unknown'),'clientName',t->>'client_name','isGroup',t->'is_group','waitingSince',CASE WHEN t->'awaiting_us'='true'::jsonb AND t->>'last_inbound_at' IS NOT NULL THEN extract(epoch FROM (t->>'last_inbound_at')::timestamptz)*1000 END,'lastAt',CASE WHEN t->>'last_at' IS NOT NULL THEN extract(epoch FROM (t->>'last_at')::timestamptz)*1000 END,'silentDays',CASE WHEN t->>'last_at' IS NOT NULL THEN greatest(0,floor(extract(epoch FROM now()-(t->>'last_at')::timestamptz)/86400)) END,'draft',coalesce(t->'draft'->>'en',t->'draft'->>'ar'),'contextKey',t->>'contextKey','sendSupported',t->'sendSupported','replyState',t->'replyState','recent',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',extract(epoch FROM (m->>'at')::timestamptz)*1000,'who',m->>'speaker','text',m->>'body','fromMe',m->>'direction'='outbound','deliveryStatus',m->>'delivery_status')),'[]') FROM jsonb_array_elements(t->'messages') m))),'[]') INTO threads FROM jsonb_array_elements(inbox->'threads') t;
 RETURN calendars||jsonb_build_object('threads',threads,'whatsappConfigured',inbox->'configured','whatsappReady',inbox->'ready','whatsappNote',inbox->'sourceNote','whatsappSyncedAt',inbox->'syncedAt');
END $$;
CREATE FUNCTION public.cockpit_wa_archive(p_app text,p_thread text,p_archived boolean,p_context_key text,p_request_id uuid,p_apply boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.cockpit_wa_commands;outcome jsonb;ctx jsonb;
BEGIN
 PERFORM public.cockpit_wa_actor(p_app);PERFORM public.cockpit_wa_context(auth.uid(),p_app,p_thread,true);
 IF p_request_id IS NULL OR p_archived IS NULL THEN RAISE EXCEPTION 'Retain the original archive request ID';END IF;
 IF NOT p_apply THEN RETURN jsonb_build_object('ok',false,'dryRun',true);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO receipt FROM public.cockpit_wa_commands WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN IF receipt.app<>p_app OR receipt.actor_id<>auth.uid() OR receipt.thread_id<>p_thread OR receipt.archived<>p_archived OR receipt.context_hash<>p_context_key THEN RAISE EXCEPTION 'Archive ID already used for different inputs';END IF;RETURN receipt.outcome;END IF;
 PERFORM 1 FROM public.wa_threads WHERE id=p_thread FOR UPDATE;
 ctx:=public.cockpit_wa_context(auth.uid(),p_app,p_thread,true);
 IF md5(ctx::text) IS DISTINCT FROM p_context_key THEN RAISE EXCEPTION 'The conversation changed. Review it before making a new archive request';END IF;
 UPDATE public.wa_threads SET archived=p_archived,updated_at=now() WHERE id=p_thread;
 outcome:=jsonb_build_object('ok',true,'id',p_request_id);
 INSERT INTO public.cockpit_wa_commands(id,app,actor_id,thread_id,archived,context_hash,outcome) VALUES(p_request_id,p_app,auth.uid(),p_thread,p_archived,p_context_key,outcome);RETURN outcome;
END $$;
CREATE FUNCTION public.cockpit_wa_worker_thread(p_thread jsonb,p_messages jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.wa_threads; msg jsonb; cid text:=p_thread->>'id'; inbound_at timestamptz;outbound_at timestamptz;v_last_at timestamptz;
BEGIN
 IF nullif(cid,'') IS NULL OR nullif(p_thread->>'contact_id','') IS NULL OR jsonb_typeof(p_messages) IS DISTINCT FROM 'array'
  OR NOT EXISTS(SELECT 1 FROM public.cockpit_wa_connections c WHERE c.app='client-success' AND c.enabled AND c.location_id=p_thread->>'location_id' AND c.desk='csm') THEN RAISE EXCEPTION 'The provider thread does not belong to the configured CSM location';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wa-thread:'||cid,0));
 SELECT * INTO old FROM public.wa_threads WHERE id=cid FOR UPDATE;
 IF FOUND AND (old.location_id IS DISTINCT FROM p_thread->>'location_id' OR old.contact_id IS DISTINCT FROM p_thread->>'contact_id' OR old.desk<>'csm') THEN RAISE EXCEPTION 'The original conversation identity or desk changed';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_messages) m GROUP BY m->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'The provider message window contains duplicate identities';END IF;
 INSERT INTO public.wa_threads(id,location_id,contact_id,contact_name,phone,is_group,provider_id,desk)
 VALUES(cid,p_thread->>'location_id',p_thread->>'contact_id',p_thread->>'contact_name',p_thread->>'phone',coalesce((p_thread->>'is_group')::boolean,false),coalesce(p_thread->>'provider_id',old.provider_id),'csm')
 ON CONFLICT(id) DO UPDATE SET contact_name=excluded.contact_name,phone=excluded.phone,is_group=excluded.is_group,provider_id=coalesce(excluded.provider_id,wa_threads.provider_id),updated_at=now();
 FOR msg IN SELECT value FROM jsonb_array_elements(p_messages) LOOP
  IF nullif(msg->>'id','') IS NULL OR msg->>'thread_id' IS DISTINCT FROM cid OR msg->>'direction' NOT IN('inbound','outbound')
   OR nullif(msg->>'at','') IS NULL OR (msg->>'at')::timestamptz<'2026-09-20T00:00:00Z'::timestamptz
   OR EXISTS(SELECT 1 FROM public.wa_messages m WHERE m.id=msg->>'id' AND m.thread_id<>cid) THEN RAISE EXCEPTION 'The original message identity or switch-on boundary is invalid';END IF;
  INSERT INTO public.wa_messages(id,thread_id,direction,body,kind,speaker,at,delivery_status)
  VALUES(msg->>'id',cid,msg->>'direction',msg->>'body',msg->>'kind',msg->>'speaker',(msg->>'at')::timestamptz,msg->>'delivery_status')
  ON CONFLICT(id) DO UPDATE SET body=excluded.body,kind=excluded.kind,speaker=excluded.speaker,
   delivery_status=CASE WHEN wa_messages.delivery_status='read' OR (wa_messages.delivery_status='delivered' AND coalesce(excluded.delivery_status,'')<>'read') THEN wa_messages.delivery_status ELSE coalesce(excluded.delivery_status,wa_messages.delivery_status) END;
 END LOOP;
 SELECT max(at) FILTER(WHERE direction='inbound' AND coalesce(speaker,'')!~*'mahara'),
  max(at) FILTER(WHERE (direction='inbound' AND coalesce(speaker,'')~*'mahara') OR (direction='outbound' AND delivery_status IN('delivered','read'))),max(at)
 INTO inbound_at,outbound_at,v_last_at FROM public.wa_messages WHERE thread_id=cid AND at>='2026-09-20T00:00:00Z'::timestamptz;
 UPDATE public.wa_threads SET last_inbound_at=inbound_at,last_outbound_at=outbound_at,last_at=v_last_at,
  awaiting_us=inbound_at IS NOT NULL AND (outbound_at IS NULL OR inbound_at>outbound_at),updated_at=now() WHERE id=cid;
 RETURN jsonb_array_length(p_messages);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_wa_worker_thread(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_wa_worker_thread(jsonb,jsonb) TO service_role;
CREATE FUNCTION public.cockpit_wa_worker_draft(p_thread text,p_inbound_at timestamptz,p_previous_drafted_at timestamptz,p_draft jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.wa_threads;d public.wa_drafts;
BEGIN
 SELECT * INTO t FROM public.wa_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND OR t.archived OR NOT t.awaiting_us OR t.last_inbound_at IS DISTINCT FROM p_inbound_at
  OR NOT EXISTS(SELECT 1 FROM public.cockpit_wa_connections c WHERE c.app='client-success' AND c.enabled AND c.location_id=t.location_id AND c.desk=t.desk) THEN RETURN false;END IF;
 SELECT * INTO d FROM public.wa_drafts WHERE thread_id=p_thread FOR UPDATE;
 IF d.drafted_at IS DISTINCT FROM p_previous_drafted_at OR (d.drafted_at IS NOT NULL AND d.drafted_at>=p_inbound_at)
  OR EXISTS(SELECT 1 FROM public.cockpit_wa_reply_intents r WHERE r.thread_id=p_thread AND r.created_at>=p_inbound_at AND r.state IN('intent','accepted','reconcile')) THEN RETURN false;END IF;
 IF jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR p_draft-ARRAY['ar','en','why','based_on','model']<>'{}'::jsonb
  OR p_draft->>'model' NOT IN('none','deepseek-chat') OR (nullif(p_draft->>'ar','') IS NULL AND nullif(p_draft->>'en','') IS NULL AND p_draft->>'model'<>'none') THEN RAISE EXCEPTION 'The generated draft is invalid';END IF;
 INSERT INTO public.wa_drafts(thread_id,ar,en,why,based_on,model,drafted_at)
 VALUES(p_thread,p_draft->>'ar',p_draft->>'en',p_draft->>'why',p_draft->>'based_on',p_draft->>'model',now())
 ON CONFLICT(thread_id) DO UPDATE SET ar=excluded.ar,en=excluded.en,why=excluded.why,based_on=excluded.based_on,model=excluded.model,drafted_at=excluded.drafted_at,
  sent_at=NULL,sent_by=NULL,sent_lang=NULL,sent_body=NULL,submitted_at=NULL,submitted_by=NULL;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_wa_worker_draft(text,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_wa_worker_draft(text,timestamptz,timestamptz,jsonb) TO service_role;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('cockpit_wa_actor','cockpit_wa_context','cockpit_wa_reply_context','cockpit_wa_reply_begin','cockpit_wa_reply_guard','cockpit_wa_health','cockpit_wa_reply_accepted','cockpit_wa_reply_failed','cockpit_wa_delivery_observed','cockpit_wa_inbox','cockpit_comms_overview','cockpit_wa_archive') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.signature::text LIKE '%cockpit_wa_reply_context(%' OR f.signature::text LIKE '%cockpit_wa_reply_begin(%' OR f.signature::text LIKE '%cockpit_wa_inbox(%' OR f.signature::text LIKE '%cockpit_comms_overview(%' OR f.signature::text LIKE '%cockpit_wa_archive(%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
  ELSIF f.signature::text LIKE '%cockpit_wa_reply_guard(%' OR f.signature::text LIKE '%cockpit_wa_health(%' OR f.signature::text LIKE '%cockpit_wa_reply_accepted(%' OR f.signature::text LIKE '%cockpit_wa_reply_failed(%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);END IF;
 END LOOP;
END $$;
COMMIT;
