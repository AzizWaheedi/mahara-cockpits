"""Maqsam's phone calls into the cockpit, tested on invented calls. Every
name, number and line here is made up.

    python3 -m unittest tests.test_maqsam_calls
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, maqsam_calls  # noqa: E402
from desk.supabase import Supabase, iso  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)  # 15:00 in Kuwait
SETTER = "setter.one@maharamedia.com"
CLOSER = "closer.one@maharamedia.com"
DIALS = "cockpit_sales_dials"
CHECKS = "cockpit_sales_dial_checks"
# Maqsam's reference ids (B2B's numbering) sit apart from the v3 ids here, as they do in Maqsam.
REF = 330_000_000


def call(cid: int, *, agent: str = SETTER, state: str = "completed", kind: str = "outbound",
         number: str = "+965 5000 1111", at: Optional[datetime] = None, segments: Optional[list] = None,
         also: Optional[str] = None, ref: Any = "default") -> dict[str, Any]:
    agents = [{"identifier": "1", "email": agent, "name": "Rep"}]
    if also:
        agents.append({"identifier": "2", "email": also, "name": "Other"})
    at = at or NOW - timedelta(days=2, minutes=cid)
    return {
        "id": cid, "referenceId": REF + cid if ref == "default" else ref, "type": kind, "state": state,
        "timestamp": int(at.timestamp()),
        "duration": 95, "callerNumber": number if kind == "inbound" else "+965 2200 0000",
        "calleeNumber": number if kind == "outbound" else "+965 2200 0000",
        "summary": {"en": "The lead asked for the price.", "ar": "سأل عن السعر"},
        "transcription": "agent: Hello\ncustomer: Hi",
        "segments": segments if segments is not None else [
            {"speaker": "agent", "startTime": 1.9, "endTime": 3.0, "content": "Hello, this is Mahara."},
            {"speaker": "customer", "startTime": 64.2, "endTime": 66.0, "content": "Hi,  tell me   more."}],
        "agents": agents,
    }


def silent(cid: int, **kw: Any) -> dict[str, Any]:
    c = call(cid, segments=[], **kw)
    c["transcription"] = ""
    return c


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

    def test_a_dial_is_kept_by_maqsams_reference_id_in_b2bs_words(self):
        row = maqsam_calls.dial_row(call(7, kind="inbound", state="serviced", number="+965 7000 3333"),
                                    agent=SETTER, rep_id="r1", stamp="2026-09-26T12:00:00Z")
        self.assertEqual(row, {
            "call_id": str(REF + 7), "occurred_at": iso(NOW - timedelta(days=2, minutes=7)),
            "agent_email": SETTER, "agent_name": "Rep", "sales_rep_id": "r1", "direction": "inbound",
            "state": "serviced", "duration_s": 95, "lead_phone8": "70003333", "lead_digits": "96570003333",
            "has_transcript": True, "tags": [], "origin": "maqsam", "mirrored_at": "2026-09-26T12:00:00Z"})
        blocked = silent(8, state="blocked")
        blocked["duration"] = None
        blocked["referenceId"] = str(REF + 8)  # Maqsam writes it as text or as a number
        row = maqsam_calls.dial_row(blocked, agent=SETTER, rep_id=None, stamp="x")
        self.assertEqual((row["call_id"], row["duration_s"], row["has_transcript"]), (str(REF + 8), None, False))
        for ref in (None, "", "ref-9"):
            self.assertIsNone(maqsam_calls.dial_row(call(9, ref=ref), agent=SETTER, rep_id=None, stamp="x"))
        self.assertEqual(set(maqsam_calls.STATES) | set(maqsam_calls.DIRECTIONS),
                         {"completed", "serviced", "no_answer", "busy", "failed", "blocked", "abandoned",
                          "outbound", "inbound"})


class PhoneRule(unittest.TestCase):
    """Which lead a number belongs to, the rule cockpit_sales_link_dials links by."""
    AT = datetime(2026, 9, 24, 10, 0, tzinfo=timezone.utc)

    @staticmethod
    def lead(cid: str, phone: Optional[str], created: Optional[str]) -> dict[str, Any]:
        return {"contact_id": cid, "phone": phone, "phone8": "50001111", "lead_created_at": created}

    def pick(self, number: str, leads: list[dict[str, Any]], at: Optional[datetime] = AT):
        return maqsam_calls.pick_lead(number, at, leads)

    def test_the_lead_that_existed_at_the_call_wins_the_newest_of_them(self):
        leads = [self.lead("c-old", "+965 5000 1111", "2026-02-01T00:00:00Z"),
                 self.lead("c-new", "96550001111", "2026-08-01T00:00:00+00:00"),
                 self.lead("c-later", "0096550001111", "2026-09-25T00:00:00Z")]
        self.assertEqual(self.pick("+965 5000 1111", leads), ("c-new", False))

    def test_an_hours_grace_and_else_the_first_created_after_the_call(self):
        grace = [self.lead("c-old", "+965 5000 1111", "2026-02-01T00:00:00Z"),
                 self.lead("c-just", "+965 5000 1111", "2026-09-24T10:50:00Z")]
        self.assertEqual(self.pick("+965 5000 1111", grace), ("c-just", False))
        after = [self.lead("c-late", "+965 5000 1111", "2026-09-30T00:00:00Z"),
                 self.lead("c-soon", "+965 5000 1111", "2026-09-24T11:30:00Z")]
        self.assertEqual(self.pick("+965 5000 1111", after), ("c-soon", False))
        # A lead with no date counts as there all along, after the dated ones.
        undated = [self.lead("c-undated", "+965 5000 1111", None), self.lead("c-late", "+965 5000 1111",
                                                                             "2026-09-30T00:00:00Z")]
        self.assertEqual(self.pick("+965 5000 1111", undated), ("c-undated", False))
        # Two leads with the same number and no time for the call: nobody can say.
        self.assertEqual(self.pick("+965 5000 1111", grace, at=None), (None, True))

    def test_nine_digits_must_agree(self):
        # Another number with the same last eight: the ninth digit differs.
        leads = [self.lead("c-kw", "+965 5000 1111", "2026-02-01T00:00:00Z"),
                 self.lead("c-sa", "+966 4 5000 1111", "2026-08-01T00:00:00Z")]
        self.assertEqual(self.pick("+965 5000 1111", leads), ("c-kw", False))
        self.assertEqual(self.pick("+966 4 5000 1111", leads), ("c-sa", False))
        self.assertEqual(self.pick("+44 7 5000 1111", leads), (None, False))

    def test_eight_digits_alone_match_only_when_one_lead_could_be_meant(self):
        one = [self.lead("c-short", "5000 1111", "2026-02-01T00:00:00Z"),
               self.lead("c-sa", "+966 4 5000 1111", "2026-08-01T00:00:00Z")]
        # c-sa's ninth digit rules it out, so only c-short could be meant.
        self.assertEqual(self.pick("+965 5000 1111", one), ("c-short", False))
        two = [self.lead("c-a", "5000 1111", "2026-02-01T00:00:00Z"),
               self.lead("c-b", "+965 5000 1111", "2026-08-01T00:00:00Z")]
        self.assertEqual(self.pick("5000 1111", two), (None, True))
        self.assertEqual(self.pick("5000 1111", two[:1]), ("c-a", False))


class RunCase(unittest.TestCase):
    def setUp(self):
        self.pg = FakePostgrest()
        self.pg.put("cockpit_sales_reps", {"id": "r1", "maqsam_email": SETTER, "ghl_user_id": "u1"})
        self.pg.put("cockpit_sales_reps", {"id": "r2", "maqsam_email": None, "ghl_user_id": "u2"})
        self.pg.put("cockpit_sales_people", {"email": CLOSER, "maqsam_email": CLOSER.upper()})
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-old", "phone": "+965 5000 1111", "phone8": "50001111",
                                            "lead_created_at": "2026-02-01T00:00:00+00:00"})
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-new", "phone": "965 5000 1111", "phone8": "50001111",
                                            "lead_created_at": "2026-08-01T00:00:00+00:00"})
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-in", "phone": "+965 6000 2222", "phone8": "60002222",
                                            "lead_created_at": None})
        self.sb = Supabase("https://example.supabase.co", "service-test")

    def run_it(self, mq, log=None, **kw):
        kw.setdefault("now", NOW)
        with mock.patch.object(http, "request", self.pg):
            return maqsam_calls.run(
                self.sb, mq, log or (lambda _m: None),
                upload=lambda path, blob: self.sb.upload_to("sales-calls", path, blob, "text/markdown"), **kw)


class Run(RunCase):
    def test_answered_calls_with_words_come_in_matched_by_phone(self):
        both = call(6, also=CLOSER)  # handed from the setter to the closer: in both seats' lists
        mq = FakeMaqsam({
            SETTER: [call(1), call(2, state="no_answer"), silent(3),
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
        # Two leads have this number and both existed at the call: the newer one.
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

    def test_a_mark_from_before_the_dial_log_reads_from_the_first_day_once(self):
        mark = lambda: self.pg.one("cockpit_sales_settings", key="maqsam_calls")["value"]  # noqa: E731
        # A window by hand that leaves the history unread never says the log holds it.
        self.pg.put("cockpit_sales_settings", {"key": "maqsam_calls", "value": {"through": "2026-09-25T00:00:00Z"}})
        self.run_it(FakeMaqsam({SETTER: [call(1)]}), days=3)
        self.assertEqual((mark()["through"], mark()["dials"]), ("2026-09-26T12:00:00Z", False))
        mq = FakeMaqsam({SETTER: [call(1), call(2, agent=SETTER, at=datetime(2026, 2, 3, tzinfo=timezone.utc))]})
        out = self.run_it(mq, now=NOW + timedelta(hours=1))
        self.assertEqual((mq.asked[0][1], out["dials"]["new"], mark()["dials"]), (maqsam_calls.FIRST_DAY, 1, True))
        mq = FakeMaqsam({SETTER: [call(1)]})
        self.run_it(mq, now=NOW + timedelta(hours=2))
        self.assertEqual(mq.asked[0][1], NOW + timedelta(hours=1) - maqsam_calls.OVERLAP)

    def test_a_number_more_than_one_lead_could_have_stays_unmatched_and_an_old_phone_match_is_undone(self):
        for cid in ("c-a", "c-b"):  # stored with eight digits only: either could be meant
            self.pg.put("cockpit_sales_leads", {"contact_id": cid, "phone": "5000 7777", "phone8": "50007777",
                                                "lead_created_at": "2026-03-01T00:00:00+00:00"})
        # What the old rule (the newer lead) wrote, what a person wrote, an email and an appointment match.
        for rid, how, contact in (("maqsam:21", "phone", "c-b"), ("maqsam:22", "hand", "c-a"),
                                  ("maqsam:23", "email", "c-a"), ("maqsam:24", "appointment", "c-x")):
            self.pg.put("cockpit_sales_recordings", {"recording_id": rid, "contact_id": contact, "matched_by": how})
        calls = [call(i, number="+965 5000 7777") for i in (21, 22, 23)] + [call(24)]  # 24: the rule says c-new
        out = self.run_it(FakeMaqsam({SETTER: calls}))
        self.assertEqual((out["ambiguous"], out["shared_phone8"], out["kept_earlier_match"]), (3, 2, 3))
        got = {rid: (r["contact_id"], r["matched_by"]) for rid in ("maqsam:21", "maqsam:22", "maqsam:23", "maqsam:24")
               for r in [self.pg.one("cockpit_sales_recordings", recording_id=rid)]}
        self.assertEqual(got, {"maqsam:21": (None, "none"), "maqsam:22": ("c-a", "hand"),
                               "maqsam:23": ("c-a", "email"), "maqsam:24": ("c-x", "appointment")})

    def test_a_dry_run_writes_nothing(self):
        out = self.run_it(FakeMaqsam({SETTER: [call(1), call(2)]}), dry=True)
        self.assertEqual((out["rows"], out["stored"], out["uploaded"], out["mark_written"]), (2, 0, 0, False))
        self.assertEqual((out["dials"]["new"], out["dial_check"]["written"], out["marked"]), (2, 0, None))
        self.assertEqual([c for c in self.pg.writes()], [])
        self.assertEqual(self.pg.objects, {})

    def test_a_limited_try_stops_early_and_leaves_the_mark(self):
        out = self.run_it(FakeMaqsam({SETTER: [call(i) for i in range(1, 9)]}), limit=3)
        self.assertEqual((out["rows"], out["stored"]), (3, 3))
        self.assertEqual(len(self.pg.rows("cockpit_sales_recordings")), 3)
        self.assertIsNone(self.pg.one("cockpit_sales_settings", key="maqsam_calls"))
        # A seat read in part is never compared with the dial log.
        self.assertIn("not_done", out["dial_check"])
        self.assertEqual(self.pg.rows(CHECKS), [])

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


class DialLog(RunCase):
    """Every call read goes in cockpit_sales_dials once, and B2B's copy wins."""

    def b2b(self, call_id: str, agent: str, at: datetime) -> None:
        self.pg.put(DIALS, {"call_id": call_id, "agent_email": agent, "occurred_at": iso(at), "origin": "b2b",
                            "agent_name": "From B2B", "sales_rep_id": "r1", "direction": "outbound",
                            "state": "completed", "contact_id": None})

    def test_every_call_read_goes_in_once_with_b2bs_words_and_b2bs_copy_is_never_touched(self):
        c1, c2, c5 = call(1), call(2, state="no_answer"), call(5)
        self.b2b(str(REF + 1), SETTER, NOW - timedelta(days=2, minutes=1))   # the same reference id
        self.b2b("258000002", SETTER, NOW - timedelta(days=2, minutes=2))    # another id, same seat and second
        # Under the same id at a time and seat the read does not look at: the insert itself leaves it.
        self.b2b(str(REF + 5), "someone@maharamedia.com", NOW - timedelta(days=9))
        nothing = call(8)
        nothing["referenceId"] = None
        both = call(6, also=CLOSER)
        mq = FakeMaqsam({
            SETTER: [c1, c2, silent(3, state="busy"), call(4, kind="inbound", state="abandoned"), c5, nothing, both],
            CLOSER: [both, call(7, agent=CLOSER, kind="inbound", state="serviced", number="+965 7000 3333")],
        })
        out = self.run_it(mq)
        d = out["dials"]
        self.assertEqual((d["read"], d["new"], d["held"], d["unusable"], d["no_rep"], d["unfamiliar"]),
                         (8, 4, 3, 1, 1, 0))
        # Counted where each was read: the closer's list, read first, brought in the call the two shared.
        self.assertEqual((out["per_seat"][SETTER]["dials"], out["per_seat"][CLOSER]["dials"]), (2, 2))
        for held in (str(REF + 1), str(REF + 5)):
            self.assertEqual((self.pg.one(DIALS, call_id=held)["origin"],
                              self.pg.one(DIALS, call_id=held)["agent_name"]), ("b2b", "From B2B"))
        self.assertIsNone(self.pg.one(DIALS, call_id=str(REF + 2)))
        self.assertIsNone(self.pg.one(DIALS, call_id=str(REF + 8)))
        closer = self.pg.one(DIALS, call_id=str(REF + 7))
        self.assertEqual({k: closer[k] for k in ("agent_email", "sales_rep_id", "direction", "state", "origin",
                                                 "lead_phone8", "lead_digits", "has_transcript", "tags")},
                         {"agent_email": CLOSER, "sales_rep_id": None, "direction": "inbound", "state": "serviced",
                          "origin": "maqsam", "lead_phone8": "70003333", "lead_digits": "96570003333",
                          "has_transcript": True, "tags": []})
        # The call two seats handled is one dial, credited as its recording is, with the setter's rep id.
        shared = self.pg.one(DIALS, call_id=str(REF + 6))
        self.assertEqual((shared["agent_email"], shared["sales_rep_id"]), (SETTER, "r1"))
        self.assertEqual((self.pg.one(DIALS, call_id=str(REF + 3))["has_transcript"],
                          self.pg.one(DIALS, call_id=str(REF + 3))["state"]), (False, "busy"))
        self.assertIn("4 calls added to the dial log (1 on a Maqsam address no rep carries", out["dials_said"])
        self.assertIn("1 left out with no reference id or time", out["dials_said"])

    def test_a_setters_calls_are_left_to_b2b_and_a_closers_go_in(self):
        # B2B copies its setters' calls itself; a call it has not copied yet
        # must not go in under Maqsam's other id and be counted twice.
        self.pg.put("cockpit_sales_reps", {"id": "r3", "maqsam_email": "setter.two@maharamedia.com",
                                           "role": "setter", "ghl_user_id": "u3"})
        self.pg.put("cockpit_sales_people", {"email": "setter.two@maharamedia.com",
                                             "maqsam_email": "setter.two@maharamedia.com"})
        mq = FakeMaqsam({
            "setter.two@maharamedia.com": [call(11, agent="setter.two@maharamedia.com")],
            CLOSER: [call(12, agent=CLOSER)],
        })
        out = self.run_it(mq)
        self.assertIsNone(self.pg.one(DIALS, call_id=str(REF + 11)))
        self.assertEqual(self.pg.one(DIALS, call_id=str(REF + 12))["origin"], "maqsam")
        self.assertEqual(out["dials"]["b2b_keeps"], 1)
        self.assertIn("1 left to B2B's own copy", out["dials_said"])

    def test_a_second_run_adds_nothing_and_changes_nothing(self):
        mq = FakeMaqsam({SETTER: [call(1), call(2)]})
        self.run_it(mq)
        self.pg.one(DIALS, call_id=str(REF + 1))["contact_id"] = "c-linked"  # what cockpit_sales_link_dials does
        out = self.run_it(FakeMaqsam({SETTER: [call(1), call(2)]}), now=NOW + timedelta(hours=1))
        self.assertEqual((out["dials"]["new"], out["dials"]["held"]), (0, 2))
        self.assertEqual(self.pg.one(DIALS, call_id=str(REF + 1))["contact_id"], "c-linked")
        self.assertEqual(len(self.pg.rows(DIALS)), 2)

    def test_a_dial_log_that_cannot_be_written_keeps_the_mark_and_stops_no_recording(self):
        def dials_down(method, url, **kw):
            if method == "POST" and "/rest/v1/cockpit_sales_dials" in url:
                raise http.HttpError(503, "the dial log is down")
            return self.pg(method, url, **kw)

        with mock.patch.object(http, "request", dials_down):
            out = maqsam_calls.run(self.sb, FakeMaqsam({SETTER: [call(1)], CLOSER: [call(7, agent=CLOSER)]}),
                                   lambda _m: None, now=NOW)
        self.assertEqual((out["rows"], out["stored"], out["seats_unread"]), (2, 2, []))
        self.assertEqual(sorted(out["dials"]["errors"]), [CLOSER, SETTER])
        self.assertFalse(out["mark_written"])
        self.assertIn("could not add", out["dials_said"])


class DialCheck(RunCase):
    """Maqsam's count per seat and Kuwait day, against the dial log's."""

    def test_each_seat_and_kuwait_day_sets_maqsams_calls_against_the_log(self):
        utc = timezone.utc
        nothing = call(15, at=datetime(2026, 9, 23, 10, 0, tzinfo=utc))
        nothing["referenceId"] = None  # Maqsam has it; the log cannot
        mq = FakeMaqsam({SETTER: [
            call(11, at=datetime(2026, 9, 25, 22, 30, tzinfo=utc)),  # 01:30 on the 26th in Kuwait
            call(12, at=datetime(2026, 9, 25, 20, 0, tzinfo=utc)),   # 23:00 on the 25th
            call(13, at=datetime(2026, 9, 24, 10, 0, tzinfo=utc)),
            call(14, at=datetime(2026, 9, 10, 10, 0, tzinfo=utc)),   # before the seven days
            nothing]}, fail={CLOSER: maqsam_calls.MaqsamError(500, "Maqsam answered 500")})
        # A call B2B holds for the setter that Maqsam does not list.
        self.pg.put(DIALS, {"call_id": "258000099", "agent_email": SETTER, "occurred_at": "2026-09-24T15:00:00Z",
                            "origin": "b2b"})
        out = self.run_it(mq)
        rows = {r["day"]: (r["maqsam_calls"], r["copied_calls"]) for r in self.pg.rows(CHECKS)
                if r["agent_email"] == SETTER}
        self.assertEqual(rows, {"2026-09-20": (0, 0), "2026-09-21": (0, 0), "2026-09-22": (0, 0),
                                "2026-09-23": (1, 0), "2026-09-24": (1, 2), "2026-09-25": (1, 1),
                                "2026-09-26": (1, 1)})
        # The closer's calls could not be read: no row says they made none.
        self.assertEqual({r["agent_email"] for r in self.pg.rows(CHECKS)}, {SETTER})
        check = out["dial_check"]
        self.assertEqual((check["maqsam"], check["copied"], check["written"]), (4, 4, 7))
        self.assertEqual((check["short"], check["over"]),
                         ([{"agent": SETTER, "day": "2026-09-23", "maqsam": 1, "copied": 0}],
                          [{"agent": SETTER, "day": "2026-09-24", "maqsam": 1, "copied": 2}]))
        self.assertIn("dial check 2026-09-20 to 2026-09-26 (Kuwait): Maqsam has 4, the log 4", out["dials_said"])
        self.assertIn(f"{SETTER} 2026-09-23 0 of 1", out["dials_said"])
        self.assertIn(f"not checked (Maqsam not read): {CLOSER}", out["dials_said"])

    def test_only_the_days_the_window_read_whole_and_a_dry_run_writes_none(self):
        self.assertEqual(maqsam_calls.check_days(NOW - timedelta(days=2), NOW), [date(2026, 9, 25), date(2026, 9, 26)])
        out = self.run_it(FakeMaqsam({SETTER: [call(1)]}), days=2)
        self.assertEqual(sorted({r["day"] for r in self.pg.rows(CHECKS)}), ["2026-09-25", "2026-09-26"])
        self.assertEqual(out["dial_check"]["days"], ["2026-09-25", "2026-09-26"])
        self.pg.tables[CHECKS].clear()
        out = self.run_it(FakeMaqsam({SETTER: [call(1)]}), dry=True)
        self.assertEqual((self.pg.rows(CHECKS), out["dial_check"]["seats"]), ([], 2))


class Marking(RunCase):
    def test_a_run_marks_duplicates_and_stubs_once_and_says_how_many(self):
        asked = []
        self.pg.rpcs["cockpit_sales_mark_recordings"] = lambda body: asked.append(body) or 2
        out = self.run_it(FakeMaqsam({SETTER: [call(1)]}))
        self.assertEqual((asked, out["marked"]), ([{}], 2))
        out = self.run_it(FakeMaqsam({SETTER: [call(1)]}), dry=True)
        self.assertEqual((len(asked), out["marked"]), (1, None))

    def test_a_marking_that_fails_is_said_and_the_calls_stay_in(self):
        said: list[str] = []
        out = self.run_it(FakeMaqsam({SETTER: [call(1)]}), log=said.append)  # no such function: a 404
        self.assertIsNone(out["marked"])
        self.assertTrue(any("duplicates and stubs were not marked" in s for s in said))
        self.assertTrue(out["mark_written"])
        self.assertIsNotNone(self.pg.one("cockpit_sales_recordings", recording_id="maqsam:1"))


class Command(RunCase):
    def test_the_command_says_the_dial_log_and_its_check_on_its_line_and_on_the_status_row(self):
        spec = importlib.util.spec_from_file_location("desk_cli", Path(__file__).resolve().parents[1] / "desk.py")
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        recent = call(1, at=datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=2))
        env = {"SALES_DESK_HOME": tempfile.mkdtemp(), "DESK_SUPABASE_URL": "https://example.supabase.co",
               "DESK_SUPABASE_KEY": "service-test", "MAQSAM_ACCESS_KEY": "access-id", "MAQSAM_SECRET": "secret-value"}
        out = io.StringIO()
        with mock.patch.dict(os.environ, env), mock.patch.object(http, "request", self.pg), \
                mock.patch.object(maqsam_calls, "Maqsam", lambda *_a, **_k: FakeMaqsam({SETTER: [recent]})), \
                contextlib.redirect_stdout(out):
            self.assertEqual(cli.main(["--quiet", "maqsam-calls"]), 0)
        row = self.pg.one("cockpit_sales_worker_status", worker="sales-desk", job="maqsam-calls")
        for said in (out.getvalue(), row["detail"]):
            self.assertIn("1 call added to the dial log; dial check ", said)
            self.assertIn("Maqsam has 1, the log 1", said)
        self.assertTrue(row["ok"])


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
