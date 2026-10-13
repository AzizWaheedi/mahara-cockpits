"""Milestone 1, video-link round 4, chaos on the room worker (2026-10-06).

Google's token endpoint answers one request with something that is not a
token: a 200 with an empty body, or a page in front of it (a proxy's or a
gateway's HTML), the "garbage" every other read in this worker already
treats as "not answered" (Zoom.user, Zoom.meetings, Google.calendars,
supabase.py's reads: stress2 round 5, m1 round 2).

Google.token() reads such an answer as Google refusing the sign-in (a 401):
  - the host check (every ten minutes) writes google_ok false on every
    seat, so sales-api refuses every Meet room for the next ten minutes with
    "Meet rooms are down until the CEO reconnects Google on the room worker"
    (a setter whose Zoom invite is still pending, as the pilot's are, has no
    video link at all), and the status row asks the CEO to reconnect Google;
  - a Meet room being made at that moment fails with "Google refused the
    room worker's sign-in. Use Zoom, and ask the CEO to connect Google
    Calendar again." (the room path asks the token endpoint directly, with
    no second try, unlike Google.call).

Every room, seat, meeting and key is invented, and nothing reaches the
network.

    python3 -m unittest tests.test_m1_chaos_r4
"""
from __future__ import annotations

import os
import unittest
from typing import Any, Optional

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests import test_rooms as tr  # noqa: E402

SETTER, CLOSER = tr.SETTER, tr.CLOSER

GARBAGE = {
    "an empty 200": b"",
    "a gateway's HTML page with a 200": b"<html><body><h1>Please wait</h1></body></html>",
}


class GoogleTokenGarbage(tr.RoomsCase):
    def seats(self) -> None:
        for email, role in ((SETTER, "setter"), (CLOSER, "closer")):
            self.env.pg.put("cockpit_sales_people", {"email": email, "name": "Invented Name", "role": role,
                                                     "active": True, "via_portal": True})
            # The last check found Google working for every seat.
            self.env.pg.put(rooms.HOSTS, {"email": email, "google_ok": True})
        # The pilot's setter: a Zoom invite not accepted yet.
        self.env.zoom.users.pop(SETTER)
        self.env.zoom.pending.add(SETTER)
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]

    def garble_next_token(self, body: bytes, n: int = 1) -> None:
        real = self.env.google.token
        left = {"n": n}

        def token(method: str, data: Optional[bytes]) -> tuple[int, dict, bytes]:
            if left["n"] > 0:
                left["n"] -= 1
                self.env.google.tokens += 1
                return 200, {}, body
            return real(method, data)

        self.env.google.token = token  # type: ignore[method-assign]

    def test_held_a_token_endpoint_that_does_not_answer_keeps_the_last_known_state(self):
        self.seats()
        real = self.env.google.token

        def token(method: str, data: Optional[bytes]) -> tuple[int, dict, bytes]:
            raise tr._err(503, {"error": "backendError"}, "https://oauth2.googleapis.com/token")

        self.env.google.token = token  # type: ignore[method-assign]
        self.env.worker().check_hosts()
        self.env.google.token = real  # type: ignore[method-assign]
        self.assertTrue(all(r.get("google_ok") is True for r in self.env.pg.rows(rooms.HOSTS)))

    def test_m1_chaos_r4_google_token_garbage_marks_meet_down_for_every_seat(self):
        got: dict[str, Any] = {}
        for name, body in GARBAGE.items():
            self.setUp()
            self.seats()
            self.garble_next_token(body)
            out = self.env.worker().check_hosts()
            got[name] = {
                "google_ok": sorted({str(r.get("google_ok")) for r in self.env.pg.rows(rooms.HOSTS)}),
                "asks_ceo_to_reconnect": "connect Google Calendar again" in out["lines"][0],
            }
        # What should hold: an answer that is not a token says nothing about
        # the sign-in, so the last known state stays (google_ok true), as a
        # 5xx or a timeout does, and nobody is asked to reconnect Google.
        self.assertEqual(got, {name: {"google_ok": ["True"], "asks_ceo_to_reconnect": False} for name in GARBAGE})

    def test_m1_chaos_r4_google_token_garbage_fails_meet_room_as_sign_in_refused(self):
        got: dict[str, Any] = {}
        for name, body in GARBAGE.items():
            self.setUp()
            self.seats()
            self.env.add_room(1, provider="meet", host_email=SETTER)
            self.garble_next_token(body)
            w = self.env.worker()
            self.tick(w)
            r = self.env.room(1)
            got[name] = {"state": r["state"], "error": r.get("error")}
        # What should hold: the room is made (or, at worst, failed with
        # "Google did not answer. Try again in a minute"), never failed as a
        # refused sign-in that sends the setter to a Zoom they cannot use and
        # the CEO to reconnect a sign-in that works.
        for name, g in got.items():
            with self.subTest(name):
                self.assertNotEqual(g["error"], rooms.SAY["google_signin"], g)


class GarbledInsert:
    """Google with its next event insert answered by `body` (a 200), the event never made."""

    def __init__(self, google: tr.FakeGoogle, body: bytes):
        self.g, self.body, self.garbled = google, body, False

    def __getattr__(self, name: str) -> Any:
        return getattr(self.g, name)

    def __call__(self, method: str, url: str, data: Optional[bytes]) -> tuple[int, dict, bytes]:
        if method == "POST" and url.split("?")[0].endswith("/events") and not self.garbled:
            self.garbled = True
            self.g.calls.append((method, "calendars/-/events (garbled)", {}, None))
            return 200, {}, self.body
        return self.g(method, url, data)


class GoogleInsertGarbage(tr.RoomsCase):
    """Google's insert of the room's event answers a 200 whose body is not
    the event (empty, or a page in front of Google), and Google never made
    it. The worker reads that as "pending" and polls the event, which is not
    there (404), for the whole Meet wait, then fails the room as refused by
    Google, never inserting it again, though an insert that answered 5xx is
    inserted again inside the same wait (resume_meet)."""

    def play(self, body: bytes) -> dict[str, Any]:
        env = self.env
        env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        env.add_room(1, provider="meet", host_email=SETTER)
        env.net.google = GarbledInsert(env.google, body)  # type: ignore[assignment]
        w = env.worker()
        w.run(seconds=57)
        r = env.room(1)
        return {"state": r["state"], "error": r.get("error"), "inserts": sum(1 for c in env.google.calls if c[0] == "POST" and "events" in c[1])}

    def test_held_an_insert_that_answers_503_is_made_inside_the_wait(self):
        self.env.google.script = [{"method": "POST", "path": "/events", "status": 503}]
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        self.env.add_room(1, provider="meet", host_email=SETTER)
        self.env.worker().run(seconds=57)
        self.assertEqual(self.env.room(1)["state"], "open")

    def test_m1_chaos_r4_meet_insert_garbage_polls_a_missing_event_and_fails_as_refused(self):
        got = {}
        for name, body in GARBAGE.items():
            self.setUp()
            got[name] = self.play(body)
        # What should hold: the event that is not there is inserted again
        # inside the Meet wait (its id is fixed, so a second insert is safe),
        # and the room opens; never "Google refused to make the Meet room:
        # Not Found".
        self.assertEqual({k: v["state"] for k, v in got.items()}, {k: "open" for k in GARBAGE}, got)


class PendingListBlip(tr.RoomsCase):
    """A seat whose Zoom invite is not accepted yet is not found by its
    email (404), so the worker reads Zoom's list of pending invites to tell
    "pending" from "missing". That list not answering (a 503, a timeout, a
    page with no list) is read as "missing": the host check writes
    zoom_status missing over the seat's pending (with an audit row), and a
    Zoom room for that seat fails with "Your email has no Zoom user on
    Mahara's account. Use Meet, and ask the CEO to add you in Zoom." about a
    seat that has its invite."""

    def seat(self) -> None:
        self.env.pg.put("cockpit_sales_people", {"email": SETTER, "name": "Invented Name", "role": "setter",
                                                 "active": True, "via_portal": True})
        self.env.pg.put(rooms.HOSTS, {"email": SETTER, "zoom_status": "pending", "google_ok": True})
        self.env.zoom.users.pop(SETTER)
        self.env.zoom.pending.add(SETTER)
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]

    def test_held_with_the_pending_list_answering_the_seat_stays_pending(self):
        self.seat()
        self.env.worker().check_hosts()
        self.assertEqual(self.env.pg.one(rooms.HOSTS, email=SETTER)["zoom_status"], "pending")

    def test_m1_chaos_r4_pending_list_blip_says_no_zoom_user(self):
        self.seat()
        # Zoom's pending list answers 503 three times (the call and its two retries).
        self.env.zoom.script = [{"method": "GET", "path": "/users", "exact": True, "status": 503}] * 3
        out = self.env.worker().check_hosts()
        row = self.env.pg.one(rooms.HOSTS, email=SETTER)
        # What should hold: not knowing is not missing; the last known status (pending) stays.
        self.assertEqual({"zoom_status": row["zoom_status"],
                          "line_says_no_user": any("no Zoom user" in line for line in out["lines"])},
                         {"zoom_status": "pending", "line_says_no_user": False})


if __name__ == "__main__":
    unittest.main()
