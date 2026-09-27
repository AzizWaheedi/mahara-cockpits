BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_finance_client_aliases(
 source_kind text NOT NULL CHECK(source_kind IN ('client','link')),source_id text NOT NULL,
 task_id text,name text NOT NULL,aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(aliases)='array'),csm text,source_record jsonb NOT NULL,
 PRIMARY KEY(source_kind,source_id)
);
CREATE TABLE IF NOT EXISTS public.cockpit_finance_source_state(id boolean PRIMARY KEY DEFAULT true CHECK(id),aliases_ready boolean NOT NULL DEFAULT false,manual_ready boolean NOT NULL DEFAULT false);
INSERT INTO public.cockpit_finance_source_state(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.cockpit_finance_refreshes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,actor_email text NOT NULL,revision bigint NOT NULL,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','confirmed','failed')),
 error text,result jsonb,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
ALTER TABLE public.cockpit_finance_client_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_finance_source_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_finance_refreshes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_finance_client_aliases,public.cockpit_finance_source_state,public.cockpit_finance_refreshes FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_finance_client_aliases,public.cockpit_finance_source_state TO service_role;
GRANT SELECT ON public.cockpit_finance_refreshes TO service_role;
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
CREATE OR REPLACE FUNCTION public.cockpit_finance_refresh_input(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job cockpit_finance_refreshes;
BEGIN
 SELECT * INTO job FROM cockpit_finance_refreshes WHERE id=p_id AND status='running';
 IF job.id IS NULL THEN RAISE EXCEPTION 'Finance refresh is not running'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id WHERE m.active AND u.id=job.actor_id AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email)) AND lower(btrim(u.email))=job.actor_email AND job.actor_email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')) THEN RAISE EXCEPTION 'Founder access changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cockpit_finance_source_state WHERE aliases_ready AND manual_ready) THEN RAISE EXCEPTION 'Finance source readiness changed'; END IF;
 RETURN jsonb_build_object('revision',job.revision,
  'manual',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY day,added_at) FROM cockpit_manual_payments p),'[]'::jsonb),
  'aliases',coalesce((SELECT jsonb_agg(to_jsonb(a)-'source_record') FROM cockpit_finance_client_aliases a),'[]'::jsonb),
  'billing',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM (SELECT DISTINCT ON(clickup_task_id) * FROM cockpit_client_billing_days ORDER BY clickup_task_id,day DESC) b),'[]'::jsonb),
  'series',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY day) FROM cockpit_metric_days m WHERE metric IN ('money.book.projected','money.book.collected')),'[]'::jsonb),
  'newestManualChange',(SELECT max(created_at) FROM cockpit_audit_log WHERE entity_type='cockpit_manual_payments'));
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
REVOKE ALL ON FUNCTION public.cockpit_begin_finance_refresh(),public.cockpit_finance_refresh_status(uuid),public.cockpit_finance_refresh_input(uuid),public.cockpit_finish_finance_refresh(uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_begin_finance_refresh(),public.cockpit_finance_refresh_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_finance_refresh_input(uuid),public.cockpit_finish_finance_refresh(uuid,jsonb,text) TO service_role;
COMMIT;
