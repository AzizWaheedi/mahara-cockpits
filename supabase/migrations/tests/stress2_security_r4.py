#!/usr/bin/env python3
"""Second series, round 4 (5 October 2026): row security and grants of what
20261004a makes after fix rounds 2 and 3 (not applied in production yet),
checked with real roles inside ONE rolled-back transaction: the file as it
stands is applied in it, then anon, a signed-in non-seat and a seat token try
the functions fix rounds 2 and 3 added (the one-step mark replace and the
lease with its holder's token), the columns they added, and every
cockpit_sales_ function in the schema, not only the ones round 2 listed.

    python3 supabase/migrations/tests/stress2_security_r4.py

Safety: one transaction that ends in `rollback;` (lock_timeout 5 s).
Synthetic rows only (`stress-2sec4-*`, `@stress.invalid`); no sweep, tick,
watchdog or pg_net call is made. Before and after, a read-only query proves
nothing persisted. The management token is read from SUPABASE_ACCESS_TOKEN
or ~/.config/mahara/sb_mgmt_token and never printed. Each check prints PASS
or FAIL; a FAIL is a finding.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_checks  # noqa: E402
import stress2_security as s2  # noqa: E402  (query, token)

MIG2 = run_checks.strip_transaction(run_checks.HARDENING_2,
                                    open(os.path.join(run_checks.MIGRATIONS, run_checks.HARDENING_2)).read())

# What a seat would call to forge another rep's mark, or to take, finish or
# release a room event (a Zoom join, a settle) as if it were sales-api.
CALLS = [
    """select count(*) from public.cockpit_sales_disposition_replace(null, '{"appointment_id":"stress-2sec4-appt","contact_id":"stress-2sec4-lead","call_type":"intro","start_at":"2026-10-05T09:00:00Z","status":"showed","marked_by":"stress-2sec4-other@stress.invalid"}'::jsonb)""",
    "select count(*) from (select public.cockpit_sales_room_event_lease(null, 'stress-2sec4-key', 600, gen_random_uuid()) as v) as x",
    "select count(*) from (select public.cockpit_sales_room_event_lease(gen_random_uuid(), null, 30, null) as v) as x",
]

# Writes a seat would try straight to the tables, on the columns 20261004a added.
WRITES = [
    ("a room event's lease and its holder's token",
     "with x as (update public.cockpit_sales_room_events set lease_until = now() + interval '10 minutes', lease_token = gen_random_uuid() returning 1) select count(*) from x"),
    ("a room's meeting end (meeting_ended_at)",
     "with x as (update public.cockpit_sales_rooms set meeting_ended_at = now() returning 1) select count(*) from x"),
    ("a host's Zoom cap (zoom_capped_until)",
     "with x as (update public.cockpit_sales_room_hosts set zoom_capped_until = now() + interval '1 day' returning 1) select count(*) from x"),
    ("a row in the room hosts (its own Zoom user)",
     "with x as (insert into public.cockpit_sales_room_hosts (email, zoom_user_id) values ('stress-2sec4-seat@stress.invalid', 'stress-zoom-user') returning 1) select count(*) from x"),
    ("a mark straight into the dispositions",
     "with x as (insert into public.cockpit_sales_dispositions (appointment_id, contact_id, call_type, status, marked_by) values ('stress-2sec4-appt', 'stress-2sec4-lead', 'intro', 'showed', 'stress-2sec4-other@stress.invalid') returning 1) select count(*) from x"),
]

CHECKS = r"""
create temp table s2r4 (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.s2r4 (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

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

-- A. The catalogue after 20261004a as it stands.
select pg_temp.ck('A1 no cockpit_sales_ function in public is callable by anon or a signed-in user, but the pure helpers the cockpit reads',
  count(*) = 0, string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '))
  from pg_proc as p
 where p.pronamespace = 'public'::regnamespace
   and p.proname like 'cockpit\_sales\_%'
   -- The app's own sign-in and read helpers (before live calls) and the two pure checks.
   and p.proname not in ('cockpit_sales_setting_int', 'cockpit_sales_kind_key_ok', 'cockpit_sales_seat', 'cockpit_sales_whoami',
                         'cockpit_sales_manager', 'cockpit_sales_email', 'cockpit_sales_my_names', 'cockpit_sales_first_deal_at',
                         'cockpit_sales_lead_deals', 'cockpit_sales_setter_deals', 'cockpit_sales_ai_tokens_since')
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));

select pg_temp.ck('A2 the three-argument lease is gone (one lease, with its holder''s token)',
  not exists (select 1 from pg_proc where proname = 'cockpit_sales_room_event_lease' and pronargs = 3 and pronamespace = 'public'::regnamespace));

select pg_temp.ck('A3 the security-definer functions fix rounds 2 and 3 made keep an empty search_path',
  count(*) = 0, string_agg(p.proname, ', '))
  from pg_proc as p
 where p.pronamespace = 'public'::regnamespace and p.prosecdef
   and p.proname in ('cockpit_sales_disposition_replace', 'cockpit_sales_room_event_lease')
   and not coalesce('search_path=""' = any (p.proconfig), false);

select pg_temp.ck('A4 no column-level grant opens a column 20261004a added to anon or a signed-in user',
  count(*) = 0, string_agg(table_name || '.' || column_name || ' ' || privilege_type || ' to ' || grantee, ', '))
  from information_schema.column_privileges
 where table_schema = 'public'
   and (table_name, column_name) in (('cockpit_sales_room_events', 'lease_token'), ('cockpit_sales_rooms', 'meeting_ended_at'),
                                     ('cockpit_sales_room_hosts', 'zoom_capped_until'), ('cockpit_sales_availability', 'standby_error'),
                                     ('cockpit_sales_availability', 'standby_error_at'))
   and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT';

do $b$
declare
  seat uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  made text;
  said text;
  t text;
begin
  begin
    insert into auth.users (id, email, email_confirmed_at, aud, role)
    values (seat, 'stress-2sec4-seat@stress.invalid', now(), 'authenticated', 'authenticated');
    made := 'none';
  exception when others then
    made := sqlstate || ': ' || sqlerrm;
  end;
  if made <> 'none' then
    perform pg_temp.ck('B skipped: a test sign-in could not be made', true, made);
    return;
  end if;
  insert into public.cockpit_sales_people (email, name, role, active, via_portal)
  values ('stress-2sec4-seat@stress.invalid', 'Stress Seat', 'setter', true, true);

  foreach t in array array[@@CALLS@@] loop
    said := pg_temp.as_role('authenticated', seat, t);
    perform pg_temp.ck('B1 a seat cannot: ' || left(t, 110), said like '42501%', said);
    said := pg_temp.as_role('authenticated', stranger, t);
    perform pg_temp.ck('B2 a signed-in non-seat cannot: ' || left(t, 110), said like '42501%', said);
    said := pg_temp.as_role('anon', null, t);
    perform pg_temp.ck('B3 anon cannot: ' || left(t, 110), said like '42501%', said);
  end loop;
@@WRITES@@
exception when others then
  reset role;
  perform pg_temp.ck('B section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$b$;
"""

FINAL = "select name, ok, detail from pg_temp.s2r4 order by n;"

LEFTOVERS = r"""
select 'people ' || email from public.cockpit_sales_people where email like 'stress-2sec4-%'
union all select 'auth user ' || email from auth.users where email like 'stress-2sec4-%'
union all select 'host ' || email from public.cockpit_sales_room_hosts where email like 'stress-2sec4-%'
union all select 'mark ' || appointment_id from public.cockpit_sales_dispositions where appointment_id like 'stress-2sec4-%'
"""


def dollar(s: str) -> str:
    return "$f$" + s + "$f$"


def compose() -> str:
    calls = ", ".join(dollar(c) for c in CALLS)
    writes = "\n".join(
        f"  said := pg_temp.as_role('authenticated', seat, {dollar(sql)});\n"
        f"  perform pg_temp.ck({dollar('B4 a seat cannot write ' + what)}, said like '42501%' or said = 'ok:0', said);"
        for what, sql in WRITES
    )
    body = CHECKS.replace("@@CALLS@@", calls).replace("@@WRITES@@", writes)
    for word in ("\ncommit", "\nrollback", "\nbegin;", "\nabort", "\nstart transaction"):
        if word in body.lower():
            raise SystemExit(f"Refusing to run: the checks contain a transaction statement ({word.strip()}).")
    return "\n".join(["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '90s';",
                      MIG2, body, FINAL, "rollback;"])


def main():
    before = s2.query(LEFTOVERS, write=False) or []
    if before:
        print("stress-2sec4 rows exist before the run:", before)
        sys.exit(1)
    rows = s2.query(compose(), write=True) or []
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    after = s2.query(LEFTOVERS, write=False) or []
    if after:
        print("LEFT BEHIND after the rollback:", after)
        sys.exit(1)
    print("Nothing persisted: no stress-2sec4 row is in any table the run touched.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
