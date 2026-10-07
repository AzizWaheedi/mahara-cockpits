BEGIN;
-- Missing kinds are historical check-ins. Do not rewrite their requests or receipts.
DROP INDEX public.cockpit_csm_all_checkin_slot_once;
CREATE UNIQUE INDEX cockpit_csm_all_checkin_slot_once ON public.cockpit_csm_actions
 ((context->>'taskId'),(context->>'bookingWhen'),(CASE WHEN operation='projections.bookCall' THEN 'checkin' ELSE coalesce(request->>'kind','checkin') END))
 WHERE operation IN('projections.bookCall','checkIns.book');

-- Projection requests use a Kuwait offset; native calls use UTC. Compare instants
-- under the same client lock so either route preserves the other's booking fence.
CREATE FUNCTION public.cockpit_csm_call_slot_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE call_kind text;when_at timestamptz;
BEGIN
 IF NEW.operation NOT IN('projections.bookCall','checkIns.book') THEN RETURN NEW;END IF;
 call_kind:=CASE WHEN NEW.operation='projections.bookCall' THEN 'checkin' ELSE coalesce(NEW.request->>'kind','checkin') END;
 IF call_kind NOT IN('onboarding','blueprint','launch','checkin') OR nullif(NEW.context->>'taskId','') IS NULL OR coalesce(NEW.context->>'bookingWhen','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Choose a valid client, call kind and time';END IF;
 when_at:=(NEW.context->>'bookingWhen')::timestamptz;
 PERFORM pg_advisory_xact_lock(hashtextextended('csm-call:'||(NEW.context->>'taskId'),0));
 IF EXISTS(SELECT 1 FROM public.cockpit_csm_actions a WHERE a.id<>NEW.id AND a.operation IN('projections.bookCall','checkIns.book') AND a.context->>'taskId'=NEW.context->>'taskId' AND (a.context->>'bookingWhen')::timestamptz=when_at AND (CASE WHEN a.operation='projections.bookCall' THEN 'checkin' ELSE coalesce(a.request->>'kind','checkin') END)=call_kind) THEN
  RAISE EXCEPTION 'This client, call kind and time already have a booking receipt. Reconcile it before booking again' USING ERRCODE='23505';
 END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.cockpit_csm_actions a WHERE a.id<>NEW.id AND a.operation IN('projections.bookCall','checkIns.book') AND a.context->>'taskId'=NEW.context->>'taskId' AND a.state='sending') THEN
  RAISE EXCEPTION 'Another call for this client is still being processed. Reconcile it before booking again';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cockpit_csm_call_slot_guard BEFORE INSERT OR UPDATE OF operation,context,request ON public.cockpit_csm_actions FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_call_slot_guard();
REVOKE ALL ON FUNCTION public.cockpit_csm_call_slot_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_csm_check_in_begin(p_args jsonb,p_request_id uuid,p_apply boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb;args jsonb;when_at timestamptz;call_kind text;existing public.cockpit_csm_actions;receipt jsonb;
BEGIN
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR p_args-ARRAY['taskId','contactId','startTime','kind']<>'{}'::jsonb OR jsonb_typeof(p_args->'contactId') IS DISTINCT FROM 'string' OR nullif(btrim(p_args->>'contactId'),'') IS NULL OR coalesce(p_args->>'startTime','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' OR (p_args?'kind' AND jsonb_typeof(p_args->'kind') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Choose a linked contact and available time';END IF;
 call_kind:=coalesce(p_args->>'kind','checkin');
 IF call_kind NOT IN('onboarding','blueprint','launch','checkin') THEN RAISE EXCEPTION 'Choose which call to book';END IF;
 ctx:=public.cockpit_csm_client_gate(p_args->>'taskId');when_at:=(p_args->>'startTime')::timestamptz;
 args:=p_args||jsonb_build_object('kind',call_kind,'startTime',to_char(when_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 ctx:=ctx||jsonb_build_object('bookingWhen',args->>'startTime','kind',call_kind);
 IF p_apply IS DISTINCT FROM true THEN RETURN jsonb_build_object('dryRun',true,'ok',false,'context',ctx);END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A booking request ID is required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csm-call:'||(ctx->>'taskId'),0));
 SELECT * INTO existing FROM public.cockpit_csm_actions WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF existing.actor_id<>auth.uid() OR existing.operation<>'checkIns.book' OR existing.context->>'clientName' IS DISTINCT FROM ctx->>'clientName' OR (existing.request||jsonb_build_object('kind',coalesce(existing.request->>'kind','checkin'))) IS DISTINCT FROM args THEN RAISE EXCEPTION 'The request ID belongs to different booking inputs';END IF;
  RETURN jsonb_build_object('id',existing.id,'state',existing.state,'result',existing.result,'context',ctx);
 END IF;
 SELECT * INTO existing FROM public.cockpit_csm_actions WHERE operation IN('checkIns.book','projections.bookCall') AND context->>'taskId'=ctx->>'taskId' AND (context->>'bookingWhen')::timestamptz=when_at AND (CASE WHEN operation='projections.bookCall' THEN 'checkin' ELSE coalesce(request->>'kind','checkin') END)=call_kind FOR UPDATE;
 IF FOUND THEN
  IF existing.context->>'clientName' IS DISTINCT FROM ctx->>'clientName' THEN RAISE EXCEPTION 'The existing booking belongs to a different client identity';END IF;
  IF existing.operation='checkIns.book' AND existing.request->>'contactId' IS DISTINCT FROM args->>'contactId' THEN RAISE EXCEPTION 'This client, call kind and time already belong to another contact. Reconcile the existing receipt';END IF;
  receipt:=existing.result;
  IF existing.operation='projections.bookCall' AND existing.state='confirmed' AND existing.result->>'ok'='true' AND nullif(existing.result->>'eventId','') IS NOT NULL AND (existing.result->>'when')::timestamptz=when_at THEN
   receipt:=jsonb_build_object('appointmentId',existing.result->>'eventId','startTime',args->>'startTime');
  END IF;
  RETURN jsonb_build_object('id',existing.id,'state',existing.state,'result',receipt,'context',ctx);
 END IF;
 IF when_at<=now() OR when_at>now()+interval '366 days' THEN RAISE EXCEPTION 'Choose a future available call time';END IF;
 INSERT INTO public.cockpit_csm_actions(id,operation,actor_id,actor_email,context,request) VALUES(p_request_id,'checkIns.book',auth.uid(),ctx->>'email',ctx,args);
 RETURN jsonb_build_object('id',p_request_id,'state','new','context',ctx);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_check_in_guard(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_csm_actions;ctx jsonb;source jsonb;old public.cockpit_csm_client_overrides;future_at timestamptz;
BEGIN
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id;
 IF a.id IS NULL OR a.operation<>'checkIns.book' OR a.state<>'sending' OR a.created_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'The original booking cannot make another provider request';END IF;
 ctx:=public.cockpit_csm_client_gate_for_actor(a.actor_id,a.context->>'taskId');
 IF ctx IS DISTINCT FROM a.context-ARRAY['bookingWhen','kind'] OR coalesce(a.context->>'kind','checkin') IS DISTINCT FROM coalesce(a.request->>'kind','checkin') OR (a.context->>'bookingWhen')::timestamptz IS DISTINCT FROM (a.request->>'startTime')::timestamptz THEN RAISE EXCEPTION 'Client access, source or booking inputs changed during booking';END IF;
 SELECT data INTO source FROM public.cockpit_csm_sources WHERE table_name='clients' AND data->>'taskId'=ctx->>'taskId';
 SELECT * INTO old FROM public.cockpit_csm_client_overrides WHERE task_id=ctx->>'taskId';
 IF old.task_id IS NOT NULL AND lower(btrim(old.client_name)) IS DISTINCT FROM lower(btrim(ctx->>'clientName')) THEN RAISE EXCEPTION 'The client override belongs to another client';END IF;
 SELECT min(nullif(value,'')::timestamptz) INTO future_at FROM (VALUES(source->>'nextCallAt'),(old.data->>'nextCallAt')) calls(value) WHERE nullif(value,'')::timestamptz>now();
 RETURN ctx||jsonb_build_object('bookingWhen',a.context->>'bookingWhen','kind',coalesce(a.request->>'kind','checkin'),'nextCallAt',to_char(future_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_check_in_capture(p_id uuid,p_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_csm_actions;valid boolean:=true;call_kind text;calendar text;
BEGIN
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id FOR UPDATE;
 IF a.id IS NULL OR a.operation<>'checkIns.book' OR a.state NOT IN('sending','reconcile') THEN RAISE EXCEPTION 'The original booking intent is unavailable';END IF;
 call_kind:=coalesce(a.request->>'kind','checkin');
 calendar:=CASE call_kind WHEN 'onboarding' THEN 'z1Ne59rohCCj87KhcXoi' WHEN 'blueprint' THEN 'x84ET6KnA8odlsjYiVLq' WHEN 'launch' THEN '5E1EVxLJbGiDM3iYl2kL' WHEN 'checkin' THEN 'SHjlq0UjeR11maltYNyh' END;
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR nullif(btrim(p_result->>'appointmentId'),'') IS NULL OR nullif(p_result->>'startTime','') IS NULL OR p_result->>'contactId' IS DISTINCT FROM a.request->>'contactId' OR (p_result->>'startTime')::timestamptz IS DISTINCT FROM (a.request->>'startTime')::timestamptz OR coalesce(p_result->>'kind','checkin') IS DISTINCT FROM call_kind OR calendar IS NULL OR p_result->>'calendarId' IS DISTINCT FROM calendar OR p_result->>'locationId' IS DISTINCT FROM 'wwG426bwruWWv9W3fazQ' THEN RAISE EXCEPTION 'The provider receipt does not match this call';END IF;
 IF a.result IS NOT NULL AND a.result IS DISTINCT FROM p_result THEN RAISE EXCEPTION 'The captured appointment receipt cannot be replaced';END IF;
 BEGIN PERFORM public.cockpit_csm_check_in_guard(p_id);EXCEPTION WHEN raise_exception OR insufficient_privilege THEN valid:=false;END;
 UPDATE public.cockpit_csm_actions SET result=p_result,state=CASE WHEN valid THEN state ELSE 'reconcile' END,error=CASE WHEN valid THEN error ELSE 'The provider booked the call, but current access changed' END WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_check_in_finish(p_id uuid,p_patch jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_csm_actions;ctx jsonb;old public.cockpit_csm_client_overrides;merged jsonb;future_at timestamptz;call_kind text;target_stage text;day text;receipt jsonb;override_receipt jsonb;
BEGIN
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id;
 IF a.id IS NULL THEN RAISE EXCEPTION 'The original booking intent is unavailable';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csm-call:'||(a.context->>'taskId'),0));
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id FOR UPDATE;
 ctx:=public.cockpit_csm_check_in_guard(p_id);
 IF nullif(a.result->>'appointmentId','') IS NULL THEN RAISE EXCEPTION 'A real provider appointment receipt is required';END IF;
 call_kind:=coalesce(a.request->>'kind','checkin');
 target_stage:=CASE call_kind WHEN 'onboarding' THEN 'Onboarding Booked' WHEN 'blueprint' THEN U&'Brand Blueprint Booked\2660\FE0F' WHEN 'launch' THEN 'LAUNCH BOOKED' END;
 day:=to_char((ctx->>'bookingWhen')::timestamptz AT TIME ZONE 'Asia/Kuwait','YYYY-MM-DD');
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch-ARRAY['nextPoc','todo','level','rank','stage']<>'{}'::jsonb OR (p_patch?'stage' AND (target_stage IS NULL OR p_patch->>'stage' IS DISTINCT FROM target_stage)) OR (p_patch?'nextPoc' AND p_patch->>'nextPoc' IS DISTINCT FROM day) OR (p_patch?'todo' AND p_patch->>'todo' IS DISTINCT FROM ('Booked '||day)) OR (p_patch?'level' AND p_patch->>'level' IS DISTINCT FROM 'blue') OR (p_patch?'rank' AND p_patch->'rank' IS DISTINCT FROM '40'::jsonb) OR (p_patch ?| ARRAY['todo','level','rank'] AND NOT (p_patch?'nextPoc')) THEN RAISE EXCEPTION 'The confirmed client patch does not match this call';END IF;
 SELECT * INTO old FROM public.cockpit_csm_client_overrides WHERE task_id=ctx->>'taskId' FOR UPDATE;
 merged:=coalesce(old.data,'{}');future_at:=nullif(ctx->>'nextCallAt','')::timestamptz;
 -- Stage confirmation is independent of which upcoming appointment is nearest.
 IF p_patch?'stage' THEN merged:=merged||jsonb_build_object('stage',p_patch->>'stage');END IF;
 IF p_patch?'nextPoc' AND (future_at IS NULL OR future_at>(ctx->>'bookingWhen')::timestamptz) THEN merged:=merged||(p_patch-'stage')||jsonb_build_object('nextCallAt',ctx->>'bookingWhen','nextCallKind',call_kind);END IF;
 IF merged IS DISTINCT FROM coalesce(old.data,'{}') THEN
  INSERT INTO public.cockpit_csm_client_overrides(task_id,client_name,data,action_id) VALUES(ctx->>'taskId',ctx->>'clientName',merged,p_id) ON CONFLICT(task_id) DO UPDATE SET data=excluded.data,action_id=excluded.action_id,confirmed_at=now() RETURNING to_jsonb(cockpit_csm_client_overrides.*) INTO override_receipt;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,before,after) VALUES('csm.call.confirmed','cockpit_csm_client_overrides',ctx->>'taskId',a.actor_email,'client-success',CASE WHEN old.task_id IS NOT NULL THEN to_jsonb(old) END,override_receipt);
 END IF;
 receipt:=a.result||CASE WHEN p_patch?'stage' THEN jsonb_build_object('stage',p_patch->>'stage') ELSE '{}'::jsonb END;
 UPDATE public.cockpit_csm_actions SET state='confirmed',result=receipt,finished_at=now(),error=NULL WHERE id=p_id;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_check_in_begin(jsonb,uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_check_in_begin(jsonb,uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.cockpit_csm_check_in_guard(uuid),public.cockpit_csm_check_in_capture(uuid,jsonb),public.cockpit_csm_check_in_finish(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_check_in_guard(uuid),public.cockpit_csm_check_in_capture(uuid,jsonb),public.cockpit_csm_check_in_finish(uuid,jsonb) TO service_role;
COMMENT ON INDEX public.cockpit_csm_all_checkin_slot_once IS 'Distinct call kinds retain durable slot receipts. Missing historical kinds and projection bookings remain check-ins; the slot trigger also rejects equivalent offset timestamps.';

-- A logged commitment is a note, not a completed touchpoint or call.
CREATE OR REPLACE FUNCTION public.cockpit_csm_action_context(p_operation text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb; item jsonb;actor uuid;email text;day text:=(now() AT TIME ZONE 'Asia/Kuwait')::date::text;
BEGIN
 actor:=public.cockpit_csm_actor();SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=actor;
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text)>100000 THEN RAISE EXCEPTION 'Invalid client-success action';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_csm_source_state WHERE table_name='clients' AND ready) THEN RAISE EXCEPTION 'Client roster has not been reconciled';END IF;
 IF p_args ? 'due' AND (jsonb_typeof(p_args->'due') IS DISTINCT FROM 'number' OR (p_args->>'due')::numeric NOT BETWEEN 0 AND 4102444800000) THEN RAISE EXCEPTION 'Choose a valid task due date';END IF;
 IF p_operation='act' THEN
  SELECT r.data INTO row_data FROM public.cockpit_csm_sources r WHERE table_name='clients' AND r.source_snapshot_at=(SELECT source_snapshot_at FROM public.cockpit_csm_source_state WHERE table_name='clients' AND ready) AND ((nullif(p_args->>'taskId','') IS NOT NULL AND r.data->>'taskId'=p_args->>'taskId') OR (nullif(p_args->>'taskId','') IS NULL AND r.source_id=p_args->>'clientId')) ORDER BY (data->>'syncedAt')::numeric DESC NULLS LAST LIMIT 1;
  IF row_data IS NULL OR public.cockpit_client_allowed(row_data->>'name') IS NOT TRUE THEN RAISE EXCEPTION 'Choose an assigned client' USING ERRCODE='42501';END IF;
  IF coalesce(p_args->>'kind','') NOT IN ('touchpoint','call','report','stage','service','happiness','booked','upsell','ticket','left','commitment') OR length(btrim(coalesce(p_args->>'action',''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Choose a supported action';END IF;
  IF p_args->>'kind' IN ('stage','service','happiness','booked') AND length(btrim(coalesce(p_args->>'value','')))=0 THEN RAISE EXCEPTION 'Choose the new value';END IF;
  IF p_args->>'kind'='booked' AND (coalesce(p_args->>'value','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (p_args->>'value')::date IS NULL) THEN RAISE EXCEPTION 'Choose a valid call date';END IF;
  RETURN jsonb_build_object('actorId',actor,'email',email,'day',day,'clientName',row_data->>'name','taskId',row_data->>'taskId','evidence',row_data->>'todo','client',row_data);
 ELSIF p_operation='plan' THEN
  IF jsonb_typeof(p_args->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_args->'items') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Add between 1 and 30 tasks';END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_args->'items') LOOP
   IF length(btrim(coalesce(item->>'text',''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Every task needs a name';END IF;
   IF nullif(item->>'clientName','') IS NOT NULL AND (public.cockpit_client_allowed(item->>'clientName') IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.cockpit_csm_sources WHERE table_name='clients' AND source_snapshot_at=(SELECT source_snapshot_at FROM public.cockpit_csm_source_state WHERE table_name='clients' AND ready) AND lower(btrim(data->>'name'))=lower(btrim(item->>'clientName')))) THEN RAISE EXCEPTION 'Task client is outside your list';END IF;
   IF nullif(item->>'dueDate','') IS NOT NULL AND ((item->>'dueDate')::date IS NULL OR item->>'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN RAISE EXCEPTION 'Choose a valid task date';END IF;
  END LOOP;
  RETURN jsonb_build_object('actorId',actor,'email',email,'day',day);
 END IF;
 RAISE EXCEPTION 'Unknown client-success action';
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_action_context(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_action_context(text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
