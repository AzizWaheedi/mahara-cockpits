BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_wa_worker_thread(p_thread jsonb,p_messages jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 old public.wa_threads;
 msg jsonb;
 cid text:=p_thread->>'id';
 inbound_at timestamptz;
 outbound_at timestamptz;
 v_last_at timestamptz;
 target_awaiting boolean;
BEGIN
 IF nullif(cid,'') IS NULL OR nullif(p_thread->>'contact_id','') IS NULL OR jsonb_typeof(p_messages) IS DISTINCT FROM 'array'
  OR NOT EXISTS(SELECT 1 FROM public.cockpit_wa_connections c WHERE c.app='client-success' AND c.enabled AND c.location_id=p_thread->>'location_id' AND c.desk='csm') THEN RAISE EXCEPTION 'The provider thread does not belong to the configured CSM location';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wa-thread:'||cid,0));
 SELECT * INTO old FROM public.wa_threads WHERE id=cid FOR UPDATE;
 IF FOUND AND (old.location_id IS DISTINCT FROM p_thread->>'location_id' OR old.contact_id IS DISTINCT FROM p_thread->>'contact_id' OR old.desk<>'csm') THEN RAISE EXCEPTION 'The original conversation identity or desk changed';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_messages) m GROUP BY m->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'The provider message window contains duplicate identities';END IF;
 INSERT INTO public.wa_threads(id,location_id,contact_id,contact_name,phone,is_group,provider_id,desk)
 VALUES(cid,p_thread->>'location_id',p_thread->>'contact_id',p_thread->>'contact_name',p_thread->>'phone',coalesce((p_thread->>'is_group')::boolean,false),coalesce(p_thread->>'provider_id',old.provider_id),'csm')
 ON CONFLICT(id) DO UPDATE SET contact_name=excluded.contact_name,phone=excluded.phone,is_group=excluded.is_group,provider_id=coalesce(excluded.provider_id,wa_threads.provider_id),updated_at=now()
 WHERE wa_threads.contact_name IS DISTINCT FROM excluded.contact_name
    OR wa_threads.phone IS DISTINCT FROM excluded.phone
    OR wa_threads.is_group IS DISTINCT FROM excluded.is_group
    OR (excluded.provider_id IS NOT NULL AND wa_threads.provider_id IS DISTINCT FROM excluded.provider_id);
 FOR msg IN SELECT value FROM jsonb_array_elements(p_messages) LOOP
  IF nullif(msg->>'id','') IS NULL OR msg->>'thread_id' IS DISTINCT FROM cid OR msg->>'direction' NOT IN('inbound','outbound')
   OR nullif(msg->>'at','') IS NULL OR (msg->>'at')::timestamptz<'2026-09-20T00:00:00Z'::timestamptz
   OR EXISTS(SELECT 1 FROM public.wa_messages m WHERE m.id=msg->>'id' AND m.thread_id<>cid) THEN RAISE EXCEPTION 'The original message identity or switch-on boundary is invalid';END IF;
  INSERT INTO public.wa_messages(id,thread_id,direction,body,kind,speaker,at,delivery_status)
  VALUES(msg->>'id',cid,msg->>'direction',msg->>'body',msg->>'kind',msg->>'speaker',(msg->>'at')::timestamptz,msg->>'delivery_status')
  ON CONFLICT(id) DO UPDATE SET body=excluded.body,kind=excluded.kind,speaker=excluded.speaker,
   delivery_status=CASE WHEN wa_messages.delivery_status='read' OR (wa_messages.delivery_status='delivered' AND coalesce(excluded.delivery_status,'')<>'read') THEN wa_messages.delivery_status ELSE coalesce(excluded.delivery_status,wa_messages.delivery_status) END
  WHERE wa_messages.body IS DISTINCT FROM excluded.body
     OR wa_messages.kind IS DISTINCT FROM excluded.kind
     OR wa_messages.speaker IS DISTINCT FROM excluded.speaker
     OR (
        (CASE WHEN wa_messages.delivery_status='read' OR (wa_messages.delivery_status='delivered' AND coalesce(excluded.delivery_status,'')<>'read') THEN wa_messages.delivery_status ELSE coalesce(excluded.delivery_status,wa_messages.delivery_status) END)
        IS DISTINCT FROM wa_messages.delivery_status
     );
 END LOOP;
 SELECT max(at) FILTER(WHERE direction='inbound' AND coalesce(speaker,'')!~*'mahara'),
  max(at) FILTER(WHERE (direction='inbound' AND coalesce(speaker,'')~*'mahara') OR (direction='outbound' AND delivery_status IN('delivered','read'))),max(at)
 INTO inbound_at,outbound_at,v_last_at FROM public.wa_messages WHERE thread_id=cid AND at>='2026-09-20T00:00:00Z'::timestamptz;
 target_awaiting:=inbound_at IS NOT NULL AND (outbound_at IS NULL OR inbound_at>outbound_at);
 UPDATE public.wa_threads SET last_inbound_at=inbound_at,last_outbound_at=outbound_at,last_at=v_last_at,
  awaiting_us=target_awaiting,updated_at=now()
 WHERE id=cid
   AND (
     wa_threads.last_inbound_at IS DISTINCT FROM inbound_at
     OR wa_threads.last_outbound_at IS DISTINCT FROM outbound_at
     OR wa_threads.last_at IS DISTINCT FROM v_last_at
     OR wa_threads.awaiting_us IS DISTINCT FROM target_awaiting
   );
 RETURN jsonb_array_length(p_messages);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_wa_worker_thread(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_wa_worker_thread(jsonb,jsonb) TO service_role;
COMMIT;
