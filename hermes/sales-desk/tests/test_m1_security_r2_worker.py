"""Milestone 1, video-link round 2, security: the kill switch on the room
worker's side (kill-switch-link-still-sent, the worker's half).

A manager switches rooms off (rooms.enabled false, the kill switch) while the
worker is making a room it claimed with the switch on. The worker reads its
settings every 25 s, so before round 2 it opened the room and told sales-api
worker.ready on a switch that was off. Now it reads the switch again right
before a room opens: the room fails with the switched-off sentence, never
opens, and the meeting it made is closed like a failed room's. (sales-api's
own fence still sends no link either way: m1_security_r2.test.ts.)

Every room, seat, meeting and key is invented, and nothing reaches the
network.

    python3 -m unittest tests.test_m1_security_r2_worker
"""
from __future__ import annotations

import os
import unittest

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests import test_rooms as tr  # noqa: E402


class KillSwitchBeforeOpen(tr.RoomsCase):
    def switch_off_during_create(self) -> None:
        """The manager's switch-off lands while Zoom makes the meeting (or Google the Meet)."""
        env = self.env
        real = env.net.zoom.__call__
        greal = env.net.google.__call__

        def off() -> None:
            row = env.pg.one("cockpit_sales_settings", key="rooms")
            env.pg.put("cockpit_sales_settings", {"key": "rooms", "value": {**row["value"], "enabled": False}})
            env.clock.advance(rooms.SWITCH_REREAD_S + 1)

        class Zoom:
            def __getattr__(self, name):
                return getattr(env.zoom, name)

            def __call__(self, method, url, data):
                out = real(method, url, data)
                if method == "POST" and url.rstrip("/").endswith("/meetings"):
                    off()
                return out

        class Google:
            def __getattr__(self, name):
                return getattr(env.google, name)

            def __call__(self, method, url, data):
                out = greal(method, url, data)
                if method == "POST" and "/events" in url:
                    off()
                return out

        env.net.zoom = Zoom()
        env.net.google = Google()

    def test_control_with_the_switch_on_the_room_opens(self):
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")
        self.assertIn("worker.ready", self.env.api.kinds())

    def test_a_zoom_room_whose_switch_went_off_mid_make_never_opens(self):
        self.switch_off_during_create()
        self.env.add_room()
        self.tick(self.env.worker())
        r = self.env.room()
        self.assertEqual({"state": r["state"], "error": r.get("error"), "told_ready": "worker.ready" in self.env.api.kinds()},
                         {"state": "failed", "error": rooms.SAY["switched_off"], "told_ready": False})
        # The meeting it made is noted on the room, so the close step closes it.
        self.assertTrue(r.get("provider_meeting_id"))

    def test_a_meet_room_whose_switch_went_off_mid_make_never_opens(self):
        self.switch_off_during_create()
        self.env.google.ready_after = 0
        self.env.add_room(provider="meet")
        self.env.worker().run(seconds=20)
        r = self.env.room()
        self.assertEqual({"state": r["state"], "error": r.get("error"), "told_ready": "worker.ready" in self.env.api.kinds()},
                         {"state": "failed", "error": rooms.SAY["switched_off"], "told_ready": False})


if __name__ == "__main__":
    unittest.main()
