-- Schedule ecom-payments-sync every 15 minutes (tap-charges-sync's pattern).
select cron.unschedule(jobid) from cron.job where jobname = 'mahara-ecom-payments-sync';
select cron.schedule('mahara-ecom-payments-sync', '*/15 * * * *', $job$ select net.http_post(
  url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/ecom-payments-sync',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 60000); $job$);
