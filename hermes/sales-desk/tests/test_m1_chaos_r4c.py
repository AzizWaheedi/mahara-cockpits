"""Milestone 1, video-link round 4 (chaos, second pass), the room worker.

Zoom's user lookup (GET /users/{email or id}) answers a gateway's or a CDN's
404 page: an HTML body with no Zoom error code, the kind of page an edge in
front of an API serves for a moment during an incident (HighLevel's gateway
does it; round 2's gateway-404-page-read-as-lead-gone). Zoom's own "this
user does not exist" is a 404 with its JSON code 1001.

ProviderError.gone reads any 404 as "gone", so the worker takes the page as
Zoom saying the closer has no user on Mahara's account:
  - the closer's Zoom room fails at once with "Your email has no Zoom user on
    Mahara's account. Use Meet, and ask the CEO to add you in Zoom.", and the
    answer is kept for five minutes, so every Zoom room the closer asks for
    in that time fails the same way;
  - the host check (every ten minutes) writes zoom_status "missing" on the
    closer's licensed seat, so sales-api refuses the closer's Zoom rooms with
    the same sentence until the next check.

Not knowing is not missing (stress2 round 5, zoom-user-garbage-read-as-
missing; m1 round 4, pending-list-blip-says-no-zoom-user): a page that is not
Zoom's answer about the user should leave the seat as it was last known, and
the room should wait for the next read or say Zoom did not answer.

Every room, seat, meeting and key is invented, and nothing reaches the
network.

    python3 -m unittest tests.test_m1_chaos_r4c
"""
from __future__ import annotations

import os
import unittest
from typing import Any, Optional

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests import test_rooms as tr  # noqa: E402

CLOSER = tr.CLOSER
PAGE = b"<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center></body></html>"


class ZoomUserGateway404(tr.RoomsCase):
    def seat(self, *, linked: bool) -> None:
        self.env.pg.put("cockpit_sales_people", {"email": CLOSER, "name": "Invented Name", "role": "closer",
                                                 "active": True, "via_portal": True})
        row: dict[str, Any] = {"email": CLOSER, "zoom_status": "licensed", "google_ok": True}
        if linked:
            row["zoom_user_id"] = "zu-closer"  # the host check stored it on its first run
        self.env.pg.put(rooms.HOSTS, row)
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]

    def page_on_user_lookup(self, n: int, body: bytes = PAGE, status: int = 404) -> None:
        """The next n user lookups (GET /users/{who}) answer a page with no Zoom error in it."""
        zoom = self.env.zoom
        left = {"n": n}

        class Edge:
            """Zoom's API behind an edge that serves a page instead of Zoom's answer."""

            def __getattr__(self, name: str) -> Any:
                return getattr(zoom, name)

            def __setattr__(self, name: str, value: Any) -> None:
                setattr(zoom, name, value)

            def __call__(self, method: str, url: str, data: Optional[bytes]) -> tuple[int, dict, bytes]:
                path = url.split("/v2", 1)[-1].split("?", 1)[0]
                seg = path.strip("/").split("/")
                if method == "GET" and seg[0] == "users" and len(seg) == 2 and left["n"] > 0:
                    left["n"] -= 1
                    zoom.calls.append((method, path, {}, None))
                    raise HttpError(status, body.decode(), body, url)
                return zoom(method, url, data)

        self.env.net.zoom = Edge()  # type: ignore[assignment]

    def zoom_room(self) -> dict[str, Any]:
        return self.env.add_room(1, provider="zoom", host_email=CLOSER, call_kind="demo", purpose="manual")

    # ---- held: Zoom's own answers ---------------------------------------------------
    def test_held_zoom_own_404_says_no_zoom_user(self):
        """Zoom's own "User does not exist" (404, code 1001): the room fails with the no-user sentence, as it should."""
        self.seat(linked=False)
        self.env.zoom.users.pop(CLOSER)
        self.zoom_room()
        self.tick(self.env.worker())
        self.assertEqual((self.env.room(1)["state"], self.env.room(1)["error"]), ("failed", rooms.SAY["no_user"]))

    def test_held_a_503_on_the_user_lookup_is_not_no_user(self):
        self.seat(linked=False)
        self.page_on_user_lookup(3, body=b"<html>503 Service Unavailable</html>", status=503)
        self.zoom_room()
        self.tick(self.env.worker())
        self.assertNotEqual(self.env.room(1).get("error"), rooms.SAY["no_user"])

    # ---- the finding ----------------------------------------------------------------------
    def test_m1_chaos_r4c_zoom_gateway_404_page_fails_room_as_no_zoom_user(self):
        """The closer's first Zoom room (no Zoom user stored yet): one 404 page on the lookup."""
        self.seat(linked=False)
        self.page_on_user_lookup(1)
        self.zoom_room()
        self.tick(self.env.worker())
        row = self.env.room(1)
        # What should hold: a page that is not Zoom's answer is not "no user"; the room is made
        # (or waits for the next read, or says Zoom did not answer), never told to ask the CEO to add a user.
        self.assertEqual({"state": row["state"], "says_no_user": row.get("error") == rooms.SAY["no_user"]},
                         {"state": "open", "says_no_user": False},
                         f"the closer's Zoom room: {row['state']}, {row.get('error')!r}")

    def test_m1_chaos_r4c_zoom_gateway_404_page_fails_room_with_linked_user(self):
        """The closer's Zoom user stored by the host check (the pilot's usual case): the page on the
        lookup by id and on the lookup by email that follows it."""
        self.seat(linked=True)
        self.page_on_user_lookup(2)
        self.zoom_room()
        self.tick(self.env.worker())
        row = self.env.room(1)
        self.assertEqual({"state": row["state"], "says_no_user": row.get("error") == rooms.SAY["no_user"]},
                         {"state": "open", "says_no_user": False},
                         f"the closer's Zoom room: {row['state']}, {row.get('error')!r}")

    def test_m1_chaos_r4c_zoom_gateway_404_page_marks_licensed_seat_missing(self):
        """The host check, the closer's Zoom user stored: the lookup by id and the one by email both get the page."""
        self.seat(linked=True)
        self.page_on_user_lookup(2)
        out = self.env.worker().check_hosts()
        row = self.env.pg.one(rooms.HOSTS, email=CLOSER)
        self.assertEqual({"zoom_status": row.get("zoom_status"),
                          "line_says_no_user": any("no Zoom user" in line for line in out["lines"])},
                         {"zoom_status": "licensed", "line_says_no_user": False},
                         f"lines: {out['lines']}")

    def test_m1_chaos_r4c_zoom_gateway_404_page_kept_five_minutes(self):
        """After one page, the closer's next Zoom room four minutes later fails the same way, with Zoom answering."""
        self.seat(linked=False)
        self.page_on_user_lookup(1)
        self.zoom_room()
        w = self.env.worker()
        self.tick(w)
        first = self.env.room(1)
        self.env.clock.advance(240)
        self.env.add_room(2, provider="zoom", host_email=CLOSER, call_kind="demo", purpose="manual",
                          contact_id="contact-test-2b", requested_at=rooms.iso(self.env.clock() - 1))
        w.deadline = self.env.clock() + rooms.RUN_SECONDS
        w.hard_stop = w.deadline + rooms.HARD_SLACK
        self.tick(w)
        second = self.env.room(2)
        self.assertEqual({"first": first.get("error") == rooms.SAY["no_user"], "second": second["state"]},
                         {"first": False, "second": "open"},
                         f"first: {first['state']} {first.get('error')!r}; second: {second['state']} {second.get('error')!r}")



class FailWriteLostThenMade(tr.RoomsCase):
    """The worker decides a Meet room cannot be made (Google's sign-in
    answered 503 on each try), stores its worker.failed event ("The room was
    not made. Google did not answer. Try again in a minute, or use Zoom."),
    and its write of the failed state never lands (the database answers
    503). The next tick finds the room still being made by this run and
    makes it: the room opens, worker.ready goes, the link goes to the lead.
    The stored worker.failed stays in the room's timeline (sales-api's replay
    finishes it as "the room was already open" and keeps its words), so the
    rep's panel reads "The room was not made" under a room that was made and
    whose link went, which m1 round 1 (cut-answer-escapes-http-layer) ruled
    out: "its timeline never says it was not made"."""

    def setUp(self):
        super().setUp()
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        self.env.google.ready_after = 0
        real_token = self.env.google.token
        left = {"n": 6}  # the sign-in and its two retries, asked twice by _calendar_or_fail

        def token(method: str, data: Optional[bytes]) -> tuple[int, dict, bytes]:
            if left["n"] > 0:
                left["n"] -= 1
                self.env.google.tokens += 1
                raise HttpError(503, '{"error":"backendError"}', b'{"error":"backendError"}',
                                "https://oauth2.googleapis.com/token")
            return real_token(method, data)

        self.env.google.token = token  # type: ignore[method-assign]
        pg = self.env.pg
        dropped = {"n": 1}

        class Db:
            """PostgREST: the room's failed write is answered 503 and does not land, once."""

            def __getattr__(self, name: str) -> Any:
                return getattr(pg, name)

            def __call__(self, method: str, url: str, **kw: Any) -> tuple[int, dict, bytes]:
                body = kw.get("data")
                if (method == "PATCH" and "/rest/v1/cockpit_sales_rooms" in url and body
                        and b'"failed"' in body and dropped["n"] > 0):
                    dropped["n"] -= 1
                    raise HttpError(503, '{"message":"upstream connect error"}', b"", url)
                return pg(method, url, **kw)

        self.env.net.pg = Db()  # type: ignore[assignment]
        # The event lease as production answers it (20261003a): the worker
        # closes its own stored events through it.
        from tests.test_m1_chaos_r1 import lease_rpc
        lease_rpc(self.env)

    def test_m1_chaos_r4c_fail_write_lost_room_made_timeline_says_not_made(self):
        self.env.add_room(1, provider="meet")
        self.env.worker().run(seconds=8)
        row = self.env.room(1)
        events = {e["kind"]: e for e in self.env.pg.rows(rooms.EVENTS) if e.get("room_id") == rid(1)}
        failed = events.get("worker.failed")
        self.assertEqual(row["state"], "open", f"precondition: the room was made after all ({row.get('error')!r})")
        self.assertIn("worker.ready", events)
        # What should hold: a room that opened never carries a "The room was not made" line in its
        # timeline (the event is closed as not true, or never stored before the write lands).
        self.assertFalse(failed is not None and "not made" in str(failed.get("text") or "").lower()
                         and not (failed.get("detail") or {}).get("closed_by"),
                         f"the open room's timeline says: {failed and failed.get('text')!r}; "
                         f"sales-api kinds: {self.env.api.kinds(rid(1))}")



class SettingsBlipAtRunStart(tr.RoomsCase):
    """Every minute a new run starts, and its first database call reads the
    rooms setting. When that one read fails fast (a 503, a dropped
    connection, a gateway's page), the run's first tick (the same second)
    skips the claims and writes its status row at once: "Not making rooms:
    The rooms setting could not be read, so no new room is made until it can
    be." (ok false). The next tick, one second later, reads the setting and
    makes rooms, but the status row is written again only 25 seconds later.

    sales-api reads that row on every Send a video link (rooms.ts createPrep,
    roomlogic.ts workerNotMaking): for those 25 seconds every press is
    refused with "Video rooms are down right now. Call the lead on the
    phone, or send your own Zoom or Meet link.", and the Team page's health
    line says the worker makes no rooms, while it is making them."""

    def setUp(self):
        super().setUp()
        pg = self.env.pg
        left = {"n": 1}

        class Db:
            def __getattr__(self, name: str) -> Any:
                return getattr(pg, name)

            def __call__(self, method: str, url: str, **kw: Any) -> tuple[int, dict, bytes]:
                if method == "GET" and "/rest/v1/cockpit_sales_settings" in url and "key=eq.rooms" in url and left["n"] > 0:
                    left["n"] -= 1
                    raise HttpError(503, '{"message":"upstream connect error"}', b"", url)
                return pg(method, url, **kw)

        self.env.net.pg = Db()  # type: ignore[assignment]

    def test_held_without_the_blip_the_status_row_says_working(self):
        self.env.net.pg = self.env.pg  # type: ignore[assignment]
        seen: dict[str, Any] = {}
        start = self.env.clock()
        self.env.clock.at(start + 5, lambda: seen.update(self.env.pg.one(rooms.STATUS, worker=rooms.WORKER, job=rooms.JOB) or {}))
        self.env.add_room(1, provider="zoom", host_email=CLOSER, call_kind="demo", purpose="manual")
        self.env.worker().run(seconds=10)
        self.assertFalse(str(seen.get("detail") or "").startswith(rooms.NOT_MAKING), seen.get("detail"))

    def test_m1_chaos_r4c_settings_blip_at_run_start_says_not_making_while_making(self):
        seen: dict[str, Any] = {}
        start = self.env.clock()
        room_at: dict[str, Any] = {}

        def look() -> None:
            seen.update(self.env.pg.one(rooms.STATUS, worker=rooms.WORKER, job=rooms.JOB) or {})
            room_at.update(self.env.room(1) or {})

        self.env.clock.at(start + 5, look)
        self.env.add_room(1, provider="zoom", host_email=CLOSER, call_kind="demo", purpose="manual")
        self.env.worker().run(seconds=30)
        # Five seconds into the run the worker has read the setting and made the room...
        self.assertEqual(room_at.get("state"), "open", f"precondition: the room is made by then ({room_at.get('error')!r})")
        # ...and what should hold: the row sales-api reads at every press does not say it makes no rooms.
        self.assertFalse(bool(seen.get("ok") is False and str(seen.get("detail") or "").startswith(rooms.NOT_MAKING)),
                         f"at +5 s the status row says (ok={seen.get('ok')}): {seen.get('detail')!r}")



class ProviderPageInTheRepsSentence(tr.RoomsCase):
    """A provider's edge answers the create with its own HTML error page (a
    403 from a firewall in front of the API, a 400 page): the worker's
    sentence for the rep is "Zoom refused to make the room: {why}. Use
    Meet.", and {why} is the page's text, so the panel shows the rep raw
    HTML."""

    def test_m1_chaos_r4c_zoom_edge_403_page_reaches_reps_sentence(self):
        self.env.pg.put(rooms.HOSTS, {"email": CLOSER, "zoom_status": "licensed", "google_ok": True,
                                      "zoom_user_id": "zu-closer"})
        page = "<html><head><title>403 Forbidden</title></head><body><h1>Access denied</h1></body></html>"
        zoom = self.env.zoom
        left = {"n": 1}

        class Edge:
            def __getattr__(self, name: str) -> Any:
                return getattr(zoom, name)

            def __setattr__(self, name: str, value: Any) -> None:
                setattr(zoom, name, value)

            def __call__(self, method: str, url: str, data: Optional[bytes]) -> tuple[int, dict, bytes]:
                if method == "POST" and "/meetings" in url and left["n"] > 0:
                    left["n"] -= 1
                    raise HttpError(403, page, page.encode(), url)
                return zoom(method, url, data)

        self.env.net.zoom = Edge()  # type: ignore[assignment]
        self.env.add_room(1, provider="zoom", host_email=CLOSER, call_kind="demo", purpose="manual")
        self.tick(self.env.worker())
        row = self.env.room(1)
        self.assertNotIn("<", str(row.get("error") or ""), f"the rep reads: {row.get('error')!r}")


def rid(n: int) -> str:
    return tr.rid(n)


if __name__ == "__main__":
    unittest.main()
