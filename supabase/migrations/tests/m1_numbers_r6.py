#!/usr/bin/env python3
"""Milestone 1, video-link round 6, NUMBERS AND RECORDS, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_numbers_r6.py

The repo's 20261003d and 20261004a (20261004a not applied in production yet)
are applied inside the transaction. The minute's tick and sweep are then
copied into pg_temp with only their outside doors swapped (the
stress_chaos_r4.py technique): the settings (the pilot's, m1-scope.md
section 3), the status rows, the alerts, the sweep's posts, pg_net's answers
and the vault are temp stand-ins, and the copies take their own advisory
lock, so the real minute's sweep never skips and nothing is ever posted.

What must hold (20261003d cockpit_sales_rooms_tick, its own words): "A post
the door refused ... turns the sweep's row red and raises one alert, so a
silent door is never read as a green sweep." The Team page's "The room
sweep" line and the watchdog's failing:sales-api/sweep read that row.

  A. control: the minute the door's refusal of a post is read, the sweep's
     row is red and sweep:door_refused is open;
  B. the next minute, with nothing posted since (no room needed a re-check),
     the door is not proven working again: the sweep's row must not read
     green while sweep:door_refused is still open.

(Production as of 2026-10-06 shows B: sweep:door_refused open since
2026-10-05 20:22 (a 404 from sales-live/cron, which is not deployed), and
the sales-api/sweep row ok, "0 rooms closed, ...".)

A FAIL is a finding; checks named "control" pass. No row is made outside
pg_temp; nothing is committed.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

COPY = r"""
create temp table n6_settings (key text primary key, value jsonb not null) on commit drop;
insert into pg_temp.n6_settings (key, value)
select s.key, s.value || case s.key
         when 'rooms' then '{"enabled": true, "test_only": true, "short_link": false, "count_on_join": false,
                             "settle": false, "wrap": false, "providers": {"zoom": true, "meet": true},
                             "send": {"whatsapp_text": true, "whatsapp_template": true, "email": true}}'::jsonb
         else '{}'::jsonb end
  from public.cockpit_sales_settings as s where s.key in ('rooms', 'live');
create temp table n6_status (like public.cockpit_sales_worker_status including all) on commit drop;
create temp table n6_alerts (like public.cockpit_sales_alerts including all) on commit drop;
create temp table n6_posts (like public.cockpit_sales_room_posts including all) on commit drop;
create temp table n6_http_response (id bigint primary key, status_code integer, error_msg text, timed_out boolean) on commit drop;
create temp table n6_secrets (name text, decrypted_secret text) on commit drop;
insert into pg_temp.n6_secrets values ('cockpit_sync_secret', 'stress-not-a-secret');
create temp table n6_sent (id bigint, url text, body jsonb) on commit drop;
create temp sequence n6_req_seq start 900000000001;

create function pg_temp.n6_http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
returns bigint language plpgsql as $$
declare
  i bigint := nextval('pg_temp.n6_req_seq');
begin
  insert into pg_temp.n6_sent (id, url, body) values (i, url, body);
  return i;
end;
$$;

do $copy$
declare
  src text;
begin
  src := pg_get_functiondef('public.cockpit_sales_alert_set(text, boolean, text, text, text, jsonb)'::regprocedure);
  src := replace(src, 'FUNCTION public.cockpit_sales_alert_set(', 'FUNCTION pg_temp.n6_alert_set(');
  src := replace(src, 'CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
  src := replace(src, 'public.cockpit_sales_alerts', 'pg_temp.n6_alerts');
  if position('pg_temp.n6_alert_set' in src) = 0 or position('pg_temp.n6_alerts' in src) = 0 then
    raise exception 'The alert_set copy did not take: the function text changed shape.';
  end if;
  execute src;

  src := pg_get_functiondef('public.cockpit_sales_rooms_sweep()'::regprocedure);
  src := replace(src, 'CREATE OR REPLACE FUNCTION public.cockpit_sales_rooms_sweep()', 'CREATE FUNCTION pg_temp.n6_sweep()');
  src := replace(src, 'public.cockpit_sales_settings', 'pg_temp.n6_settings');
  src := replace(src, 'public.cockpit_sales_worker_status', 'pg_temp.n6_status');
  src := replace(src, 'public.cockpit_sales_alert_set(', 'pg_temp.n6_alert_set(');
  src := replace(src, 'public.cockpit_sales_alerts', 'pg_temp.n6_alerts');
  src := replace(src, 'hashtext(''cockpit_sales_rooms_sweep'')', 'hashtext(''m1_numbers_r6_sweep'')');
  if position('pg_temp.n6_sweep' in src) = 0 or position('pg_temp.n6_settings' in src) = 0
     or position('pg_temp.n6_status' in src) = 0 or position('m1_numbers_r6_sweep' in src) = 0 then
    raise exception 'The sweep copy did not take: the function text changed shape.';
  end if;
  execute src;

  src := pg_get_functiondef('public.cockpit_sales_rooms_tick()'::regprocedure);
  src := replace(src, 'CREATE OR REPLACE FUNCTION public.cockpit_sales_rooms_tick()', 'CREATE FUNCTION pg_temp.n6_tick()');
  src := replace(src, 'public.cockpit_sales_rooms_sweep()', 'pg_temp.n6_sweep()');
  src := replace(src, 'public.cockpit_sales_room_posts', 'pg_temp.n6_posts');
  src := replace(src, 'public.cockpit_sales_worker_status', 'pg_temp.n6_status');
  src := replace(src, 'public.cockpit_sales_alert_set(', 'pg_temp.n6_alert_set(');
  src := replace(src, 'net._http_response', 'pg_temp.n6_http_response');
  src := replace(src, 'net.http_post(', 'pg_temp.n6_http_post(');
  src := replace(src, 'vault.decrypted_secrets', 'pg_temp.n6_secrets');
  if position('pg_temp.n6_tick' in src) = 0 or position('pg_temp.n6_sweep()' in src) = 0
     or position('pg_temp.n6_posts' in src) = 0 or position('pg_temp.n6_http_response' in src) = 0
     or position('net._http' in src) > 0 or position('net.http_post' in src) > 0 or position('vault.decrypted' in src) > 0
     or position('public.cockpit_sales_worker_status' in src) > 0 or position('public.cockpit_sales_alert_set' in src) > 0 then
    raise exception 'The tick copy did not take: the function text changed shape.';
  end if;
  execute src;
end
$copy$;
"""

CHECKS = r"""
create temp table n6_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

-- The minute before: the tick posted one tick to sales-live/cron, and the
-- door refused it (404: sales-live not deployed, or deployed under another
-- name), as production's own answer of 2026-10-05 20:22 says.
insert into pg_temp.n6_posts (request_id, kind, posted_at) values (900000000000, 'tick', now() - interval '1 minute');
insert into pg_temp.n6_http_response (id, status_code, error_msg, timed_out) values (900000000000, 404, null, false);

-- A. This minute: the answer is read.
select pg_temp.n6_tick();
insert into pg_temp.n6_checks (name, ok, detail)
select 'control: the minute the door''s refusal is read, the sweep''s row is red and sweep:door_refused is open',
       coalesce((select not s.ok from pg_temp.n6_status as s where s.worker = 'sales-api' and s.job = 'sweep'), false)
       and exists (select 1 from pg_temp.n6_alerts as a where a.dedupe_key = 'sweep:door_refused' and a.resolved_at is null),
       coalesce((select 'row ok ' || s.ok || ': ' || left(s.detail, 160) from pg_temp.n6_status as s
                  where s.worker = 'sales-api' and s.job = 'sweep'), 'no row')
       || ' | alert ' || coalesce((select 'open' from pg_temp.n6_alerts as a where a.dedupe_key = 'sweep:door_refused' and a.resolved_at is null), 'none');

-- B. The next minute: no room needed a re-check, so nothing was posted and
-- no answer came; the door is as refused as it was.
select pg_temp.n6_tick();
insert into pg_temp.n6_checks (name, ok, detail)
select 'the next minute, with nothing posted since, the sweep''s row is not green while sweep:door_refused is still open',
       not (coalesce((select s.ok from pg_temp.n6_status as s where s.worker = 'sales-api' and s.job = 'sweep'), false)
            and exists (select 1 from pg_temp.n6_alerts as a where a.dedupe_key = 'sweep:door_refused' and a.resolved_at is null)),
       coalesce((select 'row ok ' || s.ok || ': ' || left(s.detail, 160) from pg_temp.n6_status as s
                  where s.worker = 'sales-api' and s.job = 'sweep'), 'no row')
       || ' | alert ' || coalesce((select 'open' from pg_temp.n6_alerts as a where a.dedupe_key = 'sweep:door_refused' and a.resolved_at is null), 'none')
       || ' | posts ' || (select count(*) from pg_temp.n6_sent)::text;

select name, ok, detail from pg_temp.n6_checks order by n;
"""


def compose() -> str:
    parts = ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '100s';",
             "-- ===== 20261003d + 20261004a (the repo's, idempotent) =====", run_checks.hardening_sql(),
             COPY, CHECKS, "rollback;"]
    sql = "\n".join(parts)
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        sys.exit(f"Refusing to run: transaction statements {tx}.")
    return sql


def main():
    rows = q(compose(), write=True)
    if not isinstance(rows, list):
        sys.exit(f"Unexpected answer: {json.dumps(rows)[:400]}")
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    print("Nothing persisted: every row was in pg_temp and the transaction rolled back.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
