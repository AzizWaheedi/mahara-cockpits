"""Adversarial review of the room worker (review lane, 2026-10-03).

Each test states the behaviour the specs and the brief ask for. A test that
FAILS here is a confirmed finding; a test that passes is a guard. Nothing
reaches the network: the fakes are test_rooms.py's.

    python3 -m unittest tests.test_rooms_adversarial -v
"""
from __future__ import annotations

import json
import os
import unittest
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http  # noqa: E402
from desk import rooms  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests.test_rooms import CLOSER, T0, Env, RoomsCase, rid  # noqa: E402


def opened_after(env: Env, n: int) -> float:
    row = env.room(n)
    return rooms.parse_ts(row["opened_at"]) - rooms.parse_ts(row["requested_at"])


class ProviderOutageStarvesOthers(RoomsCase):
    """Brief: provider failure and timeouts; F: 95% of rooms ready within 15 s."""

    def test_a_hanging_zoom_does_not_starve_a_meet_room(self):
        self.env.zoom.latency = 30.0           # every Zoom call times out
        self.env.google.ready_after = 0
        self.env.add_room(1, requested_at=rooms.iso(T0 - 1.0))                       # Zoom, first in line
        self.env.add_room(2, provider="meet", host_email=CLOSER, requested_at=rooms.iso(T0 - 0.5))
        self.env.worker("run-a").run(seconds=57)
        self.env.clock.advance(3)
        self.env.worker("run-b").run(seconds=57)
        row = self.env.room(2)
        self.assertEqual(row["state"], "open", f"Meet room ended {row['state']}: {row.get('error')}")
        self.assertLess(opened_after(self.env, 2), 15.0)

    def test_a_final_zoom_room_that_will_not_close_does_not_block_new_rooms(self):
        # One expired Zoom room waiting to be closed while Zoom hangs.
        m = self.env.zoom._make("zu-setter", {"topic": "Mahara call OLD111"})
        self.env.add_room(9, code="OLD111", state="expired", provider_meeting_id=str(m["id"]),
                          ended_at=rooms.iso(T0 - 5))
        self.env.pg.put(rooms.SECRETS, {"room_id": rid(9), "start_url": m["start_url"], "expires_at": None})
        self.env.zoom.latency = 30.0
        self.env.google.ready_after = 0
        self.env.clock.at(T0 + 12.0, lambda: self.env.add_room(
            2, provider="meet", host_email=CLOSER, requested_at=rooms.iso(T0 + 12.0)))
        self.env.worker().run(seconds=57)
        self.assertEqual(self.env.room(2)["state"], "open")
        self.assertLess(opened_after(self.env, 2), 15.0)


class SlowSalesApi(RoomsCase):
    """The existing desk calls sales-api with timeout 60 and retries 0
    (desk.py cmd_followups). A worker.ready handler that sends a template
    reads it back for 12 to 20 s (C29)."""

    def setUp(self):
        super().setUp()
        self.patch.stop()
        net, clock = self.env.net, self.env.clock
        self.invocations = 0

        def wrapped(method, url, *, headers=None, data=None, json_body=None, timeout=60, retries=2,
                    ok_statuses=(200, 201, 202, 204)):
            if "/functions/v1/sales-api" in url:
                # The handler runs (and sends) every time it is called, and
                # answers after 20 s; the caller gives up at its timeout.
                self.invocations += 1
                net.api.bodies.append(json.loads((data or b"{}").decode()))
                if timeout < 20.0:
                    clock.advance(timeout)
                    raise HttpError(0, "TimeoutError: timed out", b"", url)
                clock.advance(20.0)
                return 200, {}, b'{"ok":true}'
            return net(method, url, headers=headers, data=data, json_body=json_body, timeout=timeout,
                       retries=retries, ok_statuses=ok_statuses)

        self.patch = mock.patch.object(http, "request", wrapped)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_a_slow_sales_api_does_not_hold_up_the_next_room(self):
        self.env.google.ready_after = 0
        self.env.add_room(1, requested_at=rooms.iso(T0 - 1.0))
        self.env.clock.at(T0 + 2.0, lambda: self.env.add_room(
            2, provider="meet", host_email=CLOSER, requested_at=rooms.iso(T0 + 2.0)))
        self.env.worker().run(seconds=57)
        self.assertEqual(self.env.room(2)["state"], "open")
        self.assertLess(opened_after(self.env, 2), 15.0, "the second room waited on sales-api")

    def test_a_slow_room_event_is_not_sent_again_while_the_first_still_runs(self):
        self.env.add_room(1, requested_at=rooms.iso(T0 - 1.0))
        self.env.worker().run(seconds=57)
        first = [b for b in self.env.api.bodies if b.get("room_id") == rid(1)]
        self.assertLessEqual(len(first), 1,
                             f"room.event for one room was invoked {len(first)} times while the first was still running")


class LostAnswers(RoomsCase):
    """A write that committed but whose answer was lost is retried by
    http.request (patch_returning retries=1); the retry sees the new state."""

    def _commit_then_lose(self, match: str):
        real = self.env.pg.__call__
        state = {"done": False}

        def flaky(method, url, **kw):
            if (method == "PATCH" and "cockpit_sales_rooms?" in url and match in http.urllib.parse.unquote(url)
                    and not state["done"]):
                state["done"] = True
                real(method, url, **kw)          # committed ...
                return real(method, url, **kw)   # ... and the retry's answer is what the worker sees
            return real(method, url, **kw)

        self.env.net.pg = flaky  # type: ignore[assignment]

    def test_a_lost_answer_to_the_open_patch_still_tells_sales_api(self):
        self._commit_then_lose("state=eq.creating&worker_run=eq.")
        self.env.add_room()
        self.env.worker().run(seconds=5)
        row = self.env.room()
        self.assertEqual(row["state"], "open")
        self.assertEqual(self.env.api.kinds(rid(1)), ["worker.ready"], "the link is never sent")
        self.assertIsNotNone(self.env.pg.one(rooms.EVENTS, dedupe_key=f"worker.ready:{rid(1)}"),
                             "no stored event either, so the sweep cannot replay it")

    def test_a_lost_answer_to_the_fail_patch_still_tells_sales_api(self):
        self.env.zoom.live["zu-setter"] = [{"id": 99001}]
        self._commit_then_lose("state=in.(requested,creating)")
        self.env.add_room()
        self.env.worker().run(seconds=3)
        self.assertEqual(self.env.room()["state"], "failed")
        self.assertEqual(self.env.api.kinds(rid(1)), ["worker.failed"])


class KillSwitch(RoomsCase):
    def test_an_unreadable_settings_row_does_not_make_rooms(self):
        self.env.pg.one("cockpit_sales_settings", key="rooms")["value"]["enabled"] = False
        real = self.env.pg.__call__

        def flaky(method, url, **kw):
            if method == "GET" and "cockpit_sales_settings" in url:
                raise HttpError(503, "busy", b"", url)
            return real(method, url, **kw)

        self.env.net.pg = flaky  # type: ignore[assignment]
        self.env.add_room()
        self.env.worker().run(seconds=0)
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0, "switched off, yet a Zoom meeting was made")

    def test_a_missing_rooms_setting_means_off(self):
        self.env.pg.tables["cockpit_sales_settings"].clear()
        self.env.add_room()
        self.env.worker().run(seconds=0)
        self.assertEqual(self.env.zoom.count("POST", "/meetings"), 0, "no rooms setting at all, yet a room was made")


class NearTheEnd(RoomsCase):
    def test_a_slow_but_healthy_zoom_near_the_end_is_handed_over_not_failed(self):
        self.env.zoom.latency = 2.0          # healthy, 2 s per call
        self.env.clock.at(T0 + 53.5, lambda: self.env.add_room(1, requested_at=rooms.iso(T0 + 53.5)))
        self.env.worker("run-a").run(seconds=57)
        self.assertNotEqual(self.env.room()["state"], "failed",
                            f"failed with {self.env.room().get('error')!r} only because the run ended")


class StandbyRefresh(RoomsCase):
    """P2: at 35 minutes the closer's standby room is replaced by a fresh one
    while the closer still sits in the old meeting."""

    def test_the_host_s_own_old_room_does_not_make_the_new_one_busy(self):
        # Standby rooms are live handover's: made only while live.enabled is on (Milestone 1 fence).
        self.env.pg.put("cockpit_sales_settings", {"key": "live", "value": {"enabled": True}})
        old = self.env.zoom._make("zu-closer", {"topic": "Mahara call STBY01"})
        self.env.zoom.meetings[str(old["id"])]["status"] = "started"
        self.env.zoom.live["zu-closer"] = [{"id": old["id"], "topic": old["topic"]}]
        self.env.add_room(1, code="STBY01", state="host_in", purpose="standby", contact_id=None, host_email=CLOSER,
                          call_kind="demo", provider_meeting_id=str(old["id"]))
        self.env.pg.put(rooms.SECRETS, {"room_id": rid(1), "start_url": old["start_url"], "expires_at": None})

        def refresh():
            self.env.room(1).update({"state": "ended", "ended_at": rooms.iso(T0 + 3)})
            self.env.add_room(2, code="STBY02", purpose="standby", contact_id=None, host_email=CLOSER,
                              call_kind="demo", requested_at=rooms.iso(T0 + 3))

        self.env.clock.at(T0 + 3.0, refresh)
        self.env.worker().run(seconds=20)
        row = self.env.room(2)
        self.assertEqual(row["state"], "open", row.get("error"))


class RecoveryUsesWhatItKnows(RoomsCase):
    def test_a_meeting_this_run_made_is_not_made_again_when_zoom_s_list_lags(self):
        # The secrets write fails once after Zoom made the meeting; Zoom's
        # list does not show a meeting younger than 10 s.
        real_pg = self.env.pg.__call__
        state = {"n": 0}

        def flaky(method, url, **kw):
            if method == "POST" and "cockpit_sales_room_secrets" in url and state["n"] == 0:
                state["n"] += 1
                raise HttpError(503, "busy", b"", url)
            return real_pg(method, url, **kw)

        self.env.net.pg = flaky  # type: ignore[assignment]
        zoom = self.env.zoom
        born: dict[str, float] = {}
        real_make = zoom._make

        def make(user, body):
            m = real_make(user, body)
            born[str(m["id"])] = self.env.clock()
            return m

        zoom._make = make  # type: ignore[assignment]
        real_call = zoom.__call__

        def lagging(method, url, data):
            out = real_call(method, url, data)
            if method == "GET" and "type=scheduled" in url:
                payload = json.loads(out[2].decode())
                payload["meetings"] = [m for m in payload["meetings"]
                                       if self.env.clock() - born.get(str(m["id"]), 0) >= 10]
                return out[0], out[1], json.dumps(payload).encode()
            return out

        self.env.net.zoom = mock.Mock(side_effect=lagging, latency=0.0,
                                      token=zoom.token)  # type: ignore[assignment]
        self.env.add_room()
        self.env.worker().run(seconds=5)
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(len(zoom.meetings), 1, "a second Zoom meeting was made for one room")


class CancelledWhileMadeAndZoomRefusesClose(RoomsCase):
    def test_the_meeting_is_still_closed_later(self):
        self.env.add_room()
        zoom = self.env.zoom
        zoom.after_create = lambda m: self.env.room().update({"state": "cancelled"})
        # Zoom will not answer the first close attempt.
        zoom.script = [{"method": "GET", "path": "/meetings/81000000001", "status": 503, "exact": True}] * 3
        self.env.worker().run(seconds=30)
        self.assertEqual(zoom.meetings, {}, "the cancelled room's Zoom meeting was never closed")


class SecretsInErrors(RoomsCase):
    def test_a_refused_secrets_write_never_puts_the_host_token_in_the_status_row(self):
        real = self.env.pg.__call__

        def refuse(method, url, **kw):
            if method == "POST" and "cockpit_sales_room_secrets" in url:
                row = json.loads(kw["data"].decode())[0]
                body = json.dumps({"code": "23502", "details": f"Failing row contains ({row['room_id']}, "
                                   f"{row['start_url']}, null).", "hint": None,
                                   "message": "null value in column \"made_by\" violates not-null constraint"})
                raise HttpError(400, body, body.encode(), url)
            return real(method, url, **kw)

        self.env.net.pg = refuse  # type: ignore[assignment]
        self.env.add_room()
        self.env.worker().run(seconds=0)
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        logs = " ".join(m for _l, m in self.env.log.lines)
        self.assertNotIn("zak=host", row["detail"] + logs)


class DatabaseCallsAndTheHardStop(RoomsCase):
    def test_no_database_call_can_outlive_the_hard_stop(self):
        w = self.env.worker()
        w.run(seconds=57)
        hard = T0 + 57 + rooms.HARD_SLACK
        late = [(round(t - T0, 1), timeout, retries) for t, m, u, timeout, retries in self.env.net.log
                if "db.test/rest" in u and t + timeout * (retries + 1) > hard + 0.5]
        self.assertEqual(late, [], "database calls that may run past the hard stop (t, timeout, retries)")


class HostCheckDelaysRooms(RoomsCase):
    def test_a_room_asked_for_during_the_host_check_is_ready_within_15_s(self):
        for i in range(6):
            email = f"seat{i}@example.test"
            self.env.pg.put("cockpit_sales_people", {"email": email, "name": "Invented", "role": "closer", "active": True})
            self.env.zoom.users[email] = {"id": f"zu-s{i}", "type": 2, "status": "active"}
        self.env.zoom.latency = 1.5
        self.env.clock.at(T0 + 0.5, lambda: self.env.add_room(1, requested_at=rooms.iso(T0 + 0.5)))
        self.env.worker().run(seconds=57)
        self.assertEqual(self.env.room()["state"], "open")
        self.assertLess(opened_after(self.env, 1), 15.0)


class RefusedNotifyIsSaid(RoomsCase):
    def test_sales_api_refusing_every_room_event_turns_the_status_row_red(self):
        self.env.api.script = [400] * 10       # e.g. room.event not deployed: "Unknown action."
        self.env.add_room()
        self.env.worker().run(seconds=0)
        row = self.env.pg.one("cockpit_sales_worker_status", job="rooms")
        self.assertIs(row["ok"], False, f"status stays green: {row['detail']}")


if __name__ == "__main__":
    unittest.main()


class TeamPageZoomUser(RoomsCase):
    """Glossary 1.1 and P2 (Team page, TeamSeat.tsx): the manager sets each
    seat's Zoom user and default room in cockpit_sales_room_hosts."""

    def setUp(self):
        super().setUp()
        # via_portal: a seat that can sign in (finding 18), so the check reaches it.
        self.env.pg.put("cockpit_sales_people", {"email": CLOSER, "name": "Invented", "role": "closer", "active": True,
                                                 "via_portal": True})
        # The closer's Zoom user is under another address; the manager linked it by id.
        self.env.zoom.users.pop(CLOSER)
        self.env.zoom.users["zu-closer-alt"] = {"id": "zu-closer-alt", "email": "closer.zoom@example.test",
                                                "type": 2, "status": "active"}
        self.env.pg.put(rooms.HOSTS, {"email": CLOSER, "zoom_user_id": "zu-closer-alt", "default_provider": "meet",
                                      "zoom_status": "licensed"})

    def test_the_host_check_keeps_the_manager_s_zoom_user_and_default_room(self):
        self.env.worker().check_hosts()
        row = self.env.pg.one(rooms.HOSTS, email=CLOSER)
        self.assertEqual(row["zoom_user_id"], "zu-closer-alt")
        self.assertEqual(row["default_provider"], "meet")
        self.assertEqual(row["zoom_status"], "licensed")   # checked, through the linked user
        self.assertIn(("GET", "/users/zu-closer-alt"), [c[:2] for c in self.env.zoom.calls])

    def test_a_room_uses_the_manager_s_zoom_user(self):
        self.env.add_room(host_email=CLOSER)
        self.env.worker().run(seconds=0)
        self.assertEqual(self.env.room()["state"], "open", self.env.room().get("error"))


class ExpiredRoomWithALostJoin(RoomsCase):
    """H7: the system never ends a room with a lead in it. A participant_joined
    event that was lost or arrived after lead_by leaves the room `expired`
    with the lead inside the started meeting."""

    def test_a_started_meeting_of_an_expired_room_is_not_ended_blindly(self):
        m = self.env.zoom._make("zu-setter", {"topic": "Mahara call LOST01"})
        self.env.zoom.meetings[str(m["id"])]["status"] = "started"
        self.env.add_room(1, code="LOST01", state="expired", provider_meeting_id=str(m["id"]),
                          host_in_at=rooms.iso(T0 - 700), ended_at=rooms.iso(T0 - 2))
        self.env.pg.put(rooms.SECRETS, {"room_id": rid(1), "start_url": m["start_url"], "expires_at": None})
        self.env.worker().run(seconds=0)
        ended = self.env.zoom.count("PUT", f"/meetings/{m['id']}/status")
        participant_reads = [c for c in self.env.zoom.calls if "participants" in c[1]]
        self.assertFalse(ended and not participant_reads,
                         "the live meeting was ended without looking at who is in it")
