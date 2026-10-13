"""Chaos round 4 (3 October 2026): the room worker when Zoom's sign-in
endpoint fails for a few seconds.

Every Zoom call first asks zoom.us/oauth/token for the app's token (kept for
an hour). When that endpoint answers 5xx, the token call is retried twice
and then raised as an unclear ProviderError. zoom_create reads any unclear
error from `self.zoom.create(...)` as "a create was sent and its answer
never came" (sent_unclear), and `_note_create` has already stored
`worker.create_sent` before the call, although the create itself never
left the VPS: only the token request failed. Fast 5xx answers never trip
Zoom's breaker (only slow failures do), so the room keeps trying until the
run's time is up and is handed over as `unclear:`. Every later run then only
looks for the meeting by its code and never makes it (the create "was
sent"), and the room sits on "Making your Zoom room" until the SQL sweep
fails it at claim + 120 s: "Making the room took more than two minutes."
The rep and the lead wait two minutes for a room Zoom could have made in
the next run's first second.

    python3 -m unittest tests.test_stress_chaos_r4
"""
from __future__ import annotations

import unittest

from desk import rooms
from tests.test_rooms import T0, RoomsCase, _err


class ZoomSignInBlip(RoomsCase):
    def zoom_signin_down_until(self, until: float) -> None:
        real = self.env.zoom.token
        clock = self.env.clock

        def token(method, url):
            if clock() < until:
                self.env.zoom.tokens += 1
                raise _err(503, {"reason": "Service Unavailable"}, url)
            return real(method, url)

        self.env.zoom.token = token  # type: ignore[assignment]

    def test_held_a_room_claimed_early_in_the_run_fails_with_a_next_step(self):
        # Zoom's sign-in answers 503 for the whole run: the room ends in a
        # named state with a sentence the rep can act on.
        self.zoom_signin_down_until(T0 + 120)
        self.env.clock.at(T0 + 5.0, lambda: self.env.add_room(1, requested_at=rooms.iso(T0 + 5.0)))
        self.env.worker("run-a").run(seconds=57)
        row = self.env.room(1)
        self.assertEqual((row["state"], row["error"]), ("failed", rooms.SAY["zoom_down"]))
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0)

    def test_a_room_claimed_late_in_the_run_is_made_once_zoom_signs_in_again(self):
        # Zoom's sign-in answers 503 from 39 s into the run until the next
        # minute's run starts; Zoom's API itself is fine throughout.
        self.zoom_signin_down_until(T0 + 60.0)
        self.env.clock.at(T0 + 40.0, lambda: self.env.add_room(1, requested_at=rooms.iso(T0 + 40.0)))
        self.env.worker("run-a").run(seconds=57)
        # No create ever reached Zoom: every try stopped at the token.
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0)
        self.assertEqual(self.env.room(1)["state"], "creating")
        # The next minute's run: Zoom answers everything at once.
        self.env.clock.advance(max(0.0, T0 + 60.0 - self.env.clock()))
        self.env.worker("run-b").run(seconds=57)
        row = self.env.room(1)
        # Today: run-b reads the room as "a create went out" (worker.create_sent,
        # the unclear: hand-over) and only looks for it by its code, every few
        # seconds, for the whole minute; Zoom never gets a create, and the
        # sweep fails the room at claim + 120 s.
        self.assertEqual(row["state"], "open", f"the room is {row['state']}; Zoom creates seen: "
                                               f"{self.env.zoom.count('POST', '/meetings')}")
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 1)


class VpsClockAhead(RoomsCase):
    """The VPS clock runs 45 s ahead of the database's: under the 60 s at
    which the worker stops claiming (CLOCK_STOP_S), so rooms are still made,
    and the status row only warns. The database stamps claimed_at with its
    own now() (the rooms guard, 20261003d), and the worker's Meet wait
    (`_meet_until`: claimed_at + meet_pending, 30 s) is compared with the
    VPS's own clock: the 30 s are already over when the room is claimed.
    Google answers "pending" first for most new Meet links, so every such
    room fails at once with "Google did not make the Meet link. Try Zoom.",
    which is neither true nor the fix (the VPS clock)."""

    def test_held_on_the_same_clock_a_meet_room_google_answers_pending_first_is_made(self):
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        self.env.google.ready_after = 2
        self.env.add_room(1, provider="meet")
        self.env.worker("run-a").run(seconds=12)
        self.assertEqual(self.env.room(1)["state"], "open")

    def test_a_meet_room_google_answers_pending_first_is_made_on_a_vps_45_s_ahead(self):
        env = self.env
        env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        env.google.ready_after = 2
        ahead = 45.0
        env.add_room(1, provider="meet", requested_at=rooms.iso(env.clock() - ahead - 1))
        w = env.worker("run-a")
        # The database's Date header puts its clock 45 s behind this VPS.
        w.sb.clock_offset = -ahead
        w.run(seconds=12)
        row = env.room(1)
        self.assertEqual(row["state"], "open", f"the room is {row['state']}: {row.get('error')}")


if __name__ == "__main__":
    unittest.main()
