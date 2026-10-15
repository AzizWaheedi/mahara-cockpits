-- Client messages require a current CSM decision. GET/link previews cannot mutate.
-- New Slack posts and client messages use independent rolling 72-hour budgets.
BEGIN;
UPDATE public.cockpit_ad_billing_config SET apply=false WHERE singleton;
ALTER TABLE public.cockpit_ad_billing_bindings ADD CONSTRAINT ad_billing_one_account_per_client UNIQUE(client_task_id);
CREATE TABLE public.cockpit_ad_billing_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 binding_id uuid NOT NULL REFERENCES public.cockpit_ad_billing_bindings(id),
 event_id uuid NOT NULL REFERENCES public.cockpit_ad_billing_events(id),
 revision integer NOT NULL, signal text NOT NULL CHECK(signal IN('payment_grace','unsettled')),
 last_four text, destination text NOT NULL, original_body text NOT NULL, body text NOT NULL CHECK(length(btrim(body)) BETWEEN 10 AND 3000),
 version integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','approved','denied','expired')),
 created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz, actor_id uuid, actor_email text, reason text,
 CHECK(state<>'denied' OR length(btrim(reason)) BETWEEN 3 AND 1000),
 CHECK(state NOT IN('approved','denied') OR (actor_id IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX ad_billing_one_open_review ON public.cockpit_ad_billing_reviews(binding_id) WHERE state IN('pending','approved');
CREATE TABLE public.cockpit_ad_billing_daily_reviews (
 actor_id uuid NOT NULL, review_day date NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,review_day)
);
ALTER TABLE public.cockpit_ad_billing_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_ad_billing_daily_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ad_billing_reviews,public.cockpit_ad_billing_daily_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cockpit_ad_billing_reviews TO service_role;
ALTER TABLE public.cockpit_ad_billing_deliveries
 ADD COLUMN review_id uuid REFERENCES public.cockpit_ad_billing_reviews(id),
 ADD COLUMN slack_update_ts text CHECK(slack_update_ts IS NULL OR slack_update_ts ~ '^[0-9]+\.[0-9]+$');
-- Multiple safe edits of a Slack card are separate immutable delivery intents.
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_constraint WHERE conrelid='public.cockpit_ad_billing_deliveries'::regclass AND contype='u';
 IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.cockpit_ad_billing_deliveries DROP CONSTRAINT %I',c); END IF;
END $$;
CREATE UNIQUE INDEX ad_billing_delivery_event ON public.cockpit_ad_billing_deliveries(event_id,channel,destination) WHERE channel<>'slack';
CREATE UNIQUE INDEX ad_billing_review_send ON public.cockpit_ad_billing_deliveries(review_id) WHERE channel='whatsapp';
UPDATE public.cockpit_ad_billing_deliveries SET state='skipped',error='Replaced by CSM approval workflow',updated_at=now()
 WHERE channel IN('whatsapp','slack') AND state IN('queued','retry','claimed');

CREATE FUNCTION public.cockpit_ad_billing_can_review(p_binding uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 JOIN public.cockpit_ad_billing_bindings b ON b.id=p_binding
 WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email))
 AND (m.roles&&ARRAY['admin','csm'] OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com'))
 AND (m.roles&&ARRAY['admin'] OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com') OR cardinality(m.clients)=0
 OR EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(b.client_name)))));
$$;

-- Accepted time, rather than creation time, sets the send budget. An ambiguous
-- provider outcome blocks further sends indefinitely until reconciled.
CREATE FUNCTION public.cockpit_ad_billing_next_send(p_binding uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN count(*) FILTER(WHERE state IN('sending','unknown'))>0 THEN 'infinity'::timestamptz
 ELSE coalesce(max(updated_at) FILTER(WHERE state='accepted')+interval '72 hours','-infinity'::timestamptz) END
 FROM public.cockpit_ad_billing_deliveries WHERE binding_id=p_binding AND channel='whatsapp';
$$;

CREATE FUNCTION public.cockpit_ad_billing_refresh_review(p_binding uuid,p_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.cockpit_ad_billing_bindings; r public.cockpit_ad_billing_reviews; e uuid;
BEGIN
 SELECT * INTO b FROM public.cockpit_ad_billing_bindings WHERE id=p_binding FOR UPDATE;
 SELECT * INTO r FROM public.cockpit_ad_billing_reviews WHERE binding_id=b.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF r.id IS NOT NULL AND r.state IN('pending','approved') AND (
    b.revision<>r.revision OR b.signal<>r.signal OR b.last_four IS DISTINCT FROM r.last_four OR NOT b.enabled
    OR (r.state='pending' AND r.created_at<=now()-interval '72 hours')
    OR (r.state='approved' AND (r.created_at<=now()-interval '72 hours' OR (r.decided_at<=now()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM public.cockpit_ad_billing_deliveries d WHERE d.review_id=r.id AND d.channel='whatsapp' AND d.state='accepted'))))) THEN
  UPDATE public.cockpit_ad_billing_reviews SET state='expired',version=version+1 WHERE id=r.id;
  UPDATE public.cockpit_ad_billing_deliveries SET state='skipped',error='Approval expired or source changed',updated_at=now()
    WHERE review_id=r.id AND channel='whatsapp' AND state IN('queued','retry','claimed');
  r.state:='expired';
 END IF;
 IF NOT b.enabled OR NOT b.manual_cutover_verified OR b.error IS NOT NULL OR b.signal NOT IN('payment_grace','unsettled')
 OR b.last_good_at<now()-interval '10 minutes' OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 10 AND 3000 THEN RETURN; END IF;
 IF r.id IS NOT NULL AND (r.state IN('pending','approved') OR (r.state='denied' AND r.created_at>now()-interval '72 hours' AND r.signal=b.signal AND r.revision=b.revision)) THEN RETURN; END IF;
 SELECT id INTO e FROM public.cockpit_ad_billing_events WHERE binding_id=b.id AND sequence=b.sequence;
 -- Repeat cycles need their own immutable event; never reuse a previous send key.
 IF e IS NULL OR EXISTS(SELECT 1 FROM public.cockpit_ad_billing_reviews WHERE event_id=e) THEN
  UPDATE public.cockpit_ad_billing_bindings SET sequence=sequence+1 WHERE id=b.id RETURNING sequence INTO b.sequence;
  INSERT INTO public.cockpit_ad_billing_events(binding_id,sequence,episode,signal) VALUES(b.id,b.sequence,b.episode,b.signal) RETURNING id INTO e;
 END IF;
 INSERT INTO public.cockpit_ad_billing_reviews(binding_id,event_id,revision,signal,last_four,destination,original_body,body)
 VALUES(b.id,e,b.revision,b.signal,b.last_four,b.whatsapp_group,p_body,p_body);
END $$;

CREATE FUNCTION public.cockpit_ad_billing_refresh_cards(p_binding uuid) RETURNS void
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
 WHEN r.state='pending' THEN 'CSM review required'
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
CREATE FUNCTION public.cockpit_ad_billing_observe_source(p_lease uuid,p_binding uuid,p_revision integer,p_signal text,p_last_four text,p_error text,p_client_body text,p_internal_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.cockpit_ad_billing_bindings; e uuid; kind text; target text; v_episode integer;
BEGIN
 PERFORM 1 FROM public.cockpit_ad_billing_config WHERE lease=p_lease AND lease_until>now() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Monitor lease expired'; END IF;
 SELECT * INTO b FROM public.cockpit_ad_billing_bindings WHERE id=p_binding FOR UPDATE;
 IF NOT FOUND OR b.revision<>p_revision OR NOT b.enabled THEN RAISE EXCEPTION 'Binding changed or disabled'; END IF;
 IF p_signal NOT IN('unknown','healthy','payment_grace','unsettled','restricted') OR p_signal IS NULL THEN RAISE EXCEPTION 'Invalid billing signal'; END IF;
 IF p_last_four IS NOT NULL AND p_last_four !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Invalid card suffix'; END IF;
 UPDATE public.cockpit_ad_billing_bindings SET last_checked_at=now(),error=left(p_error,400),last_four=p_last_four,
  last_good_at=CASE WHEN p_error IS NULL AND p_signal<>'unknown' THEN now() ELSE last_good_at END,
  healthy_since=CASE WHEN p_error IS NOT NULL OR p_signal<>'healthy' THEN NULL ELSE healthy_since END
 WHERE id=b.id;
 -- Source failures never clear an incident or count as a healthy observation.
 IF p_error IS NOT NULL OR p_signal='unknown' THEN
  UPDATE public.cockpit_ad_billing_bindings SET error=coalesce(left(p_error,400),'Meta billing state is unavailable') WHERE id=b.id; RETURN;
 END IF;
 IF p_signal=b.signal THEN RETURN; END IF;
 kind:=p_signal; v_episode:=b.episode;
 IF p_signal='healthy' AND b.signal IN('payment_grace','unsettled','restricted') THEN
  IF b.healthy_since IS NULL THEN
   UPDATE public.cockpit_ad_billing_bindings SET healthy_since=now() WHERE id=b.id; RETURN;
  ELSIF b.healthy_since>now()-interval '4 minutes' THEN RETURN; END IF;
  kind:='recovered';
 ELSIF p_signal IN('payment_grace','unsettled','restricted') AND b.signal IN('unknown','healthy') THEN v_episode:=v_episode+1;
 END IF;
 UPDATE public.cockpit_ad_billing_bindings SET signal=p_signal,last_four=p_last_four,sequence=sequence+1,episode=v_episode,healthy_since=NULL WHERE id=b.id;
 IF p_signal='healthy' AND kind<>'recovered' THEN RETURN; END IF;
 IF p_internal_body IS NULL OR length(p_internal_body)>4000 OR length(p_internal_body)<10 THEN RAISE EXCEPTION 'Notification text is missing or too long'; END IF;
 INSERT INTO public.cockpit_ad_billing_events(binding_id,sequence,episode,signal) VALUES(b.id,b.sequence+1,v_episode,kind) RETURNING id INTO e;
 UPDATE public.cockpit_ad_billing_deliveries SET state='skipped',error='Superseded by a newer observation',updated_at=now()
 WHERE binding_id=b.id AND state IN('queued','retry','claimed');
 FOREACH target IN ARRAY (ARRAY[b.client_task_id]||b.ads_task_ids) LOOP
  INSERT INTO public.cockpit_ad_billing_deliveries(event_id,binding_id,revision,channel,destination,body)
  VALUES(e,b.id,b.revision,'clickup',target,p_internal_body||E'\nMeta account: '||b.account_id||E'\nNotification delivery is tracked separately in the Media Buyer billing panel.') ON CONFLICT DO NOTHING;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_observe(p_lease uuid,p_binding uuid,p_revision integer,p_signal text,p_last_four text,p_error text,p_client_body text,p_internal_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_ad_billing_observe_source(p_lease,p_binding,p_revision,p_signal,p_last_four,p_error,NULL,p_internal_body);
 PERFORM public.cockpit_ad_billing_refresh_review(p_binding,p_client_body);
 PERFORM public.cockpit_ad_billing_refresh_cards(p_binding);
END $$;

CREATE FUNCTION public.cockpit_ad_billing_decide(p_id uuid,p_version integer,p_decision text,p_body text DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_ad_billing_reviews; b public.cockpit_ad_billing_bindings; mail text; approved_body text; d uuid;
BEGIN
 SELECT * INTO r FROM public.cockpit_ad_billing_reviews WHERE id=p_id;
 IF NOT FOUND OR NOT public.cockpit_ad_billing_can_review(r.binding_id) THEN RAISE EXCEPTION 'Current CSM access is required' USING ERRCODE='42501'; END IF;
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

-- A DB-level gate also covers old workers and direct service-role intent inserts.
CREATE FUNCTION public.cockpit_ad_billing_approved_delivery(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.cockpit_ad_billing_deliveries d JOIN public.cockpit_ad_billing_reviews r ON r.id=d.review_id
 JOIN public.cockpit_ad_billing_bindings b ON b.id=d.binding_id
 WHERE d.id=p_id AND r.binding_id=b.id AND r.state='approved' AND r.decided_at>now()-interval '24 hours'
 AND r.revision=b.revision AND r.signal=b.signal AND r.last_four IS NOT DISTINCT FROM b.last_four
 AND r.destination=b.whatsapp_group AND d.destination=r.destination AND d.body=r.body
 AND EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
  WHERE m.auth_user_id=r.actor_id AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email))
  AND (m.roles&&ARRAY['admin','csm'] OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com'))
  AND (m.roles&&ARRAY['admin'] OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com') OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(b.client_name)))))
 AND NOT EXISTS(SELECT 1 FROM public.cockpit_ad_billing_deliveries x WHERE x.binding_id=b.id AND x.channel='whatsapp' AND x.id<>d.id
  AND (x.state IN('sending','unknown') OR (x.state='accepted' AND x.updated_at>now()-interval '72 hours'))));
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_claim(p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.cockpit_ad_billing_deliveries;
BEGIN
 UPDATE public.cockpit_ad_billing_deliveries SET state='unknown',error='Worker stopped after send intent. Reconcile before retry.',updated_at=now() WHERE state='sending' AND claimed_at<now()-interval '5 minutes';
 UPDATE public.cockpit_ad_billing_deliveries SET state='queued',claim=NULL,updated_at=now() WHERE state='claimed' AND claimed_at<now()-interval '5 minutes';
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_ad_billing_config WHERE singleton AND apply) THEN RETURN NULL; END IF;
 SELECT q.* INTO d FROM public.cockpit_ad_billing_deliveries q JOIN public.cockpit_ad_billing_bindings b ON b.id=q.binding_id
 WHERE q.state IN('queued','retry') AND q.next_attempt_at<=now() AND b.enabled AND b.manual_cutover_verified AND q.revision=b.revision AND b.error IS NULL
 AND b.last_good_at>now()-interval '10 minutes' AND (q.channel<>'whatsapp' OR public.cockpit_ad_billing_approved_delivery(q.id))
 ORDER BY q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.cockpit_ad_billing_deliveries SET state='claimed',claim=p_claim,claimed_at=now(),updated_at=now() WHERE id=d.id;
 RETURN to_jsonb(d)||jsonb_build_object('claim',p_claim);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_begin_send(p_id uuid,p_claim uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.cockpit_ad_billing_deliveries;
BEGIN
 PERFORM 1 FROM public.cockpit_ad_billing_config WHERE singleton AND apply FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO d FROM public.cockpit_ad_billing_deliveries WHERE id=p_id;
 -- Serializes every send for this client, including cooldown checks.
 PERFORM 1 FROM public.cockpit_ad_billing_bindings b WHERE b.id=d.binding_id AND b.enabled AND b.manual_cutover_verified
 AND b.revision=d.revision AND b.error IS NULL AND b.last_good_at>now()-interval '10 minutes' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF d.channel='whatsapp' AND NOT public.cockpit_ad_billing_approved_delivery(p_id) THEN RETURN false; END IF;
 IF d.channel='slack' AND d.slack_update_ts IS NULL AND EXISTS(SELECT 1 FROM public.cockpit_ad_billing_deliveries x
 WHERE x.binding_id=d.binding_id AND x.channel='slack' AND x.destination=d.destination AND x.id<>d.id AND x.slack_update_ts IS NULL
 AND (x.state IN('sending','unknown') OR (x.state='accepted' AND to_timestamp(split_part(x.provider_id,'.',1)::bigint)>now()-interval '72 hours'))) THEN RETURN false; END IF;
 UPDATE public.cockpit_ad_billing_deliveries SET state='sending',attempts=attempts+1,claimed_at=now(),updated_at=now()
 WHERE id=p_id AND claim=p_claim AND state='claimed' AND claimed_at>now()-interval '5 minutes';
 RETURN FOUND;
END $$;

CREATE FUNCTION public.cockpit_ad_billing_review_panel() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb; cfg public.cockpit_ad_billing_config; stamp timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id WHERE m.auth_user_id=auth.uid() AND m.active
 AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email)) AND (m.roles&&ARRAY['admin','csm'] OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com'))) THEN RAISE EXCEPTION 'Current CSM access is required' USING ERRCODE='42501'; END IF;
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
CREATE FUNCTION public.cockpit_ad_billing_daily_done() RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE panel jsonb;
BEGIN
 panel:=public.cockpit_ad_billing_review_panel();
 IF (panel->>'finishedAt')::timestamptz IS NULL OR (panel->>'finishedAt')::timestamptz<=now()-interval '15 minutes' OR panel->>'error' IS NOT NULL THEN RAISE EXCEPTION 'Monitor needs a fresh successful check before completing daily review'; END IF;
 -- A daily check records attention; it never clears unresolved items or sends a message.
 INSERT INTO public.cockpit_ad_billing_daily_reviews(actor_id,review_day) VALUES(auth.uid(),(now() AT TIME ZONE 'Asia/Kuwait')::date)
 ON CONFLICT(actor_id,review_day) DO UPDATE SET reviewed_at=now();
 RETURN now();
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_panel() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; founder boolean; rows jsonb; roster jsonb; cfg public.cockpit_ad_billing_config;
BEGIN
 SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id=cm.auth_user_id
 WHERE cm.auth_user_id=auth.uid() AND cm.active AND u.email_confirmed_at IS NOT NULL AND cm.email=lower(btrim(u.email));
 founder:=m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com');
 IF m.auth_user_id IS NULL OR NOT(founder OR m.roles&&ARRAY['admin','media_buyer']) THEN RAISE EXCEPTION 'Current media buyer access is required' USING ERRCODE='42501'; END IF;
 SELECT * INTO cfg FROM public.cockpit_ad_billing_config WHERE singleton;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'client',b.client_name,'clientTaskId',b.client_task_id,'accountId',b.account_id,
  'enabled',b.enabled,'ready',b.manual_cutover_verified,'signal',b.signal,'checkedAt',b.last_checked_at,'lastGoodAt',b.last_good_at,'error',b.error,
  'review',(SELECT jsonb_build_object('state',r.state,'reason',r.reason,'decidedAt',r.decided_at) FROM public.cockpit_ad_billing_reviews r WHERE r.binding_id=b.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1),
  'deliveries',(SELECT coalesce(jsonb_agg(jsonb_build_object('channel',q.channel,'channelLabel',CASE WHEN q.channel='slack' THEN CASE WHEN q.destination='C09RZ0GS0V9' THEN 'CSM general' ELSE 'Media announcements' END END,'state',q.state,'at',q.updated_at,'error',q.error,'providerId',q.provider_id,
   'taskId',CASE WHEN q.channel='clickup' THEN q.destination END,'commentRole',CASE WHEN q.channel='clickup' THEN CASE WHEN q.destination=b.client_task_id THEN 'client' ELSE 'ads' END END)),'[]')
   FROM public.cockpit_ad_billing_deliveries q JOIN public.cockpit_ad_billing_events e ON e.id=q.event_id WHERE q.binding_id=b.id AND e.sequence=b.sequence)) ORDER BY b.client_name),'[]') INTO rows
 FROM public.cockpit_ad_billing_bindings b
 WHERE founder OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(b.client_name)));
 SELECT coalesce(jsonb_agg(jsonb_build_object('client',r.client_name,'clientTaskId',r.client_task_id,'checkedAt',r.checked_at,
  'enrolled',EXISTS(SELECT 1 FROM public.cockpit_ad_billing_bindings b WHERE b.client_task_id=r.client_task_id AND b.enabled))),'[]') INTO roster
 FROM public.cockpit_ad_billing_roster r WHERE founder OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(r.client_name)));
 RETURN jsonb_build_object('apply',cfg.apply,'startedAt',cfg.last_started_at,'finishedAt',cfg.last_finished_at,'error',cfg.last_error,'bindings',rows,'roster',roster);
END $$;


DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'cockpit_ad_billing_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
 END LOOP;
END $$;
-- Internal source/refresh helpers are not API entry points, even to the worker.
REVOKE ALL ON FUNCTION public.cockpit_ad_billing_observe_source(uuid,uuid,integer,text,text,text,text,text),public.cockpit_ad_billing_refresh_review(uuid,text),public.cockpit_ad_billing_refresh_cards(uuid),public.cockpit_ad_billing_can_review(uuid),public.cockpit_ad_billing_approved_delivery(uuid),public.cockpit_ad_billing_next_send(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ad_billing_panel(),public.cockpit_ad_billing_review_panel(),public.cockpit_ad_billing_decide(uuid,integer,text,text,text),public.cockpit_ad_billing_daily_done() TO authenticated;
COMMIT;
