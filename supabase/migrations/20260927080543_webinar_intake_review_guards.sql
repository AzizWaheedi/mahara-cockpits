-- Preserve uncertain writes even when a caller asks to hold a failed job.
create or replace function public.cockpit_finish_webinar_job(p_job uuid,p_lease uuid,p_state text,p_code text,p_receipt jsonb default null)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.cockpit_webinar_jobs; result_state text; conf public.cockpit_webinar_event_configs;
begin
  select * into j from public.cockpit_webinar_jobs where id=p_job for update;
  -- Replay a successful DB commit whose HTTP response was lost.
  if j.state='succeeded' and j.lease_token=p_lease and p_state='succeeded' then
    if (select receipt from public.cockpit_webinar_provider_receipts where job_id=p_job) is distinct from p_receipt then raise exception 'Receipt reused'; end if;
    return;
  end if;
  if j.lease_token is distinct from p_lease or j.state<>'running' or j.lease_until<=clock_timestamp() then raise exception 'Lease lost'; end if;
  if p_state not in ('retry','uncertain','blocked','succeeded') or p_state is null or p_code is null or p_code !~ '^[a-z0-9_]{1,100}$'
    then raise exception 'Invalid completion'; end if;
  result_state:=p_state;
  if p_state in ('retry','blocked') and j.mutation_started_at is not null then result_state:='uncertain'; end if;
  if result_state='retry' and j.attempts>=5 then result_state:='blocked'; end if;
  if result_state='succeeded' then
    if j.kind='resolve_registration' then raise exception 'Use binding transaction'; end if;
    if jsonb_typeof(p_receipt) is distinct from 'object' or coalesce(p_receipt->>'resource_id','')='' then raise exception 'Missing provider receipt'; end if;
    select c.* into conf from public.cockpit_webinar_intakes i join public.cockpit_webinar_event_configs c on c.event_id=i.event_id and c.revision=i.event_revision where i.id=j.intake_id;
    if (j.kind='zoom_registrant' and (p_receipt->>'provider' is distinct from 'zoom' or p_receipt->>'scope' is distinct from conf.meeting_id))
      or (j.kind='training_appointment' and (p_receipt->>'provider' is distinct from 'ghl' or p_receipt->>'scope' is distinct from conf.calendar_id))
      then raise exception 'Provider scope mismatch'; end if;
    insert into public.cockpit_webinar_provider_receipts(job_id,provider,resource_id,scope,receipt)
      values(j.id,p_receipt->>'provider',p_receipt->>'resource_id',p_receipt->>'scope',p_receipt);
    if j.kind='zoom_registrant' then
      insert into public.cockpit_webinar_zoom_registrants(registration_id,meeting_id,registrant_id,join_url,job_id)
        values(j.registration_id,conf.meeting_id,p_receipt->>'resource_id',p_receipt->>'join_url',j.id);
    end if;
  end if;
  update public.cockpit_webinar_jobs set state=result_state,code=p_code,lease_until=null,
    available_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^j.attempts)::integer)),updated_at=clock_timestamp() where id=j.id;
  update public.cockpit_webinar_job_attempts set finished_at=clock_timestamp(),outcome=result_state,code=p_code where job_id=j.id and attempt=j.attempts;
end $$;


alter table public.cockpit_webinar_jobs add constraint cockpit_webinar_mutation_state
  check(mutation_started_at is null or state in ('running','succeeded','uncertain'));
create index cockpit_webinar_jobs_expiring on public.cockpit_webinar_jobs(lease_until) where state='running';
-- A published provider scope and link identity are immutable to the runtime.
revoke update on public.cockpit_webinar_event_configs, public.cockpit_webinar_link_refs from service_role;
grant update(registration_open) on public.cockpit_webinar_event_configs to service_role;
grant update(revoked_at) on public.cockpit_webinar_link_refs to service_role;
