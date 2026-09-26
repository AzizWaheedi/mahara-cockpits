-- CEO goals on the existing tables. Apply through the reviewed migration process.
BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_goal_actor()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor text;
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN
    RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501';
  END IF;
  SELECT lower(btrim(email)) INTO actor FROM auth.users WHERE id=auth.uid();
  IF actor IS NULL THEN RAISE EXCEPTION 'Verified identity required' USING ERRCODE='42501'; END IF;
  RETURN actor;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_goal_working_days(p_from date, p_to date)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH span AS (SELECT greatest(0,p_to-p_from+1) AS n)
  SELECT (n/7)*6 + (SELECT count(*)::integer FROM generate_series(0,n%7-1) d
    WHERE extract(dow FROM p_from+d) <> 5) FROM span;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goals_context(p_plan_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.cockpit_goal_plans; plans jsonb; targets jsonb; payloads jsonb;
  scorecards integer; today date := (now() AT TIME ZONE 'Asia/Kuwait')::date; result jsonb;
BEGIN
  PERFORM public.cockpit_goal_actor();
  IF p_plan_id IS NOT NULL THEN
    SELECT * INTO p FROM public.cockpit_goal_plans WHERE id=p_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Plan no longer exists' USING ERRCODE='22023'; END IF;
  ELSE
    SELECT * INTO p FROM public.cockpit_goal_plans
      WHERE period_from<=today AND period_to>=today AND status<>'draft'
      ORDER BY period_from DESC,id DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT * INTO p FROM public.cockpit_goal_plans ORDER BY period_from DESC,id DESC LIMIT 1;
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.period_from DESC,t.id DESC),'[]') INTO plans
    FROM (SELECT id,title,period_from,period_to,status FROM public.cockpit_goal_plans
      ORDER BY period_from DESC,id DESC LIMIT 48) t;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.group_key,t.sort,t.id),'[]') INTO targets
    FROM public.cockpit_goal_targets t WHERE t.plan_id=p.id;
  SELECT coalesce(jsonb_object_agg(key,payload),'{}') INTO payloads
    FROM public.cockpit_sections WHERE key IN ('growth','money','delivery','organic')
      AND ok AND payload IS NOT NULL;
  IF p.id IS NOT NULL AND to_char(p.period_from,'YYYY-MM')=to_char(p.period_to,'YYYY-MM') THEN
    SELECT count(*)::integer INTO scorecards FROM public.cockpit_scorecards
      WHERE month=to_char(p.period_from,'YYYY-MM') AND status='final';
  END IF;
  result := jsonb_build_object('plan',CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p) END,
    'plans',plans,'targets',targets,'payloads',payloads,'scorecardsDone',scorecards,'today',today::text);
  RETURN result || jsonb_build_object('fingerprint',md5((result-'plans')::text));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_save_plan(p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.cockpit_goal_plans; saved_id bigint; who text; k text;
  v_from date; v_to date; v_kind text; v_status text; v_title text; v_mission text; v_headline text; v_days integer;
BEGIN
  who := public.cockpit_goal_actor();
  IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Plan must be an object' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_plan) LOOP
    IF k <> ALL(ARRAY['id','periodKind','periodFrom','periodTo','title','mission','headline','status','workingDays']) THEN
      RAISE EXCEPTION 'Unknown plan field: %',k USING ERRCODE='22023';
    END IF;
    IF k IN ('id','workingDays') THEN
      IF p_plan->k <> 'null'::jsonb AND (jsonb_typeof(p_plan->k)<>'number' OR (p_plan->>k)::numeric<>trunc((p_plan->>k)::numeric)) THEN
        RAISE EXCEPTION 'Plan numeric fields must be integers' USING ERRCODE='22023';
      END IF;
    ELSIF jsonb_typeof(p_plan->k)<>'string' AND NOT(k IN ('mission','headline') AND p_plan->k='null'::jsonb) THEN
      RAISE EXCEPTION 'Plan text field invalid: %',k USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF p_plan->>'id' IS NOT NULL THEN
    SELECT * INTO old FROM public.cockpit_goal_plans WHERE id=(p_plan->>'id')::bigint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Plan no longer exists' USING ERRCODE='22023'; END IF;
  END IF;
  v_kind := coalesce(p_plan->>'periodKind',old.period_kind,'month');
  v_status := coalesce(p_plan->>'status',old.status,'draft');
  IF (p_plan ? 'periodFrom' AND p_plan->>'periodFrom' !~ '^\d{4}-\d{2}-\d{2}$') OR
     (p_plan ? 'periodTo' AND p_plan->>'periodTo' !~ '^\d{4}-\d{2}-\d{2}$') THEN
    RAISE EXCEPTION 'Use ISO calendar dates for the plan period' USING ERRCODE='22023';
  END IF;
  v_from := coalesce(p_plan->>'periodFrom',old.period_from::text)::date;
  v_to := coalesce(p_plan->>'periodTo',old.period_to::text)::date;
  v_title := btrim(coalesce(p_plan->>'title',old.title,''));
  IF v_from IS NULL OR v_to IS NULL OR v_to<v_from OR length(v_title)<3
    OR v_kind NOT IN ('month','quarter','custom') OR v_status NOT IN ('draft','live','closed') THEN
    RAISE EXCEPTION 'Check the plan name, dates and status' USING ERRCODE='22023';
  END IF;
  v_mission := CASE WHEN p_plan ? 'mission' THEN nullif(btrim(p_plan->>'mission'),'') ELSE old.mission END;
  v_headline := CASE WHEN p_plan ? 'headline' THEN nullif(btrim(p_plan->>'headline'),'') ELSE old.headline END;
  v_days := CASE WHEN p_plan ? 'workingDays' THEN (p_plan->>'workingDays')::integer
    WHEN old.period_from=v_from AND old.period_to=v_to THEN old.working_days ELSE NULL END;
  v_days := coalesce(v_days,public.cockpit_goal_working_days(v_from,v_to));
  IF v_days<0 OR v_days>v_to-v_from+1 THEN RAISE EXCEPTION 'Invalid working-day count' USING ERRCODE='22023'; END IF;
  IF old.id IS NULL THEN
    INSERT INTO public.cockpit_goal_plans(period_kind,period_from,period_to,title,mission,headline,status,working_days,created_by)
      VALUES(v_kind,v_from,v_to,v_title,v_mission,v_headline,v_status,v_days,who) RETURNING id INTO saved_id;
  ELSE
    UPDATE public.cockpit_goal_plans SET period_kind=v_kind,period_from=v_from,period_to=v_to,
      title=v_title,mission=v_mission,headline=v_headline,status=v_status,working_days=v_days,updated_at=now()
      WHERE id=old.id RETURNING id INTO saved_id;
  END IF;
  RETURN jsonb_build_object('id',saved_id);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_save_targets(p_plan_id bigint,p_targets jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t jsonb; old public.cockpit_goal_targets; k text; n integer:=0;
  g text; m text; v_label text; v_unit text; v_direction text;
BEGIN
  PERFORM public.cockpit_goal_actor();
  PERFORM 1 FROM public.cockpit_goal_plans WHERE id=p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan no longer exists' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_targets) IS DISTINCT FROM 'array' OR jsonb_array_length(p_targets)>1000 THEN
    RAISE EXCEPTION 'Targets must be an array of at most 1000 rows' USING ERRCODE='22023';
  END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
    IF jsonb_typeof(t)<>'object' THEN RAISE EXCEPTION 'Target must be an object' USING ERRCODE='22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(t) LOOP
      IF k <> ALL(ARRAY['id','groupKey','metricKey','label','unit','direction','target','stretch','baseline','actualManual','note','sort']) THEN
        RAISE EXCEPTION 'Unknown target field: %',k USING ERRCODE='22023';
      END IF;
      IF k IN ('id','target','stretch','baseline','actualManual','sort') THEN
        IF t->k <> 'null'::jsonb AND jsonb_typeof(t->k)<>'number' THEN RAISE EXCEPTION 'Target numbers must be numeric' USING ERRCODE='22023'; END IF;
        IF k IN ('id','sort') AND t->k <> 'null'::jsonb AND (t->>k)::numeric<>trunc((t->>k)::numeric) THEN
          RAISE EXCEPTION 'ID and order must be integers' USING ERRCODE='22023';
        END IF;
      ELSIF jsonb_typeof(t->k)<>'string' AND NOT(k='note' AND t->k='null'::jsonb) THEN
        RAISE EXCEPTION 'Target text field invalid: %',k USING ERRCODE='22023';
      END IF;
    END LOOP;
    old := NULL;
    IF t->>'id' IS NOT NULL THEN
      SELECT * INTO old FROM public.cockpit_goal_targets WHERE id=(t->>'id')::bigint AND plan_id=p_plan_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Target does not belong to this plan' USING ERRCODE='22023'; END IF;
    ELSE
      SELECT * INTO old FROM public.cockpit_goal_targets
        WHERE plan_id=p_plan_id AND group_key=btrim(t->>'groupKey') AND metric_key=btrim(t->>'metricKey') FOR UPDATE;
    END IF;
    g := btrim(coalesce(t->>'groupKey',old.group_key,''));
    m := btrim(coalesce(t->>'metricKey',old.metric_key,''));
    v_label := CASE WHEN t ? 'label' THEN coalesce(nullif(btrim(t->>'label'),''),m) ELSE coalesce(old.label,m) END;
    v_unit := coalesce(t->>'unit',old.unit,'count');
    v_direction := coalesce(t->>'direction',old.direction,'up');
    IF g='' OR m='' OR v_unit NOT IN ('usd','count','rate','days','x','pts','text') OR v_direction NOT IN ('up','down') THEN
      RAISE EXCEPTION 'Check target group, metric, unit and direction' USING ERRCODE='22023';
    END IF;
    IF old.id IS NULL THEN
      INSERT INTO public.cockpit_goal_targets(plan_id,group_key,metric_key,label,unit,direction,target,stretch,baseline,actual_manual,note,sort)
        VALUES(p_plan_id,g,m,v_label,v_unit,v_direction,(t->>'target')::numeric,(t->>'stretch')::numeric,(t->>'baseline')::numeric,
          (t->>'actualManual')::numeric,nullif(btrim(t->>'note'),''),coalesce((t->>'sort')::integer,n));
    ELSE
      UPDATE public.cockpit_goal_targets SET group_key=g,metric_key=m,label=v_label,unit=v_unit,direction=v_direction,
        target=CASE WHEN t ? 'target' THEN (t->>'target')::numeric ELSE old.target END,
        stretch=CASE WHEN t ? 'stretch' THEN (t->>'stretch')::numeric ELSE old.stretch END,
        baseline=CASE WHEN t ? 'baseline' THEN (t->>'baseline')::numeric ELSE old.baseline END,
        actual_manual=CASE WHEN t ? 'actualManual' THEN (t->>'actualManual')::numeric ELSE old.actual_manual END,
        note=CASE WHEN t ? 'note' THEN nullif(btrim(t->>'note'),'') ELSE old.note END,
        sort=coalesce((t->>'sort')::integer,old.sort)
        WHERE id=old.id;
    END IF;
    n:=n+1;
  END LOOP;
  RETURN jsonb_build_object('saved',n);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_remove_target(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE parent_id bigint;
BEGIN
  PERFORM public.cockpit_goal_actor();
  IF p_id IS NULL OR p_id<=0 THEN RAISE EXCEPTION 'Invalid target ID' USING ERRCODE='22023'; END IF;
  SELECT plan_id INTO parent_id FROM public.cockpit_goal_targets WHERE id=p_id;
  IF parent_id IS NOT NULL THEN
    PERFORM 1 FROM public.cockpit_goal_plans WHERE id=parent_id FOR UPDATE;
  END IF;
  DELETE FROM public.cockpit_goal_targets WHERE id=p_id;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_start_from(p_args jsonb,p_baselines jsonb,p_expected_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE who text; source public.cockpit_goal_plans; context jsonb; new_id bigint; n integer;
  v_from date; v_to date; v_title text; k text; val jsonb;
BEGIN
  who:=public.cockpit_goal_actor();
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR jsonb_typeof(p_baselines) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid copy request' USING ERRCODE='22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_args) LOOP
    IF k <> ALL(ARRAY['fromPlanId','periodFrom','periodTo','title']) THEN RAISE EXCEPTION 'Unknown copy field' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF jsonb_typeof(p_args->'periodFrom') IS DISTINCT FROM 'string' OR
     jsonb_typeof(p_args->'periodTo') IS DISTINCT FROM 'string' OR
     p_args->>'periodFrom' !~ '^\d{4}-\d{2}-\d{2}$' OR p_args->>'periodTo' !~ '^\d{4}-\d{2}-\d{2}$' OR
     (p_args ? 'title' AND jsonb_typeof(p_args->'title') IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'Check the copy title and ISO calendar dates' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_args->'fromPlanId') IS DISTINCT FROM 'number'
    OR (p_args->>'fromPlanId')::numeric<>trunc((p_args->>'fromPlanId')::numeric) THEN
    RAISE EXCEPTION 'Invalid source plan' USING ERRCODE='22023';
  END IF;
  SELECT * INTO source FROM public.cockpit_goal_plans WHERE id=(p_args->>'fromPlanId')::bigint FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No plan to start from' USING ERRCODE='22023'; END IF;
  context:=public.cockpit_ceo_goals_context(source.id);
  IF p_expected_snapshot IS NULL OR context->>'fingerprint' <> p_expected_snapshot THEN
    RAISE EXCEPTION 'Source plan or numbers changed; reload before copying' USING ERRCODE='40001';
  END IF;
  FOR k,val IN SELECT key,value FROM jsonb_each(p_baselines) LOOP
    IF jsonb_typeof(val) NOT IN ('number','null') THEN RAISE EXCEPTION 'Invalid baseline number' USING ERRCODE='22023'; END IF;
  END LOOP;
  v_from:=(p_args->>'periodFrom')::date; v_to:=(p_args->>'periodTo')::date;
  v_title:=coalesce(nullif(btrim(p_args->>'title'),''),source.title || ' (next)');
  IF v_from IS NULL OR v_to IS NULL OR v_to<v_from THEN RAISE EXCEPTION 'Invalid plan period' USING ERRCODE='22023'; END IF;
  INSERT INTO public.cockpit_goal_plans(period_kind,period_from,period_to,title,mission,headline,status,working_days,created_by)
    VALUES(source.period_kind,v_from,v_to,v_title,source.mission,NULL,'draft',public.cockpit_goal_working_days(v_from,v_to),who)
    RETURNING id INTO new_id;
  INSERT INTO public.cockpit_goal_targets(plan_id,group_key,metric_key,label,unit,direction,target,stretch,baseline,actual_source,actual_manual,note,sort)
    SELECT new_id,t.group_key,t.metric_key,t.label,t.unit,t.direction,t.target,t.stretch,
      coalesce((p_baselines->>t.metric_key)::numeric,t.actual_manual,t.baseline),t.actual_source,NULL,t.note,t.sort
    FROM jsonb_populate_recordset(NULL::public.cockpit_goal_targets,context->'targets') t;
  GET DIAGNOSTICS n=ROW_COUNT;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata)
    VALUES('CLONE','cockpit_goal_plans',new_id::text,who,'ceo-goals','supabase',
      jsonb_build_object('from_plan_id',source.id,'source_fingerprint',p_expected_snapshot,'baselines',p_baselines));
  RETURN jsonb_build_object('id',new_id,'targets',n);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_audit_goal_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE who text;
BEGIN
  SELECT lower(btrim(email)) INTO who FROM auth.users WHERE id=auth.uid();
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
    VALUES(TG_OP,TG_TABLE_NAME,CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END,
      coalesce(who,session_user),'ceo-goals','supabase',
      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
      jsonb_build_object('database_role',current_setting('role',true)));
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_goal_plan_audit ON public.cockpit_goal_plans;
CREATE TRIGGER cockpit_goal_plan_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_goal_plans
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_goal_change();
DROP TRIGGER IF EXISTS cockpit_goal_target_audit ON public.cockpit_goal_targets;
CREATE TRIGGER cockpit_goal_target_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_goal_targets
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_goal_change();

REVOKE ALL ON FUNCTION public.cockpit_goal_actor(),public.cockpit_goal_working_days(date,date),public.cockpit_audit_goal_change() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_ceo_goals_context(bigint),public.cockpit_ceo_goal_save_plan(jsonb),public.cockpit_ceo_goal_save_targets(bigint,jsonb),public.cockpit_ceo_goal_remove_target(bigint),public.cockpit_ceo_goal_start_from(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_goals_context(bigint),public.cockpit_ceo_goal_save_plan(jsonb),public.cockpit_ceo_goal_save_targets(bigint,jsonb),public.cockpit_ceo_goal_remove_target(bigint),public.cockpit_ceo_goal_start_from(jsonb,jsonb,text) TO authenticated,service_role;
COMMIT;
