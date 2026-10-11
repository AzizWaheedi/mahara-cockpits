#!/usr/bin/env python3
"""Rename "One to one interview" to "One-to-one interview" on the hiring boards, in place.

Aziz, 2026-10-11: the stage is "One-to-one interview" (his words), and "make
everything extremely neat: the custom values, the names, everything, even the
pipeline stages". The cockpit already reads both names (STAGE_AKA and
FIELD_AKA in the hiring spec), so the boards can be renamed at any time.

It runs on the VPS, where the hiring sub-account's key lives, and prints no key:

  ssh -i ~/.ssh/faris-key hermes@187.77.156.166 'python3 -' < scripts/hiring/ghl_hiring_stages.py
      dry run (the default): reads, prints every change it would make, writes nothing
  ssh ... 'python3 - --apply' < scripts/hiring/ghl_hiring_stages.py
      renames the stage on every board and the score field, then reads them back
  ssh ... 'python3 - --apply --calendar' < scripts/hiring/ghl_hiring_stages.py
      also renames the one-to-one booking calendar (its name is what a candidate
      sees on the booking page), then checks nothing else on it changed
  ssh ... 'python3 - --undo [--apply] [--calendar]' < scripts/hiring/ghl_hiring_stages.py
      the same in reverse: puts the old names back

What --apply changes, and nothing else:
- On each hiring pipeline, the stage named "One to one interview" gets the new
  name. The pipeline is written back with every stage's id, position, funnel
  flags and win probability exactly as read, so no id changes: the 36 workflow
  triggers (matched on stage id) and every card stay where they are. Sending a
  stage without its id would build a second column, so a stage with no id
  stops the run before any write.
- The contact field "Score 4, one to one" becomes "Score 4, one-to-one". Its
  id and merge key stay.
- With --calendar, the booking calendar "One to one interview" gets the new name.

It never touches a workflow, a contact, a card, a custom value or a message,
and it never publishes anything. Running it twice is safe: a board that already
has the new name is left alone. After every write it reads the thing back and
says plainly if anything other than the one name moved.

Exit status: 0 when everything is as asked (or would be, on a dry run), 1 when
a write or a read-back check failed, 2 when it could not start.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request
from typing import Any, Callable, Optional

OLD_STAGE = "One to one interview"
NEW_STAGE = "One-to-one interview"
OLD_FIELD = "Score 4, one to one"
NEW_FIELD = "Score 4, one-to-one"
OLD_CALENDAR = "One to one interview"
NEW_CALENDAR = "One-to-one interview"

# The hiring boards, by name (hiring spec ROLES[].pipeline).
PIPELINES = (
    "Media buyer",
    "Client success manager",
    "Sales closer (B2B)",
    "Sales setter (B2B)",
    "Call centre agent",
    "Video editor",
)
# The only stage keys a pipeline PUT takes back (proved 2026-09-22).
STAGE_KEYS = ("id", "name", "position", "showInFunnel", "showInPieChart", "stageWinProbability")

BASE = "https://services.leadconnectorhq.com"
RUNTIME_DIR = pathlib.Path("/home/hermes/.cockpit-native-state")
CURRENT = pathlib.Path("/home/hermes/cockpit-native-current")

Get = Callable[[str, str], tuple[int, Any]]
Put = Callable[[str, dict[str, Any], str], tuple[int, Any]]


def same(a: Any, b: str) -> bool:
    return str(a or "").strip().lower() == b.strip().lower()


def keys() -> tuple[str, str]:
    """The hiring key and location: the environment first, else the native runtime file."""
    pit = os.environ.get("GHL_HIRING_PIT", "").strip()
    loc = os.environ.get("GHL_HIRING_LOCATION", "").strip()
    if pit and loc:
        return pit, loc
    release = CURRENT.resolve().name
    data = json.loads((RUNTIME_DIR / f"runtime-{release}.json").read_text())
    return str(data["GHL_HIRING_PIT"]).strip(), str(data["GHL_HIRING_LOCATION"]).strip()


def client(pit: str) -> tuple[Get, Put]:
    def call(method: str, path: str, body: Optional[dict[str, Any]], version: str) -> tuple[int, Any]:
        req = urllib.request.Request(
            BASE + path,
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={
                "Authorization": "Bearer " + pit,
                "Version": version,
                "Accept": "application/json",
                "Content-Type": "application/json",
                # Without a User-Agent the API answers 403.
                "User-Agent": "mahara-hiring-stages/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                raw = r.read()
                return r.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            text = (e.read() or b"")[:400].decode("utf-8", "replace")
            return e.code, text.replace(pit, "[key]")

    def get(path: str, version: str = "2021-07-28") -> tuple[int, Any]:
        return call("GET", path, None, version)

    def put(path: str, body: dict[str, Any], version: str = "2021-07-28") -> tuple[int, Any]:
        return call("PUT", path, body, version)

    return get, put


# --- Pure parts, tested in test_ghl_hiring_stages.py --------------------------


def stage_body(pipe: dict[str, Any], old: str, new: str) -> Optional[list[dict[str, Any]]]:
    """Every stage as read, with only `old` renamed to `new`. None when there is nothing to rename."""
    stages = pipe.get("stages") or []
    if not any(same(s.get("name"), old) for s in stages):
        return None
    out = []
    for s in stages:
        if not s.get("id"):
            raise ValueError(f"a stage on {pipe.get('name')} has no id; writing it back would build a second column")
        row = {k: s[k] for k in STAGE_KEYS if k in s}
        if same(s.get("name"), old):
            row["name"] = new
        out.append(row)
    return out


def check_stages(before: dict[str, Any], after: dict[str, Any], old: str, new: str) -> list[str]:
    """What moved besides the one name. Empty when the write did exactly what it should."""
    problems: list[str] = []
    b = {s["id"]: s for s in before.get("stages") or []}
    a = {s["id"]: s for s in after.get("stages") or []}
    if set(b) != set(a):
        problems.append(f"stage ids changed: before {sorted(b)}, after {sorted(a)}")
    for sid, s in b.items():
        t = a.get(sid)
        if not t:
            continue
        want = new if same(s.get("name"), old) else s.get("name")
        if str(t.get("name")) != str(want):
            problems.append(f"stage {sid} reads {t.get('name')!r}, expected {want!r}")
        for k in STAGE_KEYS[2:]:
            if k in s and s.get(k) != t.get(k):
                problems.append(f"stage {sid} {k} changed from {s.get(k)!r} to {t.get(k)!r}")
    if str(before.get("name")) != str(after.get("name")):
        problems.append(f"the pipeline name changed to {after.get('name')!r}")
    return problems


def calendar_drift(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    """Calendar settings that differ after a rename, apart from the name and the timestamps."""
    skip = {"name", "updatedAt", "dateUpdated", "updated_at", "lastUpdatedBy", "version"}
    return sorted(k for k in set(before) | set(after) if k not in skip and before.get(k) != after.get(k))


# --- The run --------------------------------------------------------------------


def run(get: Get, put: Put, loc: str, *, apply: bool, undo: bool, calendar: bool, say: Callable[[str], None] = print) -> int:
    old_s, new_s = (NEW_STAGE, OLD_STAGE) if undo else (OLD_STAGE, NEW_STAGE)
    old_f, new_f = (NEW_FIELD, OLD_FIELD) if undo else (OLD_FIELD, NEW_FIELD)
    old_c, new_c = (NEW_CALENDAR, OLD_CALENDAR) if undo else (OLD_CALENDAR, NEW_CALENDAR)
    mode = "APPLY" if apply else "DRY RUN (nothing is written; add --apply)"
    say(f"{mode}: {old_s!r} -> {new_s!r} on the hiring boards, field {old_f!r} -> {new_f!r}"
        + (f", calendar {old_c!r} -> {new_c!r}" if calendar else ", calendar left alone (add --calendar)"))
    failed = 0

    status, body = get(f"/opportunities/pipelines?locationId={loc}")
    if status != 200:
        say(f"Could not read the pipelines: {status} {str(body)[:200]}")
        return 2
    pipes = [p for p in body.get("pipelines") or [] if any(same(p.get("name"), n) for n in PIPELINES)]
    missing = [n for n in PIPELINES if not any(same(p.get("name"), n) for p in pipes)]
    if missing:
        say(f"No board called {', '.join(missing)}; nothing to rename there.")
    plans: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    for p in pipes:
        try:
            stages = stage_body(p, old_s, new_s)
        except ValueError as e:
            say(f"STOP: {e}. Nothing was written.")
            return 2
        target = next((s for s in p.get("stages") or [] if same(s.get("name"), old_s)), None)
        if stages is None:
            has_new = any(same(s.get("name"), new_s) for s in p.get("stages") or [])
            say(f"  {p['name']}: {'already ' + repr(new_s) if has_new else 'no ' + repr(old_s) + ' stage'}, left alone")
            continue
        say(f"  {p['name']} ({p['id']}): stage {target['id']} {target['name']!r} -> {new_s!r}, "
            f"{len(stages)} stages written back with their ids")
        plans.append((p, stages))

    status, fbody = get(f"/locations/{loc}/customFields?model=contact")
    field = None
    if status != 200:
        say(f"Could not read the custom fields: {status}")
        failed += 1
    else:
        fields = fbody.get("customFields") or []
        field = next((f for f in fields if same(f.get("name"), old_f)), None)
        if field:
            say(f"  field {field['id']} {field['name']!r} -> {new_f!r} (its key {field.get('fieldKey', '?')} stays)")
        elif any(same(f.get("name"), new_f) for f in fields):
            say(f"  field: already {new_f!r}, left alone")
        else:
            say(f"  field: no {old_f!r} field, left alone")

    cal = None
    if calendar:
        status, cbody = get(f"/calendars/?locationId={loc}", "2021-04-15")
        if status != 200:
            say(f"Could not read the calendars: {status}")
            failed += 1
        else:
            cals = cbody.get("calendars") or []
            cal = next((c for c in cals if same(c.get("name"), old_c)), None)
            if cal:
                say(f"  calendar {cal['id']} {cal['name']!r} -> {new_c!r}")
            else:
                say(f"  calendar: no {old_c!r} calendar, left alone")

    if not apply:
        say("Dry run: nothing was written.")
        return 1 if failed else 0

    for p, stages in plans:
        status, out = put(f"/opportunities/pipelines/{p['id']}", {"name": p["name"], "stages": stages})
        if status >= 300:
            say(f"FAILED {p['name']}: {status} {str(out)[:200]}")
            failed += 1
            continue
        s2, again = get(f"/opportunities/pipelines?locationId={loc}")
        after = next((x for x in (again or {}).get("pipelines") or [] if x.get("id") == p["id"]), None) if s2 == 200 else None
        problems = check_stages(p, after, old_s, new_s) if after else ["could not read it back"]
        if problems:
            failed += 1
            say(f"CHECK {p['name']}: " + "; ".join(problems))
        else:
            say(f"  done {p['name']}: renamed, every stage id the same")

    if field:
        status, out = put(f"/locations/{loc}/customFields/{field['id']}", {"name": new_f})
        if status >= 300:
            failed += 1
            say(f"FAILED field: {status} {str(out)[:200]}")
        else:
            s2, fb = get(f"/locations/{loc}/customFields?model=contact")
            now = next((f for f in (fb or {}).get("customFields") or [] if f.get("id") == field["id"]), None) if s2 == 200 else None
            if not now or not same(now.get("name"), new_f) or now.get("fieldKey") != field.get("fieldKey"):
                failed += 1
                say(f"CHECK field: reads {now and now.get('name')!r} with key {now and now.get('fieldKey')!r}")
            else:
                say(f"  done field: {new_f!r}, same id and key")

    if cal:
        status, before = get(f"/calendars/{cal['id']}", "2021-04-15")
        before = (before or {}).get("calendar", before) if status == 200 else None
        status, out = put(f"/calendars/{cal['id']}", {"name": new_c}, "2021-04-15")
        if status >= 300:
            failed += 1
            say(f"FAILED calendar: {status} {str(out)[:200]}")
        else:
            s2, after = get(f"/calendars/{cal['id']}", "2021-04-15")
            after = (after or {}).get("calendar", after) if s2 == 200 else None
            drift = calendar_drift(before or {}, after or {}) if before and after else ["could not read it back"]
            if not after or not same(after.get("name"), new_c) or drift:
                failed += 1
                say(f"CHECK calendar: name {after and after.get('name')!r}; also changed: {', '.join(drift) or 'nothing'}")
            else:
                say(f"  done calendar: {new_c!r}, nothing else changed")

    say("Nothing else was touched: no workflow, contact, card, custom value or message." + (" Some steps need a look (above)." if failed else ""))
    return 1 if failed else 0


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="write; without it this is a dry run")
    ap.add_argument("--undo", action="store_true", help="put the old names back")
    ap.add_argument("--calendar", action="store_true", help="also rename the one-to-one booking calendar")
    a = ap.parse_args(argv)
    try:
        pit, loc = keys()
    except (OSError, KeyError, ValueError) as e:
        print(f"Could not read the hiring key: {type(e).__name__}. Run this on the VPS as hermes.")
        return 2
    get, put = client(pit)
    return run(get, put, loc, apply=a.apply, undo=a.undo, calendar=a.calendar)


if __name__ == "__main__":
    sys.exit(main())
