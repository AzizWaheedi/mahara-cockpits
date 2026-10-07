BEGIN;
CREATE FUNCTION public.cockpit_csm_client_gate_for_actor(p_actor uuid,p_task_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members;st public.cockpit_csm_source_state;c jsonb;n bigint;
BEGIN
 IF p_task_id IS NULL OR p_task_id!~'^[A-Za-z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'Choose a valid ClickUp client ID';END IF;
 SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id=cm.auth_user_id WHERE cm.auth_user_id=p_actor AND cm.active AND u.email_confirmed_at IS NOT NULL AND cm.email=lower(btrim(u.email));
 IF m.auth_user_id IS NULL OR NOT('csm'=ANY(m.roles) OR 'admin'=ANY(m.roles) OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com')) THEN RAISE EXCEPTION 'Current confirmed client-success access is required' USING ERRCODE='42501';END IF;
 SELECT * INTO st FROM public.cockpit_csm_source_state WHERE table_name='clients';
 IF st.ready IS DISTINCT FROM true OR st.source_snapshot_at IS NULL OR st.row_count IS DISTINCT FROM(SELECT count(*) FROM public.cockpit_csm_sources WHERE table_name='clients') OR EXISTS(SELECT 1 FROM public.cockpit_csm_sources WHERE table_name='clients' AND source_snapshot_at IS DISTINCT FROM st.source_snapshot_at) THEN RAISE EXCEPTION 'The client roster is incomplete. Refresh its native source';END IF;
 SELECT count(*) INTO n FROM public.cockpit_csm_sources WHERE table_name='clients' AND data->>'taskId'=p_task_id;
 IF n<>1 THEN RAISE EXCEPTION 'The client ID is missing or ambiguous. Refresh its native source';END IF;
 SELECT data INTO c FROM public.cockpit_csm_sources WHERE table_name='clients' AND data->>'taskId'=p_task_id;
 IF nullif(btrim(c->>'name'),'') IS NULL OR NOT public.cockpit_ask_ai_owner_allowed(p_actor,'client-success',c->>'name') THEN RAISE EXCEPTION 'That client is not on your access list' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('actorId',p_actor,'email',m.email,'taskId',p_task_id,'clientName',c->>'name','sourceSnapshotAt',st.source_snapshot_at);
END $$;
CREATE FUNCTION public.cockpit_csm_client_gate(p_task_id text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT public.cockpit_csm_client_gate_for_actor(auth.uid(),p_task_id)$$;
REVOKE ALL ON FUNCTION public.cockpit_csm_client_gate_for_actor(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_gate_for_actor(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_csm_client_gate(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_gate(text) TO authenticated;

CREATE FUNCTION public.cockpit_csm_onboarding_read(p_task_ids text[]) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE task text;ctx jsonb;result jsonb;latest jsonb;good jsonb;
BEGIN
 PERFORM public.cockpit_csm_actor();
 IF cardinality(p_task_ids)>200 THEN RAISE EXCEPTION 'Choose at most 200 client cards';END IF;
 FOR task IN SELECT DISTINCT value FROM unnest(coalesce(p_task_ids,'{}')) value LOOP
  ctx:=public.cockpit_csm_client_gate(task);
  IF EXISTS(SELECT 1 FROM public.cockpit_client_onboarding r WHERE r.clickup_task_id=task AND lower(btrim(r.client_name))<>lower(btrim(ctx->>'clientName'))) THEN RAISE EXCEPTION 'Client card identity changed. Refresh the client roster';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.client_name),'[]') INTO result FROM public.cockpit_client_onboarding r WHERE r.clickup_task_id=ANY(coalesce(p_task_ids,'{}'));
 SELECT jsonb_build_object('started_at',started_at,'finished_at',finished_at,'ok',ok,'problem',problem,'trigger',trigger) INTO latest FROM public.cockpit_client_onboarding_runs WHERE finished_at IS NOT NULL ORDER BY started_at DESC,id DESC LIMIT 1;
 SELECT jsonb_build_object('started_at',started_at,'finished_at',finished_at,'ok',ok,'problem',problem,'trigger',trigger) INTO good FROM public.cockpit_client_onboarding_runs WHERE ok IS TRUE AND finished_at IS NOT NULL ORDER BY started_at DESC,id DESC LIMIT 1;
 RETURN jsonb_build_object('rows',result,'last',latest,'lastOk',good,'now',now());
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_onboarding_read(text[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_onboarding_read(text[]) TO authenticated;

CREATE TRIGGER cockpit_client_onboarding_native_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_client_onboarding FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_csm_state();
CREATE TRIGGER cockpit_client_onboarding_runs_native_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_client_onboarding_runs FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_csm_state();
CREATE FUNCTION public.cockpit_csm_onboarding_publish(p_run bigint,p_actor uuid,p_context jsonb,p_row jsonb,p_forms_verified boolean,p_problem text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_client_onboarding_runs;fresh jsonb;old public.cockpit_client_onboarding;incoming public.cockpit_client_onboarding;
BEGIN
 SELECT * INTO r FROM public.cockpit_client_onboarding_runs WHERE id=p_run FOR UPDATE;
 IF r.id IS NULL OR r.finished_at IS NOT NULL OR r.actor_email IS DISTINCT FROM p_context->>'email' THEN RAISE EXCEPTION 'The original client refresh run is not available';END IF;
 fresh:=public.cockpit_csm_client_gate_for_actor(p_actor,p_context->>'taskId');
 IF fresh IS DISTINCT FROM p_context THEN RAISE EXCEPTION 'Client access or source changed during refresh';END IF;
 IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR p_row->>'clickup_task_id' IS DISTINCT FROM fresh->>'taskId' OR lower(btrim(p_row->>'client_name')) IS DISTINCT FROM lower(btrim(fresh->>'clientName')) THEN RAISE EXCEPTION 'The provider card belongs to another client';END IF;
 SELECT * INTO old FROM public.cockpit_client_onboarding WHERE clickup_task_id=fresh->>'taskId' FOR UPDATE;
 incoming:=jsonb_populate_record(NULL::public.cockpit_client_onboarding,p_row);
 INSERT INTO public.cockpit_client_onboarding(clickup_task_id,client_name,clickup_status,client_status,in_onboarding,csm,signup_on,onboarding_call_on,launch_on,links,handover,sales_transcript,forms,card_updated_at,seen_at,synced_at)
 VALUES(incoming.clickup_task_id,incoming.client_name,incoming.clickup_status,incoming.client_status,incoming.in_onboarding,incoming.csm,incoming.signup_on,incoming.onboarding_call_on,incoming.launch_on,incoming.links,incoming.handover,incoming.sales_transcript,CASE WHEN p_forms_verified THEN coalesce(incoming.forms,'{}') ELSE coalesce(old.forms,'{}') END,incoming.card_updated_at,incoming.seen_at,incoming.synced_at)
 ON CONFLICT(clickup_task_id) DO UPDATE SET client_name=excluded.client_name,clickup_status=excluded.clickup_status,client_status=excluded.client_status,in_onboarding=excluded.in_onboarding,csm=excluded.csm,signup_on=excluded.signup_on,onboarding_call_on=excluded.onboarding_call_on,launch_on=excluded.launch_on,links=excluded.links,handover=excluded.handover,sales_transcript=excluded.sales_transcript,forms=excluded.forms,card_updated_at=excluded.card_updated_at,seen_at=excluded.seen_at,synced_at=excluded.synced_at;
 UPDATE public.cockpit_client_onboarding_runs SET finished_at=now(),ok=true,counts=jsonb_build_object('cards',1),problem=p_problem WHERE id=p_run;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_onboarding_publish(bigint,uuid,jsonb,jsonb,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_onboarding_publish(bigint,uuid,jsonb,jsonb,boolean,text) TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_client_onboarding_runs_id_seq TO service_role;
ALTER TABLE public.cockpit_csm_actions DROP CONSTRAINT IF EXISTS cockpit_csm_actions_operation_check;
ALTER TABLE public.cockpit_csm_actions ADD CONSTRAINT cockpit_csm_actions_operation_check CHECK(operation IN('act','plan','projections.bookCall','checkIns.book'));
CREATE UNIQUE INDEX cockpit_csm_all_checkin_slot_once ON public.cockpit_csm_actions((context->>'taskId'),(context->>'bookingWhen')) WHERE operation IN('projections.bookCall','checkIns.book');
CREATE FUNCTION public.cockpit_csm_check_in_begin(p_args jsonb,p_request_id uuid,p_apply boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb;args jsonb;when_at timestamptz;existing public.cockpit_csm_actions;
BEGIN
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR p_args-ARRAY['taskId','contactId','startTime']<>'{}'::jsonb OR nullif(p_args->>'contactId','') IS NULL OR coalesce(p_args->>'startTime','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Choose a linked contact and available time';END IF;
 ctx:=public.cockpit_csm_client_gate(p_args->>'taskId');when_at:=(p_args->>'startTime')::timestamptz;
 args:=p_args||jsonb_build_object('startTime',to_char(when_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 ctx:=ctx||jsonb_build_object('bookingWhen',args->>'startTime');
 IF NOT p_apply THEN RETURN jsonb_build_object('dryRun',true,'ok',false,'context',ctx);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('check-in:'||(ctx->>'taskId')||':'||(ctx->>'bookingWhen'),0));
 SELECT * INTO existing FROM public.cockpit_csm_actions WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF existing.actor_id<>auth.uid() OR existing.operation<>'checkIns.book' OR existing.request IS DISTINCT FROM args THEN RAISE EXCEPTION 'The request ID belongs to different booking inputs';END IF;
  RETURN jsonb_build_object('id',existing.id,'state',existing.state,'result',existing.result,'context',ctx);
 END IF;
 SELECT * INTO existing FROM public.cockpit_csm_actions WHERE operation IN('checkIns.book','projections.bookCall') AND context->>'taskId'=ctx->>'taskId' AND (context->>'bookingWhen')::timestamptz=when_at FOR UPDATE;
 IF FOUND THEN RETURN jsonb_build_object('id',existing.id,'state',existing.state,'result',existing.result,'context',ctx);END IF;
 IF when_at<=now() OR when_at>now()+interval '366 days' THEN RAISE EXCEPTION 'Choose a future available check-in time';END IF;
 INSERT INTO public.cockpit_csm_actions(id,operation,actor_id,actor_email,context,request) VALUES(p_request_id,'checkIns.book',auth.uid(),ctx->>'email',ctx,args);
 RETURN jsonb_build_object('id',p_request_id,'state','new','context',ctx);
END $$;
CREATE FUNCTION public.cockpit_csm_check_in_guard(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_csm_actions;ctx jsonb;
BEGIN
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id;
 IF a.id IS NULL OR a.operation<>'checkIns.book' OR a.state<>'sending' OR a.created_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'The original booking cannot make another provider request';END IF;
 ctx:=public.cockpit_csm_client_gate_for_actor(a.actor_id,a.context->>'taskId');
 IF ctx IS DISTINCT FROM a.context-'bookingWhen' THEN RAISE EXCEPTION 'Client access or source changed during booking';END IF;
 RETURN ctx||jsonb_build_object('bookingWhen',a.context->>'bookingWhen');
END $$;
CREATE FUNCTION public.cockpit_csm_check_in_capture(p_id uuid,p_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_csm_actions;valid boolean:=true;
BEGIN
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id FOR UPDATE;
 IF a.id IS NULL OR a.operation<>'checkIns.book' OR a.state NOT IN('sending','reconcile') THEN RAISE EXCEPTION 'The original booking intent is unavailable';END IF;
 IF nullif(p_result->>'appointmentId','') IS NULL OR p_result->>'contactId' IS DISTINCT FROM a.request->>'contactId' OR (p_result->>'startTime')::timestamptz IS DISTINCT FROM (a.request->>'startTime')::timestamptz OR p_result->>'calendarId'<>'SHjlq0UjeR11maltYNyh' OR p_result->>'locationId'<>'wwG426bwruWWv9W3fazQ' THEN RAISE EXCEPTION 'The provider receipt does not match this check-in';END IF;
 BEGIN PERFORM public.cockpit_csm_check_in_guard(p_id);EXCEPTION WHEN raise_exception OR insufficient_privilege THEN valid:=false;END;
 UPDATE public.cockpit_csm_actions SET result=p_result,state=CASE WHEN valid THEN state ELSE 'reconcile' END,error=CASE WHEN valid THEN error ELSE 'The provider booked the call, but current access changed' END WHERE id=p_id;
END $$;
CREATE FUNCTION public.cockpit_csm_check_in_finish(p_id uuid,p_patch jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_csm_actions;ctx jsonb;old public.cockpit_csm_client_overrides;merged jsonb;future_at timestamptz;
BEGIN
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id FOR UPDATE;
 ctx:=public.cockpit_csm_check_in_guard(p_id);
 IF nullif(a.result->>'appointmentId','') IS NULL THEN RAISE EXCEPTION 'A real provider appointment receipt is required';END IF;
 SELECT * INTO old FROM public.cockpit_csm_client_overrides WHERE task_id=ctx->>'taskId' FOR UPDATE;
 future_at:=nullif(old.data->>'nextCallAt','')::timestamptz;
 merged:=coalesce(old.data,'{}');
 IF future_at IS NULL OR future_at<=now() OR future_at>(ctx->>'bookingWhen')::timestamptz THEN merged:=merged||p_patch||jsonb_build_object('nextCallAt',ctx->>'bookingWhen','nextCallKind','checkin');END IF;
 INSERT INTO public.cockpit_csm_client_overrides(task_id,client_name,data,action_id) VALUES(ctx->>'taskId',ctx->>'clientName',merged,p_id) ON CONFLICT(task_id) DO UPDATE SET data=excluded.data,action_id=excluded.action_id,confirmed_at=now();
 UPDATE public.cockpit_csm_actions SET state='confirmed',finished_at=now(),error=NULL WHERE id=p_id;
 RETURN a.result;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_check_in_begin(jsonb,uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_check_in_begin(jsonb,uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.cockpit_csm_check_in_guard(uuid),public.cockpit_csm_check_in_capture(uuid,jsonb),public.cockpit_csm_check_in_finish(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_check_in_guard(uuid),public.cockpit_csm_check_in_capture(uuid,jsonb),public.cockpit_csm_check_in_finish(uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
