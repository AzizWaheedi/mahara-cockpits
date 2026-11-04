-- A date act (call, touchpoint, booked, report) no longer posts a comment on the client's ClickUp card
-- (the CEO, 2026-11-01: "Drop the comment"; STAGE2B-CONTRACT.md Z90). cockpit-csm-api now returns no commentId
-- for those four kinds, so the finish step stops requiring one for them. Every other act still needs its
-- confirmed comment. The body is the live one (pg_get_functiondef, 2026-11-01) with only that line changed;
-- CREATE OR REPLACE keeps its grants (service_role only), restated below.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_finish_csm_action(p_id uuid, p_result jsonb, p_patch jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.cockpit_csm_actions;d bigint;item jsonb;task jsonb;i integer:=0;name text;actor_exists boolean;
BEGIN
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Client-success action not found';END IF;
 IF a.state='confirmed' THEN RETURN a.result;END IF;
 IF a.state<>'sending' THEN RAISE EXCEPTION 'Client-success action needs reconciliation';END IF;
 SELECT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id WHERE m.auth_user_id=a.actor_id AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email)) AND m.email=a.actor_email AND ('admin'=ANY(m.roles) OR 'csm'=ANY(m.roles) OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')) AND ('admin'=ANY(m.roles) OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') OR cardinality(m.clients)=0 OR (a.operation='act' AND EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(a.context->>'clientName')))) OR (a.operation='plan' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.request->'items') it WHERE nullif(it->>'clientName','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(it->>'clientName'))))))) INTO actor_exists;
 IF NOT actor_exists THEN RAISE EXCEPTION 'Client-success access changed; reconcile provider result';END IF;
 IF p_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Provider result was not confirmed';END IF;
 IF a.operation='act' THEN
  name:=a.context->>'clientName';
  IF p_result->>'commentId' IS NULL AND coalesce(a.request->>'kind','') NOT IN ('call','touchpoint','booked','report') THEN RAISE EXCEPTION 'ClickUp comment was not confirmed';END IF;
  INSERT INTO public.cockpit_decisions(role,day,subject,action,evidence,kind,clickup_task_id,clickup_task_url,logged_at,reason,metadata,source_system)
   VALUES('csm',(a.context->>'day')::date,name,a.request->>'action',a.context->>'evidence',CASE WHEN a.request->>'kind'='left' THEN 'left' WHEN nullif(a.request->>'department','') IS NOT NULL THEN 'rerouted' ELSE 'approved' END,a.context->>'taskId',coalesce(p_result->>'ticketUrl','https://app.clickup.com/t/'||(a.context->>'taskId')),now(),coalesce(a.request->>'note',a.request->>'reason'),a.request||jsonb_build_object('receiptId',p_id,'commentId',p_result->>'commentId','reroutedTo',a.request->>'department'),'supabase') RETURNING id INTO d;
  IF p_patch<>'{}'::jsonb THEN
   INSERT INTO public.cockpit_csm_client_overrides(task_id,client_name,data,action_id) VALUES(a.context->>'taskId',name,p_patch,p_id) ON CONFLICT(task_id) DO UPDATE SET data=(CASE WHEN EXISTS(SELECT 1 FROM public.cockpit_csm_sources r JOIN public.cockpit_csm_source_state st ON st.table_name=r.table_name AND st.source_snapshot_at=r.source_snapshot_at AND st.ready WHERE r.table_name='clients' AND r.data->>'taskId'=public.cockpit_csm_client_overrides.task_id AND (r.data->>'syncedAt')::numeric>=extract(epoch FROM public.cockpit_csm_client_overrides.confirmed_at)*1000) THEN '{}'::jsonb ELSE public.cockpit_csm_client_overrides.data END)||excluded.data,action_id=p_id,confirmed_at=now();
  END IF;
 ELSE
  IF jsonb_typeof(p_result->'tasks') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'tasks')<>jsonb_array_length(a.request->'items') THEN RAISE EXCEPTION 'Every planned task needs a provider confirmation';END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(a.request->'items') LOOP
   task:=p_result->'tasks'->i;i:=i+1;
   IF task->>'id' IS NULL OR task->>'url' IS NULL THEN RAISE EXCEPTION 'Task creation was not confirmed';END IF;
   INSERT INTO public.cockpit_plan_items(role,day,text,reason,client_name,list_name,due_date,owner_id,provider_task_id,provider_task_url,confirmed) VALUES('csm',(a.context->>'day')::date,item->>'text',item->>'reason',item->>'clientName','Client Success',coalesce(nullif(item->>'dueDate','')::date,(a.context->>'day')::date+1),a.actor_id,task->>'id',task->>'url',true);
  END LOOP;
 END IF;
 UPDATE public.cockpit_csm_actions SET state='confirmed',result=p_result||jsonb_build_object('receiptId',p_id),finished_at=now() WHERE id=p_id;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,before,after) VALUES('csm.'||a.operation,'cockpit_csm_actions',p_id::text,a.actor_email,'client-success',to_jsonb(a),p_result||jsonb_build_object('patch',p_patch));
 RETURN p_result||jsonb_build_object('receiptId',p_id);
END $function$;

REVOKE ALL ON FUNCTION public.cockpit_finish_csm_action(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_finish_csm_action(uuid,jsonb,jsonb) TO service_role;
COMMIT;
