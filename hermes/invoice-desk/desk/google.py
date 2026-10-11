"""Google Drive and Sheets for the invoice desk, through one service account.

The account is the one make_invoice.py has used since July: it can write the
client folders (shared drives) and the Churn Tracker's register. Every call
goes through http.request, so it lands in the health ledger.
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, Optional

from . import http

DRIVE = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
FOLDER = "application/vnd.google-apps.folder"
SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"]
FILE_FIELDS = "id,name,webViewLink,md5Checksum,trashed,contentRestrictions"
ALL_DRIVES = "supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives"


def service_token(key_file: str) -> str:
    """An access token for the service account. google-auth does the signing."""
    from google.auth.transport.requests import Request
    from google.oauth2.service_account import Credentials

    creds = Credentials.from_service_account_file(key_file, scopes=SCOPES)
    creds.refresh(Request())
    if not creds.token:
        raise RuntimeError("The Google service account returned no token.")
    return creds.token


def _q(text: str) -> str:
    """A value inside a Drive query string."""
    return text.replace("\\", "\\\\").replace("'", "\\'")


class Google:
    def __init__(self, token: str):
        self.h = {"Authorization": f"Bearer {token}"}

    # ------------------------------------------------------------------ drive --
    def folders_named(self, name: str) -> list[dict[str, Any]]:
        q = f"name='{_q(name)}' and mimeType='{FOLDER}' and trashed=false"
        url = f"{DRIVE}?q={http.quote(q)}&fields=files(id,name)&pageSize=10&{ALL_DRIVES}"
        return http.get_json(url, headers=self.h).get("files", [])

    def file_in_folder(self, folder_id: str, name: str) -> Optional[dict[str, Any]]:
        q = f"'{_q(folder_id)}' in parents and name='{_q(name)}' and trashed=false"
        url = f"{DRIVE}?q={http.quote(q)}&fields=files({FILE_FIELDS})&pageSize=5&{ALL_DRIVES}"
        files = http.get_json(url, headers=self.h).get("files", [])
        return files[0] if files else None

    def file(self, file_id: str) -> Optional[dict[str, Any]]:
        try:
            return http.get_json(f"{DRIVE}/{http.quote(file_id)}?fields={FILE_FIELDS}&supportsAllDrives=true", headers=self.h)
        except http.HttpError as e:
            if e.status == 404:
                return None
            raise

    def folder(self, folder_id: str) -> Optional[dict[str, Any]]:
        try:
            return http.get_json(f"{DRIVE}/{http.quote(folder_id)}?fields=id,name,mimeType,trashed,capabilities(canAddChildren)"
                                 "&supportsAllDrives=true", headers=self.h)
        except http.HttpError as e:
            if e.status == 404:
                return None
            raise

    def create_pdf(self, folder_id: str, name: str, pdf: bytes) -> dict[str, Any]:
        """Upload a new PDF. Sent once: the worker looks for it by name before
        it ever uploads again."""
        boundary = f"invoice-{uuid.uuid4().hex}"
        meta = json.dumps({"name": name, "parents": [folder_id], "mimeType": "application/pdf"}).encode()
        body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode() + meta +
                f"\r\n--{boundary}\r\nContent-Type: application/pdf\r\n\r\n".encode() + pdf +
                f"\r\n--{boundary}--\r\n".encode())
        _, data = http.request("POST", f"{UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields={FILE_FIELDS}",
                               headers={**self.h, "Content-Type": f"multipart/related; boundary={boundary}"},
                               body=body, timeout=120)
        return json.loads(data)

    def replace_pdf(self, file_id: str, pdf: bytes) -> dict[str, Any]:
        _, data = http.request("PATCH", f"{UPLOAD}/{http.quote(file_id)}?uploadType=media&supportsAllDrives=true&fields={FILE_FIELDS}",
                               headers={**self.h, "Content-Type": "application/pdf"}, body=pdf, timeout=120, retries=2)
        return json.loads(data)

    def set_lock(self, file_id: str, locked: bool, reason: str) -> None:
        """Editor-level lock: no new version, rename or comment until lifted."""
        restriction: dict[str, Any] = {"readOnly": locked}
        if locked:
            restriction["reason"] = reason
        http.send_json("PATCH", f"{DRIVE}/{http.quote(file_id)}?supportsAllDrives=true",
                       {"contentRestrictions": [restriction]}, headers=self.h, retries=2)

    def share_by_link(self, file_id: str) -> None:
        http.send_json("POST", f"{DRIVE}/{http.quote(file_id)}/permissions?supportsAllDrives=true",
                       {"type": "anyone", "role": "reader"}, headers=self.h, retries=2)

    # ----------------------------------------------------------------- sheets --
    @staticmethod
    def _range(tab: str, cells: str) -> str:
        return http.quote("'" + tab.replace("'", "''") + "'!" + cells)

    def column_a(self, sheet: str, tab: str) -> list[str]:
        url = f"{SHEETS}/{http.quote(sheet)}/values/{self._range(tab, 'A1:A')}?majorDimension=COLUMNS"
        values = http.get_json(url, headers=self.h).get("values", [])
        return [str(v) for v in values[0]] if values else []

    def header(self, sheet: str, tab: str) -> list[str]:
        url = f"{SHEETS}/{http.quote(sheet)}/values/{self._range(tab, '1:1')}"
        values = http.get_json(url, headers=self.h).get("values", [])
        return [str(v) for v in values[0]] if values else []

    def append_row(self, sheet: str, tab: str, row: list[Any]) -> int:
        """Append once and return the sheet row number it landed on."""
        url = (f"{SHEETS}/{http.quote(sheet)}/values/{self._range(tab, 'A1:J1')}:append"
               "?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS")
        out = http.send_json("POST", url, {"values": [row]}, headers=self.h)
        updated = (out or {}).get("updates", {}).get("updatedRange", "")
        m = re.search(r"!A(\d+)", updated)
        if not m:
            raise RuntimeError(f"The register did not say where the row landed ({http.scrub(updated)}).")
        return int(m.group(1))

    def write_row(self, sheet: str, tab: str, row_number: int, row: list[Any]) -> None:
        url = (f"{SHEETS}/{http.quote(sheet)}/values/{self._range(tab, f'A{row_number}:J{row_number}')}"
               "?valueInputOption=USER_ENTERED")
        http.send_json("PUT", url, {"values": [row]}, headers=self.h, retries=2)
