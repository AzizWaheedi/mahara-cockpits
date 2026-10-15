-- Either current CSM or media buyer may decide within existing client access.
-- Existing row locks/version checks make the first decision final for both roles.
-- CREATE OR REPLACE preserves the restricted function grants. No seat changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_can_review(p_binding uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 JOIN public.cockpit_ad_billing_bindings b ON b.id=p_binding
 WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email))
 AND (m.roles&&ARRAY['admin','csm','media_buyer'] OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com'))
 AND (m.roles&&ARRAY['admin'] OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com') OR cardinality(m.clients)=0
 OR EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(b.client_name)))));
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_approved_delivery(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.cockpit_ad_billing_deliveries d JOIN public.cockpit_ad_billing_reviews r ON r.id=d.review_id
 JOIN public.cockpit_ad_billing_bindings b ON b.id=d.binding_id
 WHERE d.id=p_id AND r.binding_id=b.id AND r.state='approved' AND r.decided_at>now()-interval '24 hours'
 AND r.revision=b.revision AND r.signal=b.signal AND r.last_four IS NOT DISTINCT FROM b.last_four
 AND r.destination=b.whatsapp_group AND d.destination=r.destination AND d.body=r.body
 AND EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
  WHERE m.auth_user_id=r.actor_id AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email))
  AND (m.roles&&ARRAY['admin','csm','media_buyer'] OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com'))
  AND (m.roles&&ARRAY['admin'] OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com') OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(b.client_name)))))
 AND NOT EXISTS(SELECT 1 FROM public.cockpit_ad_billing_deliveries x WHERE x.binding_id=b.id AND x.channel='whatsapp' AND x.id<>d.id
  AND (x.state IN('sending','unknown') OR (x.state='accepted' AND x.updated_at>now()-interval '72 hours'))));
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_review_panel() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb; cfg public.cockpit_ad_billing_config; stamp timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id WHERE m.auth_user_id=auth.uid() AND m.active
 AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email)) AND (m.roles&&ARRAY['admin','csm','media_buyer'] OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com'))) THEN RAISE EXCEPTION 'Current billing reviewer access is required' USING ERRCODE='42501'; END IF;
 SELECT * INTO cfg FROM public.cockpit_ad_billing_config WHERE singleton;
 SELECT reviewed_at INTO stamp FROM public.cockpit_ad_billing_daily_reviews WHERE actor_id=auth.uid() AND review_day=(now() AT TIME ZONE 'Asia/Kuwait')::date;
 SELECT coalesce(jsonb_agg(jsonb_build_object('bindingId',b.id,'client',b.client_name,'clientTaskId',b.client_task_id,'accountId',b.account_id,
 'signal',b.signal,'error',b.error,'checkedAt',b.last_checked_at,'fresh',b.last_good_at>now()-interval '10 minutes' AND b.error IS NULL,
 'nextSendAt',CASE WHEN public.cockpit_ad_billing_next_send(b.id)='-infinity'::timestamptz THEN NULL ELSE public.cockpit_ad_billing_next_send(b.id)::text END,
 'review',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'version',r.version,'body',r.body,'state',r.state,'reason',r.reason,'createdAt',r.created_at,'actor',r.actor_email,'decidedAt',r.decided_at,
 'delivery',(SELECT jsonb_build_object('state',d.state,'at',d.updated_at,'error',d.error,'receipt',d.provider_id) FROM public.cockpit_ad_billing_deliveries d WHERE d.review_id=r.id AND d.channel='whatsapp')) END) ORDER BY b.client_name),'[]') INTO rows
 FROM public.cockpit_ad_billing_bindings b LEFT JOIN LATERAL(SELECT * FROM public.cockpit_ad_billing_reviews WHERE binding_id=b.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
 WHERE b.enabled AND public.cockpit_ad_billing_can_review(b.id) AND (b.signal IN('payment_grace','unsettled','restricted') OR b.error IS NOT NULL OR r.id IS NOT NULL);
 RETURN jsonb_build_object('apply',cfg.apply,'finishedAt',cfg.last_finished_at,'error',cfg.last_error,'dailyReviewedAt',stamp,'clients',rows);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_decide(p_id uuid,p_version integer,p_decision text,p_body text DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_ad_billing_reviews; b public.cockpit_ad_billing_bindings; mail text; approved_body text; d uuid;
BEGIN
 SELECT * INTO r FROM public.cockpit_ad_billing_reviews WHERE id=p_id;
 IF NOT FOUND OR NOT public.cockpit_ad_billing_can_review(r.binding_id) THEN RAISE EXCEPTION 'Current billing reviewer access is required' USING ERRCODE='42501'; END IF;
 -- Same lock order as observation and delivery gates.
 SELECT * INTO b FROM public.cockpit_ad_billing_bindings WHERE id=r.binding_id FOR UPDATE;
 SELECT * INTO r FROM public.cockpit_ad_billing_reviews WHERE id=p_id FOR UPDATE;
 IF r.state<>'pending' OR r.version<>p_version THEN RAISE EXCEPTION 'This review changed. Reload before deciding.'; END IF;
 IF NOT b.enabled OR NOT b.manual_cutover_verified OR b.error IS NOT NULL OR b.last_good_at IS NULL OR b.last_good_at<=now()-interval '10 minutes'
 OR b.revision<>r.revision OR b.signal<>r.signal OR b.last_four IS DISTINCT FROM r.last_four OR b.whatsapp_group<>r.destination
 OR r.created_at<=now()-interval '72 hours' THEN RAISE EXCEPTION 'A fresh matching source check is required'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN('approve','deny') THEN RAISE EXCEPTION 'Choose approve or deny'; END IF;
 SELECT email INTO mail FROM public.cockpit_members WHERE auth_user_id=auth.uid();
 IF p_decision='deny' THEN
  IF coalesce(length(btrim(p_reason)),0) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'A written denial reason (3–1000 characters) is required'; END IF;
  UPDATE public.cockpit_ad_billing_reviews SET state='denied',reason=btrim(p_reason),actor_id=auth.uid(),actor_email=mail,decided_at=now(),version=version+1 WHERE id=r.id;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.cockpit_ad_billing_config WHERE singleton AND apply) THEN RAISE EXCEPTION 'Delivery is paused'; END IF;
  IF public.cockpit_ad_billing_next_send(b.id)>now() THEN RAISE EXCEPTION 'Client message cooldown or unresolved delivery: do not send again yet'; END IF;
  approved_body:=coalesce(p_body,r.body);
  IF coalesce(length(btrim(approved_body)),0) NOT BETWEEN 10 AND 3000 THEN RAISE EXCEPTION 'Message must contain 10–3000 characters'; END IF;
  UPDATE public.cockpit_ad_billing_reviews SET state='approved',body=btrim(approved_body),actor_id=auth.uid(),actor_email=mail,decided_at=now(),version=version+1 WHERE id=r.id;
  INSERT INTO public.cockpit_ad_billing_deliveries(event_id,binding_id,revision,channel,destination,body,review_id)
  VALUES(r.event_id,b.id,b.revision,'whatsapp',r.destination,btrim(approved_body),r.id) RETURNING id INTO d;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata)
 VALUES('billing.'||p_decision,'ad_billing_review',r.id::text,mail,'client-success','supabase',jsonb_build_object('version',r.version,'edited',p_body IS NOT NULL AND p_body<>r.body,'reason',CASE WHEN p_decision='deny' THEN btrim(p_reason) END));
 PERFORM public.cockpit_ad_billing_refresh_cards(b.id);
 RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_refresh_cards(p_binding uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.cockpit_ad_billing_bindings; r public.cockpit_ad_billing_reviews; prior public.cockpit_ad_billing_deliveries;
 e uuid; channel_id text; copy text; ts text; posted timestamptz; delivery_state text;
BEGIN
 SELECT * INTO b FROM public.cockpit_ad_billing_bindings WHERE id=p_binding FOR UPDATE;
 IF NOT b.enabled THEN RETURN; END IF;
 SELECT * INTO r FROM public.cockpit_ad_billing_reviews WHERE binding_id=b.id ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT id INTO e FROM public.cockpit_ad_billing_events WHERE binding_id=b.id AND sequence=b.sequence;
 IF e IS NULL THEN RETURN; END IF;
 SELECT state INTO delivery_state FROM public.cockpit_ad_billing_deliveries WHERE review_id=r.id AND channel='whatsapp';
 copy:='⚠️ '||b.client_name||E' — Meta billing\nAccount: '||b.account_id||E'\nStatus: '||b.signal
 ||CASE WHEN b.error IS NOT NULL THEN E'\nSource check needs attention: '||b.error ELSE '' END
 ||E'\nClient message: '||CASE WHEN b.signal='healthy' THEN 'signal cleared; no client message queued'
 WHEN r.state='pending' THEN 'CSM or media buyer review required'
 WHEN r.state='approved' THEN 'approved · '||coalesce(delivery_state,'awaiting delivery')
 WHEN r.state='denied' THEN 'denied · '||r.reason
 ELSE 'no approved send' END
 ||CASE WHEN r.state='pending' THEN E'\n\n'||r.body ELSE '' END
 ||E'\n\nReview daily. Approve, edit or deny with a reason. New posts at most once every 72 hours per client.';
 FOREACH channel_id IN ARRAY ARRAY['C09RZ0GS0V9','C0AF4SDLWNL'] LOOP
  -- Do not race an in-flight/ambiguous request or create a second copy after a lost receipt.
  IF EXISTS(SELECT 1 FROM public.cockpit_ad_billing_deliveries WHERE binding_id=b.id AND channel='slack' AND destination=channel_id AND state IN('sending','unknown','claimed')) THEN CONTINUE; END IF;
  SELECT * INTO prior FROM public.cockpit_ad_billing_deliveries WHERE binding_id=b.id AND channel='slack' AND destination=channel_id AND state IN('accepted','queued','retry','failed') ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT max(to_timestamp(split_part(provider_id,'.',1)::bigint)) INTO posted FROM public.cockpit_ad_billing_deliveries WHERE binding_id=b.id AND channel='slack' AND destination=channel_id AND slack_update_ts IS NULL AND state='accepted';
  -- Never blindly recreate a deleted/inaccessible Slack card. It remains a visible failed delivery.
  IF prior.id IS NOT NULL AND (prior.state='failed' OR (prior.body=copy AND prior.review_id IS NOT DISTINCT FROM r.id
    AND NOT(prior.state='accepted' AND r.state='pending' AND posted<=now()-interval '72 hours'))) THEN CONTINUE; END IF;
  UPDATE public.cockpit_ad_billing_deliveries SET state='skipped',error='Replaced by current approval card',updated_at=now()
    WHERE binding_id=b.id AND channel='slack' AND destination=channel_id AND state IN('queued','retry');
  ts:=NULL;
  IF posted>now()-interval '72 hours' OR coalesce(r.state,'')<>'pending' THEN
   SELECT provider_id INTO ts FROM public.cockpit_ad_billing_deliveries WHERE binding_id=b.id AND channel='slack' AND destination=channel_id AND state='accepted' ORDER BY created_at DESC,id DESC LIMIT 1;
  END IF;
  -- Recovery only updates an existing card; it does not create a new notification.
  IF ts IS NULL AND b.signal='healthy' THEN CONTINUE; END IF;
  INSERT INTO public.cockpit_ad_billing_deliveries(event_id,binding_id,revision,channel,destination,body,review_id,slack_update_ts)
  VALUES(e,b.id,b.revision,'slack',channel_id,copy,r.id,ts);
 END LOOP;
END $$;

COMMIT;
