-- Cockpit guardian (hermes/cockpit-guardian): one row per incident, and a
-- read-only probe of what PostgREST cannot serve.
--
-- cockpit_guardian_incidents: the guardian opens a row when a check breaks,
-- updates it while it stays broken, and resolves it with what fixed it. At
-- most one open row per check (the partial unique index). The guardian keeps
-- the same rows in its state file on the VPS and sends them here by id, so a
-- Supabase outage never loses an incident.
--
-- Service role only: row security on, no policy for any seat, the table
-- revoked from anon and authenticated. The CEO cockpit reads it later
-- through its own server.
--
-- cockpit_guardian_probe(): pg_cron job names, schedules and run results,
-- pg_net answer codes for the last hour, and a count of auth accounts whose
-- role is not authenticated. It never returns cron.job.command, which holds
-- a literal Authorization value for three jobs. Service role only.

create table if not exists public.cockpit_guardian_incidents (
  id                 uuid primary key,
  check_id           text not null check (check_id ~ '^[a-z][a-z0-9-]{2,60}$'),
  area               text not null check (length(area) between 1 and 40),
  status             text not null default 'open' check (status in ('open', 'resolved')),
  level              text not null check (level in ('warn', 'fail', 'unknown')),
  severity           text not null check (severity in ('critical', 'high', 'medium', 'low')),
  title              text not null check (length(title) between 1 and 200),
  detail             text check (detail is null or length(detail) <= 1000),
  action             text check (action is null or length(action) <= 1000),
  owner              text check (owner is null or length(owner) <= 80),
  evidence           jsonb not null default '{}'::jsonb,
  first_seen_at      timestamptz not null,
  opened_at          timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  resolved_by        text check (resolved_by is null or length(resolved_by) <= 500),
  seen               integer not null default 1 check (seen >= 0),
  fix_attempts       jsonb not null default '[]'::jsonb check (jsonb_typeof(fix_attempts) = 'array'),
  alerted_at         timestamptz,
  resolve_alerted_at timestamptz,
  mode               text check (mode is null or mode in ('report-only', 'fix')),
  check ((status = 'resolved') = (resolved_at is not null))
);

comment on table public.cockpit_guardian_incidents is
  'Cockpit guardian incidents (hermes/cockpit-guardian): one row per broken check, opened, updated and resolved with what fixed it. Service role only.';

create unique index if not exists cockpit_guardian_incidents_one_open
  on public.cockpit_guardian_incidents (check_id) where status = 'open';
create index if not exists cockpit_guardian_incidents_recent
  on public.cockpit_guardian_incidents (status, opened_at desc);

alter table public.cockpit_guardian_incidents enable row level security;
revoke all on table public.cockpit_guardian_incidents from public, anon, authenticated;
grant select, insert, update on table public.cockpit_guardian_incidents to service_role;

create or replace function public.cockpit_guardian_probe()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $probe$
select jsonb_build_object(
  'at', now(),
  'cron_jobs', coalesce((
    select jsonb_agg(jsonb_build_object('jobid', j.jobid, 'jobname', j.jobname,
                                        'schedule', j.schedule, 'active', j.active) order by j.jobid)
      from cron.job as j), '[]'::jsonb),
  'cron_runs', coalesce((
    select jsonb_agg(to_jsonb(x)) from (
      select d.jobid,
             count(*) filter (where d.start_time > now() - interval '24 hours') as runs_24h,
             count(*) filter (where d.start_time > now() - interval '24 hours'
                                and d.status <> 'succeeded') as failed_24h,
             max(d.start_time) as last_start,
             (array_agg(d.status order by d.start_time desc))[1] as last_status,
             left((array_agg(d.return_message order by d.start_time desc)
                     filter (where d.status <> 'succeeded'))[1], 160) as last_error
        from cron.job_run_details as d
       where d.start_time > now() - interval '2 days'
       group by d.jobid) as x), '[]'::jsonb),
  'http_1h', coalesce((
    select jsonb_object_agg(y.k, y.n) from (
      select case when r.timed_out then 'timeout'
                  when r.status_code is null then 'error'
                  when r.status_code = 404 and r.content like '%Requested function was not found%'
                    then 'missing_function'
                  else r.status_code::text end as k,
             count(*) as n
        from net._http_response as r
       where r.created > now() - interval '1 hour'
       group by 1) as y), '{}'::jsonb),
  'auth_roles', coalesce((
    select jsonb_object_agg(z.role, z.n) from (
      select coalesce(u.role, '(none)') as role, count(*) as n
        from auth.users as u
       where u.role is distinct from 'authenticated' and u.deleted_at is null
       group by 1) as z), '{}'::jsonb)
)
$probe$;

comment on function public.cockpit_guardian_probe() is
  'Read-only health readings for the cockpit guardian: pg_cron names, schedules and run results, pg_net answer codes, auth role counts. Never cron.job.command.';

revoke all on function public.cockpit_guardian_probe() from public, anon, authenticated;
grant execute on function public.cockpit_guardian_probe() to service_role;
