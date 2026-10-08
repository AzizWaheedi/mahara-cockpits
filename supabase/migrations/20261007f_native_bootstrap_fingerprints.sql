BEGIN;

-- Helper to compute canonical compact SHA256 fingerprints for exactly the 37 bootstrap tables.
-- Stable, Security Definer, search_path empty, service_role only.
CREATE OR REPLACE FUNCTION public.cockpit_native_bootstrap_fingerprints() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 name text;
 r record;
 tables jsonb := '{}';
BEGIN
 FOREACH name IN ARRAY ARRAY[
  'cockpit_media_sources','cockpit_media_source_state','cockpit_csm_sources','cockpit_csm_source_state',
  'cockpit_creative_sources','cockpit_creative_source_state','cockpit_runtime_imports','cockpit_campaigns',
  'cockpit_ads','cockpit_media_daily_stats','cockpit_media_booking_events','cockpit_media_feed_state',
  'cockpit_native_stills','cockpit_native_mirror_owners','cockpit_client_profiles','cockpit_csm_client_overrides',
  'cockpit_offboard_dismissals','cockpit_eod_reports','cockpit_decisions','cockpit_daily_checks',
  'cockpit_issue_reports','cockpit_members','cockpit_plan_items','cockpit_team_status',
  'cockpit_team_status_state','cockpit_metric_days','cockpit_client_billing_days','cockpit_csm_client_preferences',
  'cockpit_csm_hot_rows','cockpit_csm_loose_dismissals','cockpit_csm_money_goals','cockpit_csm_projections',
  'cockpit_csm_renewal_plans','cockpit_media_call_briefs','cockpit_wa_thread_captures','cockpit_wa_draft_history'
 ] LOOP
  IF to_regclass('public.'||name) IS NULL THEN
   RAISE EXCEPTION 'Table public.% is missing from database schema', name;
  END IF;
  EXECUTE format(
   'SELECT count(*)::bigint AS n, encode(pg_catalog.sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb)::text, ''UTF8'')), ''hex'') AS sha256 FROM public.%I t',
   name
  ) INTO r;
  tables := tables || jsonb_build_object(name, jsonb_build_object('n', r.n, 'sha256', r.sha256));
 END LOOP;

 IF to_regclass('public.cockpit_audit_log') IS NULL THEN
  RAISE EXCEPTION 'Table public.cockpit_audit_log is missing from database schema';
 END IF;
 SELECT count(*)::bigint AS n,
  encode(pg_catalog.sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb)::text, 'UTF8')), 'hex') AS sha256
 INTO r
 FROM public.cockpit_audit_log t
 WHERE source_system='convex' AND metadata->>'source_table'='ceoAudit';
 tables := tables || jsonb_build_object('cockpit_audit_log', jsonb_build_object('n', r.n, 'sha256', r.sha256));

 RETURN jsonb_build_object(
  'version', 1,
  'project_ref', 'bldgtotkfmhoxmlzowdx',
  'tables', tables
 );
END $$;

REVOKE ALL ON FUNCTION public.cockpit_native_bootstrap_fingerprints() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_native_bootstrap_fingerprints() TO service_role;

-- Narrow patch to public.cockpit_native_bootstrap_publish via pg_get_functiondef and exact replacement.
-- Patches only the exact inventory computation/comparison lines, adds guarded ALL37 locks,
-- preserving all prior repairs and validation, supporting compact expected_table_fingerprints.
DO $patch$
DECLARE
 def text;
 old_target text;
 new_replacement text;
BEGIN
 SELECT pg_get_functiondef('public.cockpit_native_bootstrap_publish(uuid,uuid,jsonb,text)'::regprocedure) INTO def;
 IF def IS NULL THEN
  RAISE EXCEPTION 'Function public.cockpit_native_bootstrap_publish not found';
 END IF;

 -- Check idempotence: if already patched, exit cleanly.
 IF def LIKE '%cockpit_native_bootstrap_fingerprints()%' THEN
  RETURN;
 END IF;

 old_target := $target$ inventory:=public.cockpit_native_bootstrap_inventory();
 IF inventory->'tables' IS DISTINCT FROM p_plan->'expected_tables' THEN RAISE EXCEPTION 'Bootstrap inventory revision conflict';END IF;$target$;

 new_replacement := $repl$ LOCK TABLE public.cockpit_media_sources,public.cockpit_media_source_state,public.cockpit_csm_sources,public.cockpit_csm_source_state,public.cockpit_creative_sources,public.cockpit_creative_source_state,public.cockpit_runtime_imports,public.cockpit_campaigns,public.cockpit_ads,public.cockpit_media_daily_stats,public.cockpit_media_booking_events,public.cockpit_media_feed_state,public.cockpit_native_stills,public.cockpit_native_mirror_owners,public.cockpit_client_profiles,public.cockpit_csm_client_overrides,public.cockpit_offboard_dismissals,public.cockpit_eod_reports,public.cockpit_decisions,public.cockpit_daily_checks,public.cockpit_issue_reports,public.cockpit_members,public.cockpit_plan_items,public.cockpit_team_status,public.cockpit_team_status_state,public.cockpit_metric_days,public.cockpit_client_billing_days,public.cockpit_csm_client_preferences,public.cockpit_csm_hot_rows,public.cockpit_csm_loose_dismissals,public.cockpit_csm_money_goals,public.cockpit_csm_projections,public.cockpit_csm_renewal_plans,public.cockpit_media_call_briefs,public.cockpit_wa_thread_captures,public.cockpit_wa_draft_history,public.cockpit_audit_log IN SHARE MODE;
 IF (p_plan ? 'expected_tables') AND (p_plan ? 'expected_table_fingerprints') THEN
  RAISE EXCEPTION 'Ambiguous bootstrap inventory: both expected_tables and expected_table_fingerprints provided';
 ELSIF (p_plan ? 'expected_table_fingerprints') THEN
  inventory:=public.cockpit_native_bootstrap_fingerprints();
  IF (p_plan->'expected_table_fingerprints') IS DISTINCT FROM (inventory->'tables') THEN
   RAISE EXCEPTION 'Bootstrap inventory revision conflict';
  END IF;
 ELSIF (p_plan ? 'expected_tables') THEN
  inventory:=public.cockpit_native_bootstrap_inventory();
  IF inventory->'tables' IS DISTINCT FROM p_plan->'expected_tables' THEN RAISE EXCEPTION 'Bootstrap inventory revision conflict';END IF;
 ELSE
  RAISE EXCEPTION 'Bootstrap inventory missing: expected_tables or expected_table_fingerprints required';
 END IF;$repl$;

 -- Git checkouts can preserve CRLF inside stored PL/pgSQL bodies.
 IF position(old_target IN def) = 0 THEN
  old_target := replace(replace(old_target,E'\r\n',E'\n'),E'\n',E'\r\n');
 END IF;
 IF position(old_target IN def) = 0 THEN
  RAISE EXCEPTION 'Guard failure: exact target chunk not found in live cockpit_native_bootstrap_publish definition';
 END IF;
 IF length(def)-length(replace(def,old_target,'')) <> length(old_target) THEN
  RAISE EXCEPTION 'Guard failure: bootstrap target chunk must occur exactly once';
 END IF;

 def := replace(def, old_target, new_replacement);
 EXECUTE def;
END $patch$;

COMMIT;
