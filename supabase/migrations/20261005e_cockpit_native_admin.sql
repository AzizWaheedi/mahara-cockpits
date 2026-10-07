BEGIN;
CREATE FUNCTION public.cockpit_admin_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE access jsonb; monitor jsonb; checks jsonb:='[]'; item jsonb; sources jsonb:='[]'; alerts jsonb:='[]';
 workers jsonb:='[]'; health jsonb:='[]'; actions jsonb:='[]'; activity jsonb:='[]';
 family text; app text; state_table text; rows_table text; problem text; stamp timestamptz; at_ms bigint;
 max_age integer; good boolean; related jsonb; latest jsonb; last_sync jsonb; counts jsonb; hermes jsonb;
 members_count bigint; admins_count bigint; clients_count bigint; campaign_count bigint; live_count bigint;
 directory jsonb;client_names jsonb;client_error text;
BEGIN
 access:=public.cockpit_get_my_access();
 IF NOT(coalesce((access->>'is_admin')::boolean,false) OR coalesce((access->>'is_ceo')::boolean,false)) THEN
  RAISE EXCEPTION 'Current confirmed active directory admin or founder required' USING ERRCODE='42501';
 END IF;
 IF to_regprocedure('public.cockpit_native_monitor()') IS NULL THEN
  checks:=jsonb_build_array(jsonb_build_object('key','catalog:native','name','Native service monitor','ok',false,
   'error','Apply the verified native monitor migration in the coordinated release.','at',NULL,'max_age_min',NULL));
 ELSE
  monitor:=public.cockpit_native_monitor();checks:=monitor->'checks';
  IF jsonb_typeof(checks) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Native monitor returned an invalid check set';END IF;
 END IF;
 -- Read each actual source ledger and its complete snapshot, not a guessed provider success.
 FOREACH family IN ARRAY ARRAY['media','csm','creative'] LOOP
  state_table:='cockpit_'||family||'_source_state';rows_table:='cockpit_'||family||'_sources';problem:=NULL;stamp:=NULL;
  IF to_regclass('public.'||state_table) IS NULL OR to_regclass('public.'||rows_table) IS NULL THEN
   problem:='Native source ledger missing. Apply the verified source migration and reconcile its history.';
  ELSE
   EXECUTE format('SELECT CASE WHEN count(*)=0 THEN ''Source inventory is empty'' ELSE string_agg(s.table_name,'', '' ORDER BY s.table_name) FILTER(WHERE NOT s.ready OR s.row_count IS DISTINCT FROM (SELECT count(*) FROM public.%I r WHERE r.table_name=s.table_name AND r.source_snapshot_at=s.source_snapshot_at)) END,min(s.source_snapshot_at) FROM public.%I s',rows_table,state_table)
    INTO problem,stamp;
   IF problem IS NOT NULL AND problem<>'Source inventory is empty' THEN problem:='Unverified source inventories: '||problem;END IF;
  END IF;
  checks:=checks||jsonb_build_array(jsonb_build_object('key','source:family-'||family,'name',family||' canonical source snapshot',
   'ok',problem IS NULL AND stamp IS NOT NULL,'error',coalesce(problem,CASE WHEN stamp IS NULL THEN 'Source capture time missing' END),'at',stamp,'max_age_min',90));
 END LOOP;
 -- Sales already has a canonical mirror ledger. A completed successful run is the evidence.
 latest:=NULL;
 IF to_regclass('public.cockpit_sales_mirror_runs') IS NOT NULL THEN
  EXECUTE 'SELECT to_jsonb(r) FROM public.cockpit_sales_mirror_runs r ORDER BY started_at DESC,id DESC LIMIT 1' INTO latest;
 END IF;
 checks:=checks||jsonb_build_array(jsonb_build_object('key','worker:sales-mirror','name','Sales source mirror',
  'ok',latest IS NOT NULL AND coalesce((latest->>'ok')::boolean,false) AND latest->>'finished_at' IS NOT NULL,
  'error',CASE WHEN latest IS NULL THEN 'Sales mirror ledger missing or empty. Verify the native mirror release.'
   WHEN latest->>'finished_at' IS NULL THEN 'Latest sales mirror has not finished'
   WHEN NOT coalesce((latest->>'ok')::boolean,false) THEN coalesce(latest->>'error','Latest sales mirror failed') END,
  'at',latest->>'finished_at','max_age_min',45));
 -- Editor task sync timestamps are actual feed evidence, not an invented worker heartbeat.
 stamp:=NULL;
 IF to_regclass('public.editor_jobs') IS NOT NULL THEN EXECUTE 'SELECT max(synced_at) FROM public.editor_jobs' INTO stamp;END IF;
 checks:=checks||jsonb_build_array(jsonb_build_object('key','source:editor-feed','name','Editor ClickUp task feed',
  'ok',stamp IS NOT NULL,'error',CASE WHEN stamp IS NULL THEN 'Editor task feed has no recorded sync. Verify the desk source and worker.' END,
  'at',stamp,'max_age_min',45));
 IF to_regclass('public.editor_requests') IS NULL THEN
  checks:=checks||jsonb_build_array(jsonb_build_object('key','queue:editor','name','Editor request queue','ok',false,
   'error','Editor request queue missing. Verify the native desk catalog.','at',NULL,'max_age_min',NULL));
 ELSE
  EXECUTE 'SELECT jsonb_build_object(''key'',''queue:editor'',''name'',''Editor request queue'',''ok'',count(*) FILTER(WHERE status=''failed'')=0,
   ''error'',CASE WHEN count(*) FILTER(WHERE status=''failed'')>0 THEN ''Editor requests failed. Inspect the protected request ledger.'' END,
   ''at'',min(created_at) FILTER(WHERE status IN(''queued'',''processing'')),''max_age_min'',CASE WHEN count(*) FILTER(WHERE status IN(''queued'',''processing''))>0 THEN 20 END) FROM public.editor_requests'
   INTO item;
  checks:=checks||jsonb_build_array(item);
 END IF;
 -- max_age_min is a freshness policy, never a claimed installed cron schedule.
 FOR item IN SELECT value FROM jsonb_array_elements(checks) LOOP
  at_ms:=NULL;max_age:=(item->>'max_age_min')::integer;good:=coalesce((item->>'ok')::boolean,false);
  IF item->>'at' IS NOT NULL THEN at_ms:=(extract(epoch FROM (item->>'at')::timestamptz)*1000)::bigint;END IF;
  IF good AND max_age IS NOT NULL AND (at_ms IS NULL OR (item->>'at')::timestamptz<now()-make_interval(mins=>max_age)) THEN
   good:=false;item:=item||jsonb_build_object('ok',false,'error','Recorded data is overdue for the configured freshness limit. Run doctor and inspect the native worker.');
  END IF;
  sources:=sources||jsonb_build_array(jsonb_build_object('source',item->>'key','label',item->>'name','ok',good,
   'lastError',CASE WHEN NOT good THEN item->>'error' END,'at',at_ms,'maxAgeMin',max_age,
   'fix','Inspect the native ledger, reconciliation prerequisites and named worker configuration.'));
  IF NOT good THEN alerts:=alerts||jsonb_build_array(jsonb_build_object('at',at_ms,'text',(item->>'name')||': '||coalesce(item->>'error','Native check failed')));END IF;
  IF item->>'key' LIKE 'worker:%' THEN
   workers:=workers||jsonb_build_array(jsonb_build_object('job',item->>'name','key',item->>'key','at',at_ms,
    'maxAgeMin',max_age,'ms',NULL,'ok',good,'error',CASE WHEN NOT good THEN item->>'error' END));
  END IF;
 END LOOP;
 FOR app IN SELECT unnest(ARRAY['media-buyer','client-success','creative','video-editor','sales']) LOOP
  SELECT coalesce(jsonb_agg(s),'[]'::jsonb) INTO related FROM jsonb_array_elements(sources) s WHERE
   CASE app
    WHEN 'media-buyer' THEN s->>'source' IN('worker:media-core','source:family-media') OR s->>'source' LIKE 'source:cockpit_media_provider_health%'
    WHEN 'client-success' THEN s->>'source' IN('worker:media-core','source:family-csm','queue:eod') OR s->>'source' LIKE 'source:cockpit_csm_provider_health%'
    WHEN 'creative' THEN s->>'source' IN('worker:media-core','source:family-creative')
    WHEN 'video-editor' THEN s->>'source' IN('source:editor-feed','queue:editor')
    ELSE s->>'source'='worker:sales-mirror' END;
  SELECT jsonb_build_object('app',app,'ok',jsonb_array_length(related)>0 AND coalesce(bool_and((s->>'ok')::boolean),false),
   'at',min((s->>'at')::bigint),'failing',coalesce(jsonb_agg(coalesce(s->>'lastError',s->>'label')) FILTER(WHERE NOT(s->>'ok')::boolean),'[]'::jsonb))
   INTO item FROM jsonb_array_elements(related) s;
  health:=health||jsonb_build_array(item);
 END LOOP;
 SELECT count(*) FILTER(WHERE active),count(*) FILTER(WHERE active AND 'admin'=ANY(roles)) INTO members_count,admins_count FROM public.cockpit_members;
 SELECT coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('auth_confirmed',u.email_confirmed_at IS NOT NULL) ORDER BY m.name NULLS LAST,m.email),'[]'::jsonb) INTO directory FROM public.cockpit_members m LEFT JOIN auth.users u ON u.id=m.auth_user_id WHERE m.active;
 IF to_regclass('public.clients') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.clients') AND attname='is_active' AND NOT attisdropped) THEN
  EXECUTE 'SELECT count(*) FROM public.clients WHERE is_active' INTO clients_count;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.clients') AND attname='name' AND NOT attisdropped) THEN
   EXECUTE 'SELECT coalesce(jsonb_agg(name ORDER BY name) FILTER(WHERE name IS NOT NULL),''[]''::jsonb) FROM public.clients WHERE is_active' INTO client_names;
  END IF;
 END IF;
 IF client_names IS NULL THEN client_error:='The native client catalog is unavailable. Apply its verified schema and reconcile its source before editing client access.';END IF;
 IF to_regclass('public.cockpit_campaigns') IS NOT NULL THEN
  EXECUTE 'SELECT count(*),CASE WHEN count(*) FILTER(WHERE nullif(coalesce(raw_data->>''metaStatus'',raw_data->>''status''),'''') IS NULL)>0 THEN NULL ELSE count(*) FILTER(WHERE upper(coalesce(raw_data->>''metaStatus'',raw_data->>''status''))=''ACTIVE'') END FROM public.cockpit_campaigns WHERE NOT source_deleted' INTO campaign_count,live_count;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(sources) s WHERE s->>'source'='worker:media-core' AND (s->>'ok')::boolean) THEN live_count:=NULL;END IF;
 counts:=jsonb_build_object('members',members_count,'admins',admins_count,'clients',clients_count,'campaigns',campaign_count,'liveCampaigns',live_count);
 IF to_regclass('public.cockpit_ceo_refresh_runs') IS NOT NULL THEN
  EXECUTE 'SELECT jsonb_build_object(''at'',extract(epoch FROM coalesce(finished_at,created_at))*1000,''ok'',status=''published'',''problems'',CASE WHEN status=''published'' THEN ''[]''::jsonb ELSE jsonb_build_array(coalesce(error,''Latest CEO refresh has not published'')) END) FROM public.cockpit_ceo_refresh_runs ORDER BY created_at DESC LIMIT 1' INTO last_sync;
 END IF;
 IF to_regclass('public.cockpit_media_actions') IS NOT NULL THEN
  EXECUTE 'SELECT coalesce(jsonb_agg(a ORDER BY a->>''at'' DESC),''[]''::jsonb) FROM (SELECT jsonb_build_object(''at'',extract(epoch FROM coalesce(completed_at,created_at))*1000,''ok'',state=''confirmed'',''note'',operation||coalesce('' · ''||campaign_name,'''')) a FROM public.cockpit_media_actions WHERE created_at>now()-interval ''24 hours'' ORDER BY created_at DESC LIMIT 15) r' INTO actions;
 END IF;
 IF to_regclass('public.cockpit_ask_ai_jobs') IS NOT NULL THEN
  EXECUTE 'SELECT jsonb_build_object(''queued'',count(*) FILTER(WHERE status=''queued'' AND NOT hidden),''claimed'',count(*) FILTER(WHERE status=''claimed'' AND NOT hidden),''doneToday'',count(*) FILTER(WHERE status=''completed'' AND completed_at>=date_trunc(''day'',now() AT TIME ZONE ''Asia/Kuwait'') AT TIME ZONE ''Asia/Kuwait'' AND NOT hidden),''lastDone'',extract(epoch FROM max(completed_at) FILTER(WHERE status=''completed'' AND NOT hidden))*1000,''actions'',$1) FROM public.cockpit_ask_ai_jobs' INTO hermes USING actions;
 END IF;
 SELECT coalesce(jsonb_agg(a),'[]'::jsonb) INTO activity FROM (SELECT jsonb_build_object('id',id,'action',action,'entity',entity_type,'actor',actor_email,'at',extract(epoch FROM created_at)*1000) a FROM public.cockpit_audit_log ORDER BY created_at DESC,id DESC LIMIT 25) audit;
 RETURN jsonb_build_object('health',health,'sources',sources,'scheduled',workers,'counts',counts,'lastSync',last_sync,
  'hermes',hermes,'hermesWaiting',CASE WHEN hermes IS NOT NULL THEN jsonb_build_object('queued',hermes->'queued','claimed',hermes->'claimed') END,
  'alerts',alerts,'activity',activity,'members',directory,'clientNames',client_names,'clientError',client_error,
  'checkedAt',extract(epoch FROM now())*1000,'scheduleNote','Worker freshness is recorded here. Cron installation must be verified on the host.');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_admin_overview() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_admin_overview() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
