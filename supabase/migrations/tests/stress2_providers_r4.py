#!/usr/bin/env python3
"""Second series, round 4, provider quirks on the database's side: Slack's
incoming webhook for #sales-alerts, as the deployed watchdog posts to it.

    python3 supabase/migrations/tests/stress2_providers_r4.py

Inside ONE transaction that always rolls back. The deployed watchdog
(cockpit_sales_watchdog, 20261003d) and cockpit_sales_alert_set are copied
into pg_temp with only their outside doors swapped (the stress_time.py and
stress_chaos_r4.py technique): temp copies of the alerts, the worker status
rows and the room events; a temp stand-in for pg_net's net.http_post that
records the post and answers a request id; a temp stand-in for
net._http_response that this script fills with Slack's answers; a temp
stand-in for the vault's webhook; and working hours always. No real alert,
status row, room event, vault secret or pg_net row is read for writing or
written; nothing is posted to Slack. No migration is applied here (the
deployed functions are copied as they stand).

What it attacks
  P4-1. Slack's incoming webhook refuses every post for good: the person
        who installed it left the workspace (Slack answers 403/404, e.g.
        "no_service" or "invalid_token"), the channel was archived (410
        "channel_is_archived"), or the hook was removed (404
        "no_active_hooks"). The watchdog posts each alert three times,
        records "Slack answered 404" on the alert row, then stops, and its own
        status row (sales-api / watchdog, the Team page's "The alert
        watchdog" line) stays green: "1 open alerts, 0 new, 0 posted." No
        screen reads post_error. Nobody is told #sales-alerts gets nothing.
  P4-2. HELD (control): pg_net that never answers turns the same row red
        (fix round 4, R4-3), so the asymmetry is the finding, not the setup.

Exit code 0 only when every check passed and nothing persisted.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402  (token handling and the management API call; never prints the token)

COPY = r"""
create temp table p4_wd_alerts (like public.cockpit_sales_alerts including all) on commit drop;
create temp table p4_wd_status (like public.cockpit_sales_worker_status including all) on commit drop;
create temp table p4_wd_events (like public.cockpit_sales_room_events including all) on commit drop;
create temp table p4_http_response (id bigint primary key, status_code integer, error_msg text, timed_out boolean,
                                    content text) on commit drop;
create temp table p4_secrets (name text, decrypted_secret text) on commit drop;
insert into pg_temp.p4_secrets values ('sales_alerts_slack_webhook', 'https://hooks.slack.invalid/T0/B0/stress-p4');
create temp table p4_posts (id bigint, url text, body jsonb) on commit drop;
create temp sequence p4_req_seq;

create function pg_temp.p4_http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
returns bigint language plpgsql as $$
declare
  i bigint := nextval('pg_temp.p4_req_seq');
begin
  insert into pg_temp.p4_posts (id, url, body) values (i, url, body);
  return i;
end;
$$;

do $copy$
declare
  src text;
begin
  src := pg_get_functiondef('public.cockpit_sales_alert_set(text, boolean, text, text, text, jsonb)'::regprocedure);
  src := replace(src, 'FUNCTION public.cockpit_sales_alert_set(', 'FUNCTION pg_temp.p4_alert_set(');
  src := replace(src, 'CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
  src := replace(src, 'public.cockpit_sales_alerts', 'pg_temp.p4_wd_alerts');
  if position('pg_temp.p4_alert_set' in src) = 0 or position('pg_temp.p4_wd_alerts' in src) = 0 then
    raise exception 'The alert_set copy did not take: the deployed function text changed shape.';
  end if;
  execute src;

  src := %(watchdog)s;
  src := replace(src, 'CREATE OR REPLACE FUNCTION public.cockpit_sales_watchdog()', 'CREATE FUNCTION pg_temp.p4_watchdog()');
  src := replace(src, 'create or replace function public.cockpit_sales_watchdog()', 'CREATE FUNCTION pg_temp.p4_watchdog()');
  src := replace(src, 'public.cockpit_sales_alert_set(', 'pg_temp.p4_alert_set(');
  src := replace(src, 'public.cockpit_sales_alerts', 'pg_temp.p4_wd_alerts');
  src := replace(src, 'public.cockpit_sales_worker_status', 'pg_temp.p4_wd_status');
  src := replace(src, 'public.cockpit_sales_room_events', 'pg_temp.p4_wd_events');
  src := replace(src, 'public.cockpit_sales_alert_hours(now())', 'true');
  src := replace(src, 'net._http_response', 'pg_temp.p4_http_response');
  src := replace(src, 'net.http_post(', 'pg_temp.p4_http_post(');
  src := replace(src, 'vault.decrypted_secrets', 'pg_temp.p4_secrets');
  src := replace(src, 'hashtext(''cockpit_sales_watchdog'')', 'hashtext(''stress2_providers_r4_watchdog'')');
  if position('pg_temp.p4_watchdog' in src) = 0 or position('pg_temp.p4_http_post(' in src) = 0
     or position('pg_temp.p4_http_response' in src) = 0 or position('pg_temp.p4_secrets' in src) = 0
     or position('net.' in src) > 0 or position('vault.' in src) > 0
     or position('public.cockpit_sales_alerts' in src) > 0 or position('public.cockpit_sales_worker_status' in src) > 0
     or position('stress2_providers_r4_watchdog' in src) = 0 then
    raise exception 'The watchdog copy did not take: the deployed function text changed shape.';
  end if;
  execute src;
end
$copy$;
"""

ATTACK = r"""
create temp table p4_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.p4_checks (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

create function pg_temp.wd()
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := pg_temp.p4_watchdog();
  if r ? 'skipped' then
    raise exception 'providers r4: the watchdog copy held its own lock; run again';
  end if;
  return r;
end;
$$;

-- P4-2 HELD first: a post pg_net never answers (its worker stopped).
do $$
declare
  silent uuid;
  st record;
begin
  insert into pg_temp.p4_wd_alerts (dedupe_key, source, kind, subject, message, detail)
  values ('stress2-providers-r4:silent', 'watchdog', 'room_mark_intro', 'Room P4SLNT',
          'Room P4SLNT: the booked intro was not marked a no-show. Mark it shown or a no-show.', '{}'::jsonb)
  returning id into silent;
  perform pg_temp.wd();
  -- Five minutes with no answer row (now() stands still in a transaction:
  -- the alert's own times move back instead).
  update pg_temp.p4_wd_alerts
     set posted_at = posted_at - interval '5 minutes', raised_at = raised_at - interval '5 minutes',
         last_seen_at = last_seen_at - interval '5 minutes'
   where id = silent;
  perform pg_temp.wd();
  select * into st from pg_temp.p4_wd_status where worker = 'sales-api' and job = 'watchdog';
  perform pg_temp.ck('P4-2 HELD: a Slack post pg_net never answered turns the watchdog''s own row red',
    st.ok is false, format('ok %s, detail %s', st.ok, st.detail));
end;
$$;

truncate pg_temp.p4_wd_alerts;
truncate pg_temp.p4_wd_status;
truncate pg_temp.p4_posts;
truncate pg_temp.p4_http_response;

-- P4-1: Slack answers every post with a refusal that will not pass.
do $$
declare
  dead uuid;
  i integer;
  posts integer;
  al record;
  st record;
begin
  insert into pg_temp.p4_wd_alerts (dedupe_key, source, kind, subject, message, detail)
  values ('stress2-providers-r4:dead-hook', 'watchdog', 'room_mark_intro', 'Room P4DEAD',
          'Room P4DEAD: the booked intro was not marked a no-show. Mark it shown or a no-show.', '{}'::jsonb)
  returning id into dead;
  for i in 1..5 loop
    perform pg_temp.wd();
    -- Slack's answer to every post this run made: 404 no_service (the hook's
    -- installer left the workspace), as pg_net stores an HTTP answer.
    insert into pg_temp.p4_http_response (id, status_code, error_msg, timed_out, content)
    select a.post_request_id, 404, null, false, 'no_service'
      from pg_temp.p4_wd_alerts as a
     where a.post_request_id is not null
       and not exists (select 1 from pg_temp.p4_http_response as r where r.id = a.post_request_id);
  end loop;
  perform pg_temp.wd();
  select count(*) into posts from pg_temp.p4_posts where body ->> 'text' like 'Room P4DEAD%';
  select * into al from pg_temp.p4_wd_alerts where id = dead;
  select * into st from pg_temp.p4_wd_status where worker = 'sales-api' and job = 'watchdog';
  perform pg_temp.ck('P4-0 the setup: Slack refused the alert''s posts and the watchdog stopped posting it',
    posts = 3 and al.post_status = 404,
    format('posts %s, post_status %s, post_error %s, post_tries %s, posted_at set %s',
           posts, al.post_status, al.post_error, al.post_tries, al.posted_at is not null));
  perform pg_temp.ck('P4-1 slack-webhook-refused-reads-as-posted: Slack refusing every post turns the watchdog''s own row red, or says #sales-alerts gets nothing',
    st.ok is false or st.detail ~* '(slack|#sales-alerts).*(refus|not reach|answered|did not)',
    format('the alert was given up after %s posts with "%s" on its row, and the watchdog''s row says ok %s: "%s"',
           posts, al.post_error, st.ok, st.detail));
end;
$$;

truncate pg_temp.p4_wd_alerts;
truncate pg_temp.p4_wd_status;
truncate pg_temp.p4_posts;
truncate pg_temp.p4_http_response;

-- P4-3 (fix round 4): Slack's 429 (about one post a second) is posted again
-- without using up a try, and is no refusal of the webhook.
do $$
declare
  busy uuid;
  i integer;
  posts integer;
  al record;
  st record;
begin
  insert into pg_temp.p4_wd_alerts (dedupe_key, source, kind, subject, message, detail)
  values ('stress2-providers-r4:busy', 'watchdog', 'room_mark_intro', 'Room P4BUSY',
          'Room P4BUSY: the booked intro was not marked a no-show. Mark it shown or a no-show.', '{}'::jsonb)
  returning id into busy;
  for i in 1..5 loop
    perform pg_temp.wd();
    insert into pg_temp.p4_http_response (id, status_code, error_msg, timed_out, content)
    select a.post_request_id, 429, null, false, 'rate_limited'
      from pg_temp.p4_wd_alerts as a
     where a.post_request_id is not null
       and not exists (select 1 from pg_temp.p4_http_response as r where r.id = a.post_request_id);
  end loop;
  perform pg_temp.wd();
  select count(*) into posts from pg_temp.p4_posts where body ->> 'text' like 'Room P4BUSY%';
  select * into al from pg_temp.p4_wd_alerts where id = busy;
  select * into st from pg_temp.p4_wd_status where worker = 'sales-api' and job = 'watchdog';
  perform pg_temp.ck('P4-3 a 429 is posted again without using a try, and the row stays green',
    posts >= 5 and al.post_tries < 3 and st.ok,
    format('posts %s, post_tries %s, posted_at set %s, row ok %s: %s', posts, al.post_tries, al.posted_at is not null, st.ok, st.detail));
end;
$$;

select name, ok, detail from pg_temp.p4_checks order by n;
"""

LEFTOVERS = r"""
select 'alert ' || id::text as what from public.cockpit_sales_alerts where dedupe_key like 'stress2-providers-r4:%'
"""


def watchdog_source(deployed: bool) -> str:
    """The watchdog's text as SQL: 20261004a's (fix round 4) while that file
    defines it, else (or with --deployed) the deployed one."""
    if not deployed:
        mig = open(os.path.join(os.path.dirname(HERE), "20261004a_live_calls_hardening_2.sql")).read()
        m = re.search(r"create or replace function public\.cockpit_sales_watchdog\(\)\n.*?\n\$\$;", mig, re.S)
        if m:
            text = m.group(0)
            if "$p4src$" in text:
                raise SystemExit("the watchdog's text holds the quote this script uses")
            return "$p4src$" + text + "$p4src$"
    return "pg_get_functiondef('public.cockpit_sales_watchdog()'::regprocedure)"


def compose(deployed: bool = False) -> str:
    copy = COPY.replace("%(watchdog)s", watchdog_source(deployed))
    sql = "\n".join(["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '60s';",
                     copy, ATTACK, "rollback;"])
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        raise SystemExit(f"Refusing to run: the composed SQL has transaction statements {tx}.")
    return sql


def main() -> None:
    before = run_checks.query(LEFTOVERS, write=False) or []
    if before:
        raise SystemExit(f"Synthetic rows exist before the run; not touching them: {[r['what'] for r in before]}")
    rows = run_checks.query(compose("--deployed" in sys.argv[1:]), write=True) or []
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    after = run_checks.query(LEFTOVERS, write=False) or []
    if after:
        print("LEFT BEHIND after the rollback:", [r["what"] for r in after])
        sys.exit(1)
    print("Nothing persisted: every synthetic row was rolled back.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
