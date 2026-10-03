-- Checks for 20261003a_sales_rooms.sql, 20261003b_sales_hooks.sql and
-- 20261003c_sales_followup_agent.sql.
--
-- Run ONLY inside a transaction that is rolled back, after the three
-- migrations (without their own begin/commit). The runner does exactly that
-- and refuses any other transaction statement:
--
--   python3 supabase/migrations/tests/run_checks.py            # apply + checks, rolled back
--   python3 supabase/migrations/tests/run_checks.py --applied  # once live: checks only, rolled back
--
-- Every fixture uses lc-test-* ids and @example.invalid addresses. The one
-- webhook used is https://hooks.example.invalid/... (a name that can never
-- resolve), and its queued request is rolled back with everything else, so
-- nothing is ever sent. The last statement returns one row per check:
-- name, ok, detail.

create temp table lc_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.lc_checks (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

-- The SQLSTATE a statement fails with, or 'none'. The statement's effects are
-- undone either way (its own subtransaction).
create function pg_temp.err(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'none';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.errm(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'none';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;

-- A room for a test. Open, host_in and lead_in rooms get a join link.
create function pg_temp.room(p_contact text, p_host text, p_purpose text, p_state text default 'requested',
                             p_kind text default 'intro', p_appt text default null)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, appointment_id)
  values (gen_random_uuid(), p_contact, p_purpose, p_kind, 'zoom', p_host, p_host, p_state,
          case when p_state in ('open', 'host_in', 'lead_in') then 'https://zoom.example.invalid/j/1' end, p_appt)
  returning id into v;
  return v;
end;
$$;

create function pg_temp.live(p_contact text, p_offered text[], p_until interval default interval '2 minutes',
                             p_kind text default 'demo')
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
  values (gen_random_uuid(), p_contact, 'lc-test-setter@example.invalid', p_kind, 'on_call', p_offered, now() + p_until)
  returning id into v;
  return v;
end;
$$;

-- A. Catalog: tables, row security, grants, policies, view, functions, cron,
--    settings, indexes, constraints.
do $$
declare
  t text;
  f text;
  v text;
  r record;
begin
  foreach t in array array['cockpit_sales_rooms', 'cockpit_sales_room_events', 'cockpit_sales_room_hosts',
                           'cockpit_sales_availability', 'cockpit_sales_live', 'cockpit_sales_followup_levels',
                           'cockpit_sales_followup_waves', 'cockpit_sales_followup_wave_members'] loop
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
  foreach t in array array['cockpit_sales_room_secrets', 'cockpit_sales_alerts'] loop
    perform pg_temp.ck('A service-only table ' || t || ': RLS on, no policy, no seat or anon access',
      (select c.relrowsecurity from pg_class as c where c.oid = ('public.' || t)::regclass)
      and not exists (select 1 from pg_policies as p where p.schemaname = 'public' and p.tablename = t)
      and not has_table_privilege('authenticated', 'public.' || t, 'select')
      and not has_table_privilege('anon', 'public.' || t, 'select')
      and has_table_privilege('service_role', 'public.' || t, 'select'));
  end loop;
  perform pg_temp.ck('A presence view is security_invoker, seats read, anon does not',
    (select 'security_invoker=true' = any (c.reloptions) from pg_class as c where c.oid = 'public.cockpit_sales_presence'::regclass)
    and has_table_privilege('authenticated', 'public.cockpit_sales_presence', 'select')
    and not has_table_privilege('anon', 'public.cockpit_sales_presence', 'select'));
  foreach f in array array['public.cockpit_sales_live_claim(uuid, text, integer)', 'public.cockpit_sales_rooms_sweep()',
                           'public.cockpit_sales_watchdog()', 'public.cockpit_sales_room_code()',
                           'public.cockpit_sales_rooms_close(uuid[], text[], text, text, text, text, text)',
                           'public.cockpit_sales_live_move(uuid, text[], text, text, text)',
                           'public.cockpit_sales_alert_set(text, boolean, text, text, text, jsonb)',
                           'public.cockpit_sales_alert_hours(timestamptz)'] loop
    perform pg_temp.ck('A function ' || f || ': service role only',
      has_function_privilege('service_role', f, 'execute')
      and not has_function_privilege('authenticated', f, 'execute')
      and not has_function_privilege('anon', f, 'execute'));
  end loop;
  perform pg_temp.ck('A claim, sweep and watchdog are security definer with an empty search_path',
    (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc as p
      where p.oid in ('public.cockpit_sales_live_claim(uuid, text, integer)'::regprocedure,
                      'public.cockpit_sales_rooms_sweep()'::regprocedure, 'public.cockpit_sales_watchdog()'::regprocedure)));
  for r in select j.jobname, j.schedule, j.active, j.username from cron.job as j
            where j.jobname in ('mahara-sales-rooms-sweep', 'mahara-sales-watchdog') loop
    perform pg_temp.ck('A cron ' || r.jobname || ' scheduled as postgres',
      r.active and r.username = 'postgres'
      and r.schedule = case r.jobname when 'mahara-sales-rooms-sweep' then '* * * * *' else '*/5 * * * *' end,
      r.schedule);
  end loop;
  perform pg_temp.ck('A both cron jobs exist exactly once',
    (select count(*) = 2 from cron.job where jobname in ('mahara-sales-rooms-sweep', 'mahara-sales-watchdog')));
  perform pg_temp.ck('A setting rooms is the glossary value, every switch off',
    (select s.value from public.cockpit_sales_settings as s where s.key = 'rooms') =
    '{"enabled": false, "test_only": true, "test_contacts": ["VjPfR4Cc1Y0OFvaqeor5"], "test_calendar_id": null,
      "providers": {"zoom": false, "meet": false}, "default_provider": {"setter": "meet", "closer": "zoom"},
      "send": {"whatsapp_text": false, "whatsapp_template": false, "email": false},
      "template_route": "call_link", "count_on_join": false, "short_link": false,
      "waits_s": {"ready": 15, "fail": 60, "meet_pending": 30, "manual_buttons": 30, "handover_host": 120,
        "standby_host": 300, "fallback_host": 900, "lead": 600, "open_grace": 180, "not_lead_undo": 300,
        "event_replay": 20, "settle": 1200, "no_end_signal": 1800, "standby_max": 2100, "booked_guard": 600,
        "unconfirmed": 20},
      "lengths_min": {"intro": 30, "demo": 60}, "booking_min": {"intro": 15, "demo": 45}, "available_hours": 2,
      "fallback": {"scope": "intro", "auto_on_miss": false, "pilot_emails": [], "ended_page_whatsapp": null}}'::jsonb);
  perform pg_temp.ck('A setting live is the glossary value, every switch off',
    (select s.value from public.cockpit_sales_settings as s where s.key = 'live') =
    '{"enabled": false, "slack": false, "closer_wait_s": 120, "kinds": {"demo": false, "intro": false},
      "entries": {"dialer": true, "lead_page": false, "inbox": false, "followup": false}, "standby": true,
      "hours": {"days": [6, 0, 1, 2, 3, 4], "from": "10:00", "to": "20:00", "tz": "Asia/Kuwait"}}'::jsonb);
  perform pg_temp.ck('A settings rows were audited once each',
    (select count(*) = 2 from public.cockpit_audit_log
      where action = 'settings.create' and metadata ->> 'by' = 'migration 20261003a' and entity_id in ('rooms', 'live')));
  foreach v in array array['cockpit_sales_rooms_one_per_lead', 'cockpit_sales_rooms_one_per_host',
                           'cockpit_sales_live_one_open_per_lead', 'cockpit_sales_live_one_claim_per_closer',
                           'cockpit_sales_followup_wave_members_one_running'] loop
    perform pg_temp.ck('A unique index ' || v,
      exists (select 1 from pg_index as i where i.indexrelid = ('public.' || v)::regclass and i.indisunique and i.indpred is not null));
  end loop;
  perform pg_temp.ck('A messages source allows rep, followup, thread, room',
    (select pg_get_constraintdef(c.oid) from pg_constraint as c where c.conname = 'cockpit_sales_messages_source_check')
      = 'CHECK ((source = ANY (ARRAY[''rep''::text, ''followup''::text, ''thread''::text, ''room''::text])))');
  perform pg_temp.ck('A follow-up segments are the nine kinds',
    (select pg_get_constraintdef(c.oid) from pg_constraint as c where c.conname = 'cockpit_sales_followups_segment_check')
      = 'CHECK ((segment = ANY (ARRAY[''reply''::text, ''confirm''::text, ''no_show''::text, ''cancelled''::text, ''new''::text, ''after_call''::text, ''nurture''::text, ''good_intro''::text, ''reactivate''::text])))');
exception when others then
  perform pg_temp.ck('A catalog section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- B. Room codes.
do $$
begin
  perform pg_temp.ck('B 3000 codes: all valid, all distinct, all 32 letters used',
    (select count(*) = 3000 and count(distinct c) = 3000 and bool_and(c ~ '^[A-HJ-NP-Z2-9]{6}$')
       from (select public.cockpit_sales_room_code() as c from generate_series(1, 3000)) as x)
    and (select count(distinct ch) = 32
           from (select regexp_split_to_table(public.cockpit_sales_room_code(), '') as ch from generate_series(1, 3000)) as y));
exception when others then
  perform pg_temp.ck('B codes section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- C. Room rules and the state guard.
do $$
declare
  a uuid; b uuid; x uuid; s text; r public.cockpit_sales_rooms; l uuid;
begin
  s := pg_temp.err($q$insert into public.cockpit_sales_rooms (request_id, code, contact_id, purpose, call_kind, provider, host_email, made_by)
                      values (gen_random_uuid(), 'ABCDEI', 'lc-test-c0', 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x')$q$);
  perform pg_temp.ck('C a code with I is refused (23514)', s = '23514', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
                      values (gen_random_uuid(), 'lc-test-c0', 'standby', 'demo', 'zoom', 'lc-test-h0@example.invalid', 'x')$q$);
  perform pg_temp.ck('C a standby room with a lead is refused (23514)', s = '23514', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
                      values (gen_random_uuid(), null, 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x')$q$);
  perform pg_temp.ck('C a fallback room without a lead is refused (23514)', s = '23514', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url)
                      values (gen_random_uuid(), 'lc-test-c0', 'booked', 'demo', 'zoom', 'lc-test-h0@example.invalid', 'x', 'open', 'https://zoom.example.invalid/j/2')$q$);
  perform pg_temp.ck('C a booked room without its appointment is refused (23514)', s = '23514', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state)
                      values (gen_random_uuid(), 'lc-test-c0', 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x', 'open')$q$);
  perform pg_temp.ck('C an open room without a join link is refused (23514)', s = '23514', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
                      values (gen_random_uuid(), 'lc-test-c0', 'fallback', 'intro', 'meet', 'Lc-Test-H0@example.invalid', 'x')$q$);
  perform pg_temp.ck('C a host email that is not lower case is refused (23514)', s = '23514', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, link_channels)
                      values (gen_random_uuid(), 'lc-test-c0', 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x', '{sms}')$q$);
  perform pg_temp.ck('C an unknown link channel is refused (23514)', s = '23514', s);

  a := pg_temp.room('lc-test-c1', 'lc-test-h1@example.invalid', 'fallback');
  s := pg_temp.err(format($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
                             select request_id, 'lc-test-c99', 'fallback', 'intro', 'meet', 'lc-test-h99@example.invalid', 'x'
                               from public.cockpit_sales_rooms where id = %L$q$, a));
  perform pg_temp.ck('C a repeated request_id is refused (23505)', s = '23505', s);
  s := pg_temp.err(format($q$insert into public.cockpit_sales_rooms (request_id, code, contact_id, purpose, call_kind, provider, host_email, made_by)
                             select gen_random_uuid(), code, 'lc-test-c98', 'fallback', 'intro', 'meet', 'lc-test-h98@example.invalid', 'x'
                               from public.cockpit_sales_rooms where id = %L$q$, a));
  perform pg_temp.ck('C a repeated code is refused (23505)', s = '23505', s);

  s := pg_temp.err($q$select pg_temp.room('lc-test-c1', 'lc-test-h2@example.invalid', 'fallback')$q$);
  perform pg_temp.ck('C rooms_one_per_lead: a second open room for the lead is refused (23505)', s = '23505', s);
  update public.cockpit_sales_rooms set state = 'cancelled' where id = a;
  s := pg_temp.err($q$select pg_temp.room('lc-test-c1', 'lc-test-h2@example.invalid', 'fallback')$q$);
  perform pg_temp.ck('C rooms_one_per_lead: once the first is final, a new room is allowed', s = 'none', s);

  b := pg_temp.room('lc-test-c2', 'lc-test-h3@example.invalid', 'fallback');
  s := pg_temp.err($q$select pg_temp.room('lc-test-c3', 'lc-test-h3@example.invalid', 'manual')$q$);
  perform pg_temp.ck('C rooms_one_per_host: a second open room for the host is refused (23505)', s = '23505', s);
  s := pg_temp.err($q$select pg_temp.room('lc-test-c4', 'lc-test-h3@example.invalid', 'booked', 'open', 'demo', 'lc-test-appt-c4')$q$);
  perform pg_temp.ck('C rooms_one_per_host: a booked room is allowed beside it', s = 'none', s);

  update public.cockpit_sales_rooms set error = 'x' where id = b;
  update public.cockpit_sales_rooms set error = null where id = b;
  perform pg_temp.ck('C version goes up by one on every write', (select version = 3 from public.cockpit_sales_rooms where id = b));

  update public.cockpit_sales_rooms set state = 'creating' where id = b;
  select * into r from public.cockpit_sales_rooms where id = b;
  perform pg_temp.ck('C requested to creating stamps claimed_at', r.claimed_at = now());
  update public.cockpit_sales_rooms set state = 'requested' where id = b;
  perform pg_temp.ck('C creating back to requested is allowed (the worker lets go)',
    (select state = 'requested' from public.cockpit_sales_rooms where id = b));
  update public.cockpit_sales_rooms set state = 'open', join_url = 'https://zoom.example.invalid/j/3' where id = b;
  s := pg_temp.err(format('update public.cockpit_sales_rooms set state = %L where id = %L', 'requested', b));
  perform pg_temp.ck('C open back to requested is refused (P0001)', s = 'P0001', s);
  s := pg_temp.err(format('update public.cockpit_sales_rooms set state = %L where id = %L', 'creating', b));
  perform pg_temp.ck('C open back to creating is refused (P0001)', s = 'P0001', s);
  update public.cockpit_sales_rooms set state = 'host_in', host_by = now() - interval '1 hour' where id = b;
  update public.cockpit_sales_rooms set state = 'open' where id = b;
  perform pg_temp.ck('C host_in back to open: the host has handover_host (120 s) again',
    (select host_by = now() + interval '120 seconds' from public.cockpit_sales_rooms where id = b));
  update public.cockpit_sales_rooms set state = 'lead_in', lead_by = now() - interval '1 minute' where id = b;
  select * into r from public.cockpit_sales_rooms where id = b;
  perform pg_temp.ck('C open to lead_in stamps host_in_at, lead_in_at and opened_at',
    r.lead_in_at = now() and r.host_in_at is not null and r.opened_at is not null);
  s := pg_temp.err(format('update public.cockpit_sales_rooms set state = %L where id = %L', 'expired', b));
  perform pg_temp.ck('C lead_in to expired is refused (P0001)', s = 'P0001', s);
  s := pg_temp.err(format('update public.cockpit_sales_rooms set state = %L where id = %L', 'failed', b));
  perform pg_temp.ck('C lead_in to failed is refused (P0001)', s = 'P0001', s);
  update public.cockpit_sales_rooms set state = 'host_in' where id = b;
  select * into r from public.cockpit_sales_rooms where id = b;
  perform pg_temp.ck('C "That was not the lead": lead_in back to host_in clears lead_in_at and gives open_grace',
    r.state = 'host_in' and r.lead_in_at is null and r.lead_by = now() + interval '180 seconds');
  update public.cockpit_sales_rooms set state = 'lead_in' where id = b;
  update public.cockpit_sales_rooms set state = 'ended' where id = b;
  select * into r from public.cockpit_sales_rooms where id = b;
  perform pg_temp.ck('C lead_in to ended is allowed and stamps ended_at', r.state = 'ended' and r.ended_at = now());
  s := pg_temp.errm(format('update public.cockpit_sales_rooms set state = %L where id = %L', 'open', b));
  perform pg_temp.ck('C a finished room never reopens (P0001, names the code)',
    s like 'P0001:%' and position(r.code in s) > 0, s);
  s := pg_temp.err(format('update public.cockpit_sales_rooms set settled_mark = %L where id = %L', 'none', b));
  perform pg_temp.ck('C a finished room still takes non-state writes (settled_mark)', s = 'none', s);

  l := pg_temp.live('lc-test-c5', array['lc-test-k@example.invalid']);
  update public.cockpit_sales_live set state = 'expired' where id = l;
  s := pg_temp.err(format('update public.cockpit_sales_live set state = %L where id = %L', 'offered', l));
  perform pg_temp.ck('C a finished handover never changes state (P0001)', s = 'P0001', s);
  perform pg_temp.ck('C a finished handover has ended_at', (select ended_at = now() from public.cockpit_sales_live where id = l));
  s := pg_temp.err($q$insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
                      values (gen_random_uuid(), 'lc-test-c6', 'lc-test-setter@example.invalid', 'demo', 'on_call', '{Lc-Test@Example.invalid}', now())$q$);
  perform pg_temp.ck('C offered_to must be lower case (23514)', s = '23514', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, note, offered_to, offer_until)
                      values (gen_random_uuid(), 'lc-test-c6', 'lc-test-setter@example.invalid', 'demo', 'on_call', repeat('x', 201), '{}', now())$q$);
  perform pg_temp.ck('C a note over 200 characters is refused (23514)', s = '23514', s);
  l := pg_temp.live('lc-test-c7', array['lc-test-k@example.invalid']);
  s := pg_temp.err($q$select pg_temp.live('lc-test-c7', array['lc-test-k2@example.invalid'])$q$);
  perform pg_temp.ck('C live_one_open_per_lead: a second open handover for the lead is refused (23505)', s = '23505', s);

  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key) values (null, 'zoom.meeting.started', 'zoom', 'lc-test-dupe');
  s := pg_temp.err($q$insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key) values (null, 'zoom.meeting.started', 'zoom', 'lc-test-dupe')$q$);
  perform pg_temp.ck('C room_events: a repeated dedupe_key is refused (23505)', s = '23505', s);
  with ins as (
    insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key) values (null, 'zoom.meeting.started', 'zoom', 'lc-test-dupe')
    on conflict (dedupe_key) do nothing returning 1)
  select count(*)::text into s from ins;
  perform pg_temp.ck('C room_events: a late duplicate with on conflict do nothing writes nothing', s = '0', s);
  insert into public.cockpit_sales_alerts (dedupe_key, kind, message) values ('lc-test-alert', 'test', 'Test.');
  s := pg_temp.err($q$insert into public.cockpit_sales_alerts (dedupe_key, kind, message) values ('lc-test-alert', 'test', 'Test.')$q$);
  perform pg_temp.ck('C alerts: a repeated dedupe_key is refused (23505)', s = '23505', s);
  delete from public.cockpit_sales_alerts where dedupe_key = 'lc-test-alert';
exception when others then
  perform pg_temp.ck('C rooms section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- D. The claim: one Take wins.
do $$
declare
  l uuid; l2 uuid; won integer := 0; first_email text; e text; i integer; s text; v integer;
  got public.cockpit_sales_live; r public.cockpit_sales_rooms; sb uuid; emails text[];
begin
  select array_agg(format('lc-test-k%s@example.invalid', lpad(g::text, 2, '0'))) into emails from generate_series(1, 50) as g;
  l := pg_temp.live('lc-test-d1', emails);
  -- 50 presses in a scrambled order, as fifty closers and Slack would send them.
  for e in select x from unnest(emails) as x order by md5(x) loop
    select * into got from public.cockpit_sales_live_claim(l, e);
    if got.id is not null then
      won := won + 1;
      first_email := coalesce(first_email, e);
    end if;
  end loop;
  perform pg_temp.ck('D 50 claims on one offer: exactly one wins', won = 1, won::text);
  perform pg_temp.ck('D the winner is the first press, and the row says so',
    (select state = 'claimed' and claimed_by = first_email and claimed_at = now() from public.cockpit_sales_live where id = l)
    and first_email = (select x from unnest(emails) as x order by md5(x) limit 1));
  perform pg_temp.ck('D the same closer pressing again gets nothing back (sales-api reads claimed_by)',
    not exists (select 1 from public.cockpit_sales_live_claim(l, first_email)));

  l := pg_temp.live('lc-test-d2', array['lc-test-ka@example.invalid', 'lc-test-kb@example.invalid']);
  perform pg_temp.ck('D two claims in a row: the first wins',
    exists (select 1 from public.cockpit_sales_live_claim(l, 'lc-test-ka@example.invalid')));
  perform pg_temp.ck('D two claims in a row: the second gets nothing',
    not exists (select 1 from public.cockpit_sales_live_claim(l, 'LC-TEST-KB@example.invalid ')));

  l := pg_temp.live('lc-test-d3', array['lc-test-kc@example.invalid'], interval '-1 second');
  perform pg_temp.ck('D an offer past offer_until cannot be taken',
    not exists (select 1 from public.cockpit_sales_live_claim(l, 'lc-test-kc@example.invalid')));
  l := pg_temp.live('lc-test-d4', array['lc-test-kd@example.invalid']);
  perform pg_temp.ck('D a closer it was not offered to cannot take it',
    not exists (select 1 from public.cockpit_sales_live_claim(l, 'lc-test-kz@example.invalid')));
  perform pg_temp.ck('D a missing id or email takes nothing',
    not exists (select 1 from public.cockpit_sales_live_claim(null, 'lc-test-kd@example.invalid'))
    and not exists (select 1 from public.cockpit_sales_live_claim(l, null))
    and not exists (select 1 from public.cockpit_sales_live_claim(l, '  ')));
  select version into v from public.cockpit_sales_live where id = l;
  perform pg_temp.ck('D a stale version takes nothing',
    not exists (select 1 from public.cockpit_sales_live_claim(l, 'lc-test-kd@example.invalid', v + 1)));
  perform pg_temp.ck('D the version it saw takes it',
    exists (select 1 from public.cockpit_sales_live_claim(l, 'lc-test-kd@example.invalid', v)));
  l2 := pg_temp.live('lc-test-d5', array['lc-test-kd@example.invalid']);
  s := pg_temp.err(format('select * from public.cockpit_sales_live_claim(%L, %L)', l2, 'lc-test-kd@example.invalid'));
  perform pg_temp.ck('D live_one_claim_per_closer: a closer holding a live call cannot take another (23505)', s = '23505', s);
  perform pg_temp.ck('D after that refusal the second offer is still open',
    (select state = 'offered' and claimed_by is null from public.cockpit_sales_live where id = l2));

  -- The taker is in their standby room: it is adopted, the handover is room_ready.
  sb := pg_temp.room(null, 'lc-test-ks@example.invalid', 'standby', 'host_in', 'demo');
  l := pg_temp.live('lc-test-d6', array['lc-test-ks@example.invalid'], interval '2 minutes', 'demo');
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-ks@example.invalid');
  select * into r from public.cockpit_sales_rooms where id = sb;
  perform pg_temp.ck('D adopt a host_in standby room: handover room_ready with that room',
    got.state = 'room_ready' and got.room_id = sb and got.room_ready_at = now(), got.state);
  perform pg_temp.ck('D adopt a host_in standby room: lead set, purpose handover, link goes now, lead_by starts',
    r.contact_id = 'lc-test-d6' and r.purpose = 'handover' and r.handover_id = l and r.send_on = 'open'
    and r.call_kind = 'demo' and r.lead_by = now() + interval '600 seconds' and r.ends_at = now() + interval '60 minutes'
    and r.state = 'host_in');

  -- The taker's standby room exists but they are not in it yet.
  sb := pg_temp.room(null, 'lc-test-kt@example.invalid', 'standby', 'open', 'intro');
  l := pg_temp.live('lc-test-d7', array['lc-test-kt@example.invalid'], interval '2 minutes', 'intro');
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-kt@example.invalid');
  select * into r from public.cockpit_sales_rooms where id = sb;
  perform pg_temp.ck('D adopt an open standby room: claimed, link waits for the host, host has 120 s',
    got.state = 'claimed' and got.room_id = sb and r.purpose = 'handover' and r.send_on = 'host_in'
    and r.host_by = now() + interval '120 seconds' and r.ends_at = now() + interval '30 minutes');

  -- C16: the lead already has a room open. The claim stands, nothing is adopted.
  perform pg_temp.room('lc-test-d8', 'lc-test-setter8@example.invalid', 'fallback', 'open');
  sb := pg_temp.room(null, 'lc-test-ku@example.invalid', 'standby', 'host_in', 'demo');
  l := pg_temp.live('lc-test-d8', array['lc-test-ku@example.invalid']);
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-ku@example.invalid');
  perform pg_temp.ck('D the lead already has a room: the claim stands, no room is adopted',
    got.state = 'claimed' and got.room_id is null
    and (select purpose = 'standby' and contact_id is null from public.cockpit_sales_rooms where id = sb));

  perform pg_temp.ck('D a closer holding a handover is on_call in presence',
    (select state = 'on_call' and on_call_why = 'handover' from public.cockpit_sales_presence where email = 'lc-test-ks@example.invalid'));
exception when others then
  perform pg_temp.ck('D claim section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- E. Presence: on_call > ready > available > away.
do $$
declare
  sb uuid; att uuid; p record;
begin
  insert into public.cockpit_sales_availability (email, state, until) values
    ('lc-test-p-ready@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-p-avail@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-p-expired@example.invalid', 'available', now() - interval '1 minute'),
    ('lc-test-p-zoom@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-p-chain@example.invalid', 'available', now() + interval '1 hour');
  perform pg_temp.room(null, 'lc-test-p-ready@example.invalid', 'standby', 'host_in', 'demo');
  insert into public.cockpit_sales_room_hosts (email, zoom_live_until, default_provider)
    values ('lc-test-p-zoom@example.invalid', now() + interval '10 minutes', null);
  insert into public.cockpit_sales_attempts (contact_id, rep_email, state)
    values ('lc-test-e-att', 'lc-test-p-attempt@example.invalid', 'dialing');
  insert into public.cockpit_sales_attempts (contact_id, rep_email, state, started_at)
    values ('lc-test-e-att-old', 'lc-test-p-attempt-old@example.invalid', 'placed', now() - interval '3 hours');
  insert into public.cockpit_sales_people (email, name, role, active, ghl_user_id) values
    ('lc-test-p-attempt@example.invalid', 'Test', 'setter', true, null),
    ('lc-test-p-attempt-old@example.invalid', 'Test', 'setter', true, null),
    ('lc-test-p-appt@example.invalid', 'Test', 'closer', true, 'lc-test-ghl-appt'),
    ('lc-test-p-appt-old@example.invalid', 'Test', 'closer', true, 'lc-test-ghl-appt-old'),
    ('lc-test-p-demo@example.invalid', 'Test', 'closer', true, 'lc-test-ghl-demo');
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, status, assigned_user_id, start_at, origin) values
    ('lc-test-appt-e1', 'lc-test-e-c1', 'intro', 'confirmed', 'lc-test-ghl-appt', now() - interval '5 minutes', 'ghl'),
    ('lc-test-appt-e2', 'lc-test-e-c2', 'intro', 'confirmed', 'lc-test-ghl-appt-old', now() - interval '20 minutes', 'ghl'),
    ('lc-test-appt-e3', 'lc-test-e-c3', 'demo', 'confirmed', 'lc-test-ghl-demo', now() - interval '40 minutes', 'ghl');

  for p in select * from public.cockpit_sales_presence where email like 'lc-test-p-%' loop
    perform pg_temp.ck('E presence ' || p.email || ' is ' || coalesce(p.on_call_why, p.state),
      case p.email
        when 'lc-test-p-ready@example.invalid' then p.state = 'ready' and p.room_id is not null and p.until = now() + interval '1 hour'
        when 'lc-test-p-avail@example.invalid' then p.state = 'available' and p.until is not null
        when 'lc-test-p-expired@example.invalid' then p.state = 'away' and p.until is null
        when 'lc-test-p-zoom@example.invalid' then p.state = 'on_call' and p.on_call_why = 'zoom'
        when 'lc-test-p-chain@example.invalid' then p.state = 'available'
        when 'lc-test-p-attempt@example.invalid' then p.state = 'on_call' and p.on_call_why = 'attempt'
        when 'lc-test-p-attempt-old@example.invalid' then p.state = 'away'
        when 'lc-test-p-appt@example.invalid' then p.state = 'on_call' and p.on_call_why = 'appointment' and p.default_provider = 'zoom'
        when 'lc-test-p-appt-old@example.invalid' then p.state = 'away'
        when 'lc-test-p-demo@example.invalid' then p.state = 'on_call' and p.on_call_why = 'appointment'
        else false end,
      p.state || coalesce(' ' || p.on_call_why, ''));
  end loop;
  perform pg_temp.ck('E presence lists every test person once',
    (select count(*) = 10 and count(distinct email) = 10 from public.cockpit_sales_presence where email like 'lc-test-p-%'));
  perform pg_temp.ck('E default provider: setter meet, closer zoom',
    (select default_provider = 'meet' from public.cockpit_sales_presence where email = 'lc-test-p-attempt@example.invalid')
    and (select default_provider = 'zoom' from public.cockpit_sales_presence where email = 'lc-test-p-demo@example.invalid'));

  -- One person through every step: precedence on_call > ready > available > away.
  sb := pg_temp.room(null, 'lc-test-p-chain@example.invalid', 'standby', 'host_in', 'demo');
  insert into public.cockpit_sales_attempts (contact_id, rep_email, state)
    values ('lc-test-e-chain', 'lc-test-p-chain@example.invalid', 'dialing') returning id into att;
  perform pg_temp.ck('E precedence: available + ready + a dial is on_call',
    (select state = 'on_call' and on_call_why = 'attempt' from public.cockpit_sales_presence where email = 'lc-test-p-chain@example.invalid'));
  update public.cockpit_sales_attempts set state = 'saved' where id = att;
  perform pg_temp.ck('E precedence: the dial saved, in the standby room is ready',
    (select state = 'ready' and room_id = sb from public.cockpit_sales_presence where email = 'lc-test-p-chain@example.invalid'));
  update public.cockpit_sales_rooms set state = 'ended' where id = sb;
  perform pg_temp.ck('E precedence: the room ended, still available',
    (select state = 'available' from public.cockpit_sales_presence where email = 'lc-test-p-chain@example.invalid'));
  update public.cockpit_sales_availability set state = 'away', until = null where email = 'lc-test-p-chain@example.invalid';
  perform pg_temp.ck('E precedence: pressed away, away',
    (select state = 'away' from public.cockpit_sales_presence where email = 'lc-test-p-chain@example.invalid'));
  perform pg_temp.room('lc-test-e-lead', 'lc-test-p-chain@example.invalid', 'fallback', 'lead_in');
  perform pg_temp.ck('E precedence: away but a lead in their room is on_call',
    (select state = 'on_call' and on_call_why = 'room' from public.cockpit_sales_presence where email = 'lc-test-p-chain@example.invalid'));
  perform pg_temp.ck('E availability: available needs an until (23514)',
    pg_temp.err($q$insert into public.cockpit_sales_availability (email, state) values ('lc-test-p-x@example.invalid', 'available')$q$) = '23514');
exception when others then
  perform pg_temp.ck('E presence section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- F. The sweep: every timer on test rows, then a second run that moves nothing.
do $$
declare
  f uuid[] := array[]::uuid[];
  lv uuid[] := array[]::uuid[];
  rm uuid;
  ev uuid[] := array[]::uuid[];
  s1 jsonb;
  s2 jsonb;
  r public.cockpit_sales_rooms;
  l public.cockpit_sales_live;
  a public.cockpit_sales_availability;
  lead_in_before integer;
begin
  -- Rooms f[1]..f[25]. Hosts and leads are all different.
  f[1] := pg_temp.room('lc-test-f1', 'lc-test-f1@example.invalid', 'fallback');
  update public.cockpit_sales_rooms set requested_at = now() - interval '2 minutes' where id = f[1];
  f[2] := pg_temp.room('lc-test-f2', 'lc-test-f2@example.invalid', 'fallback');
  update public.cockpit_sales_rooms set requested_at = now() - interval '10 seconds' where id = f[2];
  f[3] := pg_temp.room('lc-test-f3', 'lc-test-f3@example.invalid', 'fallback', 'creating');
  update public.cockpit_sales_rooms set claimed_at = now() - interval '2 minutes' where id = f[3];
  f[4] := pg_temp.room('lc-test-f4', 'lc-test-f4@example.invalid', 'fallback', 'creating');
  update public.cockpit_sales_rooms set claimed_at = now() - interval '30 seconds' where id = f[4];
  f[5] := pg_temp.room('lc-test-f5', 'lc-test-f5@example.invalid', 'handover', 'open', 'demo');
  update public.cockpit_sales_rooms set host_by = now() - interval '1 second' where id = f[5];
  f[6] := pg_temp.room('lc-test-f6', 'lc-test-f6@example.invalid', 'fallback', 'open');
  update public.cockpit_sales_rooms set opened_at = now() - interval '20 minutes' where id = f[6];
  f[7] := pg_temp.room(null, 'lc-test-f7@example.invalid', 'standby', 'open', 'demo');
  update public.cockpit_sales_rooms set opened_at = now() - interval '6 minutes' where id = f[7];
  f[8] := pg_temp.room(null, 'lc-test-f8@example.invalid', 'standby', 'open', 'demo');
  update public.cockpit_sales_rooms set opened_at = now() - interval '2 minutes' where id = f[8];
  f[9] := pg_temp.room('lc-test-f9', 'lc-test-f9@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set link_sent_at = now() - interval '11 minutes' where id = f[9];
  f[10] := pg_temp.room('lc-test-f10', 'lc-test-f10@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set lead_by = now() - interval '1 minute', first_open_at = now() - interval '2 minutes' where id = f[10];
  f[11] := pg_temp.room('lc-test-f11', 'lc-test-f11@example.invalid', 'handover', 'host_in', 'demo');
  update public.cockpit_sales_rooms set lead_by = now() - interval '1 minute', lead_waiting_at = now() - interval '30 seconds' where id = f[11];
  f[12] := pg_temp.room('lc-test-f12', 'lc-test-f12@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set lead_by = now() - interval '5 minutes', first_open_at = now() - interval '4 minutes' where id = f[12];
  f[13] := pg_temp.room('lc-test-f13', 'lc-test-f13@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set lead_by = now() - interval '5 minutes', first_open_at = now() - interval '20 minutes',
                                        last_open_at = now() - interval '1 minute' where id = f[13];
  f[14] := pg_temp.room('lc-test-f14', 'lc-test-f14@example.invalid', 'handover', 'open', 'demo');
  update public.cockpit_sales_rooms set send_on = 'host_in', host_by = now() + interval '1 minute' where id = f[14];
  f[15] := pg_temp.room(null, 'lc-test-f15@example.invalid', 'standby', 'host_in', 'demo');
  update public.cockpit_sales_rooms set host_in_at = now() - interval '36 minutes' where id = f[15];
  f[16] := pg_temp.room(null, 'lc-test-f16@example.invalid', 'standby', 'host_in', 'demo');
  update public.cockpit_sales_rooms set host_in_at = now() - interval '10 minutes' where id = f[16];
  insert into public.cockpit_sales_people (email, name, role, active, ghl_user_id) values
    ('lc-test-f17@example.invalid', 'Test', 'closer', true, 'lc-test-ghl-f17'),
    ('lc-test-f18@example.invalid', 'Test', 'closer', true, 'lc-test-ghl-f18');
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, status, assigned_user_id, start_at, origin) values
    ('lc-test-appt-f17', 'lc-test-f17-lead', 'demo', 'confirmed', 'lc-test-ghl-f17', now() + interval '5 minutes', 'ghl'),
    ('lc-test-appt-f18', 'lc-test-f18-lead', 'demo', 'confirmed', 'lc-test-ghl-f18', now() + interval '20 minutes', 'ghl'),
    ('lc-test-appt-f25', 'lc-test-f25', 'intro', 'confirmed', 'lc-test-ghl-f25', now() - interval '21 minutes', 'ghl');
  f[17] := pg_temp.room(null, 'lc-test-f17@example.invalid', 'standby', 'host_in', 'demo');
  f[18] := pg_temp.room(null, 'lc-test-f18@example.invalid', 'standby', 'host_in', 'demo');
  f[19] := pg_temp.room('lc-test-f19', 'lc-test-f19@example.invalid', 'fallback', 'lead_in');
  update public.cockpit_sales_rooms set ends_at = now() - interval '31 minutes' where id = f[19];
  f[20] := pg_temp.room('lc-test-f20', 'lc-test-f20@example.invalid', 'fallback', 'lead_in');
  update public.cockpit_sales_rooms set ends_at = now() - interval '29 minutes' where id = f[20];
  f[21] := pg_temp.room('lc-test-f21', 'lc-test-f21@example.invalid', 'fallback', 'lead_in');
  update public.cockpit_sales_rooms set ends_at = now() + interval '10 minutes', lead_by = now() - interval '30 minutes',
                                        host_by = now() - interval '30 minutes' where id = f[21];
  insert into public.cockpit_sales_availability (email, state, until, via) values
    ('lc-test-f22@example.invalid', 'away', null, 'cockpit'),
    ('lc-test-f23@example.invalid', 'away', null, 'cockpit'),
    ('lc-test-f24@example.invalid', 'available', now() - interval '1 minute', 'cockpit'),
    ('lc-test-a1@example.invalid', 'available', now() - interval '1 minute', 'cockpit'),
    ('lc-test-a2@example.invalid', 'available', now() + interval '1 hour', 'cockpit');
  f[22] := pg_temp.room(null, 'lc-test-f22@example.invalid', 'standby', 'host_in', 'demo');
  update public.cockpit_sales_rooms set requested_at = now() - interval '2 minutes', host_in_at = now() - interval '1 minute' where id = f[22];
  f[23] := pg_temp.room(null, 'lc-test-f23@example.invalid', 'standby', 'host_in', 'demo');
  update public.cockpit_sales_rooms set requested_at = now() - interval '10 seconds' where id = f[23];
  f[24] := pg_temp.room(null, 'lc-test-f24@example.invalid', 'standby', 'creating', 'demo');
  update public.cockpit_sales_rooms set requested_at = now() - interval '2 minutes', claimed_at = now() - interval '10 seconds' where id = f[24];
  f[25] := pg_temp.room('lc-test-f25', 'lc-test-f25@example.invalid', 'booked', 'open', 'intro', 'lc-test-appt-f25');
  update public.cockpit_sales_rooms set host_by = now() - interval '6 minutes', lead_by = now() - interval '1 minute' where id = f[25];

  -- Handovers lv[1]..lv[10].
  insert into public.cockpit_sales_availability (email, state, until) values
    ('lc-test-la@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-lb@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-lc@example.invalid', 'away', null),
    ('lc-test-l5-other@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-l10-other@example.invalid', 'away', null);
  lv[1] := pg_temp.live('lc-test-l1', array['lc-test-la@example.invalid', 'lc-test-lb@example.invalid', 'lc-test-lc@example.invalid'],
                        interval '-1 second');
  update public.cockpit_sales_live set declined_by = array['lc-test-lb@example.invalid'] where id = lv[1];
  lv[2] := pg_temp.live('lc-test-l2', array['lc-test-l2@example.invalid']);
  update public.cockpit_sales_live set state = 'claimed', claimed_by = 'lc-test-l2@example.invalid', claimed_at = now() - interval '3 minutes' where id = lv[2];
  lv[3] := pg_temp.live('lc-test-l3', array['lc-test-l3@example.invalid']);
  update public.cockpit_sales_live set state = 'claimed', claimed_by = 'lc-test-l3@example.invalid', claimed_at = now() - interval '30 seconds' where id = lv[3];
  rm := pg_temp.room('lc-test-l3', 'lc-test-l3@example.invalid', 'handover', 'failed', 'demo');
  update public.cockpit_sales_rooms set handover_id = lv[3] where id = rm;
  update public.cockpit_sales_live set room_id = rm where id = lv[3];
  lv[4] := pg_temp.live('lc-test-l4', array['lc-test-l4@example.invalid']);
  update public.cockpit_sales_live set state = 'claimed', claimed_by = 'lc-test-l4@example.invalid', claimed_at = now() - interval '30 seconds' where id = lv[4];
  -- lv[5]: the taker left the room before the lead came, another closer is available: offered again.
  lv[5] := pg_temp.live('lc-test-l5', array['lc-test-l5-taker@example.invalid', 'lc-test-l5-other@example.invalid']);
  rm := pg_temp.room('lc-test-l5', 'lc-test-l5-taker@example.invalid', 'handover', 'expired', 'demo');
  update public.cockpit_sales_rooms set end_reason = 'host_not_in', lead_by = now() + interval '5 minutes', handover_id = lv[5] where id = rm;
  update public.cockpit_sales_live set state = 'room_ready', claimed_by = 'lc-test-l5-taker@example.invalid', room_id = rm where id = lv[5];
  -- lv[6]: the same, already offered again once: it ends.
  lv[6] := pg_temp.live('lc-test-l6', array['lc-test-l6-taker@example.invalid', 'lc-test-l5-other@example.invalid']);
  rm := pg_temp.room('lc-test-l6', 'lc-test-l6-taker@example.invalid', 'handover', 'expired', 'demo');
  update public.cockpit_sales_rooms set end_reason = 'host_not_in', lead_by = now() + interval '5 minutes', handover_id = lv[6] where id = rm;
  update public.cockpit_sales_live set state = 'room_ready', reoffers = 1, claimed_by = 'lc-test-l6-taker@example.invalid', room_id = rm where id = lv[6];
  -- lv[7]: the lead did not join.
  lv[7] := pg_temp.live('lc-test-l7', array['lc-test-l7@example.invalid']);
  rm := pg_temp.room('lc-test-l7', 'lc-test-l7@example.invalid', 'handover', 'expired', 'demo');
  update public.cockpit_sales_rooms set end_reason = 'lead_no_show', handover_id = lv[7] where id = rm;
  update public.cockpit_sales_live set state = 'room_ready', claimed_by = 'lc-test-l7@example.invalid', room_id = rm where id = lv[7];
  -- lv[8]: the lead joined and the call ended.
  lv[8] := pg_temp.live('lc-test-l8', array['lc-test-l8@example.invalid']);
  rm := pg_temp.room('lc-test-l8', 'lc-test-l8@example.invalid', 'handover', 'lead_in', 'demo');
  update public.cockpit_sales_rooms set handover_id = lv[8] where id = rm;
  update public.cockpit_sales_rooms set state = 'ended' where id = rm;
  update public.cockpit_sales_live set state = 'lead_joined', claimed_by = 'lc-test-l8@example.invalid', room_id = rm where id = lv[8];
  -- lv[9]: room_ready with the taker still in the room: nothing to do.
  lv[9] := pg_temp.live('lc-test-l9', array['lc-test-l9@example.invalid']);
  rm := pg_temp.room('lc-test-l9', 'lc-test-l9@example.invalid', 'handover', 'host_in', 'demo');
  update public.cockpit_sales_rooms set handover_id = lv[9], lead_by = now() + interval '5 minutes' where id = rm;
  update public.cockpit_sales_live set state = 'room_ready', claimed_by = 'lc-test-l9@example.invalid', room_id = rm where id = lv[9];
  -- lv[10]: the taker left, but nobody else is ready or available: it ends.
  lv[10] := pg_temp.live('lc-test-l10', array['lc-test-l10-taker@example.invalid', 'lc-test-l10-other@example.invalid']);
  rm := pg_temp.room('lc-test-l10', 'lc-test-l10-taker@example.invalid', 'handover', 'expired', 'demo');
  update public.cockpit_sales_rooms set end_reason = 'host_not_in', lead_by = now() + interval '5 minutes', handover_id = lv[10] where id = rm;
  update public.cockpit_sales_live set state = 'room_ready', claimed_by = 'lc-test-l10-taker@example.invalid', room_id = rm where id = lv[10];

  -- Events ev[1]..ev[6].
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, tries) values
    (f[9], 'zoom.meeting.participant_joined', 'zoom', 'lc-test-e1', now() - interval '30 seconds', null, 0),
    (f[9], 'zoom.meeting.participant_joined', 'zoom', 'lc-test-e2', now() - interval '5 seconds', null, 0),
    (f[9], 'link_sent', 'sales-api', 'lc-test-e3', now() - interval '1 minute', null, 0),
    (f[9], 'zoom.meeting.started', 'zoom', 'lc-test-e4', now() - interval '1 minute', now() - interval '50 seconds', 0),
    (f[9], 'zoom.meeting.ended', 'zoom', 'lc-test-e5', now() - interval '5 minutes', null, 3),
    (f[9], 'worker.ready', 'worker', 'lc-test-e6', now() - interval '25 seconds', null, 0);
  select array_agg(e.id order by e.dedupe_key) into ev from public.cockpit_sales_room_events as e where e.dedupe_key like 'lc-test-e_';

  select count(*) into lead_in_before from public.cockpit_sales_rooms where state = 'lead_in';

  s1 := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('F sweep ran with no rule errors', jsonb_array_length(s1 -> 'errors') = 0, (s1 -> 'errors')::text);

  select * into r from public.cockpit_sales_rooms where id = f[1];
  perform pg_temp.ck('F requested past fail (60 s): failed, request_timeout, error says what to do',
    r.state = 'failed' and r.end_reason = 'request_timeout' and r.result = 'failed' and r.error like '%Try again.' and r.ended_at = now());
  perform pg_temp.ck('F requested 10 s ago: still requested', (select state = 'requested' from public.cockpit_sales_rooms where id = f[2]));
  select * into r from public.cockpit_sales_rooms where id = f[3];
  perform pg_temp.ck('F creating past fail: failed, create_timeout', r.state = 'failed' and r.end_reason = 'create_timeout' and r.error is not null);
  perform pg_temp.ck('F creating 30 s ago: still creating', (select state = 'creating' from public.cockpit_sales_rooms where id = f[4]));
  select * into r from public.cockpit_sales_rooms where id = f[5];
  perform pg_temp.ck('F open past host_by: expired, host_not_in, no_join',
    r.state = 'expired' and r.end_reason = 'host_not_in' and r.result = 'no_join');
  perform pg_temp.ck('F open fallback, no host_by, opened 20 min ago: expired (fallback_host 900 s)',
    (select state = 'expired' and end_reason = 'host_not_in' from public.cockpit_sales_rooms where id = f[6]));
  perform pg_temp.ck('F open standby, no host_by, opened 6 min ago: expired (standby_host 300 s)',
    (select state = 'expired' from public.cockpit_sales_rooms where id = f[7]));
  perform pg_temp.ck('F open standby opened 2 min ago: still open', (select state = 'open' from public.cockpit_sales_rooms where id = f[8]));
  perform pg_temp.ck('F host_in, link sent 11 min ago, no lead_by: expired, lead_no_show (lead 600 s)',
    (select state = 'expired' and end_reason = 'lead_no_show' and result = 'no_join' from public.cockpit_sales_rooms where id = f[9]));
  perform pg_temp.ck('F lead_by passed but the link was opened 2 min ago: kept open (open_grace)',
    (select state = 'host_in' from public.cockpit_sales_rooms where id = f[10]));
  perform pg_temp.ck('F lead_by passed but the lead knocked 30 s ago: kept open',
    (select state = 'host_in' from public.cockpit_sales_rooms where id = f[11]));
  perform pg_temp.ck('F lead_by passed, last open 4 min ago (grace over): expired',
    (select state = 'expired' and end_reason = 'lead_no_show' from public.cockpit_sales_rooms where id = f[12]));
  perform pg_temp.ck('F lead_by passed, an early first open but a later open 1 min ago: kept open',
    (select state = 'host_in' from public.cockpit_sales_rooms where id = f[13]));
  perform pg_temp.ck('F a handover room that sent no link yet has no lead deadline: still open',
    (select state = 'open' from public.cockpit_sales_rooms where id = f[14]));
  perform pg_temp.ck('F standby in the room 36 min: ended, standby_refresh',
    (select state = 'ended' and end_reason = 'standby_refresh' and result is null from public.cockpit_sales_rooms where id = f[15]));
  perform pg_temp.ck('F standby in the room 10 min: still host_in', (select state = 'host_in' from public.cockpit_sales_rooms where id = f[16]));
  perform pg_temp.ck('F standby with a booked call in 5 min: ended, booked_call_soon',
    (select state = 'ended' and end_reason = 'booked_call_soon' from public.cockpit_sales_rooms where id = f[17]));
  perform pg_temp.ck('F standby with a booked call in 20 min: still host_in', (select state = 'host_in' from public.cockpit_sales_rooms where id = f[18]));
  select * into r from public.cockpit_sales_rooms where id = f[19];
  perform pg_temp.ck('F lead_in 31 min past ends_at: ended, no_end_signal, joined',
    r.state = 'ended' and r.end_reason = 'no_end_signal' and r.result = 'joined');
  perform pg_temp.ck('F lead_in 29 min past ends_at: never touched', (select state = 'lead_in' from public.cockpit_sales_rooms where id = f[20]));
  perform pg_temp.ck('F lead_in with lead_by and host_by long past: never touched (no rule ends a room with the lead in it)',
    (select state = 'lead_in' and end_reason is null from public.cockpit_sales_rooms where id = f[21]));
  perform pg_temp.ck('F only the no_end_signal room left lead_in',
    (select count(*) from public.cockpit_sales_rooms where state = 'lead_in') = lead_in_before - 1);
  perform pg_temp.ck('F standby whose host is away: ended, host_away',
    (select state = 'ended' and end_reason = 'host_away' from public.cockpit_sales_rooms where id = f[22]));
  perform pg_temp.ck('F standby made 10 s ago, host away: kept (60 s grace for the Available press)',
    (select state = 'host_in' from public.cockpit_sales_rooms where id = f[23]));
  perform pg_temp.ck('F standby still being made when Available ran out: cancelled, host_away',
    (select state = 'cancelled' and end_reason = 'host_away' from public.cockpit_sales_rooms where id = f[24]));
  perform pg_temp.ck('F booked intro past host_by: expired, and counted as waiting for room.settle',
    (select state = 'expired' from public.cockpit_sales_rooms where id = f[25]) and (s1 ->> 'settle_due')::integer >= 1, s1 ->> 'settle_due');

  select * into a from public.cockpit_sales_availability where email = 'lc-test-a1@example.invalid';
  perform pg_temp.ck('F Available ran out: away, reason expired, via sweep', a.state = 'away' and a.reason = 'expired' and a.via = 'sweep' and a.until is null);
  perform pg_temp.ck('F Available with time left: unchanged',
    (select state = 'available' from public.cockpit_sales_availability where email = 'lc-test-a2@example.invalid'));

  select * into l from public.cockpit_sales_live where id = lv[1];
  perform pg_temp.ck('F offer past offer_until: expired, no_rep', l.state = 'expired' and l.end_reason = 'no_rep' and l.ended_at = now());
  perform pg_temp.ck('F a closer who missed it is away (missed_offer)',
    (select state = 'away' and reason = 'missed_offer' from public.cockpit_sales_availability where email = 'lc-test-la@example.invalid'));
  perform pg_temp.ck('F a closer who pressed Not now stays available',
    (select state = 'available' from public.cockpit_sales_availability where email = 'lc-test-lb@example.invalid'));
  perform pg_temp.ck('F a closer already away keeps their reason',
    (select state = 'away' and reason is null from public.cockpit_sales_availability where email = 'lc-test-lc@example.invalid'));
  perform pg_temp.ck('F claimed 3 min ago, taker never in a room: expired, rep_not_in_room',
    (select state = 'expired' and end_reason = 'rep_not_in_room' from public.cockpit_sales_live where id = lv[2]));
  perform pg_temp.ck('F claimed and the room failed: failed, room_failed',
    (select state = 'failed' and end_reason = 'room_failed' from public.cockpit_sales_live where id = lv[3]));
  perform pg_temp.ck('F claimed 30 s ago: still claimed', (select state = 'claimed' from public.cockpit_sales_live where id = lv[4]));
  select * into l from public.cockpit_sales_live where id = lv[5];
  perform pg_temp.ck('F taker left before the lead: offered again once, to the closer still available',
    l.state = 'offered' and l.reoffers = 1 and l.claimed_by is null and l.room_id is null
    and l.offered_to = array['lc-test-l5-other@example.invalid'] and l.offer_until = now() + interval '120 seconds',
    l.state || ' ' || l.offered_to::text);
  perform pg_temp.ck('F taker left again after the one re-offer: expired, rep_not_in_room',
    (select state = 'expired' and end_reason = 'rep_not_in_room' from public.cockpit_sales_live where id = lv[6]));
  perform pg_temp.ck('F the lead did not join: expired, lead_no_show',
    (select state = 'expired' and end_reason = 'lead_no_show' from public.cockpit_sales_live where id = lv[7]));
  perform pg_temp.ck('F the call with the lead ended: done, room_ended',
    (select state = 'done' and end_reason = 'room_ended' from public.cockpit_sales_live where id = lv[8]));
  perform pg_temp.ck('F room_ready with the taker in the room: unchanged', (select state = 'room_ready' from public.cockpit_sales_live where id = lv[9]));
  perform pg_temp.ck('F taker left and nobody else is free: expired, rep_not_in_room',
    (select state = 'expired' and end_reason = 'rep_not_in_room' from public.cockpit_sales_live where id = lv[10]));

  perform pg_temp.ck('F replay: zoom and worker events unhandled past 20 s go back to room.event, once each',
    (s1 -> 'replay') @> to_jsonb(array[ev[1]::text, ev[6]::text]) and jsonb_array_length(s1 -> 'replay') = 2,
    (s1 -> 'replay')::text);
  perform pg_temp.ck('F replay: tries counted on the replayed events only',
    (select bool_and(tries = case when id in (ev[1], ev[6]) then 1 when id = ev[5] then 3 else 0 end) from public.cockpit_sales_room_events where id = any (ev)));

  perform pg_temp.ck('F every room the sweep closed has one sweep event and one audit row',
    (select bool_and(
       (select count(*) from public.cockpit_sales_room_events as e where e.room_id = x.id and e.source = 'sweep') = 1
       and (select count(*) from public.cockpit_audit_log as au where au.action = 'room.sweep' and au.entity_id = x.id::text) = 1)
       from public.cockpit_sales_rooms as x where x.id = any (f) and x.end_reason is not null));
  perform pg_temp.ck('F the sweep counted what it moved',
    (s1 ->> 'rooms_moved')::integer = (select count(*) from public.cockpit_audit_log where action = 'room.sweep')
    and (s1 ->> 'handovers_moved')::integer = (select count(*) from public.cockpit_audit_log where action = 'live.sweep'),
    s1::text);
  perform pg_temp.ck('F status row sales-api/sweep written, ok',
    (select ok and at = now() from public.cockpit_sales_worker_status where worker = 'sales-api' and job = 'sweep'));

  s2 := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('F a second run in the same minute moves nothing and replays nothing',
    (s2 ->> 'rooms_moved')::integer = 0 and (s2 ->> 'handovers_moved')::integer = 0 and jsonb_array_length(s2 -> 'replay') = 0,
    s2::text);
  -- A bad setting cannot stop the sweep: waits fall back to their defaults.
  update public.cockpit_sales_settings set value = jsonb_set(value, '{waits_s}', '{"fail": "soon", "lead": -5}') where key = 'rooms';
  s2 := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('F a broken waits_s setting falls back to the defaults (no error, nothing moved)',
    jsonb_array_length(s2 -> 'errors') = 0 and (s2 ->> 'rooms_moved')::integer = 0, s2::text);
exception when others then
  perform pg_temp.ck('F sweep section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- G. The watchdog: hours, one alert per incident, no webhook, then a test webhook.
do $$
declare
  w jsonb;
  n integer;
  hours boolean := public.cockpit_sales_alert_hours(now());
  note text;
begin
  perform pg_temp.ck('G hours: Friday 10:00 Kuwait is off', not public.cockpit_sales_alert_hours('2026-10-02 10:00:00+03'));
  perform pg_temp.ck('G hours: Saturday 08:59 Kuwait is off', not public.cockpit_sales_alert_hours('2026-10-03 08:59:00+03'));
  perform pg_temp.ck('G hours: Saturday 09:00 Kuwait is on', public.cockpit_sales_alert_hours('2026-10-03 09:00:00+03'));
  perform pg_temp.ck('G hours: Thursday 20:59 Kuwait is on', public.cockpit_sales_alert_hours('2026-10-08 20:59:00+03'));
  perform pg_temp.ck('G hours: Thursday 21:00 Kuwait is off', not public.cockpit_sales_alert_hours('2026-10-08 21:00:00+03'));

  -- Known inputs: rooms on with no worker row, doctor stale, follow-ups failing,
  -- sweep fresh, no webhook in the vault, no other alerts.
  delete from public.cockpit_sales_alerts;
  update public.cockpit_sales_settings set value = jsonb_set(value, '{enabled}', 'true') where key = 'rooms';
  delete from public.cockpit_sales_worker_status where worker = 'sales-desk' and job in ('rooms', 'slack', 'watch');
  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at) values
    ('sales-desk', 'doctor', true, 'ok', now() - interval '2 hours'),
    ('sales-desk', 'followups', false, E'Claude sign-in\nlapsed', now() - interval '1 minute'),
    ('sales-api', 'sweep', true, 'ok', now())
  on conflict (worker, job) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at;
  update public.cockpit_sales_room_events set handled_at = now() where handled_at is null;
  perform pg_temp.err($q$delete from vault.secrets where name = 'sales_alerts_slack_webhook'$q$);

  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G no webhook: three incidents raised, nothing posted',
    (w ->> 'raised')::integer = 3 and (w ->> 'posted')::integer = 0 and (w ->> 'webhook')::boolean = false, w::text);
  perform pg_temp.ck('G the three open alerts are the missing room worker, the stale doctor and the failing follow-ups',
    (select array_agg(dedupe_key order by dedupe_key) from public.cockpit_sales_alerts where resolved_at is null)
      = array['failing:sales-desk/followups', 'missing:sales-desk/rooms', 'stale:sales-desk/doctor']);
  perform pg_temp.ck('G alert copy is a plain sentence that says what is broken',
    (select message = 'The room worker has never reported. New video rooms cannot be made.'
       from public.cockpit_sales_alerts where dedupe_key = 'missing:sales-desk/rooms')
    and (select message like 'The sales desk doctor has not run since %. Nobody is checking the desk. Check the VPS and the Claude sign-in.'
           from public.cockpit_sales_alerts where dedupe_key = 'stale:sales-desk/doctor')
    and (select message like 'The follow-up drafter reported a problem at %: Claude sign-in lapsed. No new follow-ups are being drafted.'
           from public.cockpit_sales_alerts where dedupe_key = 'failing:sales-desk/followups'));
  note := case when hours then 'Recorded only: the vault has no sales_alerts_slack_webhook.'
               else 'Waiting for working hours: Saturday to Thursday, 09:00 to 21:00 Kuwait time.' end;
  perform pg_temp.ck('G no webhook: each open alert says why it was not posted',
    (select bool_and(posted_at is null and post_error = note and post_tries = 0) from public.cockpit_sales_alerts where resolved_at is null),
    note);
  perform pg_temp.ck('G status row sales-api/watchdog written',
    (select ok and at = now() from public.cockpit_sales_worker_status where worker = 'sales-api' and job = 'watchdog'));
  perform pg_temp.ck('G switched-off and never-seen workers raise nothing (slack, watch, threads)',
    not exists (select 1 from public.cockpit_sales_alerts where subject in ('sales-desk/slack', 'sales-desk/watch', 'sales-api/threads')));

  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G second run: the same incidents raise nothing new',
    (w ->> 'raised')::integer = 0 and (select count(*) = 3 from public.cockpit_sales_alerts), w::text);

  update public.cockpit_sales_worker_status set ok = true, detail = 'ok' where worker = 'sales-desk' and job = 'followups';
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G follow-ups recovered: that incident is resolved and its key freed',
    (select count(*) = 1 from public.cockpit_sales_alerts
      where dedupe_key like 'failing:sales-desk/followups:resolved:%' and resolved_at = now())
    and not exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'failing:sales-desk/followups'));
  update public.cockpit_sales_worker_status set ok = false, detail = 'failed again' where worker = 'sales-desk' and job = 'followups';
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G follow-ups failing again: a new incident, a new row',
    (w ->> 'raised')::integer = 1
    and (select count(*) = 2 from public.cockpit_sales_alerts where subject = 'sales-desk/followups' and kind = 'failing'), w::text);
  update public.cockpit_sales_settings set value = jsonb_set(value, '{enabled}', 'false') where key = 'rooms';
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G rooms switched off: the missing room worker alert resolves',
    not exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'missing:sales-desk/rooms'));
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at)
    values (null, 'zoom.meeting.ended', 'zoom', 'lc-test-g-stuck', now() - interval '11 minutes');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G a Zoom event unhandled for 10 minutes raises an alert',
    exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'room_events_unhandled' and resolved_at is null));
  update public.cockpit_sales_room_events set handled_at = now() where dedupe_key = 'lc-test-g-stuck';

  -- A test webhook. The address can never resolve, and the queued request is
  -- rolled back with the rest of this run, so nothing is sent.
  perform vault.create_secret('https://hooks.example.invalid/services/T0/B0/lc-test', 'sales_alerts_slack_webhook', 'lc-db test, rolled back');
  w := public.cockpit_sales_watchdog();
  if hours then
    select count(*) into n from public.cockpit_sales_alerts where resolved_at is null;
    perform pg_temp.ck('G with a webhook in hours: every open alert is posted once, with its request id',
      (w ->> 'posted')::integer = n and n > 0
      and (select bool_and(posted_at = now() and post_request_id is not null and post_tries = 1 and post_error is null)
             from public.cockpit_sales_alerts where resolved_at is null), w::text);
    perform pg_temp.ck('G the posts are queued for the test address only (rolled back, never sent)',
      (select count(*) from net.http_request_queue where url like 'https://hooks.example.invalid/%') = n
      and (select bool_and(body is not null) from net.http_request_queue where url like 'https://hooks.example.invalid/%'));
    w := public.cockpit_sales_watchdog();
    perform pg_temp.ck('G an alert already posted is not posted again', (w ->> 'posted')::integer = 0, w::text);
  else
    perform pg_temp.ck('G with a webhook outside hours: nothing posted until 09:00', (w ->> 'posted')::integer = 0, w::text);
  end if;
exception when others then
  perform pg_temp.ck('G watchdog section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- G2. A failed post is tried again, three tries at most (needs a fake answer
--     in pg_net's response table; skipped with a note if that is not allowed).
do $$
declare
  w jsonb; aid uuid; s text;
begin
  delete from public.cockpit_sales_alerts;
  insert into public.cockpit_sales_alerts (dedupe_key, kind, message, posted_at, post_request_id, post_tries)
    values ('lc-test-retry', 'test', 'Test alert.', now() - interval '5 minutes', -424242, 1) returning id into aid;
  s := pg_temp.errm($q$insert into net._http_response (id, status_code, content, timed_out, error_msg, created)
                      values (-424242, 500, 'oops', false, null, now())$q$);
  if s <> 'none' then
    perform pg_temp.ck('G2 retry check skipped: cannot write a fake answer into net._http_response', true, s);
    return;
  end if;
  w := public.cockpit_sales_watchdog();
  if public.cockpit_sales_alert_hours(now()) and (w ->> 'webhook')::boolean then
    perform pg_temp.ck('G2 a 500 from Slack: the alert is posted again (try 2)',
      (select post_tries = 2 and posted_at = now() and post_status is null and post_request_id <> -424242
         from public.cockpit_sales_alerts where id = aid),
      (select row_to_json(x)::text from (select post_status, post_tries, posted_at, post_error from public.cockpit_sales_alerts where id = aid) as x));
  else
    perform pg_temp.ck('G2 a 500 from Slack: recorded, waiting to be posted again',
      (select post_status = 500 and post_error = 'Slack answered 500' and posted_at is null and post_tries = 1
         from public.cockpit_sales_alerts where id = aid),
      (select row_to_json(x)::text from (select post_status, post_tries, posted_at, post_error from public.cockpit_sales_alerts where id = aid) as x));
  end if;
  update public.cockpit_sales_alerts set posted_at = now() - interval '5 minutes', post_request_id = -424242, post_tries = 3, post_status = null
   where id = aid;
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G2 after 3 tries it stops and keeps the error',
    (select post_status = 500 and post_error = 'Slack answered 500' and posted_at is not null and post_tries = 3
       from public.cockpit_sales_alerts where id = aid));
exception when others then
  perform pg_temp.ck('G2 retry section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- H. The two cron commands run as written (nothing to replay, so no post).
do $$
declare
  cmd text; before_n integer; s text;
begin
  update public.cockpit_sales_room_events set handled_at = now() where handled_at is null;
  select count(*) into before_n from net.http_request_queue where url like '%/functions/v1/sales-live/cron';
  select command into cmd from cron.job where jobname = 'mahara-sales-rooms-sweep';
  s := pg_temp.errm(cmd);
  perform pg_temp.ck('H the sweep job command runs', s = 'none', s);
  perform pg_temp.ck('H with nothing to replay it posts nothing',
    (select count(*) from net.http_request_queue where url like '%/functions/v1/sales-live/cron') = before_n);
  select command into cmd from cron.job where jobname = 'mahara-sales-watchdog';
  s := pg_temp.errm(cmd);
  perform pg_temp.ck('H the watchdog job command runs', s = 'none', s);
exception when others then
  perform pg_temp.ck('H cron section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- I. 20261003b: the two widened checks.
do $$
declare
  s text;
begin
  s := pg_temp.err($q$insert into public.cockpit_sales_messages (request_id, contact_id, channel, body, source, sent_by)
                      values (gen_random_uuid(), 'lc-test-i1', 'whatsapp', 'Test.', 'room', 'lc-test@example.invalid')$q$);
  perform pg_temp.ck('I messages accept source room', s = 'none', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_messages (request_id, contact_id, channel, body, source, sent_by)
                      values (gen_random_uuid(), 'lc-test-i2', 'whatsapp', 'Test.', 'thread', 'lc-test@example.invalid')$q$);
  perform pg_temp.ck('I messages accept source thread', s = 'none', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_messages (request_id, contact_id, channel, body, source, sent_by)
                      values (gen_random_uuid(), 'lc-test-i3', 'whatsapp', 'Test.', 'rep', 'lc-test@example.invalid')$q$);
  perform pg_temp.ck('I messages still accept source rep', s = 'none', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_messages (request_id, contact_id, channel, body, source, sent_by)
                      values (gen_random_uuid(), 'lc-test-i4', 'whatsapp', 'Test.', 'bogus', 'lc-test@example.invalid')$q$);
  perform pg_temp.ck('I messages refuse an unknown source (23514)', s = '23514', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why)
                      values ('lc-test-i5', 'good_intro', 'whatsapp', 'Test.', 'Test.')$q$);
  perform pg_temp.ck('I follow-ups accept good_intro', s = 'none', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why)
                      values ('lc-test-i6', 'reactivate', 'whatsapp_template', 'Test.', 'Test.')$q$);
  perform pg_temp.ck('I follow-ups accept reactivate', s = 'none', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why)
                      values ('lc-test-i7', 'no_show', 'whatsapp', 'Test.', 'Test.')$q$);
  perform pg_temp.ck('I follow-ups still accept no_show', s = 'none', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why)
                      values ('lc-test-i8', 'bogus', 'whatsapp', 'Test.', 'Test.')$q$);
  perform pg_temp.ck('I follow-ups refuse an unknown segment (23514)', s = '23514', s);
  perform pg_temp.ck('I every existing row still passes both checks',
    not exists (select 1 from pg_constraint where conname in ('cockpit_sales_messages_source_check', 'cockpit_sales_followups_segment_check')
                  and not convalidated));
exception when others then
  perform pg_temp.ck('I hooks section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- J. 20261003c: levels and waves.
do $$
declare
  w1 uuid; w2 uuid; s text;
begin
  update public.cockpit_sales_settings set value = value - 'connector_off' - 'single_copy_ok_at' where key = 'whatsapp_guard';
  s := pg_temp.errm($q$insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('no_show:ar:whatsapp_template', 'sends_by_itself', 'lc-test')$q$);
  perform pg_temp.ck('J a WhatsApp kind cannot send by itself before the connector is off and the single-copy test passed (P0001)',
    s like 'P0001: WhatsApp follow-ups stay on Approve%', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('no_show:ar:email', 'sends_by_itself', 'lc-test')$q$);
  perform pg_temp.ck('J an email kind can send by itself', s = 'none', s);
  insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('no_show:en:whatsapp_template', 'approve', 'lc-test');
  s := pg_temp.err($q$update public.cockpit_sales_followup_levels set level = 'send_unless_stopped' where kind_key = 'no_show:en:whatsapp_template'$q$);
  perform pg_temp.ck('J a WhatsApp kind cannot move to Sends unless stopped either (P0001)', s = 'P0001', s);
  update public.cockpit_sales_settings
     set value = value || '{"connector_off": true, "single_copy_ok_at": "2026-10-03T10:00:00Z"}'::jsonb where key = 'whatsapp_guard';
  s := pg_temp.err($q$update public.cockpit_sales_followup_levels set level = 'send_unless_stopped' where kind_key = 'no_show:en:whatsapp_template'$q$);
  perform pg_temp.ck('J once the connector is off and the test passed, it can', s = 'none', s);
  perform pg_temp.ck('J levels keep a version',
    (select version = 2 from public.cockpit_sales_followup_levels where kind_key = 'no_show:en:whatsapp_template'));
  s := pg_temp.err($q$insert into public.cockpit_sales_followup_levels (kind_key, level) values ('No Show', 'approve')$q$);
  perform pg_temp.ck('J a malformed kind key is refused (23514)', s = '23514', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_followup_levels (kind_key, level) values ('no_show:ar:sms', 'always')$q$);
  perform pg_temp.ck('J an unknown level is refused (23514)', s = '23514', s);

  insert into public.cockpit_sales_followup_waves (pool, segment, state, made_by) values ('no_show_cancelled', 'no_show', 'running', 'lc-test')
    returning id into w1;
  insert into public.cockpit_sales_followup_waves (pool, segment, state, made_by) values ('good_intro', 'good_intro', 'running', 'lc-test')
    returning id into w2;
  perform pg_temp.ck('J a running wave gets started_at', (select started_at = now() from public.cockpit_sales_followup_waves where id = w1));
  insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm) values
    (w1, 'lc-test-j1', 'wave'), (w1, 'lc-test-j2', 'holdout'), (w1, 'lc-test-j3', 'wave');
  update public.cockpit_sales_followup_wave_members set state = 'sent' where wave_id = w1 and contact_id = 'lc-test-j3';
  s := pg_temp.err(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm) values (%L, 'lc-test-j1', 'wave')$q$, w2));
  perform pg_temp.ck('J one running wave per contact: a second wave is refused (23505)', s = '23505', s);
  s := pg_temp.err(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm) values (%L, 'lc-test-j2', 'wave')$q$, w2));
  perform pg_temp.ck('J a holdout contact cannot be put in another wave while its wave runs (23505)', s = '23505', s);
  s := pg_temp.err(format($q$update public.cockpit_sales_followup_wave_members set state = 'drafted' where wave_id = %L and contact_id = 'lc-test-j2'$q$, w1));
  perform pg_temp.ck('J a holdout member is never drafted (23514)', s = '23514', s);
  perform pg_temp.ck('J a sent member has sent_at', (select sent_at = now() from public.cockpit_sales_followup_wave_members where contact_id = 'lc-test-j3'));
  update public.cockpit_sales_followup_waves set state = 'done' where id = w1;
  perform pg_temp.ck('J a wave that is done closes its members: waiting excluded, holdout done, sent done',
    (select state = 'excluded' from public.cockpit_sales_followup_wave_members where wave_id = w1 and contact_id = 'lc-test-j1')
    and (select state = 'done' from public.cockpit_sales_followup_wave_members where wave_id = w1 and contact_id = 'lc-test-j2')
    and (select state = 'done' from public.cockpit_sales_followup_wave_members where wave_id = w1 and contact_id = 'lc-test-j3')
    and (select ended_at = now() from public.cockpit_sales_followup_waves where id = w1));
  s := pg_temp.err(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm) values (%L, 'lc-test-j1', 'wave')$q$, w2));
  perform pg_temp.ck('J after the wave ended the contact can join the next one', s = 'none', s);
  s := pg_temp.err(format($q$update public.cockpit_sales_followup_waves set state = 'running' where id = %L$q$, w1));
  perform pg_temp.ck('J an ended wave never runs again (P0001)', s = 'P0001', s);
  s := pg_temp.err($q$insert into public.cockpit_sales_followup_waves (pool, segment, made_by, holdout_share) values ('x', 'x', 'lc-test', 1)$q$);
  perform pg_temp.ck('J a holdout share of 1 is refused (23514)', s = '23514', s);
exception when others then
  perform pg_temp.ck('J follow-up agent section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- K. Row security as a signed-in person who is not a seat, and as anon.
do $$
declare
  n_rooms integer; n_live integer; n_presence integer;
  s_insert text; s_secrets text; s_alerts text; s_claim text; s_sweep text; s_watchdog text; s_update text;
  s_anon text; s_anon_presence text;
  total integer;
begin
  select count(*) into total from public.cockpit_sales_rooms;
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'email', 'nobody@example.invalid')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  select count(*) into n_rooms from public.cockpit_sales_rooms;
  select count(*) into n_live from public.cockpit_sales_live;
  select count(*) into n_presence from public.cockpit_sales_presence;
  s_insert := pg_temp.err($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
                             values (gen_random_uuid(), 'lc-test-k', 'fallback', 'intro', 'meet', 'lc-test-k@example.invalid', 'x')$q$);
  s_update := pg_temp.err($q$update public.cockpit_sales_rooms set error = 'x'$q$);
  s_secrets := pg_temp.err($q$select * from public.cockpit_sales_room_secrets$q$);
  s_alerts := pg_temp.err($q$select * from public.cockpit_sales_alerts$q$);
  s_claim := pg_temp.err($q$select * from public.cockpit_sales_live_claim(gen_random_uuid(), 'x@example.invalid')$q$);
  s_sweep := pg_temp.err($q$select public.cockpit_sales_rooms_sweep()$q$);
  s_watchdog := pg_temp.err($q$select public.cockpit_sales_watchdog()$q$);
  reset role;
  set local role anon;
  s_anon := pg_temp.err($q$select count(*) from public.cockpit_sales_rooms$q$);
  s_anon_presence := pg_temp.err($q$select count(*) from public.cockpit_sales_presence$q$);
  reset role;
  perform pg_temp.ck('K a signed-in non-seat sees no rooms, handovers or presence (rows exist)',
    total > 0 and n_rooms = 0 and n_live = 0 and n_presence = 0, format('%s rooms exist; saw %s, %s, %s', total, n_rooms, n_live, n_presence));
  perform pg_temp.ck('K a signed-in person cannot write rooms (42501)', s_insert = '42501' and s_update = '42501', s_insert || ' ' || s_update);
  perform pg_temp.ck('K a signed-in person cannot read host links or alerts (42501)', s_secrets = '42501' and s_alerts = '42501');
  perform pg_temp.ck('K a signed-in person cannot run the claim, the sweep or the watchdog (42501)',
    s_claim = '42501' and s_sweep = '42501' and s_watchdog = '42501', s_claim || ' ' || s_sweep || ' ' || s_watchdog);
  perform pg_temp.ck('K anon reads nothing (42501)', s_anon = '42501' and s_anon_presence = '42501');
exception when others then
  reset role;
  perform pg_temp.ck('K row security section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

select name, ok, detail from pg_temp.lc_checks order by n;
