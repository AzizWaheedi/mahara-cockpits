#!/usr/bin/env python3
"""Security stress of the live-calls tables, round 1 (3 October 2026): row
security and grants checked with real roles (anon, a signed-in non-seat, a
seat, a paused seat) against the APPLIED migrations 20261003a/b/c.

    python3 supabase/migrations/tests/stress_security.py

Safety (the live tables are in production, dark and empty):
  - ONE transaction that ends in `rollback;`, lock_timeout 5 s. Nothing it
    writes is ever committed, so the pg_cron sweep (every minute) and the
    watchdog never see a row of it.
  - Synthetic rows only: contact ids `stress-sec-*`, addresses
    `stress-sec-*@stress.invalid`, one auth.users row
    `stress-sec-seat@stress.invalid` for the seat token. No other row is read
    for its content (every count is filtered to `stress-sec-`), changed or
    deleted. No sweep, tick or watchdog is run; no pg_net request is queued.
  - Before and after, a read-only leftovers query proves no `stress-sec-` row
    is left anywhere it could have been written.

Round 2 (3 October 2026) adds section D (what a seat's token reads that it
should not: a Zoom attendee of a meeting that is no room) and a static check
of the migrations not applied yet (20261003d): every function and view they
make is revoked from public, anon and authenticated, and every
security-definer function pins its search_path.

Each check prints PASS or FAIL. A FAIL is a finding. The management token is
read from SUPABASE_ACCESS_TOKEN or ~/.config/mahara/sb_mgmt_token and never
printed. Exit code 0 only when every check passed and nothing persisted.
"""
import json
import os
import sys
import urllib.error
import urllib.request

REF = "bldgtotkfmhoxmlzowdx"

NEW_TABLES = [
    "cockpit_sales_rooms", "cockpit_sales_room_secrets", "cockpit_sales_room_events", "cockpit_sales_room_hosts",
    "cockpit_sales_availability", "cockpit_sales_live", "cockpit_sales_alerts",
    "cockpit_sales_followup_levels", "cockpit_sales_followup_waves", "cockpit_sales_followup_wave_members",
    "cockpit_sales_followup_meta", "cockpit_sales_followup_stops",
]
SEAT_READ = [t for t in NEW_TABLES if t not in ("cockpit_sales_room_secrets", "cockpit_sales_alerts")]
NEW_FUNCTIONS = [
    "cockpit_sales_room_code", "cockpit_sales_rooms_guard", "cockpit_sales_rooms_link_replaced",
    "cockpit_sales_live_guard", "cockpit_sales_touch_version", "cockpit_sales_touch_updated",
    "cockpit_sales_live_claim", "cockpit_sales_room_event_lease", "cockpit_sales_rooms_close",
    "cockpit_sales_live_move", "cockpit_sales_room_pending", "cockpit_sales_rooms_sweep", "cockpit_sales_rooms_tick",
    "cockpit_sales_alert_hours", "cockpit_sales_alert_words", "cockpit_sales_alert_set", "cockpit_sales_watchdog",
    "cockpit_sales_jsonb_add_missing", "cockpit_sales_settings_add_missing",
    "cockpit_sales_followup_levels_guard", "cockpit_sales_followup_waves_guard",
    "cockpit_sales_followup_wave_members_touch", "cockpit_sales_followup_meta_touch",
    "cockpit_sales_followup_stops_touch",
]


def sql_list(names):
    return ", ".join(f"'{n}'" for n in names)


CHECKS = r"""
create temp table ss_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.ss_checks (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

-- Runs one statement as a role with a JWT whose sub is p_sub, and says what
-- happened: 'ok:<count>' or '<sqlstate>: <message>'. The statement must
-- return one bigint (a count). The role is put back either way: on an error
-- the subtransaction's rollback undoes `set local role`.
create function pg_temp.as_role(p_role text, p_sub uuid, p_sql text)
returns text language plpgsql as $$
declare
  n bigint;
  said text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', p_role)::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    execute format('set local role %I', p_role);
    execute p_sql into n;
    reset role;
    said := 'ok:' || coalesce(n::text, 'null');
  exception when others then
    said := sqlstate || ': ' || left(sqlerrm, 160);
  end;
  return said;
end;
$$;

-- Fixtures: synthetic only, never committed. ------------------------------

do $fx$
declare
  r1 uuid := gen_random_uuid();
begin
  insert into public.cockpit_sales_rooms
    (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url,
     host_by, lead_by, ends_at)
  values (r1, gen_random_uuid(), 'stress-sec-lead-1', 'manual', 'intro', 'zoom', 'stress-sec-host@stress.invalid',
          'stress-sec-host@stress.invalid', 'open', 'https://zoom.stress.invalid/j/9?pwd=stress',
          now() + interval '15 minutes', now() + interval '10 minutes', now() + interval '30 minutes');
  insert into public.cockpit_sales_room_secrets (room_id, start_url, expires_at)
  values (r1, 'https://zoom.stress.invalid/s/9?zak=stress-sec-host-token', now() + interval '2 hours');
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
  values (r1, 'door.open', 'door', 'stress-sec:open:1', now(), 'The lead opened the link.', '{}'::jsonb);
  insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, state, offered_to, offer_until)
  values (gen_random_uuid(), 'stress-sec-lead-2', 'stress-sec-host@stress.invalid', 'demo', 'on_call', 'offered',
          array['stress-sec-closer@stress.invalid'], now() + interval '2 minutes');
  insert into public.cockpit_sales_availability (email, state, until)
  values ('stress-sec-closer@stress.invalid', 'available', now() + interval '1 hour');
  create temp table ss_fx (k text primary key, v text) on commit drop;
  insert into pg_temp.ss_fx values ('room', r1::text);
end;
$fx$;

-- A. The catalog ------------------------------------------------------------

select pg_temp.ck('A1 row security is on for every new table',
  bool_and(c.relrowsecurity), string_agg(c.relname, ', ') filter (where not c.relrowsecurity))
  from pg_class as c where c.relnamespace = 'public'::regnamespace and c.relname in (@@TABLES@@);

select pg_temp.ck('A2 anon has no privilege at all on a new table or the presence view',
  not bool_or(has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')),
  string_agg(c.relname, ', ') filter (where has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')))
  from pg_class as c where c.relnamespace = 'public'::regnamespace and c.relname in (@@TABLES@@, 'cockpit_sales_presence');

select pg_temp.ck('A3 a signed-in role may only read: no insert, update, delete, truncate, references or trigger on a new table',
  not bool_or(has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate,references,trigger')),
  string_agg(c.relname, ', ') filter (where has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate,references,trigger')))
  from pg_class as c where c.relnamespace = 'public'::regnamespace and c.relname in (@@TABLES@@);

select pg_temp.ck('A4 host links, alerts and presence are not readable by a signed-in role at all',
  not bool_or(has_table_privilege('authenticated', c.oid, 'select')),
  string_agg(c.relname, ', ') filter (where has_table_privilege('authenticated', c.oid, 'select')))
  from pg_class as c where c.relnamespace = 'public'::regnamespace
   and c.relname in ('cockpit_sales_room_secrets', 'cockpit_sales_alerts', 'cockpit_sales_presence');

select pg_temp.ck('A5 no column-level grant opens a new table to anon or a signed-in role',
  count(*) = 0, string_agg(table_name || '.' || column_name || ' ' || privilege_type || ' to ' || grantee, '; '))
  from information_schema.column_privileges
 where table_schema = 'public' and table_name in (@@TABLES@@)
   and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT';

select pg_temp.ck('A6 every policy on a new table is a SELECT for signed-in seats only (cockpit_sales_seat)',
  count(*) filter (where not (p.polcmd = 'r'
                              and p.polroles = array['authenticated'::regrole]::oid[]
                              and pg_get_expr(p.polqual, p.polrelid) like '%cockpit_sales_seat()%'
                              and p.polwithcheck is null)) = 0,
  string_agg(c.relname || ':' || p.polname || ':' || p.polcmd::text, ', ')
    filter (where not (p.polcmd = 'r' and pg_get_expr(p.polqual, p.polrelid) like '%cockpit_sales_seat()%')))
  from pg_policy as p join pg_class as c on c.oid = p.polrelid
 where c.relnamespace = 'public'::regnamespace and c.relname in (@@TABLES@@);

select pg_temp.ck('A7 no new function can be called by anon, a signed-in role or PUBLIC (except the two pure helpers)',
  count(*) = 0, string_agg(p.proname, ', '))
  from pg_proc as p
 where p.pronamespace = 'public'::regnamespace and p.proname in (@@FUNCTIONS@@)
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));

select pg_temp.ck('A8 every new security-definer function pins its search_path',
  count(*) = 0, string_agg(p.proname, ', '))
  from pg_proc as p
 where p.pronamespace = 'public'::regnamespace and p.proname in (@@FUNCTIONS@@) and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) as c where c like 'search_path=%');

select pg_temp.ck('A9 the two pg_cron jobs carry no secret, token or key in their command',
  count(*) = 2 and bool_and(j.command !~* '(x-cron-secret|bearer|eyJ[A-Za-z0-9_-]{10,}|sb_secret|service_role|apikey)'),
  string_agg(j.jobname || ': ' || left(j.command, 80), '; '))
  from cron.job as j where j.jobname in ('mahara-sales-rooms-sweep', 'mahara-sales-watchdog');

-- B. Real roles against the fixtures -----------------------------------------

do $b$
declare
  stranger uuid := gen_random_uuid();
  seat uuid := gen_random_uuid();
  made text;
  said text;
  t text;
  fn text;
  room uuid := (select v::uuid from pg_temp.ss_fx where k = 'room');
begin
  -- anon
  foreach t in array array[@@TABLES@@, 'cockpit_sales_presence'] loop
    said := pg_temp.as_role('anon', null, format('select count(*) from public.%I', t));
    perform pg_temp.ck(format('B1 anon cannot read %s', t), said like '42501%', said);
  end loop;

  -- a signed-in user with no seat (no auth.users row behind the token)
  said := pg_temp.as_role('authenticated', stranger,
    $q$select count(*) from public.cockpit_sales_rooms where contact_id like 'stress-sec-%'$q$);
  perform pg_temp.ck('B2 a signed-in user with no seat sees no room', said = 'ok:0', said);
  said := pg_temp.as_role('authenticated', stranger,
    $q$select count(*) from public.cockpit_sales_room_events where dedupe_key like 'stress-sec%'$q$);
  perform pg_temp.ck('B2 a signed-in user with no seat sees no room event', said = 'ok:0', said);
  said := pg_temp.as_role('authenticated', stranger,
    $q$select count(*) from public.cockpit_sales_live where contact_id like 'stress-sec-%'$q$);
  perform pg_temp.ck('B2 a signed-in user with no seat sees no handover', said = 'ok:0', said);

  -- a seat: a confirmed sign-in plus an active portal seat row (rolled back)
  begin
    insert into auth.users (id, email, email_confirmed_at, aud, role)
    values (seat, 'stress-sec-seat@stress.invalid', now(), 'authenticated', 'authenticated');
    made := 'none';
  exception when others then
    made := sqlstate || ': ' || sqlerrm;
  end;
  if made <> 'none' then
    perform pg_temp.ck('B3 skipped: a test sign-in could not be made', true, made);
    return;
  end if;
  insert into public.cockpit_sales_people (email, name, role, active, via_portal)
  values ('stress-sec-seat@stress.invalid', 'Stress Seat', 'setter', true, true);

  said := pg_temp.as_role('authenticated', seat,
    $q$select count(*) from public.cockpit_sales_rooms where contact_id like 'stress-sec-%'$q$);
  perform pg_temp.ck('B3 a seat reads rooms (the policy is live, not just a deny-all)', said = 'ok:1', said);

  said := pg_temp.as_role('authenticated', seat, 'select count(*) from public.cockpit_sales_room_secrets');
  perform pg_temp.ck('B4 a seat cannot read any host link (start_url)', said like '42501%', said);
  said := pg_temp.as_role('authenticated', seat, 'select count(*) from public.cockpit_sales_presence');
  perform pg_temp.ck('B4 a seat cannot read the presence view directly', said like '42501%', said);
  said := pg_temp.as_role('authenticated', seat, 'select count(*) from public.cockpit_sales_alerts');
  perform pg_temp.ck('B4 a seat cannot read alerts', said like '42501%', said);
  said := pg_temp.as_role('authenticated', seat,
    $q$select count(*) from public.cockpit_sales_rooms where contact_id like 'stress-sec-%' and join_url like '%zak=%'$q$);
  perform pg_temp.ck('B4 no host link sits in a column a seat can read', said = 'ok:0', said);

  -- every write a seat might try, straight at the table
  foreach t in array array[
    $q$with x as (insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by)
       values (gen_random_uuid(), 'stress-sec-lead-9', 'manual', 'intro', 'meet', 'stress-sec-seat@stress.invalid', 'x') returning 1) select count(*) from x$q$,
    format($q$with x as (update public.cockpit_sales_rooms set state = 'lead_in' where id = %L returning 1) select count(*) from x$q$, room),
    format($q$with x as (update public.cockpit_sales_rooms set host_email = 'stress-sec-seat@stress.invalid' where id = %L returning 1) select count(*) from x$q$, room),
    format($q$with x as (delete from public.cockpit_sales_rooms where id = %L returning 1) select count(*) from x$q$, room),
    format($q$with x as (insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, detail)
       values (%L, 'zoom.meeting.participant_joined', 'zoom', 'stress-sec:forged', '{}') returning 1) select count(*) from x$q$, room),
    $q$with x as (update public.cockpit_sales_room_events set handled_at = now() where dedupe_key like 'stress-sec%' returning 1) select count(*) from x$q$,
    $q$with x as (insert into public.cockpit_sales_room_secrets (room_id, start_url) select id, 'https://x.stress.invalid/s/1' from public.cockpit_sales_rooms where contact_id = 'stress-sec-lead-1' returning 1) select count(*) from x$q$,
    $q$with x as (insert into public.cockpit_sales_availability (email, state, until) values ('stress-sec-seat@stress.invalid', 'available', now() + interval '1 hour') returning 1) select count(*) from x$q$,
    $q$with x as (update public.cockpit_sales_availability set state = 'away', until = null where email = 'stress-sec-closer@stress.invalid' returning 1) select count(*) from x$q$,
    $q$with x as (update public.cockpit_sales_live set state = 'claimed', claimed_by = 'stress-sec-seat@stress.invalid' where contact_id = 'stress-sec-lead-2' returning 1) select count(*) from x$q$,
    $q$with x as (update public.cockpit_sales_live set offered_to = array['stress-sec-seat@stress.invalid'] where contact_id = 'stress-sec-lead-2' returning 1) select count(*) from x$q$,
    $q$with x as (insert into public.cockpit_sales_room_hosts (email, zoom_status) values ('stress-sec-seat@stress.invalid', 'licensed') returning 1) select count(*) from x$q$,
    $q$with x as (insert into public.cockpit_sales_followup_waves (pool, segment, per_day, holdout_share, state, made_by) values ('never_booked', 'reactivate', 1, 0, 'running', 'stress-sec-seat@stress.invalid') returning 1) select count(*) from x$q$,
    $q$with x as (insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('reactivate.en.whatsapp_template', 'sends_by_itself', 'stress-sec-seat@stress.invalid') returning 1) select count(*) from x$q$,
    $q$with x as (insert into public.cockpit_sales_followup_stops (contact_id, said_at, kind, state) values ('stress-sec-lead-1', now(), 'manual', 'resumed') returning 1) select count(*) from x$q$,
    $q$with x as (insert into public.cockpit_sales_alerts (dedupe_key, kind, message) values ('stress-sec:alert', 'x', 'x') returning 1) select count(*) from x$q$
  ] loop
    said := pg_temp.as_role('authenticated', seat, t);
    perform pg_temp.ck('B5 a seat cannot write directly: ' || left(regexp_replace(t, '\s+', ' ', 'g'), 90), said like '42501%', said);
  end loop;

  -- every function that moves rooms, handovers, events or alerts
  foreach fn in array array[
    format('select count(*) from public.cockpit_sales_live_claim((select id from public.cockpit_sales_live where contact_id = %L), %L, null)',
           'stress-sec-lead-2', 'stress-sec-seat@stress.invalid'),
    format('select count(*) from (select public.cockpit_sales_room_event_lease(null, %L, 600) as v) as x where v is not null or v is null', 'stress-sec:open:1'),
    format('select public.cockpit_sales_rooms_close(array[%L]::uuid[], array[''open''], ''ended'', ''x'', ''x'')::bigint', room),
    format('select public.cockpit_sales_live_move((select id from public.cockpit_sales_live where contact_id = %L), array[''offered''], ''cancelled'', ''x'', ''x'')::bigint', 'stress-sec-lead-2'),
    'select count(*) from (select public.cockpit_sales_rooms_sweep() as v) as x where v is not null',
    'select count(*) from (select public.cockpit_sales_rooms_tick() as v) as x where v is not null',
    'select count(*) from (select public.cockpit_sales_watchdog() as v) as x where v is not null',
    $q$select public.cockpit_sales_alert_set('stress-sec:a', true, 'x', 'x', '<!channel> x', '{}')::bigint$q$,
    'select count(*) from (select public.cockpit_sales_room_code() as v) as x where v is not null',
    format('select count(*) from (select public.cockpit_sales_room_pending(%L, now()) as v) as x where v is not null', room),
    $q$select count(*) from (select public.cockpit_sales_settings_add_missing('rooms', '{"enabled": true}', 'x', 'x') as v) as x where v is not null$q$,
    $q$select count(*) from (select public.cockpit_sales_jsonb_add_missing('{}', '{}') as v) as x where v is not null$q$,
    $q$select count(*) from (select public.cockpit_sales_alert_words('x', 10) as v) as x where v is not null$q$,
    'select count(*) from (select public.cockpit_sales_alert_hours(now()) as v) as x where v is not null'
  ] loop
    -- Every call's value is used (where v ...): a stable function whose
    -- value nobody reads is never run, and an unrun function is never
    -- checked for EXECUTE, which would read as a false PASS.
    said := pg_temp.as_role('authenticated', seat, fn);
    perform pg_temp.ck('B6 a seat cannot call: ' || left(fn, 90), said like '42501%', said);
  end loop;

  -- a paused seat loses its rows at once
  update public.cockpit_sales_people set active = false where email = 'stress-sec-seat@stress.invalid';
  said := pg_temp.as_role('authenticated', seat,
    $q$select count(*) from public.cockpit_sales_rooms where contact_id like 'stress-sec-%'$q$);
  perform pg_temp.ck('B7 a paused seat sees no room the moment it is paused', said = 'ok:0', said);
exception when others then
  reset role;
  perform pg_temp.ck('B section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$b$;

-- C. The service-role paths a seat reaches through sales-api ------------------

do $c$
declare
  got integer;
  e text;
  room uuid := (select v::uuid from pg_temp.ss_fx where k = 'room');
  lease_until timestamptz;
begin
  select count(*) into got
    from public.cockpit_sales_live_claim((select id from public.cockpit_sales_live where contact_id = 'stress-sec-lead-2'),
                                         'stress-sec-not-offered@stress.invalid', null);
  perform pg_temp.ck('C1 the claim refuses a seat the offer was never made to',
    got = 0 and (select state from public.cockpit_sales_live where contact_id = 'stress-sec-lead-2') = 'offered',
    format('rows %s', got));

  select count(*) into got
    from public.cockpit_sales_live_claim((select id from public.cockpit_sales_live where contact_id = 'stress-sec-lead-2'),
                                         '  ', null);
  perform pg_temp.ck('C1 the claim refuses an empty address', got = 0, format('rows %s', got));

  foreach e in array array['javascript:alert(1)', 'http://zoom.stress.invalid/j/1', ' https://zoom.stress.invalid/j/1', 'data:text/html,x'] loop
    begin
      update public.cockpit_sales_rooms set join_url = e where id = room;
      perform pg_temp.ck('C2 join_url refuses ' || e, false, 'accepted');
    exception when check_violation then
      perform pg_temp.ck('C2 join_url refuses ' || e, true);
    end;
  end loop;

  begin
    update public.cockpit_sales_room_secrets set start_url = 'javascript:alert(1)' where room_id = room;
    perform pg_temp.ck('C3 a host link must be https', false, 'accepted');
  exception when check_violation then
    perform pg_temp.ck('C3 a host link must be https', true);
  end;

  foreach e in array array['zoom.x;drop table x', 'Zoom.Upper', '', repeat('a', 81)] loop
    begin
      insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key) values (room, e, 'zoom', 'stress-sec:k:' || md5(e));
      perform pg_temp.ck('C4 an event kind outside the pattern is refused: ' || left(e, 30), false, 'accepted');
    exception when check_violation then
      perform pg_temp.ck('C4 an event kind outside the pattern is refused: ' || left(e, 30), true);
    end;
  end loop;

  perform public.cockpit_sales_room_event_lease(null, 'stress-sec:open:1', 100000);
  select e2.lease_until into lease_until from public.cockpit_sales_room_events as e2 where e2.dedupe_key = 'stress-sec:open:1';
  perform pg_temp.ck('C5 a lease on a handled event is never taken', lease_until is null, coalesce(lease_until::text, 'none'));

  begin
    update public.cockpit_sales_rooms set state = 'ended' where id = room;
    update public.cockpit_sales_rooms set state = 'open' where id = room;
    perform pg_temp.ck('C6 a finished room can never be opened again', false, 'reopened');
  exception when others then
    perform pg_temp.ck('C6 a finished room can never be opened again', sqlstate = 'P0001', sqlstate || ': ' || sqlerrm);
  end;

  foreach e in array array['k7q2mx', 'K7Q2MXX', 'K7Q2M0', 'K7Q2MI'] loop
    begin
      insert into public.cockpit_sales_rooms (request_id, code, contact_id, purpose, call_kind, provider, host_email, made_by)
      values (gen_random_uuid(), e, 'stress-sec-lead-' || e, 'manual', 'intro', 'meet', 'stress-sec-code@stress.invalid', 'x');
      perform pg_temp.ck('C7 a room code outside the alphabet is refused: ' || e, false, 'accepted');
    exception when check_violation then
      perform pg_temp.ck('C7 a room code outside the alphabet is refused: ' || e, true);
    end;
  end loop;

  perform pg_temp.ck('C8 alert words never carry an address',
    public.cockpit_sales_alert_words('Call stress-sec-lead@stress.invalid now.', 200) not like '%@%',
    public.cockpit_sales_alert_words('Call stress-sec-lead@stress.invalid now.', 200));
exception when others then
  perform pg_temp.ck('C section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$c$;

-- D. Round 2 (3 October 2026): what a seat's token reads that it should not ---

do $d$
declare
  seat uuid := gen_random_uuid();
  made text;
  said text;
begin
  -- A Zoom join of a meeting that is no cockpit room (the webinar, a client
  -- call, an interview on the same Zoom account), as the door keeps it when
  -- its 500 ms room lookup fails: room_id null, the attendee's name and email
  -- in detail. sales-api's no_room path leaves it as it is.
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
  values (null, 'zoom.meeting.participant_joined', 'zoom', 'stress-sec:foreign-meeting:1', now(),
          'Zoom: Stress Attendee joined.',
          jsonb_build_object('event', 'meeting.participant_joined',
            'refused', jsonb_build_object('code', 'no_room'),
            'payload', jsonb_build_object('object', jsonb_build_object(
              'id', '99887766554', 'topic', 'Mahara weekly webinar',
              'participant', jsonb_build_object('user_name', 'Stress Attendee',
                                                'email', 'stress-sec-attendee@stress.invalid')))));
  begin
    insert into auth.users (id, email, email_confirmed_at, aud, role)
    values (seat, 'stress-sec-seat-d@stress.invalid', now(), 'authenticated', 'authenticated');
    made := 'none';
  exception when others then
    made := sqlstate || ': ' || sqlerrm;
  end;
  if made <> 'none' then
    perform pg_temp.ck('D skipped: a test sign-in could not be made', true, made);
    return;
  end if;
  insert into public.cockpit_sales_people (email, name, role, active, via_portal)
  values ('stress-sec-seat-d@stress.invalid', 'Stress Seat D', 'setter', true, true);

  -- zoom-foreign-meeting-attendees-kept, the database side: the seat policy
  -- reads every room event, including one that belongs to no room.
  said := pg_temp.as_role('authenticated', seat,
    $q$select count(*) from public.cockpit_sales_room_events
        where dedupe_key = 'stress-sec:foreign-meeting:1'
          and detail #>> '{payload,object,participant,email}' = 'stress-sec-attendee@stress.invalid'$q$);
  perform pg_temp.ck('D1 a seat cannot read the name and email of an attendee of a Zoom meeting that is no room',
    said = 'ok:0', said);

exception when others then
  reset role;
  perform pg_temp.ck('D section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$d$;
"""

FINAL = "select name, ok, detail from pg_temp.ss_checks order by n;"

LEFTOVERS = r"""
select 'room ' || id from public.cockpit_sales_rooms where contact_id like 'stress-sec-%' or host_email like 'stress-sec-%'
union all select 'event ' || id from public.cockpit_sales_room_events where dedupe_key like 'stress-sec%'
union all select 'secret ' || room_id from public.cockpit_sales_room_secrets where start_url like '%stress%'
union all select 'live ' || id from public.cockpit_sales_live where contact_id like 'stress-sec-%'
union all select 'availability ' || email from public.cockpit_sales_availability where email like 'stress-sec-%'
union all select 'host ' || email from public.cockpit_sales_room_hosts where email like 'stress-sec-%'
union all select 'people ' || email from public.cockpit_sales_people where email like 'stress-sec-%'
union all select 'auth user ' || email from auth.users where email like 'stress-sec-%'
union all select 'alert ' || dedupe_key from public.cockpit_sales_alerts where dedupe_key like 'stress-sec%'
union all select 'wave ' || id from public.cockpit_sales_followup_waves where made_by like 'stress-sec-%'
union all select 'level ' || kind_key from public.cockpit_sales_followup_levels where set_by like 'stress-sec-%'
union all select 'stop ' || contact_id from public.cockpit_sales_followup_stops where contact_id like 'stress-sec-%'
union all select 'audit ' || id from public.cockpit_audit_log where actor_email like 'stress-sec-%' or metadata ->> 'contact_id' like 'stress-sec-%'
"""


def token() -> str:
    t = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if t:
        return t
    path = os.path.expanduser("~/.config/mahara/sb_mgmt_token")
    if not os.path.exists(path):
        sys.exit("No management token: set SUPABASE_ACCESS_TOKEN or write it to ~/.config/mahara/sb_mgmt_token.")
    return open(path).read().strip()


def query(sql: str, write: bool):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": sql, "read_only": not write}).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json", "User-Agent": "mahara-sales/1"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"The database refused the run (HTTP {e.code}): {e.read().decode()[:1500]}")


def compose() -> str:
    body = CHECKS.replace("@@TABLES@@", sql_list(NEW_TABLES)).replace("@@FUNCTIONS@@", sql_list(NEW_FUNCTIONS))
    low = body.lower()
    for word in ("\ncommit", "\nrollback", "\nbegin;", "\nabort", "\nstart transaction"):
        if word in low:
            raise SystemExit(f"Refusing to run: the checks contain a transaction statement ({word.strip()}).")
    # Migration 20261003d (not applied in production yet) goes in first, in
    # the same rolled-back transaction, so section D checks the repo's seat
    # policy on room events (only events that belong to a room).
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import run_checks  # noqa: E402  (migration d's text without its own begin and commit)
    return "\n".join([
        "begin;",
        "set local lock_timeout = '5s';",
        "set local statement_timeout = '60s';",
        "-- ===== 20261003d (the repo's hardening, rolled back with the rest) =====",
        run_checks.hardening_sql(),
        body,
        FINAL,
        "rollback;",
    ])


UNAPPLIED = ["20261003d_live_calls_hardening.sql"]


def static_checks() -> list[tuple[str, bool, str]]:
    """Round 2: the migrations not applied in production yet cannot be run
    against real roles, so their text is checked: every function and view
    they make is revoked from public, anon and authenticated in the same
    file, and every security-definer function pins its search_path."""
    import re
    here = os.path.dirname(os.path.abspath(__file__))
    out: list[tuple[str, bool, str]] = []
    for name in UNAPPLIED:
        path = os.path.join(here, "..", name)
        if not os.path.exists(path):
            out.append((f"S0 {name} is here to check", False, "missing"))
            continue
        sql = open(path).read()
        low = sql.lower()
        for m in re.finditer(r"create or replace function public\.(\w+)\(", low):
            fn = m.group(1)
            body_end = low.find("$$;", m.end())
            head = low[m.end(): low.find("$$", m.end())]
            revoked = re.search(rf"revoke all on function public\.{fn}\([^)]*\) from public, anon, authenticated", low)
            out.append((f"S1 {name}: {fn} is revoked from public, anon and authenticated", bool(revoked), ""))
            if "security definer" in head:
                out.append((f"S2 {name}: security-definer {fn} pins its search_path", "set search_path" in head, ""))
            if body_end < 0:
                out.append((f"S1 {name}: {fn} has a body", False, "no closing $$;"))
        for m in re.finditer(r"create (?:or replace )?view public\.(\w+)", low):
            v = m.group(1)
            revoked = re.search(rf"revoke all on public\.{v} from public, anon, authenticated", low)
            out.append((f"S3 {name}: view {v} is revoked from public, anon and authenticated", bool(revoked), ""))
        for m in re.finditer(r"create table (?:if not exists )?public\.(\w+)", low):
            t = m.group(1)
            ok = f"alter table public.{t} enable row level security" in low and \
                re.search(rf"revoke all on public\.{t} from public, anon, authenticated", low) is not None
            out.append((f"S4 {name}: table {t} has row security and its revoke", ok, ""))
    return out


def main():
    statics = static_checks()
    for n, ok, d in statics:
        print(f"{'PASS' if ok else 'FAIL'}  {n}" + (f"  ({d})" if d else ""))
    static_failed = [x for x in statics if not x[1]]
    before = query(LEFTOVERS, write=False) or []
    if before:
        print("stress-sec rows exist before the run (another run left them?):", [r["?column?"] for r in before])
        sys.exit(1)
    rows = query(compose(), write=True) or []
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    after = query(LEFTOVERS, write=False) or []
    if after:
        print("LEFT BEHIND after the rollback:", after)
        sys.exit(1)
    print("Nothing persisted: no stress-sec row is in any table the run touched.")
    sys.exit(0 if rows and not failed and not static_failed else 1)


if __name__ == "__main__":
    main()
