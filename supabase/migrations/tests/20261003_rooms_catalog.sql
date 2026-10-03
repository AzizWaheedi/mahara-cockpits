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
                                            and p.qual = 'cockpit_sales_seat()')
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
  foreach t in array array['cockpit_sales_room_secrets', 'cockpit_sales_alerts'] loop
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
  foreach f in array array['public.cockpit_sales_live_claim(uuid, text, integer)', 'public.cockpit_sales_rooms_sweep()',
                           'public.cockpit_sales_rooms_tick()', 'public.cockpit_sales_watchdog()',
                           'public.cockpit_sales_room_code()',
                           'public.cockpit_sales_room_event_lease(uuid, text, integer)',
                           'public.cockpit_sales_rooms_close(uuid[], text[], text, text, text, text, text)',
                           'public.cockpit_sales_live_move(uuid, text[], text, text, text)',
                           'public.cockpit_sales_alert_set(text, boolean, text, text, text, jsonb)',
                           'public.cockpit_sales_alert_hours(timestamptz)',
                           'public.cockpit_sales_alert_words(text, integer)',
                           'public.cockpit_sales_settings_add_missing(text, jsonb, text, text)',
                           'public.cockpit_sales_jsonb_add_missing(jsonb, jsonb)'] loop
    perform pg_temp.ck('A function ' || f || ': service role only',
      has_function_privilege('service_role', f, 'execute')
      and not has_function_privilege('authenticated', f, 'execute')
      and not has_function_privilege('anon', f, 'execute'));
  end loop;
  perform pg_temp.ck('A claim, lease, sweep, tick and watchdog are security definer with an empty search_path',
    (select count(*) = 5 and bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc as p
      where p.oid in ('public.cockpit_sales_live_claim(uuid, text, integer)'::regprocedure,
                      'public.cockpit_sales_room_event_lease(uuid, text, integer)'::regprocedure,
                      'public.cockpit_sales_rooms_sweep()'::regprocedure, 'public.cockpit_sales_rooms_tick()'::regprocedure,
                      'public.cockpit_sales_watchdog()'::regprocedure)));
  perform pg_temp.ck('A the claim waits at most 3 s for a lock (lock_timeout)',
    (select 'lock_timeout=3s' = any (p.proconfig) from pg_proc as p
      where p.oid = 'public.cockpit_sales_live_claim(uuid, text, integer)'::regprocedure));
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
  perform pg_temp.ck('A triggers: room guard, the replaced_by link, handover guard, levels gate, wave close, meta and stops touch',
    (select count(*) = 7 from pg_trigger as g
      where not g.tgisinternal and g.tgname in ('cockpit_sales_rooms_guard', 'cockpit_sales_rooms_link_replaced',
        'cockpit_sales_live_guard', 'cockpit_sales_followup_levels_guard', 'cockpit_sales_followup_waves_close_members',
        'cockpit_sales_followup_meta_touch', 'cockpit_sales_followup_stops_touch')));
exception when others then
  perform pg_temp.ck('A catalog section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;
