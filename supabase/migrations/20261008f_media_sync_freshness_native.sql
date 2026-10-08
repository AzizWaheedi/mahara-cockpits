-- Freshness for the media buyer screens (8 Oct 2026). The Ads banner and the
-- "synced" time read the newest Convex syncRuns row, which stopped on 7 Oct when
-- the native worker took over. The native worker records each run in
-- cockpit_native_media_runs. This helper returns the newest of the two, in the
-- syncRuns shape ({_id, at, ok, problems, health}), or NULL when neither exists.
CREATE OR REPLACE FUNCTION public.cockpit_media_latest_sync()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE legacy jsonb; run record; later record;
BEGIN
 SELECT s.data INTO legacy FROM public.cockpit_media_sources s JOIN public.cockpit_media_source_state f ON f.table_name=s.table_name AND f.source_snapshot_at=s.source_snapshot_at
  WHERE s.table_name='syncRuns' AND f.ready ORDER BY (s.data->>'at')::numeric DESC LIMIT 1;
 SELECT r.run_id,r.published_at INTO run FROM public.cockpit_native_media_runs r WHERE r.status='published' AND r.published_at IS NOT NULL ORDER BY r.published_at DESC LIMIT 1;
 IF run.run_id IS NULL OR (legacy IS NOT NULL AND (legacy->>'at')::numeric>=extract(epoch FROM run.published_at)*1000) THEN RETURN legacy; END IF;
 -- A later run that never published is a problem to show, not a fresher time.
 SELECT r.created_at INTO later FROM public.cockpit_native_media_runs r WHERE r.created_at>run.published_at AND r.status IN('expired','failed') ORDER BY r.created_at DESC LIMIT 1;
 RETURN jsonb_build_object('_id','native:'||run.run_id,'at',round(extract(epoch FROM run.published_at)*1000),'ok',later.created_at IS NULL,'health',NULL,
  'problems',CASE WHEN later.created_at IS NULL THEN '[]'::jsonb ELSE jsonb_build_array('The refresh that started '||to_char(later.created_at AT TIME ZONE 'Asia/Kuwait','HH24:MI')||' Kuwait did not finish. These numbers are from the refresh before it.') END);
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_media_latest_sync() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_media_source_read()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE seat public.cockpit_members; feed record; result jsonb:='{}'; provenance jsonb:='{}'; rows jsonb; unrestricted boolean;
BEGIN
 IF NOT(public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Verified media-buyer access required' USING ERRCODE='42501';END IF;
 SELECT * INTO seat FROM public.cockpit_members WHERE auth_user_id=auth.uid();
 unrestricted:=cardinality(seat.clients)=0 OR 'admin'=ANY(seat.roles) OR public.cockpit_is_ceo();
 IF (SELECT count(*) FROM public.cockpit_media_source_state)<>17 THEN RAISE EXCEPTION 'Media source configuration is incomplete';END IF;
 FOR feed IN SELECT * FROM public.cockpit_media_source_state LOOP
  IF NOT feed.ready OR feed.source_snapshot_at IS NULL OR feed.row_count IS NULL OR feed.row_count<>(SELECT count(*) FROM public.cockpit_media_sources WHERE table_name=feed.table_name AND source_snapshot_at=feed.source_snapshot_at) THEN
   RAISE EXCEPTION 'Media source % is not imported and verified yet',feed.table_name;END IF;
  SELECT coalesce(jsonb_agg(safe.data ORDER BY safe.at),'[]'::jsonb) INTO rows FROM (
   SELECT CASE
    WHEN feed.table_name='clientComments' THEN jsonb_build_object('_id',s.source_id,'taskId',s.data->'taskId','clientName',s.data->'clientName','at',s.data->'at','kind',s.data->'kind','status',s.data->'status',
      'digest',jsonb_build_object('forAds',coalesce((SELECT jsonb_agg(item) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(s.data->'digest'->'forAds')='array' THEN s.data->'digest'->'forAds' ELSE '[]'::jsonb END) AS item
       WHERE item!~* 'contract|payment|paid|deposit|invoice|revenue|signed|\mfees?\M'),'[]'::jsonb)))
    WHEN feed.table_name='syncRuns' THEN jsonb_build_object('_id',s.source_id,'at',s.data->'at','problems',s.data->'problems','health',s.data->'health')
    WHEN feed.table_name='clickupMembers' THEN jsonb_build_object('_id',s.source_id,'id',s.data->'id','name',s.data->'name','username',s.data->'username')
    ELSE s.data END AS data,coalesce((s.data->>'at')::numeric,0) AS at
   FROM public.cockpit_media_sources s WHERE s.table_name=feed.table_name AND s.source_snapshot_at=feed.source_snapshot_at
    AND (feed.table_name IN('syncRuns','clickupMembers','marketPlays') OR unrestricted OR EXISTS(
     SELECT 1 FROM unnest(s.client_names) n JOIN unnest(seat.clients) c ON lower(btrim(n))=lower(btrim(c))
    ))
    AND (feed.table_name<>'syncRuns' OR s.source_id=(SELECT source_id FROM public.cockpit_media_sources WHERE table_name='syncRuns' AND source_snapshot_at=feed.source_snapshot_at ORDER BY (data->>'at')::numeric DESC LIMIT 1))
  ) safe;
  result:=result||jsonb_build_object(feed.table_name,rows);
  provenance:=provenance||jsonb_build_object(feed.table_name,jsonb_build_object('at',feed.source_snapshot_at,'rowCount',feed.row_count));
 END LOOP;
 -- The native worker records its runs in cockpit_native_media_runs, not syncRuns.
 result:=jsonb_set(result,'{syncRuns}',(SELECT CASE WHEN v IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v-'ok') END FROM (SELECT public.cockpit_media_latest_sync() AS v) latest));
 RETURN jsonb_build_object('tables',result,'source',provenance);
END;$function$;

CREATE OR REPLACE FUNCTION public.cockpit_media_native_read(p_operation text, p_args jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  sync:=public.cockpit_media_latest_sync();
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
END $function$;
