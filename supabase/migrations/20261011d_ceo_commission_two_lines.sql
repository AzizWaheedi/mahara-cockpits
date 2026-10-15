-- A074. Two commission lines per person.
--
-- The CEO, 2026-09-20: "you can't just go off of percent commission, because
-- it depends on what they're commissioning on". His setter rule, 2026-09-27:
-- "$500 base $10 per showed qualfiwedd appointment $50 per closed deal (fully
-- closed not onboarding fee then ghosted". One line could not carry that rule,
-- so a person now has a second line with its own basis and rate.
--
-- Two new bases, allowed on either line:
--   per_qualified_intro_shown  a fixed amount per intro that showed and qualified
--   per_closed_deal            a fixed amount per deal that fully closed: a
--                              closer-form deal that is not voided (the CEO's
--                              rule for deals that did not go through)
--
-- Built from the live definitions (pg_get_functiondef on 2026-10-11) of
-- cockpit_ceo_people_save and cockpit_ceo_people_set_pay, which match
-- 20261007c_cockpit_rpc_restore.sql. The CEO gate, the audit trigger
-- (cockpit_people_audit writes to_jsonb(OLD) and to_jsonb(NEW), so line 2 is
-- in every audit row) and the grants stay as they are.
-- cockpit_ceo_people_list and cockpit_ceo_costs_context return to_jsonb(p),
-- so both return line 2 without a change.
--
-- Not applied by the build. The integration step applies it, then sets the
-- setter's pay through cockpit_ceo_people_save (an audit row).

BEGIN;

ALTER TABLE public.cockpit_people ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cockpit_people DROP CONSTRAINT IF EXISTS cockpit_people_commission_basis_check;
ALTER TABLE public.cockpit_people ADD CONSTRAINT cockpit_people_commission_basis_check CHECK (commission_basis = ANY (ARRAY[
  'none','closed_cash','closed_contract','set_cash','set_contract','per_intro_shown','per_demo_shown','per_signed',
  'mrr_managed','other','per_qualified_intro_shown','per_closed_deal']::text[]));

ALTER TABLE public.cockpit_people ADD COLUMN IF NOT EXISTS commission2_basis text NOT NULL DEFAULT 'none';
ALTER TABLE public.cockpit_people ADD COLUMN IF NOT EXISTS commission2_rate numeric;

ALTER TABLE public.cockpit_people DROP CONSTRAINT IF EXISTS cockpit_people_commission2_basis_check;
ALTER TABLE public.cockpit_people ADD CONSTRAINT cockpit_people_commission2_basis_check CHECK (commission2_basis = ANY (ARRAY[
  'none','closed_cash','closed_contract','set_cash','set_contract','per_intro_shown','per_demo_shown','per_signed',
  'mrr_managed','other','per_qualified_intro_shown','per_closed_deal']::text[]));
ALTER TABLE public.cockpit_people DROP CONSTRAINT IF EXISTS cockpit_people_commission2_rate_check;
ALTER TABLE public.cockpit_people ADD CONSTRAINT cockpit_people_commission2_rate_check
  CHECK (commission2_rate IS NULL OR commission2_rate >= 0);

COMMENT ON COLUMN public.cockpit_people.commission2_basis IS
  'The second commission line: what it is paid on. Same bases as commission_basis (A074, CEO 2026-09-20).';
COMMENT ON COLUMN public.cockpit_people.commission2_rate IS
  'The second line''s rate: a share of 0 to 1 for a cash, contract or MRR basis, an amount in the person''s currency for a per-event basis.';

CREATE OR REPLACE FUNCTION public.cockpit_ceo_people_save(p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.cockpit_people; oldrow public.cockpit_people; vals jsonb:='{}';
 k text; x jsonb; col text; actor text; creating boolean; share boolean; share2 boolean;
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
   v.active:=true;v.engagement:='staff';v.currency:='USD';v.is_sales:=false;v.commission_basis:='none';v.commission2_basis:='none';
   v.source:='manual';v.added_by:=actor;
 END IF;
 FOR k,x IN SELECT key,value FROM jsonb_each(p_patch) LOOP
   IF k='id' THEN CONTINUE; END IF;
   col:=CASE k WHEN 'name' THEN 'name' WHEN 'email' THEN 'email' WHEN 'role' THEN 'role'
    WHEN 'engagement' THEN 'engagement' WHEN 'currency' THEN 'currency' WHEN 'note' THEN 'note'
    WHEN 'monthlyCost' THEN 'monthly_cost' WHEN 'commissionPct' THEN 'commission_pct'
    WHEN 'commissionBasis' THEN 'commission_basis' WHEN 'commissionRate' THEN 'commission_rate'
    WHEN 'commission2Basis' THEN 'commission2_basis' WHEN 'commission2Rate' THEN 'commission2_rate'
    WHEN 'commissionNote' THEN 'commission_note' WHEN 'isSales' THEN 'is_sales'
    WHEN 'startedOn' THEN 'started_on' WHEN 'endedOn' THEN 'ended_on' WHEN 'pausedOn' THEN 'paused_on'
    WHEN 'pausedWhy' THEN 'paused_why' WHEN 'schedule' THEN 'schedule' WHEN 'active' THEN 'active' END;
   IF col IS NULL THEN RAISE EXCEPTION 'Unsupported roster field: %',k; END IF;
   IF k IN ('monthlyCost','commissionPct','commissionRate','commission2Rate') THEN
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
     -- A cleared second line is no line, never a NULL basis.
     IF k='commission2Basis' AND x='null'::jsonb THEN x:='"none"'::jsonb; END IF;
   END IF;
   vals:=vals||jsonb_build_object(col,x);
 END LOOP;
 v:=jsonb_populate_record(v,vals);
 IF v.name IS NULL OR btrim(v.name)='' THEN RAISE EXCEPTION 'A person needs a name'; END IF;
 IF creating OR vals ?| ARRAY['commission_pct','commission_basis','commission_rate'] THEN
 IF vals ? 'commission_pct' AND NOT(vals ? 'commission_basis') AND NOT(vals ? 'commission_rate') THEN
   v.commission_basis:=CASE WHEN v.commission_pct IS NULL THEN 'none' ELSE 'closed_cash' END;v.commission_rate:=v.commission_pct;
 ELSIF vals ? 'commission_basis' AND NOT(vals ? 'commission_rate') THEN v.commission_rate:=NULL;
 END IF;
 share:=v.commission_basis IN ('closed_cash','closed_contract','set_cash','set_contract','mrr_managed');
 IF v.commission_basis IN ('none','other') THEN v.commission_rate:=NULL; END IF;
 IF v.commission_rate<0 OR (share AND v.commission_rate>1) THEN RAISE EXCEPTION 'Invalid commission rate'; END IF;
 v.commission_pct:=CASE WHEN share THEN v.commission_rate ELSE NULL END;
 END IF;
 -- Line 2 follows line 1's rules: a new basis without a rate clears the rate,
 -- none and other carry no rate, and a share is between 0 and 1.
 IF creating OR vals ?| ARRAY['commission2_basis','commission2_rate'] THEN
 IF vals ? 'commission2_basis' AND NOT(vals ? 'commission2_rate') THEN v.commission2_rate:=NULL; END IF;
 share2:=v.commission2_basis IN ('closed_cash','closed_contract','set_cash','set_contract','mrr_managed');
 IF v.commission2_basis IN ('none','other') THEN v.commission2_rate:=NULL; END IF;
 IF v.commission2_rate<0 OR (share2 AND v.commission2_rate>1) THEN RAISE EXCEPTION 'Invalid commission rate on the second line'; END IF;
 END IF;
 IF v.commission2_basis NOT IN ('none','other') AND v.commission2_basis=v.commission_basis THEN
   RAISE EXCEPTION 'The second commission line needs a different basis from the first';
 END IF;
 IF v.engagement='bot' THEN v.monthly_cost:=NULL;v.is_sales:=false;v.paused_on:=NULL; END IF;
 IF vals->'active'='true'::jsonb THEN v.ended_on:=NULL; END IF;
 IF creating THEN
   INSERT INTO public.cockpit_people(name,email,role,engagement,active,monthly_cost,currency,commission_basis,commission_rate,commission_pct,
   commission2_basis,commission2_rate,commission_note,is_sales,started_on,ended_on,paused_on,paused_why,note,schedule,source,added_by)
   VALUES(v.name,v.email,v.role,v.engagement,v.active,v.monthly_cost,v.currency,v.commission_basis,v.commission_rate,v.commission_pct,
   v.commission2_basis,v.commission2_rate,v.commission_note,v.is_sales,v.started_on,v.ended_on,v.paused_on,v.paused_why,v.note,v.schedule,'manual',actor)
   RETURNING * INTO v;
 ELSE
   UPDATE public.cockpit_people SET name=v.name,email=v.email,role=v.role,engagement=v.engagement,active=v.active,monthly_cost=v.monthly_cost,
   currency=v.currency,commission_basis=v.commission_basis,commission_rate=v.commission_rate,commission_pct=v.commission_pct,
   commission2_basis=v.commission2_basis,commission2_rate=v.commission2_rate,
   commission_note=v.commission_note,is_sales=v.is_sales,started_on=v.started_on,ended_on=v.ended_on,paused_on=v.paused_on,
   paused_why=v.paused_why,note=v.note,schedule=v.schedule WHERE id=v.id RETURNING * INTO v;
 END IF;
 RETURN jsonb_build_object('ok',true,'id',v.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_people_set_pay(p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE row public.cockpit_people; k text;
BEGIN
  PERFORM public.cockpit_goal_actor();
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR jsonb_typeof(p_patch->'id') IS DISTINCT FROM 'number'
    OR (p_patch->>'id')::numeric<>trunc((p_patch->>'id')::numeric) OR
    (p_patch->>'id')::numeric NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Choose a person to change pay' USING ERRCODE='22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k<>ALL(ARRAY['id','monthlyCost','currency','commissionBasis','commissionRate','commission2Basis','commission2Rate']) THEN
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
  IF p_patch ? 'commission2Basis' AND NOT(p_patch ? 'commission2Rate') THEN
    p_patch:=p_patch||jsonb_build_object('commission2Rate',row.commission2_rate);
  END IF;
  RETURN public.cockpit_ceo_people_save(p_patch);
END $function$;

REVOKE ALL ON FUNCTION public.cockpit_ceo_people_save(jsonb), public.cockpit_ceo_people_set_pay(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_people_save(jsonb), public.cockpit_ceo_people_set_pay(jsonb) TO authenticated;

COMMIT;
