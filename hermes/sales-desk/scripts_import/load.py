#!/usr/bin/env python3
"""Load parsed scripts into Creative Triage `cockpit_sales_scripts`.

Usage: load.py <dir with {intro,demo}.{en,ar}.json> [--by <email>]

Needs DESK_SUPABASE_URL and DESK_SUPABASE_KEY (the service pair the editor
desk uses). A script whose text is unchanged since the newest version is
skipped; a changed one becomes the next version and the older versions are
switched off, never deleted.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

SOURCES = {
    "intro": {"doc": "1EtAtB_vwr0zZU1_jasFL96JOmoaM-Kl5KB4qKUo-_W0", "title": "Intro Call Framework"},
    "demo": {"doc": "1E3RI0eWa0JHjoXYm0iag4ZmIvrNLGyXTUSHFP7Gakjw", "title": "Sales Call Framework"},
}


def rest(method: str, path: str, body=None, prefer: str | None = None):
    url = os.environ["DESK_SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    key = os.environ["DESK_SUPABASE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode()
        return json.loads(text) if text.strip() else None


def main() -> None:
    src = Path(sys.argv[1])
    by = sys.argv[sys.argv.index("--by") + 1] if "--by" in sys.argv else "scripts_import"
    captures = json.loads((Path(__file__).parent / "captures.json").read_text())
    for key in ("intro", "demo"):
        for lang in ("en", "ar"):
            f = src / f"{key}.{lang}.json"
            if not f.exists():
                continue
            doc = json.loads(f.read_text())
            doc["captures"] = captures.get(key, [])
            digest = hashlib.sha256(json.dumps(doc, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            newest = rest("GET", f"cockpit_sales_scripts?key=eq.{key}&lang=eq.{lang}&select=version,source&order=version.desc&limit=1")
            if newest and (newest[0].get("source") or {}).get("sha256") == digest:
                print(f"{key}.{lang}: unchanged (version {newest[0]['version']})")
                continue
            version = (newest[0]["version"] + 1) if newest else 1
            rest("POST", "cockpit_sales_scripts", {
                "key": key, "lang": lang, "version": version,
                "title": doc.get("title") or SOURCES[key]["title"],
                "doc": doc,
                "source": {**SOURCES[key], "lang": lang, "sha256": digest},
                "active": True,
                "imported_by": by,
            }, prefer="return=minimal")
            rest("PATCH", f"cockpit_sales_scripts?key=eq.{key}&lang=eq.{lang}&version=lt.{version}",
                 {"active": False}, prefer="return=minimal")
            print(f"{key}.{lang}: loaded as version {version}")


if __name__ == "__main__":
    main()
