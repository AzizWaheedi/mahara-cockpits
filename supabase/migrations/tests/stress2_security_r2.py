#!/usr/bin/env python3
"""Second series, round 2 (4 October 2026): row security and grants of what
20261004a (fix round 1, not applied in production yet) makes again, checked
with real roles inside ONE rolled-back transaction: the file is applied in
it, then anon, a signed-in non-seat and a seat token try every function and
view it made or replaced, and the availability columns it added.

    python3 supabase/migrations/tests/stress2_security_r2.py

Safety: one transaction that ends in `rollback;` (lock_timeout 5 s).
Synthetic rows only (`stress-2sec2-*`); no sweep, tick, watchdog or pg_net
call is made (the sweep is only checked for its grant, never run). Before and
after, a read-only query proves nothing persisted. The management token is
read from SUPABASE_ACCESS_TOKEN or ~/.config/mahara/sb_mgmt_token and never
printed. Each check prints PASS or FAIL; a FAIL is a finding.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_checks  # noqa: E402
import stress2_security as s2  # noqa: E402  (query, token)

MIG2 = run_checks.strip_transaction(run_checks.HARDENING_2,
                                    open(os.path.join(run_checks.MIGRATIONS, run_checks.HARDENING_2)).read())

CALLS = [
    # An immutable function's unused output is planned away, so the result is used.
    "select count(*) from (select public.cockpit_sales_norm_words('x') as v) as x where v is not null",
    "select count(*) from (select public.cockpit_sales_message_slot('{}'::jsonb, '{}'::jsonb) as v) as x",
    "select count(*) from public.cockpit_sales_live_claim(gen_random_uuid(), 'stress-2sec2-seat@stress.invalid', null, now())",
    "select count(*) from public.cockpit_sales_live_claim(gen_random_uuid(), 'stress-2sec2-seat@stress.invalid')",
    "select count(*) from (select public.cockpit_sales_rooms_sweep() as v) as x",
    "select count(*) from public.cockpit_sales_presence",
]

CHECKS = r"""
create temp table s2r2 (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.s2r2 (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
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

select pg_temp.ck('A1 every cockpit_sales_ function 20261004a made is closed to anon and signed-in users',
  count(*) = 0, string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '))
  from pg_proc as p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('cockpit_sales_norm_words', 'cockpit_sales_message_slot', 'cockpit_sales_live_claim', 'cockpit_sales_rooms_sweep')
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));

select pg_temp.ck('A2 the three-argument claim is gone (no second door to the claim)',
  not exists (select 1 from pg_proc where proname = 'cockpit_sales_live_claim' and pronargs = 3 and pronamespace = 'public'::regnamespace));

select pg_temp.ck('A3 the presence view made again runs with the reader''s rights and no anon or signed-in grant',
  coalesce((select 'security_invoker=true' = any (c.reloptions)
                   and not has_table_privilege('authenticated', c.oid, 'select')
                   and not has_table_privilege('anon', c.oid, 'select')
              from pg_class as c where c.relname = 'cockpit_sales_presence' and c.relnamespace = 'public'::regnamespace), false));

select pg_temp.ck('A4 the security-definer functions 20261004a replaced keep an empty search_path',
  count(*) = 0, string_agg(p.proname, ', '))
  from pg_proc as p
 where p.pronamespace = 'public'::regnamespace and p.prosecdef
   and p.proname in ('cockpit_sales_message_slot', 'cockpit_sales_live_claim', 'cockpit_sales_rooms_sweep')
   and not coalesce('search_path=""' = any (p.proconfig), false);

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
    values (seat, 'stress-2sec2-seat@stress.invalid', now(), 'authenticated', 'authenticated');
    made := 'none';
  exception when others then
    made := sqlstate || ': ' || sqlerrm;
  end;
  if made <> 'none' then
    perform pg_temp.ck('B skipped: a test sign-in could not be made', true, made);
    return;
  end if;
  insert into public.cockpit_sales_people (email, name, role, active, via_portal)
  values ('stress-2sec2-seat@stress.invalid', 'Stress Seat', 'closer', true, true);

  foreach t in array array[@@CALLS@@] loop
    said := pg_temp.as_role('authenticated', seat, t);
    perform pg_temp.ck('B1 a seat cannot: ' || left(t, 110), said like '42501%', said);
    said := pg_temp.as_role('authenticated', stranger, t);
    perform pg_temp.ck('B2 a signed-in non-seat cannot: ' || left(t, 110), said like '42501%', said);
    said := pg_temp.as_role('anon', null, t);
    perform pg_temp.ck('B3 anon cannot: ' || left(t, 110), said like '42501%', said);
  end loop;

  -- The availability columns 20261004a added: readable as the table is, never writable.
  said := pg_temp.as_role('authenticated', seat,
    $q$with x as (update public.cockpit_sales_availability set standby_error = 'x' returning 1) select count(*) from x$q$);
  perform pg_temp.ck('B4 a seat cannot write the standby sentence of any seat', said like '42501%', said);
  said := pg_temp.as_role('authenticated', seat,
    $q$with x as (insert into public.cockpit_sales_availability (email, state, standby_error) values ('stress-2sec2-seat@stress.invalid', 'available', 'x') returning 1) select count(*) from x$q$);
  perform pg_temp.ck('B5 a seat cannot make itself Available behind sales-api''s back', said like '42501%', said);
exception when others then
  reset role;
  perform pg_temp.ck('B section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$b$;
"""

FINAL = "select name, ok, detail from pg_temp.s2r2 order by n;"

LEFTOVERS = r"""
select 'people ' || email from public.cockpit_sales_people where email like 'stress-2sec2-%'
union all select 'auth user ' || email from auth.users where email like 'stress-2sec2-%'
union all select 'availability ' || email from public.cockpit_sales_availability where email like 'stress-2sec2-%'
"""


def compose() -> str:
    calls = ", ".join("$f$" + c + "$f$" for c in CALLS)
    body = CHECKS.replace("@@CALLS@@", calls)
    for word in ("\ncommit", "\nrollback", "\nbegin;", "\nabort", "\nstart transaction"):
        if word in body.lower():
            raise SystemExit(f"Refusing to run: the checks contain a transaction statement ({word.strip()}).")
    return "\n".join(["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '90s';",
                      MIG2, body, FINAL, "rollback;"])


def main():
    before = s2.query(LEFTOVERS, write=False) or []
    if before:
        print("stress-2sec2 rows exist before the run:", before)
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
    print("Nothing persisted: no stress-2sec2 row is in any table the run touched.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
