-- Migration: 20261007c_cockpit_rpc_restore.sql
-- Description: Restore 14 missing application RPCs, supporting helpers, triggers, and absent tables.
-- Sources:
--   - 20260926k_cockpit_webinar_target_access.sql (cockpit_resolve_webinar_scope, cockpit_ceo_webinar_target_context, cockpit_ceo_save_webinar_targets)
--   - 20260927c_cockpit_people_access.sql (cockpit_people_schedule_check, cockpit_ceo_people_list, cockpit_ceo_people_save)
--   - 20261004b_cockpit_ceo_costs_goals.sql (cockpit_ceo_people_set_pay)
--   - 20260926l_cockpit_ceo_goals_access.sql (cockpit_goal_actor)
--   - 20261004e_cockpit_ceo_providers.sql (newer cockpit_people_write_audit and cockpit_people_audit trigger)
--   - 20260927i_cockpit_creative_actions.sql (cockpit_creative_actor, cockpit_review_client, cockpit_review_create, cockpit_review_import_folder, cockpit_review_import_status, cockpit_review_clients, cockpit_review_list, cockpit_creative_requests_list, cockpit_creative_request_review, legacy revocation)
--   - 20260927i_cockpit_finance_refresh.sql (cockpit_finance_refreshes table + cockpit_finance_refresh_status)
--   - 20260927r_cockpit_campaign_builds.sql (cockpit_campaign_drafts table, cockpit_build_scope, cockpit_build_action, cockpit_build_audit, trigger)
-- Historical data backfill remains deferred. No business DML included.

BEGIN;

-- ============================================================================
-- 1. Helper & Webinar RPCs (from 20260926k_cockpit_webinar_target_access.sql)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cockpit_resolve_webinar_scope(p_scope text)
RETURNS table(valid boolean, is_round boolean, round_key text, started_at bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payload jsonb;
  v_round jsonb;
  v_found boolean := false;
  v_first_reg bigint;
  v_spend_from text;
  v_spend_from_epoch bigint;
  v_started_at bigint := null;
  v_key text;
BEGIN
  IF p_scope IS NULL THEN
    RETURN QUERY SELECT false, false, null::text, null::bigint;
    RETURN;
  END IF;

  IF p_scope = 'defaults' THEN
    RETURN QUERY SELECT true, false, null::text, null::bigint;
    RETURN;
  END IF;

  IF p_scope LIKE 'round:%' AND length(p_scope) BETWEEN 7 AND 200 THEN
    v_key := substring(p_scope FROM 7);

    -- Reject next, untagged, or empty
    IF v_key IN ('next', 'untagged', '') THEN
      RETURN QUERY SELECT false, false, null::text, null::bigint;
      RETURN;
    END IF;

    -- Look up round in cockpit_sections where key = 'webinar'
    SELECT payload INTO v_payload
    FROM public.cockpit_sections
    WHERE key = 'webinar'
    LIMIT 1;

    IF v_payload IS NOT NULL AND jsonb_typeof(v_payload->'rounds') = 'array' THEN
      FOR v_round IN SELECT jsonb_array_elements(v_payload->'rounds') LOOP
        IF v_round->>'key' = v_key THEN
          v_found := true;

          -- Calculate roundTargetStart:
          -- earliest positive registration.firstRegisteredAt and spendFrom at Kuwait midnight (UTC+3)
          v_first_reg := null;
          IF jsonb_typeof(v_round->'registration'->'firstRegisteredAt') = 'number' THEN
            v_first_reg := (v_round->'registration'->>'firstRegisteredAt')::bigint;
            IF v_first_reg <= 0 THEN
              v_first_reg := null;
            END IF;
          END IF;

          v_spend_from := v_round->>'spendFrom';
          v_spend_from_epoch := null;
          IF v_spend_from IS NOT NULL AND v_spend_from ~ '^\d{4}-\d{2}-\d{2}$' THEN
            BEGIN
              -- Kuwait midnight is UTC+03:00. Extract epoch in milliseconds.
              v_spend_from_epoch := (extract(epoch FROM (v_spend_from || ' 00:00:00+03')::timestamptz) * 1000)::bigint;
              IF v_spend_from_epoch <= 0 THEN
                v_spend_from_epoch := null;
              END IF;
            EXCEPTION WHEN others THEN
              v_spend_from_epoch := null;
            END;
          END IF;

          IF v_first_reg IS NOT NULL AND v_spend_from_epoch IS NOT NULL THEN
            v_started_at := least(v_first_reg, v_spend_from_epoch);
          ELSIF v_first_reg IS NOT NULL THEN
            v_started_at := v_first_reg;
          ELSIF v_spend_from_epoch IS NOT NULL THEN
            v_started_at := v_spend_from_epoch;
          ELSE
            v_started_at := null;
          END IF;

          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_found THEN
      RETURN QUERY SELECT true, true, v_key, v_started_at;
      RETURN;
    ELSE
      RETURN QUERY SELECT false, true, v_key, null::bigint;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT false, false, null::text, null::bigint;
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_resolve_webinar_scope(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_resolve_webinar_scope(text) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_webinar_target_context(p_scope text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_valid boolean;
  v_is_round boolean;
  v_round_key text;
  v_started_at bigint;
  v_own jsonb;
  v_inherited jsonb := '[]'::jsonb;
BEGIN
  -- Enforce server-side CEO check
  IF public.cockpit_is_ceo() IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: CEO access required' USING errcode = '42501';
  END IF;

  -- Validate scope
  SELECT valid, is_round, round_key, started_at
  INTO v_valid, v_is_round, v_round_key, v_started_at
  FROM public.cockpit_resolve_webinar_scope(p_scope);

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid or unrecognized webinar scope: %', p_scope;
  END IF;

  -- Fetch newest 10 versions for own scope
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.revision DESC), '[]'::jsonb)
  INTO v_own
  FROM (
    SELECT scope_key, revision, values, changed_at, changed_by
    FROM public.cockpit_webinar_target_versions
    WHERE scope_key = p_scope
    ORDER BY revision DESC
    LIMIT 10
  ) t;

  -- If round scope, fetch newest defaults version at or before startedAt for round inheritance
  IF v_is_round THEN
    IF v_started_at IS NOT NULL THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      INTO v_inherited
      FROM (
        SELECT scope_key, revision, values, changed_at, changed_by
        FROM public.cockpit_webinar_target_versions
        WHERE scope_key = 'defaults'
          AND extract(epoch FROM changed_at) * 1000 <= v_started_at
        ORDER BY revision DESC
        LIMIT 1
      ) t;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'scope', p_scope,
    'startedAt', v_started_at,
    'own', v_own,
    'inherited', v_inherited
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_ceo_webinar_target_context(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_webinar_target_context(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_save_webinar_targets(
  p_scope text,
  p_expected_revision integer,
  p_values jsonb,
  p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_valid boolean;
  v_is_round boolean;
  v_round_key text;
  v_started_at bigint;
  v_actor_email text;
  v_uid uuid;
  v_save_result jsonb;
  v_version jsonb;
  v_status text;
  v_rev integer;
BEGIN
  -- Enforce server-side CEO check
  IF public.cockpit_is_ceo() IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: CEO access required' USING errcode = '42501';
  END IF;

  -- Derive actor email from auth.users with auth.uid()
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active auth session' USING errcode = '42501';
  END IF;

  SELECT lower(btrim(email)) INTO v_actor_email
  FROM auth.users
  WHERE id = v_uid;

  IF v_actor_email IS NULL OR length(btrim(v_actor_email)) = 0 THEN
    RAISE EXCEPTION 'Actor email could not be resolved from auth session';
  END IF;

  -- Validate scope
  SELECT valid, is_round, round_key, started_at
  INTO v_valid, v_is_round, v_round_key, v_started_at
  FROM public.cockpit_resolve_webinar_scope(p_scope);

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid or unrecognized webinar scope: %', p_scope;
  END IF;

  -- Call the existing service-only function public.cockpit_save_webinar_targets
  v_save_result := public.cockpit_save_webinar_targets(
    p_scope,
    p_expected_revision,
    p_values,
    v_actor_email,
    p_request_id
  );

  v_status := v_save_result->>'status';

  IF v_status = 'conflict' THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'startedAt', v_started_at
    );
  END IF;

  IF v_status = 'saved' THEN
    v_version := v_save_result->'version';
    v_rev := (v_version->>'revision')::integer;

    RETURN jsonb_build_object(
      'status', 'saved',
      'version', v_version,
      'startedAt', v_started_at
    );
  END IF;

  RETURN v_save_result;
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_ceo_save_webinar_targets(text, integer, jsonb, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_save_webinar_targets(text, integer, jsonb, uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. People & Schedule RPCs (from 20260927c_cockpit_people_access.sql)
-- ============================================================================

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

REVOKE ALL ON FUNCTION public.cockpit_people_schedule_check(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_people_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.active DESC,p.name,p.id),'[]'::jsonb) INTO result FROM public.cockpit_people p;
 RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_ceo_people_list() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_people_list() TO authenticated;

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

REVOKE ALL ON FUNCTION public.cockpit_ceo_people_save(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_people_save(jsonb) TO authenticated;


-- ============================================================================
-- 3. Goal Actor Helper (from 20260926l_cockpit_ceo_goals_access.sql)
-- ============================================================================

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

REVOKE ALL ON FUNCTION public.cockpit_goal_actor() FROM PUBLIC,anon,authenticated,service_role;


-- ============================================================================
-- 4. People Pay RPC (from 20261004b_cockpit_ceo_costs_goals.sql)
-- ============================================================================

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

REVOKE ALL ON FUNCTION public.cockpit_ceo_people_set_pay(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_people_set_pay(jsonb) TO authenticated;


-- ============================================================================
-- 5. Newer People Audit & Trigger (from 20261004e_cockpit_ceo_providers.sql)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cockpit_people_write_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text;
BEGIN
  actor:=nullif(current_setting('cockpit.ceo_actor_email',true),'');
  IF actor IS NULL THEN
    SELECT m.email INTO actor FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
    WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email));
  END IF;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
  VALUES(CASE WHEN TG_OP='INSERT' THEN 'people.add' ELSE 'people.edit' END,'cockpit_people',NEW.id::text,
    coalesce(actor,'service-role'),'ceo','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_people_write_audit() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cockpit_people_audit ON public.cockpit_people;
CREATE TRIGGER cockpit_people_audit AFTER INSERT OR UPDATE ON public.cockpit_people
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_people_write_audit();


-- ============================================================================
-- 6. Creative Actions RPCs & Legacy Revocations (from 20260927i_cockpit_creative_actions.sql)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cockpit_creative_actor()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE email text;
BEGIN
 IF NOT (public.cockpit_has_role('creative') OR public.cockpit_has_role('csm') OR public.cockpit_has_role('editor') OR public.cockpit_has_role('media_buyer') OR public.cockpit_is_ceo()) THEN
  RAISE EXCEPTION 'Active creative access required' USING ERRCODE='42501';
 END IF;
 SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=auth.uid();
 RETURN email;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_creative_actor() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_review_client(p_name text,p_task text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE name text;
BEGIN
 PERFORM public.cockpit_creative_actor();
 IF nullif(btrim(p_task),'') IS NOT NULL THEN
  SELECT c.name INTO name FROM public.editor_clients c WHERE c.task_id=p_task;
  IF name IS NULL OR (nullif(btrim(p_name),'') IS NOT NULL AND lower(btrim(p_name))<>lower(btrim(name))) THEN
   RAISE EXCEPTION 'Review client does not match the selected client';
  END IF;
 ELSE name:=nullif(btrim(p_name),''); END IF;
 IF name IS NULL OR NOT public.cockpit_client_allowed(name) THEN
  RAISE EXCEPTION 'Choose an assigned client for this review' USING ERRCODE='42501';
 END IF;
 RETURN name;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_review_client(text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_review_create(p_title text,p_note text,p_client text,p_client_task_id text,p_by text,p_items jsonb,p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text:=public.cockpit_creative_actor(); name text; result jsonb;
BEGIN
 name:=public.cockpit_review_client(p_client,p_client_task_id);
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Add between 1 and 100 review items'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE coalesce(x->>'video_url','') !~* '^https?://[^ /]+') THEN RAISE EXCEPTION 'Every review item needs a valid link'; END IF;
 result:=public.review_create(p_title,p_note,name,p_client_task_id,email,p_items,p_days);
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,after)
 VALUES('create','review',result->>'token',email,'creative',jsonb_build_object('client',name,'items',result->'items'));
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_review_create(text,text,text,text,text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_review_create(text,text,text,text,text,jsonb,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_review_import_folder(p_folder text,p_title text,p_note text,p_client text,p_client_task_id text,p_by text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text:=public.cockpit_creative_actor(); name text; result jsonb;
BEGIN
 name:=public.cockpit_review_client(p_client,p_client_task_id);
 IF p_folder IS NULL OR p_folder !~ '^(https://drive\.google\.com/(drive/)?folders/[A-Za-z0-9_-]+([?].*)?|[A-Za-z0-9_-]{20,})$' THEN RAISE EXCEPTION 'Paste the Google Drive folder link'; END IF;
 result:=public.review_import_folder(p_folder,p_title,p_note,name,p_client_task_id,email);
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,after)
 VALUES('queue_import','review',result->>'id',email,'creative',jsonb_build_object('client',name));
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_review_import_folder(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_review_import_folder(text,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_review_import_status(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_creative_actor();
 IF NOT EXISTS(SELECT 1 FROM public.review_imports r WHERE r.id=p_id AND public.cockpit_client_allowed(r.client_name)) THEN RETURN NULL; END IF;
 RETURN public.review_import_status(p_id);
END $$;

REVOKE ALL ON FUNCTION public.cockpit_review_import_status(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_review_import_status(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_review_clients()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cockpit_creative_actor();
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'),'[]') INTO result FROM jsonb_array_elements(public.review_clients()) x WHERE public.cockpit_client_allowed(x->>'name');
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_review_clients() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_review_clients() TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_review_list(p_limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cockpit_creative_actor();
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC),'[]') INTO result FROM (
  SELECT l.token,l.title,l.client_name,l.created_at,l.sent_at,l.opened_at,l.revoked,
   (SELECT count(*) FROM public.review_items i WHERE i.token=l.token) AS items,
   (SELECT count(*) FROM public.review_items i WHERE i.token=l.token AND i.decision IS NOT NULL) AS decided,
   (SELECT count(*) FROM public.review_items i WHERE i.token=l.token AND i.decision='changes') AS changes
  FROM public.review_links l WHERE public.cockpit_client_allowed(l.client_name)
  ORDER BY l.created_at DESC LIMIT greatest(1,least(100,p_limit))
 ) x;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_review_list(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_review_list(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_creative_requests_list(p_campaign text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cockpit_creative_actor();
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC),'[]') INTO result FROM (
  SELECT r.* FROM public.cockpit_creative_requests r
  WHERE public.cockpit_client_allowed(r.client_name) AND (p_campaign IS NULL OR r.campaign_name=p_campaign)
  ORDER BY r.created_at DESC LIMIT 100
 ) x;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_creative_requests_list(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_creative_requests_list(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_creative_request_review(p_id uuid,p_campaign text,p_verdict text,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text:=public.cockpit_creative_actor(); r public.cockpit_creative_requests;
BEGIN
 IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Media buyer access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.cockpit_creative_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.campaign_name<>p_campaign OR NOT public.cockpit_client_allowed(r.client_name) THEN RAISE EXCEPTION 'Creative request not found' USING ERRCODE='42501'; END IF;
 IF p_verdict IS NULL OR p_verdict NOT IN ('worked','needs_another_version','stop') THEN RAISE EXCEPTION 'Choose a valid assessment'; END IF;
 IF r.launched_meta_ad_id IS NULL OR r.launched_at IS NULL THEN RAISE EXCEPTION 'Link a launched ad before reviewing this request'; END IF;
 IF (now() AT TIME ZONE 'Asia/Kuwait')::date <= (r.launched_at AT TIME ZONE 'Asia/Kuwait')::date+3 THEN RAISE EXCEPTION 'Wait for three complete days after the launch before reviewing it'; END IF;
 IF r.verdict IS NOT NULL THEN
  IF r.verdict<>p_verdict OR r.verdict_note IS DISTINCT FROM nullif(left(btrim(p_note),500),'') THEN RAISE EXCEPTION 'This request has already been reviewed'; END IF;
  RETURN to_jsonb(r);
 END IF;
 UPDATE public.cockpit_creative_requests SET status='reviewed',verdict=p_verdict,verdict_note=nullif(left(btrim(p_note),500),''),reviewed_by=email,reviewed_at=now(),last_actor=email,updated_at=now(),
 feedback_error=CASE WHEN feedback_posted_at IS NULL THEN 'Assessment saved. Feedback has not been confirmed yet.' ELSE feedback_error END
 WHERE id=p_id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

REVOKE ALL ON FUNCTION public.cockpit_creative_request_review(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_creative_request_review(uuid,text,text,text) TO authenticated;

-- Revocation of unsafe legacy entry points exactly as canonical wrapper migration specifies:
REVOKE EXECUTE ON FUNCTION public.review_create(text,text,text,text,text,jsonb,integer),public.review_import_folder(text,text,text,text,text,text),public.review_import_status(bigint),public.review_clients(),public.review_list(integer),public.review_status(text),public.review_revoke(text) FROM PUBLIC,anon,authenticated;


-- ============================================================================
-- 7. Finance Refresh Status & Job Table (from 20260927i_cockpit_finance_refresh.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cockpit_finance_refreshes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,actor_email text NOT NULL,revision bigint NOT NULL,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','confirmed','failed')),
 error text,result jsonb,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);

ALTER TABLE public.cockpit_finance_refreshes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_finance_refreshes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cockpit_finance_refreshes TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_finance_refresh_status(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job cockpit_finance_refreshes;
BEGIN
 IF NOT cockpit_is_ceo() THEN RAISE EXCEPTION 'Founder access required'; END IF;
 SELECT * INTO job FROM cockpit_finance_refreshes WHERE id=p_id;
 IF job.id IS NULL THEN RAISE EXCEPTION 'Finance refresh not found'; END IF;
 RETURN jsonb_build_object('id',job.id,'status',CASE WHEN job.status='running' AND job.created_at<now()-interval '5 minutes' THEN 'failed' ELSE job.status END,'error',CASE WHEN job.status='running' AND job.created_at<now()-interval '5 minutes' THEN 'Refresh exceeded its time limit; start a fresh read' ELSE job.error END,'result',job.result);
END $$;

REVOKE ALL ON FUNCTION public.cockpit_finance_refresh_status(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_finance_refresh_status(uuid) TO authenticated;


-- ============================================================================
-- 8. Campaign Builds (from 20260927r_cockpit_campaign_builds.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cockpit_campaign_drafts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id text UNIQUE,client_tag text NOT NULL,client_name text NOT NULL,account_id text NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),status text NOT NULL DEFAULT 'building' CHECK(status IN('building','ready','failed','launching','launched','discarded')),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cockpit_campaign_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_campaign_drafts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_campaign_drafts TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_build_scope(p_tag text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cockpit_campaigns; n int;
BEGIN
 IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Media buyer access required' USING ERRCODE='42501'; END IF;
 SELECT count(DISTINCT regexp_replace(meta_account_id,'^act_','')) INTO n FROM public.cockpit_campaigns cr WHERE raw_data->>'clientTag'=p_tag AND nullif(meta_account_id,'') IS NOT NULL AND coalesce((to_jsonb(cr)->>'source_deleted')::boolean,false)=false;
 IF n<>1 THEN RAISE EXCEPTION 'The client ad account is missing or ambiguous. Refresh its mapping first'; END IF;
 SELECT cr.* INTO c FROM public.cockpit_campaigns cr WHERE raw_data->>'clientTag'=p_tag AND nullif(meta_account_id,'') IS NOT NULL AND coalesce((to_jsonb(cr)->>'source_deleted')::boolean,false)=false
 ORDER BY CASE WHEN (raw_data->>'leads7d')::numeric>0 THEN (raw_data->>'cpl')::numeric END ASC NULLS LAST, id LIMIT 1;
 IF NOT public.cockpit_client_allowed(c.client_name) THEN RAISE EXCEPTION 'Client is outside your assignments' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('actor',auth.uid(),'client',c.client_name,'clientTag',p_tag,'account',regexp_replace(c.meta_account_id,'^act_',''),'campaign',c.meta_campaign_id,'campaignName',c.raw_data->>'campaignName','source',c.raw_data);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_build_action(p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_campaign_drafts;scope jsonb; result jsonb;variants jsonb:=p_args->'variants';
BEGIN
 IF p_operation='list' THEN
  scope:=public.cockpit_build_scope(p_args->>'clientTag');
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'at')::numeric DESC),'[]') INTO result FROM(
   SELECT data||jsonb_build_object('_id',id,'clientTag',client_tag,'clientName',client_name,'accountId',account_id,'status',status,'by',created_by,'at',extract(epoch FROM created_at)*1000) x FROM public.cockpit_campaign_drafts WHERE client_tag=p_args->>'clientTag' AND status<>'discarded'
  ) rows;RETURN result;
 END IF;
 SELECT * INTO r FROM public.cockpit_campaign_drafts WHERE id=(p_args->>'id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Campaign draft not found'; END IF;
 scope:=public.cockpit_build_scope(r.client_tag);
 IF scope->>'account'<>r.account_id OR scope->>'client'<>r.client_name THEN RAISE EXCEPTION 'Client mapping changed. Reconcile this draft first'; END IF;
 IF p_operation='get' THEN RETURN r.data||jsonb_build_object('_id',r.id,'_version',r.updated_at,'clientTag',r.client_tag,'clientName',r.client_name,'accountId',r.account_id,'status',r.status); END IF;
 IF r.status<>'ready' THEN RAISE EXCEPTION 'Only a ready draft can be edited or discarded'; END IF;
 IF p_operation='saveVariants' THEN
  IF jsonb_typeof(variants) IS DISTINCT FROM 'array' OR jsonb_array_length(variants) NOT BETWEEN 1 AND 5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(variants) v WHERE jsonb_typeof(v) IS DISTINCT FROM 'object' OR jsonb_typeof(v->'headline') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'primaryText') IS DISTINCT FROM 'string' OR length(v->>'headline')>120 OR length(v->>'primaryText')>1200 OR length(coalesce(v->>'description',''))>300) THEN RAISE EXCEPTION 'Provide one to five valid copy variants'; END IF;
  UPDATE public.cockpit_campaign_drafts SET data=data||jsonb_build_object('variants',variants),updated_at=now() WHERE id=r.id AND data->'variants' IS DISTINCT FROM variants;
 ELSIF p_operation='discard' THEN UPDATE public.cockpit_campaign_drafts SET status='discarded',updated_at=now() WHERE id=r.id;
 ELSE RAISE EXCEPTION 'Unknown campaign draft operation'; END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_build_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text;
BEGIN
 SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=auth.uid();
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,before,after) VALUES(lower(TG_OP),'campaign_draft',NEW.id::text,coalesce(email,NEW.created_by),'media_buyer',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cockpit_campaign_draft_audit ON public.cockpit_campaign_drafts;
CREATE TRIGGER cockpit_campaign_draft_audit AFTER INSERT OR UPDATE ON public.cockpit_campaign_drafts FOR EACH ROW EXECUTE FUNCTION public.cockpit_build_audit();

REVOKE ALL ON FUNCTION public.cockpit_build_scope(text),public.cockpit_build_action(text,jsonb),public.cockpit_build_audit() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_build_scope(text),public.cockpit_build_action(text,jsonb) TO authenticated;

-- ============================================================================
-- 9. Reload PostgREST Schema Cache & Commit
-- ============================================================================

NOTIFY pgrst, 'reload schema';

COMMIT;
