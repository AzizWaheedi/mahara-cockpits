#!/usr/bin/env python3
"""scripts/dev/wins_backfill.py on saved reads (docs/forms/WAVE56-CONTRACT.md 4.2.4 and 8): nothing reaches Typeform
or the database, every folder is a temporary one, and every value is invented. Python 3.9:
python3 -m unittest scripts/dev/test_wins_backfill.py"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wins_backfill as wb  # noqa: E402

NAMES = ("Acme Interiors Example", "Beta Build Example", "Secret Person Example")


def definition(form: str) -> dict:
    return {"id": form, "fields": [
        {"id": "f1", "ref": "biz", "title": "Business name"},
        {"id": "f2", "ref": "link", "title": "Review link"},
        {"id": "f3", "ref": "price", "title": "Upsell price (USD)"},
        {"id": "f4", "ref": "cu", "title": "ClickUp task id"},
        {"id": "g1", "ref": "group", "title": "More", "properties": {"fields": [{"id": "f5", "ref": "who", "title": "Your name"}]}},
    ]}


def response(rid: str, at: str, *, hidden: dict = None, biz: str = None, link: str = None, price: float = None, cu: str = None) -> dict:
    answers = [{"type": "text", "text": "Secret Person Example", "field": {"id": "f5", "ref": "who", "type": "short_text"}}]
    if biz:
        answers.append({"type": "text", "text": biz, "field": {"id": "f1", "ref": "biz", "type": "short_text"}})
    if link:
        answers.append({"type": "url", "url": link, "field": {"id": "f2", "ref": "link", "type": "website"}})
    if price is not None:
        answers.append({"type": "number", "number": price, "field": {"id": "f3", "ref": "price", "type": "number"}})
    if cu:
        answers.append({"type": "text", "text": cu, "field": {"id": "f4", "ref": "cu", "type": "short_text"}})
    return {"response_id": rid, "token": rid, "submitted_at": at, "hidden": hidden or {}, "answers": answers}


def saved(folder: Path, counts: dict) -> None:
    """counts[form] responses per form: the first by hidden ClickUp id, then by business name, the last with neither."""
    for form, n in counts.items():
        items = []
        for i in range(n):
            if i == 0:
                items.append(response(f"{form}r{i}", "2026-05-05T22:30:00Z", hidden={"clickup_id": "86abc1234"},
                                      link="https://g.page/r/review-example", price=2500))
            elif i == n - 1 and n > 2:
                items.append(response(f"{form}r{i}", "2026-05-06T09:00:00Z"))
            else:
                items.append(response(f"{form}r{i}", "2026-05-06T09:00:00Z", biz=NAMES[i % 2], link="http://not-https.example.test"))
        (folder / f"{form}.definition.json").write_text(json.dumps(definition(form)))
        (folder / f"{form}.responses.json").write_text(json.dumps({"items": items}))


class WinsBackfill(unittest.TestCase):
    def run_main(self, args: list, env: dict = None) -> tuple:
        lines: list = []
        code = wb.main(args, env={} if env is None else env, out=lines.append)
        return code, lines

    def test_dry_prints_counts_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved(Path(tmp), wb.EXPECTED)
            code, lines = self.run_main(["--dry", "--from-dir", tmp])
            self.assertEqual(code, 0)
            text = "\n".join(lines)
            for secret in (*NAMES, "86abc1234", "review-example", "2500"):
                self.assertNotIn(secret, text)
            self.assertEqual(lines[0], "ETEynRgb review: read 4; 1 with a card id, 2 with a business name only, 1 with neither (no card), 0 unreadable")
            self.assertEqual(lines[-2], "total read 35")
            self.assertEqual(lines[-1], "dry run: nothing written")
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), sorted(
                [f"{f}.definition.json" for f in wb.FORMS] + [f"{f}.responses.json" for f in wb.FORMS]))

    def test_a_different_count_is_reported_not_forced(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved(Path(tmp), {**wb.EXPECTED, "VP3zmaj2": 11})
            code, lines = self.run_main(["--dry", "--from-dir", tmp])
            self.assertEqual(code, 0)
            self.assertIn("VP3zmaj2 upsell_website: read 11; differs from the expected 12;", "\n".join(lines))
            self.assertEqual(lines[-2], "total read 34; differs from the expected 35")

    def test_rows_map_each_response(self):
        titles = wb.field_titles(definition("VP3zmaj2"))
        self.assertEqual(titles["who"], "Your name")  # a group's fields are read too
        first = wb.map_response("VP3zmaj2", response("r1", "2026-05-11T21:30:00Z", hidden={"clickup_id": "86abc1234"},
                                                     link="https://site.example.test/proof", price=2500), titles)
        self.assertEqual(first, {"importedFrom": "typeform:VP3zmaj2:r1", "kind": "upsell_website", "wonOn": "2026-05-12",
                                 "clickupId": "86abc1234", "businessName": None, "proofUrl": "https://site.example.test/proof",
                                 "quotedUsd": 2500.0, "note": "Imported from the old Typeform (pre-cockpit history)."})
        typed = wb.map_response("bAmbMKM2", response("r2", "2026-05-06T09:00:00Z", biz="  Beta   Build  ", cu="86xyz9876",
                                                     link="http://plain.example.test"), wb.field_titles(definition("bAmbMKM2")))
        self.assertEqual([typed["kind"], typed["clickupId"], typed["businessName"], typed["proofUrl"]],
                         ["referral", "86xyz9876", "Beta Build", None])
        self.assertIsNone(wb.map_response("ETEynRgb", {"response_id": "", "submitted_at": "2026-05-05T10:00:00Z"}, {}))
        self.assertIsNone(wb.map_response("ETEynRgb", {"response_id": "r3", "submitted_at": "not a day"}, {}))

    def test_out_writes_the_import_and_its_owner_sql(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved(Path(tmp), wb.EXPECTED)
            target = Path(tmp) / "import.json"
            code, lines = self.run_main(["--out", str(target), "--from-dir", tmp])
            self.assertEqual(code, 0)
            payload = json.loads(target.read_text())
            self.assertEqual(len(payload["rows"]), 35)
            self.assertEqual({r["kind"] for r in payload["rows"]}, set(wb.FORMS.values()))
            self.assertTrue(all(r["importedFrom"].startswith("typeform:") for r in payload["rows"]))
            sql = Path(str(target) + ".sql").read_text()
            self.assertTrue(sql.startswith("SELECT public.cockpit_csm_win_import($wins${"))
            self.assertTrue(sql.endswith("$wins$::jsonb);\n"))
            self.assertEqual(oct(target.stat().st_mode & 0o777), "0o600")
            for secret in NAMES:
                self.assertNotIn(secret, "\n".join(lines))
            self.assertIn("wrote 35 rows", lines[-1])

    def test_no_mode_and_no_token_stop_with_a_sentence(self):
        code, lines = self.run_main([])
        self.assertEqual((code, lines), (2, ["Say --dry to count, or --out FILE to write the import for the deploy."]))
        with self.assertRaises(wb.Stop) as e:
            wb.LiveReader({}, {})
        self.assertIn("No Typeform token", str(e.exception))
        with self.assertRaises(wb.Stop) as e:
            wb.LiveReader({"TYPEFORM_API_TOKEN": "tfp_secretvalue123456"}, {})
        self.assertNotIn("tfp_secretvalue123456", str(e.exception))

    def test_a_live_read_writes_its_receipt_before_the_call(self):
        calls: list = []
        reader = wb.LiveReader({"TYPEFORM_API_TOKEN": "tfp_secretvalue123456"}, {"SUPABASE_URL": "https://db.example.test",
                                                                                 "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_example1234"})
        original = wb.http

        def fake(method, url, headers, body=None):
            calls.append((method, url.split("?")[0], (body or {}).get("phase")))
            if url.startswith("https://db.example.test"):
                return (500, "") if len(calls) == 1 else (201, "")
            return 200, json.dumps({"items": []})

        wb.http = fake
        try:
            with self.assertRaises(wb.Stop) as e:
                reader.definition("ETEynRgb")
            self.assertIn("could not be saved, so the call was not made", str(e.exception))
            self.assertEqual(calls, [("POST", "https://db.example.test/rest/v1/cockpit_csm_provider_health", "intent")])
            self.assertEqual(reader.responses("ETEynRgb"), [])
            self.assertEqual([c[2] for c in calls[1:]], ["intent", None, "response"])
        finally:
            wb.http = original


if __name__ == "__main__":
    unittest.main()
