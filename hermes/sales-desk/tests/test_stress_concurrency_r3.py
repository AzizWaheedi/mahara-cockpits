"""Round 3 stress, dimension: concurrency. The room worker racing the
handover claim on one room: a closer's standby room is still being made on
Zoom when they press Take, and cockpit_sales_live_claim adopts it (purpose
handover, the lead, the handover's host wait of 120 s, the call's length).
The worker then opens the room with the copy of the row it claimed a moment
before (purpose standby, no deadlines yet), so its own "deadlines only where
they are unset" are computed from a row that is no longer the room.

A failing test is a finding for the fix agent; once fixed it stays as a
regression test. Nothing here reaches the network (the fakes of
tests.test_rooms).

    python3 -m unittest tests.test_stress_concurrency_r3
"""
from __future__ import annotations

import unittest

from desk import rooms
from tests.test_rooms import CLOSER, T0, RoomsCase, rid


class WorkerOpenAfterTakeAdopted(RoomsCase):
    def _standby_adopted_while_made(self, *, kind: str) -> dict:
        env = self.env
        env.add_room(1, purpose="standby", contact_id=None, host_email=CLOSER, provider="zoom", call_kind="demo",
                     send_on="open")
        claimed_at = {}

        def take(_meeting: dict) -> None:
            # cockpit_sales_live_claim, at the moment Zoom answered the worker's
            # create: the standby room (state creating) becomes the handover's.
            r = env.room()
            now = env.clock()
            claimed_at["t"] = now
            r.update({
                "contact_id": "contact-test-lead", "purpose": "handover", "handover_id": rid(900), "call_kind": kind,
                "send_on": "host_in",
                "host_by": rooms.iso(max(rooms.parse_ts(r.get("host_by")) or now, now + 120)),
                "ends_at": rooms.iso(max(rooms.parse_ts(r.get("ends_at")) or now, now + (60 if kind == "demo" else 30) * 60)),
                "version": int(r.get("version") or 1) + 1,
            })

        env.zoom.after_create = take
        self.tick(env.worker())
        return {"room": env.room(), "claimed_at": claimed_at.get("t", T0)}

    def test_the_handover_keeps_its_two_minute_host_wait_when_the_worker_opens_the_adopted_room(self):
        got = self._standby_adopted_while_made(kind="demo")
        room = got["room"]
        self.assertEqual(room["state"], "open")
        self.assertEqual(room["purpose"], "handover")
        host_by = rooms.parse_ts(room["host_by"])
        # The claim gave the taker the handover's 120 s (contract-v2 section 8;
        # the sweep's L2 ends the handover at claim + closer_wait). The worker's
        # open must not stretch it to the standby room's 300 s from a stale copy.
        self.assertLessEqual(host_by - got["claimed_at"], 120 + 5,
                             f"host_by is {host_by - got['claimed_at']:.0f}s after the Take, not the handover's 120s")

    def test_an_intro_handover_keeps_its_own_length_when_the_worker_opens_the_adopted_room(self):
        # A closer's standby is made for a demo (60 min); the handover adopted is
        # an intro (30 min). The room's end is the claim's, never the stale copy's.
        got = self._standby_adopted_while_made(kind="intro")
        room = got["room"]
        ends = rooms.parse_ts(room["ends_at"])
        self.assertLessEqual(ends - got["claimed_at"], 30 * 60 + 5,
                             f"ends_at is {(ends - got['claimed_at']) / 60:.0f} min after the Take, not the intro's 30")


if __name__ == "__main__":
    unittest.main()
