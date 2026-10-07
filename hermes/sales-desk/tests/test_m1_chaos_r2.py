"""Milestone 1, video-link round 2, chaos on the room worker (2026-10-05).

Two faults at once on a Zoom room, as a Zoom incident brings them: the
create lands at Zoom and its answer is lost (a timeout, a dropped
connection), and the read that should find it by its code fails too (a 503,
a timeout, or a 200 page with no meeting list in it). zoom_create's promise
is that "a meeting is never made twice": before each new try the host's
meetings are read for the room's code. When that read itself fails, the loop
sends the create again, so the rep's Zoom holds two meetings with the room's
code; the room opens with the second, and the first is never closed (the
close step closes only the meeting saved on the room).

Every room, seat, meeting and key is invented, and nothing reaches the
network.

    python3 -m unittest tests.test_m1_chaos_r2
"""
from __future__ import annotations

import os
import unittest

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests import test_rooms as tr  # noqa: E402


class ZoomCreateLostAndFindFails(tr.RoomsCase):
    """The create is made and its answer lost; the code lookup that follows fails."""

    def _meetings_for(self, code: str) -> list[dict]:
        topic = f"Mahara call {code}"
        return [m for m in self.env.zoom.meetings.values() if m["topic"] == topic]

    def _run_until_closed(self) -> None:
        # The room is used and ended by the rep; the following runs close what is left.
        r = self.env.room()
        r.update({"state": "ended", "result": "ended", "ended_at": rooms.iso(self.env.clock()),
                  "version": int(r["version"]) + 1})
        for i in range(4):
            self.env.clock.advance(60)
            self.env.worker(f"run-close-{i}").run(seconds=0)
            self.env.clock.advance(15)
            self.env.worker(f"run-close-{i}b").run(seconds=0)

    def check(self, mode: str) -> None:
        z = self.env.zoom
        z.script = [{"method": "POST", "path": "/meetings", "status": 0, "make": True}]
        real = z.__call__
        left = {"n": 6}

        def zoom(method, url, data):
            # The code lookup (the host's scheduled meetings) fails while Zoom is in trouble.
            if method == "GET" and "type=scheduled" in url and left["n"] > 0:
                left["n"] -= 1
                z.calls.append((method, url, {}, None))
                if mode == "503":
                    raise tr._err(503, {"code": 0, "message": "Service Unavailable"}, url)
                if mode == "timeout":
                    self.env.clock.advance(z.call_timeout)
                    raise tr.HttpError(0, "TimeoutError: timed out", b"", url)
                return 200, {}, b"{}"  # a 200 with no meeting list in it
            return real(method, url, data)

        class Proxy:
            """The fake Zoom with its code lookup failing; every other call as it is."""

            def __getattr__(self, name):
                return getattr(z, name)

            def __setattr__(self, name, value):
                setattr(z, name, value)

            def __call__(self, method, url, data):
                return zoom(method, url, data)

        self.env.net.zoom = Proxy()
        self.env.add_room()
        self.tick(self.env.worker())
        r = self.env.room()
        code = r["code"]
        made = self._meetings_for(code)
        open_state = r["state"]
        left["n"] = 0
        self.env.net.zoom = z
        self._run_until_closed()
        left = self._meetings_for(code)
        self.assertEqual(
            {"creates_sent": z.count("POST", "/meetings"), "meetings_with_the_code": len(made),
             "left_after_the_room_ended": len(left), "state_after_make": open_state},
            {"creates_sent": 1, "meetings_with_the_code": 1, "left_after_the_room_ended": 0,
             "state_after_make": open_state},
        )

    def test_zoom_double_create_when_code_lookup_fails_503(self):
        self.check("503")

    def test_zoom_double_create_when_code_lookup_times_out(self):
        self.check("timeout")

    def test_zoom_double_create_when_code_lookup_answers_no_list(self):
        self.check("nolist")


if __name__ == "__main__":
    unittest.main()
