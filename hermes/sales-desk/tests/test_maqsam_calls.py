"""Maqsam's phone calls into the cockpit, tested on invented calls. Every
name, number and line here is made up.

    python3 -m unittest tests.test_maqsam_calls
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, maqsam_calls  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
SETTER = "setter.one@maharamedia.com"
CLOSER = "closer.one@maharamedia.com"


def call(cid: int, *, agent: str = SETTER, state: str = "completed", kind: str = "outbound",
         number: str = "+965 5000 1111", at: datetime = NOW - timedelta(days=2), segments: Optional[list] = None,
         also: Optional[str] = None) -> dict[str, Any]:
    agents = [{"identifier": "1", "email": agent, "name": "Rep"}]
    if also:
        agents.append({"identifier": "2", "email": also, "name": "Other"})
    return {
        "id": cid, "referenceId": f"ref-{cid}", "type": kind, "state": state, "timestamp": int(at.timestamp()),
        "duration": 95, "callerNumber": number if kind == "inbound" else "+965 2200 0000",
        "calleeNumber": number if kind == "outbound" else "+965 2200 0000",
        "summary": {"en": "The lead asked for the price.", "ar": "سأل عن السعر"},
        "transcription": "agent: Hello\ncustomer: Hi",
        "segments": segments if segments is not None else [
            {"speaker": "agent", "startTime": 1.9, "endTime": 3.0, "content": "Hello, this is Mahara."},
            {"speaker": "customer", "startTime": 64.2, "endTime": 66.0, "content": "Hi,  tell me   more."}],
        "agents": agents,
    }


class FakeMaqsam:
    """Pages of calls per seat, a hundred to a page, newest first."""

    def __init__(self, by_seat: dict[str, list[dict[str, Any]]], fail: Optional[dict[str, Exception]] = None):
        self.by_seat = by_seat
        self.fail = fail or {}
        self.asked: list[tuple[str, datetime, datetime]] = []

    def calls(self, email, start, end, *, max_pages=maqsam_calls.MAX_PAGES):
        self.asked.append((email, start, end))
        if email in self.fail:
            raise self.fail[email]
        rows = [c for c in self.by_seat.get(email, [])
                if int(start.timestamp()) <= c["timestamp"] <= int(end.timestamp())]
        rows.sort(key=lambda c: -c["timestamp"])
        for i in range(0, len(rows), maqsam_calls.PAGE):
            yield rows[i : i + maqsam_calls.PAGE]


class Shapes(unittest.TestCase):
    def test_a_transcript_is_one_timed_line_per_turn(self):
        self.assertEqual(maqsam_calls.transcript_of(call(1)),
                         "[00:01] Rep: Hello, this is Mahara.\n[01:04] Lead: Hi, tell me more.")
        flat = call(2, segments=[])
        self.assertEqual(maqsam_calls.transcript_of(flat), "Rep: Hello\nLead: Hi")
        self.assertEqual(maqsam_calls.transcript_of(call(3, segments=[{"speaker": "agent", "content": " "}])),
                         "Rep: Hello\nLead: Hi")
        self.assertEqual(maqsam_calls.clock(3725.4), "62:05")

    def test_the_lead_is_the_other_end_of_the_line(self):
        self.assertEqual(maqsam_calls.phone8(maqsam_calls.lead_number(call(1, number="+965 5000 1111"))), "50001111")
        inbound = call(2, kind="inbound", number="00965-6000-2222")
        self.assertEqual(maqsam_calls.phone8(maqsam_calls.lead_number(inbound)), "60002222")
        self.assertIsNone(maqsam_calls.phone8("123"))

    def test_the_english_summary_and_the_arabic_only_without_it(self):
        self.assertEqual(maqsam_calls.summary_of(call(1)), "The lead asked for the price.")
        c = call(2)
        c["summary"] = {"en": "", "ar": "سأل عن السعر"}
        self.assertEqual(maqsam_calls.summary_of(c), "سأل عن السعر")


class Run(unittest.TestCase):
    def setUp(self):
        self.pg = FakePostgrest()
        self.pg.put("cockpit_sales_reps", {"id": "r1", "maqsam_email": SETTER, "ghl_user_id": "u1"})
        self.pg.put("cockpit_sales_reps", {"id": "r2", "maqsam_email": None, "ghl_user_id": "u2"})
        self.pg.put("cockpit_sales_people", {"email": CLOSER, "maqsam_email": CLOSER.upper()})
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-old", "phone8": "50001111",
                                            "lead_created_at": "2026-02-01T00:00:00+00:00"})
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-new", "phone8": "50001111",
                                            "lead_created_at": "2026-08-01T00:00:00+00:00"})
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-in", "phone8": "60002222",
                                            "lead_created_at": None})
        self.sb = Supabase("https://example.supabase.co", "service-test")

    def run_it(self, mq, **kw):
        kw.setdefault("now", NOW)
        with mock.patch.object(http, "request", self.pg):
            return maqsam_calls.run(
                self.sb, mq, lambda _m: None,
                upload=lambda path, blob: self.sb.upload_to("sales-calls", path, blob, "text/markdown"), **kw)

    def test_answered_calls_with_words_come_in_matched_by_phone(self):
        both = call(6, also=CLOSER)  # handed from the setter to the closer: in both seats' lists
        silent = call(3, segments=[])
        silent["transcription"] = ""
        mq = FakeMaqsam({
            SETTER: [call(1), call(2, state="no_answer"), silent,
                     call(4, kind="inbound", number="00965-6000-2222", at=NOW - timedelta(days=3)),
                     call(5, number="+1 555 0100 9999"), both],
            CLOSER: [both, call(7, agent=CLOSER, state="serviced", kind="inbound", number="+965 7000 3333")],
        })
        out = self.run_it(mq)
        # Both seats, the closer's address in any case; each read from the first day.
        self.assertEqual(sorted(e for e, _s, _e in mq.asked), [CLOSER, SETTER])
        self.assertTrue(all(s == maqsam_calls.FIRST_DAY for _e, s, _t in mq.asked))
        self.assertEqual((out["rows"], out["stored"], out["uploaded"], out["by_phone"], out["unmatched"]),
                         (5, 5, 5, 3, 2))
        a = self.pg.one("cockpit_sales_recordings", recording_id="maqsam:1")
        self.assertEqual((a["contact_id"], a["matched_by"], a["source"], a["kind"], a["title"]),
                         ("c-new", "phone", "maqsam", "phone", "Phone call, outbound"))
        self.assertEqual((a["recorded_by"], a["duration_s"], a["summary"], a["transcript_path"]),
                         (SETTER, 95, "The lead asked for the price.", "maqsam/1.md"))
        self.assertIsNone(a["share_url"])
        text = self.pg.objects["sales-calls/maqsam/1.md"][1].decode()
        self.assertTrue(text.startswith("[00:01] Rep: Hello"))
        self.assertEqual(a["transcript_chars"], len(text))
        b = self.pg.one("cockpit_sales_recordings", recording_id="maqsam:4")
        self.assertEqual((b["contact_id"], b["title"]), ("c-in", "Phone call, inbound"))
        self.assertEqual(self.pg.one("cockpit_sales_recordings", recording_id="maqsam:5")["matched_by"], "none")
        # Handled by two seats: one row, credited to the call's first agent who holds a seat.
        self.assertEqual(self.pg.one("cockpit_sales_recordings", recording_id="maqsam:6")["recorded_by"], SETTER)
        for gone in ("maqsam:2", "maqsam:3"):
            self.assertIsNone(self.pg.one("cockpit_sales_recordings", recording_id=gone))
        mark = self.pg.one("cockpit_sales_settings", key="maqsam_calls")["value"]
        self.assertEqual(mark["through"], "2026-09-26T12:00:00Z")
        self.assertTrue(out["mark_written"])

    def test_the_next_run_starts_a_week_before_the_mark_uploads_nothing_new_and_keeps_a_hand_match(self):
        mq = FakeMaqsam({SETTER: [call(1)]})
        self.run_it(mq)
        self.pg.one("cockpit_sales_recordings", recording_id="maqsam:1").update(
            {"contact_id": "c-picked", "matched_by": "hand"})
        later = NOW + timedelta(days=1)
        mq2 = FakeMaqsam({SETTER: [call(1)]})
        out = self.run_it(mq2, now=later)
        self.assertEqual(mq2.asked[0][1], NOW - timedelta(days=7))
        self.assertEqual((out["rows"], out["uploaded"], out["kept_earlier_match"]), (1, 0, 1))
        row = self.pg.one("cockpit_sales_recordings", recording_id="maqsam:1")
        self.assertEqual((row["contact_id"], row["matched_by"]), ("c-picked", "hand"))

    def test_a_dry_run_writes_nothing(self):
        out = self.run_it(FakeMaqsam({SETTER: [call(1), call(2)]}), dry=True)
        self.assertEqual((out["rows"], out["stored"], out["uploaded"], out["mark_written"]), (2, 0, 0, False))
        self.assertEqual([c for c in self.pg.writes()], [])
        self.assertEqual(self.pg.objects, {})

    def test_a_limited_try_stops_early_and_leaves_the_mark(self):
        out = self.run_it(FakeMaqsam({SETTER: [call(i) for i in range(1, 9)]}), limit=3)
        self.assertEqual((out["rows"], out["stored"]), (3, 3))
        self.assertEqual(len(self.pg.rows("cockpit_sales_recordings")), 3)
        self.assertIsNone(self.pg.one("cockpit_sales_settings", key="maqsam_calls"))

    def test_a_seat_maqsam_refuses_is_read_again_from_the_same_point(self):
        mq = FakeMaqsam({SETTER: [call(1)]}, fail={CLOSER: maqsam_calls.MaqsamError(500, "Maqsam answered 500")})
        out = self.run_it(mq)
        self.assertEqual((out["rows"], out["seats_unread"]), (1, [CLOSER]))
        self.assertIsNone(self.pg.one("cockpit_sales_settings", key="maqsam_calls"))

    def test_a_short_window_by_hand_never_skips_ahead_of_the_mark(self):
        self.pg.put("cockpit_sales_settings", {"key": "maqsam_calls", "value": {"through": "2026-09-10T00:00:00Z"}})
        out = self.run_it(FakeMaqsam({SETTER: [call(1)]}), days=3)
        self.assertEqual((out["rows"], out["mark_written"]), (1, False))
        self.assertEqual(self.pg.one("cockpit_sales_settings", key="maqsam_calls")["value"]["through"],
                         "2026-09-10T00:00:00Z")

    def test_a_page_of_someone_elses_calls_stops_that_seat(self):
        stray = call(1, agent="someone@maharamedia.com")
        out = self.run_it(FakeMaqsam({SETTER: [stray]}))
        self.assertEqual((out["rows"], out["seats_unread"]), (0, [SETTER]))
        self.assertIn("email filter", out["per_seat"][SETTER]["error"])


class Client(unittest.TestCase):
    def test_pages_are_read_until_a_short_one_and_the_key_is_never_in_an_error(self):
        pages = {1: [{"id": i} for i in range(100)], 2: [{"id": 100}]}
        seen = []

        def transport(method, url, **kw):
            seen.append(url)
            page = int(url.rsplit("page=", 1)[1])
            return 200, {}, json.dumps({"result": "success", "message": pages.get(page, [])}).encode()

        mq = maqsam_calls.Maqsam("access-id", "secret-value", pace=0, transport=transport)
        got = list(mq.calls(SETTER, NOW - timedelta(days=1), NOW))
        self.assertEqual([len(p) for p in got], [100, 1])
        self.assertIn("email=setter.one%40maharamedia.com", seen[0])
        self.assertIn("end_time=", seen[0])

        def refuse(method, url, **kw):
            raise http.HttpError(401, "bad key=secret-value")

        with self.assertRaises(maqsam_calls.MaqsamError) as e:
            list(maqsam_calls.Maqsam("access-id", "secret-value", pace=0, transport=refuse).calls(SETTER, NOW, NOW))
        self.assertEqual(e.exception.status, 401)
        self.assertNotIn("secret-value", str(e.exception))
        with self.assertRaises(maqsam_calls.MaqsamError):
            maqsam_calls.Maqsam("", "")


if __name__ == "__main__":
    unittest.main()
