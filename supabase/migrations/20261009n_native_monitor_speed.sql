-- Native monitor speed, 2026-10-09 (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- cockpit_native_monitor took 31 s and the API timed out (HTTP 500, about 11
-- an hour), so the monitor itself was blind. Three causes:
--  0. The producer check read whole cockpit_native_media_runs rows with
--     to_jsonb(r), unpacking every ~2 MB published plan and sorting ~600 MB
--     on temp disk (14 s) on each call. It now reads only status, error and
--     the time column.
--  1. cockpit_native_monitor_base sorted every provider-ledger row through
--     to_jsonb(t)->>'provider' to find the latest receipt per resource. The
--     provider column exists on all three ledgers, so the read now uses the
--     (provider, resource, created_at, id) index from 20261009m.
--  2. cockpit_native_monitor ran two EXISTS probes per check, each hashing
--     every ledger row with md5(). A check key names its ledger, so only the
--     matching probe runs now, and it filters on indexed columns first.
-- Output is unchanged: verified equal to the previous functions on live data
-- in the same snapshot before the swap.

CREATE OR REPLACE FUNCTION public.cockpit_native_monitor_base()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 checks jsonb := '[]'::jsonb; item jsonb; last_good jsonb; row_data jsonb;
 name text; table_name text; key_name text; time_column text; good_column text; good_value text;
 limit_min integer; n bigint; pending bigint; failed bigint; oldest timestamptz;
 queue_ready boolean; queue_columns text[];
 missing text[] := '{}'; required_name text;
BEGIN
 -- Dynamic reads let a missing prerequisite report a failure instead of making
 -- this migration itself impossible to apply before all workers are installed.
 FOREACH required_name IN ARRAY ARRAY['cockpit_native_media_state','cockpit_native_media_claim',
  'cockpit_native_media_publish','cockpit_native_media_release','cockpit_ask_ai_health',
  'cockpit_claim_ask_ai_jobs','cockpit_claim_eod_outbox','cockpit_record_eod_receipt',
  'cockpit_team_calendar_report'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname=required_name
   AND has_function_privilege('service_role',p.oid,'EXECUTE')
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')) THEN
   missing := array_append(missing,required_name);
  END IF;
 END LOOP;
 checks := checks || jsonb_build_array(jsonb_build_object('key','catalog:native','name','Native service RPC catalog',
  'ok',cardinality(missing)=0,'error',CASE WHEN cardinality(missing)>0 THEN 'Missing or incorrectly granted service RPCs: '||array_to_string(missing,', ') END,
  'at',NULL,'max_age_min',NULL));
 FOREACH name IN ARRAY ARRAY['money','expenses','growth','webinar','b2bAds','delivery','calls','clients',
  'team','hiring','portal','assets','organic','machine'] LOOP
  item := NULL;
  IF to_regclass('public.cockpit_sections') IS NOT NULL THEN
   EXECUTE 'SELECT to_jsonb(s) FROM public.cockpit_sections s WHERE key=$1' INTO item USING name;
  END IF;
  checks := checks || jsonb_build_array(jsonb_build_object('key','section:'||name,'name','CEO section '||name,
   'ok',coalesce((item->>'ok')::boolean,false),'error',coalesce(item->>'error',CASE WHEN item IS NULL THEN 'Required section missing' END),
   'at',item->>'computed_at','max_age_min',45));
 END LOOP;
 FOR table_name,key_name,time_column,good_column,good_value,limit_min IN VALUES
  ('cockpit_native_media_runs','media-core','published_at','status','published',90),
  ('cockpit_ceo_refresh_runs','ceo-refresh','finished_at','status','published',45)
 LOOP
  item := NULL; last_good := NULL;
  IF to_regclass('public.'||table_name) IS NOT NULL THEN
   -- Read only the columns the check uses. to_jsonb(r) unpacked every 2 MB
   -- media plan and sorted ~600 MB on disk on each monitor call.
   EXECUTE format('SELECT jsonb_build_object(%L,r.%I,''error'',r.error) FROM public.%I r ORDER BY r.created_at DESC LIMIT 1',
    good_column,good_column,table_name) INTO item;
   EXECUTE format('SELECT jsonb_build_object(%L,r.%I) FROM public.%I r WHERE r.%I=$1 ORDER BY r.%I DESC NULLS LAST LIMIT 1',
    time_column,time_column,table_name,good_column,time_column) INTO last_good USING good_value;
  END IF;
  checks := checks || jsonb_build_array(jsonb_build_object('key','worker:'||key_name,'name','Native producer '||key_name,
   'ok',item IS NOT NULL AND last_good IS NOT NULL AND coalesce(item->>good_column,'') IN (good_value,'claimed'),
   'error',coalesce(item->>'error',CASE WHEN item IS NULL THEN 'Producer ledger missing or empty; run doctor and install its cron'
    WHEN last_good IS NULL THEN 'Producer has never published successfully' ELSE 'Latest producer run failed' END),
   'at',last_good->>time_column,'max_age_min',limit_min));
 END LOOP;
 item := NULL;
 IF to_regclass('public.cockpit_team_calendar_worker') IS NOT NULL THEN
  EXECUTE 'SELECT to_jsonb(w) FROM public.cockpit_team_calendar_worker w WHERE singleton' INTO item;
 END IF;
 checks := checks || jsonb_build_array(jsonb_build_object('key','worker:team-calendar','name','Team calendar worker doctor',
  'ok',coalesce((item->>'ready')::boolean,false),'error',coalesce(item->>'error','Worker doctor has not reported ready'),
  'at',item->>'checked_at','max_age_min',15));

 -- Queue health is based on pending work, not a made-up periodic success when idle.
 FOREACH table_name IN ARRAY ARRAY['cockpit_ask_ai_jobs','eod_outbox'] LOOP
  pending := 0; failed := 0; oldest := NULL;
  key_name := CASE WHEN table_name='eod_outbox' THEN 'eod' ELSE 'ask-ai' END;
  queue_columns := CASE WHEN key_name='ask-ai' THEN ARRAY['status','created_at','updated_at','hidden']
    ELSE ARRAY['status','created_at','reconciliation_needed'] END;
  SELECT count(*)=cardinality(queue_columns) INTO queue_ready FROM pg_catalog.pg_attribute
   WHERE attrelid=to_regclass('public.'||table_name) AND attnum>0 AND NOT attisdropped
    AND attname=ANY(queue_columns);
  IF queue_ready THEN
   IF key_name='ask-ai' THEN
    EXECUTE 'SELECT count(*) FILTER(WHERE status IN (''queued'',''claimed'') AND NOT hidden),
     min(created_at) FILTER(WHERE status IN (''queued'',''claimed'') AND NOT hidden),
     count(*) FILTER(WHERE status=''failed'' AND updated_at>now()-interval ''1 hour'' AND NOT hidden)
     FROM public.cockpit_ask_ai_jobs' INTO pending,oldest,failed;
   ELSE
    EXECUTE 'SELECT count(*) FILTER(WHERE status IN (''queued'',''processing'')),
     min(created_at) FILTER(WHERE status IN (''queued'',''processing'')),
     count(*) FILTER(WHERE status=''failed'' OR reconciliation_needed)
     FROM public.eod_outbox' INTO pending,oldest,failed;
   END IF;
  END IF;
  checks := checks || jsonb_build_array(jsonb_build_object('key','queue:'||key_name,'name','Native queue '||key_name,
   'ok',queue_ready AND failed < CASE WHEN key_name='ask-ai' THEN 10 ELSE 1 END,
   'error',CASE WHEN to_regclass('public.'||table_name) IS NULL THEN 'Required queue table missing'
    WHEN NOT queue_ready THEN 'Required queue columns missing; native delivery is unavailable'
    WHEN failed>0 THEN failed::text||' failed or reconciliation-required jobs' END,
   'at',oldest,'max_age_min',CASE WHEN pending>0 THEN 20 END));
 END LOOP;
 -- Publishing a recent section while financial source revisions disagree is not healthy.
 IF to_regclass('public.cockpit_manual_payment_state') IS NOT NULL THEN
  EXECUTE 'SELECT to_jsonb(s) FROM public.cockpit_manual_payment_state s WHERE id' INTO item;
  checks := checks || jsonb_build_array(jsonb_build_object('key','source:finance-revision','name','Finance source revision',
   'ok',item IS NOT NULL AND coalesce((item->>'history_ready')::boolean,false) AND item->>'revision'=item->>'totals_revision',
   'error',CASE WHEN NOT coalesce((item->>'history_ready')::boolean,false) THEN 'Manual payment history has not been reconciled' ELSE 'Finance source revision differs from computed totals' END,'at',NULL,'max_age_min',NULL));
 ELSE
  checks := checks || jsonb_build_array(jsonb_build_object('key','source:finance-revision','name','Finance source revision',
   'ok',false,'error','Finance source state missing','at',NULL,'max_age_min',NULL));
 END IF;
 item := NULL;
 IF to_regclass('public.cockpit_finance_source_state') IS NOT NULL THEN
  EXECUTE 'SELECT to_jsonb(s) FROM public.cockpit_finance_source_state s WHERE id' INTO item;
 END IF;
 checks := checks || jsonb_build_array(jsonb_build_object('key','source:finance-readiness','name','Finance source reconciliation',
  'ok',coalesce((item->>'aliases_ready')::boolean,false) AND coalesce((item->>'manual_ready')::boolean,false),
  'error',CASE WHEN item IS NULL THEN 'Finance source readiness missing' ELSE 'Finance aliases or manual payments have not been reconciled' END,'at',NULL,'max_age_min',NULL));
 FOREACH table_name IN ARRAY ARRAY['cockpit_media_provider_health','cockpit_csm_provider_health','cockpit_ceo_provider_health'] LOOP
  IF to_regclass('public.'||table_name) IS NULL THEN
   checks := checks || jsonb_build_array(jsonb_build_object('key','source:'||table_name,'name',table_name,
    'ok',false,'error','Required provider receipt ledger missing','at',NULL,'max_age_min',NULL));
  ELSE
   -- Latest non-intent receipt per provider+resource, read from the
   -- (provider, resource, created_at DESC, id DESC) WHERE phase<>'intent' index.
   FOR row_data IN EXECUTE format('SELECT to_jsonb(r) FROM (SELECT DISTINCT ON (t.provider,t.resource)
    coalesce(t.provider,%L) AS provider,t.resource,t.phase,t.http_status,t.created_at
    FROM public.%I t WHERE t.phase<>''intent'' ORDER BY t.provider,t.resource,t.created_at DESC,t.id DESC) r
    WHERE phase=''unknown'' OR http_status IS NULL OR http_status>=400 ORDER BY r.provider,r.resource',table_name,table_name) LOOP
    checks := checks || jsonb_build_array(jsonb_build_object('key','source:'||table_name||':'||md5(row_data->>'resource'),
     'name','Provider '||(row_data->>'provider'),'ok',false,'error','Latest provider receipt is unsuccessful; inspect its protected ledger',
     'at',row_data->>'created_at','max_age_min',NULL));
   END LOOP;
  END IF;
 END LOOP;
 -- Slack transport failures remain visible even when a Supabase read succeeds.
 FOR row_data IN SELECT to_jsonb(r) FROM (SELECT DISTINCT ON(resource) resource,ok,created_at
  FROM public.cockpit_monitor_receipts WHERE resource LIKE 'slack.com/%'
  ORDER BY resource,created_at DESC,id DESC) r WHERE NOT ok LOOP
  checks := checks || jsonb_build_array(jsonb_build_object('key','source:watchdog:'||md5(row_data->>'resource'),
   'name','Watchdog Slack transport','ok',false,'error','Latest Slack call failed; inspect Vercel logs and Slack scopes',
   'at',row_data->>'created_at','max_age_min',NULL));
 END LOOP;
 RETURN jsonb_build_object('version',1,'checked_at',now(),'checks',checks);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_native_monitor()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE snapshot jsonb; filtered jsonb; check_item jsonb; check_key text; superseded boolean;
BEGIN
 snapshot:=public.cockpit_native_monitor_base();
 filtered:='[]'::jsonb;
 FOR check_item IN SELECT value FROM jsonb_array_elements(snapshot->'checks') LOOP
  check_key:=check_item->>'key';
  superseded:=false;
  IF check_key LIKE 'source:cockpit_media_provider_health:%' THEN
   -- The ledger records the upload response, not its later public GET. A proof
   -- alone is insufficient: require the exact content-addressed path in canonical
   -- saved still state and an actual published native media run too.
   superseded:=EXISTS (
    SELECT 1 FROM public.cockpit_media_provider_health t
    JOIN public.cockpit_native_still_readback p ON p.resource=t.resource
    JOIN public.cockpit_native_stills s ON s.data->>'status'='saved'
     AND s.data->>'url'='https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/' || substring(t.resource from length('/storage/v1/object/')+1)
    WHERE t.provider='storage' AND t.method='POST' AND t.phase='response' AND t.http_status>=400
     AND check_key='source:cockpit_media_provider_health:'||md5(t.resource)
     AND p.http_status=200 AND p.verified_at>t.created_at
     AND EXISTS (SELECT 1 FROM public.cockpit_native_media_runs r WHERE r.status='published')
     AND t.id=(SELECT latest.id FROM public.cockpit_media_provider_health latest
       WHERE latest.provider=t.provider AND latest.resource=t.resource AND latest.phase<>'intent'
       ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1));
  ELSIF check_key LIKE 'source:cockpit_ceo_provider_health:%' THEN
   -- A later *canonical* CEO publication supersedes only this exact publish RPC,
   -- never another CEO provider failure. A partial run is a committed publish.
   superseded:=EXISTS (
    SELECT 1 FROM public.cockpit_ceo_provider_health t
    JOIN public.cockpit_ceo_refresh_runs r ON r.status IN ('published','partial')
     AND r.created_at>t.created_at AND r.finished_at>t.created_at
    WHERE t.method='POST' AND t.resource ~ '/rest/v1/rpc/cockpit_ceo_refresh_publish$'
     AND t.phase='response' AND t.http_status>=400
     AND check_key='source:cockpit_ceo_provider_health:'||md5(t.resource)
     AND t.id=(SELECT latest.id FROM public.cockpit_ceo_provider_health latest
       WHERE latest.provider=t.provider AND latest.resource=t.resource AND latest.phase='response'
       ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1));
  END IF;
  IF NOT superseded THEN
   filtered:=filtered||jsonb_build_array(check_item);
  END IF;
 END LOOP;
 RETURN jsonb_set(snapshot,'{checks}',filtered);
END $function$;
