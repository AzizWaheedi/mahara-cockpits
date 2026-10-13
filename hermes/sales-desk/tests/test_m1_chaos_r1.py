"""Milestone 1, video-link round 1, chaos on the room worker (2026-10-05).

The worker makes the room the lead's link points at. Here every HTTP call
of one run (the database, Zoom, Google, sales-api) is, in turn:
  - killed: the process dies right before the call (SIGKILL, a deploy of the
    desk, the VPS rebooting), so nothing after it happens in this run;
  - lost: the call lands (the write is done, the meeting made) and its
    answer never comes (a timeout);
  - refused: a 503 and nothing done.
Healthy runs follow, with the SQL sweep's two make timers (R1 at 60 s, R2 at
claim + 120 s) every minute. What must hold for the lead and the rep:
  - an open room's link is a meeting that still exists, the host link is the
    same meeting, a worker.ready event is stored for the sweep;
  - one meeting at most is left for the room's code (two meetings with one
    code split the rep and the lead);
  - a failed room leaves no meeting behind and no host link.

Every room, seat, meeting and key is invented, and nothing reaches the
network.

    python3 -m unittest tests.test_m1_chaos_r1
"""
from __future__ import annotations

import json
import os
import unittest
from typing import Any, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, rooms  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests import test_rooms as tr  # noqa: E402

T0 = tr.T0


class Killed(BaseException):
    """The process died: nothing in the worker catches a BaseException."""


class Faulty:
    """The HTTP layer of test_rooms.Net with one fault at the k-th call."""

    def __init__(self, net: tr.Net, k: int, mode: str):
        self.net, self.k, self.mode = net, k, mode
        self.n = 0
        self.hit: Optional[tuple[str, str]] = None
        self.armed = True

    def __call__(self, method: str, url: str, **kw: Any):
        i = self.n
        self.n += 1
        if self.armed and i == self.k:
            self.hit = (method, url.split("?")[0])
            if self.mode == "kill":
                raise Killed(f"killed before {method} {url}")
            if self.mode == "refused":
                raise HttpError(503, '{"message":"scripted outage"}', b"", url)
            timeout = float(kw.get("timeout") or 60)
            if self.mode == "slow":
                # It answers, a moment before the caller gives up.
                self.net.clock.advance(max(0.0, timeout - 0.1))
                return self.net(method, url, **kw)
            if self.mode == "garbage":
                # The call is made; what comes back is a proxy's page with a 200.
                try:
                    self.net(method, url, **kw)
                except HttpError:
                    pass
                return 200, {}, b"<html><body>Bad gateway</body></html>"
            if self.mode == "hang":
                # It hangs for the caller's whole timeout; the server did the work.
                self.net.clock.advance(timeout)
                try:
                    self.net(method, url, **kw)
                except HttpError:
                    pass
                raise HttpError(0, "TimeoutError: timed out", b"", url)
            # lost: the call is made, its answer is not.
            try:
                self.net(method, url, **kw)
            except HttpError:
                pass
            raise HttpError(0, "TimeoutError: timed out", b"", url)
        return self.net(method, url, **kw)


def lease_rpc(env: tr.Env):
    """cockpit_sales_room_event_lease as the database answers it: the event's
    id when it is unhandled and not held, else null."""

    def lease(body: dict[str, Any]) -> Any:
        key = body.get("p_dedupe_key")
        ev = env.pg.one(rooms.EVENTS, dedupe_key=key) if key else None
        if not ev or ev.get("handled_at"):
            return None
        until = rooms.parse_ts(ev.get("lease_until"))
        if until and until > env.clock():
            return None
        ev["lease_until"] = rooms.iso(env.clock() + int(body.get("p_seconds") or 30))
        ev.setdefault("id", f"ev-{key}")
        return ev["id"]

    env.pg.rpcs["cockpit_sales_room_event_lease"] = lease


def sweep(env: tr.Env) -> None:
    """The SQL sweep's R1 and R2 (contract-v2 S1), on the database's clock."""
    now = env.clock()
    for r in env.pg.rows(rooms.ROOMS):
        asked, claimed = rooms.parse_ts(r.get("requested_at")), rooms.parse_ts(r.get("claimed_at"))
        if (r["state"] == "requested" and asked and now - asked > 60) or \
                (r["state"] == "creating" and (claimed or asked) and now - (claimed or asked) > 120):
            r.update({"state": "failed", "result": "failed", "ended_at": rooms.iso(now), "version": r["version"] + 1,
                      "error": "Making the room took more than two minutes. Try again, or use the other provider."})


def problems(env: tr.Env, n: int = 1) -> list[str]:
    """What is wrong for the lead or the rep with room n, in words."""
    r = env.room(n)
    out: list[str] = []
    topic = f"Mahara call {r['code']}"
    mine = [m for m in env.zoom.meetings.values() if m["topic"] == topic]
    secret = env.pg.one(rooms.SECRETS, room_id=r["id"])
    ready = env.pg.one(rooms.EVENTS, dedupe_key=f"worker.ready:{r['id']}")
    if r["state"] in ("requested", "creating"):
        out.append(f"the room is still {r['state']} long after the sweep's two minutes")
    if r["state"] == "open":
        if not ready:
            out.append("open with no worker.ready event, so the link is never sent")
        if not r.get("join_url"):
            out.append("open with no link")
        if not secret:
            out.append("open with no host link")
        if r["provider"] == "zoom":
            ids = {str(m["id"]) for m in mine}
            if str(r.get("provider_meeting_id")) not in ids:
                out.append(f"the lead's link is a meeting Zoom no longer has ({r.get('provider_meeting_id')})")
            if len(mine) > 1:
                out.append(f"{len(mine)} meetings carry the room's code")
            if secret and r.get("provider_meeting_id") and str(r["provider_meeting_id"]) not in str(secret.get("start_url")):
                out.append("the host link is another meeting than the lead's link")
            jm = env.zoom.meetings.get(str(r.get("provider_meeting_id")))
            if jm and not str(r.get("join_url") or "").startswith(jm["join_url"]):
                out.append("the lead's link is not the room's meeting")
        if r["provider"] == "meet" and secret and secret.get("start_url") != r.get("join_url"):
            out.append("the Meet host link is not the lead's link")
    if r["state"] in rooms.FINAL:
        if mine:
            out.append(f"{r['state']} room left {len(mine)} meeting(s) behind")
        if secret:
            out.append(f"{r['state']} room kept its host link")
    return out


def play(k: int, mode: str, provider: str, hand_at: Optional[float] = None
         ) -> tuple[Optional[tuple[str, str]], list[str], tr.Env]:
    env = tr.Env()
    lease_rpc(env)
    env.add_room(1, provider=provider)
    env.google.ready_after = 1
    faulty = Faulty(env.net, k, mode)
    for t in range(1, 8):
        env.clock.at(T0 + 60 * t, lambda e=env: sweep(e))
    if hand_at is not None:
        # Someone runs `desk.py rooms --once` by hand in the middle of the cron's run.
        env.clock.at(T0 + hand_at, lambda e=env: e.worker("by-hand").run(seconds=0))
    with mock.patch.object(http, "request", faulty), \
            mock.patch.object(http.time, "sleep", side_effect=AssertionError("a real sleep")):
        start = int(T0)
        try:
            env.worker(f"vps-1-{start}-e{start + 60}").run(seconds=57)
        except Killed:
            pass
        faulty.armed = False
        for i, run in enumerate(("b", "c", "d", "e")):
            env.clock.advance(4)
            s = int(env.clock())
            env.worker(f"vps-{run}-{s}-e{s + 60}").run(seconds=57)
    return faulty.hit, problems(env), env


class EveryCallOfOneRun(unittest.TestCase):
    """One fault at every call of the run that makes the room, both providers."""

    def sweep_all(self, mode: str, provider: str, hand_at: Optional[float] = None) -> None:
        bad: list[str] = []
        k = 0
        while True:
            hit, found, env = play(k, mode, provider, hand_at)
            if hit is None:
                break
            if found:
                bad.append(f"call {k} {hit[0]} {hit[1]}: " + "; ".join(found))
            k += 1
            if k > 200:
                break
        self.assertGreater(k, 3, "the run made too few calls to be a test")
        self.assertEqual(bad, [], "\n".join(bad))

    def test_zoom_room_killed_at_every_call(self):
        self.sweep_all("kill", "zoom")

    def test_zoom_room_answer_lost_at_every_call(self):
        self.sweep_all("lost", "zoom")

    def test_zoom_room_refused_at_every_call(self):
        self.sweep_all("refused", "zoom")

    def test_meet_room_killed_at_every_call(self):
        self.sweep_all("kill", "meet")

    def test_meet_room_answer_lost_at_every_call(self):
        self.sweep_all("lost", "meet")

    def test_meet_room_refused_at_every_call(self):
        self.sweep_all("refused", "meet")

    def test_zoom_room_garbage_at_every_call(self):
        self.sweep_all("garbage", "zoom")

    def test_meet_room_garbage_at_every_call(self):
        self.sweep_all("garbage", "meet")

    def test_zoom_room_hung_at_every_call(self):
        self.sweep_all("hang", "zoom")

    def test_meet_room_hung_at_every_call(self):
        self.sweep_all("hang", "meet")

    def test_zoom_room_slow_at_every_call(self):
        self.sweep_all("slow", "zoom")

    def test_meet_room_slow_at_every_call(self):
        self.sweep_all("slow", "meet")


class AHandRunInTheMiddle(EveryCallOfOneRun):
    """The same faults, with `desk.py rooms --once` run by hand while the
    cron's run is slow at that call (the two runs overlap)."""

    def sweep_all(self, mode: str, provider: str, hand_at: Optional[float] = None) -> None:
        for at in (2.0, 6.0, 9.5):
            with self.subTest(hand_at=at):
                super().sweep_all(mode, provider, at)


if __name__ == "__main__":
    unittest.main()


class OneStray404(tr.RoomsCase):
    """One answer of 404 from the database's door (a gateway's stray page, a
    schema cache reload while a migration is applied) in the middle of a
    healthy minute. The tables are there: the next call answers."""

    def _404_once(self, piece: str, method: str = "GET") -> dict[str, int]:
        hit = {"n": 0}
        real = self.env.net

        def net(m: str, url: str, **kw: Any):
            if hit["n"] == 0 and m == method and piece in url and "db.test" in url and self.env.clock() > T0 + 5:
                hit["n"] += 1
                raise HttpError(404, '{"code":"PGRST205","message":"Could not find the table in the schema cache"}',
                                b"", url)
            return real(m, url, **kw)

        self.patch.stop()
        p = mock.patch.object(http, "request", net)
        p.start()
        self.addCleanup(p.stop)
        return hit

    def test_a_stray_404_on_the_rooms_read_stops_the_whole_minute(self):
        hit = self._404_once("cockpit_sales_rooms?select=*&state=in.")
        # A room the setter asks for 20 s into the minute, after the blip.
        self.env.clock.at(T0 + 20, lambda: self.env.add_room(2, provider="meet",
                                                              requested_at=rooms.iso(T0 + 20)))
        out = self.env.worker(f"vps-1-{int(T0)}-e{int(T0) + 60}").run(seconds=57)
        self.assertEqual(hit["n"], 1)
        status = self.env.pg.one("cockpit_sales_worker_status", worker="sales-desk", job="rooms") or {}
        # sales-api reads this row: "Not making rooms: " refuses every room.create
        # at once ("Video rooms are down right now"), until the next run writes again.
        self.assertFalse(str(status.get("detail", "")).startswith(rooms.NOT_MAKING),
                         f"one stray 404 told every rep video rooms are down: {status.get('detail')!r}")
        self.assertNotIn("blocked", out, f"the run stopped for the rest of its minute: {out.get('blocked')!r}")
        self.assertEqual(self.env.room(2)["state"], "open",
                         "the room asked for after the blip waited for the next minute's run")

    def test_a_stray_404_on_a_claim_stops_the_whole_minute(self):
        self.env.add_room(1, provider="meet", requested_at=rooms.iso(T0 + 6))
        self.env.clock.at(T0 + 6, lambda: None)
        hit = self._404_once("cockpit_sales_rooms?id=eq.", method="PATCH")
        self.env.clock.at(T0 + 20, lambda: self.env.add_room(2, provider="meet",
                                                              requested_at=rooms.iso(T0 + 20)))
        out = self.env.worker(f"vps-1-{int(T0)}-e{int(T0) + 60}").run(seconds=57)
        self.assertEqual(hit["n"], 1)
        status = self.env.pg.one("cockpit_sales_worker_status", worker="sales-desk", job="rooms") or {}
        self.assertFalse(str(status.get("detail", "")).startswith(rooms.NOT_MAKING),
                         f"one stray 404 told every rep video rooms are down: {status.get('detail')!r}")
        self.assertNotIn("blocked", out, f"the run stopped for the rest of its minute: {out.get('blocked')!r}")
        self.assertEqual(self.env.room(2)["state"], "open",
                         "the room asked for after the blip waited for the next minute's run")


# ---- an answer cut off half way, or not HTTP at all --------------------------------
#
# desk/http.py maps urllib's errors to HttpError(0) ("no answer") for
# URLError, TimeoutError and OSError. A body cut off before its
# Content-Length (http.client.IncompleteRead: the far end closed mid-answer,
# a function killed by a deploy while it answered) and a status line that is
# not HTTP (http.client.BadStatusLine: a middlebox's garbage) are
# http.client.HTTPException, not OSError: they pass through raw.

import http.client as _hc  # noqa: E402
import urllib.request as _ur  # noqa: E402


class _CutResponse:
    status = 200
    headers: dict[str, str] = {}

    def __init__(self, exc: BaseException):
        self.exc = exc

    def read(self) -> bytes:
        raise self.exc

    def __enter__(self):
        return self

    def __exit__(self, *a: Any) -> None:
        return None


class CutAnswersInTheHttpLayer(unittest.TestCase):
    def _request(self, exc: BaseException) -> BaseException:
        with mock.patch.object(_ur, "urlopen", lambda *a, **k: _CutResponse(exc)), \
                mock.patch.object(http.time, "sleep", lambda s: None):
            try:
                http.request("PATCH", "https://db.test/rest/v1/cockpit_sales_rooms?id=eq.x", data=b"{}",
                             timeout=4, retries=0)
            except BaseException as e:  # noqa: BLE001 - the test reads what came out
                return e
        raise AssertionError("no error at all")

    def test_a_body_cut_half_way_is_a_lost_answer(self):
        e = self._request(_hc.IncompleteRead(b'[{"id":"x","sta', 120))
        self.assertIsInstance(e, HttpError, f"a cut answer came out as {type(e).__name__}, which the worker "
                                            "does not catch where it catches a lost answer")

    def test_a_status_line_that_is_not_http_is_a_lost_answer(self):
        with mock.patch.object(_ur, "urlopen", side_effect=_hc.BadStatusLine("garbage")):
            try:
                http.request("GET", "https://api.zoom.us/v2/users/x", timeout=4, retries=0)
                raise AssertionError("no error at all")
            except BaseException as e:  # noqa: BLE001
                self.assertIsInstance(e, HttpError, f"a garbage status line came out as {type(e).__name__}")


class CutAnswersInTheWorker(tr.RoomsCase):
    """The same raw errors where the worker meets them (the fake HTTP layer
    raises what desk/http.py lets through)."""

    def _cut_once(self, method: str, piece: str) -> dict[str, int]:
        hit = {"n": 0}
        real = self.env.net

        def net(m: str, url: str, **kw: Any):
            if hit["n"] == 0 and m == method and piece in url:
                hit["n"] += 1
                if "functions/v1/sales-api" in url:
                    real(m, url, **kw)  # sales-api got it and was answering when the answer was cut
                raise _hc.IncompleteRead(b"{", 40)
            return real(m, url, **kw)

        self.patch.stop()
        p = mock.patch.object(http, "request", net)
        p.start()
        self.addCleanup(p.stop)
        return hit

    def test_a_cut_answer_to_the_rooms_read_kills_the_run_with_no_status(self):
        self.env.add_room(1, provider="meet")
        self._cut_once("GET", "cockpit_sales_rooms?select=*&state=in.")
        w = self.env.worker(f"vps-1-{int(T0)}-e{int(T0) + 60}")
        try:
            w.run(seconds=57)
        except Exception as e:  # noqa: BLE001
            self.fail(f"one cut answer ended the room worker's minute with {type(e).__name__}: no room is made "
                      "until the next run and its status row is not written")
        self.assertEqual(self.env.room(1)["state"], "open")

    def test_a_cut_answer_from_sales_api_writes_room_not_made_on_an_open_room(self):
        self.env.add_room(1, provider="zoom")
        self._cut_once("POST", "functions/v1/sales-api")
        try:
            self.env.worker(f"vps-1-{int(T0)}-e{int(T0) + 60}").run(seconds=0)
        except Exception as e:  # noqa: BLE001
            self.fail(f"the run died on {type(e).__name__}")
        r = self.env.room(1)
        self.assertEqual(r["state"], "open")
        said = [e.get("text") for e in self.env.pg.rows(rooms.EVENTS) if e.get("room_id") == r["id"]]
        self.assertFalse(any(str(t).startswith("The room was not made") for t in said),
                         f"the open room's timeline says it was not made: {said}")
        status = self.env.pg.one("cockpit_sales_worker_status", worker="sales-desk", job="rooms") or {}
        self.assertNotIn("error on our side", str(status.get("detail")),
                         f"the health line blames an error for a room that opened: {status.get('detail')!r}")


class HostsReadBlip(tr.RoomsCase):
    """The Team page linked the closer's Zoom user by hand (their Zoom login is
    another address than their seat). One blip on the room hosts read."""

    def test_a_blip_on_the_hosts_read_fails_the_room_as_no_zoom_user(self):
        closer2 = "closer2@example.test"
        self.env.zoom.users["zoom-login@example.test"] = {"id": "zu-closer2", "email": "zoom-login@example.test",
                                                          "type": 2, "status": "active"}
        self.env.zoom.users["zu-closer2"] = self.env.zoom.users["zoom-login@example.test"]
        self.env.pg.put(rooms.HOSTS, {"email": closer2, "zoom_user_id": "zu-closer2", "zoom_status": "licensed",
                                      "google_ok": True})
        self.env.add_room(1, provider="zoom", host_email=closer2, call_kind="demo")
        real = self.env.net
        hit = {"n": 0}

        def net(m: str, url: str, **kw: Any):
            if hit["n"] == 0 and m == "GET" and "cockpit_sales_room_hosts?select=zoom_user_id" in url:
                hit["n"] += 1
                raise HttpError(503, '{"message":"upstream connect error"}', b"", url)
            return real(m, url, **kw)

        self.patch.stop()
        p = mock.patch.object(http, "request", net)
        p.start()
        self.addCleanup(p.stop)
        self.env.worker(f"vps-1-{int(T0)}-e{int(T0) + 60}").run(seconds=0)
        self.assertEqual(hit["n"], 1)
        r = self.env.room(1)
        self.assertNotEqual(r.get("error"), rooms.SAY["no_user"],
                            "one blip on the hosts read told the closer they have no Zoom user and to ask the CEO")
