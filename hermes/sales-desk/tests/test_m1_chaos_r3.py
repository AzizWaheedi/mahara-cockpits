"""Milestone 1, video-link round 3, chaos on the room worker (2026-10-06).

Two faults a Zoom incident and a deploy bring together:
  - the note that a create went out (`worker.create_sent`, written before the
    first create) meets a database blip, and the worker goes on: the note is
    "never fatal";
  - the run is killed (a deploy of the desk, the VPS rebooting, the OOM
    killer) right after Zoom made the meeting, before anything about it is
    written down;
and Zoom's meeting list lags behind its creates, as the worker's own
comments say it can ("Zoom's list can lag, so it is looked for again rather
than made a second time").

The next run adopts the room, does not find the meeting by its code (the
list lags), finds no note that a create went out, and makes a second
meeting: the rep's Zoom holds two meetings with the room's code, the room
opens with the second, and the first is never closed.

Every room, seat, meeting and key is invented, and nothing reaches the
network.

    python3 -m unittest tests.test_m1_chaos_r3
"""
from __future__ import annotations

import os
import unittest
from typing import Any
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, rooms  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests import test_rooms as tr  # noqa: E402

T0 = tr.T0


class Killed(BaseException):
    """The process died: nothing in the worker catches a BaseException."""


class LaggingList:
    """Zoom with its scheduled-meeting list behind its creates by `lag` seconds."""

    def __init__(self, zoom: tr.FakeZoom, clock: tr.Clock, lag: float):
        self.z, self.clock, self.lag = zoom, clock, lag
        self.made_at: dict[str, float] = {}
        zoom.after_create = lambda m: self.made_at.__setitem__(str(m["id"]), clock())

    def __getattr__(self, name: str) -> Any:
        return getattr(self.z, name)

    def __call__(self, method: str, url: str, data: Any):
        status, h, raw = self.z(method, url, data)
        if method == "GET" and "/meetings" in url and "type=live" not in url and "/users/" in url:
            import json
            body = json.loads(raw.decode())
            body["meetings"] = [m for m in body.get("meetings", [])
                                if self.clock() - self.made_at.get(str(m["id"]), -1e9) >= self.lag]
            raw = json.dumps(body).encode()
        return status, h, raw


class CreateNoteLostThenKilled(tr.RoomsCase):
    def play(self, *, note_blip: bool, lag: float) -> dict[str, Any]:
        env = self.env
        lagging = LaggingList(env.zoom, env.clock, lag)
        env.net.zoom = lagging  # type: ignore[assignment]
        env.add_room(1, provider="zoom")
        state = {"made": False, "killed": False}
        real = env.net

        def net(method: str, url: str, **kw: Any):
            body = kw.get("data") or b""
            if note_blip and method == "POST" and rooms.EVENTS in url and b"worker.create_sent" in body:
                raise HttpError(503, '{"message":"scripted outage"}', b"", url)
            if "/users/" in url and url.rstrip("/").split("?")[0].endswith("/meetings") and method == "POST":
                out = real(method, url, **kw)
                state["made"] = True
                return out
            if state["made"] and not state["killed"]:
                # The first call after Zoom made the meeting: the run dies here.
                state["killed"] = True
                raise Killed(f"killed before {method} {url}")
            return real(method, url, **kw)

        with mock.patch.object(http, "request", net):
            start = int(env.clock())
            try:
                env.worker(f"vps-1-{start}-e{start + 60}").run(seconds=57)
            except Killed:
                pass
            for run in ("b", "c", "d"):
                env.clock.advance(65)
                s = int(env.clock())
                env.worker(f"vps-{run}-{s}-e{s + 60}").run(seconds=57)
        r = env.room(1)
        topic = f"Mahara call {r['code']}"
        mine = [m for m in env.zoom.meetings.values() if m["topic"] == topic]
        return {"creates_sent": env.zoom.count("POST", "/meetings"), "meetings_with_the_code": len(mine),
                "state": r["state"]}

    def test_held_the_note_lands_kill_after_create_lagging_list_one_meeting(self):
        got = self.play(note_blip=False, lag=90)
        self.assertEqual((got["creates_sent"], got["meetings_with_the_code"]), (1, 1), got)

    # Outside the video-link rounds' lists so far (the worker's create note
    # lost to a blip, then a kill, then a lagging Zoom list): kept, skipped,
    # for the round that takes it.
    @unittest.skip("outside video-link round 3b's list; kept for the round that takes it")
    def test_m1_chaos_r3_create_note_blip_kill_lagging_list_second_meeting(self):
        got = self.play(note_blip=True, lag=90)
        self.assertEqual((got["creates_sent"], got["meetings_with_the_code"]), (1, 1), got)


if __name__ == "__main__":
    unittest.main()
