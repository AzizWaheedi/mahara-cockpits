-- Native monitors read authoritative producer state, never a mirrored machine payload.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_monitor_receipts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 resource text NOT NULL, method text NOT NULL CHECK(method IN ('GET','POST')),
 ok boolean NOT NULL, http_status integer, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cockpit_monitor_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_monitor_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.cockpit_monitor_receipts TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_monitor_receipts_id_seq TO service_role;
CREATE INDEX IF NOT EXISTS cockpit_monitor_receipts_resource_at ON public.cockpit_monitor_receipts(resource,created_at DESC);

CREATE OR REPLACE FUNCTION public.cockpit_native_monitor() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 checks jsonb := '[]'::jsonb; item jsonb; last_good jsonb; row_data jsonb;
 name text; table_name text; key_name text; time_column text; good_column text; good_value text;
 limit_min integer; n bigint; pending bigint; failed bigint; oldest timestamptz;
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
   EXECUTE format('SELECT to_jsonb(r) FROM public.%I r ORDER BY created_at DESC LIMIT 1',table_name) INTO item;
   EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE %I=$1 ORDER BY %I DESC NULLS LAST LIMIT 1',table_name,good_column,time_column)
    INTO last_good USING good_value;
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
  IF to_regclass('public.'||table_name) IS NOT NULL THEN
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
   'ok',to_regclass('public.'||table_name) IS NOT NULL AND failed < CASE WHEN key_name='ask-ai' THEN 10 ELSE 1 END,
   'error',CASE WHEN to_regclass('public.'||table_name) IS NULL THEN 'Required queue table missing'
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
   FOR row_data IN EXECUTE format('SELECT to_jsonb(r) FROM (SELECT DISTINCT ON (coalesce(to_jsonb(t)->>''provider'',%L),t.resource)
    coalesce(to_jsonb(t)->>''provider'',%L) AS provider,t.resource,t.phase,t.http_status,t.created_at
    FROM public.%I t WHERE t.phase<>''intent'' ORDER BY coalesce(to_jsonb(t)->>''provider'',%L),t.resource,t.created_at DESC,t.id DESC) r
    WHERE phase=''unknown'' OR http_status IS NULL OR http_status>=400',table_name,table_name,table_name,table_name) LOOP
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
END $$;
REVOKE ALL ON FUNCTION public.cockpit_native_monitor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_native_monitor() TO service_role;
CREATE OR REPLACE VIEW public.cockpit_native_monitor_state WITH (security_invoker=true) AS SELECT public.cockpit_native_monitor() AS snapshot;
REVOKE ALL ON public.cockpit_native_monitor_state FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cockpit_native_monitor_state TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
