-- Native monitor: a provider call counts as failing only while its latest receipt is under 24 hours old, a picture
-- upload refused because the object already exists is not a failure, and each failing call carries its resource.
--
-- Why (26 Oct 2026): cockpit_native_monitor_base flagged every provider+resource whose latest receipt failed, with
-- no time limit. Most resources are one-off calls (one picture upload, one Meta object), so one failure stayed red
-- forever and the guardian's "Native worker evidence" was Broken from 9 Oct with no name. All 51 failed storage
-- receipts were Supabase's 400 for an object that already exists; every one of those objects is in storage.objects.
-- The two live failures (the Churn Tracker 403, now shared, and Ardon's lead form 4584687278486426) stay visible.
--
-- Built from the live definition (pg_get_functiondef, identical to 20261019140000_native_monitor_skip_scan) with two
-- exact replacements in the provider-receipt loop. CREATE OR REPLACE keeps the owner and the service_role-only grant.
-- Safe to apply twice.

BEGIN;
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
   -- Latest non-intent receipt per provider+resource. The recursive CTE reads
   -- one entry per group from the (provider, resource, created_at DESC, id DESC)
   -- WHERE phase<>'intent' index, then jumps to the next group, instead of
   -- walking every receipt as DISTINCT ON did.
   FOR row_data IN EXECUTE format('WITH RECURSIVE g AS (
     (SELECT t.provider,t.resource,t.phase,t.http_status,t.created_at,t.id FROM public.%1$I t
       WHERE t.phase<>''intent'' ORDER BY t.provider,t.resource,t.created_at DESC,t.id DESC LIMIT 1)
     UNION ALL
     SELECT n.provider,n.resource,n.phase,n.http_status,n.created_at,n.id FROM g CROSS JOIN LATERAL (
      SELECT t.provider,t.resource,t.phase,t.http_status,t.created_at,t.id FROM public.%1$I t
       WHERE t.phase<>''intent'' AND (t.provider,t.resource)>(g.provider,g.resource)
       ORDER BY t.provider,t.resource,t.created_at DESC,t.id DESC LIMIT 1) n)
    SELECT to_jsonb(r) FROM (SELECT coalesce(g.provider,%2$L) AS provider,g.resource,g.phase,g.http_status,g.created_at FROM g) r
    WHERE (phase=''unknown'' OR http_status IS NULL OR http_status>=400)
     AND r.created_at>now()-interval ''24 hours''
     AND NOT (r.provider=''storage'' AND r.http_status=400 AND EXISTS(SELECT 1 FROM storage.objects o
      WHERE o.bucket_id=substring(r.resource from ''^/storage/v1/object/([^/]+)/'')
       AND o.name=substring(r.resource from ''^/storage/v1/object/[^/]+/(.+)$'')))
    ORDER BY r.provider,r.resource',table_name,table_name) LOOP
    checks := checks || jsonb_build_array(jsonb_build_object('key','source:'||table_name||':'||md5(row_data->>'resource'),
     'name','Provider '||(row_data->>'provider'),'ok',false,'error','Latest provider receipt is unsuccessful; inspect its protected ledger',
     'detail',left(row_data->>'resource',110)||' ('||coalesce(row_data->>'http_status',row_data->>'phase')||')',
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
COMMIT;
