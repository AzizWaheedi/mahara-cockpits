-- Repair migration restoring canonical provider and CEO/finance refresh RPC definitions.
-- Sources:
--   1. 20260927i_cockpit_finance_refresh.sql
--   2. 20261004e_cockpit_ceo_providers.sql
--   3. 20261004b_csm_providers.sql
--   4. 20261005b_cockpit_ceo_refresh_worker.sql
-- Note: No provider activation or cron scheduling included.
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Source: 20260927i_cockpit_finance_refresh.sql
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_finance_client_aliases(
  source_kind text NOT NULL CHECK(source_kind IN ('client','link')),source_id text NOT NULL,
  task_id text,name text NOT NULL,aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(aliases)='array'),csm text,source_record jsonb NOT NULL,
  PRIMARY KEY(source_kind,source_id)
);
CREATE TABLE IF NOT EXISTS public.cockpit_finance_source_state(id boolean PRIMARY KEY DEFAULT true CHECK(id),aliases_ready boolean NOT NULL DEFAULT false,manual_ready boolean NOT NULL DEFAULT false);

ALTER TABLE public.cockpit_finance_client_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_finance_source_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_finance_client_aliases,public.cockpit_finance_source_state FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_finance_client_aliases,public.cockpit_finance_source_state TO service_role;

ALTER TABLE public.cockpit_client_payments ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.cockpit_client_payments ADD COLUMN IF NOT EXISTS source_refresh_id uuid;
ALTER TABLE public.cockpit_ceo_provider_health DROP CONSTRAINT IF EXISTS cockpit_ceo_provider_health_method_check;
ALTER TABLE public.cockpit_ceo_provider_health ADD CONSTRAINT cockpit_ceo_provider_health_method_check CHECK(method IN ('GET','POST'));
ALTER TABLE public.cockpit_ceo_provider_health ADD COLUMN IF NOT EXISTS refresh_id uuid;

CREATE OR REPLACE FUNCTION public.cockpit_finance_alias_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
 UPDATE cockpit_manual_payment_state SET revision=revision+1,updated_at=now() WHERE id;
 UPDATE cockpit_finance_source_state SET aliases_ready=false WHERE id;
 INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
 VALUES('finance.aliasImported','cockpit_finance_client_aliases',NEW.source_kind||':'||NEW.source_id,coalesce(auth.jwt()->>'email','finance-import'),'media-buyer-cockpit','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_finance_alias_changed() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cockpit_finance_alias_changed ON public.cockpit_finance_client_aliases;
CREATE TRIGGER cockpit_finance_alias_changed AFTER INSERT OR UPDATE ON public.cockpit_finance_client_aliases FOR EACH ROW EXECUTE FUNCTION public.cockpit_finance_alias_changed();

CREATE OR REPLACE FUNCTION public.cockpit_begin_finance_refresh() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job cockpit_finance_refreshes; rev bigint; who text;
BEGIN
 IF NOT cockpit_is_ceo() THEN RAISE EXCEPTION 'Founder access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cockpit_finance_source_state WHERE aliases_ready AND manual_ready) THEN RAISE EXCEPTION 'Finance source history has not been reconciled'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('cockpit_finance_refresh'));
 SELECT * INTO job FROM cockpit_finance_refreshes WHERE status='running' ORDER BY created_at DESC LIMIT 1;
 IF job.id IS NOT NULL AND job.created_at>now()-interval '5 minutes' THEN RETURN jsonb_build_object('id',job.id,'existing',true,'revision',job.revision); END IF;
 IF job.id IS NOT NULL THEN
  UPDATE cockpit_finance_refreshes SET status='failed',error='Refresh exceeded its time limit; start a fresh read',finished_at=now() WHERE id=job.id;
  INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata) VALUES('finance.expired','cockpit_finance_refreshes',job.id::text,job.actor_email,'media-buyer-cockpit','supabase','{}');
 END IF;
 SELECT revision INTO rev FROM cockpit_manual_payment_state WHERE id;
 IF rev IS NULL THEN RAISE EXCEPTION 'Finance source state is missing'; END IF;
 SELECT lower(email) INTO who FROM auth.users WHERE id=auth.uid();
 INSERT INTO cockpit_finance_refreshes(actor_id,actor_email,revision) VALUES(auth.uid(),who,rev) RETURNING * INTO job;
 INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after) VALUES('finance.started','cockpit_finance_refreshes',job.id::text,who,'media-buyer-cockpit','supabase',to_jsonb(job));
 RETURN jsonb_build_object('id',job.id,'existing',false,'revision',rev);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_finance_refresh_status(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job cockpit_finance_refreshes;
BEGIN
 IF NOT cockpit_is_ceo() THEN RAISE EXCEPTION 'Founder access required'; END IF;
 SELECT * INTO job FROM cockpit_finance_refreshes WHERE id=p_id;
 IF job.id IS NULL THEN RAISE EXCEPTION 'Finance refresh not found'; END IF;
 RETURN jsonb_build_object('id',job.id,'status',CASE WHEN job.status='running' AND job.created_at<now()-interval '5 minutes' THEN 'failed' ELSE job.status END,'error',CASE WHEN job.status='running' AND job.created_at<now()-interval '5 minutes' THEN 'Refresh exceeded its time limit; start a fresh read' ELSE job.error END,'result',job.result);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_finish_finance_refresh(p_id uuid,p_output jsonb DEFAULT NULL,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job cockpit_finance_refreshes; rev bigint; section jsonb; point jsonb; row_data jsonb; previous jsonb; section_count integer; since_day date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('cockpit_finance_refresh'));
 SELECT * INTO job FROM cockpit_finance_refreshes WHERE id=p_id FOR UPDATE;
 IF job.id IS NULL THEN RAISE EXCEPTION 'Finance refresh not found'; END IF;
 IF job.status='confirmed' THEN RETURN job.result; END IF;
 IF job.status<>'running' THEN RAISE EXCEPTION 'Finance refresh is no longer running'; END IF;
 IF p_error IS NOT NULL THEN
  UPDATE cockpit_finance_refreshes SET status='failed',error=left(p_error,2000),finished_at=now() WHERE id=p_id;
  INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata) VALUES('finance.failed','cockpit_finance_refreshes',p_id::text,job.actor_email,'media-buyer-cockpit','supabase',jsonb_build_object('error',left(p_error,2000)));
  RETURN jsonb_build_object('ok',false,'error',left(p_error,2000));
 END IF;
 PERFORM cockpit_finance_refresh_input(p_id); -- Re-check founder and source import readiness at the write boundary.
 SELECT revision INTO rev FROM cockpit_manual_payment_state WHERE id FOR UPDATE;
 IF rev<>job.revision THEN RAISE EXCEPTION 'Finance inputs changed during this refresh; run it again'; END IF;
 IF job.created_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'Finance refresh expired'; END IF;
 IF jsonb_typeof(p_output->'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(p_output->'sections')<>2 OR jsonb_typeof(p_output->'payments') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete finance output'; END IF;
 SELECT count(DISTINCT s->>'key') INTO section_count FROM jsonb_array_elements(p_output->'sections') s WHERE s->>'key' IN ('money','expenses');
 IF section_count<>2 THEN RAISE EXCEPTION 'Money and expenses must commit together'; END IF;
 FOR section IN SELECT * FROM jsonb_array_elements(p_output->'sections') LOOP
  IF jsonb_typeof(section->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(section->'sources') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(section->'sources') s WHERE (s->>'ok')::boolean IS NOT TRUE) THEN RAISE EXCEPTION 'Unconfirmed finance source'; END IF;
  IF section->>'key'='money' AND (jsonb_typeof(section#>'{payload,attribution,transactions}') IS DISTINCT FROM 'array' OR section#>'{payload,rails,manual}' IS NULL) THEN RAISE EXCEPTION 'Attribution or manual source missing'; END IF;
  SELECT to_jsonb(s) INTO previous FROM cockpit_sections s WHERE key=section->>'key';
  INSERT INTO cockpit_sections(key,label,ok,error,computed_at,payload,sources) VALUES(section->>'key',section->>'label',true,NULL,now(),section->'payload',section->'sources')
   ON CONFLICT(key) DO UPDATE SET label=excluded.label,ok=true,error=NULL,computed_at=now(),payload=excluded.payload,sources=excluded.sources,updated_at=now();
  INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata) VALUES('finance.refreshed','cockpit_sections',section->>'key',job.actor_email,'media-buyer-cockpit','supabase',previous,section,jsonb_build_object('refreshId',p_id,'revision',rev));
  FOR point IN SELECT * FROM jsonb_array_elements(coalesce(section->'daily','[]'::jsonb)) LOOP
   IF point->>'metric' !~ '^(money|expenses)[.]' OR jsonb_typeof(point->'value') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid finance history point'; END IF;
   INSERT INTO cockpit_metric_days(day,metric,scope,value) VALUES((point->>'date')::date,point->>'metric',point->>'scope',(point->>'value')::double precision)
    ON CONFLICT(day,metric,scope) DO UPDATE SET value=excluded.value,captured_at=now();
  END LOOP;
 END LOOP;
 since_day:=date_trunc('month',now() AT TIME ZONE 'Asia/Kuwait')::date-interval '11 months';
 UPDATE cockpit_client_payments SET active=false,source_refresh_id=p_id WHERE day>=since_day AND active;
 FOR row_data IN SELECT * FROM jsonb_array_elements(p_output->'payments') LOOP
  INSERT INTO cockpit_client_payments(payment_id,clickup_task_id,client_name,day,usd,rail,side,kind,person,active,source_refresh_id)
   VALUES(row_data->>'payment_id',row_data->>'clickup_task_id',row_data->>'client_name',(row_data->>'day')::date,(row_data->>'usd')::numeric,row_data->>'rail',row_data->>'side',row_data->>'kind',row_data->>'person',true,p_id)
   ON CONFLICT(payment_id) DO UPDATE SET clickup_task_id=excluded.clickup_task_id,client_name=excluded.client_name,day=excluded.day,usd=excluded.usd,rail=excluded.rail,side=excluded.side,kind=excluded.kind,person=excluded.person,active=true,source_refresh_id=p_id,recorded_at=now();
 END LOOP;
 UPDATE cockpit_manual_payment_state SET totals_revision=rev,history_ready=true,updated_at=now() WHERE id;
 UPDATE cockpit_finance_refreshes SET status='confirmed',result=jsonb_build_object('ok',true,'id',p_id,'revision',rev,'sections',jsonb_build_array('money','expenses'),'payments',jsonb_array_length(p_output->'payments')),finished_at=now() WHERE id=p_id RETURNING result INTO previous;
 INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after) VALUES('finance.confirmed','cockpit_finance_refreshes',p_id::text,job.actor_email,'media-buyer-cockpit','supabase',previous);
 RETURN previous;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_begin_finance_refresh(),public.cockpit_finance_refresh_status(uuid),public.cockpit_finish_finance_refresh(uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_begin_finance_refresh(),public.cockpit_finance_refresh_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_finish_finance_refresh(uuid,jsonb,text) TO service_role;

-- -----------------------------------------------------------------------------
-- 2. Source: 20261004e_cockpit_ceo_providers.sql
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT lower(btrim(email)) FROM public.cockpit_people
    WHERE active AND email IS NOT NULL AND btrim(email) <> ''
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Resolve duplicate normalized emails on active cockpit_people rows before applying the CEO provider migration';
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_people_active_email_normalized_uidx
  ON public.cockpit_people(lower(btrim(email))) WHERE active AND email IS NOT NULL AND btrim(email) <> '';

CREATE TABLE IF NOT EXISTS public.cockpit_ceo_frequency_cache (
  from_day date NOT NULL,
  to_day date NOT NULL,
  computed_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(from_day,to_day),
  CHECK(to_day>=from_day)
);
ALTER TABLE public.cockpit_ceo_frequency_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ceo_frequency_cache FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cockpit_ceo_frequency_cache TO service_role;

CREATE TABLE IF NOT EXISTS public.cockpit_ceo_workspace_imports (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(result IS NULL OR jsonb_typeof(result)='object')
);
ALTER TABLE public.cockpit_ceo_workspace_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ceo_workspace_imports FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cockpit_ceo_workspace_imports TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_verified_actor_email(p_actor_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT lower(btrim(u.email))
  FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
  WHERE m.auth_user_id=p_actor_id AND m.active AND u.email_confirmed_at IS NOT NULL
    AND m.email=lower(btrim(u.email))
    AND lower(btrim(u.email)) IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
$$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_verified_actor_email(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_frequency_cache_upsert(p_actor_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text; v_from date; v_to date; v_computed_ms numeric; old_payload jsonb; new_payload jsonb;
BEGIN
  actor:=public.cockpit_ceo_verified_actor_email(p_actor_id);
  IF actor IS NULL THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR coalesce(p_payload->>'from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR coalesce(p_payload->>'to','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR jsonb_typeof(p_payload->'computedAt') IS DISTINCT FROM 'number'
    OR (jsonb_typeof(p_payload->'note') IS DISTINCT FROM 'string' AND jsonb_typeof(p_payload->'note') IS DISTINCT FROM 'null')
    OR (jsonb_typeof(p_payload->'leadGen') IS DISTINCT FROM 'object' AND jsonb_typeof(p_payload->'leadGen') IS DISTINCT FROM 'null')
    OR (jsonb_typeof(p_payload->'retargeting') IS DISTINCT FROM 'object' AND jsonb_typeof(p_payload->'retargeting') IS DISTINCT FROM 'null') THEN
    RAISE EXCEPTION 'Frequency cache payload was not confirmed' USING ERRCODE='22023';
  END IF;
  v_from:=(p_payload->>'from')::date; v_to:=(p_payload->>'to')::date; v_computed_ms:=(p_payload->>'computedAt')::numeric;
  IF to_char(v_from,'YYYY-MM-DD')<>p_payload->>'from' OR to_char(v_to,'YYYY-MM-DD')<>p_payload->>'to' OR v_to<v_from OR v_computed_ms<=0 THEN
    RAISE EXCEPTION 'Frequency cache range or computation time is invalid' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_payload->'leadGen')='object' AND (
    jsonb_typeof(p_payload#>'{leadGen,campaigns}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{leadGen,impressions}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{leadGen,reach}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{leadGen,spend}') IS DISTINCT FROM 'number'
    OR (jsonb_typeof(p_payload#>'{leadGen,frequency}') IS DISTINCT FROM 'number' AND jsonb_typeof(p_payload#>'{leadGen,frequency}') IS DISTINCT FROM 'null')
  ) THEN RAISE EXCEPTION 'Lead-gen frequency values were not confirmed' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_payload->'retargeting')='object' AND (
    jsonb_typeof(p_payload#>'{retargeting,campaigns}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{retargeting,impressions}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{retargeting,reach}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{retargeting,spend}') IS DISTINCT FROM 'number'
    OR (jsonb_typeof(p_payload#>'{retargeting,frequency}') IS DISTINCT FROM 'number' AND jsonb_typeof(p_payload#>'{retargeting,frequency}') IS DISTINCT FROM 'null')
  ) THEN RAISE EXCEPTION 'Retargeting frequency values were not confirmed' USING ERRCODE='22023'; END IF;
  PERFORM set_config('cockpit.ceo_actor_email',actor,true);
  SELECT payload INTO old_payload FROM public.cockpit_ceo_frequency_cache WHERE from_day=v_from AND to_day=v_to;
  INSERT INTO public.cockpit_ceo_frequency_cache(from_day,to_day,computed_at,payload,updated_at)
  VALUES(v_from,v_to,to_timestamp((v_computed_ms/1000)::double precision),p_payload,now())
  ON CONFLICT(from_day,to_day) DO UPDATE SET computed_at=excluded.computed_at,payload=excluded.payload,updated_at=now();
  SELECT to_jsonb(c) INTO new_payload FROM public.cockpit_ceo_frequency_cache c WHERE c.from_day=v_from AND c.to_day=v_to;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
  VALUES('frequency.cache','cockpit_ceo_frequency_cache',v_from::text||'..'||v_to::text,actor,'ceo','supabase',old_payload,new_payload);
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_frequency_cache_upsert(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_frequency_cache_upsert(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_workspace_import(
  p_actor_id uuid,p_request_id uuid,p_source_hash text,p_source_complete boolean,p_users jsonb,p_emails jsonb,p_apply boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor text;
  imported public.cockpit_ceo_workspace_imports;
  user_row jsonb;
  email text;
  normalized_email text;
  person_name text;
  person_role text;
  normalized_name text;
  selected_emails text[]:=ARRAY[]::text[];
  seen_emails text[]:=ARRAY[]::text[];
  seen_names text[]:=ARRAY[]::text[];
  eligible_count integer:=0;
  already_there integer:=0;
  inserted_id bigint;
  added jsonb:='[]'::jsonb;
  v_result jsonb;
BEGIN
  actor:=public.cockpit_ceo_verified_actor_email(p_actor_id);
  IF actor IS NULL THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Workspace import needs a stable request ID' USING ERRCODE='22023'; END IF;
  SELECT * INTO imported FROM public.cockpit_ceo_workspace_imports WHERE request_id=p_request_id;
  IF p_users IS NULL THEN
    IF p_source_complete IS TRUE OR p_apply IS TRUE THEN RAISE EXCEPTION 'Workspace source was not confirmed' USING ERRCODE='22023'; END IF;
    IF FOUND THEN
      IF imported.actor_id<>p_actor_id THEN RAISE EXCEPTION 'Workspace request ID belongs to another founder' USING ERRCODE='42501'; END IF;
      IF imported.result IS NULL THEN RAISE EXCEPTION 'Workspace import receipt is incomplete; retry with the same request ID' USING ERRCODE='40001'; END IF;
      RETURN imported.result||jsonb_build_object('existing',true,'replayed',true);
    END IF;
    RETURN jsonb_build_object('existing',false);
  END IF;
  IF p_source_complete IS DISTINCT FROM true OR p_source_hash IS NULL OR p_source_hash !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_users) IS DISTINCT FROM 'array' OR jsonb_array_length(p_users)>2000
    OR jsonb_typeof(p_emails) IS DISTINCT FROM 'array' OR p_apply IS NULL THEN
    RAISE EXCEPTION 'A complete Google Workspace directory source is required' USING ERRCODE='22023';
  END IF;
  FOR user_row IN SELECT value FROM jsonb_array_elements(p_users) LOOP
    IF jsonb_typeof(user_row) IS DISTINCT FROM 'object'
      OR jsonb_typeof(user_row->'email') IS DISTINCT FROM 'string'
      OR jsonb_typeof(user_row->'name') IS DISTINCT FROM 'string'
      OR jsonb_typeof(user_row->'suspended') IS DISTINCT FROM 'boolean'
      OR (jsonb_typeof(user_row->'title') IS DISTINCT FROM 'string' AND jsonb_typeof(user_row->'title') IS DISTINCT FROM 'null') THEN
      RAISE EXCEPTION 'Workspace directory row is invalid' USING ERRCODE='22023';
    END IF;
    email:=btrim(user_row->>'email'); normalized_email:=lower(email);
    IF email='' OR email !~ '^[^[:space:]@]+@[^[:space:]@]+$' OR normalized_email=ANY(seen_emails) THEN
      RAISE EXCEPTION 'Workspace directory contains an invalid or duplicate normalized email' USING ERRCODE='22023';
    END IF;
    seen_emails:=array_append(seen_emails,normalized_email);
    person_name:=coalesce(nullif(btrim(user_row->>'name'),''),email);
    normalized_name:=regexp_replace(lower(person_name),'[^[:alnum:]]','','g');
    IF normalized_name=ANY(seen_names) THEN RAISE EXCEPTION 'Workspace directory contains duplicate normalized names; no roster rows were changed' USING ERRCODE='22023'; END IF;
    seen_names:=array_append(seen_names,normalized_name);
  END LOOP;
  FOR user_row IN SELECT value FROM jsonb_array_elements(p_emails) LOOP
    IF jsonb_typeof(user_row) IS DISTINCT FROM 'string' OR btrim(user_row#>>'{}')='' THEN
      RAISE EXCEPTION 'Workspace email filter is invalid' USING ERRCODE='22023';
    END IF;
    selected_emails:=array_append(selected_emails,lower(btrim(user_row#>>'{}')));
  END LOOP;
  IF imported.request_id IS NOT NULL AND imported.actor_id<>p_actor_id THEN
    RAISE EXCEPTION 'Workspace request ID belongs to another founder' USING ERRCODE='42501';
  END IF;
  IF imported.request_id IS NOT NULL AND imported.result IS NOT NULL THEN
    IF imported.source_hash<>p_source_hash THEN RAISE EXCEPTION 'Workspace request ID was already used for a different source snapshot' USING ERRCODE='22023'; END IF;
    RETURN imported.result||jsonb_build_object('existing',true,'replayed',true);
  END IF;
  PERFORM set_config('cockpit.ceo_actor_email',actor,true);
  IF p_apply THEN
    INSERT INTO public.cockpit_ceo_workspace_imports(request_id,actor_id,source_hash)
    VALUES(p_request_id,p_actor_id,p_source_hash) ON CONFLICT(request_id) DO NOTHING;
    SELECT * INTO imported FROM public.cockpit_ceo_workspace_imports WHERE request_id=p_request_id FOR UPDATE;
    IF imported.actor_id<>p_actor_id THEN RAISE EXCEPTION 'Workspace request ID belongs to another founder' USING ERRCODE='42501'; END IF;
    IF imported.result IS NOT NULL THEN
      IF imported.source_hash<>p_source_hash THEN RAISE EXCEPTION 'Workspace request ID was already used for a different source snapshot' USING ERRCODE='22023'; END IF;
      RETURN imported.result||jsonb_build_object('existing',true,'replayed',true);
    END IF;
  END IF;
  FOR user_row IN SELECT value FROM jsonb_array_elements(p_users) LOOP
    IF (user_row->>'suspended')::boolean THEN CONTINUE; END IF;
    email:=btrim(user_row->>'email'); normalized_email:=lower(email);
    IF cardinality(selected_emails)>0 AND NOT normalized_email=ANY(selected_emails) THEN CONTINUE; END IF;
    eligible_count:=eligible_count+1;
    person_name:=coalesce(nullif(btrim(user_row->>'name'),''),email);
    person_role:=nullif(btrim(user_row->>'title'),'');
    normalized_name:=regexp_replace(lower(person_name),'[^[:alnum:]]','','g');
    IF EXISTS(SELECT 1 FROM public.cockpit_people p WHERE lower(btrim(coalesce(p.email,'')))=normalized_email OR regexp_replace(lower(p.name),'[^[:alnum:]]','','g')=normalized_name) THEN
      already_there:=already_there+1;
      CONTINUE;
    END IF;
    IF p_apply THEN
      inserted_id:=NULL;
      INSERT INTO public.cockpit_people(name,email,role,engagement,active,monthly_cost,currency,commission_basis,commission_rate,commission_pct,is_sales,source,added_by)
      VALUES(person_name,normalized_email,person_role,'staff',true,NULL,'USD','none',NULL,NULL,false,'workspace',actor)
      ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
      IF inserted_id IS NULL THEN already_there:=already_there+1;
      ELSE added:=added||jsonb_build_array(person_name); END IF;
    ELSE
      added:=added||jsonb_build_array(person_name);
    END IF;
  END LOOP;
  v_result:=jsonb_build_object('ok',true,'requestId',p_request_id,'added',added,'alreadyThere',already_there,
    'dryRun',NOT p_apply,'replayed',false,'sourceUsers',jsonb_array_length(p_users),'eligibleUsers',eligible_count);
  IF p_apply THEN
    UPDATE public.cockpit_ceo_workspace_imports SET result=v_result WHERE request_id=p_request_id;
    INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after,metadata)
    VALUES('people.workspace.import','cockpit_ceo_workspace_imports',p_request_id::text,actor,'ceo','supabase',v_result,
      jsonb_build_object('sourceHash',p_source_hash,'sourceUsers',jsonb_array_length(p_users),'eligibleUsers',eligible_count));
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_workspace_import(uuid,uuid,text,boolean,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_workspace_import(uuid,uuid,text,boolean,jsonb,jsonb,boolean) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Source: 20261004b_csm_providers.sql
-- -----------------------------------------------------------------------------

ALTER TABLE public.cockpit_csm_actions DROP CONSTRAINT IF EXISTS cockpit_csm_actions_operation_check;
ALTER TABLE public.cockpit_csm_actions ADD CONSTRAINT cockpit_csm_actions_operation_check
  CHECK (operation IN ('act','plan','projections.bookCall'));
ALTER TABLE public.cockpit_csm_provider_health ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'clickup';
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_csm_booking_once
  ON public.cockpit_csm_actions ((context->>'taskId'), (context->>'bookingWhen'))
  WHERE operation='projections.bookCall';

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_finish_booking(p_id uuid,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_csm_actions; booking_result jsonb;
BEGIN
  SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id FOR UPDATE;
  IF a.id IS NULL OR a.operation<>'projections.bookCall' THEN RAISE EXCEPTION 'Booking receipt not found'; END IF;
  IF a.state='confirmed' THEN RETURN a.result; END IF;
  IF a.state NOT IN ('sending','reconcile') OR p_result->>'ok' IS DISTINCT FROM 'true'
     OR coalesce(p_result->>'eventId','') !~ '^[A-Za-z0-9_-]{1,150}$'
     OR p_result->>'when' IS DISTINCT FROM a.context->>'bookingWhen'
     OR p_result->>'title' IS DISTINCT FROM a.result->>'title'
     OR coalesce(p_result->>'title','') ~* '(upgrad|up-?sell|renew)'
  THEN RAISE EXCEPTION 'Booking providers have not been confirmed'; END IF;
  -- The service-only native recorder checks the actor is still active, assigned
  -- to this client, and (where supplied) still allowed into the meeting.
  PERFORM public.cockpit_csm_projection_record_booking(a.actor_id,a.context->>'taskId',p_result->>'when',p_result->>'eventId',a.request->>'meetingId');
  INSERT INTO public.cockpit_csm_client_overrides(task_id,client_name,data,action_id)
    VALUES(a.context->>'taskId',a.context->>'clientName',jsonb_build_object('nextPoc',a.request->>'day'),a.id)
    ON CONFLICT(task_id) DO UPDATE SET
      data=(CASE WHEN EXISTS(
        SELECT 1 FROM public.cockpit_csm_sources r
        JOIN public.cockpit_csm_source_state st ON st.table_name=r.table_name AND st.source_snapshot_at=r.source_snapshot_at AND st.ready
        WHERE r.table_name='clients' AND r.data->>'taskId'=public.cockpit_csm_client_overrides.task_id
          AND (r.data->>'syncedAt')::numeric>=extract(epoch FROM public.cockpit_csm_client_overrides.confirmed_at)*1000
      ) THEN '{}'::jsonb ELSE public.cockpit_csm_client_overrides.data END)||excluded.data,
      action_id=excluded.action_id,confirmed_at=now();
  booking_result:=p_result||jsonb_build_object('receiptId',a.id);
  UPDATE public.cockpit_csm_actions SET state='confirmed',result=booking_result,error=NULL,finished_at=now() WHERE id=a.id;
  RETURN booking_result;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_projection_finish_booking(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_projection_finish_booking(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_refresh_billing()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; finished timestamptz;
BEGIN
  actor:=public.cockpit_csm_actor();
  SELECT finished_at INTO finished FROM public.cockpit_finance_refreshes
    WHERE status='confirmed' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'payments',(SELECT count(*) FROM public.cockpit_client_payments p WHERE p.active AND p.day >= (now() AT TIME ZONE 'Asia/Kuwait')::date-400 AND public.cockpit_client_allowed(p.client_name)),
    'accounts',(SELECT count(*) FROM public.cockpit_billing_accounts a WHERE public.cockpit_client_allowed(a.client_name)),
    'finishedAt',finished,
    'source','Active native payment facts (last 400 days), ClickUp billing mirror, latest confirmed finance refresh; no provider refresh was requested.');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_projection_refresh_billing() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_projection_refresh_billing() TO authenticated;
COMMENT ON FUNCTION public.cockpit_csm_projection_refresh_billing() IS 'Read-only scoped billing facts. The edge reports missing or older-than-one-hour confirmed finance refreshes as not fresh; reading never advances freshness.';
COMMENT ON INDEX public.cockpit_csm_booking_once IS 'Durable task/time idempotency fence, including unknown GHL outcomes. Existing requests are reconciled with bounded provider GETs, never blindly recreated.';

-- -----------------------------------------------------------------------------
-- 4. Source: 20261005b_cockpit_ceo_refresh_worker.sql
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_ceo_refresh_state (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cockpit_ceo_refresh_state(id) VALUES(true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cockpit_ceo_refresh_runs (
  run_id uuid PRIMARY KEY,
  lease_token uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK(status IN ('claimed','published','partial','failed','expired')),
  lease_expires_at timestamptz NOT NULL,
  base_revision bigint NOT NULL CHECK(base_revision>=0),
  requested_sections text[] NOT NULL CHECK(cardinality(requested_sections)>0),
  finance_refresh_id uuid REFERENCES public.cockpit_finance_refreshes(id),
  plan_sha text CHECK(plan_sha IS NULL OR plan_sha ~ '^[0-9a-f]{64}$'),
  result jsonb CHECK(result IS NULL OR jsonb_typeof(result)='object'),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_ceo_refresh_one_claim
  ON public.cockpit_ceo_refresh_runs((status)) WHERE status='claimed';
CREATE INDEX IF NOT EXISTS cockpit_ceo_refresh_runs_created_idx
  ON public.cockpit_ceo_refresh_runs(created_at DESC);

ALTER TABLE public.cockpit_ceo_refresh_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_ceo_refresh_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ceo_refresh_state,public.cockpit_ceo_refresh_runs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_ceo_refresh_state,public.cockpit_ceo_refresh_runs TO service_role;

ALTER TABLE public.cockpit_ceo_provider_health
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.cockpit_ceo_refresh_runs(run_id),
  ADD COLUMN IF NOT EXISTS receipt_index integer,
  ADD COLUMN IF NOT EXISTS error text;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_ceo_provider_health_run_receipt_uidx
  ON public.cockpit_ceo_provider_health(run_id,receipt_index)
  WHERE run_id IS NOT NULL AND receipt_index IS NOT NULL;
ALTER TABLE public.cockpit_ceo_provider_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ceo_provider_health FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_ceo_provider_health TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_ceo_provider_health_id_seq TO service_role;

ALTER TABLE public.cockpit_finance_refreshes ALTER COLUMN actor_id DROP NOT NULL;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_finance_refreshes TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_refresh_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_action text;
BEGIN
  IF TG_OP='INSERT' THEN
    v_action:='ceo.refresh.claimed';
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    v_action:='ceo.refresh.'||NEW.status;
  ELSE
    v_action:='ceo.refresh.updated';
  END IF;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
  VALUES(v_action,'cockpit_ceo_refresh_runs',NEW.run_id::text,'ceo-refresh-worker','media-buyer-cockpit','supabase',
    CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('status',OLD.status,'revision',OLD.base_revision,'sections',OLD.requested_sections) END,
    jsonb_build_object('status',NEW.status,'revision',NEW.base_revision,'sections',NEW.requested_sections,'finance_refresh_id',NEW.finance_refresh_id),
    jsonb_build_object('receipt_count',coalesce((NEW.result->>'receipt_count')::integer,0),'error',NEW.error));
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_refresh_audit() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cockpit_ceo_refresh_run_audit ON public.cockpit_ceo_refresh_runs;
CREATE TRIGGER cockpit_ceo_refresh_run_audit
  BEFORE INSERT OR UPDATE ON public.cockpit_ceo_refresh_runs
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_ceo_refresh_audit();

CREATE OR REPLACE FUNCTION public.cockpit_ceo_refresh_require_service()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN
    RAISE EXCEPTION 'Native CEO refresh requires the service role' USING ERRCODE='42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_refresh_require_service() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_refresh_claim(p_run_id uuid,p_sections text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing public.cockpit_ceo_refresh_runs; state_row public.cockpit_ceo_refresh_state; claimed public.cockpit_ceo_refresh_runs;
BEGIN
  PERFORM public.cockpit_ceo_refresh_require_service();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cockpit_ceo_refresh_worker'));
  IF p_run_id IS NULL OR p_sections IS NULL OR cardinality(p_sections)=0 OR cardinality(p_sections)>14 THEN
    RAISE EXCEPTION 'A run ID and requested CEO sections are required' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_sections) AS section WHERE section<>ALL(ARRAY['money','expenses','growth','webinar','b2bAds','delivery','calls','clients','team','hiring','portal','assets','organic','machine'])) THEN
    RAISE EXCEPTION 'Unknown CEO refresh section' USING ERRCODE='22023';
  END IF;
  SELECT * INTO existing FROM public.cockpit_ceo_refresh_runs WHERE run_id=p_run_id FOR UPDATE;
  IF FOUND THEN
    IF existing.status IN ('published','partial','failed','expired') THEN
      RETURN jsonb_build_object('run_id',existing.run_id,'lease_token',existing.lease_token,'status',existing.status,'base_revision',existing.base_revision,'result',existing.result,'existing',true);
    END IF;
    IF existing.lease_expires_at<=clock_timestamp() THEN
      UPDATE public.cockpit_ceo_refresh_runs SET status='expired',error='Worker lease expired before publication',finished_at=clock_timestamp() WHERE run_id=p_run_id;
      RAISE EXCEPTION 'Worker lease expired; start a new run' USING ERRCODE='40001';
    END IF;
    IF existing.requested_sections IS DISTINCT FROM p_sections THEN
      RAISE EXCEPTION 'Run ID is already bound to a different section request' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('run_id',existing.run_id,'lease_token',existing.lease_token,'status',existing.status,'base_revision',existing.base_revision,'existing',true);
  END IF;
  UPDATE public.cockpit_ceo_refresh_runs
    SET status='expired',error='Worker lease expired before publication',finished_at=clock_timestamp()
    WHERE status='claimed' AND lease_expires_at<=clock_timestamp();
  IF EXISTS(SELECT 1 FROM public.cockpit_ceo_refresh_runs WHERE status='claimed') THEN
    RAISE EXCEPTION 'Another native CEO refresh holds the worker lease' USING ERRCODE='55P03';
  END IF;
  SELECT * INTO state_row FROM public.cockpit_ceo_refresh_state WHERE id=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CEO refresh revision state is missing'; END IF;
  INSERT INTO public.cockpit_ceo_refresh_runs(run_id,lease_token,status,lease_expires_at,base_revision,requested_sections)
    VALUES(p_run_id,gen_random_uuid(),'claimed',clock_timestamp()+interval '10 minutes',state_row.revision,p_sections)
    RETURNING * INTO claimed;
  RETURN jsonb_build_object('run_id',claimed.run_id,'lease_token',claimed.lease_token,'status',claimed.status,'base_revision',claimed.base_revision,'lease_expires_at',claimed.lease_expires_at,'existing',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_refresh_fence(p_run_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_ceo_refresh_runs;
BEGIN
  PERFORM public.cockpit_ceo_refresh_require_service();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cockpit_ceo_refresh_worker'));
  SELECT * INTO r FROM public.cockpit_ceo_refresh_runs WHERE run_id=p_run_id FOR UPDATE;
  IF r.run_id IS NULL OR r.lease_token IS DISTINCT FROM p_lease_token OR r.status<>'claimed' OR r.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Expired or stale CEO refresh fence' USING ERRCODE='40001';
  END IF;
  RETURN jsonb_build_object('run_id',r.run_id,'base_revision',r.base_revision,'lease_expires_at',r.lease_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_refresh_write_receipts(p_run_id uuid,p_finance_id uuid,p_receipts jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; ordinal integer:=0; provider_name text; method_name text; resource_name text; phase_name text; status_code integer; error_text text; section_name text; target_refresh uuid;
BEGIN
  IF jsonb_typeof(p_receipts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_receipts)>5000 THEN
    RAISE EXCEPTION 'Invalid CEO provider receipt collection' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_receipts) LOOP
    ordinal:=ordinal+1;
    provider_name:=item->>'provider'; method_name:=item->>'method'; resource_name:=item->>'resource'; phase_name:=item->>'phase'; section_name:=item->>'section';
    IF provider_name NOT IN ('meta','google','google-oauth','clickup','typeform','ghl','supabase','supabase-management')
      OR method_name NOT IN ('GET','POST') OR phase_name NOT IN ('response','failure')
      OR resource_name IS NULL OR length(resource_name)>500 OR resource_name~'[[:space:]@?#]'
      OR resource_name~*'(bearer|access_token|api_key|secret|password)' THEN
      RAISE EXCEPTION 'CEO provider receipt contains an invalid resource' USING ERRCODE='22023';
    END IF;
    status_code:=CASE WHEN coalesce(item->>'http_status','')~'^[1-5][0-9][0-9]$' THEN (item->>'http_status')::integer ELSE NULL END;
    IF phase_name='response' AND status_code IS NULL THEN RAISE EXCEPTION 'Provider response receipt needs an HTTP status' USING ERRCODE='22023'; END IF;
    error_text:=left(regexp_replace(regexp_replace(coalesce(item->>'error',''),'https?://[^[:space:]]+','[provider]','gi'),'[Bb]earer[[:space:]]+[^[:space:]]+','Bearer [credential]','gi'),240);
    target_refresh:=CASE WHEN section_name IN ('money','expenses') THEN p_finance_id ELSE NULL END;
    INSERT INTO public.cockpit_ceo_provider_health(provider,method,resource,phase,http_status,refresh_id,run_id,receipt_index,error)
      VALUES(provider_name,method_name,resource_name,phase_name,status_code,target_refresh,p_run_id,ordinal,nullif(error_text,''))
      ON CONFLICT(run_id,receipt_index) WHERE run_id IS NOT NULL AND receipt_index IS NOT NULL
      DO UPDATE SET provider=excluded.provider,method=excluded.method,resource=excluded.resource,phase=excluded.phase,http_status=excluded.http_status,refresh_id=excluded.refresh_id,error=excluded.error;
  END LOOP;
  RETURN ordinal;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_refresh_finance_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'revision',coalesce((SELECT revision FROM public.cockpit_manual_payment_state WHERE id=true),0),
    'totals_revision',coalesce((SELECT totals_revision FROM public.cockpit_manual_payment_state WHERE id=true),0),
    'history_ready',coalesce((SELECT history_ready FROM public.cockpit_manual_payment_state WHERE id=true),false),
    'updated_at',(SELECT updated_at FROM public.cockpit_manual_payment_state WHERE id=true),
    'aliases_ready',coalesce((SELECT aliases_ready FROM public.cockpit_finance_source_state WHERE id=true),false),
    'manual_ready',coalesce((SELECT manual_ready FROM public.cockpit_finance_source_state WHERE id=true),false),
    'manual',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.day,p.added_at,p.id) FROM public.cockpit_manual_payments p),'[]'::jsonb),
    'aliases',coalesce((SELECT jsonb_agg(to_jsonb(a)-'source_record' ORDER BY a.source_kind,a.source_id) FROM public.cockpit_finance_client_aliases a),'[]'::jsonb),
    'billing',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.clickup_task_id) FROM (SELECT DISTINCT ON(clickup_task_id) * FROM public.cockpit_client_billing_days ORDER BY clickup_task_id,day DESC) b),'[]'::jsonb),
    'series',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.day) FROM public.cockpit_metric_days m WHERE m.metric IN ('money.book.projected','money.book.collected') AND m.day>=(date_trunc('month',now() AT TIME ZONE 'Asia/Kuwait')::date-interval '11 months')),'[]'::jsonb),
    'statements',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.to_day DESC NULLS LAST,s.imported_at DESC) FROM (SELECT * FROM public.cockpit_statements ORDER BY to_day DESC NULLS LAST,imported_at DESC LIMIT 36) s),'[]'::jsonb),
    'bank_lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.day,l.id) FROM public.cockpit_bank_lines l WHERE l.day>=(date_trunc('month',now() AT TIME ZONE 'Asia/Kuwait')::date-interval '11 months')),'[]'::jsonb),
    'exclusions',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.cockpit_expense_exclusions e WHERE e.removed_at IS NULL),'[]'::jsonb),
    'payers',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.payer_key) FROM public.cockpit_payer_clients p WHERE p.cleared_at IS NULL),'[]'::jsonb),
    'newestManualChange',(SELECT max(created_at) FROM public.cockpit_audit_log WHERE entity_type='cockpit_manual_payments')
  )
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_refresh_finance_source_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.cockpit_ceo_refresh_require_service();
  RETURN public.cockpit_ceo_refresh_finance_snapshot();
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_worker_begin_finance_refresh()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE active_job public.cockpit_finance_refreshes; source_revision bigint; job public.cockpit_finance_refreshes;
BEGIN
  PERFORM public.cockpit_ceo_refresh_require_service();
  IF NOT EXISTS(SELECT 1 FROM public.cockpit_finance_source_state WHERE id=true AND aliases_ready AND manual_ready)
    OR NOT EXISTS(SELECT 1 FROM public.cockpit_manual_payment_state WHERE id=true AND history_ready) THEN
    RAISE EXCEPTION 'Finance source history, aliases, and manual payments must be reconciled before refresh';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cockpit_finance_refresh'));
  SELECT * INTO active_job FROM public.cockpit_finance_refreshes WHERE status='running' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF active_job.id IS NOT NULL AND active_job.created_at>clock_timestamp()-interval '5 minutes' THEN
    IF active_job.actor_email='ceo-refresh-worker' AND active_job.actor_id IS NULL THEN
      RETURN jsonb_build_object('id',active_job.id,'existing',true,'revision',active_job.revision);
    END IF;
    RAISE EXCEPTION 'A founder finance refresh is already running';
  END IF;
  IF active_job.id IS NOT NULL THEN
    UPDATE public.cockpit_finance_refreshes SET status='failed',error='Refresh exceeded its time limit; start a fresh read',finished_at=clock_timestamp() WHERE id=active_job.id;
    INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata)
      VALUES('finance.expired','cockpit_finance_refreshes',active_job.id::text,active_job.actor_email,'media-buyer-cockpit','supabase','{}'::jsonb);
  END IF;
  SELECT revision INTO source_revision FROM public.cockpit_manual_payment_state WHERE id=true;
  IF source_revision IS NULL THEN RAISE EXCEPTION 'Finance source revision is missing'; END IF;
  INSERT INTO public.cockpit_finance_refreshes(actor_id,actor_email,revision)
    VALUES(NULL,'ceo-refresh-worker',source_revision) RETURNING * INTO job;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after)
    VALUES('finance.started','cockpit_finance_refreshes',job.id::text,'ceo-refresh-worker','media-buyer-cockpit','supabase',to_jsonb(job));
  RETURN jsonb_build_object('id',job.id,'existing',false,'revision',source_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_finance_refresh_input(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job public.cockpit_finance_refreshes; snapshot jsonb;
BEGIN
  SELECT * INTO job FROM public.cockpit_finance_refreshes WHERE id=p_id AND status='running';
  IF job.id IS NULL THEN RAISE EXCEPTION 'Finance refresh is not running'; END IF;
  IF job.created_at<clock_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'Finance refresh expired'; END IF;
  IF job.actor_email='ceo-refresh-worker' THEN
    PERFORM public.cockpit_ceo_refresh_require_service();
    IF job.actor_id IS NOT NULL THEN RAISE EXCEPTION 'Worker finance job has an Auth actor'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
      WHERE m.active AND u.id=job.actor_id AND u.email_confirmed_at IS NOT NULL
        AND m.email=lower(btrim(u.email)) AND lower(btrim(u.email))=job.actor_email
        AND job.actor_email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')) THEN
      RAISE EXCEPTION 'Founder access changed';
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.cockpit_finance_source_state WHERE id=true AND aliases_ready AND manual_ready)
    OR NOT EXISTS(SELECT 1 FROM public.cockpit_manual_payment_state WHERE id=true AND history_ready AND revision=job.revision) THEN
    RAISE EXCEPTION 'Finance source readiness or revision changed';
  END IF;
  snapshot:=public.cockpit_ceo_refresh_finance_snapshot();
  RETURN snapshot||jsonb_build_object('id',job.id,'job_revision',job.revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_refresh_publish(p_run_id uuid,p_lease_token uuid,p_plan_sha text,p_publication jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE run_row public.cockpit_ceo_refresh_runs; state_row public.cockpit_ceo_refresh_state; item jsonb; failure jsonb; definition jsonb; v_metric jsonb; point jsonb; source jsonb; section_key text; requested text[]; success_keys text[]:='{}'; failure_count integer:=0; receipt_count integer:=0; finance jsonb; finance_id uuid; finance_output jsonb; finance_error text; finance_result jsonb; new_revision bigint; published_count integer:=0; final_status text; result_json jsonb; metric_day date;
BEGIN
  PERFORM public.cockpit_ceo_refresh_require_service();
  SELECT * INTO run_row FROM public.cockpit_ceo_refresh_runs WHERE run_id=p_run_id FOR UPDATE;
  IF run_row.run_id IS NULL OR run_row.lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'Stale CEO refresh lease'; END IF;
  IF run_row.status IN ('published','partial') THEN
    IF run_row.plan_sha IS DISTINCT FROM p_plan_sha THEN RAISE EXCEPTION 'Changed retry hash refused'; END IF;
    RETURN run_row.result;
  END IF;
  IF run_row.status<>'claimed' OR run_row.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Expired CEO refresh lease'; END IF;
  PERFORM public.cockpit_ceo_refresh_fence(p_run_id,p_lease_token);
  SELECT * INTO state_row FROM public.cockpit_ceo_refresh_state WHERE id=true FOR UPDATE;
  IF state_row.revision<>run_row.base_revision THEN RAISE EXCEPTION 'CEO refresh publication revision changed; recompute from a new claim' USING ERRCODE='40001'; END IF;
  IF p_plan_sha IS NULL OR p_plan_sha !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_publication) IS DISTINCT FROM 'object'
    OR octet_length(p_publication::text)>6000000
    OR jsonb_typeof(p_publication->'sections') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_publication->'definitions') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_publication->'values') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_publication->'daily') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_publication->'failures') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_publication->'receipts') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CEO refresh publication payload is incomplete' USING ERRCODE='22023';
  END IF;
  requested:=run_row.requested_sections;
  finance:=p_publication->'finance';
  finance_id:=nullif(finance->>'id','')::uuid;
  finance_output:=finance->'output';
  finance_error:=nullif(left(coalesce(finance->>'error',''),1800),'');
  IF finance_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.cockpit_finance_refreshes f WHERE f.id=finance_id AND f.actor_email='ceo-refresh-worker' AND f.actor_id IS NULL AND f.status='running') THEN
      RAISE EXCEPTION 'Finance job is not an active service worker job';
    END IF;
    UPDATE public.cockpit_ceo_refresh_runs SET finance_refresh_id=finance_id WHERE run_id=p_run_id;
  END IF;
  IF finance_output IS NOT NULL THEN
    IF finance_id IS NULL OR jsonb_typeof(finance_output->'sections') IS DISTINCT FROM 'array'
      OR jsonb_array_length(finance_output->'sections')<>2
      OR jsonb_typeof(finance_output->'payments') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Money and Expenses finance output must commit together' USING ERRCODE='22023';
    END IF;
  ELSIF finance_id IS NOT NULL AND finance_error IS NULL THEN
    RAISE EXCEPTION 'Finance job needs confirmed output or an actionable failure';
  END IF;

  FOR definition IN SELECT value FROM jsonb_array_elements(p_publication->'definitions') LOOP
    IF jsonb_typeof(definition) IS DISTINCT FROM 'object' OR coalesce(definition->>'metric','')='' OR coalesce(definition->>'section','')='' OR coalesce(definition->>'label','')='' OR coalesce(definition->>'definition','')='' OR coalesce(definition->>'source','')='' OR coalesce(definition->>'unit','')='' THEN
      RAISE EXCEPTION 'Metric definition is incomplete' USING ERRCODE='22023';
    END IF;
    IF NOT(definition->>'section'=ANY(requested)) THEN RAISE EXCEPTION 'Metric definition is outside this worker request'; END IF;
    INSERT INTO public.cockpit_metric_definitions(metric,section,label,definition,source,leaves_out,unit,updated_at)
      VALUES(definition->>'metric',definition->>'section',definition->>'label',definition->>'definition',definition->>'source',nullif(definition->>'leaves_out','null'),definition->>'unit',clock_timestamp())
      ON CONFLICT(metric) DO UPDATE SET section=excluded.section,label=excluded.label,definition=excluded.definition,source=excluded.source,leaves_out=excluded.leaves_out,unit=excluded.unit,updated_at=excluded.updated_at;
  END LOOP;

  IF finance_output IS NOT NULL THEN
    FOR item IN SELECT value FROM jsonb_array_elements(finance_output->'sections') LOOP
      IF item->>'key' NOT IN ('money','expenses') OR NOT(item->>'key'=ANY(requested))
        OR jsonb_typeof(item->'payload') IS DISTINCT FROM 'object'
        OR jsonb_typeof(item->'sources') IS DISTINCT FROM 'array'
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'sources') s WHERE s->>'ok' IS DISTINCT FROM 'true') THEN
        RAISE EXCEPTION 'Finance source evidence is incomplete' USING ERRCODE='22023';
      END IF;
    END LOOP;
    IF (SELECT count(DISTINCT finance_section.value->>'key') FROM jsonb_array_elements(finance_output->'sections') AS finance_section(value) WHERE finance_section.value->>'key' IN ('money','expenses'))<>2 THEN
      RAISE EXCEPTION 'Money and Expenses must commit together' USING ERRCODE='22023';
    END IF;
    finance_result:=public.cockpit_finish_finance_refresh(finance_id,finance_output,NULL);
    published_count:=published_count+2;
    success_keys:=array_append(success_keys,'money');
    success_keys:=array_append(success_keys,'expenses');
  ELSIF finance_id IS NOT NULL THEN
    PERFORM public.cockpit_finish_finance_refresh(finance_id,NULL,finance_error);
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_publication->'sections') LOOP
    section_key:=item->>'key';
    IF section_key IS NULL OR NOT(section_key=ANY(requested)) OR section_key IN ('money','expenses')
      OR jsonb_typeof(item->'payload') IS DISTINCT FROM 'object'
      OR jsonb_typeof(item->'sources') IS DISTINCT FROM 'array'
      OR jsonb_array_length(item->'sources')=0
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'sources') s WHERE s->>'ok' IS DISTINCT FROM 'true') THEN
      RAISE EXCEPTION 'CEO section source evidence is incomplete' USING ERRCODE='22023';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_publication->'receipts') r WHERE r->>'section'=section_key AND r->>'phase'='response' AND (r->>'http_status')::integer BETWEEN 200 AND 299)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_publication->'receipts') r WHERE r->>'section'=section_key AND r->>'phase'='failure') THEN
      RAISE EXCEPTION 'CEO section has no confirmed provider evidence' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.cockpit_sections(key,label,ok,error,computed_at,payload,sources,updated_at)
      VALUES(section_key,item->>'label',true,NULL,clock_timestamp(),item->'payload',item->'sources',clock_timestamp())
      ON CONFLICT(key) DO UPDATE SET label=excluded.label,ok=true,error=NULL,computed_at=excluded.computed_at,payload=excluded.payload,sources=excluded.sources,updated_at=excluded.updated_at;
    success_keys:=array_append(success_keys,section_key);
    published_count:=published_count+1;
  END LOOP;

  FOR v_metric IN SELECT value FROM jsonb_array_elements(p_publication->'values') LOOP
    IF jsonb_typeof(v_metric) IS DISTINCT FROM 'object'
      OR NOT((v_metric->>'section')=ANY(success_keys))
      OR jsonb_typeof(v_metric->'value') IS DISTINCT FROM 'number'
      OR NOT EXISTS(SELECT 1 FROM public.cockpit_metric_definitions d WHERE d.metric=v_metric->>'metric' AND d.section=v_metric->>'section') THEN
      RAISE EXCEPTION 'Current metric value has no matching published definition' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.cockpit_metric_values(day,metric,scope,"window",value,window_from,window_to,captured_at)
      VALUES((v_metric->>'day')::date,v_metric->>'metric',v_metric->>'scope',v_metric->>'window',(v_metric->>'value')::numeric,nullif(v_metric->>'window_from','null')::date,nullif(v_metric->>'window_to','null')::date,clock_timestamp())
      ON CONFLICT(day,metric,scope,"window") DO UPDATE SET value=excluded.value,window_from=excluded.window_from,window_to=excluded.window_to,captured_at=excluded.captured_at;
  END LOOP;

  FOR point IN SELECT value FROM jsonb_array_elements(p_publication->'daily') LOOP
    IF jsonb_typeof(point) IS DISTINCT FROM 'object'
      OR jsonb_typeof(point->'value') IS DISTINCT FROM 'number'
      OR NOT EXISTS(SELECT 1 FROM public.cockpit_metric_definitions d WHERE d.metric=point->>'metric' AND d.section=ANY(success_keys)) THEN
      RAISE EXCEPTION 'Daily history has no matching published metric definition' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.cockpit_metric_days(day,metric,scope,value,captured_at)
      VALUES((point->>'date')::date,point->>'metric',point->>'scope',(point->>'value')::double precision,clock_timestamp())
      ON CONFLICT(day,metric,scope) DO UPDATE SET value=excluded.value,captured_at=excluded.captured_at;
  END LOOP;

  FOR failure IN SELECT value FROM jsonb_array_elements(p_publication->'failures') LOOP
    section_key:=failure->>'key';
    IF section_key IS NULL OR NOT(section_key=ANY(requested)) THEN RAISE EXCEPTION 'CEO failure is outside this worker request'; END IF;
    failure_count:=failure_count+1;
    UPDATE public.cockpit_sections SET ok=false,error=left(regexp_replace(regexp_replace(coalesce(failure->>'error','Source failed'),'https?://[^[:space:]]+','[provider]','gi'),'[Bb]earer[[:space:]]+[^[:space:]]+','Bearer [credential]','gi'),1000),updated_at=clock_timestamp() WHERE key=section_key;
  END LOOP;

  receipt_count:=public.cockpit_ceo_refresh_write_receipts(p_run_id,finance_id,p_publication->'receipts');
  IF published_count>0 THEN
    UPDATE public.cockpit_ceo_refresh_state SET revision=revision+1,updated_at=clock_timestamp() WHERE id=true RETURNING revision INTO new_revision;
  ELSE
    SELECT revision INTO new_revision FROM public.cockpit_ceo_refresh_state WHERE id=true;
  END IF;
  final_status:=CASE WHEN failure_count>0 OR finance_error IS NOT NULL THEN CASE WHEN published_count>0 THEN 'partial' ELSE 'failed' END ELSE 'published' END;
  result_json:=jsonb_build_object('ok',final_status='published','status',final_status,'run_id',p_run_id,'revision',new_revision,'published_sections',success_keys,'failure_count',failure_count,'receipt_count',receipt_count,'finance_result',finance_result);
  UPDATE public.cockpit_ceo_refresh_runs SET status=final_status,plan_sha=p_plan_sha,result=result_json,error=CASE WHEN final_status='failed' THEN coalesce(finance_error,'One or more CEO sections failed') END,finished_at=clock_timestamp() WHERE run_id=p_run_id;
  RETURN result_json;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_refresh_fail(p_run_id uuid,p_lease_token uuid,p_error text,p_receipts jsonb,p_finance_id uuid,p_finance_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE run_row public.cockpit_ceo_refresh_runs; failure_text text; final_status text; result_json jsonb; revision_now bigint;
BEGIN
  PERFORM public.cockpit_ceo_refresh_require_service();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cockpit_ceo_refresh_worker'));
  SELECT * INTO run_row FROM public.cockpit_ceo_refresh_runs WHERE run_id=p_run_id FOR UPDATE;
  IF run_row.run_id IS NULL OR run_row.lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'Invalid CEO refresh failure fence'; END IF;
  IF run_row.status IN ('published','partial','failed','expired') THEN RETURN coalesce(run_row.result,jsonb_build_object('ok',false,'status',run_row.status,'run_id',run_row.run_id)); END IF;
  failure_text:=left(regexp_replace(regexp_replace(coalesce(p_error,'CEO refresh failed'),'https?://[^[:space:]]+','[provider]','gi'),'[Bb]earer[[:space:]]+[^[:space:]]+','Bearer [credential]','gi'),1800);
  IF p_finance_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.cockpit_finance_refreshes f WHERE f.id=p_finance_id AND f.actor_email='ceo-refresh-worker' AND f.actor_id IS NULL AND f.status='running') THEN
      RAISE EXCEPTION 'Finance failure does not match an active worker job';
    END IF;
    PERFORM public.cockpit_finish_finance_refresh(p_finance_id,NULL,left(coalesce(p_finance_error,failure_text),1800));
  END IF;
  UPDATE public.cockpit_sections SET ok=false,error=failure_text,updated_at=clock_timestamp() WHERE key=ANY(run_row.requested_sections);
  PERFORM public.cockpit_ceo_refresh_write_receipts(p_run_id,p_finance_id,coalesce(p_receipts,'[]'::jsonb));
  SELECT revision INTO revision_now FROM public.cockpit_ceo_refresh_state WHERE id=true;
  final_status:=CASE WHEN run_row.lease_expires_at<=clock_timestamp() THEN 'expired' ELSE 'failed' END;
  result_json:=jsonb_build_object('ok',false,'status',final_status,'run_id',p_run_id,'revision',revision_now,'error',failure_text,'receipt_count',jsonb_array_length(coalesce(p_receipts,'[]'::jsonb)));
  UPDATE public.cockpit_ceo_refresh_runs SET status=final_status,finance_refresh_id=p_finance_id,error=failure_text,result=result_json,finished_at=clock_timestamp() WHERE run_id=p_run_id;
  RETURN result_json;
END;
$$;

ALTER TABLE public.cockpit_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_metric_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_metric_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_metric_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_client_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_sections,public.cockpit_metric_definitions,public.cockpit_metric_values,public.cockpit_metric_days,public.cockpit_client_payments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_sections,public.cockpit_metric_definitions,public.cockpit_metric_values,public.cockpit_metric_days,public.cockpit_client_payments TO service_role;

REVOKE ALL ON FUNCTION public.cockpit_ceo_refresh_claim(uuid,text[]),public.cockpit_ceo_refresh_fence(uuid,uuid),public.cockpit_ceo_refresh_publish(uuid,uuid,text,jsonb),public.cockpit_ceo_refresh_fail(uuid,uuid,text,jsonb,uuid,text),public.cockpit_ceo_worker_begin_finance_refresh(),public.cockpit_ceo_refresh_finance_source_snapshot() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_ceo_refresh_write_receipts(uuid,uuid,jsonb),public.cockpit_ceo_refresh_finance_snapshot() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_finance_refresh_input(uuid),public.cockpit_finish_finance_refresh(uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_refresh_claim(uuid,text[]),public.cockpit_ceo_refresh_fence(uuid,uuid),public.cockpit_ceo_refresh_publish(uuid,uuid,text,jsonb),public.cockpit_ceo_refresh_fail(uuid,uuid,text,jsonb,uuid,text),public.cockpit_ceo_worker_begin_finance_refresh(),public.cockpit_ceo_refresh_finance_source_snapshot(),public.cockpit_finance_refresh_input(uuid),public.cockpit_finish_finance_refresh(uuid,jsonb,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
