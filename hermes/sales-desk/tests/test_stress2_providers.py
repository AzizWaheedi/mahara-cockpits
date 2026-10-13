"""Stress series 2, round 1, provider quirks on the desk side (2026-10-04):
Google Calendar's quota answers, HighLevel's workflow that silently sends
nothing, and a contact HighLevel merged or deleted. Each test drives the real
code through the fakes the lane's own tests use, with the providers' real
response shapes, and asserts what must hold; a failing test names a defect
for the fix lane. Every room, lead, seat and line is invented; nothing reaches
the network.

    python3 -m unittest tests.test_stress2_providers
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import timedelta
from typing import Any
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, rooms, waves  # noqa: E402
from desk.http import HttpError  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_followups import NOW as FU_NOW, FakeGhl, ago as fu_ago  # noqa: E402
from tests.test_rooms import CLOSER, SETTER, RoomsCase  # noqa: E402
from tests.test_waves import NOW, members, routes, run, seed, wave  # noqa: E402
from tests.test_waves import Ghl as WavesGhl  # noqa: E402


def google_limit(reason: str, code: int = 403, message: str = "Rate Limit Exceeded") -> dict[str, Any]:
    """Google Calendar's own error body for its usage limits
    (developers.google.com/calendar/api/guides/errors): a 403 with reason
    rateLimitExceeded, userRateLimitExceeded or quotaExceeded ("Calendar
    usage limits exceeded."), domain usageLimits."""
    return {"error": {"errors": [{"domain": "usageLimits", "reason": reason, "message": message}],
                      "code": code, "message": message}}


LIMITS = (
    ("rateLimitExceeded", "Rate Limit Exceeded"),
    ("userRateLimitExceeded", "User Rate Limit Exceeded"),
    ("quotaExceeded", "Calendar usage limits exceeded."),
)


# ---------------------------------------------------------------------------
# 1. Google Calendar's quota answer at the 10-minute host check. Google
#    answers its usage limits with a 403 (reason rateLimitExceeded,
#    userRateLimitExceeded or quotaExceeded), not only 429. check_google reads
#    every 403 that is not a 401 as "the sign-in cannot use Calendar" and
#    returns False (not None, "the last known state stays"), so check_hosts
#    writes google_ok = false on every seat. sales-api's createRefusal then
#    refuses every Meet room with "Meet rooms are down until the CEO
#    reconnects Google on the room worker" for the ten minutes to the next
#    check, every setter's default room flips to Zoom, and the room-hosts row
#    tells the CEO to reconnect a Google sign-in that works.
# ---------------------------------------------------------------------------

class GoogleQuotaAtTheHostCheck(RoomsCase):
    def seats(self):
        for email, role in ((SETTER, "setter"), (CLOSER, "closer")):
            self.env.pg.put("cockpit_sales_people", {"email": email, "name": "Invented Name", "role": role,
                                                     "active": True, "via_portal": True})
            # The last check found Google working.
            self.env.pg.put(rooms.HOSTS, {"email": email, "google_ok": True})
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]

    def test_a_quota_answer_keeps_the_last_known_google_state(self):
        for reason, message in LIMITS:
            with self.subTest(reason=reason):
                self.env = type(self.env)()
                self.patch.stop()
                self.patch = mock.patch.object(http, "request", self.env.net)
                self.patch.start()
                self.seats()
                self.env.google.script = [{"method": "GET", "path": "calendarList", "status": 403,
                                           "body": google_limit(reason, message=message)}]
                out = self.env.worker().check_hosts()
                google_line = out["lines"][0]
                oks = {r["email"]: r.get("google_ok") for r in self.env.pg.rows(rooms.HOSTS)}
                self.assertEqual(oks, {SETTER: True, CLOSER: True},
                                 f"Google's {reason} 403 at the host check wrote google_ok=false on every seat, so "
                                 "sales-api refuses every Meet room for ten minutes "
                                 f"(line: {google_line!r})")
                self.assertNotIn("cannot use Calendar", google_line,
                                 "a usage limit is told to the CEO as a Calendar permission problem")


# ---------------------------------------------------------------------------
# 2. The same quota answer while a Meet room is made. The Sender retries a
#    429 but never a 403, and _google_sentence reads every 403 as
#    SAY["google_scope"]: the room fails at once with "The room worker's
#    Google sign-in cannot use Calendar. Use Zoom, and ask the CEO to connect
#    Google Calendar on the VPS." for a limit that passes in seconds.
# ---------------------------------------------------------------------------

class GoogleQuotaWhileMakingAMeetRoom(RoomsCase):
    def test_a_quota_answer_on_the_insert_is_not_a_permission_failure(self):
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        self.env.google.script = [{"method": "POST", "path": "/events", "status": 403,
                                   "body": google_limit("rateLimitExceeded")}]
        self.env.add_room(provider="meet")
        self.env.worker().run(seconds=10)
        row = self.env.room()
        self.assertNotEqual(row.get("error"), rooms.SAY["google_scope"],
                            "Google's rate limit on the event insert failed the room as a lost Calendar permission "
                            f"(state {row['state']})")
        self.assertIn(row["state"], ("open", "creating"),
                      f"a rate limit that passes in seconds failed the Meet room: {row.get('error')!r}")

    def test_the_sentence_for_a_quota_answer(self):
        w = self.env.worker()
        for reason, message in LIMITS:
            with self.subTest(reason=reason):
                e = rooms.ProviderError(403, message, code=403, reason=reason, where="www.googleapis.com")
                self.assertNotEqual(w._google_sentence(e), rooms.SAY["google_scope"],
                                    f"{reason} is read as the sign-in having no Calendar permission")


# ---------------------------------------------------------------------------
# 3. A WhatsApp template HighLevel enrolled and never sent (the workflow does
#    not allow re-entry, or it is a draft: HighLevel answers 200 to the
#    enrolment and sends nothing). reconcile_templates should mark it never
#    sent after half an hour ("check the workflow ... allows re-entry") and
#    settle its follow-up as failed. It matches ANY outbound WhatsApp from a
#    workflow since the send instead of the template's own words (C29), so a
#    message from one of HighLevel's old automations, or another cockpit
#    template, is recorded as this opener delivered: the follow-up is
#    settled as gone, the wave counts the lead as messaged, and nobody is
#    told the workflow sends nothing.
# ---------------------------------------------------------------------------

class AnUnsentTemplateIsNotFoundInAnotherMessage(unittest.TestCase):
    def test_another_workflow_message_is_not_this_template(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_messages", {
            "id": "m1", "contact_id": "a", "via": "workflow", "channel": "whatsapp", "state": "sent",
            "provider_status": "enrolled", "followup_id": "f1", "created_at": fu_ago(minutes=40),
            "body": "السلام عليكم عمر، معاك سارة. كيف حالك؟"})
        # The lead's conversation: no opener; only HighLevel's own no-show
        # automation reminding them, from a workflow, after the enrolment.
        thread = [{"id": "ghl-msg-old-automation", "direction": "outbound", "messageType": "TYPE_WHATSAPP",
                   "source": "workflow", "status": "delivered", "dateAdded": fu_ago(minutes=20),
                   "body": "Hi Omar, we missed you on the call. Book again here."}]
        settled = []
        with mock.patch.object(http, "request", FakeGhl(pg, thread=thread)):
            out = fu.reconcile_templates(Supabase("https://example.supabase.co", "k"), "t", FU_NOW,
                                         settle=lambda i: settled.append(i) or {})
        m = pg.one("cockpit_sales_messages", id="m1")
        self.assertEqual(out, {"found": 0, "never_sent": 1},
                         "an automation's WhatsApp was taken for the opener HighLevel never sent "
                         f"(message now {m['state']}/{m.get('provider_status')}, ghl id {m.get('ghl_message_id')})")
        self.assertEqual(m["state"], "failed")

    def test_held_control_the_template_s_own_words_are_found(self):
        pg = FakePostgrest()
        body = "السلام عليكم عمر، معاك سارة. كيف حالك؟"
        pg.put("cockpit_sales_messages", {
            "id": "m1", "contact_id": "a", "via": "workflow", "channel": "whatsapp", "state": "sent",
            "provider_status": "enrolled", "followup_id": "f1", "created_at": fu_ago(minutes=40), "body": body})
        thread = [{"id": "ghl-msg-old-automation", "direction": "outbound", "messageType": "TYPE_WHATSAPP",
                   "source": "workflow", "status": "delivered", "dateAdded": fu_ago(minutes=20),
                   "body": "Hi Omar, we missed you on the call. Book again here."},
                  {"id": "ghl-msg-opener", "direction": "outbound", "messageType": "TYPE_WHATSAPP",
                   "source": "workflow", "status": "delivered", "dateAdded": fu_ago(minutes=39),
                   "body": "\u200f" + body + "\n\nReply STOP to opt out"}]
        with mock.patch.object(http, "request", FakeGhl(pg, thread=thread)):
            out = fu.reconcile_templates(Supabase("https://example.supabase.co", "k"), "t", FU_NOW,
                                         settle=lambda i: {})
        m = pg.one("cockpit_sales_messages", id="m1")
        self.assertEqual(out, {"found": 1, "never_sent": 0})
        self.assertEqual((m["state"], m.get("ghl_message_id")), ("delivered", "ghl-msg-opener"))


# ---------------------------------------------------------------------------
# 4. A wave member whose contact HighLevel merged or deleted. HighLevel
#    answers 400 ("Contact not found") or 404 for the old contact id.
#    _draft_wave catches it as "HighLevel could not be read." and tries again
#    every hour: for as long as the cockpit's lead copy still has the row (the
#    mirror drops a lead only when B2B does, on its six-hour full pass) the
#    member never leaves "waiting", the wave never finishes (finish() waits
#    for every waiting member), the pool's next wave cannot start, and the
#    status row says HighLevel could not be read although it answered.
# ---------------------------------------------------------------------------

class GoneContact(WavesGhl):
    def __init__(self, pg: FakePostgrest, gone: set[str], status: int = 400):
        super().__init__(pg)
        self.gone, self.status = gone, status

    def __call__(self, method, url, **kw):
        if "leadconnectorhq" in url and "/contacts/" in url:
            c = url.rsplit("/", 1)[-1].split("?", 1)[0]
            if c in self.gone:
                body = json.dumps({"statusCode": self.status, "message": "Contact not found"})
                raise HttpError(self.status, body, body.encode(), url)
        return super().__call__(method, url, **kw)


class AMergedContactInAWave(unittest.TestCase):
    def test_the_member_is_let_go_with_the_reason_not_retried_forever(self):
        for status in (400, 404):
            with self.subTest(status=status):
                pg = FakePostgrest()
                routes(pg)
                for c in ("gone-lead", "kept-lead"):
                    seed(pg, c, "never_booked")
                wave(pg, "w1", "never_booked")
                ghl = GoneContact(pg, {"gone-lead"}, status)
                for hours in (0, 1, 2, 3, 6):
                    run(pg, ghl, now=NOW + timedelta(hours=hours, minutes=1))
                m = next(x for x in members(pg, "w1") if x["contact_id"] == "gone-lead")
                if m.get("arm") == "holdout":
                    self.skipTest("the gone contact landed in the holdout arm")
                self.assertNotEqual(m["state"], "waiting",
                                    f"HighLevel said {status} 'Contact not found' and the member still waits "
                                    f"({m.get('later_reason')!r}, next try {m.get('next_try_at')}), so the wave "
                                    "never finishes")
                self.assertNotIn("could not be read", str(m.get("excluded_reason") or m.get("later_reason") or ""))


# ---------------------------------------------------------------------------
# 5. A stop the lead wrote months ago, behind a page of automated messages.
#    HighLevel's conversation messages come newest first, `limit` at a time
#    (GET /conversations/{id}/messages?limit=20, `nextPage` for the rest), and
#    one conversation carries every channel (the old nurture workflow's
#    emails and SMS too). ghl_thread reads one page of 20 per conversation and
#    never the next, and stop_of reads the lead's latest message in that page
#    only. A backlog lead who wrote "stop" on WhatsApp and then received 20+
#    automated messages has no message of theirs in the page: no stop is
#    seen, nothing in the cockpit's stops table holds them (the agent never
#    read them before), and the wave writes the CEO's opener for them. Once a
#    rep approves the batch it goes: a WhatsApp to a lead who asked to stop.
# ---------------------------------------------------------------------------

class PagedGhl(WavesGhl):
    """HighLevel as it pages a conversation: newest first, `limit` a page,
    and the page before `lastMessageId` when it is asked for."""

    def __call__(self, method, url, **kw):
        if "leadconnectorhq" in url and "/conversations/cv-" in url:
            import urllib.parse as up
            parts = up.urlsplit(url)
            q = dict(up.parse_qsl(parts.query))
            limit = int(q.get("limit") or 20)
            c = parts.path.split("/conversations/cv-", 1)[1].split("/", 1)[0]
            thread = sorted(self.person(c)["thread"], key=lambda m: m["dateAdded"], reverse=True)
            self.pages = getattr(self, "pages", 0) + 1
            if q.get("lastMessageId"):
                at = next(i for i, m in enumerate(thread) if m["id"] == q["lastMessageId"])
                thread = thread[at + 1:]
            page = thread[:limit]
            body = {"messages": {"lastMessageId": page[-1]["id"] if page else None,
                                 "nextPage": len(thread) > limit, "messages": page}}
            return 200, {}, json.dumps(body).encode()
        return super().__call__(method, url, **kw)


class AStopBehindAPageOfAutomations(unittest.TestCase):
    def test_a_lead_who_asked_to_stop_gets_no_opener(self):
        pg = FakePostgrest()
        routes(pg)
        seed(pg, "asked-to-stop", "never_booked", days=150)
        wave(pg, "w1", "never_booked")

        def at(days: float) -> str:
            return (NOW - timedelta(days=days)).isoformat()

        thread = [{"id": "in-1", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": at(120),
                   "body": "لا ترسلون لي رسائل مرة ثانية"}]
        # The old nurture workflow kept going by email and SMS for four months.
        for i in range(24):
            thread.append({"id": f"auto-{i}", "direction": "outbound", "source": "workflow",
                           "messageType": "TYPE_EMAIL" if i % 2 else "TYPE_SMS", "dateAdded": at(118 - i * 4.5),
                           "body": f"Mahara Media newsletter number {i}: growth tips for your clinic."})
        ghl = PagedGhl(pg, {"asked-to-stop": {"thread": thread}})
        run(pg, ghl, now=NOW + timedelta(minutes=1))
        m = members(pg, "w1")[0]
        self.check(pg, m)

    def test_held_control_the_same_stop_inside_the_page_is_seen(self):
        pg = FakePostgrest()
        routes(pg)
        seed(pg, "asked-to-stop", "never_booked", days=150)
        wave(pg, "w1", "never_booked")
        at = lambda days: (NOW - timedelta(days=days)).isoformat()  # noqa: E731
        thread = [{"id": "in-1", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": at(120),
                   "body": "لا ترسلون لي رسائل مرة ثانية"}]
        for i in range(5):
            thread.append({"id": f"auto-{i}", "direction": "outbound", "source": "workflow", "messageType": "TYPE_EMAIL",
                           "dateAdded": at(100 - i * 10), "body": f"Newsletter {i}."})
        run(pg, PagedGhl(pg, {"asked-to-stop": {"thread": thread}}), now=NOW + timedelta(minutes=1))
        m = members(pg, "w1")[0]
        if m.get("arm") == "holdout":
            self.skipTest("the lead landed in the holdout arm")
        self.assertEqual(m["state"], "excluded")
        self.assertIn("stop", str(m.get("excluded_reason")))

    def test_a_stop_three_pages_back_is_read(self):
        # Fix round 1: the conversation is read back page by page (HighLevel's
        # cursor) until the lead's own last words are in it.
        pg = FakePostgrest()
        routes(pg)
        seed(pg, "asked-to-stop", "never_booked", days=150)
        wave(pg, "w1", "never_booked")
        at = lambda days: (NOW - timedelta(days=days)).isoformat()  # noqa: E731
        thread = [{"id": "in-1", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": at(120),
                   "body": "STOP"}]
        for i in range(130):
            thread.append({"id": f"auto-{i}", "direction": "outbound", "source": "workflow", "messageType": "TYPE_EMAIL",
                           "dateAdded": at(119 - i * 0.5), "body": f"Newsletter {i}."})
        ghl = PagedGhl(pg, {"asked-to-stop": {"thread": thread}})
        run(pg, ghl, now=NOW + timedelta(minutes=1))
        m = members(pg, "w1")[0]
        self.check(pg, m)
        self.assertGreaterEqual(ghl.pages, 3)
        self.assertIn("stop", str(m.get("excluded_reason")).lower())
        # The stop is kept in the cockpit, so sales-api's send_due holds the lead too.
        self.assertTrue(pg.rows("cockpit_sales_followup_stops"))

    def test_a_conversation_too_long_to_reach_the_lead_s_words_gets_no_opener(self):
        pg = FakePostgrest()
        routes(pg)
        seed(pg, "asked-to-stop", "never_booked", days=400)
        wave(pg, "w1", "never_booked")
        at = lambda days: (NOW - timedelta(days=days)).isoformat()  # noqa: E731
        thread = [{"id": "in-1", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": at(390),
                   "body": "STOP"}]
        for i in range(fu.HISTORY_PAGE * fu.HISTORY_PAGES + 10):
            thread.append({"id": f"auto-{i}", "direction": "outbound", "source": "workflow", "messageType": "TYPE_SMS",
                           "dateAdded": at(380 - i * 0.1), "body": f"Reminder {i}."})
        run(pg, PagedGhl(pg, {"asked-to-stop": {"thread": thread}}), now=NOW + timedelta(minutes=1))
        m = members(pg, "w1")[0]
        self.check(pg, m)
        self.assertEqual(m["state"], "excluded")
        self.assertEqual(m.get("excluded_reason"), waves.LONG_THREAD)

    def check(self, pg, m):
        if m.get("arm") == "holdout":
            self.skipTest("the lead landed in the holdout arm")
        drafts = [f for f in pg.rows("cockpit_sales_followups") if f["contact_id"] == "asked-to-stop"
                  and f.get("status") == "draft"]
        self.assertEqual(drafts, [],
                         "the lead's stop is behind 24 automated messages, outside the one page ghl_thread reads, so "
                         f"an opener was written for a lead who asked to stop (member {m['state']}, "
                         f"{m.get('excluded_reason') or m.get('later_reason')!r})")


# ---------------------------------------------------------------------------
# 6. A host in another Zoom meeting that ends a minute after the host check.
#    zoom_seat writes zoom_live_until as at least the next check plus five
#    minutes (now + 900 s) whatever the meeting's own end, so presence never
#    reads an overrunning meeting as free. sales-api's createRefusal reads the
#    same column as "your Zoom is in another meeting" (zoom_busy): for up to
#    fifteen minutes after the other meeting ended, every Zoom room the closer
#    asks for is refused with "Your Zoom is in another meeting. End it or use
#    Meet.", while the worker, which reads Zoom's live list itself at the
#    create, would make it.
# ---------------------------------------------------------------------------

class AnotherMeetingThatEndsAfterTheCheck(RoomsCase):
    def test_the_stored_live_end_is_not_far_past_the_meeting_s_own_end(self):
        self.env.pg.put("cockpit_sales_people", {"email": CLOSER, "name": "Invented Name", "role": "closer",
                                                 "active": True, "via_portal": True})
        now = self.env.clock()
        # A 30-minute internal call that started 29 minutes ago: it ends in a minute.
        start = rooms.iso(now - 29 * 60)
        self.env.zoom.live["zu-closer"] = [{"id": 99001, "start_time": start, "duration": 30}]
        self.env.worker().check_hosts()
        row = self.env.pg.one(rooms.HOSTS, email=CLOSER)
        until = rooms.parse_ts(row.get("zoom_live_until"))
        meeting_end = now + 60
        self.assertIsNotNone(until)
        self.assertLessEqual(until, meeting_end + 5 * 60,
                             f"the host check stored zoom_live_until {row.get('zoom_live_until')}, "
                             f"{round((until - meeting_end) / 60)} minutes after the meeting's end: sales-api refuses "
                             "every Zoom room for the closer until then (zoom_busy)")


if __name__ == "__main__":
    unittest.main()
