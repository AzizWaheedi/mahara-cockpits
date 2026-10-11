"""One invoice from queued to issued.

The steps, each recorded on the row as it lands so a retry reads back instead
of repeating it:
  1. number    INV-<year>-### above every number on the register and in the table
  2. folder    the client's Drive folder (saved, or one exact name match)
  3. render    the template, filled, printed by Chrome, one page, fonts embedded
  4. upload    a new file, or the same file replaced (unlock, replace, lock)
  5. register  the row for this number, appended once or rewritten in place
  6. finish    issued, with the number and the link
A problem the person can fix ends the invoice as failed, with a sentence that
says what to do. A passing fault (Google or Chrome down) leaves the lease to
run out, and the next run picks the invoice up again, five times at most.
"""
from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from . import build, http, render
from .config import Config
from .google import FOLDER, Google
from .supa import Supa

VERSION = "invoice-desk 2026-10-11"


class Problem(Exception):
    """Ends the invoice as failed. The message is shown on the invoices page."""


class Passing(Exception):
    """A fault that may clear by itself. The invoice is tried again later."""


def print_pdf(html: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="invoice-") as tmp:
        page = Path(tmp) / "invoice.html"
        out = Path(tmp) / "invoice.pdf"
        page.write_text(html, encoding="utf-8")
        if not render.pdf(page, out) or not out.exists():
            raise Passing("Chrome did not print the invoice.")
        return out.read_bytes()


def passing(error: Exception) -> bool:
    return isinstance(error, Passing) or (isinstance(error, http.HttpError) and (error.status == 0 or error.status == 429 or error.status >= 500))


@dataclass
class Desk:
    supa: Supa
    google: Google
    cfg: Config
    template: str
    render: Callable[[str], bytes] = print_pdf
    log: Callable[[str], None] = print

    # 1 ---------------------------------------------------------------------
    def number(self, inv: dict[str, Any]) -> str:
        if inv.get("invoice_no"):
            return inv["invoice_no"]
        year = int(str(inv["issue_date"])[:4])
        for _ in range(3):
            candidate = build.next_number(year, self.google.column_a(self.cfg.register_sheet, self.cfg.register_tab),
                                          self.supa.numbers_used(year))
            try:
                return self.supa.progress(inv["id"], {"invoiceNo": candidate})["invoice_no"]
            except http.HttpError as e:
                if e.status == 409 or "23505" in str(e):
                    continue
                raise
        raise Problem("Another invoice took the same number three times in a row. Press Try again.")

    # 2 ---------------------------------------------------------------------
    def folder(self, inv: dict[str, Any]) -> str:
        client, task = inv["client_name"], inv["clickup_task_id"]
        saved = self.supa.folder_for(task)
        if saved:
            found = self.google.folder(saved["folder_id"])
            if not found or found.get("trashed") or found.get("mimeType") != FOLDER:
                raise Problem(f"The Drive folder saved for {client} is missing or is not a folder. "
                              "Ask an admin to paste the client's folder link on this invoice, then press Try again.")
            if not (found.get("capabilities") or {}).get("canAddChildren"):
                raise Problem(f"The invoice worker cannot add files to the Drive folder saved for {client}. "
                              "Ask an admin to share it with the worker's Google account, or to paste another folder link.")
            return saved["folder_id"]
        matches: list[dict[str, Any]] = []
        for name in (f"Mahara - {client}", f"{client} - Workspace"):
            matches = self.google.folders_named(name)
            if matches:
                break
        if len(matches) == 1:
            self.supa.save_folder(task, client, matches[0]["id"], matches[0]["name"])
            return matches[0]["id"]
        if not matches:
            raise Problem(f'No Drive folder named "Mahara - {client}" was found. '
                          "Ask an admin to paste the client's folder link on this invoice, then press Try again.")
        raise Problem(f'{len(matches)} Drive folders are named "{matches[0]["name"]}". '
                      "Ask an admin to paste the right folder link on this invoice, then press Try again.")

    # 4 ---------------------------------------------------------------------
    def upload(self, inv: dict[str, Any], number: str, folder_id: str, pdf: bytes) -> dict[str, Any]:
        name = build.file_name(number, inv["client_name"])
        existing: Optional[dict[str, Any]] = None
        if inv.get("drive_file_id"):
            existing = self.google.file(inv["drive_file_id"])
            if existing and existing.get("trashed"):
                existing = None
        if existing is None:
            existing = self.google.file_in_folder(folder_id, name)
        if existing is not None:
            # A locked file refuses a new version, so the lock comes off first.
            self.google.set_lock(existing["id"], False, "")
            uploaded = self.google.replace_pdf(existing["id"], pdf)
        else:
            uploaded = self.google.create_pdf(folder_id, name, pdf)
            self.supa.progress(inv["id"], {"driveFileId": uploaded["id"], "driveUrl": uploaded["webViewLink"]})
            self.google.share_by_link(uploaded["id"])
        self.google.set_lock(uploaded["id"], True, build.LOCK_REASON)
        self.supa.progress(inv["id"], {"driveFileId": uploaded["id"], "driveUrl": uploaded["webViewLink"]})
        return uploaded

    # 5 ---------------------------------------------------------------------
    def register(self, inv: dict[str, Any], number: str, link: str) -> int:
        row = build.register_row(inv, number, link)
        column = self.google.column_a(self.cfg.register_sheet, self.cfg.register_tab)
        if number in column:
            at = column.index(number) + 1
            self.google.write_row(self.cfg.register_sheet, self.cfg.register_tab, at, row)
        else:
            at = self.google.append_row(self.cfg.register_sheet, self.cfg.register_tab, row)
        self.supa.progress(inv["id"], {"registerRow": at})
        return at

    # all -------------------------------------------------------------------
    def process(self, inv: dict[str, Any]) -> str:
        """Returns 'issued', 'failed' or 'later'."""
        http.current_invoice = inv["id"]
        try:
            number = self.number(inv)
            folder_id = self.folder(inv)
            pdf = self.render(build.fill(inv, number, self.template))
            problems = build.pdf_problems(pdf)
            if problems:
                raise Problem(" ".join(problems))
            uploaded = self.upload(inv, number, folder_id, pdf)
            self.register(inv, number, uploaded["webViewLink"])
            self.supa.finish(inv["id"], True)
            self.log(f"issued {number} for {inv['client_name']}")
            return "issued"
        except (Problem, build.BuildError) as e:
            self.supa.finish(inv["id"], False, str(e))
            self.log(f"failed {inv['id']}: {e}")
            return "failed"
        except Exception as e:  # noqa: BLE001
            if passing(e):
                self.log(f"later {inv['id']}: {http.scrub(e)}")
                return "later"
            sentence = (f"The invoice could not be made ({http.scrub(e)[:160]}). "
                        "Press Try again, or tell Muhammed.")
            self.supa.finish(inv["id"], False, sentence)
            self.log(f"failed {inv['id']}: {http.scrub(e)}")
            return "failed"
        finally:
            http.current_invoice = None


@dataclass
class Ledger:
    """Collects every Google call in a run for cockpit_invoice_desk_health."""
    rows: list[dict[str, Any]] = field(default_factory=list)

    def __call__(self, method: str, url: str, status: Optional[int], ok: bool, detail: str) -> None:
        parts = urlsplit(url)
        host = parts.netloc
        if "googleapis.com" not in host:
            return
        provider = "google_sheets" if host.startswith("sheets.") else "google_drive"
        resource = "/".join(p for p in parts.path.split("/")[:4] if p)
        self.rows.append({"invoice_id": http.current_invoice, "provider": provider, "method": method,
                          "resource": resource, "http_status": status, "ok": ok, "detail": detail or None})
