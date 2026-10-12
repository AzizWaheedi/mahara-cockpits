-- WhatsApp chats belong to clients, and the client tab shows the day (2026-10-12).
--
-- Live before this migration: 0 of 148 wa_threads carry client_task_id, so a
-- client's page cannot show its chats and a seat limited to some clients sees
-- none of them. The inbox worker's upsert (cockpit_wa_worker_thread, live body
-- from 20261008e, checked 2026-10-12) never writes client_task_id, so a link
-- survives every 15-minute sync.
--
-- 1. cockpit_wa_link_thread links or unlinks one chat to a client. It is a dry
--    run unless p_apply, needs client success access to that client
--    (cockpit_csm_client_gate) and a seat that can already open the chat as it
--    is mapped now, so a seat limited to some clients cannot claim another
--    client's chat. A chat linked to another client is unlinked there first.
--    Applying writes one cockpit_audit_log row (entity_type wa_thread_link)
--    whose metadata keeps the request ID, so a retried request returns its
--    first outcome and a reused ID with other inputs is refused.
-- 2. cockpit_csm_wa_link_candidates lists what could be linked. GoHighLevel's
--    contact for a client is found by the cockpit (checkIns.contact, Client ID
--    field Csj6vsVH3wSRseT3OkMU), not by the database, so the browser passes
--    that contact's ID and phone. 1-to-1 chats match on contact ID, then on
--    the last 8 digits of the phone. Group chats active in the last 30 days
--    and not yet linked are listed for a pick by hand.
-- 3. cockpit_csm_client_whatsapp reads one client's linked chats from the
--    mirror (no GoHighLevel call): messages since Kuwait midnight plus the 14
--    before, the draft, the reply state and the contextKey that
--    comms.sendReply needs. A scan older than 20 minutes is said in plain
--    words, because an empty day is then not proof of a quiet day.
BEGIN;

CREATE INDEX IF NOT EXISTS wa_threads_client_task ON public.wa_threads(client_task_id) WHERE client_task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cockpit_wa_link_thread(p_thread text,p_task_id text,p_request_id uuid,p_apply boolean DEFAULT false,p_unlink boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE gate jsonb;t public.wa_threads;prior public.cockpit_audit_log;target text;preview jsonb;outcome jsonb;
BEGIN
 PERFORM public.cockpit_wa_actor('client-success');
 gate:=public.cockpit_csm_client_gate(p_task_id);
 IF p_request_id IS NULL OR p_apply IS NULL OR p_unlink IS NULL THEN RAISE EXCEPTION 'Retain the original link request ID';END IF;
 PERFORM public.cockpit_wa_context(auth.uid(),'client-success',p_thread,true);
 IF p_apply THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('wa-link:'||p_request_id::text,0));
  SELECT * INTO prior FROM public.cockpit_audit_log a WHERE a.entity_type='wa_thread_link' AND a.metadata->>'requestId'=p_request_id::text ORDER BY a.created_at LIMIT 1;
  IF FOUND THEN
   IF prior.metadata->>'actorId' IS DISTINCT FROM auth.uid()::text OR prior.entity_id IS DISTINCT FROM p_thread OR prior.metadata->>'taskId' IS DISTINCT FROM p_task_id OR (prior.metadata->>'unlink')::boolean IS DISTINCT FROM p_unlink THEN RAISE EXCEPTION 'Link ID already used for different inputs';END IF;
   RETURN prior.metadata->'outcome';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa-thread:'||p_thread,0));
 END IF;
 SELECT * INTO t FROM public.wa_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The WhatsApp thread is unavailable';END IF;
 IF p_unlink AND t.client_task_id IS DISTINCT FROM p_task_id THEN RAISE EXCEPTION 'This chat is not linked to this client';END IF;
 IF NOT p_unlink AND t.client_task_id IS NOT NULL AND t.client_task_id<>p_task_id THEN RAISE EXCEPTION 'This chat is linked to another client. Unlink it there first';END IF;
 target:=CASE WHEN p_unlink THEN NULL ELSE p_task_id END;
 preview:=jsonb_build_object('threadId',t.id,'taskId',p_task_id,'clientName',gate->>'clientName','name',coalesce(t.contact_name,t.phone,'Unknown'),'isGroup',t.is_group,'linked',NOT p_unlink,'changed',t.client_task_id IS DISTINCT FROM target);
 IF NOT p_apply THEN RETURN preview||jsonb_build_object('ok',false,'dryRun',true);END IF;
 IF t.client_task_id IS DISTINCT FROM target THEN UPDATE public.wa_threads SET client_task_id=target,updated_at=now() WHERE id=t.id;END IF;
 outcome:=preview||jsonb_build_object('ok',true,'id',p_request_id);
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after",metadata)
 VALUES(CASE WHEN p_unlink THEN 'wa_thread_unlink' ELSE 'wa_thread_link' END,'wa_thread_link',t.id,gate->>'email','client-success','supabase',
  jsonb_build_object('client_task_id',t.client_task_id),jsonb_build_object('client_task_id',target),
  jsonb_build_object('requestId',p_request_id,'actorId',auth.uid(),'taskId',p_task_id,'unlink',p_unlink,'outcome',outcome));
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_wa_link_thread(text,text,uuid,boolean,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_wa_link_thread(text,text,uuid,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_csm_wa_link_candidates(p_task_id text,p_contact_id text DEFAULT NULL,p_phone text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE gate jsonb;connection public.cockpit_wa_connections;full_scope boolean;digits text;linked jsonb;matches jsonb;groups jsonb;
BEGIN
 PERFORM public.cockpit_wa_actor('client-success');
 gate:=public.cockpit_csm_client_gate(p_task_id);
 IF p_contact_id IS NOT NULL AND p_contact_id!~'^[A-Za-z0-9_-]{1,64}$' THEN RAISE EXCEPTION 'Choose a valid GoHighLevel contact';END IF;
 digits:=right(regexp_replace(coalesce(p_phone,''),'\D','','g'),8);
 IF length(digits)<8 THEN digits:=NULL;END IF;
 SELECT * INTO connection FROM public.cockpit_wa_connections WHERE app='client-success';
 IF connection.enabled IS DISTINCT FROM true THEN RETURN jsonb_build_object('configured',false,'taskId',p_task_id,'clientName',gate->>'clientName','fullScope',false,'linked','[]'::jsonb,'matches','[]'::jsonb,'groups','[]'::jsonb,'note',coalesce(connection.source_note,'WhatsApp is not configured for client success.'));END IF;
 SELECT ('admin'=ANY(m.roles) OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com') OR cardinality(m.clients)=0) INTO full_scope FROM public.cockpit_members m WHERE m.auth_user_id=auth.uid();
 full_scope:=coalesce(full_scope,false);
 WITH base AS MATERIALIZED(
  SELECT t.*,regexp_replace(coalesce(t.phone,''),'\D','','g') phone_digits FROM public.wa_threads t WHERE t.desk=connection.desk AND t.location_id=connection.location_id
 ),shaped AS(
  SELECT b.*,jsonb_build_object('threadId',b.id,'name',coalesce(b.contact_name,'Unknown'),'phoneLast4',nullif(right(b.phone_digits,4),''),'isGroup',b.is_group,'archived',b.archived,'awaitingUs',b.awaiting_us,
   'lastAt',CASE WHEN b.last_at IS NOT NULL THEN (extract(epoch FROM b.last_at)*1000)::bigint END) card FROM base b
 )
 SELECT
  (SELECT coalesce(jsonb_agg(s.card ORDER BY s.last_at DESC NULLS LAST),'[]') FROM shaped s WHERE s.client_task_id=p_task_id),
  (SELECT coalesce(jsonb_agg(s.card||jsonb_build_object('match',CASE WHEN s.contact_id=p_contact_id THEN 'contact' ELSE 'phone' END,'linkedElsewhere',s.client_task_id IS NOT NULL)
    ORDER BY (s.contact_id=p_contact_id) DESC,s.last_at DESC NULLS LAST),'[]') FROM shaped s
    WHERE full_scope AND NOT s.is_group AND NOT s.archived AND s.client_task_id IS DISTINCT FROM p_task_id
     AND ((p_contact_id IS NOT NULL AND s.contact_id=p_contact_id) OR (digits IS NOT NULL AND right(s.phone_digits,8)=digits))),
  (SELECT coalesce(jsonb_agg(g.card ORDER BY g.last_at DESC NULLS LAST),'[]') FROM(
    SELECT s.card,s.last_at FROM shaped s WHERE full_scope AND s.is_group AND NOT s.archived AND s.client_task_id IS NULL AND s.last_at>now()-interval '30 days' ORDER BY s.last_at DESC LIMIT 100) g)
 INTO linked,matches,groups;
 RETURN jsonb_build_object('configured',true,'taskId',p_task_id,'clientName',gate->>'clientName','fullScope',full_scope,'linked',linked,'matches',matches,'groups',groups,
  'note',CASE WHEN NOT full_scope THEN 'Only a seat that covers every client can link a new chat. Ask the head of client success to link it.' WHEN p_contact_id IS NULL AND digits IS NULL THEN 'Find the client''s GoHighLevel contact first, so their own chat can be suggested.' END);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_wa_link_candidates(text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_wa_link_candidates(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_csm_client_whatsapp(p_task_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE gate jsonb;connection public.cockpit_wa_connections;scan public.wa_state;stale boolean;note text;day_start timestamptz;rows jsonb;
BEGIN
 PERFORM public.cockpit_wa_actor('client-success');
 gate:=public.cockpit_csm_client_gate(p_task_id);
 day_start:=date_trunc('day',now() AT TIME ZONE 'Asia/Kuwait') AT TIME ZONE 'Asia/Kuwait';
 SELECT * INTO connection FROM public.cockpit_wa_connections WHERE app='client-success';
 IF connection.enabled IS DISTINCT FROM true THEN RETURN jsonb_build_object('configured',false,'ready',false,'stale',true,'syncedAt',NULL,'note',coalesce(connection.source_note,'WhatsApp is not configured for client success.'),'dayStart',(extract(epoch FROM day_start)*1000)::bigint,'taskId',p_task_id,'clientName',gate->>'clientName','threads','[]'::jsonb);END IF;
 SELECT * INTO scan FROM public.wa_state WHERE location_id=connection.location_id;
 stale:=scan.last_scan IS NULL OR scan.last_scan<=now()-interval '20 minutes';
 IF stale THEN note:=CASE WHEN scan.last_scan IS NULL THEN 'WhatsApp has not synced yet, so an empty day is not proof.'
  ELSE 'WhatsApp has not synced since '||to_char(scan.last_scan AT TIME ZONE 'Asia/Kuwait',CASE WHEN scan.last_scan>=day_start THEN 'HH24:MI' ELSE 'DD Mon HH24:MI' END)||', so an empty day is not proof.' END;END IF;
 WITH linked AS MATERIALIZED(
  SELECT t.*,CASE WHEN NOT t.archived THEN md5(public.cockpit_wa_context(auth.uid(),'client-success',t.id)::text) END context_key FROM public.wa_threads t
  WHERE t.client_task_id=p_task_id AND t.desk=connection.desk AND t.location_id=connection.location_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'threadId',t.id,'name',coalesce(t.contact_name,t.phone,'Unknown'),'isGroup',t.is_group,'archived',t.archived,'awaitingUs',t.awaiting_us,
  'lastInboundAt',CASE WHEN t.last_inbound_at IS NOT NULL THEN (extract(epoch FROM t.last_inbound_at)*1000)::bigint END,
  'lastAt',CASE WHEN t.last_at IS NOT NULL THEN (extract(epoch FROM t.last_at)*1000)::bigint END,
  'today',(SELECT jsonb_build_object('inbound',count(*) FILTER(WHERE m.direction='inbound'),'outbound',count(*) FILTER(WHERE m.direction='outbound')) FROM public.wa_messages m WHERE m.thread_id=t.id AND m.at>=day_start),
  'messages',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'direction',m.direction,'body',m.body,'kind',m.kind,'speaker',m.speaker,'at',(extract(epoch FROM m.at)*1000)::bigint,'status',m.delivery_status,'today',m.at>=day_start) ORDER BY m.at,m.id),'[]') FROM(
    (SELECT * FROM public.wa_messages WHERE thread_id=t.id AND at>=day_start ORDER BY at DESC LIMIT 200)
    UNION ALL
    (SELECT * FROM public.wa_messages WHERE thread_id=t.id AND at<day_start ORDER BY at DESC LIMIT 14)) m),
  'draft',(SELECT jsonb_build_object('ar',d.ar,'en',d.en,'why',d.why,'basedOn',d.based_on,
    'draftedAt',(extract(epoch FROM d.drafted_at)*1000)::bigint,
    'submittedAt',CASE WHEN d.submitted_at IS NOT NULL THEN (extract(epoch FROM d.submitted_at)*1000)::bigint END,
    'sentAt',CASE WHEN d.sent_at IS NOT NULL THEN (extract(epoch FROM d.sent_at)*1000)::bigint END) FROM public.wa_drafts d WHERE d.thread_id=t.id),
  'contextKey',t.context_key,
  'sendSupported',t.context_key IS NOT NULL AND nullif(t.provider_id,'') IS NOT NULL AND NOT stale AND NOT EXISTS(SELECT 1 FROM public.cockpit_wa_reply_intents r WHERE r.thread_id=t.id AND r.context_hash=t.context_key AND r.state IN('intent','accepted','reconcile','delivered')),
  'replyState',(SELECT r.state FROM public.cockpit_wa_reply_intents r WHERE r.thread_id=t.id AND r.context_hash=t.context_key ORDER BY r.created_at DESC LIMIT 1),
  'lastReply',(SELECT jsonb_build_object('id',r.id,'state',r.state,'at',(extract(epoch FROM r.created_at)*1000)::bigint) FROM public.cockpit_wa_reply_intents r WHERE r.thread_id=t.id ORDER BY r.created_at DESC LIMIT 1)
 ) ORDER BY t.archived,t.last_at DESC NULLS LAST),'[]') INTO rows FROM linked t;
 RETURN jsonb_build_object('configured',true,'ready',NOT stale,'stale',stale,
  'syncedAt',CASE WHEN scan.last_scan IS NOT NULL THEN (extract(epoch FROM scan.last_scan)*1000)::bigint END,
  'note',note,'dayStart',(extract(epoch FROM day_start)*1000)::bigint,'taskId',p_task_id,'clientName',gate->>'clientName','threads',rows);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_client_whatsapp(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_whatsapp(text) TO authenticated;

COMMIT;
