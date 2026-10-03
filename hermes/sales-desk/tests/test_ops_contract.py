"""The room worker and the Slack poster against contract-v2 (the integration
lane, 3 October 2026): the `room.event` body and how each answer is read, the
order of the stored event and the room write, `text` on every stored event,
the lease (never stamping `handled_at` over a hold), claims only while
switched on, the sweep owning the timers, the meeting an overlapping run may
adopt (section 7, step 5), and the VPS Slack poster for `slack.reply`.

Same fakes as test_rooms.py: nothing reaches the network.

    python3 -m unittest tests.test_ops_contract -v
"""
from __future__ import annotations

import json
import os
import random
import re
import unittest
import urllib.parse
import uuid
from typing import Any, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http  # noqa: E402
from desk import rooms  # noqa: E402
from desk import slackpost  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests.test_rooms import SETTER, T0, Env, FakeApi, Net, _err, rid  # noqa: E402

TOKEN = "xoxb-1234567890-test-only-token"


# ---- fakes this file adds --------------------------------------------------------


class ShapedApi(FakeApi):
    """sales-api answering with contract-v2's shapes: a script entry is a
    status (an empty refusal body) or (status, body)."""

    def __init__(self):
        super().__init__()
        self.on_call: Any = None

    def __call__(self, method: str, url: str, headers: dict[str, str], data: Optional[bytes]):
        body = json.loads((data or b"{}").decode())
        if self.on_call:
            self.on_call(body)
        self.bodies.append(body)
        self.headers.append(dict(headers))
        step = self.script.pop(0) if self.script else (200, {"ok": True, "handled": True})
        status, answer = step if isinstance(step, tuple) else (step, {"ok": False, "error": "scripted"})
        if status >= 400:
            raise _err(status, answer, url)
        return status, {}, json.dumps(answer).encode()


class FakeSlack:
    """chat.postMessage. A script entry fails or shapes the next call:
    {"status": 503}, {"body": {"ok": False, "error": "..."}}, or
    {"timeout": True, "posted": bool} (Slack may have posted it)."""

    URL = "https://slack.com/api/chat.postMessage"

    def __init__(self, clock):
        self.clock = clock
        self.posts: list[tuple[str, str]] = []
        self.script: list[dict[str, Any]] = []
        self.calls: list[dict[str, Any]] = []
        self.latency = 0.0

    def __call__(self, method: str, url: str, headers: dict[str, str], data: Optional[bytes], timeout: float):
        assert method == "POST" and url == self.URL, url
        assert headers.get("Authorization") == f"Bearer {TOKEN}"
        body = json.loads((data or b"{}").decode())
        self.calls.append(body)
        self.clock.advance(self.latency)
        if self.script:
            s = self.script.pop(0)
            if s.get("timeout"):
                if s.get("posted"):
                    self.posts.append((body["channel"], body["text"]))
                self.clock.advance(timeout)
                raise HttpError(0, "TimeoutError: timed out", b"", url)
            if s.get("status", 200) != 200:
                raise _err(s["status"], s.get("body", {"ok": False, "error": "fatal_error"}), url)
            return 200, {}, json.dumps(s["body"]).encode()
        self.posts.append((body["channel"], body["text"]))
        return 200, {}, json.dumps({"ok": True, "channel": "D0TESTDM", "ts": f"{len(self.posts)}.000100"}).encode()


class SlackNet(Net):
    def __init__(self, env: Env, slack: FakeSlack):
        super().__init__(env.clock, env.pg, env.zoom, env.google, env.api)
        self.slack = slack

    def __call__(self, method: str, url: str, **kw: Any):
        if urllib.parse.urlsplit(url).netloc == "slack.com":
            self.log.append((self.clock(), method, url, kw.get("timeout", 60), kw.get("retries", 2)))
            return self.slack(method, url, kw.get("headers") or {}, kw.get("data"), kw.get("timeout", 60))
        return super().__call__(method, url, **kw)


def stand_up_lease(env: Env) -> list[str]:
    """cockpit_sales_room_event_lease as the migration writes it: the event,
    by id or dedupe key, is taken only when it is not handled and nobody holds
    it; the answer is its id, else null."""
    taken: list[str] = []

    def lease(body: dict[str, Any]) -> Optional[str]:
        key, eid = body.get("p_dedupe_key"), body.get("p_event_id")
        if not key and not eid:
            return None
        now = env.clock()
        for e in env.pg.rows(rooms.EVENTS):
            if (key and e.get("dedupe_key") != key) or (eid and str(e.get("id")) != str(eid)):
                continue
            held = rooms.parse_ts(e.get("lease_until"))
            if e.get("handled_at") or (held is not None and held > now):
                return None
            e["lease_until"] = rooms.iso(now + min(max(int(body.get("p_seconds") or 60), 1), 600))
            taken.append(e["dedupe_key"])
            return str(e.get("id") or uuid.uuid5(uuid.NAMESPACE_URL, e["dedupe_key"]))
        return None

    env.pg.rpcs[rooms.LEASE_FN] = lease
    env.pg.defaults[rooms.EVENTS] = {"at": lambda: rooms.iso(env.clock())}
    return taken


class OpsCase(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.env.api = ShapedApi()
        self.slack = FakeSlack(self.env.clock)
        self.env.net = SlackNet(self.env, self.slack)
        self.leases = stand_up_lease(self.env)
        p = mock.patch.object(http, "request", self.env.net)
        p.start()
        self.addCleanup(p.stop)

    def tick(self, w: rooms.Worker) -> None:
        w.run(seconds=0)

    def event(self, key: str) -> Optional[dict[str, Any]]:
        return self.env.pg.one(rooms.EVENTS, dedupe_key=key)


# ---- the room.event body and the answers -----------------------------------------


class RoomEventBody(OpsCase):
    def test_worker_ready_is_exactly_the_contract_s_body(self):
        self.env.add_room()
        self.tick(self.env.worker())
        body = self.env.api.bodies[0]
        self.assertEqual(set(body), {"action", "kind", "room_id", "request_id", "dedupe_key", "payload"})
        self.assertEqual((body["action"], body["kind"], body["room_id"]), ("room.event", "worker.ready", rid(1)))
        self.assertEqual(body["request_id"], str(uuid.uuid5(uuid.NAMESPACE_URL, f"mahara-room/worker.ready/{rid(1)}")))
        self.assertEqual(body["dedupe_key"], f"worker.ready:{rid(1)}")
        self.assertEqual(set(body["payload"]), {"provider", "provider_meeting_id", "worker_run", "seconds"})
        self.assertEqual(body["payload"]["provider_meeting_id"], self.env.room()["provider_meeting_id"])
        # The stored event carries the same detail and is what sales-api leases.
        stored = self.event(f"worker.ready:{rid(1)}")
        self.assertEqual(stored["detail"], body["payload"])
        self.assertIsNone(stored.get("handled_at"))
        self.assertIsNone(stored.get("lease_until"))  # the worker never leases its own event for sales-api

    def test_worker_failed_is_the_same_body_with_the_error(self):
        self.env.zoom.users[SETTER]["status"] = "pending"
        self.env.add_room()
        self.tick(self.env.worker())
        body = self.env.api.bodies[0]
        self.assertEqual((body["kind"], body["dedupe_key"]), ("worker.failed", f"worker.failed:{rid(1)}"))
        self.assertEqual(set(body["payload"]), {"error", "worker_run"})
        self.assertEqual(body["payload"]["error"], rooms.SAY["pending"])
        self.assertEqual(self.env.room()["state"], "failed")

    def test_the_event_is_stored_before_the_room_write_and_the_call_comes_after(self):
        env = self.env
        seq: list[tuple[str, str, str]] = []
        real_pg = env.pg.__call__

        def pg(method, url, **kw):
            u = urllib.parse.unquote(url)
            if method == "POST" and rooms.EVENTS in u:
                seq.extend(("stored", r["kind"], r["room_id"]) for r in json.loads(kw.get("data") or b"[]"))
            if method == "PATCH" and "cockpit_sales_rooms?" in u:
                body = json.loads(kw.get("data") or b"{}")
                if body.get("state") in ("open", "failed"):
                    seq.append(("written", body["state"], re.search(r"id=eq\.([^&]+)", u).group(1)))
            return real_pg(method, url, **kw)

        env.net.pg = pg
        env.api.on_call = lambda body: seq.append(("told", body["kind"], body["room_id"]))
        env.add_room(1)
        env.add_room(2, host_email="nobody@example.test", contact_id="contact-2")
        self.tick(env.worker())
        for n, kind, state in ((1, "worker.ready", "open"), (2, "worker.failed", "failed")):
            mine = [x for x in seq if x[2] == rid(n) and x[1] in (kind, state)]
            self.assertEqual(mine, [("stored", kind, rid(n)), ("written", state, rid(n)), ("told", kind, rid(n))],
                             kind)

    def test_handled_false_is_delivered_and_left_to_the_sweep(self):
        self.env.api.script = [(200, {"ok": True, "handled": False})]
        self.env.add_room()
        w = self.env.worker()
        self.tick(w)
        self.assertEqual((w.total["notify_refused"], w.total["notify_unclear"]), (0, 0))
        self.assertIn("left worker.ready", " ".join(m for _l, m in self.env.log.lines))

    def test_a_refusal_that_says_retry_waits_for_the_sweep_and_does_not_turn_the_row_red(self):
        self.env.api.script = [(503, {"ok": False, "error": "HighLevel could not be read.", "code": "contact_unread",
                                      "retry": True, "cleanup": False})]
        self.env.add_room()
        w = self.env.worker()
        self.tick(w)
        self.assertEqual((w.total["notify_refused"], w.total["notify_unclear"]), (0, 1))
        self.env.api.script = [(409, {"ok": False, "error": "Not yet.", "code": "too_early", "retry": True})]
        self.env.add_room(2, host_email="rep2@example.test")
        self.env.zoom.users["rep2@example.test"] = {"id": "zu-2", "type": 2, "status": "active"}
        w2 = self.env.worker("run-b")
        self.tick(w2)
        self.assertEqual((w2.total["notify_refused"], w2.total["notify_unclear"]), (0, 1))
        ok, _said = w2.sentence()
        self.assertTrue(ok)

    def test_a_final_refusal_is_said_on_the_status_row(self):
        self.env.api.script = [(400, {"ok": False, "error": "Unknown action room.event.", "code": "bad_input",
                                      "retry": False, "cleanup": False})]
        self.env.add_room()
        self.tick(self.env.worker())
        row = self.env.pg.one("cockpit_sales_worker_status", worker="sales-desk", job="rooms")
        self.assertFalse(row["ok"])
        self.assertIn("sales-api refused the room message for 1 room: Unknown action room.event", row["detail"])

    def test_ok_false_in_a_200_is_a_refusal_too(self):
        self.env.api.script = [(200, {"ok": False, "error": "This changed a moment ago.", "code": "stale"})]
        self.env.add_room()
        w = self.env.worker()
        self.tick(w)
        self.assertEqual(w.total["notify_refused"], 1)

    def test_cleanup_never_closes_the_room_s_own_meeting(self):
        self.env.api.script = [(409, {"ok": False, "error": "A different link.", "code": "final", "cleanup": True})]
        self.env.add_room()
        self.tick(self.env.worker())
        row = self.env.room()
        self.assertEqual(row["state"], "open")
        self.assertIn(row["provider_meeting_id"], self.env.zoom.meetings)
        self.assertIn("it is the room's own meeting, so it was kept", " ".join(m for _l, m in self.env.log.lines))

    def test_cleanup_closes_a_meeting_that_is_not_the_room_s(self):
        self.env.add_room()
        w = self.env.worker()
        self.tick(w)
        other = self.env.zoom._make("zu-setter", {"topic": "Mahara call OTHER1"})
        w._cleanup_asked(rid(1), {"provider": "zoom", "provider_meeting_id": str(other["id"])})
        self.env.clock.advance(rooms.STRAY_EVERY)
        self.tick(w)
        self.assertNotIn(str(other["id"]), self.env.zoom.meetings)
        self.assertIn(self.env.room()["provider_meeting_id"], self.env.zoom.meetings)


# ---- text on every stored event (contract-v2 section 2, item 8) ------------------------


class EventText(OpsCase):
    URLISH = re.compile(r"https?://|www\.|zak=|pwd=|@")

    def test_every_event_the_worker_stores_says_what_happened_plainly(self):
        env = self.env
        env.zoom.users["rep2@example.test"] = {"id": "zu-2", "type": 2, "status": "active"}
        env.add_room(1)                                                     # made on Zoom
        env.add_room(2, provider="meet", host_email="rep2@example.test")    # made on Meet
        env.add_room(3, host_email="missing@example.test")                  # refused: no Zoom user
        env.zoom.script.append({"method": "POST", "path": "/meetings", "status": 400, "exact": False,
                                "body": {"code": 300, "message": "User missing@example.test is not allowed "
                                                                 "https://zoom.example.test/x?zak=abc"}})
        env.add_room(4, host_email="rep2@example.test", contact_id="contact-4")
        w = env.worker()
        w.run(seconds=6)
        # A finished room's meeting closed, then a participant report.
        row = next(r for r in env.pg.rows(rooms.ROOMS) if r["state"] == "open" and r["provider"] == "zoom")
        row.update({"state": "expired", "ended_at": rooms.iso(env.clock())})
        env.clock.advance(rooms.CLOSE_SCAN_EVERY)
        w.run(seconds=3)
        env.pg.put(rooms.PEOPLE, {"email": SETTER, "role": "setter", "active": True, "via_portal": True})
        env.zoom.past[str(row["provider_meeting_id"])] = []
        env.zoom.past[f"uuid{row['provider_meeting_id']}=="] = []   # the uuid noted before the delete
        env.clock.advance(5)
        w.check_hosts()
        stored = [e for e in env.pg.rows(rooms.EVENTS) if e.get("source") == "worker"]
        kinds = {e["kind"] for e in stored}
        self.assertTrue({"worker.ready", "worker.failed", "worker.create_sent", "worker.closing",
                         "report.checked"} <= kinds, kinds)
        for e in stored:
            self.assertTrue(e.get("text"), e["kind"])
            self.assertLessEqual(len(e["text"]), 500)
            self.assertIsNone(self.URLISH.search(e["text"]), (e["kind"], e["text"]))
        self.assertRegex(self.event(f"worker.ready:{row['id']}")["text"], r"^Room made on Zoom in \d+(\.\d)? s\.$")
        self.assertRegex(self.event(f"worker.ready:{rid(2)}")["text"], r"^Room made on Meet in ")
        refused = next(e for e in stored if e["kind"] == "worker.failed" and "Zoom refused" in e["text"])
        self.assertIn("an address", refused["text"])
        self.assertIn("a link", refused["text"])
        self.assertEqual(self.event(f"worker.closing:{row['id']}")["text"],
                         rooms.TEXT["worker.closing"].format(provider="Zoom"))
        self.assertEqual(self.event(f"report.checked:{row['id']}")["text"], rooms.TEXT["report.matches"])
        self.assertEqual(self.event(f"worker.failed:{rid(3)}")["text"], "The room was not made. " + rooms.SAY["no_user"])

    def test_plain_cuts_at_a_whole_sentence_and_hides_links_addresses_and_keys(self):
        long = "First sentence here. " * 40
        out = rooms.plain(long)
        self.assertLessEqual(len(out), 500)
        self.assertTrue(out.endswith("."))
        self.assertEqual(rooms.plain("Ask rep@example.test at https://x.test/s/1?zak=a, key=sk-abcdefgh1234"),
                         "Ask an address at a link key=<hidden>")


# ---- the lease: the worker closes its own events, never over a hold ----------------------


class Lease(OpsCase):
    def test_a_room_cancelled_while_it_is_made_has_its_ready_event_closed_with_the_lease(self):
        env = self.env
        env.zoom.after_create = lambda m: env.room().update({"state": "cancelled", "ended_at": rooms.iso(env.clock())})
        env.add_room()
        self.tick(env.worker())
        e = self.event(f"worker.ready:{rid(1)}")
        self.assertIsNotNone(e["handled_at"])
        self.assertIsNone(e["lease_until"])
        self.assertEqual(e["detail"]["closed_by"], "worker")
        self.assertIn("cancelled", e["detail"]["closed_why"])
        self.assertIn(f"worker.ready:{rid(1)}", self.leases)            # taken with the lease, not stamped
        self.assertEqual(env.api.kinds(rid(1)), [])                       # nothing to tell sales-api
        self.assertNotIn("gave_up", e["detail"])

    def test_an_event_sales_api_holds_is_never_closed_over_its_lease(self):
        env = self.env
        held_until = rooms.iso(T0 + 25)

        def cancel_and_hold(m):
            env.room().update({"state": "cancelled", "ended_at": rooms.iso(env.clock())})

        env.zoom.after_create = cancel_and_hold
        real_post = env.pg.__call__

        def pg(method, url, **kw):
            out = real_post(method, url, **kw)
            # sales-api leased the ready event the moment it was stored.
            e = env.pg.one(rooms.EVENTS, dedupe_key=f"worker.ready:{rid(1)}")
            if e and not e.get("lease_until"):
                e["lease_until"] = held_until
            return out

        env.net.pg = pg
        env.add_room()
        self.tick(env.worker())
        e = self.event(f"worker.ready:{rid(1)}")
        self.assertIsNone(e.get("handled_at"))
        self.assertEqual(e["lease_until"], held_until)

    def test_without_the_lease_function_the_event_is_left_for_the_sweep_and_said_once(self):
        env = self.env
        del env.pg.rpcs[rooms.LEASE_FN]
        env.zoom.after_create = lambda m: env.room().update({"state": "cancelled", "ended_at": rooms.iso(env.clock())})
        env.add_room()
        self.tick(env.worker())
        self.assertIsNone(self.event(f"worker.ready:{rid(1)}").get("handled_at"))
        self.assertIn("could not be taken with the lease", " ".join(m for _l, m in env.log.lines))

    def test_a_fail_that_missed_a_cancelled_room_closes_its_failed_event(self):
        env = self.env
        env.zoom.users[SETTER]["status"] = "pending"
        real = env.pg.__call__

        def pg(method, url, **kw):
            if method == "PATCH" and "state=in.%28requested%2Ccreating%29" in url.replace("(", "%28").replace(
                    ")", "%29").replace(",", "%2C"):
                env.room().update({"state": "cancelled", "ended_at": rooms.iso(env.clock())})
            return real(method, url, **kw)

        env.net.pg = pg
        env.add_room()
        self.tick(env.worker())
        self.assertEqual(env.room()["state"], "cancelled")
        e = self.event(f"worker.failed:{rid(1)}")
        self.assertIsNotNone(e["handled_at"])
        self.assertEqual(env.api.kinds(rid(1)), [])

    def test_a_fail_that_missed_a_room_the_sweep_failed_leaves_the_event_for_sales_api(self):
        env = self.env
        env.zoom.users[SETTER]["status"] = "pending"
        real = env.pg.__call__

        def pg(method, url, **kw):
            if method == "PATCH" and "requested" in urllib.parse.unquote(url) and "creating)" in urllib.parse.unquote(url):
                env.room().update({"state": "failed", "error": "The room was not made in time. Make a new one.",
                                   "ended_at": rooms.iso(env.clock())})
            return real(method, url, **kw)

        env.net.pg = pg
        env.add_room()
        self.tick(env.worker())
        e = self.event(f"worker.failed:{rid(1)}")
        self.assertIsNone(e.get("handled_at"))   # sales-api acts on a failed room's event


# ---- claims only while switched on (contract-v2 section 7, step 2) ---------------------


class Switches(OpsCase):
    def test_a_room_asked_for_while_rooms_are_off_fails_unclaimed(self):
        self.env.pg.one("cockpit_sales_settings", key="rooms")["value"]["enabled"] = False
        self.env.add_room()
        self.tick(self.env.worker())
        row = self.env.room()
        self.assertEqual((row["state"], row["error"]), ("failed", rooms.SAY["switched_off"]))
        self.assertIsNone(row.get("worker_run"))
        claims = [u for m, u in self.env.pg.calls if m == "PATCH" and "creating" in json.dumps(u)
                  and "state=eq.requested" in u]
        self.assertEqual([c for c in claims if "worker_run" in c], [])
        self.assertEqual(self.env.zoom.calls, [])

    def test_a_provider_off_fails_its_rooms_unclaimed_and_the_other_is_made(self):
        self.env.pg.one("cockpit_sales_settings", key="rooms")["value"]["providers"]["zoom"] = False
        self.env.zoom.users["rep2@example.test"] = {"id": "zu-2", "type": 2, "status": "active"}
        self.env.add_room(1)
        self.env.add_room(2, provider="meet", host_email="rep2@example.test")
        self.env.worker().run(seconds=5)
        self.assertEqual((self.env.room(1)["state"], self.env.room(1)["error"]), ("failed", rooms.SAY["zoom_off"]))
        self.assertIsNone(self.env.room(1).get("claimed_at"))
        self.assertEqual(self.env.room(2)["state"], "open")
        self.assertEqual(self.env.api.kinds(rid(1)), ["worker.failed"])

    def test_the_switch_off_is_a_refusal_not_a_fault(self):
        self.env.pg.one("cockpit_sales_settings", key="rooms")["value"]["enabled"] = False
        self.env.add_room()
        w = self.env.worker()
        self.tick(w)
        self.assertEqual((w.total["refused"], w.total["faults"]), (1, []))


# ---- the meeting an overlapping run may adopt (contract-v2 section 7, step 5) ----------


class Strays(OpsCase):
    def slow_run_loses_the_room(self) -> tuple[rooms.Worker, str]:
        """Run A makes the meeting; meanwhile run B adopts the room (A was too
        slow), so A's open write misses."""
        env = self.env
        env.zoom.after_create = lambda m: env.room().update({"worker_run": "run-b"})
        env.add_room()
        a = env.worker("run-a")
        self.tick(a)
        env.zoom.after_create = None
        made = [m for m in env.zoom.meetings.values() if m["topic"] == f"Mahara call {env.room()['code']}"]
        self.assertEqual(len(made), 1)
        self.assertEqual((env.room()["state"], env.room()["worker_run"]), ("creating", "run-b"))
        stray = self.event(f"worker.stray:{rid(1)}:{made[0]['id']}")
        self.assertIsNotNone(stray)
        self.assertTrue(stray["text"])
        return a, str(made[0]["id"])

    def test_kept_when_the_other_run_opens_the_room_with_it(self):
        env = self.env
        a, m1 = self.slow_run_loses_the_room()
        self.assertEqual(env.api.kinds(rid(1)), [])            # A tells sales-api nothing
        self.tick(env.worker("run-b"))                          # B finds A's meeting by its code
        self.assertEqual((env.room()["state"], env.room()["provider_meeting_id"]), ("open", m1))
        env.clock.advance(rooms.STRAY_EVERY)
        self.tick(a)
        self.assertIn(m1, env.zoom.meetings)                     # never closed: it is the room's
        self.assertEqual(self.event(f"worker.stray:{rid(1)}:{m1}")["detail"]["done"], "adopted")
        self.assertEqual(env.api.kinds(rid(1)), ["worker.ready"])
        self.assertEqual(env.zoom.count("POST", "/meetings"), 1)

    def test_closed_when_the_room_opens_with_another_meeting_and_the_host_link_is_put_back(self):
        env = self.env
        a, m1 = self.slow_run_loses_the_room()
        m2 = env.zoom._make("zu-setter", {"topic": f"Mahara call {env.room()['code']}"})
        env.room().update({"state": "open", "provider_meeting_id": str(m2["id"]), "join_url": m2["join_url"],
                           "opened_at": rooms.iso(env.clock())})
        # A's host link landed after B's: it points at A's meeting.
        self.assertIn(f"/s/{m1}", env.pg.one(rooms.SECRETS, room_id=rid(1))["start_url"])
        env.clock.advance(rooms.STRAY_EVERY)
        self.tick(a)
        self.assertNotIn(m1, env.zoom.meetings)
        self.assertIn(str(m2["id"]), env.zoom.meetings)
        self.assertEqual(env.pg.one(rooms.SECRETS, room_id=rid(1))["start_url"], m2["start_url"])
        self.assertEqual(self.event(f"worker.stray:{rid(1)}:{m1}")["detail"]["done"], "closed")
        self.assertEqual(a.total["strays"], 1)
        self.assertIn("1 extra Zoom meeting from overlapping runs closed",
                      env.pg.one("cockpit_sales_worker_status", worker="sales-desk", job="rooms")["detail"])

    def test_a_later_run_finishes_the_job_when_the_first_ended(self):
        env = self.env
        _a, m1 = self.slow_run_loses_the_room()
        # B never opened it; the sweep failed it with no meeting on it.
        env.room().update({"state": "failed", "error": "The room was not made in time. Make a new one.",
                           "ended_at": rooms.iso(env.clock())})
        env.clock.advance(rooms.STRAY_EVERY)
        c = env.worker("run-c")
        c.run(seconds=12)
        self.assertNotIn(m1, env.zoom.meetings)
        self.assertIn(self.event(f"worker.stray:{rid(1)}:{m1}")["detail"]["done"], ("closed", "adopted"))
        self.assertIsNone(env.pg.one(rooms.SECRETS, room_id=rid(1)))

    def test_a_running_extra_meeting_with_someone_in_it_is_left_open_and_alerted(self):
        env = self.env
        a, m1 = self.slow_run_loses_the_room()
        m2 = env.zoom._make("zu-setter", {"topic": f"Mahara call {env.room()['code']}"})
        env.room().update({"state": "open", "provider_meeting_id": str(m2["id"]), "join_url": m2["join_url"]})
        env.zoom.meetings[m1]["status"] = "started"
        env.zoom.participants[m1] = [{"id": "", "email": "", "user_name": "Someone"}]
        env.clock.advance(rooms.STRAY_EVERY)
        self.tick(a)
        self.assertEqual(env.zoom.meetings[m1]["status"], "started")
        self.assertIsNotNone(env.pg.one(rooms.ALERTS, dedupe_key=f"room_stray_held:{m1}"))
        self.assertIsNone(self.event(f"worker.stray:{rid(1)}:{m1}")["detail"].get("done"))


# ---- the Slack poster -------------------------------------------------------------------


def reply(env: Env, n: int, *, user: str = "U0TESTREP", text: str = "Someone else took this lead.",
          age: float = 1.0, **over: Any) -> dict[str, Any]:
    row = {"id": str(uuid.UUID(int=0xD00 + n)), "room_id": None, "kind": "slack.reply", "source": "door",
           "dedupe_key": f"slack.reply:{uuid.UUID(int=0xE00 + n)}", "at": rooms.iso(env.clock() - age),
           "handled_at": None, "tries": 0, "last_try_at": None, "lease_until": None, "text": text,
           "detail": {"slack_user_id": user, "slack_team_id": "T0TEST", "view_id": "V0TEST", "container_type": "view"}}
    row.update(over)
    return env.pg.put(rooms.EVENTS, row)


class Poster(OpsCase):
    def setUp(self):
        super().setUp()
        self.env.pg.put("cockpit_sales_settings", {"key": "live", "value": {"enabled": True, "slack": True}})

    def worker(self, run: str = "run-a", token: str = TOKEN) -> rooms.Worker:
        w = self.env.worker(run)
        w.slack = slackpost.SlackPoster(w.sb, token, rooms.Sender(self.env.clock, self.env.clock.sleep, left=w.left),
                                        self.env.clock, self.env.log,
                                        lambda ok, detail: w._write_status(ok, detail, job=slackpost.JOB))
        return w

    def row(self) -> dict[str, Any]:
        return self.env.pg.one("cockpit_sales_worker_status", worker="sales-desk", job="slack")

    def test_a_reply_goes_once_as_a_dm_and_is_marked_handled_with_slack_s_ts(self):
        e = reply(self.env, 1)
        self.worker().run(seconds=5)
        self.assertEqual(self.slack.posts, [("U0TESTREP", "Someone else took this lead.")])
        self.assertIsNotNone(e["handled_at"])
        self.assertIsNone(e["lease_until"])
        self.assertEqual(e["detail"]["posted_ts"], "1.000100")
        self.assertIn(e["dedupe_key"], self.leases)
        self.assertEqual(self.slack.calls[0]["unfurl_links"], False)
        self.assertTrue(self.row()["ok"])
        self.assertIn("1 Slack reply sent", self.row()["detail"])

    def test_two_runs_at_once_send_it_once(self):
        reply(self.env, 1)
        a, b = self.worker("run-a"), self.worker("run-b")
        rows_a = a.slack._waiting()
        rows_b = b.slack._waiting()
        a.slack._read_live(self.env.clock())
        b.slack._read_live(self.env.clock())
        a.slack._one(rows_a[0])
        b.slack._one(rows_b[0])
        self.assertEqual(len(self.slack.posts), 1)

    def test_switched_off_nothing_is_sent_or_leased_and_the_row_says_so(self):
        self.env.pg.one("cockpit_sales_settings", key="live")["value"]["slack"] = False
        reply(self.env, 1)
        reply(self.env, 2)
        self.worker().run(seconds=5)
        self.assertEqual(self.slack.calls, [])
        self.assertEqual(self.leases, [])
        self.assertTrue(self.row()["ok"])
        self.assertIn(slackpost.SAY["off"], self.row()["detail"])
        self.assertIn("2 Slack replies wait", self.row()["detail"])

    def test_without_the_token_nothing_is_sent_and_the_row_is_red_with_what_to_do(self):
        reply(self.env, 1)
        self.worker(token="").run(seconds=5)
        self.assertEqual(self.slack.calls, [])
        self.assertFalse(self.row()["ok"])
        self.assertIn("SLACK_SALES_BOT_TOKEN is not set on the VPS", self.row()["detail"])
        self.assertIn("1 Slack reply wait", self.row()["detail"])
        # Off, the same box says only a note.
        self.env.pg.one("cockpit_sales_settings", key="live")["value"]["enabled"] = False
        self.worker(token="").run(seconds=0)
        self.assertTrue(self.row()["ok"])
        self.assertIn("set it before Slack is switched on", self.row()["detail"])

    def test_a_refused_token_stops_the_sends_says_so_and_releases_the_reply(self):
        e = reply(self.env, 1)
        reply(self.env, 2)
        self.slack.script = [{"body": {"ok": False, "error": "invalid_auth"}}]
        self.worker().run(seconds=5)
        self.assertEqual(len(self.slack.calls), 1)
        self.assertIsNone(e["handled_at"])
        self.assertIsNone(e["lease_until"])
        self.assertFalse(self.row()["ok"])
        self.assertIn("Slack refused the Mahara Sales bot token (invalid_auth)", self.row()["detail"])

    def test_slack_s_own_refusal_is_final_and_kept(self):
        e = reply(self.env, 1)
        self.slack.script = [{"body": {"ok": False, "error": "channel_not_found"}}]
        self.worker().run(seconds=5)
        self.assertIsNotNone(e["handled_at"])
        self.assertEqual(e["detail"]["refused"], "channel_not_found")
        self.assertIn("1 refused by Slack (channel_not_found)", self.row()["detail"])

    def test_a_slack_outage_is_tried_three_times_ten_seconds_apart_then_dropped(self):
        e = reply(self.env, 1)
        self.slack.script = [{"status": 503}] * 3
        self.worker().run(seconds=40)
        self.assertEqual(len(self.slack.calls), 3)
        self.assertEqual(e["tries"], 3)
        self.assertEqual(self.slack.posts, [])
        self.worker("run-b").run(seconds=0)
        self.assertIsNotNone(e["handled_at"])
        self.assertEqual(e["detail"]["dropped"], "slack_failed")
        self.assertNotIn("gave_up", e["detail"])  # the watchdog counts that key as a lost room signal

    def test_a_post_that_timed_out_is_never_sent_twice(self):
        e = reply(self.env, 1)
        self.slack.script = [{"timeout": True, "posted": True}]
        self.worker().run(seconds=30)
        self.assertEqual(len(self.slack.posts), 1)
        self.assertEqual(len(self.slack.calls), 1)
        self.assertEqual(e["detail"]["unclear"], "Slack did not answer in time")
        self.assertIn("did not confirm in time, so not sent again", self.row()["detail"])

    def test_slow_down_pauses_without_spending_a_try(self):
        e = reply(self.env, 1)
        self.slack.script = [{"status": 429, "body": {"ok": False, "error": "ratelimited"}}]
        self.worker().run(seconds=10)
        self.assertEqual(e["tries"], 0)
        self.assertIsNone(e["handled_at"])
        self.env.clock.advance(slackpost.PAUSE_S)
        self.worker("run-b").run(seconds=3)
        self.assertEqual(self.slack.posts, [("U0TESTREP", "Someone else took this lead.")])

    def test_a_reply_over_ten_minutes_old_is_closed_unsent(self):
        e = reply(self.env, 1, age=slackpost.MAX_AGE_S + 5)
        self.worker().run(seconds=3)
        self.assertEqual(self.slack.calls, [])
        self.assertEqual(e["detail"]["dropped"], "too_old")
        self.assertIsNotNone(e["handled_at"])

    def test_a_reply_with_no_slack_user_or_no_words_is_closed_unsent(self):
        a = reply(self.env, 1, user="not-a-user")
        b = reply(self.env, 2, text="   ")
        self.worker().run(seconds=3)
        self.assertEqual(self.slack.calls, [])
        self.assertEqual((a["detail"]["refused"], b["detail"]["refused"]), ("no_slack_user", "no_text"))

    def test_a_reply_someone_else_holds_is_left_alone(self):
        e = reply(self.env, 1, lease_until=rooms.iso(T0 + 20))
        self.worker().run(seconds=3)
        self.assertEqual(self.slack.calls, [])
        self.assertIsNone(e["handled_at"])

    def test_the_live_setting_unread_is_off(self):
        del self.env.pg.tables["cockpit_sales_settings"][("live",)]
        reply(self.env, 1)
        self.worker().run(seconds=3)
        self.assertEqual(self.slack.calls, [])

    def test_the_token_never_reaches_a_row_a_log_or_a_status(self):
        reply(self.env, 1)
        reply(self.env, 2)
        self.slack.script = [{"status": 500, "body": {"ok": False, "error": f"bad token {TOKEN}"}},
                             {"body": {"ok": False, "error": "invalid_auth"}}]
        self.worker().run(seconds=30)
        everything = (json.dumps(self.env.pg.rows(rooms.EVENTS)) + json.dumps(self.env.pg.rows("cockpit_sales_worker_status"))
                      + json.dumps(self.env.log.lines))
        self.assertNotIn(TOKEN, everything)
        self.assertNotIn("xoxb-", http.scrub(f"Bearer {TOKEN} and {TOKEN}"))


# ---- a stress run of the integration: overlapping runs, the sweep, Slack ---------------


class IntegrationStress(OpsCase):
    def test_overlapping_runs_the_sweep_and_slack_leave_nothing_doubled_stuck_or_leaked(self):
        rng = random.Random(3102026)
        env = self.env
        env.pg.put("cockpit_sales_settings", {"key": "live", "value": {"enabled": True, "slack": True}})
        for i in range(6):
            env.zoom.users[f"rep{i}@example.test"] = {"id": f"zu-{i}", "type": 2, "status": "active"}
        codes: set[str] = set()
        for n in range(1, 41):
            code = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            while code in codes:
                code = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            codes.add(code)
            at = T0 + rng.uniform(0, 150)
            env.clock.at(at, lambda n=n, at=at, code=code: env.add_room(
                n, code=code, provider="zoom" if n % 3 else "meet", requested_at=rooms.iso(at),
                host_email=f"rep{n % 6}@example.test"))
        for n in range(1, 16):
            env.clock.at(T0 + rng.uniform(0, 200), lambda n=n: reply(env, n, user=f"U0REP{n:03d}", age=0))

        # The SQL sweep, every minute on the database's clock: R1 and R2.
        def sweep():
            now = env.clock()
            for r in env.pg.rows(rooms.ROOMS):
                asked, claimed = rooms.parse_ts(r.get("requested_at")), rooms.parse_ts(r.get("claimed_at"))
                if r["state"] == "requested" and asked and now - asked > 60:
                    r.update({"state": "failed", "error": "The room worker did not start this room within a minute. "
                                                          "Make a new room.", "ended_at": rooms.iso(now)})
                elif r["state"] == "creating" and claimed and now - claimed > 120:
                    r.update({"state": "failed", "error": "The room was not made in time. Make a new one.",
                              "ended_at": rooms.iso(now)})

        for k in range(1, 9):
            env.clock.at(T0 + 60 * k, sweep)
        # Overlap: while a slow run makes a meeting, another run adopts the
        # room (and finds that meeting by its code later), or opens it with a
        # meeting of its own; reps cancel others mid-make.
        state = {"n": 0}

        def overlap(m):
            state["n"] += 1
            row = next((r for r in env.pg.rows(rooms.ROOMS) if f"Mahara call {r['code']}" == m["topic"]), None)
            if not row or row["state"] != "creating" or row.get("worker_run") == "run-overlap":
                return
            if state["n"] % 6 == 2:
                row["worker_run"] = "run-overlap"
            elif state["n"] % 6 == 4:
                theirs = env.zoom._make(m["host"], {"topic": m["topic"]})
                env.pg.put(rooms.SECRETS, {"room_id": row["id"], "start_url": theirs["start_url"], "expires_at": None})
                row.update({"state": "open", "worker_run": "run-overlap", "provider_meeting_id": str(theirs["id"]),
                            "join_url": theirs["join_url"], "opened_at": rooms.iso(env.clock())})
            elif state["n"] % 6 == 5:
                row.update({"state": "cancelled", "ended_at": rooms.iso(env.clock())})

        env.zoom.after_create = overlap
        # Zoom hangs for a while: its rooms fail at once or are handed over,
        # and the sweep fails what nobody finishes.
        env.clock.at(T0 + 95, lambda: setattr(env.zoom, "latency", 30.0))
        env.clock.at(T0 + 125, lambda: setattr(env.zoom, "latency", 0.0))
        env.zoom.script += [{"method": "POST", "path": "/meetings", "status": rng.choice((500, 503, 0)),
                             "make": rng.random() < 0.5} for _ in range(5)]
        env.api.script = [rng.choice(((200, {"ok": True, "handled": True}), (200, {"ok": True, "handled": False}),
                                      (503, {"ok": False, "error": "Try again.", "retry": True}),
                                      (409, {"ok": False, "error": "This changed a moment ago.", "code": "stale"}),
                                      500)) for _ in range(60)]
        self.slack.script = [rng.choice(({"status": 503}, {"body": {"ok": False, "error": "ratelimited"}},
                                         {"timeout": True, "posted": True}, {"timeout": True, "posted": False}))
                             for _ in range(5)]

        def flaky(method, url, **kw):
            if rng.random() < 0.03:
                raise HttpError(503, "busy", b"", url)
            return env.pg(method, url, **kw)

        env.net.pg = flaky
        with mock.patch.object(http.time, "sleep", side_effect=AssertionError("a real sleep")):
            for run in ("run-a", "run-b", "run-c", "run-d"):
                w = env.worker(run)
                w.slack = slackpost.SlackPoster(w.sb, TOKEN, rooms.Sender(env.clock, env.clock.sleep, left=w.left),
                                                env.clock, env.log,
                                                lambda ok, d, w=w: w._write_status(ok, d, job=slackpost.JOB))
                w.run(seconds=57)
                env.clock.advance(3)
            env.net.pg = env.pg
            env.zoom.script, env.api.script, self.slack.script = [], [], []
            env.zoom.after_create = None
            env.zoom.latency = 0.0
            for run in ("run-e", "run-f", "run-g"):
                env.clock.advance(60)
                sweep()
                w = env.worker(run)
                w.slack = slackpost.SlackPoster(w.sb, TOKEN, rooms.Sender(env.clock, env.clock.sleep, left=w.left),
                                                env.clock, env.log,
                                                lambda ok, d, w=w: w._write_status(ok, d, job=slackpost.JOB))
                w.run(seconds=57)
        rows = env.pg.rows(rooms.ROOMS)
        self.assertEqual(len(rows), 40)
        self.assertEqual({r["state"] for r in rows} - {"open", "failed", "cancelled"}, set())
        self.assertTrue({"open", "failed", "cancelled"} <= {r["state"] for r in rows}, {r["state"] for r in rows})
        for r in rows:
            mine = [str(m["id"]) for m in env.zoom.meetings.values() if m["topic"] == f"Mahara call {r['code']}"]
            if r["state"] == "open" and r["provider"] == "zoom":
                self.assertEqual(mine, [r["provider_meeting_id"]], r["code"])
                self.assertIn(f"/s/{r['provider_meeting_id']}", env.pg.one(rooms.SECRETS, room_id=r["id"])["start_url"])
            elif r["state"] in ("failed", "cancelled"):
                self.assertEqual(mine, [], f"{r['state']} room {r['code']} left a meeting behind")
                self.assertIsNone(env.pg.one(rooms.SECRETS, room_id=r["id"]), r["code"])
        # Every extra meeting an overlapping run made was settled, both ways.
        strays = [e for e in env.pg.rows(rooms.EVENTS) if e["kind"] == "worker.stray"]
        self.assertTrue(strays)
        self.assertEqual({e["detail"].get("done") for e in strays} - {"adopted", "closed"}, set())
        # Every worker event says something; none is replayed forever.
        for e in env.pg.rows(rooms.EVENTS):
            if e.get("source") == "worker":
                self.assertTrue(e.get("text"), e["kind"])
        # Every Slack reply went at most once, and none waits once Slack is calm.
        sent = [u for u, _t in self.slack.posts]
        self.assertEqual(len(sent), len(set(sent)))
        replies = [e for e in env.pg.rows(rooms.EVENTS) if e["kind"] == "slack.reply"]
        self.assertEqual(len(replies), 15)
        self.assertEqual([e["dedupe_key"] for e in replies if not e.get("handled_at")], [])
        self.assertNotIn("zak=host", json.dumps(env.pg.rows(rooms.EVENTS)) + json.dumps(env.log.lines))


if __name__ == "__main__":
    unittest.main()
