-- 13 Oct 2026: the three mahara-sync-* pg_cron jobs kept their Bearer key as literal text in cron.job.command
-- (cockpit guardian check pg-cron-secrets). Copy it into the vault inside the database, then make the jobs read it
-- from there. The key never appears in this file. Same key, same URLs, same schedules.
-- Applied by Claude for Muhammed on 2026-10-13 (version 20261013163405). Rotating the key is a separate step: change it
-- in the mahara-creative-dashboard Vercel settings and in vault secret creative_dashboard_sync_token together.
do $$
declare
  tok text;
begin
  if (select count(distinct substring(command from 'Bearer\s+([A-Za-z0-9._\-]+)')) from cron.job
      where jobname in ('mahara-sync-activities', 'mahara-sync-business', 'mahara-sync-overnight')) <> 1 then
    raise exception 'the three mahara-sync jobs do not share one literal key';
  end if;
  select substring(command from 'Bearer\s+([A-Za-z0-9._\-]+)') into tok from cron.job where jobname = 'mahara-sync-business';
  if tok is null or length(tok) < 32 then
    raise exception 'no literal key found in mahara-sync-business';
  end if;
  if exists (select 1 from vault.secrets where name = 'creative_dashboard_sync_token') then
    raise exception 'vault secret creative_dashboard_sync_token already exists';
  end if;
  perform vault.create_secret(tok, 'creative_dashboard_sync_token',
    'Bearer key for mahara-creative-dashboard /api/sync and /api/sync/activities; read by pg_cron mahara-sync-*');
  if (select decrypted_secret from vault.decrypted_secrets where name = 'creative_dashboard_sync_token') is distinct from tok then
    raise exception 'vault copy does not match the job key';
  end if;
end $$;

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'mahara-sync-business'), command := $cmd$
  select net.http_post(
    url := 'https://mahara-creative-dashboard.vercel.app/api/sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'creative_dashboard_sync_token'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 300000
  );
$cmd$);

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'mahara-sync-overnight'), command := $cmd$
  select net.http_post(
    url := 'https://mahara-creative-dashboard.vercel.app/api/sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'creative_dashboard_sync_token'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 300000
  );
$cmd$);

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'mahara-sync-activities'), command := $cmd$
  select net.http_post(
    url := 'https://mahara-creative-dashboard.vercel.app/api/sync/activities',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'creative_dashboard_sync_token'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 300000
  );
$cmd$);
