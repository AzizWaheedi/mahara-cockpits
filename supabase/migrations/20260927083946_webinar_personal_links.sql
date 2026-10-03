-- Service-only personalized links. Link possession is attribution, not verified identity.
alter table public.cockpit_webinar_link_refs add column event_revision integer;
update public.cockpit_webinar_link_refs l set event_revision=r.event_revision
  from public.cockpit_webinar_registrations r where r.id=l.registration_id;
alter table public.cockpit_webinar_link_refs alter column event_revision set not null;
alter table public.cockpit_webinar_link_refs add constraint webinar_link_revision_positive check(event_revision>0);
create unique index cockpit_webinar_intake_status_hash on public.cockpit_webinar_intakes((payload->>'status_hash'))
  where source='web' and payload ? 'status_hash';

create table public.cockpit_webinar_link_audit (
  request_id uuid primary key,
  token_hash text not null references public.cockpit_webinar_link_refs(token_hash),
  action text not null check(action in ('issued','revoked')),
  actor text not null check(length(btrim(actor)) between 1 and 100),
  recorded_at timestamptz not null default clock_timestamp()
);
create index cockpit_webinar_link_audit_token on public.cockpit_webinar_link_audit(token_hash);
alter table public.cockpit_webinar_link_audit enable row level security;
revoke all on public.cockpit_webinar_link_audit from public,anon,authenticated,service_role;
grant select,insert on public.cockpit_webinar_link_audit to service_role;

-- Prepare an exact repository revision atomically, CLOSED by default. Replays
-- cannot rewrite scope or reopen an earlier occurrence; reschedules hold old work.
create function public.cockpit_prepare_webinar_event(p_key text,p_revision integer,p_at timestamptz,p_zone text,p_title text,
  p_targets jsonb,p_by text,p_request uuid,p_location text,p_calendar text,p_meeting text,p_hash text,p_minutes integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare eid uuid; v public.cockpit_webinar_event_versions; c public.cockpit_webinar_event_configs; saved jsonb;
begin
  if p_revision is null or p_revision<1 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
    or coalesce(p_location,'')='' or coalesce(p_calendar,'')='' or coalesce(p_meeting,'')=''
    or p_minutes is null or p_minutes not between 1 and 600 then raise exception 'Invalid event configuration'; end if;
  perform pg_advisory_xact_lock(hashtextextended('webinar-event:'||p_key,0));
  select id into eid from public.cockpit_webinar_events where event_key=p_key;
  select * into v from public.cockpit_webinar_event_versions where event_id=eid and revision=p_revision;
  if found then
    if v.scheduled_at is distinct from p_at or v.timezone is distinct from p_zone or v.title is distinct from p_title
      then raise exception 'Event revision reused'; end if;
  else
    saved:=public.cockpit_save_webinar_event(p_key,p_revision-1,p_at,p_zone,p_title,p_targets,p_by,p_request);
    if saved->>'status'<>'saved' then raise exception 'Event revision conflict'; end if;
    eid:=(saved->>'event_id')::uuid;
  end if;
  select * into c from public.cockpit_webinar_event_configs where event_id=eid and revision=p_revision;
  if found then
    if c.location_id<>p_location or c.calendar_id<>p_calendar or c.meeting_id<>p_meeting or c.config_sha256<>p_hash or c.duration_minutes<>p_minutes
      then raise exception 'Event configuration reused'; end if;
  else
    insert into public.cockpit_webinar_event_configs(event_id,revision,location_id,calendar_id,meeting_id,config_sha256,duration_minutes)
      values(eid,p_revision,p_location,p_calendar,p_meeting,p_hash,p_minutes);
  end if;
  update public.cockpit_webinar_event_configs set registration_open=false
    where event_id=eid and revision<(select max(revision) from public.cockpit_webinar_event_versions where event_id=eid);
  return jsonb_build_object('event_id',eid,'revision',p_revision,'registration_open',
    (select registration_open from public.cockpit_webinar_event_configs where event_id=eid and revision=p_revision));
end $$;

create function public.cockpit_webinar_registration_state(p_registration uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r public.cockpit_webinar_registrations; v public.cockpit_webinar_event_versions; state text; n integer;
begin
  select * into r from public.cockpit_webinar_registrations where id=p_registration;
  if not found then return null; end if;
  select * into v from public.cockpit_webinar_event_versions where event_id=r.event_id order by revision desc limit 1;
  if r.event_revision<>v.revision then state:='schedule_changed';
  elsif exists(select 1 from public.cockpit_webinar_jobs q where q.registration_id=r.id and q.state in ('blocked','uncertain')) then state:='needs_review';
  else
    select count(distinct j.kind) into n from public.cockpit_webinar_jobs j
      join public.cockpit_webinar_provider_receipts p on p.job_id=j.id
      join public.cockpit_webinar_intakes i on i.id=j.intake_id
      where j.registration_id=r.id and j.state='succeeded' and j.kind in ('zoom_registrant','training_appointment')
        and i.event_id=r.event_id and i.event_revision=v.revision;
    state:=case when n=2 and exists(select 1 from public.cockpit_webinar_zoom_registrants where registration_id=r.id) then 'confirmed' else 'processing' end;
  end if;
  return jsonb_build_object('status',state,'registration_id',r.id,'event_id',r.event_id,'revision',v.revision,
    'starts_at',v.scheduled_at,'timezone',v.timezone,'title',v.title);
end $$;

create function public.cockpit_webinar_intake_status(p_hash text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare i public.cockpit_webinar_intakes; rid uuid;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  select * into i from public.cockpit_webinar_intakes where source='web' and payload->>'status_hash'=p_hash;
  if not found then return null; end if;
  select registration_id into rid from public.cockpit_webinar_intake_bindings where intake_id=i.id;
  if rid is not null then return public.cockpit_webinar_registration_state(rid); end if;
  return jsonb_build_object('status',case when exists(select 1 from public.cockpit_webinar_jobs
    where intake_id=i.id and state in ('blocked','uncertain')) then 'needs_review' else 'processing' end);
end $$;

create function public.cockpit_issue_webinar_link(p_registration uuid,p_revision integer,p_purpose text,p_hash text,p_request uuid,p_by text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare state jsonb; expiry timestamptz; old public.cockpit_webinar_link_refs; audit public.cockpit_webinar_link_audit;
begin
  if p_purpose is null or p_purpose not in ('survey','join') or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
    or p_request is null or p_by is null then raise exception 'Invalid link'; end if;
  state:=public.cockpit_webinar_registration_state(p_registration);
  if state is null or state->>'status'<>'confirmed' or (state->>'revision')::integer is distinct from p_revision
    then raise exception 'Registration not confirmed'; end if;
  select (state->>'starts_at')::timestamptz + make_interval(mins=>duration_minutes)
    + case when p_purpose='survey' then interval '7 days' else interval '1 day' end into expiry
    from public.cockpit_webinar_event_configs where event_id=(state->>'event_id')::uuid and revision=p_revision;
  if expiry is null or expiry<=clock_timestamp() then raise exception 'Link unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('webinar-link:'||p_hash,0));
  select * into old from public.cockpit_webinar_link_refs where token_hash=p_hash;
  if found then
    if old.registration_id<>p_registration or old.purpose<>p_purpose or old.event_revision<>p_revision or old.expires_at<>expiry
      then raise exception 'Link scope reused'; end if;
    if old.revoked_at is not null then raise exception 'Link unavailable'; end if;
  else
    insert into public.cockpit_webinar_link_refs(token_hash,registration_id,purpose,expires_at,event_revision)
      values(p_hash,p_registration,p_purpose,expiry,p_revision);
    insert into public.cockpit_webinar_link_audit(request_id,token_hash,action,actor) values(p_request,p_hash,'issued',p_by);
  end if;
  return jsonb_build_object('expires_at',expiry);
end $$;

create function public.cockpit_revoke_webinar_link(p_hash text,p_request uuid,p_by text)
returns void language plpgsql security invoker set search_path='' as $$
declare old public.cockpit_webinar_link_audit;
begin
  perform pg_advisory_xact_lock(hashtextextended('webinar-link:'||p_hash,0));
  select * into old from public.cockpit_webinar_link_audit where request_id=p_request;
  if found then
    if old.action<>'revoked' or old.token_hash is distinct from p_hash or old.actor is distinct from p_by then raise exception 'Link request reused'; end if;
    return;
  end if;
  update public.cockpit_webinar_link_refs set revoked_at=coalesce(revoked_at,clock_timestamp()) where token_hash=p_hash;
  if not found then raise exception 'Link unavailable'; end if;
  insert into public.cockpit_webinar_link_audit(request_id,token_hash,action,actor) values(p_request,p_hash,'revoked',p_by);
end $$;

create function public.cockpit_resolve_webinar_link(p_hash text,p_purpose text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare link public.cockpit_webinar_link_refs; state jsonb; target public.cockpit_webinar_zoom_registrants;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_purpose is null or p_purpose not in ('survey','join') then return null; end if;
  select * into link from public.cockpit_webinar_link_refs where token_hash=p_hash and purpose=p_purpose
    and revoked_at is null and expires_at>clock_timestamp();
  if not found then return null; end if;
  state:=public.cockpit_webinar_registration_state(link.registration_id);
  if state->>'status'<>'confirmed' or (state->>'revision')::integer<>link.event_revision then return null; end if;
  if p_purpose='join' then
    select * into target from public.cockpit_webinar_zoom_registrants where registration_id=link.registration_id;
    if not found then return null; end if;
    return jsonb_build_object('meeting_id',target.meeting_id,'join_url',target.join_url);
  end if;
  return jsonb_build_object('form_id','P1xP4r24');
end $$;

do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
    ('cockpit_prepare_webinar_event','cockpit_webinar_registration_state','cockpit_webinar_intake_status','cockpit_issue_webinar_link','cockpit_revoke_webinar_link','cockpit_resolve_webinar_link') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

-- The webhook and authenticated backfill contain different envelopes. Compare
-- only the same submitted answers, field IDs and hidden values; never persist a raw link token.
create function public.cockpit_normalize_webinar_survey(p_payload jsonb,p_ref_hash text)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('answers',coalesce((select jsonb_agg(
    (answer-'field') || jsonb_build_object('field',jsonb_build_object('id',answer->'field'->>'id')) order by ord)
    from jsonb_array_elements(coalesce(p_payload->'answers','[]'::jsonb)) with ordinality x(answer,ord)),'[]'::jsonb),
    'hidden',coalesce(p_payload->'hidden','{}'::jsonb)-'webinar_ref','reference_hash',p_ref_hash)
$$;
create or replace function public.cockpit_accept_webinar_survey(p_form text,p_response text,p_at timestamptz,p_payload jsonb,p_ref_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.cockpit_webinar_survey_receipts; rid uuid; matched text; canonical jsonb;
begin
  if p_form is distinct from 'P1xP4r24' or p_response is null or length(p_response) not between 1 and 200 or p_at is null
    or p_at>clock_timestamp()+interval '2 minutes' or jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload->'answers') is distinct from 'array' then raise exception 'Invalid survey receipt'; end if;
  canonical:=public.cockpit_normalize_webinar_survey(p_payload,p_ref_hash);
  perform pg_advisory_xact_lock(hashtextextended('webinar-survey:'||p_form||':'||p_response,0));
  select * into previous from public.cockpit_webinar_survey_receipts where form_id=p_form and response_id=p_response;
  if found then
    if public.cockpit_normalize_webinar_survey(previous.payload,previous.payload->>'reference_hash')<>canonical
      or previous.submitted_at<>p_at then raise exception 'Survey receipt reused'; end if;
    return jsonb_build_object('status','accepted','replayed',true);
  end if;
  select registration_id into rid from public.cockpit_webinar_link_refs where token_hash=p_ref_hash and purpose='survey'
    and (revoked_at is null or revoked_at>p_at) and expires_at>p_at and created_at<=p_at;
  matched:=case when rid is not null then 'scoped_reference' when p_ref_hash is null then 'missing_reference' else 'invalid_reference' end;
  insert into public.cockpit_webinar_survey_receipts(form_id,response_id,submitted_at,payload,registration_id,match_status)
    values(p_form,p_response,p_at,canonical,rid,matched);
  return jsonb_build_object('status','accepted','replayed',false);
end $$;
revoke all on function public.cockpit_normalize_webinar_survey(jsonb,text) from public,anon,authenticated;
grant execute on function public.cockpit_normalize_webinar_survey(jsonb,text) to service_role;

-- These are exact-evidence projections. They intentionally do not change the
-- production dashboard's legacy cohorts until that consumer is migrated.
create view public.cockpit_webinar_survey_matches with (security_invoker=true) as
  select s.form_id,s.response_id,s.submitted_at,s.registration_id,r.event_id,r.location_id,r.contact_id,
    s.match_status,f.profit_band,f.profit_min,f.years_band,f.work_type,f.blocker,f.goal_band,f.success,
    (f.response_id is not null) as details_collected
  from public.cockpit_webinar_survey_receipts s
  left join public.cockpit_webinar_registrations r on r.id=s.registration_id
  left join public.cockpit_webinar_forms f on f.form_id=s.form_id and f.response_id=s.response_id;
create view public.cockpit_webinar_attendance_matches with (security_invoker=true) as
  select a.session_uuid,a.row_key,a.join_at,a.leave_at,a.status,a.internal,bs.event_id,
    case when not a.internal and a.status='in_meeting' then r.id end as registration_id,
    case when a.internal then 'excluded_internal' when a.status<>'in_meeting' then 'excluded_status'
      when bs.event_id is null then 'unbound_session' when a.registrant_id is null then 'missing_registrant'
      when r.id is null then 'unmatched_registrant' else 'exact_registrant_and_session' end as match_status
  from public.cockpit_webinar_attendance a
  join public.cockpit_webinar_sessions s on s.uuid=a.session_uuid
  left join public.cockpit_webinar_event_sessions bs on bs.session_uuid=s.uuid
  left join public.cockpit_webinar_zoom_registrants z on z.meeting_id=s.meeting_id and z.registrant_id=a.registrant_id
  left join public.cockpit_webinar_registrations r on r.id=z.registration_id and r.event_id=bs.event_id;
revoke all on public.cockpit_webinar_survey_matches,public.cockpit_webinar_attendance_matches from public,anon,authenticated,service_role;
grant select on public.cockpit_webinar_survey_matches,public.cockpit_webinar_attendance_matches to service_role;
