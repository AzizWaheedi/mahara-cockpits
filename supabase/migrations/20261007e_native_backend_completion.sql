BEGIN;

-- Forward installation only. No provider actions or schedule activation.

DO $preflight$ BEGIN IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('cockpit_audit_goal_change','cockpit_ceo_cost_remove','cockpit_ceo_cost_save','cockpit_ceo_costs_context','cockpit_ceo_goal_remove_target','cockpit_ceo_goal_save_plan','cockpit_ceo_goal_save_plan_fields','cockpit_ceo_goal_save_targets','cockpit_ceo_goal_start_from','cockpit_ceo_goals_context','cockpit_cost_write_audit','cockpit_goal_working_days')) THEN RAISE EXCEPTION 'A proposed missing function now exists. Review current state before installation';END IF;END $preflight$;

-- Owner: 20260926l_cockpit_ceo_goals_access.sql

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

-- Owner: 20261004b_cockpit_ceo_costs_goals.sql

CREATE OR REPLACE FUNCTION public.cockpit_ceo_cost_remove(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.cockpit_goal_actor();
  IF p_id IS NULL OR p_id<=0 THEN RAISE EXCEPTION 'Invalid cost ID' USING ERRCODE='22023'; END IF;
  DELETE FROM public.cockpit_cost_lines WHERE id=p_id;
  RETURN jsonb_build_object('ok',true);
END $$;

-- Owner: 20261004b_cockpit_ceo_costs_goals.sql

CREATE OR REPLACE FUNCTION public.cockpit_ceo_cost_save(p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row public.cockpit_cost_lines; vals jsonb:='{}'; k text; x jsonb; col text; who text; creating boolean;
BEGIN
  who:=public.cockpit_goal_actor();
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Cost changes must be an object' USING ERRCODE='22023'; END IF;
  creating:=NOT(p_patch ? 'id');
  IF NOT creating THEN
    IF jsonb_typeof(p_patch->'id') IS DISTINCT FROM 'number' OR
      (p_patch->>'id')::numeric<>trunc((p_patch->>'id')::numeric) OR
      (p_patch->>'id')::numeric NOT BETWEEN 1 AND 9007199254740991 THEN
      RAISE EXCEPTION 'Invalid cost ID' USING ERRCODE='22023';
    END IF;
    SELECT * INTO row FROM public.cockpit_cost_lines WHERE id=(p_patch->>'id')::bigint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That line is not on the sheet any more' USING ERRCODE='22023'; END IF;
  ELSE
    row.billing:='monthly'; row.currency:='USD'; row.status:='active'; row.sort:=0;
  END IF;
  FOR k,x IN SELECT key,value FROM jsonb_each(p_patch) LOOP
    IF k='id' THEN CONTINUE; END IF;
    col:=CASE k WHEN 'kind' THEN 'kind' WHEN 'name' THEN 'name' WHEN 'category' THEN 'category'
      WHEN 'billing' THEN 'billing' WHEN 'seats' THEN 'seats' WHEN 'unitPrice' THEN 'unit_price'
      WHEN 'currency' THEN 'currency' WHEN 'paidWith' THEN 'paid_with' WHEN 'match' THEN 'match'
      WHEN 'status' THEN 'status' WHEN 'note' THEN 'note' WHEN 'sort' THEN 'sort' END;
    IF col IS NULL THEN RAISE EXCEPTION 'Unknown cost field: %',k USING ERRCODE='22023'; END IF;
    IF k IN ('seats','unitPrice','sort') THEN
      IF jsonb_typeof(x) IS DISTINCT FROM 'number' AND NOT(k='seats' AND x='null'::jsonb) THEN
        RAISE EXCEPTION 'Cost numbers must be numeric' USING ERRCODE='22023';
      END IF;
      IF x<>'null'::jsonb AND ((x#>>'{}')::numeric<0 OR
        (k='sort' AND (x#>>'{}')::numeric<>trunc((x#>>'{}')::numeric))) THEN
        RAISE EXCEPTION 'Cost numbers are outside the permitted range' USING ERRCODE='22023';
      END IF;
    ELSE
      IF jsonb_typeof(x) IS DISTINCT FROM 'string' AND NOT(k IN ('category','paidWith','match','note') AND x='null'::jsonb) THEN
        RAISE EXCEPTION 'Invalid cost text field' USING ERRCODE='22023';
      END IF;
      x:=coalesce(to_jsonb(nullif(btrim(x#>>'{}'),'')),'null'::jsonb);
      IF k='currency' THEN x:=to_jsonb(upper(x#>>'{}')); END IF;
      IF k IN ('name','category','paidWith','match','note') THEN
        x:=coalesce(to_jsonb(left(x#>>'{}',CASE k WHEN 'name' THEN 120 WHEN 'paidWith' THEN 80 WHEN 'note' THEN 500 ELSE 60 END)),'null'::jsonb);
      END IF;
    END IF;
    vals:=vals||jsonb_build_object(col,x);
  END LOOP;
  row:=jsonb_populate_record(row,vals);
  IF row.name IS NULL OR row.kind IS NULL OR row.billing IS NULL OR row.status IS NULL OR
    row.unit_price IS NULL OR row.currency IS NULL OR row.currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Check the cost name, kind, price, billing and currency' USING ERRCODE='22023';
  END IF;
  IF creating THEN
    INSERT INTO public.cockpit_cost_lines(kind,name,category,billing,seats,unit_price,currency,paid_with,match,status,note,sort,updated_by)
      VALUES(row.kind,row.name,row.category,row.billing,row.seats,row.unit_price,row.currency,row.paid_with,row.match,row.status,row.note,row.sort,who)
      RETURNING * INTO row;
  ELSE
    UPDATE public.cockpit_cost_lines SET kind=row.kind,name=row.name,category=row.category,billing=row.billing,seats=row.seats,
      unit_price=row.unit_price,currency=row.currency,paid_with=row.paid_with,match=row.match,status=row.status,note=row.note,sort=row.sort,
      updated_at=now(),updated_by=who WHERE id=row.id RETURNING * INTO row;
  END IF;
  RETURN jsonb_build_object('ok',true,'line',to_jsonb(row));
END $$;

-- Owner: 20261004b_cockpit_ceo_costs_goals.sql

CREATE OR REPLACE FUNCTION public.cockpit_ceo_costs_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; bank jsonb; today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
BEGIN
  PERFORM public.cockpit_goal_actor();
  -- Do not cap expense rows: a truncated month would look like a complete total.
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.day DESC,b.id DESC),'[]') INTO bank
    FROM public.cockpit_bank_lines b WHERE b.kind='expense' AND b.day>=today-120;
  result := jsonb_build_object(
    'today',today::text,
    'lines',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.kind,l.sort,l.id),'[]') FROM public.cockpit_cost_lines l),
    'people',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.name,p.id),'[]') FROM public.cockpit_people p),
    'plans',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.period_from DESC,p.id DESC),'[]') FROM public.cockpit_goal_plans p),
    'targets',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.sort,t.id),'[]') FROM public.cockpit_goal_targets t),
    'bank',bank);
  RETURN result;
END $$;

-- Owner: 20260926l_cockpit_ceo_goals_access.sql

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

-- Owner: 20260926l_cockpit_ceo_goals_access.sql

CREATE OR REPLACE FUNCTION public.cockpit_goal_working_days(p_from date, p_to date)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH span AS (SELECT greatest(0,p_to-p_from+1) AS n)
  SELECT (n/7)*6 + (SELECT count(*)::integer FROM generate_series(0,n%7-1) d
    WHERE extract(dow FROM p_from+d) <> 5) FROM span;
$$;

-- Owner: 20261004b_cockpit_ceo_costs_goals.sql

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_save_plan_fields(p_plan jsonb)
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

-- Owner: 20261004b_cockpit_ceo_costs_goals.sql

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_save_plan(p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing_id bigint;
BEGIN
  PERFORM public.cockpit_goal_actor();
  IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Plan must be an object' USING ERRCODE='22023'; END IF;
  IF NOT(p_plan ? 'id') AND coalesce(p_plan->>'status','draft')='draft' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit-goal-draft:'||coalesce(p_plan->>'periodFrom','')||':'||coalesce(p_plan->>'periodTo',''),0));
    SELECT id INTO existing_id FROM public.cockpit_goal_plans
      WHERE status='draft' AND period_from=(p_plan->>'periodFrom')::date AND period_to=(p_plan->>'periodTo')::date
      ORDER BY id LIMIT 1 FOR UPDATE;
    IF existing_id IS NOT NULL THEN p_plan:=p_plan||jsonb_build_object('id',existing_id); END IF;
  END IF;
  RETURN public.cockpit_ceo_goal_save_plan_fields(p_plan);
END $$;

-- Owner: 20260926l_cockpit_ceo_goals_access.sql

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

-- Owner: 20260926l_cockpit_ceo_goals_access.sql

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

-- Owner: 20260926l_cockpit_ceo_goals_access.sql

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

-- Owner: 20261004b_cockpit_ceo_costs_goals.sql

CREATE OR REPLACE FUNCTION public.cockpit_cost_write_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE who text;
BEGIN
  SELECT lower(btrim(email)) INTO who FROM auth.users WHERE id=auth.uid();
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
    VALUES(TG_OP,TG_TABLE_NAME,CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END,
      coalesce(who,session_user),'ceo-costs','supabase',
      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

DO $grants$ DECLARE f record; BEGIN FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('cockpit_audit_goal_change','cockpit_ceo_cost_remove','cockpit_ceo_cost_save','cockpit_ceo_costs_context','cockpit_ceo_goal_remove_target','cockpit_ceo_goal_save_plan','cockpit_ceo_goal_save_plan_fields','cockpit_ceo_goal_save_targets','cockpit_ceo_goal_start_from','cockpit_ceo_goals_context','cockpit_cost_write_audit','cockpit_goal_working_days') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.oid::regprocedure||' FROM PUBLIC,anon,authenticated,service_role'; IF f.proname='cockpit_ceo_cost_remove' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO authenticated';END IF; IF f.proname='cockpit_ceo_cost_save' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO authenticated';END IF; IF f.proname='cockpit_ceo_costs_context' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO authenticated';END IF; IF f.proname='cockpit_ceo_goal_remove_target' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO authenticated';END IF; IF f.proname='cockpit_ceo_goal_remove_target' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO service_role';END IF; IF f.proname='cockpit_ceo_goal_save_plan' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO authenticated';END IF; IF f.proname='cockpit_ceo_goal_save_targets' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO authenticated';END IF; IF f.proname='cockpit_ceo_goal_save_targets' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO service_role';END IF; IF f.proname='cockpit_ceo_goal_start_from' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO authenticated';END IF; IF f.proname='cockpit_ceo_goal_start_from' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO service_role';END IF; IF f.proname='cockpit_ceo_goals_context' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO authenticated';END IF; IF f.proname='cockpit_ceo_goals_context' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.oid::regprocedure||' TO service_role';END IF; END LOOP;END $grants$;

DO $installtrigger$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.cockpit_goal_plans'::regclass AND tgname='cockpit_goal_plan_audit') THEN CREATE TRIGGER cockpit_goal_plan_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_goal_plans
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_goal_change(); END IF;END $installtrigger$;

DO $installtrigger$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.cockpit_goal_targets'::regclass AND tgname='cockpit_goal_target_audit') THEN CREATE TRIGGER cockpit_goal_target_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_goal_targets
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_goal_change(); END IF;END $installtrigger$;

DO $installtrigger$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.cockpit_cost_lines'::regclass AND tgname='cockpit_cost_audit') THEN CREATE TRIGGER cockpit_cost_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_cost_lines
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_cost_write_audit(); END IF;END $installtrigger$;

NOTIFY pgrst,'reload schema';

COMMIT;
