"""Keys, read by name. Environment first, then the key files in order.

Nothing here has a secret default. A missing key is reported by name, in a
plain sentence the invoices page shows, never treated as an empty value.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# The Churn Tracker workbook and its register tab (make_invoice.py, 16 Jul 2026).
DEFAULT_REGISTER_SHEET = "1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU"
DEFAULT_REGISTER_TAB = "07: Invoice Register"
# Whop links (15 Oct 2026). The key is read by name from the VPS file that holds
# the Whop keys able to create plans; it is never copied anywhere else. The
# product is "Premium Projects Program", the one every client link sits under.
DEFAULT_WHOP_KEY_FILE = "/opt/data/bibi/api-keys.env"
DEFAULT_WHOP_KEY_NAME = "WHOP_API_KEY"
DEFAULT_WHOP_PRODUCT = "prod_UxHKRiFd5kCjI"


def _key_files() -> tuple[str, ...]:
    home = Path.home()
    return (
        os.environ.get("INVOICE_KEY_FILE", ""),
        str(home / ".invoice-desk" / "env"),
        str(home / ".editor-desk" / "env"),  # DESK_SUPABASE_URL / _KEY, Creative Triage
        str(home / ".sales-desk" / "env"),
        "/opt/data/.env",
    )


_file_keys: Optional[dict[str, str]] = None


def _parse_env_file(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[7:]
                name, _, value = line.partition("=")
                name, value = name.strip(), value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                if name and name not in out:
                    out[name] = value
    except OSError:
        pass
    return out


def key(name: str, default: str = "") -> str:
    global _file_keys
    value = os.environ.get(name)
    if value:
        return value
    if os.environ.get("INVOICE_NO_KEY_FILES"):
        return default
    if _file_keys is None:
        merged: dict[str, str] = {}
        for path in _key_files():
            if path and os.path.exists(path):
                for k, v in _parse_env_file(path).items():
                    merged.setdefault(k, v)
        _file_keys = merged
    return _file_keys.get(name, default)


def reset_keys() -> None:
    """Forget the key files read so far. Tests only."""
    global _file_keys
    _file_keys = None


def whop_key() -> str:
    """INVOICE_WHOP_KEY when set, else the named key in the Whop key file.

    Read from that one file on purpose: other key files on the VPS carry a
    WHOP_API_KEY that can read Whop but cannot create plans.
    """
    direct = key("INVOICE_WHOP_KEY")
    if direct:
        return direct
    if os.environ.get("INVOICE_NO_KEY_FILES"):
        return ""
    path = key("INVOICE_WHOP_KEY_FILE", DEFAULT_WHOP_KEY_FILE)
    name = key("INVOICE_WHOP_KEY_NAME", DEFAULT_WHOP_KEY_NAME)
    return _parse_env_file(path).get(name, "") if path and os.path.exists(path) else ""


@dataclass
class Config:
    supabase_url: str
    supabase_key: str
    google_key_file: str
    register_sheet: str
    register_tab: str
    whop_key: str = ""
    whop_product: str = DEFAULT_WHOP_PRODUCT

    @classmethod
    def load(cls) -> "Config":
        return cls(
            supabase_url=(key("INVOICE_SUPABASE_URL") or key("DESK_SUPABASE_URL") or key("RADAR_SUPABASE_URL")).rstrip("/"),
            supabase_key=key("INVOICE_SUPABASE_KEY") or key("DESK_SUPABASE_KEY") or key("RADAR_SUPABASE_KEY"),
            google_key_file=key("INVOICE_GOOGLE_KEY_FILE"),
            register_sheet=key("INVOICE_REGISTER_SHEET", DEFAULT_REGISTER_SHEET),
            register_tab=key("INVOICE_REGISTER_TAB", DEFAULT_REGISTER_TAB),
            whop_key=whop_key(),
            whop_product=key("INVOICE_WHOP_PRODUCT", DEFAULT_WHOP_PRODUCT),
        )

    def missing(self) -> list[str]:
        """Plain sentences, one per missing key. Empty when ready."""
        out: list[str] = []
        if not self.supabase_url or not self.supabase_key:
            out.append("The database address or key is missing on the VPS (INVOICE_SUPABASE_URL, INVOICE_SUPABASE_KEY).")
        if not self.google_key_file:
            out.append("The Google service account file is not set on the VPS (INVOICE_GOOGLE_KEY_FILE).")
        elif not os.path.isfile(self.google_key_file):
            out.append("The Google service account file named by INVOICE_GOOGLE_KEY_FILE is not on the VPS.")
        return out
