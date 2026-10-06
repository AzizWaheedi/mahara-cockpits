-- A service-only, audited projection into GHL. No SQL function calls a provider.
create table public.cockpit_webinar_pipeline_config (
  location_id text primary key, pipeline_id text not null unique,
  stage_ids jsonb not null check(jsonb_typeof(stage_ids)='object'),
  enabled boolean not null default false, verified_at timestamptz not null default now()
);
create table public.cockpit_webinar_pipeline_cards (
  registration_id uuid primary key references public.cockpit_webinar_registrations(id),
  pipeline_id text not null references public.cockpit_webinar_pipeline_config(pipeline_id),
  opportunity_id text unique, stage_key text,
  state text not null default 'ready' check(state in ('ready','running','synced','blocked','uncertain')),
  lease_token uuid, lease_until timestamptz, mutation_started_at timestamptz,
  last_success_at timestamptz, code text,
  updated_at timestamptz not null default now()
);
create index cockpit_webinar_pipeline_cards_pipeline on public.cockpit_webinar_pipeline_cards(pipeline_id);
create table public.cockpit_webinar_pipeline_attempts (
  id uuid primary key, registration_id uuid not null references public.cockpit_webinar_registrations(id),
  started_at timestamptz not null default now(), finished_at timestamptz,
  stage_key text, opportunity_id text, outcome text, code text
);
create index cockpit_webinar_pipeline_attempts_registration on public.cockpit_webinar_pipeline_attempts(registration_id,started_at desc);
-- A sales booking must be explicitly attributed to this registration. Never bind by contact + nearest date.
create table public.cockpit_webinar_sales_bindings (
  registration_id uuid not null references public.cockpit_webinar_registrations(id),
  appointment_id text not null unique,
  sales_opportunity_id text unique,
  evidence text not null check(length(evidence) between 1 and 500),
  bound_by text not null check(length(bound_by) between 1 and 200),
  bound_at timestamptz not null default now(),
  primary key(registration_id,appointment_id)
);
-- Coalesced workflow hints. A tag or webhook may wake reconciliation but cannot prove a stage.
create table public.cockpit_webinar_pipeline_signals (
  location_id text not null references public.cockpit_webinar_pipeline_config(location_id),
  contact_id text not null check(contact_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  requested_at timestamptz not null default now(), processed_at timestamptz,
  primary key(location_id,contact_id)
);

create view public.cockpit_webinar_pipeline_evidence with (security_invoker=true) as
select r.id as registration_id,r.event_id,r.event_revision,r.location_id,r.contact_id,e.event_key,
  public.cockpit_webinar_registration_state(r.id)->>'status' as registration_status,
  exists(select 1 from public.cockpit_webinar_attendance_matches a where a.registration_id=r.id and a.match_status='exact_registrant_and_session') as attended,
  exists(select 1 from public.cockpit_webinar_survey_receipts f where f.registration_id=r.id and f.match_status='scoped_reference') as survey_completed,
  -- Missing or ambiguous attendance stays unknown. No inference from an empty collector.
  (exists(select 1 from public.cockpit_webinar_event_sessions bs where bs.event_id=r.event_id)
   and not exists(select 1 from public.cockpit_webinar_event_sessions bs
     join public.cockpit_webinar_sessions s on s.uuid=bs.session_uuid
     where bs.event_id=r.event_id and (not s.complete or s.ended_at is null or s.ended_at>now()-interval '2 hours'
       or s.participant_rows<>(select count(*) from public.cockpit_webinar_attendance a where a.session_uuid=s.uuid)))
   and not exists(select 1 from public.cockpit_webinar_attendance_matches a where a.event_id=r.event_id
     and a.match_status not in ('exact_registrant_and_session','excluded_internal','excluded_status'))
  ) as attendance_final
from public.cockpit_webinar_registrations r join public.cockpit_webinar_events e on e.id=r.event_id;

create function public.cockpit_claim_webinar_pipeline(p_registration uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.cockpit_webinar_pipeline_config; card public.cockpit_webinar_pipeline_cards; t uuid:=gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended('webinar-card:'||p_registration,0));
  select pc.* into c from public.cockpit_webinar_registrations r join public.cockpit_webinar_pipeline_config pc on pc.location_id=r.location_id where r.id=p_registration;
  if not found or not c.enabled then return null; end if;
  insert into public.cockpit_webinar_pipeline_cards(registration_id,pipeline_id) values(p_registration,c.pipeline_id) on conflict do nothing;
  select * into card from public.cockpit_webinar_pipeline_cards where registration_id=p_registration for update;
  if card.pipeline_id<>c.pipeline_id then raise exception 'Pipeline scope changed'; end if;
  if card.state='running' and card.lease_until>clock_timestamp() then return null; end if;
  if card.state='running' then
    update public.cockpit_webinar_pipeline_attempts set finished_at=clock_timestamp(),outcome=case when card.mutation_started_at is null then 'blocked' else 'uncertain' end,code='lease_expired' where id=card.lease_token;
    update public.cockpit_webinar_pipeline_cards set state=case when mutation_started_at is null then 'blocked' else 'uncertain' end,code='lease_expired',updated_at=clock_timestamp() where registration_id=p_registration;
    return null;
  end if;
  if card.state in ('blocked','uncertain') then return null; end if;
  if card.last_success_at>clock_timestamp()-interval '5 minutes' and not exists(
    select 1 from public.cockpit_webinar_pipeline_signals s join public.cockpit_webinar_registrations r
      on r.location_id=s.location_id and r.contact_id=s.contact_id
    where r.id=p_registration and s.requested_at>card.last_success_at
      and (s.processed_at is null or s.processed_at<s.requested_at)) then return null; end if;
  update public.cockpit_webinar_pipeline_cards set state='running',lease_token=t,lease_until=clock_timestamp()+interval '5 minutes',mutation_started_at=null,updated_at=clock_timestamp() where registration_id=p_registration returning * into card;
  insert into public.cockpit_webinar_pipeline_attempts(id,registration_id) values(t,p_registration);
  return to_jsonb(card)||jsonb_build_object('config',to_jsonb(c));
end $$;
create function public.cockpit_mark_webinar_pipeline_mutation(p_registration uuid,p_lease uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  update public.cockpit_webinar_pipeline_cards set mutation_started_at=clock_timestamp()
    where registration_id=p_registration and lease_token=p_lease and state='running' and lease_until>clock_timestamp() and mutation_started_at is null;
  if not found then raise exception 'Pipeline lease lost'; end if;
end $$;
create function public.cockpit_finish_webinar_pipeline(p_registration uuid,p_lease uuid,p_state text,p_code text,p_opportunity text default null,p_stage text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare card public.cockpit_webinar_pipeline_cards; outcome_state text;
begin
  select * into card from public.cockpit_webinar_pipeline_cards where registration_id=p_registration for update;
  if card.state='synced' and card.lease_token=p_lease and p_state='synced' and card.opportunity_id=p_opportunity and card.stage_key=p_stage then return; end if;
  if card.lease_token is distinct from p_lease or card.state is distinct from 'running' or card.lease_until<=clock_timestamp() then raise exception 'Pipeline lease lost'; end if;
  if p_state is null or p_state not in ('synced','blocked','uncertain') or p_code is null or p_code !~ '^[a-z0-9_]{1,100}$' then raise exception 'Invalid pipeline completion'; end if;
  outcome_state:=case when p_state<>'synced' and card.mutation_started_at is not null then 'uncertain' else p_state end;
  if outcome_state<>'synced' and (p_opportunity is not null or p_stage is not null) then raise exception 'Failure cannot supply a pipeline receipt'; end if;
  if outcome_state='synced' and (coalesce(p_opportunity,'')='' or p_stage is null or not exists(select 1 from public.cockpit_webinar_pipeline_config where pipeline_id=card.pipeline_id and stage_ids ? p_stage)
    or (card.opportunity_id is not null and card.opportunity_id<>p_opportunity)) then raise exception 'Pipeline receipt mismatch'; end if;
  update public.cockpit_webinar_pipeline_cards set state=outcome_state,code=p_code,
    opportunity_id=coalesce(p_opportunity,opportunity_id),stage_key=coalesce(p_stage,stage_key),lease_until=null,
    last_success_at=case when outcome_state='synced' then clock_timestamp() else last_success_at end,updated_at=clock_timestamp() where registration_id=p_registration;
  update public.cockpit_webinar_pipeline_attempts set finished_at=clock_timestamp(),outcome=outcome_state,code=p_code,opportunity_id=p_opportunity,stage_key=p_stage where id=p_lease;
  if outcome_state='synced' then
    update public.cockpit_webinar_pipeline_signals s set processed_at=clock_timestamp()
      from public.cockpit_webinar_registrations r where r.id=p_registration and s.location_id=r.location_id and s.contact_id=r.contact_id
      and not exists(select 1 from public.cockpit_webinar_registrations other
        left join public.cockpit_webinar_pipeline_cards oc on oc.registration_id=other.id
        where other.location_id=r.location_id and other.contact_id=r.contact_id
          and public.cockpit_webinar_registration_state(other.id)->>'status'='confirmed' and
          (oc.last_success_at is null or oc.last_success_at<s.requested_at));
  end if;
end $$;
create function public.cockpit_signal_webinar_pipeline(p_location text,p_contact text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.cockpit_webinar_pipeline_config where location_id=p_location) then raise exception 'Unknown pipeline location'; end if;
  -- Sales workflows can wake non-webinar contacts. Ignore them without storing PII.
  if not exists(select 1 from public.cockpit_webinar_registrations where location_id=p_location and contact_id=p_contact) then return; end if;
  insert into public.cockpit_webinar_pipeline_signals(location_id,contact_id) values(p_location,p_contact)
    on conflict(location_id,contact_id) do update set requested_at=clock_timestamp();
end $$;
create view public.cockpit_webinar_pipeline_health with (security_invoker=true) as
 select max(last_success_at) as last_success_at,count(*) filter(where state='blocked') as blocked,
 count(*) filter(where state='uncertain' or (state='running' and lease_until<now())) as uncertain,
 count(*) filter(where state in ('ready','running')) as pending,
 (select count(*) from public.cockpit_webinar_pipeline_signals where processed_at is null or processed_at<requested_at) as pending_signals
 from public.cockpit_webinar_pipeline_cards;
do $$ declare t text; f record; begin
  foreach t in array array['cockpit_webinar_pipeline_config','cockpit_webinar_pipeline_cards','cockpit_webinar_pipeline_attempts','cockpit_webinar_sales_bindings','cockpit_webinar_pipeline_signals'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select,insert,update on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
    ('cockpit_claim_webinar_pipeline','cockpit_mark_webinar_pipeline_mutation','cockpit_finish_webinar_pipeline','cockpit_signal_webinar_pipeline') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
revoke all on public.cockpit_webinar_pipeline_evidence,public.cockpit_webinar_pipeline_health from public,anon,authenticated,service_role;
grant select on public.cockpit_webinar_pipeline_evidence,public.cockpit_webinar_pipeline_health to service_role;
create view public.cockpit_webinar_pipeline_due with (security_invoker=true) as
select r.id as registration_id,c.last_success_at,c.updated_at
from public.cockpit_webinar_registrations r
join public.cockpit_webinar_pipeline_config cfg on cfg.location_id=r.location_id and cfg.enabled
left join public.cockpit_webinar_pipeline_cards c on c.registration_id=r.id
where public.cockpit_webinar_registration_state(r.id)->>'status'='confirmed'
  and (c.registration_id is null or c.state='ready' or (c.state='synced' and c.last_success_at<now()-interval '5 minutes') or (c.state='running' and c.lease_until<now()) or (c.state='synced' and exists(
    select 1 from public.cockpit_webinar_pipeline_signals s where s.location_id=r.location_id and s.contact_id=r.contact_id and s.requested_at>c.last_success_at and (s.processed_at is null or s.processed_at<s.requested_at))));
revoke all on public.cockpit_webinar_pipeline_due from public,anon,authenticated,service_role;
grant select on public.cockpit_webinar_pipeline_due to service_role;

-- Reuse the existing source-health ledger. No external call happens in these RPCs.
alter table public.cockpit_webinar_pulls drop constraint cockpit_webinar_pulls_source_check;
alter table public.cockpit_webinar_pulls add constraint cockpit_webinar_pulls_source_check
  check(source in ('zoom','typeform','reminders','objections','pipeline','native_forms'));
create function public.cockpit_start_webinar_bridge_run(p_source text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare run_id bigint;
begin
  if p_source is null or p_source not in ('pipeline','native_forms') then raise exception 'Unknown bridge source'; end if;
  insert into public.cockpit_webinar_pulls(source,via) values(p_source,'webinar-registration-api') returning id into run_id;
  return run_id;
end $$;
create function public.cockpit_finish_webinar_bridge_run(p_id bigint,p_ok boolean,p_counts jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_ok is null or p_counts is null or jsonb_typeof(p_counts)<>'object' then raise exception 'Invalid bridge result'; end if;
  update public.cockpit_webinar_pulls set ok=p_ok,finished_at=clock_timestamp(),counts=p_counts
    where id=p_id and source in ('pipeline','native_forms') and finished_at is null;
  if not found and not exists(select 1 from public.cockpit_webinar_pulls where id=p_id
      and source in ('pipeline','native_forms') and ok=p_ok and counts=p_counts and finished_at is not null)
    then raise exception 'Bridge run missing or changed'; end if;
end $$;
revoke all on function public.cockpit_start_webinar_bridge_run(text),public.cockpit_finish_webinar_bridge_run(bigint,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.cockpit_start_webinar_bridge_run(text),public.cockpit_finish_webinar_bridge_run(bigint,boolean,jsonb) to service_role;
