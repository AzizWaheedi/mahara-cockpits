BEGIN;
-- Local preparation only. Reuse the audited action ledger, not a second report queue.
ALTER TABLE public.cockpit_csm_actions DROP CONSTRAINT IF EXISTS cockpit_csm_actions_operation_check;
ALTER TABLE public.cockpit_csm_actions ADD CONSTRAINT cockpit_csm_actions_operation_check
 CHECK(operation IN('act','plan','projections.bookCall','checkIns.book','reports.create'));
CREATE UNIQUE INDEX cockpit_csm_report_once ON public.cockpit_csm_actions
 (actor_id,(context->>'taskId'),md5(request::text))
 WHERE operation='reports.create' AND state IN('sending','reconcile','confirmed');

CREATE OR REPLACE FUNCTION public.cockpit_csm_report_context(p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; email text; sources jsonb; client jsonb; profile jsonb; name text; n integer;
BEGIN
 actor:=public.cockpit_csm_actor();
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text)>12000
  OR p_args-ARRAY['clientName','from','to','month','language','label','note','extras']<>'{}'::jsonb
  THEN RAISE EXCEPTION 'Invalid report request';END IF;
 name:=btrim(p_args->>'clientName');
 IF length(name) NOT BETWEEN 1 AND 300 OR public.cockpit_client_allowed(name) IS NOT TRUE
  THEN RAISE EXCEPTION 'Choose an assigned client' USING ERRCODE='42501';END IF;
 IF coalesce(p_args->>'from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR coalesce(p_args->>'to','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR (p_args->>'from')::date>(p_args->>'to')::date
  OR (p_args->>'to')::date-(p_args->>'from')::date>3650
  OR coalesce(p_args->>'language','en') NOT IN('en','ar')
  OR (p_args ? 'month' AND (jsonb_typeof(p_args->'month') IS DISTINCT FROM 'string' OR p_args->>'month' IS DISTINCT FROM left(p_args->>'from',7) OR right(p_args->>'from',2)<>'01'))
  OR length(coalesce(p_args->>'note',''))>1000 OR length(coalesce(p_args->>'label',''))>150
  OR (p_args ? 'extras' AND (jsonb_typeof(p_args->'extras') IS DISTINCT FROM 'array' OR jsonb_array_length(p_args->'extras')>4))
  THEN RAISE EXCEPTION 'Choose a valid report range, language and note';END IF;
 IF p_args ? 'extras' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_args->'extras') x WHERE x NOT IN('"lost"','"byAd"','"appointments"','"ads"'))
  THEN RAISE EXCEPTION 'Choose a supported report section';END IF;
 sources:=public.cockpit_csm_source_read();
 SELECT count(*) INTO n FROM jsonb_array_elements(sources#>'{tables,clients}') x WHERE lower(btrim(x->>'name'))=lower(name);
 IF n<>1 THEN RAISE EXCEPTION 'Report client identity is missing or ambiguous';END IF;
 SELECT x INTO client FROM jsonb_array_elements(sources#>'{tables,clients}') x WHERE lower(btrim(x->>'name'))=lower(name);
 SELECT x INTO profile FROM jsonb_array_elements(sources#>'{tables,clientProfiles}') x
  WHERE lower(btrim(x->>'clientName'))=lower(name)
  ORDER BY coalesce(nullif(substring(x->>'syncId' FROM '([0-9]+)$'),'')::numeric,nullif(x->>'syncedAt','')::numeric,0) DESC,
   (nullif(x#>>'{links,sheet}','') IS NOT NULL) DESC,coalesce((x->>'_creationTime')::numeric,0) DESC LIMIT 1;
 IF profile IS NULL OR nullif(client->>'taskId','') IS NULL
  OR jsonb_typeof(profile#>'{performance,appointments}') IS DISTINCT FROM 'array'
  OR jsonb_typeof(profile#>'{adLeads,daily}') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Original report profile and daily series are unavailable';END IF;
 SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=actor;
 RETURN jsonb_build_object('actorId',actor,'email',email,'clientName',client->>'name','taskId',client->>'taskId',
  'sourceSnapshotAt',sources#>>'{source,snapshotAt}','profile',profile);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_report_begin(p_args jsonb,p_request_id uuid,p_apply boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb; a public.cockpit_csm_actions;
BEGIN
 ctx:=public.cockpit_csm_report_context(p_args);
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A report request id is required';END IF;
 IF p_apply IS NOT TRUE THEN RETURN jsonb_build_object('state','dry_run','context',ctx);END IF;
 PERFORM pg_advisory_xact_lock(1835102822,hashtext((ctx->>'actorId')||'/'||(ctx->>'taskId')));
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_request_id FOR UPDATE;
 IF a.id IS NOT NULL AND (a.actor_id IS DISTINCT FROM (ctx->>'actorId')::uuid OR a.operation<>'reports.create' OR a.request IS DISTINCT FROM p_args)
  THEN RAISE EXCEPTION 'This report id belongs to a different request';END IF;
 IF a.id IS NULL THEN
  SELECT * INTO a FROM public.cockpit_csm_actions WHERE operation='reports.create' AND actor_id=(ctx->>'actorId')::uuid
   AND context->>'taskId'=ctx->>'taskId' AND md5(request::text)=md5(p_args::text) AND state IN('sending','reconcile','confirmed') FOR UPDATE;
  IF a.id IS NOT NULL AND a.request IS DISTINCT FROM p_args THEN RAISE EXCEPTION 'Report request fingerprint conflict';END IF;
 END IF;
 IF a.id IS NOT NULL THEN RETURN jsonb_build_object('id',a.id,'state',a.state,'result',a.result);END IF;
 INSERT INTO public.cockpit_csm_actions(id,operation,actor_id,actor_email,context,request)
  VALUES(p_request_id,'reports.create',(ctx->>'actorId')::uuid,ctx->>'email',ctx,p_args);
 RETURN jsonb_build_object('id',p_request_id,'state','new','context',ctx);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_report_finish(p_id uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_csm_actions; ctx jsonb; old_sub text; old_claims text; email text;
BEGIN
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id FOR UPDATE;
 IF a.id IS NULL OR a.operation<>'reports.create' THEN RAISE EXCEPTION 'Original report intent is unavailable';END IF;
 old_sub:=current_setting('request.jwt.claim.sub',true);old_claims:=current_setting('request.jwt.claims',true);
 SELECT u.email INTO email FROM auth.users u WHERE u.id=a.actor_id;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub',a.actor_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.actor_id,'email',email,'role','authenticated')::text,true);
  ctx:=public.cockpit_csm_report_context(a.request);
  PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);
 EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);RAISE;
 END;
 IF a.state='confirmed' THEN RETURN a.result;END IF;
 IF a.state NOT IN('sending','reconcile') OR ctx IS DISTINCT FROM a.context THEN RAISE EXCEPTION 'Report access or source changed; reconcile the created document';END IF;
 IF p_result->'ok' IS DISTINCT FROM 'true'::jsonb OR p_result->'contentReadbackVerified' IS DISTINCT FROM 'true'::jsonb
  OR p_result->'sharingVerified' IS DISTINCT FROM 'true'::jsonb
  OR coalesce(p_result->>'docId','') !~ '^[-_A-Za-z0-9]{10,}$'
  OR p_result->>'docUrl' IS DISTINCT FROM 'https://docs.google.com/document/d/'||(p_result->>'docId')||'/edit'
  OR (a.result ? 'docId' AND a.result->>'docId' IS DISTINCT FROM p_result->>'docId')
  THEN RAISE EXCEPTION 'Report content, identity and sharing have not been confirmed';END IF;
 UPDATE public.cockpit_csm_actions SET state='confirmed',result=p_result||jsonb_build_object('receiptId',p_id),finished_at=now(),error=NULL WHERE id=p_id;
 RETURN p_result||jsonb_build_object('receiptId',p_id);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_report_history(p_client_name text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_csm_actor();
 IF public.cockpit_client_allowed(p_client_name) IS NOT TRUE THEN RAISE EXCEPTION 'Choose an assigned client' USING ERRCODE='42501';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('_id',a.id,'clientName',a.context->>'clientName','requestedAt',extract(epoch FROM a.created_at)*1000,
  'builtAt',CASE WHEN a.state='confirmed' THEN extract(epoch FROM a.finished_at)*1000 END,'docUrl',CASE WHEN a.state='confirmed' THEN a.result->>'docUrl' END,
  'month',coalesce(a.request->>'label',a.request->>'month'),'from',a.request->>'from','to',a.request->>'to','language',a.request->>'language',
  'state',a.state,'error',CASE WHEN a.state='reconcile' THEN 'The report outcome needs review. Do not request another copy.' WHEN a.state='failed' THEN 'The report could not be created. Review its provider receipt.' END) ORDER BY a.created_at DESC)
  FROM public.cockpit_csm_actions a WHERE a.operation='reports.create' AND lower(a.context->>'clientName')=lower(btrim(p_client_name))),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_report_context(jsonb),public.cockpit_csm_report_begin(jsonb,uuid,boolean),public.cockpit_csm_report_history(text),public.cockpit_csm_report_finish(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_report_context(jsonb),public.cockpit_csm_report_begin(jsonb,uuid,boolean),public.cockpit_csm_report_history(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_report_finish(uuid,jsonb) TO service_role;
COMMENT ON FUNCTION public.cockpit_csm_report_begin(jsonb,uuid,boolean) IS 'Audited native report intent. Dry-run is read-only. Uncertain and confirmed identical requests reuse the original intent.';
COMMIT;
