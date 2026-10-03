"""The room worker: claims, Zoom and Meet rooms, refusals, crash recovery,
closing, the loop's minute, the status row and the host check. Every room,
seat, meeting and key is invented, and no test reaches the network: Zoom,
Google and sales-api are fakes behind the same HTTP layer as the in-memory
PostgREST.

    python3 -m unittest tests.test_rooms
"""
from __future__ import annotations

import base64
import contextlib
import importlib.util
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.parse
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http  # noqa: E402
from desk import rooms  # noqa: E402
from desk.config import ROOT  # noqa: E402
from desk.http import HttpError  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402

# The room tables, as the in-memory PostgREST keys them.
fakes.PK.setdefault(rooms.ROOMS, ("id",))
fakes.PK.setdefault(rooms.SECRETS, ("room_id",))
fakes.PK.setdefault(rooms.EVENTS, ("dedupe_key",))
fakes.PK.setdefault(rooms.HOSTS, ("email",))
fakes.PK.setdefault(rooms.ALERTS, ("dedupe_key",))

DB = "https://db.test"
T0 = datetime(2026, 10, 3, 10, 0, tzinfo=timezone.utc).timestamp()  # 13:00 Kuwait, a Saturday
SETTER = "setter@example.test"
CLOSER = "closer@example.test"


def rid(n: int) -> str:
    return str(uuid.UUID(int=0x8A1F6C2E4B3D4F5E9A7B000000000000 + n))


class Clock:
    """Time that moves only when the worker sleeps or a fake says a call took
    a while; things a test schedules happen at their second."""

    def __init__(self, t: float = T0):
        self.t = t
        self.slept = 0.0
        self.plan: list[tuple[float, Callable[[], None]]] = []

    def __call__(self) -> float:
        return self.t

    def at(self, t: float, fn: Callable[[], None]) -> None:
        self.plan.append((t, fn))
        self.plan.sort(key=lambda x: x[0])

    def advance(self, s: float) -> None:
        end = self.t + max(0.0, s)
        while self.plan and self.plan[0][0] <= end:
            t, fn = self.plan.pop(0)
            self.t = max(self.t, t)
            fn()
        self.t = end

    def sleep(self, s: float) -> None:
        self.slept += max(0.0, s)
        self.advance(s)


class Log:
    def __init__(self):
        self.lines: list[tuple[str, str]] = []

    def info(self, m: str) -> None:
        self.lines.append(("INFO", m))

    def warn(self, m: str) -> None:
        self.lines.append(("WARN", m))

    def error(self, m: str) -> None:
        self.lines.append(("ERROR", m))


def _err(status: int, body: Any, url: str) -> HttpError:
    raw = json.dumps(body).encode()
    return HttpError(status, raw.decode(), raw, url)


class FakeZoom:
    """Zoom's REST API for the calls the worker makes. `script` entries fail
    the next matching call: {method, path, status, body, make}; `make` makes
    the meeting anyway before failing, as a timeout after Zoom did the work."""

    def __init__(self, clock: Clock):
        self.clock = clock
        self.users: dict[str, dict[str, Any]] = {
            SETTER: {"id": "zu-setter", "email": SETTER, "type": 2, "status": "active"},
            CLOSER: {"id": "zu-closer", "email": CLOSER, "type": 2, "status": "active"},
        }
        self.pending: set[str] = set()
        self.meetings: dict[str, dict[str, Any]] = {}
        self.live: dict[str, list[dict[str, Any]]] = {}
        self.calls: list[tuple[str, str, dict[str, str], Any]] = []
        self.script: list[dict[str, Any]] = []
        self.latency = 0.0
        self.after_create: Optional[Callable[[dict[str, Any]], None]] = None
        self.next_id = 81000000001
        self.tokens = 0
        # Who is in each live meeting now (the dashboard list), by meeting id;
        # `participants_api` False answers as an account without that API.
        self.participants: dict[str, list[dict[str, Any]]] = {}
        self.participants_api = True
        # Zoom's participant report of finished meetings, by uuid or id.
        self.past: dict[str, list[dict[str, Any]]] = {}
        self.past_api = True
        self.call_timeout = 60.0   # the timeout of the call in flight, set by Net

    def uid(self, who: str) -> str:
        return self.users[who]["id"] if who in self.users else who

    def token(self, method: str, url: str) -> tuple[int, dict, bytes]:
        self.tokens += 1
        assert method == "POST" and "grant_type=account_credentials" in url
        return 200, {}, json.dumps({"access_token": "zoom-test-token", "expires_in": 3600}).encode()

    def _make(self, user: str, body: dict[str, Any]) -> dict[str, Any]:
        mid = str(self.next_id)
        self.next_id += 1
        m = {"id": int(mid), "uuid": f"uuid{mid}==", "topic": body["topic"], "host": self.uid(user),
             "host_id": self.uid(user), "status": "waiting",
             "join_url": f"https://zoom.example.test/j/{mid}", "start_url": f"https://zoom.example.test/s/{mid}?zak=host-only",
             "password": "x1y2z3", "encrypted_password": f"enc{mid}", "settings": body.get("settings")}
        self.meetings[mid] = m
        return m

    def __call__(self, method: str, url: str, data: Optional[bytes]) -> tuple[int, dict, bytes]:
        parts = urllib.parse.urlsplit(url)
        path = urllib.parse.unquote(parts.path[len("/v2"):])
        query = dict(urllib.parse.parse_qsl(parts.query))
        body = json.loads(data.decode()) if data else None
        self.calls.append((method, path, query, body))
        self.clock.advance(self.latency)
        for i, s in enumerate(self.script):
            if s["method"] == method and (path == s["path"] if s.get("exact") else s["path"] in path):
                self.script.pop(i)
                if s.get("make"):
                    self._make(path.split("/")[2], body)
                # `delay`: the answer comes this late, or the caller's timeout
                # ends the call first.
                if s.get("delay", 0.0) > self.call_timeout:
                    self.clock.advance(self.call_timeout)
                    raise HttpError(0, "TimeoutError: timed out", b"", url)
                self.clock.advance(s.get("delay", 0.0))
                raise _err(s["status"], s.get("body", {"code": 0, "message": "scripted failure"}), url)
        seg = path.strip("/").split("/")
        if seg[0] == "users" and len(seg) == 1:
            return self._ok({"users": [{"email": e} for e in sorted(self.pending)]})
        if seg[0] == "users" and len(seg) == 2:
            u = self.users.get(seg[1])
            if not u:
                raise _err(404, {"code": 1001, "message": f"User does not exist: {seg[1]}."}, url)
            return self._ok(u)
        if seg[0] == "users" and seg[2] == "meetings":
            host = self.uid(seg[1])
            if method == "POST":
                m = self._make(seg[1], body)
                if self.after_create:
                    self.after_create(m)
                return self._ok({k: v for k, v in m.items() if k != "host"}, 201)
            if query.get("type") == "live":
                return self._ok({"meetings": self.live.get(host, [])})
            return self._ok({"meetings": [{"id": m["id"], "topic": m["topic"]} for m in self.meetings.values()
                                          if m["host"] == host]})
        if seg[0] == "metrics" and seg[3] == "participants":
            if not self.participants_api:
                raise _err(400, {"code": 4711, "message": "Invalid access token, does not contain scopes."}, url)
            return self._ok({"participants": self.participants.get(seg[2], [])})
        if seg[0] == "past_meetings" and seg[2] == "participants":
            if not self.past_api:
                raise _err(400, {"code": 4711, "message": "Invalid access token, does not contain scopes."}, url)
            ref = urllib.parse.unquote(seg[1])
            if ref not in self.past:
                raise _err(404, {"code": 3001, "message": "Meeting does not exist."}, url)
            return self._ok({"participants": self.past[ref]})
        if seg[0] == "meetings":
            m = self.meetings.get(seg[1])
            if not m:
                raise _err(404, {"code": 3001, "message": "Meeting does not exist."}, url)
            if method == "GET":
                return self._ok(m)
            if method == "PUT":
                m["status"] = "ended"
                return 204, {}, b""
            if method == "DELETE":
                if m["status"] == "started":
                    raise _err(400, {"code": 3002, "message": "Meeting in progress."}, url)
                del self.meetings[seg[1]]
                return 204, {}, b""
        raise AssertionError(f"Zoom call not modelled: {method} {path}")

    @staticmethod
    def _ok(obj: Any, status: int = 200) -> tuple[int, dict, bytes]:
        return status, {}, json.dumps(obj).encode()

    def count(self, method: str, piece: str) -> int:
        return sum(1 for c in self.calls if c[0] == method and piece in c[1])


class FakeGoogle:
    """Calendar: a calendar list, calendars, and events whose Meet link is
    pending for `ready_after` reads (None: never ready)."""

    def __init__(self, clock: Clock):
        self.clock = clock
        self.calendars: list[dict[str, Any]] = []
        self.events: dict[tuple[str, str], dict[str, Any]] = {}
        self.reads: dict[str, int] = {}
        self.ready_after: Optional[int] = 2
        self.calls: list[tuple[str, str, dict[str, str], Any]] = []
        self.script: list[dict[str, Any]] = []
        self.tokens = 0
        self.latency = 0.0
        self.scope: Optional[str] = None   # the token answer's "scope", when a test gives one
        self.token_status = 200

    def token(self, method: str, data: Optional[bytes]) -> tuple[int, dict, bytes]:
        self.tokens += 1
        form = dict(urllib.parse.parse_qsl((data or b"").decode()))
        assert method == "POST" and form.get("grant_type") == "refresh_token"
        if self.token_status != 200:
            raise _err(self.token_status, {"error": "invalid_grant", "error_description": "Token has been revoked."},
                       "https://oauth2.googleapis.com/token")
        answer = {"access_token": "google-test-token", "expires_in": 3600}
        if self.scope is not None:
            answer["scope"] = self.scope
        return 200, {}, json.dumps(answer).encode()

    def _event(self, ev: dict[str, Any]) -> dict[str, Any]:
        n = self.reads.get(ev["id"], 0)
        ready = self.ready_after is not None and n > self.ready_after
        out = dict(ev)
        if ready:
            out["hangoutLink"] = "https://meet.example.test/abc-defg-hij"
            out["conferenceData"] = {"conferenceId": "abc-defg-hij",
                                     "createRequest": {"status": {"statusCode": "success"}},
                                     "entryPoints": [{"entryPointType": "video", "uri": out["hangoutLink"]}]}
        else:
            out["conferenceData"] = {"createRequest": {"status": {"statusCode": "pending"}}}
        return out

    def __call__(self, method: str, url: str, data: Optional[bytes]) -> tuple[int, dict, bytes]:
        parts = urllib.parse.urlsplit(url)
        path = urllib.parse.unquote(parts.path[len("/calendar/v3/"):])
        query = dict(urllib.parse.parse_qsl(parts.query))
        body = json.loads(data.decode()) if data else None
        self.calls.append((method, path, query, body))
        self.clock.advance(self.latency)
        for i, s in enumerate(self.script):
            if s["method"] == method and s["path"] in path:
                self.script.pop(i)
                raise _err(s["status"], s.get("body", {"error": {"code": s["status"], "message": "scripted"}}), url)
        if path == "users/me/calendarList":
            return 200, {}, json.dumps({"items": self.calendars}).encode()
        if path.endswith("/events") and method == "GET":
            return 200, {}, json.dumps({"items": []}).encode()
        if path == "calendars" and method == "POST":
            cal = {"id": f"sales-rooms-{len(self.calendars) + 1}@group.calendar.example.test", "summary": body["summary"]}
            self.calendars.append(cal)
            return 200, {}, json.dumps(cal).encode()
        seg = path.split("/")
        if seg[0] == "calendars" and seg[2] == "events":
            cal = seg[1]
            if method == "POST":
                if (cal, body["id"]) in self.events:
                    raise _err(409, {"error": {"code": 409, "message": "The requested identifier already exists."}}, url)
                self.events[(cal, body["id"])] = dict(body)
                self.reads[body["id"]] = 0
                return 200, {}, json.dumps(self._event(body)).encode()
            ev = self.events.get((cal, seg[3]))
            if not ev:
                raise _err(404, {"error": {"code": 404, "message": "Not Found"}}, url)
            self.reads[seg[3]] = self.reads.get(seg[3], 0) + 1
            return 200, {}, json.dumps(self._event(ev)).encode()
        raise AssertionError(f"Google call not modelled: {method} {path}")

    def count(self, method: str, piece: str) -> int:
        return sum(1 for c in self.calls if c[0] == method and piece in c[1])


class FakeApi:
    """sales-api's desk door: records each room.event; `script` holds the
    statuses of the next answers."""

    def __init__(self):
        self.bodies: list[dict[str, Any]] = []
        self.headers: list[dict[str, str]] = []
        self.script: list[int] = []
        self.latency = 0.0

    def __call__(self, method: str, url: str, headers: dict[str, str], data: Optional[bytes]) -> tuple[int, dict, bytes]:
        body = json.loads((data or b"{}").decode())
        self.bodies.append(body)
        self.headers.append(dict(headers))
        status = self.script.pop(0) if self.script else 200
        if status >= 400:
            raise _err(status, {"error": "scripted"}, url)
        return 200, {}, b'{"ok":true}'

    def kinds(self, room_id: Optional[str] = None) -> list[str]:
        return [b["kind"] for b in self.bodies if room_id is None or b["room_id"] == room_id]


class Net:
    """The one HTTP layer every call goes through, routed by host. Any other
    host fails the test: nothing may reach the network."""

    def __init__(self, clock: Clock, pg: FakePostgrest, zoom: FakeZoom, google: FakeGoogle, api: FakeApi):
        self.clock, self.pg, self.zoom, self.google, self.api = clock, pg, zoom, google, api
        self.log: list[tuple[float, str, str, float, int]] = []
        self.lock = threading.Lock()

    def __call__(self, method: str, url: str, *, headers: Optional[dict[str, str]] = None, data: Optional[bytes] = None,
                 json_body: Any = None, timeout: float = 60, retries: int = 2,
                 ok_statuses: tuple[int, ...] = (200, 201, 202, 204)) -> tuple[int, dict, bytes]:
        self.log.append((self.clock(), method, url, timeout, retries))
        host = urllib.parse.urlsplit(url).netloc
        if host == "db.test":
            if "/functions/v1/sales-api" in url:
                if self.api.latency > timeout:
                    self.clock.advance(timeout)
                    self.api.bodies.append(json.loads((data or b"{}").decode()))
                    raise HttpError(0, "TimeoutError: timed out", b"", url)
                self.clock.advance(self.api.latency)
                return self.api(method, url, headers or {}, data)
            with self.lock:
                return self.pg(method, url, headers=headers, data=data, json_body=json_body, timeout=timeout,
                               retries=retries, ok_statuses=ok_statuses)
        if host == "zoom.us":
            return self.zoom.token(method, url)
        if host == "api.zoom.us":
            self.zoom.call_timeout = timeout
            if self.zoom.latency > timeout:
                self.clock.advance(timeout)
                raise HttpError(0, "TimeoutError: timed out", b"", url)
            return self.zoom(method, url, data)
        if host == "oauth2.googleapis.com":
            return self.google.token(method, data)
        if host == "www.googleapis.com":
            if self.google.latency > timeout:
                self.clock.advance(timeout)
                raise HttpError(0, "TimeoutError: timed out", b"", url)
            return self.google(method, url, data)
        raise AssertionError(f"a test reached for the network: {url}")


class Env:
    def __init__(self):
        self.clock = Clock()
        self.pg = FakePostgrest()
        self.zoom = FakeZoom(self.clock)
        self.google = FakeGoogle(self.clock)
        self.api = FakeApi()
        self.net = Net(self.clock, self.pg, self.zoom, self.google, self.api)
        self.sb = Supabase(DB, "service-test-key", timeout=10)
        self.log = Log()
        self.pg.put("cockpit_sales_settings", {"key": "rooms", "value": {
            "enabled": True, "test_only": True, "providers": {"zoom": True, "meet": True},
            "default_provider": {"setter": "meet", "closer": "zoom"},
            "waits_s": {"fail": 60, "meet_pending": 30, "handover_host": 120, "standby_host": 300, "fallback_host": 900},
            "lengths_min": {"intro": 30, "demo": 60}}})

    def worker(self, run_id: str = "run-a", *, zoom: bool = True, google: bool = True) -> rooms.Worker:
        send = rooms.Sender(self.clock, self.clock.sleep)
        w = rooms.Worker(
            self.sb, zoom=rooms.Zoom("test-account", "test-client", "test-secret", send) if zoom else None,
            google=rooms.Google("test-gid", "test-gsecret", "test-refresh", "GOOGLE_CAL_*", send) if google else None,
            api=rooms.SalesApi(DB, "service-test-key", send), log=self.log, clock=self.clock, sleep=self.clock.sleep,
            run_id=run_id)
        send.left = w.left
        return w

    def add_room(self, n: int = 1, **over: Any) -> dict[str, Any]:
        row = {"id": rid(n), "code": over.pop("code", f"K7Q2M{chr(ord('A') + n % 26)}"), "state": "requested",
               "version": 1, "provider": "zoom", "purpose": "fallback", "call_kind": "intro", "host_email": SETTER,
               "contact_id": f"contact-test-{n}", "requested_at": rooms.iso(self.clock() - 1), "send_on": "open",
               "worker_run": None, "claimed_at": None, "lead_in_at": None, "host_by": None, "ends_at": None,
               "join_url": None, "provider_meeting_id": None}
        row.update(over)
        return self.pg.put(rooms.ROOMS, row)

    def room(self, n: int = 1) -> dict[str, Any]:
        return self.pg.one(rooms.ROOMS, id=rid(n))

    def status_writes(self) -> list[float]:
        return [t for t, m, u, _to, _r in self.net.log if m == "POST" and "cockpit_sales_worker_status" in u]


class RoomsCase(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.patch = mock.patch.object(http, "request", self.env.net)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def tick(self, w: rooms.Worker) -> None:
        w.run(seconds=0)


# ---- pure helpers -------------------------------------------------------------


class Helpers(unittest.TestCase):
    def test_event_ids_are_base32hex_of_the_room_uuid(self):
        room = rid(7)
        std = base64.b32encode(uuid.UUID(room).bytes).decode().rstrip("=")
        table = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", "0123456789abcdefghijklmnopqrstuv")
        self.assertEqual(rooms.event_id(room), std.translate(table))
        self.assertEqual(len(rooms.event_id(room)), 26)
        self.assertRegex(rooms.event_id(room), r"^[0-9a-v]+$")
        self.assertEqual(rooms.event_id(room), rooms.event_id(room.upper()))

    def test_timestamps_with_any_fraction_parse(self):
        base = datetime(2026, 10, 3, 10, 0, 1, tzinfo=timezone.utc).timestamp()
        for text in ("2026-10-03T10:00:01Z", "2026-10-03T10:00:01+00:00", "2026-10-03T13:00:01+03:00",
                     "2026-10-03 10:00:01.12345+00", "2026-10-03T10:00:01.123"):
            self.assertAlmostEqual(rooms.parse_ts(text), base, delta=0.2, msg=text)
        self.assertIsNone(rooms.parse_ts("yesterday"))
        self.assertIsNone(rooms.parse_ts(None))

    def test_the_passcode_goes_into_the_link_once(self):
        m = {"encrypted_password": "abc"}
        self.assertEqual(rooms.with_passcode("https://z.test/j/1", m), "https://z.test/j/1?pwd=abc")
        self.assertEqual(rooms.with_passcode("https://z.test/j/1?pwd=abc", m), "https://z.test/j/1?pwd=abc")
        self.assertEqual(rooms.with_passcode("https://z.test/j/1", {}), "https://z.test/j/1")

    def test_default_rooms_follow_role_and_what_works(self):
        d = {"setter": "meet", "closer": "zoom"}
        self.assertEqual(rooms.default_provider("setter", "pending", True, d), "meet")
        self.assertEqual(rooms.default_provider("closer", "licensed", True, d), "zoom")
        self.assertEqual(rooms.default_provider("closer", "pending", True, d), "meet")
        self.assertEqual(rooms.default_provider("setter", "basic", False, d), "zoom")
        self.assertEqual(rooms.default_provider("setter", None, None, {}), "meet")


# ---- the claim -------------------------------------------------------------------


class Claim(RoomsCase):
    def test_two_runs_with_the_same_snapshot_one_wins(self):
        self.env.add_room()
        snapshot = dict(self.env.room())
        a, b = self.env.worker("run-a"), self.env.worker("run-b")
        self.assertIsNotNone(a.claim(snapshot))
        self.assertIsNone(b.claim(snapshot))
        self.assertEqual((self.env.room()["state"], self.env.room()["worker_run"]), ("creating", "run-a"))

    def test_fifty_claims_at_once_give_exactly_one_winner(self):
        # The fake database answers one call at a time (Net.lock), so this
        # proves the filter the worker sends, not Postgres's row lock: that
        # one conditional UPDATE wins is the database's guarantee, tested on
        # the SQL side. What the worker owns is checked below: every claim is
        # conditional on `requested`, and a lost race is no claim.
        self.env.add_room()
        snapshot = dict(self.env.room())
        workers = [self.env.worker(f"run-{i}") for i in range(50)]
        wins: list[str] = []
        gate = threading.Barrier(50)

        def go(w: rooms.Worker) -> None:
            gate.wait()
            if w.claim(snapshot):
                wins.append(w.run_id)

        threads = [threading.Thread(target=go, args=(w,)) for w in workers]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(wins), 1)
        self.assertEqual(self.env.room()["worker_run"], wins[0])
        claims = [u for _t, m, u, _to, _r in self.env.net.log if m == "PATCH" and "cockpit_sales_rooms?" in u]
        self.assertEqual(len(claims), 50)
        self.assertTrue(all(urllib.parse.unquote(u).endswith("&state=eq.requested") for u in claims))

    def test_runs_that_overlap_make_each_room_once(self):
        for n in (1, 2, 3):
            self.env.add_room(n, host_email=SETTER if n == 1 else f"rep{n}@example.test")
            self.env.zoom.users[f"rep{n}@example.test"] = {"id": f"zu-{n}", "type": 2, "status": "active"}
        a, b = self.env.worker("run-a"), self.env.worker("run-b")
        real = a.make_zoom
        state = {"done": False}

        def interleaved(room):
            # While run A is still making its first room, run B ticks over
            # the same rows.
            if not state["done"]:
                state["done"] = True
                b.run(seconds=0)
            return real(room)

        a.make_zoom = interleaved  # type: ignore[assignment]
        a.run(seconds=0)
        self.assertEqual(len(self.env.zoom.meetings), 3)
        for n in (1, 2, 3):
            self.assertEqual(self.env.room(n)["state"], "open")
            self.assertEqual(self.env.api.kinds(rid(n)), ["worker.ready"])
        ids = {self.env.room(n)["provider_meeting_id"] for n in (1, 2, 3)}
        self.assertEqual(len(ids), 3)

    def test_up_to_three_rooms_are_claimed_a_tick(self):
        for n in range(1, 6):
            self.env.add_room(n, host_email=f"rep{n}@example.test")
            self.env.zoom.users[f"rep{n}@example.test"] = {"id": f"zu-{n}", "type": 2, "status": "active"}
        self.tick(self.env.worker())
        states = [self.env.room(n)["state"] for n in range(1, 6)]
        self.assertEqual(states.count("open"), 3)
        self.assertEqual(states.count("requested"), 2)


# ---- Zoom ---------------------------------------------------------------------------


class ZoomRooms(RoomsCase):
    def test_a_zoom_room_is_made_saved_and_handed_to_sales_api(self):
        self.env.add_room()
        self.tick(self.env.worker())
        row = self.env.room()
        self.assertEqual(row["state"], "open")
        meeting = next(iter(self.env.zoom.meetings.values()))
        self.assertEqual(row["provider_meeting_id"], str(meeting["id"]))
        self.assertEqual(row["join_url"], f"{meeting['join_url']}?pwd={meeting['encrypted_password']}")
        self.assertEqual(row["version"], 3)  # requested 1, claimed 2, open 3
        self.assertTrue(row["host_by"] and row["ends_at"] and row["opened_at"] and row["claimed_at"])
        self.assertAlmostEqual(rooms.parse_ts(row["host_by"]) - rooms.parse_ts(row["opened_at"]), 900, delta=1)
        self.assertAlmostEqual(rooms.parse_ts(row["ends_at"]) - rooms.parse_ts(row["opened_at"]), 1800, delta=1)
        # The host link is only in the secrets table.
        self.assertNotIn("zak=", json.dumps(self.env.pg.rows(rooms.ROOMS)))
        secret = self.env.pg.one(rooms.SECRETS, room_id=rid(1))
        self.assertEqual(secret["start_url"], meeting["start_url"])
        self.assertAlmostEqual(rooms.parse_ts(secret["expires_at"]) - self.env.clock(), 7200, delta=2)
        # The create body.
        method, path, query, body = next(c for c in self.env.zoom.calls if c[0] == "POST")
        self.assertEqual(path, "/users/zu-setter/meetings")
        self.assertEqual(body["type"], 2)
        self.assertNotIn("start_time", body)
        self.assertEqual(body["topic"], f"Mahara call {row['code']}")
        self.assertEqual(body["duration"], 30)
        s = body["settings"]
        self.assertIs(s["join_before_host"], False)
        self.assertIs(s["waiting_room"], True)
        self.assertEqual(s["waiting_room_options"], {"mode": "custom", "who_goes_to_waiting_room": "users_not_in_account"})
        self.assertEqual(s["auto_recording"], "none")
        # The live check came before the create.
        order = [(c[0], c[1], c[2].get("type")) for c in self.env.zoom.calls]
        self.assertLess(order.index(("GET", "/users/zu-setter/meetings", "live")), order.index(("POST", "/users/zu-setter/meetings", None)))
        # sales-api heard once, with the service key, and never the host link.
        self.assertEqual(self.env.api.kinds(), ["worker.ready"])
        sent = self.env.api.bodies[0]
        self.assertEqual((sent["action"], sent["room_id"]), ("room.event", rid(1)))
        self.assertEqual(self.env.api.headers[0]["Authorization"], "Bearer service-test-key")
        self.assertNotIn("zak=", json.dumps(self.env.api.bodies))
        uuid.UUID(sent["request_id"])
        event = self.env.pg.one(rooms.EVENTS, dedupe_key=f"worker.ready:{rid(1)}")
        self.assertEqual((event["kind"], event["source"]), ("worker.ready", "worker"))
        self.assertNotIn("zak=", json.dumps(self.env.pg.rows(rooms.EVENTS)))

    def test_every_call_has_a_timeout_and_no_hidden_retries(self):
        self.env.add_room()
        self.env.add_room(2, provider="meet")
        self.env.worker().run(seconds=10)
        provider_calls = [x for x in self.env.net.log if "db.test/rest" not in x[2]]
        self.assertTrue(provider_calls)
        for _t, method, url, timeout, retries in provider_calls:
            self.assertLessEqual(timeout, 15, url)
            self.assertGreater(timeout, 0, url)
            self.assertEqual(retries, 0, f"the worker's own loop does the retrying: {url}")
        for _t, method, url, timeout, retries in self.env.net.log:
            self.assertLessEqual(retries, 2, url)
            self.assertLessEqual(timeout, 15, url)

    def test_a_busy_host_is_refused_before_anything_is_made(self):
        self.env.zoom.live["zu-setter"] = [{"id": 99001, "topic": "Weekly sync"}]
        self.env.add_room()
        self.tick(self.env.worker())
        row = self.env.room()
        self.assertEqual((row["state"], row["error"]), ("failed", "Your Zoom is in another meeting. End it or use Meet."))
        self.assertEqual(row["result"], "failed")
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0)
        self.assertEqual(self.env.api.kinds(), ["worker.failed"])
        self.assertEqual(self.env.api.bodies[0]["payload"]["error"], row["error"])

    def test_a_basic_host_is_refused_a_demo_but_not_an_intro(self):
        self.env.zoom.users[CLOSER]["type"] = 1
        self.env.add_room(1, host_email=CLOSER, call_kind="demo")
        self.env.add_room(2, host_email=CLOSER, call_kind="intro")
        w = self.env.worker()
        w.run(seconds=0, max_claims=1)
        self.assertEqual(self.env.room(1)["state"], "failed")
        self.assertEqual(self.env.room(1)["error"],
                         "The closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo.")
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0)
        w.run(seconds=0)
        self.assertEqual(self.env.room(2)["state"], "open")

    def test_a_pending_or_missing_seat_is_told_to_use_meet(self):
        self.env.zoom.users.pop(SETTER)
        self.env.zoom.pending.add(SETTER)
        self.env.add_room(1)
        self.env.add_room(2, host_email="nobody@example.test")
        self.tick(self.env.worker())
        self.assertEqual(self.env.room(1)["error"], rooms.SAY["pending"])
        self.assertEqual(self.env.room(2)["error"], rooms.SAY["no_user"])
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0)

    def test_server_errors_are_tried_twice_more_and_never_make_two_meetings(self):
        self.env.zoom.script = [{"method": "POST", "path": "/meetings", "status": 503},
                                {"method": "POST", "path": "/meetings", "status": 502}]
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 3)
        self.assertEqual(len(self.env.zoom.meetings), 1)
        # After each unclear answer the host's meetings were read for the code first.
        self.assertEqual(sum(1 for c in self.env.zoom.calls if c[2].get("type") == "scheduled"), 2)

    def test_a_create_that_timed_out_after_zoom_made_it_is_found_by_its_code(self):
        self.env.zoom.script = [{"method": "POST", "path": "/meetings", "status": 0, "make": True}]
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 1)
        self.assertEqual(len(self.env.zoom.meetings), 1)

    def test_rate_limits_are_tried_at_most_three_times_then_said_plainly(self):
        self.env.zoom.script = [{"method": "POST", "path": "/meetings", "status": 429}] * 3
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 3)
        # Read for the code after each try, and once more by the clean-up of
        # finished rooms a create was sent for (a 429 can follow the work).
        self.assertEqual(sum(1 for c in self.env.zoom.calls if c[2].get("type") == "scheduled"), 4)
        self.assertEqual(self.env.zoom.meetings, {})
        self.assertEqual(self.env.room()["error"], "Zoom did not answer. Try again in a minute, or use Meet.")

    def test_reads_are_retried_at_most_twice_on_server_errors(self):
        self.env.zoom.script = [{"method": "GET", "path": f"/users/{SETTER}", "status": 502, "exact": True}] * 5
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(sum(1 for c in self.env.zoom.calls if c[:2] == ("GET", f"/users/{SETTER}")), 3)
        self.assertEqual(len(self.env.zoom.script), 2)
        # Not knowing the seat is not a refusal: the room is still made.
        self.assertEqual(self.env.room()["state"], "open")

    def test_a_refusal_from_zoom_is_said_with_its_reason(self):
        self.env.zoom.script = [{"method": "POST", "path": "/meetings", "status": 400,
                                 "body": {"code": 3161, "message": "Meeting hosting is not allowed for this user."}}]
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["error"],
                         "Zoom refused to make the room: Meeting hosting is not allowed for this user. Use Meet.")
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 1)

    def test_a_room_cancelled_while_it_was_made_leaves_nothing_open(self):
        self.env.add_room()
        self.env.zoom.after_create = lambda m: self.env.room().update({"state": "cancelled"})
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "cancelled")
        self.assertEqual(self.env.zoom.meetings, {})
        self.assertIsNone(self.env.pg.one(rooms.SECRETS, room_id=rid(1)))
        self.assertEqual(self.env.api.kinds(), [])

    def test_without_zoom_keys_the_room_fails_with_what_to_do(self):
        self.env.add_room()
        self.tick(self.env.worker(zoom=False))
        self.assertEqual(self.env.room()["error"], rooms.SAY["zoom_keys"])


# ---- Meet ----------------------------------------------------------------------------


class MeetRooms(RoomsCase):
    def test_pending_then_ready_on_the_sales_rooms_calendar_made_once(self):
        self.env.google.ready_after = 2
        self.env.add_room(1, provider="meet")
        self.env.add_room(2, provider="meet", host_email=CLOSER, requested_at=rooms.iso(T0 + 4))
        w = self.env.worker()
        w.run(seconds=12)
        for n in (1, 2):
            row = self.env.room(n)
            self.assertEqual(row["state"], "open", row.get("error"))
            self.assertEqual(row["join_url"], "https://meet.example.test/abc-defg-hij")
            self.assertEqual(row["provider_meeting_id"], "abc-defg-hij")
            self.assertEqual(self.env.api.kinds(rid(n)), ["worker.ready"])
        self.assertEqual(self.env.google.count("POST", "calendars"), 1 + 2)  # one calendar, two events
        self.assertEqual(len([c for c in self.env.google.calendars if c["summary"] == "Sales rooms"]), 1)
        self.assertEqual(self.env.google.count("GET", "calendarList"), 1)
        inserts = [c for c in self.env.google.calls if c[0] == "POST" and c[1].endswith("/events")]
        for (_m, _p, query, body), n in zip(inserts, (1, 2)):
            self.assertEqual(query, {"conferenceDataVersion": "1", "sendUpdates": "none"})
            self.assertEqual(body["id"], rooms.event_id(rid(n)))
            self.assertEqual(body["summary"], f"Mahara call {self.env.room(n)['code']}")
            self.assertNotIn("attendees", body)
            self.assertEqual(body["conferenceData"]["createRequest"]["conferenceSolutionKey"], {"type": "hangoutsMeet"})
        # Read about once a second while pending: three reads for two pending answers.
        self.assertEqual(self.env.google.reads[rooms.event_id(rid(1))], 3)

    def test_an_existing_sales_rooms_calendar_is_used(self):
        self.env.google.calendars = [{"id": "team@group.example.test", "summary": "Team"},
                                     {"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        self.env.google.ready_after = 0
        self.env.add_room(provider="meet")
        self.env.worker().run(seconds=3)
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(self.env.google.count("POST", "calendars"), 1)  # the event only
        self.assertIn(("rooms@group.example.test", rooms.event_id(rid(1))), self.env.google.events)

    def test_a_meet_link_that_never_comes_fails_after_thirty_seconds(self):
        self.env.google.ready_after = None
        self.env.add_room(provider="meet")
        self.env.worker().run(seconds=45)
        row = self.env.room()
        self.assertEqual((row["state"], row["error"]), ("failed", "Google did not make the Meet link. Try Zoom."))
        waited = rooms.parse_ts(row["ended_at"]) - rooms.parse_ts(row["claimed_at"])
        self.assertGreaterEqual(waited, 30)
        self.assertLess(waited, 32)
        self.assertLessEqual(self.env.google.reads[rooms.event_id(rid(1))], 31)
        self.assertEqual(self.env.api.kinds(), ["worker.failed"])

    def test_a_meet_room_pending_when_a_run_ends_is_finished_by_the_next(self):
        self.env.google.ready_after = 6
        self.env.add_room(provider="meet")
        self.env.worker("run-a").run(seconds=4)
        self.assertEqual((self.env.room()["state"], self.env.room()["worker_run"]), ("creating", "run-a"))
        self.env.clock.advance(3)
        self.env.worker("run-b").run(seconds=6)
        row = self.env.room()
        self.assertEqual((row["state"], row["worker_run"]), ("open", "run-b"))
        self.assertEqual(sum(1 for c in self.env.google.calls if c[0] == "POST" and c[1].endswith("/events")), 1)
        self.assertEqual(self.env.api.kinds(), ["worker.ready"])

    def test_without_google_the_room_fails_with_what_to_do(self):
        self.env.add_room(provider="meet")
        self.tick(self.env.worker(google=False))
        self.assertEqual(self.env.room()["error"], rooms.SAY["google_keys"])

    def test_a_calendar_google_will_not_make_is_said_plainly(self):
        self.env.google.script = [{"method": "POST", "path": "calendars", "status": 403}]
        self.env.add_room(provider="meet")
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["error"], rooms.SAY["calendar"])


# ---- crash recovery ------------------------------------------------------------------


class Recovery(RoomsCase):
    def lost(self, n: int = 1, *, age: float, provider: str = "zoom", run: str = "run-dead") -> dict[str, Any]:
        return self.env.add_room(n, provider=provider, state="creating", worker_run=run, version=2,
                                 requested_at=rooms.iso(T0 - age - 1), claimed_at=rooms.iso(T0 - age))

    def test_a_lost_zoom_room_is_found_by_the_code_in_its_topic(self):
        room = self.lost(age=90)
        made = self.env.zoom._make("zu-setter", {"topic": f"Mahara call {room['code']}"})
        self.env.zoom._make("zu-setter", {"topic": "Mahara call ZZZZZZ"})
        self.tick(self.env.worker())
        row = self.env.room()
        self.assertEqual(row["state"], "open")
        self.assertEqual(row["provider_meeting_id"], str(made["id"]))
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0)
        self.assertEqual(self.env.pg.one(rooms.SECRETS, room_id=rid(1))["start_url"], made["start_url"])
        self.assertEqual(self.env.api.kinds(), ["worker.ready"])

    def test_a_lost_zoom_room_no_create_was_sent_for_is_made_while_the_sweep_still_waits(self):
        # The sweep fails a room still creating at claim + 120 s (contract-v2
        # section 7, item 10); before that, a room whose create never went
        # out is made, so the rep gets it.
        self.lost(age=90)
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 1)

    def test_a_lost_zoom_room_whose_create_went_out_is_only_looked_for_until_ten_minutes(self):
        room = self.lost(age=90)
        self.env.pg.put(rooms.EVENTS, {"room_id": room["id"], "kind": "worker.create_sent", "source": "worker",
                                       "dedupe_key": f"worker.create_sent:{room['id']}", "handled_at": rooms.iso(T0)})
        self.tick(self.env.worker())
        # Not failed by the worker: the timer is the sweep's (S1).
        self.assertEqual((self.env.room()["state"], self.env.room().get("error")), ("creating", None))
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0)
        self.assertGreaterEqual(self.env.zoom.count("GET", "/meetings"), 1)  # looked for by its code
        # With no sweep running, the worker fails it once it is ten minutes old.
        self.env.room()["requested_at"] = rooms.iso(T0 - rooms.STALE_S - 1)
        self.tick(self.env.worker("run-b"))
        self.assertEqual((self.env.room()["state"], self.env.room()["error"]), ("failed", rooms.SAY["lost"]))
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0)

    def test_a_young_zoom_room_another_run_holds_is_left_alone(self):
        self.lost(age=20)
        self.tick(self.env.worker())
        self.assertEqual((self.env.room()["state"], self.env.room()["worker_run"]), ("creating", "run-dead"))
        self.assertEqual(self.env.zoom.calls, [])

    def test_a_lost_meet_room_is_found_by_its_event_id(self):
        self.lost(age=90, provider="meet")
        cal = "rooms@group.example.test"
        self.env.google.calendars = [{"id": cal, "summary": "Sales rooms"}]
        self.env.google.events[(cal, rooms.event_id(rid(1)))] = {"id": rooms.event_id(rid(1)), "summary": "x"}
        self.env.google.reads[rooms.event_id(rid(1))] = 5
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(self.env.google.count("POST", "/events"), 0)

    def test_a_lost_meet_room_google_never_made_fails(self):
        self.lost(age=90, provider="meet")
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        self.tick(self.env.worker())
        self.assertEqual((self.env.room()["state"], self.env.room()["error"]), ("failed", rooms.SAY["lost"]))
        self.assertEqual(self.env.google.count("POST", "/events"), 0)

    def test_a_room_asked_for_75_s_ago_is_still_made_the_sweep_owns_the_minute(self):
        # The sweep fails a room nobody claimed at 60 s on the database's
        # clock; the worker's clock is not compared with it to the second,
        # so a VPS clock that runs ahead never fails rooms (finding 20).
        self.env.add_room(requested_at=rooms.iso(T0 - 75))
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")

    def test_a_room_left_requested_ten_minutes_is_failed_not_made(self):
        self.env.add_room(requested_at=rooms.iso(T0 - rooms.STALE_S - 5))
        self.tick(self.env.worker())
        self.assertEqual((self.env.room()["state"], self.env.room()["error"]), ("failed", rooms.SAY["too_late"]))
        self.assertEqual(self.env.zoom.calls, [])
        self.assertEqual(self.env.api.kinds(), ["worker.failed"])

    def test_the_kill_switch_stops_rooms_already_asked_for(self):
        self.env.pg.one("cockpit_sales_settings", key="rooms")["value"]["enabled"] = False
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["error"], rooms.SAY["switched_off"])
        self.assertEqual(self.env.zoom.calls, [])

    def test_a_booked_call_never_gets_a_new_room(self):
        self.env.add_room(purpose="booked")
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["error"], rooms.SAY["booked"])
        self.assertEqual(self.env.zoom.calls, [])


# ---- closing -----------------------------------------------------------------------


class Closing(RoomsCase):
    def final(self, n: int, *, state: str = "ended", **over: Any) -> str:
        m = self.env.zoom._make("zu-setter", {"topic": f"Mahara call CLOSE{n}"})
        self.env.add_room(n, state=state, provider_meeting_id=str(m["id"]), ended_at=rooms.iso(T0 - 5), **over)
        self.env.pg.put(rooms.SECRETS, {"room_id": rid(n), "start_url": m["start_url"], "expires_at": rooms.iso(T0 + 3600)})
        return str(m["id"])

    def test_a_final_room_has_its_meeting_ended_and_deleted_and_its_host_link_dropped(self):
        started = self.final(1)
        self.env.zoom.meetings[started]["status"] = "started"
        idle = self.final(2, state="expired")
        self.env.worker().run(seconds=3)   # one Zoom close a tick
        self.assertNotIn(started, self.env.zoom.meetings)
        self.assertNotIn(idle, self.env.zoom.meetings)
        self.assertEqual(self.env.zoom.count("PUT", f"/meetings/{started}/status"), 1)
        self.assertEqual(self.env.zoom.count("PUT", f"/meetings/{idle}/status"), 0)
        self.assertEqual(self.env.pg.rows(rooms.SECRETS), [])

    def test_never_a_room_a_lead_reached_nor_a_booked_call(self):
        reached = self.final(1, lead_in_at=rooms.iso(T0 - 600))
        booked = self.final(2, purpose="booked")
        self.tick(self.env.worker())
        self.assertIn(reached, self.env.zoom.meetings)
        self.assertIn(booked, self.env.zoom.meetings)
        self.assertEqual([c for c in self.env.zoom.calls if c[0] in ("PUT", "DELETE")], [])
        self.assertEqual(self.env.pg.rows(rooms.SECRETS), [])

    def test_an_open_room_keeps_its_meeting_and_host_link(self):
        live = self.final(1, state="open")
        self.tick(self.env.worker())
        self.assertIn(live, self.env.zoom.meetings)
        self.assertEqual(len(self.env.pg.rows(rooms.SECRETS)), 1)

    def test_a_meet_room_only_loses_its_host_link(self):
        self.env.add_room(1, state="cancelled", provider="meet", provider_meeting_id="abc-defg-hij")
        self.env.pg.put(rooms.SECRETS, {"room_id": rid(1), "start_url": "https://meet.example.test/abc", "expires_at": None})
        self.tick(self.env.worker())
        self.assertEqual(self.env.pg.rows(rooms.SECRETS), [])
        self.assertEqual(self.env.google.calls, [])


# ---- the minute ----------------------------------------------------------------------


class Loop(RoomsCase):
    def test_a_run_ends_by_57_seconds_and_claims_nothing_in_its_last_seconds(self):
        self.env.clock.at(T0 + 10.2, lambda: self.env.add_room(1, requested_at=rooms.iso(T0 + 10.2)))
        self.env.clock.at(T0 + 55.5, lambda: self.env.add_room(2, host_email=CLOSER, requested_at=rooms.iso(T0 + 55.5)))
        out = self.env.worker().run(seconds=57)
        self.assertLessEqual(self.env.clock() - T0, 57.0)
        self.assertGreaterEqual(self.env.clock() - T0, 56.0)
        self.assertEqual(self.env.room(1)["state"], "open")
        self.assertLess(rooms.parse_ts(self.env.room(1)["opened_at"]) - (T0 + 10.2), 1.5)
        self.assertEqual(self.env.room(2)["state"], "requested")
        self.assertEqual(out["made"], 1)
        # The next minute's run makes it.
        self.env.clock.advance(3)
        self.env.worker("run-b").run(seconds=0)
        self.assertEqual(self.env.room(2)["state"], "open")

    def test_polls_every_second(self):
        self.env.worker().run(seconds=57)
        polls = [t for t, m, u, _to, _r in self.env.net.log
                 if m == "GET" and "/rest/v1/cockpit_sales_rooms?" in u and "state=in.(requested,creating)" in urllib.parse.unquote(u)]
        self.assertGreaterEqual(len(polls), 56)
        self.assertLessEqual(len(polls), 58)
        gaps = [b - a for a, b in zip(polls, polls[1:])]
        self.assertLessEqual(max(gaps), 1.01)

    def test_a_zoom_that_hangs_never_keeps_the_run_past_its_hard_stop(self):
        self.env.zoom.latency = 30.0
        self.env.clock.at(T0 + 40.0, lambda: self.env.add_room(1, requested_at=rooms.iso(T0 + 40.0)))
        self.env.clock.at(T0 + 53.0, lambda: self.env.add_room(2, host_email=CLOSER, requested_at=rooms.iso(T0 + 53.0)))
        self.env.worker().run(seconds=57)
        self.assertLessEqual(self.env.clock() - T0, 57 + rooms.HARD_SLACK + 0.01)
        # Two timeouts trip Zoom's breaker: the room fails in about 8 s, not 30.
        row = self.env.room(1)
        self.assertEqual(row["error"], "Zoom did not answer. Try again in a minute, or use Meet.")
        self.assertLessEqual(rooms.parse_ts(row["ended_at"]) - (T0 + 40.0), 2 * rooms.READ_TIMEOUT + 1.5)
        # A Zoom room asked for in the last 12 s is left for the next run.
        self.assertEqual(self.env.room(2)["state"], "requested")

    def test_one_room_s_error_does_not_stop_the_others(self):
        self.env.add_room(1)
        self.env.add_room(2, host_email=CLOSER)
        w = self.env.worker()
        real = w.make_zoom

        def broken(room):
            if room["id"] == rid(1):
                raise KeyError("a bug")
            return real(room)

        w.make_zoom = broken  # type: ignore[assignment]
        w.run(seconds=0)
        self.assertEqual((self.env.room(1)["state"], self.env.room(1)["error"]), ("failed", rooms.SAY["error"]))
        self.assertEqual(self.env.room(2)["state"], "open")

    def test_missing_tables_stop_the_run_with_a_sentence(self):
        del self.env.pg.tables[rooms.ROOMS]
        out = self.env.worker().run(seconds=57)
        self.assertIn("20261003a_sales_rooms.sql", out["blocked"])
        self.assertLess(self.env.clock() - T0, 1)
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIs(row["ok"], False)
        self.assertIn("no room can be made", row["detail"])

    def test_a_database_blip_is_survived_and_said(self):
        w = self.env.worker()
        real = self.env.pg.__call__
        state = {"n": 0}

        def flaky(method, url, **kw):
            if method == "GET" and "cockpit_sales_rooms?" in url and state["n"] < 1:
                state["n"] += 1
                raise HttpError(503, "busy", b"", url)
            return real(method, url, **kw)

        self.env.net.pg = flaky  # type: ignore[assignment]
        self.env.add_room()
        w.run(seconds=5)
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(w.total["db_errors"], 1)


class SchemaDrift(RoomsCase):
    def test_a_column_the_database_refuses_is_said_with_what_to_do(self):
        real = self.env.pg.__call__

        def no_worker_run(method, url, **kw):
            if method == "PATCH" and "cockpit_sales_rooms" in url:
                raise HttpError(400, '{"code":"PGRST204","message":"Could not find the worker_run column"}', b"", url)
            return real(method, url, **kw)

        self.env.net.pg = no_worker_run  # type: ignore[assignment]
        self.env.add_room()
        self.env.worker().run(seconds=0)
        self.assertEqual(self.env.room()["state"], "requested")
        self.assertEqual(self.env.zoom.calls, [])
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIs(row["ok"], False)
        self.assertIn("apply the latest sales migration", row["detail"])
        self.assertIn("worker_run", row["detail"])


class Stress(RoomsCase):
    def test_a_busy_three_minutes_with_flaky_providers_leaves_nothing_stuck_or_doubled(self):
        import random
        rng = random.Random(20261003)
        codes = set()
        for n in range(1, 41):
            code = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            while code in codes:
                code = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            codes.add(code)
            at = T0 + rng.uniform(0, 110)
            provider = "zoom" if n % 2 else "meet"
            self.env.clock.at(at, lambda n=n, at=at, code=code, provider=provider: self.env.add_room(
                n, code=code, provider=provider, requested_at=rooms.iso(at),
                host_email=SETTER if n % 4 == 1 else CLOSER))
        for _ in range(12):
            self.env.zoom.script.append({"method": "POST", "path": "/meetings", "status": rng.choice((429, 500, 503, 0)),
                                         "make": rng.random() < 0.5})
        self.env.google.ready_after = 3
        for run in ("run-a", "run-b", "run-c"):
            self.env.worker(run).run(seconds=57)
            self.env.clock.advance(3)
        rows = self.env.pg.rows(rooms.ROOMS)
        self.assertEqual(len(rows), 40)
        self.assertEqual({r["state"] for r in rows} - {"open", "failed"}, set(), [r["state"] for r in rows])
        topics = [m["topic"] for m in self.env.zoom.meetings.values()]
        self.assertEqual(len(topics), len(set(topics)), "a Zoom room was made twice")
        for r in rows:
            mine = [m for m in self.env.zoom.meetings.values() if m["topic"] == f"Mahara call {r['code']}"]
            if r["state"] == "open":
                self.assertEqual(self.env.api.kinds(r["id"]), ["worker.ready"])
                self.assertIsNotNone(self.env.pg.one(rooms.SECRETS, room_id=r["id"]))
                if r["provider"] == "zoom":
                    self.assertEqual([str(m["id"]) for m in mine], [r["provider_meeting_id"]])
            else:
                self.assertEqual(mine, [], f"failed room {r['code']} left a meeting behind")
                self.assertIsNone(self.env.pg.one(rooms.SECRETS, room_id=r["id"]))
                self.assertEqual(self.env.api.kinds(r["id"]), ["worker.failed"])
        self.assertGreaterEqual(sum(1 for r in rows if r["state"] == "open"), 30)
        self.assertNotIn("zak=", json.dumps(rows) + json.dumps(self.env.api.bodies) + json.dumps(self.env.pg.rows(rooms.EVENTS)))

    def test_a_run_killed_after_zoom_made_the_meeting_is_recovered_without_a_second(self):
        self.env.add_room()
        a = self.env.worker("run-a")

        def killed(*_a, **_k):
            raise SystemExit("the VPS killed the process")

        a.finish = killed  # type: ignore[assignment]
        with self.assertRaises(SystemExit):
            a.run(seconds=57)
        self.assertEqual(self.env.room()["state"], "creating")
        self.assertEqual(len(self.env.zoom.meetings), 1)
        self.env.clock.advance(30)
        self.env.worker("run-b").run(seconds=0)   # 30 s on: another run's young Zoom room is left alone
        self.assertEqual(self.env.room()["state"], "creating")
        self.env.clock.advance(31)
        self.env.worker("run-c").run(seconds=0)
        row = self.env.room()
        self.assertEqual((row["state"], row["worker_run"]), ("open", "run-c"))
        self.assertEqual(len(self.env.zoom.meetings), 1)
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 1)
        self.assertEqual(row["provider_meeting_id"], str(next(iter(self.env.zoom.meetings.values()))["id"]))
        self.assertEqual(self.env.api.kinds(), ["worker.ready"])


# ---- sales-api --------------------------------------------------------------------------


class Notify(RoomsCase):
    def test_one_call_and_an_unclear_answer_is_left_to_the_stored_event(self):
        # A repeat could run sales-api's handler, and send, a second time while
        # the first still runs (finding 2): one call, no retry, a short timeout.
        self.env.api.script = [503, 503, 503]
        self.env.add_room(1)
        self.env.worker().run(seconds=12)
        self.assertEqual(self.env.api.kinds(rid(1)), ["worker.ready"])
        sent = [x for x in self.env.net.log if "/functions/v1/sales-api" in x[2]]
        self.assertEqual([(to, r) for _t, _m, _u, to, r in sent], [(rooms.NOTIFY_TIMEOUT, 0)])
        self.assertIsNotNone(self.env.pg.one(rooms.EVENTS, dedupe_key=f"worker.ready:{rid(1)}"))
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIn("sales-api did not answer for 1 room message; the sweep sends them again.", row["detail"])

    def test_a_refusal_is_said_and_turns_the_status_red(self):
        self.env.api.script = [400]
        self.env.add_room(1)
        self.env.worker().run(seconds=0)
        self.assertEqual(self.env.api.kinds(rid(1)), ["worker.ready"])
        self.assertTrue(any("refused worker.ready" in m for _l, m in self.env.log.lines))
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIs(row["ok"], False)
        self.assertIn("sales-api refused the room message for 1 room: scripted.", row["detail"])

    def test_a_sales_api_that_hangs_is_skipped_after_two_timeouts(self):
        self.env.api.latency = 30.0
        for n in range(1, 5):
            self.env.add_room(n, host_email=f"rep{n}@example.test")
            self.env.zoom.users[f"rep{n}@example.test"] = {"id": f"zu-{n}", "type": 2, "status": "active"}
        out = self.env.worker().run(seconds=20)
        self.assertEqual(out["made"], 4)
        # Two calls of 4 s each, then the breaker: the other rooms do not wait.
        self.assertEqual(len(self.env.api.bodies), 2)
        self.assertEqual(out["notify_unclear"], 4)
        for n in range(1, 5):
            self.assertIsNotNone(self.env.pg.one(rooms.EVENTS, dedupe_key=f"worker.ready:{rid(n)}"))


# ---- the status row ----------------------------------------------------------------------


class Status(RoomsCase):
    def test_written_at_least_every_thirty_seconds_in_a_plain_sentence(self):
        self.env.clock.at(T0 + 30, lambda: self.env.add_room(1, requested_at=rooms.iso(T0 + 30)))
        self.env.worker().run(seconds=57)
        times = [t - T0 for t in self.env.status_writes()]
        self.assertEqual(times[0], 0)
        # Never older than 30 s while the run lasts, nor when it ends.
        gaps = [b - a for a, b in zip(times, times[1:] + [57.0])]
        self.assertLessEqual(max(gaps), 30)
        self.assertGreaterEqual(len(times), 3)
        row = self.env.pg.one("cockpit_sales_worker_status", worker="sales-desk", job="rooms")
        self.assertIs(row["ok"], True)
        self.assertNotRegex(row["detail"], r"None|\{|\}|_")
        self.assertNotIn(chr(0x2014), row["detail"])  # no em dash

    def test_sentences_say_what_was_made_and_what_is_missing(self):
        self.env.add_room()
        w = self.env.worker(zoom=False)
        w.run(seconds=0)
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIs(row["ok"], False)
        self.assertIn("1 failed", row["detail"])
        self.assertIn("ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET", row["detail"])
        self.assertIn("Last problem: " + rooms.SAY["zoom_keys"], row["detail"])

        env2 = Env()
        with mock.patch.object(http, "request", env2.net):
            env2.add_room()
            env2.worker().run(seconds=0)
            row = env2.pg.one("cockpit_sales_worker_status", job="rooms")
            self.assertIs(row["ok"], True)
            self.assertRegex(row["detail"], r"^Working\. In the last (second|\d+ seconds): 1 room made \(1 Zoom, 0 Meet\), 0 failed, 0 closed\.$")

    def test_an_idle_run_says_so(self):
        self.env.worker().run(seconds=0)
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertEqual(row["detail"], "Working. No rooms were asked for in the last second.")


# ---- the host check ------------------------------------------------------------------------


class Hosts(RoomsCase):
    def seats(self):
        for email, role, active, portal in ((SETTER, "setter", True, True), (CLOSER, "closer", True, True),
                                            ("manager@example.test", "manager", True, True),
                                            ("both@example.test", "both", True, True),
                                            ("gone@example.test", "closer", False, True),
                                            ("noportal@example.test", "closer", True, False)):
            self.env.pg.put("cockpit_sales_people", {"email": email, "name": "Invented Name", "role": role,
                                                     "active": active, "via_portal": portal})
        self.env.zoom.users.pop(SETTER)
        self.env.zoom.pending.add(SETTER)
        self.env.zoom.users["manager@example.test"] = {"id": "zu-manager", "type": 1, "status": "active"}
        self.env.zoom.live["zu-closer"] = [{"id": 1, "start_time": "2026-10-03T09:50:00Z", "duration": 60}]
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]

    def test_each_seat_gets_its_zoom_status_and_google_and_the_team_page_s_values_stay(self):
        self.seats()
        out = self.env.worker().check_hosts()
        rows = {r["email"]: r for r in self.env.pg.rows(rooms.HOSTS)}
        # Only seats that can sign in (cockpit_sales_seat: via_portal and active).
        self.assertEqual(set(rows), {SETTER, CLOSER, "manager@example.test", "both@example.test"})
        self.assertEqual({e: r["zoom_status"] for e, r in rows.items()},
                         {SETTER: "pending", CLOSER: "licensed", "manager@example.test": "basic",
                          "both@example.test": "missing"})
        # The default room is the Team page's to set: the check never writes it
        # (empty means the role's default in cockpit_sales_presence).
        self.assertTrue(all("default_provider" not in r for r in rows.values()))
        self.assertTrue(all(r["google_ok"] is True for r in rows.values()))
        self.assertEqual(rows[CLOSER]["zoom_user_id"], "zu-closer")
        self.assertEqual(rows[CLOSER]["zoom_live_until"], "2026-10-03T10:50:00.000Z")
        self.assertIsNone(rows["manager@example.test"]["zoom_live_until"])
        lines = "\n".join(out["lines"])
        self.assertIn("Google: signed in with GOOGLE_CAL_*; the Sales rooms calendar is ready.", lines)
        self.assertIn(f"{CLOSER} (closer): Zoom licensed, so Zoom rooms have no time limit. In a Zoom meeting now. "
                      "Default room: Zoom.", lines)
        self.assertIn(f"{SETTER} (setter): Zoom invite not accepted yet, so rooms go on Meet until it is. "
                      "Default room: Meet.", lines)
        self.assertIn("manager@example.test (manager): Zoom Basic, so meetings end at 40 minutes and demos go on Meet.", lines)
        self.assertIn("both@example.test (both): no Zoom user that can host on Mahara's account, so rooms go on Meet.", lines)
        self.assertNotIn("gone@example.test", lines)
        self.assertNotIn("noportal@example.test", lines)
        status = self.env.pg.one("cockpit_sales_worker_status", job="room-hosts")
        self.assertIs(status["ok"], True)
        self.assertEqual(self.env.google.count("POST", "calendars"), 0)  # the check never writes to Google

    def test_a_default_the_team_page_set_is_kept_and_a_failing_one_is_said(self):
        self.seats()
        self.env.zoom.users[CLOSER]["status"] = "pending"
        self.env.pg.put(rooms.HOSTS, {"email": CLOSER, "zoom_user_id": None, "default_provider": "zoom"})
        out = self.env.worker().check_hosts()
        row = self.env.pg.one(rooms.HOSTS, email=CLOSER)
        self.assertEqual(row["default_provider"], "zoom")
        self.assertIn(f"{CLOSER} (closer): Zoom invite not accepted yet, so rooms go on Meet until it is. Default "
                      "room: Zoom, set on the Team page. Zoom rooms will fail for this seat: set Meet on the Team page.",
                      "\n".join(out["lines"]))

    def test_without_zoom_keys_nothing_is_written_as_missing(self):
        self.seats()
        out = self.env.worker(zoom=False).check_hosts()
        rows = self.env.pg.rows(rooms.HOSTS)
        self.assertTrue(rows)
        self.assertTrue(all("zoom_status" not in r and "checked_at" not in r for r in rows))
        lines = "\n".join(out["lines"])
        self.assertIn(f"{CLOSER} (closer): Zoom not checked, because the Zoom keys are not set on the VPS.", lines)
        # Finding 19: without Zoom keys a closer's Zoom default cannot work.
        self.assertIn(f"{CLOSER} (closer): Zoom not checked, because the Zoom keys are not set on the VPS. "
                      "Default room: Zoom. Zoom rooms will fail for this seat: set Meet on the Team page.", lines)
        self.assertIs(out["ok"], False)

    def test_without_google_the_check_says_meet_cannot_be_made(self):
        self.seats()
        out = self.env.worker(google=False).check_hosts()
        self.assertTrue(out["lines"][0].startswith("Google: no sign-in is set on the VPS"))
        self.assertIn("Ask the CEO to connect Google Calendar on the VPS.", out["lines"][0])
        self.assertTrue(all(r["google_ok"] is False for r in self.env.pg.rows(rooms.HOSTS)))

    def test_a_calendar_sign_in_without_calendar_access_is_said(self):
        self.seats()
        self.env.google.script = [{"method": "GET", "path": "calendarList", "status": 403,
                                   "body": {"error": {"code": 403, "message": "Insufficient Permission"}}}]
        out = self.env.worker().check_hosts()
        self.assertIn("cannot use Calendar (Insufficient Permission)", out["lines"][0])
        self.assertEqual(self.env.pg.one(rooms.HOSTS, email=SETTER)["google_ok"], False)

    def test_a_sign_in_given_for_drive_is_said_without_asking_calendar(self):
        # Finding 11: the editor desk's GOOGLE_* sign-in is for Drive.
        self.seats()
        self.env.google.scope = "https://www.googleapis.com/auth/drive"
        out = self.env.worker().check_hosts()
        self.assertIn("has no Calendar permission", out["lines"][0])
        self.assertEqual(self.env.google.calls, [])
        self.assertIs(out["ok"], False)

    def test_the_loop_never_runs_the_host_check(self):
        # Finding 10: it has its own cron line, so it never holds a room up.
        self.seats()
        self.env.worker().run(seconds=20)
        self.assertEqual(self.env.pg.rows(rooms.HOSTS), [])
        self.assertIsNone(self.env.pg.one("cockpit_sales_worker_status", job="room-hosts"))
        self.assertEqual([c for c in self.env.zoom.calls if c[1].startswith("/users")], [])


# ---- the command --------------------------------------------------------------------------


class Command(unittest.TestCase):
    def test_desk_rooms_once_makes_a_room(self):
        import time as _time

        spec = importlib.util.spec_from_file_location("desk_cli_rooms", ROOT / "desk.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]

        env = Env()
        env.clock.t = _time.time()
        env.add_room(requested_at=rooms.iso(_time.time() - 1))
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {
            "SALES_DESK_HOME": tmp, "DESK_SUPABASE_URL": DB, "DESK_SUPABASE_KEY": "service-test-key",
            "ZOOM_ACCOUNT_ID": "test-account", "ZOOM_CLIENT_ID": "test-client", "ZOOM_CLIENT_SECRET": "test-secret",
        }), mock.patch.object(http, "request", env.net), contextlib.redirect_stdout(io.StringIO()) as out:
            code = mod.main(["--quiet", "rooms", "--once"])
        self.assertEqual(code, 0)
        self.assertEqual(env.room()["state"], "open")
        self.assertIn('"made": 1', out.getvalue())
        self.assertNotIn("test-secret", out.getvalue())


if __name__ == "__main__":
    unittest.main()
