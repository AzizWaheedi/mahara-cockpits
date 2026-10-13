-- One trace from an affected Meta ad through the existing ClickUp script and
-- editor tasks to a launched replacement. ClickUp owns production state and
-- Meta/GHL own delivery facts; this table holds verified links and feedback.
-- Creative Triage only. Additive and service-key only.
begin;

create table if not exists public.cockpit_creative_requests (
  id uuid primary key default gen_random_uuid(),
  campaign_name text not null,
  client_name text not null,
  client_tag text,
  meta_account_id text not null,
  source_meta_ad_id text not null,
  source_ad_name text not null,
  requested_by text not null,
  evidence text not null,
  note text,
  status text not null default 'requested'
    check (status in ('requested', 'script_ready', 'editing', 'asset_ready', 'launched', 'reviewed', 'cancelled')),
  script_task_id text unique,
  script_task_url text,
  editor_task_id text unique,
  editor_task_url text,
  asset_url text,
  launched_meta_ad_id text,
  launched_at timestamptz,
  launch_time_source text check (launch_time_source in ('buyer_date')),
  verdict text check (verdict in ('worked', 'needs_another_version', 'stop')),
  verdict_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  feedback_posted_at timestamptz,
  feedback_error text,
  last_error text,
  last_actor text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cockpit_creative_requests_one_open_ad
  on public.cockpit_creative_requests (campaign_name, source_meta_ad_id)
  where status not in ('reviewed', 'cancelled');
create index if not exists cockpit_creative_requests_campaign_recent
  on public.cockpit_creative_requests (campaign_name, created_at desc);

create table if not exists public.cockpit_creative_request_events (
  id bigserial primary key,
  request_id uuid not null references public.cockpit_creative_requests(id),
  kind text not null,
  actor text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists cockpit_creative_request_events_request
  on public.cockpit_creative_request_events (request_id, at desc);

create or replace function public.cockpit_audit_creative_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  before_row jsonb;
begin
  if tg_op = 'UPDATE' then
    before_row := to_jsonb(old);
  end if;
  insert into public.cockpit_creative_request_events (request_id, kind, actor, detail)
  values (
    new.id,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    new.last_actor,
    jsonb_build_object('before', before_row, 'after', to_jsonb(new))
  );
  return new;
end;
$$;
revoke all on function public.cockpit_audit_creative_request() from public, anon, authenticated;
drop trigger if exists cockpit_creative_request_audit on public.cockpit_creative_requests;
create trigger cockpit_creative_request_audit
after insert or update on public.cockpit_creative_requests
for each row execute function public.cockpit_audit_creative_request();

alter table public.cockpit_creative_requests enable row level security;
alter table public.cockpit_creative_request_events enable row level security;
revoke all on public.cockpit_creative_requests from anon, authenticated;
revoke all on public.cockpit_creative_request_events from anon, authenticated;
revoke all on sequence public.cockpit_creative_request_events_id_seq from anon, authenticated;
grant select, insert, update on public.cockpit_creative_requests to service_role;
grant select, insert on public.cockpit_creative_request_events to service_role;
grant usage, select on sequence public.cockpit_creative_request_events_id_seq to service_role;

commit;
