-- Daily backend retention, 2026-10-09 (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- Three ledgers only need recent history, and each grew without a limit:
--  * provider receipt ledgers: two rows per Meta/GHL call, ~100k rows a day.
--    The monitor reads only the latest receipt per provider+resource+phase,
--    which is always kept. Intents keep 1 day, successful responses 3 days,
--    failures and unknown outcomes 30 days.
--  * cockpit_native_media_runs.plan: a ~2 MB plan per 15-minute run (~95 MB a
--    day). Publish retries compare the plan of their own run only, so plans of
--    published runs older than 1 day and outside the newest 10 are cleared.
--    plan_sha, receipt, status and times stay. Bootstrapped runs are untouched.
--  * cron.job_run_details: pg_cron history, kept 14 days.
-- Out of scope by agreement with the Convex-sweep session: cockpit_sync_state,
-- cockpit_hiring_*, cockpit_client_onboarding_runs, eod_outbox.
--
-- cockpit_backend_retention(false) is a dry run and only counts.
-- cockpit_backend_retention(true) deletes and writes one audit row.

CREATE OR REPLACE FUNCTION public.cockpit_backend_retention(p_apply boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
 result jsonb := jsonb_build_object('mode',CASE WHEN p_apply THEN 'apply' ELSE 'dry_run' END,'at',now());
 tbl text; n bigint; doomed_sql text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['cockpit_media_provider_health','cockpit_ceo_provider_health','cockpit_csm_provider_health'] LOOP
  IF to_regclass('public.'||tbl) IS NULL THEN CONTINUE; END IF;
  doomed_sql := format($q$
   WITH latest AS (
    SELECT DISTINCT ON (provider,resource,phase) id FROM public.%1$I
    WHERE phase<>'intent' ORDER BY provider,resource,phase,created_at DESC,id DESC),
   doomed AS (
    SELECT t.id FROM public.%1$I t
    WHERE t.created_at < now() - CASE
       WHEN t.phase='intent' THEN interval '1 day'
       WHEN t.phase='response' AND t.http_status BETWEEN 100 AND 399 THEN interval '3 days'
       ELSE interval '30 days' END
     AND NOT EXISTS (SELECT 1 FROM latest l WHERE l.id=t.id))$q$, tbl);
  IF p_apply THEN
   EXECUTE doomed_sql||format(' DELETE FROM public.%I d USING doomed WHERE d.id=doomed.id', tbl);
   GET DIAGNOSTICS n = ROW_COUNT;
  ELSE
   EXECUTE doomed_sql||' SELECT count(*) FROM doomed' INTO n;
  END IF;
  result := result || jsonb_build_object(tbl, n);
 END LOOP;

 IF p_apply THEN
  UPDATE public.cockpit_native_media_runs r SET plan=NULL
  WHERE r.status='published' AND r.plan IS NOT NULL AND r.published_at < now()-interval '1 day'
   AND r.run_id NOT IN (SELECT x.run_id FROM public.cockpit_native_media_runs x
     WHERE x.status='published' ORDER BY x.published_at DESC NULLS LAST LIMIT 10);
  GET DIAGNOSTICS n = ROW_COUNT;
 ELSE
  SELECT count(*) INTO n FROM public.cockpit_native_media_runs r
  WHERE r.status='published' AND r.plan IS NOT NULL AND r.published_at < now()-interval '1 day'
   AND r.run_id NOT IN (SELECT x.run_id FROM public.cockpit_native_media_runs x
     WHERE x.status='published' ORDER BY x.published_at DESC NULLS LAST LIMIT 10);
 END IF;
 result := result || jsonb_build_object('cockpit_native_media_runs.plan', n);

 IF p_apply THEN
  DELETE FROM cron.job_run_details WHERE end_time < now()-interval '14 days';
  GET DIAGNOSTICS n = ROW_COUNT;
 ELSE
  SELECT count(*) INTO n FROM cron.job_run_details WHERE end_time < now()-interval '14 days';
 END IF;
 result := result || jsonb_build_object('cron.job_run_details', n);

 IF p_apply THEN
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after)
  VALUES('retention.applied','cockpit_backend_retention',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),
   'backend-retention','media-buyer','supabase',result);
 END IF;
 RETURN result;
END $function$;

REVOKE ALL ON FUNCTION public.cockpit_backend_retention(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_backend_retention(boolean) TO service_role;
