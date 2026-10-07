BEGIN;
-- Provider calendars reuse the immutable, fenced native publication. Personal
-- choices remain in the existing actor/app bindings and durable CAS receipts.
CREATE FUNCTION public.cockpit_calendar_overview(p_app text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE mine jsonb; run public.cockpit_native_media_runs; source public.cockpit_csm_source_state; meta jsonb; google jsonb; item jsonb;
 events jsonb:='[]'; ghl_events jsonb[]:='{}'; notes text[]:='{}'; states jsonb:='[]'; full_scope boolean; configured boolean:=false; complete boolean:=true;
 from_ms numeric:=extract(epoch FROM now()-interval '7 days')*1000; to_ms numeric:=extract(epoch FROM now()+interval '21 days')*1000;
 fresh_min numeric; stamp timestamptz; valid boolean; visible jsonb; details jsonb; count_source bigint; global_count bigint;
BEGIN
 PERFORM public.cockpit_media_calendar_scope(p_app);
 full_scope:=public.cockpit_csm_scope_all();mine:=public.cockpit_media_calendar_mine(p_app);
 IF mine->'link' IS NOT NULL AND mine->'link'<>'null'::jsonb THEN
  configured:=true;
  IF mine->>'sourceNote' IS NOT NULL THEN notes:=array_append(notes,mine->>'sourceNote');complete:=false;END IF;
  SELECT r.data->'calendarEvents' INTO visible FROM public.cockpit_media_native_records r
  WHERE r.actor_id=auth.uid() AND r.kind='calendar' AND r.calendar_app=p_app
  AND (EXISTS(SELECT 1 FROM auth.users u WHERE u.id=r.actor_id AND lower(u.email)=r.data->>'calendarId')
   OR EXISTS(SELECT 1 FROM public.cockpit_media_calendar_owners o WHERE o.actor_id=r.actor_id AND o.calendar_id=r.data->>'calendarId'));
  IF jsonb_typeof(visible)='array' THEN events:=events||visible;END IF;
  IF jsonb_typeof(mine->'link'->'checkedAt')='number' THEN fresh_min:=(mine->'link'->>'checkedAt')::numeric;END IF;
 END IF;
 -- Original policy: Media Buyer sees no shared client calendars. Creative sees
 -- GHL Brand Blueprint calendars only. Explicit shared Google IDs are per app.
 IF p_app<>'media-buyer' THEN
  SELECT * INTO run FROM public.cockpit_native_media_runs WHERE status='published' ORDER BY published_at DESC LIMIT 1;
  SELECT * INTO source FROM public.cockpit_csm_source_state WHERE table_name='appointments';
  meta:=run.plan->'csmCalendar';stamp:=(run.plan->>'source_snapshot_at')::timestamptz;
  SELECT count(*) INTO count_source FROM public.cockpit_csm_sources WHERE table_name='appointments';
  valid:=meta IS NOT NULL AND jsonb_typeof(meta->'from')='number' AND jsonb_typeof(meta->'to')='number'
   AND jsonb_typeof(meta->'checkedAt')='number' AND jsonb_typeof(meta->'calendars')='array' AND jsonb_typeof(meta->'eventIds')='array'
   AND jsonb_typeof(run.plan->'csm'->'appointments')='array' AND source.ready
   AND source.source_snapshot_at=stamp AND source.row_count=count_source
   AND count_source=jsonb_array_length(run.plan->'csm'->'appointments')
   AND (SELECT coalesce(jsonb_agg(s.data ORDER BY s.source_id),'[]') FROM public.cockpit_csm_sources s WHERE s.table_name='appointments' AND s.source_snapshot_at=stamp)
    =(SELECT coalesce(jsonb_agg(e ORDER BY e->>'_id'),'[]') FROM jsonb_array_elements(run.plan->'csm'->'appointments') e)
   AND (SELECT count(DISTINCT id) FROM jsonb_array_elements_text(meta->'eventIds') id)=jsonb_array_length(meta->'eventIds')
   AND (SELECT count(*) FROM public.cockpit_csm_sources s WHERE s.table_name='appointments' AND s.data->>'apptId' IN(SELECT jsonb_array_elements_text(meta->'eventIds')))=jsonb_array_length(meta->'eventIds');
  IF valid IS TRUE THEN
   configured:=true;
   IF (meta->>'from')::numeric>from_ms OR (meta->>'to')::numeric<to_ms THEN complete:=false;notes:=array_append(notes,'Shared calendar coverage is incomplete. Refresh the native media worker.');END IF;
   IF (meta->>'checkedAt')::numeric<extract(epoch FROM now()-interval '15 minutes')*1000 THEN complete:=false;notes:=array_append(notes,'Shared calendar data is older than 15 minutes. Check the native media worker.');END IF;
   SELECT count(*) INTO global_count FROM jsonb_array_elements(meta->'calendars') c WHERE p_app='client-success' OR c->>'name' ILIKE '%blueprint%';
   states:=states||jsonb_build_array(jsonb_build_object('provider','ghl','configured',true,'checkedAt',meta->'checkedAt','calendars',global_count));
   fresh_min:=least(fresh_min,(meta->>'checkedAt')::numeric);
   FOR item IN SELECT s.data FROM public.cockpit_csm_sources s WHERE s.table_name='appointments'
    AND s.source_snapshot_at=stamp AND s.data->>'apptId' IN(SELECT jsonb_array_elements_text(meta->'eventIds')) AND coalesce(s.data->>'status','')!~*'cancel'
    AND (p_app='client-success' OR s.data->>'calendar' ILIKE '%blueprint%') LOOP
    IF jsonb_typeof(item->'startTime') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'endTime') IS DISTINCT FROM 'string'
     OR coalesce(item->>'startTime','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' OR coalesce(item->>'endTime','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$'
     OR nullif(item->>'calendarId','') IS NULL OR nullif(item->>'apptId','') IS NULL
    THEN complete:=false;notes:=array_append(notes,'Shared calendar details are incomplete. Refresh the native media worker.');CONTINUE;END IF;
    IF extract(epoch FROM (item->>'startTime')::timestamptz)*1000>=to_ms OR extract(epoch FROM (item->>'endTime')::timestamptz)*1000<=from_ms THEN CONTINUE;END IF;
    IF NOT full_scope AND (nullif(btrim(item->>'clientName'),'') IS NULL OR NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),p_app,item->>'clientName')) THEN
     IF nullif(btrim(item->>'clientName'),'') IS NULL THEN notes:=array_append(notes,'Shared events without a verified client match are hidden from your assigned-client view.');END IF;CONTINUE;
    END IF;
    ghl_events:=array_append(ghl_events,jsonb_strip_nulls(jsonb_build_object('eventId',item->>'apptId','calendarId',item->>'calendarId','calendarName',item->>'calendar','title',coalesce(item->>'title',item->>'calendar'),'start',item->>'startTime','end',item->>'endTime','allDay',false,'kind',CASE WHEN nullif(item->>'clientName','') IS NOT NULL THEN 'client' ELSE 'other' END,'clientName',item->>'clientName','attendees',CASE WHEN nullif(item->>'contactName','') IS NOT NULL THEN jsonb_build_array(item->>'contactName') ELSE '[]'::jsonb END,'location',item->>'joinUrl','meetLink',CASE WHEN item->>'joinUrl' LIKE 'https://%' THEN item->>'joinUrl' END,'description',item->>'notes')));
   END LOOP;
   events:=events||to_jsonb(ghl_events);
  ELSE complete:=false;notes:=array_append(notes,'The native shared-calendar feed has not published verified data. Refresh the native media worker.');
   states:=states||jsonb_build_array(jsonb_build_object('provider','ghl','configured',NULL,'checkedAt',NULL,'calendars',NULL));
  END IF;
  google:=run.plan->'googleCalendars'->p_app;
  IF google->'configured'='true'::jsonb THEN
   configured:=true;
   IF jsonb_typeof(google->'events') IS DISTINCT FROM 'array' OR jsonb_typeof(google->'checkedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(google->'from') IS DISTINCT FROM 'number' OR jsonb_typeof(google->'to') IS DISTINCT FROM 'number' OR jsonb_typeof(google->'calendarIds') IS DISTINCT FROM 'array' THEN
    complete:=false;notes:=array_append(notes,'The shared Google calendar read is incomplete. Refresh the native media worker.');
   ELSE
    IF (google->>'to')::numeric-(google->>'from')::numeric<>28*86400000::numeric OR (google->>'checkedAt')::numeric<extract(epoch FROM now()-interval '15 minutes')*1000 THEN complete:=false;notes:=array_append(notes,'Shared Google calendar coverage is stale or incomplete. Refresh the native media worker.');END IF;
    states:=states||jsonb_build_array(jsonb_build_object('provider','google','configured',true,'checkedAt',google->'checkedAt','calendars',jsonb_array_length(google->'calendarIds')));
    fresh_min:=least(fresh_min,(google->>'checkedAt')::numeric);
    SELECT coalesce(jsonb_agg(e),'[]') INTO visible FROM jsonb_array_elements(google->'events') e
     WHERE full_scope OR (nullif(btrim(e->>'clientName'),'') IS NOT NULL AND public.cockpit_ask_ai_owner_allowed(auth.uid(),p_app,e->>'clientName'));
    events:=events||visible;
    IF NOT full_scope AND EXISTS(SELECT 1 FROM jsonb_array_elements(google->'events') e WHERE nullif(btrim(e->>'clientName'),'') IS NULL) THEN notes:=array_append(notes,'Shared events without a verified client match are hidden from your assigned-client view.');END IF;
   END IF;
  ELSIF google->'configured'='false'::jsonb THEN states:=states||jsonb_build_array(jsonb_build_object('provider','google','configured',false,'checkedAt',NULL,'calendars',NULL));
  ELSE complete:=false;notes:=array_append(notes,'Shared Google calendar configuration is not verified. Refresh the native media worker.');states:=states||jsonb_build_array(jsonb_build_object('provider','google','configured',NULL,'checkedAt',NULL,'calendars',NULL));END IF;
 END IF;
 IF NOT configured THEN complete:=false;notes:=array_append(notes,'Connect your own calendar or ask an administrator to configure the native shared-calendar feed.');END IF;
 WITH scored AS MATERIALIZED(
  SELECT e,CASE WHEN e->>'allDay'='true' THEN (e->>'start')::date::timestamp AT TIME ZONE 'Asia/Kuwait' ELSE (e->>'start')::timestamptz END starts,
   CASE WHEN e->>'allDay'='true' THEN (e->>'end')::date::timestamp AT TIME ZONE 'Asia/Kuwait' ELSE (e->>'end')::timestamptz END ends FROM jsonb_array_elements(events) e
 ), bounded AS MATERIALIZED(SELECT * FROM scored WHERE starts<to_timestamp(to_ms/1000) AND ends>to_timestamp(from_ms/1000))
 SELECT jsonb_build_object(
  'today',coalesce((SELECT jsonb_agg(e ORDER BY starts) FROM bounded WHERE starts<((now() AT TIME ZONE 'Asia/Kuwait')::date+1)::timestamp AT TIME ZONE 'Asia/Kuwait' AND ends>(now() AT TIME ZONE 'Asia/Kuwait')::date::timestamp AT TIME ZONE 'Asia/Kuwait'),'[]'),
  'upcoming',coalesce((SELECT jsonb_agg(e ORDER BY starts) FROM(SELECT * FROM bounded WHERE starts>=((now() AT TIME ZONE 'Asia/Kuwait')::date+1)::timestamp AT TIME ZONE 'Asia/Kuwait' ORDER BY starts LIMIT 60) future),'[]'),
  'nextCall',coalesce((SELECT jsonb_agg(e ORDER BY starts) FROM(SELECT DISTINCT ON(lower(e->>'clientName')) * FROM bounded WHERE nullif(e->>'clientName','') IS NOT NULL AND ends>now() ORDER BY lower(e->>'clientName'),starts) upcoming_clients),'[]')) INTO details;
 RETURN details||jsonb_build_object('calendarConfigured',configured,'calendarReady',complete,'myCalendar',mine->'link','bindingRevision',mine->'bindingRevision','saEmail',mine->'saEmail','sourceNote',nullif(array_to_string(ARRAY(SELECT DISTINCT note FROM unnest(notes) note),' '),''),'syncedAt',CASE WHEN complete THEN fresh_min END,'calendarSources',states);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_calendar_overview(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_calendar_overview(text) TO authenticated;
COMMIT;
