-- Restore missing existing team RPCs and their guard/audit dependencies.
-- Exact sources: 20261004b_team_native_security.sql, 20261004d_team_native_commands.sql.
-- Preserve team rows, policies, schedules and provider activation. No queue or heartbeat seeds.
BEGIN;
-- Bind team access to the confirmed email in the active directory seat.
create or replace function public.cockpit_has_active_seat()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cockpit_members cm
 join auth.users au on au.id=cm.auth_user_id
 where cm.auth_user_id=auth.uid() and cm.active is true
 and au.email_confirmed_at is not null
 and cm.email=lower(btrim(au.email)));
$$;
revoke all on function public.cockpit_has_active_seat() from public,anon;
grant execute on function public.cockpit_has_active_seat() to authenticated,service_role;
ALTER TABLE public.team_calendar_ops ADD COLUMN IF NOT EXISTS claim_token uuid,
 ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE public.team_calendar_ops DROP CONSTRAINT IF EXISTS team_calendar_ops_status_check;
ALTER TABLE public.team_calendar_ops ADD CONSTRAINT team_calendar_ops_status_check CHECK(status IN ('pending','running','done','failed'));
CREATE TABLE IF NOT EXISTS public.cockpit_team_calendar_worker (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),ready boolean NOT NULL,
 checked_at timestamptz NOT NULL,error text
);
ALTER TABLE public.cockpit_team_calendar_worker ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_team_calendar_worker FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.cockpit_team_calendar_worker TO service_role;
create or replace function public.cockpit_team_guard_write()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
 before_row jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 after_row jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 row_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 mid text; wid text; wheel public.team_wheels; actor text; boss boolean;
 trusted boolean := auth.role()='service_role' or current_setting('request.jwt.claims',true) is null or current_setting('request.jwt.claims',true)='';
 -- An unset flag is NULL. Treat it as false so direct writes stay guarded.
 command boolean := coalesce(current_setting('cockpit.team_command',true)='on',false);
begin
 mid := row_data->>'meeting_id';
 if tg_table_name='team_meetings' then mid:=row_data->>'id'; end if;
 if tg_table_name in ('team_wheel_options','team_wheel_spins') then
   wid:=row_data->>'wheel_id'; select * into wheel from public.team_wheels where id=wid; mid:=wheel.meeting_id;
 end if;
 select lower(email) into actor from auth.users where id=auth.uid();
 actor:=coalesce(actor,case when trusted then 'native team worker' else 'unknown' end);
 if not trusted then
   if not public.cockpit_has_active_seat() then raise exception 'An active verified cockpit seat is required'; end if;
   boss:=public.cockpit_is_ceo() or public.cockpit_has_role('admin');
   if tg_table_name in ('team_people','team_meeting_series','team_recordings','team_calendar_ops') and not command then
     raise exception 'Use the authorized team command';
   elsif tg_table_name='team_meetings' and not command then
     if tg_op<>'UPDATE' or (before_row-array['doc','doc_by','doc_at','doc_version','links']) is distinct from (after_row-array['doc','doc_by','doc_at','doc_version','links']) then
       raise exception 'Use the authorized meeting command';
     end if;
     if new.doc is distinct from old.doc then
       if new.doc_version<>old.doc_version+1 or length(new.doc)>400000 then raise exception 'Invalid document version or length'; end if;
       new.doc_by:=actor; new.doc_at:=now();
     end if;
     if jsonb_typeof(new.links)<>'array' or jsonb_array_length(new.links)>30 or exists(
       select 1 from jsonb_array_elements(new.links) x where coalesce(x->>'url','') !~ '^https?://' or length(x->>'url')>1000 or length(x->>'label')>80
     ) then raise exception 'Invalid meeting links'; end if;
   elsif tg_table_name='team_meeting_people' and not command then
     raise exception 'Use the authorized guest command';
   elsif tg_table_name='team_sittings' and not command then
     if tg_op<>'UPDATE' or (before_row-array['notes','notes_by','notes_at','notes_version','goal_hit']) is distinct from (after_row-array['notes','notes_by','notes_at','notes_version','goal_hit']) then
       raise exception 'Use the authorized sitting command';
     end if;
     if new.goal_hit is distinct from old.goal_hit and not public.cockpit_team_can_manage(mid) then raise exception 'Only meeting hosts or admins set the goal'; end if;
     if new.notes is distinct from old.notes then
       if new.notes_version<>old.notes_version+1 then raise exception 'Invalid notes version'; end if;
       new.notes_by:=actor; new.notes_at:=now();
     end if;
   elsif tg_table_name='team_wheels' then
     if (row_data->>'kind'='prize' or before_row->>'kind'='prize' or mid is null) and not boss then raise exception 'Only CEO and admins change prize wheels'; end if;
     if not boss and (not public.cockpit_team_can_manage(mid) or (tg_op='UPDATE' and not public.cockpit_team_can_manage(old.meeting_id))) then raise exception 'Only meeting hosts change wheels'; end if;
   elsif tg_table_name='team_wheel_options' then
     if wheel.kind='prize' and not boss then raise exception 'Only CEO and admins change prizes'; end if;
     if tg_op='UPDATE' and old.wheel_id<>new.wheel_id then raise exception 'An option cannot change wheels'; end if;
   elsif tg_table_name='team_wheel_spins' and not command then
     raise exception 'Use the server wheel draw';
   elsif tg_table_name='team_changes' then
     if tg_op<>'INSERT' then raise exception 'Team audit is immutable'; end if;
     new.by_whom:=actor; new.at:=now();
   end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.cockpit_team_audit_write()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; mid text; actor text;
begin
 mid:=case when tg_table_name='team_meetings' then r->>'id' else r->>'meeting_id' end;
 if tg_table_name in ('team_wheel_options','team_wheel_spins') then select meeting_id into mid from public.team_wheels where id=r->>'wheel_id'; end if;
 if not exists(select 1 from public.team_meetings where id=mid) then mid:=null; end if;
 select lower(email) into actor from auth.users where id=auth.uid();
 insert into public.team_changes(meeting_id,by_whom,what,detail)
 values(mid,coalesce(actor,'native team worker'),lower(tg_op)||' '||tg_table_name,
 jsonb_build_object('table',tg_table_name,'before',case when tg_op='INSERT' then null else to_jsonb(old) end,'after',case when tg_op='DELETE' then null else to_jsonb(new) end));
 return null;
end;
$$;

create or replace function public.cockpit_team_calendar_ready() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select public.cockpit_has_active_seat() and coalesce((select ready and checked_at>now()-interval '15 minutes' from public.cockpit_team_calendar_worker where singleton),false);
$$;

create or replace function public.cockpit_team_calendar_report(p_ready boolean,p_error text default null) returns void
language sql security definer set search_path=public,pg_temp as $$
 insert into public.cockpit_team_calendar_worker(singleton,ready,checked_at,error) values(true,p_ready,now(),p_error)
 on conflict(singleton) do update set ready=excluded.ready,checked_at=excluded.checked_at,error=excluded.error;
$$;

create or replace function public.cockpit_team_calendar_claim() returns setof public.team_calendar_ops
language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen bigint;
begin
 -- A crashed sender is uncertain, never silently raced by another sender.
 update public.team_calendar_ops set status='failed',error='Calendar worker lease expired. Reconcile Google receipts, then retry.',claim_token=null,lease_until=null where status='running' and lease_until<now();
 select o.id into chosen from public.team_calendar_ops o
 where o.status='pending' and o.attempts<10 and (o.tried_at is null or o.tried_at<now()-interval '90 seconds')
 and not exists(select 1 from public.team_calendar_ops earlier where earlier.meeting_id=o.meeting_id and earlier.id<o.id and earlier.status in ('pending','running','failed'))
 and not exists(select 1 from public.team_calendar_ops running where running.meeting_id=o.meeting_id and running.status='running')
 order by o.id for update skip locked limit 1;
 if chosen is null then return; end if;
 return query update public.team_calendar_ops set status='running',attempts=attempts+1,tried_at=now(),claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=chosen returning *;
end;
$$;

create or replace function public.cockpit_team_calendar_renew(p_id bigint,p_token uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.team_calendar_ops set lease_until=now()+interval '5 minutes' where id=p_id and claim_token=p_token and status='running' and lease_until>now();
 return found;
end;
$$;

create or replace function public.cockpit_team_calendar_finish(p_id bigint,p_token uuid,p_error text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare mid text;
begin
 update public.team_calendar_ops set status=case when p_error is null then 'done' when attempts>=10 then 'failed' else 'pending' end,
 error=p_error,done_at=case when p_error is null then now() else done_at end,claim_token=null,lease_until=null
 where id=p_id and claim_token=p_token and status='running' and lease_until>now() returning meeting_id into mid;
 if not found then return false; end if;
 update public.team_meetings set cal_error=p_error where id=mid;
 return true;
end;
$$;

create or replace function public.cockpit_team_ensure_sitting(p_meeting_id text,p_sitting_id text)
returns public.team_sittings language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.team_meetings; s public.team_sittings; day date; stamp timestamptz;
begin
 if not public.cockpit_team_can_edit_doc(p_meeting_id) then raise exception 'An active verified cockpit seat is required'; end if;
 select * into m from public.team_meetings where id=p_meeting_id;
 if left(p_sitting_id,length(p_meeting_id)+1)<>p_meeting_id||':' or right(p_sitting_id,10)!~ '^\d{4}-\d{2}-\d{2}$' or length(p_sitting_id)<>length(p_meeting_id)+11 then raise exception 'That sitting is another meeting''s'; end if;
 select * into s from public.team_sittings where id=p_sitting_id;
 if found then return s; end if;
 day:=right(p_sitting_id,10)::date;
 if m.cal_event_id is not null or m.start_time is null or m.minutes is null or
 not coalesce(extract(dow from day)::smallint=any(m.weekdays),false) or (m.ends_on is not null and day>m.ends_on) then
  raise exception 'That sitting is not in the meeting schedule';
 end if;
 perform set_config('cockpit.team_command','on',true);
 stamp:=(day+m.start_time) at time zone m.tz;
 insert into public.team_sittings(id,meeting_id,on_date,starts_at,ends_at,held)
 values(p_sitting_id,p_meeting_id,day,stamp,stamp+make_interval(mins=>m.minutes),day<=(now() at time zone m.tz)::date)
 on conflict(id) do nothing;
 select * into s from public.team_sittings where id=p_sitting_id;
 return s;
end;
$$;

create or replace function public.cockpit_team_calendar_command(p_action text,p_args jsonb)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
<<command>>
declare
 mid text:=coalesce(p_args->>'meetingId',p_args->>'id'); actor text; pid text;
 m public.team_meetings; s public.team_sittings; person public.team_people; prev public.team_meeting_people;
 title text; purpose text; dept text; base text; n integer:=1; day date; start_at time; duration integer; days smallint[];
 sid text:=p_args->>'sittingId'; stamp timestamptz; part text:=p_args->>'part'; operation text; payload jsonb;
 today date:=(now() at time zone 'Asia/Kuwait')::date; on_calendar boolean; guest_action text;
begin
 if not public.cockpit_has_active_seat() then raise exception 'An active verified cockpit seat is required'; end if;
 select lower(email) into actor from auth.users where id=auth.uid();
 perform set_config('cockpit.team_command','on',true);
 if p_action='saveMeeting' and nullif(mid,'') is null then
  title:=left(btrim(p_args->>'title'),120); purpose:=left(btrim(p_args->>'purpose'),300); dept:=nullif(left(btrim(p_args->>'department'),60),'');
  if coalesce(length(title),0)<3 or coalesce(length(purpose),0)<8 then raise exception 'Give the meeting a name and a purpose'; end if;
  if coalesce(p_args->>'cadence','')<>all(array['daily','three times a week','twice a week','weekly','every two weeks','monthly','quarterly','as needed']) then raise exception 'Pick how often it meets'; end if;
  on_calendar:=coalesce((p_args->>'onCalendar')::boolean,true);
  select coalesce(array_agg(distinct value::smallint order by value::smallint),'{}'::smallint[]) into days from jsonb_array_elements_text(coalesce(p_args->'weekdays','[]'));
  if not days<@array[0,1,2,3,4,5,6]::smallint[] then raise exception 'Invalid meeting weekdays'; end if;
  if on_calendar or nullif(p_args->>'startTime','') is not null then
   if coalesce(p_args->>'startTime','')!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Give it a start time'; end if;
   start_at:=(p_args->>'startTime')::time; duration:=(p_args->>'minutes')::integer;
   if duration is null or duration not between 5 and 480 then raise exception 'Meeting length must be 5 to 480 minutes'; end if;
  end if;
  day:=nullif(p_args->>'firstDate','')::date;
  if on_calendar and cardinality(days)=0 and day is null then raise exception 'Pick its days or the one sitting date'; end if;
  base:=left(trim(both '-' from regexp_replace(lower(title),'[^a-z0-9]+','-','g')),48); if base='' then base:='meeting'; end if;
  perform pg_advisory_xact_lock(hashtextextended('team-create:'||base,0));
  mid:=base; while exists(select 1 from public.team_meetings where id=mid) loop n:=n+1;mid:=base||'-'||n;end loop;
  select id into pid from public.team_people where lower(email)=actor and active limit 1;
  insert into public.team_meetings(id,title,purpose,cadence,department,host_id,active,managed,created_by,tz,start_time,minutes,weekdays,ends_on)
  values(mid,title,purpose,p_args->>'cadence',dept,pid,true,'cockpit',actor,'Asia/Kuwait',start_at,duration,nullif(days,'{}'),case when cardinality(days)=0 then day end);
  if pid is not null then insert into public.team_meeting_people(meeting_id,person_id,part,source,changed_by,changed_at) values(mid,pid,'host','cockpit',actor,now()); end if;
  if cardinality(days)=0 and day is not null then
   stamp:=(day+start_at) at time zone 'Asia/Kuwait';
   insert into public.team_sittings(id,meeting_id,on_date,starts_at,ends_at,held) values(mid||':'||day,mid,day,stamp,stamp+make_interval(mins=>duration),day<=today);
  end if;
  if on_calendar then operation:='create';payload:=jsonb_build_object('from',coalesce(day,today));end if;
 else
  if mid is null and sid is not null then mid:=left(sid,length(sid)-11); end if;
  if not public.cockpit_team_can_manage(mid) then raise exception 'Only this meeting''s hosts, admins and CEO manage it'; end if;
  select * into m from public.team_meetings where id=mid for update;
  if not found then raise exception 'That meeting is not in the list';end if;
  if sid is not null then
   s:=public.cockpit_team_ensure_sitting(mid,sid);
   if s.meeting_id<>mid then raise exception 'That sitting is another meeting''s';end if;
  end if;
  case p_action
  when 'saveMeeting' then
   title:=left(btrim(p_args->>'title'),120);purpose:=left(btrim(p_args->>'purpose'),300);dept:=nullif(left(btrim(p_args->>'department'),60),'');
   if coalesce(length(title),0)<3 or coalesce(length(purpose),0)<8 then raise exception 'Give the meeting a name and a purpose';end if;
   if coalesce(p_args->>'cadence','')<>all(array['daily','three times a week','twice a week','weekly','every two weeks','monthly','quarterly','as needed']) then raise exception 'Pick how often it meets';end if;
   update public.team_meetings set title=command.title,purpose=command.purpose,cadence=p_args->>'cadence',department=dept,managed='cockpit',updated_at=now() where id=mid;
   if m.cal_event_id is not null and (m.title is distinct from title or m.purpose is distinct from purpose) then operation:='describe';payload:=jsonb_build_object('title',title,'oldTitle',m.title,'purpose',purpose);end if;
  when 'setPart' then
   if part is null or part<>all(array['host','required','optional','off']) then raise exception 'Choose a part';end if;
   select * into person from public.team_people where id=p_args->>'personId' and active;
   if not found then raise exception 'Choose a person on the roster';end if;
   select * into prev from public.team_meeting_people where meeting_id=mid and person_id=person.id;
   if prev.part='host' and not prev.removed and part<>'host' and not exists(select 1 from public.team_meeting_people where meeting_id=mid and person_id<>person.id and part='host' and not removed) then raise exception 'Make somebody else the host first';end if;
   if m.cal_event_id is not null and (person.email is null or person.email!~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then raise exception 'Give this person an email address for the invite';end if;
   if m.cal_event_id is not null and lower(person.email)=lower(m.cal_calendar) and part='off' then raise exception 'The organizer cannot be taken off the invite';end if;
   guest_action:=case when part='off' then 'remove' when prev.person_id is null or prev.removed then 'add' else 'part' end;
   insert into public.team_meeting_people(meeting_id,person_id,part,removed,source,changed_by,changed_at)
   values(mid,person.id,case when part='off' then coalesce(prev.part,'required') else part end,part='off','cockpit',actor,now())
   on conflict(meeting_id,person_id) do update set part=excluded.part,removed=excluded.removed,source='cockpit',changed_by=actor,changed_at=now();
   update public.team_meetings set host_id=(select person_id from public.team_meeting_people where meeting_id=mid and part='host' and not removed order by changed_at limit 1),managed='cockpit',updated_at=now() where id=mid;
   if m.cal_event_id is not null then operation:='guests';payload:=jsonb_build_object('changes',jsonb_build_array(jsonb_build_object('personId',person.id,'email',person.email,'action',guest_action,'optional',part='optional')));end if;
  when 'setEmail' then
   if coalesce(p_args->>'email','')!~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'That is not an email address';end if;
   if exists(select 1 from public.team_people where lower(email)=lower(btrim(p_args->>'email')) and id<>p_args->>'personId') then raise exception 'That address already belongs to someone on the roster';end if;
   -- Roster email establishes host identity. A host must not reassign another verified seat.
   if not (public.cockpit_is_ceo() or public.cockpit_has_role('admin')) and exists(select 1 from public.team_people p join auth.users u on lower(u.email)=lower(p.email) where p.id=p_args->>'personId' and u.email_confirmed_at is not null and lower(p.email)<>lower(btrim(p_args->>'email'))) then raise exception 'Ask an admin to change an existing signed-in identity';end if;
   update public.team_people set email=lower(btrim(p_args->>'email')),updated_at=now() where id=p_args->>'personId';
   if not found then raise exception 'That person is not on the roster';end if;
  when 'setSeries' then
   select array_agg(distinct value::smallint order by value::smallint) into days from jsonb_array_elements_text(p_args->'weekdays');
   if coalesce(days,'{}')<@array[0,1,2,3,4,5,6]::smallint[] is not true or (m.rrule is not null and coalesce(cardinality(days),0)=0) then raise exception 'Choose the repeating days';end if;
   if coalesce(p_args->>'startTime','')!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Pick a start time';end if;
   start_at:=(p_args->>'startTime')::time;duration:=(p_args->>'minutes')::integer;day:=(p_args->>'from')::date;
   if duration is null or duration not between 5 and 480 or day is null then raise exception 'Pick a valid length and date';end if;
   update public.team_meetings set weekdays=days,start_time=start_at,minutes=duration,managed='cockpit',updated_at=now() where id=mid;
   if m.cal_event_id is not null then operation:='series';payload:=jsonb_build_object('weekdays',coalesce(days,'{}'),'startTime',to_char(start_at,'HH24:MI'),'minutes',duration,'from',day);
   else update public.team_sittings set starts_at=(on_date+start_at) at time zone m.tz,ends_at=((on_date+start_at) at time zone m.tz)+make_interval(mins=>duration) where meeting_id=mid and on_date>=day and status<>'cancelled';end if;
  when 'moveSitting' then
   day:=(p_args->>'day')::date;start_at:=(p_args->>'startTime')::time;duration:=(p_args->>'minutes')::integer;
   if day is null or start_at is null or duration is null or duration not between 5 and 480 then raise exception 'Pick a day, start and length';end if;
   stamp:=(day+start_at) at time zone m.tz;
   update public.team_sittings set starts_at=stamp,ends_at=stamp+make_interval(mins=>duration),status='moved' where id=sid;
   if s.cal_instance_id is not null then operation:='move';payload:=jsonb_build_object('day',day,'startTime',to_char(start_at,'HH24:MI'),'minutes',duration);end if;
  when 'cancelSitting' then
   update public.team_sittings set status='cancelled' where id=sid;
   if s.cal_instance_id is not null then operation:='cancel';end if;
  when 'addSitting' then
   day:=(p_args->>'date')::date;start_at:=coalesce(nullif(p_args->>'startTime','')::time,m.start_time);duration:=coalesce((p_args->>'minutes')::integer,m.minutes,30);
   if day is null or day<today-60 or day>today+370 or duration not between 5 and 480 then raise exception 'Pick a date within the year and a valid length';end if;
   sid:=mid||':'||day;
   if exists(select 1 from public.team_sittings where id=sid and status<>'cancelled') then raise exception 'It already meets that day. Move that sitting instead';end if;
   stamp:=(day+start_at) at time zone m.tz;
   insert into public.team_sittings(id,meeting_id,on_date,held,status,starts_at,ends_at,cal_instance_id) values(sid,mid,day,day<=today,'scheduled',stamp,stamp+make_interval(mins=>duration),null)
   on conflict(id) do update set held=excluded.held,status='scheduled',starts_at=excluded.starts_at,ends_at=excluded.ends_at,cal_instance_id=null;
   if m.cal_event_id is not null and start_at is not null then operation:='addOne';payload:=jsonb_build_object('day',day,'startTime',to_char(start_at,'HH24:MI'),'minutes',duration);end if;
  when 'endMeeting' then
   day:=(p_args->>'lastDate')::date;if day is null then raise exception 'Pick the last meeting date';end if;
   update public.team_meetings set ends_on=day,managed='cockpit',updated_at=now() where id=mid;
   if m.cal_event_id is not null then operation:='end';payload:=jsonb_build_object('lastDate',day);
   else update public.team_sittings set status='cancelled',held=false where meeting_id=mid and on_date>day and on_date>=today;end if;
  when 'putOnCalendar' then
   if m.cal_event_id is not null then raise exception 'That meeting is already on Google Calendar';end if;
   if m.start_time is null or m.minutes is null then raise exception 'Give the meeting a start time and length';end if;
   operation:='create';payload:=jsonb_build_object('from',coalesce(nullif(p_args->>'from','')::date,today));
  when 'takeOver' then
   if m.cal_event_id is null or m.cal_writable then raise exception 'That meeting does not need taking over';end if;
   operation:='takeover';payload:=jsonb_build_object('from',today);
  when 'retryCalendar' then
   update public.team_calendar_ops set status='pending',attempts=0,error=null,tried_at=null,claim_token=null,lease_until=null where meeting_id=mid and status='failed';
  when 'setGoalHit' then
   update public.team_sittings set goal_hit=(p_args->>'hit')::boolean where id=sid;
  else raise exception 'Unknown team command: %',p_action;
  end case;
 end if;
 if operation is not null then insert into public.team_calendar_ops(meeting_id,sitting_id,op,payload,requested_by) values(mid,sid,operation,payload,actor);end if;
 insert into public.team_changes(meeting_id,by_whom,what,detail) values(mid,actor,p_action,jsonb_build_object('command',p_args,'queued',operation));
 return mid;
end;
$$;

create or replace function public.cockpit_team_spin(p_wheel_id text,p_sitting_id text,p_among text[] default null,p_for_person text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 w public.team_wheels; s public.team_sittings; actor text; choices jsonb; chosen jsonb;
 count_choices integer; random_value bigint; ceiling bigint; picked integer; for_name text; line text;
begin
 if not public.cockpit_has_active_seat() then raise exception 'An active verified cockpit seat is required';end if;
 select lower(email) into actor from auth.users where id=auth.uid();
 select * into w from public.team_wheels where id=p_wheel_id for update;
 if not found or w.meeting_id is null then raise exception 'That wheel is not on a meeting';end if;
 s:=public.cockpit_team_ensure_sitting(w.meeting_id,p_sitting_id);
 perform 1 from public.team_sittings where id=p_sitting_id for update;
 if not w.active then raise exception 'That wheel is switched off';end if;
 if w.kind='prize' and w.locked_until_goal and s.goal_hit is distinct from true then raise exception 'Mark this week''s goal as hit to unlock this earned wheel';end if;
 if w.kind='person' then
  select jsonb_agg(jsonb_build_object('id',null,'label',p.name) order by mp.person_id) into choices
  from public.team_meeting_people mp join public.team_people p on p.id=mp.person_id
  where mp.meeting_id=w.meeting_id and not mp.removed and p.active and (p_among is null or p.id=any(p_among));
 else
  select jsonb_agg(jsonb_build_object('id',o.id,'label',replace(o.label,'{amount}',
   case when o.amount is null then '?'
   else (case when coalesce(o.amount_suffix,'')<>'' then '' when coalesce(o.currency,'USD')='USD' then '$' else o.currency||' ' end)
    ||(case when o.amount=trunc(o.amount) then trunc(o.amount)::text else to_char(o.amount,'FM9999999990.00') end)||coalesce(o.amount_suffix,'') end)) order by o.position,o.id)
   into choices from public.team_wheel_options o where o.wheel_id=w.id and o.active;
 end if;
 count_choices:=coalesce(jsonb_array_length(choices),0);
 if count_choices=0 then raise exception 'This wheel has no eligible choices';end if;
 ceiling:=(4294967296::bigint/count_choices)*count_choices;
 loop
  random_value:=('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint;
  exit when random_value<ceiling;
 end loop;
 picked:=(random_value%count_choices)::integer;chosen:=choices->picked;
 if p_for_person is not null then select name into for_name from public.team_people where id=p_for_person;end if;
 line:='Spun '||w.name||': '||(chosen->>'label')||case when for_name is null then '' else ' (for '||for_name||')' end;
 perform set_config('cockpit.team_command','on',true);
 update public.team_sittings set notes=case when coalesce(notes,'')='' then line else notes||E'\n'||line end,
 notes_by=actor,notes_at=now(),notes_version=notes_version+1 where id=p_sitting_id;
 insert into public.team_wheel_spins(wheel_id,sitting_id,option_id,result_label,spun_by,spun_for)
 values(w.id,p_sitting_id,(chosen->>'id')::bigint,chosen->>'label',actor,for_name);
 return jsonb_build_object('meetingId',w.meeting_id,'result',jsonb_build_object('wheelId',w.id,'index',picked,'label',chosen->>'label','choices',(select jsonb_agg(c->>'label') from jsonb_array_elements(choices) c)));
end;
$$;
-- Install missing guards without changing existing table policies or human rows.
DO $restore$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['team_people','team_meetings','team_meeting_people','team_sittings','team_agenda','team_changes','team_meeting_blocks','team_wheels','team_wheel_options','team_wheel_spins','team_creative_rows','team_calendar_ops','team_meeting_series','team_recordings'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS team_native_guard ON public.%I',t);
  EXECUTE format('CREATE TRIGGER team_native_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cockpit_team_guard_write()',t);
  IF t<>'team_changes' THEN
   EXECUTE format('DROP TRIGGER IF EXISTS team_native_audit ON public.%I',t);
   EXECUTE format('CREATE TRIGGER team_native_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cockpit_team_audit_write()',t);
  END IF;
 END LOOP;
END $restore$;
REVOKE ALL ON FUNCTION public.cockpit_team_guard_write(),public.cockpit_team_audit_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_team_ensure_sitting(text,text),public.cockpit_team_calendar_command(text,jsonb),public.cockpit_team_spin(text,text,text[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_team_ensure_sitting(text,text),public.cockpit_team_calendar_command(text,jsonb),public.cockpit_team_spin(text,text,text[],text) TO authenticated;
REVOKE ALL ON FUNCTION public.cockpit_team_calendar_ready() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_team_calendar_ready() TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_team_calendar_report(boolean,text),public.cockpit_team_calendar_claim(),public.cockpit_team_calendar_renew(bigint,uuid),public.cockpit_team_calendar_finish(bigint,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_team_calendar_report(boolean,text),public.cockpit_team_calendar_claim(),public.cockpit_team_calendar_renew(bigint,uuid),public.cockpit_team_calendar_finish(bigint,uuid,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
