-- Manual payroll roster. This does not provision or revoke cockpit login seats.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_people_schedule_check(p_schedule jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d text; v jsonb; seen text[]:='{}'; day text; item jsonb;
BEGIN
 IF p_schedule IS NULL OR p_schedule='null'::jsonb THEN RETURN; END IF;
 IF jsonb_typeof(p_schedule) IS DISTINCT FROM 'object' OR jsonb_typeof(p_schedule->'week') IS DISTINCT FROM 'object'
 OR (p_schedule->>'timezone' ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$') IS NOT TRUE
 OR jsonb_typeof(p_schedule->'exceptions') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Hours need a timezone, week and exception list'; END IF;
 FOREACH d IN ARRAY ARRAY['mon','tue','wed','thu','fri','sat','sun'] LOOP
   v:=p_schedule->'week'->d;
   IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR jsonb_typeof(v->'on') IS DISTINCT FROM 'boolean'
    OR (v->>'start' ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$') IS NOT TRUE
    OR (v->>'end' ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$') IS NOT TRUE THEN RAISE EXCEPTION 'Invalid daily hours'; END IF;
   IF (v->>'on')::boolean AND v->>'start'>=v->>'end' THEN RAISE EXCEPTION 'Working hours must end after they start'; END IF;
 END LOOP;
 IF jsonb_array_length(p_schedule->'exceptions')>366 THEN RAISE EXCEPTION 'Too many schedule exceptions'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_schedule->'exceptions') LOOP
   day:=item->>'date';
   IF (day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS NOT TRUE OR to_char(day::date,'YYYY-MM-DD')<>day
     OR day=ANY(seen) THEN RAISE EXCEPTION 'Invalid or duplicate exception date'; END IF;
   seen:=array_append(seen,day);
   IF item ? 'off' AND jsonb_typeof(item->'off') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Exception off must be true or false'; END IF;
   IF item->'off' IS DISTINCT FROM 'true'::jsonb THEN
     IF (item->>'start' ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$') IS NOT TRUE
      OR (item->>'end' ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$') IS NOT TRUE
      OR item->>'start'>=item->>'end' THEN RAISE EXCEPTION 'Invalid exception hours'; END IF;
   END IF;
 END LOOP;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ceo_people_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.active DESC,p.name,p.id),'[]'::jsonb) INTO result FROM public.cockpit_people p;
 RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ceo_people_save(p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.cockpit_people; oldrow public.cockpit_people; vals jsonb:='{}';
 k text; x jsonb; col text; actor text; creating boolean; share boolean;
BEGIN
 IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Roster changes must be an object'; END IF;
 SELECT email INTO actor FROM public.cockpit_members WHERE auth_user_id=auth.uid();
 creating:=NOT (p_patch ? 'id');
 IF NOT creating THEN
   IF jsonb_typeof(p_patch->'id') IS DISTINCT FROM 'number' OR (p_patch->>'id')::numeric<>trunc((p_patch->>'id')::numeric)
     OR (p_patch->>'id')::numeric NOT BETWEEN 1 AND 9007199254740991 THEN RAISE EXCEPTION 'Invalid person id'; END IF;
   SELECT * INTO v FROM public.cockpit_people WHERE id=(p_patch->>'id')::bigint FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Nobody on the roster has that id'; END IF;
   oldrow:=v;
 ELSE
   v.active:=true;v.engagement:='staff';v.currency:='USD';v.is_sales:=false;v.commission_basis:='none';v.source:='manual';v.added_by:=actor;
 END IF;
 FOR k,x IN SELECT key,value FROM jsonb_each(p_patch) LOOP
   IF k='id' THEN CONTINUE; END IF;
   col:=CASE k WHEN 'name' THEN 'name' WHEN 'email' THEN 'email' WHEN 'role' THEN 'role'
    WHEN 'engagement' THEN 'engagement' WHEN 'currency' THEN 'currency' WHEN 'note' THEN 'note'
    WHEN 'monthlyCost' THEN 'monthly_cost' WHEN 'commissionPct' THEN 'commission_pct'
    WHEN 'commissionBasis' THEN 'commission_basis' WHEN 'commissionRate' THEN 'commission_rate'
    WHEN 'commissionNote' THEN 'commission_note' WHEN 'isSales' THEN 'is_sales'
    WHEN 'startedOn' THEN 'started_on' WHEN 'endedOn' THEN 'ended_on' WHEN 'pausedOn' THEN 'paused_on'
    WHEN 'pausedWhy' THEN 'paused_why' WHEN 'schedule' THEN 'schedule' WHEN 'active' THEN 'active' END;
   IF col IS NULL THEN RAISE EXCEPTION 'Unsupported roster field: %',k; END IF;
   IF k IN ('monthlyCost','commissionPct','commissionRate') THEN
     IF jsonb_typeof(x) NOT IN ('number','null') THEN RAISE EXCEPTION 'Cost and commission must be numeric or null'; END IF;
     IF x<>'null'::jsonb AND ((x#>>'{}')::numeric<0 OR (k='commissionPct' AND (x#>>'{}')::numeric>1)) THEN
       RAISE EXCEPTION 'Cost and commission are outside the permitted range';
     END IF;
   ELSIF k IN ('active','isSales') THEN
     IF jsonb_typeof(x) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Status must be true or false'; END IF;
   ELSIF k='schedule' THEN PERFORM public.cockpit_people_schedule_check(x);
   ELSE
     IF jsonb_typeof(x) NOT IN ('string','null') THEN RAISE EXCEPTION 'Roster text must be a string or null'; END IF;
     x:=coalesce(to_jsonb(nullif(btrim(x#>>'{}'),'')),'null'::jsonb);
     IF k IN ('startedOn','endedOn','pausedOn') AND x<>'null'::jsonb
       AND ((x#>>'{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS NOT TRUE THEN RAISE EXCEPTION 'Dates must use YYYY-MM-DD'; END IF;
     IF k IN ('note','commissionNote') AND x<>'null'::jsonb THEN x:=to_jsonb(left(x#>>'{}',500)); END IF;
     IF k='pausedWhy' AND x<>'null'::jsonb THEN x:=to_jsonb(left(x#>>'{}',300)); END IF;
     IF k='currency' AND x<>'null'::jsonb THEN x:=to_jsonb(upper(x#>>'{}')); END IF;
   END IF;
   vals:=vals||jsonb_build_object(col,x);
 END LOOP;
 v:=jsonb_populate_record(v,vals);
 IF v.name IS NULL OR btrim(v.name)='' THEN RAISE EXCEPTION 'A person needs a name'; END IF;
 IF vals ? 'commission_pct' AND NOT(vals ? 'commission_basis') AND NOT(vals ? 'commission_rate') THEN
   v.commission_basis:=CASE WHEN v.commission_pct IS NULL THEN 'none' ELSE 'closed_cash' END;v.commission_rate:=v.commission_pct;
 ELSIF vals ? 'commission_basis' AND NOT(vals ? 'commission_rate') THEN v.commission_rate:=NULL;
 END IF;
 share:=v.commission_basis IN ('closed_cash','closed_contract','set_cash','set_contract','mrr_managed');
 IF v.commission_basis IN ('none','other') THEN v.commission_rate:=NULL; END IF;
 IF v.commission_rate<0 OR (share AND v.commission_rate>1) THEN RAISE EXCEPTION 'Invalid commission rate'; END IF;
 v.commission_pct:=CASE WHEN share THEN v.commission_rate ELSE NULL END;
 IF v.engagement='bot' THEN v.monthly_cost:=NULL;v.is_sales:=false;v.paused_on:=NULL; END IF;
 IF vals->'active'='true'::jsonb THEN v.ended_on:=NULL; END IF;
 IF creating THEN
   INSERT INTO public.cockpit_people(name,email,role,engagement,active,monthly_cost,currency,commission_basis,commission_rate,commission_pct,
   commission_note,is_sales,started_on,ended_on,paused_on,paused_why,note,schedule,source,added_by)
   VALUES(v.name,v.email,v.role,v.engagement,v.active,v.monthly_cost,v.currency,v.commission_basis,v.commission_rate,v.commission_pct,
   v.commission_note,v.is_sales,v.started_on,v.ended_on,v.paused_on,v.paused_why,v.note,v.schedule,'manual',actor) RETURNING * INTO v;
 ELSE
   UPDATE public.cockpit_people SET name=v.name,email=v.email,role=v.role,engagement=v.engagement,active=v.active,monthly_cost=v.monthly_cost,
   currency=v.currency,commission_basis=v.commission_basis,commission_rate=v.commission_rate,commission_pct=v.commission_pct,
   commission_note=v.commission_note,is_sales=v.is_sales,started_on=v.started_on,ended_on=v.ended_on,paused_on=v.paused_on,
   paused_why=v.paused_why,note=v.note,schedule=v.schedule WHERE id=v.id RETURNING * INTO v;
 END IF;
 RETURN jsonb_build_object('ok',true,'id',v.id);
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_people_write_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text;
BEGIN
 SELECT m.email INTO actor FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email));
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(CASE WHEN TG_OP='INSERT' THEN 'people.add' ELSE 'people.edit' END,'cockpit_people',NEW.id::text,
 coalesce(actor,'service-role'),'ceo','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cockpit_people_audit ON public.cockpit_people;
CREATE TRIGGER cockpit_people_audit AFTER INSERT OR UPDATE ON public.cockpit_people
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_people_write_audit();
ALTER TABLE public.cockpit_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_people FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.cockpit_people FROM service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_people TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_people_id_seq TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_people_schedule_check(jsonb),public.cockpit_people_write_audit() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_ceo_people_list(),public.cockpit_ceo_people_save(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_people_list(),public.cockpit_ceo_people_save(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
