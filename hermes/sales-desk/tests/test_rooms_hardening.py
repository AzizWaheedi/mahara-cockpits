"""The room worker after the adversarial review (2026-10-03): one test or
more per fix, on the same fakes as test_rooms.py (nothing reaches the
network), and a harsher stress run: every provider and the database failing
and hanging at random, sales-api slow and refusing, and a run by hand landing
in the middle of a cron run.

    python3 -m unittest tests.test_rooms_hardening -v
"""
from __future__ import annotations

import json
import os
import random
import unittest
import urllib.parse
from typing import Any
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http  # noqa: E402
from desk import rooms  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests.test_rooms import CLOSER, SETTER, T0, Clock, Env, RoomsCase, rid  # noqa: E402


def opened_after(env: Env, n: int) -> float:
    row = env.room(n)
    return rooms.parse_ts(row["opened_at"]) - rooms.parse_ts(row["requested_at"])


def flaky_pg(env: Env, rule):
    """Route the fake database through `rule(method, url, real)`."""
    real = env.pg.__call__

    def call(method, url, **kw):
        return rule(method, urllib.parse.unquote(url), lambda: real(method, url, **kw))

    env.net.pg = call  # type: ignore[assignment]


# ---- finding 1: one provider's outage never stops the other ---------------------


class Breakers(unittest.TestCase):
    def test_two_slow_failures_in_a_minute_open_it_for_thirty_seconds(self):
        clock = Clock()
        b = rooms.Breaker("Zoom", clock)
        b.failed()
        self.assertFalse(b.blocked())
        clock.advance(59)
        b.failed()
        self.assertTrue(b.blocked())
        clock.advance(rooms.BREAK_FOR)
        self.assertFalse(b.blocked())         # one call may go through
        b.failed()
        self.assertTrue(b.blocked())          # and a slow one shuts it again at once
        clock.advance(rooms.BREAK_FOR)
        b.answered()
        b.failed()
        self.assertFalse(b.blocked())         # an answer clears the count

    def test_a_fast_failure_or_any_answer_never_counts(self):
        clock = Clock()
        send = rooms.Sender(clock, clock.sleep)
        b = rooms.Breaker("Zoom", clock)
        calls = []

        def fast(method, url, **kw):
            calls.append(url)
            raise HttpError(0 if len(calls) % 2 else 503, "ConnectionResetError: reset", b"", url)

        with mock.patch.object(http, "request", fast):
            for _ in range(4):
                with self.assertRaises(rooms.ProviderError):
                    send("GET", "https://api.zoom.us/v2/users/x", breaker=b, retries=0)
        self.assertFalse(b.blocked())
        self.assertEqual(b.trips, 0)


class ProviderOutage(RoomsCase):
    def test_a_google_that_hangs_mid_wait_does_not_hold_a_zoom_room(self):
        self.env.google.ready_after = None
        self.env.add_room(1, provider="meet", requested_at=rooms.iso(T0 - 0.5))
        self.env.clock.at(T0 + 2.0, lambda: setattr(self.env.google, "latency", 30.0))
        self.env.clock.at(T0 + 3.0, lambda: self.env.add_room(2, host_email=CLOSER, requested_at=rooms.iso(T0 + 3.0)))
        self.env.worker().run(seconds=57)
        self.assertEqual(self.env.room(2)["state"], "open")
        self.assertLess(opened_after(self.env, 2), 15.0)
        row = self.env.room(1)
        self.assertEqual((row["state"], row["error"]), ("failed", rooms.SAY["google_down"]))
        # Failed after two timed-out reads, not after the 30 s wait.
        self.assertLess(rooms.parse_ts(row["ended_at"]) - (T0 + 2.0), 2 * rooms.READ_TIMEOUT + 2.0)

    def test_a_provider_that_is_down_fails_new_rooms_at_once_without_calling_it(self):
        w = self.env.worker()
        w.zoom.breaker.open_until = T0 + 25  # type: ignore[union-attr]
        self.env.add_room(1)
        self.env.add_room(2, provider="meet", host_email=CLOSER)
        self.env.google.ready_after = 0
        w.run(seconds=3)
        self.assertEqual((self.env.room(1)["state"], self.env.room(1)["error"]), ("failed", rooms.SAY["zoom_down"]))
        self.assertEqual([c for c in self.env.zoom.calls], [])
        self.assertEqual(self.env.room(2)["state"], "open")
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIs(row["ok"], False)
        self.assertIn("Zoom is not answering, so new Zoom rooms fail at once until it answers again.", row["detail"])

    def test_one_lost_room_and_one_zoom_close_a_tick_and_new_rooms_first(self):
        for n in (1, 2, 3):
            self.env.add_room(n, provider="meet", state="creating", worker_run="run-dead", version=2,
                              host_email=f"rep{n}@example.test",
                              requested_at=rooms.iso(T0 - 91), claimed_at=rooms.iso(T0 - 90))
        for n in (4, 5):
            m = self.env.zoom._make("zu-setter", {"topic": f"Mahara call CLOSE{n}"})
            self.env.add_room(n, state="expired", provider_meeting_id=str(m["id"]), ended_at=rooms.iso(T0 - 5),
                              host_email=f"rep{n}@example.test")
            self.env.pg.put(rooms.SECRETS, {"room_id": rid(n), "start_url": m["start_url"], "expires_at": None})
        self.env.add_room(6, host_email=CLOSER)
        self.env.worker().run(seconds=0)
        self.assertEqual(self.env.room(6)["state"], "open")
        adopted = [n for n in (1, 2, 3) if self.env.room(n)["worker_run"] == "run-a"]
        self.assertEqual(len(adopted), 1)
        self.assertEqual(self.env.zoom.count("DELETE", "/meetings/"), 1)
        order = [u for _t, m, u, _to, _r in self.env.net.log if m == "PATCH" and "cockpit_sales_rooms?" in u]
        self.assertIn(rooms.http.quote(rid(6)), order[0])  # the new room was claimed before anything else


# ---- finding 2: the room.event call -------------------------------------------------


class SalesApiCall(RoomsCase):
    def test_one_short_call_with_no_retry_whatever_the_answer(self):
        for status in (0, 503, 429):
            env = Env()
            with mock.patch.object(http, "request", env.net):
                env.api.script = [status] if status else []
                env.api.latency = 30.0 if status == 0 else 0.0
                env.add_room()
                env.worker().run(seconds=10)
                calls = [x for x in env.net.log if "/functions/v1/sales-api" in x[2]]
                self.assertEqual(len(calls), 1, status)
                self.assertLessEqual(calls[0][3], rooms.NOTIFY_TIMEOUT)
                self.assertEqual(calls[0][4], 0)


# ---- finding 3: lost answers and the stored event -----------------------------------


class StoredEvent(RoomsCase):
    def test_the_ready_event_is_stored_before_the_room_opens(self):
        self.env.add_room()
        self.tick(self.env.worker())
        writes = [(m, u) for m, u in self.env.pg.calls if m != "GET"]
        stored = next(i for i, (m, u) in enumerate(writes) if m == "POST" and rooms.EVENTS in u)
        opened = next(i for i, (m, u) in enumerate(writes) if m == "PATCH" and "state=eq.creating&worker_run" in u)
        self.assertLess(stored, opened)

    def test_an_open_write_whose_answer_never_came_is_read_again(self):
        def rule(method, url, real):
            if method == "PATCH" and "state=eq.creating&worker_run=eq." in url:
                real()
                raise HttpError(0, "TimeoutError: timed out", b"", url)
            return real()

        flaky_pg(self.env, rule)
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(self.env.api.kinds(rid(1)), ["worker.ready"])

    def test_a_room_never_opens_without_its_stored_event(self):
        state = {"n": 0}

        def rule(method, url, real):
            if method == "POST" and rooms.EVENTS in url and "worker.ready" in json.dumps(state) + "x" and state["n"] == 0:
                state["n"] += 1
                raise HttpError(503, "busy", b"", url)
            return real()

        flaky_pg(self.env, rule)
        self.env.add_room()
        self.env.worker().run(seconds=4)
        row = self.env.room()
        self.assertEqual(row["state"], "open")
        self.assertIsNotNone(self.env.pg.one(rooms.EVENTS, dedupe_key=f"worker.ready:{rid(1)}"))
        self.assertEqual(len(self.env.zoom.meetings), 1)       # the meeting it made, read again by its id
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 1)
        self.assertEqual(self.env.api.kinds(rid(1)), ["worker.ready"])


# ---- finding 4: never end a room with a lead in it (H7) ------------------------------


class NeverEndALeadsRoom(RoomsCase):
    def expired(self, **over: Any) -> str:
        m = self.env.zoom._make("zu-setter", {"topic": "Mahara call LOST01"})
        self.env.zoom.meetings[str(m["id"])]["status"] = "started"
        self.env.add_room(1, **{"code": "LOST01", "state": "expired", "provider_meeting_id": str(m["id"]),
                                "host_in_at": rooms.iso(T0 - 700), "ended_at": rooms.iso(T0 - 2), **over})
        self.env.pg.put(rooms.SECRETS, {"room_id": rid(1), "start_url": m["start_url"], "expires_at": None})
        return str(m["id"])

    def test_a_started_meeting_with_the_lead_in_it_is_left_open_and_alerted(self):
        mid = self.expired()
        host = {"id": "zu-setter", "user_name": "Host", "email": SETTER}
        lead = {"id": "", "user_name": "Invented Lead", "email": ""}
        self.env.zoom.participants[mid] = [host, lead]
        w = self.env.worker()
        w.run(seconds=20)
        self.assertIn(mid, self.env.zoom.meetings)
        self.assertEqual(self.env.zoom.meetings[mid]["status"], "started")
        self.assertEqual(self.env.zoom.count("PUT", f"/meetings/{mid}/status"), 0)
        self.assertEqual(self.env.zoom.count("DELETE", f"/meetings/{mid}"), 0)
        self.assertIsNotNone(self.env.pg.one(rooms.SECRETS, room_id=rid(1)))
        alert = self.env.pg.one(rooms.ALERTS, dedupe_key=f"room_held:{rid(1)}")
        self.assertIsNotNone(alert)
        self.assertIn("1 person outside the team is still in its Zoom meeting", alert["message"])
        self.assertNotIn("Invented Lead", json.dumps(self.env.pg.rows(rooms.ALERTS)))
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIs(row["ok"], False)
        # Checked once a minute, not every tick.
        self.assertEqual(len([c for c in self.env.zoom.calls if "participants" in c[1]]), 1)
        # The lead leaves: the next look ends and deletes it, and the alert clears.
        lead["leave_time"] = rooms.iso(self.env.clock())
        self.env.clock.advance(rooms.HOLD_RECHECK_S)
        w2 = self.env.worker("run-b")
        w2._held.add(rid(1))  # the same incident, as the next run would find it in the alerts
        w2.run(seconds=3)
        self.assertNotIn(mid, self.env.zoom.meetings)
        self.assertIsNone(self.env.pg.one(rooms.SECRETS, room_id=rid(1)))
        self.assertIsNone(self.env.pg.one(rooms.ALERTS, dedupe_key=f"room_held:{rid(1)}"))

    def test_when_zoom_will_not_say_who_is_in_it_the_meeting_is_left_open(self):
        mid = self.expired()
        self.env.zoom.participants_api = False
        self.env.worker().run(seconds=0)
        self.assertEqual(self.env.zoom.meetings[mid]["status"], "started")
        self.assertEqual(self.env.zoom.count("PUT", f"/meetings/{mid}/status"), 0)
        alert = self.env.pg.one(rooms.ALERTS, dedupe_key=f"room_held:{rid(1)}")
        self.assertIn("Zoom would not say who is in it", alert["message"])

    def test_only_the_team_inside_is_ended_and_deleted(self):
        mid = self.expired()
        self.env.pg.put(rooms.HOSTS, {"email": CLOSER, "zoom_user_id": "zu-closer"})
        self.env.zoom.participants[mid] = [{"id": "zu-setter", "email": ""}, {"id": "zu-closer", "email": ""},
                                           {"id": "", "email": "CLOSER@example.test"},
                                           {"id": "", "email": "", "leave_time": "2026-10-03T09:58:00Z"}]
        self.env.worker().run(seconds=0)
        self.assertNotIn(mid, self.env.zoom.meetings)
        self.assertEqual(self.env.zoom.count("PUT", f"/meetings/{mid}/status"), 1)

    def test_the_meeting_uuid_is_kept_before_the_meeting_is_deleted(self):
        mid = self.expired()
        self.env.worker().run(seconds=0)
        note = self.env.pg.one(rooms.EVENTS, dedupe_key=f"worker.closing:{rid(1)}")
        self.assertEqual(note["detail"]["meeting_uuid"], f"uuid{mid}==")
        self.assertTrue(note.get("handled_at"))    # a note: the sweep never replays it
        log = [(m, u) for _t, m, u, _to, _r in self.env.net.log]
        kept = next(i for i, (m, u) in enumerate(log) if m == "POST" and rooms.EVENTS in u)
        gone = next(i for i, (m, u) in enumerate(log) if m == "DELETE" and "api.zoom.us" in u)
        self.assertLess(kept, gone)

    def test_a_meeting_left_open_for_three_hours_is_left_to_zoom(self):
        mid = self.expired(ended_at=rooms.iso(T0 - rooms.HOLD_GIVE_UP_S - 1))
        self.env.zoom.participants[mid] = [{"id": "", "email": ""}]
        self.env.worker().run(seconds=0)
        self.assertEqual(self.env.zoom.meetings[mid]["status"], "started")
        self.assertIsNone(self.env.pg.one(rooms.SECRETS, room_id=rid(1)))


class ParticipantReport(RoomsCase):
    def room(self, n: int, *, lead_in: bool, people: Any, code: str) -> str:
        m = self.env.zoom._make("zu-setter", {"topic": f"Mahara call {code}"})
        self.env.add_room(n, code=code, state="ended" if lead_in else "expired", provider_meeting_id=str(m["id"]),
                          lead_in_at=rooms.iso(T0 - 1800) if lead_in else None, ended_at=rooms.iso(T0 - 600))
        uuid_ = f"uuid{m['id']}=="
        self.env.pg.put(rooms.EVENTS, {"room_id": rid(n), "kind": "worker.closing", "source": "worker",
                                       "dedupe_key": f"worker.closing:{rid(n)}", "detail": {"meeting_uuid": uuid_},
                                       "handled_at": rooms.iso(T0 - 590)})
        if people is not None:
            self.env.zoom.past[uuid_] = people
        return uuid_

    def test_a_join_the_cockpit_never_saw_is_said_and_alerted(self):
        self.room(1, lead_in=False, code="MISS01", people=[{"id": "zu-setter"}, {"id": "", "name": "Invented"}])
        self.room(2, lead_in=True, code="SEEN02", people=[{"id": "zu-setter"}, {"id": "", "name": "Invented"}])
        self.room(3, lead_in=False, code="NONE03", people=None)  # never started: no report at all
        out = self.env.worker().check_hosts()
        line = out["lines"][-1]
        self.assertEqual(line, "Zoom participant reports: 3 rooms checked, 1 not matching the cockpit (MISS01).")
        self.assertIs(out["ok"], False)
        self.assertIsNotNone(self.env.pg.one(rooms.ALERTS, dedupe_key=f"room_report:{rid(1)}"))
        self.assertEqual(self.env.pg.one(rooms.EVENTS, dedupe_key=f"report.checked:{rid(1)}")["detail"]["match"], False)
        self.assertEqual(self.env.pg.one(rooms.EVENTS, dedupe_key=f"report.checked:{rid(2)}")["detail"]["match"], True)
        # Each room once.
        again = self.env.worker("run-b").check_hosts()
        self.assertEqual(again["lines"][-1],
                         "Zoom participant reports: every Zoom room that ended in the last day is checked.")

    def test_a_report_that_cannot_be_read_is_said_never_taken_as_nobody(self):
        self.room(1, lead_in=True, code="SEEN01", people=[{"id": ""}])
        self.env.zoom.past_api = False
        out = self.env.worker().check_hosts()
        self.assertIn("0 rooms checked, all matching the cockpit. 1 report could not be read (Invalid access token, "
                      "does not contain scopes); it is tried again in ten minutes.", out["lines"][-1])
        self.assertIs(out["ok"], False)
        self.assertIsNone(self.env.pg.one(rooms.EVENTS, dedupe_key=f"report.checked:{rid(1)}"))


# ---- finding 5: the Team page's Zoom user ------------------------------------------


class TeamPageZoomUser(RoomsCase):
    def test_a_linked_zoom_user_that_is_gone_falls_back_to_the_email(self):
        self.env.pg.put(rooms.HOSTS, {"email": SETTER, "zoom_user_id": "zu-gone"})
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual([c[1] for c in self.env.zoom.calls if c[1].startswith("/users/") and c[0] == "GET"][:2],
                         ["/users/zu-gone", f"/users/{SETTER}"])

    def test_the_check_never_writes_an_empty_zoom_user_over_one_that_was_set(self):
        self.env.pg.put("cockpit_sales_people", {"email": CLOSER, "role": "closer", "active": True, "via_portal": True})
        self.env.pg.put(rooms.HOSTS, {"email": CLOSER, "zoom_user_id": "zu-closer"})
        self.env.zoom.script = [{"method": "GET", "path": "/users/zu-closer", "status": 503, "exact": True}] * 3
        self.env.worker().check_hosts()
        self.assertEqual(self.env.pg.one(rooms.HOSTS, email=CLOSER)["zoom_user_id"], "zu-closer")


# ---- finding 7: the switches ---------------------------------------------------------


class Switches(RoomsCase):
    def test_a_provider_switched_off_fails_its_rooms_with_what_to_do(self):
        self.env.pg.one("cockpit_sales_settings", key="rooms")["value"]["providers"]["zoom"] = False
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["error"], rooms.SAY["zoom_off"])
        self.assertEqual(self.env.zoom.calls, [])

    def test_a_settings_read_that_fails_is_tried_again_next_second_not_in_25(self):
        state = {"n": 0}

        def rule(method, url, real):
            if method == "GET" and "cockpit_sales_settings" in url and state["n"] < 2:
                state["n"] += 1
                raise HttpError(503, "busy", b"", url)
            return real()

        flaky_pg(self.env, rule)
        self.env.add_room()
        self.env.worker().run(seconds=10)
        self.assertEqual(self.env.room()["state"], "open")
        self.assertLessEqual(opened_after(self.env, 1), 4.0)

    def test_rooms_left_creating_are_not_touched_while_the_setting_cannot_be_read(self):
        self.env.add_room(provider="meet", state="creating", worker_run="run-dead", claimed_at=rooms.iso(T0 - 5))

        def rule(method, url, real):
            if method == "GET" and "cockpit_sales_settings" in url:
                raise HttpError(503, "busy", b"", url)
            return real()

        flaky_pg(self.env, rule)
        self.env.worker().run(seconds=3)
        self.assertEqual((self.env.room()["state"], self.env.room()["worker_run"]), ("creating", "run-dead"))
        self.assertEqual(self.env.google.calls, [])
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIn("The rooms setting could not be read, so no new room is made until it can be.", row["detail"])
        # Final review: running but claiming nothing is said first, in the
        # words sales-api reads (room.create refuses, the health line says so).
        self.assertIs(row["ok"], False)
        self.assertTrue(row["detail"].startswith(rooms.NOT_MAKING + "The rooms setting could not be read"), row["detail"])

    def test_a_clock_past_the_stop_says_it_makes_no_rooms_in_the_words_sales_api_reads(self):
        self.env.add_room(1, provider="meet")
        w = self.env.worker("run-a")
        w.sb.clock_offset = -(rooms.CLOCK_STOP_S + 35)
        w.run(seconds=3)
        self.assertEqual(self.env.room(1)["state"], "requested")
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIs(row["ok"], False)
        self.assertTrue(row["detail"].startswith(rooms.NOT_MAKING + "The VPS clock is 95 seconds ahead of"), row["detail"])
        self.assertEqual(row["detail"].count("The VPS clock is"), 1, row["detail"])

    def test_a_healthy_run_never_says_it_makes_no_rooms(self):
        self.env.add_room(1, provider="meet")
        self.env.worker("run-a").run(seconds=3)
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertFalse(row["detail"].startswith(rooms.NOT_MAKING), row["detail"])

    def test_the_prefix_is_the_one_sales_api_reads(self):
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "..", "..", "..", "supabase", "functions", "sales-api", "roomlogic.ts"), encoding="utf-8") as f:
            src = f.read()
        self.assertIn(f'export const NOT_MAKING_PREFIX = "{rooms.NOT_MAKING}";', src)


# ---- finding 8: the end of a run ---------------------------------------------------


class EndOfRun(RoomsCase):
    def test_a_make_the_run_s_end_cuts_short_is_handed_over_and_made_at_once(self):
        self.env.zoom.latency = 2.0
        self.env.clock.at(T0 + 53.5, lambda: self.env.add_room(1, requested_at=rooms.iso(T0 + 53.5)))
        with mock.patch.object(rooms, "ZOOM_CLAIM_MARGIN", rooms.CLAIM_MARGIN):
            self.env.worker("run-a").run(seconds=57)
        row = self.env.room()
        self.assertEqual((row["state"], row["worker_run"]), ("creating", "handover:run-a"))
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0)
        # The run still wrote its status row after the hand-over.
        status = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIn("1 Zoom room handed to the next run because this run ran out of time.", status["detail"])
        self.env.clock.advance(1.5)
        start = self.env.clock()
        self.env.worker("run-b").run(seconds=57)
        row = self.env.room()
        self.assertEqual(row["state"], "open")
        self.assertLess(rooms.parse_ts(row["opened_at"]) - start, 10)
        self.assertEqual(len(self.env.zoom.meetings), 1)

    def unclear_end(self, *, made: bool) -> None:
        # The first create answers 504 after 7 s; the second hangs until the
        # run's time is up. Neither answer says whether Zoom made the meeting.
        self.env.zoom.script = [{"method": "POST", "path": "/meetings", "status": 504, "delay": 7.0},
                                {"method": "POST", "path": "/meetings", "status": 0, "delay": 99.0, "make": made}]
        self.env.clock.at(T0 + 44.5, lambda: self.env.add_room(1, requested_at=rooms.iso(T0 + 44.5)))
        self.env.worker("run-a").run(seconds=57)
        self.assertEqual((self.env.room()["state"], self.env.room()["worker_run"]), ("creating", "unclear:run-a"))
        self.env.clock.advance(1.5)
        self.env.worker("run-b").run(seconds=57)

    def test_a_create_whose_answer_the_end_cut_off_is_only_looked_for_never_sent_again(self):
        self.unclear_end(made=False)
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 2)
        row = self.env.room()
        # Still only looked for: the sweep fails it at claim + 120 s, its own
        # timer (contract-v2 S1 and section 7, item 10), never the worker at 60.
        self.assertEqual((row["state"], row["error"]), ("creating", None))
        # With no sweep running, the worker fails it once it is ten minutes old.
        self.env.clock.advance(rooms.STALE_S)
        self.env.worker("run-c").run(seconds=0)
        row = self.env.room()
        self.assertEqual((row["state"], row["error"]), ("failed", rooms.SAY["lost"]))
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 2)

    def test_a_create_zoom_did_make_is_found_by_the_next_run(self):
        self.unclear_end(made=True)
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 2)
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(len(self.env.zoom.meetings), 1)
        self.assertEqual(self.env.api.kinds(rid(1)), ["worker.ready"])

    def test_a_dead_run_s_zoom_room_is_picked_up_at_once(self):
        dead = f"box-1-{int(T0) - 70}-e{int(T0) - 5}"
        self.env.add_room(state="creating", worker_run=dead, version=2, claimed_at=rooms.iso(T0 - 10))
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")

    def test_a_run_s_id_carries_the_second_it_stops(self):
        w = rooms.Worker(self.env.sb, zoom=None, google=None, api=None, log=self.env.log, clock=self.env.clock,
                         sleep=self.env.clock.sleep)
        w.run(seconds=0)
        self.assertEqual(rooms.run_ends(w.run_id), float(int(w.hard_stop) + 1))


# ---- finding 9: nothing outlives the minute ----------------------------------------


class NoRealSleep(RoomsCase):
    def test_database_trouble_is_never_retried_inside_the_http_layer(self):
        rng = random.Random(9)

        def rule(method, url, real):
            if rng.random() < 0.2:
                raise HttpError(503, "busy", b"", url)
            return real()

        flaky_pg(self.env, rule)
        for n in range(1, 6):
            self.env.add_room(n, provider="meet" if n % 2 else "zoom", host_email=f"rep{n}@example.test")
            self.env.zoom.users[f"rep{n}@example.test"] = {"id": f"zu-{n}", "type": 2, "status": "active"}
        with mock.patch.object(http.time, "sleep", side_effect=AssertionError("a real sleep")):
            self.env.worker().run(seconds=57)
        db = [x for x in self.env.net.log if "db.test/rest" in x[2]]
        self.assertTrue(db)
        self.assertEqual({r for _t, _m, _u, _to, r in db}, {0})


# ---- findings 11, 13, 16, 17: Google, secrets, retries, copy --------------------------


class GoogleSignIn(RoomsCase):
    def test_a_sign_in_without_a_calendar_permission_fails_the_room_without_asking_calendar(self):
        self.env.google.scope = "https://www.googleapis.com/auth/drive"
        self.env.add_room(provider="meet")
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["error"], rooms.SAY["google_scope"])
        self.assertEqual(self.env.google.calls, [])

    def test_a_refused_sign_in_says_connect_again(self):
        self.env.google.token_status = 400
        self.env.add_room(provider="meet")
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["error"], rooms.SAY["google_signin"])

    def test_a_calendar_id_on_the_box_means_no_calendar_list(self):
        self.env.google.ready_after = 0
        self.env.add_room(provider="meet")
        w = self.env.worker()
        w._calendar = w._calendar_fixed and w._calendar or "fixed@group.example.test"
        w.run(seconds=3)
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(self.env.google.count("GET", "calendarList"), 0)

    def test_the_doctor_checks_google_live_and_offline_only_names_the_keys(self):
        env = {"GOOGLE_CLIENT_ID": "test-gid", "GOOGLE_CLIENT_SECRET": "test-gsecret",
               "GOOGLE_REFRESH_TOKEN": "test-refresh", "ZOOM_ACCOUNT_ID": "a", "ZOOM_CLIENT_ID": "c",
               "ZOOM_CLIENT_SECRET": "s"}
        self.env.google.scope = "https://www.googleapis.com/auth/drive.file"
        with mock.patch.dict(os.environ, env):
            offline = dict((n, (ok, d)) for n, ok, d in rooms.doctor_lines(offline=True))
            online = dict((n, (ok, d)) for n, ok, d in rooms.doctor_lines(offline=False))
        self.assertEqual(offline["rooms: google"][0], True)
        self.assertIn("not checked offline", offline["rooms: google"][1])
        self.assertIs(online["rooms: google"][0], False)
        self.assertIn("has no Calendar permission", online["rooms: google"][1])
        self.assertIs(online["rooms: zoom"][0], True)
        self.assertNotIn("test-refresh", json.dumps(online))


class Secrets(RoomsCase):
    def test_host_tokens_and_passcodes_are_hidden_wherever_they_are_echoed(self):
        text = ('Failing row contains (8a1f, https://zoom.example.test/s/810?zak=host-only&x=1, '
                'https://zoom.example.test/j/810?pwd=enc810) zak=abc pwd="p4ss"')
        out = http.scrub(text)
        for secret in ("host-only", "enc810", "abc", "p4ss"):
            self.assertNotIn(secret, out)
        self.assertIn("zak=<hidden>", out)

    def test_the_status_row_keeps_the_database_s_code_and_message_only(self):
        e = HttpError(400, json.dumps({"code": "23502", "message": "null value in column made_by",
                                       "details": "Failing row contains (secret-row)", "hint": "secret-hint"}),
                      b"", "https://db.test/rest/v1/x")
        self.assertEqual(rooms.db_reason(e), "23502: null value in column made_by")


class Retries(unittest.TestCase):
    def test_a_server_error_on_a_call_that_is_not_safe_to_repeat_is_not_repeated(self):
        clock = Clock()
        send = rooms.Sender(clock, clock.sleep)
        calls = []

        def fail(method, url, **kw):
            calls.append(method)
            raise HttpError(502, "bad gateway", b"", url)

        with mock.patch.object(http, "request", fail):
            with self.assertRaises(rooms.ProviderError):
                send("POST", "https://www.googleapis.com/calendar/v3/calendars", body={}, safe=False, retries=2)
            self.assertEqual(calls, ["POST"])
            with self.assertRaises(rooms.ProviderError):
                send("GET", "https://www.googleapis.com/calendar/v3/x", retries=2)
            self.assertEqual(calls, ["POST", "GET", "GET", "GET"])


class Copy(unittest.TestCase):
    def test_what_only_the_ceo_can_fix_names_the_ceo_and_a_refusal_does_not_say_try_again(self):
        for name in ("no_user", "zoom_keys", "google_keys", "google_signin", "google_scope", "calendar"):
            self.assertIn("the CEO", rooms.SAY[name], name)
            self.assertNotIn("manager", rooms.SAY[name], name)
        self.assertNotIn("try again", rooms.SAY["zoom_refused"].lower())
        for sentence in rooms.SAY.values():
            self.assertNotIn(chr(0x2014), sentence)


# ---- finding 21: the harsher stress run ---------------------------------------------


class HarshStress(RoomsCase):
    def test_four_minutes_of_everything_failing_leaves_nothing_stuck_doubled_or_leaked(self):
        rng = random.Random(20261003)
        env = self.env
        codes: set[str] = set()
        for n in range(1, 61):
            code = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            while code in codes:
                code = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            codes.add(code)
            at = T0 + rng.uniform(0, 170)
            env.clock.at(at, lambda n=n, at=at, code=code: env.add_room(
                n, code=code, provider="zoom" if n % 2 else "meet", requested_at=rooms.iso(at),
                host_email=f"rep{n % 7}@example.test",
                call_kind="demo" if n % 5 == 0 else "intro"))
        # One Zoom room is always asked for while Zoom hangs.
        env.clock.at(T0 + 72, lambda: env.add_room(61, code="HANG72", provider="zoom", requested_at=rooms.iso(T0 + 72),
                                                    host_email="rep6@example.test"))
        for i in range(7):
            env.zoom.users[f"rep{i}@example.test"] = {"id": f"zu-{i}", "type": 2, "status": "active"}
        # Zoom: refusals that mean "again", answers lost after the work, and a hang.
        for _ in range(14):
            env.zoom.script.append({"method": "POST", "path": "/meetings", "status": rng.choice((429, 500, 503, 0)),
                                    "make": rng.random() < 0.5})
        env.clock.at(T0 + 70, lambda: setattr(env.zoom, "latency", 30.0))
        env.clock.at(T0 + 85, lambda: setattr(env.zoom, "latency", 0.0))
        # Google: slow links, server errors, and a hang.
        env.google.ready_after = 2
        for _ in range(8):
            env.google.script.append({"method": rng.choice(("GET", "POST")), "path": "/events", "status": 503})
        env.clock.at(T0 + 120, lambda: setattr(env.google, "latency", 30.0))
        env.clock.at(T0 + 150, lambda: setattr(env.google, "latency", 0.0))
        # sales-api: refusals, server errors, and a slow spell.
        env.api.script = [rng.choice((200, 200, 200, 503, 400)) for _ in range(40)]
        env.clock.at(T0 + 40, lambda: setattr(env.api, "latency", 20.0))
        env.clock.at(T0 + 60, lambda: setattr(env.api, "latency", 0.0))
        # The database: random 503s, and writes that land but whose answer is lost.
        def rule(method, url, real):
            roll = rng.random()
            if roll < 0.03:
                raise HttpError(503, "busy", b"", url)
            if method != "GET" and roll < 0.06:
                real()
                raise HttpError(0, "TimeoutError: timed out", b"", url)
            return real()

        flaky_pg(env, rule)
        # Reps cancel some rooms while Zoom is making them.
        made = {"n": 0}

        def cancel_some(m):
            made["n"] += 1
            if made["n"] % 6 == 3:
                row = next((r for r in env.pg.rows(rooms.ROOMS) if f"Mahara call {r['code']}" == m["topic"]), None)
                if row and row["state"] in ("requested", "creating"):
                    row.update({"state": "cancelled", "ended_at": rooms.iso(env.clock())})

        env.zoom.after_create = cancel_some
        # The sweep expires open Zoom rooms nobody joined; one of them has the
        # lead inside a started meeting although the join event was lost (H7).
        held: dict[str, str] = {}

        def expire_some():
            open_zoom = [r for r in env.pg.rows(rooms.ROOMS) if r["state"] == "open" and r["provider"] == "zoom"]
            for i, r in enumerate(open_zoom[:4]):
                r.update({"state": "expired", "ended_at": rooms.iso(env.clock())})
                if i == 0 and not held and r["provider_meeting_id"] in env.zoom.meetings:
                    env.zoom.meetings[r["provider_meeting_id"]]["status"] = "started"
                    env.zoom.participants[r["provider_meeting_id"]] = [{"id": "", "email": "", "user_name": "Lead"}]
                    held[r["id"]] = r["provider_meeting_id"]

        env.clock.at(T0 + 100, expire_some)
        env.clock.at(T0 + 200, expire_some)

        # The SQL sweep owns the timers (contract-v2 S1), every minute: R1
        # fails a room still requested at 60 s, R2 one still creating at claim
        # + 120 s. The worker only looks for a lost meeting until then.
        def sweep():
            now = env.clock()
            for r in env.pg.rows(rooms.ROOMS):
                asked, claimed = rooms.parse_ts(r.get("requested_at")), rooms.parse_ts(r.get("claimed_at"))
                if (r["state"] == "requested" and asked and now - asked > 60) or \
                        (r["state"] == "creating" and claimed and now - claimed > 120):
                    r.update({"state": "failed", "result": "failed", "ended_at": rooms.iso(now),
                              "error": "The room was not made in time. Make a new one."})

        for k in range(1, 12):
            env.clock.at(T0 + 60 * k, sweep)
        # A run by hand lands in the middle of the second cron run.
        env.clock.at(T0 + 95.5, lambda: env.worker("once-by-hand").run(seconds=0))
        ends = []
        with mock.patch.object(http.time, "sleep", side_effect=AssertionError("a real sleep")):
            for run in ("run-a", "run-b", "run-c", "run-d"):
                start = env.clock()
                env.worker(run).run(seconds=57)
                ends.append(env.clock() - start)
                env.clock.advance(3)
            # Then calm: everything left is settled by healthy runs.
            env.net.pg = env.pg  # type: ignore[assignment]
            env.zoom.script, env.google.script, env.api.script = [], [], []
            for run in ("run-e", "run-f", "run-g"):
                env.clock.advance(31)
                env.worker(run).run(seconds=57)
        self.assertTrue(all(e <= 57 + rooms.HARD_SLACK + 0.01 for e in ends), ends)
        rows = env.pg.rows(rooms.ROOMS)
        self.assertEqual(len(rows), 61)
        self.assertEqual({r["state"] for r in rows} - {"open", "failed", "cancelled", "expired"}, set(),
                         [r["state"] for r in rows])
        self.assertTrue(any(r["state"] == "cancelled" for r in rows))
        self.assertTrue(any(r["state"] == "expired" for r in rows))
        self.assertEqual(len(held), 1)
        topics = [m["topic"] for m in env.zoom.meetings.values()]
        self.assertEqual(len(topics), len(set(topics)), "a Zoom room was made twice")
        for r in rows:
            mine = [m for m in env.zoom.meetings.values() if m["topic"] == f"Mahara call {r['code']}"]
            kinds = env.api.kinds(r["id"])
            if r["state"] == "open":
                self.assertIsNotNone(env.pg.one(rooms.EVENTS, dedupe_key=f"worker.ready:{r['id']}"), r["code"])
                self.assertIsNotNone(env.pg.one(rooms.SECRETS, room_id=r["id"]), r["code"])
                self.assertLessEqual(kinds.count("worker.ready"), 1, r["code"])
                self.assertNotIn("worker.failed", kinds)
                if r["provider"] == "zoom":
                    self.assertEqual([str(m["id"]) for m in mine], [r["provider_meeting_id"]], r["code"])
            elif r["id"] in held:
                # Never ended with the lead in it: the meeting stays, an alert says so.
                self.assertEqual(env.zoom.meetings[held[r["id"]]]["status"], "started")
                self.assertIsNotNone(env.pg.one(rooms.ALERTS, dedupe_key=f"room_held:{r['id']}"))
            elif r["state"] == "expired":
                self.assertEqual(mine, [], f"expired room {r['code']} left a meeting behind")
                self.assertIsNone(env.pg.one(rooms.SECRETS, room_id=r["id"]))
            elif r["state"] == "cancelled":
                self.assertEqual(mine, [], f"cancelled room {r['code']} left a meeting behind")
                self.assertIsNone(env.pg.one(rooms.SECRETS, room_id=r["id"]))
                self.assertNotIn("worker.ready", kinds)
            else:
                self.assertEqual(mine, [], f"failed room {r['code']} left a meeting behind")
                self.assertIsNone(env.pg.one(rooms.SECRETS, room_id=r["id"]))
                self.assertLessEqual(kinds.count("worker.failed"), 1, r["code"])
                self.assertNotIn("worker.ready", kinds)
        self.assertGreaterEqual(sum(1 for r in rows if r["state"] in ("open", "expired")), 30)
        # It was a hard four minutes: each kind of trouble really happened.
        statuses = " ".join(x["detail"] for x in env.pg.rows("cockpit_sales_worker_status"))
        logs = " ".join(m for _l, m in env.log.lines)
        self.assertIn("rooms: sales-api refused", logs)
        self.assertIn("rooms: the database did not answer as expected", logs)
        self.assertIn("Google did not answer", logs)
        self.assertIn("Zoom did not answer", logs)
        self.assertTrue(statuses)
        everything = (json.dumps(rows) + json.dumps(env.api.bodies) + json.dumps(env.pg.rows(rooms.EVENTS))
                      + json.dumps(env.pg.rows("cockpit_sales_worker_status")) + json.dumps(env.log.lines))
        self.assertNotIn("zak=host", everything)


if __name__ == "__main__":
    unittest.main()
