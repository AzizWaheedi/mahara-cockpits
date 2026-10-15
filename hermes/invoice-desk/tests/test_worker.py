"""The worker's steps against fakes: numbering, folders, upload, register,
and what a fault does to the invoice. No network, no Chrome.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from typing import Any, Optional

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from desk import build, http  # noqa: E402
from desk.config import Config  # noqa: E402
from desk.worker import Desk, Ledger  # noqa: E402

PAID = json.loads((HERE / "golden" / "cases.json").read_text(encoding="utf-8"))[0]["invoice"]
GOOD_PDF = b"%PDF-1.4 /Type /Page /FontFamily (Geist) /FontFamily (Geist Mono)"


class FakeSupa:
    def __init__(self, folder: Optional[dict] = None, used: Optional[list[str]] = None, conflicts: int = 0):
        self.saved_folder = folder
        self.used = used or []
        self.conflicts = conflicts
        self.row: dict[str, Any] = {}
        self.finished: Optional[tuple[bool, Optional[str]]] = None
        self.calls: list[str] = []

    def numbers_used(self, year: int) -> list[str]:
        return self.used

    def progress(self, invoice_id: str, patch: dict) -> dict:
        self.calls.append("progress:" + ",".join(sorted(patch)))
        if "invoiceNo" in patch and self.conflicts:
            self.conflicts -= 1
            self.used.append(patch["invoiceNo"])
            raise http.HttpError(409, '{"code":"23505","message":"duplicate key"}')
        if "invoiceNo" in patch:
            self.row.setdefault("invoice_no", patch["invoiceNo"])
        self.row.update({k: v for k, v in patch.items() if k != "invoiceNo"})
        return {"invoice_no": self.row.get("invoice_no")}

    def finish(self, invoice_id: str, ok: bool, error: Optional[str] = None) -> dict:
        self.finished = (ok, error)
        return {}

    def folder_for(self, task_id: str) -> Optional[dict]:
        return self.saved_folder

    def save_folder(self, task_id, client, folder_id, folder_name):
        self.saved_folder = {"folder_id": folder_id}
        self.calls.append(f"save_folder:{folder_id}")
        return self.saved_folder


class FakeGoogle:
    def __init__(self, register: Optional[list[str]] = None, named: Optional[dict[str, list]] = None,
                 files: Optional[dict[str, dict]] = None, fail: Optional[Exception] = None):
        self.register = register if register is not None else ["Invoice #", "INV-2026-023", "INV-2026-024"]
        self.named = named or {}
        self.files = files or {}
        self.fail = fail
        self.calls: list[str] = []
        self.rows: dict[int, list] = {}

    def column_a(self, sheet, tab):
        return list(self.register)

    def folder(self, folder_id):
        return {"id": folder_id, "mimeType": "application/vnd.google-apps.folder", "capabilities": {"canAddChildren": True}}

    def folders_named(self, name):
        return self.named.get(name, [])

    def file(self, file_id):
        return self.files.get(file_id)

    def file_in_folder(self, folder_id, name):
        return next((f for f in self.files.values() if f["name"] == name), None)

    def create_pdf(self, folder_id, name, pdf):
        if self.fail:
            raise self.fail
        self.calls.append(f"create:{name}")
        f = {"id": "new1", "name": name, "webViewLink": "https://drive.google.com/file/d/new1/view"}
        self.files["new1"] = f
        return f

    def replace_pdf(self, file_id, pdf):
        self.calls.append(f"replace:{file_id}")
        return self.files[file_id]

    def set_lock(self, file_id, locked, reason):
        self.calls.append(f"lock:{file_id}:{locked}")

    def share_by_link(self, file_id):
        self.calls.append(f"share:{file_id}")

    def append_row(self, sheet, tab, row):
        self.register.append(row[0])
        self.rows[len(self.register)] = row
        self.calls.append(f"append:{row[0]}")
        return len(self.register)

    def write_row(self, sheet, tab, at, row):
        self.rows[at] = row
        self.calls.append(f"write:{at}")


CFG = Config("https://x.supabase.co", "k", "key.json", "sheet", "07: Invoice Register")


def desk(supa, google, pdf=GOOD_PDF) -> Desk:
    return Desk(supa=supa, google=google, cfg=CFG, template=build.TEMPLATE.read_text(encoding="utf-8"),
                render=lambda html: pdf, log=lambda s: None)


def fresh(**over: Any) -> dict:
    return {**PAID, "invoice_no": None, "drive_file_id": None, "register_row": None, **over}


class Steps(unittest.TestCase):
    def test_issues_a_new_invoice_end_to_end(self):
        supa = FakeSupa(folder={"folder_id": "folderShades123"})
        google = FakeGoogle()
        self.assertEqual(desk(supa, google).process(fresh()), "issued")
        self.assertEqual(supa.row["invoice_no"], "INV-2026-025")
        self.assertEqual(google.calls, ["create:INV-2026-025 - Shades Interior Design & General Contracting.pdf",
                                        "share:new1", "lock:new1:True", "append:INV-2026-025"])
        self.assertEqual(supa.row["registerRow"], 4)
        self.assertEqual(supa.finished, (True, None))

    def test_a_taken_number_moves_to_the_next(self):
        supa = FakeSupa(folder={"folder_id": "folderShades123"}, conflicts=1)
        desk(supa, FakeGoogle()).process(fresh())
        self.assertEqual(supa.row["invoice_no"], "INV-2026-026")

    def test_a_retry_replaces_the_same_file_and_rewrites_the_same_row(self):
        supa = FakeSupa(folder={"folder_id": "folderShades123"})
        name = "INV-2026-025 - Shades Interior Design & General Contracting.pdf"
        google = FakeGoogle(register=["Invoice #", "INV-2026-024", "INV-2026-025"],
                            files={"f25": {"id": "f25", "name": name, "webViewLink": "https://drive.google.com/file/d/f25/view"}})
        result = desk(supa, google).process(fresh(invoice_no="INV-2026-025", drive_file_id="f25"))
        self.assertEqual(result, "issued")
        self.assertEqual(google.calls, ["lock:f25:False", "replace:f25", "lock:f25:True", "write:3"])
        self.assertNotIn("progress:invoiceNo", supa.calls)

    def test_a_file_already_in_the_folder_is_found_by_name_not_uploaded_twice(self):
        supa = FakeSupa(folder={"folder_id": "folderShades123"})
        name = "INV-2026-025 - Shades Interior Design & General Contracting.pdf"
        google = FakeGoogle(files={"f25": {"id": "f25", "name": name, "webViewLink": "https://drive.google.com/file/d/f25/view"}})
        desk(supa, google).process(fresh(invoice_no="INV-2026-025"))
        self.assertNotIn("create", " ".join(google.calls))
        self.assertIn("replace:f25", google.calls)

    def test_one_exact_folder_name_is_saved_for_next_time(self):
        supa = FakeSupa()
        google = FakeGoogle(named={"Mahara - Shades Interior Design & General Contracting": [{"id": "folderX12345", "name": "Mahara - Shades"}]})
        self.assertEqual(desk(supa, google).process(fresh()), "issued")
        self.assertIn("save_folder:folderX12345", supa.calls)

    def test_no_folder_or_two_folders_fail_with_a_sentence(self):
        supa = FakeSupa()
        self.assertEqual(desk(supa, FakeGoogle()).process(fresh()), "failed")
        self.assertIn("No Drive folder named", supa.finished[1])
        self.assertIn("paste the client's folder link", supa.finished[1])
        supa = FakeSupa()
        two = [{"id": "a1234567890", "name": "Mahara - Shades"}, {"id": "b1234567890", "name": "Mahara - Shades"}]
        desk(supa, FakeGoogle(named={"Mahara - Shades Interior Design & General Contracting": two})).process(fresh())
        self.assertIn("2 Drive folders are named", supa.finished[1])

    def test_a_two_page_pdf_is_never_uploaded(self):
        supa = FakeSupa(folder={"folder_id": "folderShades123"})
        google = FakeGoogle()
        result = desk(supa, google, pdf=GOOD_PDF + b" /Type /Page ").process(fresh())
        self.assertEqual(result, "failed")
        self.assertIn("must fit on one", supa.finished[1])
        self.assertEqual([c for c in google.calls if c.startswith("create")], [])

    def test_google_down_leaves_the_invoice_for_the_next_run(self):
        supa = FakeSupa(folder={"folder_id": "folderShades123"})
        google = FakeGoogle(fail=http.HttpError(503, "backend error"))
        self.assertEqual(desk(supa, google).process(fresh()), "later")
        self.assertIsNone(supa.finished)

    def test_an_unexpected_refusal_fails_with_the_reason(self):
        supa = FakeSupa(folder={"folder_id": "folderShades123"})
        google = FakeGoogle(fail=http.HttpError(403, "The user does not have sufficient permissions"))
        self.assertEqual(desk(supa, google).process(fresh()), "failed")
        self.assertIn("sufficient permissions", supa.finished[1])
        self.assertIn("Press Try again", supa.finished[1])


class Ledgers(unittest.TestCase):
    def test_google_calls_are_recorded_without_query_strings(self):
        ledger = Ledger()
        http.current_invoice = "inv-1"
        ledger("GET", "https://www.googleapis.com/drive/v3/files?q=name%3D%27Secret%20Client%27", 200, True, "")
        ledger("POST", "https://x.supabase.co/rest/v1/rpc/cockpit_invoice_claim", 200, True, "")
        http.current_invoice = None
        self.assertEqual(ledger.rows, [{"invoice_id": "inv-1", "provider": "google_drive", "method": "GET",
                                        "resource": "drive/v3/files", "http_status": 200, "ok": True, "detail": None}])

    def test_secrets_are_scrubbed(self):
        self.assertNotIn("abc123", http.scrub("Authorization: Bearer abc123"))
        self.assertNotIn("PRIVATE", http.scrub("-----BEGIN PRIVATE KEY-----\nxyz\n-----END PRIVATE KEY-----"))


if __name__ == "__main__":
    unittest.main()
