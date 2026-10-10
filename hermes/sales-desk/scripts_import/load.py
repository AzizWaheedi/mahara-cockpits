#!/usr/bin/env python3
"""Load parsed scripts into Creative Triage `cockpit_sales_scripts`.

Usage: load.py <dir with {intro,demo}.{en,ar}.json> [--by <email>]

Needs DESK_SUPABASE_URL and DESK_SUPABASE_KEY (the service pair the editor
desk uses). The revisions made in the cockpit (revise.py) are applied on top
of every doc first, so a re-import from Google Docs never undoes them; a doc
that has changed under a revision stops the import and names the words.
A script whose text is unchanged since the newest version is skipped; a
changed one becomes the next version and the older versions are switched
off, never deleted.

Each language gets its own captures (captures_for): a field's anchor, the
line it sits under in the cockpit, is kept only where that line is in the
language's stage, and an anchor dropped is printed.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import revise  # noqa: E402

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


def captures_for(doc: dict, captures: list[dict]) -> tuple[list[dict], list[str]]:
    """This language's own captures, and the anchors it dropped.

    A capture's `after` is the block in its stage the field sits under in the
    cockpit (the line that asks for it). It is kept only when that block is in
    this language's stage and is not a step heading; otherwise the field goes
    to the end of the stage, under "Answers for this part", and the dropped
    anchor is named so the import says so.
    """
    stages = {s.get("no"): s for s in doc.get("stages", [])}
    out: list[dict] = []
    dropped: list[str] = []
    for c in captures:
        c = dict(c)
        after = c.get("after")
        if after is not None:
            blocks = (stages.get(c.get("stage")) or {}).get("blocks") or []
            ok = isinstance(after, int) and not isinstance(after, bool) and 0 <= after < len(blocks)
            if ok and blocks[after].get("type") == "step":
                ok = False
            if not ok:
                dropped.append(f"{c['key']} (stage {c.get('stage')}, block {after})")
                c.pop("after")
        out.append(c)
    return out, dropped


def main() -> None:
    src = Path(sys.argv[1])
    by = sys.argv[sys.argv.index("--by") + 1] if "--by" in sys.argv else "scripts_import"
    captures = json.loads((Path(__file__).parent / "captures.json").read_text())
    # Every doc revised before any is loaded: a doc that drifted stops the
    # whole import, so the four scripts never disagree with each other.
    docs = []
    for key in ("intro", "demo"):
        for lang in ("en", "ar"):
            f = src / f"{key}.{lang}.json"
            if not f.exists():
                continue
            doc = json.loads(f.read_text())
            doc["key"], doc["lang"] = key, lang
            try:
                doc = revise.apply(doc)
            except revise.Drift as e:
                sys.exit(f"{key}.{lang}: {e}. Nothing was loaded; bring revise.py in line with the doc first.")
            doc["captures"], dropped = captures_for(doc, captures.get(key, []))
            if dropped:
                print(f"{key}.{lang}: anchors dropped, these fields go to the end of their stage: {', '.join(dropped)}")
            docs.append((key, lang, doc))
    for key, lang, doc in docs:
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
            "source": {**SOURCES[key], "lang": lang, "sha256": digest, "revisions": doc.get("revisions", [])},
            "active": True,
            "imported_by": by,
        }, prefer="return=minimal")
        rest("PATCH", f"cockpit_sales_scripts?key=eq.{key}&lang=eq.{lang}&version=lt.{version}",
             {"active": False}, prefer="return=minimal")
        print(f"{key}.{lang}: loaded as version {version}")


if __name__ == "__main__":
    main()
