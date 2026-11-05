-- Read Tap invoice status every 15 minutes (tap-charges-sync's pattern), for
-- 20261105t_invoice_tap_links.sql. invoice-tap calls Tap only while a cockpit
-- Tap invoice is still open, so a quiet day costs no Tap calls.
select cron.unschedule(jobid) from cron.job where jobname = 'mahara-invoice-tap-sync';
select cron.schedule('mahara-invoice-tap-sync', '7,22,37,52 * * * *', $job$ select net.http_post(
  url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/invoice-tap',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')),
  body := '{"op":"sync"}'::jsonb, timeout_milliseconds := 60000); $job$);
