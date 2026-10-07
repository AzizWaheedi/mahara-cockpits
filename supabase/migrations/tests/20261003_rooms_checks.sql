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
--
-- Integration pass (contract-v2.md, 2026-10-03): C checks the new room
-- columns, the device names and the open-columns guard; E2 runs the shared
-- presence fixtures (presence_fixtures.json, loaded by run_checks.py); F
-- checks the settle rule, the pending-events hold, the grace cap, the
-- too-old give-up and the tick list; G4 the room host check, the sales-live
-- rows and config alerts; H the tick posts; J the desk's wave columns and the
-- done wave left to the desk; L the lease release and length.

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

-- A sales manager for this run (20261004a's settings guard turns a switch
-- on only for a write that names one); rolled back with the rest.
insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('lc-test-manager@example.invalid', 'Test Manager', 'manager', true, 'lc-test')
on conflict (email) do nothing;
-- The run names that manager as the actor of its writes (20261004a's
-- guard reads mahara.actor, m1 round 6); a check that needs a write naming
-- nobody clears it for that write.
select set_config('mahara.actor', 'lc-test-manager@example.invalid', true);
-- Production's open door alerts (sales-live is not deployed yet) are
-- resolved for this run, so the sweep's own row reads as these checks set it
-- up (20261004a keeps it red while one is open, m1 round 6).
update public.cockpit_sales_alerts set resolved_at = now()
 where dedupe_key in ('sweep:door_refused', 'sweep:pg_net_silent') and resolved_at is null;

-- A2. Settings: the new rows are the glossary values; existing rows gained
--     only the keys they lacked and kept every value they had.
do $$
declare
  g jsonb; f jsonb; wf jsonb; au record;
begin
  perform pg_temp.ck('A2 setting rooms is the glossary value, every switch off (settle and wrap too, 20261004a)',
    (select s.value from public.cockpit_sales_settings as s where s.key = 'rooms') =
    '{"enabled": false, "test_only": true, "test_contacts": ["VjPfR4Cc1Y0OFvaqeor5"], "test_calendar_id": null,
      "providers": {"zoom": false, "meet": false}, "default_provider": {"setter": "meet", "closer": "zoom"},
      "send": {"whatsapp_text": false, "whatsapp_template": false, "email": false},
      "template_route": "call_link", "count_on_join": false, "settle": false, "wrap": false, "short_link": false,
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
  -- room.mark not_lead writes count_undo_at with the move (rooms.ts, roomlogic notLead).
  update public.cockpit_sales_rooms set state = 'host_in', count_undo_at = now() where id = b;
  select * into r from public.cockpit_sales_rooms where id = b;
  perform pg_temp.ck('C "That was not the lead": lead_in back to host_in keeps lead_in_at (the taken-back join''s time, never after count_undo_at) and gives open_grace',
    r.state = 'host_in' and r.lead_in_at is not null and r.lead_in_at <= r.count_undo_at
    and r.lead_by = now() + interval '180 seconds');
  update public.cockpit_sales_rooms set state = 'lead_in' where id = b;
  select * into r from public.cockpit_sales_rooms where id = b;
  perform pg_temp.ck('C a new move into lead_in after it, its writer leaving lead_in_at as it was: stamped now, with lead_in_seen_at',
    r.state = 'lead_in' and r.lead_in_at = now() and r.lead_in_seen_at = now());
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

  -- Integration pass: the columns roomlogic.ts writes, and the door's device names.
  x := pg_temp.room('lc-test-c20', 'lc-test-h20@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set link_claimed_at = now() where id = x;
  update public.cockpit_sales_rooms set link_unconfirmed_at = now(), link_sent_at = now(),
                                        link_channels = '{whatsapp_template,email}' where id = x;
  update public.cockpit_sales_rooms set count_claimed_at = now(), count_result = 'booked' where id = x;
  update public.cockpit_sales_rooms set count_undo_at = now() where id = x;
  select * into r from public.cockpit_sales_rooms where id = x;
  perform pg_temp.ck('C link_claimed_at, link_unconfirmed_at and count_undo_at are written and never move the version',
    r.link_claimed_at = now() and r.link_unconfirmed_at = now() and r.count_undo_at = now() and r.version = 1,
    format('version %s', r.version));
  s := pg_temp.dry(format('update public.cockpit_sales_rooms set open_device = %L where id = %L', 'computer', x));
  perform pg_temp.ck('C open_device takes computer (the door''s and roomlogic''s name)', s = 'none', s);
  s := pg_temp.dry(format('update public.cockpit_sales_rooms set open_device = %L where id = %L', 'desktop', x));
  perform pg_temp.ck('C open_device refuses desktop (the old name)', s = '23514:cockpit_sales_rooms_open_device_check', s);
  s := pg_temp.dry(format('update public.cockpit_sales_rooms set open_device = %L where id = %L', 'unknown', x));
  perform pg_temp.ck('C open_device refuses unknown (null means not known)', s = '23514:cockpit_sales_rooms_open_device_check', s);
  perform pg_temp.ck('C open_device takes phone, tablet and null',
    pg_temp.dry(format('update public.cockpit_sales_rooms set open_device = %L where id = %L', 'phone', x)) = 'none'
    and pg_temp.dry(format('update public.cockpit_sales_rooms set open_device = %L where id = %L', 'tablet', x)) = 'none'
    and pg_temp.dry(format('update public.cockpit_sales_rooms set open_device = null where id = %L', x)) = 'none');

  -- The open columns, as the door writes them: never back, never a version.
  update public.cockpit_sales_rooms set first_open_at = now() - interval '5 minutes', open_device = 'computer' where id = x;
  update public.cockpit_sales_rooms set last_open_at = now() - interval '1 minute' where id = x;
  update public.cockpit_sales_rooms set first_open_at = now() - interval '2 minutes', last_open_at = now() - interval '4 minutes',
                                        open_device = 'phone' where id = x;
  select * into r from public.cockpit_sales_rooms where id = x;
  perform pg_temp.ck('C a late open never moves first_open_at later or last_open_at back, and the first device stays',
    r.first_open_at = now() - interval '5 minutes' and r.last_open_at = now() - interval '1 minute' and r.open_device = 'computer',
    format('%s %s %s', r.first_open_at, r.last_open_at, r.open_device));
  update public.cockpit_sales_rooms set first_open_at = now() - interval '9 minutes' where id = x;
  update public.cockpit_sales_rooms set first_open_at = null, last_open_at = null, open_device = null where id = x;
  select * into r from public.cockpit_sales_rooms where id = x;
  perform pg_temp.ck('C an earlier open moves first_open_at earlier; nothing clears the open columns',
    r.first_open_at = now() - interval '9 minutes' and r.last_open_at = now() - interval '1 minute' and r.open_device = 'computer');
  perform pg_temp.ck('C the door''s open writes never move the version (the lead''s tap never makes a press stale)',
    r.version = 1, format('version %s', r.version));
  update public.cockpit_sales_rooms set state = 'expired' where id = x;
  update public.cockpit_sales_rooms set last_open_at = now() where id = x;
  perform pg_temp.ck('C an open on a closed room is still counted (last_open_at) without a state change',
    (select last_open_at = now() and state = 'expired' from public.cockpit_sales_rooms where id = x));

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

-- Live handover on for D to L (20261004a's Milestone 1 fence holds the
-- claim, the re-offer and the fresh standby room while it is off; M checks
-- it off). A manager turns it on.
update public.cockpit_sales_settings
   set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{enabled}', 'true')
 where key = 'live';

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
  -- Refused by the room the first claim reserved (take_host_busy, P0001,
  -- 20261003d round 3) before the one-claim index (23505) is reached.
  perform pg_temp.ck('D live_one_claim_per_closer: a closer holding a live call cannot take another',
    s in ('23505:cockpit_sales_live_one_claim_per_closer', 'P0001:-'), s);
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

  -- No standby room: the claim reserves the taker's room itself (20261003d,
  -- fix round 3), so the one-room-per-host index decides against any other
  -- room of theirs; sales-api finds it by its request id (the live id).
  lr := pg_temp.room('lc-test-d13', 'lc-test-setter13@example.invalid', 'fallback', 'open');
  l := pg_temp.live('lc-test-d13', array['lc-test-knone@example.invalid']);
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-knone@example.invalid');
  select * into r from public.cockpit_sales_rooms where id = got.room_id;
  perform pg_temp.ck('D no standby room: claimed (claim_room none) with the taker''s room reserved: requested, handover, sales-api''s request id, the lead''s room made way',
    got.state = 'claimed' and got.claim_room = 'none' and got.room_id is not null
    and r.state = 'requested' and r.purpose = 'handover' and r.request_id = l and r.handover_id = l
    and r.host_email = 'lc-test-knone@example.invalid' and r.contact_id = 'lc-test-d13' and r.call_kind = 'demo'
    and (select state = 'cancelled' and end_reason = 'replaced' from public.cockpit_sales_rooms where id = lr),
    format('%s %s %s', got.state, got.claim_room, r.state));
  perform pg_temp.ck('D the reserved room takes the lead''s old link (replaced_by)',
    (select replaced_by = got.room_id from public.cockpit_sales_rooms where id = lr));
  s := pg_temp.dry(format('insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by) values (gen_random_uuid(), %L, %L, %L, %L, %L, %L)',
         'lc-test-d13-other', 'fallback', 'intro', 'zoom', 'lc-test-knone@example.invalid', 'lc-test'));
  perform pg_temp.ck('D a room that closer then opens for another lead is refused (one room per host): never the other way round',
    s = '23505:cockpit_sales_rooms_one_per_host', s);

  -- A re-offer's claim reserves its room on the request id sales-api works
  -- out for it (liveio.ts uuidFrom('mahara-live/{id}/{reoffers}'), pinned in
  -- rooms.test.ts with the same value).
  insert into public.cockpit_sales_live (id, request_id, contact_id, asked_by, kind, reason, offered_to, offer_until, reoffers)
  values ('00000000-0000-4000-8000-00000000d014', gen_random_uuid(), 'lc-test-d14', 'lc-test-setter@example.invalid', 'demo',
          'on_call', array['lc-test-kreoffer@example.invalid'], now() + interval '2 minutes', 1);
  select * into got from public.cockpit_sales_live_claim('00000000-0000-4000-8000-00000000d014', 'lc-test-kreoffer@example.invalid');
  perform pg_temp.ck('D a re-offer''s reserved room carries sales-api''s request id for it',
    (select request_id = '5f3c75fe-140c-544a-85d2-1c2fe98ad064'::uuid from public.cockpit_sales_rooms where id = got.room_id),
    (select request_id::text from public.cockpit_sales_rooms where id = got.room_id));

  perform pg_temp.ck('D a closer whose adopted room waits for the lead is on_call (room_waiting, that room)',
    (select state = 'on_call' and why = 'room_waiting' and room_id is not null
       from public.cockpit_sales_presence where email = 'lc-test-ks@example.invalid'));
  perform pg_temp.ck('D a closer who joined the setter''s room with the lead is on_call through the handover they hold',
    (select state = 'on_call' and why = 'handover' and room_id = (select room_id from public.cockpit_sales_live where claimed_by = 'lc-test-klr@example.invalid')
       from public.cockpit_sales_presence where email = 'lc-test-klr@example.invalid'));
  perform pg_temp.ck('D a closer holding a handover with no room (the lead''s booked call is open) is on_call, not offered more',
    (select state = 'on_call' and why = 'handover' from public.cockpit_sales_presence where email = 'lc-test-kbusy@example.invalid'));
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
    ('lc-test-p-chain@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-p-zoom-over@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-p-zoom-old@example.invalid', 'available', now() + interval '1 hour');
  perform pg_temp.room(null, 'lc-test-p-ready@example.invalid', 'standby', 'host_in', 'demo');
  insert into public.cockpit_sales_room_hosts (email, zoom_live_until, default_provider)
    values ('lc-test-p-zoom@example.invalid', now() + interval '10 minutes', null);
  -- 20261004a: the desk stores the meeting's own end. A meeting the last
  -- check saw live, now past its scheduled end (a demo that overruns), holds
  -- the host on a call for the check's 15 minutes; an old sighting does not.
  insert into public.cockpit_sales_room_hosts (email, zoom_live_until, checked_at, default_provider) values
    ('lc-test-p-zoom-over@example.invalid', now() - interval '2 minutes', now() - interval '5 minutes', null),
    ('lc-test-p-zoom-old@example.invalid', now() - interval '30 minutes', now() - interval '20 minutes', null);
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
    -- Past its whole length (an intro is 30 minutes, rooms.lengths_min; 20261003d round 3).
    ('lc-test-appt-e2', 'lc-test-e-c2', 'intro', 'confirmed', 'lc-test-ghl-appt-old', now() - interval '40 minutes', 'ghl'),
    ('lc-test-appt-e3', 'lc-test-e-c3', 'demo', 'confirmed', 'lc-test-ghl-demo', now() - interval '40 minutes', 'ghl');

  for p in select * from public.cockpit_sales_presence where email like 'lc-test-p-%' loop
    perform pg_temp.ck('E presence ' || p.email || ' is ' || p.why,
      case p.email
        when 'lc-test-p-ready@example.invalid' then p.state = 'ready' and p.why = 'standby' and p.room_id is not null and p.until = now() + interval '1 hour'
        when 'lc-test-p-avail@example.invalid' then p.state = 'available' and p.until is not null
        when 'lc-test-p-expired@example.invalid' then p.state = 'away' and p.until is null
        when 'lc-test-p-zoom@example.invalid' then p.state = 'on_call' and p.why = 'zoom' and p.until is null
        when 'lc-test-p-zoom-over@example.invalid' then p.state = 'on_call' and p.why = 'zoom'
        when 'lc-test-p-zoom-old@example.invalid' then p.state = 'available'
        when 'lc-test-p-chain@example.invalid' then p.state = 'available'
        when 'lc-test-p-attempt@example.invalid' then p.state = 'on_call' and p.why = 'dialing'
        when 'lc-test-p-attempt-old@example.invalid' then p.state = 'away'
        when 'lc-test-p-appt@example.invalid' then p.state = 'on_call' and p.why = 'appointment' and p.default_provider = 'zoom'
        when 'lc-test-p-appt-old@example.invalid' then p.state = 'away'
        when 'lc-test-p-demo@example.invalid' then p.state = 'on_call' and p.why = 'appointment'
        else false end,
      p.state || ' ' || p.why);
  end loop;
  perform pg_temp.ck('E presence lists every test person once',
    (select count(*) = 12 and count(distinct email) = 12 from public.cockpit_sales_presence where email like 'lc-test-p-%'));
  perform pg_temp.ck('E default provider: setter meet, closer zoom',
    (select default_provider = 'meet' from public.cockpit_sales_presence where email = 'lc-test-p-attempt@example.invalid')
    and (select default_provider = 'zoom' from public.cockpit_sales_presence where email = 'lc-test-p-demo@example.invalid'));

  sb := pg_temp.room(null, 'lc-test-p-chain@example.invalid', 'standby', 'host_in', 'demo');
  insert into public.cockpit_sales_attempts (contact_id, rep_email, state)
    values ('lc-test-e-chain', 'lc-test-p-chain@example.invalid', 'dialing') returning id into att;
  perform pg_temp.ck('E precedence: available + ready + a dial is on_call',
    (select state = 'on_call' and why = 'dialing' from public.cockpit_sales_presence where email = 'lc-test-p-chain@example.invalid'));
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
    (select state = 'on_call' and why = 'lead_in' from public.cockpit_sales_presence where email = 'lc-test-p-chain@example.invalid'));
  perform pg_temp.ck('E availability: available needs an until',
    pg_temp.dry($q$insert into public.cockpit_sales_availability (email, state) values ('lc-test-p-x@example.invalid', 'available')$q$)
      = '23514:cockpit_sales_availability_until_check');
exception when others then
  perform pg_temp.ck('E presence section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- E2. Presence on the shared fixture set (tests/presence_fixtures.json, the
--     same file roomlogic.ts presenceOf and defaultProvider are checked on),
--     then the reason fields. The fixture rooms are cancelled at the end so
--     the sweep in F does not see them as live.
do $$
declare
  fx record; rm record; v_email text; ghl text; ids uuid[]; got record; rid uuid; prov jsonb; want_room uuid;
  booked boolean; got_p text; n integer := 0;
begin
  if to_regclass('pg_temp.lc_presence_fixtures') is null then
    perform pg_temp.ck('E2 the shared presence fixtures are loaded (run through run_checks.py)', false);
    return;
  end if;
  for fx in
    select f.value as f, f.ordinality as i
      from pg_temp.lc_presence_fixtures as d, jsonb_array_elements(d.doc -> 'presence') with ordinality as f
  loop
    v_email := format('lc-test-pf%s@example.invalid', fx.i);
    ghl := format('lc-test-ghl-pf%s', fx.i);
    insert into public.cockpit_sales_people (email, name, role, active, ghl_user_id) values (v_email, 'Test', fx.f ->> 'role', true, ghl);
    if jsonb_typeof(fx.f -> 'availability') = 'object' then
      insert into public.cockpit_sales_availability (email, state, until)
      values (v_email, fx.f #>> '{availability,state}',
              case when jsonb_typeof(fx.f #> '{availability,until_s}') = 'number'
                   then now() + make_interval(secs => (fx.f #>> '{availability,until_s}')::double precision) end);
    end if;
    ids := '{}';
    for rm in select r.value as r, r.ordinality as j from jsonb_array_elements(fx.f -> 'rooms') with ordinality as r loop
      booked := rm.r ->> 'purpose' = 'booked';
      insert into public.cockpit_sales_rooms
        (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, appointment_id,
         host_by, lead_by, ends_at)
      values (gen_random_uuid(),
              case when (rm.r ->> 'lead')::boolean then format('lc-test-pf%s-%s', fx.i, rm.j) end,
              rm.r ->> 'purpose', 'intro', rm.r ->> 'provider', v_email, v_email, rm.r ->> 'state',
              case when rm.r ->> 'state' in ('open', 'host_in', 'lead_in', 'ended') then 'https://zoom.example.invalid/j/pf' end,
              case when booked then format('lc-test-appt-pf%s-%s', fx.i, rm.j) end,
              case when booked then now() + interval '15 minutes' end,
              case when booked then now() + interval '20 minutes' end,
              case when booked then now() + interval '60 minutes' end)
      returning id into rid;
      ids := ids || rid;
    end loop;
    if coalesce((fx.f ->> 'open_attempt')::boolean, false) then
      insert into public.cockpit_sales_attempts (contact_id, rep_email, state) values (format('lc-test-pf%s-dial', fx.i), v_email, 'dialing');
    end if;
    if coalesce((fx.f ->> 'appointment_soon')::boolean, false) then
      insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, status, assigned_user_id, start_at, origin)
      values (format('lc-test-appt-pfsoon%s', fx.i), format('lc-test-pf%s-soon', fx.i), 'demo', 'confirmed', ghl,
              now() + interval '5 minutes', 'ghl');
    end if;
    if coalesce((fx.f ->> 'appointment_now')::boolean, false) then
      insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, status, assigned_user_id, start_at, origin)
      values (format('lc-test-appt-pfnow%s', fx.i), format('lc-test-pf%s-appt', fx.i), 'intro', 'confirmed', ghl,
              now() - interval '5 minutes', 'ghl');
    end if;
    if jsonb_typeof(fx.f -> 'zoom_live_s') = 'number' then
      insert into public.cockpit_sales_room_hosts (email, zoom_live_until)
      values (v_email, now() + make_interval(secs => (fx.f ->> 'zoom_live_s')::double precision));
    end if;
    select pr.state, pr.why, pr.room_id, pr.until into got from public.cockpit_sales_presence as pr where pr.email = v_email;
    want_room := case when jsonb_typeof(fx.f #> '{expect,room}') = 'number' then ids[(fx.f #>> '{expect,room}')::integer + 1] end;
    perform pg_temp.ck('E2 presence fixture: ' || (fx.f ->> 'name'),
      got.state = fx.f #>> '{expect,state}' and got.why = fx.f #>> '{expect,why}'
      and got.room_id is not distinct from want_room
      and (got.until is not null) = (fx.f #>> '{expect,until}')::boolean,
      format('got %s/%s room %s until %s; want %s', got.state, got.why, got.room_id, got.until, fx.f -> 'expect'));
    n := n + 1;
  end loop;
  perform pg_temp.ck('E2 every presence fixture was checked', n >= 20 and n = (select jsonb_array_length(doc -> 'presence') from pg_temp.lc_presence_fixtures), n::text);
  update public.cockpit_sales_rooms set state = 'cancelled'
   where host_email like 'lc-test-pf%' and state in ('requested', 'creating', 'open', 'host_in', 'lead_in');
  update public.cockpit_sales_attempts set state = 'saved' where rep_email like 'lc-test-pf%';

  -- default_provider: the host's choice, else the role's, giving way to what the host can use.
  select value -> 'providers' into prov from public.cockpit_sales_settings where key = 'rooms';
  n := 0;
  for fx in
    select f.value as f, f.ordinality as i
      from pg_temp.lc_presence_fixtures as d, jsonb_array_elements(d.doc -> 'default_provider') with ordinality as f
  loop
    v_email := format('lc-test-dp%s@example.invalid', fx.i);
    insert into public.cockpit_sales_people (email, name, role, active) values (v_email, 'Test', fx.f ->> 'role', true);
    if jsonb_typeof(fx.f -> 'host') = 'object' then
      insert into public.cockpit_sales_room_hosts (email, zoom_status, google_ok, default_provider)
      values (v_email, fx.f #>> '{host,zoom_status}', coalesce((fx.f #>> '{host,google_ok}')::boolean, false),
              fx.f #>> '{host,default_provider}');
    end if;
    update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{providers}', fx.f -> 'providers') where key = 'rooms';
    select pr.default_provider into got_p from public.cockpit_sales_presence as pr where pr.email = v_email;
    perform pg_temp.ck('E2 default provider: ' || (fx.f ->> 'name'), got_p = fx.f ->> 'expect',
      format('got %s, want %s', got_p, fx.f ->> 'expect'));
    n := n + 1;
  end loop;
  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{providers}', prov) where key = 'rooms';
  perform pg_temp.ck('E2 every default provider fixture was checked',
    n >= 10 and n = (select jsonb_array_length(doc -> 'default_provider') from pg_temp.lc_presence_fixtures), n::text);

  -- reason, booked_at, booked_kind.
  insert into public.cockpit_sales_people (email, name, role, active, ghl_user_id) values
    ('lc-test-pr1@example.invalid', 'Test', 'closer', true, null),
    ('lc-test-pr2@example.invalid', 'Test', 'closer', true, 'lc-test-ghl-pr2'),
    ('lc-test-pr3@example.invalid', 'Test', 'closer', true, null);
  insert into public.cockpit_sales_availability (email, state, until, via, reason) values
    ('lc-test-pr1@example.invalid', 'away', null, 'sweep', 'missed_offer'),
    ('lc-test-pr2@example.invalid', 'available', now() + interval '1 hour', 'cockpit', null),
    ('lc-test-pr3@example.invalid', 'available', now() + interval '1 hour', 'cockpit', 'missed_offer');
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, status, assigned_user_id, start_at, origin)
  values ('lc-test-appt-pr2', 'lc-test-pr2-lead', 'demo', 'confirmed', 'lc-test-ghl-pr2', now() + interval '8 minutes', 'ghl');
  rid := pg_temp.room(null, 'lc-test-pr2@example.invalid', 'standby', 'host_in', 'demo');
  update public.cockpit_sales_rooms set state = 'ended', end_reason = 'booked_call_soon' where id = rid;
  perform pg_temp.ck('E2 reason: Away after a missed offer says missed_offer',
    (select state = 'away' and reason = 'missed_offer' and booked_at is null from public.cockpit_sales_presence
      where email = 'lc-test-pr1@example.invalid'));
  perform pg_temp.ck('E2 reason: Available again clears the miss',
    (select state = 'available' and reason is null from public.cockpit_sales_presence where email = 'lc-test-pr3@example.invalid'));
  -- 20261003d: a booked call of theirs within booked_guard makes them away
  -- (why booked_soon), so no live lead is offered while it is near.
  perform pg_temp.ck('E2 reason: a booked call within 10 minutes says booked_call_soon, with that call''s time and kind, and no offer reaches them (away)',
    (select state = 'away' and why = 'booked_soon' and reason = 'booked_call_soon' and booked_at = now() + interval '8 minutes'
            and booked_kind = 'demo'
       from public.cockpit_sales_presence where email = 'lc-test-pr2@example.invalid'),
    (select row_to_json(pr)::text from public.cockpit_sales_presence as pr where pr.email = 'lc-test-pr2@example.invalid'));
  update public.cockpit_sales_appointments set start_at = now() + interval '1 day' where appointment_id = 'lc-test-appt-pr2';
  perform pg_temp.ck('E2 reason: once the booked call is no longer near, booked_call_soon is no longer the reason',
    (select reason is null and booked_at is null and why <> 'booked_soon' from public.cockpit_sales_presence
      where email = 'lc-test-pr2@example.invalid'));
exception when others then
  perform pg_temp.ck('E2 presence fixtures section crashed', false, sqlstate || ': ' || sqlerrm);
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
  -- Settle and the count on too (20261004a's Milestone 1 switches, off as
  -- shipped): F to R4 check what they do once a manager turns them on; M
  -- checks them off.
  update public.cockpit_sales_settings
     set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(),
         value = jsonb_set(jsonb_set(value, '{enabled}', 'true'), '{providers,zoom}', 'true') || '{"settle": true, "count_on_join": true}'::jsonb
   where key = 'rooms';
  -- Live handover on: R5's fresh standby room and L3's re-offer run only then (20261004a).
  update public.cockpit_sales_settings
     set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{enabled}', 'true')
   where key = 'live';
  -- Live calls run at any hour for this run (R5 makes a fresh standby room
  -- only inside live.hours; 20261003d).
  update public.cockpit_sales_settings
     set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{hours}', '{"days": [0, 1, 2, 3, 4, 5, 6], "from": "00:00", "to": "24:00", "tz": "Asia/Kuwait"}')
   where key = 'live';

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
  -- f[25]: the setter's fallback room for a booked intro (D14): the host never came.
  f[25] := pg_temp.room('lc-test-f25', 'lc-test-f25@example.invalid', 'fallback', 'open', 'intro');
  -- Made a minute after the intro's start (a room never settles an intro it was not made for; 20261003d).
  update public.cockpit_sales_rooms set appointment_id = 'lc-test-appt-f25', host_by = now() - interval '6 minutes',
                                        lead_by = now() - interval '1 minute', requested_at = now() - interval '20 minutes' where id = f[25];
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

  -- Settling a booked intro (D14, roomlogic.ts settleDue): f[33] to f[38],
  -- each with its own intro that started 25 minutes ago.
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, status, assigned_user_id, start_at, origin)
  select 'lc-test-appt-f' || g, 'lc-test-f' || g, 'intro', case when g = 35 then 'noshow' else 'confirmed' end,
         'lc-test-ghl-f' || g, now() - interval '25 minutes', 'ghl'
    from generate_series(33, 38) as g;
  -- f[33]: a booked room (it wraps the intro itself): never settled here.
  f[33] := pg_temp.room('lc-test-f33', 'lc-test-f33@example.invalid', 'booked', 'open', 'intro', 'lc-test-appt-f33');
  update public.cockpit_sales_rooms set host_by = now() - interval '6 minutes', lead_by = now() - interval '1 minute' where id = f[33];
  -- f[34]: the lead knocked and was never let in: admit_blocked, never a no-show.
  f[34] := pg_temp.room('lc-test-f34', 'lc-test-f34@example.invalid', 'fallback', 'host_in', 'intro');
  update public.cockpit_sales_rooms set appointment_id = 'lc-test-appt-f34', lead_by = now() - interval '5 minutes',
                                        lead_waiting_at = now() - interval '10 minutes' where id = f[34];
  -- f[35]: the intro is already marked (noshow): nothing to settle.
  f[35] := pg_temp.room('lc-test-f35', 'lc-test-f35@example.invalid', 'fallback', 'open', 'intro');
  update public.cockpit_sales_rooms set appointment_id = 'lc-test-appt-f35', host_by = now() - interval '6 minutes' where id = f[35];
  -- f[36]: End room before anyone came (ended, no_join): settled.
  f[36] := pg_temp.room('lc-test-f36', 'lc-test-f36@example.invalid', 'fallback', 'host_in', 'intro');
  update public.cockpit_sales_rooms set appointment_id = 'lc-test-appt-f36' where id = f[36];
  update public.cockpit_sales_rooms set state = 'ended', result = 'no_join' where id = f[36];
  -- f[37]: "That was not the lead" after the room closed (count_undo_at after the join): settled.
  f[37] := pg_temp.room('lc-test-f37', 'lc-test-f37@example.invalid', 'fallback', 'lead_in', 'intro');
  update public.cockpit_sales_rooms set appointment_id = 'lc-test-appt-f37', lead_in_at = now() - interval '3 minutes' where id = f[37];
  update public.cockpit_sales_rooms set state = 'ended', result = 'joined' where id = f[37];
  update public.cockpit_sales_rooms set count_undo_at = now() - interval '1 minute', result = 'no_join' where id = f[37];
  -- f[38]: the lead joined and the call ended: never settled.
  f[38] := pg_temp.room('lc-test-f38', 'lc-test-f38@example.invalid', 'fallback', 'lead_in', 'intro');
  update public.cockpit_sales_rooms set appointment_id = 'lc-test-appt-f38' where id = f[38];
  update public.cockpit_sales_rooms set state = 'ended', result = 'joined' where id = f[38];
  -- Each made a minute after its intro's start (20261003d: the settle relates the room to the intro as booked now).
  update public.cockpit_sales_rooms set requested_at = now() - interval '24 minutes'
   where id = any (array[f[33], f[34], f[35], f[36], f[37], f[38]]);
  -- The settled rooms' links went (a link that never reached the lead is no
  -- evidence that the lead stayed away; 20261003d round 3).
  update public.cockpit_sales_rooms set link_sent_at = now() - interval '19 minutes'
   where id = any (array[f[25], f[36], f[37]]);

  -- The pending-events hold (contract-v2 section 10, item 4): a timer waits
  -- for the room's unhandled Zoom, worker or claim event, at most 300 s past
  -- due. Each event is held by a room.event run (lease), so it is not also
  -- replayed in this sweep.
  -- f[39]: lead_by 2 minutes ago, a Zoom join still unhandled: held.
  f[39] := pg_temp.room('lc-test-f39', 'lc-test-f39@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set lead_by = now() - interval '2 minutes' where id = f[39];
  -- f[40]: lead_by 6 minutes ago with the same: the hold is over, it closes.
  f[40] := pg_temp.room('lc-test-f40', 'lc-test-f40@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set lead_by = now() - interval '6 minutes' where id = f[40];
  -- f[41]: open, host_by 1 minute ago, the worker's event still unhandled: held.
  f[41] := pg_temp.room('lc-test-f41', 'lc-test-f41@example.invalid', 'handover', 'open', 'demo');
  update public.cockpit_sales_rooms set host_by = now() - interval '1 minute' where id = f[41];
  -- f[42]: lead_in, no end signal 1 minute past due, a Zoom event unhandled: held.
  f[42] := pg_temp.room('lc-test-f42', 'lc-test-f42@example.invalid', 'fallback', 'lead_in');
  update public.cockpit_sales_rooms set ends_at = now() - interval '31 minutes' where id = f[42];
  -- f[43]: an empty standby room 36 minutes in, a Zoom event unhandled: held.
  f[43] := pg_temp.room(null, 'lc-test-f43@example.invalid', 'standby', 'host_in', 'demo');
  update public.cockpit_sales_rooms set host_in_at = now() - interval '36 minutes' where id = f[43];
  -- f[44]: lead_by 2 minutes ago, only a door event unhandled (never replayed): no hold.
  f[44] := pg_temp.room('lc-test-f44', 'lc-test-f44@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set lead_by = now() - interval '2 minutes' where id = f[44];
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, lease_until) values
    (f[39], 'zoom.meeting.participant_joined', 'zoom', 'lc-test-hold-39', now() - interval '30 seconds', now() + interval '30 seconds'),
    (f[40], 'zoom.meeting.participant_joined', 'zoom', 'lc-test-hold-40', now() - interval '30 seconds', now() + interval '30 seconds'),
    (f[41], 'worker.ready', 'worker', 'lc-test-hold-41', now() - interval '30 seconds', now() + interval '30 seconds'),
    (f[42], 'zoom.meeting.participant_left', 'zoom', 'lc-test-hold-42', now() - interval '30 seconds', now() + interval '30 seconds'),
    (f[43], 'zoom.meeting.participant_left', 'zoom', 'lc-test-hold-43', now() - interval '30 seconds', now() + interval '30 seconds'),
    (f[44], 'door.open', 'door', 'lc-test-hold-44', now() - interval '30 seconds', null);

  -- The open grace capped (item 5, roomlogic.ts graceCap).
  -- f[45]: the link went 20 minutes ago and the lead keeps reopening it: closed.
  f[45] := pg_temp.room('lc-test-f45', 'lc-test-f45@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set link_sent_at = now() - interval '20 minutes', lead_by = now() - interval '1 minute',
                                        first_open_at = now() - interval '19 minutes', last_open_at = now() - interval '1 minute' where id = f[45];
  -- f[46]: a booked call past its end, opened 30 s ago: capped at ends_at, closed.
  f[46] := pg_temp.room('lc-test-f46', 'lc-test-f46@example.invalid', 'booked', 'host_in', 'intro', 'lc-test-appt-f46');
  update public.cockpit_sales_rooms set lead_by = now() - interval '1 minute', ends_at = now() - interval '1 minute',
                                        last_open_at = now() - interval '30 seconds' where id = f[46];
  -- f[47]: a knock 1 minute ago, 20 minutes after the link: capped too, closed as not let in.
  f[47] := pg_temp.room('lc-test-f47', 'lc-test-f47@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set link_sent_at = now() - interval '20 minutes', lead_by = now() - interval '2 minutes',
                                        lead_waiting_at = now() - interval '1 minute' where id = f[47];

  -- Handovers lv[1]..lv[13].
  insert into public.cockpit_sales_availability (email, state, until) values
    ('lc-test-la@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-lb@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-lc@example.invalid', 'away', null),
    ('lc-test-l5-other@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-l10-other@example.invalid', 'away', null),
    ('lc-test-l12@example.invalid', 'available', now() + interval '1 hour');
  lv[1] := pg_temp.live('lc-test-l1', array['lc-test-la@example.invalid', 'lc-test-lb@example.invalid', 'lc-test-lc@example.invalid'],
                        interval '-31 seconds');
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
  update public.cockpit_sales_rooms set state = 'host_in', count_undo_at = now() where id = rm;
  update public.cockpit_sales_rooms set lead_by = now() - interval '1 minute' where id = rm;
  -- lv[12]: offered to a closer who took another offer meanwhile; it ends.
  lv[12] := pg_temp.live('lc-test-l12a', array['lc-test-l12@example.invalid'], interval '-31 seconds');
  perform 1 from public.cockpit_sales_live_claim(pg_temp.live('lc-test-l12b', array['lc-test-l12@example.invalid']), 'lc-test-l12@example.invalid');
  -- lv[13]: taken while the lead had a booked room open (busy), 3 minutes ago.
  perform pg_temp.room('lc-test-l13', 'lc-test-l13-host@example.invalid', 'booked', 'open', 'intro', 'lc-test-appt-l13');
  lv[13] := pg_temp.live('lc-test-l13', array['lc-test-l13@example.invalid']);
  perform 1 from public.cockpit_sales_live_claim(lv[13], 'lc-test-l13@example.invalid');
  update public.cockpit_sales_live set claimed_at = now() - interval '3 minutes' where id = lv[13];

  -- Zoom reported each room's meeting that is settled below (its start, read
  -- by room.event): only then is Zoom's silence about the lead evidence (20261003d).
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at)
  select x, 'zoom.meeting.started', 'zoom', 'lc-test-started-' || x::text, now() - interval '20 minutes', now() - interval '20 minutes'
    from unnest(array[f[25], f[36], f[37]]) as x;

  -- Events ev[1]..ev[9], on no room (a room's unhandled event would hold its timers).
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, tries, lease_until) values
    (null, 'zoom.meeting.participant_joined', 'zoom', 'lc-test-e1', now() - interval '30 seconds', null, 0, null),
    (null, 'zoom.meeting.participant_joined', 'zoom', 'lc-test-e2', now() - interval '5 seconds', null, 0, null),
    (null, 'link_sent', 'sales-api', 'lc-test-e3', now() - interval '1 minute', null, 0, null),
    (null, 'zoom.meeting.started', 'zoom', 'lc-test-e4', now() - interval '1 minute', now() - interval '50 seconds', 0, null),
    (null, 'zoom.meeting.ended', 'zoom', 'lc-test-e5', now() - interval '5 minutes', null, 10, null),
    (null, 'worker.ready', 'worker', 'lc-test-e6', now() - interval '25 seconds', null, 0, null),
    (null, 'zoom.meeting.participant_left', 'zoom', 'lc-test-e7', now() - interval '1 minute', null, 0, now() + interval '30 seconds'),
    (null, 'live.claimed', 'claim', 'lc-test-e8', now() - interval '2 minutes', null, 0, now() - interval '1 minute'),
    (null, 'zoom.meeting.started', 'zoom', 'lc-test-e9', now() - interval '25 hours', null, 0, null);
  select array_agg(e.id order by e.dedupe_key) into ev from public.cockpit_sales_room_events as e where e.dedupe_key like 'lc-test-e_';

  select count(*) into lead_in_before from public.cockpit_sales_rooms where state = 'lead_in';

  s1 := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('F sweep ran with no rule errors', jsonb_array_length(s1 -> 'errors') = 0, (s1 -> 'errors')::text);

  select * into r from public.cockpit_sales_rooms where id = f[1];
  perform pg_temp.ck('F requested past fail (60 s): failed, request_timeout, error says what to do',
    r.state = 'failed' and r.end_reason = 'request_timeout' and r.result = 'failed'
    and r.error like '%Call the lead on the phone, or send your own Zoom or Meet link.' and r.ended_at = now());
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
  perform pg_temp.ck('F a fallback room for a booked intro the host never joined: expired, one settle event, posted as sweep.settle',
    (select state = 'expired' and result = 'no_join' from public.cockpit_sales_rooms where id = f[25])
    and (s1 ->> 'settle_due')::integer >= 3
    and exists (select 1 from public.cockpit_sales_room_events
                 where dedupe_key = 'sweep.settle:' || f[25]::text and source = 'settle' and tries = 0
                   and last_try_at = now() and handled_at is null),
    s1 ->> 'settle');
  perform pg_temp.ck('F settle (roomlogic.ts settleDue): the empty fallback room, End room before anyone came, and a join taken back after the close; nothing else',
    (s1 -> 'settle') @> to_jsonb(array[f[25]::text, f[36]::text, f[37]::text]) and jsonb_array_length(s1 -> 'settle') = 3,
    s1 ->> 'settle');
  perform pg_temp.ck('F never settled: a booked room, a knock never let in (admit_blocked), an intro already marked, a lead who joined',
    (select state = 'expired' from public.cockpit_sales_rooms where id = f[33])
    and (select state = 'expired' and result = 'admit_blocked' from public.cockpit_sales_rooms where id = f[34])
    and (select state = 'expired' from public.cockpit_sales_rooms where id = f[35])
    and not exists (select 1 from public.cockpit_sales_room_events
                     where dedupe_key in ('sweep.settle:' || f[33]::text, 'sweep.settle:' || f[34]::text,
                                          'sweep.settle:' || f[35]::text, 'sweep.settle:' || f[38]::text)));
  perform pg_temp.ck('F hold: lead_by 2 min ago with a Zoom event still unhandled: kept host_in (waits for the replay)',
    (select state = 'host_in' from public.cockpit_sales_rooms where id = f[39]));
  perform pg_temp.ck('F hold: lead_by 6 min ago with the same: closed, the hold lasts 300 s at most',
    (select state = 'expired' and end_reason = 'lead_no_show' from public.cockpit_sales_rooms where id = f[40]));
  perform pg_temp.ck('F hold: host_by 1 min ago with the worker''s event unhandled: kept open',
    (select state = 'open' from public.cockpit_sales_rooms where id = f[41]));
  perform pg_temp.ck('F hold: no end signal 1 min past due with a Zoom event unhandled: kept lead_in',
    (select state = 'lead_in' from public.cockpit_sales_rooms where id = f[42]));
  perform pg_temp.ck('F hold: an empty standby room at its time with a Zoom event unhandled: kept host_in',
    (select state = 'host_in' from public.cockpit_sales_rooms where id = f[43]));
  perform pg_temp.ck('F hold: a door event (never replayed) holds nothing: closed',
    (select state = 'expired' from public.cockpit_sales_rooms where id = f[44]));
  perform pg_temp.ck('F cap: a lead who keeps reopening the link 20 min after it went cannot hold the room (link + lead + grace)',
    (select state = 'expired' and end_reason = 'lead_no_show' from public.cockpit_sales_rooms where id = f[45]));
  perform pg_temp.ck('F cap: a booked room past its end is not held by a fresh open (ends_at)',
    (select state = 'expired' from public.cockpit_sales_rooms where id = f[46]));
  perform pg_temp.ck('F cap: a knock 20 min after the link is capped too: closed as not let in',
    (select state = 'expired' and end_reason = 'not_admitted' and result = 'admit_blocked' from public.cockpit_sales_rooms where id = f[47]));
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
  -- 20261003d: a pick is not a try (an outage never uses up a Zoom join);
  -- the try is counted when room.event leases the event.
  perform pg_temp.ck('F replay: a pick spaces the event (last_try_at) and counts no try; a held event (lease) is left alone',
    (select bool_and(tries = case when id = ev[5] then 10 else 0 end) from public.cockpit_sales_room_events where id = any (ev))
    and (select bool_and(last_try_at = now()) from public.cockpit_sales_room_events where id in (ev[1], ev[6], ev[8]))
    and (select handled_at is null and tries = 0 and last_try_at is null from public.cockpit_sales_room_events where id = ev[7]));
  perform pg_temp.ck('F an event room.event took 10 times and never handled is given up: handled, detail.gave_up',
    (select handled_at = now() and (detail ->> 'gave_up')::boolean and tries = 10 from public.cockpit_sales_room_events where id = ev[5])
    and (s1 ->> 'gave_up')::integer >= 2);
  perform pg_temp.ck('F an event older than a day is never replayed: given up as too old (left for a person, one alert a day)',
    (select handled_at = now() and (detail ->> 'gave_up')::boolean and (detail ->> 'too_old')::boolean and tries = 0
       from public.cockpit_sales_room_events where id = ev[9])
    and not ((s1 -> 'replay') ? ev[9]::text));
  perform pg_temp.ck('F tick: at most 100 rooms, all distinct, each a room with a lead that is not final, or final with a join or undo in the last hour, live ones first',
    jsonb_array_length(s1 -> 'tick') between 1 and 100
    and (s1 ->> 'tick_count')::integer = jsonb_array_length(s1 -> 'tick')
    and (select count(distinct v) = count(*) from jsonb_array_elements_text(s1 -> 'tick') as v)
    and not exists (
      select 1 from jsonb_array_elements_text(s1 -> 'tick') as v
        join public.cockpit_sales_rooms as x on x.id = v::uuid
       where x.contact_id is null
          or not (x.state in ('requested', 'creating', 'open', 'host_in', 'lead_in')
                  or x.lead_in_at > now() - interval '1 hour' or x.count_undo_at > now() - interval '1 hour'))
    and (select count(*) from jsonb_array_elements_text(s1 -> 'tick') as v) =
        (select count(*) from jsonb_array_elements_text(s1 -> 'tick') as v join public.cockpit_sales_rooms as x on x.id = v::uuid)
    and not exists (
      select 1 from jsonb_array_elements_text(s1 -> 'tick') with ordinality as ta(v, o)
        join public.cockpit_sales_rooms as xa on xa.id = ta.v::uuid
        join jsonb_array_elements_text(s1 -> 'tick') with ordinality as tb(v, o) on tb.o > ta.o
        join public.cockpit_sales_rooms as xb on xb.id = tb.v::uuid
       where xa.state in ('ended', 'expired', 'failed', 'cancelled') and xb.state in ('requested', 'creating', 'open', 'host_in', 'lead_in')),
    format('%s rooms', jsonb_array_length(s1 -> 'tick')));
  perform pg_temp.ck('F tick: an empty standby room and a closed room nobody joined are never re-checked',
    not ((s1 -> 'tick') ? f[16]::text) and not ((s1 -> 'tick') ? f[5]::text));

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
  perform pg_temp.ck('F a second run in the same minute moves nothing, replays nothing and settles nothing again (held rooms stay held)',
    (s2 ->> 'rooms_moved')::integer = 0 and (s2 ->> 'handovers_moved')::integer = 0
    and jsonb_array_length(s2 -> 'replay') = 0 and jsonb_array_length(s2 -> 'settle') = 0 and (s2 ->> 'standby_fresh')::integer = 0,
    s2::text);
  -- A bad setting cannot stop the sweep: waits fall back to their defaults.
  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{waits_s}', '{"fail": "soon", "lead": -5}') where key = 'rooms';
  s2 := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('F a broken waits_s setting falls back to the defaults (no error, nothing moved)',
    jsonb_array_length(s2 -> 'errors') = 0 and (s2 ->> 'rooms_moved')::integer = 0, s2::text);
  update public.cockpit_sales_settings
     set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(jsonb_set(jsonb_set(value, '{waits_s}', waits), '{enabled}', 'false'), '{providers,zoom}', 'false')
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
  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{enabled}', 'true') where key = 'rooms';
  delete from public.cockpit_sales_worker_status where worker = 'sales-desk' and job in ('rooms', 'slack', 'watch', 'waves', 'model');
  delete from public.cockpit_sales_worker_status where worker = 'sales-live';
  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at) values
    ('sales-desk', 'doctor', true, 'ok', now() - interval '2 hours'),
    ('sales-desk', 'followups', false, E'Claude sign-in\nlapsed', now() - interval '1 minute'),
    ('sales-desk', 'room-hosts', true, 'Hosts checked.', now() - interval '1 minute'),
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
  -- Written now; red only for open alerts nobody is told of (no webhook in
  -- the vault, m1 round 5), and then it says what to add.
  perform pg_temp.ck('G status row sales-api/watchdog written',
    (select at = now() and (ok or detail like '%Recorded only%reach nobody%sales_alerts_slack_webhook%')
       from public.cockpit_sales_worker_status where worker = 'sales-api' and job = 'watchdog'));
  perform pg_temp.ck('G switched-off and never-seen workers raise nothing (slack, watch, waves, model, threads), nor sales-live routes with no traffic yet',
    not exists (select 1 from public.cockpit_sales_alerts
                 where subject in ('sales-desk/slack', 'sales-desk/watch', 'sales-desk/waves', 'sales-desk/model', 'sales-api/threads')
                    or subject like 'sales-live/%'));

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
  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{enabled}', 'false') where key = 'rooms';
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

  -- An earlier day's alert that was posted, and one raised late on a Friday
  -- (or after 21:00) that was never posted.
  insert into public.cockpit_sales_alerts (dedupe_key, kind, message, raised_at, posted_at) values
    ('room_events_gave_up:2026-01-01', 'room_events_gave_up', 'Old.', now() - interval '1 day', now() - interval '1 day'),
    ('room_events_gave_up:2026-01-02', 'room_events_gave_up', 'Old, never posted.', now() - interval '10 hours', null);
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, tries, detail) values
    (null, 'zoom.meeting.started', 'zoom', 'lc-test-g3-gaveup', now() - interval '5 minutes', now(), 3, '{"gave_up": true}'),
    (null, 'zoom.meeting.started', 'zoom', 'lc-test-g3-gaveup-old', now() - interval '2 days', now() - interval '2 days', 3, '{"gave_up": true}');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G3 events given up today raise one alert for the day; an earlier day''s alert resolves once it was posted, and one never posted waits to be posted',
    exists (select 1 from public.cockpit_sales_alerts where dedupe_key = today and resolved_at is null and (detail ->> 'count')::integer = 1)
    and not exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'room_events_gave_up:2026-01-01')
    and exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'room_events_gave_up:2026-01-02' and resolved_at is null)
    and (w ->> 'raised')::integer >= 1, w::text);
  -- The day's alert was posted; then another event is given up.
  update public.cockpit_sales_alerts set posted_at = now(), post_tries = 1, post_status = 200 where dedupe_key = today;
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, tries, detail) values
    (null, 'zoom.meeting.ended', 'zoom', 'lc-test-g3-gaveup2', now() - interval '4 minutes', now(), 3, '{"gave_up": true}');
  w := public.cockpit_sales_watchdog();
  -- "Posted again": queued afresh (outside alert hours, or with no
  -- webhook), or, inside hours, already posted again by this same run (a new
  -- request, its first try, no answer yet). The check holds at any hour.
  perform pg_temp.ck('G3 another give-up the same day raises nothing new; the count follows and the alert is posted again with it',
    (w ->> 'raised')::integer = 0
    and exists (select 1 from public.cockpit_sales_alerts where dedupe_key = today and (detail ->> 'count')::integer = 2
                   and message like '2 room events were given up today%'
                   and ((posted_at is null and post_tries = 0)
                        or ((w ->> 'in_hours')::boolean and (w ->> 'webhook')::boolean
                            and post_tries = 1 and post_status is null and post_request_id is not null))), w::text);
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

-- G4. The watchdog watches the room host check and the five sales-live
--     routes (contract-v2 section 10, item 8), and a worker's own config
--     alerts go through the same words.
do $$
declare
  w jsonb; s text; rooms_v jsonb; live_v jsonb;
begin
  select value into rooms_v from public.cockpit_sales_settings where key = 'rooms';
  select value into live_v from public.cockpit_sales_settings where key = 'live';
  delete from public.cockpit_sales_alerts;
  delete from public.cockpit_sales_worker_status where (worker = 'sales-desk' and job = 'room-hosts') or worker = 'sales-live';
  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{enabled}', 'true') where key = 'rooms';
  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(jsonb_set(value, '{enabled}', 'true'), '{slack}', 'false') where key = 'live';
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G4 rooms on and the room host check never reported: missing alert (missing is never zero)',
    exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'missing:sales-desk/room-hosts' and resolved_at is null
             and message = 'The room host check has never reported. Zoom seats and Google sign-ins are not being checked, so a room may fail without warning.'),
    (select string_agg(dedupe_key, ', ') from public.cockpit_sales_alerts));
  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at)
    values ('sales-desk', 'room-hosts', true, 'Hosts checked.', now() - interval '19 minutes');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G4 the room host check 19 minutes ago: fine, the missing alert resolves',
    not exists (select 1 from public.cockpit_sales_alerts where subject = 'sales-desk/room-hosts' and resolved_at is null));
  update public.cockpit_sales_worker_status set at = now() - interval '21 minutes'
   where worker = 'sales-desk' and job = 'room-hosts';
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G4 the room host check 21 minutes ago: stale (every 10 minutes, alert at 20)',
    exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'stale:sales-desk/room-hosts' and resolved_at is null));

  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at) values
    ('sales-live', 'zoom', false, 'sales-api did not answer in 8 s; the event is stored and the sweep replays it.', now() - interval '2 minutes'),
    ('sales-live', 'open', true, 'Opens work.', now() - interval '3 days'),
    ('sales-live', 'slack', false, 'Slack signature refused.', now() - interval '1 minute'),
    ('sales-live', 'cron', false, 'The cron secret is not set.', now() - interval '1 minute');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G4 a sales-live route that says it is failing raises one failing alert with its words',
    exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'failing:sales-live/zoom' and resolved_at is null
             and message like 'The Zoom webhook reported a problem at %: sales-api did not answer in 8 s; the event is stored and the sweep replays it. Zoom joins and leaves may not reach the rooms, so reps press I''m in and The lead is in themselves.')
    and exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'failing:sales-live/cron' and resolved_at is null),
    (select string_agg(message, ' | ') from public.cockpit_sales_alerts where subject like 'sales-live/%'));
  perform pg_temp.ck('G4 sales-live rows are failing-only: a quiet route (3 days) and the routes with no row raise nothing',
    not exists (select 1 from public.cockpit_sales_alerts
                 where subject in ('sales-live/open', 'sales-live/go') or dedupe_key like 'stale:sales-live/%' or dedupe_key like 'missing:sales-live/%'));
  perform pg_temp.ck('G4 the Slack route is watched only with live.slack on',
    not exists (select 1 from public.cockpit_sales_alerts where subject = 'sales-live/slack'));
  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{slack}', 'true') where key = 'live';
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G4 with live.slack on, the failing Slack route raises its alert',
    exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'failing:sales-live/slack' and resolved_at is null));
  update public.cockpit_sales_worker_status set ok = true, detail = 'Zoom events work.' where worker = 'sales-live' and job = 'zoom';
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G4 the Zoom route works again: its alert resolves',
    not exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'failing:sales-live/zoom'));
  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = jsonb_set(value, '{enabled}', 'false') where key = 'rooms';
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G4 rooms switched off: the sales-live and room host alerts resolve',
    not exists (select 1 from public.cockpit_sales_alerts
                 where resolved_at is null and (subject in ('sales-live/cron', 'sales-live/zoom', 'sales-desk/room-hosts'))));

  -- The door's own setup alert (sales-live handler.ts configAlert), through the rpc.
  perform public.cockpit_sales_alert_set('config:sales-live/cron', true, 'config', 'sales-live/cron',
    E'The cron secret is missing in sales-live.\nSet it, then write to lc-test-x@example.invalid.', '{"worker": "sales-live", "job": "cron"}'::jsonb);
  perform pg_temp.ck('G4 a door config alert: source sales-live, kind config, one line, no address',
    exists (select 1 from public.cockpit_sales_alerts
             where dedupe_key = 'config:sales-live/cron' and resolved_at is null and source = 'sales-live' and kind = 'config'
               and message = 'The cron secret is missing in sales-live. Set it, then write to an address.'),
    (select source || ': ' || message from public.cockpit_sales_alerts where dedupe_key = 'config:sales-live/cron'));
  perform pg_temp.ck('G4 the same config alert again raises nothing new',
    public.cockpit_sales_alert_set('config:sales-live/cron', true, 'config', 'sales-live/cron', 'Again.', '{}'::jsonb) = 0
    and (select count(*) = 1 from public.cockpit_sales_alerts where subject = 'sales-live/cron' and kind = 'config'));
  perform public.cockpit_sales_alert_set('config:sales-live/cron', false, 'config', 'sales-live/cron', 'sales-live/cron works again.', null);
  perform pg_temp.ck('G4 the route working again resolves it and frees its key',
    not exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'config:sales-live/cron')
    and exists (select 1 from public.cockpit_sales_alerts where dedupe_key like 'config:sales-live/cron:resolved:%' and resolved_at = now()));
  perform pg_temp.ck('G4 a watchdog alert keeps source watchdog',
    (select bool_and(source = 'watchdog') from public.cockpit_sales_alerts where kind in ('missing', 'stale', 'failing')));

  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = rooms_v where key = 'rooms';
  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = live_v where key = 'live';
  delete from public.cockpit_sales_alerts;
exception when others then
  perform pg_temp.ck('G4 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- G5b. A room's "booked call is near" alert is over once the room has closed
--      (m1 round 2, booked-guard-alert-p2-words-never-resolved): resolved by
--      the next watchdog run, never three days on; an open room's stays.
do $$
declare
  closed uuid;
  live uuid;
  w jsonb;
begin
  delete from public.cockpit_sales_alerts;
  closed := pg_temp.room('lc-test-g5b-a', 'lc-test-g5b@example.invalid', 'fallback', 'expired');
  live := pg_temp.room('lc-test-g5b-b', 'lc-test-g5b@example.invalid', 'manual', 'open');
  insert into public.cockpit_sales_alerts (dedupe_key, kind, message, raised_at) values
    ('room:' || closed::text || ':booked_guard:2026-10-12T12:30:00.000Z', 'room_booked_guard', 'Near, closed.', now() - interval '5 minutes'),
    ('room:' || live::text || ':booked_guard:2026-10-12T12:30:00.000Z', 'room_booked_guard', 'Near, open.', now() - interval '5 minutes');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G5b a closed room''s booked-call alert is resolved at once; an open room''s stays',
    exists (select 1 from public.cockpit_sales_alerts
             where dedupe_key like 'room:' || closed::text || ':booked_guard:%:resolved:%' and resolved_at is not null)
    and not exists (select 1 from public.cockpit_sales_alerts
                     where dedupe_key = 'room:' || closed::text || ':booked_guard:2026-10-12T12:30:00.000Z')
    and exists (select 1 from public.cockpit_sales_alerts
                 where dedupe_key = 'room:' || live::text || ':booked_guard:2026-10-12T12:30:00.000Z' and resolved_at is null),
    w::text);
  delete from public.cockpit_sales_alerts;
exception when others then
  perform pg_temp.ck('G5b section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- G5. Per-room alerts nobody resolved (final review): resolved three days
--     after they were raised once posted, a week when never posted; a fresh
--     one, and any alert that is not a room's, stays open.
do $$
declare
  w jsonb;
begin
  delete from public.cockpit_sales_alerts;
  insert into public.cockpit_sales_alerts (dedupe_key, kind, message, raised_at, posted_at) values
    ('room:00000000-0000-4000-8000-0000000c5001:mark_intro', 'room_mark_intro', 'Old, posted.', now() - interval '4 days', now() - interval '4 days'),
    ('room_event_lost:00000000-0000-4000-8000-0000000c5002', 'room_event_lost', 'Old, never posted.', now() - interval '4 days', null),
    ('room_held:00000000-0000-4000-8000-0000000c5003', 'room_held', 'A week old, never posted.', now() - interval '8 days', null),
    ('room:00000000-0000-4000-8000-0000000c5004:count_unread', 'room_count_stuck', 'A day old, posted.', now() - interval '1 day', now() - interval '1 day'),
    ('failing:sales-desk/lc-test-g5', 'failing', 'Not a room''s.', now() - interval '10 days', now() - interval '10 days');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('G5 a posted room alert three days old is resolved, and never raised again under its key',
    exists (select 1 from public.cockpit_sales_alerts
             where dedupe_key like 'room:00000000-0000-4000-8000-0000000c5001:mark_intro:resolved:%' and resolved_at is not null)
    and not exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'room:00000000-0000-4000-8000-0000000c5001:mark_intro'),
    w::text);
  perform pg_temp.ck('G5 a room alert never posted waits a week; one a week old is resolved',
    exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'room_event_lost:00000000-0000-4000-8000-0000000c5002' and resolved_at is null)
    and exists (select 1 from public.cockpit_sales_alerts
                 where dedupe_key like 'room_held:00000000-0000-4000-8000-0000000c5003:resolved:%' and resolved_at is not null));
  perform pg_temp.ck('G5 a fresh room alert and an alert that is not a room''s stay open',
    exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'room:00000000-0000-4000-8000-0000000c5004:count_unread' and resolved_at is null)
    and exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'failing:sales-desk/lc-test-g5' and resolved_at is null));
  delete from public.cockpit_sales_alerts;
exception when others then
  perform pg_temp.ck('G5 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- H. The cron commands run as written, and the tick's posts carry the right
--    body and the cron secret (queued in this transaction, rolled back).
do $$
declare
  cmd text; before_n integer; s text; r jsonb; e uuid; rm uuid; made_secret boolean := false; max_id bigint;
  live1 uuid; fin1 uuid; fin2 uuid; sb uuid; g integer; bodies jsonb; made uuid[] := '{}'; rid uuid;
begin
  update public.cockpit_sales_room_events set handled_at = now() where handled_at is null;
  -- Nothing to re-check either: every earlier test room is closed and its
  -- joins and undos moved back past the tick's hour.
  update public.cockpit_sales_rooms set state = 'cancelled' where state in ('requested', 'creating', 'open', 'host_in', 'lead_in');
  update public.cockpit_sales_rooms set lead_in_at = lead_in_at - interval '2 hours' where lead_in_at > now() - interval '1 hour';
  update public.cockpit_sales_rooms set count_undo_at = count_undo_at - interval '2 hours' where count_undo_at > now() - interval '1 hour';
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
  -- The setter's fallback room for that booked intro; the host never came.
  rm := pg_temp.room('lc-test-h2', 'lc-test-h2@example.invalid', 'fallback', 'open', 'intro');
  update public.cockpit_sales_rooms set appointment_id = 'lc-test-appt-h2', host_by = now() - interval '1 minute',
                                        requested_at = now() - interval '24 minutes',
                                        link_sent_at = now() - interval '23 minutes' where id = rm;
  -- Zoom reported the meeting (read): its silence about the lead is evidence.
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at)
    values (rm, 'zoom.meeting.started', 'zoom', 'lc-test-h2-started', now() - interval '20 minutes', now() - interval '20 minutes');
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

  -- The tick's re-checks (contract-v2 S4): a room with a lead that is not
  -- final, and a final room with a join in the last hour, are posted as
  -- kind tick; a join two hours ago and an empty standby room are not.
  update public.cockpit_sales_room_events set handled_at = now() where handled_at is null;
  live1 := pg_temp.room('lc-test-h4', 'lc-test-h4@example.invalid', 'fallback', 'host_in');
  fin1 := pg_temp.room('lc-test-h5', 'lc-test-h5@example.invalid', 'fallback', 'lead_in');
  update public.cockpit_sales_rooms set lead_in_at = now() - interval '10 minutes' where id = fin1;
  update public.cockpit_sales_rooms set state = 'ended', result = 'joined' where id = fin1;
  fin2 := pg_temp.room('lc-test-h6', 'lc-test-h6@example.invalid', 'fallback', 'lead_in');
  update public.cockpit_sales_rooms set lead_in_at = now() - interval '2 hours' where id = fin2;
  update public.cockpit_sales_rooms set state = 'ended', result = 'joined' where id = fin2;
  sb := pg_temp.room(null, 'lc-test-h7@example.invalid', 'standby', 'host_in', 'demo');
  select coalesce(max(q.id), 0) into max_id from net.http_request_queue as q;
  r := public.cockpit_sales_rooms_tick();
  perform pg_temp.ck('H the tick posts one re-check: room.event kind tick with the live room first, then the recent join, to sales-live/cron with the cron secret',
    (r ->> 'posted')::integer = 1
    and exists (select 1 from net.http_request_queue as q
                 where q.id > max_id and q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron' and q.method = 'POST'
                   and convert_from(q.body, 'utf8')::jsonb = jsonb_build_object('action', 'room.event', 'kind', 'tick',
                         'payload', jsonb_build_object('room_ids', to_jsonb(array[live1::text, fin1::text])))
                   and q.headers ->> 'x-cron-secret' = (select ds.decrypted_secret from vault.decrypted_secrets as ds where ds.name = 'cockpit_sync_secret')),
    r::text);
  perform pg_temp.ck('H the sweep''s status row counts the rooms to re-check',
    (select ok and detail like '%, 2 rooms to re-check.' from public.cockpit_sales_worker_status where worker = 'sales-api' and job = 'sweep'),
    (select detail from public.cockpit_sales_worker_status where worker = 'sales-api' and job = 'sweep'));

  -- 120 rooms with a lead: two posts of 50 a run at most, every id once.
  for g in 1 .. 120 loop
    rid := pg_temp.room(format('lc-test-h8-%s', g), format('lc-test-h8-%s@example.invalid', g), 'fallback', 'host_in');
    made := made || rid;
  end loop;
  select coalesce(max(q.id), 0) into max_id from net.http_request_queue as q;
  r := public.cockpit_sales_rooms_tick();
  select coalesce(jsonb_agg(convert_from(q.body, 'utf8')::jsonb order by q.id), '[]'::jsonb) into bodies
    from net.http_request_queue as q
   where q.id > max_id and q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron';
  perform pg_temp.ck('H 121 rooms to re-check: two tick posts of 50 ids each, 100 different live rooms, nothing else posted',
    (r ->> 'posted')::integer = 2 and jsonb_array_length(bodies) = 2
    and (select bool_and(b ->> 'action' = 'room.event' and b ->> 'kind' = 'tick' and jsonb_array_length(b #> '{payload,room_ids}') = 50
                         and (select count(*) from jsonb_object_keys(b) as k) = 3
                         and (select count(*) from jsonb_object_keys(b -> 'payload') as k) = 1)
           from jsonb_array_elements(bodies) as b)
    and (select count(distinct v) = 100 and bool_and(v::uuid = any (made || live1))
           from jsonb_array_elements(bodies) as b, jsonb_array_elements_text(b #> '{payload,room_ids}') as v)
    and (select bool_and(v ~ '^[0-9a-f-]{36}$')
           from jsonb_array_elements(bodies) as b, jsonb_array_elements_text(b #> '{payload,room_ids}') as v),
    format('posted %s, %s bodies', r ->> 'posted', jsonb_array_length(bodies)));
  update public.cockpit_sales_rooms set state = 'cancelled' where id = any (made || live1 || sb);
  update public.cockpit_sales_rooms set lead_in_at = lead_in_at - interval '2 hours' where id = fin1;

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
    and (select not ok and detail = '1 event and 0 room checks wait for room.event, but the vault has no cockpit_sync_secret, so nothing was sent. Add it to the vault.'
           from public.cockpit_sales_worker_status where worker = 'sales-api' and job = 'sweep'),
    (select detail from public.cockpit_sales_worker_status where worker = 'sales-api' and job = 'sweep'));
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
  update public.cockpit_sales_settings set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = value - 'connector_off' - 'single_copy_ok_at' where key = 'whatsapp_guard';
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
     set updated_by = 'lc-test-manager@example.invalid', updated_at = clock_timestamp(), value = value || '{"connector_off": true, "single_copy_ok_at": "2026-10-03T10:00:00Z"}'::jsonb where key = 'whatsapp_guard';
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
  s := pg_temp.dry($q$insert into public.cockpit_sales_followup_waves (pool, state, made_by) values ('never_booked', 'cancelled', 'lc-test')$q$);
  perform pg_temp.ck('J a wave has the desk''s four states: cancelled is refused (a manager''s stop is done)',
    s = '23514:cockpit_sales_followup_waves_state_check', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_waves set enrolled_at = now() where id = %L and enrolled_at is null$q$, w1));
  perform pg_temp.ck('J the desk marks a wave enrolled (enrolled_at)', s = 'none', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_waves set done_reason = repeat('x', 301) where id = %L$q$, w1));
  perform pg_temp.ck('J done_reason is at most 300 characters', s = '23514:cockpit_sales_followup_waves_done_reason_check', s);

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
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_wave_members
                                set state = 'waiting', followup_id = null, drafted_at = null, fail_count = 1,
                                    last_error = 'HighLevel did not send it: 502.', next_try_at = now() + interval '20 hours',
                                    later_reason = 'The opener failed once; the next run may draft again.'
                              where wave_id = %L and contact_id = 'lc-test-j8'$q$, w1));
  perform pg_temp.ck('J a failed opener puts the member back as the desk writes it (fail_count, last_error, next_try_at, later_reason)', s = 'none', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_wave_members set fail_count = -1 where wave_id = %L and contact_id = 'lc-test-j8'$q$, w1));
  perform pg_temp.ck('J fail_count is never negative', s = '23514:cockpit_sales_followup_wave_members_fail_count_check', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_wave_members set later_reason = repeat('x', 301) where wave_id = %L and contact_id = 'lc-test-j8'$q$, w1));
  perform pg_temp.ck('J later_reason is at most 300 characters', s = '23514:cockpit_sales_followup_wave_members_later_reason_check', s);
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_wave_members set last_error = repeat('x', 301) where wave_id = %L and contact_id = 'lc-test-j8'$q$, w1));
  perform pg_temp.ck('J last_error is at most 300 characters', s = '23514:cockpit_sales_followup_wave_members_last_error_check', s);
  perform pg_temp.ck('J a member''s fail_count starts at 0',
    (select fail_count = 0 from public.cockpit_sales_followup_wave_members where wave_id = w1 and contact_id = 'lc-test-j1'));
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

  -- A manager stops the wave (followup.wave op=stop): done, with its reason.
  -- The members stay as they are for the desk (desk/waves.py wind_down).
  update public.cockpit_sales_followup_waves set state = 'done', done_reason = 'Stopped by a manager.' where id = w1;
  perform pg_temp.ck('J a done wave keeps its members as they are for the desk''s wind-down (waiting, held_out, drafted, sent, booked)',
    (select array_agg(contact_id || ':' || state order by contact_id) from public.cockpit_sales_followup_wave_members where wave_id = w1)
      = array['lc-test-j1:waiting', 'lc-test-j2:booked', 'lc-test-j3:sent', 'lc-test-j4:waiting', 'lc-test-j7:held_out', 'lc-test-j8:drafted']
    and (select ended_at = now() and done_reason = 'Stopped by a manager.' from public.cockpit_sales_followup_waves where id = w1),
    (select string_agg(contact_id || ':' || state, ', ' order by contact_id) from public.cockpit_sales_followup_wave_members where wave_id = w1));
  s := pg_temp.dry(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm) values (%L, 'lc-test-j1', 'wave')$q$, w2));
  perform pg_temp.ck('J until the desk lets a waiting member go, the contact stays in that wave only',
    s = '23505:cockpit_sales_followup_wave_members_one_running', s);
  -- The desk's wind-down and finish, as desk/waves.py writes them.
  update public.cockpit_sales_followup_wave_members set state = 'excluded', excluded_reason = 'Stopped by a manager before their opener went.'
   where wave_id = w1 and state = 'waiting';
  update public.cockpit_sales_followup_wave_members set state = 'excluded', excluded_reason = 'Stopped by a manager before their opener went; it was taken back.'
   where wave_id = w1 and state = 'drafted';
  update public.cockpit_sales_followup_wave_members set due_at = now() where wave_id = w1 and arm = 'holdout' and state = 'held_out' and due_at is null;
  perform pg_temp.ck('J after the wind-down the contact can join the next wave',
    pg_temp.dry(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm) values (%L, 'lc-test-j1', 'wave')$q$, w2)) = 'none');
  perform pg_temp.ck('J a held-back member whose turn came keeps held_out with due_at, so the comparison still measures it',
    (select state = 'held_out' and due_at = now() from public.cockpit_sales_followup_wave_members where wave_id = w1 and contact_id = 'lc-test-j7'));
  update public.cockpit_sales_followup_wave_members set state = 'closed' where wave_id = w1 and contact_id = 'lc-test-j7';
  update public.cockpit_sales_followup_wave_members set state = 'replied' where wave_id = w1 and contact_id = 'lc-test-j3';
  update public.cockpit_sales_followup_wave_members set state = 'closed' where wave_id = w1 and contact_id = 'lc-test-j3';
  perform pg_temp.ck('J the 14-day close: a held-back member and a wave member close (closed_at, outcome_at), a reply is kept',
    (select state = 'closed' and closed_at = now() and outcome_at = now() from public.cockpit_sales_followup_wave_members
      where wave_id = w1 and contact_id = 'lc-test-j7')
    and (select state = 'closed' and closed_at = now() and replied_at = now() from public.cockpit_sales_followup_wave_members
          where wave_id = w1 and contact_id = 'lc-test-j3'));
  update public.cockpit_sales_followup_waves set settled_at = now() where id = w1;
  perform pg_temp.ck('J a done wave takes settled_at (the desk stops reading it)',
    (select settled_at = now() and state = 'done' from public.cockpit_sales_followup_waves where id = w1));
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
  update public.cockpit_sales_followup_meta set held_by = 'sales-desk', send_after = null,
                                                hold_reason = 'The conversation moved on, so this opener was not sent.' where followup_id = f1;
  perform pg_temp.ck('J the desk sets a refused draft aside with its hold_reason',
    (select held_by = 'sales-desk' and hold_reason like 'The conversation moved on%' from public.cockpit_sales_followup_meta where followup_id = f1));
  s := pg_temp.dry(format($q$update public.cockpit_sales_followup_meta set hold_reason = repeat('x', 301) where followup_id = %L$q$, f1));
  perform pg_temp.ck('J hold_reason is at most 300 characters', s = '23514:cockpit_sales_followup_meta_hold_reason_check', s);
  update public.cockpit_sales_followup_meta set held_by = null, send_after = now() + interval '45 seconds',
                                                approved_by = 'lc-test-k@example.invalid' where followup_id = f1;
  perform pg_temp.ck('J unholding clears held_at and hold_reason; approving stamps approved_at; the draft is due at send_after',
    (select held_at is null and hold_reason is null and approved_at = now() and send_after = now() + interval '45 seconds'
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
  -- sales-api finished the Take (link sent): its live.claimed event is handled,
  -- so it no longer holds the room's timers.
  update public.cockpit_sales_room_events set handled_at = now(), lease_until = null
   where dedupe_key = 'live.claimed:' || l::text || ':0';
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
  perform pg_temp.ck('L the sweep neither replays nor gives up a held event (its one try is the lease)',
    not ((s -> 'replay') ? e::text)
    and (select handled_at is null and tries = 1 from public.cockpit_sales_room_events where id = e), s ->> 'replay');
  update public.cockpit_sales_room_events set lease_until = now() - interval '1 second' where id = e;
  perform pg_temp.ck('L a hold that ran out can be taken again', public.cockpit_sales_room_event_lease(p_dedupe_key => 'lc-test-lease') = e);
  update public.cockpit_sales_room_events set handled_at = now(), lease_until = null where id = e;
  perform pg_temp.ck('L a handled event is never taken', public.cockpit_sales_room_event_lease(e) is null
    and public.cockpit_sales_room_event_lease() is null);

  -- contract-v2 section 6: a failed or not-yet run releases (lease_until =
  -- null, handled_at stays null) and the sweep replays the event after 20 s.
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at)
    values (null, 'worker.ready', 'worker', 'lc-test-release-old', now() - interval '25 seconds'),
           (null, 'worker.ready', 'worker', 'lc-test-release-new', now() - interval '5 seconds');
  -- Each lease in its own statement: a check in the same statement would read
  -- the rows as they were when the statement began.
  t := concat_ws(' ', public.cockpit_sales_room_event_lease(p_dedupe_key => 'lc-test-release-old', p_seconds => 30),
                      public.cockpit_sales_room_event_lease(p_dedupe_key => 'lc-test-release-new', p_seconds => 100000));
  perform pg_temp.ck('L a lease is held for p_seconds: 30 for a Zoom or worker event, capped at 600',
    (select lease_until = now() + interval '30 seconds' from public.cockpit_sales_room_events where dedupe_key = 'lc-test-release-old')
    and (select lease_until = now() + interval '600 seconds' from public.cockpit_sales_room_events where dedupe_key = 'lc-test-release-new')
    and length(t) = 73,
    (select string_agg(dedupe_key || ' ' || coalesce((lease_until - now())::text, 'no lease'), ', ')
       from public.cockpit_sales_room_events where dedupe_key like 'lc-test-release-%'));
  update public.cockpit_sales_room_events set lease_until = null where dedupe_key in ('lc-test-release-old', 'lc-test-release-new');
  update public.cockpit_sales_room_events set handled_at = now()
   where handled_at is null and dedupe_key not in ('lc-test-release-old', 'lc-test-release-new', 'live.claimed:' || l5::text || ':0');
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('L a released event older than 20 s is replayed (one try counted); one 5 s old is not yet',
    (s -> 'replay') ? (select id::text from public.cockpit_sales_room_events where dedupe_key = 'lc-test-release-old')
    and not ((s -> 'replay') ? (select id::text from public.cockpit_sales_room_events where dedupe_key = 'lc-test-release-new'))
    and (select tries = 1 and handled_at is null from public.cockpit_sales_room_events where dedupe_key = 'lc-test-release-old'),
    s ->> 'replay');
  update public.cockpit_sales_room_events set handled_at = now() where dedupe_key in ('lc-test-release-old', 'lc-test-release-new');

  -- A Take whose sales-api run stopped: after its hold the claim event is
  -- replayed to room.event, so the link still goes.
  update public.cockpit_sales_room_events set handled_at = null, lease_until = now() - interval '1 second', at = now() - interval '70 seconds'
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

-- R. Fix round 3 (3 October 2026): a lead's words never reach Slack as
--    markup; an empty room is evidence about an intro only when it was the
--    intro's own room and its link reached the lead.
do $$
declare
  w text; src text; s jsonb; cf uuid; nl uuid;
begin
  w := public.cockpit_sales_alert_words('Room ABCDEF: <!channel> joined. <https://evil.example.invalid/x|Check> <@U0TEST> & co.', 300);
  perform pg_temp.ck('R alert words turn a lead''s < and > into look-alikes: no Slack markup is stored',
    w !~ '[<>]' and w like U&'%\2039!channel\203A%', w);
  select pg_get_functiondef('public.cockpit_sales_watchdog'::regproc) into src;
  perform pg_temp.ck('R the watchdog escapes & < > before it posts an alert to Slack',
    src like '%replace(replace(replace(rec.message, ''&'', ''&amp;''), ''<'', ''&lt;''), ''>'', ''&gt;'')%'
    and src !~ 'jsonb_build_object\(\s*''text''\s*,\s*rec\.message\s*\)');

  insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, status, assigned_user_id, start_at, origin) values
    ('lc-test-appt-r1', 'lc-test-r1', 'intro', 'confirmed', 'lc-test-ghl-r1', now() - interval '25 minutes', 'ghl'),
    ('lc-test-appt-r2', 'lc-test-r2', 'intro', 'confirmed', 'lc-test-ghl-r2', now() - interval '25 minutes', 'ghl');
  -- r1: the setter's confirmation call the evening before (20 hours before the
  -- intro): its room carried the intro's id and start, the link went, nobody came.
  cf := pg_temp.room('lc-test-r1', 'lc-test-r1@example.invalid', 'fallback', 'open', 'intro', 'lc-test-appt-r1');
  update public.cockpit_sales_rooms set appointment_start_at = now() - interval '25 minutes',
                                        requested_at = now() - interval '20 hours', link_sent_at = now() - interval '20 hours',
                                        host_by = now() - interval '1 minute', lead_by = now() - interval '1 minute' where id = cf;
  -- r2: the intro's own room, asked for at its start, whose link never went.
  nl := pg_temp.room('lc-test-r2', 'lc-test-r2@example.invalid', 'fallback', 'open', 'intro', 'lc-test-appt-r2');
  update public.cockpit_sales_rooms set appointment_start_at = now() - interval '25 minutes',
                                        requested_at = now() - interval '24 minutes', link_claimed_at = now() - interval '24 minutes',
                                        refusal = 'The link did not go on any channel.',
                                        host_by = now() - interval '1 minute', lead_by = now() - interval '1 minute' where id = nl;
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at)
  select x, 'zoom.meeting.started', 'zoom', 'lc-test-r-started-' || x::text, now() - interval '20 minutes', now() - interval '20 minutes'
    from unnest(array[cf, nl]) as x;
  s := public.cockpit_sales_rooms_sweep();
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('R a confirmation call''s empty room the day before never settles the intro (no sweep.settle), and nobody is asked to mark it from it',
    not exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || cf::text)
    and (select settled_mark = 'none' from public.cockpit_sales_rooms where id = cf)
    and not exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'room:' || cf::text || ':mark_intro'),
    (select state || ' ' || coalesce(settled_mark, '-') from public.cockpit_sales_rooms where id = cf));
  perform pg_temp.ck('R the intro''s own room whose link never reached the lead is no evidence: no settle, settled_mark none, a person marks the intro',
    not exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || nl::text)
    and (select settled_mark = 'none' from public.cockpit_sales_rooms where id = nl)
    and exists (select 1 from public.cockpit_sales_alerts where dedupe_key = 'room:' || nl::text || ':mark_intro'
                  and kind = 'room_mark_intro' and message like '%the link never reached the lead%'),
    (select state || ' ' || coalesce(settled_mark, '-') from public.cockpit_sales_rooms where id = nl));
exception when others then
  perform pg_temp.ck('R section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- R4. Fix round 4 (3 October 2026): the live count's claim is one per lead
--     (cockpit_sales_room_count_claim), and the sweep's settle reads the
--     door's own open and a template nobody saw.
do $$
declare
  a uuid; b uuid; c uuid; d uuid; got jsonb; rid uuid; st record; s jsonb;
  t0 timestamptz := now();
begin
  insert into public.cockpit_sales_rooms
    (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, result, lead_in_at, ended_at)
  select x.id, gen_random_uuid(), 'lc-test-cc', 'manual', 'intro', 'meet', 'lc-test-cc-' || x.n || '@example.invalid', 'x',
         'ended', 'https://meet.google.com/lct-cccc-cc' || x.n, 'joined', now() - make_interval(mins => 10 - x.n), now() - interval '1 minute'
    from (values (1, gen_random_uuid()), (2, gen_random_uuid()), (3, gen_random_uuid())) as x(n, id);
  select id into a from public.cockpit_sales_rooms where contact_id = 'lc-test-cc' and host_email = 'lc-test-cc-1@example.invalid';
  select id into b from public.cockpit_sales_rooms where contact_id = 'lc-test-cc' and host_email = 'lc-test-cc-2@example.invalid';
  select id into c from public.cockpit_sales_rooms where contact_id = 'lc-test-cc' and host_email = 'lc-test-cc-3@example.invalid';

  got := public.cockpit_sales_room_count_claim(a, t0, null, '{"count_claimed_at": null, "count_result": null}'::jsonb, true);
  perform pg_temp.ck('R4 the first count of a lead''s conversation is claimed', got ->> 'code' = 'claimed', got ->> 'code');
  got := public.cockpit_sales_room_count_claim(b, t0, null, '{"count_claimed_at": null, "count_result": null}'::jsonb, true);
  perform pg_temp.ck('R4 a second room of the lead whose sibling''s count is in flight claims nothing (in_flight)',
    got ->> 'code' = 'in_flight' and (select count_claimed_at is null from public.cockpit_sales_rooms where id = b), got ->> 'code');
  got := public.cockpit_sales_room_count_claim(b, t0, 'not_a_lead', '{"count_claimed_at": null, "count_result": null}'::jsonb, false);
  perform pg_temp.ck('R4 a count that books nothing (siblings not read) is claimed beside it',
    got ->> 'code' = 'claimed' and (select count_result = 'not_a_lead' from public.cockpit_sales_rooms where id = b), got ->> 'code');
  update public.cockpit_sales_rooms set count_result = 'booked', count_appointment_id = 'lc-test-cc-appt' where id = a;
  got := public.cockpit_sales_room_count_claim(c, t0, null, '{"count_claimed_at": null, "count_result": null}'::jsonb, true);
  perform pg_temp.ck('R4 a room of the lead beside a booking that stands is written already_counted, in the same step',
    got ->> 'code' = 'already_counted' and (select count_result = 'already_counted' from public.cockpit_sales_rooms where id = c), got ->> 'code');
  -- That was not the lead pressed between the count's read and its claim.
  update public.cockpit_sales_rooms set count_claimed_at = null, count_result = null, count_undo_at = now() where id = c;
  got := public.cockpit_sales_room_count_claim(c, t0, null,
    jsonb_build_object('count_claimed_at', null, 'count_result', null, 'count_undo_at', null,
                       'lead_in_at', (select lead_in_at from public.cockpit_sales_rooms where id = c)), true);
  perform pg_temp.ck('R4 a claim built before That was not the lead misses, and the press stays',
    got ->> 'code' = 'missed' and (select count_undo_at is not null and count_claimed_at is null from public.cockpit_sales_rooms where id = c),
    got ->> 'code');

  insert into public.cockpit_sales_rooms
    (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, result, lead_in_at, ended_at)
  values (gen_random_uuid(), gen_random_uuid(), 'lc-test-cd', 'manual', 'intro', 'meet', 'lc-test-cd-1@example.invalid', 'x', 'ended',
          'https://meet.google.com/lct-dddd-d1', 'joined', now() - interval '6 minutes', now() - interval '1 minute'),
         (gen_random_uuid(), gen_random_uuid(), 'lc-test-cd', 'manual', 'intro', 'meet', 'lc-test-cd-2@example.invalid', 'x', 'ended',
          'https://meet.google.com/lct-dddd-d2', 'joined', now() - interval '5 minutes', now() - interval '1 minute');
  select id into d from public.cockpit_sales_rooms where host_email = 'lc-test-cd-1@example.invalid';
  rid := public.cockpit_sales_room_count_claim(d);
  perform pg_temp.ck('R4 the one-argument claim answers the room when it holds the count', rid = d, coalesce(rid::text, 'null'));
  select id into d from public.cockpit_sales_rooms where host_email = 'lc-test-cd-2@example.invalid';
  rid := public.cockpit_sales_room_count_claim(d);
  perform pg_temp.ck('R4 and null for the lead''s other room while that count is in flight', rid is null, coalesce(rid::text, 'null'));
  -- Closing sweep (stress_concurrency_r4 count_doubled): the room whose own
  -- count is claimed and still in flight (count_result null) is not claimed
  -- a second time.
  select id into d from public.cockpit_sales_rooms where host_email = 'lc-test-cd-1@example.invalid';
  rid := public.cockpit_sales_room_count_claim(d);
  perform pg_temp.ck('R4 the one-argument claim never claims a room whose count is already claimed and in flight',
    rid is null and (select count_claimed_at is not null and count_result is null from public.cockpit_sales_rooms where id = d),
    coalesce(rid::text, 'null'));
  perform pg_temp.ck('R4 the count claim is security definer, empty search_path, service role only',
    (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc as p
      where p.oid in ('public.cockpit_sales_room_count_claim(uuid, timestamptz, text, jsonb, boolean)'::regprocedure,
                      'public.cockpit_sales_room_count_claim(uuid)'::regprocedure))
    and has_function_privilege('service_role', 'public.cockpit_sales_room_count_claim(uuid, timestamptz, text, jsonb, boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.cockpit_sales_room_count_claim(uuid, timestamptz, text, jsonb, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.cockpit_sales_room_count_claim(uuid)', 'execute'));
exception when others then
  perform pg_temp.ck('R4 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- R5. A mark replaces the call's current mark in one step (stress2, round 2).
do $$
declare
  a bigint; b bigint; ok boolean := false;
begin
  insert into public.cockpit_sales_dispositions (appointment_id, contact_id, status, marked_by)
  values ('lc-test-r5-appt', 'lc-test-r5', 'noshow', 'lc-test-r5-rep@example.invalid') returning id into a;
  select d.id into b from public.cockpit_sales_disposition_replace(a, jsonb_build_object(
    'appointment_id', 'lc-test-r5-appt', 'contact_id', 'lc-test-r5', 'status', 'showed', 'marked_by', 'lc-test-r5-cnt@example.invalid',
    'crm', 'pending')) as d;
  perform pg_temp.ck('R5 the replace supersedes the current mark and inserts the new one, one current',
    (select count(*) = 1 from public.cockpit_sales_dispositions where appointment_id = 'lc-test-r5-appt' and superseded_at is null)
    and (select status = 'showed' from public.cockpit_sales_dispositions where id = b)
    and (select superseded_at is not null from public.cockpit_sales_dispositions where id = a));
  begin
    perform 1 from public.cockpit_sales_disposition_replace(b, jsonb_build_object(
      'appointment_id', 'lc-test-r5-appt', 'contact_id', 'lc-test-r5', 'status', 'not-a-status', 'marked_by', 'x@example.invalid'));
  exception when others then
    ok := true;
  end;
  perform pg_temp.ck('R5 a replace whose insert fails leaves the previous mark current',
    ok and (select superseded_at is null and status = 'showed' from public.cockpit_sales_dispositions where id = b));
  -- Read as current before another mark landed (stress2 round 4): under the
  -- call's lock the replace finds the mark it was given is no longer current,
  -- answers no row and moves nothing (never a raw unique violation), so the
  -- caller reads the call again.
  select count(*) = 0 into ok from public.cockpit_sales_disposition_replace(a, jsonb_build_object(
    'appointment_id', 'lc-test-r5-appt', 'contact_id', 'lc-test-r5', 'status', 'noshow', 'marked_by', 'x@example.invalid'));
  perform pg_temp.ck('R5 a replace built on a mark that changed meanwhile answers no row and moves nothing',
    ok and (select count(*) = 1 from public.cockpit_sales_dispositions where appointment_id = 'lc-test-r5-appt' and superseded_at is null)
    and (select superseded_at is null and status = 'showed' from public.cockpit_sales_dispositions where id = b));
  perform pg_temp.ck('R5 the replace is security definer, empty search_path, service role only',
    (select p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_proc as p
      where p.oid = 'public.cockpit_sales_disposition_replace(bigint, jsonb)'::regprocedure)
    and has_function_privilege('service_role', 'public.cockpit_sales_disposition_replace(bigint, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.cockpit_sales_disposition_replace(bigint, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.cockpit_sales_disposition_replace(bigint, jsonb)', 'execute'));
exception when others then
  perform pg_temp.ck('R5 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- M. Milestone 1 fences (20261004a, 5 October 2026). Settling no-shows
--    (rooms.settle), counting a join (rooms.count_on_join) and live handover
--    (live.enabled) stay off in the database while their switches are off,
--    and a switch is turned on only by a write that names a sales manager,
--    with an audit row for every switch change, whoever made it.
do $$
declare
  mgr constant text := 'lc-test-manager@example.invalid';
  f jsonb; s jsonb; e text; n0 integer; n1 integer;
  stale uuid; host_room uuid; lead_room uuid; zoom_sb uuid; offer uuid; cc uuid; got jsonb;
begin
  select s2.value into f from public.cockpit_sales_settings as s2 where s2.key = 'followups';
  perform pg_temp.ck('M followups.agent ships off and followups.enabled (the drafts reps approve) keeps its value',
    f -> 'agent' = 'false'::jsonb and exists (select 1 from public.cockpit_audit_log
       where action = 'settings.update' and entity_id = 'followups' and metadata ->> 'by' = 'migration 20261004a'
         and (before -> 'enabled') is not distinct from (after -> 'enabled')),
    left(f::text, 200));

  -- Kill switches need no manager: the desk's name turns them off, with an audit row.
  n0 := (select count(*) from public.cockpit_audit_log where action = 'settings.switch');
  e := pg_temp.errm($q$update public.cockpit_sales_settings
       set value = value || '{"settle": false, "count_on_join": false}'::jsonb, updated_by = 'sales-desk', updated_at = clock_timestamp()
     where key = 'rooms'$q$);
  perform pg_temp.ck('M a switch is turned off by anyone who may write the settings (no manager needed)', e = 'none', e);
  e := pg_temp.errm($q$update public.cockpit_sales_settings
       set value = jsonb_set(value, '{enabled}', 'false'), updated_by = 'sales-desk', updated_at = clock_timestamp()
     where key = 'live'$q$);
  perform pg_temp.ck('M live handover is turned off the same way', e = 'none', e);
  perform pg_temp.ck('M each switch change left one settings.switch audit row naming what changed',
    (select count(*) from public.cockpit_audit_log where action = 'settings.switch') = n0 + 2
    and exists (select 1 from public.cockpit_audit_log where action = 'settings.switch' and entity_id = 'rooms'
                  and metadata -> 'changed' @> '["rooms.settle", "rooms.count_on_join"]'::jsonb
                  and metadata -> 'turned_on' = '[]'::jsonb and after -> 'rooms.settle' = 'false'::jsonb)
    and exists (select 1 from public.cockpit_audit_log where action = 'settings.switch' and entity_id = 'live'
                  and metadata -> 'changed' = '["live.enabled"]'::jsonb));

  -- Turning one on: refused unless the write names an active sales manager.
  e := pg_temp.err($q$update public.cockpit_sales_settings
       set value = value || '{"settle": true}'::jsonb, updated_by = 'sales-desk', updated_at = clock_timestamp() where key = 'rooms'$q$);
  perform pg_temp.ck('M rooms.settle is not turned on by the desk (42501)', e = '42501', e);
  e := pg_temp.err($q$update public.cockpit_sales_settings
       set value = value || '{"count_on_join": true}'::jsonb, updated_by = 'lc-test-x@example.invalid', updated_at = clock_timestamp() where key = 'rooms'$q$);
  perform pg_temp.ck('M rooms.count_on_join is not turned on by a name that is not a manager (42501)', e = '42501', e);
  e := pg_temp.err($q$update public.cockpit_sales_settings
       set value = jsonb_set(value, '{enabled}', 'true'), updated_by = 'sales-api', updated_at = clock_timestamp() where key = 'live'$q$);
  perform pg_temp.ck('M live.enabled is not turned on by sales-api''s own name (42501)', e = '42501', e);
  e := pg_temp.err($q$update public.cockpit_sales_settings
       set value = value || '{"agent": true}'::jsonb, updated_by = 'sales-desk', updated_at = clock_timestamp() where key = 'followups'$q$);
  perform pg_temp.ck('M followups.agent is not turned on by the desk (42501)', e = '42501', e);
  e := pg_temp.err($q$update public.cockpit_sales_settings
       set value = jsonb_set(value, '{test_contacts}', (value -> 'test_contacts') || '["lc-test-real-lead"]'::jsonb),
           updated_by = 'sales-desk', updated_at = clock_timestamp() where key = 'rooms'$q$);
  perform pg_temp.ck('M the test list is not widened by the desk (42501)', e = '42501', e);
  e := pg_temp.err($q$update public.cockpit_sales_settings
       set value = jsonb_set(value, '{test_only}', 'false'), updated_by = 'sales-desk', updated_at = clock_timestamp() where key = 'rooms'$q$);
  perform pg_temp.ck('M rooms are not opened to every lead (test_only false) by the desk (42501)', e = '42501', e);
  e := pg_temp.err(format($q$update public.cockpit_sales_settings
       set value = value || '{"enabled": true}'::jsonb, updated_by = %L, updated_at = clock_timestamp() where key = 'threads'$q$, 'sales-desk'));
  perform pg_temp.ck('M a write that names nobody turns nothing on: still refused when the key exists, none when it does not',
    e in ('42501', 'none'), e);
  e := pg_temp.err($q$insert into public.cockpit_sales_settings (key, value, updated_by)
       values ('threads', '{"enabled": true}'::jsonb, 'sales-desk')
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = clock_timestamp()$q$);
  perform pg_temp.ck('M threads.enabled is not turned on by an upsert from the desk (42501)', e = '42501', e);

  -- A manager's write turns it on, with the audit row naming the manager.
  n0 := (select count(*) from public.cockpit_audit_log where action = 'settings.switch' and actor_email = mgr);
  e := pg_temp.errm(format($q$update public.cockpit_sales_settings
       set value = value || '{"settle": true}'::jsonb, updated_by = %L, updated_at = clock_timestamp() where key = 'rooms'$q$, mgr));
  perform pg_temp.ck('M a sales manager turns rooms.settle on, and the audit row names them and what went on',
    e = 'none' and (select count(*) from public.cockpit_audit_log where action = 'settings.switch' and actor_email = mgr) = n0 + 1
    and exists (select 1 from public.cockpit_audit_log where action = 'settings.switch' and actor_email = mgr
                  and metadata -> 'turned_on' = '["rooms.settle"]'::jsonb and before -> 'rooms.settle' = 'false'::jsonb
                  and after -> 'rooms.settle' = 'true'::jsonb),
    e);
  -- A later write that leaves the manager's name on the row cannot borrow
  -- it: a write that names no actor (m1 round 6), stamped or not.
  perform set_config('mahara.actor', '', true);
  e := pg_temp.err($q$update public.cockpit_sales_settings
       set value = value || '{"count_on_join": true}'::jsonb where key = 'rooms'$q$);
  perform pg_temp.ck('M a write that names no actor cannot borrow the last manager''s name (42501)', e = '42501', e);
  e := pg_temp.err($q$update public.cockpit_sales_settings
       set value = value || '{"count_on_join": true}'::jsonb, updated_at = clock_timestamp() where key = 'rooms'$q$);
  perform pg_temp.ck('M a write that names no actor and refreshes updated_at cannot borrow it either (42501)', e = '42501', e);
  perform set_config('mahara.actor', 'lc-test-manager@example.invalid', true);
  e := pg_temp.errm(format($q$update public.cockpit_sales_settings
       set value = value || '{"settle": false}'::jsonb, updated_by = %L, updated_at = clock_timestamp() where key = 'rooms'$q$, 'sales-desk'));
  perform pg_temp.ck('M rooms.settle off again (by the desk)', e = 'none', e);
  perform pg_temp.ck('M settings that are not switches are not guarded (a non-switch key, a wait)',
    pg_temp.err($q$update public.cockpit_sales_settings set value = jsonb_set(value, '{waits_s,lead}', '600'),
                   updated_by = 'sales-desk', updated_at = clock_timestamp() where key = 'rooms'$q$) = 'none'
    and pg_temp.err($q$update public.cockpit_sales_settings set value = value, updated_by = 'sales-desk' where key = 'messaging'$q$) = 'none');

  -- rooms.settle off: an unhandled settle event from before is not posted.
  stale := pg_temp.room('lc-test-m-st', 'lc-test-m-st@example.invalid', 'fallback', 'open');
  update public.cockpit_sales_rooms set state = 'expired' where id = stale;
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, text)
  values (stale, 'sweep.settle', 'settle', 'sweep.settle:' || stale::text, now() - interval '2 minutes', 'Due to be settled.');

  -- live.enabled off: an open offer, an empty standby room, a Zoom standby
  -- room past its time with its host Available, and a lead's room.
  insert into public.cockpit_sales_availability (email, state, until) values
    ('lc-test-m-sb@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-m-zs@example.invalid', 'available', now() + interval '1 hour')
  on conflict (email) do update set state = excluded.state, until = excluded.until;
  host_room := pg_temp.room(null, 'lc-test-m-sb@example.invalid', 'standby', 'host_in', 'demo');
  zoom_sb := pg_temp.room(null, 'lc-test-m-zs@example.invalid', 'standby', 'open', 'demo');
  update public.cockpit_sales_rooms set requested_at = now() - interval '3 hours', opened_at = now() - interval '3 hours'
   where id = zoom_sb;
  lead_room := pg_temp.room('lc-test-m-lead', 'lc-test-m-lr@example.invalid', 'fallback', 'open');
  offer := pg_temp.live('lc-test-m-offer', array['lc-test-m-sb@example.invalid']);

  -- rooms.count_on_join off: a joined room's count is never claimed.
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, result, lead_in_at, ended_at)
  values (gen_random_uuid(), 'lc-test-m-cc', 'manual', 'intro', 'meet', 'lc-test-m-cc@example.invalid', 'x', 'ended',
          'https://meet.google.com/lct-mmmm-cc', 'joined', now() - interval '5 minutes', now() - interval '1 minute')
  returning id into cc;
  got := public.cockpit_sales_room_count_claim(cc, now(), null, '{"count_claimed_at": null, "count_result": null}'::jsonb, true);
  perform pg_temp.ck('M count_on_join off: the count''s claim answers missed and claims nothing',
    got ->> 'code' = 'missed' and got ->> 'off' = 'count_on_join'
    and (select count_claimed_at is null and count_result is null from public.cockpit_sales_rooms where id = cc),
    got::text);

  n1 := (select count(*) from public.cockpit_sales_rooms where purpose = 'standby' and host_email = 'lc-test-m-zs@example.invalid');
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('M settle off: the sweep posts no settle and says so',
    s -> 'settle' = '[]'::jsonb and s -> 'settle_off' = 'true'::jsonb
    and (select handled_at is null and last_try_at is null from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || stale::text),
    left(s::text, 300));
  perform pg_temp.ck('M live off: an open offer ends (live_off), and nobody is made Away for it',
    (select state = 'expired' and end_reason = 'live_off' from public.cockpit_sales_live where id = offer)
    and (select state = 'available' from public.cockpit_sales_availability where email = 'lc-test-m-sb@example.invalid'),
    (select state || ' ' || coalesce(end_reason, '-') from public.cockpit_sales_live where id = offer));
  perform pg_temp.ck('M live off: an empty standby room ends (live_off)',
    (select state = 'ended' and end_reason = 'live_off' from public.cockpit_sales_rooms where id = host_room),
    (select state || ' ' || coalesce(end_reason, '-') from public.cockpit_sales_rooms where id = host_room));
  perform pg_temp.ck('M live off: a Zoom standby room past its time is closed and no fresh one is made',
    (select state in ('ended', 'expired') from public.cockpit_sales_rooms where id = zoom_sb)
    and (select count(*) from public.cockpit_sales_rooms where purpose = 'standby' and host_email = 'lc-test-m-zs@example.invalid') = n1
    and coalesce((s ->> 'standby_fresh')::integer, 0) = 0,
    (select state || ' ' || coalesce(end_reason, '-') from public.cockpit_sales_rooms where id = zoom_sb));
  perform pg_temp.ck('M live off: a lead''s room is never touched by it',
    (select state = 'open' from public.cockpit_sales_rooms where id = lead_room));
  perform pg_temp.ck('M live off: the handover claim claims nothing, whoever asks',
    not exists (select 1 from public.cockpit_sales_live_claim(pg_temp.live('lc-test-m-claim', array['lc-test-m-sb@example.invalid']),
                                                              'lc-test-m-sb@example.invalid'))
    and not exists (select 1 from public.cockpit_sales_live where contact_id = 'lc-test-m-claim' and state <> 'offered'));

  -- The same settle event goes out once a manager turns settle on.
  update public.cockpit_sales_settings
     set value = value || '{"settle": true}'::jsonb, updated_by = mgr, updated_at = clock_timestamp() where key = 'rooms';
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('M settle on (a manager): the waiting settle event is posted',
    s -> 'settle' @> to_jsonb(array[stale::text]) and not (s ? 'settle_off'), left(s::text, 300));
  update public.cockpit_sales_settings
     set value = value || '{"settle": false}'::jsonb, updated_by = 'sales-desk', updated_at = clock_timestamp() where key = 'rooms';
exception when others then
  perform pg_temp.ck('M section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- N. Milestone 1 round 1 (20261004a, 5 October 2026): the press's own
--    decisions kept on the room: the booked intro it named, and whether it
--    cleared the night rule (intro or replacing, nothing else).
do $$
declare
  rid uuid;
  refused boolean := false;
begin
  rid := pg_temp.room('lc-test-n1', 'lc-test-n1@example.invalid', 'fallback');
  update public.cockpit_sales_rooms set asked_appointment_id = 'lc-test-n-appt', night_cleared = 'intro' where id = rid;
  perform pg_temp.ck('N a room keeps the intro the press named and its night decision',
    exists (select 1 from public.cockpit_sales_rooms where id = rid
             and asked_appointment_id = 'lc-test-n-appt' and night_cleared = 'intro'));
  begin
    update public.cockpit_sales_rooms set night_cleared = 'always' where id = rid;
  exception when check_violation then
    refused := true;
  end;
  perform pg_temp.ck('N a night decision other than intro or replacing is refused', refused);
exception when others then
  perform pg_temp.ck('N section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- R6. Video-link round 6: the settings guard reads who wrote a change from
--     the write's own transaction (mahara.actor, or the x-mahara-actor
--     header through the API), keeps a guarded row's key, compares a new
--     rooms row with the shipped one, guards fallback.scope, and audits a
--     deleted row; the sweep's row stays red while the door is refused.
do $$
declare
  e text;
  n0 integer;
  n1 integer;
  mgr constant text := 'lc-test-manager@example.invalid';
  rooms_v jsonb := (select value from public.cockpit_sales_settings where key = 'rooms');
  taken boolean := false;
  row_ok boolean;
  row_said text;
begin
  e := pg_temp.err($q$update public.cockpit_sales_settings set key = 'lc_test_rooms_aside' where key = 'rooms'$q$);
  perform pg_temp.ck('R6 the rooms row is never renamed aside (42501)', e = '42501', e);
  insert into public.cockpit_sales_settings (key, value, updated_by)
  values ('lc_test_rooms_copy', rooms_v || '{"enabled": true, "test_only": false}'::jsonb, 'lc-test');
  e := pg_temp.err($q$update public.cockpit_sales_settings set key = 'live' where key = 'lc_test_rooms_copy'$q$);
  perform pg_temp.ck('R6 no other row is renamed to a guarded key (42501)', e = '42501', e);
  delete from public.cockpit_sales_settings where key = 'lc_test_rooms_copy';

  -- A deleted guarded row is its switches turned off, by anyone, audited.
  perform set_config('mahara.actor', '', true);
  begin
    delete from public.cockpit_sales_settings where key = 'rooms';
    n1 := (select count(*) from public.cockpit_audit_log where action = 'settings.switch' and entity_id = 'rooms'
             and metadata ->> 'op' = 'delete' and metadata ->> 'by' = 'not named');
    raise exception using errcode = 'P0001', message = 'lc_undo';
  exception when sqlstate 'P0001' then
    null;
  end;
  perform pg_temp.ck('R6 deleting the rooms row needs no one and leaves one settings.switch row naming nobody', n1 = 1, format('%s rows', n1));
  -- A row whose switch is on unless false (followups.enabled) is not
  -- removed to turn it on by someone who names no manager.
  begin
    update public.cockpit_sales_settings set value = jsonb_set(value, '{enabled}', 'false') where key = 'followups';
    e := pg_temp.err($q$delete from public.cockpit_sales_settings where key = 'followups'$q$);
    raise exception using errcode = 'P0001', message = 'lc_undo';
  exception when sqlstate 'P0001' then
    null;
  end;
  perform pg_temp.ck('R6 deleting the followups row while followups.enabled is false (on once gone) needs a manager (42501)', e = '42501', e);

  -- A new rooms row is compared with the shipped one: a wider test list needs the manager.
  begin
    delete from public.cockpit_sales_settings where key = 'rooms';
    e := pg_temp.err(format($q$insert into public.cockpit_sales_settings (key, value, updated_by)
         values ('rooms', %L::jsonb, %L)$q$,
         jsonb_set(rooms_v, '{test_contacts}', (rooms_v -> 'test_contacts') || '["lc-test-real-lead"]'::jsonb)::text, mgr));
    perform pg_temp.ck('R6 a rooms row inserted again with a wider test list and no actor named is refused (42501)', e = '42501', e);
    perform set_config('mahara.actor', mgr, true);
    e := pg_temp.err(format($q$insert into public.cockpit_sales_settings (key, value, updated_by)
         values ('rooms', %L::jsonb, %L)$q$,
         jsonb_set(rooms_v, '{test_contacts}', (rooms_v -> 'test_contacts') || '["lc-test-real-lead"]'::jsonb)::text, mgr));
    taken := e = 'none' and exists (select 1 from public.cockpit_audit_log where action = 'settings.switch' and entity_id = 'rooms'
                                      and actor_email = mgr and metadata -> 'changed' ? 'rooms.test_contacts');
    raise exception using errcode = 'P0001', message = 'lc_undo';
  exception when sqlstate 'P0001' then
    null;
  end;
  perform pg_temp.ck('R6 the manager who names themself inserts it, and the audit row names the test list', taken);

  -- fallback.scope is guarded whatever its spelling.
  perform set_config('mahara.actor', '', true);
  e := pg_temp.err($q$update public.cockpit_sales_settings set value = jsonb_set(value, '{fallback,scope}', '"any "'),
       updated_by = 'sales-desk', updated_at = clock_timestamp() where key = 'rooms'$q$);
  perform pg_temp.ck('R6 fallback.scope "any " is not written by the desk (42501)', e = '42501', e);

  -- The API names the actor in its request header (sales-api's followup.settings).
  perform set_config('request.headers', jsonb_build_object('x-mahara-actor', mgr)::text, true);
  e := pg_temp.errm(format($q$update public.cockpit_sales_settings set value = value || '{"settle": true}'::jsonb,
       updated_by = %L, updated_at = clock_timestamp() where key = 'rooms'$q$, mgr));
  perform pg_temp.ck('R6 the manager named in the request header turns a switch on', e = 'none', e);
  e := pg_temp.errm($q$update public.cockpit_sales_settings set value = value || '{"settle": false}'::jsonb,
       updated_by = 'sales-desk', updated_at = clock_timestamp() where key = 'rooms'$q$);
  perform set_config('request.headers', '', true);
  perform set_config('mahara.actor', mgr, true);

  -- The sweep's row stays red, with the door's words, while the door alert is open.
  perform public.cockpit_sales_alert_set('sweep:door_refused', true, 'sweep_door', 'sales-api/sweep',
    '1 of the sweep''s calls to sales-live/cron were not taken (404), checked by lc.', '{}'::jsonb);
  perform public.cockpit_sales_rooms_sweep();
  select ok, detail into row_ok, row_said from public.cockpit_sales_worker_status where worker = 'sales-api' and job = 'sweep';
  perform pg_temp.ck('R6 the sweep''s row stays red with the door''s words while sweep:door_refused is open',
    row_ok = false and row_said like '1 of the sweep''s calls to sales-live/cron were not taken (404)%', row_said);
  perform public.cockpit_sales_alert_set('sweep:door_refused', false, 'sweep_door', 'sales-api/sweep', '', '{}'::jsonb);
  perform public.cockpit_sales_rooms_sweep();
  select ok, detail into row_ok, row_said from public.cockpit_sales_worker_status where worker = 'sales-api' and job = 'sweep';
  perform pg_temp.ck('R6 the door''s alert resolved, the next sweep''s row is green', row_ok, row_said);
exception when others then
  perform set_config('mahara.actor', 'lc-test-manager@example.invalid', true);
  perform set_config('request.headers', '', true);
  perform pg_temp.ck('R6 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- R6b. Video-link round 6, the sweep's R4: a given-up worker event says
--      nothing about joins (a Meet room closes as the lead's no-show), and a
--      link left to the rep by a final refusal whose lead_by write was lost
--      waits the lead's ten minutes from the refusal.
do $$
declare
  m uuid := gen_random_uuid();
  f uuid := gen_random_uuid();
  mr record;
  fr record;
begin
  insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                          join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                          link_sent_at, link_channels, refusal, host_by, lead_by, ends_at, trigger, version)
  values
    (m, gen_random_uuid(), 'lc-test-r6b-m', 'manual', 'intro', 'meet', 'lc-test-r6b-m@example.invalid', 'lc-test-r6b-m@example.invalid',
     'open', 'https://meet.google.com/lct-rsix-mmm', 'lct-rsix-mmm', now() - interval '14 minutes 6 seconds',
     now() - interval '14 minutes 5 seconds', now() - interval '14 minutes', now() - interval '11 minutes',
     now() - interval '11 minutes', '{email}', null, now() + interval '4 minutes', now() - interval '1 minute',
     now() + interval '16 minutes', 'manual', 7),
    (f, gen_random_uuid(), 'lc-test-r6b-f', 'manual', 'intro', 'zoom', 'lc-test-r6b-f@example.invalid', 'lc-test-r6b-f@example.invalid',
     'open', 'https://zoom.example.invalid/j/86660000001', '86660000001', now() - interval '10 minutes 46 seconds',
     now() - interval '10 minutes 45 seconds', now() - interval '10 minutes 40 seconds', now() - interval '10 minutes 40 seconds',
     null, '{}', 'HighLevel did not take the link in 10 minutes (HighLevel said 429: Too Many Requests).',
     now() + interval '4 minutes 20 seconds', null, now() + interval '19 minutes 20 seconds', 'manual', 6);
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, text, detail, handled_at, tries, last_try_at, at)
  values (m, 'worker.ready', 'worker', 'worker.ready:' || m::text, 'Room made on Meet in 3 s.',
          jsonb_build_object('worker_run', 'lc-test-run', 'gave_up', true, 'tries', 10),
          now() - interval '10 minutes', 10, now() - interval '10 minutes 30 seconds', now() - interval '14 minutes');
  perform public.cockpit_sales_rooms_sweep();
  select state, end_reason, result into mr from public.cockpit_sales_rooms where id = m;
  select state, end_reason, result into fr from public.cockpit_sales_rooms where id = f;
  perform pg_temp.ck('R6b a Meet room whose only given-up event is the worker''s closes as the lead''s no-show, never events_lost',
    mr.state = 'expired' and mr.end_reason = 'lead_no_show' and mr.result = 'no_join',
    format('%s %s %s', mr.state, mr.end_reason, mr.result));
  perform pg_temp.ck('R6b a link left to the rep 40 s ago with its lead_by lost still waits for the rep''s delivery',
    fr.state = 'open', format('%s %s %s', fr.state, fr.end_reason, fr.result));
  update public.cockpit_sales_rooms set state = 'cancelled' where id in (m, f) and state not in ('expired', 'cancelled', 'ended', 'failed');
exception when others then
  perform pg_temp.ck('R6b section crashed', false, sqlstate || ': ' || sqlerrm);
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
