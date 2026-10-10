-- Hiring, native on Supabase.
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive; safe to run again.
--
-- The media cockpit's Convex deployment ran three hiring crons until it
-- stopped on 2026-10-07 (~22:40 UTC): the careers-form import every 30
-- minutes, the GoHighLevel board mirror every 10, and the message engine
-- every 10. The CEO Hiring tab's actions went with them. This moves all of
-- it to two Edge Functions:
--
--   hiring-sync  (verify_jwt off) pg_cron posts {"job": "mirror" | "intake"
--                | "engine"} with x-cron-secret from the vault
--                (cockpit_sync_secret), compared to the function's
--                CRON_SECRET. {"job": "doctor"} names missing keys.
--   hiring-api   (verify_jwt on) the Hiring tab: refreshNow, grade,
--                reassign, setEngine, drafts, sendDraft. The caller's token
--                must pass public.cockpit_is_ceo().
--
-- Outward safety:
--   GoHighLevel contact, card and note writes are dry runs unless the Edge
--   Function secret HIRING_APPLY is exactly 'true'.
--   No schedule messages a candidate. The engine only writes drafts. A
--   draft is sent only by sendDraft, pressed by the CEO, and only when
--   HIRING_SEND_ENABLED is exactly 'true'. Every attempt, sent or refused,
--   is a row in cockpit_hiring_sends and in cockpit_audit_log.
--
-- Freshness: cockpit_sync_state keys hiring-sync:mirror, hiring-sync:intake
-- and hiring-sync:engine (last_run_at, last_ok_at, ok, note, rows_seen);
-- cockpit_hiring_runs holds every run, its result and its failure.

begin;

-- 1. The run ledger, which is also the lock: one running row per job. -------

create table if not exists public.cockpit_hiring_runs (
  id                uuid primary key default gen_random_uuid(),
  job               text not null check (job in ('mirror', 'intake', 'engine')),
  trigger           text not null check (trigger in ('schedule', 'refreshNow')),
  -- The CEO's email for a run started from the Hiring tab; null for the schedule.
  actor_email       text,
  status            text not null check (status in ('running', 'ok', 'failed', 'expired')),
  -- HIRING_APPLY as the run saw it: false means every GoHighLevel write was a dry run.
  apply             boolean not null default false,
  lease_expires_at  timestamptz not null,
  result            jsonb,
  error             text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);
comment on table public.cockpit_hiring_runs is
  'One row per hiring-sync job run (mirror, intake, engine), scheduled or from the Hiring tab. A running row is the lock; result holds the counts and, for a dry run, the plan of what would have been written.';
create unique index if not exists cockpit_hiring_runs_one_running
  on public.cockpit_hiring_runs (job) where status = 'running';
create index if not exists cockpit_hiring_runs_job_idx
  on public.cockpit_hiring_runs (job, started_at desc);

-- 2. The health ledger: every GoHighLevel and Typeform call. ----------------

create table if not exists public.cockpit_hiring_provider_health (
  id           bigint generated always as identity primary key,
  run_id       uuid references public.cockpit_hiring_runs(id),
  actor_email  text,
  provider     text not null check (provider in ('gohighlevel', 'typeform')),
  method       text not null,
  -- The path only: no query string, no token.
  resource     text not null,
  -- blocked: a write or send the dry-run or send gate stopped before any call.
  phase        text not null check (phase in ('intent', 'response', 'failed', 'blocked')),
  http_status  integer,
  error        text,
  created_at   timestamptz not null default now()
);
comment on table public.cockpit_hiring_provider_health is
  'A receipt before and after every outside call the hiring functions make. Paths and status codes only, with errors stripped of tokens.';
create index if not exists cockpit_hiring_provider_health_created_idx
  on public.cockpit_hiring_provider_health (created_at desc);
create index if not exists cockpit_hiring_provider_health_run_idx
  on public.cockpit_hiring_provider_health (run_id);

-- 3. Every attempt to send a draft, and the lock that stops a double send. --

create table if not exists public.cockpit_hiring_sends (
  id            bigint generated always as identity primary key,
  event_id      bigint not null references public.cockpit_hiring_events(id) on delete cascade,
  candidate_id  text not null,
  actor_email   text not null,
  -- refused: a gate said no and nothing was sent. claimed: the send started.
  -- A claimed row that never finishes keeps the draft locked on purpose:
  -- the message may have gone, so a person checks GoHighLevel first.
  status        text not null check (status in ('refused', 'claimed', 'sent', 'failed')),
  rails         text[] not null default '{}',
  detail        text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
comment on table public.cockpit_hiring_sends is
  'Every press of Send on a hiring draft: refused by a gate, claimed, sent, or failed. At most one claimed or sent row per draft.';
create unique index if not exists cockpit_hiring_sends_one_live
  on public.cockpit_hiring_sends (event_id) where status in ('claimed', 'sent');
create index if not exists cockpit_hiring_sends_event_idx
  on public.cockpit_hiring_sends (event_id);

-- 4. Row security and grants: the service key is the only door. ------------

alter table public.cockpit_hiring_runs enable row level security;
alter table public.cockpit_hiring_provider_health enable row level security;
alter table public.cockpit_hiring_sends enable row level security;

revoke all on public.cockpit_hiring_runs from public, anon, authenticated, service_role;
revoke all on public.cockpit_hiring_provider_health from public, anon, authenticated, service_role;
revoke all on public.cockpit_hiring_sends from public, anon, authenticated, service_role;
grant select, insert, update on public.cockpit_hiring_runs to service_role;
grant select, insert on public.cockpit_hiring_provider_health to service_role;
grant select, insert, update on public.cockpit_hiring_sends to service_role;
grant usage, select on sequence public.cockpit_hiring_provider_health_id_seq to service_role;
grant usage, select on sequence public.cockpit_hiring_sends_id_seq to service_role;

-- The tables the functions already shared with Convex, granted by name so
-- the functions do not depend on default privileges.
grant select, insert, update on
  public.cockpit_hiring_candidates,
  public.cockpit_hiring_events,
  public.cockpit_hiring_meta,
  public.cockpit_hiring_applications,
  public.cockpit_sync_state
  to service_role;
grant usage, select on sequence public.cockpit_hiring_events_id_seq to service_role;
grant select, insert on public.cockpit_audit_log to service_role;

-- 5. Taking the run lock. --------------------------------------------------
--
-- A lease that ran out (the function was killed mid-run) is marked expired
-- first, so one crash never blocks the job for good. Returns the new run id,
-- or null when the job is already running.

create or replace function public.cockpit_hiring_claim_run(
  p_job text,
  p_trigger text,
  p_actor text,
  p_apply boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_job is null or p_job not in ('mirror', 'intake', 'engine') then
    raise exception 'Unknown hiring job %', p_job using errcode = '22023';
  end if;
  update public.cockpit_hiring_runs
     set status = 'expired',
         finished_at = now(),
         error = 'The run stopped before it finished; its lease ran out.'
   where job = p_job and status = 'running' and lease_expires_at < now();
  insert into public.cockpit_hiring_runs (job, trigger, actor_email, status, apply, lease_expires_at)
  values (p_job, p_trigger, p_actor, 'running', coalesce(p_apply, false), now() + interval '7 minutes')
  on conflict (job) where status = 'running' do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.cockpit_hiring_claim_run(text, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.cockpit_hiring_claim_run(text, text, text, boolean) to service_role;

-- 6. The schedule, as Convex ran it, staggered so the engine reads a fresh --
--    board: mirror at 1, 11, 21..., engine five minutes later, intake twice
--    an hour.

select cron.unschedule(j.jobid) from cron.job as j
 where j.jobname in ('mahara-hiring-mirror', 'mahara-hiring-intake', 'mahara-hiring-engine');

select cron.schedule('mahara-hiring-mirror', '1-59/10 * * * *', $job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/hiring-sync', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := jsonb_build_object('job','mirror'), timeout_milliseconds := 150000); $job$);

select cron.schedule('mahara-hiring-engine', '6-59/10 * * * *', $job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/hiring-sync', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := jsonb_build_object('job','engine'), timeout_milliseconds := 150000); $job$);

select cron.schedule('mahara-hiring-intake', '8,38 * * * *', $job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/hiring-sync', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := jsonb_build_object('job','intake'), timeout_milliseconds := 150000); $job$);

notify pgrst, 'reload schema';

commit;
