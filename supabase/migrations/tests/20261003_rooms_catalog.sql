-- Catalog checks for 20261003a/b/c: tables, row security, grants, policies,
-- the presence view, functions, triggers, cron jobs, indexes, constraints
-- and columns. Read-only apart from this run's own temp table, so it is the
-- only part run_checks.py --applied runs against the live database: it
-- touches no real row, takes no lock a cockpit write waits on, and compares
-- no setting value (a switch turned on after launch is not a failure here).
--
-- It creates pg_temp.lc_checks and pg_temp.ck(name, ok, detail); the
-- behaviour checks (20261003_rooms_checks.sql) add to the same table, and the
-- runner selects it at the end.

create temp table lc_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.lc_checks (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

do $$
declare
  t text;
  f text;
  v text;
  r record;
begin
  foreach t in array array['cockpit_sales_rooms', 'cockpit_sales_room_events', 'cockpit_sales_room_hosts',
                           'cockpit_sales_availability', 'cockpit_sales_live', 'cockpit_sales_followup_levels',
                           'cockpit_sales_followup_waves', 'cockpit_sales_followup_wave_members',
                           'cockpit_sales_followup_stops'] loop
    perform pg_temp.ck('A seat-read table ' || t || ': RLS on, one seat policy, authenticated select only, anon none',
      (select c.relrowsecurity from pg_class as c where c.oid = ('public.' || t)::regclass)
      and (select count(*) = 1 and bool_and(p.policyname = t || '_seat_read' and p.cmd = 'SELECT'
                                            -- 20261003d: room events only with a room (no unplaced Zoom attendee).
                                            and p.qual = case when t = 'cockpit_sales_room_events'
                                                              then '(cockpit_sales_seat() AND (room_id IS NOT NULL))'
                                                              else 'cockpit_sales_seat()' end)
             from pg_policies as p where p.schemaname = 'public' and p.tablename = t)
      and has_table_privilege('authenticated', 'public.' || t, 'select')
      and not has_table_privilege('authenticated', 'public.' || t, 'insert')
      and not has_table_privilege('authenticated', 'public.' || t, 'update')
      and not has_table_privilege('authenticated', 'public.' || t, 'delete')
      and not has_table_privilege('anon', 'public.' || t, 'select')
      and has_table_privilege('service_role', 'public.' || t, 'insert'));
  end loop;
  perform pg_temp.ck('A cockpit_sales_followup_meta: RLS on, read as the draft is read (seat and the followups row), select only',
    (select c.relrowsecurity from pg_class as c where c.oid = 'public.cockpit_sales_followup_meta'::regclass)
    and (select count(*) = 1 and bool_and(p.cmd = 'SELECT' and p.qual like '%cockpit_sales_seat()%'
                                          and p.qual like '%cockpit_sales_followups%')
           from pg_policies as p where p.schemaname = 'public' and p.tablename = 'cockpit_sales_followup_meta')
    and has_table_privilege('authenticated', 'public.cockpit_sales_followup_meta', 'select')
    and not has_table_privilege('authenticated', 'public.cockpit_sales_followup_meta', 'insert')
    and not has_table_privilege('authenticated', 'public.cockpit_sales_followup_meta', 'update')
    and not has_table_privilege('anon', 'public.cockpit_sales_followup_meta', 'select')
    and has_table_privilege('service_role', 'public.cockpit_sales_followup_meta', 'insert'));
  foreach t in array array['cockpit_sales_room_secrets', 'cockpit_sales_alerts', 'cockpit_sales_room_posts'] loop
    perform pg_temp.ck('A service-only table ' || t || ': RLS on, no policy, no seat or anon access',
      (select c.relrowsecurity from pg_class as c where c.oid = ('public.' || t)::regclass)
      and not exists (select 1 from pg_policies as p where p.schemaname = 'public' and p.tablename = t)
      and not has_table_privilege('authenticated', 'public.' || t, 'select')
      and not has_table_privilege('anon', 'public.' || t, 'select')
      and has_table_privilege('service_role', 'public.' || t, 'select'));
  end loop;
  perform pg_temp.ck('A presence view is security_invoker and service role only (seats get it from live.status)',
    (select 'security_invoker=true' = any (c.reloptions) from pg_class as c where c.oid = 'public.cockpit_sales_presence'::regclass)
    and not has_table_privilege('authenticated', 'public.cockpit_sales_presence', 'select')
    and not has_table_privilege('anon', 'public.cockpit_sales_presence', 'select')
    and has_table_privilege('service_role', 'public.cockpit_sales_presence', 'select'));
  foreach f in array array['public.cockpit_sales_live_claim(uuid, text, integer, timestamptz)', 'public.cockpit_sales_rooms_sweep()',
                           'public.cockpit_sales_rooms_tick()', 'public.cockpit_sales_watchdog()',
                           'public.cockpit_sales_room_code()',
                           'public.cockpit_sales_room_event_lease(uuid, text, integer)',
                           'public.cockpit_sales_room_pending(uuid, timestamptz)',
                           'public.cockpit_sales_rooms_close(uuid[], text[], text, text, text, text, text)',
                           'public.cockpit_sales_live_move(uuid, text[], text, text, text)',
                           'public.cockpit_sales_alert_set(text, boolean, text, text, text, jsonb)',
                           'public.cockpit_sales_alert_hours(timestamptz)',
                           'public.cockpit_sales_alert_words(text, integer)',
                           'public.cockpit_sales_settings_add_missing(text, jsonb, text, text)',
                           'public.cockpit_sales_jsonb_add_missing(jsonb, jsonb)',
                           'public.cockpit_sales_norm_words(text)'] loop
    perform pg_temp.ck('A function ' || f || ': service role only',
      has_function_privilege('service_role', f, 'execute')
      and not has_function_privilege('authenticated', f, 'execute')
      and not has_function_privilege('anon', f, 'execute'));
  end loop;
  perform pg_temp.ck('A claim, lease, sweep, tick and watchdog are security definer with an empty search_path',
    (select count(*) = 5 and bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc as p
      where p.oid in ('public.cockpit_sales_live_claim(uuid, text, integer, timestamptz)'::regprocedure,
                      'public.cockpit_sales_room_event_lease(uuid, text, integer)'::regprocedure,
                      'public.cockpit_sales_rooms_sweep()'::regprocedure, 'public.cockpit_sales_rooms_tick()'::regprocedure,
                      'public.cockpit_sales_watchdog()'::regprocedure)));
  perform pg_temp.ck('A the claim waits at most 3 s for a lock (lock_timeout)',
    (select 'lock_timeout=3s' = any (p.proconfig) from pg_proc as p
      where p.oid = 'public.cockpit_sales_live_claim(uuid, text, integer, timestamptz)'::regprocedure));
  for r in select j.jobname, j.schedule, j.active, j.username, j.command from cron.job as j
            where j.jobname in ('mahara-sales-rooms-sweep', 'mahara-sales-watchdog') loop
    perform pg_temp.ck('A cron ' || r.jobname || ' scheduled as postgres, runs its one function',
      r.active and r.username = 'postgres'
      and r.schedule = case r.jobname when 'mahara-sales-rooms-sweep' then '* * * * *' else '*/5 * * * *' end
      and btrim(r.command) = case r.jobname when 'mahara-sales-rooms-sweep' then 'select public.cockpit_sales_rooms_tick();'
                                            else 'select public.cockpit_sales_watchdog();' end,
      r.schedule || ' ' || r.command);
  end loop;
  perform pg_temp.ck('A both cron jobs exist exactly once',
    (select count(*) = 2 from cron.job where jobname in ('mahara-sales-rooms-sweep', 'mahara-sales-watchdog')));
  foreach v in array array['cockpit_sales_rooms_one_per_lead', 'cockpit_sales_rooms_one_per_host',
                           'cockpit_sales_live_one_open_per_lead', 'cockpit_sales_live_one_claim_per_closer',
                           'cockpit_sales_followup_wave_members_one_running',
                           'cockpit_sales_followup_waves_one_running_pool'] loop
    perform pg_temp.ck('A unique index ' || v,
      exists (select 1 from pg_index as i where i.indexrelid = ('public.' || v)::regclass and i.indisunique and i.indpred is not null));
  end loop;
  perform pg_temp.ck('A one running wave per contact covers waiting, held_out and drafted (the desk''s states)',
    (select pg_get_expr(i.indpred, i.indrelid) from pg_index as i
      where i.indexrelid = 'public.cockpit_sales_followup_wave_members_one_running'::regclass)
      = '(state = ANY (ARRAY[''waiting''::text, ''held_out''::text, ''drafted''::text]))');
  perform pg_temp.ck('A messages source allows rep, followup, thread, room',
    (select pg_get_constraintdef(c.oid) from pg_constraint as c where c.conname = 'cockpit_sales_messages_source_check')
      = 'CHECK ((source = ANY (ARRAY[''rep''::text, ''followup''::text, ''thread''::text, ''room''::text])))');
  perform pg_temp.ck('A follow-up segments are the nine kinds',
    (select pg_get_constraintdef(c.oid) from pg_constraint as c where c.conname = 'cockpit_sales_followups_segment_check')
      = 'CHECK ((segment = ANY (ARRAY[''reply''::text, ''confirm''::text, ''no_show''::text, ''cancelled''::text, ''new''::text, ''after_call''::text, ''nurture''::text, ''good_intro''::text, ''reactivate''::text])))');
  perform pg_temp.ck('A columns the other lanes write have their shape (link_message_ids jsonb, code with no default, lease_until, claim_room, event_at, excluded_reason, button_variable)',
    (select data_type = 'jsonb' from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_rooms' and column_name = 'link_message_ids')
    and (select column_default is null from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_rooms' and column_name = 'code')
    and exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_room_events' and column_name = 'lease_until')
    and exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_live' and column_name = 'claim_room')
    and exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_followup_wave_members' and column_name = 'event_at')
    and exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_followup_wave_members' and column_name = 'excluded_reason')
    and exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_wa_templates' and column_name = 'button_variable'));
  perform pg_temp.ck('A 20261004a: the availability row keeps the last press''s standby sentence (standby_error text, standby_error_at)',
    (select data_type = 'text' from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_availability' and column_name = 'standby_error')
    and (select data_type = 'timestamp with time zone' from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_availability' and column_name = 'standby_error_at'));
  perform pg_temp.ck('A triggers: room guard, the replaced_by link, handover guard, levels gate, wave guard, member, meta and stops touch',
    (select count(*) = 8 from pg_trigger as g
      where not g.tgisinternal and g.tgname in ('cockpit_sales_rooms_guard', 'cockpit_sales_rooms_link_replaced',
        'cockpit_sales_live_guard', 'cockpit_sales_followup_levels_guard', 'cockpit_sales_followup_waves_guard',
        'cockpit_sales_followup_wave_members_touch', 'cockpit_sales_followup_meta_touch', 'cockpit_sales_followup_stops_touch')));
  perform pg_temp.ck('A no trigger closes a done wave''s members (the desk winds a wave down; contract-v2 section 10)',
    not exists (select 1 from pg_trigger as g where not g.tgisinternal and g.tgname = 'cockpit_sales_followup_waves_close_members')
    and to_regprocedure('public.cockpit_sales_followup_waves_close_members()') is null);

  -- Integration pass (contract-v2.md section 2 and section 10).
  select string_agg(x.c, ', ' order by x.c) into v
    from (values ('cockpit_sales_rooms', 'link_claimed_at'), ('cockpit_sales_rooms', 'count_undo_at'),
                 ('cockpit_sales_rooms', 'link_unconfirmed_at'),
                 ('cockpit_sales_followup_waves', 'enrolled_at'), ('cockpit_sales_followup_waves', 'settled_at'),
                 ('cockpit_sales_followup_wave_members', 'next_try_at'), ('cockpit_sales_followup_wave_members', 'due_at'),
                 ('cockpit_sales_followup_wave_members', 'replied_at'), ('cockpit_sales_followup_wave_members', 'booked_at'),
                 ('cockpit_sales_followup_wave_members', 'closed_at')) as w(t, c0)
    cross join lateral (select w.t || '.' || w.c0 as c) as x
   where not exists (select 1 from information_schema.columns as ic
                      where ic.table_schema = 'public' and ic.table_name = w.t and ic.column_name = w.c0
                        and ic.data_type = 'timestamp with time zone' and ic.is_nullable = 'YES' and ic.column_default is null);
  perform pg_temp.ck('A the new time columns exist, timestamptz, null, no default (rooms link_claimed_at, count_undo_at, link_unconfirmed_at; waves; members)',
    v is null, v);
  select string_agg(x.c, ', ' order by x.c) into v
    from (values ('cockpit_sales_followup_waves', 'done_reason', 300), ('cockpit_sales_followup_wave_members', 'later_reason', 300),
                 ('cockpit_sales_followup_wave_members', 'last_error', 300), ('cockpit_sales_followup_meta', 'hold_reason', 300)) as w(t, c0, n)
    cross join lateral (select w.t || '.' || w.c0 as c) as x
   where not exists (select 1 from information_schema.columns as ic
                      where ic.table_schema = 'public' and ic.table_name = w.t and ic.column_name = w.c0
                        and ic.data_type = 'text' and ic.is_nullable = 'YES')
      or not exists (select 1 from pg_constraint as k
                      where k.conrelid = ('public.' || w.t)::regclass and k.contype = 'c'
                        and pg_get_constraintdef(k.oid) like '%length(' || w.c0 || ') <= ' || w.n || '%');
  perform pg_temp.ck('A the desk''s reason columns exist, text, at most 300 characters (done_reason, later_reason, last_error, hold_reason)',
    v is null, v);
  perform pg_temp.ck('A wave_members.fail_count is integer not null default 0, never negative',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'cockpit_sales_followup_wave_members' and column_name = 'fail_count'
               and data_type = 'integer' and is_nullable = 'NO' and column_default = '0')
    and exists (select 1 from pg_constraint as k
                 where k.conrelid = 'public.cockpit_sales_followup_wave_members'::regclass
                   and pg_get_constraintdef(k.oid) = 'CHECK ((fail_count >= 0))'));
  perform pg_temp.ck('A open_device takes phone, tablet or computer, or null (the door''s and roomlogic''s names)',
    (select pg_get_constraintdef(k.oid) from pg_constraint as k where k.conname = 'cockpit_sales_rooms_open_device_check'
       and k.conrelid = 'public.cockpit_sales_rooms'::regclass)
      = 'CHECK (((open_device IS NULL) OR (open_device = ANY (ARRAY[''phone''::text, ''tablet''::text, ''computer''::text]))))',
    (select pg_get_constraintdef(k.oid) from pg_constraint as k where k.conname = 'cockpit_sales_rooms_open_device_check'));
  perform pg_temp.ck('A wave states are the desk''s four (draft, running, paused, done)',
    (select pg_get_constraintdef(k.oid) from pg_constraint as k where k.conname = 'cockpit_sales_followup_waves_state_check')
      = 'CHECK ((state = ANY (ARRAY[''draft''::text, ''running''::text, ''paused''::text, ''done''::text])))');
  perform pg_temp.ck('A wave member states include closed (the 14-day close) and keep done and failed',
    (select pg_get_constraintdef(k.oid) like '%''closed''%' and pg_get_constraintdef(k.oid) like '%''done''%'
            and pg_get_constraintdef(k.oid) like '%''failed''%' and pg_get_constraintdef(k.oid) like '%''held_out''%'
       from pg_constraint as k where k.conname = 'cockpit_sales_followup_wave_members_state_check')
    and (select pg_get_constraintdef(k.oid) like '%''closed''%'
           from pg_constraint as k where k.conname = 'cockpit_sales_followup_wave_members_holdout_check'));
  for r in select * from (values
      ('cockpit_sales_rooms_provider_meeting', 'cockpit_sales_rooms', '(provider_meeting_id)', 'provider_meeting_id IS NOT NULL'),
      ('cockpit_sales_followup_waves_settled', 'cockpit_sales_followup_waves', '(state, settled_at)', null),
      ('cockpit_sales_followup_wave_members_next_try', 'cockpit_sales_followup_wave_members', '(wave_id, state, next_try_at)', null),
      ('cockpit_sales_followup_wave_members_sent', 'cockpit_sales_followup_wave_members', '(sent_at)', 'sent_at IS NOT NULL'),
      ('cockpit_sales_followup_wave_members_due', 'cockpit_sales_followup_wave_members', '(due_at)', 'due_at IS NOT NULL'),
      ('cockpit_sales_followup_wave_members_state', 'cockpit_sales_followup_wave_members', '(state, drafted_at)', null))
      as x(idx, tbl, cols, pred) loop
    perform pg_temp.ck('A index ' || r.idx || ' on ' || r.tbl || ' ' || r.cols || coalesce(' where ' || r.pred, '') || ', not unique',
      exists (select 1 from pg_index as i join pg_indexes as pi on pi.indexname = r.idx and pi.schemaname = 'public'
               where i.indexrelid = ('public.' || r.idx)::regclass and not i.indisunique
                 and i.indrelid = ('public.' || r.tbl)::regclass
                 and pi.indexdef like '%' || r.cols || '%'
                 and coalesce(pg_get_expr(i.indpred, i.indrelid), '') = coalesce('(' || r.pred || ')', '')),
      (select indexdef from pg_indexes where schemaname = 'public' and indexname = r.idx));
  end loop;
exception when others then
  perform pg_temp.ck('A catalog section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;
