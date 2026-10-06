BEGIN;
-- Worker-only contracts. The authoritative base queue/finish/reply RPCs remain intact.
CREATE TABLE IF NOT EXISTS public.cockpit_media_native_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES public.cockpit_media_native_jobs(id) ON DELETE CASCADE,
 record_id uuid NOT NULL REFERENCES public.cockpit_media_native_records(id) ON DELETE CASCADE,
 operation text NOT NULL, provider text NOT NULL, stage text NOT NULL CHECK(stage IN('intent','receipt','failure')),
 intent_hash text NOT NULL, request_payload jsonb NOT NULL DEFAULT '{}', response_payload jsonb,
 error_message text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_media_native_one_intent ON public.cockpit_media_native_receipts(job_id,provider,intent_hash,stage) WHERE stage IN('intent','receipt');
CREATE TABLE IF NOT EXISTS public.cockpit_media_native_health (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.cockpit_media_native_jobs(id) ON DELETE SET NULL,
 provider text NOT NULL, operation text NOT NULL, ok boolean NOT NULL, detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cockpit_media_native_threads (
 id uuid PRIMARY KEY REFERENCES public.cockpit_media_native_records(id) ON DELETE CASCADE,
 channel text NOT NULL, thread_ts text NOT NULL, cursor text NOT NULL DEFAULT '',
 claim_token uuid, claimed_at timestamptz, checked_at timestamptz NOT NULL DEFAULT '-infinity',
 UNIQUE(channel,thread_ts)
);
ALTER TABLE public.cockpit_media_native_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_native_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_native_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_media_native_receipts,public.cockpit_media_native_health,public.cockpit_media_native_threads FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cockpit_media_native_receipts,public.cockpit_media_native_health,public.cockpit_media_native_threads TO service_role;
CREATE OR REPLACE TRIGGER cockpit_media_native_receipts_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_media_native_receipts FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE OR REPLACE TRIGGER cockpit_media_native_health_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_media_native_health FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE OR REPLACE TRIGGER cockpit_media_native_threads_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_media_native_threads FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
ALTER TABLE public.cockpit_media_native_jobs ADD COLUMN IF NOT EXISTS context_fingerprint text;
ALTER TABLE public.cockpit_media_native_jobs ADD COLUMN IF NOT EXISTS calendar_revision bigint;

CREATE OR REPLACE FUNCTION public.cockpit_media_native_guard(p_job_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cockpit_media_native_jobs; r public.cockpit_media_native_records; ctx jsonb; source text; feed public.cockpit_media_source_state; creative public.cockpit_creative_source_state; items jsonb; fingerprint text;
BEGIN
 SELECT * INTO j FROM public.cockpit_media_native_jobs WHERE id=p_job_id AND claim_token=p_token AND state='working' AND claimed_at>now()-interval '30 minutes' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The worker claim is no longer current'; END IF;
 SELECT * INTO r FROM public.cockpit_media_native_records WHERE id=j.record_id FOR UPDATE;
 PERFORM 1 FROM public.cockpit_members WHERE auth_user_id=r.actor_id FOR SHARE;
 PERFORM 1 FROM auth.users WHERE id=r.actor_id FOR SHARE;
 PERFORM 1 FROM public.cockpit_campaigns WHERE NOT source_deleted AND raw_data->>'campaignName'=r.campaign_name FOR SHARE;
 IF r.campaign_name IS NOT NULL AND (SELECT count(*) FROM public.cockpit_campaigns WHERE NOT source_deleted AND raw_data->>'campaignName'=r.campaign_name)<>1 THEN RAISE EXCEPTION 'The campaign mapping is missing or ambiguous'; END IF;
 ctx:=public.cockpit_media_native_worker_context(p_job_id,p_token);
 IF r.kind='calendar' AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=r.actor_id AND lower(u.email)=r.data->>'calendarId') AND NOT EXISTS(SELECT 1 FROM public.cockpit_media_calendar_owners o WHERE o.actor_id=r.actor_id AND o.calendar_id=r.data->>'calendarId') THEN RAISE EXCEPTION 'Calendar ownership is no longer verified'; END IF;
 IF r.kind='calendar' AND NOT EXISTS(SELECT 1 FROM public.cockpit_media_calendar_bindings b WHERE b.actor_id=r.actor_id AND b.app=r.calendar_app AND b.record_id=r.id AND b.revision=j.calendar_revision AND b.revision=coalesce((r.request->'args'->>'bindingRevision')::bigint+1,1)) THEN RAISE EXCEPTION 'The claimed calendar binding revision is no longer current'; END IF;
 IF r.kind='assist' THEN
  FOREACH source IN ARRAY ARRAY['onboardings','launchWatch','clientPrefs','boardCards'] LOOP
   SELECT * INTO feed FROM public.cockpit_media_source_state WHERE table_name=source;
   IF feed.ready IS DISTINCT FROM true OR feed.row_count IS NULL OR feed.source_snapshot_at IS NULL OR feed.row_count<>(SELECT count(*) FROM public.cockpit_media_sources WHERE table_name=source AND source_snapshot_at=feed.source_snapshot_at) THEN RAISE EXCEPTION 'The % source is not verified',source; END IF;
   SELECT coalesce(jsonb_agg(s.data),'[]') INTO items FROM public.cockpit_media_sources s WHERE s.table_name=source AND s.source_snapshot_at=feed.source_snapshot_at AND EXISTS(SELECT 1 FROM unnest(s.client_names) name WHERE lower(btrim(name))=lower(btrim(r.client_name)));
   ctx:=jsonb_set(ctx,ARRAY['sources',source],items);
  END LOOP;
  IF r.data->>'kind'<>'creative' THEN
   SELECT * INTO creative FROM public.cockpit_creative_source_state WHERE table_name='winnersArchive';
   IF creative.ready IS DISTINCT FROM true OR creative.row_count IS NULL OR creative.source_snapshot_at IS NULL OR creative.row_count<>(SELECT count(*) FROM public.cockpit_creative_sources WHERE table_name='winnersArchive' AND source_snapshot_at=creative.source_snapshot_at) THEN RAISE EXCEPTION 'The winners archive source is not verified'; END IF;
   SELECT coalesce(jsonb_agg(s.data),'[]') INTO items FROM public.cockpit_creative_sources s WHERE s.table_name='winnersArchive' AND s.source_snapshot_at=creative.source_snapshot_at AND EXISTS(SELECT 1 FROM unnest(s.client_names) name WHERE public.cockpit_ask_ai_owner_allowed(r.actor_id,'media-buyer',name));
   ctx:=jsonb_set(ctx,'{sources,winnersArchive}',items);
  END IF;
 END IF;
 SELECT md5(jsonb_build_array(r.actor_id,r.client_name,r.campaign_name,r.request,
  m.roles,m.clients,m.active,m.email,u.email,u.email_confirmed_at,
  ctx->'campaign'->'meta_account_id',ctx->'campaign'->'raw_data'->'metaAccountId',ctx->'serviceAccountEmail',
  (SELECT coalesce(jsonb_agg(value->>'accountId' ORDER BY value->>'accountId'),'[]') FROM jsonb_array_elements(coalesce(ctx->'sources'->'onboardings','[]'))),
  (SELECT coalesce(jsonb_agg(value->>'accountId' ORDER BY value->>'accountId'),'[]') FROM jsonb_array_elements(coalesce(ctx->'sources'->'launchWatch','[]'))))::text)
 INTO fingerprint FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id WHERE m.auth_user_id=r.actor_id;
 IF j.context_fingerprint IS NOT NULL AND j.context_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Worker identity or provider account mapping changed'; END IF;
 IF j.context_fingerprint IS NULL THEN UPDATE public.cockpit_media_native_jobs SET context_fingerprint=fingerprint WHERE id=j.id; END IF;
 RETURN ctx||jsonb_build_object('ownerEmail',(SELECT email FROM auth.users WHERE id=r.actor_id));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_media_native_record_intent(p_job_id uuid,p_token uuid,p_provider text,p_intent_hash text,p_request jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cockpit_media_native_jobs; receipt jsonb;
BEGIN
 PERFORM public.cockpit_media_native_guard(p_job_id,p_token);
 SELECT * INTO j FROM public.cockpit_media_native_jobs WHERE id=p_job_id;
 SELECT response_payload INTO receipt FROM public.cockpit_media_native_receipts WHERE job_id=j.id AND provider=p_provider AND intent_hash=p_intent_hash AND stage='receipt';
 IF FOUND THEN RETURN jsonb_build_object('state','confirmed','response',receipt); END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_media_native_receipts WHERE job_id=j.id AND provider=p_provider AND intent_hash=p_intent_hash AND stage='intent') THEN RETURN jsonb_build_object('state','pending'); END IF;
 INSERT INTO public.cockpit_media_native_receipts(job_id,record_id,operation,provider,stage,intent_hash,request_payload) VALUES(j.id,j.record_id,j.operation,p_provider,'intent',p_intent_hash,p_request);
 RETURN jsonb_build_object('state','new');
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_media_native_record_receipt(p_job_id uuid,p_token uuid,p_provider text,p_intent_hash text,p_response jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cockpit_media_native_jobs; kind text;
BEGIN
 PERFORM public.cockpit_media_native_guard(p_job_id,p_token);
 SELECT * INTO j FROM public.cockpit_media_native_jobs WHERE id=p_job_id;
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_media_native_receipts WHERE job_id=j.id AND provider=p_provider AND intent_hash=p_intent_hash AND stage='intent') THEN RAISE EXCEPTION 'A durable intent is required'; END IF;
 IF p_intent_hash='complete' AND p_provider IS DISTINCT FROM (CASE j.operation WHEN 'chat.deliver' THEN 'slack' WHEN 'assist.run' THEN 'assist' ELSE 'google_calendar' END) THEN RAISE EXCEPTION 'Completion receipt provider does not match the queued operation'; END IF;
 IF jsonb_typeof(p_response) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A structured provider receipt is required'; END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_media_native_receipts WHERE job_id=j.id AND provider=p_provider AND intent_hash=p_intent_hash AND stage='receipt' AND response_payload IS DISTINCT FROM p_response) THEN RAISE EXCEPTION 'A different provider receipt is already committed'; END IF;
 IF p_provider='slack' AND (coalesce(p_response->>'messageTs','')!~'^[0-9]+\.[0-9]+$' OR coalesce(p_response->>'channel','')!~'^[CDG][A-Z0-9]+$') THEN RAISE EXCEPTION 'A confirmed Slack receipt is required'; END IF;
 IF p_intent_hash='complete' AND j.operation='assist.run' THEN
  SELECT data->>'kind' INTO kind FROM public.cockpit_media_native_records WHERE id=j.record_id;
  IF kind IN('copy','launch') AND (jsonb_typeof(p_response->'variants') IS DISTINCT FROM 'array' OR jsonb_array_length(p_response->'variants')<>5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_response->'variants') v WHERE nullif(btrim(v->>'headline'),'') IS NULL OR nullif(btrim(v->>'message'),'') IS NULL)) THEN RAISE EXCEPTION 'Five complete draft variants are required'; END IF;
  IF kind='creative' AND (jsonb_typeof(p_response->'media') IS DISTINCT FROM 'array' OR jsonb_array_length(p_response->'media')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_response->'media') m WHERE coalesce(nullif(m->>'imageHash',''),nullif(m->>'videoId','')) IS NULL OR m ? 'error' OR m ? 'progress')) THEN RAISE EXCEPTION 'Confirmed asset receipts are required'; END IF;
  IF kind='launch' AND (jsonb_typeof(p_response->'steps') IS DISTINCT FROM 'array' OR jsonb_array_length(p_response->'steps')=0) THEN RAISE EXCEPTION 'Launch checklist results are required'; END IF;
 END IF;
 IF p_intent_hash='complete' AND j.operation='calendar.refresh' AND (jsonb_typeof(p_response->'calendarEvents') IS DISTINCT FROM 'array' OR jsonb_typeof(p_response->'checkedAt') IS DISTINCT FROM 'number' OR (p_response->>'events')::integer IS DISTINCT FROM jsonb_array_length(p_response->'calendarEvents') OR jsonb_typeof(p_response->'windowStart') IS DISTINCT FROM 'number' OR jsonb_typeof(p_response->'windowEnd') IS DISTINCT FROM 'number' OR (p_response->>'windowEnd')::numeric-(p_response->>'windowStart')::numeric<>28*86400000::numeric) THEN RAISE EXCEPTION 'A verified complete calendar-window receipt is required'; END IF;
 INSERT INTO public.cockpit_media_native_receipts(job_id,record_id,operation,provider,stage,intent_hash,response_payload) VALUES(j.id,j.record_id,j.operation,p_provider,'receipt',p_intent_hash,p_response) ON CONFLICT DO NOTHING;
 IF j.operation='chat.deliver' AND p_provider='slack' THEN INSERT INTO public.cockpit_media_native_threads(id,channel,thread_ts) VALUES(j.record_id,p_response->>'channel',p_response->>'messageTs') ON CONFLICT DO NOTHING; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
-- Failure health is allowed after revocation/expiry: it cannot publish data or revive a job.
CREATE OR REPLACE FUNCTION public.cockpit_media_native_health(p_job_id uuid,p_token uuid,p_provider text,p_operation text,p_ok boolean,p_detail jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cockpit_media_native_jobs WHERE id=p_job_id AND claim_token=p_token) THEN RAISE EXCEPTION 'Unknown worker fence'; END IF;
 INSERT INTO public.cockpit_media_native_health(job_id,provider,operation,ok,detail) VALUES(p_job_id,p_provider,p_operation,p_ok,p_detail);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_media_native_record_failure(p_job_id uuid,p_token uuid,p_provider text,p_intent_hash text,p_error text,p_reconcile boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cockpit_media_native_jobs;
BEGIN
 SELECT * INTO j FROM public.cockpit_media_native_jobs WHERE id=p_job_id AND claim_token=p_token AND state='working' AND claimed_at>now()-interval '30 minutes' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The worker claim is no longer current'; END IF;
 INSERT INTO public.cockpit_media_native_receipts(job_id,record_id,operation,provider,stage,intent_hash,error_message) VALUES(j.id,j.record_id,j.operation,p_provider,'failure',p_intent_hash,left(p_error,300));
 PERFORM public.cockpit_media_native_finish(j.id,p_token,jsonb_build_object('error',left(p_error,300),'note',CASE WHEN p_reconcile THEN 'Provider outcome is unknown. Reconcile the receipt; no duplicate will be sent.' ELSE 'The provider failed. Check worker health before trying again.' END),CASE WHEN p_reconcile THEN 'reconcile' ELSE 'failed' END);
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_media_native_progress(p_job_id uuid,p_token uuid,p_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_media_native_guard(p_job_id,p_token);
 UPDATE public.cockpit_media_native_records SET data=data||p_result,updated_at=now() WHERE id=(SELECT record_id FROM public.cockpit_media_native_jobs WHERE id=p_job_id);
END $$;
-- Refuse success without an actual end-to-end receipt; intent is not delivery.
CREATE OR REPLACE FUNCTION public.cockpit_media_native_ready_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb;
BEGIN
 IF NEW.state='ready' AND OLD.state<>'ready' THEN
  PERFORM public.cockpit_media_native_guard(OLD.id,OLD.claim_token);
  SELECT response_payload INTO receipt FROM public.cockpit_media_native_receipts WHERE job_id=OLD.id AND stage='receipt' AND intent_hash='complete' AND provider=(CASE OLD.operation WHEN 'chat.deliver' THEN 'slack' WHEN 'assist.run' THEN 'assist' ELSE 'google_calendar' END);
  IF NOT FOUND THEN RAISE EXCEPTION 'A confirmed completion receipt is required'; END IF;
  IF OLD.operation='chat.deliver' THEN
   IF NEW.result->>'slackMessageTs' IS DISTINCT FROM receipt->>'messageTs' OR NEW.result->>'slackChannel' IS DISTINCT FROM receipt->>'channel' THEN RAISE EXCEPTION 'Completion does not match the confirmed Slack receipt'; END IF;
  ELSIF NEW.result IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Completion does not match the confirmed provider result';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER cockpit_media_native_ready_guard BEFORE UPDATE ON public.cockpit_media_native_jobs FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_ready_guard();

CREATE OR REPLACE FUNCTION public.cockpit_media_native_thread_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.cockpit_media_native_threads;
BEGIN
 SELECT s.* INTO t FROM public.cockpit_media_native_threads s JOIN public.cockpit_media_native_records r ON r.id=s.id WHERE s.checked_at<now()-interval '1 minute' AND (s.claimed_at IS NULL OR s.claimed_at<now()-interval '2 minutes') AND public.cockpit_ask_ai_owner_allowed(r.actor_id,'media-buyer',r.client_name) ORDER BY s.checked_at FOR UPDATE OF s SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.cockpit_media_native_threads SET claim_token=gen_random_uuid(),claimed_at=now() WHERE id=t.id RETURNING * INTO t;
 RETURN to_jsonb(t);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_media_native_thread_context(p_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.cockpit_media_native_threads;r public.cockpit_media_native_records;
BEGIN
 SELECT * INTO t FROM public.cockpit_media_native_threads WHERE id=p_id AND claim_token=p_token AND claimed_at>now()-interval '2 minutes';
 IF NOT FOUND THEN RAISE EXCEPTION 'Reply polling fence expired'; END IF;
 SELECT * INTO r FROM public.cockpit_media_native_records WHERE id=t.id;
 IF NOT public.cockpit_ask_ai_owner_allowed(r.actor_id,'media-buyer',r.client_name) OR NOT EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND c.raw_data->>'campaignName'=r.campaign_name AND lower(btrim(coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name)))=lower(btrim(r.client_name))) THEN RAISE EXCEPTION 'Reply owner or campaign mapping changed'; END IF;
 RETURN to_jsonb(t);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_media_native_thread_reply(p_id uuid,p_token uuid,p_message_id uuid,p_text text,p_author text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.cockpit_media_native_threads WHERE id=p_id FOR UPDATE;
 PERFORM public.cockpit_media_native_thread_context(p_id,p_token);
 PERFORM public.cockpit_media_native_reply(p_id,p_message_id,p_text,p_author,true);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_media_native_thread_finish(p_id uuid,p_token uuid,p_cursor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.cockpit_media_native_threads WHERE id=p_id FOR UPDATE;
 PERFORM public.cockpit_media_native_thread_context(p_id,p_token);
 UPDATE public.cockpit_media_native_threads SET cursor=p_cursor,checked_at=now(),claimed_at=NULL,claim_token=NULL WHERE id=p_id;
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('cockpit_media_native_guard','cockpit_media_native_record_intent','cockpit_media_native_record_receipt','cockpit_media_native_record_failure','cockpit_media_native_health','cockpit_media_native_progress','cockpit_media_native_ready_guard','cockpit_media_native_thread_claim','cockpit_media_native_thread_context','cockpit_media_native_thread_reply','cockpit_media_native_thread_finish') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
-- Existing UI consumers use these catalog reads in addition to the base surface.
CREATE OR REPLACE FUNCTION public.cockpit_media_native_catalog_read(p_operation text,p_args jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE source text; feed public.cockpit_creative_source_state; rows jsonb; same jsonb; rest jsonb;
BEGIN
 PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);
 IF p_operation='cockpit.onboardings' THEN RETURN public.cockpit_media_native_source('onboardings')->'rows'; END IF;
 IF p_operation='cockpit.launchWatch' THEN RETURN public.cockpit_media_native_source('launchWatch')->'rows'; END IF;
 IF p_operation<>'cockpit.winners' THEN RAISE EXCEPTION 'Unsupported native catalog read'; END IF;
 FOREACH source IN ARRAY ARRAY['campaigns','ads'] LOOP
  SELECT * INTO feed FROM public.cockpit_creative_source_state WHERE table_name=source;
  IF feed.ready IS DISTINCT FROM true OR feed.row_count IS NULL OR feed.source_snapshot_at IS NULL OR feed.row_count<>(SELECT count(*) FROM public.cockpit_creative_sources WHERE table_name=source AND source_snapshot_at=feed.source_snapshot_at) THEN RAISE EXCEPTION 'The % source is not verified',source; END IF;
 END LOOP;
 -- A name alone cannot identify an ad's owner. Refuse an inconsistent snapshot
 -- instead of attaching a private creative to whichever same-name campaign joins.
 IF EXISTS(
  SELECT 1 FROM public.cockpit_ads a
  LEFT JOIN public.cockpit_creative_source_state af ON af.table_name='ads'
  LEFT JOIN public.cockpit_creative_sources ads ON ads.table_name='ads' AND ads.source_id=a.raw_data->>'_id' AND ads.source_snapshot_at=af.source_snapshot_at
  WHERE NOT a.source_deleted AND a.leads>0 AND a.spend>=45
  AND coalesce((a.raw_data->>'cpl')::numeric,a.spend/nullif(a.leads,0))<=15
  AND (ads.source_id IS NULL OR cardinality(ads.client_names)<>1
   OR (SELECT count(*) FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND c.raw_data->>'campaignName'=a.campaign_name)<>1
   OR NOT EXISTS(
    SELECT 1 FROM public.cockpit_campaigns c
    JOIN public.cockpit_creative_source_state cf ON cf.table_name='campaigns'
    JOIN public.cockpit_creative_sources cs ON cs.table_name='campaigns' AND cs.source_id=c.raw_data->>'_id' AND cs.source_snapshot_at=cf.source_snapshot_at
    WHERE NOT c.source_deleted AND c.raw_data->>'campaignName'=a.campaign_name
    AND cardinality(cs.client_names)=1
    AND lower(btrim(ads.client_names[1]))=lower(btrim(coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name)))
    AND lower(btrim(cs.client_names[1]))=lower(btrim(ads.client_names[1]))
    AND regexp_replace(coalesce(c.meta_account_id,''),'^act_','')~'^[0-9]+$'
    AND (nullif(c.raw_data->>'metaAccountId','') IS NULL OR regexp_replace(c.raw_data->>'metaAccountId','^act_','')=regexp_replace(c.meta_account_id,'^act_',''))
   ))
 ) THEN RAISE EXCEPTION 'Winner ownership mapping is missing or ambiguous. Refresh the verified campaign and ad sources before opening winners.'; END IF;
 -- The source producer publishes these mirrors and their coverage state atomically.
 SELECT coalesce(jsonb_agg(item ORDER BY coalesce(cpb,9999),cpl),'[]') INTO rows FROM(
  SELECT jsonb_strip_nulls(jsonb_build_object(
   '_id',a.raw_data->>'_id','adName',a.ad_name,'campaignName',a.campaign_name,
   'clientName',coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name),
   'serviceType',c.raw_data->'serviceType','thumbnailUrl',a.thumbnail_url,'metaAdId',a.meta_ad_id,
   'accountId',c.meta_account_id,'stillKey',a.raw_data->'stillKey','stillUrl',a.still_url,'stillTinyUrl',a.raw_data->'stillTinyUrl',
   'spend',a.spend,'leads',a.leads,'cpl',coalesce((a.raw_data->>'cpl')::numeric,a.spend/nullif(a.leads,0)),
   'linkCtr',a.raw_data->'linkCtr','cpm',a.raw_data->'cpm','optInRate',a.raw_data->'optInRate',
   'costPerBooking',c.raw_data->'costPerBooking','bookingRate',c.raw_data->'bookingRate')) item,
   (c.raw_data->>'costPerBooking')::numeric cpb,coalesce((a.raw_data->>'cpl')::numeric,a.spend/nullif(a.leads,0)) cpl
  FROM public.cockpit_ads a JOIN public.cockpit_campaigns c ON c.raw_data->>'campaignName'=a.campaign_name
  WHERE NOT a.source_deleted AND NOT c.source_deleted AND a.leads>0 AND a.spend>=45
  AND EXISTS(SELECT 1 FROM public.cockpit_creative_sources s JOIN public.cockpit_creative_source_state f ON f.table_name=s.table_name AND f.source_snapshot_at=s.source_snapshot_at WHERE s.table_name='ads' AND s.source_id=a.raw_data->>'_id' AND f.ready AND cardinality(s.client_names)=1 AND lower(btrim(s.client_names[1]))=lower(btrim(coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name))) AND public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',s.client_names[1]))
  AND EXISTS(SELECT 1 FROM public.cockpit_creative_sources s JOIN public.cockpit_creative_source_state f ON f.table_name=s.table_name AND f.source_snapshot_at=s.source_snapshot_at WHERE s.table_name='campaigns' AND s.source_id=c.raw_data->>'_id' AND f.ready)
  AND coalesce((a.raw_data->>'cpl')::numeric,a.spend/nullif(a.leads,0))<=15
  AND public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name))
 ) q;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') INTO same FROM(SELECT value,ordinality FROM jsonb_array_elements(rows) WITH ORDINALITY WHERE nullif(p_args->>'serviceType','') IS NOT NULL AND value->>'serviceType'=p_args->>'serviceType' LIMIT 8) q;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') INTO rest FROM(SELECT value,ordinality FROM jsonb_array_elements(rows) WITH ORDINALITY WHERE nullif(p_args->>'serviceType','') IS NULL OR value->>'serviceType' IS DISTINCT FROM p_args->>'serviceType' LIMIT 12) q;
 RETURN jsonb_build_object('sameLine',same,'rest',rest);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_native_catalog_read(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_native_catalog_read(text,jsonb) TO authenticated;
-- Calendar request receipts survive replacement and unlink. Revisions fence late,
-- never-arrived intents as well as repeats whose response was lost.
CREATE TABLE IF NOT EXISTS public.cockpit_media_calendar_bindings(
 actor_id uuid NOT NULL REFERENCES auth.users(id), app text NOT NULL CHECK(app IN('media-buyer','client-success','creative')),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), PRIMARY KEY(actor_id,app),
 record_id uuid REFERENCES public.cockpit_media_native_records(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cockpit_media_calendar_requests(
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES auth.users(id), app text NOT NULL CHECK(app IN('media-buyer','client-success','creative')),
 operation text NOT NULL CHECK(operation IN('personalCalendars.link','personalCalendars.unlink')),
 args jsonb NOT NULL, outcome jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cockpit_media_calendar_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_calendar_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_media_calendar_bindings,public.cockpit_media_calendar_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cockpit_media_calendar_bindings,public.cockpit_media_calendar_requests TO service_role;
CREATE OR REPLACE TRIGGER cockpit_media_calendar_bindings_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_media_calendar_bindings FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE OR REPLACE TRIGGER cockpit_media_calendar_requests_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_media_calendar_requests FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
INSERT INTO public.cockpit_media_calendar_bindings(actor_id,app,revision,record_id) SELECT actor_id,calendar_app,1,id FROM public.cockpit_media_native_records WHERE kind='calendar' ON CONFLICT (actor_id,app) DO NOTHING;
INSERT INTO public.cockpit_media_calendar_requests(id,actor_id,app,operation,args,outcome)
 SELECT id,actor_id,calendar_app,request->>'operation',request->'args',jsonb_build_object('ok',true,'id',id,'bindingRevision',1)
 FROM public.cockpit_media_native_records WHERE kind='calendar' AND request->>'operation'='personalCalendars.link' ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cockpit_media_native_write(p_operation text,p_args jsonb,p_request_id uuid,p_apply boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_media_native_records; scope jsonb; v_kind text; data jsonb; name text; calendar text; email text;
 receipt public.cockpit_media_calendar_requests; binding public.cockpit_media_calendar_bindings; expected bigint; outcome jsonb;
BEGIN
 IF p_operation IN('personalCalendars.link','personalCalendars.unlink') THEN PERFORM public.cockpit_media_calendar_scope(p_args->>'app');ELSE PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);END IF;
 IF NOT p_apply THEN RETURN jsonb_build_object('dryRun',true,'ok',false); END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable operation id is required'; END IF;
 -- Serialize all uses of this ID, including conflicting actors or operation kinds.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO receipt FROM public.cockpit_media_calendar_requests WHERE id=p_request_id;
 IF FOUND THEN
  IF receipt.actor_id<>auth.uid() OR receipt.operation<>p_operation OR receipt.args<>p_args THEN RAISE EXCEPTION 'Operation id already used for different inputs'; END IF;
  RETURN receipt.outcome;
 END IF;
 SELECT * INTO r FROM public.cockpit_media_native_records WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.actor_id<>auth.uid() OR r.request<>jsonb_build_object('operation',p_operation,'args',p_args) THEN RAISE EXCEPTION 'Operation id already used for different inputs'; END IF;
  IF r.kind IN('manual','chat','assist') THEN PERFORM public.cockpit_media_request_scope(r.campaign_name,r.client_name); END IF;
  RETURN jsonb_build_object('ok',true,'id',r.id);
 END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id=auth.uid();
 name:=coalesce(nullif((SELECT m.name FROM public.cockpit_members m WHERE auth_user_id=auth.uid()),''),email);
 IF p_operation IN('cockpit.logManualChange','chat.ask','assist.enqueue') THEN
  scope:=public.cockpit_media_request_scope(nullif(p_args->>'campaignName',''),p_args->>'client');
  IF p_operation='cockpit.logManualChange' THEN
   IF nullif(scope->>'campaignName','') IS NULL OR length(btrim(coalesce(p_args->>'what',''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Choose a campaign and describe the change'; END IF;
   v_kind:='manual';data:=jsonb_build_object('what',btrim(p_args->>'what'),'adName',p_args->>'adName','by',name,'campaignName',scope->>'campaignName');
  ELSIF p_operation='chat.ask' THEN
   IF p_args->>'campaignId' IS DISTINCT FROM scope->>'campaignName' OR length(btrim(coalesce(p_args->>'text',''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Choose the matching campaign and enter a question'; END IF;
   v_kind:='chat';data:=jsonb_build_object('campaignId',scope->>'campaignName','campaignName',scope->>'campaignName','client',scope->>'client','author','her','authorName',name,'text',btrim(p_args->>'text'),'pending',true,'status','queued','kind','question','context',(SELECT jsonb_build_object('spend7d',spend_7d,'leads7d',leads_7d,'cpl',cpl,'syncedAt',synced_at) FROM public.cockpit_campaigns WHERE NOT source_deleted AND raw_data->>'campaignName'=scope->>'campaignName'));
  ELSE
   IF coalesce(p_args->>'kind','') NOT IN('copy','creative','launch') OR length(coalesce(p_args->>'brief',''))>12000 OR jsonb_typeof(coalesce(p_args->'driveLinks','[]'))<>'array' OR jsonb_array_length(coalesce(p_args->'driveLinks','[]'))>20 THEN RAISE EXCEPTION 'Choose copy, creative, or launch and at most twenty Drive links'; END IF;
   v_kind:='assist';data:=p_args||jsonb_build_object('client',scope->>'client','campaignName',scope->>'campaignName','status','queued','note','Queued for the native media worker. Nothing has been published.');
  END IF;
 ELSIF p_operation IN('personalCalendars.link','personalCalendars.unlink') THEN
  IF jsonb_typeof(p_args->'bindingRevision') IS DISTINCT FROM 'number' OR (p_args->>'bindingRevision')!~'^[0-9]+$' THEN RAISE EXCEPTION 'Capture the current calendar binding revision before applying this intent'; END IF;
  expected:=(p_args->>'bindingRevision')::bigint;
  INSERT INTO public.cockpit_media_calendar_bindings(actor_id,app) VALUES(auth.uid(),p_args->>'app') ON CONFLICT DO NOTHING;
  SELECT * INTO binding FROM public.cockpit_media_calendar_bindings WHERE actor_id=auth.uid() AND app=p_args->>'app' FOR UPDATE;
  PERFORM 1 FROM public.cockpit_members WHERE auth_user_id=auth.uid() FOR SHARE;
  PERFORM 1 FROM auth.users WHERE id=auth.uid() FOR SHARE;
  PERFORM public.cockpit_media_calendar_scope(p_args->>'app');
  SELECT u.email INTO email FROM auth.users u WHERE u.id=auth.uid();
  IF binding.revision<>expected THEN
   outcome:=jsonb_build_object('ok',false,'applied',false,'code','CALENDAR_CAS_NOT_APPLIED','id',p_request_id,'expectedRevision',expected,'currentRevision',binding.revision);
   INSERT INTO public.cockpit_media_calendar_requests(id,actor_id,app,operation,args,outcome) VALUES(p_request_id,auth.uid(),p_args->>'app',p_operation,p_args,outcome);
   RETURN outcome;
  END IF;
  IF p_operation='personalCalendars.link' THEN
   calendar:=lower(btrim(p_args->>'calendarId'));
   IF calendar IS NULL OR calendar!~'^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN RAISE EXCEPTION 'Enter a Google calendar email, not a URL or credential'; END IF;
   IF calendar<>lower(email) AND NOT EXISTS(SELECT 1 FROM public.cockpit_media_calendar_owners WHERE actor_id=auth.uid() AND calendar_id=calendar) THEN RAISE EXCEPTION 'Use your verified cockpit email. Ask an administrator to verify ownership before linking another Google account.'; END IF;
  END IF;
  DELETE FROM public.cockpit_media_native_records WHERE kind='calendar' AND actor_id=auth.uid() AND calendar_app=p_args->>'app';
  IF p_operation='personalCalendars.link' THEN
   INSERT INTO public.cockpit_media_native_records(id,kind,actor_id,calendar_app,request,data) VALUES(p_request_id,'calendar',auth.uid(),p_args->>'app',jsonb_build_object('operation',p_operation,'args',p_args),jsonb_build_object('calendarId',calendar,'status','pending','note','Waiting for the calendar worker to verify service-account sharing.','calendarEvents','[]'::jsonb));
   INSERT INTO public.cockpit_media_native_jobs(id,record_id,operation) VALUES(p_request_id,p_request_id,'calendar.refresh');
  END IF;
  UPDATE public.cockpit_media_calendar_bindings SET revision=revision+1,record_id=CASE WHEN p_operation='personalCalendars.link' THEN p_request_id END,updated_at=now() WHERE actor_id=auth.uid() AND app=p_args->>'app' RETURNING * INTO binding;
  outcome:=jsonb_build_object('ok',true,'id',p_request_id,'bindingRevision',binding.revision);
  INSERT INTO public.cockpit_media_calendar_requests(id,actor_id,app,operation,args,outcome) VALUES(p_request_id,auth.uid(),p_args->>'app',p_operation,p_args,outcome);
  RETURN outcome;
 ELSE RAISE EXCEPTION 'Unsupported native media write: %',p_operation;
 END IF;
 INSERT INTO public.cockpit_media_native_records(id,kind,actor_id,client_name,campaign_name,request,data) VALUES(p_request_id,v_kind,auth.uid(),scope->>'client',scope->>'campaignName',jsonb_build_object('operation',p_operation,'args',p_args),data);
 IF v_kind IN('chat','assist') THEN INSERT INTO public.cockpit_media_native_jobs(id,record_id,operation) VALUES(p_request_id,p_request_id,CASE v_kind WHEN 'chat' THEN 'chat.deliver' ELSE 'assist.run' END); END IF;
 RETURN jsonb_build_object('ok',true,'id',p_request_id);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_native_write(text,jsonb,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_native_write(text,jsonb,uuid,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.cockpit_media_calendar_mine(p_app text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.cockpit_media_native_read('personalCalendars.mine',jsonb_build_object('app',p_app)) || jsonb_build_object('bindingRevision',coalesce((SELECT revision FROM public.cockpit_media_calendar_bindings WHERE actor_id=auth.uid() AND app=p_app),0));
$$;
REVOKE ALL ON FUNCTION public.cockpit_media_calendar_mine(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_calendar_mine(text) TO authenticated;
-- Correct the historical row-variable/alias collision without changing the base
-- migration. Only the current calendar binding may schedule or claim refreshes.
CREATE OR REPLACE FUNCTION public.cockpit_media_native_claim(p_apply boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed_job public.cockpit_media_native_jobs; requested_record public.cockpit_media_native_records; current_revision bigint;
BEGIN
 IF NOT p_apply THEN RETURN jsonb_build_object('dryRun',true,'queued',(SELECT count(*) FROM public.cockpit_media_native_jobs WHERE state='queued')); END IF;
 WITH expired AS(
  UPDATE public.cockpit_media_native_jobs AS expired_job
  SET state='reconcile',finished_at=now(),result=jsonb_build_object('error','Worker stopped without a receipt. Reconcile provider state before retrying.')
  WHERE expired_job.state='working' AND expired_job.claimed_at<now()-interval '30 minutes' RETURNING expired_job.record_id
 )
 UPDATE public.cockpit_media_native_records AS expired_record
 SET data=expired_record.data||jsonb_build_object('status','failed','pending',false,'error','Worker stopped without a receipt. Reconcile provider state before retrying.','note','The last provider outcome is unknown. No automatic duplicate will be sent.'),updated_at=now()
 WHERE expired_record.id IN(SELECT expired.record_id FROM expired);
 INSERT INTO public.cockpit_media_native_jobs(id,record_id,operation,calendar_revision)
 SELECT gen_random_uuid(),calendar_record.id,'calendar.refresh',calendar_binding.revision
 FROM public.cockpit_media_native_records AS calendar_record
 JOIN public.cockpit_media_calendar_bindings AS calendar_binding ON calendar_binding.actor_id=calendar_record.actor_id AND calendar_binding.app=calendar_record.calendar_app AND calendar_binding.record_id=calendar_record.id
 WHERE calendar_record.kind='calendar' AND calendar_record.updated_at<now()-interval '5 minutes'
 AND calendar_binding.revision=coalesce((calendar_record.request->'args'->>'bindingRevision')::bigint+1,1)
 AND public.cockpit_ask_ai_owner_allowed(calendar_record.actor_id,calendar_record.calendar_app,NULL)
 AND NOT EXISTS(SELECT 1 FROM public.cockpit_media_native_jobs AS open_job WHERE open_job.record_id=calendar_record.id AND open_job.state IN('queued','working'))
 ON CONFLICT DO NOTHING;
 SELECT queued_job.* INTO claimed_job FROM public.cockpit_media_native_jobs AS queued_job WHERE queued_job.state='queued' ORDER BY queued_job.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT native_record.* INTO requested_record FROM public.cockpit_media_native_records AS native_record WHERE native_record.id=claimed_job.record_id;
 IF requested_record.kind='calendar' THEN
  SELECT calendar_binding.revision INTO current_revision FROM public.cockpit_media_calendar_bindings AS calendar_binding
  WHERE calendar_binding.actor_id=requested_record.actor_id AND calendar_binding.app=requested_record.calendar_app AND calendar_binding.record_id=requested_record.id
  AND calendar_binding.revision=coalesce((requested_record.request->'args'->>'bindingRevision')::bigint+1,1);
 END IF;
 IF NOT public.cockpit_ask_ai_owner_allowed(requested_record.actor_id,CASE WHEN requested_record.kind='calendar' THEN requested_record.calendar_app ELSE 'media-buyer' END,CASE WHEN requested_record.kind='calendar' THEN NULL ELSE requested_record.client_name END)
 OR (requested_record.kind='calendar' AND (current_revision IS NULL OR (claimed_job.calendar_revision IS NOT NULL AND claimed_job.calendar_revision<>current_revision))) THEN
  UPDATE public.cockpit_media_native_jobs AS rejected_job SET state='failed',finished_at=now(),result=jsonb_build_object('error','The requesting member or calendar binding no longer has access') WHERE rejected_job.id=claimed_job.id;
  UPDATE public.cockpit_media_native_records AS rejected_record SET data=rejected_record.data||jsonb_build_object('status','failed','pending',false,'error','The requesting member or calendar binding no longer has access'),updated_at=now() WHERE rejected_record.id=requested_record.id;
  RETURN jsonb_build_object('skipped',true);
 END IF;
 UPDATE public.cockpit_media_native_jobs AS claimed SET state='working',claim_token=gen_random_uuid(),claimed_at=now(),calendar_revision=current_revision WHERE claimed.id=claimed_job.id RETURNING claimed.* INTO claimed_job;
 UPDATE public.cockpit_media_native_records AS working_record SET data=working_record.data||jsonb_build_object('status',CASE WHEN working_record.kind='calendar' THEN 'pending' ELSE 'working' END),updated_at=now() WHERE working_record.id=requested_record.id;
 RETURN jsonb_build_object('job',to_jsonb(claimed_job),'record',to_jsonb(requested_record));
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_native_claim(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_native_claim(boolean) TO service_role;
COMMIT;
