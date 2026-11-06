-- New leads reach the setter's queue within about a minute (2026-11-05).
--
-- sales-mirror copies HighLevel's newest contacts (one search, the 50 newest,
-- those added in the last day) on its three-minute run, so a new lead could
-- wait up to three minutes before the dialer saw it, past the two-minute
-- call target. This job asks sales-mirror for that one step every minute
-- (body {"mode":"new_contacts"}): one HighLevel search a minute, beside the
-- conversations copy's own (mahara-sales-conversations, every minute);
-- HighLevel allows the sub-account about 100 requests in 10 seconds, shared
-- with the reps' sends. The same read now brings in a ROAS tag that landed
-- after the first read (sales-mirror lib.ts latePatches).
--
-- Deploy sales-mirror with the mode first: an older sales-mirror ignores the
-- body and would run the whole copy every minute. The three-minute run keeps
-- copying new contacts too, so unscheduling this job only slows intake back
-- to three minutes.
--
-- The same door as mahara-sales-mirror: the shared cron secret from the
-- vault (cockpit_sync_secret). The function holds its own lock
-- (sales-mirror-contacts, 55 seconds), so a minute that finds the last run
-- still going does nothing. It reports in cockpit_sales_worker_status
-- (sales-mirror / new_contacts), shown on the Team page's Health card.

select cron.unschedule(j.jobid) from cron.job as j where j.jobname = 'mahara-sales-new-contacts';
select cron.schedule(
  'mahara-sales-new-contacts',
  '* * * * *',
  $job$select net.http_post(
    url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-mirror',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_sync_secret')
    ),
    body := '{"mode":"new_contacts"}'::jsonb,
    timeout_milliseconds := 30000
  );$job$
);
