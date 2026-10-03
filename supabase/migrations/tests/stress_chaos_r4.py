#!/usr/bin/env python3
"""Chaos round 4 for the live-calls database (3 October 2026), on the real
tables of Creative Triage, inside ONE transaction that always rolls back.

    python3 supabase/migrations/tests/stress_chaos_r4.py

Synthetic rows only (contact ids `stress-chaos-r4-*`, hosts
`chaos-r4-*@stress.invalid`, appointments `stress-chaos-r4-appt-*`). The
deployed functions are copied into pg_temp with only their outside doors
swapped (the stress_time.py technique), so the real settings row, the real
alerts, the vault and pg_net are never touched:

  - the sweep reads its settings from a temp table (rooms on, short links on,
    as at launch; today's real row has short_link false), writes its status
    row to a temp table and takes its own advisory lock, so the minute's
    real sweep never skips;
  - the watchdog reads and writes temp copies of the alerts, the worker
    status rows and the room events, posts through a temp stand-in for
    pg_net's net.http_post (it records the post and answers a request id),
    reads answers from a temp stand-in for net._http_response, reads its
    webhook from a temp stand-in for the vault, and runs as if inside
    working hours.

Everything is rolled back; nothing is posted (no pg_net row is ever made).

What it attacks
  R4-1. The lead's open of a Meet room's short link reached the door, which
        stored its door.open event and answered the join link, but its write
        of the room's first_open_at ran out of time (a slow database). The
        rep never pressed The lead is in (Meet sends no join signal). S1
        reads "the short link went and was never opened" from the room row
        alone and queues the booked intro to be marked a no-show: a hard
        number in B2B's show rate for a lead who opened the link.
  R4-2. HELD: the same room with no open anywhere is still queued.
  R4-3. pg_net's background worker stops (it has, after a database restart):
        net.http_post queues the watchdog's Slack post and no answer ever
        comes. The watchdog stamps posted_at when it queues the post and
        retries only on an answer that says it failed, so the alert counts
        as posted for ever: never retried, never flagged, and nobody in
        #sales-alerts hears of it. The same silence stops the sweep's posts
        (replays, settles, re-checks), whose alert is then lost the same way.
  R4-4. HELD: a post Slack refused (an answer, 500) is posted again.

Exit code 0 only when every check passed and nothing persisted.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402  (token handling and the management API call; never prints the token)

COPY = r"""
create temp table r4_settings (key text primary key, value jsonb not null) on commit drop;
insert into pg_temp.r4_settings (key, value)
select s.key, s.value || case s.key
         when 'rooms' then '{"enabled": true, "short_link": true, "providers": {"zoom": true, "meet": true}}'::jsonb
         else '{}'::jsonb end
  from public.cockpit_sales_settings as s where s.key in ('rooms', 'live');
create temp table r4_status (worker text, job text, ok boolean, detail text, at timestamptz,
                             primary key (worker, job)) on commit drop;

do $copy$
declare
  src text;
begin
  src := pg_get_functiondef('public.cockpit_sales_rooms_sweep()'::regprocedure);
  src := replace(src, 'CREATE OR REPLACE FUNCTION public.cockpit_sales_rooms_sweep()', 'CREATE FUNCTION pg_temp.r4_sweep()');
  src := replace(src, 'public.cockpit_sales_settings', 'pg_temp.r4_settings');
  src := replace(src, 'public.cockpit_sales_worker_status', 'pg_temp.r4_status');
  src := replace(src, 'hashtext(''cockpit_sales_rooms_sweep'')', 'hashtext(''stress_chaos_r4_sweep'')');
  if position('pg_temp.r4_sweep' in src) = 0 or position('pg_temp.r4_settings' in src) = 0
     or position('pg_temp.r4_status' in src) = 0 or position('stress_chaos_r4_sweep' in src) = 0 then
    raise exception 'The sweep copy did not take: the deployed function text changed shape.';
  end if;
  execute src;
end
$copy$;

-- The watchdog's outside doors, as temp stand-ins.
create temp table r4_wd_alerts (like public.cockpit_sales_alerts including all) on commit drop;
create temp table r4_wd_status (like public.cockpit_sales_worker_status including all) on commit drop;
create temp table r4_wd_events (like public.cockpit_sales_room_events including all) on commit drop;
create temp table r4_http_response (id bigint primary key, status_code integer, error_msg text, timed_out boolean) on commit drop;
create temp table r4_secrets (name text, decrypted_secret text) on commit drop;
insert into pg_temp.r4_secrets values ('sales_alerts_slack_webhook', 'https://hooks.slack.invalid/T0/B0/stress');
create temp table r4_posts (id bigint, url text, body jsonb) on commit drop;
create temp sequence r4_req_seq;

create function pg_temp.r4_http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
returns bigint language plpgsql as $$
declare
  i bigint := nextval('pg_temp.r4_req_seq');
begin
  insert into pg_temp.r4_posts (id, url, body) values (i, url, body);
  return i;
end;
$$;

do $copy$
declare
  src text;
begin
  src := pg_get_functiondef('public.cockpit_sales_alert_set(text, boolean, text, text, text, jsonb)'::regprocedure);
  src := replace(src, 'FUNCTION public.cockpit_sales_alert_set(', 'FUNCTION pg_temp.r4_alert_set(');
  src := replace(src, 'CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
  src := replace(src, 'public.cockpit_sales_alerts', 'pg_temp.r4_wd_alerts');
  if position('pg_temp.r4_alert_set' in src) = 0 or position('pg_temp.r4_wd_alerts' in src) = 0 then
    raise exception 'The alert_set copy did not take: the deployed function text changed shape.';
  end if;
  execute src;

  src := pg_get_functiondef('public.cockpit_sales_watchdog()'::regprocedure);
  src := replace(src, 'CREATE OR REPLACE FUNCTION public.cockpit_sales_watchdog()', 'CREATE FUNCTION pg_temp.r4_watchdog()');
  src := replace(src, 'public.cockpit_sales_alert_set(', 'pg_temp.r4_alert_set(');
  src := replace(src, 'public.cockpit_sales_alerts', 'pg_temp.r4_wd_alerts');
  src := replace(src, 'public.cockpit_sales_worker_status', 'pg_temp.r4_wd_status');
  src := replace(src, 'public.cockpit_sales_room_events', 'pg_temp.r4_wd_events');
  src := replace(src, 'public.cockpit_sales_alert_hours(now())', 'true');
  src := replace(src, 'net._http_response', 'pg_temp.r4_http_response');
  src := replace(src, 'net.http_post(', 'pg_temp.r4_http_post(');
  src := replace(src, 'vault.decrypted_secrets', 'pg_temp.r4_secrets');
  src := replace(src, 'hashtext(''cockpit_sales_watchdog'')', 'hashtext(''stress_chaos_r4_watchdog'')');
  if position('pg_temp.r4_watchdog' in src) = 0 or position('pg_temp.r4_http_post(' in src) = 0
     or position('pg_temp.r4_http_response' in src) = 0 or position('pg_temp.r4_secrets' in src) = 0
     or position('net.' in src) > 0 or position('vault.' in src) > 0
     or position('public.cockpit_sales_alerts' in src) > 0 or position('stress_chaos_r4_watchdog' in src) = 0 then
    raise exception 'The watchdog copy did not take: the deployed function text changed shape.';
  end if;
  execute src;
end
$copy$;
"""

CHAOS = r"""
create temp table chaos_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.chaos_checks (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

create function pg_temp.sweep()
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := pg_temp.r4_sweep();
  if r ? 'skipped' then
    raise exception 'chaos r4: the sweep copy held its own lock; run again';
  end if;
  return r;
end;
$$;

-- A Meet fallback room for the setter's own booked intro that started 25
-- minutes ago: the short link went by WhatsApp, nobody pressed The lead is
-- in, the room closed as "the lead did not join" ten minutes after the link.
create function pg_temp.meet_room(p_n integer)
returns uuid language plpgsql as $$
declare
  rid uuid;
  st timestamptz := now() - interval '25 minutes';
  appt text := 'stress-chaos-r4-appt-' || p_n;
  contact text := 'stress-chaos-r4-' || p_n;
  host text := 'chaos-r4-' || p_n || '@stress.invalid';
begin
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, calendar_id, call_type, start_at, booked_at, status, origin)
  values (appt, contact, 'stress-chaos-cal', 'intro', st, now() - interval '2 days', 'confirmed', 'ghl');
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, result, end_reason,
     join_url, provider_meeting_id, appointment_id, appointment_start_at,
     requested_at, claimed_at, opened_at, link_claimed_at, link_sent_at, link_channels,
     ends_at, ended_at)
  values (gen_random_uuid(), contact, 'fallback', 'intro', 'meet', host, host,
          'expired', 'no_join', 'lead_no_show', 'https://meet.google.com/aaa-bbbb-cc' || p_n, 'aaa-bbbb-cc' || p_n,
          appt, st,
          st - interval '1 minute', st - interval '59 seconds', st - interval '58 seconds', st - interval '57 seconds',
          st - interval '50 seconds', array['whatsapp_text'],
          st + interval '29 minutes', st + interval '10 minutes')
  returning id into rid;
  return rid;
end;
$$;

do $$
declare
  a uuid;
  b uuid;
  qa boolean;
  qb boolean;
  ra record;
  out jsonb;
begin
  a := pg_temp.meet_room(1);
  b := pg_temp.meet_room(2);
  -- Room a: the lead tapped the short link two minutes after it went. The
  -- door stored door.open (its first write) and answered the join link; its
  -- PATCH of first_open_at timed out, so the room row says never opened.
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, text, detail)
  values (a, 'door.open', 'door', 'stress-chaos-r4:open:1', now() - interval '23 minutes', now() - interval '23 minutes',
          'The lead opened the link on a phone.', jsonb_build_object('device', 'phone', 'room_state', 'open'));
  out := pg_temp.sweep();
  select exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || a::text) into qa;
  select exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || b::text) into qb;
  select * into ra from public.cockpit_sales_rooms where id = a;
  perform pg_temp.ck('R4-1 a Meet room whose short link the door saw opened (door.open stored, the room''s open time lost) is not queued to mark its intro a no-show',
    not qa, format('sweep.settle queued %s, settled_mark %s, first_open_at %s', qa, ra.settled_mark, ra.first_open_at));
  perform pg_temp.ck('R4-2 HELD: the same room with no open anywhere is queued to be settled',
    qb, format('sweep.settle queued %s', qb));
  perform pg_temp.ck('R4-0 the sweep copy ran with no rule failing',
    jsonb_array_length(coalesce(out -> 'errors', '[]'::jsonb)) = 0, coalesce((out -> 'errors')::text, 'none'));
end;
$$;

do $$
declare
  silent uuid;
  refused uuid;
  posts_silent integer;
  posts_refused integer;
  al record;
  w jsonb;
begin
  insert into pg_temp.r4_wd_alerts (dedupe_key, source, kind, subject, message, detail)
  values ('stress-chaos-r4:silent', 'watchdog', 'room_mark_intro', 'Room R4SLNT',
          'Room R4SLNT: the booked intro was not marked a no-show. Mark it shown or a no-show.', '{}'::jsonb)
  returning id into silent;
  w := pg_temp.r4_watchdog();
  if w ? 'skipped' then
    raise exception 'chaos r4: the watchdog copy held its own lock; run again';
  end if;
  -- pg_net never answers that post: its worker is down. Half an hour passes
  -- (every time on the alert moved back; now() stands still in a transaction).
  update pg_temp.r4_wd_alerts
     set posted_at = posted_at - interval '30 minutes', raised_at = raised_at - interval '30 minutes',
         last_seen_at = last_seen_at - interval '30 minutes'
   where id = silent;

  -- HELD: an alert whose post Slack answered 500 is posted again.
  insert into pg_temp.r4_wd_alerts (dedupe_key, source, kind, subject, message, detail)
  values ('stress-chaos-r4:refused', 'watchdog', 'room_mark_intro', 'Room R4RFSD',
          'Room R4RFSD: the booked intro was not marked a no-show. Mark it shown or a no-show.', '{}'::jsonb)
  returning id into refused;
  w := pg_temp.r4_watchdog();
  insert into pg_temp.r4_http_response (id, status_code, error_msg, timed_out)
  select a.post_request_id, 500, null, false from pg_temp.r4_wd_alerts as a where a.id = refused;
  w := pg_temp.r4_watchdog();

  select count(*) into posts_silent from pg_temp.r4_posts where body ->> 'text' like 'Room R4SLNT%';
  select count(*) into posts_refused from pg_temp.r4_posts where body ->> 'text' like 'Room R4RFSD%';
  select * into al from pg_temp.r4_wd_alerts where id = silent;
  perform pg_temp.ck('R4-3 an alert whose Slack post pg_net never answered (30 minutes, no answer row) is posted again or marked not posted',
    posts_silent >= 2 or al.posted_at is null or al.post_error is not null,
    format('posts %s, posted_at %s, post_status %s, post_error %s, post_tries %s',
           posts_silent, al.posted_at, al.post_status, al.post_error, al.post_tries));
  perform pg_temp.ck('R4-4 HELD: an alert whose post Slack answered 500 is posted again',
    posts_refused = 2, format('posts %s', posts_refused));
end;
$$;

select name, ok, detail from pg_temp.chaos_checks order by n;
"""

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms
 where contact_id like 'stress-chaos-r4-%' or host_email like 'chaos-r4-%@stress.invalid'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where dedupe_key like 'stress-chaos-r4:%'
union all
select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-chaos-r4-%'
union all
select 'alert ' || id::text from public.cockpit_sales_alerts where dedupe_key like 'stress-chaos-r4:%'
"""


def compose() -> str:
    sql = "\n".join(["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '90s';",
                     "-- ===== 20261003d (the repo's hardening, rolled back with the rest) =====",
                     run_checks.hardening_sql(), COPY, CHAOS, "rollback;"])
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        raise SystemExit(f"Refusing to run: the composed SQL has transaction statements {tx}.")
    return sql


def main() -> None:
    before = run_checks.query(LEFTOVERS, write=False) or []
    if before:
        raise SystemExit(f"Synthetic chaos rows exist before the run; not touching them: {[r['what'] for r in before]}")
    rows = None
    for attempt in range(3):
        try:
            rows = run_checks.query(compose(), write=True) or []
            break
        except SystemExit as e:
            if "held its own lock" in str(e) and attempt < 2:
                continue
            raise
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
