-- Native founder-only cost sheet and pay edits. Existing goal writes retain their
-- conservative patches and audit triggers; concurrent same-day drafts deduplicate.
BEGIN;

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

CREATE OR REPLACE FUNCTION public.cockpit_ceo_cost_remove(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.cockpit_goal_actor();
  IF p_id IS NULL OR p_id<=0 THEN RAISE EXCEPTION 'Invalid cost ID' USING ERRCODE='22023'; END IF;
  DELETE FROM public.cockpit_cost_lines WHERE id=p_id;
  RETURN jsonb_build_object('ok',true);
END $$;

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
DROP TRIGGER IF EXISTS cockpit_cost_audit ON public.cockpit_cost_lines;
CREATE TRIGGER cockpit_cost_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_cost_lines
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_cost_write_audit();

CREATE OR REPLACE FUNCTION public.cockpit_ceo_people_set_pay(p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row public.cockpit_people; k text;
BEGIN
  PERFORM public.cockpit_goal_actor();
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR jsonb_typeof(p_patch->'id') IS DISTINCT FROM 'number'
    OR (p_patch->>'id')::numeric<>trunc((p_patch->>'id')::numeric) OR
    (p_patch->>'id')::numeric NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Choose a person to change pay' USING ERRCODE='22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k<>ALL(ARRAY['id','monthlyCost','currency','commissionBasis','commissionRate']) THEN
      RAISE EXCEPTION 'Unsupported pay field: %',k USING ERRCODE='22023';
    END IF;
  END LOOP;
  SELECT * INTO row FROM public.cockpit_people WHERE id=(p_patch->>'id')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nobody on the roster has that id' USING ERRCODE='22023'; END IF;
  IF row.engagement='bot' AND p_patch ? 'monthlyCost' AND p_patch->'monthlyCost'<>'null'::jsonb THEN
    RAISE EXCEPTION 'A bot is never paid' USING ERRCODE='22023';
  END IF;
  IF p_patch ? 'currency' AND (jsonb_typeof(p_patch->'currency') IS DISTINCT FROM 'string' OR
    upper(btrim(p_patch->>'currency')) !~ '^[A-Z]{3}$') THEN
    RAISE EXCEPTION 'A currency is three letters, like USD or KWD' USING ERRCODE='22023';
  END IF;
  -- setPay keeps a rate omitted by the caller; the full roster editor intentionally clears it on a basis change.
  IF p_patch ? 'commissionBasis' AND NOT(p_patch ? 'commissionRate') THEN
    p_patch:=p_patch||jsonb_build_object('commissionRate',row.commission_rate);
  END IF;
  RETURN public.cockpit_ceo_people_save(p_patch);
END $$;

ALTER FUNCTION public.cockpit_ceo_goal_save_plan(jsonb) RENAME TO cockpit_ceo_goal_save_plan_fields;
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

ALTER TABLE public.cockpit_cost_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_cost_lines FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.cockpit_cost_lines TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_ceo_goal_save_plan_fields(jsonb),public.cockpit_cost_write_audit() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_ceo_costs_context(),public.cockpit_ceo_cost_save(jsonb),public.cockpit_ceo_cost_remove(bigint),public.cockpit_ceo_people_set_pay(jsonb),public.cockpit_ceo_goal_save_plan(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_costs_context(),public.cockpit_ceo_cost_save(jsonb),public.cockpit_ceo_cost_remove(bigint),public.cockpit_ceo_people_set_pay(jsonb),public.cockpit_ceo_goal_save_plan(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
