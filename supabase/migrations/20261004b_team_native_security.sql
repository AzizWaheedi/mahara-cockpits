-- Native team writes: verified seats, domain privileges, immutable audit and fenced calendar claims.
begin;

create or replace function public.cockpit_team_can_edit_doc(p_meeting_id text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.cockpit_has_active_seat() and exists(select 1 from public.team_meetings where id=p_meeting_id);
$$;
create or replace function public.cockpit_team_can_manage(p_meeting_id text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.cockpit_has_active_seat() and (
   public.cockpit_is_ceo() or public.cockpit_has_role('admin') or exists(
     select 1 from public.team_meeting_people mp join public.team_people p on p.id=mp.person_id
     join auth.users u on u.id=auth.uid() and lower(u.email)=lower(p.email)
     where mp.meeting_id=p_meeting_id and mp.part='host' and not mp.removed and p.active));
$$;
revoke all on function public.cockpit_team_can_edit_doc(text),public.cockpit_team_can_manage(text) from public,anon;
grant execute on function public.cockpit_team_can_edit_doc(text),public.cockpit_team_can_manage(text) to authenticated,service_role;

-- The browser may not mint roster identities or provider receipts. Worker writes are audited too.
create or replace function public.cockpit_team_guard_write()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
 before_row jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 after_row jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 row_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 mid text; wid text; wheel public.team_wheels; actor text; boss boolean;
 trusted boolean := auth.role()='service_role' or current_setting('request.jwt.claims',true) is null or current_setting('request.jwt.claims',true)='';
 command boolean := current_setting('cockpit.team_command',true)='on';
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
revoke all on function public.cockpit_team_guard_write(),public.cockpit_team_audit_write() from public,anon,authenticated;

do $$ declare t text; p record; begin
 foreach t in array array['team_people','team_meetings','team_meeting_people','team_sittings','team_agenda','team_changes','team_meeting_blocks','team_wheels','team_wheel_options','team_wheel_spins','team_creative_rows','team_calendar_ops','team_meeting_series','team_recordings'] loop
  for p in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',p.policyname,t); end loop;
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy team_native_read on public.%I for select to authenticated using(public.cockpit_has_active_seat())',t);
  if t=any(array['team_meetings','team_sittings','team_agenda','team_meeting_blocks','team_wheels','team_wheel_options','team_creative_rows','team_changes']) then
   execute format('grant insert,update,delete on public.%I to authenticated',t);
   execute format('create policy team_native_write on public.%I for all to authenticated using(public.cockpit_has_active_seat()) with check(public.cockpit_has_active_seat())',t);
  end if;
  execute format('create trigger team_native_guard before insert or update or delete on public.%I for each row execute function public.cockpit_team_guard_write()',t);
  if t<>'team_changes' then execute format('create trigger team_native_audit after insert or update or delete on public.%I for each row execute function public.cockpit_team_audit_write()',t); end if;
 end loop;
end $$;
revoke update,delete on public.team_changes from authenticated;

alter table public.team_calendar_ops add column if not exists claim_token uuid,
 add column if not exists lease_until timestamptz;
alter table public.team_calendar_ops drop constraint if exists team_calendar_ops_status_check;
alter table public.team_calendar_ops add constraint team_calendar_ops_status_check check(status in ('pending','running','done','failed'));
create table public.cockpit_team_calendar_worker (
 singleton boolean primary key default true check(singleton), ready boolean not null,
 checked_at timestamptz not null, error text
);
alter table public.cockpit_team_calendar_worker enable row level security;
revoke all on public.cockpit_team_calendar_worker from public,anon,authenticated;
grant all on public.cockpit_team_calendar_worker to service_role;
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
revoke all on function public.cockpit_team_calendar_ready() from public,anon;
grant execute on function public.cockpit_team_calendar_ready() to authenticated,service_role;
revoke all on function public.cockpit_team_calendar_report(boolean,text),public.cockpit_team_calendar_claim(),public.cockpit_team_calendar_renew(bigint,uuid),public.cockpit_team_calendar_finish(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.cockpit_team_calendar_report(boolean,text),public.cockpit_team_calendar_claim(),public.cockpit_team_calendar_renew(bigint,uuid),public.cockpit_team_calendar_finish(bigint,uuid,text) to service_role;

commit;
