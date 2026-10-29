-- The sales-conversations worker every minute, through the shared cron
-- secret (vault cockpit_sync_secret), the same door as mahara-sales-mirror.
-- The worker holds its own lease, so a minute that finds the last run still
-- going does nothing.

select cron.unschedule(j.jobid) from cron.job as j where j.jobname = 'mahara-sales-conversations';
select cron.schedule(
  'mahara-sales-conversations',
  '* * * * *',
  $job$select net.http_post(
    url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-conversations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cockpit_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );$job$
);
