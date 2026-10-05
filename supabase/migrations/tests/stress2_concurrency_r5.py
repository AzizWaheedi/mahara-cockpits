#!/usr/bin/env python3
"""Second series, round 5: concurrency and idempotency against the REAL
live-calls tables on Creative Triage (20261003a, b, c and d applied, dark:
every switch off, rooms.test_only true). 20261004a is not applied in
production yet, so the sweep it makes runs inside each check's own
rolled-back transaction, as stress2_concurrency.py does.

    python3 supabase/migrations/tests/stress2_concurrency_r5.py                    # every check
    python3 supabase/migrations/tests/stress2_concurrency_r5.py join_before_press  # one, by name

What is new here
  - join_before_press: Zoom's two joins and "That was not the lead" in the
    order they really arrive. The lead's assistant joins at 10:02 (the panel
    says the lead is in), Huda herself at 10:03, and the setter presses
    "That was not the lead" at 10:03:10 about the assistant; Huda's join is
    read (late, or re-applied by round 4's laterJoinStands) and the room is
    lead_in on her 10:03 join. Every rule in the sweep reads "a join that
    stands" as lead_in_at > count_undo_at, and 10:03 is before the 10:03:10
    press, so when her intro ends the room reads as "nobody joined": S1 posts
    the settle that marks her booked intro a no-show (sales-api's own half
    is stress2_concurrency_r5_later_join.test.ts). The control is the same
    room with her join after the press, which S1 must leave alone.
  - slot_room_and_rep_100: the message slot (20261004a's, a pg_temp copy on
    each caller's connection) under 100 callers at once on one lead: the
    room's link going on its two WhatsApp lanes (free text and the call_link
    template) while 98 tabs and seats send the lead the same snippet. One
    row for the snippet, one template, the free link once.

Synthetic rows only: contact and appointment ids start with this run's
'stress-' prefix, every host and sender email ends with '@stress.invalid';
the sweep check runs inside a transaction that rolls back (its pg_net posts,
its audit rows and its settle events go with it), started between second 4
and 38 of a minute so the cron sweep (at :00) is not holding the sweep's
lock. The slot check deletes exactly the message rows it made.

Exit code 0 only when every check held and nothing synthetic is left.
"""
import json
import os
import secrets
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stress2_concurrency as s2  # noqa: E402  (q, burst, lit, in_window, _MIG2, SLOT_V2)

lit, q, in_window = s2.lit, s2.q, s2.in_window
RUN = "stress-s2c5-" + secrets.token_hex(4)
HOST = "@stress.invalid"
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail else ""))


def cleanup():
    q(f"delete from public.cockpit_sales_messages where contact_id like '{RUN}-%';")


def leftovers():
    return q(f"""
      select (select count(*) from public.cockpit_sales_messages where contact_id like '{RUN}-%') as messages,
             (select count(*) from public.cockpit_sales_rooms where contact_id like '{RUN}-%') as rooms,
             (select count(*) from public.cockpit_sales_appointments where appointment_id like '{RUN}-%') as appointments,
             (select count(*) from public.cockpit_sales_room_events where dedupe_key like '%{RUN}%') as events
    """, write=False)[0]


# ---------------------------------------------------------------------------
# A join before the press, read as taken back, settled as a no-show
# ---------------------------------------------------------------------------

def ended_intro_room(tag: str, huda_after_press_s: int) -> str:
    """One Zoom fallback room for a booked intro, ended after a 25-minute
    call, with the assistant's join taken back and Huda's join standing at
    `huda_after_press_s` seconds after the press (negative: before it)."""
    contact = f"{RUN}-{tag}-lead"
    appt = f"{RUN}-{tag}-intro"
    meeting = str(81234500000 + secrets.randbelow(99999))
    return f"""
      insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, calendar_id, start_at, status, assigned_user_id, booked_at, origin)
      values ({lit(appt)}, {lit(contact)}, 'intro', 'stress-calendar', now() - interval '30 minutes', 'confirmed', 'G-stress',
              now() - interval '2 days', 'b2b');
      with r as (
        insert into public.cockpit_sales_rooms
          (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, appointment_id, appointment_start_at,
           state, result, end_reason, join_url, provider_meeting_id, requested_at, claimed_at, opened_at, host_in_at,
           link_sent_at, link_claimed_at, link_channels, lead_in_at, lead_in_seen_at, count_undo_at, taken_back_join_at, ended_at)
        values ({lit(str(uuid.uuid4()))}, {lit(contact)}, 'fallback', 'no_answer', 'intro', 'zoom', {lit(f'{RUN}-{tag}-host{HOST}')},
                {lit(f'{RUN}-{tag}-host{HOST}')}, {lit(appt)}, now() - interval '30 minutes',
                'ended', 'no_join', 'finished', {lit(f'https://us06web.zoom.us/j/{meeting}?pwd=stress')}, {lit(meeting)},
                now() - interval '29 minutes', now() - interval '29 minutes', now() - interval '29 minutes', now() - interval '28 minutes',
                now() - interval '29 minutes', now() - interval '29 minutes', '{{whatsapp_text}}',
                now() - interval '26 minutes' + make_interval(secs => {huda_after_press_s}),
                now() - interval '26 minutes' + make_interval(secs => {max(huda_after_press_s, 0)}),
                now() - interval '26 minutes',
                -- The assistant's join the press took back, 70 s before the press
                -- (sales-api's notLead writes it as the press lands, 20261004a).
                now() - interval '26 minutes' - interval '70 seconds', now() - interval '1 minute')
        returning id)
      insert into s5_rooms (tag, id) select {lit(tag)}, id from r;
      insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, text, detail)
      select id, 'zoom.meeting.started', 'zoom', {lit(f'zoom:meeting.started:{meeting}:{RUN}')}, now() - interval '28 minutes',
             now() - interval '28 minutes', 'Zoom: the meeting started.',
             jsonb_build_object('event', 'meeting.started', 'payload', jsonb_build_object('object', jsonb_build_object('id', {lit(meeting)})))
        from s5_rooms where tag = {lit(tag)};
    """


def t_join_before_press():
    """Huda joined 10 s before the press that took her assistant's join back
    (her join stands: the room was lead_in on it until the call ended).
    The sweep must not post the settle that marks her intro a no-show. The
    control (her join 5 s after the press) is left alone today too."""
    in_window()
    sql = ("begin;\n" + s2._MIG2 + "\n"
           "create temp table s5_rooms (tag text, id uuid) on commit drop;\n"
           + ended_intro_room("before", -10)
           + ended_intro_room("after", 5) +
           "create temp table s5_out (step text, v text) on commit drop;\n"
           "insert into s5_out select 'sweep_skipped', (r ? 'skipped')::text from (select public.cockpit_sales_rooms_sweep() as r) as s;\n"
           "insert into s5_out select 'settle_posted_' || k.tag, (count(e.id) > 0)::text\n"
           "  from s5_rooms as k left join public.cockpit_sales_room_events as e\n"
           "    on e.room_id = k.id and e.kind = 'sweep.settle' group by k.tag;\n"
           "insert into s5_out select 'lead_joined_reads_' || k.tag,\n"
           "  public.cockpit_sales_room_join_stands(r.lead_in_at, r.count_undo_at, r.taken_back_join_at)::text\n"
           "  from s5_rooms as k join public.cockpit_sales_rooms as r on r.id = k.id;\n"
           "select step, v from s5_out order by step;\n"
           "rollback;")
    rows = q(sql) or []
    got = {r["step"]: r["v"] for r in rows}
    ran = got.get("sweep_skipped") == "false"
    check("control: Huda's join 5 s after the press stands, and S1 posts no settle for her room",
          ran and got.get("settle_posted_after") == "false", json.dumps(got) + ("" if ran else " (the cron sweep held the lock; run again)"))
    check("join-before-press-read-as-taken-back: Huda's join 10 s before the press (the press was about her assistant) "
          "stands, so the sweep posts no settle that marks her attended intro a no-show",
          ran and got.get("settle_posted_before") == "false",
          json.dumps(got) + ("" if ran else " (the cron sweep held the lock; run again)"))


# ---------------------------------------------------------------------------
# The message slot: a room's link on both WhatsApp lanes beside 98 snippet sends
# ---------------------------------------------------------------------------

def t_slot_room_and_rep_100():
    lead = f"{RUN}-slot-lead"
    snippet = "Hi Huda, here is the link for our call. Join when you are ready."
    b = s2.day_bounds()
    lim = {"sender_max": 30, "sender_window_s": 600, "lead_gap_s": 120, "per_day": 1_000_000, "month_cap": 1_000_000,
           "day_start": b["d"], "month_start": b["m"], "dup_window_s": 60}
    rows = []
    # The room's link on its two lanes (one request id each, as rooms.ts linkKeys makes them).
    rows.append({"request_id": str(uuid.uuid4()), "contact_id": lead, "channel": "whatsapp", "via": "conversation",
                 "body": "Your call link: https://us06web.zoom.us/j/81234500099", "source": "room", "sent_by": f"{RUN}-host{HOST}"})
    rows.append({"request_id": str(uuid.uuid4()), "contact_id": lead, "channel": "whatsapp", "via": "workflow",
                 "template_key": "call_link_ar", "body": "call_link", "source": "room", "sent_by": f"{RUN}-host{HOST}"})
    # 98 tabs and seats, each its own request id, the same snippet with spacing and case moved about.
    for i in range(98):
        body = snippet if i % 3 == 0 else (snippet.upper() if i % 3 == 1 else "  " + snippet.replace(" ", "​ ") + " ")
        rows.append({"request_id": str(uuid.uuid4()), "contact_id": lead, "channel": "whatsapp", "via": "conversation",
                     "body": body, "source": "rep", "sent_by": f"{RUN}-seat{i % 7}{HOST}"})
    sqls = [s2.slot_sql(r, lim, v2=True) for r in rows]
    try:
        out = s2.hundred(sqls)
        codes = s2.codes_of(out)
        tally = s2.tally(codes)
        made = q(f"select via, source, count(*)::int as n from public.cockpit_sales_messages where contact_id = {lit(lead)} "
                 "group by via, source order by via, source", write=False)
        by = {(m["via"], m["source"]): int(m["n"]) for m in made}
        check("slot_room_and_rep_100: 100 callers at once on one lead: the room's free link once, its template once, "
              "the snippet once, every other caller told same_words (never an error)",
              by == {("conversation", "room"): 1, ("workflow", "room"): 1, ("conversation", "rep"): 1}
              and tally.get("same_words", 0) == 97 and not any(c.startswith("error") for c in codes),
              json.dumps({"rows": {f"{k[0]}/{k[1]}": v for k, v in by.items()}, "codes": tally}))
    finally:
        cleanup()


CHECKS = {
    "join_before_press": t_join_before_press,
    "slot_room_and_rep_100": t_slot_room_and_rep_100,
}


def main():
    names = sys.argv[1:] or list(CHECKS)
    try:
        s2.run_all(CHECKS, names, RESULTS, cleanup)
    finally:
        cleanup()
    left = leftovers()
    clean = all(int(v) == 0 for v in left.values())
    print(f"{'PASS' if clean else 'FAIL'}  nothing synthetic left: {json.dumps(left)}")
    failed = [r for r in RESULTS if not r[1]]
    sys.exit(0 if clean and not failed else 1)


if __name__ == "__main__":
    main()
