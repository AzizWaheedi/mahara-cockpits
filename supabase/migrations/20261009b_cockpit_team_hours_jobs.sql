-- Hours, leave and pay: the two scheduled reads (pg_cron + pg_net + vault)
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Apply after 20261009a and after
-- cockpit-hours-sync is deployed with the JWT check OFF. Safe to apply twice:
-- each job is unscheduled by name before it is scheduled again.
--
-- cockpit_hours_kick(mode) posts {"mode": ...} to cockpit-hours-sync with the
-- shared cron secret (vault cockpit_sync_secret, the same value as the
-- function secret CRON_SECRET) and an explicit 5-second timeout. The function
-- answers 202 at once and reads in the background. Without the vault secret
-- nothing is posted and cockpit_sync_state row 'hours-kick' says so.
--
--   mahara-hours-sync  every hour at :17         recent
--   mahara-hours-deep  23:40 UTC (02:40 Kuwait)  deep (Saturdays re-read back 175 days, Hubstaff's limit)

BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_hours_kick(p_mode text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-hours-sync';
  v_secret text;
  v_request bigint;
BEGIN
  IF p_mode NOT IN ('recent','deep') THEN RAISE EXCEPTION 'The scheduled read is recent or deep' USING ERRCODE='22023'; END IF;
  SELECT ds.decrypted_secret INTO v_secret FROM vault.decrypted_secrets ds WHERE ds.name='cockpit_sync_secret' LIMIT 1;
  IF v_secret IS NULL OR btrim(v_secret)='' THEN
    INSERT INTO public.cockpit_sync_state(key,last_run_at,ok,note,updated_at)
    VALUES('hours-kick',now(),false,'The vault has no cockpit_sync_secret, so the hours read was not started. Add it to the vault.',now())
    ON CONFLICT (key) DO UPDATE SET last_run_at=now(),ok=false,note=EXCLUDED.note,updated_at=now();
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object('mode', p_mode),
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
    timeout_milliseconds := 5000) INTO v_request;
  INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note,updated_at)
  VALUES('hours-kick',now(),now(),true,format('Posted a %s read', p_mode),now())
  ON CONFLICT (key) DO UPDATE SET last_run_at=now(),last_ok_at=now(),ok=true,note=EXCLUDED.note,updated_at=now();
  RETURN v_request;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_hours_kick(text) FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname='mahara-hours-sync';
SELECT cron.schedule('mahara-hours-sync','17 * * * *',$job$SELECT public.cockpit_hours_kick('recent');$job$);

SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname='mahara-hours-deep';
SELECT cron.schedule('mahara-hours-deep','40 23 * * *',$job$SELECT public.cockpit_hours_kick('deep');$job$);

NOTIFY pgrst, 'reload schema';

COMMIT;
