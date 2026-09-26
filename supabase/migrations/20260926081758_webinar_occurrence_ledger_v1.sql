-- Stable planned-event and registration identities. The public registration API
-- must call these service-only functions with provider receipts before cutover.
-- No historical events are inferred from mutable CRM tags.
create table public.cockpit_webinar_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check(length(btrim(event_key)) between 1 and 200),
  target_snapshot jsonb not null check(public.cockpit_webinar_targets_valid(target_snapshot)),
  created_at timestamptz not null default clock_timestamp()
);
create table public.cockpit_webinar_event_versions (
  event_id uuid not null references public.cockpit_webinar_events(id),
  revision integer not null check(revision>0),
  scheduled_at timestamptz,
  timezone text not null,
  title text not null check(length(btrim(title)) between 1 and 200),
  changed_by text not null check(length(btrim(changed_by)) between 1 and 200),
  changed_at timestamptz not null default clock_timestamp(),
  request_id uuid not null unique,
  primary key(event_id,revision)
);
create table public.cockpit_webinar_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.cockpit_webinar_events(id),
  event_revision integer not null,
  location_id text not null check(length(btrim(location_id)) between 1 and 200),
  contact_id text not null check(length(btrim(contact_id)) between 1 and 200),
  registered_at timestamptz not null,
  attribution jsonb not null default '{}' check(jsonb_typeof(attribution)='object' and octet_length(attribution::text)<=8192),
  created_at timestamptz not null default clock_timestamp(),
  unique(event_id,location_id,contact_id),
  foreign key(event_id,event_revision) references public.cockpit_webinar_event_versions(event_id,revision)
);
create table public.cockpit_webinar_registration_receipts (
  source text not null check(length(btrim(source)) between 1 and 100),
  source_id text not null check(length(btrim(source_id)) between 1 and 200),
  registration_id uuid not null references public.cockpit_webinar_registrations(id),
  request jsonb not null,
  received_at timestamptz not null default clock_timestamp(),
  primary key(source,source_id)
);
create index cockpit_webinar_registration_contact on public.cockpit_webinar_registrations(location_id,contact_id,registered_at);
create index cockpit_webinar_receipt_registration on public.cockpit_webinar_registration_receipts(registration_id);
create table public.cockpit_webinar_event_sessions (
  session_uuid text primary key references public.cockpit_webinar_sessions(uuid),
  event_id uuid not null references public.cockpit_webinar_events(id),
  evidence text not null check(length(btrim(evidence)) between 1 and 500),
  bound_by text not null check(length(btrim(bound_by)) between 1 and 200),
  bound_at timestamptz not null default clock_timestamp()
);
create index cockpit_webinar_event_sessions_event on public.cockpit_webinar_event_sessions(event_id);

do $$ declare t text; begin
  foreach t in array array['cockpit_webinar_events','cockpit_webinar_event_versions','cockpit_webinar_registrations','cockpit_webinar_registration_receipts','cockpit_webinar_event_sessions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select,insert on public.%I to service_role',t);
  end loop;
end $$;

create function public.cockpit_save_webinar_event(p_key text,p_expected integer,p_at timestamptz,p_zone text,p_title text,p_targets jsonb,p_by text,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare eid uuid; saved public.cockpit_webinar_event_versions; rev integer;
begin
  if p_request is null or p_expected is null or p_expected<0 or p_key is null
    or p_zone is null or not exists(select 1 from pg_timezone_names where name=p_zone)
    or p_title is null or p_by is null then raise exception 'Invalid webinar event'; end if;
  perform pg_advisory_xact_lock(hashtextextended('webinar-event:'||p_key,0));
  select id into eid from public.cockpit_webinar_events where event_key=p_key;
  select * into saved from public.cockpit_webinar_event_versions where request_id=p_request;
  if found then
    if saved.event_id is distinct from eid or saved.revision<>p_expected+1 or saved.scheduled_at is distinct from p_at
      or saved.timezone<>p_zone or saved.title<>p_title or saved.changed_by<>p_by then raise exception 'Event request reused'; end if;
    return jsonb_build_object('status','saved','event_id',eid,'revision',saved.revision);
  end if;
  select coalesce(max(revision),0) into rev from public.cockpit_webinar_event_versions where event_id=eid;
  if rev<>p_expected then return jsonb_build_object('status','conflict'); end if;
  if eid is null then
    insert into public.cockpit_webinar_events(event_key,target_snapshot) values(p_key,p_targets) returning id into eid;
  end if;
  insert into public.cockpit_webinar_event_versions(event_id,revision,scheduled_at,timezone,title,changed_by,request_id)
    values(eid,rev+1,p_at,p_zone,p_title,p_by,p_request);
  return jsonb_build_object('status','saved','event_id',eid,'revision',rev+1);
end $$;

create function public.cockpit_record_webinar_registration(p_event uuid,p_revision integer,p_location text,p_contact text,p_at timestamptz,p_attribution jsonb,p_source text,p_source_id text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare rid uuid; old_request jsonb; request jsonb;
begin
  if p_at is null or p_event is null or p_revision is null or p_source is null or p_source_id is null
     or p_location is null or p_contact is null or p_attribution is null then raise exception 'Missing registration receipt'; end if;
  if not exists(select 1 from public.cockpit_webinar_event_versions where event_id=p_event and revision=p_revision)
    or jsonb_typeof(p_attribution) is distinct from 'object' or octet_length(p_attribution::text)>8192
    then raise exception 'Invalid registration event or attribution'; end if;
  request:=jsonb_build_object('event',p_event,'revision',p_revision,'location',p_location,'contact',p_contact,'at',p_at,'attribution',p_attribution);
  perform pg_advisory_xact_lock(hashtextextended('webinar-receipt:'||p_source||':'||p_source_id,0));
  select registration_id,r.request into rid,old_request from public.cockpit_webinar_registration_receipts r where source=p_source and source_id=p_source_id;
  if found then
    if old_request<>request then raise exception 'Registration receipt reused with different contents'; end if;
    return rid;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('webinar-registration:'||p_event||':'||p_location||':'||p_contact,0));
  select id into rid from public.cockpit_webinar_registrations where event_id=p_event and location_id=p_location and contact_id=p_contact;
  if rid is null then
    insert into public.cockpit_webinar_registrations(event_id,event_revision,location_id,contact_id,registered_at,attribution)
      values(p_event,p_revision,p_location,p_contact,p_at,p_attribution) returning id into rid;
  end if;
  insert into public.cockpit_webinar_registration_receipts(source,source_id,registration_id,request) values(p_source,p_source_id,rid,request);
  return rid;
end $$;
revoke all on function public.cockpit_save_webinar_event(text,integer,timestamptz,text,text,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.cockpit_record_webinar_registration(uuid,integer,text,text,timestamptz,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.cockpit_save_webinar_event(text,integer,timestamptz,text,text,jsonb,text,uuid) to service_role;
grant execute on function public.cockpit_record_webinar_registration(uuid,integer,text,text,timestamptz,jsonb,text,text) to service_role;
