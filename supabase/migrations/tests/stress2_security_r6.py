#!/usr/bin/env python3
"""Second series, round 6 (5 October 2026), angle: security and abuse. What
a Take does with a standby room whose code was opened before it had a lead.

    python3 supabase/migrations/tests/stress2_security_r6.py

The door answers a standby room's code (a room with no lead, its link sent
to nobody) with the closer's join link and records the open as "The lead
opened the link" (first_open_at, open_device, a door.open row): see
supabase/functions/sales-live/stress2_security_r6_door.test.ts. This run
checks what the database then does with it: cockpit_sales_live_claim adopts
that very row for the handed-over lead, and the rooms guard never lets an
open time be cleared, so the lead's handover room starts life "opened"
before its link was ever sent.

Safety: ONE transaction that ends in `rollback;` (lock_timeout 5 s), with
20261004a as it stands applied inside it (it is not applied in production
yet). Synthetic rows only (contact `stress-r6sec-*`, host
`stress-r6sec-*@stress.invalid`); no sweep, tick, watchdog or pg_net call is
made. Before and after, a read-only query proves nothing persisted. The
management token is read from SUPABASE_ACCESS_TOKEN or
~/.config/mahara/sb_mgmt_token and never printed. Each check prints PASS or
FAIL; a FAIL is a finding.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_checks  # noqa: E402
import stress2_security as s2  # noqa: E402  (query, token)

MIG2 = run_checks.strip_transaction(run_checks.HARDENING_2,
                                    open(os.path.join(run_checks.MIGRATIONS, run_checks.HARDENING_2)).read())
# Milestone 1 holds the handover claim shut while live.enabled is off
# (20261004a): the Take this run plays needs live on, as a manager turns it on.
from fence_switches import LIVE_ON, switches_on  # noqa: E402

CHECKS = r"""
create temp table s2r6 (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.s2r6 (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

do $t$
declare
  closer constant text := 'stress-r6sec-closer@stress.invalid';
  lead constant text := 'stress-r6sec-lead';
  sb uuid := gen_random_uuid();
  live uuid := gen_random_uuid();
  opened constant timestamptz := now() - interval '7 minutes';
  got record;
  r public.cockpit_sales_rooms;
begin
  -- 09:58: the closer is Available and sits in their standby room (Zoom,
  -- host_in). Its short link is opened (the closer tapping their own room's
  -- link, or anyone who guessed the code): the door wrote the open columns
  -- and its door.open row, as sales-live recordOpen does.
  insert into public.cockpit_sales_rooms
    (id, request_id, purpose, call_kind, provider, host_email, made_by, state, join_url, provider_meeting_id,
     opened_at, host_in_at, host_by, ends_at, first_open_at, last_open_at, open_device)
  values
    (sb, gen_random_uuid(), 'standby', 'demo', 'zoom', closer, closer, 'host_in',
     'https://us06web.zoom.us/j/85066600099?pwd=standby', '85066600099',
     now() - interval '15 minutes', now() - interval '14 minutes', now() + interval '1 hour', now() + interval '2 hours',
     opened, opened, 'phone');
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, text, detail)
  values (sb, 'door.open', 'door', 'open:' || sb::text || ':stress-r6sec', opened, opened,
          'The lead opened the link on a phone.', jsonb_build_object('device', 'phone', 'room_state', 'host_in'));

  -- 10:05: a setter offers a lead live; the closer takes it.
  insert into public.cockpit_sales_live (id, request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
  values (live, gen_random_uuid(), lead, 'stress-r6sec-setter@stress.invalid', 'demo', 'on_call',
          array[closer], now() + interval '2 minutes');

  select * into got from public.cockpit_sales_live_claim(live, closer, null, now());
  select * into r from public.cockpit_sales_rooms where id = sb;

  perform pg_temp.ck('control: the Take adopted the closer''s standby room for the lead (the fixture works)',
    got.claim_room = 'standby' and r.contact_id = lead and r.purpose = 'handover',
    format('claim_room=%s contact=%s purpose=%s', got.claim_room, r.contact_id, r.purpose));

  perform pg_temp.ck('standby-open-carried-into-handover: the adopted room carries no open from before it had a lead (first_open_at, last_open_at, open_device)',
    r.first_open_at is null and r.last_open_at is null and r.open_device is null,
    format('first_open_at=%s (%s min before the Take) last_open_at=%s open_device=%s link_sent_at=%s',
           r.first_open_at, round(extract(epoch from (now() - r.first_open_at)) / 60), r.last_open_at, r.open_device, r.link_sent_at));

  perform pg_temp.ck('standby-open-carried-into-handover: the handed-over lead''s room timeline has no "The lead opened the link" from before the lead was handed over',
    not exists (select 1 from public.cockpit_sales_room_events as e
                 where e.room_id = sb and e.kind = 'door.open' and e.at < coalesce(r.link_sent_at, now())),
    (select string_agg(to_char(e.at, 'HH24:MI:SS') || ' ' || e.text, '; ')
       from public.cockpit_sales_room_events as e where e.room_id = sb and e.kind = 'door.open'));

  -- The lead's own open after the Take is kept: the rooms guard never lets an
  -- open time be cleared once the room has a lead (fix round 6 clears only
  -- on the adoption itself).
  update public.cockpit_sales_rooms set first_open_at = now(), last_open_at = now() where id = sb;
  update public.cockpit_sales_rooms set first_open_at = null, last_open_at = null where id = sb;
  select * into r from public.cockpit_sales_rooms where id = sb;
  perform pg_temp.ck('note: the rooms guard never lets an open time be cleared (so only the door or the claim can keep it off)',
    r.first_open_at is not null, format('first_open_at after a clearing write: %s', r.first_open_at));
exception when others then
  perform pg_temp.ck('section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$t$;
"""

FINAL = "select name, ok, detail from pg_temp.s2r6 order by n;"

LEFTOVERS = r"""
select 'room ' || id from public.cockpit_sales_rooms where host_email like 'stress-r6sec-%'
union all select 'live ' || id from public.cockpit_sales_live where contact_id like 'stress-r6sec-%'
union all select 'event ' || id from public.cockpit_sales_room_events where dedupe_key like 'open:%:stress-r6sec'
"""


def compose() -> str:
    for word in ("\ncommit", "\nrollback", "\nbegin;", "\nabort", "\nstart transaction"):
        if word in CHECKS.lower():
            raise SystemExit(f"Refusing to run: the checks contain a transaction statement ({word.strip()}).")
    return "\n".join(["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '90s';",
                      MIG2, switches_on(LIVE_ON), CHECKS, FINAL, "rollback;"])


def main():
    before = s2.query(LEFTOVERS, write=False) or []
    if before:
        print("stress-r6sec rows exist before the run:", before)
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
    print("Nothing persisted: no stress-r6sec row is in any table the run touched.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
