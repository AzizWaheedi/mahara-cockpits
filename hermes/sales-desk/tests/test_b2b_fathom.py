"""Ahmed's B2B-only Fathom calls copied into the cockpit, tested on invented
calls. Every name, address and line here is made up.

    python3 -m unittest tests.test_b2b_fathom
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import b2b_fathom, http, recordings  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakeFathom, FakePostgrest  # noqa: E402

REP = "rep.two@maharamedia.com"


def b2b_call(rid: int, *, title: str = "مكالمة حصول المشاريع", domains: str = "one_or_more_external",
             lead: Any = None, appointment: Any = None, method: Any = None, turns: int = 2) -> dict[str, Any]:
    return {
        "recording_id": str(rid), "title": title, "meeting_title": None, "recorded_by_email": REP.upper(),
        "scheduled_start_time": None, "recording_start_time": "2026-07-01T10:00:00+00:00",
        "recording_end_time": "2026-07-01T10:40:00+00:00", "duration_seconds": None,
        "transcript_language": "ar",
        "transcript": [{"speaker": {"display_name": "Rep Two"}, "text": f"Line {i} of the call.",
                        "timestamp": f"00:00:{i:02d}"} for i in range(turns)],
        "summary_md": "## Meeting Purpose\n\nTo show the offer.\n\n### Price\n\n- Monthly",
        "action_items": [{"description": "Send the deck", "completed": False}],
        "invitees": [{"name": "Rep Two", "email": REP, "is_external": False}],
        "share_url": f"https://fathom.video/share/test-{rid}",
        "lead_contact_id": lead, "ghl_appointment_id": appointment, "match_method": method,
        "invitees_domains_type": domains, "outside_emails": 0,
    }


class FakeB2B:
    """Answers the two SELECTs b2b_fathom sends: the listing, then full rows by id."""

    def __init__(self, calls: list[dict[str, Any]]):
        self.calls = {c["recording_id"]: c for c in calls}
        self.sql: list[str] = []

    def query(self, sql: str) -> list[dict[str, Any]]:
        self.sql.append(sql)
        if "lower(recorded_by_email) in" in sql:
            who = set(re.findall(r"'([^']+)'", sql))
            keys = ("recording_id", "title", "invitees_domains_type", "lead_contact_id", "outside_emails")
            return [{k: c[k] for k in keys} for c in self.calls.values() if c["recorded_by_email"].lower() in who]
        ids = re.search(r"recording_id in \(([^)]*)\)", sql).group(1).split(", ")
        return [dict(self.calls[i]) for i in ids if i in self.calls]


class Copy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)
        (self.vault / "Calls" / "2026").mkdir(parents=True)
        (self.vault / "Calls" / "2026" / "a.md").write_text("---\nrecording_id: 13\nkind: team\n---\n# X\n",
                                                           encoding="utf-8")
        self.pg = FakePostgrest()
        self.pg.put("cockpit_sales_recordings", {"recording_id": "12", "matched_by": "email"})
        self.sb = Supabase("https://example.supabase.co", "service-test")
        self.b2b = FakeB2B([
            b2b_call(11, lead="c-1", appointment="a-1", method="appointment"),
            b2b_call(12),                                   # already in the cockpit
            b2b_call(13),                                   # the vault's to judge
            b2b_call(14, title="Launch call"),              # client service
            b2b_call(15, domains="only_internal"),          # nobody from outside, no lead: a team meeting
            b2b_call(16, title="Impromptu Zoom Meeting"),   # an outsider joined, no lead
            b2b_call(17, turns=0),                          # no transcript: the call still comes in
        ])

    def tearDown(self):
        self.tmp.cleanup()

    def run_it(self, **kw):
        with mock.patch.object(http, "request", self.pg):
            return b2b_fathom.run(
                self.sb, self.b2b, lambda _m: None, emails=[REP], vault=self.vault,
                upload=lambda path, blob: self.sb.upload_to("sales-calls", path, blob, "text/markdown"), **kw)

    def test_only_the_calls_b2b_alone_holds_come_in_in_the_vault_shape(self):
        out = self.run_it()
        self.assertEqual((out["in_b2b"], out["in_cockpit"], out["in_vault"], out["client_service"], out["team"]),
                         (7, 1, 1, 1, 1))
        self.assertEqual((out["rows"], out["stored"], out["with_transcript"], out["by_appointment"],
                          out["unmatched"]), (3, 3, 2, 1, 2))
        a = self.pg.one("cockpit_sales_recordings", recording_id="11")
        self.assertEqual((a["contact_id"], a["appointment_id"], a["matched_by"], a["source"], a["kind"]),
                         ("c-1", "a-1", "appointment", "b2b_fathom", "sales"))
        self.assertEqual((a["recorded_by"], a["duration_s"], a["started_at"]), (REP, 2400, "2026-07-01T10:00:00Z"))
        self.assertTrue(a["summary"].startswith("### Meeting Purpose"))
        self.assertEqual(a["action_items"], "- [ ] Send the deck")
        self.assertEqual(a["transcript_path"], "11.md")
        text = self.pg.objects["sales-calls/11.md"][1].decode()
        self.assertEqual(text.splitlines()[0], "**Rep Two** (00:00:00): Line 0 of the call.")
        self.assertEqual(self.pg.one("cockpit_sales_recordings", recording_id="16")["matched_by"], "none")
        quiet = self.pg.one("cockpit_sales_recordings", recording_id="17")
        self.assertIsNone(quiet.get("transcript_path"))
        for rid in ("13", "14", "15"):
            self.assertIsNone(self.pg.one("cockpit_sales_recordings", recording_id=rid))
        self.assertTrue(all(s.lstrip().lower().startswith("select") for s in self.b2b.sql))

    def test_a_dry_run_writes_nothing_and_a_limit_stops_early(self):
        out = self.run_it(dry=True)
        self.assertEqual((out["rows"], out["stored"]), (3, 0))
        self.assertEqual(self.pg.writes(), [])
        out = self.run_it(limit=1)
        self.assertEqual((out["to_copy"], out["rows"]), (1, 1))

    def test_the_drafter_reads_a_b2b_call_from_the_cockpit_not_from_fathom(self):
        self.run_it()
        self.pg.one("cockpit_sales_recordings", recording_id="11")["started_at"] = "2099-01-01T00:00:00Z"
        f = FakeFathom()
        with mock.patch.object(http, "request", self.pg):
            picked = recordings.pick(self.sb, f, lambda _m: None, contact_id="c-1", min_chars=10)
        self.assertEqual(picked.recording["recording_id"], "11")
        self.assertEqual(picked.text.splitlines()[0], "Rep Two: Line 0 of the call.")
        self.assertEqual(f.read, [])


class Door(unittest.TestCase):
    def test_only_a_single_select_is_ever_sent_and_read_only(self):
        sent = []

        def transport(method, url, **kw):
            sent.append((method, url, json.loads(kw["data"].decode())))
            return 200, {}, b"[]"

        b2b = b2b_fathom.B2B("mgmt-token", transport=transport)
        self.assertEqual(b2b.query("select 1;"), [])
        self.assertEqual(sent[0][2], {"query": "select 1", "read_only": True})
        self.assertIn("/projects/flwboeijllbtrufxkhts/database/query", sent[0][1])
        for sql in ("delete from public.fathom_calls", "select 1; delete from x", "with x as (select 1) select 1"):
            with self.assertRaises(ValueError):
                b2b.query(sql)
        with self.assertRaises(b2b_fathom.B2BError):
            b2b_fathom.B2B("")

    def test_a_refusal_never_carries_the_token(self):
        def transport(method, url, **kw):
            raise http.HttpError(401, 'bad token "Bearer mgmt-token"')

        with self.assertRaises(b2b_fathom.B2BError) as e:
            b2b_fathom.B2B("mgmt-token", transport=transport).query("select 1")
        self.assertNotIn("mgmt-token", str(e.exception))


if __name__ == "__main__":
    unittest.main()
