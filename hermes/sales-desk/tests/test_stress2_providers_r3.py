"""Stress series 2, round 3, provider quirks on the desk side (2026-10-04).

Each test drives the real code through the fakes the lane's own tests use,
with the providers' real answer shapes, and asserts what must hold; a
failing test names a defect for the fix lane. Every lead, name and line is
invented; nothing reaches the network.

    python3 -m unittest tests.test_stress2_providers_r3
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import ago, members, sb  # noqa: E402
from tests.test_waves_breakit import enrolled_wave  # noqa: E402

MEMBERS = waves.MEMBERS
FOLLOWUPS = waves.FOLLOWUPS
MESSAGES = waves.MESSAGES


# ---------------------------------------------------------------------------
# 1. HighLevel's own rate limit (HTTP 429, "Too Many Requests") on an
#    approved opener's template.
#
# sales-api's sendTemplate writes the contact fields (PUT /contacts/{id}) and
# enrols the contact in the template's workflow (POST
# /contacts/{id}/workflow/{wf}). HighLevel's burst limit (100 calls in ten
# seconds for the location, shared with the dialer, the pipeline board and
# the mirror) answers either with 429. unclearError reads a 429 as certain
# (correct: nothing went), so the message row is failed with
# "HighLevel said 429: Too Many Requests" and the refusal is
# "HighLevel did not send it: HighLevel said 429: ..." (502, certain).
# sendFollowup then closes the draft as failed (its request id is the
# follow-up id, so it can never be sent again), and waves.sync reads that as
# the lead's own failure: _no_send_for_certain is true (HIGHLEVEL_REFUSED),
# ACCOUNT_FAILED does not match a rate limit, so the member goes back to
# waiting with fail_count 1 and next_try_at 20 hours on. The manager's
# approval is spent, and the next failure of any kind (a second 429 on
# another day, or Meta's 131049 per-person limit) takes the lead out of the
# wave for good as "The opener failed twice". A 429 says nothing about the
# lead: it is HighLevel's state for every send, like the wallet (ACCOUNT_FAILED)
# that is never counted against the lead.
# ---------------------------------------------------------------------------

RATE_LIMITED = "HighLevel said 429: Too Many Requests"


def _failed_opener(pg: FakePostgrest, c: str, fid: str, err_followup: str, err_message: str) -> None:
    """The rows index.ts sendTemplate + sendFollowup leave after a certain refusal."""
    pg.put(FOLLOWUPS, {"id": fid, "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                       "status": "failed", "touch": 1, "created_at": ago(hours=2), "decided_at": ago(minutes=10),
                       "context": {"wave_id": "w1", "language": "ar"}, "error": err_followup})
    pg.put(MESSAGES, {"id": f"m-{fid}", "followup_id": fid, "contact_id": c, "sent_by": "sales-desk", "via": "workflow",
                      "state": "failed", "error": err_message, "channel": "whatsapp", "created_at": ago(minutes=10)})


class HighLevelRateLimitIsNotTheLeads(unittest.TestCase):
    def test_a_429_on_the_opener_is_not_counted_against_the_lead(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        m = members(pg, "w1")[0]
        c = m["contact_id"]
        _failed_opener(pg, c, "f429", f"HighLevel did not send it: {RATE_LIMITED}", RATE_LIMITED)
        m.update({"state": "drafted", "followup_id": "f429", "drafted_at": ago(hours=2), "due_at": ago(hours=2)})
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], waves_now())
        after = pg.one(MEMBERS, wave_id="w1", contact_id=c)
        self.assertEqual(int(after.get("fail_count") or 0), 0,
                         "HighLevel's rate limit (429) on the opener's template was counted as the lead's own failure "
                         f"(fail_count {after.get('fail_count')}, next try {after.get('next_try_at')}): one more failure "
                         "of any kind and the lead leaves the wave as 'failed twice'")

    def test_two_rate_limits_on_two_days_take_the_lead_out_of_the_wave(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        m = members(pg, "w1")[0]
        c = m["contact_id"]
        # Day one: the approved opener meets HighLevel's 429.
        _failed_opener(pg, c, "fA", f"HighLevel did not send it: {RATE_LIMITED}", RATE_LIMITED)
        m.update({"state": "drafted", "followup_id": "fA", "drafted_at": ago(hours=2), "due_at": ago(hours=2)})
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], waves_now())
        # Day two: the opener is written and approved again, and meets a 429 again.
        _failed_opener(pg, c, "fB", f"HighLevel did not send it: {RATE_LIMITED}", RATE_LIMITED)
        pg.one(MEMBERS, wave_id="w1", contact_id=c).update({"state": "drafted", "followup_id": "fB",
                                                              "drafted_at": ago(hours=1), "due_at": ago(hours=1)})
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], waves_now() + timedelta(days=1))
        after = pg.one(MEMBERS, wave_id="w1", contact_id=c)
        self.assertNotEqual(after["state"], "excluded",
                            "two HighLevel rate limits on two days took the lead out of the wave for good: "
                            f"{after.get('excluded_reason')!r}")

    def test_held_control_meta_failing_the_lead_still_counts(self):
        # Meta's per-person failure (not on WhatsApp) is the lead's: counted.
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        m = members(pg, "w1")[0]
        c = m["contact_id"]
        err = "131026: Message undeliverable"
        _failed_opener(pg, c, "fM", err, err)
        pg.one(MESSAGES, id="m-fM")["provider_status"] = "failed"
        m.update({"state": "drafted", "followup_id": "fM", "drafted_at": ago(hours=2), "due_at": ago(hours=2)})
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], waves_now())
        self.assertEqual(int(pg.one(MEMBERS, wave_id="w1", contact_id=c).get("fail_count") or 0), 1)

    def test_held_control_highlevel_wallet_is_not_counted(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        m = members(pg, "w1")[0]
        c = m["contact_id"]
        err = "HighLevel said 400: Insufficient funds in the wallet"
        _failed_opener(pg, c, "fW", f"HighLevel did not send it: {err}", err)
        m.update({"state": "drafted", "followup_id": "fW", "drafted_at": ago(hours=2), "due_at": ago(hours=2)})
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], waves_now())
        self.assertEqual(int(pg.one(MEMBERS, wave_id="w1", contact_id=c).get("fail_count") or 0), 0)


# ---------------------------------------------------------------------------
# 2. The opener's HighLevel workflow takes every enrolment and sends nothing
#    (left in draft after an edit, "allow re-entry" off for a lead who went
#    through it before, a wait step added by mistake).
#
# HighLevel answers POST /contacts/{id}/workflow/{wf} with 200 either way.
# sendTemplate's 12 s read-back sees nothing, stores the message as sent
# with provider_status "enrolled", and sendFollowup marks the draft sent:
# send_due's answer is 200, judge() reads it as "sent", and the paced batch
# goes on, one opener every 45 s, run after run. Nothing reads whether the
# earlier openers of the batch ever reached a conversation: the follow-ups
# job's reconcile_templates says "did not send it within half an hour" only
# 30 minutes after each one, and the follow-up source's health (30% of the
# last 20 failed) can trip only after that. By then the day's whole batch
# has been enrolled into a workflow that sends nothing, and waves.sync takes
# every one of those leads out of the wave as "The opener may have gone; a
# person checks HighLevel" (never retried), though not one message went.
# ---------------------------------------------------------------------------

from tests.test_waves import Clock, GATE_OPEN, SETTINGS  # noqa: E402


class SilentWorkflowApi:
    """sales-api's followup.send_due over a workflow that sends nothing, with
    the follow-up source's health pause (index.ts whatsappHealth({source:
    "followup"}): paused at 30% failed of the last 20, at least 5)."""

    def __init__(self, pg: FakePostgrest, clock: Clock):
        self.pg, self.clock, self.calls = pg, clock, []

    def __call__(self, action, payload):
        self.calls.append((self.clock(), action, payload["id"]))
        recent = sorted((m for m in self.pg.rows(MESSAGES) if m.get("state") in ("sent", "delivered", "read", "failed")),
                        key=lambda m: m["created_at"], reverse=True)[:20]
        failed = [m for m in recent if m["state"] == "failed"]
        if len(recent) >= 5 and len(failed) / len(recent) >= 0.3:
            return 409, {"error": f"Automatic WhatsApp sends for follow-ups are paused: {len(failed)} of the last "
                                  f"{len(recent)} failed. A person sends until that clears.", "hold_all": True}
        f = self.pg.one(FOLLOWUPS, id=payload["id"])
        f["status"] = "sent"
        f["decided_at"] = self.clock().isoformat()
        f["message_id"] = f"m-{payload['id']}"
        m = {"id": f"m-{payload['id']}", "followup_id": payload["id"], "contact_id": f["contact_id"],
             "sent_by": "sales-desk", "via": "workflow", "channel": "whatsapp", "state": "sent",
             "provider_status": "enrolled", "body": "Hi Omar, it's the sales team from Mahara Media. How are you?",
             "created_at": self.clock().isoformat()}
        self.pg.put(MESSAGES, m)
        return 200, {"followup": {"id": payload["id"], "status": "sent"}, "message": m}


def _reconcile(pg: FakePostgrest, now) -> int:
    """followups.reconcile_templates over a conversation that never shows the
    template: after half an hour the message is failed with its words, and
    followup.settle fails the draft."""
    n = 0
    for m in pg.rows(MESSAGES):
        if m.get("provider_status") == "enrolled" and m.get("state") == "sent":
            from desk.followups import _ts
            if now - _ts(m["created_at"]) > timedelta(minutes=30):
                m.update({"state": "failed", "provider_status": "not sent",
                          "error": ("The workflow did not send it within half an hour. In HighLevel, check the "
                                    "workflow is published and allows re-entry.")})
                f = pg.one(FOLLOWUPS, id=m["followup_id"])
                f.update({"status": "failed", "error": "The workflow did not send it within half an hour."})
                n += 1
    return n


class AWorkflowThatSendsNothing(unittest.TestCase):
    def test_the_batch_holds_before_the_whole_day_is_enrolled_into_nothing(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=40)
        now = waves_now()
        ms = [m for m in members(pg, "w1")]
        for i, m in enumerate(ms):
            c = m["contact_id"]
            fid = f"fs{i:02d}"
            pg.put("cockpit_sales_leads", {"contact_id": c, "country": "Kuwait", "tags": ["roas-qualified"]}) \
                if not [x for x in pg.rows("cockpit_sales_leads") if x["contact_id"] == c] else None
            pg.put(FOLLOWUPS, {"id": fid, "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                               "status": "draft", "touch": 1, "created_at": ago(hours=1),
                               "context": {"wave_id": "w1", "language": "en"}})
            pg.put(waves.META, {"followup_id": fid, "send_after": (now - timedelta(minutes=40 - i)).isoformat(),
                                "held_by": None, "wave_id": "w1"})
            m.update({"state": "drafted", "followup_id": fid, "drafted_at": ago(hours=1), "due_at": ago(hours=1)})
        clock = Clock(now)
        api = SilentWorkflowApi(pg, clock)
        # The waves job every five minutes for an hour and a half; the follow-ups
        # job's reconcile beside it.
        for k in range(18):
            t = now + timedelta(minutes=5 * k)
            clock.t = t
            _reconcile(pg, t)
            with mock.patch.object(http, "request", pg):
                waves.send_due(sb(), api, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                               waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock,
                               sleep=clock.sleep, budget_s=270, log=lambda _m: None, warn=lambda _m: None)
        _reconcile(pg, now + timedelta(hours=3))
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], now + timedelta(hours=3))
        sent = len(api.calls) - sum(1 for _ in [])
        gone = [m for m in members(pg, "w1") if m.get("state") == "excluded"
                and "may have gone" in str(m.get("excluded_reason") or "")]
        self.assertLessEqual(len(gone), 5,
                             f"a workflow that took every enrolment and sent nothing consumed {len(gone)} leads "
                             f"({sent} openers enrolled before anything held the batch): each is out of the wave as "
                             "'may have gone; a person checks', though no message reached any of them")


# ---------------------------------------------------------------------------
# 3. The host check reads the host's OWN cockpit room as "another meeting".
#
# zoom_seat stores zoom_live_until from Zoom's live list (type=live) with no
# regard for which meeting it is. A setter waiting in their own fallback
# room's Zoom meeting when the ten-minute host check runs (rooms last about
# that long, so most do) gets zoom_live_until = that meeting's start plus its
# duration (lengths_min.intro, 30 minutes). make_zoom leaves the host's own
# rooms out of the live list (_own_meetings); the host check does not. The
# room ends at its lead's ten minutes and the worker closes its meeting, but
# sales-api's create gate (roomlogic providerRefusal: zoom_live -> zoom_busy)
# refuses the setter's next Zoom room, "Your Zoom is in another meeting",
# until the next host check, and the presence view holds them on a call.
# ---------------------------------------------------------------------------

from tests.test_rooms import SETTER as ROOM_SETTER, RoomsCase  # noqa: E402
from desk import rooms  # noqa: E402


class TheHostsOwnRoomIsNotAnotherMeeting(RoomsCase):
    def test_the_host_check_does_not_store_the_hosts_own_room_as_a_live_meeting(self):
        self.env.pg.put("cockpit_sales_people", {"email": ROOM_SETTER, "name": "Invented Setter", "role": "setter",
                                                 "active": True, "via_portal": True})
        now = self.env.clock()
        # The setter's own fallback room, open with the host in, on its Zoom meeting.
        self.env.add_room(1, state="host_in", provider="zoom", provider_meeting_id="81000000777",
                          join_url="https://zoom.example.test/j/81000000777", worker_run="run-a",
                          opened_at=rooms.iso(now - 4 * 60), host_in_at=rooms.iso(now - 3 * 60))
        self.env.zoom.live["zu-setter"] = [{"id": 81000000777, "topic": "Mahara call K7Q2MB",
                                            "start_time": rooms.iso(now - 3 * 60), "duration": 30}]
        self.env.worker().check_hosts()
        row = self.env.pg.one(rooms.HOSTS, email=ROOM_SETTER)
        self.assertIsNone(row.get("zoom_live_until"),
                          "the host check stored the setter's own cockpit room as another live Zoom meeting "
                          f"(zoom_live_until {row.get('zoom_live_until')}): once that room ends, sales-api refuses "
                          "their next Zoom room as 'in another meeting' (zoom_busy) until the next check")


def waves_now():
    from tests.test_waves import NOW
    return NOW


if __name__ == "__main__":
    unittest.main()
