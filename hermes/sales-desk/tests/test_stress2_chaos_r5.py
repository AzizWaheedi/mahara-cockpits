"""Stress series 2, round 5, chaos on the room worker (2026-10-05): Zoom and
Google answer 200 with nothing a reader can use.

Zoom.user() reads any answer that is not a JSON object (an empty 200 body,
a proxy's HTML page passed through as text, a list) as {}; zoom_seat_status
reads {} as "missing" (no status, type 0). So one garbled answer to the host
check's GET /users/{email} writes zoom_status "missing" over a licensed
closer (with its audit row), the presence view gives the seat Meet as its
default, and the line says the seat has "no Zoom user that can host on
Mahara's account". At a create, make_zoom fails the closer's room at once
with SAY["no_user"] (a refusal: the rep is told to use Meet), for a seat
Zoom never said anything about.

Zoom.meetings() reads `(page or {}).get(...)`: a page that is text (a
non-JSON 200) is a str, and str has no .get, so an AttributeError, which is
no ProviderError: the host check's "the last known value stays" path never
runs for it, and a room being made fails with the worker's generic error.

Google.calendars() reads an empty 200 as no calendars: Worker.calendar()
then makes a second "Sales rooms" calendar on the CEO's account.

Every room, lead, seat and line is invented; nothing reaches the network.

    python3 -m unittest tests.test_stress2_chaos_r5
"""
from __future__ import annotations

import os
import unittest

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests.test_rooms import CLOSER, SETTER, RoomsCase  # noqa: E402


class GarbledZoom(RoomsCase):
    """Zoom answers one of the worker's reads with a 200 nobody can read."""

    def seats(self) -> None:
        for email, role in ((SETTER, "setter"), (CLOSER, "closer")):
            self.env.pg.put("cockpit_sales_people", {"email": email, "name": "Invented Name", "role": role,
                                                     "active": True, "via_portal": True})
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        # The closer's seat as the last check left it: licensed, Zoom user known.
        self.env.pg.put(rooms.HOSTS, {"email": CLOSER, "zoom_user_id": "zu-closer", "zoom_status": "licensed",
                                      "google_ok": True})

    def garble(self, path_part: str, body: bytes, times: int = 10) -> None:
        """The next `times` Zoom GETs whose path holds `path_part` answer 200 with `body`."""
        zoom = self.env.zoom
        left = {"n": times}

        class Garbled:
            def __getattr__(self, name):
                return getattr(zoom, name)

            def __call__(self, method, url, data):
                if method == "GET" and path_part in url and left["n"] > 0:
                    left["n"] -= 1
                    zoom.calls.append((method, url, {}, None))
                    return 200, {}, body
                return zoom(method, url, data)

        self.env.net.zoom = Garbled()  # type: ignore[assignment]

    def test_held_zoom_answers_the_closer_stays_licensed(self):
        self.seats()
        self.env.worker().check_hosts()
        self.assertEqual(self.env.pg.one(rooms.HOSTS, email=CLOSER)["zoom_status"], "licensed")

    def test_zoom_user_garbage_writes_missing_over_a_licensed_closer_empty(self):
        self.seats()
        self.garble(f"/users/{CLOSER}", b"")
        out = self.env.worker().check_hosts()
        row = self.env.pg.one(rooms.HOSTS, email=CLOSER)
        lines = "\n".join(out["lines"])
        self.assertEqual(
            row["zoom_status"], "licensed",
            "an empty 200 from Zoom's user lookup is no answer; the last known status must stay. "
            f"Written: {row['zoom_status']!r}; the line says: "
            f"{next((ln for ln in out['lines'] if CLOSER in ln), '')!r}")
        self.assertNotIn("no Zoom user that can host", lines)

    def test_zoom_user_garbage_writes_missing_over_a_licensed_closer_page(self):
        self.seats()
        self.garble(f"/users/{CLOSER}", b"<html><body>Service Temporarily Unavailable</body></html>")
        self.env.worker().check_hosts()
        self.assertEqual(self.env.pg.one(rooms.HOSTS, email=CLOSER)["zoom_status"], "licensed",
                         "a proxy's HTML page from Zoom's user lookup was written as 'missing'")

    def test_zoom_user_garbage_fails_the_closers_room_as_no_zoom_user(self):
        self.seats()
        self.env.add_room(host_email=CLOSER, call_kind="demo", provider="zoom")
        self.garble(f"/users/{CLOSER}", b"", times=3)
        self.tick(self.env.worker("run-a"))
        room = self.env.room()
        self.assertNotEqual(
            (room["state"], room.get("error")), ("failed", rooms.SAY["no_user"]),
            "one empty 200 from Zoom's user lookup failed a licensed closer's room as 'no Zoom user that can host'")

    def test_zoom_live_list_text_page_crashes_the_host_check(self):
        self.seats()
        self.garble("/meetings", b"<html>Bad gateway</html>")
        try:
            out = self.env.worker().check_hosts()
        except AttributeError as e:  # the finding: no ProviderError, so the last-known path never runs
            self.fail(f"a text page from Zoom's live-meeting list crashed the host check: {e!r}")
        row = self.env.pg.one(rooms.HOSTS, email=CLOSER)
        self.assertEqual(row["zoom_status"], "licensed")
        self.assertIn("could not be read", "\n".join(out["lines"]))

    def test_zoom_live_list_text_page_fails_the_room_with_the_generic_error(self):
        self.seats()
        self.env.add_room(host_email=CLOSER, call_kind="demo", provider="zoom")
        self.garble("/meetings", b"<html>Bad gateway</html>", times=3)
        self.tick(self.env.worker("run-a"))
        room = self.env.room()
        # make_zoom's own rule: a live list that cannot be read is no refusal
        # ("Zoom itself stops a second live meeting, and the rep would rather
        # have the room").
        self.assertNotEqual(
            (room["state"], room.get("error")), ("failed", rooms.SAY["error"]),
            "a text page from Zoom's live-meeting list failed the closer's room with the worker's generic error")


class GarbledGoogleCalendarList(RoomsCase):
    """Google answers the calendar list with a 200 that lists nothing (an
    empty body read as no page, or a page with no items), while the "Sales
    rooms" calendar exists. Worker.calendar() reads that as "not there" and
    makes a new one: a POST that is never repeated by design ("a second
    calendar would be made"), made here on a read nobody could use. Each
    minute's run starts with no calendar id, so the list is read again, and
    the two calendars of the same name split the Meet rooms by sort order."""

    def setUp(self):
        super().setUp()
        self.env.google.calendars = [{"id": "aaa-rooms@group.calendar.example.test", "summary": "Sales rooms"}]
        self.env.google.ready_after = 0

    def garble_list(self, body: bytes) -> None:
        google = self.env.google
        done = {"n": 0}

        class Garbled:
            def __getattr__(self, name):
                return getattr(google, name)

            def __call__(self, method, url, data):
                if method == "GET" and "users/me/calendarList" in url and done["n"] == 0:
                    done["n"] += 1
                    google.calls.append((method, "users/me/calendarList", {}, None))
                    return 200, {}, body
                return google(method, url, data)

        self.env.net.google = Garbled()  # type: ignore[assignment]

    def made_calendars(self) -> int:
        return sum(1 for c in self.env.google.calls if c[0] == "POST" and c[1] == "calendars")

    def run_minutes(self, n: int) -> None:
        for _ in range(n):
            self.tick(self.env.worker("run-a"))
            self.env.clock.advance(5)

    def test_held_the_list_answers_the_existing_calendar_is_used(self):
        self.env.add_room(provider="meet")
        self.run_minutes(6)
        self.assertEqual(self.made_calendars(), 0)
        self.assertEqual(self.env.room()["state"], "open")

    def test_calendar_list_empty_200_makes_a_second_sales_rooms_calendar(self):
        self.env.add_room(provider="meet")
        self.garble_list(b"")
        self.run_minutes(6)
        made = self.made_calendars()
        self.assertEqual(
            made, 0,
            "an empty 200 from Google's calendar list was read as 'no Sales rooms calendar', and a second "
            f"one was made on the CEO's account (calendars now: {[c['summary'] for c in self.env.google.calendars]})")


if __name__ == "__main__":
    unittest.main()
