-- Native run plans: keep only the newest 10, 2026-10-13 (Creative Triage
-- bldgtotkfmhoxmlzowdx). Approved by Muhammed the same day.
--
-- Since 12 Oct each media-core publish stores a 1.9 MB plan (5.8 MB of JSON)
-- about 70 times a day. 20261009q cleared plans older than 1 day outside the
-- newest 10, so up to ~48 hours (~300 MB) stayed on a 2 GB instance that
-- restarted twice (12 Oct 12:40 and 13 Oct 10:16 UTC; see 20261013b).
-- Readers checked live on 2026-10-13: the publish compares its own claimed
-- run only; cockpit_calendar_overview reads the newest published plan;
-- cockpit_native_stills_read needs one published plan with adStills; the
-- worker and guardian read status and times. None needs older plans.
-- So plans of published runs outside the newest 10 are cleared at once.
-- plan_sha, receipt, status and times stay. Bootstrapped runs are untouched.
-- Everything else in the function is unchanged from the live body.

CREATE OR REPLACE FUNCTION public.cockpit_backend_retention(p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  WHERE r.status='published' AND r.plan IS NOT NULL
   AND r.run_id NOT IN (SELECT x.run_id FROM public.cockpit_native_media_runs x
     WHERE x.status='published' ORDER BY x.published_at DESC NULLS LAST LIMIT 10);
  GET DIAGNOSTICS n = ROW_COUNT;
 ELSE
  SELECT count(*) INTO n FROM public.cockpit_native_media_runs r
  WHERE r.status='published' AND r.plan IS NOT NULL
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

-- One-off: clear the plans the new rule covers now instead of at 01:17 UTC,
-- without running the provider-ledger deletes early. One audit row records it.
WITH cleared AS (
 UPDATE public.cockpit_native_media_runs r SET plan=NULL
 WHERE r.status='published' AND r.plan IS NOT NULL
  AND r.run_id NOT IN (SELECT x.run_id FROM public.cockpit_native_media_runs x
    WHERE x.status='published' ORDER BY x.published_at DESC NULLS LAST LIMIT 10)
 RETURNING r.run_id)
INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after)
SELECT 'retention.applied','cockpit_backend_retention','2026-10-13-plans-newest-10',
 'backend-retention','media-buyer','supabase',
 jsonb_build_object('mode','apply','at',now(),'rule','newest 10 published plans','cockpit_native_media_runs.plan',count(*))
FROM cleared;
