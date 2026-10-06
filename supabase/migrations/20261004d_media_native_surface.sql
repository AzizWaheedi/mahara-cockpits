BEGIN;
-- Native requests are not Ask AI jobs: creative ingestion and human Slack relays
-- have distinct side effects and must never be replayed after an unknown outcome.
CREATE TABLE public.cockpit_media_native_records (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN('manual','chat','assist','calendar')),
 actor_id uuid NOT NULL REFERENCES auth.users(id), client_name text, campaign_name text,
 calendar_app text CHECK(calendar_app IN('media-buyer','client-success','creative')),
 CHECK((kind='calendar')=(calendar_app IS NOT NULL)),
 request jsonb NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cockpit_media_one_calendar ON public.cockpit_media_native_records(actor_id,calendar_app) WHERE kind='calendar';
CREATE INDEX cockpit_media_native_campaign ON public.cockpit_media_native_records(campaign_name,created_at);
CREATE TABLE public.cockpit_media_native_jobs (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES public.cockpit_media_native_records(id) ON DELETE CASCADE,
 operation text NOT NULL CHECK(operation IN('chat.deliver','assist.run','calendar.refresh')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','working','ready','failed','reconcile')),
 claim_token uuid, claimed_at timestamptz, finished_at timestamptz, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cockpit_media_one_open_job ON public.cockpit_media_native_jobs(record_id) WHERE state IN('queued','working');
CREATE TABLE public.cockpit_media_calendar_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), service_account_email text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cockpit_media_calendar_config(service_account_email) VALUES('claude@studied-handler-508106-m5.iam.gserviceaccount.com');
-- A different Google identity requires an explicit, audited administrator mapping.
-- Sharing alone proves service-account access, not ownership by this cockpit user.
CREATE TABLE public.cockpit_media_calendar_owners (
 actor_id uuid NOT NULL REFERENCES auth.users(id), calendar_id text NOT NULL,
 verified_by text NOT NULL, verified_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,calendar_id)
);
ALTER TABLE public.cockpit_media_native_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_native_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_calendar_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_calendar_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_media_native_records,public.cockpit_media_native_jobs,public.cockpit_media_calendar_config,public.cockpit_media_calendar_owners FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cockpit_media_native_records,public.cockpit_media_native_jobs,public.cockpit_media_calendar_config,public.cockpit_media_calendar_owners TO service_role;
CREATE FUNCTION public.cockpit_media_native_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after",metadata)
 VALUES(lower(TG_OP),TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'id',to_jsonb(OLD)->>'id',to_jsonb(NEW)->>'actor_id','calendar-config'),
 coalesce((SELECT email FROM auth.users WHERE id=auth.uid()),'media-native-worker'),coalesce(to_jsonb(NEW)->>'calendar_app',to_jsonb(OLD)->>'calendar_app',to_jsonb(NEW)->>'app',to_jsonb(OLD)->>'app','media-buyer'),'supabase',
 CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END,jsonb_build_object('actor',auth.uid()));
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER cockpit_media_native_records_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_media_native_records FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE TRIGGER cockpit_media_native_jobs_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_media_native_jobs FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE TRIGGER cockpit_media_calendar_config_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_media_calendar_config FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();
CREATE TRIGGER cockpit_media_calendar_owners_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_media_calendar_owners FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_native_audit();

-- Each source is verified independently. A missing tracking import must not break chat.
CREATE FUNCTION public.cockpit_media_native_source(p_table text,p_campaign text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE feed public.cockpit_media_source_state; rows jsonb;
BEGIN
 PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);
 IF p_table NOT IN('marketPlays','trackingIssues','adChanges','manualChanges','campaignChat','syncRuns','onboardings','launchWatch','clientPrefs','boardCards') THEN RAISE EXCEPTION 'Unsupported media source'; END IF;
 IF p_campaign IS NOT NULL THEN PERFORM public.cockpit_media_scope('chat.thread',p_campaign); END IF;
 SELECT * INTO feed FROM public.cockpit_media_source_state WHERE table_name=p_table;
 IF feed.ready IS DISTINCT FROM true OR feed.source_snapshot_at IS NULL OR feed.row_count IS NULL OR feed.row_count<>(SELECT count(*) FROM public.cockpit_media_sources WHERE table_name=p_table AND source_snapshot_at=feed.source_snapshot_at) THEN
  RAISE EXCEPTION 'The % source has not been imported and verified. Run the media source producer before using this view.',p_table;
 END IF;
 SELECT coalesce(jsonb_agg(s.data),'[]') INTO rows FROM public.cockpit_media_sources s
 WHERE s.table_name=p_table AND s.source_snapshot_at=feed.source_snapshot_at
 AND (p_campaign IS NULL OR coalesce(s.data->>'campaignName',s.data->>'campaignId')=p_campaign)
 AND (p_table='syncRuns' OR EXISTS(SELECT 1 FROM unnest(s.client_names) n WHERE public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',n)));
 RETURN jsonb_build_object('rows',rows,'sourceAt',feed.source_snapshot_at);
END $$;

CREATE FUNCTION public.cockpit_media_market_for_client(p_client text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE feed public.cockpit_media_source_state; city text; service text; running jsonb; suggestions jsonb;
BEGIN
 PERFORM public.cockpit_media_request_scope(NULL,p_client);
 SELECT * INTO feed FROM public.cockpit_media_source_state WHERE table_name='marketPlays';
 IF feed.ready IS DISTINCT FROM true OR feed.source_snapshot_at IS NULL OR feed.row_count IS NULL OR feed.row_count<>(SELECT count(*) FROM public.cockpit_media_sources WHERE table_name='marketPlays' AND source_snapshot_at=feed.source_snapshot_at) THEN RAISE EXCEPTION 'Market plays have not been imported and verified. Run the market collector.'; END IF;
 SELECT data->>'city',data->>'serviceLine' INTO city,service FROM public.cockpit_media_sources WHERE table_name='marketPlays' AND source_snapshot_at=feed.source_snapshot_at AND lower(btrim(data->>'client'))=lower(btrim(p_client)) ORDER BY source_id LIMIT 1;
 WITH mine AS(SELECT CASE WHEN jsonb_array_length(coalesce(data->'interests','[]'))>0 THEN (SELECT string_agg(x,'|' ORDER BY x) FROM jsonb_array_elements_text(data->'interests') x) ELSE data->>'playType' END sig FROM public.cockpit_media_sources WHERE table_name='marketPlays' AND source_snapshot_at=feed.source_snapshot_at AND lower(btrim(data->>'client'))=lower(btrim(p_client)))
 SELECT coalesce(jsonb_agg(DISTINCT sig),'[]') INTO running FROM mine;
 WITH plays AS(
 SELECT coalesce(data->>'city','Unknown') city,data->>'playType' play_type,
 coalesce((SELECT jsonb_agg(x ORDER BY x) FROM jsonb_array_elements_text(coalesce(data->'interests','[]')) x),'[]') interests,
 CASE WHEN jsonb_array_length(coalesce(data->'interests','[]'))>0 THEN (SELECT string_agg(x,'|' ORDER BY x) FROM jsonb_array_elements_text(data->'interests') x) ELSE data->>'playType' END sig,
 (data->>'spend')::numeric spend,(data->>'leads')::numeric leads,data->>'client' client
 FROM public.cockpit_media_sources WHERE table_name='marketPlays' AND source_snapshot_at=feed.source_snapshot_at AND data->>'serviceLine'=service AND lower(btrim(data->>'client'))<>lower(btrim(p_client))
 ), grouped AS(SELECT p.city,p.play_type,p.interests,round(sum(p.spend)/nullif(sum(p.leads),0),2) cpl,count(DISTINCT p.client) clients FROM plays p WHERE NOT (running ? p.sig) GROUP BY p.city,p.play_type,p.interests HAVING sum(p.spend)>=100 AND sum(p.leads)>0), top AS(SELECT g.* FROM grouped g WHERE g.cpl<=15 ORDER BY g.cpl LIMIT 3)
 SELECT coalesce(jsonb_agg(jsonb_build_object('city',t.city,'playType',t.play_type,'interests',t.interests,'cpl',t.cpl,'clients',t.clients) ORDER BY t.cpl),'[]') INTO suggestions FROM top t;
 RETURN jsonb_build_object('city',city,'serviceLine',service,'running',running,'suggestions',suggestions,'sourceAt',feed.source_snapshot_at);
END $$;

CREATE FUNCTION public.cockpit_media_calendar_scope(p_app text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_app IS NULL OR p_app NOT IN('media-buyer','client-success','creative') OR NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),p_app,NULL) THEN RAISE EXCEPTION 'A confirmed active cockpit seat is required for this calendar'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_calendar_scope(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_calendar_scope(text) TO authenticated;

CREATE FUNCTION public.cockpit_media_native_read(p_operation text,p_args jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_media_native_records; rows jsonb; imported jsonb:='[]'; out jsonb; sync jsonb; source_at timestamptz; campaign text; today text:=to_char(now() AT TIME ZONE 'Asia/Kuwait','YYYY-MM-DD');
BEGIN
 IF p_operation='personalCalendars.mine' THEN PERFORM public.cockpit_media_calendar_scope(p_args->>'app');ELSE PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);END IF;
 IF p_operation='market.forClient' THEN RETURN public.cockpit_media_market_for_client(p_args->>'client'); END IF;
 IF p_operation='tracking.issues' THEN RETURN public.cockpit_media_native_source('trackingIssues'); END IF;
 IF p_operation='changeResults.source' THEN
  campaign:=p_args->>'campaignName';PERFORM public.cockpit_media_scope(p_operation,campaign);
  out:=jsonb_build_object('adChanges',(public.cockpit_media_native_source('adChanges',campaign))->'rows','manualChanges',(public.cockpit_media_native_source('manualChanges',campaign))->'rows');
  SELECT coalesce(jsonb_agg(data||jsonb_build_object('_id',id,'at',extract(epoch FROM created_at)*1000)),'[]') INTO rows FROM public.cockpit_media_native_records WHERE kind='manual' AND campaign_name=campaign;
  RETURN jsonb_set(out,'{manualChanges}',(out->'manualChanges')||rows);
 END IF;
 IF p_operation IN('chat.thread','chat.activity') THEN
  campaign:=CASE WHEN p_operation='chat.thread' THEN p_args->>'campaignId' END;
  IF p_operation='chat.thread' THEN PERFORM public.cockpit_media_scope(p_operation,campaign); END IF;
  SELECT source_snapshot_at INTO source_at FROM public.cockpit_media_source_state WHERE table_name='campaignChat' AND ready;
  IF source_at IS NOT NULL THEN imported:=(public.cockpit_media_native_source('campaignChat',campaign))->'rows'; END IF;
  SELECT coalesce(jsonb_agg(data||jsonb_build_object('_id',id,'at',extract(epoch FROM created_at)*1000)),'[]') INTO rows FROM public.cockpit_media_native_records WHERE kind='chat' AND (campaign IS NULL OR campaign_name=campaign) AND public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',client_name);
  rows:=rows||imported;
  IF p_operation='chat.thread' THEN
   rows:=rows||public.cockpit_media_campaign_history(campaign);
   RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'at')::numeric) FROM jsonb_array_elements(rows) x),'[]');
  END IF;
  SELECT data INTO sync FROM public.cockpit_media_sources s JOIN public.cockpit_media_source_state f ON f.table_name=s.table_name AND f.source_snapshot_at=s.source_snapshot_at WHERE s.table_name='syncRuns' AND f.ready ORDER BY (data->>'at')::numeric DESC LIMIT 1;
  RETURN jsonb_build_object('recent',(SELECT coalesce(jsonb_agg(x ORDER BY (x->>'at')::numeric DESC),'[]') FROM (SELECT x FROM jsonb_array_elements(rows) x ORDER BY (x->>'at')::numeric DESC LIMIT least(50,greatest(1,coalesce((p_args->>'limit')::integer,12)))) q),
   'queued',(SELECT count(*) FROM jsonb_array_elements(rows) x WHERE x->>'author'='her' AND x->>'status'='queued'),
   'waitingOnViktor',(SELECT count(*) FROM jsonb_array_elements(rows) x WHERE x->>'author'='her' AND x->>'pending'='true'),
   'lastSyncAt',sync->'at','lastSyncOk',sync->'ok','problems',coalesce(sync->'problems',jsonb_build_array('No verified sync receipt is available. Run the media source producer.')));
 END IF;
 IF p_operation='assist.queueDepth' THEN
  SELECT jsonb_build_object('queued',count(*) FILTER(WHERE data->>'status'='queued'),'working',count(*) FILTER(WHERE data->>'status'='working')) INTO out FROM public.cockpit_media_native_records WHERE kind='assist' AND public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',client_name);RETURN out;
 END IF;
 IF p_operation='assist.get' THEN
  SELECT * INTO r FROM public.cockpit_media_native_records WHERE id=(p_args->>'id')::uuid AND kind='assist';
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public.cockpit_media_request_scope(r.campaign_name,r.client_name);
  RETURN r.data||jsonb_build_object('_id',r.id,'requestedAt',extract(epoch FROM r.created_at)*1000);
 END IF;
 IF p_operation='personalCalendars.mine' THEN
  SELECT * INTO r FROM public.cockpit_media_native_records WHERE actor_id=auth.uid() AND kind='calendar' AND calendar_app=p_args->>'app';
  IF r.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=r.actor_id AND lower(u.email)=r.data->>'calendarId') AND NOT EXISTS(SELECT 1 FROM public.cockpit_media_calendar_owners o WHERE o.actor_id=r.actor_id AND o.calendar_id=r.data->>'calendarId') THEN
   RETURN jsonb_build_object('link',r.data-'today'-'calendarEvents'||jsonb_build_object('_id',r.id,'status','error','note','Calendar ownership is no longer verified. Unlink it or ask an administrator to verify ownership.'),'today','[]'::jsonb,'saEmail',(SELECT service_account_email FROM public.cockpit_media_calendar_config),'sourceNote','Calendar ownership is no longer verified. Cached meetings are hidden.');
  END IF;
  SELECT coalesce(jsonb_agg(e ORDER BY CASE WHEN e->>'allDay'='true' THEN (e->>'start')::date::timestamp AT TIME ZONE 'Asia/Kuwait' ELSE (e->>'start')::timestamptz END),'[]') INTO rows
  FROM jsonb_array_elements(coalesce(r.data->'calendarEvents','[]')) e WHERE
  CASE WHEN e->>'allDay'='true' THEN e->>'start'<=today AND e->>'end'>today
  ELSE (e->>'start')::timestamptz<(today::date+1)::timestamp AT TIME ZONE 'Asia/Kuwait' AND (e->>'end')::timestamptz>today::date::timestamp AT TIME ZONE 'Asia/Kuwait' END;
  RETURN jsonb_build_object('link',CASE WHEN r.id IS NOT NULL THEN r.data-'today'-'calendarEvents'||jsonb_build_object('_id',r.id) END,'today',rows,'saEmail',(SELECT service_account_email FROM public.cockpit_media_calendar_config),'sourceNote',CASE WHEN r.id IS NULL THEN 'Connect your calendar to see your meetings.' WHEN r.data->>'status'<>'ok' THEN coalesce(r.data->>'note','Waiting for the calendar worker to verify sharing.') WHEN jsonb_typeof(r.data->'calendarEvents') IS DISTINCT FROM 'array' OR r.data->'checkedAt' IS NULL THEN 'The complete calendar window has not been verified. Check the calendar worker.' WHEN (r.data->>'checkedAt')::numeric < extract(epoch FROM now()-interval '15 minutes')*1000 THEN 'Calendar data is older than 15 minutes. Check the calendar worker before relying on an empty day.' END);
 END IF;
 RAISE EXCEPTION 'Unsupported native media read: %',p_operation;
END $$;

CREATE FUNCTION public.cockpit_media_native_write(p_operation text,p_args jsonb,p_request_id uuid,p_apply boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_media_native_records; scope jsonb; v_kind text; data jsonb; name text; calendar text; email text;
BEGIN
 PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);
 IF NOT p_apply THEN RETURN jsonb_build_object('dryRun',true,'ok',false); END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable operation id is required'; END IF;
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
  IF p_operation='personalCalendars.unlink' THEN DELETE FROM public.cockpit_media_native_records WHERE kind='calendar' AND actor_id=auth.uid();RETURN jsonb_build_object('ok',true); END IF;
  calendar:=lower(btrim(p_args->>'calendarId'));
  IF calendar IS NULL OR calendar!~'^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN RAISE EXCEPTION 'Enter a Google calendar email, not a URL or credential'; END IF;
  IF calendar<>lower(email) AND NOT EXISTS(SELECT 1 FROM public.cockpit_media_calendar_owners WHERE actor_id=auth.uid() AND calendar_id=calendar) THEN RAISE EXCEPTION 'Use your verified cockpit email. Ask an administrator to verify ownership before linking another Google account.'; END IF;
  DELETE FROM public.cockpit_media_native_records WHERE kind='calendar' AND actor_id=auth.uid();
  v_kind:='calendar';data:=jsonb_build_object('calendarId',calendar,'status','pending','note','Waiting for the calendar worker to verify service-account sharing.','today','[]'::jsonb);
 ELSE RAISE EXCEPTION 'Unsupported native media write: %',p_operation;
 END IF;
 INSERT INTO public.cockpit_media_native_records(id,kind,actor_id,client_name,campaign_name,request,data) VALUES(p_request_id,v_kind,auth.uid(),scope->>'client',scope->>'campaignName',jsonb_build_object('operation',p_operation,'args',p_args),data);
 IF v_kind IN('chat','assist','calendar') THEN INSERT INTO public.cockpit_media_native_jobs(id,record_id,operation) VALUES(p_request_id,p_request_id,CASE v_kind WHEN 'chat' THEN 'chat.deliver' WHEN 'assist' THEN 'assist.run' ELSE 'calendar.refresh' END); END IF;
 RETURN jsonb_build_object('ok',true,'id',p_request_id);
END $$;

-- A worker claim is single-owner. Expired writes become reconcile, never queued.
CREATE FUNCTION public.cockpit_media_native_claim(p_apply boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cockpit_media_native_jobs; r public.cockpit_media_native_records;
BEGIN
 IF NOT p_apply THEN RETURN jsonb_build_object('dryRun',true,'queued',(SELECT count(*) FROM public.cockpit_media_native_jobs WHERE state='queued')); END IF;
 WITH expired AS(UPDATE public.cockpit_media_native_jobs SET state='reconcile',finished_at=now(),result=jsonb_build_object('error','Worker stopped without a receipt. Reconcile provider state before retrying.') WHERE state='working' AND claimed_at<now()-interval '30 minutes' RETURNING record_id)
 UPDATE public.cockpit_media_native_records SET data=data||jsonb_build_object('status','failed','pending',false,'error','Worker stopped without a receipt. Reconcile provider state before retrying.','note','The last provider outcome is unknown. No automatic duplicate will be sent.'),updated_at=now() WHERE id IN(SELECT record_id FROM expired);
 INSERT INTO public.cockpit_media_native_jobs(id,record_id,operation)
 SELECT gen_random_uuid(),r.id,'calendar.refresh' FROM public.cockpit_media_native_records r WHERE r.kind='calendar' AND r.updated_at<now()-interval '5 minutes' AND NOT EXISTS(SELECT 1 FROM public.cockpit_media_native_jobs q WHERE q.record_id=r.id AND q.state IN('queued','working')) ON CONFLICT DO NOTHING;
 SELECT * INTO j FROM public.cockpit_media_native_jobs WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.cockpit_media_native_records WHERE id=j.record_id;
 IF NOT public.cockpit_ask_ai_owner_allowed(r.actor_id,'media-buyer',CASE WHEN r.kind='calendar' THEN NULL ELSE r.client_name END) THEN
  UPDATE public.cockpit_media_native_jobs SET state='failed',finished_at=now(),result=jsonb_build_object('error','The requesting member no longer has access') WHERE id=j.id;
  UPDATE public.cockpit_media_native_records SET data=data||jsonb_build_object('status','failed','pending',false,'error','The requesting member no longer has access'),updated_at=now() WHERE id=r.id;
  RETURN jsonb_build_object('skipped',true);
 END IF;
 UPDATE public.cockpit_media_native_jobs SET state='working',claim_token=gen_random_uuid(),claimed_at=now() WHERE id=j.id RETURNING * INTO j;
 UPDATE public.cockpit_media_native_records SET data=data||jsonb_build_object('status',CASE WHEN kind='calendar' THEN 'pending' ELSE 'working' END),updated_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('job',to_jsonb(j),'record',to_jsonb(r));
END $$;

CREATE FUNCTION public.cockpit_media_native_worker_context(p_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cockpit_media_native_jobs;r public.cockpit_media_native_records;c public.cockpit_campaigns; rows jsonb;
BEGIN
 SELECT * INTO j FROM public.cockpit_media_native_jobs WHERE id=p_id AND claim_token=p_token AND state='working' AND claimed_at>now()-interval '30 minutes';
 IF NOT FOUND THEN RAISE EXCEPTION 'The worker claim is no longer current'; END IF;
 SELECT * INTO r FROM public.cockpit_media_native_records WHERE id=j.record_id;
 IF NOT public.cockpit_ask_ai_owner_allowed(r.actor_id,CASE WHEN r.kind='calendar' THEN r.calendar_app ELSE 'media-buyer' END,CASE WHEN r.kind='calendar' THEN NULL ELSE r.client_name END) THEN RAISE EXCEPTION 'The member no longer has client access'; END IF;
 IF r.campaign_name IS NOT NULL THEN
  SELECT * INTO c FROM public.cockpit_campaigns WHERE NOT source_deleted AND raw_data->>'campaignName'=r.campaign_name;
  IF NOT FOUND OR lower(btrim(coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name)))<>lower(btrim(r.client_name)) THEN RAISE EXCEPTION 'The campaign mapping changed'; END IF;
 END IF;
 SELECT coalesce(jsonb_object_agg(table_name,items),'{}') INTO rows FROM(
 SELECT s.table_name,jsonb_agg(s.data) items FROM public.cockpit_media_sources s JOIN public.cockpit_media_source_state f ON f.table_name=s.table_name AND f.source_snapshot_at=s.source_snapshot_at
 WHERE f.ready AND s.table_name IN('marketPlays','onboardings','launchWatch','clientPrefs','boardCards') AND EXISTS(SELECT 1 FROM unnest(s.client_names) n WHERE lower(btrim(n))=lower(btrim(r.client_name))) GROUP BY s.table_name) q;
 RETURN jsonb_build_object('record',to_jsonb(r),'campaign',to_jsonb(c),'sources',rows,'serviceAccountEmail',(SELECT service_account_email FROM public.cockpit_media_calendar_config),'clients',(SELECT coalesce(jsonb_agg(DISTINCT name),'[]') FROM(SELECT client_name name FROM public.cockpit_campaigns WHERE NOT source_deleted AND public.cockpit_ask_ai_owner_allowed(r.actor_id,CASE WHEN r.kind='calendar' THEN r.calendar_app ELSE 'media-buyer' END,client_name) UNION SELECT unnest(clients) FROM public.cockpit_members WHERE auth_user_id=r.actor_id) known));
END $$;
CREATE FUNCTION public.cockpit_media_native_finish(p_id uuid,p_token uuid,p_result jsonb,p_state text DEFAULT 'ready') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.cockpit_media_native_jobs;r public.cockpit_media_native_records;
BEGIN
 IF p_state NOT IN('ready','failed','reconcile') THEN RAISE EXCEPTION 'Invalid completion state'; END IF;
 SELECT * INTO j FROM public.cockpit_media_native_jobs WHERE id=p_id AND state='working' AND claim_token=p_token AND claimed_at>now()-interval '30 minutes' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The worker claim is no longer current'; END IF;
 IF p_state='ready' THEN PERFORM public.cockpit_media_native_worker_context(p_id,p_token); END IF;
 SELECT * INTO r FROM public.cockpit_media_native_records WHERE id=j.record_id;
 UPDATE public.cockpit_media_native_jobs SET state=p_state,result=p_result,finished_at=now() WHERE id=j.id;
 UPDATE public.cockpit_media_native_records SET data=data||p_result||jsonb_build_object('status',CASE WHEN p_state<>'ready' THEN CASE WHEN r.kind='calendar' THEN 'error' ELSE 'failed' END WHEN r.kind='calendar' THEN 'ok' WHEN r.kind='chat' THEN 'sent' ELSE 'ready' END,'pending',r.kind='chat' AND p_state='ready'),updated_at=now() WHERE id=r.id;
END $$;
-- Human Slack replies, not a generated campaign answer. Service-only and idempotent.
CREATE FUNCTION public.cockpit_media_native_reply(p_question uuid,p_message_id uuid,p_text text,p_author text,p_apply boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_media_native_records;
BEGIN
 IF NOT p_apply THEN RETURN jsonb_build_object('dryRun',true); END IF;
 SELECT * INTO r FROM public.cockpit_media_native_records WHERE id=p_question AND kind='chat' FOR UPDATE;
 IF NOT FOUND OR nullif(btrim(p_text),'') IS NULL OR nullif(btrim(p_author),'') IS NULL THEN RAISE EXCEPTION 'A real question, reply and author are required'; END IF;
 IF NOT public.cockpit_ask_ai_owner_allowed(r.actor_id,'media-buyer',r.client_name) THEN RAISE EXCEPTION 'The question owner no longer has access'; END IF;
 INSERT INTO public.cockpit_media_native_records(id,kind,actor_id,client_name,campaign_name,request,data) VALUES(p_message_id,'chat',r.actor_id,r.client_name,r.campaign_name,jsonb_build_object('question',p_question),jsonb_build_object('campaignName',r.campaign_name,'campaignId',r.campaign_name,'author','viktor','authorName',p_author,'text',btrim(p_text),'pending',false,'status','done','kind','reply')) ON CONFLICT(id) DO NOTHING;
 UPDATE public.cockpit_media_native_records SET data=data||jsonb_build_object('pending',false),updated_at=now() WHERE kind='chat' AND campaign_name=r.campaign_name AND data->>'author'='her';
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_native_audit(),public.cockpit_media_native_source(text,text),public.cockpit_media_market_for_client(text),public.cockpit_media_native_read(text,jsonb),public.cockpit_media_native_write(text,jsonb,uuid,boolean),public.cockpit_media_native_claim(boolean),public.cockpit_media_native_worker_context(uuid,uuid),public.cockpit_media_native_finish(uuid,uuid,jsonb,text),public.cockpit_media_native_reply(uuid,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_native_read(text,jsonb),public.cockpit_media_native_write(text,jsonb,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_native_claim(boolean),public.cockpit_media_native_worker_context(uuid,uuid),public.cockpit_media_native_finish(uuid,uuid,jsonb,text),public.cockpit_media_native_reply(uuid,uuid,text,text,boolean) TO service_role;
COMMIT;
