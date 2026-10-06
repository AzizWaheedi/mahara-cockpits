BEGIN;

-- The run ledger fences section publication. Finance jobs remain in the
-- existing cockpit_finance_refreshes table and use its existing RPC lifecycle.
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

-- Keep the established CEO provider-health ledger. Receipts carry only
-- allowlisted resource paths, status codes, and sanitized failure text.
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

-- The scheduled worker has no founder session. A nullable actor_id identifies
-- its system job without borrowing or fabricating a founder identity.
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


-- This source projection reads the existing canonical finance rows. It does not
-- mark imports ready, alter the LTV baseline, or update human-entered fields.
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
