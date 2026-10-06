-- Durable, service-only receipt boundary. No triggers call external providers.
-- Preparing a schedule does not open registration or enable a worker.
create table public.cockpit_webinar_event_configs (
  event_id uuid not null,
  revision integer not null,
  location_id text not null check(length(location_id) between 1 and 200),
  calendar_id text not null check(length(calendar_id) between 1 and 200),
  meeting_id text not null check(length(meeting_id) between 1 and 200),
  config_sha256 text not null check(config_sha256 ~ '^[a-f0-9]{64}$'),
  registration_open boolean not null default false,
  duration_minutes integer not null default 90 check(duration_minutes between 1 and 600),
  primary key(event_id,revision),
  foreign key(event_id,revision) references public.cockpit_webinar_event_versions(event_id,revision)
);

create table public.cockpit_webinar_intakes (
  id uuid primary key default gen_random_uuid(),
  source text not null check(source in ('web','ghl')),
  source_id text not null check(length(source_id) between 1 and 200),
  event_id uuid not null,
  event_revision integer not null,
  location_id text not null,
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=16384),
  registered_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  unique(source,source_id),
  foreign key(event_id,event_revision) references public.cockpit_webinar_event_configs(event_id,revision)
);
create index cockpit_webinar_intakes_event on public.cockpit_webinar_intakes(event_id,received_at);
create table public.cockpit_webinar_intake_bindings (
  intake_id uuid primary key references public.cockpit_webinar_intakes(id),
  registration_id uuid not null references public.cockpit_webinar_registrations(id),
  evidence jsonb not null check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=4096),
  bound_at timestamptz not null default clock_timestamp()
);
create index cockpit_webinar_intake_bindings_registration on public.cockpit_webinar_intake_bindings(registration_id);

create table public.cockpit_webinar_jobs (
  id uuid primary key default gen_random_uuid(),
  dedup_key text not null unique check(length(dedup_key) between 1 and 300),
  kind text not null check(kind in ('resolve_registration','zoom_registrant','training_appointment')),
  intake_id uuid not null references public.cockpit_webinar_intakes(id),
  registration_id uuid references public.cockpit_webinar_registrations(id),
  state text not null default 'ready' check(state in ('ready','running','retry','uncertain','blocked','succeeded')),
  attempts integer not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  mutation_started_at timestamptz,
  code text check(code ~ '^[a-z0-9_]{1,100}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index cockpit_webinar_jobs_due on public.cockpit_webinar_jobs(available_at,created_at) where state in ('ready','retry');
create index cockpit_webinar_jobs_intake on public.cockpit_webinar_jobs(intake_id);
create index cockpit_webinar_jobs_registration on public.cockpit_webinar_jobs(registration_id);
create table public.cockpit_webinar_job_attempts (
  job_id uuid not null references public.cockpit_webinar_jobs(id),
  attempt integer not null,
  lease_token uuid not null unique,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  outcome text,
  code text,
  primary key(job_id,attempt)
);
create table public.cockpit_webinar_provider_receipts (
  job_id uuid primary key references public.cockpit_webinar_jobs(id),
  provider text not null check(provider in ('ghl','zoom')),
  resource_id text not null check(length(resource_id) between 1 and 300),
  scope text not null check(length(scope) between 1 and 300),
  receipt jsonb not null check(jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=8192),
  received_at timestamptz not null default clock_timestamp(),
  unique(provider,scope,resource_id)
);
-- Unique private join links and Zoom registrant IDs must never reach the public dashboard payload.
create table public.cockpit_webinar_zoom_registrants (
  registration_id uuid primary key references public.cockpit_webinar_registrations(id),
  meeting_id text not null,
  registrant_id text not null,
  join_url text not null check(length(join_url)<=4096 and join_url ~ '^https://([a-z0-9-]+\.)?zoom\.us/'),
  job_id uuid not null unique references public.cockpit_webinar_jobs(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(meeting_id,registrant_id)
);
create table public.cockpit_webinar_link_refs (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  registration_id uuid not null references public.cockpit_webinar_registrations(id),
  purpose text not null check(purpose in ('survey','join','pitch1','pitch2')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index cockpit_webinar_link_refs_registration on public.cockpit_webinar_link_refs(registration_id);
create table public.cockpit_webinar_survey_receipts (
  form_id text not null,
  response_id text not null,
  submitted_at timestamptz not null,
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=262144),
  registration_id uuid references public.cockpit_webinar_registrations(id),
  match_status text not null check(match_status in ('scoped_reference','missing_reference','invalid_reference')),
  received_at timestamptz not null default clock_timestamp(),
  primary key(form_id,response_id)
);
create index cockpit_webinar_survey_receipts_registration on public.cockpit_webinar_survey_receipts(registration_id);

create function public.cockpit_accept_webinar_intake(p_source text,p_source_id text,p_key text,p_revision integer,p_location text,p_config text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare eid uuid; previous public.cockpit_webinar_intakes; intake uuid; at_time timestamptz; conf public.cockpit_webinar_event_configs;
begin
  if p_source is null or p_source_id is null or p_key is null or p_revision is null or p_location is null
    or p_config is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid intake'; end if;
  select id into eid from public.cockpit_webinar_events where event_key=p_key;
  perform pg_advisory_xact_lock(hashtextextended('webinar-intake:'||p_source||':'||p_source_id,0));
  select * into previous from public.cockpit_webinar_intakes where source=p_source and source_id=p_source_id;
  if found then
    if previous.event_id is distinct from eid or previous.event_revision<>p_revision or previous.location_id<>p_location
      or previous.payload<>p_payload then raise exception 'Intake receipt reused'; end if;
    return jsonb_build_object('status','accepted','intake_id',previous.id,'replayed',true);
  end if;
  select * into conf from public.cockpit_webinar_event_configs where event_id=eid and revision=p_revision;
  if not found or not conf.registration_open or conf.location_id<>p_location or conf.config_sha256<>p_config
    or p_revision<>(select max(revision) from public.cockpit_webinar_event_versions where event_id=eid)
    or not exists(select 1 from public.cockpit_webinar_event_versions where event_id=eid and revision=p_revision and scheduled_at>clock_timestamp())
    then raise exception 'Registration closed or configuration changed'; end if;
  if p_source='web' and p_payload ? 'contact_id' then raise exception 'Untrusted contact identity'; end if;
  if p_source='ghl' and coalesce(p_payload->>'contact_id','')='' then raise exception 'Missing scoped contact'; end if;
  at_time:=case when p_source='ghl' then (p_payload->>'submitted_at')::timestamptz else clock_timestamp() end;
  if at_time is null or at_time>clock_timestamp()+interval '2 minutes' or at_time<clock_timestamp()-interval '90 days'
    then raise exception 'Invalid registration time'; end if;
  insert into public.cockpit_webinar_intakes(source,source_id,event_id,event_revision,location_id,payload,registered_at)
    values(p_source,p_source_id,eid,p_revision,p_location,p_payload,at_time) returning id into intake;
  insert into public.cockpit_webinar_jobs(dedup_key,kind,intake_id)
    values('intake:'||intake,'resolve_registration',intake);
  return jsonb_build_object('status','accepted','intake_id',intake,'replayed',false);
end $$;

-- A lost worker may only be retried automatically BEFORE an external mutation.
create function public.cockpit_claim_webinar_job(p_kinds text[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.cockpit_webinar_jobs; token uuid:=gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended('webinar-job-claim',0));
  with expired as (
    update public.cockpit_webinar_jobs set state=case when mutation_started_at is not null then 'uncertain' when attempts>=5 then 'blocked' else 'retry' end,
      code='lease_expired',lease_until=null,updated_at=clock_timestamp()
      where state='running' and lease_until<clock_timestamp() returning id,attempts,state
  ) update public.cockpit_webinar_job_attempts a set finished_at=clock_timestamp(),outcome=e.state,code='lease_expired'
      from expired e where a.job_id=e.id and a.attempt=e.attempts;
  select q.* into j from public.cockpit_webinar_jobs q where q.kind=any(p_kinds) and q.state in ('ready','retry')
    and q.available_at<=clock_timestamp() and q.attempts<5
    and (q.kind<>'training_appointment' or exists(select 1 from public.cockpit_webinar_jobs prerequisite
      where prerequisite.registration_id=q.registration_id and prerequisite.kind='zoom_registrant' and prerequisite.state='succeeded'))
    and (q.kind<>'resolve_registration' or not exists (
      select 1 from public.cockpit_webinar_jobs busy
      join public.cockpit_webinar_intakes bi on bi.id=busy.intake_id
      join public.cockpit_webinar_intakes qi on qi.id=q.intake_id
      where busy.id<>q.id and busy.kind='resolve_registration' and busy.state in ('running','uncertain')
        and bi.location_id=qi.location_id and (
          bi.payload->>'email'=qi.payload->>'email' or bi.payload->>'phone'=qi.payload->>'phone'
          or bi.payload->>'contact_id'=qi.payload->>'contact_id')))
    order by q.available_at,q.created_at for update of q skip locked limit 1;
  if not found then return null; end if;
  update public.cockpit_webinar_jobs set state='running',attempts=attempts+1,lease_token=token,
    lease_until=clock_timestamp()+interval '2 minutes',mutation_started_at=null,updated_at=clock_timestamp() where id=j.id returning * into j;
  insert into public.cockpit_webinar_job_attempts(job_id,attempt,lease_token) values(j.id,j.attempts,token);
  return to_jsonb(j);
end $$;

create function public.cockpit_mark_webinar_mutation(p_job uuid,p_lease uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  update public.cockpit_webinar_jobs set mutation_started_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_job and lease_token=p_lease and state='running' and lease_until>clock_timestamp() and mutation_started_at is null;
  if not found then raise exception 'Lease lost or mutation already started'; end if;
end $$;

create function public.cockpit_finish_webinar_job(p_job uuid,p_lease uuid,p_state text,p_code text,p_receipt jsonb default null)
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
  if p_state='retry' and j.mutation_started_at is not null then result_state:='uncertain'; end if;
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

create function public.cockpit_bind_webinar_intake(p_job uuid,p_lease uuid,p_contact text,p_evidence jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.cockpit_webinar_jobs; i public.cockpit_webinar_intakes; rid uuid; old public.cockpit_webinar_intake_bindings;
begin
  select * into j from public.cockpit_webinar_jobs where id=p_job for update;
  select * into i from public.cockpit_webinar_intakes where id=j.intake_id;
  select * into old from public.cockpit_webinar_intake_bindings where intake_id=i.id;
  if found then
    if j.lease_token is distinct from p_lease or old.evidence<>p_evidence or not exists(select 1 from public.cockpit_webinar_registrations where id=old.registration_id and contact_id=p_contact)
      then raise exception 'Binding reused'; end if;
    return old.registration_id;
  end if;
  if j.kind is distinct from 'resolve_registration' or j.state<>'running' or j.lease_token is distinct from p_lease or j.lease_until<=clock_timestamp()
    then raise exception 'Lease lost'; end if;
  if p_evidence->>'location_id' is distinct from i.location_id or p_evidence->>'contact_id' is distinct from p_contact
    or p_evidence->>'method' not in ('scoped_contact_read','exact_email_and_phone','created_contact')
    or p_evidence->>'method' is null or (i.source='ghl' and i.payload->>'contact_id' is distinct from p_contact)
    then raise exception 'Contact scope mismatch'; end if;
  rid:=public.cockpit_record_webinar_registration(i.event_id,i.event_revision,i.location_id,p_contact,i.registered_at,
    coalesce(i.payload->'attribution','{}'),i.source,i.source_id);
  insert into public.cockpit_webinar_intake_bindings(intake_id,registration_id,evidence) values(i.id,rid,p_evidence);
  insert into public.cockpit_webinar_jobs(dedup_key,kind,intake_id,registration_id)
    values(rid||':zoom','zoom_registrant',i.id,rid),(rid||':appointment','training_appointment',i.id,rid)
    on conflict(dedup_key) do nothing;
  update public.cockpit_webinar_jobs set state='succeeded',registration_id=rid,lease_until=null,updated_at=clock_timestamp(),code='registration_bound' where id=j.id;
  update public.cockpit_webinar_job_attempts set finished_at=clock_timestamp(),outcome='succeeded',code='registration_bound' where job_id=j.id and attempt=j.attempts;
  return rid;
end $$;

create function public.cockpit_accept_webinar_survey(p_form text,p_response text,p_at timestamptz,p_payload jsonb,p_ref_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.cockpit_webinar_survey_receipts; rid uuid; matched text;
begin
  if p_form is distinct from 'P1xP4r24' or p_response is null or length(p_response) not between 1 and 200 or p_at is null
    or p_at>clock_timestamp()+interval '2 minutes' or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid survey receipt'; end if;
  perform pg_advisory_xact_lock(hashtextextended('webinar-survey:'||p_form||':'||p_response,0));
  select * into previous from public.cockpit_webinar_survey_receipts where form_id=p_form and response_id=p_response;
  if found then
    if previous.payload<>p_payload or previous.submitted_at<>p_at then raise exception 'Survey receipt reused'; end if;
    return jsonb_build_object('status','accepted','replayed',true);
  end if;
  select registration_id into rid from public.cockpit_webinar_link_refs where token_hash=p_ref_hash and purpose='survey'
    and revoked_at is null and expires_at>p_at and created_at<=p_at;
  matched:=case when rid is not null then 'scoped_reference' when p_ref_hash is null then 'missing_reference' else 'invalid_reference' end;
  insert into public.cockpit_webinar_survey_receipts(form_id,response_id,submitted_at,payload,registration_id,match_status)
    values(p_form,p_response,p_at,p_payload,rid,matched);
  return jsonb_build_object('status','accepted','replayed',false);
end $$;

do $$ declare t text; f record; begin
  foreach t in array array['cockpit_webinar_event_configs','cockpit_webinar_intakes','cockpit_webinar_intake_bindings','cockpit_webinar_jobs','cockpit_webinar_job_attempts','cockpit_webinar_provider_receipts','cockpit_webinar_zoom_registrants','cockpit_webinar_link_refs','cockpit_webinar_survey_receipts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select,insert on public.%I to service_role',t);
  end loop;
  grant update on public.cockpit_webinar_jobs,public.cockpit_webinar_job_attempts,public.cockpit_webinar_link_refs,public.cockpit_webinar_event_configs to service_role;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
    ('cockpit_accept_webinar_intake','cockpit_claim_webinar_job','cockpit_mark_webinar_mutation','cockpit_finish_webinar_job','cockpit_bind_webinar_intake','cockpit_accept_webinar_survey') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
