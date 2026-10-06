-- Native CSM churn and renewal state. Browser writes only through checked RPCs.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_csm_domain_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,before,after)
 VALUES(lower(TG_OP),TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'month',to_jsonb(NEW)->>'task_id'),
 (SELECT email FROM auth.users WHERE id=auth.uid()),'client-success',CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_csm_immutable_log() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Audit history is immutable' USING ERRCODE='42501'; END $$;
DROP TRIGGER IF EXISTS csm_churn_log_immutable ON public.cockpit_churn_log;
CREATE TRIGGER csm_churn_log_immutable BEFORE UPDATE OR DELETE ON public.cockpit_churn_log FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_immutable_log();
REVOKE UPDATE,DELETE,TRUNCATE ON public.cockpit_churn_log FROM service_role;
DROP TRIGGER IF EXISTS csm_departure_audit ON public.cockpit_churn_departures;
CREATE TRIGGER csm_departure_audit AFTER INSERT OR UPDATE ON public.cockpit_churn_departures FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_domain_audit();
DROP TRIGGER IF EXISTS csm_churn_month_audit ON public.cockpit_churn_months;
CREATE TRIGGER csm_churn_month_audit AFTER INSERT OR UPDATE ON public.cockpit_churn_months FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_domain_audit();

CREATE OR REPLACE FUNCTION public.cockpit_csm_churn_read() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; today date:=(now() AT TIME ZONE 'Asia/Kuwait')::date; mon text; src jsonb; roster jsonb; starts jsonb; m text;
BEGIN
 uid:=public.cockpit_csm_actor(); mon:=to_char(today,'YYYY-MM');
 src:=public.cockpit_csm_source_read()->'tables';
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',c->>'taskId','name',c->>'name','stage',coalesce(c->>'stage',''),
 'launchedOn',c->>'launchDate','csm',c->>'csmAssigned','pausedSince',c->>'pausedSince','pausedDays',c->'pausedDays')),'[]') INTO roster FROM jsonb_array_elements(src->'clients') c;
 SELECT coalesce(jsonb_agg(jsonb_build_object('month',months.mon,'day',r.data->>'day','paying',r.data->'paying') ORDER BY months.mon),'[]') INTO starts
 FROM (SELECT to_char(generate_series(date_trunc('month',today)-interval '3 months',date_trunc('month',today),interval '1 month'),'YYYY-MM') mon) months
 LEFT JOIN LATERAL (SELECT d AS data FROM jsonb_array_elements(src->'rosterDays') d WHERE d->>'month'=months.mon ORDER BY d->>'day' LIMIT 1) r ON true;
 RETURN jsonb_build_object('today',today,'month',mon,'me',jsonb_build_object('email',(SELECT email FROM auth.users WHERE id=uid),'isCeo',public.cockpit_is_ceo(),'isAdmin',public.cockpit_has_role('admin')),
 'deps',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY left_on DESC,id DESC) FROM public.cockpit_churn_departures d WHERE removed_at IS NULL AND public.cockpit_client_allowed(client)),'[]'),
 'monthRows',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY month) FROM public.cockpit_churn_months m WHERE public.cockpit_csm_scope_all()),'[]'),
 'cards',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM public.cockpit_billing_accounts b WHERE public.cockpit_client_allowed(client_name)),'[]'),
 'log',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY at DESC) FROM public.cockpit_churn_log l WHERE public.cockpit_csm_scope_all() OR public.cockpit_client_allowed(coalesce(detail->>'client',detail->'after'->>'client',detail->'before'->>'client'))),'[]'),
 'roster',jsonb_build_object('cards',roster,'starts',starts,'left',coalesce((SELECT jsonb_agg(jsonb_build_object('key',e->>'key','name',e->>'name','day',e->>'day','to',coalesce(e->>'to',e->>'kind'))) FROM jsonb_array_elements(src->'churnEvents') e WHERE e->>'kind' IN ('lost','removed','offboarded') AND e->>'month'>=to_char(today-interval '3 months','YYYY-MM')),'[]')));
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_csm_churn_edit(p_operation text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; email text; before_row public.cockpit_churn_departures; after_row public.cockpit_churn_departures; name text; mon text; k text; n numeric; what text; detail jsonb; today date:=(now() AT TIME ZONE 'Asia/Kuwait')::date;
BEGIN
 uid:=public.cockpit_csm_actor(); SELECT u.email INTO email FROM auth.users u WHERE u.id=uid;
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text)>12000 THEN RAISE EXCEPTION 'Invalid churn change'; END IF;
 IF p_operation IN ('saveDeparture','removeDeparture') THEN
  IF p_args ? 'id' THEN
   SELECT * INTO before_row FROM public.cockpit_churn_departures WHERE id=(p_args->>'id')::bigint AND removed_at IS NULL FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Departure is no longer in the register'; END IF;
   IF public.cockpit_client_allowed(before_row.client) IS NOT TRUE THEN RAISE EXCEPTION 'Client access denied' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_operation='removeDeparture' THEN
   IF before_row.id IS NULL OR NOT(public.cockpit_is_ceo() OR public.cockpit_has_role('admin')) THEN RAISE EXCEPTION 'Only the CEO or an admin removes a departure' USING ERRCODE='42501'; END IF;
   IF length(btrim(coalesce(p_args->>'why','')))<4 THEN RAISE EXCEPTION 'Say why it comes out'; END IF;
   UPDATE public.cockpit_churn_departures SET removed_at=now(),removed_by=email,removed_why=left(btrim(p_args->>'why'),500) WHERE id=before_row.id RETURNING * INTO after_row;
   what:='took '||before_row.client||' out of the register';
  ELSE
   name:=left(regexp_replace(btrim(p_args->>'client'),'\s+',' ','g'),160);
   IF public.cockpit_client_allowed(name) IS NOT TRUE THEN RAISE EXCEPTION 'Client access denied' USING ERRCODE='42501'; END IF;
   IF (p_args->>'leftOn')::date>today THEN RAISE EXCEPTION 'Log a departure on the day, not in the future'; END IF;
   IF nullif(p_args->>'clickupTaskId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cockpit_billing_accounts WHERE clickup_task_id=p_args->>'clickupTaskId' AND lower(btrim(client_name))=lower(name) UNION ALL SELECT 1 FROM public.cockpit_csm_sources s JOIN public.cockpit_csm_source_state st USING(table_name) WHERE s.table_name='clients' AND st.ready AND s.source_snapshot_at=st.source_snapshot_at AND s.data->>'taskId'=p_args->>'clickupTaskId' AND lower(btrim(s.data->>'name'))=lower(name)) THEN RAISE EXCEPTION 'The selected card does not match this client'; END IF;
   IF before_row.id IS NULL THEN
    INSERT INTO public.cockpit_churn_departures(client,clickup_task_id,left_on,launched_on,reason,mrr_lost_usd,csm,note,created_by,updated_by)
    VALUES(name,nullif(p_args->>'clickupTaskId',''),(p_args->>'leftOn')::date,nullif(p_args->>'launchedOn','')::date,p_args->>'reason',(p_args->>'mrrLostUsd')::numeric,nullif(btrim(p_args->>'csm'),''),nullif(left(btrim(p_args->>'note'),2000),''),email,email) RETURNING * INTO after_row;
    what:='logged '||name||' leaving';
   ELSE
    UPDATE public.cockpit_churn_departures SET client=name,clickup_task_id=nullif(p_args->>'clickupTaskId',''),left_on=(p_args->>'leftOn')::date,launched_on=nullif(p_args->>'launchedOn','')::date,reason=p_args->>'reason',mrr_lost_usd=(p_args->>'mrrLostUsd')::numeric,csm=nullif(btrim(p_args->>'csm'),''),note=nullif(left(btrim(p_args->>'note'),2000),''),updated_by=email,updated_at=now() WHERE id=before_row.id RETURNING * INTO after_row;
    what:='corrected '||name;
   END IF;
  END IF;
  detail:=jsonb_build_object('client',after_row.client,'before',to_jsonb(before_row),'after',to_jsonb(after_row));
 ELSIF p_operation='saveMonth' THEN
  IF NOT public.cockpit_csm_scope_all() THEN RAISE EXCEPTION 'An organization-wide month requires an unscoped CSM seat' USING ERRCODE='42501'; END IF;
  mon:=p_args->>'month'; IF NOT public.cockpit_csm_month_valid(mon) OR mon>to_char(today,'YYYY-MM') THEN RAISE EXCEPTION 'Choose a month that has started'; END IF;
  FOREACH k IN ARRAY ARRAY['activeAtStart','newClients'] LOOP
   IF p_args ? k AND p_args->k<>'null'::jsonb THEN
    n:=(p_args->>k)::numeric; IF jsonb_typeof(p_args->k)<>'number' OR n<0 OR n>=10000 OR n<>trunc(n) THEN RAISE EXCEPTION 'Counts must be whole numbers between 0 and 9999'; END IF;
   END IF;
  END LOOP;
  INSERT INTO public.cockpit_churn_months(month,active_at_start,new_clients,updated_by) VALUES(mon,(p_args->>'activeAtStart')::integer,(p_args->>'newClients')::integer,email)
  ON CONFLICT(month) DO UPDATE SET active_at_start=CASE WHEN p_args ? 'activeAtStart' THEN excluded.active_at_start ELSE public.cockpit_churn_months.active_at_start END,new_clients=CASE WHEN p_args ? 'newClients' THEN excluded.new_clients ELSE public.cockpit_churn_months.new_clients END,updated_by=email,updated_at=now();
  what:='set '||mon||'''s numbers'; detail:=p_args;
 ELSIF p_operation='dismiss' THEN
  IF public.cockpit_client_allowed(p_args->>'client') IS NOT TRUE THEN RAISE EXCEPTION 'Client access denied' USING ERRCODE='42501'; END IF;
  IF length(btrim(coalesce(p_args->>'key','')))=0 OR (p_args->>'leftOn')::date IS NULL THEN RAISE EXCEPTION 'Choose a departure suggestion'; END IF;
  what:='dismissed a suggestion'; detail:=jsonb_build_object('key',(p_args->>'key')||':'||(p_args->>'leftOn'),'client',p_args->>'client','why',left(btrim(p_args->>'why'),300));
 ELSE RAISE EXCEPTION 'Unknown churn change'; END IF;
 INSERT INTO public.cockpit_churn_log(by_whom,what,detail) VALUES(email,what,detail);
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_churn_read(),public.cockpit_csm_churn_edit(text,jsonb),public.cockpit_csm_domain_audit(),public.cockpit_csm_immutable_log() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_churn_read(),public.cockpit_csm_churn_edit(text,jsonb) TO authenticated;

CREATE TABLE IF NOT EXISTS public.cockpit_csm_projections (
 week_start date NOT NULL,owner_email text NOT NULL,metric text NOT NULL CHECK(metric IN ('resell','renewal','cash','review','referral')),
 data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object'),updated_at timestamptz NOT NULL DEFAULT now(),
 source_id text UNIQUE,PRIMARY KEY(week_start,owner_email,metric),CHECK(extract(dow FROM week_start)=0)
);
CREATE TABLE IF NOT EXISTS public.cockpit_csm_renewal_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id text NOT NULL,client_name text NOT NULL,renewal_date date NOT NULL,
 data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object'),updated_at timestamptz NOT NULL DEFAULT now(),source_id text UNIQUE,
 UNIQUE(task_id,renewal_date)
);
ALTER TABLE public.cockpit_csm_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_csm_renewal_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_csm_projections,public.cockpit_csm_renewal_plans FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_csm_projections,public.cockpit_csm_renewal_plans TO service_role;
CREATE TRIGGER csm_projection_audit AFTER INSERT OR UPDATE ON public.cockpit_csm_projections FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_domain_audit();
CREATE TRIGGER csm_renewal_plan_audit AFTER INSERT OR UPDATE ON public.cockpit_csm_renewal_plans FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_domain_audit();

-- A meeting embeds the same data, not an elevated bridge identity.
CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_actor(p_meeting_id text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); actor_email text;
BEGIN
 SELECT m.email INTO actor_email FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=uid AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email));
 IF actor_email IS NULL THEN RAISE EXCEPTION 'Active verified membership required' USING ERRCODE='42501'; END IF;
 IF p_meeting_id IS NULL THEN RETURN public.cockpit_csm_actor(); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.team_meetings WHERE id=p_meeting_id AND active AND embed IN ('cs-projections','cs-daily')) THEN RAISE EXCEPTION 'This meeting does not show client success projections'; END IF;
 IF NOT(public.cockpit_is_ceo() OR public.cockpit_has_role('admin')) AND NOT EXISTS(
 SELECT 1 FROM public.team_meeting_people mp JOIN public.team_people p ON p.id=mp.person_id
 WHERE mp.meeting_id=p_meeting_id AND NOT mp.removed AND lower(btrim(p.email))=actor_email) THEN
 RAISE EXCEPTION 'The projections are for this meeting''s participants' USING ERRCODE='42501'; END IF;
 RETURN uid;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_client(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;
BEGIN
 SELECT s.data||coalesce(o.data,'{}') INTO c FROM public.cockpit_csm_sources s
 JOIN public.cockpit_csm_source_state st USING(table_name)
 LEFT JOIN public.cockpit_csm_client_overrides o ON o.task_id=s.data->>'taskId' AND extract(epoch FROM o.confirmed_at)*1000>coalesce((s.data->>'syncedAt')::numeric,0)
 WHERE s.table_name='clients' AND st.ready AND s.source_snapshot_at=st.source_snapshot_at AND s.data->>'taskId'=p_task_id LIMIT 1;
 IF c IS NULL OR public.cockpit_client_allowed(c->>'name') IS NOT TRUE THEN RAISE EXCEPTION 'Choose an assigned client' USING ERRCODE='42501'; END IF;
 RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_read(p_for_email text DEFAULT NULL,p_meeting_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; email text; owner text; missing text; clients jsonb; rows jsonb; tables jsonb:='{}'; t text; ledger_at timestamptz;
BEGIN
 uid:=public.cockpit_csm_projection_actor(p_meeting_id);SELECT u.email INTO email FROM auth.users u WHERE u.id=uid;
 owner:=lower(btrim(coalesce(p_for_email,email)));
 IF owner<>email AND NOT(public.cockpit_is_ceo() OR public.cockpit_has_role('admin')) THEN RAISE EXCEPTION 'Only the CEO or an admin opens another person''s projections' USING ERRCODE='42501'; END IF;
 SELECT string_agg(st.table_name,', ') INTO missing FROM public.cockpit_csm_source_state st
 WHERE st.table_name IN ('clients','decisions','appointments','clientProfiles') AND (NOT st.ready OR st.source_snapshot_at IS NULL OR st.row_count IS DISTINCT FROM (SELECT count(*) FROM public.cockpit_csm_sources s WHERE s.table_name=st.table_name AND s.source_snapshot_at=st.source_snapshot_at));
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Client-success history is not ready: %',missing; END IF;
 FOREACH t IN ARRAY ARRAY['clients','decisions','appointments','clientProfiles'] LOOP
 SELECT coalesce(jsonb_agg(s.data),'[]') INTO rows FROM public.cockpit_csm_sources s JOIN public.cockpit_csm_source_state st USING(table_name)
 WHERE s.table_name=t AND s.source_snapshot_at=st.source_snapshot_at AND (public.cockpit_csm_scope_all() OR (cardinality(s.client_names)>0 AND NOT EXISTS(SELECT 1 FROM unnest(s.client_names) n WHERE NOT public.cockpit_client_allowed(n))));
 tables:=jsonb_set(tables,ARRAY[t],rows);
 END LOOP;
 SELECT coalesce(jsonb_agg(public.cockpit_csm_projection_client(c->>'taskId')),'[]') INTO clients FROM jsonb_array_elements(tables->'clients') c;
 SELECT max(finished_at) INTO ledger_at FROM public.cockpit_finance_refreshes WHERE status='confirmed';
 RETURN jsonb_build_object('today',(now() AT TIME ZONE 'Asia/Kuwait')::date,'owner',owner,'email',email,
 'canGold',public.cockpit_is_ceo(),'canEditOthers',public.cockpit_is_ceo() OR public.cockpit_has_role('admin'),
 'clients',clients,'appointments',tables->'appointments','profiles',tables->'clientProfiles',
 'decisions',(tables->'decisions')||coalesce((SELECT jsonb_agg(jsonb_build_object('day',d.day,'subject',d.subject,'action',d.action,'kind',coalesce(d.metadata->>'projectionKind',d.kind),'role',d.role)) FROM public.cockpit_decisions d WHERE role='csm' AND d.source_system='supabase' AND public.cockpit_client_allowed(subject)),'[]'),
 'projections',coalesce((SELECT jsonb_agg(p.data||jsonb_build_object('weekStart',p.week_start,'byEmail',p.owner_email,'metric',p.metric,'at',extract(epoch FROM p.updated_at)*1000)) FROM public.cockpit_csm_projections p WHERE p.owner_email=owner OR public.cockpit_is_ceo() OR public.cockpit_has_role('admin')),'[]'),
 'plans',coalesce((SELECT jsonb_agg(p.data||jsonb_build_object('_id',p.id,'taskId',p.task_id,'clientName',p.client_name,'renewalDate',p.renewal_date,'updatedAt',extract(epoch FROM p.updated_at)*1000)) FROM public.cockpit_csm_renewal_plans p WHERE public.cockpit_client_allowed(client_name)),'[]'),
 'feed',jsonb_build_object('okAt',extract(epoch FROM ledger_at)*1000,'ledgerSyncedAt',extract(epoch FROM ledger_at)*1000,'error',CASE WHEN ledger_at IS NULL THEN 'The billing ledger has not completed a native refresh' END,
 'payments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.payment_id,'taskId',p.clickup_task_id,'clientName',p.client_name,'day',p.day,'usd',p.usd,'side',p.side,'kind',p.kind)) FROM public.cockpit_client_payments p WHERE p.active AND public.cockpit_client_allowed(client_name)),'[]'),
 'accounts',coalesce((SELECT jsonb_agg(jsonb_build_object('taskId',b.clickup_task_id,'clientName',b.client_name,'ltvUsd',b.ltv_field_usd)) FROM public.cockpit_billing_accounts b WHERE public.cockpit_client_allowed(client_name)),'[]')));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_facts(p_client jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE facts jsonb:='[]'; k text; labels text[]:=ARRAY['Stage','Happiness','Service','Last call','Last report sent','Next payment']; keys text[]:=ARRAY['stage','happiness','service','lastCall','lastReport','paymentDate']; i integer; profile jsonb; paid numeric;
BEGIN
 FOR i IN 1..array_length(keys,1) LOOP
  k:=keys[i]; IF nullif(p_client->>k,'') IS NOT NULL THEN facts:=facts||jsonb_build_array(jsonb_build_object('label',labels[i],'value',p_client->>k,'source','ClickUp '||labels[i])); END IF;
 END LOOP;
 SELECT p.kpi INTO profile FROM public.cockpit_client_profiles p WHERE lower(btrim(p.client_name))=lower(btrim(p_client->>'name'));
 IF nullif(profile->>'error','') IS NULL THEN
  FOREACH k IN ARRAY ARRAY['leads','booked','closes'] LOOP
   IF jsonb_typeof(profile->'month'->k)='number' THEN facts:=facts||jsonb_build_array(jsonb_build_object('label',initcap(k)||' this month','value',profile->'month'->>k,'source','The client performance sheet')); END IF;
  END LOOP;
 END IF;
 SELECT sum(usd) INTO paid FROM public.cockpit_client_payments WHERE active AND (clickup_task_id=p_client->>'taskId' OR lower(btrim(client_name))=lower(btrim(p_client->>'name')));
 IF paid IS NOT NULL THEN facts:=facts||jsonb_build_array(jsonb_build_object('label','Paid so far','value','$'||paid::text,'source','Billing ledger')); END IF;
 RETURN facts;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_edit(p_edit jsonb,p_meeting_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; email text; owner text; kind text:=p_edit->>'kind'; today date:=(now() AT TIME ZONE 'Asia/Kuwait')::date;
 ws date; v_metric text; patch jsonb; c jsonb; p public.cockpit_csm_renewal_plans; old_data jsonb; val jsonb; k text; n numeric; status text; was text; won text; first_win boolean; sourced boolean; ledger_at timestamptz;
BEGIN
 uid:=public.cockpit_csm_projection_actor(p_meeting_id);SELECT u.email INTO email FROM auth.users u WHERE u.id=uid;
 IF jsonb_typeof(p_edit) IS DISTINCT FROM 'object' OR octet_length(p_edit::text)>16000 THEN RAISE EXCEPTION 'Invalid projection change'; END IF;
 IF kind IN ('projection','actual','missReason') THEN
  ws:=(p_edit->>'weekStart')::date; v_metric:=p_edit->>'metric'; owner:=lower(btrim(coalesce(p_edit->>'forEmail',email)));
  IF ws IS NULL OR extract(dow FROM ws)<>0 OR ws<today-extract(dow FROM today)::integer-56 OR ws>today-extract(dow FROM today)::integer+7 THEN RAISE EXCEPTION 'Choose a Sunday from eight weeks back to next week'; END IF;
  IF v_metric IS NULL OR v_metric NOT IN ('resell','renewal','cash','review','referral') THEN RAISE EXCEPTION 'Pick a metric'; END IF;
  IF owner<>email AND NOT(public.cockpit_is_ceo() OR public.cockpit_has_role('admin')) THEN RAISE EXCEPTION 'Only the CEO or an admin edits another person''s projection' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id WHERE m.active AND m.email=owner AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email))) THEN RAISE EXCEPTION 'Choose an active projection owner'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('projection:'||ws||':'||owner||':'||v_metric,0));
  SELECT data INTO old_data FROM public.cockpit_csm_projections WHERE week_start=ws AND owner_email=owner AND metric=v_metric FOR UPDATE;
  IF kind<>'projection' AND old_data IS NULL THEN RAISE EXCEPTION 'Set blood and stretch first'; END IF;
  IF kind='projection' THEN patch:=jsonb_build_object('blood',p_edit->'blood','stretch',p_edit->'stretch');
  ELSIF kind='actual' THEN
   SELECT max(finished_at) INTO ledger_at FROM public.cockpit_finance_refreshes WHERE status='confirmed';
   sourced:=CASE WHEN v_metric='cash' THEN ledger_at IS NOT NULL AND ledger_at>now()-interval '3 hours' AND (ws+6>=today OR ledger_at>((ws+7)::timestamp AT TIME ZONE 'Asia/Kuwait'))
    WHEN v_metric='renewal' THEN EXISTS(SELECT 1 FROM public.cockpit_csm_sources s JOIN public.cockpit_csm_source_state st USING(table_name) WHERE s.table_name='clients' AND st.ready AND s.source_snapshot_at=st.source_snapshot_at AND s.data->>'renewalTracked'='true' AND public.cockpit_client_allowed(s.data->>'name'))
    ELSE EXISTS(SELECT 1 FROM public.cockpit_csm_source_state WHERE table_name='decisions' AND ready) END;
   IF sourced THEN RAISE EXCEPTION 'This actual fills in from its source; it cannot be overridden'; END IF;
   patch:=jsonb_build_object('actual',p_edit->'actual');
  ELSE patch:=jsonb_build_object('missReason',nullif(left(btrim(p_edit->>'reason'),300),'')); END IF;
  FOR k,val IN SELECT key,value FROM jsonb_each(patch) WHERE key IN ('blood','stretch','actual') LOOP
   IF val='null'::jsonb AND k='actual' THEN CONTINUE; END IF;
   IF jsonb_typeof(val) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Projection values must be numbers'; END IF;
   n:=val::text::numeric; IF n<0 OR n>(CASE WHEN v_metric='cash' THEN 10000000 ELSE 1000 END) THEN RAISE EXCEPTION 'Projection value is out of range'; END IF;
  END LOOP;
  IF kind='projection' AND (patch->>'stretch')::numeric<(patch->>'blood')::numeric THEN RAISE EXCEPTION 'Stretch is at least blood'; END IF;
  INSERT INTO public.cockpit_csm_projections(week_start,owner_email,metric,data) VALUES(ws,owner,v_metric,patch)
  ON CONFLICT(week_start,owner_email,metric) DO UPDATE SET data=public.cockpit_csm_projections.data||excluded.data,updated_at=now();
 ELSE
  IF kind='gold' THEN
   IF NOT public.cockpit_is_ceo() THEN RAISE EXCEPTION 'Only the CEO marks gold-standard calls' USING ERRCODE='42501'; END IF;
   SELECT * INTO p FROM public.cockpit_csm_renewal_plans WHERE id=(p_edit->>'planId')::uuid FOR UPDATE;
   IF p.id IS NULL THEN RAISE EXCEPTION 'Renewal plan was not found'; END IF;
   IF jsonb_typeof(p_edit->'on') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Choose the gold-standard state'; END IF;
   IF p_edit->>'on'='true' AND nullif(p.data->>'callRecordingUrl','') IS NULL THEN RAISE EXCEPTION 'Add the recording first'; END IF;
   patch:=jsonb_build_object('goldStandard',p_edit->'on','goldBy',email);
  ELSIF kind IN ('plan','status') THEN
   c:=public.cockpit_csm_projection_client(p_edit->>'taskId');
   IF nullif(c->>'renewalDate','') IS NULL THEN RAISE EXCEPTION 'Add the contract end date to the ClickUp card first'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('renewal:'||(c->>'taskId')||':'||(c->>'renewalDate'),0));
   INSERT INTO public.cockpit_csm_renewal_plans(task_id,client_name,renewal_date,data) VALUES(c->>'taskId',c->>'name',(c->>'renewalDate')::date,jsonb_build_object('status','planned','whereTheyAre',public.cockpit_csm_projection_facts(c))) ON CONFLICT(task_id,renewal_date) DO NOTHING;
   SELECT * INTO p FROM public.cockpit_csm_renewal_plans WHERE task_id=c->>'taskId' AND renewal_date=(c->>'renewalDate')::date FOR UPDATE;
   first_win:=coalesce((c->>'firstWin')::boolean,(c->>'stage'='Active' AND coalesce((c->>'liveDays')::numeric,0)>=14),false);
   IF kind='plan' THEN
    patch:=p_edit->'patch'; IF jsonb_typeof(patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid renewal plan'; END IF;
    FOR k,val IN SELECT key,value FROM jsonb_each(patch) LOOP
     IF k NOT IN ('likelihood','angle','objection','objectionAnswer','offer','callBookedFor','notThisCycleReason','outcomeNote','callRecordingUrl','refreshFacts') THEN RAISE EXCEPTION 'Unknown renewal field: %',k; END IF;
     IF k NOT IN ('offer','refreshFacts') AND jsonb_typeof(val) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Renewal fields must be text'; END IF;
     IF k NOT IN ('offer','refreshFacts') AND length(val#>>'{}')>600 THEN RAISE EXCEPTION 'Renewal text is too long'; END IF;
    END LOOP;
    IF patch ? 'likelihood' AND patch->>'likelihood' NOT IN ('','high','medium','low') THEN RAISE EXCEPTION 'Pick the renewal likelihood'; END IF;
    IF patch->>'likelihood'='' THEN patch:=jsonb_set(patch,'{likelihood}','null'); END IF;
    IF patch ? 'offer' AND patch->'offer'<>'null'::jsonb THEN
     IF jsonb_typeof(patch->'offer')<>'object' THEN RAISE EXCEPTION 'Invalid offer'; END IF;
     IF p.data->'offer' IS NULL OR p.data->'offer'='null'::jsonb THEN
      IF NOT first_win THEN RAISE EXCEPTION 'First win needed before a re-sell'; END IF;
      IF EXISTS(SELECT 1 FROM public.cockpit_decisions d WHERE d.role='csm' AND d.subject=c->>'name' AND d.day>=date_trunc('month',today)::date AND d.kind<>'left' AND d.action ~* 'upsell|re-?sell|referral|review'
       UNION ALL SELECT 1 FROM public.cockpit_csm_sources s JOIN public.cockpit_csm_source_state st USING(table_name) WHERE s.table_name='decisions' AND st.ready AND s.source_snapshot_at=st.source_snapshot_at AND s.data->>'role'='csm' AND s.data->>'subject'=c->>'name' AND s.data->>'day'>=date_trunc('month',today)::date::text AND s.data->>'kind'<>'left' AND s.data->>'action' ~* 'upsell|re-?sell|referral|review') THEN RAISE EXCEPTION 'One re-sell conversation a month'; END IF;
     END IF;
     FOR k,val IN SELECT key,value FROM jsonb_each(patch->'offer') LOOP
      IF k NOT IN ('price','deliverables','durationMonths') THEN RAISE EXCEPTION 'Unknown offer field'; END IF;
      IF k='deliverables' THEN IF jsonb_typeof(val) NOT IN ('string','null') OR length(val#>>'{}')>400 THEN RAISE EXCEPTION 'Describe the deliverables in 400 characters'; END IF;
      ELSIF val<>'null'::jsonb THEN
       IF jsonb_typeof(val)<>'number' THEN RAISE EXCEPTION 'Offer values must be numbers'; END IF; n:=val::text::numeric;
       IF (k='price' AND (n<0 OR n>10000000)) OR (k='durationMonths' AND (n<1 OR n>36 OR n<>trunc(n))) THEN RAISE EXCEPTION 'Invalid offer amount or duration'; END IF;
      END IF;
     END LOOP;
    END IF;
    IF patch ? 'callBookedFor' THEN
     IF nullif(patch->>'callBookedFor','') IS NOT NULL THEN
      IF (patch->>'callBookedFor') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}($|T)' OR (patch->>'callBookedFor')::timestamptz IS NULL THEN RAISE EXCEPTION 'Choose a valid call date'; END IF;
      IF p.data->>'status'='planned' THEN patch:=patch||jsonb_build_object('status','call_booked'); END IF;
     ELSE patch:=patch||jsonb_build_object('callBookedFor',NULL); IF p.data->>'status'='call_booked' THEN patch:=patch||jsonb_build_object('status','planned'); END IF; END IF;
    END IF;
    IF patch ? 'callRecordingUrl' THEN
     IF nullif(patch->>'callRecordingUrl','') IS NOT NULL AND (patch->>'callRecordingUrl') !~ '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'Paste a recording link starting with https://'; END IF;
     IF nullif(patch->>'callRecordingUrl','') IS NULL THEN patch:=patch||jsonb_build_object('callRecordingUrl',NULL,'goldStandard',false); END IF;
    END IF;
    IF patch->>'refreshFacts'='true' THEN patch:=patch||jsonb_build_object('whereTheyAre',public.cockpit_csm_projection_facts(c)); END IF;
    patch:=patch-'refreshFacts';
   ELSE
    status:=p_edit->>'status';
    IF status IS NULL OR status NOT IN ('planned','call_booked','renewed','resold','not_this_cycle','lost') THEN RAISE EXCEPTION 'Pick the renewal status'; END IF;
    IF status='resold' AND NOT first_win THEN RAISE EXCEPTION 'First win needed before a re-sell'; END IF;
    IF status='call_booked' AND nullif(p.data->>'callBookedFor','') IS NULL THEN RAISE EXCEPTION 'Put the call date in first'; END IF;
    IF status='not_this_cycle' AND nullif(btrim(coalesce(p_edit->>'reason',p.data->>'notThisCycleReason')),'') IS NULL THEN RAISE EXCEPTION 'Say why it is not this cycle'; END IF;
    patch:=jsonb_build_object('status',status);
    IF nullif(btrim(p_edit->>'reason'),'') IS NOT NULL THEN patch:=patch||jsonb_build_object('notThisCycleReason',left(btrim(p_edit->>'reason'),300)); END IF;
    IF nullif(btrim(p_edit->>'note'),'') IS NOT NULL THEN patch:=patch||jsonb_build_object('outcomeNote',left(btrim(p_edit->>'note'),600)); END IF;
    was:=CASE p.data->>'status' WHEN 'renewed' THEN 'renewal' WHEN 'resold' THEN 're-sell' END;
    won:=CASE status WHEN 'renewed' THEN 'renewal' WHEN 'resold' THEN 're-sell' END;
    IF was IS NOT NULL AND was IS DISTINCT FROM won THEN
     INSERT INTO public.cockpit_decisions(role,day,subject,action,kind,metadata,source_system) VALUES('csm',today,p.client_name,'Won undone: '||was,'approved',jsonb_build_object('projectionKind','unwon','planId',p.id),'supabase');
    END IF;
    IF won IS NOT NULL AND won IS DISTINCT FROM was THEN
     INSERT INTO public.cockpit_decisions(role,day,subject,action,kind,metadata,source_system) VALUES('csm',today,p.client_name,'Won: '||won,'approved',jsonb_build_object('projectionKind','won','planId',p.id),'supabase');
     IF p.data->'celebratedAt' IS NULL THEN
      INSERT INTO public.eod_outbox(role,day,person,slack_id,channel,tab,body,row_values,status,attempts,error)
      VALUES('csm-win',today,left('plan:'||p.id,120),NULL,'#eods-csms',NULL,'Client success win: '||p.client_name||CASE won WHEN 'renewal' THEN ' renewed.' ELSE ' took a re-sell.' END,NULL,'queued',0,NULL)
      ON CONFLICT(role,day,person) DO NOTHING;
      patch:=patch||jsonb_build_object('celebratedAt',extract(epoch FROM now())*1000);
     END IF;
    END IF;
   END IF;
  ELSE RAISE EXCEPTION 'Unknown projection change'; END IF;
  UPDATE public.cockpit_csm_renewal_plans SET data=data||patch||jsonb_build_object('updatedBy',email),updated_at=now() WHERE id=p.id;
 END IF;
 IF p_meeting_id IS NOT NULL THEN INSERT INTO public.team_changes(by_whom,meeting_id,what,detail) VALUES(email,p_meeting_id,'Changed client success projections: '||kind,p_edit); END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_booking_context(p_task_id text,p_meeting_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; c jsonb; p public.cockpit_csm_renewal_plans;
BEGIN
 uid:=public.cockpit_csm_projection_actor(p_meeting_id); c:=public.cockpit_csm_projection_client(p_task_id);
 IF nullif(c->>'renewalDate','') IS NULL THEN RAISE EXCEPTION 'Add the contract end date first'; END IF;
 SELECT * INTO p FROM public.cockpit_csm_renewal_plans WHERE task_id=p_task_id AND renewal_date=(c->>'renewalDate')::date;
 IF p.data->>'status' IN ('renewed','resold','not_this_cycle','lost') THEN RAISE EXCEPTION 'This renewal already has an outcome'; END IF;
 RETURN jsonb_build_object('actorId',uid,'email',(SELECT email FROM auth.users WHERE id=uid),'taskId',p_task_id,'clientName',c->>'name','client',c,'planId',p.id,'renewalDate',c->>'renewalDate',
 'contactId',(SELECT t.contact_id FROM public.wa_threads t WHERE t.client_task_id=p_task_id AND t.desk='csm' ORDER BY t.last_at DESC NULLS LAST LIMIT 1),
 'appointments',coalesce((SELECT jsonb_agg(recent.data) FROM (SELECT s.data FROM public.cockpit_csm_sources s JOIN public.cockpit_csm_source_state st USING(table_name) WHERE s.table_name='appointments' AND st.ready AND s.source_snapshot_at=st.source_snapshot_at AND s.data->>'clientName'=c->>'name' ORDER BY s.data->>'day' DESC LIMIT 5) recent),'[]'));
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_record_booking(p_actor uuid,p_task_id text,p_when text,p_event_id text,p_meeting_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_claims text; previous_sub text; result jsonb;
BEGIN
 IF nullif(btrim(p_event_id),'') IS NULL THEN RAISE EXCEPTION 'Provider event confirmation is required'; END IF;
 previous_claims:=current_setting('request.jwt.claims',true);
 previous_sub:=current_setting('request.jwt.claim.sub',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
 PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
 PERFORM public.cockpit_csm_projection_booking_context(p_task_id,p_meeting_id);
 result:=public.cockpit_csm_projection_edit(jsonb_build_object('kind','plan','taskId',p_task_id,'patch',jsonb_build_object('callBookedFor',p_when)),p_meeting_id);
 UPDATE public.cockpit_csm_renewal_plans SET data=data||jsonb_build_object('ghlAppointmentId',p_event_id) WHERE task_id=p_task_id AND renewal_date=(public.cockpit_csm_projection_client(p_task_id)->>'renewalDate')::date;
 PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_projection_actor(text),public.cockpit_csm_projection_client(text),public.cockpit_csm_projection_read(text,text),public.cockpit_csm_projection_facts(jsonb),public.cockpit_csm_projection_edit(jsonb,text),public.cockpit_csm_projection_booking_context(text,text),public.cockpit_csm_projection_record_booking(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_projection_read(text,text),public.cockpit_csm_projection_edit(jsonb,text),public.cockpit_csm_projection_booking_context(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_projection_record_booking(uuid,text,text,text,text) TO service_role;

-- A closed hot-list row is the same counted win as a renewal outcome.
CREATE OR REPLACE FUNCTION public.cockpit_csm_hot_outcome() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE metric text; closed boolean:=NEW.data->>'status'='Closed'; was_closed boolean:=false; today date:=(now() AT TIME ZONE 'Asia/Kuwait')::date;
BEGIN
 IF TG_OP='UPDATE' THEN was_closed:=coalesce(OLD.data->>'status'='Closed',false); END IF;
 closed:=coalesce(closed,false);
 metric:=CASE WHEN NEW.data->>'type' ILIKE 'upsell%' THEN 're-sell' WHEN NEW.data->>'type' ILIKE 'review%' THEN 'review' WHEN NEW.data->>'type' ILIKE 'referral%' THEN 'referral' END;
 IF auth.uid() IS NULL OR metric IS NULL OR NEW.client_name='' OR closed=was_closed THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_decisions(role,day,subject,action,kind,evidence,metadata,source_system)
 VALUES('csm',today,NEW.client_name,CASE WHEN closed THEN 'Won: ' ELSE 'Won undone: ' END||metric,'approved','Hot list',jsonb_build_object('projectionKind',CASE WHEN closed THEN 'won' ELSE 'unwon' END,'hotKey',NEW.key),'supabase');
 IF closed AND metric='re-sell' AND NEW.data->'celebratedAt' IS NULL THEN
  INSERT INTO public.eod_outbox(role,day,person,slack_id,channel,tab,body,row_values,status,attempts,error)
  VALUES('csm-win',today,left('hot:'||NEW.key,120),NULL,'#eods-csms',NULL,'Client success win: '||NEW.client_name||' took a re-sell ('||(NEW.data->>'type')||').',NULL,'queued',0,NULL)
  ON CONFLICT(role,day,person) DO NOTHING;
  UPDATE public.cockpit_csm_hot_rows SET data=data||jsonb_build_object('celebratedAt',extract(epoch FROM now())*1000) WHERE key=NEW.key;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER csm_hot_outcome AFTER INSERT OR UPDATE ON public.cockpit_csm_hot_rows FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_hot_outcome();
REVOKE ALL ON FUNCTION public.cockpit_csm_hot_outcome() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
