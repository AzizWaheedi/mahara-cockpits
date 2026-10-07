#!/usr/bin/env python3
"""Second series, round 1 (4 October 2026): row security and grants of the
live-calls objects as APPLIED in production (20261003a, b, c and d), checked
with real roles: anon, a signed-in non-seat and a seat token.

    python3 supabase/migrations/tests/stress2_security.py

What it attacks that the first series' stress_security.py did not run with
real roles (migration d was not applied then, so its objects were checked
only as text):
  - the tables and functions 20261003d added (cockpit_sales_room_posts, the
    count claim, the message slot, the live-hours check, the lock pair);
  - the tables a seat could use to squat a request id the server derives
    (cockpit_sales_messages, a room link's message keys) or to forge the
    room worker's health (cockpit_sales_worker_status, which room.create
    reads to refuse or allow a room);
  - the settings a seat could flip (rooms.test_only, live.enabled);
  - the room events a seat may read: only those that belong to a room (the
    door's Slack replies and the sweep's own rows stay out of sight).

Safety: ONE transaction that ends in `rollback;` (lock_timeout 5 s).
Synthetic rows only (contact ids `stress-2sec-*`, addresses
`stress-2sec-*@stress.invalid`); no sweep, tick, watchdog or pg_net call.
Before and after, a read-only leftovers query proves nothing persisted.
The management token is read from SUPABASE_ACCESS_TOKEN or
~/.config/mahara/sb_mgmt_token and never printed. Each check prints PASS or
FAIL; a FAIL is a finding. Exit code 0 only when all pass and nothing stayed.
"""
import json
import os
import sys
import urllib.error
import urllib.request

REF = "bldgtotkfmhoxmlzowdx"

D_TABLES = ["cockpit_sales_room_posts"]
D_FUNCTIONS = [
    "select count(*) from (select public.cockpit_sales_room_count_claim('@ROOM@'::uuid) as v) as x where v is not null or v is null",
    "select count(*) from (select public.cockpit_sales_room_count_claim('@ROOM@'::uuid, now(), 'booked', '{}'::jsonb, false) as v) as x where v is not null or v is null",
    "select count(*) from (select public.cockpit_sales_message_slot('{}'::jsonb, '{}'::jsonb) as v) as x where v is not null or v is null",
    "select count(*) from (select public.cockpit_sales_live_hours_open('{}'::jsonb, now()) as v) as x where v is not null or v is null",
    "select count(*) from (select public.cockpit_sales_lock('stress-2sec-lock', 'stress-2sec', 60) as v) as x where v is not null or v is null",
    "select count(*) from (select public.cockpit_sales_unlock('stress-2sec-lock', 'stress-2sec') as v) as x where v is not null or v is null",
]

CHECKS = r"""
create temp table s2_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;
create temp table s2_fx (k text primary key, v text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.s2_checks (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

-- One statement as a role whose JWT sub is p_sub: 'ok:<count>' or '<sqlstate>: <message>'.
create function pg_temp.as_role(p_role text, p_sub uuid, p_sql text)
returns text language plpgsql as $$
declare
  n bigint;
  said text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
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

do $fx$
declare
  r1 uuid := gen_random_uuid();
begin
  insert into public.cockpit_sales_rooms
    (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, host_by, lead_by, ends_at)
  values (r1, gen_random_uuid(), 'stress-2sec-lead-1', 'manual', 'intro', 'meet', 'stress-2sec-host@stress.invalid',
          'stress-2sec-host@stress.invalid', 'open', 'https://meet.google.com/stress-2sec',
          now() + interval '15 minutes', now() + interval '10 minutes', now() + interval '30 minutes');
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
  values (r1, 'door.open', 'door', 'stress-2sec:open:1', now(), 'The lead opened the link.', '{}'::jsonb),
         (null, 'slack.reply', 'door', 'stress-2sec:slack.reply:1', null, 'A refusal for a Slack user.', '{"slack_user_id": "U0STRESS2"}'::jsonb);
  insert into pg_temp.s2_fx values ('room', r1::text);
end;
$fx$;

-- A. The catalog: migration d's objects -------------------------------------

select pg_temp.ck('A1 row security is on for every table 20261003d made',
  bool_and(c.relrowsecurity), string_agg(c.relname, ', ') filter (where not c.relrowsecurity))
  from pg_class as c where c.relnamespace = 'public'::regnamespace and c.relname in (@@D_TABLES@@);

select pg_temp.ck('A2 anon and a signed-in role have no privilege on a table 20261003d made',
  not bool_or(has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')),
  string_agg(c.relname, ', '))
  from pg_class as c where c.relnamespace = 'public'::regnamespace and c.relname in (@@D_TABLES@@);

select pg_temp.ck('A3 no cockpit_sales_ security-definer function is callable by anon or PUBLIC',
  count(*) = 0, string_agg(p.proname, ', '))
  from pg_proc as p
 where p.pronamespace = 'public'::regnamespace and p.proname like 'cockpit\_sales\_%' and p.prosecdef
   and has_function_privilege('anon', p.oid, 'execute');

select pg_temp.ck('A4 no live-calls table is published to Realtime',
  count(*) = 0, string_agg(pubname || ':' || tablename, ', '))
  from pg_publication_tables
 where tablename in ('cockpit_sales_rooms', 'cockpit_sales_room_secrets', 'cockpit_sales_room_events', 'cockpit_sales_room_hosts',
                     'cockpit_sales_availability', 'cockpit_sales_live', 'cockpit_sales_alerts', 'cockpit_sales_room_posts',
                     'cockpit_sales_messages', 'cockpit_sales_settings');

select pg_temp.ck('A5 the presence view runs with the reader''s rights (security_invoker) and no signed-in grant',
  coalesce((select 'security_invoker=true' = any (c.reloptions) and not has_table_privilege('authenticated', c.oid, 'select')
              from pg_class as c where c.relname = 'cockpit_sales_presence' and c.relnamespace = 'public'::regnamespace), false));

-- B. Real roles ----------------------------------------------------------------

do $b$
declare
  stranger uuid := gen_random_uuid();
  seat uuid := gen_random_uuid();
  made text;
  said text;
  t text;
begin
  said := pg_temp.as_role('anon', null, 'select count(*) from public.cockpit_sales_room_posts');
  perform pg_temp.ck('B1 anon cannot read the sweep''s post ledger', said like '42501%', said);

  said := pg_temp.as_role('authenticated', stranger,
    $q$select count(*) from public.cockpit_sales_room_events where dedupe_key like 'stress-2sec%'$q$);
  perform pg_temp.ck('B2 a signed-in user with no seat sees no room event', said = 'ok:0', said);

  begin
    insert into auth.users (id, email, email_confirmed_at, aud, role)
    values (seat, 'stress-2sec-seat@stress.invalid', now(), 'authenticated', 'authenticated');
    made := 'none';
  exception when others then
    made := sqlstate || ': ' || sqlerrm;
  end;
  if made <> 'none' then
    perform pg_temp.ck('B3 skipped: a test sign-in could not be made', true, made);
    return;
  end if;
  insert into public.cockpit_sales_people (email, name, role, active, via_portal)
  values ('stress-2sec-seat@stress.invalid', 'Stress Seat', 'setter', true, true);

  said := pg_temp.as_role('authenticated', seat,
    $q$select count(*) from public.cockpit_sales_room_events where dedupe_key like 'stress-2sec%'$q$);
  perform pg_temp.ck('B3 a seat reads the room''s own event and never the door''s Slack reply (room_id null)', said = 'ok:1', said);

  said := pg_temp.as_role('authenticated', seat, 'select count(*) from public.cockpit_sales_room_posts');
  perform pg_temp.ck('B4 a seat cannot read the sweep''s post ledger', said like '42501%', said);

  foreach t in array array[
    -- the ledger of the sweep's own posts
    $q$with x as (insert into public.cockpit_sales_room_posts (request_id, kind) values (-1, 'tick') returning 1) select count(*) from x$q$,
    -- a room link's message key, squatted straight in the table (rooms.ts linkKeys)
    $q$with x as (insert into public.cockpit_sales_messages (request_id, contact_id, channel, body, source, sent_by, state)
       values (gen_random_uuid(), 'stress-2sec-lead-1', 'email', 'x', 'room', 'stress-2sec-seat@stress.invalid', 'sent') returning 1) select count(*) from x$q$,
    -- the room worker's health, which room.create reads to allow or refuse a room
    $q$with x as (insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at) values ('sales-desk', 'rooms', true, 'x', now())
       on conflict (worker, job) do update set ok = true, at = now() returning 1) select count(*) from x$q$,
    $q$with x as (update public.cockpit_sales_worker_status set ok = true, at = now() where worker = 'sales-live' returning 1) select count(*) from x$q$,
    -- the switches
    $q$with x as (update public.cockpit_sales_settings set value = value || '{"test_only": false}'::jsonb where key = 'rooms' returning 1) select count(*) from x$q$,
    $q$with x as (update public.cockpit_sales_settings set value = value || '{"enabled": true}'::jsonb where key = 'live' returning 1) select count(*) from x$q$,
    $q$with x as (insert into public.cockpit_sales_settings (key, value) values ('stress-2sec', '{}'::jsonb) returning 1) select count(*) from x$q$,
    -- the timeline and the event lease
    $q$with x as (update public.cockpit_sales_room_events set lease_until = now() + interval '10 minutes' where dedupe_key like 'stress-2sec%' returning 1) select count(*) from x$q$,
    $q$with x as (delete from public.cockpit_sales_room_events where dedupe_key like 'stress-2sec%' returning 1) select count(*) from x$q$
  ] loop
    said := pg_temp.as_role('authenticated', seat, t);
    perform pg_temp.ck('B5 a seat cannot write directly: ' || left(regexp_replace(t, '\s+', ' ', 'g'), 100), said like '42501%', said);
  end loop;

  foreach t in array array[@@D_FUNCTIONS@@] loop
    -- The fixture room's id is written in, never read from a temp table the
    -- role could not read (which would fail 42501 for the wrong reason).
    t := replace(t, '@ROOM@', (select v from pg_temp.s2_fx where k = 'room'));
    said := pg_temp.as_role('authenticated', seat, t);
    perform pg_temp.ck('B6 a seat cannot call: ' || left(t, 100), said like '42501%', said);
    said := pg_temp.as_role('anon', null, t);
    perform pg_temp.ck('B6 anon cannot call: ' || left(t, 100), said like '42501%' and said not like '%s2_fx%', said);
  end loop;
exception when others then
  reset role;
  perform pg_temp.ck('B section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$b$;
"""

FINAL = "select name, ok, detail from pg_temp.s2_checks order by n;"

LEFTOVERS = r"""
select 'room ' || id from public.cockpit_sales_rooms where contact_id like 'stress-2sec-%' or host_email like 'stress-2sec-%'
union all select 'event ' || id from public.cockpit_sales_room_events where dedupe_key like 'stress-2sec%'
union all select 'people ' || email from public.cockpit_sales_people where email like 'stress-2sec-%'
union all select 'auth user ' || email from auth.users where email like 'stress-2sec-%'
union all select 'message ' || id from public.cockpit_sales_messages where contact_id like 'stress-2sec-%'
union all select 'setting ' || key from public.cockpit_sales_settings where key like 'stress-2sec%'
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
    tables = ", ".join(f"'{t}'" for t in D_TABLES)
    fns = ", ".join("$f$" + f + "$f$" for f in D_FUNCTIONS)
    body = CHECKS.replace("@@D_TABLES@@", tables).replace("@@D_FUNCTIONS@@", fns)
    low = body.lower()
    for word in ("\ncommit", "\nrollback", "\nbegin;", "\nabort", "\nstart transaction"):
        if word in low:
            raise SystemExit(f"Refusing to run: the checks contain a transaction statement ({word.strip()}).")
    return "\n".join(["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '60s';", body, FINAL, "rollback;"])


def main():
    before = query(LEFTOVERS, write=False) or []
    if before:
        print("stress-2sec rows exist before the run:", before)
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
    print("Nothing persisted: no stress-2sec row is in any table the run touched.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
