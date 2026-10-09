-- The scheduled onboarding sync, native (2026-10-09).
--
-- The Convex cron "onboarding links and forms" (client success,
-- onboarding.syncAll, every 10 minutes) read every card on Clients - Mahara
-- and the onboarding Typeforms into cockpit_client_onboarding. It stopped
-- with the Convex pause on 2026-10-07 22:38 UTC. The native Refresh
-- (cockpit-csm-api onboarding.refresh) reads only the one card a CSM presses,
-- so the Onboarding Kit no longer updates by itself. The Edge Function
-- supabase/functions/onboarding-sync replaces the cron; this migration gives
-- it two service-role-only RPCs and its pg_cron schedule.
--
-- a) cockpit_csm_onboarding_cron_begin(): one scheduled run at a time. It
--    closes a 'cron' run that has been open for over 5 minutes (the function
--    stops well before that, so the run died), answers busy while another
--    one is open, then opens a 'cron' row in cockpit_client_onboarding_runs
--    and says which ClickUp page to start from: where the previous run
--    stopped when it ran out of time in the last 30 minutes, else page 0.
-- b) cockpit_csm_onboarding_cron_publish(run, rows, forms_verified): writes up
--    to 100 card rows for that open run. Merge rules:
--      * A card whose name differs from the client roster
--        (cockpit_csm_sources 'clients') is not written: the same guard the
--        one-card publish has, so cockpit_csm_onboarding_read keeps working
--        until the roster refreshes. The run counts these cards.
--      * The forms are replaced only when every Typeform was read in full.
--        Otherwise each row keeps its last forms ('{}' for a new row).
--      * A row whose content is unchanged is not rewritten, so the audit
--        trigger records real changes, not one row per card every 10
--        minutes. seen_at and synced_at therefore move only when the row
--        changes; the run row is the freshness signal the screen reads.
--    Nothing is deleted: a card that left the list keeps its last row.
-- c) pg_cron job mahara-onboarding-sync at minute 4, 14, 24, ... of every
--    hour: the Convex cadence (10 minutes), offset from the minute-0 jobs
--    that share the ClickUp token. It posts {} with x-cron-secret from the
--    vault (cockpit_sync_secret); the function compares it to CRON_SECRET.
--
-- No new tables. The audit triggers from 20261006c record every write to
-- both tables. Idempotent.

BEGIN;

-- a) ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cockpit_csm_onboarding_cron_begin() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE run_id bigint;prior public.cockpit_client_onboarding_runs;resume integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_csm_onboarding_cron',0));
 UPDATE public.cockpit_client_onboarding_runs
  SET finished_at=now(),ok=false,problem='The scheduled onboarding sync stopped before it finished. The next run starts again from the first page.'
  WHERE trigger='cron' AND finished_at IS NULL AND started_at<now()-interval '5 minutes';
 IF EXISTS(SELECT 1 FROM public.cockpit_client_onboarding_runs WHERE trigger='cron' AND finished_at IS NULL) THEN
  RETURN jsonb_build_object('busy',true);
 END IF;
 SELECT * INTO prior FROM public.cockpit_client_onboarding_runs WHERE trigger='cron' AND finished_at IS NOT NULL ORDER BY started_at DESC,id DESC LIMIT 1;
 IF prior.id IS NOT NULL AND prior.finished_at>now()-interval '30 minutes' AND coalesce(prior.counts->>'resume_page','')~'^[0-9]{1,2}$' THEN
  resume:=(prior.counts->>'resume_page')::integer;
 END IF;
 INSERT INTO public.cockpit_client_onboarding_runs(trigger,actor_email,counts) VALUES('cron',NULL,jsonb_build_object('start_page',resume)) RETURNING id INTO run_id;
 RETURN jsonb_build_object('busy',false,'run',run_id,'resumePage',resume);
END $$;

-- b) ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cockpit_csm_onboarding_cron_publish(p_run bigint,p_rows jsonb,p_forms_verified boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE run public.cockpit_client_onboarding_runs;total integer;distinct_cards integer;kept integer;written integer;
BEGIN
 SELECT * INTO run FROM public.cockpit_client_onboarding_runs WHERE id=p_run FOR UPDATE;
 IF run.id IS NULL OR run.trigger IS DISTINCT FROM 'cron' OR run.finished_at IS NOT NULL THEN
  RAISE EXCEPTION 'The scheduled onboarding run is not open';
 END IF;
 IF p_forms_verified IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Send between 1 and 100 onboarding rows';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
   OR coalesce(e->>'clickup_task_id','')!~'^[A-Za-z0-9_-]{1,40}$' OR nullif(btrim(e->>'client_name'),'') IS NULL) THEN
  RAISE EXCEPTION 'Every onboarding row needs a ClickUp card id and a name';
 END IF;
 SELECT count(*),count(DISTINCT e->>'clickup_task_id') INTO total,distinct_cards FROM jsonb_array_elements(p_rows) e;
 IF distinct_cards<>total THEN RAISE EXCEPTION 'A ClickUp card appears twice in one batch';END IF;
 SELECT count(*) INTO kept FROM jsonb_array_elements(p_rows) e
  WHERE NOT EXISTS(SELECT 1 FROM public.cockpit_csm_sources s WHERE s.table_name='clients' AND s.data->>'taskId'=e->>'clickup_task_id'
   AND lower(btrim(s.data->>'name')) IS DISTINCT FROM lower(btrim(e->>'client_name')));
 WITH incoming AS(
  SELECT x.* FROM jsonb_array_elements(p_rows) e CROSS JOIN LATERAL jsonb_populate_record(NULL::public.cockpit_client_onboarding,e) x
  WHERE NOT EXISTS(SELECT 1 FROM public.cockpit_csm_sources s WHERE s.table_name='clients' AND s.data->>'taskId'=x.clickup_task_id
   AND lower(btrim(s.data->>'name')) IS DISTINCT FROM lower(btrim(x.client_name)))
 ),saved AS(
  INSERT INTO public.cockpit_client_onboarding AS t(clickup_task_id,client_name,clickup_status,client_status,in_onboarding,csm,signup_on,onboarding_call_on,launch_on,links,handover,sales_transcript,forms,card_updated_at,seen_at,synced_at)
  SELECT i.clickup_task_id,i.client_name,i.clickup_status,i.client_status,coalesce(i.in_onboarding,false),i.csm,i.signup_on,i.onboarding_call_on,i.launch_on,
   coalesce(i.links,'{}'::jsonb),coalesce(i.handover,'{}'::jsonb),i.sales_transcript,
   CASE WHEN p_forms_verified THEN coalesce(i.forms,'{}'::jsonb) ELSE '{}'::jsonb END,
   i.card_updated_at,coalesce(i.seen_at,now()),coalesce(i.synced_at,now())
  FROM incoming i
  ON CONFLICT(clickup_task_id) DO UPDATE SET client_name=excluded.client_name,clickup_status=excluded.clickup_status,client_status=excluded.client_status,
   in_onboarding=excluded.in_onboarding,csm=excluded.csm,signup_on=excluded.signup_on,onboarding_call_on=excluded.onboarding_call_on,launch_on=excluded.launch_on,
   links=excluded.links,handover=excluded.handover,sales_transcript=excluded.sales_transcript,
   forms=CASE WHEN p_forms_verified THEN excluded.forms ELSE t.forms END,
   card_updated_at=excluded.card_updated_at,seen_at=excluded.seen_at,synced_at=excluded.synced_at
  WHERE (t.client_name,t.clickup_status,t.client_status,t.in_onboarding,t.csm,t.signup_on,t.onboarding_call_on,t.launch_on,t.links,t.handover,t.sales_transcript,t.card_updated_at)
     IS DISTINCT FROM (excluded.client_name,excluded.clickup_status,excluded.client_status,excluded.in_onboarding,excluded.csm,excluded.signup_on,excluded.onboarding_call_on,excluded.launch_on,excluded.links,excluded.handover,excluded.sales_transcript,excluded.card_updated_at)
   OR (p_forms_verified AND t.forms IS DISTINCT FROM excluded.forms)
  RETURNING 1
 )
 SELECT count(*) INTO written FROM saved;
 RETURN jsonb_build_object('written',written,'unchanged',kept-written,'identitySkipped',total-kept);
END $$;

REVOKE ALL ON FUNCTION public.cockpit_csm_onboarding_cron_begin(),public.cockpit_csm_onboarding_cron_publish(bigint,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_onboarding_cron_begin(),public.cockpit_csm_onboarding_cron_publish(bigint,jsonb,boolean) TO service_role;
-- The function closes its run through PostgREST (service_role already has
-- all on cockpit_client_onboarding_runs) and keeps its freshness row in
-- cockpit_sync_state under key 'onboarding-sync' (tap-charges-sync's pattern).
GRANT SELECT,INSERT,UPDATE ON public.cockpit_sync_state TO service_role;

-- c) ----------------------------------------------------------------------------
SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname='mahara-onboarding-sync';
SELECT cron.schedule('mahara-onboarding-sync','4-59/10 * * * *',$job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/onboarding-sync', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := '{}'::jsonb, timeout_milliseconds := 150000); $job$);

NOTIFY pgrst,'reload schema';
COMMIT;
