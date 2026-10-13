"""Stress series 2, round 4, chaos on the room worker (2026-10-05): an
answer lost after the write landed at Google.

The worker inserts a Meet room as an event with a FIXED id (the room's id in
base32hex), precisely so that "a second insert is a 409" (Google.insert) and
a lost room "is found by its event id" (resume_meet). But start_meet reads
any failure of the insert other than 409 as Google's: a timeout (the 8 s
WRITE_TIMEOUT; the Sender never retries a timeout) or a 5xx after Google
made the event fails the room at once with "Google did not answer. Try again
in a minute, or use Zoom.", while the event and its Meet link exist on the
Sales rooms calendar, a read away. Zoom's lost create is looked for by its
code (recover_zoom); Meet's is not looked for at all.

Every room, lead, seat and line is invented; nothing reaches the network.

    python3 -m unittest tests.test_stress2_chaos_r4
"""
from __future__ import annotations

import os
import unittest

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests.test_rooms import FakeGoogle, RoomsCase, _err, rid  # noqa: E402


class MeetInsertAnswerLost(RoomsCase):
    """Google makes the event, and its answer never reaches the worker."""

    def lose_insert_answer(self, how: str) -> None:
        env = self.env
        lost = {"done": False}

        class LosingGoogle(FakeGoogle):
            def __call__(self, method, url, data):
                out = super().__call__(method, url, data)
                if not lost["done"] and method == "POST" and url.split("?")[0].endswith("/events"):
                    lost["done"] = True
                    if how == "timeout":
                        env.clock.advance(rooms.WRITE_TIMEOUT)
                        raise HttpError(0, "TimeoutError: timed out", b"", url)
                    raise _err(503, {"error": {"code": 503, "message": "The service is currently unavailable."}}, url)
                return out

        g = LosingGoogle(env.clock)
        g.ready_after = env.google.ready_after
        env.google = env.net.google = g

    def run_minutes(self, n: int) -> None:
        for _ in range(n):
            self.tick(self.env.worker("run-a"))
            self.env.clock.advance(5)

    def test_held_google_answers_the_insert_the_room_opens_on_meet(self):
        self.env.add_room(provider="meet")
        self.env.google.ready_after = 0
        self.run_minutes(6)
        self.assertEqual(self.env.room()["state"], "open")

    def test_meet_insert_lost_answer_fails_room_google_made_timeout(self):
        self.env.add_room(provider="meet")
        self.env.google.ready_after = 0
        self.lose_insert_answer("timeout")
        self.run_minutes(6)
        made = [k for k in self.env.google.events if k[1] == rooms.event_id(rid(1))]
        self.assertEqual(len(made), 1, "Google made the room's event")
        room = self.env.room()
        self.assertEqual(
            (room["state"], room.get("error")), ("open", None),
            "the event Google made (and its Meet link) is a read away by its fixed id; "
            f"the room was failed instead: {room.get('error')!r}")

    def test_meet_insert_lost_answer_fails_room_google_made_5xx(self):
        self.env.add_room(provider="meet")
        self.env.google.ready_after = 0
        self.lose_insert_answer("503")
        self.run_minutes(6)
        room = self.env.room()
        self.assertEqual(
            (room["state"], room.get("error")), ("open", None),
            f"Google made the event and answered 503; the room was failed: {room.get('error')!r}")




class GarbageAnswersAroundTheOpen(RoomsCase):
    """The database answers 200 with an empty body (a proxy, a cut answer
    read as nothing) for a few seconds around the room's open.

    supabase.py reads an empty or non-JSON 200 as "no rows": patch_returning
    answers [] (the guarded write "missed") and select answers [] (the room
    "is gone"). finish() then takes the open it just made, which landed, for
    another run's: the meeting is noted as a stray (_stray), and _stray_step
    closes a stray whose room it cannot read (room None: neither "requested"
    nor "creating", nor the room's own meeting). The room stays open with
    that meeting's join link, which sales-api sends to the lead (the sweep
    replays the stored worker.ready)."""

    def garbage_window(self, start: float, seconds: float) -> dict[str, int]:
        env = self.env
        real = env.net.pg
        hits = {"n": 0}

        def pg(method, url, **kw):
            out = real(method, url, **kw)
            now = env.clock()
            if start <= now < start + seconds and "/rest/v1/cockpit_sales_rooms" in url:
                hits["n"] += 1
                return 200, {}, b""
            return out

        env.net.pg = pg
        return hits

    def test_held_a_clean_database_keeps_the_open_rooms_meeting(self):
        self.env.add_room()
        w = self.env.worker("run-a")
        w.run(seconds=12)
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(len(self.env.zoom.meetings), 1)

    def test_garbage_answers_close_the_open_rooms_own_meeting(self):
        self.env.add_room()
        w = self.env.worker("run-a")
        # A clean claim and create, then six and a half seconds of empty 200
        # answers to the rooms table, from the open write on.
        orig_finish = w.finish

        def finish(room, **kw):
            self.garbage_window(self.env.clock(), 6.5)
            return orig_finish(room, **kw)

        w.finish = finish  # type: ignore[method-assign]
        w.run(seconds=20)
        room = self.env.room()
        mid = str(room.get("provider_meeting_id") or "")
        self.assertEqual(room["state"], "open", "the open write landed")
        self.assertTrue(room["join_url"], "the room carries the meeting's join link")
        self.assertIn(
            mid, self.env.zoom.meetings,
            "the open room's own Zoom meeting (whose join link sales-api sends the lead) was deleted as a stray")
        stored = [e for e in self.env.pg.rows(rooms.EVENTS) if e.get("kind") == "worker.ready"]
        self.assertTrue(stored, "worker.ready is stored before the open, so the sweep replays it and the link goes")


if __name__ == "__main__":
    unittest.main()
