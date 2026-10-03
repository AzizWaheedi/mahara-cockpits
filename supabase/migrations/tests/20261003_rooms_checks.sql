-- Behaviour checks for 20261003a_sales_rooms.sql, 20261003b_sales_hooks.sql
-- and 20261003c_sales_followup_agent.sql.
--
-- Run ONLY inside a transaction that is rolled back, after the three
-- migrations (without their own begin/commit) and after
-- 20261003_rooms_catalog.sql, which makes pg_temp.lc_checks and pg_temp.ck.
-- The runner does exactly that, refuses any other transaction statement, and
-- never runs this file against live data (--applied runs the catalog only):
--
--   python3 supabase/migrations/tests/run_checks.py            # apply + checks, rolled back
--   python3 supabase/migrations/tests/run_checks.py --twice    # each migration applied twice
--
-- Every fixture uses lc-test-* ids and @example.invalid addresses. The one
-- webhook used is https://hooks.example.invalid/... (a name that can never
-- resolve). The tick's posts to sales-live/cron are queued in pg_net's
-- queue inside this transaction and rolled back with it, so nothing is ever
-- sent; the cron secret is compared, never read out.
--
-- Section order matters: D and E make rows that F's first sweep then moves,
-- and F compares its counts with the audit rows of that one sweep.

-- The SQLSTATE a statement fails with, or 'none' (the statement's effects
-- stay when it succeeds).
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

-- A dry run: 'none' when the statement would succeed, else
-- 'SQLSTATE:constraint' ('-' when no constraint is named). Its effects are
-- always undone, so a refusal check also names which rule fired.
create function pg_temp.dry(p_sql text)
returns text language plpgsql as $$
declare
  c text;
begin
  begin
    execute p_sql;
    raise exception using errcode = 'LC000', message = 'dry run';
  exception when sqlstate 'LC000' then
    return 'none';
  end;
exception when others then
  get stacked diagnostics c = constraint_name;
  return sqlstate || ':' || coalesce(nullif(c, ''), '-');
end;
$$;

-- A room for a test. Open, host_in and lead_in rooms get a join link; a
-- booked room gets its appointment's deadlines (start + 15, + 20, ends + 60).
create function pg_temp.room(p_contact text, p_host text, p_purpose text, p_state text default 'requested',
                             p_kind text default 'intro', p_appt text default null)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, appointment_id,
     host_by, lead_by, ends_at)
  values (gen_random_uuid(), p_contact, p_purpose, p_kind, 'zoom', p_host, p_host, p_state,
          case when p_state in ('open', 'host_in', 'lead_in') then 'https://zoom.example.invalid/j/1' end, p_appt,
          case when p_purpose = 'booked' then now() + interval '15 minutes' end,
          case when p_purpose = 'booked' then now() + interval '20 minutes' end,
          case when p_purpose = 'booked' then now() + interval '60 minutes' end)
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

-- A2. Settings: the new rows are the glossary values; existing rows gained
--     only the keys they lacked and kept every value they had.
do $$
declare
  g jsonb; f jsonb; wf jsonb; au record;
begin
  perform pg_temp.ck('A2 setting rooms is the glossary value, every switch off',
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
  perform pg_temp.ck('A2 setting live is the glossary value, every switch off',
    (select s.value from public.cockpit_sales_settings as s where s.key = 'live') =
    '{"enabled": false, "slack": false, "closer_wait_s": 120, "kinds": {"demo": false, "intro": false},
      "entries": {"dialer": true, "lead_page": false, "inbox": false, "followup": false}, "standby": true,
      "hours": {"days": [6, 0, 1, 2, 3, 4], "from": "10:00", "to": "20:00", "tz": "Asia/Kuwait"}}'::jsonb);
  perform pg_temp.ck('A2 settings rows were audited once each',
    (select count(*) = 2 from public.cockpit_audit_log
      where action = 'settings.create' and metadata ->> 'by' = 'migration 20261003a' and entity_id in ('rooms', 'live')));

  select s.value into g from public.cockpit_sales_settings as s where s.key = 'whatsapp_guard';
  perform pg_temp.ck('A2 whatsapp_guard has connector_off false, single_copy_ok_at null, dup_window_s, the budget and per-source health',
    jsonb_typeof(g -> 'connector_off') = 'boolean' and g ? 'single_copy_ok_at'
    and jsonb_typeof(g -> 'dup_window_s') = 'number' and jsonb_typeof(g -> 'template_budget_usd_month') = 'number'
    and jsonb_typeof(g #> '{health,room,window}') = 'number' and jsonb_typeof(g #> '{health,followup,fail_share}') = 'number',
    g::text);
  select s.value into f from public.cockpit_sales_settings as s where s.key = 'followups';
  perform pg_temp.ck('A2 followups has first_hours, waves, the good_intro cadence, untagged pace, graduation, reply alerts and the stop pause',
    f -> 'first_hours' is not null and f #> '{waves,batch_gap_s}' is not null and f #> '{waves,salt}' is not null
    and f #> '{cadence,good_intro}' is not null and f ? 'untagged_every_days' and f #> '{graduation,min_decided}' is not null
    and f #> '{reply_alerts,agent_min}' is not null and f ? 'stop_pause_days',
    left(f::text, 300));
  select s.value into wf from public.cockpit_sales_settings as s where s.key = 'wa_fields';
  perform pg_temp.ck('A2 wa_fields has join and when (no field id yet)',
    wf #>> '{join,key}' = 'contact.cockpit_join_code' and wf #>> '{when,key}' = 'contact.cockpit_call_time', wf::text);
  for au in
    select a.entity_id, a.before, a.after from public.cockpit_audit_log as a
     where a.action = 'settings.update' and a.metadata ->> 'by' in ('migration 20261003b', 'migration 20261003c')
  loop
    perform pg_temp.ck('A2 setting ' || au.entity_id || ' kept every value it had (only missing keys were added)',
      public.cockpit_sales_jsonb_add_missing(au.before, au.after) = au.after
      and (au.entity_id <> 'followups' or au.after #> '{cadence,after_call}' = au.before #> '{cadence,after_call}'));
  end loop;
  perform pg_temp.ck('A2 each setting change was audited at most once',
    (select count(*) = count(distinct entity_id) from public.cockpit_audit_log
      where action = 'settings.update' and metadata ->> 'by' in ('migration 20261003b', 'migration 20261003c')));
  perform pg_temp.ck('A2 adding the same keys again changes nothing and writes no audit row',
    not public.cockpit_sales_settings_add_missing('wa_fields', '{"join": {"id": null, "key": "x"}}'::jsonb, 'lc-test', 'x')
    and not exists (select 1 from public.cockpit_audit_log where action = 'settings.update' and metadata ->> 'by' = 'lc-test'));
  perform pg_temp.ck('A2 a nested key is added, a value already there is kept',
    public.cockpit_sales_jsonb_add_missing('{"a": {"b": 1}, "c": 2}'::jsonb, '{"a": {"b": 9, "d": 3}, "c": 9, "e": 4}'::jsonb)
      = '{"a": {"b": 1, "d": 3}, "c": 2, "e": 4}'::jsonb);
  perform pg_temp.ck('A2 the six template rows exist; every row this run added is inactive with no workflow',
    (select count(*) = 6 from public.cockpit_sales_wa_templates
      where key in ('call_link_en', 'call_link_ar', 'demo_host_en', 'demo_host_ar', 'opener_en', 'opener_ar'))
    and not exists (select 1 from public.cockpit_sales_wa_templates as w
                      join public.cockpit_audit_log as a on a.action = 'wa.template.seed' and a.entity_id = w.key
                     where w.active or w.workflow_id is not null));
  perform pg_temp.ck('A2 call_link_en is C24''s one body with the join_code button',
    exists (select 1 from public.cockpit_sales_wa_templates as w
             where w.key = 'call_link_en'
               and w.preview = 'Hi {{1}}, your call with {{2}} from Mahara Media is ready now. Tap the button below to join.'
               and w.button_variable = 'join_code' and w.variables = array['first_name', 'rep_name'])
    or not exists (select 1 from public.cockpit_audit_log where action = 'wa.template.seed' and entity_id = 'call_link_en'));
exception when others then
  perform pg_temp.ck('A2 settings section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- B. Room codes.
do $$
declare
  got_code text; rid uuid;
begin
  perform pg_temp.ck('B 3000 codes: all valid, all distinct, all 32 letters used',
    (select count(*) = 3000 and count(distinct c) = 3000 and bool_and(c ~ '^[A-HJ-NP-Z2-9]{6}$')
       from (select public.cockpit_sales_room_code() as c from generate_series(1, 3000)) as x)
    and (select count(distinct ch) = 32
           from (select regexp_split_to_table(public.cockpit_sales_room_code(), '') as ch from generate_series(1, 3000)) as y));
  rid := pg_temp.room('lc-test-b1', 'lc-test-hb1@example.invalid', 'fallback');
  select code into got_code from public.cockpit_sales_rooms where id = rid;
  perform pg_temp.ck('B a room written without a code gets one from the guard', got_code ~ '^[A-HJ-NP-Z2-9]{6}$', got_code);
exception when others then
  perform pg_temp.ck('B codes section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- C. Room and handover rules, the guards and the version.
do $$
declare
  a uuid; b uuid; x uuid; s text; r public.cockpit_sales_rooms; l uuid; v integer; rr uuid;
begin
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, code, contact_id, purpose, call_kind, provider, host_email, made_by)
                      values (gen_random_uuid(), 'ABCDEI', 'lc-test-c0', 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x')$q$);
  perform pg_temp.ck('C a code with I is refused by the code check', s = '23514:cockpit_sales_rooms_code_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
                      values (gen_random_uuid(), 'lc-test-c0', 'standby', 'demo', 'zoom', 'lc-test-h0@example.invalid', 'x')$q$);
  perform pg_temp.ck('C a standby room with a lead is refused by the standby check', s = '23514:cockpit_sales_rooms_standby_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
                      values (gen_random_uuid(), null, 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x')$q$);
  perform pg_temp.ck('C a fallback room without a lead is refused by the standby check', s = '23514:cockpit_sales_rooms_standby_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url,
                        host_by, lead_by, ends_at)
                      values (gen_random_uuid(), 'lc-test-c0', 'booked', 'demo', 'zoom', 'lc-test-h0@example.invalid', 'x', 'open',
                              'https://zoom.example.invalid/j/2', now(), now(), now())$q$);
  perform pg_temp.ck('C a booked room without its appointment is refused by the booked check', s = '23514:cockpit_sales_rooms_booked_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, appointment_id)
                      values (gen_random_uuid(), 'lc-test-c0', 'booked', 'demo', 'zoom', 'lc-test-h0@example.invalid', 'x', 'open',
                              'https://zoom.example.invalid/j/2', 'lc-test-appt-c0')$q$);
  perform pg_temp.ck('C a booked room without host_by, lead_by and ends_at is refused by the booked check',
    s = '23514:cockpit_sales_rooms_booked_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state)
                      values (gen_random_uuid(), 'lc-test-c0', 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x', 'open')$q$);
  perform pg_temp.ck('C an open room without a join link is refused by the link check', s = '23514:cockpit_sales_rooms_link_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
                      values (gen_random_uuid(), 'lc-test-c0', 'fallback', 'intro', 'meet', 'Lc-Test-H0@example.invalid', 'x')$q$);
  perform pg_temp.ck('C a host email that is not lower case is refused', s = '23514:cockpit_sales_rooms_host_email_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, link_channels)
                      values (gen_random_uuid(), 'lc-test-c0', 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x', '{sms}')$q$);
  perform pg_temp.ck('C an unknown link channel is refused', s = '23514:cockpit_sales_rooms_link_channels_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, link_channels)
                      values (gen_random_uuid(), 'lc-test-c0', 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x', '{whatsapp}')$q$);
  perform pg_temp.ck('C the old channel name whatsapp is refused (it is whatsapp_text)', s = '23514:cockpit_sales_rooms_link_channels_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, link_channels, link_message_ids)
                      values (gen_random_uuid(), 'lc-test-c0', 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x',
                              '{whatsapp_text,whatsapp_template,email}', '{"whatsapp_text": "m1", "email": "m2"}')$q$);
  perform pg_temp.ck('C the logic lane''s channels and {channel: id} message ids are accepted', s = 'none', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, link_message_ids)
                      values (gen_random_uuid(), 'lc-test-c0', 'fallback', 'intro', 'meet', 'lc-test-h0@example.invalid', 'x', '["m1"]')$q$);
  perform pg_temp.ck('C message ids that are not an object are refused', s = '23514:cockpit_sales_rooms_link_message_ids_check', s);

  a := pg_temp.room('lc-test-c1', 'lc-test-h1@example.invalid', 'fallback');
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
                             select request_id, 'lc-test-c99', 'fallback', 'intro', 'meet', 'lc-test-h99@example.invalid', 'x'
                               from public.cockpit_sales_rooms where id = %L$q$, a));
  perform pg_temp.ck('C a repeated request_id is refused by its own key', s = '23505:cockpit_sales_rooms_request_id_key', s);
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_rooms (request_id, code, contact_id, purpose, call_kind, provider, host_email, made_by)
                             select gen_random_uuid(), code, 'lc-test-c98', 'fallback', 'intro', 'meet', 'lc-test-h98@example.invalid', 'x'
                               from public.cockpit_sales_rooms where id = %L$q$, a));
  perform pg_temp.ck('C a repeated code the writer chose is refused by the code key, not the request_id key',
    s = '23505:cockpit_sales_rooms_code_key', s);

  s := pg_temp.dry($q$select pg_temp.room('lc-test-c1', 'lc-test-h2@example.invalid', 'fallback')$q$);
  perform pg_temp.ck('C rooms_one_per_lead: a second open room for the lead is refused', s = '23505:cockpit_sales_rooms_one_per_lead', s);
  update public.cockpit_sales_rooms set state = 'cancelled' where id = a;
  s := pg_temp.dry($q$select pg_temp.room('lc-test-c1', 'lc-test-h2@example.invalid', 'fallback')$q$);
  perform pg_temp.ck('C rooms_one_per_lead: once the first is final, a new room is allowed', s = 'none', s);

  b := pg_temp.room('lc-test-c2', 'lc-test-h3@example.invalid', 'fallback');
  s := pg_temp.dry($q$select pg_temp.room('lc-test-c3', 'lc-test-h3@example.invalid', 'manual')$q$);
  perform pg_temp.ck('C rooms_one_per_host: a second open room for the host is refused', s = '23505:cockpit_sales_rooms_one_per_host', s);
  s := pg_temp.dry($q$select pg_temp.room('lc-test-c4', 'lc-test-h3@example.invalid', 'booked', 'open', 'demo', 'lc-test-appt-c4')$q$);
  perform pg_temp.ck('C rooms_one_per_host: a booked room is allowed beside it', s = 'none', s);

  -- Version: only a state change, or a writer asking for it, moves it.
  update public.cockpit_sales_rooms set error = 'x' where id = b;
  update public.cockpit_sales_rooms set error = null, last_open_at = now(), link_message_ids = '{"email": "m1"}' where id = b;
  perform pg_temp.ck('C writes that do not change the state leave the version (an open counted, a message id)',
    (select version = 1 from public.cockpit_sales_rooms where id = b));
  update public.cockpit_sales_rooms set version = version + 5 where id = b;
  perform pg_temp.ck('C a writer asking for a new version moves it by exactly one',
    (select version = 2 from public.cockpit_sales_rooms where id = b));

  update public.cockpit_sales_rooms set state = 'creating' where id = b;
  select * into r from public.cockpit_sales_rooms where id = b;
  perform pg_temp.ck('C requested to creating stamps claimed_at and moves the version by one', r.claimed_at = now() and r.version = 3);
  update public.cockpit_sales_rooms set state = 'requested' where id = b;
  perform pg_temp.ck('C creating back to requested is allowed (the worker lets go)',
    (select state = 'requested' from public.cockpit_sales_rooms where id = b));
  update public.cockpit_sales_rooms set state = 'open', join_url = 'https://zoom.example.invalid/j/3' where id = b;
  s := pg_temp.errm(format('update public.cockpit_sales_rooms set state = %L where id = %L', 'requested', b));
  perform pg_temp.ck('C open back to requested is refused (P0001)', s like 'P0001:%cannot move from open back to requested%', s);
  s := pg_temp.err(format('update public.cockpit_sales_rooms set state = %L where id = %L', 'creating', b));
  perform pg_temp.ck('C open back to creating is refused (P0001)', s = 'P0001', s);
  update public.cockpit_sales_rooms set state = 'host_in', host_by = now() - interval '1 hour' where id = b;
  update public.cockpit_sales_rooms set state = 'open' where id = b;
  perform pg_temp.ck('C host_in back to open with host_by passed: the host has handover_host (120 s) again',
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

  -- The host stepping out never shortens host_by.
  x := pg_temp.room('lc-test-c10', 'lc-test-h10@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set host_by = now() + interval '13 minutes', lead_by = now() + interval '8 minutes',
                                        link_sent_at = now() - interval '2 minutes' where id = x;
  update public.cockpit_sales_rooms set state = 'open' where id = x;
  perform pg_temp.ck('C a fallback host stepping out keeps the 13 minutes they had (not cut to 120 s)',
    (select host_by = now() + interval '13 minutes' from public.cockpit_sales_rooms where id = x));
  x := pg_temp.room('lc-test-c11', 'lc-test-h11@example.invalid', 'booked', 'host_in', 'intro', 'lc-test-appt-c11');
  update public.cockpit_sales_rooms set state = 'open', host_by = host_by where id = x;
  perform pg_temp.ck('C a booked-call host stepping out keeps start + 15 (written back unchanged, as roomlogic.ts does)',
    (select host_by = now() + interval '15 minutes' from public.cockpit_sales_rooms where id = x));
  x := pg_temp.room(null, 'lc-test-h12@example.invalid', 'standby', 'host_in', 'demo');
  update public.cockpit_sales_rooms set host_by = now() - interval '10 minutes' where id = x;
  update public.cockpit_sales_rooms set state = 'open' where id = x;
  perform pg_temp.ck('C a standby host stepping out has standby_host (300 s)',
    (select host_by = now() + interval '300 seconds' from public.cockpit_sales_rooms where id = x));

  -- Handovers.
  l := pg_temp.live('lc-test-c5', array['lc-test-k@example.invalid']);
  update public.cockpit_sales_live set state = 'expired' where id = l;
  s := pg_temp.err(format('update public.cockpit_sales_live set state = %L where id = %L', 'offered', l));
  perform pg_temp.ck('C a finished handover never changes state (P0001)', s = 'P0001', s);
  perform pg_temp.ck('C a finished handover has ended_at', (select ended_at = now() from public.cockpit_sales_live where id = l));
  s := pg_temp.dry($q$insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
                      values (gen_random_uuid(), 'lc-test-c6', 'lc-test-setter@example.invalid', 'demo', 'on_call', '{Lc-Test@Example.invalid}', now())$q$);
  perform pg_temp.ck('C offered_to must be lower case', s = '23514:cockpit_sales_live_offered_to_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, declined_by, offer_until)
                      values (gen_random_uuid(), 'lc-test-c6', 'lc-test-setter@example.invalid', 'demo', 'on_call',
                              '{lc-test-c6k@example.invalid}', '{LC-Test-C6k@Example.invalid}', now())$q$);
  perform pg_temp.ck('C declined_by must be lower case too', s = '23514:cockpit_sales_live_declined_by_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, note, offered_to, offer_until)
                      values (gen_random_uuid(), 'lc-test-c6', 'lc-test-setter@example.invalid', 'demo', 'on_call', repeat('x', 201), '{}', now())$q$);
  perform pg_temp.ck('C a note over 200 characters is refused', s = '23514:cockpit_sales_live_note_check', s);
  l := pg_temp.live('lc-test-c7', array['lc-test-k@example.invalid']);
  s := pg_temp.dry($q$select pg_temp.live('lc-test-c7', array['lc-test-k2@example.invalid'])$q$);
  perform pg_temp.ck('C live_one_open_per_lead: a second open handover for the lead is refused',
    s = '23505:cockpit_sales_live_one_open_per_lead', s);

  l := pg_temp.live('lc-test-c8', array['lc-test-k8a@example.invalid', 'lc-test-k8b@example.invalid']);
  select version into v from public.cockpit_sales_live where id = l;
  update public.cockpit_sales_live set slack_posts = '[{"email": "lc-test-k8a@example.invalid", "channel": "D0", "ts": "1.0"}]' where id = l;
  update public.cockpit_sales_live set declined_by = declined_by || array['lc-test-k8a@example.invalid'] where id = l;
  perform pg_temp.ck('C a Slack post recorded and a Not now leave the handover''s version',
    (select version = v from public.cockpit_sales_live where id = l));
  update public.cockpit_sales_live set offer_until = offer_until + interval '1 minute' where id = l;
  perform pg_temp.ck('C a new offer_until moves the version by one', (select version = v + 1 from public.cockpit_sales_live where id = l));
  update public.cockpit_sales_live set state = 'claimed', claimed_by = 'lc-test-k8b@example.invalid' where id = l;
  s := pg_temp.errm(format($q$update public.cockpit_sales_live set state = 'offered', claimed_by = null where id = %L$q$, l));
  perform pg_temp.ck('C claimed cannot go back to offered (P0001)', s like 'P0001: This handover cannot go back from claimed to offered%', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_live set state = 'room_ready' where id = %L$q$, l));
  perform pg_temp.ck('C room_ready needs its room', s = '23514:cockpit_sales_live_room_check', s);
  rr := pg_temp.room('lc-test-c8', 'lc-test-k8b@example.invalid', 'handover', 'host_in', 'demo');
  update public.cockpit_sales_live set state = 'room_ready', room_id = rr where id = l;
  s := pg_temp.dry(format($q$update public.cockpit_sales_live set state = 'offered', claimed_by = null, room_id = null where id = %L$q$, l));
  perform pg_temp.ck('C room_ready back to offered without counting the re-offer is refused', s = 'P0001:-', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_live set state = 'offered', claimed_by = null, room_id = null, reoffers = 1,
                                    offer_until = now() + interval '2 minutes' where id = %L$q$, l));
  perform pg_temp.ck('C room_ready back to offered, once, counted in reoffers, is allowed', s = 'none', s);
  update public.cockpit_sales_live set state = 'lead_joined' where id = l;
  s := pg_temp.dry(format($q$update public.cockpit_sales_live set state = 'offered', claimed_by = null, room_id = null, reoffers = 1,
                                    offer_until = now() + interval '2 minutes' where id = %L$q$, l));
  perform pg_temp.ck('C a handover with the lead in the call cannot go back to offered', s = 'P0001:-', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_live set state = 'room_ready' where id = %L$q$, l));
  perform pg_temp.ck('C lead_joined cannot go back to room_ready', s = 'P0001:-', s);

  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key) values (null, 'zoom.meeting.started', 'zoom', 'lc-test-dupe');
  s := pg_temp.dry($q$insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key) values (null, 'zoom.meeting.started', 'zoom', 'lc-test-dupe')$q$);
  perform pg_temp.ck('C room_events: a repeated dedupe_key is refused', s = '23505:cockpit_sales_room_events_dedupe_key_key', s);
  with ins as (
    insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key) values (null, 'zoom.meeting.started', 'zoom', 'lc-test-dupe')
    on conflict (dedupe_key) do nothing returning 1)
  select count(*)::text into s from ins;
  perform pg_temp.ck('C room_events: a late duplicate with on conflict do nothing writes nothing', s = '0', s);
  update public.cockpit_sales_room_events set handled_at = now() where dedupe_key = 'lc-test-dupe';
  insert into public.cockpit_sales_alerts (dedupe_key, kind, message) values ('lc-test-alert', 'test', 'Test.');
  s := pg_temp.dry($q$insert into public.cockpit_sales_alerts (dedupe_key, kind, message) values ('lc-test-alert', 'test', 'Test.')$q$);
  perform pg_temp.ck('C alerts: a repeated dedupe_key is refused', s = '23505:cockpit_sales_alerts_dedupe_key_key', s);
  delete from public.cockpit_sales_alerts where dedupe_key = 'lc-test-alert';
exception when others then
  perform pg_temp.ck('C rooms section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- D. The claim: one Take wins, and the room it lands in.
do $$
declare
  l uuid; l2 uuid; won integer := 0; first_email text; e text; s text; v integer;
  got public.cockpit_sales_live; r public.cockpit_sales_rooms; sb uuid; lr uuid; nr uuid; emails text[];
begin
  select array_agg(format('lc-test-k%s@example.invalid', lpad(g::text, 2, '0'))) into emails from generate_series(1, 50) as g;
  l := pg_temp.live('lc-test-d1', emails);
  -- 50 presses in a scrambled order, one after another in this transaction.
  -- Two sessions at once cannot be run here (the rows would have to be
  -- committed); the claim's guard is one conditional UPDATE, so a second
  -- session waits on the row lock and then finds state <> 'offered'.
  for e in select x from unnest(emails) as x order by md5(x) loop
    select * into got from public.cockpit_sales_live_claim(l, e);
    if got.id is not null then
      won := won + 1;
      first_email := coalesce(first_email, e);
    end if;
  end loop;
  perform pg_temp.ck('D 50 claims on one offer, one after another: exactly one wins', won = 1, won::text);
  perform pg_temp.ck('D the winner is the first press, and the row says so',
    (select state = 'claimed' and claimed_by = first_email and claimed_at = now() and claim_room = 'none'
       from public.cockpit_sales_live where id = l)
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
  s := pg_temp.dry(format('select * from public.cockpit_sales_live_claim(%L, %L)', l2, 'lc-test-kd@example.invalid'));
  perform pg_temp.ck('D live_one_claim_per_closer: a closer holding a live call cannot take another',
    s = '23505:cockpit_sales_live_one_claim_per_closer', s);
  perform pg_temp.ck('D after that refusal the second offer is still open',
    (select state = 'offered' and claimed_by is null from public.cockpit_sales_live where id = l2));

  -- The version the offer was shown at still takes it after a Slack post is
  -- recorded and another closer presses Not now.
  l := pg_temp.live('lc-test-d9', array['lc-test-kv1@example.invalid', 'lc-test-kv2@example.invalid']);
  select version into v from public.cockpit_sales_live where id = l;
  update public.cockpit_sales_live set slack_posts = '[{"email": "lc-test-kv2@example.invalid", "channel": "D1", "ts": "2.0"}]' where id = l;
  update public.cockpit_sales_live set declined_by = declined_by || array['lc-test-kv1@example.invalid'] where id = l;
  perform pg_temp.ck('D after a Slack post and another closer''s Not now, the Take with the version shown still wins',
    exists (select 1 from public.cockpit_sales_live_claim(l, 'lc-test-kv2@example.invalid', v)));

  -- The taker is in their standby room: it is adopted, the handover is room_ready.
  sb := pg_temp.room(null, 'lc-test-ks@example.invalid', 'standby', 'host_in', 'demo');
  l := pg_temp.live('lc-test-d6', array['lc-test-ks@example.invalid'], interval '2 minutes', 'demo');
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-ks@example.invalid');
  select * into r from public.cockpit_sales_rooms where id = sb;
  perform pg_temp.ck('D adopt a host_in standby room: handover room_ready with that room (claim_room standby)',
    got.state = 'room_ready' and got.room_id = sb and got.room_ready_at = now() and got.claim_room = 'standby', got.state);
  perform pg_temp.ck('D adopt a host_in standby room: lead set, purpose handover, link goes now, lead_by starts, version moves',
    r.contact_id = 'lc-test-d6' and r.purpose = 'handover' and r.handover_id = l and r.send_on = 'open'
    and r.call_kind = 'demo' and r.lead_by = now() + interval '600 seconds' and r.ends_at = now() + interval '60 minutes'
    and r.state = 'host_in' and r.version = 2);
  perform pg_temp.ck('D every Take leaves a live.claimed event held 60 s for sales-api, and an audit row with the taker',
    exists (select 1 from public.cockpit_sales_room_events
             where dedupe_key = 'live.claimed:' || l::text || ':0' and source = 'claim' and handled_at is null
               and lease_until = now() + interval '60 seconds' and room_id = sb and detail ->> 'claim_room' = 'standby')
    and exists (select 1 from public.cockpit_audit_log
                 where action = 'live.claim' and entity_id = l::text and actor_email = 'lc-test-ks@example.invalid'));

  -- The taker's standby room exists but they are not in it yet.
  sb := pg_temp.room(null, 'lc-test-kt@example.invalid', 'standby', 'open', 'intro');
  l := pg_temp.live('lc-test-d7', array['lc-test-kt@example.invalid'], interval '2 minutes', 'intro');
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-kt@example.invalid');
  select * into r from public.cockpit_sales_rooms where id = sb;
  perform pg_temp.ck('D adopt an open standby room: claimed, link waits for the host, host has 120 s',
    got.state = 'claimed' and got.room_id = sb and r.purpose = 'handover' and r.send_on = 'host_in'
    and r.host_by = now() + interval '120 seconds' and r.ends_at = now() + interval '30 minutes');

  -- C16, the lead has an open room with nobody's lead in it (the setter's):
  -- it makes way, the taker's standby room is adopted, the link follows.
  lr := pg_temp.room('lc-test-d8', 'lc-test-setter8@example.invalid', 'fallback', 'open');
  sb := pg_temp.room(null, 'lc-test-ku@example.invalid', 'standby', 'host_in', 'demo');
  l := pg_temp.live('lc-test-d8', array['lc-test-ku@example.invalid']);
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-ku@example.invalid');
  perform pg_temp.ck('D the lead''s own room with no lead in it is cancelled (replaced); the standby room is adopted',
    got.state = 'room_ready' and got.room_id = sb and got.claim_room = 'standby'
    and (select state = 'cancelled' and end_reason = 'replaced' and handover_id = l from public.cockpit_sales_rooms where id = lr)
    and (select contact_id = 'lc-test-d8' and purpose = 'handover' from public.cockpit_sales_rooms where id = sb),
    got.state || ' ' || coalesce(got.claim_room, ''));
  perform pg_temp.ck('D the lead''s old short link follows the new room (replaced_by), with an event and an audit row',
    (select replaced_by = sb from public.cockpit_sales_rooms where id = lr)
    and exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'live.replaced:' || lr::text and handled_at is not null)
    and exists (select 1 from public.cockpit_audit_log where action = 'room.replace' and entity_id = lr::text));

  -- C16, the lead is in a room already: the taker gets that room, no new link.
  lr := pg_temp.room('lc-test-d10', 'lc-test-setter10@example.invalid', 'fallback', 'lead_in');
  sb := pg_temp.room(null, 'lc-test-klr@example.invalid', 'standby', 'host_in', 'demo');
  l := pg_temp.live('lc-test-d10', array['lc-test-klr@example.invalid']);
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-klr@example.invalid');
  perform pg_temp.ck('D the lead is in a room: lead_joined with that room (claim_room lead_room)',
    got.state = 'lead_joined' and got.room_id = lr and got.claim_room = 'lead_room', got.state);
  perform pg_temp.ck('D the lead''s room is not replaced and keeps its version (the setter''s buttons stay good); the standby room is untouched',
    (select state = 'lead_in' and replaced_by is null and handover_id = l and version = 1 from public.cockpit_sales_rooms where id = lr)
    and (select purpose = 'standby' and contact_id is null and version = 1 from public.cockpit_sales_rooms where id = sb));

  -- The lead has a booked room open: nothing is adopted (busy).
  lr := pg_temp.room('lc-test-d11', 'lc-test-hbooked@example.invalid', 'booked', 'open', 'demo', 'lc-test-appt-d11');
  sb := pg_temp.room(null, 'lc-test-kbusy@example.invalid', 'standby', 'host_in', 'demo');
  l := pg_temp.live('lc-test-d11', array['lc-test-kbusy@example.invalid']);
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-kbusy@example.invalid');
  perform pg_temp.ck('D the lead has a booked room open: claimed, no room (claim_room busy), both rooms untouched',
    got.state = 'claimed' and got.room_id is null and got.claim_room = 'busy'
    and (select state = 'open' and handover_id is null from public.cockpit_sales_rooms where id = lr)
    and (select purpose = 'standby' from public.cockpit_sales_rooms where id = sb));

  -- The taker already hosts a room for this lead: it is used.
  lr := pg_temp.room('lc-test-d12', 'lc-test-kown@example.invalid', 'fallback', 'host_in');
  l := pg_temp.live('lc-test-d12', array['lc-test-kown@example.invalid']);
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-kown@example.invalid');
  perform pg_temp.ck('D the taker''s own room for the lead is used (own_room, room_ready, version moves)',
    got.state = 'room_ready' and got.room_id = lr and got.claim_room = 'own_room'
    and (select handover_id = l and version = 2 and state = 'host_in' from public.cockpit_sales_rooms where id = lr));

  -- No standby room: sales-api makes the room; the lead's old room points at it.
  lr := pg_temp.room('lc-test-d13', 'lc-test-setter13@example.invalid', 'fallback', 'open');
  l := pg_temp.live('lc-test-d13', array['lc-test-knone@example.invalid']);
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-knone@example.invalid');
  perform pg_temp.ck('D no standby room: claimed, no room yet (claim_room none), the lead''s room made way',
    got.state = 'claimed' and got.room_id is null and got.claim_room = 'none'
    and (select state = 'cancelled' and end_reason = 'replaced' and replaced_by is null from public.cockpit_sales_rooms where id = lr));
  insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, handover_id)
  values (gen_random_uuid(), 'lc-test-d13', 'handover', 'demo', 'zoom', 'lc-test-knone@example.invalid', 'lc-test', l)
  returning id into nr;
  perform pg_temp.ck('D the room sales-api then makes for the handover takes the lead''s old link (replaced_by)',
    (select replaced_by = nr from public.cockpit_sales_rooms where id = lr));

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
  perform pg_temp.ck('E availability: available needs an until',
    pg_temp.dry($q$insert into public.cockpit_sales_availability (email, state) values ('lc-test-p-x@example.invalid', 'available')$q$)
      = '23514:cockpit_sales_availability_until_check');
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
  waits jsonb;
begin
  select value -> 'waits_s' into waits from public.cockpit_sales_settings where key = 'rooms';
  -- Rooms on with Zoom, so an expired standby room of an available host is
  -- made again (R5); every other rule ignores these switches.
  update public.cockpit_sales_settings
     set value = jsonb_set(jsonb_set(value, '{enabled}', 'true'), '{providers,zoom}', 'true') where key = 'rooms';

  -- Rooms f[1]..f[32]. Hosts and leads are all different.
  f[1] := pg_temp.room('lc-test-f1', 'lc-test-f1@example.invalid', 'fallback');
  update public.cockpit_sales_rooms set requested_at = now() - interval '2 minutes' where id = f[1];
  f[2] := pg_temp.room('lc-test-f2', 'lc-test-f2@example.invalid', 'fallback');
  update public.cockpit_sales_rooms set requested_at = now() - interval '10 seconds' where id = f[2];
  f[3] := pg_temp.room('lc-test-f3', 'lc-test-f3@example.invalid', 'fallback', 'creating');
  update public.cockpit_sales_rooms set claimed_at = now() - interval '3 minutes' where id = f[3];
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
                                        host_by = now() - interval '30 minutes', requested_at = now() - interval '3 hours' where id = f[21];
  insert into public.cockpit_sales_availability (email, state, until, via) values
    ('lc-test-f22@example.invalid', 'away', null, 'cockpit'),
    ('lc-test-f23@example.invalid', 'away', null, 'cockpit'),
    ('lc-test-f24@example.invalid', 'available', now() - interval '1 minute', 'cockpit'),
    ('lc-test-f31@example.invalid', 'available', now() + interval '1 hour', 'cockpit'),
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
  -- f[26]: the host is in, no lead_by, the link never went (read out, or
  -- every channel refused), 3 hours ago: the room still has a deadline.
  f[26] := pg_temp.room('lc-test-f26', 'lc-test-f26@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set requested_at = now() - interval '3 hours', opened_at = now() - interval '3 hours',
                                        host_in_at = now() - interval '3 hours', host_by = now() - interval '165 minutes' where id = f[26];
  -- f[27]: the lead knocked 10 minutes ago and was never let in.
  f[27] := pg_temp.room('lc-test-f27', 'lc-test-f27@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set lead_by = now() - interval '5 minutes', lead_waiting_at = now() - interval '10 minutes' where id = f[27];
  -- f[28]: a booked room wrapped 20 minutes before a call an hour away.
  f[28] := pg_temp.room('lc-test-f28', 'lc-test-f28@example.invalid', 'booked', 'open', 'demo', 'lc-test-appt-f28');
  update public.cockpit_sales_rooms set requested_at = now() - interval '20 minutes', opened_at = now() - interval '20 minutes',
                                        host_by = now() + interval '75 minutes', lead_by = now() + interval '80 minutes',
                                        ends_at = now() + interval '120 minutes' where id = f[28];
  -- f[29]: a booked room whose link went 11 minutes ago, 4 minutes before the start.
  f[29] := pg_temp.room('lc-test-f29', 'lc-test-f29@example.invalid', 'booked', 'host_in', 'intro', 'lc-test-appt-f29');
  update public.cockpit_sales_rooms set link_sent_at = now() - interval '11 minutes', host_by = now() + interval '19 minutes',
                                        lead_by = now() + interval '24 minutes', ends_at = now() + interval '40 minutes' where id = f[29];
  -- f[30]: lead_by keeps moving (opens), but the room is long past its length.
  f[30] := pg_temp.room('lc-test-f30', 'lc-test-f30@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set requested_at = now() - interval '2 hours', opened_at = now() - interval '2 hours',
                                        host_in_at = now() - interval '2 hours', lead_by = now() + interval '1 minute' where id = f[30];
  -- f[31]: a standby room at its time whose host is still available: made again.
  f[31] := pg_temp.room(null, 'lc-test-f31@example.invalid', 'standby', 'host_in', 'demo');
  update public.cockpit_sales_rooms set host_in_at = now() - interval '36 minutes' where id = f[31];
  -- f[32]: claimed 90 s ago: the worker's recovery window (fail at 120 s).
  f[32] := pg_temp.room('lc-test-f32', 'lc-test-f32@example.invalid', 'fallback', 'creating');
  update public.cockpit_sales_rooms set claimed_at = now() - interval '90 seconds' where id = f[32];

  -- Handovers lv[1]..lv[13].
  insert into public.cockpit_sales_availability (email, state, until) values
    ('lc-test-la@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-lb@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-lc@example.invalid', 'away', null),
    ('lc-test-l5-other@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-l10-other@example.invalid', 'away', null),
    ('lc-test-l12@example.invalid', 'available', now() + interval '1 hour');
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
  lv[5] := pg_temp.live('lc-test-l5', array['lc-test-l5-taker@example.invalid', 'lc-test-l5-other@example.invalid']);
  rm := pg_temp.room('lc-test-l5', 'lc-test-l5-taker@example.invalid', 'handover', 'expired', 'demo');
  update public.cockpit_sales_rooms set end_reason = 'host_not_in', lead_by = now() + interval '5 minutes', handover_id = lv[5] where id = rm;
  update public.cockpit_sales_live set state = 'room_ready', claimed_by = 'lc-test-l5-taker@example.invalid', room_id = rm where id = lv[5];
  lv[6] := pg_temp.live('lc-test-l6', array['lc-test-l6-taker@example.invalid', 'lc-test-l5-other@example.invalid']);
  rm := pg_temp.room('lc-test-l6', 'lc-test-l6-taker@example.invalid', 'handover', 'expired', 'demo');
  update public.cockpit_sales_rooms set end_reason = 'host_not_in', lead_by = now() + interval '5 minutes', handover_id = lv[6] where id = rm;
  update public.cockpit_sales_live set state = 'room_ready', reoffers = 1, claimed_by = 'lc-test-l6-taker@example.invalid', room_id = rm where id = lv[6];
  lv[7] := pg_temp.live('lc-test-l7', array['lc-test-l7@example.invalid']);
  rm := pg_temp.room('lc-test-l7', 'lc-test-l7@example.invalid', 'handover', 'expired', 'demo');
  update public.cockpit_sales_rooms set end_reason = 'lead_no_show', handover_id = lv[7] where id = rm;
  update public.cockpit_sales_live set state = 'room_ready', claimed_by = 'lc-test-l7@example.invalid', room_id = rm where id = lv[7];
  lv[8] := pg_temp.live('lc-test-l8', array['lc-test-l8@example.invalid']);
  rm := pg_temp.room('lc-test-l8', 'lc-test-l8@example.invalid', 'handover', 'lead_in', 'demo');
  update public.cockpit_sales_rooms set handover_id = lv[8] where id = rm;
  update public.cockpit_sales_rooms set state = 'ended' where id = rm;
  update public.cockpit_sales_live set state = 'lead_joined', claimed_by = 'lc-test-l8@example.invalid', room_id = rm where id = lv[8];
  lv[9] := pg_temp.live('lc-test-l9', array['lc-test-l9@example.invalid']);
  rm := pg_temp.room('lc-test-l9', 'lc-test-l9@example.invalid', 'handover', 'host_in', 'demo');
  update public.cockpit_sales_rooms set handover_id = lv[9], lead_by = now() + interval '5 minutes' where id = rm;
  update public.cockpit_sales_live set state = 'room_ready', claimed_by = 'lc-test-l9@example.invalid', room_id = rm where id = lv[9];
  lv[10] := pg_temp.live('lc-test-l10', array['lc-test-l10-taker@example.invalid', 'lc-test-l10-other@example.invalid']);
  rm := pg_temp.room('lc-test-l10', 'lc-test-l10-taker@example.invalid', 'handover', 'expired', 'demo');
  update public.cockpit_sales_rooms set end_reason = 'host_not_in', lead_by = now() + interval '5 minutes', handover_id = lv[10] where id = rm;
  update public.cockpit_sales_live set state = 'room_ready', claimed_by = 'lc-test-l10-taker@example.invalid', room_id = rm where id = lv[10];
  -- lv[11]: the lead joined, "That was not the lead", the real lead never came.
  lv[11] := pg_temp.live('lc-test-l11', array['lc-test-l11@example.invalid']);
  rm := pg_temp.room('lc-test-l11', 'lc-test-l11@example.invalid', 'handover', 'lead_in', 'demo');
  update public.cockpit_sales_rooms set handover_id = lv[11] where id = rm;
  update public.cockpit_sales_live set state = 'claimed', claimed_by = 'lc-test-l11@example.invalid', room_id = rm where id = lv[11];
  update public.cockpit_sales_live set state = 'lead_joined' where id = lv[11];
  update public.cockpit_sales_rooms set state = 'host_in' where id = rm;
  update public.cockpit_sales_rooms set lead_by = now() - interval '1 minute' where id = rm;
  -- lv[12]: offered to a closer who took another offer meanwhile; it ends.
  lv[12] := pg_temp.live('lc-test-l12a', array['lc-test-l12@example.invalid'], interval '-1 second');
  perform 1 from public.cockpit_sales_live_claim(pg_temp.live('lc-test-l12b', array['lc-test-l12@example.invalid']), 'lc-test-l12@example.invalid');
  -- lv[13]: taken while the lead had a booked room open (busy), 3 minutes ago.
  perform pg_temp.room('lc-test-l13', 'lc-test-l13-host@example.invalid', 'booked', 'open', 'intro', 'lc-test-appt-l13');
  lv[13] := pg_temp.live('lc-test-l13', array['lc-test-l13@example.invalid']);
  perform 1 from public.cockpit_sales_live_claim(lv[13], 'lc-test-l13@example.invalid');
  update public.cockpit_sales_live set claimed_at = now() - interval '3 minutes' where id = lv[13];

  -- Events ev[1]..ev[8].
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, tries, lease_until) values
    (f[9], 'zoom.meeting.participant_joined', 'zoom', 'lc-test-e1', now() - interval '30 seconds', null, 0, null),
    (f[9], 'zoom.meeting.participant_joined', 'zoom', 'lc-test-e2', now() - interval '5 seconds', null, 0, null),
    (f[9], 'link_sent', 'sales-api', 'lc-test-e3', now() - interval '1 minute', null, 0, null),
    (f[9], 'zoom.meeting.started', 'zoom', 'lc-test-e4', now() - interval '1 minute', now() - interval '50 seconds', 0, null),
    (f[9], 'zoom.meeting.ended', 'zoom', 'lc-test-e5', now() - interval '5 minutes', null, 3, null),
    (f[9], 'worker.ready', 'worker', 'lc-test-e6', now() - interval '25 seconds', null, 0, null),
    (f[9], 'zoom.meeting.participant_left', 'zoom', 'lc-test-e7', now() - interval '1 minute', null, 0, now() + interval '30 seconds'),
    (null, 'live.claimed', 'claim', 'lc-test-e8', now() - interval '2 minutes', null, 0, now() - interval '1 minute');
  select array_agg(e.id order by e.dedupe_key) into ev from public.cockpit_sales_room_events as e where e.dedupe_key like 'lc-test-e_';

  select count(*) into lead_in_before from public.cockpit_sales_rooms where state = 'lead_in';

  s1 := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('F sweep ran with no rule errors', jsonb_array_length(s1 -> 'errors') = 0, (s1 -> 'errors')::text);

  select * into r from public.cockpit_sales_rooms where id = f[1];
  perform pg_temp.ck('F requested past fail (60 s): failed, request_timeout, error says what to do',
    r.state = 'failed' and r.end_reason = 'request_timeout' and r.result = 'failed' and r.error like '%Try again.' and r.ended_at = now());
  perform pg_temp.ck('F requested 10 s ago: still requested', (select state = 'requested' from public.cockpit_sales_rooms where id = f[2]));
  select * into r from public.cockpit_sales_rooms where id = f[3];
  perform pg_temp.ck('F creating past 2 x fail (claimed 3 min ago): failed, create_timeout', r.state = 'failed' and r.end_reason = 'create_timeout' and r.error is not null);
  perform pg_temp.ck('F creating 30 s ago: still creating', (select state = 'creating' from public.cockpit_sales_rooms where id = f[4]));
  perform pg_temp.ck('F creating 90 s ago: left for the worker to recover (it adopts at 60 s; failed at 120 s)',
    (select state = 'creating' from public.cockpit_sales_rooms where id = f[32]));
  select * into r from public.cockpit_sales_rooms where id = f[5];
  perform pg_temp.ck('F open past host_by: expired, host_not_in, no_join',
    r.state = 'expired' and r.end_reason = 'host_not_in' and r.result = 'no_join');
  perform pg_temp.ck('F open fallback, no host_by, opened 20 min ago: expired (fallback_host 900 s)',
    (select state = 'expired' and end_reason = 'host_not_in' from public.cockpit_sales_rooms where id = f[6]));
  perform pg_temp.ck('F open standby, no host_by, opened 6 min ago: expired (standby_host 300 s), no result for a room with no lead',
    (select state = 'expired' and result is null from public.cockpit_sales_rooms where id = f[7]));
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
  perform pg_temp.ck('F a handover room whose link waits for the host: still open (host_by not passed)',
    (select state = 'open' from public.cockpit_sales_rooms where id = f[14]));
  select * into r from public.cockpit_sales_rooms where id = f[15];
  perform pg_temp.ck('F standby in the room 36 min, host not available: ended, standby_refresh, no fresh room',
    r.state = 'ended' and r.end_reason = 'standby_refresh' and r.result is null
    and not exists (select 1 from public.cockpit_sales_rooms where host_email = 'lc-test-f15@example.invalid' and state = 'requested')
    and (select text like '%Press I''m available for a fresh room.' from public.cockpit_sales_room_events
          where dedupe_key = 'sweep:' || f[15]::text || ':standby_refresh'));
  perform pg_temp.ck('F standby in the room 36 min, host still available: ended, and a fresh standby room is asked for',
    (select state = 'ended' and end_reason = 'standby_refresh' from public.cockpit_sales_rooms where id = f[31])
    and exists (select 1 from public.cockpit_sales_rooms
                 where host_email = 'lc-test-f31@example.invalid' and purpose = 'standby' and state = 'requested'
                   and made_by = 'sweep' and contact_id is null)
    and (select text like '%A fresh room is being made: join it from the strip.' from public.cockpit_sales_room_events
          where dedupe_key = 'sweep:' || f[31]::text || ':standby_refresh')
    and exists (select 1 from public.cockpit_audit_log as au join public.cockpit_sales_rooms as x on au.entity_id = x.id::text
                 where au.action = 'room.create' and x.host_email = 'lc-test-f31@example.invalid')
    and (s1 ->> 'standby_fresh')::integer = 1, s1 ->> 'standby_fresh');
  perform pg_temp.ck('F standby in the room 10 min: still host_in', (select state = 'host_in' from public.cockpit_sales_rooms where id = f[16]));
  perform pg_temp.ck('F standby with a booked call in 5 min: ended, booked_call_soon',
    (select state = 'ended' and end_reason = 'booked_call_soon' from public.cockpit_sales_rooms where id = f[17]));
  perform pg_temp.ck('F standby with a booked call in 20 min: still host_in', (select state = 'host_in' from public.cockpit_sales_rooms where id = f[18]));
  select * into r from public.cockpit_sales_rooms where id = f[19];
  perform pg_temp.ck('F lead_in 31 min past ends_at: ended, no_end_signal, joined',
    r.state = 'ended' and r.end_reason = 'no_end_signal' and r.result = 'joined');
  perform pg_temp.ck('F lead_in 29 min past ends_at: never touched', (select state = 'lead_in' from public.cockpit_sales_rooms where id = f[20]));
  perform pg_temp.ck('F lead_in with lead_by and host_by long past, made 3 h ago: never touched (no rule but no_end_signal ends a room with the lead in it)',
    (select state = 'lead_in' and end_reason is null from public.cockpit_sales_rooms where id = f[21]));
  perform pg_temp.ck('F only the no_end_signal room left lead_in',
    (select count(*) from public.cockpit_sales_rooms where state = 'lead_in') = lead_in_before - 1);
  perform pg_temp.ck('F standby whose host is away: ended, host_away',
    (select state = 'ended' and end_reason = 'host_away' from public.cockpit_sales_rooms where id = f[22]));
  perform pg_temp.ck('F standby made 10 s ago, host away: kept (60 s grace for the Available press)',
    (select state = 'host_in' from public.cockpit_sales_rooms where id = f[23]));
  perform pg_temp.ck('F standby still being made when Available ran out: cancelled, host_away',
    (select state = 'cancelled' and end_reason = 'host_away' from public.cockpit_sales_rooms where id = f[24]));
  perform pg_temp.ck('F booked intro past host_by: expired, one settle event, posted as sweep.settle',
    (select state = 'expired' from public.cockpit_sales_rooms where id = f[25])
    and (s1 ->> 'settle_due')::integer >= 1
    and (s1 -> 'settle') = to_jsonb(array[f[25]::text])
    and exists (select 1 from public.cockpit_sales_room_events
                 where dedupe_key = 'sweep.settle:' || f[25]::text and source = 'settle' and tries = 1 and handled_at is null),
    s1 ->> 'settle');
  perform pg_temp.ck('F a host_in room with a lead and no deadline at all (3 h): expired by host_in_at + lead',
    (select state = 'expired' and end_reason = 'lead_no_show' from public.cockpit_sales_rooms where id = f[26]));
  perform pg_temp.ck('F a lead who knocked and was never let in: expired as not_admitted, admit_blocked (not a no-show)',
    (select state = 'expired' and end_reason = 'not_admitted' and result = 'admit_blocked' from public.cockpit_sales_rooms where id = f[27]));
  perform pg_temp.ck('F a booked room wrapped 20 min before a call an hour away: still open (no fallback wait)',
    (select state = 'open' from public.cockpit_sales_rooms where id = f[28]));
  perform pg_temp.ck('F a booked room whose link went 11 min ago: still host_in (its own lead_by)',
    (select state = 'host_in' from public.cockpit_sales_rooms where id = f[29]));
  perform pg_temp.ck('F a room long past its length whose lead_by keeps moving: expired, no_deadline',
    (select state = 'expired' and end_reason = 'no_deadline' from public.cockpit_sales_rooms where id = f[30]));

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
  perform pg_temp.ck('F a closer who took another offer meanwhile is not set away when this one ends',
    (select state = 'available' from public.cockpit_sales_availability where email = 'lc-test-l12@example.invalid')
    and (select state = 'expired' from public.cockpit_sales_live where id = lv[12]));
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
  perform pg_temp.ck('F lead_joined, "That was not the lead", the real lead never came: room expired and the handover ended',
    (select state = 'expired' and end_reason = 'lead_no_show' from public.cockpit_sales_live where id = lv[11])
    and (select state = 'expired' from public.cockpit_sales_rooms where handover_id = lv[11]));
  perform pg_temp.ck('F taken while the lead had a booked room open, 3 min on: expired, lead_has_booked_room',
    (select state = 'expired' and end_reason = 'lead_has_booked_room' from public.cockpit_sales_live where id = lv[13]));

  perform pg_temp.ck('F replay: zoom, worker and claim events unhandled past 20 s and not held go back to room.event, once each',
    (s1 -> 'replay') @> to_jsonb(array[ev[1]::text, ev[6]::text, ev[8]::text]) and jsonb_array_length(s1 -> 'replay') = 3,
    (s1 -> 'replay')::text);
  perform pg_temp.ck('F replay: tries counted on the replayed events only; a held event (lease) is left alone',
    (select bool_and(tries = case when id in (ev[1], ev[6], ev[8]) then 1 when id = ev[5] then 3 else 0 end)
       from public.cockpit_sales_room_events where id = any (ev))
    and (select handled_at is null and tries = 0 from public.cockpit_sales_room_events where id = ev[7]));
  perform pg_temp.ck('F an event that had its 3 tries is given up: handled, detail.gave_up',
    (select handled_at = now() and (detail ->> 'gave_up')::boolean and tries = 3 from public.cockpit_sales_room_events where id = ev[5])
    and (s1 ->> 'gave_up')::integer >= 1);

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
  perform pg_temp.ck('F a second run in the same minute moves nothing, replays nothing and settles nothing again',
    (s2 ->> 'rooms_moved')::integer = 0 and (s2 ->> 'handovers_moved')::integer = 0
    and jsonb_array_length(s2 -> 'replay') = 0 and jsonb_array_length(s2 -> 'settle') = 0 and (s2 ->> 'standby_fresh')::integer = 0,
    s2::text);
  -- A bad setting cannot stop the sweep: waits fall back to their defaults.
  update public.cockpit_sales_settings set value = jsonb_set(value, '{waits_s}', '{"fail": "soon", "lead": -5}') where key = 'rooms';
  s2 := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('F a broken waits_s setting falls back to the defaults (no error, nothing moved)',
    jsonb_array_length(s2 -> 'errors') = 0 and (s2 ->> 'rooms_moved')::integer = 0, s2::text);
  update public.cockpit_sales_settings
     set value = jsonb_set(jsonb_set(jsonb_set(value, '{waits_s}', waits), '{enabled}', 'false'), '{providers,zoom}', 'false')
   where key = 'rooms';
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
  -- sweep fresh, no webhook in the vault, no other alerts, nothing given up.
  delete from public.cockpit_sales_alerts;
  update public.cockpit_sales_settings set value = jsonb_set(value, '{enabled}', 'true') where key = 'rooms';
  delete from public.cockpit_sales_worker_status where worker = 'sales-desk' and job in ('rooms', 'slack', 'watch', 'waves', 'model');
  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at) values
    ('sales-desk', 'doctor', true, 'ok', now() - interval '2 hours'),
    ('sales-desk', 'followups', false, E'Claude sign-in\nlapsed', now() - interval '1 minute'),
    ('sales-api', 'sweep', true, 'ok', now())
  on conflict (worker, job) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at;
  update public.cockpit_sales_room_events set handled_at = now() where handled_at is null;
  update public.cockpit_sales_room_events set detail = detail - 'gave_up' where detail ? 'gave_up' and dedupe_key like 'lc-test-%';
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
  perform pg_temp.ck('G switched-off and never-seen workers raise nothing (slack, watch, waves, model, threads)',
    not exists (select 1 from public.cockpit_sales_alerts
                 where subject in ('sales-desk/slack', 'sales-desk/watch', 'sales-desk/waves', 'sales-desk/model', 'sales-api/threads')));

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
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at)
    values (null, 'zoom.meeting.ended', 'zoom', 'lc-test-g-ancient', now() - interval '3 days');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G a Zoom event unhandled for 10 minutes raises an alert; one older than a day is not counted',
    exists (select 1 from public.cockpit_sales_alerts
             where dedupe_key = 'room_events_unhandled' and resolved_at is null and (detail ->> 'count')::integer = 1));
  update public.cockpit_sales_room_events set handled_at = now() where dedupe_key in ('lc-test-g-stuck', 'lc-test-g-ancient');

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

-- G3. Alert words (roles, not names; whole sentences) and given-up events
--     (one alert a Kuwait day).
do $$
declare
  w jsonb; s text; today text := 'room_events_gave_up:' || to_char(now() at time zone 'Asia/Kuwait', 'YYYY-MM-DD');
begin
  insert into public.cockpit_sales_people (email, name, role, active, ghl_user_id)
    values ('lc-test-zubaida@example.invalid', 'Zubaida Test', 'closer', true, null);
  s := public.cockpit_sales_alert_words('The Claude sign-in on the VPS has lapsed, so nothing can be drafted. Sign Claude Code in again on the VPS as zubaida (run claude, then /login); drafting resumes by itself.', 160);
  perform pg_temp.ck('G3 a long detail is cut at the last whole sentence that fits, never mid-word',
    s = 'The Claude sign-in on the VPS has lapsed, so nothing can be drafted.', s);
  s := public.cockpit_sales_alert_words('Sign in again as Zubaida, then run it.', 160);
  perform pg_temp.ck('G3 a person''s name becomes their role', s = 'Sign in again as the closer, then run it.', s);
  s := public.cockpit_sales_alert_words('Write to lc-test-x@example.invalid now.', 160);
  perform pg_temp.ck('G3 an address is never posted', s = 'Write to an address now.', s);
  s := public.cockpit_sales_alert_words(repeat('word ', 60), 160);
  perform pg_temp.ck('G3 a detail with no sentence end is cut at a space, marked with ...',
    s ~ '^(word )*word\.\.\.$' and length(s) <= 163, s);

  delete from public.cockpit_sales_alerts;
  update public.cockpit_sales_worker_status
     set ok = false, at = now(),
         detail = 'The Claude sign-in on the VPS has lapsed, so nothing can be drafted. Sign Claude Code in again on the VPS as zubaida (run claude, then /login); drafting resumes by itself.'
   where worker = 'sales-desk' and job = 'followups';
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G3 the failing alert carries whole sentences and no name',
    (select message like 'The follow-up drafter reported a problem at %: The Claude sign-in on the VPS has lapsed, so nothing can be drafted. No new follow-ups are being drafted.'
            and message not ilike '%zubaida%'
       from public.cockpit_sales_alerts where dedupe_key = 'failing:sales-desk/followups'),
    (select message from public.cockpit_sales_alerts where dedupe_key = 'failing:sales-desk/followups'));

  insert into public.cockpit_sales_alerts (dedupe_key, kind, message) values ('room_events_gave_up:2026-01-01', 'room_events_gave_up', 'Old.');
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, tries, detail) values
    (null, 'zoom.meeting.started', 'zoom', 'lc-test-g3-gaveup', now() - interval '5 minutes', now(), 3, '{"gave_up": true}'),
    (null, 'zoom.meeting.started', 'zoom', 'lc-test-g3-gaveup-old', now() - interval '2 days', now() - interval '2 days', 3, '{"gave_up": true}');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G3 events given up today raise one alert for the day; an earlier day''s alert resolves',
    exists (select 1 from public.cockpit_sales_alerts where dedupe_key = today and resolved_at is null and (detail ->> 'count')::integer = 1)
    and not exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'room_events_gave_up:2026-01-01')
    and (w ->> 'raised')::integer >= 1, w::text);
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, tries, detail) values
    (null, 'zoom.meeting.ended', 'zoom', 'lc-test-g3-gaveup2', now() - interval '4 minutes', now(), 3, '{"gave_up": true}');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G3 another give-up the same day raises nothing new, the count follows',
    (w ->> 'raised')::integer = 0
    and exists (select 1 from public.cockpit_sales_alerts where dedupe_key = today and (detail ->> 'count')::integer = 2), w::text);
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at)
    values (null, 'zoom.meeting.ended', 'zoom', 'lc-test-g3-stuck', now() - interval '11 minutes');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G3 a new stuck event after a given-up one still raises its own alert',
    exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'room_events_unhandled' and resolved_at is null), w::text);
  update public.cockpit_sales_room_events set handled_at = now() where dedupe_key = 'lc-test-g3-stuck';
exception when others then
  perform pg_temp.ck('G3 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- H. The cron commands run as written, and the tick's posts carry the right
--    body and the cron secret (queued in this transaction, rolled back).
do $$
declare
  cmd text; before_n integer; s text; r jsonb; e uuid; rm uuid; made_secret boolean := false; max_id bigint;
begin
  update public.cockpit_sales_room_events set handled_at = now() where handled_at is null;
  select count(*) into before_n from net.http_request_queue as q where q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron';
  select command into cmd from cron.job where jobname = 'mahara-sales-rooms-sweep';
  s := pg_temp.errm(cmd);
  perform pg_temp.ck('H the sweep job command runs', s = 'none', s);
  perform pg_temp.ck('H with nothing to replay or settle it posts nothing',
    (select count(*) from net.http_request_queue as q where q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron') = before_n);
  select command into cmd from cron.job where jobname = 'mahara-sales-watchdog';
  s := pg_temp.errm(cmd);
  perform pg_temp.ck('H the watchdog job command runs', s = 'none', s);

  if not exists (select 1 from vault.secrets where name = 'cockpit_sync_secret') then
    perform vault.create_secret('lc-test-not-a-real-secret', 'cockpit_sync_secret', 'lc-db test, rolled back');
    made_secret := true;
  end if;
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at)
    values (null, 'zoom.meeting.started', 'zoom', 'lc-test-h1', now() - interval '30 seconds') returning id into e;
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, status, assigned_user_id, start_at, origin)
    values ('lc-test-appt-h2', 'lc-test-h2', 'intro', 'confirmed', 'lc-test-ghl-h2', now() - interval '25 minutes', 'ghl');
  rm := pg_temp.room('lc-test-h2', 'lc-test-h2@example.invalid', 'booked', 'open', 'intro', 'lc-test-appt-h2');
  update public.cockpit_sales_rooms set host_by = now() - interval '1 minute' where id = rm;
  select coalesce(max(q.id), 0) into max_id from net.http_request_queue as q;
  r := public.cockpit_sales_rooms_tick();
  perform pg_temp.ck('H the tick runs the sweep and posts twice: sweep.replay and sweep.settle',
    (r ->> 'posted')::integer = 2, r::text);
  perform pg_temp.ck('H the replay post is room.event sweep.replay with the event ids, to sales-live/cron',
    exists (select 1 from net.http_request_queue as q
             where q.id > max_id and q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron' and q.method = 'POST'
               and convert_from(q.body, 'utf8')::jsonb = jsonb_build_object('action', 'room.event', 'kind', 'sweep.replay',
                     'payload', jsonb_build_object('event_ids', to_jsonb(array[e::text])))));
  perform pg_temp.ck('H the settle post is room.event sweep.settle with the room ids',
    exists (select 1 from net.http_request_queue as q
             where q.id > max_id and q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron'
               and convert_from(q.body, 'utf8')::jsonb = jsonb_build_object('action', 'room.event', 'kind', 'sweep.settle',
                     'payload', jsonb_build_object('room_ids', to_jsonb(array[rm::text])))));
  perform pg_temp.ck('H both posts carry the vault''s cron secret as x-cron-secret and a JSON content type (compared, never read out)',
    (select count(*) = 2 and bool_and(q.headers ->> 'x-cron-secret' = (select ds.decrypted_secret from vault.decrypted_secrets as ds where ds.name = 'cockpit_sync_secret')
                                     and q.headers ->> 'Content-Type' = 'application/json' and q.timeout_milliseconds = 10000)
       from net.http_request_queue as q
      where q.id > max_id and q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron'),
    case when made_secret then 'a test secret was made for this run' end);

  -- No cron secret in the vault: the sweep still runs, nothing is posted, and
  -- the sweep's status row says what is waiting.
  delete from vault.secrets where name = 'cockpit_sync_secret';
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at)
    values (null, 'zoom.meeting.started', 'zoom', 'lc-test-h3', now() - interval '30 seconds');
  select count(*) into before_n from net.http_request_queue as q where q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron';
  r := public.cockpit_sales_rooms_tick();
  perform pg_temp.ck('H without the cron secret: the sweep ran, nothing was posted, the status row says why',
    (r ->> 'posted')::integer = 0 and r ? 'rooms_moved'
    and (select count(*) from net.http_request_queue as q where q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron') = before_n
    and (select not ok and detail like '%the vault has no cockpit_sync_secret, so nothing was sent. Add it to the vault.'
           from public.cockpit_sales_worker_status where worker = 'sales-api' and job = 'sweep'),
    r::text);
  update public.cockpit_sales_room_events set handled_at = now() where handled_at is null;
exception when others then
  perform pg_temp.ck('H cron section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- I. 20261003b: the two widened checks and the template routes.
do $$
declare
  s text;
begin
  s := pg_temp.dry($q$insert into public.cockpit_sales_messages (request_id, contact_id, channel, body, source, sent_by)
                      values (gen_random_uuid(), 'lc-test-i1', 'whatsapp', 'Test.', 'room', 'lc-test@example.invalid')$q$);
  perform pg_temp.ck('I messages accept source room', s = 'none', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_messages (request_id, contact_id, channel, body, source, sent_by)
                      values (gen_random_uuid(), 'lc-test-i2', 'whatsapp', 'Test.', 'thread', 'lc-test@example.invalid')$q$);
  perform pg_temp.ck('I messages accept source thread', s = 'none', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_messages (request_id, contact_id, channel, body, source, sent_by)
                      values (gen_random_uuid(), 'lc-test-i3', 'whatsapp', 'Test.', 'rep', 'lc-test@example.invalid')$q$);
  perform pg_temp.ck('I messages still accept source rep', s = 'none', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_messages (request_id, contact_id, channel, body, source, sent_by)
                      values (gen_random_uuid(), 'lc-test-i4', 'whatsapp', 'Test.', 'bogus', 'lc-test@example.invalid')$q$);
  perform pg_temp.ck('I messages refuse an unknown source', s = '23514:cockpit_sales_messages_source_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why)
                      values ('lc-test-i5', 'good_intro', 'whatsapp', 'Test.', 'Test.')$q$);
  perform pg_temp.ck('I follow-ups accept good_intro', s = 'none', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why)
                      values ('lc-test-i6', 'reactivate', 'whatsapp_template', 'Test.', 'Test.')$q$);
  perform pg_temp.ck('I follow-ups accept reactivate', s = 'none', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why)
                      values ('lc-test-i7', 'no_show', 'whatsapp', 'Test.', 'Test.')$q$);
  perform pg_temp.ck('I follow-ups still accept no_show', s = 'none', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why)
                      values ('lc-test-i8', 'bogus', 'whatsapp', 'Test.', 'Test.')$q$);
  perform pg_temp.ck('I follow-ups refuse an unknown segment', s = '23514:cockpit_sales_followups_segment_check', s);
  perform pg_temp.ck('I every existing row still passes both checks',
    not exists (select 1 from pg_constraint where conname in ('cockpit_sales_messages_source_check', 'cockpit_sales_followups_segment_check')
                  and not convalidated));
  s := pg_temp.dry($q$update public.cockpit_sales_wa_templates set button_variable = 'bogus' where key = 'call_link_en'$q$);
  perform pg_temp.ck('I a template button variable other than join_code is refused',
    s = '23514:cockpit_sales_wa_templates_button_variable_check', s);
exception when others then
  perform pg_temp.ck('I hooks section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- J. 20261003c: levels, waves, members, meta and stops, as the desk writes them.
do $$
declare
  w1 uuid; w2 uuid; s text; f1 uuid; n integer;
begin
  update public.cockpit_sales_settings set value = value - 'connector_off' - 'single_copy_ok_at' where key = 'whatsapp_guard';
  s := pg_temp.errm($q$insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('no_show.ar.whatsapp_template', 'sends_by_itself', 'lc-test')$q$);
  perform pg_temp.ck('J a WhatsApp kind cannot send by itself before the connector is off and the single-copy test passed (P0001)',
    s like 'P0001: WhatsApp follow-ups stay on Approve%', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('no_show', 'sends_by_itself', 'lc-test')$q$);
  perform pg_temp.ck('J a kind key with no channel is refused, so it cannot slip past the WhatsApp gate',
    s = '23514:cockpit_sales_followup_levels_kind_key_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('reactivate.ar.whatsapp_template', 'approve', 'lc-test')$q$);
  perform pg_temp.ck('J the kind key the desk writes (reactivate.ar.whatsapp_template) fits', s = 'none', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('no_show:ar:whatsapp_template', 'approve', 'lc-test')$q$);
  perform pg_temp.ck('J the colon form is refused (one separator: dots)', s = '23514:cockpit_sales_followup_levels_kind_key_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('no_show.ar.sms', 'approve', 'lc-test')$q$);
  perform pg_temp.ck('J an unknown channel is refused', s = '23514:cockpit_sales_followup_levels_kind_key_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('no_show.ar.email', 'sends_by_itself', 'lc-test')$q$);
  perform pg_temp.ck('J an email kind can send by itself', s = 'none', s);
  insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('no_show.en.whatsapp_template', 'approve', 'lc-test');
  s := pg_temp.err($q$update public.cockpit_sales_followup_levels set level = 'send_unless_stopped' where kind_key = 'no_show.en.whatsapp_template'$q$);
  perform pg_temp.ck('J a WhatsApp kind cannot move to Sends unless stopped either (P0001)', s = 'P0001', s);
  update public.cockpit_sales_settings
     set value = value || '{"connector_off": true, "single_copy_ok_at": "2026-10-03T10:00:00Z"}'::jsonb where key = 'whatsapp_guard';
  s := pg_temp.err($q$update public.cockpit_sales_followup_levels set level = 'send_unless_stopped' where kind_key = 'no_show.en.whatsapp_template'$q$);
  perform pg_temp.ck('J once the connector is off and the test passed, it can', s = 'none', s);
  perform pg_temp.ck('J levels keep a version',
    (select version = 2 from public.cockpit_sales_followup_levels where kind_key = 'no_show.en.whatsapp_template'));
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_levels (kind_key, level) values ('No Show', 'approve')$q$);
  perform pg_temp.ck('J a malformed kind key is refused', s = '23514:cockpit_sales_followup_levels_kind_key_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_levels (kind_key, level) values ('no_show.ar.email', 'always')$q$);
  perform pg_temp.ck('J an unknown level is refused by the level check', s = '23514:cockpit_sales_followup_levels_level_check', s);

  -- Waves.
  insert into public.cockpit_sales_followup_waves (pool, state, made_by) values ('no_show_cancelled', 'running', 'lc-test')
    returning id into w1;
  insert into public.cockpit_sales_followup_waves (pool, segment, state, made_by) values ('good_intro', 'reactivate', 'running', 'lc-test')
    returning id into w2;
  perform pg_temp.ck('J a running wave gets started_at; the segment defaults to reactivate',
    (select started_at = now() and segment = 'reactivate' from public.cockpit_sales_followup_waves where id = w1));
  perform pg_temp.ck('J a new wave starts as a draft',
    pg_temp.dry($q$insert into public.cockpit_sales_followup_waves (pool, made_by) values ('never_booked', 'lc-test')$q$) = 'none'
    and (select column_default = '''draft''::text' from information_schema.columns
          where table_schema = 'public' and table_name = 'cockpit_sales_followup_waves' and column_name = 'state'));
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_waves (pool, state, made_by) values ('no_show_cancelled', 'paused', 'lc-test')$q$);
  perform pg_temp.ck('J one running or paused wave per pool', s = '23505:cockpit_sales_followup_waves_one_running_pool', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_waves (pool, made_by) values ('everyone', 'lc-test')$q$);
  perform pg_temp.ck('J an unknown pool is refused', s = '23514:cockpit_sales_followup_waves_pool_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_waves (pool, made_by, holdout_share) values ('never_booked', 'lc-test', 0.6)$q$);
  perform pg_temp.ck('J a holdout share above 0.5 is refused', s = '23514:cockpit_sales_followup_waves_holdout_share_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_waves (pool, made_by, per_day) values ('never_booked', 'lc-test', 201)$q$);
  perform pg_temp.ck('J more than 200 a day is refused', s = '23514:cockpit_sales_followup_waves_per_day_check', s);

  -- Members, as desk/waves.py enrols them.
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state, event_at, added_at) values
      (%L, 'lc-test-j0a', 'wave', 'waiting', now() - interval '3 days', now()),
      (%L, 'lc-test-j0b', 'holdout', 'held_out', null, now())$q$, w1, w1));
  perform pg_temp.ck('J members as the desk enrols them (waiting with event_at, held_out) are accepted', s = 'none', s);
  insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state, event_at) values
    (w1, 'lc-test-j1', 'wave', 'waiting', now() - interval '2 days'),
    (w1, 'lc-test-j2', 'holdout', 'held_out', now() - interval '2 days'),
    (w1, 'lc-test-j3', 'wave', 'waiting', now()),
    (w1, 'lc-test-j4', 'wave', 'waiting', now()),
    (w1, 'lc-test-j7', 'holdout', 'held_out', now()),
    (w1, 'lc-test-j8', 'wave', 'waiting', now());
  perform pg_temp.ck('J a member''s state defaults to waiting',
    (select column_default = '''waiting''::text' from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_followup_wave_members' and column_name = 'state'));
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm) values (%L, 'lc-test-j5', 'holdout')$q$, w1));
  perform pg_temp.ck('J a holdout member is never waiting for a draft', s = '23514:cockpit_sales_followup_wave_members_holdout_check', s);
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values (%L, 'lc-test-j6', 'wave', 'held_out')$q$, w1));
  perform pg_temp.ck('J a wave member is never held_out', s = '23514:cockpit_sales_followup_wave_members_wave_check', s);
  update public.cockpit_sales_followup_wave_members set state = 'drafted' where wave_id = w1 and contact_id in ('lc-test-j3', 'lc-test-j8');
  update public.cockpit_sales_followup_wave_members set state = 'sent' where wave_id = w1 and contact_id = 'lc-test-j3';
  perform pg_temp.ck('J drafted and sent members get their times',
    (select drafted_at = now() and sent_at = now() from public.cockpit_sales_followup_wave_members where contact_id = 'lc-test-j3'));
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_wave_members set state = 'excluded', excluded_reason = 'A rep skipped the opener.'
                              where wave_id = %L and contact_id = 'lc-test-j4'$q$, w1));
  perform pg_temp.ck('J the desk''s exclusion (excluded_reason) is accepted', s = 'none', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_wave_members set state = 'failed' where wave_id = %L and contact_id = 'lc-test-j4'$q$, w1));
  perform pg_temp.ck('J a member whose draft failed can be failed', s = 'none', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_wave_members set state = 'waiting', followup_id = null, drafted_at = null
                              where wave_id = %L and contact_id = 'lc-test-j8'$q$, w1));
  perform pg_temp.ck('J a member whose draft expired goes back to waiting', s = 'none', s);
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values (%L, 'lc-test-j1', 'wave', 'waiting')$q$, w2));
  perform pg_temp.ck('J one running wave per contact: a waiting contact cannot join a second wave',
    s = '23505:cockpit_sales_followup_wave_members_one_running', s);
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values (%L, 'lc-test-j2', 'wave', 'waiting')$q$, w2));
  perform pg_temp.ck('J a held-out contact cannot be taken by another wave while its wave runs',
    s = '23505:cockpit_sales_followup_wave_members_one_running', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_wave_members set state = 'drafted' where wave_id = %L and contact_id = 'lc-test-j2'$q$, w1));
  perform pg_temp.ck('J a holdout member is never drafted', s = '23514:cockpit_sales_followup_wave_members_holdout_check', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_wave_members set state = 'sent' where wave_id = %L and contact_id = 'lc-test-j2'$q$, w1));
  perform pg_temp.ck('J a holdout member is never sent', s = '23514:cockpit_sales_followup_wave_members_holdout_check', s);
  update public.cockpit_sales_followup_wave_members set state = 'replied' where wave_id = w1 and contact_id = 'lc-test-j2';
  update public.cockpit_sales_followup_wave_members set state = 'booked' where wave_id = w1 and contact_id = 'lc-test-j2';
  perform pg_temp.ck('J a holdout member''s reply and booking are recorded (the 14-day comparison)',
    (select state = 'booked' and outcome_at = now() from public.cockpit_sales_followup_wave_members where contact_id = 'lc-test-j2'));
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values (%L, 'lc-test-j3', 'wave', 'waiting')$q$, w2));
  perform pg_temp.ck('J a sent member is not running (the desk''s own 30-day rule decides)', s = 'none', s);

  update public.cockpit_sales_followup_waves set state = 'done' where id = w1;
  perform pg_temp.ck('J a wave that is done closes its running members: waiting excluded (with a reason), held_out and drafted done; sent and outcomes kept',
    (select state = 'excluded' and excluded_reason like 'The wave ended%' from public.cockpit_sales_followup_wave_members where wave_id = w1 and contact_id = 'lc-test-j1')
    and (select state = 'done' from public.cockpit_sales_followup_wave_members where wave_id = w1 and contact_id = 'lc-test-j7')
    and (select state = 'done' from public.cockpit_sales_followup_wave_members where wave_id = w1 and contact_id = 'lc-test-j8')
    and (select state = 'sent' from public.cockpit_sales_followup_wave_members where wave_id = w1 and contact_id = 'lc-test-j3')
    and (select state = 'booked' from public.cockpit_sales_followup_wave_members where wave_id = w1 and contact_id = 'lc-test-j2')
    and (select ended_at = now() from public.cockpit_sales_followup_waves where id = w1));
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm) values (%L, 'lc-test-j1', 'wave')$q$, w2));
  perform pg_temp.ck('J after the wave ended the contact can join the next one', s = 'none', s);
  s := pg_temp.err(format($q$update public.cockpit_sales_followup_waves set state = 'running' where id = %L$q$, w1));
  perform pg_temp.ck('J an ended wave never runs again (P0001)', s = 'P0001', s);

  -- Meta, as the desk writes it for an opener.
  insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why)
    values ('lc-test-jm1', 'reactivate', 'whatsapp_template', 'Hi.', 'Backlog wave test.') returning id into f1;
  with ins as (
    insert into public.cockpit_sales_followup_meta (followup_id, kind_key, wave_id)
    values (f1, 'reactivate.ar.whatsapp_template', w2)
    on conflict (followup_id) do nothing returning 1)
  select count(*) into n from ins;
  with ins as (
    insert into public.cockpit_sales_followup_meta (followup_id, kind_key, wave_id)
    values (f1, 'reactivate.ar.whatsapp_template', w2)
    on conflict (followup_id) do nothing returning 1)
  select n * 10 + count(*) into n from ins;
  perform pg_temp.ck('J a meta row as the desk writes it, once (on conflict do nothing)', n = 10, n::text);
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_followup_meta (followup_id, kind_key) values (%L, 'reactivate:ar:whatsapp_template')
                              on conflict (followup_id) do update set kind_key = excluded.kind_key$q$, f1));
  perform pg_temp.ck('J meta refuses a malformed kind key', s = '23514:cockpit_sales_followup_meta_kind_key_check', s);
  update public.cockpit_sales_followup_meta set held_by = 'lc-test-k@example.invalid' where followup_id = f1;
  perform pg_temp.ck('J holding a draft stamps held_at', (select held_at = now() from public.cockpit_sales_followup_meta where followup_id = f1));
  update public.cockpit_sales_followup_meta set held_by = null, send_after = now() + interval '45 seconds',
                                                approved_by = 'lc-test-k@example.invalid' where followup_id = f1;
  perform pg_temp.ck('J unholding clears held_at; approving stamps approved_at; the draft is due at send_after',
    (select held_at is null and approved_at = now() and send_after = now() + interval '45 seconds'
       from public.cockpit_sales_followup_meta where followup_id = f1));
  delete from public.cockpit_sales_followups where id = f1;
  perform pg_temp.ck('J meta goes with its draft', not exists (select 1 from public.cockpit_sales_followup_meta where followup_id = f1));

  -- Stops, as desk/followups.py record_stop writes them.
  with ins as (
    insert into public.cockpit_sales_followup_stops (contact_id, said_at, kind, said, state, paused_until, created_by)
    values ('lc-test-js1', now() - interval '1 hour', 'pause', 'not interested', 'paused', now() + interval '30 days', 'sales-desk')
    on conflict (contact_id, said_at) do nothing returning 1)
  select count(*) into n from ins;
  with ins as (
    insert into public.cockpit_sales_followup_stops (contact_id, said_at, kind, said, state, paused_until, created_by)
    values ('lc-test-js1', now() - interval '1 hour', 'pause', 'not interested', 'paused', now() + interval '30 days', 'sales-desk')
    on conflict (contact_id, said_at) do nothing returning 1)
  select n * 10 + count(*) into n from ins;
  perform pg_temp.ck('J a stop is kept once per lead message', n = 10, n::text);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_stops (contact_id, said_at, kind, said, state)
                      values ('lc-test-js2', now(), 'pause', 'x', 'paused')$q$);
  perform pg_temp.ck('J a pause always has an end', s = '23514:cockpit_sales_followup_stops_paused_check', s);
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_stops (contact_id, said_at, kind, state) values ('lc-test-js2', now(), 'mute', 'asked')$q$);
  perform pg_temp.ck('J an unknown stop kind is refused', s = '23514:cockpit_sales_followup_stops_kind_check', s);
  insert into public.cockpit_sales_followup_stops (contact_id, said_at, kind, said, state)
    values ('lc-test-js3', now() - interval '5 minutes', 'unsubscribe', 'stop', 'asked');
  update public.cockpit_sales_followup_stops set state = 'dnd', decided_by = 'lc-test-k@example.invalid' where contact_id = 'lc-test-js3';
  perform pg_temp.ck('J an unsubscribe waits as asked; a rep''s answer stamps decided_at',
    (select state = 'dnd' and decided_at = now() from public.cockpit_sales_followup_stops where contact_id = 'lc-test-js3'));
exception when others then
  perform pg_temp.ck('J follow-up agent section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- K. Row security: a signed-in person who is not a seat, a seat, and anon.
do $$
declare
  n_rooms integer; n_live integer; s_presence text;
  s_insert text; s_secrets text; s_alerts text; s_claim text; s_sweep text; s_tick text; s_watchdog text; s_update text; s_lease text;
  s_anon text; s_anon_presence text;
  total integer;
  uid uuid := gen_random_uuid();
  made text;
  seat_rooms integer; seat_live integer; seat_events integer; seat_levels integer; seat_waves integer; seat_stops integer;
  seat_meta text; seat_presence text; f_mine uuid; f_other uuid;
begin
  select count(*) into total from public.cockpit_sales_rooms;
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'email', 'nobody@example.invalid')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  select count(*) into n_rooms from public.cockpit_sales_rooms;
  select count(*) into n_live from public.cockpit_sales_live;
  s_presence := pg_temp.err($q$select count(*) from public.cockpit_sales_presence$q$);
  s_insert := pg_temp.err($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
                             values (gen_random_uuid(), 'lc-test-k', 'fallback', 'intro', 'meet', 'lc-test-k@example.invalid', 'x')$q$);
  s_update := pg_temp.err($q$update public.cockpit_sales_rooms set error = 'x'$q$);
  s_secrets := pg_temp.err($q$select * from public.cockpit_sales_room_secrets$q$);
  s_alerts := pg_temp.err($q$select * from public.cockpit_sales_alerts$q$);
  s_claim := pg_temp.err($q$select * from public.cockpit_sales_live_claim(gen_random_uuid(), 'x@example.invalid')$q$);
  s_sweep := pg_temp.err($q$select public.cockpit_sales_rooms_sweep()$q$);
  s_tick := pg_temp.err($q$select public.cockpit_sales_rooms_tick()$q$);
  s_watchdog := pg_temp.err($q$select public.cockpit_sales_watchdog()$q$);
  s_lease := pg_temp.err($q$select public.cockpit_sales_room_event_lease(gen_random_uuid())$q$);
  reset role;
  set local role anon;
  s_anon := pg_temp.err($q$select count(*) from public.cockpit_sales_rooms$q$);
  s_anon_presence := pg_temp.err($q$select count(*) from public.cockpit_sales_presence$q$);
  reset role;
  perform pg_temp.ck('K a signed-in non-seat sees no rooms or handovers (rows exist)',
    total > 0 and n_rooms = 0 and n_live = 0, format('%s rooms exist; saw %s, %s', total, n_rooms, n_live));
  perform pg_temp.ck('K a signed-in person cannot read presence directly (42501; sales-api serves it)', s_presence = '42501', s_presence);
  perform pg_temp.ck('K a signed-in person cannot write rooms (42501)', s_insert = '42501' and s_update = '42501', s_insert || ' ' || s_update);
  perform pg_temp.ck('K a signed-in person cannot read host links or alerts (42501)', s_secrets = '42501' and s_alerts = '42501');
  perform pg_temp.ck('K a signed-in person cannot run the claim, the lease, the sweep, the tick or the watchdog (42501)',
    s_claim = '42501' and s_lease = '42501' and s_sweep = '42501' and s_tick = '42501' and s_watchdog = '42501',
    concat_ws(' ', s_claim, s_lease, s_sweep, s_tick, s_watchdog));
  perform pg_temp.ck('K anon reads nothing (42501)', s_anon = '42501' and s_anon_presence = '42501');

  -- A seat (a setter who is not a manager) reads what a seat reads.
  made := pg_temp.errm(format($q$insert into auth.users (id, email, email_confirmed_at, aud, role)
                                  values (%L, 'lc-test-seat@example.invalid', now(), 'authenticated', 'authenticated')$q$, uid));
  if made <> 'none' then
    perform pg_temp.ck('K seat checks skipped: cannot make a test sign-in', true, made);
    return;
  end if;
  insert into public.cockpit_sales_people (email, name, role, active, via_portal, ghl_user_id)
    values ('lc-test-seat@example.invalid', 'Test', 'setter', true, true, null);
  insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why, owner_email)
    values ('lc-test-km1', 'reactivate', 'whatsapp_template', 'Hi.', 'Test.', 'lc-test-seat@example.invalid') returning id into f_mine;
  insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why, owner_email)
    values ('lc-test-km2', 'reactivate', 'whatsapp_template', 'Hi.', 'Test.', 'lc-test-someone@example.invalid') returning id into f_other;
  insert into public.cockpit_sales_followup_meta (followup_id, kind_key) values
    (f_mine, 'reactivate.en.whatsapp_template'), (f_other, 'reactivate.en.whatsapp_template');
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated', 'email', 'lc-test-seat@example.invalid')::text, true);
  set local role authenticated;
  select count(*) into seat_rooms from public.cockpit_sales_rooms;
  select count(*) into seat_live from public.cockpit_sales_live;
  select count(*) into seat_events from public.cockpit_sales_room_events;
  select count(*) into seat_levels from public.cockpit_sales_followup_levels;
  select count(*) into seat_waves from public.cockpit_sales_followup_waves;
  select count(*) into seat_stops from public.cockpit_sales_followup_stops;
  select string_agg(followup_id::text, ',') into seat_meta from public.cockpit_sales_followup_meta
   where followup_id in (f_mine, f_other);
  seat_presence := pg_temp.err($q$select count(*) from public.cockpit_sales_presence$q$);
  reset role;
  perform pg_temp.ck('K a seat reads rooms, handovers, room events, levels, waves and stops',
    seat_rooms = total and seat_live > 0 and seat_events > 0 and seat_levels > 0 and seat_waves > 0 and seat_stops > 0,
    format('rooms %s of %s, live %s, events %s, levels %s, waves %s, stops %s',
           seat_rooms, total, seat_live, seat_events, seat_levels, seat_waves, seat_stops));
  perform pg_temp.ck('K a seat reads the meta of its own drafts, not of another rep''s', seat_meta = f_mine::text, seat_meta);
  perform pg_temp.ck('K a seat cannot read presence directly either (sales-api live.status serves it)', seat_presence = '42501', seat_presence);
exception when others then
  reset role;
  perform pg_temp.ck('K row security section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- L. Review fixes that need the sweep after the claim (run after F, so F's
--    counts are its own).
do $$
declare
  l uuid; l5 uuid; r1 uuid; r2 uuid; rm uuid; s jsonb; got public.cockpit_sales_live; e uuid; t text;
begin
  -- The taker leaves before the lead comes; the handover is offered again and
  -- the other closer takes it: the lead's first room points at the new one.
  insert into public.cockpit_sales_availability (email, state, until) values
    ('lc-test-x5t@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-x5u@example.invalid', 'available', now() + interval '1 hour');
  r1 := pg_temp.room(null, 'lc-test-x5t@example.invalid', 'standby', 'host_in', 'demo');
  r2 := pg_temp.room(null, 'lc-test-x5u@example.invalid', 'standby', 'host_in', 'demo');
  l := pg_temp.live('lc-test-x5', array['lc-test-x5t@example.invalid', 'lc-test-x5u@example.invalid']);
  l5 := l;
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-x5t@example.invalid');
  update public.cockpit_sales_rooms set link_sent_at = now() where id = r1;
  update public.cockpit_sales_rooms set state = 'open' where id = r1;
  update public.cockpit_sales_rooms set host_by = now() - interval '1 second' where id = r1;
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('L setup: offered again, once, to the other closer',
    (select state = 'offered' and reoffers = 1 and offered_to = array['lc-test-x5u@example.invalid'] from public.cockpit_sales_live where id = l));
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-x5u@example.invalid');
  perform pg_temp.ck('L after the second Take, the first room points at the second (replaced_by), so the lead''s link follows',
    got.room_id = r2 and (select replaced_by = r2 and state = 'expired' from public.cockpit_sales_rooms where id = r1),
    format('second room %s, first replaced_by %s', got.room_id, (select replaced_by from public.cockpit_sales_rooms where id = r1)));
  perform pg_temp.ck('L each Take of the handover has its own live.claimed event',
    exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'live.claimed:' || l::text || ':0')
    and exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'live.claimed:' || l::text || ':1'));

  -- A handover room the taker entered whose link never went, 3 hours on:
  -- the room and the handover end, and the closer can take the next lead.
  l := pg_temp.live('lc-test-x2b', array['lc-test-x2k@example.invalid']);
  rm := pg_temp.room('lc-test-x2b', 'lc-test-x2k@example.invalid', 'handover', 'host_in', 'demo');
  update public.cockpit_sales_rooms set requested_at = now() - interval '3 hours', opened_at = now() - interval '3 hours',
                                        host_in_at = now() - interval '3 hours', handover_id = l, send_on = 'host_in' where id = rm;
  update public.cockpit_sales_live set state = 'claimed', claimed_by = 'lc-test-x2k@example.invalid', room_id = rm where id = l;
  update public.cockpit_sales_live set state = 'room_ready', claimed_at = now() - interval '3 hours' where id = l;
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('L a room_ready handover whose room never sent the link is ended within the run',
    (select state = 'expired' from public.cockpit_sales_live where id = l)
    and (select state = 'expired' from public.cockpit_sales_rooms where id = rm));
  t := pg_temp.dry(format('select * from public.cockpit_sales_live_claim(%L, %L)',
         pg_temp.live('lc-test-x2c', array['lc-test-x2k@example.invalid']), 'lc-test-x2k@example.invalid'));
  perform pg_temp.ck('L that closer can take the next live lead', t = 'none', t);
  t := pg_temp.dry(format('select * from public.cockpit_sales_live_claim(%L, %L)',
         pg_temp.live('lc-test-x3b', array['lc-test-l11@example.invalid']), 'lc-test-l11@example.invalid'));
  perform pg_temp.ck('L the closer of the "That was not the lead" handover can take the next live lead', t = 'none', t);

  -- One room.event run per event: the lease.
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at)
    values (null, 'zoom.meeting.started', 'zoom', 'lc-test-lease', now() - interval '1 minute') returning id into e;
  perform pg_temp.ck('L the first room.event run takes the event', public.cockpit_sales_room_event_lease(e) = e);
  perform pg_temp.ck('L a second run while it is held gets nothing (by id or by dedupe key)',
    public.cockpit_sales_room_event_lease(e) is null
    and public.cockpit_sales_room_event_lease(p_dedupe_key => 'lc-test-lease') is null);
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('L the sweep neither replays nor gives up a held event',
    not ((s -> 'replay') ? e::text)
    and (select handled_at is null and tries = 0 from public.cockpit_sales_room_events where id = e), s ->> 'replay');
  update public.cockpit_sales_room_events set lease_until = now() - interval '1 second' where id = e;
  perform pg_temp.ck('L a hold that ran out can be taken again', public.cockpit_sales_room_event_lease(p_dedupe_key => 'lc-test-lease') = e);
  update public.cockpit_sales_room_events set handled_at = now(), lease_until = null where id = e;
  perform pg_temp.ck('L a handled event is never taken', public.cockpit_sales_room_event_lease(e) is null
    and public.cockpit_sales_room_event_lease() is null);

  -- A Take whose sales-api run stopped: after its hold the claim event is
  -- replayed to room.event, so the link still goes.
  update public.cockpit_sales_room_events set lease_until = now() - interval '1 second', at = now() - interval '70 seconds'
   where dedupe_key = 'live.claimed:' || l5::text || ':0';
  update public.cockpit_sales_room_events set handled_at = now()
   where handled_at is null and dedupe_key <> 'live.claimed:' || l5::text || ':0';
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('L a Take sales-api did not finish is replayed to room.event after its 60 s hold',
    (s -> 'replay') = to_jsonb(array[(select id::text from public.cockpit_sales_room_events
                                       where dedupe_key = 'live.claimed:' || l5::text || ':0')]), s ->> 'replay');
exception when others then
  perform pg_temp.ck('L section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- Z. A code the guard picks never collides: it tries again. Last, because it
--    swaps cockpit_sales_room_code for a fixed sequence (rolled back).
create temp sequence lc_codes;
create or replace function public.cockpit_sales_room_code()
returns text language sql volatile set search_path = '' as $$
  select case when nextval('pg_temp.lc_codes') <= 2 then 'ZZZZZZ' else 'YYYYYY' end
$$;
do $$
declare
  got_code text; rid uuid;
begin
  insert into public.cockpit_sales_rooms (request_id, code, contact_id, purpose, call_kind, provider, host_email, made_by)
  values (gen_random_uuid(), 'ZZZZZZ', 'lc-test-z1', 'fallback', 'intro', 'meet', 'lc-test-z1@example.invalid', 'x');
  rid := pg_temp.room('lc-test-z2', 'lc-test-z2@example.invalid', 'fallback');
  select code into got_code from public.cockpit_sales_rooms where id = rid;
  perform pg_temp.ck('Z a picked code that a room already has is picked again (never read as a repeated request)',
    got_code = 'YYYYYY' and currval('pg_temp.lc_codes') = 3, got_code);
exception when others then
  perform pg_temp.ck('Z code retry section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;
