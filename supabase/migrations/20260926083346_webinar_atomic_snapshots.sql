-- Atomic per-instance snapshots. Partial source failures preserve the last readable
-- channel; receipt payloads make replacement reversible and auditable.
alter table public.cockpit_webinar_sessions add column coverage jsonb;
create table public.cockpit_webinar_snapshots (
  session_uuid text not null references public.cockpit_webinar_sessions(uuid),
  pulled_at timestamptz not null,
  checksum text not null,
  payload jsonb not null,
  received_at timestamptz not null default clock_timestamp(),
  primary key(session_uuid,pulled_at)
);
alter table public.cockpit_webinar_snapshots enable row level security;
revoke all on public.cockpit_webinar_snapshots from public,anon,authenticated,service_role;
grant select,insert on public.cockpit_webinar_snapshots to service_role;
-- Preserve the current projection before any collector replaces it.
insert into public.cockpit_webinar_snapshots(session_uuid,pulled_at,checksum,payload)
select s.uuid,coalesce(s.pulled_at,s.created_at),md5(x.payload::text),x.payload
from public.cockpit_webinar_sessions s cross join lateral (
 select jsonb_build_object('session',to_jsonb(s),'attendance',coalesce((select jsonb_agg(to_jsonb(a)) from public.cockpit_webinar_attendance a where a.session_uuid=s.uuid),'[]'::jsonb),
 'engagement',coalesce((select jsonb_agg(to_jsonb(e)) from public.cockpit_webinar_engagement e where e.session_uuid=s.uuid),'[]'::jsonb),'legacy_backup',true) payload
) x;
create function public.cockpit_ingest_webinar_snapshot(p_session jsonb,p_attendance jsonb,p_engagement jsonb,p_coverage jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid text; pulled timestamptz; prior text; payload jsonb; checksum text;
begin
  if jsonb_typeof(p_session) is distinct from 'object' or jsonb_typeof(p_attendance) is distinct from 'array'
    or jsonb_typeof(p_engagement) is distinct from 'array' or jsonb_typeof(p_coverage) is distinct from 'object'
    or p_coverage->>'attendance' is distinct from 'complete' then raise exception 'Invalid snapshot'; end if;
  uid:=p_session->>'uuid'; pulled:=(p_session->>'pulled_at')::timestamptz;
  if uid is null or length(uid)=0 or pulled is null or p_session->>'started_at' is null
    or p_session->>'meeting_id' is null then raise exception 'Missing snapshot identity'; end if;
  if exists(select 1 from jsonb_array_elements(p_attendance) r where r->>'session_uuid' is distinct from uid)
    or exists(select 1 from jsonb_array_elements(p_engagement) r where r->>'session_uuid' is distinct from uid or r->>'kind' not in ('chat','poll','qa'))
    then raise exception 'Cross-instance snapshot row'; end if;
  if (select count(*) from jsonb_object_keys(p_coverage)) <> 4 or exists(
    select 1 from jsonb_each_text(p_coverage) c where c.key not in ('attendance','chat','poll','qa') or (c.value is null or c.value not in ('complete','pending','unavailable','error')))
    then raise exception 'Invalid source coverage'; end if;
  perform pg_advisory_xact_lock(hashtextextended('webinar-snapshot:'||uid,0));
  payload:=jsonb_build_object('session',p_session,'attendance',p_attendance,'engagement',p_engagement,'coverage',p_coverage);
  checksum:=md5(payload::text);
  select s.checksum into prior from public.cockpit_webinar_snapshots s where s.session_uuid=uid and s.pulled_at=pulled;
  if found then
    if prior <> checksum then raise exception 'Snapshot identity reused with different contents'; end if;
    return jsonb_build_object('status','replayed');
  end if;
  if exists(select 1 from public.cockpit_webinar_sessions s where s.uuid=uid and s.pulled_at>pulled) then
    return jsonb_build_object('status','stale'); end if;
  insert into public.cockpit_webinar_sessions(uuid,meeting_id,topic,started_at,ended_at,duration_min,host_email,recording_files,complete,pulled_at,coverage)
  select uid,p_session->>'meeting_id',p_session->>'topic',(p_session->>'started_at')::timestamptz,
    (p_session->>'ended_at')::timestamptz,(p_session->>'duration_min')::integer,p_session->>'host_email',
    array(select jsonb_array_elements_text(p_session->'recording_files')),
    (p_session->>'ended_at') is not null and not exists(select 1 from jsonb_each_text(p_coverage) where value is distinct from 'complete'),pulled,p_coverage
  on conflict(uuid) do update set topic=excluded.topic,started_at=excluded.started_at,ended_at=excluded.ended_at,
    duration_min=excluded.duration_min,host_email=excluded.host_email,recording_files=excluded.recording_files,
    complete=excluded.complete,pulled_at=excluded.pulled_at,coverage=excluded.coverage;
  insert into public.cockpit_webinar_snapshots(session_uuid,pulled_at,checksum,payload) values(uid,pulled,checksum,payload);
  delete from public.cockpit_webinar_attendance where session_uuid=uid;
  insert into public.cockpit_webinar_attendance(session_uuid,row_key,person_key,name,email,registrant_id,participant_id,zoom_user_id,contact_id,status,internal,join_at,leave_at,seconds,failover,pulled_at) select session_uuid,row_key,person_key,name,email,registrant_id,participant_id,zoom_user_id,contact_id,status,internal,join_at,leave_at,seconds,failover,pulled_at from jsonb_populate_recordset(null::public.cockpit_webinar_attendance,p_attendance);
  delete from public.cockpit_webinar_engagement e where e.session_uuid=uid and e.kind in ('chat','poll','qa') and p_coverage->>e.kind='complete';
  insert into public.cockpit_webinar_engagement(session_uuid,kind,row_key,at,offset_s,person_key,name,email,contact_id,pitch_number,body,payload,pulled_at) select r.session_uuid,r.kind,r.row_key,r.at,r.offset_s,r.person_key,r.name,r.email,r.contact_id,r.pitch_number,r.body,r.payload,r.pulled_at from jsonb_populate_recordset(null::public.cockpit_webinar_engagement,p_engagement) r where p_coverage->>r.kind='complete';
  update public.cockpit_webinar_sessions set
    participant_rows=(select count(*) from public.cockpit_webinar_attendance where session_uuid=uid),
    chat_rows=(select count(*) from public.cockpit_webinar_engagement where session_uuid=uid and kind='chat'),
    poll_rows=(select count(*) from public.cockpit_webinar_engagement where session_uuid=uid and kind='poll') where uuid=uid;
  return jsonb_build_object('status','saved','session_uuid',uid);
end $$;
revoke all on function public.cockpit_ingest_webinar_snapshot(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.cockpit_ingest_webinar_snapshot(jsonb,jsonb,jsonb,jsonb) to service_role;
