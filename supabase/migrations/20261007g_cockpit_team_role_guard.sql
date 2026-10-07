-- A missing JWT role must not bypass guards for nonempty claims.
-- Keep trusted service and maintenance paths unchanged. No business rows or schedules.
BEGIN;
create or replace function public.cockpit_team_guard_write()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
 before_row jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 after_row jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 row_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 mid text; wid text; wheel public.team_wheels; actor text; boss boolean;
 trusted boolean := coalesce(auth.role()='service_role',false) or current_setting('request.jwt.claims',true) is null or current_setting('request.jwt.claims',true)='';
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
REVOKE ALL ON FUNCTION public.cockpit_team_guard_write() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
