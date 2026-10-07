#!/usr/bin/env python3
"""TIME stress, round 4: whole days on a fake clock, the SQL itself.

    python3 supabase/migrations/tests/stress_time_r4.py            # every day below
    python3 supabase/migrations/tests/stress_time_r4.py overrun    # one day

The harness is round 2's (stress_time_day.py): ONE transaction per day that
ends in rollback, on temp copies (pg_temp) of the live-calls tables, the
deployed functions with migration 20261003d (the repo's) applied over them,
every now() read from a clock only this run moves, the watchdog's vault read
and Slack post sent to temp tables. Nothing touches a real row; after the run
a read-only query proves nothing of it is in public. Synthetic names only:
contacts 'stress-tday-{tag}-...', hosts '...@stress.invalid'.

The days:
  overrun   Thursday 19:00 to 21:20: a booked Meet demo (19:30 to 20:15) that
            runs to 21:10. The panel asks "Still on the call?" at 20:15 and
            the closer answers "Still on it" (the cockpit keeps that answer
            in the browser only; no request reaches sales-api).
  night     Thursday 20:45 to Saturday 09:15: the room worker stops at 20:52;
            its stale alert is raised after 21:00 and posted on Saturday
            morning, the first working hours.
  pauses    Saturday 09:55 to 15:10: the duplicate detector pauses every
            WhatsApp send twice in one day (sales-api index.ts
            duplicateWatch raises wa_duplicate:{the UTC date}); a manager
            clears the first pause at 13:00 on the Follow-ups page.

Exit 0 only when every check passed. A FAIL is a finding: its name says what
should hold, its detail what the day did.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_checks  # noqa: E402
import stress_time_day as std  # noqa: E402  (the round 2 harness: Day, compose, the actors)

lit, kw, ts, contact, email = std.lit, std.kw, std.ts, std.contact, std.email


# ---------------------------------------------------------------------------
# Thursday 8 October 2026, 19:00 to 21:20 (Kuwait): a booked demo that overruns
# ---------------------------------------------------------------------------

def overrun() -> std.Day:
    d = std.Day("Overrun", kw("2026-10-08 19:00:00"), kw("2026-10-08 21:20:00"))
    d.person("closer-o", "closer", auto_join=False)
    start, end = kw("2026-10-08 19:30:00"), kw("2026-10-08 20:15:00")
    d.booked("appt-o", "lead-o", "closer-o", start, kind="demo")
    # room.wrap at 19:25 (wrapPlan, wrapRoomRow): the booked call's own Meet
    # link, open, host_by start + 15, lead_by start + 20, ends_at its end.
    d.at(kw("2026-10-08 19:25:00"),
         "insert into pg_temp.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, "
         "made_by, appointment_id, send_on, state, opened_at, join_url, host_by, lead_by, ends_at) "
         f"values (gen_random_uuid(), {lit(contact('lead-o'))}, 'booked', 'demo', 'meet', {lit(email('closer-o'))}, "
         f"{lit(email('closer-o'))}, {lit(contact('appt-o'))}, 'open', 'open', pg_temp.sim_now(), "
         "'https://meet.google.com/abc-defg-hij', "
         f"{ts(start + std.timedelta(minutes=15))}, {ts(start + std.timedelta(minutes=20))}, {ts(end)})")
    # I'm in at 19:29; The lead is in at 19:35 (Meet sends no join signal: the closer's presses).
    d.at(kw("2026-10-08 19:29:00"), "update pg_temp.cockpit_sales_rooms set state = 'host_in' "
                                    f"where contact_id = {lit(contact('lead-o'))} and state = 'open'")
    d.at(kw("2026-10-08 19:35:00"), "update pg_temp.cockpit_sales_rooms set state = 'lead_in' "
                                    f"where contact_id = {lit(contact('lead-o'))} and state = 'host_in'")
    # 20:15 "Still on the call?", answered "Still on it" at 20:16, 20:26 and
    # 20:36 (RoomPanel asks again 10 minutes after each answer). Fix round 4:
    # the answer is room.mark still_on, which moves ends_at to ten minutes
    # from the answer (roomlogic.ts still_on: laterIso(ends_at, now + 600 s)),
    # so the sweep's R7 counts from the closer's last answer.
    for t in ("20:16:00", "20:26:00", "20:36:00"):
        d.at(kw(f"2026-10-08 {t}"),
             "update pg_temp.cockpit_sales_rooms set ends_at = greatest(ends_at, pg_temp.sim_now() + interval '10 minutes') "
             f"where contact_id = {lit(contact('lead-o'))} and state = 'lead_in'")
    d.run(d.start, d.end)

    room = (f"(select r from pg_temp.cockpit_sales_rooms as r where r.contact_id = {lit(contact('lead-o'))} "
            "order by r.requested_at limit 1)")
    at = lambda t: (f"(select l.live_rooms::text || ' ' || coalesce(l.presence, '-') || '/' || coalesce(l.why, '-') "  # noqa: E731
                    f"from pg_temp.sim_log as l where l.email = {lit(email('closer-o'))} and l.t = {ts(t)})")
    d.check("control: at 20:44 the demo's room still has the lead in it",
            f"(select l.live_rooms @> '[{{\"state\": \"lead_in\"}}]' from pg_temp.sim_log as l "
            f"where l.email = {lit(email('closer-o'))} and l.t = {ts(kw('2026-10-08 20:44:00'))})",
            at(kw("2026-10-08 20:44:00")))
    d.check("a demo the closer said is still on (Still on it, three times) keeps its room while the call runs: "
            "at 20:50 and 21:05 the room still has the lead in it, not ended no_end_signal at 20:46",
            "(select bool_and(l.live_rooms @> '[{\"state\": \"lead_in\"}]') from pg_temp.sim_log as l "
            f"where l.email = {lit(email('closer-o'))} and l.t in ({ts(kw('2026-10-08 20:50:00'))}, "
            f"{ts(kw('2026-10-08 21:05:00'))}))",
            f"({room}).state || '/' || coalesce(({room}).end_reason, '-') || ' ended ' || "
            f"coalesce(to_char(({room}).ended_at at time zone 'Asia/Kuwait', 'HH24:MI:SS'), '-') || "
            f"' | 20:50 ' || {at(kw('2026-10-08 20:50:00'))}")
    d.check("the closer reads as on a call for the whole demo (19:35 to 21:05), never away or available mid-call",
            f"not exists (select 1 from pg_temp.sim_log as l where l.email = {lit(email('closer-o'))} "
            f"and l.t >= {ts(kw('2026-10-08 19:35:00'))} and l.t <= {ts(kw('2026-10-08 21:05:00'))} "
            "and coalesce(l.presence, 'away') <> 'on_call')",
            "(select string_agg(to_char(l.t at time zone 'Asia/Kuwait', 'HH24:MI') || '=' || coalesce(l.presence, '-'), ' ') "
            f"from pg_temp.sim_log as l where l.email = {lit(email('closer-o'))} "
            f"and l.t >= {ts(kw('2026-10-08 19:35:00'))} and l.t <= {ts(kw('2026-10-08 21:05:00'))} "
            "and coalesce(l.presence, 'away') <> 'on_call')")
    return d


# ---------------------------------------------------------------------------
# Thursday 20:45 to Saturday 09:15 (Kuwait): an alert raised at night
# ---------------------------------------------------------------------------

def night() -> std.Day:
    d = std.Day("Night", kw("2026-10-08 20:45:00"), kw("2026-10-10 09:15:00"))
    # The room worker's last status row: Thursday 20:52 (it stops after it).
    d.at(kw("2026-10-08 20:52:00"),
         "insert into pg_temp.cockpit_sales_worker_status (worker, job, ok, detail, at) "
         "values ('sales-desk', 'rooms', true, 'Rooms run: nothing to make.', pg_temp.sim_now()) "
         "on conflict (worker, job) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at")
    d.at(kw("2026-10-08 20:52:00"),
         "insert into pg_temp.cockpit_sales_worker_status (worker, job, ok, detail, at) "
         "values ('sales-desk', 'room-hosts', true, 'Hosts checked.', pg_temp.sim_now()) "
         "on conflict (worker, job) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at")
    # Every five minutes: the sweep and the watchdog (the harness runs the watchdog on :00 and :05).
    d.run(d.start, d.end, step_s=300)

    posts = ("(select string_agg(to_char(p.at at time zone 'Asia/Kuwait', 'Dy HH24:MI') || ' ' || (p.body ->> 'text'), ' | ') "
             "from pg_temp.fake_posts as p where p.body ->> 'text' ~* 'room worker has not run')")
    d.check("setup: the room worker's stale alert was raised Thursday night and posted on Saturday at 09:00",
            "exists (select 1 from pg_temp.fake_posts as p where p.body ->> 'text' ~* 'room worker has not run' "
            f"and p.at >= {ts(kw('2026-10-10 09:00:00'))})",
            f"coalesce({posts}, 'no post') || ' alerts: ' || coalesce((select string_agg(a.dedupe_key || ' raised ' || "
            "to_char(a.raised_at at time zone 'Asia/Kuwait', 'Dy HH24:MI'), '; ') from pg_temp.cockpit_sales_alerts as a), 'none')")
    d.check("posted on Saturday, the alert says which day the worker last ran (Thursday 8 Oct), not a bare 20:52 "
            "that reads as Friday night",
            "exists (select 1 from pg_temp.fake_posts as p where p.body ->> 'text' ~* 'room worker has not run' "
            f"and p.at >= {ts(kw('2026-10-10 09:00:00'))} and p.body ->> 'text' ~* '(thu|8 oct)')",
            f"coalesce({posts}, 'no post')")
    return d


# ---------------------------------------------------------------------------
# Saturday 10 October 09:55 to 15:10 (Kuwait): two WhatsApp pauses in one day
# ---------------------------------------------------------------------------

PAUSED = ("WhatsApp sends are paused: two identical messages went to one lead within 60 seconds, so the WA "
          "Connector may still be on. A manager clears the pause under Follow-ups, How it works, once only one copy goes.")


def pause_key() -> str:
    """The pause's own time, as sales-api writes it (fix round 4): the key is
    wa_duplicate: and dup_paused_at (new Date().toISOString())."""
    return "'wa_duplicate:' || to_char(pg_temp.sim_now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"


def pause_sql() -> str:
    """sales-api index.ts duplicateWatch's alert: one alert per pause."""
    return (f"select pg_temp.cockpit_sales_alert_set({pause_key()}, true, 'wa_duplicate', 'WhatsApp paused', {lit(PAUSED)}, "
            f"jsonb_build_object('contact_id', {lit(contact('dup-lead'))}))")


def clear_sql(paused_at: str) -> str:
    """The manager's "Clear the pause" (sales-api whatsapp.guard save, fix
    round 4): the pause's open alert is resolved with it."""
    return ("select pg_temp.cockpit_sales_alert_set('wa_duplicate:' || to_char("
            f"{ts(kw(paused_at))} at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), false, 'wa_duplicate', null, null, null)")


def pauses() -> std.Day:
    d = std.Day("Pauses", kw("2026-10-10 09:55:00"), kw("2026-10-10 15:10:00"))
    d.at(kw("2026-10-10 10:00:00"), pause_sql())
    # 13:00 a manager presses "Clear the pause" (whatsapp_guard.dup_paused_at
    # null, sendrules.ts whatsappGuardValue), which resolves its alert.
    # 15:00 the detector pauses WhatsApp again (another doubled send).
    d.at(kw("2026-10-10 13:00:00"), clear_sql("2026-10-10 10:00:00"))
    d.at(kw("2026-10-10 15:00:00"), pause_sql())
    d.run(d.start, d.end, step_s=300)
    posts = ("(select string_agg(to_char(p.at at time zone 'Asia/Kuwait', 'HH24:MI'), ', ') from pg_temp.fake_posts as p "
             "where p.body ->> 'text' ~* 'WhatsApp sends are paused')")
    d.check("setup: the first pause (10:00) reached #sales-alerts",
            "exists (select 1 from pg_temp.fake_posts as p where p.body ->> 'text' ~* 'WhatsApp sends are paused' "
            f"and p.at < {ts(kw('2026-10-10 11:00:00'))})",
            f"coalesce({posts}, 'no post')")
    d.check("the second pause the same day (15:00, after a manager cleared the first) reaches #sales-alerts too: "
            "every WhatsApp send is stopped again",
            "exists (select 1 from pg_temp.fake_posts as p where p.body ->> 'text' ~* 'WhatsApp sends are paused' "
            f"and p.at >= {ts(kw('2026-10-10 15:00:00'))})",
            f"'posts at ' || coalesce({posts}, 'none') || '; alerts: ' || coalesce((select string_agg(a.dedupe_key || "
            "' posted ' || coalesce(to_char(a.posted_at at time zone 'Asia/Kuwait', 'HH24:MI'), 'never') || ' last seen ' || "
            "to_char(a.last_seen_at at time zone 'Asia/Kuwait', 'HH24:MI'), '; ') from pg_temp.cockpit_sales_alerts as a "
            "where a.kind = 'wa_duplicate'), 'none')")
    return d


DAYS = {"overrun": overrun, "night": night, "pauses": pauses}


def main() -> None:
    names = sys.argv[1:] or list(DAYS)
    failed_total = 0
    for name in names:
        day = DAYS[name]()
        rows = run_checks.query(std.compose(day), write=True) or []
        failed = [r for r in rows if not r.get("ok")]
        failed_total += len(failed) + (0 if rows else 1)
        print(f"== {day.name} (run tag {std.TAG}): {len(rows) - len(failed)} passed, {len(failed)} failed")
        for r in rows:
            print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}  ({r.get('detail')})")
    left = run_checks.query(std.LEFTOVERS, False) or []
    if left:
        print("LEFT BEHIND after the rollback:", [x["what"] for x in left])
        sys.exit(2)
    print("Nothing persisted: the run used temp copies only and rolled back.")
    sys.exit(0 if not failed_total else 1)


if __name__ == "__main__":
    main()
