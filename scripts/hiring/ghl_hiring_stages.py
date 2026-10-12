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
- The words a candidate reads: the custom value "Call centre agent - Test project"
  says "after the one to one" and gets "after the one-to-one" (its name and key
  stay). Only the exact phrases in TEXT_FIXES change, so --undo puts back
  exactly what was there.
- With --calendar, the booking calendar "One to one interview" gets the new
  name, and its description's "Book your one to one" reads "Book your one-to-one".
  HighLevel's calendar PUT takes a calendar out of its hosts' availability
  schedules, so any schedule that listed it before the write lists it again
  after (rules and timezone as read); a schedule that cannot be read first
  stops the calendar write.

It never touches a workflow, a contact, a card or a message, changes no custom
value beyond those phrases, and it never publishes anything. Running it twice is safe: a board that already
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
# The candidate-facing phrases that still said "one to one" on 2026-10-11: the call centre test project
# (a custom value the emails use) and the one-to-one calendar's description. Exact phrases only.
TEXT_FIXES = (
    ("after the one to one", "after the one-to-one"),
    ("Book your one to one", "Book your one-to-one"),
)

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


def fix_text(text: Any, undo: bool = False) -> Optional[str]:
    """The text with the TEXT_FIXES phrases changed (reversed with undo). None when nothing changes."""
    t = str(text or "")
    out = t
    for old, new in TEXT_FIXES:
        a, b = (new, old) if undo else (old, new)
        out = out.replace(a, b)
    return out if out != t else None


def calendar_drift(before: dict[str, Any], after: dict[str, Any], also: tuple[str, ...] = ()) -> list[str]:
    """Calendar settings that differ after a rename, apart from the name, the timestamps and `also`."""
    skip = {"name", "updatedAt", "dateUpdated", "updated_at", "lastUpdatedBy", "version", *also}
    return sorted(k for k in set(before) | set(after) if k not in skip and before.get(k) != after.get(k))


def linked_schedules(get: Get, loc: str, cal: dict[str, Any]) -> Optional[list[dict[str, Any]]]:
    """The hosts' availability schedules that list this calendar, or None when one cannot be read."""
    out: list[dict[str, Any]] = []
    for m in cal.get("teamMembers") or []:
        uid = m.get("userId")
        if not uid:
            continue
        status, body = get(f"/calendars/schedules/search?locationId={loc}&userId={uid}", "2021-04-15")
        if status != 200:
            return None
        for s in (body or {}).get("schedules") or []:
            if not s.get("deleted") and cal.get("id") in (s.get("calendarIds") or []):
                out.append(s)
    return out


def relink_schedule(get: Get, put: Put, sched: dict[str, Any], cal_id: str, say: Callable[[str], None]) -> int:
    """Put the calendar back in a schedule the calendar PUT took it out of. Returns 1 on a failure."""
    path = f"/calendars/schedules/{sched['id']}"
    status, body = get(path, "2021-04-15")
    now = (body or {}).get("schedule", body) if status == 200 else None
    if not now:
        say(f"CHECK schedule {sched.get('name')!r}: could not be read after the calendar write")
        return 1
    ids = list(now.get("calendarIds") or [])
    if cal_id in ids:
        say(f"  schedule {now.get('name')!r} still lists the calendar")
        return 0
    status, out = put(path, {"name": now.get("name"), "rules": now.get("rules"), "timezone": now.get("timezone"),
                             "calendarIds": ids + [cal_id]}, "2021-04-15")
    s2, back = get(path, "2021-04-15")
    back = (back or {}).get("schedule", back) if s2 == 200 else None
    if status >= 300 or not back or cal_id not in (back.get("calendarIds") or []) or back.get("rules") != now.get("rules"):
        say(f"CHECK schedule {now.get('name')!r}: the calendar is not back in it ({status} {str(out)[:120]})")
        return 1
    say(f"  re-linked the calendar to the {now.get('name')!r} schedule, its hours unchanged")
    return 0


def _pairs(undo: bool) -> list[tuple[str, str]]:
    return [(b, a) if undo else (a, b) for a, b in TEXT_FIXES]


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

    values: list[tuple[dict[str, Any], str]] = []
    status, vbody = get(f"/locations/{loc}/customValues")
    if status != 200:
        say(f"Could not read the custom values: {status}")
        failed += 1
    else:
        for v in vbody.get("customValues") or []:
            new_v = fix_text(v.get("value"), undo)
            if new_v is not None:
                values.append((v, new_v))
                say(f"  custom value {v['id']} {v.get('name')!r}: " + ", ".join(
                    f"{a!r} -> {b!r}" for a, b in _pairs(undo) if a in str(v.get("value") or "")))
        if not values:
            say("  custom values: none says " + " or ".join(repr(a) for a, _ in _pairs(undo)) + ", left alone")

    cal = None
    if calendar:
        status, cbody = get(f"/calendars/?locationId={loc}", "2021-04-15")
        if status != 200:
            say(f"Could not read the calendars: {status}")
            failed += 1
        else:
            cals = cbody.get("calendars") or []
            found = next((c for c in cals if same(c.get("name"), old_c)), None) or \
                next((c for c in cals if same(c.get("name"), new_c)), None)
            if found:
                cal_body: dict[str, Any] = {}
                if same(found.get("name"), old_c):
                    cal_body["name"] = new_c
                desc = fix_text(found.get("description"), undo)
                if desc is not None:
                    cal_body["description"] = desc
                if cal_body:
                    cal = (found, cal_body)
                    parts = []
                    if "name" in cal_body:
                        parts.append(f"name -> {new_c!r}")
                    if "description" in cal_body:
                        parts += [f"description {a!r} -> {b!r}" for a, b in _pairs(undo)
                                  if a in str(found.get("description") or "")]
                    say(f"  calendar {found['id']} {found['name']!r}: " + ", ".join(parts))
                else:
                    say(f"  calendar {found['id']}: its name and description already read {new_c!r}, left alone")
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

    for v, new_v in values:
        status, out = put(f"/locations/{loc}/customValues/{v['id']}", {"name": v.get("name"), "value": new_v})
        if status >= 300:
            failed += 1
            say(f"FAILED custom value {v.get('name')!r}: {status} {str(out)[:200]}")
            continue
        s2, vb = get(f"/locations/{loc}/customValues")
        now = next((x for x in (vb or {}).get("customValues") or [] if x.get("id") == v["id"]), None) if s2 == 200 else None
        if not now or now.get("value") != new_v or now.get("name") != v.get("name") or now.get("fieldKey") != v.get("fieldKey"):
            failed += 1
            say(f"CHECK custom value {v.get('name')!r}: reads name {now and now.get('name')!r}, key "
                f"{now and now.get('fieldKey')!r}, and its words {'as asked' if now and now.get('value') == new_v else 'not as asked'}")
        else:
            say(f"  done custom value {v.get('name')!r}: new words, same name and key")

    if cal:
        found, cal_body = cal
        status, before = get(f"/calendars/{found['id']}", "2021-04-15")
        before = (before or {}).get("calendar", before) if status == 200 else None
        # HighLevel's calendar PUT treats a missing openHours as none at all: a
        # name-only PUT on 2026-10-11 left the one-to-one calendar with no open
        # hours (restored by hand the same hour). Send the hours it has, and
        # never write a calendar whose hours could not be read first.
        # A PUT that carries openHours also takes the calendar out of every
        # host's availability schedule (2026-10-11: the demo calendars fell back
        # to their own 00:00-23:55 hours). Note the schedules first, re-link after.
        linked = linked_schedules(get, loc, before) if before and before.get("openHours") else None
        if not before or not before.get("openHours"):
            failed += 1
            say("FAILED calendar: its open hours could not be read first, so it was left alone")
        elif linked is None:
            failed += 1
            say("FAILED calendar: its hosts' schedules could not be read first, so it was left alone")
        else:
            status, out = put(f"/calendars/{found['id']}", {**cal_body, "openHours": before["openHours"]}, "2021-04-15")
            if status >= 300:
                failed += 1
                say(f"FAILED calendar: {status} {str(out)[:200]}")
            else:
                s2, after = get(f"/calendars/{found['id']}", "2021-04-15")
                after = (after or {}).get("calendar", after) if s2 == 200 else None
                drift = (calendar_drift(before, after or {}, tuple(cal_body)) if after else ["could not read it back"])
                wrong = [k for k, want in cal_body.items() if not after or str(after.get(k) or "") != want]
                if not after or wrong or drift:
                    failed += 1
                    say(f"CHECK calendar: not as asked: {', '.join(wrong) or 'nothing'}; also changed: {', '.join(drift) or 'nothing'}")
                else:
                    say(f"  done calendar: {', '.join(cal_body)} as asked, nothing else changed")
                for s in linked:
                    failed += relink_schedule(get, put, s, found["id"], say)

    say("Nothing else was touched: no workflow, contact, card or message, and no other custom value." + (" Some steps need a look (above)." if failed else ""))
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
