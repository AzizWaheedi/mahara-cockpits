-- All calendar-bound edits and queue rows commit together. No browser may forge calendar receipts.
begin;
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
revoke all on function public.cockpit_team_ensure_sitting(text,text) from public,anon;
grant execute on function public.cockpit_team_ensure_sitting(text,text) to authenticated;

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
revoke all on function public.cockpit_team_calendar_command(text,jsonb) from public,anon;
grant execute on function public.cockpit_team_calendar_command(text,jsonb) to authenticated;

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
revoke all on function public.cockpit_team_spin(text,text,text[],text) from public,anon;
grant execute on function public.cockpit_team_spin(text,text,text[],text) to authenticated;
commit;
